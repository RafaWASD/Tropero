// first-sync.ts — coordinación del PRIMER sync de PowerSync para el bootstrap del cliente (spec 15,
// fix showstopper "app aterriza en ONBOARDING / listas vacías").
//
// PROBLEMA: el gate de establecimiento y las lecturas resuelven el SQLite local one-shot ANTES de que
// el first-sync baje los datos (el SQLite arranca vacío). `runLocalQuery` ya distingue "vacío +
// !hasSynced" devolviéndolo como error `network`/"Sincronizando…" (local-query.ts), pero el bootstrap
// del EstablishmentContext lo colapsaba a `no_establishments` → onboarding fantasma.
//
// Este helper le da al bootstrap un punto de espera: `waitForUsableSync` resuelve cuando hay datos
// USABLES en el SQLite local — ya sea porque el sync persistido en disco se restauró (offline/reload:
// `hasSynced === true` AL INSTANTE, NO esperamos red), o porque el first-sync completó, o porque pasó
// el timeout (degradamos al estado actual sin colgar).
//
// PURO de lógica salvo el acceso al SDK (lo inyectamos vía `db` para testear con un fake; el default es
// getPowerSync de ./database). NUNCA loguea token/secretos (no loguea nada).
//
// IMPORT LAZY de `./database` (require dentro de `resolveDb`, NO import estático): `./database` arrastra
// `react-native` (Platform) al grafo del módulo, lo que rompería node:test (mismo motivo por el que
// online-guard.ts no entra al grafo de test). Como el test SIEMPRE inyecta `db`, el require nunca se
// ejecuta bajo test → first-sync.test.ts puede importar este archivo directo y cubrir cached/synced/timeout.

import type { AbstractPowerSyncDatabase } from '@powersync/common';

/** Resuelve el DB: el inyectado (tests / call-sites que ya lo tienen) o el singleton (lazy require). */
function resolveDb(db?: AbstractPowerSyncDatabase): AbstractPowerSyncDatabase {
  if (db) return db;
  // require diferido: solo se evalúa en runtime de app (cuando NO se inyecta db) → fuera del grafo de test.
  const { getPowerSync } = require('./database') as typeof import('./database');
  return getPowerSync();
}

/**
 * Timeout por defecto de `waitForUsableSync`. Coordinado con el fallback que destapa el splash en el
 * RootGate (`_layout.tsx`, ~5s): este timeout debe ser MENOR para que el contexto de establecimiento
 * resuelva su ruta ANTES de que el splash se destape (así, al irse el splash, ya hay ruta resuelta;
 * y si el sync llega más tarde, el listener del contexto re-rutea de onboarding a home).
 */
export const FIRST_SYNC_TIMEOUT_MS = 4500;

/** Resultado de la espera del primer sync usable. */
export type UsableSyncResult =
  /** Había un sync persistido en disco (`hasSynced` restaurado al boot) — no se esperó red. */
  | 'cached'
  /** El first-sync completó durante la espera (`hasSynced` quedó true). */
  | 'synced'
  /** Se agotó el timeout (o `waitForFirstSync` erró) sin un first-sync — degradamos al estado actual. */
  | 'timeout';

/** ¿`currentStatus.hasSynced` es estrictamente true? (boolean|undefined en el SDK → undefined = no aún). */
function hasSynced(db: AbstractPowerSyncDatabase): boolean {
  return db.currentStatus?.hasSynced === true;
}

/**
 * ¿El primer sync todavía está pendiente? `true` mientras `hasSynced` no sea estrictamente true.
 * El gate del EstablishmentContext lo usa para decidir si un `network` ("Sincronizando…") es
 * transitorio (first-sync en vuelo → quedarse en loading) o genuino (ya sincronizó → no hay datos).
 */
export function isFirstSyncPending(db?: AbstractPowerSyncDatabase): boolean {
  return !hasSynced(resolveDb(db));
}

/**
 * Espera a que haya datos USABLES en el SQLite local antes de que el bootstrap lea memberships.
 *
 *  - Si `hasSynced === true` AL INSTANTE → `'cached'` sin esperar. CLAVE para offline/reload: PowerSync
 *    restaura `hasSynced` de disco al boot (IndexedDB en web). Si esperáramos `waitForFirstSync` sin
 *    chequear esto, offline colgaría hasta el timeout (no hay red que complete un nuevo first-sync).
 *  - Si no: `await db.waitForFirstSync(signal)` con un AbortController + setTimeout(abort, timeoutMs).
 *    Si tras eso `hasSynced` quedó true → `'synced'`; si abortó/erró → `'timeout'` (degradación: el
 *    caller resuelve con lo que haya en local y el listener re-resolverá cuando el sync llegue tarde).
 *
 * NO lanza: cualquier error de `waitForFirstSync` (incl. AbortError del timeout) se traduce a
 * `'synced'`/`'timeout'` según `hasSynced` final. El caller nunca tiene que try/catch.
 */
export async function waitForUsableSync(options: {
  timeoutMs?: number;
  db?: AbstractPowerSyncDatabase;
} = {}): Promise<UsableSyncResult> {
  const db = resolveDb(options.db);
  const timeoutMs = options.timeoutMs ?? FIRST_SYNC_TIMEOUT_MS;

  // Caso offline/reload: hay un sync persistido restaurado de disco → datos usables YA, no esperamos red.
  if (hasSynced(db)) return 'cached';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await db.waitForFirstSync(controller.signal);
  } catch {
    // AbortError del timeout, o cualquier otro error de la espera: NO propagamos. El veredicto lo da
    // el `hasSynced` final de abajo (puede que el sync haya completado justo antes del abort).
  } finally {
    clearTimeout(timer);
  }

  // ¿Completó el first-sync durante la espera? Si sí, hay datos usables; si no, fue timeout.
  return hasSynced(db) ? 'synced' : 'timeout';
}
