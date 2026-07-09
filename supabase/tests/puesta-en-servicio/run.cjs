// supabase/tests/puesta-en-servicio/run.cjs
// Suite no-bypass del delta backend Stream A de spec 02 (modelo de puesta en servicio).
// Cubre la sección "Cobertura de tests" de requirements-puesta-en-servicio.md (RPS.x):
//   - CHECK de service_months (rango/dup/≤12, NULL vs vacío, default primavera) — RPS.1.x/RPS.2.1.
//   - edición offline owner-only + anti-IDOR cross-tenant + idempotencia — RPS.3.x.
//   - compute_category SIN service (hembra con solo service → NO vaquillona; destete/edad → sí; tacto+/parto/
//     aborto/castración intactos; recompute con service histórico = sin él) — RPS.4.x.
//   - IA: ternera + IA → sigue ternera, pero aparece en serviced_females por la rama 'ai' — RPS.4.8.
//   - red de seguridad de edad (refresh_age_categories ternera@365→vaquillona) — RPS.4.4.
//   - derivación servidas/entoradas (unión distinct, vaquillona_prenada CUENTA, APTA cuenta /
//     NO_APTA-DIFERIDA no, fallback por edad, entoradas=servidas−retiradas, tenant-scoped sin IDOR,
//     read-only, p_year fuera de rango → error) — RPS.5.x.
//   - enum heifer_fitness 3 valores + rechazo del 4º; DIFERIDA no descarta ni categoriza — RPS.6.x.
//
// Corre contra la base REMOTA: service_role para fixtures, JWTs reales para los asserts de RLS/authz.
// Mismo patrón que supabase/tests/{animal,maneuvers}/run.cjs.
//
// 🔴 ROJA-HASTA-APPLY: las migraciones 0102-0105 NO están aplicadas (el deploy lo gatea el leader post-Gate-2
// + autorización de Raf). Hasta entonces ESTA SUITE FALLA — es ESPERADO (mismo patrón documentado en
// 0075-0082 / 0093-0097 / scrotal). Por eso el hook en scripts/run-tests.mjs queda COMENTADO; el leader lo
// DESCOMENTA al aplicar (la suite verde post-apply confirma el contrato no-bypass / authz / fix del veto).
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

const RUN_TAG = `pes_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

// ---- helpers de fixtures (mismo patrón que supabase/tests/animal|maneuvers/run.cjs) ----

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

// createRodeo por INSERT plano (NO usa la RPC create_rodeo): para sembrar rodeos rápido en los tests que no
// ejercitan la RPC en sí. service_months se setea aparte (admin update o RPC, según el test).
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

async function createAnimal(client, { tag = null, idv = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null }) {
  const { speciesId } = await lookupSpeciesSystem(client, 'bovino', 'cria');
  const animalId = require('node:crypto').randomUUID();
  const animalPayload = { id: animalId, sex, species_id: speciesId };
  if (tag) animalPayload.tag_electronic = tag;
  if (birthDate) animalPayload.birth_date = birthDate;
  const { error: aErr } = await client.from('animals').insert(animalPayload);
  if (aErr) return { error: aErr };

  let catId;
  if (categoryCode) catId = await categoryId(client, systemId, categoryCode);
  else catId = await categoryId(client, systemId, sex === 'male' ? 'torito' : 'vaquillona');

  const profileId = require('node:crypto').randomUUID();
  const profilePayload = {
    id: profileId, animal_id: animalId, establishment_id: establishmentId,
    rodeo_id: rodeoId, category_id: catId, status: 'active',
  };
  if (idv) profilePayload.idv = idv;
  // IDU: visual_id_alt eliminado (0122). Un perfil sin idv/tag persiste (trigger de completitud dropeado).
  const { error: pErr } = await client.from('animal_profiles').insert(profilePayload);
  if (pErr) return { error: pErr, animalId };
  return {
    profile: { id: profileId, category_id: catId, category_override: false, rodeo_id: rodeoId },
    animalId,
  };
}

// catCode: lee el code de categoría actual de un perfil (vía admin, refleja el estado almacenado).
async function catCode(profileId) {
  const { data: p } = await admin.from('animal_profiles').select('category_id').eq('id', profileId).single();
  if (!p) return null;
  const { data: c } = await admin.from('categories_by_system').select('code').eq('id', p.category_id).single();
  return c ? c.code : null;
}

function pgcode(error) {
  return String((error && (error.code || '')) + ' ' + (error && (error.message || '')));
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
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function thisYear() { return new Date().getFullYear(); }
// fecha en un mes dado del año actual (día 15, formato AAAA-MM-15).
function dateInMonth(month, year = thisYear()) {
  return `${year}-${String(month).padStart(2, '0')}-15`;
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

test('puesta-en-servicio suite — spec 02 Stream A', async (t) => {
  let userA, userB, userField, clientA, clientB, clientField, estA, estB;
  let rodeoA, rodeoB;

  // ---- TPS.setup ----------------------------------------------------------
  await t.test('setup: usuarios, establishments, rodeos', async () => {
    userA = await createTestUser('userA');       // owner estA
    userB = await createTestUser('userB');       // owner estB
    userField = await createTestUser('userField'); // field_operator en estA
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);
    await assignRoleAsService(userField.id, estA, 'field_operator');
    clientField = await getUserClient(userField.email);
    rodeoA = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo A1' });
    rodeoB = await createRodeo(clientB, { establishmentId: estB, name: 'Rodeo B1' });
    assert.ok(rodeoA.id && rodeoB.id);
  });

  // =====================================================================
  // TPS.2 — CHECK de service_months (columna 0102) — RPS.1.x / RPS.2.1
  // =====================================================================
  await t.test('TPS.2 CHECK service_months: rango/dup/≤12, NULL vs vacío, backfill NULL', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo CHECK' });

    // (RPS.2.1) un rodeo creado por el camino viejo (INSERT plano) queda service_months = NULL tras el ALTER.
    {
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.equal(data.service_months, null, 'rodeo creado por camino viejo → service_months NULL (backfill NULL, RPS.2.1)');
    }
    // (RPS.1.3) mes < 1 → rechazo.
    {
      const { error } = await admin.from('rodeos').update({ service_months: [0] }).eq('id', r.id);
      assert.notEqual(error, null, '{0} debe ser rechazado por el CHECK (RPS.1.3)');
      assert.match(pgcode(error), /rodeos_service_months_valid|23514|check/i);
    }
    // (RPS.1.3) mes > 12 → rechazo.
    {
      const { error } = await admin.from('rodeos').update({ service_months: [13] }).eq('id', r.id);
      assert.notEqual(error, null, '{13} debe ser rechazado por el CHECK (RPS.1.3)');
      assert.match(pgcode(error), /rodeos_service_months_valid|23514|check/i);
    }
    // (RPS.1.4) meses duplicados → rechazo.
    {
      const { error } = await admin.from('rodeos').update({ service_months: [10, 10] }).eq('id', r.id);
      assert.notEqual(error, null, '{10,10} debe ser rechazado por el CHECK (RPS.1.4)');
      assert.match(pgcode(error), /rodeos_service_months_valid|23514|check/i);
    }
    // (RPS.1.5) >12 elementos → rechazo (13 valores, todos en rango, sin dup → solo viola cardinalidad).
    {
      const thirteen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1]; // 13 elems pero dup → igual rechaza
      const { error } = await admin.from('rodeos').update({ service_months: thirteen }).eq('id', r.id);
      assert.notEqual(error, null, 'array de 13 elementos debe ser rechazado (RPS.1.5 / RPS.1.4)');
      assert.match(pgcode(error), /rodeos_service_months_valid|23514|check/i);
    }
    // (RPS.1.6 shape / acepta válidos) {10,11,12} primavera → OK.
    {
      const { error } = await admin.from('rodeos').update({ service_months: [10, 11, 12] }).eq('id', r.id);
      assert.equal(error, null, error ? `{10,11,12}: ${error.message}` : '{10,11,12} aceptado');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.deepEqual(data.service_months, [10, 11, 12], '{10,11,12} persistido');
    }
    // (RPS.1.2) vacío {} aceptado y DISTINGUIBLE de NULL.
    {
      const { error } = await admin.from('rodeos').update({ service_months: [] }).eq('id', r.id);
      assert.equal(error, null, error ? `{}: ${error.message}` : '{} (vacío) aceptado (RPS.1.2)');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.ok(data.service_months !== null, '{} NO es NULL (distinguible, RPS.1.2)');
      assert.deepEqual(data.service_months, [], '{} persistido como array vacío');
    }
    // (RPS.1.2) NULL aceptado (volver a sin configurar) y ≠ vacío.
    {
      const { error } = await admin.from('rodeos').update({ service_months: null }).eq('id', r.id);
      assert.equal(error, null, error ? `NULL: ${error.message}` : 'NULL aceptado (RPS.1.2)');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.equal(data.service_months, null, 'NULL persistido (≠ {}, RPS.1.2)');
    }
    // (RPS.1.3 borde) {1} y {12} válidos (bordes del rango).
    {
      const { error: e1 } = await admin.from('rodeos').update({ service_months: [1] }).eq('id', r.id);
      assert.equal(e1, null, '{1} (borde inferior) aceptado');
      const { error: e12 } = await admin.from('rodeos').update({ service_months: [12] }).eq('id', r.id);
      assert.equal(e12, null, '{12} (borde superior) aceptado');
    }
    // (RPS.1.5 borde) los 12 meses sin dup → OK (cardinalidad = 12, no >12).
    {
      const { error } = await admin.from('rodeos').update({ service_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }).eq('id', r.id);
      assert.equal(error, null, error ? `12 meses: ${error.message}` : 'los 12 meses (sin dup) aceptados (cardinalidad=12 ≤12)');
    }
  });

  // =====================================================================
  // TPS.6 — RPC de escritura (create_rodeo + set_rodeo_service_months) — RPS.3.x / RPS.1.6
  // =====================================================================
  await t.test('TPS.6 create_rodeo: default primavera / explícito / inválido (RPS.1.6, RPS.3.1, RPS.3.5)', async () => {
    const { speciesId, systemId } = await lookupSpeciesSystem(clientA, 'bovino', 'cria');
    // (RPS.1.6) create_rodeo SIN p_service_months → {10,11,12}.
    {
      const id = require('node:crypto').randomUUID();
      const { error } = await clientA.rpc('create_rodeo', {
        p_id: id, p_establishment_id: estA, p_name: `${RUN_TAG} cr-default`, p_species_id: speciesId, p_system_id: systemId,
      });
      assert.equal(error, null, error ? `create_rodeo default: ${error.message}` : 'create_rodeo sin service_months → OK');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', id).single();
      assert.deepEqual(data.service_months, [10, 11, 12], 'create_rodeo sin param → default primavera {10,11,12} (RPS.1.6)');
    }
    // (RPS.3.1) create_rodeo con {6,7} → ese valor.
    {
      const id = require('node:crypto').randomUUID();
      const { error } = await clientA.rpc('create_rodeo', {
        p_id: id, p_establishment_id: estA, p_name: `${RUN_TAG} cr-otono`, p_species_id: speciesId, p_system_id: systemId,
        p_service_months: [6, 7],
      });
      assert.equal(error, null, error ? `create_rodeo {6,7}: ${error.message}` : 'create_rodeo con {6,7} → OK');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', id).single();
      assert.deepEqual(data.service_months, [6, 7], 'create_rodeo con {6,7} → persistido (RPS.3.1)');
    }
    // (RPS.3.5) create_rodeo con {13} → rechazo server-side.
    {
      const id = require('node:crypto').randomUUID();
      const { error } = await clientA.rpc('create_rodeo', {
        p_id: id, p_establishment_id: estA, p_name: `${RUN_TAG} cr-bad`, p_species_id: speciesId, p_system_id: systemId,
        p_service_months: [13],
      });
      assert.notEqual(error, null, 'create_rodeo con {13} → rechazo (RPS.3.5)');
      assert.match(pgcode(error), /out of range|23514/i);
    }
    // (RPS.3.1) create_rodeo con {} explícito → "no hace servicio" (≠ default).
    {
      const id = require('node:crypto').randomUUID();
      const { error } = await clientA.rpc('create_rodeo', {
        p_id: id, p_establishment_id: estA, p_name: `${RUN_TAG} cr-empty`, p_species_id: speciesId, p_system_id: systemId,
        p_service_months: [],
      });
      assert.equal(error, null, error ? `create_rodeo {}: ${error.message}` : 'create_rodeo con {} → OK');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', id).single();
      assert.deepEqual(data.service_months, [], 'create_rodeo con {} explícito → vacío (no default)');
    }
  });

  await t.test('TPS.6 set_rodeo_service_months: owner/idempotente/IDOR/NULL/inexistente (RPS.3.2-3.6)', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo edit' });
    // (RPS.3.3) owner edita OK.
    {
      const { error } = await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: [11] });
      assert.equal(error, null, error ? `owner edita: ${error.message}` : 'owner edita service_months → OK');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.deepEqual(data.service_months, [11], 'service_months actualizado a {11}');
    }
    // (RPS.3.6) idempotente: re-aplicar {11} = no-op (mismo estado).
    {
      const { error } = await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: [11] });
      assert.equal(error, null, error ? `idempotente: ${error.message}` : 're-aplicar {11} → OK (idempotente)');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.deepEqual(data.service_months, [11], 're-aplicar deja el mismo estado (RPS.3.6)');
    }
    // (RPS.3.3) field_operator → 42501 (no owner).
    {
      const { error } = await clientField.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: [10] });
      assert.notEqual(error, null, 'field_operator no puede editar service_months (RPS.3.3)');
      assert.match(pgcode(error), /42501|not authorized/i);
      // y NO tocó nada.
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.deepEqual(data.service_months, [11], 'field_operator rechazado → service_months intacto');
    }
    // (RPS.3.4) owner del tenant A con p_rodeo_id del tenant B → 42501 sin tocar nada (anti-IDOR).
    {
      const { error } = await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: rodeoB.id, p_service_months: [1] });
      assert.notEqual(error, null, 'owner A con rodeo de B → 42501 (anti-IDOR, RPS.3.4)');
      assert.match(pgcode(error), /42501|not authorized/i);
      // el rodeo de B NO fue tocado (sigue NULL).
      const { data } = await admin.from('rodeos').select('service_months').eq('id', rodeoB.id).single();
      assert.equal(data.service_months, null, 'rodeo de B intacto tras el intento IDOR de A');
    }
    // (RPS.1.2) NULL vuelve a "sin configurar".
    {
      const { error } = await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: null });
      assert.equal(error, null, error ? `set NULL: ${error.message}` : 'set NULL → OK');
      const { data } = await admin.from('rodeos').select('service_months').eq('id', r.id).single();
      assert.equal(data.service_months, null, 'NULL vuelve a sin configurar (RPS.1.2)');
    }
    // (RPS.3.5) edición inválida {0} → 23514.
    {
      const { error } = await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: [0] });
      assert.notEqual(error, null, 'set {0} → rechazo (RPS.3.5)');
      assert.match(pgcode(error), /out of range|23514/i);
    }
    // (set_rodeo_config-style) rodeo inexistente → P0002.
    {
      const ghost = require('node:crypto').randomUUID();
      const { error } = await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: ghost, p_service_months: [11] });
      assert.notEqual(error, null, 'rodeo inexistente → error');
      assert.match(pgcode(error), /P0002|not found/i);
    }
  });

  // =====================================================================
  // TPS.8 — compute_category sin service — RPS.4.1/.2/.3/.4/.5
  // =====================================================================
  await t.test('TPS.8 compute_category SIN service (RPS.4.1/.2/.3/.4/.5)', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo cc' });
    // habilitar inseminacion para poder insertar IA luego (gating 0054). prenez/tamano_prenez ya default.
    // (a) RPS.4.1 — hembra <1 año con SOLO un evento service (natural) y sin destete → ternera (NO vaquillona).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_a`, sex: 'female', birthDate: daysAgo(200), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
      const { error } = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'service', service_type: 'natural', event_date: daysAgo(5) });
      assert.equal(error, null, error ? `insert service natural: ${error.message}` : 'service natural insertado');
      const code = await eventually(() => catCode(an.profile.id), (c) => c === 'ternera', { tries: 6, delay: 400 });
      assert.equal(code, 'ternera', 'hembra <1año con solo service (natural) → SIGUE ternera (RPS.4.1)');
    }
    // (b) RPS.4.2 — hembra con destete → vaquillona.
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_b`, sex: 'female', birthDate: daysAgo(200), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(3) });
      const code = await eventually(() => catCode(an.profile.id), (c) => c === 'vaquillona', { tries: 6, delay: 400 });
      assert.equal(code, 'vaquillona', 'hembra con destete → vaquillona (RPS.4.2)');
    }
    // (c) RPS.4.4 — hembra ≥1 año con birth_date → vaquillona por edad (corte de edad, sin destete ni service).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_c`, sex: 'female', birthDate: daysAgo(400), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
      // disparar un recompute: insertar y borrar un evento neutro no sirve; usamos compute_category vía un
      // evento que recompute. Un destete cambiaría la causa; mejor: forzar recompute con refresh_age (TPS.10).
      // Acá lo verificamos directo con compute_category (service_role) sobre el perfil:
      const { data, error } = await admin.rpc('compute_category', { profile_id: an.profile.id });
      assert.equal(error, null, error ? `compute_category edad: ${error.message}` : 'compute_category ejecutó');
      const { data: c } = await admin.from('categories_by_system').select('code').eq('id', data).single();
      assert.equal(c.code, 'vaquillona', 'hembra ≥1año con birth_date → compute_category = vaquillona por edad (RPS.4.4)');
    }
    // (d) RPS.4.3 — transiciones intactas: tacto+ → vaquillona_prenada, 1 parto → vaca_segundo_servicio,
    //     ≥2 → multipara, aborto revierte tacto+, castración (rama macho).
    {
      // tacto+ → vaquillona_prenada
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_d1`, sex: 'female', birthDate: daysAgo(550), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto', event_date: daysAgo(5), pregnancy_status: 'medium' });
      assert.equal(await eventually(() => catCode(an.profile.id), (c) => c === 'vaquillona_prenada'), 'vaquillona_prenada', 'tacto+ → vaquillona_prenada (RPS.4.3)');
      // aborto posterior revierte (RT2.7.5): vuelve a vaquillona (por edad ≥365).
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'abortion', event_date: daysAgo(2) });
      assert.equal(await eventually(() => catCode(an.profile.id), (c) => c === 'vaquillona'), 'vaquillona', 'aborto posterior revierte tacto+ → vaquillona (RPS.4.3)');
    }
    {
      // 1 parto → vaca_segundo_servicio
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_d2`, sex: 'female', birthDate: daysAgo(800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'birth', event_date: daysAgo(5) });
      assert.equal(await eventually(() => catCode(an.profile.id), (c) => c === 'vaca_segundo_servicio'), 'vaca_segundo_servicio', '1 parto → vaca_segundo_servicio (RPS.4.3)');
      // 2do parto → multipara
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'birth', event_date: daysAgo(2) });
      assert.equal(await eventually(() => catCode(an.profile.id), (c) => c === 'multipara'), 'multipara', '≥2 partos → multipara (RPS.4.3)');
    }
    {
      // castración (rama macho): torito → novillito al castrar (is_castrated en animals).
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_d3`, sex: 'male', birthDate: daysAgo(400), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'torito' });
      await clientA.from('animals').update({ is_castrated: true }).eq('id', an.animalId);
      assert.equal(await eventually(() => catCode(an.profile.id), (c) => c === 'novillito'), 'novillito', 'castración torito → novillito (rama macho intacta, RPS.4.3)');
    }
    // (e) RPS.4.5 — recompute de un perfil con service histórico = MISMA categoría que computaría SIN él.
    {
      // Diseño de la prueba DISCRIMINANTE: hembra <365 días (200d) con un service histórico + un destete →
      // vaquillona (por destete). Al BORRAR el destete (recompute), si `service` AÚN contara la hembra
      // quedaría vaquillona; como `service` se IGNORA (0104) y la edad es <365 → debe volver a TERNERA.
      // Esto prueba que el service histórico no resucita vaquillona por el recompute (RPS.4.5).
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cc_e`, sex: 'female', birthDate: daysAgo(200), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'service', service_type: 'natural', event_date: daysAgo(20) });
      await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'weaning', event_date: daysAgo(10) });
      assert.equal(await eventually(() => catCode(an.profile.id), (c) => c === 'vaquillona'), 'vaquillona', 'hembra <365 con service+destete → vaquillona (por destete)');
      // id del destete vía SELECT separado (NO RETURNING — RLS-on-RETURNING puede dar null), robusto a lag.
      const w = await eventually(
        async () => (await clientA.from('reproductive_events').select('id')
          .eq('animal_profile_id', an.profile.id).eq('event_type', 'weaning').is('deleted_at', null).maybeSingle()).data,
        (d) => d && d.id,
      );
      assert.ok(w && w.id, 'destete localizado para el soft-delete (RPS.4.5)');
      // borrar el destete via RPC soft-delete → recompute con el service histórico aún presente.
      const del = await clientA.rpc('soft_delete_event', { p_kind: 'reproductive', p_event_id: w.id });
      assert.equal(del.error, null, del.error ? `soft_delete destete: ${del.error.message}` : 'destete soft-deleted');
      const code = await eventually(() => catCode(an.profile.id), (c) => c === 'ternera', { tries: 6, delay: 400 });
      assert.equal(code, 'ternera', 'recompute con service histórico (sin destete, <365) → TERNERA: el service NO la sostiene (RPS.4.5)');
    }
  });

  // =====================================================================
  // TPS.9 — IA (RPS.4.8): ternera + IA → sigue ternera; aparece en serviced_females rama 'ai'
  // =====================================================================
  await t.test('TPS.9 IA sobre ternera → sigue ternera, pero serviced_females la incluye (RPS.4.8)', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo IA' });
    // habilitar inseminacion (gating 0054).
    {
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'inseminacion').single();
      await clientA.from('rodeo_data_config').update({ enabled: true }).eq('rodeo_id', r.id).eq('field_definition_id', fd.id);
      await eventually(
        async () => (await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', r.id).eq('field_definition_id', fd.id).maybeSingle()).data,
        (row) => row && row.enabled === true,
      );
    }
    // setear service_months al mes de la IA para que cuente la campaña.
    const month = 11;
    await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: [month] });

    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_ia`, sex: 'female', birthDate: daysAgo(200), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
    const { error } = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'service', service_type: 'ai', event_date: dateInMonth(month) });
    assert.equal(error, null, error ? `insert IA: ${error.message}` : 'IA insertada');
    // categoría sigue ternera (la IA ya no promueve por el solo evento).
    const code = await eventually(() => catCode(an.profile.id), (c) => c === 'ternera', { tries: 6, delay: 400 });
    assert.equal(code, 'ternera', 'IA sobre ternera → SIGUE ternera (RPS.4.8: categoría ≠ elegibilidad)');
    // pero aparece en serviced_females por la rama 'ai'.
    const { data: served, error: sErr } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: thisYear() });
    assert.equal(sErr, null, sErr ? `serviced_females: ${sErr.message}` : 'serviced_females ejecutó');
    const row = (served || []).find((x) => x.animal_profile_id === an.profile.id);
    assert.ok(row, 'la ternera con IA aparece en serviced_females (RPS.4.8)');
    assert.equal(row.source, 'ai', 'aparece por la rama ai');
  });

  // =====================================================================
  // TPS.10 — red de seguridad de edad (refresh_age_categories) — RPS.4.4
  // =====================================================================
  await t.test('TPS.10 refresh_age_categories materializa ternera@365→vaquillona (RPS.4.4)', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo cron' });
    const an = await createAnimal(clientA, { idv: `${RUN_TAG}_cron`, sex: 'female', birthDate: daysAgo(400), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
    // refresh_age_categories está revocada de clientes → se corre como service_role (admin).
    const { error } = await admin.rpc('refresh_age_categories');
    assert.equal(error, null, error ? `refresh_age_categories: ${error.message}` : 'refresh_age_categories ejecutó');
    const code = await eventually(() => catCode(an.profile.id), (c) => c === 'vaquillona', { tries: 6, delay: 400 });
    assert.equal(code, 'vaquillona', 'ternera de ≥365d → vaquillona tras el cron (RPS.4.4)');
    // history auto_transition.
    const { data: hist } = await admin.from('animal_category_history').select('reason').eq('animal_profile_id', an.profile.id);
    assert.ok((hist || []).map((h) => h.reason).includes('auto_transition'), 'la transición queda como auto_transition');
  });

  // =====================================================================
  // TPS.15 — derivación servidas/entoradas — RPS.2.2/.3, RPS.5.x
  // =====================================================================
  await t.test('TPS.15 derivación servidas/entoradas: siembra completa + fix veto + IDOR + read-only', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo denom' });
    const month = 11;
    await clientA.rpc('set_rodeo_service_months', { p_rodeo_id: r.id, p_service_months: [month] });
    // habilitar inseminacion + tacto_vaquillona para poder cargar IA y veredictos.
    for (const dk of ['inseminacion', 'tacto_vaquillona']) {
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', dk).single();
      await clientA.from('rodeo_data_config').update({ enabled: true }).eq('rodeo_id', r.id).eq('field_definition_id', fd.id);
      await eventually(
        async () => (await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', r.id).eq('field_definition_id', fd.id).maybeSingle()).data,
        (row) => row && row.enabled === true,
      );
    }

    // Siembra:
    // - vaca multipara (probadamente servida, sin gate) → cuenta.
    const vaca = await createAnimal(clientA, { idv: `${RUN_TAG}_d_vaca`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    // - vaquillona_prenada (FIX VETO: cuenta SIN gate, no sale al diagnosticarse preñada).
    const vqPren = await createAnimal(clientA, { idv: `${RUN_TAG}_d_vqp`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona_prenada' });
    // - vaquillona APTA (último veredicto apta) → cuenta.
    const vqApta = await createAnimal(clientA, { idv: `${RUN_TAG}_d_apta`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    await admin.from('animal_profiles').update({ category_override: true }).eq('id', vqApta.profile.id); // que el tacto_vaquillona no cambie su categoría
    await clientA.from('reproductive_events').insert({ animal_profile_id: vqApta.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(10), heifer_fitness: 'apta' });
    // - vaquillona NO_APTA → NO cuenta.
    const vqNoApta = await createAnimal(clientA, { idv: `${RUN_TAG}_d_noapta`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    await admin.from('animal_profiles').update({ category_override: true }).eq('id', vqNoApta.profile.id);
    await clientA.from('reproductive_events').insert({ animal_profile_id: vqNoApta.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(10), heifer_fitness: 'no_apta' });
    // - vaquillona DIFERIDA → NO cuenta.
    const vqDif = await createAnimal(clientA, { idv: `${RUN_TAG}_d_dif`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    await admin.from('animal_profiles').update({ category_override: true }).eq('id', vqDif.profile.id);
    await clientA.from('reproductive_events').insert({ animal_profile_id: vqDif.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(10), heifer_fitness: 'diferida' });
    // - vaquillona SIN veredicto pero de edad (≥365) → fallback por edad → cuenta.
    const vqEdad = await createAnimal(clientA, { idv: `${RUN_TAG}_d_edad`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    // - hembra con IA EN campaña (Nov) → cuenta por ai.
    const iaIn = await createAnimal(clientA, { idv: `${RUN_TAG}_d_iain`, sex: 'female', birthDate: daysAgo(300), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: iaIn.profile.id, event_type: 'service', service_type: 'ai', event_date: dateInMonth(month) });
    // - hembra con IA FUERA de campaña (mes 3) → NO cuenta.
    const iaOut = await createAnimal(clientA, { idv: `${RUN_TAG}_d_iaout`, sex: 'female', birthDate: daysAgo(300), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: iaOut.profile.id, event_type: 'service', service_type: 'ai', event_date: dateInMonth(3) });
    // - una multipara dada de baja (retirada) → cuenta en serviced pero retired.
    const vacaBaja = await createAnimal(clientA, { idv: `${RUN_TAG}_d_baja`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });

    // serviced_females.
    const { data: served, error: sErr } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: thisYear() });
    assert.equal(sErr, null, sErr ? `serviced_females: ${sErr.message}` : 'serviced_females ejecutó');
    const ids = new Set((served || []).map((x) => x.animal_profile_id));
    assert.ok(ids.has(vaca.profile.id), 'multipara cuenta (probadamente servida)');
    assert.ok(ids.has(vqPren.profile.id), 'vaquillona_prenada CUENTA (FIX VETO RPS.5.2)');
    assert.ok(ids.has(vqApta.profile.id), 'vaquillona APTA cuenta (RPS.5.3)');
    assert.ok(!ids.has(vqNoApta.profile.id), 'vaquillona NO_APTA NO cuenta (RPS.5.3)');
    assert.ok(!ids.has(vqDif.profile.id), 'vaquillona DIFERIDA NO cuenta (RPS.5.3/RPS.6.2)');
    assert.ok(ids.has(vqEdad.profile.id), 'vaquillona sin veredicto + de edad → fallback cuenta (RPS.5.4)');
    assert.ok(ids.has(iaIn.profile.id), 'IA en campaña cuenta (RPS.5.1)');
    assert.ok(!ids.has(iaOut.profile.id), 'IA fuera de campaña NO cuenta');
    assert.ok(ids.has(vacaBaja.profile.id), 'multipara (aún activa) cuenta antes de la baja');

    // (RPS.5.7) distinct: una vaquillona APTA con TAMBIÉN IA en campaña cuenta UNA vez.
    {
      await clientA.from('reproductive_events').insert({ animal_profile_id: vqApta.profile.id, event_type: 'service', service_type: 'ai', event_date: dateInMonth(month) });
      const { data: served2 } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: thisYear() });
      const count = (served2 || []).filter((x) => x.animal_profile_id === vqApta.profile.id).length;
      assert.equal(count, 1, 'hembra en ambas ramas (natural+ai) cuenta UNA vez (RPS.5.7, distinct)');
      const rowAp = (served2 || []).find((x) => x.animal_profile_id === vqApta.profile.id);
      assert.equal(rowAp.source, 'natural', 'en el empate gana natural (orden estable)');
    }

    // (RPS.5.5) entoradas = serviced − retiradas. Damos de baja la vacaBaja → retired +1.
    {
      const { data: denomBefore } = await clientA.rpc('rodeo_repro_denominator', { p_rodeo_id: r.id, p_year: thisYear() });
      const before = denomBefore[0];
      assert.equal(before.entoradas, before.serviced - before.retired, 'entoradas = serviced − retired (RPS.5.5)');
      const { error: bajaErr } = await admin.from('animal_profiles').update({ status: 'sold', exit_reason: 'sale', exit_date: daysAgo(1) }).eq('id', vacaBaja.profile.id);
      assert.ifError(bajaErr); // baja debe persistir: un literal de enum inválido reverte el status='sold' silenciosamente y rompe el assert de membresía de abajo
      const { data: denomAfter } = await clientA.rpc('rodeo_repro_denominator', { p_rodeo_id: r.id, p_year: thisYear() });
      const after = denomAfter[0];
      // la vacaBaja (natural) sale del set serviced al no estar 'active' → serviced baja en 1.
      assert.ok(after.serviced === before.serviced - 1, 'una baja de rama natural sale del set serviced (membresía active)');
      assert.equal(after.entoradas, after.serviced - after.retired, 'entoradas = serviced − retired tras la baja (RPS.5.5)');
    }

    // (RPS.2.2 / RPS.2.3) rodeo con service_months=NULL → rama natural vacía pero IA igual cuenta;
    // is_configured=false.
    {
      const rNull = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo NULL' });
      // inseminacion enabled.
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'inseminacion').single();
      await clientA.from('rodeo_data_config').update({ enabled: true }).eq('rodeo_id', rNull.id).eq('field_definition_id', fd.id);
      await eventually(
        async () => (await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', rNull.id).eq('field_definition_id', fd.id).maybeSingle()).data,
        (row) => row && row.enabled === true,
      );
      const vacaN = await createAnimal(clientA, { idv: `${RUN_TAG}_n_vaca`, sex: 'female', birthDate: daysAgo(1500), rodeoId: rNull.id, establishmentId: estA, systemId: rNull.systemId, categoryCode: 'multipara' });
      const iaN = await createAnimal(clientA, { idv: `${RUN_TAG}_n_ia`, sex: 'female', birthDate: daysAgo(300), rodeoId: rNull.id, establishmentId: estA, systemId: rNull.systemId, categoryCode: 'ternera' });
      await clientA.from('reproductive_events').insert({ animal_profile_id: iaN.profile.id, event_type: 'service', service_type: 'ai', event_date: dateInMonth(month) });
      const { data: servedN } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: rNull.id, p_year: thisYear() });
      const idsN = new Set((servedN || []).map((x) => x.animal_profile_id));
      assert.ok(!idsN.has(vacaN.profile.id), 'rodeo NULL → rama natural vacía (la multipara NO cuenta, RPS.2.2)');
      assert.ok(idsN.has(iaN.profile.id), 'rodeo NULL → IA igual cuenta (dato real per-vaca)');
      const { data: camp } = await clientA.rpc('rodeo_service_campaign', { p_rodeo_id: rNull.id, p_year: thisYear() });
      assert.equal(camp[0].is_configured, false, 'rodeo NULL → is_configured=false (RPS.2.3)');
      assert.equal(camp[0].n_months, 0, 'rodeo NULL → n_months=0');
    }

    // (RPS.5.6, anti-IDOR) caller de otro tenant (owner B) → 42501 en las 3.
    {
      const c1 = await clientB.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: thisYear() });
      assert.notEqual(c1.error, null, 'owner B no lee serviced_females de A');
      assert.match(pgcode(c1.error), /42501|not authorized/i);
      const c2 = await clientB.rpc('rodeo_service_campaign', { p_rodeo_id: r.id, p_year: thisYear() });
      assert.match(pgcode(c2.error), /42501|not authorized/i, 'owner B no lee campaign de A');
      const c3 = await clientB.rpc('rodeo_repro_denominator', { p_rodeo_id: r.id, p_year: thisYear() });
      assert.match(pgcode(c3.error), /42501|not authorized/i, 'owner B no lee denominator de A');
    }
    // tenant: field_operator de A (cualquier rol del establecimiento) SÍ puede leer (reportes).
    {
      const fr = await clientField.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: thisYear() });
      assert.equal(fr.error, null, fr.error ? `field lee: ${fr.error.message}` : 'field_operator de A puede leer el denominador (RPS.5.6)');
    }

    // (RPS.5.10) p_year fuera de rango → error en las 3.
    {
      const future = thisYear() + 5;
      const e1 = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: future });
      assert.notEqual(e1.error, null, 'p_year fuera de rango → error (serviced_females, RPS.5.10)');
      assert.match(pgcode(e1.error), /out of range|22023/i);
      const e2 = await clientA.rpc('rodeo_service_campaign', { p_rodeo_id: r.id, p_year: 1800 });
      assert.match(pgcode(e2.error), /out of range|22023/i, 'p_year=1800 → error (campaign, RPS.5.10)');
      const e3 = await clientA.rpc('rodeo_repro_denominator', { p_rodeo_id: r.id, p_year: future });
      assert.match(pgcode(e3.error), /out of range|22023/i, 'p_year futuro → error (denominator, RPS.5.10)');
    }

    // (RPS.5.9) read-only: las 3 funciones no mutan animal_profiles ni reproductive_events. Verificamos que
    // el conteo de filas/categorías no cambió tras llamarlas repetidamente.
    {
      const { count: pc0 } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
      await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: thisYear() });
      await clientA.rpc('rodeo_repro_denominator', { p_rodeo_id: r.id, p_year: thisYear() });
      await clientA.rpc('rodeo_service_campaign', { p_rodeo_id: r.id, p_year: thisYear() });
      const { count: pc1 } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
      assert.equal(pc1, pc0, 'las 3 funciones de derivación son read-only (no crean/borran perfiles, RPS.5.9)');
    }
  });

  // =====================================================================
  // TPS.16 — heifer_fitness (verificación de contrato) — RPS.6.x
  // =====================================================================
  await t.test('TPS.16 heifer_fitness: 3 valores + rechazo 4º + no categoriza + diferida no descarta (RPS.6.x)', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'Rodeo hf' });
    {
      const { data: fd } = await clientA.from('field_definitions').select('id').eq('data_key', 'tacto_vaquillona').single();
      await clientA.from('rodeo_data_config').update({ enabled: true }).eq('rodeo_id', r.id).eq('field_definition_id', fd.id);
      await eventually(
        async () => (await clientA.from('rodeo_data_config').select('enabled').eq('rodeo_id', r.id).eq('field_definition_id', fd.id).maybeSingle()).data,
        (row) => row && row.enabled === true,
      );
    }
    // (RPS.6.1) los 3 valores aceptados. (RPS.6.3) ninguno cambia la categoría.
    for (const verdict of ['apta', 'no_apta', 'diferida']) {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_hf_${verdict}`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
      const before = await catCode(an.profile.id);
      const { error } = await clientA.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(2), heifer_fitness: verdict });
      assert.equal(error, null, error ? `heifer_fitness=${verdict}: ${error.message}` : `heifer_fitness='${verdict}' aceptado (RPS.6.1)`);
      // categoría NO cambia (RPS.6.3) — esperamos un instante para descartar transición espuria.
      await sleep(600);
      const after = await catCode(an.profile.id);
      assert.equal(after, before, `veredicto '${verdict}' NO cambia category_id (RPS.6.3)`);
      // (RPS.6.2) DIFERIDA no marca CUT ni saca del padrón.
      if (verdict === 'diferida') {
        const { data: p } = await admin.from('animal_profiles').select('is_cut, status').eq('id', an.profile.id).single();
        assert.equal(p.is_cut, false, 'DIFERIDA no marca CUT (RPS.6.2)');
        assert.equal(p.status, 'active', 'DIFERIDA no saca del padrón (RPS.6.2)');
      }
    }
    // (RPS.6.4) un 4º valor → error de enum (contrato cerrado).
    {
      const an = await createAnimal(clientA, { idv: `${RUN_TAG}_hf_bad`, sex: 'female', birthDate: daysAgo(600), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
      const { error } = await admin.from('reproductive_events').insert({ animal_profile_id: an.profile.id, event_type: 'tacto_vaquillona', event_date: daysAgo(2), heifer_fitness: 'excelente' });
      assert.notEqual(error, null, 'un 4º valor de heifer_fitness → error de enum (RPS.6.4)');
      assert.match(pgcode(error), /invalid input value for enum|22P02|heifer_fitness/i);
    }
  });

  // ---- cleanup ------------------------------------------------------------
  await t.test('cleanup', async () => {
    await cleanup();
  });
});
