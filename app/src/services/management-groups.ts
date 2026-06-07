// Capa de datos de lotes / management_groups (ADR-020). En C2 solo se LEÍAN los lotes activos del
// establishment para el selector opcional del form de alta (R4.5). C4 (spec 02 T3.7) agrega el CRUD
// completo (crear / renombrar / borrar) + asignar/quitar desde la ficha + ver miembros de un lote.
//
// Queries DIRECTAS a Supabase con supabase-js (PowerSync es C5, diferido — los services son la
// ÚNICA capa que tocará PowerSync; mantenerlos delgados y swappables). RLS protege server-side (0037):
//   - SELECT: has_role_in(establishment_id) + deleted_at is null → cualquier rol activo lee.
//   - INSERT/UPDATE de management_groups: is_owner_of → SOLO owner (crear/renombrar/borrar).
//   - ASIGNAR un animal a un lote = UPDATE de animal_profiles.management_group_id, cubierto por
//     animal_profiles_update (has_role_in) → cualquier rol operativo activo (R2.17).
//   - BORRAR (soft-delete) un lote NO se hace por UPDATE directo: vía el RPC SECURITY DEFINER
//     `soft_delete_management_group` (0041, owner-only). Ver el JSDoc de softDeleteManagementGroup.
// El cliente NO fuerza permisos; la RLS es la barrera real. NUNCA se hardcodea establishment_id
// (CLAUDE.md ppio 6): viene del EstablishmentContext.
//
// RLS-on-RETURNING gotcha (lección spec 01 B.1.2): la policy SELECT filtra `deleted_at is null`, así
// que NO usamos `.insert().select()` / `.update().select()` en un solo roundtrip (el RETURNING
// evaluaría SELECT sobre la fila antes de ser visible → vacío/403). Split write + read separados.
// El soft-delete es un caso particular del MISMO gotcha (el UPDATE vuelve la fila no-visible bajo la
// SELECT-policy `deleted_at is null` → 42501); por eso va por RPC y no por UPDATE directo (0041).

import { supabase } from './supabase';
import type { AnimalListItem, ServiceResult } from './animals';
import { fetchAnimals } from './animals';

export type ManagementGroup = {
  id: string;
  name: string;
};

type Row = { id: string; name: string };

function classifyError(error: { message?: string; code?: string } | null): { kind: 'network' | 'unknown'; message: string } {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) return { kind: 'network', message: msg };
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

// Copy es-AR del soft-delete de lote. NUNCA exponemos el sqlerrm/message crudo de Postgres al usuario
// (mismo criterio que classifyExitError de exit-animal.ts): el copy específico viaja en `message`.
const DELETE_COPY = {
  unauthorized: 'No se pudo eliminar el lote. Solo el dueño del campo puede hacerlo.',
  gone: 'El lote ya no existe o ya fue eliminado.',
  network: 'Sin conexión: no pudimos eliminar el lote. Conectate y volvé a intentar.',
  unknown: 'No se pudo eliminar el lote. Volvé a intentar.',
} as const;

/**
 * Clasifica el error del RPC `soft_delete_management_group` (migration 0041) a copy es-AR accionable.
 * El RPC lanza, por `errcode`:
 *   - 42501 → no es owner del establishment del lote → "solo el dueño puede".
 *   - P0002 → el lote no existe / ya fue soft-deleteado.
 * Más network (sin conexión) y cualquier otro → unknown genérico (nunca el message crudo).
 * Detecta primero la red por el MENSAJE (supabase-js no setea code en fallos de fetch).
 */
function classifyDeleteError(error: { message?: string; code?: string } | null): {
  kind: 'network' | 'unknown';
  message: string;
} {
  const msg = error?.message ?? '';
  const code = error?.code ?? '';
  if (/network|failed to fetch|fetch failed|networkerror/i.test(msg)) {
    return { kind: 'network', message: DELETE_COPY.network };
  }
  if (code === '42501') return { kind: 'unknown', message: DELETE_COPY.unauthorized };
  if (code === 'P0002') return { kind: 'unknown', message: DELETE_COPY.gone };
  return { kind: 'unknown', message: DELETE_COPY.unknown };
}

/**
 * Lista los lotes ACTIVOS (no soft-deleted) del establishment, para el selector "Lote" opcional
 * del alta (ADR-020 / R4.5). Orden por nombre (es-AR) para una lista estable.
 */
export async function fetchManagementGroups(
  establishmentId: string,
): Promise<ServiceResult<ManagementGroup[]>> {
  const { data, error } = await supabase
    .from('management_groups')
    .select('id, name')
    .eq('establishment_id', establishmentId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as Row[];
  return { ok: true, value: rows.map((r) => ({ id: r.id, name: r.name })) };
}

// ─── Crear lote (owner) ─────────────────────────────────────────────────────────────

/**
 * Crea un lote (R2.14/ADR-020, owner-only por RLS management_groups_insert = is_owner_of). El nombre
 * ya viene trimeado/validado por el caller (validateGroupName), pero re-trimeamos por defensa (el
 * CHECK management_groups_name_not_empty exige length(trim(name)) > 0). NUNCA se hardcodea
 * establishment_id: lo pasa el caller desde el EstablishmentContext.
 *
 * SPLIT insert + read (gotcha RLS-on-RETURNING): NO usamos `.insert().select()` — la policy SELECT
 * filtra `deleted_at is null` y el RETURNING podría no ver la fila. Insertamos SIN .select() y
 * recuperamos el lote diffeando el set ANTES/DESPUÉS (robusto ante nombres homónimos, igual que
 * createRodeo / createEstablishment). Online-only (C5 = PowerSync): sin red → kind:'network'.
 */
export async function createManagementGroup(
  establishmentId: string,
  name: string,
): Promise<ServiceResult<ManagementGroup>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El lote necesita un nombre.' } };
  }

  // SET de lotes ANTES del insert (para diffear el nuevo, robusto ante homónimos).
  const before = await fetchManagementGroups(establishmentId);
  if (!before.ok) return { ok: false, error: before.error };
  const beforeIds = new Set(before.value.map((g) => g.id));

  const { error: insertError } = await supabase.from('management_groups').insert({
    establishment_id: establishmentId,
    name: trimmed,
  });
  if (insertError) return { ok: false, error: classifyError(insertError) };

  const after = await fetchManagementGroups(establishmentId);
  if (!after.ok) return { ok: false, error: after.error };
  const created = after.value.find((g) => !beforeIds.has(g.id));
  if (!created) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo confirmar el lote recién creado.' },
    };
  }
  return { ok: true, value: created };
}

// ─── Renombrar lote (owner) ─────────────────────────────────────────────────────────

/**
 * Renombra un lote (R2.14, owner-only por RLS management_groups_update = is_owner_of). UPDATE SIN
 * .select() (gotcha RLS-on-RETURNING) + count:'exact' para distinguir "se actualizó" de "RLS lo
 * bloqueó / no había fila activa" (un no-owner recibiría count=0) y devolver un copy accionable en
 * vez de un falso OK. Filtra `deleted_at is null` (no se renombra un lote ya borrado).
 */
export async function renameManagementGroup(
  groupId: string,
  name: string,
): Promise<ServiceResult<void>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El lote necesita un nombre.' } };
  }

  const { error, count } = await supabase
    .from('management_groups')
    .update({ name: trimmed }, { count: 'exact' })
    .eq('id', groupId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: classifyError(error) };
  if (count === 0) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'No se pudo renombrar el lote. Solo el dueño del campo puede hacerlo.',
      },
    };
  }
  return { ok: true, value: undefined };
}

// ─── Borrar lote (owner) — reasignar miembros a NULL + soft-delete (D1) ───────────────

/**
 * Borra un lote (owner-only) reasignando primero sus animales a `management_group_id = NULL` y
 * soft-deleteando el lote DESPUÉS (D1 del context-c4-lotes).
 *
 * ⚠️ ORDEN OBLIGATORIO (anti-FK-colgante): PRIMERO `UPDATE animal_profiles SET management_group_id =
 * NULL WHERE management_group_id = <lote>` (los animales vuelven a agruparse por categoría, regla
 * ADR-020), DESPUÉS el soft-delete del lote. Nunca al revés: borrar-primero dejaría animales apuntando
 * a un lote ya filtrado por `deleted_at` (huérfano visible como "sin lote" en la ficha pero con FK
 * colgante en la fila). El paso 1 es un UPDATE directo y SÍ funciona vía PostgREST: no cambia la
 * visibilidad SELECT del perfil (no toca su `deleted_at`), así que no choca con el gotcha de abajo.
 *
 * ⚠️ El soft-delete NO se hace por UPDATE directo. Un `UPDATE management_groups SET deleted_at = now()`
 * vía PostgREST devuelve 42501: PostgREST exige que la fila siga visible bajo la policy de SELECT tras
 * el UPDATE, y la SELECT de management_groups filtra `deleted_at is null` → la fila sale de visibilidad
 * → rechazo (comportamiento ESPERADO, no un bug de RLS). El backend resuelve esto con el RPC
 * SECURITY DEFINER `soft_delete_management_group(p_group_id)` (migration 0041): re-valida owner-only y
 * hace el UPDATE por dentro (bypass de la verificación de visibilidad). El cliente solo lo invoca.
 *
 * ⚠️ NO ATÓMICO (clear-NULL directo + RPC, 2 pasos client-side, online, C4) — MISMO criterio que la
 * no-atomicidad del split insert de createAnimal. Si el RPC (paso 2) falla, los animales ya quedaron
 * en NULL y el lote sigue vivo: estado CONSISTENTE (no corrupto) y RECUPERABLE — el owner reintenta el
 * borrado (el clear-NULL es idempotente). La atomicidad real llega con C5/PowerSync.
 *
 * El error del RPC se mapea con classifyDeleteError: 42501 (no es owner) y P0002 (lote inexistente /
 * ya borrado) → copy es-AR accionable, nunca el sqlerrm crudo. La reasignación a NULL (paso 1) la
 * permite cualquier rol operativo (animal_profiles_update); el RPC del paso 2 rechaza a quien no sea
 * owner con 42501 → copy "solo el dueño" sin haber corrompido nada (los animales ya están en NULL).
 */
export async function softDeleteManagementGroup(groupId: string): Promise<ServiceResult<void>> {
  // Paso 1: reasignar a NULL los animales de ESTE lote (cualquier estado, incluidos archivados —
  // un animal vendido que apuntaba al lote tampoco debe quedar con FK colgante). NO filtramos por
  // status acá: el FK debe quedar limpio en TODA fila que apuntaba al lote. UPDATE directo OK (no
  // cambia la visibilidad SELECT del perfil → sin gotcha RLS-on-RETURNING).
  const { error: clearError } = await supabase
    .from('animal_profiles')
    .update({ management_group_id: null })
    .eq('management_group_id', groupId);
  if (clearError) return { ok: false, error: classifyError(clearError) };

  // Paso 2: soft-delete del lote vía RPC SECURITY DEFINER (owner-only, 0041). NO por UPDATE directo
  // (daría 42501 por el gotcha de visibilidad SELECT — ver JSDoc). El RPC tira 42501 si no es owner,
  // P0002 si el lote no existe → classifyDeleteError los traduce a copy es-AR.
  const { error: delError } = await supabase.rpc('soft_delete_management_group', {
    p_group_id: groupId,
  });
  if (delError) return { ok: false, error: classifyDeleteError(delError) };
  return { ok: true, value: undefined };
}

// ─── Asignar / quitar lote desde la ficha (cualquier rol operativo) ───────────────────

/**
 * Asigna un animal a un lote, o lo QUITA (`groupId = null` → management_group_id NULL, vuelve a
 * agruparse por categoría). Es un UPDATE de animal_profiles.management_group_id (R2.17): lo permite
 * cualquier rol operativo activo (animal_profiles_update = has_role_in). El trigger 0037
 * (tg_animal_profiles_management_group_check) valida server-side que el lote sea del MISMO
 * establishment del perfil (no se puede asignar un lote de otro campo).
 *
 * UPDATE SIN .select() (gotcha RLS-on-RETURNING) + count:'exact' para distinguir el bloqueo de RLS /
 * perfil inexistente (count=0) de un éxito. Filtra `deleted_at is null` (no se asigna a un perfil
 * soft-deleted). Un error del trigger (lote de otro est / borrado) cae en classifyError → copy es-AR.
 */
export async function assignAnimalToGroup(
  profileId: string,
  groupId: string | null,
): Promise<ServiceResult<void>> {
  const { error, count } = await supabase
    .from('animal_profiles')
    .update({ management_group_id: groupId }, { count: 'exact' })
    .eq('id', profileId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: classifyError(error) };
  if (count === 0) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'No se pudo cambiar el lote del animal. Volvé a intentar.',
      },
    };
  }
  return { ok: true, value: undefined };
}

// ─── Miembros de un lote (ver-miembros, D3) ───────────────────────────────────────────

/**
 * Lista los animales ACTIVOS de un lote (D3): `management_group_id = <lote>` AND `status = 'active'`
 * AND `deleted_at IS NULL`, reusando fetchAnimals (mismo SELECT/scoping que la tab Animales, que ya
 * filtra por establishment + active + deleted_at vía RLS). El `establishmentId` viene del contexto
 * activo (NUNCA hardcodeado); RLS lo re-scopea igual. Devuelve AnimalListItem[] para reusar AnimalRow.
 *
 * Implementado en términos de fetchAnimals (no una query nueva) para no duplicar el SELECT/joins ni el
 * mapeo, y para que el swap a PowerSync (C5) sea localizado. fetchAnimals no expone un filtro por
 * management_group_id, así que pedimos los activos del establishment y filtramos client-side por el
 * lote. Aceptable para rodeos de cientos (la tab ya trae hasta 200); un filtro server-side por
 * management_group_id es refinamiento posterior si hiciera falta.
 */
export async function fetchGroupMembers(
  establishmentId: string,
  groupId: string,
): Promise<ServiceResult<AnimalListItem[]>> {
  const r = await fetchAnimals(establishmentId, { status: 'active' });
  if (!r.ok) return r;
  return { ok: true, value: r.value.filter((a) => a.managementGroupId === groupId) };
}
