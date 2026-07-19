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
    // ⚠️ EL VALOR TIENE QUE SEGUIR SIENDO CANÓNICO (anexo LOW del Gate 1 del delta TELÉFONO). Desde la
    // migración 0126 la columna tiene el CHECK `user_private_phone_format_chk`. Si alguien cambiara
    // '+540000000000' por un valor NO canónico (ej. '11 2345 6789'), el UPDATE fallaría por el CHECK y
    // este test pasaría POR LA RAZÓN EQUIVOCADA: dejaría de verificar la RLS (que es lo que asserta) y
    // pasaría a verificar el formato. '+540000000000' es canónico-válido ('+' + '5' + 12 dígitos).
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

// =====================================================================
// spec 01 — delta TELÉFONO: CHECK de formato `user_private_phone_format_chk` (migración 0126)
// =====================================================================
// Cubre RTEL.14.4 (rechaza no canónico / acepta canónico), RTEL.14.5 (un UPDATE de email sobre una fila
// con phone canónico NO se rompe), RTEL.14.6 / RTEL.11.2 (vectores de inyección, incluido el newline
// FINAL) y RTEL.14.11 / RTEL.2.9.1 (la tabla compartida de vectores, mitad backend).
//
// Se escribe con el JWT del PROPIO usuario, no con service_role, porque ese es el modelo de amenaza
// real (RTEL.5.6): el bundle de RN es modificable y PostgREST es alcanzable con el token del usuario.
// El service_role bypassa la RLS pero NO un CHECK; usar el cliente autenticado prueba las dos cosas a
// la vez — que la RLS lo deja escribir SU fila y que el CHECK igual lo frena.
//
// ⚠️ HASTA QUE EL LEADER APLIQUE 0126 al remoto, este bloque se AUTO-SALTEA (el probe de abajo detecta
//    que el constraint no existe). Se saltea en vez de fallar para no poner en rojo el resto de la
//    suite spec 14, que no depende de esta migración. La tarea T23 del delta exige verlo en VERDE
//    (no salteado) después del apply: si sigue diciendo SKIP post-deploy, la migración no entró.

const PHONE_VECTORS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'app', 'src', 'utils', 'phone-vectors.json'), 'utf8'),
);

/** Código Postgres de violación de CHECK constraint. */
const CHECK_VIOLATION = '23514';

/** ¿El error es el rechazo del CHECK de FORMATO del teléfono (y no otra cosa)? */
function isPhoneFormatRejection(error) {
  return Boolean(
    error &&
      error.code === CHECK_VIOLATION &&
      /user_private_phone_format_chk/.test(`${error.message} ${error.details || ''}`),
  );
}

test('spec 01 delta TELÉFONO — user_private_phone_format_chk (migración 0126)', async (t) => {
  let user, client, applied;

  await t.test('setup + probe de la migración 0126', async () => {
    user = await createTestUser('phone');
    client = await getUserClient(user.email);

    // Probe: intentar escribir un valor NO canónico en la fila propia. Con 0126 aplicada → 23514.
    const { error } = await client
      .from('user_private')
      .update({ phone: '11 2345 6789' })
      .eq('user_id', user.id);
    applied = isPhoneFormatRejection(error);
    if (!applied) {
      console.log(
        '\n>>> SKIP: `user_private_phone_format_chk` no existe todavía en el remoto. Los tests del ' +
          'delta TELÉFONO se saltean hasta que el leader aplique supabase/migrations/' +
          '0126_user_private_phone_format.sql (T22). Post-apply deben quedar en VERDE (T23).\n',
      );
      // Dejamos la fila en un estado canónico igual, para no ensuciar el fixture.
      await client.from('user_private').update({ phone: '+541123456789' }).eq('user_id', user.id);
    }
  });

  // -------------------------------------------------------------------
  // RTEL.14.4 / RTEL.7.1 — el CHECK rechaza lo no canónico y acepta lo canónico.
  // -------------------------------------------------------------------
  await t.test('RTEL.14.4: el CHECK rechaza formatos no canónicos', async (st) => {
    if (!applied) return st.skip('0126 no aplicada');
    const rejected = [
      ['11 2345 6789', 'con separadores (lo que escribía el cliente viejo)'],
      ['abc', 'letras'],
      ['1123456789', 'los 10 dígitos SIN el +54: no es el canónico'],
      ['+549112345678901234', '18 dígitos: pasa el cap de largo (32) pero no el de formato'],
      // RTEL.5.6 — LA PRUEBA DE QUE EL CLIENTE NO ES LA FRONTERA: `+0123456789` es exactamente el
      // valor que un cliente MODIFICADO podría mandar salteándose la validación de UX. El CHECK lo
      // frena igual (^\+[1-9]…). Es además el borde que MEDIUM-1 alineó entre cliente y server.
      ['+0123456789', 'código de país que empieza con 0'],
    ];
    for (const [value, why] of rejected) {
      const { error } = await client
        .from('user_private')
        .update({ phone: value })
        .eq('user_id', user.id);
      assert.ok(isPhoneFormatRejection(error), `"${value}" debería ser rechazado (${why})`);
    }
  });

  await t.test('RTEL.14.4: el CHECK acepta el canónico y el NULL', async (st) => {
    if (!applied) return st.skip('0126 no aplicada');
    for (const value of ['+541123456789', '+542241430000', '+34600123456']) {
      const { data, error } = await client
        .from('user_private')
        .update({ phone: value })
        .eq('user_id', user.id)
        .select('phone');
      assert.equal(error, null, error && error.message);
      assert.equal(data.length, 1);
      assert.equal(data[0].phone, value);
    }
    // NULL = "sin teléfono" (el perfil lo permite; la fila nace así desde handle_new_auth_user).
    const { data, error } = await client
      .from('user_private')
      .update({ phone: null })
      .eq('user_id', user.id)
      .select('phone');
    assert.equal(error, null, error && error.message);
    assert.equal(data[0].phone, null);
  });

  // -------------------------------------------------------------------
  // RTEL.14.11 / RTEL.2.9.1 — la tabla COMPARTIDA de vectores, mitad backend.
  // -------------------------------------------------------------------
  // Si el encoding TypeScript (app/src/utils/phone.ts, ejercitado por phone.test.ts) y el del CHECK
  // divergen en CUALQUIER borde, una de las dos suites se pone roja. No es prolijidad: es la pata
  // declarada de la aceptación del riesgo R-7 (el rechazo del CHECK deja PII en el log del servidor;
  // se acepta porque, con las dos definiciones alineadas, es prácticamente inalcanzable).
  await t.test('RTEL.14.11: el CHECK acepta TODOS los canónicos de phone-vectors.json', async (st) => {
    if (!applied) return st.skip('0126 no aplicada');
    assert.ok(PHONE_VECTORS.normalizable.length >= 20, 'la tabla de vectores no debería encogerse');
    for (const v of PHONE_VECTORS.normalizable) {
      const { error } = await client
        .from('user_private')
        .update({ phone: v.expected })
        .eq('user_id', user.id);
      assert.equal(
        error,
        null,
        `el canónico de "${v.input}" (${v.expected}, regla ${v.rule}) debería ser aceptado por el ` +
          `CHECK — si esto falla, el cliente está produciendo algo que el server rechaza (23514) y ` +
          `R-7 deja de ser inalcanzable: ${error && error.message}`,
      );
    }
  });

  await t.test('RTEL.14.11: el CHECK rechaza TODOS los no normalizables de phone-vectors.json', async (st) => {
    if (!applied) return st.skip('0126 no aplicada');
    // Los de razón `empty` no son valores a persistir (el perfil guarda NULL), así que no aplican.
    const unrecognized = PHONE_VECTORS.rejected.filter((v) => v.reason === 'unrecognized');
    assert.ok(unrecognized.length >= 10, 'deberían quedar vectores de rechazo para ejercitar');
    for (const v of unrecognized) {
      const { error } = await client
        .from('user_private')
        .update({ phone: v.input })
        .eq('user_id', user.id);
      assert.ok(
        isPhoneFormatRejection(error),
        `"${v.input}" debería ser rechazado por el CHECK (${v.why})`,
      );
    }
  });

  // -------------------------------------------------------------------
  // RTEL.14.6 / RTEL.11.2 / RTEL.11.2.1 — saneamiento: nada de inyección puede quedar persistido.
  // -------------------------------------------------------------------
  await t.test('RTEL.14.6: el CHECK rechaza los vectores de inyección', async (st) => {
    if (!applied) return st.skip('0126 no aplicada');
    const CANON = '+541123456789';
    const vectors = [
      // ⚠️ EL CASO CRÍTICO, primero y explícito: newline AL FINAL. En PCRE (Perl, JavaScript) `$`
      // matchea ANTES de un \n final, con lo cual un CHECK escrito igual en un motor tipo PCRE
      // ACEPTARÍA '+541123456789\n'. Postgres usa POSIX ARE y, sin newline-sensitive matching
      // (apagado por default), `$` ancla solo al fin de string. La garantía de RTEL.11.2 DEPENDE de
      // esa diferencia, así que queda fijada como test y no como supuesto de la spec.
      [`${CANON}\n`, 'newline AL FINAL (semántica POSIX vs PCRE)'],
      [`\n${CANON}`, 'newline al inicio'],
      [`+5411\n23456789`, 'newline en el medio'],
      [`${CANON}\r`, 'carriage return'],
      [`${CANON}\t`, 'tab'],
      ['+54 1123456789', 'espacio'],
      [`${CANON}'`, 'comilla simple'],
      ['+54112345678<script>', 'marcado HTML'],
      ['+54١٢٣٤٥٦٧٨٩٠', 'dígitos arábigo-índicos ([0-9] es ASCII-only)'],
      ['+0411234567', 'código de país que empieza con 0'],
      ['541123456789', 'sin el + inicial'],
    ];
    for (const [value, why] of vectors) {
      const { error } = await client
        .from('user_private')
        .update({ phone: value })
        .eq('user_id', user.id);
      assert.ok(isPhoneFormatRejection(error), `debería rechazar: ${why}`);
    }
    // Nota: chr(0) (NUL) no llega siquiera a evaluarse — Postgres lo rechaza a nivel de TIPO
    // (54000: null character not permitted). Ese vector lo cierra `text`, no el constraint.

    // Verificación adversarial: tras todos los rechazos, la fila NO quedó con basura.
    const { data } = await admin
      .from('user_private')
      .select('phone')
      .eq('user_id', user.id)
      .maybeSingle();
    assert.ok(
      data.phone === null || /^\+[1-9][0-9]{7,14}$/.test(data.phone),
      'la fila debería haber quedado con un valor canónico o NULL',
    );
  });

  // -------------------------------------------------------------------
  // RTEL.14.5 / RTEL.11.4 — el CHECK no rompe `propagate_confirmed_email`.
  // -------------------------------------------------------------------
  await t.test('RTEL.14.5: un UPDATE de email sobre una fila con phone canónico NO es rechazado', async (st) => {
    if (!applied) return st.skip('0126 no aplicada');
    // Postgres evalúa TODOS los CHECK de la fila en CUALQUIER update, cambie o no la columna
    // restringida. Ese es el hazard que DP3 previene (residuo cero antes del VALIDATE): con un phone
    // legacy sucio, el `update user_private set email = ...` del trigger propagate_confirmed_email
    // (0068:169-194) fallaría y ABORTARÍA la confirmación de cambio de email del usuario.
    {
      const { error } = await client
        .from('user_private')
        .update({ phone: '+541123456789' })
        .eq('user_id', user.id);
      assert.equal(error, null, error && error.message);
    }
    // El UPDATE de email lo hace el trigger con permisos de definer; acá lo simulamos con
    // service_role (el cliente no tiene grant para escribir su email) sobre la MISMA fila.
    const newEmail = `${RUN_TAG}_phone_changed@rafaq-test.local`;
    const { error: emailErr } = await admin
      .from('user_private')
      .update({ email: newEmail })
      .eq('user_id', user.id);
    assert.equal(
      emailErr,
      null,
      `el UPDATE de email no debería tropezar con el CHECK de teléfono: ${emailErr && emailErr.message}`,
    );

    // Y el camino REAL del trigger: confirmar un email nuevo en auth.users propaga a user_private.
    const confirmedEmail = `${RUN_TAG}_phone_confirmed@rafaq-test.local`;
    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      email: confirmedEmail,
      email_confirm: true,
    });
    assert.equal(authErr, null, authErr && authErr.message);
    const { data } = await admin
      .from('user_private')
      .select('email, phone')
      .eq('user_id', user.id)
      .maybeSingle();
    assert.equal(data.email, confirmedEmail.toLowerCase(), 'la propagación de email debe seguir andando');
    assert.equal(data.phone, '+541123456789', 'el teléfono canónico no se toca');
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
