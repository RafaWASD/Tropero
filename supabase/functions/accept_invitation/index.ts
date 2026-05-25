// T2.2 — accept_invitation
// El destinatario logueado acepta una invitación válida. Crea user_roles,
// marca invitations.accepted y dispara notificaciones al owner (email + push)
// con manejo aislado de errores.
// Cubre: R5.5, R5.6, R5.10, R5.11.
//
// Input: { token }
// Output: { establishment_id, role }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireUser } from '../_shared/auth.ts';
import { sendInvitationAcceptedEmail } from '../_shared/email.ts';
import { sendExpoPush } from '../_shared/push.ts';

type Body = { token?: unknown };

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
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) {
      return jsonError(400, 'invalid_input', 'token es obligatorio.');
    }

    // Lookup via admin (bypassea RLS, así el caller no necesita match perfecto
    // de email para ver la invitación antes de aceptar).
    const { data: inv, error: lookupErr } = await adminClient
      .from('invitations')
      .select('id, establishment_id, email, role, status, expires_at, invited_by')
      .eq('token', token)
      .maybeSingle();
    if (lookupErr) {
      return jsonError(500, 'db_error', lookupErr.message);
    }
    if (!inv) {
      return jsonError(404, 'not_found', 'Invitación no encontrada.');
    }

    if (inv.status !== 'pending') {
      return jsonError(
        409,
        'invalid_state',
        `La invitación ya está ${inv.status}.`,
      );
    }

    // R5.6 — expiración.
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      // Best-effort mark as expired (no falla el flujo si esto no anda).
      await adminClient
        .from('invitations')
        .update({ status: 'expired' })
        .eq('id', inv.id);
      return jsonError(410, 'expired', 'La invitación expiró.');
    }

    // El email del JWT debe matchear el de la invitación (lowercase).
    if (user.email !== inv.email.toLowerCase()) {
      return jsonError(
        403,
        'email_mismatch',
        'La invitación es para otro email.',
      );
    }

    // R5.5 — insert del user_roles. Si ya existe uno activo (race), no falla:
    // unique index lo bloquearía pero lo manejamos con un select previo.
    const { data: existing, error: existingErr } = await adminClient
      .from('user_roles')
      .select('id')
      .eq('user_id', user.id)
      .eq('establishment_id', inv.establishment_id)
      .eq('active', true)
      .maybeSingle();
    if (existingErr) {
      return jsonError(500, 'db_error', existingErr.message);
    }

    if (!existing) {
      const { error: insErr } = await adminClient
        .from('user_roles')
        .insert({
          user_id: user.id,
          establishment_id: inv.establishment_id,
          role: inv.role,
          active: true,
        });
      if (insErr) {
        return jsonError(500, 'db_error', insErr.message);
      }
    }

    // Marcar invitation accepted.
    const { error: updErr } = await adminClient
      .from('invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      })
      .eq('id', inv.id);
    if (updErr) {
      return jsonError(500, 'db_error', updErr.message);
    }

    // R5.10 / R5.11 — notificaciones al owner. Cada una con try/catch aislado:
    // un fallo de email no debe romper push y viceversa; ambos son best-effort.
    try {
      const { data: ownerData } = await adminClient
        .from('users')
        .select('id, name, email')
        .eq('id', inv.invited_by)
        .single();
      const { data: estData } = await adminClient
        .from('establishments')
        .select('name')
        .eq('id', inv.establishment_id)
        .single();
      const { data: newMember } = await adminClient
        .from('users')
        .select('name')
        .eq('id', user.id)
        .single();

      if (ownerData?.email) {
        try {
          const sendResult = await sendInvitationAcceptedEmail({
            to: ownerData.email,
            ownerName: ownerData.name ?? 'Hola',
            establishmentName: estData?.name ?? 'tu establecimiento',
            newMemberName: newMember?.name ?? user.email,
            newMemberEmail: user.email,
            role: inv.role as 'field_operator' | 'veterinarian',
          });
          if (!sendResult.ok) {
            console.warn(
              `accept_invitation R5.10 email skipped: ${sendResult.reason}`,
            );
          }
        } catch (emailErr) {
          console.error('accept_invitation email error:', emailErr);
        }
      }

      try {
        await sendExpoPush(adminClient, inv.invited_by, {
          title: 'Nueva incorporación a tu establecimiento',
          body: `${newMember?.name ?? user.email} aceptó tu invitación a ${estData?.name ?? 'tu campo'}.`,
          data: {
            type: 'invitation_accepted',
            establishment_id: inv.establishment_id,
            invitation_id: inv.id,
          },
        });
      } catch (pushErr) {
        console.error('accept_invitation push error:', pushErr);
      }
    } catch (notifyErr) {
      console.error('accept_invitation notification lookup error:', notifyErr);
    }

    return jsonOk({
      establishment_id: inv.establishment_id,
      role: inv.role,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error('accept_invitation unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
