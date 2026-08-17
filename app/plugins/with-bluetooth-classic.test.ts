// Tests de la política de permisos Bluetooth del config plugin (RMV5.8). node:test, sin Expo.
//
// Importa el `.js` del plugin: `expo/config-plugins` se requiere PEREZOSAMENTE dentro de la función
// del plugin, así que importar el módulo para testear la parte pura no carga Expo.
//
// Este test es el que impide que la política se degrade en silencio. En particular el tope de
// `ACCESS_FINE_LOCATION`: la lib nativa lo declara SIN tope y el manifest merger lo mete solo — si
// alguien borra este plugin, la app pasa a pedir permiso de UBICACIÓN sin usarlo y nadie se entera
// hasta la revisión de Play.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import plugin from './with-bluetooth-classic.js';
import expoConfig from '../app.config.ts';

const { applyBluetoothPermissions } = plugin as unknown as {
  applyBluetoothPermissions: (m: AndroidManifestLike) => AndroidManifestLike;
};

interface PermissionEntry {
  $: Record<string, string>;
}
interface AndroidManifestLike {
  manifest: {
    $?: Record<string, string>;
    'uses-permission'?: PermissionEntry[];
  };
}

function emptyManifest(): AndroidManifestLike {
  return { manifest: { $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' } } };
}

function permissionsOf(m: AndroidManifestLike): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const entry of m.manifest['uses-permission'] ?? []) out[entry.$['android:name']] = entry.$;
  return out;
}

test('RMV5.8: declara BLUETOOTH_CONNECT sin tope de API (Android 12+ lo exige en runtime)', () => {
  const perms = permissionsOf(applyBluetoothPermissions(emptyManifest()));
  const connect = perms['android.permission.BLUETOOTH_CONNECT'];
  assert.ok(connect, 'falta BLUETOOTH_CONNECT');
  assert.equal(connect['android:maxSdkVersion'], undefined);
});

test('RMV5.8: BLUETOOTH_SCAN va con neverForLocation (no se usa para derivar ubicación)', () => {
  const perms = permissionsOf(applyBluetoothPermissions(emptyManifest()));
  assert.equal(
    perms['android.permission.BLUETOOTH_SCAN']?.['android:usesPermissionFlags'],
    'neverForLocation',
  );
});

test('RMV5.8: BLUETOOTH y BLUETOOTH_ADMIN quedan topeados a Android 11 (API 30)', () => {
  const perms = permissionsOf(applyBluetoothPermissions(emptyManifest()));
  assert.equal(perms['android.permission.BLUETOOTH']?.['android:maxSdkVersion'], '30');
  assert.equal(perms['android.permission.BLUETOOTH_ADMIN']?.['android:maxSdkVersion'], '30');
});

test('RMV5.8: ACCESS_FINE_LOCATION queda topeado a API 30 y con tools:node=replace', () => {
  // La lib lo declara SIN tope; `replace` es lo que hace la resolución determinística en el merger
  // en vez de depender de cómo combine atributos entre dos declaraciones.
  const perms = permissionsOf(applyBluetoothPermissions(emptyManifest()));
  const location = perms['android.permission.ACCESS_FINE_LOCATION'];
  assert.ok(location, 'falta la declaración que topea la ubicación');
  assert.equal(location['android:maxSdkVersion'], '30');
  assert.equal(location['tools:node'], 'replace');
});

test('RMV5.8: se declara el namespace tools (sin él, tools:node rompe el build)', () => {
  const m = applyBluetoothPermissions(emptyManifest());
  assert.equal(m.manifest.$?.['xmlns:tools'], 'http://schemas.android.com/tools');
});

test('no se pide NINGÚN permiso de ubicación sin tope (la app de ganado no usa ubicación)', () => {
  const perms = permissionsOf(applyBluetoothPermissions(emptyManifest()));
  for (const [name, attrs] of Object.entries(perms)) {
    if (!name.includes('LOCATION')) continue;
    assert.ok(attrs['android:maxSdkVersion'], `${name} entra sin tope de API`);
  }
});

test('idempotente: correrlo dos veces (prebuild re-corrido) no duplica entradas', () => {
  const once = applyBluetoothPermissions(emptyManifest());
  const countOnce = once.manifest['uses-permission']?.length ?? 0;
  const twice = applyBluetoothPermissions(once);
  assert.equal(twice.manifest['uses-permission']?.length, countOnce);
});

test('preserva los permisos que ya estaban (no pisa la lista de la app)', () => {
  const m = emptyManifest();
  m.manifest['uses-permission'] = [{ $: { 'android:name': 'android.permission.POST_NOTIFICATIONS' } }];
  const perms = permissionsOf(applyBluetoothPermissions(m));
  assert.ok(perms['android.permission.POST_NOTIFICATIONS'], 'se perdió un permiso preexistente');
  assert.ok(perms['android.permission.BLUETOOTH_CONNECT']);
});

test('upsert: si el permiso ya existía SIN atributos, se le agregan los nuestros', () => {
  const m = emptyManifest();
  m.manifest['uses-permission'] = [{ $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } }];
  const perms = permissionsOf(applyBluetoothPermissions(m));
  assert.equal(perms['android.permission.ACCESS_FINE_LOCATION']['android:maxSdkVersion'], '30');
  assert.equal(m.manifest['uses-permission']?.length, 5, 'no se duplicó la entrada existente');
});

test('un manifiesto malformado no tira (el plugin no puede romper el prebuild)', () => {
  assert.doesNotThrow(() => applyBluetoothPermissions({} as AndroidManifestLike));
  assert.doesNotThrow(() => applyBluetoothPermissions(null as unknown as AndroidManifestLike));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// LA POLÍTICA **COMBINADA** con el plugin de `react-native-ble-plx` (spec 04, delta ios-ble-mfi:
// T2.7 / RBM2.13, RBM2.15)
//
// POR QUÉ HACE FALTA ESTO Y NO ALCANZA CON LOS TESTS DE ARRIBA: los de arriba miran SOLO la salida de
// nuestro plugin, y el permiso que hay que vigilar ahora lo escribe OTRO plugin (el de la lib de BLE) en
// OTRO array del manifiesto (`uses-permission-sdk-23`, no `uses-permission`). O sea: el test que decía
// "no hay ubicación sin tope" era **estructuralmente ciego** al permiso nuevo. Esto compone las dos
// transformaciones puras —las de verdad, importadas del paquete instalado, no una copia a mano— y
// verifica el invariante sobre TODOS los arrays de permisos.
//
// Y toma las opciones del `app.config.ts` REAL: si alguien saca `neverForLocation` o prende el
// background, el que cae es este test, no la revisión de Play tres semanas después.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

const requireCjs = createRequire(import.meta.url);

interface VendorBleManifestPlugin {
  addLocationPermissionToManifest: (m: unknown, neverForLocation: boolean) => unknown;
  addScanPermissionToManifest: (m: unknown, neverForLocation: boolean) => unknown;
  addBLEHardwareFeatureToManifest: (m: unknown) => unknown;
}

/** Las transformaciones REALES del plugin de la lib (`plugin/build/withBLEAndroidManifest.js`). */
function vendorBlePlugin(): VendorBleManifestPlugin {
  return requireCjs('react-native-ble-plx/plugin/build/withBLEAndroidManifest') as VendorBleManifestPlugin;
}

/** `AndroidConfig.Permissions.ensurePermissions` — lo que el plugin de la lib usa para los BLUETOOTH_*. */
function ensureVendorPermissions(manifest: AndroidManifestLike): void {
  const { AndroidConfig } = requireCjs('@expo/config-plugins') as {
    AndroidConfig: { Permissions: { ensurePermissions: (m: unknown, p: string[]) => unknown } };
  };
  AndroidConfig.Permissions.ensurePermissions(manifest, [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT',
  ]);
}

/** Las opciones con las que `app.config.ts` engancha el plugin de la lib de BLE. */
function bleplxOptions(): Record<string, unknown> {
  const entry = (expoConfig().plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'react-native-ble-plx');
  assert.ok(Array.isArray(entry), 'el plugin de `react-native-ble-plx` no está enganchado en app.config.ts');
  return (entry as [string, Record<string, unknown>])[1] ?? {};
}

interface ManifestWithSdk23 extends AndroidManifestLike {
  manifest: AndroidManifestLike['manifest'] & {
    'uses-permission-sdk-23'?: PermissionEntry[];
    'uses-feature'?: PermissionEntry[];
  };
}

/** TODOS los permisos declarados, de CUALQUIER array (`uses-permission` + `uses-permission-sdk-23`). */
function allPermissions(m: ManifestWithSdk23): { array: string; name: string; attrs: Record<string, string> }[] {
  const out: { array: string; name: string; attrs: Record<string, string> }[] = [];
  for (const array of ['uses-permission', 'uses-permission-sdk-23'] as const) {
    for (const entry of (m.manifest as Record<string, PermissionEntry[] | undefined>)[array] ?? []) {
      out.push({ array, name: entry.$['android:name'], attrs: entry.$ });
    }
  }
  return out;
}

/** El manifiesto que sale de aplicar los DOS plugins, en el orden pedido. */
function combinedManifest(order: 'ours-first' | 'theirs-first'): ManifestWithSdk23 {
  const vendor = vendorBlePlugin();
  const neverForLocation = bleplxOptions().neverForLocation === true;
  const isBackgroundEnabled = bleplxOptions().isBackgroundEnabled === true;
  const m = emptyManifest() as ManifestWithSdk23;

  const applyTheirs = () => {
    vendor.addLocationPermissionToManifest(m, neverForLocation);
    vendor.addScanPermissionToManifest(m, neverForLocation);
    ensureVendorPermissions(m);
    // Solo corre con el background prendido — que es justo lo que NO queremos (RBM2.15).
    if (isBackgroundEnabled) vendor.addBLEHardwareFeatureToManifest(m);
  };
  const applyOurs = () => applyBluetoothPermissions(m);

  if (order === 'ours-first') {
    applyOurs();
    applyTheirs();
  } else {
    applyTheirs();
    applyOurs();
  }
  return m;
}

const ORDERS: ('ours-first' | 'theirs-first')[] = ['ours-first', 'theirs-first'];

test('T2.7/RBM2.13: con los DOS plugins aplicados, NINGÚN permiso de ubicación entra sin tope de API', () => {
  // El invariante que la app compró en el multivendor, ahora barrido sobre los dos arrays. El permiso
  // nuevo es `ACCESS_COARSE_LOCATION` en `uses-permission-sdk-23`, que el test viejo no podía ver.
  for (const order of ORDERS) {
    const perms = allPermissions(combinedManifest(order));
    const location = perms.filter((p) => p.name.includes('LOCATION'));
    assert.ok(location.length > 0, `no se vio NINGÚN permiso de ubicación (${order}): el test no probaría nada`);
    for (const p of location) {
      assert.equal(
        p.attrs['android:maxSdkVersion'],
        '30',
        `${p.name} entra sin tope de API en <${p.array}> (orden ${order})`,
      );
    }
  }
});

test('T2.7/RBM2.13: los permisos declarados ALCANZAN para el escaneo BLE (y no hace falta cambiar la política)', () => {
  // La pregunta literal de T2.7. API ≥ 31 → `BLUETOOTH_SCAN` (con `neverForLocation`) + `BLUETOOTH_CONNECT`
  // sin tope; API ≤ 30 → `ACCESS_FINE_LOCATION` + `BLUETOOTH_ADMIN` (el que habilita `startScan` en el
  // modelo viejo). Los cuatro ya estaban declarados antes de este delta: lo único que cambió es que
  // ahora se PIDEN en runtime (`permissions-android.ts`).
  for (const order of ORDERS) {
    const byName = new Map(allPermissions(combinedManifest(order)).map((p) => [p.name, p.attrs]));

    const scan = byName.get('android.permission.BLUETOOTH_SCAN');
    assert.ok(scan, `falta BLUETOOTH_SCAN (${order})`);
    assert.equal(scan?.['android:usesPermissionFlags'], 'neverForLocation', `SCAN sin neverForLocation (${order})`);
    assert.equal(scan?.['android:maxSdkVersion'], undefined, `SCAN topeado (${order}): es el permiso de API 31+`);

    const connect = byName.get('android.permission.BLUETOOTH_CONNECT');
    assert.ok(connect, `falta BLUETOOTH_CONNECT (${order})`);
    assert.equal(connect?.['android:maxSdkVersion'], undefined, `CONNECT topeado (${order})`);

    assert.equal(byName.get('android.permission.ACCESS_FINE_LOCATION')?.['android:maxSdkVersion'], '30');
    assert.equal(byName.get('android.permission.BLUETOOTH_ADMIN')?.['android:maxSdkVersion'], '30');
    assert.equal(byName.get('android.permission.BLUETOOTH')?.['android:maxSdkVersion'], '30');
  }
});

test('T2.7: el orden de los dos plugins NO cambia la POLÍTICA (solo un atributo de lint)', () => {
  // Es lo que hace la verificación robusta en vez de una foto: Expo no garantiza en qué orden se
  // aplican dos `withAndroidManifest`, y el `ensurePermissions` de la lib agrega BLUETOOTH/ADMIN SIN
  // tope si corre primero. Nuestro plugin hace UPSERT, así que los vuelve a topear — en los dos órdenes.
  //
  // ⚠️ MEDIDO, no supuesto: los dos órdenes NO dan un manifiesto byte-idéntico. Cuando el plugin de la
  // lib corre primero, su `BLUETOOTH_SCAN` viene con `tools:targetApi="31"` y el nuestro (que hace
  // upsert de `usesPermissionFlags`) no lo agrega. Esa diferencia es de LINT, no de política:
  // `tools:*` son instrucciones para el manifest merger / Lint y no sobreviven al manifiesto final
  // (verificado en el manifiesto MERGEADO del build de T2.8). Por eso se compara la política
  // —`android:*`— y la diferencia de lint queda declarada acá en vez de tapada con un `deepEqual` laxo.
  const POLICY_ATTR = /^android:/;
  const policy = (m: ManifestWithSdk23) =>
    allPermissions(m)
      .map((p) => {
        const attrs = Object.entries(p.attrs)
          .filter(([k]) => POLICY_ATTR.test(k) || k === 'tools:node')
          .sort();
        return `${p.array}|${p.name}|${JSON.stringify(attrs)}`;
      })
      .sort();
  assert.deepEqual(policy(combinedManifest('ours-first')), policy(combinedManifest('theirs-first')));

  // Y la diferencia de lint, nombrada (si desapareciera, este assert avisa y se puede simplificar).
  const lintAttrs = (m: ManifestWithSdk23) =>
    allPermissions(m)
      .flatMap((p) => Object.keys(p.attrs).filter((k) => k.startsWith('tools:') && k !== 'tools:node').map((k) => `${p.name}|${k}`))
      .sort();
  assert.deepEqual(lintAttrs(combinedManifest('ours-first')), []);
  assert.deepEqual(lintAttrs(combinedManifest('theirs-first')), [
    'android.permission.BLUETOOTH_SCAN|tools:targetApi',
  ]);
});

test('RBM2.15: sin background, el plugin de la lib NO declara `uses-feature bluetooth_le required=true`', () => {
  // `addBLEHardwareFeatureToManifest` solo corre con `isBackgroundEnabled: true`. Además de ser una
  // capacidad que no usamos, ese `required="true"` excluye de Google Play a los devices sin BLE.
  assert.equal(bleplxOptions().isBackgroundEnabled, false, 'el background BLE quedó habilitado en app.config.ts');
  for (const order of ORDERS) {
    const m = combinedManifest(order);
    assert.equal(m.manifest['uses-feature'], undefined, `apareció un uses-feature de BLE (${order})`);
  }
});

test('FALSIFICACIÓN: con `neverForLocation: false` (el DEFAULT de la lib) el invariante SE ROMPE', () => {
  // Sin esto, los tests de arriba podrían estar pasando por casualidad. Acá se ejecuta el mundo malo:
  // es exactamente lo que habría pasado enganchando el plugin sin opciones, y muestra que la línea
  // `neverForLocation: true` de `app.config.ts` es la que sostiene la política.
  const vendor = vendorBlePlugin();
  const m = emptyManifest() as ManifestWithSdk23;
  applyBluetoothPermissions(m);
  vendor.addLocationPermissionToManifest(m, false);
  vendor.addScanPermissionToManifest(m, false);

  const sinTope = allPermissions(m).filter(
    (p) => p.name.includes('LOCATION') && p.attrs['android:maxSdkVersion'] === undefined,
  );
  // MEDIDO (y peor de lo que yo había supuesto al escribir el test): entran DOS permisos de ubicación
  // sin tope, no uno. `ACCESS_FINE_LOCATION` sin tope aparece igual aunque nuestro plugin lo topee,
  // porque el de la lib lo escribe en el OTRO array (`uses-permission-sdk-23`) y el `tools:node=replace`
  // nuestro aplica al elemento `uses-permission`, no a ese. Es exactamente el punto ciego que este
  // bloque vino a cerrar.
  assert.deepEqual(
    sinTope.map((p) => `${p.array}|${p.name}`),
    [
      'uses-permission-sdk-23|android.permission.ACCESS_COARSE_LOCATION',
      'uses-permission-sdk-23|android.permission.ACCESS_FINE_LOCATION',
    ],
    'el mundo malo dejó de ser malo: revisá si el default de la lib cambió (y entonces por qué el ' +
      'assert de `neverForLocation` sigue haciendo falta)',
  );
});
