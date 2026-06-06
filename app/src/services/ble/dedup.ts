// Deduplicación de lecturas POR-TAG con ventana corta (R3). Transport-agnóstico: vive en
// el contrato, no en cada adaptador (ADR-024 §1), así es idéntica para los 5 adaptadores
// (R3.5). Puro: sin RN ni I/O → testeable con node:test.
//
// Decisión clave (R3.2, R3.3): NO es un cooldown global. Es un Map<eid, lastEmittedAtMs>
// keyed por EID, cada EID con su PROPIA ventana. Consecuencia: tres bastoneos seguidos de
// tres EIDs DISTINTOS producen tres emisiones AL INSTANTE (ninguno espera al otro) —
// habilita la asignación masiva de spec 09 R8. Solo un re-escaneo del MISMO EID dentro de
// la ventana se ignora (re-escaneo accidental, R3.1).

/**
 * Ventana de deduplicación por-TAG por defecto (R3.4 — ajustable). Default ~3s (context
 * decisión 2). Fuente única del valor: vive acá (módulo puro, sin imports de RN) para que
 * node:test la consuma sin resolver imports extensionless de otros módulos. config.ts la
 * reexporta para la UI/provider; el resto del código la usa desde una sola definición.
 */
export const DEDUP_WINDOW_MS = 3000;

/**
 * Deduplicador con ventana por-TAG. Estado mutable encapsulado (no es un módulo singleton:
 * cada listener/sesión crea el suyo, así dos pantallas no comparten ventanas). La ventana
 * es inyectable (default DEDUP_WINDOW_MS) para tests y para R3.4 (ajustable).
 */
export class TagDedup {
  private readonly windowMs: number;
  private readonly lastEmittedAt = new Map<string, number>();

  constructor(windowMs: number = DEDUP_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /**
   * ¿Debe emitirse este EID leído en el instante `now` (epoch ms)?
   *
   * - EID nunca visto, o visto hace ≥ windowMs → true, y registra `now` como su última
   *   emisión (R3.1 inversa, R3.2 para EIDs distintos).
   * - MISMO EID visto hace < windowMs → false (re-escaneo accidental, R3.1). NO refresca el
   *   timestamp: la ventana se mide desde la última emisión CONFIRMADA, no desde el último
   *   intento; así un bastón que repite la línea 9 veces seguidas (field-findings) no
   *   extiende la ventana indefinidamente.
   *
   * Keyed por EID (R3.3): un EID distinto nunca espera por otro (R3.2).
   */
  shouldEmit(eid: string, now: number): boolean {
    const last = this.lastEmittedAt.get(eid);
    if (last !== undefined && now - last < this.windowMs) {
      return false;
    }
    this.lastEmittedAt.set(eid, now);
    return true;
  }

  /** Limpia el estado de dedup (ej. al reiniciar una sesión de escucha). */
  reset(): void {
    this.lastEmittedAt.clear();
  }
}
