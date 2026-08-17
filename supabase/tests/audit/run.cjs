// supabase/tests/audit/run.cjs
// Suite backend del audit forense server-side (spec 18, migración 0124_audit_log.sql).
// Corre contra la base remota: service_role para fixtures, JWTs reales para los asserts de actor/RLS,
// y la Management API (adminQuery, corre como `postgres`) para LEER audit.* (modela el lector forense
// real; audit está cerrado a todo cliente por REVOKE USAGE del schema).
//
// ⚠️ REQUIERE la migración 0124 APLICADA en el remoto (deploy GATEADO a Raf) + las 4 Edge Functions
//    redeployadas. Antes del apply, esta suite FALLA (el schema audit no existe) → el hook en
//    scripts/run-tests.mjs queda COMENTADO hasta el deploy (patrón spec 12/14/M6/tratamientos). El leader
//    la descomenta tras aplicar 0124.
//
// AS-BUILT (reconciliado con la infra real, ver progress/impl_18-audit-log.md):
//   - TRACKED en incremento 1 = SOLO `public.user_roles` (estricto). `animals` va GATEADA (T12/R5.4) →
//     todos los asserts de actor/record_id/op se hacen sobre `user_roles` (que un authenticated SÍ puede
//     escribir directo vía user_roles_insert_self_owner / user_roles_update_owner — 0008 — y el owner-role
//     se auto-inserta al crear un establishment — 0011).
//   - TA.13 (spoof) se ejerce por `user_roles` (Gate 1 watch-item #2: animals no es escribible directo por
//     authenticated y además está gateada).
//   - TA.11 (frontera WAL): la publication `powersync` es FOR ALL TABLES → el frontier real son las SYNC
//     STREAMS (sync-streams/mitropero.yaml). El invariante que se testea es "audit NO referenciada en mitropero.yaml
//     (sin catch-all)", no la membresía en pg_publication_tables (que fallaría bajo FOR ALL TABLES).
//
// Cubre: TA.1–TA.16 del design → R1.3–R1.6, R1.8, R1.11, R2.1, R2.2, R2.6, R2.8, R3.1, R3.2, R3.3, R3.5,
// R3.7, R4.2, R4.3, R5.1, R6.2, R7.1, R7.2, R7.4.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... SUPABASE_PROJECT_REF=...
//      SUPABASE_ACCESS_TOKEN=... node --test run.cjs   (las vars se cargan de <repo>/.env.local si existe)

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
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Faltan vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
  process.exit(2);
}

// Management API (database/query) — corre como `postgres` → único lector de audit.* (cerrado a clientes).
async function adminQuery(sql) {
  if (!PROJECT_REF || !ACCESS_TOKEN) {
    throw new Error('Falta SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN para adminQuery (lectura de audit.*).');
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

const RUN_TAG = `audit_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const createdUserIds = [];
const createdEstablishmentIds = [];

async function createTestUser(label) {
  const email = `${RUN_TAG}_${label}@rafaq-test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { name: `Test ${label}` },
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function getUserClient(email, extraHeaders = null) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(extraHeaders ? { global: { headers: extraHeaders } } : {}),
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createEstablishmentAs(userClient, name) {
  // El INSERT via JWT auto-inserta el user_roles owner (trigger 0011) en la misma transacción → esa
  // fila de user_roles genera su audit INSERT con auth_uid = el creador (TA.2).
  const { error: insErr } = await userClient.from('establishments').insert({ name, province: 'Buenos Aires' });
  if (insErr) throw new Error(`createEstablishment insert(${name}): ${insErr.message}`);
  const { data, error } = await userClient.from('establishments').select('id').eq('name', name).single();
  if (error) throw new Error(`createEstablishment select(${name}): ${error.message}`);
  createdEstablishmentIds.push(data.id);
  return data.id;
}

async function ownerRoleId(userId, establishmentId) {
  const { data, error } = await admin.from('user_roles').select('id')
    .eq('user_id', userId).eq('establishment_id', establishmentId).eq('active', true).single();
  if (error) throw new Error(`ownerRoleId: ${error.message}`);
  return data.id;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Lee filas de audit (via Management API). Reintenta por si hay micro-lag (el trigger inserta en la misma
// transacción del DML, así que en general está disponible de inmediato).
async function auditRows(whereSql, { tries = 5, delay = 300 } = {}) {
  let rows = [];
  for (let i = 0; i < tries; i++) {
    rows = await adminQuery(
      `select id, op, auth_uid, record_id, old_record_id, record, old_record
         from audit.record_version
        where ${whereSql}
        order by id asc;`);
    if (rows.length > 0) return rows;
    await sleep(delay);
  }
  return rows;
}

async function cleanup() {
  // Borrar las filas de audit namespaced que insertó TA.15 (marker en record) + selftest table de TA.14.
  try {
    await adminQuery(`delete from audit.record_version where record ->> '__audit_test' = '${RUN_TAG}';`);
    await adminQuery(`drop table if exists public.${SELFTEST_TABLE};`);
  } catch (e) {
    console.error('cleanup audit rows/selftest:', e.message);
  }
  if (createdEstablishmentIds.length > 0) {
    const { error: estErr } = await admin.from('establishments').delete().in('id', createdEstablishmentIds);
    if (estErr) console.error('cleanup establishments:', estErr.message);
  }
  for (const uid of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

const SELFTEST_TABLE = `audit_selftest_${RUN_TAG}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');

// =====================================================================
// Suite
// =====================================================================

test('audit forense suite — spec 18', async (t) => {
  let ownerA, userB, userD, clientA, estA, roleA_owner;

  await t.after(cleanup);

  // ── TA.1 setup ──────────────────────────────────────────────────────────────────────────────────
  await t.test('TA.1 setup: usuarios + establishment + rol owner de test', async () => {
    ownerA = await createTestUser('ownerA');
    userB = await createTestUser('userB');   // target de TA.12 (insert service_role + header)
    userD = await createTestUser('userD');   // ciclo de vida record_id (TA.4/TA.5/TA.6)
    clientA = await getUserClient(ownerA.email);
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    roleA_owner = await ownerRoleId(ownerA.id, estA);
    assert.ok(roleA_owner, 'debería existir el rol owner auto-insertado');
  });

  // ── TA.2 INSERT uid (JWT path) — R1.3, R2.1 ───────────────────────────────────────────────────────
  await t.test('TA.2 INSERT registra op=INSERT + auth_uid = actor real (JWT)', async () => {
    const rows = await auditRows(
      `table_name = 'user_roles' and op = 'INSERT' and record ->> 'id' = '${roleA_owner}'`);
    assert.equal(rows.length, 1, 'debería haber 1 versión INSERT del rol owner');
    const v = rows[0];
    assert.equal(v.op, 'INSERT');
    assert.equal(v.auth_uid, ownerA.id, 'auth_uid = el creador (auth.uid via JWT)');
    assert.equal(v.old_record, null, 'INSERT: old_record NULL');
    assert.equal(v.record['user_id'], ownerA.id, 'record = la fila nueva');
  });

  // ── TA.3 UPDATE uid (JWT path) — R1.4, R2.1 ───────────────────────────────────────────────────────
  await t.test('TA.3 UPDATE registra op=UPDATE + old/new + auth_uid = actor (JWT)', async () => {
    // El owner actualiza su PROPIA fila de user_roles vía la policy user_roles_update_owner (0008).
    const { error } = await clientA.from('user_roles').update({ active: true }).eq('id', roleA_owner);
    assert.equal(error, null, error && error.message);
    const rows = await auditRows(
      `table_name = 'user_roles' and op = 'UPDATE' and record ->> 'id' = '${roleA_owner}'`);
    assert.ok(rows.length >= 1, 'debería haber ≥1 versión UPDATE del rol owner');
    const v = rows[rows.length - 1];
    assert.equal(v.auth_uid, ownerA.id, 'auth_uid = el owner (auth.uid via JWT)');
    assert.notEqual(v.record, null, 'UPDATE: record (new) presente');
    assert.notEqual(v.old_record, null, 'UPDATE: old_record presente');
  });

  // ── TA.4 DELETE + TA.5 record_id estable + TA.6 actor NULL (service_role sin header) ──────────────
  //    Ciclo de vida completo INSERT→UPDATE→DELETE de UNA fila via admin (service_role, SIN header).
  await t.test('TA.4/TA.5/TA.6 ciclo de vida: DELETE, record_id estable, actor NULL sin header', async () => {
    const roleD = crypto.randomUUID();
    // INSERT (admin sin header → auth_uid NULL, TA.6/R2.2).
    const { error: insErr } = await admin.from('user_roles').insert({
      id: roleD, user_id: userD.id, establishment_id: estA, role: 'field_operator', active: true,
    });
    assert.equal(insErr, null, insErr && insErr.message);
    // UPDATE.
    const { error: updErr } = await admin.from('user_roles').update({ active: false }).eq('id', roleD);
    assert.equal(updErr, null, updErr && updErr.message);
    // DELETE.
    const { error: delErr } = await admin.from('user_roles').delete().eq('id', roleD);
    assert.equal(delErr, null, delErr && delErr.message);

    const rows = await auditRows(
      `table_name = 'user_roles' and (record ->> 'id' = '${roleD}' or old_record ->> 'id' = '${roleD}')`);
    const byOp = Object.fromEntries(rows.map((r) => [r.op, r]));
    assert.ok(byOp.INSERT && byOp.UPDATE && byOp.DELETE, `esperaba INSERT+UPDATE+DELETE, hubo ${rows.map((r) => r.op)}`);

    // TA.4 — DELETE: old_record presente, record NULL.
    assert.equal(byOp.DELETE.record, null, 'DELETE: record NULL');
    assert.equal(byOp.DELETE.old_record['id'], roleD, 'DELETE: old_record = la fila borrada');

    // TA.5 — record_id ESTABLE e idéntico entre las 3 versiones (R1.6). En semántica supa_audit el uuid
    // derivado de la PK vive en `record_id` para INSERT/UPDATE y en `old_record_id` para DELETE (record es
    // NULL en DELETE) → se compara coalesce(record_id, old_record_id).
    const stableIds = new Set(rows.map((r) => r.record_id || r.old_record_id));
    assert.equal(stableIds.size, 1, 'el id estable (record_id/old_record_id) debe ser idéntico entre INSERT/UPDATE/DELETE');
    assert.ok([...stableIds][0], 'el id estable no debe ser NULL (user_roles tiene PK)');
    // Coherencia de columnas por op: DELETE lleva old_record_id (no record_id).
    assert.ok(byOp.DELETE.old_record_id, 'DELETE: old_record_id (id estable de la fila borrada) presente');

    // TA.6 — actor NULL en el write service_role SIN header (R2.2/R7.4b), sin abortar el DML.
    assert.equal(byOp.INSERT.auth_uid, null, 'service_role sin header → auth_uid NULL');
  });

  // ── TA.7 fail-closed anon — R3.2/R3.3 ─────────────────────────────────────────────────────────────
  await t.test('TA.7 anon NO puede leer audit.record_version', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.schema('audit').from('record_version').select('id').limit(1);
    assert.notEqual(error, null, 'anon debería recibir error (schema no expuesto / fail-closed)');
    assert.ok(!data || data.length === 0, 'anon no debería recibir filas');
  });

  // ── TA.8 fail-closed authenticated — R3.2/R3.3 ────────────────────────────────────────────────────
  await t.test('TA.8 authenticated NO puede leer audit.record_version', async () => {
    const { data, error } = await clientA.schema('audit').from('record_version').select('id').limit(1);
    assert.notEqual(error, null, 'authenticated debería recibir error (fail-closed)');
    assert.ok(!data || data.length === 0, 'authenticated no debería recibir filas');
  });

  // ── TA.9 grants de lectura fail-closed — R3.1/R3.7 ────────────────────────────────────────────────
  await t.test('TA.9 anon/authenticated sin SELECT/USAGE sobre audit', async () => {
    const rows = await adminQuery(`
      select
        has_table_privilege('anon','audit.record_version','SELECT')          as anon_sel,
        has_table_privilege('authenticated','audit.record_version','SELECT') as auth_sel,
        has_schema_privilege('anon','audit','USAGE')                          as anon_usage,
        has_schema_privilege('authenticated','audit','USAGE')                 as auth_usage;`);
    const r = rows[0];
    assert.equal(r.anon_sel, false, 'anon NO debe tener SELECT');
    assert.equal(r.auth_sel, false, 'authenticated NO debe tener SELECT');
    assert.equal(r.anon_usage, false, 'anon NO debe tener USAGE del schema audit');
    assert.equal(r.auth_usage, false, 'authenticated NO debe tener USAGE del schema audit');
  });

  // ── TA.10 append-only (sin UPDATE/DELETE para clientes) — R1.8 ────────────────────────────────────
  await t.test('TA.10 anon/authenticated sin UPDATE/DELETE sobre audit (append-only)', async () => {
    const rows = await adminQuery(`
      select
        has_table_privilege('anon','audit.record_version','UPDATE')          as anon_upd,
        has_table_privilege('anon','audit.record_version','DELETE')          as anon_del,
        has_table_privilege('authenticated','audit.record_version','UPDATE') as auth_upd,
        has_table_privilege('authenticated','audit.record_version','DELETE') as auth_del;`);
    const r = rows[0];
    assert.equal(r.anon_upd, false);
    assert.equal(r.anon_del, false);
    assert.equal(r.auth_upd, false);
    assert.equal(r.auth_del, false);
  });

  // ── TA.11 frontera WAL: audit NO referenciada en las sync streams — R4.2/R4.3 (reconciliado) ──────
  await t.test('TA.11 audit NO está en las sync streams (frontier real; publication es FOR ALL TABLES)', async () => {
    const yaml = fs.readFileSync(path.join(REPO_ROOT, 'sync-streams', 'mitropero.yaml'), 'utf8');
    // Strippear comentarios (full-line Y inline `# …`) para no matchear menciones en prosa (p.ej. el
    // comentario "# audit de exports" de sigsa_export_log): buscar solo en la config YAML activa.
    const active = yaml.split(/\r?\n/).map((l) => l.replace(/#.*$/, '')).join('\n');
    assert.ok(!/\baudit\b/i.test(active), 'ninguna sync stream activa debe referenciar `audit`');
    assert.ok(!/record_version/i.test(active), 'ninguna sync stream activa debe referenciar `record_version`');
    // Documental: la publication es FOR ALL TABLES (por eso el frontier son las streams, no la publication).
    const pub = await adminQuery(`select puballtables from pg_publication where pubname = 'powersync';`);
    if (pub.length > 0 && pub[0].puballtables === false) {
      // Si algún día se convierte a FOR TABLE, además reforzamos que audit no esté en pg_publication_tables.
      const t2 = await adminQuery(
        `select 1 from pg_publication_tables where schemaname = 'audit' and tablename = 'record_version';`);
      assert.equal(t2.length, 0, 'audit.record_version NO debe estar en ninguna publication');
    }
  });

  // ── TA.12 actor Opción A por el CAMINO DE PRODUCCIÓN (service_role + header) — R2.6/R5.1/R7.4a ─────
  await t.test('TA.12 service_role + header X-Rafaq-Actor → auth_uid = actor (camino de la EF)', async () => {
    // Reproduce EXACTAMENTE lo que hace la EF: createAdminClient(actorId) = service_role + header global.
    const svcWithActor = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Rafaq-Actor': ownerA.id } },
    });
    const roleB = crypto.randomUUID();
    const { error } = await svcWithActor.from('user_roles').insert({
      id: roleB, user_id: userB.id, establishment_id: estA, role: 'veterinarian', active: true,
    });
    assert.equal(error, null, error && error.message);
    const rows = await auditRows(
      `table_name = 'user_roles' and op = 'INSERT' and record ->> 'id' = '${roleB}'`);
    assert.equal(rows.length, 1, 'debería haber 1 versión INSERT');
    assert.equal(rows[0].auth_uid, ownerA.id, 'auth_uid = el actor propagado por el header (no NULL)');
  });

  // ── TA.13 spoof-safety: authenticated con header forjado → auth.uid() real, NO el header — R2.8/R7.4c
  await t.test('TA.13 authenticated con X-Rafaq-Actor forjado → auth_uid = su uid real (spoof-safe)', async () => {
    const forged = userB.id;   // un uuid claramente distinto del owner
    assert.notEqual(forged, ownerA.id);
    // Cliente authenticated (owner) con el header forjado inyectado globalmente.
    const spoofClient = await getUserClient(ownerA.email, { 'X-Rafaq-Actor': forged });
    // Baseline: max id de audit ANTES del write (para aislar la versión nueva de la de TA.3).
    const before = await adminQuery(`select coalesce(max(id),0) as m from audit.record_version;`);
    const baseId = Number(before[0].m);
    // UPDATE de su propia fila (policy user_roles_update_owner) → tabla trackeada, escrita por authenticated.
    const { error } = await spoofClient.from('user_roles').update({ active: true }).eq('id', roleA_owner);
    assert.equal(error, null, error && error.message);
    const rows = await auditRows(
      `id > ${baseId} and table_name = 'user_roles' and op = 'UPDATE' and record ->> 'id' = '${roleA_owner}'`);
    assert.ok(rows.length >= 1, 'debería haber la versión UPDATE del write spoof');
    const v = rows[rows.length - 1];
    assert.equal(v.auth_uid, ownerA.id, 'auth_uid = el uid REAL del owner (auth.uid), no el header');
    assert.notEqual(v.auth_uid, forged, 'el header forjado por un authenticated debe IGNORARSE');
  });

  // ── TA.14 modo de falla por tabla (best-effort vs estricto) + gate de animals — R1.11 ─────────────
  await t.test('TA.14 user_roles=strict, self-test best_effort, animals GATEADA (sin trigger)', async () => {
    // user_roles → arg 'strict'.
    const urDef = await adminQuery(`
      select pg_get_triggerdef(t.oid) as def
        from pg_trigger t
       where t.tgrelid = 'public.user_roles'::regclass and t.tgname = 'audit_i_u_d' and not t.tgisinternal;`);
    assert.equal(urDef.length, 1, 'user_roles debe tener el trigger audit_i_u_d');
    assert.match(urDef[0].def, /'strict'/, 'user_roles debe estar en modo estricto');

    // Ruteo best_effort de enable_tracking sobre una tabla desechable (sin prender nada permanente).
    await adminQuery(`create table if not exists public.${SELFTEST_TABLE} (id uuid primary key);`);
    await adminQuery(`select audit.enable_tracking('public.${SELFTEST_TABLE}', best_effort => true);`);
    const stDef = await adminQuery(`
      select pg_get_triggerdef(t.oid) as def
        from pg_trigger t
       where t.tgrelid = 'public.${SELFTEST_TABLE}'::regclass and t.tgname = 'audit_i_u_d' and not t.tgisinternal;`);
    assert.equal(stDef.length, 1, 'la self-test table debe tener el trigger');
    assert.match(stDef[0].def, /'best_effort'/, 'enable_tracking(best_effort=>true) debe rutear a best_effort');
    await adminQuery(`select audit.disable_tracking('public.${SELFTEST_TABLE}');`);
    await adminQuery(`drop table if exists public.${SELFTEST_TABLE};`);

    // animals GATEADA en incremento 1 → NO debe tener el trigger de audit (T13 diferido por T12/R5.4).
    const anDef = await adminQuery(`
      select 1 from pg_trigger
       where tgrelid = 'public.animals'::regclass and tgname = 'audit_i_u_d' and not tgisinternal;`);
    assert.equal(anDef.length, 0, 'animals NO debe estar trackeada todavía (gate de volumen pendiente)');
  });

  // ── TA.15 retención >90d — R6.2 ───────────────────────────────────────────────────────────────────
  await t.test('TA.15 purge borra >90d y respeta filas recientes', async () => {
    const oid = (await adminQuery(`select 'public.user_roles'::regclass::oid as oid;`))[0].oid;
    // Fila vieja (ts 100 días) + fila reciente, ambas namespaced por RUN_TAG en `record`.
    await adminQuery(`
      insert into audit.record_version (op, ts, table_oid, table_schema, table_name, record) values
        ('INSERT', now() - interval '100 days', ${oid}, 'public', 'user_roles',
         '{"__audit_test":"${RUN_TAG}","which":"old"}'::jsonb),
        ('INSERT', now(),                        ${oid}, 'public', 'user_roles',
         '{"__audit_test":"${RUN_TAG}","which":"recent"}'::jsonb);`);
    await adminQuery(`select audit.purge_old_record_versions();`);
    const remaining = await adminQuery(
      `select record ->> 'which' as which from audit.record_version
        where record ->> '__audit_test' = '${RUN_TAG}';`);
    const whichSet = new Set(remaining.map((r) => r.which));
    assert.ok(!whichSet.has('old'), 'la fila >90d debe haber sido purgada');
    assert.ok(whichSet.has('recent'), 'la fila reciente debe permanecer');
  });

  // ── TA.16 smoke: funciones de audit sin EXECUTE para clientes — R3.5 ──────────────────────────────
  await t.test('TA.16 funciones sensibles de audit sin EXECUTE para anon/authenticated', async () => {
    const rows = await adminQuery(`
      select
        has_function_privilege('anon','audit.enable_tracking(regclass, boolean)','EXECUTE')          as anon_enable,
        has_function_privilege('authenticated','audit.enable_tracking(regclass, boolean)','EXECUTE') as auth_enable,
        has_function_privilege('anon','audit.disable_tracking(regclass)','EXECUTE')                  as anon_disable,
        has_function_privilege('authenticated','audit.disable_tracking(regclass)','EXECUTE')         as auth_disable,
        has_function_privilege('anon','audit.purge_old_record_versions()','EXECUTE')                 as anon_purge,
        has_function_privilege('authenticated','audit.purge_old_record_versions()','EXECUTE')        as auth_purge,
        has_function_privilege('anon','audit.resolve_actor()','EXECUTE')                             as anon_actor,
        has_function_privilege('authenticated','audit.resolve_actor()','EXECUTE')                    as auth_actor;`);
    const r = rows[0];
    for (const [k, v] of Object.entries(r)) {
      assert.equal(v, false, `${k} debe ser false (EXECUTE revocado a clientes)`);
    }
  });
});
