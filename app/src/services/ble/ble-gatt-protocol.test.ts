// Tests de las piezas PURAS del transporte BLE GATT (T3.2/T3.13 del delta ios-ble-mfi). node:test, sin
// RN, sin `react-native-ble-plx`, sin device.
//
// ── EL ORÁCULO DE BASE64 NO ES NUESTRO PROPIO DECODER ────────────────────────────────────────────
// Los fixtures se codifican con `Buffer.from(texto, 'latin1').toString('base64')` — la implementación
// de Node, independiente de `decodeBase64Ascii`. Si el oráculo fuera nuestro propio encoder, un bug de
// simetría (encodear y decodear MAL igual) daría verde: es la clase de "fixture derivado de lo que
// verifica" que este repo ya se comió.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BLE_DEFAULT_MTU,
  BLE_DEFAULT_NOTIFY_PAYLOAD,
  bleConnectOptions,
  bleGattDelimiterIsSupported,
  bleScanOptions,
  decodeBase64Ascii,
  normalizeUuid128,
  resolveBleGattParams,
} from './ble-gatt-protocol.ts';
import { LineFramer } from './line-framer.ts';
import { SPP_DELIMITER } from './spp-protocol.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { ReaderDriver } from './driver-types.ts';

/** UUIDs Nordic UART (ADR-003) tal como los escribe el ADR: EN MAYÚSCULAS. */
const NUS_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_NOTIFY = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

/**
 * Trama del RS420 TAL CUAL sale del lector: arranca con `STX` (`0x02`), sigue cabecera + EID +
 * timestamp, termina con `\r` y su `\n`. Es la misma que el emulador reproduce en `MODO_GATT`.
 */
const RAW_FRAME = '\x021000000982000364696050260530101701\r';
const EID_982 = '982000364696050';

/** Encoder INDEPENDIENTE (Node), no el nuestro. */
function toBase64(text: string): string {
  return Buffer.from(text, 'latin1').toString('base64');
}

/** Un driver SINTÉTICO. RBM5.11: acá NO se registra ningún lector real (no tenemos ninguno). */
function syntheticDriver(over: Partial<ReaderDriver> = {}): ReaderDriver {
  return {
    vendorId: 'test-gatt',
    displayName: 'Lector sintético (test)',
    transports: [{ kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: NUS_NOTIFY } }],
    frameParser: { parse: parseRs420Line },
    deviceMatch: { namePattern: /TEST-GATT/i },
    streaming: true,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RBM2.7 — base64 → bytes → UN BYTE = UN CARÁCTER, conservando el STX
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.7: la trama con STX sobrevive el round-trip base64 → texto, byte por byte', () => {
  const decoded = decodeBase64Ascii(toBase64(RAW_FRAME));
  assert.equal(decoded, RAW_FRAME);
  // El STX tiene que seguir ahí: es lo que el `frameParser` del driver usa para reconocer la trama.
  assert.equal(decoded?.charCodeAt(0), 0x02);
  // Y la cadena completa tiene que seguir siendo parseable de punta a punta (el oráculo de verdad: no
  // "el string es igual", sino "el EID sale").
  assert.deepEqual(parseRs420Line(decoded as string), { eid: EID_982 });
});

test('RBM2.7: un byte ≥ 0x80 NO se mangle (contraprueba explícita de UTF-8)', () => {
  // Bytes que un lector futuro podría emitir (0xFF/0x80 no son UTF-8 válido por sí solos).
  const bytes = [0x02, 0x31, 0xff, 0x80, 0xc3, 0x0d];
  const text = String.fromCharCode(...bytes);
  const decoded = decodeBase64Ascii(toBase64(text));
  assert.deepEqual(
    [...(decoded as string)].map((c) => c.charCodeAt(0)),
    bytes,
    'la decodificación tiene que ser byte a byte: cada carácter conserva su código original',
  );

  // LA CONTRAPRUEBA: decodificar lo MISMO como UTF-8 destruye esos bytes (U+FFFD). Sin esta aserción,
  // el test de arriba pasaría igual con un decoder UTF-8 para tramas puramente ASCII — y el bug
  // aparecería recién con el primer lector que use un byte alto, como un `parse_failed` intermitente.
  const utf8 = new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
  assert.notEqual(utf8, decoded, 'si UTF-8 diera lo mismo, este test no estaría probando nada');
  assert.ok(utf8.includes('�'), 'el decoder UTF-8 tiene que arruinar estos bytes (por eso no se usa)');
});

test('RBM2.7: el padding y el whitespace del base64 se toleran; el valor vacío es texto vacío', () => {
  assert.equal(decodeBase64Ascii(toBase64('A')), 'A'); // 'QQ==' → dos '=' de padding
  assert.equal(decodeBase64Ascii(toBase64('AB')), 'AB'); // 'QUI=' → un '='
  assert.equal(decodeBase64Ascii(toBase64('ABC')), 'ABC'); // 'QUJD' → sin padding
  assert.equal(decodeBase64Ascii('QUJ\nD'), 'ABC'); // partido en líneas (MIME)
  assert.equal(decodeBase64Ascii(''), '');
});

test('RBM2.7: un valor que NO se puede decodificar devuelve null (para que el caller lo LOGUEE)', () => {
  // `null` y no `''`: convertir una notificación corrupta en "no llegó nada" es el silencio
  // indistinguible de "el operario no está bastoneando".
  assert.equal(decodeBase64Ascii(undefined), null);
  assert.equal(decodeBase64Ascii(null), null);
  assert.equal(decodeBase64Ascii(42), null);
  assert.equal(decodeBase64Ascii('no-es-base64!'), null);
  assert.equal(decodeBase64Ascii('QUJDR'), null, 'resto de 1 carácter = base64 truncado');
  assert.equal(decodeBase64Ascii('QU-_'), null, 'base64url no es lo que emite el nativo: no se adivina');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RBM2.4 — UUIDs normalizados (el ADR los escribe en mayúsculas, el SO los devuelve en minúsculas)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.4: un UUID en MAYÚSCULAS matchea el mismo UUID en minúsculas', () => {
  // El invariante: DOS grafías del mismo UUID colapsan a la MISMA forma canónica. Es lo que hace que el
  // filtro del escaneo matchee, porque ADR-003 los escribe en mayúsculas y el SO los devuelve en
  // minúsculas: comparar los strings tal cual daría "escanea y no encuentra nada" con el bastón al lado.
  const canon = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  assert.equal(normalizeUuid128(NUS_SERVICE), canon);
  assert.equal(normalizeUuid128(canon), canon);
  assert.equal(normalizeUuid128('  6E400001-B5A3-F393-E0A9-E50E24DCCA9E  '), canon, 'el trim es parte de la normalización');
});

test('RBM2.4: las formas cortas (16 y 32 bits) y la sin guiones se expanden a la canónica', () => {
  assert.equal(normalizeUuid128('180D'), '0000180d-0000-1000-8000-00805f9b34fb');
  assert.equal(normalizeUuid128('0000180D'), '0000180d-0000-1000-8000-00805f9b34fb');
  assert.equal(
    normalizeUuid128('6E400001B5A3F393E0A9E50E24DCCA9E'),
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  );
  // La forma corta y la larga del MISMO servicio estándar colapsan al mismo canónico.
  assert.equal(normalizeUuid128('180d'), normalizeUuid128('0000180D-0000-1000-8000-00805F9B34FB'));
});

test('RBM2.4: lo que no es un UUID devuelve null (y no matchea nada)', () => {
  for (const malo of [undefined, null, 42, '', 'xyz', '6E400001-B5A3-F393-E0A9', 'zzzz']) {
    assert.equal(normalizeUuid128(malo as unknown), null, `${String(malo)} no es un UUID`);
  }
  // Y dos ilegibles NO son "el mismo UUID": el `null` es un motivo de rechazo, no un valor comparable.
  // (`resolveBleGattParams` lo trata así: un UUID que no normaliza corta con `uuid-invalido`.)
  assert.equal(normalizeUuid128('xyz'), normalizeUuid128('zzzz'), 'los dos son null…');
  const res = resolveBleGattParams(
    syntheticDriver({
      transports: [{ kind: 'ble-gatt', params: { serviceUuid: 'xyz', notifyCharUuid: 'zzzz' } }],
    }),
  );
  assert.deepEqual(res, { ok: false, reason: 'uuid-invalido' }, '…y por eso el driver se RECHAZA, no matchea');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RBM2.10 — el fin de trama sale del DRIVER, y uno que no podemos framear no abre la conexión
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.10: el delimitador vacío NO está soportado (con notificaciones nunca cerraría una línea)', () => {
  assert.equal(bleGattDelimiterIsSupported(''), false);
  assert.equal(bleGattDelimiterIsSupported(undefined), false);
  assert.equal(bleGattDelimiterIsSupported(null), false);
  assert.equal(bleGattDelimiterIsSupported(7), false);
  assert.equal(bleGattDelimiterIsSupported('\n'), true);
  assert.equal(bleGattDelimiterIsSupported('\r\n'), true, 'multi-carácter SÍ (el framer avanza su largo)');
  assert.equal(bleGattDelimiterIsSupported('\r'), true);
});

test('RBM2.4/2.6/2.10: resolveBleGattParams saca servicio, característica y fin de trama DEL DRIVER', () => {
  const res = resolveBleGattParams(syntheticDriver());
  assert.ok(res.ok);
  assert.deepEqual(res.params, {
    serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    notifyCharUuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    delimiter: SPP_DELIMITER,
  });
});

test('RBM2.10: un driver con OTRO fin de trama lo impone (no se hardcodea el del RS420)', () => {
  const res = resolveBleGattParams(
    syntheticDriver({
      transports: [
        { kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: NUS_NOTIFY, delimiter: '\r' } },
      ],
    }),
  );
  assert.ok(res.ok);
  assert.equal(res.params.delimiter, '\r');
});

test('RBM2.10: los TRES motivos de "no alcanzable" son distintos (tres causas, tres acciones)', () => {
  // Un lector que no habla GATT: normal, no es un bug.
  const sinGatt = resolveBleGattParams(
    syntheticDriver({ transports: [{ kind: 'spp', params: { sppUuid: NUS_SERVICE } }] }),
  );
  assert.deepEqual(sinGatt, { ok: false, reason: 'driver-sin-ble-gatt' });

  // Un driver mal escrito: hay que arreglar el DRIVER.
  const uuidMalo = resolveBleGattParams(
    syntheticDriver({
      transports: [{ kind: 'ble-gatt', params: { serviceUuid: 'no-uuid', notifyCharUuid: NUS_NOTIFY } }],
    }),
  );
  assert.deepEqual(uuidMalo, { ok: false, reason: 'uuid-invalido' });
  const charMala = resolveBleGattParams(
    syntheticDriver({
      transports: [{ kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: '' } }],
    }),
  );
  assert.deepEqual(charMala, { ok: false, reason: 'uuid-invalido' });

  // Un fin de trama que no podemos framear: otro adapter, o corregir el dato del lector.
  const sinDelim = resolveBleGattParams(
    syntheticDriver({
      transports: [
        { kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: NUS_NOTIFY, delimiter: '' } },
      ],
    }),
  );
  assert.deepEqual(sinDelim, { ok: false, reason: 'delimitador-no-soportado' });

  // Contraprueba de que los tres motivos son DISTINTOS: si alguien los colapsara en uno, este test cae.
  const motivos = new Set([sinGatt, uuidMalo, sinDelim].map((r) => (r.ok ? 'ok' : r.reason)));
  assert.equal(motivos.size, 3);
});

test('RBM2.10: un delimitador declarado VACÍO no cae al default en silencio (`??`, no `||`)', () => {
  // El bug que este test caza: escribir `cap.params.delimiter || SPP_DELIMITER` haría que un `''`
  // —o sea, un lector declarado SIN fin de trama— se conecte con `\n` inventado. El resultado sería un
  // link abierto que no puede cerrar una línea: conectado y mudo, sin un error.
  const res = resolveBleGattParams(
    syntheticDriver({
      transports: [
        { kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: NUS_NOTIFY, delimiter: '' } },
      ],
    }),
  );
  assert.equal(res.ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RBM2.8/2.9/2.12 — reensamblado con el TROCEO REAL (MTU por defecto = 20 bytes de payload)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.12: el payload por notificación con MTU por defecto son 20 bytes (23 − 3 de ATT)', () => {
  assert.equal(BLE_DEFAULT_MTU, 23);
  assert.equal(BLE_DEFAULT_NOTIFY_PAYLOAD, 20);
});

/** Parte un texto en trozos de `size` bytes, como hace el emulador (`chunk 20`). */
function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

test('RBM2.8/2.12: la trama partida en trozos de 20 bytes se reensambla en UNA lectura', () => {
  const framer = new LineFramer(SPP_DELIMITER);
  const wire = `${RAW_FRAME}\n`;
  const trozos = chunk(wire, BLE_DEFAULT_NOTIFY_PAYLOAD);
  assert.ok(trozos.length >= 2, 'el fixture tiene que partirse de verdad (si no, no prueba nada)');
  const lines: string[] = [];
  for (const t of trozos) lines.push(...framer.push(t));
  assert.equal(lines.length, 1);
  assert.deepEqual(parseRs420Line(lines[0]), { eid: EID_982 });
});

test('RBM6.3: `chunk 20` y `chunk 0` (trama entera) dan el MISMO resultado', () => {
  const wire = `${RAW_FRAME}\n`;
  const troceado = new LineFramer(SPP_DELIMITER);
  const entero = new LineFramer(SPP_DELIMITER);
  const a: string[] = [];
  for (const t of chunk(wire, BLE_DEFAULT_NOTIFY_PAYLOAD)) a.push(...troceado.push(t));
  const b = entero.push(wire);
  assert.deepEqual(a, b);
});

test('RBM2.9: DOS tramas pegadas en una misma notificación son DOS lecturas', () => {
  const framer = new LineFramer(SPP_DELIMITER);
  const otra = RAW_FRAME.replace(EID_982, '982000364696051');
  const lines = framer.push(`${RAW_FRAME}\n${otra}\n`);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => parseRs420Line(l)?.eid), [EID_982, '982000364696051']);
});

test('RBM2.8: un trozo que corta EL STX no rompe nada (el byte de control queda en la línea)', () => {
  const framer = new LineFramer(SPP_DELIMITER);
  const wire = `${RAW_FRAME}\n`;
  // Primer trozo = SOLO el STX; el resto llega después.
  const lines = [...framer.push(wire.slice(0, 1)), ...framer.push(wire.slice(1))];
  assert.equal(lines.length, 1);
  assert.equal(lines[0].charCodeAt(0), 0x02);
  assert.deepEqual(parseRs420Line(lines[0]), { eid: EID_982 });
});

test('DEFECTO CONOCIDO, aserrado como tal: una trama SIN terminador se come la siguiente', () => {
  // No es un bug de este framer: sin fin de trama no hay forma de saber dónde termina una línea. Queda
  // escrito porque el desenlace correcto es que la trama pegada se RECHACE (el parser no la entiende),
  // no que se ingiera un EID equivocado — que es lo único inaceptable acá.
  const framer = new LineFramer(SPP_DELIMITER);
  const otra = RAW_FRAME.replace(EID_982, '982000364696051');
  const lines = framer.push(`${RAW_FRAME}${otra}\n`); // la primera viene sin su '\n'
  assert.equal(lines.length, 1, 'las dos tramas quedan pegadas en una sola línea');
  assert.equal(parseRs420Line(lines[0]), null, 'y esa línea se RECHAZA: nunca se ingiere un EID inventado');
});

test('RBM2.8: el framer corta por el delimitador DEL LECTOR (`\\r`), no por `\\n` hardcodeado', () => {
  // Es el 🟠-5 del SPP traído acá: con el delimitador hardcodeado, un lector que termina en CR dejaba la
  // app conectada y muda, con el buffer creciendo para siempre.
  const framer = new LineFramer('\r');
  const lines = framer.push(`\x02UNO\r\x02DOS\r`);
  assert.deepEqual(lines, ['\x02UNO', '\x02DOS']);
});

test('regresión: el framer SIN delimitador declarado sigue cortando por `\\n` (comportamiento previo)', () => {
  const framer = new LineFramer();
  assert.deepEqual(framer.push('a\nb\n'), ['a', 'b']);
  // Y un delimitador inválido cae al default en vez de colgarse: `indexOf('')` devuelve 0 SIEMPRE, así
  // que un framer con delimitador vacío entraría en un bucle infinito emitiendo líneas vacías. Quién
  // rechaza ese driver es el adapter, ANTES de conectar; esto es el cinturón.
  const roto = new LineFramer('');
  assert.deepEqual(roto.push('a\nb\n'), ['a', 'b']);
});

test('RBM2.8: multi-carácter (`\\r\\n`) consume el delimitador COMPLETO', () => {
  const framer = new LineFramer('\r\n');
  assert.deepEqual(framer.push('uno\r\ndos\r\n'), ['uno', 'dos']);
  // Sin el `+ delimiter.length`, el `\n` sobrante arrancaría la línea siguiente.
  assert.deepEqual(framer.push('tres\r\n'), ['tres']);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Opciones del escaneo y del connect (moldeadas sobre el FUENTE INSTALADO de la lib)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.12: el connect NO pide MTU (el reensamblado no depende de la negociación)', () => {
  const opts = bleConnectOptions(20_000);
  assert.deepEqual(opts, { autoConnect: false, timeout: 20_000 });
  assert.equal('requestMTU' in opts, false, 'pedir un MTU que el lector niegue solo agrega un modo de falla');
  // `autoConnect:false` a propósito: el modo autoConnect del SO reintenta por su cuenta, en background y
  // sin tope — exactamente la cadena sin gesto que RBM3.1/RBM3.6 vinieron a acotar.
  assert.equal(opts.autoConnect, false);
});

test('el escaneo no pide duplicados (un bastón anunciándose 10 veces por segundo no agrega nada)', () => {
  assert.deepEqual(bleScanOptions(), { allowDuplicates: false });
});
