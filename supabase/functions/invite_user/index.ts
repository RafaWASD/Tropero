// T2.1 — invite_user (modelo link shareable, ver ADR-014).
// Owner crea una invitación a su establecimiento seleccionando solo el rol.
// El email es opcional como anotación (no se valida al aceptar).
// La función retorna un accept_url shareable que el owner reparte por el canal
// que prefiera (WhatsApp, mail, copy-paste). NO dispara email automático.
// Cubre: R5.1, R5.2, R5.9 (precheck soft cuando viene email).
//
// Input:  { establishment_id, role, email? }
// Output: { invitation_id, token, accept_url, expires_at }

import { serveEf } from '../_shared/serve.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';

type Body = {
  establishment_id?: unknown;
  email?: unknown;
  role?: unknown;
};

const ALLOWED_ROLES = new Set(['field_operator', 'veterinarian']);
// U9 (opción A): TTL acortado de 7 días a 72h para reducir la ventana de leak del link bearer.
// El owner regenera el link en un tap (resend_invitation) si necesita más tiempo.
const INVITATION_TTL_HOURS = 72;

serveEf('invite_user', async (req, ctx) => {
  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Solo POST.');
  }

  try {
    const userClient = createUserClient(req);
    const adminClient = createAdminClient(undefined, ctx.requestId);
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

    // Email opcional. Si viene, normalizamos a lowercase y validamos formato
    // mínimo. Si no viene, queda null y se saltan los prechecks soft.
    const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
    let email: string | null = null;
    if (emailRaw.length > 0) {
      if (!emailRaw.includes('@')) {
        return jsonError(400, 'invalid_input', 'email inválido.');
      }
      email = emailRaw.toLowerCase();
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

    // Prechecks soft de R5.9 / pending duplicada: solo aplican si vino email
    // como anotación. El bloqueo duro de R5.9 (modelo bearer) está en
    // accept_invitation: el destinatario real recién se conoce al aceptar.
    if (email) {
      // Precheck "ya es miembro activo" — re-ruteado a user_private (spec 14, R8.1/R8.3).
      // El email se separó de public.users a public.user_private (RLS self-only). Lo resolvemos
      // en 2 pasos vía admin-client (service-role, bypassa RLS): user_private por email →
      // user_roles por user_id. Más robusto que un doble embed PostgREST (no depende de cómo
      // resuelva el `!inner` anidado). Resultado funcional idéntico (mismo código already_member).
      const { data: privByEmail, error: privErr } = await adminClient
        .from('user_private')
        .select('user_id')
        .eq('email', email)
        .maybeSingle();
      if (privErr) {
        return serverError('db_error', privErr);
      }

      if (privByEmail) {
        const { data: existingMember, error: existingErr } = await adminClient
          .from('user_roles')
          .select('id')
          .eq('establishment_id', establishmentId)
          .eq('active', true)
          .eq('user_id', privByEmail.user_id)
          .limit(1);
        if (existingErr) {
          return serverError('db_error', existingErr);
        }
        if (existingMember && existingMember.length > 0) {
          return jsonError(
            409,
            'already_member',
            'Ese email ya es miembro activo del establecimiento.',
          );
        }
      }

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
        return serverError('db_error', pendingErr);
      }
      if (pending && pending.length > 0) {
        return jsonError(
          409,
          'pending_exists',
          'Ya hay una invitación pendiente para ese email.',
        );
      }
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + INVITATION_TTL_HOURS * 3600 * 1000,
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
      return serverError('db_error', insErr);
    }

    // El origen del link vive en CINCO puntas que tienen que coincidir (ver el comentario largo en
    // `app/src/services/members.ts` sobre `INVITE_BASE_URL`): esta, el default de
    // `resend_invitation`, el `INVITE_BASE_URL` del cliente, el HTML de la página publicada
    // (`docs/marketing/landing-proximamente/invite.html`, que arma el link que el invitado copia), y
    // el secret `APP_URL` de Supabase —que GANA sobre este default y no se puede verificar desde el
    // repo—. Las cuatro del repo las vigila la regla F de `app/src/utils/brand-name-guard.test.ts`.
    const appUrl = Deno.env.get('APP_URL') ?? 'https://mitropero.com.ar';
    const acceptUrl = `${appUrl}/invite?token=${encodeURIComponent(token)}`;

    return jsonOk({
      invitation_id: inserted.id,
      token,
      accept_url: acceptUrl,
      expires_at: expiresAt,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
