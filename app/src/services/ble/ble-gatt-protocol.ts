// ble-gatt-protocol — piezas PURAS del transporte BLE GATT (RBM2.7/2.8/2.10/2.12). Espejo de
// `spp-protocol.ts`: sin RN, sin `react-native-ble-plx`, sin I/O → testeable bajo node:test.
// `adapter-ble-gatt.ts` hace SOLO la I/O; toda decisión de protocolo vive acá y se prueba sin device.
//
// ── LAS TRES DECISIONES DE PROTOCOLO QUE ESTE MÓDULO AÍSLA, Y POR QUÉ CADA UNA ES UN BUG SI SE ERRA
//
// 1. EL VALOR DE UNA NOTIFICACIÓN VIENE EN BASE64 Y SE DECODIFICA BYTE A BYTE (RBM2.7).
//    `react-native-ble-plx` entrega `Characteristic.value` como `?Base64` (verificado en el fuente
//    instalado: `src/Characteristic.js` → `value: ?Base64`; el nativo lo codifica así porque el puente
//    no transporta bytes crudos). La trama del RS420 arranca con `STX` (`0x02`) y sigue con dígitos
//    ASCII. Decodificarla como **UTF-8** rompería cualquier byte ≥ 0x80 de un lector futuro
//    (`TextDecoder` los reemplaza por U+FFFD) y el síntoma sería `parse_failed` INTERMITENTE — porque
//    el `normalizeTag` del contrato limpia los control chars DESPUÉS, así que el `STX` no se nota y lo
//    que se pierde son los bytes altos. Acá se decodifica **un byte = un carácter** (latin-1) y el
//    `STX` **sobrevive** hasta el `frameParser` del driver, que es quien lo tiene que descartar.
//
// 2. EL FIN DE TRAMA ES DEL LECTOR, NO DEL TRANSPORTE (RBM2.10 — lección 🟠-5 / BENCH-2 del SPP).
//    En GATT **no hay framing nativo**: las notificaciones son trozos de ≤ MTU−3 bytes y una trama
//    puede llegar partida o pegada a la siguiente. El reensamblado lo hace `LineFramer` con el
//    delimitador que declara el `TransportCapability` del driver. Un delimitador que este adaptador no
//    puede framear (vacío) **corta la conexión con log** en vez de abrirla: un lector que termina en
//    algo que no esperamos deja la app *conectada, muda, sin un error ni un log*, que es
//    indistinguible de "el operario no está bastoneando" (medido en device: `term cr` → 0 ingestas, 0
//    errores).
//
// 3. LOS UUID SE COMPARAN NORMALIZADOS (RBM2.4). El filtro del escaneo y la clasificación de lo que
//    llega tienen que cruzar UUIDs que vienen de DOS fuentes con formatos distintos: los del driver
//    (ADR-003 los escribe en MAYÚSCULAS y con guiones) y los del SO (los devuelve en minúsculas, y en
//    Android puede devolver la forma corta de 16 bits para servicios estándar). `react-native-ble-plx`
//    NO normaliza los argumentos que le pasamos: expone `fullUUID()` para eso y deja la decisión del
//    lado de JS (`src/Utils.js`). Este módulo no importa esa función a propósito — `Utils.js` importa
//    `Platform` de `react-native`, así que traerla metería RN en el grafo de un módulo que tiene que
//    ser importable desde `node:test`.

import type { ReaderDriver } from './driver-types';
// El default del fin de trama es el del RS420 (`\n`, captura de campo). Vive en `spp-protocol.ts` por
// dónde se escribió primero, NO porque sea una propiedad del transporte SPP: es un dato del LECTOR
// (ver `driver-rs420.ts`). Se importa en vez de recopiarlo para que un cambio del supuesto no quede a
// medias entre los dos transportes.
import { SPP_DELIMITER } from './spp-protocol';

/**
 * MTU por defecto de BLE y su payload útil (RBM2.12). No se usa para NEGOCIAR nada —justamente el
 * requisito es funcionar sin depender de que una negociación de MTU salga bien— sino para documentar
 * el tamaño de trozo con el que el reensamblado tiene que andar, y para que el banco (RBM6.3) tenga un
 * número contra el que comparar (`chunk 20` vs `chunk 0`).
 *
 * 23 bytes de MTU − 3 de cabecera ATT (opcode + handle) = 20 bytes de payload por notificación.
 */
export const BLE_DEFAULT_MTU = 23;
export const BLE_DEFAULT_NOTIFY_PAYLOAD = BLE_DEFAULT_MTU - 3;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Índice inverso del alfabeto base64 (se arma una vez, no por notificación). */
const B64_INDEX: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i += 1) map[B64_ALPHABET[i]] = i;
  return map;
})();

/**
 * base64 → bytes → **texto de un byte por carácter** (latin-1), conservando los bytes de control
 * (RBM2.7). `null` = no se pudo decodificar (valor ausente o base64 inválido) — el caller LO LOGUEA;
 * devolver `''` en ese caso convertiría una notificación corrupta en "no llegó nada", que es el
 * silencio indistinguible de "el operario no bastonea".
 *
 * ── POR QUÉ EL DECODER ES A MANO Y NO `atob` / `Buffer` ──────────────────────────────────────────
 * `Buffer` no existe en RN, y `atob` es un global que **depende del runtime**: lo trae Hermes en
 * versiones recientes y lo puede no traer un motor viejo o un test. Un decoder que existe "según
 * dónde corra" no es una base sobre la que apoyar el único camino por el que entra una lectura del
 * bastón: si falta, el síntoma es cero lecturas. Son 15 líneas de aritmética de 6 bits, sin
 * dependencias y con el MISMO comportamiento en node:test, en Hermes y en el navegador.
 *
 * `atob` además hace exactamente esto (un byte = un char), así que no se pierde nada; lo que se gana
 * es que el comportamiento sea nuestro y esté testeado.
 */
export function decodeBase64Ascii(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // El whitespace es legal en un base64 transmitido (MIME lo parte en líneas). Se saca antes de medir.
  const clean = value.replace(/[\s]/g, '');
  if (clean.length === 0) return '';
  const core = clean.replace(/=+$/, '');
  // Cualquier carácter fuera del alfabeto ESTÁNDAR es un valor que no entendemos (incluido base64url,
  // `-`/`_`: el nativo no lo emite, y adivinar sería inventar bytes).
  if (/[^A-Za-z0-9+/]/.test(core)) return null;
  // Un resto de 1 carácter no puede producir ningún byte: es un base64 truncado, no un valor válido.
  if (core.length % 4 === 1) return null;
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < core.length; i += 1) {
    acc = (acc << 6) | B64_INDEX[core[i]];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 0xff);
    }
  }
  return out;
}

/**
 * Un UUID a su forma canónica de 128 bits en MINÚSCULAS, o `null` si no es un UUID (RBM2.4). Acepta
 * las cuatro formas que aparecen de verdad: 16 bits (`180d`), 32 bits, 128 bits con guiones, y 128
 * bits sin guiones (algunos SO los devuelven así).
 *
 * Es case-insensitive porque ADR-003 escribe los Nordic UART en mayúsculas y el SO los devuelve en
 * minúsculas: comparar los strings tal cual haría que el filtro del escaneo **nunca matchee** y el
 * síntoma sería "escanea y no encuentra nada" con el bastón prendido al lado.
 */
export function normalizeUuid128(uuid: unknown): string | null {
  if (typeof uuid !== 'string') return null;
  const raw = uuid.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(raw)) return `0000${raw}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}$/.test(raw)) return `${raw}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)) return raw;
  if (/^[0-9a-f]{32}$/.test(raw)) {
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  return null;
}

// NOTA (autorrevisión de F3): acá había un `sameUuid(a, b)` que comparaba dos UUID normalizados. Se
// BORRÓ porque no tenía ni un call site de producción —el filtro del escaneo usa `normalizeUuid128` y
// las notificaciones llegan por la característica a la que nos suscribimos, así que no hay nada que
// cruzar— y sus únicos usos eran sus propios tests: cobertura que no mide nada del camino real. Si
// mañana hace falta comparar UUID de dos fuentes (p. ej. un driver que declare la forma corta de 16 bits
// y un SO que devuelva la de 128), el lugar es el cruce del `deviceMatch` en `driver-registry.ts`
// —hoy compara con `toLowerCase()` y NO expande la forma corta— y ahí entra con su test y su motivo.

/**
 * ¿Este fin de trama es framebale por `LineFramer`? (RBM2.10 — mismo criterio y mismo motivo que
 * `sppDelimiterIsSupported`: cortar antes que fingir).
 *
 * Un string VACÍO no es "el default": es *"no hay fin de trama"*, y con notificaciones de 20 bytes eso
 * significa que **ninguna línea se puede cerrar nunca** → el framer bufferea para siempre y el
 * transporte queda conectado y mudo, sin un error. Un lector que necesite ese modo (longitud fija,
 * timeout de silencio) necesita otro adapter, no este. Multi-carácter (`\r\n`) SÍ funciona.
 */
export function bleGattDelimiterIsSupported(delimiter: unknown): delimiter is string {
  return typeof delimiter === 'string' && delimiter.length > 0;
}

/** Los parámetros de conexión BLE GATT de un lector, ya normalizados. */
export interface BleGattParams {
  /** UUID del servicio, canónico de 128 bits en minúsculas (filtro del escaneo, RBM2.4). */
  serviceUuid: string;
  /** UUID de la característica de notificaciones, canónico (RBM2.6). */
  notifyCharUuid: string;
  /** Fin de trama DEL LECTOR (RBM2.8). Ausente en el driver = el del RS420 (`\n`). */
  delimiter: string;
}

/**
 * Motivo por el que un driver NO es alcanzable por este transporte. Son tres causas con tres acciones
 * distintas y por eso no comparten bolsa (misma lección que `parse_failed` vs `parser_threw`, 🟡-2 del
 * review de F1: dos fallas con un solo motivo producen un log byte-idéntico y nadie sabe qué mirar):
 *   · `driver-sin-ble-gatt`      → el lector no habla GATT. Acción: ninguna, es su capacidad.
 *   · `uuid-invalido`            → el driver está mal escrito. Acción: arreglar el DRIVER.
 *   · `delimitador-no-soportado` → el driver declara un fin de trama que no podemos framear. Acción:
 *                                  otro adapter, o corregir el dato del lector.
 */
export type BleGattParamsFailure = 'driver-sin-ble-gatt' | 'uuid-invalido' | 'delimitador-no-soportado';

export type BleGattParamsResult =
  | { ok: true; params: BleGattParams }
  | { ok: false; reason: BleGattParamsFailure };

/**
 * Resuelve los params del transporte `ble-gatt` del driver (RBM2.4/2.6/2.10). PURO y exportado →
 * testeable sin device: confirma que el adapter toma el servicio, la característica y el fin de trama
 * DEL DRIVER y no de una constante hardcodeada (que es lo que hacía que el registro de drivers fuera
 * decorativo, deuda RMV5.2).
 *
 * Devuelve un resultado DISCRIMINADO y no `null` a propósito: el adapter tiene que poder decir en el
 * log **por qué** no abre la conexión. Un `null` único obligaba a adivinar entre "este lector no habla
 * GATT" (normal) y "el driver está roto" (bug), que es justo la distinción que el operario no puede
 * hacer desde la UI (en los dos casos ve lo mismo: nada).
 */
export function resolveBleGattParams(driver: ReaderDriver): BleGattParamsResult {
  const cap = driver.transports.find((t) => t.kind === 'ble-gatt');
  if (!cap || cap.kind !== 'ble-gatt') return { ok: false, reason: 'driver-sin-ble-gatt' };
  const serviceUuid = normalizeUuid128(cap.params.serviceUuid);
  const notifyCharUuid = normalizeUuid128(cap.params.notifyCharUuid);
  if (serviceUuid == null || notifyCharUuid == null) return { ok: false, reason: 'uuid-invalido' };
  // `??` y no `||`: un delimitador declarado VACÍO tiene que llegar al chequeo de abajo y ser
  // rechazado con su motivo, no caer al default en silencio (RBM2.10).
  const delimiter = cap.params.delimiter ?? SPP_DELIMITER;
  if (!bleGattDelimiterIsSupported(delimiter)) return { ok: false, reason: 'delimitador-no-soportado' };
  return { ok: true, params: { serviceUuid, notifyCharUuid, delimiter } };
}

/**
 * Opciones del `startDeviceScan` (mapeadas a `ScanOptions` del fuente instalado,
 * `src/TypeDefinition.js`).
 *
 * `allowDuplicates: false` (iOS): un bastón anunciándose 10 veces por segundo no agrega información y
 * cada callback cruza el puente. El filtro por servicio va en el PRIMER argumento del
 * `startDeviceScan`, no acá (RBM2.4).
 */
export interface BleScanOptions {
  allowDuplicates: boolean;
}

export function bleScanOptions(): BleScanOptions {
  return { allowDuplicates: false };
}

/**
 * Opciones del `connectToDevice` (mapeadas a `ConnectionOptions` del fuente instalado).
 *
 * `timeout` es el tope que el NATIVO promete, y su propio JSDoc avisa que "may happen earlier than
 * specified due to OS specific behavior" — encima el bloque del interface está anotado `[Not used]`.
 * O sea: se pasa porque si el nativo lo respeta cierra el socket huérfano del lado correcto, pero
 * **el techo del que dependemos es el nuestro** (`withTimeout`, RBM3.2). Dos topes que se cubren
 * entre sí, ninguno que se crea solo.
 *
 * `autoConnect: false` (Android): el modo `autoConnect` del SO reintenta por su cuenta, en background
 * y sin tope — o sea, exactamente la cadena sin gesto que RBM3.1/RBM3.6 vinieron a acotar. El
 * reintento es NUESTRO (backoff + foreground-only + tope por trigger) para que sea observable.
 *
 * **NO** se pasa `requestMTU` (RBM2.12): el reensamblado no depende de que la negociación salga bien,
 * y pedir un MTU alto que el lector niegue solo agrega un modo de falla.
 */
export interface BleConnectOptions {
  autoConnect: boolean;
  timeout: number;
}

export function bleConnectOptions(timeoutMs: number): BleConnectOptions {
  return { autoConnect: false, timeout: timeoutMs };
}
