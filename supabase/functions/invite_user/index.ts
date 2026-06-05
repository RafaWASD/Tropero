// T2.1 — invite_user (modelo link shareable, ver ADR-014).
// Owner crea una invitación a su establecimiento seleccionando solo el rol.
// El email es opcional como anotación (no se valida al aceptar).
// La función retorna un accept_url shareable que el owner reparte por el canal
// que prefiera (WhatsApp, mail, copy-paste). NO dispara email automático.
// Cubre: R5.1, R5.2, R5.9 (precheck soft cuando viene email).
//
// Input:  { establishment_id, role, email? }
// Output: { invitation_id, token, accept_url, expires_at }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';

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
        return jsonError(500, 'db_error', privErr.message);
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
          return jsonError(500, 'db_error', existingErr.message);
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
        return jsonError(500, 'db_error', pendingErr.message);
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

    const appUrl = Deno.env.get('APP_URL') ?? 'https://app.rafq.ar';
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
    console.error('invite_user unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
