// Tests de la decisión PURA de permisos Bluetooth de Android (R12.1, RMV5.8). node:test, sin RN.
// La solicitud real (`PermissionsAndroid`) es device-gated; lo que se testea acá es QUÉ se pide en
// cada nivel de API y CÓMO se lee el resultado — que es donde se cometen los errores.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANDROID_API_BLUETOOTH_RUNTIME,
  PERMISSION_BLUETOOTH_CONNECT,
  androidBluetoothPermissionsFor,
  classifyPermissionChecks,
  classifyPermissionResults,
  checkAndroidBluetoothPermissions,
  ensureAndroidBluetoothPermissions,
} from './permissions-android.ts';

// ─── R12.1: qué permisos pide cada nivel de API ──────────────────────────────────────────────

test('R12.1: Android 12+ (API 31+) pide BLUETOOTH_CONNECT en runtime', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(31), [PERMISSION_BLUETOOTH_CONNECT]);
  assert.deepEqual(androidBluetoothPermissionsFor(34), [PERMISSION_BLUETOOTH_CONNECT]);
  assert.equal(ANDROID_API_BLUETOOTH_RUNTIME, 31);
});

test('R12.1: Android 11 y anteriores NO piden nada en runtime (BLUETOOTH/ADMIN son de instalación)', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(30), []);
  assert.deepEqual(androidBluetoothPermissionsFor(24), []);
});

test('R12: NUNCA se pide ubicación ni BLUETOOTH_SCAN (este camino no hace discovery)', () => {
  for (const api of [24, 29, 30, 31, 33, 34, 35, 36]) {
    const perms = androidBluetoothPermissionsFor(api);
    assert.equal(perms.some((p) => p.includes('LOCATION')), false, `API ${api} no debe pedir ubicación`);
    assert.equal(perms.some((p) => p.includes('BLUETOOTH_SCAN')), false, `API ${api} no debe pedir SCAN`);
  }
});

test('R12: un apiLevel no numérico no rompe (lista vacía, no crash)', () => {
  assert.deepEqual(androidBluetoothPermissionsFor(Number.NaN), []);
  assert.deepEqual(androidBluetoothPermissionsFor(undefined as unknown as number), []);
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

test('RMV5.6: ensureAndroidBluetoothPermissions no tira sin RN → "unavailable"', async () => {
  // En node no resuelve `react-native` → el require perezoso cae al catch. Nunca propaga: un fallo
  // de permisos no puede romper la app (manual-first, R7.2).
  const outcome = await ensureAndroidBluetoothPermissions();
  assert.equal(outcome, 'unavailable');
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

test('R6.4/RMV5.6: checkAndroidBluetoothPermissions no tira sin RN → "unavailable"', async () => {
  // Mismo borde que `ensure…`: en node no resuelve `react-native`. 'unavailable' hace que el arranque
  // automático NO arranque, que es lo correcto: si no podemos saber si hay permiso, no tocamos nada.
  assert.equal(await checkAndroidBluetoothPermissions(), 'unavailable');
});
