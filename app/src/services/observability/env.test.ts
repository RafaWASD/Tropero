// Tests de env.ts (observability, feature 17, R1.2/R5.1). node:test + type-stripping.
// El STATIC_ENV se captura al IMPORTAR el módulo (undefined bajo node:test) → estos tests ejercen el
// fallback DINÁMICO (process.env[name]) seteando las vars DESPUÉS del import. Reset por test.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getObservabilityEnv } from './env.ts';

const KEYS = ['EXPO_PUBLIC_SENTRY_DSN', 'EXPO_PUBLIC_POSTHOG_KEY', 'EXPO_PUBLIC_POSTHOG_HOST'] as const;

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

test('sin envs → dsn/key undefined y host = default US Cloud (app bootea no-op)', () => {
  const env = getObservabilityEnv();
  assert.equal(env.sentryDsn, undefined);
  assert.equal(env.posthogKey, undefined);
  assert.equal(env.posthogHost, 'https://us.i.posthog.com');
});

test('con envs → los lee (fallback dinámico)', () => {
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://pk@o1.ingest.us.sentry.io/2';
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_abc';
  process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com';
  const env = getObservabilityEnv();
  assert.equal(env.sentryDsn, 'https://pk@o1.ingest.us.sentry.io/2');
  assert.equal(env.posthogKey, 'phc_abc');
  assert.equal(env.posthogHost, 'https://eu.i.posthog.com');
});

test('string vacío cuenta como ausente (no rompe el default del host)', () => {
  process.env.EXPO_PUBLIC_POSTHOG_HOST = '';
  process.env.EXPO_PUBLIC_SENTRY_DSN = '';
  const env = getObservabilityEnv();
  assert.equal(env.posthogHost, 'https://us.i.posthog.com');
  assert.equal(env.sentryDsn, undefined);
});
