// Lógica PURA del "view model" de la vista de grupo paginada (spec 10 delta rodeo-grande, Fases 3-4):
// decisiones de PAGINACIÓN (¿se puede loadMore? dedup de keys estables) + BÚSQUEDA/CHIPS (¿hay búsqueda
// activa? intersección client-side de resultados con chips, disponibilidad del chip de sexo). SIN I/O, SIN
// React/RN/expo/SDK → testeable con node:test (mismo patrón que group-page-cursor.ts / batch-exit-selection.ts).
//
// El hook `useGroupView` (que importa services → arrastra el SDK, no corre en node:test) solo ORQUESTA:
// toda la lógica DECIDIBLE del hook vive acá y se testea a fondo.

import type { AnimalSex } from './animal-category';

/** Filtros de chips de la vista de grupo (RG3.5): categoría ALMACENADA + sexo. `null` = sin filtro. */
export type GroupFilter = { categoryCode: string | null; sex: AnimalSex | null };

/** Filtro vacío (sin chips activos). */
export const EMPTY_GROUP_FILTER: GroupFilter = { categoryCode: null, sex: null };

/** ¿Hay búsqueda de TEXTO activa? (RG3.6/RG3.8): el texto debounced es no vacío tras `trim`. */
export function isSearchActive(debouncedQuery: string): boolean {
  return debouncedQuery.trim().length > 0;
}

/** ¿Hay algún chip (categoría/sexo) activo? */
export function hasActiveChips(filter: GroupFilter): boolean {
  return filter.categoryCode !== null || filter.sex !== null;
}

/**
 * ¿Se puede disparar `loadMore`? (RG1.5/RG1.6): NO durante la carga inicial (blanquea), NO si ya hay una
 * página en vuelo (un solo `loadMore` a la vez), NO si la lista ya llegó al final, NO en modo búsqueda (la
 * búsqueda no pagina — ≤20 filas). Guard PURO que el hook consulta antes de fetchear la próxima página.
 */
export function canLoadMore(s: {
  loading: boolean;
  loadingMore: boolean;
  reachedEnd: boolean;
  isSearching: boolean;
}): boolean {
  return !s.loading && !s.loadingMore && !s.reachedEnd && !s.isSearching;
}

/**
 * Deduplica una lista por `profileId` PRESERVANDO el orden (primera aparición gana). Se usa para anexar una
 * página nueva (`dedupById([...prev, ...page])`) y para la ventana recargada del refresh silencioso: el
 * keyset no debería producir duplicados, pero un refresh silencioso concurrente + un `loadMore` podrían
 * solaparse → keys duplicadas romperían la FlatList (RG4.5 exige keys estables). PURO.
 */
export function dedupById<T extends { profileId: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of rows) {
    if (seen.has(a.profileId)) continue;
    seen.add(a.profileId);
    out.push(a);
  }
  return out;
}

/**
 * Intersección CLIENT-SIDE de los resultados de búsqueda (≤20, enriquecidos) con los chips activos (RG3.6):
 * `searchGroupAnimals` ya scopea al grupo; los chips de categoría/sexo se aplican acá (barato, pocas filas).
 * La categoría comparada es la MOSTRADA (espejo C6) de la fila — consistente con lo que ve el usuario; el
 * drift stored↔espejo (solo offline-pendiente) está documentado en design §4.2. PURO.
 */
export function intersectSearchWithChips<T extends { categoryCode: string; sex: AnimalSex }>(
  items: readonly T[],
  filter: GroupFilter,
): T[] {
  return items.filter((a) => {
    if (filter.categoryCode !== null && a.categoryCode !== filter.categoryCode) return false;
    if (filter.sex !== null && a.sex !== filter.sex) return false;
    return true;
  });
}

/**
 * ¿Se ofrece el chip de SEXO? (RG3.9): solo si el grupo tiene AMBOS sexos. `sexesPresent` = los sexos
 * distintos presentes en el grupo (query scopeada `fetchGroupSexOptions`, independiente de la categoría —
 * robusto ante categorías sex-neutras como `cut`). PURO.
 */
export function sexFilterAvailable(sexesPresent: readonly AnimalSex[]): boolean {
  return sexesPresent.includes('male') && sexesPresent.includes('female');
}

/**
 * ¿Un refresh SILENCIOSO de la ventana (foco / avance de sync) debe CEDER y NO correr? (FIX del race de
 * ENSANCHAR-filtro). Un refresh de FONDO nunca debe competir con una carga de FOREGROUND en vuelo:
 *   - `listLoadInFlight` (`loadingRef`): una 1ª página disparada por cambio de filtro/criterio (o un refresh
 *     previo) está corriendo.
 *   - `loadingMore` (`loadingMoreRef`): un `loadMore` está corriendo.
 *
 * Si compitiera, el refresh de fondo podría:
 *   (a) INVALIDAR la carga fresca vía el guard de secuencia COMPARTIDO (`listSeq`) — bumpea seq último → gana,
 *   (b) recomputar la ventana desde estado STALE del criterio ANTERIOR (angosto): `loadedCount` → `limit`
 *       chico → TRUNCA la lista al tamaño viejo pese al filtro nuevo (más ancho); y `reachedEnd`/filtro stale.
 * Al ceder (bail ANTES de bumpear `listSeq`/leer `loadedCount`), el foreground —que lee del MISMO SQLite local
 * ya sincronizado— aplica el resultado correcto para el criterio ACTUAL. La dirección inversa (un `loadFirstPage`
 * que arranca DURANTE un refresh) ya la cubre `listSeq` (el refresh se descarta al terminar). PURO.
 */
export function shouldYieldWindowRefresh(s: { listLoadInFlight: boolean; loadingMore: boolean }): boolean {
  return s.listLoadInFlight || s.loadingMore;
}
