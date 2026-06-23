# Security review (Gate 2 / modo code) — Spec 02 Stream A: modelo de puesta en servicio

**Veredicto: PASS**

Auditoría de seguridad del SQL del delta backend (Stream A, spec 02). Migraciones **NO aplicadas** —
se audita el `.sql` en disco contra el as-built real (verificado archivo por archivo, no solo lo que
citan los comentarios). **0 findings HIGH.** El SQL está sano: authz owner-only real en las escrituras,
anti-IDOR hermético por derivación, guard `has_role_in` antes de toda lectura en las 3 funciones
DEFINER, cota `p_year` después del guard, smoke-checks fail-closed correctos, sin SQL injection /
search_path / privilege-escalation. `compute_category` (0104) es un diff quirúrgico verificado de 0062
que preserva todas sus propiedades de seguridad.

Cobertura: revisión MANUAL del SQL (la skill `sentry-skills:security-review` está orientada a app code
TS/JS/Python; el diff de este chunk es 100% PL/pgSQL + un test runner Node — ver §Cobertura). Auditoría
guiada por el catálogo RAFAQ dominios A (authz objeto/función, IDOR, service-role-bypass), E (queries sin
tope), F1 (injection en filtros), H (sesión/authz) y los focos del prompt.

---

## Alcance verificado (baseline + diff)

- `baseline_commit` = `980adf9` (registrado en `progress/impl_02-puesta-en-servicio.md:1`).
- `git status --porcelain` (no hay feature-branches; trabajamos sobre `main`): los **únicos** cambios
  son los 5 archivos a auditar, todos **nuevos** (untracked):
  - `supabase/migrations/0102_rodeo_service_months.sql`
  - `supabase/migrations/0103_create_rodeo_service_months.sql`
  - `supabase/migrations/0104_compute_category_drop_service.sql`
  - `supabase/migrations/0105_repro_denominator.sql`
  - `supabase/tests/puesta-en-servicio/run.cjs`
- `git diff --name-only 980adf9..HEAD` = vacío (los commits previos al baseline son la spec, no impl).
  Scope limpio: nada fuera de Stream A.

As-built confirmado contra disco (no asumido): `compute_category` 0062
(`0062_compute_category_rewrite.sql`), `rodeos`/RLS 0017 (`0017_rodeos.sql`), `create_rodeo` 0081
(`0081_create_rodeo_rpc.sql`), `set_rodeo_config` 0082 (`0082_set_rodeo_config_rpc.sql`),
`has_role_in`/`is_owner_of` 0005 (`0005_rls_helpers.sql`), `refresh_age_categories` + patrón
smoke-check 0066 (`0066_age_categories_cron.sql`), INPUT-1 0070 (`0070_check_text_length_caps.sql`),
enum `heifer_fitness_result` 0053 (`0053_tacto_vaquillona.sql`), `animal_profiles`
(`0020_animal_profiles.sql`).

---

## Findings HIGH

**Ninguno.**

---

## Foco 1 — Escritura de `service_months` (create_rodeo + set_rodeo_service_months) — SANO

### `create_rodeo` (0103) — DROP+CREATE de firma
- **Owner-only real**: `is_owner_of(p_establishment_id)` es el PRIMER statement del cuerpo
  (`0103_create_rodeo_service_months.sql:84-86`, errcode 42501), antes de cualquier escritura. Espeja
  `rodeos_insert = is_owner_of(establishment_id)` (`0017_rodeos.sql:53-54`). SECURITY DEFINER → la RLS
  no la protege; el guard sí. Idéntico a 0081. ✓
- **Anti-IDOR por colisión (guard c-bis)**: preservado literal de 0081
  (`0103...:125-130`). Si un owner manda un `p_id` que colisiona con un rodeo de OTRO tenant, el
  `INSERT ... ON CONFLICT (id) DO NOTHING` es no-op, y el guard exige que el rodeo con `p_id`
  pertenezca a `p_establishment_id` (ya autorizado) → 42501, sin tocar la config ajena. ✓
- **CHECK de columna + helper**: `service_months` se valida con `assert_service_months_valid`
  (`0103...:113`) Y queda respaldado por el CHECK autoritativo de columna
  `rodeos_service_months_valid` (`0102_rodeo_service_months.sql:31-42`). El cliente Expo escribe a
  PostgREST directo → el CHECK de DB es la capa autoritativa (regla INPUT-1, espejo 0070). ✓
- **`assert_service_months_valid` revocado / internal-only**: IMMUTABLE, `set search_path = public`,
  `revoke execute ... from public, anon, authenticated` (`0103...:46`). Los callers SECURITY DEFINER
  conservan EXECUTE porque corren como owner del schema (mismo patrón verificado en
  `refresh_age_categories`→`apply_auto_transition` de 0066 y `assert_data_keys_enabled` de 0054). ✓
- **Idempotencia**: `ON CONFLICT (id) DO NOTHING` (`0103...:118-120`) → un replay at-least-once no crea
  2do rodeo ni re-dispara el trigger de seed; protege también `service_months` (el replay no re-escribe
  la fila existente). ✓
- **DROP+CREATE no deja firma vieja con grant colgado ni overload ambiguo**: VERIFICADO con grep sobre
  todas las migraciones — existen exactamente DOS firmas de `create_rodeo`: la vieja de 6 args (0081) y
  la nueva de 7 args (0103). `0103...:63` hace `drop function if exists public.create_rodeo (uuid, uuid,
  text, uuid, uuid, jsonb)` (la firma vieja EXACTA) antes del CREATE de 7 args. Tras el apply queda solo
  la firma de 7 args → sin overload ambiguo en PostgREST, y el grant viejo desaparece con la función.
  Re-grant explícito sobre la firma nueva: `revoke ... from public, anon` + `grant ... to authenticated`
  (`0103...:160-161`). ✓
- **Smoke-check de grants**: `0103...:224-254` (parte ii) verifica fail-closed que `create_rodeo` y
  `set_rodeo_service_months` NO sean EXECUTE-ables por anon/public (raise→abort si lo son). ✓

### `set_rodeo_service_months` (0103) — edición offline
- **Anti-IDOR por derivación (hermético)**: `v_est` se DERIVA del rodeo
  (`0103...:182-184`, `select establishment_id ... where id = p_rodeo_id and deleted_at is null`), NO es
  parámetro. Luego `is_owner_of(v_est)` (`0103...:192`). Un `p_rodeo_id` de otro tenant →
  `is_owner_of(est ajeno)=false` → 42501 sin tocar nada. Idéntico patrón a `set_rodeo_config`
  (`0082_set_rodeo_config_rpc.sql:57-70`). No hay forma de divergir est-autorizado vs rodeo-objetivo. ✓
- **Owner-only**: 42501 para field_operator/vet/sin-rol (espeja `rodeos_update = is_owner_of`,
  `0017_rodeos.sql:56-58`). ✓
- **Validación + CHECK**: `assert_service_months_valid(p_service_months)` (`0103...:199`) + CHECK de
  columna (defensa en profundidad). NULL short-circuitea en el helper (`0103...:26-28`). ✓
- **Idempotencia**: `update ... set service_months = p_service_months` (`0103...:202`) — re-aplicar el
  mismo array es no-op natural (RPS.3.6). No necesita client_op_id. ✓
- **Rodeo inexistente/soft-deleted** → P0002 (`0103...:185-187`). Revoke anon/public + grant
  authenticated (`0103...:214-215`). ✓

---

## Foco 2 — 3 funciones de derivación SECURITY DEFINER (0105) — SANO

Funciones: `rodeo_service_campaign`, `rodeo_serviced_females`, `rodeo_repro_denominator`.

- **Guard `has_role_in` ANTES de leer**: en las 3, el orden es
  `select v_est from rodeos` → `v_est is null` check → **`has_role_in(v_est)` (42501)** → cota p_year →
  query de datos. Líneas: campaign `0105_repro_denominator.sql:35-43`; serviced `0105...:101-106`;
  denominator `0105...:196-200`. El DEFINER NO saltea authz: el guard interno es el control real (la RLS
  no aplica a una SECURITY DEFINER). ✓
- **Cota `p_year` TRAS el guard (RPS.5.10)**: en las 3, `if p_year < 1900 or p_year > extract(year from
  current_date)::int + 1 then raise ... '22023'` está DESPUÉS de `has_role_in`. Líneas: `0105...:46-48`,
  `0105...:108-110`, `0105...:202-204`. Un caller no autorizado pega contra 42501 antes de cualquier
  manejo de año → `make_date(...)` nunca recibe años absurdos, y no hay oráculo de comportamiento por la
  cota. Foldea Gate 1 MEDIUM-1. ✓
- **IDOR cross-tenant → 42501**: el guard `has_role_in(v_est del rodeo)` cierra el tenant; un owner B
  contra un rodeo de A da false → 42501. Cubierto por test (`run.cjs:668-677`, owner B → 42501 en las 3).
  Defensa en profundidad adicional: los CTEs filtran `p.establishment_id = v_est` (`0105...:120`, `:156`)
  además del `p.rodeo_id = p_rodeo_id`. ✓
- **Revoke anon/public + grant authenticated**: `0105...:227-232` para las 3. Correcto que sea
  `has_role_in` (no `is_owner_of`): cualquier rol activo del establecimiento puede LEER reportes
  (espeja `rodeos_select = has_role_in`, `0017_rodeos.sql:50-51`); test field_operator-de-A-puede-leer
  (`run.cjs:679-682`). ✓
- **Read-only / STABLE**: las 3 son `language plpgsql security definer stable` y solo ejecutan SELECTs
  (no INSERT/UPDATE/DELETE en ningún path). Test de no-mutación (`run.cjs:696-705`). ✓
- **La elegibilidad no filtra otro tenant**: las dos ramas de `rodeo_serviced_females` (eligible_natural
  `0105...:113-146`; ai_females `0105...:147-165`) están ancladas a `p.rodeo_id = p_rodeo_id` +
  `p.establishment_id = v_est`; todos los sub-selects de elegibilidad (heifer_fitness, fallback edad, IA)
  van por `rv.animal_profile_id = p.id` del mismo perfil tenant-scopeado. No hay join que cruce a otro
  establecimiento. `rodeo_repro_denominator` delega en `rodeo_serviced_females` (que re-guarda el tenant)
  y hace el join `retired` sobre el conjunto ya scopeado (`0105...:206-211`). ✓

---

## Foco 3 — `compute_category` (0104) — SANO (diff quirúrgico verificado vs 0062)

Comparación line-by-line `0062_compute_category_rewrite.sql` ↔ `0104_compute_category_drop_service.sql`.
ÚNICAS diferencias ejecutables (las 3 que el header de 0104 declara):
1. `0062:25` declara `v_has_service boolean;` → ELIMINADA en 0104 (`0104...:50` comentario).
2. `0062:42-44` `select exists (...event_type = 'service'...) into v_has_service;` → ELIMINADO.
3. `0062:93-94` rama vaquillona `elsif v_has_weaning or v_has_service or (v_age_days >= 365)` →
   `0104...:115` `elsif v_has_weaning or (v_age_days is not null and v_age_days >= 365)` (solo se quitó
   el término `or v_has_service`).

Preservado IDÉNTICO (propiedades de seguridad RPS.4.6):
- `security definer stable` + `set search_path = public` (`0104...:40-41`, igual a `0062:15-16`). ✓
- `grant execute on function public.compute_category (uuid) to authenticated` (`0104...:129`), SIN grants
  nuevos (igual a `0062:108`). ✓
- Contrato de retorno intacto: `return (select id from public.categories_by_system where system_id =
  v_system_id and code = v_target_code and active = true limit 1)` (`0104...:124-126`). Mismo tipo (uuid),
  misma fuente. ✓
- Sin lectura/escritura cross-tenant: deriva todo del `profile_id` recibido vía joins
  `animal_profiles → animals → rodeos` (`0104...:54-59`); no hay parámetro de tenant ni query a otra
  fila/establecimiento. La función solo LEE (no muta). ✓
- Precedencia LOAD-BEARING de ramas, rama macho (cortes 1/2 años, is_castrated), conteo de PARTOS
  (`event_type='birth'`, nunca terneros), tacto+ vigente (RT2.7.5): byte-idénticos. ✓

Nota (no es finding de seguridad, es de deploy): el header de 0104 (`0104...:26-35`) documenta la
regresión de datos al aplicar (categorías guardadas no se recalculan auto; único caso real = hembra
<365d con service/IA sin destete sin tacto+). Es una consideración de **datos**, no de seguridad, y ya
está en la checklist del leader (`impl_02...:125`). Sin impacto en authz/exposición.

---

## Foco 4 — Smoke-checks fail-closed — SANOS (no fail-open)

Tres smoke-checks, todos con la misma forma fail-CLOSED (la PRESENCIA de un grant prohibido aborta la
migración vía `raise exception`; el silencio = OK):

1. `0103...:227-238` (parte i): `assert_service_months_valid` NO EXECUTE-able por authenticated/anon/
   public → si lo es, `raise exception 'grant check FAILED ... internal-only'`. ✓
2. `0103...:240-251` (parte ii): `create_rodeo`/`set_rodeo_service_months` NO EXECUTE-ables por
   anon/public → si lo son, raise→abort. ✓
3. `0105...:237-252`: las 3 funciones del denominador NO EXECUTE-ables por anon/public → raise→abort. ✓

Patrón idéntico al control PRINCIPAL de seguridad de `refresh_age_categories`
(`0066_age_categories_cron.sql:63-79`). Lógica correcta: itera los `(proname, rolname)` que TIENEN el
privilegio prohibido; si el loop encuentra una fila, lanza. No hay forma de que un grant indebido pase
silencioso. ✓

---

## Foco 5 — SQL injection / search_path / privilege escalation — SANO

- **SQL injection**: ninguna de las funciones usa SQL dinámico (`EXECUTE`/`format()`/concatenación de
  strings en queries). Todo es SQL estático con parámetros tipados. El único input de usuario que entra a
  una cláusula de filtro es `p_service_months smallint[]` (tipado, solo pasa por `unnest`/`cardinality`/
  `= any(...)`) y `p_year int` (tipado, acotado). `extract(month from rv.event_date)::int = any(v_months)`
  (`0105...:162`) es parametrizado, no interpolado. No aplica el dominio F1 (filter injection en `.or()/
  .filter()`) — eso es del cliente PostgREST, no de estas RPC. ✓
- **search_path**: las 4 funciones nuevas + las 3 de 0105 + las 2 RPC de 0103 + el helper TODAS declaran
  `set search_path = public` (anti search_path hijacking en SECURITY DEFINER). Verificado: `0103...:24,
  75, 176`; `0104...:41`; `0105...:32, 98, 193`. ✓
- **Privilege escalation**: las SECURITY DEFINER corren como owner del schema. El riesgo clásico
  (función DEFINER expuesta que muta cross-tenant, tipo el IDOR catastrófico que 0066 documenta para
  `refresh_age_categories`) NO existe acá: las escrituras tienen guard owner-only ANTES de mutar; las
  lecturas tienen guard `has_role_in` ANTES de leer; el helper de validación es internal-only (revocado)
  y es IMMUTABLE/void (no muta). Ningún grant nuevo a service_role/postgres expuesto a cliente. ✓

---

## Foco extra — Calidad del test (no verde-falso / cubre caminos de seguridad)

La suite `supabase/tests/puesta-en-servicio/run.cjs` NO es verde-falso y cubre los caminos de seguridad:

- **No-bypass**: usa **JWTs reales** (`getUserClient` con `signInWithPassword`, ANON_KEY) para los
  asserts de authz/RLS, y service_role SOLO para fixtures/verificación de estado (`run.cjs:15-16, 91-98`).
  Mismo patrón que las suites `animal`/`maneuvers`. Los asserts de seguridad pasan por el cliente
  authenticated, no por el admin → ejercitan los guards reales. ✓
- **Caminos de seguridad cubiertos con asserts duros**:
  - owner-only de `set_rodeo_service_months`: field_operator → 42501 **y** verifica que NO tocó nada
    (`run.cjs:393-400`). ✓
  - anti-IDOR write: owner A con `rodeoB.id` → 42501 **y** rodeo B intacto (`run.cjs:401-409`). ✓
  - anti-IDOR read: owner B contra rodeo de A → 42501 en las 3 funciones (`run.cjs:668-677`). ✓
  - tenant-positivo: field_operator de A SÍ lee el denominador (`run.cjs:679-682`). ✓
  - cota p_year: futuro/1800 → 22023 en las 3 (`run.cjs:684-694`). ✓
  - CHECK de columna: rango/dup/≤12, NULL≠{}, bordes (`run.cjs:258-325`). ✓
  - re-validación en RPC: create {13} → 23514, set {0} → 23514 (`run.cjs:353-362, 417-422`). ✓
  - read-only: conteo de perfiles invariante tras las 3 (`run.cjs:696-705`). ✓
  - enum cerrado: 4º valor de heifer_fitness → error (`run.cjs:738-744`). ✓
- **Riesgo de verde-falso mitigado por el implementer** (documentado en `impl_02...:110`): corrigió un
  `if (w && w.id)` que saltaba un assert en silencio → assert duro `assert.ok(w && w.id)` (`run.cjs:506`);
  y rediseñó RPS.4.5 a un caso DISCRIMINANTE (<365d) que distingue "service ignorado" de "service contado"
  (`run.cjs:490-512`) — un test ≥365 habría pasado por la razón equivocada (vaquillona por edad igual).
  Revisado: el rediseño es correcto. ✓
- **Roja-hasta-apply** (esperado): la suite corre contra el remoto y las migraciones no están aplicadas →
  falla hasta el apply; su hook en `scripts/run-tests.mjs` queda COMENTADO (`run.cjs:18-21`). Patrón
  documentado 0075-0082/0093-0097. No es un problema de seguridad. El leader la DESCOMENTA post-apply y
  la suite verde confirma el contrato no-bypass.

---

## False positives descartados / por qué no son HIGH

- **"P0002 (rodeo not found) se evalúa antes de `has_role_in` → oráculo de existencia cross-tenant"**:
  en las 3 funciones de 0105 y en `set_rodeo_service_months`, el `v_est is null`/`if not found`→P0002
  precede al guard de rol, así que un caller no autorizado puede distinguir "el rodeo no existe" (P0002)
  de "existe pero no tenés rol" (42501). **Descartado como HIGH/finding bloqueante**: (a) es el patrón
  EXACTO y ya-aceptado del as-built `set_rodeo_config` (`0082...:57-62`: not-found→P0002 antes del
  authz), o sea consistencia con el baseline, no regresión; (b) los `p_rodeo_id` son UUIDs generados por
  cliente (no enumerables); (c) no expone NINGÚN dato de la fila ajena, solo existencia de un UUID que el
  atacante ya tendría que conocer. Queda como **LOW informativo** abajo. Si se quisiera cerrar el oráculo,
  habría que mover el `has_role_in` antes del not-found (devolviendo 42501 también para rodeos
  inexistentes) — pero eso DESVIARÍA del patrón establecido y debería decidirse a nivel de convención,
  no en este chunk.
- **"La rama AI de `rodeo_serviced_females` con rodeo `service_months=NULL` igual cuenta la IA"**
  (`0105...:162-164`): es una decisión de PRODUCTO documentada (la IA es dato real per-vaca de la
  campaña-año), no un bug de seguridad — sigue tenant-scopeada (`p.rodeo_id`+`p.establishment_id`). No es
  finding.
- **`createAdminClient()` / service-role-bypass (dominio A1)**: N/A — este chunk no agrega Edge
  Functions ni código que use service-role; el `admin` del test runner es para fixtures (test-only), no
  es superficie de producción.

---

## Tabla de inputs (campos de entrada nuevos/modificados que llegan al backend)

| campo | límite | validación | OK? |
|---|---|---|---|
| `create_rodeo.p_service_months` (smallint[]) | rango 1-12, sin dup, ≤12 elems; NULL/{} válidos | **server autoritativa**: `assert_service_months_valid` (0103:113) + CHECK columna `rodeos_service_months_valid` (0102:31-42) | ✓ |
| `set_rodeo_service_months.p_service_months` | idem | **server autoritativa**: helper (0103:199) + CHECK columna | ✓ |
| `create_rodeo.p_name` (text) | no vacío, ≤120 chars | **server**: guard en RPC (0103:90-95) + CHECK `rodeos_name_len_chk` (0070:170) | ✓ (sin cambio vs 0081) |
| `rodeo_*.p_year` (int) | 1900 .. current+1 | **server**: cota en las 3 funciones tras el guard (0105:46/108/202) | ✓ |
| `create_rodeo.p_toggles` (jsonb) | array; entradas con field_definition_id no-null | **server**: guard jsonb + nullif (0103:134-141) + CHECK tamaño `rodeo_data_config_custom_config` (0070) + FK | ✓ (sin cambio vs 0081) |

Todos los campos de entrada que toca el delta tienen límite claro + validación AUTORITATIVA server-side
(RPC guard y/o constraint de DB). El cliente Expo (attacker-controlled, escribe a PostgREST directo) no
es el control. **Cumple el requisito de Raf (límite + validación server por cada campo).**

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `create_rodeo` (RPC) | n.a. | n.a. | n.a. | No manda email/SMS, no pega a API externa, no es bulk/fan-out. Escribe 1 rodeo + sus toggles (acotado por jsonb size 0070). Idempotente por id. Mismo perfil de riesgo que el as-built 0081. |
| `set_rodeo_service_months` (RPC) | n.a. | n.a. | n.a. | 1 UPDATE de una columna acotada (≤12 smallints por CHECK). No abusable a escala. |
| `rodeo_service_campaign` / `rodeo_serviced_females` / `rodeo_repro_denominator` (RPC read) | n.a. | n.a. | n.a. | Read-only, scopeadas a UN rodeo del tenant del caller (no listado masivo cross-tenant). El conjunto está acotado por la membresía del rodeo. No es endpoint de costo (sin email/SMS/API/storage). El cap de filas natural es la población del rodeo; no hay enumeración cross-tenant (guard has_role_in). |

Ninguna acción del diff cae en las clases que exigen rate-limit propio (email/SMS, API externa,
bulk/import). El Auth nativo (`[auth.rate_limit]` en `config.toml`) NO se toca en este chunk (verificado:
el diff no incluye `config.toml`). N/A justificado.

---

## Archivos analizados

- `supabase/migrations/0102_rodeo_service_months.sql` (columna + CHECK + comment)
- `supabase/migrations/0103_create_rodeo_service_months.sql` (helper + create_rodeo DROP+CREATE +
  set_rodeo_service_months + grants/revokes + smoke-check)
- `supabase/migrations/0104_compute_category_drop_service.sql` (compute_category diff quirúrgico)
- `supabase/migrations/0105_repro_denominator.sql` (3 funciones de derivación + grants/revokes +
  smoke-check)
- `supabase/tests/puesta-en-servicio/run.cjs` (suite no-bypass)
- As-built de referencia (lectura para verificar preservación de propiedades): 0062, 0017, 0081, 0082,
  0005, 0066, 0070, 0053, 0020.

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia de cobertura)

- **Skill `sentry-skills:security-review` NO ejecutada**: está orientada a app code (TS/JS/Python, OWASP
  injection/XSS/authn). El diff de este chunk es 100% PL/pgSQL + un test runner Node sin lógica de
  producción. Correrla sobre `.sql` daría señal pobre / falsos negativos. La auditoría fue **manual,
  guiada por el catálogo RAFAQ** (dominios A/E/F/H) y los focos del prompt — el ángulo correcto para SQL
  DEFINER + RLS + multi-tenant. Declarado explícitamente: **el SQL no recibe cobertura automatizada de la
  skill; la revisión manual es el control.**
- **RLS**: las 5 funciones nuevas son SECURITY DEFINER → la RLS NO las protege; el control es el guard
  interno (`is_owner_of` en escrituras, `has_role_in` en lecturas) + los smoke-checks de grants.
  Verificado que los guards espejan exactamente las policies de `rodeos` (0017). El delta NO agrega ni
  modifica policies RLS de tablas (solo funciones + 1 columna + 1 CHECK).
- **PowerSync**: NO cubierto por este chunk (correctamente). `impl_02...:128` anota la dependencia: al
  construir el selector de Stream B hay que incluir `service_months` en el `AppSchema` de PowerSync (como
  columna TEXT del rodeo) y revisar la sync rule para que `service_months` no se replique cross-tenant.
  **Eso es revisión de seguridad C1 (sync rules) que corresponde al chunk de PowerSync/Stream B, no a
  este.** No es un hueco de este delta (la columna aún no la lee ningún cliente), pero queda como
  recordatorio para el Gate 2 de ese chunk futuro.
- **Deno / Edge Functions**: N/A — este chunk no toca `supabase/functions/`.

---

## Lista corta MEDIUM / LOW (no bloquean — informativos)

- **LOW-1 (oráculo de existencia)**: en las 3 funciones de 0105 (y en `set_rodeo_service_months`), el
  check `rodeo not found → P0002` precede al `has_role_in/is_owner_of`, permitiendo a un caller no
  autorizado distinguir "UUID no existe" de "existe pero sin rol". No exploitable (UUIDs no enumerables,
  cero datos de la fila ajena expuestos) y **consistente con el patrón ya-aceptado del as-built
  `set_rodeo_config` 0082**. Si en algún momento se quiere cerrar el oráculo, evaluar mover el guard de
  rol antes del not-found a nivel de CONVENCIÓN (afecta varias RPC, no solo estas) — fuera de scope de
  este chunk.
- **LOW-2 (recordatorio cross-chunk, no de este delta)**: cuando Stream B/PowerSync exponga
  `service_months` al cliente, su Gate 2 debe revisar la **sync rule** (dominio C1): que `service_months`
  se replique SOLO a la SQLite del tenant dueño del rodeo (la RLS de `rodeos` ya lo cubre del lado
  Postgres, pero PowerSync es authz PARALELA). Anotado para no perderlo; no es hueco de este chunk.

---

**Conclusión**: el SQL de Stream A está sano desde seguridad. Authz owner-only real en escrituras,
anti-IDOR hermético por derivación, guard `has_role_in` antes de toda lectura, cota `p_year` post-guard,
smoke-checks fail-closed correctos, sin injection/search_path/priv-esc, y `compute_category` preserva
todas las propiedades de 0062. La suite ejercita los caminos de seguridad con JWTs reales y asserts
duros. **PASS.** (La decisión final de aprobar/aplicar es de Raf — este gate solo confirma que no hay
huecos de seguridad que bloqueen.)
