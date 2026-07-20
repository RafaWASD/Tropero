// Registro de drivers por fabricante (RMV1.4, RMV1.5, RMV1.7; ADR-024 Enmienda 2026-07-20).
// PURO (sin RN, sin I/O). El único punto donde se listan los fabricantes soportados: sumar una
// marca = agregar una fila acá (RMV1.6), sin tocar `contract.ts` / `stick-adapter.ts` / los
// adaptadores.

import { RS420_DRIVER } from './driver-rs420';
import type { ReaderDriver, DiscoveredDevice, DeviceMatcher } from './driver-types';

/** Todos los drivers soportados. El RS420 es el primero (RMV1.3). */
export const DRIVER_REGISTRY: ReaderDriver[] = [RS420_DRIVER];

/** Lookup de un driver por `vendorId` (RMV1.4). `null` si no existe. */
export function driverByVendorId(
  vendorId: string,
  registry: ReaderDriver[] = DRIVER_REGISTRY,
): ReaderDriver | null {
  return registry.find((d) => d.vendorId === vendorId) ?? null;
}

/**
 * ¿El `deviceMatch` de un driver reconoce a este device? (RMV1.5) — cruza el patrón de nombre
 * y/o los UUIDs de servicio anunciados con los datos del device descubierto. La comparación de
 * UUIDs es case-insensitive (el SO puede anunciarlos en minúsculas; `SPP_UUID` está en mayúsc.).
 */
function matchesDevice(matcher: DeviceMatcher, device: DiscoveredDevice): boolean {
  if (matcher.namePattern && typeof device.name === 'string' && matcher.namePattern.test(device.name)) {
    return true;
  }
  if (matcher.advertisedServiceUuids && device.advertisedServiceUuids) {
    const advertised = new Set(device.advertisedServiceUuids.map((u) => u.toLowerCase()));
    if (matcher.advertisedServiceUuids.some((u) => advertised.has(u.toLowerCase()))) {
      return true;
    }
  }
  return false;
}

/**
 * Resuelve el `ReaderDriver` de un device descubierto cruzando cada `deviceMatch` del registro
 * (RMV1.5). Devuelve el primer driver que matchea, o `null` si NINGUNO lo hace — en ese caso el
 * device es "no reconocido" y NO se intenta conectar como lector conocido (RMV1.7); la carga
 * manual queda operativa (piso permanente). El registro se inyecta (default `DRIVER_REGISTRY`)
 * para testear la aditividad (RMV1.6) con un registry sintético sin tocar el global.
 */
export function findDriverForDevice(
  device: DiscoveredDevice,
  registry: ReaderDriver[] = DRIVER_REGISTRY,
): ReaderDriver | null {
  return registry.find((d) => matchesDevice(d.deviceMatch, device)) ?? null;
}
