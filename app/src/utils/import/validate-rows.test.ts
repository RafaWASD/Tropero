// Tests de la validación por fila + dedup intra-archivo (spec 12, T1.12 / R5.1, R5.2, R7.1).
// node:test + type-stripping nativo (sin Jest).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRow } from './normalize-row.ts';
import { validateRows } from './validate-rows.ts';

/** Helper: normaliza un array de filas crudas mapeadas. */
function norm(raws: Parameters<typeof normalizeRow>[0][]) {
  return raws.map(normalizeRow);
}

test('R5.1 fila sin NINGÚN identificador → error "a completar"', () => {
  const rows = norm([{ sex: 'M' }]); // sin tag/idv/visual
  const res = validateRows(rows);
  assert.equal(res.valid.length, 0);
  assert.equal(res.errors.length, 1);
  assert.ok(res.errors[0].reasons.includes('missing_identifier'));
});

test('R5.2 fila sin sexo (o sexo no mapeable) → error', () => {
  const noSex = validateRows(norm([{ idv: '0241' }]));
  assert.ok(noSex.errors[0].reasons.includes('missing_sex'));

  const badSex = validateRows(norm([{ idv: '0241', sex: 'macha' }]));
  assert.ok(badSex.errors[0].reasons.includes('missing_sex'));
});

test('R5.1+R5.2 fila válida (idv + sexo) pasa', () => {
  const res = validateRows(norm([{ idv: '0241', sex: 'M' }]));
  assert.deepEqual(res.valid, [0]);
  assert.equal(res.errors.length, 0);
  assert.equal(res.intraDuplicates.length, 0);
});

test('R5.1 identificador válido puede ser TAG o visual (no solo idv)', () => {
  const byTag = validateRows(norm([{ tag_electronic: '982000123456789', sex: 'H' }]));
  assert.deepEqual(byTag.valid, [0]);

  const byVisual = validateRows(norm([{ visual_id_alt: 'R-14', sex: 'H' }]));
  assert.deepEqual(byVisual.valid, [0]);
});

test('R5.1 TAG inválido SIN otro id → missing_identifier (no cuenta como id)', () => {
  const res = validateRows(norm([{ tag_electronic: '123', sex: 'M' }])); // TAG inválido → null
  assert.ok(res.errors[0].reasons.includes('missing_identifier'));
});

test('R7.1 dos filas con el MISMO idv → ambas conflicto, ninguna válida', () => {
  const res = validateRows(
    norm([
      { idv: '0241', sex: 'M' },
      { idv: '0241', sex: 'H' },
    ]),
  );
  assert.equal(res.valid.length, 0, 'ninguna se escribe sin resolución');
  assert.equal(res.intraDuplicates.length, 1);
  assert.equal(res.intraDuplicates[0].by, 'idv');
  assert.equal(res.intraDuplicates[0].value, '0241');
  assert.deepEqual(res.intraDuplicates[0].indices, [0, 1]);
});

test('R7.1 dos filas con el MISMO tag → conflicto', () => {
  const res = validateRows(
    norm([
      { tag_electronic: '982000123456789', sex: 'M' },
      { tag_electronic: '982000123456789', sex: 'H' },
    ]),
  );
  assert.equal(res.valid.length, 0);
  assert.equal(res.intraDuplicates.length, 1);
  assert.equal(res.intraDuplicates[0].by, 'tag_electronic');
});

test('R7.1 idvs distintos no colisionan; las dos válidas', () => {
  const res = validateRows(
    norm([
      { idv: '0241', sex: 'M' },
      { idv: '0242', sex: 'H' },
    ]),
  );
  assert.deepEqual(res.valid, [0, 1]);
  assert.equal(res.intraDuplicates.length, 0);
});

test('R7.1 idv vacío NO colisiona con otro idv vacío (solo identificadores no vacíos)', () => {
  // Ambas resuelven por visual; idv ausente no debe agruparlas.
  const res = validateRows(
    norm([
      { visual_id_alt: 'A', sex: 'M' },
      { visual_id_alt: 'B', sex: 'H' },
    ]),
  );
  assert.deepEqual(res.valid, [0, 1]);
  assert.equal(res.intraDuplicates.length, 0);
});

test('R7.1 grupo de 3 con mismo idv → las 3 en el grupo', () => {
  const res = validateRows(
    norm([
      { idv: '0241', sex: 'M' },
      { idv: '0241', sex: 'H' },
      { idv: '0241', sex: 'M' },
    ]),
  );
  assert.deepEqual(res.intraDuplicates[0].indices, [0, 1, 2]);
  assert.equal(res.valid.length, 0);
});

test('R3.4 fila con campo sobre-tope → error field_over_cap', () => {
  const res = validateRows(norm([{ idv: 'a'.repeat(65), sex: 'M', visual_id_alt: 'R-14' }]));
  assert.ok(res.errors[0].reasons.includes('field_over_cap'));
  assert.equal(res.valid.length, 0);
});

test('mezcla realista: válidas, error, duplicado conviven', () => {
  const res = validateRows(
    norm([
      { idv: '0241', sex: 'M' }, // 0 válida (pero colisiona con la 3)
      { sex: 'H' }, // 1 error (sin id)
      { idv: '0242', sex: 'female' }, // 2 válida
      { idv: '0241', sex: 'H' }, // 3 colisiona con la 0
    ]),
  );
  // 0 y 3 colisionan → fuera de valid; 2 válida; 1 error.
  assert.deepEqual(res.valid, [2]);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].index, 1);
  assert.equal(res.intraDuplicates.length, 1);
  assert.deepEqual(res.intraDuplicates[0].indices, [0, 3]);
});

test('borde: filas vacías → todo error, sin romper', () => {
  const res = validateRows(norm([{}, {}]));
  assert.equal(res.errors.length, 2);
  assert.equal(res.valid.length, 0);
});

test('una fila ya errada (sin id) NO se reporta también como duplicado', () => {
  // Dos filas sin id (ambas error). El dedup corre solo sobre candidatas → no las agrupa.
  const res = validateRows(
    norm([
      { sex: 'M' },
      { sex: 'H' },
    ]),
  );
  assert.equal(res.intraDuplicates.length, 0, 'errores no entran al dedup');
  assert.equal(res.errors.length, 2);
});
