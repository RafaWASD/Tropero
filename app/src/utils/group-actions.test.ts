// Tests del gating de acciones masivas de la vista de grupo (spec 10, T-UI.1 / R1.4/R1.5/R1.6/R7.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveGroupActions,
  buildRodeoGating,
  isDataKeyEnabled,
  VACCINATION_DATA_KEY,
  WEANING_DATA_KEY,
  type RodeoGating,
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
