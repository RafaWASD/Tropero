// Tests del parser .xlsx puro del importador (spec 12, R3.8 / R3.2, R3.3, R3.5, R4.1, R3.6).
// node:test + type-stripping nativo (sin Jest; mismo patrón que el resto de src/utils/*).
//
// Construye workbooks EN MEMORIA con SheetJS (aoa_to_sheet + write) y los parsea de vuelta,
// ejercitando el path real: read con sheetRows-cap → sheet_to_json (valores cacheados, sin
// evaluar fórmulas) → { headers, rows }. La dependencia es la MISMA librería vetada del CDN
// (xlsx 0.20.3) que usa el parser (R3.8) — el test verifica el comportamiento real, no un mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as XLSX from 'xlsx';

import { parseXlsx, MAX_ROWS } from './parse-xlsx.ts';

/** Helper: build an .xlsx ArrayBuffer from an array-of-arrays (header + data rows). */
function buildXlsx(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

test('R4.1 .xlsx bien formado → headers + filas correctas (mismo contrato que parse-csv)', () => {
  const buf = buildXlsx([
    ['caravana', 'sexo', 'raza'],
    ['0241', 'M', 'Angus'],
    ['0242', 'H', 'Hereford'],
  ]);
  const out = parseXlsx(buf);
  assert.deepEqual(out.headers, ['caravana', 'sexo', 'raza']);
  assert.deepEqual(out.rows, [
    ['0241', 'M', 'Angus'],
    ['0242', 'H', 'Hereford'],
  ]);
  assert.equal(out.rowsExceeded, false);
  assert.equal(out.cellsExceeded, false);
  assert.equal(out.parseError ?? false, false);
});

test('R3.5 acepta Uint8Array además de ArrayBuffer (el caller puede leer cualquiera)', () => {
  const buf = buildXlsx([
    ['tag', 'sexo'],
    ['982000000000001', 'macho'],
  ]);
  const out = parseXlsx(new Uint8Array(buf));
  assert.deepEqual(out.headers, ['tag', 'sexo']);
  assert.deepEqual(out.rows, [['982000000000001', 'macho']]);
});

test('R3.5 valores numéricos y mixtos se devuelven como STRING (texto opaco, no se reexporta)', () => {
  // aoa_to_sheet infiere tipos: 5000 → numérico, '0241' → texto. Todo debe volver como string.
  const buf = buildXlsx([
    ['peso', 'caravana'],
    [350, '0241'],
    [420.5, '0242'],
  ]);
  const out = parseXlsx(buf);
  assert.deepEqual(out.rows, [
    ['350', '0241'],
    ['420.5', '0242'],
  ]);
  for (const row of out.rows) for (const cell of row) assert.equal(typeof cell, 'string');
});

test('R3.2/R3.3 archivo con > MAX_ROWS filas → rowsExceeded true, NO materializa el excedente', () => {
  // header + (MAX_ROWS + 500) data rows. El cap sheetRows debe cortar AL PARSEAR: parseXlsx
  // jamás devuelve más de MAX_ROWS filas de datos, y marca rowsExceeded (rechaza-y-reporta).
  const aoa: unknown[][] = [['caravana', 'sexo']];
  for (let i = 0; i < MAX_ROWS + 500; i++) aoa.push([`id-${i}`, i % 2 === 0 ? 'M' : 'H']);
  const buf = buildXlsx(aoa);

  const out = parseXlsx(buf);
  assert.equal(out.rowsExceeded, true, 'debe marcar rowsExceeded');
  assert.ok(
    out.rows.length <= MAX_ROWS,
    `no debe materializar más de MAX_ROWS (=${MAX_ROWS}) filas; materializó ${out.rows.length}`,
  );
});

test('R3.3 sheetRows cortó de verdad: una hoja de 50k filas NO materializa 50k', () => {
  // Verificación adversarial del anti-DoW: 50.000 filas de datos. Sin sheetRows SheetJS
  // materializaría toda la hoja. parseXlsx debe quedar acotado a MAX_ROWS + reportar exceso.
  const aoa: unknown[][] = [['a', 'b']];
  for (let i = 0; i < 50_000; i++) aoa.push([i, i]);
  const buf = buildXlsx(aoa);

  const out = parseXlsx(buf);
  assert.equal(out.rowsExceeded, true);
  assert.ok(out.rows.length <= MAX_ROWS, `materializó ${out.rows.length}, debe ser <= ${MAX_ROWS}`);
});

test('R3.2 exactamente MAX_ROWS filas de datos → entra completo, sin rowsExceeded', () => {
  const aoa: unknown[][] = [['caravana', 'sexo']];
  for (let i = 0; i < MAX_ROWS; i++) aoa.push([`id-${i}`, 'M']);
  const buf = buildXlsx(aoa);

  const out = parseXlsx(buf);
  assert.equal(out.rowsExceeded, false, 'MAX_ROWS exacto NO debe exceder');
  assert.equal(out.rows.length, MAX_ROWS, 'debe materializar las MAX_ROWS filas');
});

test('R3.2 MAX_ROWS + 1 filas de datos → rowsExceeded true (borde superior)', () => {
  const aoa: unknown[][] = [['caravana', 'sexo']];
  for (let i = 0; i < MAX_ROWS + 1; i++) aoa.push([`id-${i}`, 'M']);
  const buf = buildXlsx(aoa);

  const out = parseXlsx(buf);
  assert.equal(out.rowsExceeded, true, 'MAX_ROWS + 1 debe exceder');
  assert.ok(out.rows.length <= MAX_ROWS);
});

test('R3.5 celda con FÓRMULA → se usa el valor cacheado, NO se ejecuta ni recalcula', () => {
  // Construimos una celda con fórmula =1+1 y valor cacheado 2. parseXlsx debe devolver "2"
  // (el valor cacheado), nunca evaluar la fórmula ni exponer su string.
  const ws = XLSX.utils.aoa_to_sheet([
    ['name', 'calc'],
    ['x', 'placeholder'],
  ]);
  ws['B2'] = { t: 'n', f: '1+1', v: 2 }; // fórmula con valor cacheado
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const out = parseXlsx(buf);
  assert.deepEqual(out.headers, ['name', 'calc']);
  assert.deepEqual(out.rows, [['x', '2']], 'debe usar el valor cacheado 2, no la fórmula');
  // y NUNCA debe aparecer el string de la fórmula en ninguna celda
  for (const row of out.rows) for (const cell of row) assert.ok(!cell.includes('1+1'));
});

test('R3.5 celda con texto tipo =cmd() (CSV-injection) → string literal, no se ejecuta', () => {
  const buf = buildXlsx([
    ['name', 'note'],
    ['=cmd()', '=HYPERLINK("http://evil")'],
    ['@SUM(1)', '+1+1'],
  ]);
  const out = parseXlsx(buf);
  // Los metacaracteres de injection de fórmula se conservan COMO TEXTO (no se ejecutan; la
  // neutralización para filtros DB vive aguas abajo en escapeIlike del service, R3.5).
  assert.deepEqual(out.rows, [
    ['=cmd()', '=HYPERLINK("http://evil")'],
    ['@SUM(1)', '+1+1'],
  ]);
});

test('R3.6 bytes corruptos / no-xlsx → parseError true, NO lanza, no escribe nada', () => {
  // Un buffer que empieza como ZIP (PK) pero está roto hace que SheetJS lance "Unsupported
  // ZIP file". parseXlsx debe atrapar el throw y reportar parseError (el hook aborta, R3.6).
  const brokenZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
  const out = parseXlsx(brokenZip);
  assert.equal(out.parseError, true);
  assert.deepEqual(out.headers, []);
  assert.deepEqual(out.rows, []);
});

test('R3.6 data null → parseError, sin throw', () => {
  // @ts-expect-error — probamos el guard defensivo de entrada nula.
  const out = parseXlsx(null);
  assert.equal(out.parseError, true);
  assert.deepEqual(out.rows, []);
});

test('R4.1 solo se lee la PRIMERA hoja, no N hojas', () => {
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['caravana', 'sexo'],
    ['0241', 'M'],
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['otra', 'cosa'],
    ['no', 'deberia'],
    ['aparecer', 'aca'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Primera');
  XLSX.utils.book_append_sheet(wb, ws2, 'Segunda');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const out = parseXlsx(buf);
  assert.deepEqual(out.headers, ['caravana', 'sexo']);
  assert.deepEqual(out.rows, [['0241', 'M']]);
});

test('R4.1 hoja vacía → headers/rows vacíos, sin error (archivo legítimamente vacío)', () => {
  const ws = XLSX.utils.aoa_to_sheet([[]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const out = parseXlsx(buf);
  assert.deepEqual(out.headers, []);
  assert.deepEqual(out.rows, []);
  assert.equal(out.parseError ?? false, false, 'vacío legítimo NO es parseError');
});

test('R4.1 filas con celdas faltantes se rellenan (rectangular), sin romper', () => {
  // Fila con menos columnas que el header → defval '' completa las faltantes.
  const ws = XLSX.utils.aoa_to_sheet([
    ['caravana', 'sexo', 'raza'],
    ['0241', 'M'], // falta raza
  ]);
  // forzamos el !ref a 3 columnas para que la fila corta se rellene
  ws['!ref'] = 'A1:C2';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

  const out = parseXlsx(buf);
  assert.deepEqual(out.headers, ['caravana', 'sexo', 'raza']);
  assert.deepEqual(out.rows, [['0241', 'M', '']]);
});
