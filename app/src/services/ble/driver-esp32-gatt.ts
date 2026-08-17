// Driver del EMULADOR ESP32 en `MODO_GATT` — el segundo `ReaderDriver` del registro (RBM5.12/RBM5.13,
// delta ios-ble-mfi T4.3). PURO (sin RN, sin I/O).
//
// ── QUÉ ES Y POR QUÉ ESTÁ EN EL REGISTRO DE PRODUCCIÓN ───────────────────────────────────────────
// Es el ÚNICO aparato con el que hoy se puede verificar el transporte BLE GATT de punta a punta
// (contexto §1.4): notifica la trama del RS420 partida en trozos de 20 bytes, que es exactamente lo que
// hay que reensamblar y donde el SPP se rompió. El Gallagher HR5 v3 —el único consumidor comercial
// conocido del transporte— **no lo tenemos** y su driver NO se inventa (RBM5.11).
//
// Vive en el `DRIVER_REGISTRY` de producción y no detrás de un gate de build (design §7/§12-D):
//   1. un `ReaderDriver` es **datos**, no un transporte: por sí solo no conecta nada, necesita un
//      dispositivo que matchee su nombre;
//   2. un registro condicional rompe el determinismo que RMV2.8 compró (las mismas entradas darían
//      bindings distintos según el build);
//   3. el gate del simulador (RMV4) existe por un motivo que acá NO aplica: que un EID **sintético** no
//      se declare ante SENASA. El emulador emite EIDs por un transporte real, igual que un lector.
// Lo que sí se toma del simulador es la honestidad del rótulo: el `displayName` dice que es un banco de
// pruebas, así que **nunca se presenta en la UI como un lector comercial** (RBM5.12, ADR-010: el ESP32
// es test rig, no producto).
//
// ⚠️⚠️ EL `deviceMatch` ES **SOLO POR NOMBRE** Y ESO ES UN INVARIANTE DE INTEGRIDAD (RBM5.13) ⚠️⚠️
// El **bridge de la balanza Vesta** (ADR-003) anuncia **LOS MISMOS UUID Nordic UART** que este emulador
// —son los UUID estándar de NUS, no algo propio— y se llama `VESTA_BRIDGE`
// (`CONTEXT/05-hardware-vesta.md`: `BLEDevice::init("VESTA_BRIDGE")`). Si este driver reconociera por
// `advertisedServiceUuids`, la app reconocería **el bridge de la balanza como un bastón**: el peso del
// animal entraría por el ingesta de EID. Con el match por nombre, el bridge queda *"no reconocido"* y
// **no accionable** (RMV1.7/RMV3.8), que es la conducta correcta. El test que lo demuestra está en
// `driver-registry.test.ts` (y muere si alguien le agrega `advertisedServiceUuids` a este matcher).

import { parseRs420Line } from './parser-rs420';
import { SPP_DELIMITER } from './spp-protocol';
import type { ReaderDriver } from './driver-types';

/**
 * UUIDs Nordic UART (ADR-003), los mismos que flashea el emulador en `MODO_GATT`
 * (`firmware/baston-emulator/baston-emulator.ino`: `NUS_SERVICE_UUID` / `NUS_TX_UUID`).
 *
 * Se declaran como constantes exportadas —y no inline— porque los tests del anti-colisión necesitan
 * nombrar EL MISMO servicio que anuncia el bridge de la balanza: la colisión es "el mismo UUID", así que
 * el fixture tiene que salir de acá y no de una copia que pueda quedar desincronizada.
 */
export const NUS_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
/** TX del NUS: ESP32 → teléfono (NOTIFY). Es la característica que el adapter monitorea. */
export const NUS_TX_CHAR_UUID = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';

/** Nombre con el que el emulador se anuncia en `MODO_GATT` (README del firmware). */
export const ESP32_GATT_ADVERTISED_NAME = 'EMU-GATT-STICK';

/**
 * Emulador ESP32 en `MODO_GATT` (RBM5.12). Declara **solo** `ble-gatt`: no habla SPP ni serial ni MFi,
 * así que en web su binding es `null` (carga manual como piso, RMV2.5) y en iOS/Android resuelve al
 * `adapter-ble-gatt`.
 *
 * - `frameParser`: **reusa** `parseRs420Line` (RMV1.3, no se reimplementa el parseo). El generador de
 *   tramas del emulador es compartido con su `MODO_SPP`, así que emite la trama del RS420 con su `STX`.
 * - `delimiter: SPP_DELIMITER` (`\n`): en GATT **no hay framing nativo** (las notificaciones son trozos
 *   de ≤ MTU−3 bytes), así que el fin de trama no es una preferencia sino la única forma de saber dónde
 *   termina una lectura. Se declara explícito aunque coincida con el default del framer para que un
 *   lector con otro terminador se resuelva agregando su driver y no tocando el adapter (🟠-5 del review
 *   del SPP: un CR solo dejaba la app conectada y muda, sin un error ni un log).
 * - `streaming: true`: una línea ASCII por lectura.
 */
export const ESP32_GATT_DRIVER: ReaderDriver = {
  vendorId: 'esp32-gatt-emu',
  // El rótulo dice lo que es (RBM5.12 / ADR-010). NO se toca sin volver a leer ese requisito: es lo que
  // impide que un banco de pruebas se presente como un lector comercial en la pantalla de conexión.
  displayName: 'Emulador ESP32 (banco de pruebas)',
  transports: [
    {
      kind: 'ble-gatt',
      params: {
        serviceUuid: NUS_SERVICE_UUID,
        notifyCharUuid: NUS_TX_CHAR_UUID,
        delimiter: SPP_DELIMITER,
      },
    },
  ],
  frameParser: { parse: parseRs420Line },
  // SOLO por nombre (RBM5.13). Ver el ⚠️⚠️ de la cabecera: el bridge de la balanza Vesta anuncia estos
  // MISMOS UUID NUS, así que agregar `advertisedServiceUuids` acá haría que la app reconozca la balanza
  // como un bastón. El emulador se anuncia `EMU-GATT-STICK` a propósito (y su comando `name` permite
  // forzar el estado "no reconocido" en el banco de F6).
  deviceMatch: { namePattern: /EMU-GATT-STICK/i },
  streaming: true,
};
