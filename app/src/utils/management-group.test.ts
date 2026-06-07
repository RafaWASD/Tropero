// Tests de la lógica PURA de lotes (management_groups, ADR-020 / spec 02 C4): validación del nombre
// + gating de UI por rol. node:test (mismo runner que el resto de la suite unit, sin Jest/RN).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateGroupName,
  canManageGroups,
  canAssignGroup,
  MANAGEMENT_GROUP_NAME_MAX,
} from './management-group';

test('validateGroupName: nombre normal → ok + trimeado', () => {
  const r = validateGroupName('  Otoño 2026  ');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 'Otoño 2026');
});

test('validateGroupName: vacío → error (espeja el CHECK length(trim(name)) > 0)', () => {
  const r = validateGroupName('');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /nombre/i);
});

test('validateGroupName: solo espacios → error (trim → vacío)', () => {
  const r = validateGroupName('     ');
  assert.equal(r.ok, false);
});

test('validateGroupName: en el límite exacto → ok', () => {
  const name = 'a'.repeat(MANAGEMENT_GROUP_NAME_MAX);
  const r = validateGroupName(name);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.length, MANAGEMENT_GROUP_NAME_MAX);
});

test('validateGroupName: pasado el límite → error', () => {
  const name = 'a'.repeat(MANAGEMENT_GROUP_NAME_MAX + 1);
  const r = validateGroupName(name);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /caracteres/i);
});

test('validateGroupName: largo se mide DESPUÉS del trim (espacios no cuentan)', () => {
  const name = '  ' + 'a'.repeat(MANAGEMENT_GROUP_NAME_MAX) + '  ';
  const r = validateGroupName(name);
  assert.equal(r.ok, true);
});

test('canManageGroups: solo owner (crear/renombrar/borrar = is_owner_of)', () => {
  assert.equal(canManageGroups('owner'), true);
  assert.equal(canManageGroups('field_operator'), false);
  assert.equal(canManageGroups('veterinarian'), false);
  assert.equal(canManageGroups(null), false);
});

test('canAssignGroup: cualquier rol operativo activo (UPDATE animal_profiles, has_role_in)', () => {
  assert.equal(canAssignGroup('owner'), true);
  assert.equal(canAssignGroup('field_operator'), true);
  assert.equal(canAssignGroup('veterinarian'), true);
  assert.equal(canAssignGroup(null), false);
});
