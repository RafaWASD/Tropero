// supabase/tests/edge/run.cjs
// Suite de tests para Edge Functions de Fase 2 (spec 01-identity-multitenancy).
// Corre contra el proyecto remoto con JWTs reales de users de prueba.
// Cubre: T2.1, T2.2, T2.3, T2.4, T2.5, T2.6, T2.7, T6.3 (delete_account).
//
// Trazabilidad R<n> documentada en progress/impl_01-identity-multitenancy.md
// (Fase 2) y progress/impl_01-frontend-fase6-backend.md (T6.3 / R2.4, R2.5, R2.5.1).

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

const supabaseJsPath = path.join(
  REPO_ROOT,
  'app',
  'node_modules',
  '@supabase',
  'supabase-js',
);
const { createClient: createClientRaw } = require(supabaseJsPath);
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
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error('Faltan vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY');
  process.exit(2);
}

const RUN_TAG = `edge_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

test('Edge Functions — Fase 2', async (t) => {
  let owner, member, otherOwner;
  let ownerClient, memberClient, otherOwnerClient;
  let estA; // owner's establishment
  let estB; // otherOwner's establishment, para cross-tenant checks

  await t.test('setup', async () => {
    owner = await createTestUser('owner');
    member = await createTestUser('member');
    otherOwner = await createTestUser('other');
    ownerClient = await getUserClient(owner.email);
    memberClient = await getUserClient(member.email);
    otherOwnerClient = await getUserClient(otherOwner.email);

    estA = await createEstablishmentAs(ownerClient, `${RUN_TAG} estA`);
    estB = await createEstablishmentAs(otherOwnerClient, `${RUN_TAG} estB`);
  });

  // ===================================================================
  // T2.7 — register_push_token
  // ===================================================================
  await t.test('T2.7 R5.11: user registra su push token (upsert)', async () => {
    const tokenValue = `ExponentPushToken[${RUN_TAG}_dev1]`;
    const { data, error } = await ownerClient.functions.invoke(
      'register_push_token',
      {
        body: {
          expo_push_token: tokenValue,
          device_id: 'device-abc',
          platform: 'android',
        },
      },
    );
    assert.equal(error, null, error && error.message);
    assert.ok(data.token_id, 'debería retornar token_id');

    // Re-registro mismo token: upsert, no duplica.
    const { data: data2, error: error2 } = await ownerClient.functions.invoke(
      'register_push_token',
      {
        body: {
          expo_push_token: tokenValue,
          device_id: 'device-abc',
          platform: 'android',
        },
      },
    );
    assert.equal(error2, null, error2 && error2.message);
    assert.equal(data2.token_id, data.token_id, 'upsert debería retornar mismo id');

    const { data: tokens } = await admin
      .from('push_tokens')
      .select('id')
      .eq('user_id', owner.id)
      .eq('token', tokenValue);
    assert.equal(tokens.length, 1, 'no debería haber duplicado');
  });

  await t.test('T2.7: input inválido falla 400', async () => {
    const { data, error } = await ownerClient.functions.invoke(
      'register_push_token',
      { body: { device_id: 'x' } },
    );
    // FunctionsHttpError pone el body en `error.context.body` o similar.
    // Lo que importa: data debería tener el shape de error nuestro O error no-null.
    if (error) {
      assert.ok(error.message, 'debería haber mensaje de error');
    } else {
      assert.ok(data?.error, 'expected error envelope');
      assert.equal(data.error.code, 'invalid_input');
    }
  });

  // ===================================================================
  // T2.1 — invite_user
  // ===================================================================
  let invitationId;
  let invitationToken;

  await t.test('T2.1 R5.1: owner crea invitación OK', async () => {
    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        email: `${RUN_TAG}_invitee@rafaq-test.local`,
        role: 'veterinarian',
      },
    });
    assert.equal(error, null, error && error.message);
    assert.ok(data.invitation_id);
    assert.ok(data.token);
    assert.ok(data.accept_url, 'debería retornar accept_url');
    assert.ok(
      data.accept_url.includes(encodeURIComponent(data.token)),
      'accept_url debería incluir el token',
    );
    assert.ok(data.expires_at, 'debería retornar expires_at');
    invitationId = data.invitation_id;
    invitationToken = data.token;
  });

  await t.test('T2.1 ADR-014: owner crea invitación SIN email', async () => {
    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        role: 'veterinarian',
      },
    });
    assert.equal(error, null, error && error.message);
    assert.ok(data.invitation_id, 'debería retornar invitation_id');
    assert.ok(data.token, 'debería retornar token');
    assert.ok(data.accept_url, 'debería retornar accept_url');
    assert.ok(
      data.accept_url.includes(encodeURIComponent(data.token)),
      'accept_url debería incluir el token',
    );

    // Verifica en DB que la fila quedó con email=null.
    const { data: row } = await admin
      .from('invitations')
      .select('email, status')
      .eq('id', data.invitation_id)
      .single();
    assert.equal(row.email, null, 'email debería quedar null');
    assert.equal(row.status, 'pending');

    // Cancelamos esta invitación para que no interfiera con tests posteriores
    // (queda en estado cancelled, fuera del flujo principal).
    await admin
      .from('invitations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', data.invitation_id);
  });

  await t.test('T2.1: non-owner falla 403', async () => {
    const { data, error } = await memberClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        email: `${RUN_TAG}_intruder@rafaq-test.local`,
        role: 'veterinarian',
      },
    });
    // El edge devuelve 403, supabase-js lo mete como error.
    assert.ok(error || data?.error, 'debería fallar');
  });

  await t.test('T2.1: role owner inválido (400)', async () => {
    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        email: `${RUN_TAG}_invalid@rafaq-test.local`,
        role: 'owner',
      },
    });
    assert.ok(error || data?.error, 'debería fallar por role inválido');
  });

  await t.test('T2.1 R5.9: invitar email que ya es miembro falla 409', async () => {
    // Damos rol activo a `member` en estA vía service_role.
    await admin
      .from('user_roles')
      .insert({
        user_id: member.id,
        establishment_id: estA,
        role: 'field_operator',
        active: true,
      });

    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        email: member.email,
        role: 'field_operator',
      },
    });
    assert.ok(error || data?.error, 'no debería poder invitar miembro existente');
  });

  await t.test('T2.1: invitar email con pending no expirada falla 409', async () => {
    const sameEmail = `${RUN_TAG}_invitee@rafaq-test.local`;
    const { data, error } = await ownerClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        email: sameEmail,
        role: 'veterinarian',
      },
    });
    assert.ok(error || data?.error, 'no debería poder reinvitar pending');
  });

  // ===================================================================
  // T2.4 — resend_invitation
  // ===================================================================
  await t.test('T2.4 R5.8: owner reenvía → nuevo token', async () => {
    const { data, error } = await ownerClient.functions.invoke(
      'resend_invitation',
      { body: { invitation_id: invitationId } },
    );
    assert.equal(error, null, error && error.message);
    assert.ok(data.token);
    assert.notEqual(data.token, invitationToken, 'token debería cambiar');
    assert.ok(data.accept_url, 'debería retornar accept_url');
    assert.ok(
      data.accept_url.includes(encodeURIComponent(data.token)),
      'accept_url debería incluir el nuevo token',
    );
    assert.ok(data.expires_at, 'debería retornar expires_at');

    // Verifica que el token viejo ya no está vivo en DB.
    const { data: byOld } = await admin
      .from('invitations')
      .select('id')
      .eq('token', invitationToken)
      .maybeSingle();
    assert.equal(byOld, null, 'token viejo no debería existir');

    invitationToken = data.token;
  });

  await t.test('T2.4: non-owner no puede reenviar', async () => {
    const { data, error } = await memberClient.functions.invoke(
      'resend_invitation',
      { body: { invitation_id: invitationId } },
    );
    assert.ok(error || data?.error, 'debería fallar');
  });

  // ===================================================================
  // T2.3 — cancel_invitation
  // ===================================================================
  await t.test('T2.3 R5.7: owner cancela invitación', async () => {
    // Creamos una nueva invitación para no tocar la que usamos en accept_invitation.
    const { data: created } = await ownerClient.functions.invoke('invite_user', {
      body: {
        establishment_id: estA,
        email: `${RUN_TAG}_tocancel@rafaq-test.local`,
        role: 'field_operator',
      },
    });
    assert.ok(created.invitation_id);

    const { data, error } = await ownerClient.functions.invoke(
      'cancel_invitation',
      { body: { invitation_id: created.invitation_id } },
    );
    assert.equal(error, null, error && error.message);
    assert.equal(data.ok, true);

    const { data: inv } = await admin
      .from('invitations')
      .select('status')
      .eq('id', created.invitation_id)
      .single();
    assert.equal(inv.status, 'cancelled');
  });

  await t.test('T2.3: cancelar ya cancelada falla 409', async () => {
    // Reusamos la invitación anterior - ya está cancelled.
    const { data: cancelled } = await admin
      .from('invitations')
      .select('id')
      .eq('email', `${RUN_TAG}_tocancel@rafaq-test.local`)
      .single();

    const { data, error } = await ownerClient.functions.invoke(
      'cancel_invitation',
      { body: { invitation_id: cancelled.id } },
    );
    assert.ok(error || data?.error, 'debería fallar (ya cancelled)');
  });

  // ===================================================================
  // T2.2 — accept_invitation
  // ===================================================================
  let invitee;
  let inviteeClient;

  await t.test('T2.2 R5.5: destinatario acepta invitación', async () => {
    // Creamos el user destinatario con el mismo email de la invitación pending
    // (que actualmente tiene el token nuevo de T2.4).
    const inviteeEmail = `${RUN_TAG}_invitee@rafaq-test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email: inviteeEmail,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Invitee' },
    });
    assert.equal(error, null, error && error.message);
    invitee = { id: data.user.id, email: inviteeEmail };
    createdUserIds.push(invitee.id);
    inviteeClient = await getUserClient(inviteeEmail);

    const { data: accepted, error: accErr } = await inviteeClient.functions.invoke(
      'accept_invitation',
      { body: { token: invitationToken } },
    );
    assert.equal(accErr, null, accErr && accErr.message);
    assert.equal(accepted.establishment_id, estA);
    assert.equal(accepted.role, 'veterinarian');

    // Verifica user_roles + invitations.status.
    const { data: ur } = await admin
      .from('user_roles')
      .select('role, active')
      .eq('user_id', invitee.id)
      .eq('establishment_id', estA)
      .eq('active', true);
    assert.equal(ur.length, 1);
    assert.equal(ur[0].role, 'veterinarian');

    const { data: inv } = await admin
      .from('invitations')
      .select('status, accepted_at')
      .eq('id', invitationId)
      .single();
    assert.equal(inv.status, 'accepted');
    assert.ok(inv.accepted_at);
  });

  await t.test('T2.2: reaceptar ya accepted falla', async () => {
    const { data, error } = await inviteeClient.functions.invoke(
      'accept_invitation',
      { body: { token: invitationToken } },
    );
    assert.ok(error || data?.error, 'debería fallar (ya accepted)');
  });

  await t.test('T2.2 R5.6: invitación expirada falla', async () => {
    // Creamos una invitación pending y le ponemos expires_at en el pasado.
    const expiredToken = `expired_${RUN_TAG}_${Math.random().toString(36).slice(2, 8)}`;
    const expiredEmail = `${RUN_TAG}_expired@rafaq-test.local`;

    const { data: created, error: createErr } = await admin
      .from('invitations')
      .insert({
        establishment_id: estA,
        invited_by: owner.id,
        email: expiredEmail,
        role: 'field_operator',
        token: expiredToken,
        status: 'pending',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      })
      .select('id')
      .single();
    assert.equal(createErr, null, createErr && createErr.message);

    // Creamos user para que email matchee.
    const { data: u } = await admin.auth.admin.createUser({
      email: expiredEmail,
      password: PASSWORD,
      email_confirm: true,
    });
    createdUserIds.push(u.user.id);
    const expClient = await getUserClient(expiredEmail);

    const { data, error } = await expClient.functions.invoke(
      'accept_invitation',
      { body: { token: expiredToken } },
    );
    assert.ok(error || data?.error, 'debería fallar por expiración');

    // Verifica que quedó status='expired'.
    const { data: inv } = await admin
      .from('invitations')
      .select('status')
      .eq('id', created.id)
      .single();
    assert.equal(inv.status, 'expired');
  });

  await t.test(
    'T2.2 ADR-014: token bearer funciona con email distinto al de la invitación',
    async () => {
      // Crear invitación pending anotada con un email X, pero el user que la
      // acepta tiene un email Y distinto. En el modelo bearer (ADR-014) el
      // token vale por sí solo y el flujo debe completarse.
      const bearerToken = `bearer_${RUN_TAG}_${Math.random().toString(36).slice(2, 8)}`;
      const annotationEmail = `${RUN_TAG}_annotation@rafaq-test.local`;

      const { data: invRow, error: invErr } = await admin
        .from('invitations')
        .insert({
          establishment_id: estA,
          invited_by: owner.id,
          email: annotationEmail,
          role: 'veterinarian',
          token: bearerToken,
          status: 'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        })
        .select('id')
        .single();
      assert.equal(invErr, null, invErr && invErr.message);

      // Creamos un user con email distinto al de la anotación.
      const bearerEmail = `${RUN_TAG}_bearer@rafaq-test.local`;
      const { data: u, error: uErr } = await admin.auth.admin.createUser({
        email: bearerEmail,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name: 'Bearer User' },
      });
      assert.equal(uErr, null, uErr && uErr.message);
      const bearerUserId = u.user.id;
      createdUserIds.push(bearerUserId);
      const bearerClient = await getUserClient(bearerEmail);

      const { data: accepted, error: accErr } =
        await bearerClient.functions.invoke('accept_invitation', {
          body: { token: bearerToken },
        });
      assert.equal(accErr, null, accErr && accErr.message);
      assert.equal(accepted.establishment_id, estA);
      assert.equal(accepted.role, 'veterinarian');

      // Verifica user_roles activo para el bearer user (no para el email de
      // anotación).
      const { data: ur } = await admin
        .from('user_roles')
        .select('role, active')
        .eq('user_id', bearerUserId)
        .eq('establishment_id', estA)
        .eq('active', true);
      assert.equal(ur.length, 1, 'debería haber un user_roles activo');
      assert.equal(ur[0].role, 'veterinarian');

      // Verifica invitación marcada accepted.
      const { data: inv } = await admin
        .from('invitations')
        .select('status')
        .eq('id', invRow.id)
        .single();
      assert.equal(inv.status, 'accepted');
    },
  );

  await t.test(
    'T2.2 R5.9: aceptar cuando ya soy miembro falla 409',
    async () => {
      // Creamos una invitación pending para estA con cualquier rol.
      const memberToken = `member_${RUN_TAG}_${Math.random().toString(36).slice(2, 8)}`;
      await admin.from('invitations').insert({
        establishment_id: estA,
        invited_by: owner.id,
        email: null,
        role: 'field_operator',
        token: memberToken,
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      });

      // El owner ya es owner activo de estA. Aceptar debería fallar 409
      // already_member (modelo bearer: el check duro de R5.9 vive acá).
      const { data, error } = await ownerClient.functions.invoke(
        'accept_invitation',
        { body: { token: memberToken } },
      );
      assert.ok(error || data?.error, 'debería fallar already_member');
    },
  );

  // ===================================================================
  // T2.6 — change_member_role
  // ===================================================================
  await t.test('T2.6 R4.5: owner cambia rol de field_operator → veterinarian', async () => {
    // `member` está como field_operator en estA (lo dejamos en T2.1 R5.9).
    const { data, error } = await ownerClient.functions.invoke(
      'change_member_role',
      {
        body: {
          user_id: member.id,
          establishment_id: estA,
          new_role: 'veterinarian',
        },
      },
    );
    assert.equal(error, null, error && error.message);
    assert.equal(data.ok, true);

    const { data: roles } = await admin
      .from('user_roles')
      .select('role, active')
      .eq('user_id', member.id)
      .eq('establishment_id', estA);
    const activeRoles = roles.filter((r) => r.active);
    assert.equal(activeRoles.length, 1);
    assert.equal(activeRoles[0].role, 'veterinarian');
    // Hay 2 filas: la vieja desactivada y la nueva activa.
    assert.equal(roles.length, 2);
  });

  await t.test('T2.6 R4.6: degradar único owner falla 409', async () => {
    // owner es único owner de estA.
    const { data, error } = await ownerClient.functions.invoke(
      'change_member_role',
      {
        body: {
          user_id: owner.id,
          establishment_id: estA,
          new_role: 'field_operator',
        },
      },
    );
    assert.ok(error || data?.error, 'debería fallar last_owner');
  });

  await t.test('T2.6: non-owner no puede cambiar roles', async () => {
    const { data, error } = await memberClient.functions.invoke(
      'change_member_role',
      {
        body: {
          user_id: invitee.id,
          establishment_id: estA,
          new_role: 'field_operator',
        },
      },
    );
    assert.ok(error || data?.error, 'debería fallar (no es owner)');
  });

  // ===================================================================
  // T2.5 — remove_member
  // ===================================================================
  await t.test('T2.5 R4.7: owner remueve miembro', async () => {
    const { data, error } = await ownerClient.functions.invoke(
      'remove_member',
      {
        body: {
          user_id: member.id,
          establishment_id: estA,
        },
      },
    );
    assert.equal(error, null, error && error.message);
    assert.equal(data.ok, true);

    const { data: active } = await admin
      .from('user_roles')
      .select('id')
      .eq('user_id', member.id)
      .eq('establishment_id', estA)
      .eq('active', true);
    assert.equal(active.length, 0, 'member no debería tener rol activo');
  });

  await t.test('T2.5 R4.6/R4.7: remover único owner falla 409', async () => {
    const { data, error } = await ownerClient.functions.invoke('remove_member', {
      body: { user_id: owner.id, establishment_id: estA },
    });
    assert.ok(error || data?.error, 'debería fallar last_owner');
  });

  await t.test('T2.5: non-owner no puede remover', async () => {
    const { data, error } = await otherOwnerClient.functions.invoke(
      'remove_member',
      {
        body: { user_id: owner.id, establishment_id: estA },
      },
    );
    assert.ok(error || data?.error, 'debería fallar (no es owner de estA)');
  });
});

// =====================================================================
// T6.3 — delete_account (R2.4, R2.5, R2.5.1)
// Bloque aislado: crea SUS PROPIOS usuarios/campos namespaced (no toca los
// compartidos del bloque Fase 2, que se reusan entre tests). Los user ids se
// registran en createdUserIds para el cleanup global (admin.deleteUser cascadea
// public.users aun si quedó soft-deleteado/baneado).
// =====================================================================

// Devuelve el access token (JWT) de un userClient logueado.
async function getAccessToken(userClient) {
  const { data, error } = await userClient.auth.getSession();
  if (error) throw new Error(`getSession: ${error.message}`);
  const token = data?.session?.access_token;
  if (!token) throw new Error('getSession: sin access_token');
  return token;
}

// Inserta un owner-role activo directo (service_role) — para armar 2do owner / setups.
async function grantOwnerRole(userId, establishmentId) {
  const { error } = await admin.from('user_roles').insert({
    user_id: userId,
    establishment_id: establishmentId,
    role: 'owner',
    active: true,
  });
  if (error) throw new Error(`grantOwnerRole: ${error.message}`);
}

test('Edge Functions — delete_account (T6.3)', async (t) => {
  await t.test('Test 1 — R2.4: baja simple (usuario sin campos) → 200', async () => {
    const u = await createTestUser('del_simple');
    const uClient = await getUserClient(u.email);

    const { data, error } = await uClient.functions.invoke('delete_account', {
      body: {},
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.ok, true);

    // users.deleted_at set + ningún rol activo.
    const { data: urow } = await admin
      .from('users')
      .select('deleted_at')
      .eq('id', u.id)
      .single();
    assert.ok(urow.deleted_at, 'users.deleted_at debería estar seteado');

    const { data: activeRoles } = await admin
      .from('user_roles')
      .select('id')
      .eq('user_id', u.id)
      .eq('active', true);
    assert.equal(activeRoles.length, 0, 'no debería quedar ningún rol activo');
  });

  await t.test('Test 2 — HIGH-1: login posterior al ban FALLA', async () => {
    const u = await createTestUser('del_ban');
    const uClient = await getUserClient(u.email);

    const { error } = await uClient.functions.invoke('delete_account', {
      body: {},
    });
    assert.equal(error, null, error && error.message);

    // Re-login con las mismas credenciales debe ser rechazado (ban).
    const fresh = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signin, error: signinErr } =
      await fresh.auth.signInWithPassword({ email: u.email, password: PASSWORD });
    assert.ok(signinErr, 'el re-login debería fallar tras el ban');
    assert.ok(
      !signin?.session,
      'no debería haber sesión tras el ban',
    );
  });

  await t.test(
    'Test 3 — R2.5: único owner de campo activo bloquea (409 sole_owner, sin escribir)',
    async () => {
      const u = await createTestUser('del_sole');
      const uClient = await getUserClient(u.email);
      const est = await createEstablishmentAs(uClient, `${RUN_TAG} del_sole_est`);

      const { data, error } = await uClient.functions.invoke('delete_account', {
        body: {},
      });
      // El edge devuelve 409; supabase-js lo expone como error O como data.error.
      let payload = data;
      if (error && error.context && typeof error.context.json === 'function') {
        payload = await error.context.json();
      }
      assert.ok(
        (error || payload?.error),
        'debería fallar con sole_owner',
      );
      assert.ok(payload?.error, 'debería traer el envelope de error');
      assert.equal(payload.error.code, 'sole_owner');
      assert.ok(
        Array.isArray(payload.error.establishments),
        'debería listar establishments bloqueantes',
      );
      const blocked = payload.error.establishments.find((e) => e.id === est);
      assert.ok(blocked, 'el campo del usuario debería estar en la lista');
      assert.equal(blocked.name, `${RUN_TAG} del_sole_est`);

      // NO se escribió: deleted_at null + rol owner sigue activo.
      const { data: urow } = await admin
        .from('users')
        .select('deleted_at')
        .eq('id', u.id)
        .single();
      assert.equal(urow.deleted_at, null, 'no debería haberse soft-deleteado');
      const { data: roles } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', u.id)
        .eq('active', true);
      assert.equal(roles.length, 1, 'el rol owner debería seguir activo');
    },
  );

  await t.test('Test 4 — owner con 2do owner NO bloquea → 200', async () => {
    const u = await createTestUser('del_twoown');
    const u2 = await createTestUser('del_twoown2');
    const uClient = await getUserClient(u.email);
    const est = await createEstablishmentAs(uClient, `${RUN_TAG} del_twoown_est`);
    // Segundo owner activo del mismo campo.
    await grantOwnerRole(u2.id, est);

    const { data, error } = await uClient.functions.invoke('delete_account', {
      body: {},
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.ok, true);

    // El usuario quedó sin rol activo; el campo conserva al otro owner.
    const { data: roles } = await admin
      .from('user_roles')
      .select('id')
      .eq('user_id', u.id)
      .eq('active', true);
    assert.equal(roles.length, 0, 'el usuario no debería tener rol activo');

    const { count } = await admin
      .from('user_roles')
      .select('id', { count: 'exact', head: true })
      .eq('establishment_id', est)
      .eq('role', 'owner')
      .eq('active', true);
    assert.equal(count, 1, 'el campo debería conservar al otro owner');
  });

  await t.test('Test 5 — D4: campo ya soft-deleteado no bloquea → 200', async () => {
    const u = await createTestUser('del_softest');
    const uClient = await getUserClient(u.email);
    const est = await createEstablishmentAs(uClient, `${RUN_TAG} del_softest_est`);
    // Soft-delete del campo (el usuario es único owner, pero el campo ya está borrado).
    const { error: sdErr } = await admin
      .from('establishments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', est);
    assert.equal(sdErr, null, sdErr && sdErr.message);

    const { data, error } = await uClient.functions.invoke('delete_account', {
      body: {},
    });
    assert.equal(error, null, error && error.message);
    assert.equal(data.ok, true);

    const { data: urow } = await admin
      .from('users')
      .select('deleted_at')
      .eq('id', u.id)
      .single();
    assert.ok(urow.deleted_at, 'debería haberse soft-deleteado');
  });

  await t.test(
    'Test 6 — tras la baja el token queda revocado (signOut global) → 401',
    async () => {
      // Propiedad de seguridad REAL (más fuerte que la idempotencia que el test
      // asumía): la baja hace `signOut(global)` server-side, que REVOCA la sesión.
      // El access token (firma válida, ~1h de vida) ya NO sirve para re-operar:
      // pasa el gateway (verify_jwt ON deja pasar la firma OK), llega al código, y
      // `requireUser` → `getUser()` falla server-side porque la sesión fue revocada
      // → la FUNCIÓN devuelve 401 {error:{code:'unauthorized'}}. Observado empírico:
      // status 401, body {"error":{"code":"unauthorized","message":"Sesión inválida
      // o ausente."}}. Esto cierra la ventana residual del access token: no se puede
      // re-disparar la baja ni nada con ese token tras la 1ra llamada.
      //
      // (El branch defensivo `200 already_deleted` se cubre en aislamiento en el
      // test siguiente, sin depender del signOut.)
      const u = await createTestUser('del_idem');
      const uClient = await getUserClient(u.email);

      // Token vivo ANTES de la baja: tiene firma válida, pero la baja lo revocará.
      const token = await getAccessToken(uClient);

      const first = await uClient.functions.invoke('delete_account', { body: {} });
      assert.equal(first.error, null, first.error && first.error.message);
      assert.equal(first.data.ok, true);

      // 2da llamada con el MISMO access token (raw fetch para no depender del refresh).
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete_account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      assert.equal(
        res.status,
        401,
        'tras la baja el token está revocado → 401 (no se puede re-operar)',
      );
      const body = await res.json().catch(() => ({}));
      // La firma válida llega al código → es el 401 de la FUNCIÓN (no del gateway),
      // con su envelope {error:{code:'unauthorized'}}.
      assert.equal(body?.error?.code, 'unauthorized');
    },
  );

  await t.test(
    'Test 6b — already_deleted (branch idempotente): perfil ya soft-deleteado + sesión viva → 200',
    async () => {
      // Cubre el branch defensivo `200 already_deleted` EN AISLAMIENTO, sin depender
      // del signOut (que en el flujo normal revoca la sesión → ver Test 6). Ese branch
      // solo es alcanzable si `requireUser` tiene éxito sobre un usuario YA soft-
      // deleteado — algo que el flujo normal NO produce (la baja revoca la sesión).
      // Es defensivo: caso de falla parcial (si el signOut hubiera fallado, el usuario
      // conservaría sesión y podría reintentar → debe ser idempotente).
      //
      // Setup: soft-deleteamos la fila DIRECTO con el admin client (sin llamar el edge
      // ni banear) → la sesión sigue VIVA → el token llega al código y getUser() OK.
      const u = await createTestUser('del_already');
      const uClient = await getUserClient(u.email);

      const { error: sdErr } = await admin
        .from('users')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', u.id);
      assert.equal(sdErr, null, sdErr && sdErr.message);

      // Token vivo (sesión no revocada) → el edge entra al branch de idempotencia.
      const { data, error } = await uClient.functions.invoke('delete_account', {
        body: {},
      });
      assert.equal(error, null, error && error.message);
      assert.equal(data.ok, true);
      assert.equal(
        data.already_deleted,
        true,
        'debería marcar already_deleted (branch idempotente en aislamiento)',
      );
    },
  );

  await t.test('Test 7 — sin sesión → 401 (rechazo del gateway, verify_jwt ON)', async () => {
    // Raw fetch SIN Authorization Bearer (solo apikey anon). Con verify_jwt ON (default;
    // config.toml no overridea por-función), el PLATFORM (gateway) rechaza el no-Bearer
    // ANTES de llegar al código → 401 con el BODY DEL PLATFORM (p.ej.
    // {"code":"UNAUTHORIZED_NO_AUTH_HEADER",...}), NO el envelope
    // {error:{code:'unauthorized'}} de la función. La propiedad de seguridad que importa
    // es el 401 (sin sesión no se opera); el shape del body lo decide el gateway, no
    // nuestro código, así que NO asertamos sobre `error.code` (puede ser undefined).
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete_account`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(res.status, 401, 'sin sesión debería ser 401');
  });

  await t.test(
    'Test 8 — HIGH/IDOR: RPC delete_account_tx NO invocable por authenticated',
    async () => {
      // Usuario normal (authenticated) intenta llamar la RPC directo contra PostgREST,
      // targeteando a OTRO user. Debe ser rechazado por permiso (NO 200, NO escribe).
      const attacker = await createTestUser('del_attacker');
      const victim = await createTestUser('del_victim');
      const attackerClient = await getUserClient(attacker.email);
      const token = await getAccessToken(attackerClient);

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/delete_account_tx`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_user_id: victim.id }),
        },
      );
      // Permiso denegado: PostgREST devuelve 401/403 (o 404, porque OCULTA como
      // "not found" las funciones que el rol no puede ejecutar). NOTA: pre-deploy de
      // la migración 0058 esto también da 404 (la función aún no existe), así que el
      // 404 es ambiguo entre "no existe" y "existe pero revocada". Post-deploy sigue
      // siendo 404 (PostgREST oculta la función revocada) → el test pasa igual. La
      // garantía DURA que verificamos es invariante a esa ambigüedad: NUNCA 200 y la
      // víctima NUNCA se escribe (chequeo de deleted_at abajo). Si la 0058 estuviera
      // mal grantada (EXECUTE-able por authenticated), esto daría 200 y rompería.
      assert.ok(
        [401, 403, 404].includes(res.status),
        `esperaba 401/403/404, obtuve ${res.status}`,
      );
      assert.notEqual(res.status, 200, 'la RPC NO debe ser invocable por authenticated');

      // La víctima NO fue tocada.
      const { data: vrow } = await admin
        .from('users')
        .select('deleted_at')
        .eq('id', victim.id)
        .single();
      assert.equal(vrow.deleted_at, null, 'la víctima no debería haber sido borrada');
    },
  );
});

test('cleanup', async () => {
  await cleanup();
});
