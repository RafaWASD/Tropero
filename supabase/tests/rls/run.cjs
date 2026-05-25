// supabase/tests/rls/run.cjs
// Suite de tests RLS de la spec 01-identity-multitenancy.
// Corre contra la base remota usando service_role para fixtures y JWTs reales
// para el assertion. Limpia los users/establishments creados al final.
//
// Cubre los R<n> de aislamiento multi-tenant. Mapa detallado en
// progress/impl_01-identity-multitenancy.md.
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... node run.cjs
// Las vars se cargan automáticamente desde <repo>/.env.local si existe.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Resolve repo root y carga .env.local si existe.
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

// supabase-js vive en app/node_modules
const supabaseJsPath = path.join(REPO_ROOT, 'app', 'node_modules', '@supabase', 'supabase-js');
const { createClient: createClientRaw } = require(supabaseJsPath);
// Node 20 no tiene WebSocket nativo; supabase-js / realtime-js requieren `ws`.
const ws = require(path.join(REPO_ROOT, 'app', 'node_modules', 'ws'));

function createClient(url, key, opts = {}) {
  return createClientRaw(url, key, {
    ...opts,
    realtime: { ...(opts.realtime || {}), transport: ws },
  });
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error(
    'Faltan vars: SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY / EXPO_PUBLIC_SUPABASE_ANON_KEY',
  );
  process.exit(2);
}

// Marca de corrida: única para no chocar entre runs paralelos.
const RUN_TAG = `rls_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Track de IDs para cleanup.
const createdUserIds = [];
const createdEstablishmentIds = [];

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
  // Pattern T4.4: insert SIN .select() (porque RLS-on-RETURNING evalúa antes
  // de que el trigger after-insert haya creado user_roles owner para has_role_in),
  // luego SELECT separado.
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
  // Service role bypassea RLS. Lo usamos para fabricar la membership inicial
  // (owner) tras crear el establishment desde el cliente. El cliente real lo
  // haría con su propia policy user_roles_insert_self_owner para el caso owner.
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
}

async function cleanup() {
  // Deletear establishments primero (CASCADE limpia user_roles e invitations).
  if (createdEstablishmentIds.length > 0) {
    const { error } = await admin
      .from('establishments')
      .delete()
      .in('id', createdEstablishmentIds);
    if (error) console.error('cleanup establishments:', error.message);
  }
  for (const uid of createdUserIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) console.error(`cleanup user ${uid}:`, error.message);
  }
}

process.on('beforeExit', () => {
  // node:test no expone afterAll global; usamos beforeExit para best-effort.
});

// =====================================================================
// Tests
// =====================================================================

test('RLS suite — multi-tenant isolation', async (t) => {
  let userA, userB, clientA, clientB, estA, estB;

  await t.test('setup: crea usuarios y establishments', async () => {
    userA = await createTestUser('userA');
    userB = await createTestUser('userB');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);

    // R3.1, R3.2: cualquier auth user puede insertar; el trigger
    // on_establishment_created crea automáticamente user_roles owner.
    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(clientB, `${RUN_TAG} estB`);

    // Verificación de R3.2: el trigger creó el user_roles owner.
    {
      const { data, error } = await clientA
        .from('user_roles')
        .select('role, active')
        .eq('establishment_id', estA)
        .eq('user_id', userA.id);
      assert.equal(error, null, error && error.message);
      assert.equal(data.length, 1, 'trigger debería haber creado user_roles owner');
      assert.equal(data[0].role, 'owner');
      assert.equal(data[0].active, true);
    }
  });

  // -------------------------------------------------------------------
  // R7.2 — aislamiento entre tenants
  // -------------------------------------------------------------------
  await t.test('R7.2: userA no ve establishment de userB', async () => {
    const { data, error } = await clientA.from('establishments').select('id').eq('id', estB);
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data, []);
  });

  await t.test('R7.2: userA ve su propio establishment', async () => {
    const { data, error } = await clientA.from('establishments').select('id').eq('id', estA);
    assert.equal(error, null, error && error.message);
    assert.equal(data.length, 1);
    assert.equal(data[0].id, estA);
  });

  // -------------------------------------------------------------------
  // R7.3 — solo owners pueden update
  // -------------------------------------------------------------------
  await t.test('R7.3: userA no puede update establishment de userB', async () => {
    const { data, error } = await clientA
      .from('establishments')
      .update({ city: 'Hack' })
      .eq('id', estB)
      .select();
    // RLS impide ver/modificar la fila: PostgREST devuelve 0 filas, no error.
    assert.equal(error, null);
    assert.deepEqual(data, []);
  });

  await t.test('R3.4: owner sí puede update su establishment', async () => {
    const { data, error } = await clientA
      .from('establishments')
      .update({ city: 'Chascomús' })
      .eq('id', estA)
      .select('city');
    assert.equal(error, null, error && error.message);
    assert.equal(data.length, 1);
    assert.equal(data[0].city, 'Chascomús');
  });

  // -------------------------------------------------------------------
  // R3.5 — non-owner no puede update
  // -------------------------------------------------------------------
  await t.test('R3.5: field_operator no puede update establishment', async () => {
    // Agregamos a userB como field_operator de estA (vía service_role para evitar invitations dance).
    await assignRoleAsService(userB.id, estA, 'field_operator');

    // Ahora userB puede VER estA (has_role_in true)…
    const { data: visible } = await clientB.from('establishments').select('id').eq('id', estA);
    assert.equal(visible.length, 1, 'field_operator debería ver el establishment');

    // …pero no puede UPDATEarlo.
    const { data: updated, error } = await clientB
      .from('establishments')
      .update({ city: 'Hack' })
      .eq('id', estA)
      .select();
    assert.equal(error, null);
    assert.deepEqual(updated, [], 'field_operator no debería poder update');
  });

  // -------------------------------------------------------------------
  // R4.3 — solo un rol activo por par
  // -------------------------------------------------------------------
  await t.test('R4.3: unique index impide dos roles activos para el mismo par', async () => {
    // Intentar insertar otro user_roles activo para userA en estA debe fallar.
    const { error } = await admin
      .from('user_roles')
      .insert({
        user_id: userA.id,
        establishment_id: estA,
        role: 'veterinarian',
        active: true,
      });
    assert.notEqual(error, null, 'debería fallar por unique index');
    assert.match(
      String(error.message + ' ' + (error.details || '')),
      /unique|duplicate|user_roles_active_unique/i,
    );
  });

  // -------------------------------------------------------------------
  // R8.3 / R8.4 — soft-delete filtra por default
  // -------------------------------------------------------------------
  await t.test('R8.3/R8.4: soft-delete oculta establishment al cliente', async () => {
    // Soft-delete estA como owner.
    const { error: updErr } = await clientA
      .from('establishments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', estA);
    assert.equal(updErr, null, updErr && updErr.message);

    // Ahora userA no debería verlo (has_role_in excluye soft-deleted).
    const { data } = await clientA.from('establishments').select('id').eq('id', estA);
    assert.deepEqual(data, [], 'soft-deleted establishment debería estar oculto');

    // Volver a poner deleted_at = null vía service_role para que cleanup funcione bien.
    await admin.from('establishments').update({ deleted_at: null }).eq('id', estA);
  });

  // -------------------------------------------------------------------
  // R5.x — invitations: solo owner inserta, ve, cancela
  // -------------------------------------------------------------------
  await t.test('R5.1 / RLS invitations_insert_owner: owner crea invitación', async () => {
    const { error } = await clientA.from('invitations').insert({
      establishment_id: estA,
      invited_by: userA.id,
      email: `${RUN_TAG}_invitee@rafaq-test.local`,
      role: 'veterinarian',
      token: `tok_${RUN_TAG}_1`,
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    assert.equal(error, null, error && error.message);
  });

  await t.test('R7.3: non-owner no puede crear invitación', async () => {
    const { error } = await clientB.from('invitations').insert({
      establishment_id: estA,
      invited_by: userB.id,
      email: `${RUN_TAG}_intruso@rafaq-test.local`,
      role: 'veterinarian',
      token: `tok_${RUN_TAG}_intruso`,
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    // userB es field_operator de estA, no owner → policy rechaza
    assert.notEqual(error, null, 'field_operator no debería crear invitación');
  });

  // -------------------------------------------------------------------
  // R5.11 / push_tokens — el user solo ve sus propios tokens
  // -------------------------------------------------------------------
  await t.test('push_tokens: cada user solo ve sus tokens', async () => {
    // userA inserta token
    {
      const { error } = await clientA
        .from('push_tokens')
        .insert({ user_id: userA.id, token: `expo_tok_A_${RUN_TAG}`, platform: 'android' });
      assert.equal(error, null, error && error.message);
    }
    // userB inserta token
    {
      const { error } = await clientB
        .from('push_tokens')
        .insert({ user_id: userB.id, token: `expo_tok_B_${RUN_TAG}`, platform: 'ios' });
      assert.equal(error, null, error && error.message);
    }
    // userA NO ve token de userB
    {
      const { data, error } = await clientA.from('push_tokens').select('token');
      assert.equal(error, null);
      const tokens = data.map((r) => r.token);
      assert.ok(tokens.includes(`expo_tok_A_${RUN_TAG}`));
      assert.ok(!tokens.includes(`expo_tok_B_${RUN_TAG}`));
    }
  });

  await t.test('push_tokens: unique (user_id, token) impide duplicados', async () => {
    const { error } = await clientA
      .from('push_tokens')
      .insert({ user_id: userA.id, token: `expo_tok_A_${RUN_TAG}`, platform: 'android' });
    assert.notEqual(error, null, 'debería fallar por unique index');
  });

  // -------------------------------------------------------------------
  // R6.1 / R6.2 — user con roles en N establishments los ve todos
  // -------------------------------------------------------------------
  await t.test('R6.1: userB con roles en 2 establishments ve ambos', async () => {
    // userB ya es owner de estB y field_operator de estA
    const { data, error } = await clientB
      .from('establishments')
      .select('id')
      .order('created_at', { ascending: true });
    assert.equal(error, null);
    const ids = data.map((r) => r.id).sort();
    const expected = [estA, estB].sort();
    assert.deepEqual(ids, expected);
  });
});

// Cleanup explícito al final.
test('cleanup', async () => {
  await cleanup();
});
