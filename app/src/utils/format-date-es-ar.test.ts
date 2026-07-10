// Tests del formateo ÚNICO de fechas es-AR para display (corrección cross-cutting, 2026-07). node:test.
// Foco: dd/mm/aaaa, contextual dd/mm (mismo año), fecha+hora, y la TZ-SAFETY string-pura para date-only
// (lección del rojo e2e 777: NUNCA driftea ±1 día sin importar el huso del runner).

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDateEsAr, formatDateCompactEsAr, formatDateTimeEsAr } from './format-date-es-ar.ts';

// ─── formatDateEsAr ──────────────────────────────────────────────────────────────────────

test('formatDateEsAr: date-only AAAA-MM-DD → dd/mm/aaaa', () => {
  assert.equal(formatDateEsAr('2026-06-07'), '07/06/2026');
  assert.equal(formatDateEsAr('2024-12-25'), '25/12/2024');
  assert.equal(formatDateEsAr('2025-01-08'), '08/01/2025');
});

test('formatDateEsAr: null / undefined / vacío / basura → "—" (nunca "null", nunca ISO crudo)', () => {
  assert.equal(formatDateEsAr(null), '—');
  assert.equal(formatDateEsAr(undefined), '—');
  assert.equal(formatDateEsAr(''), '—');
  assert.equal(formatDateEsAr('   '), '—');
  assert.equal(formatDateEsAr('no-es-fecha'), '—');
  // Nunca filtra un ISO crudo ni la palabra null.
  assert.ok(!/null/i.test(formatDateEsAr(null)));
});

test('formatDateEsAr: TZ-SAFE — date-only NO driftea (string-puro, sin new Date)', () => {
  // El caso exacto del rojo 777: 1 de julio debe verse como 01/07, no 30/06 en huso al oeste de UTC.
  assert.equal(formatDateEsAr('2022-07-01'), '01/07/2022');
  // Primer día del año / medianoche de fin de mes — bordes donde `new Date(iso)` driftearía.
  assert.equal(formatDateEsAr('2026-01-01'), '01/01/2026');
  assert.equal(formatDateEsAr('2026-03-01'), '01/03/2026');
});

test('formatDateEsAr: año bisiesto (29 feb) sin corrimiento', () => {
  assert.equal(formatDateEsAr('2024-02-29'), '29/02/2024');
});

test('formatDateEsAr: instante real (con hora) → día LOCAL, dd/mm/aaaa (sin hora)', () => {
  // Construido con componentes LOCALES → el resultado es determinístico en cualquier huso del runner.
  const inst = new Date(2026, 5, 24, 10, 0, 0).toISOString(); // 24 jun 2026, 10:00 local
  assert.equal(formatDateEsAr(inst), '24/06/2026');
});

// ─── formatDateCompactEsAr (contextual dd/mm mismo año) ─────────────────────────────────────

test('formatDateCompactEsAr: mismo año que `now` → dd/mm (el año es obvio)', () => {
  const now = new Date(2026, 5, 16, 12, 0, 0); // 16 jun 2026
  assert.equal(formatDateCompactEsAr('2026-06-15', now), '15/06');
  assert.equal(formatDateCompactEsAr('2026-01-08', now), '08/01');
});

test('formatDateCompactEsAr: otro año → dd/mm/aaaa (el año deja de ser obvio)', () => {
  const now = new Date(2026, 5, 16, 12, 0, 0);
  assert.equal(formatDateCompactEsAr('2025-12-30', now), '30/12/2025');
  assert.equal(formatDateCompactEsAr('2024-06-15', now), '15/06/2024');
});

test('formatDateCompactEsAr: instante real (con hora) usa el día LOCAL para dd/mm', () => {
  const now = new Date(2026, 5, 16, 12, 0, 0);
  const inst = new Date(2026, 5, 12, 20, 0, 0).toISOString(); // 12 jun 2026, 20:00 local
  assert.equal(formatDateCompactEsAr(inst, now), '12/06');
});

test('formatDateCompactEsAr: null / inválido → "—"', () => {
  const now = new Date(2026, 5, 16, 12, 0, 0);
  assert.equal(formatDateCompactEsAr(null, now), '—');
  assert.equal(formatDateCompactEsAr('no-es-fecha', now), '—');
});

// ─── formatDateTimeEsAr (instante con hora) ─────────────────────────────────────────────────

test('formatDateTimeEsAr: instante real → dd/mm/aaaa · HH:MM (día+hora LOCAL, sin segundos)', () => {
  // Componentes locales → determinístico en cualquier huso.
  const inst = new Date(2026, 2, 15, 14, 32, 9).toISOString(); // 15 mar 2026, 14:32:09 local
  assert.equal(formatDateTimeEsAr(inst), '15/03/2026 · 14:32');
});

test('formatDateTimeEsAr: zero-padding de hora y minuto', () => {
  const inst = new Date(2026, 0, 5, 9, 5, 0).toISOString(); // 05 ene 2026, 09:05 local
  assert.equal(formatDateTimeEsAr(inst), '05/01/2026 · 09:05');
});

test('formatDateTimeEsAr: null / undefined / vacío / inválido → "—"', () => {
  assert.equal(formatDateTimeEsAr(null), '—');
  assert.equal(formatDateTimeEsAr(undefined), '—');
  assert.equal(formatDateTimeEsAr(''), '—');
  assert.equal(formatDateTimeEsAr('no-es-fecha'), '—');
});
