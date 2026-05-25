// T2.4 — resend_invitation
// Owner reenvía una invitación pending: genera nuevo token, reinicia expires_at,
// dispara email de nuevo. El token viejo deja de funcionar por unique constraint.
// Cubre: R5.8.
//
// Input: { invitation_id }
// Output: { token, expires_at }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';
import { sendInvitationEmail } from '../_shared/email.ts';

type Body = { invitation_id?: unknown };
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
    const invitationId =
      typeof body.invitation_id === 'string' ? body.invitation_id : '';
    if (!invitationId) {
      return jsonError(400, 'invalid_input', 'invitation_id es obligatorio.');
    }

    const { data: inv, error: lookupErr } = await adminClient
      .from('invitations')
      .select('id, establishment_id, email, role, status')
      .eq('id', invitationId)
      .maybeSingle();
    if (lookupErr) {
      return jsonError(500, 'db_error', lookupErr.message);
    }
    if (!inv) {
      return jsonError(404, 'not_found', 'Invitación no encontrada.');
    }

    await requireOwnerOf(adminClient, user.id, inv.establishment_id);

    if (inv.status !== 'pending') {
      return jsonError(
        409,
        'invalid_state',
        `Solo se pueden reenviar invitaciones pending (estado actual: ${inv.status}).`,
      );
    }

    const newToken = crypto.randomUUID();
    const newExpires = new Date(
      Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000,
    ).toISOString();

    const { error: updErr } = await adminClient
      .from('invitations')
      .update({
        token: newToken,
        expires_at: newExpires,
      })
      .eq('id', invitationId);
    if (updErr) {
      return jsonError(500, 'db_error', updErr.message);
    }

    // Resend email best-effort.
    let emailStatus = 'sent';
    try {
      const { data: estData } = await adminClient
        .from('establishments')
        .select('name')
        .eq('id', inv.establishment_id)
        .single();
      const { data: inviterData } = await adminClient
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single();

      const sendResult = await sendInvitationEmail({
        to: inv.email,
        establishmentName: estData?.name ?? 'tu establecimiento',
        inviterName: inviterData?.name ?? 'Un usuario',
        role: inv.role as 'field_operator' | 'veterinarian',
        token: newToken,
      });
      if (!sendResult.ok) {
        emailStatus = sendResult.reason;
      }
    } catch (err) {
      console.error('resend_invitation email send failed:', err);
      emailStatus = 'error';
    }

    return jsonOk({
      token: newToken,
      expires_at: newExpires,
      email_status: emailStatus,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error('resend_invitation unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
