// adapter-spp-android — RS420 por Bluetooth Classic SPP en Android (RMV5, ADR-024 §2/§3).
// `StickAdapter` real (`kind:'spp-android'`) sobre `react-native-bluetooth-classic`, parametrizado
// por el `ReaderDriver` del registro (RMV5.2).
//
// ── ESTADO (2026-07-29): la dependencia nativa ESTÁ INSTALADA y el adapter se MONTA en Android ──
// Antes este archivo decía "conexión RFCOMM real = gated por hardware, la dep no se instala". Se
// levantó ese gate: `react-native-bluetooth-classic@1.73.0-rc.17` está en el package.json, autolinkea
// en Android (`kjd.reactnative.bluetooth.RNBluetoothClassicPackage`) y compila contra RN 0.85.3 /
// AGP 8.12 / Gradle 9.3.1 / compileSdk 36 con New Architecture (corre por el interop de módulos
// legacy: `useTurboModuleInterop()` es true cuando `newArchEnabled=true`). Lo ÚNICO que sigue gated
// por hardware es el STREAM DE LECTURAS de un RS420 físico (nadie tiene uno) — todo el resto del
// camino (permisos, BT prendido, lista de emparejados, apertura del socket, errores) es ejercitable.
//
// ── DOS BUGS DEL CÓDIGO ANTERIOR, corregidos acá (los habría comido el device) ─────────────────
// 1. FRAMING. El adapter pasaba `event.data` por `LineFramer` (cortar por `\n`). El nativo entrega
//    MENSAJES YA DELIMITADOS y SIN el `\n` (`DelimitedStringDeviceConnectionImpl`, delimiter `\n`)
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
// IMPORT PEREZOSO (RMV5.6, patrón feedback.ts): `react-native-bluetooth-classic` y `react-native`
// se `require` DENTRO de las funciones, envueltos en try/catch — NUNCA top-level. Importar este
// módulo NO tira en web/CI sin la lib nativa (cubierto en adapter-spp-android.test.ts). Los imports
// top-level son SOLO tipos + módulos PUROS.
//
// INYECCIÓN DE ENTORNO (`SppEnv`): la I/O (cargar el nativo, pedir permisos, leer/escribir el device
// recordado, foreground, timers) entra por constructor con defaults reales. No es adorno: es lo que
// permite testear la MÁQUINA DE ESTADOS entera —permiso denegado, BT apagado, device no emparejado,
// stream, desconexión, backoff— sin un RS420 y sin un teléfono.

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import type { ReaderDriver } from './driver-types';
import { RS420_DRIVER } from './driver-rs420';
import { backoffDelayMs } from './line-framer';
import {
  sppConnectOptions,
  sppUuidIsSupported,
  splitSppPayload,
  normalizePairedDevices,
  type PairedDevice,
} from './spp-protocol';
import {
  ensureAndroidBluetoothPermissions,
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
}

/** Entorno de I/O del adapter. Los defaults son los reales; los tests inyectan dobles. */
export interface SppEnv {
  loadNative: () => SppNative | null;
  ensurePermissions: () => Promise<BluetoothPermissionOutcome>;
  readRemembered: () => Promise<string | null>;
  writeRemembered: (deviceId: string) => Promise<void>;
  isForeground: () => boolean;
  /** Programa un reintento. Devuelve un cancelador. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** Suscribe al retorno a foreground (para re-armar la reconexión). Devuelve unsubscribe. */
  onForeground: (cb: () => void) => Unsubscribe;
}

/**
 * Resuelve los params del transporte SPP del driver (RMV5.2). PURO y exportado → testeable sin
 * device: confirma que el adapter toma sppUuid/pin del DRIVER, no hardcodeados. `null` si el
 * driver no declara un transporte SPP.
 */
export function resolveSppParams(driver: ReaderDriver): { sppUuid: string; pin?: string } | null {
  const spp = driver.transports.find((t) => t.kind === 'spp');
  if (!spp || spp.kind !== 'spp') return null;
  return { sppUuid: spp.params.sppUuid, pin: spp.params.pin };
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

/**
 * Lista los devices Bluetooth Classic YA EMPAREJADOS en el sistema (RMV3.2). Pide antes el permiso
 * de runtime (Android 12+ lo exige para `getBondedDevices`). Nunca tira: cualquier problema
 * devuelve `{ ok:false }` y la pantalla degrada a la salida manual (R7).
 */
export async function listPairedSppDevices(
  env: Pick<SppEnv, 'loadNative' | 'ensurePermissions'> = defaultSppEnv(),
): Promise<{ ok: true; devices: PairedDevice[] } | { ok: false; reason: 'unavailable' | 'permission_denied' | 'bluetooth_off' | 'error' }> {
  const native = env.loadNative();
  if (native == null) return { ok: false, reason: 'unavailable' };
  const permission = await env.ensurePermissions();
  if (permission === 'denied') return { ok: false, reason: 'permission_denied' };
  if (permission === 'unavailable') return { ok: false, reason: 'unavailable' };
  try {
    if (!(await native.isBluetoothEnabled())) {
      if (typeof native.requestBluetoothEnabled !== 'function') return { ok: false, reason: 'bluetooth_off' };
      const enabled = await native.requestBluetoothEnabled();
      if (!enabled) return { ok: false, reason: 'bluetooth_off' };
    }
    return { ok: true, devices: normalizePairedDevices(await native.getBondedDevices()) };
  } catch (e) {
    logTransportEvent({ kind: 'connect_error', message: errorMessage(e) });
    return { ok: false, reason: 'error' };
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'unknown';
}

/** Entorno real (defaults del constructor). Cada pieza de I/O va con require perezoso + try/catch. */
export function defaultSppEnv(): SppEnv {
  return {
    loadNative: loadRNBC,
    ensurePermissions: ensureAndroidBluetoothPermissions,
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

  private readonly driver: ReaderDriver;
  private readonly env: SppEnv;
  private tagListeners = new Set<(rawLine: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;
  private device: SppDeviceLike | null = null;
  private dataSub: SppSubscription | null = null;
  private disconnectSub: SppSubscription | null = null;
  private closed = false;
  private connectInFlight = false;
  private reconnectAttempt = 0;
  private cancelScheduled: (() => void) | null = null;
  private unsubForeground: Unsubscribe | null = null;
  private currentDeviceId: string | null = null;
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

  /**
   * Abre el RFCOMM SPP del lector (RMV5.1). Orden del camino feliz:
   *   1. params del driver (RMV5.2) + chequeo de que su UUID es el que la lib sabe abrir;
   *   2. módulo nativo presente (si no, manual-first: `disconnected`, sin reintentos);
   *   3. permiso BLUETOOTH_CONNECT (Android 12+) → denegado ⇒ `permission_denied` con CTA;
   *   4. device: el pasado o el recordado (RMV5.4);
   *   5. Bluetooth prendido (si no, se pide prenderlo);
   *   6. `connectToDevice` con framing delimitado por `\n` del nativo (RMV5.3);
   *   7. suscripción a datos + a la desconexión del SO.
   * Nunca bloquea la carga manual (R7): cualquier falla es un estado, no una excepción.
   */
  async connect(deviceId?: string): Promise<void> {
    this.closed = false;
    if (this.connectInFlight) return; // evita el ALREADY_CONNECTING del nativo (reintento + tap)
    this.connectInFlight = true;
    try {
      await this.doConnect(deviceId);
    } finally {
      this.connectInFlight = false;
    }
  }

  private async doConnect(deviceId?: string): Promise<void> {
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

    const native = this.env.loadNative();
    if (native == null) {
      // Sin módulo nativo (web/CI/dev build viejo): no se puede conectar y NO se reintenta (el
      // resultado sería idéntico para siempre). Manual-first (R7).
      this.emitStatus('disconnected');
      return;
    }

    const permission = await this.env.ensurePermissions();
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

    const target = deviceId ?? (await this.env.readRemembered());
    if (!target) {
      this.emitStatus('disconnected');
      return;
    }
    // El objetivo se recuerda ACÁ, no recién al conectar: si se anotara solo en el éxito, el
    // reintento del backoff llamaría `connect(undefined)` y caería en el device RECORDADO — que en
    // el primer emparejamiento todavía no existe (null) → la cadena de reintentos moría en silencio
    // después del primer fallo, justo en el caso "el bastón está apagado, prendelo".
    this.currentDeviceId = target;

    this.emitStatus('connecting');
    try {
      if (!(await native.isBluetoothEnabled())) {
        const enabled =
          typeof native.requestBluetoothEnabled === 'function'
            ? await native.requestBluetoothEnabled()
            : false;
        if (!enabled) {
          // El operario dijo que no (o el equipo no permite pedirlo): estado claro, sin loop de
          // reintentos que le vuelva a tirar el diálogo del sistema en la cara.
          logTransportEvent({ kind: 'connect_error', message: 'bluetooth_off' });
          this.emitStatus('disconnected');
          return;
        }
      }

      // SPP baud-independiente (RMV5.7): sin baudRate. El framing delimitado por `\n` lo hace el
      // nativo (ver spp-protocol) — NO se pasa un `uuid` porque la lib lo ignora (lo documenta
      // `RNBC_FIXED_SPP_UUID`); el chequeo de arriba ya garantizó que coincide con el del driver.
      const device = await native.connectToDevice(target, sppConnectOptions() as unknown as Record<string, unknown>);
      if (this.closed) {
        // El operario tocó "Desconectar" MIENTRAS se abría el socket: el `disconnect()` no tenía
        // nada que cerrar todavía y este `await` habría dejado la conexión abierta a sus espaldas.
        try {
          await device.disconnect();
        } catch {
          // ignorar
        }
        this.emitStatus('disconnected');
        return;
      }
      const session = ++this.session;
      this.device = device;
      this.reconnectAttempt = 0;
      await this.env.writeRemembered(target); // persiste el device elegido (RMV5.4)

      this.dataSub = device.onDataReceived((event) => {
        if (this.session !== session) return; // lectura de una conexión ya cerrada → se descarta
        for (const line of splitSppPayload(event?.data)) {
          if (this.listening) this.emitTag(line); // línea CRUDA → contrato (RMV5.3)
        }
      });

      // Desconexión reportada por el SO (bastón apagado / fuera de rango): estado + reconexión.
      if (typeof native.onDeviceDisconnected === 'function') {
        this.disconnectSub = native.onDeviceDisconnected(() => {
          if (this.closed || this.session !== session) return;
          void this.teardownStreams();
          this.emitStatus('disconnected');
          this.scheduleReconnect();
        });
      }

      this.emitStatus('connected');
    } catch (e) {
      // Falla de conexión → no bloquea el manual (R7); reintenta con backoff (foreground, RMV5.5).
      logTransportEvent({ kind: 'connect_error', message: errorMessage(e) });
      this.emitStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
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

    if (!this.env.isForeground()) {
      this.unsubForeground = this.env.onForeground(() => {
        this.clearForegroundWait();
        if (!this.closed) this.scheduleReconnect();
      });
      return;
    }

    const attempt = this.reconnectAttempt++;
    const delay = backoffDelayMs(attempt);
    logTransportEvent({ kind: 'reconnect_attempt', attempt });
    this.emitStatus('scanning');
    this.cancelScheduled = this.env.schedule(() => {
      this.cancelScheduled = null;
      if (this.closed) return;
      void this.connect(this.currentDeviceId ?? undefined);
    }, delay);
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
        await device.disconnect();
      } catch {
        // ignorar: el socket puede haberse cerrado solo
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
