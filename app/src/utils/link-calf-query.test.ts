// Tests de la lógica PURA de la caravana del ternero (prompt "Vincular la cría al pie", spec 02 delta #15).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyCalfQuery,
  resolveLinkEventDate,
  todayIsoLocal,
  CALF_EID_LENGTH,
} from './link-calf-query.ts';

const NOW = new Date(2026, 5, 30); // 2026-06-30 (local)

// ─── classifyCalfQuery ───────────────────────────────────────────────────────────────────────

test('classifyCalfQuery: vacío / solo espacios → empty (no dispara find-or-create, RCAP.2.5)', () => {
  assert.deepEqual(classifyCalfQuery(''), { kind: 'empty' });
  assert.deepEqual(classifyCalfQuery('   '), { kind: 'empty' });
});

test('IDU.4.7 classifyCalfQuery: dígitos cortos → idv (rama búsqueda, ya no rebota como too-short)', () => {
  assert.deepEqual(classifyCalfQuery('1'), { kind: 'idv', value: '1' });
  assert.deepEqual(classifyCalfQuery('12'), { kind: 'idv', value: '12' });
});

test('IDU.4.7 classifyCalfQuery: texto con letras / apodo → idv (rama búsqueda, alfanumérico + apodo)', () => {
  // El delta relaja el gate numérico: un idv alfanumérico o un apodo disparan la rama de búsqueda.
  assert.deepEqual(classifyCalfQuery('AB123'), { kind: 'idv', value: 'AB123' });
  assert.deepEqual(classifyCalfQuery('Manchada'), { kind: 'idv', value: 'Manchada' });
  assert.deepEqual(classifyCalfQuery('  La Colorada '), { kind: 'idv', value: 'La Colorada' });
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

test('classifyCalfQuery: idv numérico con separadores de formato → se conserva trimeado (búsqueda lo compacta)', () => {
  // La rama de búsqueda pasa el término TRIMEADO; searchAnimals lo re-clasifica/compacta internamente.
  assert.deepEqual(classifyCalfQuery('0241 5567'), { kind: 'idv', value: '0241 5567' });
});

test('constantes de forma del EID', () => {
  assert.equal(CALF_EID_LENGTH, 15);
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
