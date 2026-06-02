// Tests de la resolución del rodeo default del alta (spec 09 R6). Solo la lógica PURA
// (resolveDefaultRodeoId); el I/O de storage (SecureStore/localStorage) + la query DB no se
// testean bajo node (mismo criterio que establishment-store.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveDefaultRodeoId } from './last-rodeo.ts';

const RODEOS = ['r-first', 'r-mid', 'r-last']; // orden created_at asc (R6.4: primer creado = head)

test('R6.2: el persistido gana si referencia un rodeo activo del set', () => {
  assert.equal(resolveDefaultRodeoId(RODEOS, 'r-mid', 'r-last'), 'r-mid');
});

test('R6.3: si no hay persistido, gana el último usado en DB (si es del set)', () => {
  assert.equal(resolveDefaultRodeoId(RODEOS, null, 'r-last'), 'r-last');
});

test('R6.4: sin persistido ni último usado → primer rodeo activo creado (head del set)', () => {
  assert.equal(resolveDefaultRodeoId(RODEOS, null, null), 'r-first');
});

test('R6.2/R6.3: persistido stale (no está en el set) cae al siguiente criterio', () => {
  // persistido apunta a un rodeo borrado/inactivo → ignorado → DB lastUsed.
  assert.equal(resolveDefaultRodeoId(RODEOS, 'r-deleted', 'r-mid'), 'r-mid');
  // y si el DB lastUsed también es stale → primer creado.
  assert.equal(resolveDefaultRodeoId(RODEOS, 'r-deleted', 'r-also-gone'), 'r-first');
});

test('R6.4: set vacío → null (la UI bloquea con CTA al wizard)', () => {
  assert.equal(resolveDefaultRodeoId([], 'whatever', 'whatever'), null);
});

test('R6.6: con un solo rodeo el default es ese (preseleccionado fijo)', () => {
  assert.equal(resolveDefaultRodeoId(['only'], null, null), 'only');
  assert.equal(resolveDefaultRodeoId(['only'], 'stale', null), 'only');
});
