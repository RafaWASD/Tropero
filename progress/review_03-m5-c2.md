# Review — spec 03 M5-C.2 — UI de CREACION de datos/maniobras custom (R13.5-R13.9)

Reviewer: reviewer (Opus 4.8). Fecha: 2026-06-17. Baseline: bf82ccde.

## Veredicto: APPROVED

Frontend puro (no toca schema/RLS/migraciones; backend M5-BACKEND 0093-0097 ya aplicado + gateado).
El contrato cliente->server (0093) se respeta EXACTAMENTE; la decision de scope C.2/C.3 esta sana y NO
deja ningun camino que crashee; las specs estan reconciliadas al as-built en los 3 archivos. El unico
rojo de check.mjs es un flake de aislamiento de un test BACKEND ajeno (detalle abajo), no del chunk.

---

## Trazabilidad R<n> <-> test (completa)

- R13.5 (dos entry points convergen en field_definitions):
  - e2e maniobra-custom.spec.ts: test 1 (config + -> clasificacion -> form -> crear -> oraculo server) +
    test 2 (maniobra + SIN pregunta -> crear -> habilita + oraculo server).
  - custom-field.test.ts: buildPayload numeric maniobra -> shape exacto del INSERT 0093.
- R13.6 (clasificacion explicita, no se infiere):
  - e2e test 1: el sheet classify muestra la pregunta + classify-propiedad/classify-maniobra; elegir
    propiedad -> server dataType=propiedad (linea 118).
  - CustomFieldSheet.tsx: modo classify arranca en step classify; pickClassification fija data_type al
    elegir, nunca lo infiere.
- R13.7 (maniobra + = solo maniobra):
  - e2e test 2: classify-propiedad toHaveCount(0); titulo Nueva maniobra; server dataType=maniobra (l.169).
  - jornada.tsx onCreateCustomManeuver fuerza dataType maniobra (l.336); CustomFieldSheet modo maniobra
    arranca en step form.
- R13.8 (los 7 ui_component):
  - custom-field.test.ts: UI_COMPONENT_OPTIONS ofrece exactamente los 7 + uiComponentNeedsOptions solo enum.
  - e2e test 1: los 7 type-* visibles; type-enum_single -> editor de opciones; server uiComponent +
    config_schema.options array jsonb nativo (l.123-124).
- R13.9 (1 dato = 1 campo): por construccion el form crea UN field_definition (no hay UI multi-campo);
  cubierto por el shape del payload en custom-field.test.ts. Reconciliacion C.2/C.3 anotada bajo R13.9.
- R13.2/R13.5 owner-only: ambos + gateados por isOwner (estState.status active && role owner):
  editar-plantilla.tsx (+ dentro de isOwner && toggles, sheet isOwner && customSheetOpen, no-owner ve
  readOnly sin +) + jornada.tsx (canCreateCustom=isOwner, CustomManeuverSection no renderiza + sin owner,
  sheet isOwner && customSheetOpen). e2e usa owner; el server (RLS owner-only + guard 42501) es el backstop.
- config_schema jsonb anti-doble-encoding: upload-classify.test.ts (+2) + e2e (options array jsonb nativo).
- slug/derivacion: custom-field.test.ts (baseSlug x3, slugifyDataKey x6: unico, <=64, case-insensitive,
  fallback dato, nunca en existing).
- builders/overlay (tweak M1): maneuver-reads.test.ts (+6: create insert, custom-data-keys solo custom
  vivas, enabled-custom-maneuvers maniobra enabled con overlay pisando synced).

Cada R13.5-R13.9 tiene >=1 test concreto. PASA la regla dura de trazabilidad.

## Tasks completas: SI

M5-C.2 en [x] con AS-BUILT detallado. M5-C.3 queda [ ] (chunk SIGUIENTE, fuera del scope de esta revision,
justificado en la decision de scope documentada). Sin tasks de C.2 abiertas.

## Exactitud de specs (codigo -> spec): OK

- tasks.md M5-C.2: [x] + AS-BUILT (archivos, helpers, tweak M1, gotcha jsonb, decision de scope, tests).
- design.md 11.6: nota AS-BUILT (M5-C.2) describe lo que el codigo hace; 11.7 (tweaks M1/M3) coherente.
- requirements.md R13.9: nota de reconciliacion de la frontera C.2/C.3 (no reescribe los EARS; precisa
  donde termina C.2 y arranca C.3). No hay design/requirements mintiendo. PASA.

## CHECKPOINTS

- [x] C2 — estado coherente: una sola feature in_progress (03); current.md describe la sesion.
- [x] C3 — arquitectura: capas correctas (utils puro custom-field.ts; service custom-fields.ts toca I/O via
  local-query/outbox; screens en app/app/**; el sheet no hace fetch directo, recibe onCreate). NO se
  hardcodea establishment_id (viene de estState.current.id). Sin TODOs/logs sueltos.
- [x] C4 — verificacion real: 112/112 verdes en las suites tocadas por C.2 + typecheck cliente verde + e2e
  2/2 con oraculo server.
- [x] C6 — SDD: cada R13.5-R13.9 con >=1 test; requirements EARS estricto intacto.
- [x] C8 — offline-first: crear (CRUD-plano local) + habilitar (outbox/RPC) son writes locales; LWW; no hay
  request sincrono a Supabase desde pantalla.
- [ ] C1 / C5 — checkpoints de CIERRE DE SESION (harness completo / history.md / estado final de la
  feature), no de este chunk. No bloquean la aprobacion del chunk (la feature sigue in_progress).
- C7 — N/A: C.2 no crea tablas nuevas (frontend puro; el backend con RLS owner-only ya aplicado/gateado).

## Checklist RAFAQ-especifico

### A. Multi-tenancy / RLS — N/A
Frontend puro. No toca tablas/migraciones/RLS. El backend 0093 (RLS owner-only + guard
tg_field_definitions_custom_guard + CHECK de dominio ui_component) ya aplicado y gateado en M5-BACKEND
(Gate 1 PASS). El cliente nunca hardcodea establishment_id (lo toma del contexto activo).

### B. Offline-first — APLICA, OK
- [x] Funciona offline: createCustomField = INSERT CRUD-plano local (runLocalWrite -> 1 CrudEntry ->
  uploadData); enableCustomFieldInRodeo = enqueueSetRodeoConfig (outbox/RPC). Sin red, ambos escriben local.
- [x] Scope establishment: el INSERT lleva establishment_id del contexto activo (la stream custom scopea).
- [x] Conflictos: LWW via CRUD-plano; un rechazo server-side (no-owner / dup data_key) lo descarta
  uploadData + se surfacea por R10.8 (no lo silencia el return del service). Documentado en el service.
- [x] No hace requests sincronos a Supabase desde la pantalla: todo via services -> SQLite local.

### C. BLE — N/A (C.2 no toca BLE).

### D. UI de campo (manga) — APLICA (veto visual exhaustivo = leader, en paralelo)
- [x] Targets $touchMin en clasificacion, picker de tipos, chips de opciones, +/Crear.
- [x] Estado de loading visible (Creando... en el boton; submitting deshabilita).
- [x] Recorte de descendentes: todos los headings/Text con numberOfLines llevan lineHeight matching.
- (El veto de 60dp/18pt/una-decision-por-pantalla + capturas 360/412 lo hace el leader, segun el encargo.)

### E. Edge Functions — N/A (no toca Edge Functions).

---

## Verificacion del contrato server-side (0093) — el INSERT del cliente es EXACTO

buildCreateCustomFieldPayload vs migracion 0093_field_definitions_custom.sql:
- columnas (id, establishment_id, data_key, label, data_type, ui_component, category, config_schema,
  active=1): el guard fuerza establishment_id no-NULL + is_owner_of -> el builder lo manda del contexto
  activo. OK.
- data_key slug a-z0-9_ <=64 (CHECK l.72-73): slugifyDataKey lo garantiza. OK.
- ui_component en los 7 (CHECK de dominio l.59-62): CustomUiComponent = exactamente esos 7. OK.
- data_type en (maniobra, propiedad) (guard l.123): CustomDataType = esos 2. OK.
- label <=80 (CHECK l.46): LABEL_MAX=80. OK. category <=32 (CHECK l.77): personalizado=12 chars. OK.
- config_schema -> options como array jsonb (guard l.132-135, jsonb_typeof=array; cardinalidad<=50 / <=60):
  ES el gotcha que el fix de JSONB_TEXT_COLUMNS.field_definitions resuelve. Sin el, config_schema subiria
  como jsonb-STRING -> options daria NULL -> 23514. Con decodeJsonbColumns, sube como jsonb nativo. OK.

## Fix de config_schema jsonb — CORRECTO y ACOTADO

upload-classify.ts: unico delta = field_definitions [config_schema] en JSONB_TEXT_COLUMNS.
decodeJsonbColumns deja intacto lo no-string (typeof null distinto de string -> continue) -> para no-enum
(config_schema null) no toca nada. No afecta otras tablas/columnas (sessions.config / maneuver_presets.config
NO listadas a proposito, no se validan por tipo server-side). Misma clase de gotcha que el value de M5-C.1.
Verificado por upload-classify.test.ts (+2) + el oraculo e2e (options array jsonb nativo).

## Decision de scope C.2/C.3 — SANA, NO deja estado roto (punto critico del encargo)

CustomManeuverSection (jornada.tsx l.634-674) renderiza las maniobras custom enabled como XStack PURAMENTE
VISUALES: NO tienen onPress, NO son Pressable, NO se agregan a chosen ni entran a buildJornadaConfig /
maneuver-sequence. Solo el + (owner-only) es interactivo. NO existe camino para seleccionar/secuenciar una
maniobra custom dentro de una jornada en C.2 -> buildJornadaConfig (keyed en ManeuverKind) no la puede
dropear en silencio ni crashear. La seleccion/secuencia + render per-animal + escritura a custom_measurements
se difiere a C.3 (renderer generico desde ui_component). Decision documentada en design 11.6/11.7 +
requirements R13.9 + impl-doc autorrevision #9. NINGUN camino de C.2 crashea.

## check.mjs ROJO = flake de aislamiento de un test BACKEND ajeno (NO regresion del chunk)

node scripts/check.mjs da exit 1 por 2 fails en supabase/tests/animal/run.cjs (suite backend de spec
02/13), R2 INPUT-1 CHECK: animals.tag_electronic borde 64 deberia persistir -> 23505 duplicate key
animals_tag_unique. Causa raiz: el test escribe un TAG HARDCODEADO 9x64 (run.cjs l.1922) SIN prefijo
RUN_TAG -> colisiona con un residuo de otra terminal paralela (memoria feedback_parallel_terminals +
reference_check_red_rate_limit; avisado por el implementer). Reproducido al re-correr la suite aislada (2
fails persistentes = dato residual en la DB compartida).

Por que NO bloquea este chunk:
- El diff de C.2 es 100% frontend: NO toca supabase/, NO toca animals ni el trigger 0036, NO toca
  migraciones, NO toca esa suite. No puede ser la causa.
- Todo lo que C.2 SI toca esta verde: typecheck cliente OK + 112/112 unit en las suites del chunk +
  e2e maniobra-custom 2/2 (con oraculo server real offline->sync->0093).
- El fallo es determinista por dato residual en la DB compartida, no por logica de C.2.

DEUDA AJENA (NO de este chunk, NO la arregla el reviewer): el test supabase/tests/animal/run.cjs ~l.1922
usa un tag_electronic literal sin RUN_TAG -> no es paralelo-seguro. Anotar en backlog para la suite backend
(spec 02/13). Antes del cierre formal de la FEATURE (Gate 2 + Puerta 2), el leader debe confirmar con un
check.mjs LIMPIO (terminal unica / DB sin residuos) que la suite backend vuelve a verde, pero eso es una
condicion de cierre de la FEATURE, no de aprobacion de este CHUNK frontend.

## Cambios requeridos: NINGUNO
