// Tests de la lógica pura de inputs de carga de evento (spec 02 C3.1). Pura, sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONDITION_SCORES,
  isValidConditionScore,
  formatConditionScore,
  validateWeight,
  WEIGHT_KG_LIMIT,
  validateEventDate,
  sanitizeObservationInput,
  validateObservation,
  OBSERVATION_MAX_LENGTH,
} from './event-input.ts';

// ─── Condición corporal: 17 valores cerrados (1.00 → 5.00 paso 0.25) ──────────────────────

test('CONDITION_SCORES: exactamente 17 valores de 1.00 a 5.00 paso 0.25', () => {
  assert.equal(CONDITION_SCORES.length, 17);
  assert.equal(CONDITION_SCORES[0], 1);
  assert.equal(CONDITION_SCORES[CONDITION_SCORES.length - 1], 5);
  // Sin error de punto flotante acumulado: cada valor es múltiplo exacto de 0.25.
  for (const s of CONDITION_SCORES) {
    assert.ok(Math.abs(s * 4 - Math.round(s * 4)) < 1e-9, `${s} no es múltiplo de 0.25`);
  }
  // Cubre los esperados del CHECK del server (0028).
  assert.deepEqual(
    [...CONDITION_SCORES],
    [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5],
  );
});

test('isValidConditionScore: acepta los válidos, rechaza intermedios/fuera de rango', () => {
  assert.equal(isValidConditionScore(3.25), true);
  assert.equal(isValidConditionScore(1), true);
  assert.equal(isValidConditionScore(5), true);
  assert.equal(isValidConditionScore(3.1), false); // no es paso 0.25
  assert.equal(isValidConditionScore(0.75), false); // < 1
  assert.equal(isValidConditionScore(5.25), false); // > 5
});

test('formatConditionScore: entero sin decimales, fracción con coma es-AR', () => {
  assert.equal(formatConditionScore(3), '3');
  assert.equal(formatConditionScore(3.25), '3,25');
  assert.equal(formatConditionScore(3.5), '3,5');
  assert.equal(formatConditionScore(4.75), '4,75');
});

// ─── Peso: validación de submit (> 0, parte entera ≤ 4 cifras / < 10000) ──────────────────

test('validateWeight: número válido', () => {
  const r = validateWeight('320,5'); // coma es-AR
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 320.5);
  const r2 = validateWeight('180');
  assert.equal(r2.ok, true);
  if (r2.ok) assert.equal(r2.value, 180);
  // El bovino más pesado registrado (1.740 kg) pasa.
  const r3 = validateWeight('1740');
  assert.equal(r3.ok, true);
  if (r3.ok) assert.equal(r3.value, 1740);
});

test('validateWeight: vacío → error (requerido)', () => {
  const r = validateWeight('');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /kilos/);
});

test('validateWeight: <= 0 → error', () => {
  assert.equal(validateWeight('0').ok, false);
});

test('FIXB validateWeight: 4 cifras (9999) OK; 5 cifras (10000) → error de dominio', () => {
  // 9999 (límite máximo de 4 cifras) pasa.
  const ok = validateWeight('9999');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value, 9999);
  // 9999,99 (4 cifras enteras + decimales) sigue OK.
  assert.equal(validateWeight('9999,99').ok, true);
  // 10000 (5 cifras) → rechazado con el copy de dominio.
  const bad = validateWeight('10000');
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /4 cifras/);
  // El límite es EXCLUSIVO: WEIGHT_KG_LIMIT (10000) mismo es rechazado.
  assert.equal(validateWeight(String(WEIGHT_KG_LIMIT)).ok, false);
});

test('validateWeight: basura → error (defensa; el sanitizer ya filtra en vivo)', () => {
  assert.equal(validateWeight('abc').ok, false);
});

// ─── Fecha del evento: formato + no-futura ────────────────────────────────────────────────

const TODAY = new Date(Date.UTC(2025, 2, 15)); // 15 mar 2025

test('validateEventDate: fecha válida pasada', () => {
  const r = validateEventDate('2025-01-10', TODAY);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, '2025-01-10');
});

test('validateEventDate: HOY es válida (no es futura)', () => {
  assert.equal(validateEventDate('2025-03-15', TODAY).ok, true);
});

test('validateEventDate: vacío → error (requerida)', () => {
  assert.equal(validateEventDate('', TODAY).ok, false);
});

test('validateEventDate: parcial / formato inválido → error', () => {
  assert.equal(validateEventDate('2025-03', TODAY).ok, false);
  assert.equal(validateEventDate('2025-13-01', TODAY).ok, false); // mes 13
  assert.equal(validateEventDate('2025-02-30', TODAY).ok, false); // 30 feb no existe
});

test('validateEventDate: futura → error', () => {
  const r = validateEventDate('2025-03-16', TODAY);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /futura/);
});

// ─── Observación: tope de largo + validación ──────────────────────────────────────────────

test('sanitizeObservationInput: acota al tope, no filtra caracteres', () => {
  assert.equal(sanitizeObservationInput('Renguea de la pata'), 'Renguea de la pata');
  const long = 'a'.repeat(OBSERVATION_MAX_LENGTH + 50);
  assert.equal(sanitizeObservationInput(long).length, OBSERVATION_MAX_LENGTH);
});

test('validateObservation: texto válido', () => {
  const r = validateObservation('  Renguea de la pata derecha  ');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 'Renguea de la pata derecha'); // trimmeado
});

test('validateObservation: vacío o solo espacios → error', () => {
  assert.equal(validateObservation('').ok, false);
  assert.equal(validateObservation('    ').ok, false);
});

test('validateObservation: dentro del tope', () => {
  const r = validateObservation('x'.repeat(OBSERVATION_MAX_LENGTH));
  assert.equal(r.ok, true);
});
