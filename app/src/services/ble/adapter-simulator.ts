// adapter-simulator — el bastón SIMULADO para DEMOS HUMANAS EN VIVO (RMV4.1/4.2, design §5).
// Emite lecturas de EID sintéticas VÁLIDAS (pasan `isValidTag`) para ejercitar el pipeline
// completo (conexión → lectura → dedup → confirmación pre-commit → find-or-create) SIN bastón
// físico. dev/demo-only (triple-guard: el provider solo lo instancia bajo `isDemoMode()`).
//
// Distinción con el MockAdapter (kind 'mock'): el mock es para inyección de Playwright
// (invisible, sin marcado); el simulador es para demos con controles visibles + marcado "DEMO"
// (honestidad de integridad SENASA). Por eso un `kind` propio, no reusar 'mock' (design §11 B).
//
// Puro respecto de RN/I-O: no importa RN → ejercitable en node:test. El EID que emite es YA
// LIMPIO (como el mock): entra al provider por `handleReading(value, isRawStream=false)` →
// mismo contrato (validate + dedup + confirmación pre-commit + feedback).

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';
import { isValidTag } from './parser-rs420';

// EIDs demo REALISTAS (15 díg, ISO 11784/11785 FDX-B): mezcla de prefijo país argentino `032` (caravana
// oficial) y fabricante Allflex `982`. Se ROTA sobre esta lista (seq++ % N) en vez de un contador
// zero-padded (que salía obvio-fake: 032000000000000, 032000000000001…). En una demo humana los EIDs se
// leen como caravanas reales, y como cada emisión consecutiva difiere (hasta N=lista), la dedup por-TAG
// del contrato no se come lecturas seguidas; al pasar de N cicla y la dedup maneja el repetido (correcto).
// Todos pasan `isValidTag` por construcción (RMV4.1) — verificado con self-check en `nextDemoEid`.
const DEMO_EIDS = [
  '032010006382438',
  '982000364696050',
  '032015004829173',
  '982123000456789',
  '032008761204935',
  '982000411223344',
  '032011209837465',
  '982000502938471',
  '032019400128736',
  '982000617483920',
] as const;

export class SimulatorAdapter implements StickAdapter {
  readonly kind = 'simulator' as const;

  private tagListeners = new Set<(eid: string) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private listening = false;
  private connected = false;
  private seq = 0;
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  /** "Conecta" el bastón simulado: marca 'connected' (como el mock). No hay I/O física. */
  async connect(): Promise<void> {
    this.connected = true;
    this.emitStatus('connected');
  }

  async disconnect(): Promise<void> {
    this.stop();
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

  // ─── API de simulación (dev/demo, la usa DemoControls bajo isDemoMode()) ─────────────────

  /**
   * Emite una lectura simulada (RMV4.1/4.2). Propaga por `onTagRead` un EID sintético VÁLIDO
   * (pasa `isValidTag`) SOLO si el listener está activo (respeta enable/disable como el mock).
   * Si se pasa un `eid` explícito se usa ese (el caller es responsable); si no, se genera uno
   * válido y DISTINTO en cada llamada (para que la dedup por-TAG del contrato no se coma las
   * lecturas consecutivas de una demo). El contrato valida/des-duplica/confirma aguas abajo.
   */
  emit(eid?: string): void {
    if (!this.listening) return;
    const tag = eid ?? this.nextDemoEid();
    for (const cb of this.tagListeners) cb(tag);
  }

  /** Auto-play: emite una lectura simulada cada `intervalMs` (demo desatendida). Idempotente. */
  startAutoPlay(intervalMs = 2000): void {
    this.stop();
    this.autoTimer = setInterval(() => this.emit(), intervalMs);
  }

  /** Detiene el auto-play (si está corriendo). */
  stop(): void {
    if (this.autoTimer != null) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get isListening(): boolean {
    return this.listening;
  }

  /**
   * Devuelve el próximo EID demo REALISTA, ciclando por `DEMO_EIDS` (seq++ % N) → emisiones consecutivas
   * DISTINTAS (para que la dedup por-TAG del contrato no se coma las lecturas seguidas de una demo, hasta
   * N; luego cicla y la dedup maneja el repetido). Se auto-verifica con `isValidTag` (invariante de
   * RMV4.1); si por algún motivo no pasara, cae a un EID demo fijo conocido-válido (nunca emite inválido).
   */
  private nextDemoEid(): string {
    const eid = DEMO_EIDS[this.seq++ % DEMO_EIDS.length];
    return isValidTag(eid) ? eid : '982000364696050';
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }
}
