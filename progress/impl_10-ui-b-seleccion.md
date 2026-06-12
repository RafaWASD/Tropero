baseline_commit: 10a9f4e0cf55d65b639bca521b570af3a7458c30

# impl — spec 10 chunk UI-B: pantalla de SELECCIÓN MASIVA + bottom-sheet de confirmación

> Chunk UI-B de Fase 4 (spec 10). Hace funcionales **Castrar** y **Destetar** (hoy stubs).
> SOLO T-UI.4 (pantalla `seleccion-masiva.tsx`) + T-UI.5 (bottom-sheet) + remoción de la card
> "Datos que se cargan acá" de la vista de grupo. NO vacunación (T-UI.6), NO ficha castrado (T-UI.7).
> Toda la lógica/services ya existen (Fase 2+3) — se REUSAN.

## Feature en curso
- spec 10 — Operaciones masivas por rodeo + vista de grupo.
- Estado real: EN IMPLEMENTACIÓN (multi-chunk; Puerta 1 aprobada, backend delta + Fase 2/3 + UI-A
  committeados). El `status: "spec_ready"` de feature_list.json es la etiqueta stale conocida
  (el `notes` dice "EN IMPLEMENTACIÓN"). Tasks T-DB.*, T-CL.*, T-UI.1/2/3 = `[x]`.

## Plan (tasks de este chunk)
- T1 (T-UI.4) — Pantalla `app/app/seleccion-masiva.tsx` (REEMPLAZA el stub): recibe op + grupo,
  arma candidatos (bulk-candidates) + selección (bulk-selection), render con secciones por categoría,
  AnimalRow compactos + checkbox, defaults pre-tildados, todos/ninguno por sección, contador vivo en
  header, orden por ID, búsqueda si >~20, ⭐ resaltado terracota al tildar (solo castración, sin modal),
  CTA fijo abajo con número vivo (disabled en 0), empty state.
- T2 (T-UI.5) — Bottom-sheet de confirmación (al tocar CTA): desglose por categoría, "⚠ N futuros
  toritos incluidos" (castración), aviso de override + revertir (patrón C6), CONFIRMAR/Volver, copy
  REVERSIBLE obligatorio. Al CONFIRMAR → bulk-operations → pantalla/estado de progreso.
- T3 — Remoción de la card "Datos que se cargan acá" de GroupViewScreen.tsx (decisión del leader,
  Nielsen #8). El gating de las acciones NO cambia (sigue en group-data.ts). Verificar no quede código
  muerto.

## Invariantes de seguridad a respetar (heredadas)
- `author_id` NUNCA en el payload de la observación (lo fuerza el server).
- La autorización de las masivas es server-side (RLS re-valida cada mutación); el gating de display NO
  es el control.
- Cero hardcode (ADR-023 §4). Touch targets ≥56px (manga-crítico).
- Copy reversible obligatorio; PROHIBIDO "no se puede deshacer".

## Progreso — DONE (esperando design-review del leader + reviewer + Gate 2)

### T1 (T-UI.4) — Pantalla `seleccion-masiva.tsx` ✅
- `app/app/seleccion-masiva.tsx` REEMPLAZA el stub. Recibe `op` (castrate|wean) + grupo (rodeo|lote + id).
- Datos: service NUEVO `app/src/services/bulk-selection-data.ts` (`fetchGroupSelectionProfiles`):
  rodeo→`fetchAnimals({rodeoId})`, lote→`fetchGroupMembers` (ambos as-built, traen la categoría del
  espejo C6 + el display); mergea los 3 flags que `AnimalListItem` NO expone vía el builder PURO NUEVO
  `buildGroupCandidateFlagsQuery` (`local-reads.ts`): `is_castrated`/`category_override`/`has_weaning`
  (=EXISTS un `weaning` vivo synced|pending overlay).
- Candidatos+selección = Fase 2 REUSADA intacta (`buildBulkCandidates`/`buildBulkSelectionState`).
- Presentación PURA NUEVA: `app/src/utils/selection-display.ts` (`sortByIdentifier` numérico/es-AR +
  desempate por profileId, `SEARCH_THRESHOLD=20`/`shouldShowSearch`/`filterBySearch`, `pluralCategoryLabel`)
  + test `selection-display.test.ts` (9 casos).
- Resaltado ⭐: prop NUEVA `highlight` de `AnimalRow` (borde izq terracota + fondo $surface — lenguaje
  terracota-signal as-built, SIN token nuevo); se activa `operation==='castrate' && futureBull && checked`
  (R11.6, SIN modal). CTA fijo abajo (Button primary) con número vivo, disabled en 0.
- R7.2 cableado: wean+lote resuelve `rodeoWeaningEnabled` (`fetchRodeoGroupActions` por rodeo distinto)
  → `buildBulkCandidates` excluye + cuenta → InfoNote "N terneros excluidos por config del rodeo".

### T2 (T-UI.5) — Bottom-sheet de confirmación + progreso ✅
- `app/src/components/BulkConfirmSheet.tsx`: scrim token NUEVO `$scrim` (= textPrimary @ 45%, patrón
  `fabHalo`); desglose (`summarizeSelection`→`pluralCategoryLabel`); "⚠ N futuros toritos" solo castración;
  aviso override + "Quitar la fijación…" → `revertCategoryOverride` as-built (C6) por animal con override
  + recarga; copy reversible literal; CONFIRMAR/Volver.
- Al CONFIRMAR → `applyBulkCastration`/`applyBulkWeaning` (Fase 3 REUSADOS) → panel de progreso in-screen
  `app/src/components/BulkProgressPanel.tsx` ("Castrando X de N…" via onProgress → "N listos, se
  sincronizan en segundo plano" + rechazos LOCALES por animal → Listo; error → reintentar).

### T3 — Remoción de la card "Datos que se cargan acá" ✅
- Sacada `GroupConfigSummary` de `GroupViewScreen.tsx` (Nielsen #8, redundante con las 3 acciones de
  abajo). Gating NO cambia (sigue en `group-data.ts`). Sin código muerto: `Syringe`/`Milk`/
  `GroupActionsAvailability` solo los usaba esa card → removidos del import. (Confirmado por grep.)

## Archivos tocados
NUEVOS:
- `app/app/seleccion-masiva.tsx` (reemplaza el stub)
- `app/src/services/bulk-selection-data.ts`
- `app/src/utils/selection-display.ts` (+ `.test.ts`)
- `app/src/components/BulkConfirmSheet.tsx`
- `app/src/components/BulkProgressPanel.tsx`
- `app/e2e/captures/spec10-uib-screenshots.capture.ts`
MODIFICADOS:
- `app/src/components/AnimalRow.tsx` (prop `highlight`)
- `app/src/components/GroupViewScreen.tsx` (quita la card + imports muertos)
- `app/src/components/index.ts` (exporta BulkConfirmSheet/BulkProgressPanel)
- `app/tamagui.config.ts` (token `$scrim`)
- `app/src/services/powersync/local-reads.ts` (`buildGroupCandidateFlagsQuery`)
- `app/src/services/powersync/local-reads.test.ts` (test del builder)
- `scripts/run-tests.mjs` (registra selection-display.test.ts)
- specs/active/10/{design.md,tasks.md} (reconciliación as-built)

## Cómo navegar a cada pantalla
- **Selección (Castrar/Destetar):** Inicio → card de rodeo/lote → vista de grupo → botón "Castrar" o
  "Destetar" de la GroupActionsBar → ruta `/seleccion-masiva?groupType=rodeo|lote&groupId=<id>&op=castrate|wean`.
- **Bottom-sheet:** dentro de la selección, tocar el CTA "Castrar/Destetar N animales".
- **Progreso:** dentro del sheet, tocar CONFIRMAR → in-screen.
- **Vista de grupo SIN card:** Inicio → card de rodeo/lote (ya no muestra "Datos que se cargan acá").

## Screenshots (viewport 412)
Comando: `cd app; pnpm exec playwright test e2e/captures/spec10-uib-screenshots.capture.ts --config playwright.capture.config.ts`
(requiere `pnpm run e2e:build` antes — hecho). Confirmadas en disco:
- `C:\DEV\RAFAQ\app-ganado\design\spec10-ui-b\seleccion-castracion.png`
- `C:\DEV\RAFAQ\app-ganado\design\spec10-ui-b\bottom-sheet.png`
- `C:\DEV\RAFAQ\app-ganado\design\spec10-ui-b\vista-grupo-sin-card.png`

## Trazabilidad R<n> → test
| R<n> | Cobertura |
|---|---|
| R11.1 (selección por checkbox) | `bulk-selection.test.ts` (defaults/toggles) + screenshot `seleccion-castracion.png` (filas con checkbox) |
| R11.5 (secciones + todos/ninguno + contador) | `bulk-selection.test.ts` (`sectionCheckState`/`selectedCount`) + screenshot |
| R11.6 (⭐ resalta SIN modal) | screenshot `seleccion-castracion.png` (1042 tildado, borde terracota, sin modal); lógica de activación en la pantalla (`operation==='castrate' && futureBull && checked`) |
| R11.7 (CTA con número vivo, disabled en 0) | `bulk-selection.test.ts` (count==selectedCount) + screenshot (CTA "Castrar 4 animales") |
| R11.8 (bottom-sheet: desglose + ⚠ + copy reversible) | `bulk-selection.test.ts` (`summarizeSelection` byCategory/futureBullCount) + `selection-display.test.ts` (`pluralCategoryLabel`) + screenshot `bottom-sheet.png` |
| R11.9 (orden por ID + búsqueda >20 + fila ≥56px) | `selection-display.test.ts` (sortByIdentifier/shouldShowSearch/filterBySearch) + `AnimalRow compact` ≥`$touchMin` as-built |
| R5.6 (override: aviso + revertir) | `bulk-selection.test.ts` (`overrideCount`) + screenshot `bottom-sheet.png` (aviso + "Quitar la fijación…") + `revertCategoryOverride` as-built (C6 tests) |
| R7.2 (destete cross-rodeo: exclusión + contador) | `bulk-candidates.test.ts` (excludedByRodeoConfig) — cableado en la pantalla |
| R3.3/R13.7 (castración + observación, author_id forzado) | `local-reads.test.ts` (buildAddObservationInsert nunca manda author_id) + `bulk-operations-plan.test.ts` (Fase 3) — REUSADOS sin tocar |
| has_weaning (candidatura destete) | `local-reads.test.ts` T-UI.4 (buildGroupCandidateFlagsQuery — synced vivo/borrado/pending) |
> La UI se cubre con E2E en T-UI.9/T-UI.10 (chunk siguiente). Este chunk dejó la pantalla testeable
> (utils puros + builder testeados) + las screenshots como oráculo del design-review.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo cerré)
1. **R7.2 destete cross-rodeo no cableado** (encontrado): la 1ra versión llamaba `buildBulkCandidates`
   sin el predicado → un lote con rodeos mixtos NO excluía los terneros de rodeo sin `destete`.
   CERRADO: resuelvo `rodeoWeaningEnabled` (gating por rodeo distinto, offline) para wean+lote, lo paso
   al util (que ya lo soporta + cuenta), y muestro "N excluidos por config del rodeo". Fail-OPEN de
   DISPLAY si el gating no resuelve (la authz es server-side, NO uso el gating de display como control).
2. **author_id en la observación** (verificado): NO toqué el path de `applyBulkCastration` →
   `planCastration` → `buildAddObservationInsert` (no manda author_id). Test as-built lo pinea.
3. **Copy amenazante** (verificado): el sheet usa SOLO "Podés corregirlo después desde la ficha de cada
   animal." — grep confirma que NO existe "no se puede deshacer" en mis archivos.
4. **Defaults exactos** (verificado): NO toqué `buildBulkSelectionState`; el screenshot confirma 3
   terneros comunes tildados + ⭐ y adultos sin tildar (R11.3) antes de mi tap manual.
5. **Idempotencia / re-aplicar** (verificado): retry llama `onConfirm` que re-arma el plan; castración =
   no-op por valor; destete = UUIDv5 + `buildExistingWeaningIdsQuery` excluye los ya aplicados (R6.3).
6. **Cero hardcode** (encontrado + cerrado): `top/left/right/bottom={0}` del backdrop → `$0`; el scrim
   rgba → token `$scrim` en el config. `check-hardcode.mjs` = 0 violaciones.
7. **Código muerto al sacar la card** (verificado por grep): `Syringe`/`Milk`/`GroupActionsAvailability`
   solo los usaba `GroupConfigSummary` → removidos del import de `GroupViewScreen.tsx`. `getTokenValue`
   sigue usándose (muted/ScrollView) → se queda.
8. **Multi-tenant** (verificado): `establishmentId` SIEMPRE del contexto activo (nunca hardcodeado); la
   query de flags lee por profileId de perfiles ya scopeados por la stream.
9. **has_weaning con weaning borrado** (encontrado el riesgo → testeado): el builder excluye los
   `deleted_at IS NOT NULL` (un destete borrado NO bloquea re-destetar). Test in-memory lo verifica.

## Reconciliación de specs
- `tasks.md` T-UI.4 + T-UI.5 → `[x]` con notas AS-BUILT (archivos reales + R7.2 cableado + remoción card).
- `design.md` §1.1 → nota AS-BUILT chunk UI-B (archivos, scrim token, progreso in-screen, card removida).
- NO se reabrió la interacción (lockeada Gate 0 v2). NO cambió el *qué* de ningún R<n> — solo se materializó.

## Verificación
- `cd app; pnpm typecheck` → verde.
- `node scripts/check.mjs` → exit 0 (anti-hardcode 0 violaciones; typecheck; client unit incl.
  selection-display + el test del builder en local-reads; operaciones-rodeo backend 22/22).
- Screenshots generadas y confirmadas en disco (3).

## NO marqué la feature done
Queda: design-review visual del leader → reviewer → Gate 2 → UI-C (vacunación + ficha castrado) / UI-D
(E2E) → Puerta 2.
