// Motor de SELECCIÓN POR CAPACIDAD (RMV2; ADR-024 Enmienda 2026-07-20). PURO: sin React, sin
// device; las entradas (plataforma, driver, adaptadores construidos) se INYECTAN → 100%
// testeable sin hardware (RMV2.6). Determinístico (RMV2.8): la elección depende SOLO de
// (platformOS, driver.transports, builtAdapters), no del orden de descubrimiento.
//
// Extiende la selección del core (`selectTransportAdapter`, que elige el PISO por defecto por
// plataforma/modo) con la capa que la PANTALLA usa cuando el operario elige un device concreto:
// dado el driver del device, ¿qué adapter+transporte se monta en esta plataforma? El
// `selectTransportAdapter` NO cambia su firma ni su resultado para auto/mock/manual (RMV2.7).

import type { AdapterKind } from './adapter-selection';
import type { TransportKind, ReaderDriver } from './driver-types';

/** El binding resuelto de un driver en una plataforma (RMV2.3). */
export interface ReaderBinding {
  adapterKind: AdapterKind;
  transportKind: TransportKind;
  driver: ReaderDriver;
  /** ¿El `adapterKind` elegido está EFECTIVAMENTE construido en este build? (RMV2.4) */
  available: boolean;
}

/** Entradas inyectadas del motor de binding (RMV2.6). */
export interface BindingEnv {
  /** Platform.OS del runtime ('web' | 'ios' | 'android' | ...). */
  platformOS: string;
  driver: ReaderDriver;
  /** Adaptadores efectivamente construidos en este build (inyectable → testeable, RMV2.4). */
  builtAdapters: AdapterKind[];
}

/**
 * Tabla de PRIORIDAD DE TRANSPORTE por plataforma, determinística (RMV2.1). iOS es el cuello de
 * botella: HID (el camino iOS-abierto sin MFi) > GATT > MFi. Android prefiere el stream nativo:
 * SPP > GATT > HID. Web solo tiene el harness serial. Otra plataforma → sin transporte.
 */
export function platformTransportPriority(platformOS: string): TransportKind[] {
  switch (platformOS) {
    case 'ios':
      return ['ble-hid', 'ble-gatt', 'mfi'];
    case 'android':
      return ['spp', 'ble-gatt', 'ble-hid'];
    case 'web':
      return ['serial'];
    default:
      return [];
  }
}

/**
 * Mapea un (transporte, plataforma) al `AdapterKind` concreto que lo implementa (RMV2.2):
 *   - spp + android → 'spp-android'   (RS420 nativo por Classic SPP)
 *   - serial + web  → 'web-serial'    (harness Web Serial)
 *   - ble-hid       → 'hid-wedge'     (keyboard-wedge; GATED en el build → available:false)
 *   - ble-gatt      → null            (sin adapter concreto todavía; punto de extensión, RMV6.3)
 *   - mfi           → null            (gated por negocio: EA/MFi iOS, canal Facundo, RMV6.2)
 * `null` = "transporte reconocido pero sin adapter buildable en esta plataforma" → el motor
 * prueba el siguiente transporte de la prioridad.
 */
export function adapterForTransport(kind: TransportKind, platformOS: string): AdapterKind | null {
  switch (kind) {
    case 'spp':
      return platformOS === 'android' ? 'spp-android' : null;
    case 'serial':
      return platformOS === 'web' ? 'web-serial' : null;
    case 'ble-hid':
      return 'hid-wedge';
    case 'ble-gatt':
      return null; // futuro: adapter-ble-gatt (RMV6.3)
    case 'mfi':
      return null; // gated por negocio: adapter-ea-ios (RMV6.2)
  }
}

/**
 * Resuelve el `ReaderBinding` de un driver en una plataforma (RMV2.3/2.4/2.5/2.8): elige el
 * transporte de MAYOR PRIORIDAD (RMV2.1) que el driver soporte y que tenga un `AdapterKind`
 * mapeado (RMV2.2); marca `available` según si ese adapter está construido en el build
 * (`builtAdapters`, RMV2.4). Si NINGÚN transporte soportado tiene adapter mapeado en la
 * plataforma → `null` (RMV2.5): device "no reconocido/no alcanzable" + carga manual como piso.
 *
 * Consecuencia clave (design §4): el RS420 en iOS → `null` (declara solo spp+serial; en iOS
 * ninguno tiene adapter mapeado; su vía iOS real es MFi cuando llegue el `protocolString`). Un
 * driver HID en iOS → `{hid-wedge, ble-hid, available:false}` (HID gated). Determinístico: no
 * depende del orden de descubrimiento (RMV2.8) — recorre la prioridad fija.
 */
export function selectReaderBinding(env: BindingEnv): ReaderBinding | null {
  const priority = platformTransportPriority(env.platformOS);
  const supported = new Set(env.driver.transports.map((t) => t.kind));
  for (const transportKind of priority) {
    if (!supported.has(transportKind)) continue;
    const adapterKind = adapterForTransport(transportKind, env.platformOS);
    if (adapterKind == null) continue; // reconocido pero sin adapter buildable → probar el siguiente
    return {
      adapterKind,
      transportKind,
      driver: env.driver,
      available: env.builtAdapters.includes(adapterKind),
    };
  }
  return null; // no alcanzable en esta plataforma → 'no reconocido' + manual (RMV2.5)
}
