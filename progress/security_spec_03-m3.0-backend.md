# Gate de seguridad — spec 03 / chunk M3.0-BACKEND (modo `code`, ADR-019)

**Artefacto auditado**: `supabase/migrations/0091_sanitary_gating_deworming_treatment.sql` (migración NUEVA, **NO aplicada** a la DB — veredicto basado en el SQL + razonamiento del gating, espejando la rama `vaccination` ya auditada en 0054).
**Baseline**: `638679f` (registrado en `progress/impl_03-m3.0-backend.md`).
**Skill**: `sentry-skills:security-review` ejecutada sobre el delta + verificación manual cruzada (data-flow trace + exploitability).
**Fecha**: 2026-06-14.

## VEREDICTO: **PASS**

Cero findings HIGH. Cero findings MEDIUM. El delta de gating es fail-closed real, la semántica OR es correcta, no hay path de bypass, el helper nuevo está correctamente privilegiado (SECURITY DEFINER + search_path fijo + EXECUTE revocado en la propia 0091), y la rama `vaccination` queda byte-idéntica a 0054 (sin regresión). No hay SQL dinámico ni vector de inyección. La migración es segura para aplicar.

> ⚠️ Recordatorio operativo (no es finding): aplicar `0091` vía MCP requiere autorización explícita de Raf en sesión (memoria `project_supabase_mcp_write`). El rojo de `T2.4c` en `check.mjs` es ESPERADO pre-deploy (el trigger viejo 0054 no gatea `deworming`/`treatment`, el INSERT que el test espera RECHAZADO se acepta) — NO es finding ni regresión.

---

## Foco obligatorio — resultado por punto

### 1. Fail-closed real (R7.6 / SEC-SPEC-03-03) — ✓ SIN path fail-open

Tracé todos los caminos de salida de `assert_any_data_key_enabled` (0091:35-68):

| Camino | Condición | Resultado | ¿Correcto? |
|---|---|---|---|
| Rodeo no resoluble | `v_rodeo IS NULL` (perfil inexistente o `deleted_at IS NOT NULL`) | `raise 23514` (0091:46-49) — **rechaza** | ✓ fail-closed |
| Ninguna alternativa enabled | `v_have < 1` | `raise 23514` (0091:64-67) — **rechaza** | ✓ fail-closed |
| Array vacío/NULL | `v_need IS NULL` | `return` (pasa) — pero **inalcanzable**: el trigger pasa el literal `['antiparasitario_interno','antiparasitario_externo']`, `array_length = 2`, nunca NULL. El rodeo-existence ya se validó ANTES de este branch (0091:46). Idéntico a 0054. | ✓ no explotable |
| Al menos una enabled | `v_have >= 1` | termina normal — **pasa** | ✓ esperado |

- El rechazo por rodeo-null ocurre **antes** de cualquier early-return de pase (0091:46 va antes que el `return` de 0091:53). No se puede colar un INSERT con rodeo no resoluble.
- **No hay** `exception when others then ... return` que se trague el `23514` (el clásico fail-open). **No hay** early-return de pase antes de los checks de rechazo.
- La resolución del rodeo es **inline** desde `animal_profiles.rodeo_id` del perfil ACTIVO (`deleted_at is null`, 0091:43) — NO usa `current_animal_rodeo` (inexistente as-built). Coincide con R5.3/R7.1/SEC-SPEC-03-02.

### 2. Semántica OR de `deworming` — ✓ CORRECTA (umbral `>= 1`, no AND, no acepta con cero)

Bordes verificados sobre `assert_any_data_key_enabled(['antiparasitario_interno','antiparasitario_externo'])`:

| Estado del rodeo real | `v_have` | `v_have < 1`? | Resultado | ¿Correcto? |
|---|---|---|---|---|
| Ninguna enabled (sin filas / ambas ausentes) | 0 | sí | **rechaza** (23514) | ✓ basta-cero-rechaza |
| Solo interna enabled | 1 | no | **pasa** | ✓ basta-uno |
| Solo externa enabled | 1 | no | **pasa** | ✓ basta-uno |
| Ambas enabled | 2 | no | **pasa** | ✓ |
| Ambas presentes pero `enabled = false` | 0 (filtradas por `rdc.enabled = true`, 0091:60) | sí | **rechaza** | ✓ |

- Umbral `v_have < 1` (0091:64) = "al menos uno". **NO** es `< v_need` (que sería AND, exigiría las dos). Es exactamente la diferencia correcta vs `assert_data_keys_enabled` (que usa `< v_need` para la semántica AND de `treatment`/`vaccination`). No es AND por error; no acepta con ninguna enabled.
- `count(distinct fd.data_key)` (0091:56) es robusto a duplicados en `rodeo_data_config`: colapsa por `data_key`. Y como `field_definitions.data_key` es **UNIQUE** (0018:9), dos data_keys distintas = dos filas distintas — el count no infla ni subcuenta.

### 3. No-bypass — ✓ INESCAPABLE desde PostgREST / service_role / sync

- El delta hace `CREATE OR REPLACE` de la **función** `tg_sanitary_events_gating`, NO redefine el trigger. El trigger `sanitary_events_gating` (0054:106-108) es `BEFORE INSERT ... FOR EACH ROW` y **sigue ligado** a la función por nombre — `CREATE OR REPLACE FUNCTION` preserva los triggers que la referencian. Dispara para INSERT (no solo UPDATE).
- El trigger de 0054 **no tiene cláusula `WHEN`** (a diferencia del de teeth) → dispara para TODO INSERT en `sanitary_events`, incluido `deworming`/`treatment`. No hay path que lo saltee por tipo de evento.
- Los triggers BEFORE INSERT corren para `service_role` también: en Postgres solo `session_replication_role = replica` (superuser-only) los desactiva — no aplicable a PostgREST/PowerSync. El delta **no** contiene `DISABLE TRIGGER` ni manipula `session_replication_role`. Un INSERT directo por PostgREST/sync/service_role sobre un rodeo sin la data_key habilitada se rechaza con 23514 (R7.3 defensa en profundidad cumplida).

### 4. No-regresión del gating existente — ✓ vaccination BYTE-IDÉNTICA a 0054

- Firma de la función (`returns trigger language plpgsql security definer set search_path = public`), rama `if new.event_type = 'vaccination' then perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion'])`, y `revoke execute` final: **idénticos** a 0054 (comparados línea a línea). El delta solo INSERTA dos `elsif` (`deworming`/`treatment`) entre la rama vaccination y `return new`. La rama vaccination no se debilitó.
- `treatment` reusa `assert_data_keys_enabled` (el helper AND ya auditado en 0054), **sin redefinirlo** — hereda el comportamiento fail-closed verificado. Single-key `['antibiotico']`, exacto patrón de `vaccination → ['vacunacion']`.
- `test`/`other` siguen **sin gatear** (intencional, R7.7 no los lista; comentario 0091:93). Otras tablas de evento (weight/condition/lab/reproductive/teeth) **intactas** — 0091 no las toca.

### 5. Privilege / EXECUTE — ✓ correctamente endurecido

`assert_any_data_key_enabled` (helper NUEVO):
- `security definer` ✓ (0091:36)
- `set search_path = public` ✓ (0091:36) — neutraliza search_path hijacking, el vector clásico de escalación sobre funciones SECURITY DEFINER.
- `revoke execute ... from public, authenticated, anon` ✓ **presente en la propia 0091** (0091:69) — NO depende de 0055.

> Nota de cobertura (no es finding): el smoke-check fail-closed de `0055_check_grants.sql` lista las funciones de 0054 pero **NO** incluye `assert_any_data_key_enabled` (es posterior). Esto NO deja gap porque el REVOKE está en 0091 mismo. **Recomendación LOW (defensa en profundidad, opcional)**: agregar `assert_any_data_key_enabled` al array `v_funcs` del smoke-check (sea en 0055 o una 009x futura) para que el assert automático lo cubra también. No bloquea — el revoke ya está aplicado por 0091.

`tg_sanitary_events_gating` (función reemplazada): el `CREATE OR REPLACE` preserva el revoke pre-existente de 0054; 0091:98 lo re-afirma (housekeeping, patrón 0055). ✓

### 6. Inyección / dynamic SQL — ✓ ninguna

- Sin SQL dinámico, sin `EXECUTE format(...)`. Queries estáticas con parámetros bind: `where id = p_animal_profile_id` (0091:43), `fd.data_key = any(p_data_keys)` (0091:61). Cero interpolación de strings.
- Los `raise exception ... %, ...` usan placeholders de plpgsql (format-style, seguros — no interpolan en SQL ejecutable).

### Tenant isolation (R7.4) — ✓

El helper deriva el rodeo del **propio** `animal_profile_id` del evento y filtra `rodeo_data_config` por ese `v_rodeo` — no cruza ni expone config de otro establecimiento. El gating es capa de integridad de datos; la RLS de `sanitary_events` (spec 02) sigue siendo la frontera tenant del INSERT. Mismo patrón tenant-safe que 0054.

---

## Tabla de inputs (campos atacante-controlados que tocan el gating)

| Campo | Origen | Límite / validación | OK? |
|---|---|---|---|
| `new.event_type` | cliente (vía INSERT a `sanitary_events`) | acotado por enum `sanitary_event_type` (0027: `vaccination/deworming/treatment/test/other`) — un valor fuera del enum lo rechaza Postgres antes del trigger; el trigger ramifica por valores literales conocidos | ✓ server-side (enum DB) |
| `new.animal_profile_id` | cliente | usado como `where id = ...` (bind, no interpolado); si no resuelve perfil activo → fail-closed 23514. RLS de spec 02 acota qué `animal_profile_id` puede referenciar el caller | ✓ server-side (fail-closed + bind) |
| `p_data_keys` (deworming) | **server-controlled** (literal en el trigger, no viene del cliente) | array literal `['antiparasitario_interno','antiparasitario_externo']` hardcodeado en 0091:87 | ✓ no atacante-controlado |

No hay texto libre, buscador ni prompt en este delta. La validación autoritativa vive en la DB (enum + trigger fail-closed), no en el cliente.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| INSERT a `sanitary_events` (deworming/treatment) | n.a. | n.a. | n.a. | El delta es un trigger de integridad de datos, no un endpoint nuevo ni una Edge Function. No manda email/SMS, no pega a API externa, no es bulk. El rate-limit de escritura a PostgREST/PowerSync es transversal a la app, fuera del scope de este delta. |

---

## Findings de la skill (Sentry) — validados manualmente

**Ninguno HIGH ni MEDIUM.** La skill no identificó vulnerabilidades de alta confianza en el delta. Mi verificación manual cruzada (data-flow trace de los 4 caminos de salida + comparación byte-a-byte con 0054 + verificación de existencia de data_keys/enum) confirma: sin falsos negativos detectables.

## False positives / no-findings descartados (trazabilidad)

- **Branch `v_need IS NULL` (0091:52-54) como posible fail-open**: descartado. Inalcanzable para la invocación real (el trigger pasa un array literal de length 2); y el rodeo-existence ya se validó antes. Paridad exacta con 0054. No explotable.
- **`assert_any_data_key_enabled` no listada en el smoke-check de 0055**: descartado como finding (queda como recomendación LOW). El REVOKE está en 0091 mismo, no hay gap de privilegio.

## Cobertura indirecta (lo que la skill de Sentry NO cubre nativamente)

La skill `sentry-skills:security-review` está orientada a app code (Python/JS/Go/etc.), **no** a PL/pgSQL ni a semántica de triggers Postgres / RLS / gating multi-tenant. Por eso el grueso de este veredicto se apoya en **revisión manual RAFAQ-específica**: semántica OR del helper, fail-closed de plpgsql, propagación de triggers por `CREATE OR REPLACE FUNCTION`, inescapabilidad frente a service_role, y privilege de funciones SECURITY DEFINER. Todo verificado contra el patrón ya auditado de 0054 y los requirements R7.1/R7.3/R7.4/R7.6/R7.7 + R11.4.

## Dominios revisados
A4 (function-level authz — EXECUTE revocado), A1/A3 (service-role bypass / IDOR — el gating es inescapable y deriva tenant del propio perfil), F1 (inyección — ninguna), tenant isolation, fail-closed/error-handling.

## Dominios excluidos (justificación)
B (data exposure — el delta no devuelve datos al cliente), C (offline/sync — el trigger corre server-side al sincronizar, refuerza C4 stale-auth replay), D (secrets — ninguno), E/rate-limits (no es endpoint), G (BLE — n.a.), H/I (auth/compliance — n.a. para este delta).
