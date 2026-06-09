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
  // R3.1 / R3.2 — flujo REAL de crear-establishment desde el cliente
  // (insert SIN .select() + SELECT separado + owner auto del trigger 0011).
  //
  // Este test cierra el gap por el que el bug del 403 pasó: los demás tests
  // usaban `createEstablishmentAs` como helper, pero ninguno validaba
  // EXPLÍCITAMENTE (a) que `insert().select()` falla por RLS-on-RETURNING
  // (la policy establishments_select corre sobre el RETURNING antes de que el
  // rol owner del trigger sea visible → 403), y (b) que el patrón correcto
  // (insert sin select + select separado) sí trae el campo Y deja al usuario
  // como owner activo. Es el camino que la app ejecuta en producción.
  // -------------------------------------------------------------------
  await t.test('R3.1/R3.2: crear-establishment desde cliente (split insert+select + owner auto)', async () => {
    const userC = await createTestUser('userC');
    const clientC = await getUserClient(userC.email);
    const estName = `${RUN_TAG} estC flujo-real`;

    // (a) El patrón VIEJO `insert().select()` debe fallar (RLS-on-RETURNING).
    //     Confirma la causa raíz del 403 que Raf vio en web.
    {
      const { data, error } = await clientC
        .from('establishments')
        .insert({ name: `${estName} legacy`, province: 'Buenos Aires' })
        .select('id, name, province, city')
        .single();
      assert.equal(
        data,
        null,
        'insert().select() NO debería devolver la fila (RLS-on-RETURNING)',
      );
      assert.notEqual(error, null, 'insert().select() debería fallar por RLS sobre el RETURNING');
      // Limpieza: la fila igual se insertó (el insert sí corrió; falló el RETURNING).
      // La recuperamos por service_role para trackearla y que cleanup la borre.
      const { data: leaked } = await admin
        .from('establishments')
        .select('id')
        .eq('name', `${estName} legacy`);
      for (const r of leaked || []) createdEstablishmentIds.push(r.id);
    }

    // (b) Patrón CORRECTO: insert SIN .select().
    const { error: insErr } = await clientC
      .from('establishments')
      .insert({ name: estName, province: 'Buenos Aires', city: 'Chascomús' });
    assert.equal(insErr, null, insErr && `insert sin select no debería fallar: ${insErr.message}`);

    // SELECT separado: ahora has_role_in(id) es true (el trigger ya creó el owner) → trae la fila.
    const { data: rows, error: selErr } = await clientC
      .from('establishments')
      .select('id, name, province, city')
      .eq('name', estName);
    assert.equal(selErr, null, selErr && selErr.message);
    assert.equal(rows.length, 1, 'el SELECT separado debería traer el campo recién creado');
    const estC = rows[0].id;
    createdEstablishmentIds.push(estC);
    assert.equal(rows[0].name, estName);
    assert.equal(rows[0].province, 'Buenos Aires');
    assert.equal(rows[0].city, 'Chascomús');

    // El trigger 0011 dejó a userC como OWNER ACTIVO de ese campo (R3.2), visible para él mismo.
    const { data: roles, error: roleErr } = await clientC
      .from('user_roles')
      .select('role, active')
      .eq('establishment_id', estC)
      .eq('user_id', userC.id);
    assert.equal(roleErr, null, roleErr && roleErr.message);
    assert.equal(roles.length, 1, 'el trigger 0011 debería haber creado UN user_roles owner');
    assert.equal(roles[0].role, 'owner');
    assert.equal(roles[0].active, true);
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

    // Tras 0076, el soft-delete de arriba desactiva los user_roles de estA (active=false)
    // vía el trigger establishment_soft_delete_deactivates_roles. El trigger NO reactiva en el
    // restore, por diseño (un restore real es responsable de reactivar explícitamente). estA es
    // un campo COMPARTIDO que los tests posteriores reusan (R5.1 invitations con userA owner;
    // R7.3 y R6.1 con userB field_operator), así que reactivamos sus roles acá, espejando lo que
    // un restore real haría. Idempotente: sin 0076 los roles siguen active=true y esto es no-op.
    await admin
      .from('user_roles')
      .update({ active: true, deactivated_at: null })
      .eq('establishment_id', estA)
      .in('user_id', [userA.id, userB.id]);
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
  // R3.6 / R8.3 — flujo REAL de ELIMINAR campo (soft-delete) desde el owner.
  //
  // Cierra el punto ciego del borrado (mismo aprendizaje que con crear-campo): el owner
  // soft-deletea su campo (update deleted_at, como hace softDeleteEstablishment en el
  // cliente) y verificamos que el campo desaparece de la query de membership REAL
  // (loadMemberships: user_roles activos → establishments embebido) TANTO para el owner
  // COMO para un miembro con rol activo en ese campo. Es el camino que dispara active_lost
  // (R6.10) en ambos. Usa un campo dedicado (estD) para no interferir con los otros tests.
  // -------------------------------------------------------------------
  await t.test('R3.6/R8.3: owner soft-deletea su campo → desaparece de membership del owner y del miembro', async () => {
    // Owner = userA crea un campo nuevo dedicado a este test.
    const estD = await createEstablishmentAs(clientA, `${RUN_TAG} estD borrar`);
    // userB es miembro activo (field_operator) de estD.
    await assignRoleAsService(userB.id, estD, 'field_operator');

    // Query de membership IGUAL a loadMemberships del cliente (join user_roles → establishments,
    // filtra active + user_id). El establishment embebido viene null si está soft-deleted/oculto.
    const membershipQuery = (client, userId) =>
      client
        .from('user_roles')
        .select('role, establishment:establishments ( id, name, deleted_at )')
        .eq('active', true)
        .eq('user_id', userId);

    // ANTES del borrado: ambos VEN estD en su membership (establishment embebido no-null).
    {
      const { data: ownerRows, error: e1 } = await membershipQuery(clientA, userA.id);
      assert.equal(e1, null, e1 && e1.message);
      const ownerSees = (ownerRows || []).some((r) => r.establishment && r.establishment.id === estD);
      assert.equal(ownerSees, true, 'el owner debería ver estD ANTES del borrado');

      const { data: memberRows, error: e2 } = await membershipQuery(clientB, userB.id);
      assert.equal(e2, null, e2 && e2.message);
      const memberSees = (memberRows || []).some((r) => r.establishment && r.establishment.id === estD);
      assert.equal(memberSees, true, 'el miembro debería ver estD ANTES del borrado');
    }

    // SOFT-DELETE desde el OWNER (clientA), igual que softDeleteEstablishment: update deleted_at,
    // SIN .select() (gotcha RLS-on-RETURNING). Solo el owner puede (RLS establishments_update).
    {
      const { error: delErr } = await clientA
        .from('establishments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', estD)
        .is('deleted_at', null);
      assert.equal(delErr, null, delErr && `soft-delete del owner no debería fallar: ${delErr.message}`);
    }

    // DESPUÉS del borrado: estD ya NO aparece en la membership de NINGUNO.
    // El establishment embebido viene null porque has_role_in/RLS de establishments filtra
    // deleted_at (R8.3/R8.4) → loadMemberships lo descarta (mapMembershipRows filtra null).
    {
      const { data: ownerRows, error: e1 } = await membershipQuery(clientA, userA.id);
      assert.equal(e1, null, e1 && e1.message);
      const ownerStillSees = (ownerRows || []).some((r) => r.establishment && r.establishment.id === estD);
      assert.equal(ownerStillSees, false, 'el owner NO debería ver estD tras soft-delete (R8.3)');

      const { data: memberRows, error: e2 } = await membershipQuery(clientB, userB.id);
      assert.equal(e2, null, e2 && e2.message);
      const memberStillSees = (memberRows || []).some((r) => r.establishment && r.establishment.id === estD);
      assert.equal(memberStillSees, false, 'el miembro NO debería ver estD tras soft-delete (R8.3 → active_lost R6.10)');
    }

    // Defensa de no-owner (R3.6/R7.3): un campo soft-deleteado por su owner; verificamos además
    // que un NO-owner no puede soft-deletear un campo ajeno. userB (field_operator de estA) intenta
    // borrar estA → RLS lo bloquea (0 filas afectadas, sin error).
    {
      const { data: blocked, error } = await clientB
        .from('establishments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', estA)
        .select();
      assert.equal(error, null);
      assert.deepEqual(blocked, [], 'un field_operator NO debería poder soft-deletear el campo (R7.3)');
    }
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

  // -------------------------------------------------------------------
  // spec 15-powersync (migración 0076) — el soft-delete de un campo desactiva sus user_roles.
  //
  // POR QUÉ: el modelo de sync JOIN-free de PowerSync scopea por `user_roles.active = true` SIN JOIN a
  // establishments, así que `active` tiene que ser un proxy fiel de "campo vivo". El trigger
  // establishment_soft_delete_deactivates_roles (0076) desactiva los roles del campo al soft-deletearlo.
  // Es ADITIVO y redundante con la RLS: has_role_in YA filtra deleted_at, así que devolvía false igual —
  // este test verifica que (a) el trigger pone active=false + deactivated_at, y (b) has_role_in sigue false
  // (sin regresión). Campo + usuario DEDICADOS (estE/userE) para no contaminar el resto de la suite (el
  // trigger NO reactiva en el restore, por diseño).
  //
  // ⚠️ Este test REQUIERE la migración 0076 APLICADA al remoto (la aplica el leader por Management API
  // tras gatear el SQL). Hasta entonces FALLA — es ESPERADO: sin el trigger
  // establishment_soft_delete_deactivates_roles, el soft-delete NO desactiva los roles, así que `active`
  // sigue true tras el borrado y la aserción (a) falla. El implementer NO aplica la migración. Mismo patrón
  // que la suite `spec 15-powersync` de supabase/tests/animal/run.cjs (delta 0075, Run 2).
  // -------------------------------------------------------------------
  await t.test('spec 15 (0076): soft-delete de un campo desactiva sus user_roles (active=false) y has_role_in sigue false', async () => {
    const userE = await createTestUser('userE');
    const clientE = await getUserClient(userE.email);
    // Owner = userE crea un campo dedicado (el trigger 0011 lo deja owner activo).
    const estE = await createEstablishmentAs(clientE, `${RUN_TAG} estE 0076`);
    // Un segundo miembro activo (field_operator) para verificar que el trigger desactiva TODOS los roles,
    // no solo el del owner.
    await assignRoleAsService(userB.id, estE, 'field_operator');

    // ANTES del borrado: ambos roles activos (vía service_role para ver el estado real de user_roles).
    {
      const { data, error } = await admin
        .from('user_roles')
        .select('user_id, active, deactivated_at')
        .eq('establishment_id', estE);
      assert.equal(error, null, error && error.message);
      assert.equal(data.length, 2, 'estE debería tener 2 user_roles (owner userE + field_operator userB)');
      assert.ok(data.every((r) => r.active === true), 'ambos roles deberían estar active=true ANTES del borrado');
      assert.ok(data.every((r) => r.deactivated_at === null), 'deactivated_at debería ser null ANTES del borrado');
    }

    // ANTES del borrado: has_role_in(estE) true para el owner (campo vivo + rol activo) → ve el campo.
    {
      const { data } = await clientE.from('establishments').select('id').eq('id', estE);
      assert.equal(data.length, 1, 'el owner debería ver estE ANTES del borrado (has_role_in true)');
    }

    // SOFT-DELETE desde el owner (mismo camino que softDeleteEstablishment del cliente).
    {
      const { error: delErr } = await clientE
        .from('establishments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', estE)
        .is('deleted_at', null);
      assert.equal(delErr, null, delErr && `soft-delete del owner no debería fallar: ${delErr.message}`);
    }

    // (a) DESPUÉS del borrado: el trigger 0076 desactivó AMBOS roles (active=false + deactivated_at poblado).
    //     Se lee vía service_role porque el cliente ya no ve el campo soft-deleteado.
    {
      const { data, error } = await admin
        .from('user_roles')
        .select('user_id, active, deactivated_at')
        .eq('establishment_id', estE);
      assert.equal(error, null, error && error.message);
      assert.equal(data.length, 2, 'siguen las 2 filas (no se borran, se desactivan — auditoría)');
      assert.ok(
        data.every((r) => r.active === false),
        'el trigger 0076 debería haber puesto active=false en TODOS los roles del campo',
      );
      assert.ok(
        data.every((r) => r.deactivated_at !== null),
        'el trigger 0076 debería haber poblado deactivated_at',
      );
    }

    // (b) DESPUÉS del borrado: has_role_in(estE) sigue false (era false igual por el JOIN a deleted_at;
    //     verifica que no hubo regresión). El owner ya no ve el campo.
    {
      const { data } = await clientE.from('establishments').select('id').eq('id', estE);
      assert.deepEqual(data, [], 'el owner NO debería ver estE tras el soft-delete (has_role_in false)');
    }
  });

  // -------------------------------------------------------------------
  // spec 15-powersync (migración 0076 — guard) — INVARIANTE: NO se puede tener un user_roles.active = true
  // apuntando a un establishment soft-deleteado.
  //
  // POR QUÉ: el modelo de sync JOIN-free de PowerSync depende de "user_roles.active = true ⇒ campo vivo".
  // El trigger establishment_soft_delete_deactivates_roles (0076) cubre los roles EXISTENTES al borrar el
  // campo, pero NO impide CREAR/activar un rol NUEVO para un campo ya borrado (vector verificado:
  // supabase/functions/accept_invitation/index.ts:93-101 inserta active:true sin chequear deleted_at →
  // owner invita → owner borra el campo → el invitado acepta el link pendiente → quedaría un rol activo
  // sobre un campo muerto → el sync le replicaría la data del campo borrado). El guard
  // user_roles_block_active_on_soft_deleted_establishment (0076) cierra esa otra mitad a nivel DB: rechaza
  // (errcode 23514) cualquier INSERT/UPDATE que deje active=true en un campo con deleted_at IS NOT NULL,
  // venga del code-path que venga. Ejercitamos el guard DIRECTO vía service_role (simular accept_invitation
  // entero es pesado y el guard es agnóstico del caller): un INSERT/UPDATE de user_roles.active=true sobre
  // un campo borrado debe FALLAR; sobre un campo vivo, y cualquier op active=false, deben PASAR.
  //
  // ⚠️ Como el test del trigger de deactivate, REQUIERE 0076 APLICADA al remoto (la aplica el leader por
  // Management API tras gatear el SQL). Hasta entonces FALLA — es ESPERADO: sin el guard, los INSERT/UPDATE
  // de active=true sobre el campo borrado NO se rechazan, así que las aserciones de rechazo fallan. El
  // implementer NO aplica la migración. Campo + usuario DEDICADOS (estG/userG) → autocontenido.
  // -------------------------------------------------------------------
  await t.test('spec 15 (0076 guard): no se puede activar/insertar un user_roles.active=true en un campo soft-deleteado', async () => {
    const userG = await createTestUser('userG');
    const clientG = await getUserClient(userG.email);
    // Campo VIVO dedicado (el trigger 0011 deja a userG owner activo).
    const estG = await createEstablishmentAs(clientG, `${RUN_TAG} estG 0076-guard`);
    // Un 2do usuario para fabricar roles nuevos sin chocar el unique-active de userG (owner).
    const userH = await createTestUser('userH');

    // CASO POSITIVO (campo VIVO): insertar un user_roles.active=true para userH en estG (vivo) → PASA.
    // Es el camino legítimo de aceptar una invitación a un campo que sigue vivo.
    {
      const { error } = await admin
        .from('user_roles')
        .insert({ user_id: userH.id, establishment_id: estG, role: 'field_operator', active: true });
      assert.equal(error, null, error && `insert active=true en campo VIVO no debería fallar: ${error.message}`);
    }

    // SOFT-DELETE de estG desde el owner (mismo camino que softDeleteEstablishment). El trigger de deactivate
    // (0076) desactiva los roles existentes (owner userG + field_operator userH) → active=false.
    {
      const { error: delErr } = await clientG
        .from('establishments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', estG)
        .is('deleted_at', null);
      assert.equal(delErr, null, delErr && `soft-delete del owner no debería fallar: ${delErr.message}`);
    }

    // CASO NEGATIVO 1 (INSERT sobre campo BORRADO): intentar INSERTAR un user_roles.active=true NUEVO para
    // userB en estG (ya borrado) → el guard lo RECHAZA (errcode 23514). Este es EXACTAMENTE el vector de
    // accept_invitation (un rol nuevo activo sobre un campo que se borró entre invitar y aceptar).
    {
      const { error } = await admin
        .from('user_roles')
        .insert({ user_id: userB.id, establishment_id: estG, role: 'veterinarian', active: true });
      assert.notEqual(error, null, 'el guard debería RECHAZAR insertar active=true en un campo soft-deleteado');
      assert.match(
        String((error && (error.message + ' ' + (error.code || '') + ' ' + (error.details || ''))) || ''),
        /23514|borrado|soft-deletead/i,
        'el rechazo debería ser el del guard (23514 / campo borrado), no otro error',
      );
    }

    // CASO NEGATIVO 2 (UPDATE active=true sobre campo BORRADO): intentar REACTIVAR el rol de userH (que el
    // trigger de deactivate dejó en active=false) mientras estG sigue borrado → el guard lo RECHAZA. Cubre el
    // path de "poner active=true" por UPDATE, no solo por INSERT.
    {
      const { error } = await admin
        .from('user_roles')
        .update({ active: true, deactivated_at: null })
        .eq('user_id', userH.id)
        .eq('establishment_id', estG);
      assert.notEqual(error, null, 'el guard debería RECHAZAR reactivar (UPDATE active=true) un rol en un campo borrado');
      assert.match(
        String((error && (error.message + ' ' + (error.code || '') + ' ' + (error.details || ''))) || ''),
        /23514|borrado|soft-deletead/i,
        'el rechazo del UPDATE debería ser el del guard (23514 / campo borrado)',
      );
    }

    // CONTRAPRUEBA DE COMPATIBILIDAD (active=false SIEMPRE permitido): un UPDATE que pone/mantiene active=false
    // sobre el campo borrado NO debe ser bloqueado por el guard (es lo que hace el propio trigger de deactivate
    // y la remoción de miembros). Sin esta garantía, el guard rompería el deactivate. Verificamos que NO
    // levanta error (no-op sobre userH, ya en false).
    {
      const { error } = await admin
        .from('user_roles')
        .update({ active: false })
        .eq('user_id', userH.id)
        .eq('establishment_id', estG);
      assert.equal(error, null, error && `active=false en campo borrado NO debería ser bloqueado por el guard: ${error.message}`);
    }

    // CONTRAPRUEBA (campo RESTAURADO antes de reactivar): el orden correcto es restore (deleted_at=null)
    // ANTES de reactivar (active=true) — espeja el fix de R8.3/R8.4. Con el campo VIVO de nuevo, reactivar
    // PASA. (Si se reactivara ANTES del restore, el guard lo bloquearía — por eso el orden importa.)
    {
      const { error: restoreErr } = await admin
        .from('establishments')
        .update({ deleted_at: null })
        .eq('id', estG);
      assert.equal(restoreErr, null, restoreErr && restoreErr.message);
      const { error: reactErr } = await admin
        .from('user_roles')
        .update({ active: true, deactivated_at: null })
        .eq('user_id', userH.id)
        .eq('establishment_id', estG);
      assert.equal(
        reactErr,
        null,
        reactErr && `reactivar DESPUÉS del restore (campo vivo) no debería fallar: ${reactErr.message}`,
      );
    }
  });
});

// -------------------------------------------------------------------
// spec 15-powersync — PASO 2 / (c2): denormalización de `name` sobre `user_roles.member_name` (migración 0080).
//
// POR QUÉ (decisión c2 de Raf, ADR-026 §C): `users` es global (un user en >1 campo) → NO se sincroniza en el
// modelo JOIN-free. Para tener los nombres de coworkers (y el propio) offline, se denormaliza `users.name` sobre
// `user_roles.member_name`, que ya viaja por los streams self_user_roles / est_members_roles. La columna se
// mantiene fiel por (1) un trigger force en el INSERT del rol (anti-spoof) y (2) un trigger de propagación al
// editar `users.name`. PII (email/phone) NO se toca (sigue en user_private self-only).
//
// ⚠️ REQUIERE la migración 0080 APLICADA al remoto (la aplica el leader por Management API tras gatear el SQL).
// Hasta entonces FALLA — es ESPERADO: la columna `member_name` aún no existe en user_roles, así que el
// INSERT/SELECT que la referencia da error de columna inexistente. El implementer NO aplica la migración.
// -------------------------------------------------------------------
test('spec 15-powersync paso 2 (0080 / c2): user_roles.member_name denormalizado desde users.name', async (t) => {
  // -- (1) FORCE en el INSERT del rol: member_name se deriva de users.name, ignorando el payload (anti-spoof). --
  await t.test('(c2 force) member_name se FUERZA desde users.name en el INSERT del rol (ignora el payload spoofeado)', async () => {
    const userM = await createTestUser('s15p2_M'); // su user_metadata.name = 'Test s15p2_M' → users.name
    const clientM = await getUserClient(userM.email);
    // El owner crea su campo (el trigger 0011 deja a userM owner activo → ya hay una fila user_roles para userM).
    const estM = await createEstablishmentAs(clientM, `${RUN_TAG} estM 0080`);

    // El nombre real del user (fuente de verdad) lo leemos de users (service_role).
    const { data: u } = await admin.from('users').select('name').eq('id', userM.id).single();
    assert.ok(u && u.name, 'el user M debería tener un name');

    // (a) La fila owner creada por el trigger 0011 ya quedó con member_name = users.name.
    {
      const { data: r } = await admin
        .from('user_roles')
        .select('member_name')
        .eq('user_id', userM.id)
        .eq('establishment_id', estM)
        .single();
      assert.equal(r.member_name, u.name, 'el member_name del rol owner = users.name (force en el INSERT del trigger 0011)');
    }

    // (b) Un INSERT de rol NUEVO con un member_name SPOOFEADO en el payload → el trigger force lo pisa con
    //     users.name del user_id. Usamos otro user (userN) para no chocar el unique-active de userM.
    const userN = await createTestUser('s15p2_N');
    const { data: un } = await admin.from('users').select('name').eq('id', userN.id).single();
    {
      const { error } = await admin
        .from('user_roles')
        .insert({
          user_id: userN.id,
          establishment_id: estM,
          role: 'field_operator',
          active: true,
          member_name: 'NOMBRE SPOOFEADO QUE NO DEBE QUEDAR', // <- spoof; el trigger debe pisarlo
        });
      assert.equal(error, null, error && `insert del rol no debería fallar: ${error.message}`);
    }
    {
      const { data: r } = await admin
        .from('user_roles')
        .select('member_name')
        .eq('user_id', userN.id)
        .eq('establishment_id', estM)
        .single();
      assert.equal(r.member_name, un.name, 'member_name forzado desde users.name (no el spoofeado)');
      assert.notEqual(r.member_name, 'NOMBRE SPOOFEADO QUE NO DEBE QUEDAR', 'el member_name spoofeado NO debe persistir');
    }

    // (c) ANTI-SPOOF POR UPDATE (force BEFORE UPDATE OF member_name): pisar member_name por UPDATE directo →
    //     el trigger lo re-deriva desde users.name. Cierra el vector de "renombrar" a un coworker offline.
    {
      const { error } = await admin
        .from('user_roles')
        .update({ member_name: 'RENOMBRE FALSO POR UPDATE' })
        .eq('user_id', userN.id)
        .eq('establishment_id', estM);
      assert.equal(error, null, error && `el UPDATE no debería fallar: ${error.message}`);
      const { data: r } = await admin
        .from('user_roles')
        .select('member_name')
        .eq('user_id', userN.id)
        .eq('establishment_id', estM)
        .single();
      assert.equal(r.member_name, un.name, 'tras el UPDATE-spoof member_name sigue siendo el real (users.name)');
    }
  });

  // -- (2) PROPAGACIÓN: al editar users.name, se propaga a TODAS las filas user_roles del user. --
  await t.test('(c2 propagación) editar users.name propaga a user_roles.member_name de todos los campos del user', async () => {
    const userP = await createTestUser('s15p2_P');
    const clientP = await getUserClient(userP.email);
    // userP es owner de DOS campos → tiene 2 filas user_roles, ambas deben actualizarse al cambiar su nombre.
    const estP1 = await createEstablishmentAs(clientP, `${RUN_TAG} estP1 0080`);
    const estP2 = await createEstablishmentAs(clientP, `${RUN_TAG} estP2 0080`);

    const nuevoNombre = `Renombrado ${RUN_TAG}`;
    const { error: updErr } = await admin.from('users').update({ name: nuevoNombre }).eq('id', userP.id);
    assert.equal(updErr, null, updErr && updErr.message);

    const { data: roles, error } = await admin
      .from('user_roles')
      .select('establishment_id, member_name')
      .eq('user_id', userP.id)
      .in('establishment_id', [estP1, estP2]);
    assert.equal(error, null, error && error.message);
    assert.equal(roles.length, 2, 'userP debería tener un rol en cada uno de sus 2 campos');
    assert.ok(
      roles.every((r) => r.member_name === nuevoNombre),
      'el cambio de users.name se propagó a member_name de TODAS las filas user_roles del user',
    );
  });
});

// Cleanup explícito al final.
test('cleanup', async () => {
  await cleanup();
});
