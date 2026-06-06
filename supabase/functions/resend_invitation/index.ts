// T2.4 — resend_invitation (modelo link shareable, ver ADR-014).
// Conceptualmente "regenerar link": genera un nuevo token y reinicia la
// expiración. El token viejo deja de funcionar (sirve como mecanismo de
// revocación cuando el owner comparte el link por error o sospecha que llegó
// a la persona equivocada). No dispara email; el owner reparte el nuevo link
// por el canal que prefiera.
// Conserva el nombre del archivo para no romper deploys históricos.
// Cubre: R5.8.
//
// Input:  { invitation_id }
// Output: { token, accept_url, expires_at }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';

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
      return serverError('db_error', lookupErr);
    }
    if (!inv) {
      return jsonError(404, 'not_found', 'Invitación no encontrada.');
    }

    await requireOwnerOf(adminClient, user.id, inv.establishment_id);

    if (inv.status !== 'pending') {
      return jsonError(
        409,
        'invalid_state',
        `Solo se pueden regenerar invitaciones pending (estado actual: ${inv.status}).`,
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
      return serverError('db_error', updErr);
    }

    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.rafq.ar';
    const acceptUrl = `${appUrl}/invite?token=${encodeURIComponent(newToken)}`;

    return jsonOk({
      token: newToken,
      accept_url: acceptUrl,
      expires_at: newExpires,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
