// Tests de la lógica PURA del render genérico de un dato custom (spec 03 M5-C.3, R13.8/R13.10). node:test.
// Foco: opciones de enum desde config_schema (TOLERANTE), lectura del value jsonb por ui_component, texto
// legible es-AR (resumen/ficha) y completitud (gate del CTA).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureKindFor,
  describeCustomValue,
  isCustomValueComplete,
  parseCustomOptions,
  parseCustomValueJson,
  toCustomValue,
  type CustomCaptureValue,
} from './custom-render';

// ─── captureKindFor: el kind del value por ui_component ──────────────────────────────────

test('captureKindFor: numeric/numeric_stepped → number; boolean → boolean; enum_multi → multi; resto → string', () => {
  assert.equal(captureKindFor('numeric'), 'number');
  assert.equal(captureKindFor('numeric_stepped'), 'number');
  assert.equal(captureKindFor('boolean'), 'boolean');
  assert.equal(captureKindFor('enum_multi'), 'multi');
  assert.equal(captureKindFor('text'), 'string');
  assert.equal(captureKindFor('date'), 'string');
  assert.equal(captureKindFor('enum_single'), 'string');
});

// ─── parseCustomOptions: opciones de enum desde config_schema (TOLERANTE) ─────────────────

test('parseCustomOptions: objeto {options:[...]} → la lista (dedup case-insensitive, trim)', () => {
  assert.deepEqual(parseCustomOptions({ options: ['Adentro', 'Afuera', 'Normal'] }), [
    'Adentro',
    'Afuera',
    'Normal',
  ]);
  assert.deepEqual(parseCustomOptions({ options: [' A ', 'A', 'a', 'B', ''] }), ['A', 'B']);
});

test('parseCustomOptions: string JSON de {options:[...]} (config_schema como TEXT local) → la lista', () => {
  assert.deepEqual(parseCustomOptions('{"options":["X","Y"]}'), ['X', 'Y']);
});

test('parseCustomOptions: string JSON DOBLE-encodeado (jsonb sincronizado) → la lista', () => {
  assert.deepEqual(parseCustomOptions('"{\\"options\\":[\\"X\\",\\"Y\\"]}"'), ['X', 'Y']);
});

test('parseCustomOptions: null / array / number / sin options → [] (no tira)', () => {
  assert.deepEqual(parseCustomOptions(null), []);
  assert.deepEqual(parseCustomOptions(undefined), []);
  assert.deepEqual(parseCustomOptions([1, 2]), []);
  assert.deepEqual(parseCustomOptions(42), []);
  assert.deepEqual(parseCustomOptions({ foo: 'bar' }), []);
  assert.deepEqual(parseCustomOptions('no-json{'), []);
});

// ─── parseCustomValueJson: value jsonb → CustomCaptureValue por ui_component ───────────────

test('parseCustomValueJson: number nativo o string JSON → {kind:number}', () => {
  assert.deepEqual(parseCustomValueJson(385, 'numeric'), { kind: 'number', value: 385 });
  assert.deepEqual(parseCustomValueJson('385', 'numeric'), { kind: 'number', value: 385 });
  assert.deepEqual(parseCustomValueJson('4.5', 'numeric_stepped'), { kind: 'number', value: 4.5 });
});

test('parseCustomValueJson: number incompatible con ui_component string → null (TOLERANTE)', () => {
  assert.equal(parseCustomValueJson('overo', 'numeric'), null); // un texto no es número
});

test('parseCustomValueJson: boolean nativo o JSON → {kind:boolean}', () => {
  assert.deepEqual(parseCustomValueJson(true, 'boolean'), { kind: 'boolean', value: true });
  assert.deepEqual(parseCustomValueJson('false', 'boolean'), { kind: 'boolean', value: false });
});

test('parseCustomValueJson: string (text/date/enum_single) — JSON-string o literal', () => {
  assert.deepEqual(parseCustomValueJson('"Afuera"', 'enum_single'), { kind: 'string', value: 'Afuera' });
  // string literal plano (no JSON parseable como otra cosa) → se usa tal cual.
  assert.deepEqual(parseCustomValueJson('texto suelto', 'text'), { kind: 'string', value: 'texto suelto' });
  assert.deepEqual(parseCustomValueJson('2026-06-17', 'date'), { kind: 'string', value: '2026-06-17' });
});

test('parseCustomValueJson: enum_multi array nativo o JSON, filtra a strings', () => {
  assert.deepEqual(parseCustomValueJson(['A', 'B'], 'enum_multi'), { kind: 'multi', value: ['A', 'B'] });
  assert.deepEqual(parseCustomValueJson('["A","B"]', 'enum_multi'), { kind: 'multi', value: ['A', 'B'] });
  assert.deepEqual(parseCustomValueJson(['A', 1, null, 'B'], 'enum_multi'), { kind: 'multi', value: ['A', 'B'] });
});

test('parseCustomValueJson: doble-encoding del jsonb sincronizado (string de string) para number', () => {
  // PowerSync puede materializar un jsonb numérico doblemente serializado en la columna TEXT.
  assert.deepEqual(parseCustomValueJson('"385"', 'numeric'), { kind: 'number', value: 385 });
});

test('parseCustomValueJson: null/ausente → null', () => {
  assert.equal(parseCustomValueJson(null, 'text'), null);
  assert.equal(parseCustomValueJson(undefined, 'numeric'), null);
});

// ─── describeCustomValue: texto legible es-AR (resumen R5.9 + ficha) ──────────────────────

test('describeCustomValue: number en es-AR (coma decimal), boolean Sí/No, string, multi coma-join', () => {
  assert.equal(describeCustomValue({ kind: 'number', value: 385 }), '385');
  assert.equal(describeCustomValue({ kind: 'number', value: 4.5 }), '4,5');
  assert.equal(describeCustomValue({ kind: 'boolean', value: true }), 'Sí');
  assert.equal(describeCustomValue({ kind: 'boolean', value: false }), 'No');
  assert.equal(describeCustomValue({ kind: 'string', value: 'Afuera' }), 'Afuera');
  assert.equal(describeCustomValue({ kind: 'multi', value: ['A', 'B'] }), 'A, B');
});

test('describeCustomValue: vacíos → "—"; null → "Sin cargar"', () => {
  assert.equal(describeCustomValue({ kind: 'string', value: '  ' }), '—');
  assert.equal(describeCustomValue({ kind: 'multi', value: [] }), '—');
  assert.equal(describeCustomValue(null), 'Sin cargar');
  assert.equal(describeCustomValue(undefined), 'Sin cargar');
});

// ─── isCustomValueComplete: gate del CTA / completitud del paso ────────────────────────────

test('isCustomValueComplete: number finito (incl. 0/negativo) → true; NaN → false', () => {
  assert.equal(isCustomValueComplete({ kind: 'number', value: 0 }), true);
  assert.equal(isCustomValueComplete({ kind: 'number', value: -3 }), true);
  assert.equal(isCustomValueComplete({ kind: 'number', value: NaN }), false);
});

test('isCustomValueComplete: boolean siempre true; string no-vacío; multi ≥1', () => {
  assert.equal(isCustomValueComplete({ kind: 'boolean', value: false }), true);
  assert.equal(isCustomValueComplete({ kind: 'string', value: 'X' }), true);
  assert.equal(isCustomValueComplete({ kind: 'string', value: '  ' }), false);
  assert.equal(isCustomValueComplete({ kind: 'multi', value: ['A'] }), true);
  assert.equal(isCustomValueComplete({ kind: 'multi', value: [] }), false);
  assert.equal(isCustomValueComplete(null), false);
});

// ─── toCustomValue: mapea al CustomValue plano del lado escritura ─────────────────────────

test('toCustomValue: extrae el value plano (lo que serializeCustomValue espera)', () => {
  const cases: CustomCaptureValue[] = [
    { kind: 'number', value: 385 },
    { kind: 'boolean', value: true },
    { kind: 'string', value: 'Afuera' },
    { kind: 'multi', value: ['A', 'B'] },
  ];
  assert.deepEqual(cases.map(toCustomValue), [385, true, 'Afuera', ['A', 'B']]);
});
