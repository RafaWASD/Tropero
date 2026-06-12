// Service de las OPERACIONES MASIVAS por grupo (spec 10, T-CL.8/T-CL.9 / R3.x, R6.x, R10.1–R10.5, R13.7).
//
// Genera y ENCOLA las N mutaciones locales de una operación masiva (vacunación/destete/castración) en
// BATCHES (~100, sin bloquear UI vía InteractionManager — R10.5), sobre el camino as-built de spec 15:
// runLocalWrite → CrudEntry → uploadData al reconectar. NO hay canal "bulk": son las MISMAS escrituras que
// las individuales (vacunación/destete espejan events.ts; castración = UPDATE animal_profiles + observación
// — espeja animals.setCastrated). La DECISIÓN de qué mutaciones se generan es PURA (bulk-operations-plan.ts,
// testeable); acá solo el I/O (resolver ids existentes/establishments del SQLite local + drenar el plan).
//
// 2 CrudEntries/animal en castración (UPDATE + observación, R13.7); 1/animal en vacunación/destete. Las
// mutaciones son INDEPENDIENTES (R10.2, sin transacción): un rechazo de sync de una NO rollbackea las otras.
//
// PROGRESO + RECHAZOS (T-CL.9 / R10.2–R10.4): el ENCOLADO local de las N mutaciones reporta su avance por
// el callback `onProgress` ("generando X de N"). El "X de N SINCRONIZADOS" y los RECHAZOS POR ANIMAL los
// superficia el canal de status/error de uploadData as-built (spec 15 R8.1: el rechazo permanente se
// descarta del queue y se loguea con la tabla/op de la CrudEntry — la pantalla de progreso de Fase 4 lo
// mapea al animal vía el plan que este service devuelve). Este service NO reimplementa ese canal: devuelve
// el `BulkPlan` (mutaciones por animal) para que la UI ate un rechazo de CrudEntry a su profileId.

import { InteractionManager } from 'react-native';

import type { GroupProfile } from '../utils/bulk-candidates';
import {
  planVaccination,
  planWeaning,
  planCastration,
  drainBulkPlan,
  DEFAULT_BATCH_SIZE,
  type BulkPlan,
  type VaccinationParams,
  type WeaningParams,
  type PlannedStatement,
  type DrainRejection,
} from '../utils/bulk-operations-plan';
import {
  buildVaccinationPreview,
  type VaccinationPreview,
} from '../utils/vaccination-preview';
import {
  buildAddVaccinationInsert,
  buildAddWeaningInsert,
  buildSetCastratedUpdate,
  buildAddObservationInsert,
  buildExistingVaccinationIdsQuery,
  buildExistingWeaningIdsQuery,
  buildProfileEstablishmentsQuery,
} from './powersync/local-reads';
import { runLocalQuery, runLocalWrite } from './powersync/local-query';

// ─── Error / Result uniforme ────────────────────────────────────────────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** Progreso del ENCOLADO local (R10.4): cuántos animales se encolaron de los N totales. */
export type BulkProgress = {
  /** Animales cuyas mutaciones ya se encolaron localmente. */
  done: number;
  /** Total de animales a mutar (= plan.totalAnimals). */
  total: number;
};

/** Resultado del aplicado de una operación masiva: el plan ejecutado + cuántos animales se encolaron. */
export type BulkApplyResult = {
  /** El plan que se ejecutó (mutaciones por animal — la UI lo usa para atar rechazos de sync al animal). */
  plan: BulkPlan;
  /** Animales efectivamente encolados (= todos los del plan salvo un fallo de execute local, raro). */
  enqueued: number;
  /** Animales rechazados en el ENCOLADO LOCAL, por animal (R10.3 — el rechazo de SYNC va por uploadData). */
  rejected: DrainRejection[];
};

/** Opciones comunes de las 3 ops: tamaño de batch + callback de progreso del encolado. */
export type BulkApplyOptions = {
  /** ~100 por default (R10.5). Inyectable para tests/UI. */
  batchSize?: number;
  /** Callback de progreso del ENCOLADO local (no del sync — eso es el canal de uploadData). */
  onProgress?: (p: BulkProgress) => void;
};

// ─── Vacunación masiva: PREVIEW (R4.2/R4.3/R4.4/R6.3/R7.2) ───────────────────────────────────

/**
 * Computa el PREVIEW obligatorio de la vacunación masiva (R4.2): "N eventos sobre M animales" + el
 * skip-and-report (R4.3): cuántos se saltan y por qué (ya-vacunados de esa fecha = idempotencia R6.3;
 * rodeo sin `vacunacion` habilitado = R7.2 lote cross-rodeo). Resuelve del SQLite local los ids de
 * `vaccination` ya aplicados de estos perfiles en `eventDate` (la barrera idempotente) y delega el conteo
 * en el util PURO `buildVaccinationPreview`. El `rodeoVaccinationEnabled` (gating por rodeo real) lo
 * resuelve la pantalla (lote cross-rodeo) y lo pasa; en un rodeo único ya gateado se omite.
 *
 * El `preview.toApply` es EXACTAMENTE el conjunto que se le pasa después a `applyBulkVaccination` (R4.4:
 * no se crea mutación sobre un saltado — los rodeoDisabled NO se encolan).
 */
export async function previewVaccination(
  candidates: readonly GroupProfile[],
  eventDate: string,
  rodeoVaccinationEnabled?: (rodeoId: string) => boolean,
): Promise<ServiceResult<VaccinationPreview>> {
  // ids de vacunaciones YA aplicadas localmente de estos perfiles en esta fecha (idempotencia, R6.3).
  const existing = await resolveExistingEventIds(
    candidates,
    (ids) => buildExistingVaccinationIdsQuery(ids, eventDate),
  );
  if (!existing.ok) return existing;
  return {
    ok: true,
    value: buildVaccinationPreview(candidates, eventDate, existing.value, rodeoVaccinationEnabled),
  };
}

// ─── Vacunación masiva (R3.1) ──────────────────────────────────────────────────────────────

/**
 * Aplica la VACUNACIÓN masiva sobre `candidates` (R3.1/R6.1/R6.3): 1 INSERT sanitary_events 'vaccination'
 * por animal NUEVO (id UUIDv5 determinístico; los ya aplicados en esa fecha se excluyen). Offline (CRUD
 * plano); el gating capa 2 (`vacunacion` fail-closed) lo re-valida el trigger al subir. Reporta progreso.
 */
export async function applyBulkVaccination(
  candidates: readonly GroupProfile[],
  params: VaccinationParams,
  options: BulkApplyOptions = {},
): Promise<ServiceResult<BulkApplyResult>> {
  // Barrera idempotente local (R6.3): ids de vacunaciones ya aplicadas de estos perfiles en esta fecha.
  const existing = await resolveExistingEventIds(
    candidates,
    (ids) => buildExistingVaccinationIdsQuery(ids, params.eventDate),
  );
  if (!existing.ok) return existing;

  const plan = planVaccination(
    candidates,
    params,
    existing.value,
    (id, profileId, productName, route, eventDate) =>
      toPlanned(buildAddVaccinationInsert(id, profileId, productName, route, eventDate)),
    options.batchSize ?? DEFAULT_BATCH_SIZE,
  );
  return drainPlan(plan, options);
}

// ─── Destete masivo (R3.2 / R3.5) ──────────────────────────────────────────────────────────

/**
 * Aplica el DESTETE masivo sobre `candidates` (R3.2/R3.5/R6.1/R6.3): 1 INSERT reproductive_events
 * 'weaning' por ternero/a NUEVO (mellizos = uno cada uno). La transición de categoría la dispara el
 * trigger 0063 al subir. Reporta progreso.
 */
export async function applyBulkWeaning(
  candidates: readonly GroupProfile[],
  params: WeaningParams,
  options: BulkApplyOptions = {},
): Promise<ServiceResult<BulkApplyResult>> {
  const existing = await resolveExistingEventIds(
    candidates,
    (ids) => buildExistingWeaningIdsQuery(ids, params.eventDate),
  );
  if (!existing.ok) return existing;

  const plan = planWeaning(
    candidates,
    params,
    existing.value,
    (id, profileId, eventDate, createdAt) =>
      toPlanned(buildAddWeaningInsert(id, profileId, eventDate, createdAt)),
    options.batchSize ?? DEFAULT_BATCH_SIZE,
  );
  return drainPlan(plan, options);
}

// ─── Castración masiva (R3.3 / R13.7 / R12.4) ────────────────────────────────────────────────

/**
 * Aplica la CASTRACIÓN masiva sobre `candidates` (R3.3/R13.7/R12.4): por animal, UPDATE
 * animal_profiles is_castrated=1/future_bull=0 + observación automática "Castrado" (2 CrudEntries
 * INDEPENDIENTES, R10.2). El establishment_id de cada observación se deriva del PERFIL (R13.7, NUNCA
 * inventado) vía una query batched local. La transición la dispara el write-through+0086 al subir; el
 * espejo C6 la refleja offline. Reporta progreso.
 */
export async function applyBulkCastration(
  candidates: readonly GroupProfile[],
  options: BulkApplyOptions = {},
): Promise<ServiceResult<BulkApplyResult>> {
  if (candidates.length === 0) {
    return { ok: true, value: { plan: emptyPlan(), enqueued: 0, rejected: [] } };
  }
  // establishment_id de cada perfil (R13.7) — batched (no N+1). emptyIsSyncing:false: si un perfil no
  // está local todavía, simplemente no se castra (planCastration lo omite); no degradamos toda la masiva.
  const estRes = await runLocalQuery<{ id: string; establishment_id: string }>(
    buildProfileEstablishmentsQuery(candidates.map((c) => c.profileId)),
    { emptyIsSyncing: false },
  );
  if (!estRes.ok) return { ok: false, error: { kind: estRes.error.kind, message: estRes.error.message } };
  const estById = new Map<string, string>();
  for (const row of estRes.value) estById.set(row.id, row.establishment_id);

  const plan = planCastration(
    candidates,
    (profileId) => estById.get(profileId) ?? null,
    (profileId, value) => toPlanned(buildSetCastratedUpdate(profileId, value)),
    (id, profileId, establishmentId, text) =>
      toPlanned(buildAddObservationInsert(id, profileId, establishmentId, text)),
    () => globalThis.crypto.randomUUID(), // id RANDOM de la observación (design §3.5, NO UUIDv5)
    options.batchSize ?? DEFAULT_BATCH_SIZE,
  );
  return drainPlan(plan, options);
}

// ─── Drenado del plan (encolado batcheado, sin bloquear UI — R10.5) ───────────────────────────

/**
 * Drena el `plan` delegando en drainBulkPlan (PURO/testeable): encola por BATCHES cediendo el hilo entre
 * batches (InteractionManager — no bloquea la UI con cientos/miles de animales, R10.5). Inyecta
 * runLocalWrite como writer (cada statement = una CrudEntry) y reporta progreso + rechazos por animal
 * (R10.2/R10.3). Las mutaciones son INDEPENDIENTES: un fallo de write local NO rollbackea lo ya encolado.
 */
async function drainPlan(
  plan: BulkPlan,
  options: BulkApplyOptions,
): Promise<ServiceResult<BulkApplyResult>> {
  const result = await drainBulkPlan(
    plan,
    async (stmt) => {
      // runLocalWrite SIEMPRE tiene éxito offline (encola la CrudEntry); falla solo si el execute local
      // revienta (DB no booteada / SQL malformado). El rechazo real de SYNC lo maneja uploadData aparte
      // (R10.3) — esto solo captura el fallo del write LOCAL.
      const r = await runLocalWrite({ sql: stmt.sql, args: stmt.args });
      return r.ok ? { ok: true } : { ok: false, message: r.error.message };
    },
    { onProgress: options.onProgress, yieldBetweenBatches: yieldToUi },
  );
  return { ok: true, value: { plan, enqueued: result.enqueued, rejected: result.rejected } };
}

/** Cede el control al loop de UI entre batches (R10.5). Tolerante: si InteractionManager no está, microtask. */
function yieldToUi(): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      InteractionManager.runAfterInteractions(() => resolve());
    } catch {
      resolve();
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────────────────

/** Resuelve el set de ids de eventos YA aplicados localmente de los candidatos (barrera idempotente). */
async function resolveExistingEventIds(
  candidates: readonly GroupProfile[],
  build: (profileIds: string[]) => { sql: string; args: unknown[] },
): Promise<ServiceResult<Set<string>>> {
  if (candidates.length === 0) return { ok: true, value: new Set() };
  const r = await runLocalQuery<{ id: string }>(build(candidates.map((c) => c.profileId)), {
    emptyIsSyncing: false,
  });
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: new Set(r.value.map((row) => row.id)) };
}

/** Adapta un LocalQuery (de local-reads) al PlannedStatement del planner puro (mismo shape estructural). */
function toPlanned(q: { sql: string; args: unknown[] }): PlannedStatement {
  return { sql: q.sql, args: q.args };
}

/** Plan vacío (0 animales) — para el early-return de castración sin candidatos. */
function emptyPlan(): BulkPlan {
  return { mutations: [], totalAnimals: 0, totalStatements: 0, batches: [] };
}
