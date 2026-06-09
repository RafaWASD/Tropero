baseline_commit: 1618a9566037eeca65cf2fa8841c86379ba35809

# Implementación — 15-powersync

> Run 1: cimientos del cliente + YAML de streams. NO swap de services, NO backend, NO deploy.
> Feature multi-run; este archivo acumula todos los runs. `baseline_commit` = SHA previo a la 1ra task.

## Run 1 — alcance EXACTO (cerrado 2026-06-08)

Tasks de este run: **T1.1, T1.2, T1.3, T1.4, T1.5, T1.7, T1.8, T2.1** (+ la BASE de T1.6 dentro de connector.ts).
- T1.6 `upload.ts` completo NO en este run; el connector lleva SOLO la base de CRUD plano + stubs `// TODO Run T6` para op_intents→RPC/overlay/idempotencia.
- T2.2 (Gate 1) ya PASS; T2.3 (deploy) lo hace el leader/Raf.

### Plan (T1..Tn) — todas hechas

- [x] T1.1 — deps + whitelist pnpm
- [x] T1.2 — env + .env.example
- [x] T1.3 — schema.ts (AppSchema)
- [x] T1.4 — database.ts (factory + singleton)
- [x] T1.5 — connector.ts (fetchCredentials + uploadData base)
- [x] T1.7 — provider.tsx + montaje en root
- [x] T1.8 — status.ts
- [x] T2.1 — sync-streams/rafaq.yaml (no deploy)

## Archivos creados

| Archivo | Qué |
|---|---|
| `app/src/utils/env-resolve.ts` | PURO: `resolveEnv(reader)` (R1.2/R1.3). |
| `app/src/services/powersync/schema.ts` | `AppSchema` (26 sync + op_intents insertOnly + 5 pending_* localOnly). |
| `app/src/services/powersync/platform-select.ts` | PURO: `pickPowerSyncPackage(os)` (R2.2). |
| `app/src/services/powersync/database.ts` | Factory por plataforma + singleton lazy `getPowerSync()`. |
| `app/src/services/powersync/upload-classify.ts` | PURO: `buildCredentials` (R3.1) + `isTransientUploadError`/`isPermanentServerCode` (R3.4/R3.5). |
| `app/src/services/powersync/connector.ts` | `SupabaseConnector` (fetchCredentials + uploadData base CRUD plano + stubs Run T6). |
| `app/src/services/powersync/status-derive.ts` | PURO: `deriveSyncUiState`/`syncStatusLabel` (R10.1). |
| `app/src/services/powersync/status.ts` | I/O: lee SyncStatus + cola; one-shot + subscribe. |
| `app/src/services/powersync/provider.tsx` | `<PowerSyncProvider>` (PowerSyncContext + connect/disconnect por sesión). |
| `sync-streams/rafaq.yaml` | 26 sync streams (no deployado). |
| `.env.example` | Plantilla de env (incl. `EXPO_PUBLIC_POWERSYNC_URL`). |
| Tests | `env-resolve.test.ts`, `platform-select.test.ts`, `upload-classify.test.ts`, `status-derive.test.ts`, `schema.test.ts`. |

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `app/src/utils/env.ts` | Delega en `resolveEnv`; agrega `powersyncUrl`. |
| `app/package.json` | +4 deps; `@journeyapps/wa-sqlite` en `onlyBuiltDependencies`. |
| `app/app/_layout.tsx` | Monta `<PowerSyncProvider>` dentro de `AuthProvider`, envolviendo los providers de datos. |
| `scripts/run-tests.mjs` | Registra los 5 test nuevos en la suite client unit. |
| `specs/active/15-powersync/{design,tasks}.md` | Reconciliación as-built (ver abajo). |

## Versiones de deps instaladas (T1.1)

- `@powersync/react-native@1.35.3`
- `@powersync/web@1.38.2`
- `@powersync/react@1.10.0`
- `@journeyapps/wa-sqlite@1.7.0` (peer WASM de @powersync/web)
- `@powersync/common@1.53.2` (peer transitivo resuelto, una sola versión)

`@journeyapps/wa-sqlite` tiene un `postinstall` que baja el PowerSync core WASM (`libpowersync.wasm`,
`libpowersync-async.wasm`) → whitelisteado en `onlyBuiltDependencies` (ADR-011). Los demás paquetes
PowerSync NO tienen install scripts. El peer nativo `@journeyapps/react-native-quick-sqlite` NO se
instaló: solo lo precisa el bundle native (dev build Android, diferido); el bundle web no lo pulla
gracias al `require()` guardado por `Platform.OS` en database.ts.

## Decisiones de criterio propio (sobre todo sintaxis del SDK vs design)

1. **PK de las 3 tablas especiales → alias `id` EN LA STREAM** (resuelve "decisión-abierta-PK"). Verificado
   contra `@powersync/common` 1.53.2: el SDK agrega una columna `id` TEXT implícita a cada tabla y
   PROHÍBE declarar una `id` propia; las filas sincronizadas DEBEN traer un `id`. → las streams emiten:
   `self_user_private` = `SELECT user_id AS id, *`; `est_rodeo_data_config` = `SELECT (rodeo_id||':'||field_definition_id) AS id, *`;
   `ev_birth_calves` = `SELECT (birth_event_id||':'||calf_profile_id) AS id, *`. design §2 mostraba `SELECT *`
   para esas 3 → **reconciliado** (§2 + §PK). En AppSchema esas tablas declaran sus columnas as-built
   como normales (sin `id`); el `id` implícito porta el aliased/sintético. Son read-only locales → el
   `id` sintético NO entra a uploadData.

2. **`fetchCredentials` DEVUELVE null sin sesión (no throw).** design §4 mostraba `throw AppError('no_session')`.
   El contrato del SDK (`PowerSyncBackendConnector`) es: "Return null if the user is not signed in; throw
   ONLY for network/temporary errors". Con throw, el SDK lo trataría como transitorio y reintentaría en
   loop sin sesión. → seguí el contrato del SDK. **Reconciliado** en design §4.

3. **Lógica pura separada en módulos sin I/O** (`env-resolve`, `platform-select`, `upload-classify`,
   `status-derive`) para testear bajo `node:test` (no puede cargar módulos que importen RN/expo/supabase/SDK).
   Espeja el patrón del repo (`exit-animal.ts` ↔ `animals.ts`). **Reconciliado** en design §1.1.

4. **`@powersync/common` SÍ carga bajo node** (es JS puro) → el test de `schema.ts` ejercita el SDK REAL
   (`AppSchema.validate()` + `toJSON()`), no un mock. Mejor que un test de forma a mano.

5. **Factory por `require()` guardado por `Platform.OS`** (no `import` estático de ambos SDKs): un import
   estático de `@powersync/react-native` rompería el bundle web (arrastra el peer nativo). Mismo patrón que
   `services/ble/feedback.ts`.

6. **Singleton lazy** (`getPowerSync()` crea en el 1er acceso, no en import-time): no bootea el WASM/RNQS
   de más; el boot real lo dispara el provider al conectar. `status.ts` usa default arg `= getPowerSync()`
   (call-time) → importar status.ts no bootea el DB.

7. **`@journeyapps/wa-sqlite` pin exacto + whitelist** (ADR-011) por su postinstall.

## Stubs marcados para Run T6 (NO implementados en Run 1)

- `connector.ts::uploadData()` — si aparece una CrudEntry de `op_intents` → `throw` con `// TODO Run T6`
  (NO se procesa como CRUD plano: sería incorrecto). El mapeo `op_intents`→`supabase.rpc(...)`, el overlay
  optimista (`pending_*`), la idempotencia (`client_op_id`) y el rollback son Run T6 (R6.8–R6.12).
- `upload.ts` y `outbox.ts` (design §1.1) NO se crearon (Run T6).
- El swap de los 9 services (lectura/escritura local) NO se tocó (Runs T3–T6).
- La migración del delta backend (`reproductive_events.client_op_id`, ≥0075) NO se escribió (Run 2, leader).
- El deploy de `rafaq.yaml` NO se hizo (leader/Raf).

## Trazabilidad R<n> → test (Run 1)

| R<n> | Cobertura | Test |
|---|---|---|
| R1.2 (env powersyncUrl) | `resolveEnv` arma el set con las 3 vars | `utils/env-resolve.test.ts` :: "R1.2: con las 3 vars presentes" |
| R1.3 (error accionable si falta) | falta/vacío → Error es-AR que nombra la var + .env.local | `env-resolve.test.ts` :: "R1.3: falta…", "R1.3: vacío…", "R1.3: faltan Supabase…" |
| R2.1 (AppSchema espeja sync) | valida con el SDK; 26 tablas + op_intents + 5 overlay; PII fuera de users | `services/powersync/schema.test.ts` (8 tests) |
| R2.2 (factory por plataforma) | web→web, ios/android→native, desconocido→native | `services/powersync/platform-select.test.ts` (3 tests) |
| R3.1 (fetchCredentials) | con sesión → {endpoint,token}; sin sesión/token → null | `services/powersync/upload-classify.test.ts` :: "R3.1: …" (3 tests) |
| R3.4 (transitorio → reintento) | red/5xx/429 → transitorio; sin señal → conservador transitorio | `upload-classify.test.ts` :: "R3.4: …", "sin señal…" |
| R3.5 (permanente → descarta) | 42501/clase 23/4xx → permanente | `upload-classify.test.ts` :: "R3.5: …" (3 tests) |
| R6.8 (outbox insertOnly) | `op_intents` insert_only=true, no localOnly | `schema.test.ts` :: "R6.8: outbox op_intents es insertOnly" |
| R6.11/R6.12 (overlay localOnly) | `pending_*` localOnly=true, con client_op_id; sync tables no localOnly/insertOnly | `schema.test.ts` :: "R6.11/R6.12: …", "R6.8/R6.12: …" |
| R10.1 (estado de sync UI) | conectado/sincronizando/pendientes + copy + defaults seguros | `services/powersync/status-derive.test.ts` (8 tests) |
| decisión-abierta-PK | las 3 especiales NO declaran `id`; mantienen columnas componentes | `schema.test.ts` :: "PK especial: …" |

> R2.3 (provider montado), R2.4 (boot WASM live, T7.4) y R3.2 (refresh live) quedan **verificados por
> typecheck + montaje** y **DIFERIDOS a la validación LIVE** (necesita Instance URL en `.env.local` +
> streams deployadas). El código está wireado. R4.1–R4.11 (streams) las cubre el test de no-bypass T7.2
> (Run posterior) + el Gate 1 PASS ya emitido sobre `rafaq.yaml`.

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:
- **Desviaciones del spec**: las 2 desviaciones reales (alias `id` en stream; fetchCredentials→null) están
  reconciliadas en design ANTES de cerrar (no quedan specs contradictorias). El YAML es byte-faithful al
  design §2 gateado (verifiqué las 26 streams, el predicado canónico, el owner-gate MED-1 de est_members,
  el `ur.active` LOW-1 de la query 1, los 3 alias de id).
- **Bugs/edge cases**: `deriveSyncUiState` clampa pendingCount a ≥0 entero y tolera status null/undefined
  (testeado). `buildCredentials` trata token ''/null/ausente como "sin sesión" (testeado). `isTransientUploadError`
  es conservador (sin señal → reintenta, no descarta un dato de campo a ciegas) — testeado.
- **Seguridad**: el connector NUNCA loguea token/sesión/opData (solo table+op+code en el rechazo). Las
  RPCs/upserts re-validan authz server-side (R6.2) — el connector no bypassa. La outbox/overlay son
  write-side/local-only, sin superficie de stream/RLS (no se hace `from('op_intents')`). El `op.table` de
  `supabase.from()` no es injection (es un nombre de tabla del AppSchema, no SQL libre). `EXPO_PUBLIC_*`
  es público por diseño (RLS/streams protegen). Sin hardcode de `establishment_id` (scoping por
  `auth.user_id()` en las streams).
- **Encontrado y corregido**: (a) dead code en provider.tsx (`cancelled` sin uso) → eliminado. (b) Guard de
  `op_intents` en el connector base: si entrara una (no debería en Run 1), NO se mis-aplica como CRUD plano
  → throw marcado Run T6 (se reintenta, no se descarta el intent — safe). (c) Trampa latente: nunca escribir
  localmente las 3 tablas de `id` sintético (un upsert con ese id fallaría server-side) → documentado en
  schema.ts y design §PK como nota para Run T6.
- **Tests por la razón correcta**: el test de schema ejercita el SDK real (validate/toJSON), no un mock;
  el de credenciales verifica el null real (no solo el happy path); el de clasificación verifica que un
  rechazo permanente NO se reintenta (caso reject), no solo el transitorio.

Re-verificación tras los fixes: `node scripts/check.mjs` → verde (exit 0).

## Reconciliación de specs (paso 9)

- design **§2** — `self_user_private`/`est_rodeo_data_config`/`ev_birth_calves`: `SELECT *` → `SELECT … AS id, *`.
- design **§PK** — decisión-abierta-PK marcada RESUELTA: alias en la stream; nota anti-write para Run T6.
- design **§4** — `fetchCredentials`: throw → return null sin sesión (contrato del SDK).
- design **§1.1** — nota as-built: módulos puros (`*-resolve`/`platform-select`/`upload-classify`/`status-derive`);
  `upload.ts`/`outbox.ts` son Run T6; el `uploadData` base vive en connector.ts con stubs marcados.
- `tasks.md` — T1.1–T1.5/T1.7/T1.8/T2.1 marcadas `[x]` con nota *(Run 1)*; T1.6 con nota (base en connector,
  resto Run T6).
- requirements.md — sin cambio de "qué" (el comportamiento de R1/R2/R3/R10 es el especificado; las 2
  desviaciones son de mecanismo/sintaxis, no de requirement) → solo design/tasks reconciliados.

## Resultado de check.mjs

`node scripts/check.mjs` → **verde (exit 0)**: typecheck cliente OK, lint anti-hardcode OK, client unit
tests (incl. los 33 nuevos) OK, RLS / Edge / Animal / Maneuvers / User_private / Import suites OK.
"All tests passed." / "Entorno listo."

## Pendiente para Raf / leader (NO bloquea el cierre del run)

- Agregar `EXPO_PUBLIC_POWERSYNC_URL` (Instance URL de rafaq-beta) a `.env.local` (raíz) **y** `app/.env.local`
  para que la app boote y conecte. Sin esa var, `getEnv()` falla con el error accionable (por diseño).
- Deploy de `sync-streams/rafaq.yaml` a la instancia (dashboard → Validate → Deploy) — gateado.
- Validación LIVE en web (boot WASM + sync real, T7.4) tras lo anterior.

---

## Run 2 — delta de backend de idempotencia (`register_birth`), T6.4 + T7.7

> Único delta de backend de la feature. Aprobado en Puerta 1, gateado a nivel spec (Gate 1 DELTA PASS tras cerrar HIGH-D1).
> **`baseline_commit` NO se sobreescribe** (feature multi-sesión): sigue siendo el SHA previo a la 1ra task (Run 1) = `1618a956…`.

### Plan (T6.4 + T7.7) — todas hechas

- [x] T6.4 — `supabase/migrations/0075_register_birth_idempotency.sql` escrita (NO aplicada al remoto).
  - (1) `ALTER TABLE reproductive_events ADD COLUMN IF NOT EXISTS client_op_id uuid` (nullable; históricos NULL).
  - (2) índice UNIQUE compuesto parcial `reproductive_events_client_op_id_uq (animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` (COMPUESTO, NO global — fix HIGH-D1).
  - (3) `DROP FUNCTION register_birth(uuid,date,jsonb)` + `CREATE FUNCTION register_birth(uuid,date,jsonb,uuid default null)` con el guard idempotente SCOPEADO al caller. Cuerpo as-built de 0045 intacto + `client_op_id` en el INSERT del evento.
  - (4) `revoke ... from public, anon` + `grant execute ... to authenticated` con la firma de 4 args.
  - (5) `notify pgrst, 'reload schema';`.
- [x] T7.7 (sub-bullet `register_birth`) — `supabase/tests/animal/run.cjs` :: suite top-level `spec 15-powersync — register_birth idempotencia (delta T6.4, T7.7)` con setup propio + 3 casos.

> **El leader aplica la migración por Management API tras gatear el SQL.** Los tests NUEVOS FALLAN hasta entonces (ESPERADO). NO `supabase db push`.

## Run 2 — cómo quedó

### El guard idempotente (predicado de scoping exacto)

Dentro de `register_birth`, DESPUÉS de derivar `v_est` de la fila REAL de la madre y validar `has_role_in(v_est)` (as-built 0045:213-225, sin cambios):

```sql
if p_client_op_id is not null then
  select re.id into v_existing_id
  from public.reproductive_events re
  join public.animal_profiles p on p.id = re.animal_profile_id
  where re.client_op_id     = p_client_op_id
    and re.animal_profile_id = p_mother_profile_id   -- misma madre que el intent
    and p.establishment_id   = v_est                 -- y del tenant ya autorizado (has_role_in pasado)
    and re.deleted_at is null
  limit 1;
  if v_existing_id is not null then
    return v_existing_id;        -- no-op idempotente LEGÍTIMO (mismo caller, misma madre, mismo client_op_id)
  end if;
  -- colisión ajena (otra madre/tenant) o no-existe → cae al camino de creación
end if;
```

- **NO es el guard literal/global** (`SELECT id WHERE client_op_id = p_client_op_id → RETURN`): eso sería IDOR cross-tenant (HIGH-D1). El lookup está triple-scopeado: `client_op_id` + `animal_profile_id = p_mother_profile_id` + `establishment_id = v_est` (+ `deleted_at IS NULL`). `reproductive_events` no tiene `establishment_id` denormalizado (0026) → se deriva por JOIN a `animal_profiles`.
- **Colisión ajena (replay de un `client_op_id` de otro tenant):** `v_existing_id` queda NULL (la fila ajena tiene otra `animal_profile_id`/`establishment_id`) → camino de creación. El INSERT usa la propia madre del atacante → la tupla `(madre_atacante, client_op_id)` ≠ `(madre_víctima, client_op_id)` por el índice **compuesto** → NO colisiona → el atacante crea SU propio parto (o, si reusa con su MISMA madre dos veces, choca su PROPIA tupla → 23505 genérico). NUNCA devuelve el `id`/datos ajenos, NUNCA oráculo de existencia.
- **Path online (`p_client_op_id` NULL):** el `if` no entra → idéntico al as-built. Índice parcial (`WHERE client_op_id IS NOT NULL`) → no toca partos históricos (todos NULL).

### Firma + grants (cómo se manejó la firma)

- **DROP + CREATE** (no `CREATE OR REPLACE`): agregar un param con default a una firma existente puede ambiguar la resolución de overloads contra la firma vieja `(uuid, date, jsonb)`. `drop function if exists public.register_birth (uuid, date, jsonb)` (lleva sus grants) + `create function ... (uuid, date, jsonb, uuid default null)`. En la misma migración (atómica) → sin hueco.
- **Grants:** `revoke execute ... from public, anon` + `grant execute ... to authenticated` sobre la **firma de 4 args** `(uuid, date, jsonb, uuid)`. No quedan grants colgando de la vieja (el DROP los llevó). + `notify pgrst, 'reload schema';` al final (recarga del schema cache de PostgREST, patrón as-built 0045:300).
- Idempotencia de la migración: `ADD COLUMN IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS` / `DROP FUNCTION IF EXISTS` → re-ejecutable sin romper.

### Tests agregados (`supabase/tests/animal/run.cjs`, suite top-level `spec 15-powersync`)

- **caso 1 — idempotencia:** doble `register_birth(..., p_client_op_id := X)` (mismo caller, misma madre) → el 2do devuelve el MISMO id; estado real = 1 evento de parto, 2 terneros (no 4), 2 perfiles nuevos (no 4), madre avanza UN parto.
- **caso 2 (T7.7) — cross-tenant negativo (OBLIGATORIO):** A crea parto con `client_op_id = X`; B (otro est, sin rol en A) replay-ea X sobre madre PROPIA → B NUNCA recibe el id de A (assert `rB.data !== birthIdA`); B crea su propio parto o error genérico (23505); el parto de A queda intacto (mismos terneros, mismo `client_op_id`, misma madre).
- **caso 3 — path online intacto:** `register_birth` de 3 args (sin `p_client_op_id`) → 2 terneros, `client_op_id` NULL, madre transiciona como as-built.

### Trazabilidad R<n> → test (Run 2)

| R<n> | Cobertura | Test |
|---|---|---|
| R6.10 (`register_birth` dedup por `client_op_id`, no doble-apply) | doble call mismo X/madre → un solo parto | `supabase/tests/animal/run.cjs` :: `spec 15-powersync …` :: "caso 1: doble call …" |
| R6.10 / R11.4 (fix HIGH-D1: dedup scopeada al caller, NUNCA cross-tenant) | B con X de A sobre madre propia → no IDOR; A intacto | …:: "caso 2 (T7.7): client_op_id colisionado cross-tenant …" |
| R11.3 (path online idéntico al as-built; delta aditivo) | `register_birth` 3 args → as-built (2 terneros, `client_op_id` NULL) | …:: "caso 3: register_birth SIN p_client_op_id …" |

> Los 3 tests FALLAN hasta que el leader aplique 0075 (PGRST202: firma de 4 args inexistente). Verificado: solo mi suite `spec 15-powersync` falla; `animal suite — spec 02` y `spec 13` siguen verdes.

## Autorrevisión adversarial (paso 8) — Run 2

Busqué activamente, como revisor hostil del SQL del guard (el corazón de seguridad de este delta):

- **¿Path donde el guard devuelva datos de otra madre/tenant?** NO. El `return v_existing_id` solo dispara `if v_existing_id is not null`, y `v_existing_id` solo se llena si las 3 condiciones AND (client_op_id + `animal_profile_id = p_mother_profile_id` + `establishment_id = v_est`) matchean. Un parto ajeno nunca matchea las 3 → NULL → no se devuelve. Sin IDOR.
- **¿`p.deleted_at` en el JOIN del guard?** No lo agregué: la madre del parto existente está atada a `p_mother_profile_id` (ya validada viva en el SELECT de authz) y al `establishment_id = v_est`. Scope ya cerrado; agregarlo es redundante. (Verificado que no abre hueco.)
- **¿Colisión ajena → realmente no oráculo?** El índice **compuesto** `(animal_profile_id, client_op_id)` hace que el INSERT del atacante (con su propia madre) NUNCA colisione con la fila de la víctima (madre distinta) → no hay `unique_violation` diferencial → sin oráculo de existencia cross-tenant (cierra el residual E4 del índice global). Verificado en el caso 2 del test (camino (a): B crea su propio parto).
- **¿Carrera del mismo caller (dos calls concurrentes mismo X/madre)?** Ambos pasan el guard (NULL) → ambos INSERTan → el 2do choca el índice UNIQUE → 23505 (rechazo permanente → rollback overlay; el otro creó el parto; el reintento siguiente devuelve el existente vía guard). No crea doble parto. Defensa-en-profundidad correcta.
- **¿El DROP rompe dependencias?** NO. `register_birth` es RPC pública (PostgREST), no la invoca ningún trigger/view/función. Verificado: las únicas otras referencias (`0048`, `0067`) son **comentarios**. Los triggers de parto/nursing operan sobre `reproductive_events`/`birth_calves`, independientes de la firma de la RPC.
- **¿Firma/grants consistentes?** DROP de la vieja (lleva grants) + CREATE de la nueva + revoke/grant sobre la firma de 4 args + `notify pgrst`. Sin grants colgando. El call online de 3 args resuelve por `default null` (verificado por el caso 3).
- **¿`search_path` / `SECURITY DEFINER` / fail-closed?** `set search_path = public` + `security definer` (igual que as-built); `has_role_in(v_est)` rige PRIMERO; sin rol → 42501 antes de cualquier rama. No se expone ningún helper nuevo como RPC. No se hardcodea `establishment_id` (deriva de la fila real de la madre).
- **¿Tests que pasan por la razón equivocada?** Hoy FALLAN (migración no aplicada) — ejercitan el path real (PGRST202 prueba que llaman la firma de 4 args). El caso 2 verifica el REJECT real (`rB.data !== birthIdA` + parto de A intacto), no solo el happy path. Tras aplicar la migración, el caso 1 verifica el conteo REAL (1 evento/2 terneros vía service_role), no el valor de retorno solo.

**Encontrado y corregido:** el bloque de tests quedó inicialmente ANIDADO dentro de la suite `spec 13` (porque la suite `animal — spec 02` ya había cerrado en L1855 y el `t` en ese punto era el de spec 13). Eso hacía fallar a `spec 13` por arrastre (sus propios subtests pasaban). **Corregido:** moví los tests a una **suite top-level propia** `spec 15-powersync …` con setup aislado (espeja el patrón de spec 13). Re-verificado: `spec 13` volvió a verde; `animal — spec 02` verde; solo `spec 15-powersync` falla (esperado, migración pendiente).

## Reconciliación de specs (paso 9) — Run 2

- La implementación SIGUE al pie de la letra el spec gateado (design §5.4.3(1) pseudo-SQL, §9-nota índice compuesto, R6.10/R11.3/R11.4, T6.4). **No hubo desviación del as-built spec** → no se reescribe design/requirements. El guard, el índice compuesto, la firma DROP+CREATE, los grants y el `notify pgrst` son exactamente lo especificado (incluido el recordatorio de firma/grants de design §5.4.3 L637 y el aviso anti-guard-literal).
- `tasks.md` — T6.4 marcada `[x]` con la ruta de la migración + nota de que la aplica el leader; T7.7 marcada `[~]` (parcial: cubierto el sub-bullet `register_birth`; los sub-bullets exit/create/soft_delete son dedup-natural y se testean en el run de T6.2 con la outbox).
- `requirements.md` — sin cambio de "qué" (el comportamiento es el especificado en R6.10/R11.3/R11.4) → no se toca.

---

## Hotfix Run 1.1 — DB de @powersync/web crashea al bootear bajo Metro/Hermes (2026-06-08)

> Único cambio: una línea de `flags` en la rama WEB del factory. NO se tocó backend/migraciones/`sync-streams`/`feature_list.json`/`current.md`. `baseline_commit` sin cambios (multi-run).

### Síntoma (verificado en vivo por Raf en `pnpm web`)
Pasa `getEnv()` y crashea durante el render (al montar el provider → `new PowerSyncDatabase`) con:
`Uncaught Error: Failed to construct 'URL': Invalid base URL`.
Causa: `@powersync/web` por defecto corre el DB en un **shared web worker** cuya URL se arma con `new URL(..., import.meta.url)`; **Metro/Hermes (bundler de Expo web) no resuelve `import.meta.url`** → revienta.

### Fix
`app/src/services/powersync/database.ts`, rama WEB (`pickPowerSyncPackage(...) === 'web'`): agregado `flags: { useWebWorker: false, enableMultiTabs: false }` a las opciones del `PowerSyncDatabase`.
- `useWebWorker: false` (default true) → DB en el **main thread**, sin worker → no arma la URL con `import.meta.url`. Deshabilita multi-tab — aceptable en el harness web (D2: web = harness; target real = dev build native, que NO usa este branch).
- `enableMultiTabs: false` → silencia el warning de multi-tab (opcional, lo incluí).
- **Rama native NO se tocó** (`@powersync/react-native`, sin worker web).

Diff exacto de `database.ts` (rama web):
```ts
return new PowerSyncDatabase({
  schema: AppSchema,
  database: { dbFilename: DB_FILENAME },
  // Metro/Hermes no resuelve la URL del shared web worker (import.meta.url) → main thread.
  flags: { useWebWorker: false, enableMultiTabs: false },
});
```

### Tests
NO había ningún unit test que asserte la forma exacta de las opciones del factory (verificado por grep: `database.ts`/`PowerSyncDatabase`/`createDatabase`/`getPowerSync` solo aparecen en módulos de runtime de `services/powersync/`, sin `.test.ts`). El factory NO es testeable bajo `node:test` (importa RN/`@powersync/web`/WASM); por eso la lógica testeable es `platform-select.ts` (pura), que el fix no toca. **No se agregó ni modificó ningún test.**

### Verificación
`node scripts/check.mjs` → **verde (exit 0)**:
- `typecheck client` (`tsc --noEmit`) OK — `flags: { useWebWorker, enableMultiTabs }` son keys válidas del tipo de opciones de `@powersync/web`.
- Lint anti-hardcode (ADR-023 §4) → 0 violaciones.
- client unit tests OK; suites de DB (RLS/Edge/Animal/Maneuvers/User_private/Import + `spec 15-powersync` Run 2) verdes. "All tests passed." / "Entorno listo."
- **La validación LIVE del boot web (`pnpm web`) la hace Raf** — el implementer no tiene browser, no se forzó.

### 2da capa (WASM de wa-sqlite) — NO apareció evidencia desde acá
Tras sacar el worker puede aparecer un error distinto al cargar el WASM de wa-sqlite bajo Metro. **NO se observó** en typecheck ni en `check.mjs` (el typecheck es estático, no ejercita la carga del WASM; no tengo browser para `pnpm web`). **No apliqué ningún fix especulativo de assets.** Si aparece en la validación live de Raf, se ataca en una iteración aparte con el mensaje exacto.

### Autorrevisión adversarial (paso 8) — Hotfix Run 1.1
- **¿El fix toca la rama native?** NO. El `flags` está exclusivamente dentro del `if (pickPowerSyncPackage(...) === 'web')`; la rama `@powersync/react-native` quedó byte-idéntica (sin worker web — el problema no existe ahí).
- **¿`flags` es la forma correcta?** Sí: `PowerSyncDatabaseOptions.flags` (`PowerSyncFlags`) admite `useWebWorker` y `enableMultiTabs` — el typecheck lo acepta (tsc verde). Si hubieran sido keys inválidas, `tsc --noEmit` habría fallado.
- **¿`useWebWorker: false` rompe la persistencia/sync?** No: corre el mismo wa-sqlite en el main thread (no en el worker). El único trade-off es multi-tab (irrelevante en el harness web). Connector/provider/streams son agnósticos del worker → sin cambios de comportamiento de sync.
- **¿Tests que pasen por la razón equivocada?** El factory no tiene test (no es cargable en node) → no hay un test que asserte algo falso; el cambio no afecta a ningún test existente (todos verdes, incl. `platform-select` que es lo testeable de este módulo).
- **¿Reconciliación pendiente?** El as-built (flags en web) quedó documentado en design §1.3; `requirements.md` sin cambio de "qué" (el factory por plataforma de R2.2 sigue válido — solo se ajustó el mecanismo del runtime web). `tasks.md` T1.4 ya `[x]` (el hotfix no abre/cierra tasks). Sin specs contradictorias con el código.

### Reconciliación de specs (paso 9) — Hotfix Run 1.1
- design **§1.3** (factory por plataforma) — nota as-built agregada: web usa `useWebWorker: false` (+ `enableMultiTabs: false`) por compat con Metro/Hermes (`import.meta.url` del worker no resuelve); trade-off main-thread aceptable en el harness web; native sin cambios.
- `requirements.md` / `tasks.md` — sin cambio (mecanismo de runtime web, no cambia el "qué" de R2.2 ni el alcance de T1.4).

---

## Hotfix Run 1.2 — el DB de @powersync/web se cuelga en init() bajo Metro: WASM de wa-sqlite no servido (2026-06-08)

> Supersede el Hotfix Run 1.1. Cambios: rama WEB del factory (`database.ts`) + setup web reproducible (copy-assets cableado + gitignore). NO se tocó backend/migraciones/`sync-streams`/`feature_list.json`/`current.md`. `baseline_commit` sin cambios (multi-run).

### Síntoma (verificado en vivo por Raf en `pnpm web`)
`connect()` queda pendiente para siempre: se ve `[powersync] connecting…` pero NUNCA `[powersync] fetchCredentials` ni un error. Raf logueado, streams deployadas. El DB se cuelga al inicializar ANTES de pedir credenciales.

### Causa raíz (confirmada leyendo el SDK 1.38.2, no especulativa)
El fix de Run 1.1 (`useWebWorker: false`) sacó el shared web worker (cuya URL `import.meta.url` Metro no resuelve) pero metió el DB en el **main thread**. En ese path, `@powersync/web` carga wa-sqlite con `import('@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs')` (bundleado por Metro), y el loader Emscripten de ese `.mjs` busca su `.wasm` con `new URL("wa-sqlite-async.wasm", import.meta.url)` — **Metro/Hermes tampoco resuelve ese `import.meta.url`** → el fetch del WASM nunca resuelve → `db.init()` (implícito en `connect()`) se cuelga. **El path main-thread NO consulta el `public/` servido** (eso lo verifiqué en `WASQLiteOpenFactory.openConnection()`: con `useWebWorker:false` toma la rama `MultiDatabaseServer.openConnectionLocally` → `RawSqliteConnection` → `vfs.js` → `import('...mjs')`). Por eso copiar a `public/` sin cambiar el wiring NO alcanzaba.

### Fix (dos partes, ambas necesarias)
**(1) Wiring del factory — `app/src/services/powersync/database.ts`, rama WEB:** abrir el DB con un `WASQLiteOpenFactory` **explícito** (la forma "settings" `database: { dbFilename }` NO tipa `worker`; lo verificó el typecheck con `TS2769`) apuntando al worker UMD **servido**:
```ts
const database = new WASQLiteOpenFactory({
  dbFilename: DB_FILENAME,
  vfs: WASQLiteVFS.IDBBatchAtomicVFS,                 // default; NO requiere worker dedicado
  worker: '/@powersync/worker/WASQLiteDB.umd.js',     // asset SERVIDO desde public/
  flags: { useWebWorker: true, enableMultiTabs: false },
});
return new PowerSyncDatabase({ schema: AppSchema, database, flags: { useWebWorker: true, enableMultiTabs: false } });
```
- El SDK hace `new Worker('/@powersync/worker/WASQLiteDB.umd.js')` (path ROOT-absoluto, base-independiente; NO `import.meta.url`, NO bundleado por Metro). Ese worker UMD pre-bundleado carga su propio wa-sqlite WASM (los `.wasm` de `public/@powersync/`) vía su `publicPath` de webpack (`document.currentScript`), relativo a su ubicación servida.
- `flags` va EN DOS lugares a propósito: el del `WASQLiteOpenFactory` rige el **lado DB** (worker dedicado, sin multi-tab); el del `PowerSyncDatabase` rige el **lado SYNC** (`this.resolvedFlags` sale del `options.flags` top-level — verificado en `PowerSyncDatabase.js:55`). Con `enableMultiTabs:false` el sync usa `WebStreamingSyncImplementation` **in-process** (NO `SharedSyncImplementation.worker.js`, que SÍ usaría `import.meta.url` — verificado en `generateSyncStreamImplementation`). Así NINGÚN path toca `import.meta.url`.
- **Rama native intacta** (`@powersync/react-native`, sin worker web).

**(2) Setup web reproducible — `app/package.json`:**
```json
"copy-powersync-assets": "powersync-web copy-assets --output public",
"web": "pnpm run copy-powersync-assets && expo start --web",
"e2e:build": "pnpm run copy-powersync-assets && expo export -p web",
```
- `copy-assets` (CLI del SDK, `bin/powersync.cjs`) resuelve `@powersync/web/umd` (`dist/index.umd.js`), toma su dir (`dist/`) y copia TODO a `<output>/@powersync/`. Corrido desde `app/` con `--output public` → aterriza en `app/public/@powersync/`. Cableado como prebuild de `web` (dev server) y `e2e:build` (`expo export` copia `public/`→`dist/`, verificado en `@expo/cli` `copyPublicFolderAsync`). Clone fresco + `pnpm web` regenera → reproducible, no copy de una vez.
- **Gitignore (`app/.gitignore`):** `public/@powersync/` ignorado (build-artifact versionado con el SDK; ~2 MB de binarios fuera del repo). Verificado: `git check-ignore` lo marca; no aparece en `git status`.

### Carpeta de estáticos de Expo SDK 56 (averiguado, no asumido)
Expo SDK 56 sirve `EXPO_PUBLIC_FOLDER` (default `"public"`) resuelto **relativo al root del proyecto Expo** (acá `app/`) en la ruta `/`. Confirmado en `@expo/cli` `build/src/export/publicFolder.js` (`getPublicFolderPath` = `resolve(projectRoot, EXPO_PUBLIC_FOLDER)`, default `'public'` en `utils/env.js`) tanto para el dev server (`ServeStaticMiddleware`) como para `expo export` (`copyPublicFolderAsync`). → carpeta servida = **`app/public/`**.

### copy-assets: comando exacto + archivos que aterrizaron
Comando (desde `app/`): `pnpm.cmd powersync-web copy-assets --output public`
```
Resolved input path: ...\app\node_modules\@powersync\web\dist\index.umd.js
Target directory: public
Assets copied ... to ...\app\public\@powersync
```
Aterrizó en `app/public/@powersync/`:
- 4 `.wasm` de wa-sqlite: `2075a31bb151adbb9767.wasm`, `3322bc84de986b63c2cd.wasm`, `8e97452e297be23b5e50.wasm`, `fbc178b70d530e8ce02b.wasm`
- `index.umd.js` (+ `.map`)
- `worker/` (incl. `WASQLiteDB.umd.js` ← el que apunta el factory, `SharedSyncImplementation.umd.js`, y los chunks UMD de wa-sqlite). El worker DB referencia `fbc178b70d530e8ce02b.wasm` (uno de los 4) por su publicPath → árbol auto-consistente.
(El worker no es estrictamente necesario para el lado sync con `enableMultiTabs:false`, pero SÍ lo usa el lado DB; copiar el árbol completo es inofensivo y es lo que hace el CLI.)

### ¿Se tocó metro.config? NO
El `.wasm` se sirve estático y lo fetchea el worker UMD en runtime (publicPath de webpack) — Metro NUNCA importa un `.wasm`. Verificado: en `@powersync/web/lib/src/` no hay `import`/`import()` de `.wasm` (solo de `.mjs`), y ese path de `.mjs` queda bypasseado al usar el worker servido. Agregar `.wasm` a `assetExts` sería ruido sin efecto → no se tocó `app/metro.config.js`.

### Tests
Sigue sin haber unit test que asserte la forma de las opciones del factory (no es cargable bajo `node:test`: importa RN/`@powersync/web`/WASM). La lógica testeable de este módulo es `platform-select.ts` (pura), que el fix NO toca (sigue verde). NO se agregó ni modificó ningún test. La validación LIVE del boot web (`pnpm web` → conecta + dashboard muestra 1 cliente) la hace Raf.

### Verificación
- `pnpm run typecheck` (tsc --noEmit) → verde. (En el camino, tsc atrapó `TS2769` con la forma "settings" → corregido usando `WASQLiteOpenFactory` explícito, que tipa `worker`.)
- `node scripts/check.mjs` → **verde (exit 0)**: typecheck cliente OK, lint anti-hardcode OK, client unit tests OK, suites de DB (RLS/Edge/Animal/Maneuvers/User_private/Import) OK. "All tests passed." / "Entorno listo." (Los tests `spec 15-powersync` de `register_birth` siguen fail-pending la migración 0075, gated al leader — esperado, no es de este hotfix.)
- Assets presentes en `app/public/@powersync/` (4 `.wasm` + `worker/WASQLiteDB.umd.js`); gitignoreados (no en `git status`).

### Autorrevisión adversarial (paso 8) — Hotfix Run 1.2
Busqué activamente, como revisor hostil:
- **¿El worker servido realmente evita `import.meta.url`?** Sí, en los DOS lados: DB (`new Worker('/@powersync/worker/WASQLiteDB.umd.js')` — string literal servido; el worker UMD usa `document.currentScript`/publicPath, no `import.meta.url`) y SYNC (`enableMultiTabs:false` → `WebStreamingSyncImplementation` in-process; el único path con `import.meta.url` —`SharedSyncImplementation.worker.js`— SOLO se usa con `enableMultiTabs:true`, que evito). Verificado leyendo `open-worker-database.js`, `WASQLiteOpenFactory.js`, `generateSyncStreamImplementation` y `WebStreamingSyncImplementation.js`.
- **¿`flags` en dos lugares es redundante o necesario?** Necesario: el factory resuelve sus propios flags (lado DB) y `PowerSyncDatabase.resolvedFlags` sale del `options.flags` top-level (lado sync). Omitir el top-level dejaría el sync con defaults (`enableMultiTabs:true` si hay navigator) → SharedWorker de sync → `import.meta.url` → regresión. Verificado en `PowerSyncDatabase.js:55` + `resolveWebPowerSyncFlags`.
- **¿El VFS elegido es compatible con `enableMultiTabs:false`?** Sí. `IDBBatchAtomicVFS` (default) NO requiere worker dedicado (`vfsRequiresDedicatedWorkers` = false) → el assert de `WASQLiteOpenFactory` (que exige `useWebWorker:true` para VFS OPFS) no aplica y no rompe. Mantengo `useWebWorker:true` igual, así que ni siquiera roza ese assert.
- **¿La ruta del worker es base-dependiente?** No: `/@powersync/...` es ROOT-absoluta. Si Raf sirviera la app bajo un sub-path, habría que parametrizarla — anotado como riesgo, pero el harness sirve en `/`.
- **¿`copy-assets` reproducible de verdad?** Sí: cableado en `web` y `e2e:build`. El CLE `rm -rf` el destino antes de copiar (idempotente, sin assets viejos). Clone fresco + `pnpm web` los regenera. Riesgo: si alguien corre `expo start --web` directo (sin `pnpm web`) sin haber copiado nunca, falla — mitigado porque el script canónico es `pnpm web`; documentado.
- **¿Gitignore correcto?** Ignoro `public/@powersync/` (no todo `public/`, por si se agregan otros estáticos a futuro). Verificado con `git check-ignore`.
- **¿Seguridad?** Sin superficie nueva: los assets son código de runtime del SDK (worker + WASM), públicos por diseño; no exponen datos ni endpoints. No se hardcodea `establishment_id` ni secretos. El path del worker no es input de usuario.
- **Encontrado y corregido:** (a) la forma "settings" `database: { dbFilename, worker }` NO compila (`worker` no está en `SQLOpenOptions`) → tsc lo atrapó → migrado a `WASQLiteOpenFactory` explícito (que sí tipa `worker`), pasándole `flags`+`vfs`. (b) Detecté que poner `flags` SOLO en el factory dejaría el lado sync con `enableMultiTabs:true` por default → regresión del SharedWorker de sync → agregué `flags` también al `PowerSyncDatabase` top-level. (c) Confirmé que NO hace falta tocar metro.config (no hay import de `.wasm` por Metro) → no toqué a ciegas.
- **¿Tests por la razón equivocada?** El factory no tiene test (no cargable en node); `platform-select` (lo testeable) no cambia y sigue verde. No hay test que asserte algo falso.

### Reconciliación de specs (paso 9) — Hotfix Run 1.2
- design **§1.3** — la nota de Run 1.1 se marcó **SUPERSEDED**; se agregó la nota **as-built Run 1.2 VIGENTE**: `WASQLiteOpenFactory` con `worker` servido + `enableMultiTabs:false` (DB worker dedicado servido / sync in-process), el setup web reproducible (`copy-assets` cableado en `web`/`e2e:build`), el gitignore de `public/@powersync/`, la carpeta servida de Expo (`app/public/`) y la decisión de NO tocar Metro.
- `requirements.md` — sin cambio de "qué": R2.2 (factory por plataforma) sigue válido; solo se corrigió el MECANISMO del runtime web (de main-thread+WASM-bundleado a worker-servido). No es un cambio de requirement.
- `tasks.md` — sin cambio: T1.4 (database.ts) ya `[x]`; el hotfix no abre/cierra tasks. El setup web reproducible es parte del as-built de T1.4 (factory web), documentado en design §1.3.
- Sin specs contradictorias con el código.

---

## Run 3 — Fase T3 (swap de LECTURA: catálogos globales + contexto de establecimiento + rodeos)

> Cerrado 2026-06-08. SOLO T3 (T3.1, T3.2, T3.3). NO se tocó T4 (animals/events/management-groups),
> T5/T6 (escritura), ni RLS/policies/triggers/migraciones/EF (Run 3 = 100% cliente, solo `services/`).
> Solo se swapearon LECTURAS a SQLite local; toda mutación/RPC/EF quedó ONLINE sin tocar.

### Plan (cumplido)
- [x] T3.1 — `rodeo-config.ts` reads + `animals.fetchSystemCategories` + `rodeos.fetchProductionSystems` -> local.
- [x] T3.2 — `establishments.ts` reads + `members.ts` reads + `profile.ts` read -> local.
- [x] T3.3 — `rodeos.fetchRodeos` -> local (`createRodeo` usa `fetchRodeosOnline` interno).

### Decisiones de los puntos abiertos (resueltas en este run)
1. **Lectura one-shot** con `getPowerSync().getAll<T>(sql, args)`. NO `db.watch` (reactividad diferida; no toca call sites). Firmas públicas intactas (R11.1).
2. **SQL builders PUROS** en `app/src/services/powersync/local-reads.ts` (SIN imports -> testeable node:test). I/O en `app/src/services/powersync/local-query.ts` (`runLocalQuery`/`runLocalQuerySingle`).
3. **"Aun no sincronizo"** -> `db.currentStatus.hasSynced` (API real). `!hasSynced` + vacío -> `AppError { kind:'network', message:'Sincronizando datos del campo...' }` (reusa `kind:'network'`, NO agrega kind nuevo -> no rompe exhaustividad). Vacío-legítimo (no-owner sin invitaciones, teléfono opcional) -> `emptyIsSyncing:false`.
4. **Diagnóstico** en `provider.tsx`: `db.waitForFirstSync()` -> log UNA vez de COUNT(*) de 5 tablas clave. NUNCA contenido (PII).
5. **`createRodeo` ONLINE** (T5/T6 lo swappea): helper interno `fetchRodeosOnline` (PostgREST) para diffear su propio INSERT al instante; `fetchRodeos` pública lee local. Sin cambio de firma.

### Archivos creados
| Archivo | Qué |
|---|---|
| `app/src/services/powersync/local-reads.ts` | SQL builders PUROS (18 builders) + `toBool`. Sin imports. |
| `app/src/services/powersync/local-query.ts` | I/O: `runLocalQuery`/`runLocalQuerySingle` (getAll + degradación hasSynced). |
| `app/src/services/powersync/local-reads.test.ts` | 16 unit del SQL exacto + args + filtros de dominio + JOINs (en run-tests.mjs). |

### Archivos modificados
| Archivo | Qué |
|---|---|
| `app/src/services/rodeo-config.ts` | `fetchFieldCatalog`/`fetchSystemDefaults`/`fetchRodeoConfig` -> local. Writes ONLINE sin tocar. |
| `app/src/services/animals.ts` | `fetchSystemCategories` -> local (resto sin tocar). |
| `app/src/services/rodeos.ts` | `fetchProductionSystems`/`fetchRodeos` -> local; `createRodeo` usa `fetchRodeosOnline`. softDelete/create ONLINE. |
| `app/src/services/establishments.ts` | `loadMemberships`/`loadOwnProfile`/`loadFullProfile`/`loadEstablishmentDetail`/`countActiveMembers` -> local. Mutaciones ONLINE. |
| `app/src/services/members.ts` | `loadMembers`/`countTeam`/`loadPendingInvitations` -> local. Wrappers EF ONLINE. |
| `app/src/services/profile.ts` | `loadProfileNamePhone` -> local. (quedó sin `supabase`/`classifyError` -> removidos). |
| `app/src/services/powersync/provider.tsx` | + diagnóstico `waitForFirstSync` -> log de conteos (TODO debug). |
| `scripts/run-tests.mjs` | + `local-reads.test.ts` en el array de unit. |
| `specs/active/15-powersync/{design.md,tasks.md}` | reconciliación as-built Run 3 + T3.x `[x]`. |

### Trazabilidad R<n> -> test
- **R5.1** -> `local-reads.test.ts` :: cada `build*Query` verifica `FROM <tabla local>` + columnas + args. + typecheck (firmas `ServiceResult<T>` intactas).
- **R5.4** -> `local-reads.test.ts` :: builders de catálogo con `active=1`. La degradación "Sincronizando..." vive en `local-query.ts` (SDK-bound -> verificable en T7.4 E2E + validación en vivo de Raf). Documentado en código.
- **R4.4** -> `local-reads.test.ts` :: `buildRodeoConfigQuery` "sin re-scoping" (assert `doesNotMatch establishment_id|has_role_in`) + catálogos sin filtro de est.
- **R11.1** -> `pnpm typecheck` verde + 677 client unit verdes (incl. `establishment-mapping.test.ts` que ejercita `mapMembershipRows`, reusado por `loadMemberships`).
- **R7.2** -> `buildMembersQuery` test "sin PII" (assert `doesNotMatch phone|email`) + `buildOwn*Query` self-only por id.

### Autorrevisión adversarial (paso 8)
- **¿Cambió el SET vs PostgREST?** Verifiqué filtro a filtro: `active=1`, `deleted_at IS NULL`, `status='pending'`, exclusión owner/self en counts, orden (`sort_order ASC`/`created_at ASC`/sin orden donde no lo había). `systems_by_species` NO filtra active (preservado + testeado). `loadMemberships` conserva el filtro CRÍTICO `user_id=?` (sin él un owner duplicaría campos por la matriz de la stream est_members). Set preservado.
- **Booleans 0/1 en SQLite** coercidos con `toBool` en TODOS los mappers (preserva shape público `boolean`); filtros `= 1` (asunción PowerSync bool->1/0 INTEGER; documentada + validable por log + Raf).
- **¿Firma cambió?** No (typecheck verde). `LocalReadError` asignable a cada `AppError` (incl. el de `animals` con kinds extra). No rompe exhaustividad.
- **¿I/O fuera de node:test?** Sí: solo `local-reads.ts` (0 imports) entra al test; `local-query.ts`/services (SDK) NO. 16 unit verdes en aislamiento.
- **¿Degradación bien encuadrada?** `loadPendingInvitations` (no-owner) + phone (opcional) -> `emptyIsSyncing:false` (no degradan falso). Catálogos/detalle-por-id que deben existir tras sync -> `true`.
- **¿Diagnóstico filtra PII?** No: solo `SELECT COUNT(*)`.
- **¿APIs inventadas?** No: `getAll`/`currentStatus.hasSynced`/`waitForFirstSync` verificadas en `node_modules/@powersync/common/lib/.../*.d.ts`.
- **Interacción cazada:** `createRodeo` (online) diffeaba con `fetchRodeos`; al volverla local se rompería su before/after. Resuelto con `fetchRodeosOnline` interno -> createRodeo 100% online sin cambiar firma. Sin el fix, crear rodeo habría fallado al confirmar el rodeo creado.

### Reconciliación de specs (paso 9)
- `design.md` §1.1 — agregados `local-reads.ts` + `local-query.ts`.
- `design.md` §5.1 — nota as-built Run 3 (one-shot getAll = reactividad diferida; builders puros + I/O separado; degradación sin kind nuevo; scoping no-refiltrado / dominio sí; JOINs SQLite; `fetchRodeosOnline`; diagnóstico; nota de counts). Reconcilia el "watchable" del design original al one-shot decidido por el leader (cambio de MECANISMO, no de "qué": las lecturas siguen desde SQLite local, R5.1).
- `tasks.md` — T3.1/T3.2/T3.3 `[x]` con el alcance real.
- Sin specs contradictorias con el código.

### Verificación
- `node scripts/check.mjs` -> verde (exit 0).
- `cd app && pnpm.cmd typecheck` -> verde.
- `node --test app/src/services/powersync/local-reads.test.ts` -> 16/16 pass.
- `node scripts/run-tests.mjs` -> **All tests passed.** (typecheck + 677 client unit + RLS 17 + Edge 42 + Animal 76 + Maneuvers + user_private + Import 12 + spec 13 + spec 15 idempotencia). Backend sin cambios.

### Qué ve Raf al recargar la web (tras streams deployadas + primer sync)
- Lecturas que ahora salen del SQLite local: wizard Crear rodeo (sistemas/fields/defaults/categorías), Editar plantilla, lista de rodeos (RodeoContext), Mis campos / contexto de establecimiento, detalle de campo, miembros, invitaciones pendientes, perfil propio (saludo + Más), conteos de equipo. Todo offline una vez sincronizado.
- Log UNA vez tras el primer sync: `[powersync] first sync done; local rows: establishments=N, categories_by_system=N, field_definitions=N, rodeos=N, user_private=N`. Si todo da 0 con sesión válida + streams deployadas -> revisar el deploy de streams.
- Las ESCRITURAS siguen ONLINE — sin cambio para Raf en este run.

### Pendiente / para el leader-Raf
- Degradación "Sincronizando..." + conteos se validan EN VIVO (requieren streams deployadas + primer sync). Unit puro cubre SQL/args; la rama hasSynced es SDK-bound (T7.4 E2E). No testeable en node:test puro.
- Reactividad watchable (R5.3) diferida a un run posterior (decisión del leader): hoy one-shot. No bloquea T3; firmas no cambian al agregar `db.watch`.
- Asunción boolean->1/0: si el log diera coherente pero alguna lista saliera vacía con datos presentes, revisar la materialización de `active`/`enabled`. No esperado.

---

## Run 4 — trigger `user_roles.active` ↔ soft-delete de establecimientos (`0076`)

> Cerrado 2026-06-09. SEGUNDO y último delta de backend de la feature (la "Opción 2" de design §9, antes
> diferida). NO se tocó RLS/policies/otras funciones/streams/código de app. `baseline_commit` sin cambios
> (multi-run): `1618a956…`. **La migración NO se aplicó al remoto** — la aplica el leader por Management API
> tras gatearla (Gate 1 spec + Gate 2 + reviewer).

### Por qué (sin re-derivar — contexto del leader, verificado por el implementer)
El modelo de sync JOIN-free de PowerSync scopea por `SELECT establishment_id FROM user_roles WHERE
user_id = auth.user_id() AND active = true` SIN JOIN a `establishments` (los JOINs revientan el bucket model,
PSYNC_S2305). Pero un user puede tener un `user_roles.active = true` apuntando a un campo soft-deleteado (no
había trigger que lo desactivara) → el sync filtraría datos de campos borrados (regresión del fix Gate 1
HIGH-1). El trigger desactiva los roles al soft-deletear el campo → `active` queda como proxy FIEL de "campo
vivo".

### Plan (T-trig) — todas hechas
- [x] T6.6 (tasks.md) — `supabase/migrations/0076_deactivate_roles_on_establishment_soft_delete.sql` escrita (NO aplicada).
- [x] Test en `supabase/tests/rls/run.cjs` (campo + usuario dedicados, autocontenido) — pendiente de la aplicación de `0076`.

### Verificación de la regla dura (NO otro trigger conflictivo en `user_roles`)
- Grep de TODOS los `create trigger` del repo (`supabase/migrations`): **ningún** trigger apunta a `user_roles`.
  La única referencia a `user_roles` en migraciones es schema (`0003`), policies RLS (`0008`), grants (`0010`).
- → el `UPDATE user_roles` del trigger nuevo NO re-dispara nada (no toca `establishments` ni vuelve sobre
  `user_roles`) → **cero loop, cero side-effect destructivo** (es UPDATE de 2 columnas `active`/`deactivated_at`,
  no DELETE). La regla dura se cumple; NO hay que parar.

### Número de migración usado + por qué
- **`0076`**. Máximo en disco = `0075` (`0075_register_birth_idempotency.sql`, delta de PowerSync Run 2) → +1.
  Verificado por Glob: no hay nada `> 0075` en `supabase/migrations`. (El gap `0033/0034/0035` y `0050-0058` no
  altera el máximo.)

### As-built del SQL (`0076`)
- Envuelto en `BEGIN; … COMMIT;` (lo aplica el leader por Management API con ese wrapper).
- **Función** `public.deactivate_roles_on_establishment_soft_delete()` `returns trigger` `security definer`
  `set search_path = public` (mismo estilo que `handle_new_establishment` 0011 — precedente VALIDADO de un trigger
  `security definer` que escribe `user_roles`). Guarda: `if old.deleted_at is null and new.deleted_at is not null
  then UPDATE public.user_roles SET active = false, deactivated_at = now() WHERE establishment_id = new.id AND
  active = true; end if;`. + `comment on function`.
- **Trigger** `establishment_soft_delete_deactivates_roles` `AFTER UPDATE OF deleted_at ON public.establishments
  FOR EACH ROW`. `drop trigger if exists … ; create trigger …` (idempotencia, estilo del repo — el repo no usa
  `create or replace trigger`, así que respeté el drop+create).
- **Backfill** (después del trigger): `UPDATE public.user_roles SET active = false, deactivated_at = now() WHERE
  active = true AND establishment_id IN (SELECT id FROM public.establishments WHERE deleted_at IS NOT NULL);`
  (idempotente — sólo toca `active = true`; incluye los 3 roles espurios del user de prueba).
- **NO reactivación** en el caso inverso (`NOT NULL → NULL`): documentado como limitación deliberada en un
  comentario largo (no se puede distinguir desactivado-por-borrado de desactivado-por-remoción-de-miembro; no hay
  flujo de restore en MVP; un futuro restore deberá manejar la reactivación explícitamente).
- Comentarios en español explicando el por qué (sync JOIN-free de PowerSync) + la redundancia con la RLS + la
  limitación de no-reactivación.

### Test escrito + estado de corrida
- **Dónde**: `supabase/tests/rls/run.cjs`, suite `RLS suite — multi-tenant isolation`, test
  `'spec 15 (0076): soft-delete de un campo desactiva sus user_roles (active=false) y has_role_in sigue false'`
  (al final de la suite, antes del cleanup). Campo + usuario DEDICADOS (`estE`/`userE`) + `userB` como
  field_operator de `estE`, autocontenido → NO contamina el resto de la suite.
- **Qué verifica**: (antes) ambos roles `active=true`, `deactivated_at` null, owner ve el campo; (soft-delete vía
  cliente, mismo camino que `softDeleteEstablishment`); (después, a) AMBOS roles `active=false` + `deactivated_at`
  poblado (leído vía service_role porque el cliente ya no ve el campo); (después, b) `has_role_in` sigue false
  (el owner ya no ve el campo) — no-regresión.
- **Estado de corrida**: **FALLA — PENDIENTE de la aplicación de `0076` por el leader.** Corrí `node
  scripts/check.mjs`: 16/18 RLS pasan (incl. R8.3/R8.4, R6.1, todos los demás — NO introduje fallos en cascada);
  el ÚNICO fallo es mi test nuevo, en la aserción `active=false`, porque sin el trigger aplicado el soft-delete
  NO desactiva los roles. **Falla por la razón correcta** (ejercita el path real, lee el estado real vía
  service_role). Mismo patrón que la suite `spec 15-powersync` del animal runner con `0075` (Run 2 dejó sus tests
  rojos hasta que el leader aplicó la migración; el leader des-rojea aplicando `0076`).

### Trazabilidad R<n> → test
| R<n> | Cobertura | Test |
|---|---|---|
| R4.1 / R4.2 (refuerza HIGH-1: `active` = proxy fiel de campo vivo) | soft-delete → roles `active=false` → org_scope deja de incluir el campo borrado | `supabase/tests/rls/run.cjs` :: `spec 15 (0076): soft-delete … desactiva sus user_roles …` (aserción a) |
| no-regresión de `has_role_in` (el trigger es aditivo, no cambia authz) | tras el soft-delete, `has_role_in` sigue false (owner ya no ve el campo) | …mismo test (aserción b) |
| backfill / auditoría (no se borran filas, se desactivan) | las 2 filas siguen existiendo con `active=false` (no DELETE) | …mismo test (aserción a: `data.length === 2`) |

### Autorrevisión adversarial (paso 8) — Run 4
Busqué activamente, como revisor hostil del trigger:
- **¿`AFTER UPDATE OF deleted_at` (no BEFORE, no todas las columnas)?** Sí. AFTER (efecto posterior, no
  validación). `OF deleted_at` → NO dispara en el UPDATE de `updated_at` (trigger `establishments_set_updated_at`)
  ni en otros updates de la tabla.
- **¿La guarda evita re-disparar?** `OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL` cubre SOLO la
  transición a soft-deleted. Restore (NOT NULL→NULL) NO entra (no reactiva, por diseño). Re-borrado idempotente
  (NOT NULL→NOT NULL) NO entra. NULL→NULL NO entra.
- **¿`deactivated_at` existe?** Sí, `user_roles` (0003) tiene `active boolean not null default true` +
  `deactivated_at timestamptz`. Verificado contra el schema as-built.
- **¿Backfill idempotente?** Sí — sólo toca `active = true`; re-ejecutar no cambia nada (ya quedaron false).
- **¿Otro trigger en user_roles que loopee/borre?** NO (grep exhaustivo). El UPDATE no toca `establishments` →
  no re-dispara el trigger de soft-delete ni `set_updated_at`. Cero loop.
- **¿RLS bloquea el UPDATE del trigger?** No. `security definer` corre como owner del schema (`postgres` vía
  Management API = superuser → bypassa RLS siempre). Además NO hay `FORCE ROW LEVEL SECURITY` en el repo (grep).
  Es el MISMO patrón VALIDADO de `handle_new_establishment` (0011), que hace `INSERT INTO user_roles` bajo
  `security definer` y funciona (tests R3.2 lo prueban). Defensa doble.
- **¿`search_path` injection?** `set search_path = public` + todas las refs calificadas (`public.user_roles`,
  `public.establishments`) → sin ambigüedad de resolución. Igual que el resto de funciones del repo.
- **¿Edge cases?** Soft-delete de campo sin miembros activos → UPDATE 0 filas, no error (no-op). Concurrencia: el
  row lock de `establishments` serializa; sólo un UPDATE gana la transición; el otro vería OLD NOT NULL → guarda
  falsa → no re-desactiva (ya están). Idempotente.
- **¿Cambia comportamiento observable?** NO. `has_role_in`/`is_owner_of` (0005) ya hacen `JOIN establishments …
  deleted_at IS NULL` → ya devolvían false para campo borrado, independiente de `active`. Las queries de
  membership (establishments.ts/rodeos.ts/loadMemberships) también filtran `e.deleted_at IS NULL`. → el trigger
  NO cambia ningún resultado de autorización/lectura; sólo limpia `active`. Verificado leyendo 0005 + el comentario
  de `softDeleteEstablishment` (que documentaba esta deuda como diferida — la estoy cerrando).
- **¿Test que pasa por la razón equivocada?** El test HOY falla (migración pendiente) → ejercita el path real
  (lee `active`/`deactivated_at` reales vía service_role, no mock). Verifica el efecto real del trigger (no sólo
  el happy path): la aserción (a) comprueba `active === false` para AMBOS roles + `deactivated_at !== null`; la (b)
  comprueba la no-regresión (`has_role_in` false). Autocontenido (estE/userE dedicados) → no contamina la suite.
- **Encontrado / decisión tomada**: (i) usé `drop trigger if exists` + `create trigger` en vez de `create or
  replace trigger` para alinearme al estilo del repo (que no usa la 2da forma en ninguna migración) y máxima
  idempotencia. (ii) Detecté que el test existente **R8.3/R8.4** soft-deletea+restaura `estA` COMPARTIDO sin
  reactivar roles → con `0076` aplicado, dejaría `estA` con roles inactivos y rompería R5.1 invitations / R6.1 en
  cascada. NO toqué ese test (no es mi alcance reescribir tests existentes a ciegas) → lo REPORTO al leader como
  decisión (ver abajo). Mi test nuevo es autocontenido para no agregar contaminación.

### Reconciliación de specs (paso 9) — Run 4
- **design §9 (línea ~974)** — "Opción 2 NO tomada (diferida)" marcada **RECONCILIADO: la Opción 2 SE TOMÓ** (apunta a la entrada de Historial nueva).
- **design §2.2 / §2.1** — notas AS-BUILT Run 4: ahora hay trigger; el bucketing de Raf baja de 5 a 2; el INNER JOIN a establishments se MANTIENE como defensa-en-profundidad.
- **design Historial** — entrada nueva 2026-06-09 con el as-built completo (migración, no-reactivación, backfill, verificación de no-otro-trigger, test, reconciliaciones).
- **requirements R4.1 (nota), R11.3, R11.4** — notas de RECONCILIACIÓN (no se reescribió el EARS): R4.1 (ahora hay trigger, el filtro de campo-vivo se mantiene como defensa-en-profundidad); R11.3 (de "UN delta" a "DOS deltas aditivos": `0075` + `0076`); R11.4 (el 2do delta queda bajo el mismo gate; qué verifica Gate 1 sobre `0076`).
- **tasks.md** — T6.6 nueva `[x]` con el alcance real del trigger + el test pendiente de aplicación.
- Sin specs contradictorias con el código.

### Pendiente / decisiones para el leader-Raf (Run 4)
1. **APLICAR `0076` al remoto por Management API** (BEGIN/COMMIT, body UTF-8; mismo flujo que `0075`) tras
   gatearla (Gate 1 spec sobre el delta + Gate 2 + reviewer). Hasta entonces el test nuevo FALLA (esperado).
2. **⚠️ Interacción con el test existente R8.3/R8.4 (`supabase/tests/rls/run.cjs:329-343`)** — REQUIERE DECISIÓN.
   Ese test soft-deletea `estA` (el campo COMPARTIDO de la suite) y lo restaura (`deleted_at = null`) vía
   service_role. Con `0076` aplicado: el soft-delete desactivará los `user_roles` de userA (owner) y userB
   (field_operator) en `estA`; el restore NO los reactiva (por diseño del trigger). → `estA` queda con roles
   `active = false` para el resto de la corrida → **rompería en cascada** R5.1 invitations (línea 348, `clientA`
   crea invitación en estA → necesita `is_owner_of(estA)` true) y R6.1 (línea 489, userB ve estA). El test as-built
   asumía que el restore deja todo como estaba — deja de ser cierto con el trigger. Opciones para el leader: (a)
   ajustar R8.3/R8.4 para que reactive los roles de estA vía service_role tras el restore (re-`UPDATE user_roles
   SET active = true, deactivated_at = null WHERE establishment_id = estA`), o (b) que R8.3/R8.4 use un campo
   dedicado (como estD/estE) en vez de estA. NO lo toqué porque reescribir un test existente para acomodar un
   delta es decisión del leader (y toca el orden de la suite). Mi test nuevo ya es autocontenido para no sumar
   contaminación. **Esto sólo se manifiesta DESPUÉS de aplicar `0076`** — antes, la suite (salvo mi test) está verde.

---

## Run 4.1 — GUARD: 2da mitad del invariante (`0076`, block-activate-for-deleted) + test

> Cerrado 2026-06-09. EXTIENDE `0076` (NO aplicada al remoto — la aplica el leader). Cierra el finding HIGH-1
> que el Gate 1 reabrió: el trigger de deactivate (Run 4) cubre los roles EXISTENTES al borrar el campo, pero
> NO impide CREAR/activar un rol NUEVO para un campo ya borrado. `baseline_commit` sin cambios (multi-run).
> **SOLO se tocó**: `0076_*.sql` (extender), `supabase/tests/rls/run.cjs` (test), `tasks.md` (invariante) +
> reconciliación en `design.md`/`requirements.md`. NADA de app code/EFs/streams/otras migraciones. `0076` NO aplicada.

### El hueco (finding HIGH-1, evidencia concreta)
Vector verificado en `supabase/functions/accept_invitation/index.ts:93-101`: inserta `active: true` SIN chequear
`establishments.deleted_at`. Timeline: owner invita → owner soft-deletea el campo (el trigger de deactivate
desactiva los roles existentes, pero NADA cancela la invitación pendiente) → el invitado acepta el link → queda
un rol activo sobre un campo borrado → las streams per-est JOIN-free le replicarían al device la data del campo
borrado. El invariante "`user_roles.active = true` ⇒ campo vivo" se rompía por el lado de los roles NUEVOS.

### El fix (guard a NIVEL DB — decisión del leader)
Agregado a `0076` (mismo `BEGIN/COMMIT`, después del trigger de deactivate + el backfill):
- **Función** `public.prevent_active_role_on_soft_deleted_establishment()` `returns trigger` `language plpgsql`
  `security definer` `set search_path = public`:
  - `if new.active is distinct from true then return new;` — **`active = false` SIEMPRE permitido** (sale
    temprano): el trigger de deactivate hace `UPDATE active = false`, el backfill también, y la remoción de
    miembros también → NINGUNO se rompe.
  - si `new.active = true` Y `exists (select 1 from public.establishments e where e.id = new.establishment_id
    and e.deleted_at is not null)` → `raise exception '... establishment_id=%: el campo está soft-deleteado',
    new.establishment_id using errcode = '23514';`
  - `return new;`
- **Trigger** `user_roles_block_active_on_soft_deleted_establishment` `BEFORE INSERT OR UPDATE OF active ON
  public.user_roles FOR EACH ROW`. `drop trigger if exists` + `create` (idempotente, estilo del repo).

### Errcode elegido + por qué (consistencia con el repo)
**`23514` (check_violation).** Es una violación de INVARIANTE de dominio/estado ("rol activo ⇒ campo vivo"), NO
una negación de privilegio del caller (`42501`): el caller puede ser un owner o service_role haciendo un insert
que "se ve" legítimo; lo que se bloquea es el ESTADO ilegal. Mismo errcode y MISMA CLASE que el guard de estado
de `soft_delete_rodeo` (`0041:41-42`: `raise exception 'rodeo has active animal_profiles; reassign or remove
them first (R2.5)' using errcode = '23514';`). Verifiqué los errcodes de dominio del repo (`0041`/`0044`/`0045`):
`42501`=authz, `23514`=invariante de estado/business-rule, `P0002`=not-found, `23503`=FK, `22023`=invalid-param.
`23514` es el de dominio correcto — NO un `23xxx` accidental (el `23505` del unique-index NO aplica: el guard
rechaza ANTES, en el BEFORE trigger, sin llegar al constraint).

### Compatibilidad — los 4 flujos legítimos siguen pasando (con evidencia de líneas)
1. **Creación de establecimiento** — `handle_new_establishment` (`0011_establishment_auto_owner.sql:27-28`):
   `AFTER INSERT ON establishments` inserta el rol owner para un campo RECIÉN creado (`deleted_at NULL`). Mi
   guard (`BEFORE INSERT ON user_roles`) corre sobre ese insert; el campo ya existe vivo (mismo tx, AFTER INSERT
   ve la fila) → `EXISTS(... deleted_at IS NOT NULL)` = false → **permitido**. ✅ (Test R3.1/R3.2 de la suite RLS
   sigue verde.)
2. **Aceptar invitación a un campo VIVO** — `accept_invitation/index.ts:93-101` inserta `active:true`; el campo
   vivo (`deleted_at NULL`) → no matchea → **permitido**. Solo se bloquea el campo BORRADO. ✅
3. **Trigger de deactivate + backfill** — `0076` (`UPDATE user_roles SET active = false …` líneas 55-59 y
   99-106): `active = false` → guard sale temprano (`is distinct from true`) → **permitido**. ✅ (El guard se
   crea DESPUÉS del backfill en el mismo tx, así que el backfill ni siquiera lo dispara.)
4. **Fix del test R8.3/R8.4** (`run.cjs:341-354`): restore `deleted_at = null` (línea 342) **ANTES** de reactivar
   `active = true` (líneas 350-354). **Confirmado el orden restore→reactivar**: al reactivar, el campo está VIVO
   → guard permite. ✅ (Si reactivara ANTES del restore, el guard lo bloquearía — por eso el orden importa; está
   en el orden correcto.)

### Test agregado (`supabase/tests/rls/run.cjs`)
Suite `RLS suite — multi-tenant isolation`, test nuevo `'spec 15 (0076 guard): no se puede activar/insertar un
user_roles.active=true en un campo soft-deleteado'` (después del test de deactivate, antes del cleanup). Campo +
usuarios DEDICADOS (`estG`/`userG`/`userH`), autocontenido. Ejercita el guard DIRECTO vía service_role (simular
`accept_invitation` entero es pesado; el guard es agnóstico del caller):
- **CASO POSITIVO** (campo VIVO): insert `active=true` (userH en estG vivo) → PASA.
- **CASO NEGATIVO 1** (INSERT campo BORRADO): tras soft-deletear estG, insert `active=true` NUEVO (userB) → el
  guard RECHAZA (assert `23514`/borrado). **Es el vector exacto de `accept_invitation`.**
- **CASO NEGATIVO 2** (UPDATE `active=true` campo BORRADO): reactivar el rol de userH (que el deactivate dejó en
  false) con estG aún borrado → el guard RECHAZA. Cubre el path "poner active=true por UPDATE", no solo INSERT.
- **CONTRAPRUEBA compat** (`active=false` campo BORRADO): UPDATE a `active=false` sobre el campo borrado → NO
  bloqueado (garantiza que el guard no rompe el deactivate/remoción).
- **CONTRAPRUEBA orden** (restore→reactivar): restore `deleted_at=null` ANTES, luego reactivar `active=true` →
  PASA (espeja R8.3/R8.4; demuestra que el orden importa).

**Confirmación del orden restore-antes-de-reactivar en R8.3/R8.4**: leído `run.cjs:341-354` — el restore
(`deleted_at=null`, L342) va PRIMERO, la reactivación (`active=true`, L350-354) DESPUÉS → compatible con el
guard. Mi contraprueba lo replica explícitamente.

### Estado de corrida (`node scripts/check.mjs` / `run-tests.mjs`)
- `typecheck client` OK; `client unit tests` 677 pass / 0 fail.
- **RLS suite**: 16 pass; ÚNICOS 2 rojos = los DOS tests `0076` pendientes de aplicación (deactivate de Run 4 +
  el guard nuevo de Run 4.1). **Todo lo demás verde** — R8.3/R8.4, R6.1, R3.6/R8.3, R3.1/R3.2, etc. SIN cascada.
- El guard test FALLA en CASO NEGATIVO 1 (`run.cjs:650`, `assert.notEqual(error, null)`): sin `0076` aplicada el
  guard no existe → el insert `active=true` sobre el campo borrado SUCEDE (error null) → la aserción de rechazo
  falla. **Falla por la razón correcta** (ejercita el path real). Tras aplicar `0076` → verde.
- Suites NO-RLS corridas aparte (no dependen de RLS): Edge+Maneuvers+User_private+Import = **99 pass / 0 fail**;
  Animal = **52 pass / 0 fail** (el leader YA aplicó `0075` → la suite `spec 15` de `register_birth` está verde).
- → El ÚNICO rojo del repo son los 2 tests `0076` pendientes de aplicación, exactamente el estado esperado.
  `check.mjs` aborta (exit 1) en la RLS suite por esos 2 rojos — ES el estado documentado de Run 4 (igual que
  Run 2 con `0075`): se des-rojea cuando el leader aplica `0076`.

### Trazabilidad R<n> → test (Run 4.1)
| R<n> | Cobertura | Test |
|---|---|---|
| R4.1 / R4.2 (cierre COMPLETO de HIGH-1: roles NUEVOS) — guard bloquea crear/activar rol en campo borrado | INSERT/UPDATE `active=true` sobre campo borrado → 23514 reject | `supabase/tests/rls/run.cjs` :: `spec 15 (0076 guard): …` (CASO NEGATIVO 1 INSERT + 2 UPDATE) |
| compat: `active=false` SIEMPRE permitido (no rompe deactivate/remoción) | UPDATE `active=false` sobre campo borrado → permitido | …mismo test (CONTRAPRUEBA compat) |
| compat: campo vivo / restore→reactivar permitido | insert `active=true` campo vivo + restore-antes-de-reactivar | …mismo test (CASO POSITIVO + CONTRAPRUEBA orden) |

### Autorrevisión adversarial (paso 8) — Run 4.1
Busqué activamente, como revisor hostil del guard:
- **¿Rompe algún flujo legítimo de `active=true`?** Verifiqué los 4 (creación de campo / aceptar-a-campo-vivo /
  deactivate+backfill / restore→reactivar R8.3/R8.4) con evidencia de líneas (arriba). Ninguno se rompe.
- **¿`is distinct from true` correcto?** `active` es `NOT NULL boolean` (0003:22). false → distinct → early return
  (permitido); true → not distinct → chequea EXISTS. Robusto incluso si a futuro fuera nullable.
- **¿`BEFORE UPDATE OF active` dispara de más?** `OF active` filtra el UPDATE a cuando `active` está en el SET; un
  UPDATE de solo `deactivated_at`/`role` NO dispara. El INSERT dispara siempre (correcto: todo rol nuevo se valida).
  Precedente de sintaxis en el repo: `0037:54`, `0052:84-96` (`before insert or update of <col>`).
- **¿Loop / re-disparo?** El guard NO escribe `user_roles` ni `establishments` (solo lee `establishments` en el
  EXISTS) → no re-dispara nada. El trigger de deactivate (que SÍ escribe `user_roles SET active=false`) dispara mi
  guard, pero con active=false → early return. Cero loop.
- **¿RLS bloquea el SELECT del EXISTS?** No: `security definer` corre como owner del schema (bypassa RLS); además
  no hay `FORCE RLS` en el repo. Mismo patrón validado de `handle_new_establishment` (0011) y del trigger de
  deactivate de Run 4.
- **¿`search_path` injection?** `set search_path = public` + refs calificadas (`public.establishments`) → sin
  ambigüedad. Igual que el resto del repo.
- **¿El test pasa por la razón equivocada?** Hoy FALLA (guard no aplicado) ejercitando el path real (el insert
  REALMENTE sucede sin guard → la aserción de rechazo falla). El assert del rechazo matchea `23514`/borrado (un
  unique `23505`/duplicate NO lo satisface → atraparía un falso-positivo). Verifica los DOS paths de reject
  (INSERT y UPDATE) Y los paths de compat (active=false, restore→reactivar), no solo el happy path. Autocontenido
  (estG/userG/userH dedicados) → no contamina la suite (verificado: los otros 15 RLS tests siguen verdes).
- **¿El test deja residuo?** estG/userG/userH tracked → CASCADE cleanup. El `userB active=true` del CASO NEGATIVO 1
  (cuando el guard está ausente) cae en estG → limpiado por el CASCADE de estG.
- **¿CASO NEGATIVO 1 podría chocar el unique-index en vez del guard (falso pass)?** No: userB no tiene otro rol
  activo en estG → sin colisión unique; solo el guard puede rechazar. Y el assert exige `23514`/borrado (un `23505`
  no lo satisface).
- **Encontrado / decisión tomada**: (i) elegí `errcode '23514'` (no `42501`) por la naturaleza de invariante de
  estado del bloqueo (precedente `soft_delete_rodeo` 0041) — documentado en el SQL y acá. (ii) Usé `is distinct
  from true` (no `= true`) por robustez. (iii) El guard se ubica DESPUÉS del backfill en el tx, así que el backfill
  no lo dispara (orden seguro). No encontré defectos que cerrar.

### Reconciliación de specs (paso 9) — Run 4.1
- **`0076_*.sql` header** — reconciliado: ahora enuncia las DOS mitades del invariante (deactivate-on-delete +
  block-activate-for-deleted) y el vector de `accept_invitation`.
- **design §9** — la entrada "Opción 2 RECONCILIADA (tomada)" ampliada: la Opción 2 se tomó en DOS mitades; se
  describe el guard (BEFORE INSERT OR UPDATE OF active, errcode 23514, active=false siempre permitido), el vector
  de `accept_invitation`, y los 4 flujos de compat.
- **requirements.md R4.1** (nota) — agregada la 2da nota de RECONCILIACIÓN (Run 4.1): el guard cierra el hueco de
  los roles NUEVOS → cierre COMPLETO de HIGH-1. No se reescribió el EARS (nota de reconciliación, como impl_13).
- **tasks.md T6.6** — sub-bullet GUARD agregado: declara el INVARIANTE ("`user_roles.active = true` ⇒ campo vivo",
  enforced por las DOS mitades de `0076`), el guard, el errcode, los 4 flujos de compat, y el test (pendiente de
  aplicación). 
- Sin specs contradictorias con el código.

### Pendiente / para el leader-Raf (Run 4.1)
1. **APLICAR `0076` al remoto por Management API** (BEGIN/COMMIT, body UTF-8; mismo flujo que `0075`) tras gatearla
   (Gate 1 spec sobre el delta extendido + Gate 2 + reviewer). Hasta entonces los 2 tests `0076` FALLAN (esperado).
   La aplicación des-rojea AMBOS (deactivate + guard) de una.
2. La interacción R8.3/R8.4 del Run 4 punto 2 YA está RESUELTA en `run.cjs:344-355` (opción (a): reactiva los roles
   de estA vía service_role DESPUÉS del restore, en el orden restore→reactivar — compatible con el guard).

---

## Run 5 — PASO 2: denormalización de `establishment_id` (tablas hijas) + identidad de animal (b1) + member_name (c2)

> Alcance EXACTO: **T9.1** (migraciones A) + **T9.4** (migración b1) + **T9.6** reconciliado a **(c2)** (migración 0080 + ajuste de lecturas). NO se aplican migraciones al remoto (las aplica el leader por Management API tras Gate 1). NO se escribe el YAML de streams (T9.3, lo arma el leader). NO se hace el swap T4 a b1 (T9.5, run aparte). `baseline_commit` sin cambios (multi-run, `1618a956...`).

### Migraciones escritas (>= 0077, NO aplicadas al remoto)

| Migración | Qué hace |
|---|---|
| `0077_denormalize_establishment_id_event_children.sql` | `establishment_id` denormalizado + force trigger + backfill + SET NOT NULL en las 6 tablas que derivan del PERFIL: `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`. Función force COMPARTIDA `tg_force_establishment_id_from_profile` (SELECT a `animal_profiles WHERE id = NEW.animal_profile_id`). Triggers `BEFORE INSERT OR UPDATE`. |
| `0078_denormalize_establishment_id_birth_calves_rodeo_config.sql` | `birth_calves` (`establishment_id` <- parto->madre, cadena 2 saltos; `tg_force_establishment_id_from_birth_event`; `BEFORE INSERT` - tabla server-only) + `rodeo_data_config` (`establishment_id` <- rodeo; `tg_force_establishment_id_from_rodeo`; `BEFORE INSERT OR UPDATE` por el toggle). Backfill + SET NOT NULL en ambas. |
| `0079_denormalize_animal_identity_on_profiles.sql` | (b1) `animal_tag_electronic`/`animal_sex`/`animal_birth_date` (nullables) en `animal_profiles` + force `BEFORE INSERT OR UPDATE OF` las 3 columnas (`tg_force_animal_identity_on_profile`, desde `animals WHERE id = NEW.animal_id`) + propagación `AFTER UPDATE OF tag_electronic, sex, birth_date ON animals` (`tg_propagate_animal_identity_to_profiles`) + backfill. NO sincroniza `animals` (NO se agrega `est_animals`). |
| `0080_denormalize_member_name_on_user_roles.sql` | (c2) `member_name text` (nullable) en `user_roles` + force `BEFORE INSERT OR UPDATE OF member_name` (`tg_force_member_name_on_user_role`, desde `users.name WHERE id = NEW.user_id`) + propagación `AFTER UPDATE OF name ON users` (`tg_propagate_user_name_to_roles`) + backfill. NO sincroniza `users`. PII (email/phone) NO se toca. |

Todas: `BEGIN/COMMIT`, comentarios es-AR (el porqué + anti-spoof), `security definer` + `set search_path = public` en cada función, `add column if not exists` + `create or replace function` + `drop trigger if exists`/`create` (idempotentes), `notify pgrst`. Errores con `errcode` (23503) si el padre no se encuentra.

### Por tabla - columna agregada, cadena de derivación, cuerpo del trigger

- **`weight_events`/`reproductive_events`/`sanitary_events`/`condition_score_events`/`lab_samples`/`animal_category_history`** (0077): `+ establishment_id uuid FK establishments`. Derivación: `animal_profiles.establishment_id WHERE id = NEW.animal_profile_id`. Trigger (compartido): `SELECT establishment_id INTO v_est FROM animal_profiles WHERE id = new.animal_profile_id; if v_est is null then raise 23503; new.establishment_id := v_est;`. `BEFORE INSERT OR UPDATE`.
- **`birth_calves`** (0078): `+ establishment_id uuid FK`. Derivación: `reproductive_events re JOIN animal_profiles ap ON ap.id = re.animal_profile_id WHERE re.id = NEW.birth_event_id -> ap.establishment_id`. Trigger force `BEFORE INSERT` (server-only, sin GRANT UPDATE de cliente -> INSERT basta). El `reproductive_events` ya está persistido cuando se inserta `birth_calves` (verificado: `link_birth_calf` AFTER INSERT 0048 + `register_birth` inserta el evento antes que los terneros) -> el SELECT lo encuentra.
- **`rodeo_data_config`** (0078): `+ establishment_id uuid FK`. Derivación: `rodeos.establishment_id WHERE id = NEW.rodeo_id`. Trigger force `BEFORE INSERT OR UPDATE` (el toggle del owner es UPDATE; re-fuerza defensivamente - R13.3).
- **`animal_profiles`** (0079, b1): `+ animal_tag_electronic text, animal_sex text, animal_birth_date date` (tipos copiados de `animals` 0019). Force `BEFORE INSERT OR UPDATE OF` las 3 columnas: `SELECT tag_electronic, sex, birth_date INTO ... FROM animals WHERE id = new.animal_id; new.animal_* := ...`. Propagación `AFTER UPDATE OF tag_electronic, sex, birth_date ON animals`: `UPDATE animal_profiles SET animal_* = new.* WHERE animal_id = new.id AND (is distinct from ...)`.
- **`user_roles`** (0080, c2): `+ member_name text`. Force `BEFORE INSERT OR UPDATE OF member_name`: `SELECT name INTO v_name FROM users WHERE id = new.user_id; new.member_name := v_name`. Propagación `AFTER UPDATE OF name ON users`: `UPDATE user_roles SET member_name = new.name WHERE user_id = new.id AND member_name is distinct from new.name`.

### Ajuste de lecturas (c2) - `local-reads.ts` + tests

- `buildMembersQuery(establishmentId)`: era `SELECT ur.role, ur.user_id, u.name AS user_name FROM user_roles ur LEFT JOIN users u ON u.id = ur.user_id WHERE ...` -> ahora `SELECT ur.role, ur.user_id, ur.member_name AS user_name FROM user_roles ur WHERE ...` (sin JOIN a `users`). Shape público (`role/user_id/user_name`) intacto -> `members.loadMembers` (`row.user_name ?? ''`) no cambia.
- `buildOwnNameQuery(userId)`: era `SELECT name FROM users WHERE id = ? LIMIT 1` -> ahora `SELECT member_name AS name FROM user_roles WHERE user_id = ? LIMIT 1` (el user tiene N filas, mismo member_name; LIMIT 1). Shape `{ name }` intacto -> `profile`/`establishments.loadFullProfile` no cambian.
- Comentario de cabecera de `local-reads.ts` actualizado (c2: nombres de `user_roles.member_name`, `users` no se sincroniza, PII en user_private).
- Unit tests `local-reads.test.ts` actualizados: `buildMembersQuery` (member_name, sin JOIN, sin PII) + `buildOwnNameQuery` (member_name, no lee `users`). PUROS -> verdes en `check.mjs`.

### No-loop / no-conflicto de triggers (con evidencia de grep)

Grep de TODOS los `create trigger ... on public.{animal_profiles|weight_events|...|user_roles|animals|users}` (multiline). Análisis:
- **Tablas hijas de eventos**: ya tienen `BEFORE INSERT` (`set_created_by` 0025-0029, `gating` 0054, `session_tenant_check_ins` 0056). Mi force toca SOLO `NEW.establishment_id` (columna nueva); ninguno de los otros lee establishment_id (no existía). Disjuntos -> sin conflicto, sin orden relevante.
- **`birth_calves`**: solo tenía `birth_calves_recompute_nursing` (AFTER INSERT 0067). Mi force es BEFORE INSERT -> no interfiere. El `reproductive_events` existe cuando se inserta `birth_calves` (link AFTER / register_birth) -> SELECT OK.
- **`rodeo_data_config`**: tenía `set_updated_at` (BEFORE UPDATE 0018). Mi force `BEFORE INSERT OR UPDATE` toca solo establishment_id; `set_updated_at` toca updated_at -> disjuntos. El seed `tg_rodeos_seed_data_config` (AFTER INSERT on rodeos 0018) inserta filas -> mi force corre y deriva del rodeo (ya existe) -> OK.
- **`animal_profiles` (b1)**: tiene varios BEFORE INSERT (`identity_check`/`rodeo_check`/`category_check` 0021, `set_created_by` 0043) + BEFORE UPDATE OF puntuales + AFTER (`record_category_change_*` 0030). Mi force INSERT/UPDATE OF las 3 columnas de identidad toca columnas NUEVAS que ningún otro trigger lee/escribe -> sin conflicto. **Propagación**: `UPDATE animal_profiles SET animal_* ...` NO toca `category_id` (no dispara `record_category_change_upd`, que es `AFTER UPDATE OF category_id`); SÍ dispara mi propio force (`BEFORE UPDATE OF las 3`), que re-deriva el MISMO valor de `animals` (idempotente, sin pelea); dispara `set_updated_at` (benigno). **Cero loop** (el UPDATE a profiles no re-toca `animals`).
- **`user_roles` (c2)**: ya tiene el guard `user_roles_block_active_on_soft_deleted_establishment` (`BEFORE INSERT OR UPDATE OF active`, 0076). Mi force es `BEFORE INSERT OR UPDATE OF member_name` -> triggers DISTINTOS, columnas disjuntas (active vs member_name). **Propagación**: `UPDATE user_roles SET member_name ...` NO toca `active` (no re-dispara el guard 0076) ni `user_id`; SÍ re-dispara mi force (`OF member_name`), que re-deriva `users.name` = MISMO valor (idempotente). NO re-toca `users`. **Cero loop, cero conflicto.**
- **`animals` (b1 propagación)**: ya tenía `animals_apply_castration` (AFTER UPDATE OF is_castrated 0064), `animals_block_tag_change` (BEFORE UPDATE OF tag_electronic 0036), `animals_validate_species`/`set_updated_at`. Mi propagación `AFTER UPDATE OF tag_electronic, sex, birth_date` -> no entra en loop (UPDATEa `animal_profiles`, no `animals`). Nota: `0036` BLOQUEA el cambio de `tag_electronic` -> mi propagación por tag raramente dispara, pero sí por sex/birth_date (test lo ejercita con birth_date).
- **`users` (c2 propagación)**: solo tenía `users_set_updated_at` (BEFORE UPDATE 0001). Mi propagación `AFTER UPDATE OF name` -> UPDATEa `user_roles`, no `users` -> sin loop.

### Estado de `run-tests.mjs` (rojo esperado/pendiente de aplicación)

- **`check.mjs` (typecheck + lint + hardcode + client unit incl. `local-reads.test.ts`)**: VERDE (exit 0). El ajuste de lecturas tipa y los unit pasan.
- **RLS suite** (`rls/run.cjs`): 19 pass / 3 fail. Los 3 rojos = los 2 sub-tests nuevos de **(c2)** (`member_name` force + propagación) + su contenedor. Causa: `column user_roles.member_name does not exist` (42703) - `0080` NO aplicada. El bloque `multi-tenant isolation` (incl. los tests 0076 ya aplicados) sigue VERDE.
- **Animal suite** (`animal/run.cjs`): 53 pass / 7 fail. Los rojos = los 6 sub-tests nuevos del **paso 2** (weight/reproductive/birth_calves/rodeo_config/identidad/propagación) + su contenedor. Causa: columnas `establishment_id`/`animal_*` inexistentes (`PGRST204`/`42703`) - `0077`/`0078`/`0079` NO aplicadas. **La animal suite spec 02 + spec 13 + register_birth idempotencia (0075) siguen VERDES** -> las migraciones del paso 2 (sin aplicar) NO rompen los flujos as-built.
- **Único rojo del repo = los tests nuevos del paso 2**, pendientes de que el leader aplique `0077`-`0080`. Es el patrón documentado de 0075/0076. Cuando se apliquen, los tests ejercitan el path real (el INSERT/UPDATE con spoof SUCEDE; el assert exige `=== el del padre`, así que un trigger que NO forzara haría fallar el test -> no pasan por la razón equivocada).

### Autorrevisión adversarial (paso 8)

- **¿Cada trigger FUERZA (anti-spoof), no setea-si-NULL?** Sí: cada force hace `new.col := <derivado>` incondicional (no `if new.col is null`). Probado: cliente manda `establishment_id = estB` ajeno -> el trigger lo pisa con el del perfil (estA). Los tests pasan un valor ajeno EXPLÍCITO en el payload y verifican que queda el del padre.
- **HALLAZGO CERRADO (el principal) - spoofeo por UPDATE.** El design decía "NO BEFORE UPDATE" para los eventos y solo INSERT para b1/c2. Pero esas tablas tienen `GRANT UPDATE` a authenticated y la policy de UPDATE deriva el tenant del PADRE (no de la columna nueva) -> un caller podía `UPDATE ... SET establishment_id = <ajeno>` por PostgREST directo y dejar la columna INFIEL -> leak por el WAL al stream del campo ajeno (o, en b1/c2, corromper la identidad/nombre offline). **Cerrado**: force también en UPDATE en las 5 tablas de evento (0077), `rodeo_data_config` (0078), identidad de `animal_profiles` (`BEFORE UPDATE OF` las 3, 0079) y `member_name` (`BEFORE UPDATE OF`, 0080). NO en `birth_calves`/`animal_category_history` (server-only, sin GRANT UPDATE de cliente). Es el criterio del precedente `animal_events` (0034, columna denormalizada inmutable en UPDATE). Tests reforzados con sub-casos de UPDATE-spoof. Reconciliado en design §2.4 (A)/(B) + R13.3.
- **¿Backfills correctos e idempotentes?** Sí. Cada backfill JOINea al padre (FK NOT NULL CASCADE garantiza que existe) y filtra `WHERE col IS NULL` (eventos/birth_calves/rodeo_config) o reescribe el mismo valor (identidad/member_name). Re-correrlos no cambia nada. Ninguna fila queda NULL -> el SET NOT NULL no falla.
- **¿Orden add-nullable -> backfill -> SET NOT NULL correcto?** Sí, ese es el orden en las 3 con SET NOT NULL (0077/0078). 0079/0080 dejan las columnas nullables (identidad/name pueden faltar legítimamente) -> sin SET NOT NULL.
- **¿Loop/conflicto?** Verificado arriba con grep. Cero loop, cero conflicto. Las propagaciones disparan el force del mismo valor (idempotente).
- **¿register_birth se rompe con el force en reproductive_events?** No: el force solo SETea una columna nueva; register_birth no lee `reproductive_events.establishment_id`. La suite register_birth idempotencia (0075, ya aplicada) sigue verde - el force aún no está aplicado, pero cuando lo esté solo agrega el SET de la columna. Sin regresión de lógica.
- **¿Tests pasan por la razón equivocada?** No: cada test no-spoof pasa un valor AJENO en el payload y exige `=== el del padre` (un trigger que setea-si-NULL o no fuerza dejaría el ajeno -> falla). Los de propagación cambian el padre y exigen que la fila hija refleje el valor nuevo. Hoy fallan por columna inexistente (path real, no falso-verde).
- **¿RLS / grants tocados?** No (grep confirmó: 0 `create/drop policy`, 0 `grant/revoke`, 0 `enable rls`). Solo columnas + funciones/triggers nuevos + backfill. Las columnas nuevas heredan el GRANT a nivel tabla (no hay column-grants en el repo) - por eso el cliente PUEDE mandarlas en el payload, y por eso el force (anti-spoof) es necesario y testeado.

### Reconciliación de specs (paso 9) - Run 5

- **`design.md §2.4 (A)`**: tabla "BEFORE UPDATE?" reconciliada a SÍ para las 5 tablas de evento (+ nota del porqué: GRANT UPDATE + policy deriva del padre -> vector de spoofeo por UPDATE). `birth_calves`/`animal_category_history` documentadas como server-only / no-op.
- **`design.md §2.4 (B)`**: el trigger de identidad reconciliado a `BEFORE INSERT OR UPDATE OF` las 3 columnas.
- **`design.md §2.4 (C)`**: cabecera reconciliada - Raf eligió **(c2)** (no (c1)); describe el as-built de 0080 + el ajuste de `buildMembersQuery`/`buildOwnNameQuery` a `member_name`.
- **`requirements.md R13.3`**: nota de reconciliación - el force en UPDATE se extendió a toda tabla con GRANT UPDATE (no solo `rodeo_data_config`); criterio del precedente `animal_events`. **R13.8**: nota de reconciliación - el as-built es la variante (c2) (no se reescribe el EARS; patrón impl_13). El bloque de decisiones (B)/(C) actualizado a (b1)+(c2).
- **`tasks.md`**: T9.1 + T9.4 marcadas `[x]` con detalle del as-built; T9.6 reconciliada a (c2) y marcada `[x]`. T9.5 (swap T4 a b1) queda `[ ]` (run aparte, fuera de alcance). T9.2/T9.3/T9.7 quedan para el leader/runs posteriores.
- Sin specs contradictorias con el código.

### Pendiente / para el leader-Raf (Run 5)

1. **Gate 1 (spec)** sobre cada delta (`0077`-`0080`): verificar trigger-force fiel al padre (incl. UPDATE), backfill correcto/idempotente, stream equivalente (no más permisiva) a la RLS de la tabla, `security definer`/`search_path`. **NO aplicar antes de PASS.**
2. **APLICAR `0077`-`0080` al remoto por Management API** (BEGIN/COMMIT, body UTF-8; mismo flujo que 0075/0076) tras Gate 1 + Gate 2 + reviewer. La aplicación des-rojea los tests del paso 2 (animal: 6 + rls: 2). Sugerencia de orden: 0077 -> 0078 -> 0079 -> 0080 (independientes entre sí; 0078 no depende de 0077).
3. **YAML de streams (T9.3)** - lo arma el leader tras Gate 1: mover de "DIFERIDAS A PASO 2" a activas las 8 streams JOIN-free (`ev_weight_events`, `ev_reproductive_events`, `ev_sanitary_events`, `ev_condition_score_events`, `ev_lab_samples`, `est_animal_category_history`, `ev_birth_calves` [id sintético], `est_rodeo_data_config` [id sintético]). La identidad de animal viaja en `est_animal_profiles` (ya existe) y los nombres en `self_user_roles`/`est_members_roles` (ya existen) -> 0 streams nuevas para b1/c2. Bucket math design §2.4 ~ 43 buckets / 2 campos << 1000.
4. **AppSchema** (`schema.ts`) - si el leader quiere que la UI lea las columnas nuevas (`establishment_id` en las hijas, `animal_*` en profiles, `member_name` en user_roles) vía PowerSync, hay que reflejarlas en `AppSchema`. NO lo toqué (es parte del wiring de streams/schema del leader, T9.3). **→ HECHO en Run 6 (abajo).**
5. **Swap T4 a (b1) (T9.5)** - run aparte: `animals.ts` lee identidad desde `animal_profiles.animal_*` (no de `animals`). NO en este run.

---

## Run 6 — AppSchema refleja las columnas denormalizadas del paso 2 (materialización local)

> Cerrado. Tarea CHICA y acotada (sub-parte AppSchema de T9.3). SOLO `app/src/services/powersync/schema.ts` (+ `schema.test.ts`).
> NADA de migraciones, streams, otras lecturas, RLS. `baseline_commit` SIN cambios (multi-sesión).

### Por qué
Las migraciones `0077`–`0080` (Run 5, NO aplicadas) denormalizan columnas. El `AppSchema` define las tablas/columnas del SQLite local: **debe espejar las columnas que las streams envían** o PowerSync NO las materializa → la fila local no las tiene → las lecturas que las usan (`member_name`, identidad del animal) devuelven `undefined`. Cierra el pendiente #4 de Run 5.

### Columnas agregadas (tipo `column.text` + por qué ese tipo)

Mapeo PowerSync (PowerSync no tipa; SQLite laxo): `uuid`/`timestamptz`/`date` → `column.text`; `boolean`/`int` → `column.integer`; `numeric` → `column.real`. Verificado contra los tipos EXACTOS de las migraciones:

| Tabla | Columna(s) | Tipo migración | → `column.*` | Migración |
|---|---|---|---|---|
| `weight_events` | `establishment_id` | `uuid` | `column.text` | 0077 |
| `reproductive_events` | `establishment_id` | `uuid` | `column.text` | 0077 |
| `sanitary_events` | `establishment_id` | `uuid` | `column.text` | 0077 |
| `condition_score_events` | `establishment_id` | `uuid` | `column.text` | 0077 |
| `lab_samples` | `establishment_id` | `uuid` | `column.text` | 0077 |
| `animal_category_history` | `establishment_id` | `uuid` | `column.text` | 0077 |
| `birth_calves` | `establishment_id` | `uuid` | `column.text` | 0078 |
| `rodeo_data_config` | `establishment_id` | `uuid` | `column.text` | 0078 |
| `animal_profiles` | `animal_tag_electronic` | `text` | `column.text` | 0079 (b1) |
| `animal_profiles` | `animal_sex` | `text` | `column.text` | 0079 (b1) |
| `animal_profiles` | `animal_birth_date` | `date` | `column.text` (date→TEXT) | 0079 (b1) |
| `user_roles` | `member_name` | `text` | `column.text` | 0080 (c2) |

- `establishment_id` en las 8 hijas: espejo fiel de la fila local. El scoping del wire es **server-side** (la stream filtra `WHERE establishment_id IN org_scope`); declararlo local NO ensancha ninguna frontera de tenant (un device solo recibe filas que la stream ya scopeó).
- identidad (b1): la que la UI leerá offline en el swap T4 (no en este run).
- `member_name` (c2): el nombre que `buildMembersQuery`/`buildOwnNameQuery` (Run 5, `local-reads.ts`) YA leen — sin esta columna esas lecturas devolverían vacío offline.

### PK especial — confirmación de que NO declaré un `id` propio
`birth_calves` y `rodeo_data_config` tienen PK COMPUESTA (la stream emite un `id` sintético `(a||':'||b) AS id`). Les agregué `establishment_id` como **columna NORMAL más**, SIN declarar `id` (el SDK agrega el `id` implícito y PROHÍBE uno custom — `"An id column is automatically added..."`). `user_private` (3ra tabla de PK especial, PK `user_id`) NO recibió ninguna columna nueva → intacta. **Prueba dura**: `AppSchema.validate()` (SDK real) pasa en `schema.test.ts` — tiraría si alguna tabla declarara un `id` custom.

### Tests (`schema.test.ts`)
3 tests nuevos del paso 2 (ejercen el SDK REAL vía `toJSON()`):
- `PASO 2 (ADR-026 §A)`: las 8 tablas hijas declaran `establishment_id`; `birth_calves`/`rodeo_data_config` NO declaran `id`.
- `PASO 2 (ADR-026 §B, b1 / 0079)`: `animal_profiles` declara `animal_tag_electronic`/`animal_sex`/`animal_birth_date`.
- `PASO 2 (ADR-026 §C, c2 / 0080)`: `user_roles` declara `member_name` y NO expone `email`/`phone` (PII en user_private).
- Los asserts existentes (op_intents columns deepEqual, total = 32 tablas, PK especial sin `id`, users sin PII) siguen verdes: no agregué/quité tablas → el conteo no cambia.

### Trazabilidad R<n> → test (Run 6)
| R<n> | Cobertura | Test |
|---|---|---|
| R13.5 (materialización local de `establishment_id` denorm. de las 8 hijas para las streams del paso 2) | las 8 hijas declaran `establishment_id`; PK especial sin `id` | `schema.test.ts` :: "PASO 2 (ADR-026 §A): …" |
| R4.7 / R13.7 (b1: identidad del animal leída offline desde `animal_profiles`) | `animal_profiles` declara las 3 columnas de identidad | `schema.test.ts` :: "PASO 2 (ADR-026 §B, b1 / 0079): …" |
| R13.8 (c2: nombres de coworkers offline vía `user_roles.member_name`) | `user_roles` declara `member_name`, sin PII | `schema.test.ts` :: "PASO 2 (ADR-026 §C, c2 / 0080): …" |

### Autorrevisión adversarial (paso 8) — Run 6
Busqué activamente, como revisor hostil:
- **¿Tipos errados vs migraciones?** Verifiqué columna por columna contra `0077`–`0080`: `establishment_id` es `uuid` (×8) → text; identidad es `text`/`text`/`date` → text/text/text(date→TEXT); `member_name` es `text` → text. Cero `numeric`/`boolean`/`int` entre las nuevas → ningún `column.real`/`column.integer` correspondía. Correcto.
- **¿Declaré un `id` en alguna PK especial?** NO (verificado a mano + `validate()` del SDK pasa, que tiraría si lo hiciera). `user_private` intacta.
- **¿Ensancha alguna frontera de tenant declarar `establishment_id` local?** NO: es una vista local; el scoping vive en la stream (server-side). Un device solo baja filas ya scopeadas. No hardcodeo `establishment_id`.
- **¿PII?** NO agregué `email`/`phone` a `user_roles`; `member_name` es el `name` público (PII sigue en `user_private`, ADR-025). El test lo asserta (`!includes email/phone`).
- **¿Algún read existente rompe o cambia de comportamiento?** Revisé `local-reads.ts`: solo `rodeo_data_config` se lee local hoy y selecciona `field_definition_id, enabled` (NO `establishment_id`) → sin cambio. Eventos e identidad de animal aún NO swapeados (T9.5 `[ ]`). El único read que DEPENDE de una columna nueva es `member_name` (buildOwnNameQuery/buildMembersQuery, Run 5) — que es justo lo que este run habilita offline.
- **¿NULL/vacío?** Las columnas de identidad/`member_name` son nullables en las migraciones (solo `establishment_id` es NOT NULL server-side, irrelevante para el SQLite laxo). `column.text` tolera NULL; los mappers ya coalescen a `''`. Sin edge case roto.
- **¿Tests que pasan por la razón equivocada?** Los 3 nuevos ejercen el SDK real (`toJSON()`/`validate()`), no un mock; asertan presencia de columna en la forma emitida (no solo que el objeto JS tenga la key). El de PK especial verifica la AUSENCIA de `id` (caso reject del SDK), no solo el happy path.

**Encontrado y corregido:** nada que corregir en el código (cambio minimal y aditivo). En la pasada encontré drift de SPEC residual de Run 5 (no de mi código): la línea de la matriz de requirements.md decía "(c1: online)" y la fila §3 de design.md decía "(C)/c1: ONLINE" — contradicen el as-built (c2) que mi columna `member_name` materializa. Reconciliados (ver paso 9). R13.8 ya tenía su nota de reconciliación a (c2) de Run 5 (no la toqué).

### Reconciliación de specs (paso 9) — Run 6
- **`design.md §3`**: (a) banner de reconciliación actualizado — nombres de `users` pasan de "(c1)" a "**offline vía `user_roles.member_name` (c2)**"; (b) fila `users`/`user_roles` de la tabla corregida a "(c2): NO se sincroniza (nombre denorm. en `user_roles.member_name`)"; (c) **nuevo banner AS-BUILT `AppSchema` (paso 2)** que documenta las 12 columnas reflejadas en `schema.ts`, sus tipos (text; uuid/date→TEXT), el caso PK especial (sin `id`) y que el conteo de tablas (32) no cambia.
- **`tasks.md T9.3`**: sub-nota *(Run 6 — sub-parte AppSchema, hecha)* con las columnas reflejadas; la task sigue `[ ]` (el YAML de streams + deploy + re-Gate 1 son del leader/Raf).
- **`requirements.md`**: la matriz de cobertura (paso 2 nombres) corregida de "(c1: online)" a "(c2: offline vía `user_roles.member_name`)". El EARS de R13.8 NO se reescribe (ya tiene su nota de reconciliación a (c2) de Run 5; patrón impl_13). El "qué" no cambió: la materialización local es mecanismo de R13.5/R13.7/R13.8, no un requirement nuevo.
- Sin specs contradictorias con el código.

### Verificación (Run 6)
- `cd app && pnpm typecheck` (tsc --noEmit) → **verde**.
- `node --test … schema.test.ts` → **11/11 pass** (8 previos + 3 nuevos del paso 2; incl. `AppSchema.validate()` del SDK real).
- `node scripts/check.mjs` → typecheck client OK; **client unit tests 680/680 pass** (incl. `schema.test.ts`); lint anti-hardcode OK; suites de DB verdes salvo la **RLS suite 19/22**: los 3 rojos son los tests `member_name` de `0080` (+ su contenedor) que fallan con `column user_roles.member_name does not exist` (42703) porque `0077`–`0080` NO están aplicadas al remoto (las aplica el leader por Management API). **Pre-existente y documentado** (Run 5, L813); NO causado por este run (cambio 100% cliente — `schema.ts`/`schema.test.ts` no puede afectar un test de Postgres). Idéntico estado que antes de Run 6.

### Entregables (al leader) — resumen
- **Columnas agregadas**: tabla de arriba (12 columnas, todas `column.text`; `establishment_id` ×8 hijas, identidad ×3 en `animal_profiles`, `member_name` ×1 en `user_roles`). Tipos verificados contra `0077`–`0080`.
- **PK especial**: confirmado — `birth_calves`/`rodeo_data_config` reciben `establishment_id` como columna normal, SIN `id` propio; `user_private` intacta. `AppSchema.validate()` (SDK) pasa.
- **Estado**: typecheck verde; `schema.test.ts` 11/11; `check.mjs` con el único rojo pre-existente (RLS `member_name`, migración pendiente del leader).
