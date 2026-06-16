// Tests de la lógica PURA del STEPPER de condición corporal (spec 03 M3.2a, R6.6). node:test.
// Foco: clamp al rango [1, 5], snap a la grilla de 0,25, ±, límites, formato es-AR (coma decimal).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decrementScore,
  formatScoreAR,
  incrementScore,
  isScoreAtMax,
  isScoreAtMin,
  snapScore,
  SCORE_DEFAULT,
  SCORE_MAX,
  SCORE_MIN,
  SCORE_STEP,
} from './condition-stepper';

// ─── Constantes de la escala (R6.6: 1,00–5,00 step 0,25, default 3,00) ──────────────────────

test('R6.6: la escala es 1–5 con step 0,25 y default 3', () => {
  assert.equal(SCORE_MIN, 1);
  assert.equal(SCORE_MAX, 5);
  assert.equal(SCORE_STEP, 0.25);
  assert.equal(SCORE_DEFAULT, 3);
});

// ─── snapScore: clamp + snap a la grilla ─────────────────────────────────────────────────────

test('snapScore: un valor ya en grilla queda igual', () => {
  assert.equal(snapScore(3), 3);
  assert.equal(snapScore(3.25), 3.25);
  assert.equal(snapScore(4.75), 4.75);
});

test('snapScore: clampa por debajo de 1,00 y por encima de 5,00', () => {
  assert.equal(snapScore(0), 1);
  assert.equal(snapScore(0.5), 1);
  assert.equal(snapScore(6), 5);
  assert.equal(snapScore(5.5), 5);
});

test('snapScore: snapea un valor entre marcas a la más cercana (defensivo ante dato heredado)', () => {
  assert.equal(snapScore(2.1), 2); // 2.1 → 2.00 (más cerca de 2 que de 2.25)
  assert.equal(snapScore(2.2), 2.25); // 2.2 → 2.25
  assert.equal(snapScore(3.4), 3.5); // 3.4 → 3.50
});

test('snapScore: un valor no finito (NaN/Infinity) vuelve al default, no rompe', () => {
  // No-finito = entrada inválida → cae al default (3) en vez de propagar Infinity/NaN a la grilla.
  assert.equal(snapScore(NaN), SCORE_DEFAULT);
  assert.equal(snapScore(Infinity), SCORE_DEFAULT);
  assert.equal(snapScore(-Infinity), SCORE_DEFAULT);
});

// ─── incrementScore / decrementScore: ± un paso, respetando límites ──────────────────────────

test('incrementScore: sube exactamente 0,25 sin drift de coma flotante', () => {
  assert.equal(incrementScore(3), 3.25);
  assert.equal(incrementScore(3.25), 3.5);
  // El caso clásico de drift: 0.1+0.2 != 0.3. Acá 3 + 0.25 debe dar 3.25 EXACTO (no 3.2499…).
  assert.equal(incrementScore(3) === 3.25, true);
});

test('incrementScore: NO pasa de 5,00 (tope)', () => {
  assert.equal(incrementScore(5), 5);
  assert.equal(incrementScore(4.75), 5);
});

test('decrementScore: baja exactamente 0,25', () => {
  assert.equal(decrementScore(3), 2.75);
  assert.equal(decrementScore(1.25), 1);
});

test('decrementScore: NO baja de 1,00 (piso)', () => {
  assert.equal(decrementScore(1), 1);
});

test('± son inversas dentro del rango (ida y vuelta vuelve al mismo valor)', () => {
  for (let v = SCORE_MIN; v <= SCORE_MAX; v += SCORE_STEP) {
    const snapped = snapScore(v);
    if (snapped > SCORE_MIN && snapped < SCORE_MAX) {
      assert.equal(decrementScore(incrementScore(snapped)), snapped);
      assert.equal(incrementScore(decrementScore(snapped)), snapped);
    }
  }
});

// ─── isScoreAtMin / isScoreAtMax: gates de los botones ───────────────────────────────────────

test('isScoreAtMin/Max: detectan los límites para deshabilitar − / +', () => {
  assert.equal(isScoreAtMin(1), true);
  assert.equal(isScoreAtMin(1.25), false);
  assert.equal(isScoreAtMax(5), true);
  assert.equal(isScoreAtMax(4.75), false);
});

// ─── formatScoreAR: es-AR (coma decimal + 2 decimales fijos) ─────────────────────────────────

test('formatScoreAR: coma decimal es-AR + SIEMPRE 2 decimales', () => {
  assert.equal(formatScoreAR(3), '3,00');
  assert.equal(formatScoreAR(3.25), '3,25');
  assert.equal(formatScoreAR(4.5), '4,50');
  assert.equal(formatScoreAR(1), '1,00');
  assert.equal(formatScoreAR(5), '5,00');
});

test('formatScoreAR: snapea antes de formatear (un valor fuera de grilla se muestra en grilla)', () => {
  assert.equal(formatScoreAR(2.1), '2,00');
  assert.equal(formatScoreAR(6), '5,00');
});
