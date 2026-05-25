// T2.5 — remove_member
// Owner remueve un miembro (set user_roles.active = false). Si target es el
// único owner activo del campo, falla.
// Cubre: R4.7, R7.4.
//
// Input: { user_id, establishment_id }
// Output: { ok: true }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
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
      return jsonError(500, 'db_error', roleErr.message);
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
        return jsonError(500, 'db_error', countErr.message);
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
      return jsonError(500, 'db_error', updErr.message);
    }

    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error('remove_member unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
