// Framing por línea de un stream de texto del lector (R5.3). PURO respecto de RN / Web Serial / I-O
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
//
// ── EL BUFFER TIENE TOPE (RBM2.19, HIGH-1 del Gate 2 del delta) ──────────────────────────
// El párrafo de arriba nombra "el buffer creciendo para siempre" y después NO lo acotaba. Mientras el
// único call site de producción fue `adapter-web-serial` (web, escritorio, detrás del gesto obligatorio
// de `requestPort()`) eso era teórico; `adapter-ble-gatt` es el primero NATIVO, sobre la RADIO y que
// AUTO-CONECTA sin gesto (RBM2.16), así que un peer que nunca cierra trama —el lector con el terminador
// equivocado, que es el disparador realista, o cualquier ESP32 a 10 m que se haga reconocer, porque en
// NUS no hay pairing ni cifrado (ADR-003)— acumulaba sin cota.
//
// El daño llegaba antes por CPU que por memoria: sin tope, cada notificación vuelve a APLANAR un buffer
// que crece (el `indexOf` necesita la cadena plana), así que el costo es cuadrático en el total. Medido
// con 25.000 notificaciones de 20 bytes: 4-6 ms con tope, 2200-2450 ms sin él. Y eso rompe el invariante
// DURO de la unidad —manual-first es ley (R7.2 / R9.6 / RBM9.5)—: todos los otros modos de falla degradan
// a "sin bastón, carga manual intacta"; éste se lleva el proceso, en la manga y sin señal.
//
// Las defensas que parecían cubrirlo NO lo cubrían, y por qué importa acá:
//   · el watchdog de mudez (`connected_silent`) miraba `lastDataAt`, que el adapter refrescaba con CADA
//     CHUNK: un chorro que no cierra trama lo dejaba en verde permanente. Se arregló del lado del adapter,
//     que ahora mide la salud con el reloj de la TRAMA CERRADA y nombra el caso nuevo aparte
//     (`ble_stream_unframed`), sin cambiarle el significado a `connected_silent` (RBM3.10 sigue siendo
//     "no llegó un byte");
//   · la sonda de liveness pregunta si el device está conectado, y el que inunda lo está;
//   · `isValidTag` / dedup / confirmación corren DESPUÉS del framer: a una línea que nunca se corta no
//     llegan nunca.
//
// La forma del arreglo es la de RBM1.4 —fail-closed con log, no silencio—: al pasarse el tope se DESCARTA
// lo acumulado y se emite `ble_framer_overflow`, un sub-evento de `read_loop_error` (la forma que ya usan
// `ble_decode_failed` / `ble_monitor_lost` / `ble_scan_error` en este transporte). Distinguible a
// propósito: NO es un `connected_silent` —ese dice lo contrario, que no llegan bytes— y no es un descarte
// mudo. Un `try/catch` o un truncado silencioso convertirían esto otra vez en "el operario no está
// bastoneando", que es la clase que esta unidad viene cerrando.

import { logTransportEvent } from './logging';

/**
 * Tope del buffer, en caracteres. La trama legítima más larga que conocemos es la del RS420: 1 byte de
 * STX + 7 de encabezado + 15 de EID + 12 de timestamp = 35 (`parser-rs420.ts`). 4096 es ~117 veces eso:
 * un múltiplo CHICO en términos de memoria (4 KB) y enorme en términos de trama, así que ningún lector
 * plausible lo toca y un chorro sin fin de trama lo cruza en ~200 notificaciones de 20 bytes.
 *
 * Ojo con la intuición de "cuánto puede acumular una ráfaga": el buffer NO guarda las tramas que ya se
 * cortaron (se emiten y se descartan en el mismo `push`), así que lo único que queda pendiente es el
 * PEDAZO de trama que todavía no cerró. Una ráfaga de 500 lecturas pegadas no mueve este número.
 */
export const LINE_FRAMER_MAX_BUFFER = 4096;

export class LineFramer {
  private buffer = '';
  private readonly delimiter: string;
  private readonly maxBuffer: number;
  /**
   * Se descartó un buffer por tope: del pedazo que sigue llegando NO conocemos el principio. La primera
   * línea que cierre después es un fragmento SIN CABEZA y no se emite.
   *
   * No es cosmético: emitirla sería entregarle al `frameParser` una trama recortada por un lugar
   * arbitrario. Para el RS420 de hoy eso termina en `null` (el regex está anclado con largos fijos),
   * pero el delta entero existe para que entren parsers de OTROS fabricantes (RBM1.1/RBM1.6), y un
   * parser que BUSQUE el EID en vez de anclarlo podría extraer uno que nadie leyó. Un EID inventado es
   * lo único verdaderamente inaceptable de este camino (RBM1.8).
   */
  private resyncing = false;

  /**
   * `delimiter` es el fin de trama DEL LECTOR (dato del `ReaderDriver`, no del transporte).
   * Default `'\n'` = el supuesto del RS420, que es el comportamiento previo a este delta.
   *
   * Un delimitador vacío dejaría a `indexOf('')` devolviendo 0 para siempre (bucle infinito
   * emitiendo líneas vacías), así que se cae al default: quién decide que un delimitador es
   * inaceptable es el adapter ANTES de conectar (`bleGattDelimiterIsSupported` → no abre la
   * conexión y lo loguea, RBM2.10). Acá solo hay que garantizar que el framer nunca cuelgue.
   *
   * `maxBufferChars` cae al default ante CUALQUIER valor que no sea un número finito >= 1 — y eso
   * incluye `0` y `Infinity`. Es a propósito: si un call site pudiera pedir "sin tope", el tope no sería
   * un invariante del framer sino una opción, y una opción se elige mal exactamente una vez.
   */
  constructor(delimiter: string = '\n', maxBufferChars: number = LINE_FRAMER_MAX_BUFFER) {
    this.delimiter = typeof delimiter === 'string' && delimiter.length > 0 ? delimiter : '\n';
    this.maxBuffer =
      typeof maxBufferChars === 'number' && Number.isFinite(maxBufferChars) && maxBufferChars >= 1
        ? Math.floor(maxBufferChars)
        : LINE_FRAMER_MAX_BUFFER;
  }

  /** Cuánto hay acumulado sin cerrar trama. Observable del invariante del tope (y diagnóstico). */
  get pending(): number {
    return this.buffer.length;
  }

  /**
   * Agrega un fragmento de texto y devuelve las líneas COMPLETAS cortadas por el delimitador.
   * El `\r` de un `\r\n` se conserva en la línea (el parser lo descarta en normalizeTag); las
   * líneas vacías (entre terminadores consecutivos) se omiten para no generar ingestas vacías.
   */
  push(chunk: string): string[] {
    if (typeof chunk !== 'string' || chunk.length === 0) return [];
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf(this.delimiter)) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + this.delimiter.length);
      if (this.resyncing) {
        this.resyncing = false; // fragmento sin cabeza (post-descarte): se tira, no se ingiere
        continue;
      }
      if (line.replace(/[\r\s]/g, '').length > 0) lines.push(line);
    }
    if (this.buffer.length > this.maxBuffer) {
      // FAIL-CLOSED CON LOG (RBM2.19): se descarta TODO lo acumulado —no se trunca a medias, que dejaría
      // pegada una cabeza vieja con una cola nueva— y se DICE. Se emite DESPUÉS de cortar las líneas de
      // este chunk: lo que sí cerró trama es bueno y se entrega igual.
      //
      // Sale como `read_loop_error` con el prefijo `ble_framer_overflow:`, que es la forma de SUB-EVENTO
      // POR MENSAJE que ya usa todo este transporte (`ble_decode_failed`, `ble_monitor_lost`,
      // `ble_scan_error`, `liveness_probe_unavailable`): una notificación que entra y se descarta es
      // exactamente la familia de `ble_decode_failed`. NO es un `connected_silent` —ese significa lo
      // contrario, que no llegan bytes— y no es un descarte mudo, que es lo único inaceptable.
      const discarded = this.buffer.length;
      this.buffer = '';
      this.resyncing = true;
      logTransportEvent({
        kind: 'read_loop_error',
        message: `ble_framer_overflow: descartados ${discarded} de tope ${this.maxBuffer}`,
      });
    }
    return lines;
  }

  /**
   * Devuelve y limpia lo que quede en el buffer sin terminador (al cerrar el puerto). Si venimos de un
   * descarte por tope, lo que queda es un fragmento SIN CABEZA → se descarta (mismo motivo que en
   * `push`: no se le entrega al parser una trama recortada por un lugar arbitrario).
   */
  flush(): string | null {
    const rest = this.buffer;
    const headless = this.resyncing;
    this.buffer = '';
    this.resyncing = false;
    if (headless) return null;
    return rest.replace(/[\r\s]/g, '').length > 0 ? rest : null;
  }

  reset(): void {
    this.buffer = '';
    this.resyncing = false;
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
