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

test('R2.2/R2.4: APP_VARIANT=development → "miTropero (Dev)" + ids ar.rafq.app.dev', () => {
  const c = build('development');
  assert.equal(c.name, 'miTropero (Dev)');
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app.dev');
  assert.equal(c.android?.package, 'ar.rafq.app.dev');
});

test('R2.3: APP_VARIANT ausente → "miTropero" + ids ar.rafq.app', () => {
  const c = build(undefined);
  assert.equal(c.name, 'miTropero');
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app');
  assert.equal(c.android?.package, 'ar.rafq.app');
});

test('R2.3: APP_VARIANT != development (ej. production) → "miTropero" + ar.rafq.app', () => {
  const c = build('production');
  assert.equal(c.name, 'miTropero');
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app');
  assert.equal(c.android?.package, 'ar.rafq.app');
});

test('rebrand fase 1: NINGUNA variante muestra el nombre viejo, y los ids NO se rebrandean', () => {
  // Guard sobre la AUSENCIA: los asserts de arriba fijan el nombre nuevo variante por variante, pero
  // un revert parcial (una sola rama del ternario) pasaría desapercibido si mañana se agrega otra
  // variante. Acá se barre el conjunto.
  for (const variant of [undefined, 'development', 'preview', 'production']) {
    const c = build(variant);
    assert.ok(
      !/rafaq/i.test(String(c.name)),
      `la marca vieja quedó en el nombre visible con variant=${variant}: ${c.name}`,
    );
    assert.ok(String(c.name).startsWith('miTropero'), `nombre inesperado con variant=${variant}: ${c.name}`);
  }
  // La contracara: el rebrand de fase 1 es SOLO el nombre visible. El identificador de la app, el
  // scheme, el slug y el owner NO se tocan (fase 2 — dependen de Apple/Google/EAS y de romper los
  // deep links de OAuth e invitaciones). Si alguien "completa el rebrand" acá, este assert lo frena.
  const c = build(undefined);
  assert.equal(c.ios?.bundleIdentifier, 'ar.rafq.app');
  assert.equal(c.android?.package, 'ar.rafq.app');
  assert.equal(c.scheme, 'rafq');
  assert.equal(c.slug, 'rafaq-app');
  assert.equal(c.owner, 'rafaqsorg');
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

test('spec 04 / RMV5.8: el config plugin del bastón Bluetooth está enganchado', () => {
  // `react-native-bluetooth-classic` no trae config plugin propio: sin esta entrada no hay dónde
  // declarar la política de permisos Android del bastón (y ACCESS_FINE_LOCATION de la lib entra
  // sin tope). Es una línea fácil de perder en un merge, por eso se asertá.
  const names = pluginNames(build(undefined));
  assert.ok(names.includes('./plugins/with-bluetooth-classic'), 'falta el plugin del bastón (spec 04)');
  // Y en la variante dev también (es el build que Raf instala en el teléfono).
  assert.ok(pluginNames(build('development')).includes('./plugins/with-bluetooth-classic'));
});

test('spec 04 / R4.2: `expo-audio` NO se engancha como config plugin (sería pedir el micrófono)', () => {
  // ── DECISIÓN, no olvido (2026-08-06, unidad «el bastón tiene que sonar y vibrar de verdad») ────────
  // `npx expo install expo-audio` imprime «Add the following to your Expo config: plugins:
  // ["expo-audio"]». NO se hizo, y no hacerlo es lo correcto para nuestro uso.
  //
  // El plugin de expo-audio existe para GRABAR y para reproducir en background. Con sus defaults agrega:
  // `RECORD_AUDIO` (permiso PELIGROSO de Android, con diálogo al usuario), `NSMicrophoneUsageDescription`
  // en iOS, `UIBackgroundModes: ['audio']`, `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` y
  // un `MediaSessionService` en el manifiesto. Todo eso para un pip de 110 ms de un asset empaquetado —
  // que no necesita NINGÚN permiso.
  //
  // Y agregarlo "con todo apagado" tampoco aportaría nada: el único permiso que quedaría
  // (`MODIFY_AUDIO_SETTINGS`) YA lo mergea el manifiesto propio de la librería
  // (`node_modules/expo-audio/android/src/main/AndroidManifest.xml`), con plugin o sin él. O sea que la
  // opción sin plugin es estrictamente la de menor superficie y exactamente equivalente para nosotros.
  //
  // Este test es el que impide que alguien "arregle el warning de expo-doctor" pegando la línea sin leer
  // lo de arriba: un pedido de micrófono que aparece en una app de ganadería es un problema de confianza
  // (y de revisión de tienda), no un detalle de config.
  for (const variant of [undefined, 'development', 'production']) {
    const names = pluginNames(build(variant));
    assert.ok(!names.includes('expo-audio'), `expo-audio quedó enganchado como plugin en variant=${variant}`);
  }
  // Ni RECORD_AUDIO ni el micrófono por la otra puerta (declararlos a mano en la config).
  const c = build(undefined);
  assert.deepEqual(c.android?.permissions, ['NOTIFICATIONS'], 'entró un permiso Android nuevo');
  assert.equal(
    (c.ios?.infoPlist as Record<string, unknown> | undefined)?.NSMicrophoneUsageDescription,
    undefined,
    'apareció un uso de micrófono en el Info.plist',
  );
  assert.deepEqual(
    (c.ios?.infoPlist as { UIBackgroundModes?: string[] } | undefined)?.UIBackgroundModes,
    ['remote-notification'],
    'apareció un background mode nuevo (el de audio lo agrega el plugin de expo-audio)',
  );
});

test('R2.5: extra.supabaseUrl eliminado (grep sin consumidores); extra.router/eas conservados', () => {
  const extra = build(undefined).extra as Record<string, unknown> | undefined;
  assert.equal(extra?.supabaseUrl, undefined);
  assert.ok(extra && 'router' in extra);
  assert.ok(extra && 'eas' in extra);
});
