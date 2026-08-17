// Contrato de ingesta de EID (R1, R2, R3) — el corazón transport-agnóstico de la feature.
// Todo EID, venga del adaptador que venga, pasa por acá ANTES de tocar el motor
// find-or-create de spec 09 (R1.1). Vive en el contrato, no en cada adaptador (ADR-024 §1).
//
// Puro: sin RN, sin I/O, sin red (R14) → testeable con node:test. La confirmación VISUAL y
// el feedback SENSORIAL (vibración/beep) son efectos de la capa UI/provider (feedback.ts);
// este módulo expone el punto de confirmación pre-commit (R2) como un GATE que la UI llama,
// y nunca emite tag_read sin pasar por él.
//
// EL PARSER DE TRAMA ENTRA POR PARÁMETRO (RBM1.1/RBM1.2, delta ios-ble-mfi 2026-08-17) — este
// módulo NO importa ni invoca el parser de NINGÚN fabricante. Hasta esta fecha `ingestRawLine`
// llamaba `parseRs420Line` hardcodeado, y esa línea era la razón por la que un segundo driver **no
// podía existir**: cualquier transporte nuevo solo podía hablar con algo que emitiera tramas del
// RS420 (la deuda que el delta multivendor declaró bajo RMV5.2). Ahora el `frameParser` viene del
// `ReaderDriver` del adaptador que produjo la línea, y el fabricante vuelve a ser un DATO
// (`DRIVER_REGISTRY`) en vez de una dependencia del corazón del contrato (ADR-024 §1, RMV1.6).
//
// `isValidTag` / `normalizeTag` SE QUEDAN: son reglas DEL CONTRATO (EID = 15 dígitos ISO
// 11784/11785, normalización de bordes), no de un fabricante — se aplican a todo EID salga del
// frameParser que salga (RBM1.8). Que vivan en `parser-rs420.ts` es un accidente de dónde se
// escribieron primero, no una pertenencia: ver el guard de `frame-parser-resolve.test.ts`, que
// permite EXACTAMENTE esos dos nombres y prohíbe cualquier otro export de un `parser-*.ts`.
//
// Los streams (spp-android, web-serial, y los transportes nuevos) entran por ingestRawLine; los
// adaptadores que ya entregan el EID limpio (manual, mock, simulator) entran por ingestEid.

import type { BleStickEvent } from './stick-adapter';
import type { FrameParser } from './driver-types';
import { TagDedup } from './dedup';
import { isValidTag, normalizeTag } from './parser-rs420';

/**
 * Motivo por el que una entrada cruda se rechaza (para loguear, R1.4 / R15.1).
 *
 * `parse_failed` y `parser_threw` son DOS FALLAS DISTINTAS, con dos causas y dos acciones, y hasta el
 * review de F1 compartían bolsa (🟡-2):
 *   · `parse_failed` → el `frameParser` corrió bien y dijo "esta trama no es de mi formato". Causa
 *     probable: el LECTOR está mandando otra cosa (terminador, modo de salida, o directamente basura).
 *     Acción: mirar el aparato / su configuración.
 *   · `parser_threw` → el `parse` del driver TIRÓ (o no era invocable). Causa: el DRIVER —código
 *     nuestro o de un tercero— está roto. Acción: arreglar el driver; el lector puede estar perfecto.
 * Con un lector nuevo ésa es justamente la pregunta que importa ("¿el bastón manda basura o el driver
 * que escribimos está roto?"), y con un solo motivo los dos casos producían un log byte-idéntico.
 *
 * Un `parse` que devuelve `undefined` o un objeto sin `eid` se cuenta como `parse_failed` y no como
 * driver roto: caerse del final de una función sin `return` es la forma descuidada —y frecuente en
 * JS— de escribir "no match", y no hay forma de distinguirla de la intención. Un throw, en cambio,
 * nunca es "no match".
 */
export type RejectReason = 'parse_failed' | 'parser_threw' | 'invalid_eid' | 'empty';

/** Resultado de extraer un EID de una entrada cruda, antes de dedup/confirmación. */
export type IngestResult = { ok: true; eid: string } | { ok: false; reason: RejectReason };

/**
 * Extrae el EID de una LÍNEA CRUDA de un adaptador de stream (spp-android / web-serial / BLE).
 * Descarta el framing (byte de control, cabecera fija, timestamp del lector) con el `frameParser`
 * DEL DRIVER que produjo la línea (RBM1.1 — para el RS420 eso sigue siendo `parseRs420Line`, vía
 * `RS420_DRIVER.frameParser`: reuso, no reimplementación, R1.2/R11.4) y valida con `isValidTag`
 * (R1.3), que es del contrato y se aplica cualquiera sea el driver (RBM1.8).
 *
 * `frameParser` es un parámetro **REQUERIDO** a propósito (RBM1.2): un call site que se lo olvide
 * NO COMPILA. Es la misma familia de guard que `satisfies Record<AdapterKind, IngestMode>` — el
 * mecanismo se escribe sobre la AUSENCIA. Un default (p. ej. "si no me pasás nada, RS420") sería
 * exactamente el fallback silencioso que RBM1.4 prohíbe: produciría lecturas para un lector y
 * silencio total para todos los demás, indistinguible de "el operario no está bastoneando".
 *
 * Devuelve {ok:false} con el motivo en vez de tirar, para que el caller lo loguee sin
 * romper el flujo (R1.4, R15.1). Nunca tira — ni siquiera si el `frameParser` del driver tira:
 * un parser de un fabricante nuevo es código que no controlamos y no puede tumbar el read-loop
 * del transporte (un throw acá mataba la ingesta hasta reconectar). Ese caso se rechaza con su
 * motivo PROPIO (`parser_threw`), distinto del de una trama que el parser no entiende
 * (`parse_failed`): son dos causas y dos acciones distintas — ver `RejectReason`.
 */
export function ingestRawLine(line: string, frameParser: FrameParser): IngestResult {
  if (typeof line !== 'string' || normalizeTag(line).length === 0) {
    return { ok: false, reason: 'empty' };
  }
  let parsed: { eid: string } | null;
  try {
    parsed = frameParser.parse(line);
  } catch {
    // El parser del driver EXPLOTÓ (o `frameParser` no era invocable): el driver está roto, no la
    // trama. Motivo propio para que en el log no se lea igual que "el lector mandó basura" (🟡-2).
    return { ok: false, reason: 'parser_threw' };
  }
  if (parsed === null || parsed === undefined || typeof parsed.eid !== 'string') {
    return { ok: false, reason: 'parse_failed' };
  }
  if (!isValidTag(parsed.eid)) {
    return { ok: false, reason: 'invalid_eid' };
  }
  return { ok: true, eid: parsed.eid };
}

/**
 * Ingesta de un EID YA LIMPIO (adapter-manual: tipeo de IDV/visual/EID; adapter-mock:
 * inyección). NO pasa por parseRs420Line (no es una línea cruda del lector, R7.1). Aplica
 * isValidTag (R1.3): un tipeo que es un EID debe ser válido; uno que no lo es se rechaza
 * acá (la búsqueda por IDV/visual la maneja spec 09 por otra puerta, no este contrato de EID).
 *
 * Nota: el adapter-manual canaliza identificadores que SON EIDs por este contrato; los
 * identificadores no-EID (IDV/visual alfanumérico) los resuelve spec 09 directamente y no
 * pasan por la validación de 15 dígitos. Ver adapter-manual.ts.
 */
export function ingestEid(raw: string): IngestResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const eid = normalizeTag(raw);
  if (eid.length === 0) return { ok: false, reason: 'empty' };
  if (!isValidTag(eid)) return { ok: false, reason: 'invalid_eid' };
  return { ok: true, eid };
}

/**
 * Construye el BleStickEvent de tipo tag_read con la forma EXACTA de spec 09 (R1.6),
 * usando el TIMESTAMP DEL TELÉFONO (R1.5) — el del lector ya fue descartado por el parser.
 * `now` se inyecta (Date.now por defecto) para tests deterministas.
 */
export function buildTagReadEvent(eid: string, now: number = Date.now()): BleStickEvent {
  return { kind: 'tag_read', tag: eid, timestamp: now };
}

/** Construye el evento connection_changed con la forma de spec 09 (R9.4). */
export function buildConnectionEvent(connected: boolean): BleStickEvent {
  return { kind: 'connection_changed', connected };
}

/**
 * Motor de ingesta con estado: aplica dedup (R3) y el GATE de confirmación pre-commit (R2)
 * antes de emitir. Encapsula el TagDedup (una ventana por instancia → dos listeners no
 * comparten estado). Transport-agnóstico: lo usa el provider para los 5 adaptadores.
 *
 * Flujo de una lectura (R1→R3→R2):
 *   raw/eid → extract (parse+validate) → dedup.shouldEmit → [confirm gate] → tag_read
 *
 * El "confirm gate" (R2) es responsabilidad del consumidor: el contrato NO commitea por su
 * cuenta. processCandidate() devuelve el EID CANDIDATO (ya validado + des-duplicado) y es la
 * UI/overlay de spec 09 la que lo muestra (R2.1), dispara el feedback (R4) y, al confirmar
 * (R2.3), llama a commit() para producir el tag_read. Un descarte (R2.3) simplemente no
 * llama a commit → no se emite tag_read. Para asignación masiva (R2.5) la confirmación es
 * ligera/encadenable: cada EID distinto es un candidato independiente que no bloquea al
 * siguiente (la dedup por-TAG lo garantiza).
 */
export class EidIngestEngine {
  private readonly dedup: TagDedup;

  constructor(dedup: TagDedup = new TagDedup()) {
    this.dedup = dedup;
  }

  /**
   * Procesa una lectura cruda de un adaptador de STREAM, desframeándola con el `frameParser` del
   * driver de ESE adaptador (RBM1.1; lo resuelve `resolveFrameParser` en `adapter-selection.ts`).
   * Devuelve el EID candidato si pasa parse+validate+dedup, o null si debe descartarse (malformado
   * → loguear, R1.4; o re-escaneo dentro de la ventana → ignorar, R3.1). NO emite todavía: el
   * caller decide la confirmación (R2) y luego llama a commit().
   *
   * `frameParser` va ANTES de `now` y sin default: `now` es un detalle de test (reloj inyectable) y
   * el parser es parte del contrato de la llamada. Un call site que no lo pase no compila (RBM1.2).
   */
  processRawLine(
    line: string,
    frameParser: FrameParser,
    now: number = Date.now(),
  ): { eid: string } | { rejected: RejectReason } | null {
    const res = ingestRawLine(line, frameParser);
    if (!res.ok) return { rejected: res.reason };
    if (!this.dedup.shouldEmit(res.eid, now)) return null; // re-escaneo accidental (R3.1)
    return { eid: res.eid };
  }

  /**
   * Procesa un EID/identificador YA LIMPIO (manual/mock). Misma semántica que processRawLine
   * pero sin parseo de stream (R7.1).
   */
  processEid(raw: string, now: number = Date.now()): { eid: string } | { rejected: RejectReason } | null {
    const res = ingestEid(raw);
    if (!res.ok) return { rejected: res.reason };
    if (!this.dedup.shouldEmit(res.eid, now)) return null;
    return { eid: res.eid };
  }

  /**
   * Commit del EID candidato tras la confirmación visual (R2.3): produce el tag_read con
   * timestamp del teléfono (R1.5, R1.6). Llamarlo SOLO tras pasar el gate de confirmación;
   * un descarte no lo llama (no se emite). `now` inyectable para tests.
   */
  commit(eid: string, now: number = Date.now()): BleStickEvent {
    return buildTagReadEvent(eid, now);
  }

  reset(): void {
    this.dedup.reset();
  }
}
