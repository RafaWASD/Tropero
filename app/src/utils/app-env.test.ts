// Tests de app-env.ts (spec 16, A5 / R3.4/R3.6/R3.7). node:test + type-stripping (sin Jest).
// PURO: solo toca process.env.EXPO_PUBLIC_ENV y globalThis.__MITROPERO_E2E__, que se resetean por test.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getAppEnv, isE2E, APP_E2E_GLOBAL_KEY } from './app-env.ts';

function reset(): void {
  delete process.env.EXPO_PUBLIC_ENV;
  delete (globalThis as Record<string, unknown>)[APP_E2E_GLOBAL_KEY];
}

beforeEach(reset);

test('R3.4/R3.7: sin marca ni EXPO_PUBLIC_ENV → getAppEnv() development e isE2E() false', () => {
  assert.equal(getAppEnv(), 'development');
  assert.equal(isE2E(), false);
});

test('R3.4: EXPO_PUBLIC_ENV reconoce todo el dominio {development,preview,production,e2e}', () => {
  for (const env of ['development', 'preview', 'production', 'e2e'] as const) {
    process.env.EXPO_PUBLIC_ENV = env;
    assert.equal(getAppEnv(), env);
  }
});

test('R3.4: valor FUERA de dominio → default development', () => {
  process.env.EXPO_PUBLIC_ENV = 'staging';
  assert.equal(getAppEnv(), 'development');
});

test('R3.4: string vacío → default development (no cuenta como presente)', () => {
  process.env.EXPO_PUBLIC_ENV = '';
  assert.equal(getAppEnv(), 'development');
});

test('R3.6: EXPO_PUBLIC_ENV=e2e → isE2E() true', () => {
  process.env.EXPO_PUBLIC_ENV = 'e2e';
  assert.equal(isE2E(), true);
});

test('R3.6: globalThis.__MITROPERO_E2E__=true → isE2E() true (aunque el env no sea e2e)', () => {
  process.env.EXPO_PUBLIC_ENV = 'production';
  (globalThis as Record<string, unknown>)[APP_E2E_GLOBAL_KEY] = true;
  assert.equal(isE2E(), true);
  // getAppEnv sigue reportando el ambiente real (la marca solo afecta isE2E).
  assert.equal(getAppEnv(), 'production');
});

test('R3.7: marca con valor != true (ej. "true" string) NO activa isE2E', () => {
  process.env.EXPO_PUBLIC_ENV = 'development';
  (globalThis as Record<string, unknown>)[APP_E2E_GLOBAL_KEY] = 'true';
  assert.equal(isE2E(), false);
});
