// Tests de la categoría inicial al alta (spec 02 R4.7) — espejo de compute_category sin eventos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeInitialCategoryCode } from './animal-category.ts';

// Fecha fija para determinismo.
const TODAY = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

function isoDaysAgo(n: number): string {
  const d = new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

test('R4.7 macho < 1 año → ternero', () => {
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(180), TODAY), 'ternero');
});

test('R4.7 macho ≥ 1 año → torito (conservador)', () => {
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(540), TODAY), 'torito');
});

test('R4.7 macho sin fecha → torito (default conservador)', () => {
  assert.equal(computeInitialCategoryCode('male', null, TODAY), 'torito');
});

test('R4.7 hembra < 1 año → ternera', () => {
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(180), TODAY), 'ternera');
});

test('R4.7 hembra ≥ 1 año → vaquillona', () => {
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(540), TODAY), 'vaquillona');
});

test('R4.7 hembra sin fecha → vaquillona', () => {
  assert.equal(computeInitialCategoryCode('female', null, TODAY), 'vaquillona');
});

test('R4.7 borde: exactamente 365 días NO es cría (≥ 1 año)', () => {
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(365), TODAY), 'vaquillona');
  assert.equal(computeInitialCategoryCode('female', isoDaysAgo(364), TODAY), 'ternera');
});

test('R4.7 fecha inválida/futura se trata como desconocida (default por sexo)', () => {
  // Fecha futura → no es cría conocida → default por sexo.
  assert.equal(computeInitialCategoryCode('male', isoDaysAgo(-10), TODAY), 'torito');
  // Formato basura → desconocida.
  assert.equal(computeInitialCategoryCode('female', 'no-es-fecha', TODAY), 'vaquillona');
});
