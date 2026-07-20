// Tests de las partes PURAS del adapter-spp-android (RMV5.2/5.3/5.5/5.6). node:test. La conexión
// RFCOMM REAL es device-gated (RMV5.9) — acá se cubre: resolución de params desde el driver
// (RMV5.2), framing por línea → parser del driver → EID (RMV5.3), reuso del backoff (RMV5.5), y
// que IMPORTAR el módulo NO tira sin la lib nativa (RMV5.6, el invariante del import perezoso).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSppParams, SppAndroidAdapter } from './adapter-spp-android.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { SPP_UUID } from './config.ts';
import { LineFramer, backoffDelayMs } from './line-framer.ts';
import type { ReaderDriver } from './driver-types.ts';

const RAW_982 = '1000000982000364696050260530101701';
const EID_982 = '982000364696050';

// ─── RMV5.2: el adapter toma sppUuid/pin del DRIVER (no hardcodeados) ───────────────────────

test('RMV5.2: resolveSppParams(RS420) → { sppUuid: SPP_UUID, pin: "1234" }', () => {
  assert.deepEqual(resolveSppParams(RS420_DRIVER), { sppUuid: SPP_UUID, pin: '1234' });
});

test('RMV5.2: otro driver SPP se soporta cambiando el driver, no el adapter (params del driver)', () => {
  const OTHER: ReaderDriver = {
    ...RS420_DRIVER,
    vendorId: 'other-spp',
    transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '0000' } }],
  };
  assert.deepEqual(resolveSppParams(OTHER), { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '0000' });
});

test('RMV5.2: un driver sin transporte SPP → resolveSppParams null', () => {
  const NO_SPP: ReaderDriver = { ...RS420_DRIVER, transports: [{ kind: 'serial', params: { baud: 9600 } }] };
  assert.equal(resolveSppParams(NO_SPP), null);
});

// ─── RMV5.3: framing por línea (LineFramer, reuso) → parser del driver → EID correcto ───────

test('RMV5.3: LineFramer + frameParser del driver desframean el stream SPP hasta el EID', () => {
  const framer = new LineFramer();
  // El stream SPP llega con STX + línea + \r\n, posiblemente partido en chunks.
  const chunk1 = `\x021000000982000`;
  const chunk2 = `364696050260530101701\r\n`;
  assert.deepEqual(framer.push(chunk1), []);
  const lines = framer.push(chunk2);
  assert.equal(lines.length, 1);
  // Cada línea CRUDA la desframea el frameParser del driver (reuso de parseRs420Line, RMV5.3).
  assert.deepEqual(RS420_DRIVER.frameParser.parse(lines[0]), { eid: EID_982 });
});

// ─── RMV5.5: reuso del backoff incremental del core ─────────────────────────────────────────

test('RMV5.5: el adapter reusa backoffDelayMs del core (crece y se topea)', () => {
  assert.equal(backoffDelayMs(0), 500);
  assert.equal(backoffDelayMs(4), 8000);
  assert.equal(backoffDelayMs(10), 8000);
});

// ─── RMV5.6: import perezoso — importar el módulo NO tira sin la lib nativa ──────────────────

test('RMV5.6: import("./adapter-spp-android") NO tira en node/CI sin react-native-bluetooth-classic', async () => {
  await assert.doesNotReject(async () => {
    const mod = await import('./adapter-spp-android.ts');
    assert.equal(typeof mod.SppAndroidAdapter, 'function');
    assert.equal(typeof mod.resolveSppParams, 'function');
  });
});

test('RMV5.6/R7: instanciar el adapter y connect() sin la lib nativa NO tira → refleja "disconnected"', async () => {
  const adapter = new SppAndroidAdapter(RS420_DRIVER);
  assert.equal(adapter.kind, 'spp-android');
  const statuses: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  // Sin react-native-bluetooth-classic instalada (CI): loadRNBC() → null → connect no tira y
  // emite 'disconnected' sin bloquear el manual (R7). La conexión SPP real es device-gated (RMV5.9).
  await assert.doesNotReject(() => adapter.connect('AA:BB:CC:DD:EE:FF'));
  assert.equal(statuses.at(-1), 'disconnected');
});

test('enable/disable no tiran y disconnect es idempotente sin conexión', async () => {
  const adapter = new SppAndroidAdapter();
  adapter.enable();
  adapter.disable();
  await assert.doesNotReject(() => adapter.disconnect());
});
