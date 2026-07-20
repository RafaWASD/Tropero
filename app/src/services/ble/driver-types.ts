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
 *   - spp      → { sppUuid, pin? }              (RFCOMM del RS420, PIN de pairing)
 *   - serial   → { baud }                       (Web Serial exige un baud; el SPP virtual lo ignora)
 *   - ble-gatt → { serviceUuid, notifyCharUuid } (futuro; sin adapter concreto todavía)
 *   - ble-hid  → sin params                     (teclado del SO, keyboard-wedge)
 *   - mfi      → { protocolString }             (arch-ready para iOS Classic vía Facundo, RMV6.1)
 */
export type TransportCapability =
  | { kind: 'spp'; params: { sppUuid: string; pin?: string } }
  | { kind: 'serial'; params: { baud: number } }
  | { kind: 'ble-gatt'; params: { serviceUuid: string; notifyCharUuid: string } }
  | { kind: 'ble-hid'; params: Record<string, never> }
  | { kind: 'mfi'; params: { protocolString: string } };

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
