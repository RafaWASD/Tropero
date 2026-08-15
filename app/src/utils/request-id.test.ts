// Test de FORMA del requestId de correlación (spec 23). node:test.
// newRequestId() es un uuid v4 random (globalThis.crypto.randomUUID) — sin PII, sin significado.
// El test ejerce la MISMA función que consume el camino caliente (captureExceptionSafe / invokeFn):
// verifica que la forma sea uuid y que dos llamadas colisionen jamás (correlación única por-captura).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { newRequestId } from './request-id.ts';

// uuid canónico: 8-4-4-4-12 hex. No exige el nibble de versión/variant — solo la FORMA.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

test('newRequestId(): devuelve un string con forma de uuid', () => {
  const id = newRequestId();
  assert.equal(typeof id, 'string');
  assert.match(id, UUID_RE);
});

test('newRequestId(): dos llamadas devuelven ids distintos', () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.match(a, UUID_RE);
  assert.match(b, UUID_RE);
  assert.notEqual(a, b);
});
