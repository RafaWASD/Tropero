// supabase/tests/custom/run.cjs
// Suite de tests no-bypass del chunk M5-BACKEND de la spec 03-modo-maniobras (datos/maniobras CUSTOM).
// Cubre US-13 (R13.2/R13.3/R13.4/R13.13/R13.14/R13.15/R13.16/R13.17/R13.19/R13.21/R13.22/R13.23/
// R13.24/R13.25/R13.26/R13.27) + los casos (a)–(n) del fix-loop de Gate 1 M5 (security_spec_03-m5-custom.md).
// (e) = FRONTERA WAL (R13.21), espejo de supabase/tests/sync_streams/run.cjs (simula el predicado de la
// stream a mano con service_role + el org_scope de cada actor). Es la capa del SYNC STREAM (el WAL ignora
// la RLS de PostgREST que cubre (a)/R13.22) → barrera distinta. Numeración: a,b,c,d,e,f,g,h,i,j,k,l,m,n.
//
// Corre contra la base REMOTA: service_role para fixtures + las filas GLOBALES de field_definitions
// (las custom de cliente NUNCA se siembran por service_role: se crean por el owner para ejercer la RLS/
// guard reales); JWTs reales para los asserts de RLS/triggers/gating. Limpia users/establishments
// al final (CASCADE). Mapa R<n> -> test en progress/impl_03-m5-backend.md.
//
// ⚠️ Esta suite NO puede correr hasta que el LEADER aplique las migraciones 0093–0097 a la DB remota.
//    Escrita completa; se corre POST-APPLY. (El SQL de las migraciones parsea; este archivo pasa node --check.)
//
// Uso: las vars se cargan desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const envLocalPath = path.join(REPO_ROOT, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envText = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

const supabaseJsPath = path.join(REPO_ROOT, 'app', 'node_modules', '@supabase', 'supabase-js');
const { createClient: createClientRaw } = require(supabaseJsPath);
const ws = require(path.join(REPO_ROOT, 'app', 'node_modules', 'ws'));

function createClient(url, key, opts = {}) {
  return createClientRaw(url, key, {
    ...opts,
    realtime: { ...(opts.realtime || {}), transport: ws },
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Faltan vars de Supabase (URL / SERVICE_ROLE_KEY / ANON_KEY).');
  process.exit(2);
}

const RUN_TAG = `custom_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];
const createdGlobalFieldIds = []; // field_definitions GLOBALES sembradas por service_role (limpiar a mano).

// ---- helpers de fixtures (mismo patrón que supabase/tests/maneuvers/run.cjs) ----

async function createTestUser(label) {
  const email = `${RUN_TAG}_${label}@rafaq-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name: `Test ${label}` },
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function getUserClient(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createEstablishmentAs(userClient, name) {
  const { error: insErr } = await userClient.from('establishments').insert({ name, province: 'Buenos Aires' });
  if (insErr) throw new Error(`createEstablishment insert(${name}): ${insErr.message}`);
  const { data, error } = await userClient.from('establishments').select('id').eq('name', name).single();
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function assignRoleAsService(userId, establishmentId, role) {
  const { error } = await admin.from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
}

async function lookupSpeciesSystem(client, speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp, error: spErr } = await client.from('species').select('id').eq('code', speciesCode).single();
  if (spErr) throw new Error(`lookup species: ${spErr.message}`);
  const { data: sys, error: sysErr } = await client.from('systems_by_species')
    .select('id').eq('species_id', sp.id).eq('code', systemCode).single();
  if (sysErr) throw new Error(`lookup system: ${sysErr.message}`);
  return { speciesId: sp.id, systemId: sys.id };
}

async function categoryId(client, systemId, code) {
  const { data, error } = await client.from('categories_by_system')
    .select('id').eq('system_id', systemId).eq('code', code).single();
  if (error) throw new Error(`lookup category ${code}: ${error.message}`);
  return data.id;
}

async function createRodeo(client, { establishmentId, name, systemCode = 'cria' }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client, 'bovino', systemCode);
  const { error: insErr } = await client.from('rodeos')
    .insert({ establishment_id: establishmentId, name, species_id: speciesId, system_id: systemId });
  if (insErr) throw new Error(`createRodeo insert(${name}): ${insErr.message}`);
  const { data, error } = await client.from('rodeos')
    .select('id, system_id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

async function createAnimal(client, { idv = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = crypto.randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (birthDate) animalPayload.birth_date = birthDate;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) return { error: aErr };
  const catId = await categoryId(client, systemId, categoryCode || (sex === 'male' ? 'torito' : 'vaquillona'));
  const profileId = crypto.randomUUID();
  const profilePayload = {
    id: profileId, animal_id: animalId, establishment_id: establishmentId,
    rodeo_id: rodeoId, category_id: catId, status: 'active',
  };
  if (idv) profilePayload.idv = idv;
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };
  return { profile: { id: profileId, rodeo_id: rodeoId }, animalId };
}

// --- helpers propios de M5 custom ---

// createCustomField: owner crea una field_definitions custom (establishment_id propio). Split insert+select
// (RLS-on-RETURNING; ADR-012). Devuelve { error } o { field: { id } }.
async function createCustomField(client, { establishmentId, dataKey, label, dataType = 'maniobra', uiComponent = 'numeric', configSchema = null, description = null, category = null }) {
  const id = crypto.randomUUID();
  const payload = {
    id, establishment_id: establishmentId, data_key: dataKey, label,
    data_type: dataType, ui_component: uiComponent, category: category || 'manejo',
  };
  if (configSchema !== null) payload.config_schema = configSchema;
  if (description !== null) payload.description = description;
  const { error: insErr } = await client.from('field_definitions').insert(payload);
  if (insErr) return { error: insErr, id };
  const { data, error } = await client.from('field_definitions').select('id').eq('id', id).maybeSingle();
  if (error) return { error, id };
  return { field: data ? { id: data.id } : { id }, id };
}

// createGlobalFieldAsService: siembra una field_definitions GLOBAL (establishment_id NULL) por service_role.
// Para el caso (g): un ui_component fuera de los 7 (composite) que el CHECK de dominio NO restringe en globales.
async function createGlobalFieldAsService({ dataKey, label, dataType, uiComponent, configSchema = null }) {
  const id = crypto.randomUUID();
  const payload = { id, data_key: dataKey, label, data_type: dataType, ui_component: uiComponent, category: 'manejo' };
  if (configSchema !== null) payload.config_schema = configSchema;
  const { error } = await admin.from('field_definitions').insert(payload);
  if (error) throw new Error(`createGlobalFieldAsService(${dataKey}): ${error.message}`);
  createdGlobalFieldIds.push(id);
  return { id };
}

// enableCustomFieldInRodeo: owner prende una field custom en un rodeo (rodeo_data_config, FK por id).
// Espera a que el toggle propague (read-after-write lag del remoto compartido) antes de seguir.
async function enableCustomFieldInRodeo(client, rodeoId, fieldId, enabled = true) {
  // rodeo_data_config: upsert (PK (rodeo_id, field_definition_id)). El owner puede INSERT/UPDATE (0018).
  const { error } = await client.from('rodeo_data_config')
    .upsert({ rodeo_id: rodeoId, field_definition_id: fieldId, enabled }, { onConflict: 'rodeo_id,field_definition_id' });
  if (error) throw new Error(`enableCustomFieldInRodeo: ${error.message}`);
  await eventually(
    async () => {
      const { data } = await client.from('rodeo_data_config')
        .select('enabled').eq('rodeo_id', rodeoId).eq('field_definition_id', fieldId).maybeSingle();
      return data;
    },
    (row) => row && row.enabled === enabled,
  );
}

// insertMeasurement: captura custom (CRUD-plano: NO se manda recorded_by/establishment_id; los fuerza el trigger).
async function insertMeasurement(client, { animalProfileId, fieldId, value, sessionId = null, notes = null, establishmentId = undefined, recordedBy = undefined }) {
  const id = crypto.randomUUID();
  const payload = { id, animal_profile_id: animalProfileId, field_definition_id: fieldId, value };
  if (sessionId) payload.session_id = sessionId;
  if (notes !== null) payload.notes = notes;
  // para los tests de anti-spoof: mandamos valores AJENOS a propósito (el trigger debe ignorarlos).
  if (establishmentId !== undefined) payload.establishment_id = establishmentId;
  if (recordedBy !== undefined) payload.recorded_by = recordedBy;
  const { error } = await client.from('custom_measurements').insert(payload);
  return { error, id };
}

async function upsertAttribute(client, { animalProfileId, fieldId, value, establishmentId = undefined, updatedBy = undefined }) {
  const payload = { animal_profile_id: animalProfileId, field_definition_id: fieldId, value };
  if (establishmentId !== undefined) payload.establishment_id = establishmentId;
  if (updatedBy !== undefined) payload.updated_by = updatedBy;
  const { error } = await client.from('custom_attributes')
    .upsert(payload, { onConflict: 'animal_profile_id,field_definition_id' });
  return { error };
}

function pgcode(error) {
  return String((error && (error.code || '')) + ' ' + (error && (error.message || '')));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function eventually(fn, predicate, { tries = 6, delay = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) { last = await fn(); if (predicate(last)) return last; await sleep(delay); }
  return last;
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// ── Simulación de la FRONTERA WAL (espejo de supabase/tests/sync_streams/run.cjs) ──────────────────
// La frontera del SYNC STREAM (lo que un device recibiría por PowerSync) NO es la RLS de PostgREST: el
// WAL replica la tabla base ignorando RLS/views/RPC (ADR-025; sync_streams/run.cjs l.6-9). El contenido
// de cada stream (sync-streams/rafaq.yaml) ES la frontera. Lo testeamos aplicando el PREDICADO de la
// stream a mano con el cliente service_role (que BYPASSA la RLS) y el scope de cada actor → el SET de
// filas que la stream le daría a su device. NO usamos auth.user_id() (no hay sesión PostgREST acá); el
// equivalente exacto es filtrar user_roles por user_id = <actor> AND active = true.
//   org_scope = SELECT establishment_id FROM user_roles WHERE user_id = <actor> AND active = true
async function orgScope(userId) {
  const { data, error } = await admin
    .from('user_roles').select('establishment_id').eq('user_id', userId).eq('active', true);
  if (error) throw new Error(`orgScope(${userId}): ${error.message}`);
  return [...new Set((data || []).map((r) => r.establishment_id))];
}

// catalogFieldDefSet: el SET de field_definitions que la stream GLOBAL `catalog_field_definitions`
// emite (rafaq.yaml l.56-59): SELECT * FROM field_definitions WHERE establishment_id IS NULL. Es global
// (sin scope por actor): el mismo set para TODOS. Devuelve los ids.
async function catalogFieldDefSet() {
  const { data, error } = await admin
    .from('field_definitions').select('id').is('establishment_id', null);
  if (error) throw new Error(`catalogFieldDefSet: ${error.message}`);
  return (data || []).map((r) => r.id);
}

// customSyncSetIds: el SET de filas de una tabla custom per-establishment que la stream le daría al
// device de un actor (rafaq.yaml l.229-249): WHERE establishment_id IN org_scope [AND deleted_at IS NULL].
// scope vacío → set vacío (un actor sin rol en NINGÚN campo no recibe nada). custom_attributes NO tiene
// deleted_at propio (current-value, by design) → withDeletedAtFilter=false para esa tabla.
async function customSyncSetIds(table, scope, { withDeletedAtFilter = true, idCol = 'id' } = {}) {
  if (scope.length === 0) return [];
  let q = admin.from(table).select(idCol).in('establishment_id', scope);
  if (withDeletedAtFilter) q = q.is('deleted_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`customSyncSetIds(${table}): ${error.message}`);
  return (data || []).map((r) => r[idCol]);
}

// Para custom_attributes (PK compuesta, sin id propio): traer las filas que matchean un perfil dentro
// del scope del actor, para verificar pertenencia/exclusión cross-tenant por (animal_profile_id, field).
async function customAttrSyncRows(scope, animalProfileId) {
  if (scope.length === 0) return [];
  const { data, error } = await admin
    .from('custom_attributes').select('animal_profile_id, field_definition_id, establishment_id')
    .in('establishment_id', scope).eq('animal_profile_id', animalProfileId);
  if (error) throw new Error(`customAttrSyncRows: ${error.message}`);
  return data || [];
}

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin.from('animal_profiles')
      .select('id, animal_id').in('establishment_id', createdEstablishmentIds);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id))];
    // custom_measurements/custom_attributes/custom field_definitions cascadean por establishment.
    const { error: estErr } = await admin.from('establishments').delete().in('id', createdEstablishmentIds);
    if (estErr) console.error('cleanup establishments:', estErr.message);
    if (animalIds.length > 0) {
      const { error: anErr } = await admin.from('animals').delete().in('id', animalIds);
      if (anErr) console.error('cleanup animals:', anErr.message);
    }
  }
  if (createdGlobalFieldIds.length > 0) {
    const { error } = await admin.from('field_definitions').delete().in('id', createdGlobalFieldIds);
    if (error) console.error('cleanup global fields:', error.message);
  }
  for (const uid of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

// =====================================================================
// Suite
// =====================================================================

test('custom (M5) suite — spec 03', async (t) => {
  let userA, userAB, userC, userOp, clientA, clientAB, clientC, clientOp, estA, estB;
  let rodeoA, rodeoB;
  let fNumeric, fEnumSingle, fEnumMulti, fBoolean, fText, fDate, fProp; // fields custom de estA
  let animA, animA_noField, profSoftDel;

  // ---- setup --------------------------------------------------------------
  await t.test('setup: usuarios, establishments, rodeos, animales', async () => {
    userA = await createTestUser('userA');   // owner estA
    userAB = await createTestUser('userAB'); // owner estA *Y* estB (caso M5-SEC-02 owner-de-A+B)
    userC = await createTestUser('userC');   // sin rol en estA
    userOp = await createTestUser('userOp'); // field_operator (NO owner) en estA — captura por rol no-owner (R13.13, Obs-1)
    clientA = await getUserClient(userA.email);
    clientAB = await getUserClient(userAB.email);
    clientC = await getUserClient(userC.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientAB, `${RUN_TAG} estB`); // userAB es owner de estB
    // userAB también owner de estA (para el caso de mudar una custom de A→B).
    await assignRoleAsService(userAB.id, estA, 'owner');
    clientAB = await getUserClient(userAB.email); // re-firmar tras el nuevo rol
    // userOp = rol operativo NO-owner en estA (R13.13: captura = cualquier rol operativo activo).
    await assignRoleAsService(userOp.id, estA, 'field_operator');
    clientOp = await getUserClient(userOp.email); // firmar DESPUÉS del rol (el JWT no lleva el rol, pero la sesión sí existe)
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A1' });
    rodeoB = await createRodeo(clientAB, { establishmentId: estB, name: 'Rodeo B1' });

    animA = await createAnimal(clientA, { idv: `${RUN_TAG}_A1`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    assert.equal(animA.error, undefined, animA.error && animA.error.message);
    animA_noField = await createAnimal(clientA, { idv: `${RUN_TAG}_A2`, sex: 'female', birthDate: daysAgo(560), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    assert.equal(animA_noField.error, undefined, animA_noField.error && animA_noField.error.message);
    // perfil que vamos a soft-deletear para el fail-closed.
    const sd = await createAnimal(clientA, { idv: `${RUN_TAG}_SD`, sex: 'female', birthDate: daysAgo(570), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    assert.equal(sd.error, undefined, sd.error && sd.error.message);
    profSoftDel = sd.profile;
    // Soft-delete por ADMIN (service_role bypassa RLS). Un UPDATE de deleted_at por CLIENTE lo
    // rechaza/no-opea PostgREST cuando la policy SELECT filtra `deleted_at is null` (la fila deja de ser
    // visible tras el UPDATE → PostgREST exige que siga visible; gotcha "Soft-delete vía RPC vs UPDATE",
    // CONTEXT/07-pendientes.md). Si se hace por clientA, profSoftDel NO queda soft-deleted (silencioso) y
    // el assert fail-closed de (c) no ejerce el path real. Por admin el UPDATE SÍ se aplica.
    {
      const { error: sdErr } = await admin.from('animal_profiles')
        .update({ deleted_at: new Date().toISOString() }).eq('id', profSoftDel.id);
      assert.equal(sdErr, null, `soft-delete del perfil (admin) no debe fallar: ${sdErr && sdErr.message}`);
      // verificar que QUEDÓ soft-deleted (que el test no vuelva a soft-deletear en silencio).
      const { data: chk } = await admin.from('animal_profiles')
        .select('deleted_at').eq('id', profSoftDel.id).single();
      assert.ok(chk && chk.deleted_at !== null, 'precondición (c): profSoftDel quedó soft-deleted');
    }
  });

  // ---- (b)+(c) creación owner-only + establishment_id forzado (R13.2/R13.3/R13.4) ----
  await t.test('(b) creación de field_definitions custom: owner-only + no global + est forzado', async () => {
    // owner crea custom en su campo -> OK.
    const ok = await createCustomField(clientA, { establishmentId: estA, dataKey: `${RUN_TAG}_num`.toLowerCase().replace(/[^a-z0-9_]/g, '_'), label: 'Ángulo pezuña', uiComponent: 'numeric' });
    assert.equal(ok.error, undefined, ok.error && ok.error.message);
    fNumeric = ok.field;

    // authenticated crea con establishment_id NULL -> 42501 (R13.4).
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, data_key: `${RUN_TAG}_glob`.toLowerCase().replace(/[^a-z0-9_]/g, '_'), label: 'X', data_type: 'maniobra', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'alta global de cliente debe fallar');
      assert.match(pgcode(error), /42501/);
    }
    // non-owner (userC sin rol en estA) crea custom en estA -> reject (policy/guard, 42501/0 filas).
    {
      const id = crypto.randomUUID();
      const { error } = await clientC.from('field_definitions').insert({ id, establishment_id: estA, data_key: `${RUN_TAG}_nonowner`.toLowerCase().replace(/[^a-z0-9_]/g, '_'), label: 'X', data_type: 'maniobra', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'non-owner no crea custom en estA');
      assert.match(pgcode(error), /42501|row-level security/i);
    }
  });

  // ---- crear el resto de los fields custom de estA (para los tests de value/gating) ----
  await t.test('setup fields custom (enum/boolean/text/date/propiedad)', async () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    fEnumSingle = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_es`), label: 'Pezuña', uiComponent: 'enum_single', configSchema: { options: ['adentro', 'afuera', 'normal'] } })).field;
    fEnumMulti = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_em`), label: 'Defectos', uiComponent: 'enum_multi', configSchema: { options: ['a', 'b', 'c'] } })).field;
    fBoolean = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_bo`), label: 'Marca', uiComponent: 'boolean' })).field;
    fText = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_tx`), label: 'Nota', uiComponent: 'text' })).field;
    fDate = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_dt`), label: 'Fecha', uiComponent: 'date' })).field;
    fProp = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_pr`), label: 'Apodo', dataType: 'propiedad', uiComponent: 'text' })).field;
    assert.ok(fEnumSingle && fEnumMulti && fBoolean && fText && fDate && fProp);
    // prender numeric + enum_single + propiedad en rodeoA (para las capturas OK).
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fNumeric.id, true);
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fEnumSingle.id, true);
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fEnumMulti.id, true);
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fBoolean.id, true);
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fText.id, true);
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fDate.id, true);
    await enableCustomFieldInRodeo(clientA, rodeoA.id, fProp.id, true);
  });

  // ---- (c) gating genérico fail-closed (R13.14/R13.15) --------------------
  await t.test('(c) gating genérico: enabled -> OK, disabled -> 23514, soft-deleted -> 23514', async () => {
    // numeric enabled -> OK (owner).
    {
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 12.5 });
      assert.equal(r.error, null, r.error && r.error.message);
    }
    // R13.13 (Obs-1): un rol operativo NO-owner (field_operator) captura sobre el mismo dato enabled -> OK.
    // La RLS de custom_measurements es has_role_in (no is_owner_of) → cualquier rol activo del campo escribe.
    {
      const r = await insertMeasurement(clientOp, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 13.5 });
      assert.equal(r.error, null, `field_operator (no-owner) debe poder capturar (R13.13): ${r.error && r.error.message}`);
      // y el audit forzado le pone su propio uid como recorded_by + el establishment del perfil.
      const { data } = await admin.from('custom_measurements').select('recorded_by, establishment_id').eq('id', r.id).single();
      assert.equal(data.recorded_by, userOp.id, 'recorded_by forzado al field_operator que capturó');
      assert.equal(data.establishment_id, estA, 'establishment_id forzado desde el perfil (estA)');
    }
    // un field NO enabled en rodeoA (fNumeric en otro rodeo deshabilitado: usamos un field nuevo no prendido).
    {
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const fOff = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_off`), label: 'Off', uiComponent: 'numeric' })).field;
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fOff.id, value: 1 });
      assert.notEqual(r.error, null, 'field no enabled en el rodeo debe rechazar (PostgREST directo)');
      assert.match(pgcode(r.error), /23514|not enabled/i);
    }
    // perfil soft-deleted -> fail-closed 23514 (admin inserta para saltear la RLS y ejercer el gating).
    {
      const id = crypto.randomUUID();
      const { error } = await admin.from('custom_measurements').insert({ id, animal_profile_id: profSoftDel.id, field_definition_id: fNumeric.id, establishment_id: estA, value: 1 });
      assert.notEqual(error, null, 'perfil soft-deleted debe fallar fail-closed');
      assert.match(pgcode(error), /23514|cannot resolve rodeo/i);
    }
  });

  // ---- (d) validación de value por ui_component (R13.16) ------------------
  await t.test('(d) validación de value por ui_component', async () => {
    // numeric con texto -> 23514.
    {
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 'no soy numero' });
      assert.notEqual(r.error, null, 'numeric con string debe rechazar');
      assert.match(pgcode(r.error), /23514|must be numeric/i);
    }
    // enum_single fuera de options -> 23514.
    {
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fEnumSingle.id, value: 'inexistente' });
      assert.notEqual(r.error, null, 'enum fuera de options debe rechazar');
      assert.match(pgcode(r.error), /23514|not in options/i);
    }
    // enum_single dentro de options -> OK.
    {
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fEnumSingle.id, value: 'adentro' });
      assert.equal(r.error, null, r.error && r.error.message);
    }
    // boolean con número -> 23514; con bool -> OK.
    {
      const bad = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fBoolean.id, value: 1 });
      assert.match(pgcode(bad.error), /23514|must be boolean/i);
      const ok = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fBoolean.id, value: true });
      assert.equal(ok.error, null, ok.error && ok.error.message);
    }
    // date inválida -> 23514; date válida -> OK.
    {
      const bad = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fDate.id, value: 'no-fecha' });
      assert.match(pgcode(bad.error), /23514|invalid|must be string/i);
      const ok = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fDate.id, value: '2026-01-15' });
      assert.equal(ok.error, null, ok.error && ok.error.message);
    }
  });

  // ---- (e) FRONTERA WAL: scope del sync stream + catálogo global solo NULL (R13.21) -------
  // Espejo de sync_streams/run.cjs: aplicamos el PREDICADO de cada stream (rafaq.yaml) a mano con
  // service_role (bypassa la RLS) → el SET que la stream le daría a cada device. R13.21 es la frontera
  // del WAL (capa distinta de la RLS de PostgREST que cubre el caso (a)/R13.22): el WAL ignora RLS, así
  // que el contenido de la stream ES la barrera. Si las streams custom fueran permisivas (sin el
  // `establishment_id IN org_scope`) o el catálogo no filtrara `IS NULL`, estos asserts FALLARÍAN.
  await t.test('(e) frontera WAL: catálogo global solo NULL; custom scope establishment (userC sin rol no las ve)', async () => {
    // Sembramos data custom de estA AUTOCONTENIDA (no dependemos del orden de (a)/(c)): por clientA
    // (la RLS/triggers reales fuerzan establishment_id=estA), para que el SET de estA NO esté vacío
    // (un set vacío pasaría los no-bypass trivialmente). fProp/fNumeric ya están enabled en rodeoA.
    {
      const ms = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 42 });
      assert.equal(ms.error, null, ms.error && ms.error.message);
      const at = await upsertAttribute(clientA, { animalProfileId: animA.profile.id, fieldId: fProp.id, value: 'Frontera' });
      assert.equal(at.error, null, at.error && at.error.message);
    }

    const scopeA = await orgScope(userA.id);  // [estA, estB?] — userA es owner de estA
    const scopeC = await orgScope(userC.id);  // [] — userC no tiene rol en NINGÚN campo nuestro
    assert.ok(scopeA.includes(estA), 'precondición: estA ∈ org_scope de userA');
    assert.ok(!scopeC.includes(estA), 'precondición: estA ∉ org_scope de userC (sin rol)');

    // ── (e.1) catalog_field_definitions emite SOLO establishment_id IS NULL ──────────────────
    // La field custom de estA (fNumeric, establishment_id=estA) NO entra al catálogo global; las
    // globales de fábrica (establishment_id NULL) SÍ. Sin este filtro, las custom fugarían a TODOS.
    const catalog = await catalogFieldDefSet();
    assert.ok(!catalog.includes(fNumeric.id), 'la field custom de estA NO entra a catalog_field_definitions (no es global)');
    // Toda fila del catálogo es global (establishment_id NULL) — barrera dura, no conteo absoluto.
    if (catalog.length > 0) {
      const { data: rows } = await admin.from('field_definitions').select('establishment_id').in('id', catalog);
      assert.ok((rows || []).every((r) => r.establishment_id === null), 'TODA fila de catalog_field_definitions tiene establishment_id NULL');
    }
    // Las globales de fábrica (ej. 'peso') SÍ están en el catálogo global.
    const { data: peso } = await admin.from('field_definitions').select('id').eq('data_key', 'peso').is('establishment_id', null).maybeSingle();
    if (peso) assert.ok(catalog.includes(peso.id), "las globales de fábrica (ej. 'peso') SÍ entran a catalog_field_definitions");

    // ── (e.2) est_field_definitions_custom: userA con rol VE la custom de estA; userC sin rol NO ──
    {
      const setA = await customSyncSetIds('field_definitions', scopeA, { withDeletedAtFilter: true });
      const setC = await customSyncSetIds('field_definitions', scopeC, { withDeletedAtFilter: true });
      assert.ok(setA.includes(fNumeric.id), 'userA (con rol en estA) recibe la field custom de estA por est_field_definitions_custom');
      assert.ok(!setC.includes(fNumeric.id), 'userC (sin rol en estA) NO recibe la field custom de estA (frontera WAL)');
      assert.deepEqual(setC, [], 'userC sin rol en ningún campo → set de field_definitions custom vacío');
    }

    // ── (e.3) est_custom_measurements: userA con rol VE las de estA; userC sin rol NO ──
    {
      const setA = await customSyncSetIds('custom_measurements', scopeA, { withDeletedAtFilter: true });
      const setC = await customSyncSetIds('custom_measurements', scopeC, { withDeletedAtFilter: true });
      assert.ok(setA.length > 0, 'userA recibe las custom_measurements de estA (set no vacío)');
      // toda medición del set de A pertenece a un campo de A (la columna denorm es la frontera).
      const { data: rowsA } = await admin.from('custom_measurements').select('establishment_id').in('id', setA);
      assert.ok((rowsA || []).every((r) => scopeA.includes(r.establishment_id)), 'toda custom_measurement del set de userA pertenece a un campo de userA');
      assert.deepEqual(setC, [], 'userC sin rol NO recibe NINGUNA custom_measurement (frontera WAL)');
    }

    // ── (e.4) est_custom_attributes (PK compuesta, sin deleted_at): userA VE; userC NO ──
    {
      const inA = await customAttrSyncRows(scopeA, animA.profile.id);
      const inC = await customAttrSyncRows(scopeC, animA.profile.id);
      assert.ok(inA.some((r) => r.field_definition_id === fProp.id), 'userA recibe el custom_attribute de estA por est_custom_attributes');
      assert.ok(inA.every((r) => scopeA.includes(r.establishment_id)), 'todo custom_attribute del set de userA pertenece a un campo de userA');
      assert.deepEqual(inC, [], 'userC sin rol NO recibe NINGÚN custom_attribute (frontera WAL)');
    }
  });

  // ---- (a) RLS tenant: userC sin rol -> 0 filas (R13.22) ------------------
  await t.test('(a) RLS tenant: userC sin rol no ve custom_measurements/custom_attributes ni las field custom', async () => {
    // sembrar una medición y un atributo de estA (por clientA).
    await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 7 });
    await upsertAttribute(clientA, { animalProfileId: animA.profile.id, fieldId: fProp.id, value: 'Lucero' });
    // userC sin rol -> 0 filas en ambas.
    const { data: ms } = await clientC.from('custom_measurements').select('id').eq('animal_profile_id', animA.profile.id);
    assert.deepEqual(ms || [], [], 'userC no ve mediciones de estA');
    const { data: at } = await clientC.from('custom_attributes').select('value').eq('animal_profile_id', animA.profile.id);
    assert.deepEqual(at || [], [], 'userC no ve atributos de estA');
    // userC NO ve la field custom de estA, pero SÍ ve las globales de fábrica.
    const { data: cf } = await clientC.from('field_definitions').select('id').eq('id', fNumeric.id);
    assert.deepEqual(cf || [], [], 'userC no ve la field custom de estA');
    const { data: gl } = await clientC.from('field_definitions').select('id').eq('data_key', 'peso').is('establishment_id', null);
    assert.ok((gl || []).length >= 1, 'userC SÍ ve las globales de fábrica');
  });

  // ---- (f) audit forzado: recorded_by/updated_by/establishment_id no spoofeables (R13.23) ----
  await t.test('(f) audit forzado anti-spoof', async () => {
    // measurement con establishment_id + recorded_by AJENOS -> el trigger los fuerza al del perfil / auth.uid().
    const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 3, establishmentId: estB, recordedBy: userC.id });
    assert.equal(r.error, null, r.error && r.error.message);
    const { data } = await admin.from('custom_measurements').select('establishment_id, recorded_by').eq('id', r.id).single();
    assert.equal(data.establishment_id, estA, 'establishment_id forzado desde el perfil (no estB del payload)');
    assert.equal(data.recorded_by, userA.id, 'recorded_by forzado a auth.uid() (no userC del payload)');
    // attribute con updated_by ajeno -> forzado.
    await upsertAttribute(clientA, { animalProfileId: animA.profile.id, fieldId: fProp.id, value: 'Manchado', establishmentId: estB, updatedBy: userC.id });
    const { data: at } = await admin.from('custom_attributes').select('establishment_id, updated_by').eq('animal_profile_id', animA.profile.id).eq('field_definition_id', fProp.id).single();
    assert.equal(at.establishment_id, estA, 'attribute establishment_id forzado del perfil');
    assert.equal(at.updated_by, userA.id, 'attribute updated_by forzado a auth.uid()');
  });

  // ---- (g) value fail-closed por ui_component desconocido (M5-SEC-01a / R13.25) ----
  await t.test('(g) ui_component desconocido -> assert_custom_value_valid rechaza (23514)', async () => {
    // un field GLOBAL con ui_component='composite' (fuera de los 7) referenciado por una captura.
    // Lo prendemos en rodeoA y capturamos sobre él -> assert_custom_value_valid cae en la rama else -> 23514.
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const gf = await createGlobalFieldAsService({ dataKey: slug(`${RUN_TAG}_composite_g`), label: 'Compuesto', dataType: 'maniobra', uiComponent: 'composite' });
    await enableCustomFieldInRodeo(clientA, rodeoA.id, gf.id, true);
    // admin inserta (saltea RLS) para ejercer el gating/validación con un ui_component no soportado.
    const id = crypto.randomUUID();
    const { error } = await admin.from('custom_measurements').insert({ id, animal_profile_id: animA.profile.id, field_definition_id: gf.id, establishment_id: estA, value: { blob: 'cualquier cosa' } });
    assert.notEqual(error, null, 'ui_component no soportado debe rechazar el value (fail-closed)');
    assert.match(pgcode(error), /23514|unsupported ui_component/i);
  });

  // ---- (h) creación custom con ui_component fuera de los 7 (M5-SEC-01b / R13.25) ----
  await t.test('(h) crear field custom con ui_component fuera de los 7 -> 23514; global con composite -> OK', async () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    for (const uic of ['composite', 'whatever', null]) {
      const id = crypto.randomUUID();
      const payload = { id, establishment_id: estA, data_key: slug(`${RUN_TAG}_uic_${uic}`), label: 'X', data_type: 'maniobra', category: 'manejo' };
      if (uic !== null) payload.ui_component = uic;
      const { error } = await clientA.from('field_definitions').insert(payload);
      assert.notEqual(error, null, `custom con ui_component=${uic} debe rechazar`);
      assert.match(pgcode(error), /23514|ui_component/i);
    }
    // control: uno de los 7 -> OK.
    const ok = await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_uic_ok`), label: 'OK', uiComponent: 'text' });
    assert.equal(ok.error, undefined, ok.error && ok.error.message);
    // global con composite (vía service_role) -> OK (exenta del CHECK).
    const g = await createGlobalFieldAsService({ dataKey: slug(`${RUN_TAG}_uic_glob`), label: 'G', dataType: 'maniobra', uiComponent: 'composite' });
    assert.ok(g.id, 'global con composite OK (exenta del CHECK de dominio)');
  });

  // ---- (i) inmutabilidad post-creación (M5-SEC-02 / R13.26) ---------------
  await t.test('(i) inmutabilidad: establishment_id/data_type/data_key/ui_component -> 42501; label/etc -> OK', async () => {
    // UPDATE establishment_id de fNumeric (estA) -> 42501.
    {
      const { error } = await clientA.from('field_definitions').update({ establishment_id: estB }).eq('id', fNumeric.id);
      assert.notEqual(error, null, 'mudar establishment_id debe fallar');
      assert.match(pgcode(error), /42501|immutable/i);
    }
    for (const [col, val] of [['data_type', 'propiedad'], ['data_key', `${RUN_TAG}_x`.toLowerCase().replace(/[^a-z0-9_]/g, '_')], ['ui_component', 'text']]) {
      const { error } = await clientA.from('field_definitions').update({ [col]: val }).eq('id', fNumeric.id);
      assert.notEqual(error, null, `mudar ${col} debe fallar`);
      assert.match(pgcode(error), /42501|immutable/i);
    }
    // label/config_schema/active/deleted_at editables -> OK.
    {
      const { error } = await clientA.from('field_definitions').update({ label: 'Ángulo pezuña (corregido)', active: true }).eq('id', fNumeric.id);
      assert.equal(error, null, error && error.message);
      const soft = await clientA.from('field_definitions').update({ deleted_at: new Date().toISOString() }).eq('id', fText.id);
      assert.equal(soft.error, null, soft.error && soft.error.message);
      // revertir el soft-delete de fText (lo seguimos usando) -> deleted_at NULL es UPDATE editable.
      await clientA.from('field_definitions').update({ deleted_at: null }).eq('id', fText.id);
    }
    // CASO CLAVE: owner de A+B intenta mudar una custom de A a B -> 42501 (no fuga vía WAL).
    {
      // userAB crea una custom en estA y luego intenta mudarla a estB.
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const f = await createCustomField(clientAB, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_ab`), label: 'AB', uiComponent: 'numeric' });
      assert.equal(f.error, undefined, f.error && f.error.message);
      const { error } = await clientAB.from('field_definitions').update({ establishment_id: estB }).eq('id', f.field.id);
      assert.notEqual(error, null, 'owner A+B no puede mudar A->B');
      assert.match(pgcode(error), /42501|immutable/i);
    }
    // R13.19 (Obs-2): soft-delete de un dato custom PRESERVA las custom_measurements ya cargadas.
    // (FK field_definition_id SIN ON DELETE = RESTRICT + soft-delete = UPDATE deleted_at, no hard-delete.)
    {
      const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      const fDel = (await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_softdel`), label: 'ASoftDel', uiComponent: 'numeric' })).field;
      await enableCustomFieldInRodeo(clientA, rodeoA.id, fDel.id, true);
      const m = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fDel.id, value: 99 });
      assert.equal(m.error, null, m.error && m.error.message);
      // soft-delete del field_definition (UPDATE deleted_at) -> OK.
      const sd = await clientA.from('field_definitions').update({ deleted_at: new Date().toISOString() }).eq('id', fDel.id);
      assert.equal(sd.error, null, sd.error && sd.error.message);
      // la medición ya cargada SOBREVIVE (no se hard-deleteó por el soft-delete del field).
      const { data: surv } = await admin.from('custom_measurements').select('id, value').eq('id', m.id).maybeSingle();
      assert.ok(surv, 'la custom_measurement ya cargada SOBREVIVE al soft-delete del field_definition (R13.19)');
      assert.equal(Number(surv.value), 99, 'el value de la medición preservada queda intacto');
    }
  });

  // ---- (j) data_type fuera del set / fuera del alta de cliente (M5-SEC-03 / R13.27) ----
  await t.test('(j) data_type: cliente solo maniobra/propiedad; set cerrado a nivel tabla', async () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    // evento_individual desde cliente -> 42501 (guard estrecha el alta de cliente).
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_dt_ev`), label: 'X', data_type: 'evento_individual', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'data_type evento_individual desde cliente debe fallar');
      assert.match(pgcode(error), /42501|maniobra or propiedad/i);
    }
    // data_type totalmente inválido a nivel tabla -> 23514 (CHECK).
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_dt_bad`), label: 'X', data_type: 'basura', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'data_type inválido debe fallar');
      assert.match(pgcode(error), /23514|42501|data_type/i);
    }
    // maniobra y propiedad -> OK.
    {
      const m = await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_dt_m`), label: 'M', dataType: 'maniobra', uiComponent: 'numeric' });
      assert.equal(m.error, undefined, m.error && m.error.message);
      const p = await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_dt_p`), label: 'P', dataType: 'propiedad', uiComponent: 'text' });
      assert.equal(p.error, undefined, p.error && p.error.message);
    }
  });

  // ---- (k) caps INPUT-1 (M5-SEC-03 / R13.27) -----------------------------
  await t.test('(k) caps INPUT-1: data_key slug/largo, description, category', async () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    // data_key > 64 -> reject.
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: 'a'.repeat(70), label: 'X', data_type: 'maniobra', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'data_key > 64 debe fallar');
      assert.match(pgcode(error), /23514|data_key/i);
    }
    // data_key no-slug (mayúsculas/espacios) -> reject.
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: 'Con Mayus', label: 'X', data_type: 'maniobra', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'data_key no-slug debe fallar');
      assert.match(pgcode(error), /23514|data_key/i);
    }
    // description > 500 -> reject.
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_desc`), label: 'X', description: 'd'.repeat(600), data_type: 'maniobra', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'description > 500 debe fallar');
      assert.match(pgcode(error), /23514|description/i);
    }
    // category custom > 32 -> reject.
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_cat`), label: 'X', category: 'c'.repeat(40), data_type: 'maniobra', ui_component: 'numeric' });
      assert.notEqual(error, null, 'category custom > 32 debe fallar');
      assert.match(pgcode(error), /23514|category/i);
    }
    // controles dentro del cap -> OK.
    {
      const ok = await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_cap_ok`), label: 'OK', description: 'corta', category: 'manejo', uiComponent: 'numeric' });
      assert.equal(ok.error, undefined, ok.error && ok.error.message);
    }
  });

  // ---- (l) cardinalidad/largo de options (M5-SEC-04 / R13.17) -------------
  await t.test('(l) options de enum: cardinalidad <=50, cada opción <=60, array obligatorio; enum_multi <=50 seleccionados', async () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    // > 50 opciones -> reject.
    {
      const id = crypto.randomUUID();
      const opts = Array.from({ length: 60 }, (_, i) => `o${i}`);
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_opt_many`), label: 'X', data_type: 'maniobra', ui_component: 'enum_single', category: 'manejo', config_schema: { options: opts } });
      assert.notEqual(error, null, '> 50 opciones debe fallar');
      assert.match(pgcode(error), /23514|cardinality/i);
    }
    // una opción > 60 chars -> reject.
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_opt_long`), label: 'X', data_type: 'maniobra', ui_component: 'enum_single', category: 'manejo', config_schema: { options: ['ok', 'x'.repeat(70)] } });
      assert.notEqual(error, null, 'opción > 60 debe fallar');
      assert.match(pgcode(error), /23514|too-long|option/i);
    }
    // options ausente / no-array -> reject.
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: slug(`${RUN_TAG}_opt_none`), label: 'X', data_type: 'maniobra', ui_component: 'enum_single', category: 'manejo', config_schema: { foo: 'bar' } });
      assert.notEqual(error, null, 'enum sin options array debe fallar');
      assert.match(pgcode(error), /23514|options array/i);
    }
    // <= 50 opciones válidas -> OK.
    {
      const ok = await createCustomField(clientA, { establishmentId: estA, dataKey: slug(`${RUN_TAG}_opt_ok`), label: 'OK', uiComponent: 'enum_single', configSchema: { options: ['x', 'y', 'z'] } });
      assert.equal(ok.error, undefined, ok.error && ok.error.message);
    }
    // enum_multi capturado con array de >50 seleccionados -> assert_custom_value_valid rechaza (23514).
    // (usamos fEnumMulti que tiene 3 options; un array repetido de elementos válidos pero >50 largo).
    {
      const big = Array.from({ length: 51 }, () => 'a'); // todos en options pero >50 elementos
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fEnumMulti.id, value: big });
      assert.notEqual(r.error, null, 'enum_multi con >50 seleccionados debe rechazar');
      assert.match(pgcode(r.error), /23514|exceeds max selected/i);
    }
    // enum_multi válido (subset de options) -> OK.
    {
      const r = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fEnumMulti.id, value: ['a', 'b'] });
      assert.equal(r.error, null, r.error && r.error.message);
    }
  });

  // ---- (m) cap de notes (M5-SEC-05) --------------------------------------
  await t.test('(m) custom_measurements.notes: >500 -> CHECK falla; <=500 -> OK', async () => {
    const bad = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 1, notes: 'n'.repeat(600) });
    assert.notEqual(bad.error, null, 'notes > 500 debe fallar');
    assert.match(pgcode(bad.error), /23514|notes/i);
    const ok = await insertMeasurement(clientA, { animalProfileId: animA.profile.id, fieldId: fNumeric.id, value: 1, notes: 'nota corta' });
    assert.equal(ok.error, null, ok.error && ok.error.message);
  });

  // ---- (n) las funciones SECURITY DEFINER NO son RPC (R13.24) ------------
  await t.test('(n) helpers SECURITY DEFINER no invocables por authenticated', async () => {
    for (const fn of ['assert_custom_field_enabled', 'assert_custom_value_valid']) {
      const { error } = await clientA.rpc(fn, fn === 'assert_custom_field_enabled'
        ? { p_animal_profile_id: animA.profile.id, p_field_definition_id: fNumeric.id }
        : { p_field_definition_id: fNumeric.id, p_value: 1 });
      assert.notEqual(error, null, `${fn} NO debe ser invocable como RPC por authenticated`);
      // PostgREST devuelve 404 (PGRST202: no existe en el schema cache) o 42501 (sin EXECUTE).
      assert.match(pgcode(error), /PGRST202|42501|does not exist|Could not find/i);
    }
  });

  // ---- (o) borrar + recrear mismo slug (R13.26 / R13.19) — índice UNIQUE PARCIAL sobre deleted_at ----
  // ⚠️ PENDING-DEPLOY: este caso EJERCE la migración 0101 (índice custom parcial sobre deleted_at). Hasta que
  // 0101 esté aplicada a la DB compartida, el sub-caso "recrear-mismo-slug tras soft-delete" FALLA con 23505
  // (el índice viejo de 0093 no excluye la borrada → la fila soft-deleteada sigue ocupando el slot). Es el
  // hallazgo HIGH del reviewer (progress/review_03-m7.md). El leader aplica 0101 en el gate de deploy → el caso
  // pasa a verde. El sub-caso de control negativo (dos VIVAS mismo slug -> 23505) pasa con o sin 0101.
  await t.test('(o) borrar+recrear mismo data_key: la soft-deleteada LIBERA el slot (R13.26); dos vivas colisionan (23505)', async () => {
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const key = slug(`${RUN_TAG}_recreate`);

    // 1) Crear un dato custom con data_key=key.
    const first = await createCustomField(clientA, { establishmentId: estA, dataKey: key, label: 'Mansedumbre', dataType: 'maniobra', uiComponent: 'numeric' });
    assert.equal(first.error, undefined, first.error && first.error.message);

    // 2) CONTROL NEGATIVO: una SEGUNDA fila VIVA con el mismo (establishment_id, data_key) -> 23505 (el unique
    //    sigue protegiendo el slot entre filas vivas; el cliente nunca lo intenta porque slugifyDataKey
    //    desambigua, pero confirmamos que el índice sigue activo para las vivas).
    {
      const id = crypto.randomUUID();
      const { error } = await clientA.from('field_definitions').insert({ id, establishment_id: estA, data_key: key, label: 'Dup', data_type: 'maniobra', ui_component: 'numeric', category: 'manejo' });
      assert.notEqual(error, null, 'dos custom VIVAS con el mismo data_key deben colisionar');
      assert.match(pgcode(error), /23505|duplicate|unique/i);
    }

    // 3) Soft-delete de la primera (UPDATE deleted_at) -> libera el slot bajo el índice parcial de 0101.
    {
      const sd = await clientA.from('field_definitions').update({ deleted_at: new Date().toISOString() }).eq('id', first.id);
      assert.equal(sd.error, null, sd.error && sd.error.message);
    }

    // 4) RECREAR el dato con el MISMO data_key=key (= el flujo de R13.26 borrar+recrear; slugifyDataKey re-deriva
    //    el slug original porque la borrada no figura en existingDataKeys) -> debe ENTRAR (no 23505).
    {
      const again = await createCustomField(clientA, { establishmentId: estA, dataKey: key, label: 'Mansedumbre (recreada)', dataType: 'maniobra', uiComponent: 'numeric' });
      assert.equal(again.error, undefined,
        `recrear el dato con el mismo data_key tras soft-delete NO debe fallar (requiere índice parcial 0101): ${again.error && again.error.message}`);
      assert.ok(again.field && again.field.id !== first.id, 'la recreada es una fila NUEVA (id distinto), no la borrada');
    }
  });

  // ---- cleanup ----------------------------------------------------------
  await t.test('cleanup', async () => { await cleanup(); });
});
