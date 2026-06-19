// app/src/utils/lote-picker.test.ts — tests de lotePickerOptions (spec 03 R9.2/R9.3).
//
// Verifica el orden canónico ("Sin lote" PRIMERO, luego los grupos) y los bordes de selección:
// grupo seleccionado, "Sin lote" seleccionado (null), lista vacía → solo "Sin lote", e id inexistente
// (no-null, no en la lista) → NINGUNA opción seleccionada (ni "Sin lote").

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lotePickerOptions, SIN_LOTE_LABEL } from './lote-picker.ts';
import type { ManagementGroup } from '@/services/management-groups';

const GROUPS: ManagementGroup[] = [
  { id: 'g1', name: 'Engorde primavera' }, // descendentes g/p a propósito (veto de recorte en la UI)
  { id: 'g2', name: 'Recría' },
  { id: 'g3', name: 'Paridas' },
];

test('"Sin lote" va PRIMERO (id null), luego los grupos en su orden', () => {
  const opts = lotePickerOptions(GROUPS, null);
  assert.equal(opts.length, 4);
  assert.equal(opts[0].id, null);
  assert.equal(opts[0].name, SIN_LOTE_LABEL);
  assert.deepEqual(
    opts.slice(1).map((o) => o.id),
    ['g1', 'g2', 'g3'],
  );
  assert.deepEqual(
    opts.slice(1).map((o) => o.name),
    ['Engorde primavera', 'Recría', 'Paridas'],
  );
});

test('selectedId null → "Sin lote" seleccionada, ningún grupo seleccionado (R9.3)', () => {
  const opts = lotePickerOptions(GROUPS, null);
  assert.equal(opts[0].selected, true); // Sin lote
  assert.deepEqual(
    opts.slice(1).map((o) => o.selected),
    [false, false, false],
  );
});

test('selectedId = un grupo → ese grupo seleccionado, "Sin lote" NO seleccionada', () => {
  const opts = lotePickerOptions(GROUPS, 'g2');
  assert.equal(opts[0].selected, false); // Sin lote NO
  const selected = opts.filter((o) => o.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'g2');
  assert.equal(selected[0].name, 'Recría');
});

test('lista vacía → solo la opción "Sin lote"', () => {
  const opts = lotePickerOptions([], null);
  assert.equal(opts.length, 1);
  assert.equal(opts[0].id, null);
  assert.equal(opts[0].name, SIN_LOTE_LABEL);
  assert.equal(opts[0].selected, true);
});

test('lista vacía con un selectedId fantasma → "Sin lote" NO seleccionada (el lote existe pero no está en la lista)', () => {
  const opts = lotePickerOptions([], 'g-borrado');
  assert.equal(opts.length, 1);
  assert.equal(opts[0].id, null);
  assert.equal(opts[0].selected, false);
});

test('selectedId NO-null que no matchea ningún grupo → NINGUNA opción seleccionada (ni "Sin lote")', () => {
  const opts = lotePickerOptions(GROUPS, 'g-inexistente');
  assert.deepEqual(
    opts.map((o) => o.selected),
    [false, false, false, false],
  );
});
