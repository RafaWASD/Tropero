// Tests de la serialización del `value` custom (spec 03 M5-C.1, R13.16). PURO (sin SDK). El punto crítico:
// el número se serializa como NÚMERO JSON (no string) — el gating server-side exige jsonb_typeof='number'.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeCustomValue } from './custom-value.ts';

test('serializeCustomValue: number → número JSON (NO string) — exigencia del gating numeric server-side', () => {
  const r = serializeCustomValue(42.5);
  assert.ok(r.ok);
  assert.equal(r.json, '42.5'); // no '"42.5"'
  // round-trip: jsonb_typeof sería 'number'
  assert.equal(typeof JSON.parse(r.json), 'number');
});

test('serializeCustomValue: number entero y cero', () => {
  const a = serializeCustomValue(0);
  assert.ok(a.ok);
  assert.equal(a.json, '0');
  const b = serializeCustomValue(385);
  assert.ok(b.ok);
  assert.equal(b.json, '385');
});

test('serializeCustomValue: number NEGATIVO se serializa bien', () => {
  const r = serializeCustomValue(-3.25);
  assert.ok(r.ok);
  assert.equal(r.json, '-3.25');
});

test('serializeCustomValue: NaN / Infinity → error (JSON.stringify los volvería null → rompería validación numérica)', () => {
  const nan = serializeCustomValue(Number.NaN);
  assert.ok(!nan.ok);
  const inf = serializeCustomValue(Number.POSITIVE_INFINITY);
  assert.ok(!inf.ok);
  const ninf = serializeCustomValue(Number.NEGATIVE_INFINITY);
  assert.ok(!ninf.ok);
});

test('serializeCustomValue: boolean → bool JSON (true/false), no string', () => {
  const t = serializeCustomValue(true);
  assert.ok(t.ok);
  assert.equal(t.json, 'true');
  assert.equal(typeof JSON.parse(t.json), 'boolean');
  const f = serializeCustomValue(false);
  assert.ok(f.ok);
  assert.equal(f.json, 'false');
});

test('serializeCustomValue: string (text/date/enum_single) → string JSON entrecomillado', () => {
  const r = serializeCustomValue('overo');
  assert.ok(r.ok);
  assert.equal(r.json, '"overo"');
  assert.equal(typeof JSON.parse(r.json), 'string');
});

test('serializeCustomValue: string con comillas/acentos se escapa correctamente (round-trip)', () => {
  const r = serializeCustomValue('pezuña "rajada"');
  assert.ok(r.ok);
  assert.equal(JSON.parse(r.json), 'pezuña "rajada"');
});

test('serializeCustomValue: string vacío es válido (el server/UI decide si requiere no-vacío)', () => {
  const r = serializeCustomValue('');
  assert.ok(r.ok);
  assert.equal(r.json, '""');
});

test('serializeCustomValue: string[] (enum_multi) → array JSON de strings', () => {
  const r = serializeCustomValue(['rotacion_a', 'rotacion_b']);
  assert.ok(r.ok);
  assert.equal(r.json, '["rotacion_a","rotacion_b"]');
  const parsed = JSON.parse(r.json);
  assert.ok(Array.isArray(parsed));
  assert.deepEqual(parsed, ['rotacion_a', 'rotacion_b']);
});

test('serializeCustomValue: array vacío (enum_multi sin selección) es válido — array JSON vacío', () => {
  const r = serializeCustomValue([]);
  assert.ok(r.ok);
  assert.equal(r.json, '[]');
});

test('serializeCustomValue: array con un elemento NO-string → error (enum_multi es siempre string[])', () => {
  // @ts-expect-error — probamos defensa ante un caller mal tipado.
  const r = serializeCustomValue(['ok', 3]);
  assert.ok(!r.ok);
});

test('serializeCustomValue: null/undefined/objeto (caller no tipado) → error, no garbage', () => {
  // @ts-expect-error
  assert.ok(!serializeCustomValue(null).ok);
  // @ts-expect-error
  assert.ok(!serializeCustomValue(undefined).ok);
  // @ts-expect-error
  assert.ok(!serializeCustomValue({ a: 1 }).ok);
});
