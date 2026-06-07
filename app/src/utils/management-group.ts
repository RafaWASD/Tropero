// Lógica PURA de lotes (management_groups, ADR-020 / spec 02 C4). SIN I/O, SIN imports de
// RN/expo/supabase: testeable con node:test (mismo patrón que utils/establishment.ts ↔
// services/establishment-store.ts, exit-animal.ts). La I/O vive en services/management-groups.ts.
//
// Acá: la validación del nombre del lote (el CHECK del DB es `length(trim(name)) > 0`; el cliente
// la pre-valida para un copy es-AR accionable ANTES del roundtrip) + el gating de UI por rol
// (owner-only para crear/renombrar/borrar; cualquier rol operativo para asignar).

import type { UserRole } from '../types';

/** Tope defensivo del largo del nombre de lote (texto libre, ADR-020; evita pegar basura sin fin). */
export const MANAGEMENT_GROUP_NAME_MAX = 80;

export type NameValidation = { ok: true; value: string } | { ok: false; error: string };

/**
 * Valida el nombre de un lote ANTES de mandarlo al DB (el CHECK management_groups_name_not_empty
 * exige length(trim(name)) > 0). Trimea; vacío → error accionable; demasiado largo → error. PURA.
 * Devuelve el nombre YA trimeado en `value` (lo que se persiste), para no re-trimear en el caller.
 */
export function validateGroupName(raw: string): NameValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'El lote necesita un nombre.' };
  }
  if (trimmed.length > MANAGEMENT_GROUP_NAME_MAX) {
    return { ok: false, error: `El nombre no puede tener más de ${MANAGEMENT_GROUP_NAME_MAX} caracteres.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * ¿Puede este rol GESTIONAR lotes (crear / renombrar / borrar)? Solo `owner` (RLS 0037:
 * management_groups_insert/update con is_owner_of). La RLS es la barrera autoritativa; esto solo
 * evita ofrecer botones muertos en la UI (honestidad, no seguridad). PURA.
 */
export function canManageGroups(role: UserRole | null): boolean {
  return role === 'owner';
}

/**
 * ¿Puede este rol ASIGNAR un animal a un lote (incluido quitar → NULL)? Cualquier rol operativo
 * activo (RLS: la asignación es un UPDATE de animal_profiles.management_group_id vía
 * animal_profiles_update / has_role_in, R2.17). Cubre owner, field_operator y veterinarian. PURA.
 */
export function canAssignGroup(role: UserRole | null): boolean {
  return role === 'owner' || role === 'field_operator' || role === 'veterinarian';
}
