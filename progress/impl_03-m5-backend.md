# Impl — Spec 03 / chunk M5-BACKEND — datos/maniobras CUSTOM (delta schema + gating + RLS + sync)

baseline_commit: 7cfbea77705390f12205722b3849a304bff455f1

> Chunk **M5-BACKEND** (M5-B.1..B.6) de spec 03. **SECURITY-CRÍTICO**: reabre la RLS de
> `field_definitions` (catálogo global de spec 02) + 2 tablas nuevas + triggers SECURITY DEFINER +
> frontera WAL del sync. Gate 1 (security modo `spec`) **PASS** (`progress/security_spec_03-m5-custom.md`).
> Se TRANSCRIBE `design.md` §11 (SQL ya drafteado) a migraciones reales + suite de tests no-bypass.
> **NO se aplica ningún DDL** en esta corrida — el deploy a la DB compartida lo hace el LEADER con el
> OK de Raf, después del Gate 2. Los archivos quedan listos. El cliente (M5-CLIENTE) es otro chunk (Gate 2).

## Pre-condiciones (verificadas)
- Feature `03-modo-maniobras` = `in_progress` (feature_list.json). ✅
- Los 3 archivos del spec existen en `specs/active/03-modo-maniobras/` (requirements/design/tasks). ✅
- Gate 1 PASS sobre el delta M5 (`progress/security_spec_03-m5-custom.md`, RE-GATE 2026-06-13 → PASS, 5 findings cerrados). ✅
- `baseline_commit` de ESTE chunk = SHA previo a la primera task (`git rev-parse HEAD` = 7cfbea7...). El `impl_03-modo-maniobras.md` (chunk backend Fase 1/2) ya tiene su propio baseline; este chunk usa el suyo.

## Numeración de migraciones (re-confirmada contra el árbol)
- Último as-built = `0091_sanitary_gating_deworming_treatment.sql`. **0090/0091 = sanitary (otra feature)**.
- **0092 RESERVADA para spec-08** (otra terminal). NO se usa.
- M5 arranca en **0093**:
  - `0093_field_definitions_custom.sql` (B.1) — ALTER de `field_definitions` + reopen RLS + guard.
  - `0094_custom_measurements.sql` (B.2) — tabla append-only + audit forzado + RLS.
  - `0095_custom_attributes.sql` (B.3) — tabla current-value + audit forzado + RLS.
  - `0096_custom_gating.sql` (B.4) — gating genérico + validación de value (fail-closed) + triggers.
  - `0097_check_grants.sql` (B.5) — housekeeping grants/revokes + smoke check fail-closed.
- Sync delta (B.5) = `sync-streams/rafaq.yaml` + `app/src/services/powersync/schema.ts` (NO se deploya el YAML desde el repo).

> **Desviación de numeración vs design §11** (justificada): design §11 propone `0090..0094`, pero esos
> números fueron ocupados por sanitary (0090/0091) + reservados spec-08 (0092) entre la redacción del
> spec y esta corrida. El brief del leader lockea **M5 arranca en 0093**. Cero cambio de contenido —
> solo el prefijo numérico. Los comentarios de cada `.sql` referencian la sección de design que transcriben.

## Plan (T1..T4)
- **T1** — Escribir las 5 migraciones (B.1–B.5) transcribiendo design §11 con TODAS las propiedades de seguridad del security_spec. `[x]`
- **T2** — Suite de tests no-bypass `supabase/tests/custom/run.cjs` (casos a–m del fix-loop) + enganche en `run-tests.mjs`. `[x]`
- **T3** — Sync delta: `rafaq.yaml` (catalog global restringido + 3 streams custom) + `schema.ts` (columnas + 2 Tables). `[x]`
- **T4** — Autorrevisión adversarial M5-SEC-01..05 + `node scripts/check.mjs` (lo que corra sin DB) + reconciliación tasks.md (`[~]`). `[x]`

---

## Migraciones creadas (T1)

| Mig | Task | Qué implementa | Sección design |
|---|---|---|---|
| `0093_field_definitions_custom.sql` | M5-B.1 | `+ establishment_id` (NULL=global), `+ deleted_at`; drop UNIQUE global de `data_key` → 2 UNIQUE parciales (global / per-est, DM5-1); CHECKs INPUT-1 (`label`≤80, `config_schema`<4096, `data_key`≤64+slug, `description`≤500, `data_type` set cerrado, `category` custom≤32, `ui_component` custom ∈ los 7); `tg_field_definitions_custom_guard` (SECURITY DEFINER + revoke: bloquea alta global de cliente `42501`, fuerza `is_owner_of`, **inmutabilidad** de establishment_id/data_type/data_key/ui_component en UPDATE `42501`, `data_type` cliente ∈ maniobra/propiedad `42501`, cardinalidad≤50/largo≤60 de options `23514`); reopen RLS (SELECT globales-a-todos + custom-con-rol; INSERT/UPDATE owner-only no-global); `grant select,insert,update to authenticated`. | §11.1 |
| `0094_custom_measurements.sql` | M5-B.2 | tabla genérica append-only (`value jsonb`, `session_id` FK ON DELETE SET NULL, `notes`); CHECKs (`value`<4096, `notes`≤500); índices; `tg_custom_measurements_force_audit` (SECURITY DEFINER + revoke: fuerza `recorded_by=auth.uid()` + `establishment_id=establishment_of_profile(...)` anti-spoof); RLS canónico `has_role_in`. | §11.2 |
| `0095_custom_attributes.sql` | M5-B.3 | tabla genérica current-value (PK `(animal_profile_id, field_definition_id)`, `value jsonb`); CHECK `value`<4096; índices; `tg_custom_attributes_force_audit` (BEFORE INSERT/UPDATE: fuerza `updated_by`/`establishment_id`/`updated_at`); RLS canónico `has_role_in`. | §11.3 |
| `0096_custom_gating.sql` | M5-B.4 | `assert_custom_field_enabled` (rodeo inline, fail-closed `23514`, revoke) + `assert_custom_value_valid` (valida value por ui_component, **rama else fail-closed** `23514` para ui_component desconocido, `enum_multi` ≤50 seleccionados, revoke) + `tg_custom_measurements_gating` (BEFORE INSERT) + `tg_custom_attributes_gating` (BEFORE INSERT/UPDATE), ambos SECURITY DEFINER + revoke. | §11.4 |
| `0097_check_grants.sql` | M5-B.5 | re-afirma grants de las 3 tablas + revokes de las 6 funciones internas nuevas + smoke check fail-closed (raise si alguna SECURITY DEFINER quedó EXECUTE-able por authenticated/anon/public). | §11.5 (housekeeping) |

## Sync delta (T3 — frontera WAL, B.5)
- `sync-streams/rafaq.yaml`: `catalog_field_definitions` restringido a `WHERE establishment_id IS NULL` (R13.21) + 3 streams nuevas scope establishment (`est_field_definitions_custom`, `est_custom_measurements`, `est_custom_attributes`, `WHERE establishment_id IN org_scope`, JOIN-free; las que tienen `deleted_at` lo filtran). **El YAML NO se deploya desde el repo** — se pega en el dashboard → Validate → Deploy (lo gatea el leader).
- `app/src/services/powersync/schema.ts`: `field_definitions` Table + `establishment_id`/`deleted_at`; 2 Tables nuevas `custom_measurements`/`custom_attributes`; registradas en `AppSchema`. Guard en `schema.test.ts`.

## Suite de tests (T2) — ESCRITA, PENDIENTE DE APPLY
`supabase/tests/custom/run.cjs` (patrón heredado de `supabase/tests/maneuvers/run.cjs`: service_role para fixtures, JWTs reales para asserts de RLS/triggers/gating, cleanup por CASCADE). Casos (a)–(m) del fix-loop de Gate 1. Enganchada en `scripts/run-tests.mjs`.

> ⚠️ **La suite corre contra la DB REMOTA → NO se pudo correr en esta corrida** (las migraciones NO
> están aplicadas; el leader aplica post-Gate 2). Lo que SÍ se verificó: el SQL de las 5 migraciones
> es well-formed (parsea), el JS del test es válido (`node --check`), y `node scripts/check.mjs` corre
> lo que no depende del apply (typecheck + lint). **Los tests de la suite custom corren POST-APPLY.**

## Mapa R<n> → test (`supabase/tests/custom/run.cjs`)

| Requirement | Test (subtest) |
|---|---|
| R13.2 (creación owner-only) | (b) non-owner crea custom → `42501`/reject |
| R13.3 (establishment_id forzado al owner) | (b) INSERT con establishment_id ajeno → guard fuerza/rechaza; SELECT confirma el del owner |
| R13.4 (no alta global de cliente) | (b) `authenticated` crea con `establishment_id NULL` → `42501` |
| R13.14 (gating genérico fail-closed enabled) | (c) dato enabled en rodeo → OK; disabled → `23514` |
| R13.15 (gating independiente de la UI, PostgREST directo) | (c) INSERT directo sobre rodeo sin el field enabled → `23514` |
| R13.13 (captura = cualquier rol operativo activo) | (c) `userOp` field_operator (NO owner) captura sobre el dato enabled → OK + audit forzado (`recorded_by`=su uid, `establishment_id`=estA); (a)/(f) owner captura |
| R13.16 (validación de value por ui_component) | (d) numeric con texto → `23514`; enum fuera de options → `23514`; control válido → OK |
| R13.19 (soft-delete preserva measurements) | (i) bloque dedicado: enable field nuevo → carga 1 medición → soft-delete del `field_definitions` (UPDATE `deleted_at`) OK → la `custom_measurements` ya cargada SOBREVIVE (FK RESTRICT, no hard-delete) con su value intacto |
| R13.21 (frontera WAL: catálogo global solo NULL; custom scope est) | **(e) `supabase/tests/custom/run.cjs` test `(e) frontera WAL …`** (espejo de `sync_streams/run.cjs`): aplica el PREDICADO de cada stream con `service_role`+`orgScope(actor)` → (e.1) `catalog_field_definitions` solo `establishment_id IS NULL` (custom de estA NO entra; globales sí); (e.2) `est_field_definitions_custom` `IN org_scope` (`userA` con rol SÍ ve la custom; `userC` sin rol NO); (e.3) `est_custom_measurements` idem; (e.4) `est_custom_attributes` (PK compuesta) idem |
| R13.22 (RLS canónico tenant) | (a) userB sin rol → 0 filas en custom_measurements/custom_attributes; SELECT de field_definitions custom ajena → 0 (pero globales sí) |
| R13.23 (audit forzado recorded_by/updated_by) | (f) `recorded_by`/`updated_by`/`establishment_id` no spoofeables (payload con valores ajenos → quedan los forzados) |
| R13.25 (fail-closed ui_component desconocido + CHECK dominio) | (g) value sobre field ui_component fuera de los 7 → `23514`; (h) crear custom con `composite`/`whatever`/NULL → `23514`; global con `composite` → OK |
| R13.26 (inmutabilidad post-creación) | (i) UPDATE de establishment_id/data_type/data_key/ui_component de una custom → `42501`; label/config_schema/active/deleted_at → OK; owner A+B muda A→B → `42501` |
| R13.27 (caps/sets INPUT-1) | (j) data_type fuera del set / fuera del alta de cliente → reject; (k) data_key>64/no-slug, description>500, category>32 → reject |
| R13.17 (cardinalidad/largo de options) | (l) enum >50 opciones / opción >60 / options ausente o no-array → reject; ≤50 → OK; enum_multi con >50 seleccionados → `23514` |
| M5-SEC-05 (cap notes) | (m) custom_measurements.notes >500 → CHECK falla; ≤500 → OK |
| R13.24 (SECURITY DEFINER no expuestas como RPC) | 0097 smoke check + revoke en cada función; (n) authenticated NO puede `rpc(assert_custom_*)` |

---

## Autorrevisión adversarial (paso 8) — qué busqué como revisor hostil, qué encontré, cómo lo cerré

Repasé cada caso M5-SEC-01..05 contra el SQL real (no contra la prosa) + barrido de los vectores nuevos:

1. **M5-SEC-01 (value fail-open)** — busqué que `assert_custom_value_valid` NO caiga sin lanzar ante un
   `ui_component` raro. **Confirmado**: la rama `else raise ... 23514` está al final del `if/elsif` (0096
   l.~74-79). + el CHECK de dominio `field_definitions_custom_ui_component_valid` (0093 d.1) cierra la raíz.
   Doble barrera. Test (g)+(h).
2. **M5-SEC-02 (apropiación A→B vía WAL)** — busqué un UPDATE de `establishment_id` que escape la
   inmutabilidad. **Confirmado**: el guard compara `old.* is distinct from new.*` para los 4 ejes en
   `tg_op='UPDATE'` → `42501`. Caso owner-de-A+B cubierto por el test (i). El early-return `auth.uid() is null`
   NO es un hueco: solo cubre service_role/seed (backend trusted; PostgREST siempre porta auth.uid()).
3. **M5-SEC-03 (regresión INPUT-1)** — verifiqué cada columna recién-escribible: `data_key` (≤64+slug),
   `description` (≤500), `category` custom (≤32), `data_type` (set cerrado a nivel tabla + estrechado a
   maniobra/propiedad en el guard). Test (j)+(k).
4. **M5-SEC-04 (options sin cap)** — verifiqué cardinalidad ≤50 + cada opción ≤60 en el guard (creación) +
   `enum_multi` ≤50 seleccionados en `assert_custom_value_valid` (captura). Test (l).
5. **M5-SEC-05 (notes sin cap)** — `custom_measurements_notes_len check (... <= 500)` presente (0094). Test (m).

**Higiene SECURITY DEFINER (R13.24)** — grep confirmó: las 7 funciones nuevas tienen
`security definer set search_path = public` + `revoke execute from public, authenticated, anon` (en su
definición Y re-afirmado en el smoke check de 0097, que aborta si alguna quedó EXECUTE-able). Ninguna es RPC.

**Vectores que cacé y CERRÉ durante la autorrevisión**:
- **a)** El smoke check de 0097 distingue las funciones por **firma** (`pg_get_function_identity_arguments`),
  no solo por nombre — para no confundir `assert_custom_*` (con args) con triggers homónimos de otro schema.
  Las dos `assert_*` matchean su firma exacta; las 5 trigger functions matchean `''` (sin args). Evita un
  falso-OK si existiera otra función con el mismo nombre.
- **b)** Test (g): el value fail-closed se ejerce de verdad — referencia una field **global** con
  `ui_component='composite'` (que el CHECK de dominio NO restringe en globales, exentas), prendida en el
  rodeo, y captura sobre ella vía admin (saltea RLS) → el trigger corre el gating+validación y cae en el
  `else` → `23514`. El test EJERCE el path real, no matchea strings.
- **c)** Anti-spoof (f): el test manda `establishment_id`/`recorded_by`/`updated_by` AJENOS en el payload y
  verifica con `admin` (service_role, refleja el estado almacenado) que el trigger los pisó con el del perfil
  real / `auth.uid()`. Verifica el REJECT del spoofeo, no solo el happy-path.
- **d)** FK de `field_definition_id` SIN `on delete` (= RESTRICT): un dato custom se soft-deletea
  (`deleted_at`), nunca se hard-deletea → la RESTRICT preserva las measurements (R13.19). Al borrar el
  establishment, las measurements salen por su PROPIO `establishment_id ON DELETE CASCADE` (no por la field)
  → el cascade no se traba. Confirmado contra el patrón 0077 + el cleanup del test (delete establishments).
- **e)** Frontera WAL: el `catalog_field_definitions` quedó `WHERE establishment_id IS NULL` (sin esto, fuga
  total del catálogo custom). Las 3 streams custom scopean `establishment_id IN org_scope`. `establishment_id`
  en las 2 tablas de captura está DENORMALIZADO por trigger (no del payload) → el scope del wire es fiel.
- **f)** Multi-tenant: cero hardcode de `establishment_id`/`rodeo_id` en el SQL (siempre derivado del perfil
  o del owner). Los tests usan establishments/rodeos creados por fixture, nunca literales.

**Lo que NO pude verificar (y por qué)**: la suite `supabase/tests/custom/run.cjs` corre contra la DB REMOTA
y las migraciones NO están aplicadas (deploy gateado por el leader). La escribí completa + `node --check` OK.
Los asserts de gating/RLS/inmutabilidad se validan POST-APPLY. Lo que SÍ corrió verde en esta corrida:
`tsc` (typecheck cliente), las 174 unit de PowerSync (incl. `schema.test.ts` con la guard de 28 tablas),
`node --check` del test. `node scripts/check.mjs` rojo SOLO por un flake de terminal paralela en la **Animal
suite (spec 02)**: `animals_tag_unique` duplicate key en `'9'.repeat(64)` (otra terminal sembró el mismo tag
all-9 en el remoto compartido) — NO toca nada de mi chunk (mi diff backend son archivos NUEVOS no aplicados +
`schema.ts`/`rafaq.yaml`/`run-tests.mjs`).

## Reconciliación de specs (paso 9)
- **design.md §11**: agregué una nota AS-BUILT bajo el bloque de numeración — los números reales son
  `0093..0097` (0090/0091 = sanitary, 0092 reservada spec-08), el contenido es el de §11.1–§11.5 sin cambio,
  y el delta de sync (§11.5) vive en `rafaq.yaml`/`schema.ts` (no en una migración). DROP/CREATE INDEX/ADD
  CONSTRAINT de 0093 son transaccionables → un solo begin/commit (no hay ALTER TYPE).
- **tasks.md M5-B.1..B.6**: marcadas `[~]` ("ESCRITA … pendiente apply+tests remoto") con los números reales.
  NO `[x]` (no aplicadas ni testeadas en remoto). El enganche en `run-tests.mjs` quedó COMENTADO (lo
  descomenta el leader post-apply, patrón spec 12/14).
- **requirements.md (EARS)**: NO cambió. El *qué* (R13.1–R13.27 en su parte de backend) se cumple tal cual;
  no hubo desviación de comportamiento, solo el prefijo numérico de las migraciones (que no es un R).

## Desviaciones de design §11 (con justificación)
1. **Numeración 0090→0093** (única desviación): forzada por el árbol as-built (0090/0091 ocupadas, 0092
   reservada). Cero cambio de contenido. Lockeada por el brief del leader. Reconciliada en design §11.
2. **0097 = check_grants** (vs design que lo llamaba `0094_check_grants`): mismo rol/patrón (0055), solo
   el número. El smoke check distingue por firma (mejora menor sobre 0055 que distingue solo por nombre) para
   no colisionar con homónimos — justificado en la autorrevisión (a).
3. **Sync delta NO es migración**: design §11.5 ya lo dice (es `rafaq.yaml` + `schema.ts`); lo dejo explícito.
   El YAML NO se deploya desde el repo (dashboard → Validate → Deploy, lo gatea el leader).

## Fix-loop CR-1 del reviewer (2026-06-17) — SOLO tests + mapa, NO migraciones/YAML/schema

El reviewer marcó CHANGES_REQUESTED por un único item (CR-1): R13.21 (frontera WAL) sin test concreto +
el mapa R→test declaraba un caso **(e)** que NO existía en `supabase/tests/custom/run.cjs` (numeración
saltaba de (d) a (f) → test fantasma). Las 5 migraciones (0093–0097) quedaron correctas (Gate 2 PASS +
reviewer OK) → **no se tocó ninguna migración, ni `rafaq.yaml`, ni `schema.ts`**. Solo cambió la suite de
tests y los docs. Cambios aplicados:

1. **Subtest (e) real agregado** a `supabase/tests/custom/run.cjs` (entre (d) y (a)), espejando
   `supabase/tests/sync_streams/run.cjs`: simula el PREDICADO de cada stream con `service_role` (bypassa
   RLS) + `orgScope(actor)` = el SET que la stream le daría al device de ese actor. Es la frontera del
   **SYNC STREAM/WAL** (R13.21), capa distinta de la RLS de PostgREST que cubre (a)/R13.22 (el WAL ignora
   RLS/views/RPC, ADR-025). Helpers nuevos: `orgScope`, `catalogFieldDefSet`, `customSyncSetIds`,
   `customAttrSyncRows`. El test es AUTOCONTENIDO (siembra su propia medición + atributo de estA por
   `clientA`, no depende del orden de (a)/(c)). Asserta:
   - **(e.1)** `catalog_field_definitions` (`WHERE establishment_id IS NULL`): la field custom de estA NO
     entra; TODA fila del catálogo tiene `establishment_id NULL`; las globales de fábrica (ej. `peso`) SÍ.
   - **(e.2)** `est_field_definitions_custom` (`WHERE establishment_id IN org_scope`): `userA` (con rol en
     estA) SÍ recibe la custom de estA; `userC` (sin rol) NO la recibe y su set queda vacío (`deepEqual []`).
   - **(e.3)** `est_custom_measurements`: `userA` recibe (set no vacío, toda fila ∈ scopeA); `userC` NO recibe
     ninguna (`deepEqual []`).
   - **(e.4)** `est_custom_attributes` (PK compuesta, sin `deleted_at`): `userA` recibe el atributo de estA;
     `userC` NO recibe ninguno (`deepEqual []`).
2. **Mapa R→test corregido** (arriba): (e) ahora apunta al test REAL `(e) frontera WAL …` con sus 4 sub-asserts.
3. **Obs-1 (R13.13)**: nuevo actor `userOp` (field_operator, NO owner) en el setup; en (c) captura sobre el
   dato enabled → OK + verifica el audit forzado (`recorded_by`=su uid, `establishment_id`=estA). Antes los
   tests capturaban siempre como owner; ahora un rol operativo no-owner queda cubierto (la RLS es
   `has_role_in`, no `is_owner_of`).
4. **Obs-2 (R13.19)**: bloque dedicado al final de (i): enable un field nuevo → carga 1 medición →
   soft-delete del `field_definitions` (UPDATE `deleted_at`) OK → la `custom_measurements` ya cargada
   SOBREVIVE con su value intacto (FK `field_definition_id` SIN `ON DELETE` = RESTRICT + soft-delete = UPDATE,
   no hard-delete).

NO toqué Obs-3 (errcode 22007 vs 23514 — consistente código↔spec) ni Obs-4 (.claude.zip, higiene fuera de M5).

### Autorrevisión adversarial del subtest (e) — qué busqué, qué confirmé
- **¿Discrimina de verdad o pasa trivial?** El SET de estA NO es vacío (la siembra autocontenida lo garantiza),
  así que los asserts positivos (`userA` SÍ recibe) ejercen el path real; los negativos comparan contra el SET
  REAL de `userC` (`deepEqual []`), no contra un string. Si una stream custom fuera permisiva (sin
  `establishment_id IN org_scope`) o el catálogo no filtrara `IS NULL`, los asserts FALLARÍAN — verificado
  contra los predicados de `rafaq.yaml` l.59/234/241/249.
- **¿`userC` realmente sin scope?** `orgScope(userC)` = `[]` (nunca se le asignó rol) → `customSyncSetIds`
  devuelve `[]` por el guard `scope.length === 0` (mismo que `sync_streams/run.cjs:269`). Precondición
  asserteada explícitamente (`!scopeC.includes(estA)`).
- **¿Las globales SÍ entran al catálogo y las custom NO?** (e.1) afirma AMBAS direcciones: `!catalog.includes(custom)`
  + `peso ∈ catalog` + `every(establishment_id === null)`. No trivial (cubre el fail-open de fuga de custom y el
  fail-closed de bloquear globales).
- **¿Espejo fiel de la fuente?** `orgScope`/`customSyncSetIds` son el mismo SQL que `sync_streams/run.cjs`
  (`user_roles WHERE user_id AND active = true` + `WHERE establishment_id IN scope [AND deleted_at IS NULL]`).
  `custom_attributes` usa `withDeletedAtFilter=false`-equivalente (no tiene `deleted_at` propio, como en `rafaq.yaml` l.243).
- **Verificado**: `node --check supabase/tests/custom/run.cjs` OK. La suite sigue enganchada COMENTADA en
  `run-tests.mjs` (corre post-apply, no la descomenté). NO corre en este check (DB sin las tablas).

### Reconciliación de specs (CR-1)
- `tasks.md` M5-B.6: el caso (e) ya estaba descrito en el Detalle como "frontera WAL … test de modelo / a
  confirmar contra el dashboard"; ahora es un test REAL (espejo de `sync_streams/run.cjs`, corre post-apply).
  Actualicé el Detalle (e) para que diga "espejo de `sync_streams/run.cjs`, no a confirmar contra el dashboard"
  y agregué R13.13/R13.19 al `Satisface` (ya cubiertos por (c)/(i)).
- `requirements.md`: sin cambios — el *qué* de R13.13/R13.19/R13.21 no cambió; solo se cerró el hueco de cobertura.
- `design.md` §11: sin cambios — la frontera WAL (§11.5) ya estaba as-built en `rafaq.yaml`; (e) la TESTEA, no la altera.

## Fix-loop POST-APPLY (2026-06-17) — 2 fallas de la suite no-bypass contra el remoto (0093–0097 ya aplicadas)

El leader corrió `supabase/tests/custom/run.cjs` contra el remoto (migraciones aplicadas) → **2 fallas**.
Ambas arregladas. Es security-crítico (gating fail-closed + CHECK de un catálogo reabierto).

### FALLA 1 (h) — REAL GAP en `0093`: el CHECK `ui_component` NO rechazaba NULL para custom (hueco NULL-en-CHECK)
- **Causa**: `ui_component` es **NULLABLE** as-built (`0018` l.14, `text` sin NOT NULL). El CHECK viejo
  `establishment_id is null OR ui_component in (...)` para una fila custom (est NOT null) + `ui_component=NULL`
  evaluaba `false OR (NULL in (...))` = `false OR NULL` = **NULL** → un CHECK que da NULL **PASA** (SQL solo
  rechaza con FALSE). El test (h) inserta custom con `ui_component=NULL` esperando `23514` y no se rechazaba.
- **Fix (en `0093_field_definitions_custom.sql`, d.1)**: exigir no-null para custom →
  `check (establishment_id is null or (ui_component is not null and ui_component in (los 7)))`.
  Globales (est null) quedan exentas por el primer disyunto (intacto). Verificado con tabla de verdad
  tri-state (`node -e`): custom+NULL → RECHAZA; custom+los-7 → PASA; custom+composite/whatever → RECHAZA;
  global+(NULL|composite|silent_apply) → PASA (exenta).

#### Auditoría de los CHECKs/guards HERMANOS por el mismo patrón NULL-pasa (contra las NOT NULL de `0018`)
Clasifiqué cada columna por nullability as-built (`0018` l.7-20) y si un NULL de cliente evade una validación:

| Constraint/guard | Columna | NULL as-built | ¿Gap real? | Por qué |
|---|---|---|---|---|
| `field_definitions_custom_ui_component_valid` | `ui_component` | **NULLABLE** | **SÍ — ARREGLADO** | NULL-pasa: NULL evade el dominio de los 7 en custom. |
| `tg_..._guard` `data_type not in (maniobra,propiedad)` | `data_type` | NOT NULL (l.13) | NO | `data_type=NULL` lo rechaza el NOT NULL (`23502`) antes; el guard nunca ve NULL de cliente. |
| `field_definitions_data_key_len` / `_slug` (`data_key is null or …`) | `data_key` | NOT NULL (l.9) | NO | NULL rechazado upstream (`23502`); el `is null or` es rama muerta inofensiva. |
| `field_definitions_data_type_valid` (`data_type in (…)`, sin guard null) | `data_type` | NOT NULL (l.13) | NO | NOT NULL → NULL nunca llega; aunque diera NULL, el NOT NULL gana. |
| `field_definitions_custom_category_len` (`est is null or char_length(category) <= 32`) | `category` | NOT NULL (l.12) | NO | category siempre presente → `char_length` nunca NULL → para custom da `<=32` boolean real. |
| `field_definitions_label_len` (`label is null or …`) | `label` | NOT NULL (l.11) | NO | NULL rechazado upstream; `is null or` rama muerta. |
| `field_definitions_description_len` (`description is null or …`) | `description` | NULLABLE | NO (NULL legítimo) | description es texto OPCIONAL; un NULL es válido por diseño, no evade nada. |
| `field_definitions_config_size` (`config_schema is null or …`) | `config_schema` | NULLABLE | NO (NULL legítimo) | config_schema opcional; NULL válido por diseño. |

**Conclusión**: el ÚNICO gap real de NULL-pasa era `ui_component` (única columna NULLABLE cuyo CHECK
intenta acotar un dominio en vez de permitir un NULL legítimo). Las demás columnas acotadas son NOT NULL
(el NOT NULL es la barrera, no el `is null or`) o su NULL es legítimo (description/config_schema opcionales).

#### SQL CORRECTIVO EXACTO para el leader (0093 ya aplicada → NO re-aplicar entera; solo este delta)
```sql
begin;
alter table public.field_definitions
  drop constraint field_definitions_custom_ui_component_valid;
alter table public.field_definitions
  add constraint field_definitions_custom_ui_component_valid
    check (establishment_id is null
           or (ui_component is not null
               and ui_component in ('numeric','numeric_stepped','enum_single','enum_multi','text','boolean','date')));
commit;
```
(Solo `field_definitions`; sin `ALTER TYPE` → transaccionable. Las globales as-built con `ui_component`
NULL/composite/silent_apply NO violan el constraint nuevo → el `ADD CONSTRAINT` no aborta al re-validar.)

### FALLA 2 (c) — BUG de setup del test (NO del migration): soft-delete por CLIENTE no se aplicaba
- **Causa**: el setup (l.345) soft-deleteaba `profSoftDel` con `clientA.from('animal_profiles').update({deleted_at})`.
  PostgREST rechaza/no-opea ese UPDATE cuando la policy SELECT filtra `deleted_at is null` (la fila deja de
  ser visible tras el UPDATE; gotcha "Soft-delete vía RPC vs UPDATE", `CONTEXT/07-pendientes.md` l.106-108).
  → `profSoftDel` NO quedaba soft-deleted → `assert_custom_field_enabled` resolvía el rodeo (perfil "vivo")
  → el gating NO rechazaba → el assert fail-closed de (c) (l.420) fallaba.
- **Fix (test `run.cjs` setup)**: soft-delete por **`admin`** (service_role bypassa RLS → el UPDATE de
  `deleted_at` SÍ se aplica). Agregué assert de que el update no falló + verificación de que `deleted_at`
  quedó no-NULL (para que el test no vuelva a soft-deletear en silencio).
- **La lógica del migration es CORRECTA fail-closed**: `assert_custom_field_enabled` (`0096`) resuelve el
  rodeo `where deleted_at is null` → perfil soft-deleted ⇒ `v_rodeo NULL` ⇒ `raise … 23514`. No se tocó
  ningún migration por esta falla — era 100% setup del test.
- **Autorrevisión de los OTROS `deleted_at` por cliente del test** (l.621/645, sobre `field_definitions`):
  NO sufren el gotcha — la policy `field_definitions_select` (`0093` l.155-159) NO filtra `deleted_at is null`
  (filtra `est is null OR has_role_in`), así que la fila sigue visible al owner tras el soft-delete → el
  UPDATE por cliente SÍ se aplica. Esos tests (i) asertan correctamente que el soft-delete por cliente FUNCIONA.
  El único caso afectado por el gotcha es `animal_profiles` (cuya SELECT sí filtra `deleted_at is null`).

### Reconciliación de specs (fix-loop)
- `design.md` §11.1 d.1: agregada nota AS-BUILT del fix de NULL-pasa (el CHECK exige `ui_component is not null`
  para custom). El *qué* no cambió (custom solo los 7 de R13.8); se cerró el hueco de que `NULL` se colaba.
- `requirements.md`: sin cambios — R13.25 (dominio ui_component custom) ya exigía "uno de los 7"; el NULL
  nunca fue un valor válido de R13.25, solo escapaba por la mecánica del CHECK. Es un fix de implementación.
- `tasks.md`: sin cambios — M5-B.1 ya cubría el CHECK de dominio; el delta es una corrección del mismo CHECK.

### Verificación
- `node --check supabase/tests/custom/run.cjs` → OK.
- Tabla de verdad del CHECK corregido (tri-state SQL NULL) verificada por script: custom+NULL RECHAZA,
  los 7 válidos custom PASAN, globales (est null) PASAN con cualquier valor (incl. NULL/composite).
- **NO apliqué DDL/deploy** — el leader re-aplica el SQL correctivo de arriba + re-corre la suite.

## NO se aplicó NADA
No corrí `supabase db push`, ni `mcp apply_migration`, ni `execute_sql` de DDL, ni deploy del YAML de
PowerSync. Los 5 `.sql` quedan en `supabase/migrations/` listos; el deploy lo hace el LEADER con el OK de Raf
después del Gate 2. NO marco la feature `done` (eso es del reviewer + Gate 2 + Puerta 2).
