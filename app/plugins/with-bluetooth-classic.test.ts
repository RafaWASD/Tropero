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

import plugin from './with-bluetooth-classic.js';

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
