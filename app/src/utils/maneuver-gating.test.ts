// Tests de la lógica PURA del gating de maniobras (capa 1, ADR-021 / spec 03 M1.1). node:test
// (mismo runner que el resto de la suite unit, sin Jest/RN). Tabla de casos: rodeo con/sin data_key,
// multi-key tacto, required/optional, filtrado para preset/wizard.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANEUVER_DATA_KEYS,
  ALL_MANEUVERS,
  resolveManeuverGating,
  resolveSessionGating,
  filterApplicableManeuvers,
  type ManeuverKind,
  type RodeoDataKeyMap,
} from './maneuver-gating';

// ─── Helpers de fixture: arma un RodeoDataKeyMap desde una lista de data_keys enabled/required ───

function config(
  enabled: readonly string[],
  required: readonly string[] = [],
): RodeoDataKeyMap {
  const map: Record<string, { enabled: boolean; required: boolean }> = {};
  for (const k of enabled) map[k] = { enabled: true, required: required.includes(k) };
  // un data_key con enabled=false explícito (presente pero apagado) también es un caso real.
  return map;
}

// ─── Mapeo (R5.4): shape estable ──────────────────────────────────────────────────────

test('R5.4: el mapeo MANEUVER_DATA_KEYS cubre las 12 maniobras con los data_keys de ADR-021', () => {
  assert.deepEqual(MANEUVER_DATA_KEYS.tacto, ['prenez', 'tamano_prenez']);
  assert.deepEqual(MANEUVER_DATA_KEYS.tacto_vaquillona, ['tacto_vaquillona']);
  assert.deepEqual(MANEUVER_DATA_KEYS.sangrado, ['brucelosis']);
  assert.deepEqual(MANEUVER_DATA_KEYS.vacunacion, ['vacunacion']);
  assert.deepEqual(MANEUVER_DATA_KEYS.inseminacion, ['inseminacion']);
  assert.deepEqual(MANEUVER_DATA_KEYS.condicion_corporal, ['condicion_corporal']);
  assert.deepEqual(MANEUVER_DATA_KEYS.dientes, ['dientes']);
  assert.deepEqual(MANEUVER_DATA_KEYS.pesaje, ['peso']);
  assert.deepEqual(MANEUVER_DATA_KEYS.pesaje_ternero, ['peso']);
  assert.deepEqual(MANEUVER_DATA_KEYS.raspado, ['raspado_toros']);
  // Maniobras nuevas (sesión 26, R6.13/R6.15).
  assert.deepEqual(MANEUVER_DATA_KEYS.antiparasitario, ['antiparasitario_interno', 'antiparasitario_externo']);
  assert.deepEqual(MANEUVER_DATA_KEYS.antibiotico, ['antibiotico']);
  // Circunferencia escrotal (sesión 27, R14.1): single-key nuevo.
  assert.deepEqual(MANEUVER_DATA_KEYS.circunferencia_escrotal, ['circunferencia_escrotal']);
  assert.equal(ALL_MANEUVERS.length, 13);
});

test('R14.1: la CE single-key APLICA si circunferencia_escrotal está enabled; NO si está off/ausente', () => {
  const on = resolveManeuverGating('circunferencia_escrotal', config(['circunferencia_escrotal']));
  assert.equal(on.applies, true);
  assert.equal(on.dataKeys.length, 1);
  assert.equal(on.dataKeys[0].dataKey, 'circunferencia_escrotal');
  // Rodeo sin el data_key (o con cualquier otro enabled) → la maniobra NO aplica (capa 1, R14.1).
  const off = resolveManeuverGating('circunferencia_escrotal', config(['vacunacion']));
  assert.equal(off.applies, false);
});

test('R14.1: filterApplicableManeuvers deja la CE solo si el rodeo la habilita (capa 1)', () => {
  const seq: ManeuverKind[] = ['vacunacion', 'circunferencia_escrotal'];
  const withCe = filterApplicableManeuvers(seq, config(['vacunacion', 'circunferencia_escrotal']));
  assert.deepEqual(withCe.applicable, ['vacunacion', 'circunferencia_escrotal']);
  const withoutCe = filterApplicableManeuvers(seq, config(['vacunacion']));
  assert.deepEqual(withoutCe.applicable, ['vacunacion']);
  assert.deepEqual(withoutCe.omitted, ['circunferencia_escrotal']);
});

test('pesaje y pesaje_ternero comparten el mismo data_key peso (R5.4)', () => {
  assert.deepEqual(MANEUVER_DATA_KEYS.pesaje, MANEUVER_DATA_KEYS.pesaje_ternero);
});

// ─── Resolución por maniobra (R5.3/R5.5): aplica si TODOS sus data_keys están enabled ───

test('R5.5: maniobra single-key APLICA si su data_key está enabled', () => {
  const r = resolveManeuverGating('condicion_corporal', config(['condicion_corporal']));
  assert.equal(r.applies, true);
  assert.equal(r.dataKeys.length, 1);
  assert.equal(r.dataKeys[0].enabled, true);
});

test('R5.5: maniobra single-key NO aplica si su data_key NO está en el rodeo (ausente)', () => {
  const r = resolveManeuverGating('condicion_corporal', config(['peso']));
  assert.equal(r.applies, false);
  assert.equal(r.dataKeys[0].enabled, false);
});

test('R5.5: maniobra single-key NO aplica si su data_key está presente pero disabled', () => {
  const cfg: RodeoDataKeyMap = { condicion_corporal: { enabled: false, required: false } };
  const r = resolveManeuverGating('condicion_corporal', cfg);
  assert.equal(r.applies, false);
});

test('R5.5: multi-key tacto APLICA solo si AMBOS prenez Y tamano_prenez están enabled', () => {
  const ok = resolveManeuverGating('tacto', config(['prenez', 'tamano_prenez']));
  assert.equal(ok.applies, true);
  assert.equal(ok.dataKeys.length, 2);
});

test('R5.5: multi-key tacto NO aplica si falta tamano_prenez (uno solo de los dos)', () => {
  const r = resolveManeuverGating('tacto', config(['prenez']));
  assert.equal(r.applies, false);
  // el detalle por data_key refleja cuál falta.
  const prenez = r.dataKeys.find((d) => d.dataKey === 'prenez');
  const tamano = r.dataKeys.find((d) => d.dataKey === 'tamano_prenez');
  assert.equal(prenez?.enabled, true);
  assert.equal(tamano?.enabled, false);
});

test('R5.5: multi-key tacto NO aplica con rodeo vacío', () => {
  const r = resolveManeuverGating('tacto', {});
  assert.equal(r.applies, false);
  assert.ok(r.dataKeys.every((d) => !d.enabled));
});

// ─── Required vs opcional (R5.6/R5.7) ─────────────────────────────────────────────────

test('R5.6: cría MVP — data_key enabled SIN required → maniobra aplica, requiredDataKeys vacío', () => {
  const r = resolveManeuverGating('vacunacion', config(['vacunacion']));
  assert.equal(r.applies, true);
  assert.deepEqual(r.requiredDataKeys, []);
  assert.equal(r.dataKeys[0].required, false);
});

test('R5.6: data_key enabled + required=true → aparece en requiredDataKeys (R5.7 bloquea confirmación)', () => {
  const r = resolveManeuverGating('vacunacion', config(['vacunacion'], ['vacunacion']));
  assert.equal(r.applies, true);
  assert.deepEqual(r.requiredDataKeys, ['vacunacion']);
});

test('R5.6: required de un data_key DISABLED no se reporta (no aplica la maniobra)', () => {
  // tacto con prenez required pero tamano_prenez disabled → no aplica → requiredDataKeys vacío.
  const r = resolveManeuverGating('tacto', config(['prenez'], ['prenez']));
  assert.equal(r.applies, false);
  assert.deepEqual(r.requiredDataKeys, []);
});

test('R5.6: multi-key con uno required y otro no → solo el required en requiredDataKeys', () => {
  const r = resolveManeuverGating('tacto', config(['prenez', 'tamano_prenez'], ['prenez']));
  assert.equal(r.applies, true);
  assert.deepEqual(r.requiredDataKeys, ['prenez']);
});

// ─── Resolución de una sesión completa (preserva orden) ───────────────────────────────

test('resolveSessionGating: preserva el orden y resuelve cada maniobra contra el rodeo real', () => {
  const maneuvers: ManeuverKind[] = ['vacunacion', 'tacto', 'dientes'];
  const results = resolveSessionGating(maneuvers, config(['vacunacion', 'prenez', 'tamano_prenez']));
  assert.deepEqual(results.map((r) => r.maneuver), ['vacunacion', 'tacto', 'dientes']);
  assert.equal(results[0].applies, true); // vacunacion enabled
  assert.equal(results[1].applies, true); // tacto: ambos enabled
  assert.equal(results[2].applies, false); // dientes: ausente
});

// ─── Filtrado para wizard (R1.4/R1.5) y preset (R2.3) ─────────────────────────────────

test('R1.4/R1.5: filterApplicableManeuvers separa habilitadas de omitidas, preservando orden', () => {
  const maneuvers: ManeuverKind[] = ['tacto', 'sangrado', 'dientes', 'pesaje'];
  const { applicable, omitted } = filterApplicableManeuvers(
    maneuvers,
    config(['prenez', 'tamano_prenez', 'peso']), // tacto + peso enabled; brucelosis y dientes off
  );
  assert.deepEqual(applicable, ['tacto', 'pesaje']);
  assert.deepEqual(omitted, ['sangrado', 'dientes']);
});

test('R2.3: preset con maniobra OFF en el rodeo → cae en omitted (la UI la filtra y avisa)', () => {
  const preset: ManeuverKind[] = ['vacunacion', 'raspado'];
  const { applicable, omitted } = filterApplicableManeuvers(preset, config(['vacunacion']));
  assert.deepEqual(applicable, ['vacunacion']);
  assert.deepEqual(omitted, ['raspado']); // raspado_toros no enabled → omitida
});

test('rodeo con todas las data_keys enabled → todas las maniobras aplican, nada omitido', () => {
  const allKeys = Array.from(new Set(ALL_MANEUVERS.flatMap((m) => MANEUVER_DATA_KEYS[m])));
  const { applicable, omitted } = filterApplicableManeuvers(ALL_MANEUVERS, config(allKeys));
  assert.deepEqual(applicable, [...ALL_MANEUVERS]);
  assert.deepEqual(omitted, []);
});

test('rodeo vacío → ninguna maniobra aplica, todas omitidas', () => {
  const { applicable, omitted } = filterApplicableManeuvers(ALL_MANEUVERS, {});
  assert.deepEqual(applicable, []);
  assert.deepEqual(omitted, [...ALL_MANEUVERS]);
});

// ─── Antiparasitario: gating OR de interno/externo (R6.13/R6.14, D10) ──────────────────

test('R6.14: antiparasitario APLICA si SOLO antiparasitario_interno está enabled (OR, basta uno)', () => {
  const r = resolveManeuverGating('antiparasitario', config(['antiparasitario_interno']));
  assert.equal(r.applies, true);
});

test('R6.14: antiparasitario APLICA si SOLO antiparasitario_externo está enabled (OR, basta uno)', () => {
  const r = resolveManeuverGating('antiparasitario', config(['antiparasitario_externo']));
  assert.equal(r.applies, true);
});

test('R6.14: antiparasitario APLICA si AMBOS están enabled (OR)', () => {
  const r = resolveManeuverGating(
    'antiparasitario',
    config(['antiparasitario_interno', 'antiparasitario_externo']),
  );
  assert.equal(r.applies, true);
});

test('R6.14: antiparasitario NO aplica si NINGUNO está enabled (OR fail)', () => {
  const r = resolveManeuverGating('antiparasitario', config(['antibiotico']));
  assert.equal(r.applies, false);
});

test('R6.14: antiparasitario NO es un AND plano (con uno enabled ya aplica, a diferencia del tacto multi-key)', () => {
  // Si fuera un AND sobre [interno, externo], esto NO aplicaría (falta externo). La OR (match:'any') sí.
  const or = resolveManeuverGating('antiparasitario', config(['antiparasitario_interno']));
  const and = resolveManeuverGating('tacto', config(['prenez'])); // falta tamano_prenez → AND no aplica
  assert.equal(or.applies, true);
  assert.equal(and.applies, false);
});

test('R6.15: antibiotico es single-key (antibiotico) — AND normal', () => {
  assert.equal(resolveManeuverGating('antibiotico', config(['antibiotico'])).applies, true);
  assert.equal(resolveManeuverGating('antibiotico', config([])).applies, false);
});
