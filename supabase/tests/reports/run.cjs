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
//   - TR.5  rodeo_ccl_distribution: head/body/tail del último tacto+ vigente; total; empty total=0 (R7.7.4).
//   - TR.6  rodeo_calving_by_stage: nacimientos por tercio; total_born=0 degrada (R7.8.3); 1/12 → todo 0.
//   - TR.7  rodeo_weight_by_category: AVG último peso por categoría, excluye borrados (R7.9.3), categoría sin
//            peso ausente (R7.9.4), n_animals; variante por sesión (R7.9.5).
//   - TR.8  establishment_overdue_doses: detecta vencida + excluye con dosis posterior (R7.10.1), excluye
//            archivados/borrados (R7.10.3); cota de escaneo M4 (ventana p_lookback_days + LIMIT; 22023 fuera
//            de rango); IDOR M1 (42501, no vacío).
//   - TR.9  establishment_unweighed: nunca-pesado + umbral + p_category_codes (R7.11.1/.2/.3); cota M4
//            (p_threshold_days [0,3650], cardinality ≤64 → 22023); IDOR M1 (42501).
//   - TR.10 transversal: anon/public sin EXECUTE en las 9; read-only; tenant-isolation A↮B.
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
async function createAnimal(client, { idv = null, visualAlt = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null, status = 'active' }) {
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
  if (visualAlt) profilePayload.visual_id_alt = visualAlt;
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
  await t.test('TR.10 grants: anon/public NO ejecutan ninguna de las 9 RPC', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const ghost = crypto.randomUUID();
    const calls = [
      ['session_event_summary', { p_session_id: ghost }],
      ['rodeo_sessions_list', { p_rodeo_id: ghost }],
      ['rodeo_pregnancy_kpi', { p_rodeo_id: ghost, p_year: thisYear() }],
      ['rodeo_calving_kpi', { p_rodeo_id: ghost, p_year: thisYear() }],
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
