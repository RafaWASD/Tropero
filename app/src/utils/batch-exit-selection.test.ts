// Tests de la SELECCIÓN del subconjunto de la baja en tanda (delta lotes-venta, RLV.3/RLV.3.1/RLV.3.2).
// node:test + type-stripping nativo (sin Jest). Lógica pura en utils/batch-exit-selection.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  emptySelection,
  toggleSelection,
  selectAll,
  deselectAll,
  toggleSelectAll,
  selectionCount,
  hasSelection,
  isAllSelected,
  resolveSelectedIds,
} from './batch-exit-selection.ts';

const IDS = ['a', 'b', 'c'];

test('RLV.3.1: la selección arranca vacía → no se puede avanzar', () => {
  const s = emptySelection();
  assert.equal(selectionCount(s), 0);
  assert.equal(hasSelection(s), false);
});

test('RLV.3: toggle agrega y quita un animal (inmutable — devuelve un nuevo Set)', () => {
  const s0 = emptySelection();
  const s1 = toggleSelection(s0, 'a');
  assert.equal(hasSelection(s1), true);
  assert.equal(selectionCount(s1), 1);
  assert.ok(s1.has('a'));
  // No mutó el original.
  assert.equal(selectionCount(s0), 0);
  // Toggle de nuevo lo saca.
  const s2 = toggleSelection(s1, 'a');
  assert.equal(hasSelection(s2), false);
});

test('RLV.3.2: el contador refleja la cantidad seleccionada', () => {
  let s = emptySelection();
  s = toggleSelection(s, 'a');
  s = toggleSelection(s, 'b');
  assert.equal(selectionCount(s), 2);
});

test('RLV.3: seleccionar todos toma EXACTAMENTE los ids dados', () => {
  const s = selectAll(IDS);
  assert.equal(selectionCount(s), 3);
  assert.equal(isAllSelected(s, IDS), true);
});

test('deselectAll vuelve a vacío', () => {
  assert.equal(selectionCount(deselectAll()), 0);
});

test('toggleSelectAll: nada/parcial → todos; todos → nada', () => {
  const vacio = emptySelection();
  const todos = toggleSelectAll(vacio, IDS);
  assert.equal(isAllSelected(todos, IDS), true);
  // Con todos marcados, toggle deselecciona.
  const nada = toggleSelectAll(todos, IDS);
  assert.equal(selectionCount(nada), 0);
  // Parcial → completa a todos.
  const parcial = toggleSelection(emptySelection(), 'a');
  assert.equal(isAllSelected(toggleSelectAll(parcial, IDS), IDS), true);
});

test('isAllSelected: lista vacía → false (no hay "todos" que marcar)', () => {
  assert.equal(isAllSelected(selectAll(IDS), []), false);
  assert.equal(isAllSelected(emptySelection(), []), false);
});

test('isAllSelected: false si falta alguno', () => {
  const parcial = toggleSelection(toggleSelection(emptySelection(), 'a'), 'b');
  assert.equal(isAllSelected(parcial, IDS), false);
});

test('RLV.21.1: resolveSelectedIds descarta ids que ya no son miembros y respeta el orden de members', () => {
  // Seleccioné a, c y un id fantasma "x" que ya no está en el lote.
  let s = selectAll(['c', 'a', 'x']);
  // members llegan en orden [a, b, c]; b no está seleccionado; x no es miembro → se descarta.
  const ids = resolveSelectedIds(s, IDS);
  assert.deepEqual(ids, ['a', 'c']); // orden de members, sin 'x', sin 'b'
});
