// T2.3 — cancel_invitation
// Owner cancela una invitación pending.
// Cubre: R5.7.
//
// Input: { invitation_id }
// Output: { ok: true }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';

type Body = { invitation_id?: unknown };

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
      .select('id, establishment_id, status')
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
        `Solo se pueden cancelar invitaciones pending (estado actual: ${inv.status}).`,
      );
    }

    const { error: updErr } = await adminClient
      .from('invitations')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', invitationId);
    if (updErr) {
      return jsonError(500, 'db_error', updErr.message);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error('cancel_invitation unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
