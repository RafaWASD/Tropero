// Tests del REGISTRO DE DRIVERS (RMV1). node:test, PURO (registry/drivers no importan RN).
// Cubre: match por deviceMatch (nombre / UUID anunciado), lookup por vendorId, device
// desconocido → null (RMV1.7), y la ADITIVIDAD (RMV1.6): un driver sintético se registra en una
// copia del registry y se resuelve por selección SIN tocar contract.ts / stick-adapter.ts / adapters.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DRIVER_REGISTRY, driverByVendorId, findDriverForDevice } from './driver-registry.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import {
  ESP32_GATT_DRIVER,
  ESP32_GATT_ADVERTISED_NAME,
  NUS_SERVICE_UUID,
  NUS_TX_CHAR_UUID,
} from './driver-esp32-gatt.ts';
import { SPP_UUID } from './config.ts';
import { SPP_DELIMITER } from './spp-protocol.ts';
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RBM5.12 / RBM5.13 — EL DRIVER DEL EMULADOR ESP32 (delta ios-ble-mfi, T4.3/T4.4)
//
// El invariante de RBM5.13 no es una preferencia de estilo: el **bridge de la balanza Vesta**
// (ADR-003, `CONTEXT/05-hardware-vesta.md` → `BLEDevice::init("VESTA_BRIDGE")`) anuncia **LOS MISMOS
// UUID Nordic UART** que el emulador — son los UUID estándar de NUS. Si el driver del emulador
// reconociera por `advertisedServiceUuids`, la app reconocería **la balanza como un bastón** y el peso
// del animal entraría por el ingesta de EID. Con el match por NOMBRE, el bridge queda "no reconocido" y
// no accionable (RMV1.7/RMV3.8), que es la conducta correcta.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM5.12: el emulador está en el registro y su displayName DICE que es un banco de pruebas', () => {
  assert.ok(DRIVER_REGISTRY.includes(ESP32_GATT_DRIVER));
  assert.equal(driverByVendorId('esp32-gatt-emu'), ESP32_GATT_DRIVER);
  // ADR-010: el ESP32 es test rig, NO producto. El rótulo es lo único que impide que en la pantalla de
  // conexión se lea como un lector comercial, así que se asierra el TEXTO y no solo que exista.
  assert.equal(ESP32_GATT_DRIVER.displayName, 'Emulador ESP32 (banco de pruebas)');
  assert.match(ESP32_GATT_DRIVER.displayName, /banco de pruebas/i);
});

test('RBM5.12: declara ble-gatt con los UUID NUS de ADR-003, el terminador del RS420 y reusa su parser', () => {
  const gatt = ESP32_GATT_DRIVER.transports.find((t) => t.kind === 'ble-gatt');
  assert.ok(gatt && gatt.kind === 'ble-gatt');
  // Los literales van EXPLÍCITOS (y no derivados del driver): son el contrato con el firmware
  // (`baston-emulator.ino`: NUS_SERVICE_UUID / NUS_TX_UUID) y con ADR-003. Si alguien los cambia acá, el
  // escaneo filtra por un servicio que el emulador no anuncia → "busca y no encuentra nada".
  assert.equal(gatt.params.serviceUuid, '6E400001-B5A3-F393-E0A9-E50E24DCCA9E');
  assert.equal(gatt.params.notifyCharUuid, '6E400003-B5A3-F393-E0A9-E50E24DCCA9E');
  assert.equal(gatt.params.delimiter, SPP_DELIMITER);
  // Y las constantes exportadas son ESOS mismos valores (los tests de abajo las usan como fixture).
  assert.equal(NUS_SERVICE_UUID, gatt.params.serviceUuid);
  assert.equal(NUS_TX_CHAR_UUID, gatt.params.notifyCharUuid);
  // Reuso del parser del RS420 (RMV1.3): el emulador emite la trama del RS420, con su STX.
  assert.equal(ESP32_GATT_DRIVER.frameParser.parse, parseRs420Line);
  assert.deepEqual(ESP32_GATT_DRIVER.frameParser.parse('1000000982000364696050260530101701'), {
    eid: '982000364696050',
  });
  // NO declara ningún otro transporte: en web su binding es null (carga manual como piso).
  assert.deepEqual(
    ESP32_GATT_DRIVER.transports.map((t) => t.kind),
    ['ble-gatt'],
  );
});

test('RBM5.13: el emulador se reconoce por su NOMBRE anunciado', () => {
  assert.equal(ESP32_GATT_ADVERTISED_NAME, 'EMU-GATT-STICK'); // README del firmware
  for (const name of [ESP32_GATT_ADVERTISED_NAME, 'emu-gatt-stick', 'EMU-GATT-STICK-2']) {
    assert.equal(
      findDriverForDevice({ id: 'AA:01', name, channel: 'ble-advertised' }),
      ESP32_GATT_DRIVER,
      `debería reconocer '${name}'`,
    );
  }
});

test('RBM5.13: el bridge de la balanza Vesta anuncia los MISMOS UUID NUS y NO se reconoce como bastón', () => {
  // El fixture usa el UUID DEL DRIVER a propósito: la colisión ES "el mismo UUID". Si el test usara una
  // copia del literal, el día que el driver cambiara de servicio el test seguiría verde midiendo una
  // colisión que ya no existe. (El literal de ADR-003 se asierra aparte, arriba.)
  const vestaBridge: DiscoveredDevice = {
    id: 'BB:02',
    name: 'VESTA_BRIDGE',
    channel: 'ble-advertised',
    advertisedServiceUuids: [NUS_SERVICE_UUID],
  };
  assert.equal(
    findDriverForDevice(vestaBridge),
    null,
    'la BALANZA no puede resolverse como un lector de caravanas: su peso entraría por el ingesta de EID',
  );
  // Y en minúsculas tampoco (el SO puede anunciar los UUID en minúsculas, y el cruce es
  // case-insensitive: si el matcher mirara UUIDs, ESTA es la forma en que entraría de verdad).
  assert.equal(
    findDriverForDevice({ ...vestaBridge, advertisedServiceUuids: [NUS_SERVICE_UUID.toLowerCase()] }),
    null,
  );
  // CONTROL POSITIVO: el mismo device, con el nombre del emulador, SÍ se reconoce. Sin esta mitad, un
  // `findDriverForDevice` roto (que devolviera null siempre) pasaría el test de arriba.
  assert.equal(
    findDriverForDevice({ ...vestaBridge, name: ESP32_GATT_ADVERTISED_NAME }),
    ESP32_GATT_DRIVER,
  );
});

test('RBM5.13: el matcher del emulador NO declara advertisedServiceUuids (estructural, sobre la ausencia)', () => {
  // La otra mitad del guard: el test de comportamiento de arriba muere si alguien agrega los UUID al
  // matcher, pero este dice POR QUÉ en una línea y cubre además la variante "los declaro vacíos" o "los
  // declaro con otro servicio", que serían el primer paso de vuelta al mismo bug.
  assert.equal(
    ESP32_GATT_DRIVER.deviceMatch.advertisedServiceUuids,
    undefined,
    'el emulador se reconoce SOLO por nombre (RBM5.13): el bridge de la balanza anuncia los mismos UUID NUS',
  );
  assert.ok(ESP32_GATT_DRIVER.deviceMatch.namePattern instanceof RegExp);
});

test('RBM5.13: un device que anuncia el servicio NUS pero SIN el nombre del emulador no se reconoce', () => {
  // El caso general del que el bridge de la balanza es UNA instancia: cualquier cosa que hable Nordic
  // UART (hay docenas de proyectos que lo usan) no es un bastón. Sin nombre legible tampoco.
  for (const name of [undefined, 'Nordic_UART', 'ESP32', 'EMU-HID-380', 'VESTA_BRIDGE_2']) {
    assert.equal(
      findDriverForDevice({
        id: 'CC:03',
        ...(name === undefined ? {} : { name }),
        channel: 'ble-advertised',
        advertisedServiceUuids: [NUS_SERVICE_UUID],
      }),
      null,
      `'${String(name)}' anuncia NUS pero no es el emulador`,
    );
  }
});

test('RBM5.11: el registro NO declara ningún lector comercial adivinado (solo el RS420 y el banco)', () => {
  // Guard sobre la AUSENCIA. La incógnita más importante del delta es el Gallagher HR5 v3: no tenemos el
  // aparato ni sus UUID/formato de trama, así que un driver suyo con parámetros "razonables" sería un
  // verde falso sobre justamente lo que no sabemos. El día que Gallagher entregue su documentación, este
  // test cae y hay que actualizarlo A PROPÓSITO (y con el aparato en la mano).
  assert.deepEqual(
    DRIVER_REGISTRY.map((d) => d.vendorId),
    ['allflex-rs420', 'esp32-gatt-emu'],
  );
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
