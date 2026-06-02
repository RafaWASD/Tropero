// `lastRodeoSelected` — estado de cliente del default de rodeo al dar de alta (spec 09 R6).
//
// Modelo (R6.1): un map { [establishment_id]: rodeo_id } scoped al usuario actual, persistido en
// MEMORIA (sobrevive navegación) + STORAGE local (sobrevive background/foreground y cold-start).
// Reusa el patrón de storage de rodeo-store.ts (web → localStorage; native → expo-secure-store):
// es el adapter local canónico del proyecto. (El design.md de spec 09 menciona AsyncStorage, pero
// el proyecto NO usa @react-native-async-storage; expo-secure-store es el adapter ya adoptado en
// C1 — usarlo evita una dependencia nueva y mantiene un solo patrón de storage, R6.1 cumplida.)
//
// Fallback (R6.3/R6.4): cuando no hay valor en memoria/storage para el establishment, se consulta
// la base por el último rodeo que el usuario tocó en animal_profiles de ese campo; si no hay,
// el primer rodeo activo creado. Si no hay rodeos, null → la UI bloquea con CTA al wizard (R6.4).
//
// Multi-tenant (CLAUDE.md ppio 6): el map es POR establishment (R6.6); cambiar de campo usa la
// entrada del nuevo campo. NUNCA se hardcodea establishment_id.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { supabase } from './supabase';
import type { ServiceResult } from './animals';

// El resolver PURO (R6.2→R6.3→R6.4) vive en utils/last-rodeo.ts (sin RN, testeable bajo node).
// Lo re-exportamos acá para que los callers tengan un único punto de entrada del módulo.
export { resolveDefaultRodeoId } from '../utils/last-rodeo';

// ─── Storage local (memoria + SecureStore/localStorage), patrón de rodeo-store.ts ──────

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_');
}

function key(userId: string, establishmentId: string): string {
  return `rafq.last_rodeo.${safe(userId)}.${safe(establishmentId)}`;
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

/** Lee el lastRodeoSelected persistido para (usuario, campo). null si no hay / falla (R6.1). */
export async function readLastRodeo(
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

/** Persiste el lastRodeoSelected para (usuario, campo). Best-effort (R6.5). */
export async function writeLastRodeo(
  userId: string,
  establishmentId: string,
  rodeoId: string,
): Promise<void> {
  try {
    await writeRaw(key(userId, establishmentId), rodeoId);
  } catch {
    // Best-effort: persistir es atajo de productividad, no rompe el alta si falla.
  }
}

// ─── Fallback a la base (R6.3 / R6.4) ────────────────────────────────────────────────

/**
 * R6.3: último rodeo que el usuario tocó en este campo = el rodeo del animal_profile más
 * reciente (created_at desc) del establishment que el usuario puede ver (RLS scopea por
 * has_role_in). No tenemos last_modified_by en el schema; usamos created_at del perfil como
 * proxy de "último rodeo usado" (es lo que el cliente puede observar sin columnas extra). null
 * si el usuario nunca cargó animales en este campo.
 */
export async function queryLastUsedRodeoFromDb(
  establishmentId: string,
): Promise<ServiceResult<string | null>> {
  const { data, error } = await supabase
    .from('animal_profiles')
    .select('rodeo_id')
    .eq('establishment_id', establishmentId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const msg = error.message ?? '';
    if (/network|failed to fetch|fetch failed/i.test(msg)) {
      return { ok: false, error: { kind: 'network', message: msg } };
    }
    return { ok: false, error: { kind: 'unknown', message: msg || 'Error desconocido' } };
  }
  return { ok: true, value: data?.rodeo_id ?? null };
}
