// Tests de la resolución/validación de env (spec 15, T1.2 / R1.2, R1.3).
// node:test + type-stripping, sin Jest. La lógica PURA vive en env-resolve.ts (sin expo-constants);
// env.ts (I/O) no carga bajo node:test porque importa expo-constants.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeReader, resolveEnv, type EnvReader } from './env-resolve.ts';

/** Crea un reader desde un mapa de env. */
function readerFrom(map: Record<string, string | undefined>): EnvReader {
  return (name) => map[name];
}

const FULL = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  EXPO_PUBLIC_POWERSYNC_URL: 'https://inst.powersync.journeyapps.com',
};

test('R1.2: con las 3 vars presentes → devuelve el set tipado completo', () => {
  const env = resolveEnv(readerFrom(FULL));
  assert.equal(env.supabaseUrl, FULL.EXPO_PUBLIC_SUPABASE_URL);
  assert.equal(env.supabaseAnonKey, FULL.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  assert.equal(env.powersyncUrl, FULL.EXPO_PUBLIC_POWERSYNC_URL);
});

test('R1.3: falta EXPO_PUBLIC_POWERSYNC_URL → tira Error accionable en español que nombra la var', () => {
  const reader = readerFrom({ ...FULL, EXPO_PUBLIC_POWERSYNC_URL: undefined });
  assert.throws(
    () => resolveEnv(reader),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /EXPO_PUBLIC_POWERSYNC_URL/);
      assert.match(err.message, /\.env\.local/);
      // El mensaje está en español accionable, no es un crash opaco.
      assert.match(err.message, /Faltan variables de entorno/);
      return true;
    },
  );
});

test('R1.3: powersyncUrl vacío ("") cuenta como faltante (fail-closed, no string vacío)', () => {
  const reader = readerFrom({ ...FULL, EXPO_PUBLIC_POWERSYNC_URL: '' });
  assert.throws(() => resolveEnv(reader), /EXPO_PUBLIC_POWERSYNC_URL/);
});

test('R1.3: faltan las de Supabase también se reportan (mensaje único con las 3)', () => {
  const reader = readerFrom({ EXPO_PUBLIC_POWERSYNC_URL: FULL.EXPO_PUBLIC_POWERSYNC_URL });
  assert.throws(
    () => resolveEnv(reader),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /EXPO_PUBLIC_SUPABASE_URL/);
      assert.match(err.message, /EXPO_PUBLIC_SUPABASE_ANON_KEY/);
      return true;
    },
  );
});

// ── spec 19 (login social) — googleWebClientId OPCIONAL, fuera del fail-closed (R7.4) ──────────────

test('R7.4: SIN EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID → NO aborta; googleWebClientId queda undefined', () => {
  // Las 3 requeridas están; falta solo el web client ID → no debe tirar (buildable-now sin el ID de Raf).
  const env = resolveEnv(readerFrom(FULL));
  assert.equal(env.googleWebClientId, undefined);
  // Las requeridas siguen resolviendo normal.
  assert.equal(env.supabaseUrl, FULL.EXPO_PUBLIC_SUPABASE_URL);
});

test('R7.4: CON EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID → se expone en el env resuelto', () => {
  const env = resolveEnv(
    readerFrom({ ...FULL, EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'abc123.apps.googleusercontent.com' }),
  );
  assert.equal(env.googleWebClientId, 'abc123.apps.googleusercontent.com');
});

test('R7.4: falta el web client ID PERO falta también una requerida → sigue abortando (fail-closed intacto)', () => {
  // El web client ID opcional NO relaja el fail-closed de las 3 requeridas.
  const reader = readerFrom({ ...FULL, EXPO_PUBLIC_SUPABASE_URL: undefined });
  assert.throws(() => resolveEnv(reader), /EXPO_PUBLIC_SUPABASE_URL/);
});

// ── bring-up nativo — googleIosClientId OPCIONAL, mismo régimen que el web client ID ────────────────

test('iOS: SIN EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID → NO aborta; googleIosClientId queda undefined', () => {
  // Igual que el web client ID: su ausencia NO frena el arranque (fuera del fail-closed).
  const env = resolveEnv(readerFrom(FULL));
  assert.equal(env.googleIosClientId, undefined);
  assert.equal(env.supabaseUrl, FULL.EXPO_PUBLIC_SUPABASE_URL);
});

test('iOS: CON EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID → se expone en el env resuelto', () => {
  const env = resolveEnv(
    readerFrom({ ...FULL, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios123.apps.googleusercontent.com' }),
  );
  assert.equal(env.googleIosClientId, 'ios123.apps.googleusercontent.com');
});

// ── spec 16 (ambientes) — composeReader: precedencia estático → dinámico → extra (R3.1/R3.2) ────────

test('R3.1: el mapa ESTÁTICO gana sobre el dinámico y el extra', () => {
  const read = composeReader(
    { X: 'static' },
    () => 'dynamic',
    () => 'extra',
  );
  assert.equal(read('X'), 'static');
});

test('R3.2: si el estático está vacío/ausente, cae al reader DINÁMICO', () => {
  const readEmpty = composeReader({ X: '' }, () => 'dynamic', () => 'extra');
  assert.equal(readEmpty('X'), 'dynamic');
  const readMissing = composeReader({}, () => 'dynamic', () => 'extra');
  assert.equal(readMissing('X'), 'dynamic');
});

test('R3.2: si estático y dinámico están vacíos, cae a EXTRA', () => {
  const read = composeReader({ X: undefined }, () => undefined, () => 'extra');
  assert.equal(read('X'), 'extra');
});

test('R3.2: si ninguno resuelve → undefined (resolveEnv decide el fail-closed)', () => {
  const read = composeReader({}, () => undefined, () => undefined);
  assert.equal(read('X'), undefined);
});

test('R3.1/R3.2: composeReader + resolveEnv → resuelve las 3 requeridas desde capas distintas', () => {
  // URL por estático, ANON por dinámico, POWERSYNC por extra → resolveEnv arma el set completo.
  const read = composeReader(
    { EXPO_PUBLIC_SUPABASE_URL: FULL.EXPO_PUBLIC_SUPABASE_URL },
    (n) => (n === 'EXPO_PUBLIC_SUPABASE_ANON_KEY' ? FULL.EXPO_PUBLIC_SUPABASE_ANON_KEY : undefined),
    (n) => (n === 'EXPO_PUBLIC_POWERSYNC_URL' ? FULL.EXPO_PUBLIC_POWERSYNC_URL : undefined),
  );
  const env = resolveEnv(read);
  assert.equal(env.supabaseUrl, FULL.EXPO_PUBLIC_SUPABASE_URL);
  assert.equal(env.supabaseAnonKey, FULL.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  assert.equal(env.powersyncUrl, FULL.EXPO_PUBLIC_POWERSYNC_URL);
});
