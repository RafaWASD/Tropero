// supabase/tests/edge/run.cjs
// Suite de tests para Edge Functions de Fase 2 (spec 01-identity-multitenancy).
// Corre contra el proyecto remoto con JWTs reales de users de prueba.
// Cubre: T2.1, T2.2, T2.3, T2.4, T2.5, T2.6, T2.7.
//
// Trazabilidad R<n> documentada en progress/impl_01-identity-multitenancy.md.

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

test('cleanup', async () => {
  await cleanup();
});
