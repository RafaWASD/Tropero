// Tipos del REGISTRO DE DRIVERS por fabricante (delta multivendor, RMV1.1/1.2, RMV6.1;
// ADR-024 Enmienda 2026-07-20). PURO: solo tipos, sin RN ni I/O → importable desde código y
// desde node:test.
//
// Idea central (design §1): los adaptadores son POR TRANSPORTE (SPP / serial / BLE-HID /
// BLE-GATT / MFi); los FABRICANTES SON DATOS (`ReaderDriver`) que PARAMETRIZAN un adapter de
// transporte. Sumar una marca = agregar una fila al DRIVER_REGISTRY, sin tocar el contrato de
// ingesta (`contract.ts`), la interfaz `StickAdapter` (`stick-adapter.ts`) ni los adaptadores
// existentes (RMV1.6). El RS420 pasa a ser el primer driver (reusa `parser-rs420.ts` tal cual).
//
// NO redefine ningún tipo de spec 09 ni del core: son tipos NUEVOS que viven "entre" el
// descubrimiento del device y el adapter concreto.

/** Familia de transporte que un lector soporta (perspectiva del driver, no del adapter concreto). */
export type TransportKind = 'spp' | 'serial' | 'ble-hid' | 'ble-gatt' | 'mfi';

/**
 * Cómo un driver desframea una entrada de su transporte hasta el EID (RS420 → parseRs420Line).
 * Es exactamente la firma de `parseRs420Line` del core, para poder reusarlo sin adaptar (RMV1.3).
 */
export interface FrameParser {
  parse(raw: string): { eid: string } | null;
}

/**
 * Capacidad de transporte de un driver, DISCRIMINADA por `kind` (RMV1.2). Cada `kind` trae sus
 * `params` de conexión propios:
 *   - spp      → { sppUuid, pin?, delimiter? }  (RFCOMM del RS420, PIN de pairing, fin de trama)
 *   - serial   → { baud }                       (Web Serial exige un baud; el SPP virtual lo ignora)
 *   - ble-gatt → { serviceUuid, notifyCharUuid, delimiter? } (`adapter-ble-gatt`, delta ios-ble-mfi)
 *   - ble-hid  → sin params                     (teclado del SO, keyboard-wedge)
 *   - mfi      → { protocolString, delimiter? } (`adapter-mfi-ios` vía ExternalAccessory, RMV6.1)
 *
 * `delimiter` (2026-07-30, 🟠-5 del review + BENCH-2): el fin de trama es una propiedad del LECTOR,
 * no del transporte. Estaba hardcodeado en `\n` dentro de `sppConnectOptions()`, y un lector que
 * terminara con CR solo dejaba la app **conectada, muda, sin un error ni un log** — indistinguible de
 * "el operario no está bastoneando" (verificado en device: `term cr` → 0 ingestas, 0 errores). Peor:
 * el `StringBuffer` del nativo acumula sin cota, así que al corregir el terminador la PRIMERA trama
 * válida también se pierde, arrastrada por las anteriores (banco §4.4). Ahora el terminador sale del
 * driver; ausente = `\n` (el supuesto del RS420, documentado en `driver-rs420.ts`, no del transporte).
 *
 * `ble-gatt` gana el MISMO campo en el delta `ios-ble-mfi` (RBM2.8/RBM2.10, T3.3), y ahí pesa más
 * todavía: en GATT **no hay framing nativo** (las notificaciones son trozos de ≤ MTU−3 bytes), así que
 * el delimitador no es una preferencia sino la única forma de saber dónde termina una trama. Un
 * delimitador vacío NO abre la conexión (`resolveBleGattParams` → `delimitador-no-soportado`), en vez
 * de dejar al framer bufferando para siempre.
 *
 * `mfi` gana el mismo campo en **F5** (T5.2), y por el mismo motivo que el `spp`: el framing lo hace el
 * nativo (`DelimitedStringDeviceConnectionImpl` de la rama iOS) con el terminador que se le pase en la
 * opción `DELIMITER`, así que un lector que termine con CR y un default `\n` dejan la app **conectada,
 * muda, sin error y sin log** — el defecto que ya se pagó en device (BENCH-2). Ausente = `\n` (el
 * supuesto del RS420). ⚠️ En iOS el terminador tiene que ser de **UN carácter**: el `read()` nativo
 * consume el delimitador con `index(after:)` (avanza UNO), así que un `\r\n` deja el `\n` al frente del
 * mensaje siguiente. Lo rechaza `mfiDelimiterIsSupported` (`ea-protocols.ts`) ANTES de conectar, con su
 * motivo, en vez de partir mal cada trama. (En Android el multi-carácter sí funciona: el nativo avanza
 * `index + delimiter.length()`. Es una diferencia REAL entre las dos ramas de la misma librería.)
 */
export type TransportCapability =
  | { kind: 'spp'; params: { sppUuid: string; pin?: string; delimiter?: string } }
  | { kind: 'serial'; params: { baud: number } }
  | { kind: 'ble-gatt'; params: { serviceUuid: string; notifyCharUuid: string; delimiter?: string } }
  | { kind: 'ble-hid'; params: Record<string, never> }
  | { kind: 'mfi'; params: { protocolString: string; delimiter?: string } };

/** Canal por el que se descubre un device (cruza con `deviceMatch` para clasificar el transporte). */
export type DiscoveryChannel = 'classic-paired' | 'ble-advertised' | 'hid-keyboard' | 'serial-port';

/** Un dispositivo descubierto por algún canal, antes de resolver su driver (RMV1.5). */
export interface DiscoveredDevice {
  /** address / port id. */
  id: string;
  name?: string;
  channel: DiscoveryChannel;
  advertisedServiceUuids?: string[];
}

/** Cómo reconocer un lector al descubrirlo: por patrón de nombre y/o UUIDs de servicio anunciados. */
export interface DeviceMatcher {
  namePattern?: RegExp; // ej. /RS\s?420|allflex/i
  advertisedServiceUuids?: string[]; // ej. [SPP_UUID]
}

/**
 * La config de un fabricante detrás del contrato de ingesta (RMV1.1). Alias: `ReaderProfile`.
 * Agregar un fabricante = agregar una entrada de `ReaderDriver` al registro (RMV1.6).
 */
export interface ReaderDriver {
  vendorId: string; // 'allflex-rs420'
  displayName: string; // 'Allflex RS420'
  transports: TransportCapability[]; // qué transportes soporta el lector
  frameParser: FrameParser; // cómo desframea su stream/keystrokes hasta el EID
  deviceMatch: DeviceMatcher; // cómo reconocerlo al descubrir
  streaming: boolean; // true = stream por línea; false = keystroke wedge (HID)
}

/** Alias de `ReaderDriver` (RMV1.1: "ReaderDriver (alias ReaderProfile)"). */
export type ReaderProfile = ReaderDriver;
