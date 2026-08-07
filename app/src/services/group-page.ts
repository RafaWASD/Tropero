// Capa de datos de la VISTA DE GRUPO PAGINADA (spec 10 delta «rodeo grande», Fase 2 / RG1.x, RG2.x, RG3.x).
//
// Reemplaza el reuso de `fetchAnimals({rodeoId})` (LIMIT 200 del CAMPO) por una lectura SCOPEADA al grupo
// (rodeo_id / management_group_id), PAGINADA por keyset (scroll infinito) y overlay-aware, más el count real, el
// buscador scopeado y las opciones de categoría. Todo del SQLite local (offline-first, spec 15 / RG6.4). La tab
// Animales (fetchAnimals / buildAnimalsListQuery) NO se toca (RG7.1). NUNCA se hardcodea establishment_id (ppio 6).
//
// Diseño §2: paginar acota el compute O(N) del espejo de categoría (C6) + estado reproductivo — se aplican SOLO a
// la página (enrichLocalRows), no al grupo entero. La búsqueda corre sobre el SET COMPLETO del grupo (query
// scopeada, no la página cargada — RG3.2). El count real reusa los head-count builders (overlay-aware, §3.2).

import type { AnimalSex } from '../utils/animal-category';
import { deriveNextCursor } from '../utils/group-page-cursor';
import { classifySearchQuery } from '../utils/animal-identifier';
import {
  type AnimalListItem,
  type LocalListRow,
  type ServiceResult,
  enrichLocalRows,
} from './animals';
import { fetchRodeoHeadCounts, fetchGroupHeadCounts } from './group-data';
import {
  type GroupScope,
  type GroupPageCursor,
  buildGroupAnimalsPageQuery,
  buildGroupCategoryOptionsQuery,
  buildGroupSexOptionsQuery,
  buildSearchByTagQuery,
  buildSearchByIdvQuery,
  buildSearchLikeQuery,
  buildApodoSearchQuery,
} from './powersync/local-reads';
import { runLocalQuery } from './powersync/local-query';

export type { GroupScope, GroupPageCursor } from './powersync/local-reads';
export type { ServiceResult } from './animals';

/**
 * Tamaño de página de la lista de la vista de grupo (design §3.1, DG1). 60 = punto medio: cada `loadMore` barato
 * (2 batch-queries del espejo sobre 60 perfiles) + primer paint rápido; la FlatList pinta ~10–15 filas → buffer
 * cómodo sin sobre-cargar el compute. Ajustable en UN solo lugar.
 */
export const GROUP_PAGE_SIZE = 60;

/** Filtros opcionales (chips) de la lista del grupo (RG3.5): categoría almacenada + sexo. */
export type GroupPageFilter = { categoryCode?: string | null; sex?: AnimalSex | null };

/** Una página de la lista del grupo: las filas enriquecidas + el cursor de la próxima página + el corte. */
export type GroupAnimalsPage = {
  items: AnimalListItem[];
  nextCursor: GroupPageCursor | null;
  reachedEnd: boolean;
};

/** Una opción del chip de categoría de la vista de grupo (RG3.9). */
export type GroupCategoryOption = { code: string; name: string };

// La query de página proyecta `created_at` + `in_treatment` (además de las columnas de la lista) — los necesita
// deriveNextCursor para el cursor keyset. LocalListRow ya trae `in_treatment` (opcional); acá lo fijamos presente.
type GroupPageRow = LocalListRow & { created_at: string; in_treatment: number };

/**
 * Carga UNA página de animales activos del grupo (RG1.1–RG1.6): query scopeada + keyset + LIMIT `GROUP_PAGE_SIZE`,
 * overlay-aware, del SQLite local. `cursor` null = 1ª página (sin keyset). Aplica el espejo C6 + repro SOLO a la
 * página (design §2) con `enrichLocalRows`. Devuelve `{ items, nextCursor, reachedEnd }` (RG1.5).
 *
 * `emptyIsSyncing`: en la 1ª página (cursor null) un vacío sin sync degrada a "Sincronizando…" (consistente con la
 * vista de grupo baseline); en un `loadMore` (cursor presente) un vacío es un resultado legítimo = fin (reachedEnd).
 */
export async function fetchGroupAnimalsPage(
  establishmentId: string,
  group: GroupScope,
  params: { filter?: GroupPageFilter; cursor?: GroupPageCursor | null } = {},
): Promise<ServiceResult<GroupAnimalsPage>> {
  const filter = params.filter ?? {};
  const cursor = params.cursor ?? null;
  const r = await runLocalQuery<GroupPageRow>(
    buildGroupAnimalsPageQuery(establishmentId, group, filter, cursor, GROUP_PAGE_SIZE),
    { emptyIsSyncing: cursor == null },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const { nextCursor, reachedEnd } = deriveNextCursor(r.value, GROUP_PAGE_SIZE);
  const items = await enrichLocalRows(r.value);
  return { ok: true, value: { items, nextCursor, reachedEnd } };
}

/**
 * Recarga la VENTANA cargada del grupo (refresh silencioso, RG6.1 / design §6.2): re-fetch de las primeras
 * `limit` filas desde el TOPE (keyset desde el inicio, `LIMIT limit`), overlay-aware. `limit` = la cantidad de
 * filas ya cargadas (páginas acumuladas) → el refresh es ACOTADO (no re-escanea el grupo entero) y refleja las
 * altas/mudanzas del overlay que caen en el tope (`created_at DESC`, E4/RG6.3). Reemplaza la ventana SIN resetear
 * a la página 1 (keys estables `profileId` → la FlatList preserva el scroll). `reachedEnd = filas < limit` (menos
 * filas que el límite ⇒ el grupo se achicó ⇒ ya no hay más); el hook preserva `reachedEnd` previo cuando la
 * ventana vuelve llena. `nextCursor` = clave de la última fila (para seguir paginando desde ahí). Del SQLite local.
 */
export async function fetchGroupWindow(
  establishmentId: string,
  group: GroupScope,
  params: { filter?: GroupPageFilter; limit: number },
): Promise<ServiceResult<GroupAnimalsPage>> {
  const filter = params.filter ?? {};
  const limit = Math.max(1, Math.trunc(params.limit));
  const r = await runLocalQuery<GroupPageRow>(
    buildGroupAnimalsPageQuery(establishmentId, group, filter, null, limit),
    { emptyIsSyncing: false }, // refresh silencioso: un vacío es un resultado legítimo, NO "Sincronizando".
  );
  if (!r.ok) return { ok: false, error: r.error };
  const { nextCursor, reachedEnd } = deriveNextCursor(r.value, limit);
  const items = await enrichLocalRows(r.value);
  return { ok: true, value: { items, nextCursor, reachedEnd } };
}

/**
 * Busca dentro del grupo (RG3.1/RG3.2): espeja `searchAnimals` (motor caravana/IDV/apodo) pero pasando el
 * `groupScope` a los builders → corre sobre el SET COMPLETO del grupo (no la página cargada). Mismo dedup por
 * profileId + los EXACTOS priorizados arriba; el espejo + repro se aplican UNA vez sobre el set deduplicado. La
 * `searchAnimals` de la tab Animales NO se toca (RG7.1). Cap `LIMIT 20` por builder (la búsqueda narrow-ea fuerte).
 */
export async function searchGroupAnimals(
  establishmentId: string,
  group: GroupScope,
  rawQuery: string,
): Promise<ServiceResult<AnimalListItem[]>> {
  const plan = classifySearchQuery(rawQuery);
  if (!plan.tryTagExact && !plan.tryIdvExact && !plan.tryIdvSubstring && !plan.tryApodo) {
    return { ok: true, value: [] };
  }

  const seen = new Set<string>();
  const rawRows: LocalListRow[] = [];
  const push = (rows: LocalListRow[] | null): void => {
    for (const row of rows ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rawRows.push(row);
    }
  };

  if (plan.tryTagExact) {
    const r = await runLocalQuery<LocalListRow>(
      buildSearchByTagQuery(establishmentId, plan.compact, group),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    push(r.value);
  }
  // Una sub-query POR TÉRMINO exacto (fix 🔴 A.1, espejo de searchAnimals): el tipeado TAL CUAL —como está
  // impreso en la caravana— y, si difiere, el compacto. La 3ra superficie del bug: el buscador DENTRO de un
  // rodeo/lote tiene el mismo motor y tenía el mismo agujero.
  if (plan.tryIdvExact) {
    for (const term of plan.idvExactTerms) {
      const r = await runLocalQuery<LocalListRow>(
        buildSearchByIdvQuery(establishmentId, term, group),
        { emptyIsSyncing: false },
      );
      if (!r.ok) return { ok: false, error: r.error };
      push(r.value);
    }
  }
  if (plan.tryIdvSubstring) {
    const idvRes = await runLocalQuery<LocalListRow>(
      buildSearchLikeQuery(establishmentId, 'idv', plan.compact, group),
      { emptyIsSyncing: false },
    );
    if (!idvRes.ok) return { ok: false, error: idvRes.error };
    push(idvRes.value);

    const tagRes = await runLocalQuery<LocalListRow>(
      buildSearchLikeQuery(establishmentId, 'animal_tag_electronic', plan.compact, group),
      { emptyIsSyncing: false },
    );
    if (!tagRes.ok) return { ok: false, error: tagRes.error };
    push(tagRes.value);
  }
  if (plan.tryApodo) {
    const r = await runLocalQuery<LocalListRow>(
      buildApodoSearchQuery(establishmentId, plan.normalized, group),
      { emptyIsSyncing: false },
    );
    if (!r.ok) return { ok: false, error: r.error };
    push(r.value);
  }

  const items = await enrichLocalRows(rawRows);
  return { ok: true, value: items };
}

/**
 * Total REAL de animales activos del grupo (RG2.1/RG2.2): reusa los head-count builders as-built (overlay-aware,
 * design §3.2) — rodeo → `fetchRodeoHeadCounts`, lote → `fetchGroupHeadCounts`. Grupo sin animales → 0. Del SQLite
 * local (offline).
 */
export async function fetchGroupMemberCount(
  establishmentId: string,
  group: GroupScope,
): Promise<ServiceResult<number>> {
  if (group.type === 'rodeo') {
    const r = await fetchRodeoHeadCounts(establishmentId);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, value: r.value.get(group.id) ?? 0 };
  }
  const r = await fetchGroupHeadCounts(establishmentId);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.get(group.id) ?? 0 };
}

/**
 * Opciones del chip de CATEGORÍA de la vista de grupo (RG3.9): las categorías (almacenadas) presentes entre los
 * miembros activos del grupo, scopeado + overlay-aware. Vacío legítimo (grupo sin miembros) NO degrada a
 * "Sincronizando". Del SQLite local (offline).
 */
export async function fetchGroupCategoryOptions(
  establishmentId: string,
  group: GroupScope,
): Promise<ServiceResult<GroupCategoryOption[]>> {
  const r = await runLocalQuery<GroupCategoryOption>(
    buildGroupCategoryOptionsQuery(establishmentId, group),
    { emptyIsSyncing: false },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value };
}

/**
 * Sexos DISTINTOS presentes entre los miembros activos del grupo (RG3.9): alimenta la decisión del hook de
 * OFRECER el chip de sexo SOLO si hay ambos (`sexFilterAvailable`). Query PROPIA scopeada + overlay-aware
 * (`buildGroupSexOptionsQuery`) — NO derivada de la categoría (robusto ante categorías sex-neutras). Del SQLite
 * local (offline). Filtra valores fuera de 'male'|'female' (defensivo).
 */
export async function fetchGroupSexOptions(
  establishmentId: string,
  group: GroupScope,
): Promise<ServiceResult<AnimalSex[]>> {
  const r = await runLocalQuery<{ animal_sex: string | null }>(
    buildGroupSexOptionsQuery(establishmentId, group),
    { emptyIsSyncing: false },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const sexes = r.value
    .map((row) => row.animal_sex)
    .filter((s): s is AnimalSex => s === 'male' || s === 'female');
  return { ok: true, value: sexes };
}
