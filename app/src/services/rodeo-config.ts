// Capa de datos de la plantilla de datos del rodeo (spec 02 frontend, C1 / T3.6 — ADR-021).
//
// Queries DIRECTAS a Supabase con supabase-js (PowerSync es C5, diferido — los services son la
// ÚNICA capa que tocará PowerSync, design.md §retrofit). RLS protege server-side:
//   - field_definitions / system_default_fields: SELECT abierto a authenticated (catálogo global).
//   - rodeo_data_config: SELECT con has_role_in(rodeo.establishment_id); INSERT/UPDATE solo owner
//     (is_owner_of), sin DELETE de cliente (0018). El cliente no fuerza permisos: la RLS es la barrera.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id. El rodeo trae su
// establishment vía FK; la RLS deriva el acceso. Acá solo movemos data_keys + toggles.

import { supabase } from './supabase';
import type {
  FieldDefinition,
  SystemDefaultField,
  RodeoFieldConfig,
} from '../utils/rodeo-template';

export type { FieldDefinition, SystemDefaultField, RodeoFieldConfig } from '../utils/rodeo-template';

/** Error de servicio uniforme (mismo shape que services/establishments.ts). */
export type AppError = { kind: 'network' | 'unknown'; message: string };

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

function classifyError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

// ─── Catálogo global (read-only) ─────────────────────────────────────────────────

type FieldDefinitionRow = {
  id: string;
  data_key: string;
  label: string;
  description: string | null;
  category: string;
  data_type: string;
  ui_component: string | null;
};

function toFieldDefinition(r: FieldDefinitionRow): FieldDefinition {
  return {
    id: r.id,
    dataKey: r.data_key,
    label: r.label,
    description: r.description,
    category: r.category,
    dataType: r.data_type,
    uiComponent: r.ui_component,
  };
}

/**
 * Lee el catálogo global de datos tracqueables (field_definitions activos, R2.8). Read-only.
 * El orden visual lo decide groupTogglesByCategory (lógica pura); acá traemos crudo.
 */
export async function fetchFieldCatalog(): Promise<ServiceResult<FieldDefinition[]>> {
  const { data, error } = await supabase
    .from('field_definitions')
    .select('id, data_key, label, description, category, data_type, ui_component')
    .eq('active', true);

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as FieldDefinitionRow[];
  return { ok: true, value: rows.map(toFieldDefinition) };
}

// ─── Defaults por sistema (read-only) ─────────────────────────────────────────────

type SystemDefaultRow = {
  field_definition_id: string;
  default_enabled: boolean;
  required_for_system: boolean;
  sort_order: number;
};

/**
 * Lee los system_default_fields de un sistema (R2.9): qué datos vienen tildados/required y en
 * qué orden, para armar la plantilla del wizard. Read-only.
 */
export async function fetchSystemDefaults(
  systemId: string,
): Promise<ServiceResult<SystemDefaultField[]>> {
  const { data, error } = await supabase
    .from('system_default_fields')
    .select('field_definition_id, default_enabled, required_for_system, sort_order')
    .eq('system_id', systemId);

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as SystemDefaultRow[];
  return {
    ok: true,
    value: rows.map((r) => ({
      fieldDefinitionId: r.field_definition_id,
      defaultEnabled: r.default_enabled,
      requiredForSystem: r.required_for_system,
      sortOrder: r.sort_order,
    })),
  };
}

// ─── Estado efectivo por rodeo (mutable: owner) ───────────────────────────────────

type RodeoConfigRow = { field_definition_id: string; enabled: boolean };

/**
 * Lee el estado efectivo de la plantilla de un rodeo (rodeo_data_config, R2.10). RLS:
 * has_role_in(establishment del rodeo) → cualquier rol del campo lo lee (para mostrar la
 * plantilla read-only a no-owners y para el gating de spec 03).
 */
export async function fetchRodeoConfig(
  rodeoId: string,
): Promise<ServiceResult<RodeoFieldConfig[]>> {
  const { data, error } = await supabase
    .from('rodeo_data_config')
    .select('field_definition_id, enabled')
    .eq('rodeo_id', rodeoId);

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as RodeoConfigRow[];
  return {
    ok: true,
    value: rows.map((r) => ({ fieldDefinitionId: r.field_definition_id, enabled: r.enabled })),
  };
}

/**
 * Toggle de una fila EXISTENTE de rodeo_data_config (R2.12: UPDATE enabled). Owner-only por RLS
 * (is_owner_of). UPDATE SIN .select() (gotcha RLS-on-RETURNING, lección de spec 01) + count:'exact'
 * para distinguir "se actualizó" de "RLS lo bloqueó / no había fila" y reportar error accionable
 * en vez de un falso OK (un field_operator recibiría count=0).
 */
export async function toggleRodeoField(
  rodeoId: string,
  fieldDefinitionId: string,
  enabled: boolean,
): Promise<ServiceResult<void>> {
  const { error, count } = await supabase
    .from('rodeo_data_config')
    .update({ enabled }, { count: 'exact' })
    .eq('rodeo_id', rodeoId)
    .eq('field_definition_id', fieldDefinitionId);

  if (error) return { ok: false, error: classifyError(error) };
  if (count === 0) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'No se pudo cambiar el dato. Solo el dueño del campo puede ajustar la plantilla.',
      },
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Habilita un dato NO-default del sistema en el rodeo (R2.12: INSERT en rodeo_data_config con
 * enabled=true para un field que no tenía fila — caso "tambo + preñez"). Owner-only por RLS.
 * INSERT SIN .select() (gotcha RLS-on-RETURNING). El field existe en el catálogo global, así
 * que el FK no falla; si el caller intentara un field inexistente, el FK rechaza (23503).
 */
export async function enableNonDefaultField(
  rodeoId: string,
  fieldDefinitionId: string,
): Promise<ServiceResult<void>> {
  const { error } = await supabase
    .from('rodeo_data_config')
    .insert({ rodeo_id: rodeoId, field_definition_id: fieldDefinitionId, enabled: true });

  if (error) return { ok: false, error: classifyError(error) };
  return { ok: true, value: undefined };
}
