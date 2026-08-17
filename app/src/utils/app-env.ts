// app/src/utils/app-env.ts — ambiente de la app (spec 16, R3.4/R3.6/R3.7).
//
// PURO de RN/expo (solo lee process.env / globalThis): testeable bajo node:test e importable desde
// cualquier lado. Feature 17 lo consume para gatear Sentry/PostHog (`enabled: !!dsn && !isE2E()`).
//
// Mismo patrón de flag que ble-e2e-flag.ts: una marca `window.__MITROPERO_E2E__` que SOLO Playwright pone
// (addInitScript antes del bundle, ver e2e/helpers/fixtures.ts), más el discriminador
// EXPO_PUBLIC_ENV==='e2e'. En producción/dev normal ninguna existe → isE2E() = false. La marca NO se
// puede setear desde la UI ni desde un input de usuario → sin camino para un usuario real.

export type AppEnv = 'development' | 'preview' | 'production' | 'e2e';

// EXPORTADA para que los guards deriven el dominio de acá en vez de re-tipearlo (un espejo escrito a
// mano se desincroniza en silencio): hoy la consume `app/eas-profiles-guard.test.ts`, que valida el
// `EXPO_PUBLIC_ENV` de cada perfil de `eas.json` contra ESTE conjunto.
export const APP_ENVS: readonly AppEnv[] = ['development', 'preview', 'production', 'e2e'];
const DEFAULT_APP_ENV: AppEnv = 'development';

// Key VARIABLE para el fallback dinámico → NO inlineable por babel (igual que env.ts).
const ENV_KEY = 'EXPO_PUBLIC_ENV';
const E2E_GLOBAL_KEY = '__MITROPERO_E2E__';

/**
 * Lee EXPO_PUBLIC_ENV con la misma precedencia que env.ts para las públicas (R3.1/R3.2):
 *   1. acceso ESTÁTICO literal `process.env.EXPO_PUBLIC_ENV` → inlineado por babel en el build web.
 *   2. fallback DINÁMICO `process.env[ENV_KEY]` (key variable, no inlineable) → dev server + shim E2E.
 * (No hay capa `extra`: este módulo es puro y no importa expo-constants; EXPO_PUBLIC_ENV no viaja por
 * `extra` en ningún ambiente.)
 */
function readAppEnvRaw(): string | undefined {
  const staticVal = process.env.EXPO_PUBLIC_ENV; // R3.1 — literal, inlineable
  if (staticVal && staticVal.length > 0) return staticVal;
  const dynVal = (process.env as Record<string, string | undefined>)[ENV_KEY]; // R3.2 — no inlineable
  return dynVal && dynVal.length > 0 ? dynVal : undefined;
}

/**
 * Ambiente actual de la app. Dominio {development,preview,production,e2e} y default `development`
 * (R3.4): un valor ausente o FUERA de dominio cae al default (nunca rompe el boot).
 */
export function getAppEnv(): AppEnv {
  const raw = readAppEnvRaw();
  return raw && (APP_ENVS as readonly string[]).includes(raw) ? (raw as AppEnv) : DEFAULT_APP_ENV;
}

/**
 * ¿Corrida E2E? true si Playwright marcó `window.__MITROPERO_E2E__` antes del boot (R3.6) O si
 * EXPO_PUBLIC_ENV==='e2e'. Sin ninguna de las dos: false (producción/dev normal, R3.7). PURA
 * (fail-safe: cualquier excepción al leer globalThis → false).
 */
export function isE2E(): boolean {
  try {
    if ((globalThis as Record<string, unknown>)[E2E_GLOBAL_KEY] === true) return true;
    return getAppEnv() === 'e2e';
  } catch {
    return false;
  }
}

export const APP_E2E_GLOBAL_KEY = E2E_GLOBAL_KEY;
