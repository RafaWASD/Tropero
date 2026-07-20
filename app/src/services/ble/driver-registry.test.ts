// Tests del REGISTRO DE DRIVERS (RMV1). node:test, PURO (registry/drivers no importan RN).
// Cubre: match por deviceMatch (nombre / UUID anunciado), lookup por vendorId, device
// desconocido → null (RMV1.7), y la ADITIVIDAD (RMV1.6): un driver sintético se registra en una
// copia del registry y se resuelve por selección SIN tocar contract.ts / stick-adapter.ts / adapters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DRIVER_REGISTRY, driverByVendorId, findDriverForDevice } from './driver-registry.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { SPP_UUID } from './config.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { ReaderDriver, DiscoveredDevice } from './driver-types.ts';

// ─── RMV1.3: el RS420 es el primer driver, reusa parseRs420Line ─────────────────────────────

test('RMV1.3: RS420_DRIVER declara spp (SPP_UUID, pin 1234) + serial y reusa parseRs420Line', () => {
  assert.equal(RS420_DRIVER.vendorId, 'allflex-rs420');
  assert.equal(RS420_DRIVER.streaming, true);
  const spp = RS420_DRIVER.transports.find((t) => t.kind === 'spp');
  assert.ok(spp && spp.kind === 'spp');
  assert.equal(spp.params.sppUuid, SPP_UUID);
  assert.equal(spp.params.pin, '1234');
  const serial = RS420_DRIVER.transports.find((t) => t.kind === 'serial');
  assert.ok(serial && serial.kind === 'serial');
  // frameParser es EL parser del core (reuso, no reimplementado): mismo resultado.
  assert.equal(RS420_DRIVER.frameParser.parse, parseRs420Line);
  assert.deepEqual(
    RS420_DRIVER.frameParser.parse('1000000982000364696050260530101701'),
    { eid: '982000364696050' },
  );
});

// ─── RMV1.4: registro consultable + lookup por vendorId ─────────────────────────────────────

test('RMV1.4: DRIVER_REGISTRY incluye el RS420; driverByVendorId lo encuentra / null si no existe', () => {
  assert.ok(DRIVER_REGISTRY.includes(RS420_DRIVER));
  assert.equal(driverByVendorId('allflex-rs420'), RS420_DRIVER);
  assert.equal(driverByVendorId('inexistente-xyz'), null);
});

// ─── RMV1.5: match por deviceMatch (nombre / UUID de servicio anunciado) ────────────────────

test('RMV1.5: findDriverForDevice matchea por nombre (RS420 / Allflex, case/space-insensitive)', () => {
  const byName: DiscoveredDevice = { id: 'AA:BB', name: 'RS420-1234', channel: 'classic-paired' };
  assert.equal(findDriverForDevice(byName), RS420_DRIVER);
  const bySpacedName: DiscoveredDevice = { id: 'AA:BB', name: 'Allflex RS 420', channel: 'ble-advertised' };
  assert.equal(findDriverForDevice(bySpacedName), RS420_DRIVER);
});

test('RMV1.5: findDriverForDevice matchea por UUID de servicio anunciado (case-insensitive)', () => {
  const byUuid: DiscoveredDevice = {
    id: 'CC:DD',
    channel: 'ble-advertised',
    advertisedServiceUuids: [SPP_UUID.toLowerCase()], // el SO puede anunciarlo en minúsculas
  };
  assert.equal(findDriverForDevice(byUuid), RS420_DRIVER);
});

// ─── RMV1.7: device desconocido → null (no reconocido, carga manual como piso) ──────────────

test('RMV1.7: un device que no matchea ningún driver → findDriverForDevice = null', () => {
  const unknown: DiscoveredDevice = { id: 'EE:FF', name: 'Random Speaker', channel: 'classic-paired' };
  assert.equal(findDriverForDevice(unknown), null);
  const unknownUuid: DiscoveredDevice = {
    id: 'EE:FF',
    channel: 'ble-advertised',
    advertisedServiceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'], // Battery Service, no SPP
  };
  assert.equal(findDriverForDevice(unknownUuid), null);
  // Un device sin nombre ni UUIDs no puede matchear por accidente.
  assert.equal(findDriverForDevice({ id: 'X', channel: 'classic-paired' }), null);
});

// ─── RMV1.6: aditividad — un fabricante nuevo se agrega como fila de driver, sin tocar el core ─

test('RMV1.6: registrar un driver sintético en una copia del registry lo hace resoluble sin tocar el core', () => {
  // Driver de un lector SPP genérico ficticio. NO se importa ni se toca contract.ts /
  // stick-adapter.ts / ningún adapter para que sea resoluble: solo se agrega la fila.
  const GENERIC_SPP: ReaderDriver = {
    vendorId: 'generic-spp-x',
    displayName: 'Generic SPP X',
    transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '0000' } }],
    frameParser: { parse: parseRs420Line },
    deviceMatch: { namePattern: /genx/i, advertisedServiceUuids: ['0000abcd-0000-1000-8000-00805f9b34fb'] },
    streaming: true,
  };
  const extended = [...DRIVER_REGISTRY, GENERIC_SPP];
  const dev: DiscoveredDevice = { id: '11:22', name: 'GenX-01', channel: 'classic-paired' };
  // Resoluble en el registry extendido; el registry global sigue sin conocerlo (aislamiento).
  assert.equal(findDriverForDevice(dev, extended), GENERIC_SPP);
  assert.equal(findDriverForDevice(dev), null);
  assert.equal(driverByVendorId('generic-spp-x', extended), GENERIC_SPP);
  assert.equal(driverByVendorId('generic-spp-x'), null);
});
