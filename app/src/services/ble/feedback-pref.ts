// Preferencia de usuario para el beep de lectura del bastón (R4.3): apagable, persistida
// localmente entre sesiones. La VIBRACIÓN (R4.1) NO es apagable y no tiene preferencia; solo
// el beep se configura.
//
// Patrón de storage canónico del proyecto (igual que last-rodeo / establishment-store):
// web → localStorage; native → expo-secure-store. NO @react-native-async-storage. La lógica
// PURA (parseo del flag, default ON) vive en feedback-logic.ts (sin RN) y la testea
// node:test; este módulo solo hace la I/O de plataforma.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { parseBeepPref, serializeBeepPref, BEEP_DEFAULT_ENABLED } from './feedback-logic';

export { BEEP_DEFAULT_ENABLED, parseBeepPref } from './feedback-logic';

const STORAGE_KEY = 'rafq.ble.beep_enabled';

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return hasLocalStorage() ? window.localStorage.getItem(STORAGE_KEY) : null;
  }
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (hasLocalStorage()) window.localStorage.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

/** Lee la preferencia de beep persistida. Default ON si no hay valor / falla la lectura (R4.3). */
export async function readBeepEnabled(): Promise<boolean> {
  try {
    return parseBeepPref(await readRaw());
  } catch {
    return BEEP_DEFAULT_ENABLED;
  }
}

/** Persiste la preferencia de beep (R4.3). Best-effort: si falla, no rompe el flujo. */
export async function writeBeepEnabled(enabled: boolean): Promise<void> {
  try {
    await writeRaw(serializeBeepPref(enabled));
  } catch {
    // Best-effort: la preferencia es un ajuste de comodidad; su persistencia no es crítica.
  }
}
