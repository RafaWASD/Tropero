// Tests del "año de nacimiento" year-only del alta guiada (sub-chunk B).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeBirthYearInput,
  validateBirthYear,
  birthYearToDate,
  isPregnantStatus,
  sanitizeDayMonthInput,
  validateBirthDate,
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

// ─── sanitizeDayMonthInput: solo dígitos, día-primero, "/" automático, tope DD/MM (RAF2.1.11) ─────────

test('sanitizeDayMonthInput: dígitos día-primero con "/" automático y tope 4 díg', () => {
  assert.equal(sanitizeDayMonthInput('1502'), '15/02');
  assert.equal(sanitizeDayMonthInput('3/'), '3'); // 1 díg → todavía sin mes, sin slash
  assert.equal(sanitizeDayMonthInput('abc'), '');
  assert.equal(sanitizeDayMonthInput(''), '');
  assert.equal(sanitizeDayMonthInput('15'), '15'); // 2 díg → día completo, sin slash aún
  assert.equal(sanitizeDayMonthInput('150'), '15/0'); // 3 díg → mes parcial
  assert.equal(sanitizeDayMonthInput('15022026'), '15/02'); // corta a 4 díg
  assert.equal(sanitizeDayMonthInput('1a5/b02'), '15/02'); // descarta no-dígitos
});

test('sanitizeDayMonthInput: idempotente (re-sanitizar no cambia)', () => {
  for (const s of ['', '3', '15', '15/0', '15/02']) {
    assert.equal(sanitizeDayMonthInput(s), s);
  }
});

// ─── validateBirthDate: año-solo / exacta / todo-o-nada / rangos / bisiesto / futuro (RAF2.1.3–2.1.9) ─

test('validateBirthDate: ambos vacíos → { ok:true, date:null } (opcional)', () => {
  assert.deepEqual(validateBirthDate('', '', NOW), { ok: true, date: null });
  assert.deepEqual(validateBirthDate('   ', '  ', NOW), { ok: true, date: null });
});

test('validateBirthDate: año válido + DD/MM vacío → midpoint AAAA-07-01 (RAF2.1.3)', () => {
  assert.deepEqual(validateBirthDate('2022', '', NOW), { ok: true, date: '2022-07-01' });
});

test('validateBirthDate: año válido + DD/MM válido → fecha EXACTA AAAA-MM-DD (RAF2.1.4)', () => {
  assert.deepEqual(validateBirthDate('2022', '15/02', NOW), { ok: true, date: '2022-02-15' });
  assert.deepEqual(validateBirthDate('2022', '01/12', NOW), { ok: true, date: '2022-12-01' });
  // día/mes de 1 dígito de mes ("15/2" = 15 de febrero) también vale.
  assert.deepEqual(validateBirthDate('2022', '15/2', NOW), { ok: true, date: '2022-02-15' });
});

test('validateBirthDate: DD/MM sin año → error en el campo dayMonth (RAF2.1.5)', () => {
  const r = validateBirthDate('', '15/02', NOW);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.field, 'dayMonth');
});

test('validateBirthDate: DD/MM incompleto (solo día) → error todo-o-nada (RAF2.1.6)', () => {
  const r = validateBirthDate('2022', '15', NOW); // sin "/" → sólo día
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.field, 'dayMonth');
  // mes parcial vacío ("15/0" tiene mes "0" → cae en rango, no en incompleto): el incompleto real es sin mes.
  const r2 = validateBirthDate('2022', '7', NOW);
  assert.equal(r2.ok, false);
});

test('validateBirthDate: día/mes fuera de rango → error sin clamp (RAF2.1.7)', () => {
  assert.equal(validateBirthDate('2022', '31/02', NOW).ok, false); // 31 de febrero
  assert.equal(validateBirthDate('2022', '00/00', NOW).ok, false); // 00/00
  assert.equal(validateBirthDate('2022', '31/04', NOW).ok, false); // 31 en abril (30 días)
  assert.equal(validateBirthDate('2022', '15/00', NOW).ok, false); // mes 0
  assert.equal(validateBirthDate('2022', '15/13', NOW).ok, false); // mes 13
  // un borde válido: 30/04 (abril tiene 30) y 31/01 (enero tiene 31).
  assert.deepEqual(validateBirthDate('2022', '30/04', NOW), { ok: true, date: '2022-04-30' });
  assert.deepEqual(validateBirthDate('2022', '31/01', NOW), { ok: true, date: '2022-01-31' });
});

test('validateBirthDate: 29/02 — bisiesto OK / no bisiesto ERROR sin clamp (RAF2.1.8)', () => {
  assert.deepEqual(validateBirthDate('2020', '29/02', NOW), { ok: true, date: '2020-02-29' }); // bisiesto
  assert.equal(validateBirthDate('2021', '29/02', NOW).ok, false); // no bisiesto
  assert.deepEqual(validateBirthDate('2000', '29/02', NOW), { ok: true, date: '2000-02-29' }); // div 400 → bisiesto
  assert.equal(validateBirthDate('1900', '29/02', NOW).ok, false); // secular no div 400 → no bisiesto
  // 28/02 siempre vale.
  assert.deepEqual(validateBirthDate('2021', '28/02', NOW), { ok: true, date: '2021-02-28' });
});

test('validateBirthDate: fecha exacta FUTURA → error en dayMonth (RAF2.1.9)', () => {
  // NOW = 2026-06-05. Una fecha del año en curso posterior a hoy es futura.
  const r = validateBirthDate('2026', '15/12', NOW);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.field, 'dayMonth');
  // El mismo día de hoy NO es futuro (válido).
  assert.deepEqual(validateBirthDate('2026', '05/06', NOW), { ok: true, date: '2026-06-05' });
  // Un día anterior a hoy en el año en curso es válido.
  assert.deepEqual(validateBirthDate('2026', '01/01', NOW), { ok: true, date: '2026-01-01' });
});

test('validateBirthDate: año inválido propaga el error con field:year (RAF2.1.1 intacto)', () => {
  const r = validateBirthDate('203', '15/02', NOW); // año de 3 dígitos
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.field, 'year');
  const r2 = validateBirthDate('2027', '', NOW); // año futuro
  assert.equal(r2.ok, false);
  assert.equal(r2.ok === false && r2.field, 'year');
});
