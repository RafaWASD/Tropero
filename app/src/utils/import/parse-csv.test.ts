// Tests del parser CSV puro del importador (spec 12, T1.2 / R3.2, R3.3, R4.1).
// node:test + type-stripping nativo (sin Jest; mismo patrón que el resto de src/utils/*).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, MAX_ROWS, MAX_CELLS_PER_ROW } from './parse-csv.ts';

test('R4.1 CSV bien formado → headers + filas correctas', () => {
  const csv = 'caravana,sexo,raza\n0241,M,Angus\n0242,H,Hereford';
  const out = parseCsv(csv);
  assert.deepEqual(out.headers, ['caravana', 'sexo', 'raza']);
  assert.deepEqual(out.rows, [
    ['0241', 'M', 'Angus'],
    ['0242', 'H', 'Hereford'],
  ]);
  assert.equal(out.rowsExceeded, false);
  assert.equal(out.cellsExceeded, false);
});

test('R4.1 CRLF + newline final no produce fila vacía espuria', () => {
  const csv = 'a,b\r\n1,2\r\n3,4\r\n';
  const out = parseCsv(csv);
  assert.deepEqual(out.headers, ['a', 'b']);
  assert.deepEqual(out.rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('R4.1 comillas: comas y comillas internas dentro de campo entrecomillado', () => {
  // El campo "Estancia, La Vieja" tiene una coma interna; "dijo ""hola""" tiene comillas escapadas.
  const csv = 'name,note\n"Estancia, La Vieja","dijo ""hola"""';
  const out = parseCsv(csv);
  assert.deepEqual(out.headers, ['name', 'note']);
  assert.deepEqual(out.rows, [['Estancia, La Vieja', 'dijo "hola"']]);
});

test('R4.1 comillas: salto de línea DENTRO de un campo entrecomillado no parte el registro', () => {
  const csv = 'name,note\n"linea1\nlinea2",ok';
  const out = parseCsv(csv);
  assert.deepEqual(out.rows, [['linea1\nlinea2', 'ok']]);
});

test('R3.5 una celda con `=cmd()` se trata como TEXTO literal (no fórmula)', () => {
  const csv = 'a\n=cmd()\n=HYPERLINK("http://x")';
  const out = parseCsv(csv);
  // El parser no interpreta ni evalúa: la celda es el string literal.
  assert.equal(out.rows[0][0], '=cmd()');
  // La segunda fila tiene comillas → se desentrecomilla el argumento, pero sigue siendo texto.
  assert.equal(out.rows[1][0], '=HYPERLINK(http://x)');
});

test('R3.2/R3.3 archivo con > MAX_ROWS filas → corta y SEÑALA excedido (no trunca silencioso)', () => {
  const lines = ['h']; // header
  for (let i = 0; i < MAX_ROWS + 25; i++) lines.push(String(i));
  const csv = lines.join('\n');
  const out = parseCsv(csv);
  assert.equal(out.rowsExceeded, true, 'debe señalar que se excedió el tope');
  // No materializa más de MAX_ROWS filas de datos (cap DURANTE la lectura).
  assert.equal(out.rows.length, MAX_ROWS, 'no materializa más de MAX_ROWS');
});

test('R3.2/R3.3 fila excedente SIN newline final (cae al flush final) → igual marca excedido', () => {
  // Borde: el registro que supera el tope es el último y el archivo NO termina en newline,
  // así que se procesa por el flush final. Igual debe marcar excedido y no materializarlo.
  const lines = ['h'];
  for (let i = 0; i < MAX_ROWS + 1; i++) lines.push(String(i));
  const out = parseCsv(lines.join('\n'));
  assert.equal(out.rowsExceeded, true);
  assert.equal(out.rows.length, MAX_ROWS);
});

test('R3.2 exactamente MAX_ROWS filas → NO marca excedido', () => {
  const lines = ['h'];
  for (let i = 0; i < MAX_ROWS; i++) lines.push(String(i));
  const out = parseCsv(lines.join('\n'));
  assert.equal(out.rowsExceeded, false);
  assert.equal(out.rows.length, MAX_ROWS);
});

test('R3.3 cap de celdas por fila → marca cellsExceeded y no crece sin límite', () => {
  const headerCells = Array.from({ length: MAX_CELLS_PER_ROW + 10 }, (_, i) => `c${i}`);
  const dataCells = Array.from({ length: MAX_CELLS_PER_ROW + 10 }, () => 'x');
  const csv = `${headerCells.join(',')}\n${dataCells.join(',')}`;
  const out = parseCsv(csv);
  assert.equal(out.cellsExceeded, true);
  assert.equal(out.headers.length, MAX_CELLS_PER_ROW, 'header topado a MAX_CELLS_PER_ROW');
  assert.equal(out.rows[0].length, MAX_CELLS_PER_ROW, 'fila topada a MAX_CELLS_PER_ROW');
});

test('borde: string vacío → tabla vacía sin romper', () => {
  const out = parseCsv('');
  assert.deepEqual(out.headers, []);
  assert.deepEqual(out.rows, []);
  assert.equal(out.rowsExceeded, false);
});

test('borde: solo header (sin filas de datos)', () => {
  const out = parseCsv('a,b,c');
  assert.deepEqual(out.headers, ['a', 'b', 'c']);
  assert.deepEqual(out.rows, []);
});

test('borde: líneas en blanco intermedias no generan filas vacías', () => {
  const csv = 'a,b\n1,2\n\n3,4\n';
  const out = parseCsv(csv);
  assert.deepEqual(out.rows, [
    ['1', '2'],
    ['3', '4'],
  ]);
});

test('borde: campo vacío entre comas se preserva', () => {
  const out = parseCsv('a,b,c\n1,,3');
  assert.deepEqual(out.rows, [['1', '', '3']]);
});

test('borde: input no-string → tabla vacía (defensivo, never throws)', () => {
  // @ts-expect-error probamos robustez ante input no-string
  const out = parseCsv(null);
  assert.deepEqual(out.headers, []);
  assert.deepEqual(out.rows, []);
});
