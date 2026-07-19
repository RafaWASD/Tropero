// Tests de la lógica PURA del cursor keyset de la lista paginada de la vista de grupo (spec 10 delta rodeo-grande,
// RG1.4/RG1.5 — T-RG.13). node:test, sin SDK. El "pagina y anexa sin duplicar" end-to-end (builder + este cursor)
// se ejercita contra SQLite in-memory en local-reads.test.ts (T-RG.2); acá se aísla la derivación reachedEnd/nextCursor.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveNextCursor, type CursorRow } from './group-page-cursor.ts';

const row = (id: string, created: string, inTreatment: number | boolean | null = 0): CursorRow => ({
  id,
  created_at: created,
  in_treatment: inTreatment,
});

test('deriveNextCursor: página COMPLETA (rows.length === pageSize) → reachedEnd false + cursor = clave de la última fila', () => {
  const rows = [row('a', '2024-01-03T00:00:00Z'), row('b', '2024-01-02T00:00:00Z')];
  const r = deriveNextCursor(rows, 2);
  assert.equal(r.reachedEnd, false);
  assert.deepEqual(r.nextCursor, { inTreatment: 0, createdAt: '2024-01-02T00:00:00Z', id: 'b' });
});

test('deriveNextCursor: página INCOMPLETA (rows.length < pageSize) → reachedEnd true + cursor null (RG1.5)', () => {
  const rows = [row('a', '2024-01-03T00:00:00Z')];
  const r = deriveNextCursor(rows, 2);
  assert.equal(r.reachedEnd, true);
  assert.equal(r.nextCursor, null);
});

test('deriveNextCursor: página VACÍA → reachedEnd true + cursor null (invariante reachedEnd ⟺ cursor null)', () => {
  const r = deriveNextCursor([], 2);
  assert.equal(r.reachedEnd, true);
  assert.equal(r.nextCursor, null);
});

test('deriveNextCursor: in_treatment se normaliza a 0|1 (1/true → 1; 0/false/null → 0)', () => {
  assert.deepEqual(deriveNextCursor([row('a', 'd', 1), row('b', 'd2', 1)], 2).nextCursor, {
    inTreatment: 1,
    createdAt: 'd2',
    id: 'b',
  });
  assert.deepEqual(deriveNextCursor([row('a', 'd', 0), row('b', 'd2', true)], 2).nextCursor, {
    inTreatment: 1,
    createdAt: 'd2',
    id: 'b',
  });
  assert.deepEqual(deriveNextCursor([row('a', 'd', 1), row('b', 'd2', null)], 2).nextCursor, {
    inTreatment: 0,
    createdAt: 'd2',
    id: 'b',
  });
  assert.deepEqual(deriveNextCursor([row('a', 'd', 1), row('b', 'd2', false)], 2).nextCursor, {
    inTreatment: 0,
    createdAt: 'd2',
    id: 'b',
  });
});
