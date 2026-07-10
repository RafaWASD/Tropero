// ORQUESTADOR de eventos de maniobra (spec 03 M2.2 — ESQUELETO; M3.1 lo generaliza a las 10).
//
// Dado un animal + su sesión de manga + una maniobra + el valor capturado, escribe el EVENTO CORRECTO de
// spec 02 con `session_id` (R5.11), por el camino CRUD-PLANO offline (igual que events.ts): un INSERT
// LOCAL sobre la tabla SINCRONIZADA → PowerSync encola 1 CrudEntry → uploadData la sube al reconectar. La
// fila aparece LOCAL al instante → re-fetch del timeline la ve, OFFLINE (R10.1).
//
// POR QUÉ UN ORQUESTADOR (no llamar addWeight/addTacto directo desde el frame): centraliza el binding
// maniobra→tabla + la inyección de `session_id` (R5.11). El `created_by` lo fuerza el trigger server-side
// (R5.12, NO se manda). Es el SEAM de M3.1: agregar una maniobra = agregar su rama en
// `buildManeuverEventQuery` (util PURO `utils/maneuver-event-query.ts`) — el frame solo pasa
// `{maneuver, value}` y no conoce las tablas de spec 02. M2.2 cablea SOLO tacto + pesaje; el resto cae en
// `null` (no persiste) hasta M3.1.
//
// CONTRATO (spec 15 T5, mismo que events.ts): el local write SIEMPRE tiene éxito offline → devuelve ok
// apenas la fila está en SQLite. La AUTORIZACIÓN real (RLS), el tenant-check del `session_id`
// (tg_event_session_tenant_check, 0056) y el gating capa 2 (assert_data_keys_enabled, 0054) corren
// server-side al SUBIR; un rechazo lo maneja uploadData (descarta + superficia por el canal de status),
// NO el return de acá. Multi-tenant: el caller pasa profileId (del animal real) + sessionId (de la jornada);
// NUNCA se hardcodea establishment_id (lo deriva el trigger del perfil).
//
// La parte PURA (qué INSERT produce cada maniobra) vive en `utils/maneuver-event-query.ts` (testeable sin
// SDK). Este módulo solo hace la I/O (runLocalWrite) — por eso NO entra al grafo de node:test.

import { runLocalWrite } from './powersync/local-query';
import { buildSoftDeleteEventUpdate, type DeletableEventTable } from './powersync/local-reads';
import {
  buildManeuverEventQueries,
  type ManeuverEventInput,
} from '../utils/maneuver-event-query';
import {
  buildManeuverEventSoftDeleteQuery,
  type ManeuverDiscardTarget,
} from '../utils/maneuver-skip';

// ─── Error / Result uniforme (mismo shape que events.ts) ────────────────────────────────────

export type AppError = { kind: 'network' | 'unknown'; message: string };
export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type { ManeuverEventInput } from '../utils/maneuver-event-query';

/**
 * Persiste el/los write(s) del evento de una maniobra (R5.8: se guarda a medida que avanza el wizard, el
 * resumen es de verificación). CRUD-plano offline: arma el/los write(s) (buildManeuverEventQueries) y los
 * corre con runLocalWrite. Una maniobra que no persiste (valor `skipped`/sin dato) devuelve `ok:true` con
 * `persisted:false` (la secuencia avanza sin escribir, no es un error). `session_id` va en cada INSERT de
 * evento; `created_by`/`establishment_id` los fuerza el trigger server-side (R5.12). El gating capa 2
 * (0054 + 0091) y el tenant-check (0056) re-validan al SUBIR (un rechazo lo maneja uploadData + el canal de
 * status, R10.8 — NO el return de acá).
 *
 * MULTI-WRITE (M3.1): el raspado escribe 2 lab_samples (R6.11), la vacunación multi escribe N
 * sanitary_events (R6.1), dientes+CUT escribe 2 UPDATE. Se corren en orden; los CRUD-plano de PowerSync son
 * CrudEntries INDEPENDIENTES (cada write es su propia entry). Si UN write local falla (raro: error de
 * SQLite, no de autorización — esa es al subir), se corta y se devuelve el error (los writes ya corridos
 * quedan locales; offline-first los subirá). Idempotencia: el/los `eventId`(s) de cliente son estables por
 * captura → re-confirmar una corrección con el MISMO id no duplica (PowerSync LWW por PK); el caller genera
 * los ids por (animal, maniobra).
 */
export async function persistManeuverEvent(
  input: ManeuverEventInput,
): Promise<ServiceResult<{ persisted: boolean }>> {
  const queries = buildManeuverEventQueries(input);
  if (queries.length === 0) {
    // Maniobra no persistible (valor skipped / sin dato): la secuencia avanza, sin escribir.
    return { ok: true, value: { persisted: false } };
  }
  for (const query of queries) {
    const r = await runLocalWrite(query);
    if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  }
  return { ok: true, value: { persisted: true } };
}

/**
 * SOFT-DELETE de los eventos HUÉRFANOS de una corrección multi-write de conteo variable (R5.9). La vacunación
 * (R6.1) escribe N filas; al CORREGIR con MENOS vacunas (de 2 → 1), las filas extra ya escritas NO se pisan
 * por el re-INSERT (que solo toca las nuevas N) → quedarían huérfanas. El frame le pasa los `eventIds` de las
 * filas a retirar; cada uno se marca `deleted_at` (CrudEntry → uploadData lo sube; la RLS UPDATE owner|autor
 * es la barrera real). Offline-safe + idempotente (`deleted_at IS NULL` guard). Un raspado (conteo FIJO = 2)
 * no llama acá (no puede dejar huérfanos). NO es un borrado de cliente arbitrario: solo retira filas que ESTA
 * misma sesión acaba de escribir (ids estables del frame), nunca filas de otro origen.
 */
export async function softDeleteManeuverEvents(
  table: DeletableEventTable,
  eventIds: readonly string[],
): Promise<ServiceResult<{ deleted: number }>> {
  let deleted = 0;
  for (const id of eventIds) {
    const r = await runLocalWrite(buildSoftDeleteEventUpdate(table, id));
    if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
    deleted += 1;
  }
  return { ok: true, value: { deleted } };
}

/**
 * DESCARTA lo cargado al SALTEAR un animal (spec 03 delta `skip-animal-maniobra`, R5.15): soft-borra, por
 * tabla, las filas de evento que ESTE mismo frame escribió para ESTE animal (targets armados en el cliente por
 * `collectManeuverDiscardTargets` a partir del CaptureMap + los ids estables del frame). Mismo espíritu que
 * `softDeleteManeuverEvents` (retira SOLO filas que la sesión acaba de escribir, por ids de cliente — nunca un
 * borrado cross-tenant; la RLS UPDATE owner|autor 0026/0027 es la barrera real al subir). Offline-safe +
 * idempotente (`deleted_at IS NULL`). `dientes` (UPDATE de propiedad) queda FUERA por construcción del target.
 * FAIL-CLOSED: si UN write local falla, se corta y devuelve el error (el caller NO navega, deja reintentar).
 */
export async function discardManeuverEvents(
  targets: readonly ManeuverDiscardTarget[],
): Promise<ServiceResult<{ deleted: number }>> {
  let deleted = 0;
  for (const target of targets) {
    for (const id of target.ids) {
      const r = await runLocalWrite(buildManeuverEventSoftDeleteQuery(target.table, id));
      if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
      deleted += 1;
    }
  }
  return { ok: true, value: { deleted } };
}
