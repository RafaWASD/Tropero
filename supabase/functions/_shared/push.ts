// Envío de push notifications via Expo Push API.
// Si `EXPO_ACCESS_TOKEN` no está, también devolvemos no_key (no bloqueante).
// Cleanup de tokens fallidos (`DeviceNotRegistered`): borramos del DB para
// que el próximo envío no pierda tiempo.

import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type PushSendResult = {
  attempted: number;
  ok: number;
  cleaned: number;
};

export async function sendExpoPush(
  adminClient: SupabaseClient,
  recipientUserId: string,
  message: Omit<PushMessage, 'to'>,
): Promise<PushSendResult> {
  const result: PushSendResult = { attempted: 0, ok: 0, cleaned: 0 };

  // Obtener tokens activos del owner.
  const { data: tokens, error } = await adminClient
    .from('push_tokens')
    .select('id, token')
    .eq('user_id', recipientUserId);
  if (error) {
    console.error('push_tokens query error:', error.message);
    return result;
  }
  if (!tokens || tokens.length === 0) {
    return result;
  }

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (!accessToken) {
    console.warn('EXPO_ACCESS_TOKEN no configurada, push skipped');
    return result;
  }

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
  }));

  result.attempted = messages.length;

  let res: Response;
  try {
    res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error('Expo push fetch failed:', err);
    return result;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Expo push API ${res.status}: ${text}`);
    return result;
  }

  type ExpoTicket = {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
  };
  const body = (await res.json().catch(() => null)) as
    | { data?: ExpoTicket[] }
    | null;
  if (!body?.data) {
    return result;
  }

  const tokensToDelete: string[] = [];
  body.data.forEach((ticket, i) => {
    if (ticket.status === 'ok') {
      result.ok += 1;
      return;
    }
    const code = ticket.details?.error;
    if (
      code === 'DeviceNotRegistered' ||
      code === 'InvalidCredentials' ||
      code === 'MessageTooBig'
    ) {
      // Solo borramos DeviceNotRegistered (token revocado/desinstalado).
      if (code === 'DeviceNotRegistered') {
        tokensToDelete.push(tokens[i].id);
      }
    }
  });

  if (tokensToDelete.length > 0) {
    const { error: delErr } = await adminClient
      .from('push_tokens')
      .delete()
      .in('id', tokensToDelete);
    if (delErr) {
      console.error('push_tokens cleanup error:', delErr.message);
    } else {
      result.cleaned = tokensToDelete.length;
    }
  }

  return result;
}
