baseline_commit: 6570029c50fa3e13aff3850f5902f2c97e0a58f8

# Impl — spec 10 DELTA «rodeo grande» — Fases 3 + 4 (hooks + UI)

**Feature**: delta-spec `rodeo-grande` sobre feature 10 (`done`). Corre su propio ciclo SDD.
**Alcance de ESTE run**: Fase 3 (T-RG.19..21 — hooks) + Fase 4 (T-RG.22..27 — UI). NO E2E (Fase 5 = otro run).
**Baseline (Gate 2)**: `6570029c50fa3e13aff3850f5902f2c97e0a58f8` — MISMO baseline que Fases 1+2 (multi-sesión: el SHA previo a la 1ª task de la feature; trabajamos sobre `main`; NO se sobreescribe).

> Pre-condición: las Fases 1+2 (capa de datos) están hechas y verdes (working tree, sin commitear aún) — `progress/impl_10-rodeo-grande-fase1-2.md`. Construyo la UI/hooks encima consumiendo `group-page.ts`/`group-page-cursor.ts`/`management-groups.ts`/`group-data.ts`. NO toco los archivos de la otra terminal (feature 19 / teléfono: `phone.*`, `classify-error.*`, `validation.*`, `establishments.ts`, `mas.tsx`, `crear-campo.tsx`, `telefono.*`, `PhoneField.tsx`, migración 0126).

## Plan (T-RG.19..27)

### Fase 3 — hooks
- **T-RG.19** — `useGroupView` al contrato PAGINADO (design §6.2): `animals` (páginas acumuladas), `actions`, `totalCount`, `loading`/`loadingMore`/`reachedEnd`/`error`, cursor interno; carga inicial = meta (count+gating+opciones) + 1ª página; `loadMore()` con guard de-un-solo-en-vuelo (RG1.6) + corte por `reachedEnd` (RG1.5).
- **T-RG.20** — refresh silencioso (foco/`lastSyncedAt`): recarga la VENTANA cargada (`LIMIT loadedCount` desde el tope, `fetchGroupWindow`), reemplaza en el lugar con keys estables (`profileId`), sin resetear a página 1 ni tocar `loading`; fallo transitorio conserva la lista; refresca `totalCount`+`actions`.
- **T-RG.21** — estado buscador/chips FOLDED en `useGroupView`: texto con debounce 250ms; chips `categoryCode`/`sex`; modo lista paginada (sin texto, filtro por chips en SQL) vs modo búsqueda (con texto → `searchGroupAnimals` + intersección client-side con chips); guard de secuencia; reset de cursor al cambiar criterio (RG3.7); volver a lista completa al limpiar (RG3.8). Lógica DECIDIBLE extraída a `utils/group-view-model.ts` (PURA, testeable).

### Fase 4 — UI
- **T-RG.22** — `GroupViewScreen`: `ScrollView`+`.map()` → **`FlatList`** (§6.1): `ListHeaderComponent` = meta + card acciones; `renderItem` = `renderRow`; `keyExtractor` = `profileId`; `onEndReached` = `loadMore` (threshold 0.5); `ListFooterComponent` = spinner "cargando más"; `ListEmptyComponent` = loading/empty/no-match. FlatList, NO FlashList.
- **T-RG.23** — `GroupSearchBar` + chips FIJOS arriba (fuera de la FlatList, RG4.4): buscador + FilterChip categoría/sexo + FilterPopover, **clonando** el patrón de `animales.tsx` (tap nativo: `onPress`+a11y en la misma pieza Tamagui con `pressStyle`, SIN `<Pressable>`). Sexo solo si ambos presentes (RG3.9).
- **T-RG.24** — `GroupMetaHeader` muestra `totalCount` real (RG2.1) — "…" mientras `null` (RG2.3), es-AR `toLocaleString('es-AR')` (RG2.4); `lineHeight` matching. `GroupAnimalsList` absorbido en la FlatList.
- **T-RG.25** — `rodeo/[id].tsx`: usa `useGroupView({establishmentId, group:{type:'rodeo',id}})` en vez de `fetchAnimals({rodeoId})`; cablea buscador/chips.
- **T-RG.26** — `lote/[id].tsx`: ídem (`group:{type:'lote',id}`) + reconciliar la BAJA EN TANDA con paginación (set completo `fetchAllGroupMembers` + FlatList) + resolver el edge del nav-param gigante (ver Decisiones).
- **T-RG.27** — pasada es-AR voseo + descendentes sobre las piezas nuevas.

### Soporte (capa de datos aditiva, reconciliado)
- `buildGroupSexOptionsQuery` (local-reads.ts) + test — RG3.9 requiere "sexos presentes (query scopeada)"; Fase 1+2 construyó opciones de CATEGORÍA pero no de SEXO. Se completa acá (aditivo, en archivos de MI feature). Robusto (independiente de category→sex, que fallaría con `cut`).
- `fetchGroupSexOptions` + `fetchGroupWindow` (group-page.ts, aditivos).
- `utils/group-view-model.ts` (PURO) + test — `canLoadMore`/`dedupById`/`intersectSearchWithChips`/`isSearchActive`/`sexFilterAvailable`.

## Estado: DONE (Fases 3+4) — esperando reviewer

Todas las tasks T-RG.19..27 `[x]`. `tsc` verde + tests puros/in-memory **181/181** (afectados) / **240/240** (con regresión). Fase 5 (E2E) = otro run.

## Archivos tocados / creados

**Creados:**
- `app/src/utils/group-view-model.ts` — lógica PURA del hook (`canLoadMore`/`dedupById`/`intersectSearchWithChips`/`isSearchActive`/`hasActiveChips`/`sexFilterAvailable` + tipo `GroupFilter`).
- `app/src/utils/group-view-model.test.ts` — tests del view-model (RG1.5/1.6, RG3.6/3.8/3.9, RG4.5).
- `app/src/components/GroupSearchBar.tsx` — buscador + chips categoría/sexo + popovers, CLON tap-nativo del patrón de `animales.tsx` (RG3.10). Sin `<Pressable>` externo.

**Modificados:**
- `app/src/hooks/useGroupView.ts` — reescrito al contrato paginado (`{ establishmentId, group }`; `animals`/`actions`/`totalCount`/`loading`/`loadingMore`/`reachedEnd`/`error`/`loadMore` + buscador/chips folded). Refs para guards + secuencia; refresh silencioso de ventana.
- `app/src/hooks/index.ts` — export `GroupViewParams` (era `GroupViewData`).
- `app/src/services/powersync/local-reads.ts` — `buildGroupSexOptionsQuery` (aditivo, RG3.9).
- `app/src/services/powersync/local-reads.test.ts` — test de `buildGroupSexOptionsQuery`.
- `app/src/services/group-page.ts` — `fetchGroupWindow` (refresh de ventana) + `fetchGroupSexOptions`.
- `app/src/components/GroupViewScreen.tsx` — `ScrollView`+`.map()` → `FlatList` + `GroupSearchBar` fijo arriba; ya no genérico (`AnimalListItem`).
- `app/src/components/GroupViewBits.tsx` — `GroupMetaHeader` con `totalCount` real (es-AR, "…"); `GroupAnimalsList` eliminado.
- `app/src/components/index.ts` — export `GroupSearchBar`/`GroupSearchBarProps`/`GroupCategoryChipOption`; se fue `GroupAnimalsList`.
- `app/app/rodeo/[id].tsx` — `useGroupView({ group:{type:'rodeo', id} })` (era `fetchAnimals({rodeoId})` + loader).
- `app/app/lote/[id].tsx` — ídem lote + modo selección de baja en tanda reconciliado (set completo `fetchAllGroupMembers` + FlatList) + fix del nav-param gigante.
- `app/app/lote/venta.tsx` — resuelve el set desde `mode`+`ids` (all/subset) contra `fetchGroupMembers` (anti-IDOR intacto).
- `scripts/run-tests.mjs` — registra `group-view-model.test.ts`.

## Trazabilidad R<n> → test (Fases 3-4)

Nota: los hooks/pantallas importan el SDK (no corren en node:test — patrón as-built). Su lógica DECIDIBLE se cubre con tests PUROS de `group-view-model.ts` + los builders in-memory; el wiring completo lo cubre la Fase 5 (E2E) + `tsc`.

- RG1.5 (reachedEnd corta la paginación) / RG1.6 (un solo loadMore en vuelo) → `group-view-model.test.ts` `RG1.5: canLoadMore …` / `RG1.6: canLoadMore …` / `canLoadMore — NO dispara durante la carga inicial ni en modo búsqueda`.
- RG4.5 (keys estables / dedup) → `group-view-model.test.ts` `RG4.5: dedupById …` (x2).
- RG3.6 (intersección búsqueda ∩ chips) → `RG3.6: intersectSearchWithChips …` (x2).
- RG3.8 (limpiar → lista completa; detección de modo) → `RG3.8: isSearchActive …`.
- RG3.9 (chip de sexo solo si ambos) → `RG3.9: sexFilterAvailable …` (puro) + `local-reads.test.ts` `buildGroupSexOptionsQuery — DISTINCT animal_sex del grupo …` (SQL scopeado + overlay).
- RG1.3/RG2.1/RG6.1/RG6.2 (loadMore anexa, count real, refresh silencioso) → wiring del hook cubierto por `tsc` + Fase 5; la lógica de corte/preservación de `reachedEnd` + dedup es la testeada arriba.
- RG3.10 (tap nativo sin `<Pressable>`) → verificado por inspección (autorrevisión) + Fase 5 (tap real en web táctil).

## Autorrevisión adversarial

Busqué (revisor hostil) y encontré/cerré:
- **`<Pressable>` externo en controles nuevos (RG3.10, bug #1 en nativo)**: AUDITÉ todos los controles nuevos. `GroupSearchBar` (buscador `TextInput` RN + `FilterChip`/`FilterPopover` = `XStack` con `onPress`+`pressStyle`+a11y, SIN Pressable envolviendo) OK. `lote/[id]` modo selección: el toggle "Todos" lo pasé de `<Pressable>` a `XStack` tap-nativo; CTA "Registrar salida" y "Vender/Descartar" = `XStack` con `onPress`+`pressStyle` OK. Los ÚNICOS `<Pressable>` que quedan envuelven un ícono lucide PLANO (botón back ChevronLeft/X) SIN `pressStyle` → patrón estándar as-built, no aplica el bug (el bug es Pressable envolviendo un Tamagui CON pressStyle). CERRADO.
- **Refresh silencioso resetea el scroll**: NO. `refreshWindow` reemplaza la ventana con `dedupById` + keys estables `profileId`; NO toca `loading`, NO resetea el cursor a página 1. La FlatList preserva la posición de las filas que sobreviven (RG6.1). CERRADO.
- **`onEndReached` loopea**: NO. `loadMore` guardado por `canLoadMore` (PURO): no dispara si `loading`/`loadingMore`/`reachedEnd`/`isSearching`. Refuerzo: `loadingRef=true` durante CUALQUIER recarga de 1ª página/ventana (no solo la inicial) → un `onEndReached` disparado en medio no anexa una página desperdiciada; y el `seq` descarta una página que vuelve tras un cambio de criterio. La progresión (lista corta → carga páginas hasta llenar/`reachedEnd`) es correcta, no un loop de la misma página. CERRADO.
- **Baja en tanda "todos" enumera miles de UUIDs**: NO. `goToVenta` manda el csv MÁS CHICO (seleccionados vs excluidos) + `mode`; "todos" → csv vacío. Reconciliado con `venta.tsx` (resuelve del lado destino contra `fetchGroupMembers`, anti-IDOR intacto). CERRADO.
- **Race de mount (efecto de sync/foco compitiendo con la carga inicial)**: los refresh silenciosos (foco/sync) esperan `hasLoadedOnceRef` (la 1ª carga terminó) → NO compiten con la carga inicial ni la descartan. El 1er foco NO refresca (`didFocusOnceRef`). CERRADO.
- **`error` viejo enmascara resultados nuevos**: agregué `setError(null)` en `refreshWindow`/`runSearch` OK → un error viejo de la lista no tapa la ventana recargada ni el no-match de búsqueda. CERRADO.
- **`loading` colgado con `group` null**: el hook devuelve `loading: group ? loading : false` (no queda "Cargando…" eterno si no hay grupo). CERRADO.
- **Chip de sexo derivado de categoría (frágil con `cut`)**: descartado — query PROPIA `buildGroupSexOptionsQuery` (`animal_sex` DISTINTO), robusta ante categorías sex-neutras. CERRADO.
- **`renderRow` de lote con `inTreatment` no as-built**: lo saqué del lote (el as-built de lote no lo pasaba; solo rodeo) → sin cambio de props (respeta la instrucción). CERRADO.
- **Archivos de la otra terminal (feature 19/teléfono)**: NO toqué `phone.*`/`classify-error.*`/`validation.*`/`establishments.ts`/`mas.tsx`/`crear-campo.tsx`/`telefono.*`/`PhoneField.tsx`/migración 0126. Verificado.

## Reconciliación de specs

- `tasks-rodeo-grande.md`: T-RG.19..27 `[x]` con notas as-built + changelog de Fases 3+4.
- `design-rodeo-grande.md`: §6.2 (firma del hook + `fetchGroupWindow` + refs/guards), §6.3 (folded + `buildGroupSexOptionsQuery`/`fetchGroupSexOptions` para RG3.9 + clon vs extraer), §6.4 (modo selección + EDGE del nav-param resuelto + reconciliación de `venta.tsx`), §1 (nota de archivos as-built de Fases 3-4).
- `requirements-rodeo-grande.md`: sin cambios de EARS (el *qué* no cambió; los detalles de firma/builder/nav-param viven en design). RG3.9 se cumple con una query propia de sexos (decisión de implementación documentada en design §6.3).

## Verificación (network-free)

- `cd app && pnpm typecheck` (tsc --noEmit) → **verde** (sin output).
- `node … --test app/src/services/powersync/local-reads.test.ts app/src/utils/group-page-cursor.test.ts app/src/utils/group-view-model.test.ts` → **tests 181 / pass 181 / fail 0**.
- `node … --test … group-actions/bulk-candidates/bulk-selection/batch-exit-selection` (regresión de las áreas tocadas) → **240/240** en conjunto con los de arriba.
- **NO** se corrió `check.mjs` ni E2E (pegan a la DB compartida → rate-limit; la cobertura E2E es la Fase 5, otro run). Confirmado.
