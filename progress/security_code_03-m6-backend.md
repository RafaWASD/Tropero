# Gate 2 (security modo `code`) — Spec 03 / chunk M6-BACKEND (Circunferencia escrotal — US-14)

> **Veredicto: PASS.** Sin findings HIGH. La implementación de M6-BACKEND realiza **fielmente** el diseño
> que Gate 1 (`progress/security_spec_03-m6-circunferencia.md`, PASS, 0 HIGH) gateó, reusando tal cual los
> primitivos ya gateados (`0077` anti-spoof, `0052/0056` session tenant-check, `0054` gating fail-closed,
> patrón RLS de M5 `custom_measurements` contra la columna denorm forzada). No introdujo vectores
> cross-tenant / fail-open / anti-spoof nuevos a nivel código. Los 2 MEDIUM de Gate 1 fueron honrados
> en el código (label de surfacing + test (i) del session tenant-check). 1 nota MEDIUM (cobertura de test,
> no hueco) + 1 LOW (paridad as-built). **Habilitado para apply + Puerta 3 (humana).**

**Fecha**: 2026-06-17 (sesión 27). **Modo**: `code` (estático — SQL drafteado, NO aplicado todavía; la
confirmación empírica no-bypass es la suite POST-APPLY).

**Baseline**: `a03e593406da77096a239f7d54eb262ec1f9098f` (registrado en `progress/impl_03-m6-backend.md` l.1).

**Archivos analizados (in-scope M6-BACKEND)**:
- `supabase/migrations/0098_scrotal_measurements.sql` (untracked) — tabla typed + triggers + RLS + session FK.
- `supabase/migrations/0099_scrotal_data_key_and_seed.sql` (untracked) — data_key global + seed cría.
- `supabase/migrations/0100_scrotal_gating.sql` (untracked) — gating capa 2 fail-closed single-key.
- `supabase/tests/scrotal/run.cjs` (untracked) — suite no-bypass casos (a)–(i).
- `app/src/services/powersync/schema.ts` (uncommitted) — `Table scrotal_measurements` + registro en `Schema`.
- `app/src/services/powersync/upload-rejections.ts` (uncommitted) — `MANEUVER_TABLE_LABELS['scrotal_measurements']`.
- `sync-streams/rafaq.yaml` (uncommitted) — stream `ev_scrotal_measurements`.

**Fuera de alcance (ignorado por instrucción)**: `app/src/services/sigsa/`, `specs/active/08-*` (otra terminal);
el design spike de la rueda / cliente M6-C.0..C.2 (`CircunferenciaEscrotalStep.tsx`, `WheelPicker.tsx`,
`rueda-ce.tsx`, `wheel-picker.ts`, `haptics.ts` — otro chunk → su propio Gate 2).

**Metodología**: skill `sentry-skills:security-review` (carga del marco OWASP + data-flow) + checklist
RAFAQ-específico (RLS/Deno/PowerSync/triggers que la skill no cubre de origen). Cada trigger/policy/stream
del delta se trazó contra el **as-built real** de los primitivos reusados (NO contra la prosa del spec):
`0077` (`tg_force_establishment_id_from_profile`, l.53-71), `0052`/`0056` (`tg_event_session_tenant_check`,
0052 l.27-77 / 0056 l.1-14), `0054` (`assert_data_keys_enabled`, l.33-65), `0005` (`has_role_in`/`is_owner_of`).

---

## FINDINGS

### Sin findings HIGH.

Trazadas todas las cadenas cross-tenant / fail-open / anti-spoof del código aplicado contra el as-built,
ninguna queda abierta. La skill `sentry-skills:security-review` no reportó ningún HIGH sobre el delta
(coherente: el ataque vive en lógica de triggers/RLS/sync-rules de Postgres+PowerSync, no en los patrones
clásicos de la skill — eval/innerHTML/SQLi-por-interpolación/SSRF/secrets, ninguno presente). El delta no
concatena input de usuario en SQL (todo es CRUD-plano vía PostgREST, parametrizado), no devuelve `err.message`
crudo al cliente, no usa `createAdminClient()` en runtime de app, no hace `fetch()` externo, no toca auth/tokens.

---

## FOCOS VERIFICADOS OK (confirmación implementación vs diseño Gate-1) — trazabilidad

### Foco 1 — Anti-spoof REALIZADO (`establishment_id` + `recorded_by`) — OK

- **`recorded_by`** (`0098` l.63-72): `tg_scrotal_force_recorded_by` setea `new.recorded_by := auth.uid()`
  ignorando el payload. `security definer set search_path = public` + `revoke execute ... from public,
  authenticated, anon` (l.64, 69). `before insert` only — correcto: `recorded_by` se fija en la creación y
  no se re-pisa en la corrección del owner (R14.17). Verificado por test (b) (`run.cjs` l.434-449): el cliente
  intenta `recorded_by: userB.id` y la fila queda con `userA.id`. ✓
- **`establishment_id`** (`0098` l.77-79): reusa **literalmente** `tg_force_establishment_id_from_profile`
  (`0077` l.53-71), cableado `before insert or update`. Verificado contra `0077`: la función lee SOLO
  `new.animal_profile_id`, deriva `establishment_id` del `animal_profiles` real, lo pisa (`new.establishment_id
  := v_est`), y si el perfil no existe → `raise 23503`. El `before insert OR update` cierra el vector
  "pisar la columna con un UPDATE por PostgREST directo" (criterio que `0077` l.22-31 documenta como crítico
  para la frontera WAL). Verificado por test (b): el cliente intenta `establishment_id: estB` y la fila queda
  con `estA`. ✓
- **`SET NOT NULL` sin ventana de NULL** (`0098` l.83): `alter ... set not null` corre en la misma migración,
  **después** de crear el trigger force (l.77-79) y sobre tabla **nueva sin backfill** (nace vacía). El BEFORE
  INSERT siempre setea un valor no-NULL antes de evaluar el constraint. Cero ventana de NULL. ✓
- **Orden de firing de los 4 BEFORE INSERT** — sin hazard. Postgres dispara alfabético por nombre de trigger:
  `scrotal_force_establishment_id` < `scrotal_force_recorded_by` < `scrotal_gating` <
  `scrotal_measurements_session_tenant_check`. Verificado que ni `tg_scrotal_gating` (resuelve desde
  `new.animal_profile_id`) ni `tg_event_session_tenant_check` (resuelve desde `new.session_id`/
  `new.animal_profile_id`) leen las columnas forzadas → el orden no introduce dependencia. El RLS WITH CHECK
  corre DESPUÉS de todos los BEFORE → ve los valores ya forzados. ✓

### Foco 2 — RLS sin IDOR (SELECT/INSERT/UPDATE) — OK

`0098` l.95-104:
```sql
select  using (has_role_in(establishment_id) and deleted_at is null);
insert  with check (has_role_in(establishment_id));
update  using (is_owner_of(establishment_id) or recorded_by = auth.uid())
        with check (is_owner_of(establishment_id) or recorded_by = auth.uid());
```
- **INSERT WITH CHECK ve el `establishment_id` YA FORZADO**: el BEFORE INSERT corre antes del RLS WITH CHECK,
  así que un INSERT con `animal_profile_id` de otro tenant termina con el `establishment_id` del perfil real
  → `has_role_in` lo rechaza (verificado contra `has_role_in` `0005` l.9-25, que chequea los roles de
  `auth.uid()` contra el `establishment_id` de la fila + establishment no soft-deleted). Test (a) (`run.cjs`
  l.464-466): userB no puede INSERTar CE sobre un perfil de estA (`42501`/`23503`). Cross-tenant cerrado. ✓
- **SELECT**: `has_role_in(establishment_id) and deleted_at is null` — userB sin rol en estA ve 0 filas.
  Test (a) l.461-462. ✓
- **UPDATE (corrección R14.17) — NO es IDOR**: el `USING` se evalúa contra la fila **vieja** (pre-UPDATE) →
  un tercero que no es owner ni grabó la fila falla el `USING` → 0 filas afectadas, **nunca llega al WITH
  CHECK**. Por eso un UPDATE-spoof de `recorded_by := auth.uid()` en el payload NO le abre acceso: para
  pasar el `USING` ya tiene que ser owner o el grabador original. Espeja exacto `weight_events` (`is_owner_of
  OR created_by = auth.uid()`). Verificado por test (h): userD (sin rol) UPDATE → `[]` (l.520-521); userC
  (`recorded_by`) y userA (owner) sí corrigen (l.488-499). Cross-tenant imposible (ambos helpers atan al
  caller contra el establishment de la fila). ✓
- **Grants** (`0098` l.103-104): `grant select, insert, update on ... to authenticated` (no DELETE — soft-delete
  por UPDATE de `deleted_at`, append-only); `grant all ... to service_role` (estándar). ✓

### Foco 3 — Gating capa 2 FAIL-CLOSED realizado — OK

- `tg_scrotal_gating` (`0100` l.19-28): `before insert`, invoca `assert_data_keys_enabled(new.animal_profile_id,
  array['circunferencia_escrotal'])`. **Reusa el helper de `0054`** (no crea uno nuevo). Verificado contra
  `0054` l.33-65 que el helper es fail-closed por construcción: rodeo no resoluble (perfil inexistente o
  `deleted_at IS NOT NULL`) → `raise 23514` SIN early-return fail-open (l.42-46); data_key no-enabled →
  `v_have < v_need` → `23514` (l.60-64). Single-key entra limpio en el assert genérico (igual que
  `tg_weight_events_gating` con `['peso']`). ✓
- **SECURITY DEFINER + EXECUTE revocado** (`0100` l.20, 25): `security definer set search_path = public` +
  `revoke execute ... from public, authenticated, anon`. No es RPC (es trigger `returns trigger`). ✓
- **No-bypass por rol**: trigger BEFORE INSERT server-side → INSERT directo por PostgREST/sync/service_role
  sobre un rodeo disabled se rechaza. Test (c) (`run.cjs` l.343-386) ejerce: enabled OK / disabled `23514`
  por PostgREST directo / disabled `23514` por **service_role** (no-bypass) / perfil soft-deleted `23514` /
  perfil inexistente `23514|23503`. ✓

### Foco 4 — Session tenant-check: REUSO SANO + DISPARA EN INSERT (M6-SEC-02) — OK

Este es el foco de mayor riesgo de regresión y el que motivó el MEDIUM de Gate 1. Verificación a fondo:

- **El reuso es estructuralmente sano**: `tg_event_session_tenant_check` (`0052` l.27-77) lee SOLO
  `new.session_id` (l.36) y `new.animal_profile_id` (l.40, 43, 47-50 vía `establishment_of_profile` y SELECT
  a `animal_profiles`/`sessions`). **Ambas columnas existen** en `scrotal_measurements` (`0098` l.40, 42).
  La función NO toca ninguna columna específica de tabla (no lee `weight_kg`, `event_type`, etc.) → el reuso
  sobre la tabla nueva no rompe. ✓
- **CRÍTICO — la forma elegida SÍ dispara en INSERT (no recae en el bug de `0052`)**: `0098` l.91-93 usa
  `before insert or update` **SIN** `OF session_id`. El bug que `0056` arregló (l.3-9) era específicamente
  `before insert or update OF session_id` → la lista de columnas `OF` neutraliza el firing de INSERT,
  dejándolo efectivamente acotado a UPDATE-of-column → un INSERT cross-tenant pasaba SIN validar (bypass
  total). La forma de M6 (sin `OF`) **no** tiene esa cláusula → dispara en cada INSERT y en cada UPDATE.
  Es la semántica del trigger `_ins` del split de `0056` (`before insert`, l.24-26) más cobertura de UPDATE
  (más amplio = más seguro, solo re-valida de más). **Confirmado que M6 no replica el patrón roto.** ✓
- **Garantía empírica en el test**: test (i) (`run.cjs` l.550-592) prueba que el trigger dispara en INSERT
  vía contraste: OK con sessA (l.558-561) + reject `23514` con sessB cross-tenant (l.562-567) — si el
  trigger NO disparara en INSERT, el cross-tenant pasaría. Cubre además sesión `closed` → `23514` (l.569-574),
  rodeo distinto → `23514` (l.575-580), `session_id` NULL → OK (l.581-585), inexistente → `23503` (l.586-591).
  **Esto cierra el MEDIUM M6-SEC-02 de Gate 1.** ✓

### Foco 5 — SECURITY DEFINER (funciones nuevas) — OK

- `tg_scrotal_force_recorded_by` (`0098` l.63-69): `security definer set search_path = public` + EXECUTE
  revocado a public/authenticated/anon. ✓
- `tg_scrotal_gating` (`0100` l.19-25): idem. ✓
- Ambas `returns trigger` → ninguna es RPC invocable suelta. Las reusadas (`tg_force_establishment_id_from_profile`,
  `tg_event_session_tenant_check`, `assert_data_keys_enabled`) ya tienen `search_path=public` + EXECUTE
  revocado en sus migraciones de origen (verificado en `0077`/`0052`/`0054`). ✓

### Foco 6 — Seed global (`0099`) sin camino de cliente — OK

- El INSERT del data_key global (`establishment_id NULL`, `0099` l.27-31) corre como migración (service_role,
  `auth.uid()` NULL). El guard `tg_field_definitions_custom_guard` (`0093`) lo deja pasar por su primera rama
  `if auth.uid() is null then return new`; un cliente authenticated sigue rechazado (`establishment_id null
  → 42501` + policy INSERT exige `establishment_id is not null`). El seed **no le abre nada al cliente**. ✓
- El header de `0099` (l.8-21) traza fila a fila que el seed satisface todos los CHECKs de `0093`
  (data_type='maniobra' ∈ set, slug `^[a-z0-9_]+$`, len ≤64/≤500/≤80, `custom_ui_component_valid`/
  `custom_category_len` exentos por `establishment_id is null`) y no viola el UNIQUE parcial
  `field_definitions_data_key_global` (`circunferencia_escrotal` nuevo). Coherente con la verificación de
  Gate 1 Foco 5. Test (d)/(e) (`run.cjs` l.318-340) verifica el binding + el seed de cría enabled. ✓
- El CTE `fd` (l.42) apunta SOLO a la fila global recién creada (`establishment_id is null`) → no engancha
  una custom homónima. `sort_order = max+1` (l.45) — append al final de los defaults de cría. ✓

### Foco 7 — Frontera WAL del sync (`rafaq.yaml`) — OK

`ev_scrotal_measurements` (`rafaq.yaml` l.195-200):
```yaml
with: org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
queries: - SELECT * FROM scrotal_measurements WHERE establishment_id IN org_scope AND deleted_at IS NULL
```
- **Paridad EXACTA** con `ev_weight_events`/`ev_condition_score_events` (l.162-185): denorm `establishment_id
  IN org_scope`, JOIN-free, filtra `deleted_at IS NULL`. ✓
- `org_scope` con `active = true` + trigger `0076` (rol revocado / establishment soft-deleted → `active=false`)
  → un device sin rol activo NO recibe las filas de CE de ese campo (frontera WAL). ✓
- El `establishment_id` que el stream filtra es el **forzado** (Foco 1) → no se puede inyectar una fila a
  un scope ajeno por el WAL. Test (g) (`run.cjs` l.526-547) espeja el predicado: scopeA recibe la fila,
  scopeB (sin rol en estA) NO. ✓

### Foco 8 — Caps autoritativos server-side — OK

| input (cliente CRUD-plano) | cap server-side | dónde | OK |
|---|---|---|---|
| `circumference_cm` | `numeric(4,1)` + `CHECK >= 20 and <= 50` | `0098` l.43 | ✓ |
| `age_months` | `int` + `CHECK (null or 0..600)`, nullable | `0098` l.44 | ✓ |
| `notes` | `CHECK (null or char_length <= 500)` | `0098` l.51 | ✓ |
| `measured_at` | `date not null`, sin cota de rango | `0098` l.45 | ⚠️ LOW-1 (paridad as-built) |
| `session_id` | FK + tenant-check (Foco 4) | `0098` l.86-93 | ✓ |
| `establishment_id`/`recorded_by` | forzados por trigger (no son input) | `0098` l.77-83, 63-72 | ✓ |

El cliente Expo escribe por CRUD-plano → PostgREST → el CHECK de DB es la capa autoritativa (el sanitizador
de la rueda en RN es UX, bypasseable — y vive en el chunk cliente, fuera de este Gate). Test (f) (`run.cjs`
l.389-425) ejerce `<20`/`>50` reject, límites 20.0/50.0 OK, `age_months 601` reject + null OK, `notes 501` reject. ✓

### Foco 9 — La suite (b.5) prueba no-bypass real (no asserts vacíos) — OK

Revisé caso por caso que los asserts no sean triviales:
- (a) RLS: assert `deepEqual(seenB.data || [], [])` (no-ve) + `notEqual(badIns.error, null)` + `match` del
  SQLSTATE (`42501|23503|...`) — no vacío. l.461-466.
- (b) audit: lee la fila por **service_role** (no por el cliente que podría no verla) y `equal(row.recorded_by,
  userA.id)` / `equal(row.establishment_id, estA)` — verifica el efecto real del trigger, no solo "no error".
  l.443-449.
- (c) gating: cada sub-caso `notEqual(error, null)` + `match(pgcode, /23514|.../)` — el `match` ata el código,
  no acepta cualquier error. Incluye el sub-caso service_role (no-bypass). l.343-386.
- (i) session: el OK con sessA + reject con sessB es el contraste que **garantiza el firing en INSERT**
  (M6-SEC-02), no un assert hueco. l.558-591.
- (g) WAL: precondiciones `assert.ok(scopeA.includes(estA))` / `!scopeB.includes(estA)` antes de afirmar el
  set — no asume el scope. l.539-546.
- **Nota de cobverificación**: la suite corre POST-APPLY contra la DB remota → su verde es la confirmación
  empírica del no-bypass; en este Gate estático verifiqué que los asserts son sólidos y los códigos esperados
  correctos. ✓

---

### M6-CODE-01 (MEDIUM, no bloquea — cobertura de test, NO hueco) — el caso (b) no afirma el anti-spoof de `establishment_id` en el **UPDATE-path**

**Dónde**: `supabase/tests/scrotal/run.cjs` (b) audit forzado (l.428-450).

**Evidencia**: el caso (b) prueba el anti-spoof de `establishment_id`/`recorded_by` **en INSERT** (el payload
spoofeado se pisa). El trigger `scrotal_force_establishment_id` está cableado `before insert OR UPDATE`
(`0098` l.77-79) — la rama UPDATE es justamente la defensa que `0077` documenta como crítica para el WAL
(un caller con UPDATE permission pisando la columna con un campo ajeno por PostgREST directo). **No hay un
assert** que ejerza un `UPDATE scrotal_measurements SET establishment_id = <campo ajeno>` y verifique que el
trigger lo re-deriva al perfil real.

**Por qué MEDIUM (no HIGH) y por qué no bloquea**: el código **es correcto** — el trigger dispara en UPDATE
(la forma `before insert or update` sin `OF` lo garantiza, mismo análisis que Foco 4) y `0077` re-deriva el
valor del perfil inmutable. Además el vector está **doblemente cerrado**: para llegar a un UPDATE el caller
ya debe pasar el `USING` de la policy (`is_owner_of OR recorded_by`), y como `animal_profile_id` no cambia,
el force re-deriva el MISMO `establishment_id` → un owner de estA no puede mover su fila a estB ni aunque lo
intente. Es un gap de **cobertura de regresión**, no un hueco actual. La rama INSERT (el vector real del
cliente CRUD-plano) sí está cubierta.

**Remediación** (anotar para el implementer; se puede sumar a `run.cjs` (b) sin re-gatear): agregar un
sub-assert que, como owner de estA, intente `UPDATE ... SET establishment_id = estB` sobre una fila propia y
verifique por service_role que la columna sigue en estA. Espejo del precedente de `weight_events`/`0077`.

**Trazabilidad**: R14.9, `0077` l.22-31 (rama UPDATE anti-spoof).

---

## ANEXO — LOW (no bloqueante, paridad as-built)

### LOW-1 — `measured_at` sin cota de rango de fecha

`measured_at date not null` (`0098` l.45) no tiene `CHECK` de rango → admite `9999-12-31` / `1900-01-01`.
**Paridad exacta con el as-built** (`weight_events.weight_date`, `condition_score_events.event_date` son
`date not null` sin cota). No cruza tenants, no fuga, no bypassea gating — solo ensucia la tarjeta de
tendencia (intra-tenant, dato de baja calidad). Marcar M6 FAIL por esto sería inconsistente con la convención
del proyecto. Endurecer la convención de fechas de evento es transversal a las 5 tablas → `docs/backlog.md`
si interesa, no es de M6. (Ya registrado idéntico en Gate 1 LOW-1.)

---

## FALSE POSITIVES DESCARTADOS (trazabilidad)

La skill `sentry-skills:security-review` no emitió findings sobre el delta. Patrones que un escaneo
superficial podría marcar y por qué NO aplican aquí:

- **"`recorded_by` force es INSERT-only → spoof por UPDATE"**: descartado. El `USING` de la policy UPDATE
  se evalúa contra la fila vieja → un tercero falla el `USING` antes de poder pisar `recorded_by`; el
  payload `recorded_by := auth.uid()` no le abre acceso (Foco 2). Verificado por test (h) (userD → `[]`).
- **"reuso de trigger genérico de session en tabla nueva → posible bypass como 0052"**: descartado. La
  función lee solo columnas presentes y la forma `before insert or update` (sin `OF`) dispara en INSERT —
  no replica el bug de `0052` que `0056` arregló (Foco 4).
- **"seed global de `field_definitions` → mass-assignment / abre INSERT de cliente"**: descartado. El guard
  `0093` (`auth.uid() is null → return new`) deja pasar solo la migración; el cliente sigue rechazado
  (Foco 6).
- **"información disclosure por `raise ... 23514/42501`"**: descartado. Los raises van a logs de Postgres;
  el cliente ve el SQLSTATE (clasificado por el surfacing R10.8), no PII ni internals.

---

## Tabla de inputs (cada campo que el usuario tipea/elige en el delta M6-BACKEND)

| campo | límite | validación | OK? |
|---|---|---|---|
| `circumference_cm` (rueda) | `numeric(4,1)` + CHECK 20–50 | server (CHECK de DB) | ✅ |
| `age_months` (rueda meses, snapshot) | `int` + CHECK 0–600, nullable | server (CHECK de DB) | ✅ |
| `notes` (texto libre) | CHECK ≤500 | server (CHECK de DB) | ✅ |
| `measured_at` (date) | `date not null`, sin cota de rango | server parcial (NOT NULL + tipo `date`) | ⚠️ LOW-1 (paridad) |
| `session_id` (FK, del contexto) | FK + tenant-check `0052/0056` | server (FK + trigger) | ✅ |
| `establishment_id` / `recorded_by` | forzados por trigger (no son input) | server (trigger anti-spoof) | ✅ |
| data_key `circunferencia_escrotal` (seed, no input de cliente) | satisface CHECKs de `0093` | server (migración service_role) | ✅ |

Todos los campos que el operario tipea/gira (`circumference_cm`, `age_months`, `notes`) tienen cap
autoritativo server-side (CHECK de DB). El sanitizador de la rueda en RN es UX y vive en el chunk cliente.

## Tabla de rate limits (acciones abusables tocadas por el delta M6-BACKEND)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| INSERT `scrotal_measurements` (rol con `has_role_in`) | no | n.a. | n.a. | CRUD-plano offline-first (captura encolada offline → sync). Modelo igual a weight_events/custom_measurements; un rate limit server-side no aplica. Abuso real = storage, acotado por CHECK (`numeric(4,1)`, `notes ≤500`, `age_months int`) + RLS por establishment. **n.a. justificado.** |
| Sync stream `ev_scrotal_measurements` (PowerSync) | no (lo maneja PowerSync) | per-establishment (`org_scope`) | sí (scope vacío → 0 filas) | No es Edge Function custom; bucket model de PowerSync acota el fan-out. |

M6-BACKEND no manda email/SMS, no pega a API externa, no es bulk/import → **ninguna Edge Function que
requiera rate limit propio**. La superficie abusable real es storage, cubierta por los caps. ✓

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia de cobertura)

- **Deno / Edge Functions**: N/A — M6-BACKEND no crea ni modifica Edge Functions (sin `Deno.env.get`, sin
  `createAdminClient()` en runtime de app, sin imports `https://`). La skill de Sentry no cubre Deno de
  origen, pero no hay superficie Deno en este delta. ✓
- **RLS / triggers Postgres**: la skill `sentry-skills:security-review` NO razona sobre policies RLS,
  orden de firing de triggers BEFORE, ni semántica de `before insert or update OF column` — esa cobertura
  la aporté manualmente (Focos 1–6, trazados contra el as-built de `0077`/`0052`/`0056`/`0054`/`0005`). ✓
- **PowerSync sync rules (frontera WAL)**: tampoco la cubre la skill — la verifiqué a mano contra el patrón
  probado de las `ev_*` (Foco 7). La confirmación empírica del no-bypass es el caso (g) de la suite POST-APPLY. ✓
- **Naturaleza estática de este Gate**: las migraciones NO están aplicadas. Verifiqué que el código realiza
  fielmente el diseño gateado y que los asserts de la suite son sólidos; la confirmación empírica (la suite
  `scrotal/run.cjs` en verde) corre POST-APPLY, como documenta `impl_03-m6-backend.md` (hook comentado hasta
  que el leader aplique `0098/0099/0100` + deploye el YAML). El leader debe confirmar el verde de la suite
  tras el apply antes de cerrar la feature.

---

## Resumen para el leader

**Veredicto: PASS.** Sin findings HIGH. La implementación de M6-BACKEND **transcribe fielmente** el diseño
gateado en Gate 1 y reusa tal cual los primitivos ya gateados (`0077` anti-spoof INSERT+UPDATE, `0052/0056`
session tenant-check genérico que lee solo `session_id`/`animal_profile_id`, `0054` gating fail-closed
single-key, patrón RLS de M5 `custom_measurements` contra la columna denorm forzada). Cross-tenant, fail-open
y anti-spoof: todos cerrados y trazados contra el as-built a nivel código. El punto de mayor riesgo de
regresión (la forma `before insert or update` del session-check, que en `0052` causó un bypass total) está
**correctamente resuelto** (la forma sin `OF` SÍ dispara en INSERT) y **cubierto por el test (i)** — el MEDIUM
M6-SEC-02 de Gate 1 quedó honrado en el código. El surfacing R10.8 (`MANEUVER_TABLE_LABELS['scrotal_measurements']`)
también está, cerrando M6-SEC-01.

**1 MEDIUM (no bloquea, cobertura de test):**
- **M6-CODE-01**: el caso (b) de la suite no afirma el anti-spoof de `establishment_id` en el **UPDATE-path**
  (la rama está cableada y es correcta, pero sin assert de regresión). Sumar un sub-assert a `run.cjs` (b).

**1 LOW**: `measured_at` sin cota de fecha = paridad as-built; transversal a las 5 tablas → `docs/backlog.md`.

**Recordatorio de orden (no bloquea el veredicto)**: el deploy de `0098/0099/0100` + del YAML de PowerSync
lo gatea el leader con Raf (Supabase MCP en modo escritura). La suite `scrotal/run.cjs` corre POST-APPLY
(hook comentado); su verde es la confirmación empírica del no-bypass. **Gate 2 (security modo `code`) del
delta M6-BACKEND → PASS.** Habilitado para apply + Puerta 3 (humana).
