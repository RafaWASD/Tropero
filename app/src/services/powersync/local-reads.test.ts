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
  buildActiveRoleQuery,
  buildMembershipsQuery,
  buildOwnPhoneQuery,
  buildOwnNameQuery,
  buildOwnEmailPhoneQuery,
  buildEstablishmentDetailQuery,
  buildBreedCatalogQuery,
  buildCountActiveMembersQuery,
  buildMembersQuery,
  buildCountOtherMembersQuery,
  buildCountPendingInvitationsQuery,
  buildPendingInvitationsQuery,
  buildAnimalsListQuery,
  buildNoTagCandidatesCountQuery,
  buildAnimalsCountQuery,
  buildRodeoHeadCountsQuery,
  buildGroupHeadCountsQuery,
  buildSearchByTagQuery,
  buildLookupTagAcrossFieldsQuery,
  buildSearchByIdvQuery,
  buildSearchLikeQuery,
  buildApodoSearchQuery,
  buildApodoListQuery,
  escapeLike,
  buildAnimalDetailQuery,
  buildCategoryMirrorEventsQuery,
  buildReproBadgeEventsQuery,
  buildSessionEmptyFemalesQuery,
  buildRevertCategoryOverrideUpdate,
  buildSetCategoryOverrideUpdate,
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
  // M3.1 — write-paths de las maniobras restantes (spec 03)
  buildAddManeuverSanitaryInsert,
  buildUpdateManeuverSanitary,
  buildAddManeuverVaccinationInsert,
  buildAddManeuverConditionScoreInsert,
  buildUpdateManeuverConditionScore,
  buildAddManeuverTactoVaquillonaInsert,
  buildAddTactoVaquillonaInsert,
  buildUpdateManeuverTactoVaquillona,
  buildAddManeuverInseminationInsert,
  buildUpdateManeuverInsemination,
  buildAddManeuverLabSampleInsert,
  buildUpdateManeuverLabSample,
  buildSetTeethStateUpdate,
  buildSetCutUpdate,
  buildUnsetCutUpdate,
  buildSetBreedUpdate,
  buildSetIdvUpdate,
  // M6 — circunferencia escrotal (spec 03 US-14)
  buildAddScrotalInsert,
  buildUpdateManeuverScrotal,
  buildScrotalHistoryQuery,
  buildSetCastratedUpdate,
  buildSetFutureBullUpdate,
  buildSoftDeleteEventUpdate,
  DELETABLE_EVENT_TABLE,
  // delta tratamientos (spec 02) — writes CRUD-plano + lecturas
  buildStartTreatmentInsert,
  buildRegisterApplicationInsert,
  buildFinalizeTreatmentUpdate,
  buildAnimalTreatmentsQuery,
  buildTreatmentApplicationsQuery,
  buildExistingVaccinationIdsQuery,
  buildExistingWeaningIdsQuery,
  buildProfileEstablishmentQuery,
  buildProfileEstablishmentsQuery,
  buildGroupCandidateFlagsQuery,
  // DELTA rodeo-grande (spec 10): builders de la vista de grupo scopeada + paginada
  buildGroupAnimalsPageQuery,
  buildAllGroupMembersQuery,
  buildGroupCandidateCountsQuery,
  buildGroupCategoryOptionsQuery,
  buildGroupSexOptionsQuery,
  buildGroupRodeoIdsQuery,
  type GroupScope,
  type GroupPageCursor,
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
  buildPendingRodeoServiceMonthsInsert,
  buildDeletePendingRodeoServiceMonths,
  buildClearOverlayDelete,
  PENDING_OVERLAY_TABLES,
  type PendingProfileFields,
} from './local-reads.ts';
// DELTA rodeo-grande (T-RG.17): el gating es PURO (applyCandidateGating/resolveGroupActions) sobre los conteos
// que devuelve buildGroupCandidateCountsQuery — se testea la COMPOSICIÓN (COUNT SQL → gating) sin el SDK.
import { applyCandidateGating, resolveGroupActions } from '../../utils/group-actions.ts';

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

test('buildFieldCatalogQuery: filtro de dominio active=1 + deleted_at IS NULL (M7 R13.19), sin args, columnas as-built', () => {
  const q = buildFieldCatalogQuery();
  assert.match(q.sql, /FROM field_definitions/);
  assert.match(q.sql, /WHERE active = 1 AND deleted_at IS NULL/);
  // columnas exactas que el mapper toFieldDefinition consume (M7 sumó establishment_id + config_schema:
  // discriminar fila custom para el ⋯ R13.29 + precargar opciones del editor).
  assert.match(q.sql, /id, establishment_id, data_key, label, description, category, data_type, ui_component, config_schema/);
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
  assert.match(q.sql, /id, establishment_id, name, species_id, system_id, active/);
  // T6: oculta los rodeos con un override soft_deleted pendiente (rama synced y overlay).
  assert.match(q.sql, /NOT EXISTS \(SELECT 1 FROM pending_status_overrides pso WHERE pso\.target_table = 'rodeos' AND pso\.target_id = rd\.id AND pso\.effect IN \('soft_deleted'\)\)/);
  // Run T9.8: UNIONa los rodeos alta-optimistas (pending_rodeos) → el rodeo offline aparece en la lista.
  assert.match(q.sql, /FROM pending_rodeos pr/);
  assert.match(q.sql, /WHERE pr\.establishment_id = \? AND pr\.active = 1/);
  assert.match(q.sql, /pso\.target_id = pr\.id AND pso\.effect IN \('soft_deleted'\)/);
  // spec 03 Stream B / B1: service_months en AMBAS ramas. Synced = COALESCE del overlay de edición
  // (pending_rodeo_service_months PISA rd.service_months); overlay del alta = pr.service_months directo.
  assert.match(
    q.sql,
    /COALESCE\(\(SELECT prsm\.service_months FROM pending_rodeo_service_months prsm WHERE prsm\.rodeo_id = rd\.id\), rd\.service_months\) AS service_months/,
  );
  assert.match(q.sql, /system_id, active, service_months, created_at FROM pending_rodeos pr/);
  assert.deepEqual(q.args, ['est-1', 'est-1']);
});

// COMPORTAMIENTO sobre node:sqlite — el overlay de la EDICIÓN PISA service_months de la fila synced (RPSC.3.4).
test('buildRodeosQuery (comportamiento): la EDICIÓN optimista PISA service_months del rodeo synced (COALESCE)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE rodeos (id TEXT, establishment_id TEXT, name TEXT, species_id TEXT, system_id TEXT, active INTEGER, service_months TEXT, deleted_at TEXT, created_at TEXT);' +
      'CREATE TABLE pending_rodeos (id TEXT, client_op_id TEXT, establishment_id TEXT, name TEXT, species_id TEXT, system_id TEXT, active INTEGER, service_months TEXT, created_at TEXT);' +
      'CREATE TABLE pending_rodeo_service_months (id TEXT, client_op_id TEXT, rodeo_id TEXT, service_months TEXT);' +
      'CREATE TABLE pending_status_overrides (id TEXT, client_op_id TEXT, target_table TEXT, target_id TEXT, effect TEXT, status TEXT, exit_date TEXT);',
  );
  // Rodeo synced con primavera persistida.
  db.exec(
    "INSERT INTO rodeos (id, establishment_id, name, species_id, system_id, active, service_months, deleted_at, created_at) " +
      "VALUES ('r1', 'e1', 'Rodeo A', 's1', 'sys1', 1, '[10,11,12]', NULL, '2026-01-01')",
  );
  const q1 = buildRodeosQuery('e1');
  const before = db.prepare(q1.sql).all(...(q1.args as string[])) as { id: string; service_months: string | null }[];
  assert.equal(before.length, 1);
  assert.equal(before[0].service_months, '[10,11,12]'); // sin overlay → la fila synced.

  // Edición optimista: el operario cambia a otoño → overlay PISA.
  db.exec(
    "INSERT INTO pending_rodeo_service_months (id, client_op_id, rodeo_id, service_months) VALUES ('x', 'cop1', 'r1', '[6,7]')",
  );
  const after = db.prepare(q1.sql).all(...(q1.args as string[])) as { id: string; service_months: string | null }[];
  assert.equal(after.length, 1, 'sigue siendo UNA fila (overlay PISA, no duplica)');
  assert.equal(after[0].service_months, '[6,7]', 'el overlay de edición PISA service_months');
  db.close();
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

// ─── spec 20 — evidencia afirmativa de E1 (R20.31) ──────────────────────────────

test('R20.31: buildActiveRoleQuery es LOCAL, parametrizada por (user_id, establishment_id), LIMIT 1', () => {
  const q = buildActiveRoleQuery('user-42', 'est-7');
  // Filtra por AMBAS columnas, y por nada más.
  assert.match(q.sql, /WHERE user_id = \? AND establishment_id = \?/);
  assert.match(q.sql, /FROM user_roles/);
  assert.match(q.sql, /LIMIT 1/);
  // Orden de args EXACTO (el orden de los `?` es el contrato).
  assert.deepEqual(q.args, ['user-42', 'est-7']);
  // Cero interpolación: exactamente dos placeholders y ningún valor embebido en el SQL.
  assert.equal(q.sql.match(/\?/g)?.length, 2);
  assert.doesNotMatch(q.sql, /user-42|est-7/);
});

test('R20.12/R20.31: buildActiveRoleQuery LEE `active`, NO filtra por él', () => {
  const q = buildActiveRoleQuery('u', 'e');
  // Proyecta la columna: el veredicto necesita el VALOR (0 vs 1), no un "hay fila / no hay fila".
  assert.match(q.sql, /SELECT active FROM user_roles/);
  // Si el WHERE filtrara por active, "sin fila" mezclaría "rol inactivo" con "rol inexistente" y
  // se perdería justo la evidencia afirmativa que sostiene toda E1 (design §4.3).
  assert.doesNotMatch(q.sql, /WHERE[\s\S]*active\s*=/);
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

test('buildEstablishmentDetailQuery: filtro de dominio deleted_at IS NULL + LIMIT 1 + renspa (spec 08)', () => {
  const q = buildEstablishmentDetailQuery('est-9');
  assert.match(q.sql, /FROM establishments WHERE id = \? AND deleted_at IS NULL LIMIT 1/);
  assert.match(q.sql, /id, name, province, city, total_hectares, renspa/);
  assert.deepEqual(q.args, ['est-9']);
});

test('buildBreedCatalogQuery (spec 08, T13): catálogo COMPLETO ordenado por sort_order, sin scoping ni filtro', () => {
  const q = buildBreedCatalogQuery();
  // Sin args (catálogo global) + sin WHERE (trae bovine/bubaline/generic, active y no-active: el filtro
  // bovine+active lo aplica el helper puro breedPickerOptions, no el SQL).
  assert.deepEqual(q.args, []);
  assert.match(q.sql, /FROM breed_catalog ORDER BY sort_order ASC/);
  assert.doesNotMatch(q.sql, /WHERE/, 'el catálogo se trae COMPLETO (sin filtro active=1)');
  assert.match(q.sql, /id, senasa_code, name, species, active, sort_order/);

  // Comportamiento contra sqlite: 3 filas (bovine activa, bubaline inactiva, generic) → todas vuelven, ordenadas.
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE breed_catalog (id TEXT PRIMARY KEY, senasa_code TEXT, name TEXT, species TEXT, active INTEGER, sort_order INTEGER);',
  );
  db.prepare('INSERT INTO breed_catalog VALUES (?,?,?,?,?,?)').run('a', 'OR', 'Otra Raza', 'bovine', 1, 28);
  db.prepare('INSERT INTO breed_catalog VALUES (?,?,?,?,?,?)').run('b', 'AA', 'Aberdeen Angus', 'bovine', 1, 1);
  db.prepare('INSERT INTO breed_catalog VALUES (?,?,?,?,?,?)').run('c', 'MU', 'Murrah', 'bubaline', 0, 102);
  const rows = db.prepare(q.sql).all() as Array<{ senasa_code: string }>;
  assert.deepEqual(rows.map((r) => r.senasa_code), ['AA', 'OR', 'MU'], 'todas las filas, por sort_order ASC');
  db.close();
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

test('buildMembersQuery: ORDER BY determinístico — rol (owner→operario→vet), sin-nombre al final, luego nombre + user_id', () => {
  // R4.8: sin ORDER BY el orden lo decidía SQLite y podía cambiar entre syncs. Este es el PISO
  // de determinismo; la collation es-AR final la aplica utils/sort-members.ts en la capa de servicio.
  const q = buildMembersQuery('est-3');
  assert.match(q.sql, /ORDER BY CASE ur\.role WHEN 'owner' THEN 0/);
  assert.match(q.sql, /WHEN 'field_operator' THEN 1/);
  assert.match(q.sql, /WHEN 'veterinarian' THEN 2 ELSE 3 END/);
  // sin-nombre (NULL o vacío) al final de su rol
  assert.match(q.sql, /CASE WHEN COALESCE\(TRIM\(ur\.member_name\), ''\) = '' THEN 1 ELSE 0 END/);
  // desempate total: dos homónimos nunca se permutan entre syncs
  assert.match(q.sql, /ur\.member_name, ur\.user_id\s*$/);
});

test('buildMembersQuery: el ORDER BY EJECUTADO en SQLite devuelve el orden esperado', () => {
  // Ejercita el SQL de verdad (no solo el string): filas desordenadas → orden canónico por rol,
  // sin-nombre (NULL y '') al final de SU rol, y user_id como desempate de homónimos.
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE user_roles (establishment_id TEXT, user_id TEXT, role TEXT, member_name TEXT, active INTEGER)',
  );
  const rows = [
    ['est-3', 'u-vet-n', 'veterinarian', 'Nadia', 1],
    ['est-3', 'u-op-sin', 'field_operator', '', 1],
    ['est-3', 'u-own-z', 'owner', 'Zulema', 1],
    ['est-3', 'u-op-b', 'field_operator', 'Benitez', 1],
    ['est-3', 'u-op-nulo', 'field_operator', null, 1],
    ['est-3', 'u-own-a', 'owner', 'Ana', 1],
    ['est-3', 'u-op-a2', 'field_operator', 'Alvarez', 1],
    ['est-3', 'u-op-a1', 'field_operator', 'Alvarez', 1],
    ['est-3', 'u-otro-est', 'owner', 'Intruso', 1], // se filtra por establishment_id
    ['est-3', 'u-inactivo', 'owner', 'Baja', 0], // se filtra por active = 1
  ];
  const ins = db.prepare(
    'INSERT INTO user_roles (establishment_id, user_id, role, member_name, active) VALUES (?, ?, ?, ?, ?)',
  );
  for (const r of rows) ins.run(...(r as [string, string, string, string | null, number]));
  // el "intruso" pertenece a otro campo
  db.exec("UPDATE user_roles SET establishment_id = 'est-otro' WHERE user_id = 'u-otro-est'");

  const q = buildMembersQuery('est-3');
  const out = db.prepare(q.sql).all(...(q.args as string[])) as { user_id: string }[];
  assert.deepEqual(
    out.map((r) => r.user_id),
    [
      'u-own-a', // owner Ana
      'u-own-z', // owner Zulema
      'u-op-a1', // field_operator Alvarez (desempate por user_id)
      'u-op-a2', // field_operator Alvarez
      'u-op-b', // field_operator Benitez
      'u-op-nulo', // field_operator sin nombre (NULL) → final de SU rol
      'u-op-sin', // field_operator sin nombre ('')
      'u-vet-n', // veterinarian Nadia
    ],
  );
  db.close();
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

test('buildPendingInvitationsQuery: ORDER BY created_at DESC (la más reciente arriba) + id DESC de desempate', () => {
  // R5.12.1: sin ORDER BY la invitación recién creada aparecía en cualquier posición de la lista.
  const q = buildPendingInvitationsQuery('est-6');
  assert.match(q.sql, /ORDER BY created_at DESC, id DESC\s*$/);
});

test('buildPendingInvitationsQuery: el ORDER BY EJECUTADO en SQLite pone la más reciente primero', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE invitations (id TEXT, establishment_id TEXT, role TEXT, email TEXT, created_at TEXT, expires_at TEXT, token TEXT, status TEXT)',
  );
  const ins = db.prepare(
    'INSERT INTO invitations (id, establishment_id, role, email, created_at, expires_at, token, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  ins.run('i-vieja', 'est-6', 'veterinarian', null, '2026-07-01T10:00:00Z', '2026-07-08T10:00:00Z', 't1', 'pending');
  ins.run('i-nueva', 'est-6', 'field_operator', null, '2026-07-17T09:00:00Z', '2026-07-24T09:00:00Z', 't2', 'pending');
  ins.run('i-media', 'est-6', 'veterinarian', null, '2026-07-10T10:00:00Z', '2026-07-17T10:00:00Z', 't3', 'pending');
  // empatada en created_at con i-media → desempata id DESC (determinismo, no orden arbitrario)
  ins.run('i-zeta', 'est-6', 'veterinarian', null, '2026-07-10T10:00:00Z', '2026-07-17T10:00:00Z', 't4', 'pending');
  // se filtran: otro campo y estado no-pending
  ins.run('i-otro', 'est-9', 'veterinarian', null, '2026-07-18T10:00:00Z', '2026-07-25T10:00:00Z', 't5', 'pending');
  ins.run('i-cancel', 'est-6', 'veterinarian', null, '2026-07-18T10:00:00Z', '2026-07-25T10:00:00Z', 't6', 'cancelled');

  const q = buildPendingInvitationsQuery('est-6');
  const rows = db.prepare(q.sql).all(...(q.args as string[])) as { id: string }[];
  assert.deepEqual(
    rows.map((r) => r.id),
    ['i-nueva', 'i-zeta', 'i-media', 'i-vieja'],
  );
  db.close();
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
  // orden + limit: delta tratamientos (RTR.5) — PIN de los en-tratamiento arriba (in_treatment DESC), luego
  // el orden actual (created_at DESC), sobre el UNION completo.
  assert.match(q.sql, /ORDER BY in_treatment DESC, created_at DESC LIMIT 200/);
  // delta tratamientos: in_treatment inyectado en AMBAS ramas (synced = EXISTS treatment abierto; overlay = 0).
  assert.match(q.sql, /EXISTS \(SELECT 1 FROM treatments t WHERE t\.animal_profile_id = ap\.id AND t\.ended_at IS NULL AND t\.deleted_at IS NULL\) AS in_treatment/);
  assert.match(q.sql, /0 AS in_treatment/);
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
  // delta spec 02 (aptitud RAR.2.4.2/RAR.3.1): is_cut REAL → input del espejo del badge de estado
  // reproductivo (CUT → "No apta"). Proyectado en AMBAS ramas (synced: ap.is_cut; overlay: 0 constante).
  assert.match(q.sql, /ap\.is_cut AS is_cut/);
  assert.match(q.sql, /0 AS is_cut/);
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

// ─── Opción A del chunk dedup (RD3.3 / RD8 / design §3.4): candidatos noTag por updated_at DESC ───

test('buildAnimalsListQuery: orderBy updated_at → ambas ramas proyectan el alias updated_at + ORDER BY updated_at DESC (RD3.3)', () => {
  const q = buildAnimalsListQuery('est-1', { noTag: true, orderBy: 'updated_at' });
  // La rama synced usa la columna REAL ap.updated_at; la overlay (sin updated_at) usa pap.created_at AS updated_at.
  assert.match(q.sql, /ap\.updated_at AS updated_at/);
  assert.match(q.sql, /pap\.created_at AS updated_at/);
  // El ORDER BY antepone el PIN de tratamiento (RTR.5) y luego el alias updated_at (recientes primero).
  assert.match(q.sql, /ORDER BY in_treatment DESC, updated_at DESC LIMIT 200/);
  // El filtro noTag sigue en AMBAS ramas.
  assert.match(q.sql, /AND ap\.animal_tag_electronic IS NULL/);
  assert.match(q.sql, /AND pap\.animal_tag_electronic IS NULL/);
  assert.deepEqual(q.args, ['est-1', 'active', 'est-1', 'active']);
});

test('buildAnimalsListQuery: orderBy default (created_at) NO proyecta updated_at (cero regresión sobre los callers históricos)', () => {
  const q = buildAnimalsListQuery('est-1');
  assert.doesNotMatch(q.sql, /AS updated_at/);
  assert.match(q.sql, /ORDER BY in_treatment DESC, created_at DESC LIMIT 200/);
});

// COMPORTAMIENTO contra node:sqlite (tablas reales): el orden updated_at DESC respeta la frescura, mezclando
// synced (updated_at real) + overlay (created_at como fallback de updated_at). Verifica que el UNION está
// column-aligned (mismo número/orden de columnas en ambas ramas, requisito del UNION ALL) — un assert de
// string no captura un mismatch de columnas; node:sqlite SÍ falla si las ramas no alinean.
test('buildAnimalsListQuery (comportamiento): orderBy updated_at ordena candidatos noTag por frescura (synced updated_at + overlay created_at)', () => {
  const db = new DatabaseSync(':memory:');
  // Esquema mínimo con las columnas que LOCAL_LIST_SELECT (synced) y LOCAL_LIST_SELECT_OVERLAY proyectan,
  // + las tablas JOINeadas (rodeos, categories_by_system) y la de override (vacía).
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, ' +
      'rodeo_id TEXT, status TEXT, management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, ' +
      'category_override INTEGER, animal_birth_date TEXT, is_castrated INTEGER, future_bull INTEGER, is_cut INTEGER, ' +
      'establishment_id TEXT, deleted_at TEXT, created_at TEXT, updated_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, ' +
      'rodeo_id TEXT, status TEXT, management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, ' +
      'category_override INTEGER, animal_birth_date TEXT, establishment_id TEXT, created_at TEXT);' +
      'CREATE TABLE rodeos (id TEXT, system_id TEXT, name TEXT);' +
      'CREATE TABLE categories_by_system (id TEXT, code TEXT, name TEXT);' +
      'CREATE TABLE pending_status_overrides (target_table TEXT, target_id TEXT, effect TEXT);' +
      // delta IDU: la lista enriquece con apodo/apodo_enabled por subconsulta a estas tablas (vacías → apodo
      // NULL / apodo_enabled 0). Deben existir o el SQL revienta con "no such table".
      'CREATE TABLE custom_attributes (animal_profile_id TEXT, field_definition_id TEXT, value TEXT);' +
      'CREATE TABLE field_definitions (id TEXT, data_key TEXT, establishment_id TEXT);' +
      'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE pending_rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      // delta tratamientos: buildAnimalsListQuery inyecta un EXISTS sobre `treatments` (in_treatment) → la
      // tabla debe existir o el SQL revienta con "no such table". Los tests que no insertan tratamientos ven
      // in_treatment 0 para todos (sin alterar su orden).
      'CREATE TABLE treatments (id TEXT, animal_profile_id TEXT, ended_at TEXT, deleted_at TEXT);',
  );
  db.prepare('INSERT INTO rodeos (id, system_id, name) VALUES (?,?,?)').run('rod-1', 'sys-1', 'Rodeo 1');
  db.prepare('INSERT INTO categories_by_system (id, code, name) VALUES (?,?,?)').run('cat-1', 'ternero', 'Ternero');
  // 3 synced sin caravana con updated_at distintos + 1 synced CON caravana (debe quedar fuera por noTag).
  const insSync = db.prepare(
    'INSERT INTO animal_profiles (id, animal_id, idv, category_id, rodeo_id, status, ' +
      'management_group_id, animal_tag_electronic, animal_sex, category_override, animal_birth_date, ' +
      'is_castrated, future_bull, establishment_id, deleted_at, created_at, updated_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  // updated_at: A es el más reciente, luego B, luego C. (created_at deliberadamente "al revés" para probar
  // que ordena por updated_at, no por created_at.)
  insSync.run('p-A', 'an-A', 'A1', 'cat-1', 'rod-1', 'active', null, null, 'female', 0, null, 0, 0, 'est-1', null, '2024-01-01T00:00:00Z', '2024-06-03T00:00:00Z');
  insSync.run('p-B', 'an-B', 'B1', 'cat-1', 'rod-1', 'active', null, null, 'female', 0, null, 0, 0, 'est-1', null, '2024-01-02T00:00:00Z', '2024-06-02T00:00:00Z');
  insSync.run('p-C', 'an-C', 'C1', 'cat-1', 'rod-1', 'active', null, null, 'female', 0, null, 0, 0, 'est-1', null, '2024-01-03T00:00:00Z', '2024-06-01T00:00:00Z');
  // CON caravana → noTag debe excluirlo.
  insSync.run('p-tagged', 'an-T', 'T1', 'cat-1', 'rod-1', 'active', null, '982000000000001', 'female', 0, null, 0, 0, 'est-1', null, '2024-01-04T00:00:00Z', '2024-06-09T00:00:00Z');
  // 1 overlay (alta optimista sin caravana): su created_at lo ubica entre A y B (overlay usa created_at AS updated_at).
  db.prepare(
    'INSERT INTO pending_animal_profiles (id, animal_id, idv, category_id, rodeo_id, status, ' +
      'management_group_id, animal_tag_electronic, animal_sex, category_override, animal_birth_date, ' +
      'establishment_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('p-OPT', 'an-O', 'O1', 'cat-1', 'rod-1', 'active', null, null, 'female', 0, null, 'est-1', '2024-06-02T12:00:00Z');

  const q = buildAnimalsListQuery('est-1', { noTag: true, orderBy: 'updated_at' });
  const rows = db.prepare(q.sql).all(...(q.args as string[])) as { id: string }[];
  db.close();
  // El animal con caravana queda FUERA; el resto, por updated_at DESC: A (06-03) > OPT (06-02 12:00) > B (06-02 00:00) > C (06-01).
  assert.deepEqual(rows.map((r) => r.id), ['p-A', 'p-OPT', 'p-B', 'p-C']);
});

test('buildNoTagCandidatesCountQuery: COUNT noTag synced (oculta exits) + COUNT noTag overlay, scopeado al establishment', () => {
  const q = buildNoTagCandidatesCountQuery('est-7');
  // Dos sub-counts sumados: animal_profiles (noTag + activos + oculta exits) + pending_animal_profiles (noTag + activos).
  assert.match(q.sql, /SELECT COUNT\(\*\) FROM animal_profiles ap/);
  assert.match(q.sql, /ap\.establishment_id = \? AND ap\.status = 'active' AND ap\.deleted_at IS NULL AND ap\.animal_tag_electronic IS NULL/);
  assert.match(q.sql, /SELECT COUNT\(\*\) FROM pending_animal_profiles pap/);
  assert.match(q.sql, /pap\.establishment_id = \? AND pap\.status = 'active' AND pap\.animal_tag_electronic IS NULL/);
  assert.match(q.sql, /\) \+ \(/);
  // NO re-scopea tenant por has_role_in (lo hizo la stream); el establishment llega por arg, sin hardcode.
  assert.doesNotMatch(q.sql, /has_role_in/);
  assert.deepEqual(q.args, ['est-7', 'est-7']);
});

// COMPORTAMIENTO: el conteo refleja exactamente el universo de la lista noTag (synced + overlay), excluyendo
// los que tienen caravana y los exits pendientes.
test('buildNoTagCandidatesCountQuery (comportamiento): cuenta solo noTag activos (synced + overlay), excluye tagged y exited', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, status TEXT, animal_tag_electronic TEXT, establishment_id TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, status TEXT, animal_tag_electronic TEXT, establishment_id TEXT);' +
      'CREATE TABLE pending_status_overrides (target_table TEXT, target_id TEXT, effect TEXT);',
  );
  const insSync = db.prepare('INSERT INTO animal_profiles (id, status, animal_tag_electronic, establishment_id, deleted_at) VALUES (?,?,?,?,?)');
  insSync.run('s-noTag-1', 'active', null, 'est-1', null); // cuenta
  insSync.run('s-noTag-2', 'active', null, 'est-1', null); // cuenta
  insSync.run('s-tagged', 'active', '982000000000002', 'est-1', null); // NO (tiene caravana)
  insSync.run('s-other', 'active', null, 'est-2', null); // NO (otro campo)
  insSync.run('s-exited', 'active', null, 'est-1', null); // NO (exit pendiente, ver override)
  db.prepare('INSERT INTO pending_status_overrides (target_table, target_id, effect) VALUES (?,?,?)')
    .run('animal_profiles', 's-exited', 'exited');
  db.prepare('INSERT INTO pending_animal_profiles (id, status, animal_tag_electronic, establishment_id) VALUES (?,?,?,?)')
    .run('o-noTag', 'active', null, 'est-1'); // cuenta (alta optimista sin caravana)
  const q = buildNoTagCandidatesCountQuery('est-1');
  const row = db.prepare(q.sql).get(...(q.args as string[])) as { count: number };
  db.close();
  // s-noTag-1, s-noTag-2, o-noTag → 3. tagged/other-field/exited excluidos.
  assert.equal(row.count, 3);
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

// ─── Lookup cross-campo del TAG bastoneado (spec 09 chunk BLE global, RB4.6 / design §3.3) ─────

test('buildLookupTagAcrossFieldsQuery: matchea TAG activo SIN filtrar por establishment + JOIN a establishments(name) + LIMIT 2', () => {
  const q = buildLookupTagAcrossFieldsQuery('982000123456789');
  // proyecta profile_id + establishment_id + el name legible del campo
  assert.match(q.sql, /ap\.id AS profile_id/);
  assert.match(q.sql, /ap\.establishment_id AS establishment_id/);
  assert.match(q.sql, /e\.name AS establishment_name/);
  // JOIN local a establishments por el establishment_id del perfil
  assert.match(q.sql, /JOIN establishments e ON e\.id = ap\.establishment_id/);
  // filtros de dominio: TAG exacto + status active + deleted_at IS NULL
  assert.match(q.sql, /ap\.animal_tag_electronic = \?/);
  assert.match(q.sql, /ap\.status = 'active'/);
  assert.match(q.sql, /ap\.deleted_at IS NULL/);
  // LIMIT 2 (distinguir "solo otro campo" de duplicado raro)
  assert.match(q.sql, /LIMIT 2/);
  // CRÍTICO: NO scopea por establishment_id (es lo que la distingue de buildSearchByTagQuery)
  assert.doesNotMatch(q.sql, /ap\.establishment_id = \?/);
  // NO toca el overlay pending_* (transfer aplica sobre filas REALES sincronizadas)
  assert.doesNotMatch(q.sql, /pending_animal_profiles/);
  // un solo arg: el TAG
  assert.deepEqual(q.args, ['982000123456789']);
});

test('buildLookupTagAcrossFieldsQuery: integración SQLite — encuentra el activo en OTRO campo, ignora deleted/no-activo, trae el name del campo', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT PRIMARY KEY, establishment_id TEXT, animal_tag_electronic TEXT, status TEXT, deleted_at TEXT);' +
      'CREATE TABLE establishments (id TEXT PRIMARY KEY, name TEXT);',
  );
  const insE = db.prepare('INSERT INTO establishments (id, name) VALUES (?, ?)');
  insE.run('est-A', 'La Querencia');
  insE.run('est-B', 'El Ombú');
  const insP = db.prepare(
    'INSERT INTO animal_profiles (id, establishment_id, animal_tag_electronic, status, deleted_at) VALUES (?, ?, ?, ?, ?)',
  );
  const TAG = '982000123456789';
  insP.run('p-otra', 'est-B', TAG, 'active', null); // activo en OTRO campo → debe matchear
  insP.run('p-vendido', 'est-A', TAG, 'sold', null); // mismo TAG pero no activo → NO matchea
  insP.run('p-borrado', 'est-A', TAG, 'active', '2026-06-01'); // soft-deleted → NO matchea
  insP.run('p-otro-tag', 'est-A', '111111111111111', 'active', null); // otro TAG → NO matchea

  const q = buildLookupTagAcrossFieldsQuery(TAG);
  const rows = db.prepare(q.sql).all(...(q.args as string[])) as {
    profile_id: string;
    establishment_id: string;
    establishment_name: string;
  }[];
  db.close();

  assert.equal(rows.length, 1, 'solo el activo no-borrado matchea');
  assert.equal(rows[0].profile_id, 'p-otra');
  assert.equal(rows[0].establishment_id, 'est-B');
  assert.equal(rows[0].establishment_name, 'El Ombú', 'trae el name legible del otro campo (JOIN)');
});

test('buildSearchByIdvQuery: exacto por idv, active, limit 20, UNION overlay', () => {
  const q = buildSearchByIdvQuery('est-1', '03200');
  assert.match(q.sql, /AND ap\.idv = \?/);
  assert.match(q.sql, /AND pap\.idv = \?/);
  assert.deepEqual(q.args, ['est-1', 'active', '03200', 'est-1', 'active', '03200']);
});

test('buildSearchLikeQuery: LIKE %term% local con ESCAPE, sobre la columna whitelisteada, UNION overlay', () => {
  const q = buildSearchLikeQuery('est-1', 'idv', 'R12');
  // el SQL contiene ESCAPE '\' (un solo backslash); en regex un backslash literal es \\
  assert.match(q.sql, /AND REPLACE\(REPLACE\(REPLACE\(REPLACE\(ap\.idv, '-', ''\), ' ', ''\), '\.', ''\), '\/', ''\) LIKE \? ESCAPE '\\'/);
  assert.match(q.sql, /AND REPLACE\(REPLACE\(REPLACE\(REPLACE\(pap\.idv, '-', ''\), ' ', ''\), '\.', ''\), '\/', ''\) LIKE \? ESCAPE '\\'/);
  assert.match(q.sql, /LIMIT 20/);
  assert.deepEqual(q.args, ['est-1', 'active', '%R12%', 'est-1', 'active', '%R12%']);
});

// 🔴 A.1 (QA en device 2026-08-06): el término del buscador viaja COMPACTO y el idv guardado conserva el
// separador (`PERF-00500`) → todo fragmento que CRUZA el guion no matcheaba nada y la app ofrecía "Dar de
// alta" sobre un animal que existe (= duplicado). La columna `idv` se compara COMPACTADA.
test('A.1 buildSearchLikeQuery: sobre `idv` compacta LA COLUMNA (los dos lados sin separadores)', () => {
  const idv = buildSearchLikeQuery('est-1', 'idv', 'PERF005');
  // Los 4 separadores de `STRUCTURED_SEPARATORS` (espacio, guion, punto, barra), en las DOS ramas.
  for (const alias of ['ap', 'pap']) {
    const m = new RegExp(`REPLACE\\(REPLACE\\(REPLACE\\(REPLACE\\(${alias}\\.idv, '-', ''\\), ' ', ''\\), '\\.', ''\\), '/', ''\\) LIKE \\?`);
    assert.match(idv.sql, m, `la rama ${alias} tiene que comparar la columna compactada`);
  }
  assert.deepEqual(idv.args, ['est-1', 'active', '%PERF005%', 'est-1', 'active', '%PERF005%']);
  // Y el patrón sigue escapado + acotado (no se perdió nada al envolver la columna).
  assert.match(idv.sql, /LIKE \? ESCAPE '\\'/);
  assert.match(idv.sql, /LIMIT 20/);
});

test('A.1 buildSearchLikeQuery: sobre `animal_tag_electronic` NO compacta (15 díg puros, sería un scan al pedo)', () => {
  const tag = buildSearchLikeQuery('est-1', 'animal_tag_electronic', '0320');
  assert.match(tag.sql, /ap\.animal_tag_electronic LIKE \?/);
  assert.match(tag.sql, /pap\.animal_tag_electronic LIKE \?/);
  assert.doesNotMatch(tag.sql, /REPLACE\(/, 'la caravana electrónica guardada no tiene separadores');
  assert.deepEqual(tag.args, ['est-1', 'active', '%0320%', 'est-1', 'active', '%0320%']);
});

/**
 * SQLite en memoria con el esquema MÍNIMO que necesita `buildSearchUnion` (las 9 tablas que toca la query
 * real, con las columnas que proyecta). Sembra `animal_profiles` con los idv dados.
 */
function seedSearchDb(rows: { id: string; idv: string; establishmentId?: string }[]): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT,' +
      ' status TEXT, management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT,' +
      ' category_override INTEGER, animal_birth_date TEXT, is_castrated INTEGER, future_bull INTEGER,' +
      ' is_cut INTEGER, establishment_id TEXT, deleted_at TEXT, created_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT,' +
      ' rodeo_id TEXT, status TEXT, management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT,' +
      ' category_override INTEGER, animal_birth_date TEXT, establishment_id TEXT, created_at TEXT);' +
      'CREATE TABLE pending_status_overrides (target_table TEXT, target_id TEXT, effect TEXT);' +
      'CREATE TABLE rodeos (id TEXT, system_id TEXT, name TEXT);' +
      'CREATE TABLE categories_by_system (id TEXT, code TEXT, name TEXT);' +
      'CREATE TABLE custom_attributes (animal_profile_id TEXT, field_definition_id TEXT, value TEXT);' +
      'CREATE TABLE field_definitions (id TEXT, data_key TEXT, establishment_id TEXT);' +
      'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE pending_rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      "INSERT INTO rodeos VALUES ('rod-1','sys-1','Rodeo general');" +
      "INSERT INTO categories_by_system VALUES ('cat-1','vaquillona','Vaquillona');",
  );
  const ins = db.prepare(
    'INSERT INTO animal_profiles (id, idv, category_id, rodeo_id, status, establishment_id, deleted_at)' +
      " VALUES (?,?,'cat-1','rod-1','active',?,NULL)",
  );
  for (const r of rows) ins.run(r.id, r.idv, r.establishmentId ?? 'est-1');
  return db;
}

/** Ejecuta un `LocalQuery` del repo tal cual (SQL + args) y devuelve las filas como objetos planos. */
function runQuery(db: DatabaseSync, q: { sql: string; args: unknown[] }): { id: string; idv: string }[] {
  const raw = db.prepare(q.sql).all(...(q.args as string[])) as { id: string; idv: string }[];
  return raw.map((r) => ({ id: r.id, idv: r.idv })).sort((a, b) => a.id.localeCompare(b.id));
}

// Oráculo de COMPORTAMIENTO: se EJECUTA el SQL que genera el repo contra un SQLite REAL (`node:sqlite`),
// sembrado con los valores del bug.
//
// ⚠️ Por qué no alcanza un espejo en JS (era la versión anterior de este test, y el reviewer tenía razón):
// un espejo escrito a mano es una SEGUNDA implementación de lo mismo, así que si el `REPLACE` real quedara
// con los argumentos invertidos o con un separador de menos, el espejo seguiría verde. Ejecutar el SQL
// verdadero es la única forma de que el test hable del predicado que corre en el teléfono.
test('A.1 el predicado compactado ENCUENTRA lo que el bug no encontraba (SQL REAL sobre node:sqlite)', () => {
  const db = seedSearchDb([
    { id: 'p-guion', idv: 'PERF-00500' },
    { id: 'p-otro', idv: 'PERF-00501' },
    { id: 'p-ajeno', idv: 'OTRO-123' },
  ]);
  try {
    // Las 10 filas del barrido del QA en el A07 — las 6 que daban "Animal nuevo" y las 2 que ya andaban.
    // El término viaja COMPACTO (es lo que `classifySearchQuery` entrega en `plan.compact`).
    for (const typed of ['PERF-0', 'PERF-005', 'PERF-0050', 'PERF-00500', 'perf-00500', 'F-005', 'PERF', '00500']) {
      const compact = typed.replace(/[\s\-./]/g, '');
      const ids = runQuery(db, buildSearchLikeQuery('est-1', 'idv', compact)).map((r) => r.id);
      assert.ok(ids.includes('p-guion'), `tipear «${typed}» tiene que encontrar el idv PERF-00500 (dio ${ids})`);
    }
    // Y NO se volvió comodín: el idv completo de OTRO animal no lo trae.
    assert.deepEqual(
      runQuery(db, buildSearchLikeQuery('est-1', 'idv', 'PERF00500')).map((r) => r.id),
      ['p-guion'],
      'el término completo trae SOLO al que corresponde',
    );
    assert.deepEqual(runQuery(db, buildSearchLikeQuery('est-1', 'idv', 'NADA')).map((r) => r.id), []);
    // Scope de tenant: un homónimo de OTRO campo nunca sale (el filtro sigue en las dos ramas del UNION).
    const db2 = seedSearchDb([
      { id: 'p-mio', idv: 'PERF-00500' },
      { id: 'p-vecino', idv: 'PERF-00500', establishmentId: 'est-2' },
    ]);
    try {
      assert.deepEqual(
        runQuery(db2, buildSearchLikeQuery('est-1', 'idv', 'PERF00500')).map((r) => r.id),
        ['p-mio'],
        'cero fuga cross-tenant',
      );
    } finally {
      db2.close();
    }
  } finally {
    db.close();
  }
});

// ─── delta IDU: canal de búsqueda por APODO (IDU.4.4) ───────────────────────────────────────

test('buildApodoSearchQuery: EXISTS sobre custom_attributes por data_key=apodo, escapado + scopeado, UNION overlay', () => {
  const q = buildApodoSearchQuery('est-1', 'Manch');
  // La rama synced correla por ap.id; la overlay por pap.id. data_key='apodo' constante (no input).
  assert.match(q.sql, /EXISTS \(SELECT 1 FROM custom_attributes ca/);
  assert.match(q.sql, /ca\.animal_profile_id = ap\.id AND fd\.data_key = 'apodo'/);
  assert.match(q.sql, /ca\.animal_profile_id = pap\.id AND fd\.data_key = 'apodo'/);
  assert.match(q.sql, /ca\.value LIKE \? ESCAPE '\\'/);
  // scope de tenant por establishment (buildSearchUnion) + status active; LIMIT del UNION.
  assert.match(q.sql, /ap\.establishment_id = \?/);
  assert.match(q.sql, /LIMIT 20/);
  // el término va escapado (%_ \ neutralizados) + envuelto en %…%; un arg por rama.
  assert.deepEqual(q.args, ['est-1', 'active', '%Manch%', 'est-1', 'active', '%Manch%']);
});

test('buildApodoSearchQuery: escapa los comodines del término (anti-widening del LIKE)', () => {
  const q = buildApodoSearchQuery('est-1', '50%_x');
  assert.deepEqual(q.args, ['est-1', 'active', '%50\\%\\_x%', 'est-1', 'active', '%50\\%\\_x%']);
});

// COMPORTAMIENTO contra node:sqlite: matchea el apodo por LIKE sobre el value JSON-string, scopeado al campo.
test('buildApodoSearchQuery (comportamiento): encuentra el animal cuyo apodo contiene el término, dentro del campo', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT, status TEXT, ' +
      'management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, category_override INTEGER, ' +
      'animal_birth_date TEXT, is_castrated INTEGER, future_bull INTEGER, is_cut INTEGER, establishment_id TEXT, ' +
      'deleted_at TEXT, created_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT, status TEXT, ' +
      'management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, category_override INTEGER, ' +
      'animal_birth_date TEXT, establishment_id TEXT, created_at TEXT);' +
      'CREATE TABLE rodeos (id TEXT, system_id TEXT, name TEXT);' +
      'CREATE TABLE categories_by_system (id TEXT, code TEXT, name TEXT);' +
      'CREATE TABLE pending_status_overrides (target_table TEXT, target_id TEXT, effect TEXT);' +
      'CREATE TABLE custom_attributes (animal_profile_id TEXT, field_definition_id TEXT, value TEXT);' +
      'CREATE TABLE field_definitions (id TEXT, data_key TEXT, establishment_id TEXT);' +
      'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE pending_rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      // delta tratamientos: buildAnimalsListQuery inyecta un EXISTS sobre `treatments` (in_treatment) → la
      // tabla debe existir o el SQL revienta con "no such table". Los tests que no insertan tratamientos ven
      // in_treatment 0 para todos (sin alterar su orden).
      'CREATE TABLE treatments (id TEXT, animal_profile_id TEXT, ended_at TEXT, deleted_at TEXT);',
  );
  db.prepare('INSERT INTO rodeos (id, system_id, name) VALUES (?,?,?)').run('rod-1', 'sys-1', 'Rodeo 1');
  db.prepare('INSERT INTO categories_by_system (id, code, name) VALUES (?,?,?)').run('cat-1', 'vaca', 'Vaca');
  db.prepare('INSERT INTO field_definitions (id, data_key, establishment_id) VALUES (?,?,?)').run('fd-apodo', 'apodo', 'est-1');
  db.prepare('INSERT INTO field_definitions (id, data_key, establishment_id) VALUES (?,?,?)').run('fd-apodo-2', 'apodo', 'est-2');
  const insP = db.prepare(
    'INSERT INTO animal_profiles (id, animal_id, idv, category_id, rodeo_id, status, animal_sex, category_override, ' +
      'is_castrated, future_bull, is_cut, establishment_id, deleted_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  insP.run('p-1', 'an-1', null, 'cat-1', 'rod-1', 'active', 'female', 0, 0, 0, 0, 'est-1', null, 't1');
  insP.run('p-2', 'an-2', null, 'cat-1', 'rod-1', 'active', 'female', 0, 0, 0, 0, 'est-1', null, 't2');
  // p-otro-campo NO debe aparecer (scope por campo).
  insP.run('p-x', 'an-x', null, 'cat-1', 'rod-1', 'active', 'female', 0, 0, 0, 0, 'est-2', null, 't3');
  const insCA = db.prepare('INSERT INTO custom_attributes (animal_profile_id, field_definition_id, value) VALUES (?,?,?)');
  insCA.run('p-1', 'fd-apodo', JSON.stringify('Manchada')); // value JSON-string con comillas
  insCA.run('p-2', 'fd-apodo', JSON.stringify('Lola'));
  insCA.run('p-x', 'fd-apodo-2', JSON.stringify('Manchada')); // otro campo, mismo apodo
  const q = buildApodoSearchQuery('est-1', 'Manch');
  const rows = db.prepare(q.sql).all(...(q.args as string[])) as { id: string; apodo: string | null }[];
  db.close();
  assert.deepEqual(rows.map((r) => r.id), ['p-1'], 'solo el del campo activo con apodo que contiene "Manch"');
  // El value viene JSON-string; el mapper lo decodifica aguas arriba (parseCustomValueJson).
  assert.equal(rows[0].apodo, JSON.stringify('Manchada'));
});

// ─── delta IDU: apodos del campo para el warning-soft (IDU.5.4) ──────────────────────────────

test('buildApodoListQuery: apodos activos del campo con profile_id, scopeado por establishment', () => {
  const q = buildApodoListQuery('est-9');
  assert.match(q.sql, /SELECT ca\.animal_profile_id AS profile_id, ca\.value AS value/);
  assert.match(q.sql, /fd\.data_key = 'apodo' AND fd\.establishment_id IS NOT NULL/);
  assert.match(q.sql, /ap\.establishment_id = \? AND ap\.deleted_at IS NULL AND ap\.status = 'active'/);
  assert.deepEqual(q.args, ['est-9']);
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
  // delta spec 02 (TCUT.3 / RCUT.4.1): is_cut REAL (marca de descarte) en la rama synced + 0 en el overlay
  // (un alta optimista nace no-CUT) → la ficha lo expone como AnimalDetail.isCut (afordancia + badge amarillo).
  assert.match(q.sql, /ap\.is_cut AS is_cut/);
  assert.match(q.sql, /0 AS is_cut/);
  // bugfix U4: teeth_state REAL en la rama synced + NULL en el overlay (pending_animal_profiles no tiene la
  // columna) → la ficha lo expone como AnimalDetail.teethState (fila "Dientes" de "Estado actual").
  assert.match(q.sql, /ap\.teeth_state AS teeth_state/);
  assert.match(q.sql, /NULL AS teeth_state/);
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

// ─── delta spec 02 (aptitud): buildReproBadgeEventsQuery (RAR.2.3) ─────────────────────

test('buildReproBadgeEventsQuery: SQL — proyecta heifer_fitness/service_type + incluye tacto_vaquillona, UNION overlay, ORDER BY', () => {
  const q = buildReproBadgeEventsQuery(['p1', 'p2']);
  // synced: filtro deleted_at + event_type acotado (incluye tacto_vaquillona y service)
  assert.match(q.sql, /FROM reproductive_events WHERE animal_profile_id IN \(\?, \?\) AND deleted_at IS NULL/);
  assert.match(q.sql, /AND event_type IN \('tacto','birth','abortion','service','tacto_vaquillona'\)/);
  // proyecta las 2 columnas extra sobre el espejo C6
  assert.match(q.sql, /SELECT animal_profile_id, event_type, event_date, created_at, pregnancy_status, heifer_fitness, service_type/);
  // overlay: pending_reproductive_events (solo partos → NULL en las 3 columnas de dato)
  assert.match(q.sql, /UNION ALL/);
  assert.match(q.sql, /NULL AS heifer_fitness, NULL AS service_type/);
  assert.match(q.sql, /ORDER BY event_date ASC, created_at ASC/);
  // NO re-scopea tenant
  assert.doesNotMatch(q.sql, /has_role_in|establishment_id/);
  assert.deepEqual(q.args, ['p1', 'p2', 'p1', 'p2']);
});

test('buildReproBadgeEventsQuery: COMPORTAMIENTO — trae tacto_vaquillona/service no-borrados + birth del overlay, excluye deleted y tipos irrelevantes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE reproductive_events (animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, pregnancy_status TEXT, heifer_fitness TEXT, service_type TEXT, deleted_at TEXT);' +
      'CREATE TABLE pending_reproductive_events (animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT);',
  );
  const insS = db.prepare(
    'INSERT INTO reproductive_events (animal_profile_id, event_type, event_date, created_at, pregnancy_status, heifer_fitness, service_type, deleted_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  insS.run('p1', 'tacto_vaquillona', '2026-04-01', '2026-04-01T10:00:00Z', null, 'apta', null, null);
  insS.run('p1', 'service', '2026-05-01', '2026-05-01T10:00:00Z', null, null, 'natural', null);
  // un tacto_vaquillona BORRADO → NO se trae
  insS.run('p1', 'tacto_vaquillona', '2026-03-01', '2026-03-01T10:00:00Z', null, 'no_apta', null, '2026-03-05T00:00:00Z');
  // tipo irrelevante (weaning NO está en el set del badge) → NO se trae
  insS.run('p1', 'weaning', '2026-02-01', '2026-02-01T10:00:00Z', null, null, null, null);
  // evento de OTRO perfil → no aparece
  insS.run('p2', 'tacto_vaquillona', '2026-04-01', '2026-04-01T10:00:00Z', null, 'diferida', null, null);
  // overlay: parto optimista de p1
  db.prepare('INSERT INTO pending_reproductive_events (animal_profile_id, event_type, event_date, created_at) VALUES (?,?,?,?)')
    .run('p1', 'birth', '2026-06-01', '2026-06-01T09:00:00Z');

  const q = buildReproBadgeEventsQuery(['p1']);
  const rows = (db.prepare(q.sql).all(...(q.args as string[])) as {
    event_type: string;
    heifer_fitness: string | null;
    service_type: string | null;
  }[]).map((r) => ({ ...r }));
  db.close();

  // tacto_vaquillona(apta) + service(natural) + birth(overlay); NO el borrado, NO weaning, NO p2.
  assert.deepEqual(
    rows.map((r) => r.event_type),
    ['tacto_vaquillona', 'service', 'birth'],
  );
  assert.equal(rows.find((r) => r.event_type === 'tacto_vaquillona')?.heifer_fitness, 'apta');
  assert.equal(rows.find((r) => r.event_type === 'service')?.service_type, 'natural');
  // el overlay proyecta NULL en heifer_fitness/service_type
  assert.equal(rows.find((r) => r.event_type === 'birth')?.heifer_fitness, null);
});

// ─── delta lotes-venta: buildSessionEmptyFemalesQuery (RLV.10.1) ───────────────────────

test('buildSessionEmptyFemalesQuery: SQL — reproductive_events JOIN animal_profiles, DISTINCT, filtros de dominio, SIN overlay', () => {
  const q = buildSessionEmptyFemalesQuery('sess-1');
  // DISTINCT por animal + join a animal_profiles.
  assert.match(q.sql, /SELECT DISTINCT ap\.id AS profile_id/);
  assert.match(q.sql, /FROM reproductive_events re JOIN animal_profiles ap ON ap\.id = re\.animal_profile_id/);
  // filtros de dominio: session_id + tacto + empty + no borrado + perfil activo/no borrado.
  assert.match(q.sql, /re\.session_id = \?/);
  assert.match(q.sql, /re\.event_type = 'tacto'/);
  assert.match(q.sql, /re\.pregnancy_status = 'empty'/);
  assert.match(q.sql, /re\.deleted_at IS NULL/);
  assert.match(q.sql, /ap\.status = 'active' AND ap\.deleted_at IS NULL/);
  // RECONCILIACIÓN as-built: el tacto de manga es CRUD-plano a la tabla SYNCED → NO hay overlay UNION
  // (pending_reproductive_events solo porta partos 'birth', nunca un tacto 'empty').
  assert.doesNotMatch(q.sql, /pending_reproductive_events/);
  assert.doesNotMatch(q.sql, /UNION/);
  // NO re-scopea tenant (la stream ya lo hizo; la session_id acota al campo).
  assert.doesNotMatch(q.sql, /has_role_in|establishment_id/);
  assert.deepEqual(q.args, ['sess-1']);
});

test('buildSessionEmptyFemalesQuery: COMPORTAMIENTO — trae solo vacías activas de la sesión, DISTINCT por animal', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, pregnancy_status TEXT, session_id TEXT, deleted_at TEXT);' +
      'CREATE TABLE animal_profiles (id TEXT, idv TEXT, animal_tag_electronic TEXT, status TEXT, deleted_at TEXT);',
  );
  const insP = db.prepare('INSERT INTO animal_profiles (id, idv, animal_tag_electronic, status, deleted_at) VALUES (?,?,?,?,?)');
  insP.run('p1', '101', null, 'active', null);
  insP.run('p2', '102', '982000000000001', 'active', null);
  insP.run('p3', '103', null, 'active', null); // preñada, NO vacía
  insP.run('p4', '104', null, 'sold', null); // vacía pero YA archivada → excluida
  insP.run('p5', '105', null, 'active', '2026-07-01T00:00:00Z'); // vacía pero perfil borrado → excluida
  const insE = db.prepare('INSERT INTO reproductive_events (id, animal_profile_id, event_type, event_date, pregnancy_status, session_id, deleted_at) VALUES (?,?,?,?,?,?,?)');
  insE.run('e1', 'p1', 'tacto', '2026-07-10', 'empty', 'sess-1', null);
  // p1 con DOS tactos empty en la sesión (corrección duplicada) → DISTINCT colapsa a 1.
  insE.run('e1b', 'p1', 'tacto', '2026-07-10', 'empty', 'sess-1', null);
  insE.run('e2', 'p2', 'tacto', '2026-07-10', 'empty', 'sess-1', null);
  insE.run('e3', 'p3', 'tacto', '2026-07-10', 'large', 'sess-1', null); // preñada → no
  insE.run('e4', 'p4', 'tacto', '2026-07-10', 'empty', 'sess-1', null); // perfil sold → no
  insE.run('e5', 'p5', 'tacto', '2026-07-10', 'empty', 'sess-1', null); // perfil borrado → no
  insE.run('e6', 'p1', 'tacto', '2026-07-10', 'empty', 'sess-OTHER', null); // otra sesión → no
  insE.run('e7', 'p2', 'tacto', '2026-06-01', 'empty', 'sess-1', '2026-06-02T00:00:00Z'); // tacto borrado → no dup

  const q = buildSessionEmptyFemalesQuery('sess-1');
  const rows = (db.prepare(q.sql).all(...(q.args as string[])) as { profile_id: string; idv: string | null; tag_electronic: string | null }[]).map((r) => ({ ...r }));
  db.close();

  const ids = rows.map((r) => r.profile_id).sort();
  assert.deepEqual(ids, ['p1', 'p2']); // solo las vacías activas de sess-1, DISTINCT (p1 una sola vez)
  assert.equal(rows.length, 2);
  // Proyecta idv + tag para el hero legible del caller.
  assert.equal(rows.find((r) => r.profile_id === 'p2')?.tag_electronic, '982000000000001');
});

// ─── delta tratamientos (spec 02) — writes CRUD-plano + lecturas + pin ─────────────────────────

test('buildStartTreatmentInsert: INSERT header, id/started_at cliente, OMITE establishment_id/created_by (trigger)', () => {
  const q = buildStartTreatmentInsert('t-1', 'prof-1', 'antibiotico', 'Oxitetraciclina', 'nota', '2026-07-10T12:00:00Z');
  assert.match(q.sql, /^INSERT INTO treatments \(id, animal_profile_id, kind, product_name, notes, started_at\) VALUES \(\?, \?, \?, \?, \?, \?\)$/);
  // NO se mandan establishment_id/created_by (los fuerza el trigger, anti-spoof RTR.7.2/7.7).
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /created_by/);
  assert.deepEqual(q.args, ['t-1', 'prof-1', 'antibiotico', 'Oxitetraciclina', 'nota', '2026-07-10T12:00:00Z']);
});

test('buildStartTreatmentInsert: notes null se pasa (columna nullable)', () => {
  const q = buildStartTreatmentInsert('t-2', 'prof-1', 'otro', 'Vitaminas', null, '2026-07-10T12:00:00Z');
  assert.deepEqual(q.args, ['t-2', 'prof-1', 'otro', 'Vitaminas', null, '2026-07-10T12:00:00Z']);
});

test('buildRegisterApplicationInsert: INSERT sanitary_event con treatment_id + dosis/vía/próxima dosis, OMITE established/created_by', () => {
  const q = buildRegisterApplicationInsert('ev-1', 'prof-1', 't-1', 'treatment', 'Oxitetraciclina', '2026-07-10', 5, 'intramuscular', '2026-07-13');
  assert.match(q.sql, /^INSERT INTO sanitary_events \(id, animal_profile_id, treatment_id, event_type, product_name, event_date, dose_ml, route, next_dose_date\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?\)$/);
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /created_by/);
  assert.deepEqual(q.args, ['ev-1', 'prof-1', 't-1', 'treatment', 'Oxitetraciclina', '2026-07-10', 5, 'intramuscular', '2026-07-13']);
});

test('buildRegisterApplicationInsert: dosis/vía/próxima dosis null (opcionales, nullable)', () => {
  const q = buildRegisterApplicationInsert('ev-2', 'prof-1', 't-1', 'deworming', 'Ivermectina', '2026-07-10', null, null, null);
  assert.deepEqual(q.args, ['ev-2', 'prof-1', 't-1', 'deworming', 'Ivermectina', '2026-07-10', null, null, null]);
});

test('buildFinalizeTreatmentUpdate: UPDATE ended_at = now, IDEMPOTENTE (guard ended_at IS NULL, RTR.3.4)', () => {
  const q = buildFinalizeTreatmentUpdate('t-1');
  assert.match(q.sql, /^UPDATE treatments SET ended_at = datetime\('now'\) WHERE id = \? AND ended_at IS NULL$/);
  assert.deepEqual(q.args, ['t-1']);
});

test('buildAnimalTreatmentsQuery: en curso primero (ended_at IS NULL DESC) luego started_at DESC + deleted_at IS NULL', () => {
  const q = buildAnimalTreatmentsQuery('prof-1');
  assert.match(q.sql, /FROM treatments WHERE animal_profile_id = \? AND deleted_at IS NULL/);
  assert.match(q.sql, /ORDER BY \(ended_at IS NULL\) DESC, started_at DESC/);
  assert.deepEqual(q.args, ['prof-1']);
});

test('buildTreatmentApplicationsQuery: por treatment_id, recientes primero + deleted_at IS NULL + proyecta dosis/vía/próxima', () => {
  const q = buildTreatmentApplicationsQuery('t-1');
  assert.match(q.sql, /SELECT id, event_type, product_name, dose_ml, route, event_date, next_dose_date/);
  assert.match(q.sql, /FROM sanitary_events WHERE treatment_id = \? AND deleted_at IS NULL/);
  assert.match(q.sql, /ORDER BY event_date DESC, created_at DESC/);
  assert.deepEqual(q.args, ['t-1']);
});

// COMPORTAMIENTO contra node:sqlite: el DERIVADO "en tratamiento" y el PIN. Un treatment ABIERTO (ended_at NULL)
// prende in_treatment=1 → el animal queda ARRIBA; al finalizar (ended_at seteado) in_treatment vuelve a 0 →
// baja. Cubre RTR.4.1/4.6 + RTR.5.1/5.4 sobre el SQL real (un assert de string no captura el orden efectivo).
test('buildAnimalsListQuery (comportamiento): el animal EN TRATAMIENTO se pinnea arriba; al finalizar baja (RTR.4/5)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT, status TEXT, ' +
      'management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, category_override INTEGER, ' +
      'animal_birth_date TEXT, is_castrated INTEGER, future_bull INTEGER, is_cut INTEGER, establishment_id TEXT, ' +
      'deleted_at TEXT, created_at TEXT);' +
      'CREATE TABLE pending_animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT, status TEXT, ' +
      'management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, category_override INTEGER, ' +
      'animal_birth_date TEXT, establishment_id TEXT, created_at TEXT);' +
      'CREATE TABLE rodeos (id TEXT, system_id TEXT, name TEXT);' +
      'CREATE TABLE categories_by_system (id TEXT, code TEXT, name TEXT);' +
      'CREATE TABLE pending_status_overrides (target_table TEXT, target_id TEXT, effect TEXT);' +
      'CREATE TABLE custom_attributes (animal_profile_id TEXT, field_definition_id TEXT, value TEXT);' +
      'CREATE TABLE field_definitions (id TEXT, data_key TEXT, establishment_id TEXT);' +
      'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE pending_rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
      'CREATE TABLE treatments (id TEXT, animal_profile_id TEXT, ended_at TEXT, deleted_at TEXT);',
  );
  db.prepare('INSERT INTO rodeos (id, system_id, name) VALUES (?,?,?)').run('rod-1', 'sys-1', 'Rodeo 1');
  db.prepare('INSERT INTO categories_by_system (id, code, name) VALUES (?,?,?)').run('cat-1', 'vaca', 'Vaca');
  const ins = db.prepare(
    'INSERT INTO animal_profiles (id, animal_id, idv, category_id, rodeo_id, status, management_group_id, ' +
      'animal_tag_electronic, animal_sex, category_override, animal_birth_date, is_castrated, future_bull, ' +
      'is_cut, establishment_id, deleted_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  // p-new es el MÁS reciente (created_at) → sin tratamientos estaría primero. p-old es más viejo.
  ins.run('p-new', 'an-N', 'N1', 'cat-1', 'rod-1', 'active', null, null, 'female', 0, null, 0, 0, 0, 'est-1', null, '2026-07-10T00:00:00Z');
  ins.run('p-old', 'an-O', 'O1', 'cat-1', 'rod-1', 'active', null, null, 'female', 0, null, 0, 0, 0, 'est-1', null, '2026-07-01T00:00:00Z');

  const q = buildAnimalsListQuery('est-1');

  // Sin tratamientos: orden por created_at DESC → p-new arriba.
  {
    const rows = db.prepare(q.sql).all(...(q.args as string[])) as { id: string; in_treatment: number }[];
    assert.deepEqual(rows.map((r) => r.id), ['p-new', 'p-old']);
    assert.equal(rows.find((r) => r.id === 'p-old')?.in_treatment, 0);
  }

  // p-old EN TRATAMIENTO (treatment abierto) → se pinnea ARRIBA pese a ser más viejo (RTR.4.1/5.1).
  db.prepare('INSERT INTO treatments (id, animal_profile_id, ended_at, deleted_at) VALUES (?,?,?,?)')
    .run('t-1', 'p-old', null, null);
  {
    const rows = db.prepare(q.sql).all(...(q.args as string[])) as { id: string; in_treatment: number }[];
    assert.deepEqual(rows.map((r) => r.id), ['p-old', 'p-new']);
    assert.equal(rows.find((r) => r.id === 'p-old')?.in_treatment, 1);
  }

  // Un treatment soft-deleteado o finalizado NO cuenta: al finalizar p-old baja de nuevo (RTR.4.6/5.4).
  db.prepare("UPDATE treatments SET ended_at = '2026-07-11T00:00:00Z' WHERE id = 't-1'").run();
  {
    const rows = db.prepare(q.sql).all(...(q.args as string[])) as { id: string; in_treatment: number }[];
    assert.deepEqual(rows.map((r) => r.id), ['p-new', 'p-old']);
    assert.equal(rows.find((r) => r.id === 'p-old')?.in_treatment, 0);
  }
  db.close();
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

// ─── delta ficha-categoria-tacto: buildSetCategoryOverrideUpdate (RCM.5.1 / RCM.5.4) ───────────

test('buildSetCategoryOverrideUpdate: UN solo statement setea category_id Y override=1, deleted_at IS NULL', () => {
  const q = buildSetCategoryOverrideUpdate('prof-11', 'cat-elegida');
  assert.match(
    q.sql,
    /^UPDATE animal_profiles SET category_id = \?, category_override = 1 WHERE id = \? AND deleted_at IS NULL$/,
  );
  // Las dos columnas en el MISMO UPDATE → una sola CrudEntry → un solo PATCH (0040 lo lee como override manual).
  assert.deepEqual(q.args, ['cat-elegida', 'prof-11']);
});

test('RCM.5.4 — el pin de categoría NO escribe is_castrated / is_cut / teeth_state ni ninguna otra columna', () => {
  const q = buildSetCategoryOverrideUpdate('prof-11', 'cat-elegida');
  // Aserción sobre el VALOR del SQL (no sobre "cómo está escrito"): el SET tiene EXACTAMENTE dos asignaciones
  // y ninguna es de las columnas prohibidas. Un builder que sumara `is_cut = 1` cae acá.
  const setClause = /SET (.+?) WHERE/.exec(q.sql)?.[1] ?? '';
  const assignments = setClause.split(',').map((s) => s.trim().split('=')[0].trim());
  assert.deepEqual(assignments, ['category_id', 'category_override']);
  for (const forbidden of ['is_castrated', 'is_cut', 'teeth_state', 'idv', 'rodeo_id', 'status']) {
    assert.doesNotMatch(q.sql, new RegExp(`\\b${forbidden}\\b`), `el pin no debe tocar ${forbidden}`);
  }
  // Y el WHERE es por el id del PERFIL (no por establishment_id hardcodeado — multi-tenant, RCM.9.3).
  assert.doesNotMatch(q.sql, /establishment_id/);
});

test('el pin y el revert son SIMÉTRICOS: mismas dos columnas, override 1 vs 0, mismos args', () => {
  const pin = buildSetCategoryOverrideUpdate('p', 'c');
  const revert = buildRevertCategoryOverrideUpdate('p', 'c');
  assert.deepEqual(pin.args, revert.args, 'mismo orden de args (categoryId, profileId)');
  assert.match(pin.sql, /category_override = 1/);
  assert.match(revert.sql, /category_override = 0/);
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
  // spec 10 T-UI.8: reproductive + sanitary proyectan created_by (gating del borrado owner|autor).
  assert.match(q.sql, /json_object\('event_type', event_type, 'pregnancy_status', pregnancy_status, 'calf_id', calf_id, 'notes', notes, 'created_by', created_by\)/);
  assert.match(q.sql, /json_object\('event_type', event_type, 'product_name', product_name, 'route', route, 'notes', notes, 'created_by', created_by\)/);
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
      'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, pregnancy_status TEXT, calf_id TEXT, notes TEXT, created_by TEXT, deleted_at TEXT);' +
      'CREATE TABLE sanitary_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, product_name TEXT, route TEXT, notes TEXT, created_by TEXT, deleted_at TEXT);' +
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
      'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, pregnancy_status TEXT, calf_id TEXT, notes TEXT, created_by TEXT, deleted_at TEXT);' +
      'CREATE TABLE sanitary_events (id TEXT, animal_profile_id TEXT, event_type TEXT, event_date TEXT, created_at TEXT, product_name TEXT, route TEXT, notes TEXT, created_by TEXT, deleted_at TEXT);' +
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
  // session_id default null (ficha de spec 02: evento suelto, sin jornada) — as-built M2.2 R5.11.
  const q = buildAddWeightInsert('w-id', 'prof-1', 320.5, '2026-06-09', 'gorda');
  assert.match(
    q.sql,
    /^INSERT INTO weight_events \(id, animal_profile_id, weight_kg, weight_date, notes, session_id\) VALUES \(\?, \?, \?, \?, \?, \?\)$/,
  );
  // los triggers/defaults ponen estos al subir → NO van en el INSERT local
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /created_by/);
  assert.doesNotMatch(q.sql, /\bsource\b/);
  // args en el ORDEN exacto de los placeholders; session_id null al final por default
  assert.deepEqual(q.args, ['w-id', 'prof-1', 320.5, '2026-06-09', 'gorda', null]);
});

test('buildAddWeightInsert: session_id se vincula cuando viene (jornada de manga, R5.11)', () => {
  const q = buildAddWeightInsert('w3', 'p', 412, '2026-06-09', null, 'sess-99');
  assert.equal((q.sql.match(/\?/g) ?? []).length, 6);
  assert.deepEqual(q.args, ['w3', 'p', 412, '2026-06-09', null, 'sess-99']);
});

test('buildAddWeightInsert: notes null se preserva (columna nullable, no se omite la posición)', () => {
  const q = buildAddWeightInsert('w2', 'p', 100, '2026-01-01', null);
  // 6 placeholders SIEMPRE (id, profile, kg, date, notes, session_id) — el INSERT por posición no se corre
  assert.equal((q.sql.match(/\?/g) ?? []).length, 6);
  assert.deepEqual(q.args, ['w2', 'p', 100, '2026-01-01', null, null]);
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

// ─── M6 — Circunferencia escrotal (spec 03 US-14): builders del write-path + lectura del histórico ──

test('buildAddScrotalInsert: INSERT scrotal_measurements (cm/age/measured_at/session_id), SIN establishment_id/recorded_by/source', () => {
  const q = buildAddScrotalInsert('ce-1', 'prof-1', 36.5, 24, '2026-06-18', 'sess-1');
  assert.match(
    q.sql,
    /^INSERT INTO scrotal_measurements \(id, animal_profile_id, circumference_cm, age_months, measured_at, session_id\) VALUES \(\?, \?, \?, \?, \?, \?\)$/,
  );
  // los triggers/defaults los ponen al subir (R14.9) → NO van en el INSERT local
  assert.doesNotMatch(q.sql, /establishment_id/);
  assert.doesNotMatch(q.sql, /recorded_by/);
  assert.doesNotMatch(q.sql, /\bsource\b/);
  assert.deepEqual(q.args, ['ce-1', 'prof-1', 36.5, 24, '2026-06-18', 'sess-1']);
});

test('buildAddScrotalInsert: session_id default null (ficha de spec 02, sin jornada) + age null (R14.7/R14.8)', () => {
  const q = buildAddScrotalInsert('ce-2', 'prof-1', 40, null, '2026-06-18');
  // 6 placeholders SIEMPRE (id, profile, cm, age, measured_at, session_id) — INSERT por posición.
  assert.equal((q.sql.match(/\?/g) ?? []).length, 6);
  assert.deepEqual(q.args, ['ce-2', 'prof-1', 40, null, '2026-06-18', null]);
});

test('buildUpdateManeuverScrotal: UPDATE cm/age/measured_at por id (corrección R14.17), filtra deleted_at IS NULL', () => {
  const q = buildUpdateManeuverScrotal('ce-1', 38.5, 30, '2026-06-18');
  assert.match(
    q.sql,
    /^UPDATE scrotal_measurements SET circumference_cm = \?, age_months = \?, measured_at = \? WHERE id = \? AND deleted_at IS NULL$/,
  );
  assert.deepEqual(q.args, [38.5, 30, '2026-06-18', 'ce-1']);
});

test('buildUpdateManeuverScrotal: age null se preserva en la corrección (edad desconocida, R14.7)', () => {
  const q = buildUpdateManeuverScrotal('ce-1', 41, null, '2026-06-18');
  assert.deepEqual(q.args, [41, null, '2026-06-18', 'ce-1']);
});

test('buildScrotalHistoryQuery: SELECT del histórico, más reciente primero, solo no-borradas (R14.5/R14.14)', () => {
  const q = buildScrotalHistoryQuery('prof-9');
  assert.match(q.sql, /^SELECT id, circumference_cm, age_months, measured_at, session_id, created_at FROM scrotal_measurements/);
  assert.match(q.sql, /WHERE animal_profile_id = \? AND deleted_at IS NULL/);
  assert.match(q.sql, /ORDER BY measured_at DESC, created_at DESC$/);
  assert.deepEqual(q.args, ['prof-9']);
});

// TAREA 2: los INSERT de reproductive_events setean `created_at` de CLIENTE (último arg) → instante real
// de creación para que deriveCurrentState desempate los eventos del mismo event_date determinísticamente.
const CA = '2026-06-09T12:00:00.000Z';

test('buildAddTactoInsert: INSERT reproductive_events con event_type literal tacto + pregnancy_status + created_at de cliente', () => {
  // session_id default null (ficha de spec 02). as-built M2.2 R5.11.
  const q = buildAddTactoInsert('t-1', 'prof-3', 'empty', '2026-06-09', 'ok', CA);
  assert.match(
    q.sql,
    /^INSERT INTO reproductive_events \(id, animal_profile_id, event_type, event_date, pregnancy_status, notes, created_at, session_id\) VALUES \(\?, \?, 'tacto', \?, \?, \?, \?, \?\)$/,
  );
  // event_type es literal embebido (no placeholder) → los args NO lo incluyen
  assert.doesNotMatch(q.sql, /service_type/);
  assert.deepEqual(q.args, ['t-1', 'prof-3', '2026-06-09', 'empty', 'ok', CA, null]);
});

test('buildAddTactoInsert: session_id se vincula cuando viene (jornada de manga, R5.11)', () => {
  const q = buildAddTactoInsert('t-2', 'prof-9', 'large', '2026-06-09', null, CA, 'sess-7');
  assert.deepEqual(q.args, ['t-2', 'prof-9', '2026-06-09', 'large', null, CA, 'sess-7']);
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

test('buildPendingAnimalProfileInsert: 19 columnas (sin visual_id_alt), category_override 1/0, identidad b1 denormalizada', () => {
  const q = buildPendingAnimalProfileInsert('p-1', 'cop-1', PROFILE_FIELDS);
  // 19 placeholders (delta IDU: visual_id_alt eliminada, era 20).
  assert.equal((q.sql.match(/\?/g) ?? []).length, 19);
  assert.equal(q.args.length, 19);
  assert.doesNotMatch(q.sql, /visual_id_alt/);
  // id, client_op_id primero; category_override → 1 (true) — ahora en el índice 8 (sin visual_id_alt).
  assert.equal(q.args[0], 'p-1');
  assert.equal(q.args[1], 'cop-1');
  assert.equal(q.args[8], 1); // category_override true → 1
  // identidad denormalizada (b1) para que el UNION de lectura la muestre
  assert.match(q.sql, /animal_tag_electronic, animal_sex, animal_birth_date/);
  assert.deepEqual(q.args.slice(15, 18), ['982000000000001', 'female', '2026-06-01']);
});

test('buildPendingAnimalProfileInsert: category_override false → 0', () => {
  const q = buildPendingAnimalProfileInsert('p-2', 'cop-2', { ...PROFILE_FIELDS, categoryOverride: false });
  assert.equal(q.args[8], 0);
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

// ─── shape del intent + overlay de link_calf_to_mother (spec 02 delta #15, RCAP.8.1) ──────────────────
// enqueueLinkCalfToMother (outbox.ts) importa el SDK (getPowerSync → react-native) → NO entra al grafo de
// node:test (igual que el resto de las funciones enqueue*). Su CONTRATO de shape es 100% determinado por los
// builders puros de acá: el intent (op_type EXACTO = nombre de la RPC, fold MED-1) + EXACTAMENTE 2 filas de
// overlay (evento de parto de la madre + puente al ternero EXISTENTE), SIN pending_animals/pending_animal_profiles
// (no se crea un ternero; se vincula uno existente — a diferencia de enqueueRegisterBirth). Este test reconstruye
// esa composición con los mismos builders y la fija; la orquestación de la writeTransaction la cubre el E2E.
test('link_calf_to_mother: shape del intent (op_type = nombre EXACTO de la RPC) + overlay = evento madre + puente al ternero EXISTENTE (RCAP.8.1)', () => {
  const motherProfileId = 'mother-prof-1';
  const calfProfileId = 'calf-prof-existing';
  const eventDate = '2026-06-30';
  const birthEventId = 'birth-evt-prov';
  const clientOpId = 'cop-link';
  const createdAt = '2026-06-30T12:00:00.000Z';
  const params = { p_mother_profile_id: motherProfileId, p_calf_profile_id: calfProfileId, p_event_date: eventDate };

  // (1) intent: op_type = 'link_calf_to_mother' (= nombre EXACTO de la RPC, fold MED-1) + los 3 params.
  const intent = buildOpIntentInsert(clientOpId, 'link_calf_to_mother', JSON.stringify(params), createdAt);
  assert.deepEqual(intent.args, [clientOpId, 'link_calf_to_mother', JSON.stringify(params), createdAt]);
  // p_client_op_id NO va en los params (lo reinyecta mapIntentToRpc al subir).
  assert.ok(!('p_client_op_id' in params), 'p_client_op_id NO va en los params del intent (lo inyecta upload)');

  // (2) overlay fila 1: el evento de parto OPTIMISTA de la MADRE (birth).
  const ev = buildPendingReproductiveEventInsert(birthEventId, clientOpId, {
    animalProfileId: motherProfileId, eventType: 'birth', eventDate, notes: null, createdAt,
  });
  assert.deepEqual(ev.args, [birthEventId, clientOpId, motherProfileId, 'birth', eventDate, null, createdAt]);

  // (3) overlay fila 2: el puente parto↔ternero EXISTENTE (linkea el calf_profile_id existente, NO uno nuevo).
  const bridge = buildPendingBirthCalfInsert('bc-synth', clientOpId, birthEventId, calfProfileId);
  assert.deepEqual(bridge.args, ['bc-synth', clientOpId, birthEventId, calfProfileId]);
  // El 4to arg del puente es el calf_profile_id EXISTENTE (no un id provisional de un ternero recién creado).
  assert.equal(bridge.args[3], calfProfileId, 'el puente apunta al ternero EXISTENTE');
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

test('buildPendingRodeoInsert: pending_rodeos con id de cliente + active=1 literal + service_months (Run T9.8 / B1)', () => {
  const q = buildPendingRodeoInsert('rod-1', 'cop-1', {
    establishmentId: 'est-1', name: 'Rodeo principal', speciesId: 'sp-1', systemId: 'sys-1',
    serviceMonths: '[10,11,12]',
    createdAt: '2026-06-09T00:00:00.000Z',
  });
  assert.match(
    q.sql,
    /INSERT INTO pending_rodeos \(id, client_op_id, establishment_id, name, species_id, system_id, active, service_months, created_at\) VALUES \(\?, \?, \?, \?, \?, \?, 1, \?, \?\)/,
  );
  // active = 1 es LITERAL en el SQL (no es arg) → 8 placeholders, 8 args (service_months sumado, B1).
  assert.equal((q.sql.match(/\?/g) ?? []).length, 8);
  assert.deepEqual(q.args, ['rod-1', 'cop-1', 'est-1', 'Rodeo principal', 'sp-1', 'sys-1', '[10,11,12]', '2026-06-09T00:00:00.000Z']);
  // serviceMonths null (defensivo) → arg null, no rompe.
  const qNull = buildPendingRodeoInsert('rod-2', 'cop-2', {
    establishmentId: 'est-1', name: 'Rodeo B', speciesId: 'sp-1', systemId: 'sys-1',
    serviceMonths: null, createdAt: '2026-06-09T00:00:00.000Z',
  });
  assert.equal(qNull.args[6], null);
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

test('buildPendingRodeoServiceMonthsInsert: overlay de la EDICIÓN de meses, 4 placeholders (B1)', () => {
  const q = buildPendingRodeoServiceMonthsInsert('x-1', 'cop-1', 'rod-1', '[6,7]');
  assert.equal(
    q.sql,
    'INSERT INTO pending_rodeo_service_months (id, client_op_id, rodeo_id, service_months) VALUES (?, ?, ?, ?)',
  );
  assert.equal((q.sql.match(/\?/g) ?? []).length, 4);
  assert.deepEqual(q.args, ['x-1', 'cop-1', 'rod-1', '[6,7]']);
});

test('buildDeletePendingRodeoServiceMonths: DELETE por rodeo_id, 1 placeholder (delete-prior, invariante ≤1 fila, B1)', () => {
  const q = buildDeletePendingRodeoServiceMonths('rod-1');
  assert.equal(q.sql, 'DELETE FROM pending_rodeo_service_months WHERE rodeo_id = ?');
  assert.equal((q.sql.match(/\?/g) ?? []).length, 1);
  assert.deepEqual(q.args, ['rod-1']);
});

// COMPORTAMIENTO: delete-prior + insert garantiza UNA sola fila por rodeo (invariante del COALESCE de
// buildRodeosQuery) aun tras dos ediciones offline del mismo rodeo antes de syncear.
test('buildPendingRodeoServiceMonthsInsert (comportamiento): doble-edición offline → UNA fila con el último valor (B1)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE pending_rodeo_service_months (id TEXT, client_op_id TEXT, rodeo_id TEXT, service_months TEXT);');
  const apply = (id: string, cop: string, months: string) => {
    const del = buildDeletePendingRodeoServiceMonths('rod-1');
    db.prepare(del.sql).run(...(del.args as string[]));
    const ins = buildPendingRodeoServiceMonthsInsert(id, cop, 'rod-1', months);
    db.prepare(ins.sql).run(...(ins.args as string[]));
  };
  apply('x-1', 'cop-1', '[10,11,12]');
  apply('x-2', 'cop-2', '[6,7]'); // 2da edición offline antes de syncear.
  const rows = db
    .prepare("SELECT service_months FROM pending_rodeo_service_months WHERE rodeo_id = 'rod-1'")
    .all() as { service_months: string }[];
  assert.equal(rows.length, 1, 'el delete-prior mantiene ≤1 fila por rodeo');
  assert.equal(rows[0].service_months, '[6,7]', 'queda el último valor editado');
  db.close();
});

test('buildClearOverlayDelete: DELETE por client_op_id en la tabla pending_* dada', () => {
  const q = buildClearOverlayDelete('pending_animal_profiles', 'cop-1');
  assert.equal(q.sql, 'DELETE FROM pending_animal_profiles WHERE client_op_id = ?');
  assert.deepEqual(q.args, ['cop-1']);
  // Run T9.8: también limpia el overlay del alta de rodeo.
  const rodeo = buildClearOverlayDelete('pending_rodeos', 'cop-2');
  assert.equal(rodeo.sql, 'DELETE FROM pending_rodeos WHERE client_op_id = ?');
  // B1: y el overlay de la edición de meses de servicio.
  const sm = buildClearOverlayDelete('pending_rodeo_service_months', 'cop-3');
  assert.equal(sm.sql, 'DELETE FROM pending_rodeo_service_months WHERE client_op_id = ?');
});

test('PENDING_OVERLAY_TABLES: las 8 tablas overlay (para clear/rollback por client_op_id)', () => {
  assert.deepEqual([...PENDING_OVERLAY_TABLES].sort(), [
    'pending_animal_profiles',
    'pending_animals',
    'pending_birth_calves',
    'pending_reproductive_events',
    'pending_rodeo_data_config',
    'pending_rodeo_service_months',
    'pending_rodeos',
    'pending_status_overrides',
  ]);
});

// ─── spec 10 (T-CL.8/T-CL.11/T-CL.13): builders de las operaciones masivas + castración/futuro torito ──

test('T-CL.8 / R3.1: buildAddVaccinationInsert — sanitary_events vaccination, campaign_id NO se manda (NULL as-built)', () => {
  const q = buildAddVaccinationInsert('id-1', 'p-1', 'Aftosa', '2026-06-11');
  assert.match(q.sql, /INSERT INTO sanitary_events/);
  assert.match(q.sql, /'vaccination'/);
  // campaign_id NO está en la lista de columnas → queda NULL (sanitary_campaigns no existe, design §2.2).
  assert.ok(!/campaign_id/.test(q.sql), 'no debe setear campaign_id (NULL as-built)');
  // La VÍA se eliminó (decisión de producto 2026-06-15): el INSERT NO setea `route` → queda NULL (la
  // columna sigue dormida en la DB, no se dropeó). Esto verifica que el path no manda route.
  assert.ok(!/\broute\b/.test(q.sql), 'no debe setear route (vía eliminada; columna dormida NULL)');
  // author_id/created_by/created_at/establishment_id NO se mandan (los fuerza el trigger al subir).
  for (const forbidden of ['author_id', 'created_by', 'created_at', 'establishment_id']) {
    assert.ok(!new RegExp(forbidden).test(q.sql), `no debe setear ${forbidden} (trigger server-side)`);
  }
  assert.deepEqual(q.args, ['id-1', 'p-1', 'Aftosa', '2026-06-11']);
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

// ─── buildSoftDeleteEventUpdate / DELETABLE_EVENT_TABLE (spec 10, T-UI.8): corrección de eventos ──────

test('T-UI.8: DELETABLE_EVENT_TABLE mapea solo sanitary/reproductive (los kinds borrables desde la ficha)', () => {
  assert.equal(DELETABLE_EVENT_TABLE.sanitary, 'sanitary_events');
  assert.equal(DELETABLE_EVENT_TABLE.reproductive, 'reproductive_events');
  // Los demás kinds del timeline NO son borrables desde la ficha (este chunk solo vacunación/destete).
  assert.equal(DELETABLE_EVENT_TABLE.weight, undefined);
  assert.equal(DELETABLE_EVENT_TABLE.observacion, undefined);
  assert.equal(DELETABLE_EVENT_TABLE.category_change, undefined);
});

test('T-UI.8: buildSoftDeleteEventUpdate — UPDATE deleted_at, guard deleted_at IS NULL (idempotente), sin tenant', () => {
  const q = buildSoftDeleteEventUpdate('sanitary_events', 'ev-1');
  assert.match(q.sql, /UPDATE sanitary_events SET deleted_at = datetime\('now'\) WHERE id = \? AND deleted_at IS NULL/);
  assert.deepEqual(q.args, ['ev-1']);
  // NO re-scopea tenant (la RLS server-side es la barrera); NO toca otras columnas (solo deleted_at).
  assert.doesNotMatch(q.sql, /has_role_in|establishment/);
  const rq = buildSoftDeleteEventUpdate('reproductive_events', 'ev-2');
  assert.match(rq.sql, /UPDATE reproductive_events SET deleted_at/);
  assert.deepEqual(rq.args, ['ev-2']);
});

// Ejecución REAL contra SQLite in-memory: el soft-delete oculta la fila (deleted_at no-NULL); re-borrar es
// no-op (guard deleted_at IS NULL → 0 filas afectadas) → idempotente bajo reintento de sync (R6.3-style).
test('T-UI.8: buildSoftDeleteEventUpdate ejecuta — marca deleted_at + idempotente (re-borrar = no-op)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE sanitary_events (id TEXT, animal_profile_id TEXT, event_type TEXT, deleted_at TEXT);',
  );
  db.exec(
    "INSERT INTO sanitary_events (id, animal_profile_id, event_type, deleted_at) VALUES ('ev-1', 'p-1', 'vaccination', NULL);",
  );

  const q = buildSoftDeleteEventUpdate('sanitary_events', 'ev-1');
  const res1 = db.prepare(q.sql).run(...(q.args as never[]));
  assert.equal(res1.changes, 1); // borró la fila viva
  const row = db.prepare('SELECT deleted_at FROM sanitary_events WHERE id = ?').get('ev-1') as {
    deleted_at: string | null;
  };
  assert.ok(row.deleted_at != null, 'deleted_at quedó seteado → la fila se oculta del timeline (deleted_at IS NULL)');

  // Re-borrar: 0 filas afectadas (ya no hay fila con deleted_at IS NULL) → idempotente.
  const res2 = db.prepare(q.sql).run(...(q.args as never[]));
  assert.equal(res2.changes, 0);

  db.close();
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// M3.1 — write-paths de las maniobras restantes (spec 03) — INSERT con session_id + UPDATE corrección
// ════════════════════════════════════════════════════════════════════════════════════════════

test('M3.1: buildAddManeuverSanitaryInsert — sanitary_events deworming, product_name, session_id, SIN route (D10)', () => {
  const q = buildAddManeuverSanitaryInsert('s-1', 'p-1', 'deworming', 'Ivermectina', '2026-06-14', 'sess-1');
  assert.match(q.sql, /INSERT INTO sanitary_events/);
  assert.match(q.sql, /session_id/);
  assert.doesNotMatch(q.sql, /route/); // D10: la vía NO se persiste estructurada
  assert.deepEqual(q.args, ['s-1', 'p-1', 'deworming', 'Ivermectina', '2026-06-14', 'sess-1']);
});

test('M3.1: buildUpdateManeuverSanitary — UPDATE product_name, filtra deleted_at', () => {
  const q = buildUpdateManeuverSanitary('s-1', 'Doramectina', '2026-06-14');
  assert.match(q.sql, /^UPDATE sanitary_events SET product_name/);
  assert.match(q.sql, /deleted_at IS NULL/);
  assert.deepEqual(q.args, ['Doramectina', '2026-06-14', 's-1']);
});

test('M3.1: buildAddManeuverVaccinationInsert — sanitary_events vaccination con session_id', () => {
  const q = buildAddManeuverVaccinationInsert('v-1', 'p-1', 'Aftosa', '2026-06-14', 'sess-1');
  assert.match(q.sql, /'vaccination'/);
  assert.match(q.sql, /session_id/);
  assert.deepEqual(q.args, ['v-1', 'p-1', 'Aftosa', '2026-06-14', 'sess-1']);
});

test('M3.1: buildAddManeuverConditionScoreInsert — condition_score_events con session_id', () => {
  const q = buildAddManeuverConditionScoreInsert('cs-1', 'p-1', 3.5, '2026-06-14', 'sess-1');
  assert.match(q.sql, /INSERT INTO condition_score_events/);
  assert.match(q.sql, /session_id/);
  assert.deepEqual(q.args, ['cs-1', 'p-1', 3.5, '2026-06-14', 'sess-1']);
});

test('M3.1: buildUpdateManeuverConditionScore — UPDATE score, deleted_at', () => {
  const q = buildUpdateManeuverConditionScore('cs-1', 4.25, '2026-06-14');
  assert.match(q.sql, /^UPDATE condition_score_events SET score/);
  assert.deepEqual(q.args, [4.25, '2026-06-14', 'cs-1']);
});

test('M3.1: buildAddManeuverTactoVaquillonaInsert — reproductive_events tacto_vaquillona + heifer_fitness + session_id', () => {
  const q = buildAddManeuverTactoVaquillonaInsert('tv-1', 'p-1', 'apta', '2026-06-14', '2026-06-14T10:00:00Z', 'sess-1');
  assert.match(q.sql, /'tacto_vaquillona'/);
  assert.match(q.sql, /heifer_fitness/);
  assert.match(q.sql, /session_id/);
  assert.deepEqual(q.args, ['tv-1', 'p-1', '2026-06-14', 'apta', '2026-06-14T10:00:00Z', 'sess-1']);
});

test('M3.1: buildUpdateManeuverTactoVaquillona — UPDATE heifer_fitness, filtra event_type', () => {
  const q = buildUpdateManeuverTactoVaquillona('tv-1', 'no_apta', '2026-06-14');
  assert.match(q.sql, /^UPDATE reproductive_events SET heifer_fitness/);
  assert.match(q.sql, /event_type = 'tacto_vaquillona'/);
  assert.deepEqual(q.args, ['no_apta', '2026-06-14', 'tv-1']);
});

test('delta aptitud: buildAddTactoVaquillonaInsert (alta) — tacto_vaquillona + heifer_fitness + created_at, SIN session_id', () => {
  const q = buildAddTactoVaquillonaInsert('av-1', 'p-1', 'apta', '2026-06-29', '2026-06-29T10:00:00Z');
  assert.match(
    q.sql,
    /^INSERT INTO reproductive_events \(id, animal_profile_id, event_type, event_date, heifer_fitness, created_at\) VALUES \(\?, \?, 'tacto_vaquillona', \?, \?, \?\)$/,
  );
  // el alta NO es jornada de manga → SIN columna session_id (RAR.8.2)
  assert.doesNotMatch(q.sql, /session_id/);
  assert.deepEqual(q.args, ['av-1', 'p-1', '2026-06-29', 'apta', '2026-06-29T10:00:00Z']);
});

test('M3.1: buildAddManeuverInseminationInsert — reproductive_events service ai, pajuela en notes, session_id', () => {
  const q = buildAddManeuverInseminationInsert('i-1', 'p-1', 'Toro X', '2026-06-14', '2026-06-14T10:00:00Z', 'sess-1');
  assert.match(q.sql, /'service'/);
  assert.match(q.sql, /'ai'/);
  assert.match(q.sql, /session_id/);
  assert.deepEqual(q.args, ['i-1', 'p-1', '2026-06-14', 'Toro X', '2026-06-14T10:00:00Z', 'sess-1']);
});

test('M3.1: buildUpdateManeuverInsemination — UPDATE notes, filtra event_type service', () => {
  const q = buildUpdateManeuverInsemination('i-1', 'Toro Y', '2026-06-14');
  assert.match(q.sql, /^UPDATE reproductive_events SET notes/);
  assert.match(q.sql, /event_type = 'service'/);
  assert.deepEqual(q.args, ['Toro Y', '2026-06-14', 'i-1']);
});

test('M3.1: buildAddManeuverLabSampleInsert — lab_samples con sample_type variable + tube_number + session_id', () => {
  const blood = buildAddManeuverLabSampleInsert('l-1', 'p-1', 'blood', '42', '2026-06-14', 'sess-1');
  assert.match(blood.sql, /INSERT INTO lab_samples/);
  assert.deepEqual(blood.args, ['l-1', 'p-1', 'blood', '42', '2026-06-14', 'sess-1']);
  const tricho = buildAddManeuverLabSampleInsert('l-2', 'p-1', 'scrape_tricho', '7', '2026-06-14', 'sess-1');
  assert.equal(tricho.args[2], 'scrape_tricho');
});

test('M3.1: buildUpdateManeuverLabSample — UPDATE tube_number, deleted_at', () => {
  const q = buildUpdateManeuverLabSample('l-1', '99', '2026-06-14');
  assert.match(q.sql, /^UPDATE lab_samples SET tube_number/);
  assert.deepEqual(q.args, ['99', '2026-06-14', 'l-1']);
});

test('M3.1: buildSetTeethStateUpdate — UPDATE animal_profiles.teeth_state (propiedad, NO evento, sin session_id)', () => {
  const q = buildSetTeethStateUpdate('p-1', 'sin_dientes');
  assert.match(q.sql, /^UPDATE animal_profiles SET teeth_state/);
  assert.doesNotMatch(q.sql, /session_id/);
  assert.match(q.sql, /deleted_at IS NULL/);
  assert.deepEqual(q.args, ['sin_dientes', 'p-1']);
});

test('M3.1: buildSetCutUpdate — UPDATE is_cut=1 + category_id + category_override=1 (R6.8)', () => {
  const q = buildSetCutUpdate('p-1', 'cat-cut');
  assert.match(q.sql, /SET is_cut = 1, category_id = \?, category_override = 1/);
  assert.deepEqual(q.args, ['cat-cut', 'p-1']);
});

test('M3.1: buildUnsetCutUpdate — UPDATE is_cut=0 + category derivada + category_override=0 (revert R6.8)', () => {
  const q = buildUnsetCutUpdate('p-1', 'cat-derivada');
  assert.match(q.sql, /SET is_cut = 0, category_id = \?, category_override = 0/);
  assert.deepEqual(q.args, ['cat-derivada', 'p-1']);
});

test('T18: buildSetBreedUpdate — UPDATE animal_profiles.breed (nombre); NUNCA toca breed_id (lo deriva el trigger 0113)', () => {
  const q = buildSetBreedUpdate('p-1', 'Aberdeen Angus');
  assert.match(q.sql, /^UPDATE animal_profiles SET breed = \?/);
  // El cliente manda SOLO breed — breed_id lo deriva el trigger server-side 0113 (anti-drift).
  assert.doesNotMatch(q.sql, /breed_id/);
  assert.doesNotMatch(q.sql, /session_id/);
  assert.match(q.sql, /deleted_at IS NULL/);
  assert.deepEqual(q.args, ['Aberdeen Angus', 'p-1']);
});

test('T18: buildSetBreedUpdate — "sin raza" persiste breed = null (el trigger deja breed_id NULL)', () => {
  const q = buildSetBreedUpdate('p-1', null);
  assert.deepEqual(q.args, [null, 'p-1']);
});

test('RCF.3.3/RCF.3.4: buildSetIdvUpdate — UPDATE animal_profiles.idv SOLO; WHERE id + deleted_at IS NULL; args [idv, profileId]', () => {
  const q = buildSetIdvUpdate('p-1', '01234567');
  // SET escribe SOLO idv — no toca ninguna otra columna (NULL→valor, inmutabilidad R4.13 lo permite al subir).
  assert.match(q.sql, /^UPDATE animal_profiles SET idv = \? WHERE id = \? AND deleted_at IS NULL$/);
  assert.doesNotMatch(q.sql, /tag_electronic|category_id|is_cut|establishment_id/);
  assert.doesNotMatch(q.sql, /session_id/);
  // El cliente NO pasa establishment_id (la RLS/unique lo enforzan al subir desde la fila real).
  assert.deepEqual(q.args, ['01234567', 'p-1']);
});

// ─── Ejecución real (node:sqlite): el split INSERT→UPDATE de una corrección NO duplica (R5.9) ─────────

test('M3.1 (node:sqlite): corrección de score = INSERT luego UPDATE del MISMO id → 1 sola fila con el valor corregido', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE condition_score_events (id TEXT PRIMARY KEY, animal_profile_id TEXT, score REAL, ' +
      'event_date TEXT, session_id TEXT, deleted_at TEXT);',
  );
  const ins = buildAddManeuverConditionScoreInsert('cs-1', 'p-1', 3.0, '2026-06-14', 'sess-1');
  db.prepare(ins.sql).run(...(ins.args as (string | number | null)[]));
  const upd = buildUpdateManeuverConditionScore('cs-1', 4.5, '2026-06-14');
  db.prepare(upd.sql).run(...(upd.args as (string | number)[]));
  const rows = db.prepare('SELECT id, score, session_id FROM condition_score_events').all() as {
    id: string; score: number; session_id: string;
  }[];
  db.close();
  assert.equal(rows.length, 1, 'la corrección NO crea una 2da fila (R5.9)');
  assert.equal(rows[0].score, 4.5, 'la fila quedó con el score corregido');
  assert.equal(rows[0].session_id, 'sess-1', 'el session_id del INSERT se conserva (la corrección no lo toca)');
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// DELTA rodeo-grande (spec 10) — vista de grupo scopeada + paginada (Fase 1 builders + Fase 2 composición)
// ════════════════════════════════════════════════════════════════════════════════════════════
//
// Ejecución REAL contra SQLite in-memory (DatabaseSync, node:sqlite): los builders son PUROS, pero acá se ejercita
// su SEMÁNTICA (keyset sin saltos/dup, scope de grupo, overlay, count del grupo entero) — lo que un assert de string
// no captura. Mismo patrón que los tests de comportamiento de buildAnimalsListQuery.

// Esquema mínimo con TODAS las tablas que tocan los builders de grupo (LOCAL_LIST_SELECT + subconsultas apodo +
// in_treatment + candidatos). Las que no se siembran quedan vacías → apodo NULL / in_treatment 0 / has_weaning 0.
const GROUP_SCHEMA =
  'CREATE TABLE animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT, status TEXT, ' +
  'management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, category_override INTEGER, ' +
  'animal_birth_date TEXT, is_castrated INTEGER, future_bull INTEGER, is_cut INTEGER, establishment_id TEXT, ' +
  'deleted_at TEXT, created_at TEXT);' +
  'CREATE TABLE pending_animal_profiles (id TEXT, animal_id TEXT, idv TEXT, category_id TEXT, rodeo_id TEXT, ' +
  'status TEXT, management_group_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, category_override INTEGER, ' +
  'animal_birth_date TEXT, establishment_id TEXT, created_at TEXT);' +
  'CREATE TABLE rodeos (id TEXT, system_id TEXT, name TEXT);' +
  'CREATE TABLE categories_by_system (id TEXT, code TEXT, name TEXT);' +
  'CREATE TABLE pending_status_overrides (target_table TEXT, target_id TEXT, effect TEXT);' +
  'CREATE TABLE custom_attributes (animal_profile_id TEXT, field_definition_id TEXT, value TEXT);' +
  'CREATE TABLE field_definitions (id TEXT, data_key TEXT, establishment_id TEXT);' +
  'CREATE TABLE rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
  'CREATE TABLE pending_rodeo_data_config (rodeo_id TEXT, field_definition_id TEXT, enabled INTEGER);' +
  'CREATE TABLE treatments (id TEXT, animal_profile_id TEXT, ended_at TEXT, deleted_at TEXT);' +
  'CREATE TABLE reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT, deleted_at TEXT);' +
  'CREATE TABLE pending_reproductive_events (id TEXT, animal_profile_id TEXT, event_type TEXT);';

function freshGroupDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(GROUP_SCHEMA);
  db.exec(
    "INSERT INTO rodeos (id, system_id, name) VALUES ('rod-A','sys-1','Rodeo A'),('rod-B','sys-1','Rodeo B');" +
      'INSERT INTO categories_by_system (id, code, name) VALUES ' +
      "('cat-ternero','ternero','Ternero'),('cat-ternera','ternera','Ternera')," +
      "('cat-toro','toro','Toro'),('cat-novillito','novillito','Novillito'),('cat-multipara','multipara','Multípara');",
  );
  return db;
}

type GroupSeed = {
  id: string;
  rodeo?: string;
  lote?: string | null;
  category?: string;
  sex?: string;
  tag?: string | null;
  idv?: string | null;
  status?: string;
  est?: string;
  deleted?: string | null;
  castrated?: 0 | 1;
  created?: string;
};

function insAnimal(db: DatabaseSync, p: GroupSeed): void {
  db.prepare(
    'INSERT INTO animal_profiles (id, animal_id, idv, category_id, rodeo_id, status, management_group_id, ' +
      'animal_tag_electronic, animal_sex, category_override, animal_birth_date, is_castrated, future_bull, ' +
      'is_cut, establishment_id, deleted_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    p.id,
    `an-${p.id}`,
    p.idv ?? null,
    p.category ?? 'cat-ternero',
    p.rodeo ?? 'rod-A',
    p.status ?? 'active',
    p.lote ?? null,
    p.tag ?? null,
    p.sex ?? 'female',
    0,
    null,
    p.castrated ?? 0,
    0,
    0,
    p.est ?? 'est-1',
    p.deleted ?? null,
    p.created ?? '2024-01-01T00:00:00Z',
  );
}

function insPendingAnimal(db: DatabaseSync, p: GroupSeed): void {
  db.prepare(
    'INSERT INTO pending_animal_profiles (id, animal_id, idv, category_id, rodeo_id, status, management_group_id, ' +
      'animal_tag_electronic, animal_sex, category_override, animal_birth_date, establishment_id, created_at) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    p.id,
    `an-${p.id}`,
    p.idv ?? null,
    p.category ?? 'cat-ternero',
    p.rodeo ?? 'rod-A',
    p.status ?? 'active',
    p.lote ?? null,
    p.tag ?? null,
    p.sex ?? 'female',
    0,
    null,
    p.est ?? 'est-1',
    p.created ?? '2024-06-01T00:00:00Z',
  );
}

function idsOf(db: DatabaseSync, q: { sql: string; args: unknown[] }): string[] {
  return (db.prepare(q.sql).all(...(q.args as never[])) as { id: string }[]).map((r) => r.id);
}

// ─── T-RG.2 — buildGroupAnimalsPageQuery: keyset paginado sin saltos/dup + orden + overlay + scope (RG1.4/1.7/1.8) ──

test('T-RG.2: buildGroupAnimalsPageQuery — keyset pagina el grupo sin saltos ni duplicados (desempate id, overlay, scope)', () => {
  const db = freshGroupDb();
  // rod-A: 5 synced con created_at conocidos (p2/p3 EMPATAN en created_at → desempate por id DESC) + 1 overlay.
  insAnimal(db, { id: 'p1', rodeo: 'rod-A', created: '2024-01-05T00:00:00Z' });
  insAnimal(db, { id: 'p2', rodeo: 'rod-A', created: '2024-01-04T00:00:00Z' });
  insAnimal(db, { id: 'p3', rodeo: 'rod-A', created: '2024-01-04T00:00:00Z' }); // empata con p2 → id DESC: p3 antes que p2
  insAnimal(db, { id: 'p4', rodeo: 'rod-A', created: '2024-01-03T00:00:00Z' });
  insAnimal(db, { id: 'p5', rodeo: 'rod-A', created: '2024-01-02T00:00:00Z' });
  insPendingAnimal(db, { id: 'p-opt', rodeo: 'rod-A', created: '2024-01-03T12:00:00Z' }); // overlay, intercalado
  // Ruido que el scope de RODEO debe EXCLUIR: un animal en rod-B (más NUEVO → sería el 1ro si no scopeara).
  insAnimal(db, { id: 'pB', rodeo: 'rod-B', created: '2024-01-10T00:00:00Z' });

  const group: GroupScope = { type: 'rodeo', id: 'rod-A' };
  // Orden total esperado (in_treatment DESC=0, created_at DESC, id DESC): p1, p3, p2, p-opt, p4, p5.
  const expectedOrder = ['p1', 'p3', 'p2', 'p-opt', 'p4', 'p5'];

  // Threading por keyset con pageSize=2 (extrae el cursor de la última fila de cada página, como el service).
  const collected: string[] = [];
  let cursor: GroupPageCursor | null = null;
  for (let i = 0; i < 20; i++) {
    const q = buildGroupAnimalsPageQuery('est-1', group, {}, cursor, 2);
    const rows = db.prepare(q.sql).all(...(q.args as never[])) as {
      id: string; created_at: string; in_treatment: number;
    }[];
    if (rows.length === 0) break;
    collected.push(...rows.map((r) => r.id));
    const last = rows[rows.length - 1];
    cursor = { inTreatment: last.in_treatment === 1 ? 1 : 0, createdAt: last.created_at, id: last.id };
    if (rows.length < 2) break;
  }
  db.close();

  assert.deepEqual(collected, expectedOrder, 'la paginación keyset recorre TODO el grupo en orden, sin saltos');
  assert.equal(new Set(collected).size, collected.length, 'ninguna fila se repite entre páginas (keyset ancla en la última)');
  assert.ok(!collected.includes('pB'), 'el scope de rodeo EXCLUYE animales de otro rodeo (aunque sean más nuevos)');
});

test('T-RG.2: buildGroupAnimalsPageQuery — 1ª página (cursor null) trae las primeras pageSize sin predicado keyset', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'p1', created: '2024-01-05T00:00:00Z' });
  insAnimal(db, { id: 'p2', created: '2024-01-04T00:00:00Z' });
  insAnimal(db, { id: 'p3', created: '2024-01-03T00:00:00Z' });
  const q = buildGroupAnimalsPageQuery('est-1', { type: 'rodeo', id: 'rod-A' }, {}, null, 2);
  assert.doesNotMatch(q.sql, /in_treatment < \?/); // 1ª página SIN keyset
  assert.match(q.sql, /ORDER BY in_treatment DESC, created_at DESC, id DESC LIMIT \?/);
  assert.deepEqual(idsOf(db, q), ['p1', 'p2']);
  db.close();
});

test('T-RG.2: buildGroupAnimalsPageQuery — pin de EN TRATAMIENTO arriba (in_treatment DESC) aunque sea más viejo (RG1.7)', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'pNuevo', created: '2024-01-05T00:00:00Z' }); // más nuevo, sin tratamiento
  insAnimal(db, { id: 'pTrat', created: '2024-01-01T00:00:00Z' }); // más viejo, EN tratamiento → pinned arriba
  db.prepare('INSERT INTO treatments (id, animal_profile_id, ended_at, deleted_at) VALUES (?,?,?,?)')
    .run('t1', 'pTrat', null, null); // tratamiento ABIERTO (ended_at NULL, deleted_at NULL)
  const q = buildGroupAnimalsPageQuery('est-1', { type: 'rodeo', id: 'rod-A' }, {}, null, 60);
  assert.deepEqual(idsOf(db, q), ['pTrat', 'pNuevo'], 'el en-tratamiento se pinnea arriba pese a ser más viejo');
  db.close();
});

test('T-RG.1: buildGroupAnimalsPageQuery — in_treatment idéntico a buildAnimalsListQuery (drift-guard, NO se toca la tab)', () => {
  const exists =
    'EXISTS (SELECT 1 FROM treatments t WHERE t.animal_profile_id = ap.id ' +
    'AND t.ended_at IS NULL AND t.deleted_at IS NULL) AS in_treatment';
  const gq = buildGroupAnimalsPageQuery('est-1', { type: 'rodeo', id: 'rod-A' }, {}, null, 60);
  const aq = buildAnimalsListQuery('est-1');
  assert.ok(gq.sql.includes(exists), 'el page query inyecta el mismo EXISTS de tratamiento');
  assert.ok(aq.sql.includes(exists), 'buildAnimalsListQuery conserva el mismo EXISTS (no se tocó)');
});

test('T-RG.2: buildGroupAnimalsPageQuery — scope de LOTE (management_group_id) + filtros de chips categoría/sexo (RG3.5)', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'lTernero', lote: 'lote-1', category: 'cat-ternero', sex: 'male', created: '2024-01-05T00:00:00Z' });
  insAnimal(db, { id: 'lToroH', lote: 'lote-1', category: 'cat-multipara', sex: 'female', created: '2024-01-04T00:00:00Z' });
  insAnimal(db, { id: 'lToroM', lote: 'lote-1', category: 'cat-toro', sex: 'male', created: '2024-01-03T00:00:00Z' });
  insAnimal(db, { id: 'otroLote', lote: 'lote-2', category: 'cat-ternero', sex: 'male', created: '2024-01-06T00:00:00Z' }); // otro lote

  const lote: GroupScope = { type: 'lote', id: 'lote-1' };
  // Sin filtro → los 3 del lote-1, excluye lote-2.
  assert.deepEqual(
    idsOf(db, buildGroupAnimalsPageQuery('est-1', lote, {}, null, 60)).sort(),
    ['lTernero', 'lToroH', 'lToroM'],
  );
  // Filtro categoría 'ternero' → solo lTernero.
  assert.deepEqual(idsOf(db, buildGroupAnimalsPageQuery('est-1', lote, { categoryCode: 'ternero' }, null, 60)), ['lTernero']);
  // Filtro sexo 'male' → lTernero + lToroM (excluye la hembra).
  assert.deepEqual(idsOf(db, buildGroupAnimalsPageQuery('est-1', lote, { sex: 'male' }, null, 60)).sort(), ['lTernero', 'lToroM']);
  // Combinado categoría 'toro' + sexo 'male' → solo lToroM.
  assert.deepEqual(idsOf(db, buildGroupAnimalsPageQuery('est-1', lote, { categoryCode: 'toro', sex: 'male' }, null, 60)), ['lToroM']);
  db.close();
});

test('T-RG.2: buildGroupAnimalsPageQuery — filtros de dominio: excluye no-activo/borrado/exit pendiente/otro campo (RG1.8/RG6.5)', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'ok', rodeo: 'rod-A', created: '2024-01-05T00:00:00Z' });
  insAnimal(db, { id: 'sold', rodeo: 'rod-A', status: 'sold', created: '2024-01-04T00:00:00Z' });
  insAnimal(db, { id: 'del', rodeo: 'rod-A', deleted: '2026-01-01T00:00:00Z', created: '2024-01-04T00:00:00Z' });
  insAnimal(db, { id: 'exit', rodeo: 'rod-A', created: '2024-01-04T00:00:00Z' });
  db.prepare('INSERT INTO pending_status_overrides (target_table, target_id, effect) VALUES (?,?,?)')
    .run('animal_profiles', 'exit', 'exited'); // baja optimista pendiente → oculto
  insAnimal(db, { id: 'otroEst', rodeo: 'rod-A', est: 'est-2', created: '2024-01-04T00:00:00Z' }); // otro tenant
  const q = buildGroupAnimalsPageQuery('est-1', { type: 'rodeo', id: 'rod-A' }, {}, null, 60);
  assert.deepEqual(idsOf(db, q), ['ok'], 'solo el activo del campo activo del rodeo; sold/deleted/exit/otro-campo fuera');
  // Multi-tenant: el establishment_id va por arg (no hardcode); el scope de grupo es filtro de dominio adicional.
  assert.match(q.sql, /ap\.establishment_id = \?/);
  assert.match(q.sql, /ap\.rodeo_id = \?/);
  db.close();
});

// ─── T-RG.4 — buildAllGroupMembersQuery: set completo scopeado, sin tope (RG5.3/RG5.4) ──────────────────────

test('T-RG.4: buildAllGroupMembersQuery — TODOS los miembros del grupo (rodeo/lote), overlay, sin LIMIT; excluye no-activos', () => {
  const db = freshGroupDb();
  // Lote cross-rodeo: 3 en rod-A + 2 en rod-B, todos del lote-1.
  insAnimal(db, { id: 'L1', lote: 'lote-1', rodeo: 'rod-A', created: '2024-01-05T00:00:00Z' });
  insAnimal(db, { id: 'L2', lote: 'lote-1', rodeo: 'rod-A', created: '2024-01-04T00:00:00Z' });
  insAnimal(db, { id: 'L3', lote: 'lote-1', rodeo: 'rod-B', created: '2024-01-03T00:00:00Z' });
  insPendingAnimal(db, { id: 'Lopt', lote: 'lote-1', rodeo: 'rod-A', created: '2024-06-01T00:00:00Z' }); // overlay
  // Excluidos: no-lote, otro lote, sold, deleted, exit pendiente, otro campo.
  insAnimal(db, { id: 'noLote', lote: null, rodeo: 'rod-A', created: '2024-01-06T00:00:00Z' });
  insAnimal(db, { id: 'Lsold', lote: 'lote-1', status: 'sold', created: '2024-01-02T00:00:00Z' });
  insAnimal(db, { id: 'Ldel', lote: 'lote-1', deleted: '2026-01-01T00:00:00Z', created: '2024-01-02T00:00:00Z' });
  insAnimal(db, { id: 'Lexit', lote: 'lote-1', created: '2024-01-02T00:00:00Z' });
  db.prepare('INSERT INTO pending_status_overrides (target_table, target_id, effect) VALUES (?,?,?)')
    .run('animal_profiles', 'Lexit', 'exited');
  insAnimal(db, { id: 'LotherEst', lote: 'lote-1', est: 'est-2', created: '2024-01-02T00:00:00Z' });

  const q = buildAllGroupMembersQuery('est-1', { type: 'lote', id: 'lote-1' });
  // Sin LIMIT de TOPE: la query externa termina en el ORDER BY (el `LIMIT 1` que aparece es de la subconsulta
  // correlada del apodo, no un tope del result set). El corte real de "sin tope" lo prueba T-RG.15 (>200 en campo).
  assert.match(q.sql, /ORDER BY in_treatment DESC, created_at DESC, id DESC$/, 'el set completo NO lleva LIMIT de tope (RG5.3)');
  assert.deepEqual(idsOf(db, q).sort(), ['L1', 'L2', 'L3', 'Lopt'], 'todos los miembros activos del lote + overlay; el resto fuera');

  // Variante RODEO: todos los activos de rod-A (L1, L2, Lopt, noLote, Lexit? no — exit oculto; Lsold/Ldel fuera).
  const rq = buildAllGroupMembersQuery('est-1', { type: 'rodeo', id: 'rod-A' });
  assert.deepEqual(idsOf(db, rq).sort(), ['L1', 'L2', 'Lopt', 'noLote']);
  db.close();
});

// ─── T-RG.15 — regresión del bug del lote: >200 en el campo NO trunca los miembros (RG5.4) ──────────────────

test('T-RG.15: buildAllGroupMembersQuery — el lote muestra TODOS sus miembros aun con >200 animales MÁS NUEVOS en el campo', () => {
  const db = freshGroupDb();
  // 5 miembros del lote, VIEJOS (2024). Bajo el viejo "200 más recientes del CAMPO" quedarían FUERA.
  for (let i = 0; i < 5; i++) {
    insAnimal(db, { id: `mem-${i}`, lote: 'lote-1', rodeo: 'rod-A', created: `2024-01-0${i + 1}T00:00:00Z` });
  }
  // 210 animales del campo SIN lote, MÁS NUEVOS (2025) → llenarían de sobra un LIMIT 200 del campo.
  for (let i = 0; i < 210; i++) {
    const n = String(i).padStart(3, '0');
    insAnimal(db, { id: `field-${n}`, lote: null, rodeo: 'rod-A', created: `2025-01-01T00:00:${n.slice(-2)}Z` });
  }
  const q = buildAllGroupMembersQuery('est-1', { type: 'lote', id: 'lote-1' });
  const ids = idsOf(db, q);
  assert.equal(ids.length, 5, 'los 5 miembros del lote aparecen (la query scopea por management_group_id, no "200 del campo")');
  assert.deepEqual(ids.sort(), ['mem-0', 'mem-1', 'mem-2', 'mem-3', 'mem-4']);
  db.close();
});

// ─── T-RG.6 — buildGroupCandidateCountsQuery: candidatos del GRUPO ENTERO (RG5.2) ───────────────────────────

test('T-RG.6: buildGroupCandidateCountsQuery — castrar EXACTO (macho entero) + destetar APROX (ternero/a sin weaning), overlay', () => {
  const db = freshGroupDb();
  // rod-A. Castrar = animal_sex='male' AND is_castrated=0.
  insAnimal(db, { id: 'mEntero1', rodeo: 'rod-A', sex: 'male', category: 'cat-ternero', castrated: 0 }); // castrate ✓ + wean ✓
  insAnimal(db, { id: 'mEntero2', rodeo: 'rod-A', sex: 'male', category: 'cat-toro', castrated: 0 }); // castrate ✓ (no wean: no ternero)
  insAnimal(db, { id: 'mCastrado', rodeo: 'rod-A', sex: 'male', category: 'cat-novillito', castrated: 1 }); // NO castrate
  insAnimal(db, { id: 'hembra', rodeo: 'rod-A', sex: 'female', category: 'cat-multipara' }); // NO castrate
  insAnimal(db, { id: 'terneraSinDest', rodeo: 'rod-A', sex: 'female', category: 'cat-ternera' }); // wean ✓
  insAnimal(db, { id: 'terneroDestetado', rodeo: 'rod-A', sex: 'male', category: 'cat-ternero', castrated: 0 }); // castrate ✓, wean ✗ (ya destetado)
  db.prepare('INSERT INTO reproductive_events (id, animal_profile_id, event_type, deleted_at) VALUES (?,?,?,?)')
    .run('w1', 'terneroDestetado', 'weaning', null); // weaning vivo → excluye de wean
  // Overlay: un alta optimista macho ternero → castrate ✓ + wean ✓.
  insPendingAnimal(db, { id: 'optMacho', rodeo: 'rod-A', sex: 'male', category: 'cat-ternero' });

  // Sin restricción de rodeo (undefined) → cuenta todos los terneros/as del grupo para wean.
  const q = buildGroupCandidateCountsQuery('est-1', { type: 'rodeo', id: 'rod-A' }, {});
  const row = db.prepare(q.sql).get(...(q.args as never[])) as { castrate: number; wean: number };
  // Castrar: mEntero1, mEntero2, terneroDestetado, optMacho = 4.
  assert.equal(row.castrate, 4, 'castrar = machos enteros (incluye overlay), excluye castrado/hembra');
  // Destetar: mEntero1, terneraSinDest, optMacho = 3 (terneroDestetado excluido por weaning vivo).
  assert.equal(row.wean, 3, 'destetar = terneros/as sin weaning vivo (incluye overlay), excluye ya-destetado');
  db.close();
});

test('T-RG.6: buildGroupCandidateCountsQuery — lote cross-rodeo: destete SOLO cuenta terneros de rodeo con destete (RG5.2/R7.2)', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'tA', lote: 'lote-9', rodeo: 'rod-A', sex: 'female', category: 'cat-ternera' }); // rod-A (con destete)
  insAnimal(db, { id: 'tB', lote: 'lote-9', rodeo: 'rod-B', sex: 'male', category: 'cat-ternero', castrated: 0 }); // rod-B (sin destete)
  const group: GroupScope = { type: 'lote', id: 'lote-9' };

  // Solo rod-A habilita destete → wean cuenta solo tA (1); tB (rod-B) excluido. Castrar es exacto (tB entero) = 1.
  const q1 = buildGroupCandidateCountsQuery('est-1', group, { weaningEnabledRodeoIds: ['rod-A'] });
  const r1 = db.prepare(q1.sql).get(...(q1.args as never[])) as { castrate: number; wean: number };
  assert.equal(r1.wean, 1, 'solo el ternero del rodeo con destete cuenta');
  assert.equal(r1.castrate, 1, 'castrar es exacto e independiente del destete (el ternero macho entero de rod-B)');

  // Set VACÍO → ningún rodeo con destete → wean = 0 (sin `IN ()` inválido).
  const q2 = buildGroupCandidateCountsQuery('est-1', group, { weaningEnabledRodeoIds: [] });
  const r2 = db.prepare(q2.sql).get(...(q2.args as never[])) as { castrate: number; wean: number };
  assert.equal(r2.wean, 0, 'ningún rodeo con destete → 0 candidatos de destete');
  assert.equal(r2.castrate, 1, 'castrar no depende del destete');
  db.close();
});

// ─── T-RG.17 — gating por candidatos del GRUPO ENTERO: COUNT SQL → applyCandidateGating (composición) ────────

test('T-RG.17: gating ofrece/oculta Castrar/Destetar según los candidatos del GRUPO ENTERO (no una página parcial)', () => {
  const db = freshGroupDb();
  // Grupo con 1 candidato a castración y 1 a destete, "escondidos" al final del orden (created_at viejos) — el COUNT
  // los ve igual porque NO tiene LIMIT (a diferencia de contar sobre una página cargada).
  insAnimal(db, { id: 'macho', rodeo: 'rod-A', sex: 'male', category: 'cat-ternero', castrated: 0, created: '2020-01-01T00:00:00Z' });
  insAnimal(db, { id: 'ternera', rodeo: 'rod-A', sex: 'female', category: 'cat-ternera', created: '2020-01-01T00:00:00Z' });
  const counts = db.prepare(
    buildGroupCandidateCountsQuery('est-1', { type: 'rodeo', id: 'rod-A' }, { weaningEnabledRodeoIds: ['rod-A'] }).sql,
  ).get(
    ...(buildGroupCandidateCountsQuery('est-1', { type: 'rodeo', id: 'rod-A' }, { weaningEnabledRodeoIds: ['rod-A'] }).args as never[]),
  ) as { castrate: number; wean: number };

  const config = resolveGroupActions([{ vaccinationEnabled: true, weaningEnabled: true }]);
  const gating = applyCandidateGating(config, counts);
  assert.equal(gating.castrate, true, 'hay ≥1 macho entero → ofrece Castrar');
  assert.equal(gating.wean, true, 'config destete ON + ≥1 candidato → ofrece Destetar');

  // Grupo sin candidatos → no ofrece Castrar ni Destetar (aunque la config los tenga habilitados).
  const db2 = freshGroupDb();
  insAnimal(db2, { id: 'vaca', rodeo: 'rod-A', sex: 'female', category: 'cat-multipara' });
  const empty = db2.prepare(
    buildGroupCandidateCountsQuery('est-1', { type: 'rodeo', id: 'rod-A' }, { weaningEnabledRodeoIds: ['rod-A'] }).sql,
  ).get(
    ...(buildGroupCandidateCountsQuery('est-1', { type: 'rodeo', id: 'rod-A' }, { weaningEnabledRodeoIds: ['rod-A'] }).args as never[]),
  ) as { castrate: number; wean: number };
  const gating2 = applyCandidateGating(resolveGroupActions([{ vaccinationEnabled: true, weaningEnabled: true }]), empty);
  assert.equal(gating2.castrate, false, 'sin machos enteros → NO ofrece Castrar');
  assert.equal(gating2.wean, false, 'sin candidatos a destete → NO ofrece Destetar');
  db.close();
  db2.close();
});

// ─── T-RG.7 — buildGroupCategoryOptionsQuery: DISTINCT categorías presentes en el grupo (RG3.9) ──────────────

test('T-RG.7: buildGroupCategoryOptionsQuery — DISTINCT categorías del grupo (scopeado + overlay), ordenadas por nombre', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'a', rodeo: 'rod-A', category: 'cat-ternero' });
  insAnimal(db, { id: 'b', rodeo: 'rod-A', category: 'cat-ternero' }); // duplicado de categoría → DISTINCT colapsa
  insAnimal(db, { id: 'c', rodeo: 'rod-A', category: 'cat-toro' });
  insPendingAnimal(db, { id: 'd', rodeo: 'rod-A', category: 'cat-multipara' }); // overlay
  insAnimal(db, { id: 'other', rodeo: 'rod-B', category: 'cat-novillito' }); // otro rodeo → excluido del scope
  const rows = db
    .prepare(buildGroupCategoryOptionsQuery('est-1', { type: 'rodeo', id: 'rod-A' }).sql)
    .all(...(buildGroupCategoryOptionsQuery('est-1', { type: 'rodeo', id: 'rod-A' }).args as never[])) as {
    code: string; name: string;
  }[];
  // Presentes en rod-A: ternero, toro, multipara (overlay). Orden por nombre: Multípara, Ternero, Toro.
  assert.deepEqual(rows.map((r) => r.code), ['multipara', 'ternero', 'toro']);
  assert.ok(!rows.some((r) => r.code === 'novillito'), 'la categoría de otro rodeo NO aparece (scope)');
  db.close();
});

// ─── buildGroupSexOptionsQuery: sexos DISTINTOS presentes en el grupo (RG3.9, soporte del chip de sexo) ──────

test('buildGroupSexOptionsQuery — DISTINCT animal_sex del grupo (scopeado + overlay); un solo sexo NO ofrece ambos', () => {
  const db = freshGroupDb();
  // Grupo mixto (rod-A): ambos sexos → el hook mostrará el chip. Duplicados colapsan por DISTINCT.
  insAnimal(db, { id: 'a', rodeo: 'rod-A', sex: 'male' });
  insAnimal(db, { id: 'b', rodeo: 'rod-A', sex: 'male' });
  insAnimal(db, { id: 'c', rodeo: 'rod-A', sex: 'female' });
  insPendingAnimal(db, { id: 'd', rodeo: 'rod-A', sex: 'female' }); // overlay
  insAnimal(db, { id: 'other', rodeo: 'rod-B', sex: 'male' }); // otro rodeo → excluido del scope
  const mixed = buildGroupSexOptionsQuery('est-1', { type: 'rodeo', id: 'rod-A' });
  const sexes = (db.prepare(mixed.sql).all(...(mixed.args as never[])) as { animal_sex: string }[])
    .map((r) => r.animal_sex)
    .sort();
  assert.deepEqual(sexes, ['female', 'male'], 'ambos sexos presentes en rod-A (synced + overlay)');

  // Lote homogéneo (solo machos) → un solo sexo (el hook NO ofrece el chip).
  insAnimal(db, { id: 'm1', lote: 'lote-1', sex: 'male' });
  insAnimal(db, { id: 'm2', lote: 'lote-1', sex: 'male' });
  const single = buildGroupSexOptionsQuery('est-1', { type: 'lote', id: 'lote-1' });
  const one = (db.prepare(single.sql).all(...(single.args as never[])) as { animal_sex: string }[]).map((r) => r.animal_sex);
  assert.deepEqual(one, ['male'], 'lote homogéneo → un solo sexo');
  db.close();
});

// ─── T-RG.9 — buildSearchUnion groupScope: búsqueda scopeada al grupo (RG3.2) + no-regresión sin scope (RG7.1) ─

test('T-RG.9: buildSearch*Query con groupScope — matchea SOLO el grupo; sin scope → set completo (no-regresión tab)', () => {
  const db = freshGroupDb();
  // Mismo TAG en dos rodeos (permitido en el fixture): scopear debe distinguirlos.
  insAnimal(db, { id: 'inA', rodeo: 'rod-A', tag: '999000000000001', created: '2024-01-02T00:00:00Z' });
  insAnimal(db, { id: 'inB', rodeo: 'rod-B', tag: '999000000000001', created: '2024-01-01T00:00:00Z' });

  // Con scope de rod-A → solo inA.
  assert.deepEqual(idsOf(db, buildSearchByTagQuery('est-1', '999000000000001', { type: 'rodeo', id: 'rod-A' })), ['inA']);
  // Sin scope → ambos (comportamiento de la tab Animales, RG7.1).
  assert.deepEqual(idsOf(db, buildSearchByTagQuery('est-1', '999000000000001')).sort(), ['inA', 'inB']);
  db.close();
});

test('T-RG.9: buildSearchByTagQuery — sin groupScope el SQL+args son los del as-built (cero regresión, RG7.1)', () => {
  const noScope = buildSearchByTagQuery('est-1', 'TAG');
  assert.doesNotMatch(noScope.sql, /ap\.rodeo_id = \?|pap\.rodeo_id = \?/, 'sin scope NO agrega el filtro de grupo');
  assert.deepEqual(noScope.args, ['est-1', 'active', 'TAG', 'est-1', 'active', 'TAG'], 'args idénticos al as-built (6, sin scope)');

  const withScope = buildSearchByTagQuery('est-1', 'TAG', { type: 'lote', id: 'lote-1' });
  assert.match(withScope.sql, /AND ap\.management_group_id = \?/);
  assert.match(withScope.sql, /AND pap\.management_group_id = \?/);
  assert.deepEqual(withScope.args, ['est-1', 'active', 'TAG', 'lote-1', 'est-1', 'active', 'TAG', 'lote-1'], 'scope agrega group.id a cada rama');
});

// ─── buildGroupRodeoIdsQuery: rodeos representados en el grupo (soporte del gating de lote, RG5.2) ───────────

test('T-RG.16-support: buildGroupRodeoIdsQuery — DISTINCT rodeos de los miembros del lote (scopeado, overlay-aware)', () => {
  const db = freshGroupDb();
  insAnimal(db, { id: 'm1', lote: 'lote-1', rodeo: 'rod-A' });
  insAnimal(db, { id: 'm2', lote: 'lote-1', rodeo: 'rod-A' }); // mismo rodeo → DISTINCT colapsa
  insAnimal(db, { id: 'm3', lote: 'lote-1', rodeo: 'rod-B' });
  insPendingAnimal(db, { id: 'm4', lote: 'lote-1', rodeo: 'rod-B' }); // overlay, mismo rod-B
  insAnimal(db, { id: 'otro', lote: 'lote-2', rodeo: 'rod-B' }); // otro lote → excluido
  const q = buildGroupRodeoIdsQuery('est-1', { type: 'lote', id: 'lote-1' });
  const rodeos = (db.prepare(q.sql).all(...(q.args as never[])) as { rodeo_id: string }[]).map((r) => r.rodeo_id).sort();
  assert.deepEqual(rodeos, ['rod-A', 'rod-B'], 'los rodeos representados en el lote (DISTINCT), sin el de otro lote');
  db.close();
});
