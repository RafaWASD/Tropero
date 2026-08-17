// adapter-spp-android — RS420 por Bluetooth Classic SPP en Android (RMV5, ADR-024 §2/§3).
// `StickAdapter` real (`kind:'spp-android'`) sobre `react-native-bluetooth-classic`, parametrizado
// por el `ReaderDriver` del registro (RMV5.2).
//
// ── ESTADO (2026-07-30): el camino LEE DE VERDAD ────────────────────────────────────────────────
// La dependencia nativa está instalada, el adapter se monta en Android y —desde el banco del
// 2026-07-30 contra el ESP32 emulando un RS420— la cadena completa (RFCOMM → splitSppPayload →
// parser-rs420 → isValidTag → dedup → UI) está verificada EN DEVICE, con 16 escenarios corridos
// (`progress/bench_baston-spp-emulador.md`). Lo único que sigue gated por hardware son las
// idiosincrasias del lector físico (RMV5.9 / T-MV.5.6).
//
// ── DOS BUGS DEL CÓDIGO ANTERIOR, corregidos en la pasada de bring-up (los habría comido el device)
// 1. FRAMING. El adapter pasaba `event.data` por `LineFramer` (cortar por `\n`). El nativo entrega
//    MENSAJES YA DELIMITADOS y SIN el terminador (`DelimitedStringDeviceConnectionImpl`)
//    → el framer nunca encontraba un `\n` y devolvía `[]` para siempre: CERO lecturas, aun con el
//    bastón enchufado, y ningún test lo veía porque el framer se testeaba con datos sintéticos que
//    sí traían `\n`. Ahora el framing lo hace el nativo y acá solo se separa defensivamente
//    (`splitSppPayload`).
// 2. PAIRING QUE CUELGA. Se llamaba `pairDevice()` en CADA connect. El nativo hace `createBond()` y
//    espera un broadcast de cambio de bond-state; sobre un device YA EMPAREJADO —el caso normal—
//    `createBond()` devuelve false, el broadcast nunca llega y la promesa NUNCA RESUELVE: el
//    `await` dejaba el estado clavado en 'connecting' para siempre. Ya no se llama: el RS420 se
//    empareja una vez desde los ajustes de Android (es slave, PIN 1234) y, si no estuviera
//    emparejado, el propio `createRfcommSocketToServiceRecord` seguro dispara el diálogo del SO.
//
// ── CINCO BLOQUEANTES MÁS, cerrados el 2026-07-30 (review adversarial + banco en device) ────────
// Los cinco eran de la misma familia: **la máquina de estados en los bordes**, y en los tres casos
// donde el mecanismo faltaba por completo el guard se escribió sobre LA AUSENCIA.
//
// A. 🔴 "BASTÓN CONECTADO" MENTIROSO (banco §4.1, 3/3 reproducciones). Si el link se caía con la app
//    MINIMIZADA, el evento de desconexión se perdía y al volver la pantalla decía "conectado, la
//    lectura entra sola" — indefinidamente, con el socket muerto y cada bastonazo al vacío. Causa:
//    el ÚNICO detector era un evento del SO que se puede perder, y no había segunda fuente de
//    verdad. Verificado leyendo el nativo: el único evento que llega a nuestro listener lo emite
//    `onACLDisconnected` con `sendEvent(...)`, que **descarta el evento** si no hay Catalyst
//    instance activa (el otro emisor, `onDisconnect` del hilo de lectura, publica en
//    `DEVICE_DISCONNECTED@<address>`, al que este listener NI SIQUIERA está suscrito). As-built:
//    `verifyLiveness()` — sonda `isDeviceConnected(address)` (que del lado Java se limpia sola,
//    tanto por el ACL receiver como por el error del hilo de lectura) AL VOLVER A FOREGROUND y ante
//    silencio prolongado. La app ya no confía en un evento que puede perder.
// B. 🔴 LATCH SIN TIMEOUT. Ver `bridge-timeout.ts`: ningún await del puente vencía. Ahora TODOS
//    vencen, el latch se libera siempre, y `disconnect()` además invalida el intento en curso.
// C. 🔴 EVENTO DE DESCONEXIÓN GLOBAL. Se filtra por dirección (ver el handler).
// D. 🟠 El gate de foreground se chequeaba al PROGRAMAR y no al DISPARAR (violaba R6.9).
// E. 🟠 Un `connect()` a OTRO bastón con un intento en curso se descartaba EN SILENCIO.
//
// IMPORT PEREZOSO (RMV5.6, patrón feedback.ts): `react-native-bluetooth-classic` y `react-native`
// se `require` DENTRO de las funciones, envueltos en try/catch — NUNCA top-level. Importar este
// módulo NO tira en web/CI sin la lib nativa (cubierto en adapter-spp-android.test.ts). Los imports
// top-level son SOLO tipos + módulos PUROS.
//
// INYECCIÓN DE ENTORNO (`SppEnv`): la I/O (cargar el nativo, pedir permisos, leer/escribir el device
// recordado, foreground, timers, reloj, presupuestos de timeout) entra por constructor con defaults
// reales. No es adorno: es lo que permite testear la MÁQUINA DE ESTADOS entera —permiso denegado, BT
// apagado, device no emparejado, stream, desconexión de OTRO device, promesa que no resuelve,
// backoff, dwell, liveness, background— sin un RS420 y sin un teléfono.

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import type { ReaderDriver } from './driver-types';
import { RS420_DRIVER } from './driver-rs420';
import { backoffDelayMs } from './line-framer';
import {
  sppConnectOptions,
  sppUuidIsSupported,
  sppDelimiterIsSupported,
  splitSppPayload,
  normalizePairedDevices,
  SPP_DELIMITER,
  type PairedDevice,
} from './spp-protocol';
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
  type ConnectTrigger,
} from './connect-trigger';
import {
  ensureAndroidBluetoothPermissions,
  checkAndroidBluetoothPermissions,
  type BluetoothPermissionOutcome,
} from './permissions-android';
import { logTransportEvent } from './logging';

// ── Superficie de `react-native-bluetooth-classic` que usamos (modelada localmente: la lib no se
//    importa por tipo para no meterla en el grafo de módulos de web/CI) ────────────────────────
export interface SppSubscription {
  remove(): void;
}
export interface SppDeviceLike {
  address?: string;
  name?: string;
  onDataReceived(cb: (event: { data?: string }) => void): SppSubscription;
  disconnect(): Promise<boolean>;
}
export interface SppNative {
  isBluetoothEnabled(): Promise<boolean>;
  requestBluetoothEnabled?(): Promise<boolean>;
  getBondedDevices(): Promise<unknown>;
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<SppDeviceLike>;
  onDeviceDisconnected?(cb: (event: unknown) => void): SppSubscription;
  /**
   * SEGUNDA FUENTE DE VERDAD del liveness (BENCH-1). Del lado Java es
   * `mConnections.containsKey(address)`, y ese mapa lo limpian DOS caminos que corren en Java y no
   * dependen de que el evento llegue a JS: el `ActionACLReceiver` y el `onDisconnect` del hilo de
   * lectura. Opcional en esta interfaz por prudencia (una lib más vieja podría no tenerlo): sin
   * ella no hay sonda y se lo dice el log, en vez de fingir que el link está sano.
   */
  isDeviceConnected?(address: string): Promise<boolean>;
}

/** Qué timer es cada uno (los tests filtran por acá; un timer nuevo tiene que nombrarse). */
export type SppTimerLabel = 'reconnect' | 'watchdog';

/** Entorno de I/O del adapter. Los defaults son los reales; los tests inyectan dobles. */
export interface SppEnv {
  loadNative: () => SppNative | null;
  /** PIDE los permisos (muestra el diálogo del SO si hace falta). Solo desde un GESTO del operario. */
  ensurePermissions: () => Promise<BluetoothPermissionOutcome>;
  /**
   * CONSULTA los permisos sin pedirlos. La usan los caminos que el operario NO pidió en ese instante:
   * la reconexión al abrir la app (R6.4) y la cadena de reintentos. Es un campo OBLIGATORIO a propósito
   * —no un opcional con caída a `ensurePermissions`—: un `SppEnv` nuevo que se olvide de declararlo no
   * compila, en vez de empezar a mostrar diálogos de permisos desde un timer en silencio.
   */
  checkPermissions: () => Promise<BluetoothPermissionOutcome>;
  readRemembered: () => Promise<string | null>;
  writeRemembered: (deviceId: string) => Promise<void>;
  isForeground: () => boolean;
  /** Programa un timer etiquetado. Devuelve un cancelador. */
  schedule: (fn: () => void, ms: number, label: SppTimerLabel) => () => void;
  /** Suscribe al retorno a foreground. Devuelve unsubscribe. */
  onForeground: (cb: () => void) => Unsubscribe;
  /** Reloj inyectable (dwell del backoff + medición de la mudez). Default `Date.now`. */
  now?: () => number;
  /**
   * Presupuestos de los awaits del puente + períodos de los timers del link (`bridge-timeout.ts`).
   * Default `DEFAULT_BRIDGE_TIMINGS`. Un valor ≤ 0 significa "sin timeout" / "sin poll": es la puerta
   * explícita para los tests que no ejercitan el vencimiento, NO un valor válido de producción.
   */
  timeouts?: Partial<BridgeTimings>;
}

/**
 * Cuánto tiene que DURAR un link para que cuente como sano y resetee el backoff (🟡-3 del review,
 * confirmado en el banco §4.3: `flap 4 3000` daba `attempt:0` las cuatro veces).
 *
 * Antes el contador se reseteaba apenas resolvía `connectToDevice`, así que un link que se cae a los
 * 200 ms producía connect → drop → 500 ms → connect indefinido: el chip parpadeando y la radio
 * martillando sin que el backoff creciera nunca. Ahora el reset exige que la conexión haya vivido
 * este tiempo. 30 s: más que cualquier ciclo de flap patológico, mucho menos que una jornada normal
 * (un corte único a mitad de la mañana sigue reconectando desde el piso de 500 ms).
 */
export const LINK_DWELL_MS = 30_000;

/**
 * Resuelve los params del transporte SPP del driver (RMV5.2). PURO y exportado → testeable sin
 * device: confirma que el adapter toma sppUuid/pin/delimiter del DRIVER, no hardcodeados. `null` si
 * el driver no declara un transporte SPP. `delimiter` cae al del RS420 si el driver no lo declara
 * (ver `driver-rs420.ts`: es un supuesto del LECTOR, no del transporte).
 */
export function resolveSppParams(
  driver: ReaderDriver,
): { sppUuid: string; pin?: string; delimiter: string } | null {
  const spp = driver.transports.find((t) => t.kind === 'spp');
  if (!spp || spp.kind !== 'spp') return null;
  return {
    sppUuid: spp.params.sppUuid,
    pin: spp.params.pin,
    delimiter: spp.params.delimiter ?? SPP_DELIMITER,
  };
}

/** Require PEREZOSO de la lib nativa. `null` si no está instalada o si el módulo nativo no está
 *  registrado en ESTE build (dev build viejo / Expo Go / web). */
export function loadRNBC(): SppNative | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native') as typeof import('react-native');
    // Chequeo del MÓDULO NATIVO, no del paquete JS: `react-native-bluetooth-classic` resuelve
    // igual desde node_modules aunque el binario no esté en el APK (build anterior a la dep), y en
    // ese caso su default export es un wrapper con el nativo en `undefined` que tira recién al
    // primer método. Sin este chequeo montaríamos un transporte fantasma → CTA que promete y no
    // cumple, exactamente el bug que cerró el fix del chip (2026-07-29).
    if (NativeModules == null || NativeModules.RNBluetoothClassic == null) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-bluetooth-classic');
    return (mod?.default ?? mod) as SppNative;
  } catch {
    return null;
  }
}

/**
 * ¿Este build puede hablar SPP en este dispositivo? (Android + módulo nativo presente). Lo consulta
 * `instantiateTransport` ANTES de montar el adapter: si es false NO se monta transporte y la app
 * queda manual-first, con el chip y el CTA ocultos por el guard de `hasTransport`.
 */
export function isSppNativeAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return false;
    return loadRNBC() != null;
  } catch {
    return false;
  }
}

// ─── Helpers puros de este módulo ────────────────────────────────────────────────────────────

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'unknown';
}

/** Compara direcciones MAC de forma tolerante: el SO las devuelve en minúscula, nosotros en mayúscula. */
function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Extrae la dirección del device de un evento del nativo. El payload real de `DEVICE_DISCONNECTED`
 * es `{ device: { address, name, id, … }, … }` (`BluetoothDeviceEvent.buildMap()` en el Java);
 * se toleran las variantes por defensa, y `null` significa "no se pudo determinar".
 */
function eventDeviceAddress(event: unknown): string | null {
  if (event == null || typeof event !== 'object') return null;
  const e = event as { device?: { address?: unknown; id?: unknown }; address?: unknown };
  const candidates = [e.device?.address, e.device?.id, e.address];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return null;
}

/**
 * COALESCE de `requestBluetoothEnabled` a nivel MÓDULO, no de instancia (🔴-1, causa raíz #2).
 *
 * El nativo guarda la promesa del diálogo "¿activar Bluetooth?" en UN SOLO slot (`mEnabledPromise`)
 * y hay DOS entradas independientes que lo piden: `listPairedSppDevices()` (desde la pantalla) y
 * `doConnect` (desde el chip / el timer). Dos llamadas solapadas **pisan** ese slot y dejan la
 * primera huérfana PARA SIEMPRE. Coalescer del lado de JS es lo único que evita que el solapamiento
 * lo causemos nosotros. Se limpia solo en el `finally`, así que no hay estado que resetear entre
 * tests.
 */
let enableRequestInFlight: Promise<boolean> | null = null;

async function requestBluetoothEnabledOnce(native: SppNative, ms: number): Promise<boolean> {
  if (typeof native.requestBluetoothEnabled !== 'function') return false;
  if (enableRequestInFlight != null) return enableRequestInFlight;
  const run = withTimeoutOr(
    native.requestBluetoothEnabled(),
    ms,
    'request_bluetooth_enabled',
    false,
    (error) => logBridgeFailure('request_bluetooth_enabled', ms, error),
  );
  enableRequestInFlight = run;
  try {
    return await run;
  } finally {
    enableRequestInFlight = null;
  }
}

/**
 * Log uniforme de un await del puente que falló o venció, con dos kinds distintos a propósito: en
 * logcat hay que poder separar "el nativo contestó un error" de "el nativo NO contestó" — son dos
 * problemas distintos y el segundo es el que nos costó 2 min 40 s de bastón muerto.
 *
 * Si el error ES un vencimiento, gana SU propio `label`/`ms` sobre los del caller: el que sabe qué
 * await se perdió es el `withTimeout` que lo envolvió, no el `catch` que lo recibe (que puede estar
 * varias líneas más abajo y cubrir más de una llamada).
 */
function logBridgeFailure(label: string, ms: number, error: unknown): void {
  if (isBridgeTimeout(error)) logTransportEvent({ kind: 'bridge_timeout', label: error.label, ms: error.ms });
  else logTransportEvent({ kind: 'connect_error', message: `${label}: ${errorMessage(error)}` });
}

function timeoutOf(env: Pick<SppEnv, 'timeouts'>, key: keyof BridgeTimings): number {
  return env.timeouts?.[key] ?? DEFAULT_BRIDGE_TIMINGS[key];
}

export type PairedListResult =
  | { ok: true; devices: PairedDevice[] }
  | { ok: false; reason: 'unavailable' | 'permission_denied' | 'bluetooth_off' | 'error' };

/**
 * GUARD DE RE-ENTRADA de la lista de emparejados (🟠-4). Una segunda llamada mientras la primera
 * está en vuelo devuelve LA MISMA promesa en vez de arrancar otra: (a) la pantalla no puede quedar
 * clavada en "Buscando…" por dos cargas pisándose, y (b) —lo importante— dos `listPairedSppDevices`
 * solapados eran uno de los dos caminos que dejaban huérfana la promesa del diálogo de Bluetooth.
 */
let pairedListInFlight: Promise<PairedListResult> | null = null;

/**
 * Lista los devices Bluetooth Classic YA EMPAREJADOS en el sistema (RMV3.2). Pide antes el permiso
 * de runtime (Android 12+ lo exige para `getBondedDevices`). Nunca tira y SIEMPRE se asienta:
 * cualquier problema —incluido un await del puente que no resuelve— devuelve `{ ok:false }` y la
 * pantalla degrada a la salida manual (R7).
 */
export function listPairedSppDevices(
  env: Pick<SppEnv, 'loadNative' | 'ensurePermissions' | 'timeouts'> = defaultSppEnv(),
): Promise<PairedListResult> {
  if (pairedListInFlight != null) return pairedListInFlight;
  const run = runListPairedSppDevices(env);
  pairedListInFlight = run;
  return run.finally(() => {
    pairedListInFlight = null;
  });
}

async function runListPairedSppDevices(
  env: Pick<SppEnv, 'loadNative' | 'ensurePermissions' | 'timeouts'>,
): Promise<PairedListResult> {
  try {
    const native = env.loadNative();
    if (native == null) return { ok: false, reason: 'unavailable' };
    const permission = await withTimeoutOr(
      env.ensurePermissions(),
      timeoutOf(env, 'prompt'),
      'ensure_permissions',
      'unavailable' as BluetoothPermissionOutcome,
      (error) => logBridgeFailure('ensure_permissions', timeoutOf(env, 'prompt'), error),
    );
    if (permission === 'denied') return { ok: false, reason: 'permission_denied' };
    if (permission === 'unavailable') return { ok: false, reason: 'unavailable' };
    const enabled = await withTimeout(
      native.isBluetoothEnabled(),
      timeoutOf(env, 'call'),
      'is_bluetooth_enabled',
    );
    if (!enabled) {
      if (typeof native.requestBluetoothEnabled !== 'function') return { ok: false, reason: 'bluetooth_off' };
      const accepted = await requestBluetoothEnabledOnce(native, timeoutOf(env, 'prompt'));
      if (!accepted) return { ok: false, reason: 'bluetooth_off' };
    }
    const bonded = await withTimeout(
      native.getBondedDevices(),
      timeoutOf(env, 'call'),
      'get_bonded_devices',
    );
    return { ok: true, devices: normalizePairedDevices(bonded) };
  } catch (e) {
    logBridgeFailure('list_paired', timeoutOf(env, 'call'), e);
    return { ok: false, reason: 'error' };
  }
}

/**
 * SOLO PARA TESTS: libera el estado COALESCE de módulo (lista de emparejados + diálogo de activar
 * Bluetooth). En producción los dos se limpian solos en su `finally`; un test que deja una promesa
 * colgada a propósito necesita poder cortar el arrastre a los tests siguientes.
 */
export function __resetSppModuleStateForTests(): void {
  pairedListInFlight = null;
  enableRequestInFlight = null;
}

/** Entorno real (defaults del constructor). Cada pieza de I/O va con require perezoso + try/catch. */
export function defaultSppEnv(): SppEnv {
  return {
    loadNative: loadRNBC,
    // El transporte va EXPLÍCITO (RBM2.13): la tabla de permisos es por transporte desde que existe
    // `ble-gatt`, y el parámetro no tiene default a propósito — un call site que se lo olvide no
    // compila, en vez de pedir en silencio el conjunto de otro transporte.
    ensurePermissions: () => ensureAndroidBluetoothPermissions('spp'),
    checkPermissions: () => checkAndroidBluetoothPermissions('spp'),
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

export class SppAndroidAdapter implements StickAdapter {
  readonly kind = 'spp-android' as const;

  /**
   * El lector con el que este adapter habla (RMV5.2). PÚBLICO de solo lectura desde el delta
   * ios-ble-mfi (RBM1.3): el contrato de ingesta necesita SU `frameParser` para desframear las
   * líneas que este transporte entrega (RBM1.1), y lo lee por la interfaz `StickAdapter` —
   * `resolveFrameParser(transport, …)` en el provider. Era `private`; pasar a `readonly` público
   * no cambia ningún método ni ningún comportamiento (RBM1.5).
   */
  readonly driver: ReaderDriver;
  private readonly env: SppEnv;
  private tagListeners = new Set<(rawLine: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;
  private device: SppDeviceLike | null = null;
  private dataSub: SppSubscription | null = null;
  private disconnectSub: SppSubscription | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private cancelScheduled: (() => void) | null = null;
  private cancelWatchdog: (() => void) | null = null;
  private unsubForeground: Unsubscribe | null = null;
  private unsubLiveness: Unsubscribe | null = null;
  private currentDeviceId: string | null = null;
  /**
   * Generación del INTENTO de conexión. La toma cada `runConnect`; un `disconnect()` o un connect
   * nuevo la incrementan, y el intento viejo —que puede estar suspendido en un await del puente—
   * se da cuenta al despertar de que ya no es el vigente, cierra lo que hubiera abierto y se va sin
   * tocar el estado. Es lo que permite que `disconnect()` LIBERE EL LATCH sin abrir la ventana de
   * dos intentos pisándose (🔴-1 (b) del review).
   */
  private connectGeneration = 0;
  /** Generación que tiene el latch tomado (null = libre). Reemplaza al booleano `connectInFlight`. */
  private inFlightGen: number | null = null;
  /** Target del intento en curso (null = "el recordado"). Para decidir si un connect nuevo es OTRO. */
  private inFlightTarget: string | null = null;
  /** Bastón pedido MIENTRAS había un intento en curso: se atiende al terminar (🟠-2). */
  private pendingTarget: string | null = null;
  /** Cuándo se estableció el link vigente (dwell del backoff, 🟡-3). null = no hay link. */
  private connectedAt: number | null = null;
  /** Cuándo llegó el último byte (watchdog de conectado-y-mudo, 🟠-5). */
  private lastDataAt = 0;
  /**
   * Hasta cuándo puede reintentar la cadena vigente. `null` = SIN tope (la arrancó un gesto del
   * operario). Lo pone el trigger según su política (`connect-trigger.ts`), no el estado.
   */
  private retryBudgetUntil: number | null = null;
  /** Cuándo arrancó la cadena vigente (para poder decir en el log cuánto duró). */
  private chainStartedAt = 0;
  /**
   * ¿La cadena que NADIE pidió (R6.4) se agotó sin encontrar el bastón recordado? Lo lee la pantalla de
   * conexión para dar el copy honesto ("no encontramos el bastón guardado") en vez del genérico "Bastón
   * sin conectar". PÚBLICO y de solo lectura desde afuera: se setea ANTES del `emitStatus` que provoca
   * el re-render, así que la UI siempre lo ve fresco.
   */
  autoConnectExhausted = false;
  /**
   * Generación de la conexión. Cada `connect()` exitoso abre una sesión nueva; los callbacks del
   * nativo capturan la suya y descartan lo que llegue de una vieja. `subscription.remove()` es
   * best-effort del otro lado del puente: una lectura ya en vuelo (o un `remove()` que el nativo
   * ignore) no puede colarse DESPUÉS de un disconnect y aparecer como caravana leída.
   */
  private session = 0;

  /** Parametrizado por el driver (default RS420, RMV5.2). Otro lector SPP → otro driver, mismo adapter. */
  constructor(driver: ReaderDriver = RS420_DRIVER, env: SppEnv = defaultSppEnv()) {
    this.driver = driver;
    this.env = env;
  }

  private now(): number {
    return (this.env.now ?? Date.now)();
  }

  private ms(key: keyof BridgeTimings): number {
    return timeoutOf(this.env, key);
  }

  /**
   * Abre el RFCOMM SPP del lector (RMV5.1). Orden del camino feliz:
   *   1. params del driver (RMV5.2) + chequeo de que su UUID y su terminador son alcanzables;
   *   2. módulo nativo presente (si no, manual-first: `disconnected`, sin reintentos);
   *   3. permiso BLUETOOTH_CONNECT (Android 12+) → denegado ⇒ `permission_denied` con CTA;
   *   4. device: el pasado o el recordado (RMV5.4);
   *   5. Bluetooth prendido (si no, se pide prenderlo — SOLO si lo pidió el operario, ver `auto`);
   *   6. `connectToDevice` con el framing delimitado del driver (RMV5.3);
   *   7. suscripción a datos + a la desconexión del SO + watchdog + sonda de liveness.
   * Nunca bloquea la carga manual (R7): cualquier falla es un estado, no una excepción.
   */
  async connect(deviceId?: string): Promise<void> {
    await this.runConnect(deviceId, 'operator');
  }

  /**
   * RECONEXIÓN AUTOMÁTICA AL ABRIR LA APP (R6.4). La llama el provider UNA vez al montar el transporte.
   *
   * ── EL DEFECTO QUE CIERRA ────────────────────────────────────────────────────────────────────────
   * Hasta hoy los ÚNICOS llamadores de `connect()` eran gestos (el chip del header, el sheet de scan,
   * la pantalla de conexión), así que `readRememberedDevice()` solo se alcanzaba si el operario tocaba
   * algo: **cada arranque exigía ir a Más → Bastón → tocar**, y `remembered-device.ts` estaba medio
   * muerto (era media su razón de ser). R6.4 dice, textual, "sin requerir que el operario vuelva a la
   * pantalla de conexión". Decisión de Raf, 2026-07-30: *"que se reconecte sola al abrir, sí"*.
   *
   * ── LA REGLA QUE LO GOBIERNA: EL ARRANQUE NO PIDE NADA ───────────────────────────────────────────
   * Esto corre en el primer frame, sin que nadie haya pedido nada. Así que NO puede: mostrar el diálogo
   * de "activar Bluetooth", pedir el permiso de runtime, ni tocar la radio de un teléfono cuyo dueño
   * nunca eligió un bastón. Los cuatro gates de abajo van en ese orden a propósito — del más barato y
   * menos invasivo al que toca el hardware:
   *
   *   1. ¿HAY DEVICE RECORDADO? Es una lectura LOCAL (SecureStore) y va PRIMERO: un arranque en frío
   *      (nadie eligió un bastón nunca) no consulta permisos ni toca el Bluetooth. Nada.
   *   2. ¿EL PERMISO YA ESTÁ CONCEDIDO? Se CONSULTA (`checkPermissions`), no se pide. Un prompt de
   *      permisos en el primer frame es hostil y encima el operario no tiene contexto de por qué.
   *   3. ¿EL BLUETOOTH YA ESTÁ PRENDIDO? Se lee (`isBluetoothEnabled`, sin diálogo). Si está apagado,
   *      NO arranca: el diálogo de activar lo pide un gesto, nunca el arranque.
   *   4. ¿FOREGROUND? R6.9. (El provider monta en foreground, pero el gate es explícito.)
   *
   * Cuando un gate no pasa **no se emite ningún estado**: se queda en `'off'`, que es el estado honesto
   * de "nunca se intentó" ("Bastón sin conectar" + CTA "Conectar bastón", y el indicador global se
   * auto-oculta en 'off'). Emitir `'disconnected'` sería mentir ("se apagó, quedó fuera de rango o
   * cancelaste") sobre algo que no pasó, y encima le pondría un pill en el chrome a alguien que no
   * pidió nada. El motivo del skip queda en el log (`autoconnect_skipped`), que es lo que hace
   * diagnosticable un "no se conectó solo" — los cinco motivos se ven idénticos desde la UI: nada.
   *
   * Si los cuatro gates pasan, es un `connect()` normal marcado `auto`: mismo backoff, mismo gate de
   * foreground, y si falla cae exactamente en el mismo estado que un connect por gesto fallido. Nunca
   * bloquea la carga manual (R7).
   */
  async autoConnect(): Promise<void> {
    const skip = (reason: 'no_remembered' | 'permission' | 'bluetooth_off' | 'background' | 'unavailable' | 'busy') => {
      logTransportEvent({ kind: 'autoconnect_skipped', reason });
    };

    // Ya hay link o ya hay un intento en curso: no nos metemos.
    //
    // OJO — acá NO se mira `this.closed`, y es deliberado (lo encontró la autorrevisión). `closed` lo
    // pone `disconnect()`, y `disconnect()` tiene DOS call sites que significan cosas opuestas: el
    // gesto del operario ("no quiero el bastón") y el **cleanup del efecto del provider** ("estoy
    // desarmando el cableado"). Gatear por `closed` parecía prudente ("no reconectar a sus espaldas")
    // pero el único camino por el que `autoConnect()` puede volver a llamarse es justamente el
    // segundo —el efecto re-corriendo (StrictMode, cambio de `mode`, re-montaje)— y ahí el gate
    // **mataba R6.4 en silencio**: cleanup → `closed = true` → el arranque siguiente se abstenía y
    // nada se ponía rojo. En producción hoy el efecto corre una sola vez (`mode` sale de globals
    // constantes y `handleReading` es un `useCallback([])`), así que el gate no compraba nada y podía
    // costar la feature entera.
    //
    // La protección real es el CONTRATO: `autoConnect()` se llama UNA vez al montar el transporte y NO
    // es un reconectador genérico (ver `StickAdapter.autoConnect`). Si algún día se lo llama también
    // al volver a foreground, esa decisión tiene que resolver ahí qué hacer con un operario que
    // desconectó a propósito — y va a necesitar distinguir los dos `disconnect()`, que hoy no se
    // distinguen.
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
    // Re-chequeo tras el await: si mientras leíamos el storage alguien conectó (un gesto del operario
    // que llegó primero) o arrancó otro intento, nos vamos. Por el mismo motivo que el gate de arriba,
    // NO se mira `this.closed`.
    if (this.device != null || this.inFlightGen != null) return;

    const native = this.env.loadNative();
    if (native == null) {
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

    // Fallback `false` a propósito, al revés que en `doConnect`: acá la duda NO habilita a tocar la
    // radio (nadie pidió nada); allá el operario pidió conectar y el error real lo da el connect.
    const btEnabled = await withTimeoutOr(
      native.isBluetoothEnabled(),
      this.ms('call'),
      'is_bluetooth_enabled',
      false,
      (error) => logBridgeFailure('is_bluetooth_enabled', this.ms('call'), error),
    );
    if (!btEnabled) {
      skip('bluetooth_off'); // el diálogo de activar lo pide un gesto, nunca el arranque
      return;
    }

    if (this.device != null || this.inFlightGen != null) return;
    await this.runConnect(remembered, 'autoconnect');
  }

  /**
   * Punto único de entrada al camino de conexión. El `trigger` dice QUIÉN lo disparó, y de ahí salen
   * las dos políticas que separan un intento del operario de uno que la app hizo sola
   * (`connect-trigger.ts`): si puede mostrar diálogos del SO, y si la cadena de reintentos que arranca
   * tiene tope. NO es un booleano a propósito: un camino nuevo tiene que **declarar** su trigger, y un
   * trigger nuevo no compila hasta declarar sus dos políticas.
   */
  private async runConnect(deviceId: string | undefined, trigger: ConnectTrigger): Promise<void> {
    if (this.inFlightGen != null) {
      // 🟠-B del review: un `connect()` del OPERARIO que llega con un intento en vuelo no puede ser un
      // no-op mudo. Aunque no haya otro bastón que encolar (mismo target, o sin target — que es el
      // camino del chip del header, `BleConnectionChip` → `connect()` sin argumentos), el tap significa
      // "quiero que insista": tiene que RE-APLICAR la política de su cadena, o sea **destoparla**. Sin
      // esto, tocar el chip durante el intento del arranque no cambiaba nada y la app se rendía igual a
      // los 120 s, habiendo el operario pedido lo contrario. Y siempre queda log: la justificación vieja
      // ("un connect sin target no encola nada porque el intento en curso ya es eso") era cierta antes
      // del tope y quedó falsa con él.
      const queued = this.queueTarget(deviceId);
      if (policyFor(trigger).chain !== 'inherit') this.applyChainPolicy(trigger);
      if (!queued) logTransportEvent({ kind: 'connect_reasserted', trigger });
      return; // evita el ALREADY_CONNECTING del nativo (reintento + tap)
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
      // 🟠-2: el bastón que el operario tocó MIENTRAS conectábamos se atiende ahora. Si alguien más
      // tomó el latch (o hubo un disconnect), no lo pisamos.
      if (next == null || this.closed || this.inFlightGen != null) return;
      target = next;
      // El target encolado vino de un TAP (`queueTarget` solo encola targets explícitos), así que su
      // cadena es del operario: sin tope, y puede pedir lo que haga falta.
      attemptTrigger = 'operator';
      this.applyChainPolicy('operator');
    }
  }

  /**
   * Aplica al estado de la cadena la política del trigger (`connect-trigger.ts`). Es el único lugar que
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
   * Un `connect()` a OTRO bastón con un intento en curso (🟠-2). Antes esto era un `return` mudo:
   * el operario tocaba el bastón A (cuyo `connectToDevice` bloquea varios segundos si está
   * apagado), se daba cuenta de que era el otro, tocaba el B y **no pasaba absolutamente nada** —
   * ni estado, ni log— y al final quedaba conectado a A.
   *
   * Un `connect()` SIN target ("conectá a lo que estabas") no encola nada: el intento en curso ya es
   * eso. Ojo — "no encola" ya NO significa "no hace nada": el caller re-aplica la política de la cadena
   * y deja log (ver `runConnect`). Devuelve si encoló, para que el caller sepa qué loguear.
   */
  private queueTarget(deviceId: string | undefined): boolean {
    if (deviceId == null) return false;
    if (sameAddress(deviceId, this.inFlightTarget)) return false;
    this.pendingTarget = deviceId;
    logTransportEvent({ kind: 'connect_superseded', deviceId });
    return true;
  }

  private async doConnect(deviceId: string | undefined, trigger: ConnectTrigger, gen: number): Promise<void> {
    // Los diálogos del SO (permiso, "¿activar Bluetooth?") SOLO salen de un gesto del operario.
    const { allowsSystemDialogs } = policyFor(trigger);
    // Un intento en curso deja SIN EFECTO cualquier reintento pendiente: si no se cancela, (a) un
    // timer viejo dispararía otro connect sobre una conexión ya viva, y (b) —peor— el guard de
    // `scheduleReconnect` vería `cancelScheduled != null` y NO volvería a programar nada, así que
    // el corte siguiente se quedaba sin reconexión para siempre.
    this.cancelReconnect();
    // Y cierra lo que hubiera abierto. Sin esto, elegir OTRO bastón de la lista estando conectado
    // dejaba la suscripción anterior viva: el nativo devuelve la conexión existente si la dirección
    // ya está conectada, así que quedaban DOS `onDataReceived` sobre el mismo socket (cada lectura
    // entregada dos veces — la ventana de dedup lo tapaba, que es peor: un leak invisible).
    await this.teardownStreams();
    if (gen !== this.connectGeneration) return;

    const params = resolveSppParams(this.driver);
    if (!params) {
      this.emitStatus('disconnected');
      return;
    }
    if (!sppUuidIsSupported(params.sppUuid)) {
      // El UUID RFCOMM lo fija la lib nativa; un driver con otro UUID NO es alcanzable por este
      // adapter. Cortamos en vez de abrir el SPP estándar y fingir que es el del driver.
      logTransportEvent({ kind: 'connect_error', message: 'spp_uuid_unsupported' });
      this.emitStatus('disconnected');
      return;
    }
    if (!sppDelimiterIsSupported(params.delimiter)) {
      // Mismo criterio que el UUID (🟠-5): un terminador que este adapter no puede framear se corta
      // acá y se dice, en vez de conectar y quedarse MUDO sin un error (que es indistinguible de
      // "el operario no está bastoneando" — banco §4.4).
      logTransportEvent({ kind: 'connect_error', message: 'spp_delimiter_unsupported' });
      this.emitStatus('disconnected');
      return;
    }

    const native = this.env.loadNative();
    if (native == null) {
      // Sin módulo nativo (web/CI/dev build viejo): no se puede conectar y NO se reintenta (el
      // resultado sería idéntico para siempre). Manual-first (R7).
      this.emitStatus('disconnected');
      return;
    }

    // Permisos: el gesto del operario PIDE (y espera a que conteste el diálogo); un camino automático
    // —el arranque de R6.4 o un reintento del backoff— solo CONSULTA. `requestMultiple` sobre un
    // permiso denegado UNA vez (sin "no volver a preguntar") vuelve a mostrar el diálogo, así que sin
    // esta distinción un timer podía tirárselo en la cara al operario, sin contexto y sin que hubiera
    // tocado nada. Y un check no espera a una persona: su presupuesto es el de una llamada, no el del
    // diálogo.
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
      // Estado con CTA de reintento; la carga manual sigue operativa (R12.5/R7.2). Sin backoff: el
      // reintento lo dispara el operario después de conceder el permiso.
      this.emitStatus('permission_denied');
      return;
    }
    if (permission === 'unavailable') {
      this.emitStatus('disconnected');
      return;
    }

    const remembered =
      deviceId ??
      (await withTimeoutOr(this.env.readRemembered(), this.ms('call'), 'read_remembered', null, (error) =>
        logBridgeFailure('read_remembered', this.ms('call'), error),
      ));
    if (gen !== this.connectGeneration) return;
    const target = remembered;
    if (!target) {
      this.emitStatus('disconnected');
      return;
    }
    // El objetivo se recuerda ACÁ, no recién al conectar: si se anotara solo en el éxito, el
    // reintento del backoff llamaría `connect(undefined)` y caería en el device RECORDADO — que en
    // el primer emparejamiento todavía no existe (null) → la cadena de reintentos moría en silencio
    // después del primer fallo, justo en el caso "el bastón está apagado, prendelo".
    this.currentDeviceId = target;
    this.inFlightTarget = target;

    this.emitStatus('connecting');
    try {
      // Si NO podemos saber si el Bluetooth está prendido (puente colgado), NO tiramos el diálogo:
      // se sigue y el `connectToDevice` da el error real. Un diálogo de más es peor que un error.
      const btEnabled = await withTimeoutOr(
        native.isBluetoothEnabled(),
        this.ms('call'),
        'is_bluetooth_enabled',
        true,
        (error) => logBridgeFailure('is_bluetooth_enabled', this.ms('call'), error),
      );
      if (gen !== this.connectGeneration) return;
      if (!btEnabled) {
        if (!allowsSystemDialogs) {
          // Intento que el operario no pidió, con el Bluetooth apagado: NO se pide prenderlo (sería
          // tirarle el diálogo del sistema en la cara sin que haya tocado nada). Se sigue reintentando
          // en silencio: el backoff topea en 8 s, así que cuando el operario lo prenda —del panel
          // rápido, como hizo en el banco— la app reconecta sola dentro de esa ventana (y si la cadena
          // es la del arranque, dentro de su tope).
          logTransportEvent({ kind: 'connect_error', message: 'bluetooth_off_auto' });
          this.emitStatus('disconnected');
          this.scheduleReconnect();
          return;
        }
        const enabled = await requestBluetoothEnabledOnce(native, this.ms('prompt'));
        if (gen !== this.connectGeneration) return;
        if (!enabled) {
          // El operario dijo que no (o el diálogo venció / el equipo no permite pedirlo): estado
          // claro, sin loop de reintentos que le vuelva a tirar el diálogo del sistema en la cara.
          logTransportEvent({ kind: 'connect_error', message: 'bluetooth_off' });
          this.emitStatus('disconnected');
          return;
        }
      }

      // SPP baud-independiente (RMV5.7): sin baudRate. El framing delimitado lo hace el nativo con
      // el terminador DEL DRIVER (ver spp-protocol) — NO se pasa un `uuid` porque la lib lo ignora
      // (lo documenta `RNBC_FIXED_SPP_UUID`); el chequeo de arriba ya garantizó que coincide.
      const pending = native.connectToDevice(
        target,
        sppConnectOptions(params.delimiter) as unknown as Record<string, unknown>,
      );
      const device = await withTimeout(pending, this.ms('connect'), 'connect_to_device', () => {
        // El nativo puede resolver DESPUÉS del vencimiento con el socket ya abierto. Si no se
        // cierra, queda en su `mConnections` sin que nadie lo lea — y la sonda de liveness diría
        // "vivo" sobre un socket fantasma. PERO cerrarlo a ciegas es peor: ver `canCloseOrphanSocket`.
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
        // El operario tocó "Desconectar" (o eligió otro bastón) MIENTRAS se abría el socket: el
        // `disconnect()` no tenía nada que cerrar todavía y este `await` habría dejado la conexión
        // abierta a sus espaldas. Salvo que la dirección ya sea de un intento MÁS NUEVO: ver
        // `canCloseOrphanSocket` (cerrar por dirección le mataría el socket al que conectó después).
        if (this.canCloseOrphanSocket(gen)) {
          try {
            await withTimeout(device.disconnect(), this.ms('call'), 'abort_disconnect');
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
      const session = ++this.session;
      this.device = device;
      this.connectedAt = this.now();
      this.lastDataAt = this.now();
      // ── EL PRESUPUESTO MUERE ACÁ (🔴-A del review / HIGH-1 del Gate 2) ──────────────────────────
      // INVARIANTE: el tope de la cadena `autoconnect` existe por UN motivo —"ese bastón lo vendí, lo
      // rompí o quedó en otro campo"— y en el instante en que el bastón **contesta** ese motivo dejó de
      // aplicar. Una cadena que llegó a `'connected'` TERMINÓ: lo que venga después es "el bastón
      // recordado vuelve a estar en rango", que es la segunda cláusula de R6.4 y NO tiene tope.
      //
      // Sin esta línea, `retryBudgetUntil` no acotaba "la cadena que nadie pidió" sino **los primeros
      // 120 s de vida de la app**: el operario abría la app, R6.4 conectaba sola, trabajaba 10 minutos,
      // el bastón se iba de rango un segundo → CERO reintentos por el resto de la sesión, estado `'off'`
      // (el único que el `StickStatusIndicator` se auto-oculta) y la pantalla de conexión inventando un
      // diagnóstico ("no encontramos el bastón") sobre un bastón que estaba conectado tres segundos
      // antes. Reproducido por el reviewer y por el Gate 2, cada uno con su propio probe.
      //
      // Y arregla de paso el log: con el presupuesto muerto al conectar, un `autoconnect_exhausted` solo
      // puede venir de una cadena que NUNCA conectó, así que su `ms` mide tiempo realmente reintentando
      // y su `attempts` es > 0. Antes salía `{"ms":600000,"attempts":0}`, que es una confesión.
      this.retryBudgetUntil = null;
      // Persiste el device elegido (RMV5.4). Best-effort y acotado: si el storage se cuelga, no
      // puede dejar la conexión a medio armar (sin suscripción a datos y sin estado 'connected').
      await withTimeoutOr<void>(
        this.env.writeRemembered(target),
        this.ms('call'),
        'write_remembered',
        undefined,
        (error) => logBridgeFailure('write_remembered', this.ms('call'), error),
      );
      if (this.closed || gen !== this.connectGeneration || this.session !== session) {
        // Un disconnect (o un connect a otro bastón) entró mientras persistíamos: `teardownStreams`
        // ya cerró este socket y bumpeó la sesión. Suscribirnos ahora dejaría un listener vivo sobre
        // una conexión muerta y emitiría un 'connected' mentiroso.
        return;
      }

      this.dataSub = device.onDataReceived((event) => {
        if (this.session !== session) return; // lectura de una conexión ya cerrada → se descarta
        this.lastDataAt = this.now();
        for (const line of splitSppPayload(event?.data, params.delimiter)) {
          if (this.listening) this.emitTag(line); // línea CRUDA → contrato (RMV5.3)
        }
      });

      // Desconexión reportada por el SO (bastón apagado / fuera de rango): estado + reconexión.
      const ourAddresses = [target, device.address].filter(
        (a): a is string => typeof a === 'string' && a.length > 0,
      );
      if (typeof native.onDeviceDisconnected === 'function') {
        this.disconnectSub = native.onDeviceDisconnected((event) => {
          if (this.closed || this.session !== session) return;
          // 🔴-2: ESTE EVENTO ES GLOBAL. `onDeviceDisconnected` se suscribe a `DEVICE_DISCONNECTED`
          // PELADO (comparar con `onDeviceRead`, que sí es `DEVICE_READ@<address>`) y lo alimenta
          // `ActionACLReceiver`, un BroadcastReceiver de `ACTION_ACL_DISCONNECTED` de TODOS los
          // devices Classic del teléfono. Sin este filtro, unos auriculares que se apagan —o
          // bajarse de la camioneta con el manos libres pareado— CERRABA el socket del bastón y
          // disparaba el backoff sobre una conexión sana. Un evento SIN dirección legible se acepta
          // (es la señal que teníamos): preferimos un teardown de más que un "conectado" mentiroso,
          // y la sonda de liveness cubre el falso positivo reconectando enseguida.
          const address = eventDeviceAddress(event);
          if (address != null && !ourAddresses.some((a) => sameAddress(address, a))) return;
          void this.teardownStreams();
          this.emitStatus('disconnected');
          this.scheduleReconnect();
        });
      }

      // BENCH-1: segunda fuente de verdad, porque el evento de arriba se puede PERDER (medido 3/3
      // con la app minimizada). Dos disparadores independientes: el retorno a foreground (instantáneo
      // para el caso del bolsillo) y un poll periódico (que no depende de ningún evento).
      //
      // Se sondea con `target` —el string EXACTO con el que se abrió— porque esa es la CLAVE del
      // `mConnections` del nativo (`mConnections.put(address, …)` usa el argumento tal cual).
      if (typeof native.isDeviceConnected !== 'function') {
        // Sin sonda no hay segunda fuente de verdad: volvemos a depender de un evento que se puede
        // perder. Se dice UNA vez por conexión (no en cada poll) en vez de fingir que está cubierto.
        logTransportEvent({ kind: 'connect_error', message: 'liveness_probe_unavailable' });
      }
      this.armLivenessProbe(target);
      this.armWatchdog(session, target);

      this.emitStatus('connected');
    } catch (e) {
      if (gen !== this.connectGeneration) return;
      // Falla de conexión → no bloquea el manual (R7); reintenta con backoff (foreground, RMV5.5).
      // El label es del TRAMO (este catch cubre desde el chequeo del Bluetooth hasta las
      // suscripciones); si el error fue un vencimiento, `logBridgeFailure` usa el label del await
      // que se perdió, que es más preciso que cualquier cosa que pueda decir acá.
      logBridgeFailure('connect_path', this.ms('connect'), e);
      this.emitStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    // Invalida el intento en curso y LIBERA EL LATCH (🔴-1 (b)): el intento viejo, cuando despierte
    // de su await, va a ver que ya no es la generación vigente, cerrará lo que abrió y se irá sin
    // tocar el estado. Sin la generación, liberar el latch acá abriría la ventana de dos intentos
    // pisándose; con ella, liberar es seguro.
    this.connectGeneration += 1;
    this.inFlightGen = null;
    this.inFlightTarget = null;
    this.pendingTarget = null;
    // El dwell lo consume `scheduleReconnect`; un disconnect explícito no reconecta, así que el
    // dato tiene que morir acá o el próximo corte lo leería viejo.
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

  // ─── Liveness: la app no confía en un evento que puede perder (🔴 BENCH-1) ───────────────────

  /**
   * Arma la reconciliación AL VOLVER A FOREGROUND. `scheduleReconnect` ya manejaba bien el caso
   * "estoy en background y quiero reintentar", pero a eso **solo se llegaba si la desconexión se
   * había DETECTADO**. Cuando el evento se pierde, no hay reintento pendiente, `unsubForeground` no
   * existe, y el retorno a primer plano no chequeaba nada: la app seguía diciendo "Bastón
   * conectado" para siempre. Esta suscripción es independiente de la del backoff y vive mientras
   * hay link.
   */
  private armLivenessProbe(address: string | undefined): void {
    if (this.unsubLiveness != null || address == null) return;
    this.unsubLiveness = this.env.onForeground(() => {
      void this.verifyLiveness('foreground', address);
    });
  }

  /**
   * Watchdog del link: SONDA PERIÓDICA de liveness + registro de la mudez.
   *
   * (a) LIVENESS (🔴 BENCH-1). Sondea cada `livenessPoll` **sin depender de ningún evento ni de
   *     AppState**. Es la parte que de verdad cierra el "Bastón conectado" mentiroso: la sonda del
   *     retorno a foreground puede llegar unos ms ANTES de que el lado Java se entere (el hilo de
   *     lectura todavía no tiró y el broadcast del ACL todavía no corrió), y en ese caso la
   *     respuesta sería un `true` viejo. El poll acota ese error a `livenessPoll`, y de paso cubre
   *     el corte que ocurre con la app en primer plano y el evento perdido. Un `containsKey` cada
   *     15 s es gratis al lado de mantener un RFCOMM abierto.
   *     Nota R6.9: sondear NO es conectar, escanear ni reconectar; y si la sonda encuentra el socket
   *     muerto, la reconexión que dispara sigue siendo foreground-only (`scheduleReconnect`).
   *
   * (b) MUDEZ (🟠-5). Un lector con el terminador equivocado, un lector dormido y un socket muerto
   *     producen EXACTAMENTE el mismo síntoma desde afuera (banco §4.4): "connected", cero lecturas,
   *     cero errores, cero logs. El silencio NO desconecta —es lo normal cuando el operario no está
   *     bastoneando— pero queda ESCRITO, que es lo que permite distinguir los tres casos en logcat.
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
   * ¿El socket que creemos abierto sigue vivo del lado nativo? Es la SEGUNDA FUENTE DE VERDAD que
   * le faltaba al adapter. Del lado Java, `isDeviceConnected` es `mConnections.containsKey(address)`
   * y ese mapa lo limpian el `ActionACLReceiver` y el `onDisconnect` del hilo de lectura — dos
   * caminos que corren en Java aunque el evento nunca llegue a JS.
   *
   * Fail-closed: si la sonda no está disponible o rechaza (el nativo rechaza con
   * `BLUETOOTH_NOT_ENABLED` cuando el adaptador está apagado — o sea, seguro NO estamos conectados),
   * NO seguimos afirmando "conectado". El peor caso es un teardown + reconexión de más; el caso que
   * evita es 40 bastonazos perdidos sin un solo indicio.
   */
  private async verifyLiveness(reason: 'foreground' | 'poll', address: string | undefined): Promise<void> {
    if (this.closed || this.device == null || address == null) return;
    if (this.inFlightGen != null) return; // ya hay un intento en curso: que decida él
    const session = this.session;
    const native = this.env.loadNative();
    if (native == null || typeof native.isDeviceConnected !== 'function') return;
    let alive = false;
    let why = 'socket_closed';
    try {
      alive = await withTimeout(
        native.isDeviceConnected(address),
        this.ms('call'),
        'is_device_connected',
      );
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

  // ─── Reconexión foreground-only con backoff (RMV5.5) ─────────────────────────────────────

  /**
   * Programa un reintento. Foreground-only (RMV5.5: sin SPP en background en el MVP), pero si la
   * app NO está en foreground se queda ESPERANDO el retorno a 'active' en vez de abandonar — el
   * código anterior hacía `return` y no re-armaba nada, así que una app que se minimizaba en el
   * momento del reintento no volvía a conectar nunca (justo el caso de "guardé el teléfono en el
   * bolsillo mientras apartaba").
   */
  private scheduleReconnect(): void {
    if (this.closed || this.cancelScheduled != null || this.unsubForeground != null) return;

    // TOPE de la cadena que NADIE pidió (R6.4). Va ANTES del gate de foreground a propósito: una cadena
    // con el presupuesto vencido tiene que MORIR, no quedarse esperando el retorno a primer plano para
    // seguir martillando. Y el presupuesto se mide en tiempo de pared desde que arrancó la cadena: si se
    // gastó con la app en background, la ventana de "lo prendí un minuto después" ya pasó igual.
    if (this.unpromptedBudgetSpent()) {
      this.exhaustUnpromptedChain();
      return;
    }

    if (!this.env.isForeground()) {
      this.waitForForeground();
      return;
    }

    // 🟡-3 (dwell): el contador se resetea solo si el link que se acaba de caer DURÓ. Antes se
    // reseteaba apenas conectaba, así que un flap producía 500 ms → 500 ms → 500 ms para siempre
    // (medido en el banco: `attempt:0` en los 4 ciclos de `flap 4 3000`).
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
        // El TOPE también se re-chequea acá, y va ANTES del gate de foreground (lo encontró la
        // autorrevisión, con un test que lo caza): si el orden fuera el otro, un timer que dispara con
        // la app en background se parquearía en `waitForForeground()` **sin pasar por el chequeo del
        // presupuesto**, y una cadena vencida quedaría de zombi esperando el retorno a primer plano para
        // volver a martillar — o sea, el tope sería evitable simplemente guardando el teléfono.
        if (this.unpromptedBudgetSpent()) {
          this.exhaustUnpromptedChain();
          return;
        }
        // 🟠-1: el gate de foreground se re-chequea AL DISPARAR, no solo al programar. Entre armar
        // (hasta 8 s de backoff) y disparar, la app puede haberse ido a background — y conectar
        // desde background viola R6.9 y, encima, es el habilitador del latch eterno: un
        // `requestBluetoothEnabled` en background no puede abrir su Activity, así que su promesa no
        // se asienta NUNCA.
        if (!this.env.isForeground()) {
          this.waitForForeground();
          return;
        }
        // `retry` = continúa la cadena vigente y HEREDA su tope (o su ausencia). Si acá se pusiera
        // 'operator' o 'autoconnect', el timer estaría re-arrancando la cadena en cada vuelta y el tope
        // no se alcanzaría nunca — que es exactamente la cadena infinita que este trigger vino a acotar.
        void this.runConnect(this.currentDeviceId ?? undefined, 'retry');
      },
      delay,
      'reconnect',
    );
  }

  /**
   * Se agotó el tope de la cadena que nadie pidió: **se deja de reintentar**.
   *
   * Tres decisiones, y las tres importan:
   *
   * 1. **NO se olvida el device recordado.** Que hoy no aparezca no significa que no sea el bastón del
   *    operario: lo más probable es que esté apagado. Olvidarlo le rompería el arranque de mañana. Un
   *    `connect()` sin target posterior sigue encontrándolo.
   * 2. **Se emite `'off'`, no `'disconnected'`.** `'off'` es literalmente el estado en el que queda —no
   *    conectado y **sin** estar intentando— y tiene CTA ("Conectar bastón" / "Volver a conectar"), a
   *    diferencia de `'scanning'`, que no tiene ninguno y era la trampa: la app quedaba con cara de rota
   *    y sin botón. Además `'off'` es el único estado que el `StickStatusIndicator` **se auto-oculta**:
   *    a alguien que no pidió nada no se le toma el chrome de la app para decirle que algo falló. El que
   *    fue a buscarlo a la pantalla de conexión SÍ recibe el copy honesto, vía `autoConnectExhausted`.
   * 3. **El contador de backoff vuelve al piso** (lo hace `applyChainPolicy` al arrancar la cadena
   *    siguiente): el tap del operario reintenta a los 500 ms, no a los 8 s.
   *
   * Un tap en ese CTA entra por `connect()` → trigger `operator` → cadena **sin** tope, que es lo que
   * corresponde: ahí el operario está activamente tratando de conectar.
   */
  /**
   * ¿Este intento (`gen`) puede cerrar el socket que abrió, sin arrastrarse la conexión de otro?
   * (MEDIUM-1 del Gate 2.)
   *
   * El problema: `device.disconnect()` de la lib **no cierra ese socket** — cierra el de **esa
   * DIRECCIÓN** (`BluetoothDevice.js:54-55` → `disconnectFromDevice(this.address)`). Y el nativo, si la
   * dirección ya está conectada, devuelve la conexión EXISTENTE. Así que un intento A que venció a los
   * 20 s y resuelve tarde le cerraría el socket a B, que reconectó 8 s después — y la app quedaría
   * diciendo "conectado" sobre un socket muerto: el mismo síntoma que BENCH-1, producido por la
   * limpieza que vino a evitar un socket fantasma.
   *
   * La regla, con las dos razones por las que la generación puede haber avanzado:
   *   - `closed` → el operario tocó "Desconectar": no quiere NADA en esa dirección → cerrar sí o sí.
   *   - generación distinta sin `closed` → arrancó OTRO intento, que ahora es el dueño de la dirección
   *     (y probablemente su socket ES este mismo, porque el nativo reusa la conexión existente) → NO
   *     tocarlo. No se "leakea" nada: si nadie más lo usa, `this.device` queda en null y el próximo
   *     `connectToDevice` recibe esa misma conexión.
   */
  private canCloseOrphanSocket(gen: number): boolean {
    if (this.closed) return true;
    return gen === this.connectGeneration;
  }

  /** ¿La cadena vigente tiene tope y ya se le pasó? (`null` = cadena del operario, sin tope). */
  private unpromptedBudgetSpent(): boolean {
    return this.retryBudgetUntil != null && this.now() >= this.retryBudgetUntil;
  }

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
        // ignorar: el socket puede haberse cerrado solo (y un `disconnect()` que no vuelve no puede
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
