// local-query.ts — capa de I/O del swap de lectura (spec 15, T3). Aísla el acceso al SDK de
// PowerSync (getPowerSync().getAll + currentStatus.hasSynced) del resto de los services.
//
// Importa el SDK (vía database.ts → require por plataforma) → este módulo NO debe entrar al grafo
// de node:test (los SQL builders puros viven en local-reads.ts, que SÍ se testea sin SDK).
//
// "Aún no sincronizó" (T3.1, R5.4): distinguimos "tabla vacía porque genuinamente no hay filas" de
// "todavía no bajó el primer sync". Si el primer sync NO ocurrió (`currentStatus.hasSynced` falsy) y
// la query vino vacía → es el caso "sincronizando…", no "no hay datos". Lo señalizamos con un AppError
// `kind:'network'` (la UI ya lo trata como transitorio/reintentable) + un message es-AR explícito,
// para NO romper la exhaustividad de los call sites (no se agrega un `kind` nuevo a AppError — decisión
// del leader, punto 3). Cuando hasSynced es true, una query vacía es un resultado legítimo (sin filas).

import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { getPowerSync } from './database';
import type { LocalQuery } from './local-reads';

/** Mensaje es-AR de degradación cuando el catálogo/contexto aún no sincronizó (R5.4). */
export const SYNCING_MESSAGE = 'Sincronizando datos del campo… Probá de nuevo en unos segundos.';

/** AppError uniforme (mismo shape que los services). kind:'network' = transitorio/reintentable. */
export type LocalReadError = { kind: 'network' | 'unknown'; message: string };

export type LocalReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LocalReadError };

/** ¿Ya bajó el primer sync? `hasSynced` es `boolean | undefined` en el SDK → undefined = no aún. */
function hasSynced(db: AbstractPowerSyncDatabase): boolean {
  return db.currentStatus?.hasSynced === true;
}

/**
 * Ejecuta una LocalQuery contra el SQLite local y devuelve las filas crudas. Si el primer sync aún
 * no ocurrió y NO hay filas, degrada a un error `network` "Sincronizando…" (R5.4) en vez de devolver
 * vacío (que la UI confundiría con "no hay datos"). Si hasSynced=true, vacío es un resultado válido.
 *
 * @param emptyIsSyncing  si false, una query legítimamente-vacía NUNCA degrada (p.ej. lecturas de un
 *                        recurso puntual por id donde "no encontrado" es un resultado esperado y el
 *                        caller ya lo maneja). Default true (catálogos/listas).
 */
export async function runLocalQuery<Row = Record<string, unknown>>(
  query: LocalQuery,
  options: { emptyIsSyncing?: boolean; db?: AbstractPowerSyncDatabase } = {},
): Promise<LocalReadResult<Row[]>> {
  const db = options.db ?? getPowerSync();
  const emptyIsSyncing = options.emptyIsSyncing ?? true;
  let rows: Row[];
  try {
    rows = await db.getAll<Row>(query.sql, query.args as unknown[]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'unknown', message: message || 'Error al leer datos locales.' } };
  }
  if (rows.length === 0 && emptyIsSyncing && !hasSynced(db)) {
    return { ok: false, error: { kind: 'network', message: SYNCING_MESSAGE } };
  }
  return { ok: true, value: rows };
}

/**
 * Igual que runLocalQuery pero para lecturas que esperan 0 o 1 fila (maybeSingle). Devuelve la fila o
 * null. La degradación "sincronizando" se aplica solo si `emptyIsSyncing` (default false: un detalle
 * por id ausente suele ser un caso de negocio que el caller maneja, no necesariamente falta de sync).
 */
export async function runLocalQuerySingle<Row = Record<string, unknown>>(
  query: LocalQuery,
  options: { emptyIsSyncing?: boolean; db?: AbstractPowerSyncDatabase } = {},
): Promise<LocalReadResult<Row | null>> {
  const r = await runLocalQuery<Row>(query, {
    emptyIsSyncing: options.emptyIsSyncing ?? false,
    db: options.db,
  });
  if (!r.ok) return r;
  return { ok: true, value: r.value[0] ?? null };
}
