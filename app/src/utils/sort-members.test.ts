// Tests del orden canónico de la lista de miembros (spec 01, R4.8 — pantalla /miembros).
// node:test + type-stripping nativo (Node 24), sin Jest (mismo patrón que establishment.test.ts).
//
// PURO: no toca DB ni RN → corre siempre, sin keys.
//
// Cubre: los 3 roles en orden; alfabético dentro de cada rol; acentos (José/Jose/Juan); Ñ;
// "sin nombre" al final de SU rol; el usuario logueado NO queda primero si no le toca; lista
// vacía; un solo miembro; no-mutación de la entrada; rol desconocido al final (fail-soft).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapMemberRows, sortMembers, type MemberRow, type SortableMember } from './sort-members.ts';
import type { UserRole } from '../types/index.ts';

type M = SortableMember & { userId: string; isCurrentUser?: boolean };

function m(userId: string, name: string | null, role: UserRole, isCurrentUser = false): M {
  return { userId, name, role, isCurrentUser };
}

/** Proyecta los nombres (o el userId si no tiene nombre) para asertar el orden de un vistazo. */
function names(list: M[]): string[] {
  return list.map((x) => (x.name?.trim() ? x.name.trim() : `«${x.userId}»`));
}

// ─── R4.8 (a): orden por ROL ──────────────────────────────────────────────────

test('R4.8: ordena por rol — dueño → operario → veterinario', () => {
  const out = sortMembers([
    m('v', 'Zulema', 'veterinarian'),
    m('o', 'Zulema', 'owner'),
    m('f', 'Zulema', 'field_operator'),
  ]);
  assert.deepEqual(
    out.map((x) => x.role),
    ['owner', 'field_operator', 'veterinarian'],
  );
});

test('R4.8: el rol manda sobre el nombre (un veterinario "Ana" va DESPUÉS de un dueño "Zulema")', () => {
  const out = sortMembers([m('v', 'Ana', 'veterinarian'), m('o', 'Zulema', 'owner')]);
  assert.deepEqual(names(out), ['Zulema', 'Ana']);
});

// ─── R4.8 (b): alfabético DENTRO de cada rol ──────────────────────────────────

test('R4.8: alfabético dentro de cada rol, con los grupos de rol intactos', () => {
  const out = sortMembers([
    m('f2', 'Rubén', 'field_operator'),
    m('v2', 'Bruno', 'veterinarian'),
    m('o2', 'Marta', 'owner'),
    m('f1', 'Carlos', 'field_operator'),
    m('v1', 'Alicia', 'veterinarian'),
    m('o1', 'Ana', 'owner'),
  ]);
  assert.deepEqual(names(out), ['Ana', 'Marta', 'Carlos', 'Rubén', 'Alicia', 'Bruno']);
});

test('R4.8: alfabético case-insensitive (no se agrupa por mayúscula/minúscula)', () => {
  const out = sortMembers([
    m('1', 'zulema', 'field_operator'),
    m('2', 'Ana', 'field_operator'),
    m('3', 'bruno', 'field_operator'),
  ]);
  assert.deepEqual(names(out), ['Ana', 'bruno', 'zulema']);
});

// ─── R4.8 (c): collation es-AR — acentos y Ñ ──────────────────────────────────

test('R4.8: acentos — José y Jose son equivalentes y ambos van ANTES que Juan (no al final)', () => {
  // Con collation ASCII, 'José' (é = U+00E9, > 'z') caería al final; con es-AR va junto a 'Jose'.
  const out = sortMembers([
    m('3', 'Juan', 'field_operator'),
    m('2', 'José', 'field_operator'),
    m('1', 'Jose', 'field_operator'),
  ]);
  const ordered = names(out);
  assert.equal(ordered[2], 'Juan', 'Juan va último');
  assert.deepEqual(ordered.slice(0, 2).sort(), ['Jose', 'José'], 'Jose/José quedan adelante');
});

test('R4.8: acentos equivalentes (Álvaro ≈ Alvaro) mantienen el orden de entrada (estable)', () => {
  const out = sortMembers([m('1', 'Álvaro', 'owner'), m('2', 'Alvaro', 'owner')]);
  assert.deepEqual(
    out.map((x) => x.userId),
    ['1', '2'],
  );
});

test('R4.8: Ñ ordena como en castellano — después de toda N, antes de O', () => {
  const out = sortMembers([
    m('4', 'Oscar', 'veterinarian'),
    m('2', 'Ñandú', 'veterinarian'),
    m('3', 'Nuria', 'veterinarian'),
    m('1', 'Nadia', 'veterinarian'),
  ]);
  assert.deepEqual(names(out), ['Nadia', 'Nuria', 'Ñandú', 'Oscar']);
});

// ─── R4.8 (d): sin nombre al final de SU rol ──────────────────────────────────

test('R4.8: un miembro sin nombre va al final de SU rol, no al final de la lista', () => {
  const out = sortMembers([
    m('v1', 'Alicia', 'veterinarian'),
    m('o-sin', '', 'owner'), // la fila muestra "Sin nombre"
    m('o1', 'Marta', 'owner'),
  ]);
  assert.deepEqual(names(out), ['Marta', '«o-sin»', 'Alicia']);
});

test('R4.8: name null y name solo-espacios cuentan como "sin nombre"', () => {
  const out = sortMembers([
    m('nulo', null, 'field_operator'),
    m('espacios', '   ', 'field_operator'),
    m('con', 'Zulema', 'field_operator'),
  ]);
  // Zulema primero aunque su inicial sea la última del abecedario: los sin-nombre van al fondo.
  assert.equal(names(out)[0], 'Zulema');
  assert.deepEqual(
    out.slice(1).map((x) => x.userId),
    ['nulo', 'espacios'],
    'entre sin-nombre se preserva el orden de entrada (estable)',
  );
});

test('R4.8: nombres con espacios al borde se comparan trimmeados (" ana" no se va al principio)', () => {
  const out = sortMembers([
    m('2', ' ana', 'field_operator'),
    m('1', 'Abel', 'field_operator'),
  ]);
  assert.deepEqual(names(out), ['Abel', 'ana']);
});

// ─── R4.8 (e): el usuario logueado NO va primero ──────────────────────────────

test('R4.8: el usuario logueado NO se promueve — queda en su lugar alfabético dentro de su rol', () => {
  const out = sortMembers([
    m('a', 'Ana', 'owner'),
    m('yo', 'Zulema', 'owner', true), // el logueado, alfabéticamente último
    m('m', 'Marta', 'owner'),
  ]);
  assert.deepEqual(names(out), ['Ana', 'Marta', 'Zulema']);
  assert.equal(out[2].isCurrentUser, true, 'el logueado queda tercero, marcado con "vos"');
});

test('R4.8: el logueado tampoco se promueve por encima de su ROL (operario logueado bajo el dueño)', () => {
  const out = sortMembers([
    m('yo', 'Ana', 'field_operator', true),
    m('duenio', 'Zulema', 'owner'),
  ]);
  assert.deepEqual(names(out), ['Zulema', 'Ana']);
  assert.equal(out[0].isCurrentUser, false);
});

// ─── R4.8 (f): bordes ─────────────────────────────────────────────────────────

test('R4.8: lista vacía → array vacío (sin explotar)', () => {
  assert.deepEqual(sortMembers([]), []);
});

test('R4.8: un solo miembro → se devuelve igual (caso del no-owner que solo se ve a sí mismo)', () => {
  const out = sortMembers([m('yo', 'Ana', 'veterinarian', true)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].userId, 'yo');
});

test('R4.8: un solo miembro SIN nombre → se devuelve igual', () => {
  const out = sortMembers([m('yo', '', 'veterinarian', true)]);
  assert.deepEqual(
    out.map((x) => x.userId),
    ['yo'],
  );
});

test('R4.8: homónimos exactos preservan el orden de entrada (determinismo desde el ORDER BY del SQL)', () => {
  const out = sortMembers([
    m('u2', 'Juan Pérez', 'field_operator'),
    m('u1', 'Juan Pérez', 'field_operator'),
  ]);
  assert.deepEqual(
    out.map((x) => x.userId),
    ['u2', 'u1'],
  );
});

test('R4.8: NO muta el array de entrada (devuelve una copia ordenada)', () => {
  const input = [m('v', 'Ana', 'veterinarian'), m('o', 'Zulema', 'owner')];
  const snapshot = input.map((x) => x.userId);
  const out = sortMembers(input);
  assert.deepEqual(
    input.map((x) => x.userId),
    snapshot,
    'la entrada queda intacta',
  );
  assert.notEqual(out, input, 'devuelve un array nuevo');
});

test('R4.8: un rol desconocido (enum ampliado a futuro) cae al final en vez de romper el orden', () => {
  const out = sortMembers([
    { userId: 'x', name: 'Ana', role: 'auditor' as UserRole },
    m('o', 'Zulema', 'owner'),
    m('v', 'Bruno', 'veterinarian'),
  ] as M[]);
  assert.deepEqual(names(out), ['Zulema', 'Bruno', 'Ana']);
});

// ─── mapMemberRows: el path REAL de loadMembers (proyección + orden) ────────────

function row(user_id: string, user_name: string | null, role: UserRole): MemberRow {
  return { user_id, user_name, role };
}

test('mapMemberRows: proyecta la fila local a Member (userId/name/role/isCurrentUser)', () => {
  const out = mapMemberRows([row('u-1', 'Ana', 'owner')], 'u-1');
  assert.deepEqual(out, [{ userId: 'u-1', name: 'Ana', role: 'owner', isCurrentUser: true }]);
});

test('mapMemberRows: user_name NULL → name "" (la fila renderiza "Sin nombre")', () => {
  const out = mapMemberRows([row('u-1', null, 'owner')], 'otro');
  assert.equal(out[0].name, '');
  assert.equal(out[0].isCurrentUser, false);
});

test('mapMemberRows: DEVUELVE LA LISTA ORDENADA — es el path real de loadMembers (R4.8)', () => {
  // Filas en el orden "crudo" que podría devolver SQLite: el resultado igual sale canónico.
  const out = mapMemberRows(
    [
      row('u-vet', 'Ñoño', 'veterinarian'),
      row('u-op-sin', null, 'field_operator'),
      row('u-own-z', 'Zulema', 'owner'),
      row('u-vet2', 'Nadia', 'veterinarian'),
      row('u-op', 'Álvarez', 'field_operator'),
      row('u-own-a', 'Ana', 'owner'),
    ],
    'u-own-z', // el usuario logueado es Zulema (owner) — NO debe quedar primera
  );
  assert.deepEqual(
    out.map((x) => x.userId),
    ['u-own-a', 'u-own-z', 'u-op', 'u-op-sin', 'u-vet2', 'u-vet'],
  );
  assert.equal(out[1].isCurrentUser, true, 'Zulema queda 2da (alfabético), marcada con "vos"');
  assert.equal(out[0].isCurrentUser, false);
});

test('mapMemberRows: isCurrentUser sigue al userId aunque el orden cambie de posición la fila propia', () => {
  const out = mapMemberRows(
    [row('u-z', 'Zulema', 'owner'), row('u-a', 'Ana', 'owner')],
    'u-z',
  );
  assert.deepEqual(
    out.map((x) => [x.userId, x.isCurrentUser]),
    [
      ['u-a', false],
      ['u-z', true],
    ],
  );
});

test('mapMemberRows: sin filas (campo aún sincronizando / no-owner sin fila) → []', () => {
  assert.deepEqual(mapMemberRows([], 'u-1'), []);
});

test('mapMemberRows: caso no-owner — una sola fila, la propia', () => {
  const out = mapMemberRows([row('u-1', 'Facundo', 'veterinarian')], 'u-1');
  assert.equal(out.length, 1);
  assert.equal(out[0].isCurrentUser, true);
});

test('mapMemberRows: NO muta las filas de entrada', () => {
  const rows = [row('u-z', 'Zulema', 'owner'), row('u-a', 'Ana', 'owner')];
  mapMemberRows(rows, 'u-z');
  assert.deepEqual(
    rows.map((r) => r.user_id),
    ['u-z', 'u-a'],
  );
});

// ─── Escenario integral (lo que se ve en pantalla) ──────────────────────────────

test('R4.8: escenario real — equipo mixto queda agrupado por rol, alfabético, sin-nombre al fondo de su rol', () => {
  const out = sortMembers([
    m('v-b', 'Ñoño', 'veterinarian'),
    m('f-c', '', 'field_operator'),
    m('o-a', 'Zulema', 'owner', true), // la dueña logueada NO va primera dentro de su rol si no le toca
    m('v-a', 'Nadia', 'veterinarian'),
    m('f-a', 'Álvarez', 'field_operator'),
    m('o-b', 'Ana', 'owner'),
    m('f-b', 'Benítez', 'field_operator'),
  ]);
  assert.deepEqual(names(out), [
    'Ana', // owner
    'Zulema', // owner (logueada, en su lugar alfabético)
    'Álvarez', // field_operator
    'Benítez', // field_operator
    '«f-c»', // field_operator sin nombre → final de SU rol, no de la lista
    'Nadia', // veterinarian
    'Ñoño', // veterinarian
  ]);
});
