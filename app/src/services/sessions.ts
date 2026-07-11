// Capa de datos de SESIONES de maniobra (spec 03 M1.2 — jornada de manga, tabla `sessions` 0050).
//
// Una sesión = una jornada de manga = un rodeo (R1.1). Es entidad persistida offline-first (R1.10/R1.11):
// `id` de cliente (crypto.randomUUID), CRUD-PLANO sobre la tabla SINCRONIZADA (igual que events.ts /
// management-groups.ts). NO es un "lote" (eso es management_groups, ADR-020) — la sesión solo agrupa
// eventos por `session_id`.
//
// ESCRITURA OFFLINE — CRUD plano (spec 15): createSession (INSERT local), closeSession/setWorkLotLabel/
// setSessionCounts (UPDATE local) → runLocalWrite → 1 CrudEntry → connector.uploadData() la sube al
// reconectar. La fila aparece LOCAL al instante (offline) → getActiveSession (lectura local) la ve enseguida.
//
// CONTRATO (spec 15 T5): el local write SIEMPRE tiene éxito offline → devuelve ok apenas la fila está en
// SQLite. La AUTORIZACIÓN real la valida la RLS al SUBIR (sessions_insert/_update = has_role_in) — NO el
// return del service. El rodeo-check (tg_sessions_rodeo_check, 0050: rodeo del mismo establishment + activo)
// y el `created_by` forzado (tg_force_created_by_auth_uid) corren server-side al subir. Un rechazo lo maneja
// uploadData (descarta + superficia por el canal de status) — NO el return de acá.
//
// Multi-tenant (CLAUDE.md ppio 6): NUNCA se hardcodea establishment_id ni rodeo_id — los pasa el caller
// (establishment del contexto activo; rodeo elegido en el wizard). `created_by` lo fuerza el trigger.
//
// El `config` es un jsonb PASS-THROUGH: la UI lo setea con el snapshot de la jornada (`{ maniobras:[orden],
// preconfig:{...} }`). Este service NO le da forma rígida — lo guarda tal cual (lo serializa a TEXT para
// SQLite; PostgREST lo castea a jsonb al subir). Un CHECK del DB (sessions_config_size, 0050) acota el
// tamaño a 16 KiB al subir.

import {
  buildCreateSessionInsert,
  buildCloseSessionUpdate,
  buildCloseActiveSessionsUpdate,
  buildSetWorkLotLabelUpdate,
  buildSetSessionCountsUpdate,
  buildSetSessionRodeoUpdate,
  buildActiveSessionQuery,
  buildSessionByIdQuery,
  buildSessionEmptyFemalesQuery,
} from './powersync/local-reads';
import { runLocalWrite, runLocalQuery, runLocalQuerySingle } from './powersync/local-query';
import { parseManeuverConfig, type ManeuverConfig } from '../utils/maneuver-config';
import { formatEidReadable } from '../utils/eid-format';

// ─── Error / Result uniforme (mismo shape que events.ts / management-groups.ts) ──────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/**
 * El snapshot de configuración de una jornada (jsonb pass-through). La UI lo arma con las maniobras
 * elegidas (en orden) + su pre-config; este service NO valida su forma (es libre por diseño). Mismo shape
 * que el config de un preset (maneuver-config.ts).
 */
export type SessionConfig = ManeuverConfig;

/** Una sesión leída del SQLite local. `config` ya parseado del TEXT a objeto (o {} si no parsea). */
export type Session = {
  id: string;
  establishmentId: string;
  rodeoId: string;
  config: SessionConfig;
  status: 'active' | 'closed';
  workLotLabel: string | null;
  animalCount: number;
  eventCount: number;
  startedAt: string | null;
  endedAt: string | null;
};

// Fila cruda local (TEXT/INTEGER de SQLite).
type SessionRow = {
  id: string;
  establishment_id: string;
  rodeo_id: string;
  // string JSON (INSERT local recién creado) U objeto (jsonb materializado por PowerSync al bajar del
  // server). parseManeuverConfig tolera ambas formas (round-trip server↔local).
  config: unknown;
  status: string;
  work_lot_label: string | null;
  animal_count: number | null;
  event_count: number | null;
  started_at: string | null;
  ended_at: string | null;
};

function toSession(r: SessionRow): Session {
  return {
    id: r.id,
    establishmentId: r.establishment_id,
    rodeoId: r.rodeo_id,
    config: parseManeuverConfig(r.config),
    status: r.status === 'closed' ? 'closed' : 'active',
    workLotLabel: cleanStr(r.work_lot_label),
    animalCount: r.animal_count ?? 0,
    eventCount: r.event_count ?? 0,
    startedAt: r.started_at,
    endedAt: r.ended_at,
  };
}

// ─── Crear sesión (R1.9/R1.10/R1.11) ─────────────────────────────────────────────────

export type CreateSessionInput = {
  /** Establishment activo (del contexto). NUNCA hardcodeado. */
  establishmentId: string;
  /** Rodeo elegido en el wizard (etapa 1). El tg_sessions_rodeo_check valida que sea activo + del est. */
  rodeoId: string;
  /** Snapshot de la jornada (maniobras + pre-config). Pass-through jsonb. Default {}. */
  config?: SessionConfig;
  /** Lote de trabajo informativo NO-autoritativo (R9.4). Opcional. */
  workLotLabel?: string | null;
};

/**
 * Crea una sesión de maniobra LOCAL (R1.9/R1.10, offline) → upload queue. `id` de CLIENTE (R1.11) →
 * devolvemos la sesión recién creada SIN re-leer (la fila ya está en SQLite local; getActiveSession la
 * verá al instante). `config` se serializa tal cual (pass-through). `created_by`/`establishment_id` (audit)
 * los FUERZA el trigger al subir; el rodeo-check (0050) y la RLS (sessions_insert = has_role_in) re-validan
 * al SUBIR (un rodeo ajeno/inactivo o un caller sin rol es rechazado allí → superficiado por uploadData,
 * NO por el return de acá). Contrato T5.
 *
 * ⚠️ INVARIANTE ≤1 ACTIVA (R10.6 — "una sola sesión activa por dispositivo a la vez"): ANTES de insertar
 * la nueva, cerramos TODAS las activas del establishment (`closeActiveSessions`). Es el ÚNICO punto de
 * enforcement (único call-site de creación del flujo de maniobra) → tras `createSession` queda EXACTAMENTE
 * 1 activa (la nueva), sin importar por dónde se llegó (wizard "Arrancar", o futuros call-sites como M4
 * "Empezar una nueva" o presets). Sin esto se ACUMULABAN sesiones `active` huérfanas (cada arranque dejaba
 * la anterior activa; "Salir sin terminar" tampoco cierra) → getActiveSession (ORDER BY started_at DESC
 * LIMIT 1) devolvía una huérfana tras "Terminar jornada" → la tarjeta "Retomar" no desaparecía (bug de Raf).
 * Ambos writes son LOCALES/offline; el close-all se encola ANTES del INSERT (FIFO de la upload queue → al
 * subir cierran las viejas, después aparece la nueva). FAIL-CLOSED: si el close-all falla, NO insertamos
 * (no dejamos la nueva conviviendo con activas viejas).
 */
export async function createSession(input: CreateSessionInput): Promise<ServiceResult<Session>> {
  // ── ENFORCEMENT R10.6: cerrar todas las activas del establishment ANTES de insertar la nueva ──
  const closed = await closeActiveSessions(input.establishmentId);
  if (!closed.ok) return { ok: false, error: closed.error };

  const id = randomUuid();
  const config = input.config ?? {};
  const workLotLabel = cleanStr(input.workLotLabel);
  const configJson = JSON.stringify(config);
  // started_at de CLIENTE (wall-clock del inicio): persiste al subir (default now() SIN force, 0050) → la
  // reanudación offline (R10.5) tiene un orden determinístico aunque la jornada arranque sin red.
  const startedAt = nowIso();
  const r = await runLocalWrite(
    buildCreateSessionInsert(id, input.establishmentId, input.rodeoId, configJson, workLotLabel, startedAt),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return {
    ok: true,
    value: {
      id,
      establishmentId: input.establishmentId,
      rodeoId: input.rodeoId,
      config,
      status: 'active',
      workLotLabel,
      animalCount: 0,
      eventCount: 0,
      startedAt,
      endedAt: null,
    },
  };
}

// ─── Cerrar sesión (R10.7) ───────────────────────────────────────────────────────────

/**
 * Cierra una sesión (R10.7): `status='closed'` + `ended_at` (wall-clock del cierre). UPDATE local
 * (offline) → upload queue. Filtra `deleted_at IS NULL`. La RLS (sessions_update = has_role_in) re-valida
 * al subir. ⚠️ Orden de cierre offline (design §5): los eventos creados antes del cierre se encolan ANTES
 * de esta mutación (FIFO de la upload queue) → al subir, el tenant-check (0056) ve la sesión aún `active`
 * cuando suben esos eventos, y la mutación `closed` sube después. Contrato T5: el local write siempre ok.
 */
export async function closeSession(id: string): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(buildCloseSessionUpdate(id, nowIso()));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Cerrar TODAS las activas del establishment (R10.6 — enforzar ≤1 activa) ───────────

/**
 * Cierra TODAS las sesiones ACTIVAS de un establishment (R10.6: una sola sesión activa por dispositivo a la
 * vez). UPDATE local masivo (offline) → 1 CrudEntry por fila tocada → upload queue. Filtra `status='active'`
 * (no re-toca cerradas) + `deleted_at IS NULL`. La RLS (sessions_update = has_role_in) re-valida al subir.
 *
 * Lo dispara `createSession` ANTES de insertar la jornada nueva → garantiza el invariante "tras crear,
 * queda a lo sumo 1 activa (la nueva)". También es el cierre masivo idempotente que limpia las huérfanas
 * acumuladas por el bug previo (arranques que no cerraban + "Salir sin terminar" que deja activa). Si NO
 * había ninguna activa, el UPDATE no toca filas y devuelve ok (no-op idempotente). Contrato T5: el local
 * write siempre tiene éxito offline.
 *
 * Multi-tenant (CLAUDE.md ppio 6): el `establishmentId` lo pasa el caller (establishment activo del
 * contexto, NUNCA hardcodeado).
 */
export async function closeActiveSessions(establishmentId: string): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(buildCloseActiveSessionsUpdate(establishmentId, nowIso()));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Lote de trabajo informativo (R9.4) ──────────────────────────────────────────────

/**
 * Setea/limpia el `work_lot_label` de una sesión (R9.4): metadata informativa NO-autoritativa de la
 * jornada (texto libre, NUNCA asigna lote a animales — eso es management-groups.assignAnimalToGroup, R9.2).
 * `label = null` lo limpia. UPDATE local (offline) → upload queue. Filtra `deleted_at IS NULL`.
 */
export async function setWorkLotLabel(
  id: string,
  label: string | null,
): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(buildSetWorkLotLabelUpdate(id, cleanStr(label)));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Cambiar el rodeo de la jornada (R4.4 / R4.7) ─────────────────────────────────────

/**
 * Cambia el `rodeo_id` de una sesión ACTIVA (R4.4 — el operario decide cambiar la jornada al rodeo de un
 * animal de otro rodeo del mismo establecimiento, o lo confirma desde el aviso R4.7 de rodeo mal elegido).
 * UPDATE local (offline) → upload queue. NO es destructivo: los animales ya procesados conservan sus
 * eventos (vinculados por session_id, con el rodeo real de cada uno); esto solo cambia el rodeo por
 * defecto de los PRÓXIMOS animales de la jornada — por eso la confirmación de la UI es liviana.
 *
 * Multi-tenant (CLAUDE.md ppio 6): el `rodeoId` lo pasa el caller (un rodeo del MISMO establecimiento
 * activo, de la lista `available` del RodeoContext — la UI NUNCA ofrece rodeos ajenos). El rodeo-check
 * server-side (tg_sessions_rodeo_check, 0050: rodeo del mismo establishment + activo) + la RLS
 * (sessions_update = has_role_in) re-validan al SUBIR — un rodeo ajeno/inactivo es rechazado allí y
 * superficiado por uploadData, NO por el return de acá (contrato T5).
 */
export async function setSessionRodeo(
  id: string,
  rodeoId: string,
): Promise<ServiceResult<true>> {
  const r = await runLocalWrite(buildSetSessionRodeoUpdate(id, rodeoId));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Contadores app-maintained (D5) ───────────────────────────────────────────────────

/**
 * Setea los contadores de conveniencia de la sesión (animal_count/event_count, D5) a un valor ABSOLUTO
 * (el caller los lleva client-side y pasa el total). Son metadata para el resumen (spec 07), NO constraints
 * de integridad: el conteo autoritativo se recomputa con count(*) por session_id. Se setean absolutos (no
 * `count + 1`) para no chocar con LWW de PowerSync ante una recarga. UPDATE local (offline) → upload queue.
 */
export async function setSessionCounts(
  id: string,
  animalCount: number,
  eventCount: number,
): Promise<ServiceResult<true>> {
  const a = Math.max(0, Math.trunc(animalCount));
  const e = Math.max(0, Math.trunc(eventCount));
  const r = await runLocalWrite(buildSetSessionCountsUpdate(id, a, e));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: true };
}

// ─── Lectura: sesión activa (R10.5/R10.6) ─────────────────────────────────────────────

/**
 * Lee la sesión ACTIVA del establishment (R10.6: una sola por dispositivo a la vez), para reanudar (R10.5).
 * Lectura LOCAL (offline). Devuelve null si no hay ninguna activa. emptyIsSyncing:false — "no hay sesión
 * activa" es un resultado de negocio legítimo (la app ofrece "nueva jornada"), no falta de sync.
 */
export async function getActiveSession(
  establishmentId: string,
): Promise<ServiceResult<Session | null>> {
  const r = await runLocalQuerySingle<SessionRow>(buildActiveSessionQuery(establishmentId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value ? toSession(r.value) : null };
}

/**
 * Lee UNA sesión por id (lectura puntual / reanudación). Devuelve null si no existe o está borrada.
 * Lectura LOCAL (offline).
 */
export async function getSessionById(id: string): Promise<ServiceResult<Session | null>> {
  const r = await runLocalQuerySingle<SessionRow>(buildSessionByIdQuery(id), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value ? toSession(r.value) : null };
}

// ─── Vacías de la sesión — sugerencia post-tacto (delta lotes-venta, RLV.10.1/RLV.10.2) ───────

/** Una vaca vacía de la sesión: su perfil + un identificador legible (para el conteo + la asignación). */
export type SessionEmptyFemale = {
  profileId: string;
  /** Identificador HERO legible es-AR (idv → caravana electrónica agrupada → "Animal"). */
  hero: string;
};

type EmptyFemaleRow = { profile_id: string; idv: string | null; tag_electronic: string | null };

/**
 * Lista las VACÍAS de una sesión de tacto (RLV.10.1): perfiles activos con tacto 'empty' de esa `session_id`,
 * DISTINCT por animal. Lectura LOCAL (offline): el tacto de manga vive por CRUD-plano en `reproductive_events`
 * (tabla synced) desde el instante de la carga → esta lectura lo ve sin sincronizar. Alimenta el conteo de la
 * sugerencia ("Encontramos N vacías", RLV.10.2) y la asignación al lote (RLV.14). emptyIsSyncing:false — "no
 * hay vacías" es un resultado legítimo (la sugerencia simplemente no se ofrece), NO falta de sync.
 *
 * Multi-tenant (CLAUDE.md ppio 6): NO recibe establishment_id (la `session_id` ya acota al campo de la
 * jornada; el scoping lo aplicó la stream). El `hero` se deriva de idv/tag (sin apodo: el conteo prima).
 */
export async function fetchSessionEmptyFemales(
  sessionId: string,
): Promise<ServiceResult<SessionEmptyFemale[]>> {
  const r = await runLocalQuery<EmptyFemaleRow>(buildSessionEmptyFemalesQuery(sessionId), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return {
    ok: true,
    value: r.value.map((row) => ({
      profileId: row.profile_id,
      hero: emptyFemaleHero(row.idv, row.tag_electronic),
    })),
  };
}

/** Identificador legible de una vaca vacía: idv → caravana electrónica agrupada → "Animal". */
function emptyFemaleHero(idv: string | null, tag: string | null): string {
  const v = idv?.trim();
  if (v) return v;
  const t = tag?.trim();
  if (t) return formatEidReadable(t);
  return 'Animal';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function cleanStr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** UUID v4 de cliente (R1.11). crypto.randomUUID está en RN (Hermes), web y Node — sin dep extra. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

/** ISO now() (wall-clock del cliente) para ended_at del cierre. */
function nowIso(): string {
  return new Date().toISOString();
}
