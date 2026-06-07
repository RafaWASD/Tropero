// Tests de los helpers PUROS de la UI del import (spec 12, Fase 4 / T4.1..T4.5).
// node:test + type-stripping nativo (sin Jest). Cubre: mapeo de fila→RawMappedRow, normalización de
// tabla/SIGSA, completitud del mapeo (R4.2/R5), motivos → copy legible (R5.4, nota de seguridad #2:
// NUNCA sqlerrm crudo), armado y cap del preview (R5.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { autoDetectMapping, applyMappingOverride } from './column-mapping.ts';
import { normalizeRow } from './normalize-row.ts';
import { validateRows } from './validate-rows.ts';
import { parseSigsaTxt } from './parse-sigsa-txt.ts';
import {
  mappingIsComplete,
  rowToRawMapped,
  normalizeTableRows,
  normalizeSigsaRows,
  sigsaRecordToRawMapped,
  rowErrorCopy,
  existingDuplicateCopy,
  intraDuplicateCopy,
  writeErrorCopy,
  rowLabel,
  buildPreviewItems,
  buildCategoryLabelByIndex,
  buildCategoryStatusByIndex,
  summarizeUnrecognizedCategories,
  toCandidates,
  buildColumnSamples,
  PREVIEW_CAP,
  CATEGORY_BADGE_MAX,
  UNRECOGNIZED_CATEGORY_LABELS_CAP,
  censusFieldLabel,
} from './import-ui.ts';

test('mappingIsComplete: necesita ≥1 identificador + sexo', () => {
  // Solo sexo, sin identificador → incompleto.
  let mapping = autoDetectMapping(['sexo']);
  assert.equal(mappingIsComplete(mapping), false);

  // Solo idv, sin sexo → incompleto.
  mapping = autoDetectMapping(['caravana']);
  assert.equal(mappingIsComplete(mapping), false);

  // idv + sexo → completo.
  mapping = autoDetectMapping(['caravana', 'sexo']);
  assert.equal(mappingIsComplete(mapping), true);

  // Cualquier identificador sirve (visual + sexo).
  mapping = autoDetectMapping(['identificacion visual', 'sexo']);
  assert.equal(mappingIsComplete(mapping), true);
});

test('rowToRawMapped: lee cada celda por el índice de su columna mapeada', () => {
  // headers: idv, sexo, raza → mapeo auto.
  const mapping = autoDetectMapping(['caravana', 'sexo', 'raza']);
  const raw = rowToRawMapped(['0241', 'M', 'Angus'], mapping);
  assert.equal(raw.idv, '0241');
  assert.equal(raw.sex, 'M');
  assert.equal(raw.breed, 'Angus');
  // Columnas sin mapear no aparecen.
  assert.equal(raw.lote, undefined);
});

test('rowToRawMapped: columna fuera de rango / desmapeada → undefined (no rompe)', () => {
  let mapping = autoDetectMapping(['caravana', 'sexo']);
  // Desmapeamos sexo manualmente → la fila no trae sexo.
  mapping = applyMappingOverride(mapping, 1, null);
  const raw = rowToRawMapped(['0241', 'M'], mapping);
  assert.equal(raw.idv, '0241');
  assert.equal(raw.sex, undefined);
});

test('normalizeTableRows: normaliza todas las filas de datos por el mapeo', () => {
  const mapping = autoDetectMapping(['caravana', 'sexo']);
  const rows = normalizeTableRows([['0241', 'M'], ['0242', 'H']], mapping);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].idv, '0241');
  assert.equal(rows[0].sex, 'male');
  assert.equal(rows[1].sex, 'female');
});

test('sigsaRecordToRawMapped: RFID→tag, sexo posicional, RAZA code→nombre (R6.2)', () => {
  const { records } = parseSigsaTxt('032010000000000-M-AA-08/2025');
  const raw = sigsaRecordToRawMapped(records[0]);
  assert.equal(raw.tag_electronic, '032010000000000');
  assert.equal(raw.sex, 'M');
  // AA = Aberdeen Angus (best-effort, code→nombre).
  assert.equal(raw.breed, 'Aberdeen Angus');
  assert.equal(raw.birth_date, '08/2025');
  // SIGSA no trae idv/categoría.
  assert.equal(raw.idv, undefined);
  assert.equal(raw.category, undefined);
});

test('sigsaRecordToRawMapped: la H en posición SEXO es Hembra, no Hereford (R6.2 gotcha)', () => {
  // 2do campo = SEXO 'H' (hembra); 3er campo = RAZA 'H' (Hereford). NO confundir por contenido.
  const { records } = parseSigsaTxt('032010000000001-H-H-08/2025');
  const raw = sigsaRecordToRawMapped(records[0]);
  assert.equal(raw.sex, 'H');
  assert.equal(raw.breed, 'Hereford');
  // Y la normalización resuelve la H de SEXO a female (no a un sexo basura).
  const norm = normalizeRow(raw);
  assert.equal(norm.sex, 'female');
});

test('normalizeSigsaRows: una corrida completa de SIGSA', () => {
  const { records } = parseSigsaTxt(
    '032010000000000-M-AA-08/2025;032010000000001-H-H-08/2025',
  );
  const rows = normalizeSigsaRows(records);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sex, 'male');
  assert.equal(rows[1].sex, 'female');
});

test('rowErrorCopy: motivos → copy legible en español, sin duplicar líneas', () => {
  assert.match(rowErrorCopy(['missing_identifier']), /identificador/i);
  assert.match(rowErrorCopy(['missing_sex']), /sexo/i);
  assert.match(rowErrorCopy(['field_over_cap']), /largo/i);
  // Dos motivos → dos líneas; el mismo motivo repetido no se duplica.
  const both = rowErrorCopy(['missing_identifier', 'missing_sex', 'missing_sex']);
  assert.match(both, /identificador/i);
  assert.match(both, /sexo/i);
});

test('existingDuplicateCopy / intraDuplicateCopy: copy legible por tipo de dup', () => {
  assert.match(existingDuplicateCopy('duplicate_idv_existing'), /existe.*campo/i);
  assert.match(existingDuplicateCopy('duplicate_tag_existing'), /electr/i);
  assert.match(intraDuplicateCopy('idv'), /repetida en el archivo/i);
  assert.match(intraDuplicateCopy('tag_electronic'), /repetida en el archivo/i);
});

test('writeErrorCopy: NUNCA devuelve el sqlerrm crudo (nota de seguridad #2)', () => {
  // Un sqlerrm de unique → copy genérico legible, no el texto crudo de Postgres.
  const raw = 'duplicate key value violates unique constraint "animals_tag_unique"';
  const copy = writeErrorCopy(raw);
  assert.ok(!copy.includes('animals_tag_unique'));
  assert.ok(!copy.includes('constraint'));
  assert.match(copy, /identificador/i);
  // Un motivo desconocido → copy genérico, tampoco el crudo.
  const other = writeErrorCopy('relation "x" does not exist at character 42');
  assert.ok(!other.includes('does not exist'));
  assert.match(other, /no se pudo escribir/i);
});

test('rowLabel: usa el mejor identificador disponible, o "Fila N"', () => {
  assert.equal(rowLabel(normalizeRow({ idv: '0241' }), 0), 'IDV 0241');
  assert.equal(rowLabel(normalizeRow({ visual_id_alt: 'La pinta' }), 0), 'La pinta');
  assert.equal(
    rowLabel(normalizeRow({ tag_electronic: '982000123456789' }), 0),
    'TAG 982000123456789',
  );
  // Sin ningún id → "Fila N" (1-based).
  assert.equal(rowLabel(normalizeRow({}), 4), 'Fila 5');
});

test('buildPreviewItems: válidas primero, luego errores, luego duplicados; cap respetado', () => {
  const rows = [
    normalizeRow({ idv: '0241', sex: 'M' }), // 0 válida
    normalizeRow({ sex: 'M' }), // 1 error (sin id)
    normalizeRow({ idv: '0243', sex: 'H' }), // 2 válida
  ];
  const v = validateRows(rows);
  const { items, hiddenCount } = buildPreviewItems({
    rows,
    validIndices: v.valid,
    errors: v.errors,
    intraDuplicates: v.intraDuplicates,
    existingSkips: [{ index: 2, reason: 'duplicate_idv_existing' }],
  });
  assert.equal(hiddenCount, 0);
  // El orden: válidas, error, duplicado.
  assert.equal(items[0].status, 'valid');
  assert.ok(items.some((i) => i.status === 'error'));
  assert.ok(items.some((i) => i.status === 'duplicate'));
});

test('buildPreviewItems: lista capeada a PREVIEW_CAP con hiddenCount (perf con miles)', () => {
  const rows = Array.from({ length: PREVIEW_CAP + 25 }, (_, i) =>
    normalizeRow({ idv: String(1000 + i), sex: 'M' }),
  );
  const v = validateRows(rows);
  const { items, hiddenCount } = buildPreviewItems({
    rows,
    validIndices: v.valid,
    errors: v.errors,
    intraDuplicates: v.intraDuplicates,
    existingSkips: [],
  });
  assert.equal(items.length, PREVIEW_CAP);
  assert.equal(hiddenCount, 25);
});

test('buildCategoryLabelByIndex: el badge usa el texto CRUDO del archivo, solo para válidas con categoría', () => {
  const rows = [
    normalizeRow({ idv: '0241', sex: 'M', category: 'Torito' }), // 0 válida, con categoría
    normalizeRow({ idv: '0242', sex: 'H' }), // 1 válida, SIN categoría
    normalizeRow({ idv: '0243', sex: 'H', category: '  Vaquillona  ' }), // 2 válida, categoría con espacios
  ];
  const map = buildCategoryLabelByIndex(rows, [0, 1, 2]);
  assert.equal(map.get(0), 'Torito');
  // Sin columna de categoría mapeada → sin entrada (sin badge).
  assert.equal(map.has(1), false);
  // Trimmeado (viene de normalizeRow).
  assert.equal(map.get(2), 'Vaquillona');
});

test('buildCategoryLabelByIndex: solo válidas — una fila no-válida con categoría NO entra', () => {
  const rows = [normalizeRow({ idv: '0241', sex: 'M', category: 'Toro' })];
  // index 0 NO está en validIndices → no debe aparecer.
  const map = buildCategoryLabelByIndex(rows, []);
  assert.equal(map.size, 0);
});

test('buildCategoryLabelByIndex: SIGSA no trae categoría → mapa vacío (sin badge)', () => {
  const { records } = parseSigsaTxt('032010000000000-M-AA-08/2025');
  const rows = normalizeSigsaRows(records);
  const v = validateRows(rows);
  const map = buildCategoryLabelByIndex(rows, v.valid);
  assert.equal(map.size, 0);
});

test('buildCategoryLabelByIndex: capa el valor a CATEGORY_BADGE_MAX (texto opaco del archivo, R3.5)', () => {
  const long = 'X'.repeat(CATEGORY_BADGE_MAX + 50);
  const rows = [normalizeRow({ idv: '0241', sex: 'M', category: long })];
  const map = buildCategoryLabelByIndex(rows, [0]);
  assert.equal(map.get(0)?.length, CATEGORY_BADGE_MAX);
});

test('buildPreviewItems: el categoryLabel del preview sale del mapa (wire del badge)', () => {
  const rows = [
    normalizeRow({ idv: '0241', sex: 'M', category: 'Torito' }),
    normalizeRow({ idv: '0242', sex: 'H' }),
  ];
  const v = validateRows(rows);
  const categoryLabelByIndex = buildCategoryLabelByIndex(rows, v.valid);
  const { items } = buildPreviewItems({
    rows,
    validIndices: v.valid,
    errors: v.errors,
    intraDuplicates: v.intraDuplicates,
    existingSkips: [],
    categoryLabelByIndex,
  });
  const first = items.find((i) => i.index === 0);
  const second = items.find((i) => i.index === 1);
  assert.ok(first && first.status === 'valid' && first.categoryLabel === 'Torito');
  // La válida sin categoría queda con categoryLabel null (sin badge).
  assert.ok(second && second.status === 'valid' && second.categoryLabel === null);
});

// ─── Visibilidad: categoría declarada vs catálogo (aviso del preview, R10.5) ──────────────────

test('buildCategoryStatusByIndex: clasifica cada válida vs el catálogo del system (mirror del RPC)', () => {
  const catalog = new Set(['vaquillona', 'torito', 'toro']);
  const rows = [
    normalizeRow({ idv: '0241', sex: 'H', category: 'Vaquillona' }), // 0 matched
    normalizeRow({ idv: '0242', sex: 'H', category: 'Vaca' }), // 1 unmatched (no hay code "vaca")
    normalizeRow({ idv: '0243', sex: 'H' }), // 2 none (sin categoría)
  ];
  const map = buildCategoryStatusByIndex(rows, [0, 1, 2], catalog);
  assert.equal(map.get(0), 'matched');
  assert.equal(map.get(1), 'unmatched');
  assert.equal(map.get(2), 'none');
});

test('buildCategoryStatusByIndex: solo computa los índices válidos pasados', () => {
  const catalog = new Set(['toro']);
  const rows = [normalizeRow({ idv: '0241', sex: 'M', category: 'Toro' })];
  // index 0 NO está en validIndices → no se clasifica.
  const map = buildCategoryStatusByIndex(rows, [], catalog);
  assert.equal(map.size, 0);
});

test('summarizeUnrecognizedCategories: resume las no reconocidas (cuántas filas + textos distintos)', () => {
  const catalog = new Set(['vaquillona', 'torito', 'toro']);
  const rows = [
    normalizeRow({ idv: '0241', sex: 'H', category: 'Vaca' }), // unmatched
    normalizeRow({ idv: '0242', sex: 'H', category: 'vaca' }), // unmatched (mismo texto, case-insensitive)
    normalizeRow({ idv: '0243', sex: 'H', category: 'Recría' }), // unmatched (otro texto)
    normalizeRow({ idv: '0244', sex: 'H', category: 'Vaquillona' }), // matched → no cuenta
    normalizeRow({ idv: '0245', sex: 'H' }), // none → no cuenta
  ];
  const validIndices = [0, 1, 2, 3, 4];
  const status = buildCategoryStatusByIndex(rows, validIndices, catalog);
  const summary = summarizeUnrecognizedCategories(rows, validIndices, status);
  assert.ok(summary);
  // 3 filas no reconocidas (las dos "Vaca"/"vaca" + "Recría"); el conteo de filas es exacto.
  assert.equal(summary.rowCount, 3);
  // Textos distintos (case-insensitive): "Vaca" (primera forma) y "Recría". "Vaquillona" no entra.
  assert.deepEqual(summary.labels, ['Vaca', 'Recría']);
  // 2 textos distintos en total → no hay "y N más" (distinctCount == labels.length).
  assert.equal(summary.distinctCount, 2);
});

test('summarizeUnrecognizedCategories: null cuando NO hay ninguna no reconocida (sin aviso)', () => {
  const catalog = new Set(['vaquillona', 'torito']);
  const rows = [
    normalizeRow({ idv: '0241', sex: 'H', category: 'Vaquillona' }), // matched
    normalizeRow({ idv: '0242', sex: 'H' }), // none
  ];
  const validIndices = [0, 1];
  const status = buildCategoryStatusByIndex(rows, validIndices, catalog);
  assert.equal(summarizeUnrecognizedCategories(rows, validIndices, status), null);
});

test('summarizeUnrecognizedCategories: capea la lista de labels a UNRECOGNIZED_CATEGORY_LABELS_CAP, conteo exacto', () => {
  const catalog = new Set(['vaquillona']);
  // N textos distintos no reconocidos (más que el cap).
  const distinct = UNRECOGNIZED_CATEGORY_LABELS_CAP + 3;
  const rows = Array.from({ length: distinct }, (_, i) =>
    normalizeRow({ idv: String(1000 + i), sex: 'H', category: `Cat${i}` }),
  );
  const validIndices = rows.map((_, i) => i);
  const status = buildCategoryStatusByIndex(rows, validIndices, catalog);
  const summary = summarizeUnrecognizedCategories(rows, validIndices, status);
  assert.ok(summary);
  // El conteo de FILAS es exacto aunque la lista de labels esté capeada.
  assert.equal(summary.rowCount, distinct);
  assert.equal(summary.labels.length, UNRECOGNIZED_CATEGORY_LABELS_CAP);
  // distinctCount cuenta TODOS los textos distintos (> labels capeados) → la UI muestra "y N más".
  assert.equal(summary.distinctCount, distinct);
  assert.ok(summary.distinctCount > summary.labels.length);
});

test('summarizeUnrecognizedCategories: capea cada texto a CATEGORY_BADGE_MAX (texto opaco, R3.5)', () => {
  const catalog = new Set(['vaquillona']);
  const long = 'Z'.repeat(CATEGORY_BADGE_MAX + 40);
  const rows = [normalizeRow({ idv: '0241', sex: 'H', category: long })];
  const status = buildCategoryStatusByIndex(rows, [0], catalog);
  const summary = summarizeUnrecognizedCategories(rows, [0], status);
  assert.ok(summary);
  assert.equal(summary.labels[0]?.length, CATEGORY_BADGE_MAX);
});

test('buildPreviewItems: thread del categoryStatus a la fila válida (per-fila a completar)', () => {
  const catalog = new Set(['vaquillona']);
  const rows = [
    normalizeRow({ idv: '0241', sex: 'H', category: 'Vaca' }), // unmatched
    normalizeRow({ idv: '0242', sex: 'H', category: 'Vaquillona' }), // matched
    normalizeRow({ idv: '0243', sex: 'H' }), // none
  ];
  const v = validateRows(rows);
  const categoryStatusByIndex = buildCategoryStatusByIndex(rows, v.valid, catalog);
  const { items } = buildPreviewItems({
    rows,
    validIndices: v.valid,
    errors: v.errors,
    intraDuplicates: v.intraDuplicates,
    existingSkips: [],
    categoryStatusByIndex,
  });
  const i0 = items.find((i) => i.index === 0);
  const i1 = items.find((i) => i.index === 1);
  const i2 = items.find((i) => i.index === 2);
  assert.ok(i0 && i0.status === 'valid' && i0.categoryStatus === 'unmatched');
  assert.ok(i1 && i1.status === 'valid' && i1.categoryStatus === 'matched');
  assert.ok(i2 && i2.status === 'valid' && i2.categoryStatus === 'none');
});

test('buildPreviewItems: sin categoryStatusByIndex → categoryStatus "none" por defecto (degradación)', () => {
  const rows = [normalizeRow({ idv: '0241', sex: 'H', category: 'Vaca' })];
  const v = validateRows(rows);
  const { items } = buildPreviewItems({
    rows,
    validIndices: v.valid,
    errors: v.errors,
    intraDuplicates: v.intraDuplicates,
    existingSkips: [],
  });
  const i0 = items.find((i) => i.index === 0);
  // Sin catálogo (degradación) → 'none' → la UI no marca "a completar".
  assert.ok(i0 && i0.status === 'valid' && i0.categoryStatus === 'none');
});

test('toCandidates: arma CandidateRow[] de los índices válidos', () => {
  const rows = [normalizeRow({ idv: '0241', sex: 'M' }), normalizeRow({ idv: '0242', sex: 'H' })];
  const cands = toCandidates(rows, [0, 1]);
  assert.equal(cands.length, 2);
  assert.equal(cands[0].index, 0);
  assert.equal(cands[0].row.idv, '0241');
});

test('censusFieldLabel: etiqueta legible por campo', () => {
  assert.equal(censusFieldLabel('tag_electronic'), 'Caravana electrónica');
  assert.equal(censusFieldLabel('idv'), 'Caravana visual (IDV)');
  assert.equal(censusFieldLabel('sex'), 'Sexo');
});

test('buildColumnSamples: muestra normal — primeros valores no vacíos por columna, unidos por " · "', () => {
  const headers = ['caravana', 'sexo', 'raza'];
  const rows = [
    ['0001', 'M', 'Angus'],
    ['0002', 'H', 'Hereford'],
    ['0003', 'M', 'Brangus'],
    ['0004', 'H', 'Angus'], // 4ta fila: no entra (cap por defecto = 3)
  ];
  const samples = buildColumnSamples(headers, rows);
  assert.equal(samples.length, 3);
  assert.equal(samples[0], '0001 · 0002 · 0003');
  assert.equal(samples[1], 'M · H · M');
  assert.equal(samples[2], 'Angus · Hereford · Brangus');
});

test('buildColumnSamples: saltea celdas vacías/espacios intercaladas (toma los primeros NO vacíos)', () => {
  const headers = ['idv', 'mote'];
  const rows = [
    ['0001', ''], // mote vacío
    ['', '   '], // idv vacío, mote solo espacios
    ['0002', 'Manchada'],
    ['0003', 'Negra'],
    ['0004', 'Overa'],
  ];
  const samples = buildColumnSamples(headers, rows);
  // idv: saltea la celda vacía de la 2da fila → 0001, 0002, 0003.
  assert.equal(samples[0], '0001 · 0002 · 0003');
  // mote: saltea vacío + solo-espacios → Manchada, Negra, Overa.
  assert.equal(samples[1], 'Manchada · Negra · Overa');
});

test('buildColumnSamples: filas desparejas (más cortas que headers) no rompen', () => {
  const headers = ['a', 'b', 'c'];
  const rows = [
    ['x1', 'y1'], // sin celda para la columna c
    ['x2'], // solo la columna a
    ['x3', 'y3', 'z3'],
  ];
  const samples = buildColumnSamples(headers, rows);
  assert.equal(samples.length, 3);
  assert.equal(samples[0], 'x1 · x2 · x3');
  assert.equal(samples[1], 'y1 · y3'); // y2 no existe (fila corta)
  assert.equal(samples[2], 'z3'); // solo la 3ra fila la trae
});

test('buildColumnSamples: cap de cantidad configurable (perColumn)', () => {
  const headers = ['n'];
  const rows = [['1'], ['2'], ['3'], ['4'], ['5']];
  const samples = buildColumnSamples(headers, rows, { perColumn: 2 });
  assert.equal(samples[0], '1 · 2');
});

test('buildColumnSamples: capa cada valor a maxCharsPerValue (texto opaco del archivo, R3.5)', () => {
  const headers = ['notas'];
  const long = 'X'.repeat(50);
  const samples = buildColumnSamples(headers, [[long]], { maxCharsPerValue: 10 });
  assert.equal(samples[0], 'X'.repeat(10));
  // El default también capea (24 chars).
  const def = buildColumnSamples(headers, [[long]]);
  assert.equal(def[0]?.length, 24);
});

test('buildColumnSamples: headers sin filas → array de "" del largo correcto', () => {
  const samples = buildColumnSamples(['a', 'b', 'c'], []);
  assert.deepEqual(samples, ['', '', '']);
});

test('buildColumnSamples: columna entera vacía → "" en su posición', () => {
  const headers = ['llena', 'vacia'];
  const rows = [
    ['v1', ''],
    ['v2', ''],
  ];
  const samples = buildColumnSamples(headers, rows);
  assert.equal(samples[0], 'v1 · v2');
  assert.equal(samples[1], ''); // columna sin datos → vacío (la UI no la renderiza)
});

test('buildColumnSamples: sin headers (SIGSA / sin mapeo) → array vacío', () => {
  assert.deepEqual(buildColumnSamples([], [['a', 'b']]), []);
});
