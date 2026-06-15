// Planificación PURA de las N mutaciones de una operación masiva (spec 10, T-CL.8 / R3.x, R6.1, R10.5).
// SIN I/O, SIN RN/expo/supabase, SIN PowerSync: testeable con node:test (mismo patrón que bulk-candidates /
// bulk-selection / bulk-idempotency). La I/O (runLocalWrite por mutación + InteractionManager para no
// bloquear UI + el canal de progreso/rechazos de uploadData) vive en el SERVICE bulk-operations.ts; acá
// solo se DECIDE qué statements se generan, en qué orden, agrupados en batches.
//
// Modelo (design §3.2/§3.5, regla de oro reconciliada):
//   - VACUNACIÓN → 1 INSERT sanitary_events 'vaccination' por animal (id UUIDv5 determinístico, R6.1).
//   - DESTETE    → 1 INSERT reproductive_events 'weaning' por ternero/a (id UUIDv5, uno por mellizo, R3.5).
//   - CASTRACIÓN → 2 CrudEntries por animal: (a) UPDATE animal_profiles is_castrated=1/future_bull=0 +
//                  (b) INSERT animal_events 'observacion' "Castrado" (R13.7). id de la observación = RANDOM
//                  (design §3.5: la observación se crea exactamente una vez por apply local; el UUIDv5
//                  cruzado borraría la autoría de un actor). La castración NO usa bulk-idempotency (estado
//                  absoluto, idempotente por valor — los ya castrados ni son candidatos, D3).
//
// Idempotencia de EVENTO (R6.1/R6.3): vacunación/destete filtran las claves ya presentes localmente
// (filterNewEventKeys) → re-ejecutar la masiva NO genera duplicados. El id determinístico (UUIDv5) además
// dedup ante syncs concurrentes (colisión de PK server-side).

import type { GroupProfile } from './bulk-candidates';
import {
  bulkEventId,
  filterNewEventKeys,
  type EventBulkType,
  type IdempotencyKey,
} from './bulk-idempotency';
import { castrationObservationText } from './castration-copy';

/** Una sentencia local lista para runLocalWrite (mismo shape que LocalQuery de local-reads, sin acoplar). */
export type PlannedStatement = { sql: string; args: unknown[] };

/**
 * El conjunto de mutaciones de UN animal (la unidad de reporte por animal — R10.3): el profileId + sus
 * statements (1 para evento, 2 para castración) + un `id` de evento (solo eventos, para diagnóstico). Si
 * una de sus CrudEntries es rechazada al sincronizar, el reporte la atribuye a este profileId.
 */
export type PlannedAnimalMutation = {
  /** animal_profile_id de la mutación (la clave de reporte por animal). */
  profileId: string;
  /** Las 1..2 sentencias locales de este animal (en orden de encolado). */
  statements: PlannedStatement[];
};

/** El plan completo de una operación masiva: las mutaciones por animal + los batches para drenar. */
export type BulkPlan = {
  /** Las mutaciones por animal (1 por candidato nuevo; vacío si todos ya estaban procesados, R6.3). */
  mutations: PlannedAnimalMutation[];
  /** Total de animales a mutar (= mutations.length) — el N del "X de N" (R10.4) y del CTA. */
  totalAnimals: number;
  /** Total de CrudEntries que se van a encolar (evento: 1/animal; castración: 2/animal). */
  totalStatements: number;
  /**
   * Batches de profileIds (~batchSize cada uno) para drenar SIN bloquear UI (R10.5): el service procesa
   * un batch, cede el hilo (InteractionManager/idle), procesa el siguiente. Cada batch es un array de
   * índices dentro de `mutations`. Vacío si no hay mutaciones.
   */
  batches: number[][];
};

/** Parámetros de la VACUNACIÓN masiva (la pre-config — R3.1). La VÍA se eliminó: el producto la implica. */
export type VaccinationParams = {
  /** product_name de la pre-config (NOT NULL en el INSERT). */
  productName: string;
  /** Fecha 'YYYY-MM-DD' del evento (= la fecha de la clave idempotente, NO el timestamp de aplicación). */
  eventDate: string;
};

/** Parámetros del DESTETE masivo (R3.2). */
export type WeaningParams = {
  /** Fecha 'YYYY-MM-DD' del weaning. */
  eventDate: string;
  /** created_at de cliente (wall-clock) — desempate del mismo event_date (banner reproductive_events). */
  createdAt: string;
};

/** Tamaño de batch por default (R10.5 / design §7: ~100, idle entre batches para no bloquear UI). */
export const DEFAULT_BATCH_SIZE = 100;

/** Helpers de generación de id que el service inyecta (random para la observación; el de evento es UUIDv5
 *  determinístico, NO inyectable — sale de bulkEventId). Inyectable para tests determinísticos. */
export type IdGen = () => string;

// ─── Vacunación ────────────────────────────────────────────────────────────────────────────

/**
 * Plan de la VACUNACIÓN masiva (R3.1/R6.1/R6.3). Por cada candidato NUEVO (su clave idempotente no está
 * en `existingEventIds`) genera 1 INSERT sanitary_events con id UUIDv5 determinístico. Los ya aplicados
 * se EXCLUYEN (R6.3: re-ejecutar no duplica). `buildVaccination` es el builder inyectado
 * (buildAddVaccinationInsert) — así el planner queda puro (sin importar local-reads, que no es puro).
 */
export function planVaccination(
  candidates: readonly GroupProfile[],
  params: VaccinationParams,
  existingEventIds: ReadonlySet<string>,
  buildVaccination: (id: string, profileId: string, productName: string, eventDate: string) => PlannedStatement,
  batchSize: number = DEFAULT_BATCH_SIZE,
): BulkPlan {
  return planEventOperation(
    candidates,
    'vaccination',
    params.eventDate,
    existingEventIds,
    (id, profileId) => buildVaccination(id, profileId, params.productName, params.eventDate),
    batchSize,
  );
}

// ─── Destete ───────────────────────────────────────────────────────────────────────────────

/**
 * Plan del DESTETE masivo (R3.2/R3.5/R6.1/R6.3). Por cada ternero/a candidato NUEVO genera 1 INSERT
 * reproductive_events 'weaning' (id UUIDv5 determinístico). Mellizos = una mutación cada uno (cada perfil
 * es un candidato — R3.5). Los ya destetados ni son candidatos (bulk-candidates ya los excluye), pero la
 * barrera idempotente igual filtra los procesados (R6.3). `buildWeaning` inyectado (buildAddWeaningInsert).
 */
export function planWeaning(
  candidates: readonly GroupProfile[],
  params: WeaningParams,
  existingEventIds: ReadonlySet<string>,
  buildWeaning: (id: string, profileId: string, eventDate: string, createdAt: string) => PlannedStatement,
  batchSize: number = DEFAULT_BATCH_SIZE,
): BulkPlan {
  return planEventOperation(
    candidates,
    'weaning',
    params.eventDate,
    existingEventIds,
    (id, profileId) => buildWeaning(id, profileId, params.eventDate, params.createdAt),
    batchSize,
  );
}

/** Núcleo común de las ops de EVENTO (vacunación/destete): filtra idempotente + arma 1 statement/animal. */
function planEventOperation(
  candidates: readonly GroupProfile[],
  type: EventBulkType,
  date: string,
  existingEventIds: ReadonlySet<string>,
  buildOne: (id: string, profileId: string) => PlannedStatement,
  batchSize: number,
): BulkPlan {
  // Clave idempotente (animal, tipo, fecha) por candidato → filtrar las ya presentes (R6.3) + dedup
  // intra-batch (dos candidatos iguales colapsan). filterNewEventKeys devuelve { key, id } NUEVAS.
  const keys: IdempotencyKey[] = candidates.map((p) => ({
    animalProfileId: p.profileId,
    type,
    date,
  }));
  const fresh = filterNewEventKeys(keys, existingEventIds);
  const mutations: PlannedAnimalMutation[] = fresh.map(({ key, id }) => ({
    profileId: key.animalProfileId,
    statements: [buildOne(id, key.animalProfileId)],
  }));
  return assembleBulkPlan(mutations, batchSize);
}

// ─── Castración ──────────────────────────────────────────────────────────────────────────────

/**
 * Plan de la CASTRACIÓN masiva (R3.3/R13.7/R12.4). Por cada candidato (machos no castrados — D3, ya
 * filtrados por bulk-candidates) genera **2 statements** en orden:
 *   (1) UPDATE animal_profiles is_castrated=1, future_bull=0 (buildCastration inyectado);
 *   (2) INSERT animal_events 'observacion' "Castrado" (buildObservation inyectado), id RANDOM (idGen),
 *       establishment_id del PERFIL (lo provee `establishmentOf` — el service lo resolvió del SQLite local).
 * NO usa idempotencia de evento (estado absoluto, R6.1): re-ejecutar = no-op por valor server-side; los ya
 * castrados ni son candidatos. Es 2 CrudEntries INDEPENDIENTES por animal (R10.2).
 *
 * `establishmentOf(profileId)` devuelve el establishment_id del perfil (NUNCA inventado — R13.7); si un
 * perfil no lo resuelve (no debería: los candidatos salen del grupo local), se OMITE del plan (defensivo).
 */
export function planCastration(
  candidates: readonly GroupProfile[],
  establishmentOf: (profileId: string) => string | null | undefined,
  buildCastration: (profileId: string, value: boolean) => PlannedStatement,
  buildObservation: (id: string, profileId: string, establishmentId: string, text: string) => PlannedStatement,
  idGen: IdGen,
  batchSize: number = DEFAULT_BATCH_SIZE,
): BulkPlan {
  const mutations: PlannedAnimalMutation[] = [];
  const observationText = castrationObservationText(true); // masiva SIEMPRE castra (value=true)
  for (const p of candidates) {
    const establishmentId = establishmentOf(p.profileId);
    if (!establishmentId) continue; // defensivo: sin establishment del perfil no se puede observar (23514)
    mutations.push({
      profileId: p.profileId,
      statements: [
        buildCastration(p.profileId, true),
        buildObservation(idGen(), p.profileId, establishmentId, observationText),
      ],
    });
  }
  return assembleBulkPlan(mutations, batchSize);
}

// ─── Ensamblado del plan (batches + totales) ──────────────────────────────────────────────────

/** Arma el BulkPlan a partir de las mutaciones por animal: totales + batches de índices (~batchSize). */
function assembleBulkPlan(mutations: PlannedAnimalMutation[], batchSize: number): BulkPlan {
  const size = batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
  const totalStatements = mutations.reduce((acc, m) => acc + m.statements.length, 0);
  const batches: number[][] = [];
  for (let i = 0; i < mutations.length; i += size) {
    const batch: number[] = [];
    for (let j = i; j < Math.min(i + size, mutations.length); j += 1) batch.push(j);
    batches.push(batch);
  }
  return {
    mutations,
    totalAnimals: mutations.length,
    totalStatements,
    batches,
  };
}

// ─── Drenado del plan (encolado batcheado, independiente, con progreso — T-CL.9/T-CL.10) ───────
//
// Lógica PURA del drenado: recorre los batches, encola cada statement vía el `write` INYECTADO (el service
// le pasa runLocalWrite — SDK), cede el hilo entre batches vía `yieldBetweenBatches` (el service le pasa
// InteractionManager), y reporta progreso + RECHAZOS POR ANIMAL. Acá sin I/O real → testeable: un write
// que falla a mitad demuestra que las exitosas NO se rollbackean (R10.2) y que la fallida se reporta por
// animal (R10.3), sin duplicar al re-ejecutar (la idempotencia ya filtró en plan*).

/** Progreso del encolado (R10.4): animales encolados de los N totales. */
export type DrainProgress = { done: number; total: number };

/** Rechazo del ENCOLADO LOCAL de un animal (raro: execute local revienta). El rechazo de SYNC lo
 *  superficia uploadData (R10.3) — esto es solo el fallo del write local. profileId = el animal afectado. */
export type DrainRejection = { profileId: string; message: string };

/** Resultado del drenado: cuántos animales se encolaron + cuáles fueron rechazados localmente (por animal). */
export type DrainResult = {
  /** Animales cuyas N..N statements se encolaron OK (R10.2: las exitosas persisten siempre). */
  enqueued: number;
  /** Animales rechazados en el encolado LOCAL, por animal con motivo (R10.3 — el de sync va por uploadData). */
  rejected: DrainRejection[];
};

/** Función de escritura inyectada (el service pasa runLocalWrite; el test, un mock contra SQLite/in-mem). */
export type WriteFn = (stmt: PlannedStatement) => Promise<{ ok: boolean; message?: string }>;

/**
 * Drena el `plan` encolando sus mutaciones por animal, batch por batch (cede el hilo entre batches vía
 * `yieldBetweenBatches`, R10.5). Cada animal es INDEPENDIENTE (R10.2): si una de sus statements falla en
 * el write LOCAL, ese animal se marca rechazado y se sigue con el próximo — SIN rollback de los ya
 * encolados. Reporta progreso por animal (R10.4). PURA respecto del I/O (todo inyectado).
 */
export async function drainBulkPlan(
  plan: BulkPlan,
  write: WriteFn,
  options: {
    onProgress?: (p: DrainProgress) => void;
    yieldBetweenBatches?: () => Promise<void>;
  } = {},
): Promise<DrainResult> {
  const onProgress = options.onProgress;
  const yieldFn = options.yieldBetweenBatches ?? (() => Promise.resolve());
  let enqueued = 0;
  const rejected: DrainRejection[] = [];
  onProgress?.({ done: 0, total: plan.totalAnimals });

  for (const batch of plan.batches) {
    for (const idx of batch) {
      const mutation = plan.mutations[idx];
      let ok = true;
      let message = '';
      for (const stmt of mutation.statements) {
        const r = await write(stmt);
        if (!r.ok) {
          ok = false;
          message = r.message ?? 'No se pudo encolar la mutación.';
          break; // las statements ya encoladas de este animal NO se rollbackean (R10.2)
        }
      }
      if (ok) enqueued += 1;
      else rejected.push({ profileId: mutation.profileId, message });
      onProgress?.({ done: enqueued, total: plan.totalAnimals });
    }
    await yieldFn(); // cede el hilo entre batches (R10.5)
  }

  return { enqueued, rejected };
}

/** Re-export para que el caller (service) derive las claves/ids sin re-importar bulk-idempotency. */
export { bulkEventId };
