// Cliente Supabase real de RAFAQ (spec 01, T3.1).
//
// La sesión de Auth persiste en almacenamiento seguro del dispositivo vía un
// storage adapter sobre expo-secure-store (solo-native). En WEB expo-secure-store
// no existe, así que el adapter cae con gracia a localStorage (o a un Map en
// memoria si ni siquiera hay window — ej. SSR/headless), así `pnpm web` no rompe.
//
// La sesión la maneja supabase-js: persistSession + autoRefreshToken. NUNCA se
// loguea el contenido de la sesión (tokens) — el adapter solo mueve bytes opacos.
//
// TODO B.1.2 (native): expo-secure-store advierte sobre valores > 2 KB y algunos
// OS los rechazan. supabase-js guarda la sesión entera (JWT + refresh token) en UNA
// key, que puede superar ese umbral. El veredicto en device está diferido (no hay
// dev-build aún, ver progress/current.md). Cuando se habilite el testing en device,
// si la sesión no persiste, migrar el adapter native a un esquema chunked (patrón
// conocido Supabase + SecureStore). En WEB (target de verificación de B.1.1)
// localStorage no tiene este límite, así que no aplica.

import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getEnv } from '../utils/env';

// expo-secure-store solo admite keys con [A-Za-z0-9._-]. Las claves que emite
// supabase-js (`sb-<ref>-auth-token`) ya cumplen; saneamos defensivamente por si
// una key futura trae un caracter inválido (evita un throw opaco en SecureStore).
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

// Fallback de memoria: último recurso cuando no hay SecureStore (web) NI window
// (headless). La sesión no sobrevive el reload, pero la app no crashea.
const memoryStore = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

// Storage adapter web: localStorage si está, sino memoria. Síncrono por debajo,
// pero la interfaz de supabase-js es async-friendly (devolvemos Promises).
const webStorage: SupportedStorage = {
  getItem: async (key) => {
    if (hasLocalStorage()) return window.localStorage.getItem(key);
    return memoryStore.get(key) ?? null;
  },
  setItem: async (key, value) => {
    if (hasLocalStorage()) window.localStorage.setItem(key, value);
    else memoryStore.set(key, value);
  },
  removeItem: async (key) => {
    if (hasLocalStorage()) window.localStorage.removeItem(key);
    else memoryStore.delete(key);
  },
};

// Storage adapter native: expo-secure-store (Keychain iOS / Keystore Android).
const secureStorage: SupportedStorage = {
  getItem: (key) => SecureStore.getItemAsync(safeKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(safeKey(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(safeKey(key)),
};

const authStorage: SupportedStorage = Platform.OS === 'web' ? webStorage : secureStorage;

const { supabaseUrl, supabaseAnonKey } = getEnv();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    // En native no hay URL bar que parsee el callback; el deep-link lo manejamos
    // explícitamente (Fase 5). En web el detectSessionInUrl recupera la sesión
    // del fragment tras verificación/reset de password.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
