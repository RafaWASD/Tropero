// Tests del "año de nacimiento" year-only del alta guiada (sub-chunk B).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeBirthYearInput,
  validateBirthYear,
  birthYearToDate,
  isPregnantStatus,
  MIN_BIRTH_YEAR,
} from './animal-birth-year.ts';

const NOW = new Date(2026, 5, 5); // 2026-06-05 (local)

// ─── sanitizeBirthYearInput: solo 4 dígitos numéricos ─────────────────────────────────────

test('sanitizeBirthYearInput deja solo dígitos y corta a 4', () => {
  assert.equal(sanitizeBirthYearInput('2022'), '2022');
  assert.equal(sanitizeBirthYearInput('20a2x2'), '2022');
  assert.equal(sanitizeBirthYearInput('202234'), '2022'); // corta a 4
  assert.equal(sanitizeBirthYearInput('abc'), '');
  assert.equal(sanitizeBirthYearInput(''), '');
});

// ─── validateBirthYear: vacío válido, formato, no-futuro, cota inferior ───────────────────

test('validateBirthYear: vacío es VÁLIDO (opcional) → year null', () => {
  assert.deepEqual(validateBirthYear('', NOW), { ok: true, year: null });
  assert.deepEqual(validateBirthYear('   ', NOW), { ok: true, year: null });
});

test('validateBirthYear: un año válido → ok con el número', () => {
  assert.deepEqual(validateBirthYear('2022', NOW), { ok: true, year: 2022 });
  assert.deepEqual(validateBirthYear('2026', NOW), { ok: true, year: 2026 }); // el año actual es válido
});

test('validateBirthYear: menos de 4 dígitos → error', () => {
  const r = validateBirthYear('202', NOW);
  assert.equal(r.ok, false);
});

test('validateBirthYear: año futuro → error', () => {
  const r = validateBirthYear('2027', NOW);
  assert.equal(r.ok, false);
});

test('validateBirthYear: año anterior a la cota inferior → error', () => {
  const r = validateBirthYear(String(MIN_BIRTH_YEAR - 1), NOW);
  assert.equal(r.ok, false);
  // La cota exacta es válida.
  assert.deepEqual(validateBirthYear(String(MIN_BIRTH_YEAR), NOW), { ok: true, year: MIN_BIRTH_YEAR });
});

// ─── birthYearToDate: AAAA → AAAA-07-01 (mitad de año), clampeado a no-futuro ──────────────

test('birthYearToDate: año pasado → ISO mitad de año (07-01)', () => {
  assert.equal(birthYearToDate(2022, NOW), '2022-07-01'); // NOW = 2026 → 2022-07-01 es pasado
  assert.equal(birthYearToDate(2025, NOW), '2025-07-01');
});

test('birthYearToDate: año en curso con 07-01 FUTURO → cae a 01-01 (no futuro, < 1 año)', () => {
  // NOW = 2026-06-05 → 2026-07-01 es futuro → clampea a 2026-01-01 (pasado, < 1 año).
  assert.equal(birthYearToDate(2026, NOW), '2026-01-01');
});

test('birthYearToDate: año en curso con 07-01 YA PASADO → usa 07-01', () => {
  const lateNow = new Date(2026, 8, 15); // 2026-09-15 → 2026-07-01 ya pasó
  assert.equal(birthYearToDate(2026, lateNow), '2026-07-01');
});

test('birthYearToDate: null → null (sin fecha; categoría por default)', () => {
  assert.equal(birthYearToDate(null, NOW), null);
});

// ─── isPregnantStatus: positivo = small/medium/large; empty/null = no preñada ─────────────

test('isPregnantStatus: small/medium/large → true; empty/null → false', () => {
  assert.equal(isPregnantStatus('small'), true);
  assert.equal(isPregnantStatus('medium'), true);
  assert.equal(isPregnantStatus('large'), true);
  assert.equal(isPregnantStatus('empty'), false);
  assert.equal(isPregnantStatus(null), false);
  assert.equal(isPregnantStatus(undefined), false);
});
