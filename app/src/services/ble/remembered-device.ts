// Persistencia local del "bastón recordado" (R6.3). La usa adapter-spp-android (Fase 4, dev
// build, fuera de este run) para reconectar al device elegido sin volver a la pantalla de
// conexión. Para web-serial, "recordar" lo provee navigator.serial.getPorts() (R5.4), así
// que este módulo NO es su mecanismo; queda como infraestructura del SPP.
//
// Patrón de storage canónico del proyecto: web → localStorage; native → expo-secure-store.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const STORAGE_KEY = 'rafq.ble.remembered_device';

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._:-]/g, '_');
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Lee el id del bastón recordado, o null si no hay (R6.3). */
export async function readRememberedDevice(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return hasLocalStorage() ? window.localStorage.getItem(STORAGE_KEY) : null;
    }
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persiste el bastón elegido (R6.3, sobrevive reinicios). Best-effort. */
export async function writeRememberedDevice(deviceId: string): Promise<void> {
  try {
    const value = safe(deviceId);
    if (Platform.OS === 'web') {
      if (hasLocalStorage()) window.localStorage.setItem(STORAGE_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_KEY, value);
  } catch {
    // Best-effort: si falla, la próxima vez se pide elegir el bastón de nuevo.
  }
}

/** Olvida el bastón recordado (R6.6, acción "olvidar"). Best-effort. */
export async function forgetRememberedDevice(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (hasLocalStorage()) window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
