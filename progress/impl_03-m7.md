baseline_commit: 7285197a23a170895b182a2518bc2df7acc94d67

# impl — spec-03 MODO MANIOBRAS · chunk M7 — Gestión de rutinas y datos custom (editar + borrar)

> Feature `03-modo-maniobras` (spec activa). Chunk **M7-A** (rutinas, UI-only) + **M7-B** (datos custom, UI + service nuevo). **Gate 1 N/A** para A; **Gate 1 SE REABRE** para la parte de R13.30 de B (ver brecha de sync-rules). Gate 2 (code) pendiente.
> NO marqué la feature `done`. NO toqué `feature_list.json`. NO commiteé.

## Estado: `done` (fix-loop 2026-06-20 cerró el HIGH del reviewer + R13.30 resuelto a Opción B). Pendiente: re-review + Gate de seguridad de schema (`0101`) + deploy de `0101` (Raf). Ver §FIX-LOOP.

## Baseline (Gate 2)
- `baseline_commit: 7285197a23a170895b182a2518bc2df7acc94d67`.
- `node scripts/check.mjs` al baseline y al cierre: typecheck cliente OK + cliente unit VERDE; **rojo SOLO en suites backend DB** (`animal`, `spec 13 INPUT-1`) por el flake `animals_tag_unique` (23505, tag literal `'9'×64`) / rate-limit = spec-08 en otra terminal (`reference_check_red_rate_limit`). NO es regresión de M7 (frontend + 1 service local; NO toqué backend/SQL).

## Tareas (todas implementadas + testeadas)
- [x] M7-A.1 — Menú ⋯ por fila en `maniobra.tsx` + Eliminar (confirmación → `softDeletePreset`). R2.6/R2.9/R2.10/R2.11.
- [x] M7-A.2 — Editar: Renombrar (`SavePresetSheet` reuso) + Reconfigurar (wizard `editPresetId` → `updatePreset`, NO arranca jornada). R2.7/R2.8.
- [x] M7-A.3 — E2E `maniobra-rutinas-gestion.spec.ts` (4 VERDE).
- [x] M7-B.1 — Service `softDeleteCustomField` + `updateCustomField` (UPDATE plano CRUD-plano) + builders + impacto. R13.28/R13.32/R13.33/R13.34.
- [x] M7-B.2 — Lectura histórica: RESUELTO a Opción B (fix-loop 2026-06-20). Split revertido (código muerto); `buildCustomAttributesQuery` filtra deleted_at; el diálogo advierte. R13.19 completo.
- [x] M7-B.5 — (fix-loop) Índice UNIQUE custom PARCIAL sobre deleted_at (migración 0101) — habilita borrar+recrear (R13.35). Test backend `(o)` pending-deploy. REABRE Gate de schema.
- [x] M7-B.3 — ⋯ owner-only en filas custom de `editar-plantilla.tsx` + confirmación con impacto + edición modo `edit`. R13.29/R13.31/R13.32/R13.33.
- [x] M7-B.4 — E2E `maniobra-custom-gestion.spec.ts` (4 VERDE + 1 `test.fixme` = R13.30-post-borrado).

## Archivos tocados
### Nuevos
- `app/app/maniobra/_components/ConfirmDeleteSheet.tsx` — diálogo de confirmación de borrado COMPARTIDO (impacto opcional, sin "Deshacer", fail-closed, guard tap-through).
- `app/app/maniobra/_components/PresetActionsSheet.tsx` — menú ⋯ de rutina (Editar→Renombrar/Reconfigurar, Eliminar).
- `app/app/maniobra/_components/CustomFieldActionsSheet.tsx` — menú ⋯ de dato custom (Editar/Eliminar).
- `app/e2e/maniobra-rutinas-gestion.spec.ts`, `app/e2e/maniobra-custom-gestion.spec.ts` — E2E.
### Modificados — código de app
- `app/src/services/powersync/local-reads.ts` — `buildFieldCatalogQuery` (+`establishment_id`/`config_schema`, +filtro `deleted_at IS NULL`); `buildCustomAttributesQuery`→`buildCustomAttributesViewQuery` (sin filtro `deleted_at`/`active`, +surface `deleted_at`); +`buildSoftDeleteCustomFieldUpdate`/`buildUpdateCustomFieldUpdate`/`buildCustomFieldEnabledRodeoCountQuery`/`buildCustomFieldCaptureCountQuery`.
- `app/src/services/custom-fields.ts` — +`softDeleteCustomField`/`updateCustomField`/`fetchCustomFieldDeleteImpact`.
- `app/src/services/custom-attributes.ts` — `fetchCustomAttributes` usa la VIEW query + surface `isDeleted`.
- `app/src/services/rodeo-config.ts` — mapper de `FieldDefinition` (+`establishmentId`/`options`).
- `app/src/utils/rodeo-template.ts` — `FieldDefinition` (+`establishmentId`/`options`) + `isCustomField()`.
- `app/src/utils/custom-field.ts` — +`buildCustomFieldDeleteImpactLines` (copy es-AR de impacto, puro).
- `app/src/components/FieldTemplateToggleList.tsx` — +`onCustomAction` (⋯ solo en filas custom; wizard sin callback = sin ⋯).
- `app/app/maniobra.tsx` — kebab ⋯ en `PresetRow` + state/handlers + 3 sheets (acciones/renombrar/borrar).
- `app/app/maniobra/jornada.tsx` — modo `editPresetId` (load preset → "Guardar cambios" = `updatePreset`, `router.back()`); `ArrancarCTA` con `label`/ícono.
- `app/app/maniobra/_components/SavePresetSheet.tsx` — +`initialName`/`title`/`description`/`ctaLabel` (reuso para Renombrar).
- `app/app/maniobra/_components/CustomFieldSheet.tsx` — +modo `edit` (precarga label/opciones, tipo inmutable, opciones append-only, "Guardar cambios").
- `app/app/maniobra/_components/CustomPropertiesSection.tsx` — fila de un dato BORRADO = display-only (R13.30).
### Modificados — tests
- `app/src/services/powersync/maneuver-reads.test.ts`, `app/src/services/powersync/local-reads.test.ts`, `app/src/utils/custom-field.test.ts`, `app/src/utils/rodeo-template.test.ts` — fixtures + tests de los builders/helpers nuevos.
- `app/e2e/helpers/admin.ts` — +`waitForServerPresetDeleted`/`waitForServerPresetUpdated`/`waitForServerCustomFieldDeleted`/`waitForServerCustomFieldUpdated`/`seedCustomAttribute`.
### Modificados — specs (reconciliación as-built)
- `requirements.md` (nota R13.30), `design.md` (§13.5 reconciliación as-built + §13.2 router.back), `tasks.md` (M7-A.1..B.4 `[x]`/`[~]` + AS-BUILT).

## Mapa R<n> → archivo:test
- **R2.6** (⋯ por fila) → `maniobra.tsx` `PresetRow`; e2e `maniobra-rutinas-gestion.spec.ts` (todos los tests abren el ⋯).
- **R2.7** (renombrar) → `maniobra.tsx` `onPresetRename`+`SavePresetSheet`; e2e "Renombrar" (`waitForServerPresetUpdated` mismo id, name nuevo, config intacto).
- **R2.8** (reconfigurar, NO arranca jornada) → `jornada.tsx` `onGuardarCambios`/`editPresetId`; e2e "Reconfigurar" (config nuevo + 0 sesiones activas).
- **R2.9** (eliminar con confirmación) → `ConfirmDeleteSheet`+`onPresetDeleteConfirm`; e2e "Eliminar" (`waitForServerPresetDeleted`).
- **R2.10** (cualquier rol) → sin gating de rol en la UI (RPC 0057 autoriza); cubierto implícito (owner en e2e; el server autoriza por has_role_in).
- **R2.11** (no afecta jornada activa) → por construcción (snapshot); e2e "R2.11" (sesión activa sembrada sigue activa tras borrar el preset).
- **R13.28** (softDeleteCustomField UPDATE plano) → `custom-fields.ts`/`buildSoftDeleteCustomFieldUpdate`; unit `maneuver-reads.test.ts` (idempotencia); e2e `waitForServerCustomFieldDeleted`.
- **R13.29** (⋯ owner-only solo filas custom) → `FieldTemplateToggleList`+`editar-plantilla.tsx`+`isCustomField`; e2e "⋯ solo en custom" + "non-owner NO ve ⋯".
- **R13.30** (lectura histórica, **Opción B** post-fix-loop) → `buildCustomAttributesQuery` (filtra `deleted_at IS NULL AND active = 1`); unit `maneuver-reads.test.ts` ("trae las vivas" + "NO trae la borrada bajo Opción B"); e2e `maniobra-custom-gestion.spec.ts` "R13.30 (Opción B)": valor visible antes de borrar ✓ / el diálogo ADVIERTE ✓ / tras borrar la ficha YA NO lo muestra ✓ (ex-`test.fixme`, ahora REAL y VERDE).
- **R13.31** (confirmación con ADVERTENCIA destructiva) → `buildCustomFieldDeleteImpactLines` (reescrito a advertencia)+`fetchCustomFieldDeleteImpact`+`ConfirmDeleteSheet`; unit `custom-field.test.ts` (6 casos: cargas dejan de verse / no recuperable / liviano sin cargas / null degradación); e2e "Su 1 carga previa dejará de verse"/"Se quita de 1 rodeo"/"Esta acción no se puede deshacer".
- **R13.35** (índice UNIQUE custom parcial sobre deleted_at) → `supabase/migrations/0101_field_definitions_data_key_partial.sql`; test backend `supabase/tests/custom/run.cjs` caso `(o)` (crear→borrar→recrear-mismo-slug OK + control negativo dos-vivas=23505) — **PENDING-DEPLOY** (verde tras aplicar 0101).
- **R13.32** (editar label/opciones, no re-tipar) → `updateCustomField`+`CustomFieldSheet` modo edit (tipo locked); e2e "Editar" (label/options nuevos; data_type/ui_component intactos).
- **R13.33** (append-only opciones) → `CustomFieldSheet` modo edit (locked options sin ×); e2e "Editar" (chip overo sin ×).
- **R13.34** (revalidar caps en UPDATE) → guard 0093 (server, ya corre before insert OR UPDATE) + `validateCustomFieldDraft` client-side en `updateCustomField`.
- **R13.19** (soft-deleted fuera de forms/listas) → `buildFieldCatalogQuery` filtra `deleted_at`; e2e "se va de la plantilla".

## Decisiones de implementación
- **DM7-1 (append-only opciones = cliente, no server):** seguí el default. La UI no ofrece quitar opciones existentes (chips sin ×); `updateCustomField` no enforza superset (el server tampoco). Documentado.
- **DM7-2 (reconfigurar = flag del wizard):** seguí el default. `jornada.tsx` recibe `editPresetId` → modo edición (CTA "Guardar cambios", suprime "Guardar como rutina"). NO una pantalla aparte.
- **DM7-3 (variante de display histórico):** seguí el default. `buildCustomAttributesViewQuery` separada (sin filtro) para la ficha; los forms de alta usan `fetchEnabledCustomProperties` (ya filtra). La ficha hace display-only las filas `isDeleted`.
- **`buildFieldCatalogQuery` ahora filtra `deleted_at IS NULL`:** decisión propia, NECESARIA para R13.19 (el catálogo alimenta plantilla/gating/alta) + para discriminar filas custom del ⋯ (R13.29 surface `establishment_id`). Afecta solo a custom soft-deleteadas (las de fábrica tienen `deleted_at` NULL siempre) → sin regresión de fábrica.
- **Reconfigurar usa `router.back()` (no `replace`):** el wizard se pushea sobre el landing; `replace('/maniobra')` apilaba un landing duplicado. `back()` vuelve al existente.
- **CTA de borrado = terracota (no rojo de pánico):** la paleta no tiene token de error; terracota es el color de aviso del DS, consistente con los banners de error existentes.

## Autorrevisión adversarial (paso 8)
Busqué activamente mis propios bugs:
- **(seguridad)** `softDeleteCustomField`/`updateCustomField` son UPDATE plano → la RLS `field_definitions_update` (owner-only, no-global) + el guard `tg_field_definitions_custom_guard` re-validan server-side; un no-owner → 42501 reject → R10.8. La UI es owner-only (defensa en profundidad). NO expongo RPC nueva. `updateCustomField` NUNCA manda `establishment_id`/`data_type`/`data_key`/`ui_component` (inmutables; el guard también los blinda). **Verificado**: el oráculo e2e confirma `data_type`/`ui_component` intactos tras editar.
- **(idempotencia)** `softDeleteCustomField` filtra `deleted_at IS NULL` → re-borrar es no-op (unit lo prueba: 2do UPDATE = 0 filas, timestamp intacto). `softDeletePreset` ya es idempotente (RPC 0057).
- **(edge: impacto)** `fetchCustomFieldDeleteImpact` degrada a copy sin número si un conteo no resuelve (unit + e2e). COUNT siempre devuelve una fila (n=0, nunca null). Singular/plural es-AR cubierto (1 rodeo/1 carga).
- **(R13.30 — el bug GORDO que cacé)** El fix de cliente PASA los unit (view query trae el borrado), pero el **e2e cazó que NO funciona end-to-end**: la sync-stream `est_field_definitions_custom` PRUNEA la fila soft-deleteada del device → el JOIN no resuelve el label → el valor desaparece. Esto contradice la premisa del design (§13.5) y de M7 ("Gate 1 N/A"). Lo DOCUMENTÉ + `test.fixme` + reporté en vez de improvisar un workaround (ej. denormalizar el label = schema change que el spec no pidió).
- **(UI de manga)** Títulos de los 3 sheets con `lineHeight` matching (g/j/p). Sheets header-fijo/body/footer (el `CustomFieldSheet` modo edit reusa el layout robusto de M5). Guard tap-through doble-rAF en TODOS los sheets nuevos (`ConfirmDeleteSheet`/`PresetActionsSheet`/`CustomFieldActionsSheet`) → e2e de regresión tap-through del `CustomFieldActionsSheet` con `hasTouch`+`touchscreen.tap()` PASA. El ⋯ es zona de tap propia (≥`$touchMin`) que NO roba el tap del cuerpo (que arranca la jornada). Anti-hardcode 0.
- **(tests que pasan por la razón correcta)** Cada e2e tiene oráculo SERVER (deleted_at/label/config_schema reales), no solo UI. La negativa del non-owner verifica la AUSENCIA del ⋯ (no un falso-verde). La R2.11 verifica que la sesión SIGUE activa (no que el preset se borró). El test de R13.30 se splitea: lo verificable pasa, lo bloqueado es `test.fixme` explícito (no un verde falso).

## Reconciliación de specs
- `tasks.md`: M7-A.1/A.2/A.3/B.1/B.3/B.4 → `[x]` con notas AS-BUILT; M7-B.2 → `[~]` con la nota de la brecha de sync-rules.
- `design.md` §13.5: nota de reconciliación as-built (el fix de cliente es correcto pero insuficiente; R13.30 requiere el cambio de stream + re-Gate-1). §13.2: nota `router.back()`.
- `requirements.md` R13.30: nota de reconciliación (EARS intacto; cumplido a medias; reportado).

## ⚠️ El BLOQUEO de R13.30 quedó RESUELTO en el fix-loop (ver abajo) — Raf eligió Opción B.

---

# FIX-LOOP M7 (implementer Opus, 2026-06-20) — 2 fixes tras el RECHAZO del reviewer + la decisión de producto de Raf

> NO commiteé, NO toqué `feature_list.json`, NO deployé a la DB compartida ni a PowerSync. `baseline_commit` SIN sobreescribir (multi-sesión).

## FIX 1 (HIGH del reviewer) — índice UNIQUE custom PARCIAL sobre `deleted_at` (habilita borrar+recrear, R13.26/R13.35)
- **Migración nueva** `supabase/migrations/0101_field_definitions_data_key_partial.sql`: drop + recreate de `field_definitions_data_key_per_est` como PARCIAL `... WHERE establishment_id IS NOT NULL AND deleted_at IS NULL`. Una fila soft-deleteada libera su slot `(establishment_id, data_key)` → recrear con el mismo slug ENTRA (no `23505`); dos vivas con el mismo slug siguen colisionando. Índice global intacto. **NO aplicada al remoto** (deploy gateado por Raf). Comentario cita el hallazgo del reviewer + R13.26.
- **Test backend** `supabase/tests/custom/run.cjs` caso `(o)`: crear → soft-delete → recrear-mismo-slug = OK + control negativo (dos vivas = `23505`). **PENDING-DEPLOY**: el sub-caso recrear-tras-borrar es VERDE solo tras aplicar `0101`; antes da `23505` (= el bug). El control negativo pasa con o sin `0101`.
- **Reabre el Gate de seguridad de schema** (security modo `spec`) para esta migración — lo corre el leader.

## FIX 2 (producto, Opción B de Raf) — advertencia destructiva + limpieza del split muerto de R13.30
- **Copy de la confirmación de borrado custom = ADVERTENCIA destructiva** (`buildCustomFieldDeleteImpactLines` reescrito): con cargas (N>0) "Sus N cargas previas dejarán de verse y no vas a poder recuperarlas desde la app." + "Se quita de M rodeos…"; sin cargas (N=0) advertencia liviana; el `ConfirmDeleteSheet` cierra con "Esta acción no se puede deshacer." (terracota, jerarquía destructiva). Título "¿Eliminar «[label]»?", CTA "Eliminar". Vetado yo mismo (recorte de descendentes OK con `lineHeight` matching; targets ≥`$touchMin`; web táctil 360/412 en `custom-gestion-borrar-impacto-*.png`).
- **Split de R13.30 revertido (era código muerto bajo Opción B):** `buildCustomAttributesViewQuery` → vuelve a `buildCustomAttributesQuery` filtrando `deleted_at IS NULL AND active = 1`; se removió el surface `deleted_at` + el flag `isDeleted` (del service + del tipo + de `CustomPropertiesFicha`). Confirmado por e2e: la ficha NO crashea cuando una propiedad tiene `custom_attributes` pero su `field_definitions` fue pruneada (INNER JOIN sin fila → "desaparición prolija").
- **`test.fixme` de R13.30 RESUELTO a la semántica de Opción B** (`maniobra-custom-gestion.spec.ts`): tras borrar, la ficha NO muestra el valor histórico + el diálogo SÍ advirtió. Pasa REAL (no fixme).

## Reconciliación de specs (fix-loop)
- **R13.30** reescrito a Opción B (al borrar, el histórico deja de verse; la confirmación advierte). Opción A (preservar, quitar el filtro de la stream) → **fast-follow/backlog** (`docs/backlog.md` entrada 2026-06-20).
- **R13.31** reconciliado: el copy es advertencia destructiva (no "se conservan").
- **R13.35 NUEVO** (índice parcial) + nota bajo R13.26: marca que **reabre el gate de seguridad de schema**. Coverage table actualizada.
- **design.md §13** (§13.3 migración 0101; §13.4 copy destructivo; §13.5 reconciliación a Opción B; §13.7 DM7-3 resuelto; header §13) + **tasks.md** (M7-B.2 `[x]` Opción B, M7-B.4 sin fixme, **M7-B.5 NUEVO** índice, Gates de M7) + **context-m7** §4/§5 reconciliados.

## Verificación (fix-loop, resultados REALES)
- **typecheck cliente**: `npx tsc --noEmit` → EXIT 0.
- **anti-hardcode**: `node scripts/check-hardcode.mjs` → 0 violaciones.
- **Client unit** (loader del harness): suites afectadas + adyacentes **740 pass / 0 fail** (incl. `custom-field` reescrito a la advertencia destructiva, `maneuver-reads` con `buildCustomAttributesQuery` filtrando + el test "NO trae la borrada" bajo Opción B, `local-reads`, `custom-value`, `custom-render`, `rodeo-template`, powersync `upload*`).
- **E2E M7**: `maniobra-rutinas-gestion.spec.ts` **4/4** + `maniobra-custom-gestion.spec.ts` **5/5** (incl. el ex-`fixme` de R13.30 ahora REAL y VERDE) = **9/9 passed**. Regresión adyacente: `maniobra-custom-bugfix` (2/2) + `maniobra-customfield-validacion` (1/1) **3/3 passed**.
- **`supabase/tests/custom/run.cjs` caso `(o)`**: **PENDING-DEPLOY** — el sub-caso recrear-tras-borrar requiere `0101` aplicada (hoy daría `23505` = el bug). NO corrí la suite custom contra el remoto en esta pasada (la migración no está deployada).

## ⚠️ PARA TU ATENCIÓN (antes del re-review + Gate de seguridad)
1. **Deploy de `0101`**: la migración del índice parcial NO está aplicada a la DB compartida. Hasta aplicarla, el flujo borrar+recrear sigue roto en prod y el test backend `(o)` queda pending-deploy. **Reabre el Gate de seguridad de schema** (lo corrés vos/el leader). Riesgo bajo (predicado más restrictivo, sin custom soft-deleteadas en prod, índice global intacto).
2. **Opción B confirmada con Raf**: en MVP el histórico de un dato custom borrado DEJA DE VERSE en la ficha; la app lo advierte. La Opción A (preservar) está en `docs/backlog.md` como fast-follow (requiere cambiar `est_field_definitions_custom` + deploy a PowerSync + re-Gate-1).
3. **Bug PRE-EXISTENTE NO de M7 (fuera de scope, lo cacé en la regresión)**: `maniobra-custom-render.spec.ts:195` falla DETERMINÍSTICAMENTE en el paso de EDITAR in-place un `custom_attribute` (Pinto→Manchado) con `UNIQUE constraint failed: ps_data__custom_attributes.id`. Es la carrera LWW de la VIEW de PowerSync en `setCustomAttribute` (UPDATE-count devuelve 0 cuando debería 1 → INSERT espurio que colisiona el id sintético). **NO lo introdujo este fix-loop**: el diff de M7 NO toca `setCustomAttribute` ni `buildUpdateCustomAttribute`/`buildInsertCustomAttribute` (solo el READ `fetchCustomAttributes` + el tipo). El display de un valor LIVE en la ficha SÍ pasa (línea 252 "Pinto" visible); la falla es solo en el re-guardado in-place. Pre-existente desde M5-C.1/C.3. Vale una mirada aparte (no bloquea M7).

## Verificación (1ra pasada, histórica)
- `node scripts/check.mjs`: typecheck cliente OK + anti-hardcode 0 + cliente unit **1600 VERDE**. Rojo SOLO backend `animal`/`spec 13` = flake `animals_tag_unique` (spec-08 otra terminal). NO regresión M7.
- E2E (1ra pasada): `maniobra-rutinas-gestion.spec.ts` 4/4 + `maniobra-custom-gestion.spec.ts` 4/4 + 1 fixme (ya resuelto en el fix-loop).
- Capturas web táctil 360/412 en `tests/modo-maniobra/rutinas-*.png` + `custom-gestion-*.png`.
