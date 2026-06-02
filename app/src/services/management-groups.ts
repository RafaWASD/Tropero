// Capa de datos de lotes / management_groups (ADR-020). En C2 solo necesitamos LEER los lotes
// activos del establishment para el selector opcional del form de alta (R4.5). El CRUD completo
// (crear/renombrar/borrar + asignar/agrupar) es C4 (spec 02 T3.7) — NO se implementa acá.
//
// RLS (0037): management_groups_select con has_role_in(establishment_id) + deleted_at is null.
// El cliente NO fuerza permisos; la RLS es la barrera. NUNCA se hardcodea establishment_id.

import { supabase } from './supabase';
import type { ServiceResult } from './animals';

export type ManagementGroup = {
  id: string;
  name: string;
};

type Row = { id: string; name: string };

function classifyError(error: { message?: string } | null): { kind: 'network' | 'unknown'; message: string } {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) return { kind: 'network', message: msg };
  return { kind: 'unknown', message: msg || 'Error desconocido' };
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
