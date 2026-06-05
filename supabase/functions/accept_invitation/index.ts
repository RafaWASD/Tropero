// T2.2 — accept_invitation (modelo bearer, ver ADR-014).
// El destinatario logueado acepta una invitación válida usando el token.
// El token es bearer: NO se valida email-matching con el JWT (cualquier user
// logueado con el link puede aceptar). Crea user_roles, marca invitations
// como accepted y dispara notificaciones al owner (email + push) con manejo
// aislado de errores.
// Cubre: R5.5, R5.6, R5.9, R5.10, R5.11.
//
// Input:  { token }
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

    // Lookup via admin (bypassea RLS, el caller no necesita pertenecer al
    // establishment para ver la invitación antes de aceptarla).
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

    // R5.9 — bloqueo duro: si el caller ya tiene un user_roles activo en el
    // establishment, no se acepta (sería un segundo rol activo). El modelo
    // bearer no puede prevenir esto en invite_user, así que el check vive acá.
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
    if (existing) {
      return jsonError(
        409,
        'already_member',
        'Ya sos miembro de este establecimiento.',
      );
    }

    // R5.5 — insert del user_roles nuevo.
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
      // El owner: name sigue en public.users; email se separó a public.user_private (spec 14,
      // R8.2/R8.3). Dos lecturas admin-client (service-role bypassa RLS): name por id, email por
      // user_id. El email del que ACEPTA (user.email) sale del JWT (_shared/auth.ts), no de la DB.
      const { data: ownerData } = await adminClient
        .from('users')
        .select('id, name')
        .eq('id', inv.invited_by)
        .single();
      const { data: ownerPrivate } = await adminClient
        .from('user_private')
        .select('email')
        .eq('user_id', inv.invited_by)
        .maybeSingle();
      const ownerEmail = ownerPrivate?.email ?? null;
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

      if (ownerEmail) {
        try {
          const sendResult = await sendInvitationAcceptedEmail({
            to: ownerEmail,
            ownerName: ownerData?.name ?? 'Hola',
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
