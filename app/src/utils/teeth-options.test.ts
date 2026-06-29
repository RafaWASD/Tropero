// Tests de la lógica PURA del catálogo de DIENTES (spec 03 M3.2a, R6.7/R6.8). node:test.
// Foco: las 8 opciones del enum 0020 en orden de boca + el mapeo valor → CUT-trigger (R6.8) + labels es-AR.

import test from 'node:test';
import assert from 'node:assert/strict';

import { TEETH_OPTIONS, teethLabel } from './teeth-options';
import { CUT_PROMPT_TEETH } from './maneuver-applicability';

// El enum real `teeth_state_enum` (migración 0020), en el ORDEN de presentación pedido por Raf (FIX #12,
// 2026-06-29): gastada → joven (reverso de la progresión etaria). Este array es el ORÁCULO del orden.
const ENUM_VALUES = ['sin_dientes', '1/4', '1/2', '3/4', 'boca_llena', '6d', '4d', '2d'];

// ─── Cobertura del enum + orden de boca ──────────────────────────────────────────────────────

test('R6.7: las opciones cubren EXACTAMENTE el enum teeth_state_enum (0020), en el orden gastada→joven (FIX #12)', () => {
  assert.deepEqual(
    TEETH_OPTIONS.map((o) => o.value),
    ENUM_VALUES,
  );
});

test('R6.7: el orden es de boca gastada a joven (sin_dientes…boca_llena…2d) — FIX #12', () => {
  const values = TEETH_OPTIONS.map((o) => o.value);
  // sin_dientes (vejez/descarte) arriba, boca_llena al medio, 2d (leche, joven) al final.
  assert.equal(values.indexOf('sin_dientes') < values.indexOf('boca_llena'), true);
  assert.equal(values.indexOf('boca_llena') < values.indexOf('2d'), true);
  assert.equal(values[0], 'sin_dientes');
  assert.equal(values[values.length - 1], '2d');
});

// ─── Mapeo valor → CUT-trigger (R6.8) ────────────────────────────────────────────────────────

test('R6.8: SOLO 1/2, 1/4 y sin_dientes son CUT-trigger (boca de descarte)', () => {
  const triggers = TEETH_OPTIONS.filter((o) => o.cutTrigger).map((o) => o.value);
  assert.deepEqual(triggers.sort(), ['1/2', '1/4', 'sin_dientes'].sort());
});

test('R6.8: 3/4 NO es CUT-trigger (umbral explícito de R6.8)', () => {
  const opt = TEETH_OPTIONS.find((o) => o.value === '3/4');
  assert.equal(opt?.cutTrigger, false);
});

test('R6.8: los dientes de leche/boca llena NO disparan CUT', () => {
  for (const v of ['2d', '4d', '6d', 'boca_llena']) {
    const opt = TEETH_OPTIONS.find((o) => o.value === v);
    assert.equal(opt?.cutTrigger, false, `${v} no debe disparar CUT`);
  }
});

test('R6.8: el cutTrigger se DERIVA de CUT_PROMPT_TEETH (única fuente de verdad del umbral)', () => {
  for (const opt of TEETH_OPTIONS) {
    assert.equal(opt.cutTrigger, CUT_PROMPT_TEETH.has(opt.value), `${opt.value} desincronizado con el set`);
  }
});

// ─── Labels es-AR ────────────────────────────────────────────────────────────────────────────

test('teethLabel: etiquetas es-AR de campo claras', () => {
  assert.equal(teethLabel('2d'), '2 dientes');
  assert.equal(teethLabel('boca_llena'), 'Boca llena');
  assert.equal(teethLabel('sin_dientes'), 'Sin dientes');
  assert.equal(teethLabel('1/2'), '1/2');
});

test('teethLabel: un valor fuera del catálogo cae al valor crudo (fallback defensivo)', () => {
  assert.equal(teethLabel('desconocido'), 'desconocido');
});
