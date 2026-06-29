// Unit (node:test, puro) de los predicados de elegibilidad de ASIGNACIÓN de identificadores desde la ficha
// (delta spec 02 caravana-ficha, RCF.1.1–RCF.1.5/RCF.1.7). Sin RN/red/SDK.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canAssignTag, canAssignIdv } from './identifier-assign';

// ─── canAssignTag (RCF.1.1/RCF.1.2/RCF.1.5) ────────────────────────────────────────────

test('RCF.1.1: animal ACTIVO con tagElectronic null → SÍ se ofrece asignar (true)', () => {
  assert.equal(canAssignTag({ status: 'active', tagElectronic: null }), true);
});

test('RCF.1.2: tagElectronic ya seteada (cualquier valor) → NO se ofrece (false, read-only R4.13)', () => {
  assert.equal(canAssignTag({ status: 'active', tagElectronic: '982000123456789' }), false);
  // Aun una cadena vacía cuenta como "seteada" (no es null): no se ofrece reasignar.
  assert.equal(canAssignTag({ status: 'active', tagElectronic: '' }), false);
});

test('RCF.1.5: animal NO activo (sold/dead/transferred) con tag null → NO se ofrece (false)', () => {
  assert.equal(canAssignTag({ status: 'sold', tagElectronic: null }), false);
  assert.equal(canAssignTag({ status: 'dead', tagElectronic: null }), false);
  assert.equal(canAssignTag({ status: 'transferred', tagElectronic: null }), false);
});

// ─── canAssignIdv (RCF.1.3/RCF.1.4/RCF.1.5) ────────────────────────────────────────────

test('RCF.1.3: animal ACTIVO con idv null → SÍ se ofrece asignar (true)', () => {
  assert.equal(canAssignIdv({ status: 'active', idv: null }), true);
});

test('RCF.1.4: idv ya seteado → NO se ofrece (false, read-only R4.13)', () => {
  assert.equal(canAssignIdv({ status: 'active', idv: '01234567' }), false);
  assert.equal(canAssignIdv({ status: 'active', idv: '' }), false);
});

test('RCF.1.5: animal NO activo con idv null → NO se ofrece (false)', () => {
  assert.equal(canAssignIdv({ status: 'sold', idv: null }), false);
  assert.equal(canAssignIdv({ status: 'dead', idv: null }), false);
  assert.equal(canAssignIdv({ status: 'transferred', idv: null }), false);
});

// ─── Independencia de los dos predicados (un id seteado no bloquea el otro) ─────────────

test('RCF.1: los predicados son independientes — tag seteada NO impide ofrecer idv vacío y viceversa', () => {
  // Tag ya seteada + idv vacío → tag read-only, idv asignable.
  assert.equal(canAssignTag({ status: 'active', tagElectronic: '982000123456789' }), false);
  assert.equal(canAssignIdv({ status: 'active', idv: null }), true);
  // Idv ya seteado + tag vacío → idv read-only, tag asignable.
  assert.equal(canAssignIdv({ status: 'active', idv: '0001' }), false);
  assert.equal(canAssignTag({ status: 'active', tagElectronic: null }), true);
});
