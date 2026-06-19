// upload-rejections.ts — store observable de RECHAZOS PERMANENTES de upload + motivo es-AR (spec 03 R10.8).
//
// POR QUÉ EXISTE: cuando una maniobra cargada OFFLINE se sincroniza y el server la RECHAZA de forma
// PERMANENTE (gating capa 2 `23514`, tenant-check del `session_id`, RLS `42501`), `connector.uploadData`
// DESCARTA esa op para no bloquear el resto de la cola (R3.5/R8.1) — si no, un dead-letter envenenado
// trabaría TODA la sync. El problema (R10.8): hoy ese descarte solo hace `console.warn` → el dato de
// campo se pierde EN SILENCIO y el operario nunca se entera. Este store MATERIALIZA ese canal: el
// connector registra cada rechazo acá (best-effort), y la UI de manga lo lee y lo muestra para que el
// operario sepa qué pasó y pueda rehacer la maniobra en su próxima jornada (el re-hacer es manual; el
// motivo le dice por qué).
//
// PRIVACIDAD (regla dura): NUNCA se guarda `opData` (trae datos de campo). Solo `table`/`op`/`code`/`id`/`at`
// — exactamente lo que el connector ya consideraba seguro loguear. Lo mismo que documenta `connector.ts`:
// "NUNCA se loguea opData".
//
// El store es in-memory (no persiste a disco): un rechazo es un aviso de la sesión en curso; tras
// "Entendido" se descarta. Lista ACOTADA (cap 50) + DEDUP por id de op (un mismo op_id no se duplica si el
// drenado reintenta y vuelve a rechazar la misma op). Observable vía useSyncExternalStore (sin deps; mismo
// idioma que un store externo del repo). El helper de motivo es PURO (testeable sin React/SDK).

import { useSyncExternalStore } from 'react';
import type { CrudEntry } from '@powersync/common';

// ─── Las tablas de evento de MANIOBRA (R5.4) ───────────────────────────────────────────────────
//
// Un rechazo de upload puede venir de CUALQUIER tabla sincronizada (animal_profiles, rodeos, etc.). La UI
// de manga (R10.8) SOLO muestra los rechazos de MANIOBRA — los eventos que el operario cargó en una jornada
// (un rechazo de otra tabla no es de maniobra → lo maneja el surfacing genérico de su feature, no este).
// El TIPO de maniobra (es-AR) sale de la tabla de destino (R5.4: maniobra → tabla de evento).
// spec 03 M6 (M6-SEC-01): scrotal_measurements es tabla de evento de maniobra (CE) → un rechazo PERMANENTE
// de su sync (gating capa 2 23514 / RLS 42501) debe ser VISIBLE en el banner/sheet de manga, no morir en
// silencio. Cierra el loop capa1↔capa2↔surfacing del Gate 1.
const MANEUVER_TABLE_LABELS: Record<string, string> = {
  weight_events: 'Pesaje',
  sanitary_events: 'Vacuna/sanitaria',
  reproductive_events: 'Tacto/servicio',
  lab_samples: 'Muestra de laboratorio',
  condition_score_events: 'Condición corporal',
  scrotal_measurements: 'Circunferencia escrotal',
};

/**
 * Título es-AR del banner/sheet de rechazos (R10.8), con número + pluralización CORRECTA del sustantivo Y
 * del verbo: 1 → "1 maniobra no se sincronizó"; N → "N maniobras no se sincronizaron". PURO.
 */
export function rejectionBannerTitle(count: number): string {
  const n = Math.max(0, Math.trunc(count));
  if (n === 1) return '1 maniobra no se sincronizó';
  return `${n} maniobras no se sincronizaron`;
}

/** ¿La tabla rechazada es una de las 5 tablas de evento de maniobra? (filtro de la UI de manga, R10.8). */
export function isManeuverRejection(table: string | undefined | null): boolean {
  return table != null && Object.prototype.hasOwnProperty.call(MANEUVER_TABLE_LABELS, table);
}

/** Tipo de maniobra es-AR a partir de la tabla de destino (R5.4). Fallback genérico si no es de maniobra. */
export function maneuverRejectionTypeLabel(table: string | undefined | null): string {
  if (table != null && MANEUVER_TABLE_LABELS[table]) return MANEUVER_TABLE_LABELS[table];
  return 'Maniobra';
}

/**
 * Motivo es-AR de un rechazo PERMANENTE, a partir de la tabla y el `errcode` de Postgres (R10.8). PURO.
 *   - `23514` (CHECK del trigger de gating capa 2 / tenant-check del session_id): el rodeo dejó de
 *     habilitar la maniobra, o el animal cambió de rodeo/campo, mientras no había señal.
 *   - `42501` (RLS / insufficient_privilege): no hay permiso para guardar en ese campo.
 *   - cualquier otro: rechazo genérico del servidor.
 * Se antepone el TIPO de maniobra (de la tabla) para que el operario ubique cuál fue.
 */
export function rejectionReason(table: string | undefined | null, code: string | undefined | null): string {
  const tipo = maneuverRejectionTypeLabel(table);
  let motivo: string;
  switch (code) {
    case '23514':
      motivo = 'El rodeo dejó de habilitar esa maniobra, o el animal cambió de rodeo/campo, mientras no había señal.';
      break;
    case '42501':
      motivo = 'No tenés permiso para guardar esto en este campo.';
      break;
    default:
      motivo = 'El servidor rechazó la carga.';
      break;
  }
  return `${tipo}: ${motivo}`;
}

/**
 * Etiqueta es-AR de CUÁNDO se registró el rechazo (R10.8 "cuándo"), relativa al momento actual. PURA.
 * `at`/`now` en ms (Date.now()). El operario quiere ubicar el rechazo en el tiempo, no la hora exacta:
 *   - < 1 min  → "recién"
 *   - < 60 min → "hace N min"
 *   - < 24 h   → "hace N h"
 *   - ≥ 24 h   → la fecha corta es-AR "dd/mm" (mismo formato determinístico que maniobra-resume).
 * Tolerante: `at` futuro o inválido → "recién" (no rompe; no es dato crítico).
 */
export function rejectionWhenLabel(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at)) return 'recién';
  const diffMs = now - at;
  if (diffMs < 60_000) return 'recién';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const d = new Date(at);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

// ─── El modelo del rechazo guardado ────────────────────────────────────────────────────────────

/** Un rechazo permanente de upload, SIN datos de campo (privacidad: nada de opData). */
export type UploadRejection = {
  /** id de la op rechazada (= id de la fila local). Clave de dedup + de acknowledge. */
  id: string;
  /** Tabla de destino del INSERT/UPDATE rechazado (define el tipo de maniobra). */
  table: string;
  /** Tipo de op de PowerSync (PUT/PATCH/DELETE), como string. Solo diagnóstico. */
  op: string;
  /** errcode de Postgres del rechazo (`23514`/`42501`/…), o undefined si no vino. */
  code: string | undefined;
  /** Cuándo se registró (Date.now()). */
  at: number;
};

/** Tope de rechazos guardados: los más viejos se descartan (no crece infinito). */
export const MAX_UPLOAD_REJECTIONS = 50;

// ─── Store in-memory observable (useSyncExternalStore) ─────────────────────────────────────────

let rejections: readonly UploadRejection[] = Object.freeze([]);
const listeners = new Set<() => void>();

function emit(): void {
  // Copia defensiva del Set por si un listener se desuscribe durante la iteración.
  for (const l of Array.from(listeners)) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly UploadRejection[] {
  return rejections;
}

/**
 * Registra un rechazo PERMANENTE de upload (lo llama `connector.surfaceUploadRejection`). BEST-EFFORT:
 * NUNCA tira (el connector ya lo envuelve, pero acá también blindamos) — el drenado de la cola no se
 * puede romper por el store. NO guarda `opData`. DEDUP por id (si la misma op se reintenta y re-rechaza,
 * actualiza el registro existente, no lo duplica). Acota a MAX_UPLOAD_REJECTIONS (descarta los más viejos).
 * Si la op no tiene id (caso patológico, lastOp null), no registra nada (no hay clave de dedup/ack).
 */
export function recordUploadRejection(op: CrudEntry | null, error: unknown): void {
  try {
    const id = op?.id;
    if (typeof id !== 'string' || id.length === 0) return;
    const table = typeof op?.table === 'string' ? op.table : '';
    const opType = op?.op != null ? String(op.op) : '';
    const rawCode = (error as { code?: unknown } | null | undefined)?.code;
    const code = typeof rawCode === 'string' ? rawCode : undefined;
    const entry: UploadRejection = { id, table, op: opType, code, at: Date.now() };

    // DEDUP por id: si ya existe un rechazo de esta op, lo reemplazamos por el nuevo (mismo lugar relativo
    // no importa — se reordena al final como el más reciente). Si no, lo agregamos.
    const without = rejections.filter((r) => r.id !== id);
    let next = [...without, entry];
    // Cap: si excede, descartamos los MÁS VIEJOS (el head del array; insertamos al final).
    if (next.length > MAX_UPLOAD_REJECTIONS) {
      next = next.slice(next.length - MAX_UPLOAD_REJECTIONS);
    }
    rejections = Object.freeze(next);
    emit();
  } catch {
    /* noop: el store NUNCA rompe el drenado de la upload queue (R10.8 best-effort). */
  }
}

/**
 * Descarta (marca como visto) algunos rechazos por id, o TODOS si no se pasan ids (el "Entendido" de la
 * UI). No-op si nada cambió (no emite). Idempotente.
 */
export function acknowledgeUploadRejections(ids?: readonly string[]): void {
  if (rejections.length === 0) return;
  if (ids == null) {
    rejections = Object.freeze([]);
    emit();
    return;
  }
  const drop = new Set(ids);
  const next = rejections.filter((r) => !drop.has(r.id));
  if (next.length === rejections.length) return; // nada cambió
  rejections = Object.freeze(next);
  emit();
}

/** Limpia TODOS los rechazos (alias semántico de acknowledge sin ids). */
export function clearUploadRejections(): void {
  acknowledgeUploadRejections();
}

/** SOLO PARA TESTS: snapshot directo sin React. */
export function _getUploadRejectionsForTest(): readonly UploadRejection[] {
  return rejections;
}

/** Hook: lista actual de rechazos (re-render al cambiar). La UI filtra a maniobra con isManeuverRejection. */
export function useUploadRejections(): readonly UploadRejection[] {
  // getServerSnapshot = getSnapshot: no hay SSR diferente; el snapshot es estable entre cambios.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
