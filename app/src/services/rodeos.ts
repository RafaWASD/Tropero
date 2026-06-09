// Capa de datos de rodeos (spec 02 frontend, C1 — nuevo service).
//
// Queries DIRECTAS a Supabase con supabase-js (PowerSync es C5, diferido). RLS protege
// server-side (0017): SELECT con has_role_in(establishment_id); INSERT/UPDATE solo owner
// (is_owner_of). El cliente no fuerza permisos — la RLS es la barrera real (un field_operator
// que intentara crear/borrar recibe 0 filas afectadas / error, R2.3).
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id ni species/system. El
// establishment viene del contexto activo; species_id/system_id se resuelven por `code` (no se
// hardcodea el UUID del sistema — se busca 'bovino'/'cria' por code en las tablas de catálogo).

import { supabase } from './supabase';
import { computeConfigDiff, type SystemDefaultField, type TemplateToggle } from '../utils/rodeo-template';
import {
  fetchSystemDefaults,
  toggleRodeoField,
  enableNonDefaultField,
  type AppError,
  type ServiceResult,
} from './rodeo-config';
import {
  buildSpeciesByCodeQuery,
  buildSystemsBySpeciesQuery,
  buildRodeosQuery,
  toBool,
} from './powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle } from './powersync/local-query';

export type { AppError, ServiceResult } from './rodeo-config';

function classifyError(error: { message?: string; code?: string } | null): AppError {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

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
 * Lo consume RodeoContext. NOTA: createRodeo NO usa esta lectura para su diff before/after (sería
 * incorrecto: su INSERT es ONLINE y la fila vuelve al SQLite local recién por la stream, async); usa
 * fetchRodeosOnline (helper interno PostgREST) para ver su propia escritura de inmediato — ver allí.
 */
export async function fetchRodeos(establishmentId: string): Promise<ServiceResult<Rodeo[]>> {
  const r = await runLocalQuery<RodeoRow>(buildRodeosQuery(establishmentId));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value.map(toRodeo) };
}

/**
 * Lectura ONLINE del set de rodeos (PostgREST) — uso INTERNO de createRodeo para diffear su propio
 * INSERT de inmediato (la fila recién creada NO está aún en el SQLite local; baja por la stream
 * async). Mantiene el comportamiento ONLINE de createRodeo en T3 (el swap a outbox/overlay es T5/T6).
 * Misma query/filtros/orden que la versión PostgREST original de fetchRodeos.
 */
async function fetchRodeosOnline(establishmentId: string): Promise<ServiceResult<Rodeo[]>> {
  const { data, error } = await supabase
    .from('rodeos')
    .select('id, establishment_id, name, species_id, system_id, active')
    .eq('establishment_id', establishmentId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: classifyError(error) };
  const rows = (data ?? []) as RodeoRow[];
  return { ok: true, value: rows.map(toRodeo) };
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
 * Crea un rodeo (R2.2, owner-only por RLS) y aplica el diff de la plantilla de datos.
 *
 * Flujo:
 *   1. Resolver species_id / system_id por `code` (no hardcodear el UUID — buscar en catálogo).
 *   2. ⚠️ SPLIT insert + select (gotcha RLS-on-RETURNING, lección de spec 01 B.1.2): NO usar
 *      .insert().select() — el RETURNING evalúa rodeos_select (has_role_in) sobre la fila antes
 *      de que sea visible, riesgo de 403. Insertamos SIN .select() y recuperamos el id diffeando
 *      el set de rodeos del establishment ANTES/DESPUÉS (robusto ante nombres duplicados, igual
 *      que createEstablishment). El trigger tg_rodeos_seed_data_config (0018) pre-pobla
 *      rodeo_data_config con los defaults del sistema en el mismo INSERT.
 *   3. Aplicar el diff de toggles del usuario (computeConfigDiff) sobre rodeo_data_config:
 *      UPDATE para defaults que cambiaron, INSERT para no-defaults habilitados. Best-effort
 *      reportable: si una op falla, devolvemos el rodeo creado igual (no lo deshacemos —
 *      revertir un INSERT con trigger es frágil) pero señalamos el fallo parcial al caller.
 *
 * R9.2: crear rodeo es operación administrativa ONLINE (como crear campo). Sin red → kind:'network'.
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

  // 1) Resolver species_id por code (catálogo). No hardcodeamos el UUID.
  const { data: species, error: spErr } = await supabase
    .from('species')
    .select('id')
    .eq('code', speciesCode)
    .eq('active', true)
    .maybeSingle();
  if (spErr) return { ok: false, error: classifyError(spErr) };
  if (!species) {
    return { ok: false, error: { kind: 'unknown', message: `Especie "${speciesCode}" no disponible.` } };
  }

  // Resolver system_id por (species_id, code) — debe estar activo (R2.4; el trigger DB lo
  // re-valida igual, pero filtramos acá para un error claro antes del insert).
  const { data: system, error: sysErr } = await supabase
    .from('systems_by_species')
    .select('id')
    .eq('species_id', species.id)
    .eq('code', systemCode)
    .eq('active', true)
    .maybeSingle();
  if (sysErr) return { ok: false, error: classifyError(sysErr) };
  if (!system) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'Ese sistema productivo todavía no está disponible.' },
    };
  }

  // 2) SET de rodeos ANTES del insert (para diffear el nuevo después, robusto ante homónimos).
  // ONLINE (fetchRodeosOnline) — createRodeo es online en T3 y debe ver su propio INSERT al instante;
  // la versión local de fetchRodeos no lo reflejaría hasta que la stream sincronice (async).
  const before = await fetchRodeosOnline(input.establishmentId);
  if (!before.ok) return { ok: false, error: before.error };
  const beforeIds = new Set(before.value.map((r) => r.id));

  // Insert SIN .select() — ver nota arriba (RLS-on-RETURNING → 403). El trigger pre-pobla config.
  const { error: insertError } = await supabase.from('rodeos').insert({
    establishment_id: input.establishmentId,
    name,
    species_id: species.id,
    system_id: system.id,
  });
  if (insertError) return { ok: false, error: classifyError(insertError) };

  // SELECT separado (ONLINE): el id que aparece ahora y NO estaba antes es el rodeo nuevo.
  const after = await fetchRodeosOnline(input.establishmentId);
  if (!after.ok) return { ok: false, error: after.error };
  const created = after.value.find((r) => !beforeIds.has(r.id));
  if (!created) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se pudo confirmar el rodeo recién creado.' },
    };
  }

  // 3) Aplicar el diff de toggles sobre la config pre-poblada por el trigger.
  // Necesitamos los defaults del sistema para saber qué fields tienen fila (UPDATE) vs cuáles
  // hay que insertar (no-default habilitado).
  const defaultsResult = await fetchSystemDefaults(system.id);
  if (defaultsResult.ok) {
    const ops = computeConfigDiff(input.toggles, defaultsResult.value as SystemDefaultField[]);
    for (const op of ops) {
      const r =
        op.kind === 'update'
          ? await toggleRodeoField(created.id, op.fieldDefinitionId, op.enabled)
          : await enableNonDefaultField(created.id, op.fieldDefinitionId);
      if (!r.ok) {
        // El rodeo SÍ se creó (con la plantilla default del trigger). Una op de ajuste falló:
        // no deshacemos el rodeo (revertir un INSERT con trigger es frágil); reportamos para que
        // la UI avise "rodeo creado, revisá la plantilla" sin perder el rodeo.
        return {
          ok: false,
          error: {
            kind: r.error.kind,
            message:
              'El rodeo se creó, pero no pudimos guardar todos los ajustes de la plantilla. Revisala en "Editar plantilla".',
          },
        };
      }
    }
  }
  // Si no pudimos leer los defaults (red), el rodeo igual quedó con la plantilla default del
  // trigger; preferimos devolver OK sobre el rodeo creado a tumbarlo por no leer los defaults.

  return { ok: true, value: created };
}

// ─── Soft-delete (owner) ────────────────────────────────────────────────────────

/**
 * Soft-delete de un rodeo (R2.5, owner-only): set deleted_at = now(). RLS rodeos_update es
 * is_owner_of. Si el rodeo tiene animal_profiles activos, el backend lo rechaza (R2.5 — el
 * constraint/trigger DB; acá reportamos el error). UPDATE SIN .select() + count:'exact' para
 * distinguir bloqueo de RLS (count=0) de éxito.
 *
 * Nota: el chequeo de "tiene animales activos" lo enforce el backend (R2.5). En MVP, antes de
 * que C2 cargue animales, ningún rodeo tiene perfiles, así que el soft-delete pasa. Cuando C2
 * exista, un rodeo con animales activos devolverá el error del backend, que clasificamos como
 * 'unknown' con su message (el caller lo muestra).
 */
export async function softDeleteRodeo(rodeoId: string): Promise<ServiceResult<void>> {
  const { error, count } = await supabase
    .from('rodeos')
    .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', rodeoId)
    .is('deleted_at', null);

  if (error) return { ok: false, error: classifyError(error) };
  if (count === 0) {
    return {
      ok: false,
      error: {
        kind: 'unknown',
        message: 'No se pudo eliminar el rodeo. Solo el dueño del campo puede hacerlo.',
      },
    };
  }
  return { ok: true, value: undefined };
}
