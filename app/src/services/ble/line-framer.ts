// Framing por línea de un stream de texto del lector (R5.3). PURO (sin RN, sin Web Serial)
// → testeable con node:test. Bufferea fragmentos de texto que llegan en chunks arbitrarios
// (la Web Serial / SPP no garantiza una línea por chunk) y emite LÍNEAS COMPLETAS al cortar
// por `\n` (tolerando `\r\n` — el `\r` lo limpia luego normalizeTag del parser).
//
// Es un buffer incremental con estado: push(chunk) devuelve las líneas completas que se
// pudieron cortar; el resto queda en el buffer hasta el próximo chunk. flush() devuelve lo
// que quede (sin terminador) — útil al cerrar el puerto.

export class LineFramer {
  private buffer = '';

  /**
   * Agrega un fragmento de texto y devuelve las líneas COMPLETAS cortadas por `\n`. El `\r`
   * de un `\r\n` se conserva en la línea (el parser lo descarta en normalizeTag); las líneas
   * vacías (entre terminadores consecutivos) se omiten para no generar ingestas vacías.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.replace(/[\r\s]/g, '').length > 0) lines.push(line);
    }
    return lines;
  }

  /** Devuelve y limpia lo que quede en el buffer sin terminador (al cerrar el puerto). */
  flush(): string | null {
    const rest = this.buffer;
    this.buffer = '';
    return rest.replace(/[\r\s]/g, '').length > 0 ? rest : null;
  }

  reset(): void {
    this.buffer = '';
  }
}

/**
 * ¿El entorno soporta Web Serial (R5.6)? Chromium en contexto seguro expone navigator.serial.
 * PURO en el sentido de que no produce efectos; lee el global de forma defensiva. Safari/
 * Firefox / contexto no seguro → false → la UI degrada con mensaje claro (R5.6).
 */
export function isWebSerialSupported(): boolean {
  try {
    return typeof navigator !== 'undefined' && 'serial' in navigator && navigator.serial != null;
  } catch {
    return false;
  }
}

/**
 * Backoff incremental para los reintentos de reconexión (R5.5). PURO. Crece exponencialmente
 * desde `baseMs` hasta `maxMs`. attempt es 0-based.
 */
export function backoffDelayMs(attempt: number, baseMs = 500, maxMs = 8000): number {
  const delay = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(delay, maxMs);
}
