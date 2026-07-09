// supabase/tests/operaciones_rodeo/run.cjs
// Suite de tests de la spec 10-operaciones-rodeo (Fase 1, backend delta).
// Corre contra la base remota: service_role para fixtures, JWTs reales para los asserts
// de RLS/triggers/gating. Limpia users/establishments al final (CASCADE).
//
// Cubre el delta de §4 del design: future_bull (0085) + denorm is_castrated con write-through
// perfil->animals + propagación down con pre-filtro LIM-2 (0084) + recompute simétrico (0086).
//
// Mapa T-DB.<n> -> R<n> en progress/impl_10-backend-delta.md.
//
// Uso: las vars se cargan desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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

// Management API (database/query) para asertar el pre-filtro literal contra pg_catalog
// y el orden de triggers (T-DB.4f). Mismo endpoint que scripts/apply-migration.mjs.
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
async function adminQuery(sql) {
  if (!PROJECT_REF || !ACCESS_TOKEN) {
    throw new Error('Falta SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN para adminQuery (asserts de catálogo).');
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ query: sql }), 'utf8'),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`adminQuery HTTP ${res.status}: ${body}`);
  return JSON.parse(body);
}

const RUN_TAG = `oprod_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];
const createdAnimalIds = [];

// ---- helpers de fixtures (mismo patrón que animal/maneuvers) ----

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
  const { error } = await admin.from('user_roles').insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
}

async function lookupSpeciesSystem(client, speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp, error: spErr } = await client.from('species').select('id').eq('code', speciesCode).single();
  if (spErr) throw new Error(`lookup species: ${spErr.message}`);
  const { data: sys, error: sysErr } = await client.from('systems_by_species').select('id').eq('species_id', sp.id).eq('code', systemCode).single();
  if (sysErr) throw new Error(`lookup system: ${sysErr.message}`);
  return { speciesId: sp.id, systemId: sys.id };
}

async function categoryId(client, systemId, code) {
  const { data, error } = await client.from('categories_by_system').select('id').eq('system_id', systemId).eq('code', code).single();
  if (error) throw new Error(`lookup category ${code}: ${error.message}`);
  return data.id;
}

async function createRodeo(client, { establishmentId, name, systemCode = 'cria' }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client, 'bovino', systemCode);
  const { error: insErr } = await client.from('rodeos').insert({ establishment_id: establishmentId, name, species_id: speciesId, system_id: systemId });
  if (insErr) throw new Error(`createRodeo insert(${name}): ${insErr.message}`);
  const { data, error } = await client.from('rodeos').select('id, system_id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

// createAnimal: crea animals + animal_profiles (split, IDs cliente). Devuelve el id conocido.
async function createAnimal(client, { tag = null, idv = null, sex, birthDate = null, isCastrated = null, rodeoId, establishmentId, systemId, categoryCode = null }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = crypto.randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (tag) animalPayload.tag_electronic = tag;
  if (birthDate) animalPayload.birth_date = birthDate;
  if (isCastrated != null) animalPayload.is_castrated = isCastrated;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) return { error: aErr };
  createdAnimalIds.push(animalId);

  let catId;
  if (categoryCode) catId = await categoryId(client, systemId, categoryCode);
  else catId = await categoryId(client, systemId, sex === 'male' ? 'torito' : 'vaquillona');

  const profileId = crypto.randomUUID();
  const profilePayload = { id: profileId, animal_id: animalId, establishment_id: establishmentId, rodeo_id: rodeoId, category_id: catId, status: 'active' };
  if (idv) profilePayload.idv = idv;
  // IDU: visual_id_alt eliminado (0122). Un perfil sin idv/tag persiste (trigger de completitud dropeado).
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };

  return { profile: { id: profileId, category_id: catId, rodeo_id: rodeoId, animal_id: animalId }, animalId };
}

// createSecondaryProfile: un SEGUNDO perfil del MISMO animal global en otro campo (ADR-004, animal
// compartido/transferido). El unique parcial animal_profiles_active_animal_unique permite a lo sumo UN
// perfil active por animal (el activo ya vive en estA), así que el segundo se inserta NO-activo
// (status='transferred') directamente — no colisiona con el parcial (que solo cubre status='active').
// Se inserta vía service_role (fixture): los triggers de tabla (rodeo_check, force_is_castrated, etc.)
// igual disparan, así que el perfil queda válido. La propagación de is_castrated (estilo 0079, sin
// filtro de status) lo alcanza mientras su rodeo viva.
async function createSecondaryProfile(client, { animalId, establishmentId, rodeoId, systemId, idv, categoryCode = 'torito' }) {
  const catId = await categoryId(client, systemId, categoryCode);
  const profileId = crypto.randomUUID();
  const { error } = await admin.from('animal_profiles').insert({
    id: profileId, animal_id: animalId, establishment_id: establishmentId, rodeo_id: rodeoId, category_id: catId, status: 'transferred', idv,
  });
  if (error) throw new Error(`createSecondaryProfile insert: ${error.message}`);
  return profileId;
}

async function createManagementGroup(client, { establishmentId, name }) {
  const { error: insErr } = await client.from('management_groups').insert({ establishment_id: establishmentId, name });
  if (insErr) return { error: insErr };
  const { data, error } = await client.from('management_groups').select('id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw error;
  return { id: data.id };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function eventually(fn, predicate, { tries = 6, delay = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(delay);
  }
  return last;
}

// Lee el code de la categoría materializada (service_role: independiente de RLS).
async function profileCodeAdmin(profileId) {
  const { data: p } = await admin.from('animal_profiles').select('category_id').eq('id', profileId).single();
  const { data: c } = await admin.from('categories_by_system').select('code').eq('id', p.category_id).single();
  return c.code;
}

async function animalIsCastratedAdmin(animalId) {
  const { data } = await admin.from('animals').select('is_castrated').eq('id', animalId).single();
  return data.is_castrated;
}

async function profileFieldsAdmin(profileId, cols) {
  const { data } = await admin.from('animal_profiles').select(cols).eq('id', profileId).single();
  return data;
}

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin.from('animal_profiles').select('id, animal_id').in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set([...(profs || []).map((r) => r.animal_id), ...createdAnimalIds])];
    if (profileIds.length > 0) {
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

test('operaciones-rodeo suite — spec 10 Fase 1 (backend delta)', async (t) => {
  let userA, userB, clientA, clientB, estA, estB, rodeoA, rodeoB;

  await t.test('setup: usuarios, establishments, rodeos', async () => {
    userA = await createTestUser('userA');
    userB = await createTestUser('userB');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo principal' });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: 'Rodeo principal' });
  });

  // ============================================================
  // T-DB.4 — write-through + fidelidad + no-loop + SKIP rodeo muerto + orden pg_trigger
  // Cubre R13.3, R13.4
  // ============================================================
  await t.test('T-DB.4(a) write-through perfil->animals (true y false)', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_WT1`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    assert.equal(an.error, undefined, an.error && an.error.message);
    // El perfil nace con is_castrated=false (force desde animals).
    assert.equal((await profileFieldsAdmin(an.profile.id, 'is_castrated')).is_castrated, false, 'perfil nace is_castrated=false');
    // UPDATE perfil true -> write-through a animals.
    {
      const { error } = await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(error, null, error && error.message);
      const got = await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === true);
      assert.equal(got, true, 'animals.is_castrated = true tras el UPDATE del perfil (write-through up)');
    }
    // UPDATE perfil false -> write-through revert a animals.
    {
      const { error } = await clientA.from('animal_profiles').update({ is_castrated: false }).eq('id', an.profile.id);
      assert.equal(error, null, error && error.message);
      const got = await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === false);
      assert.equal(got, false, 'animals.is_castrated = false tras el revert del perfil');
    }
  });

  await t.test('T-DB.4(b) force-INSERT: perfil nace fiel a animals aunque el payload mienta', async () => {
    // animals.is_castrated = true, pero el INSERT del perfil manda is_castrated=false (miente).
    const { speciesId } = await lookupSpeciesSystem(clientA);
    const animalId = crypto.randomUUID();
    createdAnimalIds.push(animalId);
    {
      const { error } = await clientA.from('animals').insert({ id: animalId, sex: 'male', species_id: speciesId, tag_electronic: `${RUN_TAG}_FORCE`, is_castrated: true });
      assert.equal(error, null, error && error.message);
    }
    const catId = await categoryId(clientA, rodeoA.systemId, 'torito');
    const profileId = crypto.randomUUID();
    {
      const { error } = await clientA.from('animal_profiles').insert({
        id: profileId, animal_id: animalId, establishment_id: estA, rodeo_id: rodeoA.id, category_id: catId, status: 'active',
        is_castrated: false,  // <- el payload miente
      });
      assert.equal(error, null, error && error.message);
    }
    // El force-INSERT lo dejó fiel a animals (= true), ignorando el payload.
    assert.equal((await profileFieldsAdmin(profileId, 'is_castrated')).is_castrated, true, 'force-INSERT: perfil nace fiel a animals (true), no al payload mentiroso');
  });

  await t.test('T-DB.4(c) propagación down actualiza TODOS los perfiles del animal', async () => {
    // Un animal compartido (ADR-004): un perfil ACTIVO en estA + un perfil NO-activo (transferido) en estB
    // del MISMO animal global. El unique parcial animal_profiles_active_animal_unique permite a lo sumo UN
    // perfil active por animal → el de estB se deja 'transferred'. La propagación (sin filtro de status,
    // estilo 0079) lo alcanza igual mientras su rodeo esté vivo.
    const an = await createAnimal(clientA, { tag: `${RUN_TAG}_SHARED`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    assert.equal(an.error, undefined, an.error && an.error.message);
    const profileB = await createSecondaryProfile(clientB, { animalId: an.animalId, establishmentId: estB, rodeoId: rodeoB.id, systemId: rodeoB.systemId, idv: `${RUN_TAG}_SHB` });
    // userA castra desde su perfil → write-through a animals → propagación down a AMBOS perfiles (rodeo vivo).
    {
      const { error } = await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(error, null, error && error.message);
    }
    const propA = await eventually(() => profileFieldsAdmin(an.profile.id, 'is_castrated').then((r) => r.is_castrated), (v) => v === true);
    const propB = await eventually(() => profileFieldsAdmin(profileB, 'is_castrated').then((r) => r.is_castrated), (v) => v === true);
    assert.equal(propA, true, 'perfil propio activo (estA) is_castrated=true');
    assert.equal(propB, true, 'perfil compartido no-activo (estB) is_castrated=true via propagación down');
  });

  await t.test('T-DB.4(d) no-loop: la cadena termina, history sin duplicados', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_NOLOOP`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    assert.equal(an.error, undefined, an.error && an.error.message);
    // history antes (debe haber al menos 'initial').
    const before = (await admin.from('animal_category_history').select('id').eq('animal_profile_id', an.profile.id)).data || [];
    // Castrar: torito->novillito. UNA sola transición → UNA fila de history nueva (no loop).
    {
      const { error } = await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(error, null, error && error.message);
    }
    await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'novillito');
    // Damos margen a que cualquier rebote (si existiera) se manifieste.
    await sleep(800);
    const after = (await admin.from('animal_category_history').select('id, reason').eq('animal_profile_id', an.profile.id)).data || [];
    assert.equal(after.length, before.length + 1, 'exactamente UNA fila de history nueva (sin loop/duplicados)');
    assert.equal(await profileCodeAdmin(an.profile.id), 'novillito', 'torito->novillito una sola vez');
    assert.equal(await animalIsCastratedAdmin(an.animalId), true, 'animals quedó coherente (true)');
  });

  await t.test('T-DB.4(e) propagación con rodeo muerto = SKIP (LIM-2 tolerar-y-saltear)', async () => {
    // Animal compartido entre estA (rodeo vivo) y estB (rodeo que vamos a desactivar).
    const an = await createAnimal(clientA, { tag: `${RUN_TAG}_ORPHAN`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    assert.equal(an.error, undefined, an.error && an.error.message);
    // Rodeo dedicado en estB (lo desactivaremos) + perfil NO-activo (transferido) del MISMO animal ahí.
    const rodeoBdead = await createRodeo(clientB, { establishmentId: estB, name: `${RUN_TAG}_RodeoDead` });
    const profileOrphan = await createSecondaryProfile(clientB, { animalId: an.animalId, establishmentId: estB, rodeoId: rodeoBdead.id, systemId: rodeoBdead.systemId, idv: `${RUN_TAG}_ORPHB` });
    // Desactivar el rodeo de estB vía service_role (deja el perfil huérfano: rodeo inactive).
    // (No soft-delete con animales activos: el RPC lo bloquearía; basta active=false para que rodeo_check no lo encuentre.)
    await admin.from('rodeos').update({ active: false }).eq('id', rodeoBdead.id);
    await eventually(async () => (await admin.from('rodeos').select('active').eq('id', rodeoBdead.id).single()).data.active, (v) => v === false);

    // userA castra desde su perfil (rodeo vivo). NO debe abortar: el huérfano se saltea.
    {
      const { error } = await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(error, null, 'el UPDATE del perfil propio NO debe abortar pese al perfil huérfano (LIM-2)');
    }
    // Perfil propio: aplicado. animals: actualizado (write-through). Huérfano: STALE (salteado por el pre-filtro).
    const ownGot = await eventually(() => profileFieldsAdmin(an.profile.id, 'is_castrated').then((r) => r.is_castrated), (v) => v === true);
    assert.equal(ownGot, true, 'perfil propio is_castrated=true (aplicado)');
    assert.equal(await animalIsCastratedAdmin(an.animalId), true, 'animals.is_castrated=true (write-through del perfil propio)');
    await sleep(800);
    assert.equal((await profileFieldsAdmin(profileOrphan, 'is_castrated')).is_castrated, false, 'perfil huérfano queda STALE (salteado por el pre-filtro rodeo-vivo)');

    // Sub-aserción de convergencia: reactivar el rodeo huérfano + nuevo flip del animal => el perfil antes salteado se actualiza.
    await admin.from('rodeos').update({ active: true }).eq('id', rodeoBdead.id);
    await eventually(async () => (await admin.from('rodeos').select('active').eq('id', rodeoBdead.id).single()).data.active, (v) => v === true);
    // Nuevo flip del animal: revert false->true desde el perfil propio (animals true->false->true para forzar IS DISTINCT).
    await clientA.from('animal_profiles').update({ is_castrated: false }).eq('id', an.profile.id);
    await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === false);
    await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
    const convGot = await eventually(() => profileFieldsAdmin(profileOrphan, 'is_castrated').then((r) => r.is_castrated), (v) => v === true);
    assert.equal(convGot, true, 'convergencia: con el rodeo reactivado, el perfil antes salteado se actualiza en el próximo flip');
  });

  await t.test('T-DB.4(f) orden de triggers BEFORE contra pg_trigger (Gate 1 v2 L1)', async () => {
    // Consultamos pg_trigger (no convención de nombres): los BEFORE de animal_profiles, en orden de disparo
    // (= orden alfabético del nombre, para mismo timing/event). Verificamos el subconjunto relevante en orden.
    const rows = await adminQuery(`
      select tgname
      from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='animal_profiles' and not t.tgisinternal and (tgtype & 2) <> 0
      order by tgname;
    `);
    const names = rows.map((r) => r.tgname);
    const idx = (nm) => names.indexOf(nm);
    // IDU.2.1: el trigger de completitud animal_profiles_identity_check se ELIMINÓ (0122) → ya no debe existir
    // entre los BEFORE (un perfil puede persistir con 0 identificadores de usuario). El resto de los BEFORE y su
    // orden relativo (design §4.1) siguen intactos.
    assert.equal(idx('animal_profiles_identity_check'), -1, 'animal_profiles_identity_check YA NO existe (eliminado en 0122, IDU.2.1)');
    for (const nm of ['animal_profiles_force_animal_identity', 'animal_profiles_force_is_castrated', 'animal_profiles_normalize_future_bull']) {
      assert.ok(idx(nm) >= 0, `${nm} debe existir entre los BEFORE de animal_profiles`);
    }
    // Orden requerido por el design §4.1 (sin identity_check): force_animal_identity < force_is_castrated < normalize_future_bull.
    assert.ok(idx('animal_profiles_force_animal_identity') < idx('animal_profiles_force_is_castrated'), 'force_animal_identity antes que force_is_castrated');
    assert.ok(idx('animal_profiles_force_is_castrated') < idx('animal_profiles_normalize_future_bull'), 'force_is_castrated antes que normalize_future_bull');
    // Carga clave: normalize_future_bull corre DESPUÉS de force_animal_identity (lee animal_sex ya forzado).
    assert.ok(idx('animal_profiles_force_animal_identity') < idx('animal_profiles_normalize_future_bull'), 'normalize_future_bull corre después de force_animal_identity (lee el sexo forzado)');
  });

  // Pre-filtro de la propagación = predicado EXACTO de rodeo_check (0021). Lo comparamos contra el source.
  await t.test('T-DB.4 pre-filtro espeja rodeo_check (0021) sin desviación', async () => {
    const res = await adminQuery(`
      select
        pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='tg_propagate_is_castrated_to_profiles')) as prop_src,
        pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='tg_animal_profiles_rodeo_check')) as check_src;
    `);
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');
    const prop = norm(res[0].prop_src);
    const check = norm(res[0].check_src);
    // Las 4 condiciones del predicado de rodeo_check, espejadas en el pre-filtro (ap. en vez de new.).
    for (const cond of ['r.active = true', 'r.deleted_at is null']) {
      assert.ok(check.includes(cond), `rodeo_check contiene "${cond}"`);
      assert.ok(prop.includes(cond), `el pre-filtro de la propagación contiene "${cond}"`);
    }
    assert.ok(prop.includes('r.id = ap.rodeo_id'), 'pre-filtro: r.id = ap.rodeo_id');
    assert.ok(prop.includes('r.establishment_id = ap.establishment_id'), 'pre-filtro: r.establishment_id = ap.establishment_id');
    assert.ok(check.includes('r.id = new.rodeo_id'), 'rodeo_check: r.id = new.rodeo_id');
    assert.ok(check.includes('r.establishment_id = new.establishment_id'), 'rodeo_check: r.establishment_id = new.establishment_id');
    // RAISE LOG sin fuga: solo count + new.id (sin establishment ajeno ni profile ids).
    assert.ok(prop.includes('raise log'), 'la propagación emite RAISE LOG del skip');
    assert.ok(!/raise log[^;]*establishment_id/.test(prop), 'el RAISE LOG no incluye establishment_id (sin fuga cross-tenant)');
  });

  // ============================================================
  // T-DB.5 — recompute simétrico. Cubre R13.5, R5.6, R5.7
  // ============================================================
  await t.test('T-DB.5 recompute simétrico (castrar y revertir, ambas direcciones)', async () => {
    // torito (>1<2 año) -> castrar -> novillito; revert -> torito.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SYM1`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
      await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'novillito'), 'novillito', 'torito -> castrar -> novillito');
      await clientA.from('animal_profiles').update({ is_castrated: false }).eq('id', an.profile.id);
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'torito'), 'torito', 'revert -> torito (recompute simétrico, R13.5)');
    }
    // toro (>=730d) -> castrar -> novillo; revert -> toro.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SYM2`, sex: 'male', birthDate: daysAgo(800), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'toro' });
      await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'novillo'), 'novillo', 'toro -> castrar -> novillo');
      await clientA.from('animal_profiles').update({ is_castrated: false }).eq('id', an.profile.id);
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'toro'), 'toro', 'revert -> toro (recompute simétrico)');
    }
  });

  await t.test('T-DB.5 ternero no transiciona en ninguna dirección', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SYMTN`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
    await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === true);
    await sleep(600);
    assert.equal(await profileCodeAdmin(an.profile.id), 'ternero', 'ternero castrado sigue ternero (compute hasta destete/1 año)');
    await clientA.from('animal_profiles').update({ is_castrated: false }).eq('id', an.profile.id);
    await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === false);
    await sleep(600);
    assert.equal(await profileCodeAdmin(an.profile.id), 'ternero', 'revert: sigue ternero');
  });

  await t.test('T-DB.5 con category_override=true no transiciona ni registra history', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SYMOV`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    await clientA.from('animal_profiles').update({ category_override: true }).eq('id', an.profile.id);
    await eventually(() => profileFieldsAdmin(an.profile.id, 'category_override').then((r) => r.category_override), (v) => v === true);
    const histBefore = ((await admin.from('animal_category_history').select('id').eq('animal_profile_id', an.profile.id)).data || []).length;
    await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
    await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === true);
    await sleep(600);
    assert.equal(await profileCodeAdmin(an.profile.id), 'torito', 'override=true bloquea la transición de castración (R5.6)');
    const histAfter = ((await admin.from('animal_category_history').select('id').eq('animal_profile_id', an.profile.id)).data || []).length;
    assert.equal(histAfter, histBefore, 'override: sin fila de history nueva');
  });

  await t.test('T-DB.5 cada transición queda como auto_transition en history', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_SYMHIST`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
    await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'novillito');
    const { data } = await admin.from('animal_category_history').select('reason').eq('animal_profile_id', an.profile.id).order('changed_at', { ascending: false }).limit(1);
    assert.equal(data[0].reason, 'auto_transition', 'la transición de castración queda como auto_transition');
  });

  // ============================================================
  // T-DB.6 — future_bull. Cubre R12.1, R12.4
  // ============================================================
  await t.test('T-DB.6(a) future_bull=true sobre macho persiste', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_FB1`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    const { error } = await clientA.from('animal_profiles').update({ future_bull: true }).eq('id', an.profile.id);
    assert.equal(error, null, error && error.message);
    assert.equal((await profileFieldsAdmin(an.profile.id, 'future_bull')).future_bull, true, 'future_bull=true persiste en macho');
  });

  await t.test('T-DB.6(b) future_bull sobre hembra se normaliza a false (silencioso)', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_FB2`, sex: 'female', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
    const { error } = await clientA.from('animal_profiles').update({ future_bull: true }).eq('id', an.profile.id);
    assert.equal(error, null, 'no debe raisear (normalización silenciosa, D8)');
    assert.equal((await profileFieldsAdmin(an.profile.id, 'future_bull')).future_bull, false, 'future_bull se normaliza a false en hembra');
  });

  await t.test('T-DB.6(c) al castrar, future_bull queda false en todos los perfiles del animal', async () => {
    // Animal compartido estA (activo) + estB (transferido), future_bull=true en ambos → castrar limpia ambos
    // (propagación de is_castrated + normalize OF is_castrated en cada perfil tocado).
    const an = await createAnimal(clientA, { tag: `${RUN_TAG}_FB3`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    const profileB = await createSecondaryProfile(clientB, { animalId: an.animalId, establishmentId: estB, rodeoId: rodeoB.id, systemId: rodeoB.systemId, idv: `${RUN_TAG}_FB3B`, categoryCode: 'ternero' });
    await clientA.from('animal_profiles').update({ future_bull: true }).eq('id', an.profile.id);
    await clientB.from('animal_profiles').update({ future_bull: true }).eq('id', profileB);
    assert.equal((await profileFieldsAdmin(an.profile.id, 'future_bull')).future_bull, true, 'pre: future_bull=true en estA (activo)');
    assert.equal((await profileFieldsAdmin(profileB, 'future_bull')).future_bull, true, 'pre: future_bull=true en estB (transferido)');
    // Castrar desde estA: write-through -> propagación is_castrated a ambos perfiles -> normalize OF is_castrated -> future_bull=false.
    await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
    const fbA = await eventually(() => profileFieldsAdmin(an.profile.id, 'future_bull').then((r) => r.future_bull), (v) => v === false);
    const fbB = await eventually(() => profileFieldsAdmin(profileB, 'future_bull').then((r) => r.future_bull), (v) => v === false);
    assert.equal(fbA, false, 'castrar limpia future_bull en el perfil propio (estA)');
    assert.equal(fbB, false, 'castrar limpia future_bull en el perfil compartido (estB) via propagación+normalize (R12.4 defensa en profundidad)');
  });

  await t.test('T-DB.6(d) future_bull default false en alta', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_FB4`, sex: 'male', birthDate: daysAgo(180), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
    assert.equal((await profileFieldsAdmin(an.profile.id, 'future_bull')).future_bull, false, 'future_bull default false en el alta');
  });

  // ============================================================
  // T-DB.7 — RLS / tenant. Cubre R9.1, R9.2
  // ============================================================
  await t.test('T-DB.7 RLS: usuario sin rol no muta; con rol sí (paridad con la individual)', async () => {
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_RLS`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
    // userC sin rol en estA.
    const userC = await createTestUser('userC');
    const clientC = await getUserClient(userC.email);
    // (a) userC no puede UPDATEar is_castrated/future_bull del perfil (RLS: 0 filas).
    {
      const { data: upd } = await clientC.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id).select();
      assert.ok(!upd || upd.length === 0, 'userC sin rol no puede UPDATEar is_castrated (RLS)');
      const { data: upd2 } = await clientC.from('animal_profiles').update({ future_bull: true }).eq('id', an.profile.id).select();
      assert.ok(!upd2 || upd2.length === 0, 'userC sin rol no puede UPDATEar future_bull (RLS)');
      assert.equal((await profileFieldsAdmin(an.profile.id, 'is_castrated')).is_castrated, false, 'is_castrated no cambió');
    }
    // (b) userC no puede insertar vacunación/destete sobre animales de estA.
    {
      const { error: e1 } = await clientC.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(1) });
      assert.notEqual(e1, null, 'userC sin rol no inserta vacunación sobre estA');
      const { error: e2 } = await clientC.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
      assert.notEqual(e2, null, 'userC sin rol no inserta destete sobre estA');
    }
    // (c) userB con rol field_operator en estA SÍ puede (paridad con la mutación individual).
    {
      await assignRoleAsService(userB.id, estA, 'field_operator');
      const { error } = await clientB.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      assert.equal(error, null, 'field_operator activo de estA puede castrar (R9.1)');
      assert.equal(await eventually(() => profileFieldsAdmin(an.profile.id, 'is_castrated').then((r) => r.is_castrated), (v) => v === true), true, 'is_castrated=true por field_operator');
    }
  });

  // ============================================================
  // T-DB.8 — destete as-built (regresión de sustrato). Cubre R5.5
  // ============================================================
  await t.test('T-DB.8 destete (sustrato as-built 0062/0063/0046)', async () => {
    // ternera + weaning -> vaquillona.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_W1`, sex: 'female', birthDate: daysAgo(200), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'vaquillona'), 'vaquillona', 'ternera + weaning -> vaquillona');
    }
    // ternero castrado + weaning -> novillito.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_W2`, sex: 'male', birthDate: daysAgo(200), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternero' });
      await clientA.from('animal_profiles').update({ is_castrated: true }).eq('id', an.profile.id);
      await eventually(() => animalIsCastratedAdmin(an.animalId), (v) => v === true);
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'novillito'), 'novillito', 'ternero castrado + weaning -> novillito');
    }
    // con override -> no transiciona.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_W3`, sex: 'female', birthDate: daysAgo(200), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
      await clientA.from('animal_profiles').update({ category_override: true }).eq('id', an.profile.id);
      await eventually(() => profileFieldsAdmin(an.profile.id, 'category_override').then((r) => r.category_override), (v) => v === true);
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
      await sleep(600);
      assert.equal(await profileCodeAdmin(an.profile.id), 'ternera', 'override -> destete no transiciona');
    }
    // soft-delete del weaning -> recalcula (0046/0063).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_W4`, sex: 'female', birthDate: daysAgo(200), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(1) });
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'vaquillona'), 'vaquillona', 'pre: vaquillona');
      const { data: ev } = await clientA.from('reproductive_events').select('id').eq('animal_profile_id', an.profile.id).eq('event_type', 'weaning').order('created_at', { ascending: false }).limit(1).single();
      const { error } = await clientA.rpc('soft_delete_event', { p_kind: 'reproductive', p_event_id: ev.id });
      assert.equal(error, null, error && error.message);
      assert.equal(await eventually(() => profileCodeAdmin(an.profile.id), (c) => c === 'ternera'), 'ternera', 'soft-delete del weaning -> recalcula a ternera (0046/0063)');
    }
  });

  // ============================================================
  // T-DB.9 — no-regresión del gating (delta viejo eliminado). Cubre R7.3, R9.4
  // ============================================================
  await t.test('T-DB.9 no-regresión del gating: sin rama castración; vaccination fail-closed; sin data_key castracion', async () => {
    // (a) tg_sanitary_events_gating NO tiene rama de castración: un treatment con product_name='Castración' NO se gatea.
    {
      const src = (await adminQuery(`select pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='tg_sanitary_events_gating')) as src;`))[0].src.toLowerCase();
      assert.ok(!src.includes('castracion') && !src.includes('castración') && !src.includes('castrac'), 'tg_sanitary_events_gating no menciona castración');
      assert.ok(src.includes("'vaccination'") || src.includes('vaccination'), 'sigue gateando vaccination');
    }
    // (b) un treatment con product_name='Castración' inserta sin gatear (no es vaccination → no se gatea por ningún data_key).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_TREAT`, sex: 'male', birthDate: daysAgo(400), rodeoId: rodeoA.id, establishmentId: estA, systemId: rodeoA.systemId, categoryCode: 'torito' });
      const { error } = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'treatment', product_name: 'Castración', event_date: daysAgo(1) });
      assert.equal(error, null, "treatment 'Castración' inserta sin gatear (no hay rama castración)");
    }
    // (c) vaccination sigue fail-closed contra rodeo sin 'vacunacion'.
    {
      const rDis = await createRodeo(clientA, { establishmentId: estA, name: `${RUN_TAG}_RodeoNoVac` });
      // desactivar vacunacion.
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'vacunacion').single();
      await clientA.from('rodeo_data_config').update({ enabled: false }).eq('rodeo_id', rDis.id).eq('field_definition_id', fd.id);
      await eventually(async () => (await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rDis.id).eq('field_definition_id', fd.id).maybeSingle()).data, (row) => row && row.enabled === false);
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_NOVAC`, sex: 'male', birthDate: daysAgo(400), rodeoId: rDis.id, establishmentId: estA, systemId: rDis.systemId, categoryCode: 'torito' });
      const { error } = await clientA.from('sanitary_events').insert({ animal_profile_id: an.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(1) });
      assert.notEqual(error, null, 'vaccination en rodeo sin vacunacion debe ser rechazada (fail-closed, R7.3)');
      assert.match(String(error.message + ' ' + (error.code || '')), /23514|gated|missing enabled/i);
    }
    // (d) NO existe data_key 'castracion' en field_definitions.
    {
      const { data } = await clientA.from('field_definitions').select('data_key').eq('data_key', 'castracion');
      assert.deepEqual(data, [], "no existe el data_key 'castracion' (delta viejo eliminado, R9.4)");
    }
  });

  // ============================================================
  // T-DB.10 — superficie / revokes de las 4 funciones nuevas. Cubre R9.4
  // ============================================================
  await t.test('T-DB.10 superficie: revoke efectivo + SECURITY DEFINER + search_path; no RPC nueva; sin policy nueva', async () => {
    const fns = ['tg_normalize_future_bull', 'tg_force_is_castrated_on_profile_insert', 'tg_profile_is_castrated_writethrough', 'tg_propagate_is_castrated_to_profiles'];
    // (a) revoke efectivo + secdef + search_path, leído del catálogo.
    {
      const rows = await adminQuery(`
        select p.proname as fn,
               p.prosecdef as secdef,
               (select array_to_string(p.proconfig, ',')) as config,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
               has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname = any(array['tg_normalize_future_bull','tg_force_is_castrated_on_profile_insert','tg_profile_is_castrated_writethrough','tg_propagate_is_castrated_to_profiles']);
      `);
      assert.equal(rows.length, 4, 'las 4 funciones nuevas existen');
      for (const r of rows) {
        assert.equal(r.secdef, true, `${r.fn} es SECURITY DEFINER`);
        assert.ok(String(r.config || '').includes('search_path=public'), `${r.fn} tiene search_path=public`);
        assert.equal(r.auth_exec, false, `${r.fn} NO ejecutable por authenticated (revoke efectivo)`);
        assert.equal(r.anon_exec, false, `${r.fn} NO ejecutable por anon`);
        assert.equal(r.public_exec, false, `${r.fn} NO ejecutable por public`);
      }
    }
    // (b) no son invocables como RPC por un authenticated (PostgREST): permission/no-encontrada.
    {
      for (const fn of fns) {
        const { error } = await clientA.rpc(fn);
        assert.notEqual(error, null, `${fn} NO debe ser invocable como RPC (revoke + no expuesta)`);
        assert.match(String(error.message + ' ' + (error.code || '')), /permission denied|not find|does not exist|PGRST202|42501|404/i, `${fn}: error de no-acceso`);
      }
    }
    // (c) tg_animals_apply_castration sigue revocada (re-emit idempotente de 0086).
    {
      const rows = await adminQuery(`
        select has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='tg_animals_apply_castration'), 'EXECUTE') as auth_exec;
      `);
      assert.equal(rows[0].auth_exec, false, 'tg_animals_apply_castration revocada (idempotente)');
    }
  });

  // limpieza al final
  await t.test('teardown', async () => { await cleanup(); });
});
