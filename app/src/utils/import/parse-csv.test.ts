// Tests del parser CSV puro del importador (spec 12, T1.2 / R3.2, R3.3, R4.1).
// node:test + type-stripping nativo (sin Jest; mismo patrón que el resto de src/utils/*).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, detectDelimiter, MAX_ROWS, MAX_CELLS_PER_ROW } from './parse-csv.ts';

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

// --- Auto-detección de delimitador (Excel es-AR exporta CSV con `;`) ---

test('no-regresión: CSV coma sigue parseando idéntico', () => {
  const csv = 'a,b,c\n1,2,3\n4,5,6';
  const out = parseCsv(csv);
  assert.deepEqual(out.headers, ['a', 'b', 'c']);
  assert.deepEqual(out.rows, [
    ['1', '2', '3'],
    ['4', '5', '6'],
  ]);
});

test('punto y coma (export Excel es-AR) → 3 headers + fila correcta', () => {
  const out = parseCsv('a;b;c\n1;2;3');
  assert.deepEqual(out.headers, ['a', 'b', 'c']);
  assert.deepEqual(out.rows, [['1', '2', '3']]);
});

test('tab → 3 headers + fila correcta', () => {
  const out = parseCsv('a\tb\tc\n1\t2\t3');
  assert.deepEqual(out.headers, ['a', 'b', 'c']);
  assert.deepEqual(out.rows, [['1', '2', '3']]);
});

test('punto y coma con coma DENTRO de comillas: la coma interna no dispara coma como delimitador', () => {
  // Header `"a,b";c` tiene 1 coma (dentro de comillas, no cuenta) y 1 `;` (fuera).
  // Debe ganar `;` → 2 columnas, no 3.
  const out = parseCsv('"a,b";c\n"x,y";z');
  assert.deepEqual(out.headers, ['a,b', 'c']);
  assert.deepEqual(out.rows, [['x,y', 'z']]);
});

test('archivo de una sola columna (sin delimitador) → 1 columna, default coma sin romper', () => {
  const out = parseCsv('soloheader\nvalor1\nvalor2');
  assert.deepEqual(out.headers, ['soloheader']);
  assert.deepEqual(out.rows, [['valor1'], ['valor2']]);
});

test('empate de conteos (coma vs punto y coma) → default coma', () => {
  // Header `a,b;c` tiene 1 coma y 1 punto y coma → empate → default coma.
  // Con coma: ['a', 'b;c'] (el `;` queda como texto literal dentro de la 2da celda).
  const out = parseCsv('a,b;c\n1,2;3');
  assert.deepEqual(out.headers, ['a', 'b;c']);
  assert.deepEqual(out.rows, [['1', '2;3']]);
});

test('R3.2/R3.3 caps de filas funcionan con `;` como delimitador', () => {
  const lines = ['h1;h2']; // header con punto y coma
  for (let i = 0; i < MAX_ROWS + 10; i++) lines.push(`${i};x`);
  const out = parseCsv(lines.join('\n'));
  assert.deepEqual(out.headers, ['h1', 'h2']);
  assert.equal(out.rowsExceeded, true, 'debe señalar excedido también con `;`');
  assert.equal(out.rows.length, MAX_ROWS, 'no materializa más de MAX_ROWS con `;`');
  // Verifica que el delimitador se aplicó: cada fila tiene 2 celdas, no 1.
  assert.equal(out.rows[0].length, 2);
});

test('R3.2 exactamente MAX_ROWS filas con `;` → NO marca excedido', () => {
  const lines = ['h1;h2'];
  for (let i = 0; i < MAX_ROWS; i++) lines.push(`${i};x`);
  const out = parseCsv(lines.join('\n'));
  assert.equal(out.rowsExceeded, false);
  assert.equal(out.rows.length, MAX_ROWS);
  assert.equal(out.rows[0].length, 2);
});

test('detectDelimiter directa: cada candidato + default', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',', 'coma');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';', 'punto y coma');
  assert.equal(detectDelimiter('a\tb\tc'), '\t', 'tab');
  assert.equal(detectDelimiter('soloheader'), ',', 'sin delimitador → default coma');
  assert.equal(detectDelimiter(''), ',', 'string vacío → default coma');
  // @ts-expect-error robustez ante input no-string
  assert.equal(detectDelimiter(null), ',', 'no-string → default coma, never throws');
});

test('detectDelimiter: sólo mira el PRIMER registro (header), no las filas de datos', () => {
  // Header con coma (gana coma); las filas de datos usan `;` pero NO deben influir.
  assert.equal(detectDelimiter('a,b\n1;2;3;4;5'), ',');
});

test('detectDelimiter: `;` dentro de comillas en el header NO lo elige', () => {
  // Header `"a;b",c` → el `;` está entre comillas (no cuenta), la coma gana.
  assert.equal(detectDelimiter('"a;b",c\n1,2'), ',');
});

test('detectDelimiter: empate (1 coma + 1 punto y coma) → default coma', () => {
  assert.equal(detectDelimiter('a,b;c'), ',');
});

test('detectDelimiter: empate entre `;` y tab (ambos > coma) → default coma', () => {
  // semicolon=2, tab=2, comma=0 → empate en el tope → default coma.
  assert.equal(detectDelimiter('a;b;c\td\te'), ',');
});
