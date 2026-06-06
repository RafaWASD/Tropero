// adapter-mock — inyección de lecturas + transiciones de conexión para ejercitar el stack
// ENTERO sin hardware (R10.1, R10.8). Ya pedido por spec 09 (mock provider, mode='mock').
// Inyecta un EID YA LIMPIO por mockTagRead(tag) y transiciones por mockConnectionChange.
// Respeta enable/disable (R10.5/R10.8): con disable, mockTagRead no propaga.
//
// Puro respecto de RN/I-O: no importa RN → ejercitable en node:test. El contrato (validate +
// dedup + confirm) y el feedback los aplica el provider/engine; el mock solo es la FUENTE.

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';

export class MockAdapter implements StickAdapter {
  readonly kind = 'mock' as const;

  private tagListeners = new Set<(eid: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = false;
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
    this.emitStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitStatus('disconnected');
  }

  onTagRead(cb: (eid: string) => void): Unsubscribe {
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

  // ─── API de inyección (spec 09: mode='mock') ─────────────────────────────────────────

  /**
   * Inyecta una lectura simulada (R10.1). Propaga el EID por onTagRead SOLO si el listener
   * está activo (R10.5/R10.8: con disable no dispara — replica MODO MANIOBRAS). El EID ya
   * viene limpio; el contrato lo valida/des-duplica/confirma aguas abajo.
   */
  mockTagRead(tag: string): void {
    if (!this.listening) return;
    for (const cb of this.tagListeners) cb(tag);
  }

  /** Inyecta una transición de conexión (R10.1) para ejercitar el status/indicador. */
  mockConnectionChange(connected: boolean): void {
    this.connected = connected;
    this.emitStatus(connected ? 'connected' : 'disconnected');
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isListening(): boolean {
    return this.listening;
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }
}
