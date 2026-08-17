// Tests de la decisión PURA de permisos Bluetooth de Android (R12.1, RMV5.8, RBM2.13). node:test,
// sin RN. La solicitud real (`PermissionsAndroid`) es device-gated; lo que se testea acá es QUÉ se
// pide en cada (nivel de API, TRANSPORTE) y CÓMO se lee el resultado — que es donde se cometen los
// errores.
//
// Desde el delta `ios-ble-mfi` (F2 / RBM2.13) la decisión es **por transporte**: el `spp` no
// descubre (lista los emparejados) y el `ble-gatt` escanea, que es el camino que exige
// `BLUETOOTH_SCAN` en Android 12+ y `ACCESS_FINE_LOCATION` en Android ≤ 11. La mitad más importante
// de este archivo es la **regresión del `spp`**: su conjunto no cambió.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANDROID_API_BLUETOOTH_RUNTIME,
  ANDROID_BLUETOOTH_PERMISSIONS,
  PERMISSION_ACCESS_FINE_LOCATION,
  PERMISSION_BLUETOOTH_CONNECT,
  PERMISSION_BLUETOOTH_SCAN,
  androidBluetoothPermissionsFor,
  classifyPermissionChecks,
  classifyPermissionResults,
  checkAndroidBluetoothPermissions,
  ensureAndroidBluetoothPermissions,
  hasAndroidPermissionPolicy,
} from './permissions-android.ts';
import { DRIVER_REGISTRY } from './driver-registry.ts';
import type { TransportKind } from './driver-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Los dos regímenes que se cruzan con cada transporte. */
const LEGACY_APIS = [24, 26, 29, 30];
const MODERN_APIS = [31, 33, 34, 35, 36];

// ─── RBM2.13: la tabla es EXHAUSTIVA por TransportKind (guard sobre la AUSENCIA) ──────────────

/**
 * Extrae los miembros del union `TransportKind` del FUENTE de `driver-types.ts`. El oráculo fuerte de
 * exhaustividad es el `satisfies Record<TransportKind, …>` del módulo (lo corre `tsc`, que sí compila
 * el código de producción); esto lo duplica **en la suite**, que es lo que corre en cada `check.mjs`,
 * para que un transporte nuevo sin fila nazca en rojo también acá.
 */
function transportKindsFromSource(): string[] {
  const src = readFileSync(join(HERE, 'driver-types.ts'), 'utf8');
  const m = /export type TransportKind =([^;]+);/.exec(src);
  assert.ok(m, 'no se encontró la declaración de `TransportKind` en driver-types.ts');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

test('META: el extractor de `TransportKind` NO está ciego (si lo estuviera, el guard de abajo pasaría por no mirar nada)', () => {
  const kinds = transportKindsFromSource();
  assert.ok(kinds.length >= 5, `el extractor vio ${kinds.length} transportes: el regex se rompió`);
  for (const expected of ['spp', 'serial', 'ble-gatt', 'ble-hid', 'mfi']) {
    assert.ok(kinds.includes(expected), `el extractor no vio '${expected}'`);
  }
});

test('RBM2.13 (GUARD): TODO `TransportKind` tiene su fila declarada en la tabla de permisos', () => {
  // Sobre la AUSENCIA: no enumera "los transportes que conocemos", los deriva del tipo. Un
  // transporte nuevo cae acá sin que nadie actualice el test.
  assert.deepEqual(Object.keys(ANDROID_BLUETOOTH_PERMISSIONS).sort(), transportKindsFromSource());
});

test('RBM2.13: todo transporte que un driver REAL declara tiene fila (derivado del registro, no de una lista)', () => {
  const declarados = [...new Set(DRIVER_REGISTRY.flatMap((d) => d.transports.map((t) => t.kind)))];
  assert.ok(declarados.length > 0, 'ningún driver del registro declara transportes: el test no probaría nada');
  for (const kind of declarados) {
    assert.ok(kind in ANDROID_BLUETOOTH_PERMISSIONS, `el transporte '${kind}' del registro no tiene fila de permisos`);
  }
});

test('RBM2.13: `transport` es un parámetro REQUERIDO (sin default) en las tres funciones', () => {
  // Oráculo de COMPORTAMIENTO, no un regex: `Function.length` NO cuenta los parámetros con default,
  // así que un `transport: TransportKind = "spp"` —el fallback silencioso que este delta prohíbe,
  // misma familia que el `?? DRIVER_REGISTRY[0].frameParser` que el review de F1 rechazó— baja la
  // aridad y cae acá.
  assert.equal(androidBluetoothPermissionsFor.length, 2, 'androidBluetoothPermissionsFor perdió un parámetro requerido');
  assert.equal(ensureAndroidBluetoothPermissions.length, 1, 'ensureAndroidBluetoothPermissions perdió su transporte requerido');
  assert.equal(checkAndroidBluetoothPermissions.length, 1, 'checkAndroidBluetoothPermissions perdió su transporte requerido');
});

// ─── R12.1 / RBM2.13: REGRESIÓN del `spp` — su conjunto NO cambió ────────────────────────────

test('R12.1 (regresión spp): Android 12+ (API 31+) pide BLUETOOTH_CONNECT y NADA más', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(31, 'spp'), [PERMISSION_BLUETOOTH_CONNECT]);
  assert.deepEqual(androidBluetoothPermissionsFor(34, 'spp'), [PERMISSION_BLUETOOTH_CONNECT]);
  assert.equal(ANDROID_API_BLUETOOTH_RUNTIME, 31);
});

test('R12.1 (regresión spp): Android 11 y anteriores NO piden nada en runtime (BLUETOOTH/ADMIN son de instalación)', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(30, 'spp'), []);
  assert.deepEqual(androidBluetoothPermissionsFor(24, 'spp'), []);
});

test('R12 (regresión spp): NUNCA se pide ubicación ni BLUETOOTH_SCAN (ese camino no hace discovery)', () => {
  for (const api of [...LEGACY_APIS, ...MODERN_APIS]) {
    const perms = androidBluetoothPermissionsFor(api, 'spp');
    assert.equal(perms.some((p) => p.includes('LOCATION')), false, `API ${api} no debe pedir ubicación`);
    assert.equal(perms.some((p) => p.includes('BLUETOOTH_SCAN')), false, `API ${api} no debe pedir SCAN`);
  }
});

test('R12 (regresión spp): un apiLevel no numérico no rompe (lista vacía, no crash)', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(Number.NaN, 'spp'), []);
  assert.deepEqual(androidBluetoothPermissionsFor(undefined as unknown as number, 'spp'), []);
});

// ─── RBM2.13: el transporte `ble-gatt` ───────────────────────────────────────────────────────

test('RBM2.13: `ble-gatt` en API ≥ 31 pide BLUETOOTH_SCAN + BLUETOOTH_CONNECT', () => {
  for (const api of MODERN_APIS) {
    assert.deepEqual(
      androidBluetoothPermissionsFor(api, 'ble-gatt'),
      [PERMISSION_BLUETOOTH_SCAN, PERMISSION_BLUETOOTH_CONNECT],
      `API ${api}`,
    );
  }
});

test('RBM2.13: `ble-gatt` en API ≤ 30 pide ACCESS_FINE_LOCATION (el escaneo BLE lo exige) y NO los BLUETOOTH_*', () => {
  for (const api of LEGACY_APIS) {
    const perms = androidBluetoothPermissionsFor(api, 'ble-gatt');
    assert.deepEqual(perms, [PERMISSION_ACCESS_FINE_LOCATION], `API ${api}`);
    // Los permisos `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` NO EXISTEN antes de API 31: pedirlos ahí
    // devuelve "denegado" sin diálogo y dejaría el transporte muerto en un Android 11.
    assert.equal(perms.includes(PERMISSION_BLUETOOTH_SCAN), false, `API ${api} pidió SCAN, que no existe todavía`);
    assert.equal(perms.includes(PERMISSION_BLUETOOTH_CONNECT), false, `API ${api} pidió CONNECT, que no existe todavía`);
  }
});

test('RBM2.13: `ble-gatt` en API ≥ 31 NO pide ubicación (está topeada a maxSdkVersion=30 en el manifiesto)', () => {
  // Si esto se rompiera, el pedido sería de un permiso que la app **no declara** en API ≥ 31 →
  // denegado sin diálogo → transporte muerto, con el síntoma "el escaneo no encuentra nada".
  for (const api of MODERN_APIS) {
    const perms = androidBluetoothPermissionsFor(api, 'ble-gatt');
    assert.equal(perms.some((p) => p.includes('LOCATION')), false, `API ${api} pidió ubicación`);
  }
});

test('RBM2.13: el borde exacto es 31 (30 = viejo, 31 = nuevo) en los DOS transportes', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(30, 'ble-gatt'), [PERMISSION_ACCESS_FINE_LOCATION]);
  assert.deepEqual(androidBluetoothPermissionsFor(31, 'ble-gatt'), [
    PERMISSION_BLUETOOTH_SCAN,
    PERMISSION_BLUETOOTH_CONNECT,
  ]);
  assert.deepEqual(androidBluetoothPermissionsFor(30, 'spp'), []);
  assert.deepEqual(androidBluetoothPermissionsFor(31, 'spp'), [PERMISSION_BLUETOOTH_CONNECT]);
});

test('RBM2.13: los conjuntos de `spp` y `ble-gatt` son DISTINTOS (si fueran iguales, la tabla no serviría de nada)', () => {
  // Contraprueba de vacuidad: un mutante que devuelva siempre el conjunto del `spp` pasaría TODOS
  // los tests de regresión de arriba y ninguno de los de `ble-gatt`. Este lo dice explícito.
  assert.notDeepEqual(
    androidBluetoothPermissionsFor(33, 'ble-gatt'),
    androidBluetoothPermissionsFor(33, 'spp'),
  );
  assert.notDeepEqual(
    androidBluetoothPermissionsFor(29, 'ble-gatt'),
    androidBluetoothPermissionsFor(29, 'spp'),
  );
});

// ─── RBM2.13: los transportes SIN permisos de Android, declarados y no olvidados ─────────────

test('RBM2.13: `serial`, `ble-hid` y `mfi` no piden NINGÚN permiso de Android, en ningún nivel de API', () => {
  // Son decisiones escritas (ver la cabecera del módulo): `serial` es Web Serial (navegador),
  // `ble-hid` es un teclado que el SO ya emparejó, y `mfi` no existe en Android.
  for (const transport of ['serial', 'ble-hid', 'mfi'] as TransportKind[]) {
    for (const api of [...LEGACY_APIS, ...MODERN_APIS]) {
      assert.deepEqual(androidBluetoothPermissionsFor(api, transport), [], `${transport} / API ${api}`);
    }
  }
});

test('RBM2.13 (fail-closed): un transporte que NO está en la tabla no cae al conjunto de otro', () => {
  // Solo puede llegar por un cast desde JS sin tipos. Lo que importa es que NO herede el conjunto
  // del `spp` (que sería el fallback "cómodo"): si no sabemos qué pedir, no pedimos el de otro.
  const desconocido = androidBluetoothPermissionsFor(33, 'ble-mesh' as TransportKind);
  assert.deepEqual(desconocido, []);
  assert.notDeepEqual(desconocido, androidBluetoothPermissionsFor(33, 'spp'));
});

test('RBM2.13: un `transport` que cae en una clave del PROTOTIPO no tira (superficie hostil)', () => {
  // Encontrado en la autorrevisión: la tabla se indexa por string, así que `'constructor'` o
  // `'toString'` devuelven un valor que NO es `undefined` (viene del prototipo) y el spread de su
  // `.modern` inexistente reventaba con "undefined is not iterable" — un crash, no un rechazo. Se
  // cierra con `hasOwnProperty`. Solo llega por un cast desde JS sin tipos, pero un crash en el camino
  // de permisos se lleva puesta la conexión del bastón entera.
  for (const clave of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.deepEqual(androidBluetoothPermissionsFor(33, clave as TransportKind), [], clave);
    assert.deepEqual(androidBluetoothPermissionsFor(29, clave as TransportKind), [], clave);
    assert.equal(hasAndroidPermissionPolicy(clave as TransportKind), false, clave);
  }
});

test('RBM2.13 (fail-closed): "no hay política" NO es lo mismo que "no hace falta nada"', async () => {
  // El agujero que esto cierra: los consumidores leen `[]` como CONCEDIDO
  // (`classifyPermissionResults([], …) === 'granted'`), así que un transporte desconocido —cuyo
  // conjunto también es `[]`— habría quedado "concedido" sin que nadie sepa qué pide. La distinción no
  // cabe en un `string[]`: la resuelve `hasAndroidPermissionPolicy`, que es lo que los dos caminos
  // asincrónicos consultan ANTES de tocar RN.
  for (const transport of Object.keys(ANDROID_BLUETOOTH_PERMISSIONS) as TransportKind[]) {
    assert.equal(hasAndroidPermissionPolicy(transport), true, transport);
  }
  assert.equal(hasAndroidPermissionPolicy('ble-mesh' as TransportKind), false);
  // Y los dos casos que se leen igual en el resultado pero significan cosas distintas:
  assert.equal(classifyPermissionResults(androidBluetoothPermissionsFor(33, 'mfi'), {}), 'granted');
  assert.equal(hasAndroidPermissionPolicy('mfi'), true, 'el `mfi` NO pide nada, pero su política ESTÁ declarada');
  // Ojo con el oráculo: `ensure…`/`check…` devuelven 'unavailable' en node por OTRA razón (no resuelve
  // `react-native`), así que desde acá NO se puede distinguir la rama nueva por su valor de retorno.
  // El oráculo verificable de esa rama es el predicado puro de arriba; queda dicho en vez de fingido.
  assert.equal(await ensureAndroidBluetoothPermissions('ble-mesh' as TransportKind), 'unavailable');
  assert.equal(await checkAndroidBluetoothPermissions('ble-mesh' as TransportKind), 'unavailable');
});

test('RBM2.13: la tabla no se puede mutar desde afuera (el llamador recibe una COPIA)', () => {
  // `androidBluetoothPermissionsFor` devuelve un array nuevo: un consumidor que le haga `.push()`
  // al resultado no puede corromper la política para el resto de la app.
  const first = androidBluetoothPermissionsFor(33, 'ble-gatt');
  first.push('android.permission.CAMERA');
  assert.deepEqual(androidBluetoothPermissionsFor(33, 'ble-gatt'), [
    PERMISSION_BLUETOOTH_SCAN,
    PERMISSION_BLUETOOTH_CONNECT,
  ]);
});

// ─── Lectura del resultado: fail-closed ──────────────────────────────────────────────────────

test('todos concedidos → granted', () => {
  assert.equal(
    classifyPermissionResults([PERMISSION_BLUETOOTH_CONNECT], { [PERMISSION_BLUETOOTH_CONNECT]: 'granted' }),
    'granted',
  );
});

test('fail-closed: denied / never_ask_again / clave ausente / valor raro → denied', () => {
  const p = PERMISSION_BLUETOOTH_CONNECT;
  assert.equal(classifyPermissionResults([p], { [p]: 'denied' }), 'denied');
  assert.equal(classifyPermissionResults([p], { [p]: 'never_ask_again' }), 'denied');
  assert.equal(classifyPermissionResults([p], {}), 'denied');
  assert.equal(classifyPermissionResults([p], { [p]: 'GRANTED' }), 'denied'); // case distinto ≠ granted
  assert.equal(classifyPermissionResults([p], null), 'denied');
  assert.equal(classifyPermissionResults([p], undefined), 'denied');
});

test('si NO hay permisos requeridos, el resultado es granted aunque el mapa venga vacío o nulo', () => {
  assert.equal(classifyPermissionResults([], {}), 'granted');
  assert.equal(classifyPermissionResults([], null), 'granted');
});

test('con VARIOS permisos requeridos, uno solo denegado alcanza para denied', () => {
  const results = { a: 'granted', b: 'denied' };
  assert.equal(classifyPermissionResults(['a', 'b'], results), 'denied');
  assert.equal(classifyPermissionResults(['a'], results), 'granted');
});

// ─── RMV5.6: importable y llamable sin RN (web/CI) ───────────────────────────────────────────

test('RMV5.6: ensureAndroidBluetoothPermissions no tira sin RN → "unavailable" (para TODO transporte)', async () => {
  // En node no resuelve `react-native` → el require perezoso cae al catch. Nunca propaga: un fallo
  // de permisos no puede romper la app (manual-first, R7.2). Se barren todos los transportes: el
  // transporte nuevo tampoco puede tirar en web/CI.
  for (const transport of Object.keys(ANDROID_BLUETOOTH_PERMISSIONS) as TransportKind[]) {
    assert.equal(await ensureAndroidBluetoothPermissions(transport), 'unavailable', transport);
  }
});

// ─── R6.4: CONSULTAR el permiso sin pedirlo (el camino que no pidió el operario) ──────────────

test('R6.4: classifyPermissionChecks es fail-closed — un permiso ausente NO se asume concedido', () => {
  // Es la misma regla que `classifyPermissionResults` y por el mismo motivo: un resultado que no
  // entendemos no puede interpretarse como "sí". Acá el mapa viene de `PermissionsAndroid.check`,
  // que devuelve booleanos.
  assert.equal(classifyPermissionChecks([PERMISSION_BLUETOOTH_CONNECT], { [PERMISSION_BLUETOOTH_CONNECT]: true }), 'granted');
  assert.equal(classifyPermissionChecks([PERMISSION_BLUETOOTH_CONNECT], { [PERMISSION_BLUETOOTH_CONNECT]: false }), 'denied');
  assert.equal(classifyPermissionChecks([PERMISSION_BLUETOOTH_CONNECT], {}), 'denied', 'ausente = denegado');
  assert.equal(classifyPermissionChecks([PERMISSION_BLUETOOTH_CONNECT], null), 'denied');
  assert.equal(classifyPermissionChecks([PERMISSION_BLUETOOTH_CONNECT], undefined), 'denied');
  // Un valor que no es `true` estricto tampoco alcanza (el nativo podría devolver 'granted' string).
  assert.equal(
    classifyPermissionChecks([PERMISSION_BLUETOOTH_CONNECT], { [PERMISSION_BLUETOOTH_CONNECT]: 'granted' } as unknown as Record<string, boolean>),
    'denied',
  );
});

test('R6.4: sin permisos requeridos (API ≤ 30) el check dice granted', () => {
  assert.equal(classifyPermissionChecks([], {}), 'granted');
  assert.equal(classifyPermissionChecks([], null), 'granted');
});

test('R6.4: con VARIOS requeridos, uno solo sin conceder alcanza para denied', () => {
  assert.equal(classifyPermissionChecks(['a', 'b'], { a: true, b: false }), 'denied');
  assert.equal(classifyPermissionChecks(['a', 'b'], { a: true, b: true }), 'granted');
});

test('R6.4/RMV5.6: checkAndroidBluetoothPermissions no tira sin RN → "unavailable" (para TODO transporte)', async () => {
  // Mismo borde que `ensure…`: en node no resuelve `react-native`. 'unavailable' hace que el arranque
  // automático NO arranque, que es lo correcto: si no podemos saber si hay permiso, no tocamos nada.
  for (const transport of Object.keys(ANDROID_BLUETOOTH_PERMISSIONS) as TransportKind[]) {
    assert.equal(await checkAndroidBluetoothPermissions(transport), 'unavailable', transport);
  }
});
