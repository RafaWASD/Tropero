// env.ts (observability) — reader de las 3 EXPO_PUBLIC_* de Sentry/PostHog (feature 17, R1.2/R5.1).
//
// Mismo patrón que app/src/utils/app-env.ts y utils/env.ts:
//   1. acceso ESTÁTICO literal `process.env.EXPO_PUBLIC_X` → babel-preset-expo lo INLINEA en el build web.
//   2. fallback DINÁMICO `process.env[KEY]` (key variable, NO inlineable) → dev server + shim E2E.
// Son claves de CLIENTE write-only (viajan embebidas; no son secretos tipo password). `environment`
// (Sentry) y la super property `env` (PostHog) salen de getAppEnv(), NO de este reader.

// Mapa ESTÁTICO literal (inlineable por babel en el build web de producción).
const STATIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
  EXPO_PUBLIC_POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST,
};

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** Lee una EXPO_PUBLIC_* con precedencia estático (build web) → dinámico (dev/E2E). '' cuenta como ausente. */
function readPublic(name: keyof typeof STATIC_ENV): string | undefined {
  const staticVal = STATIC_ENV[name];
  if (staticVal && staticVal.length > 0) return staticVal;
  const dynVal = (process.env as Record<string, string | undefined>)[name];
  return dynVal && dynVal.length > 0 ? dynVal : undefined;
}

export type ObservabilityEnv = {
  sentryDsn: string | undefined;
  posthogKey: string | undefined;
  /** Siempre presente: default US Cloud si falta la env. */
  posthogHost: string;
};

/**
 * Env de observabilidad. `sentryDsn`/`posthogKey` `undefined` si faltan → el init de Sentry queda no-op
 * (enabled: !!dsn && !isE2E()) y el client de PostHog queda disabled (!key || isE2E()): la app bootea
 * idéntica sin cuentas (R1.3/R5.2/R8.1).
 */
export function getObservabilityEnv(): ObservabilityEnv {
  return {
    sentryDsn: readPublic('EXPO_PUBLIC_SENTRY_DSN'),
    posthogKey: readPublic('EXPO_PUBLIC_POSTHOG_KEY'),
    posthogHost: readPublic('EXPO_PUBLIC_POSTHOG_HOST') ?? DEFAULT_POSTHOG_HOST,
  };
}
