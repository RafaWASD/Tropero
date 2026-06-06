// T2.5 — remove_member
// Owner remueve un miembro (set user_roles.active = false). Si target es el
// único owner activo del campo, falla.
// Cubre: R4.7, R7.4.
//
// Input: { user_id, establishment_id }
// Output: { ok: true }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';

type Body = {
  user_id?: unknown;
  establishment_id?: unknown;
};

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
    const targetUserId = typeof body.user_id === 'string' ? body.user_id : '';
    const establishmentId =
      typeof body.establishment_id === 'string' ? body.establishment_id : '';
    if (!targetUserId || !establishmentId) {
      return jsonError(
        400,
        'invalid_input',
        'user_id y establishment_id son obligatorios.',
      );
    }

    await requireOwnerOf(adminClient, user.id, establishmentId);

    // Buscar el role activo del target.
    const { data: targetRole, error: roleErr } = await adminClient
      .from('user_roles')
      .select('id, role')
      .eq('user_id', targetUserId)
      .eq('establishment_id', establishmentId)
      .eq('active', true)
      .maybeSingle();
    if (roleErr) {
      return serverError('db_error', roleErr);
    }
    if (!targetRole) {
      return jsonError(
        404,
        'not_found',
        'El usuario no tiene rol activo en este establecimiento.',
      );
    }

    // Si target es owner, verificar que no sea el único.
    if (targetRole.role === 'owner') {
      const { count, error: countErr } = await adminClient
        .from('user_roles')
        .select('id', { count: 'exact', head: true })
        .eq('establishment_id', establishmentId)
        .eq('role', 'owner')
        .eq('active', true);
      if (countErr) {
        return serverError('db_error', countErr);
      }
      if ((count ?? 0) <= 1) {
        return jsonError(
          409,
          'last_owner',
          'No se puede remover al único owner activo del establecimiento.',
        );
      }
    }

    const { error: updErr } = await adminClient
      .from('user_roles')
      .update({
        active: false,
        deactivated_at: new Date().toISOString(),
      })
      .eq('id', targetRole.id);
    if (updErr) {
      return serverError('db_error', updErr);
    }

    // H1-1 (R9.1/R9.3/R9.4/R9.5): tras el write de user_roles (barrera primaria), invalidar la
    // sesión activa del TARGET para no esperar al jwt_expiry (~1h) y blindar el caso offline
    // futuro (C4). Mecanismo: RPC SECURITY DEFINER `revoke_user_sessions(target_uid)` (migración
    // 0072) que borra `auth.sessions` del target → revoca sus refresh tokens de forma PERSISTENTE
    // (mismo efecto que signOut global, pero por user id; el ban finito anterior NO revocaba —
    // verificado empíricamente, ver review #1 + 0072). El target puede re-loguear (conserva rol en
    // OTROS campos). Fail-SOFT (R9.4): si falla, se loguea y NO se revierte el cambio de rol ya
    // consumado. NO se expone el error al cliente (R9.5).
    try {
      const { error: revokeErr } = await adminClient.rpc('revoke_user_sessions', {
        target_uid: targetUserId,
      });
      if (revokeErr) console.error('[remove_member revoke session]', revokeErr);
    } catch (e) {
      console.error('[remove_member revoke session threw]', e);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
