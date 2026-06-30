// Tests de la lógica PURA de la caravana del ternero (prompt "Vincular la cría al pie", spec 02 delta #15).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCalfQuery,
  resolveLinkEventDate,
  todayIsoLocal,
  CALF_EID_LENGTH,
  CALF_MIN_DIGITS,
} from './link-calf-query.ts';

const NOW = new Date(2026, 5, 30); // 2026-06-30 (local)

// ─── classifyCalfQuery ───────────────────────────────────────────────────────────────────────

test('classifyCalfQuery: vacío / solo espacios → empty (no dispara find-or-create, RCAP.2.5)', () => {
  assert.deepEqual(classifyCalfQuery(''), { kind: 'empty' });
  assert.deepEqual(classifyCalfQuery('   '), { kind: 'empty' });
});

test('classifyCalfQuery: menos de 3 dígitos → too-short (RCAP.2.5)', () => {
  assert.deepEqual(classifyCalfQuery('1'), { kind: 'too-short' });
  assert.deepEqual(classifyCalfQuery('12'), { kind: 'too-short' });
});

test('classifyCalfQuery: texto con letras → too-short (defensivo, paste — nunca dispara el motor con basura)', () => {
  assert.deepEqual(classifyCalfQuery('vaca blanca'), { kind: 'too-short' });
  assert.deepEqual(classifyCalfQuery('R-14'), { kind: 'too-short' });
});

test('classifyCalfQuery: 15 dígitos puros → eid (rama lookupByTag, RCAP.2.2)', () => {
  assert.deepEqual(classifyCalfQuery('982000123456789'), { kind: 'eid', value: '982000123456789' });
});

test('classifyCalfQuery: 15 díg con separadores de formato (espacios/guiones) → eid compacto', () => {
  // "982 000 123 456 789" = 15 díg + espacios → compacta a 15 díg → eid.
  assert.deepEqual(classifyCalfQuery('982 000 123 456 789'), { kind: 'eid', value: '982000123456789' });
  // Guiones también: "982-000-123-456-789".
  assert.deepEqual(classifyCalfQuery('982-000-123-456-789'), { kind: 'eid', value: '982000123456789' });
});

test('classifyCalfQuery: 3..14 dígitos → idv (rama searchAnimals, RCAP.2.2)', () => {
  assert.deepEqual(classifyCalfQuery('112'), { kind: 'idv', value: '112' });
  assert.deepEqual(classifyCalfQuery('0241556'), { kind: 'idv', value: '0241556' });
  // 14 díg (uno menos que un EID) → IDV, no EID.
  assert.deepEqual(classifyCalfQuery('12345678901234'), { kind: 'idv', value: '12345678901234' });
});

test('classifyCalfQuery: 16+ dígitos (más largo que un EID) → idv (numérico, no rebota)', () => {
  // 16 díg: no es EID (≠15) pero es numérico ≥3 → IDV (searchAnimals lo busca como idv/substring).
  assert.deepEqual(classifyCalfQuery('1234567890123456'), { kind: 'idv', value: '1234567890123456' });
});

test('classifyCalfQuery: idv con separadores de formato → compacto', () => {
  assert.deepEqual(classifyCalfQuery('0241 5567'), { kind: 'idv', value: '02415567' });
});

test('constantes de forma del EID/IDV', () => {
  assert.equal(CALF_EID_LENGTH, 15);
  assert.equal(CALF_MIN_DIGITS, 3);
});

// ─── todayIsoLocal ───────────────────────────────────────────────────────────────────────────

test('todayIsoLocal: formatea YYYY-MM-DD local con cero-padding', () => {
  assert.equal(todayIsoLocal(new Date(2026, 0, 5)), '2026-01-05'); // enero, día 5
  assert.equal(todayIsoLocal(new Date(2026, 11, 31)), '2026-12-31'); // diciembre, día 31
  assert.equal(todayIsoLocal(NOW), '2026-06-30');
});

// ─── resolveLinkEventDate (RCAP.3.2) ──────────────────────────────────────────────────────────

test('resolveLinkEventDate: usa el nacimiento del ternero si lo conoce', () => {
  assert.equal(resolveLinkEventDate('2026-05-10', NOW), '2026-05-10');
});

test('resolveLinkEventDate: cae a HOY si el nacimiento es null / vacío / espacios', () => {
  assert.equal(resolveLinkEventDate(null, NOW), '2026-06-30');
  assert.equal(resolveLinkEventDate(undefined, NOW), '2026-06-30');
  assert.equal(resolveLinkEventDate('', NOW), '2026-06-30');
  assert.equal(resolveLinkEventDate('   ', NOW), '2026-06-30');
});
