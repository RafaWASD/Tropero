// Persistencia local del rodeo activo POR ESTABLECIMIENTO (spec 02 frontend, C1 / T3.1).
//
// Igual patrón que establishment-store.ts: web → localStorage; native → expo-secure-store.
// La key incluye user_id + establishment_id, así el rodeo activo es por (usuario, campo): un
// device compartido entre dos cuentas, o un usuario con varios campos, no mezcla rodeos.
//
// No es dato sensible (solo un id de rodeo), pero mantener un único patrón de storage en el
// cliente evita divergencia. Best-effort: si el storage falla, el contexto sigue funcionando
// en memoria (auto-selecciona el único rodeo / cae al landing).

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// expo-secure-store solo admite keys con [A-Za-z0-9._-]. Los UUID cumplen; saneamos defensivamente.
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

function key(userId: string, establishmentId: string): string {
  return `rafq.active_rodeo.${safe(userId)}.${safe(establishmentId)}`;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

async function readRaw(k: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return hasLocalStorage() ? window.localStorage.getItem(k) : null;
  }
  return SecureStore.getItemAsync(k);
}

async function writeRaw(k: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (hasLocalStorage()) window.localStorage.setItem(k, value);
    return;
  }
  await SecureStore.setItemAsync(k, value);
}

/** Lee el rodeo activo persistido para (usuario, campo). null si no hay / falla. */
export async function loadActiveRodeo(
  userId: string,
  establishmentId: string,
): Promise<string | null> {
  try {
    const raw = await readRaw(key(userId, establishmentId));
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Persiste el rodeo activo para (usuario, campo). Best-effort. */
export async function saveActiveRodeo(
  userId: string,
  establishmentId: string,
  rodeoId: string,
): Promise<void> {
  try {
    await writeRaw(key(userId, establishmentId), rodeoId);
  } catch {
    // Best-effort: persistir es nice-to-have entre reloads; no rompe la sesión.
  }
}
