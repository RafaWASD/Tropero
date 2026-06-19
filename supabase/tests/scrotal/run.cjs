// supabase/tests/scrotal/run.cjs
// Suite de tests no-bypass de la CIRCUNFERENCIA ESCROTAL (spec 03, chunk M6 / US-14, backend).
// Espejo de supabase/tests/maneuvers/run.cjs + supabase/tests/sync_streams/run.cjs.
//
// Corre contra la base remota: service_role para fixtures, JWTs reales para los asserts de
// RLS/triggers/gating. Limpia users/establishments al final (CASCADE).
//
// CORRE POST-APPLY: la tabla scrotal_measurements (0098) + data_key/seed (0099) + gating (0100) ya están
// APLICADAS al remoto (2026-06-18) → la suite corre de verdad y el hook en scripts/run-tests.mjs quedó
// DESCOMENTADO. (Antes del apply fallaba con 42P01/no-such-relation y el hook quedaba comentado, no era regresión.)
//
// Mapa R<n> -> test en progress/impl_03-m6-backend.md.
// Casos (a)-(i) de tasks.md M6-B.5:
//   (a) RLS tenant (userB sin rol → 0 filas / reject)
//   (b) audit forzado (recorded_by/establishment_id no spoofeables desde el payload, en INSERT *Y* UPDATE —
//       el sub-assert del UPDATE-path cierra M6-CODE-01 de Gate 2 code: el owner intenta pisar
//       establishment_id por UPDATE → el trigger lo re-deriva al perfil real, no se puede pisar)
//   (c) gating capa 2 fail-closed (enabled OK / disabled 23514 por PostgREST directo / soft-deleted 23514 /
//       no-bypass por service_role)
//   (d) binding-test (circunferencia_escrotal existe en field_definitions)
//   (e) seed cría (un rodeo de cría nuevo tiene circunferencia_escrotal enabled por default, R14.18)
//   (f) CHECK de rango (circumference_cm <20 o >50 → reject)
//   (g) frontera WAL (R14.16) — predicado de ev_scrotal_measurements (espejo sync_streams/run.cjs)
//   (h) corrección append-only (R14.17) owner/recorded_by corrige/soft-deletea, tercero NO
//   (i) session_id tenant-check no-bypass (M6-SEC-02, Gate 1) — cross-tenant / sesión cerrada / otro rodeo
//       → reject; session_id NULL → OK; y que la forma `before insert or update` SÍ dispara en INSERT.
//
// Uso: las vars se cargan desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

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

const RUN_TAG = `scrotal_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

// ---- helpers de fixtures (mismo patrón que supabase/tests/maneuvers/run.cjs) ----

async function createTestUser(label) {
  const email = `${RUN_TAG}_${label}@rafaq-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: `Test ${label}` },
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
  const { error: insErr } = await userClient
    .from('establishments')
    .insert({ name, province: 'Buenos Aires' });
  if (insErr) throw new Error(`createEstablishment insert(${name}): ${insErr.message}`);
  const { data, error } = await userClient
    .from('establishments')
    .select('id')
    .eq('name', name)
    .single();
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function lookupSpeciesSystem(client, speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp, error: spErr } = await client
    .from('species').select('id').eq('code', speciesCode).single();
  if (spErr) throw new Error(`lookup species: ${spErr.message}`);
  const { data: sys, error: sysErr } = await client
    .from('systems_by_species').select('id').eq('species_id', sp.id).eq('code', systemCode).single();
  if (sysErr) throw new Error(`lookup system: ${sysErr.message}`);
  return { speciesId: sp.id, systemId: sys.id };
}

async function categoryId(client, systemId, code) {
  const { data, error } = await client
    .from('categories_by_system').select('id').eq('system_id', systemId).eq('code', code).single();
  if (error) throw new Error(`lookup category ${code}: ${error.message}`);
  return data.id;
}

async function createRodeo(client, { establishmentId, name, systemCode = 'cria' }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client, 'bovino', systemCode);
  const { error: insErr } = await client.from('rodeos').insert({
    establishment_id: establishmentId,
    name,
    species_id: speciesId,
    system_id: systemId,
  });
  if (insErr) throw new Error(`createRodeo insert(${name}): ${insErr.message}`);
  const { data, error } = await client
    .from('rodeos')
    .select('id, system_id')
    .eq('establishment_id', establishmentId)
    .eq('name', name)
    .single();
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

// Crea un macho ENTERO (torito por default): es a quien aplica la CE en la capa 1 (cliente). El backend
// NO gatea por categoría — pero usar un macho mantiene la coherencia semántica de los fixtures.
async function createAnimal(client, { idv = null, sex = 'male', birthDate = null, rodeoId, establishmentId, systemId, categoryCode = 'torito' }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (birthDate) animalPayload.birth_date = birthDate;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) return { error: aErr };

  const catId = await categoryId(client, systemId, categoryCode);
  const profileId = randomUUID();
  const profilePayload = {
    id: profileId,
    animal_id: animalId,
    establishment_id: establishmentId,
    rodeo_id: rodeoId,
    category_id: catId,
    status: 'active',
  };
  if (idv) profilePayload.idv = idv;
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };

  // El id es client-generado (ADR-012): NO dependemos del read-back (lag del remoto compartido).
  return { profile: { id: profileId, rodeo_id: rodeoId }, animalId };
}

// createSession: split insert + select (RLS-on-RETURNING; ADR-012). IDs cliente.
async function createSession(client, { establishmentId, rodeoId, status = 'active', config = {} }) {
  const id = randomUUID();
  const { error: insErr } = await client.from('sessions').insert({ id, establishment_id: establishmentId, rodeo_id: rodeoId, status, config });
  if (insErr) return { error: insErr };
  const { data, error } = await client.from('sessions').select('id, status, rodeo_id').eq('id', id).maybeSingle();
  if (error) return { error };
  return { session: data };
}

// setRodeoDataKey: owner toggle de rodeo_data_config por data_key (resuelve field_definition_id), GLOBAL.
async function setRodeoDataKey(client, rodeoId, dataKey, enabled) {
  const { data: fd, error: fdErr } = await client
    .from('field_definitions').select('id').eq('data_key', dataKey).is('establishment_id', null).single();
  if (fdErr) throw new Error(`field_definition ${dataKey}: ${fdErr.message}`);
  const { error } = await client
    .from('rodeo_data_config').update({ enabled }).eq('rodeo_id', rodeoId).eq('field_definition_id', fd.id);
  if (error) throw new Error(`setRodeoDataKey ${dataKey}=${enabled}: ${error.message}`);
  await eventually(
    async () => {
      const { data } = await client
        .from('rodeo_data_config').select('enabled').eq('rodeo_id', rodeoId).eq('field_definition_id', fd.id).maybeSingle();
      return data;
    },
    (row) => row && row.enabled === enabled,
  );
}

function pgcode(error) {
  return String((error && (error.code || '')) + ' ' + (error && (error.message || '')));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Read-after-write en el remoto COMPARTIDO puede tener lag: reintenta hasta el predicado (o agota).
async function eventually(fn, predicate, { tries = 6, delay = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(delay);
  }
  return last;
}

// Una escritura que esperamos que pase puede recibir un error transitorio bajo carga concurrente.
// Reintenta SOLO errores realmente transitorios (NO 42501/23514, que son deterministas).
async function writeWithRetry(fn, { tries = 5, delay = 600 } = {}) {
  let res;
  for (let i = 0; i < tries; i++) {
    res = await fn();
    if (!res.error) return res;
    const code = String(res.error.code || '');
    const transient = ['40001', '40P01', '57014', '08006', '08003'].includes(code);
    if (!transient) return res;
    await sleep(delay);
  }
  return res;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

// org_scope de un actor (mismo SQL que ev_scrotal_measurements en rafaq.yaml), computado con service_role.
async function orgScope(userId) {
  const { data, error } = await admin
    .from('user_roles').select('establishment_id').eq('user_id', userId).eq('active', true);
  if (error) throw new Error(`orgScope(${userId}): ${error.message}`);
  return [...new Set((data || []).map((r) => r.establishment_id))];
}

// Sync set de scrotal_measurements para un actor: SELECT * FROM scrotal_measurements
// WHERE establishment_id IN org_scope AND deleted_at IS NULL  (el predicado de la stream).
async function scrotalSyncSetIds(scope) {
  if (scope.length === 0) return [];
  const { data, error } = await admin
    .from('scrotal_measurements').select('id').in('establishment_id', scope).is('deleted_at', null);
  if (error) throw new Error(`scrotalSyncSetIds: ${error.message}`);
  return (data || []).map((r) => r.id);
}

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin
      .from('animal_profiles').select('id, animal_id').in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id))];
    if (profileIds.length > 0) {
      // scrotal_measurements.animal_profile_id ON DELETE CASCADE; el cascade de establishments lo limpia.
      await admin.from('reproductive_events').delete().in('animal_profile_id', profileIds);
      await admin.from('reproductive_events').delete().in('calf_id', profileIds);
    }
    const { error: estErr } = await admin.from('establishments').delete().in('id', createdEstablishmentIds);
    if (estErr) console.error('cleanup establishments:', estErr.message);
    if (animalIds.length > 0) {
      const { error: anErr } = await admin.from('animals').delete().in('id', animalIds);
      if (anErr) console.error('cleanup animals:', anErr.message);
    }
  }
  for (const uid of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

// =====================================================================
// Suite
// =====================================================================

test('scrotal (CE) suite — spec 03 M6', async (t) => {
  let userA, userB, clientA, clientB, estA, estB;
  let rodeoA, rodeoA2, rodeoB;

  // ---- setup --------------------------------------------------------------
  await t.test('setup: usuarios, establishments, rodeos', async () => {
    userA = await createTestUser('userA'); // owner estA
    userB = await createTestUser('userB'); // owner estB (sin rol en estA)
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A1' });
    rodeoA2 = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A2' });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: 'Rodeo B1' });
    assert.ok(rodeoA.id && rodeoA2.id && rodeoB.id);
  });

  // ---- (e) seed cría: un rodeo de cría nuevo tiene circunferencia_escrotal ENABLED por default (R14.18) --
  await t.test('(e) seed cría: circunferencia_escrotal enabled por default en un rodeo de cría nuevo', async () => {
    const { data: fd, error: fdErr } = await clientA
      .from('field_definitions').select('id').eq('data_key', 'circunferencia_escrotal').is('establishment_id', null).single();
    assert.equal(fdErr, null, fdErr && fdErr.message);
    const row = await eventually(
      async () => (await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rodeoA.id).eq('field_definition_id', fd.id).maybeSingle()).data,
      (d) => d != null,
    );
    assert.ok(row, 'el rodeo de cría nuevo pre-pobló rodeo_data_config con la CE (seed system_default_fields)');
    assert.equal(row.enabled, true, 'la CE nace ENABLED por default en cría (R14.18)');
  });

  // ---- (d) binding-test: circunferencia_escrotal existe en field_definitions (catálogo) ----------------
  await t.test('(d) binding: el data_key circunferencia_escrotal existe como GLOBAL en field_definitions', async () => {
    const { data, error } = await clientA
      .from('field_definitions')
      .select('id, data_type, ui_component, category')
      .eq('data_key', 'circunferencia_escrotal').is('establishment_id', null).single();
    assert.equal(error, null, error && error.message);
    assert.equal(data.data_type, 'maniobra', 'data_type=maniobra (gateo single-key)');
    assert.equal(data.ui_component, 'numeric_stepped');
    assert.equal(data.category, 'reproductivo');
  });

  // ---- (c) gating capa 2 fail-closed (R14.11/R14.12) ---------------------------------------------------
  await t.test('(c) gating capa 2 fail-closed', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo gating CE' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_G`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    assert.equal(an.error, undefined, an.error && an.error.message);

    // enabled (default) -> OK.
    {
      await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
      const ok = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.0, measured_at: today() });
      assert.equal(ok.error, null, ok.error ? `CE enabled: ${ok.error.message}` : 'CE enabled -> OK');
    }
    // disabled -> 23514 por PostgREST directo (R14.12, defensa en profundidad).
    {
      await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', false);
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.5, measured_at: today() });
      assert.notEqual(bad.error, null, 'CE disabled -> reject');
      assert.match(pgcode(bad.error), /23514|missing enabled data_keys/i);
      await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
    }
    // no-bypass por service_role: un INSERT directo con service_role sobre rodeo disabled -> reject igual
    // (el trigger BEFORE INSERT corre independiente del rol; el gating no depende de la RLS).
    {
      await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', false);
      const bad = await admin.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 35.0, measured_at: today() });
      assert.notEqual(bad.error, null, 'service_role tampoco bypassa el gating (no-bypass)');
      assert.match(pgcode(bad.error), /23514|missing enabled data_keys/i);
      await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
    }
    // perfil soft-deleted -> rodeo no resoluble -> reject (NO fail-open, SEC-SPEC-03-03).
    {
      const an2 = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_SD`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
      await admin.from('animal_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', an2.profile.id);
      const bad = await admin.from('scrotal_measurements').insert({ animal_profile_id: an2.profile.id, circumference_cm: 34.0, measured_at: today() });
      assert.notEqual(bad.error, null, 'perfil soft-deleted -> reject (fail-closed)');
      assert.match(pgcode(bad.error), /23514|cannot resolve rodeo/i);
    }
    // perfil inexistente -> reject (gating 23514 o FK 23503; ambos = rechazo).
    {
      const ghost = randomUUID();
      const bad = await admin.from('scrotal_measurements').insert({ animal_profile_id: ghost, circumference_cm: 34.0, measured_at: today() });
      assert.notEqual(bad.error, null, 'perfil inexistente -> reject');
      assert.match(pgcode(bad.error), /23514|23503|cannot resolve rodeo|foreign key/i);
    }
  });

  // ---- (f) CHECK de rango de circumference_cm (R14.5/R14.9, cap autoritativo server-side) ---------------
  await t.test('(f) CHECK de rango: circumference_cm <20 o >50 -> reject', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo rango CE' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_R`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
    // < 20 -> reject (CHECK).
    {
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 19.5, measured_at: today() });
      assert.notEqual(bad.error, null, 'circumference_cm 19.5 -> reject');
      assert.match(pgcode(bad.error), /23514|check/i);
    }
    // > 50 -> reject (CHECK).
    {
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 50.5, measured_at: today() });
      assert.notEqual(bad.error, null, 'circumference_cm 50.5 -> reject');
      assert.match(pgcode(bad.error), /23514|check/i);
    }
    // límites válidos (20.0 y 50.0) -> OK.
    {
      const ok1 = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 20.0, measured_at: today() });
      assert.equal(ok1.error, null, ok1.error ? `20.0: ${ok1.error.message}` : '20.0 -> OK');
      const ok2 = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 50.0, measured_at: today() });
      assert.equal(ok2.error, null, ok2.error ? `50.0: ${ok2.error.message}` : '50.0 -> OK');
    }
    // age_months fuera de rango (>600) -> reject; nullable (sin age_months) -> OK.
    {
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.0, age_months: 601, measured_at: today() });
      assert.match(pgcode(bad.error), /23514|check/i, 'age_months 601 -> reject');
      const okNull = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.0, measured_at: today() });
      assert.equal(okNull.error, null, okNull.error ? `age null: ${okNull.error.message}` : 'age_months null -> OK (snapshot desconocido)');
    }
    // notes > 500 -> reject (cap autoritativo).
    {
      const long = 'x'.repeat(501);
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.0, measured_at: today(), notes: long });
      assert.match(pgcode(bad.error), /23514|check/i, 'notes > 500 -> reject');
    }
  });

  // ---- (b) audit forzado: recorded_by/establishment_id NO spoofeables desde el payload (R14.9) ----------
  await t.test('(b) audit forzado: recorded_by = caller, establishment_id = del perfil (anti-spoof)', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo audit CE' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_AU`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
    const rowId = randomUUID();
    // El cliente intenta spoofear recorded_by = userB y establishment_id = estB; el trigger los pisa.
    const ins = await clientA.from('scrotal_measurements').insert({
      id: rowId,
      animal_profile_id: an.profile.id,
      circumference_cm: 36.0,
      measured_at: today(),
      recorded_by: userB.id,        // spoof intentado
      establishment_id: estB,       // spoof intentado
    });
    assert.equal(ins.error, null, ins.error && ins.error.message);
    const row = await eventually(
      async () => (await admin.from('scrotal_measurements').select('recorded_by, establishment_id').eq('id', rowId).maybeSingle()).data,
      (d) => d != null,
    );
    assert.ok(row, 'la fila existe');
    assert.equal(row.recorded_by, userA.id, 'recorded_by forzado a auth.uid() del caller (NO el spoof userB)');
    assert.equal(row.establishment_id, estA, 'establishment_id forzado al del perfil real (NO el spoof estB)');

    // M6-CODE-01 (Gate 2 code, MEDIUM): assert de regresión del anti-spoof de establishment_id en el
    // UPDATE-path. El trigger scrotal_force_establishment_id está cableado `before insert OR update` (0098
    // l.77-79) — la rama UPDATE es la defensa que 0077 documenta como crítica para la frontera WAL (un caller
    // con UPDATE permission pisando la columna con un campo ajeno por PostgREST directo). El owner (userA, que
    // pasa el USING `is_owner_of`) intenta mover la fila a estB; como animal_profile_id es inmutable, el trigger
    // re-deriva el MISMO establishment del perfil real (estA) → no se puede pisar. El UPDATE de circumference_cm
    // (no de deleted_at) mantiene la fila visible (deleted_at sigue null) → no choca con el gotcha de PostgREST.
    {
      const upd = await clientA
        .from('scrotal_measurements')
        .update({ establishment_id: estB, circumference_cm: 37.0 })  // spoof intentado por UPDATE
        .eq('id', rowId)
        .select('establishment_id, circumference_cm');
      assert.equal(upd.error, null, upd.error && upd.error.message);
      // la fila sigue siendo del owner → el UPDATE afecta 1 fila (el USING `is_owner_of` pasa para userA).
      assert.equal((upd.data || []).length, 1, 'el owner puede UPDATEar su propia CE (USING is_owner_of)');
      const after = await eventually(
        async () => (await admin.from('scrotal_measurements').select('establishment_id, circumference_cm').eq('id', rowId).maybeSingle()).data,
        (d) => d != null && Number(d.circumference_cm) === 37.0,  // espera a que el UPDATE se materialice en el remoto
      );
      assert.ok(after, 'la fila sigue existiendo tras el UPDATE');
      assert.equal(after.establishment_id, estA, 'establishment_id RE-FORZADO al del perfil real en UPDATE (NO el spoof estB, M6-CODE-01)');
    }
  });

  // ---- (a) RLS tenant: userB sin rol en estA no ve ni escribe la CE de estA (R14.15) -------------------
  await t.test('(a) RLS tenant: userB sin rol -> 0 filas (SELECT) y reject (INSERT)', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo RLS CE' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_RLS`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
    const rowId = randomUUID();
    const ins = await clientA.from('scrotal_measurements').insert({ id: rowId, animal_profile_id: an.profile.id, circumference_cm: 37.0, measured_at: today() });
    assert.equal(ins.error, null, ins.error && ins.error.message);
    // userB (owner de estB, sin rol en estA) NO ve la fila.
    const seenB = await clientB.from('scrotal_measurements').select('id').eq('id', rowId);
    assert.deepEqual(seenB.data || [], [], 'userB sin rol en estA no ve la CE de estA');
    // userB NO puede INSERTar una CE sobre un perfil de estA (RLS WITH CHECK con el establishment forzado).
    const badIns = await clientB.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 35.0, measured_at: today() });
    assert.notEqual(badIns.error, null, 'userB no puede INSERTar CE sobre un perfil de estA');
    assert.match(pgcode(badIns.error), /42501|23503|row-level|policy|foreign key/i);
  });

  // ---- (h) corrección append-only (R14.17): owner/recorded_by corrige/soft-deletea; tercero NO ----------
  await t.test('(h) corrección append-only: owner/recorded_by sí, tercero NO', async () => {
    // userC: rol field_operator en estA (graba una CE; NO es owner). userD: sin rol en estA (tercero).
    const userC = await createTestUser('userC');
    const userD = await createTestUser('userD');
    const clientC = await getUserClient(userC.email);
    const clientD = await getUserClient(userD.email);
    await admin.from('user_roles').insert({ user_id: userC.id, establishment_id: estA, role: 'field_operator', active: true });

    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo correc CE' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_AO`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);

    // userC (recorded_by) graba una CE.
    const rowId = randomUUID();
    const ins = await writeWithRetry(() => clientC.from('scrotal_measurements').insert({ id: rowId, animal_profile_id: an.profile.id, circumference_cm: 34.0, measured_at: today() }));
    assert.equal(ins.error, null, ins.error && ins.error.message);

    // recorded_by (userC) corrige por edición (R14.17).
    {
      const { data: upd, error } = await writeWithRetry(() => clientC.from('scrotal_measurements').update({ circumference_cm: 34.5 }).eq('id', rowId).select('circumference_cm'));
      assert.equal(error, null, error && error.message);
      assert.equal(Number(upd[0].circumference_cm), 34.5, 'recorded_by corrige su propia CE (R14.17)');
    }
    // owner (userA) también puede corregir la CE (is_owner_of). La corrección por EDICIÓN no choca con la
    // visibilidad post-UPDATE (la fila sigue visible: deleted_at sigue null) — a diferencia del soft-delete.
    {
      const { data: upd, error } = await writeWithRetry(() => clientA.from('scrotal_measurements').update({ circumference_cm: 35.0 }).eq('id', rowId).select('circumference_cm'));
      assert.equal(error, null, error && error.message);
      assert.equal(Number(upd[0].circumference_cm), 35.0, 'owner corrige cualquier CE de su establishment (is_owner_of, R14.17)');
    }
    // owner soft-deletea la CE. GOTCHA del entorno (documentado en T2.9 maneuvers / suite custom): un UPDATE
    // de deleted_at por CLIENTE torna la fila invisible (la policy SELECT filtra deleted_at IS NULL) → PostgREST
    // exige que siga visible tras el UPDATE → 42501 DETERMINISTA. NO es una falla del schema M6 (el WITH CHECK
    // del UPDATE policy `is_owner_of OR recorded_by` SÍ autoriza al owner). scrotal_measurements no tiene un RPC
    // de soft-delete dedicado → verificamos por SERVICE_ROLE que el soft-delete persiste y la fila sale del
    // SELECT del cliente (el efecto funcional), separando el contrato de seguridad (autorización) del gotcha
    // de visibilidad de PostgREST (que vive en weight_events/custom_measurements igual, no es de M6).
    {
      const sd = await admin.from('scrotal_measurements').update({ deleted_at: new Date().toISOString() }).eq('id', rowId);
      assert.equal(sd.error, null, sd.error && sd.error.message);
      const gone = await eventually(
        async () => (await clientA.from('scrotal_measurements').select('id').eq('id', rowId)).data,
        (d) => Array.isArray(d) && d.length === 0,
      );
      assert.deepEqual(gone, [], 'la CE soft-deleteada sale del SELECT del cliente (deleted_at filtrado, R14.17)');
    }
    // tercero (userD, sin rol) NO puede editar una CE de estA (sin camino cross-tenant).
    {
      const rowId2 = randomUUID();
      await writeWithRetry(() => clientC.from('scrotal_measurements').insert({ id: rowId2, animal_profile_id: an.profile.id, circumference_cm: 36.0, measured_at: today() }));
      const { data: upd } = await clientD.from('scrotal_measurements').update({ circumference_cm: 99.0 }).eq('id', rowId2).select();
      assert.deepEqual(upd || [], [], 'tercero sin rol no edita la CE (sin camino cross-tenant)');
    }
  });

  // ---- (g) frontera WAL (R14.16): el predicado de ev_scrotal_measurements scopea por establishment ----
  await t.test('(g) frontera WAL: actor con rol ve sus CE; sin rol NO (espejo sync_streams)', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo WAL CE' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_WAL`, birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    await setRodeoDataKey(clientA, rg.id, 'circunferencia_escrotal', true);
    const rowId = randomUUID();
    const ins = await clientA.from('scrotal_measurements').insert({ id: rowId, animal_profile_id: an.profile.id, circumference_cm: 38.0, measured_at: today() });
    assert.equal(ins.error, null, ins.error && ins.error.message);
    await eventually(
      async () => (await admin.from('scrotal_measurements').select('id').eq('id', rowId)).data,
      (d) => Array.isArray(d) && d.length === 1,
    );
    // userA (rol en estA) recibe la CE por su sync set.
    const scopeA = await orgScope(userA.id);
    assert.ok(scopeA.includes(estA), 'precondición: estA ∈ org_scope de userA');
    const setA = await scrotalSyncSetIds(scopeA);
    assert.ok(setA.includes(rowId), 'userA recibe su CE por ev_scrotal_measurements (frontera WAL)');
    // userB (sin rol en estA) NO la recibe (su org_scope no incluye estA).
    const scopeB = await orgScope(userB.id);
    assert.ok(!scopeB.includes(estA), 'userB no tiene rol activo en estA');
    const setB = await scrotalSyncSetIds(scopeB);
    assert.ok(!setB.includes(rowId), 'userB NO recibe la CE de estA (no cruza tenant por el WAL)');
  });

  // ---- (i) session_id tenant-check no-bypass (M6-SEC-02, Gate 1) ---------------------------------------
  await t.test('(i) session_id tenant-check no-bypass + dispara en INSERT', async () => {
    const sessA = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
    const sessB = (await createSession(clientB, { establishmentId: estB, rodeoId: rodeoB.id })).session;
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_CE_SESS`, birthDate: daysAgo(900), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    await setRodeoDataKey(clientA, rodeoA.id, 'circunferencia_escrotal', true);

    // OK: misma sesión/establishment/rodeo, sesión active. (Y prueba que el trigger SÍ dispara en INSERT:
    // si NO disparara, el caso cross-tenant de abajo pasaría sin validar — el bypass de 0052 que 0056 arregló.)
    {
      const ok = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.0, measured_at: today(), session_id: sessA.id });
      assert.equal(ok.error, null, ok.error && ok.error.message);
    }
    // (1) cross-tenant: session_id de otro establishment -> 23514.
    {
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 34.5, measured_at: today(), session_id: sessB.id });
      assert.notEqual(bad.error, null, 'session de otro establishment -> reject (dispara en INSERT)');
      assert.match(pgcode(bad.error), /23514|different establishment/i, 'cross-tenant -> 23514');
    }
    // (2) sesión status != 'active' (closed) -> 23514.
    {
      const sessClosed = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
      await clientA.from('sessions').update({ status: 'closed' }).eq('id', sessClosed.id);
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 35.0, measured_at: today(), session_id: sessClosed.id });
      assert.match(pgcode(bad.error), /23514|must be active/i, 'sesión closed -> 23514');
    }
    // (3) session_id de un rodeo distinto al rodeo real del animal (mismo establishment) -> 23514.
    {
      const sessOtroRodeo = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA2.id })).session;
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 35.5, measured_at: today(), session_id: sessOtroRodeo.id });
      assert.match(pgcode(bad.error), /23514|does not match session rodeo/i, 'rodeo distinto -> 23514 (una sesión = un rodeo)');
    }
    // (4) session_id NULL (carga desde la ficha) -> OK.
    {
      const ok = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 36.0, measured_at: today() });
      assert.equal(ok.error, null, 'session_id NULL (carga desde ficha) -> OK (R14.10)');
    }
    // session_id inexistente -> 23503 (FK / no encontrada).
    {
      const ghost = randomUUID();
      const bad = await clientA.from('scrotal_measurements').insert({ animal_profile_id: an.profile.id, circumference_cm: 36.5, measured_at: today(), session_id: ghost });
      assert.match(pgcode(bad.error), /23503|not found/i, 'session inexistente -> 23503');
    }
  });

  // ---- cleanup ------------------------------------------------------------
  await t.test('cleanup', async () => {
    await cleanup();
  });
});
