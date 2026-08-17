// adapter-ble-gatt — BLE GATT sobre `react-native-ble-plx`, CROSS-PLATFORM (RBM2, RBM3; ADR-024).
// `StickAdapter` real (`kind:'ble-gatt'`), parametrizado por el `ReaderDriver` del registro, con EL
// MISMO CÓDIGO en iOS y en Android (RBM2.1). Es el camino iOS-abierto real del mercado (el Gallagher
// HR5 v3 habla GATT) y en Android sirve igual, así que restringirlo a iOS sería trabajo extra para
// tener menos (design §12-B).
//
// ── ESTADO (2026-08-17): CÓDIGO + UNIT. EL STREAM REAL NO ESTÁ VERIFICADO ─────────────────────────
// La dep está instalada y vetada contra un build de Gradle real (`progress/veto_ble-plx.md`), y la
// máquina de estados entera se ejercita en `adapter-ble-gatt.test.ts` con el entorno inyectado. Lo que
// **NO** está verificado es que un dispositivo real notifique y que esto lea: eso es el banco del ESP32
// en `MODO_GATT` (RBM6.1, fase F6) y hasta entonces este archivo NO se puede leer como "el transporte
// anda". Es la lección literal de `dad711f`: un transporte "escrito y testeado" sin device tenía TRES
// bloqueantes 🔴 de máquina de estados. Por eso las diez lecciones de abajo se implementan ACÁ y no se
// redescubren en device.
//
// ── LAS DIEZ LECCIONES DEL SPP, IMPLEMENTADAS (RBM3, `progress/impl_baston-spp-bloqueantes.md`) ────
// Los tres 🔴 del SPP no fueron accidentes de una librería: son defectos de la máquina de estados EN
// LOS BORDES, y reaparecen en cualquier transporte con radio, latch y eventos del SO.
//
// 1. 🔴 "CONECTADO" MENTIROSO (RBM3.5 / BENCH-1). Si el link se cae con la app MINIMIZADA, el evento
//    de desconexión se puede perder y la pantalla queda diciendo "conectado, la lectura entra sola"
//    para siempre, con cada bastonazo al vacío. Acá hay una SEGUNDA FUENTE DE VERDAD
//    (`manager.isDeviceConnected(id)`, que consulta el estado real del GATT del lado nativo) sondeada
//    AL VOLVER A FOREGROUND **y** por un poll periódico, y FAIL-CLOSED: ante duda no se sigue
//    afirmando "conectado". Y en este transporte hay un motivo EXTRA para no confiar en el evento: el
//    `onDeviceDisconnected` de la lib filtra con `deviceIdentifier !== nativeDevice.id` — comparación
//    EXACTA de strings, dentro de la lib, que no podemos tolerar por mayúsculas como sí hacemos
//    nosotros en el SPP. Si el nativo devolviera el id con otro case, el evento NO LLEGA nunca.
// 2. 🔴 LATCH SIN TIMEOUT (RBM3.2). TODO await que cruza el puente va con presupuesto
//    (`bridge-timeout.ts`), el latch se libera en el `finally` **y** en `disconnect()`, y hay
//    GENERACIÓN de intento para que uno viejo que despierta no pise al vigente.
// 3. 🔴 EVENTO DE DESCONEXIÓN GLOBAL (RBM3.4). Se usa la suscripción POR DEVICE
//    (`device.onDisconnected`), no un listener global: en el SPP, apagar unos auriculares le cerraba
//    el socket al bastón.
// 4. 🟠 FOREGROUND AL DISPARAR y no al programar (RBM3.6).
// 5. 🟠 UN `connect()` A OTRO BASTÓN con un intento en curso se ENCOLA, no se descarta en silencio
//    (RBM3.7).
// 6. 🟡 DWELL DEL BACKOFF (RBM3.9): el contador se resetea solo si el link DURÓ `LINK_DWELL_MS`.
// 7. 🟠 MUDEZ (RBM3.10): conectado y sin un byte durante el presupuesto de silencio queda ESCRITO
//    (`connected_silent`), sin desconectar.
// 8. 🔴 CADENA SIN GESTO ACOTADA (RBM3.1): la política por `ConnectTrigger` (`connect-trigger.ts`),
//    sin duplicar la lógica.
// 9. 🟠 NINGÚN DIÁLOGO DEL SO DESDE UN CAMINO AUTOMÁTICO (RBM3.8): los caminos automáticos CONSULTAN
//    el permiso (`checkPermissions`) y **nunca** se pide prender la radio (ver "la radio" abajo).
// 10. 🟠 EL FIN DE TRAMA SALE DEL DRIVER (RBM2.10): un delimitador que no podemos framear NO abre la
//    conexión, con log — en vez de conectar y quedarse mudo sin un error.
//
// ── LO QUE ES DISTINTO DEL SPP, Y POR QUÉ ────────────────────────────────────────────────────────
// · `LineFramer` **SÍ** se usa acá. En SPP el framing lo hace el nativo (`DelimitedString…`) y meterle
//   `LineFramer` encima devolvía `[]` para siempre (el bug de "cero lecturas"). En GATT **no hay
//   framing nativo**: las notificaciones son trozos de ≤ MTU−3 bytes y el emulador parte la trama a
//   propósito. Acá el framer es exactamente la pieza correcta (RBM2.8/2.9).
// · El valor de la notificación viene en **base64** y se decodifica byte a byte (RBM2.7,
//   `ble-gatt-protocol.ts`).
// · **DESCUBRIMIENTO por escaneo** en vez de "lista de emparejados": filtrado por el `serviceUuid` del
//   driver (RBM2.4) y ACOTADO por presupuesto (RBM2.5) — un escaneo que nadie apaga es el equivalente
//   BLE del latch eterno.
// · **LA RADIO NO SE PIDE PRENDER, NUNCA.** El SPP muestra el diálogo "¿activar Bluetooth?" cuando el
//   operario lo pidió. Acá **no se llama a `manager.enable()`** por decisión explícita: (a) en iOS no
//   existe esa API —la única salida es que el usuario vaya a Ajustes—, así que un camino que dependa de
//   ella sería Android-only en un transporte que se declara cross-platform; (b) `enable()` está
//   deprecado desde API 33 y falla en silencio; (c) es la forma más simple de cumplir RBM3.8 sin
//   depender de acertar el trigger. Con la radio apagada se emite un estado (con CTA) y se loguea el
//   motivo; el copy de la pantalla es el que le dice al operario qué prender.
//
// IMPORT PEREZOSO (RBM2.2, patrón `feedback.ts` / `adapter-spp-android.ts`): `react-native-ble-plx` y
// `react-native` se `require` DENTRO de las funciones, envueltos en try/catch — NUNCA top-level.
// Importar este módulo NO tira en web/CI sin el módulo nativo (cubierto en el test). Los imports
// top-level son SOLO tipos + módulos PUROS.
//
// INYECCIÓN DE ENTORNO (`BleEnv`, espejo de `SppEnv`, RBM3.11): toda la I/O —cargar el manager, pedir/
// consultar permisos, leer/escribir el bastón recordado, foreground, timers, reloj, presupuestos—
// entra por constructor con defaults reales. Es lo que baja el gate de hardware de "todo el transporte"
// a "solo el stream".

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import type { DiscoveredDevice, ReaderDriver } from './driver-types';
import { DRIVER_REGISTRY, findDriverForDevice } from './driver-registry';
import { LineFramer, backoffDelayMs } from './line-framer';
import {
  bleConnectOptions,
  bleScanOptions,
  decodeBase64Ascii,
  resolveBleGattParams,
  type BleGattParams,
} from './ble-gatt-protocol';
import {
  DEFAULT_BRIDGE_TIMINGS,
  withTimeout,
  withTimeoutOr,
  isBridgeTimeout,
  type BridgeTimings,
} from './bridge-timeout';
import {
  policyFor,
  LINK_DWELL_MS,
  UNPROMPTED_RETRY_BUDGET_MS,
  type ConnectTrigger,
} from './connect-trigger';
import {
  ensureAndroidBluetoothPermissions,
  checkAndroidBluetoothPermissions,
  type BluetoothPermissionOutcome,
} from './permissions-android';
import { logTransportEvent } from './logging';

// ── Superficie de `react-native-ble-plx` que usamos, MODELADA LOCALMENTE ─────────────────────────
// Se modela a mano (y no se importan sus tipos) por el mismo motivo que en el SPP: no meter la lib en
// el grafo de módulos de web/CI. Cada firma sale del FUENTE INSTALADO (`src/BleManager.js`,
// `src/Device.js`, `src/Characteristic.js` de la 3.5.1), no del README — es la lección literal del SPP,
// donde el diseño escrito desde el README describía un adapter que no leía nada.

export interface BleSubscription {
  remove(): void;
}

/** `Characteristic` de la lib: el valor de una notificación llega en **base64** (`value: ?Base64`). */
export interface BleCharacteristicLike {
  value?: string | null;
}

/**
 * `Device` de la lib. `name` y `localName` son DOS campos distintos y pueden diferir (el GAP name y el
 * nombre del anuncio); el emulador se identifica por el del anuncio, así que el reconocimiento prueba
 * los dos.
 */
export interface BleDeviceLike {
  id: string;
  name?: string | null;
  localName?: string | null;
  serviceUUIDs?: string[] | null;
  discoverAllServicesAndCharacteristics(): Promise<unknown>;
  monitorCharacteristicForService(
    serviceUuid: string,
    characteristicUuid: string,
    listener: (error: unknown, characteristic: BleCharacteristicLike | null) => void,
  ): BleSubscription;
  onDisconnected(listener: (error: unknown, device: BleDeviceLike | null) => void): BleSubscription;
  cancelConnection(): Promise<unknown>;
}

export interface BleManagerLike {
  /** Estado de la radio: 'PoweredOn' | 'PoweredOff' | 'Unauthorized' | 'Unsupported' | … */
  state(): Promise<string>;
  /**
   * `startDeviceScan(UUIDs, options, listener)`. El primer argumento ES el filtro por servicio
   * (RBM2.4): `null` = escanear TODO, que es justo lo que el requisito prohíbe. Devuelve una promesa
   * que puede RECHAZAR (permiso, radio apagada) — y en ese caso el listener no se llama nunca, así que
   * el rechazo hay que atenderlo o el escaneo se queda esperando su presupuesto entero para nada.
   */
  startDeviceScan(
    uuids: string[] | null,
    options: Record<string, unknown> | null,
    listener: (error: unknown, device: BleDeviceLike | null) => void,
  ): Promise<void>;
  stopDeviceScan(): Promise<void>;
  connectToDevice(id: string, options?: Record<string, unknown>): Promise<BleDeviceLike>;
  // ⚠️ `cancelDeviceConnection(id)` de la lib NO se modela ACÁ A PROPÓSITO, y la ausencia es un guard, no
  // un olvido (🟡-3 del review de F3): cierra la conexión de ESA DIRECCIÓN, no la que abrió este intento,
  // así que un intento vencido que la llame le mata el link al que conectó después (ver
  // `canCloseOrphanLink`). Estaba declarada sin un solo call site de producción; ahora un call site nuevo
  // NO COMPILA hasta que alguien decida —por escrito— que cerrar por id es lo correcto en ese lugar.
  /**
   * SEGUNDA FUENTE DE VERDAD del liveness (RBM3.5 / BENCH-1): consulta el estado real de la conexión
   * GATT del lado nativo, sin depender de que ningún evento haya llegado a JS. Opcional en esta
   * interfaz por prudencia (una versión futura podría no tenerlo): sin ella no hay sonda y se lo dice
   * el log, en vez de fingir que el link está sano.
   */
  isDeviceConnected?(id: string): Promise<boolean>;
}

/** Qué timer es cada uno (los tests filtran por acá; un timer nuevo tiene que nombrarse). */
export type BleTimerLabel = 'reconnect' | 'watchdog' | 'scan';

/**
 * Los tiempos de este transporte: los del puente (`BridgeTimings`, compartidos con el SPP) **más** el
 * presupuesto del ESCANEO, que es propio de BLE.
 *
 * `scan` = 10 s. Un bastón prendido y en rango aparece en menos de 2 s (anuncia cada 100-500 ms), así
 * que 10 s cubre de sobra el caso "lo prendí recién" sin dejar la radio escaneando de gusto en la
 * manga. NO se extiende `BridgeTimings` con este campo a propósito: ese tipo lo comparten el SPP y
 * `remembered-device.ts`, y meterle un presupuesto que solo usa un transporte los obligaría a
 * declararlo sin tener qué hacer con él.
 */
export interface BleTimings extends BridgeTimings {
  scan: number;
}

export const DEFAULT_BLE_TIMINGS: BleTimings = {
  ...DEFAULT_BRIDGE_TIMINGS,
  scan: 10_000,
};

/** Entorno de I/O del adapter (espejo de `SppEnv`). Los defaults son los reales; los tests inyectan. */
export interface BleEnv {
  loadManager: () => BleManagerLike | null;
  /** PIDE los permisos (muestra el diálogo del SO si hace falta). Solo desde un GESTO del operario. */
  ensurePermissions: () => Promise<BluetoothPermissionOutcome>;
  /**
   * CONSULTA los permisos sin pedirlos. La usan los caminos que el operario NO pidió en ese instante:
   * la reconexión al abrir la app (R6.4) y la cadena de reintentos. Campo OBLIGATORIO a propósito —no
   * un opcional con caída a `ensurePermissions`—: un `BleEnv` nuevo que se olvide de declararlo no
   * compila, en vez de empezar a mostrar diálogos de permisos desde un timer en silencio (RBM3.8).
   */
  checkPermissions: () => Promise<BluetoothPermissionOutcome>;
  readRemembered: () => Promise<string | null>;
  writeRemembered: (deviceId: string) => Promise<void>;
  isForeground: () => boolean;
  /** Programa un timer etiquetado. Devuelve un cancelador. */
  schedule: (fn: () => void, ms: number, label: BleTimerLabel) => () => void;
  /** Suscribe al retorno a foreground. Devuelve unsubscribe. */
  onForeground: (cb: () => void) => Unsubscribe;
  /** Reloj inyectable (dwell del backoff + medición de la mudez). Default `Date.now`. */
  now?: () => number;
  /**
   * Presupuestos de los awaits del puente + períodos de los timers + presupuesto del escaneo. Default
   * `DEFAULT_BLE_TIMINGS`. Un valor ≤ 0 significa "sin timeout" / "sin poll": es la puerta explícita
   * para los tests que no ejercitan el vencimiento, NO un valor válido de producción.
   */
  timeouts?: Partial<BleTimings>;
}

// ─── Carga del módulo nativo (perezosa) y disponibilidad del transporte ──────────────────────────

/**
 * El `BleManager` de la lib es un SINGLETON (`BleManager.sharedInstance`, verificado en el fuente: el
 * constructor devuelve la instancia previa si existe). Se cachea igual acá para no repetir el `require`
 * ni el chequeo de `NativeModules` en cada intento.
 */
let cachedManager: BleManagerLike | null = null;

/**
 * Require PEREZOSO del manager (RBM2.2). `null` si la lib no está instalada o si el MÓDULO NATIVO no
 * está registrado en ESTE build (dev build anterior a la dep / Expo Go / web).
 *
 * El chequeo es del MÓDULO NATIVO (`NativeModules.BlePlx`) y no del paquete JS, por el mismo motivo que
 * en el SPP: `react-native-ble-plx` resuelve igual desde `node_modules` aunque el binario no esté en el
 * APK/IPA, y en ese caso `new BleManager()` tira RECIÉN al construirse (su constructor llama
 * `BleModule.createClient(...)` y `new NativeEventEmitter(BleModule)` con `BleModule === undefined`).
 * Sin este chequeo montaríamos un transporte fantasma → un CTA que promete y no cumple, que es
 * exactamente el bug que cerró el fix del chip (2026-07-29).
 *
 * ⚠️ Leer `NativeModules.BlePlx` INSTANCIA el módulo nativo en bridgeless. Eso es seguro para este
 * paquete porque `NSBluetoothAlwaysUsageDescription` **está declarada** (verificado en el plist real en
 * F2, RBM2.17): sin esa clave, instanciar CoreBluetooth aborta el proceso (ITMS-90683 / el defecto del
 * build 5 de iOS). El guard de purpose strings es lo que mantiene esa condición viva.
 */
export function loadBleManager(): BleManagerLike | null {
  if (cachedManager != null) return cachedManager;
  // ── PRIMER TRAMO: ¿estamos en un runtime con RN y con el binario? ────────────────────────────────
  // Va en su PROPIO try y **en silencio**: en web y en CI `react-native` no resuelve, y eso es lo
  // esperado, no una falla. Loguearlo acá llenaría el log de la suite con ruido que no significa nada.
  let nativeModulePresent = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native') as typeof import('react-native');
    nativeModulePresent = NativeModules != null && (NativeModules as Record<string, unknown>).BlePlx != null;
  } catch {
    return null; // sin RN: no hay transporte BLE y no hay nada que reportar
  }
  if (!nativeModulePresent) return null;
  // ── SEGUNDO TRAMO: el binario está y el manager NO se pudo construir ─────────────────────────────
  // Este SÍ se loguea, y la distinción es el punto: un try/catch mudo acá convertiría "la lib explotó
  // al inicializarse" en "el operario no está bastoneando" — el transporte simplemente no se montaría y
  // no habría NADA que lo explicara (es el hallazgo del review de F1).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-ble-plx') as { BleManager?: new () => BleManagerLike };
    if (typeof mod?.BleManager !== 'function') {
      logTransportEvent({ kind: 'connect_error', message: 'ble_manager_load_failed: sin BleManager' });
      return null;
    }
    cachedManager = new mod.BleManager();
    return cachedManager;
  } catch (e) {
    logTransportEvent({ kind: 'connect_error', message: `ble_manager_load_failed: ${errorMessage(e)}` });
    return null;
  }
}

/**
 * El primer `ReaderDriver` del registro que declara el transporte `ble-gatt`, o `null` si ninguno lo
 * hace. PURA (el registro se inyecta) y exportada para poder testear las dos ramas sin device.
 *
 * ── POR QUÉ "EL PRIMERO" ES ACEPTABLE HOY, Y CÓMO NACE EN ROJO CUANDO DEJE DE SERLO ──────────────
 * Elegir cuál lector se monta cuando hay varios candidatos es RBM5.6 (fase F4): sale del **bastón
 * recordado**, no de la posición en una lista. Mientras el registro tenga UN solo driver con `ble-gatt`
 * (hoy: NINGUNO — el del emulador lo agrega F4), "el primero" es determinístico y no hay decisión que
 * tomar. Para que eso no se convierta en un fallback silencioso el día que aparezca el segundo (el
 * Gallagher HR5 v3, cuando Gallagher entregue su documentación), `adapter-ble-gatt.test.ts` tiene un
 * guard que **falla si el registro llega a declarar dos** drivers `ble-gatt` sin que la preferencia de
 * F4 esté cableada. Es el mismo patrón del `DRIVER_REGISTRY[0].frameParser` que el review de F1
 * rechazó, con la diferencia de que acá está declarado, acotado y vigilado.
 */
export function bleGattDriverFrom(registry: ReaderDriver[] = DRIVER_REGISTRY): ReaderDriver | null {
  return registry.find((d) => d.transports.some((t) => t.kind === 'ble-gatt')) ?? null;
}

/**
 * ¿Este build puede hablar BLE GATT en este dispositivo? Lo consulta `instantiateTransport` ANTES de
 * montar el adapter (RBM2.3): si es false NO se monta transporte y la app queda manual-first, con el
 * chip y el CTA ocultos por el guard de `hasTransport`.
 *
 * Son DOS condiciones y las dos se loguean por separado, porque tienen causas y arreglos distintos:
 *   · sin módulo nativo → el build no trae el binario (o es web/CI). Nada que hacer en runtime.
 *   · sin driver `ble-gatt` en el registro → no hay a QUÉ conectarse: sin `serviceUuid` no hay filtro
 *     de escaneo posible. Montar el adapter igual sería un transporte que no puede ni buscar.
 */
export function isBleGattTransportAvailable(registry: ReaderDriver[] = DRIVER_REGISTRY): boolean {
  if (bleGattDriverFrom(registry) == null) {
    logTransportEvent({ kind: 'connect_error', message: 'ble_unavailable: no_ble_gatt_driver' });
    return false;
  }
  if (loadBleManager() == null) {
    logTransportEvent({ kind: 'connect_error', message: 'ble_unavailable: no_native_module' });
    return false;
  }
  return true;
}

/**
 * SOLO PARA TESTS: suelta el manager cacheado. En producción vive lo que vive el proceso (es un
 * singleton de la lib); un test que inyecta un manager falso no puede arrastrarlo al siguiente.
 */
export function __resetBleModuleStateForTests(): void {
  cachedManager = null;
}

// ─── Helpers puros de este módulo ────────────────────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e != null && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    // Los errores de `react-native-ble-plx` son `BleError` con `errorCode` numérico; si el mensaje no
    // vino, el código es lo único que distingue "radio apagada" de "device desconectado".
    const code = (e as { errorCode?: unknown }).errorCode;
    if (code != null) return `errorCode:${String(code)}`;
  }
  return 'unknown';
}

/**
 * Log uniforme de un await del puente que falló o venció, con dos kinds distintos a propósito: hay que
 * poder separar "el nativo contestó un error" de "el nativo NO contestó". Si el error ES un
 * vencimiento, gana SU `label`/`ms` sobre los del caller (el que sabe qué await se perdió es el
 * `withTimeout` que lo envolvió). Copia deliberada del helper del SPP: son dos archivos con el mismo
 * borde y compartirlo obligaría a exportar ruido desde un adapter hacia el otro.
 */
function logBridgeFailure(label: string, ms: number, error: unknown): void {
  if (isBridgeTimeout(error)) logTransportEvent({ kind: 'bridge_timeout', label: error.label, ms: error.ms });
  else logTransportEvent({ kind: 'connect_error', message: `${label}: ${errorMessage(error)}` });
}

function timeoutOf(env: Pick<BleEnv, 'timeouts'>, key: keyof BleTimings): number {
  return env.timeouts?.[key] ?? DEFAULT_BLE_TIMINGS[key];
}

/** Estados de la radio en los que NO se puede conectar, con qué significa cada uno para la UI. */
export const BLE_STATE_POWERED_ON = 'PoweredOn';
export const BLE_STATE_UNAUTHORIZED = 'Unauthorized';
export const BLE_STATE_UNSUPPORTED = 'Unsupported';

/** Entorno real (defaults del constructor). Cada pieza de I/O va con require perezoso + try/catch. */
export function defaultBleEnv(): BleEnv {
  return {
    loadManager: loadBleManager,
    // El transporte va EXPLÍCITO (RBM2.13): la tabla de permisos es POR TRANSPORTE y el conjunto del
    // BLE no es el del SPP (el BLE escanea). El parámetro no tiene default a propósito.
    ensurePermissions: () => ensureAndroidBluetoothPermissions('ble-gatt'),
    checkPermissions: () => checkAndroidBluetoothPermissions('ble-gatt'),
    readRemembered: async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { readRememberedDevice } = require('./remembered-device') as typeof import('./remembered-device');
        return await readRememberedDevice();
      } catch {
        return null;
      }
    },
    writeRemembered: async (deviceId: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { writeRememberedDevice } = require('./remembered-device') as typeof import('./remembered-device');
        await writeRememberedDevice(deviceId);
      } catch {
        // best-effort: si falla, la próxima vez se elige el device de nuevo
      }
    },
    isForeground: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AppState } = require('react-native') as typeof import('react-native');
        return AppState.currentState === 'active';
      } catch {
        return true; // sin RN (CI) no gateamos por foreground
      }
    },
    schedule: (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    onForeground: (cb: () => void) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AppState } = require('react-native') as typeof import('react-native');
        const sub = AppState.addEventListener('change', (state: string) => {
          if (state === 'active') cb();
        });
        return () => sub.remove();
      } catch {
        return () => undefined;
      }
    },
  };
}

export class BleGattAdapter implements StickAdapter {
  readonly kind = 'ble-gatt' as const;

  /**
   * El lector con el que este adapter habla (RBM1.3). **INMUTABLE por instancia** (`readonly`, entra
   * por constructor) y eso NO es un detalle de estilo:
   *
   * el provider resuelve el `ReadSource` —o sea CON QUÉ PARSER se desframea— UNA VEZ al cablear el
   * adaptador, no por bastonazo (`readSourceFor`, F1). Si elegir un device en el escaneo MUTARA el
   * driver de un adapter ya montado, el `ReadSource` quedaría con el parser viejo y el transporte
   * nacería MUDO: conecta, recibe tramas y no ingiere ni una, con 0 lecturas y 0 errores. Es la
   * advertencia que el reviewer de F1 dejó escrita para esta fase (⚪-3), y se cierra por la opción (a)
   * del design: el driver no se muta nunca; cambiar de lector es construir OTRA instancia (que es lo
   * que hace `instantiateTransport` al re-montar, y lo que F4 cablea con el bastón recordado).
   *
   * El escaneo, por lo tanto, NO "descubre" el driver: filtra por el `serviceUuid` de ESTE driver y
   * solo acepta los devices que ESTE driver reconoce (`deviceMatch`).
   */
  readonly driver: ReaderDriver;
  private readonly env: BleEnv;
  private tagListeners = new Set<(rawLine: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;
  private device: BleDeviceLike | null = null;
  private monitorSub: BleSubscription | null = null;
  private disconnectSub: BleSubscription | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private cancelScheduled: (() => void) | null = null;
  private cancelWatchdog: (() => void) | null = null;
  private unsubForeground: Unsubscribe | null = null;
  private unsubLiveness: Unsubscribe | null = null;
  private currentDeviceId: string | null = null;
  /**
   * Generación del INTENTO de conexión (🔴-1 (b) del review del SPP). La toma cada `runConnect`; un
   * `disconnect()` o un connect nuevo la incrementan, y el intento viejo —que puede estar suspendido en
   * un await del puente— se da cuenta al despertar de que ya no es el vigente, cierra lo que hubiera
   * abierto y se va sin tocar el estado. Es lo que permite que `disconnect()` LIBERE EL LATCH sin abrir
   * la ventana de dos intentos pisándose.
   */
  private connectGeneration = 0;
  /** Generación que tiene el latch tomado (null = libre). Nunca un booleano: ver arriba. */
  private inFlightGen: number | null = null;
  /** Target del intento en curso (null = "el recordado"). Para decidir si un connect nuevo es OTRO. */
  private inFlightTarget: string | null = null;
  /** Bastón pedido MIENTRAS había un intento en curso: se atiende al terminar (RBM3.7). */
  private pendingTarget: string | null = null;
  /** Cuándo se estableció el link vigente (dwell del backoff, RBM3.9). null = no hay link. */
  private connectedAt: number | null = null;
  /** Cuándo llegó el último byte (watchdog de conectado-y-mudo, RBM3.10). */
  private lastDataAt = 0;
  /** Hasta cuándo puede reintentar la cadena vigente. `null` = SIN tope (la arrancó un gesto). */
  private retryBudgetUntil: number | null = null;
  /** Cuándo arrancó la cadena vigente (para poder decir en el log cuánto duró). */
  private chainStartedAt = 0;
  /**
   * Cómo TERMINAR el escaneo en curso desde afuera (null = no hay escaneo). Es la función `finish` de
   * `scanForTarget`, no un simple cancelador de timer, y la diferencia importa: terminar el escaneo
   * apaga la radio (`stopDeviceScan`) **y** resuelve la promesa que el camino de conexión está
   * esperando. Si el teardown solo cancelara el presupuesto, un `disconnect()` en medio de un escaneo
   * dejaría **la radio escaneando** hasta que el techo de afuera se venciera, y eso es batería en la
   * manga sin nadie mirando.
   */
  private finishScan: ((deviceId: string | null) => void) | null = null;
  /**
   * ¿La cadena que NADIE pidió (R6.4) se agotó sin encontrar el bastón recordado? Lo lee la pantalla de
   * conexión para dar el copy honesto. PÚBLICO y de solo lectura desde afuera: se setea ANTES del
   * `emitStatus` que provoca el re-render, así que la UI siempre lo ve fresco.
   */
  autoConnectExhausted = false;
  /**
   * Generación de la CONEXIÓN. Cada connect exitoso abre una sesión nueva; los callbacks del nativo
   * capturan la suya y descartan lo que llegue de una vieja.
   *
   * Acá cierra además un camino propio de esta lib: `subscription.remove()` de un monitor hace
   * `BleModule.cancelTransaction(...)`, lo que **rechaza la promesa del monitor**, y ese rechazo llega
   * a NUESTRO listener como un error (`_handleMonitorCharacteristic` en el fuente). O sea: nuestro
   * propio teardown dispara el handler de error de lectura. Si ese handler reconectara sin mirar la
   * sesión, un `disconnect()` del operario terminaría RECONECTANDO. Por eso `teardownStreams()` bumpea
   * la sesión ANTES de remover suscripciones.
   */
  private session = 0;

  /**
   * `driver` entra por constructor (default: el primero del registro que declare `ble-gatt`, ver
   * `bleGattDriverFrom`). Si el registro no declara ninguno, se cae al driver que se pase — y
   * `instantiateTransport` no llega a construir el adapter porque `isBleGattTransportAvailable()` da
   * false antes (RBM2.3). El `!` del default está acotado por ese guard y por su test.
   */
  constructor(driver: ReaderDriver | null = bleGattDriverFrom(), env: BleEnv = defaultBleEnv()) {
    if (driver == null) {
      // No se lanza: un throw en el constructor del transporte se propagaría al render del provider y
      // se llevaría la app entera por un dato de configuración. Se deja un driver imposible de resolver
      // (`resolveBleGattParams` → `driver-sin-ble-gatt`) y el connect corta con log.
      this.driver = {
        vendorId: 'sin-driver-ble-gatt',
        displayName: 'sin driver BLE',
        transports: [],
        frameParser: { parse: () => null },
        deviceMatch: {},
        streaming: false,
      };
    } else {
      this.driver = driver;
    }
    this.env = env;
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }

  private ms(key: keyof BleTimings): number {
    return timeoutOf(this.env, key);
  }

  /**
   * Abre el link GATT del lector (RBM2.6). Orden del camino feliz:
   *   1. params del driver (servicio / característica / fin de trama) + chequeo de que el terminador es
   *      frameable (RBM2.10);
   *   2. módulo nativo presente (si no, manual-first: `disconnected`, sin reintentos, RBM2.3);
   *   3. permiso (Android; en iOS lo refleja el estado de la radio) → denegado ⇒ `permission_denied`;
   *   4. radio prendida (se CONSULTA, nunca se pide prenderla);
   *   5. device: el pasado, el recordado, o el que aparezca en un ESCANEO FILTRADO Y ACOTADO;
   *   6. `connectToDevice` + descubrimiento de servicios;
   *   7. suscripción a NOTIFICACIONES + a la desconexión DEL PROPIO DEVICE + watchdog + sonda de
   *      liveness.
   * Nunca bloquea la carga manual (R7): cualquier falla es un estado, no una excepción.
   */
  async connect(deviceId?: string): Promise<void> {
    await this.runConnect(deviceId, 'operator');
  }

  /**
   * RECONEXIÓN AUTOMÁTICA AL ABRIR LA APP (R6.4 / RBM2.16). La llama el provider UNA vez al montar el
   * transporte. Misma política que el SPP (`connect-trigger.ts`), y la misma regla: **el arranque no
   * pide nada**. Los gates van del más barato y menos invasivo al que toca el hardware:
   *
   *   1. ¿HAY DEVICE RECORDADO? Lectura LOCAL. Va PRIMERO: un arranque en frío (nadie eligió un bastón
   *      nunca) no consulta permisos ni toca la radio. Nada.
   *   2. ¿EL PERMISO YA ESTÁ CONCEDIDO? Se CONSULTA (`checkPermissions`), no se pide (RBM3.8).
   *   3. ¿LA RADIO ESTÁ PRENDIDA? Se lee (`state()`), y si no lo está NO se arranca (acá no hay diálogo
   *      posible: ver la cabecera del archivo).
   *   4. ¿FOREGROUND? (RBM3.6.)
   *
   * ── POR QUÉ ESTO CUMPLE RBM3.8 TAMBIÉN EN iOS ────────────────────────────────────────────────────
   * En iOS el diálogo de permiso de Bluetooth NO lo pide una API: lo muestra el SO la primera vez que la
   * app USA la radio, y su denegación llega como `state() === 'Unauthorized'`. O sea que un arranque que
   * escanea podría tirarle el diálogo al operario sin que haya tocado nada. No pasa, y por construcción:
   * el gate 1 exige un bastón RECORDADO, y para que exista un bastón recordado el operario ya eligió uno
   * antes por un gesto — momento en el que el diálogo ya apareció (con contexto). El arranque en frío no
   * llega nunca a tocar la radio.
   *
   * Cuando un gate no pasa **no se emite ningún estado**: se queda en `'off'`, que es el estado honesto
   * de "nunca se intentó". El motivo queda en el log (`autoconnect_skipped`), que es lo que hace
   * diagnosticable un "no se conectó solo" — los motivos se ven idénticos desde la UI: nada.
   */
  async autoConnect(): Promise<void> {
    const skip = (
      reason: 'no_remembered' | 'permission' | 'bluetooth_off' | 'background' | 'unavailable' | 'busy',
    ) => {
      logTransportEvent({ kind: 'autoconnect_skipped', reason });
    };

    // Ya hay link o ya hay un intento en curso: no nos metemos. NO se mira `this.closed` — mismo motivo
    // que en el SPP: `disconnect()` lo pone también el cleanup del efecto del provider, y gatear por él
    // mataba R6.4 en silencio en cada re-montaje.
    if (this.device != null || this.inFlightGen != null) {
      skip('busy');
      return;
    }
    if (!this.env.isForeground()) {
      skip('background');
      return;
    }

    const remembered = await withTimeoutOr(
      this.env.readRemembered(),
      this.ms('call'),
      'read_remembered',
      null,
      (error) => logBridgeFailure('read_remembered', this.ms('call'), error),
    );
    if (!remembered) {
      skip('no_remembered'); // arranque en frío: NO se toca la radio ni se consulta nada más
      return;
    }
    if (this.device != null || this.inFlightGen != null) return;

    const manager = this.env.loadManager();
    if (manager == null) {
      skip('unavailable');
      return;
    }

    const permission = await withTimeoutOr(
      this.env.checkPermissions(),
      this.ms('call'),
      'check_permissions',
      'unavailable' as BluetoothPermissionOutcome,
      (error) => logBridgeFailure('check_permissions', this.ms('call'), error),
    );
    if (permission !== 'granted') {
      skip('permission'); // se lo pide el gesto, que es el único momento con contexto
      return;
    }

    // Fallback `''` (estado ilegible) a propósito: acá la duda NO habilita a tocar la radio, porque
    // nadie pidió nada. En `doConnect` es al revés (el operario pidió conectar y el error real lo da el
    // connect).
    const state = await withTimeoutOr(manager.state(), this.ms('call'), 'ble_state', '', (error) =>
      logBridgeFailure('ble_state', this.ms('call'), error),
    );
    if (state !== BLE_STATE_POWERED_ON) {
      skip('bluetooth_off'); // incluye Unauthorized/Unsupported: ninguno se arregla reintentando solo
      return;
    }

    if (this.device != null || this.inFlightGen != null) return;
    await this.runConnect(remembered, 'autoconnect');
  }

  /**
   * Punto único de entrada al camino de conexión. El `trigger` dice QUIÉN lo disparó, y de ahí salen las
   * dos políticas que separan un intento del operario de uno que la app hizo sola
   * (`connect-trigger.ts`, RBM3.1): si puede mostrar diálogos del SO, y si la cadena de reintentos que
   * arranca tiene tope. NO es un booleano a propósito: un camino nuevo tiene que **declarar** su
   * trigger, y un trigger nuevo no compila hasta declarar sus dos políticas.
   */
  private async runConnect(deviceId: string | undefined, trigger: ConnectTrigger): Promise<void> {
    if (this.inFlightGen != null) {
      // Un `connect()` del OPERARIO que llega con un intento en vuelo no puede ser un no-op mudo
      // (🟠-B del review del SPP): aunque no haya otro bastón que encolar, el tap significa "quiero que
      // insista" → re-aplica la política de su cadena (o sea, la DESTOPA). Y siempre queda log.
      const queued = this.queueTarget(deviceId);
      if (policyFor(trigger).chain !== 'inherit') this.applyChainPolicy(trigger);
      if (!queued) logTransportEvent({ kind: 'connect_reasserted', trigger });
      return;
    }
    this.applyChainPolicy(trigger);
    let target = deviceId;
    let attemptTrigger = trigger;
    for (;;) {
      const gen = ++this.connectGeneration;
      this.inFlightGen = gen;
      this.inFlightTarget = target ?? null;
      // `closed = false` va DESPUÉS del guard de re-entrada: si fuera antes, un connect() espurio
      // durante un intento en curso borraría el `disconnect()` que el operario acababa de hacer.
      this.closed = false;
      try {
        await this.doConnect(target, attemptTrigger, gen);
      } finally {
        if (this.inFlightGen === gen) this.inFlightGen = null;
      }
      const next = this.pendingTarget;
      this.pendingTarget = null;
      if (next == null || this.closed || this.inFlightGen != null) return;
      target = next;
      // El target encolado vino de un TAP (`queueTarget` solo encola targets explícitos), así que su
      // cadena es del operario: sin tope, y puede pedir lo que haga falta.
      attemptTrigger = 'operator';
      this.applyChainPolicy('operator');
    }
  }

  /**
   * Aplica al estado de la cadena la política del trigger (`connect-trigger.ts`). Único lugar que
   * decide si los reintentos tienen tope, y lo decide por ORIGEN de la cadena, no por estado.
   */
  private applyChainPolicy(trigger: ConnectTrigger): void {
    const { chain } = policyFor(trigger);
    if (chain === 'inherit') return; // un reintento no cambia el tope de la cadena que continúa
    this.chainStartedAt = this.now();
    this.reconnectAttempt = 0; // cadena nueva: el backoff arranca del piso
    this.autoConnectExhausted = false; // se está intentando de nuevo: el copy honesto ya no aplica
    this.retryBudgetUntil =
      chain === 'start-capped' ? this.chainStartedAt + UNPROMPTED_RETRY_BUDGET_MS : null;
  }

  /**
   * Un `connect()` a OTRO bastón con un intento en curso (RBM3.7). En el SPP esto era un `return` mudo:
   * el operario tocaba el bastón A (cuyo connect bloquea varios segundos si está apagado), se daba
   * cuenta de que era el otro, tocaba el B y **no pasaba nada** — ni estado, ni log— y quedaba conectado
   * a A. Un `connect()` SIN target ("conectá a lo que estabas") no encola nada: el intento en curso ya
   * es eso. Devuelve si encoló, para que el caller sepa qué loguear.
   */
  private queueTarget(deviceId: string | undefined): boolean {
    if (deviceId == null) return false;
    if (this.sameDevice(deviceId, this.inFlightTarget)) return false;
    this.pendingTarget = deviceId;
    logTransportEvent({ kind: 'connect_superseded', deviceId });
    return true;
  }

  /**
   * Compara dos identificadores de device de forma tolerante. En Android el id es una MAC (el SO la
   * devuelve en mayúsculas, pero un id guardado o tipeado puede venir en minúsculas) y en iOS es un
   * UUID del sistema. Nosotros comparamos normalizado; la LIB, en cambio, compara EXACTO adentro de su
   * `onDeviceDisconnected` — y eso es una de las razones por las que la sonda de liveness no es
   * opcional (ver lección 1 de la cabecera).
   */
  private sameDevice(a: string | null | undefined, b: string | null | undefined): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  /**
   * ¿ESTE driver reconoce a este device? (RBM2.4 + RBM5.13.) Se resuelve con `findDriverForDevice` sobre
   * un registro de UNO —el driver de esta instancia— para no reimplementar el cruce del `deviceMatch`.
   *
   * Los UUID que se le pasan son los que el device ANUNCIÓ de verdad, **no** el que usamos como filtro
   * de escaneo: pasar el nuestro convertiría cualquier match por UUID en un sello de goma (todo
   * resultado del escaneo lo anuncia, por definición) y taparía justo el caso que importa — el bridge de
   * la balanza Vesta anuncia los MISMOS UUID Nordic UART que el emulador (ADR-003), así que lo único que
   * los distingue es el NOMBRE (RBM5.13).
   *
   * Se prueban los dos nombres que el SO expone (`name` = GAP, `localName` = el del anuncio) porque
   * pueden diferir y el emulador se identifica por el del anuncio.
   */
  private recognizes(device: BleDeviceLike): boolean {
    const names = [device.name, device.localName].filter(
      (n): n is string => typeof n === 'string' && n.trim().length > 0,
    );
    const advertised = Array.isArray(device.serviceUUIDs)
      ? device.serviceUUIDs.filter((u): u is string => typeof u === 'string')
      : undefined;
    const base: Omit<DiscoveredDevice, 'name'> = {
      id: device.id,
      channel: 'ble-advertised',
      advertisedServiceUuids: advertised,
    };
    // Sin nombre legible se prueba igual (un driver puede reconocer por UUID anunciado).
    if (names.length === 0) return findDriverForDevice({ ...base }, [this.driver]) != null;
    return names.some((name) => findDriverForDevice({ ...base, name }, [this.driver]) != null);
  }

  private async doConnect(deviceId: string | undefined, trigger: ConnectTrigger, gen: number): Promise<void> {
    // Los diálogos del SO (permiso de runtime) SOLO salen de un gesto del operario (RBM3.8).
    const { allowsSystemDialogs } = policyFor(trigger);
    // Un intento en curso deja SIN EFECTO cualquier reintento pendiente: si no se cancela, (a) un timer
    // viejo dispararía otro connect sobre una conexión ya viva, y (b) —peor— el guard de
    // `scheduleReconnect` vería `cancelScheduled != null` y NO volvería a programar nada, así que el
    // corte siguiente se quedaba sin reconexión para siempre.
    this.cancelReconnect();
    await this.teardownStreams();
    if (gen !== this.connectGeneration) return;

    const resolved = resolveBleGattParams(this.driver);
    if (!resolved.ok) {
      // Los tres motivos van al log SEPARADOS (`driver-sin-ble-gatt` / `uuid-invalido` /
      // `delimitador-no-soportado`): son tres causas con tres acciones distintas, y desde la UI se ven
      // exactamente igual. El delimitador es el caso 🟠-5: NO se abre la conexión, en vez de conectar y
      // quedarse mudo sin un error (RBM2.10).
      logTransportEvent({ kind: 'connect_error', message: `ble_params_unresolved: ${resolved.reason}` });
      this.emitStatus('disconnected');
      return;
    }
    const params = resolved.params;

    const manager = this.env.loadManager();
    if (manager == null) {
      // Sin módulo nativo (web/CI/dev build viejo): no se puede conectar y NO se reintenta (el
      // resultado sería idéntico para siempre). Manual-first (R7).
      logTransportEvent({ kind: 'connect_error', message: 'ble_native_unavailable' });
      this.emitStatus('disconnected');
      return;
    }

    // Permisos: el gesto del operario PIDE (y espera al diálogo); un camino automático solo CONSULTA.
    // `requestMultiple` sobre un permiso denegado UNA vez vuelve a mostrar el diálogo, así que sin esta
    // distinción un timer podía tirárselo en la cara al operario sin que hubiera tocado nada. Y un check
    // no espera a una persona: su presupuesto es el de una llamada, no el del diálogo.
    const permissionLabel = allowsSystemDialogs ? 'ensure_permissions' : 'check_permissions';
    const permissionBudget = allowsSystemDialogs ? this.ms('prompt') : this.ms('call');
    const permission = await withTimeoutOr(
      allowsSystemDialogs ? this.env.ensurePermissions() : this.env.checkPermissions(),
      permissionBudget,
      permissionLabel,
      'unavailable' as BluetoothPermissionOutcome,
      (error) => logBridgeFailure(permissionLabel, permissionBudget, error),
    );
    if (gen !== this.connectGeneration) return;
    if (permission === 'denied') {
      // Estado con CTA de reintento; la carga manual sigue operativa (RBM2.14 / R12.5 / R7.2). Sin
      // backoff: el reintento lo dispara el operario después de conceder el permiso.
      this.emitStatus('permission_denied');
      return;
    }
    if (permission === 'unavailable') {
      logTransportEvent({ kind: 'connect_error', message: 'ble_permission_unavailable' });
      this.emitStatus('disconnected');
      return;
    }

    // La RADIO. Se consulta y NO se pide prenderla (ver la cabecera). Fallback `PoweredOn` si el puente
    // no contesta: al revés que en `autoConnect`, acá el operario pidió conectar y un error real del
    // connect es mejor diagnóstico que un "prendé el Bluetooth" inventado sobre una radio que no
    // pudimos leer.
    const state = await withTimeoutOr(
      manager.state(),
      this.ms('call'),
      'ble_state',
      BLE_STATE_POWERED_ON,
      (error) => logBridgeFailure('ble_state', this.ms('call'), error),
    );
    if (gen !== this.connectGeneration) return;
    if (state === BLE_STATE_UNAUTHORIZED) {
      // iOS: el operario denegó el permiso de Bluetooth en el diálogo del SO. No hay API para volver a
      // pedirlo (se arregla en Ajustes), así que es el MISMO estado que un permiso denegado en Android:
      // CTA, sin backoff, carga manual intacta (RBM2.14).
      logTransportEvent({ kind: 'connect_error', message: 'ble_state_unauthorized' });
      this.emitStatus('permission_denied');
      return;
    }
    if (state !== BLE_STATE_POWERED_ON) {
      // `Unsupported` (el device no tiene BLE) no se arregla reintentando: se corta seco. `PoweredOff` /
      // `Resetting` / `Unknown` sí pueden cambiar solos, así que un camino automático sigue reintentando
      // en silencio (el backoff topea en 8 s, así que cuando el operario prenda la radio la app
      // reconecta sola dentro de esa ventana, y si la cadena es la del arranque, dentro de su tope).
      logTransportEvent({ kind: 'connect_error', message: `ble_state_not_ready: ${state || 'unreadable'}` });
      this.emitStatus('disconnected');
      if (state !== BLE_STATE_UNSUPPORTED) this.scheduleReconnect();
      return;
    }

    // El device: el que pidió el operario, el recordado, o el del ESCANEO.
    let target =
      deviceId ??
      (await withTimeoutOr(this.env.readRemembered(), this.ms('call'), 'read_remembered', null, (error) =>
        logBridgeFailure('read_remembered', this.ms('call'), error),
      ));
    if (gen !== this.connectGeneration) return;
    if (!target) {
      this.emitStatus('scanning');
      // El techo del escaneo es DOBLE y no por paranoia: adentro lo acota su presupuesto
      // (`schedule(..., 'scan')`, que es lo que produce el `ble_scan_timeout` con su diagnóstico), y
      // afuera lo acota `withTimeoutOr` para que ni un timer que no llega ni un `startDeviceScan` que
      // no se asienta puedan dejar el LATCH tomado — que es el 🔴-1 del SPP (2 min 40 s de bastón
      // muerto) entrando por la puerta del descubrimiento.
      target = await withTimeoutOr(
        this.scanForTarget(manager, params, gen),
        this.ms('scan') > 0 ? this.ms('scan') + this.ms('call') : 0,
        'scan_for_target',
        null,
        (error) => logBridgeFailure('scan_for_target', this.ms('scan'), error),
      );
      if (gen !== this.connectGeneration) return;
      if (!target) {
        // El escaneo se agotó (o falló). NO se dispara backoff: un escaneo que se reintenta solo es la
        // radio escaneando para siempre, y el descubrimiento es un GESTO (el CTA "Buscar de nuevo" es
        // el reintento). El motivo ya quedó en el log dentro de `scanForTarget`.
        this.emitStatus('disconnected');
        return;
      }
    }
    // El objetivo se recuerda ACÁ, no recién al conectar: si se anotara solo en el éxito, el reintento
    // del backoff llamaría `connect(undefined)` y volvería a escanear desde cero — perdiendo el device
    // que el escaneo ya había encontrado (y en el primer emparejamiento no hay recordado al que caer).
    this.currentDeviceId = target;
    this.inFlightTarget = target;

    this.emitStatus('connecting');
    try {
      const pending = manager.connectToDevice(target, bleConnectOptions(this.ms('connect')) as unknown as Record<
        string,
        unknown
      >);
      const device = await withTimeout(pending, this.ms('connect'), 'connect_to_device', () => {
        // El nativo puede resolver DESPUÉS del vencimiento con el link ya abierto. Si no se cierra,
        // queda una conexión GATT que nadie lee y la sonda de liveness diría "vivo" sobre ella. Pero
        // cerrarla a ciegas es peor: ver `canCloseOrphanLink` (cerrar POR ID le mataría el link al
        // intento que conectó después).
        void pending
          .then((d) => {
            if (!this.canCloseOrphanLink(gen)) {
              logTransportEvent({ kind: 'orphan_socket_kept', reason: 'address_owned_by_newer' });
              return undefined;
            }
            return d?.cancelConnection?.();
          })
          .catch(() => undefined);
      });
      if (this.closed || gen !== this.connectGeneration) {
        // El operario tocó "Desconectar" (o eligió otro bastón) MIENTRAS se abría el link: el
        // `disconnect()` no tenía nada que cerrar todavía y este `await` habría dejado la conexión
        // abierta a sus espaldas.
        if (this.canCloseOrphanLink(gen)) {
          try {
            await withTimeout(device.cancelConnection(), this.ms('call'), 'abort_cancel_connection');
          } catch {
            // ignorar
          }
        } else {
          logTransportEvent({ kind: 'orphan_socket_kept', reason: 'address_owned_by_newer' });
        }
        // Solo el intento VIGENTE habla del estado: uno viejo que despierta no puede pisar el
        // 'connecting' del que lo reemplazó.
        if (gen === this.connectGeneration) this.emitStatus('disconnected');
        return;
      }

      // ⏱ Descubrimiento de servicios/características: obligatorio antes de suscribirse a una
      // notificación (el nativo no conoce los handles hasta acá). Va DENTRO del try: si falla, es una
      // falla de conexión normal → backoff.
      await withTimeout(
        device.discoverAllServicesAndCharacteristics(),
        this.ms('connect'),
        'discover_services',
      );
      if (this.closed || gen !== this.connectGeneration) {
        if (this.canCloseOrphanLink(gen)) {
          try {
            await withTimeout(device.cancelConnection(), this.ms('call'), 'abort_cancel_connection');
          } catch {
            // ignorar
          }
        }
        return;
      }

      const session = ++this.session;
      this.device = device;
      this.connectedAt = this.now();
      this.lastDataAt = this.now();
      // EL PRESUPUESTO DE LA CADENA MUERE ACÁ (🔴-A del review del SPP / HIGH-1 de su Gate 2). El tope
      // de la cadena `autoconnect` existe por UN motivo —"ese bastón lo vendí, lo rompí o quedó en otro
      // campo"— y en el instante en que el bastón CONTESTA ese motivo dejó de aplicar. Sin esta línea,
      // el tope no acotaría "la cadena que nadie pidió" sino los primeros 120 s de vida de la app.
      this.retryBudgetUntil = null;
      // Persiste el device elegido (RBM2.16). Best-effort y acotado: si el storage se cuelga, no puede
      // dejar la conexión a medio armar (sin suscripción a notificaciones y sin estado 'connected').
      await withTimeoutOr<void>(
        this.env.writeRemembered(target),
        this.ms('call'),
        'write_remembered',
        undefined,
        (error) => logBridgeFailure('write_remembered', this.ms('call'), error),
      );
      if (this.closed || gen !== this.connectGeneration || this.session !== session) {
        // Un disconnect (o un connect a otro bastón) entró mientras persistíamos: `teardownStreams` ya
        // cerró este link y bumpeó la sesión. Suscribirnos ahora dejaría un listener vivo sobre una
        // conexión muerta y emitiría un 'connected' mentiroso.
        return;
      }

      // ── EL STREAM (RBM2.7/2.8/2.9/2.12) ────────────────────────────────────────────────────────
      // El framer es POR SESIÓN: un buffer a medio llenar de un link que se cayó no puede pegarse con
      // la primera trama del link siguiente (es el arrastre que en el SPP hacía perder la primera
      // lectura buena después de corregir el terminador — banco §4.4).
      // El framer vive en la CLAUSURA de esta sesión (y no en un campo del adapter) a propósito: así no
      // hay forma de que el buffer de una sesión vieja se lea desde la nueva, ni de que un `null`
      // intermedio del teardown le pegue a una notificación que ya estaba en vuelo.
      const framer = new LineFramer(params.delimiter);
      this.monitorSub = device.monitorCharacteristicForService(
        params.serviceUuid,
        params.notifyCharUuid,
        (error, characteristic) => {
          // La sesión se mira PRIMERO: nuestro propio teardown hace `remove()` → `cancelTransaction` →
          // la promesa del monitor RECHAZA → esta callback se llama con error. Sin este guard, un
          // `disconnect()` del operario terminaría reconectando.
          if (this.session !== session || this.closed) return;
          if (error != null) {
            // El monitor MURIÓ: la lib remueve su suscripción cuando la promesa se asienta, así que
            // desde acá en adelante NO van a llegar notificaciones — el link seguiría "conectado" y
            // estructuralmente SORDO, que es el peor de los estados (el operario bastonea y no pasa
            // nada, sin un solo indicio). Se trata como pérdida del stream: teardown + backoff.
            logTransportEvent({ kind: 'read_loop_error', message: `ble_monitor_lost: ${errorMessage(error)}` });
            void this.loseLink('monitor_error');
            return;
          }
          const text = decodeBase64Ascii(characteristic?.value);
          if (text === null) {
            // Llegó una notificación que no pudimos decodificar. Se dice: convertirla en "no llegó
            // nada" es exactamente el silencio indistinguible de "el operario no está bastoneando".
            logTransportEvent({ kind: 'read_loop_error', message: 'ble_decode_failed' });
            return;
          }
          // Bytes que llegaron = el link no está mudo, incluso si la trama todavía no está completa.
          this.lastDataAt = this.now();
          for (const line of framer.push(text)) {
            if (this.listening) this.emitTag(line); // línea CRUDA → contrato (RBM2.8)
          }
        },
      );

      // Desconexión reportada por el SO, POR DEVICE (RBM3.4). `device.onDisconnected` delega en
      // `manager.onDeviceDisconnected(this.id, …)`, que filtra por id ADENTRO DE LA LIB: no es un
      // listener global como el del SPP, así que apagar otro dispositivo BLE no puede cerrarnos el
      // link. Se re-chequea el id igual (defensa, y para que el filtro quede escrito de este lado).
      this.disconnectSub = device.onDisconnected((error, disconnected) => {
        if (this.closed || this.session !== session) return;
        const id = disconnected?.id;
        if (typeof id === 'string' && id.length > 0 && !this.sameDevice(id, target)) return;
        logTransportEvent({
          kind: 'connect_error',
          message: `ble_disconnected: ${error != null ? errorMessage(error) : 'sin_error'}`,
        });
        void this.loseLink('os_event');
      });

      if (typeof manager.isDeviceConnected !== 'function') {
        // Sin sonda no hay segunda fuente de verdad: volveríamos a depender de un evento que se puede
        // perder. Se dice UNA vez por conexión (no en cada poll) en vez de fingir que está cubierto.
        logTransportEvent({ kind: 'connect_error', message: 'liveness_probe_unavailable' });
      }
      this.armLivenessProbe(target);
      this.armWatchdog(session, target);

      this.emitStatus('connected');
    } catch (e) {
      if (gen !== this.connectGeneration) return;
      // Falla de conexión → no bloquea el manual (R7); reintenta con backoff (foreground-only, RBM3.6).
      // El label es del TRAMO; si el error fue un vencimiento, `logBridgeFailure` usa el label del await
      // que se perdió, que es más preciso que cualquier cosa que pueda decir acá.
      logBridgeFailure('connect_path', this.ms('connect'), e);
      this.emitStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  /**
   * ESCANEO FILTRADO Y ACOTADO (RBM2.4/RBM2.5). Resuelve con el id del primer device que ESTE driver
   * reconoce, o `null` si el presupuesto se agota o el escaneo falla.
   *
   * Cuatro cosas que no son obvias:
   *  · el filtro va en el PRIMER argumento de `startDeviceScan` (`[serviceUuid]`). Escanear sin filtro
   *    en la manga es batería y ruido, y RBM2.4 lo prohíbe explícitamente;
   *  · `startDeviceScan` **puede rechazar** (sin permiso, radio apagada) y en ese caso el listener no se
   *    llama NUNCA: sin atender ese rechazo, el escaneo se quedaría esperando su presupuesto entero para
   *    no encontrar nada, y el log diría "timeout" cuando en realidad ni arrancó;
   *  · el escaneo se DETIENE siempre: al encontrar, al vencer y al fallar (`stopDeviceScan`). Un escaneo
   *    que nadie apaga es el equivalente BLE del latch eterno;
   *  · los devices que aparecen pero NO los reconoce el driver se CUENTAN y se loguean una vez cada uno.
   *    Eso es lo que separa "no hay nada" de "hay algo con ese servicio que no es un bastón" — el caso
   *    real del bridge de la balanza Vesta, que anuncia los mismos UUID Nordic UART (RBM5.13).
   */
  private scanForTarget(
    manager: BleManagerLike,
    params: BleGattParams,
    gen: number,
  ): Promise<string | null> {
    const budget = this.ms('scan');
    const seen = new Set<string>();
    return new Promise<string | null>((resolve) => {
      let settled = false;
      // `cancelBudget` se guarda LOCAL y no solo en el campo del adapter: si un intento más nuevo
      // arrancó su propio escaneo, el `finish` del viejo no puede cancelarle el presupuesto AL NUEVO
      // (por eso el campo se limpia solo si sigue siendo el nuestro).
      let cancelBudget: (() => void) | null = null;
      const finish = (id: string | null) => {
        if (settled) return;
        settled = true;
        if (cancelBudget) {
          cancelBudget();
          if (this.finishScan === finish) this.finishScan = null;
          cancelBudget = null;
        }
        void this.stopScan(manager);
        resolve(id);
      };

      cancelBudget = this.env.schedule(
        () => {
          logTransportEvent({ kind: 'ble_scan_timeout', ms: budget, seen: seen.size });
          finish(null);
        },
        budget,
        'scan',
      );
      this.finishScan = finish;

      const started = manager.startDeviceScan(
        [params.serviceUuid],
        bleScanOptions() as unknown as Record<string, unknown>,
        (error, device) => {
          if (settled) return;
          if (error != null) {
            logTransportEvent({ kind: 'connect_error', message: `ble_scan_error: ${errorMessage(error)}` });
            finish(null);
            return;
          }
          if (device == null || typeof device.id !== 'string' || device.id.length === 0) return;
          // Un intento más nuevo (o un disconnect) tomó el control mientras escaneábamos: este escaneo
          // ya no es de nadie.
          if (gen !== this.connectGeneration) {
            finish(null);
            return;
          }
          if (seen.has(device.id)) return; // el mismo anuncio repetido no agrega información
          seen.add(device.id);
          if (!this.recognizes(device)) {
            logTransportEvent({
              kind: 'connect_error',
              message: `ble_device_not_recognized: ${device.id}`,
            });
            return;
          }
          finish(device.id);
        },
      );
      // El `startDeviceScan` de la lib es `async`: su rechazo llega por promesa, no por el listener.
      void Promise.resolve(started).catch((error: unknown) => {
        logBridgeFailure('start_device_scan', budget, error);
        finish(null);
      });
    });
  }

  /** Detiene el escaneo. Best-effort y ACOTADO: un `stopDeviceScan` que no vuelve no puede colgar nada. */
  private async stopScan(manager: BleManagerLike): Promise<void> {
    try {
      await withTimeout(manager.stopDeviceScan(), this.ms('call'), 'stop_device_scan');
    } catch (e) {
      // Se loguea: si el escaneo NO se pudo detener, la radio sigue trabajando y eso es batería en la
      // manga. No propaga (el camino de conexión sigue).
      logBridgeFailure('stop_device_scan', this.ms('call'), e);
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    // Invalida el intento en curso y LIBERA EL LATCH (RBM3.2): el intento viejo, cuando despierte de su
    // await, va a ver que ya no es la generación vigente, cerrará lo que abrió y se irá sin tocar el
    // estado. Sin la generación, liberar el latch acá abriría la ventana de dos intentos pisándose; con
    // ella, liberar es seguro.
    this.connectGeneration += 1;
    this.inFlightGen = null;
    this.inFlightTarget = null;
    this.pendingTarget = null;
    // El dwell lo consume `scheduleReconnect`; un disconnect explícito no reconecta, así que el dato
    // tiene que morir acá o el próximo corte lo leería viejo.
    this.connectedAt = null;
    this.cancelReconnect();
    await this.teardownStreams();
    this.emitStatus('disconnected');
  }

  onTagRead(cb: (rawLine: string) => void): Unsubscribe {
    this.tagListeners.add(cb);
    return () => this.tagListeners.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  enable(): void {
    this.listening = true;
  }

  disable(): void {
    this.listening = false;
  }

  // ─── Pérdida del link: un solo camino, con su motivo ─────────────────────────────────────────

  /**
   * El link se perdió (por el evento del SO, por la sonda de liveness, o porque el monitor murió).
   * UNA sola salida para los tres, porque los tres tienen que hacer exactamente lo mismo —cerrar,
   * avisar y reintentar— y tenerlo escrito tres veces es cómo se olvida uno.
   */
  private async loseLink(reason: 'os_event' | 'liveness' | 'monitor_error'): Promise<void> {
    if (this.closed) return;
    // El motivo ya lo logueó el llamador con SU detalle (`ble_disconnected` con el error del SO,
    // `ble_monitor_lost` con el de la lib, `liveness_lost` con el de la sonda): acá no se vuelve a
    // loguear para que en logcat no haya dos líneas por el mismo corte, y `connection_changed` lo emite
    // el provider al recibir el estado. `reason` queda en la firma porque es lo que hace legible el
    // call site (y lo que un test puede exigir que se distinga).
    void reason;
    await this.teardownStreams();
    this.emitStatus('disconnected');
    this.scheduleReconnect();
  }

  // ─── Liveness: la app no confía en un evento que puede perder (RBM3.5 / BENCH-1) ──────────────

  /**
   * Arma la reconciliación AL VOLVER A FOREGROUND. `scheduleReconnect` ya maneja bien el caso "estoy en
   * background y quiero reintentar", pero a eso **solo se llega si la desconexión se DETECTÓ**. Cuando
   * el evento se pierde no hay reintento pendiente y el retorno a primer plano no chequearía nada: la
   * app seguiría diciendo "Bastón conectado" para siempre. Esta suscripción es independiente de la del
   * backoff y vive mientras hay link.
   */
  private armLivenessProbe(deviceId: string | undefined): void {
    if (this.unsubLiveness != null || deviceId == null) return;
    this.unsubLiveness = this.env.onForeground(() => {
      void this.verifyLiveness('foreground', deviceId);
    });
  }

  /**
   * Watchdog del link: SONDA PERIÓDICA de liveness + registro de la MUDEZ.
   *
   * (a) LIVENESS (RBM3.5). Sondea cada `livenessPoll` **sin depender de ningún evento ni de AppState**.
   *     Es la parte que de verdad cierra el "conectado" mentiroso: la sonda del retorno a foreground
   *     puede llegar unos ms antes de que el nativo se entere, y el poll acota ese error.
   * (b) MUDEZ (RBM3.10). Un lector con el terminador equivocado, un lector dormido y un link muerto
   *     producen EXACTAMENTE el mismo síntoma desde afuera: "connected", cero lecturas, cero errores.
   *     El silencio NO desconecta —es lo normal cuando el operario no está bastoneando— pero queda
   *     ESCRITO, que es lo que permite distinguir los tres casos.
   */
  private armWatchdog(session: number, deviceId: string | undefined): void {
    const poll = this.ms('livenessPoll');
    if (!Number.isFinite(poll) || poll <= 0 || this.cancelWatchdog != null) return;
    this.cancelWatchdog = this.env.schedule(
      () => {
        this.cancelWatchdog = null;
        if (this.closed || this.session !== session) return;
        const silentMs = this.now() - this.lastDataAt;
        if (silentMs >= this.ms('silence')) logTransportEvent({ kind: 'connected_silent', ms: silentMs });
        void this.verifyLiveness('poll', deviceId);
        this.armWatchdog(session, deviceId);
      },
      poll,
      'watchdog',
    );
  }

  /**
   * ¿El link que creemos abierto sigue vivo del lado nativo? Es la SEGUNDA FUENTE DE VERDAD.
   *
   * FAIL-CLOSED: si la sonda no está disponible o RECHAZA (el nativo rechaza cuando la radio está
   * apagada — o sea, seguro NO estamos conectados), NO seguimos afirmando "conectado". El peor caso es
   * un teardown + reconexión de más; el caso que evita es 40 bastonazos perdidos sin un solo indicio.
   */
  private async verifyLiveness(reason: 'foreground' | 'poll', deviceId: string | undefined): Promise<void> {
    if (this.closed || this.device == null || deviceId == null) return;
    if (this.inFlightGen != null) return; // ya hay un intento en curso: que decida él
    const session = this.session;
    const manager = this.env.loadManager();
    if (manager == null || typeof manager.isDeviceConnected !== 'function') return;
    let alive = false;
    let why = 'link_closed';
    try {
      alive = await withTimeout(manager.isDeviceConnected(deviceId), this.ms('call'), 'is_device_connected');
    } catch (e) {
      why = errorMessage(e);
    }
    // Mientras sondeábamos pudo pasar cualquier cosa (un disconnect, otro connect): no pisamos.
    if (this.closed || this.session !== session || this.inFlightGen != null) return;
    if (alive) return;
    logTransportEvent({ kind: 'liveness_lost', reason, message: why });
    await this.loseLink('liveness');
  }

  // ─── Reconexión foreground-only con backoff (RBM3.1/3.6/3.9) ─────────────────────────────────

  /**
   * Programa un reintento. Foreground-only (RBM3.6: sin BLE en background, RBM2.15), pero si la app NO
   * está en foreground se queda ESPERANDO el retorno a 'active' en vez de abandonar — el código anterior
   * del SPP hacía `return` y no re-armaba nada, así que una app que se minimizaba en el momento del
   * reintento no volvía a conectar nunca (el caso de "guardé el teléfono en el bolsillo mientras
   * apartaba").
   */
  private scheduleReconnect(): void {
    if (this.closed || this.cancelScheduled != null || this.unsubForeground != null) return;

    // TOPE de la cadena que NADIE pidió (RBM3.1). Va ANTES del gate de foreground a propósito: una
    // cadena con el presupuesto vencido tiene que MORIR, no quedarse esperando el retorno a primer plano
    // para seguir martillando.
    if (this.unpromptedBudgetSpent()) {
      this.exhaustUnpromptedChain();
      return;
    }

    if (!this.env.isForeground()) {
      this.waitForForeground();
      return;
    }

    // DWELL (RBM3.9): el contador se resetea solo si el link que se acaba de caer DURÓ. Antes se
    // reseteaba apenas conectaba, así que un flap producía 500 ms → 500 ms → 500 ms para siempre
    // (medido en el banco del SPP: `attempt:0` en los 4 ciclos de `flap 4 3000`).
    if (this.connectedAt != null && this.now() - this.connectedAt >= LINK_DWELL_MS) {
      this.reconnectAttempt = 0;
    }
    this.connectedAt = null;

    const attempt = this.reconnectAttempt++;
    const delay = backoffDelayMs(attempt);
    logTransportEvent({ kind: 'reconnect_attempt', attempt });
    this.emitStatus('scanning');
    this.cancelScheduled = this.env.schedule(
      () => {
        this.cancelScheduled = null;
        if (this.closed) return;
        // El TOPE también se re-chequea acá, y va ANTES del gate de foreground: si el orden fuera el
        // otro, un timer que dispara con la app en background se parquearía en `waitForForeground()`
        // **sin pasar por el chequeo del presupuesto**, y una cadena vencida quedaría de zombi esperando
        // el retorno a primer plano para volver a martillar — o sea, el tope sería evitable simplemente
        // guardando el teléfono.
        if (this.unpromptedBudgetSpent()) {
          this.exhaustUnpromptedChain();
          return;
        }
        // RBM3.6: el gate de foreground se re-chequea AL DISPARAR, no solo al programar. Entre armar
        // (hasta 8 s de backoff) y disparar, la app puede haberse ido a background — y escanear/conectar
        // desde background viola R6.9 (y en iOS, sin `UIBackgroundModes`, el escaneo en background no
        // devuelve nada: sería quemar el presupuesto para nada).
        if (!this.env.isForeground()) {
          this.waitForForeground();
          return;
        }
        // `retry` = continúa la cadena vigente y HEREDA su tope (o su ausencia). Si acá se pusiera
        // 'operator' o 'autoconnect', el timer estaría re-arrancando la cadena en cada vuelta y el tope
        // no se alcanzaría nunca.
        void this.runConnect(this.currentDeviceId ?? undefined, 'retry');
      },
      delay,
      'reconnect',
    );
  }

  /**
   * ¿Este intento (`gen`) puede cerrar el link que abrió, sin arrastrarse la conexión de otro?
   *
   * El problema es el mismo que en el SPP y por la misma causa estructural: `cancelConnection()` (y el
   * `cancelDeviceConnection(id)` de la lib, que por eso NO está en `BleManagerLike`) cierran la conexión
   * de ESE DEVICE, no "la que abrió este intento". Así
   * que un intento A que venció a los 20 s y resuelve tarde le cerraría el link a B, que reconectó
   * después — y la app quedaría diciendo "conectado" sobre un link muerto: el mismo síntoma que BENCH-1,
   * producido por la limpieza que vino a evitar un link huérfano.
   *
   *   · `closed` → el operario tocó "Desconectar": no quiere NADA con ese device → cerrar sí o sí.
   *   · generación distinta sin `closed` → arrancó OTRO intento, que ahora es el dueño → NO tocarlo.
   */
  private canCloseOrphanLink(gen: number): boolean {
    if (this.closed) return true;
    return gen === this.connectGeneration;
  }

  /** ¿La cadena vigente tiene tope y ya se le pasó? (`null` = cadena del operario, sin tope). */
  private unpromptedBudgetSpent(): boolean {
    return this.retryBudgetUntil != null && this.now() >= this.retryBudgetUntil;
  }

  /**
   * Se agotó el tope de la cadena que nadie pidió: **se deja de reintentar**. Tres decisiones, las
   * mismas del SPP y por los mismos motivos: (1) NO se olvida el device recordado (que hoy no aparezca
   * no significa que no sea el bastón del operario); (2) se emite `'off'` —el estado real: no conectado
   * y sin estar intentando, con CTA, y el único que el indicador global se auto-oculta—; (3) el contador
   * del backoff vuelve al piso en la cadena siguiente, así que el tap del operario reintenta a los
   * 500 ms y no a los 8 s.
   */
  private exhaustUnpromptedChain(): void {
    const elapsed = Math.max(0, this.now() - this.chainStartedAt);
    const attempts = this.reconnectAttempt;
    this.retryBudgetUntil = null;
    this.cancelReconnect(); // por si quedó un listener de foreground esperando
    this.autoConnectExhausted = true; // ANTES del emit: es el emit el que provoca el re-render
    logTransportEvent({ kind: 'autoconnect_exhausted', ms: elapsed, attempts });
    this.emitStatus('off');
  }

  private waitForForeground(): void {
    if (this.unsubForeground != null) return;
    this.unsubForeground = this.env.onForeground(() => {
      this.clearForegroundWait();
      if (!this.closed) this.scheduleReconnect();
    });
  }

  private cancelReconnect(): void {
    if (this.cancelScheduled) {
      this.cancelScheduled();
      this.cancelScheduled = null;
    }
    this.clearForegroundWait();
  }

  private clearForegroundWait(): void {
    if (this.unsubForeground) {
      this.unsubForeground();
      this.unsubForeground = null;
    }
  }

  private async teardownStreams(): Promise<void> {
    this.session += 1; // invalida los callbacks de la sesión que se está cerrando (ver `session`)
    if (this.cancelWatchdog) {
      this.cancelWatchdog();
      this.cancelWatchdog = null;
    }
    if (this.unsubLiveness) {
      this.unsubLiveness();
      this.unsubLiveness = null;
    }
    if (this.finishScan) {
      // Un escaneo en curso de un intento que se está cerrando: se TERMINA (no solo se cancela su
      // presupuesto). `finish(null)` apaga la radio con `stopDeviceScan` y resuelve la promesa que el
      // camino de conexión está esperando, así que no queda ni escaneo huérfano ni await colgado.
      const finish = this.finishScan;
      this.finishScan = null;
      finish(null);
    }
    for (const sub of [this.monitorSub, this.disconnectSub]) {
      if (!sub) continue;
      try {
        sub.remove();
      } catch {
        // ignorar
      }
    }
    this.monitorSub = null;
    this.disconnectSub = null;
    // El framer NO se limpia acá: vive en la clausura de su sesión y muere con ella (el bump de
    // `session` de arriba deja sordo a su listener). Un campo compartido habría que resetearlo, y
    // olvidarse de eso es cómo el buffer de un link caído se pega con la primera trama del siguiente.
    if (this.device) {
      const device = this.device;
      this.device = null;
      try {
        await withTimeout(device.cancelConnection(), this.ms('call'), 'teardown_cancel_connection');
      } catch {
        // ignorar: el link puede haberse cerrado solo (y un `cancelConnection()` que no vuelve no puede
        // dejar colgado el teardown — que es lo que dejaría el latch tomado).
      }
    }
  }

  private emitTag(rawLine: string): void {
    for (const cb of this.tagListeners) cb(rawLine);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }
}
