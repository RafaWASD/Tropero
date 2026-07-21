// T2.2 — accept_invitation (modelo bearer con binding OPCIONAL, ver ADR-014 + delta U9).
// El destinatario logueado acepta una invitación válida usando el token.
// Binding U9 (opción A): si la invitación tiene email anotado (no-null), se exige que el email
// del JWT coincida (403 email_mismatch si no) Y esté verificado (403 email_unverified si no —
// enforcement server-side de HIGH-1, no depende de enable_confirmations); si NO tiene email, sigue
// siendo bearer puro (cualquier user logueado con el link puede aceptar — flujo WhatsApp-first intacto).
// Single-use atómico (U9 MEDIUM-1): la invitación se reclama con un UPDATE condicional a
// status='pending' ANTES de insertar el rol, así dos aceptaciones concurrentes no entran ambas.
// Crea user_roles y dispara notificaciones al owner (email + push) con manejo aislado de errores.
// Cubre: R5.5, R5.6, R5.9, R5.10, R5.11.
//
// Input:  { token }
// Output: { establishment_id, role }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
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
    const user = await requireUser(userClient);
    // spec 18 (Opción A): admin client con el ACTOR real = user.id del JWT validado (el que ACEPTA y se
    // auto-agrega el user_roles), NUNCA del body. El header X-Rafaq-Actor viaja en el INSERT de user_roles.
    const adminClient = createAdminClient(user.id);

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
      return serverError('db_error', lookupErr);
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

    // U9 (opción A, ADR-014 revisado) — binding OPCIONAL al email.
    // Si la invitación se anotó con un email (no-null), el que acepta DEBE ser ese email
    // → 403 email_mismatch. Da al owner un control opt-in ("esta invitación es solo para
    // facundo@x.com") sin romper el flujo WhatsApp-first: si la invitación no tiene email
    // (link puro), sigue siendo bearer (cualquier user logueado con el link puede aceptar).
    // Comparación case-insensitive: user.email ya viene lowercased de requireUser; inv.email
    // está garantizado lowercase por el CHECK invitations_email_lower, pero lo normalizamos
    // igual (defensa en profundidad, costo cero). NO consume la invitación (no la marca usada):
    // el usuario correcto puede aceptar el mismo link después.
    if (inv.email) {
      const invEmail = inv.email.trim().toLowerCase();
      if (invEmail !== user.email) {
        return jsonError(
          403,
          'email_mismatch',
          'Esta invitación es para otra dirección de email. Iniciá sesión con la cuenta invitada o pedile al dueño del establecimiento que te genere una nueva.',
        );
      }
      // U9 HIGH-1 (Gate 2): el binding confía en el claim `email` del JWT como prueba de identidad,
      // y eso SOLO es válido si el email está verificado. Enforcement SERVER-SIDE (no depende de
      // enable_confirmations del proyecto — que en local está en false): sin este check, un atacante
      // que conoce el email bindeado podría registrarse con ese email (sesión no-verificada, R1.3
      // permite login pre-verificación) y aceptar. Exigimos emailVerified. NO consume la invitación:
      // el usuario correcto verifica su email y reintenta con el mismo link (integra con R5.13).
      if (!user.emailVerified) {
        return jsonError(
          403,
          'email_unverified',
          'Verificá tu email antes de aceptar esta invitación. Te enviamos un link de verificación al registrarte.',
        );
      }
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
      return serverError('db_error', existingErr);
    }
    if (existing) {
      return jsonError(
        409,
        'already_member',
        'Ya sos miembro de este establecimiento.',
      );
    }

    // U9 MEDIUM-1 (TOCTOU / single-use atómico) — reclamo atómico ANTES del insert.
    // El UPDATE condicional `... WHERE id=? AND status='pending'` es la sección crítica:
    // Postgres toma un row-lock sobre la fila, así que bajo dos aceptaciones concurrentes del
    // mismo token SOLO UNA afecta 1 fila (gana) y las demás afectan 0 (pierden). Esto es atómico
    // a nivel statement y pooler-safe (una sola sentencia, no un check-then-act en dos viajes).
    // Invierte el orden anterior (antes: insert user_roles → marcar accepted, sin lock → dos users
    // distintos entraban ambos). Ahora el claim es el gate de un-solo-uso; el ganador inserta el rol.
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimErr } = await adminClient
      .from('invitations')
      .update({ status: 'accepted', accepted_at: claimedAt })
      .eq('id', inv.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (claimErr) {
      return serverError('db_error', claimErr);
    }
    if (!claimed) {
      // Perdimos la carrera (otro proceso ya la marcó accepted) o la fila cambió de estado
      // entre el lookup y el claim. Mismo error que reaceptar una ya usada.
      return jsonError(
        409,
        'invalid_state',
        'La invitación ya fue usada o expiró.',
      );
    }

    // R5.5 — insert del user_roles nuevo (solo el ganador del claim llega acá).
    const { error: insErr } = await adminClient
      .from('user_roles')
      .insert({
        user_id: user.id,
        establishment_id: inv.establishment_id,
        role: inv.role,
        active: true,
      });
    if (insErr) {
      // Sin transacción explícita: si el rol no se pudo crear, revertimos el claim a pending
      // (compensación best-effort) para no dejar la invitación consumida sin rol asignado. Así el
      // usuario correcto puede reintentar. Un insert fallido acá es raro (already_member ya se
      // chequeó arriba; el unique de user_roles solo saltaría por una carrera con OTRA invitación).
      await adminClient
        .from('invitations')
        .update({ status: 'pending', accepted_at: null })
        .eq('id', inv.id);
      return serverError('db_error', insErr);
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
    return serverError('unexpected', err);
  }
});
