// Tests de la auto-detección + mapeo manual de columnas (spec 12, T1.8 / R4.1, R4.2).
// node:test + type-stripping nativo (sin Jest).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  autoDetectMapping,
  detectField,
  applyMappingOverride,
  columnIndexFor,
  normalizeHeader,
} from './column-mapping.ts';

test('R4.1 headers conocidos → mapeo esperado', () => {
  const headers = ['caravana', 'sexo', 'nacimiento', 'raza', 'categoria', 'lote'];
  const mapping = autoDetectMapping(headers);
  assert.deepEqual(mapping, ['idv', 'sex', 'birth_date', 'breed', 'category', 'lote']);
});

test('R4.1 detecta con tildes/mayúsculas/puntuación (normalización)', () => {
  assert.equal(detectField('Categoría'), 'category');
  assert.equal(detectField('FECHA DE NACIMIENTO'), 'birth_date');
  assert.equal(detectField('tag_electronico'), 'tag_electronic');
  assert.equal(detectField('Nro. Caravana'), 'idv');
  assert.equal(normalizeHeader('Categoría'), 'categoria');
});

test('R4.1 header ambiguo / desconocido → sin mapear (el operador decide)', () => {
  assert.equal(detectField('numero'), null, 'demasiado ambiguo → null');
  assert.equal(detectField('columna_x'), null);
  assert.equal(detectField(''), null);
  assert.equal(detectField('   '), null);
});

test('R4.1 dos headers que mapean al MISMO campo → solo el primero lo toma', () => {
  // 'caravana' y 'nro caravana' ambos → idv; solo el primero queda mapeado.
  const mapping = autoDetectMapping(['caravana', 'nro caravana', 'sexo']);
  assert.deepEqual(mapping, ['idv', null, 'sex']);
});

test('R4.2 override manual respetado (set de un campo a una columna)', () => {
  const base = autoDetectMapping(['col1', 'sexo', 'col3']); // [null, 'sex', null]
  const next = applyMappingOverride(base, 0, 'idv');
  assert.deepEqual(next, ['idv', 'sex', null]);
  // No muta el original (pureza).
  assert.deepEqual(base, [null, 'sex', null]);
});

test('R4.2 override que reasigna un campo ya usado → limpia la columna anterior (single-source)', () => {
  const base: (ReturnType<typeof detectField>)[] = ['idv', 'sex', null];
  // Asignar idv a la col 2 debe liberar la col 0.
  const next = applyMappingOverride(base, 2, 'idv');
  assert.deepEqual(next, [null, 'sex', 'idv']);
});

test('R4.2 override a null desmapea la columna', () => {
  const base = autoDetectMapping(['caravana', 'sexo']); // ['idv', 'sex']
  const next = applyMappingOverride(base, 0, null);
  assert.deepEqual(next, [null, 'sex']);
});

test('R4.2 override con índice fuera de rango → copia sin cambios', () => {
  const base = autoDetectMapping(['caravana', 'sexo']);
  const next = applyMappingOverride(base, 99, 'breed');
  assert.deepEqual(next, base);
  assert.notEqual(next, base, 'devuelve copia nueva, no la misma referencia');
});

test('columnIndexFor devuelve el índice del campo o -1', () => {
  const mapping = autoDetectMapping(['caravana', 'sexo', 'raza']); // ['idv','sex','breed']
  assert.equal(columnIndexFor(mapping, 'sex'), 1);
  assert.equal(columnIndexFor(mapping, 'breed'), 2);
  assert.equal(columnIndexFor(mapping, 'category'), -1, 'campo no mapeado → -1');
});

test('borde: headers no-array → mapeo vacío (defensivo)', () => {
  // @ts-expect-error robustez ante input no-array
  assert.deepEqual(autoDetectMapping(null), []);
});

test('sinónimos disjuntos: ningún synonym mapea a 2 campos distintos', () => {
  // Smoke test de coherencia: detectar todos los sinónimos no debe arrojar ambigüedad
  // (cubierto por construcción del índice; este test documenta la invariante).
  assert.equal(detectField('rfid'), 'tag_electronic');
  assert.equal(detectField('caravana'), 'idv');
  assert.notEqual(detectField('rfid'), detectField('caravana'));
});
