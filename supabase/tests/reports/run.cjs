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
//   - TR.12 tacto/tacto_vaquillona SIN session_id (delta ficha-categoria-tacto, RTF.8): cuentan igual en
//     rodeo_pregnancy_kpi / rodeo_ccl_distribution / rodeo_serviced_females y NO en session_event_summary.
//
// DELTA «CAMPAÑAS CONGELADAS» (spec 07, migraciones 0127-0130) — TR.12 … TR.21. ⚠ El rótulo TR.12 quedó
// DUPLICADO: el delta `ficha-categoria-tacto` (spec 02) lo tomó para su test de tacto suelto al mismo tiempo
// que este delta lo tomaba para el oráculo de inmutabilidad. Los de este delta llevan "(campañas
// congeladas)" en el título del test.
//   - TR.12  INMUTABILIDAD (oráculo central): cerrada, las 4 mutaciones del probe no la mueven (deepStrictEqual).
//   - TR.12b contrafactual del SNAPSHOT: el gemelo ABIERTO sí se mueve con un dato de la ventana; el cerrado no.
//   - TR.12c contrafactual del CÓMPUTO HISTÓRICO: venta/transferencia/no_apta posteriores al corte ya no
//            reescriben una campaña ABIERTA (antes movían 7, 6 y hasta `serviced: 0`).
//   - TR.13  cómputo histórico antes del cierre: entradas/salidas, edad al corte (F3-bis), año sin nadie.
//   - TR.14  authz de close/reopen/status + idempotencia + reapertura bloqueada; TR.14b grants de función;
//            TR.14c el cierre no muta datos; TR.14d el gate del ciclo incompleto (F8) y los guards duros;
//            TR.14e grants de TABLA (el invariante que sostiene DP-19); TR.14f el rol CADUCADO;
//            TR.14g catálogo (prosecdef/volatilidad/search_path); TR.14h FK compuesta del tenant + N-6.
//   - TR.15  historia de membresía (apertura/movimiento/baja/invariante/backfill/RLS/par cruzado).
//   - TR.16  DL10: el dato tardío entra, no mueve la foto, enciende has_new_data, y reabrir+cerrar lo incorpora.
//   - TR.17  regresión tacto sin jornada + guard de clase (ninguna de las 7 referencia session_id).
//   - TR.18  denominador (retired = 0, entoradas = serviced) — asserteado dentro de kpiBundle, o sea en TODOS
//            los escenarios del delta, no en uno elegido.
//   - TR.19  guard de AUSENCIA: las 3 tablas nuevas no están en sync-streams/rafaq.yaml (case-insensitive).
//   - TR.20  el detalle por animal ES la evidencia del número congelado (conteo por bucket == cabecera).
//   - TR.21  guard y cota ANTES del cortocircuito por snapshot, sobre el conjunto de funciones DESCUBIERTO
//            del catálogo (Gate 1 H-1, bloqueante).
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
//
// ⚠ `entryDate` (delta campañas congeladas): el trigger de membresía (0127) abre la fila con
// `from_date = coalesce(entry_date, created_at::date)`. Un perfil SIN entry_date nace con membresía desde
// HOY, así que NO pertenece al rodeo en la fecha de corte de una campaña pasada y `rodeo_serviced_females`
// lo excluye. Los tests que usan `lastYear` (TR.4b, TR.11) se pondrían rojos por la fecha del calendario, no
// por una regresión. Default: la fecha de nacimiento (que es cuándo entró al campo en un sistema de cría) o
// 10 años atrás si no hay. Es el mismo requisito que RCC.11.2 le pide al re-seed de La Facundina.
async function createAnimal(client, { idv = null, sex, birthDate = null, rodeoId, establishmentId, systemId, categoryCode = null, status = 'active', entryDate = undefined }) {
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
    entry_date: entryDate === undefined ? (birthDate || daysAgo(3650)) : entryDate,
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Helpers del delta CAMPAÑAS CONGELADAS (T43) — cierre/reapertura/estado + mutaciones de escenario.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// Management API (database/query) para los asserts de CATÁLOGO (pg_proc, pg_policies, information_schema) y
// para el descubrimiento de funciones de TR.21. PostgREST solo expone el schema `public`, así que no hay otra
// forma de leer el catálogo desde la suite. Mismo endpoint que scripts/apply-migration.mjs y misma forma que
// supabase/tests/operaciones_rodeo/run.cjs:59-71.
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

// El wrapper NO tiene default para `acknowledge`, igual que el de TypeScript (§7.1): quien llama elige.
async function closeCampaign(client, rodeoId, year, acknowledge) {
  return await client.rpc('close_campaign', {
    p_rodeo_id: rodeoId, p_year: year, p_acknowledge_incomplete: acknowledge,
  });
}
async function reopenCampaign(client, rodeoId, year) {
  return await client.rpc('reopen_campaign', { p_rodeo_id: rodeoId, p_year: year });
}
async function campaignStatus(client, rodeoId, year) {
  const res = await client.rpc('rodeo_campaign_status', { p_rodeo_id: rodeoId, p_year: year });
  return { error: res.error, status: row1(res.data) };
}
// snapshot VIGENTE de (rodeo, año) leído por service_role (la tabla es select-only para el cliente).
async function snapshotOf(rodeoId, year) {
  const { data, error } = await admin.from('rodeo_campaign_snapshots')
    .select('*').eq('rodeo_id', rodeoId).eq('campaign_year', year).is('reopened_at', null);
  if (error) throw new Error(`snapshotOf: ${error.message}`);
  return (data || [])[0] || null;
}
async function snapshotDetail(snapshotId, bucket) {
  const { data, error } = await admin.from('rodeo_campaign_snapshot_animals')
    .select('*').eq('snapshot_id', snapshotId).eq('bucket', bucket);
  if (error) throw new Error(`snapshotDetail: ${error.message}`);
  return data || [];
}
async function moveProfileToRodeo(profileId, rodeoId) {
  const { error } = await admin.from('animal_profiles').update({ rodeo_id: rodeoId }).eq('id', profileId);
  if (error) throw new Error(`moveProfileToRodeo: ${error.message}`);
}
async function setCategory(profileId, systemId, code) {
  const catId = await categoryId(admin, systemId, code);
  const { error } = await admin.from('animal_profiles').update({ category_id: catId }).eq('id', profileId);
  if (error) throw new Error(`setCategory(${code}): ${error.message}`);
}
// Venta: status + exit_date. El trigger de membresía cierra la fila vigente con to_date = exit_date.
async function sellProfile(profileId, exitDate) {
  const { error } = await admin.from('animal_profiles')
    .update({ status: 'sold', exit_reason: 'sale', exit_date: exitDate }).eq('id', profileId);
  if (error) throw new Error(`sellProfile: ${error.message}`);
}
// RETRODATAR la fila `initial` de animal_category_history al ingreso del animal (RCC.11.3). Sin esto, el
// perfil sembrado HOY no tiene historia de categoría anterior a la fecha de corte de una campaña pasada y
// `animal_category_at` cae en la degradación de RCC.2.7 (categoría ACTUAL) → un cambio de categoría de hoy
// reescribiría el pasado y los contrafactuales de TR.12c/TR.13 pasarían por el motivo equivocado.
async function backdateCategoryHistory(profileId, isoDate) {
  const { error } = await admin.from('animal_category_history')
    .update({ changed_at: `${isoDate}T12:00:00Z` }).eq('animal_profile_id', profileId).eq('reason', 'initial');
  if (error) throw new Error(`backdateCategoryHistory: ${error.message}`);
}
async function seedTacto(client, profileId, eventDate, pregnancyStatus) {
  const { error } = await client.from('reproductive_events').insert({
    animal_profile_id: profileId, event_type: 'tacto', event_date: eventDate, pregnancy_status: pregnancyStatus,
  });
  if (error) throw new Error(`seedTacto: ${error.message}`);
}
// Habilita un data_key del rodeo (gating de 0054): sin `inseminacion` habilitada, el insert de un evento
// `service`/`ai` muere con "maneuver gated: rodeo … is missing enabled data_keys {inseminacion}". Mismo
// procedimiento que usa supabase/tests/puesta-en-servicio/run.cjs para sembrar IA.
async function enableDataKey(client, rodeoId, dataKey) {
  const { data: fd, error: fdErr } = await client
    .from('field_definitions').select('id').eq('data_key', dataKey).single();
  if (fdErr) throw new Error(`enableDataKey lookup(${dataKey}): ${fdErr.message}`);
  const { error } = await client.from('rodeo_data_config')
    .update({ enabled: true }).eq('rodeo_id', rodeoId).eq('field_definition_id', fd.id);
  if (error) throw new Error(`enableDataKey(${dataKey}): ${error.message}`);
  await eventually(
    async () => (await client.from('rodeo_data_config').select('enabled')
      .eq('rodeo_id', rodeoId).eq('field_definition_id', fd.id).maybeSingle()).data,
    (row) => row && row.enabled === true,
  );
}
async function seedTactoVaquillona(client, profileId, eventDate, fitness) {
  const { error } = await client.from('reproductive_events').insert({
    animal_profile_id: profileId, event_type: 'tacto_vaquillona', event_date: eventDate, heifer_fitness: fitness,
  });
  if (error) throw new Error(`seedTactoVaquillona: ${error.message}`);
}

// Los 6 reportes de la campaña en UN objeto, para comparar de una con deepStrictEqual (TR.12).
// Asserta de paso el invariante de TR.18 (RCC.2.12) en TODOS los escenarios de la suite que lo usan.
async function kpiBundle(client, rodeoId, year) {
  const sf = await client.rpc('rodeo_serviced_females', { p_rodeo_id: rodeoId, p_year: year });
  if (sf.error) throw new Error(`kpiBundle serviced_females: ${sf.error.message}`);
  const denom = await client.rpc('rodeo_repro_denominator', { p_rodeo_id: rodeoId, p_year: year });
  if (denom.error) throw new Error(`kpiBundle denominator: ${denom.error.message}`);
  const preg = await client.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: rodeoId, p_year: year });
  const calv = await client.rpc('rodeo_calving_kpi', { p_rodeo_id: rodeoId, p_year: year });
  const ccl = await client.rpc('rodeo_ccl_distribution', { p_rodeo_id: rodeoId, p_year: year });
  const stage = await client.rpc('rodeo_calving_by_stage', { p_rodeo_id: rodeoId, p_year: year });
  const wean = await client.rpc('rodeo_weaning_kpi', { p_rodeo_id: rodeoId, p_year: year });
  const d = row1(denom.data);
  // TR.18 / RCC.2.12: con el conjunto servidas evaluado a la fecha de corte, `retired` es estructuralmente 0
  // y `entoradas` == `serviced`. Se asserta acá para que valga en TODOS los escenarios, no en uno elegido.
  assert.equal(d.retired, 0, 'TR.18: retired === 0 en todo escenario (F7/RCC.2.12)');
  assert.equal(d.entoradas, d.serviced, 'TR.18: entoradas === serviced (F7/RCC.2.12)');
  return {
    servicedIds: (sf.data || []).map((x) => x.animal_profile_id).sort(),
    servicedCount: (sf.data || []).length,
    denom: d,
    preg: row1(preg.data),
    calv: row1(calv.data),
    ccl: row1(ccl.data),
    stage: row1(stage.data),
    wean: row1(wean.data),
  };
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
  // TR.12 — TACTO SUELTO (sin `session_id`): "suelto, pero visible en los reportes"
  //         (delta spec 02 `ficha-categoria-tacto`, RTF.8.1/8.2/8.4/8.5)
  // =====================================================================
  //
  // El tacto que se carga desde la FICHA (de a un animal) NO pertenece a ninguna jornada: `session_id`
  // queda NULL. La spec AFIRMA que eso no cambia nada para los reportes reproductivos porque ninguna de
  // esas funciones referencia `session_id`. Este test convierte esa afirmacion de "lo lei en el SQL" a
  // "lo ejecute y lo vi" (RTF.8.5) - que es la diferencia entre un contrato y un supuesto.
  //
  // El oraculo FUERTE es el de la vaquillona `no_apta`: `rodeo_serviced_females` incluye por FALLBACK DE
  // EDAD a toda vaquillona >=365 d SIN veredicto. Si la funcion ignorara los `tacto_vaquillona` sin
  // `session_id`, esa vaquillona entraria igual. Que quede EXCLUIDA prueba que el veredicto sin jornada SI
  // se lee.
  await t.test('TR.12 tacto sin session_id: cuenta en pregnancy_kpi / serviced_females y NO en session_event_summary', async () => {
    const year = thisYear();
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R suelto' });
    await setServiceMonths(r.id, [11]);

    // -- (a) RTF.8.1 - tacto de PRENEZ sin session_id sobre una hembra del conjunto SERVIDAS. -------
    const m1 = await createAnimal(clientA, { idv: `${RUN_TAG}_sl1`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    const m2 = await createAnimal(clientA, { idv: `${RUN_TAG}_sl2`, sex: 'female', birthDate: daysAgo(1500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara' });
    // m1: tacto POSITIVO SUELTO (session_id NULL - exactamente lo que escribe `addTacto` desde la ficha).
    const { data: looseTacto, error: ltErr } = await clientA
      .from('reproductive_events')
      .insert({ animal_profile_id: m1.profile.id, event_type: 'tacto', event_date: dateOn(year, 12, 10), pregnancy_status: 'large' })
      .select('id, session_id')
      .single();
    assert.equal(ltErr, null, ltErr ? `insert tacto suelto: ${ltErr.message}` : 'el tacto sin session_id se inserta');
    assert.equal(looseTacto.session_id, null, 'el tacto de la ficha queda con session_id NULL (RTF.5.3)');
    // m2: tacto POSITIVO de JORNADA (control) - el mismo computo debe tratarlos IGUAL.
    const sess = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'active' });
    await clientA.from('reproductive_events').insert({ animal_profile_id: m2.profile.id, session_id: sess, event_type: 'tacto', event_date: dateOn(year, 12, 10), pregnancy_status: 'medium' });

    const { data: kpi, error: kErr } = await eventually(
      async () => await clientA.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && row1(res.data) && row1(res.data).pregnant >= 2,
    );
    assert.equal(kErr, null, kErr ? `pregnancy_kpi: ${kErr.message}` : 'ejecuto');
    assert.equal(row1(kpi).pregnant, 2, 'el tacto SUELTO cuenta igual que el de jornada (RTF.8.1)');
    assert.equal(row1(kpi).serviced, 2, 'las dos multiparas estan en el denominador');

    // El mismo tacto suelto tambien alimenta la distribucion CCL (mismo `last_tacto`, sin session_id).
    const { data: ccl } = await clientA.rpc('rodeo_ccl_distribution', { p_rodeo_id: r.id, p_year: year });
    assert.equal(row1(ccl).head, 1, 'el tacto suelto `large` entra en CCL como cabeza');
    assert.equal(row1(ccl).body, 1, 'el de jornada `medium` entra como cuerpo');

    // -- (b) RTF.8.2 - `tacto_vaquillona` sin session_id: 'apta' INCLUYE, 'no_apta' EXCLUYE. --------
    // Las dos vaquillonas tienen >=365 d -> SIN veredicto entrarian por el fallback de edad. El veredicto
    // suelto es lo unico que puede sacarlas o mantenerlas.
    const vApta = await createAnimal(clientA, { idv: `${RUN_TAG}_slv1`, sex: 'female', birthDate: daysAgo(500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    const vNo = await createAnimal(clientA, { idv: `${RUN_TAG}_slv2`, sex: 'female', birthDate: daysAgo(500), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona' });
    // CONTROL de no-vacuidad: antes del veredicto, las DOS estan (fallback por edad).
    const { data: before } = await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && res.data.some((x) => x.animal_profile_id === vNo.profile.id),
    );
    const beforeIds = new Set((before || []).map((x) => x.animal_profile_id));
    assert.ok(beforeIds.has(vApta.profile.id), 'control: sin veredicto, la vaquillona >=365 d entra por edad');
    assert.ok(beforeIds.has(vNo.profile.id), 'control: sin veredicto, la otra tambien');

    const { data: aptaRow, error: aErr } = await clientA
      .from('reproductive_events')
      .insert({ animal_profile_id: vApta.profile.id, event_type: 'tacto_vaquillona', event_date: dateOn(year, 11, 5), heifer_fitness: 'apta' })
      .select('id, session_id')
      .single();
    assert.equal(aErr, null, aErr ? `insert tacto_vaquillona suelto: ${aErr.message}` : 'inserta');
    assert.equal(aptaRow.session_id, null, 'el tacto_vaquillona de la ficha queda sin jornada');
    await clientA
      .from('reproductive_events')
      .insert({ animal_profile_id: vNo.profile.id, event_type: 'tacto_vaquillona', event_date: dateOn(year, 11, 5), heifer_fitness: 'no_apta' });

    const { data: after } = await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: year }),
      (res) => res && res.data && !res.data.some((x) => x.animal_profile_id === vNo.profile.id),
    );
    const afterIds = new Set((after || []).map((x) => x.animal_profile_id));
    assert.ok(afterIds.has(vApta.profile.id), "el 'apta' SUELTO la mantiene en servidas (RTF.8.2)");
    assert.ok(
      !afterIds.has(vNo.profile.id),
      "el 'no_apta' SUELTO la EXCLUYE de servidas y anula el fallback por edad - o sea: el evento sin " +
        'session_id SI se lee (RTF.8.2)',
    );

    // -- (c) RTF.8.4 - el tacto suelto NO aparece en el Resumen de jornada. -----------------------
    // La sesion creada arriba tiene UN evento reproductivo (el tacto de m2). El suelto no pertenece a
    // ninguna jornada, asi que no puede sumar aca - y eso es la semantica correcta, no una perdida.
    const { data: summary, error: sErr } = await eventually(
      async () => await clientA.rpc('session_event_summary', { p_session_id: sess }),
      (res) => res && res.data && res.data.length === 7,
    );
    assert.equal(sErr, null, sErr ? `session_event_summary: ${sErr.message}` : 'ejecuto');
    const repro = (summary || []).find((x) => x.event_kind === 'reproductive');
    assert.equal(repro.event_count, 1, 'la jornada cuenta SOLO su propio tacto (el suelto no aparece, RTF.8.4)');
    assert.equal(repro.animals, 1, 'y un solo animal (m2)');

    // Una sesion VACIA del mismo rodeo tampoco lo ve (no hay "jornada por defecto" que lo absorba).
    const sessEmpty = await createSession(clientA, { establishmentId: estA, rodeoId: r.id, status: 'active' });
    const { data: emptySummary } = await clientA.rpc('session_event_summary', { p_session_id: sessEmpty });
    const emptyRepro = (emptySummary || []).find((x) => x.event_kind === 'reproductive');
    assert.equal(emptyRepro.event_count, 0, 'una jornada vacia del mismo rodeo NO absorbe el tacto suelto');
  });

  // =====================================================================
  // DELTA «CAMPAÑAS CONGELADAS» (spec 07) — TR.12 … TR.21
  // =====================================================================
  //
  // ⚠ COLISIÓN DE NUMERACIÓN, declarada: el delta `ficha-categoria-tacto` (spec 02) tomó el rótulo TR.12
  // para su test de "tacto suelto" al mismo tiempo que este delta lo tomaba para el oráculo de
  // inmutabilidad. Los dos rótulos conviven; los de este delta llevan "(campañas congeladas)" en el título.
  //
  // Qué prueban, en una línea: que una campaña CERRADA es una foto (nada la mueve), que una campaña ABIERTA
  // se computa con el estado HISTÓRICO (la venta / el movimiento de rodeo / la recategorización posteriores
  // al corte ya no reescriben el pasado), y que las 7 salidas tempranas nuevas del cortocircuito por
  // snapshot NO se comen el guard de tenant ni la cota de p_year (Gate 1 H-1).
  //
  // 🔴 ROJA-HASTA-APPLY de las migraciones 0127-0130 (las aplica el LEADER).
  const CC_YEAR = thisYear() - 1;          // campaña en el PASADO → la fecha de corte ya ocurrió (G1 pasa).
  const CC_MONTHS = [6, 7];                // servicio jun-jul (probe 1) → corte 31/07, ventana de tacto
  const CC_CUT = dateOn(CC_YEAR, 7, 31);   //   [CC_YEAR-06-01, CC_YEAR+1-05-31].
  const CC_ENTRY = dateOn(CC_YEAR - 1, 1, 10);

  // Escenario del probe 1 (progress/repro_reportes-campanas-congeladas.md): 3 multíparas, las 3 con tacto
  // PREÑADA `large` el CC_YEAR-09-15, y la vaca B con parto el CC_YEAR+1-03-15 (concepción CC_YEAR-06 →
  // campaña CC_YEAR). Opcionalmente una vaquillona sin veredicto que entra por el fallback de edad.
  async function seedProbeScenario(label, { withHeifer = false, withAi = false } = {}) {
    const r = await createRodeo(clientA, { establishmentId: estA, name: `R ${label}` });
    await setServiceMonths(r.id, CC_MONTHS);
    const cows = [];
    for (const tag of ['a', 'b', 'c']) {
      const c = await createAnimal(clientA, {
        idv: `${RUN_TAG}_${label}_${tag}`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r.id,
        establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara', entryDate: CC_ENTRY,
      });
      await backdateCategoryHistory(c.profile.id, CC_ENTRY);
      await seedTacto(clientA, c.profile.id, dateOn(CC_YEAR, 9, 15), 'large');
      cows.push(c);
    }
    // parto de la vaca B: concepción = parto − 9 meses = CC_YEAR-06-15 ∈ {6,7} de CC_YEAR.
    await seedBirthWithCalf(clientA, { motherProfileId: cows[1].profile.id, eventDate: dateOn(CC_YEAR + 1, 3, 15) });
    let heifer = null;
    if (withHeifer) {
      // Vaquillona SIN veredicto y con ≥365 días AL CORTE → entra por el fallback de edad. Es el sujeto del
      // `no_apta` posterior del probe 2 (el que hacía serviced: 0).
      heifer = await createAnimal(clientA, {
        idv: `${RUN_TAG}_${label}_h`, sex: 'female', birthDate: dateOn(CC_YEAR - 2, 1, 10), rodeoId: r.id,
        establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona', entryDate: CC_ENTRY,
      });
      await backdateCategoryHistory(heifer.profile.id, CC_ENTRY);
    }
    let ai = null;
    if (withAi) {
      await enableDataKey(clientA, r.id, 'inseminacion');   // gating 0054
      // Ternera cuyo ÚNICO camino al conjunto es el evento de IA dentro de la ventana (RCC.2.10): por
      // categoría no es elegible en la rama natural y el fallback de edad es solo para vaquillonas.
      ai = await createAnimal(clientA, {
        idv: `${RUN_TAG}_${label}_ai`, sex: 'female', birthDate: dateOn(CC_YEAR - 1, 3, 1), rodeoId: r.id,
        establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera', entryDate: CC_ENTRY,
      });
      await backdateCategoryHistory(ai.profile.id, CC_ENTRY);
      const { error } = await clientA.from('reproductive_events').insert({
        animal_profile_id: ai.profile.id, event_type: 'service', service_type: 'ai',
        event_date: dateOn(CC_YEAR, 6, 20),
      });
      if (error) throw new Error(`seedProbeScenario IA: ${error.message}`);
    }
    return { rodeo: r, cows, heifer, ai };
  }

  // ── TR.12 — INMUTABILIDAD (el oráculo central del delta, RCC.13.1) ────────────────────────────────────
  await t.test('TR.12 (campañas congeladas) inmutabilidad: cerrada, las 4 mutaciones del probe no la mueven', async () => {
    const { rodeo, cows } = await seedProbeScenario('immut');

    // T0 — "el reporte que el productor imprimió" (números exactos del probe 1).
    const t0 = await eventually(
      async () => await kpiBundle(clientA, rodeo.id, CC_YEAR),
      (b) => b && b.servicedCount === 3 && b.calv.calved === 1,
    );
    assert.equal(t0.servicedCount, 3, 'T0 serviced_females = 3');
    assert.deepStrictEqual(t0.denom, { serviced: 3, retired: 0, entoradas: 3 }, 'T0 denominador');
    assert.equal(t0.preg.pregnant, 3, 'T0 pregnant = 3');
    assert.equal(t0.preg.empty, 0, 'T0 empty = 0');
    assert.equal(t0.calv.calved, 1, 'T0 calved = 1');
    assert.equal(t0.calv.pending_pregnant, 2, 'T0 pending_pregnant = 2');
    assert.equal(t0.ccl.total, 3, 'T0 ccl total = 3');
    assert.equal(t0.stage.total_born, 1, 'T0 total_born = 1');
    assert.equal(t0.wean.pending_weaning, 1, 'T0 pending_weaning = 1');

    // CIERRE. El ciclo está INCOMPLETO a propósito (hay 1 cría sin destetar y 2 preñadas sin parir: son los
    // números del probe), así que el cierre exige el reconocimiento de F8 — que es justamente lo que TR.14d
    // prueba en detalle. Acá se usa `true` para poder ejercitar la inmutabilidad con el escenario del probe.
    const closed = await closeCampaign(clientA, rodeo.id, CC_YEAR, true);
    assert.equal(closed.error, null, closed.error ? `close_campaign: ${closed.error.message}` : 'cerró');
    assert.ok(closed.data, 'close_campaign devuelve el id del snapshot');

    // Las CUATRO mutaciones del probe, todas posteriores al cierre.
    // (1) tacto VACÍO de la campaña SIGUIENTE (fuera de la ventana [CC_YEAR-06-01, CC_YEAR+1-05-31]).
    await seedTacto(clientA, cows[0].profile.id, dateOn(CC_YEAR + 1, 6, 15), 'empty');
    // (2) VENTA de la vaca B (la que parió).
    await sellProfile(cows[1].profile.id, daysAgo(1));
    // (3) TRANSFERENCIA de rodeo de la vaca C.
    const otro = await createRodeo(clientA, { establishmentId: estA, name: `R immut destino` });
    await moveProfileToRodeo(cows[2].profile.id, otro.id);
    // (4) recategorización a `cut` + veredicto `no_apta` fechado en CC_YEAR+1 (el killer del probe 2).
    await setCategory(cows[0].profile.id, rodeo.systemId, 'cut');
    await seedTactoVaquillona(clientA, cows[0].profile.id, dateOn(CC_YEAR + 1, 6, 15), 'no_apta');

    const t1 = await kpiBundle(clientA, rodeo.id, CC_YEAR);
    assert.deepStrictEqual(t1, t0, 'la campaña CERRADA es idéntica campo por campo tras las 4 mutaciones');
  });

  // ── TR.12b — CONTRAFACTUAL DEL SNAPSHOT (RCC.13.2) ────────────────────────────────────────────────────
  await t.test('TR.12b (campañas congeladas) contrafactual del snapshot: el gemelo ABIERTO sí se mueve', async () => {
    // Por qué la mutación tiene que ser un dato DE LA CAMPAÑA y no una venta: después de este delta, la
    // venta / la transferencia / la recategorización TAMPOCO mueven una campaña abierta (ese es el fix del
    // cómputo histórico, y lo prueba TR.12c). Si el contrafactual se escribiera con esas tres, el gemelo no
    // se movería, el test fallaría y el próximo que lo lea aflojaría la aserción. La única mutación que
    // aísla la contribución del SNAPSHOT es un dato legítimo de la campaña que llega tarde (DL10).
    const twin = await seedProbeScenario('twin');
    const before = await eventually(
      async () => await kpiBundle(clientA, twin.rodeo.id, CC_YEAR),
      (b) => b && b.preg.pregnant === 3,
    );
    assert.equal(before.preg.pregnant, 3, 'gemelo abierto: pregnant = 3');
    assert.equal(before.ccl.total, 3, 'gemelo abierto: ccl total = 3');

    // tacto VACÍO DENTRO de la ventana (CC_YEAR+1-02-15 < CC_YEAR+1-06-01) y posterior al de septiembre.
    await seedTacto(clientA, twin.cows[0].profile.id, dateOn(CC_YEAR + 1, 2, 15), 'empty');
    const after = await eventually(
      async () => await kpiBundle(clientA, twin.rodeo.id, CC_YEAR),
      (b) => b && b.preg.pregnant === 2,
    );
    assert.equal(after.preg.pregnant, 2, 'gemelo ABIERTO: pregnant 3 → 2');
    assert.equal(after.preg.empty, 1, 'gemelo ABIERTO: empty 0 → 1');
    assert.equal(after.ccl.total, 2, 'gemelo ABIERTO: ccl total 3 → 2');

    // El mismo dato, sobre una campaña CERRADA, no la mueve (se cierra el par).
    const closedTwin = await seedProbeScenario('twinclosed');
    const t0 = await eventually(
      async () => await kpiBundle(clientA, closedTwin.rodeo.id, CC_YEAR),
      (b) => b && b.preg.pregnant === 3,
    );
    const res = await closeCampaign(clientA, closedTwin.rodeo.id, CC_YEAR, true);
    assert.equal(res.error, null, res.error ? `close: ${res.error.message}` : 'cerró');
    await seedTacto(clientA, closedTwin.cows[0].profile.id, dateOn(CC_YEAR + 1, 2, 15), 'empty');
    const t1 = await kpiBundle(clientA, closedTwin.rodeo.id, CC_YEAR);
    assert.deepStrictEqual(t1, t0, 'con el MISMO tacto de la ventana, la CERRADA no se mueve');
  });

  // ── TR.12c — CONTRAFACTUAL DEL CÓMPUTO HISTÓRICO (RCC.13.3) ───────────────────────────────────────────
  await t.test('TR.12c (campañas congeladas) contrafactual del cómputo histórico: venta/transferencia/no_apta ya no reescriben el pasado', async () => {
    // Antes de este delta (probe 1/2, medido contra DEV): la venta movía 7 campos del reporte del año
    // anterior, la transferencia de rodeo 6, y un `no_apta` de la campaña siguiente dejaba `serviced: 0`.
    // Sobre una campaña ABIERTA, ahora ninguna de las tres mueve nada.
    const s = await seedProbeScenario('hist', { withHeifer: true });
    const before = await eventually(
      async () => await kpiBundle(clientA, s.rodeo.id, CC_YEAR),
      (b) => b && b.servicedCount === 4,
    );
    assert.equal(before.servicedCount, 4, '3 multíparas + 1 vaquillona por fallback de edad AL CORTE');

    await sellProfile(s.cows[1].profile.id, daysAgo(1));                       // venta posterior al corte
    const dest = await createRodeo(clientA, { establishmentId: estA, name: 'R hist destino' });
    await moveProfileToRodeo(s.cows[2].profile.id, dest.id);                    // transferencia posterior
    await setCategory(s.cows[0].profile.id, s.rodeo.systemId, 'cut');           // recategorización posterior
    await seedTactoVaquillona(clientA, s.heifer.profile.id, dateOn(CC_YEAR + 1, 6, 15), 'no_apta');

    const after = await kpiBundle(clientA, s.rodeo.id, CC_YEAR);
    assert.deepStrictEqual(after, before, 'campaña ABIERTA: las 3 mutaciones de estado no mueven ningún KPI');

    // …y el rodeo DESTINO no hereda la campaña: en CC_YEAR la vaca C no estaba ahí (era la fuga F4).
    await setServiceMonths(dest.id, CC_MONTHS);
    const destBundle = await kpiBundle(clientA, dest.id, CC_YEAR);
    assert.equal(destBundle.servicedCount, 0, 'el rodeo destino NO hereda la historia del animal movido (F4)');
  });

  // ── TR.13 — cómputo histórico ANTES del cierre (RCC.13.4, RCC.2.*, RCC.12.6) ──────────────────────────
  await t.test('TR.13 (campañas congeladas) cómputo histórico: entradas/salidas/edad al corte, año sin nadie', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R hist2' });
    await setServiceMonths(r.id, CC_MONTHS);

    // (a) entra DESPUÉS del corte → no cuenta.
    const late = await createAnimal(clientA, { idv: `${RUN_TAG}_h_late`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara', entryDate: daysAgo(2) });
    await backdateCategoryHistory(late.profile.id, daysAgo(2));
    // (b) sale ANTES del corte → no cuenta.
    const gone = await createAnimal(clientA, { idv: `${RUN_TAG}_h_gone`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara', entryDate: CC_ENTRY });
    await backdateCategoryHistory(gone.profile.id, CC_ENTRY);
    await sellProfile(gone.profile.id, dateOn(CC_YEAR, 3, 1));   // exit ANTES del 31/07
    // (c) vendida DESPUÉS del corte → SÍ cuenta (fix F2).
    const sold = await createAnimal(clientA, { idv: `${RUN_TAG}_h_sold`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara', entryDate: CC_ENTRY });
    await backdateCategoryHistory(sold.profile.id, CC_ENTRY);
    await sellProfile(sold.profile.id, daysAgo(1));
    // (e) vaquillona con ≥365 días HOY pero <365 AL CORTE → no cuenta (F3-bis).
    const young = await createAnimal(clientA, { idv: `${RUN_TAG}_h_young`, sex: 'female', birthDate: dateOn(CC_YEAR, 7, 3), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona', entryDate: dateOn(CC_YEAR, 7, 3) });
    await backdateCategoryHistory(young.profile.id, dateOn(CC_YEAR, 7, 3));

    const { data, error } = await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: CC_YEAR }),
      (res) => res && Array.isArray(res.data) && res.data.some((x) => x.animal_profile_id === sold.profile.id),
    );
    assert.equal(error, null, error ? `serviced_females: ${error.message}` : 'ejecutó');
    const ids = new Set((data || []).map((x) => x.animal_profile_id));
    assert.ok(!ids.has(late.profile.id), '(a) el que entró DESPUÉS del corte no cuenta');
    assert.ok(!ids.has(gone.profile.id), '(b) el que salió ANTES del corte no cuenta');
    assert.ok(ids.has(sold.profile.id), '(c) el vendido DESPUÉS del corte SÍ cuenta (F2: el fix, no una regresión)');
    assert.ok(!ids.has(young.profile.id), '(e) fallback por edad evaluado AL CORTE, no a hoy (F3-bis)');
    // control de no-vacuidad de (e): hoy la vaquillona YA tiene edad de servicio, así que el código viejo
    // (que evaluaba contra current_date) la habría incluido.
    const ageToday = Math.floor((Date.now() - Date.parse(dateOn(CC_YEAR, 7, 3))) / 86400000);
    assert.ok(ageToday >= 365, 'control: la vaquillona de (e) HOY ya tiene ≥365 días');

    // (d) `no_apta` posterior al corte NO borra la campaña (probe 2: antes dejaba serviced en 0).
    const withVerdict = await createAnimal(clientA, { idv: `${RUN_TAG}_h_v`, sex: 'female', birthDate: dateOn(CC_YEAR - 2, 1, 10), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'vaquillona', entryDate: CC_ENTRY });
    await backdateCategoryHistory(withVerdict.profile.id, CC_ENTRY);
    const withV = await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.some((x) => x.animal_profile_id === withVerdict.profile.id),
    );
    assert.ok((withV.data || []).some((x) => x.animal_profile_id === withVerdict.profile.id), 'control: la vaquillona apta por edad entra');
    await seedTactoVaquillona(clientA, withVerdict.profile.id, dateOn(CC_YEAR + 1, 6, 15), 'no_apta');
    const afterVerdict = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: CC_YEAR });
    assert.ok((afterVerdict.data || []).some((x) => x.animal_profile_id === withVerdict.profile.id),
      '(d) un `no_apta` POSTERIOR al corte no borra la campaña anterior (probe 2)');

    // (f) año en el que no había nadie presente → serviced = 0 (el año deja de ser decorativo, RCC.12.6).
    const { data: old } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: CC_YEAR - 5 });
    assert.equal((old || []).length, 0, '(f) campaña de un año sin nadie presente → serviced = 0');

    // ── (g) LA RAMA DE INSEMINACIÓN ARTIFICIAL (RCC.2.10) ──────────────────────────────────────────────
    // `ai_females` también se reescribió (se le agregó el `join member` y se le sacó `p.status`), y es la
    // MITAD del conjunto de elegibilidad — `docs/verification.md` pone los KPI en la lista de testing no
    // negociable. Sin esto, ninguna hembra entraba por IA en ningún escenario del delta y la rama quedaba
    // cubierta solo por una aserción INVERSA (`every(source === 'natural')`), que es lo contrario de un
    // oráculo. El sujeto es una `ternera`: por categoría NO es elegible en la rama natural (ni por el
    // fallback de edad, que es solo para vaquillonas), así que su ÚNICO camino al conjunto es el evento de IA.
    await enableDataKey(clientA, r.id, 'inseminacion');   // gating 0054: sin esto el insert de IA se rechaza
    const aiIn = await createAnimal(clientA, { idv: `${RUN_TAG}_h_ai`, sex: 'female', birthDate: dateOn(CC_YEAR - 1, 3, 1), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera', entryDate: CC_ENTRY });
    await backdateCategoryHistory(aiIn.profile.id, CC_ENTRY);
    // IA DENTRO de la campaña: año = CC_YEAR y mes ∈ service_months {6,7}.
    const { error: aiErr } = await clientA.from('reproductive_events').insert({
      animal_profile_id: aiIn.profile.id, event_type: 'service', service_type: 'ai',
      event_date: dateOn(CC_YEAR, 6, 20),
    });
    assert.equal(aiErr, null, aiErr ? `insert IA: ${aiErr.message}` : 'IA insertada');

    // (g.1) entra, y entra POR LA RAMA IA.
    const withAi = await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.some((x) => x.animal_profile_id === aiIn.profile.id),
    );
    const aiRow = (withAi.data || []).find((x) => x.animal_profile_id === aiIn.profile.id);
    assert.ok(aiRow, '(g) la ternera con IA en la ventana entra al conjunto servidas');
    assert.equal(aiRow.source, 'ai', '(g) y entra por la rama `ai`, no por la natural');

    // (g.2) contrafactual de MEMBRESÍA sobre la rama IA: misma IA, pero el animal entró al rodeo DESPUÉS del
    // corte → NO cuenta. Es el predicado histórico que la rama IA no tenía antes del delta.
    const aiLate = await createAnimal(clientA, { idv: `${RUN_TAG}_h_ail`, sex: 'female', birthDate: dateOn(CC_YEAR - 1, 3, 1), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera', entryDate: daysAgo(2) });
    await backdateCategoryHistory(aiLate.profile.id, daysAgo(2));
    await clientA.from('reproductive_events').insert({
      animal_profile_id: aiLate.profile.id, event_type: 'service', service_type: 'ai',
      event_date: dateOn(CC_YEAR, 6, 20),
    });
    // (g.3) …y el que SALIÓ del rodeo antes del corte tampoco, aunque su IA esté en la ventana.
    const aiGone = await createAnimal(clientA, { idv: `${RUN_TAG}_h_aig`, sex: 'female', birthDate: dateOn(CC_YEAR - 1, 3, 1), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'ternera', entryDate: CC_ENTRY });
    await backdateCategoryHistory(aiGone.profile.id, CC_ENTRY);
    await clientA.from('reproductive_events').insert({
      animal_profile_id: aiGone.profile.id, event_type: 'service', service_type: 'ai',
      event_date: dateOn(CC_YEAR, 6, 20),
    });
    await sellProfile(aiGone.profile.id, dateOn(CC_YEAR, 3, 1));   // salió ANTES del 31/07

    const aiFinal = await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: r.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.some((x) => x.animal_profile_id === aiIn.profile.id),
    );
    const aiIds = new Set((aiFinal.data || []).map((x) => x.animal_profile_id));
    assert.ok(aiIds.has(aiIn.profile.id), '(g.1) control: la IA presente al corte SIGUE contando');
    assert.ok(!aiIds.has(aiLate.profile.id), '(g.2) rama IA: el que entró al rodeo DESPUÉS del corte no cuenta');
    assert.ok(!aiIds.has(aiGone.profile.id), '(g.3) rama IA: el que salió ANTES del corte no cuenta');
  });

  // ── TR.14 — authz de las 3 RPC nuevas (RCC.13.5) ──────────────────────────────────────────────────────
  await t.test('TR.14 (campañas congeladas) authz de close/reopen/status: owner B, field_operator, veterinario, cotas', async () => {
    const s = await seedProbeScenario('authz');
    await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.length === 3,
    );

    // owner de B sobre el rodeo de A → 42501 en las TRES.
    for (const [fn, args] of [
      ['close_campaign', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR, p_acknowledge_incomplete: false }],
      ['reopen_campaign', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR }],
      ['rodeo_campaign_status', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR }],
    ]) {
      const res = await clientB.rpc(fn, args);
      assert.match(pgcode(res.error), /42501|not authorized/i, `${fn}: owner de B → 42501`);
      assert.ok(!res.data || (Array.isArray(res.data) && res.data.length === 0), `${fn}: y sin datos`);
    }

    // field_operator de A: NO cierra ni reabre, pero SÍ lee el estado y los KPI (RCC.7.3).
    const fClose = await closeCampaign(clientField, s.rodeo.id, CC_YEAR, false);
    assert.match(pgcode(fClose.error), /42501|not authorized/i, 'field_operator no cierra (punto ①)');
    const fReopen = await reopenCampaign(clientField, s.rodeo.id, CC_YEAR);
    assert.match(pgcode(fReopen.error), /42501|not authorized/i, 'field_operator no reabre');
    const fStatus = await campaignStatus(clientField, s.rodeo.id, CC_YEAR);
    assert.equal(fStatus.error, null, fStatus.error ? `field status: ${fStatus.error.message}` : 'field_operator LEE el estado');
    assert.equal(fStatus.status.can_close, false, 'field_operator: can_close = false');
    assert.equal(fStatus.status.can_reopen, false, 'field_operator: can_reopen = false');
    const fKpi = await clientField.rpc('rodeo_pregnancy_kpi', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR });
    assert.equal(fKpi.error, null, 'field_operator lee los KPI (el guard de lectura NO se endurece)');

    // cotas y existencia.
    const badYear = await closeCampaign(clientA, s.rodeo.id, 1899, false);
    assert.match(pgcode(badYear.error), /22023/i, 'p_year fuera de cota → 22023');
    const ghost = await closeCampaign(clientA, crypto.randomUUID(), CC_YEAR, false);
    assert.match(pgcode(ghost.error), /P0002|not found/i, 'rodeo inexistente → P0002');

    // veterinario de A: cierra, lee y reabre.
    const userVet = await createTestUser('userVet');
    await assignRoleAsService(userVet.id, estA, 'veterinarian');
    const clientVet = await getUserClient(userVet.email);
    const vClose = await closeCampaign(clientVet, s.rodeo.id, CC_YEAR, true);
    assert.equal(vClose.error, null, vClose.error ? `vet close: ${vClose.error.message}` : 'el veterinario CIERRA (punto ①)');
    // idempotencia: cerrar dos veces devuelve el MISMO id y deja UNA sola fila (RCC.5.6, RCC.13.9).
    const again = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(again.error, null, 'cerrar dos veces no falla');
    assert.equal(again.data, vClose.data, 'cerrar dos veces devuelve el mismo snapshot');
    const { data: rows } = await admin.from('rodeo_campaign_snapshots')
      .select('id').eq('rodeo_id', s.rodeo.id).eq('campaign_year', CC_YEAR);
    assert.equal((rows || []).length, 1, 'y NO hay dos filas de snapshot');

    // reapertura bloqueada por la campaña siguiente cerrada (RCC.6.2).
    const nextClose = await closeCampaign(clientA, s.rodeo.id, CC_YEAR + 1, true);
    if (!nextClose.error) {
      const blocked = await reopenCampaign(clientA, s.rodeo.id, CC_YEAR);
      assert.match(pgcode(blocked.error), /23514/i, 'reabrir con la campaña siguiente cerrada → 23514');
      await reopenCampaign(clientA, s.rodeo.id, CC_YEAR + 1);   // se destraba para el resto del test
    }
    const vReopen = await reopenCampaign(clientVet, s.rodeo.id, CC_YEAR);
    assert.equal(vReopen.error, null, vReopen.error ? `vet reopen: ${vReopen.error.message}` : 'el veterinario REABRE');
    // reabrir una campaña ya abierta no falla: devuelve null (RCC.6.4).
    const noop = await reopenCampaign(clientA, s.rodeo.id, CC_YEAR);
    assert.equal(noop.error, null, 'reabrir una campaña abierta no falla');
    assert.equal(noop.data, null, 'reabrir una campaña abierta devuelve null (idempotente)');
  });

  // ── TR.14d — el gate del CICLO INCOMPLETO (F8 / RCC.13.9.a-c) ─────────────────────────────────────────
  await t.test('TR.14d (campañas congeladas) ciclo incompleto: 23514 con el detalle, ack cierra, guard duro no reconocible', async () => {
    const s = await seedProbeScenario('f8');
    await eventually(
      async () => await campaignStatus(clientA, s.rodeo.id, CC_YEAR),
      (r) => r && r.status && r.status.cycle_complete === false,
    );

    // (a) sin ack → 23514 y el mensaje NOMBRA lo que falta; y NO se creó ninguna fila de snapshot.
    const st0 = await campaignStatus(clientA, s.rodeo.id, CC_YEAR);
    assert.equal(st0.status.cycle_complete, false, 'el ciclo está incompleto (hay crías sin destetar)');
    assert.equal(st0.status.can_close, true, 'can_close = true: el 23514 que viene es RECONOCIBLE (G3)');
    const noAck = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, false);
    assert.match(pgcode(noAck.error), /23514/i, 'ciclo incompleto sin ack → 23514');
    assert.match(String(noAck.error.message), /preñadas sin parir|crías sin destetar/i,
      'el mensaje enumera QUÉ falta, no es un "no se puede" pelado');
    assert.equal(await snapshotOf(s.rodeo.id, CC_YEAR), null, 'y no se escribió ninguna fila de snapshot');

    // (e) el predicado que usó el gate es el MISMO que expone el status (RCC.13.9.c).
    assert.equal(st0.status.cycle_complete, false, 'cycle_complete del status coincide con el gate');
    assert.ok(st0.status.missing_summary && /crías sin destetar/i.test(st0.status.missing_summary),
      'missing_summary enumera lo mismo que el mensaje del 23514');

    // (b) con ack → cierra, y queda marcado como cerrado a medias con su descriptor.
    const ack = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(ack.error, null, ack.error ? `close con ack: ${ack.error.message}` : 'con ack cierra');
    const snap = await snapshotOf(s.rodeo.id, CC_YEAR);
    assert.equal(snap.closed_incomplete, true, 'closed_incomplete = true (RCC.4.11)');
    assert.ok(snap.missing_at_close, 'missing_at_close guarda qué faltaba');
    // (c) y el status lo expone.
    const st1 = await campaignStatus(clientA, s.rodeo.id, CC_YEAR);
    assert.equal(st1.status.is_closed, true, 'status: cerrada');
    assert.equal(st1.status.closed_incomplete, true, 'status: cerrada a medias');
    assert.ok(st1.status.missing_at_close, 'status: expone qué faltaba al cerrar');
    assert.ok(st1.status.closed_at, 'status: expone la fecha del cierre');

    // (d) una campaña con el ciclo COMPLETO cierra SIN ack y no queda marcada.
    const rc = await createRodeo(clientA, { establishmentId: estA, name: 'R f8 completa' });
    await setServiceMonths(rc.id, [1]);                       // corte 31/01 de CC_YEAR
    const entry = dateOn(CC_YEAR - 1, 1, 10);
    const mom = await createAnimal(clientA, { idv: `${RUN_TAG}_f8c`, sex: 'female', birthDate: daysAgo(1800), rodeoId: rc.id, establishmentId: estA, systemId: rc.systemId, categoryCode: 'multipara', entryDate: entry });
    await backdateCategoryHistory(mom.profile.id, entry);
    await seedTacto(clientA, mom.profile.id, dateOn(CC_YEAR, 4, 10), 'large');
    const b = await seedBirthWithCalf(clientA, { motherProfileId: mom.profile.id, eventDate: dateOn(CC_YEAR, 10, 15) });
    for (const calf of b.calfProfileIds) await seedWeaning(clientA, calf, dateOn(CC_YEAR + 1, 5, 10));
    const stc = await eventually(
      async () => await campaignStatus(clientA, rc.id, CC_YEAR),
      (r) => r && r.status && r.status.cycle_complete === true,
    );
    assert.equal(stc.status.cycle_complete, true, 'ciclo completo (destete cargado, weaning_status ok)');
    const clean = await closeCampaign(clientA, rc.id, CC_YEAR, false);
    assert.equal(clean.error, null, clean.error ? `close ciclo completo: ${clean.error.message}` : 'cierra SIN ack');
    const snapC = await snapshotOf(rc.id, CC_YEAR);
    assert.equal(snapC.closed_incomplete, false, 'ciclo completo → closed_incomplete = false');
    assert.equal(snapC.missing_at_close, null, 'ciclo completo → missing_at_close null');

    // (f) EL GUARD DURO NO ES RECONOCIBLE: con la fecha de corte en el futuro, ack = true igual falla.
    const rf = await createRodeo(clientA, { establishmentId: estA, name: 'R f8 futura' });
    await setServiceMonths(rf.id, [12]);                      // corte 31/12 del año EN CURSO → futuro
    const fut = await closeCampaign(clientA, rf.id, thisYear(), true);
    assert.match(pgcode(fut.error), /23514/i, 'G1 (corte en el futuro): ack = true NO lo sortea');
    const stf = await campaignStatus(clientA, rf.id, thisYear());
    assert.equal(stf.status.can_close, false, 'y can_close = false → la UI no ofrece el reconocimiento');

    // G2 (RCC.5.7.e): campaña sin hembras servidas → 23514 no reconocible, y can_close = false (N-3).
    const rz = await createRodeo(clientA, { establishmentId: estA, name: 'R f8 vacia' });
    await setServiceMonths(rz.id, CC_MONTHS);
    const zero = await closeCampaign(clientA, rz.id, CC_YEAR, true);
    assert.match(pgcode(zero.error), /23514/i, 'G2 (serviced = 0): ack = true NO lo sortea');
    const stz = await campaignStatus(clientA, rz.id, CC_YEAR);
    assert.equal(stz.status.can_close, false, 'can_close refleja el TERCER gate duro (serviced > 0) — Gate 1 N-3');
  });

  // ── TR.21 — el tenant del camino CERRADO (Gate 1 H-1, BLOQUEANTE) ─────────────────────────────────────
  await t.test('TR.21 (campañas congeladas) guard y cota ANTES del cortocircuito por snapshot', async () => {
    // Los IDOR preexistentes de esta suite (TR.1, TR.3, TR.8, TR.9, TR.10) corren TODOS con campañas
    // abiertas — no por descuido, sino porque hasta este delta no existían las campañas cerradas. El
    // cortocircuito agrega SIETE salidas tempranas nuevas y este bloque es el único que las ejercita.
    // Poner el `select … from rodeo_campaign_snapshots` antes del `select … from rodeos` es la variante
    // NATURAL de escribir la función (leer el snapshot no necesita la fila del rodeo): una sola de las siete
    // escrita así entrega los 5 KPI congelados y el detalle por animal completo de un campo ajeno.
    const s = await seedProbeScenario('tenant');
    await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.length === 3,
    );
    const closed = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(closed.error, null, closed.error ? `close: ${closed.error.message}` : 'campaña cerrada');

    // La lista NO se escribe a mano: se DESCUBRE del catálogo. Una función de campaña nueva entra sola.
    //
    // ⚠ La firma se resuelve con `oidvectortypes(p.proargtypes)`, NO con
    // `pg_get_function_identity_arguments` como decía la spec: MEDIDO contra el remoto, la segunda
    // devuelve "p_rodeo_id uuid, p_year integer" (CON los nombres de los parámetros), así que la
    // comparación con 'uuid, integer' no matchea NUNCA y el descubrimiento daba 0 funciones. El test
    // habría quedado rojo para siempre por el piso —fail-closed, pero inútil: los dos oráculos de abajo
    // no se ejecutarían jamás—. `oidvectortypes` devuelve exactamente "uuid, integer".
    const discovered = await adminQuery(`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like 'rodeo\\_%'
        and oidvectortypes(p.proargtypes) = 'uuid, integer'
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      order by 1;
    `);
    const fns = discovered.map((r) => r.proname);
    assert.ok(fns.length >= 9,
      `piso de 9 funciones descubiertas (hay ${fns.length}: ${fns.join(', ')}) — sacar una del namespace no esquiva el test`);
    // Borde declarado: el descubrimiento no ve funciones futuras con otra firma (p. ej. (uuid,int,text)) ni
    // fuera del prefijo `rodeo_`. close_campaign/reopen_campaign se cubren explícitamente en TR.14.

    // (a) GUARD antes del cortocircuito: owner de B, rodeo de A, campaña CERRADA → 42501 y `data` vacío.
    for (const fn of fns) {
      const res = await clientB.rpc(fn, { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR });
      assert.match(pgcode(res.error), /42501|not authorized/i, `${fn}: owner de B con campaña CERRADA → 42501`);
      assert.ok(!res.data || (Array.isArray(res.data) && res.data.length === 0),
        `${fn}: y NO devuelve ni una fila del snapshot ajeno`);
    }

    // (b) COTA antes del cortocircuito. `p_year = 9999999` NO sirve como oráculo (no habría snapshot para
    // ese año, así que hasta una función mal ordenada caería igual en la cota). El oráculo es sembrar un
    // snapshot en un año que el CHECK de la tabla admite (1900..2400) y la cota de las RPC rechaza
    // (1900..current+1): si el cortocircuito está antes de la cota, devuelve la foto sembrada.
    const seeded = {
      rodeo_id: s.rodeo.id, campaign_year: 2400, establishment_id: estA,
      is_configured: true, n_months: 2, serviced: 99, retired: 0, entoradas: 99, pregnant: 99, empty: 0,
      calved: 99, pending_pregnant: 0, calving_status: 'ok',
      ccl_head: 99, ccl_body: 0, ccl_tail: 0, ccl_total: 99,
      born_head: 99, born_body: 0, born_tail: 0, born_total: 99,
      weaned: 99, pending_weaning: 0, weaning_status: 'ok',
    };
    const { error: seedErr } = await admin.from('rodeo_campaign_snapshots').insert(seeded);
    assert.equal(seedErr, null, seedErr ? `seed 2400: ${seedErr.message}` : 'snapshot sembrado en 2400');
    for (const fn of fns) {
      const res = await clientA.rpc(fn, { p_rodeo_id: s.rodeo.id, p_year: 2400 });
      assert.match(pgcode(res.error), /22023/i, `${fn}: cota de p_year ANTES del cortocircuito (22023, no la foto)`);
    }
  });

  // ── TR.14i — la CARRERA de dos cierres (RCC.9.8) y los DOS cierres en UNA transacción (RCC.11.10) ──
  await t.test('TR.14i (campañas congeladas) carrera de cierres concurrentes + dos cierres en la misma transacción', async () => {
    // (a) RCC.9.8 — CARRERA, no idempotencia secuencial. TR.14 ya prueba que cerrar dos veces EN SERIE
    // devuelve el mismo id; eso NO ejercita el `on conflict` + `unique_violation`, que es lo que impide dos
    // fotos vigentes cuando dos clientes cierran a la vez. Este oráculo es PROBABILÍSTICO y se declara como
    // tal: si las dos llamadas no llegan a interleavearse, pasa sin haber probado nada — pero **no puede
    // dar un falso verde**, porque el assert que importa (una sola fila vigente) es sobre el estado final.
    const race = await seedProbeScenario('carrera');
    await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: race.rodeo.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.length === 3,
    );
    const [r1, r2] = await Promise.all([
      closeCampaign(clientA, race.rodeo.id, CC_YEAR, true),
      closeCampaign(clientA, race.rodeo.id, CC_YEAR, true),
    ]);
    assert.equal(r1.error, null, r1.error ? `cierre 1: ${r1.error.message}` : 'el primero cerró');
    assert.equal(r2.error, null, r2.error ? `cierre 2: ${r2.error.message}` : 'el segundo NO propaga unique_violation');
    assert.equal(r1.data, r2.data, 'los dos devuelven el MISMO snapshot (el que ganó la carrera)');
    const { data: rows } = await admin.from('rodeo_campaign_snapshots')
      .select('id').eq('rodeo_id', race.rodeo.id).eq('campaign_year', CC_YEAR).is('reopened_at', null);
    assert.equal((rows || []).length, 1, 'y NUNCA quedan dos fotos vigentes de la misma campaña');

    // (b) RCC.11.10 — DOS `close_campaign` en la MISMA transacción. Es el requisito que existe SOLO para el
    // runbook del re-seed (§9) y que no tenía test: por PostgREST cada RPC es su propia transacción, así que
    // el `42P07` de las temporales (`on commit drop` limpia al COMMIT, no al salir de la función) no se
    // puede reproducir desde el cliente. Se ejercita por el mismo transporte que usa el leader, con
    // impersonación —igual que el paso 5 del runbook— y **`rollback` al final**: el oráculo corre, y el
    // estado de la DB no se mueve ni un byte. Si el crear-o-truncar estuviera mal, esto muere con 42P07 acá
    // y no en T74 con las 4 migraciones ya aplicadas.
    const tx1 = await seedProbeScenario('tx1');
    const tx2 = await seedProbeScenario('tx2');
    await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: tx2.rodeo.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.length === 3,
    );
    const twoInOne = await adminQuery(`
      begin;
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"${userA.id}","role":"authenticated"}';
      select public.close_campaign('${tx1.rodeo.id}'::uuid, ${CC_YEAR}, true) as snap1;
      select public.close_campaign('${tx2.rodeo.id}'::uuid, ${CC_YEAR}, true) as snap2;
      reset role;
      rollback;
    `);
    // El transporte devuelve la salida de la ÚLTIMA sentencia con filas; lo que importa es que ninguna de
    // las dos haya reventado (adminQuery tira si el HTTP no es 2xx, o sea si el 42P07 ocurrió).
    assert.ok(Array.isArray(twoInOne), 'dos close_campaign en la misma transacción no fallan (RCC.11.10)');
    // Y el rollback dejó todo como estaba: ninguna de las dos campañas quedó cerrada.
    assert.equal(await snapshotOf(tx1.rodeo.id, CC_YEAR), null, 'el rollback no dejó rastro (rodeo 1)');
    assert.equal(await snapshotOf(tx2.rodeo.id, CC_YEAR), null, 'el rollback no dejó rastro (rodeo 2)');
  });

  // ── TR.14e — grants de TABLA (Gate 1 H-2b, BLOQUEANTE) ────────────────────────────────────────────────
  await t.test('TR.14e (campañas congeladas) un authenticated NO escribe en las 3 tablas nuevas', async () => {
    // Es el guard del invariante que sostiene DP-19 (la RLS de las tablas de snapshot scopea por la columna
    // denormalizada porque NO hay camino de escritura del cliente). Si mañana alguien agrega un `grant
    // insert` "para el import", esto se pone rojo ANTES de que la frontera se caiga.
    // Los payloads son COMPLETOS y VÁLIDOS a propósito: con uno incompleto, un `insert` rechazado por
    // `23502 not-null` se vería igual de "rechazado" que uno rechazado por permisos, y el test pasaría por
    // la razón equivocada el día que alguien agregue el grant.
    const s = await seedProbeScenario('grants');
    const payloads = {
      rodeo_membership_history: {
        animal_profile_id: s.cows[0].profile.id, rodeo_id: s.rodeo.id, establishment_id: estA,
        from_date: daysAgo(1), to_date: null, reason: 'move',
      },
      rodeo_campaign_snapshots: {
        rodeo_id: s.rodeo.id, campaign_year: CC_YEAR - 3, establishment_id: estA,
        is_configured: true, n_months: 2, serviced: 1, retired: 0, entoradas: 1, pregnant: 1, empty: 0,
        calved: 0, pending_pregnant: 1, calving_status: 'ok', ccl_head: 1, ccl_body: 0, ccl_tail: 0,
        ccl_total: 1, born_head: 0, born_body: 0, born_tail: 0, born_total: 0, weaned: 0,
        pending_weaning: 0, weaning_status: 'ok',
      },
      rodeo_campaign_snapshot_animals: {
        snapshot_id: crypto.randomUUID(), establishment_id: estA, bucket: 'serviced',
        animal_profile_id: s.cows[0].profile.id,
      },
    };
    for (const [tbl, payload] of Object.entries(payloads)) {
      const ins = await clientA.from(tbl).insert(payload);
      assert.notEqual(ins.error, null, `${tbl}: insert de authenticated RECHAZADO`);
      // El regex NO acepta "no existe la tabla": las 3 tablas SÍ están en el schema cache (authenticated
      // tiene SELECT), así que el rechazo legítimo es de PERMISOS. Aceptar "not find" dejaría el oráculo
      // verde el día que alguien dropee una tabla, que es lo contrario de lo que este test protege.
      assert.match(pgcode(ins.error), /42501|permission denied|violates row-level/i,
        `${tbl}: insert rechazado por PERMISOS (no por una constraint de datos ni por una tabla ausente)`);
      const upd = await clientA.from(tbl).update({ establishment_id: estB }).eq('establishment_id', estA);
      assert.notEqual(upd.error, null, `${tbl}: update de authenticated RECHAZADO`);
      assert.match(pgcode(upd.error), /42501|permission denied|violates row-level/i,
        `${tbl}: update rechazado por PERMISOS. Recibido: ${pgcode(upd.error)}`);
      const del = await clientA.from(tbl).delete().eq('establishment_id', estA);
      assert.notEqual(del.error, null, `${tbl}: delete de authenticated RECHAZADO`);
      assert.match(pgcode(del.error), /42501|permission denied|violates row-level/i,
        `${tbl}: delete rechazado por PERMISOS. Recibido: ${pgcode(del.error)}`);
    }
    // el caso que más importa: insertar una cabecera con el establishment_id de OTRO tenant.
    const spoof = await clientA.from('rodeo_campaign_snapshots').insert({
      rodeo_id: crypto.randomUUID(), campaign_year: CC_YEAR, establishment_id: estB,
      is_configured: true, n_months: 1, serviced: 1, retired: 0, entoradas: 1, pregnant: 1, empty: 0,
      calved: 0, pending_pregnant: 1, calving_status: 'ok', ccl_head: 1, ccl_body: 0, ccl_tail: 0, ccl_total: 1,
      born_head: 0, born_body: 0, born_tail: 0, born_total: 0, weaned: 0, pending_weaning: 0, weaning_status: 'ok',
    });
    assert.notEqual(spoof.error, null, 'insert con el establishment_id de OTRO tenant → rechazado');
    assert.match(pgcode(spoof.error), /42501|permission denied|violates row-level/i,
      `el spoof lo tiene que frenar el PERMISO (no una FK ni un not-null). Recibido: ${pgcode(spoof.error)}`);

    // y las policies de las 3 tablas son EXCLUSIVAMENTE de SELECT.
    const pols = await adminQuery(`
      select tablename, policyname, cmd from pg_policies
      where schemaname = 'public'
        and tablename in ('rodeo_membership_history','rodeo_campaign_snapshots','rodeo_campaign_snapshot_animals')
      order by tablename, policyname;
    `);
    assert.ok(pols.length >= 3, 'las 3 tablas tienen su policy de SELECT');
    for (const p of pols) {
      assert.equal(p.cmd, 'SELECT', `${p.tablename}.${p.policyname}: la policy es de SELECT y nada más`);
    }

    // ── EL ACL CRUDO (Gate 2 H-C1) — la mitad que los dos asserts de arriba NO pueden ver ───────────────
    // PostgREST no expone TRUNCATE y `pg_policies` no tiene fila de TRUNCATE (no existe la categoría), así
    // que probar por COMPORTAMIENTO es estructuralmente ciego a un grant de TRUNCATE. Y el pg_default_acl de
    // este proyecto concede `Dxtm` (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) a anon y authenticated en TODA
    // tabla que `postgres` cree en `public`: sin el `revoke all` explícito de 0127/0128, las 3 tablas nacen
    // TRUNCATE-ables por cualquier authenticated — y un TRUNCATE borra las filas de TODOS los tenants de una,
    // con la RLS en verde, sobre una tabla que se presenta como append-only y auditable a tres años.
    // Este assert resuelve el VALOR del ACL, igual que TR.14b hace con los ACL de función.
    // SABE FALLAR: sin los `revoke`, `anon_trunc` y `auth_trunc` dan true.
    const acl = await adminQuery(`
      select c.relname,
             has_table_privilege('anon',          c.oid, 'TRUNCATE') as anon_trunc,
             has_table_privilege('authenticated', c.oid, 'TRUNCATE') as auth_trunc,
             has_table_privilege('anon',          c.oid, 'INSERT')   as anon_ins,
             has_table_privilege('authenticated', c.oid, 'INSERT')   as auth_ins,
             has_table_privilege('authenticated', c.oid, 'UPDATE')   as auth_upd,
             has_table_privilege('authenticated', c.oid, 'DELETE')   as auth_del,
             has_table_privilege('anon',          c.oid, 'SELECT')   as anon_sel,
             has_table_privilege('authenticated', c.oid, 'SELECT')   as auth_sel
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('rodeo_membership_history','rodeo_campaign_snapshots','rodeo_campaign_snapshot_animals')
      order by 1;
    `);
    assert.equal(acl.length, 3, 'las 3 tablas del delta existen en el catálogo');
    for (const t of acl) {
      assert.equal(t.anon_trunc, false, `${t.relname}: anon NO puede TRUNCATE (la RLS no lo podría tapar)`);
      assert.equal(t.auth_trunc, false, `${t.relname}: authenticated NO puede TRUNCATE`);
      assert.equal(t.anon_ins, false, `${t.relname}: anon NO puede INSERT`);
      assert.equal(t.auth_ins, false, `${t.relname}: authenticated NO puede INSERT (ACL, no solo RLS)`);
      assert.equal(t.auth_upd, false, `${t.relname}: authenticated NO puede UPDATE (ACL)`);
      assert.equal(t.auth_del, false, `${t.relname}: authenticated NO puede DELETE (ACL)`);
      assert.equal(t.anon_sel, false, `${t.relname}: anon no lee ni con RLS de por medio`);
      // el único privilegio que SÍ tiene que estar (control de no-vacuidad del assert de arriba).
      assert.equal(t.auth_sel, true, `${t.relname}: authenticated SÍ lee (si no, el reporte no se puede leer)`);
    }
  });

  // ── TR.14h — procedencia ESTRUCTURAL del tenant (RCC.4.8.b + Gate 1 N-6) ──────────────────────────────
  await t.test('TR.14h (campañas congeladas) FK compuesta: el tenant del detalle no puede divergir del de su cabecera', async () => {
    const s = await seedProbeScenario('fk');
    await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.length === 3,
    );
    const closed = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(closed.error, null, 'cerrada');

    // service_role (que bypassea la RLS) intenta escribir una fila de detalle con OTRO establishment_id:
    // las FK se enforcen para TODOS los roles, así que la escritura privilegiada tampoco puede desalinear.
    //
    // ⚠ LA FILA TIENE QUE SER ÚNICA-SAFE, o el test no prueba lo que dice. La primera versión reusaba
    // `s.cows[0]` en el bucket `serviced`, que YA está en el detalle: el índice único
    // `(snapshot_id, bucket, animal_profile_id)` la rechazaba con **23505 antes de llegar a la FK**. La fila
    // se rechazaba igual, pero el test no distinguía "la FK funciona" de "la FK no está y me salvó el
    // índice" — que es exactamente lo que la FK compuesta existe para garantizar de forma estructural. Lo
    // destapó el apply (el error real fue 23505, no 23503). Se usa un perfil que NO está en el snapshot, así
    // que la única cosa capaz de rechazar la fila es la FK compuesta.
    const outsider = await createAnimal(clientA, {
      idv: `${RUN_TAG}_fk_out`, sex: 'female', birthDate: daysAgo(1800), rodeoId: s.rodeo.id,
      establishmentId: estA, systemId: s.rodeo.systemId, categoryCode: 'multipara', entryDate: daysAgo(2),
    });
    const bad = await admin.from('rodeo_campaign_snapshot_animals').insert({
      snapshot_id: closed.data, establishment_id: estB, bucket: 'serviced',
      animal_profile_id: outsider.profile.id,
    });
    assert.notEqual(bad.error, null, 'detalle con tenant distinto al de su cabecera → rechazado');
    assert.match(pgcode(bad.error), /23503|foreign key/i,
      `lo rechaza la FK COMPUESTA (23503), no el índice único ni un test. Recibido: ${pgcode(bad.error)}`);

    // CONTRAFACTUAL — la MISMA fila con el tenant CORRECTO entra sin error. Sin esto, el assert de arriba
    // seguiría verde el día que alguien borre la FK y algún otro constraint rechace la fila por otro motivo:
    // es la diferencia entre "la fila no entró" y "la fila no entró POR EL TENANT".
    const good = await admin.from('rodeo_campaign_snapshot_animals').insert({
      snapshot_id: closed.data, establishment_id: estA, bucket: 'serviced',
      animal_profile_id: outsider.profile.id,
    });
    assert.equal(good.error, null,
      good.error ? `la misma fila con el tenant correcto DEBE entrar: ${good.error.message}` : 'entra');
    // Se limpia: el detalle tiene que seguir cuadrando con los números congelados de su cabecera (RCC.4.7).
    const { error: cleanErr } = await admin.from('rodeo_campaign_snapshot_animals')
      .delete().eq('snapshot_id', closed.data).eq('animal_profile_id', outsider.profile.id);
    assert.equal(cleanErr, null, 'la fila del contrafactual se limpia');

    // Las DOS columnas de la FK compuesta son NOT NULL: con MATCH SIMPLE (el default), un NULL en cualquiera
    // DESACTIVA el chequeo en silencio y la garantía estructural se evapora sin que nada se ponga rojo.
    const cols = await adminQuery(`
      select column_name, is_nullable from information_schema.columns
      where table_schema='public' and table_name='rodeo_campaign_snapshot_animals'
        and column_name in ('snapshot_id','establishment_id');
    `);
    assert.equal(cols.length, 2, 'las 2 columnas de la FK existen');
    for (const c of cols) assert.equal(c.is_nullable, 'NO', `${c.column_name} es NOT NULL (MATCH SIMPLE)`);

    // TR.14h-bis (Gate 1 N-6): el eslabón de ARRIBA —cabecera ↔ rodeo— NO tiene constraint (DP-33: abajo por
    // constraint, arriba por test). Invariante sobre TODA fila de la tabla, no solo las de este run.
    const drift = await adminQuery(`
      select count(*)::int as n
      from public.rodeo_campaign_snapshots s
      join public.rodeos r on r.id = s.rodeo_id
      where s.establishment_id <> r.establishment_id;
    `);
    assert.equal(drift[0].n, 0, 'ninguna cabecera tiene un establishment_id distinto al de su rodeo');
  });

  // ── TR.14f — el helper de authz con el rol CADUCADO (Gate 1 H-3, BLOQUEANTE) ──────────────────────────
  await t.test('TR.14f (campañas congeladas) is_owner_or_vet_of: el rol correcto pero caducado tampoco pasa', async () => {
    // Se testeaba que el rol EQUIVOCADO no pase (TR.14). Faltaba lo simétrico: que el rol CORRECTO pero
    // caducado tampoco. Sin `ur.active = true` en el helper, un owner revocado seguiría congelando los
    // reportes del campo del que lo echaron — una escritura irreversible en la práctica.
    const userGone = await createTestUser('userGone');
    await assignRoleAsService(userGone.id, estA, 'owner');
    const clientGone = await getUserClient(userGone.email);
    const s = await seedProbeScenario('revoked');

    // control de no-vacuidad: con el rol ACTIVO, el status funciona.
    const okStatus = await campaignStatus(clientGone, s.rodeo.id, CC_YEAR);
    assert.equal(okStatus.error, null, 'control: con el rol activo, el owner lee el estado');

    // (a) rol desactivado → 42501 en las tres. ORÁCULO GENUINO: si el helper se escribe sin `ur.active`,
    // este bloque se pone rojo.
    const { error: deactErr } = await admin.from('user_roles')
      .update({ active: false }).eq('user_id', userGone.id).eq('establishment_id', estA);
    assert.equal(deactErr, null, deactErr ? `desactivar rol: ${deactErr.message}` : 'rol desactivado');
    const gClose = await closeCampaign(clientGone, s.rodeo.id, CC_YEAR, true);
    assert.match(pgcode(gClose.error), /42501|not authorized/i, 'owner con user_roles.active=false NO cierra');
    const gReopen = await reopenCampaign(clientGone, s.rodeo.id, CC_YEAR);
    assert.match(pgcode(gReopen.error), /42501|not authorized/i, 'owner con user_roles.active=false NO reabre');
    const gStatus = await campaignStatus(clientGone, s.rodeo.id, CC_YEAR);
    assert.match(pgcode(gStatus.error), /42501|not authorized/i, 'y has_role_in lo rechaza igual para leer');

    // (b) owner de un establecimiento con deleted_at no nulo → 42501.
    // ⚠ ESTE CASO HOY NO PUEDE FALLAR, y va rotulado (Gate 1 N-4 / RCC.13.5.c.i): la migración 0076
    // desactiva TODOS los user_roles al soft-deletear un establecimiento y prohíbe reactivarlos, así que el
    // estado que describe —owner ACTIVO de un campo BORRADO— es INALCANZABLE, ni siquiera por service_role
    // (son triggers de tabla). El rechazo lo produce `ur.active = false`, no el join a `establishments`, y
    // pasaría igual si el helper no tuviera ese join. NO se borra ni se disfraza: prueba la cadena de 0076
    // (soft-delete → rol desactivado → 42501), que es valiosa como test de integración, y se vuelve
    // load-bearing el día que exista el flujo de restore de campo que 0076 difiere. La única observación
    // disponible de la cláusula en sí es textual y está en TR.14g.
    const userDel = await createTestUser('userDel');
    const clientDel = await getUserClient(userDel.email);
    const estDel = await createEstablishmentAs(clientDel, `${RUN_TAG} estDel`);
    const rDel = await createRodeo(clientDel, { establishmentId: estDel, name: 'R del' });
    const { error: delErr } = await admin.from('establishments')
      .update({ deleted_at: new Date().toISOString() }).eq('id', estDel);
    assert.equal(delErr, null, delErr ? `soft-delete est: ${delErr.message}` : 'establecimiento borrado');
    const dClose = await closeCampaign(clientDel, rDel.id, CC_YEAR, true);
    assert.match(pgcode(dClose.error), /42501|P0002|not authorized|not found/i,
      'owner de un establecimiento borrado NO cierra (por 0076, vía ur.active)');
    const dStatus = await campaignStatus(clientDel, rDel.id, CC_YEAR);
    assert.notEqual(dStatus.error, null, 'ni lee el estado');
    assert.match(pgcode(dStatus.error), /42501|P0002|not authorized|not found/i,
      `el rechazo tiene que ser de authz/existencia. Recibido: ${pgcode(dStatus.error)}`);
  });

  // ── TR.14g — guard de CATÁLOGO (no textual salvo donde no hay otra cosa) — RCC.13.5.d ─────────────────
  await t.test('TR.14g (campañas congeladas) catálogo: security definer, volatilidad y search_path de todo el delta', async () => {
    const rows = await adminQuery(`
      select p.proname, p.prosecdef, p.provolatile::text as vol,
             coalesce(array_to_string(p.proconfig, ','), '') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'is_owner_or_vet_of','animal_category_at','campaign_tacto_bounds','campaign_cycle_complete',
        'campaign_missing_summary','rodeo_campaign_tacto','rodeo_campaign_births','rodeo_campaign_calves',
        'rodeo_serviced_females','rodeo_repro_denominator','rodeo_pregnancy_kpi','rodeo_calving_kpi',
        'rodeo_ccl_distribution','rodeo_calving_by_stage','rodeo_weaning_kpi',
        'close_campaign','reopen_campaign','rodeo_campaign_status')
      order by 1;
    `);
    const by = new Map(rows.map((r) => [r.proname, r]));
    // search_path fijado en TODAS las funciones del delta (incluidas las puras).
    for (const [name, r] of by) {
      assert.match(r.cfg, /search_path/, `${name}: tiene search_path fijado en proconfig`);
    }
    // SECURITY DEFINER en todas las que TOCAN DATOS. Las tres puras (campaign_tacto_bounds /
    // campaign_cycle_complete / campaign_missing_summary) NO son definer a propósito (design §3.2/§4.1-bis:
    // operan sobre los valores que les pasa el caller, no hay nada que autorizar) y están revocadas de los
    // tres roles, así que no son alcanzables. La lista de acá es la reconciliación de T48-ε con ese diseño.
    const mustBeDefiner = ['is_owner_or_vet_of', 'animal_category_at', 'rodeo_campaign_tacto',
      'rodeo_campaign_births', 'rodeo_campaign_calves', 'rodeo_serviced_females', 'rodeo_repro_denominator',
      'rodeo_pregnancy_kpi', 'rodeo_calving_kpi', 'rodeo_ccl_distribution', 'rodeo_calving_by_stage',
      'rodeo_weaning_kpi', 'close_campaign', 'reopen_campaign', 'rodeo_campaign_status'];
    for (const name of mustBeDefiner) {
      assert.ok(by.has(name), `${name}: existe`);
      assert.equal(by.get(name).prosecdef, true, `${name}: SECURITY DEFINER`);
    }
    // Volatilidad: las de lectura STABLE; las DOS de escritura NO stable (declararlas STABLE dejaría a
    // Postgres cachear/reordenar una escritura) y con pg_temp en el search_path.
    const mustBeStable = ['is_owner_or_vet_of', 'rodeo_serviced_females', 'rodeo_repro_denominator',
      'rodeo_pregnancy_kpi', 'rodeo_calving_kpi', 'rodeo_ccl_distribution', 'rodeo_calving_by_stage',
      'rodeo_weaning_kpi', 'rodeo_campaign_status'];
    for (const name of mustBeStable) assert.equal(by.get(name).vol, 's', `${name}: STABLE`);
    for (const name of ['close_campaign', 'reopen_campaign']) {
      assert.notEqual(by.get(name).vol, 's', `${name}: NO es STABLE (escribe)`);
      assert.match(by.get(name).cfg, /pg_temp/, `${name}: pg_temp explícito y último en el search_path`);
    }

    // La ÚNICA observación disponible de `e.deleted_at is null` en is_owner_or_vet_of es TEXTUAL, porque su
    // comportamiento está enmascarado por 0076 (ver TR.14f(b)). La regla del repo ("resolver el valor, no el
    // texto") existe porque un guard textual se burla escribiendo el valor de otra forma — pero acá no hay
    // valor que resolver: no hay estado alcanzable en el que la cláusula cambie el resultado. Cuando el
    // texto es lo único observable, se dice y se usa; fingir cobertura con un test que pasa por otro motivo
    // sería peor.
    const src = (await adminQuery(`
      select pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='is_owner_or_vet_of')) as src;
    `))[0].src.toLowerCase();
    assert.match(src, /ur\.active\s*=\s*true/, 'is_owner_or_vet_of exige ur.active = true');
    assert.match(src, /join\s+public\.establishments\s+e/, 'is_owner_or_vet_of joinea establishments');
    assert.match(src, /e\.deleted_at\s+is\s+null/, 'is_owner_or_vet_of exige e.deleted_at is null (0005)');
    assert.match(src, /ur\.role\s+in\s*\(\s*'owner'\s*,\s*'veterinarian'\s*\)/, 'y el único cambio es el rol');

    // RCC.9.12 / DP-28 — `closed_by_name` sale de `user_roles.member_name` DE ESE ESTABLECIMIENTO y NUNCA de
    // la tabla global `users`. Mismo caso que la cláusula de arriba: la observación posible es TEXTUAL,
    // porque "qué tabla lee un cuerpo plpgsql" no está en el catálogo (`pg_depend` no registra las
    // referencias a tablas dentro de un cuerpo: se resuelven en runtime). Rotulado como tal, igual que el
    // guard de `session_id` de TR.17 — que es de la misma clase y este repo ya aceptó.
    const statusSrc = (await adminQuery(`
      select pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname='public' and p.proname='rodeo_campaign_status')) as src;
    `))[0].src.toLowerCase();
    assert.match(statusSrc, /user_roles/, 'rodeo_campaign_status resuelve el nombre por user_roles');
    assert.match(statusSrc, /member_name/, 'y por la columna denormalizada member_name (ADR-026 c2 / 0080)');
    assert.ok(!/\bpublic\.users\b/.test(statusSrc),
      'y NO lee la tabla global `users` desde un SECURITY DEFINER (RCC.9.12): sería una lectura cross-tenant');
  });

  // ── TR.14b — grants de FUNCIÓN: las internas no son alcanzables por authenticated (RCC.13.6) ──────────
  await t.test('TR.14b (campañas congeladas) authenticated NO ejecuta las 7 funciones internas', async () => {
    const internals = [
      ['rodeo_campaign_tacto', { p_rodeo_id: crypto.randomUUID(), p_year: CC_YEAR }],
      ['rodeo_campaign_births', { p_rodeo_id: crypto.randomUUID(), p_year: CC_YEAR }],
      ['rodeo_campaign_calves', { p_rodeo_id: crypto.randomUUID(), p_year: CC_YEAR }],
      ['animal_category_at', { p_profile_id: crypto.randomUUID(), p_on: daysAgo(1) }],
      ['campaign_tacto_bounds', { p_months: [6, 7], p_year: CC_YEAR }],
      ['campaign_cycle_complete', { p_weaning_status: 'ok', p_pending_weaning: 0, p_state_as_of: daysAgo(1) }],
      ['campaign_missing_summary', { p_calving_status: 'ok', p_pending_pregnant: 0, p_weaning_status: 'ok', p_pending_weaning: 0 }],
    ];
    for (const [fn, args] of internals) {
      const { error } = await clientA.rpc(fn, args);
      assert.notEqual(error, null, `${fn}: authenticated NO debe poder ejecutarla (RCC.9.5)`);
      assert.match(pgcode(error), /permission denied|not find|does not exist|404|PGRST/i, `${fn}: revocada`);
    }
    // y el estado del catálogo lo confirma sin depender de cómo responda PostgREST.
    const priv = await adminQuery(`
      select p.proname,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('public', p.oid, 'EXECUTE') as pub
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ('rodeo_campaign_tacto','rodeo_campaign_births',
        'rodeo_campaign_calves','animal_category_at','campaign_tacto_bounds','campaign_cycle_complete',
        'campaign_missing_summary');
    `);
    assert.equal(priv.length, 7, 'las 7 internas existen');
    for (const p of priv) {
      assert.equal(p.auth, false, `${p.proname}: sin EXECUTE para authenticated`);
      assert.equal(p.anon, false, `${p.proname}: sin EXECUTE para anon`);
      assert.equal(p.pub, false, `${p.proname}: sin EXECUTE para public`);
    }
  });

  // ── TR.14c — el cierre NO muta datos de negocio (RCC.5.9 / RCC.13.12) ─────────────────────────────────
  await t.test('TR.14c (campañas congeladas) close_campaign no toca animales ni eventos', async () => {
    const s = await seedProbeScenario('nomut');
    await eventually(
      async () => await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR }),
      (res) => res && res.data && res.data.length === 3,
    );
    const counts = async () => {
      const { count: p } = await admin.from('animal_profiles').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
      const { count: e } = await admin.from('reproductive_events').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
      const { count: w } = await admin.from('weight_events').select('id', { count: 'exact', head: true }).eq('establishment_id', estA);
      return { p, e, w };
    };
    const before = await counts();
    const res = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(res.error, null, res.error ? `close: ${res.error.message}` : 'cerró');
    const after = await counts();
    assert.deepStrictEqual(after, before, 'el cierre no crea ni borra perfiles, eventos reproductivos ni pesos');
  });

  // ── TR.15 — historia de membresía (RCC.1.*, RCC.13.7, RCC.13.13) ──────────────────────────────────────
  await t.test('TR.15 (campañas congeladas) membresía: apertura, movimiento, baja, invariante, backfill, RLS', async () => {
    const r1 = await createRodeo(clientA, { establishmentId: estA, name: 'R memb 1' });
    const r2 = await createRodeo(clientA, { establishmentId: estA, name: 'R memb 2' });
    const rowsOf = async (profileId) => {
      const { data, error } = await admin.from('rodeo_membership_history')
        .select('*').eq('animal_profile_id', profileId).order('from_date', { ascending: true });
      if (error) throw new Error(`rowsOf: ${error.message}`);
      return data || [];
    };

    // (1) alta CON entry_date → una fila abierta desde el entry_date.
    const withEntry = await createAnimal(clientA, { idv: `${RUN_TAG}_mb1`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r1.id, establishmentId: estA, systemId: r1.systemId, categoryCode: 'multipara', entryDate: CC_ENTRY });
    let rows = await rowsOf(withEntry.profile.id);
    assert.equal(rows.length, 1, 'alta → 1 fila de membresía');
    assert.equal(rows[0].from_date, CC_ENTRY, 'from_date = entry_date (RCC.1.4)');
    assert.equal(rows[0].to_date, null, 'to_date null = vigente');
    assert.equal(rows[0].rodeo_id, r1.id, 'apunta al rodeo del alta');
    assert.equal(rows[0].establishment_id, estA, 'establishment_id derivado de la fila padre (RCC.1.12)');
    assert.equal(rows[0].reason, 'initial', 'reason = initial');

    // (2) alta SIN entry_date → from_date = hoy (created_at::date).
    const noEntry = await createAnimal(clientA, { idv: `${RUN_TAG}_mb2`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r1.id, establishmentId: estA, systemId: r1.systemId, categoryCode: 'multipara', entryDate: null });
    rows = await rowsOf(noEntry.profile.id);
    assert.equal(rows.length, 1, 'alta sin entry_date → 1 fila');
    assert.equal(rows[0].from_date, daysAgo(0), 'from_date = hoy (coalesce a created_at)');

    // (3) MOVIMIENTO de rodeo → cierra la vigente HOY y abre una nueva HOY.
    await moveProfileToRodeo(withEntry.profile.id, r2.id);
    rows = await rowsOf(withEntry.profile.id);
    assert.equal(rows.length, 2, 'mover → 2 filas');
    assert.equal(rows[0].to_date, daysAgo(0), 'la vieja se cierra hoy (intervalo medio-abierto)');
    assert.equal(rows[1].rodeo_id, r2.id, 'la nueva apunta al rodeo destino');
    assert.equal(rows[1].to_date, null, 'la nueva queda vigente');
    assert.equal(rows[1].reason, 'move', 'reason = move');
    // un UPDATE de rodeo_id que NO cambia nada no escribe (is distinct from).
    await moveProfileToRodeo(withEntry.profile.id, r2.id);
    assert.equal((await rowsOf(withEntry.profile.id)).length, 2, 'un update que no cambia el rodeo no escribe');

    // (4) BAJA con exit_date → cierra la vigente con to_date = exit_date.
    const exitDate = daysAgo(3);
    await sellProfile(noEntry.profile.id, exitDate);
    rows = await rowsOf(noEntry.profile.id);
    assert.equal(rows.length, 1, 'la baja no abre filas nuevas');
    assert.equal(rows[0].to_date, daysAgo(0), 'to_date = greatest(exit_date, from_date) — el CHECK no se viola');

    // (5) INVARIANTE de una sola fila vigente: un segundo `to_date is null` → 23505.
    const dup = await admin.from('rodeo_membership_history').insert({
      animal_profile_id: withEntry.profile.id, rodeo_id: r1.id, establishment_id: estA,
      from_date: daysAgo(0), to_date: null, reason: 'move',
    });
    assert.match(pgcode(dup.error), /23505|duplicate key/i, 'dos membresías vigentes a la vez → 23505 (RCC.1.3)');

    // (6) BACKFILL idempotente: re-correrlo acotado al establecimiento no duplica ni una fila.
    const before = await adminQuery(`select count(*)::int as n from public.rodeo_membership_history h
      join public.animal_profiles p on p.id = h.animal_profile_id where p.establishment_id = '${estA}';`);
    await adminQuery(`
      insert into public.rodeo_membership_history
        (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
      select p.id, p.rodeo_id, p.establishment_id,
             coalesce(p.entry_date, p.created_at::date),
             case when p.status = 'active' and p.deleted_at is null then null
                  else greatest(coalesce(p.exit_date, current_date),
                                coalesce(p.entry_date, p.created_at::date)) end,
             'backfill', null
      from public.animal_profiles p
      where p.establishment_id = '${estA}'
        and not exists (select 1 from public.rodeo_membership_history h where h.animal_profile_id = p.id);
    `);
    const after = await adminQuery(`select count(*)::int as n from public.rodeo_membership_history h
      join public.animal_profiles p on p.id = h.animal_profile_id where p.establishment_id = '${estA}';`);
    assert.equal(after[0].n, before[0].n, 'el backfill corrido dos veces NO duplica (RCC.1.8)');

    // (7) RLS: el owner de B no ve las filas de A.
    const { data: bSees } = await clientB.from('rodeo_membership_history')
      .select('id').eq('animal_profile_id', withEntry.profile.id);
    assert.equal((bSees || []).length, 0, 'owner de B no ve la membresía de A (RCC.1.11)');

    // (8) el par CRUZADO entre establecimientos nunca llega a esta tabla: apuntar el rodeo_id de un perfil
    // de A a un rodeo de B lo rechaza la base con 23514 (tg_animal_profiles_rodeo_check, 0021:25-43). Es lo
    // que hace que `mh.rodeo_id` no pueda ser una vía de fuga aunque el CTE `member` no filtre tenant — la
    // frontera de tenant sigue siendo `p.establishment_id = v_est` (§5.5).
    const rB = await createRodeo(clientB, { establishmentId: estB, name: 'R memb B' });
    const cross = await admin.from('animal_profiles')
      .update({ rodeo_id: rB.id }).eq('id', withEntry.profile.id);
    assert.match(pgcode(cross.error), /23514/i, 'perfil de A apuntado a un rodeo de B → 23514 (0021)');
  });

  // ── TR.16 — DL10: el dato que llega tarde a una campaña cerrada (RCC.8.*, RCC.13.8) ───────────────────
  await t.test('TR.16 (campañas congeladas) DL10: el dato tardío entra, no mueve la foto, y se avisa', async () => {
    const s = await seedProbeScenario('dl10');
    const t0 = await eventually(
      async () => await kpiBundle(clientA, s.rodeo.id, CC_YEAR),
      (b) => b && b.preg.pregnant === 3,
    );
    const first = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(first.error, null, 'cerrada');

    // (1) el evento de una campaña cerrada NO se rechaza: el offline-first no se rompe (no hay trigger).
    await seedTacto(clientA, s.cows[0].profile.id, dateOn(CC_YEAR + 1, 2, 15), 'empty');

    // (2) los KPI no se mueven.
    const t1 = await kpiBundle(clientA, s.rodeo.id, CC_YEAR);
    assert.deepStrictEqual(t1, t0, 'el dato tardío no mueve la foto');

    // (3) …pero la pantalla se entera.
    const st = await eventually(
      async () => await campaignStatus(clientA, s.rodeo.id, CC_YEAR),
      (r) => r && r.status && r.status.has_new_data === true,
    );
    assert.equal(st.status.has_new_data, true, 'has_new_data = true (RCC.8.3)');

    // (4) reabrir + volver a cerrar: AHORA sí lo incorpora, con un snapshot NUEVO y el viejo con reopened_at.
    const reop = await reopenCampaign(clientA, s.rodeo.id, CC_YEAR);
    assert.equal(reop.error, null, reop.error ? `reopen: ${reop.error.message}` : 'reabierta');
    const live = await kpiBundle(clientA, s.rodeo.id, CC_YEAR);
    assert.equal(live.preg.pregnant, 2, 'reabierta: el KPI en vivo ya incorpora el tacto de la ventana');
    const second = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(second.error, null, 'cerrada de nuevo');
    assert.notEqual(second.data, first.data, 'el re-cierre crea un snapshot NUEVO (RCC.6.5)');
    const { data: old } = await admin.from('rodeo_campaign_snapshots').select('reopened_at, reopened_by').eq('id', first.data).single();
    assert.ok(old.reopened_at, 'el snapshot viejo QUEDA, marcado con reopened_at (RCC.6.3)');
    assert.ok(old.reopened_by, 'y con reopened_by');
    const t2 = await kpiBundle(clientA, s.rodeo.id, CC_YEAR);
    assert.equal(t2.preg.pregnant, 2, 'la foto nueva ya incorpora el dato tardío');
  });

  // ── TR.17 — regresión "tacto sin jornada" + guard de clase (RCC.12.1, RCC.12.2, RCC.13.11) ────────────
  await t.test('TR.17 (campañas congeladas) un tacto sin session_id sigue contando + ninguna de las 7 mira session_id', async () => {
    const r = await createRodeo(clientA, { establishmentId: estA, name: 'R sin jornada' });
    await setServiceMonths(r.id, CC_MONTHS);
    const m = await createAnimal(clientA, { idv: `${RUN_TAG}_nosess`, sex: 'female', birthDate: daysAgo(1800), rodeoId: r.id, establishmentId: estA, systemId: r.systemId, categoryCode: 'multipara', entryDate: CC_ENTRY });
    await backdateCategoryHistory(m.profile.id, CC_ENTRY);
    await seedTacto(clientA, m.profile.id, dateOn(CC_YEAR, 9, 15), 'large');   // session_id NULL
    const b = await eventually(
      async () => await kpiBundle(clientA, r.id, CC_YEAR),
      (x) => x && x.preg.pregnant === 1,
    );
    assert.equal(b.preg.pregnant, 1, 'el tacto SIN jornada cuenta en preñez');
    assert.equal(b.ccl.total, 1, 'y en la distribución CCL');
    assert.equal(b.servicedCount, 1, 'y la hembra está en el conjunto servidas');

    // GUARD DE CLASE (se escribe sobre la AUSENCIA): ninguna de las 7 puede referenciar session_id. El delta
    // `ficha-categoria-tacto` (spec 02) depende de esto; si alguien se lo agrega, esto se pone rojo.
    const defs = await adminQuery(`
      select p.proname, pg_get_functiondef(p.oid) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname in ('rodeo_serviced_females','rodeo_repro_denominator',
        'rodeo_pregnancy_kpi','rodeo_calving_kpi','rodeo_ccl_distribution','rodeo_calving_by_stage',
        'rodeo_weaning_kpi');
    `);
    assert.equal(defs.length, 7, 'las 7 funciones de campaña existen');
    for (const d of defs) {
      assert.ok(!/session_id/i.test(d.src), `${d.proname}: NO referencia session_id (RCC.12.2)`);
    }
  });

  // ── TR.19 — guard de AUSENCIA en las sync rules (DL8 / RCC.13.10) ─────────────────────────────────────
  await t.test('TR.19 (campañas congeladas) las 3 tablas nuevas NO están en sync-streams/rafaq.yaml', async () => {
    const yamlPath = path.join(REPO_ROOT, 'sync-streams', 'rafaq.yaml');
    const yaml = fs.readFileSync(yamlPath, 'utf8').toLowerCase();   // case-insensitive (Gate 1 L-3)
    for (const tbl of ['rodeo_membership_history', 'rodeo_campaign_snapshots', 'rodeo_campaign_snapshot_animals']) {
      assert.ok(!yaml.includes(tbl), `${tbl} NO debe estar en las sync rules (DL8: no baja a los devices)`);
    }
    // Borde declarado: este guard no ve una edición manual en el dashboard de PowerSync. El header del
    // propio YAML ya declara eso fuera de proceso (los deploys van por scripts/powersync-deploy.sh).
    //
    // Y el borde MÁS IMPORTANTE (Gate 2 M-C1): este guard mira el YAML porque **ahí vive la frontera real**.
    // La publicación `powersync` de este proyecto es FOR ALL TABLES, así que las filas de las 3 tablas SÍ
    // cruzan al slot de replicación — no hay forma de excluirlas — y lo que las mantiene fuera de los
    // DEVICES es que ninguna sync stream las nombra (no hay catch-all). Un guard sobre `pg_publication`
    // sería rojo por diseño y no probaría DL8; este prueba lo que DL8 realmente exige.
    const pub = await adminQuery(`select pubname, puballtables from pg_publication where pubname = 'powersync';`);
    assert.equal(pub.length, 1, 'la publicación powersync existe');
    assert.equal(pub[0].puballtables, true,
      'la publicación es FOR ALL TABLES: si algún día dejara de serlo, la frontera cambia de capa y este ' +
      'comentario (y el comment on table de 0127) hay que reescribirlos');
  });

  // ── TR.20 — consistencia detalle ↔ cabecera (RCC.4.7, RCC.7.2, RCC.13.x) ──────────────────────────────
  await t.test('TR.20 (campañas congeladas) el detalle por animal ES la evidencia del número congelado', async () => {
    // Con IA: el detalle tiene que congelar el `source` REAL de cada fila, no un 'natural' fijo (RCC.2.10).
    const s = await seedProbeScenario('detalle', { withAi: true });
    const t0 = await eventually(
      async () => await kpiBundle(clientA, s.rodeo.id, CC_YEAR),
      (b) => b && b.servicedCount === 4 && b.calv.calved === 1,
    );
    const res = await closeCampaign(clientA, s.rodeo.id, CC_YEAR, true);
    assert.equal(res.error, null, 'cerrada');
    const snap = await snapshotOf(s.rodeo.id, CC_YEAR);

    const expected = {
      serviced: snap.serviced, pregnant: snap.pregnant, empty: snap.empty,
      calved: snap.calved, weaned: snap.weaned,
    };
    for (const [bucket, n] of Object.entries(expected)) {
      const rows = await snapshotDetail(snap.id, bucket);
      assert.equal(rows.length, n, `bucket ${bucket}: ${rows.length} filas == ${n} congelado (RCC.4.7)`);
    }
    // el idv queda CONGELADO en el detalle (sobrevive a la baja del animal).
    const servicedRows = await snapshotDetail(snap.id, 'serviced');
    assert.ok(servicedRows.every((x) => x.idv), 'el detalle congela el identificador legible');
    assert.ok(servicedRows.every((x) => x.establishment_id === estA), 'y el tenant sale de la cabecera');
    // El `source` se congela TAL CUAL lo devolvió el conjunto servidas: 3 multíparas por la rama natural + 1
    // ternera por la rama IA. Un detalle que escribiera 'natural' fijo pasaría el test viejo (`every(...)`).
    assert.equal(servicedRows.filter((x) => x.source === 'natural').length, 3, 'las 3 multíparas, `source` natural');
    assert.equal(servicedRows.filter((x) => x.source === 'ai').length, 1, 'la ternera de IA, `source` ai (RCC.2.10)');
    const aiDetail = servicedRows.find((x) => x.source === 'ai');
    assert.equal(aiDetail.animal_profile_id, s.ai.profile.id, 'y es la que sembró la IA');
    // el snapshot congeló los parámetros del cómputo (F5 + auditoría).
    assert.deepStrictEqual(snap.service_months, CC_MONTHS, 'service_months congelados (F5)');
    assert.equal(snap.state_as_of, CC_CUT, 'la fecha de corte queda auditada (RCC.4.3)');
    assert.equal(snap.tacto_from, dateOn(CC_YEAR, 6, 1), 'ventana del tacto: desde');
    assert.equal(snap.tacto_to, dateOn(CC_YEAR + 1, 5, 31), 'ventana del tacto: hasta');

    // con la campaña cerrada, rodeo_serviced_females devuelve EXACTAMENTE `serviced` filas (RCC.7.2) — y son
    // las del snapshot, no un cómputo en vivo.
    const { data: sf } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR });
    assert.equal((sf || []).length, snap.serviced, 'serviced_females cerrada = el bucket serviced');
    assert.deepStrictEqual((sf || []).map((x) => x.animal_profile_id).sort(), t0.servicedIds,
      'y son los MISMOS animales que antes del cierre');

    // ── EL DETALLE SOBREVIVE A LA BAJA DEL ANIMAL (RCC.4.6 + RCC.7.2) ──────────────────────────────────
    // La FK del detalle es `on delete set null` y NUNCA cascade, y el `idv` queda congelado: borrar un
    // animal NO puede vaciar un reporte cerrado. Hasta acá el test verificaba que el idv está congelado,
    // pero ningún test BORRABA un perfil, así que la mitad que importa —que la fila queda y que
    // `rodeo_serviced_females` sigue devolviendo `serviced` filas, incluida la de `animal_profile_id` nulo—
    // no tenía oráculo. Se borra la ternera de IA (sus eventos cascadean; no es cría de ningún parto).
    const victimId = s.ai.profile.id;
    const victimIdv = servicedRows.find((x) => x.animal_profile_id === victimId).idv;
    const { error: delErr } = await admin.from('animal_profiles').delete().eq('id', victimId);
    assert.equal(delErr, null, delErr ? `borrar el perfil: ${delErr.message}` : 'el perfil se borró');

    const after = await snapshotDetail(snap.id, 'serviced');
    assert.equal(after.length, snap.serviced, 'el detalle NO perdió la fila: sigue teniendo `serviced` filas');
    const orphan = after.find((x) => x.idv === victimIdv);
    assert.ok(orphan, 'la fila del animal borrado SIGUE, identificable por su idv congelado (RCC.4.6)');
    assert.equal(orphan.animal_profile_id, null, 'y su referencia quedó en NULL (`on delete set null`)');
    assert.equal(orphan.source, 'ai', 'con su `source` intacto');

    const { data: sfAfter } = await clientA.rpc('rodeo_serviced_females', { p_rodeo_id: s.rodeo.id, p_year: CC_YEAR });
    assert.equal((sfAfter || []).length, snap.serviced,
      'y la RPC cerrada sigue devolviendo `serviced` filas (RCC.7.2: incluidas las de animal_profile_id nulo)');
    assert.equal((sfAfter || []).filter((x) => x.animal_profile_id === null).length, 1,
      'exactamente una fila con animal_profile_id nulo, la del borrado');
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
      // delta campañas congeladas (RCC.9.5/RCC.13.6): las 3 RPC NUEVAS nacen con EXECUTE a PUBLIC por
      // default de Postgres → el revoke de 0130 es OBLIGATORIO, y esto lo verifica desde afuera.
      ['close_campaign', { p_rodeo_id: ghost, p_year: thisYear(), p_acknowledge_incomplete: false }],
      ['reopen_campaign', { p_rodeo_id: ghost, p_year: thisYear() }],
      ['rodeo_campaign_status', { p_rodeo_id: ghost, p_year: thisYear() }],
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
    const ests = [...createdEstablishmentIds];
    await cleanup();
    // T57 / higiene: las 3 tablas del delta cascadean por `establishments` (FK on delete cascade), así que
    // el cleanup() existente no hace falta tocarlo — pero eso es una afirmación, y las afirmaciones se
    // verifican. Si mañana alguien crea una de estas tablas sin la FK a establishments, esto se pone rojo.
    if (ests.length > 0) {
      const list = ests.map((id) => `'${id}'`).join(',');
      const left = await adminQuery(`
        select
          (select count(*)::int from public.rodeo_membership_history where establishment_id in (${list})) as memb,
          (select count(*)::int from public.rodeo_campaign_snapshots where establishment_id in (${list})) as snaps,
          (select count(*)::int from public.rodeo_campaign_snapshot_animals where establishment_id in (${list})) as det;
      `);
      assert.equal(left[0].memb, 0, 'rodeo_membership_history cascadea con el establecimiento');
      assert.equal(left[0].snaps, 0, 'rodeo_campaign_snapshots cascadea con el establecimiento');
      assert.equal(left[0].det, 0, 'rodeo_campaign_snapshot_animals cascadea con el establecimiento');
    }
  });
});
