// Tests de la lógica PURA del dispatcher de render por maniobra (spec 03 M2.2 → M3.1 generaliza). node:test.
// Foco: el SEAM para M3.2 — cada maniobra del catálogo (12) resuelve a su StepKind real (M3.1 las cabló TODAS).

import test from 'node:test';
import assert from 'node:assert/strict';

import { stepKindFor, stepPersists, type StepKind } from './maneuver-step-kind';
import { ALL_MANEUVERS, type ManeuverKind } from './maneuver-gating';

// ─── stepKindFor: el mapeo completo (R5.4 destino de UI) ───────────────────────────────

test('stepKindFor: tacto → tacto (binario + tamaño)', () => {
  assert.equal(stepKindFor('tacto'), 'tacto');
});

test('stepKindFor: tacto_vaquillona → vaquillona (apta/no_apta/diferida)', () => {
  assert.equal(stepKindFor('tacto_vaquillona'), 'vaquillona');
});

test('stepKindFor: pesaje y pesaje_ternero → pesaje (mismo keypad)', () => {
  assert.equal(stepKindFor('pesaje'), 'pesaje');
  assert.equal(stepKindFor('pesaje_ternero'), 'pesaje');
});

test('stepKindFor: condicion_corporal → score (selector 1.00–5.00)', () => {
  assert.equal(stepKindFor('condicion_corporal'), 'score');
});

test('stepKindFor: antiparasitario y antibiotico → silent_single (un producto, silent_apply)', () => {
  assert.equal(stepKindFor('antiparasitario'), 'silent_single');
  assert.equal(stepKindFor('antibiotico'), 'silent_single');
});

test('stepKindFor: vacunacion → silent_multi (N vacunas)', () => {
  assert.equal(stepKindFor('vacunacion'), 'silent_multi');
});

test('stepKindFor: inseminacion → inseminacion (1 vs >1 pajuela)', () => {
  assert.equal(stepKindFor('inseminacion'), 'inseminacion');
});

test('stepKindFor: sangrado → lab_single (1 tubo); raspado → lab_double (2 tubos)', () => {
  assert.equal(stepKindFor('sangrado'), 'lab_single');
  assert.equal(stepKindFor('raspado'), 'lab_double');
});

test('stepKindFor: dientes → dientes (estado + prompt CUT)', () => {
  assert.equal(stepKindFor('dientes'), 'dientes');
});

test('stepKindFor: TODA maniobra del catálogo (12) resuelve a un StepKind conocido (exhaustivo)', () => {
  const valid: StepKind[] = [
    'tacto', 'vaquillona', 'pesaje', 'score', 'silent_single', 'silent_multi',
    'inseminacion', 'lab_single', 'lab_double', 'dientes',
  ];
  for (const m of ALL_MANEUVERS) {
    assert.ok(valid.includes(stepKindFor(m)), `${m} resolvió a un StepKind desconocido`);
  }
});

test('stepKindFor: un valor desconocido (defensivo, jsonb pass-through) → silent_single (inocuo)', () => {
  assert.equal(stepKindFor('no_existe' as ManeuverKind), 'silent_single');
});

// ─── stepPersists: en M3.1 todas las maniobras del catálogo persisten ──────────────────

test('stepPersists: TODA maniobra del catálogo persiste en M3.1 (cada una tiene write-path)', () => {
  for (const m of ALL_MANEUVERS) {
    assert.equal(stepPersists(m), true, `${m} debería persistir en M3.1`);
  }
});
