baseline_commit: cba703f1a2a8cc1b3b50a88f9ec1d84050aa424f

# impl 03 — M5-C.1 — Services de captura custom (custom-measurements + custom-attributes)

Feature `03-modo-maniobras` (in_progress). Chunk **M5-C.1** (R13.11/R13.12/R13.13). Frontend puro
(write-path local + unit). Backend M5-BACKEND ya aplicado + verde (tablas `custom_measurements` /
`custom_attributes` + gating + RLS + audit forzado; `schema.ts` ya tiene las 2 Tables). Gate 1 N/A
para este chunk (no toca schema/RLS); reviewer + Gate 2 después.

## Plan (tasks) — TODAS DONE
- [x] T1 — Builders SQL en `local-reads.ts`: `buildAddCustomMeasurementInsert` (INSERT append-only, id REAL) +
      `buildSetCustomAttributeUpsert` (`ON CONFLICT(id) DO UPDATE`, id sintético `a:f`). Tests en `maneuver-reads.test.ts`.
- [x] T2 — `app/src/services/custom-measurements.ts` (`addCustomMeasurement`, append-only, `value` jsonb, sessionId? notes?).
- [x] T3 — `app/src/services/custom-attributes.ts` (`setCustomAttribute`, current-value upsert por PK compuesta).
- [x] T4 — GOTCHA upsert offline → connector special-case (`buildCrudUpsert`/`buildCrudPatch`/`decodeJsonbColumns` en
      `upload-classify.ts`, cableado en `connector.ts`). Unit tests del helper.
- [x] T5 — Helper PURO `app/src/utils/custom-value.ts` (`serializeCustomValue`) + tests; `node scripts/check.mjs`.
- [x] T6 — Autorrevisión adversarial + reconciliación specs (tasks M5-C.1 + design §11.6 AS-BUILT).

NO marqué la feature `done` (espera reviewer + Gate 2).

## GOTCHA upsert offline (resuelto) — custom_attributes (PK compuesta)
`custom_attributes` NO tiene columna `id` server-side (PK = `(animal_profile_id, field_definition_id)`);
la stream `est_custom_attributes` emite un `id` SINTÉTICO `animal_profile_id || ':' || field_definition_id`
para el DOWN (PowerSync exige `id` por fila). En el UP, el connector CRUD-plano hace
`table.upsert({ ...op.opData, id: op.id })` (PUT) / `.update().eq('id', op.id)` (PATCH) → ambos mandan/filtran
una columna `id` que NO existe en la tabla → PostgREST 42703 (permanente) → el rechazo se superficia y se
DESCARTA → el atributo NUNCA persiste server-side. Es el MISMO tipo de gotcha que M2.2 con los maneuver-events
(donde `ON CONFLICT` no sube bien → UPDATE explícito) y el motivo por el que `rodeo_data_config`/`birth_calves`
(las otras 2 PK-compuestas) van por OUTBOX/RPC (`set_rodeo_config`), nunca por CRUD-plano.

Decisión (sin DB/deploy, dentro del scope "write-path local + connector"):
1. Local: `setCustomAttribute` escribe con `id` sintético determinístico = `${animalProfileId}:${fieldDefinitionId}`
   (mismo que aliasa la stream) vía `INSERT ... ON CONFLICT(id) DO UPDATE SET value=...` → re-editar el mismo
   par actualiza el current-value EN EL LUGAR (LWW, sin duplicar), no inserta una 2da fila. Cada write es un PUT
   de la fila completa → `op.opData` siempre porta `animal_profile_id`/`field_definition_id`/`value`.
2. Upload: en `connector.ts`, para la tabla `custom_attributes` (PK compuesta, sin columna id real) se hace
   `table.upsert(op.opData, { onConflict: 'animal_profile_id,field_definition_id' })` SIN inyectar `id`
   (helper puro `buildCrudUpsert` testeable). El resto de las tablas CRUD-plano siguen igual (`id` real).
   `recorded_by`/`updated_by`/`establishment_id` los FUERZA el trigger al subir → no van en el payload.

`custom_measurements` es append-only con `id` uuid REAL → CRUD-plano normal (sin special-case), espeja `events.ts`.

## Archivos
- NUEVOS: `app/src/services/custom-measurements.ts`, `app/src/services/custom-attributes.ts`,
  `app/src/utils/custom-value.ts`, `app/src/utils/custom-value.test.ts`.
- MODIF: `app/src/services/powersync/local-reads.ts` (2 builders), `app/src/services/powersync/maneuver-reads.test.ts`
  (schema custom + 8 tests), `app/src/services/powersync/upload-classify.ts` (`buildCrudUpsert`/`buildCrudPatch`/
  `decodeJsonbColumns` + tipos), `app/src/services/powersync/upload-classify.test.ts` (18 tests),
  `app/src/services/powersync/connector.ts` (PUT/PATCH usan los helpers), `scripts/run-tests.mjs` (registra `custom-value.test.ts`).
- SPECS: `design.md §11.6` (AS-BUILT), `tasks.md M5-C.1` ([x] + AS-BUILT).

## Mapa R<n> → test
- **R13.11** (captura maniobra custom append-only) →
  - `maneuver-reads.test.ts`: "buildAddCustomMeasurementInsert: inserta una captura con id REAL, value jsonb TEXT, session_id; audit NULL local"
  - `maneuver-reads.test.ts`: "buildAddCustomMeasurementInsert: APPEND-ONLY — dos capturas … son DOS filas"
  - `maneuver-reads.test.ts`: "buildAddCustomMeasurementInsert: session_id y notes opcionales → NULL"
  - `upload-classify.test.ts`: "buildCrudUpsert: custom_measurements … value SÍ se parsea a jsonb nativo"
  - (serialización del value) `custom-value.test.ts` (los 12)
- **R13.12** (propiedad custom current-value upsert, editable anytime) →
  - `maneuver-reads.test.ts`: "buildSetCustomAttributeUpsert: inserta el current-value con id SINTÉTICO; audit NULL local"
  - `maneuver-reads.test.ts`: "buildSetCustomAttributeUpsert: UPSERT — re-editar … PISA el valor (NO duplica)"
  - `maneuver-reads.test.ts`: "buildSetCustomAttributeUpsert: distintos (animal, field) son filas distintas"
  - `upload-classify.test.ts`: "buildCrudUpsert: custom_attributes … DESCARTA el id sintético + onConflict por la PK natural + value PARSEADO"
  - `upload-classify.test.ts`: "buildCrudPatch: custom_attributes (RE-EDICIÓN) → decodifica la PK natural … + value parseado"
- **R13.13** (captura por cualquier rol operativo) → barrera real es la RLS server-side (`has_role_in`, 0094/0095):
  el cliente NO fuerza permisos ni hardcodea establishment_id (audit forzado por trigger). Verificado en el write-path:
  ningún builder/service manda `recorded_by`/`updated_by`/`establishment_id` (tests "audit NULL local" arriba) → el
  trigger los fuerza para CUALQUIER rol con `has_role_in`. (El test no-bypass de rol operativo no-owner es backend, M5-B.6(c).)
- **R13.16** (value jsonb correcto por tipo) → `custom-value.test.ts` (número como número JSON, bool, string, array) +
  `upload-classify.test.ts` `decodeJsonbColumns` (anti doble-encoding: número sube como número, no `"385"`).
- **R13.23** (audit forzado, no se manda del cliente) → los tests "audit NULL local" de measurement y attribute.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
1. **¿El upsert de attribute actualiza el current-value sin duplicar?** Sí (test UPSERT: 1 fila, LWW). El id
   sintético = el alias de la stream → al bajar la fila real, LWW sobre la misma fila (sin duplicado).
2. **CACÉ el gotcha REAL del UPLOAD (no estaba en mi 1er intento).** Mi 1er enfoque (`ON CONFLICT(id) DO UPDATE`
   local + connector que solo arreglaba el PUT) tenía un bug: en una RE-EDICIÓN, SQLite resuelve por el branch
   UPDATE → PowerSync trackea un PATCH con SOLO `value` y el id sintético → el connector PATCH habría filtrado
   por `.eq('id', 'a:f')` → 42703 → la re-edición NO subiría. Cerrado: `buildCrudPatch` decodifica la PK natural
   del id sintético y filtra por `(animal_profile_id, field_definition_id)`. Tests del PATCH agregados.
3. **CACÉ la 2da capa: el TIPO del jsonb `value` (doble-encoding).** El value serializado a JSON-TEXT, subido como
   string JS, PostgREST lo escribiría como jsonb-STRING → `assert_custom_value_valid` (0096) valida `jsonb_typeof`
   y rechazaría un número double-encodeado (`"385"`). Era exactamente la "lección config jsonb" de M2.2. Cerrado:
   `decodeJsonbColumns` parsea `value` a nativo antes del upsert/patch. Tests numérico/bool/string/array agregados.
4. **NaN/Infinity y arrays mal tipados** → `serializeCustomValue` los rechaza (JSON.stringify los volvería `null`/
   rompería la validación). Tests de borde agregados (NaN, ±Inf, array con no-string, null/undefined/objeto).
5. **No mando columnas forzadas por trigger** (recorded_by/updated_by/establishment_id) → verificado en los builders
   (tests "audit NULL local") y en los services (no hay esas keys en el input).
6. **Multi-tenant**: cero hardcode de establishment_id; el caller pasa profileId/fieldDefinitionId/sessionId reales.
7. **No regresión del CRUD-plano de las demás tablas**: `buildCrudUpsert` para tabla normal devuelve `{...data, id}`
   sin onConflict (= `table.upsert({...opData, id: op.id})` original); `buildCrudPatch` filtra por `{id}`. Tests de
   tabla normal + las 170 de las suites powersync (upload/schema/local-reads/upload-rejections) verdes.

## Observaciones para el reviewer / Gate 2 (no-bloqueantes)
- **session_id de custom_measurements sin tenant-check server-side**: el backend (0094) NO le puso
  `tg_event_session_tenant_check` (a diferencia de los eventos tipados, 0056). Es una decisión de M5-BACKEND que
  Gate 1 ya pasó; el cliente NUNCA spoofea session_id (lo deriva del contexto de manga real). No lo toco (backend).
- **Corrección in-jornada de una custom_measurement (R5.9 parity)**: este chunk es append-only (siempre id nuevo).
  Si M5-C.3 (render genérico) necesita corregir una captura con el MISMO id (UPDATE), hará falta un
  `buildUpdateCustomMeasurement` (id REAL → `.update().eq('id',...)`, sin gotcha). Anotado para C.3, no es gap de C.1.

## Reconciliación de specs (paso 9)
- `design.md §11.6`: agregada nota AS-BUILT documentando los 2 mecanismos de implementación no triviales
  (PK compuesta de custom_attributes + tipo jsonb del value) que NO estaban en el fold y emergieron al construir.
- `tasks.md M5-C.1`: `[x]` + nota AS-BUILT (archivos, helpers, tests, gates pendientes).
- No cambió el *qué* (R13.11/R13.12/R13.13/R13.16 intactos) → no hace falta nota de reconciliación bajo los EARS.
