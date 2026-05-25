// T2.1 — invite_user
// Owner invita a un email con un rol (field_operator | veterinarian).
// Cubre: R5.1, R5.2, R5.9.
//
// Input: { establishment_id, email, role }
// Output: { invitation_id, token }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';
import { sendInvitationEmail } from '../_shared/email.ts';

type Body = {
  establishment_id?: unknown;
  email?: unknown;
  role?: unknown;
};

const ALLOWED_ROLES = new Set(['field_operator', 'veterinarian']);
const INVITATION_TTL_DAYS = 7;

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Solo POST.');
  }

  try {
    const userClient = createUserClient(req);
    const adminClient = createAdminClient();
    const user = await requireUser(userClient);

    const body = (await req.json().catch(() => ({}))) as Body;

    const establishmentId =
      typeof body.establishment_id === 'string' ? body.establishment_id : '';
    if (!establishmentId) {
      return jsonError(
        400,
        'invalid_input',
        'establishment_id es obligatorio.',
      );
    }

    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || !email.includes('@')) {
      return jsonError(400, 'invalid_input', 'email inválido.');
    }

    const role = typeof body.role === 'string' ? body.role : '';
    if (!ALLOWED_ROLES.has(role)) {
      return jsonError(
        400,
        'invalid_input',
        'role debe ser field_operator o veterinarian.',
      );
    }

    // Verifica que el caller es owner activo.
    await requireOwnerOf(adminClient, user.id, establishmentId);

    // R5.9 — bloquear si el email ya tiene un user_roles activo en el campo.
    const { data: existingMember, error: existingErr } = await adminClient
      .from('user_roles')
      .select('id, users:users!inner(email)')
      .eq('establishment_id', establishmentId)
      .eq('active', true)
      .eq('users.email', email)
      .limit(1);
    if (existingErr) {
      return jsonError(500, 'db_error', existingErr.message);
    }
    if (existingMember && existingMember.length > 0) {
      return jsonError(
        409,
        'already_member',
        'Ese email ya es miembro activo del establecimiento.',
      );
    }

    // Bloquear si hay una invitación pending no expirada para ese email/establishment.
    const nowIso = new Date().toISOString();
    const { data: pending, error: pendingErr } = await adminClient
      .from('invitations')
      .select('id')
      .eq('establishment_id', establishmentId)
      .eq('email', email)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .limit(1);
    if (pendingErr) {
      return jsonError(500, 'db_error', pendingErr.message);
    }
    if (pending && pending.length > 0) {
      return jsonError(
        409,
        'pending_exists',
        'Ya hay una invitación pendiente para ese email.',
      );
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000,
    ).toISOString();

    const { data: inserted, error: insErr } = await adminClient
      .from('invitations')
      .insert({
        establishment_id: establishmentId,
        invited_by: user.id,
        email,
        role,
        token,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id')
      .single();
    if (insErr) {
      return jsonError(500, 'db_error', insErr.message);
    }

    // Email best-effort. Si falla, dejamos la invitación creada igual (el owner
    // puede usar resend_invitation o copy link).
    let emailStatus = 'sent';
    try {
      const { data: estData } = await adminClient
        .from('establishments')
        .select('name')
        .eq('id', establishmentId)
        .single();
      const { data: inviterData } = await adminClient
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single();

      const sendResult = await sendInvitationEmail({
        to: email,
        establishmentName: estData?.name ?? 'tu establecimiento',
        inviterName: inviterData?.name ?? 'Un usuario',
        role: role as 'field_operator' | 'veterinarian',
        token,
      });
      if (!sendResult.ok) {
        emailStatus = sendResult.reason;
      }
    } catch (err) {
      console.error('invite_user email send failed:', err);
      emailStatus = 'error';
    }

    return jsonOk({
      invitation_id: inserted.id,
      token,
      email_status: emailStatus,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error('invite_user unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
