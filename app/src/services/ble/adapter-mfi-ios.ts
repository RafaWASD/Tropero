// adapter-mfi-ios — el bastón por **MFi / ExternalAccessory** en iOS (RBM4, delta ios-ble-mfi F5).
// `StickAdapter` real (`kind:'mfi-ios'`) sobre la **rama iOS** de `react-native-bluetooth-classic` —
// la MISMA librería que ya usa el SPP en Android, **sin ninguna dependencia nueva** (RBM4.1).
//
// ── ESTADO: PREARMADO Y GATEADO POR DATOS, NO POR CÓDIGO ────────────────────────────────────────────
// Para abrir una sesión con un accesorio iAP, iOS exige que el build DECLARE la cadena de protocolo del
// accesorio en `UISupportedExternalAccessoryProtocols`. Esa cadena la entrega el fabricante (trámite MFi:
// Allflex / Datamars, canal Facundo) y **no la tenemos**: hoy la clave está declarada VACÍA. Entonces:
//
//   · con la lista vacía este adapter se reporta NO DISPONIBLE y **no toca el módulo nativo** — ni
//     siquiera lee `NativeModules.RNBluetoothClassic` (RBM4.2). Leer ese global INSTANCIA el módulo en
//     bridgeless (`BridgelessNativeModuleProxy` → `RCTTurboModuleManager` → `[moduleClass new]`), y el
//     `init()` de esta lib hace `Bundle.main.object(forInfoDictionaryKey:) as! [String]` sobre esa misma
//     clave. Hoy la clave existe (vacía) y por eso no trapea, pero el requisito no depende de eso: sin
//     protocolo declarado **no hay nada que abrir**, así que tocar la radio sería puro costo;
//   · **NADIE inventa una `protocolString`** (RBM4.6): el `RS420_DRIVER` sigue sin declarar el transporte
//     `mfi`. El día que llegue el dato, el diff es UNA línea en `app.config.ts` + UNA
//     `TransportCapability {kind:'mfi'}` en el driver del fabricante. **Cero código** (RBM4.7) — y eso
//     está probado con una cadena SINTÉTICA de punta a punta (`adapter-mfi-ios.test.ts`,
//     `ea-protocols.test.ts`), que es la única forma de demostrarlo sin tener el dato real.
//
// ── LO QUE ESTE ARCHIVO **NO** PRUEBA, dicho para que el verde no se lea de más ─────────────────────
// No hay un accesorio MFi en el banco (ni el emulador ESP32 puede ser uno: hace falta el chip de
// autenticación de Apple), así que el stream real de este transporte **no está verificado en device** —
// a diferencia del SPP (banco del 2026-07-30) y a diferencia del BLE, que tiene el banco de F6. Y hay un
// riesgo específico de la rama iOS que ningún unit puede cerrar: el `sendEvent` del nativo emite por
// `bridge.enqueueJSCall(...)`, o sea por el **RCTBridge**, que bajo bridgeless llega como
// `RCTBridgeProxy`; si esa vía no estuviera cableada, las lecturas (`DEVICE_READ@<serial>`) no llegarían
// a JS. El síntoma sería "conectado y mudo", que este adapter deja ESCRITO (`connected_silent`) en vez de
// dejarlo invisible. Es la misma clase de límite que el veto de F2 declaró para `react-native-ble-plx`
// ("el build prueba que compila, no que el puente resuelva en runtime").
//
// ── SIETE HALLAZGOS DEL CÓDIGO INSTALADO QUE CAMBIARON LA FORMA DEL ADAPTER (RBM4.8) ────────────────
// La regla es la lección literal del SPP —*"la forma que quedó salió de leer el código nativo, no su
// README"*— después de que el diseño original describiera un adapter que no funcionaba:
//
// 1. **NO HAY DESCUBRIMIENTO.** `startDiscovery` tira `Method not implemented` en iOS. El emparejamiento
//    lo hace el SO en su Accessory Picker (Ajustes) y lo único que el adapter puede hacer es LISTAR
//    (`getBondedDevices` → `EAAccessoryManager.connectedAccessories`) y FILTRAR por `protocolStrings`,
//    que el nativo publica en el mapa del device (`NativeDevice.map()`).
// 2. **EL FRAMING LO HACE EL NATIVO**, igual que en Android y por la misma clase
//    (`DelimitedStringDeviceConnectionImpl`): entrega mensajes YA delimitados y SIN el terminador. Pasar
//    eso por `LineFramer` daría CERO lecturas para siempre (el bug de `dad711f`, bug 1).
// 3. **EL TERMINADOR TIENE QUE SER DE UN CARÁCTER** — y acá iOS se separa de Android: el `read()` nativo
//    consume el delimitador con `index(after:)`, que avanza UNO, así que un `\r\n` deja el `\n` al frente
//    del mensaje siguiente. Lo rechaza `mfiDelimiterIsSupported` ANTES de conectar (RBM2.10 aplicado a
//    este transporte), en vez de partir mal cada trama.
// 4. **LAS OPCIONES DEL SPP DE ANDROID CRASHEAN ACÁ.** El nativo hace
//    `String.Encoding.from(value as! CFStringEncoding)` sobre `charset`, o sea un force-cast a UInt32:
//    `sppConnectOptions()` pasa `charset: 'ascii'` (un STRING) y eso **trapea en Swift**. Por eso este
//    transporte tiene su propio `mfiConnectOptions()` y NO reusa el del SPP (detalle completo ahí).
// 5. **`available()` NO SE LLAMA NUNCA.** Dos motivos independientes, los dos del fuente: (a) el
//    `available()` de la conexión delimitada tiene un `while (content.index(of: delimiter) != nil)` con
//    `content` inmutable → **bucle infinito** en cuanto hay un delimitador en el buffer; (b) el `.m`
//    exporta el selector `available:resolver:rejecter:` y el Swift implementa `availableFromDevice(…)`,
//    así que el método que la capa JS llama **no existe** en iOS. El guard es la AUSENCIA de la firma en
//    `MfiNative` (una llamada nueva no compila) + un guard estático en la suite.
// 6. **TODO CAMINO NATIVO TOCA CoreBluetooth.** Cada método del nativo pasa por
//    `checkBluetoothAdapter()`, que usa un `CBCentralManager` **lazy**, y la propia lib documenta que eso
//    "prompt bluetooth permission on first call of any bluetooth-related method". O sea que acá vale
//    igual que en el BLE (🟠-1 del review de F4): el arranque en frío NO puede tocar el nativo. Los gates
//    de `autoConnect()` van del más barato al que toca el hardware y el módulo se carga DESPUÉS de todos.
// 7. **EL WRAPPER JS DE LA LIB SE COME `protocolStrings`** — y este hallazgo, que el primer intento de
//    esta fase NO tenía, dejaba el transporte MUERTO con toda la suite en verde. El nativo sí publica la
//    clave (`NativeDevice.map()`), pero `BluetoothModule.getBondedDevices()` envuelve cada diccionario en
//    un `BluetoothDevice` que copia ocho campos y **no** ese (queda en su privado `_nativeDevice`). Sin
//    tolerar las dos formas, TODO accesorio sale con `protocolStrings: []` → `pickMfiAccessory` devuelve
//    `null` SIEMPRE → `mfi_accessory_not_found` para siempre, o sea RBM4.7 falso el día que llegue la
//    cadena. Detalle completo y el guard que lo deriva del fuente instalado: `mfiProtocolStringsOf` en
//    `ea-protocols.ts`.
//
// ── LAS LECCIONES DEL SPP SON REQUISITOS ACÁ TAMBIÉN (RBM3) ─────────────────────────────────────────
// Los tres 🔴 del SPP son defectos de la MÁQUINA DE ESTADOS EN LOS BORDES, no accidentes de una
// librería, y este transporte tiene los mismos bordes (latch, radio, eventos del SO que se pueden
// perder): presupuesto en TODO await del puente + latch con generación liberado en `finally` y en
// `disconnect()`; desconexión filtrada por NUESTRA dirección (el evento es GLOBAL); segunda fuente de
// verdad del liveness (foreground + poll) fail-closed; foreground chequeado AL DISPARAR; tope de la
// cadena que nadie pidió (`connect-trigger.ts`); dwell del backoff; watchdog de mudez. Están escritas acá
// y no "para cuando se destrabe" justamente porque el día que llegue la cadena del fabricante **no tiene
// que haber código nuevo** (RBM4.7).
//
// IMPORT PEREZOSO (RMV5.6, patrón `feedback.ts`): `react-native` y `react-native-bluetooth-classic` se
// `require` DENTRO de las funciones, envueltos en try/catch — NUNCA top-level. Los imports de arriba son
// SOLO tipos + módulos PUROS, así que este archivo se importa en web y en CI sin el módulo nativo.

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import type { ReaderDriver } from './driver-types';
import { DRIVER_REGISTRY } from './driver-registry';
import { backoffDelayMs } from './line-framer';
import {
  declaredEaProtocols,
  mfiAvailability,
  mfiConnectOptions,
  mfiConnectRetryPolicy,
  classifyMfiConnectError,
  normalizeMfiAccessories,
  pickMfiAccessory,
  resolveMfiParams,
  type MfiUnresolvedReason,
} from './ea-protocols';
// El split defensivo del payload es EL MISMO en las dos ramas de la lib, porque la clase que framea es la
// misma (`DelimitedStringDeviceConnectionImpl`: un mensaje completo, sin el terminador). Se reusa en vez
// de recopiarlo: dos implementaciones de la misma verdad divergen, y acá divergir significa perder
// lecturas. La suite de este adapter fija por comportamiento lo que dependemos de ella (dos tramas
// pegadas → dos lecturas), así que un cambio hecho por motivos del SPP no puede romper esto en silencio.
import { splitSppPayload } from './spp-protocol';
import {
  DEFAULT_BRIDGE_TIMINGS,
  withTimeout,
  withTimeoutOr,
  isBridgeTimeout,
  type BridgeTimings,
} from './bridge-timeout';
import {
  policyFor,
  UNPROMPTED_RETRY_BUDGET_MS,
  LINK_DWELL_MS,
  type ConnectTrigger,
} from './connect-trigger';
import { logTransportEvent } from './logging';

// ── Superficie de la rama iOS de `react-native-bluetooth-classic` que usamos (modelada localmente: la
//    lib no se importa por tipo, para no meterla en el grafo de módulos de web/CI) ──────────────────
export interface MfiSubscription {
  remove(): void;
}

export interface MfiDeviceLike {
  /** `accessory.serialNumber` (el nativo lo publica como `address` y como `id`). */
  address?: string;
  name?: string;
  /** Se suscribe a `DEVICE_READ@<serial>`: el nativo entrega mensajes YA delimitados (hallazgo 2). */
  onDataReceived(cb: (event: { data?: string }) => void): MfiSubscription;
  disconnect(): Promise<boolean>;
}

/**
 * Los métodos del módulo que este adapter usa. La lista es CORTA a propósito: lo que no está en esta
 * interfaz **no se puede llamar sin que el typecheck lo vea**, y hay dos cosas que no queremos poder
 * llamar nunca en iOS:
 *   · `availableFromDevice` → bucle infinito en el nativo + selector inexistente (hallazgo 5);
 *   · `requestBluetoothEnabled` / `startDiscovery` / `pairDevice` → `Method not implemented` en iOS.
 * La ausencia de la firma es un guard más fuerte que un comentario (mismo criterio con el que F3 borró
 * `cancelDeviceConnection` del modelo del BLE).
 */
export interface MfiNative {
  /** iOS: `EAAccessoryManager.connectedAccessories` mapeados, **con `protocolStrings`**. */
  getBondedDevices(): Promise<unknown>;
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<MfiDeviceLike>;
  /**
   * SEGUNDA FUENTE DE VERDAD del liveness (BENCH-1). En iOS es `connections[deviceId] != nil`, y ese
   * diccionario lo limpia el observer de `.EAAccessoryDidDisconnect`, que corre **en el nativo** y no
   * depende de que el evento llegue a JS (el `sendEvent` de la lib descarta el evento si no hay bridge o
   * si nadie registró un listener). Opcional en esta interfaz por prudencia —una versión más vieja podría
   * no tenerlo—: sin sonda no hay segunda fuente de verdad y se lo dice el log, en vez de fingir que el
   * link está sano.
   */
  isDeviceConnected?(address: string): Promise<boolean>;
  /** Evento GLOBAL `DEVICE_DISCONNECTED` (cualquier accesorio): se filtra por nuestra dirección. */
  onDeviceDisconnected?(cb: (event: unknown) => void): MfiSubscription;
}

/** Qué timer es cada uno (los tests filtran por acá; un timer nuevo tiene que nombrarse). */
export type MfiTimerLabel = 'reconnect' | 'watchdog';

/**
 * El borde del módulo nativo, partido en TRES operaciones con costos distintos — igual que el
 * `BleModuleEnv` de F4 (🟠-1 de su review) y por el mismo motivo:
 *   · `platformIsIos()`       → lee `Platform.OS`. Es una constante de JS: no instancia nada.
 *   · `nativeModulePresent()` → lee `NativeModules.RNBluetoothClassic`. **Esto YA instancia el módulo**
 *     en bridgeless, así que RBM4.2 lo prohíbe con la lista de protocolos vacía. No es "consultar barato"
 *     como en el BLE: acá el chequeo también cuenta como tocar el nativo.
 *   · `loadNative()`          → `require` de la lib (que además construye su `NativeEventEmitter`).
 *
 * Entra como entorno inyectable —y no como tres funciones sueltas— para que el oráculo del gate pueda
 * **contar llamadas** en vez de aserrar sobre el texto de un comentario.
 */
export interface MfiModuleEnv {
  platformIsIos: () => boolean;
  nativeModulePresent: () => boolean;
  loadNative: () => MfiNative | null;
}

const REAL_MFI_MODULE_ENV: MfiModuleEnv = {
  platformIsIos: () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Platform } = require('react-native') as typeof import('react-native');
      return Platform.OS === 'ios';
    } catch {
      return false; // sin RN (web/CI): no hay ExternalAccessory y no hay nada que reportar
    }
  },
  // Chequeo del MÓDULO NATIVO y no del paquete JS: `react-native-bluetooth-classic` resuelve igual desde
  // `node_modules` aunque el binario no esté en el IPA, y en ese caso su default export es un wrapper con
  // el nativo en `undefined` que tira recién al primer método. Sin este chequeo montaríamos un transporte
  // fantasma → un CTA que promete y no cumple (el bug que cerró el fix del chip, 2026-07-29).
  //
  // El catch va en SILENCIO: en web y en CI `react-native` no resuelve, y eso es lo esperado.
  nativeModulePresent: () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { NativeModules } = require('react-native') as typeof import('react-native');
      return NativeModules != null && (NativeModules as Record<string, unknown>).RNBluetoothClassic != null;
    } catch {
      return false;
    }
  },
  // Este SÍ se loguea, y la distinción es el punto: un try/catch mudo acá convertiría "la lib explotó al
  // inicializarse" en "el operario no está bastoneando" — el transporte no se montaría y no habría NADA
  // que lo explicara (el hallazgo del review de F1).
  loadNative: () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('react-native-bluetooth-classic');
      const native = (mod?.default ?? mod) as MfiNative | null;
      if (native == null || typeof native.connectToDevice !== 'function') {
        logTransportEvent({ kind: 'connect_error', message: 'mfi_module_load_failed: sin connectToDevice' });
        return null;
      }
      return native;
    } catch (e) {
      logTransportEvent({ kind: 'connect_error', message: `mfi_module_load_failed: ${errorMessage(e)}` });
      return null;
    }
  },
};

let mfiModuleEnv: MfiModuleEnv = REAL_MFI_MODULE_ENV;

/**
 * El primer `ReaderDriver` del registro que declara el transporte `mfi`, o `null` si ninguno lo hace
 * (**el estado de hoy**, RBM4.6: nadie inventa una `protocolString`). PURA (el registro se inyecta) y
 * exportada para poder testear las dos ramas sin device.
 *
 * "El primero" es aceptable por lo mismo que en `bleGattDriverFrom`: cuál lector se monta cuando hay
 * varios candidatos lo decide el BASTÓN RECORDADO (RBM5.6), no la posición en una lista, y mientras haya
 * a lo sumo uno la elección es determinística. El guard que caza el día que aparezca el segundo vive en
 * `adapter-mfi-ios.test.ts`.
 */
export function mfiDriverFrom(registry: ReaderDriver[] = DRIVER_REGISTRY): ReaderDriver | null {
  return registry.find((d) => d.transports.some((t) => t.kind === 'mfi')) ?? null;
}

/**
 * ¿Este build puede hablar MFi en este dispositivo? Lo consulta `instantiateTransport` ANTES de montar el
 * adapter, y también la pantalla de conexión para saber si puede ofrecer el transporte (RBM2.3 aplicado a
 * este transporte).
 *
 * ── EL ORDEN DE LOS CHEQUEOS **ES** EL REQUISITO (RBM4.2) ───────────────────────────────────────────
 * El módulo nativo se consulta ÚLTIMO, y solo si el gate de datos pasó:
 *   1. ¿iOS? — `Platform.OS`, no instancia nada;
 *   2. ¿algún lector del registro declara `mfi`? — puro;
 *   3. ¿el build declara SU cadena de protocolo? — lee el manifiesto de expo (`Constants.expoConfig`),
 *      **no** `NativeModules`. Con la lista vacía —hoy— se corta ACÁ: es el gate;
 *   4. ¿el binario está en este build? — recién acá se lee `NativeModules.RNBluetoothClassic`, que en
 *      bridgeless INSTANCIA el módulo (y con él `EAAccessoryManager.shared()` y el force-cast del
 *      `init()` sobre la clave del plist).
 * Cada motivo se loguea por separado porque mandan a lugares distintos (ver `mfi_unavailable`).
 */
export function isMfiTransportAvailable(
  registry: ReaderDriver[] = DRIVER_REGISTRY,
  declared: readonly string[] = declaredEaProtocols(),
): boolean {
  const unavailable = (reason: MfiUnresolvedReason): false => {
    logTransportEvent({ kind: 'mfi_unavailable', reason });
    return false;
  };
  if (!mfiModuleEnv.platformIsIos()) return unavailable('plataforma-no-ios');
  const driver = mfiDriverFrom(registry);
  if (driver == null) return unavailable('driver-sin-mfi');
  const availability = mfiAvailability(driver, declared);
  if (!availability.available) return unavailable(availability.reason);
  // El fin de trama también decide si el transporte es alcanzable: uno que la rama iOS no puede framear
  // (vacío o multi-carácter, hallazgo 3) daría un link conectado y mudo. Se corta acá, no al conectar.
  const params = resolveMfiParams(driver);
  if (!params.ok) return unavailable(params.reason);
  if (!mfiModuleEnv.nativeModulePresent()) return unavailable('modulo-nativo-ausente');
  return true;
}

/**
 * SOLO PARA TESTS: restaura (o inyecta) el borde del módulo nativo. Es lo que permite **contar** si el
 * gate de RBM4.2 tocó el nativo, en vez de aserrar sobre un comentario.
 */
export function __resetMfiModuleStateForTests(env?: MfiModuleEnv): void {
  mfiModuleEnv = env ?? REAL_MFI_MODULE_ENV;
}

// ─── Helpers puros de este módulo ────────────────────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e != null && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

/**
 * Compara identificadores de accesorio de forma tolerante. En iOS el id es `accessory.serialNumber` (no
 * una MAC), y lo comparamos case-insensitive por el mismo motivo que el SPP compara MACs así: el string
 * que devuelve el SO y el que guardamos pueden diferir en el case y una comparación estricta convertiría
 * eso en "el evento de desconexión nunca llega".
 */
function sameAccessory(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Extrae el id del accesorio de un evento del nativo. El payload de `DEVICE_DISCONNECTED` es
 * `{eventType, device: {name, address, id, …}, timestamp}` (`BluetoothDeviceEvent.map()` +
 * `NativeDevice.map()`); se toleran las variantes por defensa y `null` significa "no se pudo determinar".
 */
function eventAccessoryId(event: unknown): string | null {
  if (event == null || typeof event !== 'object') return null;
  const e = event as { device?: { address?: unknown; id?: unknown }; address?: unknown };
  for (const candidate of [e.device?.address, e.device?.id, e.address]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return null;
}

/**
 * Log uniforme de un await del puente que falló o venció, con dos kinds distintos a propósito: hay que
 * poder separar "el nativo contestó un error" de "el nativo NO contestó". Si el error ES un vencimiento,
 * gana SU `label`/`ms` sobre los del caller (el que sabe qué await se perdió es el `withTimeout` que lo
 * envolvió). Copia deliberada del helper del SPP y del BLE: son tres archivos con el mismo borde y
 * compartirlo obligaría a exportar ruido de un adapter a otro.
 */
function logBridgeFailure(label: string, ms: number, error: unknown): void {
  if (isBridgeTimeout(error)) logTransportEvent({ kind: 'bridge_timeout', label: error.label, ms: error.ms });
  else logTransportEvent({ kind: 'connect_error', message: `${label}: ${errorMessage(error)}` });
}

function timeoutOf(env: Pick<MfiEnv, 'timeouts'>, key: keyof BridgeTimings): number {
  return env.timeouts?.[key] ?? DEFAULT_BRIDGE_TIMINGS[key];
}

/**
 * Entorno de I/O del adapter (patrón `SppEnv` / `BleEnv`). Los defaults son los reales; los tests
 * inyectan dobles. No es adorno: es lo que permite ejercitar la máquina de estados entera —accesorio
 * ausente, radio apagada, protocolo rechazado, promesas que no resuelven, corte del SO, desconexión de
 * OTRO accesorio, backoff, dwell, liveness, background— sin un accesorio MFi y sin un iPhone.
 */
export interface MfiEnv {
  /** El borde del módulo nativo. Cargarlo YA toca ExternalAccessory: solo detrás del gate (RBM4.2). */
  loadNative: () => MfiNative | null;
  /**
   * Las cadenas de protocolo que el build declara. REQUERIDA y sin default: es EL gate de este transporte
   * (RBM4.2) y un default a `[]` lo dejaría clavado en "build-sin-protocolos" incluso el día que la cadena
   * del fabricante esté en el plist — o sea, RBM4.7 sería falso sin que nada se pusiera rojo. El entorno
   * real pasa `declaredEaProtocols`.
   */
  declaredProtocols: () => readonly string[];
  readRemembered: () => Promise<string | null>;
  writeRemembered: (deviceId: string) => Promise<void>;
  isForeground: () => boolean;
  /** Programa un timer etiquetado. Devuelve un cancelador. */
  schedule: (fn: () => void, ms: number, label: MfiTimerLabel) => () => void;
  /** Suscribe al retorno a foreground. Devuelve unsubscribe. */
  onForeground: (cb: () => void) => Unsubscribe;
  /** Reloj inyectable (dwell del backoff + medición de la mudez). Default `Date.now`. */
  now?: () => number;
  /**
   * Presupuestos de los awaits del puente + períodos de los timers del link (`bridge-timeout.ts`).
   * Default `DEFAULT_BRIDGE_TIMINGS`. Un valor ≤ 0 significa "sin timeout" / "sin poll": es la puerta
   * explícita para los tests que no ejercitan el vencimiento, NO un valor válido de producción.
   *
   * ⚠️ `prompt` no se usa en este transporte y no es un olvido: en MFi **no hay diálogo que esperar** (no
   * hay permiso de runtime que pedir y iOS no tiene API para pedir que prendan el Bluetooth). Ver
   * `permissionModelFor('mfi-ios')` → `{kind:'ios-mfi'}`.
   */
  timeouts?: Partial<BridgeTimings>;
}

/** Entorno real (defaults del constructor). Cada pieza de I/O va con require perezoso + try/catch. */
export function defaultMfiEnv(): MfiEnv {
  return {
    loadNative: () => mfiModuleEnv.loadNative(),
    declaredProtocols: declaredEaProtocols,
    readRemembered: async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { readRememberedDevice } = require('./remembered-device') as typeof import('./remembered-device');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { rememberedDeviceIdFor } = require('./remembered-format') as typeof import('./remembered-format');
        // El id se toma SOLO si el registro es de ESTE transporte (🟠-2 del review de F4): el bastón
        // recordado puede ser el del SPP o el del BLE, y abrir una `EASession` contra una MAC de Classic
        // no falla rápido —el nativo rechaza `device_not_found` si no está en la lista, pero un id ajeno
        // que casualmente exista sería el accesorio equivocado—. Sin registro propio, el camino correcto
        // es LISTAR los accesorios y elegir por protocolo. `acceptsLegacy: false`: un registro en el
        // formato viejo (string pelado) solo pudo escribirlo el SPP, que era el único escritor antes de
        // este delta y solo corre en Android.
        return rememberedDeviceIdFor(await readRememberedDevice(), 'mfi-ios', { acceptsLegacy: false });
      } catch {
        return null;
      }
    },
    writeRemembered: async (deviceId: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { writeRememberedDevice } = require('./remembered-device') as typeof import('./remembered-device');
        // El `adapterKind` no es decorativo (RBM5.6): este es el único punto que SABE con qué transporte
        // se abrió el link, y es lo que hace que el próximo arranque monte MFi en vez del piso por
        // plataforma (`ble-gatt` en iOS). Sin este literal, la preferencia nunca se escribe y el
        // transporte queda alcanzable solo por un gesto, cada vez.
        await writeRememberedDevice(deviceId, { adapterKind: 'mfi-ios' });
      } catch {
        // best-effort: si falla, la próxima vez se elige el accesorio de nuevo
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

export class MfiIosAdapter implements StickAdapter {
  readonly kind = 'mfi-ios' as const;

  /**
   * El lector con el que este adapter habla (RBM1.3). **INMUTABLE por instancia** (`readonly` + entra por
   * constructor): el provider resuelve el `ReadSource` —y con él el `frameParser`— UNA vez al cablear el
   * adaptador, así que un `driver` mutable dejaría el transporte parseando con el parser del lector
   * anterior (ver el recuadro del design §4).
   *
   * Puede quedar en `undefined`: hoy **ningún** driver del registro declara `mfi` (RBM4.6), y un throw en
   * el constructor se llevaría el render del provider por un dato de configuración. Sin driver, `connect()`
   * corta en el gate con `driver-sin-mfi` y la app queda manual-first. Y si además llegara una lectura
   * (imposible sin sesión abierta, pero el invariante vale igual), el modo de ingesta `raw-line` sin driver
   * hace que `resolveFrameParser` devuelva `null` y la línea se descarte con log — el fail-closed de
   * RBM1.4, que es lo correcto para un transporte que no sabe con qué lector está hablando.
   */
  readonly driver?: ReaderDriver;

  private readonly env: MfiEnv;
  private tagListeners = new Set<(rawLine: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;
  private device: MfiDeviceLike | null = null;
  private dataSub: MfiSubscription | null = null;
  private disconnectSub: MfiSubscription | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private cancelScheduled: (() => void) | null = null;
  private cancelWatchdog: (() => void) | null = null;
  private unsubForeground: Unsubscribe | null = null;
  private unsubLiveness: Unsubscribe | null = null;
  private currentDeviceId: string | null = null;
  /** Generación del INTENTO (🔴-1 (b) del review del SPP): un intento viejo que despierta no pisa al vigente. */
  private connectGeneration = 0;
  /** Generación que tiene el latch tomado (null = libre). */
  private inFlightGen: number | null = null;
  /** Target del intento en curso (null = "el recordado / el que aparezca"). */
  private inFlightTarget: string | null = null;
  /** Accesorio pedido MIENTRAS había un intento en curso: se atiende al terminar (🟠-2). */
  private pendingTarget: string | null = null;
  /** Cuándo se estableció el link vigente (dwell del backoff, 🟡-3). null = no hay link. */
  private connectedAt: number | null = null;
  /** Cuándo llegó el último byte (watchdog de conectado-y-mudo, 🟠-5). */
  private lastDataAt = 0;
  /** Hasta cuándo puede reintentar la cadena vigente. `null` = SIN tope (la arrancó un gesto). */
  private retryBudgetUntil: number | null = null;
  /** Cuándo arrancó la cadena vigente (para poder decir en el log cuánto duró). */
  private chainStartedAt = 0;
  /** ¿La cadena que nadie pidió se agotó? Lo lee la pantalla para el copy honesto (R6.4). */
  autoConnectExhausted = false;
  /** Generación de la SESIÓN: los callbacks del nativo capturan la suya y descartan lo de una vieja. */
  private session = 0;

  /**
   * Parametrizado por el driver del registro (default: el primero que declare `mfi`, hoy NINGUNO).
   * Otro lector MFi → otro driver, mismo adapter.
   */
  constructor(driver: ReaderDriver | null = mfiDriverFrom(), env: MfiEnv = defaultMfiEnv()) {
    // `?? undefined`: el registro devuelve `null` cuando ningún lector declara `mfi` y la interfaz
    // `StickAdapter` declara `driver?`, así que el campo tiene que quedar AUSENTE y no `null` (un `null`
    // ahí haría que `adapter.driver?.frameParser` siguiera funcionando pero que cualquier `deepEqual` de
    // la forma del adapter cambiara sin motivo).
    this.driver = driver ?? undefined;
    this.env = env;
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }

  private ms(key: keyof BridgeTimings): number {
    return timeoutOf(this.env, key);
  }

  /**
   * Abre la sesión iAP del accesorio. Orden del camino feliz:
   *   1. **GATE DE DATOS** (RBM4.2): iOS + driver con `mfi` + su cadena declarada en el build + fin de
   *      trama frameable. Todo PURO: si algo falla, se corta ANTES de tocar el módulo nativo;
   *   2. módulo nativo presente (si no, manual-first: `disconnected`, sin reintentos);
   *   3. accesorio: el pasado, el recordado, o el primero de `getBondedDevices()` que declare la cadena;
   *   4. `connectToDevice` con el framing delimitado DEL DRIVER;
   *   5. suscripción a datos + a la desconexión del SO + watchdog + sonda de liveness.
   * Nunca bloquea la carga manual (R7): cualquier falla es un estado, no una excepción.
   */
  async connect(deviceId?: string): Promise<void> {
    await this.runConnect(deviceId, 'operator');
  }

  /**
   * RECONEXIÓN AUTOMÁTICA AL ABRIR LA APP (R6.4). La llama el provider UNA vez al montar el transporte.
   *
   * Los gates van del más barato al que toca el hardware, y el orden **es** el requisito (RBM3.8 + el
   * hallazgo 6: en iOS cualquier método del nativo puede disparar el diálogo de Bluetooth del SO):
   *   1. ¿ya hay link o intento en curso? / ¿foreground? (R6.9);
   *   2. **el gate de datos** — puro, sin tocar nada. Si MFi no está destrabado, el motivo honesto es
   *      `mfi_unavailable{…}` y no `autoconnect_skipped{no_remembered}`: mandan a lugares distintos;
   *   3. ¿hay accesorio recordado? Lectura LOCAL. Un arranque en frío NO lista accesorios ni toca la
   *      radio: para que exista un recordado el operario ya eligió uno por un gesto;
   *   4. recién entonces se carga el módulo nativo.
   * Cuando un gate no pasa **no se emite ningún estado** (queda en `'off'`, el estado honesto de "nunca se
   * intentó") y el motivo va al log: los motivos se ven idénticos desde la UI (nada).
   */
  async autoConnect(): Promise<void> {
    const skip = (reason: 'no_remembered' | 'background' | 'unavailable' | 'busy') => {
      logTransportEvent({ kind: 'autoconnect_skipped', reason });
    };

    // Ya hay link o ya hay un intento en curso: no nos metemos. Acá NO se mira `this.closed`, por el mismo
    // motivo que en el SPP (lo documenta su `autoConnect`): `closed` también lo pone el cleanup del efecto
    // del provider, y gatear por él mataba R6.4 en silencio en cada re-montaje.
    if (this.device != null || this.inFlightGen != null) {
      skip('busy');
      return;
    }
    if (!this.env.isForeground()) {
      skip('background');
      return;
    }
    // El gate de datos, ANTES de leer el storage y muy antes del nativo.
    if (this.resolveGate() == null) return; // ya logueó su motivo

    const remembered = await withTimeoutOr(
      this.env.readRemembered(),
      this.ms('storage'),
      'read_remembered',
      null,
      (error) => logBridgeFailure('read_remembered', this.ms('storage'), error),
    );
    if (!remembered) {
      // Arranque en frío: NO se listan accesorios ni se toca el nativo. Es lo que hace que el diálogo de
      // Bluetooth de iOS no pueda aparecer sin un gesto previo del operario (RBM3.8).
      skip('no_remembered');
      return;
    }
    // Re-chequeo tras el await: si alguien conectó primero (un gesto) o arrancó otro intento, nos vamos.
    if (this.device != null || this.inFlightGen != null) return;

    if (this.env.loadNative() == null) {
      skip('unavailable');
      return;
    }
    if (this.device != null || this.inFlightGen != null) return;
    await this.runConnect(remembered, 'autoconnect');
  }

  /**
   * EL GATE DE DATOS (RBM4.2/RBM4.5/RBM4.6), en un solo lugar y **puro**: devuelve los params del
   * transporte si MFi está destrabado en este build, o `null` habiendo logueado el motivo.
   *
   * No toca el módulo nativo, no lee `NativeModules` y no construye nada. Los cinco motivos van al log
   * porque desde la UI se ven idénticos (nada), y cada uno manda a un lugar distinto: al fabricante, a
   * `app.config.ts`, al registro de drivers o al build.
   */
  private resolveGate(): { protocolString: string; delimiter: string } | null {
    const unavailable = (reason: MfiUnresolvedReason): null => {
      logTransportEvent({ kind: 'mfi_unavailable', reason });
      return null;
    };
    if (!mfiModuleEnv.platformIsIos()) return unavailable('plataforma-no-ios');
    const driver = this.driver;
    if (driver == null) return unavailable('driver-sin-mfi');
    const availability = mfiAvailability(driver, this.env.declaredProtocols());
    if (!availability.available) return unavailable(availability.reason);
    const params = resolveMfiParams(driver);
    if (!params.ok) return unavailable(params.reason);
    return params.params;
  }

  /**
   * Punto único de entrada al camino de conexión. El `trigger` dice QUIÉN lo disparó, y de ahí salen las
   * dos políticas que separan un intento del operario de uno que la app hizo sola (`connect-trigger.ts`).
   * Copia deliberada de la forma del SPP: es la misma máquina de estados y el mismo latch.
   */
  private async runConnect(deviceId: string | undefined, trigger: ConnectTrigger): Promise<void> {
    if (this.inFlightGen != null) {
      // 🟠-B del review del SPP: un `connect()` del OPERARIO con un intento en vuelo no puede ser un no-op
      // mudo. Aunque no haya otro accesorio que encolar, el tap significa "quiero que insista": re-aplica
      // la política de su cadena, o sea la DESTOPA.
      const queued = this.queueTarget(deviceId);
      if (policyFor(trigger).chain !== 'inherit') this.applyChainPolicy(trigger);
      if (!queued) logTransportEvent({ kind: 'connect_reasserted', trigger });
      return;
    }
    this.applyChainPolicy(trigger);
    let target = deviceId;
    for (;;) {
      const gen = ++this.connectGeneration;
      this.inFlightGen = gen;
      this.inFlightTarget = target ?? null;
      // `closed = false` va DESPUÉS del guard de re-entrada: si fuera antes, un connect() espurio durante
      // un intento en curso borraría el `disconnect()` que el operario acababa de hacer.
      this.closed = false;
      try {
        await this.doConnect(target, gen);
      } finally {
        if (this.inFlightGen === gen) this.inFlightGen = null;
      }
      const next = this.pendingTarget;
      this.pendingTarget = null;
      if (next == null || this.closed || this.inFlightGen != null) return;
      target = next;
      // El target encolado vino de un TAP (`queueTarget` solo encola targets explícitos): su cadena es la
      // del operario, o sea SIN tope.
      this.applyChainPolicy('operator');
    }
  }

  /** Aplica al estado de la cadena la política del trigger. Único lugar que decide si hay tope. */
  private applyChainPolicy(trigger: ConnectTrigger): void {
    const { chain } = policyFor(trigger);
    if (chain === 'inherit') return; // un reintento no cambia el tope de la cadena que continúa
    this.chainStartedAt = this.now();
    this.reconnectAttempt = 0; // cadena nueva: el backoff arranca del piso
    this.autoConnectExhausted = false;
    this.retryBudgetUntil =
      chain === 'start-capped' ? this.chainStartedAt + UNPROMPTED_RETRY_BUDGET_MS : null;
  }

  /**
   * Un `connect()` a OTRO accesorio con un intento en curso (🟠-2): se encola y se atiende al terminar, en
   * vez de descartarse en silencio. Un `connect()` SIN target no encola nada (el intento en curso ya es
   * eso), pero el caller igual re-aplica la política de la cadena y deja log.
   */
  private queueTarget(deviceId: string | undefined): boolean {
    if (deviceId == null) return false;
    if (sameAccessory(deviceId, this.inFlightTarget)) return false;
    this.pendingTarget = deviceId;
    logTransportEvent({ kind: 'connect_superseded', deviceId });
    return true;
  }

  /**
   * ⚠️ **NO recibe el `trigger`**, a diferencia del `doConnect` del SPP y del BLE, y no es un olvido: allá
   * el trigger decide "pedir el permiso vs consultarlo" y "mostrar el diálogo de activar Bluetooth vs no",
   * y en MFi **no hay ninguna de las dos cosas** (`permissionModelFor('mfi-ios')` → `{kind:'ios-mfi'}`: iOS
   * gatea por la lista de protocolos del build y por el emparejamiento que hace el propio SO, y no tiene
   * API para pedir que prendan la radio). Lo único que el trigger decide acá —el tope de la cadena de
   * reintentos— ya lo aplicó `runConnect`. Un parámetro recibido y no usado sería una promesa falsa.
   */
  private async doConnect(deviceId: string | undefined, gen: number): Promise<void> {
    // Un intento en curso deja SIN EFECTO cualquier reintento pendiente (si no se cancela, el guard de
    // `scheduleReconnect` vería `cancelScheduled != null` y el corte siguiente se quedaría sin reconexión
    // para siempre) y cierra lo que hubiera abierto (dos `onDataReceived` sobre la misma sesión entregan
    // cada lectura dos veces, y la ventana de dedup lo TAPA — un leak invisible).
    this.cancelReconnect();
    await this.teardownStreams();
    if (gen !== this.connectGeneration) return;

    // ── EL GATE (RBM4.2): hasta acá NO se tocó el módulo nativo ─────────────────────────────────────
    const params = this.resolveGate();
    if (params == null) {
      // Sin protocolo no hay sesión que abrir: estado honesto y **sin reintentos** (el resultado sería
      // idéntico para siempre — RMV3.7: no se intenta una conexión que fallaría). Manual-first (R7).
      this.emitStatus('disconnected');
      return;
    }

    const native = this.env.loadNative();
    if (native == null) {
      logTransportEvent({ kind: 'mfi_unavailable', reason: 'modulo-nativo-ausente' });
      this.emitStatus('disconnected');
      return;
    }

    const remembered =
      deviceId ??
      (await withTimeoutOr(this.env.readRemembered(), this.ms('storage'), 'read_remembered', null, (error) =>
        logBridgeFailure('read_remembered', this.ms('storage'), error),
      ));
    if (gen !== this.connectGeneration) return;

    this.emitStatus('connecting');
    try {
      // Sin accesorio conocido hay que LISTAR: en iOS no existe el descubrimiento (hallazgo 1), los
      // accesorios los empareja el SO y lo único que podemos hacer es filtrar los prendidos por la cadena
      // de protocolo del driver.
      let target = remembered;
      if (!target) {
        const bonded = await withTimeout(
          native.getBondedDevices(),
          this.ms('call'),
          'get_bonded_devices',
        );
        if (gen !== this.connectGeneration) return;
        const accessories = normalizeMfiAccessories(bonded);
        const match = pickMfiAccessory(accessories, params.protocolString);
        if (match == null) {
          // `seen` separa dos causas que desde la UI se ven igual ("no pasó nada"): CERO accesorios
          // prendidos (el bastón está apagado o no está emparejado en Ajustes) vs. accesorios prendidos
          // que NO hablan esta cadena (otro aparato MFi del teléfono). Es el mismo diagnóstico que
          // `ble_scan_timeout{seen}` compró en F3.
          logTransportEvent({
            kind: 'connect_error',
            message: `mfi_accessory_not_found: seen=${accessories.length}`,
          });
          this.emitStatus('disconnected');
          // SÍ se reintenta: lo pueden prender o emparejar en cualquier momento (con el tope de la cadena
          // si nadie lo pidió).
          this.scheduleReconnect();
          return;
        }
        target = match.id;
      }
      // El objetivo se recuerda ACÁ y no recién al conectar: si se anotara solo en el éxito, el reintento
      // del backoff llamaría `connect(undefined)` y volvería a listar desde cero — perdiendo el accesorio
      // que ya habíamos identificado.
      this.currentDeviceId = target;
      this.inFlightTarget = target;

      const pending = native.connectToDevice(
        target,
        mfiConnectOptions(params.delimiter) as unknown as Record<string, unknown>,
      );
      const device = await withTimeout(pending, this.ms('connect'), 'connect_to_device', () => {
        // El nativo puede resolver DESPUÉS del vencimiento con la sesión ya abierta. Si no se cierra,
        // queda en su `connections` sin que nadie la lea —y la sonda de liveness diría "vivo" sobre una
        // sesión fantasma—. Pero cerrarla a ciegas es peor: ver `canCloseOrphanSocket`.
        void pending
          .then((d) => {
            if (!this.canCloseOrphanSocket(gen)) {
              logTransportEvent({ kind: 'orphan_socket_kept', reason: 'address_owned_by_newer' });
              return undefined;
            }
            return d?.disconnect?.();
          })
          .catch(() => undefined);
      });
      if (this.closed || gen !== this.connectGeneration) {
        // El operario tocó "Desconectar" (o eligió otro accesorio) MIENTRAS se abría la sesión: el
        // `disconnect()` no tenía nada que cerrar todavía y este `await` habría dejado la sesión abierta a
        // sus espaldas. Salvo que la dirección ya sea de un intento MÁS NUEVO (`canCloseOrphanSocket`).
        if (this.canCloseOrphanSocket(gen)) {
          try {
            await withTimeout(device.disconnect(), this.ms('call'), 'abort_disconnect');
          } catch {
            // ignorar
          }
        } else {
          logTransportEvent({ kind: 'orphan_socket_kept', reason: 'address_owned_by_newer' });
        }
        if (gen === this.connectGeneration) this.emitStatus('disconnected');
        return;
      }
      const session = ++this.session;
      this.device = device;
      this.connectedAt = this.now();
      this.lastDataAt = this.now();
      // EL PRESUPUESTO DE LA CADENA MUERE ACÁ (🔴-A del review del SPP / HIGH-1 del Gate 2): el tope
      // existe por "ese bastón lo vendí, lo rompí o quedó en otro campo", y en el instante en que el
      // accesorio CONTESTA ese motivo dejó de aplicar. Sin esta línea, el tope no acotaba "la cadena que
      // nadie pidió" sino los primeros 120 s de vida de la app.
      this.retryBudgetUntil = null;
      // Persiste el accesorio elegido + su transporte (RBM5.6). Best-effort y acotado: si el storage se
      // cuelga, no puede dejar la conexión a medio armar (sin suscripción a datos y sin `connected`).
      await withTimeoutOr<void>(
        this.env.writeRemembered(target),
        this.ms('storage'),
        'write_remembered',
        undefined,
        (error) => logBridgeFailure('write_remembered', this.ms('storage'), error),
      );
      if (this.closed || gen !== this.connectGeneration || this.session !== session) {
        // Un disconnect (o un connect a otro accesorio) entró mientras persistíamos: `teardownStreams` ya
        // cerró esta sesión y bumpeó el contador. Suscribirnos ahora dejaría un listener vivo sobre una
        // sesión muerta y emitiría un 'connected' mentiroso.
        return;
      }

      this.dataSub = device.onDataReceived((event) => {
        if (this.session !== session) return; // lectura de una sesión ya cerrada → se descarta
        this.lastDataAt = this.now();
        // El framing lo hizo el nativo con el terminador DEL DRIVER (hallazgo 2): acá solo se separa
        // defensivamente por si el payload trajera varios mensajes pegados. La línea va CRUDA al contrato
        // (RBM4.9: el modo de ingesta de `mfi-ios` es `raw-line` y el `frameParser` sale del driver).
        for (const line of splitSppPayload(event?.data, params.delimiter)) {
          if (this.listening) this.emitTag(line);
        }
      });

      // Desconexión reportada por el SO (accesorio apagado / desemparejado). ⚠️ EL EVENTO ES GLOBAL:
      // `onDeviceDisconnected` se suscribe a `DEVICE_DISCONNECTED` PELADO (comparar con `onDeviceRead`,
      // que sí es `DEVICE_READ@<serial>`) y en iOS lo alimenta el observer de `.EAAccessoryDidDisconnect`,
      // que se dispara con **cualquier** accesorio MFi del teléfono. Sin este filtro, apagar otro
      // accesorio cerraría la sesión del bastón y dispararía el backoff sobre un link sano (🔴-2). Un
      // evento SIN id legible se acepta (es la señal que teníamos): preferimos un teardown de más que un
      // "conectado" mentiroso, y la sonda de liveness cubre el falso positivo reconectando enseguida.
      const ourIds = [target, device.address].filter(
        (a): a is string => typeof a === 'string' && a.length > 0,
      );
      if (typeof native.onDeviceDisconnected === 'function') {
        this.disconnectSub = native.onDeviceDisconnected((event) => {
          if (this.closed || this.session !== session) return;
          const id = eventAccessoryId(event);
          if (id != null && !ourIds.some((a) => sameAccessory(id, a))) return;
          void this.teardownStreams();
          this.emitStatus('disconnected');
          this.scheduleReconnect();
        });
      }

      // BENCH-1: segunda fuente de verdad, porque el evento de arriba SE PUEDE PERDER — y en iOS con más
      // razón que en Android: el `sendEvent` de la lib descarta el evento si el bridge no está seteado, y
      // encima emite por `RCTBridge` (bajo bridgeless, `RCTBridgeProxy`). La sonda pregunta por el estado
      // del NATIVO, que lo mantiene un observer de NotificationCenter que corre sin pasar por JS.
      if (typeof native.isDeviceConnected !== 'function') {
        // Sin sonda volvemos a depender de un evento que se puede perder. Se dice UNA vez por conexión (no
        // en cada poll) en vez de fingir que BENCH-1 está cubierto.
        logTransportEvent({ kind: 'connect_error', message: 'liveness_probe_unavailable' });
      }
      this.armLivenessProbe(target);
      this.armWatchdog(session, target);

      this.emitStatus('connected');
    } catch (e) {
      if (gen !== this.connectGeneration) return;
      // Falla de conexión → no bloquea el manual (R7). Y **el motivo decide si se reintenta**
      // (`mfiConnectRetryPolicy`): la cadena de protocolo que este build no declara no se arregla
      // martillando la radio, mientras que un accesorio apagado o la radio abajo sí pueden cambiar solos.
      const failure = classifyMfiConnectError(e);
      logBridgeFailure(`connect_path:${failure}`, this.ms('connect'), e);
      this.emitStatus('disconnected');
      if (mfiConnectRetryPolicy(failure) === 'retry') this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    // Invalida el intento en curso y LIBERA EL LATCH (🔴-1 (b)): el intento viejo, al despertar de su
    // await, ve que ya no es la generación vigente, cierra lo que abrió y se va sin tocar el estado.
    this.connectGeneration += 1;
    this.inFlightGen = null;
    this.inFlightTarget = null;
    this.pendingTarget = null;
    // El dwell lo consume `scheduleReconnect`; un disconnect explícito no reconecta, así que el dato tiene
    // que morir acá o el próximo corte lo leería viejo.
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

  // ─── Liveness: la app no confía en un evento que puede perder (🔴 BENCH-1) ────────────────────────

  /** Reconciliación AL VOLVER A FOREGROUND (independiente del backoff; vive mientras hay link). */
  private armLivenessProbe(address: string | undefined): void {
    if (this.unsubLiveness != null || address == null) return;
    this.unsubLiveness = this.env.onForeground(() => {
      void this.verifyLiveness('foreground', address);
    });
  }

  /**
   * Watchdog del link: SONDA PERIÓDICA de liveness + registro de la mudez.
   *
   * (a) LIVENESS (BENCH-1): sondea cada `livenessPoll` sin depender de ningún evento ni de AppState. Es
   *     lo que acota cuánto puede durar un "Bastón conectado" mentiroso.
   * (b) MUDEZ (🟠-5): un lector con el terminador equivocado, un lector dormido, una sesión muerta y —en
   *     iOS— **el evento de lectura que no llega a JS** producen EXACTAMENTE el mismo síntoma desde
   *     afuera: "connected", cero lecturas, cero errores. El silencio NO desconecta (es lo normal cuando
   *     el operario no bastonea) pero queda ESCRITO, que es lo único que hace distinguibles esos casos.
   */
  private armWatchdog(session: number, address: string | undefined): void {
    const poll = this.ms('livenessPoll');
    if (!Number.isFinite(poll) || poll <= 0 || this.cancelWatchdog != null) return;
    this.cancelWatchdog = this.env.schedule(
      () => {
        this.cancelWatchdog = null;
        if (this.closed || this.session !== session) return;
        const silentMs = this.now() - this.lastDataAt;
        if (silentMs >= this.ms('silence')) logTransportEvent({ kind: 'connected_silent', ms: silentMs });
        void this.verifyLiveness('poll', address);
        this.armWatchdog(session, address);
      },
      poll,
      'watchdog',
    );
  }

  /**
   * ¿La sesión que creemos abierta sigue viva del lado nativo? Fail-closed: si la sonda no está
   * disponible o RECHAZA (el nativo rechaza `bluetooth_disabled` con la radio abajo — o sea, seguro NO
   * estamos conectados), no seguimos afirmando "conectado". El peor caso es un teardown + reconexión de
   * más; el caso que evita es 40 bastonazos perdidos sin un solo indicio.
   */
  private async verifyLiveness(reason: 'foreground' | 'poll', address: string | undefined): Promise<void> {
    if (this.closed || this.device == null || address == null) return;
    if (this.inFlightGen != null) return; // ya hay un intento en curso: que decida él
    const session = this.session;
    const native = this.env.loadNative();
    if (native == null || typeof native.isDeviceConnected !== 'function') return;
    let alive = false;
    let why = 'session_closed';
    try {
      alive = await withTimeout(native.isDeviceConnected(address), this.ms('call'), 'is_device_connected');
    } catch (e) {
      why = errorMessage(e);
    }
    // Mientras sondeábamos pudo pasar cualquier cosa (un disconnect, otro connect): no pisamos.
    if (this.closed || this.session !== session || this.inFlightGen != null) return;
    if (alive) return;
    logTransportEvent({ kind: 'liveness_lost', reason, message: why });
    await this.teardownStreams();
    this.emitStatus('disconnected');
    this.scheduleReconnect();
  }

  // ─── Reconexión foreground-only con backoff ───────────────────────────────────────────────────────

  /**
   * Programa un reintento. Foreground-only (R6.9), pero si la app NO está en foreground se queda
   * ESPERANDO el retorno a 'active' en vez de abandonar (el caso de "guardé el teléfono en el bolsillo").
   */
  private scheduleReconnect(): void {
    if (this.closed || this.cancelScheduled != null || this.unsubForeground != null) return;

    // TOPE de la cadena que NADIE pidió (R6.4). Va ANTES del gate de foreground a propósito: una cadena
    // con el presupuesto vencido tiene que MORIR, no quedarse esperando el retorno a primer plano para
    // seguir martillando (si no, el tope se vuelve evitable guardando el teléfono en el bolsillo).
    if (this.unpromptedBudgetSpent()) {
      this.exhaustUnpromptedChain();
      return;
    }

    if (!this.env.isForeground()) {
      this.waitForForeground();
      return;
    }

    // Dwell (🟡-3): el contador se resetea solo si el link que se acaba de caer DURÓ. Sin esto, un flap
    // produce 500 ms → 500 ms → 500 ms para siempre.
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
        // El TOPE se re-chequea acá, y ANTES del gate de foreground (si fuera al revés, un timer que
        // dispara en background se parquearía sin pasar por el chequeo del presupuesto y una cadena
        // vencida quedaría de zombi esperando el foreground para volver a martillar).
        if (this.unpromptedBudgetSpent()) {
          this.exhaustUnpromptedChain();
          return;
        }
        // El gate de foreground se re-chequea AL DISPARAR, no solo al programar (🟠-1): entre armar (hasta
        // 8 s de backoff) y disparar, la app puede haberse ido a background.
        if (!this.env.isForeground()) {
          this.waitForForeground();
          return;
        }
        // `retry` = continúa la cadena vigente y HEREDA su tope (o su ausencia). Con 'operator' o
        // 'autoconnect' acá, el timer re-arrancaría la cadena en cada vuelta y el tope no se alcanzaría
        // nunca — la cadena infinita que este trigger vino a acotar.
        void this.runConnect(this.currentDeviceId ?? undefined, 'retry');
      },
      delay,
      'reconnect',
    );
  }

  /**
   * ¿Este intento (`gen`) puede cerrar la sesión que abrió, sin arrastrarse la de otro? (MEDIUM-1 del
   * Gate 2.) `device.disconnect()` de la lib no cierra "esa" sesión: cierra la de **esa dirección**
   * (`disconnectFromDevice(this.address)`), y el nativo devuelve la conexión EXISTENTE si la dirección ya
   * está conectada. Así que un intento que venció y resuelve tarde le cerraría la sesión al que reconectó
   * después.
   */
  private canCloseOrphanSocket(gen: number): boolean {
    if (this.closed) return true; // el operario no quiere NADA en esa dirección
    return gen === this.connectGeneration;
  }

  /** ¿La cadena vigente tiene tope y ya se le pasó? (`null` = cadena del operario, sin tope). */
  private unpromptedBudgetSpent(): boolean {
    return this.retryBudgetUntil != null && this.now() >= this.retryBudgetUntil;
  }

  /**
   * Se agotó el tope de la cadena que nadie pidió: se deja de reintentar. NO se olvida el accesorio
   * recordado (que hoy no aparezca no significa que no sea el bastón del operario) y se emite `'off'` —
   * el estado honesto de "no conectado y sin estar intentando", que además tiene CTA y es el único que el
   * indicador global se auto-oculta.
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
    this.session += 1; // invalida los callbacks de la sesión que se está cerrando
    if (this.cancelWatchdog) {
      this.cancelWatchdog();
      this.cancelWatchdog = null;
    }
    if (this.unsubLiveness) {
      this.unsubLiveness();
      this.unsubLiveness = null;
    }
    for (const sub of [this.dataSub, this.disconnectSub]) {
      if (!sub) continue;
      try {
        sub.remove();
      } catch {
        // ignorar
      }
    }
    this.dataSub = null;
    this.disconnectSub = null;
    if (this.device) {
      const device = this.device;
      this.device = null;
      try {
        await withTimeout(device.disconnect(), this.ms('call'), 'teardown_disconnect');
      } catch {
        // ignorar: la sesión puede haberse cerrado sola (y un `disconnect()` que no vuelve no puede dejar
        // colgado el teardown — que es lo que dejaría el latch tomado).
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
