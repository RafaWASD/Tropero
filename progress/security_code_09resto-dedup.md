# Security code review (Gate 2) — chunk "09 resto · dedup A/B" — RPC `assign_tag_to_animal` + service offline

**Modo**: `code` (Gate 2, ADR-019). **Fecha**: 2026-06-13 (sesión 25). **Analista**: security_analyzer.
**Input**: as-built del Run 1 (backend) sobre `main`. Diff respecto al baseline del implementer.
**Contra qué validé**: `progress/security_spec_09resto-dedup.md` (Gate 1 PASS) + `design-09resto-dedup.md §1.3` (checklist de controles).
**Moldes as-built comparados** (file:line): `transfer_animal` (0087), trigger inmutabilidad tag `tg_animals_block_tag_change` (0036:9-25), índice `animals_tag_unique` (0019:22-24), `has_role_in` (0005:9-25).

---

## VEREDICTO: **PASS** (0 findings HIGH)

El código del Run 1 implementa **fielmente** el contrato que Gate 1 aprobó. Los siete focos de auditoría cierran con evidencia file:line. La RPC `0089` es paridad exacta —y en un punto más limpia— del molde `transfer_animal` 0087 en los controles que importan (anti-IDOR derivado, authz-antes-de-dedup, idempotencia state-based sin columna nueva, guard NULL→valor, cierre de superficie tipado fail-closed, search_path fijo). El service cliente (`enqueueAssignTag` / `mapIntentToRpc` / `assignTagToAnimal`) es un passthrough delgado que NO introduce superficie nueva ni debilita el aislamiento de otros intents. La suite backend prueba lo que dice (no pasa por construcción): tiene el guard `assertRpcExists` anti-PGRST202 y verifica el efecto-nulo sobre el animal ajeno en el escenario IDOR. **Ningún HIGH. Ningún MEDIUM bloqueante.**

---

## Los 7 focos — verificación con evidencia file:line

### Foco 1 — Anti-IDOR efectivo en el código — **CIERRA**
- El UPDATE de (e) usa **SOLO `v_animal_id` derivado**, nunca un id del payload: `0089:91-93` → `update public.animals set tag_electronic = p_tag_electronic where id = v_animal_id and tag_electronic is null`. El cliente solo pasa `p_profile_id`/`p_tag_electronic`/`p_client_op_id` — ningún `animal_id` ni `establishment_id` viaja en la firma (`0089:38-42`).
- La derivación filtra `status='active' AND deleted_at IS NULL`: `0089:52-57`. Si no hay fila → `23503` (`0089:58-60`). Paridad exacta con `transfer_animal` `0087:82-92`.
- Ningún path lee un tenant/id del payload. `v_est` y `v_animal_id` salen exclusivamente del `select ... into` de la fila real (`0089:52-53`).
- Test que lo prueba (no por construcción): `run.cjs:3669-3686` — userA invoca sobre el perfil de estB; assert `42501` **y** assert `animals.tag_electronic IS NULL` del animal ajeno vía admin (`run.cjs:3684-3685`) → confirma efecto-nulo sobre la fila cross-tenant.

### Foco 2 — Authz ANTES de la dedup — **CIERRA (orden correcto en el SQL real)**
El orden real en el SQL es **(a) derivar → (b) authz `42501` → (c) formato → (d) dedup**:
- (b) `has_role_in(v_est)` en `0089:65-67` corre **ANTES** del `exists(...)` de idempotencia, que está en `0089:80-86`. Verificado por posición de línea: 65 < 80.
- Por lo tanto un caller de otro campo rebota en (b) con `42501` y **nunca llega a (d)** → no hay oráculo cross-tenant (no puede confirmar la existencia de un TAG en un animal ajeno). Esto es lo que Gate 1 marcó como load-bearing y el código lo respeta.
- Test: `run.cjs:3689-3701` (userC sin rol → 42501, animal sigue sin caravana).

### Foco 3 — Idempotencia state-based pura — **CIERRA (sin columna/tabla nueva, passthrough real)**
- Es state-based puro: el `exists` consulta `public.animals where id = v_animal_id and tag_electronic = p_tag_electronic` (`0089:80-83`) — estado ya aplicado, sin columna de idempotencia.
- **`p_client_op_id` NO se referencia en NINGUNA query**: aparece solo en la firma (`0089:41`) y en comentarios (`0089:23-24, 41-42`). Grepeado el cuerpo `begin...end` (`0089:49-106`): cero usos en SELECT/UPDATE/EXISTS. Passthrough real.
- **No se coló ninguna columna ni tabla nueva**: la migración 0089 es SOLO `create or replace function` + revoke/grant + smoke-check + notify (`0089:36-143`). No hay `alter table animals add column last_assign_op_id`, no hay `create table ... audit`. Confirmado: la migración no toca el schema de `animals` ni crea tablas.
- Test: `run.cjs:3704-3730` — reintento con el TAG ya aplicado → `replay:true` sin error; y el sub-caso clave (DA-1 condición de Gate 1) en `run.cjs:3727-3729`: un `client_op_id` DISTINTO sobre el MISMO estado también da `replay:true` → prueba que la dedup es por ESTADO, no por `client_op_id`.

### Foco 4 — Guard + race + dup + trigger 0036 — **CIERRA**
- `AND tag_electronic IS NULL` presente en el UPDATE: `0089:93`.
- `not found → 23514` (race accionable, distinguible del dup): `0089:98-100`.
- `23505` NO capturado → propaga: el cuerpo no tiene `exception when unique_violation`/`when others` en ningún lado (`0089:49-106` es un solo bloque `begin...end` sin handler). El UPDATE de (e) que viola `animals_tag_unique` propaga `23505` crudo de Postgres → `permanent_reject` en sync. Confirmado.
- **Trigger 0036 sigue siendo la barrera valor→valor (no se debilitó)**: `0036:9-25` intacto — `if old.tag_electronic is null then return new` (NULL→valor OK); `if new is distinct from old → 23514` (valor→valor y valor→NULL bloqueados). El RPC NO toca 0036; el guard `AND tag_electronic IS NULL` es defensa-en-profundidad ADICIONAL sobre el trigger, no un reemplazo. Doble barrera intacta.
- Tests: `run.cjs:3646-3666` (valor→valor → 23514, caravana original no se pisó), `run.cjs:3766-3775` (formato → 23514), `run.cjs:3732-3752` (dup global → 23505 del índice 0019).

### Foco 5 — Cierre de superficie — **CIERRA (paridad 0087, fail-closed)**
- `revoke execute ... from public, anon` + `grant ... to authenticated` con **firma tipada `(uuid, text, uuid)`**: `0089:124-125`. Idéntico patrón a `transfer_animal` `0087:276-277`.
- Smoke-check fail-closed idéntico a 0087: `0089:127-139` itera `unnest(array['anon','public'])` y `raise exception` si alguno tiene `EXECUTE` → el deploy aborta si quedara EXECUTE-able por anon/public. Espejo exacto de `0087:279-291`.
- `notify pgrst, 'reload schema'`: `0089:141`. `set search_path = public` en la definición: `0089:45`.
- **`anon`/`public` quedan SIN EXECUTE** (revoke explícito + smoke-check que falla el deploy si no). Test end-to-end: `run.cjs:3754-3764` (anon NO invoca → permission denied / 404).

### Foco 6 — Service cliente — **CIERRA**
- `enqueueAssignTag` (`outbox.ts:346-356`): encola SOLO `{ p_profile_id, p_tag_electronic }` (`outbox.ts:330, 353`) + SIN overlay (`outbox.ts:354-355`, correcto: `animals` no existe en el SQLite local, ADR-026 b1). No sanitiza ni filtra nada que deba — y NO debe: la validación autoritativa es 100% server-side en el RPC (`^\d{15}$` en `0089:71`). El cliente no es la barrera (sería attacker-controlled).
- El mapeo expone `p_client_op_id` de forma segura: `mapIntentToRpc` (`upload.ts:138-142`) reinyecta `p_client_op_id: op.id` (= id de la fila `op_intents`, generado por `crypto.randomUUID()` en `outbox.ts:43-45`) SOLO para `register_birth` y `assign_tag_to_animal`. No se expone ningún secreto ni input de usuario por ese canal — es un UUID de cliente, y server-side es passthrough (Foco 3).
- **`classifyIntentUploadError` nunca surfacea `sqlerrm` crudo (RD6.3)**: la función (`upload.ts:168-216`) clasifica por `code`/`status`/nombre-de-índice y devuelve un `IntentErrorDisposition` (`'transient' | 'idempotent_discard' | 'permanent_reject'`) — un enum, NO el mensaje. El `msg`/`details` se usan solo para *matchear* el caso de `register_birth` (`upload.ts:205-211`), nunca se re-emiten al usuario. El copy accionable lo arma la UI (fuera de este diff). Confirmado: el clasificador no es un canal de information disclosure.
- Sin input de usuario sin validación autoritativa server-side: el único input de dominio (`p_tag_electronic`) lo valida el RPC (`0089:71`); el `assignTagToAnimal` (`animals.ts:996-998`) es un passthrough thin sin transformar el tag.

### Foco 7 — Regresión de seguridad en `RPC_OP_TYPES` / `mapIntentToRpc` — **CIERRA (sin romper otros intents)**
- `RPC_OP_TYPES` (`upload.ts:35-53`): el cambio es **aditivo** — agrega `'assign_tag_to_animal'` (`upload.ts:52`) al Set existente. No remueve ni renombra ningún op_type previo.
- La rama de `p_client_op_id` (`upload.ts:138-141`) pasó de `opType === 'register_birth'` a `opType === 'register_birth' || opType === 'assign_tag_to_animal'`. Esto NO afecta a las demás firmas: `exit_animal_profile` / `soft_delete_*` / `create_rodeo` / `set_rodeo_config` siguen cayendo en la rama `: params` (sin `p_client_op_id`) — su comportamiento es idéntico al previo. Verificado: la condición solo agrega un OR para el op nuevo.
- `create_animal` mantiene su rama dedicada de traducción (`upload.ts:89-127`) sin cambios → el aislamiento de su mapeo no se tocó.
- El manejo de errores existente (`classifyIntentUploadError`) NO cambió para otros ops: el default `permanent_reject` (`upload.ts:215`) ya cubría `42501/23503/23514/23505`-de-dominio; `assign_tag` reusa ese default sin un case nuevo (correcto — el replay devuelve 2xx, no es error). Los cases idempotentes específicos (`P0002` de soft_delete, `23505` de register_birth) quedan intactos (`upload.ts:186-211`).
- Tests de regresión verdes: `run.cjs`-cliente (suite unit, 1017 tests, fail 0) incluye `mapIntentToRpc: assign_tag_to_animal → rpc con p_client_op_id` y `classifyIntentUploadError: assign_tag → permanent_reject; red → transient` — ambos PASAN.

---

## Validación de la suite backend (¿prueba lo que dice, o pasa por construcción?)

La suite `run.cjs:3575-3784` NO pasa por construcción. Evidencia:
- **Guard anti-falso-verde**: `assertRpcExists` (`run.cjs:3580-3584`) hace `assert.fail` si el error es `PGRST202` → impide que un "la función no existe" que casualmente contenga un código esperado haga pasar las aserciones por la razón equivocada. Llamado en TODOS los escenarios.
- **Verifica efecto, no solo el código de error**: cada escenario lee el estado real vía `admin` (service_role) DESPUÉS del error y asserta el efecto-nulo o el efecto-correcto: animal ajeno sin caravana en IDOR (`run.cjs:3684-3685`), caravana original no pisada en valor→valor (`run.cjs:3664-3665`), 2do animal sin TAG en dup global (`run.cjs:3750-3751`), TAG aplicado una sola vez en replay (`run.cjs:3722-3723`).
- **Cubre los 7 controles**: NULL→valor + propagación 0079 (esc.1), valor→valor (esc.2), anti-IDOR (esc.3), sin-rol (esc.4), idempotencia state-based incl. distinto client_op_id (esc.5), dup global (esc.6), grants anon fail-closed, formato, perfil inexistente.
- La suite FALLA hoy con PGRST202 (0089 no deployada) — **ESPERADO**, no es finding (patrón 0075-0088).

---

## False positives descartados (trazabilidad)

- **`select('*')` / over-fetching**: el RPC devuelve un `jsonb_build_object` cerrado de 4 campos del PROPIO animal derivado (`0089:84-85, 102-103`) → no hay over-fetch column-level. No aplica.
- **Mass assignment en el service**: `enqueueAssignTag` arma `{ p_profile_id, p_tag_electronic }` campo por campo (`outbox.ts:330, 353`), no spreea input del cliente. El `...params` de `mapIntentToRpc` (`upload.ts:140`) spreea un objeto que el propio cliente construyó con 2 claves fijas → no es over-posting de campos sensibles (no hay `role`/`establishment_id`/`id` server-controlled en juego; el RPC deriva todo eso server-side). Descartado.
- **`...params` en mapIntentToRpc como inyección de args extra**: teóricamente un `params_json` corrupto con claves extra llegaría a `supabase.rpc(args)`; PostgREST descarta args que no matchean la firma tipada `(uuid,text,uuid)` → claves espurias no se bindean a nada. Y el `op_intents` es local-only, escrito por el propio device (no attacker-controlled remoto). No explotable. Descartado.

---

## Tabla de inputs (campos que el cliente aporta a la op nueva)

| campo | límite | validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| `p_tag_electronic` | exactamente 15 díg (`^\d{15}$`, `0089:71`) + CHECK DB largo | **server autoritativa** (regex en RPC → 23514; el service no transforma) | sí |
| `p_profile_id` (uuid) | tipo uuid; perfil ACTIVO no-deleted del que se deriva tenant/animal (`0089:52-57`) | **server autoritativa** (tipo uuid + derivación de fila real → 23503) | sí |
| `p_client_op_id` (uuid) | tipo uuid; passthrough, NO ancla dedup (`0089:41`, sin uso en queries) | tipo uuid; no es vector (no se concatena, no se loggea, no se devuelve crudo) | sí |

Ningún campo de entrada sin límite + validación autoritativa server-side.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `assign_tag_to_animal` (RPC) | n.a. (no requerido) | — | sí (42501/23514/23505/23503 propagados) | UPDATE barato sobre `animals`, scopeado al propio campo (anti-IDOR + has_role_in), sin email/SMS/API externa/storage → no DoW. Guard NULL→valor + unicidad global limitan el daño a datos propios. Coincide con dictamen Gate 1 (LOW-1: límite per-establishment a futuro si se observa abuso). |

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia de cobertura)

- **PL/pgSQL (RPC SECURITY DEFINER)**: la skill de Sentry no cubre plpgsql/RLS nativamente → revisado **manualmente** contra el molde 0087 (anti-IDOR, authz-antes-de-dedup, propagación de errcodes, cierre de grants). Cubierto por revisión manual + paridad as-built.
- **PowerSync / sync set**: el chunk NO agrega stream ni policy; `animals` sigue fuera del sync set; el efecto baja por `animal_profiles.animal_tag_electronic` (trigger 0079, stream `est_animal_profiles` ya scopeada). Sin superficie de sync nueva — revisado manualmente.
- **Deno / Edge Functions**: este chunk no toca Edge Functions (es RPC en DB + service TS). N/A.
- **TypeScript (service cliente)**: `outbox.ts` / `upload.ts` / `animals.ts` son lógica pura sin input attacker-controlled remoto (el `op_intents` es local-only del propio device); el typecheck pasa (`tsc --noEmit` OK). Cubierto.

---

## Archivos analizados
- `supabase/migrations/0089_assign_tag_to_animal_rpc.sql` (superficie principal).
- `app/src/services/powersync/outbox.ts` (`enqueueAssignTag`, líneas 324-356).
- `app/src/services/powersync/upload.ts` (`mapIntentToRpc` + `RPC_OP_TYPES` + `classifyIntentUploadError`).
- `app/src/services/animals.ts` (`assignTagToAnimal`, líneas 974-998).
- `supabase/tests/animal/run.cjs` (suite assign_tag, líneas 3562-3784) — validada (no pasa por construcción).
- Moldes/barreras leídos para comparación: `0087` (transfer_animal), `0036` (inmutabilidad tag), `0019` (índice unique + grants), `0005` (has_role_in).

---

## MEDIUM / LOW (agrupados — no bloquean)
- **LOW-1 (rate limit a futuro)**: sin rate limit server-side en RPCs custom de Supabase. Para `assign_tag_to_animal` hoy NO es exploitable (escritura barata, scopeada al propio campo, sin DoW). Control natural a futuro: límite per-`establishment_id`. Ratifica el dictamen de Gate 1. No bloquea.
- **LOW-2 (audit del "quién")**: la asignación es regulatoriamente sensible (SENASA) e inmutable (0036). El `updated_at` (R12.4) cubre el "cuándo"; el "quién asignó" (`auth.uid()` registrado) es upgrade post-MVP ya contemplado. Heredado de Gate 1, no introducido por este código. No bloquea.

---

## Verificación de salud
- `node scripts/check.mjs` → **rojo, pero por flake conocido NO relacionado con este chunk**:
  - `tsc --noEmit` (typecheck client) → **OK**.
  - Suite unit cliente → **1017 tests, fail 0** (incluye los 2 tests nuevos de `mapIntentToRpc`/`classifyIntentUploadError` de assign_tag, ambos verdes).
  - Los 3 tests rojos son de `supabase/tests/edge/run.cjs` (`spec 13 — remove_member` / `change_member_role`, R10.1/R10.2), todos con `Error: ... Request rate limit reached` en `signIn` → flake de auth de Supabase por terminales paralelas (memoria "Check rojo = rate-limit"), **no es regresión de este chunk** (no tocan assign_tag ni nada del Run 1).
  - La suite `animal/run.cjs` de assign_tag FALLA con PGRST202 (0089 pendiente de deploy) → **ESPERADO**, no es finding.
- NO toqué código — solo escribí este reporte.
