// Tests de la lógica PURA del armado/escritura del import (spec 12, Fase 3 — T3.1..T3.5).
//
// node:test + type-stripping nativo (Node 24), sin Jest. Igual patrón que
// establishment-store.test.ts: la lógica pura (merge de dedup, armado de p_rows, chunking,
// resumen/truncado de error_details, guard de tamaño, escapeIlike, resolución de categoría/lote)
// vive en import-write.ts (sin RN/expo/supabase) y se testea SIN red. La parte I/O (queries de
// dedup + RPC + insert del log, en services/import-rodeo.ts) ya está cubierta por la suite del RPC
// (supabase/tests/import/run.cjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FILE_BYTES,
  MAX_ERROR_DETAILS_BYTES,
  CHUNK_ROWS,
  DEDUP_IN_CHUNK,
  checkFileSize,
  escapeIlike,
  resolveCategory,
  normalizeLoteName,
  buildRpcRow,
  chunkRows,
  mergeDedupAgainstExisting,
  summarizeErrorDetails,
  byteLengthUtf8,
  accumulateChunk,
  uniqueNonEmpty,
  type CandidateRow,
  type RowErrorEntry,
  type WriteAccumulator,
} from './import-write.ts';
import type { NormalizedRow } from './normalize-row.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────────────

function row(partial: Partial<NormalizedRow>): NormalizedRow {
  return {
    tagElectronic: null,
    idv: null,
    visualIdAlt: null,
    sex: 'female',
    birthDate: null,
    breed: null,
    category: null,
    lote: null,
    issues: [],
    ...partial,
  };
}

function candidate(index: number, partial: Partial<NormalizedRow>): CandidateRow {
  return { index, row: row(partial) };
}

// ─── T3.5 — guard de tamaño ANTES de parsear (R3.1) ────────────────────────────────────

test('R3.1: archivo dentro del tope de tamaño → ok', () => {
  assert.equal(checkFileSize(1024).ok, true);
});

test('R3.1: archivo en el borde exacto del tope → ok (no se rechaza el límite)', () => {
  assert.equal(checkFileSize(MAX_FILE_BYTES).ok, true);
});

test('R3.1: archivo 1 byte por encima del tope → rechazado con mensaje accionable', () => {
  const res = checkFileSize(MAX_FILE_BYTES + 1);
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.message, /MB/);
});

test('R3.1: tamaño inválido (NaN/negativo) → rechazado (no se asume chico)', () => {
  assert.equal(checkFileSize(Number.NaN).ok, false);
  assert.equal(checkFileSize(-1).ok, false);
});

test('R3.1: un archivo de 1 sola celda gigante (char-flood) se ataja por TAMAÑO, no por filas', () => {
  // El cap de FILAS del parser no protege un archivo de 1 fila de 50 MB. El guard de tamaño sí.
  const fiftyMb = 50 * 1024 * 1024;
  assert.equal(checkFileSize(fiftyMb).ok, false);
});

// ─── T3.5 — escapeIlike (R3.5, reuso F1-1) ─────────────────────────────────────────────

test('R3.5: escapeIlike neutraliza comodines %/_ y la coma de PostgREST', () => {
  // % _ , → cada uno pasa a espacio: '10' + (% _ →) '  ' + 'off' + (, →) ' '.
  assert.equal(escapeIlike('10%_off,'), '10  off ');
  assert.equal(escapeIlike('a%b_c,d'), 'a b c d');
});

test('R3.5: escapeIlike deja intacto un valor normal', () => {
  assert.equal(escapeIlike('AR0012345'), 'AR0012345');
});

// ─── T3.2 — resolución de category_code (puro, el RPC resuelve el id) ──────────────────

test('R10.3: categoría con texto → category_code normalizado + override=true', () => {
  assert.deepEqual(resolveCategory('Vaquillona'), { categoryCode: 'vaquillona', categoryOverride: true });
});

test('R10.3: categoría con tildes/espacios → normaliza a code (espacios→_, sin tilde)', () => {
  assert.deepEqual(resolveCategory('Vaca Multípara'), { categoryCode: 'vaca_multipara', categoryOverride: true });
});

test('R10.5: sin columna de categoría → category_code=null + override=false (placeholder por sexo en el RPC)', () => {
  assert.deepEqual(resolveCategory(null), { categoryCode: null, categoryOverride: false });
});

test('R10.5: categoría vacía/espacios → null + override=false', () => {
  assert.deepEqual(resolveCategory('   '), { categoryCode: null, categoryOverride: false });
});

// ─── T3.2 — normalización de nombre de lote (match por nombre, R10.4) ──────────────────

test('R10.4: normalizeLoteName lowercasea, saca tildes y colapsa espacios (match por nombre)', () => {
  assert.equal(normalizeLoteName('  Lote   Cabaña  '), 'lote cabana');
});

test('R10.4: lote vacío/null → null (no se intenta matchear)', () => {
  assert.equal(normalizeLoteName(null), null);
  assert.equal(normalizeLoteName('  '), null);
});

// ─── T3.3 — armado del p_rows (shape EXACTO del header 0074) ───────────────────────────

test('T3.3: buildRpcRow arma el shape exacto del header 0074 — SIN establishment_id/category_id/autoría', () => {
  const c = candidate(7, {
    sex: 'male',
    tagElectronic: '982000123456789',
    birthDate: '2025-08-01',
    idv: '1234',
    visualIdAlt: 'A5',
    breed: 'Hereford',
    category: 'Torito',
    lote: 'Lote A',
  });
  const r = buildRpcRow(c, 'group-uuid-1');
  assert.deepEqual(r, {
    row_index: 7,
    sex: 'male',
    tag_electronic: '982000123456789',
    birth_date: '2025-08-01',
    idv: '1234',
    visual_id_alt: 'A5',
    breed: 'Hereford',
    category_code: 'torito',
    category_override: true,
    management_group_id: 'group-uuid-1',
  });
  // Defensa contra que se filtre algún campo forzado server-side al payload.
  const keys = Object.keys(r);
  for (const forbidden of [
    'establishment_id',
    'category_id',
    'created_by',
    'imported_by',
    'species_id',
    'system_id',
    'rodeo_id',
  ]) {
    assert.ok(!keys.includes(forbidden), `p_rows NO debe incluir ${forbidden} (lo fuerza el RPC)`);
  }
});

test('T3.3: buildRpcRow sin lote → management_group_id null; sin categoría → code null + override false', () => {
  const r = buildRpcRow(candidate(0, { sex: 'female', idv: '9' }), null);
  assert.equal(r.management_group_id, null);
  assert.equal(r.category_code, null);
  assert.equal(r.category_override, false);
});

// ─── T3.3 — chunking (respeta el tope del RPC) ─────────────────────────────────────────

test('T3.3: chunkRows parte en bloques del tamaño pedido, último parcial', () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('T3.3: chunkRows con menos filas que el tamaño → un solo chunk', () => {
  assert.deepEqual(chunkRows([1, 2], 150), [[1, 2]]);
});

test('T3.3: chunkRows vacío → sin chunks (no se llama al RPC con 0 filas)', () => {
  assert.deepEqual(chunkRows([], 150), []);
});

test('T3.3: el CHUNK_ROWS default está MUY por debajo del tope del RPC (5000)', () => {
  assert.ok(CHUNK_ROWS <= 5000);
  // 6000 filas → chunks de 150, ninguno supera el tope server-side.
  const chunks = chunkRows(new Array(6000).fill(0));
  assert.ok(chunks.every((c) => c.length <= 5000));
});

// ─── T3.1 — merge del dedup contra existentes (skip + report, NUNCA update) ────────────

test('R7.2: una candidata cuyo idv YA existe → saltada (duplicate_idv_existing), no se escribe', () => {
  const candidates = [candidate(0, { idv: '100' }), candidate(1, { idv: '200' })];
  const res = mergeDedupAgainstExisting(candidates, new Set(['100']), new Set());
  assert.deepEqual(res.toWrite.map((c) => c.index), [1]);
  assert.deepEqual(res.skipped, [{ index: 0, reason: 'duplicate_idv_existing', value: '100' }]);
});

test('R7.4: TAG que YA existe → saltada (duplicate_tag_existing), NUNCA reasignación', () => {
  const candidates = [candidate(0, { tagElectronic: '982000000000001', idv: 'x' })];
  const res = mergeDedupAgainstExisting(candidates, new Set(), new Set(['982000000000001']));
  assert.equal(res.toWrite.length, 0);
  assert.deepEqual(res.skipped, [
    { index: 0, reason: 'duplicate_tag_existing', value: '982000000000001' },
  ]);
});

test('R7.4: colisión por TAG e IDV a la vez → se reporta UNA vez, prioridad TAG (no reusable)', () => {
  const candidates = [candidate(0, { tagElectronic: 'T1', idv: 'I1' })];
  const res = mergeDedupAgainstExisting(candidates, new Set(['I1']), new Set(['T1']));
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].reason, 'duplicate_tag_existing');
});

test('R7.2: filas sin colisión pasan; el dedup NO reordena las que sobreviven', () => {
  const candidates = [candidate(0, { idv: '1' }), candidate(1, { tagElectronic: 'T2' })];
  const res = mergeDedupAgainstExisting(candidates, new Set(), new Set());
  assert.deepEqual(res.toWrite.map((c) => c.index), [0, 1]);
  assert.equal(res.skipped.length, 0);
});

test('T3.1: uniqueNonEmpty filtra null/vacíos y dedup para la query = any($array)', () => {
  assert.deepEqual(uniqueNonEmpty(['a', null, 'a', '', 'b']), ['a', 'b']);
  assert.deepEqual(uniqueNonEmpty([null, '']), []);
});

test('T3.1: el dedup parte el .in($array) en sub-lotes URL-safe (pocas queries, no una por fila)', () => {
  // 5000 identificadores con DEDUP_IN_CHUNK=500 → 10 queries (no 5000), cada una URL-safe.
  const ids = Array.from({ length: 5000 }, (_, i) => `id${i}`);
  const chunks = chunkRows(ids, DEDUP_IN_CHUNK);
  assert.equal(chunks.length, Math.ceil(5000 / DEDUP_IN_CHUNK));
  assert.ok(chunks.every((c) => c.length <= DEDUP_IN_CHUNK));
  assert.ok(DEDUP_IN_CHUNK >= 1 && DEDUP_IN_CHUNK <= 5000);
});

// ─── T3.3/T3.4 — acumulado de chunks (import parcial) ──────────────────────────────────

test('R8.2: accumulateChunk suma ok/errores y mapea row_index→index sin mutar el acc previo', () => {
  const acc0: WriteAccumulator = {
    imported_ok: 2,
    imported_errors: 1,
    errors: [{ index: 0, reason: 'duplicate' }],
  };
  const acc1 = accumulateChunk(acc0, {
    imported_ok: 3,
    imported_errors: 2,
    errors: [
      { row_index: 10, reason: 'duplicate' },
      { row_index: 11, reason: 'tag>64' },
    ],
  });
  assert.equal(acc1.imported_ok, 5);
  assert.equal(acc1.imported_errors, 3);
  assert.deepEqual(acc1.errors, [
    { index: 0, reason: 'duplicate' },
    { index: 10, reason: 'duplicate' },
    { index: 11, reason: 'tag>64' },
  ]);
  // No mutó el acumulado previo.
  assert.equal(acc0.imported_ok, 2);
  assert.equal(acc0.errors.length, 1);
});

test('R8.2: accumulateChunk tolera un chunk con errors undefined', () => {
  const acc = accumulateChunk(
    { imported_ok: 0, imported_errors: 0, errors: [] },
    { imported_ok: 1, imported_errors: 0, errors: undefined as unknown as [] },
  );
  assert.equal(acc.imported_ok, 1);
  assert.deepEqual(acc.errors, []);
});

// ─── T3.4 — resumen / truncado del error_details (R11.5 / CHECK 256KB de 0073) ─────────

test('R11.5: pocos errores → by_reason completo + sample completo + truncated=false', () => {
  const errors: RowErrorEntry[] = [
    { index: 0, reason: 'duplicate' },
    { index: 1, reason: 'duplicate' },
    { index: 2, reason: 'sex inválido' },
  ];
  const s = summarizeErrorDetails(errors);
  assert.deepEqual(s.by_reason, { duplicate: 2, 'sex inválido': 1 });
  assert.equal(s.total_errors, 3);
  assert.equal(s.sample.length, 3);
  assert.equal(s.truncated, false);
});

test('R11.5: más errores que el sample → sample acotado + truncated=true + total real preservado', () => {
  const errors: RowErrorEntry[] = Array.from({ length: 5000 }, (_, i) => ({ index: i, reason: 'duplicate' }));
  const s = summarizeErrorDetails(errors, { sampleSize: 50 });
  assert.equal(s.total_errors, 5000);
  assert.equal(s.sample.length, 50);
  assert.equal(s.truncated, true);
  assert.equal(s.by_reason.duplicate, 5000); // el conteo por motivo es completo aunque el sample sea parcial
});

test('R11.5 (CRÍTICO): 5000 errores con sqlerrm largos y ÚNICOS → el JSON NUNCA supera el presupuesto del CHECK', () => {
  // Peor caso: cada error con un motivo largo y ÚNICO → by_reason explota. El resumen debe entrar igual.
  const errors: RowErrorEntry[] = Array.from({ length: 5000 }, (_, i) => ({
    index: i,
    reason: `error de fila ${i}: ` + 'x'.repeat(200),
  }));
  const s = summarizeErrorDetails(errors);
  const serialized = JSON.stringify(s);
  assert.ok(
    byteLengthUtf8(serialized) <= MAX_ERROR_DETAILS_BYTES,
    `error_details serializado (${byteLengthUtf8(serialized)} bytes) debe entrar en el presupuesto (${MAX_ERROR_DETAILS_BYTES})`,
  );
  // Y el presupuesto del cliente está por debajo del CHECK real de 0073 (262144).
  assert.ok(MAX_ERROR_DETAILS_BYTES < 262144);
  // El total real se preserva aunque se haya recortado.
  assert.equal(s.total_errors, 5000);
  assert.equal(s.truncated, true);
});

test('R11.5: 0 errores → resumen vacío válido (corrida limpia igual deja audit, R5.6)', () => {
  const s = summarizeErrorDetails([]);
  assert.deepEqual(s.by_reason, {});
  assert.deepEqual(s.sample, []);
  assert.equal(s.total_errors, 0);
  assert.equal(s.truncated, false);
});

test('R11.5: byteLengthUtf8 cuenta bytes UTF-8 (multibyte), no chars (alineado al octet_length del CHECK)', () => {
  // 'ñ' = 2 bytes en UTF-8. El CHECK de Postgres es octet_length (bytes), no char_length.
  assert.equal(byteLengthUtf8('ñ'), 2);
  assert.equal(byteLengthUtf8('abc'), 3);
});
