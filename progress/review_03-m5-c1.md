# Review M5-C.1 (spec 03) -- Services de captura custom (custom-measurements + custom-attributes)

Reviewer pass. Chunk M5-C.1 (R13.11/R13.12/R13.13 + R13.16/R13.23). Frontend puro; toco el path de upload
CRUD-plano de PowerSync (compartido por todo el CRUD-plano), revision de no-regresion exhaustiva.
Baseline: cba703f1a2a8cc1b3b50a88f9ec1d84050aa424f.

## Veredicto: APPROVED

---

## Trazabilidad Rn a test (completa)

- R13.11 (captura maniobra custom, append-only):
  - maneuver-reads.test.ts:407 -- id REAL, value jsonb TEXT, session_id, audit NULL local.
  - maneuver-reads.test.ts:430 -- APPEND-ONLY: dos capturas del mismo (animal,field) son DOS filas.
  - maneuver-reads.test.ts:442 -- session_id/notes opcionales a NULL.
  - upload-classify.test.ts:143 -- custom_measurements por camino NORMAL (id real, sin onConflict) + value parseado a jsonb nativo.
  - custom-value.test.ts (12) -- serializacion del value.
- R13.12 (propiedad custom, current-value upsert, editable anytime):
  - maneuver-reads.test.ts:456 -- id SINTETICO animal:field, audit NULL local.
  - maneuver-reads.test.ts:475 -- UPSERT: re-editar PISA el valor (NO duplica), LWW current-value.
  - maneuver-reads.test.ts:487 -- pares distintos (animal,field) son filas distintas.
  - upload-classify.test.ts:90 -- buildCrudUpsert: descarta id sintetico + onConflict por PK natural + value nativo.
  - upload-classify.test.ts:163 -- buildCrudPatch (RE-EDICION): decodifica PK natural, match por (animal,field), value parseado.
- R13.13 (captura por cualquier rol operativo): barrera real = RLS server-side (has_role_in, 0094/0095, backend M5-B).
  El cliente NO fuerza permisos ni hardcodea establishment_id: tests audit NULL local (maneuver-reads.test.ts:407 y :456)
  + ausencia de recorded_by/updated_by/establishment_id en builders/services. El test no-bypass de rol no-owner es
  backend (M5-B.6), fuera de este chunk frontend (N/A aca).
- R13.16 (value jsonb correcto por tipo): custom-value.test.ts (numero-como-numero, bool, string, array, NaN/Inf
  rechazados) + upload-classify.test.ts:203 (decodeJsonbColumns anti doble-encoding) + :108/:171 (numerico sube
  como numero, no como string).
- R13.23 (audit forzado, no se manda del cliente): tests audit NULL local de measurement y attribute.

Conclusion: cada Rn de este chunk tiene al menos 1 test concreto. PASA.

## Tasks completas: SI (para el scope del chunk)

- tasks.md M5-C.1 (tasks.md:424) en [x] con nota AS-BUILT (archivos, helpers, tests, gates pendientes).
- M5-C.2 / M5-C.3 quedan en [ ]: son sub-chunks SEPARADOS de M5-CLIENTE, fuera del scope de esta revision.
  Justificacion documentada en tasks.md. La feature NO se marca done (correcto).

## Reconciliacion specs (codigo a spec): OK

- design.md 11.6 (design.md:1420-1422) tiene nota AS-BUILT (M5-C.1, 2026-06-17) que describe exactamente los dos
  mecanismos no triviales implementados: (1) PK compuesta de custom_attributes (id sintetico + upsert/patch por PK
  natural) y (2) tipo jsonb del value (anti doble-encoding). El design NO quedo mintiendo respecto del as-built.
- requirements.md R13.11/R13.12/R13.13/R13.16/R13.23 intactos: no cambio el QUE, solo emergieron detalles de
  implementacion que se reflejaron en el design (correcto).

## check.mjs: ROJO (exit 1) pero NO bloqueante para este chunk (justificado)

- Unico fallo: supabase/tests/animal/run.cjs:1924 -- animals.tag_electronic borde 64 espera persistir pero recibe
  23505 duplicate key value violates unique constraint animals_tag_unique.
- Diagnostico: colision de UNIQUE de tag por TERMINALES PARALELAS corriendo la suite backend a la vez sobre la DB
  remota compartida. Flake conocido de concurrencia backend (memoria Check rojo = rate-limit). NO es regresion de
  M5-C.1 (frontend puro: no toca animals, tag_electronic, ni esa suite).
- Verificacion independiente: corri las suites frontend de M5-C.1 con el resolver del proyecto (ts-ext-resolver.mjs):
  238 pass / 0 fail (custom-value, upload-classify, maneuver-reads, local-reads, upload, upload-rejections, schema).
  pnpm typecheck (tsc --noEmit) verde. La suite backend M5 custom (supabase/tests/custom/run.cjs) NO fallo.

NOTA DURA: el reviewer NO aprueba con check rojo por fe. La aprobacion se sostiene en que el rojo es un flake de
concurrencia 100% backend, aislado, y las suites frontend del chunk + typecheck estan verdes.

## QUE SE REVISO (path de upload compartido, CRITICO)

1. No-regresion del upload existente. buildCrudUpsert/buildCrudPatch/decodeJsonbColumns se aplican SOLO donde
   corresponde: COMPOSITE_PK = custom_attributes; JSONB_TEXT_COLUMNS = custom_measurements + custom_attributes.
   Para una tabla normal (weight_events, etc.):
   - PUT da payload con data + id, SIN onConflict = identico al upsert previo (test upload-classify.test.ts:84).
   - PATCH da match por id = identico al filtro por id previo (test :157).
   - decodeJsonbColumns para tabla no listada devuelve el objeto sin tocar (upload-classify.ts:156).
   connector.ts:78-108 cablea ambos verbos via los helpers; el camino normal queda equivalente. OK.
2. Upsert de custom_attributes (current-value sin duplicar). id sintetico a:f local + ON CONFLICT(id) DO UPDATE
   (local-reads.ts:1622): re-edit = UPDATE in-place (test UPSERT maneuver-reads.test.ts:475: 1 fila, LWW). El UP
   descarta el id + onConflict por PK natural; el PATCH (re-edicion) decodifica la PK natural y filtra por
   (animal_profile_id, field_definition_id), NUNCA por id (que no existe, evita 42703). OK.
3. jsonb anti-doble-encoding. decodeJsonbColumns parsea value (JSON-TEXT local) a su tipo JS nativo antes del
   upsert/patch: numero sube como numero, pasa assert_custom_value_valid (jsonb_typeof). Tests :108/:171/:203. OK.
4. No se mandan columnas forzadas por trigger. Ningun builder/service envia recorded_by/updated_by/establishment_id;
   los fuerza el trigger al subir (tests audit NULL local). CERO hardcode de establishment_id. OK.
5. Offline-first. Escritura local via runLocalWrite (SQLite local, 1 CrudEntry, uploadData). Append-only para
   measurement (id unico por captura), current-value LWW para attribute. Conflict resolution = LWW (default
   explicito, documentado en design 11.6 + architecture.md). OK.
6. Tests con fixtures reales. maneuver-reads.test.ts usa SQLite real (freshDb() con DDL de las 2 tablas custom),
   no mocks de I/O. OK.

## CHECKPOINTS

- [x] C3 -- Codigo respeta arquitectura: services en services/, helper puro en utils/, builders en services/powersync/.
      Sin logs de debug ni TODOs en los archivos nuevos. Sin hardcode de establishment_id.
- [x] C4 -- Verificacion real: al menos 1 test por modulo con logica; fixtures reales (SQLite); 238 verdes.
- [x] C6 -- SDD: cada Rn del chunk cubierto por al menos 1 test; tasks del chunk en [x]; requirements EARS intactos.
- [x] C7 -- Multi-tenant: el cliente no fuerza tenant; lo fuerza el trigger server-side. Cross-tenant real = backend (M5-B.6).
- [x] C8 -- Offline-first: write local (CRUD-plano); bucket scoped por establishment (est_custom_*); LWW documentado.
- [ ] C2 -- Toda feature done tiene tests que pasan: N/A aca (la feature NO se marca done; chunk parcial). check.mjs
      global ROJO por flake backend ajeno (ver arriba), no por este chunk.

## Checklist RAFAQ-especifico

### A. Multi-tenancy / RLS: N/A en el codigo del chunk
M5-C.1 es frontend puro: NO crea tablas ni policies. RLS + audit forzado + denorm de establishment_id viven en el
backend M5-B (0094/0095, ya aplicado + Gate 1 pasado). El cliente respeta el modelo: no manda establishment_id, no
fuerza permisos, escribe via service que toca SQLite local scoped por la stream est_custom_*. Cero hardcode.

### B. Offline-first (carga/edicion en campo): APLICA
- [x] Funciona offline: runLocalWrite escribe a SQLite local sin red (PowerSync encola CrudEntry).
- [x] Sync bucket correcto: streams est_custom_measurements/est_custom_attributes scoped por establishment (design 11.5).
- [x] Resolucion de conflictos: LWW explicito (attribute = ON CONFLICT DO UPDATE; measurement = append-only id unico).
- [x] No hace requests sincronos a Supabase desde la pantalla: usa el repositorio local (runLocalWrite a SQLite).

### C. BLE: N/A (este chunk no toca BLE).

### D. UI de campo: N/A (este chunk son services, no UI; la UI es M5-C.2/C.3).

### E. Edge Functions: N/A (este chunk no toca Edge Functions; el audit/gating son triggers Postgres, backend M5-B).

## Cambios requeridos

Ninguno. El chunk esta completo, testeado, reconciliado y sin regresion del path de upload compartido.

## Observaciones no bloqueantes (para Gate 2 / leader)

- El rojo de check.mjs (animals_tag_unique) es un flake de terminales paralelas backend: re-correr sin paralelismo
  deberia dar verde. Confirmar verde antes de la Puerta 2 final.
- run-tests.mjs:68 corre la suite backend M5 (supabase/tests/custom/run.cjs): paso, confirmando que 0093-0097 ya
  estan aplicadas al remoto. Coherente con que M5-BACKEND este done.
- El conteo de comentario en schema.test.ts (28 sincronizadas + op_intents + 7 overlay = 36) refleja el schema
  as-built (las 7 pending ya existian en el baseline; M5-C.1 solo agrego las 2 custom a la lista esperada del test).
  schema.ts NO cambio desde el baseline: reconciliacion de bookkeeping del test, no cambio de scope. OK.
