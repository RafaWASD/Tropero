// Tests de la lógica PURA de aplicabilidad per-animal (spec 03 M3.1). node:test.
// Foco: R6.12 (raspado solo machos → se salta para hembras), R6.2/R6.3 (tactos solo hembras),
// R6.9/R6.10 (pesaje vs pesaje_ternero excluyentes por categoría → mata el doble pesaje) + R6.8 (prompt
// CUT no para terneros).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appliesToAnimal,
  filterByAnimalApplicability,
  isBullEntire,
  shouldOfferCutPrompt,
  type AnimalApplicabilityInfo,
} from './maneuver-applicability';
import { buildSequence } from './maneuver-sequence';
import type { ManeuverKind } from './maneuver-gating';

// isCastrated REAL del perfil (0084): entero por default en estos fixtures (false); los castrados y la
// castración desconocida tienen fixtures propios abajo (sección CE, R14.2/R14.3).
const MALE: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'toro', isCastrated: false };
const FEMALE: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'vaca_segundo_servicio', isCastrated: false };
const CALF_M: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'ternero', isCastrated: false };
const CALF_F: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'ternera', isCastrated: false };
const UNKNOWN_SEX: AnimalApplicabilityInfo = { sex: null, categoryCode: 'vaquillona', isCastrated: false };
// Adulto/recría sin categoría resuelta (fail-safe del pesaje): se pesa como adulto, NO como ternero.
const UNKNOWN_CATEGORY: AnimalApplicabilityInfo = { sex: 'female', categoryCode: null, isCastrated: false };
const HEIFER: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'vaquillona', isCastrated: false };

// ─── Fixtures de CE (R14.2/R14.3): macho entero (torito/toro), castrado (novillo), castración desconocida ──
const TORITO: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'torito', isCastrated: false };
const TORO: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'toro', isCastrated: false };
const NOVILLO: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'novillo', isCastrated: true };
const NOVILLITO: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'novillito', isCastrated: true };
// Castrado por is_castrated pero con categoría aún torito/toro (espejo no recomputado todavía): se excluye.
const TORO_CASTRADO: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'toro', isCastrated: true };
// Castración DESCONOCIDA (null) en un torito → se INCLUYE (entero por defecto, R14.3).
const TORITO_CAST_UNKNOWN: AnimalApplicabilityInfo = { sex: 'male', categoryCode: 'torito', isCastrated: null };

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
  // pesaje, pesaje_ternero, inseminacion) tienen sus propios tests abajo — incluirlas acá daría falsos
  // verdaderos. `inseminacion` SALIÓ de este set (delta aptitud RAR.6): ya NO es agnóstica (filtra hembra+apta).
  const agnostic: ManeuverKind[] = [
    'sangrado', 'vacunacion', 'condicion_corporal', 'dientes', 'antiparasitario', 'antibiotico',
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

// ─── RAR.6 — Inseminación: hembra + apta (corrección #1b) con fallback de edad ──────────────────
// FEMALE = vaca_segundo_servicio (probada) → apta. HEIFER = vaquillona sin veredicto ni edad → NO apta.

const HEIFER_APTA: AnimalApplicabilityInfo = {
  sex: 'female', categoryCode: 'vaquillona', isCastrated: false, aptitude: 'apta', ageDays: 200,
};
const HEIFER_NO_APTA: AnimalApplicabilityInfo = {
  sex: 'female', categoryCode: 'vaquillona', isCastrated: false, aptitude: 'no_apta', ageDays: 9999,
};
const HEIFER_DIFERIDA: AnimalApplicabilityInfo = {
  sex: 'female', categoryCode: 'vaquillona', isCastrated: false, aptitude: 'diferida', ageDays: 9999,
};
// Vaquillona SIN veredicto con edad de servicio (≥365 d) → apta por fallback de edad (alineado a 0105).
const HEIFER_OLD_NO_VERDICT: AnimalApplicabilityInfo = {
  sex: 'female', categoryCode: 'vaquillona', isCastrated: false, aptitude: null, ageDays: 365,
};
// Vaquillona SIN veredicto y <365 d → NO apta (no llegó a edad de servicio).
const HEIFER_YOUNG_NO_VERDICT: AnimalApplicabilityInfo = {
  sex: 'female', categoryCode: 'vaquillona', isCastrated: false, aptitude: null, ageDays: 364,
};
const MULTIPARA: AnimalApplicabilityInfo = {
  sex: 'female', categoryCode: 'multipara', isCastrated: false,
};
const CUT: AnimalApplicabilityInfo = { sex: 'female', categoryCode: 'cut', isCastrated: false };

test('RAR.6.2: inseminación APLICA a hembra probada (multipara/vaca_segundo_servicio) y a vaquillona apta', () => {
  assert.equal(appliesToAnimal('inseminacion', MULTIPARA), true);
  assert.equal(appliesToAnimal('inseminacion', FEMALE), true); // vaca_segundo_servicio (probada)
  assert.equal(appliesToAnimal('inseminacion', HEIFER_APTA), true);
});

test('RAR.6.3: inseminación NO aplica a macho (cierra #1b: hoy dejaba inseminar machos) ni a sexo desconocido', () => {
  assert.equal(appliesToAnimal('inseminacion', MALE), false);
  assert.equal(appliesToAnimal('inseminacion', UNKNOWN_SEX), false);
});

test('RAR.6.4: inseminación NO aplica a ternera', () => {
  assert.equal(appliesToAnimal('inseminacion', CALF_F), false);
});

test('RAR.6.5: inseminación NO aplica a vaquillona no_apta/diferida; SÍ a sin-veredicto ≥365 d; NO a <365 d', () => {
  assert.equal(appliesToAnimal('inseminacion', HEIFER_NO_APTA), false);
  assert.equal(appliesToAnimal('inseminacion', HEIFER_DIFERIDA), false);
  assert.equal(appliesToAnimal('inseminacion', HEIFER_OLD_NO_VERDICT), true); // fallback de edad (0105)
  assert.equal(appliesToAnimal('inseminacion', HEIFER_YOUNG_NO_VERDICT), false);
  // vaquillona sin veredicto y SIN aptitude/ageDays (call-site que no los pasa) → NO apta (fail-safe)
  assert.equal(appliesToAnimal('inseminacion', HEIFER), false);
});

test('RAR.6.6: inseminación NO aplica a un animal CUT (categoría cut)', () => {
  assert.equal(appliesToAnimal('inseminacion', CUT), false);
});

test('RAR.6.3: filterByAnimalApplicability saca la inseminación de un macho, preserva el resto y el orden', () => {
  const seq: ManeuverKind[] = ['pesaje', 'inseminacion', 'vacunacion'];
  const r = filterByAnimalApplicability(seq, MALE);
  assert.deepEqual(r.applicable, ['pesaje', 'vacunacion']);
  assert.deepEqual(r.skipped, ['inseminacion']);
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
  assert.equal(shouldOfferCutPrompt('1/4', { sex: 'female', categoryCode: null, isCastrated: false }), true);
});

// ─── R14.2/R14.3 — Circunferencia escrotal: solo machos ENTEROS no-ternero ──────────────────────

test('R14.2: CE APLICA a un torito y a un toro ENTEROS (is_castrated=false)', () => {
  assert.equal(appliesToAnimal('circunferencia_escrotal', TORITO), true);
  assert.equal(appliesToAnimal('circunferencia_escrotal', TORO), true);
});

test('R14.2: CE NO aplica a una HEMBRA (vaca/vaquillona) — se salta', () => {
  assert.equal(appliesToAnimal('circunferencia_escrotal', FEMALE), false);
  assert.equal(appliesToAnimal('circunferencia_escrotal', HEIFER), false);
});

test('R14.2: CE NO aplica a un TERNERO/TERNERA — se salta', () => {
  assert.equal(appliesToAnimal('circunferencia_escrotal', CALF_M), false);
  assert.equal(appliesToAnimal('circunferencia_escrotal', CALF_F), false);
});

test('R14.2: CE NO aplica a un NOVILLO/NOVILLITO (castrado por categoría) — se salta', () => {
  assert.equal(appliesToAnimal('circunferencia_escrotal', NOVILLO), false);
  assert.equal(appliesToAnimal('circunferencia_escrotal', NOVILLITO), false);
});

test('R14.2: CE NO aplica a un macho con is_castrated=true aunque la categoría siga siendo toro (espejo no recomputado)', () => {
  assert.equal(appliesToAnimal('circunferencia_escrotal', TORO_CASTRADO), false);
});

test('R14.3: castración DESCONOCIDA (null) en un torito → CE se INCLUYE (entero por defecto; UX, no seguridad)', () => {
  assert.equal(appliesToAnimal('circunferencia_escrotal', TORITO_CAST_UNKNOWN), true);
});

test('R14.2: CE con categoría null (irresoluble) → se salta (no se ofrece a un animal sin categoría)', () => {
  assert.equal(
    appliesToAnimal('circunferencia_escrotal', { sex: 'male', categoryCode: null, isCastrated: false }),
    false,
  );
});

test('R14.4: filterByAnimalApplicability saca la CE para una hembra/ternero/castrado, preserva el resto y el orden', () => {
  const seq: ManeuverKind[] = ['vacunacion', 'circunferencia_escrotal', 'pesaje'];
  // Hembra → CE se salta.
  const f = filterByAnimalApplicability(seq, FEMALE);
  assert.deepEqual(f.applicable, ['vacunacion', 'pesaje']);
  assert.deepEqual(f.skipped, ['circunferencia_escrotal']);
  // Novillo → CE se salta.
  const n = filterByAnimalApplicability(seq, NOVILLO);
  assert.deepEqual(n.applicable, ['vacunacion', 'pesaje']);
  assert.deepEqual(n.skipped, ['circunferencia_escrotal']);
});

test('secuencia: un TORO entero con CE en la sesión → la CE entra en orden; una hembra la saltea', () => {
  const ordered: ManeuverKind[] = ['vacunacion', 'circunferencia_escrotal', 'pesaje'];
  const bull = filterByAnimalApplicability(ordered, TORO);
  const bullSteps = buildSequence(ordered, bull.applicable).map((s) => s.maneuver);
  assert.deepEqual(bullSteps, ['vacunacion', 'circunferencia_escrotal', 'pesaje']);

  const cow = filterByAnimalApplicability(ordered, FEMALE);
  const cowSteps = buildSequence(ordered, cow.applicable).map((s) => s.maneuver);
  assert.deepEqual(cowSteps, ['vacunacion', 'pesaje']);
});

// ─── isBullEntire (spec 03 M6-C.2, R14.14): gate de la tarjeta de tendencia de CE en la ficha ─────

test('isBullEntire: torito/toro entero → true; con castración desconocida (null) también → true (R14.3)', () => {
  assert.equal(isBullEntire('torito', false), true);
  assert.equal(isBullEntire('toro', false), true);
  // Castración DESCONOCIDA → INCLUYE (entero por defecto, R14.3 — display, no seguridad).
  assert.equal(isBullEntire('toro', null), true);
  assert.equal(isBullEntire('torito', undefined), true);
});

test('isBullEntire: hembra/ternero/novillo/castrado/sin categoría → false (no se muestra la tarjeta)', () => {
  assert.equal(isBullEntire('vaca_multipara', false), false);
  assert.equal(isBullEntire('vaquillona', false), false);
  assert.equal(isBullEntire('ternero', false), false); // ternero macho NO es entero adulto
  assert.equal(isBullEntire('novillo', false), false); // castrado → categoría fuera del set
  assert.equal(isBullEntire('toro', true), false); // entero adulto PERO castrado=true → no
  assert.equal(isBullEntire('novillito', true), false);
  assert.equal(isBullEntire(null, false), false); // categoría irresoluble → no se muestra
  assert.equal(isBullEntire(undefined, null), false);
});

test('isBullEntire: paridad EXACTA con appliesToAnimal(circunferencia_escrotal, …) — mismo set, mismo criterio', () => {
  // El gate de la tarjeta (display) debe coincidir con la aplicabilidad de la maniobra (carga). Barremos
  // una matriz de (categoría × castración) y verificamos que ambos predicados dan lo MISMO.
  const cats = ['torito', 'toro', 'novillo', 'novillito', 'ternero', 'vaquillona', 'vaca_multipara', null];
  const casts: (boolean | null)[] = [true, false, null];
  for (const c of cats) {
    for (const k of casts) {
      const info: AnimalApplicabilityInfo = { sex: 'male', categoryCode: c, isCastrated: k };
      assert.equal(
        isBullEntire(c, k),
        appliesToAnimal('circunferencia_escrotal', info),
        `desalineado para categoría=${c} castrado=${k}`,
      );
    }
  }
});
