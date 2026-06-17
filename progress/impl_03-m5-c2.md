baseline_commit: bf82ccde591f7c05b6080f80ae0c6f04b6e4ac8c

# impl 03 — M5-C.2 — UI de CREACIÓN de datos/maniobras custom (R13.5–R13.9)

Feature `03-modo-maniobras` (in_progress). Chunk **M5-C.2**. Frontend puro: UI de creación de
datos/maniobras custom (los dos `+` con/sin pregunta de clasificación) + service de creación CRUD-plano
offline + tweak M1 (la lista de maniobras del wizard ahora incluye las custom `data_type='maniobra'`
enabled en el rodeo). Backend M5-BACKEND aplicado + verde (`0093` field_definitions custom: establishment_id,
RLS owner-only, guard de inmutabilidad/caps/options, CHECK de dominio ui_component; `0094-0097`
custom_measurements/attributes + gating + check_grants). Servicios de captura M5-C.1 hechos.
Gate 1 N/A por chunk (no toca schema/RLS); reviewer + Gate 2 después.

## Plan (tasks) — TODAS DONE
- [x] T1 — Helper PURO `app/src/utils/custom-field.ts` + `custom-field.test.ts` (23).
- [x] T2 — Service `app/src/services/custom-fields.ts` + builders en `local-reads.ts` + tests en `maneuver-reads.test.ts` (+6).
- [x] T3 — Form `app/app/maniobra/_components/CustomFieldSheet.tsx` (modos classify/maniobra + guard tap-through).
- [x] T4 — Los 2 `+` (config `editar-plantilla.tsx` / maniobras `jornada.tsx` etapa 2), owner-only.
- [x] T5 — Tweak M1 (`fetchEnabledCustomManeuvers` + `CustomManeuverSection`: lista = fábrica + custom enabled).
- [x] T6 — e2e `maniobra-custom.spec.ts` 2/2 + helper `waitForServerCustomField` + 10 capturas 360/412 + check + reconciliación.

NO marco la feature `done` (espera reviewer + Gate 2).

## Archivos
- NUEVOS: `app/src/utils/custom-field.ts` (+ `.test.ts`), `app/src/services/custom-fields.ts`,
  `app/app/maniobra/_components/CustomFieldSheet.tsx`, `app/e2e/maniobra-custom.spec.ts`.
- MODIF: `app/src/services/powersync/local-reads.ts` (3 builders), `app/src/services/powersync/maneuver-reads.test.ts`
  (schema field_definitions/rodeo_data_config/overlay + 6 tests), `app/src/services/powersync/upload-classify.ts`
  (`field_definitions.config_schema` en JSONB_TEXT_COLUMNS), `app/src/services/powersync/upload-classify.test.ts` (+2),
  `app/app/editar-plantilla.tsx` (`+` config), `app/app/maniobra/jornada.tsx` (`+` maniobras + tweak M1),
  `app/e2e/helpers/admin.ts` (`waitForServerCustomField`), `scripts/run-tests.mjs` (registra `custom-field.test.ts`).
- SPECS: `tasks.md M5-C.2` ([x] + AS-BUILT), `design.md §11.6` (AS-BUILT), `requirements.md` (nota de reconciliación R13.9).
- CAPTURAS: `tests/modo-maniobra/custom-{config-plus,classify,form,enum-options,maneuver-plus}-{360,412}.png` (10).

## Mapa R<n> → test
- **R13.5** (dos entry points convergen) →
  - e2e `maniobra-custom.spec.ts`: "config `+`: clasificación → form → crear → aterriza" (entry A) + "maniobra `+`: SIN clasificación → crear → habilita" (entry B).
  - `custom-field.test.ts`: "buildPayload: numeric maniobra → shape exacto del INSERT 0093".
- **R13.6** (clasificación explícita, no se infiere) →
  - e2e: el sheet `classify` muestra "¿Qué tipo de dato es?" + las dos opciones; elegir propiedad → server `dataType='propiedad'`.
  - `CustomFieldSheet` modo `classify` (paso `classify` antes del form; el data_type se setea al elegir, nunca se infiere).
- **R13.7** (maniobra `+` = solo maniobra) →
  - e2e: el sheet del `+` de maniobras NO tiene `classify-propiedad`; "Nueva maniobra"; server `dataType='maniobra'`.
  - `onCreateCustomManeuver` fuerza `dataType:'maniobra'`; `CustomFieldSheet` modo `maniobra` arranca en `form`.
- **R13.8** (los 7 ui_component) →
  - `custom-field.test.ts`: "UI_COMPONENT_OPTIONS: ofrece exactamente los 7" + "uiComponentNeedsOptions: solo los enum".
  - e2e: los 7 `type-*` visibles en el form; `type-enum_single` → editor de opciones; server `uiComponent` correcto + config_schema jsonb nativo.
- **R13.9** (1 dato = 1 campo) →
  - el form crea UN field; no hay UI multi-campo (la creación es de un solo `field_definition`). Reconciliación C.2/C.3 en requirements.
- **R13.2/R13.5 owner-only** → ambos `+` gateados por `isOwner` (`estState.role==='owner'`); el server (RLS owner-only + guard 42501) es el backstop. e2e usa un owner.
- **R13.16/config_schema jsonb** (anti doble-encoding) → `upload-classify.test.ts`: "field_definitions ENUM → config_schema se PARSEA a jsonb nativo" + e2e: `configSchema.options` llega como array.
- **slug/derivación** → `custom-field.test.ts` (baseSlug 3, slugifyDataKey 6: único, ≤64, case-insensitive, fallback "dato").
- **builders/overlay** → `maneuver-reads.test.ts`: create insert (config_schema TEXT), custom-data-keys (solo custom vivas), enabled-custom-maneuvers (maniobra enabled, no propiedad/disabled/borrada/global/otro-rodeo) + el overlay PISA al synced.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
1. **¿La clasificación setea bien data_type?** Sí — el sheet `classify` no infiere; el e2e prueba propiedad → server `propiedad`. El `+` de maniobras fija `maniobra` (modo + force en el handler) → server `maniobra`.
2. **¿El `+` de maniobras solo crea maniobra?** Sí — modo `maniobra` sin paso de clasificación + `onCreateCustomManeuver` fuerza `dataType:'maniobra'`. e2e verifica que `classify-propiedad` NO existe en ese sheet.
3. **CACÉ el GOTCHA jsonb del config_schema** (no estaba en el fold; misma clase que el `value` de M5-C.1). El enum sube `config_schema` como JSON-TEXT → sin decodificar, PostgREST lo escribe como jsonb-STRING → el guard 0093 `-> 'options'` da NULL → 23514 al crear un enum. Cerrado: `field_definitions:['config_schema']` en `JSONB_TEXT_COLUMNS`. Test unit + e2e (config_schema.options array nativo) lo prueban end-to-end.
4. **¿El editor de opciones respeta ≤50/≤60 y sin duplicados?** Sí — `validateCustomFieldDraft` + el sheet (maxLength 60 en el input, cap 50 + dup-check en addOption). El server (0093 guard) re-valida 1..50/≤60. Tests de borde en unit.
5. **¿Un no-owner ve el `+`?** No — ambos gateados por `isOwner`. En editar-plantilla el `+` está dentro del bloque `isOwner && toggles`; en jornada `canCreateCustom={isOwner}` y `CustomManeuverSection` no renderiza el `+` sin owner (un no-owner sí ve las custom enabled, sin el `+`). El server (42501) es el backstop.
6. **¿El slug es válido y único?** Sí — `slugifyDataKey` siempre `^[a-z0-9_]+$`, ≤64 (recorta + sufijo recortando la base), único contra los custom existentes (case-insensitive). Unit cubre label sin alfanuméricos ("dato"), colisión, largo extremo.
7. **Unicidad cross-establishment**: `fetchCustomDataKeys` lee TODOS los custom del SQLite local (puede traer de varios campos) → puede sobre-desambiguar (sufijo de más) pero NUNCA sub-desambiguar (el server tiene el UNIQUE per-(establishment_id, data_key) como barrera). Documentado en el service. Seguro.
8. **Web táctil 360/412**: 10 capturas revisadas — el sheet entra entero, sin overflow horizontal a 360, los 7 tipos + el editor de opciones scrollean, los sheets NO se auto-cierran (guard doble-rAF idéntico a ManeuverConfigSheet). Descenders: títulos/Text con numberOfLines llevan lineHeight matching.
9. **Bug-por-omisión evitado (scope C.2/C.3)**: `buildJornadaConfig` filtra a `ManeuverKind` conocidos → si dejara seleccionar una maniobra custom en la sesión, se dropearía en silencio. Por eso C.2 EXHIBE las custom enabled (no las hace seleccionables/secuenciables) y difiere la selección+render a C.3 (renderer genérico). Reconciliado en design §11.6/§11.7 + requirements R13.9.
10. **Offline-first**: crear (CRUD-plano local) + habilitar (outbox `enqueueSetRodeoConfig`) son writes locales → funcionan sin red. El e2e prueba el camino offline → sync → 0093 con oráculo server. Un rechazo (no-owner) lo maneja uploadData (R10.8), no el return del service.
11. **NUNCA hardcodeé establishment_id**: viene de `estState.current.id` (contexto activo); el guard 0093 exige `is_owner_of`. Verificado en el service + e2e.

## Reconciliación de specs (paso 9)
- `tasks.md M5-C.2`: `[x]` + nota AS-BUILT (archivos, helpers, tweak M1, gotcha jsonb, decisión de scope C.2/C.3, tests, gates pendientes).
- `design.md §11.6`: nota AS-BUILT (helper/service/form/los 2 `+`/tweak M1/gotcha jsonb/decisión de scope/tests).
- `requirements.md` (tras R13.9): nota de reconciliación de la frontera C.2/C.3 (la creación R13.5–R13.9 está completa; la selección/render per-animal de una maniobra custom va a C.3). No cambia el *qué* de los EARS.

## Notas para el reviewer / Gate 2
- **`enableCustomFieldInRodeo` reusa `enqueueSetRodeoConfig`** (RPC `set_rodeo_config` 0082, owner-only SECURITY DEFINER) → el enable es offline + owner-gated server-side, sin INSERT directo a rodeo_data_config (camino removido en spec 15 T9.9).
- **Sin RPC nueva, sin tocar DB/deploy**: la creación es CRUD-plano sobre `field_definitions` (0093 ya aplicado); el único delta de connector es sumar `config_schema` a JSONB_TEXT_COLUMNS (helper puro, testeado).
- **check.mjs rojo = flake `animals_tag_unique`** (23505 dup) de la suite backend spec-13 por terminales paralelas (memoria `reference_check_red_rate_limit`), NO este chunk (frontend puro). typecheck + 1243 client unit + e2e custom 2/2 verdes.

## Contrato server-side de creación (0093) — lo que el cliente debe respetar
INSERT en `field_definitions` (CRUD-plano, owner-only RLS + guard `tg_field_definitions_custom_guard`):
- `id` (uuid de cliente, columna real), `establishment_id` (del contexto activo; el guard exige
  `is_owner_of`, NUNCA NULL desde cliente), `data_key` (slug `^[a-z0-9_]+$`, ≤64, único por
  `(establishment_id, data_key)`), `label`, `data_type` ∈ (`maniobra`,`propiedad`) [guard],
  `ui_component` ∈ los 7 [CHECK de dominio para custom], `category` (≤32 para custom).
- `config_schema = {options:[...]}` solo para `enum_single`/`enum_multi`: array 1..50, cada opción string ≤60 [guard].
- `description` opcional ≤500.
- Inmutables post-creación: establishment_id/data_type/data_key/ui_component (clasificar mal → soft-delete + recrear).
Caps client-side = UX (no autoritativos): label ≤80 UX, options ≤50/≤60. El server re-valida.
