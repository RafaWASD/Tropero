// Capa de datos de lotes / management_groups (ADR-020). En C2 solo se LEÍAN los lotes activos del
// establishment para el selector opcional del form de alta (R4.5). C4 (spec 02 T3.7) agregó el CRUD
// completo (crear / renombrar / borrar) + asignar/quitar desde la ficha + ver miembros de un lote.
//
// SWAP PowerSync (spec 15): LECTURAS desde el SQLite local (T4.3, fetchManagementGroups/fetchGroupMembers).
// ESCRITURAS SIMPLES (T5.2, CRUD plano OFFLINE): createManagementGroup (INSERT local), renameManagementGroup
// (UPDATE local), assignAnimalToGroup (UPDATE local) → `getPowerSync().execute(...)` vía runLocalWrite →
// PowerSync encola UNA CrudEntry → connector.uploadData() la sube al reconectar. La autorización real la
// valida la RLS al SUBIR (0037), NO el write local (R6.3/R8.1):
//   - INSERT/UPDATE de management_groups: is_owner_of → SOLO owner (crear/renombrar). Un no-owner es
//     rechazado al subir (descartado + superficiado por uploadData), NO por el return del service.
//   - ASIGNAR = UPDATE de animal_profiles.management_group_id, cubierto por animal_profiles_update
//     (has_role_in) → cualquier rol operativo activo (R2.17); el tenant-check del lote lo valida el
//     trigger 0037 al subir.
//   - BORRAR (soft-delete) un lote es RPC-bound (T6, NO swapeado acá): sigue ONLINE vía el RPC SECURITY
//     DEFINER `soft_delete_management_group` (0041, owner-only) — sortea el gotcha RLS-on-RETURNING del
//     soft-delete (el UPDATE de deleted_at saca la fila de la SELECT-policy → 42501). Ver softDelete.
// El cliente NO fuerza permisos; la RLS es la barrera real. NUNCA se hardcodea establishment_id
// (CLAUDE.md ppio 6): viene del EstablishmentContext.
//
// R6.3 — el gotcha RLS-on-RETURNING DESAPARECE en las escrituras simples: con escritura LOCAL la lectura
// post-escritura es una query SQLite (no roundtrip, no RETURNING que evalúe la SELECT-policy `deleted_at
// is null`) → se ELIMINARON el diff before/after de create y el `count:'exact'` de assign/rename. El
// id de cliente (R6.4) deja devolver el lote recién creado sin re-leer.

import type { AnimalListItem, ServiceResult } from './animals';
import { fetchAnimals } from './animals';
import {
  buildManagementGroupsQuery,
  buildCreateManagementGroupInsert,
  buildRenameManagementGroupUpdate,
  buildAssignAnimalToGroupUpdate,
  buildClearGroupMembersUpdate,
} from './powersync/local-reads';
import { runLocalQuery, runLocalWrite } from './powersync/local-query';
import { enqueueSoftDelete } from './powersync/outbox';

export type ManagementGroup = {
  id: string;
  name: string;
};

type Row = { id: string; name: string };

// Con el swap a OUTBOX (T6), el soft-delete de lote ya NO clasifica el error de la RPC en el return: el
// encolado SIEMPRE tiene éxito offline y el rechazo REAL (42501 no-owner, P0002 ya-borrado) lo resuelve
// uploadData al SUBIR (P0002 → descarte idempotente; 42501 → rollback del overlay + superficia, R8.1) — NO
// por el return de softDeleteManagementGroup. Por eso se eliminaron classifyError/classifyDeleteError/DELETE_COPY.

/**
 * Lista los lotes ACTIVOS (no soft-deleted) del establishment, para el selector "Lote" opcional del
 * alta (ADR-020 / R4.5), desde el SQLite local (T4.3/R5.1). El scoping (has_role_in + deleted_at del
 * campo) ya lo aplicó la stream est_management_groups → NO se re-filtra; SÍ se conservan los filtros de
 * DOMINIO `active = 1` + `deleted_at IS NULL` (defensivo). Orden por nombre (es-AR) para una lista
 * estable. emptyIsSyncing default true: un campo sin lotes aún sincronizando degrada a "Sincronizando".
 */
export async function fetchManagementGroups(
  establishmentId: string,
): Promise<ServiceResult<ManagementGroup[]>> {
  const r = await runLocalQuery<Row>(buildManagementGroupsQuery(establishmentId));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value.map((row) => ({ id: row.id, name: row.name })) };
}

// ─── Crear lote (owner) ─────────────────────────────────────────────────────────────

/**
 * Crea un lote LOCAL (R2.14/ADR-020, offline) → upload queue. id de CLIENTE (R6.4) → devolvemos el lote
 * recién creado SIN re-leer (la fila ya está en SQLite local; la lista local la verá al instante). El
 * nombre ya viene trimeado/validado por el caller (validateGroupName), re-trimeamos por defensa (el
 * CHECK management_groups_name_not_empty exige length(trim(name)) > 0). NUNCA se hardcodea
 * establishment_id: lo pasa el caller desde el EstablishmentContext.
 *
 * R6.3: se ELIMINA el split insert + diff before/after — con escritura LOCAL ya no hay roundtrip ni
 * RETURNING que evalúe la SELECT-policy `deleted_at is null`. Owner-only lo valida la RLS al SUBIR
 * (management_groups_insert = is_owner_of): un no-owner es rechazado allí (descartado + superficiado por
 * uploadData, R8.1) — NO por el return de acá (que ya devolvió ok con la fila local). Contrato T5.
 */
export async function createManagementGroup(
  establishmentId: string,
  name: string,
): Promise<ServiceResult<ManagementGroup>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El lote necesita un nombre.' } };
  }

  const id = randomUuid();
  const r = await runLocalWrite(buildCreateManagementGroupInsert(id, establishmentId, trimmed));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: { id, name: trimmed } };
}

// ─── Renombrar lote (owner) ─────────────────────────────────────────────────────────

/**
 * Renombra un lote LOCAL (R2.14, offline) → upload queue. UPDATE local que filtra `deleted_at is null`
 * (no se renombra un lote ya borrado). R6.3: se ELIMINA el `count:'exact'` — con escritura LOCAL el
 * UPDATE siempre "tiene éxito" offline. Owner-only lo valida la RLS al SUBIR (management_groups_update =
 * is_owner_of): un no-owner es rechazado allí (descartado + superficiado por uploadData, R8.1) — NO por
 * el return de acá. Contrato T5: el local write siempre devuelve ok; el reject de upload va por status.
 */
export async function renameManagementGroup(
  groupId: string,
  name: string,
): Promise<ServiceResult<void>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El lote necesita un nombre.' } };
  }

  const r = await runLocalWrite(buildRenameManagementGroupUpdate(groupId, trimmed));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: undefined };
}

// ─── Borrar lote (owner) — reasignar miembros a NULL + soft-delete (D1) ───────────────

/**
 * Borra un lote (owner-only) reasignando primero sus animales a `management_group_id = NULL` y
 * soft-deleteando el lote DESPUÉS (D1 del context-c4-lotes).
 *
 * ⚠️ ORDEN OBLIGATORIO (anti-FK-colgante): PRIMERO se reasignan a NULL los management_group_id de los
 * perfiles del lote (los animales vuelven a agruparse por categoría, regla ADR-020), DESPUÉS el
 * soft-delete del lote. El FIFO de la upload queue lo preserva: el UPDATE local del paso 1 se encola
 * ANTES del op_intent del paso 2, así que al subir corren en ese orden. Nunca al revés: borrar-primero
 * dejaría animales apuntando a un lote ya filtrado por `deleted_at` (FK colgante).
 *
 * ⚠️ El soft-delete NO se hace por UPDATE plano. Un `UPDATE management_groups SET deleted_at = now()`
 * vía PostgREST devuelve 42501 (la fila sale de la SELECT-policy `deleted_at is null` tras el UPDATE) —
 * gotcha RLS-on-RETURNING. El backend lo resuelve con el RPC SECURITY DEFINER
 * `soft_delete_management_group(p_group_id)` (0041, owner-only). Por eso el paso 2 va por la OUTBOX
 * (intent → RPC al subir), NO por CRUD plano.
 *
 * OFFLINE-FIRST (T6.2f): ambos pasos son LOCALES y devuelven ok offline al instante. La autorización
 * real (owner-only del paso 2) la valida la RPC al SUBIR; un rechazo (42501) → uploadData rollbackea el
 * overlay (el lote re-aparece) + superficia (R8.1). Si el paso 2 ya corrió (reintento at-least-once) →
 * P0002 → descarte idempotente. NO ATÓMICO entre los 2 pasos (igual que online): si el paso 2 se
 * rechaza, los animales ya quedaron en NULL — estado CONSISTENTE y recuperable (el clear-NULL es idempotente).
 */
export async function softDeleteManagementGroup(groupId: string): Promise<ServiceResult<void>> {
  // OFFLINE-FIRST (T6.2f): el borrado de lote es una op (b) RPC-bound (el soft-delete por RPC SECURITY
  // DEFINER, owner-only, sortea el gotcha RLS-on-RETURNING — 0041). Dos pasos, AMBOS offline:
  //
  // Paso 1: reasignar a NULL los management_group_id de TODOS los perfiles del lote (anti-FK-colgante,
  // cualquier estado incl. archivados). Es CRUD PLANO sobre la tabla SINCRONIZADA → un UPDATE local
  // (runLocalWrite) que genera su propia CrudEntry → uploadData lo sube como UPDATE. Los animales vuelven
  // a agruparse por categoría al instante, offline. La RLS (animal_profiles_update = has_role_in) lo
  // re-valida al subir.
  const clear = await runLocalWrite(buildClearGroupMembersUpdate(groupId));
  if (!clear.ok) return { ok: false, error: { kind: clear.error.kind, message: clear.error.message } };

  // Paso 2: encolar el soft-delete del lote vía la OUTBOX (intent soft_delete_management_group + overlay
  // pending_status_overrides effect='soft_deleted'). El lote DESAPARECE de la lista al instante (UNION
  // oculta los soft_deleted pendientes). Al SUBIR (FIFO, después del clear-NULL del paso 1), uploadData
  // llama supabase.rpc('soft_delete_management_group', { p_group_id }). Idempotencia natural: un reintento
  // levanta P0002 (lote ya borrado) → descarte idempotente sin rollback (§5.4.3(4)). Un rechazo 42501 (no
  // owner) → rollback del overlay (el lote re-aparece) + superficia (R8.1).
  const enq = await enqueueSoftDelete({
    entity: 'management_group',
    targetId: groupId,
    params: { p_group_id: groupId },
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };
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
 * UPDATE LOCAL (offline) → upload queue. Filtra `deleted_at is null` (no se asigna a un perfil
 * soft-deleted). R6.3: se ELIMINA el `count:'exact'` — con escritura LOCAL el UPDATE siempre "tiene
 * éxito" offline. El tenant-check del lote (mismo establishment del perfil, trigger 0037) lo valida
 * server-side al SUBIR (un lote de otro campo o borrado es rechazado allí + superficiado por uploadData,
 * R8.1) — NO por el return de acá. Contrato T5: el local write siempre devuelve ok.
 */
export async function assignAnimalToGroup(
  profileId: string,
  groupId: string | null,
): Promise<ServiceResult<void>> {
  const r = await runLocalWrite(buildAssignAnimalToGroupUpdate(profileId, groupId));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
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
 * mapeo, y para que el swap a PowerSync sea localizado. Como fetchAnimals YA lee del SQLite local
 * (T4.1), fetchGroupMembers lee local automáticamente (sin tocar acá). fetchAnimals no expone un filtro
 * por management_group_id, así que pedimos los activos del establishment y filtramos client-side por el
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

// ─── Helpers ──────────────────────────────────────────────────────────────────────

/** UUID v4 de cliente (R6.4). crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
