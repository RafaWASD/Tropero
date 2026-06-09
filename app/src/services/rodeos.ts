// Capa de datos de rodeos (spec 02 frontend, C1 — swap a PowerSync en spec 15).
//
// OFFLINE-FIRST (spec 15): las LECTURAS (fetchProductionSystems/fetchRodeos) leen del SQLite local de
// PowerSync (las streams ya scopearon por establecimiento). Las ESCRITURAS van por la OUTBOX: createRodeo
// encola un intent `create_rodeo` → RPC server-side (0081) + overlay optimista (Run T9.8); softDeleteRodeo
// encola un intent `soft_delete_rodeo` → RPC (T6). La RLS/RPC siguen siendo la barrera real al SUBIR
// (rodeos_insert/create_rodeo = owner-only is_owner_of, 0017/0081; un field_operator es rechazado allí).
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id ni species/system. El
// establishment viene del contexto activo; species_id/system_id se resuelven por `code` (no se
// hardcodea el UUID del sistema — se busca 'bovino'/'cria' por code en las tablas de catálogo, ahora local).

import {
  computeConfigDiff,
  buildEffectiveConfigRows,
  type SystemDefaultField,
  type TemplateToggle,
} from '../utils/rodeo-template';
import {
  fetchSystemDefaults,
  type AppError,
  type ServiceResult,
} from './rodeo-config';
import {
  buildSpeciesByCodeQuery,
  buildSystemsBySpeciesQuery,
  buildSystemByCodeQuery,
  buildRodeosQuery,
  toBool,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle } from './powersync/local-query';
import { enqueueSoftDelete, enqueueCreateRodeo, newClientOpId } from './powersync/outbox';

export type { AppError, ServiceResult } from './rodeo-config';

// ─── Sistemas productivos disponibles (paso 1 del wizard) ─────────────────────────

/** Un sistema productivo para la especie elegida (paso 1 del wizard, R2.6). */
export type ProductionSystem = {
  systemId: string;
  speciesId: string;
  code: string;
  name: string;
  /** true → seleccionable; false → grisado con badge "Próximamente" (R2.4 / MVP solo cría). */
  active: boolean;
};

// `active` es 0/1 en SQLite (column.integer) → toBool lo coerce.
type SystemRow = {
  id: string;
  species_id: string;
  code: string;
  name: string;
  active: number | boolean;
};

type SpeciesIdRow = { id: string };

/**
 * Lista los sistemas productivos de una especie (por `code`, default 'bovino') para el paso 1
 * del wizard, desde el SQLite local (T3.1; catálogo global sincronizado por catalog_species/
 * catalog_systems). Trae TODOS (activos e inactivos) para grisar los no-MVP con badge "Próximamente".
 * NO hardcodea el UUID de la especie: lo resuelve por code (2 queries locales: species → systems).
 * Si el catálogo aún no sincronizó (species no encontrada + sin primer sync) → degrada "Sincronizando…".
 */
export async function fetchProductionSystems(
  speciesCode = 'bovino',
): Promise<ServiceResult<ProductionSystem[]>> {
  const spRes = await runLocalQuerySingle<SpeciesIdRow>(buildSpeciesByCodeQuery(speciesCode), {
    emptyIsSyncing: true,
  });
  if (!spRes.ok) return { ok: false, error: spRes.error };
  if (!spRes.value) {
    return { ok: false, error: { kind: 'unknown', message: `Especie "${speciesCode}" no disponible.` } };
  }

  const r = await runLocalQuery<SystemRow>(buildSystemsBySpeciesQuery(spRes.value.id));
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    value: r.value.map((row) => ({
      systemId: row.id,
      speciesId: row.species_id,
      code: row.code,
      name: row.name,
      active: toBool(row.active),
    })),
  };
}

// ─── Rodeos del establecimiento ───────────────────────────────────────────────────

export type Rodeo = {
  id: string;
  establishmentId: string;
  name: string;
  speciesId: string;
  systemId: string;
  active: boolean;
};

// `active` es 0/1 en SQLite (column.integer); de PostgREST viene boolean → toBool unifica ambos.
type RodeoRow = {
  id: string;
  establishment_id: string;
  name: string;
  species_id: string;
  system_id: string;
  active: number | boolean;
};

function toRodeo(r: RodeoRow): Rodeo {
  return {
    id: r.id,
    establishmentId: r.establishment_id,
    name: r.name,
    speciesId: r.species_id,
    systemId: r.system_id,
    active: toBool(r.active),
  };
}

/**
 * Lista los rodeos ACTIVOS (no soft-deleted, active=true) de un establecimiento, desde el SQLite
 * local (T3.3/R5.1). El scoping (has_role_in + deleted_at is null, 0017) ya lo aplicó la stream
 * est_rodeos al sincronizar → no se re-filtra; SÍ conservamos el filtro de DOMINIO `active = true`
 * (excluye rodeos desactivados) + `deleted_at IS NULL` (defensivo). Orden preservado: created_at ASC.
 * Cualquier rol del campo los ve (lista read-only para no-owners, R2.3).
 *
 * Lo consume RodeoContext. Tras un createRodeo OFFLINE (Run T9.8), el rodeo recién creado aparece acá al
 * instante: buildRodeosQuery UNIONa pending_rodeos (el rodeo alta-optimista) → no hace falta re-leer online.
 */
export async function fetchRodeos(establishmentId: string): Promise<ServiceResult<Rodeo[]>> {
  const r = await runLocalQuery<RodeoRow>(buildRodeosQuery(establishmentId));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map(toRodeo) };
}

// ─── Crear rodeo (owner) ──────────────────────────────────────────────────────────

export type CreateRodeoInput = {
  establishmentId: string;
  name: string;
  /** code del sistema productivo elegido (paso 1). Default 'cria' (MVP). */
  systemCode?: string;
  speciesCode?: string;
  /** Toggles tal como quedaron tras el paso 3 del wizard (para diffear contra los defaults). */
  toggles: TemplateToggle[];
};

/**
 * Crea un rodeo OFFLINE-FIRST (R2.2 / R5.1, owner-only) vía la OUTBOX (Run T9.8). Raf pidió explícito que
 * crear rodeo funcione sin red (offline-first sin excepciones). A diferencia de createManagementGroup (INSERT
 * plano → CRUD plano offline en T5), crear un rodeo arma una PLANTILLA de datos (`rodeo_data_config`): el
 * trigger server-side `tg_rodeos_seed_data_config` (0018) seedea los defaults del sistema + se aplica el diff
 * de toggles, y `rodeo_data_config` tiene PK COMPUESTA (read-only-local). Por eso va por una RPC atómica
 * server-side `create_rodeo` (0081) + outbox + overlay optimista (mismo patrón que register_birth/exit).
 *
 * Flujo:
 *   1. Generar el `id` del rodeo en el CLIENTE (R6.4): la RPC lo reusa por ON CONFLICT → idempotente at-least-once.
 *   2. Resolver species_id / system_id por `code` DESDE LOCAL (catálogo sincronizado). No hardcodear el UUID.
 *   3. Computar el DIFF de toggles (computeConfigDiff) contra los system_default_fields LOCALES → el array
 *      `p_toggles` de la RPC (la plantilla que el usuario eligió, sobre los defaults que el trigger seedea).
 *   4. Encolar la intención `create_rodeo` (params de la RPC) + el efecto optimista:
 *        - pending_rodeos (el rodeo, con el id de cliente) → aparece en la lista al instante;
 *        - pending_rodeo_data_config (la PLANTILLA EFECTIVA computada en el cliente: los toggles del wizard
 *          —defaults con su estado final— + los no-defaults habilitados del diff) → "editar plantilla"/el
 *          form dinámico la ven al instante, offline.
 *      Al SUBIR, create_rodeo crea el rodeo (el trigger 0018 seedea la config) + UPSERTea los toggles ATÓMICO
 *      server-side; el ACK limpia el overlay y las filas reales bajan por est_rodeos / est_rodeo_data_config.
 *
 * R11.1: firma pública intacta (devuelve ServiceResult<Rodeo> con el rodeo optimista). El rechazo REAL
 * (no-owner 42501 / system inválido) lo resuelve uploadData al SUBIR (rollback del overlay + superficia por el
 * canal de status, R8.1) — NO el return (offline-first: el encolado SIEMPRE tiene éxito si hay catálogo local).
 */
export async function createRodeo(
  input: CreateRodeoInput,
): Promise<ServiceResult<Rodeo>> {
  const speciesCode = input.speciesCode ?? 'bovino';
  const systemCode = input.systemCode ?? 'cria';
  const name = input.name.trim();

  if (name.length === 0) {
    return { ok: false, error: { kind: 'unknown', message: 'El rodeo necesita un nombre.' } };
  }

  // 1) Resolver species_id por code DESDE LOCAL (catálogo global sincronizado). No hardcodeamos el UUID.
  //    emptyIsSyncing: si el catálogo aún no bajó (primer login sin red) → degrada "Sincronizando…".
  const spRes = await runLocalQuerySingle<{ id: string }>(buildSpeciesByCodeQuery(speciesCode), {
    emptyIsSyncing: true,
  });
  if (!spRes.ok) return { ok: false, error: spRes.error };
  if (!spRes.value) {
    return { ok: false, error: { kind: 'unknown', message: `Especie "${speciesCode}" no disponible.` } };
  }
  const speciesId = spRes.value.id;

  // Resolver system_id por (species_id, code) ACTIVO DESDE LOCAL (R2.4). La RPC + el trigger lo re-validan
  // server-side al subir; acá filtramos para un error claro antes de encolar.
  const sysRes = await runLocalQuerySingle<{ id: string }>(
    buildSystemByCodeQuery(speciesId, systemCode),
    { emptyIsSyncing: true },
  );
  if (!sysRes.ok) return { ok: false, error: sysRes.error };
  if (!sysRes.value) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'Ese sistema productivo todavía no está disponible.' },
    };
  }
  const systemId = sysRes.value.id;

  // 2) Computar el DIFF de toggles del usuario contra los system_default_fields LOCALES (computeConfigDiff):
  //    es el array p_toggles que la RPC aplica (los fields que el usuario dejó distinto del default + los
  //    no-defaults habilitados). Si no pudimos leer los defaults (no sincronizó), encolamos SIN toggles → el
  //    rodeo queda con la plantilla default del trigger (el usuario la ajusta luego en "editar plantilla").
  const defaultsResult = await fetchSystemDefaults(systemId);
  const defaults = defaultsResult.ok ? (defaultsResult.value as SystemDefaultField[]) : [];
  const diffOps = defaultsResult.ok ? computeConfigDiff(input.toggles, defaults) : [];
  // p_toggles: { field_definition_id, enabled } por cada op del diff (update o insert). La RPC UPSERTea.
  const pToggles = diffOps.map((op) => ({
    field_definition_id: op.fieldDefinitionId,
    enabled: op.enabled,
  }));

  // 3) PLANTILLA EFECTIVA optimista (overlay): la que "editar plantilla"/el form dinámico muestran offline,
  //    espejando lo que el trigger 0018 + la RPC dejarían. = los toggles del wizard (defaults con su estado
  //    final) + los no-defaults habilitados del diff. Solo si pudimos leer los defaults; si no, no escribimos
  //    config optimista (la real bajará por la stream al subir — la lista del rodeo igual aparece).
  const configRows = defaultsResult.ok ? buildEffectiveConfigRows(input.toggles, diffOps) : [];

  const rodeoId = newClientOpId(); // uuid de cliente (R6.4): la RPC lo reusa por ON CONFLICT (idempotente).

  // 4) Encolar la intención create_rodeo + el overlay (rodeo + plantilla). Offline el rodeo Y su plantilla
  //    aparecen al instante (UNION en buildRodeosQuery / buildRodeoConfigQuery).
  const enq = await enqueueCreateRodeo({
    rodeoId,
    params: {
      p_id: rodeoId,
      p_establishment_id: input.establishmentId,
      p_name: name,
      p_species_id: speciesId,
      p_system_id: systemId,
      p_toggles: pToggles,
    },
    overlay: {
      establishmentId: input.establishmentId,
      name,
      speciesId,
      systemId,
    },
    configRows,
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };

  // Devolvemos el rodeo OPTIMISTA (firma pública intacta, R11.1). active=true (recién creado).
  return {
    ok: true,
    value: { id: rodeoId, establishmentId: input.establishmentId, name, speciesId, systemId, active: true },
  };
}

// ─── Soft-delete (owner) ────────────────────────────────────────────────────────

/**
 * Soft-delete de un rodeo OFFLINE-FIRST (R2.5, owner-only) vía la OUTBOX (T6.2f). RECONCILIACIÓN: la
 * versión previa hacía un UPDATE directo `deleted_at = now()` con `count:'exact'` — pero ese UPDATE plano
 * de `deleted_at` vía PostgREST/upload sería RECHAZADO (42501) por el gotcha RLS-on-RETURNING (la fila sale
 * de la SELECT-policy `deleted_at is null`). El soft-delete DEBE ir por el RPC SECURITY DEFINER
 * `soft_delete_rodeo(p_rodeo_id)` (0041, owner-only; rechaza con 23514 si el rodeo tiene animal_profiles
 * activos, R2.5). Por eso ahora se encola un intent `soft_delete_rodeo` + overlay pending_status_overrides
 * (effect='soft_deleted'): el rodeo DESAPARECE de la lista al instante (UNION oculta los soft_deleted).
 *
 * Al SUBIR, uploadData llama supabase.rpc('soft_delete_rodeo', { p_rodeo_id }). Idempotencia natural: un
 * reintento levanta P0002 (rodeo ya borrado) → descarte idempotente sin rollback (§5.4.3(4)). Un rechazo
 * (42501 no-owner / 23514 con animales activos) → rollback del overlay (el rodeo re-aparece) + superficia
 * (R8.1). La firma pública (ServiceResult<void>) NO cambia (R11.1).
 */
export async function softDeleteRodeo(rodeoId: string): Promise<ServiceResult<void>> {
  const enq = await enqueueSoftDelete({
    entity: 'rodeo',
    targetId: rodeoId,
    params: { p_rodeo_id: rodeoId },
  });
  if (!enq.ok) return { ok: false, error: { kind: 'unknown', message: enq.error.message } };
  return { ok: true, value: undefined };
}
