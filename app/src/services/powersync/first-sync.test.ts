// Tests del helper de coordinación del primer sync (spec 15, fix showstopper onboarding/listas vacías).
// node:test. Importa first-sync.ts directo: el import de `./database` (que arrastra react-native) es LAZY
// (require dentro de resolveDb), y como TODOS los tests inyectan un `db` fake, ese require NUNCA se
// ejecuta → el grafo de test queda limpio (mismo motivo del split online-guard-pure vs online-guard).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { waitForUsableSync, isFirstSyncPending, FIRST_SYNC_TIMEOUT_MS } from './first-sync.ts';

// ── Fake mínimo del DB de PowerSync: solo lo que first-sync toca (currentStatus.hasSynced +
//    waitForFirstSync). `waitForFirstSync` recibe un AbortSignal y se resuelve/rechaza según el caso. ──
type FakeDb = {
  currentStatus: { hasSynced?: boolean };
  waitForFirstSync: (signal?: AbortSignal) => Promise<void>;
};

function makeDb(opts: {
  hasSynced?: boolean;
  // Comportamiento de waitForFirstSync: 'completes' (resuelve y marca hasSynced), 'never' (cuelga hasta
  // el abort → rechaza con AbortError), 'rejects' (rechaza con un error cualquiera sin completar el sync).
  firstSync?: 'completes' | 'never' | 'rejects';
}): FakeDb {
  const status: { hasSynced?: boolean } = { hasSynced: opts.hasSynced };
  return {
    currentStatus: status,
    waitForFirstSync(signal?: AbortSignal): Promise<void> {
      if (opts.firstSync === 'completes') {
        // El first-sync baja datos → hasSynced pasa a true (como el SDK real al completar).
        status.hasSynced = true;
        return Promise.resolve();
      }
      if (opts.firstSync === 'rejects') {
        return Promise.reject(new Error('sync stream error'));
      }
      // 'never': resuelve solo cuando el AbortController del timeout dispara abort.
      return new Promise((_resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    },
  };
}

// ── waitForUsableSync ────────────────────────────────────────────────────────────────

test("waitForUsableSync: hasSynced=true al instante → 'cached' SIN esperar (caso offline/reload)", async () => {
  let called = false;
  const db = makeDb({ hasSynced: true });
  db.waitForFirstSync = () => {
    called = true;
    return Promise.resolve();
  };
  // db cast a any: el fake implementa solo el subset que el helper toca.
  const r = await waitForUsableSync({ db: db as any, timeoutMs: 50 });
  assert.equal(r, 'cached');
  assert.equal(called, false, 'no debe llamar waitForFirstSync si ya hay sync persistido');
});

test("waitForUsableSync: first-sync completa durante la espera → 'synced'", async () => {
  const db = makeDb({ hasSynced: false, firstSync: 'completes' });
  const r = await waitForUsableSync({ db: db as any, timeoutMs: 200 });
  assert.equal(r, 'synced');
  assert.equal(db.currentStatus.hasSynced, true);
});

test("waitForUsableSync: el first-sync nunca llega → timeout aborta → 'timeout'", async () => {
  const db = makeDb({ hasSynced: false, firstSync: 'never' });
  const r = await waitForUsableSync({ db: db as any, timeoutMs: 30 });
  assert.equal(r, 'timeout');
  // hasSynced sigue false: degradamos al estado actual (el caller se queda en loading / el listener re-resuelve).
  assert.notEqual(db.currentStatus.hasSynced, true);
});

test("waitForUsableSync: waitForFirstSync rechaza sin completar → 'timeout' (no lanza)", async () => {
  const db = makeDb({ hasSynced: false, firstSync: 'rejects' });
  // NO debe propagar el error: lo traduce a 'timeout' (el caller nunca hace try/catch).
  const r = await waitForUsableSync({ db: db as any, timeoutMs: 200 });
  assert.equal(r, 'timeout');
});

test('waitForUsableSync: usa FIRST_SYNC_TIMEOUT_MS por default (constante exportada y razonable)', () => {
  // Coordinación con el fallback de splash del RootGate (~5s): el timeout debe ser menor.
  assert.equal(typeof FIRST_SYNC_TIMEOUT_MS, 'number');
  assert.ok(FIRST_SYNC_TIMEOUT_MS > 0 && FIRST_SYNC_TIMEOUT_MS < 5000);
});

// ── isFirstSyncPending ───────────────────────────────────────────────────────────────

test('isFirstSyncPending: hasSynced=true → false (ya sincronizó, no está pendiente)', () => {
  const db = makeDb({ hasSynced: true });
  assert.equal(isFirstSyncPending(db as any), false);
});

test('isFirstSyncPending: hasSynced=false → true (todavía pendiente)', () => {
  const db = makeDb({ hasSynced: false });
  assert.equal(isFirstSyncPending(db as any), true);
});

test('isFirstSyncPending: hasSynced=undefined → true (sin poblar = pendiente, fail-safe)', () => {
  const db = makeDb({});
  assert.equal(isFirstSyncPending(db as any), true);
});
