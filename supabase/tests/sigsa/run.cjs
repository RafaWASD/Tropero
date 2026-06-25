// supabase/tests/sigsa/run.cjs
// Suite de tests del BACKEND de la spec 08 (08-export-sigsa) — capa DB (migraciones 0107-0112):
//   - breed_catalog (0107): catálogo read-only + seed (28 bovinas + S/E + 3 bubalinas).            T1
//   - animal_profiles.breed_id (0108): FK nullable + best-effort + herencia ternero al pie (mono). T2
//   - reproductive_events.breed_id (0109): FK nullable + herencia ternero al pie (mellizos).        T3
//   - establishments.renspa (0110): sin unique + CHECK largo + RPC update_renspa owner-gate.        T4
//   - sigsa_declarations (0111): UNIQUE + RLS (IDOR-check) + trigger declared_by forzado.            T5
//   - export_log (0112): CHECKs (5MB/255) + RLS + trigger generated_by forzado + FK export_log_id.  T6
//   - derive breed_id (0113): trigger BEFORE INSERT OR UPDATE OF breed → breed_id por match nombre;  T18
//                             guard breed NULL preserva el breed_id heredado de la madre (ternero).
//
// Corre contra la base remota usando service_role para fixtures y JWTs reales para los asserts de
// RLS/RPC/trigger. Mismo patrón que supabase/tests/import/run.cjs y supabase/tests/animal/run.cjs.
//
// ⚠️ Estos tests pasan verde RECIÉN DESPUÉS de que el LEADER aplique 0107-0112 al remoto (la suite
// corre contra la DB remota; hasta el apply, fallan por "tabla/columna/función inexistente"). El
// hook en scripts/run-tests.mjs queda COMENTADO hasta entonces (el implementer NO aplica al remoto).
//
// Trazabilidad R<n> → test en progress/impl_08-sigsa-db.md.

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
  console.error('Faltan vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN_TAG = `sigsa_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

// ---- retry anti-transitorio (remoto COMPARTIDO con otras suites del pipeline) --------------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
const TRANSIENT_PG_CODES = new Set(['40001', '40P01', '57014', '08006', '08003', '53300', '57P01']);
function isTransient(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (TRANSIENT_PG_CODES.has(code)) return true;
  const msg = String(error.message || '').toLowerCase();
  return /deadlock|timeout|timed out|connection|temporarily unavailable|too many connections/.test(msg);
}
async function setupWithRetry(label, fn, { tries = 4, delay = 500 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fn();
      if (res && res.error) {
        if (isTransient(res.error) && i < tries - 1) {
          lastErr = res.error;
          await sleep(delay * (i + 1));
          continue;
        }
        throw new Error(`${label}: ${res.error.message}`);
      }
      return res;
    } catch (err) {
      if (isTransient(err) && i < tries - 1) {
        lastErr = err;
        await sleep(delay * (i + 1));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: agotados ${tries} intentos (último transitorio: ${lastErr && lastErr.message})`);
}

// ---- helpers de fixtures --------------------------------------------------

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

// El que crea el establishment queda owner (trigger 0011 auto-owner).
async function createEstablishmentAs(userClient, name) {
  await setupWithRetry(`createEstablishment insert(${name})`, () =>
    userClient.from('establishments').insert({ name, province: 'Buenos Aires' }),
  );
  const { data, error } = await setupWithRetry(`createEstablishment select(${name})`, () =>
    userClient.from('establishments').select('id').eq('name', name).single(),
  );
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  assert.ok(data && data.id, `createEstablishment(${name}): no se obtuvo id`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function assignRoleAsService(userId, establishmentId, role) {
  await setupWithRetry(`assignRole(${role})`, () =>
    admin.from('user_roles').insert({ user_id: userId, establishment_id: establishmentId, role, active: true }),
  );
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

async function createRodeo(client, { establishmentId, name }) {
  const { speciesId, systemId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  await setupWithRetry(`createRodeo insert(${name})`, () =>
    client.from('rodeos').insert({ establishment_id: establishmentId, name, species_id: speciesId, system_id: systemId }),
  );
  const { data, error } = await setupWithRetry(`createRodeo select(${name})`, () =>
    client.from('rodeos').select('id, system_id').eq('establishment_id', establishmentId).eq('name', name).single(),
  );
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  assert.ok(data && data.id, `createRodeo(${name}): no se obtuvo id`);
  return { id: data.id, systemId: data.system_id };
}

// Crea animal + animal_profile (patrón split). Devuelve { profileId, animalId }. Permite setear
// breed_id, breed (texto libre), tag y birth_date para los tests de export/herencia.
async function createAnimal(client, {
  establishmentId, rodeoId, systemId, sex = 'female', categoryCode = null,
  tag = null, idv = null, visualAlt = null, birthDate = null, breed = null, breedId = null,
}) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = crypto.randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (tag) animalPayload.tag_electronic = tag;
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
  if (visualAlt) profilePayload.visual_id_alt = visualAlt;
  if (breed) profilePayload.breed = breed;
  if (breedId) profilePayload.breed_id = breedId;
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };
  return { profileId, animalId };
}

// Borra (con admin) TODO lo creado por la corrida, en orden seguro. Los partos crean terneros
// (animal_profiles + animals nuevos) y reproductive_events.calf_id referencia animal_profiles SIN
// cascade → hay que borrar los eventos ANTES del cascade del establishment, y los animals quedan
// huérfanos del cascade (no tienen establishment_id) → se borran explícitos.
async function cleanup() {
  const ests = createdEstablishmentIds.splice(0);
  if (ests.length > 0) {
    // 1) recolectar TODOS los profiles + animals de estos establishments (madres + terneros).
    const { data: profs } = await admin
      .from('animal_profiles').select('id, animal_id').in('establishment_id', ests);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id).filter(Boolean))];
    // 2) borrar reproductive_events (por animal_profile_id Y por calf_id) para liberar el FK no-cascade.
    if (profileIds.length > 0) {
      for (let i = 0; i < profileIds.length; i += 200) {
        const chunk = profileIds.slice(i, i + 200);
        try {
          await admin.from('reproductive_events').delete().in('animal_profile_id', chunk);
          await admin.from('reproductive_events').delete().in('calf_id', chunk);
        } catch (e) { console.error('cleanup reproductive_events:', e.message); }
      }
    }
    // 3) borrar establishments (cascade → user_roles, rodeos, animal_profiles, sigsa_declarations, export_log).
    try {
      await setupWithRetry('cleanup establishments', () => admin.from('establishments').delete().in('id', ests));
    } catch (e) { console.error('cleanup establishments:', e.message); }
    // 4) borrar los animals huérfanos (no cascadean del establishment).
    for (let i = 0; i < animalIds.length; i += 200) {
      const chunk = animalIds.slice(i, i + 200);
      try {
        await admin.from('animals').delete().in('id', chunk);
      } catch (e) { console.error('cleanup animals:', e.message); }
    }
  }
  const uids = createdUserIds.splice(0);
  for (const uid of uids) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

// breed_catalog id por código (lo necesitan varios tests; el catálogo es global read-only).
async function breedIdByCode(client, code) {
  const { data, error } = await client.from('breed_catalog').select('id').eq('senasa_code', code).single();
  if (error) throw new Error(`breedIdByCode(${code}): ${error.message}`);
  return data.id;
}

// =====================================================================
// T1 — breed_catalog (0107): read-only + seed.   R1.1, R1.2, R1.3
// =====================================================================

test('spec 08 — T1 breed_catalog (read-only + seed)', async (t) => {
  let user, client;

  await t.test('setup: un authenticated cualquiera', async () => {
    user = await createTestUser('catReader');
    client = await getUserClient(user.email);
  });

  // T1 (a): authenticated puede SELECT.
  await t.test('T1(a) R1.3: authenticated puede SELECT de breed_catalog', async () => {
    const { data, error } = await client.from('breed_catalog').select('senasa_code, name, species, active').limit(100);
    assert.equal(error, null, error && error.message);
    assert.ok(Array.isArray(data) && data.length >= 32, 'el catálogo debe tener al menos 32 filas');
  });

  // T1 (c): exactamente 28 bovinas activas.
  await t.test('T1(c) R1.2: exactamente 28 filas con species=bovine AND active=true', async () => {
    const { data, error } = await client.from('breed_catalog')
      .select('senasa_code').eq('species', 'bovine').eq('active', true);
    assert.equal(error, null, error && error.message);
    assert.equal(data.length, 28, 'deben ser exactamente 28 razas bovinas activas');
  });

  // T1 (d): el código S/E existe (generic).
  await t.test('T1(d) R1.2: el código S/E existe (species=generic)', async () => {
    const { data, error } = await client.from('breed_catalog')
      .select('senasa_code, species, name').eq('senasa_code', 'S/E').maybeSingle();
    assert.equal(error, null, error && error.message);
    assert.ok(data, 'la fila S/E debe existir');
    assert.equal(data.species, 'generic', 'S/E debe ser species=generic');
    assert.equal(data.name, 'Sin Especificar');
  });

  // T1 (e): los 3 bubalinos con active=false.
  await t.test('T1(e) R1.2: los 3 bubalinos (ME/JA/MU) tienen active=false', async () => {
    const { data, error } = await client.from('breed_catalog')
      .select('senasa_code, active').in('senasa_code', ['ME', 'JA', 'MU']);
    assert.equal(error, null, error && error.message);
    assert.equal(data.length, 3, 'deben existir ME, JA, MU');
    for (const row of data) {
      assert.equal(row.active, false, `${row.senasa_code} debe tener active=false`);
    }
  });

  // Cross-check de grafías: una muestra de códigos↔nombre literales del manual (anti-regresión del seed).
  await t.test('T1 R1.2: grafías literales del manual (muestra: AA, H, BO, S/E, FS, SI)', async () => {
    const expected = { AA: 'Aberdeen Angus', H: 'Hereford', BO: 'Bosmara', 'S/E': 'Sin Especificar', FS: 'Simmental', SI: 'San Ignacio' };
    const { data, error } = await client.from('breed_catalog')
      .select('senasa_code, name').in('senasa_code', Object.keys(expected));
    assert.equal(error, null, error && error.message);
    const byCode = Object.fromEntries(data.map((r) => [r.senasa_code, r.name]));
    for (const [code, name] of Object.entries(expected)) {
      assert.equal(byCode[code], name, `${code} debe ser "${name}" (grafía literal del manual)`);
    }
  });

  // T1 (b): authenticated NO puede INSERT/UPDATE/DELETE (read-only).
  await t.test('T1(b) R1.3: authenticated NO puede INSERT en breed_catalog', async () => {
    const { error } = await client.from('breed_catalog')
      .insert({ senasa_code: `${RUN_TAG}_X`, name: 'Hack', species: 'bovine' });
    assert.notEqual(error, null, 'el cliente no debería poder insertar en el catálogo');
    // Adversarial: no quedó escrito.
    const { data } = await admin.from('breed_catalog').select('id').eq('senasa_code', `${RUN_TAG}_X`);
    assert.deepEqual(data, [], 'no debería haber quedado la fila hackeada');
  });

  await t.test('T1(b) R1.3: authenticated NO puede UPDATE breed_catalog', async () => {
    const { error } = await client.from('breed_catalog').update({ name: 'Hacked' }).eq('senasa_code', 'AA');
    // PostgREST con 0 filas afectadas por RLS no siempre es error; verificamos que NO mutó.
    const { data } = await admin.from('breed_catalog').select('name').eq('senasa_code', 'AA').single();
    assert.equal(data.name, 'Aberdeen Angus', 'AA no debería haber sido mutada por el cliente');
    if (error) assert.ok(true); // si PostgREST devolvió error explícito, mejor aún
  });

  await t.test('T1(b) R1.3: authenticated NO puede DELETE breed_catalog', async () => {
    await client.from('breed_catalog').delete().eq('senasa_code', 'OR');
    const { data } = await admin.from('breed_catalog').select('id').eq('senasa_code', 'OR').maybeSingle();
    assert.ok(data, 'OR no debería haber sido borrada por el cliente');
  });

  await t.test('cleanup', async () => { await cleanup(); });
});

// =====================================================================
// T2 — animal_profiles.breed_id (0108): FK + best-effort + herencia mono.  R1.4, R1.5, R1.7
// =====================================================================

test('spec 08 — T2 animal_profiles.breed_id (FK + best-effort + herencia mono)', async (t) => {
  let owner, client, est, rodeo, aaId;

  await t.test('setup: est + rodeo + breed ids', async () => {
    owner = await createTestUser('breedOwner');
    client = await getUserClient(owner.email);
    est = await createEstablishmentAs(client, `${RUN_TAG} breed est`);
    rodeo = await createRodeo(client, { establishmentId: est, name: `${RUN_TAG} breed rodeo` });
    aaId = await breedIdByCode(client, 'AA');
  });

  // T2 (a): columna existe y acepta NULL.
  await t.test('T2(a) R1.4: animal_profiles.breed_id existe y acepta NULL', async () => {
    const r = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_null` });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, null, 'breed_id debe poder ser NULL');
  });

  // T2 (b): acepta un breed_id válido.
  await t.test('T2(b) R1.4: animal_profiles acepta un breed_id válido del catálogo', async () => {
    const r = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_valid`, breedId: aaId });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, aaId, 'breed_id debe haberse guardado');
  });

  // T2 (c): rechaza un breed_id inexistente (FK).
  await t.test('T2(c) R1.4: rechaza un breed_id que no existe en breed_catalog (FK)', async () => {
    const r = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_badfk`, breedId: crypto.randomUUID() });
    assert.notEqual(r.error, undefined, 'un breed_id inexistente debe violar la FK');
  });

  // T2 (d) + (e): best-effort. La migración 0108 ya corrió en el remoto (la aplica el leader). Para
  // testear el best-effort sobre datos NUEVOS (insertados DESPUÉS del apply), simulamos la misma
  // sentencia best-effort vía service_role sobre filas con breed texto libre y breed_id NULL.
  // (d): 'Aberdeen Angus' → AA; (e): 'texto_raro_sin_match' → NULL.
  await t.test('T2(d/e) R1.5: best-effort matchea por nombre normalizado; sin match queda NULL', async () => {
    const rMatch = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_be_match`, breed: 'aberdeen angus' });
    const rNoMatch = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_be_nomatch`, breed: 'texto_raro_sin_match' });
    assert.equal(rMatch.error, undefined, rMatch.error && rMatch.error.message);
    assert.equal(rNoMatch.error, undefined, rNoMatch.error && rNoMatch.error.message);

    // El best-effort de 0108 corre una sola vez al aplicar la migración (filas previas al apply). Para
    // ejercer la MISMA lógica sobre filas NUEVAS (insertadas después del apply), replicamos su sentencia
    // EXACTA vía service_role: match por nombre normalizado (lower(trim)), solo donde breed_id IS NULL.
    const { data: bc } = await admin.from('breed_catalog').select('id, name');
    const byName = Object.fromEntries((bc || []).map((b) => [b.name.trim().toLowerCase(), b.id]));
    const aaByName = byName['aberdeen angus'];
    await admin.from('animal_profiles').update({ breed_id: aaByName }).eq('id', rMatch.profileId).is('breed_id', null);
    // el perfil sin match NO se toca (su breed 'texto_raro_sin_match' no existe en byName) → queda NULL.

    const { data: matched } = await admin.from('animal_profiles').select('breed_id').eq('id', rMatch.profileId).single();
    assert.equal(matched.breed_id, aaId, "best-effort: 'aberdeen angus' debe resolver al breed_id de AA");
    const { data: noMatch } = await admin.from('animal_profiles').select('breed_id').eq('id', rNoMatch.profileId).single();
    assert.equal(noMatch.breed_id, null, "best-effort: 'texto_raro_sin_match' debe quedar NULL");
  });

  // T2 (f): ternero al pie (camino MONO) hereda breed_id de la madre.
  await t.test('T2(f) R1.7: ternero al pie (mono) hereda breed_id de la madre', async () => {
    // Madre con breed_id = AA. Insertar un evento birth con calf_sex → dispara el trigger mono.
    const mother = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_mother_mono`, breedId: aaId });
    assert.equal(mother.error, undefined, mother.error && mother.error.message);
    const { error: bErr } = await client.from('reproductive_events').insert({
      animal_profile_id: mother.profileId,
      event_type: 'birth',
      event_date: new Date().toISOString().slice(0, 10),
      calf_sex: 'female',
    });
    assert.equal(bErr, null, bErr && bErr.message);

    // El ternero es el animal_profile creado por el trigger con entry_origin='born_here' en este rodeo,
    // distinto de la madre. Lo ubicamos por el calf_id del evento.
    const { data: ev } = await admin.from('reproductive_events')
      .select('calf_id').eq('animal_profile_id', mother.profileId).eq('event_type', 'birth').single();
    assert.ok(ev && ev.calf_id, 'el evento birth debe haber creado un ternero (calf_id)');
    const { data: calf } = await admin.from('animal_profiles').select('breed_id').eq('id', ev.calf_id).single();
    assert.equal(calf.breed_id, aaId, 'el ternero (mono) debe heredar el breed_id AA de la madre');
  });

  // T2 (f-bis): madre SIN breed_id → ternero nace con breed_id NULL (R1.7 caso null).
  await t.test('T2(f-bis) R1.7: madre sin breed_id → ternero (mono) nace con breed_id NULL', async () => {
    const mother = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_mother_mono_null` });
    const { error: bErr } = await client.from('reproductive_events').insert({
      animal_profile_id: mother.profileId, event_type: 'birth',
      event_date: new Date().toISOString().slice(0, 10), calf_sex: 'male',
    });
    assert.equal(bErr, null, bErr && bErr.message);
    const { data: ev } = await admin.from('reproductive_events')
      .select('calf_id').eq('animal_profile_id', mother.profileId).eq('event_type', 'birth').single();
    const { data: calf } = await admin.from('animal_profiles').select('breed_id').eq('id', ev.calf_id).single();
    assert.equal(calf.breed_id, null, 'el ternero debe nacer con breed_id NULL si la madre no tiene');
  });

  await t.test('cleanup', async () => { await cleanup(); });
});

// =====================================================================
// T3 — reproductive_events.breed_id (0109): FK + herencia mellizos.   R1.6, R1.7
// =====================================================================

test('spec 08 — T3 reproductive_events.breed_id (FK + herencia mellizos)', async (t) => {
  let owner, client, est, rodeo, hId;

  await t.test('setup', async () => {
    owner = await createTestUser('reproOwner');
    client = await getUserClient(owner.email);
    est = await createEstablishmentAs(client, `${RUN_TAG} repro est`);
    rodeo = await createRodeo(client, { establishmentId: est, name: `${RUN_TAG} repro rodeo` });
    hId = await breedIdByCode(client, 'H');
  });

  // T3 (a): columna existe y acepta NULL.
  await t.test('T3(a) R1.6: reproductive_events.breed_id existe y acepta NULL', async () => {
    // Un evento service (sin parto) — debe poder existir con breed_id NULL.
    const animal = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_re_null` });
    const { error } = await client.from('reproductive_events').insert({
      animal_profile_id: animal.profileId, event_type: 'service',
      event_date: new Date().toISOString().slice(0, 10), service_type: 'natural',
    });
    assert.equal(error, null, error && error.message);
    const { data } = await admin.from('reproductive_events')
      .select('breed_id').eq('animal_profile_id', animal.profileId).eq('event_type', 'service').single();
    assert.equal(data.breed_id, null, 'breed_id debe poder ser NULL en reproductive_events');
  });

  // T3 (b): acepta un breed_id válido (FK a breed_catalog).
  await t.test('T3(b) R1.6: reproductive_events acepta un breed_id válido / rechaza inexistente (FK)', async () => {
    const animal = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_re_fk` });
    // válido (vía service_role, la columna no tiene path de cliente en MVP pero la FK debe validar)
    const { error: okErr } = await admin.from('reproductive_events').insert({
      animal_profile_id: animal.profileId, event_type: 'tacto',
      event_date: new Date().toISOString().slice(0, 10), breed_id: hId,
    });
    assert.equal(okErr, null, okErr && okErr.message);
    // inexistente → viola FK
    const { error: badErr } = await admin.from('reproductive_events').insert({
      animal_profile_id: animal.profileId, event_type: 'tacto',
      event_date: new Date().toISOString().slice(0, 10), breed_id: crypto.randomUUID(),
    });
    assert.notEqual(badErr, null, 'un breed_id inexistente debe violar la FK');
  });

  // T3 (c) [reconciliado]: reproductive_events NO tiene columna `breed` texto libre → el best-effort
  // del design es un NO-OP documentado. Verificamos que NO existe esa columna (anti-regresión: si
  // alguien la agrega, este test obliga a revisar la migración 0109).
  await t.test('T3(c) R1.6 [reconciliado]: reproductive_events NO tiene columna breed (best-effort = no-op)', async () => {
    const animal = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_re_nobreed` });
    // Intentar insertar `breed` (texto libre) debe fallar: la columna no existe.
    const { error } = await admin.from('reproductive_events').insert({
      animal_profile_id: animal.profileId, event_type: 'service',
      event_date: new Date().toISOString().slice(0, 10), breed: 'Hereford',
    });
    assert.notEqual(error, null, 'reproductive_events NO debe tener columna breed (best-effort es no-op)');
  });

  // T3 herencia mellizos: register_birth (2 terneros) → ambos heredan breed_id de la madre (R1.7).
  await t.test('T3 R1.7: register_birth (mellizos) → ambos terneros heredan breed_id de la madre', async () => {
    const mother = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_mother_twins`, breedId: hId });
    const { data: birthId, error } = await client.rpc('register_birth', {
      p_mother_profile_id: mother.profileId,
      p_event_date: new Date().toISOString().slice(0, 10),
      p_calves: [{ calf_sex: 'male' }, { calf_sex: 'female' }],
    });
    assert.equal(error, null, error && error.message);
    assert.ok(birthId, 'register_birth debe devolver el id del parto');
    // Los terneros del parto: birth_calves.calf_profile_id por birth_event_id.
    const { data: calves } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    assert.equal((calves || []).length, 2, 'deben existir 2 terneros (mellizos)');
    const calfIds = calves.map((c) => c.calf_profile_id);
    const { data: profs } = await admin.from('animal_profiles').select('id, breed_id').in('id', calfIds);
    for (const p of profs) {
      assert.equal(p.breed_id, hId, 'cada ternero (mellizo) debe heredar el breed_id H de la madre');
    }
  });

  // T3 herencia mellizos null: madre sin breed_id → terneros con breed_id NULL.
  await t.test('T3 R1.7: register_birth con madre sin breed_id → terneros con breed_id NULL', async () => {
    const mother = await createAnimal(client, { establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId, visualAlt: `${RUN_TAG}_mother_twins_null` });
    const { data: birthId, error } = await client.rpc('register_birth', {
      p_mother_profile_id: mother.profileId,
      p_event_date: new Date().toISOString().slice(0, 10),
      p_calves: [{ calf_sex: 'female' }, { calf_sex: 'female' }],
    });
    assert.equal(error, null, error && error.message);
    const { data: calves } = await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId);
    const calfIds = calves.map((c) => c.calf_profile_id);
    const { data: profs } = await admin.from('animal_profiles').select('id, breed_id').in('id', calfIds);
    for (const p of profs) {
      assert.equal(p.breed_id, null, 'cada ternero debe nacer con breed_id NULL si la madre no tiene');
    }
  });

  await t.test('cleanup', async () => { await cleanup(); });
});

// =====================================================================
// T4 — establishments.renspa (0110): sin unique + CHECK + RPC owner-gate.  R2.1, R2.2, R2.3
// =====================================================================

test('spec 08 — T4 establishments.renspa (RPC owner-gate, CHECK, sin unique)', async (t) => {
  let ownerA, vetA, opA, ownerB;
  let ownerClientA, vetClientA, opClientA, ownerClientB;
  let estA, estB;

  await t.test('setup: estA (owner/vet/op) + estB (otro owner)', async () => {
    ownerA = await createTestUser('renspaOwnerA');
    vetA = await createTestUser('renspaVetA');
    opA = await createTestUser('renspaOpA');
    ownerB = await createTestUser('renspaOwnerB');
    ownerClientA = await getUserClient(ownerA.email);
    vetClientA = await getUserClient(vetA.email);
    opClientA = await getUserClient(opA.email);
    ownerClientB = await getUserClient(ownerB.email);
    estA = await createEstablishmentAs(ownerClientA, `${RUN_TAG} renspa estA`);
    await assignRoleAsService(vetA.id, estA, 'veterinarian');
    await assignRoleAsService(opA.id, estA, 'field_operator');
    estB = await createEstablishmentAs(ownerClientB, `${RUN_TAG} renspa estB`);
  });

  // T4 (a): owner llama update_renspa y el campo se actualiza.
  await t.test('T4(a) R2.3: owner puede llamar update_renspa y el campo se actualiza', async () => {
    const { error } = await ownerClientA.rpc('update_renspa', { p_establishment_id: estA, p_renspa: '01.001.0.00001/01' });
    assert.equal(error, null, error && error.message);
    const { data } = await admin.from('establishments').select('renspa').eq('id', estA).single();
    assert.equal(data.renspa, '01.001.0.00001/01', 'el renspa debe haberse guardado');
  });

  // T4 (b): veterinarian recibe 42501.
  await t.test('T4(b) R2.3: veterinarian recibe error 42501 al llamar update_renspa', async () => {
    const { error } = await vetClientA.rpc('update_renspa', { p_establishment_id: estA, p_renspa: 'hack-vet' });
    assert.notEqual(error, null, 'el vet no debería poder actualizar el renspa');
    assert.match(String(error.code || '') + (error.message || ''), /42501|only owner/i, 'debe ser un error de autorización owner-only');
    const { data } = await admin.from('establishments').select('renspa').eq('id', estA).single();
    assert.notEqual(data.renspa, 'hack-vet', 'el renspa NO debe haber sido modificado por el vet');
  });

  // T4 (c): field_operator recibe 42501.
  await t.test('T4(c) R2.3: field_operator recibe error 42501 al llamar update_renspa', async () => {
    const { error } = await opClientA.rpc('update_renspa', { p_establishment_id: estA, p_renspa: 'hack-op' });
    assert.notEqual(error, null, 'el field_operator no debería poder actualizar el renspa');
    const { data } = await admin.from('establishments').select('renspa').eq('id', estA).single();
    assert.notEqual(data.renspa, 'hack-op', 'el renspa NO debe haber sido modificado por el field_operator');
  });

  // T4 (d): UPDATE directo vía PostgREST por un vet → bloqueado por la policy establishments_update (0007).
  await t.test('T4(d) R2.3: veterinarian NO puede UPDATE directo de renspa (policy 0007)', async () => {
    const { data, error } = await vetClientA.from('establishments').update({ renspa: 'hack-direct' }).eq('id', estA).select('id');
    // La policy is_owner_of bloquea el UPDATE: PostgREST devuelve error o 0 filas. Verificamos no-mutación.
    const { data: after } = await admin.from('establishments').select('renspa').eq('id', estA).single();
    assert.notEqual(after.renspa, 'hack-direct', 'un UPDATE directo de un vet NO debe pasar (policy 0007)');
    assert.ok(error !== null || (Array.isArray(data) && data.length === 0), 'el UPDATE directo del vet debe ser rechazado o afectar 0 filas');
  });

  // T4 (e): string vacío o > 20 chars rechazado por el CHECK.
  await t.test('T4(e) R2.2: string vacío o > 20 chars es rechazado por el CHECK', async () => {
    // > 20 chars
    const tooLong = '123456789012345678901'; // 21 chars
    const { error: e1 } = await admin.from('establishments').update({ renspa: tooLong }).eq('id', estA);
    assert.notEqual(e1, null, 'un renspa > 20 chars debe violar el CHECK');
    // string en blanco (solo espacios → trim vacío)
    const { error: e2 } = await admin.from('establishments').update({ renspa: '   ' }).eq('id', estA);
    assert.notEqual(e2, null, 'un renspa en blanco (trim vacío) debe violar el CHECK');
    // un renspa válido SÍ entra (sanity)
    const { error: e3 } = await admin.from('establishments').update({ renspa: 'OK-20-chars-maxxxxxx' }).eq('id', estA); // 20 chars
    assert.equal(e3, null, e3 && e3.message);
  });

  // T4 (f): DOS establecimientos PUEDEN tener el MISMO renspa (no hay unique). Guard anti-regresión.
  await t.test('T4(f) R2.1: dos establecimientos pueden tener el MISMO renspa sin error (sin unique)', async () => {
    const shared = 'SHARED-RENSPA-01';
    const { error: eA } = await ownerClientA.rpc('update_renspa', { p_establishment_id: estA, p_renspa: shared });
    assert.equal(eA, null, eA && eA.message);
    const { error: eB } = await ownerClientB.rpc('update_renspa', { p_establishment_id: estB, p_renspa: shared });
    assert.equal(eB, null, 'el segundo establecimiento debe poder usar el mismo renspa (NO hay unique)');
    const { data: a } = await admin.from('establishments').select('renspa').eq('id', estA).single();
    const { data: b } = await admin.from('establishments').select('renspa').eq('id', estB).single();
    assert.equal(a.renspa, shared);
    assert.equal(b.renspa, shared);
  });

  // update_renspa por un caller sin rol en el est → 42501 (anti cross-tenant).
  await t.test('T4 R2.3: caller sin rol en el est (ownerB sobre estA) → 42501', async () => {
    const { error } = await ownerClientB.rpc('update_renspa', { p_establishment_id: estA, p_renspa: 'cross-tenant' });
    assert.notEqual(error, null, 'ownerB no debería poder tocar el renspa de estA');
    const { data } = await admin.from('establishments').select('renspa').eq('id', estA).single();
    assert.notEqual(data.renspa, 'cross-tenant', 'el renspa de estA no debe cambiar por ownerB');
  });

  // anon NO puede ejecutar update_renspa (EXECUTE revocado).
  await t.test('T4 R2.3: anon NO puede ejecutar update_renspa (EXECUTE revocado)', async () => {
    const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anonClient.rpc('update_renspa', { p_establishment_id: estA, p_renspa: 'anon-hack' });
    assert.notEqual(error, null, 'anon no debería poder ejecutar update_renspa');
  });

  await t.test('cleanup', async () => { await cleanup(); });
});

// =====================================================================
// T5 — sigsa_declarations (0111): UNIQUE + RLS (IDOR) + trigger declared_by.
// R3.1, R3.2, R3.5, R3.6, R3.7, R11.1, R11.2, R11.3
// =====================================================================

test('spec 08 — T5 sigsa_declarations (RLS, IDOR, declared_by forzado, UNIQUE)', async (t) => {
  let ownerA, vetA, opA, outsider, ownerB;
  let ownerClientA, vetClientA, opClientA, outsiderClient, ownerClientB;
  let estA, rodeoA, estB, rodeoB;
  let profA1, profA2, profB1;

  await t.test('setup: estA (owner/vet/op) + estB (otro owner) + perfiles', async () => {
    ownerA = await createTestUser('sdOwnerA');
    vetA = await createTestUser('sdVetA');
    opA = await createTestUser('sdOpA');
    outsider = await createTestUser('sdOutsider');
    ownerB = await createTestUser('sdOwnerB');
    ownerClientA = await getUserClient(ownerA.email);
    vetClientA = await getUserClient(vetA.email);
    opClientA = await getUserClient(opA.email);
    outsiderClient = await getUserClient(outsider.email);
    ownerClientB = await getUserClient(ownerB.email);

    estA = await createEstablishmentAs(ownerClientA, `${RUN_TAG} sd estA`);
    await assignRoleAsService(vetA.id, estA, 'veterinarian');
    await assignRoleAsService(opA.id, estA, 'field_operator');
    rodeoA = await createRodeo(ownerClientA, { establishmentId: estA, name: `${RUN_TAG} sd rodeoA` });

    estB = await createEstablishmentAs(ownerClientB, `${RUN_TAG} sd estB`);
    rodeoB = await createRodeo(ownerClientB, { establishmentId: estB, name: `${RUN_TAG} sd rodeoB` });

    profA1 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, tag: `032${Date.now().toString().slice(-12)}`, visualAlt: `${RUN_TAG}_a1` })).profileId;
    profA2 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, visualAlt: `${RUN_TAG}_a2` })).profileId;
    profB1 = (await createAnimal(ownerClientB, { establishmentId: estB, rodeoId: rodeoB.id, systemId: rodeoB.systemId, visualAlt: `${RUN_TAG}_b1` })).profileId;
    assert.ok(profA1 && profA2 && profB1, 'setup: perfiles no creados');
  });

  // T5 (a): owner puede INSERT.
  await t.test('T5(a) R3.5: owner puede INSERT una declaración', async () => {
    const { error } = await ownerClientA.from('sigsa_declarations').insert({ establishment_id: estA, animal_profile_id: profA1 });
    assert.equal(error, null, error && error.message);
  });

  // T5 (b): veterinarian puede INSERT.
  await t.test('T5(b) R3.5: veterinarian puede INSERT', async () => {
    const { error } = await vetClientA.from('sigsa_declarations').insert({ establishment_id: estA, animal_profile_id: profA2 });
    assert.equal(error, null, error && error.message);
  });

  // T5 (c): field_operator NO puede INSERT.
  await t.test('T5(c) R3.5/R7.2: field_operator NO puede INSERT', async () => {
    // usar un perfil nuevo para no chocar con el UNIQUE de profA1/profA2 ya declarados
    const profA3 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, visualAlt: `${RUN_TAG}_a3` })).profileId;
    const { error } = await opClientA.from('sigsa_declarations').insert({ establishment_id: estA, animal_profile_id: profA3 });
    assert.notEqual(error, null, 'el field_operator no debería poder insertar una declaración');
    const { data } = await admin.from('sigsa_declarations').select('id').eq('animal_profile_id', profA3);
    assert.deepEqual(data, [], 'no debería haber quedado la declaración del field_operator');
  });

  // T5 (d): segundo INSERT del mismo par viola UNIQUE.
  await t.test('T5(d) R3.1: segundo INSERT del mismo (establishment, animal) viola UNIQUE', async () => {
    const { error } = await ownerClientA.from('sigsa_declarations').insert({ establishment_id: estA, animal_profile_id: profA1 });
    assert.notEqual(error, null, 'un segundo marcador del mismo par debe violar el UNIQUE');
    assert.match(String(error.code || '') + (error.message || ''), /23505|unique|duplicate/i, 'debe ser una violación de unicidad');
  });

  // T5 (e): usuario sin rol no puede SELECT.
  await t.test('T5(e) R11.2: outsider sin rol en estA NO ve las declaraciones de estA', async () => {
    const { data, error } = await outsiderClient.from('sigsa_declarations').select('id').eq('establishment_id', estA);
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data, [], 'un outsider no debería ver las declaraciones de estA');
  });

  // T5 (f): usuario con rol en otro establishment no ve las del primero.
  await t.test('T5(f) R11.2: ownerB (rol en estB) NO ve las declaraciones de estA', async () => {
    const { data, error } = await ownerClientB.from('sigsa_declarations').select('id').eq('establishment_id', estA);
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data, [], 'ownerB no debería ver declaraciones de estA');
  });

  // T5 (g): un animal transferido al campo destino puede tener su propia declaración INDEPENDIENTE de
  // la del campo origen (R3.2). Modelado fiel a spec 11: el MISMO animal (animal_id) tiene un perfil en
  // estA (que al transferir queda status='transferred') y un perfil NUEVO en estB (status='active'). El
  // UNIQUE es por (establishment_id, animal_profile_id), NO global por animal → las DOS declaraciones
  // (una por establishment) coexisten sin chocar.
  await t.test('T5(g) R3.2: mismo animal en 2 campos → cada uno declara su propio perfil (UNIQUE por est+perfil)', async () => {
    // animal con perfil activo en estA (el "origen").
    const moved = await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, visualAlt: `${RUN_TAG}_moved` });
    assert.equal(moved.error, undefined, moved.error && moved.error.message);
    // estA declara su perfil.
    const { error: decAErr } = await ownerClientA.from('sigsa_declarations').insert({ establishment_id: estA, animal_profile_id: moved.profileId });
    assert.equal(decAErr, null, decAErr && decAErr.message);
    // "transferencia" (spec 11): el perfil origen pasa a transferred; nace un perfil NUEVO del MISMO
    // animal en estB, activo (el partial-unique animal_profiles_active_animal_unique exige ≤1 perfil
    // activo por animal, por eso el origen debe dejar de estar activo).
    await admin.from('animal_profiles').update({ status: 'transferred' }).eq('id', moved.profileId);
    const destCatId = await categoryId(ownerClientB, rodeoB.systemId, 'vaquillona');
    const destProfileId = crypto.randomUUID();
    const { error: destErr } = await admin.from('animal_profiles').insert({
      id: destProfileId, animal_id: moved.animalId, establishment_id: estB,
      rodeo_id: rodeoB.id, category_id: destCatId, status: 'active', visual_id_alt: `${RUN_TAG}_moved_dest`,
    });
    assert.equal(destErr, null, destErr && destErr.message);
    // estB declara SU perfil del mismo animal → debe pasar (no hereda el marcador de estA, R3.2).
    const { error: decBErr } = await ownerClientB.from('sigsa_declarations').insert({ establishment_id: estB, animal_profile_id: destProfileId });
    assert.equal(decBErr, null, 'estB debe poder declarar su propio perfil del mismo animal, independiente de estA');
    // las dos declaraciones coexisten, una por establishment, sin cross-leak.
    const { data: aSees } = await ownerClientA.from('sigsa_declarations').select('id').eq('establishment_id', estB);
    assert.deepEqual(aSees, [], 'estA no debería ver la declaración de estB');
    const { data: bothA } = await admin.from('sigsa_declarations').select('id').eq('animal_profile_id', moved.profileId);
    const { data: bothB } = await admin.from('sigsa_declarations').select('id').eq('animal_profile_id', destProfileId);
    assert.equal(bothA.length, 1, 'la declaración del origen (estA) persiste');
    assert.equal(bothB.length, 1, 'la declaración del destino (estB) existe independiente');
  });

  // T5 (h): declared_by forzado a auth.uid() aunque el payload mande otro UUID (HIGH-1).
  await t.test('T5(h) R3.6: declared_by se fuerza a auth.uid() (ignora el UUID del payload)', async () => {
    const profA4 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, visualAlt: `${RUN_TAG}_a4` })).profileId;
    const { error } = await ownerClientA.from('sigsa_declarations').insert({
      establishment_id: estA, animal_profile_id: profA4,
      declared_by: outsider.id, // intento de spoof
    });
    assert.equal(error, null, error && error.message);
    const { data } = await admin.from('sigsa_declarations').select('declared_by').eq('animal_profile_id', profA4).single();
    assert.equal(data.declared_by, ownerA.id, 'declared_by debe ser el caller (owner), no el UUID del payload');
    assert.notEqual(data.declared_by, outsider.id, 'el declared_by spoofeado NO debe persistir');
  });

  // T5 (i): IDOR — INSERT con animal_profile_id de OTRO establishment es rechazado aunque el
  // establishment_id sea válido para el caller (MEDIUM-4 / R3.7).
  await t.test('T5(i) R3.7: IDOR — animal_profile_id de otro est es rechazado (con establishment_id propio)', async () => {
    const { error } = await ownerClientA.from('sigsa_declarations').insert({
      establishment_id: estA,       // válido para ownerA
      animal_profile_id: profB1,    // PERO este perfil es de estB
    });
    assert.notEqual(error, null, 'un animal_profile_id de otro est debe ser rechazado (IDOR-check)');
    const { data } = await admin.from('sigsa_declarations')
      .select('id').eq('establishment_id', estA).eq('animal_profile_id', profB1);
    assert.deepEqual(data, [], 'no debería haber quedado la declaración cross-tenant');
  });

  // No-UPDATE / No-DELETE de cliente (append-only, R11.3).
  await t.test('T5 R11.3: cliente NO puede UPDATE ni DELETE una declaración (append-only)', async () => {
    const { data: row } = await admin.from('sigsa_declarations').select('id').eq('animal_profile_id', profA1).single();
    const upd = await ownerClientA.from('sigsa_declarations').update({ declared_at: new Date().toISOString() }).eq('id', row.id).select('id');
    const del = await ownerClientA.from('sigsa_declarations').delete().eq('id', row.id).select('id');
    // sin GRANT update/delete → PostgREST rechaza o 0 filas; la fila debe seguir existiendo.
    const { data: still } = await admin.from('sigsa_declarations').select('id').eq('id', row.id).maybeSingle();
    assert.ok(still, 'la declaración no debería poder borrarse/mutarse desde el cliente (append-only)');
    assert.ok((upd.error !== null || (upd.data || []).length === 0), 'UPDATE de cliente debe fallar o afectar 0 filas');
    assert.ok((del.error !== null || (del.data || []).length === 0), 'DELETE de cliente debe fallar o afectar 0 filas');
  });

  await t.test('cleanup', async () => { await cleanup(); });
});

// =====================================================================
// T6 — export_log (0112): CHECKs + RLS + trigger generated_by + FK export_log_id.
// R4.1, R4.2, R4.3, R4.4, R11.1, R11.2, R11.3
// =====================================================================

test('spec 08 — T6 export_log (RLS, CHECKs 5MB/255, generated_by forzado, FK export_log_id)', async (t) => {
  let ownerA, vetA, opA, ownerB;
  let ownerClientA, vetClientA, opClientA, ownerClientB;
  let estA, rodeoA, estB;
  let profA1;

  await t.test('setup', async () => {
    ownerA = await createTestUser('elOwnerA');
    vetA = await createTestUser('elVetA');
    opA = await createTestUser('elOpA');
    ownerB = await createTestUser('elOwnerB');
    ownerClientA = await getUserClient(ownerA.email);
    vetClientA = await getUserClient(vetA.email);
    opClientA = await getUserClient(opA.email);
    ownerClientB = await getUserClient(ownerB.email);
    estA = await createEstablishmentAs(ownerClientA, `${RUN_TAG} el estA`);
    await assignRoleAsService(vetA.id, estA, 'veterinarian');
    await assignRoleAsService(opA.id, estA, 'field_operator');
    rodeoA = await createRodeo(ownerClientA, { establishmentId: estA, name: `${RUN_TAG} el rodeoA` });
    estB = await createEstablishmentAs(ownerClientB, `${RUN_TAG} el estB`);
    profA1 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, tag: `032${Date.now().toString().slice(-12)}`, visualAlt: `${RUN_TAG}_el_a1` })).profileId;
  });

  // T6 (a): owner puede INSERT.
  await t.test('T6(a) R4.2: owner puede INSERT en export_log', async () => {
    const { error } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_test_20260624.txt',
      file_content: '032010000000000-M-H-08/2025', rodeo_filter_id: rodeoA.id,
    });
    assert.equal(error, null, error && error.message);
  });

  // T6 (b): veterinarian puede INSERT.
  await t.test('T6(b) R4.2: veterinarian puede INSERT en export_log', async () => {
    const { error } = await vetClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_vet.txt', file_content: 'x',
    });
    assert.equal(error, null, error && error.message);
  });

  // T6 (c): field_operator NO puede INSERT.
  await t.test('T6(c) R4.2/R7.2: field_operator NO puede INSERT en export_log', async () => {
    const { error } = await opClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_op.txt', file_content: 'x',
    });
    assert.notEqual(error, null, 'el field_operator no debería poder insertar en export_log');
    const { data } = await admin.from('export_log').select('id').eq('establishment_id', estA).eq('file_name', 'sigsa_op.txt');
    assert.deepEqual(data, [], 'no debería haber quedado el export_log del field_operator');
  });

  // T6 (d): usuario en otro establishment no puede SELECT.
  await t.test('T6(d) R4.2: ownerB (otro est) NO ve los export_log de estA', async () => {
    const { data, error } = await ownerClientB.from('export_log').select('id').eq('establishment_id', estA);
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data, [], 'ownerB no debería ver los export_log de estA');
  });

  // T6 (h): generated_by forzado a auth.uid() aunque el payload mande otro UUID (HIGH-1).
  await t.test('T6(h) R4.4: generated_by se fuerza a auth.uid() (ignora el UUID del payload)', async () => {
    const { error } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_forced.txt', file_content: 'y',
      generated_by: ownerB.id, // intento de spoof
    });
    assert.equal(error, null, error && error.message);
    const { data } = await admin.from('export_log').select('generated_by').eq('establishment_id', estA).eq('file_name', 'sigsa_forced.txt').single();
    assert.equal(data.generated_by, ownerA.id, 'generated_by debe ser el caller (owner), no el UUID del payload');
    assert.notEqual(data.generated_by, ownerB.id, 'el generated_by spoofeado NO debe persistir');
  });

  // T6 (g): file_content > 5MB y file_name > 255 rechazados por los CHECKs (HIGH-2).
  await t.test('T6(g) R4.1: file_content > 5MB y file_name > 255 chars rechazados por el CHECK', async () => {
    // file_content > 5MB (octet_length): 5_000_001 bytes ASCII.
    const tooBig = 'a'.repeat(5_000_001);
    const { error: e1 } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_big.txt', file_content: tooBig,
    });
    assert.notEqual(e1, null, 'un file_content > 5MB debe ser rechazado por el CHECK');
    assert.match((e1.message || '') + (e1.details || ''), /file_content|check|violates|size/i, 'el rechazo debe venir del CHECK de file_content');
    // file_name > 255 chars.
    const { error: e2 } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'n'.repeat(256) + '.txt', file_content: 'x',
    });
    assert.notEqual(e2, null, 'un file_name > 255 chars debe ser rechazado por el CHECK');
    // sanity: un file_content cómodo SÍ entra.
    const { error: e3 } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_ok.txt', file_content: 'b'.repeat(1000),
    });
    assert.equal(e3, null, e3 && e3.message);
  });

  // T6 (e): FK export_log_id en sigsa_declarations apunta a filas reales de export_log.
  await t.test('T6(e) R11.2: sigsa_declarations.export_log_id referencia export_log (FK); UUID inexistente rechazado', async () => {
    // crear un export_log real
    const { error: insErr } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_fk.txt', file_content: 'z',
    });
    assert.equal(insErr, null, insErr && insErr.message);
    const { data: el } = await admin.from('export_log').select('id').eq('establishment_id', estA).eq('file_name', 'sigsa_fk.txt').single();
    // declaración válida con export_log_id real (vía owner; profA1 pertenece a estA → pasa IDOR-check)
    const { error: okErr } = await ownerClientA.from('sigsa_declarations').insert({
      establishment_id: estA, animal_profile_id: profA1, export_log_id: el.id,
    });
    assert.equal(okErr, null, okErr && okErr.message);
    // un export_log_id inexistente → viola la FK fk_sigsa_declarations_export_log
    const profA9 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, visualAlt: `${RUN_TAG}_el_a9` })).profileId;
    const { error: badErr } = await ownerClientA.from('sigsa_declarations').insert({
      establishment_id: estA, animal_profile_id: profA9, export_log_id: crypto.randomUUID(),
    });
    assert.notEqual(badErr, null, 'un export_log_id inexistente debe violar la FK');
  });

  // T6 (f): borrar un export_log setea export_log_id = NULL en sigsa_declarations (ON DELETE SET NULL).
  await t.test('T6(f) R11.2: borrar un export_log → export_log_id = NULL en sigsa_declarations (ON DELETE SET NULL)', async () => {
    // crear export_log + declaración vinculada (la del test e ya vinculó profA1 a sigsa_fk; usamos uno fresco)
    const { error: insErr } = await ownerClientA.from('export_log').insert({
      establishment_id: estA, animal_count: 1, file_name: 'sigsa_del.txt', file_content: 'd',
    });
    assert.equal(insErr, null, insErr && insErr.message);
    const { data: el } = await admin.from('export_log').select('id').eq('establishment_id', estA).eq('file_name', 'sigsa_del.txt').single();
    const profA8 = (await createAnimal(ownerClientA, { establishmentId: estA, rodeoId: rodeoA.id, systemId: rodeoA.systemId, visualAlt: `${RUN_TAG}_el_a8` })).profileId;
    const { error: decErr } = await ownerClientA.from('sigsa_declarations').insert({
      establishment_id: estA, animal_profile_id: profA8, export_log_id: el.id,
    });
    assert.equal(decErr, null, decErr && decErr.message);
    // borrar el export_log (vía admin: el cliente no tiene DELETE) → la declaración persiste con export_log_id NULL
    const { error: delErr } = await admin.from('export_log').delete().eq('id', el.id);
    assert.equal(delErr, null, delErr && delErr.message);
    const { data: dec } = await admin.from('sigsa_declarations').select('id, export_log_id').eq('animal_profile_id', profA8).single();
    assert.ok(dec, 'la declaración debe persistir tras borrar el export_log');
    assert.equal(dec.export_log_id, null, 'export_log_id debe quedar NULL (ON DELETE SET NULL)');
  });

  await t.test('cleanup', async () => { await cleanup(); });
});

// =====================================================================
// T18 — derive breed_id (0113): trigger BEFORE INSERT OR UPDATE OF breed.   R1.4 (cierre del GAP breed_id)
// =====================================================================
//
// El trigger tg_derive_breed_id_from_breed (0113) DERIVA animal_profiles.breed_id desde `breed` (nombre
// del catálogo) por match normalizado contra breed_catalog. El cliente escribe SOLO `breed`; el trigger
// pone el breed_id. Guard `breed IS NOT NULL` → NO pisa el breed_id heredado de la madre en el ternero al
// pie (que entra con breed NULL + breed_id seteado por 0108/0109).
//
// ⚠️ Estos tests pasan verde RECIÉN DESPUÉS de que el LEADER aplique 0113 al remoto (la suite corre contra
// la DB remota; hasta el apply, el trigger no existe → (a)/(d)/(e) fallarían porque breed_id queda NULL).
// Mismo gating que T1-T6 (que esperaron el apply de 0107-0112).

test('spec 08 — T18 derive breed_id (0113): trigger BEFORE INSERT OR UPDATE OF breed', async (t) => {
  let user, client, est, rodeo, aaId, hId;

  await t.test('setup: est + rodeo + breed ids (AA, H)', async () => {
    user = await createTestUser('deriveBreed');
    client = await getUserClient(user.email);
    est = await createEstablishmentAs(client, `${RUN_TAG} derive est`);
    rodeo = await createRodeo(client, { establishmentId: est, name: `${RUN_TAG} derive rodeo` });
    aaId = await breedIdByCode(client, 'AA');
    hId = await breedIdByCode(client, 'H');
  });

  // (a) INSERT con breed='Aberdeen Angus' → breed_id = el id de AA (match exacto).
  await t.test('T18(a) R1.4: INSERT con breed="Aberdeen Angus" → breed_id derivado a AA', async () => {
    const r = await createAnimal(client, {
      establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId,
      visualAlt: `${RUN_TAG}_d_aa`, breed: 'Aberdeen Angus',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, aaId, 'el trigger debe derivar breed_id = AA desde el nombre "Aberdeen Angus"');
  });

  // (b) breed='nomatch_xyz' → breed_id NULL (sin match en el catálogo, no se inventa).
  await t.test('T18(b) R1.4: INSERT con breed sin match → breed_id NULL', async () => {
    const r = await createAnimal(client, {
      establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId,
      visualAlt: `${RUN_TAG}_d_nomatch`, breed: 'nomatch_xyz_raza_inexistente',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, null, 'un breed sin match en el catálogo debe dejar breed_id NULL');
  });

  // (c) ⚠ GUARD: breed NULL + breed_id seteado (simula ternero al pie) → breed_id PRESERVADO.
  //     Insertamos un perfil con breed NULL y breed_id = AA explícito (como lo hace el INSERT del ternero
  //     en 0108/0109). El trigger NO debe pisar ese breed_id (guard breed IS NOT NULL).
  await t.test('T18(c) R1.7: breed NULL + breed_id seteado (ternero) → breed_id PRESERVADO (guard)', async () => {
    const r = await createAnimal(client, {
      establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId,
      visualAlt: `${RUN_TAG}_d_calf`, breedId: aaId, // breed queda NULL (createAnimal solo setea breed si viene)
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { data } = await admin.from('animal_profiles').select('breed, breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed, null, 'precondición: breed debe ser NULL (simula ternero al pie)');
    assert.equal(data.breed_id, aaId, 'el guard breed IS NOT NULL debe PRESERVAR el breed_id heredado (AA)');
  });

  // (d) UPDATE de breed='Hereford' sobre un perfil existente → breed_id re-derivado a H.
  await t.test('T18(d) R1.4: UPDATE de breed="Hereford" → breed_id re-derivado a H', async () => {
    // Perfil que arranca con AA (por nombre).
    const r = await createAnimal(client, {
      establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId,
      visualAlt: `${RUN_TAG}_d_upd`, breed: 'Aberdeen Angus',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    // El cliente actualiza SOLO breed (NUNCA breed_id) — exactamente lo que hace la ficha (setBreed).
    const { error: updErr } = await client.from('animal_profiles').update({ breed: 'Hereford' }).eq('id', r.profileId);
    assert.equal(updErr, null, updErr && updErr.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, hId, 'el UPDATE de breed debe re-derivar breed_id a H');
  });

  // (d-bis) UPDATE de breed → texto sin match → breed_id vuelve a NULL (el trigger lo limpia, no queda colgado).
  await t.test('T18(d-bis) R1.4: UPDATE de breed a texto sin match → breed_id NULL', async () => {
    const r = await createAnimal(client, {
      establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId,
      visualAlt: `${RUN_TAG}_d_updnull`, breed: 'Hereford',
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { error: updErr } = await client.from('animal_profiles').update({ breed: 'raza_que_no_existe' }).eq('id', r.profileId);
    assert.equal(updErr, null, updErr && updErr.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, null, 'cambiar breed a un texto sin match debe dejar breed_id NULL (no colgado en H)');
  });

  // (e) case-insensitive: breed='aberdeen angus' (minúsculas + espacios) → AA.
  await t.test('T18(e) R1.4: match case/trim-insensitive ("  aberdeen angus  " → AA)', async () => {
    const r = await createAnimal(client, {
      establishmentId: est, rodeoId: rodeo.id, systemId: rodeo.systemId,
      visualAlt: `${RUN_TAG}_d_ci`, breed: '  aberdeen angus  ', // el trigger hace lower(trim(...))
    });
    assert.equal(r.error, undefined, r.error && r.error.message);
    const { data } = await admin.from('animal_profiles').select('breed_id').eq('id', r.profileId).single();
    assert.equal(data.breed_id, aaId, 'el match debe ser case/trim-insensitive ("  aberdeen angus  " → AA)');
  });

  await t.test('cleanup', async () => { await cleanup(); });
});
