// supabase/tests/reports/run.cjs
// Suite NO-BYPASS del backend de Stream C (spec 07 — reportes / analytics): las 9 RPC SQL SECURITY DEFINER de
// 0106_reports_rpcs.sql. Corre contra la base REMOTA: service_role para fixtures, JWTs reales para los asserts
// de RLS/authz. Mismo patrón que supabase/tests/puesta-en-servicio/run.cjs.
//
// Cubre (tasks.md T1.3/T2.5/T2.6/T3.2/T4.3 + design §5):
//   - TR.1  session_event_summary: conteo por tipo, excluye borrados (R7.3.3), sesión active (R7.3.4),
//            vacía → 7 kinds con 0 (R7.3.5), INCLUYE archivados (R7.13.2), anti-IDOR (R7.12.3), grants.
//   - TR.2  rodeo_sessions_list: lista del rodeo desc + conteo autoritativo, tenant-scope.
//   - TR.3  rodeo_pregnancy_kpi: pregnant = tacto+ vigente; empty; absolutos; serviced=0 sin NaN (R7.5.4);
//            is_configured=false sin service_months (R7.5.6); cota p_year.
//   - TR.4  rodeo_calving_kpi: calved por mes de concepción ∈ service_months (R7.6.2) incl. WRAP (R7.5.8);
//            pregnant ≥ calved (pérdida, base única servidas R7.6.4); serviced=0 sin NaN (R7.6.3).
//   - TR.4b rodeo_calving_kpi delta #8 (RPF.1-4/8): status no_service_months (D3) / not_calving_season (D2) /
//            ok (D1/D2) / not_applicable_12m (D5, precede a la ventana) + pending_pregnant (D4). calved/
//            pregnant/pending_pregnant se computan SIEMPRE; status gatea solo el display.
//   - TR.5  rodeo_ccl_distribution: head/body/tail del último tacto+ vigente; total; empty total=0 (R7.7.4).
//   - TR.6  rodeo_calving_by_stage: nacimientos por tercio; total_born=0 degrada (R7.8.3); 1/12 → todo 0.
//   - TR.7  rodeo_weight_by_category: AVG último peso por categoría, excluye borrados (R7.9.3), categoría sin
//            peso ausente (R7.9.4), n_animals; variante por sesión (R7.9.5).
//   - TR.8  establishment_overdue_doses: detecta vencida + excluye con dosis posterior (R7.10.1), excluye
//            archivados/borrados (R7.10.3); cota de escaneo M4 (ventana p_lookback_days + LIMIT; 22023 fuera
//            de rango); IDOR M1 (42501, no vacío).
//   - TR.9  establishment_unweighed: nunca-pesado + umbral + p_category_codes (R7.11.1/.2/.3); cota M4
//            (p_threshold_days [0,3650], cardinality ≤64 → 22023); IDOR M1 (42501).
//   - TR.11 rodeo_weaning_kpi delta #10 (RWK.1-9): status no_service_months (D5) / not_applicable_12m (D5,
//            precede) / not_weaning_season (D3, weaned=0 DATA-DRIVEN) / ok (D1) + weaned/pending_weaning (D2/D4)
//            imputados por AÑO DE SERVICIO (concepción ∈ ventana, incl. WRAP; weaning en año calendario
//            siguiente pero contado en la campaña de origen) + mellizos (weaned>serviced, %>100%) + soft-delete
//            del weaning (vuelve a pending) + IDOR (42501) + cota p_year (22023) + rodeo inexistente (P0002).
//            ROJA-HASTA-APPLY de la migración 0118 (la aplica el LEADER por MCP).
//   - TR.10 transversal: anon/public sin EXECUTE en las 10 (incl. rodeo_weaning_kpi); read-only; tenant-iso A↮B.
//
// 🔴 ROJA-HASTA-APPLY: la migración 0106 NO está aplicada (el deploy lo gatea el LEADER por CLI/Management-API
// + autorización de Raf, patrón Stream A 0102-0105). Hasta entonces ESTA SUITE FALLA — es ESPERADO (mismo
// patrón 0075-0082 / 0093-0097 / puesta-en-servicio). El hook en scripts/run-tests.mjs queda COMENTADO; el
// leader lo DESCOMENTA al aplicar (la suite verde post-apply confirma el contrato no-bypass / authz / KPIs).
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

const RUN_TAG = `rep_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

// ---- helpers de fixtures (mismo patrón que puesta-en-servicio/run.cjs) ----

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
  const { error: insErr } = await userClient
    .from('establishments').insert({ name, province: 'Buenos Aires' });
  if (insErr) throw new Error(`createEstablishment insert(${name}): ${insErr.message}`);
  const { data, error } = await userClient
    .from('establishments').select('id').eq('name', name).single();
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function assignRoleAsService(userId, establishmentId, role) {
  const { error } = await admin
    .from('user_roles').insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
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
    establishment_id: establishmentId, name, species_id: speciesId, system_id: systemId,
  });
  if (insErr) throw new Error(`createRodeo insert(${name}): ${insErr.message}`);
  const { data, error } = await client
    .from('rodeos').select('id, system_id').eq('establishment_id', establishmentId).eq('name', name).single();
  if (error) throw new Error(`createRodeo select(${name}): ${error.message}`);
  return { id: data.id, systemId: data.system_id };
}

async function setServiceMonths(rodeoId, months) {
  const { error } = await admin.from('rodeos').update({ service_months: months }).eq('id', rodeoId);
  if (error) throw new Error(`setServiceMonths(${rodeoId}): ${error.message}`);
}

// Crea un animal + perfil. Devuelve { profile:{id, category_id}, animalId }.
async function createAnimal(client, { idv = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null, status = 'active' }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = crypto.randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (birthDate) animalPayload.birth_date = birthDate;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) throw new Error(`createAnimal animals: ${aErr.message}`);

  const catId = await categoryId(client, systemId, categoryCode || (sex === 'male' ? 'torito' : 'vaquillona'));
  const profileId = crypto.randomUUID();
  const profilePayload = {
    id: profileId, animal_id: animalId, establishment_id: establishmentId,
    rodeo_id: rodeoId, category_id: catId, status,
    // override para que los triggers de categoría no muevan la categoría sembrada bajo nuestros pies.
    category_override: true,
  };
  if (idv) profilePayload.idv = idv;
  // IDU: visual_id_alt eliminado (0122). Un perfil sin idv/tag persiste (trigger de completitud dropeado).
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) throw new Error(`createAnimal profile: ${pErr.message}`);
  return { profile: { id: profileId, category_id: catId }, animalId };
}

// archiva un perfil (sold) directo por service_role (sin pasar por las reglas de baja del cliente).
async function archiveProfile(profileId) {
  const { error } = await admin.from('animal_profiles')
    .update({ status: 'sold', exit_reason: 'sale', exit_date: daysAgo(1) }).eq('id', profileId);
  if (error) throw new Error(`archiveProfile(${profileId}): ${error.message}`);
}

async function createSession(client, { establishmentId, rodeoId, status = 'active', workLot = null }) {
  const id = crypto.randomUUID();
  const payload = { id, establishment_id: establishmentId, rodeo_id: rodeoId, status };
  if (workLot) payload.work_lot_label = workLot;
  const { error } = await client.from('sessions').insert(payload);
  if (error) throw new Error(`createSession: ${error.message}`);
  return id;
}

// ── Helpers de DESTETE (delta #10/TR.11): sembrar el vínculo madre → parto → birth_calves → cría → weaning.
// Un parto MONO se siembra insertando un reproductive_events {event_type:'birth', calf_sex} → el trigger
// mono-ternero (0045/0032, SECURITY DEFINER) crea la cría + la fila birth_calves EN LA MISMA TX. Se lee la
// cría vía admin (service_role) porque birth_calves es select-only para el cliente y poblada server-side.
async function seedBirthWithCalf(client, { motherProfileId, eventDate, calfSex = 'male' }) {
  const { error: insErr } = await client.from('reproductive_events').insert({
    animal_profile_id: motherProfileId, event_type: 'birth', event_date: eventDate, calf_sex: calfSex,
  });
  if (insErr) throw new Error(`seedBirthWithCalf insert: ${insErr.message}`);
  const { data: ev, error: evErr } = await client.from('reproductive_events')
    .select('id').eq('animal_profile_id', motherProfileId).eq('event_type', 'birth').eq('event_date', eventDate)
    .order('created_at', { ascending: false }).limit(1).single();
  if (evErr) throw new Error(`seedBirthWithCalf select ev: ${evErr.message}`);
  const { data: bc } = await eventually(
    async () => await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', ev.id),
    (res) => res && Array.isArray(res.data) && res.data.length >= 1,
  );
  return { birthEventId: ev.id, calfProfileIds: (bc || []).map((r) => r.calf_profile_id) };
}

// Parto de MELLIZOS vía register_birth (0116, SECURITY DEFINER): crea N crías + N filas birth_calves. Inserta
// el parto con calf_sex NULL (el trigger mono NO actúa) → register_birth arma las crías él mismo.
async function seedRegisterBirth(client, { motherProfileId, eventDate, calves }) {
  const { data: birthId, error } = await client.rpc('register_birth', {
    p_mother_profile_id: motherProfileId, p_event_date: eventDate, p_calves: calves,
  });
  if (error) throw new Error(`seedRegisterBirth: ${error.message}`);
  const { data: bc } = await eventually(
    async () => await admin.from('birth_calves').select('calf_profile_id').eq('birth_event_id', birthId),
    (res) => res && Array.isArray(res.data) && res.data.length >= calves.length,
  );
  return { birthEventId: birthId, calfProfileIds: (bc || []).map((r) => r.calf_profile_id) };
}

// Destete de una cría: inserta un reproductive_events {event_type:'weaning'} SOBRE el perfil de la CRÍA
// (animal_profile_id = ternero, como en buildAddWeaningInsert). Devuelve el id del evento (para soft-delete).
async function seedWeaning(client, calfProfileId, eventDate) {
  const { error } = await client.from('reproductive_events').insert({
    animal_profile_id: calfProfileId, event_type: 'weaning', event_date: eventDate,
  });
  if (error) throw new Error(`seedWeaning: ${error.message}`);
  const { data, error: selErr } = await client.from('reproductive_events')
    .select('id').eq('animal_profile_id', calfProfileId).eq('event_type', 'weaning')
    .order('created_at', { ascending: false }).limit(1).single();
  if (selErr) throw new Error(`seedWeaning select: ${selErr.message}`);
  return data.id;
}

function pgcode(error) {
  return String((error && (error.code || '')) + ' ' + (error && (error.message || '')));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function eventually(fn, predicate, { tries = 8, delay = 400 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(delay);
  }
  return last;
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function thisYear() { return new Date().getFullYear(); }
// fecha AAAA-MM-15 en un mes/año dado.
function dateOn(year, month, day = 15) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function cleanup() {
  if (createdEstablishmentIds.length > 0) {
    const { data: profs } = await admin
      .from('animal_profiles').select('id, animal_id').in('establishment_id', createdEstablishmentIds);
    const profileIds = (profs || []).map((r) => r.id);
    const animalIds = [...new Set((profs || []).map((r) => r.animal_id))];
    if (profileIds.length > 0) {
      await admin.from('reproductive_events').delete().in('animal_profile_id', profileIds);
      await admin.from('weight_events').delete().in('animal_profile_id', profileIds);
      await admin.from('sanitary_events').delete().in('animal_profile_id', profileIds);
      await admin.from('condition_score_events').delete().in('animal_profile_id', profileIds);
      await admin.from('lab_samples').delete().in('animal_profile_id', profileIds);
      await admin.from('scrotal_measurements').delete().in('animal_profile_id', profileIds);
      await admin.from('custom_measurements').delete().in('animal_profile_id', profileIds);
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

// fila única de un RPC que devuelve TABLE de un solo row.
function row1(data) {
  return Array.isArray(data) ? data[0] : data;
}

// =====================================================================
// Suite
// =====================================================================

test('reports suite — spec 07 Stream C (RPC de reportes)', async (t) => {
  let userA, userB, userField, clientA, clientB, clientField, estA, estB;

  await t.test('setup: usuarios, establishments', async () => {
    userA = await createTestUser('userA');       // owner estA
    userB = await createTestUser('userB');       // owner estB
    userField = await createTestUser('userField'); // field_operator en estA
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);
    await assignRoleAsService(userField.id, estA, 'field_operator');
    clientField = await getUserClient(userField.email);
    assert.ok(estA && estB);
  });

  // =====================================================================
  // TR.1 — session_event_summary — R7.3
  // =====================================================================
  await t.test('TR.1 session_event_summary: conteo por tipo, borrados, archivados, vacía, IDOR', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R sess' });
    const sess = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'active' });

    // animal activo + animal que vamos a archivar (R7.13.2: archivado IGUAL cuenta en el histórico de sesión).
    const a1 = await createAnimal(clientA, { idv: `${RUN_TAG}_s1`, sex: 'female', birthDate: daysAgo(800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const a2 = await createAnimal(clientA, { idv: `${RUN_TAG}_s2`, sex: 'female', birthDate: daysAgo(800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });

    // eventos: 2 weight (a1, a2) + 1 sanitary (a1) + 1 weight borrado (a1, NO debe contar).
    await clientA.from('weight_events').insert({ animal_profile_id: a1.profile.id, session_id: sess, weight_kg: 400, weight_date: daysAgo(1) });
    await clientA.from('weight_events').insert({ animal_profile_id: a2.profile.id, session_id: sess, weight_kg: 420, weight_date: daysAgo(1) });
    await clientA.from('sanitary_events').insert({ animal_profile_id: a1.profile.id, session_id: sess, event_type: 'vaccination', product_name: 'Vacuna X', event_date: daysAgo(1) });
    // weight borrado:
    const delW = crypto.randomUUID();
    await clientA.from('weight_events').insert({ id: delW, animal_profile_id: a2.profile.id, session_id: sess, weight_kg: 999, weight_date: daysAgo(1) });
    await admin.from('weight_events').update({ deleted_at: new Date().toISOString() }).eq('id', delW);

    // archivar a2 → su evento SIGUE contando (R7.13.2).
    await archiveProfile(a2.profile.id);

    const { data, error } = await eventually(
      async () => await clientA.rpc('session_event_summary', { p_session_id: sess }),
      (res) => res && res.data && Array.isArray(res.data) && res.data.length === 7 && (res.data.find((x) => x.event_kind === 'weight')?.event_count ?? 0) >= 2,
    );
    assert.equal(error, null, error ? `session_event_summary: ${error.message}` : 'ejecutó');
    const byKind = new Map((data || []).map((x) => [x.event_kind, x]));
    assert.equal(data.length, 7, 'devuelve los 7 kinds (R7.3.5: 0 incluido)');
    assert.equal(byKind.get('weight').event_count, 2, 'weight: 2 (el borrado NO cuenta, R7.3.3; archivado SÍ, R7.13.2)');
    assert.equal(byKind.get('weight').animals, 2, 'weight: 2 animales distintos (a1 + a2 archivado)');
    assert.equal(byKind.get('sanitary').event_count, 1, 'sanitary: 1');
    assert.equal(byKind.get('reproductive').event_count, 0, 'reproductive: 0 (sin eventos → kind igual aparece)');
    assert.equal(byKind.get('custom').event_count, 0, 'custom: 0');

    // sesión VACÍA (active) → 7 kinds con 0 (R7.3.4/.5).
    const sessEmpty = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'active' });
    const { data: empty } = await clientA.rpc('session_event_summary', { p_session_id: sessEmpty });
    assert.equal((empty || []).length, 7, 'sesión vacía → 7 kinds');
    assert.ok((empty || []).every((x) => x.event_count === 0 && x.animals === 0), 'sesión vacía → todos 0 (R7.3.5)');

    // anti-IDOR: owner B no lee el resumen de una sesión de A → 42501 (NO vacío silencioso, R7.12.3).
    const idor = await clientB.rpc('session_event_summary', { p_session_id: sess });
    assert.notEqual(idor.error, null, 'owner B no lee la sesión de A');
    assert.match(pgcode(idor.error), /42501|not authorized/i);

    // sesión inexistente → P0002.
    const ghost = await clientA.rpc('session_event_summary', { p_session_id: crypto.randomUUID() });
    assert.match(pgcode(ghost.error), /P0002|not found/i, 'sesión inexistente → error');

    // field_operator de A (cualquier rol) SÍ lee (reportes).
    const fr = await clientField.rpc('session_event_summary', { p_session_id: sess });
    assert.equal(fr.error, null, fr.error ? `field lee: ${fr.error.message}` : 'field_operator de A lee el resumen (R7.12.1)');
  });

  // =====================================================================
  // TR.2 — rodeo_sessions_list — R7.3.6
  // =====================================================================
  await t.test('TR.2 rodeo_sessions_list: lista desc + conteo + tenant-scope', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R list' });
    const s1 = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'closed', workLot: 'Lote 1' });
    await sleep(50);
    const s2 = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'active', workLot: 'Lote 2' });
    const a1 = await createAnimal(clientA, { idv: `${RUN_TAG}_l1`, sex: 'female', birthDate: daysAgo(800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    await clientA.from('weight_events').insert({ animal_profile_id: a1.profile.id, session_id: s2, weight_kg: 410, weight_date: daysAgo(1) });

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_sessions_list', { p_rodeo_id: r.id }),
      (res) => res && res.data && res.data.length >= 2,
    );
    assert.equal(error, null, error ? `rodeo_sessions_list: ${error.message}` : 'ejecutó');
    const ids = (data || []).map((x) => x.id);
    assert.ok(ids.includes(s1) && ids.includes(s2), 'lista incluye ambas sesiones');
    // order by started_at desc: s2 (más nueva) antes que s1.
    assert.ok(ids.indexOf(s2) < ids.indexOf(s1), 'orden desc por started_at (más reciente primero, R7.3.6)');
    const rowS2 = (data || []).find((x) => x.id === s2);
    assert.equal(rowS2.event_count, 1, 's2 tiene 1 evento (conteo autoritativo)');
    assert.equal(rowS2.animal_count, 1, 's2 tiene 1 animal');

    // tenant: owner B no lista las sesiones del rodeo de A.
    const idor = await clientB.rpc('rodeo_sessions_list', { p_rodeo_id: r.id });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lista sesiones de A');
  });

  // =====================================================================
  // TR.3 — rodeo_pregnancy_kpi — R7.5
  // =====================================================================
  await t.test('TR.3 rodeo_pregnancy_kpi: pregnant/empty/absolutos, serviced=0, is_configured, p_year', async () => {
    const year = thisYear();
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R preg' });
    await setServiceMonths(r.id, [11]); // servicio en noviembre

    // 3 multíparas servidas (probadamente servidas, sin gate). 2 preñadas (tacto+ vigente), 1 con tacto empty.
    const m1 = await createAnimal(clientA, { idv: `${RUN_TAG}_pg1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const m2 = await createAnimal(clientA, { idv: `${RUN_TAG}_pg2`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const m3 = await createAnimal(clientA, { idv: `${RUN_TAG}_pg3`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    // m1, m2 preñadas; m3 tacto empty.
    await clientA.from('reproductive_events').insert({ animal_profile_id: m1.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 10), pregnancy_status: 'large' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: m2.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 10), pregnancy_status: 'medium' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: m3.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 10), pregnancy_status: 'empty' });

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).serviced >= 3,
    );
    assert.equal(error, null, error ? `pregnancy_kpi: ${error.message}` : 'ejecutó');
    const k = row1(data);
    assert.equal(k.is_configured, true, 'is_configured true (service_months seteado, R7.5.6)');
    assert.equal(k.serviced, 3, 'serviced = 3 (las 3 multíparas)');
    assert.equal(k.pregnant, 2, 'pregnant = 2 (tacto+ vigente, RT2.7.5, R7.5.2)');
    assert.equal(k.empty, 1, 'empty = 1 (último tacto = empty)');
    assert.ok(k.entoradas <= k.serviced, 'entoradas <= serviced (denominador explícito)');

    // un aborto posterior al tacto+ de m1 → m1 deja de contar como preñada (tacto+ vigente revertido).
    await clientA.from('reproductive_events').insert({ animal_profile_id: m1.profile.id, event_type: 'abortion', event_date: dateOn(year, 12, 20) });
    const { data: data2 } = await eventually(
      async () => await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).pregnant === 1,
    );
    assert.equal(row1(data2).pregnant, 1, 'aborto posterior revierte tacto+ → pregnant baja a 1 (R7.5.2)');

    // serviced = 0 (rodeo sin animales servidos) → la RPC devuelve serviced=0, sin NaN (R7.5.4).
    const rEmpty = await createRodeo(clientA, { establishmentId: estA, name: 'R preg0' });
    await setServiceMonths(rEmpty.id, [11]);
    const { data: zero } = await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: rEmpty.id, p_year: year });
    assert.equal(row1(zero).serviced, 0, 'rodeo sin servidas → serviced=0 (la UI muestra "—", la RPC no divide, R7.5.4)');
    assert.equal(row1(zero).pregnant, 0, 'pregnant=0 sin NaN');

    // rodeo sin service_months → is_configured=false (R7.5.6).
    const rNoCfg = await createRodeo(clientA, { establishmentId: estA, name: 'R preg-nocfg' });
    const { data: noCfg } = await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: rNoCfg.id, p_year: year });
    assert.equal(row1(noCfg).is_configured, false, 'rodeo sin service_months → is_configured=false (R7.5.6)');

    // cota p_year (R7.5.10) → 22023.
    const future = await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: r.id, p_year: year + 5 });
    assert.match(pgcode(future.error), /out of range|22023/i, 'p_year fuera de rango → 22023');

    // IDOR: owner B no lee el KPI del rodeo de A.
    const idor = await clientB.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: r.id, p_year: year });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lee pregnancy_kpi de A');
  });

  // =====================================================================
  // TR.4 — rodeo_calving_kpi — R7.6 (incl. wrap R7.5.8)
  // =====================================================================
  await t.test('TR.4 rodeo_calving_kpi: calved por mes de concepción ∈ service_months + WRAP + pregnant>=calved', async () => {
    const year = thisYear();
    // WRAP: servicio Nov-Dic-Ene {11,12,1}. La campaña p_year = esos meses TAL COMO CAEN en el año calendario
    // p_year (set-membership, NO un rango contiguo Nov(year)→Ene(year+1); espejo de cómo Stream A define
    // servidas — R7.5.8). Por eso: concepción Nov(year) → parto Ago(year+1); concepción Ene(year) → parto
    // Oct(year) [el MISMO año, no el siguiente: Ene+9meses=Oct del mismo año].
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R calv-wrap' });
    await setServiceMonths(r.id, [11, 12, 1]);

    const c1 = await createAnimal(clientA, { idv: `${RUN_TAG}_cv1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const c2 = await createAnimal(clientA, { idv: `${RUN_TAG}_cv2`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const c3 = await createAnimal(clientA, { idv: `${RUN_TAG}_cv3`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });

    // c1: birth en Ago(year+1) → concepción Nov(year) (∈ {11,12,1}, año p_year) → CUENTA.
    await clientA.from('reproductive_events').insert({ animal_profile_id: c1.profile.id, event_type: 'birth', event_date: dateOn(year + 1, 8, 15) });
    // c2: birth en Oct(year) → concepción Ene(year) (∈ {11,12,1}, WRAP, MISMO año p_year) → CUENTA.
    await clientA.from('reproductive_events').insert({ animal_profile_id: c2.profile.id, event_type: 'birth', event_date: dateOn(year, 10, 15) });
    // c3: birth en Marzo(year+1) → concepción Junio(year) (NO ∈ {11,12,1}) → NO cuenta.
    await clientA.from('reproductive_events').insert({ animal_profile_id: c3.profile.id, event_type: 'birth', event_date: dateOn(year + 1, 3, 15) });

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).serviced >= 3,
    );
    assert.equal(error, null, error ? `calving_kpi: ${error.message}` : 'ejecutó');
    const k = row1(data);
    assert.equal(k.serviced, 3, 'serviced = 3');
    assert.equal(k.calved, 2, 'calved = 2 (c1 Nov + c2 Ene-WRAP; c3 Jun fuera de la campaña, R7.6.2/R7.5.8)');

    // pregnant >= calved (pérdida preñez→parición visible comparando, base única servidas R7.6.4).
    // marcamos c1 y c2 con tacto+ vigente → pregnant=2 >= calved=2.
    await clientA.from('reproductive_events').insert({ animal_profile_id: c1.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 20), pregnancy_status: 'large' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: c2.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 20), pregnancy_status: 'medium' });
    const { data: data2 } = await eventually(
      async () => await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).pregnant >= 2,
    );
    assert.ok(row1(data2).pregnant >= row1(data2).calved, 'pregnant >= calved (pérdida, R7.6.4)');

    // serviced=0 → calved=0 sin NaN (R7.6.3).
    const rEmpty = await createRodeo(clientA, { establishmentId: estA, name: 'R calv0' });
    await setServiceMonths(rEmpty.id, [11]);
    const { data: zero } = await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rEmpty.id, p_year: year });
    assert.equal(row1(zero).serviced, 0, 'serviced=0');
    assert.equal(row1(zero).calved, 0, 'calved=0 sin NaN (R7.6.3)');

    // IDOR.
    const idor = await clientB.rpc('rodeo_calving_kpi', { p_rodeo_id: r.id, p_year: year });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lee calving_kpi de A');
  });

  // =====================================================================
  // TR.4b — rodeo_calving_kpi: status (D1/D2/D3/D5) + pending_pregnant (D4) — delta #8 (RPF.1-4/8)
  // =====================================================================
  // Fechas RELATIVAS a new Date() (determinismo del CI, design §5): la ventana de parto = min(mes servicio +
  // 9 meses). Para forzar 'ok' (ventana ya pasada) uso p_year=lastYear con service_months=[1] → ventana =
  // Ene(lastYear)+9mo = Oct(lastYear), SIEMPRE en el pasado. Para 'not_calving_season' uso [mesActual] con
  // p_year=thisYear → ventana = mesActual+9, SIEMPRE futura. status gatea SOLO el display: calved/pregnant/
  // pending_pregnant se computan igual (asserts de conteo válidos sin importar la fecha del CI).
  await t.test('TR.4b calving_kpi status: no_service_months / not_calving_season / ok / not_applicable_12m + pending_pregnant', async () => {
    const year = thisYear();
    const lastYear = year - 1;
    const thisMonth = new Date().getMonth() + 1; // 1..12

    // ── RPF.8.1 — service_months NULL o {} → status='no_service_months' (D3), NO un %/0% engañoso. ──
    const rNull = await createRodeo(clientA, { establishmentId: estA, name: 'R st-null' });
    // (sin setServiceMonths → service_months NULL = "sin configurar")
    const { data: dNull, error: eNull } = await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rNull.id, p_year: year });
    assert.equal(eNull, null, eNull ? `st-null: ${eNull.message}` : 'ejecutó');
    assert.equal(row1(dNull).status, 'no_service_months', 'service_months NULL → no_service_months (RPF.1.1)');

    const rEmptyM = await createRodeo(clientA, { establishmentId: estA, name: 'R st-empty' });
    await setServiceMonths(rEmptyM.id, []); // {} = "no hace servicio" (pasa el CHECK 0102: cardinality 0)
    const { data: dEmpty } = await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rEmptyM.id, p_year: year });
    assert.equal(row1(dEmpty).is_configured, true, 'service_months {} → is_configured=true (distinto de NULL, RPF.1 nota)');
    assert.equal(row1(dEmpty).status, 'no_service_months', 'service_months {} → no_service_months (RPF.1.1)');

    // ── RPF.8.2 — service_months=[mesActual], p_year=thisYear → ventana +9 futura → not_calving_season (D2). ──
    const rFut = await createRodeo(clientA, { establishmentId: estA, name: 'R st-future' });
    await setServiceMonths(rFut.id, [thisMonth]);
    const { data: dFut } = await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rFut.id, p_year: year });
    assert.equal(row1(dFut).status, 'not_calving_season', 'ventana de parto futura → not_calving_season (RPF.2.2)');

    // ── RPF.8.4 — los 12 meses → not_applicable_12m (D5); PRECEDE a la ventana (RPF.3.2). ──
    const r12 = await createRodeo(clientA, { establishmentId: estA, name: 'R st-12m' });
    await setServiceMonths(r12.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const { data: d12 } = await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: r12.id, p_year: year });
    assert.equal(row1(d12).status, 'not_applicable_12m', '12 meses → not_applicable_12m (RPF.3.1)');

    // ── RPF.8.3 — ventana +9 YA pasada + parto ∈ ventana → status='ok' + calved correcto (D1/D2). ──
    // service_months=[1] (Enero), p_year=lastYear → ventana = Ene(lastYear)+9mo = Oct(lastYear), en el PASADO.
    const rOk = await createRodeo(clientA, { establishmentId: estA, name: 'R st-ok' });
    await setServiceMonths(rOk.id, [1]);
    const ok1 = await createAnimal(clientA, { idv: `${RUN_TAG}_ok1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rOk.id, establishmentId: estA, systemId: rOk.systemId, categoryCode: 'multipara' });
    // parto Oct(lastYear) → concepción Ene(lastYear) (∈ {1}, año lastYear) → CUENTA.
    await clientA.from('reproductive_events').insert({ animal_profile_id: ok1.profile.id, event_type: 'birth', event_date: dateOn(lastYear, 10, 15) });
    const { data: dOk } = await eventually(
      async () => await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rOk.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).calved >= 1,
    );
    assert.equal(row1(dOk).status, 'ok', 'ventana de parto ya pasada → status=ok (RPF.2.3)');
    assert.equal(row1(dOk).serviced, 1, 'serviced=1 (la multipara)');
    assert.equal(row1(dOk).calved, 1, 'calved=1 (parto Oct → concepción Ene ∈ {1} lastYear, RPF.5.2)');

    // ── RPF.8.5 — pending_pregnant: 2 preñadas vigentes, 1 con parto contado → pending=1; agregar el 2º → 0. ──
    const rPp = await createRodeo(clientA, { establishmentId: estA, name: 'R st-pp' });
    await setServiceMonths(rPp.id, [1]); // Enero → misma ventana ya pasada con lastYear (status ok)
    const pp1 = await createAnimal(clientA, { idv: `${RUN_TAG}_pp1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rPp.id, establishmentId: estA, systemId: rPp.systemId, categoryCode: 'multipara' });
    const pp2 = await createAnimal(clientA, { idv: `${RUN_TAG}_pp2`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rPp.id, establishmentId: estA, systemId: rPp.systemId, categoryCode: 'multipara' });
    // ambas preñadas VIGENTES (último tacto+ <> empty, sin aborto posterior).
    await clientA.from('reproductive_events').insert({ animal_profile_id: pp1.profile.id, event_type: 'tacto', event_date: dateOn(lastYear, 2, 10), pregnancy_status: 'large' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: pp2.profile.id, event_type: 'tacto', event_date: dateOn(lastYear, 2, 10), pregnancy_status: 'medium' });
    // pp1 con parto CONTADO (concepción Ene(lastYear) ∈ {1}); pp2 sin parto todavía.
    await clientA.from('reproductive_events').insert({ animal_profile_id: pp1.profile.id, event_type: 'birth', event_date: dateOn(lastYear, 10, 15) });
    const { data: dPp } = await eventually(
      async () => await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rPp.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).pregnant >= 2 && row1(res.data).calved >= 1,
    );
    assert.equal(row1(dPp).pregnant, 2, 'pregnant=2 (ambas tacto+ vigente)');
    assert.equal(row1(dPp).calved, 1, 'calved=1 (solo pp1 con parto contado)');
    assert.equal(row1(dPp).pending_pregnant, 1, 'pending_pregnant=1 (pp2 preñada SIN parto contado, RPF.4.1)');

    // agregar el parto de pp2 (concepción Ene ∈ {1}) → todas las preñadas parieron → pending_pregnant=0.
    await clientA.from('reproductive_events').insert({ animal_profile_id: pp2.profile.id, event_type: 'birth', event_date: dateOn(lastYear, 10, 20) });
    const { data: dPp0 } = await eventually(
      async () => await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: rPp.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).calved >= 2,
    );
    assert.equal(row1(dPp0).calved, 2, 'calved=2 (ambas parieron)');
    assert.equal(row1(dPp0).pending_pregnant, 0, 'pending_pregnant=0 (ninguna preñada sin parir, RPF.4.3)');
  });

  // =====================================================================
  // TR.11 — rodeo_weaning_kpi: status (D3/D5) + weaned/pending_weaning (D1/D2/D4) — delta #10 (RWK.1-9)
  // =====================================================================
  // Fechas RELATIVAS a new Date() (determinismo del CI, design §5). El %destete NO depende de la fecha del
  // test (a diferencia de #8): not_weaning_season es DATA-DRIVEN (weaned=0), no date-driven. Uso p_year=lastYear
  // con service_months que dan una ventana de concepción en el pasado, y siembro el vínculo servida → parto
  // (birth_calves via el trigger mono / register_birth para mellizos) → cría → weaning. La imputación es por AÑO
  // DE SERVICIO: el weaning cae ~6mo tras el parto (año calendario siguiente) pero se cuenta en la campaña de
  // ORIGEN de la cría (RWK.2.2) → los destetes los sello en lastYear+1 a propósito.
  await t.test('TR.11 weaning_kpi: no_service_months / not_applicable_12m / not_weaning_season / ok + weaned/pending_weaning + wrap + mellizos + IDOR', async () => {
    const year = thisYear();
    const lastYear = year - 1;

    // ── RWK.9.1 — service_months NULL o {} → status='no_service_months' (D5), weaned/pending=0. ──
    const rNull = await createRodeo(clientA, { establishmentId: estA, name: 'W st-null' });
    const { data: dNull, error: eNull } = await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rNull.id, p_year: year });
    assert.equal(eNull, null, eNull ? `W st-null: ${eNull.message}` : 'ejecutó');
    assert.equal(row1(dNull).status, 'no_service_months', 'service_months NULL → no_service_months (RWK.5.1)');
    assert.equal(row1(dNull).weaned, 0, 'weaned=0 sin partos (RWK.1.4)');
    assert.equal(row1(dNull).pending_weaning, 0, 'pending_weaning=0 sin partos');

    const rEmptyM = await createRodeo(clientA, { establishmentId: estA, name: 'W st-empty' });
    await setServiceMonths(rEmptyM.id, []); // {} = "no hace servicio" (pasa el CHECK 0102: cardinality 0)
    const { data: dEmpty } = await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rEmptyM.id, p_year: year });
    assert.equal(row1(dEmpty).is_configured, true, 'service_months {} → is_configured=true (distinto de NULL)');
    assert.equal(row1(dEmpty).status, 'no_service_months', 'service_months {} → no_service_months (RWK.5.1)');

    // ── RWK.9.2 — los 12 meses → not_applicable_12m (D5); PRECEDE a not_weaning_season (RWK.5.3). ──
    // weaned=0 acá: si el 12m NO precediera, caería en not_weaning_season → la aserción prueba la precedencia.
    const r12 = await createRodeo(clientA, { establishmentId: estA, name: 'W st-12m' });
    await setServiceMonths(r12.id, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const { data: d12 } = await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: r12.id, p_year: year });
    assert.equal(row1(d12).status, 'not_applicable_12m', '12 meses → not_applicable_12m, precede a not_weaning_season (RWK.5.2/5.3)');

    // ── RWK.9.3 — campaña con partos (concepción ∈ ventana ya pasada) pero SIN destete → not_weaning_season,
    // weaned=0, pending_weaning>=1 (la cría al pie, D4). ──
    const rNws = await createRodeo(clientA, { establishmentId: estA, name: 'W st-nws' });
    await setServiceMonths(rNws.id, [1]); // Enero → ventana ya pasada con lastYear
    const nwsM = await createAnimal(clientA, { idv: `${RUN_TAG}_nws1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rNws.id, establishmentId: estA, systemId: rNws.systemId, categoryCode: 'multipara' });
    // parto Oct(lastYear) → concepción Ene(lastYear) (∈ {1}, año lastYear) → cría de la campaña. SIN weaning.
    await seedBirthWithCalf(clientA, { motherProfileId: nwsM.profile.id, eventDate: dateOn(lastYear, 10, 15) });
    const { data: dNws } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rNws.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).pending_weaning >= 1,
    );
    assert.equal(row1(dNws).status, 'not_weaning_season', 'partos sin destete → not_weaning_season (RWK.3.2)');
    assert.equal(row1(dNws).weaned, 0, 'weaned=0 (ninguna cría destetada, RWK.3.2)');
    assert.ok(row1(dNws).pending_weaning >= 1, 'pending_weaning>=1 (cría de la campaña al pie, RWK.3.1)');

    // ── RWK.9.4 — destetar la cría de la campaña → status='ok', weaned correcto (incl. WRAP). El weaning se
    // sella en lastYear+1 (año calendario siguiente al parto) pero se imputa a la campaña lastYear (RWK.2.2). ──
    const rOk = await createRodeo(clientA, { establishmentId: estA, name: 'W st-ok-wrap' });
    await setServiceMonths(rOk.id, [11, 12, 1]); // WRAP
    const okM = await createAnimal(clientA, { idv: `${RUN_TAG}_wok1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rOk.id, establishmentId: estA, systemId: rOk.systemId, categoryCode: 'multipara' });
    // parto Oct(lastYear) → concepción Ene(lastYear) (∈ {11,12,1}, WRAP, MISMO año lastYear) → cuenta.
    const okBirth = await seedBirthWithCalf(clientA, { motherProfileId: okM.profile.id, eventDate: dateOn(lastYear, 10, 15) });
    await seedWeaning(clientA, okBirth.calfProfileIds[0], dateOn(lastYear + 1, 4, 15)); // destete ~6mo tras el parto
    const { data: dOk } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rOk.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).weaned >= 1,
    );
    assert.equal(row1(dOk).status, 'ok', 'cría destetada de la campaña → status=ok (RWK.3.4)');
    assert.equal(row1(dOk).serviced, 1, 'serviced=1 (la multipara)');
    assert.equal(row1(dOk).weaned, 1, 'weaned=1 (cría destetada, concepción Ene ∈ {11,12,1} WRAP, RWK.2.1)');
    assert.equal(row1(dOk).pending_weaning, 0, 'pending_weaning=0 (todas destetadas, RWK.3.1)');

    // ── RWK.9.5 — pending_weaning: 2 crías de la campaña, 1 destetada → weaned=1/pending=1; destetar la 2ª →
    // weaned=2/pending=0; soft-delete del weaning de la 1ª → weaned=1/pending=1 (RWK.2.4/3.1). ──
    const rPw = await createRodeo(clientA, { establishmentId: estA, name: 'W st-pending' });
    await setServiceMonths(rPw.id, [1]);
    const pwA = await createAnimal(clientA, { idv: `${RUN_TAG}_pwA`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rPw.id, establishmentId: estA, systemId: rPw.systemId, categoryCode: 'multipara' });
    const pwB = await createAnimal(clientA, { idv: `${RUN_TAG}_pwB`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rPw.id, establishmentId: estA, systemId: rPw.systemId, categoryCode: 'multipara' });
    const pwBirthA = await seedBirthWithCalf(clientA, { motherProfileId: pwA.profile.id, eventDate: dateOn(lastYear, 10, 15) });
    const pwBirthB = await seedBirthWithCalf(clientA, { motherProfileId: pwB.profile.id, eventDate: dateOn(lastYear, 10, 16) });
    // destetar SOLO la cría de pwA.
    const weanA = await seedWeaning(clientA, pwBirthA.calfProfileIds[0], dateOn(lastYear + 1, 4, 15));
    const { data: dPw1 } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rPw.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).weaned >= 1,
    );
    assert.equal(row1(dPw1).weaned, 1, 'weaned=1 (solo la cría de pwA destetada, RWK.3.1)');
    assert.equal(row1(dPw1).pending_weaning, 1, 'pending_weaning=1 (la cría de pwB al pie, RWK.3.1)');
    // destetar la 2ª.
    await seedWeaning(clientA, pwBirthB.calfProfileIds[0], dateOn(lastYear + 1, 4, 20));
    const { data: dPw2 } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rPw.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).weaned >= 2,
    );
    assert.equal(row1(dPw2).weaned, 2, 'weaned=2 (ambas destetadas)');
    assert.equal(row1(dPw2).pending_weaning, 0, 'pending_weaning=0 (ninguna al pie)');
    // soft-delete del weaning de pwA → la cría VUELVE a pending (RWK.2.4: un weaning borrado no cuenta).
    await admin.from('reproductive_events').update({ deleted_at: new Date().toISOString() }).eq('id', weanA);
    const { data: dPw3 } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rPw.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).weaned <= 1,
    );
    assert.equal(row1(dPw3).weaned, 1, 'weaned=1 tras soft-delete del weaning de pwA (RWK.2.4)');
    assert.equal(row1(dPw3).pending_weaning, 1, 'pending_weaning=1 (la cría de pwA vuelve al pie, RWK.2.4)');

    // ── RWK.9.6 — imputación por campaña: un parto cuya concepción cae FUERA de service_months NO aporta ni a
    // weaned ni a pending_weaning; + mellizos (2 crías destetadas de 1 servida → weaned=2 > serviced=1, %>100%). ──
    const rOut = await createRodeo(clientA, { establishmentId: estA, name: 'W st-outside' });
    await setServiceMonths(rOut.id, [1]); // solo Enero
    const outM = await createAnimal(clientA, { idv: `${RUN_TAG}_out1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rOut.id, establishmentId: estA, systemId: rOut.systemId, categoryCode: 'multipara' });
    // parto Jun(lastYear) → concepción Sep(lastYear-1) (mes 9 ∉ {1}) → FUERA de la campaña. Aunque se deste-
    // te, NO aporta a weaned ni a pending.
    const outBirth = await seedBirthWithCalf(clientA, { motherProfileId: outM.profile.id, eventDate: dateOn(lastYear, 6, 15) });
    await seedWeaning(clientA, outBirth.calfProfileIds[0], dateOn(lastYear, 12, 15));
    const { data: dOut } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rOut.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).serviced >= 1,
    );
    assert.equal(row1(dOut).weaned, 0, 'parto fuera de service_months → NO aporta a weaned (RWK.2.1)');
    assert.equal(row1(dOut).pending_weaning, 0, 'parto fuera de service_months → tampoco a pending_weaning (RWK.3.1)');

    const rMel = await createRodeo(clientA, { establishmentId: estA, name: 'W st-mellizos' });
    await setServiceMonths(rMel.id, [1]);
    const melM = await createAnimal(clientA, { idv: `${RUN_TAG}_mel1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rMel.id, establishmentId: estA, systemId: rMel.systemId, categoryCode: 'multipara' });
    // parto de MELLIZOS Oct(lastYear) → concepción Ene(lastYear) ∈ {1} → 2 crías de la campaña, de 1 servida.
    // Ambas crías MACHO ('ternero') a propósito: rodeo_serviced_females filtra a.sex='female' → una cría macho
    // NUNCA infla `serviced` (una cría HEMBRA destetada se promueve a 'vaquillona' por compute_category y, si
    // la corre >365 días, entraría al fallback de servidas → non-determinismo por fecha del CI). Con machos,
    // serviced=1 es determinístico sin importar cuándo corra el leader la suite post-apply.
    const twins = await seedRegisterBirth(clientA, {
      motherProfileId: melM.profile.id, eventDate: dateOn(lastYear, 10, 15),
      calves: [{ calf_sex: 'male' }, { calf_sex: 'male' }],
    });
    assert.equal(twins.calfProfileIds.length, 2, 'register_birth de mellizos crea 2 filas birth_calves');
    await seedWeaning(clientA, twins.calfProfileIds[0], dateOn(lastYear + 1, 4, 15));
    await seedWeaning(clientA, twins.calfProfileIds[1], dateOn(lastYear + 1, 4, 16));
    const { data: dMel } = await eventually(
      async () => await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rMel.id, p_year: lastYear }),
      (res) => res && res.data && row1(res.data) && row1(res.data).weaned >= 2,
    );
    assert.equal(row1(dMel).serviced, 1, 'serviced=1 (la única multipara; las crías ternero macho no cuentan)');
    assert.equal(row1(dMel).weaned, 2, 'weaned=2 (2 crías destetadas de 1 servida — mellizos, RWK.2.3/9.6)');
    assert.equal(row1(dMel).pending_weaning, 0, 'pending_weaning=0 (ambas crías destetadas)');
    assert.ok(row1(dMel).weaned > row1(dMel).serviced, '%destete puede exceder 100% con mellizos (D1/RWK.1.3)');

    // ── RWK.9.7 — IDOR: owner B pide el weaning_kpi de un rodeo de A → 42501 (no un set vacío silencioso). ──
    const idor = await clientB.rpc('rodeo_weaning_kpi', { p_rodeo_id: rOk.id, p_year: lastYear });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lee weaning_kpi de A (RWK.6.2/9.7)');

    // cota de p_year (RWK.6.3): fuera de rango → 22023.
    const badYear = await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: rOk.id, p_year: 1800 });
    assert.match(pgcode(badYear.error), /22023/i, 'p_year<1900 → 22023 (RWK.6.3)');
    // rodeo inexistente (RWK.6.4): P0002.
    const ghostR = await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: crypto.randomUUID(), p_year: lastYear });
    assert.match(pgcode(ghostR.error), /P0002|not found|42501/i, 'rodeo inexistente → P0002 (RWK.6.4)');
  });

  // =====================================================================
  // TR.5 — rodeo_ccl_distribution — R7.7
  // =====================================================================
  await t.test('TR.5 rodeo_ccl_distribution: head/body/tail + total + empty total=0', async () => {
    const year = thisYear();
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R ccl' });
    await setServiceMonths(r.id, [10, 11, 12]); // 3 meses → tercios

    // 3 preñadas large/medium/small + 1 empty.
    const seedPreg = async (label, status) => {
      const a = await createAnimal(clientA, { idv: `${RUN_TAG}_${label}`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: a.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 10), pregnancy_status: status });
      return a;
    };
    await seedPreg('ccl_h', 'large');
    await seedPreg('ccl_b', 'medium');
    await seedPreg('ccl_t', 'small');
    await seedPreg('ccl_e', 'empty');

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_ccl_distribution', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).total >= 3,
    );
    assert.equal(error, null, error ? `ccl: ${error.message}` : 'ejecutó');
    const k = row1(data);
    assert.equal(k.n_months, 3, 'n_months=3 (de rodeo_service_campaign, R7.7.2)');
    assert.equal(k.head, 1, 'head=1 (large)');
    assert.equal(k.body, 1, 'body=1 (medium)');
    assert.equal(k.tail, 1, 'tail=1 (small)');
    assert.equal(k.total, 3, 'total=3 (solo preñadas, la empty NO cuenta, R7.7.5)');

    // sin preñeces con tamaño → total=0 (R7.7.4).
    const rEmpty = await createRodeo(clientA, { establishmentId: estA, name: 'R ccl0' });
    await setServiceMonths(rEmpty.id, [10, 11, 12]);
    const { data: zero } = await clientA.rpc('rodeo_ccl_distribution', { p_rodeo_id: rEmpty.id, p_year: year });
    assert.equal(row1(zero).total, 0, 'sin preñeces → total=0 (la UI muestra empty state, R7.7.4)');

    const idor = await clientB.rpc('rodeo_ccl_distribution', { p_rodeo_id: r.id, p_year: year });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lee ccl de A');
  });

  // =====================================================================
  // TR.6 — rodeo_calving_by_stage — R7.8
  // =====================================================================
  await t.test('TR.6 rodeo_calving_by_stage: nacimientos por tercio + total_born=0 degrada + 1mes→0', async () => {
    const year = thisYear();
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R stage' });
    await setServiceMonths(r.id, [10, 11, 12]); // Oct/Nov/Dic → tercios: Oct=cabeza, Nov=cuerpo, Dic=cola

    // un parto por etapa: concepción Oct (parto Jul year+1) cabeza; Nov (parto Ago) cuerpo; Dic (parto Sep) cola.
    const seedBirth = async (label, birthMonth, birthYear) => {
      const a = await createAnimal(clientA, { idv: `${RUN_TAG}_${label}`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: a.profile.id, event_type: 'birth', event_date: dateOn(birthYear, birthMonth, 15) });
      return a;
    };
    await seedBirth('st_h', 7, year + 1);  // concepción Oct → cabeza
    await seedBirth('st_b', 8, year + 1);  // concepción Nov → cuerpo
    await seedBirth('st_t', 9, year + 1);  // concepción Dic → cola

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_calving_by_stage', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).total_born >= 3,
    );
    assert.equal(error, null, error ? `calving_by_stage: ${error.message}` : 'ejecutó');
    const k = row1(data);
    assert.equal(k.n_months, 3, 'n_months=3');
    assert.equal(k.head_born, 1, 'head_born=1 (concepción Oct, R7.8.1)');
    assert.equal(k.body_born, 1, 'body_born=1 (concepción Nov)');
    assert.equal(k.tail_born, 1, 'tail_born=1 (concepción Dic)');
    assert.equal(k.total_born, 3, 'total_born=3');

    // campaña sin nacimientos → total_born=0 degrada (R7.8.3).
    const rEmpty = await createRodeo(clientA, { establishmentId: estA, name: 'R stage0' });
    await setServiceMonths(rEmpty.id, [10, 11, 12]);
    const { data: zero } = await clientA.rpc('rodeo_calving_by_stage', { p_rodeo_id: rEmpty.id, p_year: year });
    assert.equal(row1(zero).total_born, 0, 'sin nacimientos → total_born=0 (R7.8.3)');

    // rodeo de 1 mes → sin distinción → todo 0 (espejo de pregnancy-buckets).
    const r1 = await createRodeo(clientA, { establishmentId: estA, name: 'R stage1mes' });
    await setServiceMonths(r1.id, [11]);
    const a1 = await createAnimal(clientA, { idv: `${RUN_TAG}_st1m`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r1.id, establishmentId: estA, systemId: r1.systemId, categoryCode: 'multipara' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: a1.profile.id, event_type: 'birth', event_date: dateOn(year + 1, 8, 15) });
    const { data: one } = await eventually(
      async () => await clientA.rpc('rodeo_calving_by_stage', { p_rodeo_id: r1.id, p_year: year }),
      (res) => res && res.data && row1(res.data),
    );
    assert.equal(row1(one).n_months, 1, '1 mes de servicio');
    assert.equal(row1(one).total_born, 0, '1 mes → sin distinción → total_born=0 (la UI no muestra el cruce)');

    const idor = await clientB.rpc('rodeo_calving_by_stage', { p_rodeo_id: r.id, p_year: year });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lee calving_by_stage de A');
  });

  // =====================================================================
  // TR.7 — rodeo_weight_by_category — R7.9
  // =====================================================================
  await t.test('TR.7 rodeo_weight_by_category: AVG último peso por categoría, borrados, sin peso, por sesión', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R weight' });
    // 2 multíparas con peso (último): 400 y 500 → AVG 450; 1 vaquillona sin peso (no aparece).
    const w1 = await createAnimal(clientA, { idv: `${RUN_TAG}_w1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const w2 = await createAnimal(clientA, { idv: `${RUN_TAG}_w2`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    await createAnimal(clientA, { idv: `${RUN_TAG}_w3`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    // w1: dos pesos, el último (más reciente) = 400; uno viejo = 300 (no debe contar).
    await clientA.from('weight_events').insert({ animal_profile_id: w1.profile.id, weight_kg: 300, weight_date: daysAgo(30) });
    await clientA.from('weight_events').insert({ animal_profile_id: w1.profile.id, weight_kg: 400, weight_date: daysAgo(1) });
    // w2: 500 + un borrado 999.
    await clientA.from('weight_events').insert({ animal_profile_id: w2.profile.id, weight_kg: 500, weight_date: daysAgo(1) });
    const delW = crypto.randomUUID();
    await clientA.from('weight_events').insert({ id: delW, animal_profile_id: w2.profile.id, weight_kg: 999, weight_date: new Date().toISOString().slice(0, 10) });
    await admin.from('weight_events').update({ deleted_at: new Date().toISOString() }).eq('id', delW);

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_weight_by_category', { p_rodeo_id: r.id }),
      (res) => res && res.data && (res.data.find((x) => x.category_code === 'multipara')?.n_animals ?? 0) >= 2,
    );
    assert.equal(error, null, error ? `weight_by_category: ${error.message}` : 'ejecutó');
    const mult = (data || []).find((x) => x.category_code === 'multipara');
    assert.ok(mult, 'categoría multipara presente');
    assert.equal(mult.n_animals, 2, 'n_animals=2 (R7.9.2)');
    assert.equal(Number(mult.avg_weight), 450, 'AVG = (400+500)/2 = 450 (último peso, borrado excluido, R7.9.1/.3)');
    // vaquillona sin peso → NO aparece (la UI la marca "sin pesar", R7.9.4).
    assert.ok(!(data || []).some((x) => x.category_code === 'vaquillona'), 'categoría sin peso ausente (R7.9.4)');

    // variante por sesión (comparativa R7.9.5): solo los pesos de esa sesión.
    const sess = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'active' });
    await clientA.from('weight_events').insert({ animal_profile_id: w1.profile.id, session_id: sess, weight_kg: 410, weight_date: new Date().toISOString().slice(0, 10) });
    const { data: bySession } = await eventually(
      async () => await clientA.rpc('rodeo_weight_by_category', { p_rodeo_id: r.id, p_session_id: sess }),
      (res) => res && res.data && (res.data.find((x) => x.category_code === 'multipara')?.n_animals ?? 0) >= 1,
    );
    const multS = (bySession || []).find((x) => x.category_code === 'multipara');
    assert.equal(multS.n_animals, 1, 'por sesión → solo w1 (el único con peso en la sesión, R7.9.5)');
    assert.equal(Number(multS.avg_weight), 410, 'por sesión → AVG = 410 (el peso de la sesión)');

    // p_session_id de OTRO rodeo → 42501 (defensa anti-IDOR del parámetro opcional).
    const rOther = await createRodeo(clientA, { establishmentId: estA, name: 'R weight-other' });
    const sessOther = await createSession(clientA, { establishmentId: estA, rodeoId: rOther.id, status: 'active' });
    const crossSess = await clientA.rpc('rodeo_weight_by_category', { p_rodeo_id: r.id, p_session_id: sessOther });
    assert.match(pgcode(crossSess.error), /42501|not authorized/i, 'p_session_id de otro rodeo → 42501');

    const idor = await clientB.rpc('rodeo_weight_by_category', { p_rodeo_id: r.id });
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'owner B no lee pesos de A');
  });

  // =====================================================================
  // TR.8 — establishment_overdue_doses — R7.10 (M1 IDOR + M4 cota)
  // =====================================================================
  await t.test('TR.8 establishment_overdue_doses: vencida, dosis posterior, archivados, cota M4, IDOR M1', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R doses' });
    const a1 = await createAnimal(clientA, { idv: `${RUN_TAG}_d1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const a2 = await createAnimal(clientA, { idv: `${RUN_TAG}_d2`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const a3 = await createAnimal(clientA, { idv: `${RUN_TAG}_d3`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const a4 = await createAnimal(clientA, { idv: `${RUN_TAG}_d4`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });

    // a1: dosis vencida (next_dose_date hace 10 días, mismo producto sin posterior) → APARECE.
    await clientA.from('sanitary_events').insert({ animal_profile_id: a1.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(200), next_dose_date: daysAgo(10) });
    // a2: una Aftosa con next_dose hace 40 días (vencida), PERO una Aftosa POSTERIOR cuyo next_dose está en el
    // FUTURO (re-vacunada, schedule empujado adelante) → a2 NO aparece (la primera vencida está cubierta por la
    // posterior, y la posterior NO está vencida) (R7.10.1).
    await clientA.from('sanitary_events').insert({ animal_profile_id: a2.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(200), next_dose_date: daysAgo(40) });
    await clientA.from('sanitary_events').insert({ animal_profile_id: a2.profile.id, event_type: 'vaccination', product_name: 'Aftosa', event_date: daysAgo(20), next_dose_date: daysFromNow(60) });
    // a3: vencida MUY VIEJA (hace 500 días) → fuera de la ventana default (365) → NO aparece (M4 cota).
    await clientA.from('sanitary_events').insert({ animal_profile_id: a3.profile.id, event_type: 'vaccination', product_name: 'Carbunclo', event_date: daysAgo(900), next_dose_date: daysAgo(500) });
    // a4: vencida hace 10 días pero el ANIMAL se archiva → NO aparece (R7.10.3).
    await clientA.from('sanitary_events').insert({ animal_profile_id: a4.profile.id, event_type: 'vaccination', product_name: 'Mancha', event_date: daysAgo(200), next_dose_date: daysAgo(10) });
    await archiveProfile(a4.profile.id);

    const { data, error } = await eventually(
      async () => await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA }),
      (res) => res && res.data && res.data.some((x) => x.animal_profile_id === a1.profile.id),
    );
    assert.equal(error, null, error ? `overdue_doses: ${error.message}` : 'ejecutó');
    const ids = new Set((data || []).map((x) => x.animal_profile_id));
    assert.ok(ids.has(a1.profile.id), 'a1 (vencida sin posterior) APARECE (R7.10.1)');
    assert.ok(!ids.has(a2.profile.id), 'a2 (con dosis posterior del mismo producto) NO aparece (R7.10.1)');
    assert.ok(!ids.has(a3.profile.id), 'a3 (vencida más vieja que la ventana 365) NO aparece (M4 cota de escaneo)');
    assert.ok(!ids.has(a4.profile.id), 'a4 (animal archivado) NO aparece (R7.10.3)');
    const rowA1 = (data || []).find((x) => x.animal_profile_id === a1.profile.id);
    assert.equal(rowA1.product_name, 'Aftosa', 'el ítem identifica el producto (R7.10.2)');
    assert.ok(rowA1.idv, 'el ítem identifica el animal (idv, R7.10.2)');

    // M4: con una ventana corta (p_lookback_days=5) la dosis de a1 (vencida hace 10) NO entra.
    const { data: shortWin } = await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA, p_lookback_days: 5 });
    assert.ok(!(shortWin || []).some((x) => x.animal_profile_id === a1.profile.id), 'ventana corta (5d) excluye a a1 (vencida hace 10, M4)');

    // M4: con una ventana amplia (600) a3 SÍ entra (vencida hace 500).
    const { data: wideWin } = await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA, p_lookback_days: 600 });
    assert.ok((wideWin || []).some((x) => x.animal_profile_id === a3.profile.id), 'ventana amplia (600d) incluye a a3 (M4)');

    // M4: p_lookback_days < 0 → 22023; p_limit fuera de [1,1000] → 22023.
    const badLB = await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA, p_lookback_days: -1 });
    assert.match(pgcode(badLB.error), /22023/i, 'p_lookback_days<0 → 22023 (M4)');
    const badLimitHi = await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA, p_limit: 5000 });
    assert.match(pgcode(badLimitHi.error), /22023/i, 'p_limit>1000 → 22023 (M4)');
    const badLimitLo = await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA, p_limit: 0 });
    assert.match(pgcode(badLimitLo.error), /22023/i, 'p_limit<1 → 22023 (M4)');

    // M4: LIMIT respeta el tope (p_limit=1 → como mucho 1 fila).
    const { data: limited } = await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA, p_lookback_days: 600, p_limit: 1 });
    assert.ok((limited || []).length <= 1, 'p_limit=1 → como mucho 1 fila (M4 LIMIT server-side)');

    // M1 IDOR: owner B pide overdue_doses de est_A → 42501 (NO un set vacío silencioso, R7.12.3).
    const idor = await clientB.rpc('establishment_overdue_doses', { p_establishment_id: estA });
    assert.notEqual(idor.error, null, 'owner B con est_A → debe ser rechazado (M1)');
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'M1: IDOR → 42501, no vacío');
  });

  // =====================================================================
  // TR.9 — establishment_unweighed — R7.11 (M1 IDOR + M4 cota)
  // =====================================================================
  await t.test('TR.9 establishment_unweighed: nunca-pesado, umbral, p_category_codes, cota M4, IDOR M1', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R unw' });
    // u1: nunca pesado (vaquillona) → APARECE.
    const u1 = await createAnimal(clientA, { idv: `${RUN_TAG}_u1`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    // u2: pesado hace 200 días (> umbral 180) → APARECE.
    const u2 = await createAnimal(clientA, { idv: `${RUN_TAG}_u2`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    await clientA.from('weight_events').insert({ animal_profile_id: u2.profile.id, weight_kg: 300, weight_date: daysAgo(200) });
    // u3: pesado hace 10 días (< umbral) → NO aparece.
    const u3 = await createAnimal(clientA, { idv: `${RUN_TAG}_u3`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    await clientA.from('weight_events').insert({ animal_profile_id: u3.profile.id, weight_kg: 320, weight_date: daysAgo(10) });
    // u4: nunca pesado pero ARCHIVADO → NO aparece (R7.11.4).
    const u4 = await createAnimal(clientA, { idv: `${RUN_TAG}_u4`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    await archiveProfile(u4.profile.id);
    // u5: nunca pesado, categoría multipara (para probar el filtro p_category_codes).
    const u5 = await createAnimal(clientA, { idv: `${RUN_TAG}_u5`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });

    const { data, error } = await eventually(
      async () => await clientA.rpc('establishment_unweighed', { p_establishment_id: estA }),
      (res) => res && res.data && res.data.some((x) => x.animal_profile_id === u1.profile.id),
    );
    assert.equal(error, null, error ? `unweighed: ${error.message}` : 'ejecutó');
    const byId = new Map((data || []).map((x) => [x.animal_profile_id, x]));
    assert.ok(byId.has(u1.profile.id), 'u1 nunca pesado APARECE (R7.11.1)');
    assert.equal(byId.get(u1.profile.id).days_since, null, 'u1 nunca pesado → days_since null (R7.11.3)');
    assert.equal(byId.get(u1.profile.id).last_weight_date, null, 'u1 nunca pesado → last_weight_date null');
    assert.ok(byId.has(u2.profile.id), 'u2 (pesaje hace 200 > 180) APARECE (R7.11.1)');
    assert.ok(byId.get(u2.profile.id).days_since >= 180, 'u2 days_since >= 180 (R7.11.3)');
    assert.ok(!byId.has(u3.profile.id), 'u3 (pesaje reciente < 180) NO aparece');
    assert.ok(!byId.has(u4.profile.id), 'u4 (archivado) NO aparece (R7.11.4)');

    // p_category_codes: solo 'multipara' → u5 aparece, las vaquillonas NO (R7.11.2).
    const { data: byCat } = await clientA.rpc('establishment_unweighed', { p_establishment_id: estA, p_category_codes: ['multipara'] });
    const catIds = new Set((byCat || []).map((x) => x.animal_profile_id));
    assert.ok(catIds.has(u5.profile.id), 'filtro multipara → u5 aparece (R7.11.2)');
    assert.ok(!catIds.has(u1.profile.id), 'filtro multipara → u1 (vaquillona) NO aparece (R7.11.2)');

    // umbral más alto (p_threshold_days=365) → u2 (200d) ya NO aparece.
    const { data: hiThresh } = await clientA.rpc('establishment_unweighed', { p_establishment_id: estA, p_threshold_days: 365 });
    assert.ok(!(hiThresh || []).some((x) => x.animal_profile_id === u2.profile.id), 'umbral 365 → u2 (200d) NO aparece');
    assert.ok((hiThresh || []).some((x) => x.animal_profile_id === u1.profile.id), 'umbral 365 → u1 nunca pesado SIGUE apareciendo');

    // M4: p_threshold_days fuera de [0,3650] → 22023.
    const badLo = await clientA.rpc('establishment_unweighed', { p_establishment_id: estA, p_threshold_days: -1 });
    assert.match(pgcode(badLo.error), /22023/i, 'p_threshold_days<0 → 22023 (M4)');
    const badHi = await clientA.rpc('establishment_unweighed', { p_establishment_id: estA, p_threshold_days: 4000 });
    assert.match(pgcode(badHi.error), /22023/i, 'p_threshold_days>3650 → 22023 (M4)');
    // M4: cardinality(p_category_codes) > 64 → 22023.
    const bigArr = Array.from({ length: 65 }, (_, i) => `cat_${i}`);
    const badCard = await clientA.rpc('establishment_unweighed', { p_establishment_id: estA, p_category_codes: bigArr });
    assert.match(pgcode(badCard.error), /22023/i, 'cardinality(p_category_codes)>64 → 22023 (M4/L1)');

    // M1 IDOR: owner B con est_A → 42501 (no vacío).
    const idor = await clientB.rpc('establishment_unweighed', { p_establishment_id: estA });
    assert.notEqual(idor.error, null, 'owner B con est_A → rechazado (M1)');
    assert.match(pgcode(idor.error), /42501|not authorized/i, 'M1: IDOR → 42501, no vacío');
  });

  // =====================================================================
  // TR.10 — transversal: grants (anon/public sin EXECUTE) + read-only + tenant-isolation
  // =====================================================================
  await t.test('TR.10 grants: anon/public NO ejecutan ninguna de las 10 RPC', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const ghost = crypto.randomUUID();
    const calls = [
      ['session_event_summary', { p_session_id: ghost }],
      ['rodeo_sessions_list', { p_rodeo_id: ghost }],
      ['rodeo_pregnancy_kpi', { p_rodeo_id: ghost, p_year: thisYear() }],
      ['rodeo_calving_kpi', { p_rodeo_id: ghost, p_year: thisYear() }],
      // delta #10/RWK.9.7: la RPC NUEVA rodeo_weaning_kpi también debe estar revocada de anon/public (default
      // Postgres = EXECUTE a PUBLIC → el revoke de la 0118 es OBLIGATORIO).
      ['rodeo_weaning_kpi', { p_rodeo_id: ghost, p_year: thisYear() }],
      ['rodeo_ccl_distribution', { p_rodeo_id: ghost, p_year: thisYear() }],
      ['rodeo_calving_by_stage', { p_rodeo_id: ghost, p_year: thisYear() }],
      ['rodeo_weight_by_category', { p_rodeo_id: ghost }],
      ['establishment_overdue_doses', { p_establishment_id: ghost }],
      ['establishment_unweighed', { p_establishment_id: ghost }],
    ];
    for (const [fn, args] of calls) {
      const { error } = await anon.rpc(fn, args);
      assert.notEqual(error, null, `${fn}: anon NO debe poder ejecutar (R7.12.4)`);
      // PostgREST devuelve 404 (función no expuesta a anon) o 401/permission denied — cualquiera prueba el revoke.
      assert.match(pgcode(error), /permission denied|not find|does not exist|404|401|PGRST/i, `${fn}: anon rechazado (revoke)`);
    }
  });

  await t.test('TR.10 read-only: las RPC no mutan filas + tenant-isolation A↮B', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R ro' });
    await setServiceMonths(r.id, [11]);
    const a = await createAnimal(clientA, { idv: `${RUN_TAG}_ro`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    await clientA.from('weight_events').insert({ animal_profile_id: a.profile.id, weight_kg: 400, weight_date: daysAgo(1) });

    const { count: pc0 } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
    const { count: wc0 } = await admin.from('weight_events').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
    // llamadas repetidas a todas las RPC de rodeo + alertas.
    await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: r.id, p_year: thisYear() });
    await clientA.rpc('rodeo_calving_kpi', { p_rodeo_id: r.id, p_year: thisYear() });
    await clientA.rpc('rodeo_weaning_kpi', { p_rodeo_id: r.id, p_year: thisYear() }); // delta #10: read-only
    await clientA.rpc('rodeo_ccl_distribution', { p_rodeo_id: r.id, p_year: thisYear() });
    await clientA.rpc('rodeo_calving_by_stage', { p_rodeo_id: r.id, p_year: thisYear() });
    await clientA.rpc('rodeo_weight_by_category', { p_rodeo_id: r.id });
    await clientA.rpc('establishment_overdue_doses', { p_establishment_id: estA });
    await clientA.rpc('establishment_unweighed', { p_establishment_id: estA });
    const { count: pc1 } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
    const { count: wc1 } = await admin.from('weight_events').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
    assert.equal(pc1, pc0, 'las RPC no crean/borran perfiles (read-only)');
    assert.equal(wc1, wc0, 'las RPC no crean/borran pesos (read-only)');

    // tenant-isolation: el agregado de A no incluye nada de B (B no tiene datos en el rodeo de A; y B no
    // puede ni siquiera invocar las RPC de A — ya cubierto por los IDOR de arriba). Aquí confirmamos que el
    // overdue_doses de estB (vacío legítimo: B no tiene dosis) NO trae nada de A.
    const { data: bDoses, error: bErr } = await clientB.rpc('establishment_overdue_doses', { p_establishment_id: estB });
    assert.equal(bErr, null, bErr ? `B lee su propio est: ${bErr.message}` : 'B lee su propio establecimiento');
    assert.equal((bDoses || []).length, 0, 'el overdue_doses de B (sin datos) NO filtra datos de A (tenant-isolation)');
  });

  await t.test('cleanup', async () => {
    await cleanup();
  });
});
