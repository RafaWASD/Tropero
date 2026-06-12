# Review — spec 10 chunk UI-B (seleccion masiva + bottom-sheet + remocion card)

Reviewer: reviewer agent | Fecha: 2026-06-12 | Baseline: 10a9f4e
Impl: progress/impl_10-ui-b-seleccion.md | Design-review leader: PASS (design/spec10-ui-b/)
Scope: T-UI.4 (seleccion-masiva.tsx) + T-UI.5 (bottom-sheet + progreso) + remocion card "Datos que se cargan aca".

## Veredicto: APPROVED

## Trazabilidad R<n> <-> test
- R11.1 seleccion por checkbox -> bulk-selection.test.ts + screenshot seleccion-castracion.png
- R11.3 defaults castracion (solo ternero future_bull=false) -> bulk-selection.test.ts:39 + :61
- R11.4 defaults destete (todos terneros/as) -> bulk-selection.test.ts:69
- R11.5 secciones+todos/ninguno+contador -> bulk-selection.test.ts (sectionCheckState/selectedCount)
- R11.6 estrella resalta sin modal -> AnimalRow prop highlight; activacion castrate&&futureBull&&checked
- R11.7 CTA numero vivo disabled en 0 -> bulk-selection.test.ts:90 + invariante :264
- R11.8 bottom-sheet desglose+warning+copy reversible -> bulk-selection.test.ts:204 + selection-display.test.ts:99 + screenshot bottom-sheet.png
- R11.9 orden por ID + busqueda>20 + fila>=56px -> selection-display.test.ts + AnimalRow compact >=touchMin(56)
- R5.6 override aviso+revertir C6 -> bulk-selection.test.ts:234 + revertCategoryOverride animals.ts:1017
- R7.2 destete cross-rodeo exclusion+contador -> bulk-candidates.test.ts (excludedByRodeoConfig) cableado en pantalla
- R3.3/R13.7 castracion+observacion author_id forzado -> local-reads.test.ts:1232 + planCastration (2 statements)
- has_weaning -> local-reads.test.ts:1305 (synced vivo/borrado/pending, SQLite real)

(UI E2E completa = T-UI.9/T-UI.10, chunk siguiente, fuera de scope. Chunk dejo utils puros + builder testeados + screenshots como oraculo.)

## Tasks completas: SI (scope del chunk)
T-UI.4=[x], T-UI.5=[x] con AS-BUILT. Tasks [ ] restantes (T-UI.6..T-UI.11, T-G1.2) son de chunks posteriores; fuera de scope; no bloquean.

## Foco — verificacion
1. Defaults EXACTOS OK: buildBulkSelectionState pre-tilda solo ternero && futureBull!==true (bulk-selection.ts:83-85); destete todos (:97). Pantalla usa state.selected sin pisar (seleccion-masiva.tsx:156). Estrella del screenshot = check manual de demo; estado inicial NO lo tilda.
2. CTA+contador OK: count=selectedCount(liveState) del selected vivo (:169); disabled en 0 (:357); header se actualiza al togglear; invariante selectedCount==summary.total testeado.
3. Bottom-sheet OK: desglose suma bien (summarizeSelection byCategory); warning futuros toritos solo castrate && futureBullCount>0 (BulkConfirmSheet.tsx:70); override usa patron C6 (revertCategoryOverride, override=false+category_id en un UPDATE); copy reversible EXACTO (:186); NO hay "no se puede deshacer" (solo en comentarios :12/:184).
4. Al CONFIRMAR OK: applyBulkCastration/applyBulkWeaning; castracion=2 CrudEntries/animal (UPDATE is_castrated=1,future_bull=0 + INSERT observacion); progreso por animal (onProgress + DrainRejection por profileId); usa runLocalWrite/runLocalQuery (SQLite local); NO toca connector ni fetch a Supabase.
5. author_id NUNCA en payload OK: buildAddObservationInsert (local-reads.ts:1139) sin author_id; test :1232 lo pinea; path planCastration->buildObservation lo respeta.
6. Card removida sin codigo muerto OK: GroupViewScreen.tsx sin GroupConfigSummary ni imports Syringe/Milk/GroupActionsAvailability (grep 0 matches); sin archivo huerfano; gating sigue en group-data.ts -> GroupActionsBar (Vacunar/Destetar OK).
7. buildGroupCandidateFlagsQuery OK: parametrizada (placeholders + args); scopeada por la stream+perfil (multi-tenant, ADR-025/026); no inventa establishment_id; has_weaning filtra deleted_at IS NULL; test SQLite real :1305.
8. AnimalRow highlight OK: additiva, default false; solo backgroundColor/borderLeft en compact; usos existentes no la pasan -> intactos.

## CHECKPOINTS
- C1 [x] - C2 [x] - C3 [x] (capas correctas; sin hardcode establishment_id; lint anti-hardcode 0 violaciones)
- C4 [x] (utils+builders contra SQLite in-memory; 951 client unit pass; backend 22/22)
- C6 [x] (3 archivos; tasks del chunk [x]; cada R<n> con >=1 test)
- C7 [x] (flags scopeados por stream+perfil; observacion deriva establishment del perfil; sin tabla/RLS nueva)
- C8 [x] (SQLite local; encolado offline-safe; sync via uploadData as-built)

## Checklist RAFAQ
- A. RLS/multi-tenancy: N/A (frontend puro, sin tablas/policies nuevas; aislamiento heredado).
- B. Offline-first APLICA: [x] funciona offline; [x] scoped por establishment activo; [x] conflictos (castracion no-op por valor; eventos UUIDv5 dedup PK); [x] sin requests sincronos a Supabase desde la pantalla.
- C. BLE: N/A.
- D. UI de campo APLICA: [x] targets >=56 (touchMin); [x] fuente hero $6/18pt; [x] una decision por pantalla; [x] loading visible.
- E. Edge Functions: N/A.

## check.mjs: exit 0 (verde)
- anti-hardcode 0 violaciones; typecheck OK; client unit 951/951 pass; operaciones-rodeo 22/22; sync-streams 25/25.
- Tests nuevos: selection-display.test.ts (9 casos); local-reads.test.ts (+buildGroupCandidateFlagsQuery, author_id, buildSetCastratedUpdate true/false, buildProfileEstablishments*).

## Cambios requeridos: ninguno.
## Exactitud specs (codigo->spec): OK. design.md 1.1 AS-BUILT UI-B fiel; tasks.md T-UI.4/T-UI.5 [x] con notas as-built. Sin specs contradictorias.
