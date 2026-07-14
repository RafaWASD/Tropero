// Tests de app.config.ts (spec 16, A1 / R2). node:test + type-stripping (sin Jest).
// El default export es una función pura de process.env.APP_VARIANT → se ejerce sin cargar expo
// (el `import type { ExpoConfig }` de app.config.ts se erasa bajo type-stripping).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import config from './app.config.ts';

/** Evalúa app.config con un APP_VARIANT dado (undefined = variable ausente). */
function build(variant?: string): ReturnType<typeof config> {
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  return config();
}

/** Nombres de plugin (aplanando los tuples [name, opts]). */
function pluginNames(c: ReturnType<typeof config>): string[] {
  return (c.plugins ?? []).map((p) => (Array.isArray(p) ? String(p[0]) : String(p)));
}

test('R2.2/R2.4: APP_VARIANT=development → "RAFAQ (Dev)" + ids ar.rafq.app.dev', () => {
  const c = build('development');
  assert.equal(c.name, 'RAFAQ (Dev)');
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app.dev');
  assert.equal(c.android?.package, 'ar.rafq.app.dev');
});

test('R2.3: APP_VARIANT ausente → "RAFAQ" + ids ar.rafq.app', () => {
  const c = build(undefined);
  assert.equal(c.name, 'RAFAQ');
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app');
  assert.equal(c.android?.package, 'ar.rafq.app');
});

test('R2.3: APP_VARIANT != development (ej. production) → "RAFAQ" + ar.rafq.app', () => {
  const c = build('production');
  assert.equal(c.name, 'RAFAQ');
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app');
  assert.equal(c.android?.package, 'ar.rafq.app');
});

test('R2.4: dev y prod tienen ids distintos → coexisten instalados en el mismo device', () => {
  const dev = build('development');
  const prod = build(undefined);
  assert.notEqual(dev.android?.package, prod.android?.package);
  assert.notEqual(dev.ios?.bundleIdentifier, prod.ios?.bundleIdentifier);
});

test('R2.1: preserva slug/scheme/version/owner/eas.projectId (+ orientation/icon/web/permisos)', () => {
  const c = build('development');
  assert.equal(c.slug, 'rafaq-app');
  assert.equal(c.scheme, 'rafq');
  assert.equal(c.version, '0.1.0');
  assert.equal(c.owner, 'rafaqsorg');
  assert.equal(c.orientation, 'portrait');
  assert.equal(c.icon, './assets/icon.png');
  assert.equal((c.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId,
    'd8cf3a19-e8f7-4d7f-b417-54123e7f0d3e');
  assert.deepEqual(c.android?.permissions, ['NOTIFICATIONS']);
  assert.equal(c.web?.favicon, './assets/favicon.png');
});

test('R2.1: preserva plugins OAuth de la feature 19 + expo-sharing (Fase 0) + notifications/router/splash', () => {
  const names = pluginNames(build(undefined));
  // Feature 19 (login social)
  assert.ok(names.includes('@react-native-google-signin/google-signin'), 'falta google-signin (feature 19)');
  assert.ok(names.includes('expo-apple-authentication'), 'falta apple-authentication (feature 19)');
  assert.equal(build(undefined).ios?.usesAppleSignIn, true, 'falta ios.usesAppleSignIn (feature 19)');
  // Fase 0 (chore)
  assert.ok(names.includes('expo-sharing'), 'falta expo-sharing (Fase 0)');
  // Base
  assert.ok(names.includes('expo-notifications'));
  assert.ok(names.includes('expo-router'));
  assert.ok(names.includes('expo-splash-screen'));
});

test('R2.5: extra.supabaseUrl eliminado (grep sin consumidores); extra.router/eas conservados', () => {
  const extra = build(undefined).extra as Record<string, unknown> | undefined;
  assert.equal(extra?.supabaseUrl, undefined);
  assert.ok(extra && 'router' in extra);
  assert.ok(extra && 'eas' in extra);
});
