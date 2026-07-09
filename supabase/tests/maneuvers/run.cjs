// supabase/tests/maneuvers/run.cjs
// Suite de tests de la spec 03-modo-maniobras (Fase 2, backend).
// Corre contra la base remota: service_role para fixtures, JWTs reales para los asserts
// de RLS/triggers/gating. Limpia users/establishments al final (CASCADE).
//
// Mapa R<n> -> test en progress/impl_03-modo-maniobras.md.
//
// Uso: las vars se cargan desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

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

const RUN_TAG = `maneuver_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

// ---- helpers de fixtures (mismo patrón que supabase/tests/animal/run.cjs) ----

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

async function assignRoleAsService(userId, establishmentId, role) {
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
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

async function createAnimal(client, { tag = null, idv = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = require('node:crypto').randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (tag) animalPayload.tag_electronic = tag;
  if (birthDate) animalPayload.birth_date = birthDate;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) return { error: aErr };

  let catId;
  if (categoryCode) {
    catId = await categoryId(client, systemId, categoryCode);
  } else {
    catId = await categoryId(client, systemId, sex === 'male' ? 'torito' : 'vaquillona');
  }

  const profileId = require('node:crypto').randomUUID();
  const profilePayload = {
    id: profileId,
    animal_id: animalId,
    establishment_id: establishmentId,
    rodeo_id: rodeoId,
    category_id: catId,
    status: 'active',
  };
  if (idv) profilePayload.idv = idv;
  // IDU: visual_id_alt eliminado (0122). Un perfil sin idv/tag persiste (trigger de completitud dropeado).
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };

  // El id es client-generado (ADR-012): NO dependemos del read-back para conocerlo
  // (un re-select puede devolver null por read-after-write lag en el remoto compartido).
  // Devolvemos el profile con el id conocido + los campos por default del insert.
  return {
    profile: {
      id: profileId,
      category_id: catId,
      category_override: false,
      management_group_id: null,
      rodeo_id: rodeoId,
    },
    animalId,
  };
}

async function createManagementGroup(client, { establishmentId, name }) {
  const { error: insErr } = await client
    .from('management_groups').insert({ establishment_id: establishmentId, name });
  if (insErr) return { error: insErr };
  const { data, error } = await client
    .from('management_groups').select('id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw error;
  return { id: data.id };
}

// --- helpers propios de spec 03 ---

// createSession: split insert + select (RLS-on-RETURNING; ADR-012). IDs cliente.
async function createSession(client, { establishmentId, rodeoId, status = 'active', config = {} }) {
  const id = require('node:crypto').randomUUID();
  const payload = { id, establishment_id: establishmentId, rodeo_id: rodeoId, status, config };
  const { error: insErr } = await client.from('sessions').insert(payload);
  if (insErr) return { error: insErr };
  const { data, error } = await client.from('sessions').select('id, status, created_by, rodeo_id').eq('id', id).maybeSingle();
  if (error) return { error };
  return { session: data };
}

async function createPreset(client, { establishmentId, name, config = {} }) {
  const id = require('node:crypto').randomUUID();
  const { error: insErr } = await client.from('maneuver_presets').insert({ id, establishment_id: establishmentId, name, config });
  if (insErr) return { error: insErr };
  const { data, error } = await client.from('maneuver_presets').select('id, name, created_by').eq('id', id).maybeSingle();
  if (error) return { error };
  return { preset: data };
}

// setRodeoDataKey: owner toggle de rodeo_data_config por data_key (resuelve field_definition_id).
// Espera a que el toggle sea visible (read-after-write lag del remoto compartido) antes de seguir,
// para que el gating capa 2 (que lee rodeo_data_config) vea el estado nuevo.
async function setRodeoDataKey(client, rodeoId, dataKey, enabled) {
  const { data: fd, error: fdErr } = await client
    .from('field_definitions').select('id').eq('data_key', dataKey).single();
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

// Read-after-write en el remoto COMPARTIDO puede tener lag: un SELECT inmediato tras un
// UPDATE (p. ej. soft-delete) o un toggle de rodeo_data_config puede ver el estado viejo.
// Reintenta hasta que el resultado satisfaga el predicado (o agota intentos).
async function eventually(fn, predicate, { tries = 6, delay = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(delay);
  }
  return last;
}

// El remoto está COMPARTIDO con otra terminal: un write legítimo puede recibir un error
// transitorio (serialization/deadlock/cancel/conexión) bajo carga concurrente. Reintenta una
// escritura que esperamos que pase, hasta que NO devuelva error (o agota intentos). Solo
// reintenta errores realmente transitorios.
//   NOTA (higiene de diagnóstico): 42501 (RLS violation) NO es transitorio — es determinista.
//   Reintentarlo enmascaraba bugs (ocultó los soft-delete por UPDATE de deleted_at de T2.8/T2.9,
//   ahora resueltos vía RPC SECURITY DEFINER 0041/0057). Sacado de la lista a propósito.
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

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin
      .from('animal_profiles').select('id, animal_id').in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id))];
    if (profileIds.length > 0) {
      await admin.from('reproductive_events').delete().in('animal_profile_id', profileIds);
      await admin.from('reproductive_events').delete().in('calf_id', profileIds);
    }
    // sessions FK ON DELETE SET NULL no bloquea el cascade de establishments.
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

test('maneuvers suite — spec 03', async (t) => {
  let userA, userB, userC, clientA, clientB, clientC, estA, estB;
  let rodeoA, rodeoB, rodeoA2;

  // ---- T2.1 setup ---------------------------------------------------------
  await t.test('T2.1 setup: usuarios, establishments, rodeos', async () => {
    userA = await createTestUser('userA'); // owner estA
    userB = await createTestUser('userB'); // owner estB
    userC = await createTestUser('userC'); // sin rol en estA
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    clientC = await getUserClient(userC.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A1' });
    rodeoA2 = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A2' });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: 'Rodeo B1' });
    assert.ok(rodeoA.id && rodeoA2.id && rodeoB.id);
  });

  // ---- T2.2 RLS de sessions (R1.1, R1.3, R10.7, R11.1, R11.3) --------------
  await t.test('T2.2 RLS sessions', async () => {
    // owner crea sesión sobre rodeo propio -> OK.
    {
      const r = await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id });
      assert.equal(r.error, undefined, r.error && r.error.message);
      assert.equal(r.session.status, 'active');
    }
    // sesión sobre rodeo de otro establishment -> 23514 (tg_sessions_rodeo_check).
    {
      const r = await createSession(clientA, { establishmentId: estA, rodeoId: rodeoB.id });
      assert.notEqual(r.error, undefined, 'rodeo ajeno debe fallar');
      assert.match(pgcode(r.error), /23514|does not belong/i);
    }
    // userC sin rol no ve ni crea.
    {
      const r = await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id });
      const { data: seen } = await clientC.from('sessions').select('id').eq('id', r.session.id);
      assert.deepEqual(seen, [], 'userC sin rol no ve la sesión');
      const c = await createSession(clientC, { establishmentId: estA, rodeoId: rodeoA.id });
      assert.notEqual(c.error, undefined, 'userC sin rol no puede crear sesión en estA');
    }
    // field_operator activo crea sesión -> OK.
    {
      await assignRoleAsService(userB.id, estA, 'field_operator');
      const clientBinA = await getUserClient(userB.email);
      const r = await createSession(clientBinA, { establishmentId: estA, rodeoId: rodeoA.id });
      assert.equal(r.error, undefined, r.error ? `field_operator: ${r.error.message}` : 'field_operator activo crea sesión');
    }
    // cerrar sesión (status='closed') por rol activo -> OK.
    {
      const r = await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id });
      const { error } = await clientA.from('sessions').update({ status: 'closed', ended_at: new Date().toISOString() }).eq('id', r.session.id);
      assert.equal(error, null, error && error.message);
    }
    // no hay DELETE de cliente (sin policy DELETE -> 0 filas afectadas).
    {
      const r = await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id });
      const { data: del } = await clientA.from('sessions').delete().eq('id', r.session.id).select();
      assert.deepEqual(del || [], [], 'no hay DELETE de cliente');
    }
  });

  // ---- T2.3 created_by forzado server-side (R11.2) ------------------------
  await t.test('T2.3 created_by forzado', async () => {
    // session: insertar con created_by = uid de otro -> queda en el caller (userA).
    // Se lee con admin (service_role) para reflejar el estado almacenado.
    {
      const id = require('node:crypto').randomUUID();
      const ins = await clientA.from('sessions').insert({ id, establishment_id: estA, rodeo_id: rodeoA.id, created_by: userB.id });
      assert.equal(ins.error, null, ins.error && ins.error.message);
      const { data } = await admin.from('sessions').select('created_by').eq('id', id).single();
      assert.equal(data.created_by, userA.id, 'created_by forzado a auth.uid() (session)');
    }
    // preset: idem.
    {
      const id = require('node:crypto').randomUUID();
      const ins = await clientA.from('maneuver_presets').insert({ id, establishment_id: estA, name: `${RUN_TAG}_p_cb`, created_by: userB.id });
      assert.equal(ins.error, null, ins.error && ins.error.message);
      const { data } = await admin.from('maneuver_presets').select('created_by').eq('id', id).single();
      assert.equal(data.created_by, userA.id, 'created_by forzado a auth.uid() (preset)');
    }
  });

  // ---- T2.4 gating capa 2 accept/reject por data_key (R7.1, R7.3, R5.4) ---
  await t.test('T2.4 gating accept/reject', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo gating' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_G1`, sex: 'female', birthDate: daysAgo(550), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'vaquillona' });
    assert.equal(an.error, undefined, an.error && an.error.message);
    const anM = await createAnimal(clientA, { idv: `${RUN_TAG}_GM`, sex: 'male', birthDate: daysAgo(900), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'torito' });
    assert.equal(anM.error, undefined, anM.error && anM.error.message);

    // peso enabled (default) -> OK; disabled -> 23514.
    {
      const ok = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 300, weight_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `peso enabled: ${ok.error.message}` : 'peso enabled -> OK');
      await setRodeoDataKey(clientA, rg.id, 'peso', false);
      const bad = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 301, weight_date: daysAgo(1) });
      assert.notEqual(bad.error, null, 'peso disabled -> reject');
      assert.match(pgcode(bad.error), /23514|missing enabled data_keys/i);
      await setRodeoDataKey(clientA, rg.id, 'peso', true);
    }
    // condicion_corporal.
    {
      const ok = await clientA.from('condition_score_events').insert({ animal_profile_id: an.profile.id, score: 3.0, event_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `cc enabled: ${ok.error.message}` : 'cc enabled -> OK');
      await setRodeoDataKey(clientA, rg.id, 'condicion_corporal', false);
      const bad = await clientA.from('condition_score_events').insert({ animal_profile_id: an.profile.id, score: 3.25, event_date: daysAgo(1) });
      assert.match(pgcode(bad.error), /23514/i, 'condicion_corporal disabled -> reject');
      await setRodeoDataKey(clientA, rg.id, 'condicion_corporal', true);
    }
    // brucelosis (lab_samples blood).
    {
      const ok = await clientA.from('lab_samples').insert({ animal_profile_id: an.profile.id, sample_type: 'blood', tube_number: 'T1', collection_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `brucelosis enabled: ${ok.error.message}` : 'brucelosis enabled -> OK');
      await setRodeoDataKey(clientA, rg.id, 'brucelosis', false);
      const bad = await clientA.from('lab_samples').insert({ animal_profile_id: an.profile.id, sample_type: 'blood', tube_number: 'T2', collection_date: daysAgo(1) });
      assert.match(pgcode(bad.error), /23514/i, 'brucelosis disabled -> reject');
      await setRodeoDataKey(clientA, rg.id, 'brucelosis', true);
    }
    // raspado_toros (lab_samples scrape_*).
    {
      const ok = await clientA.from('lab_samples').insert({ animal_profile_id: anM.profile.id, sample_type: 'scrape_tricho', tube_number: 'R1', collection_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `raspado enabled: ${ok.error.message}` : 'raspado_toros enabled -> OK');
      await setRodeoDataKey(clientA, rg.id, 'raspado_toros', false);
      const bad = await clientA.from('lab_samples').insert({ animal_profile_id: anM.profile.id, sample_type: 'scrape_campylo', tube_number: 'R2', collection_date: daysAgo(1) });
      assert.match(pgcode(bad.error), /23514/i, 'raspado_toros disabled -> reject');
      await setRodeoDataKey(clientA, rg.id, 'raspado_toros', true);
    }
    // vacunacion (sanitary_events vaccination).
    {
      const ok = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `vacunacion enabled: ${ok.error.message}` : 'vacunacion enabled -> OK');
      await setRodeoDataKey(clientA, rg.id, 'vacunacion', false);
      const bad = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(1) });
      assert.match(pgcode(bad.error), /23514/i, 'vacunacion disabled -> reject');
      await setRodeoDataKey(clientA, rg.id, 'vacunacion', true);
    }
    // tacto (reproductive_events) -> requiere prenez Y tamano_prenez.
    {
      const ok = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'empty' });
      assert.equal(ok.error, null, ok.error ? `tacto enabled: ${ok.error.message}` : 'tacto -> OK');
      // multi-key: prenez enabled pero tamano_prenez disabled -> reject (requiere ambos).
      await setRodeoDataKey(clientA, rg.id, 'tamano_prenez', false);
      const bad = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'empty' });
      assert.match(pgcode(bad.error), /23514/i, 'tacto con tamano_prenez disabled -> reject (multi-key)');
      await setRodeoDataKey(clientA, rg.id, 'tamano_prenez', true);
    }
    // tacto_vaquillona.
    {
      const ok = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(1), heifer_fitness: 'apta' });
      assert.equal(ok.error, null, ok.error ? `tacto_vaquillona enabled: ${ok.error.message}` : 'tacto_vaquillona -> OK');
      await setRodeoDataKey(clientA, rg.id, 'tacto_vaquillona', false);
      const bad = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(1), heifer_fitness: 'no_apta' });
      assert.match(pgcode(bad.error), /23514/i, 'tacto_vaquillona disabled -> reject');
      await setRodeoDataKey(clientA, rg.id, 'tacto_vaquillona', true);
    }
    // inseminacion (reproductive_events service + ai).
    {
      // Aseguramos el estado enabled de forma lag-tolerante antes del insert de aceptación
      // (el toggle previo sobre este rodeo compartido puede no haber propagado).
      await setRodeoDataKey(clientA, rg.id, 'inseminacion', true);
      const ok = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'service', service_type: 'ai', event_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `inseminacion enabled: ${ok.error.message}` : 'inseminacion -> OK');
      await setRodeoDataKey(clientA, rg.id, 'inseminacion', false);
      const bad = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'service', service_type: 'ai', event_date: daysAgo(1) });
      assert.match(pgcode(bad.error), /23514/i, 'inseminacion disabled -> reject');
      // servicio natural NO se gatea por inseminacion -> OK aunque inseminacion siga disabled.
      const nat = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'service', service_type: 'natural', event_date: daysAgo(1) });
      assert.equal(nat.error, null, nat.error ? `servicio natural: ${nat.error.message}` : 'servicio natural no se gatea');
      await setRodeoDataKey(clientA, rg.id, 'inseminacion', true);
    }
  });

  // ---- T2.4b gating fail-closed (R7.6, SEC-SPEC-03-03) --------------------
  await t.test('T2.4b gating fail-closed', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo failclosed' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_FC`, sex: 'female', birthDate: daysAgo(550), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'vaquillona' });
    // (c) control: perfil activo con data_key enabled -> OK.
    {
      const ok = await clientA.from('condition_score_events').insert({ animal_profile_id: an.profile.id, score: 3.0, event_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `control: ${ok.error.message}` : 'control: perfil activo enabled -> OK');
    }
    // (a) perfil soft-deleted -> rodeo no resoluble -> reject (NO fail-open).
    {
      await admin.from('animal_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', an.profile.id);
      const bad = await admin.from('condition_score_events').insert({ animal_profile_id: an.profile.id, score: 3.25, event_date: daysAgo(1) });
      assert.notEqual(bad.error, null, 'perfil soft-deleted -> reject (fail-closed)');
      assert.match(pgcode(bad.error), /23514|cannot resolve rodeo/i);
    }
    // (b) perfil inexistente -> reject (gating 23514 o FK 23503; ambos = rechazo).
    {
      const ghost = require('node:crypto').randomUUID();
      const bad = await admin.from('condition_score_events').insert({ animal_profile_id: ghost, score: 3.0, event_date: daysAgo(1) });
      assert.notEqual(bad.error, null, 'perfil inexistente -> reject');
      assert.match(pgcode(bad.error), /23514|23503|cannot resolve rodeo|foreign key/i);
    }
  });

  // ---- T2.4c gating deworming + treatment (R7.7, R6.13-R6.15, M3.0-BACKEND) ----
  // ⚠️ PENDIENTE DEPLOY: la migración 0091 que extiende tg_sanitary_events_gating para gatear
  // deworming/treatment NO está aplicada hasta que el leader la deploye (Gate 1 + OK de Raf).
  // Mientras tanto, los asserts de RECHAZO de este bloque FALLAN por la RAZÓN correcta: el trigger
  // viejo (0054) solo gatea 'vaccination' → el INSERT de deworming/treatment sobre un rodeo SIN el
  // data_key habilitado NO se rechaza (se acepta) → el assert de 23514 falla. NO es bug del test:
  // es el estado pre-deploy. Pasa recién POST-DEPLOY de 0091.
  await t.test('T2.4c gating deworming/treatment', async () => {
    const rg = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo gating sanitario' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_GS`, sex: 'female', birthDate: daysAgo(550), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'vaquillona' });
    assert.equal(an.error, undefined, an.error && an.error.message);

    // --- treatment (antibiótico) → single key 'antibiotico', igual que vaccination ---
    {
      // antibiotico enabled (default de cría) → OK.
      await setRodeoDataKey(clientA, rg.id, 'antibiotico', true);
      const ok = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'treatment', product_name: 'Oxitetraciclina', event_date: daysAgo(1) });
      assert.equal(ok.error, null, ok.error ? `treatment enabled: ${ok.error.message}` : 'treatment con antibiotico enabled -> OK');
      // antibiotico disabled → reject 23514.
      await setRodeoDataKey(clientA, rg.id, 'antibiotico', false);
      const bad = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'treatment', product_name: 'Oxitetraciclina', event_date: daysAgo(1) });
      assert.notEqual(bad.error, null, 'treatment con antibiotico disabled -> reject');
      assert.match(pgcode(bad.error), /23514|missing enabled data_keys|none of the alternative/i, 'treatment disabled -> 23514');
      await setRodeoDataKey(clientA, rg.id, 'antibiotico', true);
    }

    // --- deworming (antiparasitario) → OR de antiparasitario_interno / antiparasitario_externo (R6.14/D10) ---
    {
      // (1) NINGUNO enabled → reject 23514 (fail-closed de la OR).
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_interno', false);
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_externo', false);
      const badNone = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'deworming', product_name: 'Ivermectina', event_date: daysAgo(1) });
      assert.notEqual(badNone.error, null, 'deworming con NINGUN antiparasitario enabled -> reject');
      assert.match(pgcode(badNone.error), /23514|none of the alternative|missing enabled/i, 'deworming ninguno -> 23514');

      // (2) SOLO interno enabled → OK (basta uno).
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_interno', true);
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_externo', false);
      const okInterno = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'deworming', product_name: 'Ivermectina', event_date: daysAgo(1) });
      assert.equal(okInterno.error, null, okInterno.error ? `deworming solo interno: ${okInterno.error.message}` : 'deworming con solo antiparasitario_interno enabled -> OK');

      // (3) SOLO externo enabled → OK (basta uno).
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_interno', false);
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_externo', true);
      const okExterno = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'deworming', product_name: 'Cipermetrina', event_date: daysAgo(1) });
      assert.equal(okExterno.error, null, okExterno.error ? `deworming solo externo: ${okExterno.error.message}` : 'deworming con solo antiparasitario_externo enabled -> OK');

      // (4) AMBOS enabled → OK.
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_interno', true);
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_externo', true);
      const okAmbos = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'deworming', product_name: 'Doramectina', event_date: daysAgo(1) });
      assert.equal(okAmbos.error, null, okAmbos.error ? `deworming ambos: ${okAmbos.error.message}` : 'deworming con ambos antiparasitarios enabled -> OK');
    }

    // --- no-bypass (R7.3): INSERT directo PostgREST sobre rodeo sin el data_key -> rechazado igual ---
    // (ya cubierto arriba: los inserts son PostgREST directos; este caso lo deja explícito con admin/service_role,
    //  que TAMBIÉN debe ser rechazado porque el trigger corre BEFORE INSERT independiente del rol.)
    {
      await setRodeoDataKey(clientA, rg.id, 'antibiotico', false);
      const badAdmin = await admin.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'treatment', product_name: 'X', event_date: daysAgo(1) });
      assert.notEqual(badAdmin.error, null, 'treatment por service_role sobre rodeo sin antibiotico -> reject (no-bypass)');
      assert.match(pgcode(badAdmin.error), /23514|missing enabled|none of the alternative/i, 'no-bypass treatment -> 23514');
      await setRodeoDataKey(clientA, rg.id, 'antibiotico', true);
    }

    // --- fail-closed (R7.6): rodeo no resoluble (perfil soft-deleted) -> reject 23514 ---
    {
      const an2 = await createAnimal(clientA, { idv: `${RUN_TAG}_GS_FC`, sex: 'female', birthDate: daysAgo(550), rodeoId: rg.id, establishmentId: estA, systemId: rg.systemId, categoryCode: 'vaquillona' });
      await admin.from('animal_profiles').update({ deleted_at: new Date().toISOString() }).eq('id', an2.profile.id);
      const badDW = await admin.from('sanitary_events').insert({ animal_profile_id: an2.profile.id, event_type: 'deworming', product_name: 'Ivermectina', event_date: daysAgo(1) });
      assert.notEqual(badDW.error, null, 'deworming sobre perfil soft-deleted -> reject (fail-closed)');
      assert.match(pgcode(badDW.error), /23514|cannot resolve rodeo/i, 'fail-closed deworming -> 23514');
      const badTR = await admin.from('sanitary_events').insert({ animal_profile_id: an2.profile.id, event_type: 'treatment', product_name: 'Oxi', event_date: daysAgo(1) });
      assert.notEqual(badTR.error, null, 'treatment sobre perfil soft-deleted -> reject (fail-closed)');
      assert.match(pgcode(badTR.error), /23514|cannot resolve rodeo/i, 'fail-closed treatment -> 23514');
    }

    // --- regresión: NO se rompió el gating de vaccination ni los event_type no gateados ---
    {
      // vaccination sigue gateado por 'vacunacion' (default enabled) -> OK.
      const okVac = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(1) });
      assert.equal(okVac.error, null, okVac.error ? `regresión vaccination: ${okVac.error.message}` : 'vaccination sigue OK (no se rompió 0054)');
      // event_type='other' NO se gatea aunque ningún antiparasitario esté enabled -> OK.
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_interno', false);
      await setRodeoDataKey(clientA, rg.id, 'antiparasitario_externo', false);
      const okOther = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'other', product_name: 'Vitaminas', event_date: daysAgo(1) });
      assert.equal(okOther.error, null, okOther.error ? `event_type other: ${okOther.error.message}` : "event_type='other' no se gatea -> OK");
    }
  });

  // ---- T2.5 binding data_key <-> field_definitions (R7.2) -----------------
  await t.test('T2.5 binding data_key existe en field_definitions', async () => {
    const dataKeys = ['condicion_corporal', 'peso', 'brucelosis', 'raspado_toros', 'vacunacion', 'prenez', 'tamano_prenez', 'tacto_vaquillona', 'inseminacion', 'dientes', 'antiparasitario_interno', 'antiparasitario_externo', 'antibiotico'];
    for (const dk of dataKeys) {
      const { data, error } = await clientA.from('field_definitions').select('data_key').eq('data_key', dk).maybeSingle();
      assert.equal(error, null, error && error.message);
      assert.ok(data && data.data_key === dk, `data_key '${dk}' del trigger debe existir en field_definitions`);
    }
  });

  // ---- T2.6 tenant-check de session_id (R5.11, R7.4, R1.1, SEC-SPEC-03-04) -
  await t.test('T2.6 tenant-check session_id', async () => {
    const sessA = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
    const sessB = (await createSession(clientB, { establishmentId: estB, rodeoId: rodeoB.id })).session;
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TC`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });

    // OK: misma sesión/establishment/rodeo, sesión active.
    {
      const ok = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 300, weight_date: daysAgo(1), session_id: sessA.id });
      assert.equal(ok.error, null, ok.error && ok.error.message);
    }
    // cross-tenant: session_id de otro establishment -> 23514.
    {
      const bad = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 301, weight_date: daysAgo(1), session_id: sessB.id });
      assert.match(pgcode(bad.error), /23514|different establishment/i, 'cross-tenant -> 23514');
    }
    // cross-tenant en otra tabla (sanitary_events).
    {
      const bad = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'X', event_date: daysAgo(1), session_id: sessB.id });
      assert.match(pgcode(bad.error), /23514|different establishment/i, 'cross-tenant (sanitary) -> 23514');
    }
    // session_id inexistente -> 23503 (no encontrada).
    {
      const ghost = require('node:crypto').randomUUID();
      const bad = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 302, weight_date: daysAgo(1), session_id: ghost });
      assert.match(pgcode(bad.error), /23503|not found/i, 'session inexistente -> 23503');
    }
    // sin session_id -> OK.
    {
      const ok = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 303, weight_date: daysAgo(1) });
      assert.equal(ok.error, null, 'sin session_id -> OK');
    }
    // animal de otro rodeo del mismo establishment -> 23514 (R1.1 una sesión = un rodeo).
    {
      const anOtro = await createAnimal(clientA, { idv: `${RUN_TAG}_TC2`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA2.id, establishmentId: estA, systemId: rodeoA2.systemId, categoryCode: 'vaquillona' });
      const bad = await clientA.from('weight_events').insert({ animal_profile_id: anOtro.profile.id, weight_kg: 304, weight_date: daysAgo(1), session_id: sessA.id });
      assert.match(pgcode(bad.error), /23514|does not match session rodeo/i, 'animal de otro rodeo -> 23514');
    }
    // sesión closed -> insertar evento NUEVO contra ella -> 23514.
    {
      const sessClosed = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
      await clientA.from('sessions').update({ status: 'closed' }).eq('id', sessClosed.id);
      const bad = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 305, weight_date: daysAgo(1), session_id: sessClosed.id });
      assert.match(pgcode(bad.error), /23514|must be active/i, 'evento nuevo contra sesión closed -> 23514');
    }
    // orden de cierre (R10.8 / design §5): create-events -> close NO rechaza los eventos ya creados.
    {
      const sessOrd = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
      const ok = await clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 306, weight_date: daysAgo(1), session_id: sessOrd.id });
      assert.equal(ok.error, null, 'evento creado con sesión active -> OK');
      const close = await clientA.from('sessions').update({ status: 'closed' }).eq('id', sessOrd.id);
      assert.equal(close.error, null, 'cerrar la sesión NO rechaza los eventos ya creados (orden de cierre)');
    }
  });

  // ---- T2.7 transición de categoría en maniobra + ortogonalidad (R8.1-R8.3) -
  await t.test('T2.7 transición en maniobra', async () => {
    const sessA = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
    const vq = await createAnimal(clientA, { idv: `${RUN_TAG}_TR`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    const grp = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_loteTR` });
    await clientA.from('animal_profiles').update({ management_group_id: grp.id }).eq('id', vq.profile.id);
    // tacto positivo (medium) con session_id -> transición a vaquillona_prenada.
    {
      const { error } = await clientA.from('reproductive_events').insert({ animal_profile_id: vq.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'medium', session_id: sessA.id });
      assert.equal(error, null, error && error.message);
      const { data } = await clientA.from('animal_profiles').select('category_id, management_group_id, rodeo_id').eq('id', vq.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'vaquillona_prenada', 'tacto positivo en maniobra -> vaquillona_prenada (R8.1)');
      assert.equal(data.management_group_id, grp.id, 'ortogonalidad: lote intacto (R8.3)');
      assert.equal(data.rodeo_id, rodeoA.id, 'ortogonalidad: rodeo intacto (R8.3)');
      const { data: hist } = await clientA.from('animal_category_history').select('reason').eq('animal_profile_id', vq.profile.id);
      assert.ok(hist.map((r) => r.reason).includes('auto_transition'), 'transición queda en animal_category_history (R8.2)');
    }
    // category_override=true -> no transiciona.
    {
      const vq2 = await createAnimal(clientA, { idv: `${RUN_TAG}_TROV`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
      await clientA.from('animal_profiles').update({ category_override: true }).eq('id', vq2.profile.id);
      await clientA.from('reproductive_events').insert({ animal_profile_id: vq2.profile.id, event_type: 'tacto', event_date: daysAgo(1), pregnancy_status: 'large', session_id: sessA.id });
      const { data } = await clientA.from('animal_profiles').select('category_id').eq('id', vq2.profile.id).single();
      const { data: cat } = await clientA.from('categories_by_system').select('code').eq('id', data.category_id).single();
      assert.equal(cat.code, 'vaquillona', 'override=true bloquea transición');
    }
  });

  // ---- T2.8 RLS de maneuver_presets (R2.1, R2.4, R2.5, R11.1, R11.3) ------
  await t.test('T2.8 RLS presets', async () => {
    // Cliente owner fresco para los tests tardíos (higiene, no afecta el contrato de seguridad).
    // NOTA: los 42501 que antes fallaban acá NO eran degradación de token ni flake del remoto —
    // eran el soft-delete por UPDATE de deleted_at chocando con la visibilidad post-UPDATE de
    // PostgREST (determinista). Resuelto vía RPC SECURITY DEFINER (ver el bloque de soft-delete).
    clientA = await getUserClient(userA.email);
    {
      const r = await writeWithRetry(() => createPreset(clientA, { establishmentId: estA, name: `${RUN_TAG}_preset1`, config: { maneuvers: ['peso'] } }));
      assert.equal(r.error, undefined, r.error && r.error.message);
      const seen = await eventually(
        async () => (await clientA.from('maneuver_presets').select('id').eq('id', r.preset.id)).data,
        (d) => Array.isArray(d) && d.length === 1,
      );
      assert.equal(seen.length, 1, 'owner ve su preset');
      const { error: updErr } = await writeWithRetry(() => clientA.from('maneuver_presets').update({ name: `${RUN_TAG}_preset1b` }).eq('id', r.preset.id));
      assert.equal(updErr, null, updErr && updErr.message);
    }
    {
      const r = await writeWithRetry(() => createPreset(clientA, { establishmentId: estA, name: `${RUN_TAG}_preset2` }));
      assert.equal(r.error, undefined, r.error && r.error.message);
      const { data } = await clientC.from('maneuver_presets').select('id').eq('id', r.preset.id);
      assert.deepEqual(data, [], 'userC sin rol no ve presets');
    }
    {
      const id = require('node:crypto').randomUUID();
      const { error } = await clientA.from('maneuver_presets').insert({ id, establishment_id: estA, name: '   ' });
      assert.notEqual(error, null, 'name vacío -> falla el CHECK');
    }
    {
      const r = await writeWithRetry(() => createPreset(clientA, { establishmentId: estA, name: `${RUN_TAG}_preset3` }));
      assert.equal(r.error, undefined, r.error && r.error.message);
      // Soft-delete vía RPC SECURITY DEFINER (0057): el UPDATE directo de deleted_at choca con
      // la verificación de visibilidad post-UPDATE de PostgREST (la fila sale del SELECT por la
      // policy `deleted_at is null`) → 42501 DETERMINISTA. El RPC hace el UPDATE por dentro.
      const { error: delErr } = await clientA.rpc('soft_delete_maneuver_preset', { p_preset_id: r.preset.id });
      assert.equal(delErr, null, delErr && delErr.message);
      const data = await eventually(
        async () => (await clientA.from('maneuver_presets').select('id').eq('id', r.preset.id)).data,
        (d) => Array.isArray(d) && d.length === 0,
      );
      assert.deepEqual(data, [], 'preset soft-deleted no aparece en SELECT');
    }
  });

  // ---- T2.9 append-only / corrección per-evento (R11.5) ------------------
  await t.test('T2.9 append-only corrección per-evento', async () => {
    // Cliente owner fresco (ver nota en T2.8): el 42501 de antes era el soft-delete por UPDATE,
    // no degradación de token. El soft-delete usa ahora el RPC soft_delete_event (0041).
    clientA = await getUserClient(userA.email);
    const sessA = (await createSession(clientA, { establishmentId: estA, rodeoId: rodeoA.id })).session;
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_AO`, sex: 'female', birthDate: daysAgo(550), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'vaquillona' });
    const ins1 = await writeWithRetry(() => clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 300, weight_date: daysAgo(1), session_id: sessA.id }));
    assert.equal(ins1.error, null, ins1.error && ins1.error.message);
    const ev = await eventually(
      async () => (await clientA.from('weight_events').select('id').eq('animal_profile_id', an.profile.id).eq('weight_kg', 300).maybeSingle()).data,
      (d) => d && d.id,
    );
    {
      const { data: upd, error } = await writeWithRetry(() => clientA.from('weight_events').update({ weight_kg: 305 }).eq('id', ev.id).select('weight_kg'));
      assert.equal(error, null, error && error.message);
      assert.equal(upd[0].weight_kg, 305, 'owner corrige el evento por edición (R11.5)');
    }
    {
      // Soft-delete vía RPC SECURITY DEFINER (0041, spec 02): el UPDATE directo de deleted_at
      // choca con la verificación de visibilidad post-UPDATE de PostgREST (la policy SELECT de
      // weight_events incluye `deleted_at is null` → la fila sale del SELECT) → 42501 DETERMINISTA.
      const { error: delErr } = await clientA.rpc('soft_delete_event', { p_kind: 'weight', p_event_id: ev.id });
      assert.equal(delErr, null, delErr && delErr.message);
      const data = await eventually(
        async () => (await clientA.from('weight_events').select('id').eq('id', ev.id)).data,
        (d) => Array.isArray(d) && d.length === 0,
      );
      assert.deepEqual(data, [], 'evento soft-deleted no aparece');
    }
    {
      const ins2 = await writeWithRetry(() => clientA.from('weight_events').insert({ animal_profile_id: an.profile.id, weight_kg: 310, weight_date: daysAgo(1) }));
      assert.equal(ins2.error, null, ins2.error && ins2.error.message);
      const ev2 = await eventually(
        async () => (await clientA.from('weight_events').select('id').eq('animal_profile_id', an.profile.id).eq('weight_kg', 310).maybeSingle()).data,
        (d) => d && d.id,
      );
      const { data: upd } = await clientC.from('weight_events').update({ weight_kg: 999 }).eq('id', ev2.id).select();
      assert.deepEqual(upd || [], [], 'userC sin rol no edita evento (sin camino cross-tenant)');
    }
  });

  // ---- T2.11 no-bypass del gating dientes/CUT (R7.5, SEC-SPEC-03-01) ------
  await t.test('T2.11 dientes/CUT gating afinado', async () => {
    const rNoDientes = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo sin dientes' });
    await setRodeoDataKey(clientA, rNoDientes.id, 'dientes', false);
    const cutId = await categoryId(clientA, rNoDientes.systemId, 'cut');

    // (a) UPDATE teeth_state a valor no-NULL (aditivo) sobre rodeo sin dientes -> rechazado.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_A`, sex: 'female', birthDate: daysAgo(900), rodeoId: rNoDientes.id, establishmentId: estA, systemId: rNoDientes.systemId, categoryCode: 'multipara' });
      const { data: upd, error } = await clientA.from('animal_profiles').update({ teeth_state: 'sin_dientes' }).eq('id', an.profile.id).select();
      assert.ok(error || !upd || upd.length === 0, 'teeth_state aditivo sobre rodeo sin dientes -> rechazado');
      if (error) assert.match(pgcode(error), /23514|missing enabled data_keys/i);
    }
    // (b) UPDATE is_cut=true (aditivo false->true) sobre rodeo sin dientes -> rechazado.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_B`, sex: 'female', birthDate: daysAgo(900), rodeoId: rNoDientes.id, establishmentId: estA, systemId: rNoDientes.systemId, categoryCode: 'multipara' });
      const { data: upd, error } = await clientA.from('animal_profiles').update({ is_cut: true, category_id: cutId, category_override: true }).eq('id', an.profile.id).select();
      assert.ok(error || !upd || upd.length === 0, 'is_cut true (aditivo) sobre rodeo sin dientes -> rechazado');
      if (error) assert.match(pgcode(error), /23514|missing enabled data_keys/i);
    }
    // Controles: rodeo con dientes ENABLED -> ambos UPDATE OK.
    const rDientes = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo con dientes' });
    const cutId2 = await categoryId(clientA, rDientes.systemId, 'cut');
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_C`, sex: 'female', birthDate: daysAgo(900), rodeoId: rDientes.id, establishmentId: estA, systemId: rDientes.systemId, categoryCode: 'multipara' });
      const { error: e1 } = await clientA.from('animal_profiles').update({ teeth_state: '1/2' }).eq('id', an.profile.id);
      assert.equal(e1, null, e1 ? `control teeth_state: ${e1.message}` : 'control: teeth_state sobre rodeo con dientes -> OK');
      const { error: e2 } = await clientA.from('animal_profiles').update({ is_cut: true, category_id: cutId2, category_override: true }).eq('id', an.profile.id);
      assert.equal(e2, null, e2 ? `control is_cut: ${e2.message}` : 'control: is_cut true sobre rodeo con dientes -> OK');
    }
    // (E) SUSTRACTIVO: limpiar teeth_state a NULL sobre rodeo SIN dientes -> ACEPTADO.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_E`, sex: 'female', birthDate: daysAgo(900), rodeoId: rDientes.id, establishmentId: estA, systemId: rDientes.systemId, categoryCode: 'multipara' });
      await clientA.from('animal_profiles').update({ teeth_state: 'sin_dientes' }).eq('id', an.profile.id);
      await clientA.from('animal_profiles').update({ rodeo_id: rNoDientes.id }).eq('id', an.profile.id);
      const { error } = await clientA.from('animal_profiles').update({ teeth_state: null }).eq('id', an.profile.id);
      assert.equal(error, null, error ? `Caso E: ${error.message}` : 'Caso E: limpiar teeth_state a NULL sobre rodeo sin dientes -> aceptado');
    }
    // (F) SUSTRACTIVO: desmarcar is_cut (true->false) sobre rodeo SIN dientes -> ACEPTADO.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_F`, sex: 'female', birthDate: daysAgo(900), rodeoId: rDientes.id, establishmentId: estA, systemId: rDientes.systemId, categoryCode: 'multipara' });
      await clientA.from('animal_profiles').update({ is_cut: true, category_id: cutId2, category_override: true }).eq('id', an.profile.id);
      await clientA.from('animal_profiles').update({ rodeo_id: rNoDientes.id }).eq('id', an.profile.id);
      const { error } = await clientA.from('animal_profiles').update({ is_cut: false }).eq('id', an.profile.id);
      assert.equal(error, null, error ? `Caso F: ${error.message}` : 'Caso F: desmarcar is_cut sobre rodeo sin dientes -> aceptado');
    }
    // Guarda WHEN: UPDATE de lote (management_group_id) sobre rodeo sin dientes -> NO gatea (OK).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_LOTE`, sex: 'female', birthDate: daysAgo(900), rodeoId: rNoDientes.id, establishmentId: estA, systemId: rNoDientes.systemId, categoryCode: 'multipara' });
      const grp = await createManagementGroup(clientA, { establishmentId: estA, name: `${RUN_TAG}_loteTD` });
      const { error } = await clientA.from('animal_profiles').update({ management_group_id: grp.id }).eq('id', an.profile.id);
      assert.equal(error, null, error ? `lote: ${error.message}` : 'UPDATE de lote NO dispara el gating (guarda WHEN)');
    }
    // Guarda WHEN: UPDATE de rodeo_id (R4.4) sobre rodeo sin dientes -> NO gatea (OK).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TD_ROD`, sex: 'female', birthDate: daysAgo(900), rodeoId: rNoDientes.id, establishmentId: estA, systemId: rNoDientes.systemId, categoryCode: 'multipara' });
      const { error } = await clientA.from('animal_profiles').update({ rodeo_id: rDientes.id }).eq('id', an.profile.id);
      assert.equal(error, null, error ? `rodeo: ${error.message}` : 'UPDATE de rodeo NO dispara el gating (guarda WHEN)');
    }
  });

  // ---- cleanup ------------------------------------------------------------
  await t.test('cleanup', async () => {
    await cleanup();
  });
});
