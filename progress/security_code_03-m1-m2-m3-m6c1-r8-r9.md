# Security Code Review — Spec 03 MODO MANIOBRAS · M1 + M2 + M3 + M6-C.1 + R8.4 + R9.x (CLIENTE)

**Modo**: `code` (Gate 2, ADR-019)
**Fecha**: 2026-06-19
**Analista**: security_analyzer (Opus 4.8 1M)
**Skill**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability aplicada; referencia `injection.md` cross-checkeada para el allow-list de table/column names)
**HEAD auditado**: `0a99fe0`

## Veredicto

**PASS — 0 findings HIGH.**

Las superficies de cliente de M1 (config de jornada), M2 (identificación + frame de carga), M3 (las 12 maniobras → write-paths de evento), M6-C.1 (circunferencia escrotal write-path), R8.4 (preview de transición display-only) y R9.x (lote en wizard) NO introducen ninguna vulnerabilidad explotable de alta confianza. Es frontend sobre el backend YA gateado (migraciones 0050-0057 + 0070 + 0091 + 0093-0100, Gate 1 done): el patrón "el cliente NUNCA es la autoridad" se sostiene íntegro. Todo write es CRUD-plano local (offline) re-validado por RLS + triggers + CHECK al SUBIR; toda query con string-interp usa allow-list de identificadores y todo VALOR va parametrizado en `args`. Hay 2 findings MEDIUM (defensa en profundidad: `maxLength` UX ausente en inputs de texto libre — el cap autoritativo server-side EXISTE y está validado) que NO bloquean.

**T2.12 CERRADO** (confirmación explícita al pie).

## Alcance exacto auditado (estado actual de HEAD `0a99fe0`)

- **M1**: `app/src/services/sessions.ts`, `maneuver-presets.ts`, `app/src/utils/maneuver-gating.ts`, `maneuver-config.ts`, `maneuver-wizard.ts`, `app/app/maniobra/jornada.tsx`, `_components/ManeuverConfigSheet.tsx`, `SavePresetSheet.tsx`.
- **M2**: `app/app/maniobra/identificar.tsx`, `carga.tsx`, `app/src/utils/maniobra-identify.ts`, `_components/CandidatePicker.tsx`, `OtherRodeoSheet.tsx`, `ExitJornadaSheet.tsx`.
- **M3**: `app/src/services/maneuver-events.ts`, `app/src/utils/maneuver-event-query.ts`, los `*Step.tsx` (Tacto, Pesaje, Dientes, SilentSanitary, SilentVaccination, LabSample, LabDouble, Inseminacion, CondicionCorporal, TactoVaquillona), y los builders de evento en `app/src/services/powersync/local-reads.ts` (líneas 1099-1643).
- **M6-C.1**: `app/src/services/scrotal.ts` + `buildAddScrotalInsert`/`buildUpdateManeuverScrotal`/`buildScrotalHistoryQuery` (`local-reads.ts:1462-1514`) + `CircunferenciaEscrotalStep.tsx`.
- **R8.4**: `app/src/utils/maneuver-category-preview.ts`, `app/src/services/animals.ts` (`fetchRodeoCategoryCatalog`, `:1513`).
- **R9.x**: `_components/LotePickerSheet.tsx`, `app/src/utils/lote-picker.ts`, el call-site de `assignAnimalToGroup` en `carga.tsx:671`.
- **Builders de sesión/preset**: `local-reads.ts:2197-2435`.

**Fuera de alcance (NO re-auditado, ya gateado)**: M4/M4.1.1/M4.2 (`security_code_03-m4-m4.2.md`), M5 cliente (`security_code_03-m5-client.md`), M6-C.2 (display read-only, N/A documentado). **Ignorado (terminal paralela spec 08)**: working tree sin commitear, `app/src/services/sigsa/**`, `specs/active/08-*`, `progress/*_08-sigsa-*`, `RAFAQ-resumen-app.*`, `design/veto-*`.

> Nota de baseline: el prompt fijó la unidad de auditoría como el **estado actual de HEAD** de la lista exacta de superficies (los chunks tienen baselines solapados: M1/M2 desde `6308ff5`, M2.2 desde `f518ea5`, M3 desde `638679f`, M6-C.1 desde `a03e593`). Se auditó el estado as-built de cada archivo listado, no un rango de diff único.

## Findings HIGH

**Ninguno.**

El patrón de fondo es sólido y heredado de los dos Gate 2 previos de spec-03: **el cliente nunca es la autoridad**. Cada vector pedido (SQL-injection en builders SQLite, IDOR por PK de cliente, mass-assignment, tenant scoping, validación de inputs, find-or-create de la manga) está cerrado por una barrera server-side que el cliente no puede tocar, y el cliente está construido para NO mandar lo que el server fuerza.

## Verificación por superficie (trace-data-flow + verify-exploitability)

### 1. SQL injection en los builders SQLite — CERRADO

**TODOS los builders en scope son parametrizados.** Cada VALOR (id, profileId, sessionId, pesos, scores, product_name, tube_number, pajuela, CE, fechas, establishment_id) va en `args: [...]`; no hay concatenación de input de usuario al string SQL. Las ÚNICAS interpolaciones `${...}` son de IDENTIFICADORES bajo **allow-list** (regla §3 de `injection.md`: lo no-parametrizable es seguro con allow-list):

- `buildSoftDeleteEventUpdate` (`local-reads.ts:1099-1104`): `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`. `table` es del tipo `DeletableEventTable = 'sanitary_events' | 'reproductive_events'` (`:1078`, unión TS = allow-list) y `softDeleteManeuverEvents` (`maneuver-events.ts:80`) tipa su param como `DeletableEventTable` → un string arbitrario NO compila/no llega. `eventId` va en `args`. No inyectable.
- `buildSearchLikeQuery` (`local-reads.ts:810-823`): `ap.${column} LIKE ? ESCAPE '\'`. `column` recibe SOLO literales hard-coded del service (`'idv'` / `'animal_tag_electronic'` / `'visual_id_alt'`, `animals.ts:472/479/492`) — nunca input de usuario. El TÉRMINO va en `args` con `escapeLike` (`:830`) neutralizando comodines `% _ \` + `ESCAPE '\'` → un `%`/`_` literal del usuario NO actúa de comodín (LIKE-injection cerrado).
- `buildManeuverPresetsQuery` (`:2417`): el arg de `notHiddenByOverride('maneuver_presets', 'mp.id', ['soft_deleted'])` son literales, no input.

**Conclusión**: cero vector de SQL injection. Mismo patrón ya vetado en M5 (`security_code_03-m5-client.md` §3).

### 2. Tenant scoping de los writes — CERRADO

- **sessions** (`sessions.ts` + `local-reads.ts:2241-2370`): `buildCreateSessionInsert` lista columnas explícitas (`id, establishment_id, rodeo_id, config, status='active', work_lot_label, animal_count=0, event_count=0, started_at`); `established_id` lo aporta el caller del contexto activo (`CreateSessionInput.establishmentId`, NUNCA hardcode, `sessions.ts:99-100`). `created_by` lo FUERZA `tg_force_created_by_auth_uid` (0050) al subir; el `tg_sessions_rodeo_check` (0050) re-valida rodeo del mismo establishment + activo; la RLS `sessions_insert/_update = has_role_in` re-valida tenant. `closeActiveSessions` (`:2284`) scopea `WHERE establishment_id = ? AND status='active' AND deleted_at IS NULL` (parametrizado). El SQLite local ya está acotado por la stream `est_sessions` (`sync-streams`, scope por `establishment_id IN org_scope`) → el UPDATE masivo solo alcanza filas del propio tenant.
- **presets** (`maneuver-presets.ts` + `local-reads.ts:2380-2435`): `buildCreateManeuverPresetInsert` lista `(id, establishment_id, name, config)` explícito; `created_by` forzado por trigger; RLS `maneuver_presets_insert/_update = has_role_in`. `softDeletePreset` por RPC SECURITY DEFINER `soft_delete_maneuver_preset` (0057, has_role_in) vía OUTBOX (sortea el gotcha RLS-on-RETURNING). Sin hardcode de establishment.
- **eventos de maniobra** (`maneuver-events.ts` + `maneuver-event-query.ts` + builders `:1192-1643`): cada INSERT de evento manda SOLO columnas de dato + `session_id` + (`profileId`); `created_by`/`establishment_id`/`created_at`/`source` los FUERZA el trigger server-side (R5.12) → NO se mandan (banner `local-reads.ts:1167-1176`). El `establishment_id` lo DERIVA el trigger del PERFIL (`tg_force_establishment_id_from_profile` 0077) — anti-spoof: un user con rol en campo B no puede escribir sobre un animal de campo A (el server recomputa el establishment del perfil A → RLS `has_role_in` lo bloquea). El tenant-check del `session_id` (`tg_event_session_tenant_check`, 0056) valida al subir que la sesión sea del mismo establishment que el animal (23514 si no). El gating capa 2 (0054 + 0091) re-valida fail-closed.
- **scrotal** (`scrotal.ts` + `buildAddScrotalInsert` `:1462`): INSERT con `(id, animal_profile_id, circumference_cm, age_months, measured_at, session_id)`; `establishment_id`/`recorded_by`/`source` los fuerza el trigger/default (0098, reusa 0077 anti-spoof) → NO se mandan. Gating `tg_scrotal_gating` (0100 'circunferencia_escrotal') + tenant-check sesión (0052) fail-closed al subir. `circumference_cm` CHECK 20-50 (`0098:43`) autoritativo.
- **lote** (`assignAnimalToGroup`, call-site `carga.tsx:671`): UPDATE local de `animal_profiles.management_group_id`; `groupId` viene del picker (grupos del campo activo, `groups`), no input libre; tenant-check del lote (0037 mismo establishment) + RLS `has_role_in` re-validan al subir.

**Anti-spoof CONFIRMADO**: `created_by`/`recorded_by`/`establishment_id` NUNCA se mandan desde el cliente en ningún write en scope. Verificado builder por builder.

### 3. Gating doble capa (capa-1 UX vs capa-2 DB fail-closed) — CERRADO

La capa 1 (`maneuver-gating.ts`, aplicabilidad/UI) es UX. La barrera real es la capa 2 DB (fail-closed 23514): `tg_*_gating → assert_data_keys_enabled` (0054/0091/0100) + `assert_custom_field_enabled` (0096). Un evento de una maniobra deshabilitada en el rodeo que el cliente fuerce SUBE pero es RECHAZADO server-side (23514) → el rechazo lo descarta + superficia `uploadData` (R10.8, dead-letter observable — ver `security_code_03-m4-m4.2.md` §2), NO fail-open. El cliente NO puede ELUDIR un gate: el write local "tiene éxito" offline por contrato T5, pero la autorización real es al subir.

### 4. IDOR / PK de cliente — CERRADO

Los UUID de cliente (eventId, sessionId, presetId, scrotal id) son PK; los UPDATE de corrección (`buildUpdateManeuver*`) filtran por `id = ?` (+ `event_type`/`deleted_at IS NULL`). La barrera contra pisar/leer una fila ajena es **RLS-on-the-existing-row** (la policy UPDATE evalúa la fila EXISTENTE con `has_role_in`/owner|autor) + el SQLite local ya tenant-scopeado por las streams (un id ajeno no existe localmente). Un `id` forjado contra otro tenant no escribe nada (mismo razonamiento que M5 §1/§3). `buildSessionByIdQuery`/`buildScrotalHistoryQuery`/`buildManeuverPresetByIdQuery` son lecturas locales sobre el dataset ya acotado al tenant → sin IDOR cross-tenant (CWE-639 descartado: la clave no alcanza datos ajenos).

### 5. Inputs de usuario — bounded + validación autoritativa server-side (ver tabla)

Cada campo que el operario tipea tiene un cap AUTORITATIVO server-side (CHECK de 0070, validado, columnas de evento; CHECK 0098 para CE; enums/selectores cerrados para tacto/score/vaquillona/dientes). Los caps client-side son UX. Detalle:

- **número de tubo** (LabSampleStep `:79,85`): `maxLength=64` + `.slice(0,64)` ↔ `lab_samples.tube_number` CHECK ≤64 (0070 R1.35, **validated**). OK.
- **product_name** sanitarias (SilentSanitaryStep `:153`) y vacunación (SilentVaccinationStep `:144`): **sin `maxLength` client-side** ↔ `sanitary_events.product_name` CHECK ≤160 (0070 R1.30, **validated**) autoritativo. → MED-1 (UX), no hueco.
- **pajuela** (InseminacionStep → delega en SilentSanitaryStep, sin maxLength): persiste a `reproductive_events.notes` CHECK ≤4000 (0070 R1.28, **validated**). → MED-1.
- **peso** (PesajeStep keypad `:82`): cap 5 dígitos en el keypad custom (solo dígito/decimal/backspace, no TextInput libre); numérico → CHECK server `weight_events.weight_kg`. Bounded.
- **score / tacto / vaquillona / dientes**: selectores CERRADOS (enum) → enum válido al subir. No texto libre.
- **CE** (CircunferenciaEscrotalStep `:350,355`): `maxLength=CE_DRAFT_MAXLENGTH` + `sanitizeCmTyping` + `snapToWheel(cm, CE_WHEEL)` al confirmar (`:179`) → snapeado/clampeado al rango; CHECK 20-50 (0098) autoritativo. Bounded numérico.
- **nombre de preset** (SavePresetSheet `:203`): `maxLength=60` ↔ `maneuver_presets.name` CHECK ≤120 (0070 R1.45, validated). OK.
- **búsqueda manual** (identificar.tsx `ManualEntry:1091`): **sin `maxLength` UX**, PERO el corte AUTORITATIVO es `classifySearchQuery` → `query.slice(0, SEARCH_TERM_MAX_LENGTH=64)` (`animal-identifier.ts:120`, server-consumido antes de toda query) + `escapeLike`. El término llega a `searchAnimals` ya capeado a 64 + comodines escapados. → MED-2 (UX), no hueco (no es DoS ni LIKE-injection: bounded + escaped).

### 6. find-or-create de la manga (T2.12 / R4.6 / SEC-SPEC-03-05) — CERRADO

- `lookupByTag(eid, establishmentId)` (`identificar.tsx:157`) y `searchAnimals(establishmentId, trimmed)` (`:199`) van scopeados por `establishmentId = est.current.id` (contexto activo, `:88`, NUNCA hardcode).
- `maniobra-identify.ts` es un mapper PURO (sin I/O, sin SDK): traduce el lookup a `IdentifyOutcome` y, para `unknown`, precomputa los params de prefill (`resolvePrefilledCreateParams`, `:229`) — solo el identificador (tag/idv/visual). NO introduce param de tenant.
- El alta del desconocido (`onDarDeAlta`, `:342`) hace `router.push('/crear-animal', { ...prefilled, sessionId })` → REUSA la ruta `/crear-animal` existente. En `crear-animal.tsx`: `establishmentId` se deriva del CONTEXTO (`estState.current.id`, `:120`), NO de los params de la manga; los params de la manga son solo `tag`/`idv`/`visual` (leídos con guards `typeof === 'string'`, `:130-132`) + `sessionId` (`:147`). `createAnimal({ establishmentId, ... })` (`:433`) es el MISMO service de spec 02/09: `created_by` + identidad denormalizada FORZADOS por trigger al subir (`animals.ts:781-782`), RPC ATÓMICA idempotente `create_animal` (0083, ON CONFLICT por id de cliente → at-least-once no duplica), UNIQUE de `tag_electronic` preservado server-side.

**CONFIRMACIÓN T2.12**: el find-or-create inline de la manga NO introduce params de tenant nuevos NI un camino de alta paralelo. Reusa `lookupByTag`/`searchAnimals` con el establishment del contexto y `createAnimal` (UNIQUE + created_by-forzado + establishment-del-contexto + idempotencia RPC) tal cual el alta as-built. **T2.12 cerrado.**

### 7. R8.4 preview + lote-picker — INERTES (display-only / pure)

- `maneuver-category-preview.ts`: PURO, display-only, sin I/O ni write ni input de usuario; fail-safe (null ante cualquier incertidumbre). Reusa el espejo C6 `computeCategoryCode` (cero re-implementación). `fetchRodeoCategoryCatalog` lee el catálogo global del sistema (read-only, sin dato de tenant, sin write).
- `lote-picker.ts`: PURO, arma la lista de opciones (Sin lote + grupos del campo); sin I/O, sin input persistido.

## Tabla de inputs (campos nuevos/modificados que el usuario tipea)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| número de tubo (LabSample) | `maxLength=64` + slice | **server** `lab_samples.tube_number` CHECK ≤64 (0070 R1.35 validated) | OK |
| product_name sanitaria (SilentSanitary) | sin maxLength cliente | **server** `sanitary_events.product_name` CHECK ≤160 (0070 R1.30 validated) | OK (cap server) → MED-1 UX |
| product_name vacuna (SilentVaccination) | sin maxLength cliente | **server** ídem ≤160 validated | OK (cap server) → MED-1 UX |
| pajuela (Inseminacion→SilentSanitary) | sin maxLength cliente | **server** `reproductive_events.notes` CHECK ≤4000 (0070 R1.28 validated) | OK (cap server) → MED-1 UX |
| peso (Pesaje keypad) | 5 dígitos (keypad custom, no TextInput) | **server** `weight_events.weight_kg` numeric CHECK | OK |
| score / tacto / vaquillona / dientes | selector CERRADO (enum) | **server** enum 0053/0020 | OK |
| CE (CircunferenciaEscrotal rueda+input) | `maxLength=CE_DRAFT_MAXLENGTH` + snap/clamp al rango | **server** `scrotal_measurements.circumference_cm` CHECK 20-50 (0098) | OK |
| nombre de preset (SavePresetSheet) | `maxLength=60` | **server** `maneuver_presets.name` CHECK ≤120 (0070 R1.45 validated) | OK |
| término de búsqueda manual (identificar) | sin maxLength UX; **slice(0,64) autoritativo** en `classifySearchQuery` + escapeLike | **server-consumido** `SEARCH_TERM_MAX_LENGTH=64` (animal-identifier.ts:120) | OK (cap real) → MED-2 UX |
| work_lot_label (R9.4) | (preexistente, no tocado por estos chunks) | server `sessions.work_lot_label` CHECK ≤120 (0070 R1.43) | OK |

**Conclusión inputs**: CADA campo de entrada tiene límite + validación autoritativa server-side (CHECK de DB o enum cerrado). Ningún texto libre llega a la DB sin cota. Cumple el mandato de Raf ("límites claros y validación en cada formulario").

## Tabla de rate limits (acciones abusables tocadas por el delta)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| createSession / closeSession / closeActiveSessions | n.a. | per-establishment (scope stream) | sí (close-all antes del insert) | CRUD-plano offline; sin costo server por request, sin email/SMS/API externa, sin fan-out. No abusable. |
| createPreset / updatePreset / softDeletePreset | n.a. | per-establishment | — | CRUD-plano + RPC soft-delete (has_role_in). Sin fan-out. |
| persistManeuverEvent (los 12 write-paths) | n.a. | per-perfil (establishment derivado del perfil) | — | INSERT/UPDATE local offline. Multi-write acotado (raspado=2, vacunación=N productos elegidos, no atacable). Sin API externa. |
| addScrotalMeasurement | n.a. | per-perfil | — | INSERT local offline. Sin costo server. |
| assignAnimalToGroup (lote) | n.a. | per-establishment | — | UPDATE local offline. Sin fan-out. |
| searchAnimals / lookupByTag (manual + BLE) | n.a. | per-establishment (scope) | — | LECTURA local sobre SQLite (sin roundtrip server por keystroke); término capeado a 64 + escaped. No es DoS de DB ni enumeración cross-tenant. |
| createAnimal (find-or-create) | n.a. | per-establishment (contexto) | — | RPC idempotente offline; no manda email/SMS/API externa. Mismo perfil de abuso que el resto del CRUD offline (sin regresión). |

Ninguna acción nueva manda email/SMS, pega a API externa, ni es bulk con fan-out por request. NO se tocó `[auth.rate_limit]` de `config.toml`. N/A justificado.

## Checklist RAFAQ-específico

- **RLS / sync rules (C1/C2)**: `est_sessions`, `est_maneuver_presets` y las 6 tablas de evento + `scrotal_measurements` scopeadas por `establishment_id IN org_scope`. Las queries nuevas NO ensanchan la superficie sincronizada. OK.
- **Service-role / `createAdminClient` (A1)**: NINGÚN cambio en scope usa service-role. Todo es CRUD-plano cliente sujeto a RLS. N/A.
- **Mass assignment (A2)**: TODOS los INSERT listan columnas explícitas (verificado builder por builder, `local-reads.ts:1192-2435`). CERO spread de `body` del cliente. `created_by`/`recorded_by`/`establishment_id`/`source`/`created_at` los fuerza el trigger. OK.
- **Information disclosure (B1)**: ningún `err.message`/`error.message` crudo se devuelve al usuario en estos chunks. Los errores de UI son strings es-AR genéricos (`ManeuverErrorBanner`, "No se pudo cambiar el lote…"). El surfacing de rechazos (R10.8) usa motivos hardcodeados (auditado en M4.2). OK.
- **Secrets (D)**: cero secretos hardcodeados. El único `console.log` (`maniobra/rueda-ce.tsx:78`) es del SPIKE M6-C.0 (mock, "no se guarda"), NO en el write-path real (`CircunferenciaEscrotalStep.tsx`) ni en ningún archivo en scope; no loguea PII/token. OK.
- **Validación de inputs**: ver tabla. Cada campo tiene cap server-side autoritativo. 2 MEDIUM de defensa-en-profundidad (maxLength UX). OK material.
- **Rate limiting**: ver tabla. Sin acción abusable nueva (sin Edge Function, email/SMS, API externa, bulk fan-out). N/A.
- **Offline/sync (C)**: stale-auth en replay (C4): el server re-autoriza cada upload (RLS + triggers + gating); un rol revocado entre la edición offline y el sync rechaza el upload → R10.8 lo superficia (no fail-open). LWW por PK de cliente; idempotencia por id estable. OK.
- **BLE (G)**: la lectura del bastón (EID) llega YA validada+dedupeada del provider (parser-rs420, spec 04 ya gateada en su Gate 2); `identificar.tsx` solo la enruta a `lookupByTag` (lectura local). El EID NO se auto-persiste como verdad: el `unknown` por bastón pasa por el flujo find-or-create de confirmación (G3 respetado). No se toca el trust boundary de BLE en estos chunks. OK.

## Findings MEDIUM (defensa en profundidad — NO bloquean)

- **MED-1 · `product_name`/`pajuela` sin `maxLength` client-side** — `SilentSanitaryStep.tsx:153` (`TextInput` del producto) y `SilentVaccinationStep.tsx:144` (`vaccine-input`) no ponen `maxLength`; InseminacionStep hereda lo mismo via SilentSanitaryStep. El cap autoritativo EXISTE y está validado (`sanitary_events.product_name` ≤160 / `reproductive_events.notes` ≤4000, 0070), así que NO es hueco de seguridad. Por paridad con label/tubo/preset (que sí limitan UX) y para que el operario no escriba de más y reciba un rechazo de sync recién al subir, conviene un `maxLength` UX (p.ej. 160 alineado al CHECK). Idéntico al MED del `text` ui_component en `security_code_03-m5-client.md` (M-1). Backlog.
- **MED-2 · término de búsqueda manual sin `maxLength` UX** — `identificar.tsx:1091-1104` (`ManualEntry`) no pone `maxLength` en el `TextInput` de búsqueda. NO es hueco: `classifySearchQuery` recorta autoritativamente a 64 (`animal-identifier.ts:120`, server-consumido) + `escapeLike` neutraliza comodines → bounded + no LIKE-injection + no DoS de DB. El comentario de `animal-identifier.ts:22` indica que el buscador DEBE importar `SEARCH_TERM_MAX_LENGTH` como `maxLength` UX; el de la manga no lo hace (otros buscadores de la app sí). Mejora de UX/paridad. Backlog.

## False positives descartados (trazabilidad)

- **`${table}` en `buildSoftDeleteEventUpdate` como SQL injection** — DESCARTADO. `table` está acotado por la unión TS `DeletableEventTable` (allow-list, regla §3 `injection.md`); `softDeleteManeuverEvents` tipa el param. Un string arbitrario no llega. El `eventId` va parametrizado.
- **`${column}` en `buildSearchLikeQuery` como SQL injection** — DESCARTADO. `column` recibe solo literales hard-coded del service; el término va en `args` con `escapeLike` + `ESCAPE '\'`.
- **PK de cliente (eventId/sessionId) como IDOR** — DESCARTADO. RLS-on-the-existing-row + SQLite local tenant-scopeado por las streams → un id ajeno no existe localmente y la policy UPDATE evalúa la fila existente con `has_role_in`.
- **`console.log` en `rueda-ce.tsx:78`** — DESCARTADO. Es el harness SPIKE M6-C.0 (mock, "no se guarda"), no el write-path real ni un archivo en scope; no loguea secreto/PII.
- **find-or-create como camino de alta paralelo (T2.12)** — DESCARTADO. Reusa `/crear-animal` → `createAnimal` con establishment del contexto (no de params) + created_by forzado + RPC idempotente. Sin param de tenant nuevo.
- **`config` jsonb pass-through como injection** — DESCARTADO. Se serializa con `JSON.stringify` y va parametrizado a SQLite (TEXT) / casteado a jsonb por PostgREST al subir; `JSON.parse` no ejecuta código. CHECK `sessions_config_size`/`maneuver_presets_config_size` ≤16384 (0050/0051) lo acota al subir.

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia del agente)

- **RLS / triggers / gating server-side**: la skill de Sentry no evalúa RLS/triggers de Postgres. Se verificó MANUALMENTE que las queries/builders nuevos se apoyan en RLS existente (`sessions_*`, `maneuver_presets_*`, eventos `is_owner_of|created_by`, `animal_profiles_update = has_role_in`) + triggers ya vigentes (0050/0056/0077/0054/0091/0098/0100/0037) + CHECK de 0070/0098. La frontera server-side YA pasó Gate 1 — no re-auditada; solo se confirmó que el CLIENTE no la elude (audit forzado, establishment derivado del perfil, gating fail-closed 23514).
- **PowerSync upload-path**: la skill no modela el connector offline. Se trazó a mano write-local → CrudEntry → `uploadData` → PostgREST + RLS/triggers/CHECK. Sin hueco: el write local "tiene éxito" offline (T5) pero el server re-gatea al subir; un rechazo se descarta + superficia (R10.8), no persiste.
- **Deno / Edge Functions**: N/A — estos chunks no tocan Edge Functions.

## Requirements cubiertos (trazabilidad de seguridad)

R1.9-R1.11 (sesión offline, id cliente, scoping), R2.1-R2.5 (presets scope establishment), R4.1/R4.5/R4.6 (find-or-create inline), R5.8-R5.12 (eventos con session_id, created_by forzado), R6.1-R6.15 (las 12 maniobras, gating capa 2), R8.4 (preview display-only), R9.1-R9.4 (lote opcional/manual), R10.6-R10.8 (single-active + rechazo visible), R14.9/R14.10 (CE audit forzado + write-path). Design AS-BUILT consistente con el código.

---

**Línea T2.12**: T2.12 CERRADO — el find-or-create inline de la manga (`identificar.tsx` → `lookupByTag`/`searchAnimals` con establishment del contexto; alta de desconocido → `/crear-animal` reusa `createAnimal` con establishment-del-contexto + created_by-forzado + RPC idempotente + UNIQUE de tag preservado) NO introduce params de tenant nuevos ni un camino de alta paralelo.
