// Persistencia local por usuario del establecimiento activo + rastro de visitados
// (spec 01, R6.9 — promovido a REQUERIDO en sesión 17). Sobrevive cold-start.
//
// R6.9: el cliente debe persistir `last_establishment_opened` (el campo activo) y un
// rastro corto de los últimos campos visitados, suficiente para alimentar los "últimos
// 2 visitados" del dropdown del switch (R6.8.1) y para ordenar "Mis campos" (R6.6.1).
//
// Mecanismo (decisión técnica menor — la spec dejó abierto AsyncStorage/secure-store/
// fila propia, design.md §"Nota de implementación pendiente"): reusamos el MISMO patrón
// de storage de B.1.1 (lockout-store / pending-invitation): web → localStorage; native →
// expo-secure-store. No es dato sensible (solo ids de campos), pero mantener un único
// patrón de storage en el cliente evita divergencia. La key incluye el user_id para que
// el rastro sea POR USUARIO (un device compartido entre dos cuentas no mezcla campos).
//
// El rastro de visitados es una lista de ids ordenada por recencia (más reciente
// primero). El head es el campo activo (last_establishment_opened). Se recorta a
// MAX_TRAIL para no crecer sin límite.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { MAX_TRAIL, promoteInTrail } from '../utils/establishment';

// La lógica pura del rastro (promoteInTrail / MAX_TRAIL) vive en ../utils/establishment
// (sin imports de RN/expo) para ser testeable con node:test. Acá solo I/O de plataforma.
// Re-exportamos promoteInTrail por compatibilidad con quien lo consuma desde el store.
export { promoteInTrail } from '../utils/establishment';

// expo-secure-store solo admite keys con [A-Za-z0-9._-]. El user_id es un UUID (cumple),
// pero saneamos defensivamente (mismo criterio que el storage adapter de auth).
function userKey(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `rafq.est_trail.${safe}`;
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

// ─── API persistente ──────────────────────────────────────────────────────────

/** Lee el rastro persistido (más reciente primero). [] si no hay nada / parseo falla. */
export async function loadTrail(userId: string): Promise<string[]> {
  try {
    const raw = await readRaw(userKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_TRAIL);
  } catch {
    return [];
  }
}

/** Persiste el rastro (best-effort). Si falla, el estado en memoria sigue funcionando. */
export async function saveTrail(userId: string, trail: string[]): Promise<void> {
  try {
    await writeRaw(userKey(userId), JSON.stringify(trail.slice(0, MAX_TRAIL)));
  } catch {
    // Best-effort: persistir es nice-to-have entre reloads; no rompe la sesión.
  }
}

/**
 * Registra que el usuario abrió `id` (switch / landing): lo promueve al frente del rastro
 * persistido y devuelve el rastro actualizado. Es read-modify-write sobre el storage.
 */
export async function recordOpened(userId: string, id: string): Promise<string[]> {
  const current = await loadTrail(userId);
  const next = promoteInTrail(current, id);
  await saveTrail(userId, next);
  return next;
}
