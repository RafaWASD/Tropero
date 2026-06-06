// adapter-manual — la PUERTA CERO (spec 09 R1): el tipeo manual del identificador alimenta
// el MISMO contrato de ingesta que el bastón (R7.1, "dos puertas, un motor"). Es el PISO:
// siempre disponible, nunca bloquea, independiente del estado de cualquier transporte
// (R7.2, R7.4). No tiene "conexión" física — su estado es siempre 'connected' (la carga
// manual está siempre lista).
//
// Puro respecto de RN/I-O: no importa RN. El identificador tipeado lo provee la UI de spec 09
// (campo de búsqueda / form) llamando submit(value); el adapter lo emite por onTagRead. El
// provider decide cómo ingerirlo: si es un EID de 15 díg, pasa por ingestEid (validado);
// si es un IDV/visual, spec 09 lo resuelve por su otra puerta de búsqueda (no por el
// contrato de EID). El adapter NO valida: solo transporta lo tipeado al contrato.

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';

export class ManualAdapter implements StickAdapter {
  readonly kind = 'manual' as const;

  private tagListeners = new Set<(value: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = true;

  // La carga manual no se "conecta" físicamente: connect/disconnect son no-ops que mantienen
  // el estado 'connected' (siempre lista). NUNCA bloquea (R7.4).
  async connect(): Promise<void> {
    this.emitStatus('connected');
  }

  async disconnect(): Promise<void> {
    // No-op: la carga manual no se desconecta (R7.2). Se mantiene disponible.
  }

  onTagRead(cb: (value: string) => void): Unsubscribe {
    this.tagListeners.add(cb);
    return () => this.tagListeners.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): Unsubscribe {
    this.statusListeners.add(cb);
    // La carga manual está lista de entrada: notificar 'connected' al suscribirse.
    cb('connected');
    return () => this.statusListeners.delete(cb);
  }

  enable(): void {
    this.listening = true;
  }

  disable(): void {
    // disable lógico: aunque se desactive la escucha del bastón en MODO MANIOBRAS, la carga
    // manual sigue funcionando por la UI directa de spec 09. Acá solo controlamos si los
    // submits de ESTE adapter se propagan al contrato global del listener.
    this.listening = false;
  }

  /**
   * La UI de spec 09 (campo de búsqueda / form) llama esto con el identificador tipeado por
   * el operario (R7.1). Se propaga por onTagRead al contrato. Si el listener está desactivado
   * (disable), no se propaga (el form de spec 09 lo procesa por su cuenta).
   */
  submit(value: string): void {
    if (!this.listening) return;
    for (const cb of this.tagListeners) cb(value);
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }
}
