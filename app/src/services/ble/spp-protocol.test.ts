// Tests de las piezas PURAS del transporte SPP (RMV5.1/5.2/5.3/5.7). node:test, sin RN, sin device.
//
// El test que más importa acá es el de `splitSppPayload`: cierra el bug de framing que tenía el
// adapter escrito "a ciegas" (pasaba el payload por `LineFramer`, que corta por `\n`, cuando el
// nativo entrega el mensaje YA SIN `\n` → cero lecturas para siempre). Se ejercita con el payload
// EXACTO que produce `DelimitedStringDeviceConnectionImpl` para la trama capturada en campo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RNBC_FIXED_SPP_UUID,
  SPP_DELIMITER,
  normalizePairedDevices,
  sppConnectOptions,
  sppUuidIsSupported,
  splitSppPayload,
} from './spp-protocol.ts';
import { SPP_UUID } from './config.ts';
import { RS420_DRIVER } from './driver-rs420.ts';

const EID_982 = '982000364696050';

// ─── RMV5.2: el UUID del driver tiene que ser el que la lib nativa sabe abrir ────────────────

test('RMV5.2: el sppUuid del RS420 coincide con el UUID fijo de react-native-bluetooth-classic', () => {
  assert.equal(SPP_UUID.toLowerCase(), RNBC_FIXED_SPP_UUID.toLowerCase());
  assert.equal(sppUuidIsSupported(SPP_UUID), true);
});

test('RMV5.2: la comparación de UUID es case-insensitive y tolera espacios (el SO los da en minúscula)', () => {
  assert.equal(sppUuidIsSupported('00001101-0000-1000-8000-00805f9b34fb'), true);
  assert.equal(sppUuidIsSupported('  00001101-0000-1000-8000-00805F9B34FB  '), true);
});

test('RMV5.2: un driver con OTRO UUID RFCOMM NO es alcanzable por esta lib (no se finge soporte)', () => {
  // La lib hardcodea el UUID en `RfcommConnectorThreadImpl`: si dijéramos que sí, abriríamos el SPP
  // estándar y leeríamos de un servicio que no es el del driver.
  assert.equal(sppUuidIsSupported('0000abcd-0000-1000-8000-00805f9b34fb'), false);
  assert.equal(sppUuidIsSupported(''), false);
  assert.equal(sppUuidIsSupported(undefined as unknown as string), false);
});

// ─── RMV5.3: framing — el payload del nativo YA es una línea completa sin `\n` ───────────────

test('RMV5.3: el payload delimitado del nativo (sin \\n) se entrega como UNA línea cruda', () => {
  // Esto es exactamente lo que entrega DelimitedStringDeviceConnectionImpl con delimiter="\n":
  // la trama del RS420 sin el terminador, conservando el STX y el \r.
  const payload = '\x021000000982000364696050260530101701\r';
  const lines = splitSppPayload(payload);
  assert.deepEqual(lines, [payload]);
  // Y esa línea cruda la desframea el frameParser del driver hasta el EID (reuso, RMV5.3).
  assert.deepEqual(RS420_DRIVER.frameParser.parse(lines[0]), { eid: EID_982 });
});

test('RMV5.3 (regresión del bug de framing): un payload SIN \\n NO puede devolver lista vacía', () => {
  // El adapter viejo hacía `LineFramer.push(payload)`, que con un payload sin `\n` devuelve [] y
  // se traga la lectura. Este test falla si alguien vuelve a meter un framer por línea acá.
  assert.equal(splitSppPayload('\x021000000032010006382438260530101701\r').length, 1);
});

test('RMV5.3: payload con varias tramas pegadas → una línea por trama (defensivo)', () => {
  const payload = '\x021000000982000364696050260530101701\r\n\x021000000032010006382438260530101702\r';
  const lines = splitSppPayload(payload);
  assert.equal(lines.length, 2);
  assert.deepEqual(RS420_DRIVER.frameParser.parse(lines[0]), { eid: EID_982 });
  assert.deepEqual(RS420_DRIVER.frameParser.parse(lines[1]), { eid: '032010006382438' });
});

test('RMV5.3: payloads vacíos / solo-whitespace / no-string → sin líneas (nunca tira)', () => {
  assert.deepEqual(splitSppPayload(''), []);
  assert.deepEqual(splitSppPayload('\r\n'), []);
  assert.deepEqual(splitSppPayload('   \n  \n'), []);
  assert.deepEqual(splitSppPayload(undefined), []);
  assert.deepEqual(splitSppPayload(null), []);
  assert.deepEqual(splitSppPayload(42), []);
});

// ─── RMV5.7: opciones de conexión — baud-independiente y sin números ─────────────────────────

test('RMV5.7: las opciones de conexión no llevan baud y usan el delimitador `\\n`', () => {
  const opts = sppConnectOptions();
  assert.equal(opts.delimiter, SPP_DELIMITER);
  assert.equal(opts.connectionType, 'delimited');
  assert.equal(opts.connectorType, 'rfcomm');
  assert.equal(opts.secure, true);
  assert.equal('baud' in opts, false);
  assert.equal('baudRate' in opts, false);
});

test('RMV5.7: ningún valor de las opciones es number (el nativo descarta los Double y usa el default)', () => {
  for (const [key, value] of Object.entries(sppConnectOptions())) {
    assert.notEqual(typeof value, 'number', `la opción ${key} no puede ser numérica`);
  }
});

// ─── RMV3.2: normalización de la lista de emparejados ───────────────────────────────────────

test('RMV3.2: normalizePairedDevices toma address como id, conserva el nombre y ordena', () => {
  const devices = normalizePairedDevices([
    { address: 'AA:BB:CC:DD:EE:02', name: 'Zumbador' },
    { address: 'AA:BB:CC:DD:EE:01', name: 'Auto de Raf' },
  ]);
  assert.deepEqual(devices, [
    { id: 'AA:BB:CC:DD:EE:01', name: 'Auto de Raf' },
    { id: 'AA:BB:CC:DD:EE:02', name: 'Zumbador' },
  ]);
});

test('RMV3.2: descarta entradas sin address, deduplica y tolera basura (nunca tira)', () => {
  const devices = normalizePairedDevices([
    null,
    'no soy un device',
    { name: 'sin MAC' },
    { address: 'AA:BB:CC:DD:EE:01', name: 'RS 420' },
    { address: 'AA:BB:CC:DD:EE:01', name: 'RS 420 duplicado' },
    { id: 'AA:BB:CC:DD:EE:03' },
  ]);
  // Orden por lo que se MUESTRA (nombre, o la MAC si no tiene): el sin-nombre 'AA:…:03' va antes
  // que 'RS 420'. Dos entradas con la misma MAC colapsan en una (gana la primera).
  assert.deepEqual(devices.map((d) => d.id), ['AA:BB:CC:DD:EE:03', 'AA:BB:CC:DD:EE:01']);
  assert.equal(devices[0].name, undefined);
  assert.equal(devices[1].name, 'RS 420');
});

test('RMV3.2: entrada no-array → lista vacía', () => {
  assert.deepEqual(normalizePairedDevices(null), []);
  assert.deepEqual(normalizePairedDevices(undefined), []);
  assert.deepEqual(normalizePairedDevices({}), []);
});

test('RMV3.2: un nombre en blanco no se propaga como string vacío (cae al fallback de la fila)', () => {
  assert.deepEqual(normalizePairedDevices([{ address: 'AA:BB:CC:DD:EE:01', name: '   ' }]), [
    { id: 'AA:BB:CC:DD:EE:01', name: undefined },
  ]);
});
