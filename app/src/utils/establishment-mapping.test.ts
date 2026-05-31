// Tests de mapMembershipRows (mapeo de la capa de datos de establecimientos, spec 01 Fase 4).
//
// Función PURA (vive en utils/establishment porque services/establishments importa
// supabase-js → expo/RN, no cargable bajo node). La suite RLS valida el SQL/policies
// contra el remoto; esto cubre el GAP del cliente (el mapeo) que el fix loop cerró:
// filtrar por user_id + dedup defensivo evita el bug del owner que veía su campo
// duplicado (policy 0008 user_roles_select = user_id = auth.uid() OR is_owner_of(...)).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapMembershipRows, type RoleRow } from './establishment.ts';

const est = (
  id: string,
  name: string,
  deleted_at: string | null = null,
): NonNullable<RoleRow['establishment']> => ({
  id,
  name,
  province: 'Buenos Aires',
  city: null,
  deleted_at,
});

test('filas del propio usuario (1 por campo) → 1 establishment por campo con su rol', () => {
  const rows: RoleRow[] = [
    { role: 'owner', establishment: est('e1', 'La Esperanza') },
    { role: 'veterinarian', establishment: est('e2', 'San Miguel') },
  ];
  const out = mapMembershipRows(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((e) => [e.id, e.role]),
    [
      ['e1', 'owner'],
      ['e2', 'veterinarian'],
    ],
  );
});

test('rol correcto: un campo donde el usuario es owner queda como owner', () => {
  const rows: RoleRow[] = [{ role: 'owner', establishment: est('e1', 'La Esperanza') }];
  const out = mapMembershipRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'owner');
  assert.equal(out[0].name, 'La Esperanza');
});

test('dedup defensivo: ≥2 filas del mismo establishment.id → NO duplica el campo', () => {
  // Escenario del bug: un owner cuya policy le deja ver los roles de sus miembros.
  // Aunque loadMemberships ya filtra por user_id, si por lo que sea llegaran filas
  // repetidas del mismo campo, el resultado debe quedarse con UNA (la primera = la del
  // propio usuario), sin inflar available.length ni duplicar en "Mis campos".
  const rows: RoleRow[] = [
    { role: 'owner', establishment: est('e1', 'La Esperanza') },
    { role: 'veterinarian', establishment: est('e1', 'La Esperanza') },
    { role: 'field_operator', establishment: est('e1', 'La Esperanza') },
  ];
  const out = mapMembershipRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'e1');
  // Se queda con la PRIMERA fila (el rol propio: owner), no con la de otro miembro.
  assert.equal(out[0].role, 'owner');
});

test('dedup defensivo por establishment.id: filas mezcladas con repetidos → 1 por campo', () => {
  const rows: RoleRow[] = [
    { role: 'owner', establishment: est('e1', 'La Esperanza') },
    { role: 'veterinarian', establishment: est('e2', 'San Miguel') },
    { role: 'field_operator', establishment: est('e1', 'La Esperanza') },
  ];
  const out = mapMembershipRows(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.id).sort(), ['e1', 'e2']);
});

test('filtra soft-deleted (deleted_at != null) y los excluye del resultado', () => {
  const rows: RoleRow[] = [
    { role: 'owner', establishment: est('e1', 'La Esperanza') },
    { role: 'owner', establishment: est('e2', 'Borrado', '2026-01-01T00:00:00Z') },
  ];
  const out = mapMembershipRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'e1');
});

test('filtra filas con establishment null (join sin match)', () => {
  const rows: RoleRow[] = [
    { role: 'owner', establishment: null },
    { role: 'owner', establishment: est('e1', 'La Esperanza') },
  ];
  const out = mapMembershipRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'e1');
});

test('lista vacía → resultado vacío', () => {
  assert.deepEqual(mapMembershipRows([]), []);
});

test('preserva campos del establishment (province, city)', () => {
  const rows: RoleRow[] = [
    {
      role: 'owner',
      establishment: {
        id: 'e1',
        name: 'La Esperanza',
        province: 'Córdoba',
        city: 'Río Cuarto',
        deleted_at: null,
      },
    },
  ];
  const out = mapMembershipRows(rows);
  assert.equal(out[0].province, 'Córdoba');
  assert.equal(out[0].city, 'Río Cuarto');
});
