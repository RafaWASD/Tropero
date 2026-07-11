// Planificación + orquestación PURAS del LOOP CLIENT-SIDE de la baja en tanda (delta lotes-venta,
// RLV.7/RLV.7.1/RLV.8/RLV.9.1/RLV.22/RLV.23). SIN I/O, SIN RN/expo/supabase, SIN PowerSync: testeable con
// node:test (mismo patrón pure-plan ↔ io-service que bulk-operations-plan.ts ↔ bulk-operations.ts).
//
// La baja en tanda NO es una RPC nueva (RLV.7.1): es la baja per-animal existente (`exit_animal_profile`,
// 0044, vía la outbox `enqueueExitAnimal`) aplicada N veces. Este módulo:
//   (a) `planBatchExit` — deriva, por animal, los params EXACTOS del RPC (motivo→status/reason, fecha común,
//       precio/peso efectivo común-u-override). PURO y total.
//   (b) `runBatchExit` — recorre el plan y, por animal, encola la baja + limpia la membresía del lote, con
//       las OPERACIONES DE I/O INYECTADAS (deps) → testeable sin el SDK. El SERVICE (`services/batch-exit.ts`)
//       le pasa las reales (`enqueueExitAnimal` + `assignAnimalToGroup(id, null)`).
//
// Fail-closed (RLV.8, design §2.3): si una escritura LOCAL falla (raro: error de SQLite, no de authz) se
// CORTA y se devuelve `{ ok:false, count }` con las que SÍ se completaron. Las ya encoladas quedan locales y
// suben; la fallida + el resto se reintentan. La no-atomicidad es correcta (resultado parcial > rollback all).
// El rechazo SERVER-side (un animal ya bajado por otro dispositivo, sin permiso) NO llega acá: lo maneja la
// outbox por el canal de status (RLV.8), NO el return.

import {
  batchExitReasonToStatus,
  resolveEffectiveSaleData,
  type ExitReasonChoice,
  type ExitStatus,
} from '../services/exit-animal';

/** Datos COMUNES de la tanda (RLV.5): motivo + fecha (a todos, RLV.5.1) + precio/peso comunes opcionales. */
export type BatchExitCommon = {
  /** Motivo de la tanda: 'sale' | 'death' (RLV.4). Un valor fuera del set → plan vacío (defensivo). */
  reason: string;
  /** Fecha de salida 'YYYY-MM-DD' aplicada a TODOS los animales (RLV.5.1). */
  exitDate: string;
  /** Precio común (solo motivos que capturan datos de venta). null = no cargado. */
  commonPrice: number | null;
  /** Peso común (idem). null = no cargado. */
  commonWeight: number | null;
};

/** Un animal de la tanda + su eventual override de precio/peso (RLV.6). */
export type BatchExitTarget = {
  profileId: string;
  /** Override de precio del animal; null/undefined → cae al común (RLV.5.2/RLV.6). */
  overridePrice?: number | null;
  /** Override de peso del animal; null/undefined → cae al común. */
  overrideWeight?: number | null;
};

/** Los params EXACTOS del RPC `exit_animal_profile` (0044) para UN animal (nombres del SQL). */
export type BatchExitParams = {
  p_profile_id: string;
  p_status: ExitStatus;
  p_exit_reason: ExitReasonChoice;
  p_exit_date: string;
  p_exit_weight: number | null;
  p_exit_price: number | null;
};

/** La baja planificada de UN animal: los params + los campos que el overlay optimista necesita. */
export type PlannedBatchExit = {
  profileId: string;
  status: ExitStatus;
  exitDate: string;
  params: BatchExitParams;
};

/**
 * Deriva el plan de la baja en tanda (RLV.7): un `PlannedBatchExit` por animal. PURO y total. El motivo se
 * resuelve al set de la tanda (Venta/Muerte, RLV.4.1); un motivo inválido → plan VACÍO (defensivo — la UI
 * nunca lo manda). Para los motivos que NO capturan datos de venta (Muerte, RLV.4.1) el precio/peso van
 * SIEMPRE null (no se mandan, aunque el común tuviera un valor); para Venta se resuelve el efectivo
 * (override-gana-común, RLV.5.2/RLV.6). La fecha común va a TODOS (RLV.5.1).
 */
export function planBatchExit(
  common: BatchExitCommon,
  targets: readonly BatchExitTarget[],
): PlannedBatchExit[] {
  const mapping = batchExitReasonToStatus(common.reason);
  if (!mapping) return [];
  return targets.map((t) => {
    const { price, weight } = mapping.capturesSaleData
      ? resolveEffectiveSaleData({
          commonPrice: common.commonPrice,
          commonWeight: common.commonWeight,
          overridePrice: t.overridePrice,
          overrideWeight: t.overrideWeight,
        })
      : { price: null, weight: null };
    return {
      profileId: t.profileId,
      status: mapping.status,
      exitDate: common.exitDate,
      params: {
        p_profile_id: t.profileId,
        p_status: mapping.status,
        p_exit_reason: mapping.exitReason,
        p_exit_date: common.exitDate,
        p_exit_weight: weight,
        p_exit_price: price,
      },
    };
  });
}

/** Resultado del encolado/limpieza (mismo shape mínimo que OutboxResult/ServiceResult). */
type OpResult = { ok: boolean };

/** Las OPERACIONES DE I/O inyectadas (el service pasa las reales; el test, fakes). */
export type BatchExitDeps = {
  /** Encola la baja de UN animal (real: `enqueueExitAnimal`) — intent + overlay optimista 'exited'. */
  enqueueExit: (item: {
    params: BatchExitParams;
    profileId: string;
    status: ExitStatus;
    exitDate: string;
  }) => Promise<OpResult>;
  /** Limpia la membresía del lote del animal (real: `assignAnimalToGroup(id, null)`, RLV.9.1). */
  clearMembership: (profileId: string) => Promise<OpResult>;
};

/** Resumen de la tanda: cuántos animales quedaron ENCOLADOS + limpiados con éxito (RLV.7). */
export type BatchExitResult = { ok: boolean; count: number };

/**
 * Recorre el plan y, por animal EN ORDEN (design §2.3): (i) encola la baja (`enqueueExit`) y (ii) limpia la
 * membresía del lote (`clearMembership`, RLV.9.1). Fail-closed (RLV.8): a la PRIMERA escritura local que
 * falle, CORTA y devuelve `{ ok:false, count }` con las completadas (ambas ops OK) hasta ahí — las ya
 * encoladas suben; la fallida + el resto se reintentan. Con plan vacío → `{ ok:true, count:0 }` (no-op). El
 * rechazo server-side NO llega acá (lo maneja la outbox por status, RLV.8).
 */
export async function runBatchExit(
  planned: readonly PlannedBatchExit[],
  deps: BatchExitDeps,
): Promise<BatchExitResult> {
  let count = 0;
  for (const item of planned) {
    const enq = await deps.enqueueExit({
      params: item.params,
      profileId: item.profileId,
      status: item.status,
      exitDate: item.exitDate,
    });
    if (!enq.ok) return { ok: false, count };
    const clear = await deps.clearMembership(item.profileId);
    if (!clear.ok) return { ok: false, count };
    count += 1;
  }
  return { ok: true, count };
}
