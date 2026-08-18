// `safeErrorText` — el convertidor único de error → texto de log del transporte (hallazgo §7.2 del
// Gate 2 del delta `ios-ble-mfi`: el identificador del bastón llegaba a los breadcrumbs por el `message`
// interpolado de las libs de Bluetooth).
//
// El test que manda es el PRIMERO: la tabla de códigos no está escrita a ojo, se DERIVA del fuente
// instalado de `react-native-ble-plx`. Un upgrade de la lib que agregue una plantilla con `{deviceID}`
// pone esto en rojo antes de que el id empiece a viajar — que es la única forma de que una tabla
// copiada a mano no se pudra (misma lección que el union `RejectReason` recopiado de `contract.ts`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BLE_PLX_DEVICE_ID_ERROR_CODES,
  BLE_PLX_EXTRA_CODES,
  REDACTED_DEVICE,
  SAFE_ERROR_TEXT_MAX,
  safeErrorText,
  scrubDeviceIdentifiers,
} from './error-text.ts';

const HERE = resolve(fileURLToPath(import.meta.url), '..'); // app/src/services/ble
const APP_ROOT = resolve(HERE, '..', '..', '..'); // app/
const BLE_ERROR_JS = resolve(APP_ROOT, 'node_modules/react-native-ble-plx/src/BleError.js');

const MAC = '11:22:33:44:55:66';
/** El id de iOS es un UUID por-app: por FORMA es indistinguible de un UUID de servicio. */
const IOS_ID = 'A1B2C3D4-1111-2222-3333-444455556666';
/** Un UUID de servicio REAL de esta unidad (ADR-003, Nordic UART): NO es un identificador de device. */
const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';

/** `BleError` como lo construye la lib: mensaje YA interpolado + `errorCode`, y SIN `deviceID` adentro. */
function bleError(errorCode: number, message: string): Error & { errorCode: number } {
  return Object.assign(new Error(message), { errorCode });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 — EL ORÁCULO DERIVADO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Del fuente de la lib: nombre → número, y nombre → plantilla de mensaje. */
function plantillasDeLaLib(): { codes: Map<string, number>; messages: Map<string, string> } {
  const src = readFileSync(BLE_ERROR_JS, 'utf8');
  const codeStart = src.indexOf('export const BleErrorCode = {');
  const msgStart = src.indexOf('export const BleErrorCodeMessage');
  assert.ok(codeStart > 0 && msgStart > 0, 'no se encontró el mapa de códigos en el fuente de ble-plx');
  const codes = new Map<string, number>();
  for (const m of src.slice(codeStart, msgStart).matchAll(/^ {2}(\w+):\s*(\d+)\s*,?\s*$/gm)) {
    codes.set(m[1], Number(m[2]));
  }
  const messages = new Map<string, string>();
  for (const m of src.slice(msgStart).matchAll(/\[BleErrorCode\.(\w+)\]:\s*\n?\s*(['"])([\s\S]*?)\2/g)) {
    messages.set(m[1], m[3]);
  }
  return { codes, messages };
}

test('la tabla de códigos se DERIVA de la lib instalada, no está escrita a ojo', () => {
  const { codes, messages } = plantillasDeLaLib();
  assert.ok(codes.size >= 30, `el parseo de códigos se rompió (leyó ${codes.size})`);
  assert.equal(messages.size, codes.size, 'cada código tiene su plantilla');

  const conId = [...messages]
    .filter(([, tpl]) => tpl.includes('{deviceID}'))
    .map(([name]) => codes.get(name) as number);
  assert.ok(conId.length >= 20, `plantillas con {deviceID}: ${conId.length} (esperábamos ≥ 20)`);

  const faltantes = conId.filter((c) => !BLE_PLX_DEVICE_ID_ERROR_CODES.has(c));
  assert.deepEqual(
    faltantes,
    [],
    `Estos códigos de ble-plx interpolan {deviceID} en su mensaje y NO están en la tabla: ` +
      `${faltantes.join(', ')}. Con la lib actualizada, el id del bastón volvería a viajar en free-text.`,
  );

  // La diferencia al revés (lo que agregamos sin que salga del oráculo) tiene que estar JUSTIFICADA.
  const derivados = new Set(conId);
  const extras = [...BLE_PLX_DEVICE_ID_ERROR_CODES].filter((c) => !derivados.has(c)).sort((a, b) => a - b);
  assert.deepEqual(
    extras,
    Object.keys(BLE_PLX_EXTRA_CODES).map(Number).sort((a, b) => a - b),
    'todo código de la tabla que NO salga del oráculo tiene que traer su motivo en BLE_PLX_EXTRA_CODES',
  );
  for (const [code, why] of Object.entries(BLE_PLX_EXTRA_CODES)) {
    assert.ok(why.trim().length > 60, `el motivo del código ${code} es una etiqueta, no una explicación`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2 — Vía 1: el código gana al mensaje interpolado
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('la desconexión de ble-plx sale como `errorCode`, y la MAC del bastón NO sale', () => {
  const out = safeErrorText(bleError(201, `Device ${MAC} was disconnected`));
  assert.equal(out, 'errorCode:201');
  assert.ok(!out.includes(MAC));
  assert.ok(!out.includes('11:22'), 'ni un pedazo');
});

test('el id de iOS (UUID) también queda afuera — y es el caso que la FORMA no puede cubrir', () => {
  const e = bleError(200, `Device ${IOS_ID} connection failed`);
  assert.equal(safeErrorText(e), 'errorCode:200');
  // El motivo por el que la tabla existe: sin ella, el blanqueo por forma NO lo ve (un UUID de device y
  // uno de servicio son el mismo string para cualquier regex).
  assert.ok(
    scrubDeviceIdentifiers(`Device ${IOS_ID} connection failed`).includes(IOS_ID),
    'si esto dejara de ser cierto, la tabla de códigos sería redundante — no lo es',
  );
});

test('los CUATRO mensajes que nombra el hallazgo caen del lado seguro', () => {
  const casos: [number, string][] = [
    [200, `Device ${MAC} connection failed`],
    [201, `Device ${MAC} was disconnected`],
    [204, `Device ${MAC} not found`],
    [300, `Services discovery failed for device ${MAC}`],
  ];
  for (const [code, msg] of casos) {
    const out = safeErrorText(bleError(code, msg));
    assert.equal(out, `errorCode:${code}`, msg);
    assert.ok(!out.includes(MAC), msg);
  }
});

test('un código SIN identificador conserva su mensaje (no se paga diagnóstico de más)', () => {
  // La radio apagada es la causa que más se lee en logcat: degradarla a un número sería pagar el arreglo
  // con la parte útil del log.
  assert.equal(safeErrorText(bleError(102, 'BluetoothLE is powered off')), 'BluetoothLE is powered off');
  assert.equal(safeErrorText(bleError(600, 'Cannot start scanning operation')), 'Cannot start scanning operation');
  assert.equal(safeErrorText(bleError(3, 'Operation timed out')), 'Operation timed out');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — Vía 2: el blanqueo del resto (SPP y MFi, que no tienen códigos de ble-plx)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('la MAC del SPP se blanquea y la CAUSA sobrevive', () => {
  // `Exceptions.java` de react-native-bluetooth-classic: el `%s` es `device.getAddress()`.
  assert.equal(
    safeErrorText(new Error(`Connection to ${MAC} was lost`)),
    `Connection to ${REDACTED_DEVICE} was lost`,
  );
  assert.equal(
    safeErrorText(new Error('Not connected to aa-bb-cc-dd-ee-ff')),
    `Not connected to ${REDACTED_DEVICE}`,
    'también en la grafía con guiones y en minúsculas',
  );
});

test('un identificador SIN forma reconocible (el serial MFi) se blanquea porque el call site lo sabe', () => {
  const serial = 'SER-A-000123';
  const out = safeErrorText(new Error(`Could not connect to EAAccessory ${serial}`), serial);
  assert.equal(out, `Could not connect to EAAccessory ${REDACTED_DEVICE}`);
  assert.equal(
    safeErrorText(new Error(`accessory ${serial.toLowerCase()} gone`), serial),
    `accessory ${REDACTED_DEVICE} gone`,
    'sin importar el case (el SO y nosotros no siempre lo escribimos igual)',
  );
});

test('un UUID de SERVICIO no se toca (blanquear de más también rompe el diagnóstico)', () => {
  const msg = `Service ${SERVICE_UUID} not found`;
  assert.equal(safeErrorText(new Error(msg)), msg);
});

test('un id conocido demasiado CORTO no se usa para blanquear (no se parten palabras)', () => {
  assert.equal(safeErrorText(new Error('device not connected'), 'dev'), 'device not connected');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4 — Formas raras y tope
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('las formas que llegan de verdad por el puente de RN', () => {
  assert.equal(safeErrorText('boom'), 'boom');
  assert.equal(safeErrorText({ message: 'desde el nativo' }), 'desde el nativo');
  assert.equal(safeErrorText({ code: 'BLUETOOTH_NOT_ENABLED' }), 'BLUETOOTH_NOT_ENABLED');
  assert.equal(safeErrorText({ errorCode: 999 }), 'errorCode:999', 'un código que no conocemos igual dice algo');
  assert.equal(safeErrorText(null), 'unknown');
  assert.equal(safeErrorText(undefined), 'unknown');
  assert.equal(safeErrorText(new Error('')), 'unknown', 'un Error sin mensaje no vale un string vacío');
  assert.equal(safeErrorText({ code: 'device_not_found', message: '' }), 'device_not_found');
});

test('el texto que va al log está ACOTADO (un `message` del nativo es free-text)', () => {
  const largo = 'x'.repeat(SAFE_ERROR_TEXT_MAX * 3);
  const out = safeErrorText(new Error(largo));
  assert.equal(out.length, SAFE_ERROR_TEXT_MAX + 1, 'se corta y se marca el corte');
  assert.ok(out.endsWith('…'));
  assert.equal(safeErrorText(new Error('corto')), 'corto', 'lo que entra en el tope no se toca');
});

test('el blanqueo alcanza a TODAS las apariciones, no solo a la primera', () => {
  assert.equal(
    scrubDeviceIdentifiers(`${MAC} y de nuevo ${MAC}`),
    `${REDACTED_DEVICE} y de nuevo ${REDACTED_DEVICE}`,
  );
});
