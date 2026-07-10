// Lógica PURA de SALTEAR un animal en la carga rápida (spec 03 delta `skip-animal-maniobra`, ítem C del
// triage demo-facundo-padre 2026-07-10). Sin RN, sin red, sin SDK: testeable con node:test (mismo patrón
// que maneuver-sequence.ts / maneuver-event-query.ts).
//
// El pedido: un botón para SALTEAR un animal (no cargarle ninguna maniobra) y seguir con el próximo. Como el
// frame persiste CADA maniobra al confirmarla (R5.8, per-step), "saltear los descarta" = soft-borrar las filas
// de evento que ESTE frame escribió para ESTE animal. Este módulo:
//   (a) `hasPersistedCaptures`/`countPersistedCaptures`: ¿hay datos parciales cargados? (decide el tono de la
//       confirmación anti-accidente).
//   (b) `collectManeuverDiscardTargets`: junta, por tabla de evento, los ids de cliente a soft-borrar — a
//       partir del CaptureMap/CustomCaptureMap + los ids estables del frame (eventIds/extraIds/customIds).
//   (c) `buildManeuverEventSoftDeleteQuery`: el UPDATE de soft-delete por id (idempotente).
//
// dientes queda FUERA (no es una fila de evento: es un UPDATE de propiedad de animal_profiles.teeth_state/CUT;
// revertirlo necesita el estado previo que el frame no transporta — setear NULL a ciegas borraría una
// observación real anterior). Es la única maniobra de propiedad; el resto (eventos + custom) sí se descartan.

import type { LocalQuery } from '../services/powersync/local-reads';
import type { ManeuverKind } from './maneuver-gating';
import type { CaptureMap, CustomCaptureMap, StepValue } from './maneuver-sequence';

/**
 * Tablas de evento de spec 02 que las maniobras de fábrica/custom escriben (todas con `id` + `deleted_at`,
 * schema.ts). `dientes` NO está: es un UPDATE de propiedad de animal_profiles, no una fila de evento borrable.
 * El allowlist es de TIPO (unión cerrada) → la tabla del soft-delete nunca viene de input de usuario.
 */
export type ManeuverEventTable =
  | 'reproductive_events'
  | 'weight_events'
  | 'condition_score_events'
  | 'sanitary_events'
  | 'lab_samples'
  | 'scrotal_measurements'
  | 'custom_measurements';

/** value.kind (StepValue) → tabla de evento borrable. `null` = no persiste una fila borrable (dientes/skipped). */
function tableForStepValue(value: StepValue): ManeuverEventTable | null {
  switch (value.kind) {
    case 'tacto':
    case 'vaquillona':
    case 'inseminacion':
      return 'reproductive_events';
    case 'pesaje':
      return 'weight_events';
    case 'score':
      return 'condition_score_events';
    case 'sanitary':
    case 'vaccination':
      return 'sanitary_events';
    case 'lab':
    case 'lab_double':
      return 'lab_samples';
    case 'scrotal':
      return 'scrotal_measurements';
    // dientes = UPDATE de propiedad (no fila de evento) → no se descarta; skipped no persiste.
    case 'dientes':
    case 'skipped':
      return null;
    default:
      return null;
  }
}

/** Una tabla + los ids de cliente a soft-borrar en ella (agrupado por tabla). */
export type ManeuverDiscardTarget = { table: ManeuverEventTable; ids: string[] };

/**
 * Los ids de cliente ESTABLES que el frame (carga.tsx) generó al persistir las maniobras de este animal:
 *   - `event`: el id principal por ManeuverKind (eventIdsRef).
 *   - `extra`: los ids ADICIONALES de las maniobras multi-write (vacunación N vacunas / raspado 2 tubos) por
 *     ManeuverKind (extraIdsRef).
 *   - `custom`: el id por field_definition_id de las maniobras custom (customIdsRef).
 */
export type CapturedEventIds = {
  event: Partial<Record<ManeuverKind, string>>;
  extra: Partial<Record<ManeuverKind, string[]>>;
  custom: Record<string, string>;
};

/**
 * ¿Hay al menos una maniobra CARGADA (persistida) en este animal? Cuenta las de fábrica con valor real (una
 * `skipped` NO cuenta — placeholder, no persistió) + las custom cargadas. Incluye `dientes` (persistió, aunque
 * no se descarte) para que la confirmación no mienta sobre "hay datos cargados".
 */
export function hasPersistedCaptures(captured: CaptureMap, customCaptured: CustomCaptureMap): boolean {
  return countPersistedCaptures(captured, customCaptured) > 0;
}

/** Cantidad de maniobras CARGADAS (persistidas) del animal — alimenta el copy de la confirmación ("N maniobras"). */
export function countPersistedCaptures(captured: CaptureMap, customCaptured: CustomCaptureMap): number {
  let n = 0;
  for (const value of Object.values(captured)) {
    if (value && value.kind !== 'skipped') n += 1;
  }
  n += Object.keys(customCaptured).length;
  return n;
}

/**
 * Junta las filas de evento a SOFT-BORRAR al saltear (descartar lo cargado), agrupadas por tabla. Por cada
 * maniobra de fábrica CARGADA (no `skipped`, no `dientes`) toma su id principal (event) + los extras multi-write;
 * por cada maniobra custom cargada toma su id (custom_measurements). Deduplica por tabla (defensivo). Los ids
 * que no existan (nunca escritos) simplemente no se agregan; y el soft-delete es idempotente por si sobrara alguno.
 */
export function collectManeuverDiscardTargets(
  captured: CaptureMap,
  customCaptured: CustomCaptureMap,
  ids: CapturedEventIds,
): ManeuverDiscardTarget[] {
  const byTable = new Map<ManeuverEventTable, string[]>();
  const push = (table: ManeuverEventTable, id: string | undefined | null) => {
    if (!id) return;
    const list = byTable.get(table) ?? [];
    list.push(id);
    byTable.set(table, list);
  };
  for (const key of Object.keys(captured) as ManeuverKind[]) {
    const value = captured[key];
    if (!value) continue;
    const table = tableForStepValue(value);
    if (!table) continue;
    push(table, ids.event[key]);
    for (const extraId of ids.extra[key] ?? []) push(table, extraId);
  }
  for (const fieldDefId of Object.keys(customCaptured)) {
    push('custom_measurements', ids.custom[fieldDefId]);
  }
  return [...byTable.entries()].map(([table, list]) => ({ table, ids: [...new Set(list)] }));
}

/**
 * UPDATE de soft-delete de UNA fila de evento por id — idempotente (`WHERE deleted_at IS NULL`: re-borrar/id
 * inexistente = no-op). Espeja `buildSoftDeleteEventUpdate` de local-reads (mismo SQL), acotado a las tablas de
 * evento de maniobra. La tabla viene del allowlist de TIPO `ManeuverEventTable` (nunca input de usuario) → sin
 * riesgo de injection por interpolar el nombre de tabla. `datetime('now')` lo resuelve SQLite; la lectura del
 * timeline filtra `deleted_at IS NULL` (cualquier no-NULL la oculta).
 */
export function buildManeuverEventSoftDeleteQuery(table: ManeuverEventTable, id: string): LocalQuery {
  return {
    sql: `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
    args: [id],
  };
}
