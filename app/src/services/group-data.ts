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
  applyCandidateGating,
  buildRodeoGating,
  resolveGroupActions,
  type GroupActionsAvailability,
  type GroupCandidateCounts,
  type RodeoGating,
} from '../utils/group-actions';
import { fetchFieldCatalog } from './rodeo-config';
import { fetchRodeoConfig } from './rodeo-config';
import type { ServiceResult } from './rodeo-config';
import {
  type GroupScope,
  buildRodeoHeadCountsQuery,
  buildGroupHeadCountsQuery,
  buildGroupCandidateCountsQuery,
  buildGroupRodeoIdsQuery,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle } from './powersync/local-query';

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
 * Gating de CONFIG (solo `rodeo_data_config`, SIN gating por candidatos) de UN rodeo: `{ vaccinationEnabled,
 * weaningEnabled }`. Lo usan los predicados de exclusión cross-rodeo de las pantallas de masivas (R7.2):
 * "¿este rodeo tiene `vacunacion`/`destete` habilitado?" — una pregunta puramente de CONFIG, independiente
 * de si hay candidatos. (NO usar `fetchRodeoGroupActions` para esto: esa función gatea además por candidatos
 * → su `.wean` sería false en un rodeo configurado pero sin terneros, lo que es la pregunta equivocada acá.)
 */
export async function fetchRodeoConfigGating(rodeoId: string): Promise<ServiceResult<RodeoGating>> {
  const catalog = await fetchDataKeyToFieldId();
  if (!catalog.ok) return { ok: false, error: catalog.error };
  return fetchRodeoGating(rodeoId, catalog.value);
}

/**
 * Conteos de candidatos (castración / destete) del GRUPO ENTERO (RG5.2, design §5.2) — vía COUNT/EXISTS SQL
 * scopeado + overlay-aware (`buildGroupCandidateCountsQuery`), NO sobre la lista/página cargada (antes se contaba
 * sobre `animals`, que con paginación sería solo la 1ª página → gating incorrecto, E1). `weaningEnabledRodeoIds`
 * restringe el conteo de destete a los rodeos con `destete` habilitado (rodeo único: `[rodeoId]` o `[]`; lote
 * cross-rodeo: el subconjunto habilitado, R7.2). Lee del SQLite local (offline). NUNCA hardcodea establishment_id.
 */
async function fetchGroupCandidateCounts(
  establishmentId: string,
  group: GroupScope,
  weaningEnabledRodeoIds: readonly string[],
): Promise<ServiceResult<GroupCandidateCounts>> {
  const r = await runLocalQuerySingle<{ castrate: number; wean: number }>(
    buildGroupCandidateCountsQuery(establishmentId, group, { weaningEnabledRodeoIds }),
    { emptyIsSyncing: false },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: { castrate: r.value?.castrate ?? 0, wean: r.value?.wean ?? 0 } };
}

/**
 * Acciones masivas disponibles para la vista de UN RODEO (R1.5 + gating por candidatos): Vacunar/Destetar según el
 * `rodeo_data_config` de ese rodeo; Castrar/Destetar además requieren ≥1 candidato. El gating por candidatos ahora
 * resuelve el conteo sobre el GRUPO ENTERO (COUNT SQL scopeado, RG5.2) — ya NO recibe la lista mostrada (con
 * paginación esa sería solo la 1ª página). Lee del SQLite local (offline). La config es FAIL-SOFT (si no se lee →
 * config-off, pero Castrar se gatea igual por candidatos); solo falla duro si el COUNT de candidatos no se pudo leer
 * (entonces el loader cae a su fallback fail-closed). NUNCA hardcodea establishment_id (ppio 6).
 */
export async function fetchRodeoGroupActions(
  establishmentId: string,
  rodeoId: string,
): Promise<ServiceResult<GroupActionsAvailability>> {
  const catalog = await fetchDataKeyToFieldId();
  const gating = catalog.ok ? await fetchRodeoGating(rodeoId, catalog.value) : null;
  const rodeoGating: RodeoGating = gating?.ok ? gating.value : { vaccinationEnabled: false, weaningEnabled: false };
  const config = resolveGroupActions([rodeoGating]);

  // Rodeo único: el destete se gatea por la config de ESTE rodeo (habilitado → [rodeoId]; no → [] = 0 candidatos).
  const weaningEnabledRodeoIds = rodeoGating.weaningEnabled ? [rodeoId] : [];
  const countsRes = await fetchGroupCandidateCounts(establishmentId, { type: 'rodeo', id: rodeoId }, weaningEnabledRodeoIds);
  if (!countsRes.ok) return { ok: false, error: countsRes.error };
  return { ok: true, value: applyCandidateGating(config, countsRes.value) };
}

/**
 * Acciones masivas disponibles para la vista de un LOTE cross-rodeo (R7.1 + gating por candidatos): Vacunar/Destetar
 * si ALGÚN rodeo representado entre los miembros tiene el data_key habilitado; Castrar/Destetar además requieren ≥1
 * candidato del GRUPO ENTERO (RG5.2). Los rodeos representados se resuelven con una query barata
 * (`buildGroupRodeoIdsQuery`, DISTINCT scopeado) — ya NO desde la lista cargada (que con paginación sería parcial) y
 * SIN cargar todos los miembros (no paga el compute del espejo, design §2 corolario). El destete cuenta SOLO
 * terneros cuyo rodeo real tiene `destete` (R7.2). Lee del SQLite local (offline). Si el lote no tiene miembros →
 * todas las acciones apagadas. NUNCA hardcodea establishment_id (ppio 6).
 */
export async function fetchLoteGroupActions(
  establishmentId: string,
  groupId: string,
): Promise<ServiceResult<GroupActionsAvailability>> {
  const group: GroupScope = { type: 'lote', id: groupId };

  // Rodeos REALES representados entre los miembros del lote (R7.1): query barata DISTINCT scopeada (no la lista).
  const rodeosRes = await runLocalQuery<{ rodeo_id: string }>(
    buildGroupRodeoIdsQuery(establishmentId, group),
    { emptyIsSyncing: false },
  );
  if (!rodeosRes.ok) return { ok: false, error: rodeosRes.error };
  const distinct = rodeosRes.value.map((r) => r.rodeo_id);
  if (distinct.length === 0) {
    // Lote sin miembros: sin rodeos (config off) y sin candidatos → todas apagadas.
    return { ok: true, value: applyCandidateGating(resolveGroupActions([]), { castrate: 0, wean: 0 }) };
  }

  // Config FAIL-SOFT (igual que el rodeo): si no se puede leer el catálogo/config, degradamos a config-off
  // y dejamos que el gating por candidatos rija Castrar. weaningEnabled de fallback = false por rodeo.
  const catalog = await fetchDataKeyToFieldId();
  const gatingByRodeo = new Map<string, RodeoGating>();
  for (const rodeoId of distinct) {
    const g = catalog.ok ? await fetchRodeoGating(rodeoId, catalog.value) : null;
    gatingByRodeo.set(rodeoId, g?.ok ? g.value : { vaccinationEnabled: false, weaningEnabled: false });
  }
  const config = resolveGroupActions([...gatingByRodeo.values()]);

  // Destete por rodeo (R7.2): solo cuentan terneros cuyo rodeo real tiene `destete` habilitado.
  const weaningEnabledRodeoIds = distinct.filter((rid) => gatingByRodeo.get(rid)?.weaningEnabled);
  const countsRes = await fetchGroupCandidateCounts(establishmentId, group, weaningEnabledRodeoIds);
  if (!countsRes.ok) return { ok: false, error: countsRes.error };
  return { ok: true, value: applyCandidateGating(config, countsRes.value) };
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
