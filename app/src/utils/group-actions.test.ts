// Tests del gating de acciones masivas de la vista de grupo (spec 10, T-UI.1 / R1.4/R1.5/R1.6/R7.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveGroupActions,
  applyCandidateGating,
  buildRodeoGating,
  isDataKeyEnabled,
  VACCINATION_DATA_KEY,
  WEANING_DATA_KEY,
  type RodeoGating,
  type GroupActionsAvailability,
} from './group-actions.ts';

// ─── resolveGroupActions: castrar siempre; gateadas por rodeo(s) ───────────────────────────

test('resolveGroupActions: rodeo con ambas habilitadas → las 3 acciones', () => {
  const r: RodeoGating[] = [{ vaccinationEnabled: true, weaningEnabled: true }];
  assert.deepEqual(resolveGroupActions(r), { castrate: true, vaccinate: true, wean: true });
});

test('resolveGroupActions: castrar SIEMPRE true aunque no haya gateadas (R1.5)', () => {
  const r: RodeoGating[] = [{ vaccinationEnabled: false, weaningEnabled: false }];
  assert.deepEqual(resolveGroupActions(r), { castrate: true, vaccinate: false, wean: false });
});

test('resolveGroupActions: solo vacunación habilitada → vacunar sí, destetar no (R1.6)', () => {
  const r: RodeoGating[] = [{ vaccinationEnabled: true, weaningEnabled: false }];
  const out = resolveGroupActions(r);
  assert.equal(out.vaccinate, true);
  assert.equal(out.wean, false);
  assert.equal(out.castrate, true);
});

test('resolveGroupActions: lote cross-rodeo — vacunar si ALGÚN rodeo la tiene (R7.1)', () => {
  const r: RodeoGating[] = [
    { vaccinationEnabled: false, weaningEnabled: false },
    { vaccinationEnabled: true, weaningEnabled: false }, // este la tiene
  ];
  assert.equal(resolveGroupActions(r).vaccinate, true);
  assert.equal(resolveGroupActions(r).wean, false);
});

test('resolveGroupActions: lote cross-rodeo — destetar si ALGÚN rodeo lo tiene (R7.1)', () => {
  const r: RodeoGating[] = [
    { vaccinationEnabled: false, weaningEnabled: true },
    { vaccinationEnabled: false, weaningEnabled: false },
  ];
  assert.equal(resolveGroupActions(r).wean, true);
});

test('resolveGroupActions: 0 rodeos (lote vacío / sincronizando) → solo castrar (fail-closed)', () => {
  assert.deepEqual(resolveGroupActions([]), { castrate: true, vaccinate: false, wean: false });
});

// ─── applyCandidateGating: gating por PRESENCIA de candidatos (fix Raf 2026-06-12) ──────────

/** Config base con todo habilitado (lo que devuelve resolveGroupActions con ambos data_keys on). */
const allEnabledConfig: GroupActionsAvailability = { castrate: true, vaccinate: true, wean: true };

test('applyCandidateGating: con candidatos de ambas → las 3 acciones (config + candidatos)', () => {
  const out = applyCandidateGating(allEnabledConfig, { castrate: 2, wean: 3 });
  assert.deepEqual(out, { castrate: true, vaccinate: true, wean: true });
});

test('applyCandidateGating: SIN candidatos a destete → Destetar OFF aunque config lo habilite', () => {
  const out = applyCandidateGating(allEnabledConfig, { castrate: 1, wean: 0 });
  assert.equal(out.wean, false, 'destete sin candidatos no se ofrece');
  assert.equal(out.vaccinate, true, 'vacunación no se gatea por candidatos');
  assert.equal(out.castrate, true, 'castración con candidatos sí');
});

test('applyCandidateGating: SIN candidatos a castración → Castrar OFF (no depende de config, R1.5)', () => {
  const out = applyCandidateGating(allEnabledConfig, { castrate: 0, wean: 2 });
  assert.equal(out.castrate, false, 'castración sin machos enteros candidatos no se ofrece');
  assert.equal(out.wean, true);
});

test('applyCandidateGating: NO rompe el gating de config — destete OFF en config sigue OFF con candidatos', () => {
  // Config con destete deshabilitado (rodeo sin `destete`): aunque hubiera terneros, NO se ofrece.
  const config: GroupActionsAvailability = { castrate: true, vaccinate: true, wean: false };
  const out = applyCandidateGating(config, { castrate: 1, wean: 5 });
  assert.equal(out.wean, false, 'config destete OFF manda aunque haya candidatos');
});

test('applyCandidateGating: vacunación respeta SOLO la config (off en config → off, on → on)', () => {
  const off: GroupActionsAvailability = { castrate: true, vaccinate: false, wean: true };
  assert.equal(applyCandidateGating(off, { castrate: 1, wean: 1 }).vaccinate, false);
  const on: GroupActionsAvailability = { castrate: true, vaccinate: true, wean: true };
  assert.equal(applyCandidateGating(on, { castrate: 1, wean: 1 }).vaccinate, true);
});

test('applyCandidateGating: grupo vacío (0 candidatos) → todas las gateadas por candidatos OFF', () => {
  const out = applyCandidateGating(allEnabledConfig, { castrate: 0, wean: 0 });
  assert.deepEqual(out, { castrate: false, vaccinate: true, wean: false });
});

// ─── buildRodeoGating: data_key → field_id → enabled ───────────────────────────────────────

test('buildRodeoGating: resuelve vacunacion/destete contra catálogo + config', () => {
  const catalog = new Map<string, string>([
    [VACCINATION_DATA_KEY, 'fd-vac'],
    [WEANING_DATA_KEY, 'fd-des'],
  ]);
  const config = new Map<string, boolean>([
    ['fd-vac', true],
    ['fd-des', false],
  ]);
  assert.deepEqual(buildRodeoGating(catalog, config), {
    vaccinationEnabled: true,
    weaningEnabled: false,
  });
});

test('buildRodeoGating: data_key sin field en el catálogo → deshabilitado (fail-closed)', () => {
  const catalog = new Map<string, string>(); // catálogo vacío
  const config = new Map<string, boolean>([['fd-vac', true]]);
  assert.deepEqual(buildRodeoGating(catalog, config), {
    vaccinationEnabled: false,
    weaningEnabled: false,
  });
});

test('buildRodeoGating: field sin fila en la config → deshabilitado (R1.6)', () => {
  const catalog = new Map<string, string>([[VACCINATION_DATA_KEY, 'fd-vac']]);
  const config = new Map<string, boolean>(); // sin fila
  assert.equal(buildRodeoGating(catalog, config).vaccinationEnabled, false);
});

// ─── isDataKeyEnabled: la base ─────────────────────────────────────────────────────────────

test('isDataKeyEnabled: true solo si field existe Y enabled===true', () => {
  const catalog = new Map<string, string>([['x', 'fd-x']]);
  assert.equal(isDataKeyEnabled('x', catalog, new Map([['fd-x', true]])), true);
  assert.equal(isDataKeyEnabled('x', catalog, new Map([['fd-x', false]])), false);
  assert.equal(isDataKeyEnabled('x', catalog, new Map()), false);
  assert.equal(isDataKeyEnabled('ausente', catalog, new Map([['fd-x', true]])), false);
});
