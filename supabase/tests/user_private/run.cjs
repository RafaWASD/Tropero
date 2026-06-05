// supabase/tests/user_private/run.cjs
// Suite de tests de la spec 14 (14-pii-user-private): separación física de la PII de contacto
// (email + phone) a public.user_private con RLS self-only. Cierra el finding HIGH B3-1.
//
// ⚠️ ESTOS TESTS PASAN VERDE RECIÉN DESPUÉS DE QUE EL LEADER APLIQUE LA MIGRACIÓN 0068 AL REMOTO
// (+ redeploy de las Edge Functions invite_user/accept_invitation). El drop de columnas de PII en
// una tabla en uso es un deploy destructivo coordinado que NO ejecuta el implementer. Hasta el
// apply, la tabla `public.user_private` no existe y estos tests fallan por "tabla inexistente".
// Es esperado y honesto: la migración + EFs + tests viajan juntos en el release.
//
// Corre contra la base remota usando service_role para fixtures y JWTs reales para el assertion.
// Limpia los users/establishments creados al final (CASCADE en establishments; users vía admin).
//
// Trazabilidad R<n> → test en progress/impl_14-pii-user-private.md.
//
// Cubre:
//   T17 (R2.2, R3.1, R3.2) — no-bypass: coworker NO lee email/phone de otro vía PostgREST directo.
//   T18 (R2.1, R2.3, R2.4, R6.1, R6.2) — self-read/update; update de fila ajena → 0 filas.
//   T19 (R5.1, R5.3) — signup trigger puebla users + user_private.
//   T20 (R4.1, R4.2) — estado migrado: cada user con email tiene su fila user_private.
//   T21 (R8.1, R8.3) — precheck de invitación vía user_private (already_member / no-miembro OK).
//   T22 (R8.2, R8.3) — accept_invitation: lookup del email del owner vía user_private no rompe.
//   T23 (R7.1, R7.2) — propagación de email confirmado; pendiente sin confirmar → no cambia.

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
  console.error('Faltan vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN_TAG = `up_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const PASSWORD = 'TestPassword!Aa1';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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
  const { error } = await admin
    .from('user_roles')
    .insert({ user_id: userId, establishment_id: establishmentId, role, active: true });
  if (error) throw new Error(`assignRole: ${error.message}`);
}

async function cleanup() {
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

// =====================================================================
// Tests
// =====================================================================

test('spec 14 — user_private (PII self-only, B3-1)', async (t) => {
  let userA, userB, clientA, clientB, estA;

  await t.test('setup: A y B coworkers (comparten estA activo)', async () => {
    userA = await createTestUser('A');
    userB = await createTestUser('B');
    clientA = await getUserClient(userA.email);
    clientB = await getUserClient(userB.email);

    estA = await createEstablishmentAs(clientA, `${RUN_TAG} estA`);
    // userB es field_operator activo de estA → A y B son coworkers (predicado de users_select_coworkers).
    await assignRoleAsService(userB.id, estA, 'field_operator');

    // Sanity: como coworkers, A ve la fila de B en public.users (id, name) — la tenancy se preserva.
    const { data: coworker, error } = await clientA
      .from('users')
      .select('id, name')
      .eq('id', userB.id)
      .maybeSingle();
    assert.equal(error, null, error && error.message);
    assert.ok(coworker, 'A debería ver el perfil público (id,name) de su coworker B');
  });

  // -------------------------------------------------------------------
  // T17 — NO-BYPASS (clave, B3-1): coworker NO lee email/phone de otro.  R2.2, R3.1, R3.2
  // -------------------------------------------------------------------
  await t.test('T17 R2.2: coworker A NO ve el user_private de B (0 filas)', async () => {
    // Filtrando explícitamente por user_id = B.
    {
      const { data, error } = await clientA
        .from('user_private')
        .select('email, phone')
        .eq('user_id', userB.id);
      assert.equal(error, null, error && error.message);
      assert.deepEqual(data, [], 'RLS self-only debería devolver 0 filas del user_private de B');
    }
    // Sin filtro (select=*): A solo ve SU propia fila, nunca la de B.
    {
      const { data, error } = await clientA.from('user_private').select('*');
      assert.equal(error, null, error && error.message);
      const ids = (data || []).map((r) => r.user_id);
      assert.ok(!ids.includes(userB.id), 'A no debería ver la fila de B ni con select=*');
      assert.ok(ids.every((id) => id === userA.id), 'A solo debería ver su propia fila');
    }
  });

  await t.test('T17 R3.1/R3.2: public.users ya no tiene columnas email/phone', async () => {
    // Pedir email/phone de la fila de B vía PostgREST directo → error (columnas inexistentes tras el drop).
    {
      const { error } = await clientA
        .from('users')
        .select('email, phone')
        .eq('id', userB.id);
      assert.notEqual(error, null, 'select email,phone sobre users debería fallar (columnas dropeadas)');
    }
    // L-3 (defensa): select=* sobre la fila de B no trae ninguna columna de contacto.
    {
      const { data, error } = await clientA
        .from('users')
        .select('*')
        .eq('id', userB.id)
        .maybeSingle();
      assert.equal(error, null, error && error.message);
      assert.ok(data, 'A ve la fila pública de B');
      assert.ok(!('email' in data), 'users.* no debería incluir email');
      assert.ok(!('phone' in data), 'users.* no debería incluir phone');
    }
  });

  // -------------------------------------------------------------------
  // T18 — self-read / self-update.  R2.1, R2.3, R2.4, R6.1, R6.2
  // -------------------------------------------------------------------
  await t.test('T18 R2.1/R6.1: A lee su propio user_private (email + phone)', async () => {
    // Sembramos un phone en la fila de A vía service_role (la fila la creó el trigger de signup).
    {
      const { error } = await admin
        .from('user_private')
        .update({ phone: '+541112345678' })
        .eq('user_id', userA.id);
      assert.equal(error, null, error && error.message);
    }
    const { data, error } = await clientA
      .from('user_private')
      .select('email, phone')
      .eq('user_id', userA.id)
      .maybeSingle();
    assert.equal(error, null, error && error.message);
    assert.ok(data, 'A debería ver su propia fila de user_private');
    assert.equal(data.email, userA.email.toLowerCase());
    assert.equal(data.phone, '+541112345678');
  });

  await t.test('T18 R2.3/R6.2: A actualiza su propio phone (OK)', async () => {
    const { data, error } = await clientA
      .from('user_private')
      .update({ phone: '+541199999999' })
      .eq('user_id', userA.id)
      .select('phone');
    assert.equal(error, null, error && error.message);
    assert.equal(data.length, 1);
    assert.equal(data[0].phone, '+541199999999');
  });

  await t.test('T18 R2.4: A intenta actualizar la fila de B → 0 filas afectadas', async () => {
    const { data, error } = await clientA
      .from('user_private')
      .update({ phone: '+540000000000' })
      .eq('user_id', userB.id)
      .select('phone');
    // RLS with_check + using = auth.uid() → no matchea ninguna fila; PostgREST devuelve [] sin error.
    assert.equal(error, null, error && error.message);
    assert.deepEqual(data, [], 'A no debería poder actualizar el user_private de B');

    // Verificación adversarial: el phone de B NO cambió (lo leemos por service_role).
    const { data: bRow } = await admin
      .from('user_private')
      .select('phone')
      .eq('user_id', userB.id)
      .maybeSingle();
    assert.notEqual(bRow?.phone, '+540000000000', 'el phone de B no debería haberse modificado');
  });

  await t.test('T18 R2.5: A NO puede insertar ni borrar en user_private (sin grant)', async () => {
    // insert directo de cliente → bloqueado (no hay grant de insert + no hay policy de insert).
    {
      const { error } = await clientA
        .from('user_private')
        .insert({ user_id: userA.id, email: `${RUN_TAG}_dup@rafaq-test.local` });
      assert.notEqual(error, null, 'el cliente no debería poder insertar en user_private');
    }
    // delete directo de cliente → bloqueado.
    {
      const { data, error } = await clientA
        .from('user_private')
        .delete()
        .eq('user_id', userA.id)
        .select('user_id');
      // Sin grant de delete → error; o, si el grant faltara, 0 filas. Ambos casos: la fila sigue.
      const { data: still } = await admin
        .from('user_private')
        .select('user_id')
        .eq('user_id', userA.id)
        .maybeSingle();
      assert.ok(still, 'la fila de A no debería haberse borrado desde el cliente');
      assert.ok(error || (data && data.length === 0), 'delete de cliente no debería tener efecto');
    }
  });

  // -------------------------------------------------------------------
  // T19 — signup trigger puebla users + user_private en la misma tx.  R5.1, R5.3
  // -------------------------------------------------------------------
  await t.test('T19 R5.1/R5.3: crear user en auth → fila en users (id,name) Y user_private (user_id,email)', async () => {
    const userC = await createTestUser('C');
    // Fila pública en users.
    const { data: pub, error: pubErr } = await admin
      .from('users')
      .select('id, name')
      .eq('id', userC.id)
      .maybeSingle();
    assert.equal(pubErr, null, pubErr && pubErr.message);
    assert.ok(pub, 'el trigger debería haber creado la fila en public.users');
    assert.equal(pub.name, 'Test C');
    // Fila de contacto en user_private con el email del signup.
    const { data: priv, error: privErr } = await admin
      .from('user_private')
      .select('user_id, email')
      .eq('user_id', userC.id)
      .maybeSingle();
    assert.equal(privErr, null, privErr && privErr.message);
    assert.ok(priv, 'el trigger debería haber creado la fila en public.user_private');
    assert.equal(priv.email, userC.email.toLowerCase());
  });

  // -------------------------------------------------------------------
  // T20 — backfill / estado migrado: cada user con email tiene su user_private.  R4.1, R4.2
  // -------------------------------------------------------------------
  await t.test('T20 R4.1/R4.2: cada user de esta corrida tiene su fila user_private con email', async () => {
    for (const uid of createdUserIds) {
      const { data, error } = await admin
        .from('user_private')
        .select('email')
        .eq('user_id', uid)
        .maybeSingle();
      assert.equal(error, null, error && error.message);
      assert.ok(data, `user ${uid} debería tener su fila user_private`);
      assert.ok(data.email && data.email.length > 0, `user ${uid} debería tener email no vacío`);
    }
  });

  // -------------------------------------------------------------------
  // T23 — propagación de email confirmado.  R7.1, R7.2
  // -------------------------------------------------------------------
  await t.test('T23 R7.1: cambiar el email confirmado (admin) propaga a user_private', async () => {
    const newEmail = `${RUN_TAG}_a_changed@rafaq-test.local`;
    // admin.updateUserById con email + email_confirm:true simula la confirmación: auth.users.email
    // pasa a ser el nuevo → dispara el trigger on_auth_user_email_confirmed.
    const { error } = await admin.auth.admin.updateUserById(userA.id, {
      email: newEmail,
      email_confirm: true,
    });
    assert.equal(error, null, error && error.message);

    const { data, error: readErr } = await admin
      .from('user_private')
      .select('email')
      .eq('user_id', userA.id)
      .maybeSingle();
    assert.equal(readErr, null, readErr && readErr.message);
    assert.equal(
      data.email,
      newEmail.toLowerCase(),
      'user_private.email debería reflejar el email confirmado nuevo',
    );
  });

  await t.test('T23 R7.2: un cambio de email PENDIENTE (auth.users.email sin cambiar) NO toca user_private', async () => {
    // R7.2 — "mientras el cambio de email está pendiente de confirmación, user_private.email NO cambia
    // (sigue el viejo hasta que auth.users confirme)". El invariante REAL del trigger
    // `on_auth_user_email_confirmed` es: propaga SOLO cuando `auth.users.email` realmente cambia
    // (= confirmación; la condición es `new.email IS DISTINCT FROM old.email`). Un cambio PENDIENTE, por
    // definición, deja `auth.users.email` IGUAL (el nuevo vive en `auth.users.email_change` hasta que se
    // confirma) → el trigger no dispara.
    //
    // NO usamos el path user-initiated (`clientB.auth.updateUser({ email })`) para fabricar el estado
    // pendiente: ese endpoint VALIDA el dominio del email (rechaza `.local` con `email_address_invalid`,
    // a diferencia del admin/signup) y manda un mail de confirmación RATE-LIMITED
    // (`over_email_send_rate_limit`, ver docs/backlog.md 2026-06-01) → frágil por partida doble. En su
    // lugar probamos el invariante de forma directa y determinística contra el remoto real: toda
    // mutación de `auth.users` que NO cambia `email` debe dejar `user_private.email` intacto. Eso es,
    // exactamente, lo que ocurre durante un cambio pendiente. La prueba POSITIVA (email confirmado SÍ
    // propaga) ya la cubre T23 R7.1.

    // Caso 1 — update de un campo NO-email de auth.users (user_metadata): el trigger NO debe disparar,
    // user_private.email queda igual. Prueba que la propagación no se gatilla por cualquier UPDATE.
    {
      const { data: before } = await admin
        .from('user_private')
        .select('email')
        .eq('user_id', userB.id)
        .maybeSingle();
      const emailBefore = before.email;

      const { error } = await admin.auth.admin.updateUserById(userB.id, {
        user_metadata: { name: 'Test B', pending_marker: RUN_TAG },
      });
      assert.equal(error, null, error && error.message);

      const { data: after } = await admin
        .from('user_private')
        .select('email')
        .eq('user_id', userB.id)
        .maybeSingle();
      assert.equal(
        after.email,
        emailBefore,
        'un update de auth.users que NO cambia email no debe tocar user_private.email (R7.2)',
      );
    }

    // Caso 2 (el fuerte) — `new.email IS DISTINCT FROM old.email` falso ⇒ no propaga. Desincronizamos a
    // propósito user_private.email a un sentinel y luego hacemos un update de auth.users que deja
    // auth.users.email EXACTAMENTE IGUAL (set email = el mismo valor actual). Como el email canónico no
    // cambia (= la situación de un cambio pendiente, donde el viejo sigue en auth.users.email), el
    // trigger NO debe correr y por tanto NO debe re-sincronizar user_private: el sentinel debe sobrevivir.
    // Si el trigger disparara incorrectamente, pisaría el sentinel con el email de auth.users y el assert
    // fallaría → no puede pasar verde por la razón equivocada.
    {
      const { data: cur } = await admin
        .from('user_private')
        .select('email')
        .eq('user_id', userB.id)
        .maybeSingle();
      const canonicalEmail = cur.email; // = auth.users.email de B (lo seteó el signup/trigger).

      const sentinel = `${RUN_TAG}_b_sentinel@rafaq-test.local`;
      {
        const { error } = await admin
          .from('user_private')
          .update({ email: sentinel })
          .eq('user_id', userB.id);
        assert.equal(error, null, error && error.message);
      }

      // Update de auth.users SIN cambiar el email (mismo valor) → new.email IS DISTINCT FROM old.email = false.
      const { error: updErr } = await admin.auth.admin.updateUserById(userB.id, {
        email: canonicalEmail,
        email_confirm: true,
      });
      assert.equal(updErr, null, updErr && updErr.message);

      const { data: after } = await admin
        .from('user_private')
        .select('email')
        .eq('user_id', userB.id)
        .maybeSingle();
      assert.equal(
        after.email,
        sentinel,
        'con auth.users.email sin cambiar (pendiente), el trigger NO debe correr ni pisar user_private (R7.2)',
      );

      // Restauramos la coherencia para no dejar fixture sucio (cleanup borra los users igual).
      await admin
        .from('user_private')
        .update({ email: canonicalEmail })
        .eq('user_id', userB.id);
    }
  });

  await t.test('cleanup', async () => {
    await cleanup();
  });
});

// -------------------------------------------------------------------
// T21 / T22 — Edge Functions (invite_user precheck + accept_invitation owner lookup).  R8.*
// Requieren que las EFs estén REDEPLOYADAS (leen user_private vía admin-client). Hasta el redeploy,
// fallan por el embed viejo. Por eso van en su propio bloque, claramente separado.
// -------------------------------------------------------------------
test('spec 14 — Edge Functions re-ruteadas a user_private', async (t) => {
  let owner, member, outsider, ownerClient;
  let estA;

  await t.test('setup', async () => {
    owner = await createTestUser('owner');
    member = await createTestUser('member');
    outsider = await createTestUser('outsider');
    ownerClient = await getUserClient(owner.email);
    estA = await createEstablishmentAs(ownerClient, `${RUN_TAG} estEF`);
    // member es miembro activo de estA.
    await assignRoleAsService(member.id, estA, 'field_operator');
  });

  await t.test('T21 R8.1: invitar email de miembro activo → already_member (vía user_private)', async () => {
    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: { establishment_id: estA, email: member.email, role: 'field_operator' },
    });
    // El precheck resuelve el email contra user_private (admin-client) → user_roles activo → 409.
    // Asertamos el CÓDIGO específico (no un error cualquiera) para no pasar verde por la razón
    // equivocada (ej. un db_error si la query a user_private estuviera mal armada).
    let payload = data;
    if (error && error.context && typeof error.context.json === 'function') {
      payload = await error.context.json();
    }
    assert.ok(error || payload?.error, 'invitar a un miembro activo debería fallar');
    assert.ok(payload?.error, 'debería traer el envelope de error');
    assert.equal(payload.error.code, 'already_member', 'el código debería ser already_member, no db_error');
  });

  await t.test('T21 R8.3: invitar email de NO-miembro → invitación OK', async () => {
    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: { establishment_id: estA, email: outsider.email, role: 'veterinarian' },
    });
    assert.equal(error, null, error && error.message);
    assert.ok(data && !data.error, 'invitar a un no-miembro debería crear la invitación');
    assert.ok(data.token, 'debería devolver token');
    assert.ok(data.accept_url, 'debería devolver accept_url');
  });

  await t.test('T22 R8.2/R8.3: aceptar invitación → lookup del email del owner vía user_private no rompe', async () => {
    // Creamos una invitación para outsider y la aceptamos como outsider. El flujo de notificación
    // hace el lookup del email del owner contra user_private (admin-client). El email es best-effort,
    // pero el lookup NO debe romper el flujo (retorna establishment_id + role).
    const token = `tok_${RUN_TAG}_accept`;
    const { error: invErr } = await admin.from('invitations').insert({
      establishment_id: estA,
      invited_by: owner.id,
      email: outsider.email,
      role: 'veterinarian',
      token,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    assert.equal(invErr, null, invErr && invErr.message);

    const outsiderClient = await getUserClient(outsider.email);
    const { data, error } = await outsiderClient.functions.invoke('accept_invitation', {
      body: { token },
    });
    assert.equal(error, null, error && error.message);
    assert.ok(data && !data.error, 'accept_invitation debería retornar OK pese a la PII separada');
    assert.equal(data.establishment_id, estA);
    assert.equal(data.role, 'veterinarian');
  });

  await t.test('cleanup', async () => {
    await cleanup();
  });
});
