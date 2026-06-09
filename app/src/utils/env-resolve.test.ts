// Tests de la resolución/validación de env (spec 15, T1.2 / R1.2, R1.3).
// node:test + type-stripping, sin Jest. La lógica PURA vive en env-resolve.ts (sin expo-constants);
// env.ts (I/O) no carga bajo node:test porque importa expo-constants.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEnv, type EnvReader } from './env-resolve.ts';

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
