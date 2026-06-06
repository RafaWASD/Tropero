// Contrato de ingesta de EID (R1, R2, R3) — el corazón transport-agnóstico de la feature.
// Todo EID, venga del adaptador que venga, pasa por acá ANTES de tocar el motor
// find-or-create de spec 09 (R1.1). Vive en el contrato, no en cada adaptador (ADR-024 §1).
//
// Puro: sin RN, sin I/O, sin red (R14) → testeable con node:test. La confirmación VISUAL y
// el feedback SENSORIAL (vibración/beep) son efectos de la capa UI/provider (feedback.ts);
// este módulo expone el punto de confirmación pre-commit (R2) como un GATE que la UI llama,
// y nunca emite tag_read sin pasar por él.
//
// Reuso OBLIGATORIO de parser-rs420.ts (commit 9126dba) — NO se reimplementa el parseo
// (R1.2, R11.4). Los streams (spp-android, web-serial) entran por ingestRawLine; los
// adaptadores que ya entregan el EID limpio (manual, mock) entran por ingestEid.

import type { BleStickEvent } from './stick-adapter';
import { TagDedup } from './dedup';
import { parseRs420Line, isValidTag, normalizeTag } from './parser-rs420';

/** Motivo por el que una entrada cruda se rechaza (para loguear, R1.4 / R15.1). */
export type RejectReason = 'parse_failed' | 'invalid_eid' | 'empty';

/** Resultado de extraer un EID de una entrada cruda, antes de dedup/confirmación. */
export type IngestResult = { ok: true; eid: string } | { ok: false; reason: RejectReason };

/**
 * Extrae el EID de una LÍNEA CRUDA de un adaptador de stream (spp-android / web-serial).
 * Descarta el framing (byte de control, cabecera fija 1000000, timestamp del lector)
 * reusando parseRs420Line (R1.2) y valida con isValidTag (R1.3). NO reimplementa el parseo.
 *
 * Devuelve {ok:false} con el motivo en vez de tirar, para que el caller lo loguee sin
 * romper el flujo (R1.4, R15.1). Nunca tira.
 */
export function ingestRawLine(line: string): IngestResult {
  if (typeof line !== 'string' || normalizeTag(line).length === 0) {
    return { ok: false, reason: 'empty' };
  }
  const parsed = parseRs420Line(line);
  if (parsed === null) {
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
   * Procesa una lectura cruda de un adaptador de STREAM. Devuelve el EID candidato si pasa
   * parse+validate+dedup, o null si debe descartarse (malformado → loguear, R1.4; o
   * re-escaneo dentro de la ventana → ignorar, R3.1). NO emite todavía: el caller decide la
   * confirmación (R2) y luego llama a commit().
   */
  processRawLine(line: string, now: number = Date.now()): { eid: string } | { rejected: RejectReason } | null {
    const res = ingestRawLine(line);
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
