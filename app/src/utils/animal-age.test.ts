// Tests de la edad legible del animal (spec 10, T-UI.3 / R11.9). node:test puro.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAnimalAge, monthsBetween } from './animal-age.ts';

const NOW = new Date(2026, 5, 15); // 2026-06-15 (local)

// ─── formatAnimalAge: ausencia de fecha → null ─────────────────────────────────────────────

test('formatAnimalAge: null/undefined/vacío → null (el caller muestra "—")', () => {
  assert.equal(formatAnimalAge(null, NOW), null);
  assert.equal(formatAnimalAge(undefined, NOW), null);
  assert.equal(formatAnimalAge('', NOW), null);
});

test('formatAnimalAge: fecha malformada → null', () => {
  assert.equal(formatAnimalAge('2024', NOW), null);
  assert.equal(formatAnimalAge('15/06/2024', NOW), null);
  assert.equal(formatAnimalAge('2024-13-01', NOW), null); // mes inválido
  assert.equal(formatAnimalAge('2024-06-40', NOW), null); // día inválido
});

test('formatAnimalAge: fecha futura (dato inconsistente) → null (no inventamos edad)', () => {
  assert.equal(formatAnimalAge('2027-01-01', NOW), null);
  assert.equal(formatAnimalAge('2026-12-31', NOW), null);
});

// ─── formatAnimalAge: meses en el primer año ───────────────────────────────────────────────

test('formatAnimalAge: menos de 1 mes → "menos de 1 mes"', () => {
  assert.equal(formatAnimalAge('2026-06-01', NOW), 'menos de 1 mes'); // 14 días
  assert.equal(formatAnimalAge('2026-05-20', NOW), 'menos de 1 mes'); // 26 días (no llegó al 20→15)
});

test('formatAnimalAge: 1 mes exacto → "1 mes" (singular)', () => {
  assert.equal(formatAnimalAge('2026-05-15', NOW), '1 mes');
});

test('formatAnimalAge: N meses (plural) en el primer año', () => {
  assert.equal(formatAnimalAge('2026-02-15', NOW), '4 meses');
  assert.equal(formatAnimalAge('2025-07-15', NOW), '11 meses'); // 11 meses, aún < 1 año
});

// ─── formatAnimalAge: años completos ───────────────────────────────────────────────────────

test('formatAnimalAge: 1 año exacto → "1 año" (singular)', () => {
  assert.equal(formatAnimalAge('2025-06-15', NOW), '1 año');
});

test('formatAnimalAge: años completos (floor, plural)', () => {
  assert.equal(formatAnimalAge('2024-06-15', NOW), '2 años');
  assert.equal(formatAnimalAge('2022-01-01', NOW), '4 años'); // 4 años y meses → "4 años"
  assert.equal(formatAnimalAge('2020-06-15', NOW), '6 años');
});

test('formatAnimalAge: alta guiada year-only (AAAA-07-01) → años redondos', () => {
  // El alta guiada year-only guarda 'AAAA-07-01' (animal-birth-year.ts). Un animal "de 2022"
  // visto el 2026-06-15 tiene 3 años (julio 2022 → junio 2026 = 3 años 11 meses → "3 años").
  assert.equal(formatAnimalAge('2022-07-01', NOW), '3 años');
});

// ─── monthsBetween: la base aritmética ─────────────────────────────────────────────────────

test('monthsBetween: meses completos, descuenta el mes en curso incompleto', () => {
  assert.equal(monthsBetween('2026-05-15', NOW), 1); // exacto 1 mes
  assert.equal(monthsBetween('2026-05-16', NOW), 0); // aún no cumplió el mes (día 16 > 15)
  assert.equal(monthsBetween('2025-06-15', NOW), 12); // 1 año
  assert.equal(monthsBetween('2025-06-16', NOW), 11); // todavía no cumplió el año
});

test('monthsBetween: null para fecha ausente/inválida/futura', () => {
  assert.equal(monthsBetween(null, NOW), null);
  assert.equal(monthsBetween('nope', NOW), null);
  assert.equal(monthsBetween('2027-01-01', NOW), null);
});
