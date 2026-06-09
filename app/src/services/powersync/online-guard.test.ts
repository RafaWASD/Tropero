// Tests del fast-fail de writes ONLINE-only offline (spec 15, fix UX/robustez). node:test. PURO.
//
// Sólo testeamos la parte PURA (`offlineError`), importada desde online-guard-pure.ts (SIN SDK).
// `assertOnline` (I/O) vive en online-guard.ts, que importa el SDK de PowerSync vía `./database` → NO
// debe entrar al grafo de node:test (mismo patrón que status-derive vs status).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { offlineError } from './online-guard-pure.ts';

const MSG = 'Necesitás conexión para editar tu perfil.';

test('offlineError: connected=true → null (online, seguí con el call)', () => {
  assert.equal(offlineError(true, MSG), null);
});

test('offlineError: connected=false → error network con el message', () => {
  assert.deepEqual(offlineError(false, MSG), { kind: 'network', message: MSG });
});

test('offlineError: connected=undefined → error network (fail-closed)', () => {
  // El status del SDK aún sin poblar (undefined) se trata como OFFLINE: ante la duda fallamos
  // rápido en vez de colgar la pantalla.
  assert.deepEqual(offlineError(undefined, MSG), { kind: 'network', message: MSG });
});

test('offlineError: el message se propaga tal cual (distinto copy por call-site)', () => {
  const other = 'Necesitás conexión para esta acción.';
  assert.deepEqual(offlineError(false, other), { kind: 'network', message: other });
});
