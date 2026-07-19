// useGroupView — orquesta la VISTA DE GRUPO PAGINADA (spec 10 delta «rodeo grande», Fase 3 / T-RG.19..21).
//
// Reescrito al CONTRATO PAGINADO (design §6.2): la lista de un rodeo/lote deja de ser "los 200 del campo"
// (fetchAnimals) y pasa a una query SCOPEADA + KEYSET-paginada (scroll infinito) + COUNT real + buscador/chips,
// todo del SQLite local (offline-first, spec 15). El hook centraliza:
//   - PAGINACIÓN: `animals` (páginas acumuladas) + `loadMore()` con guard de-un-solo-en-vuelo (RG1.6) y corte
//     por `reachedEnd` (RG1.5); cursor keyset interno (ref).
//   - META: `totalCount` real (overlay-aware) + `actions` (gating del grupo entero) + opciones de chips.
//   - REFRESH SILENCIOSO (foco / avance de sync): recarga la VENTANA cargada (`fetchGroupWindow`, LIMIT
//     loadedCount) SIN resetear a la página 1 ni blanquear → keys estables `profileId` preservan el scroll
//     (RG6.1/RG6.2). Un fallo transitorio conserva la lista montada.
//   - BUSCADOR + CHIPS (RG3.x): texto con debounce 250ms → modo búsqueda (`searchGroupAnimals` + intersección
//     client-side con chips); sin texto → modo lista paginada con los chips aplicados en SQL. Guard de secuencia.
//
// La lógica DECIDIBLE (¿se puede loadMore? dedup, intersección, ¿ofrecer chip de sexo?) vive en
// `utils/group-view-model.ts` (PURA, testeada). Multi-tenant: `establishmentId` viene del contexto (NUNCA
// hardcodeado). La pantalla (rodeo/[id] | lote/[id]) le pasa `{ establishmentId, group }` y consume el estado.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useStatus } from '@powersync/react';

import type { AnimalListItem, AppError } from '../services/animals';
import type { AnimalSex } from '../utils/animal-category';
import type { GroupActionsAvailability } from '../utils/group-actions';
import {
  GROUP_PAGE_SIZE,
  fetchGroupAnimalsPage,
  fetchGroupWindow,
  searchGroupAnimals,
  fetchGroupMemberCount,
  fetchGroupCategoryOptions,
  fetchGroupSexOptions,
  type GroupScope,
  type GroupPageCursor,
  type GroupCategoryOption,
} from '../services/group-page';
import { fetchRodeoGroupActions, fetchLoteGroupActions } from '../services/group-data';
import {
  type GroupFilter,
  canLoadMore,
  dedupById,
  intersectSearchWithChips,
  isSearchActive,
  sexFilterAvailable,
  shouldYieldWindowRefresh,
} from '../utils/group-view-model';

const SEARCH_DEBOUNCE_MS = 250; // RG3.x — mismo debounce que la tab Animales.
const NO_ACTIONS: GroupActionsAvailability = { castrate: false, vaccinate: false, wean: false };

export type { GroupScope, GroupCategoryOption };

/** Parámetros del hook: el campo activo + el grupo (rodeo/lote) a mostrar. `null` = grupo no resuelto aún. */
export type GroupViewParams = { establishmentId: string; group: GroupScope };

/** Estado expuesto a la pantalla (lista paginada + meta + buscador/chips). */
export type GroupViewState = {
  /** Filas VISIBLES: páginas acumuladas (modo lista) o resultados de búsqueda ∩ chips (modo búsqueda). */
  animals: AnimalListItem[];
  /** Gating de las acciones masivas del GRUPO ENTERO. `null` mientras no cargó (la barra espera). */
  actions: GroupActionsAvailability | null;
  /** Total REAL de animales activos del grupo (COUNT overlay-aware). `null` mientras no cargó → header "…". */
  totalCount: number | null;
  /** Carga INICIAL (blanquea la lista). */
  loading: boolean;
  /** Carga de una página adicional (footer "cargando más"). */
  loadingMore: boolean;
  /** La lista llegó al final (no hay más páginas). */
  reachedEnd: boolean;
  error: string | null;
  /** Pide la próxima página (idempotente: guard de-un-solo-en-vuelo + corte por reachedEnd/búsqueda). */
  loadMore: () => void;
  // ── buscador + chips ──
  query: string;
  setQuery: (t: string) => void;
  /** ¿Modo búsqueda activo? (texto debounced no vacío). */
  isSearching: boolean;
  /** La búsqueda está corriendo (spinner del buscador). */
  searchPending: boolean;
  categoryCode: string | null;
  setCategoryCode: (c: string | null) => void;
  sex: AnimalSex | null;
  setSex: (s: AnimalSex | null) => void;
  /** Opciones del chip de categoría (categorías presentes en el grupo, RG3.9). */
  categoryOptions: GroupCategoryOption[];
  /** ¿Ofrecer el chip de sexo? (solo si el grupo tiene ambos sexos, RG3.9). */
  sexFilterAvailable: boolean;
  /** Limpia texto + chips → vuelve a la lista paginada completa (RG3.8). */
  clearFilters: () => void;
};

function errorMessage(e: AppError): string {
  return e.kind === 'network' ? 'Sin conexión: no pudimos cargar el grupo.' : 'No pudimos cargar el grupo.';
}

export function useGroupView(params: GroupViewParams | null): GroupViewState {
  const establishmentId = params?.establishmentId ?? null;
  const groupType = params?.group.type ?? null;
  const groupId = params?.group.id ?? null;
  // Grupo ESTABLE (memoizado por sus primitivas) → los callbacks/efectos no se re-disparan por identidad.
  const group = useMemo<GroupScope | null>(
    () => (groupType && groupId ? { type: groupType, id: groupId } : null),
    [groupType, groupId],
  );

  const [pages, setPages] = useState<AnimalListItem[]>([]);
  const [actions, setActions] = useState<GroupActionsAvailability | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [categoryCode, setCategoryCode] = useState<string | null>(null);
  const [sex, setSex] = useState<AnimalSex | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<GroupCategoryOption[]>([]);
  const [sexesPresent, setSexesPresent] = useState<AnimalSex[]>([]);
  const [searchResults, setSearchResults] = useState<AnimalListItem[]>([]);
  const [searchPending, setSearchPending] = useState(false);

  // Refs internos: el cursor keyset + los guards (leídos por callbacks sin re-render / sin closures viejas).
  const cursorRef = useRef<GroupPageCursor | null>(null);
  const reachedEndRef = useRef(false);
  const loadingRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const pagesRef = useRef<AnimalListItem[]>([]);
  const listSeq = useRef(0); // guard de secuencia de la LISTA (invalida cargas viejas ante cambios de criterio)
  const searchSeq = useRef(0); // guard de secuencia de la BÚSQUEDA
  const didFirstListRef = useRef(false); // ¿ya corrió la 1ª carga de lista de este grupo? (blanquea solo la 1ª)
  const didFocusOnceRef = useRef(false); // ¿ya se enfocó una vez? (el 1er foco NO refresca: la carga ya corre)
  const hasLoadedOnceRef = useRef(false); // ¿la 1ª carga de contenido terminó? (los refresh silenciosos esperan)

  const syncStatus = useStatus();
  const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;

  const isSearching = isSearchActive(debouncedQuery);

  // Resetea el estado interno de paginación (cambio de grupo / criterio → lista desde el tope).
  const setPagesAndRefs = useCallback((items: AnimalListItem[], cursor: GroupPageCursor | null, end: boolean) => {
    const deduped = dedupById(items);
    pagesRef.current = deduped;
    cursorRef.current = cursor;
    reachedEndRef.current = end;
    setPages(deduped);
    setReachedEnd(end);
  }, []);

  // ── META: count real + gating del grupo entero + opciones de chips. Depende SOLO de est+group (no de los
  //    filtros/texto → no se recomputa al tipear o cambiar un chip). Best-effort: un fallo NO blanquea la lista;
  //    `actions` cae a NO_ACTIONS (fail-closed — no ofrecemos masivas si no sabemos si hay candidatos). ──
  const loadMeta = useCallback(async () => {
    if (!establishmentId || !group) return;
    const [countR, optsR, sexR] = await Promise.all([
      fetchGroupMemberCount(establishmentId, group),
      fetchGroupCategoryOptions(establishmentId, group),
      fetchGroupSexOptions(establishmentId, group),
    ]);
    if (countR.ok) setTotalCount(countR.value);
    if (optsR.ok) setCategoryOptions(optsR.value);
    if (sexR.ok) setSexesPresent(sexR.value);
    const actionsR =
      group.type === 'rodeo'
        ? await fetchRodeoGroupActions(establishmentId, group.id)
        : await fetchLoteGroupActions(establishmentId, group.id);
    setActions(actionsR.ok ? actionsR.value : NO_ACTIONS);
  }, [establishmentId, group]);

  // ── LISTA (modo lista): 1ª página desde el tope con los chips actuales. `blank` = mostrar el loader inicial
  //    (solo la 1ª vez de este grupo; un cambio de chip NO blanquea, RG3.7). Guard de secuencia: descarta la
  //    respuesta si el criterio cambió mientras cargaba. Errores SÍ se surfacean (carga user/inicial). ──
  const loadFirstPage = useCallback(
    async (blank: boolean) => {
      if (!establishmentId || !group) return;
      const seq = ++listSeq.current;
      // loadingRef bloquea loadMore durante CUALQUIER recarga de 1ª página (inicial o cambio de chip) → evita un
      // fetch desperdiciado + flash del footer. `setLoading` (blanquear la lista) solo en la 1ª vez (blank).
      loadingRef.current = true;
      if (blank) setLoading(true);
      const filter: GroupFilter = { categoryCode, sex };
      const r = await fetchGroupAnimalsPage(establishmentId, group, { filter, cursor: null });
      loadingRef.current = false;
      if (blank) setLoading(false);
      if (seq !== listSeq.current) return; // el criterio cambió mientras cargaba → descartamos
      if (!r.ok) {
        setError(errorMessage(r.error));
        setPagesAndRefs([], null, true);
        return;
      }
      setError(null);
      setPagesAndRefs(r.value.items, r.value.nextCursor, r.value.reachedEnd);
      hasLoadedOnceRef.current = true;
    },
    [establishmentId, group, categoryCode, sex, setPagesAndRefs],
  );

  // ── BÚSQUEDA (modo búsqueda): scopeada al grupo, ≤20 filas. `silent` = refresh en segundo plano (no toca el
  //    spinner ni descarta la lista ante un fallo). Guard de secuencia (searchSeq). ──
  const runSearch = useCallback(
    async (silent: boolean) => {
      const q = debouncedQuery.trim();
      if (!establishmentId || !group || q.length === 0) {
        setSearchResults([]);
        setSearchPending(false);
        return;
      }
      const seq = ++searchSeq.current;
      if (!silent) setSearchPending(true);
      const r = await searchGroupAnimals(establishmentId, group, q);
      if (seq !== searchSeq.current) return;
      setSearchPending(false);
      if (!r.ok) {
        if (!silent) setSearchResults([]);
        return;
      }
      setError(null); // una búsqueda OK limpia un error viejo de la lista (no debe enmascarar el no-match)
      setSearchResults(r.value);
      hasLoadedOnceRef.current = true;
    },
    [establishmentId, group, debouncedQuery],
  );

  // ── REFRESH SILENCIOSO de la ventana cargada (foco/sync, modo lista): re-fetch de `loadedCount` filas desde
  //    el tope, reemplazando en el lugar (keys estables → scroll preservado, RG6.1). NO blanquea. Un fallo
  //    transitorio conserva la lista (RG6.2). `reachedEnd` previo se preserva si la ventana vuelve LLENA. ──
  const refreshWindow = useCallback(async () => {
    if (!establishmentId || !group) return;
    // FIX del race de ENSANCHAR-filtro: un refresh de FONDO CEDE si hay una carga de FOREGROUND en vuelo — una
    // 1ª página por cambio de filtro/criterio (o un refresh previo) vía `loadingRef`, o un `loadMore` vía
    // `loadingMoreRef`. Bail ANTES de leer `loadedCount`/`reachedEndRef` o bumpear `listSeq`: si no cediera,
    // podría (a) clobber-ear la 1ª página fresca (bumpea seq último → gana el guard compartido) o (b) recomputar
    // la ventana con un `limit`/`reachedEnd`/filtro STALE del criterio ANTERIOR (angosto) → dejar la lista pegada
    // en el tamaño viejo pese al filtro nuevo (más ancho). El foreground lee del MISMO SQLite local ya
    // sincronizado → aplica el resultado correcto. La dirección inversa (loadFirstPage que arranca DURANTE este
    // refresh) ya la cubre `listSeq` (el refresh se descarta al terminar). (design §8, race resuelto.)
    if (shouldYieldWindowRefresh({ listLoadInFlight: loadingRef.current, loadingMore: loadingMoreRef.current })) return;
    const loadedCount = pagesRef.current.length;
    const limit = loadedCount > 0 ? loadedCount : GROUP_PAGE_SIZE;
    const seq = ++listSeq.current; // invalida un loadMore concurrente (evita anexar sobre una ventana reemplazada)
    loadingRef.current = true; // bloquea loadMore durante el refresh (se reemplaza la ventana entera)
    const filter: GroupFilter = { categoryCode, sex };
    const prevReachedEnd = reachedEndRef.current;
    const r = await fetchGroupWindow(establishmentId, group, { filter, limit });
    loadingRef.current = false;
    if (seq !== listSeq.current) return;
    if (!r.ok) return; // fallo transitorio → conserva la lista montada (RG6.2)
    // Menos filas que el límite ⇒ el grupo se achicó ⇒ fin. Ventana llena ⇒ preservamos el reachedEnd previo
    // (no sabemos si hay más ABAJO; las altas del overlay caen en el TOPE por created_at DESC).
    const end = r.value.reachedEnd ? true : prevReachedEnd;
    setError(null); // un refresh OK limpia un error viejo de la lista (no debe enmascarar la ventana recargada)
    setPagesAndRefs(r.value.items, r.value.nextCursor, end);
  }, [establishmentId, group, categoryCode, sex, setPagesAndRefs]);

  // ── loadMore (RG1.3/RG1.5/RG1.6): anexa la próxima página. Guard PURO (canLoadMore) sobre los refs (valores
  //    frescos, sin closures viejas). Descarta la página si el criterio cambió mientras cargaba (seq). ──
  const loadMore = useCallback(() => {
    if (
      !establishmentId ||
      !group ||
      !canLoadMore({
        loading: loadingRef.current,
        loadingMore: loadingMoreRef.current,
        reachedEnd: reachedEndRef.current,
        isSearching,
      })
    ) {
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = listSeq.current;
    const filter: GroupFilter = { categoryCode, sex };
    const cursor = cursorRef.current;
    void (async () => {
      const r = await fetchGroupAnimalsPage(establishmentId, group, { filter, cursor });
      loadingMoreRef.current = false;
      setLoadingMore(false);
      if (seq !== listSeq.current) return; // el criterio cambió (chip/refresh) mientras cargaba → descartamos
      if (!r.ok) return; // fallo de una página extra → NO rompe la lista ya cargada (RG6.2)
      const merged = dedupById([...pagesRef.current, ...r.value.items]);
      pagesRef.current = merged;
      cursorRef.current = r.value.nextCursor;
      reachedEndRef.current = r.value.reachedEnd;
      setPages(merged);
      setReachedEnd(r.value.reachedEnd);
    })();
  }, [establishmentId, group, categoryCode, sex, isSearching]);

  const clearFilters = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setCategoryCode(null);
    setSex(null);
  }, []);

  // ── Debounce del buscador (250ms). Dep primitiva (string) → sin loop. ──
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // ── META: al montar / cambiar de grupo. ──
  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  // ── LISTA (modo lista): 1ª página al montar (blanquea) + al cambiar chips (silent, desde el tope, RG3.7) +
  //    al LIMPIAR la búsqueda (volver a la lista completa, RG3.8). En modo búsqueda no toca la lista. ──
  useEffect(() => {
    if (!group || isSearching) return;
    const blank = !didFirstListRef.current;
    didFirstListRef.current = true;
    void loadFirstPage(blank);
  }, [group, isSearching, loadFirstPage]);

  // ── BÚSQUEDA (modo búsqueda): corre cuando hay texto (y se re-corre al cambiar el texto debounced). ──
  useEffect(() => {
    if (!group || !isSearching) return;
    void runSearch(false);
  }, [group, isSearching, runSearch]);

  // ── Refresh SILENCIOSO al RE-ENFOCAR (volver de una masiva/ficha): el 1er foco NO refresca (la carga inicial
  //    ya está corriendo). Los siguientes: meta + ventana (o re-búsqueda) sin blanquear. Espera a que la 1ª
  //    carga haya terminado (hasLoadedOnceRef) para no competir con ella. ──
  useFocusEffect(
    useCallback(() => {
      if (!didFocusOnceRef.current) {
        didFocusOnceRef.current = true;
        return;
      }
      if (!group || !hasLoadedOnceRef.current) return;
      void loadMeta();
      if (isSearchActive(debouncedQuery)) void runSearch(true);
      else void refreshWindow();
    }, [group, debouncedQuery, loadMeta, runSearch, refreshWindow]),
  );

  // ── Refresh SILENCIOSO al AVANZAR el sync (first-sync / download posterior): el SQLite local cambió. Dep
  //    primitiva (ms), estable entre syncs → no loopea. Espera a la 1ª carga (hasLoadedOnceRef) para no competir. ──
  useEffect(() => {
    if (lastSyncedMs === 0 || !group || !hasLoadedOnceRef.current) return;
    void loadMeta();
    if (isSearchActive(debouncedQuery)) void runSearch(true);
    else void refreshWindow();
  }, [lastSyncedMs, group, debouncedQuery, loadMeta, runSearch, refreshWindow]);

  // Filas visibles: en modo búsqueda, los resultados ∩ chips (RG3.6); en modo lista, las páginas acumuladas.
  const animals = useMemo(
    () => (isSearching ? intersectSearchWithChips(searchResults, { categoryCode, sex }) : pages),
    [isSearching, searchResults, categoryCode, sex, pages],
  );

  return {
    animals,
    actions,
    totalCount,
    loading: group ? loading : false,
    loadingMore,
    reachedEnd,
    error: group ? error : 'No se encontró el grupo.',
    loadMore,
    query,
    setQuery,
    isSearching,
    searchPending,
    categoryCode,
    setCategoryCode,
    sex,
    setSex,
    categoryOptions,
    sexFilterAvailable: sexFilterAvailable(sexesPresent),
    clearFilters,
  };
}
