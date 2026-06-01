import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Result } from '../types';
import { supabase } from './supabase';

export type PushRegistrationFailure =
  | { kind: 'not_a_device' }
  | { kind: 'permission_denied' }
  | { kind: 'no_project_id' }
  | { kind: 'unexpected'; message: string };

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function getExpoPushTokenSafe(): Promise<Result<string, PushRegistrationFailure>> {
  // En web `Device.isDevice` puede dar true (es un dispositivo real) y caer más abajo en el catch
  // como `unexpected`, logueando ruido (`[push] registro best-effort no realizado: unexpected`). No
  // hay push token de Expo en web → guard temprano: best-effort no-op, mismo comportamiento (ok:false)
  // sin warning. (Mantenemos el chequeo de Device.isDevice abajo para simuladores native.)
  if (Platform.OS === 'web') {
    return { ok: false, error: { kind: 'not_a_device' } };
  }
  if (!Device.isDevice) {
    return { ok: false, error: { kind: 'not_a_device' } };
  }

  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') {
    return { ok: false, error: { kind: 'permission_denied' } };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId: String(projectId) } : undefined,
    );
    return { ok: true, value: tokenResponse.data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('project id')) {
      return { ok: false, error: { kind: 'no_project_id' } };
    }
    return { ok: false, error: { kind: 'unexpected', message } };
  }
}

// Registra el Expo push token del dispositivo en el backend (Edge Function
// register_push_token, T2.7 → infra de R5.11). Best-effort por diseño:
//   - WEB / simulador: getExpoPushTokenSafe devuelve `not_a_device` → no-op, ok:false.
//   - permiso denegado: no insistimos (R5.11/T3.6 "graceful, si rechaza no insistir").
//   - fallo de red/Edge: lo tragamos con warning (no rompemos el login por push).
// El JWT del usuario lo agrega supabase-js automáticamente en functions.invoke.
export async function registerPushTokenBestEffort(): Promise<
  Result<{ tokenId: string }, PushRegistrationFailure | { kind: 'register_failed'; message: string }>
> {
  const tokenResult = await getExpoPushTokenSafe();
  if (!tokenResult.ok) return tokenResult;

  try {
    const { data, error } = await supabase.functions.invoke('register_push_token', {
      body: {
        expo_push_token: tokenResult.value,
        device_id: Device.osInternalBuildId ?? Device.modelId ?? null,
        platform: Platform.OS,
      },
    });
    if (error || data?.error) {
      const message = error?.message ?? data?.error?.message ?? 'register_push_token failed';
      return { ok: false, error: { kind: 'register_failed', message } };
    }
    return { ok: true, value: { tokenId: String(data?.token_id ?? '') } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'register_failed', message } };
  }
}
