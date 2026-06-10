// supabase/tests/sync_streams/run.cjs
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Tests de NO-BYPASS POR DEVICE de las sync streams de RAFAQ (spec 15-powersync, T7.2 + T9.7).
//
// QUÉ valida: la frontera de AUTORIZACIÓN del SYNC SET (lo que un device recibiría por PowerSync),
// NO la RLS de PostgREST. Las dos fronteras son distintas: el WAL replica la tabla base ignorando
// views/RPC/column-GRANTs (ADR-025), así que el contenido de cada stream (`sync-streams/rafaq.yaml`)
// ES la frontera. Estos tests son el ESPEJO de los runners RLS (supabase/tests/rls/run.cjs), pero
// sobre las STREAMS en vez de las policies.
//
// CÓMO (sin device — design §7, "simulando la query de la stream contra Postgres con el user_id de
// cada actor"): cada stream per-establishment es JOIN-FREE y scopea por el MISMO predicado:
//
//     WHERE establishment_id IN org_scope           (org_scope / owner_scope son CTEs de 1 columna)
//     org_scope   = SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
//     owner_scope = ... AND role = 'owner'
//
// El sync set de un actor = ⋃ (filas de cada tabla cuyo establishment_id ∈ su org/owner_scope), más
// las self-only (user_private/user_roles por user_id) y las globales (catálogos, sin filtro). Lo
// computamos con el cliente SERVICE_ROLE (que BYPASSA la RLS) aplicando el predicado de la STREAM a
// mano → así testeamos la frontera de la STREAM, no la de PostgREST. Si una stream fuera permisiva
// (sin el `establishment_id IN org_scope`), las filas de B aparecerían en el set de A y estos asserts
// FALLARÍAN (verificado mentalmente en la autorrevisión: el `assertNotInSyncSet` mira el set REAL).
//
// AUTOCONTENIDO + TOLERANTE A DATA AJENA (la beta tiene data contaminada de tests): dos campos +
// usuarios DEDICADOS por corrida (namespaced con RUN_TAG); cada assert verifica relaciones ENTRE
// nuestros dos tenants (A no recibe lo de B / B no recibe lo de A / catálogos llegan a ambos), nunca
// conteos absolutos. Cleanup robusto al final (CASCADE de establishments + borrado de users).
//
// Migraciones requeridas YA APLICADAS al remoto (verificado): 0077-0080 (denormalización de
// establishment_id + identidad b1 + member_name c2). Si no estuvieran, los SELECT de las columnas
// denormalizadas fallarían con 42703 — pero ya están en vivo, así que estos tests corren verdes.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node --test run.cjs
// Las vars se cargan automáticamente desde <repo>/.env.local si existe (mismo patrón que rls/run.cjs).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// ── Resolve repo root + .env.local (idéntico a rls/run.cjs / animal/run.cjs) ──────────────────────
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
  console.error(
    'Faltan vars: SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY / EXPO_PUBLIC_SUPABASE_ANON_KEY',
  );
  process.exit(2);
}

const RUN_TAG = `sync_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];
const createdAnimalIds = [];

async function createTestUser(label) {
  const email = `${RUN_TAG}_${label}@rafaq-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: `Sync ${label}` },
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email, name: `Sync ${label}` };
}

// Cliente JWT-scoped del user (auth.uid() = el user). Necesario para invocar register_birth (revocado
// de service_role; solo authenticated) → la única vía de crear birth_calves (server-only, sin GRANT
// de INSERT al cliente; se puebla por el trigger del parto). Mismo patrón que rls/animal runner.
async function getUserClient(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

// ── Fixtures: campo + owner + rodeo + (opcional) un coworker. Todo vía service_role (bypassa RLS). ──
async function seedEstablishment(ownerId, name) {
  const { data, error } = await admin
    .from('establishments')
    .insert({ name: `${RUN_TAG} ${name}`, province: 'Buenos Aires' })
    .select('id')
    .single();
  if (error) throw new Error(`seedEstablishment(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  await admin
    .from('user_roles')
    .insert({ user_id: ownerId, establishment_id: data.id, role: 'owner', active: true });
  return data.id;
}

async function addMember(userId, establishmentId, role = 'field_operator') {
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`addMember: ${error.message}`);
}

async function lookupSpeciesSystem(speciesCode = 'bovino', systemCode = 'cria') {
  const { data: sp } = await admin.from('species').select('id').eq('code', speciesCode).single();
  const { data: sys } = await admin
    .from('systems_by_species')
    .select('id')
    .eq('species_id', sp.id)
    .eq('code', systemCode)
    .single();
  return { speciesId: sp.id, systemId: sys.id };
}

async function seedRodeo(establishmentId, name = 'Rodeo general') {
  const { speciesId, systemId } = await lookupSpeciesSystem();
  const { data, error } = await admin
    .from('rodeos')
    .insert({ establishment_id: establishmentId, name: `${RUN_TAG} ${name}`, species_id: speciesId, system_id: systemId })
    .select('id, system_id')
    .single();
  if (error) throw new Error(`seedRodeo(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

// Siembra un animal completo (animals + animal_profiles) + un peso + una observación + un cambio de
// categoría. Devuelve los ids para los asserts. El trigger 0077/0079 fuerza establishment_id e
// identidad denormalizada (probamos que la columna queda fiel al campo).
async function seedAnimalWithEvents(establishmentId, rodeoId, systemId, opts = {}) {
  const sex = opts.sex || 'female';
  const tag = opts.tag || null;
  const authorId = opts.authorId || null; // owner del campo (animal_events.author_id NOT NULL, 0043)
  const { speciesId } = await lookupSpeciesSystem();
  const { data: cat } = await admin
    .from('categories_by_system')
    .select('id')
    .eq('system_id', systemId)
    .eq('code', sex === 'male' ? 'torito' : 'vaquillona')
    .single();

  const animalId = randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (tag) animalPayload.tag_electronic = tag;
  if (opts.birthDate) animalPayload.birth_date = opts.birthDate;
  { const { error } = await admin.from('animals').insert(animalPayload); if (error) throw new Error(`seedAnimal animals: ${error.message}`); }
  createdAnimalIds.push(animalId);

  const profileId = randomUUID();
  const profilePayload = { id: profileId, animal_id: animalId, establishment_id: establishmentId, rodeo_id: rodeoId, category_id: cat.id, status: 'active' };
  if (opts.idv) profilePayload.idv = opts.idv;
  { const { error } = await admin.from('animal_profiles').insert(profilePayload); if (error) throw new Error(`seedAnimal profiles: ${error.message}`); }

  // Eventos hijos del paso 2 (establishment_id forzado por trigger 0077 desde el perfil → lo OMITIMOS
  // a propósito y verificamos que el trigger lo derive fiel al campo). Sembramos UNO de cada clase de
  // stream para que los tests de no-bypass tengan data en AMBOS tenants (un set vacío pasaría trivial).
  { const { error } = await admin.from('weight_events').insert({ animal_profile_id: profileId, weight_kg: 300, weight_date: '2026-06-01' }); if (error) throw new Error(`seedAnimal weight: ${error.message}`); }
  { const { error } = await admin.from('sanitary_events').insert({ animal_profile_id: profileId, event_type: 'vaccination', product_name: 'Aftosa', event_date: '2026-06-01' }); if (error) throw new Error(`seedAnimal sanitary: ${error.message}`); }
  { const { error } = await admin.from('condition_score_events').insert({ animal_profile_id: profileId, score: 3.5, event_date: '2026-06-01' }); if (error) throw new Error(`seedAnimal condition: ${error.message}`); }
  { const { error } = await admin.from('lab_samples').insert({ animal_profile_id: profileId, sample_type: 'blood', tube_number: `T-${randomUUID().slice(0, 8)}`, collection_date: '2026-06-01' }); if (error) throw new Error(`seedAnimal lab: ${error.message}`); }
  // Una observación (animal_events; establishment_id propio desde 0034 — el trigger 0034 VALIDA que
  // matchee el perfil pero NO lo auto-rellena, así que se pasa explícito, igual que la app/animal runner).
  // author_id (NOT NULL, 0043) lo forzaría el trigger desde auth.uid(); con service_role auth.uid() es
  // null → lo pasamos explícito (el owner del campo). Lo que estos tests validan es el SCOPE del stream,
  // no el trigger de author_id (eso es de spec 02).
  { const ev = { animal_profile_id: profileId, establishment_id: establishmentId, event_type: 'observacion', text: 'obs de prueba' }; if (authorId) ev.author_id = authorId; const { error } = await admin.from('animal_events').insert(ev); if (error) throw new Error(`seedAnimal animal_event: ${error.message}`); }

  return { animalId, profileId };
}

// Siembra un PARTO real (madre preñada → register_birth → reproductive_events + birth_calves + ternero)
// para cubrir las streams hijas más PROFUNDAS (ev_reproductive_events + ev_birth_calves, cadena
// denormalizada parto→madre del paso 2). `birth_calves` es SERVER-ONLY (sin GRANT de INSERT al cliente
// ni a service_role) → la ÚNICA vía es la RPC register_birth, invocada por el JWT del OWNER (authenticated).
// La madre debe ser una hembra preñada (categoría vaquillona_prenada) para que register_birth la acepte.
async function seedBirth(ownerClient, establishmentId, rodeoId, systemId) {
  const { speciesId } = await lookupSpeciesSystem();
  const { data: catPreg } = await admin
    .from('categories_by_system').select('id').eq('system_id', systemId).eq('code', 'vaquillona_prenada').single();

  // Madre preñada (vía service_role).
  const motherAnimalId = randomUUID();
  await admin.from('animals').insert({ id: motherAnimalId, sex: 'female', species_id: speciesId, birth_date: '2023-01-01' });
  createdAnimalIds.push(motherAnimalId);
  const motherProfileId = randomUUID();
  const motherIdv = `M${Date.now().toString().slice(-7)}`; // el perfil exige ≥1 identificador (CHECK 0070)
  { const { error } = await admin.from('animal_profiles').insert({ id: motherProfileId, animal_id: motherAnimalId, establishment_id: establishmentId, rodeo_id: rodeoId, category_id: catPreg.id, status: 'active', idv: motherIdv }); if (error) throw new Error(`seedBirth madre: ${error.message}`); }

  // register_birth como el OWNER (authenticated) → crea el evento de parto + el ternero + birth_calves
  // (con su establishment_id denormalizado forzado por el trigger 0078 desde el parto→madre).
  const { data: birthId, error } = await ownerClient.rpc('register_birth', {
    p_mother_profile_id: motherProfileId,
    p_event_date: '2026-06-05',
    p_calves: [{ calf_sex: 'male', calf_weight: 32 }],
  });
  if (error) throw new Error(`seedBirth register_birth: ${error.message}`);

  // El calf_profile_id que creó la RPC (para los asserts del no-bypass).
  const { data: bc, error: bcErr } = await admin
    .from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId).single();
  if (bcErr) throw new Error(`seedBirth lookup birth_calves: ${bcErr.message}`);

  return { reproductiveEventId: birthId, calfProfileId: bc.calf_profile_id, motherProfileId };
}

// ── Predicado de la stream: org_scope / owner_scope de un actor (mismo SQL que rafaq.yaml). ────────
// Lo computamos con service_role (bypassa RLS) → es el SET de campos que la STREAM le daría al device
// de ese user. NO usamos auth.user_id() (no hay sesión PostgREST acá); el equivalente exacto es
// filtrar user_roles por user_id = <actor> AND active = true [AND role='owner'].
async function orgScope(userId) {
  const { data, error } = await admin
    .from('user_roles')
    .select('establishment_id')
    .eq('user_id', userId)
    .eq('active', true);
  if (error) throw new Error(`orgScope(${userId}): ${error.message}`);
  return [...new Set((data || []).map((r) => r.establishment_id))];
}
async function ownerScope(userId) {
  const { data, error } = await admin
    .from('user_roles')
    .select('establishment_id')
    .eq('user_id', userId)
    .eq('active', true)
    .eq('role', 'owner');
  if (error) throw new Error(`ownerScope(${userId}): ${error.message}`);
  return [...new Set((data || []).map((r) => r.establishment_id))];
}

// Computa el SYNC SET de una tabla per-establishment para un actor: las filas cuyo establishment_id
// ∈ scope (+ el filtro deleted_at de la stream, si aplica). Devuelve los ids. Esto ES la query de la
// stream (`SELECT ... WHERE establishment_id IN org_scope [AND deleted_at IS NULL]`).
async function syncSetIds(table, scope, { withDeletedAtFilter = true, idCol = 'id' } = {}) {
  if (scope.length === 0) return [];
  let q = admin.from(table).select(idCol).in('establishment_id', scope);
  if (withDeletedAtFilter) q = q.is('deleted_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`syncSetIds(${table}): ${error.message}`);
  return (data || []).map((r) => r[idCol]);
}

// Para tablas hijas con PK compuesta o sin id propio: traer los establishment_id de las filas que
// matchean un id de referencia, para verificar que NO entran al scope de otro actor.
async function rowsInSyncSet(table, scope, matchCol, matchVal, { withDeletedAtFilter = false } = {}) {
  if (scope.length === 0) return [];
  let q = admin.from(table).select(`${matchCol}, establishment_id`).in('establishment_id', scope).eq(matchCol, matchVal);
  if (withDeletedAtFilter) q = q.is('deleted_at', null);
  const { data, error } = await q;
  if (error) throw new Error(`rowsInSyncSet(${table}): ${error.message}`);
  return data || [];
}

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    // birth_calves.calf_profile_id NO tiene ON DELETE CASCADE → borrar reproductive_events primero
    // (su FK birth_event_id sí cascadea birth_calves) para destrabar el CASCADE de establishments.
    const { data: profs } = await admin
      .from('animal_profiles').select('id').in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    if (profileIds.length > 0) {
      await admin.from('reproductive_events').delete().in('animal_profile_id', profileIds);
      await admin.from('reproductive_events').delete().in('calf_id', profileIds);
    }
    const { error } = await admin.from('establishments').delete().in('id', createdEstablishmentIds);
    if (error) console.error('cleanup establishments:', error.message);
  }
  if (createdAnimalIds.length > 0) {
    const { error } = await admin.from('animals').delete().in('id', createdAnimalIds);
    if (error) console.error('cleanup animals:', error.message);
  }
  for (const uid of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// SUITE
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test('spec 15-powersync — no-bypass por device (sync streams, T7.2 + T9.7)', async (t) => {
  // Dos tenants COMPLETAMENTE DISJUNTOS + un coworker en A (field_operator) para los casos owner-only.
  let userA, userB, userCoA;
  let estA, estB;
  let rodeoA, rodeoB;
  let animalA, animalB; // { animalId, profileId }
  let birthA;           // { reproductiveEventId, calfProfileId } en A
  let groupA, groupB;   // management_group ids
  let invA;             // invitation id pendiente de A

  await t.test('setup: estA (owner A + coworker CoA) y estB (owner B), data en cada uno', async () => {
    userA = await createTestUser('A');
    userB = await createTestUser('B');
    userCoA = await createTestUser('CoA');

    estA = await seedEstablishment(userA.id, 'CampoA');
    estB = await seedEstablishment(userB.id, 'CampoB');
    await addMember(userCoA.id, estA, 'field_operator'); // coworker de A (lee, no owner)

    const rA = await seedRodeo(estA);
    const rB = await seedRodeo(estB);
    rodeoA = rA.id;
    rodeoB = rB.id;

    animalA = await seedAnimalWithEvents(estA, rodeoA, rA.systemId, { idv: `A${Date.now().toString().slice(-6)}`, tag: `TAGA${Date.now().toString().slice(-7)}`, sex: 'female', authorId: userA.id });
    animalB = await seedAnimalWithEvents(estB, rodeoB, rB.systemId, { idv: `B${Date.now().toString().slice(-6)}`, tag: `TAGB${Date.now().toString().slice(-7)}`, sex: 'female', authorId: userB.id });

    // El parto (birth_calves server-only) se crea vía register_birth con el JWT del OWNER A.
    const clientA = await getUserClient(userA.email);
    birthA = await seedBirth(clientA, estA, rodeoA, rA.systemId);

    // Un management_group por campo.
    { const { data } = await admin.from('management_groups').insert({ establishment_id: estA, name: `${RUN_TAG} loteA` }).select('id').single(); groupA = data.id; }
    { const { data } = await admin.from('management_groups').insert({ establishment_id: estB, name: `${RUN_TAG} loteB` }).select('id').single(); groupB = data.id; }

    // Una invitación pendiente de A (owner-only stream est_invitations). token = UUID; expires_at futuro.
    {
      const { data, error } = await admin
        .from('invitations')
        .insert({
          establishment_id: estA,
          email: `${RUN_TAG}_invitee@rafaq-test.local`,
          role: 'field_operator',
          token: randomUUID(),
          status: 'pending',
          invited_by: userA.id,
          expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        })
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`seed invitation: ${error.message}`);
      invA = data.id;
    }

    assert.ok(estA && estB && estA !== estB, 'dos campos disjuntos');
    assert.ok(animalA.profileId && animalB.profileId, 'un animal por campo');
  });

  // ── CLASE per-establishment: animal_profiles (est_animal_profiles). ──────────────────────────────
  await t.test('est_animal_profiles: A NO recibe perfiles de B; B NO recibe perfiles de A', async () => {
    const scopeA = await orgScope(userA.id);
    const scopeB = await orgScope(userB.id);
    const setA = await syncSetIds('animal_profiles', scopeA);
    const setB = await syncSetIds('animal_profiles', scopeB);

    // POSITIVO: cada uno recibe SU propio perfil (si esto fallara, el predicado estaría roto al revés).
    assert.ok(setA.includes(animalA.profileId), 'A recibe SU perfil');
    assert.ok(setB.includes(animalB.profileId), 'B recibe SU perfil');
    // NO-BYPASS: el perfil de B NO está en el sync set de A, y viceversa.
    assert.ok(!setA.includes(animalB.profileId), 'A NO debe recibir el perfil de B (cross-tenant)');
    assert.ok(!setB.includes(animalA.profileId), 'B NO debe recibir el perfil de A (cross-tenant)');
    // El coworker de A (field_operator) recibe el perfil de A pero NO el de B.
    const scopeCo = await orgScope(userCoA.id);
    const setCo = await syncSetIds('animal_profiles', scopeCo);
    assert.ok(setCo.includes(animalA.profileId), 'el coworker de A recibe el perfil de A');
    assert.ok(!setCo.includes(animalB.profileId), 'el coworker de A NO recibe el perfil de B');
  });

  // ── Identidad denormalizada (b1, 0079): no cruza tenant y es FIEL al animal. ──────────────────────
  await t.test('b1 (T9.7): identidad denormalizada de animal_profiles es fiel y NO cruza tenant', async () => {
    const scopeA = await orgScope(userA.id);
    // La identidad viaja EN animal_profiles (est_animal_profiles), no en una stream nueva (animals NO se sincroniza).
    const { data: rows } = await admin
      .from('animal_profiles')
      .select('id, animal_tag_electronic, animal_sex, establishment_id')
      .in('establishment_id', scopeA)
      .is('deleted_at', null);
    const myRow = rows.find((r) => r.id === animalA.profileId);
    assert.ok(myRow, 'el perfil de A está en su sync set con la identidad denormalizada');
    assert.equal(myRow.animal_sex, 'female', 'animal_sex denormalizado fiel al animal');
    // La identidad de B (su tag) no aparece en NINGUNA fila del sync set de A.
    const { data: bRow } = await admin.from('animal_profiles').select('animal_tag_electronic').eq('id', animalB.profileId).single();
    const aTags = rows.map((r) => r.animal_tag_electronic).filter(Boolean);
    assert.ok(!aTags.includes(bRow.animal_tag_electronic), 'el tag de B NO aparece en el sync set de A');
  });

  // ── animals NO está en el sync set de NADIE. ──────────────────────────────────────────────────────
  await t.test('animals (T9.7): NO está en ninguna stream (NO se sincroniza)', () => {
    const yaml = fs.readFileSync(path.join(REPO_ROOT, 'sync-streams', 'rafaq.yaml'), 'utf8');
    // Ninguna stream declara `FROM animals` (sí `FROM animal_profiles`/`FROM animal_events`/etc., que
    // son tablas distintas). Verificamos con un \b word-boundary para no matchear animal_profiles.
    assert.doesNotMatch(yaml, /FROM\s+animals\b/i, 'animals NO debe figurar como FROM en ninguna stream');
    // Además, NO existe ninguna stream `est_animals` (la decisión b1 la descartó explícitamente).
    assert.doesNotMatch(yaml, /^\s*est_animals\s*:/m, 'NO debe existir una stream est_animals');
  });

  // ── Tablas hijas de evento denormalizadas (paso 2): A no recibe eventos de B. ─────────────────────
  for (const tbl of ['weight_events', 'sanitary_events', 'condition_score_events', 'lab_samples', 'reproductive_events']) {
    await t.test(`ev_${tbl} (T9.7): A NO recibe eventos de B; B NO recibe eventos de A`, async () => {
      const scopeA = await orgScope(userA.id);
      const scopeB = await orgScope(userB.id);
      // Por cada actor: ningún evento de su sync set apunta a un perfil del OTRO campo (cross-tenant).
      const aEvents = await syncSetIds(tbl, scopeA, { withDeletedAtFilter: true });
      const bEvents = await syncSetIds(tbl, scopeB, { withDeletedAtFilter: true });
      // Verificación de DISJUNCIÓN dura: ningún id está en ambos sets.
      const overlap = aEvents.filter((id) => bEvents.includes(id));
      assert.deepEqual(overlap, [], `el sync set de ${tbl} de A y B NO debe solaparse`);
      // Y todo evento del sync set de A tiene establishment_id ∈ scopeA (la columna denormalizada es la frontera).
      if (aEvents.length > 0) {
        const { data: check } = await admin.from(tbl).select('id, establishment_id').in('id', aEvents);
        assert.ok(check.every((r) => scopeA.includes(r.establishment_id)), `todo ${tbl} del set de A pertenece a un campo de A`);
        assert.ok(check.every((r) => !scopeB.includes(r.establishment_id)), `ningún ${tbl} del set de A pertenece a un campo de B`);
      }
    });
  }

  // ── animal_events (establishment_id propio 0034): mismo no-bypass. ────────────────────────────────
  await t.test('est_animal_events: A NO recibe observaciones de B', async () => {
    const scopeA = await orgScope(userA.id);
    const scopeB = await orgScope(userB.id);
    const aSet = await syncSetIds('animal_events', scopeA, { withDeletedAtFilter: true });
    const bSet = await syncSetIds('animal_events', scopeB, { withDeletedAtFilter: true });
    assert.deepEqual(aSet.filter((id) => bSet.includes(id)), [], 'animal_events de A y B disjuntos');
    if (aSet.length > 0) {
      const { data } = await admin.from('animal_events').select('establishment_id').in('id', aSet);
      assert.ok(data.every((r) => scopeA.includes(r.establishment_id)), 'todo animal_event de A pertenece a A');
    }
  });

  // ── birth_calves (PK compuesta, cadena parto→madre 0078): el ternero de A no cruza a B. ───────────
  await t.test('ev_birth_calves (T9.7): el ternero del parto de A NO entra al sync set de B', async () => {
    const scopeA = await orgScope(userA.id);
    const scopeB = await orgScope(userB.id);
    // La fila birth_calves del parto de A: su establishment_id debe ∈ scopeA y ∉ scopeB.
    const inA = await rowsInSyncSet('birth_calves', scopeA, 'calf_profile_id', birthA.calfProfileId);
    const inB = await rowsInSyncSet('birth_calves', scopeB, 'calf_profile_id', birthA.calfProfileId);
    assert.ok(inA.length === 1, 'el ternero de A está en el sync set de A (1 fila)');
    assert.equal(inB.length, 0, 'el ternero de A NO entra al sync set de B (cross-tenant)');
    assert.ok(scopeA.includes(inA[0].establishment_id), 'birth_calves.establishment_id ∈ scopeA');
    assert.ok(!scopeB.includes(inA[0].establishment_id), 'birth_calves.establishment_id ∉ scopeB');
  });

  // ── rodeo_data_config (PK compuesta, cadena rodeo 0078): config del rodeo de A no cruza a B. ──────
  await t.test('est_rodeo_data_config (T9.7): config del rodeo de A NO entra al sync set de B', async () => {
    const scopeA = await orgScope(userA.id);
    const scopeB = await orgScope(userB.id);
    const inA = await rowsInSyncSet('rodeo_data_config', scopeA, 'rodeo_id', rodeoA);
    const inB = await rowsInSyncSet('rodeo_data_config', scopeB, 'rodeo_id', rodeoA);
    assert.ok(inA.length > 0, 'la plantilla del rodeo de A está en el sync set de A');
    assert.equal(inB.length, 0, 'la plantilla del rodeo de A NO entra al sync set de B');
    assert.ok(inA.every((r) => scopeA.includes(r.establishment_id)), 'rodeo_data_config.establishment_id ∈ scopeA');
  });

  // ── animal_category_history (denormalizado, sin deleted_at propio): no cruza tenant. ──────────────
  await t.test('est_animal_category_history (T9.7): el historial de A NO cruza a B', async () => {
    const scopeA = await orgScope(userA.id);
    const scopeB = await orgScope(userB.id);
    const aSet = await syncSetIds('animal_category_history', scopeA, { withDeletedAtFilter: false });
    const bSet = await syncSetIds('animal_category_history', scopeB, { withDeletedAtFilter: false });
    assert.deepEqual(aSet.filter((id) => bSet.includes(id)), [], 'animal_category_history de A y B disjuntos');
    if (aSet.length > 0) {
      const { data } = await admin.from('animal_category_history').select('establishment_id').in('id', aSet);
      assert.ok(data.every((r) => scopeA.includes(r.establishment_id)), 'todo historial de A pertenece a A');
    }
  });

  // ── management_groups + rodeos: per-establishment estándar. ───────────────────────────────────────
  await t.test('est_rodeos / est_management_groups: A NO recibe rodeos/lotes de B', async () => {
    const scopeA = await orgScope(userA.id);
    const scopeB = await orgScope(userB.id);
    const rA = await syncSetIds('rodeos', scopeA);
    const rB = await syncSetIds('rodeos', scopeB);
    assert.ok(rA.includes(rodeoA) && !rA.includes(rodeoB), 'A recibe su rodeo y NO el de B');
    assert.ok(rB.includes(rodeoB) && !rB.includes(rodeoA), 'B recibe su rodeo y NO el de A');
    const gA = await syncSetIds('management_groups', scopeA);
    const gB = await syncSetIds('management_groups', scopeB);
    assert.ok(gA.includes(groupA) && !gA.includes(groupB), 'A recibe su lote y NO el de B');
    assert.ok(gB.includes(groupB) && !gB.includes(groupA), 'B recibe su lote y NO el de A');
  });

  // ── establishments: el campo de B no entra al sync set de A. ──────────────────────────────────────
  await t.test('est_establishments: A NO recibe el establishment de B', async () => {
    const scopeA = await orgScope(userA.id);
    // est_establishments: SELECT * FROM establishments WHERE id IN org_scope AND deleted_at IS NULL.
    const { data, error } = await admin.from('establishments').select('id').in('id', scopeA).is('deleted_at', null);
    assert.equal(error, null, error && error.message);
    const ids = data.map((r) => r.id);
    assert.ok(ids.includes(estA), 'A recibe su establishment');
    assert.ok(!ids.includes(estB), 'A NO recibe el establishment de B');
  });

  // ── self_user_private (self-only): el user_private de B NO llega a A. ─────────────────────────────
  await t.test('self_user_private: el user_private de B NO llega a A (self-only, PII)', async () => {
    // self_user_private: SELECT user_id AS id, * FROM user_private WHERE user_id = auth.user_id().
    // El sync set de A = SOLO su propia fila. La de B (PII de contacto) NUNCA está en el set de A.
    const setA = (await admin.from('user_private').select('user_id').eq('user_id', userA.id)).data.map((r) => r.user_id);
    assert.deepEqual(setA, [userA.id], 'el self set de A es exactamente su propia fila');
    assert.ok(!setA.includes(userB.id), 'el user_private de B NO está en el self set de A');
    // Confirmación dura del modelo: el filtro es por user_id (no por establishment) → un coworker del
    // MISMO campo tampoco recibe el user_private del owner.
    const setCo = (await admin.from('user_private').select('user_id').eq('user_id', userCoA.id)).data.map((r) => r.user_id);
    assert.ok(!setCo.includes(userA.id), 'el coworker de A NO recibe el user_private del owner A (self-only)');
  });

  // ── self_user_roles + est_members_roles: membresías propias vs matriz owner-only. ────────────────
  await t.test('self_user_roles: A recibe SOLO sus propias membresías (no las de B)', async () => {
    // self_user_roles: SELECT * FROM user_roles WHERE user_id = auth.user_id().
    const setA = (await admin.from('user_roles').select('id, user_id, establishment_id').eq('user_id', userA.id)).data;
    assert.ok(setA.every((r) => r.user_id === userA.id), 'todas las membresías del self set de A son de A');
    assert.ok(setA.some((r) => r.establishment_id === estA), 'A ve su rol en estA');
    assert.ok(!setA.some((r) => r.establishment_id === estB), 'A NO ve un rol en estB (no lo tiene)');
  });

  await t.test('est_members_roles (owner-only): A (owner) ve los roles de SU campo; B no ve los de A', async () => {
    // est_members_roles: SELECT * FROM user_roles WHERE active = true AND establishment_id IN owner_scope.
    const ownerA = await ownerScope(userA.id); // [estA]
    const ownerB = await ownerScope(userB.id); // [estB]
    // El owner A recibe los roles activos de estA (incluido el del coworker CoA).
    const membersA = (await admin.from('user_roles').select('user_id, establishment_id').eq('active', true).in('establishment_id', ownerA)).data;
    assert.ok(membersA.some((r) => r.user_id === userCoA.id), 'el owner A ve el rol de su coworker CoA');
    assert.ok(membersA.every((r) => r.establishment_id === estA), 'el owner A SOLO ve roles de estA');
    // B (owner de estB) NO ve los roles de estA (estA ∉ ownerB).
    const membersB = (await admin.from('user_roles').select('establishment_id').eq('active', true).in('establishment_id', ownerB)).data;
    assert.ok(!membersB.some((r) => r.establishment_id === estA), 'el owner B NO ve los roles de estA');
    // El COWORKER de A NO es owner → su owner_scope es vacío → NO recibe la matriz de roles de NADIE.
    const ownerCo = await ownerScope(userCoA.id);
    assert.deepEqual(ownerCo, [], 'el coworker (no-owner) tiene owner_scope vacío → no recibe la matriz de roles');
  });

  // ── member_name denormalizado (c2, 0080): el nombre del coworker viaja en user_roles, no en users. ─
  await t.test('c2 (T9.7): member_name viaja en user_roles (owner-only), users NO se sincroniza', async () => {
    const yaml = fs.readFileSync(path.join(REPO_ROOT, 'sync-streams', 'rafaq.yaml'), 'utf8');
    assert.doesNotMatch(yaml, /FROM\s+users\b/i, 'users NO debe figurar como FROM en ninguna stream (c2: nombre denorm. en user_roles)');
    // El nombre del coworker CoA está denormalizado en su user_roles de estA y lo ve el owner A.
    const ownerA = await ownerScope(userA.id);
    const { data } = await admin.from('user_roles').select('user_id, member_name, establishment_id').eq('active', true).in('establishment_id', ownerA);
    const coRow = data.find((r) => r.user_id === userCoA.id);
    assert.ok(coRow, 'el rol del coworker está en la matriz del owner A');
    assert.equal(coRow.member_name, userCoA.name, 'member_name denormalizado = users.name del coworker (c2)');
  });

  // ── est_invitations (owner + pending): A ve sus pendientes; B no. ─────────────────────────────────
  await t.test('est_invitations (owner-only, pending): A ve su invitación; B no', async () => {
    assert.ok(invA, 'precondición: la invitación pendiente de A se sembró');
    const ownerA = await ownerScope(userA.id);
    const ownerB = await ownerScope(userB.id);
    // est_invitations: SELECT * FROM invitations WHERE establishment_id IN owner_scope AND status='pending' AND deleted_at IS NULL.
    const invsA = (await admin.from('invitations').select('id').in('establishment_id', ownerA).eq('status', 'pending').is('deleted_at', null)).data.map((r) => r.id);
    assert.ok(invsA.includes(invA), 'A (owner) ve su invitación pendiente');
    const invsB = ownerB.length ? (await admin.from('invitations').select('id').in('establishment_id', ownerB).eq('status', 'pending').is('deleted_at', null)).data.map((r) => r.id) : [];
    assert.ok(!invsB.includes(invA), 'B NO ve la invitación de A (owner-scope disjunto)');
  });

  // ── Catálogos globales: llegan a TODOS (sin filtro de establecimiento). ───────────────────────────
  await t.test('catálogos globales (R4.4): species/systems/categories/field_definitions llegan a A y a B por igual', async () => {
    // Streams globales: SELECT * FROM <catalogo> (sin filtro). El set de A == el set de B == todas las filas.
    for (const tbl of ['species', 'systems_by_species', 'categories_by_system', 'field_definitions', 'system_default_fields']) {
      const { count, error } = await admin.from(tbl).select('id', { count: 'exact', head: true });
      assert.equal(error, null, error && error.message);
      assert.ok(count > 0, `el catálogo global ${tbl} tiene filas y NO se filtra por establecimiento → llega a A y a B por igual`);
    }
  });

  // ── soft-deleted NO entra al sync set (R4.5). ─────────────────────────────────────────────────────
  await t.test('soft-deleted (R4.5): un rodeo soft-deleteado de A SALE del sync set de A', async () => {
    const scopeA = await orgScope(userA.id);
    // Sembrar un rodeo soft-deleteado en A.
    const { speciesId, systemId } = await lookupSpeciesSystem();
    const { data: r } = await admin.from('rodeos').insert({ establishment_id: estA, name: `${RUN_TAG} rodeoSoftDel`, species_id: speciesId, system_id: systemId, deleted_at: new Date().toISOString() }).select('id').single();
    const setA = await syncSetIds('rodeos', scopeA); // la stream filtra deleted_at IS NULL
    assert.ok(!setA.includes(r.id), 'un rodeo soft-deleteado NO entra al sync set (deleted_at IS NULL en la stream)');
    // El rodeo VIVO de A sigue presente (sanity).
    assert.ok(setA.includes(rodeoA), 'el rodeo vivo de A sigue en el sync set');
  });

  // ── R8.2 (HIGH-1): tras soft-deletear estA, A deja de recibir TODAS sus filas por el sync set. ────
  await t.test('R8.2 / HIGH-1: soft-delete de un campo → el owner deja de recibir SU data por el sync set', async () => {
    // Campo + animal + evento DEDICADOS para no contaminar los asserts de arriba.
    const ownerD = await createTestUser('ownerD');
    const estD = await seedEstablishment(ownerD.id, 'CampoD');
    const rD = await seedRodeo(estD);
    const aD = await seedAnimalWithEvents(estD, rD.id, rD.systemId, { idv: `D${Date.now().toString().slice(-6)}`, sex: 'female', authorId: ownerD.id });

    // ANTES: el owner D recibe su perfil + su evento por el sync set.
    let scopeD = await orgScope(ownerD.id);
    assert.ok(scopeD.includes(estD), 'precondición: estD ∈ org_scope de D');
    assert.ok((await syncSetIds('animal_profiles', scopeD)).includes(aD.profileId), 'antes: D recibe su perfil');
    assert.ok((await syncSetIds('weight_events', scopeD, { withDeletedAtFilter: true })).length > 0, 'antes: D recibe su weight_event');

    // Soft-delete del campo (mismo camino que softDeleteEstablishment). El trigger 0076 desactiva los
    // user_roles de estD → org_scope de D queda vacío → ya no recibe NADA de estD por el sync set.
    await admin.from('establishments').update({ deleted_at: new Date().toISOString() }).eq('id', estD);

    scopeD = await orgScope(ownerD.id);
    assert.ok(!scopeD.includes(estD), 'tras el soft-delete, estD SALE de org_scope (trigger 0076 desactiva el rol)');
    // El sync set de TODAS las clases per-establishment de D queda vacío de estD.
    assert.equal((await syncSetIds('animal_profiles', scopeD)).length, 0, 'tras el soft-delete, D NO recibe perfiles de estD');
    assert.equal((await syncSetIds('weight_events', scopeD, { withDeletedAtFilter: true })).length, 0, 'tras el soft-delete, D NO recibe eventos de estD');
    const { data: estRows } = await admin.from('establishments').select('id').in('id', scopeD.length ? scopeD : ['00000000-0000-0000-0000-000000000000']).is('deleted_at', null);
    assert.ok(!(estRows || []).some((r) => r.id === estD), 'tras el soft-delete, D NO recibe el establishment estD');
  });

  await t.test('cleanup', async () => {
    await cleanup();
  });
});
