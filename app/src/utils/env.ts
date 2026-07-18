import Constants from 'expo-constants';

import { composeReader, resolveEnv, type EnvReader, type RequiredEnv } from './env-resolve';

// Mapa ESTÁTICO (spec 16, R3.1): un acceso LITERAL `process.env.EXPO_PUBLIC_X` por variable, para que
// `babel-preset-expo` lo inlinee en el build web de producción. El acceso dinámico `process.env[name]`
// (key variable) NO se inlinea → sin esto el bundle web queda con las vars undefined (pantalla en
// blanco). Incluye el Web + iOS Client ID de Google (feature 19): públicos, se inlinean igual que las
// 3 base (el iOS Client ID ya es público en el reversed URL scheme del app.config.ts; no es secreto).
const STATIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_POWERSYNC_URL: process.env.EXPO_PUBLIC_POWERSYNC_URL,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
};

// Reader DINÁMICO (R3.2): `process.env[name]` con key VARIABLE → NO inlineable por babel, así lo
// capta el dev server (`pnpm web`) y el shim E2E de fixtures.ts (que setea globalThis.process.env
// antes del boot). Es el reader histórico; se preserva tal cual para no romper los ~70 specs E2E.
const dynamicRead: EnvReader = (name) => {
  const v = (process.env as Record<string, string | undefined>)[name];
  return v && v.length > 0 ? v : undefined;
};

// Reader de EXTRA (R3.2): último fallback vía Constants.expoConfig.extra[name]. Se preserva del
// reader histórico (aunque hoy `extra` no trae claves EXPO_PUBLIC_*; ver A2/R2.5).
const extraRead: EnvReader = (name) => {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const v = extra[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

// Precedencia: estático (build web inlineado) → dinámico (dev/E2E) → extra.
const readPublicEnv = composeReader(STATIC_ENV, dynamicRead, extraRead);

export function getEnv(): RequiredEnv {
  return resolveEnv(readPublicEnv);
}
