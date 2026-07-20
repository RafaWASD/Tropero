// Driver del Allflex RS420 — el PRIMER `ReaderDriver` del registro (RMV1.3, ADR-024 Enmienda).
// PURO (sin RN, sin I/O). El RS420 es Bluetooth Classic SPP + serial (Web Serial harness); su
// vía iOS real es MFi (sin `protocolString` real hasta que Facundo lo consiga, RMV6.1/6.2 — no
// se popula acá).
//
// REUSO OBLIGATORIO (design §"Notas para el implementer"): `parseRs420Line` como `frameParser`
// (NO se reimplementa el parseo, RMV1.3), y `SPP_UUID`/`DEFAULT_BAUD` del core como params de
// conexión. Sumar OTRO lector SPP = agregar su driver, no reescribir nada.

import { SPP_UUID, DEFAULT_BAUD } from './config';
import { parseRs420Line } from './parser-rs420';
import type { ReaderDriver } from './driver-types';

/**
 * Allflex RS420 — el bastón que el cliente beta ya tiene (ADR-024 §3). Declara sus transportes
 * `spp` (RFCOMM `SPP_UUID`, PIN de pairing `1234`) y `serial` (baud `DEFAULT_BAUD`, harness
 * web-serial). `frameParser` reusa `parseRs420Line` tal cual. `deviceMatch` lo reconoce por
 * nombre (`RS 420` / `Allflex`) o por el UUID SPP anunciado. `streaming:true` (una línea ASCII
 * por lectura). NO declara `ble-hid`/`ble-gatt`/`mfi`: en iOS su binding queda `null` (carga
 * manual como piso) hasta que llegue el `protocolString` MFi (RMV2.5/RMV6.1).
 */
export const RS420_DRIVER: ReaderDriver = {
  vendorId: 'allflex-rs420',
  displayName: 'Allflex RS420',
  transports: [
    { kind: 'spp', params: { sppUuid: SPP_UUID, pin: '1234' } },
    { kind: 'serial', params: { baud: DEFAULT_BAUD } },
  ],
  frameParser: { parse: parseRs420Line },
  deviceMatch: {
    namePattern: /RS\s?420|allflex/i,
    advertisedServiceUuids: [SPP_UUID],
  },
  streaming: true,
};
