// Capa de datos de la VISTA DE GRUPO (spec 10, T-UI.1 / R1.1, R1.5, R1.6, R7.1).
//
// Resuelve el GATING de las acciones masivas de un grupo (rodeo o lote) leyendo del SQLite local
// (offline-first, spec 15): el catálogo `field_definitions` (data_key → field_definition_id) + el
// `rodeo_data_config` de cada rodeo del grupo. La DECISIÓN (qué acciones se ofrecen) es PURA
// (utils/group-actions.ts) — acá solo el I/O + el cruce. NO redefine queries: reusa fetchFieldCatalog +
// fetchRodeoConfig as-built (rodeo-config.ts). NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6).
//
// Para un RODEO: el gating sale de su propia config. Para un LOTE cross-rodeo (R7.1): la acción gateada
// se ofrece si ALGÚN rodeo representado entre sus animales activos la tiene habilitada → resolvemos los
// rodeos reales de los miembros y unimos su gating.

import {
  buildRodeoGating,
  resolveGroupActions,
  type GroupActionsAvailability,
  type RodeoGating,
} from '../utils/group-actions';
import { fetchFieldCatalog } from './rodeo-config';
import { fetchRodeoConfig } from './rodeo-config';
import type { ServiceResult } from './rodeo-config';
import {
  buildRodeoHeadCountsQuery,
  buildGroupHeadCountsQuery,
} from './powersync/local-reads';
import { runLocalQuery } from './powersync/local-query';

export type { ServiceResult } from './rodeo-config';

/**
 * Mapa data_key → field_definition_id del catálogo global (read-only, local). Lo necesita el gating
 * (group-actions.ts) para cruzar el data_key con el rodeo_data_config. Se resuelve UNA vez y se reusa
 * para todos los rodeos de un lote.
 */
async function fetchDataKeyToFieldId(): Promise<ServiceResult<Map<string, string>>> {
  const r = await fetchFieldCatalog();
  if (!r.ok) return { ok: false, error: r.error };
  const map = new Map<string, string>();
  for (const f of r.value) map.set(f.dataKey, f.id);
  return { ok: true, value: map };
}

/** Resuelve el RodeoGating de un rodeo (config local → enabled por data_key). */
async function fetchRodeoGating(
  rodeoId: string,
  dataKeyToFieldId: ReadonlyMap<string, string>,
): Promise<ServiceResult<RodeoGating>> {
  const cfg = await fetchRodeoConfig(rodeoId);
  if (!cfg.ok) return { ok: false, error: cfg.error };
  const enabledByFieldId = new Map<string, boolean>();
  for (const row of cfg.value) enabledByFieldId.set(row.fieldDefinitionId, row.enabled);
  return { ok: true, value: buildRodeoGating(dataKeyToFieldId, enabledByFieldId) };
}

/**
 * Acciones masivas disponibles para la vista de UN RODEO (R1.5): Castrar siempre; Vacunar/Destetar
 * según el `rodeo_data_config` de ese rodeo. Lee del SQLite local (offline). Castrar nunca falla por
 * gating; si la config no se pudo leer, devolvemos el error (la pantalla degrada con copy es-AR).
 */
export async function fetchRodeoGroupActions(
  rodeoId: string,
): Promise<ServiceResult<GroupActionsAvailability>> {
  const catalog = await fetchDataKeyToFieldId();
  if (!catalog.ok) return { ok: false, error: catalog.error };
  const gating = await fetchRodeoGating(rodeoId, catalog.value);
  if (!gating.ok) return { ok: false, error: gating.error };
  return { ok: true, value: resolveGroupActions([gating.value]) };
}

/**
 * Acciones masivas disponibles para la vista de un LOTE cross-rodeo (R7.1): Castrar siempre;
 * Vacunar/Destetar si ALGÚN rodeo representado entre los `memberRodeoIds` (los rodeos reales de los
 * animales activos del lote) tiene el data_key habilitado. El caller pasa los rodeoIds DISTINTOS de los
 * miembros (los saca de la lista de animales del lote, ya cargada). Lee la config de cada rodeo del
 * SQLite local (offline). Si la lista de rodeos está vacía (lote sin miembros) → solo Castrar.
 */
export async function fetchLoteGroupActions(
  memberRodeoIds: readonly string[],
): Promise<ServiceResult<GroupActionsAvailability>> {
  const distinct = [...new Set(memberRodeoIds)];
  if (distinct.length === 0) {
    return { ok: true, value: resolveGroupActions([]) };
  }
  const catalog = await fetchDataKeyToFieldId();
  if (!catalog.ok) return { ok: false, error: catalog.error };

  const gatings: RodeoGating[] = [];
  for (const rodeoId of distinct) {
    const g = await fetchRodeoGating(rodeoId, catalog.value);
    if (!g.ok) return { ok: false, error: g.error };
    gatings.push(g.value);
  }
  return { ok: true, value: resolveGroupActions(gatings) };
}

// ─── Conteos de cabezas por grupo (Inicio rodeo-céntrico, T-UI.2 / R2.1) ───────────────────

/**
 * Cabezas activas POR RODEO del campo (R2.1: la card de rodeo muestra las cabezas). Devuelve un Map
 * rodeo_id → count desde el SQLite local (offline). Los rodeos sin animales NO aparecen en el Map → el
 * caller los muestra como 0. COUNT(*) no degrada a "sincronizando" (antes del primer sync da vacío =
 * todos 0, dirección segura: es un hint de UI, no autorización).
 */
export async function fetchRodeoHeadCounts(
  establishmentId: string,
): Promise<ServiceResult<Map<string, number>>> {
  const r = await runLocalQuery<{ rodeo_id: string; count: number }>(
    buildRodeoHeadCountsQuery(establishmentId),
    { emptyIsSyncing: false },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const map = new Map<string, number>();
  for (const row of r.value) map.set(row.rodeo_id, row.count);
  return { ok: true, value: map };
}

/**
 * Cabezas activas POR LOTE (management_group) del campo (R2.1: la card de lote muestra las cabezas).
 * Devuelve un Map management_group_id → count desde el SQLite local (offline). Los lotes sin animales no
 * aparecen → el caller los muestra como 0.
 */
export async function fetchGroupHeadCounts(
  establishmentId: string,
): Promise<ServiceResult<Map<string, number>>> {
  const r = await runLocalQuery<{ management_group_id: string; count: number }>(
    buildGroupHeadCountsQuery(establishmentId),
    { emptyIsSyncing: false },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const map = new Map<string, number>();
  for (const row of r.value) map.set(row.management_group_id, row.count);
  return { ok: true, value: map };
}
