// Tests de la validación PURA del rango de fechas del filtro SIGSA (spec 08, R9.3). node:test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidBirthDateRange, normalizeFilterDate } from './sigsa-filters';

// ─── isValidBirthDateRange ───────────────────────────────────────────────────────────────────────────────

test('isValidBirthDateRange: ambas vacías → OK (sin filtro)', () => {
  assert.deepEqual(isValidBirthDateRange(null, null), { ok: true });
  assert.deepEqual(isValidBirthDateRange('', ''), { ok: true });
});

test('isValidBirthDateRange: solo una completa → OK (la otra es "sin límite")', () => {
  assert.deepEqual(isValidBirthDateRange('2025-01-01', ''), { ok: true });
  assert.deepEqual(isValidBirthDateRange('', '2025-12-31'), { ok: true });
});

test('isValidBirthDateRange: parcial (el usuario tipeando) → OK (no molesta)', () => {
  assert.deepEqual(isValidBirthDateRange('2025-08', '2025-12-31'), { ok: true });
  assert.deepEqual(isValidBirthDateRange('2025-01-01', '2025'), { ok: true });
});

test('isValidBirthDateRange: rango coherente (desde <= hasta) → OK', () => {
  assert.deepEqual(isValidBirthDateRange('2025-01-01', '2025-12-31'), { ok: true });
  assert.deepEqual(isValidBirthDateRange('2025-06-15', '2025-06-15'), { ok: true }); // iguales OK
});

test('isValidBirthDateRange: desde > hasta → error apuntando al "hasta"', () => {
  const r = isValidBirthDateRange('2025-12-31', '2025-01-01');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.field, 'to');
    assert.match(r.error, /no puede ser posterior/);
  }
});

test('isValidBirthDateRange: mes/día fuera de rango → tratado como parcial (no valida, no crashea)', () => {
  // '2025-13-01' no es una fecha completa válida → se ignora (no error de rango).
  assert.deepEqual(isValidBirthDateRange('2025-13-01', '2025-12-31'), { ok: true });
  assert.deepEqual(isValidBirthDateRange('2025-01-01', '2025-02-31'), { ok: true });
});

// ─── normalizeFilterDate ─────────────────────────────────────────────────────────────────────────────────

test('normalizeFilterDate: completa válida → la devuelve; vacía/parcial/inválida → null', () => {
  assert.equal(normalizeFilterDate('2025-08-10'), '2025-08-10');
  assert.equal(normalizeFilterDate(''), null);
  assert.equal(normalizeFilterDate('2025-08'), null); // parcial
  assert.equal(normalizeFilterDate('2025-13-01'), null); // mes inválido
  assert.equal(normalizeFilterDate(null), null);
  assert.equal(normalizeFilterDate(undefined), null);
});
