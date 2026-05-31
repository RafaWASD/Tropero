// Tests de la lógica pura del rastro de visitados (spec 01, R6.9).
// node:test + type-stripping nativo (Node 24), sin Jest. La lógica pura vive en
// utils/establishment (sin imports de RN/expo); establishment-store solo hace I/O de
// plataforma (SecureStore/localStorage), no testeable bajo node. Importamos desde utils.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { promoteInTrail } from '../utils/establishment.ts';

test('R6.9: promover un id nuevo lo pone al frente', () => {
  assert.deepEqual(promoteInTrail(['a', 'b'], 'c'), ['c', 'a', 'b']);
});

test('R6.9: promover un id existente lo sube al frente sin duplicar (bug (b) de Raf)', () => {
  // El campo "saliente" (b) sigue en el rastro al promover a otro; al volver a abrirlo,
  // sube al frente. Esto es lo que hace reaparecer al campo en visitados.
  assert.deepEqual(promoteInTrail(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
});

test('R6.9: el rastro se recorta a max (no crece sin límite)', () => {
  const trail = ['a', 'b', 'c', 'd'];
  assert.deepEqual(promoteInTrail(trail, 'e', 3), ['e', 'a', 'b']);
});

test('R6.9: promover el head ya presente no cambia el orden relativo del resto', () => {
  assert.deepEqual(promoteInTrail(['a', 'b', 'c'], 'a'), ['a', 'b', 'c']);
});

test('R6.9: rastro vacío → solo el id promovido', () => {
  assert.deepEqual(promoteInTrail([], 'x'), ['x']);
});

test('R6.9: no muta la entrada', () => {
  const trail = ['a', 'b'];
  const out = promoteInTrail(trail, 'c');
  assert.deepEqual(trail, ['a', 'b']); // intacto
  assert.notEqual(out, trail);
});
