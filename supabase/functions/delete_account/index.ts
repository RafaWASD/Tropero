// T6.3 — delete_account
// El usuario elimina SU PROPIA cuenta. Soft-delete del perfil + desactivación de
// TODOS sus user_roles (en una RPC atómica) + revocación de auth (global signOut +
// ban) para impedir re-login. Identidad SOLO del JWT (no se lee user_id del body) →
// imposible pedir la baja de otra cuenta (cierre de IDOR, D5).
// Cubre: R2.4 (soft-delete + desactivar roles), R2.5 (único owner bloquea),
// R2.5.1 (devuelve la lista de campos bloqueantes para que el front ofrezca atajo).
//
// Input:  {} — POST sin body relevante (cualquier campo se ignora).
// Output:
//   200 { ok: true }                              — baja consumada.
//   200 { ok: true, already_deleted: true }       — idempotente (ya estaba dada de baja).
//   409 { error: { code: 'sole_owner', message, establishments: [{id,name}] } } — R2.5.
//   401 { error: { code: 'unauthorized', ... } }  — sin sesión.
//   405 { error: { code: 'method_not_allowed', ... } } — método != POST.
//   500 { error: { code: 'db_error' | 'unexpected', ... } }
//
// NOTA DE IMPLEMENTACIÓN (deviación-de-literal vs design, flag para Gate 2):
// El design (paso 5) escribe `adminClient.auth.admin.signOut(user.id, 'global')`, pero
// la Auth Admin API `signOut(jwt, scope)` espera el ACCESS TOKEN del usuario (lo POSTea
// a /logout?scope=global), NO un UUID. Pasar `user.id` no apuntaría a las sesiones del
// usuario (no-op/errror). Para CUMPLIR la INTENCIÓN documentada ("revocar todos los
// refresh tokens del usuario server-side") usamos el Bearer access token del request.
// El ban (`updateUserById(user.id, {ban_duration})`) SÍ toma user.id y es la barrera
// real de re-login. Ambos son hardening del cascarón (HIGH-1.c): si fallan, se loguea
// y se devuelve 200 igual (la baja de datos ya se consumó atómicamente en el paso 4 y
// RLS ya niega todo acceso con los roles inactivos).

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireUser } from '../_shared/auth.ts';

const SOLE_OWNER_COPY =
  'No podés eliminar tu cuenta porque sos el único owner de uno o más establecimientos. ' +
  'Transferí o eliminá esos establecimientos primero.';

// 100 años: no es hard-delete (preserva la fila para retención SENASA), solo impide
// re-login. Mismo valor que documenta el design / la Auth Admin API.
const BAN_DURATION = '876000h';

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonError(405, 'method_not_allowed', 'Solo POST.');
  }

  try {
    const userClient = createUserClient(req);
    const adminClient = createAdminClient();

    // Paso 1: identidad SOLO del JWT (sin user_id en el body → sin IDOR, D5).
    const user = await requireUser(userClient);

    // Paso 2: idempotencia. Si ya está soft-deleteado → 200 already_deleted, sin tocar nada.
    const { data: userRow, error: userErr } = await adminClient
      .from('users')
      .select('deleted_at')
      .eq('id', user.id)
      .maybeSingle();
    if (userErr) {
      // Fail-closed: si no podemos leer el estado, NO escribimos.
      return serverError('db_error', userErr);
    }
    if (userRow?.deleted_at) {
      return jsonOk({ ok: true, already_deleted: true });
    }

    // Paso 3: pre-check de campos bloqueantes (R2.5 + R2.5.1). Dos queries simples
    // (más robusto que un filtro sobre recurso embebido): (a) traer los owner-roles
    // activos del usuario; (b) de esos establecimientos, quedarnos solo con los ACTIVOS
    // (deleted_at IS NULL → un campo ya borrado NO bloquea, D4); (c) por cada uno,
    // contar owners activos → si <= 1 (solo este usuario) es bloqueante.
    // FAIL-CLOSED (HIGH-2): cualquier error de query de este paso → 500 sin escribir.
    const { data: ownerRoles, error: rolesErr } = await adminClient
      .from('user_roles')
      .select('establishment_id')
      .eq('user_id', user.id)
      .eq('role', 'owner')
      .eq('active', true);
    if (rolesErr) {
      return serverError('db_error', rolesErr);
    }

    const blocking: { id: string; name: string }[] = [];
    const ownedIds = (ownerRoles ?? []).map(
      (r) => (r as { establishment_id: string }).establishment_id,
    );

    if (ownedIds.length > 0) {
      // (b) Solo establecimientos ACTIVOS (D4: un campo ya soft-deleteado no bloquea).
      const { data: activeEsts, error: estErr } = await adminClient
        .from('establishments')
        .select('id, name')
        .in('id', ownedIds)
        .is('deleted_at', null);
      if (estErr) {
        return serverError('db_error', estErr);
      }

      for (const est of activeEsts ?? []) {
        const establishment = est as { id: string; name: string };
        // (c) contar owners activos de ESTE establecimiento.
        const { count, error: countErr } = await adminClient
          .from('user_roles')
          .select('id', { count: 'exact', head: true })
          .eq('establishment_id', establishment.id)
          .eq('role', 'owner')
          .eq('active', true);
        if (countErr) {
          // Fail-closed: ante incertidumbre del conteo, NO permitimos la baja.
          return serverError('db_error', countErr);
        }
        // El conteo INCLUYE al usuario actual (su rol aún activo) → umbral <= 1 = "solo yo".
        if ((count ?? 0) <= 1) {
          blocking.push({ id: establishment.id, name: establishment.name });
        }
      }
    }

    if (blocking.length > 0) {
      // No se escribe nada.
      return jsonError(409, 'sole_owner', SOLE_OWNER_COPY, {
        establishments: blocking,
      });
    }

    // Paso 4: baja atómica vía RPC SECURITY DEFINER (los dos writes en una transacción;
    // re-valida el bloqueo de único-owner adentro → red TOCTOU, raise 23514).
    const { error: rpcErr } = await adminClient.rpc('delete_account_tx', {
      p_user_id: user.id,
    });
    if (rpcErr) {
      // El raise de la RPC (sole_owner por race) usa errcode 23514 → check_violation.
      // PostgrestError expone ese errcode en `.code`.
      if ((rpcErr as { code?: string }).code === '23514') {
        return jsonError(409, 'sole_owner', SOLE_OWNER_COPY, {
          // La lista detallada ya la dio el pre-check; el race es rarísimo en MVP.
          establishments: [],
        });
      }
      // Cualquier otro error de la RPC → 500. Como es atómica, la DB queda intacta.
      return serverError('db_error', rpcErr);
    }

    // Paso 5: revocación de auth (hardening del cascarón). Si falla, se loguea y se
    // devuelve 200 igual — la baja de datos ya se consumó y RLS ya niega todo acceso.
    // Ver NOTA DE IMPLEMENTACIÓN al tope sobre por qué signOut usa el access token.
    const authHeader = req.headers.get('Authorization') ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      if (accessToken) {
        const { error: signOutErr } = await adminClient.auth.admin.signOut(
          accessToken,
          'global',
        );
        if (signOutErr) {
          console.error('delete_account signOut error:', signOutErr.message);
        }
      } else {
        console.error('delete_account: no access token to global-signOut');
      }
    } catch (e) {
      console.error('delete_account signOut threw:', (e as Error).message);
    }

    try {
      const { error: banErr } = await adminClient.auth.admin.updateUserById(
        user.id,
        { ban_duration: BAN_DURATION },
      );
      if (banErr) {
        console.error('delete_account ban error:', banErr.message);
      }
    } catch (e) {
      console.error('delete_account ban threw:', (e as Error).message);
    }

    // Paso 6.
    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
