// Persistencia del estado de lockout de login por email (spec 01, R1.7 / T3.5).
//
// El lockout es UX-only (la defensa real es el rate-limit de Supabase Auth). Lo
// persistimos para que sobreviva un reload de la app (el atacante casual no esquiva
// el bloqueo solo refrescando). Web: localStorage; native: expo-secure-store.
//
// La key incluye el email normalizado para que el bloqueo sea por-email (R1.7).

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { EMPTY_LOCKOUT, type LockoutState } from '../utils/lockout';

// expo-secure-store solo admite keys con [A-Za-z0-9._-]. El email lleva @ y puede
// llevar +, así que lo codificamos a un hash hex simple (no necesita ser cripto:
// solo derivar una key estable y válida desde el email).
function emailKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `rafq.lockout.${(hash >>> 0).toString(16)}`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return hasLocalStorage() ? window.localStorage.getItem(key) : null;
  }
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (hasLocalStorage()) window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function loadLockout(email: string): Promise<LockoutState> {
  try {
    const raw = await readRaw(emailKey(email));
    if (!raw) return EMPTY_LOCKOUT;
    const parsed = JSON.parse(raw) as Partial<LockoutState>;
    return {
      failures: Array.isArray(parsed.failures) ? parsed.failures.filter((n) => typeof n === 'number') : [],
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : null,
    };
  } catch {
    return EMPTY_LOCKOUT;
  }
}

export async function saveLockout(email: string, state: LockoutState): Promise<void> {
  try {
    await writeRaw(emailKey(email), JSON.stringify(state));
  } catch {
    // Persistir el lockout es best-effort: si falla, el contador en memoria sigue
    // funcionando dentro de la sesión actual.
  }
}
