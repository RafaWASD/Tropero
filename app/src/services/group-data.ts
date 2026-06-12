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
import { buildBulkCandidates, type GroupProfile } from '../utils/bulk-candidates';
import { fetchFieldCatalog } from './rodeo-config';
import { fetchRodeoConfig } from './rodeo-config';
import type { ServiceResult } from './rodeo-config';
import type { AnimalListItem } from './animals';
import {
  buildRodeoHeadCountsQuery,
  buildGroupHeadCountsQuery,
  buildGroupCandidateFlagsQuery,
  toBool,
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
 * Trae los flags de candidatura (is_castrated / has_weaning) de los animales del grupo, del SQLite local
 * (offline), y los mergea con la forma `GroupProfile` que `buildBulkCandidates` necesita. El categoryCode
 * / sex / futureBull / rodeoId / status ya vienen del `AnimalListItem` (la lista del grupo, espejo C6
 * aplicado); is_castrated / has_weaning / category_override NO los expone la lista → query batched.
 * category_override no afecta la candidatura (solo el aviso R5.6), pero lo traemos por completitud del
 * GroupProfile. Animales sin flag (no debería pasar — son del grupo) caen a `false` (fail-closed: un
 * castrado-desconocido NO suma como candidato de castración recién si is_castrated=false; conservador).
 */
async function fetchGroupProfilesForCounts(
  animals: readonly AnimalListItem[],
): Promise<ServiceResult<GroupProfile[]>> {
  if (animals.length === 0) return { ok: true, value: [] };
  const flagsRes = await runLocalQuery<{
    id: string;
    is_castrated: number | boolean | null;
    category_override: number | boolean | null;
    has_weaning: number | boolean | null;
  }>(buildGroupCandidateFlagsQuery(animals.map((a) => a.profileId)), { emptyIsSyncing: false });
  if (!flagsRes.ok) return { ok: false, error: flagsRes.error };

  const flagsById = new Map<string, { isCastrated: boolean; hasWeaning: boolean; categoryOverride: boolean }>();
  for (const row of flagsRes.value) {
    flagsById.set(row.id, {
      isCastrated: toBool(row.is_castrated),
      hasWeaning: toBool(row.has_weaning),
      categoryOverride: toBool(row.category_override),
    });
  }

  const profiles = animals.map((a): GroupProfile => {
    const f = flagsById.get(a.profileId);
    return {
      profileId: a.profileId,
      rodeoId: a.rodeoId,
      sex: a.sex,
      categoryCode: a.categoryCode,
      isCastrated: f?.isCastrated ?? false,
      futureBull: a.futureBull,
      hasWeaning: f?.hasWeaning ?? false,
      status: a.status,
      deletedAt: null, // la lista ya filtró deleted_at IS NULL (R1.3); el armado lo re-chequea igual
      categoryOverride: f?.categoryOverride ?? false,
    };
  });
  return { ok: true, value: profiles };
}

/**
 * Conteos de candidatos del grupo (castración / destete) para el gating por presencia (fix Raf 2026-06-12).
 * `rodeoWeaningEnabled` excluye del conteo de destete a los terneros cuyo rodeo no tiene `destete` (lote
 * cross-rodeo, R7.2) — para un rodeo único el predicado es uniforme. PURO sobre los perfiles ya cargados.
 */
function countCandidates(
  profiles: readonly GroupProfile[],
  rodeoWeaningEnabled?: (rodeoId: string) => boolean,
): GroupCandidateCounts {
  return {
    castrate: buildBulkCandidates('castrate', profiles).candidates.length,
    wean: buildBulkCandidates('wean', profiles, { rodeoWeaningEnabled }).candidates.length,
  };
}

/**
 * Acciones masivas disponibles para la vista de UN RODEO (R1.5 + gating por candidatos, fix Raf 2026-06-12):
 * Vacunar/Destetar según el `rodeo_data_config` de ese rodeo; Castrar/Destetar además requieren ≥1 candidato.
 * `animals` = los activos del rodeo (ya cargados por el loader). Lee del SQLite local (offline). La config es
 * FAIL-SOFT (si no se lee → config-off, pero Castrar se gatea igual por candidatos); solo falla duro si la
 * query de flags de candidatura no se pudo leer (entonces el loader cae a su fallback fail-closed).
 */
export async function fetchRodeoGroupActions(
  rodeoId: string,
  animals: readonly AnimalListItem[],
): Promise<ServiceResult<GroupActionsAvailability>> {
  // Config FAIL-SOFT: si no se pudo leer el catálogo/config (SQLite local), degradamos a config-off
  // (vaccinate/wean apagadas, fail-closed) PERO seguimos al gating por candidatos — así Castrar (que NO
  // depende de config, R1.5) sigue ofreciéndose si hay candidatos. El conteo es el camino que sí puede
  // fallar duro (lo necesitamos para gatear). weaningEnabled de fallback = false (config desconocida).
  const catalog = await fetchDataKeyToFieldId();
  const gating = catalog.ok ? await fetchRodeoGating(rodeoId, catalog.value) : null;
  const rodeoGating: RodeoGating = gating?.ok ? gating.value : { vaccinationEnabled: false, weaningEnabled: false };
  const config = resolveGroupActions([rodeoGating]);

  const profilesRes = await fetchGroupProfilesForCounts(animals);
  if (!profilesRes.ok) return { ok: false, error: profilesRes.error };
  // Rodeo único: el destete de TODOS los terneros se gatea por la config de ESTE rodeo (predicado uniforme).
  const counts = countCandidates(profilesRes.value, () => rodeoGating.weaningEnabled);
  return { ok: true, value: applyCandidateGating(config, counts) };
}

/**
 * Acciones masivas disponibles para la vista de un LOTE cross-rodeo (R7.1 + gating por candidatos, fix Raf
 * 2026-06-12): Vacunar/Destetar si ALGÚN rodeo representado entre los miembros tiene el data_key habilitado;
 * Castrar/Destetar además requieren ≥1 candidato. `animals` = los activos del lote (ya cargados por el
 * loader); de ahí salen los rodeos reales (R7.1) Y los perfiles para el conteo de candidatos. El destete
 * cuenta SOLO terneros cuyo rodeo real tiene `destete` (R7.2). Lee la config de cada rodeo del SQLite local
 * (offline). Si el lote no tiene miembros → todas las acciones quedan apagadas (sin candidatos ni rodeos).
 */
export async function fetchLoteGroupActions(
  animals: readonly AnimalListItem[],
): Promise<ServiceResult<GroupActionsAvailability>> {
  const distinct = [...new Set(animals.map((a) => a.rodeoId))];
  if (distinct.length === 0) {
    // Lote sin miembros: sin rodeos (config off) y sin candidatos → todas apagadas.
    return { ok: true, value: applyCandidateGating(resolveGroupActions([]), { castrate: 0, wean: 0 }) };
  }
  // Config FAIL-SOFT (igual que el rodeo): si no se puede leer el catálogo/config, degradamos a config-off
  // y dejamos que el gating por candidatos rija Castrar. weaningEnabled de fallback = false por rodeo.
  const catalog = await fetchDataKeyToFieldId();

  // Gating por rodeo: lo necesitamos para la config (R7.1, "algún rodeo") Y para el predicado de destete
  // por rodeo del conteo de candidatos (R7.2, "solo terneros de rodeo con destete").
  const gatingByRodeo = new Map<string, RodeoGating>();
  for (const rodeoId of distinct) {
    const g = catalog.ok ? await fetchRodeoGating(rodeoId, catalog.value) : null;
    gatingByRodeo.set(rodeoId, g?.ok ? g.value : { vaccinationEnabled: false, weaningEnabled: false });
  }
  const config = resolveGroupActions([...gatingByRodeo.values()]);

  const profilesRes = await fetchGroupProfilesForCounts(animals);
  if (!profilesRes.ok) return { ok: false, error: profilesRes.error };
  // Destete por rodeo (R7.2): un ternero solo cuenta como candidato si SU rodeo real tiene `destete`.
  const counts = countCandidates(
    profilesRes.value,
    (rodeoId) => gatingByRodeo.get(rodeoId)?.weaningEnabled ?? false,
  );
  return { ok: true, value: applyCandidateGating(config, counts) };
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
