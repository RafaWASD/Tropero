// adapter-web-serial — DEV/TEST harness (R5): lee el RS420 pareado a Windows desde la app
// web vía navigator.serial (COM virtual del SPP). NO es transporte de producción (Web Serial
// no existe en RN ni iOS Safari). Solo se monta cuando Platform.OS === 'web' (R5.1). Reusa
// parser-rs420.ts tal cual (R5.3) — el framing por línea (LineFramer) entrega cada línea
// cruda al contrato, que llama parseRs420Line.
//
// La lógica PURA (framing, soporte, backoff) vive en line-framer.ts y la testea node:test;
// este módulo es la capa de I/O sobre la Web Serial API (no testeada en CI — necesita Chrome
// + device). Mantiene el flujo no bloqueante: cualquier fallo refleja 'disconnected' por
// onStatus y reintenta con backoff (R5.5), sin romper la carga manual (R7).

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import { LineFramer, isWebSerialSupported, backoffDelayMs } from './line-framer';
import { DEFAULT_BAUD } from './config';

// ── Tipos mínimos de la Web Serial API (no están en los libs DOM del setup RN/Expo) ──────
// Declarados localmente para tipar el adapter sin `any`; el runtime real lo provee Chromium.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
  addEventListener(type: 'disconnect', listener: () => void): void;
  removeEventListener(type: 'disconnect', listener: () => void): void;
}

function getSerial(): SerialLike | null {
  try {
    const nav = navigator as unknown as { serial?: SerialLike };
    return nav.serial ?? null;
  } catch {
    return null;
  }
}

export class WebSerialAdapter implements StickAdapter {
  readonly kind = 'web-serial' as const;

  private tagListeners = new Set<(rawLine: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;
  private port: SerialPortLike | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private framer = new LineFramer();
  private closed = false;
  private reconnectAttempt = 0;
  private reconnectScheduled = false;
  private readonly baudRate: number;

  constructor(baudRate: number = DEFAULT_BAUD) {
    this.baudRate = baudRate;
  }

  /** ¿El navegador soporta Web Serial (Chromium + contexto seguro)? (R5.6) */
  static isSupported(): boolean {
    return isWebSerialSupported();
  }

  /**
   * Conecta (R5.2/R5.4). Sin deviceId: pide el puerto con requestPort() (gesto de usuario).
   * Con la reconexión silenciosa usa getPorts() para recuperar un puerto ya autorizado sin
   * volver a preguntar (R5.4). Degrada con estado claro si no hay soporte (R5.6).
   */
  async connect(deviceId?: string): Promise<void> {
    if (!isWebSerialSupported()) {
      this.emitStatus('permission_denied'); // sin Web Serial → se trata como no disponible (R5.6)
      return;
    }
    const serial = getSerial();
    if (!serial) {
      this.emitStatus('permission_denied');
      return;
    }
    this.closed = false;
    this.emitStatus('connecting');
    try {
      // deviceId 'remembered' → intentar getPorts() (sin preguntar); si no, requestPort().
      let port: SerialPortLike | null = null;
      if (deviceId === 'remembered') {
        const ports = await serial.getPorts();
        port = ports[0] ?? null;
      }
      if (!port) {
        port = await serial.requestPort();
      }
      await port.open({ baudRate: this.baudRate });
      this.port = port;
      this.reconnectAttempt = 0;
      this.emitStatus('connected');
      // Idempotente: remover antes de agregar evita apilar listeners en cada reconexión.
      serial.removeEventListener('disconnect', this.handleDisconnect);
      serial.addEventListener('disconnect', this.handleDisconnect);
      void this.readLoop();
    } catch {
      // requestPort cancelado / open fallido → no bloquea la carga manual (R7). Estado claro.
      this.emitStatus('disconnected');
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    const serial = getSerial();
    if (serial) serial.removeEventListener('disconnect', this.handleDisconnect);
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

  // ─── Read loop + reconexión (R5.3, R5.5) ─────────────────────────────────────────────

  private async readLoop(): Promise<void> {
    const readable = this.port?.readable;
    if (!readable) return;
    const decoder = new TextDecoder();
    try {
      this.reader = readable.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        const text = decoder.decode(value, { stream: true });
        for (const line of this.framer.push(text)) {
          if (this.listening) this.emitTag(line); // cada línea CRUDA al contrato (R5.3)
        }
      }
    } catch {
      // Error del read loop → reflejar desconexión + reintentar con backoff (R5.5).
    } finally {
      await this.teardown();
      if (!this.closed) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    // Guard: el read loop (finally) y el evento 'disconnect' del navegador pueden dispararse
    // ambos ante una desconexión; sin guard agendarían dos loops de reconexión paralelos.
    if (this.reconnectScheduled || this.closed) return;
    this.reconnectScheduled = true;
    this.emitStatus('disconnected');
    const delay = backoffDelayMs(this.reconnectAttempt++);
    this.emitStatus('scanning');
    setTimeout(() => {
      this.reconnectScheduled = false;
      if (!this.closed) void this.connect('remembered');
    }, delay);
  }

  private handleDisconnect = (): void => {
    // El navegador emitió 'disconnect' (R5.5): reflejar estado + reintentar.
    if (this.closed) return;
    void this.teardown().then(() => this.scheduleReconnect());
  };

  private async teardown(): Promise<void> {
    try {
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch {
          // ignorar
        }
        try {
          this.reader.releaseLock();
        } catch {
          // ignorar
        }
        this.reader = null;
      }
      if (this.port) {
        try {
          await this.port.close();
        } catch {
          // ignorar
        }
        this.port = null;
      }
    } finally {
      this.framer.reset();
    }
  }

  private emitTag(rawLine: string): void {
    for (const cb of this.tagListeners) cb(rawLine);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }
}
