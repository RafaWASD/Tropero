// T2.7 — register_push_token
// Upsert de un Expo push token para el user autenticado.
// Cubre infra de R5.11 (Expo Push Notifications).
//
// Input: { expo_push_token, device_id?, platform? ('ios'|'android'|'web') }
// Output: { token_id }

import { handleOptions } from '../_shared/cors.ts';
import { jsonError, jsonOk, serverError } from '../_shared/errors.ts';
import { createAdminClient, createUserClient } from '../_shared/supabase.ts';
import { HttpError, requireUser } from '../_shared/auth.ts';

type Body = {
  expo_push_token?: unknown;
  device_id?: unknown;
  platform?: unknown;
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

    const token = typeof body.expo_push_token === 'string'
      ? body.expo_push_token.trim()
      : '';
    if (!token) {
      return jsonError(
        400,
        'invalid_input',
        'expo_push_token es obligatorio.',
      );
    }

    const platformRaw =
      typeof body.platform === 'string' ? body.platform.toLowerCase() : null;
    const platform =
      platformRaw === 'ios' || platformRaw === 'android' || platformRaw === 'web'
        ? platformRaw
        : null;

    const deviceId =
      typeof body.device_id === 'string' && body.device_id.trim()
        ? body.device_id.trim()
        : null;

    // Upsert por (user_id, token). Usamos admin client porque el user client
    // también funciona con su policy push_tokens_insert_self/update_self, pero
    // necesitamos el id de vuelta y el RLS-on-RETURNING podría complicarlo.
    const { data, error } = await adminClient
      .from('push_tokens')
      .upsert(
        {
          user_id: user.id,
          token,
          device_id: deviceId,
          platform,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'user_id,token' },
      )
      .select('id')
      .single();

    if (error) {
      return serverError('db_error', error);
    }

    return jsonOk({ token_id: data.id });
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonError(err.status, err.code, err.message);
    }
    return serverError('unexpected', err);
  }
});
