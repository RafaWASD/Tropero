// Capa de datos de la plantilla de datos del rodeo (spec 02 frontend, C1 / T3.6 — ADR-021).
//
// LECTURAS (spec 15, T3.1): desde el SQLite local de PowerSync (catálogos sincronizados por las
// streams). `fetchFieldCatalog`/`fetchSystemDefaults`/`fetchRodeoConfig` leen local; el scoping de
// tenant (has_role_in del rodeo, catálogo global) ya lo aplicó la stream al sincronizar → NO se
// re-filtra acá. Los SQL builders puros viven en powersync/local-reads.ts (testeables sin SDK).
// EDICIÓN de plantilla: ahora es OFFLINE-first (spec 15, T9.9) — `editar-plantilla.tsx` encola
// `enqueueSetRodeoConfig` (RPC `set_rodeo_config` 0082 + overlay `pending_rodeo_data_config`), NO
// escribe acá. Las viejas escrituras ONLINE de este módulo (`toggleRodeoField`/`enableNonDefaultField`,
// UPDATE/INSERT directos a rodeo_data_config vía PostgREST) se REMOVIERON en T9.9: sin callers y
// rotas sin red. RLS server-side sigue protegiendo rodeo_data_config (INSERT/UPDATE solo owner
// is_owner_of, sin DELETE de cliente — 0018; la RPC 0082 espeja esa authz). Este módulo quedó
// read-only (solo lecturas locales).
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id. El rodeo trae su
// establishment vía FK; la RLS/stream derivan el acceso.

import {
  buildFieldCatalogQuery,
  buildSystemDefaultsQuery,
  buildRodeoConfigQuery,
  toBool,
} from './powersync/local-reads';
import { runLocalQuery } from './powersync/local-query';
import type {
  FieldDefinition,
  SystemDefaultField,
  RodeoFieldConfig,
} from '../utils/rodeo-template';

export type { FieldDefinition, SystemDefaultField, RodeoFieldConfig } from '../utils/rodeo-template';

/** Error de servicio uniforme (mismo shape que services/establishments.ts). */
export type AppError = { kind: 'network' | 'unknown'; message: string };

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

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
 * Lee el catálogo global de datos tracqueables (field_definitions activos, R2.8). Read-only,
 * desde el SQLite local (T3.1/R5.4). El orden visual lo decide groupTogglesByCategory (lógica pura);
 * acá traemos crudo. Si el primer sync aún no ocurrió y no hay catálogo local → degrada "Sincronizando…".
 */
export async function fetchFieldCatalog(): Promise<ServiceResult<FieldDefinition[]>> {
  const r = await runLocalQuery<FieldDefinitionRow>(buildFieldCatalogQuery());
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map(toFieldDefinition) };
}

// ─── Defaults por sistema (read-only) ─────────────────────────────────────────────

// SQLite guarda los booleanos como 0/1 (column.integer en AppSchema) → toBool los coerce de vuelta.
type SystemDefaultRow = {
  field_definition_id: string;
  default_enabled: number | boolean;
  required_for_system: number | boolean;
  sort_order: number;
};

/**
 * Lee los system_default_fields de un sistema (R2.9): qué datos vienen tildados/required y en
 * qué orden, para armar la plantilla del wizard. Read-only, desde el SQLite local (T3.1).
 */
export async function fetchSystemDefaults(
  systemId: string,
): Promise<ServiceResult<SystemDefaultField[]>> {
  const r = await runLocalQuery<SystemDefaultRow>(buildSystemDefaultsQuery(systemId));
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    value: r.value.map((row) => ({
      fieldDefinitionId: row.field_definition_id,
      defaultEnabled: toBool(row.default_enabled),
      requiredForSystem: toBool(row.required_for_system),
      sortOrder: row.sort_order,
    })),
  };
}

// ─── Estado efectivo por rodeo (read-only; la edición va por outbox, T9.9) ─────────

// `enabled` es 0/1 en SQLite (column.integer) → toBool lo coerce.
type RodeoConfigRow = { field_definition_id: string; enabled: number | boolean };

/**
 * Lee el estado efectivo de la plantilla de un rodeo (rodeo_data_config, R2.10) desde el SQLite
 * local (T3.1). El scoping (has_role_in del establecimiento del rodeo) ya lo aplicó la stream → no
 * se re-filtra. Cualquier rol del campo lo lee (plantilla read-only para no-owners + gating de spec 03).
 * El trigger tg_rodeos_seed_data_config (0018) pre-pobla la config en el INSERT del rodeo, así que un
 * rodeo sincronizado siempre trae filas; vacío + sin primer sync → degrada "Sincronizando…".
 */
export async function fetchRodeoConfig(
  rodeoId: string,
): Promise<ServiceResult<RodeoFieldConfig[]>> {
  const r = await runLocalQuery<RodeoConfigRow>(buildRodeoConfigQuery(rodeoId));
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    value: r.value.map((row) => ({
      fieldDefinitionId: row.field_definition_id,
      enabled: toBool(row.enabled),
    })),
  };
}
