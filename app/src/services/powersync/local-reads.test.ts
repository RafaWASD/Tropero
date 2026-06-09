// Tests de los SQL builders PUROS del swap de lectura (spec 15, T3 / R5.1, R5.4). node:test.
// PURO: no carga el SDK ni supabase ni RN → corre siempre. Verifica el SQL + args exactos por
// builder, los filtros de DOMINIO conservados (active/status/deleted_at), el orden y los JOINs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toBool,
  buildFieldCatalogQuery,
  buildSystemDefaultsQuery,
  buildRodeoConfigQuery,
  buildSystemCategoriesQuery,
  buildSpeciesByCodeQuery,
  buildSystemsBySpeciesQuery,
  buildRodeosQuery,
  buildMembershipsQuery,
  buildOwnPhoneQuery,
  buildOwnNameQuery,
  buildOwnEmailPhoneQuery,
  buildEstablishmentDetailQuery,
  buildCountActiveMembersQuery,
  buildMembersQuery,
  buildCountOtherMembersQuery,
  buildCountPendingInvitationsQuery,
  buildPendingInvitationsQuery,
} from './local-reads.ts';

// ─── toBool: SQLite no tiene boolean (guarda 0/1) ──────────────────────────────────

test('toBool: 1/true/"1" → true; 0/false/"0"/null → false', () => {
  assert.equal(toBool(1), true);
  assert.equal(toBool(true), true);
  assert.equal(toBool('1'), true);
  assert.equal(toBool(0), false);
  assert.equal(toBool(false), false);
  assert.equal(toBool('0'), false);
  assert.equal(toBool(null), false);
  assert.equal(toBool(undefined), false);
});

// ─── Catálogos (T3.1) ──────────────────────────────────────────────────────────────

test('buildFieldCatalogQuery: filtro de dominio active=1, sin args, columnas as-built', () => {
  const q = buildFieldCatalogQuery();
  assert.match(q.sql, /FROM field_definitions/);
  assert.match(q.sql, /WHERE active = 1/);
  // columnas exactas que el mapper toFieldDefinition consume
  assert.match(q.sql, /id, data_key, label, description, category, data_type, ui_component/);
  assert.deepEqual(q.args, []);
});

test('buildSystemDefaultsQuery: filtra por system_id parametrizado, sin filtro de dominio extra', () => {
  const q = buildSystemDefaultsQuery('sys-1');
  assert.match(q.sql, /FROM system_default_fields WHERE system_id = \?/);
  assert.match(q.sql, /field_definition_id, default_enabled, required_for_system, sort_order/);
  assert.deepEqual(q.args, ['sys-1']);
});

test('buildRodeoConfigQuery: por rodeo_id, sin re-scoping de tenant', () => {
  const q = buildRodeoConfigQuery('rod-9');
  assert.equal(q.sql, 'SELECT field_definition_id, enabled FROM rodeo_data_config WHERE rodeo_id = ?');
  assert.deepEqual(q.args, ['rod-9']);
  // NO re-filtra establishment_id ni has_role_in (la stream ya scopeó)
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /has_role_in/);
});

test('buildSystemCategoriesQuery: filtro de dominio active=1 + orden por sort_order ASC', () => {
  const q = buildSystemCategoriesQuery('sys-2');
  assert.match(q.sql, /FROM categories_by_system/);
  assert.match(q.sql, /WHERE system_id = \? AND active = 1/);
  assert.match(q.sql, /ORDER BY sort_order ASC/);
  assert.deepEqual(q.args, ['sys-2']);
});

// ─── Sistemas productivos (T3.1) ────────────────────────────────────────────────────

test('buildSpeciesByCodeQuery: filtro de dominio active=1 + LIMIT 1 (maybeSingle)', () => {
  const q = buildSpeciesByCodeQuery('bovino');
  assert.match(q.sql, /FROM species WHERE code = \? AND active = 1 LIMIT 1/);
  assert.deepEqual(q.args, ['bovino']);
});

test('buildSystemsBySpeciesQuery: trae TODOS (no filtra active) para grisar no-MVP', () => {
  const q = buildSystemsBySpeciesQuery('sp-7');
  assert.match(q.sql, /FROM systems_by_species WHERE species_id = \?/);
  // NO debe filtrar active (la lista grisa los inactivos en la UI)
  assert.doesNotMatch(q.sql, /active = 1/);
  assert.match(q.sql, /id, species_id, code, name, active/);
  assert.deepEqual(q.args, ['sp-7']);
});

// ─── Rodeos (T3.3) ───────────────────────────────────────────────────────────────

test('buildRodeosQuery: filtros de dominio active=1 + deleted_at IS NULL + orden created_at ASC', () => {
  const q = buildRodeosQuery('est-1');
  assert.match(q.sql, /FROM rodeos/);
  assert.match(q.sql, /WHERE establishment_id = \? AND active = 1 AND deleted_at IS NULL/);
  assert.match(q.sql, /ORDER BY created_at ASC/);
  assert.match(q.sql, /id, establishment_id, name, species_id, system_id, active/);
  assert.deepEqual(q.args, ['est-1']);
});

// ─── Contexto de establecimiento (T3.2) ─────────────────────────────────────────────

test('buildMembershipsQuery: JOIN user_roles+establishments, filtro user_id + active + soft-delete', () => {
  const q = buildMembershipsQuery('user-42');
  // JOIN SQLite (reescritura del !inner de PostgREST)
  assert.match(q.sql, /FROM user_roles ur JOIN establishments e ON e\.id = ur\.establishment_id/);
  // filtro CRÍTICO por user_id propio (no traer roles de coworkers del owner)
  assert.match(q.sql, /WHERE ur\.user_id = \?/);
  assert.match(q.sql, /ur\.active = 1/);
  assert.match(q.sql, /e\.deleted_at IS NULL/);
  // alias necesarios para re-armar RoleRow
  assert.match(q.sql, /e\.id AS id/);
  assert.match(q.sql, /ur\.role AS role/);
  assert.deepEqual(q.args, ['user-42']);
});

test('buildOwnPhoneQuery / buildOwnNameQuery / buildOwnEmailPhoneQuery: self por id, LIMIT 1', () => {
  const phone = buildOwnPhoneQuery('u1');
  assert.match(phone.sql, /SELECT phone FROM user_private WHERE user_id = \? LIMIT 1/);
  assert.deepEqual(phone.args, ['u1']);

  // (c2, ADR-026) el nombre propio se lee de user_roles.member_name (denormalizado), NO de la tabla global users
  // (que el paso 2 NO sincroniza). Shape del resultado intacto: { name }.
  const name = buildOwnNameQuery('u2');
  assert.match(name.sql, /SELECT member_name AS name FROM user_roles WHERE user_id = \? LIMIT 1/);
  // ya NO debe leer de la tabla global users
  assert.doesNotMatch(name.sql, /FROM users\b/);
  assert.deepEqual(name.args, ['u2']);

  const emailPhone = buildOwnEmailPhoneQuery('u3');
  assert.match(emailPhone.sql, /SELECT email, phone FROM user_private WHERE user_id = \? LIMIT 1/);
  assert.deepEqual(emailPhone.args, ['u3']);
});

test('buildEstablishmentDetailQuery: filtro de dominio deleted_at IS NULL + LIMIT 1', () => {
  const q = buildEstablishmentDetailQuery('est-9');
  assert.match(q.sql, /FROM establishments WHERE id = \? AND deleted_at IS NULL LIMIT 1/);
  assert.match(q.sql, /id, name, province, city, total_hectares/);
  assert.deepEqual(q.args, ['est-9']);
});

test('buildCountActiveMembersQuery: COUNT(*), active=1, excluye al owner', () => {
  const q = buildCountActiveMembersQuery('est-1', 'owner-1');
  assert.match(q.sql, /SELECT COUNT\(\*\) AS count FROM user_roles/);
  assert.match(q.sql, /WHERE establishment_id = \? AND active = 1 AND user_id != \?/);
  assert.deepEqual(q.args, ['est-1', 'owner-1']);
});

// ─── Miembros e invitaciones (T3.2) ─────────────────────────────────────────────────

test('buildMembersQuery: member_name denormalizado en user_roles (c2), sin JOIN a users, active=1, sin PII', () => {
  const q = buildMembersQuery('est-3');
  // (c2, ADR-026) el nombre sale de user_roles.member_name (denormalizado, 0080); ya NO se JOINea users
  // (la tabla global users no se sincroniza en el paso 2).
  assert.match(q.sql, /FROM user_roles ur\b/);
  assert.doesNotMatch(q.sql, /JOIN users/);
  assert.match(q.sql, /WHERE ur\.establishment_id = \? AND ur\.active = 1/);
  // shape público intacto: el alias del nombre sigue siendo user_name (lo consume members.ts → name)
  assert.match(q.sql, /ur\.member_name AS user_name/);
  // NUNCA phone/email de otros (hallazgo RLS #2; la PII vive en user_private self-only)
  assert.doesNotMatch(q.sql, /phone/);
  assert.doesNotMatch(q.sql, /email/);
  assert.deepEqual(q.args, ['est-3']);
});

test('buildCountOtherMembersQuery: COUNT activos ≠ self', () => {
  const q = buildCountOtherMembersQuery('est-4', 'self-1');
  assert.match(q.sql, /SELECT COUNT\(\*\) AS count FROM user_roles/);
  assert.match(q.sql, /WHERE establishment_id = \? AND active = 1 AND user_id != \?/);
  assert.deepEqual(q.args, ['est-4', 'self-1']);
});

test('buildCountPendingInvitationsQuery: COUNT status=pending', () => {
  const q = buildCountPendingInvitationsQuery('est-5');
  assert.match(q.sql, /SELECT COUNT\(\*\) AS count FROM invitations/);
  assert.match(q.sql, /WHERE establishment_id = \? AND status = 'pending'/);
  assert.deepEqual(q.args, ['est-5']);
});

test('buildPendingInvitationsQuery: filas pending con columnas as-built', () => {
  const q = buildPendingInvitationsQuery('est-6');
  assert.match(q.sql, /id, role, email, created_at, expires_at, token FROM invitations/);
  assert.match(q.sql, /WHERE establishment_id = \? AND status = 'pending'/);
  assert.deepEqual(q.args, ['est-6']);
});
