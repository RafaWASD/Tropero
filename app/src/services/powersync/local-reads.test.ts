// Tests de los SQL builders PUROS del swap de lectura (spec 15, T3 / R5.1, R5.4). node:test.
// PURO: no carga el SDK ni supabase ni RN → corre siempre. Verifica el SQL + args exactos por
// builder, los filtros de DOMINIO conservados (active/status/deleted_at), el orden y los JOINs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  toBool,
  buildFieldCatalogQuery,
  buildSystemDefaultsQuery,
  buildRodeoConfigQuery,
  buildSystemCategoriesQuery,
  buildSpeciesByCodeQuery,
  buildSystemsBySpeciesQuery,
  buildSystemByCodeQuery,
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
  buildAnimalsListQuery,
  buildAnimalsCountQuery,
  buildRodeoHeadCountsQuery,
  buildGroupHeadCountsQuery,
  buildSearchByTagQuery,
  buildSearchByIdvQuery,
  buildSearchLikeQuery,
  escapeLike,
  buildAnimalDetailQuery,
  buildCategoryMirrorEventsQuery,
  buildRevertCategoryOverrideUpdate,
  buildManagementGroupsQuery,
  buildTimelineQuery,
  buildReproServiceTypesQuery,
  buildCategoryNamesQuery,
  buildMotherQuery,
  buildAddWeightInsert,
  buildAddConditionScoreInsert,
  buildAddTactoInsert,
  buildAddServiceInsert,
  buildAddAbortionInsert,
  buildAddObservationInsert,
  buildAddVaccinationInsert,
  buildAddWeaningInsert,
  buildSetCastratedUpdate,
  buildSetFutureBullUpdate,
  buildExistingVaccinationIdsQuery,
  buildExistingWeaningIdsQuery,
  buildProfileEstablishmentQuery,
  buildProfileEstablishmentsQuery,
  buildGroupCandidateFlagsQuery,
  buildCreateManagementGroupInsert,
  buildRenameManagementGroupUpdate,
  buildAssignAnimalToGroupUpdate,
  buildClearGroupMembersUpdate,
  buildCategoryIdByCodeQuery,
  buildCategoryByCodeQuery,
  buildRodeoSpeciesQuery,
  buildBirthOverlayContextQuery,
  buildOpIntentInsert,
  buildPendingAnimalInsert,
  buildPendingAnimalProfileInsert,
  buildPendingReproductiveEventInsert,
  buildPendingBirthCalfInsert,
  buildPendingStatusOverrideInsert,
  buildPendingRodeoInsert,
  buildPendingRodeoConfigInsert,
  buildDeletePendingRodeoConfig,
  buildClearOverlayDelete,
  PENDING_OVERLAY_TABLES,
  type PendingProfileFields,
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

test('buildRodeoConfigQuery: por rodeo_id, sin re-scoping de tenant + overlay-override (alta T9.8 + edición T9.9)', () => {
  const q = buildRodeoConfigQuery('rod-9');
  assert.match(q.sql, /SELECT field_definition_id, enabled FROM rodeo_data_config /);
  // Run T9.9 + fix rowid (Run T9.9 follow-up, 2026-06-09): overlay-OVERRIDE (no UNION ALL puro). La synced excluye los fields que el overlay pisa
  // (NOT IN); el overlay aporta TODAS las filas del rodeo (≤1 por field por el delete-prior del enqueue). 3
  // placeholders del mismo rodeo_id.
  assert.match(q.sql, /field_definition_id NOT IN \(SELECT field_definition_id FROM pending_rodeo_data_config WHERE rodeo_id = \?\)/);
  assert.match(q.sql, /UNION ALL SELECT field_definition_id, enabled FROM pending_rodeo_data_config WHERE rodeo_id = \?/);
  // 3 placeholders, todos = rodeoId
  assert.equal((q.sql.match(/\?/g) ?? []).length, 3);
  assert.deepEqual(q.args, ['rod-9', 'rod-9', 'rod-9']);
  // fix rowid (Run T9.9 follow-up, 2026-06-09): NO usa rowid — las tablas de PowerSync son VIEWS y NO exponen rowid (rompía online y offline).
  assert.doesNotMatch(q.sql, /rowid/);
  // NO re-filtra establishment_id ni has_role_in (la stream ya scopeó)
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /has_role_in/);
});

// Tests de COMPORTAMIENTO del overlay-override (no solo string-match): se ejecuta el SQL real contra un
// SQLite en memoria (node:sqlite) con las 2 tablas (synced + pending) — así verificamos la SEMÁNTICA de pisar
// el synced y de "una fila por field", que un assert de string no captura. (Run T9.9 + fix rowid (Run T9.9 follow-up, 2026-06-09).)
//
// IMPORTANTE (fix rowid (Run T9.9 follow-up, 2026-06-09)): node:sqlite usa TABLAS reales (con rowid); las tablas de PowerSync son VIEWS (SIN
// rowid). El query NO debe depender de rowid — por eso el invariante "≤1 fila de overlay por (rodeo,field)" lo
// garantiza el enqueue con DELETE-PRIOR, no la query. Estos tests ejercen ese invariante construyéndolo a mano
// (el set de `pending` que se pasa ya respeta ≤1 por field; la doble-edición se prueba aparte simulando el
// delete-prior con buildDeletePendingRodeoConfig + un nuevo insert).
function runRodeoConfigQuery(
  synced: { fieldDefinitionId: string; enabled: 0 | 1 }[],
  pending: { fieldDefinitionId: string; enabled: 0 | 1 }[],
  rodeoId = 'rod-1',
): { field_definition_id: string; enabled: number }[] {
  // node:sqlite (DatabaseSync) es nativo de Node 24 → ejecutamos el SQL real para verificar la semántica.
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE pending_rodeo_data_config (id TEXT, client_op_id TEXT, rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);',
  );
  const insSync = db.prepare('INSERT INTO rodeo_data_config (rodeo_id, field_definition_id, enabled) VALUES (?,?,?)');
  for (const r of synced) insSync.run(rodeoId, r.fieldDefinitionId, r.enabled);
  const insPend = db.prepare(
    'INSERT INTO pending_rodeo_data_config (id, client_op_id, rodeo_id, field_definition_id, enabled) VALUES (?,?,?,?,?)',
  );
  let i = 0;
  for (const r of pending) insPend.run(`o${i++}`, 'cop', rodeoId, r.fieldDefinitionId, r.enabled);
  const q = buildRodeoConfigQuery(rodeoId);
  const raw = db.prepare(q.sql).all(...(q.args as string[])) as { field_definition_id: string; enabled: number }[];
  db.close();
  // node:sqlite devuelve filas con prototipo null → normalizamos a objetos planos para deepEqual, y orden
  // estable para comparar sin depender del orden del UNION.
  return raw
    .map((r) => ({ field_definition_id: r.field_definition_id, enabled: r.enabled }))
    .sort((a, b) => a.field_definition_id.localeCompare(b.field_definition_id));
}

test('buildRodeoConfigQuery (comportamiento): sin overlay → idéntico a synced', () => {
  const rows = runRodeoConfigQuery(
    [{ fieldDefinitionId: 'f-peso', enabled: 1 }, { fieldDefinitionId: 'f-preñez', enabled: 0 }],
    [],
  );
  assert.deepEqual(rows, [
    { field_definition_id: 'f-peso', enabled: 1 },
    { field_definition_id: 'f-preñez', enabled: 0 },
  ]);
});

test('buildRodeoConfigQuery (comportamiento): edición — el overlay PISA la fila synced del mismo field (sin duplicar)', () => {
  const rows = runRodeoConfigQuery(
    [{ fieldDefinitionId: 'f-peso', enabled: 1 }, { fieldDefinitionId: 'f-preñez', enabled: 0 }],
    [{ fieldDefinitionId: 'f-peso', enabled: 0 }], // el owner apagó 'peso'
  );
  // 'peso' aparece UNA sola vez con el valor del overlay (0); 'preñez' intacto desde synced.
  assert.deepEqual(rows, [
    { field_definition_id: 'f-peso', enabled: 0 },
    { field_definition_id: 'f-preñez', enabled: 0 },
  ]);
});

test('buildRodeoConfigQuery (comportamiento): doble-edición offline del mismo field con delete-prior → UNA sola fila con el valor nuevo (fix rowid (Run T9.9 follow-up, 2026-06-09))', () => {
  // Simula lo que hace enqueueSetRodeoConfig: edición 1 (apagar 'peso') → delete-prior + edición 2 (prender).
  // El delete-prior (buildDeletePendingRodeoConfig) borra la fila de la edición 1 ANTES de insertar la 2 →
  // queda ≤1 fila por field → la query (UNION ALL sin rowid) devuelve UNA sola fila con el valor nuevo.
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE pending_rodeo_data_config (id TEXT, client_op_id TEXT, rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);',
  );
  // synced: 'peso' venía en 1.
  db.prepare('INSERT INTO rodeo_data_config (rodeo_id, field_definition_id, enabled) VALUES (?,?,?)')
    .run('rod-1', 'f-peso', 1);
  const insPend = db.prepare(
    'INSERT INTO pending_rodeo_data_config (id, client_op_id, rodeo_id, field_definition_id, enabled) VALUES (?,?,?,?,?)',
  );
  // Edición 1 (op viejo): apagar 'peso' → overlay enabled 0.
  insPend.run('o1', 'cop-1', 'rod-1', 'f-peso', 0);
  // Edición 2 (op nuevo): el enqueue hace DELETE-PRIOR de (rod-1, f-peso) y luego inserta enabled 1.
  const del = buildDeletePendingRodeoConfig('rod-1', 'f-peso');
  db.prepare(del.sql).run(...(del.args as string[]));
  insPend.run('o2', 'cop-2', 'rod-1', 'f-peso', 1);
  // El overlay quedó con UNA sola fila para 'peso' (la del op nuevo).
  const overlayCount = (
    db.prepare("SELECT COUNT(*) AS n FROM pending_rodeo_data_config WHERE rodeo_id = 'rod-1' AND field_definition_id = 'f-peso'").get() as { n: number }
  ).n;
  assert.equal(overlayCount, 1);
  const q = buildRodeoConfigQuery('rod-1');
  const raw = db.prepare(q.sql).all(...(q.args as string[])) as { field_definition_id: string; enabled: number }[];
  db.close();
  const rows = raw.map((r) => ({ field_definition_id: r.field_definition_id, enabled: r.enabled }));
  // UNA sola fila de 'peso' con el valor de la edición 2 (1) — sin duplicado pese a las 2 ediciones.
  assert.deepEqual(rows, [{ field_definition_id: 'f-peso', enabled: 1 }]);
});

test('buildRodeoConfigQuery (comportamiento): alta (synced vacío) → solo overlay, una fila por field', () => {
  const rows = runRodeoConfigQuery(
    [], // rodeo dado de alta offline: nada en la tabla synced hasta el ACK
    [{ fieldDefinitionId: 'f-peso', enabled: 1 }, { fieldDefinitionId: 'f-preñez', enabled: 1 }],
  );
  assert.deepEqual(rows, [
    { field_definition_id: 'f-peso', enabled: 1 },
    { field_definition_id: 'f-preñez', enabled: 1 },
  ]);
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

test('buildSystemByCodeQuery: system_id ACTIVO por (species, code), LIMIT 1 (createRodeo, Run T9.8)', () => {
  const q = buildSystemByCodeQuery('sp-7', 'cria');
  assert.match(q.sql, /SELECT id FROM systems_by_species WHERE species_id = \? AND code = \? AND active = 1 LIMIT 1/);
  assert.deepEqual(q.args, ['sp-7', 'cria']);
});

// ─── Rodeos (T3.3) ───────────────────────────────────────────────────────────────

test('buildRodeosQuery: filtros de dominio + orden created_at ASC + overlay oculta soft_deleted + UNION pending_rodeos', () => {
  const q = buildRodeosQuery('est-1');
  assert.match(q.sql, /FROM rodeos rd/);
  assert.match(q.sql, /WHERE rd\.establishment_id = \? AND rd\.active = 1 AND rd\.deleted_at IS NULL/);
  assert.match(q.sql, /ORDER BY created_at ASC/);
  assert.match(q.sql, /id, establishment_id, name, species_id, system_id, active, created_at/);
  // T6: oculta los rodeos con un override soft_deleted pendiente (rama synced y overlay).
  assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM pending_status_overrides pso WHERE pso\.target_table = 'rodeos' AND pso\.target_id = rd\.id AND pso\.effect IN \('soft_deleted'\)\)/);
  // Run T9.8: UNIONa los rodeos alta-optimistas (pending_rodeos) → el rodeo offline aparece en la lista.
  assert.match(q.sql, /UNION ALL SELECT id, establishment_id, name, species_id, system_id, active, created_at FROM pending_rodeos pr/);
  assert.match(q.sql, /WHERE pr\.establishment_id = \? AND pr\.active = 1/);
  assert.match(q.sql, /pso\.target_id = pr\.id AND pso\.effect IN \('soft_deleted'\)/);
  assert.deepEqual(q.args, ['est-1', 'est-1']);
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

// ─── Animales: lista / búsqueda / detalle (T4.1) ────────────────────────────────────

test('buildAnimalsListQuery: b1 identidad desde animal_profiles, JOINs, status default active, orden, limit + UNION overlay', () => {
  const q = buildAnimalsListQuery('est-1');
  // b1: la identidad (tag/sex) sale de animal_profiles, NO de un JOIN a animals
  assert.match(q.sql, /ap\.animal_tag_electronic AS tag_electronic/);
  assert.match(q.sql, /ap\.animal_sex AS sex/);
  assert.doesNotMatch(q.sql, /JOIN animals\b/);
  assert.doesNotMatch(q.sql, /FROM animals\b/);
  // JOINs SQLite a rodeos + categorías (reescritura de los !inner)
  assert.match(q.sql, /FROM animal_profiles ap/);
  assert.match(q.sql, /JOIN rodeos r ON r\.id = ap\.rodeo_id/);
  assert.match(q.sql, /JOIN categories_by_system c ON c\.id = ap\.category_id/);
  // filtros de dominio: establishment + deleted_at propio + status default active
  assert.match(q.sql, /ap\.establishment_id = \? AND ap\.deleted_at IS NULL AND ap\.status = \?/);
  // T6: UNION con el overlay pending_animal_profiles + oculta exits/soft_deletes pendientes
  assert.match(q.sql, /UNION ALL/);
  assert.match(q.sql, /FROM pending_animal_profiles pap/);
  assert.match(q.sql, /pso\.target_table = 'animal_profiles' AND pso\.target_id = ap\.id AND pso\.effect IN \('exited', 'soft_deleted'\)/);
  // orden + limit (ahora por el alias proyectado created_at, sobre el UNION completo)
  assert.match(q.sql, /ORDER BY created_at DESC LIMIT 200/);
  // NO re-scopea tenant (has_role_in)
  assert.doesNotMatch(q.sql, /has_role_in/);
  // spec 10 (T-CL.12): el espejo C6 necesita is_castrated REAL → la lista lo proyecta en AMBAS ramas
  // (synced: ap.is_castrated; overlay: 0 constante — un alta optimista nace entero).
  assert.match(q.sql, /ap\.is_castrated AS is_castrated/);
  assert.match(q.sql, /0 AS is_castrated/);
  // spec 10 (T-UI.1/T-UI.3 / R12.3): la fila compacta de la vista de grupo necesita future_bull (badge ⭐)
  // y birth_date (edad) por animal → la lista los proyecta en AMBAS ramas (overlay future_bull = 0).
  assert.match(q.sql, /ap\.future_bull AS future_bull/);
  assert.match(q.sql, /0 AS future_bull/);
  assert.match(q.sql, /ap\.animal_birth_date AS birth_date/);
  // args = synced (est, active) ++ overlay (est, active)
  assert.deepEqual(q.args, ['est-1', 'active', 'est-1', 'active']);
});

test('buildAnimalsListQuery: filtros rodeoId + noTag (b1) en AMBAS ramas (synced + overlay) + status explícito', () => {
  const q = buildAnimalsListQuery('est-1', { rodeoId: 'rod-2', status: 'sold', noTag: true });
  assert.match(q.sql, /AND ap\.rodeo_id = \?/);
  assert.match(q.sql, /AND pap\.rodeo_id = \?/);
  // noTag = identidad denormalizada NULL (b1) en synced y overlay
  assert.match(q.sql, /AND ap\.animal_tag_electronic IS NULL/);
  assert.match(q.sql, /AND pap\.animal_tag_electronic IS NULL/);
  // args: synced (est, status, rodeoId) ++ overlay (est, status, rodeoId)
  assert.deepEqual(q.args, ['est-1', 'sold', 'rod-2', 'est-1', 'sold', 'rod-2']);
});

test('buildAnimalsListQuery: sin rodeoId no agrega el filtro; noTag falso no agrega el IS NULL del tag', () => {
  const q = buildAnimalsListQuery('est-1', { status: 'active' });
  assert.doesNotMatch(q.sql, /ap\.rodeo_id = \?/);
  // el filtro noTag es `animal_tag_electronic IS NULL` (la columna ANTES del IS NULL) — no debe aparecer.
  assert.doesNotMatch(q.sql, /animal_tag_electronic IS NULL/);
  assert.deepEqual(q.args, ['est-1', 'active', 'est-1', 'active']);
});

test('buildAnimalsCountQuery: COUNT activos synced (oculta exits) + COUNT overlay', () => {
  const q = buildAnimalsCountQuery('est-9');
  // suma de dos sub-counts: animal_profiles (oculta exits) + pending_animal_profiles
  assert.match(q.sql, /SELECT COUNT\(\*\) FROM animal_profiles ap/);
  assert.match(q.sql, /WHERE ap\.establishment_id = \? AND ap\.status = 'active' AND ap\.deleted_at IS NULL AND/);
  assert.match(q.sql, /SELECT COUNT\(\*\) FROM pending_animal_profiles pap/);
  assert.match(q.sql, /\) \+ \(/);
  assert.match(q.sql, /AS count/);
  assert.deepEqual(q.args, ['est-9', 'est-9']);
});

// ─── spec 10 T-UI.2: conteos de cabezas por grupo (Inicio rodeo-céntrico) ──────────────────

test('buildRodeoHeadCountsQuery: GROUP BY rodeo_id, UNION synced+overlay, oculta exits, args duplicados', () => {
  const q = buildRodeoHeadCountsQuery('est-3');
  assert.match(q.sql, /SELECT rodeo_id, COUNT\(\*\) AS count FROM \(/);
  assert.match(q.sql, /SELECT ap\.rodeo_id AS rodeo_id FROM animal_profiles ap/);
  assert.match(q.sql, /WHERE ap\.establishment_id = \? AND ap\.status = 'active' AND ap\.deleted_at IS NULL AND/);
  assert.match(q.sql, /UNION ALL/);
  assert.match(q.sql, /SELECT pap\.rodeo_id AS rodeo_id FROM pending_animal_profiles pap/);
  assert.match(q.sql, /GROUP BY rodeo_id/);
  assert.deepEqual(q.args, ['est-3', 'est-3']);
});

test('buildRodeoHeadCountsQuery: COMPORTAMIENTO — cuenta activos por rodeo, suma overlay, excluye exits/soft-deletes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, establishment_id TEXT, rodeo_id TEXT, status TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, establishment_id TEXT, rodeo_id TEXT, status TEXT);' +
      'CREATE TABLE pending_status_overrides (id TEXT, target_table TEXT, target_id TEXT, effect TEXT);',
  );
  const insS = db.prepare('INSERT INTO animal_profiles (id, establishment_id, rodeo_id, status, deleted_at) VALUES (?,?,?,?,?)');
  insS.run('a1', 'est-1', 'rod-A', 'active', null);
  insS.run('a2', 'est-1', 'rod-A', 'active', null);
  insS.run('a3', 'est-1', 'rod-B', 'active', null);
  insS.run('a4', 'est-1', 'rod-A', 'sold', null); // no activo → no cuenta
  insS.run('a5', 'est-1', 'rod-B', 'active', '2026-01-01'); // soft-deleted → no cuenta
  insS.run('a6', 'est-2', 'rod-A', 'active', null); // OTRO establishment → no cuenta
  insS.run('a7', 'est-1', 'rod-A', 'active', null); // activo pero con exit pendiente (override) → no cuenta
  db.prepare('INSERT INTO pending_status_overrides (id, target_table, target_id, effect) VALUES (?,?,?,?)')
    .run('o1', 'animal_profiles', 'a7', 'exited');
  // overlay: un ternero optimista en rod-B
  db.prepare('INSERT INTO pending_animal_profiles (id, establishment_id, rodeo_id, status) VALUES (?,?,?,?)')
    .run('p1', 'est-1', 'rod-B', 'active');

  const q = buildRodeoHeadCountsQuery('est-1');
  const rows = (db.prepare(q.sql).all(...(q.args as string[])) as { rodeo_id: string; count: number }[])
    .map((r) => ({ rodeo_id: r.rodeo_id, count: r.count }))
    .sort((a, b) => a.rodeo_id.localeCompare(b.rodeo_id));
  db.close();
  // rod-A: a1,a2 (a4 sold, a7 exited, a6 otro est) = 2; rod-B: a3 + overlay p1 (a5 soft-deleted) = 2.
  assert.deepEqual(rows, [
    { rodeo_id: 'rod-A', count: 2 },
    { rodeo_id: 'rod-B', count: 2 },
  ]);
});

test('buildGroupHeadCountsQuery: GROUP BY management_group_id, solo no-NULL, UNION+oculta exits', () => {
  const q = buildGroupHeadCountsQuery('est-5');
  assert.match(q.sql, /SELECT management_group_id, COUNT\(\*\) AS count FROM \(/);
  assert.match(q.sql, /SELECT ap\.management_group_id AS management_group_id FROM animal_profiles ap/);
  assert.match(q.sql, /AND ap\.management_group_id IS NOT NULL AND/);
  assert.match(q.sql, /AND pap\.management_group_id IS NOT NULL AND/);
  assert.match(q.sql, /GROUP BY management_group_id/);
  assert.deepEqual(q.args, ['est-5', 'est-5']);
});

test('buildGroupHeadCountsQuery: COMPORTAMIENTO — cuenta activos por lote, ignora los sin lote (NULL)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, establishment_id TEXT, management_group_id TEXT, status TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, establishment_id TEXT, management_group_id TEXT, status TEXT);' +
      'CREATE TABLE pending_status_overrides (id TEXT, target_table TEXT, target_id TEXT, effect TEXT);',
  );
  const insS = db.prepare('INSERT INTO animal_profiles (id, establishment_id, management_group_id, status, deleted_at) VALUES (?,?,?,?,?)');
  insS.run('a1', 'est-1', 'lote-X', 'active', null);
  insS.run('a2', 'est-1', 'lote-X', 'active', null);
  insS.run('a3', 'est-1', null, 'active', null); // sin lote → NO cuenta
  insS.run('a4', 'est-1', 'lote-Y', 'active', null);
  insS.run('a5', 'est-1', 'lote-Y', 'sold', null); // no activo → no cuenta

  const q = buildGroupHeadCountsQuery('est-1');
  const rows = (db.prepare(q.sql).all(...(q.args as string[])) as { management_group_id: string; count: number }[])
    .map((r) => ({ management_group_id: r.management_group_id, count: r.count }))
    .sort((a, b) => a.management_group_id.localeCompare(b.management_group_id));
  db.close();
  assert.deepEqual(rows, [
    { management_group_id: 'lote-X', count: 2 },
    { management_group_id: 'lote-Y', count: 1 },
  ]);
});

test('buildSearchByTagQuery: exacto por animal_tag_electronic (b1), active, limit 20, UNION overlay', () => {
  const q = buildSearchByTagQuery('est-1', '982000123456789');
  assert.match(q.sql, /AND ap\.animal_tag_electronic = \?/);
  assert.match(q.sql, /AND pap\.animal_tag_electronic = \?/);
  assert.match(q.sql, /LIMIT 20/);
  assert.match(q.sql, /ap\.status = \?/);
  assert.doesNotMatch(q.sql, /FROM animals\b/);
  // args: synced (est, active, tag) ++ overlay (est, active, tag)
  assert.deepEqual(q.args, ['est-1', 'active', '982000123456789', 'est-1', 'active', '982000123456789']);
});

test('buildSearchByIdvQuery: exacto por idv, active, limit 20, UNION overlay', () => {
  const q = buildSearchByIdvQuery('est-1', '03200');
  assert.match(q.sql, /AND ap\.idv = \?/);
  assert.match(q.sql, /AND pap\.idv = \?/);
  assert.deepEqual(q.args, ['est-1', 'active', '03200', 'est-1', 'active', '03200']);
});

test('buildSearchLikeQuery: LIKE %term% local con ESCAPE, sobre la columna whitelisteada, UNION overlay', () => {
  const q = buildSearchLikeQuery('est-1', 'visual_id_alt', 'R12');
  // el SQL contiene ESCAPE '\' (un solo backslash); en regex un backslash literal es \\
  assert.match(q.sql, /AND ap\.visual_id_alt LIKE \? ESCAPE '\\'/);
  assert.match(q.sql, /AND pap\.visual_id_alt LIKE \? ESCAPE '\\'/);
  assert.match(q.sql, /LIMIT 20/);
  assert.deepEqual(q.args, ['est-1', 'active', '%R12%', 'est-1', 'active', '%R12%']);
});

test('buildSearchLikeQuery: degradación fuzzy → tag y idv también van por LIKE (UNION overlay)', () => {
  const tag = buildSearchLikeQuery('est-1', 'animal_tag_electronic', '0320');
  assert.match(tag.sql, /ap\.animal_tag_electronic LIKE \?/);
  assert.match(tag.sql, /pap\.animal_tag_electronic LIKE \?/);
  assert.deepEqual(tag.args, ['est-1', 'active', '%0320%', 'est-1', 'active', '%0320%']);
  const idv = buildSearchLikeQuery('est-1', 'idv', '0320');
  assert.match(idv.sql, /ap\.idv LIKE \?/);
  assert.match(idv.sql, /pap\.idv LIKE \?/);
  assert.deepEqual(idv.args, ['est-1', 'active', '%0320%', 'est-1', 'active', '%0320%']);
});

test('escapeLike: neutraliza %, _ y \\ del término (anti-comodín), no toca el resto', () => {
  assert.equal(escapeLike('abc'), 'abc');
  assert.equal(escapeLike('10%'), '10\\%');
  assert.equal(escapeLike('a_b'), 'a\\_b');
  assert.equal(escapeLike('a\\b'), 'a\\\\b');
  // un % literal del término queda escapado → en el patrón %...% solo los envolventes son comodín
  assert.equal(escapeLike('%_'), '\\%\\_');
});

test('buildAnimalDetailQuery: b1 identidad+birth_date, LEFT JOIN lote, deleted_at + UNION overlay + status del override exit', () => {
  const q = buildAnimalDetailQuery('prof-7');
  // b1: tag/sex/birth_date desde animal_profiles
  assert.match(q.sql, /ap\.animal_tag_electronic AS tag_electronic/);
  assert.match(q.sql, /ap\.animal_sex AS sex/);
  assert.match(q.sql, /ap\.animal_birth_date AS birth_date/);
  assert.doesNotMatch(q.sql, /FROM animals\b/);
  // LEFT JOIN management_groups (lote puede estar soft-deleted)
  assert.match(q.sql, /LEFT JOIN management_groups mg ON mg\.id = ap\.management_group_id/);
  assert.match(q.sql, /WHERE ap\.id = \? AND ap\.deleted_at IS NULL/);
  // T6: el status refleja el override de baja optimista (COALESCE) + UNION con el alta optimista
  assert.match(q.sql, /COALESCE\(pso\.status, ap\.status\) AS status/);
  // residual #2: la FECHA de egreso también sale del override (badge "Vendido el {fecha}" offline)
  assert.match(q.sql, /COALESCE\(pso\.exit_date, ap\.exit_date\) AS exit_date/);
  assert.match(q.sql, /LEFT JOIN pending_status_overrides pso ON pso\.target_table = 'animal_profiles' AND pso\.target_id = ap\.id AND pso\.effect = 'exited'/);
  assert.match(q.sql, /UNION ALL/);
  assert.match(q.sql, /FROM pending_animal_profiles pap/);
  assert.match(q.sql, /LIMIT 1/);
  // spec 10 (T-CL.12): la ficha proyecta is_castrated REAL (espejo C6) + future_bull (badge ⭐) en la rama
  // synced; el overlay (alta optimista) proyecta 0/0 constantes (nace entero, sin ⭐) — alinea el UNION.
  assert.match(q.sql, /ap\.is_castrated AS is_castrated, ap\.future_bull AS future_bull/);
  assert.match(q.sql, /0 AS is_castrated, 0 AS future_bull/);
  assert.deepEqual(q.args, ['prof-7', 'prof-7']);
});

// ─── C6: proyecciones extra del espejo de categoría (RC6.3.1/RC6.3.2) ──────────────────

test('C6: la lista proyecta category_override, animal_birth_date y system_id en AMBAS ramas (synced+overlay)', () => {
  const q = buildAnimalsListQuery('est-1');
  // synced (alias ap / r)
  assert.match(q.sql, /ap\.category_override AS category_override/);
  assert.match(q.sql, /ap\.animal_birth_date AS birth_date/);
  assert.match(q.sql, /r\.system_id AS system_id/);
  // overlay (alias pap / r) — el UNION exige idéntico set de columnas en ambas ramas
  assert.match(q.sql, /pap\.category_override AS category_override/);
  assert.match(q.sql, /pap\.animal_birth_date AS birth_date/);
  // r.system_id aparece 2 veces (una por rama); la presencia ya está asertada arriba.
  const systemIdCount = (q.sql.match(/r\.system_id AS system_id/g) ?? []).length;
  assert.equal(systemIdCount, 2, 'system_id proyectado en synced + overlay');
});

test('C6: el detalle proyecta system_id del rodeo (para resolver code→id/name del catálogo)', () => {
  const q = buildAnimalDetailQuery('prof-1');
  const systemIdCount = (q.sql.match(/r\.system_id AS system_id/g) ?? []).length;
  assert.equal(systemIdCount, 2, 'system_id proyectado en synced + overlay del detalle');
  // category_override ya se proyectaba (b1/T6); confirmamos que sigue.
  assert.match(q.sql, /ap\.category_override AS category_override/);
});

// ─── C6: buildCategoryMirrorEventsQuery (RC6.3.6) ──────────────────────────────────────

test('buildCategoryMirrorEventsQuery: SQL — synced (deleted_at IS NULL + event_type IN) UNION overlay, ORDER BY event_date, created_at', () => {
  const q = buildCategoryMirrorEventsQuery(['p1', 'p2']);
  // synced: filtro deleted_at + event_type acotado + IN con un placeholder por id
  assert.match(q.sql, /FROM reproductive_events WHERE animal_profile_id IN \(\?, \?\) AND deleted_at IS NULL/);
  assert.match(q.sql, /AND event_type IN \('birth','weaning','service','tacto','abortion'\)/);
  // overlay: pending_reproductive_events (sin deleted_at, sin pregnancy_status → NULL)
  assert.match(q.sql, /UNION ALL/);
  assert.match(q.sql, /FROM pending_reproductive_events WHERE animal_profile_id IN \(\?, \?\) AND event_type IN/);
  assert.match(q.sql, /NULL AS pregnancy_status/);
  // orden por (event_date, created_at) — el desempate del tacto+ vigente (RT2.7.5)
  assert.match(q.sql, /ORDER BY event_date ASC, created_at ASC/);
  // NO re-scopea tenant
  assert.doesNotMatch(q.sql, /has_role_in|establishment_id/);
  // args = ids (synced) ++ ids (overlay)
  assert.deepEqual(q.args, ['p1', 'p2', 'p1', 'p2']);
});

test('buildCategoryMirrorEventsQuery: COMPORTAMIENTO — synced no-borrados + overlay birth, excluye deleted_at y tipos irrelevantes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE reproductive_events (animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, pregnancy_status TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_reproductive_events (animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT);',
  );
  const insS = db.prepare(
    'INSERT INTO reproductive_events (animal_profile_id, event_type, event_date, created_at, pregnancy_status, deleted_at) VALUES (?,?,?,?,?,?)',
  );
  // tacto+ vigente (no borrado) de p1
  insS.run('p1', 'tacto', '2026-05-20', '2026-05-20T10:00:00Z', 'large', null);
  // un destete BORRADO de p1 → NO debe traerse
  insS.run('p1', 'weaning', '2026-05-10', '2026-05-10T10:00:00Z', null, '2026-05-15T00:00:00Z');
  // un evento de un tipo irrelevante (no en la whitelist) → NO debe traerse
  insS.run('p1', 'sanitary_dummy', '2026-05-12', '2026-05-12T10:00:00Z', null, null);
  // un evento de OTRO perfil (p2) → no aparece en la query de p1
  insS.run('p2', 'service', '2026-05-18', '2026-05-18T10:00:00Z', null, null);
  // overlay: parto optimista de p1 (sin pregnancy_status ni deleted_at)
  db.prepare('INSERT INTO pending_reproductive_events (animal_profile_id, event_type, event_date, created_at) VALUES (?,?,?,?)')
    .run('p1', 'birth', '2026-05-25', '2026-05-25T09:00:00Z');

  const q = buildCategoryMirrorEventsQuery(['p1']);
  const rows = (db.prepare(q.sql).all(...(q.args as string[])) as {
    animal_profile_id: string;
    event_type: string;
    event_date: string;
    created_at: string | null;
    pregnancy_status: string | null;
  }[]).map((r) => ({ ...r }));
  db.close();

  // Solo el tacto+ (synced no-borrado, tipo válido) + el birth del overlay. NO el destete borrado, NO el
  // tipo irrelevante, NO el evento de p2.
  assert.equal(rows.length, 2);
  // ORDER BY event_date ASC → tacto (05-20) antes que birth (05-25)
  assert.deepEqual(
    rows.map((r) => r.event_type),
    ['tacto', 'birth'],
  );
  // el overlay proyecta pregnancy_status NULL
  const birth = rows.find((r) => r.event_type === 'birth');
  assert.equal(birth?.pregnancy_status, null);
  const tacto = rows.find((r) => r.event_type === 'tacto');
  assert.equal(tacto?.pregnancy_status, 'large');
});

// ─── C6: buildRevertCategoryOverrideUpdate (RC6.4.3) ───────────────────────────────────

test('buildRevertCategoryOverrideUpdate: UN solo statement setea override=0 Y category_id, deleted_at IS NULL', () => {
  const q = buildRevertCategoryOverrideUpdate('prof-9', 'cat-derived');
  assert.match(
    q.sql,
    /^UPDATE animal_profiles SET category_override = 0, category_id = \? WHERE id = \? AND deleted_at IS NULL$/,
  );
  // ambas columnas en el MISMO UPDATE → una sola CrudEntry → un solo UPDATE PostgREST (0040 respeta revert)
  assert.deepEqual(q.args, ['cat-derived', 'prof-9']);
});

test('C6 RC6.3.5 (display-only): los builders del PATH de display son SELECT puros (cero INSERT/UPDATE/DELETE)', () => {
  // El espejo de display (animals.computeMirrorOverrides) usa SOLO estos dos builders + el SELECT de
  // detalle/lista. Ninguno muta. El único write del chunk es buildRevertCategoryOverrideUpdate, que NO
  // está en el path de display (lo dispara la acción explícita "Quitar fijación", RC6.4.3).
  const displayBuilders = [
    buildCategoryMirrorEventsQuery(['p1']),
    buildSystemCategoriesQuery('sys-1'),
    buildAnimalDetailQuery('p1'),
    buildAnimalsListQuery('est-1'),
  ];
  for (const q of displayBuilders) {
    assert.match(q.sql, /^\s*SELECT\b/i, 'el path de display arranca en SELECT');
    assert.doesNotMatch(q.sql, /\b(INSERT|UPDATE|DELETE)\b/i, 'el path de display NO muta nada');
  }
});

// ─── Lotes (T4.3) ────────────────────────────────────────────────────────────────────

test('buildManagementGroupsQuery: active=1 + deleted_at IS NULL + orden por nombre + overlay oculta soft_deleted', () => {
  const q = buildManagementGroupsQuery('est-2');
  assert.match(q.sql, /SELECT id, name FROM management_groups mg/);
  assert.match(q.sql, /WHERE mg\.establishment_id = \? AND mg\.active = 1 AND mg\.deleted_at IS NULL/);
  assert.match(q.sql, /ORDER BY name ASC/);
  // T6: oculta los lotes con un override soft_deleted pendiente.
  assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM pending_status_overrides pso WHERE pso\.target_table = 'management_groups' AND pso\.target_id = mg\.id AND pso\.effect IN \('soft_deleted'\)\)/);
  assert.deepEqual(q.args, ['est-2']);
});

// ─── Timeline (T4.2) — UNION ALL de los 7 orígenes ─────────────────────────────────

test('buildTimelineQuery: 7 orígenes sincronizados + 1 overlay (pending birth) UNION ALL, 8 placeholders = profileId', () => {
  const q = buildTimelineQuery('prof-1');
  // 7 UNION ALL = 8 sub-selects (7 sincronizados + 1 del overlay: el parto optimista, T6)
  assert.equal((q.sql.match(/UNION ALL/g) ?? []).length, 7);
  // los 7 event_kind exactos (mismos que la RPC 0069 / parseTimelineRow)
  for (const kind of [
    'weight',
    'reproductive',
    'sanitary',
    'condition_score',
    'lab_sample',
    'category_change',
    'observacion',
  ]) {
    assert.match(q.sql, new RegExp(`'${kind}' AS event_kind|'${kind}',`));
  }
  // las 7 tablas de origen sincronizadas + la overlay del parto optimista (T6)
  for (const tbl of [
    'weight_events',
    'reproductive_events',
    'sanitary_events',
    'condition_score_events',
    'lab_samples',
    'animal_category_history',
    'animal_events',
  ]) {
    assert.match(q.sql, new RegExp(`FROM ${tbl}\\b`));
  }
  // T6: el parto optimista viene de pending_reproductive_events como kind 'reproductive'
  assert.match(q.sql, /FROM pending_reproductive_events WHERE animal_profile_id = \?/);
  // 8 args, todos el profileId (7 sincronizados + 1 overlay)
  assert.deepEqual(q.args, ['prof-1', 'prof-1', 'prof-1', 'prof-1', 'prof-1', 'prof-1', 'prof-1', 'prof-1']);
});

test('buildTimelineQuery: event_date por origen fiel a 0069 + deleted_at salvo category_change', () => {
  const q = buildTimelineQuery('p');
  // weight → weight_date; lab_sample → collection_date; category/observacion → instante real
  assert.match(q.sql, /weight_date AS event_date/);
  assert.match(q.sql, /collection_date, created_at,/); // lab_sample event_date = collection_date
  assert.match(q.sql, /'category_change', id, changed_at, changed_at,/);
  assert.match(q.sql, /'observacion', id, created_at, created_at,/);
  // deleted_at IS NULL en los orígenes con soft-delete; animal_category_history NO lo tiene
  assert.match(q.sql, /FROM weight_events WHERE animal_profile_id = \? AND deleted_at IS NULL/);
  assert.match(q.sql, /FROM animal_category_history WHERE animal_profile_id = \? UNION ALL/);
  // NO re-scopea tenant
  assert.doesNotMatch(q.sql, /has_role_in/);
});

test('buildTimelineQuery: payload con json_object (las claves que parseTimelineRow lee)', () => {
  const q = buildTimelineQuery('p');
  assert.match(q.sql, /json_object\('weight_kg', weight_kg, 'source', source, 'notes', notes\)/);
  assert.match(q.sql, /json_object\('event_type', event_type, 'pregnancy_status', pregnancy_status, 'calf_id', calf_id, 'notes', notes\)/);
  assert.match(q.sql, /json_object\('sample_type', sample_type, 'tube_number', tube_number, 'result', result, 'received', result_received_date\)/);
  assert.match(q.sql, /json_object\('from', from_category_id, 'to', to_category_id, 'reason', reason\)/);
});

// TAREA 2 (fix flake estado repro): el ORDER BY debe ser event_date ASC, (created_at IS NULL) ASC,
// created_at ASC — el índice de la fila en este set es el `seq` (proxy del orden de inserción) que
// fetchTimeline asigna. Los NULL (CRUD-plano sin sellar = recién insertado = más reciente) van AL FINAL
// (seq mayor). Si vuelve a `event_date DESC` el desempate del estado repro caería al eventId UUID random.
test('buildTimelineQuery: ORDER BY event_date ASC, NULL-created_at al final, created_at ASC (fuente del seq)', () => {
  const q = buildTimelineQuery('p');
  // El ORDER BY va en un SELECT externo que envuelve el UNION (en un compound SQLite rechaza expresiones).
  assert.match(q.sql, /ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC/);
  assert.doesNotMatch(q.sql, /ORDER BY event_date DESC/);
  // El UNION sigue adentro (7 UNION ALL) y se envuelve en SELECT … FROM ( … ).
  assert.match(q.sql, /SELECT event_kind, event_id, event_date, created_at, payload FROM \(/);
});

// TAREA 2 — COMPORTAMIENTO: contra node:sqlite (tablas reales), el índice de la fila refleja el orden de
// inserción a igualdad de (event_date, created_at) — el caso REALISTA offline: tacto + parto el mismo día,
// ambos sin created_at sellado (NULL). El parto, insertado DESPUÉS, debe quedar con índice MAYOR ⇒ seq
// mayor ⇒ deriveCurrentState lo trata como posterior (espejo del índice de array de la categoría, RC6.1.4).
test('buildTimelineQuery: a igualdad de (event_date, created_at NULL) el insertado después queda con índice mayor', () => {
  const db = new DatabaseSync(':memory:');
  // Solo necesitamos reproductive_events (synced) + las tablas del UNION que el SQL toca; creamos todas
  // con las columnas mínimas que cada sub-select referencia para que el query no falle por columna ausente.
  db.exec(
    'CREATE TABLE weight_events (id TEXT, animal_profile_id TEXT, weight_date TEXT, created_at TEXT, weight_kg REAL, source TEXT, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, pregnancy_status TEXT, calf_id TEXT, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE sanitary_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, product_name TEXT, route TEXT, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE condition_score_events (id TEXT, animal_profile_id TEXT, event_date TEXT, created_at TEXT, score REAL, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE lab_samples (id TEXT, animal_profile_id TEXT, collection_date TEXT, created_at TEXT, sample_type TEXT, tube_number TEXT, result TEXT, result_received_date TEXT, deleted_at TEXT);' +
      'CREATE TABLE animal_category_history (id TEXT, animal_profile_id TEXT, changed_at TEXT, from_category_id TEXT, to_category_id TEXT, reason TEXT);' +
      'CREATE TABLE animal_events (id TEXT, animal_profile_id TEXT, created_at TEXT, event_type TEXT, text TEXT, structured_payload TEXT, author_id TEXT, edit_window_until TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, notes TEXT);',
  );
  const ins = db.prepare(
    'INSERT INTO reproductive_events (id, animal_profile_id, event_type, event_date, created_at, pregnancy_status) VALUES (?,?,?,?,?,?)',
  );
  // Insertamos el TACTO primero y el PARTO después, MISMO event_date, AMBOS created_at NULL (CRUD plano
  // local aún sin sellar). El id del tacto es lexicográficamente MAYOR a propósito (zzz > aaa): si el
  // desempate fuera por id, el tacto ganaría (el bug). Acá probamos que el ÍNDICE refleja la inserción.
  ins.run('t-zzz', 'p1', 'tacto', '2026-06-01', null, 'large');
  ins.run('b-aaa', 'p1', 'birth', '2026-06-01', null, null);

  const q = buildTimelineQuery('p1');
  const rows = (db.prepare(q.sql).all(...(q.args as string[])) as { event_id: string }[]).map((r) => ({
    ...r,
  }));
  db.close();

  // Ambas filas presentes; el PARTO (insertado después) queda DESPUÉS en el array → índice/seq mayor.
  const ids = rows.map((r) => r.event_id);
  assert.deepEqual(ids, ['t-zzz', 'b-aaa']);
  assert.ok(ids.indexOf('b-aaa') > ids.indexOf('t-zzz'), 'el parto (insertado después) tiene índice mayor');
});

// TAREA 2 — COMPORTAMIENTO (MIXED, el caso del e2e): un tacto YA SINCRONIZADO (created_at presente) + un
// parto/aborto recién cargado (created_at NULL). El NULL = recién insertado local = más reciente → el SQL
// lo ordena AL FINAL (NULLs-last) → seq mayor → deriveCurrentState lo trata como posterior ⇒ "Vacía".
test('buildTimelineQuery: created_at NULL (recién insertado) queda DESPUÉS del created_at presente (NULLs-last)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE weight_events (id TEXT, animal_profile_id TEXT, weight_date TEXT, created_at TEXT, weight_kg REAL, source TEXT, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, pregnancy_status TEXT, calf_id TEXT, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE sanitary_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, product_name TEXT, route TEXT, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE condition_score_events (id TEXT, animal_profile_id TEXT, event_date TEXT, created_at TEXT, score REAL, notes TEXT, deleted_at TEXT);' +
      'CREATE TABLE lab_samples (id TEXT, animal_profile_id TEXT, collection_date TEXT, created_at TEXT, sample_type TEXT, tube_number TEXT, result TEXT, result_received_date TEXT, deleted_at TEXT);' +
      'CREATE TABLE animal_category_history (id TEXT, animal_profile_id TEXT, changed_at TEXT, from_category_id TEXT, to_category_id TEXT, reason TEXT);' +
      'CREATE TABLE animal_events (id TEXT, animal_profile_id TEXT, created_at TEXT, event_type TEXT, text TEXT, structured_payload TEXT, author_id TEXT, edit_window_until TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, notes TEXT);',
  );
  const ins = db.prepare(
    'INSERT INTO reproductive_events (id, animal_profile_id, event_type, event_date, created_at, pregnancy_status) VALUES (?,?,?,?,?,?)',
  );
  // tacto YA synced (created_at presente) + birth recién cargado (created_at NULL), MISMO event_date.
  ins.run('t-zzz', 'p1', 'tacto', '2026-06-01', '2026-06-01T10:00:00Z', 'large');
  ins.run('b-aaa', 'p1', 'birth', '2026-06-01', null, null);

  const q = buildTimelineQuery('p1');
  const ids = (db.prepare(q.sql).all(...(q.args as string[])) as { event_id: string }[]).map((r) => r.event_id);
  db.close();

  // El birth (created_at NULL = recién insertado) va AL FINAL → índice mayor → gana en deriveCurrentState.
  assert.deepEqual(ids, ['t-zzz', 'b-aaa']);
  assert.ok(ids.indexOf('b-aaa') > ids.indexOf('t-zzz'), 'el NULL (recién insertado) queda al final (seq mayor)');
});

test('buildReproServiceTypesQuery: service_type por evento del perfil, deleted_at', () => {
  const q = buildReproServiceTypesQuery('p9');
  assert.match(q.sql, /SELECT id, service_type FROM reproductive_events WHERE animal_profile_id = \? AND deleted_at IS NULL/);
  assert.deepEqual(q.args, ['p9']);
});

test('buildCategoryNamesQuery: IN con un placeholder por id', () => {
  const q = buildCategoryNamesQuery(['c1', 'c2', 'c3']);
  assert.match(q.sql, /SELECT id, name FROM categories_by_system WHERE id IN \(\?, \?, \?\)/);
  assert.deepEqual(q.args, ['c1', 'c2', 'c3']);
});

// ─── Madre de un ternero (T4.2) ──────────────────────────────────────────────────────

test('buildMotherQuery: cadena birth_calves→parto→madre, b1 tag, sin filtro de status + UNION overlay (parto optimista)', () => {
  const q = buildMotherQuery('calf-5');
  assert.match(q.sql, /FROM birth_calves bc/);
  assert.match(q.sql, /JOIN reproductive_events re ON re\.id = bc\.birth_event_id AND re\.deleted_at IS NULL/);
  assert.match(q.sql, /JOIN animal_profiles m ON m\.id = re\.animal_profile_id/);
  // b1: tag de la madre desde animal_profiles, NO un JOIN a animals
  assert.match(q.sql, /m\.animal_tag_electronic AS tag_electronic/);
  assert.doesNotMatch(q.sql, /JOIN animals\b/);
  // R14.7/R4.15: NO filtra por status de la madre (puede estar archivada)
  assert.doesNotMatch(q.sql, /m\.status =/);
  // T6: rama overlay — el ternero optimista resuelve a su madre (sincronizada) vía pending_birth_calves
  assert.match(q.sql, /FROM pending_birth_calves pbc/);
  assert.match(q.sql, /JOIN pending_reproductive_events pre ON pre\.client_op_id = pbc\.client_op_id/);
  assert.match(q.sql, /WHERE pbc\.calf_profile_id = \?/);
  assert.match(q.sql, /UNION ALL/);
  assert.match(q.sql, /LIMIT 1/);
  assert.deepEqual(q.args, ['calf-5', 'calf-5']);
});

// ════════════════════════════════════════════════════════════════════════════════════
// ESCRITURA LOCAL — CRUD plano (T5 / R6.1, R6.3, R6.4)
// ════════════════════════════════════════════════════════════════════════════════════
//
// Verifican: tabla correcta, columnas + placeholders alineados, el id de cliente va primero, los
// literales de event_type/active embebidos, y que NO se filtra establishment_id/created_by en los
// eventos (los fuerza el trigger al subir) salvo animal_events (excepción de validación). El ORDEN
// de los args debe matchear el ORDEN de los `?` del SQL (un bug clásico de INSERTs por posición).

// ─── eventos (T5.1) ──────────────────────────────────────────────────────────────────

test('buildAddWeightInsert: INSERT weight_events, id cliente primero, sin establishment_id/created_by', () => {
  const q = buildAddWeightInsert('w-id', 'prof-1', 320.5, '2026-06-09', 'gorda');
  assert.match(
    q.sql,
    /^INSERT INTO weight_events \(id, animal_profile_id, weight_kg, weight_date, notes\) VALUES \(\?, \?, \?, \?, \?\)$/,
  );
  // los triggers/defaults ponen estos al subir → NO van en el INSERT local
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /created_by/);
  assert.doesNotMatch(q.sql, /\bsource\b/);
  // args en el ORDEN exacto de los placeholders
  assert.deepEqual(q.args, ['w-id', 'prof-1', 320.5, '2026-06-09', 'gorda']);
});

test('buildAddWeightInsert: notes null se preserva (columna nullable, no se omite la posición)', () => {
  const q = buildAddWeightInsert('w2', 'p', 100, '2026-01-01', null);
  // 5 placeholders SIEMPRE (no se "saltea" notes según presencia → el INSERT por posición no se corre)
  assert.equal((q.sql.match(/\?/g) ?? []).length, 5);
  assert.deepEqual(q.args, ['w2', 'p', 100, '2026-01-01', null]);
});

test('buildAddConditionScoreInsert: INSERT condition_score_events, score, sin establishment_id', () => {
  const q = buildAddConditionScoreInsert('cs-1', 'prof-2', 3.25, '2026-06-09', null);
  assert.match(
    q.sql,
    /^INSERT INTO condition_score_events \(id, animal_profile_id, score, event_date, notes\) VALUES \(\?, \?, \?, \?, \?\)$/,
  );
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.deepEqual(q.args, ['cs-1', 'prof-2', 3.25, '2026-06-09', null]);
});

// TAREA 2: los INSERT de reproductive_events setean `created_at` de CLIENTE (último arg) → instante real
// de creación para que deriveCurrentState desempate los eventos del mismo event_date determinísticamente.
const CA = '2026-06-09T12:00:00.000Z';

test('buildAddTactoInsert: INSERT reproductive_events con event_type literal tacto + pregnancy_status + created_at de cliente', () => {
  const q = buildAddTactoInsert('t-1', 'prof-3', 'pregnant', '2026-06-09', 'ok', CA);
  assert.match(
    q.sql,
    /^INSERT INTO reproductive_events \(id, animal_profile_id, event_type, event_date, pregnancy_status, notes, created_at\) VALUES \(\?, \?, 'tacto', \?, \?, \?, \?\)$/,
  );
  // event_type es literal embebido (no placeholder) → los args NO lo incluyen
  assert.doesNotMatch(q.sql, /service_type/);
  assert.deepEqual(q.args, ['t-1', 'prof-3', '2026-06-09', 'pregnant', 'ok', CA]);
});

test('buildAddServiceInsert: INSERT reproductive_events con event_type literal service + service_type + created_at de cliente', () => {
  const q = buildAddServiceInsert('s-1', 'prof-4', 'natural', '2026-06-09', null, CA);
  assert.match(
    q.sql,
    /^INSERT INTO reproductive_events \(id, animal_profile_id, event_type, event_date, service_type, notes, created_at\) VALUES \(\?, \?, 'service', \?, \?, \?, \?\)$/,
  );
  assert.doesNotMatch(q.sql, /pregnancy_status/);
  assert.deepEqual(q.args, ['s-1', 'prof-4', '2026-06-09', 'natural', null, CA]);
});

test('buildAddAbortionInsert: INSERT reproductive_events con event_type literal abortion, sin status/type + created_at de cliente', () => {
  const q = buildAddAbortionInsert('a-1', 'prof-5', '2026-06-09', 'perdió', CA);
  assert.match(
    q.sql,
    /^INSERT INTO reproductive_events \(id, animal_profile_id, event_type, event_date, notes, created_at\) VALUES \(\?, \?, 'abortion', \?, \?, \?\)$/,
  );
  assert.doesNotMatch(q.sql, /pregnancy_status/);
  assert.doesNotMatch(q.sql, /service_type/);
  assert.deepEqual(q.args, ['a-1', 'prof-5', '2026-06-09', 'perdió', CA]);
});

test('buildAddObservationInsert: animal_events SÍ lleva establishment_id (excepción de validación)', () => {
  const q = buildAddObservationInsert('o-1', 'prof-6', 'est-9', 'algo raro');
  assert.match(
    q.sql,
    /^INSERT INTO animal_events \(id, animal_profile_id, establishment_id, event_type, text\) VALUES \(\?, \?, \?, 'observacion', \?\)$/,
  );
  // author_id/edit_window_until los pone el trigger/default → NO van
  assert.doesNotMatch(q.sql, /author_id/);
  assert.doesNotMatch(q.sql, /edit_window_until/);
  assert.deepEqual(q.args, ['o-1', 'prof-6', 'est-9', 'algo raro']);
});

// ─── lotes (T5.2) ──────────────────────────────────────────────────────────────────

test('buildCreateManagementGroupInsert: INSERT con active=1 literal, id+establishment+name', () => {
  const q = buildCreateManagementGroupInsert('g-1', 'est-3', 'Rodeo Norte');
  assert.match(
    q.sql,
    /^INSERT INTO management_groups \(id, establishment_id, name, active\) VALUES \(\?, \?, \?, 1\)$/,
  );
  // active es literal 1 (para que la lista local que filtra active=1 lo vea al instante) → no es arg
  assert.deepEqual(q.args, ['g-1', 'est-3', 'Rodeo Norte']);
});

test('buildRenameManagementGroupUpdate: UPDATE name, filtra deleted_at IS NULL, sin count', () => {
  const q = buildRenameManagementGroupUpdate('g-2', 'Nuevo nombre');
  assert.equal(q.sql, 'UPDATE management_groups SET name = ? WHERE id = ? AND deleted_at IS NULL');
  // args en orden de los placeholders: name (SET) antes que id (WHERE)
  assert.deepEqual(q.args, ['Nuevo nombre', 'g-2']);
});

test('buildAssignAnimalToGroupUpdate: UPDATE management_group_id, filtra deleted_at, acepta null (quitar)', () => {
  const q = buildAssignAnimalToGroupUpdate('prof-8', 'g-3');
  assert.equal(
    q.sql,
    'UPDATE animal_profiles SET management_group_id = ? WHERE id = ? AND deleted_at IS NULL',
  );
  assert.deepEqual(q.args, ['g-3', 'prof-8']);
  // null = QUITAR del lote (vuelve a agruparse por categoría)
  const qn = buildAssignAnimalToGroupUpdate('prof-8', null);
  assert.deepEqual(qn.args, [null, 'prof-8']);
});

// ════════════════════════════════════════════════════════════════════════════════════
// OUTBOX + OVERLAY — escritura offline RPC-bound (T6 / R6.8–R6.12)
// ════════════════════════════════════════════════════════════════════════════════════

test('buildClearGroupMembersUpdate: reasigna a NULL TODOS los perfiles del lote (sin filtro de status)', () => {
  const q = buildClearGroupMembersUpdate('g-9');
  assert.equal(q.sql, 'UPDATE animal_profiles SET management_group_id = NULL WHERE management_group_id = ?');
  assert.deepEqual(q.args, ['g-9']);
});

test('buildCategoryIdByCodeQuery: category_id por (system, code) ACTIVO, LIMIT 1', () => {
  const q = buildCategoryIdByCodeQuery('sys-1', 'multipara');
  assert.match(q.sql, /SELECT id FROM categories_by_system WHERE system_id = \? AND code = \? AND active = 1 LIMIT 1/);
  assert.deepEqual(q.args, ['sys-1', 'multipara']);
});

test('buildCategoryByCodeQuery: id + name por (system, code) ACTIVO, LIMIT 1 (RC6.4.6)', () => {
  // Hermano de buildCategoryIdByCodeQuery que ADEMÁS proyecta el name legible — lo usa la resolución
  // compartida del revert (preview de la consecuencia + UPDATE). Mismo filtro (active=1), SELECT puro.
  const q = buildCategoryByCodeQuery('sys-1', 'vaquillona');
  assert.match(q.sql, /SELECT id, name FROM categories_by_system WHERE system_id = \? AND code = \? AND active = 1 LIMIT 1/);
  assert.deepEqual(q.args, ['sys-1', 'vaquillona']);
});

test('buildRodeoSpeciesQuery: species_id del rodeo, LIMIT 1', () => {
  const q = buildRodeoSpeciesQuery('rod-7');
  assert.match(q.sql, /SELECT species_id FROM rodeos WHERE id = \? LIMIT 1/);
  assert.deepEqual(q.args, ['rod-7']);
});

test('buildBirthOverlayContextQuery: est+rodeo de la madre + species/system del rodeo, deleted_at, LIMIT 1', () => {
  const q = buildBirthOverlayContextQuery('mother-1');
  assert.match(q.sql, /ap\.establishment_id AS establishment_id, ap\.rodeo_id AS rodeo_id/);
  assert.match(q.sql, /r\.species_id AS species_id, r\.system_id AS system_id/);
  assert.match(q.sql, /FROM animal_profiles ap JOIN rodeos r ON r\.id = ap\.rodeo_id/);
  assert.match(q.sql, /WHERE ap\.id = \? AND ap\.deleted_at IS NULL LIMIT 1/);
  assert.deepEqual(q.args, ['mother-1']);
});

test('buildOpIntentInsert: id=client_op_id + op_type + params_json + created_at', () => {
  const q = buildOpIntentInsert('cop-1', 'register_birth', '{"p_mother_profile_id":"m1"}', '2026-06-09T00:00:00.000Z');
  assert.equal(q.sql, 'INSERT INTO op_intents (id, op_type, params_json, created_at) VALUES (?, ?, ?, ?)');
  assert.deepEqual(q.args, ['cop-1', 'register_birth', '{"p_mother_profile_id":"m1"}', '2026-06-09T00:00:00.000Z']);
});

test('buildPendingAnimalInsert: pending_animals con identidad + client_op_id', () => {
  const q = buildPendingAnimalInsert('a-1', 'cop-1', {
    tagElectronic: '982000000000001', speciesId: 'sp-1', sex: 'female', birthDate: '2026-06-01',
  });
  assert.match(q.sql, /INSERT INTO pending_animals \(id, client_op_id, tag_electronic, species_id, sex, birth_date\)/);
  assert.deepEqual(q.args, ['a-1', 'cop-1', '982000000000001', 'sp-1', 'female', '2026-06-01']);
});

const PROFILE_FIELDS: PendingProfileFields = {
  animalId: 'a-1',
  establishmentId: 'est-1',
  rodeoId: 'rod-1',
  managementGroupId: null,
  idv: '0320',
  visualIdAlt: null,
  categoryId: 'cat-1',
  categoryOverride: true,
  breed: 'angus',
  coatColor: 'negro',
  entryDate: '2026-06-01',
  entryWeight: 180,
  status: 'active',
  createdBy: null,
  animalTagElectronic: '982000000000001',
  animalSex: 'female',
  animalBirthDate: '2026-06-01',
  createdAt: '2026-06-09T00:00:00.000Z',
};

test('buildPendingAnimalProfileInsert: 20 columnas, category_override 1/0, identidad b1 denormalizada', () => {
  const q = buildPendingAnimalProfileInsert('p-1', 'cop-1', PROFILE_FIELDS);
  // 20 placeholders
  assert.equal((q.sql.match(/\?/g) ?? []).length, 20);
  assert.equal(q.args.length, 20);
  // id, client_op_id primero; category_override → 1 (true)
  assert.equal(q.args[0], 'p-1');
  assert.equal(q.args[1], 'cop-1');
  assert.equal(q.args[9], 1); // category_override true → 1
  // identidad denormalizada (b1) para que el UNION de lectura la muestre
  assert.match(q.sql, /animal_tag_electronic, animal_sex, animal_birth_date/);
  assert.deepEqual(q.args.slice(16, 19), ['982000000000001', 'female', '2026-06-01']);
});

test('buildPendingAnimalProfileInsert: category_override false → 0', () => {
  const q = buildPendingAnimalProfileInsert('p-2', 'cop-2', { ...PROFILE_FIELDS, categoryOverride: false });
  assert.equal(q.args[9], 0);
});

test('buildPendingReproductiveEventInsert: el parto optimista con animal_profile_id + event_type', () => {
  const q = buildPendingReproductiveEventInsert('e-1', 'cop-1', {
    animalProfileId: 'mother-1', eventType: 'birth', eventDate: '2026-06-09', notes: null, createdAt: 't',
  });
  assert.match(q.sql, /INSERT INTO pending_reproductive_events \(id, client_op_id, animal_profile_id, event_type, event_date, notes, created_at\)/);
  assert.deepEqual(q.args, ['e-1', 'cop-1', 'mother-1', 'birth', '2026-06-09', null, 't']);
});

test('buildPendingBirthCalfInsert: puente parto→ternero del overlay', () => {
  const q = buildPendingBirthCalfInsert('bc-1', 'cop-1', 'e-1', 'calf-prof-1');
  assert.match(q.sql, /INSERT INTO pending_birth_calves \(id, client_op_id, birth_event_id, calf_profile_id\)/);
  assert.deepEqual(q.args, ['bc-1', 'cop-1', 'e-1', 'calf-prof-1']);
});

test('buildPendingStatusOverrideInsert: override exited/soft_deleted con target + status + exit_date (residual #2)', () => {
  // exit con fecha → el badge "Vendido el {fecha}" funciona offline.
  const exit = buildPendingStatusOverrideInsert('o-1', 'cop-1', 'animal_profiles', 'prof-9', 'exited', 'sold', '2026-06-09');
  assert.match(exit.sql, /INSERT INTO pending_status_overrides \(id, client_op_id, target_table, target_id, effect, status, exit_date\)/);
  assert.match(exit.sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?\)/);
  assert.deepEqual(exit.args, ['o-1', 'cop-1', 'animal_profiles', 'prof-9', 'exited', 'sold', '2026-06-09']);
  // soft_delete: sin exit_date → default null (no aplica).
  const del = buildPendingStatusOverrideInsert('o-2', 'cop-2', 'management_groups', 'g-1', 'soft_deleted', null);
  assert.deepEqual(del.args, ['o-2', 'cop-2', 'management_groups', 'g-1', 'soft_deleted', null, null]);
});

test('buildPendingRodeoInsert: pending_rodeos con id de cliente + active=1 literal (Run T9.8)', () => {
  const q = buildPendingRodeoInsert('rod-1', 'cop-1', {
    establishmentId: 'est-1', name: 'Rodeo principal', speciesId: 'sp-1', systemId: 'sys-1',
    createdAt: '2026-06-09T00:00:00.000Z',
  });
  assert.match(
    q.sql,
    /INSERT INTO pending_rodeos \(id, client_op_id, establishment_id, name, species_id, system_id, active, created_at\) VALUES \(\?, \?, \?, \?, \?, \?, 1, \?\)/,
  );
  // active = 1 es LITERAL en el SQL (no es arg) → 7 placeholders, 7 args.
  assert.equal((q.sql.match(/\?/g) ?? []).length, 7);
  assert.deepEqual(q.args, ['rod-1', 'cop-1', 'est-1', 'Rodeo principal', 'sp-1', 'sys-1', '2026-06-09T00:00:00.000Z']);
});

test('buildPendingRodeoConfigInsert: una fila de la plantilla optimista, enabled 1/0 (Run T9.8)', () => {
  const on = buildPendingRodeoConfigInsert('cfg-1', 'cop-1', 'rod-1', 'fd-prenez', true);
  assert.match(
    on.sql,
    /INSERT INTO pending_rodeo_data_config \(id, client_op_id, rodeo_id, field_definition_id, enabled\) VALUES \(\?, \?, \?, \?, \?\)/,
  );
  assert.deepEqual(on.args, ['cfg-1', 'cop-1', 'rod-1', 'fd-prenez', 1]);
  const off = buildPendingRodeoConfigInsert('cfg-2', 'cop-1', 'rod-1', 'fd-insem', false);
  assert.deepEqual(off.args, ['cfg-2', 'cop-1', 'rod-1', 'fd-insem', 0]);
});

test('buildDeletePendingRodeoConfig: DELETE por (rodeo_id, field_definition_id), 2 placeholders (delete-prior, fix rowid (Run T9.9 follow-up, 2026-06-09))', () => {
  const q = buildDeletePendingRodeoConfig('rod-1', 'fd-prenez');
  assert.equal(q.sql, 'DELETE FROM pending_rodeo_data_config WHERE rodeo_id = ? AND field_definition_id = ?');
  assert.equal((q.sql.match(/\?/g) ?? []).length, 2);
  assert.deepEqual(q.args, ['rod-1', 'fd-prenez']);
});

test('buildClearOverlayDelete: DELETE por client_op_id en la tabla pending_* dada', () => {
  const q = buildClearOverlayDelete('pending_animal_profiles', 'cop-1');
  assert.equal(q.sql, 'DELETE FROM pending_animal_profiles WHERE client_op_id = ?');
  assert.deepEqual(q.args, ['cop-1']);
  // Run T9.8: también limpia el overlay del alta de rodeo.
  const rodeo = buildClearOverlayDelete('pending_rodeos', 'cop-2');
  assert.equal(rodeo.sql, 'DELETE FROM pending_rodeos WHERE client_op_id = ?');
});

test('PENDING_OVERLAY_TABLES: las 7 tablas overlay (para clear/rollback por client_op_id)', () => {
  assert.deepEqual([...PENDING_OVERLAY_TABLES].sort(), [
    'pending_animal_profiles',
    'pending_animals',
    'pending_birth_calves',
    'pending_reproductive_events',
    'pending_rodeo_data_config',
    'pending_rodeos',
    'pending_status_overrides',
  ]);
});

// ─── spec 10 (T-CL.8/T-CL.11/T-CL.13): builders de las operaciones masivas + castración/futuro torito ──

test('T-CL.8 / R3.1: buildAddVaccinationInsert — sanitary_events vaccination, campaign_id NO se manda (NULL as-built)', () => {
  const q = buildAddVaccinationInsert('id-1', 'p-1', 'Aftosa', 'subcutánea', '2026-06-11');
  assert.match(q.sql, /INSERT INTO sanitary_events/);
  assert.match(q.sql, /'vaccination'/);
  // campaign_id NO está en la lista de columnas → queda NULL (sanitary_campaigns no existe, design §2.2).
  assert.ok(!/campaign_id/.test(q.sql), 'no debe setear campaign_id (NULL as-built)');
  // author_id/created_by/created_at/establishment_id NO se mandan (los fuerza el trigger al subir).
  for (const forbidden of ['author_id', 'created_by', 'created_at', 'establishment_id']) {
    assert.ok(!new RegExp(forbidden).test(q.sql), `no debe setear ${forbidden} (trigger server-side)`);
  }
  assert.deepEqual(q.args, ['id-1', 'p-1', 'Aftosa', 'subcutánea', '2026-06-11']);
});

test('T-CL.8 / R3.2: buildAddWeaningInsert — reproductive_events weaning con created_at de cliente', () => {
  const q = buildAddWeaningInsert('id-1', 'p-1', '2026-06-11', '2026-06-11T10:00:00.000Z');
  assert.match(q.sql, /INSERT INTO reproductive_events/);
  assert.match(q.sql, /'weaning'/);
  // created_at SÍ va (desempate del mismo event_date, banner reproductive_events); el resto por trigger.
  assert.match(q.sql, /created_at/);
  assert.ok(!/established_id|author_id|created_by/.test(q.sql));
  assert.deepEqual(q.args, ['id-1', 'p-1', '2026-06-11', '2026-06-11T10:00:00.000Z']);
});

test('T-CL.11 / R3.3+R12.4: buildSetCastratedUpdate(true) — is_castrated=1 Y future_bull=0 (auto-clear) en UN statement', () => {
  const q = buildSetCastratedUpdate('p-1', true);
  assert.match(q.sql, /UPDATE animal_profiles SET is_castrated = 1, future_bull = 0/);
  assert.match(q.sql, /WHERE id = \? AND deleted_at IS NULL/);
  assert.deepEqual(q.args, ['p-1']);
});

test('T-CL.11 / R13.4: buildSetCastratedUpdate(false) — solo is_castrated=0, NO toca future_bull (revert)', () => {
  const q = buildSetCastratedUpdate('p-1', false);
  assert.match(q.sql, /UPDATE animal_profiles SET is_castrated = 0/);
  assert.ok(!/future_bull/.test(q.sql), 'el revert NO debe tocar future_bull (vuelve a entero, conserva ⭐)');
  assert.deepEqual(q.args, ['p-1']);
});

test('T-CL.11 / R12.2: buildSetFutureBullUpdate — solo future_bull, sin tocar is_castrated', () => {
  const on = buildSetFutureBullUpdate('p-1', true);
  assert.match(on.sql, /UPDATE animal_profiles SET future_bull = \?/);
  assert.ok(!/is_castrated/.test(on.sql), 'setFutureBull NO debe tocar is_castrated');
  assert.deepEqual(on.args, [1, 'p-1']);
  const off = buildSetFutureBullUpdate('p-1', false);
  assert.deepEqual(off.args, [0, 'p-1']);
});

test('T-CL.13 / R13.7: la observación de castración (buildAddObservationInsert) NUNCA manda author_id', () => {
  // Invariante de seguridad DURA (SEC-SPEC-03): author_id lo fuerza el trigger 0034 al subir.
  const q = buildAddObservationInsert('obs-1', 'p-1', 'est-A', 'Castrado');
  assert.ok(!/author_id/.test(q.sql), 'author_id NUNCA en el payload del cliente (lo fuerza el trigger)');
  // establishment_id SÍ va, derivado del PERFIL (el caller lo resuelve), event_type 'observacion'.
  assert.match(q.sql, /establishment_id/);
  assert.match(q.sql, /'observacion'/);
  assert.deepEqual(q.args, ['obs-1', 'p-1', 'est-A', 'Castrado']);
});

test('T-CL.13: buildProfileEstablishmentQuery / buildProfileEstablishmentsQuery — establishment del PERFIL (no inventado)', () => {
  const one = buildProfileEstablishmentQuery('p-1');
  assert.match(one.sql, /SELECT establishment_id FROM animal_profiles WHERE id = \?/);
  assert.deepEqual(one.args, ['p-1']);
  const many = buildProfileEstablishmentsQuery(['p-1', 'p-2']);
  assert.match(many.sql, /SELECT id, establishment_id FROM animal_profiles WHERE id IN \(\?, \?\)/);
  assert.deepEqual(many.args, ['p-1', 'p-2']);
});

test('T-CL.8 / R6.3: buildExistingVaccinationIdsQuery — ids de vacunaciones ya aplicadas (barrera idempotente)', () => {
  const q = buildExistingVaccinationIdsQuery(['p-1', 'p-2'], '2026-06-11');
  assert.match(q.sql, /SELECT id FROM sanitary_events/);
  assert.match(q.sql, /'vaccination'/);
  assert.match(q.sql, /animal_profile_id IN \(\?, \?\)/);
  assert.match(q.sql, /event_date = \?/);
  assert.match(q.sql, /deleted_at IS NULL/);
  assert.deepEqual(q.args, ['p-1', 'p-2', '2026-06-11']);
});

test('T-CL.8 / R6.3: buildExistingWeaningIdsQuery — ids de destetes ya aplicados', () => {
  const q = buildExistingWeaningIdsQuery(['p-1'], '2026-06-11');
  assert.match(q.sql, /SELECT id FROM reproductive_events/);
  assert.match(q.sql, /'weaning'/);
  assert.match(q.sql, /deleted_at IS NULL/);
  assert.deepEqual(q.args, ['p-1', '2026-06-11']);
});

// Ejecución REAL contra SQLite in-memory: castración(true) ⇒ is_castrated=1, future_bull=0; (false) ⇒
// is_castrated=0 sin tocar future_bull (T-CL.10/T-CL.13 — no-op y simetría verificados contra la columna).
test('T-CL.11: setCastrated statements ejecutan correctamente contra SQLite (is_castrated/future_bull reales)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, is_castrated INTEGER DEFAULT 0, future_bull INTEGER DEFAULT 0, deleted_at TEXT);',
  );
  db.exec("INSERT INTO animal_profiles (id, is_castrated, future_bull) VALUES ('p-1', 0, 1);");

  // Castrar: is_castrated→1, future_bull→0 (auto-clear).
  const up = buildSetCastratedUpdate('p-1', true);
  db.prepare(up.sql).run(...(up.args as never[]));
  let row = db.prepare('SELECT is_castrated, future_bull FROM animal_profiles WHERE id = ?').get('p-1') as {
    is_castrated: number; future_bull: number;
  };
  assert.equal(row.is_castrated, 1);
  assert.equal(row.future_bull, 0);

  // Re-castrar (re-ejecución): no-op por valor (sigue 1/0) — la idempotencia semántica de la castración.
  db.prepare(up.sql).run(...(up.args as never[]));
  row = db.prepare('SELECT is_castrated, future_bull FROM animal_profiles WHERE id = ?').get('p-1') as never;
  assert.equal(row.is_castrated, 1);

  // Revertir: is_castrated→0, future_bull NO se toca (sigue 0 acá, pero el statement no lo menciona).
  const down = buildSetCastratedUpdate('p-1', false);
  db.prepare(down.sql).run(...(down.args as never[]));
  row = db.prepare('SELECT is_castrated, future_bull FROM animal_profiles WHERE id = ?').get('p-1') as never;
  assert.equal(row.is_castrated, 0);

  db.close();
});

// ─── buildGroupCandidateFlagsQuery (spec 10, T-UI.4): flags de candidatura de la selección ───────────

// Ejecución REAL contra SQLite in-memory: verifica is_castrated/category_override pass-through +
// has_weaning = EXISTS un weaning NO borrado (synced) o pending overlay; el weaning borrado NO cuenta.
test('T-UI.4: buildGroupCandidateFlagsQuery — has_weaning sincronizado, pending y borrado', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, is_castrated INTEGER DEFAULT 0, category_override INTEGER DEFAULT 0);',
  );
  db.exec(
    'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, deleted_at TEXT);',
  );
  db.exec(
    'CREATE TABLE pending_reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT);',
  );
  // p-1: weaning sincronizado vivo → has_weaning=1. is_castrated=1, override=1.
  // p-2: weaning sincronizado BORRADO (deleted_at) → NO cuenta → has_weaning=0.
  // p-3: weaning en el overlay pending → has_weaning=1.
  // p-4: sin nada → has_weaning=0.
  db.exec(
    "INSERT INTO animal_profiles (id, is_castrated, category_override) VALUES " +
      "('p-1', 1, 1), ('p-2', 0, 0), ('p-3', 0, 0), ('p-4', 0, 0);",
  );
  db.exec(
    "INSERT INTO reproductive_events (id, animal_profile_id, event_type, deleted_at) VALUES " +
      "('e1', 'p-1', 'weaning', NULL), ('e2', 'p-2', 'weaning', '2026-06-01T00:00:00Z');",
  );
  db.exec(
    "INSERT INTO pending_reproductive_events (id, animal_profile_id, event_type) VALUES " +
      "('pe1', 'p-3', 'weaning');",
  );

  const q = buildGroupCandidateFlagsQuery(['p-1', 'p-2', 'p-3', 'p-4']);
  const rows = db.prepare(q.sql).all(...(q.args as never[])) as {
    id: string; is_castrated: number; category_override: number; has_weaning: number;
  }[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  assert.equal(byId.get('p-1')!.is_castrated, 1);
  assert.equal(byId.get('p-1')!.category_override, 1);
  assert.equal(byId.get('p-1')!.has_weaning, 1); // weaning vivo
  assert.equal(byId.get('p-2')!.has_weaning, 0); // weaning BORRADO no cuenta
  assert.equal(byId.get('p-3')!.has_weaning, 1); // weaning pending
  assert.equal(byId.get('p-4')!.has_weaning, 0); // sin weaning

  db.close();
});
