// Capa de datos de PRESETS de maniobra (spec 03 M1.3 — tabla `maneuver_presets` 0051).
//
// Un preset = una combinación guardada de maniobras + pre-config (R2.1), scope ESTABLISHMENT (R2.4:
// compartido por los usuarios del campo). Offline-first: `id` de cliente (R2.5), CRUD-PLANO sobre la tabla
// SINCRONIZADA (igual que sessions.ts / management-groups.ts).
//
// ESCRITURA OFFLINE:
//   - createPreset / updatePreset: CRUD plano (INSERT/UPDATE local → runLocalWrite → 1 CrudEntry →
//     uploadData). La RLS (maneuver_presets_insert/_update = has_role_in) + el CHECK de name no-vacío
//     (0051) re-validan al SUBIR. `created_by` lo fuerza el trigger.
//   - softDeletePreset: RPC-bound (OUTBOX) — un `UPDATE maneuver_presets SET deleted_at = now()` por
//     PostgREST devuelve 42501 (la fila sale de la SELECT-policy `deleted_at is null` tras el UPDATE,
//     gotcha RLS-on-RETURNING). El backend lo resuelve con la RPC SECURITY DEFINER
//     `soft_delete_maneuver_preset` (0057, has_role_in — cualquier rol operativo activo). Por eso va por
//     la outbox (intent → RPC al subir), NO por CRUD plano. Molde idéntico a softDeleteManagementGroup.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id — lo pasa el caller (contexto activo).
//
// loadPreset (R2.3): al cargar un preset sobre un rodeo, las maniobras cuyo data_key está OFF en ese rodeo
// se FILTRAN (no se ofrecen) y se devuelven como `omitted` para que la UI avise — sin bloquear el resto.
// Reusa el gating PURO (maneuver-gating.ts) sobre el rodeo_data_config cacheado (fetchRodeoGating).

import { fetchRodeoGating } from './rodeo-config';
import { filterApplicableManeuvers, type ManeuverKind } from '../utils/maneuver-gating';
import {
  parseManeuverConfig,
  extractManeuvers,
  type ManeuverConfig,
} from '../utils/maneuver-config';
import {
  buildCreateManeuverPresetInsert,
  buildUpdateManeuverPresetUpdate,
  buildManeuverPresetsQuery,
  buildManeuverPresetByIdQuery,
} from './powersync/local-reads';
import { runLocalWrite, runLocalQuery, runLocalQuerySingle } from './powersync/local-query';
import { enqueueSoftDelete } from './powersync/outbox';

// ─── Error / Result uniforme (mismo shape que sessions.ts) ───────────────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** El snapshot de un preset (jsonb pass-through, mismo shape que sessions.config). */
export type PresetConfig = ManeuverConfig;

/** Un preset leído del SQLite local. `config` ya parseado del TEXT a objeto. */
export type ManeuverPreset = {
  id: string;
  name: string;
  config: PresetConfig;
};

// Fila cruda local. config: string JSON (INSERT local) U objeto (jsonb materializado al bajar del server);
// parseManeuverConfig tolera ambas (round-trip server↔local — mismo fix que sessions.ts).
type PresetRow = { id: string; name: string; config: unknown };

function toPreset(r: PresetRow): ManeuverPreset {
  return { id: r.id, name: r.name, config: parseManeuverConfig(r.config) };
}

// ─── Crear preset (R2.1/R2.4/R2.5) ────────────────────────────────────────────────────

export type CreatePresetInput = {
  /** Establishment activo (del contexto). NUNCA hardcodeado (R2.4 scope establishment). */
  establishmentId: string;
  /** Nombre del preset. Re-trimeamos (el CHECK maneuver_presets_name_not_empty exige no-vacío). */
  name: string;
  /** Snapshot de la jornada (maniobras + pre-config). Pass-through jsonb. Default {}. */
  config?: PresetConfig;
};

/**
 * Crea un preset LOCAL (R2.1, offline) → upload queue. `id` de CLIENTE (R2.5) → devolvemos el preset
 * recién creado SIN re-leer. `name` re-trimeado (defensa contra el CHECK del DB). `config` serializado
 * tal cual (pass-through). La RLS (maneuver_presets_insert = has_role_in) + el `created_by` forzado
 * re-validan al subir. Contrato T5: el local write siempre devuelve ok; el reject va por status.
 */
export async function createPreset(input: CreatePresetInput): Promise<ServiceResult<ManeuverPreset>> {
  const name = input.name.trim();
  if (name.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El preset necesita un nombre.' } };
  }
  const id = randomUuid();
  const config = input.config ?? {};
  const r = await runLocalWrite(
    buildCreateManeuverPresetInsert(id, input.establishmentId, name, JSON.stringify(config)),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: { id, name, config } };
}

// ─── Editar preset (renombrar + reconfigurar) ─────────────────────────────────────────

/**
 * Edita un preset LOCAL (renombrar + reconfigurar, offline) → upload queue. Filtra `deleted_at IS NULL`
 * (no se edita un preset borrado). `name` re-trimeado. La RLS (maneuver_presets_update = has_role_in)
 * re-valida al subir. Contrato T5.
 */
export async function updatePreset(
  id: string,
  name: string,
  config: PresetConfig,
): Promise<ServiceResult<true>> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El preset necesita un nombre.' } };
  }
  const r = await runLocalWrite(
    buildUpdateManeuverPresetUpdate(id, trimmed, JSON.stringify(config)),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Borrar preset (soft-delete vía RPC 0057, OUTBOX) ─────────────────────────────────

/**
 * Soft-deletea un preset (cualquier rol operativo activo — has_role_in, R2.4). RPC-bound (OUTBOX): el
 * soft-delete por RPC SECURITY DEFINER `soft_delete_maneuver_preset` (0057) sortea el gotcha
 * RLS-on-RETURNING (un UPDATE plano de deleted_at saca la fila de la SELECT-policy → 42501). OFFLINE-first:
 * el preset DESAPARECE de la lista al instante (overlay pending_status_overrides effect='soft_deleted');
 * al SUBIR, uploadData llama supabase.rpc('soft_delete_maneuver_preset', { p_preset_id }). Idempotencia
 * natural: un reintento levanta P0002 (ya borrado) → descarte idempotente; un 42501 (sin rol) → rollback
 * del overlay (re-aparece) + superficia. Molde idéntico a softDeleteManagementGroup.
 */
export async function softDeletePreset(presetId: string): Promise<ServiceResult<true>> {
  const enq = await enqueueSoftDelete({
    entity: 'maneuver_preset',
    targetId: presetId,
    params: { p_preset_id: presetId },
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };
  return { ok: true, value: true };
}

// ─── Listar presets al tope de la pantalla de inicio (R2.2) ───────────────────────────

/**
 * Lista los presets ACTIVOS del establishment (R2.2: al tope de la pantalla de inicio), desde el SQLite
 * local. El scoping (has_role_in) ya lo aplicó la stream; el `deleted_at IS NULL` se conserva defensivo.
 * Orden por nombre. emptyIsSyncing default true: un campo sin presets aún sincronizando degrada a
 * "Sincronizando" — pero un campo legítimamente sin presets también vendría vacío. Como la pantalla de
 * inicio igual ofrece "nueva jornada", usamos emptyIsSyncing:false: "no hay presets" es válido (sin presets
 * al tope, solo el botón de nueva jornada).
 */
export async function fetchPresets(
  establishmentId: string,
): Promise<ServiceResult<ManeuverPreset[]>> {
  const r = await runLocalQuery<PresetRow>(buildManeuverPresetsQuery(establishmentId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value.map(toPreset) };
}

// ─── Cargar un preset sobre un rodeo (R2.3 — filtra maniobras gateadas OFF) ────────────

/** El resultado de cargar un preset en un rodeo: las maniobras aplicables + las omitidas (para avisar). */
export type LoadPresetResult = {
  preset: ManeuverPreset;
  /** Las maniobras del preset que SÍ aplican en el rodeo (todas sus data_keys enabled). Orden preservado. */
  maniobras: ManeuverKind[];
  /** Las maniobras del preset que se OMITIERON por la config del rodeo (R2.3: la UI las avisa). */
  omitted: ManeuverKind[];
};

/**
 * Carga un preset y lo RESUELVE contra un rodeo (R2.3): lee el preset por id (local), extrae sus maniobras
 * válidas, fetchea el gating del rodeo (rodeo_data_config cacheado) y FILTRA las maniobras cuyo data_key
 * está OFF en ese rodeo (reusa el gating PURO). Devuelve las aplicables + las omitidas (para que la UI
 * avise "se omitió X por la configuración del rodeo") sin bloquear el resto del preset.
 *
 * Devuelve error si el preset no existe (o está borrado). Si el gating del rodeo no se puede leer
 * (p. ej. aún sincronizando) propaga ese error (la UI lo trata como transitorio).
 */
export async function loadPreset(
  presetId: string,
  rodeoId: string,
): Promise<ServiceResult<LoadPresetResult>> {
  const presetRow = await runLocalQuerySingle<PresetRow>(buildManeuverPresetByIdQuery(presetId), {
    emptyIsSyncing: false,
  });
  if (!presetRow.ok) {
    return { ok: false, error: { kind: presetRow.error.kind, message: presetRow.error.message } };
  }
  if (!presetRow.value) {
    return { ok: false, error: { kind: 'unknown', message: 'No encontramos ese preset.' } };
  }
  const preset = toPreset(presetRow.value);
  const wanted = extractManeuvers(preset.config);

  const gating = await fetchRodeoGating(rodeoId);
  if (!gating.ok) return { ok: false, error: gating.error };

  const { applicable, omitted } = filterApplicableManeuvers(wanted, gating.value);
  return { ok: true, value: { preset, maniobras: applicable, omitted } };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

/** UUID v4 de cliente (R2.5). crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
