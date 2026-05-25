// T2.6 — change_member_role
// Owner cambia el rol de un miembro. Implementación: split desactivar viejo +
// insertar nuevo activo (preserva historial, respeta unique index parcial).
// Si target es el único owner y new_role != 'owner', bloquea (R4.6).
// Cubre: R4.5, R4.6.
//
// Input: { user_id, establishment_id, new_role }
// Output: { ok: true, role_id }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireOwnerOf, requireUser } from '../_shared/auth.ts';

type Body = {
  user_id?: unknown;
  establishment_id?: unknown;
  new_role?: unknown;
};

const ALLOWED_ROLES = new Set(['owner', 'field_operator', 'veterinarian']);

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
    const newRole = typeof body.new_role === 'string' ? body.new_role : '';

    if (!targetUserId || !establishmentId) {
      return jsonError(
        400,
        'invalid_input',
        'user_id y establishment_id son obligatorios.',
      );
    }
    if (!ALLOWED_ROLES.has(newRole)) {
      return jsonError(400, 'invalid_input', 'new_role inválido.');
    }

    await requireOwnerOf(adminClient, user.id, establishmentId);

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

    if (targetRole.role === newRole) {
      return jsonError(409, 'no_change', 'El usuario ya tiene ese rol.');
    }

    // R4.6: si degradamos a un owner, hay que confirmar que no es el único.
    if (targetRole.role === 'owner' && newRole !== 'owner') {
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
          'No se puede degradar al único owner activo del establecimiento.',
        );
      }
    }

    // Split: desactivar el viejo, insertar el nuevo activo.
    const nowIso = new Date().toISOString();
    const { error: updErr } = await adminClient
      .from('user_roles')
      .update({ active: false, deactivated_at: nowIso })
      .eq('id', targetRole.id);
    if (updErr) {
      return jsonError(500, 'db_error', updErr.message);
    }

    const { data: inserted, error: insErr } = await adminClient
      .from('user_roles')
      .insert({
        user_id: targetUserId,
        establishment_id: establishmentId,
        role: newRole,
        active: true,
      })
      .select('id')
      .single();
    if (insErr) {
      // Rollback manual: re-activar el viejo para no dejar al user sin rol.
      await adminClient
        .from('user_roles')
        .update({ active: true, deactivated_at: null })
        .eq('id', targetRole.id);
      return jsonError(500, 'db_error', insErr.message);
    }

    return jsonOk({ ok: true, role_id: inserted.id });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    console.error('change_member_role unexpected:', err);
    return jsonError(500, 'unexpected', (err as Error).message);
  }
});
