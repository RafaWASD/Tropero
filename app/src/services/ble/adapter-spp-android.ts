// adapter-spp-android — RS420 nativo por Bluetooth Classic SPP (RMV5, ADR-024 §2/§3). Reemplaza
// el placeholder por un `StickAdapter` real (`kind:'spp-android'`) parametrizado por el
// `ReaderDriver` del registro (RMV5.2): sppUuid/pin/frameParser salen del driver, así OTRO lector
// SPP se soporta agregando su driver, sin reescribir este adapter.
//
// ⚠️ CONEXIÓN RFCOMM REAL = GATED por hardware (RMV5.9): el ENTREGABLE de este run es el CÓDIGO
// completo + los tests PUROS. La validación contra el RS420 físico + el montaje en el provider +
// el veto del config plugin + la instalación de `react-native-bluetooth-classic` son la fase
// gated (T-MV.5.1/5.5) — NO se hacen acá.
//
// IMPORT PEREZOSO (RMV5.6, patrón feedback.ts): `react-native-bluetooth-classic`, `remembered-
// device` (que importa expo-secure-store + RN) y `react-native` (AppState) se `require` DENTRO de
// las funciones de I/O, envueltos en try/catch — NUNCA top-level. Así IMPORTAR este módulo NO
// tira en web/CI sin la lib nativa (verificado en adapter-spp-android.test.ts); solo `connect()`
// fallaría suave (emite 'disconnected') en un entorno sin la lib. Los imports top-level son SOLO
// tipos + módulos PUROS (stick-adapter/driver-types [types], driver-rs420, line-framer).

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import type { ReaderDriver } from './driver-types';
import { RS420_DRIVER } from './driver-rs420';
import { LineFramer, backoffDelayMs } from './line-framer';

// ── Tipos mínimos de react-native-bluetooth-classic (la lib NO está instalada; no la importamos
//    por tipo — la modelamos localmente para tipar la I/O sin `any` suelto) ───────────────────
interface SppConnection {
  onDataReceived(cb: (event: { data: string }) => void): { remove(): void };
  disconnect(): Promise<boolean>;
}
interface RNBluetoothClassicLike {
  connectToDevice(address: string, options?: Record<string, unknown>): Promise<SppConnection>;
  pairDevice?(address: string): Promise<unknown>;
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

/** Require PEREZOSO de la lib nativa (RMV5.6). `null` si no está instalada (web/CI/sin dev build). */
function loadRNBC(): RNBluetoothClassicLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-bluetooth-classic');
    return (mod?.default ?? mod) as RNBluetoothClassicLike;
  } catch {
    return null;
  }
}

export class SppAndroidAdapter implements StickAdapter {
  readonly kind = 'spp-android' as const;

  private readonly driver: ReaderDriver;
  private tagListeners = new Set<(rawLine: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;
  private framer = new LineFramer();
  private conn: SppConnection | null = null;
  private dataSub: { remove(): void } | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectScheduled = false;
  private currentDeviceId: string | null = null;

  /** Parametrizado por el driver (default RS420, RMV5.2). Otro lector SPP → otro driver, mismo adapter. */
  constructor(driver: ReaderDriver = RS420_DRIVER) {
    this.driver = driver;
  }

  /**
   * Abre el RFCOMM SPP del lector (RMV5.1). Toma sppUuid/pin del driver (RMV5.2), lee el device
   * recordado si no se pasa uno (RMV5.4), framea el stream por línea (`LineFramer`, RMV5.3) y
   * entrega cada línea CRUDA al contrato vía `onTagRead` (el contrato la desframea con
   * `ingestRawLine`/parser). Baud-independiente (RMV5.7): el SPP virtual ignora el baud, no se pasa.
   * Nunca bloquea la carga manual (R7): cualquier falla → 'disconnected' + reconexión con backoff.
   */
  async connect(deviceId?: string): Promise<void> {
    this.closed = false;
    const params = resolveSppParams(this.driver);
    if (!params) {
      this.emitStatus('disconnected');
      return;
    }
    const RNBC = loadRNBC();
    if (!RNBC) {
      // Sin lib nativa (web/CI/sin dev build): NO se puede conectar. No bloquea el manual (R7);
      // la conexión SPP real es device-gated (RMV5.9). Estado claro, sin throw.
      this.emitStatus('disconnected');
      return;
    }
    const target = deviceId ?? (await this.readRemembered());
    if (!target) {
      this.emitStatus('disconnected');
      return;
    }
    this.emitStatus('connecting');
    try {
      // Pairing SPP (slave, PIN del driver = 1234, RMV5.4). Best-effort: si ya está pareado o el
      // SO maneja el PIN, seguimos.
      if (params.pin && typeof RNBC.pairDevice === 'function') {
        try {
          await RNBC.pairDevice(target);
        } catch {
          // ya pareado / el SO gestiona el emparejamiento
        }
      }
      // SPP baud-independiente (RMV5.7): solo el UUID RFCOMM del driver, sin baudRate.
      const conn = await RNBC.connectToDevice(target, { uuid: params.sppUuid, secure: true });
      this.conn = conn;
      this.currentDeviceId = target;
      this.reconnectAttempt = 0;
      await this.writeRemembered(target); // persiste el device elegido (RMV5.4)
      this.framer.reset();
      this.dataSub = conn.onDataReceived((event) => {
        for (const line of this.framer.push(event?.data ?? '')) {
          if (this.listening) this.emitTag(line); // línea CRUDA → contrato (RMV5.3)
        }
      });
      this.emitStatus('connected');
    } catch {
      // Falla de conexión → no bloquea el manual (R7); reintenta con backoff (foreground, RMV5.5).
      this.emitStatus('disconnected');
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    await this.teardown();
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

  private scheduleReconnect(): void {
    if (this.reconnectScheduled || this.closed) return;
    // Foreground-only (RMV5.5): sin SPP/BLE en background en el MVP. Si la app no está activa, no
    // reintentamos (se retomará cuando vuelva a foreground / el operario reabra la pantalla).
    if (!this.isForeground()) return;
    this.reconnectScheduled = true;
    const delay = backoffDelayMs(this.reconnectAttempt++); // reuso del backoff del core
    this.emitStatus('scanning');
    setTimeout(() => {
      this.reconnectScheduled = false;
      if (!this.closed && this.isForeground()) {
        void this.connect(this.currentDeviceId ?? undefined);
      }
    }, delay);
  }

  /** ¿La app está en foreground? Require PEREZOSO de RN (AppState). Sin RN (CI) → asume true. */
  private isForeground(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AppState } = require('react-native') as typeof import('react-native');
      return AppState.currentState === 'active';
    } catch {
      return true; // en CI la reconexión real es device-gated; no gateamos por foreground acá
    }
  }

  // ─── Device recordado (RMV5.4) — require PEREZOSO (remembered-device toca RN/secure-store) ──

  private async readRemembered(): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { readRememberedDevice } = require('./remembered-device') as typeof import('./remembered-device');
      return await readRememberedDevice();
    } catch {
      return null;
    }
  }

  private async writeRemembered(deviceId: string): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { writeRememberedDevice } = require('./remembered-device') as typeof import('./remembered-device');
      await writeRememberedDevice(deviceId);
    } catch {
      // best-effort: si falla, la próxima vez se elige el device de nuevo
    }
  }

  private async teardown(): Promise<void> {
    if (this.dataSub) {
      try {
        this.dataSub.remove();
      } catch {
        // ignorar
      }
      this.dataSub = null;
    }
    if (this.conn) {
      try {
        await this.conn.disconnect();
      } catch {
        // ignorar
      }
      this.conn = null;
    }
    this.framer.reset();
  }

  private emitTag(rawLine: string): void {
    for (const cb of this.tagListeners) cb(rawLine);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }
}
