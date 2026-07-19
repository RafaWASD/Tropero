# Spec 10 — DELTA «rodeo grande» — Design

**Tipo**: delta-spec (ADR-028 Nivel B) sobre feature 10 `done`. **Grueso 100% cliente** (lecturas del SQLite local + reestructura de UI). **Sin delta de backend** (§7).
**Status**: reconciliado con el as-built del baseline (2026-07-18). Gate 1: **NO aplica** (§7).
**Fuente**: `context-rodeo-grande.md` (gana donde choque) + `requirements-rodeo-grande.md` + as-built del código.
**Reusa as-built**: `GroupViewScreen`/`GroupViewBits`/`useGroupView` (baseline T-UI.1), `animals.ts` (`fetchAnimals`/`searchAnimals`/`computeMirrorOverrides`/`computeReproStatuses`/`AnimalListItem`), `local-reads.ts` (`LOCAL_LIST_SELECT`/`buildAnimalsListQuery`/`buildSearchUnion`/head-count builders/`buildGroupCandidateFlagsQuery`), `management-groups.ts` (`fetchGroupMembers`), `group-data.ts` (gating), `bulk-selection-data.ts` (`fetchGroupSelectionProfiles`), `animales.tsx` (patrón buscador+`FilterChip`+`FilterPopover`), `a11y.ts` (`buttonA11y`/`labelA11y`).

> **Regla de oro del delta**: la tab Animales NO se toca (su `buildAnimalsListQuery` + LIMIT 200 quedan intactos, RG7.1). Todo lo nuevo son **builders/servicios/hooks paralelos** para la vista de grupo. La query de la vista de grupo pasa de "reusar `fetchAnimals({rodeoId})` (LIMIT 200)" / "`fetchGroupMembers` (200-del-campo-y-filtra)" a una **query scopeada + keyset-paginada + overlay-aware** propia.

---

## 0. Deltas posteriores del baseline (índice, ADR-028)

Puntero para el `design.md` baseline (lo folda el leader al cerrar Puerta 2):

- **`rodeo-grande`** — Vista de grupo (rodeo/lote) scopeada + paginada (scroll infinito keyset) + COUNT real + buscador/chips in-grupo + virtualización FlatList; acciones masivas desacopladas de la página; fix del bug de `fetchGroupMembers` (lote). Afecta el as-built de R1.1–R1.3 (vista de grupo), R7.1 (lote cross-rodeo) y el gating por candidatos (design baseline §3.4). Estado: spec_ready.

---

## 1. Archivos a crear / modificar

| Archivo | Acción | Qué cambia | Cubre |
|---|---|---|---|
| `app/src/services/powersync/local-reads.ts` | **modificar** | Builders nuevos (as-built): `buildGroupAnimalsPageQuery` (scopeado + filtro categoría/sexo + keyset + LIMIT pageSize), `buildAllGroupMembersQuery` (set completo sin tope, §5.3), `buildGroupCandidateCountsQuery(establishmentId, group, {weaningEnabledRodeoIds?})` (candidatos castrar/destetar sobre el grupo entero, §5.2), `buildGroupCategoryOptionsQuery` (categorías presentes en el grupo), `buildGroupRodeoIdsQuery` (rodeos representados, soporte del gating de lote §5.2). El COUNT del header **reusa los head-count builders as-built** (§3.2, sin builder single-count nuevo). `buildSearchUnion` + los 4 builders de búsqueda ganan un `groupScope?` opcional (§4). Tipos `GroupScope`/`GroupPageCursor` exportados. **`buildAnimalsListQuery` NO cambia** (RG7.1). | RG1.1–RG1.8, RG2.1, RG3.x, RG5.2, RG5.3 |
| `app/src/services/group-page.ts` | **crear** | Service de la lista paginada del grupo: `fetchGroupAnimalsPage(est, group, { filter, cursor })` → `{ items, nextCursor, reachedEnd }` (aplica espejo C6 + repro **solo a la página**). `searchGroupAnimals(est, group, q)` (scopeado, cap). `fetchGroupMemberCount(est, group)`. `fetchGroupCategoryOptions(est, group)`. Constante `GROUP_PAGE_SIZE = 60`. | RG1.1–RG1.6, RG2.1, RG3.1, RG3.2, RG3.9 |
| `app/src/services/animals.ts` | **modificar (aditivo, as-built)** | Se **exporta** `enrichLocalRows(rows: LocalListRow[]) → AnimalListItem[]` (el post-procesamiento espejo C6 + repro + `toLocalListItem` que `fetchAnimals`/`searchAnimals` ya hacían) + el tipo `LocalListRow`, para que `group-page.ts`/`management-groups.ts` lo reusen sobre su página/set scopeado. `fetchAnimals`/`searchAnimals`/`buildAnimalsListQuery` **NO se tocan** (RG7.1). | RG1.1, RG5.3 (mecanismo espejo por página) |
| `app/src/utils/group-page-cursor.ts` | **crear (as-built)** | Util PURO `deriveNextCursor(rows, pageSize) → { nextCursor, reachedEnd }` (RG1.5) — testeable sin SDK; lo usa `fetchGroupAnimalsPage`. El tipo `GroupPageCursor` vive en `local-reads.ts`. | RG1.5 |
| `app/src/services/management-groups.ts` | **modificar** | `fetchGroupMembers` reescrito a query **scopeada por `management_group_id`** (`buildAllGroupMembersQuery`), sin traer 200-del-campo-y-filtrar (fix del bug, RG5.4). `fetchAllGroupMembers` (o el mismo `fetchGroupMembers`) devuelve el set completo para las masivas. | RG5.3, RG5.4 |
| `app/src/services/group-data.ts` | **modificar** | `fetchRodeoGroupActions`/`fetchLoteGroupActions`: el **gating por candidatos** deja de recibir/usar la página cargada y pasa a resolver los conteos con una **query scopeada al grupo entero** (`buildGroupCandidateCountsQuery`, §5.2). El gating por CONFIG (`rodeo_data_config`) no cambia. | RG5.2 |
| `app/src/services/bulk-selection-data.ts` | **modificar (verificar)** | `fetchGroupSelectionProfiles` ya resuelve el grupo por `fetchAnimals({rodeoId})` / `fetchGroupMembers` → al arreglar esas dos fuentes (§3, §5.4) hereda el set completo. Verificar que el rodeo use el **set completo** (no LIMIT 200) — §5.3. | RG5.3 |
| `app/src/hooks/useGroupView.ts` | **modificar** | Pasa al **contrato paginado**: acumula páginas, expone `loadMore()`/`loadingMore`/`reachedEnd`/`totalCount`; separa el **meta+gating+count** (carga liviana up-front) de las **páginas**; refresh silencioso recarga la **ventana cargada** (no la página 1), sin blanquear (E3). | RG1.3, RG1.5, RG1.6, RG2.1, RG6.1, RG6.2 |
| `app/src/hooks/useGroupSearch.ts` | **crear** (o folder en `useGroupView`) | Coordina el estado buscador+chips: debounce del texto (patrón `animales.tsx`, 250ms), chips categoría/sexo, decide "modo lista paginada" vs "modo búsqueda" y reintersecta (RG3.4–RG3.8). | RG3.4–RG3.8 |
| `app/src/components/GroupViewScreen.tsx` | **modificar** | Reestructura `ScrollView`+`.map()` → **`FlatList`**: `ListHeaderComponent` = meta + card de acciones; **buscador+chips FIJOS arriba** (fuera de la FlatList); `renderItem` = `renderRow` de la pantalla; `onEndReached` = `loadMore`; `ListFooterComponent` = spinner de "cargando más"; `ListEmptyComponent` = empty/loading; `keyExtractor` = `profileId`. | RG4.1–RG4.7, RG3.1, RG3.3 |
| `app/src/components/GroupViewBits.tsx` | **modificar** | `GroupMetaHeader` recibe `totalCount` (real, RG2.1) en vez de `headCount = animals.length`; muestra "…" mientras carga (RG2.3) + formato es-AR (RG2.4). `GroupAnimalsList` se **absorbe en la FlatList** de `GroupViewScreen` (deja de envolver en `Card`+`.map`) o se convierte en el `renderItem`/footer. | RG2.1, RG2.3, RG2.4 |
| `app/src/components/GroupSearchBar.tsx` + chips | **crear** | Buscador fijo + `FilterChip`/`FilterChipRow` + `FilterPopover` de categoría/sexo, **reusando el patrón de `animales.tsx`** (tap nativo: onPress+a11y en la misma pieza Tamagui con `pressStyle`, sin `<Pressable>` externo — RG3.10). Se pueden extraer los de `animales.tsx` a componentes compartidos o clonar el patrón. | RG3.1, RG3.3, RG3.10 |
| `app/app/rodeo/[id].tsx` | **modificar** | El loader deja de llamar `fetchAnimals({rodeoId})` (LIMIT 200) → usa el service paginado del grupo + el buscador/chips; pasa `group={{type:'rodeo', id}}`. | RG1.1, RG4.7 |
| `app/app/lote/[id].tsx` | **modificar** | Ídem para lote (`group={{type:'lote', id}}`). Reconciliar el **modo selección de baja en tanda** con la virtualización (§6.4). | RG1.1, RG4.7, RG5.6 |
| `app/e2e/` | **crear/extender** | Specs Playwright del delta (§8). | RG (cobertura) |

> **Convención as-built**: rutas Expo Router en `app/app/`, componentes en `app/src/components/`, services en `app/src/services/`, utils puros en `app/src/utils/`, builders SQL en `local-reads.ts`. El implementer alinea nombres al patrón si difieren; no duplica lógica.

> **Reconciliación de la tabla — archivos as-built de Fases 3-4 (2026-07-18).** Sumados a la capa de datos (aditivos, en archivos de la feature): `buildGroupSexOptionsQuery` (local-reads.ts, opciones del chip de sexo RG3.9 — la Fase 1+2 solo construyó las de categoría), `fetchGroupSexOptions` + `fetchGroupWindow` (group-page.ts, sexos presentes + refresh de ventana). Nuevos de UI/hooks: `utils/group-view-model.ts` (lógica DECIDIBLE PURA del hook, testeada), `components/GroupSearchBar.tsx` (buscador+chips, clon tap-nativo de `animales.tsx`). `useGroupSearch.ts` **no se creó** (folded en `useGroupView`, §6.3). `GroupViewBits.tsx` perdió `GroupAnimalsList` (absorbido en la FlatList). `app/lote/venta.tsx` **modificado** (reconciliación del handoff de la baja en tanda, §6.4). Detalle en `progress/impl_10-rodeo-grande-fase3-4.md`.

---

## 2. Por qué paginar (no "cargar todo y virtualizar")

La virtualización sola (FlatList) acota el **render**, pero NO el **cómputo**. `fetchAnimals` (y por ende cualquier lectura de lista) corre, sobre **toda** la lista devuelta:

- `computeMirrorOverrides` (espejo C6) → batch-query de `reproductive_events` + catálogo por system + `computeDisplayOverrides` puro, **O(N)**.
- `computeReproStatuses` (badge de estado reproductivo) → otra batch-query de eventos + `deriveReproStatus`, **O(N)** sobre las hembras.

Sobre 5000 filas de una, ese compute es caro **aunque la FlatList solo pinte 15**. Paginar acota el compute + la memoria **por página** (2 batch-queries sobre 60 perfiles por `loadMore`), no sobre el grupo entero. El A07 ya demostró que ~200 filas las procesa fluido → 60 es holgado. Por eso D1 = paginar, no cargar-todo.

**Corolario (tensión E1, §5).** Las **masivas** SÍ necesitan el grupo entero (no podés castrar lo que no podés seleccionar) → ahí sí se paga el compute completo, pero **una sola vez, ante una acción explícita y destructiva**, con el loader de esa pantalla ("Cargando animales…"). El gating de la vista de grupo (offer/don't-offer) NO paga ese compute: usa un **COUNT/EXISTS SQL** (§5.2).

---

## 3. Lista paginada del grupo

### 3.1 Tamaño de página + keyset (D1)

- **`GROUP_PAGE_SIZE = 60`** (constante de módulo). Racional: el A07 procesa ~200 filas fluido → una página de 60 mantiene cada `loadMore` barato (2 batch-queries sobre 60 perfiles) y el primer paint rápido; la FlatList pinta ~10–15 filas → 60 da buffer cómodo sin sobre-cargar el compute. Ajustable en un solo lugar. *(Alternativas 40/100 consideradas: 40 dispara `onEndReached` demasiado seguido; 100 encarece el primer paint y cada page-compute. 60 es el punto medio — decisión del autor, sujeta a Puerta 1.)*

- **Keyset (seek), NO OFFSET.** El cursor es la clave de orden de la **última fila cargada**: `{ inTreatment: 0|1, createdAt: string, id: string }`. La clave de orden total es **`(in_treatment DESC, created_at DESC, id DESC)`** — se agrega `id DESC` como desempate (el baseline ordena por `in_treatment DESC, created_at DESC`, que NO es orden total → sin desempate el keyset saltea/duplica filas con el mismo `created_at`). El `id DESC` no cambia la semántica de orden del baseline (RG1.7), solo la vuelve determinística.

  **Predicado keyset "filas después del cursor"** (orden DESC → "después" = valores menores):
  ```
  (in_treatment < :it)
     OR (in_treatment = :it AND created_at < :ca)
     OR (in_treatment = :it AND created_at = :ca AND id < :id)
  ```
  La **primera página** no lleva predicado (o un sentinel que incluye todo).

  **Forma de la query** (reusa el `LOCAL_LIST_SELECT` + `injectProjection` del `in_treatment` del baseline; ambas ramas del UNION ya proyectan `in_treatment`/`created_at`/`id`):
  ```
  SELECT * FROM (
     <LOCAL_LIST_SELECT + in_treatment computado, WHERE est + status='active' + deleted_at + HIDE_EXITED + scope>
     UNION ALL
     <LOCAL_LIST_SELECT_OVERLAY + 0 AS in_treatment, WHERE est + status='active' + notHidden + scope_overlay>
  )
  WHERE <keyset predicate>            -- omitido en la 1ª página
  ORDER BY in_treatment DESC, created_at DESC, id DESC
  LIMIT :pageSize
  ```
  El keyset va en el **SELECT externo** que envuelve el UNION (referencia las columnas proyectadas; en un compound SQLite el ORDER BY/WHERE externo sí puede referenciarlas — mismo patrón que `buildTimelineQuery` as-built). El **scope** es `AND ap.rodeo_id = ?` (rodeo) o `AND ap.management_group_id = ?` (lote), y su análogo `pap.*` en el overlay.

  **`nextCursor`** = la clave `(in_treatment, created_at, id)` de la última fila devuelta; `reachedEnd` = la página devolvió `< pageSize` filas (RG1.5).

- **Por qué keyset y no OFFSET** (alternativa descartada, §9.A): con OFFSET, si el overlay optimista inserta/quita una fila **arriba** de la ventana entre página N y N+1 (alta/mudanza/baja offline — E4), las filas se corren → **duplicados o saltos**. El keyset ancla en la clave de la última fila → estable ante mutaciones del set. Además OFFSET re-escanea todas las filas previas por página (O(offset)); el keyset es O(pageSize) con el orden ya materializado.

### 3.2 COUNT real del header (D2, E5)

El total real del grupo (overlay-aware) se resuelve **reusando los head-count builders as-built** — ya existen, ya contemplan el overlay (UNION synced + `pending_*` + oculta exits/soft-deletes) y ya los usa Inicio:

- Rodeo: `fetchRodeoHeadCounts(est).get(rodeoId) ?? 0` (`buildRodeoHeadCountsQuery`).
- Lote: `fetchGroupHeadCounts(est).get(groupId) ?? 0` (`buildGroupHeadCountsQuery`).

Ventaja: cero builder nuevo, patrón probado y E5-correcto (`buildAnimalsCountQuery`/head-counts ya suman overlay y ocultan exits pendientes). Alternativa (builder single-count `buildGroupMemberCountQuery` scopeado) queda como refinamiento de perf si computar todos-los-grupos molesta (es un `GROUP BY COUNT`, barato). **Decisión: reusar los head-count builders**; `fetchGroupMemberCount(est, group)` es un wrapper delgado sobre ellos.

`GroupMetaHeader` cambia `headCount = animals.length` → `totalCount` (prop nueva). Mientras `totalCount == null` (no cargó) → "…" (RG2.3). Formato es-AR con `toLocaleString('es-AR')` (RG2.4).

---

## 4. Buscador + filtros in-grupo (D3, E2)

### 4.1 Buscador scopeado al grupo

Reusa el motor `searchAnimals` (caravana/IDV/apodo) **scopeado al grupo**. Los builders de búsqueda (`buildSearchByTagQuery`/`buildSearchByIdvQuery`/`buildSearchLikeQuery`/`buildApodoSearchQuery`) pasan por `buildSearchUnion(establishmentId, syncedExtra, overlayExtra, extraArg)`, que aplica `listDomainFilters`. Se los extiende con un **scope opcional de grupo**: `buildSearchUnion` acepta un `groupScope?` que agrega `AND ap.rodeo_id = ?` / `AND ap.management_group_id = ?` (synced) y su análogo `pap.*` (overlay) a **ambas** ramas. Nuevo service `searchGroupAnimals(est, group, q)` que espeja `searchAnimals` pero pasando el scope. Corre sobre el **set completo del grupo** (query scopeada, no la página — E2/RG3.2). Cap: mismo `LIMIT 20` del UNION as-built (la búsqueda narrow-ea fuerte → no necesita paginar; el operario busca UN animal).

### 4.2 Chips categoría + sexo (patrón `animales.tsx`)

- **Sexo**: filtro exacto sobre `ap.animal_sex` (columna denormalizada) — `AND ap.animal_sex = ?`. Ofrecido solo si hay ambos sexos en el grupo (RG3.9).
- **Categoría**: filtro sobre `c.code` (categoría **almacenada**, JOIN `categories_by_system`) — `AND c.code = ?`. Las **opciones** salen de `buildGroupCategoryOptionsQuery` (DISTINCT de categorías presentes en el grupo, scopeado + overlay-aware). Nota de fidelidad ↓.
- Chips **combinables** entre sí y con la búsqueda (RG3.4). Se aplican como `WHERE` de la query paginada (`buildGroupAnimalsPageQuery` recibe `{ categoryCode?, sex? }`) → el keyset sigue funcionando dentro del subconjunto filtrado (RG3.5). Con **texto de búsqueda** presente, el resultado de `searchGroupAnimals` (≤20) se intersecta **client-side** con los chips activos (barato, pocas filas — RG3.6).
- Al cambiar un chip/texto → cursor nuevo, lista desde el tope (RG3.7). Al limpiar → lista paginada completa (RG3.8).
- **Tap nativo (RG3.10, CRÍTICO)**: los chips/popovers/buscador usan `onPress` + `buttonA11y`/`labelA11y` en la **misma pieza Tamagui** con `pressStyle`, sin `<Pressable>` de RN envolviendo (patrón exacto de `FilterChip`/`FilterPopover` de `animales.tsx` y `GoogleSignInButton`). En nativo new-arch un `<Pressable>` externo roba el responder → `onPress` no dispara (anda solo en web). Reusar/extraer esos componentes es lo más seguro.

> **Nota de fidelidad — categoría almacenada vs espejo C6** (decisión de diseño, §9.C). El filtro y las opciones de categoría usan la categoría **almacenada** (`c.code`), no la del espejo C6 (que es JS-only, O(N), y se recalcula por página). Para un grupo **sincronizado** la almacenada == la del espejo (los triggers server-side ya corrieron). Difieren solo para animales con un evento/transición **pendiente offline** aún no aplicado server-side (el espejo lo adelanta; la almacenada va un paso atrás). Consecuencia: un animal en transición offline podría filtrarse por su categoría vieja hasta sincronizar. Es **raro, transitorio y auto-sana** al sync; replicar `compute_category` en SQL es exactamente lo que el espejo C6 evitó (por eso vive en JS). Aceptado y documentado. La **fila** que se muestra sí lleva la categoría del espejo (la query proyecta los inputs y el service aplica el mirror a la página) → el usuario ve la categoría correcta aunque el filtro use la almacenada.

---

## 5. Acciones masivas sobre el grupo entero (E1)

### 5.1 El conjunto de la masiva = grupo entero, no la página

Las pantallas de masiva ya **re-resuelven** el grupo por su cuenta (no reciben la página): `seleccion-masiva.tsx` y `vacunacion-masiva.tsx` llaman `fetchGroupSelectionProfiles(est, {groupType, groupId})`, que para rodeo usa `fetchAnimals({rodeoId})` y para lote `fetchGroupMembers`. Hoy esas dos fuentes están **capadas** (rodeo: LIMIT 200; lote: bug de 200-del-campo). El delta las corrige (§5.3, §5.4) → las masivas heredan el **set completo** sin cambiar su lógica de candidatos/selección (Fase 2 as-built intacta). RG5.5: el modelo N-mutaciones no cambia.

### 5.2 Gating por candidatos = COUNT/EXISTS del grupo entero

Hoy `fetchRodeoGroupActions(rodeoId, animals)`/`fetchLoteGroupActions(animals)` reciben la **lista mostrada** (`animalsR.value`) y cuentan candidatos con `buildBulkCandidates` sobre ella. Con paginación, `animals` sería solo la **primera página** → el gating (ofrecer Destetar/Castrar) sería incorrecto (E1).

> **Reconciliación as-built (Fases 1-2, 2026-07-18).** La firma quedó `buildGroupCandidateCountsQuery(establishmentId, group, { weaningEnabledRodeoIds? })` — se **agregó `establishmentId`** (el boceto lo omitía) por la regla dura multi-tenant (RG6.5): toda query nueva conserva `establishment_id = ?` del param (defensa en profundidad además del scope de grupo). Además, para el lote cross-rodeo, `group-data.ts` resuelve los rodeos representados con un builder nuevo **`buildGroupRodeoIdsQuery(establishmentId, group)`** (DISTINCT `rodeo_id` scopeado + overlay-aware) en vez de derivarlos de la lista cargada (que con paginación sería parcial) — query barata que NO paga el compute del espejo (§2 corolario). Las firmas de gating quedaron `fetchRodeoGroupActions(establishmentId, rodeoId)` / `fetchLoteGroupActions(establishmentId, groupId)` (ya no reciben `animals`). Los 2 call sites de Fase 4 (`rodeo/[id].tsx`, `lote/[id].tsx`) recibieron un ajuste MÍNIMO de esa llamada para no romper tsc (el count del grupo entero requiere `establishmentId`) — la migración completa del loader a la lista paginada + FlatList sigue siendo Fase 4.

Fix: el gating resuelve los conteos con una **query SQL scopeada al grupo entero**, `buildGroupCandidateCountsQuery(establishmentId, group, { weaningEnabledRodeoIds? })`, overlay-aware (UNION synced + `pending_*`), que devuelve `{ castrate: int, wean: int }`:

- **Castrar** (exacto): `COUNT` de perfiles del grupo con `animal_sex='male' AND is_castrated = 0` (ambas columnas almacenadas → SQL puro, cero espejo).
- **Destetar** (aproximado, ver nota): `COUNT` de perfiles del grupo con `c.code IN ('ternero','ternera') AND NOT EXISTS(weaning vivo)` (reusa el `EXISTS weaning` de `buildGroupCandidateFlagsQuery`). En **lote cross-rodeo** (R7.2), restringido a los `rodeo_id` con `destete` habilitado (el set `weaningEnabledRodeoIds` lo resuelve `group-data.ts` de la config, como hoy).

`fetchRodeoGroupActions`/`fetchLoteGroupActions` dejan de recibir la lista y llaman este builder. El gating por **CONFIG** (`rodeo_data_config` → `resolveGroupActions`) no cambia. `applyCandidateGating(config, counts)` (puro, as-built) se conserva.

> **Nota — misma aproximación stored-category que §4.2** para el conteo de destete. Dirección de seguridad: un `ternero`/`ternera` que el espejo **subiría** a otra categoría por edad (sin destete) haría que el gating **sobre-ofrezca** Destetar → la pantalla de selección (que sí computa con el set completo) muestra pocos/cero candidatos. Costo: abrir una lista casi vacía en un caso borde offline. **Nunca** produce una mutación incorrecta (el candidato real lo decide la Fase 2 sobre el set completo). El caso de **sub-oferta** (perder un candidato real) es prácticamente imposible: el espejo solo **sube** de categoría con edad/destete, nunca **baja** a `ternero`/`ternera` algo que ya no lo es. Castrar es exacto (sin categoría). Aceptado.

### 5.3 Set completo para la selección

`buildAllGroupMembersQuery(est, group)` = misma query scopeada del §3.1 **sin keyset ni LIMIT** (o LIMIT alto de guarda) → el set completo del grupo. `fetchAllGroupMembers` lo envuelve, aplica espejo+repro (una sola pasada sobre el set completo — el costo del §2 corolario, pagado una vez ante la acción explícita). Para **rodeo**, `fetchGroupSelectionProfiles` deja de usar `fetchAnimals({rodeoId})` (LIMIT 200) y usa `fetchAllGroupMembers`; para **lote**, hereda el `fetchGroupMembers` corregido (§5.4).

### 5.4 Fix del bug del lote (RG5.4)

`fetchGroupMembers(est, groupId)` hoy hace `fetchAnimals(est, {status:'active'})` (200 del campo) `.filter(a => a.managementGroupId === groupId)` → en un campo grande devuelve un **subconjunto incompleto y arbitrario** del lote (ni siquiera "los primeros 200 del lote"). Se reescribe a `buildAllGroupMembersQuery(est, {type:'lote', id:groupId})` (scope `management_group_id = ?`, sin tope, overlay-aware) → **todos** los miembros activos del lote. Esto corrige de paso la vista de lote (RG5.4) y la selección masiva sobre lote (§5.1).

---

## 6. Virtualización + reestructura de `GroupViewScreen` (D4)

### 6.1 De `ScrollView`+`.map()` a `FlatList`

Hoy `GroupViewScreen` mete todo en un `<ScrollView>` con `GroupMetaHeader` + card de acciones + `GroupAnimalsList` (que hace `<Card>{animals.map(renderRow)}</Card>`). Se reestructura:

```
<YStack flex={1}>                              ← contenedor
  <Header back />                              ← fijo (as-built)
  <GroupSearchBar + FilterChips />             ← FIJO arriba, FUERA de la FlatList (RG4.4)
  <FlatList
     data={animals}                            ← páginas acumuladas
     keyExtractor={a => a.profileId}           ← keys estables (RG4.5)
     ListHeaderComponent={<GroupMetaHeader totalCount/> + <Card acciones/>}   ← scrollea (RG4.3)
     renderItem={({item}) => renderRow(item)}  ← AnimalRow compacto de la pantalla
     onEndReached={loadMore} onEndReachedThreshold={0.5}   ← scroll infinito (RG1.3)
     ListFooterComponent={loadingMore ? <Spinner/> : null}  ← "cargando más" (RG4.6)
     ListEmptyComponent={loading ? <InfoNote/> : <emptyCopy/>}
  />
</YStack>
```

- **`FlatList`, no `FlashList`** (RG4.2): FlashList mide items y en RN-web (donde corre e2e) es menos predecible; FlatList es el camino probado. (Alternativa §9.B.)
- El **buscador+chips FIJOS** arriba (RG4.4): siempre alcanzables sin scrollear miles de filas. El **meta+acciones** van en `ListHeaderComponent` (scrollean).
- Las filas conservan su `AnimalRow` compacto con divider propio (as-built). El chrome de "card redondeada" alrededor de la lista es un detalle presentacional que el implementer resuelve (design-review); no es load-bearing.
- `GroupAnimalsList` (GroupViewBits) se **absorbe** en la FlatList (deja de existir como `Card`+`.map`) o se degrada a helper del `renderItem`/footer.

### 6.2 Hook `useGroupView` paginado (E3)

Se reescribe al contrato paginado, conservando el patrón `silent`:

- Estado: `animals` (páginas acumuladas), `actions` (gating), `totalCount`, `loading` (inicial), `loadingMore`, `reachedEnd`, `error`, `cursor` (interno).
- **Carga inicial** (mount / cambio de grupo): resuelve **meta liviana** (gating vía §5.2 + count vía §3.2, ambos COUNT/EXISTS baratos) **+ primera página** (§3.1). Puede blanquear (no hay nada que preservar).
- **`loadMore()`** (RG1.3/RG1.5/RG1.6): si `!loadingMore && !reachedEnd`, fetch de la próxima página por `cursor`, `setAnimals(prev => [...prev, ...page])`, actualiza `cursor`/`reachedEnd`. Guard de un-solo-loadMore-en-vuelo.
- **Refresh silencioso** (foco / `lastSyncedAt` avanza — E3/RG6.1): recarga la **ventana cargada** = re-fetch de `loadedCount` filas desde el tope (keyset desde el inicio, `LIMIT loadedCount`) → reemplaza `animals` en el lugar. Keys estables (`profileId`) → la FlatList preserva el scroll de las filas que sobreviven. **No** resetea `cursor` a la página 1 ni toca `loading` (no blanquea). También refresca `totalCount` + `actions`. Un fallo transitorio conserva la lista (RG6.2, patrón as-built).
- La ventana recargada es **acotada** (`loadedCount`, no el grupo entero) → el refresh silencioso es barato aunque el grupo sea enorme, y refleja altas/mudanzas del overlay que caen en el tope (E4/RG6.3, `created_at DESC`).

> **Reconciliación as-built (Fases 3-4, 2026-07-18).** (1) Firma: `useGroupView({ establishmentId, group })` — el hook llama los services directamente (ya NO recibe un `loader` de la pantalla); las acciones se resuelven por `group.type` (rodeo→`fetchRodeoGroupActions`, lote→`fetchLoteGroupActions`). El `group` se memoiza por sus primitivas (`type`/`id`) → los callbacks/efectos no se re-disparan por identidad. (2) El refresh de la ventana usa un service nuevo **`fetchGroupWindow(est, group, { filter, limit })`** (group-page.ts) = `buildGroupAnimalsPageQuery` con `pageSize = loadedCount` y cursor null (`fetchGroupAnimalsPage` fija `GROUP_PAGE_SIZE`, no sirve para una ventana variable). `reachedEnd` previo se **preserva** si la ventana vuelve llena (menos filas ⇒ el grupo se achicó ⇒ fin). (3) Guards con **refs** (`loadingRef`/`loadingMoreRef`/`reachedEndRef`/`cursorRef` + `listSeq`/`searchSeq`) para leer valores frescos sin closures viejas; `loadingRef` bloquea `loadMore` durante CUALQUIER recarga de 1ª página/ventana. La lógica decidible (`canLoadMore`, `dedupById`, `shouldYieldWindowRefresh`) vive en `utils/group-view-model.ts` (PURA, testeada — los hooks importan el SDK y no corren en node:test). (4) **`refreshWindow` CEDE ante el foreground** (fix del race de ensanchar-filtro, 2026-07-18): hace bail al inicio —ANTES de bumpear `listSeq` o leer `loadedCount`/`reachedEndRef`— si hay una carga de 1ª página/refresh (`loadingRef`) o un `loadMore` (`loadingMoreRef`) en vuelo, vía `shouldYieldWindowRefresh`. Así un refresh silencioso de FONDO nunca clobber-ea una 1ª página fresca disparada por cambio de filtro ni trunca la lista con un `limit`/`reachedEnd`/filtro STALE del criterio anterior. Detalle completo del race + por qué (a) sobre las alternativas: §8 (RESUELTO) + `progress/impl_10-rodeo-grande-race-fix.md`.

### 6.3 Estado buscador/chips (`useGroupSearch` o folded)

- Texto con **debounce 250ms** (patrón `animales.tsx`). `isSearching = debounced.trim().length > 0`.
- Chips `categoryCode`/`sex` en estado.
- **Modo lista** (sin texto): `buildGroupAnimalsPageQuery` con `{categoryCode, sex}` → paginado (RG3.5). Cambiar un chip → cursor nuevo, lista desde el tope (RG3.7).
- **Modo búsqueda** (con texto): `searchGroupAnimals(est, group, q)` (scopeado, ≤20) → intersección client-side con chips activos (RG3.6). Sin paginación (pocas filas).
- Limpiar todo → modo lista completa (RG3.8).
- Guard de secuencia (como `animales.tsx` `listSeq`/`searchSeq`) para descartar respuestas viejas ante cambios rápidos.

> **Reconciliación as-built (Fases 3-4, 2026-07-18).** El estado buscador/chips quedó **FOLDED en `useGroupView`** (opción "folded" del §6.3, no un hook separado). **Chip de SEXO (RG3.9):** la capa de datos de Fases 1+2 construyó opciones de CATEGORÍA (`buildGroupCategoryOptionsQuery`) pero NO de sexo → se agregó una query PROPIA scopeada **`buildGroupSexOptionsQuery`** (local-reads.ts) + `fetchGroupSexOptions` (group-page.ts) que devuelve los `animal_sex` DISTINTOS del grupo; el hook decide ofrecer el chip con `sexFilterAvailable(sexesPresent)` (ambos presentes). Se prefirió una query propia a DERIVAR sexo de la categoría porque categorías sex-neutras (`cut`) romperían esa derivación. La intersección chips↔búsqueda es `intersectSearchWithChips` (PURO); en modo búsqueda un cambio de chip NO re-fetchea (solo re-aplica el filtro client-side sobre los ≤20 resultados). El `GroupSearchBar` **clona** `FilterChip`/`FilterPopover`/buscador de `animales.tsx` (DG6: clonar en vez de extraer) para NO tocar la tab Animales (RG7.1).

### 6.4 Reconciliación con la baja en tanda del lote (delta lotes-venta, RG5.6)

`lote/[id].tsx` tiene DOS layouts: el normal (vía `GroupViewScreen`) y un **modo selección de baja en tanda** propio (checkbox por fila + "todos" + CTA "Registrar salida (N)") que HOY hace `view.animals.map(...)`. Con `view.animals` ahora **paginado** (solo la página cargada), ese modo:

1. Su **lista** de selección debe virtualizar igual (FlatList) para no colgar en un lote grande.
2. "Seleccionar todos" (`toggleSelectAll(memberIds)`) debe operar sobre el **conjunto completo del lote** (`memberIds` = todos los miembros), no la página → resolver el set completo (`fetchAllGroupMembers`, §5.3) al entrar en modo selección, no `view.animals`.

**Decisión**: el modo selección de baja en tanda carga el **set completo** del lote (`fetchAllGroupMembers`) al activarse y lo virtualiza (FlatList). Es el mismo principio de E1 (masiva = grupo entero) aplicado a la baja en tanda. Reconciliar la nota as-built del delta lotes-venta (RLV.3) — lo coordina el leader (§9 tabla). *(Flag: si el implementer encuentra que la baja en tanda ya resolvía el set completo por otro camino, ajustar; la lectura del as-built dice que usa `view.animals` = página.)*

> **Reconciliación as-built (Fases 3-4, 2026-07-18) — modo selección + EDGE del nav-param.** Confirmado: la baja en tanda usaba `view.animals` (ahora = una página). Fix: `lote/[id].tsx` carga `fetchAllGroupMembers({type:'lote', id})` al ENTRAR en modo selección (estado `members`, `null` = cargando) y lo virtualiza con **FlatList**; `toggleSelectAll`/`resolveSelectedIds` operan sobre TODOS los `memberIds`.
>
> **EDGE del nav-param gigante (detectado + resuelto).** El as-built del delta lotes-venta pasaba `profileIds: ids.join(',')` como **param de URL** → "seleccionar todos" en un lote de miles = un string de ~180KB que puede reventar/degradar el router. Fix (sin store global): `goToVenta` pasa `groupId` + **`mode`** ('all'|'subset') + **`ids`** = el csv **más chico** entre seleccionados y excluidos (selección MAYORÍA → `mode='all'` + los EXCLUIDOS; minoría → `mode='subset'` + los seleccionados). Para "todos" (miles) el csv va **vacío** (`mode='all'`, sin excluidos). `venta.tsx` (reconciliado, RLV.3) resuelve el set del lado DESTINO contra `fetchGroupMembers` (RLS-scopeado): `mode='all'` → todos los miembros MENOS los excluidos; `mode='subset'` → solo los `ids` presentes. El invariante **anti-IDOR (RLV.21.1)** queda intacto (la lista operable SIEMPRE sale de `fetchGroupMembers`; operar sobre el complemento nunca alcanza a un no-miembro). El cambio a `venta.tsx` fue acotado (lectura de params + guarda + filtro) → dentro de lo razonable, no requirió parar/reportar.

---

## 7. Multi-tenant, offline y por qué NO hay delta de backend / Gate 1 NO aplica

**Offline-first (RG6.4).** Toda lectura nueva (`buildGroupAnimalsPageQuery`, count, `searchGroupAnimals`, candidatos, categorías, set completo) corre sobre el **SQLite local** (`runLocalQuery`), igual que `fetchAnimals`/`searchAnimals` as-built. Cero red. El overlay (`pending_*`) va en el UNION de todas ellas (E4/RG6.3).

**Multi-tenant / RLS (RG6.5).** El scoping por tenant **ya** lo imponen la RLS server-side (`has_role_in(establishment_id)`) y las **sync streams** JOIN-free (`est_animal_profiles` solo baja los perfiles de campos del usuario — spec 15/ADR-026). El delta **no agrega** ninguna policy, ni relaja el filtro: todas las queries nuevas conservan `ap.establishment_id = ?` (del contexto activo, **nunca** hardcodeado — ppio 6) + los filtros de dominio (`status`/`deleted_at`/`HIDE_EXITED`). El scope de grupo (`rodeo_id`/`management_group_id`) es un filtro de **dominio** adicional sobre un set que la RLS ya recortó. No hay camino cross-tenant nuevo.

**Sin delta de backend.** Cero columnas, cero migraciones, cero triggers, cero RLS, cero Edge Functions, cero RPCs. `rodeo_id`, `management_group_id`, `animal_sex`, `is_castrated`, `category_code` ya existen y ya se sincronizan. El delta es lecturas + UI.

**Gate 1 (security spec): NO aplica.** No toca RLS, schema sensible, Edge Functions, auth/tokens, secrets ni datos regulados (SENASA/PII). El único eje "sensible" es multi-tenancy, y el delta **no abre superficie** (reusa el scoping as-built). El leader confirma; si igual lo lanza, el foco es trivial (verificar que las queries nuevas conservan `establishment_id` y no exponen `pending_*`/otros tenants — todas lo hacen por construcción).

---

## 8. Testabilidad — E2E (Playwright, corre en web)

Specs nuevos/extendidos en `app/e2e/` (contra el export de prod + Supabase remoto + PowerSync; datos namespaced con RUN_TAG; cleanup en afterAll). Casos (context §Testabilidad):

1. **Rodeo > una página → scroll infinito carga más** (RG1.2/RG1.3/RG1.5). Seed de `> GROUP_PAGE_SIZE` animales activos en un rodeo (batch-insert directo por Supabase, como el `seedAnimal` as-built). Aserción: la lista inicial trae ~`GROUP_PAGE_SIZE`; al scrollear al fondo (`onEndReached`) aparecen filas más allá de la primera página (un animal seedeado que NO estaba en la primera página se vuelve visible). *(Nota de perf del seed: batch-insert de ~61 filas es tolerable; si resultara lento, el implementer puede exponer `GROUP_PAGE_SIZE` como constante reducible en test — flag, decisión del implementer/leader.)*
2. **Buscar dentro del grupo** (RG3.1/RG3.2): tipear la caravana de un animal del grupo que está **más allá de la primera página** → aparece (prueba que la búsqueda corre sobre el set completo, no la página).
3. **Filtrar por categoría / sexo** (RG3.3/RG3.5): activar un chip → la lista muestra solo el subconjunto; combinable con otro chip.
4. **Count real en el header** (RG2.1/RG2.2): el header muestra el total del grupo (> filas cargadas en la primera página).
5. **Lote muestra TODOS sus miembros — regresión del bug** (RG5.4): seed de un lote con miembros que en un campo con >200 animales quedarían fuera del viejo "200-del-campo" → el lote los muestra a todos (o al menos su count real coincide con los miembros seedeados).
6. **Acción masiva opera sobre el grupo entero, no la página** (RG5.1/RG5.2): con un grupo de > una página, la vista ofrece la acción (gating por COUNT del grupo) y la selección masiva lista candidatos de más allá de la primera página.

Además: los **utils/builders puros** nuevos (keyset predicate, scope, candidate counts) se testean contra **SQLite in-memory** (patrón `local-reads.test.ts` as-built): keyset devuelve la página correcta sin saltos/duplicados; el scope filtra por grupo; overlay incluido; count coincide con el set.

> **Reconciliación as-built (Fase 5, 2026-07-18) — `app/e2e/rodeo-grande.spec.ts` (6 tests, 6/6 verde).** Patrón de la suite as-built: `test`/`expect` de `./helpers/fixtures` (boot de PowerSync), seed namespaced con RUN_TAG, `afterAll(cleanupAll)`, `signIn`/`waitForHome`, contra el export de prod (:8099) + Supabase remoto + PowerSync.
> - **Seed batch LOCAL** (`batchSeedAnimals` en el spec, usa el `admin` service_role exportado — NO se modifica `e2e/helpers/admin.ts`): 1 fetch del rodeo + 1 de categorías + inserts chunked de `animals` (todas PRIMERO — el trigger 0079 denormaliza sex/tag/birth al insertar el perfil por `animal_id`) y `animal_profiles` con **`created_at` EXPLÍCITO** por perfil. Necesario porque el keyset ordena por `(in_treatment DESC, created_at DESC, id DESC)` y un batch comparte `now()` (mismo timestamp de transacción) → sin `created_at` explícito el orden caería en `id DESC` (UUID random) = no-determinístico. Con `created_at` monótono se controla qué animales caen en la 1ª página. `idv` único por establishment (índice `(establishment_id, idv)`, 0020) → prefijo por-test + índice.
> - **Seed REAL (DG8), sin reducir `GROUP_PAGE_SIZE`**: 65 (paginación/count), 210 (regresión del lote — el `LIMIT 200` de `buildAnimalsListQuery` de la tab NO es reducible, RG7.1, así que el campo debe ser > 200 de verdad para reproducir el bug), 66 (masiva). No se tocó producción.
> - **CERO testID nuevo**: todos los oráculos usan selectores ya existentes (buscador por `getByLabel('Buscar animal en el grupo por caravana o número')`, chips por `Filtrar por categoría`/`Filtrar por sexo`, filas por el idv en el nombre accesible `role=button`, count por el texto `N animales activos`, `Castrar`, checkbox de la selección por idv `role=checkbox`).
> - **Scroll infinito (T-RG.28)**: se scrollea el contenedor scrolleable más alto (la FlatList) a `scrollHeight` + `dispatchEvent('scroll')` en loop (patrón `maniobra-custom-bugfix`) → dispara `onEndReached` → `loadMore`; el más viejo (fuera de la 1ª página) pasa de `toHaveCount(0)` a visible.
>
> **~~FINDING~~ RESUELTO (2026-07-18) — race en `useGroupView.refreshWindow` al ENSANCHAR un filtro.** *(Registro del bug, para trazabilidad.)* Al **ENSANCHAR** un filtro (subconjunto chico → set más grande), `loadFirstPage` re-fetchea la 1ª página fresca (`GROUP_PAGE_SIZE`), pero un **refresh silencioso concurrente** (`refreshWindow`, disparado por foco o avance de `lastSyncedAt` — su identidad cambia con `categoryCode`/`sex`, así que los efectos de foco+sync lo re-disparan en el MISMO commit que el cambio de chip) usaba `limit = loadedCount` (STALE = el tamaño angosto anterior) y `++listSeq` (bumpeado ÚLTIMO → gana el guard de secuencia compartido) → **clobber-eaba** la página fresca dejando la lista "pegada" en el tamaño angosto. **Determinístico** (no flaky): el último `refreshWindow` en bumpear seq siempre ganaba. Reproducido por el E2E (T-RG.30, tramo de ensanchar) — CAE con el bug, verde con el fix.
>
> **Fix as-built — approach (a):** `refreshWindow` **CEDE** (bail al inicio, ANTES de bumpear `listSeq` o leer `loadedCount`/`reachedEndRef`/filtro) si hay una carga de **foreground** en vuelo — una 1ª página por cambio de filtro/criterio o un refresh previo (`loadingRef`), o un `loadMore` (`loadingMoreRef`). El guard decidible se extrajo a `utils/group-view-model.ts` (`shouldYieldWindowRefresh({ listLoadInFlight, loadingMore })`, PURO + unit test). Al ceder, el foreground —que lee del MISMO SQLite local ya sincronizado— aplica el resultado correcto para el criterio actual; la dirección inversa (un `loadFirstPage` que arranca DURANTE un refresh) ya la cubre `listSeq` (el refresh se descarta al terminar). Se prefirió (a) sobre `max(loadedCount, GROUP_PAGE_SIZE)` (arreglaría `loadedCount` pero deja `prevReachedEnd` STALE → marcaría una lista ancha como `reachedEnd` y bloquearía `loadMore`) y sobre un `criterionVersion` (no cubre la traza: cuando el refresh arranca DESPUÉS del cambio de filtro el criterio YA es el nuevo → capturarlo no distingue; el problema es la DATA stale, no el criterio). Ver `progress/impl_10-rodeo-grande-race-fix.md`. **El E2E T-RG.30 ya NO es narrow-only**: agrega un tramo de ENSANCHAR (angosto → ancho, limpiar chips) que asere la RE-población de la lista — la regresión del race.

---

## 9. Alternativas descartadas

**A. OFFSET/LIMIT en vez de keyset — DESCARTADA.** Inestable ante el overlay optimista (E4) y las altas/bajas concurrentes: una inserción arriba de la ventana entre páginas corre las filas → duplicados/saltos. Además O(offset) por página. El keyset ancla en la clave de la última fila → estable + O(pageSize). (§3.1.)

**B. FlashList en vez de FlatList — DESCARTADA.** Más rápida en device, pero menos predecible en RN-web (mide items, recicla distinto) — y la suite e2e corre en web. El context lo fija: FlatList. Reevaluable si aparece un problema de perf real en device con FlatList (backlog).

**C. Filtro/gating de categoría con el espejo C6 (categoría vigente) en vez de la almacenada — DESCARTADA.** El espejo es JS-only y O(N); usarlo para filtrar/gatear el grupo entero reintroduce exactamente el compute que D1 evita. Se usa la categoría **almacenada** en SQL (exacta para grupos sincronizados; drift solo offline-pendiente, auto-sana). La **fila** mostrada sí lleva la categoría del espejo (se aplica a la página). (§4.2, §5.2.)

**D. Cargar todo el grupo y solo virtualizar (sin paginar) — DESCARTADA.** Virtualiza el render pero no el compute O(N) del espejo+repro sobre miles de filas (§2). Paginar acota compute + memoria por página. (El único lugar donde se carga todo es la selección masiva, ante una acción explícita — §5.3.)

**E. Un builder single-COUNT scopeado nuevo para el header en vez de reusar los head-count builders — DESCARTADA (por ahora).** Los head-count builders ya existen, ya son overlay-aware y ya se usan en Inicio → reusarlos es menos superficie. El single-count queda como refinamiento de perf si computar todos-los-grupos molestara (no debería: `GROUP BY COUNT` barato). (§3.2.)

---

## 10. Decisiones abiertas / coordinación

| # | Tema | Estado / default | Quién confirma |
|---|---|---|---|
| DG1 | `GROUP_PAGE_SIZE = 60` | Default del autor (§3.1); ajustable en un lugar | Puerta 1 (Raf) |
| DG2 | Keyset vs OFFSET | **Keyset** (§3.1/§9.A) — decisión de diseño firme | cerrado (autor) |
| DG3 | COUNT vía head-count builders reusados vs single-count nuevo | **Reuso** (§3.2/§9.E); single-count = refinamiento | implementer/leader |
| DG4 | Aproximación stored-category en filtro/gating de destete | **Aceptada** (§4.2/§5.2, dirección de seguridad documentada) | Puerta 1 (Raf) |
| DG5 | Reconciliación de la baja en tanda del lote (delta lotes-venta) con la virtualización + set completo | §6.4 — nota as-built del delta lotes-venta la coordina el leader | leader |
| DG6 | Extraer `FilterChip`/`FilterPopover`/buscador de `animales.tsx` a componentes compartidos vs clonar el patrón | Cualquiera (RG3.10 lo que importa es el tap nativo); default = extraer si es limpio | implementer |
| DG7 | Gate 1 | **NO aplica** (§7) — confirmación final | leader |
| DG8 | Seed e2e > page size vs `GROUP_PAGE_SIZE` reducible en test | §8 caso 1 — default seed real; reducible como fallback | implementer/leader |

---

## 11. Trazabilidad design → requirements

- §3.1 (keyset + pageSize) → RG1.1, RG1.2, RG1.3, RG1.4, RG1.5, RG1.6, RG1.7, RG1.8
- §3.2 (count) → RG2.1, RG2.2, RG2.3, RG2.4
- §4.1 (búsqueda scopeada) → RG3.1, RG3.2
- §4.2 (chips categoría/sexo) → RG3.3, RG3.4, RG3.5, RG3.6, RG3.7, RG3.8, RG3.9, RG3.10
- §5.1–5.3 (masivas grupo entero + gating) → RG5.1, RG5.2, RG5.3, RG5.5
- §5.4 (bug del lote) → RG5.4
- §6.1 (FlatList) → RG4.1, RG4.2, RG4.3, RG4.4, RG4.5, RG4.6, RG4.7
- §6.2 (hook paginado + refresh silencioso) → RG1.3, RG1.5, RG1.6, RG6.1, RG6.2
- §6.3 (buscador/chips estado) → RG3.4–RG3.8
- §6.4 (baja en tanda del lote) → RG5.6
- §7 (offline/multi-tenant/sin backend) → RG6.3, RG6.4, RG6.5, RG7.1
- §8 (E2E) → cobertura RG
- §9/§10 (alternativas/abiertas) → RG1.4, RG7.4

---

## Changelog

- **2026-07-18** — Diseño inicial del delta desde `context-rodeo-grande.md` (Gate 0 aprobado). Grueso cliente: keyset-pagination scopeada (§3.1), COUNT real reusando head-count builders (§3.2), buscador+chips scopeados (§4), masivas sobre el grupo entero + gating por COUNT/EXISTS + fix del bug del lote (§5), reestructura a FlatList (§6), sin delta de backend / Gate 1 no aplica (§7). Alternativas OFFSET/FlashList/espejo-en-filtro/cargar-todo descartadas (§9).
