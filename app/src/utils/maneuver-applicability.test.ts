// Tests de la lógica PURA de aplicabilidad per-animal (spec 03 M3.1). node:test.
// Foco: R6.12 (raspado solo machos → se salta para hembras), R6.2/R6.3 (tactos solo hembras),
// R6.9/R6.10 (pesaje vs pesaje_ternero excluyentes por categoría → mata el doble pesaje) + R6.8 (prompt
// CUT no para terneros).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appliesToAnimal,
  filterByAnimalApplicability,
  shouldOfferCutPrompt,
  type AnimalApplicabilityInfo,
} from './maneuver-applicability';
import { buildSequence } from './maneuver-sequence';
import type { ManeuverKind } from './maneuver-gating';

const MALE: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'toro' };
const FEMALE: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'vaca_segundo_servicio' };
const CALF_M: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'ternero' };
const CALF_F: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'ternera' };
const UNKNOWN_SEX: AnimalApplicabilityInfo = { sex: null, categoryCode: 'vaquillona' };
// Adulto/recría sin categoría resuelta (fail-safe del pesaje): se pesa como adulto, NO como ternero.
const UNKNOWN_CATEGORY: AnimalApplicabilityInfo = { sex: 'female', categoryCode: null };
const HEIFER: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'vaquillona' };

// ─── R6.12 — Raspado solo machos ───────────────────────────────────────────────────────

test('R6.12: raspado APLICA a un macho', () => {
  assert.equal(appliesToAnimal('raspado', MALE), true);
});

test('R6.12: raspado NO aplica a una hembra (se salta)', () => {
  assert.equal(appliesToAnimal('raspado', FEMALE), false);
});

test('R6.12: raspado con sexo desconocido → NO aplica (fail-safe, no escribe raspado sin confirmar toro)', () => {
  assert.equal(appliesToAnimal('raspado', UNKNOWN_SEX), false);
});

test('las maniobras sin filtro de sexo/categoría aplican a cualquier animal (sangrado/vacunación/etc.)', () => {
  // SOLO las maniobras que NO filtran por sexo ni categoría. Las filtradas (raspado, tacto, tacto_vaquillona,
  // pesaje, pesaje_ternero) tienen sus propios tests abajo — incluirlas acá daría falsos verdaderos.
  const agnostic: ManeuverKind[] = [
    'sangrado', 'vacunacion', 'inseminacion', 'condicion_corporal', 'dientes', 'antiparasitario', 'antibiotico',
  ];
  for (const m of agnostic) {
    assert.equal(appliesToAnimal(m, FEMALE), true, `${m} debería aplicar a una hembra`);
    assert.equal(appliesToAnimal(m, MALE), true, `${m} debería aplicar a un macho`);
    assert.equal(appliesToAnimal(m, UNKNOWN_SEX), true, `${m} debería aplicar con sexo desconocido`);
    assert.equal(appliesToAnimal(m, UNKNOWN_CATEGORY), true, `${m} debería aplicar con categoría desconocida`);
  }
});

test('R6.12: filterByAnimalApplicability saca el raspado para una hembra, preserva el resto y el orden', () => {
  const seq: ManeuverKind[] = ['pesaje', 'raspado', 'vacunacion'];
  const r = filterByAnimalApplicability(seq, FEMALE);
  assert.deepEqual(r.applicable, ['pesaje', 'vacunacion']);
  assert.deepEqual(r.skipped, ['raspado']);
});

test('R6.12: filterByAnimalApplicability deja el raspado para un macho (incluido el peso de adulto)', () => {
  const seq: ManeuverKind[] = ['pesaje', 'raspado', 'vacunacion'];
  const r = filterByAnimalApplicability(seq, MALE);
  assert.deepEqual(r.applicable, ['pesaje', 'raspado', 'vacunacion']);
  assert.deepEqual(r.skipped, []);
});

// ─── R6.2/R6.3 — Tacto de preñez / de aptitud: solo hembras ────────────────────────────

test('R6.2/R6.3: tacto y tacto_vaquillona APLICAN a una hembra', () => {
  assert.equal(appliesToAnimal('tacto', FEMALE), true);
  assert.equal(appliesToAnimal('tacto_vaquillona', FEMALE), true);
  assert.equal(appliesToAnimal('tacto', HEIFER), true);
  assert.equal(appliesToAnimal('tacto_vaquillona', HEIFER), true);
});

test('R6.2/R6.3: tacto y tacto_vaquillona NO aplican a un macho (un toro no se tacta → se saltan)', () => {
  assert.equal(appliesToAnimal('tacto', MALE), false);
  assert.equal(appliesToAnimal('tacto_vaquillona', MALE), false);
});

test('R6.2/R6.3: tacto/tacto_vaquillona con sexo desconocido → NO aplican (fail-safe, no se tacta sin sexo)', () => {
  assert.equal(appliesToAnimal('tacto', UNKNOWN_SEX), false);
  assert.equal(appliesToAnimal('tacto_vaquillona', UNKNOWN_SEX), false);
});

test('R6.2/R6.3: filterByAnimalApplicability saca AMBOS tactos de un macho (deja el peso de adulto + raspado)', () => {
  const seq: ManeuverKind[] = ['tacto', 'tacto_vaquillona', 'pesaje', 'raspado'];
  const r = filterByAnimalApplicability(seq, MALE);
  assert.deepEqual(r.applicable, ['pesaje', 'raspado']);
  assert.deepEqual(r.skipped, ['tacto', 'tacto_vaquillona']);
});

// ─── R6.9/R6.10 — Pesaje vs pesaje_ternero: excluyentes por categoría (mata el doble pesaje) ────

test('R6.10: pesaje_ternero APLICA a ternero/ternera; pesaje NO (cría al pie → solo peso de ternero)', () => {
  for (const calf of [CALF_M, CALF_F]) {
    assert.equal(appliesToAnimal('pesaje_ternero', calf), true, 'pesaje_ternero → ternero/ternera');
    assert.equal(appliesToAnimal('pesaje', calf), false, 'pesaje genérico NO → ternero/ternera');
  }
});

test('R6.9: pesaje APLICA a un adulto/recría (vaca/toro/vaquillona); pesaje_ternero NO', () => {
  for (const adult of [FEMALE, MALE, HEIFER]) {
    assert.equal(appliesToAnimal('pesaje', adult), true, 'pesaje → adulto/recría');
    assert.equal(appliesToAnimal('pesaje_ternero', adult), false, 'pesaje_ternero NO → adulto/recría');
  }
});

test('R6.9: categoría desconocida (null) → pesaje APLICA (peso genérico de adulto), pesaje_ternero se SALTA', () => {
  assert.equal(appliesToAnimal('pesaje', UNKNOWN_CATEGORY), true);
  assert.equal(appliesToAnimal('pesaje_ternero', UNKNOWN_CATEGORY), false);
});

test('R6.9/R6.10: pesaje y pesaje_ternero NUNCA aplican a la vez (mutuamente excluyentes por categoría)', () => {
  for (const a of [MALE, FEMALE, CALF_M, CALF_F, UNKNOWN_SEX, UNKNOWN_CATEGORY, HEIFER]) {
    const both = appliesToAnimal('pesaje', a) && appliesToAnimal('pesaje_ternero', a);
    assert.equal(both, false, `pesaje y pesaje_ternero no pueden coincidir para ${a.categoryCode ?? 'null'}`);
  }
});

// ─── Integración con la secuencia real (buildSequence ∘ filterByAnimalApplicability) ───────────
// Reproduce lo que hace carga.tsx: del set de maniobras aplicables al rodeo, filtra por animal y ordena.

test('secuencia: un TERNERO en un rodeo con peso → pesaje_ternero, SIN pesaje (no hay doble pesaje)', () => {
  const ordered: ManeuverKind[] = ['vacunacion', 'pesaje', 'pesaje_ternero'];
  const { applicable } = filterByAnimalApplicability(ordered, CALF_M);
  const steps = buildSequence(ordered, applicable).map((s) => s.maneuver);
  assert.deepEqual(steps, ['vacunacion', 'pesaje_ternero']);
});

test('secuencia: un ADULTO (vaca) en un rodeo con peso → pesaje, SIN pesaje_ternero (1 solo peso)', () => {
  const ordered: ManeuverKind[] = ['pesaje', 'pesaje_ternero', 'vacunacion'];
  const { applicable } = filterByAnimalApplicability(ordered, FEMALE);
  const steps = buildSequence(ordered, applicable).map((s) => s.maneuver);
  assert.deepEqual(steps, ['pesaje', 'vacunacion']);
});

test('secuencia: categoría null → pesaje sí, pesaje_ternero no (fail-safe, 1 solo paso de peso)', () => {
  const ordered: ManeuverKind[] = ['pesaje_ternero', 'pesaje'];
  const { applicable } = filterByAnimalApplicability(ordered, UNKNOWN_CATEGORY);
  const steps = buildSequence(ordered, applicable).map((s) => s.maneuver);
  assert.deepEqual(steps, ['pesaje']);
});

test('secuencia: un MACHO con tacto/tacto_vaquillona en la sesión → ambos se saltan; raspado queda', () => {
  const ordered: ManeuverKind[] = ['tacto', 'tacto_vaquillona', 'raspado', 'pesaje'];
  const { applicable } = filterByAnimalApplicability(ordered, MALE);
  const steps = buildSequence(ordered, applicable).map((s) => s.maneuver);
  assert.deepEqual(steps, ['raspado', 'pesaje']);
});

test('secuencia: una HEMBRA → tactos según rodeo (sí), raspado se salta', () => {
  const ordered: ManeuverKind[] = ['tacto', 'tacto_vaquillona', 'raspado', 'pesaje'];
  const { applicable } = filterByAnimalApplicability(ordered, FEMALE);
  const steps = buildSequence(ordered, applicable).map((s) => s.maneuver);
  assert.deepEqual(steps, ['tacto', 'tacto_vaquillona', 'pesaje']);
});

// ─── R6.8 — Prompt CUT no para terneros ────────────────────────────────────────────────

test('R6.8: prompt CUT se ofrece en boca gastada (1/2, 1/4, sin_dientes) de un animal NO-ternero', () => {
  for (const teeth of ['1/2', '1/4', 'sin_dientes']) {
    assert.equal(shouldOfferCutPrompt(teeth, FEMALE), true, `${teeth} → prompt CUT`);
    assert.equal(shouldOfferCutPrompt(teeth, MALE), true, `${teeth} → prompt CUT (macho)`);
  }
});

test('R6.8: prompt CUT NO se ofrece para 3/4 ni para boca llena (umbral: solo 1/2, 1/4, sin_dientes)', () => {
  assert.equal(shouldOfferCutPrompt('3/4', FEMALE), false);
  assert.equal(shouldOfferCutPrompt('boca_llena', FEMALE), false);
  assert.equal(shouldOfferCutPrompt('6d', FEMALE), false);
});

test('R6.8: prompt CUT NO se ofrece para un TERNERO/TERNERA aunque tenga boca gastada', () => {
  assert.equal(shouldOfferCutPrompt('sin_dientes', CALF_M), false);
  assert.equal(shouldOfferCutPrompt('1/2', CALF_F), false);
});

test('R6.8: categoría desconocida (null) → se permite el prompt (el operario confirma; no se aplica CUT solo)', () => {
  assert.equal(shouldOfferCutPrompt('1/4', { sex: 'female', categoryCode: null }), true);
});
