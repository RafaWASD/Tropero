// Tests de la selección del SDK de PowerSync por plataforma (spec 15, T1.4 / R2.2).
// node:test + type-stripping. PURO: platform-select.ts no importa RN/SDK.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickPowerSyncPackage } from './platform-select.ts';

test('R2.2: web → @powersync/web (WASM)', () => {
  assert.equal(pickPowerSyncPackage('web'), 'web');
});

test('R2.2: ios/android → @powersync/react-native (device)', () => {
  assert.equal(pickPowerSyncPackage('ios'), 'native');
  assert.equal(pickPowerSyncPackage('android'), 'native');
});

test('R2.2: os desconocido → native (fail-safe al target de producción)', () => {
  assert.equal(pickPowerSyncPackage('windows'), 'native');
  assert.equal(pickPowerSyncPackage(''), 'native');
});
