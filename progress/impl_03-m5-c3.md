baseline_commit: 11ab1de35386ed91241655c5d3f701449e89b67c

# impl 03 — M5-C.3 — render genérico del paso desde `ui_component` + propiedad custom en alta/ficha

Feature `03-modo-maniobras` (in_progress). Chunk **M5-C.3** (el ÚLTIMO de M5). Frontend puro: backend
M5-BACKEND aplicado + verde (0093–0097); C.1 (services de captura `custom-measurements.ts`/
`custom-attributes.ts` + `serializeCustomValue`) y C.2 (creación `custom-fields.ts` + los dos `+` + tweak M1
que EXHIBE las custom maniobra enabled como visual-only) hechos. Gate 1 N/A por chunk; reviewer + Gate 2 después.

## Decisión de SHAPE (Parte A — cómo entran las custom al config/secuencia, aditivo)
Las 12 de fábrica son `ManeuverKind` (enum). Una maniobra custom NO es un ManeuverKind: se identifica por
`field_definition_id`. El config jsonb de la jornada es pass-through → agregamos una clave PARALELA:
`config.customManiobras: string[]` (array de field_definition_id, EN ORDEN). Las 12 de fábrica siguen
IDÉNTICAS en `config.maniobras`. Helpers nuevos PUROS:
- `maneuver-wizard.ts`: `buildJornadaConfig(maneuvers, preconfig, customManiobras?)` agrega `customManiobras`
  (dedup, preserva orden) sin tocar `maniobras`. `toggleCustomManiobra(chosen, id)`.
- `maneuver-config.ts`: `extractCustomManiobras(config)` (filtra strings no-vacíos, dedup) — espeja extractManeuvers.
- `maneuver-sequence.ts`: el paso de la secuencia pasa a ser un ITEM DISCRIMINADO `SequenceItem`:
  `{ source:'factory'; maneuver:ManeuverKind }` | `{ source:'custom'; fieldDefinitionId; uiComponent; label; options }`.
  `buildSequence` se generaliza para mezclar fábrica + custom en el orden combinado (fábrica en su orden, luego
  las custom enabled en su orden), filtrando por gating del rodeo (custom = enabled en rodeo) y aplicabilidad.
- `carga.tsx` dispatcher: un item `source:'custom'` → `CustomManeuverStep` (renderer genérico por uiComponent).

El gating capa 1 de una custom = está enabled en el rodeo (lo trae `fetchEnabledCustomManeuvers`, overlay-aware).
El gating capa 2 (0096) re-valida server-side al subir (R13.14/R13.15). La captura va a `custom_measurements`
(C.1 `addCustomMeasurement`), value tipado por uiComponent (`serializeCustomValue`).

## Decisión de SHAPE (Parte B — propiedad custom en alta/ficha)
- Alta (`crear-animal` paso 4): tras crear el animal, capturar las propiedades custom enabled del rodeo →
  `setCustomAttribute` post-create (mismo patrón soft-fail que condición/preñez). Render por uiComponent
  reusando los inputs del alta + el renderer genérico (compartido como componente `CustomFieldInput`).
- Ficha (`animal/[id]`): sección "Datos personalizados" → muestra el current-value (custom_attributes) +
  editar → `setCustomAttribute` (current-value, editable anytime, R13.12). Captura = cualquier rol (R13.13).

## Plan (tasks)
- [x] T1 — Helpers PUROS de config/secuencia con custom + unit (maneuver-wizard / maneuver-config / maneuver-sequence).
- [x] T2 — `buildEnabledCustomManeuversQuery` devuelve también ui_component + config_schema; nuevo
       `buildEnabledCustomFieldsQuery(rodeoId, dataType)` (maniobra/propiedad) + `buildCustomAttributesQuery` (leer
       current-values de la ficha) + unit.
- [x] T3 — Service: `fetchEnabledCustomManeuvers` (extiende a uiComponent/options) + `fetchEnabledCustomProperties`
       + `fetchCustomAttributes` en custom-fields.ts / custom-attributes.ts + tests.
- [x] T4 — Helper PURO de RENDER genérico (config_schema → options; value → tipado por uiComponent + describe es-AR)
       `custom-render.ts` + unit.
- [x] T5 — `CustomFieldInput.tsx` (input genérico por uiComponent — reusa idioms lockeados) + `CustomManeuverStep.tsx`
       (frame de manga: header + CTA, envuelve CustomFieldInput).
- [x] T6 — Wizard `jornada.tsx`: custom maniobra SELECCIONABLE (toggle → entra a chosen/config.customManiobras).
- [x] T7 — `carga.tsx`: secuencia mixta (SequenceItem discriminado) + dispatcher del item custom + captura a
       custom_measurements + resumen.
- [x] T8 — Parte B: `CustomPropertiesSection.tsx` (lista de propiedades custom + CustomFieldInput) en alta
       (`crear-animal` paso 4) + ficha (`animal/[id]` ver/editar) → setCustomAttribute.
- [x] T9 — e2e (custom maniobra en jornada → secuencia → captura; propiedad en alta → custom_attributes) +
       helpers oráculo server + capturas 360/412.
- [x] T10 — check.mjs + autorrevisión + reconciliación de specs (design §11.6/§11.7, requirements R13.8/R13.10, tasks M5-C.3).

## Decisión de SHAPE (refinada vs el plan original)
- SequenceItem discriminado en `maneuver-sequence.ts`: `{ source:'factory'; maneuver }` | `{ source:'custom';
  fieldDefinitionId; uiComponent; label; options }`. `buildSequence` ahora toma `factoryOrdered`+`applicable` (las
  12) Y `customEnabled` (las custom enabled del rodeo, EN ORDEN de `config.customManiobras`), las concatena (fábrica
  primero, custom después) y numera el contador combinado. La carga rápida (`carga.tsx`) discrimina por `item.source`.
- `buildJornadaConfig(maneuvers, preconfig, customManiobras?)` agrega `config.customManiobras: string[]` (field_def
  ids, dedup, orden) PARALELO a `config.maniobras` (las 12 IDÉNTICAS). `extractCustomManiobras(config)` lo re-parsea.
- Parte B: una sección AUTOCONTENIDA `CustomPropertiesSection` (carga las propiedades enabled del rodeo + sus
  current-values, render por uiComponent) → evita prop-drilling masivo en crear-animal/ficha. En alta usa un ref
  imperativo para entregar los valores capturados al submit (post-create soft-fail como condición/preñez).

## Mapa R<n> → test
- **R13.8** (maniobra custom: 7 tipos de input ofrecidos + render genérico) →
  - `app/src/utils/custom-render.test.ts` (captureKindFor/parseCustomOptions/parseCustomValueJson/describeCustomValue/isCustomValueComplete por los 7 ui_component);
  - `app/src/utils/maneuver-sequence.test.ts` (buildSequence con custom: orden combinado, contador, dedup, SOLO custom, cero-regresión SIN custom; isSequenceComplete/firstUncaptured/summaryRows con CustomCaptureMap);
  - `app/src/utils/maneuver-wizard.test.ts` (toggleCustomManiobra; buildJornadaConfig customManiobras paralelo + round-trip);
  - `app/src/utils/maneuver-config.test.ts` (extractCustomManiobras: orden/dedup/no contamina extractManeuvers);
  - e2e `app/e2e/maniobra-custom-render.spec.ts` "enum_single → bloques → custom_measurements" + "numeric → keypad → número jsonb" (oráculo `waitForServerCustomMeasurement`, session_id).
- **R13.10** (maniobra custom en la lista + propiedad custom en alta/ficha) →
  - `app/src/services/powersync/maneuver-reads.test.ts` (buildEnabledCustomFieldsQuery maniobra/propiedad + overlay; buildCustomAttributesQuery con ui_component/label + borrada/inactiva);
  - e2e `maniobra-custom-render.spec.ts` "propiedad custom: alta (paso 4) → custom_attributes; ficha ver/editar" (oráculo `waitForServerCustomAttribute` + edición in-place).
- **R13.11** (custom_measurements append-only con session_id) → `maneuver-reads.test.ts` (buildAddCustomMeasurementInsert append-only + buildUpdateCustomMeasurement corrección no-duplica) + e2e oráculo con session_id.
- **R13.12** (custom_attributes current-value editable anytime) → `maneuver-reads.test.ts` (setAttr UPDATE-luego-INSERT pisa, no duplica; buildUpdateCustomAttribute 0-filas) + e2e edición in-place en la ficha (LWW).
- **R13.13** (capturar = cualquier rol) → cubierto server-side (RLS has_role_in, suite backend custom) + el write-path no gatea por rol en cliente.
- **R13.16** (value tipado por ui_component) → `custom-value.test.ts` (M5-C.1, serializeCustomValue número-como-número) + `custom-render.test.ts` (parse de vuelta) + e2e (número jsonb nativo, no "7").

## Autorrevisión adversarial (paso 8)
Pasada hostil sobre el propio trabajo. Qué busqué / qué encontré / cómo lo cerré:
- **Las 12 de fábrica intactas (regresión inaceptable).** `buildSequence` SIN custom = byte-idéntico (unit `buildSequence: SIN custom = IDÉNTICO`) + `buildJornadaConfig` no agrega `customManiobras` si no hay (unit). e2e de regresión **maniobra-carga 3/3 + maniobra-elegir 2/2 + maniobra-wizard 1/1 + maniobra-custom 2/2 + animals 14/14 VERDES**. Cerrado.
- **Bug REAL cazado en e2e: "cannot UPSERT a view".** Mi 1er intento puso `INSERT … ON CONFLICT(id)` en `custom_measurements` (para LWW de la corrección) → PowerSync expone la tabla como VIEW → el write LOCAL fallaba → banner "No se pudo guardar". Además descubrí que el `ON CONFLICT(id)` que **C.1 ya tenía en `custom_attributes`** era LATENTE-roto (C.1 unit-only, C.2 nunca escribió un atributo end-to-end). Cerrado: `custom_measurements` = plain INSERT + `buildUpdateCustomMeasurement` (corrección R5.9 por id estable); `custom_attributes` = UPDATE-luego-INSERT-si-0-filas (`runLocalWriteCount`). Reconciliado en design/requirements (supersede el AS-BUILT de C.1). El connector (PK natural) no cambió.
- **Visual truncado en el e2e de alta** (no es bug de la feature): el visual `RUN_TAG-PROP` (31 chars) excedía `VISUAL_MAX_LENGTH=30` → el oráculo no matcheaba. Cerrado con un visual corto único.
- **"Identificación" ambiguo en el e2e** (es header del paso 4 del alta Y de la ficha): el test inicial pasaba esa aserción en el form aunque el animal no se hubiera creado completo. La resolución del profileId por visual + el oráculo de custom_attributes lo blindan (si el atributo no aterriza, falla).
- **Custom elegida en la jornada pero deshabilitada/borrada luego en el rodeo.** `customSequenceSpecs` filtra a las enabled (`byId.get(id)`) y `buildCurrentConfig` filtra `chosenCustom` a enabled → no se secuencia ni se guarda una huérfana. Paridad con el gating de fábrica.
- **value off-list / mal tipado.** La UI solo ofrece las opciones (enum) y el tipo correcto por ui_component; el server (0096) re-valida forma + pertenencia (capa 2). numeric emite número jsonb nativo (no string) — verificado por el oráculo (`waitForServerCustomMeasurement(…, 7)`).
- **Doble-tap / re-entrada.** `capturingRef` guard en `captureCustomAndAdvance` (igual que las de fábrica). Corrección desde el resumen reusa el id estable → UPDATE, no 2da fila.
- **Multi-tenant / establishment_id.** Nunca hardcodeado: createCustomField del contexto; los writes de value no mandan establishment_id (lo fuerza el trigger). El alta toma el rodeo del paso 1.
- **Offline-first.** Todos los writes son CRUD-plano local (custom_measurements INSERT / custom_attributes UPDATE-o-INSERT) → funcionan sin red; el gating capa 2 + audit los re-validan al subir. El e2e de carga offline de fábrica sigue verde (mismo path).
- **Descenders / es-AR / tap-through.** lineHeight matching en todo Text con numberOfLines; números es-AR (coma decimal) en `describeCustomValue`/keypad; date en formato de máquina AAAA-MM-DD (NO es-AR display, memoria). Los sheets no se tocaron (los inputs son inline, sin scrim → sin riesgo de tap-through nuevo).
- **NOTA de dependencia de sync-down**: el e2e de C.3 depende de que las field_definitions custom + rodeo_data_config + custom_* sincronicen DOWN al device — confirmado LIVE (la stream `est_field_definitions_custom`/`est_custom_*` de `rafaq.yaml` ya está deployada; el e2e de C.2 ya lo probaba con `waitForServerCustomField`, y los 3 tests de C.3 pasan end-to-end).

## Reconciliación de specs (paso 9)
- `tasks.md` M5-C.3 → `[x]` + bloque AS-BUILT (Parte A/B + gotcha de la view + tests/e2e/regresión/capturas).
- `design.md` §11.6 → AS-BUILT M5-C.3 (shape aditivo customManiobras + SequenceItem discriminado; renderer genérico por ui_component con idioms lockeados; alta/ficha con CustomFieldInput/CustomPropertiesSection; **gotcha "cannot UPSERT a view" → UPDATE-luego-INSERT, supersede el banner de C.1**). §11.7 sin cambios (los tweaks M1/M3 quedaron realizados).
- `requirements.md` → nota de reconciliación AS-BUILT bajo R13.10 (R13.8/R13.10 construidos; desviación técnica de R13.12: UPDATE-luego-INSERT en vez de upsert, mismo current-value). El *qué* no cambió.
- No quedan specs que contradigan el código.

## VETO del leader — fix de UI enum_single (implementer Opus, 2026-06-17)
Iteración de veto acotada sobre el render genérico (M5-C.3). NO toqué lógica de captura/secuencia/config ni los otros ui_component.

### Problema (veto 🔴 manga)
`EnumSingleBlocks` (CustomManeuverStep.tsx) renderizaba las N opciones como bloques full-width `$primary` (verde) CADA UNO con un `Check` (idiom de TactoVaquillonaStep). En TactoVaquillona el ✓/✗/⏲ son íconos SEMÁNTICOS del resultado (apta/no-apta/diferida); en un enum_single GENÉRICO sin esa semántica, las N en verde-con-✓ en reposo se leían como si las N estuvieran SELECCIONADAS/confirmadas → engañoso para un "elegí UNA de N".

### Fix
- **enum_single → idiom de DientesStep** (neutro, "elegí uno de N sin pre-selección): `flexGrow:1`/`flexBasis:0`/`minHeight:$searchBarLg`, `backgroundColor:$surface`, `borderWidth:2`/`borderColor:$divider`, label centrado `$textPrimary` `fontSize:$9` `lineHeight:$9` `numberOfLines:2`, `pressStyle:$greenLight`, **SIN ✓ en reposo**. Un toque = `pick(opt)` → marca `picked` un instante (relleno `$primary` + ✓, color blanco) como feedback "elegiste ESTA" + `onConfirm({kind:'string', value:opt})` (lógica de captura SIN cambios). a11y `selected: isPicked`.
- **enum_multi NO se tocó**: ya distinguía bien SELECCIONADA (`$primary`+✓) de NO seleccionada (`$white`/`$divider`, sin ✓ en reposo) — idiom SilentVaccinationStep. El veto pedía dejarlo si estaba bien; está bien. No re-capturado (no cambió).
- Header del comentario del archivo actualizado (enum_single → DientesStep).

### Autorrevisión (a 360 y 412)
- Vi `tests/modo-maniobra/custom-render-enum-{360,412}.png`: las 3 opciones (Adentro/Afuera/Normal) en bloques NEUTROS (superficie/borde, label oscuro centrado, SIN ✓). En reposo NO se leen como "todas seleccionadas" — se leen como "elegí una de N". Targets XL (cada bloque ~1/3 del alto útil, ≫ touchMin). Descender "Ángulo" del header intacto.
- Tocar una elige + avanza: el e2e tapeó "Afuera" → "Revisá la carga" → confirmar → `custom_measurements` value="Afuera" (oráculo server con session_id). La captura del value sigue correcta.

### Tests
- `npx tsc --noEmit` exit 0.
- Client unit (custom-value/custom-field/custom-render) 52/52 verdes.
- e2e `maniobra-custom-render.spec.ts` **3/3 PASS** (enum_single, numeric, propiedad alta/ficha) tras `e2e:build`.
- `node scripts/check.mjs` rojo = flake `animals_tag_unique` (23505) de la suite BACKEND `supabase/tests/animal/run.cjs` (terminales paralelas sobre la DB compartida, documentado en MEMORY) — NO este fix (frontend puro, 1 componente).

### Re-capturas (para el re-veto)
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\custom-render-enum-360.png`
- `C:\DEV\RAFAQ\app-ganado\tests\modo-maniobra\custom-render-enum-412.png`

### Reconciliación
- `design.md` §11.6 AS-BUILT M5-C.3: enum_single → DientesStep (NO TactoVaquillonaStep) + nota de RECONCILIACIÓN del veto (por qué el ✓ era engañoso en un enum genérico). enum_multi sin cambios.
- NO marco la feature done.
