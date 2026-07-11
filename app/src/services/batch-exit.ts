// services/batch-exit.ts — I/O de la BAJA EN TANDA desde un lote (delta lotes-venta, RLV.7/RLV.9.1).
//
// Es la CABLEADA I/O del loop client-side: NO hay RPC nueva ni tabla nueva (RLV.7.1). Reusa la baja
// per-animal existente (`exit_animal_profile`, 0044, vía la outbox `enqueueExitAnimal`) N veces + limpia la
// membresía del lote de cada animal (`assignAnimalToGroup(id, null)`, RLV.9.1). La LÓGICA (plan de params +
// orden del loop + fail-closed) vive PURA en `utils/batch-exit-plan.ts` (testeada con deps inyectadas); acá
// solo se inyectan las operaciones REALES. Importa el SDK (vía outbox/management-groups) → NO entra al grafo
// de node:test; el loop se testea vía `runBatchExit` con fakes (batch-exit-plan.test.ts).
//
// OFFLINE-FIRST (RLV.22/RLV.23): cada baja = intent `exit_animal_profile` + overlay optimista 'exited'
// (el animal desaparece de la lista/lote al instante) + UPDATE local de `management_group_id → NULL`. Todo
// local; el rechazo server-side (animal ya bajado por otro dispositivo / sin permiso) lo maneja la outbox
// por el canal de status (RLV.8), NO el return de acá. Anti-IDOR (RLV.21): el cliente SOLO manda
// `p_profile_id`; el RPC deriva el tenant de la fila real del perfil server-side, por-llamada.

import { enqueueExitAnimal } from './powersync/outbox';
import { assignAnimalToGroup } from './management-groups';
import {
  planBatchExit,
  runBatchExit,
  type BatchExitCommon,
  type BatchExitTarget,
  type BatchExitResult,
} from '../utils/batch-exit-plan';

export type ExitAnimalsBatchInput = {
  /** Datos comunes de la tanda (motivo + fecha + precio/peso comunes). */
  common: BatchExitCommon;
  /** Los animales seleccionados (+ sus overrides). Deben venir de `fetchGroupMembers` (RLS-scopeado, RLV.21.1). */
  targets: BatchExitTarget[];
};

/**
 * Da de baja EN TANDA los animales seleccionados de un lote (RLV.7): loop client-side de `exit_animal_profile`
 * + clear de membresía por animal (RLV.9.1). Devuelve `{ ok, count }` (fail-closed en error de DB local,
 * RLV.8 — el rechazo server-side va por la outbox). NO recibe `establishment_id` ni `group_id` (el loop solo
 * necesita el `profileId` por animal; el tenant lo deriva el RPC server-side, anti-IDOR — RLV.20/RLV.21).
 */
export async function exitAnimalsBatch(input: ExitAnimalsBatchInput): Promise<BatchExitResult> {
  const planned = planBatchExit(input.common, input.targets);
  return runBatchExit(planned, {
    enqueueExit: (item) =>
      enqueueExitAnimal({
        params: item.params,
        profileId: item.profileId,
        status: item.status,
        exitDate: item.exitDate,
      }),
    clearMembership: (profileId) => assignAnimalToGroup(profileId, null),
  });
}

export type { BatchExitCommon, BatchExitTarget, BatchExitResult };
