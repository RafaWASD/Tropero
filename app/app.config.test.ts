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

/** Opciones del plugin `name` (o `undefined` si no está declarado / se declaró sin opciones). */
function pluginOptions(c: ReturnType<typeof config>, name: string): Record<string, unknown> | undefined {
  const entry = (c.plugins ?? []).find((p) => (Array.isArray(p) ? p[0] === name : p === name));
  return Array.isArray(entry) ? ((entry[1] ?? {}) as Record<string, unknown>) : undefined;
}

const ALL_VARIANTS: (string | undefined)[] = [undefined, 'development', 'preview', 'production'];

test('spec 04 delta ios-ble-mfi / RBM2.15: el plugin de `react-native-ble-plx` está declarado y SIN background', () => {
  // Dos cosas distintas y las dos importan: que el plugin ESTÉ (sin él no hay permisos de Android ni
  // purpose string desde la lib) y que el background esté APAGADO (R6.9 es foreground-only).
  //
  // `isBackgroundEnabled: true` agregaría `<uses-feature bluetooth_le required="true">` al manifiesto
  // y `modes: ['central']` escribiría `UIBackgroundModes: ['bluetooth-central']` en el Info.plist —
  // una capacidad que la app no usa y que en iOS arrastra escrutinio de App Review.
  for (const variant of ALL_VARIANTS) {
    const c = build(variant);
    assert.ok(pluginNames(c).includes('react-native-ble-plx'), `falta el plugin de BLE (variant=${variant})`);
    const opts = pluginOptions(c, 'react-native-ble-plx');
    assert.ok(opts, `el plugin de BLE quedó declarado SIN opciones (variant=${variant})`);
    assert.equal(opts?.isBackgroundEnabled, false, `background BLE habilitado (variant=${variant})`);
    assert.deepEqual(opts?.modes, [], `el plugin declaró modos de background (variant=${variant})`);
  }
});

test('RBM2.15 (GUARD sobre la AUSENCIA): la palabra `bluetooth-central` no aparece en NINGUNA parte de la config', () => {
  // Los asserts de arriba vigilan la puerta del plugin. Esta vigila TODAS las demás: declararlo a mano
  // en `ios.infoPlist.UIBackgroundModes`, colarlo por otro plugin, o pasarlo con otro nombre de opción.
  // Es la diferencia entre prohibir una grafía en un lugar y prohibir la capacidad en la config entera.
  for (const variant of ALL_VARIANTS) {
    const serialized = JSON.stringify(build(variant));
    assert.equal(
      /bluetooth-central|bluetooth-peripheral/.test(serialized),
      false,
      `apareció un modo de background BLE en la config (variant=${variant})`,
    );
  }
  // Y el positivo que sostiene el negativo: el único background declarado sigue siendo el de push.
  for (const variant of ALL_VARIANTS) {
    assert.deepEqual(
      (build(variant).ios?.infoPlist as { UIBackgroundModes?: string[] } | undefined)?.UIBackgroundModes,
      ['remote-notification'],
      `cambió UIBackgroundModes (variant=${variant})`,
    );
  }
});

test('RBM2.13: el plugin de BLE declara `neverForLocation` → la ubicación entra TOPEADA a API 30', () => {
  // No es cosmético: con el default (`false`) el plugin declara `ACCESS_COARSE_LOCATION` y
  // `ACCESS_FINE_LOCATION` SIN `maxSdkVersion`, y una app de ganado pasaría a pedir ubicación en
  // Android 12+ (ruido en la ficha de Play y una pregunta incómoda en la revisión). Es exactamente lo
  // que `plugins/with-bluetooth-classic.js` existe para evitar — ver su cabecera.
  for (const variant of ALL_VARIANTS) {
    assert.equal(
      pluginOptions(build(variant), 'react-native-ble-plx')?.neverForLocation,
      true,
      `falta neverForLocation en el plugin de BLE (variant=${variant})`,
    );
  }
});

test('RBM2.17: el purpose string que el plugin de BLE escribe es EL NUESTRO, no su default en inglés', () => {
  // `withBluetoothPermissions` de la lib hace
  //     NSBluetoothAlwaysUsageDescription = bluetoothAlwaysPermission || <el ya existente> || <default EN>
  // y ESCRIBE el Info.plist. El guard de purpose strings verifica la FUENTE (`app.config.ts`), no el
  // plist del prebuild — su límite nº5 dice, textual, que ningún plugin nuestro tocaba iOS. Este es el
  // primero que lo toca. Pasándole la MISMA constante que `ios.infoPlist`, el resultado no depende del
  // orden de los mods de Expo, y las dos no pueden divergir sin que este assert caiga.
  for (const variant of ALL_VARIANTS) {
    const c = build(variant);
    const declared = (c.ios?.infoPlist as Record<string, unknown> | undefined)?.NSBluetoothAlwaysUsageDescription;
    assert.equal(typeof declared, 'string');
    assert.equal(
      pluginOptions(c, 'react-native-ble-plx')?.bluetoothAlwaysPermission,
      declared,
      `el plugin de BLE escribiría un texto distinto del declarado (variant=${variant})`,
    );
    assert.equal(/allow .*to connect to bluetooth/i.test(String(declared)), false, 'quedó el default en inglés de la lib');
  }
});

test('RBM4.3: `UISupportedExternalAccessoryProtocols` sigue declarada (y vacía) con la dep de BLE instalada', () => {
  // El delta de BLE no puede tocar la clave del MFi: la lista VACÍA es el guard anti-crash del
  // force-cast del `init()` de `react-native-bluetooth-classic` (`nil as! [String]` trapea). Se asertá
  // acá además del guard de purpose strings porque el cambio que la rompería es de ESTE archivo.
  for (const variant of ALL_VARIANTS) {
    const info = build(variant).ios?.infoPlist as Record<string, unknown> | undefined;
    const value = info?.UISupportedExternalAccessoryProtocols;
    assert.ok(Array.isArray(value), `UISupportedExternalAccessoryProtocols no es un array (variant=${variant})`);
    assert.deepEqual(value, [], 'sigue vacía hasta que llegue la cadena iAP del fabricante (RBM4.6)');
  }
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

test('ITMS-90683: las dos purpose strings de Bluetooth están declaradas y NO vacías, en TODA variante', () => {
  // El defecto real del build 5 de iOS (2026-08-10): el bundle no traía NINGÚN purpose string. Son dos
  // consecuencias distintas y solo una es incondicional:
  //  · el validador de App Store Connect RECHAZA la entrega si la clave no está (ITMS-90683). No depende
  //    de que la app ejecute nada: alcanza con que el binario linkee CoreBluetooth. Esto es lo que pasó.
  //  · instanciar el manager de CoreBluetooth sin la clave ABORTA el proceso — pero para eso la app tiene
  //    que llegar a montarlo, y en iOS hoy no llega: no hay transporte iOS (`selectTransportAdapter`
  //    devuelve `manual`), así que la pantalla del bastón en iPhone es manual-first.
  //
  // Se recorren TODAS las variantes a propósito: el build que Raf instala en el teléfono es el `dev`, así
  // que declarar la clave solo en una rama del ternario sería el mismo agujero con otra cara.
  //
  // Un string VACÍO pasaría un `'X' in infoPlist` y sería exactamente el bug (iOS trata la clave vacía
  // como ausente): por eso se verifica el CONTENIDO, no la presencia.
  for (const variant of [undefined, 'development', 'preview', 'production']) {
    const info = build(variant).ios?.infoPlist as Record<string, unknown> | undefined;
    for (const key of ['NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription']) {
      const value = info?.[key];
      assert.equal(typeof value, 'string', `falta \`${key}\` en ios.infoPlist (variant=${variant})`);
      assert.ok(
        typeof value === 'string' && value.trim().length > 0,
        `\`${key}\` está vacía (variant=${variant}): para iOS es lo mismo que no declararla`,
      );
    }
  }
});

test('R2.5: extra.supabaseUrl eliminado (grep sin consumidores); extra.router/eas conservados', () => {
  const extra = build(undefined).extra as Record<string, unknown> | undefined;
  assert.equal(extra?.supabaseUrl, undefined);
  assert.ok(extra && 'router' in extra);
  assert.ok(extra && 'eas' in extra);
});
