// Capa de datos de la PANTALLA DE SELECCIÓN MASIVA (spec 10, T-UI.4 / R11.x). Resuelve, para un grupo
// (rodeo o lote), los perfiles con la forma que necesitan los utils PUROS de Fase 2 (bulk-candidates /
// bulk-selection): la candidatura (`GroupProfile`) MÁS los datos de display por animal (idv/visual/tag/
// edad — para la fila AnimalRow compacta).
//
// La categoría que decide la candidatura es la del ESPEJO C6 (offline-correct): la trae fetchAnimals /
// fetchGroupMembers (ya aplican el mirror). Los 3 flags que la fila NO expone (is_castrated, has_weaning,
// category_override) se traen batched (buildGroupCandidateFlagsQuery) y se mergean por profileId. Todo del
// SQLite local (offline-first, spec 15). NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6).
//
// La AUTORIZACIÓN no vive acá: las masivas se re-validan server-side por RLS al subir cada mutación
// (design §5). Este service solo DECIDE qué se muestra como candidato — no es el control de acceso.

import type { GroupProfile } from '../utils/bulk-candidates';
import type { AnimalSex } from '../utils/animal-category';
import { fetchAnimals, type AnimalListItem, type ServiceResult } from './animals';
import { fetchGroupMembers } from './management-groups';
import { buildGroupCandidateFlagsQuery, toBool } from './powersync/local-reads';
import { runLocalQuery } from './powersync/local-query';

export type { ServiceResult } from './animals';

/** Identidad del grupo sobre el que se arma la selección (rodeo o lote + su id). */
export type GroupRef = { groupType: 'rodeo' | 'lote'; groupId: string };

/**
 * Un candidato de la pantalla de selección: lo que `GroupProfile` necesita (candidatura PURA) + los datos
 * de DISPLAY de la fila (AnimalRow compacto). El componente lee los de display; los utils puros leen los
 * de `GroupProfile`. Extiende `GroupProfile` para pasarlo directo a buildBulkCandidates/buildBulkSelection.
 */
export type GroupSelectionProfile = GroupProfile & {
  /** Caravana oficial / IDV (identificador hero de la fila). */
  idv: string | null;
  /** Nombre/Apodo del animal (delta IDU: reemplaza visual_id_alt). null = sin apodo. */
  apodo: string | null;
  /** ¿El rodeo del animal habilita el campo apodo? (para el hero por nombre en la fila compacta). */
  rodeoUsesApodo: boolean;
  /** Caravana electrónica (null → sin caravana). */
  tagElectronic: string | null;
  /** Sexo NO-null para la fila (AnimalRow exige male|female; un perfil sin sexo no es candidato igual). */
  rowSex: AnimalSex;
  /** Nombre legible de la categoría (del espejo C6) para la fila. */
  categoryName: string;
  /** Fecha de nacimiento ISO (o null) → la fila calcula la edad con formatAnimalAge. */
  animalBirthDate: string | null;
};

/**
 * Trae los perfiles del grupo en la forma de selección (candidatura + display), del SQLite local. Para un
 * RODEO: fetchAnimals(establishmentId, { rodeoId, status:'active' }). Para un LOTE: fetchGroupMembers
 * (mismo SELECT, filtrado por management_group_id). Ambos ya aplican el espejo C6 → categoryCode/Name son
 * los offline-correct. Luego mergea los 3 flags de candidatura (is_castrated/has_weaning/category_override)
 * batched. Si el grupo no tiene animales activos → lista vacía (no es error).
 */
export async function fetchGroupSelectionProfiles(
  establishmentId: string,
  group: GroupRef,
): Promise<ServiceResult<GroupSelectionProfile[]>> {
  const listRes =
    group.groupType === 'rodeo'
      ? await fetchAnimals(establishmentId, { rodeoId: group.groupId, status: 'active' })
      : await fetchGroupMembers(establishmentId, group.groupId);
  if (!listRes.ok) return { ok: false, error: listRes.error };

  const items = listRes.value;
  if (items.length === 0) return { ok: true, value: [] };

  // Los 3 flags que AnimalListItem no expone (is_castrated/has_weaning/category_override), batched.
  const flagsRes = await runLocalQuery<{
    id: string;
    is_castrated: number | boolean | null;
    category_override: number | boolean | null;
    has_weaning: number | boolean | null;
  }>(buildGroupCandidateFlagsQuery(items.map((a) => a.profileId)), { emptyIsSyncing: false });
  if (!flagsRes.ok) return { ok: false, error: flagsRes.error };

  const flagsById = new Map<string, { isCastrated: boolean; hasWeaning: boolean; categoryOverride: boolean }>();
  for (const row of flagsRes.value) {
    flagsById.set(row.id, {
      isCastrated: toBool(row.is_castrated),
      hasWeaning: toBool(row.has_weaning),
      categoryOverride: toBool(row.category_override),
    });
  }

  const profiles = items.map((a) => toSelectionProfile(a, flagsById.get(a.profileId)));
  return { ok: true, value: profiles };
}

/** Mergea un AnimalListItem (display + categoría C6) con sus flags de candidatura. Flags ausentes → false. */
function toSelectionProfile(
  a: AnimalListItem,
  flags: { isCastrated: boolean; hasWeaning: boolean; categoryOverride: boolean } | undefined,
): GroupSelectionProfile {
  return {
    profileId: a.profileId,
    rodeoId: a.rodeoId,
    sex: a.sex,
    categoryCode: a.categoryCode,
    isCastrated: flags?.isCastrated ?? false,
    futureBull: a.futureBull,
    hasWeaning: flags?.hasWeaning ?? false,
    status: a.status,
    deletedAt: null, // la lista ya filtró deleted_at IS NULL (R1.3); el armado lo re-chequea igual
    categoryOverride: flags?.categoryOverride ?? false,
    // Display
    idv: a.idv,
    apodo: a.apodo,
    rodeoUsesApodo: a.rodeoUsesApodo,
    tagElectronic: a.tagElectronic,
    rowSex: a.sex,
    categoryName: a.categoryName,
    animalBirthDate: a.animalBirthDate,
  };
}
