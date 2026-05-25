import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Result } from '../types';

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
