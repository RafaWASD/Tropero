// Framing por línea de un stream de texto del lector (R5.3). PURO (sin RN, sin Web Serial)
// → testeable con node:test. Bufferea fragmentos de texto que llegan en chunks arbitrarios
// (la Web Serial / BLE GATT no garantiza una línea por chunk) y emite LÍNEAS COMPLETAS al
// cortar por el DELIMITADOR DEL LECTOR (default `\n`, tolerando `\r\n` — el `\r` lo limpia
// luego normalizeTag del parser).
//
// Es un buffer incremental con estado: push(chunk) devuelve las líneas completas que se
// pudieron cortar; el resto queda en el buffer hasta el próximo chunk. flush() devuelve lo
// que quede (sin terminador) — útil al cerrar el puerto.
//
// ── EL DELIMITADOR SE PARAMETRIZA (delta ios-ble-mfi, RBM2.8) ────────────────────────────
// Estaba HARDCODEADO en `\n`, y en el SPP eso no se notaba porque el framing lo hace el
// nativo con el terminador del driver. En BLE GATT no hay framing nativo: el framer de acá
// es el único que corta, así que un lector que termine en `\r` (o en cualquier otra cosa)
// dejaría la app conectada y muda, con el buffer creciendo para siempre — el síntoma exacto
// del 🟠-5 del SPP (`term cr` → 0 ingestas, 0 errores, medido en device). El delimitador
// entra por CONSTRUCTOR con default `'\n'`: los dos call sites existentes (web-serial y el
// harness) no cambian de comportamiento, y el nuevo pasa el del `ReaderDriver`.

export class LineFramer {
  private buffer = '';
  private readonly delimiter: string;

  /**
   * `delimiter` es el fin de trama DEL LECTOR (dato del `ReaderDriver`, no del transporte).
   * Default `'\n'` = el supuesto del RS420, que es el comportamiento previo a este delta.
   *
   * Un delimitador vacío dejaría a `indexOf('')` devolviendo 0 para siempre (bucle infinito
   * emitiendo líneas vacías), así que se cae al default: quién decide que un delimitador es
   * inaceptable es el adapter ANTES de conectar (`bleGattDelimiterIsSupported` → no abre la
   * conexión y lo loguea, RBM2.10). Acá solo hay que garantizar que el framer nunca cuelgue.
   */
  constructor(delimiter: string = '\n') {
    this.delimiter = typeof delimiter === 'string' && delimiter.length > 0 ? delimiter : '\n';
  }

  /**
   * Agrega un fragmento de texto y devuelve las líneas COMPLETAS cortadas por el delimitador.
   * El `\r` de un `\r\n` se conserva en la línea (el parser lo descarta en normalizeTag); las
   * líneas vacías (entre terminadores consecutivos) se omiten para no generar ingestas vacías.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf(this.delimiter)) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + this.delimiter.length);
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
