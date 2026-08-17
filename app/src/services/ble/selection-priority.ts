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
import { mfiAvailability, type MfiUnavailableReason } from './ea-protocols';

/**
 * Por qué un binding quedó `available:false`. Antes era solo un booleano y alcanzaba, porque el único
 * motivo posible era "el adapter no está construido en este build". Con MFi hay tres motivos más
 * (`ea-protocols.ts`) y la UI tiene que poder decir la verdad: "reconocemos este bastón pero esta
 * versión no tiene la autorización del fabricante para iPhone" no es lo mismo que "todavía no lo
 * soportamos" (RBM4.5 / RBM5.14).
 */
export type BindingUnavailableReason = 'adapter-no-construido' | MfiUnavailableReason;

/** El binding resuelto de un driver en una plataforma (RMV2.3). */
export interface ReaderBinding {
  adapterKind: AdapterKind;
  transportKind: TransportKind;
  driver: ReaderDriver;
  /** ¿El `adapterKind` elegido está EFECTIVAMENTE construido en este build? (RMV2.4) */
  available: boolean;
  /**
   * Motivo del `available:false`, SOLO cuando es false (la clave se omite si está disponible: así los
   * `deepEqual` de los bindings disponibles no cambian de forma y un `undefined` no se cuela como
   * "hay un motivo").
   */
  unavailableReason?: BindingUnavailableReason;
}

/** Entradas inyectadas del motor de binding (RMV2.6). */
export interface BindingEnv {
  /** Platform.OS del runtime ('web' | 'ios' | 'android' | ...). */
  platformOS: string;
  driver: ReaderDriver;
  /** Adaptadores efectivamente construidos en este build (inyectable → testeable, RMV2.4). */
  builtAdapters: AdapterKind[];
  /**
   * Las cadenas de protocolo MFi que el build declara (RBM5.5). REQUERIDA y sin default: el call site
   * de producción tiene que pasar `declaredEaProtocols()` o el binding MFi diría `available:false` para
   * siempre —incluso el día que la cadena del fabricante esté en el plist— y RBM4.7 ("cero código el
   * día que llegue el dato") sería falso sin que nada se pusiera rojo. Un default a `[]` es exactamente
   * el fallback silencioso que el review de F1 rechazó.
   */
  declaredEaProtocols: readonly string[];
}

/**
 * Tabla de PRIORIDAD DE TRANSPORTE por plataforma, determinística (RMV2.1 → **RBM5.1**).
 *
 * ── iOS CAMBIA EN ESTE DELTA: `['mfi','ble-gatt','ble-hid']` (antes `['ble-hid','ble-gatt','mfi']`) ──
 * El orden lo fijó el contexto aprobado del delta (§4: *"en iOS el orden pasa a ser mfi (si hay
 * protocolo) → ble-gatt → manual"*); acá se traduce, no se re-decide. El motivo escrito en RBM5.1:
 *   · **MFi primero**: cuando la cadena de protocolo existe, es un stream nativo del lector que el
 *     cliente YA TIENE (RS420 / SRS2i / XRS2i) y no depende de que el operario tenga un campo enfocado.
 *   · **GATT segundo**: es el camino abierto, pero hoy solo lo habla el Gallagher HR5 v3.
 *   · **HID último**: secuestra el teclado del SO y sigue GATEADO por el gate físico (RBM8).
 *
 * Android y web **no cambian** (RBM5.4): Android prefiere el stream nativo (SPP > GATT > HID) y web solo
 * tiene el harness serial. Otra plataforma → sin transporte.
 */
export function platformTransportPriority(platformOS: string): TransportKind[] {
  switch (platformOS) {
    case 'ios':
      return ['mfi', 'ble-gatt', 'ble-hid'];
    case 'android':
      return ['spp', 'ble-gatt', 'ble-hid'];
    case 'web':
      return ['serial'];
    default:
      return [];
  }
}

/**
 * Todos los `TransportKind`, ENUMERADOS A MANO, para que algo pueda recorrerlos en runtime (lo hace
 * `isAdapterUsableOn`). Vive acá y no en `driver-types.ts` para que ese módulo siga siendo SOLO TIPOS
 * (lo importa medio repo, incluido código que no quiere valores), y no en un test porque
 * `app/tsconfig.json` excluye `**​/*.test.ts`: una aserción de tipos escrita en un test **no la chequea
 * nadie**.
 */
export const TRANSPORT_KINDS = ['spp', 'serial', 'ble-gatt', 'ble-hid', 'mfi'] as const satisfies readonly TransportKind[];

// EXHAUSTIVIDAD en tiempo de compilación: si `TransportKind` gana un miembro que no está en
// `TRANSPORT_KINDS`, `Exclude<…>` deja de ser `never` y esta asignación NO COMPILA.
type TransportMissingFromList = Exclude<TransportKind, (typeof TRANSPORT_KINDS)[number]>;
const _transportKindsAreExhaustive: TransportMissingFromList extends never ? true : never = true;
void _transportKindsAreExhaustive;

/**
 * Mapea un (transporte, plataforma) al `AdapterKind` concreto que lo implementa (RMV2.2 → **RBM5.2**):
 *   - spp + android → 'spp-android'   (RS420 nativo por Classic SPP; fuera de Android `null`, RBM5.3)
 *   - serial + web  → 'web-serial'    (harness Web Serial)
 *   - ble-gatt + ios|android → 'ble-gatt'  (**NUEVO**: `adapter-ble-gatt`, el mismo código en los dos)
 *   - mfi + ios     → 'mfi-ios'       (**NUEVO**: `adapter-mfi-ios`, F5; su `available` lo decide
 *                                      además la lista de protocolos del build — ver abajo)
 *   - ble-hid       → 'hid-wedge'     (keyboard-wedge; GATED en el build → available:false)
 * `null` = "transporte reconocido pero sin adapter buildable en esta plataforma" → el motor
 * prueba el siguiente transporte de la prioridad.
 *
 * **`ble-gatt` va acotado a iOS y Android, y no libre** (RBM5.2 dice literalmente "en iOS y en
 * Android"): `react-native-ble-plx` no tiene implementación web, así que mapearlo en web dejaría que
 * un valor viejo de `localStorage` con `adapterKind:'ble-gatt'` (la preferencia de RBM5.6) montara un
 * transporte que en web no puede existir. Fail-closed, como el resto de este archivo.
 *
 * **`spp` sigue en `null` fuera de Android** (RBM5.3): `spp-android` NO se ofrece en iOS, ni siquiera
 * como binding "no disponible" — en iOS la vía del RS420 es MFi.
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
      return platformOS === 'ios' || platformOS === 'android' ? 'ble-gatt' : null;
    case 'mfi':
      return platformOS === 'ios' ? 'mfi-ios' : null;
  }
}

/**
 * ¿Este `AdapterKind` puede existir en esta plataforma? (lo consulta `selectTransportAdapter` antes de
 * honrar la preferencia del bastón recordado, RBM5.6.)
 *
 * Se **DERIVA** de `adapterForTransport` recorriendo los transportes en vez de escribir una segunda
 * tabla plataforma→adapter. No es elegancia: dos tablas de la misma verdad divergen (es el bug de clase
 * de este camino — `isRawStream`, `BLE_OWNED_ROUTES`, las tres copias de `toneColorToken`), y acá
 * divergir significaría montar en iOS un transporte que iOS no tiene, o negarle a Android el suyo.
 * Un mapeo nuevo en `adapterForTransport` queda cubierto solo.
 */
export function isAdapterUsableOn(kind: AdapterKind, platformOS: string): boolean {
  return TRANSPORT_KINDS.some((t) => adapterForTransport(t, platformOS) === kind);
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
 *
 * **`available` ya no es solo "el adapter está construido" (RBM5.5)**: para un binding `mfi-ios` es la
 * CONJUNCIÓN de "está construido" **y** "la `protocolString` del driver está declarada en el build"
 * (`mfiAvailability`, `ea-protocols.ts`). Las dos mitades tienen que ser ciertas para que abrir la
 * sesión tenga sentido, y el motivo de la que falle viaja en `unavailableReason` para que la UI diga la
 * verdad en vez de "todavía no disponible" (RBM4.5 / RBM5.14).
 *
 * El orden del chequeo es "construido primero": si el adapter no existe en este build, el estado del
 * plist es irrelevante y el motivo honesto es `adapter-no-construido` (no "falta el protocolo").
 */
export function selectReaderBinding(env: BindingEnv): ReaderBinding | null {
  const priority = platformTransportPriority(env.platformOS);
  const supported = new Set(env.driver.transports.map((t) => t.kind));
  for (const transportKind of priority) {
    if (!supported.has(transportKind)) continue;
    const adapterKind = adapterForTransport(transportKind, env.platformOS);
    if (adapterKind == null) continue; // reconocido pero sin adapter buildable → probar el siguiente
    const base = { adapterKind, transportKind, driver: env.driver };
    if (!env.builtAdapters.includes(adapterKind)) {
      return { ...base, available: false, unavailableReason: 'adapter-no-construido' };
    }
    if (transportKind === 'mfi') {
      const mfi = mfiAvailability(env.driver, env.declaredEaProtocols);
      return mfi.available
        ? { ...base, available: true }
        : { ...base, available: false, unavailableReason: mfi.reason };
    }
    return { ...base, available: true };
  }
  return null; // no alcanzable en esta plataforma → 'no reconocido' + manual (RMV2.5)
}
