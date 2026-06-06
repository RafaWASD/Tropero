// Lógica PURA del armado/escritura del import masivo de rodeo (spec 12, Fase 3 — T3.1..T3.5).
//
// SIN I/O, SIN imports de RN/expo/supabase: testeable con node:test (mismo patrón que
// utils/establishment.ts ↔ services/establishment-store.ts — la lógica pura vive acá, la I/O
// en services/import-rodeo.ts). Acá: merge del dedup contra existentes, resolución de category_code,
// normalización de lote, armado del p_rows (shape del header 0074), chunking, resumen/truncado del
// error_details (presupuesto del CHECK octet_length de 0073), guard de tamaño de archivo, escapeIlike.

import type { NormalizedRow } from './normalize-row';

// ─── Constantes de verdad (del as-built, NO inventadas) ──────────────────────────────

/** Tope de tamaño de archivo en bytes (R3.1 / design §3 — Puerta 1 D4 = 5 MB). Se rechaza ANTES de leer/parsear. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Filas por chunk del RPC. El RPC topa a 5000 filas/llamada (0074); chunkeamos MUY por debajo para
 * no mandar un payload gigante ni bloquear el hilo de UI (design §3.1). 150 es conservador.
 */
export const CHUNK_ROWS = 150;

/**
 * Tope DURO del `error_details` jsonb (R11.4/R11.5): CHECK `octet_length(error_details::text) ≤ 262144`
 * de 0073. Acotamos MUY por debajo (presupuesto de seguridad) para no chocar el CHECK ni siquiera con
 * miles de filas con error: si lo excede, el INSERT del log falla y se pierde el audit de la corrida.
 */
export const MAX_ERROR_DETAILS_BYTES = 200 * 1024;

/** Cuántas filas-de-error de ejemplo guardar en el sample del error_details (resumen + muestra). */
export const ERROR_SAMPLE_SIZE = 50;

/**
 * Tamaño de sub-lote para las queries de dedup `.in($array)` (T3.1). El dedup es EN LOTE (no por fila),
 * pero un `.in()` con miles de valores arma un query-string que puede exceder el límite de URL de un GET
 * de PostgREST. Partimos la lista de identificadores en sub-lotes de este tamaño → unas pocas queries
 * (no N por fila), URL-safe. 500 valores ≈ holgado bajo el límite de URL típico.
 */
export const DEDUP_IN_CHUNK = 500;

// ─── Tipos del contrato hacia el RPC (shape EXACTO del header de 0074) ────────────────

/**
 * Una fila del payload `p_rows` del RPC `import_rodeo_bulk` (contrato del header de 0074).
 * NO incluye establishment_id / created_by / imported_by / species_id / system_id / rodeo_id /
 * category_id: todo eso lo deriva/fuerza el RPC server-side. El cliente manda category_CODE (texto),
 * no el id resuelto (R10.3: el RPC resuelve el code contra el catálogo del system del rodeo).
 */
export type RpcRow = {
  row_index: number;
  sex: 'male' | 'female';
  tag_electronic: string | null;
  birth_date: string | null;
  idv: string | null;
  visual_id_alt: string | null;
  breed: string | null;
  /** code del catálogo del system del rodeo, o null → placeholder por sexo (R10.5). El RPC lo resuelve. */
  category_code: string | null;
  /** true si vino de una columna que matcheó (R10.3); el RPC lo fuerza a false si el code no matchea. */
  category_override: boolean;
  /** management_group_id ya resuelto por nombre por el cliente (R10.4), o null si no matcheó. */
  management_group_id: string | null;
};

/** Resultado que devuelve el RPC por chunk (header de 0074: imported_ok/imported_errors/errors). */
export type RpcChunkResult = {
  imported_ok: number;
  imported_errors: number;
  errors: { row_index: number; reason: string }[];
};

// ─── Tipos del flujo de dedup contra existentes (T3.1) ───────────────────────────────

/**
 * Una fila CANDIDATA a escribir (ya pasó validación + dedup intra-archivo de validate-rows.ts).
 * Lleva su `index` original (para reportar) + la `row` normalizada.
 */
export type CandidateRow = {
  /** índice 0-based de la fila en el archivo (para el reporte y el row_index del RPC). */
  index: number;
  row: NormalizedRow;
};

/** Por qué una fila candidata fue saltada en el dedup contra existentes (R7.2/R7.4). */
export type ExistingDuplicateReason = 'duplicate_idv_existing' | 'duplicate_tag_existing';

/** Una fila saltada por colisión contra un animal existente (skip + report, NUNCA update). */
export type ExistingDuplicate = {
  index: number;
  reason: ExistingDuplicateReason;
  /** El valor que colisionó (idv o tag), para el reporte del operador. */
  value: string;
};

/** El particionado tras el dedup contra existentes: las que quedan para escribir + las saltadas. */
export type DedupAgainstExistingResult = {
  /** Filas que sobreviven el dedup → se mandan al RPC. */
  toWrite: CandidateRow[];
  /** Filas saltadas por colisión contra un existente (R7.2/R7.4). */
  skipped: ExistingDuplicate[];
};

/** Una entrada de error de fila para el reporte/log (motivo legible + índice). */
export type RowErrorEntry = { index: number; reason: string };

/** El acumulado de una corrida de escritura a través de todos los chunks. */
export type WriteAccumulator = {
  imported_ok: number;
  imported_errors: number;
  /** Errores por-fila (carrera/unique server-side, R8.4) acumulados de los chunks. */
  errors: RowErrorEntry[];
};

/**
 * El error_details acotado que se inserta en import_log (R11.5). En vez del detalle exhaustivo
 * por-fila (que con miles de errores excede el CHECK octet_length de 0073 y haría FALLAR el insert
 * del log → se pierde el audit), guardamos resumen por motivo + sample acotado + total real + flag.
 */
export type ErrorDetailsSummary = {
  by_reason: Record<string, number>;
  sample: RowErrorEntry[];
  total_errors: number;
  truncated: boolean;
};

// ─── T3.5 — Guard de tamaño ANTES de leer/parsear (R3.1, nota del Gate 2 de utils) ───

export type SizeCheckResult = { ok: true } | { ok: false; message: string };

/**
 * Primera barrera del flujo (R3.1, CRÍTICO — nota del Gate 2 de utils): rechaza el archivo por
 * TAMAÑO en bytes ANTES de leer/parsear su contenido. Los utils puros NO se autoprotegen del
 * char-flood de una sola celda gigante; el cap de filas del parser no cubre un archivo de 1 fila
 * de 50 MB. Esta es la barrera real. PURA, testeable sin I/O.
 *
 * @param sizeBytes tamaño del archivo (lo da expo-document-picker / file-system, no se lee el contenido).
 */
export function checkFileSize(sizeBytes: number): SizeCheckResult {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return { ok: false, message: 'No se pudo determinar el tamaño del archivo.' };
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    const maxMb = (MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return {
      ok: false,
      message: `El archivo pesa ${mb} MB y supera el máximo de ${maxMb} MB. Dividilo en archivos más chicos e importá por partes.`,
    };
  }
  return { ok: true };
}

// PostgREST `ilike`/`or` usa `%`/`_` como comodines y `,` como separador de filtros. Espejo de F1-1 /
// escapeIlike de animals.ts: neutralizamos los metacaracteres de un valor del archivo (no confiable,
// R3.5) ANTES de usarlo en un filtro. En el service el dedup usa `= any($array)` parametrizado (no
// interpolación), así que el escape es defensa-en-profundidad por si un valor cae a un `.ilike()`/`.or()`.
export function escapeIlike(term: string): string {
  return term.replace(/[%_,]/g, ' ');
}

// ─── T3.2 — Resolución de category_code + normalización de lote (puro) ────────────────

/**
 * Resuelve el `category_code` que se manda al RPC a partir del texto crudo de la columna de categoría
 * (R10.3/R10.5). PURO. NO resuelve el category_id: eso lo hace el RPC server-side contra el catálogo
 * del system del rodeo destino (header 0074). Acá solo normalizamos el texto del archivo a un code
 * tentativo y decidimos el `category_override`:
 *   - texto presente → category_code (normalizado a minúsculas/sin tilde/espacios→_) con override=true
 *     (vino declarado). El RPC lo matchea; si NO matchea, el RPC fuerza override=false + placeholder
 *     por sexo (R10.5) — el cliente no necesita saberlo.
 *   - sin texto → category_code=null + override=false → el RPC usa el placeholder por sexo (R10.5).
 */
export function resolveCategory(
  categoryRaw: string | null,
): { categoryCode: string | null; categoryOverride: boolean } {
  const norm = normalizeCategoryText(categoryRaw);
  if (norm === null) return { categoryCode: null, categoryOverride: false };
  return { categoryCode: norm, categoryOverride: true };
}

/** Normaliza el texto de categoría a un candidato de `code` (minúsculas, sin tilde, espacios→_). PURO. */
function normalizeCategoryText(raw: string | null): string | null {
  if (raw == null) return null;
  const v = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_');
  return v.length === 0 ? null : v;
}

/**
 * Normaliza un nombre de lote para el match contra management_groups (R10.4): trim + lowercase + sin
 * tilde + colapsa espacios. PURO. El match es por NOMBRE (no se crea el lote — default Gate 0).
 */
export function normalizeLoteName(raw: string | null): string | null {
  if (raw == null) return null;
  const v = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  return v.length === 0 ? null : v;
}

// ─── T3.3 — Armado del p_rows (PURO) ────────────────────────────────────────────────

/**
 * Arma UNA fila del payload `p_rows` del RPC desde una fila candidata (shape EXACTO del header 0074).
 * PURO. `loteId` ya viene resuelto por el caller (match por nombre contra management_groups, T3.2 I/O).
 * NO incluye establishment_id / created_by / imported_by / species_id / system_id / category_id — los
 * fuerza/deriva el RPC. El `sex` ya es 'male'|'female' (validate-rows garantizó que no es null para una
 * candidata; igual hacemos un fallback defensivo a 'female' que el RPC volvería a CHECK-ear).
 */
export function buildRpcRow(candidate: CandidateRow, loteId: string | null): RpcRow {
  const { index, row } = candidate;
  const { categoryCode, categoryOverride } = resolveCategory(row.category);
  return {
    row_index: index,
    sex: row.sex ?? 'female',
    tag_electronic: row.tagElectronic,
    birth_date: row.birthDate,
    idv: row.idv,
    visual_id_alt: row.visualIdAlt,
    breed: row.breed,
    category_code: categoryCode,
    category_override: categoryOverride,
    management_group_id: loteId,
  };
}

/** Parte un array de filas en chunks de a lo sumo `size` (≤ tope del RPC). PURO. */
export function chunkRows<T>(rows: T[], size = CHUNK_ROWS): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

// ─── T3.1 — Merge de los resultados de dedup contra existentes (PURO) ────────────────

/**
 * Dado el set de filas candidatas + los conjuntos de idv/tag que YA existen (resultado de las 2
 * queries en lote de T3.1), particiona en `toWrite` (sobreviven) y `skipped` (colisión contra un
 * existente, R7.2/R7.4). PURO (la I/O — traer los sets — la hace el caller). Una fila cuyo idv O tag
 * matchea un existente se saltea (skip + report, NUNCA update; TAG no reusable R7.4). Si una fila
 * colisiona por ambos, se reporta una sola vez (prioridad: tag, por la regla SENASA de no reusar TAG).
 */
export function mergeDedupAgainstExisting(
  candidates: CandidateRow[],
  existingIdvs: ReadonlySet<string>,
  existingTags: ReadonlySet<string>,
): DedupAgainstExistingResult {
  const toWrite: CandidateRow[] = [];
  const skipped: ExistingDuplicate[] = [];

  for (const c of candidates) {
    const tag = c.row.tagElectronic;
    const idv = c.row.idv;
    if (tag && existingTags.has(tag)) {
      skipped.push({ index: c.index, reason: 'duplicate_tag_existing', value: tag });
      continue;
    }
    if (idv && existingIdvs.has(idv)) {
      skipped.push({ index: c.index, reason: 'duplicate_idv_existing', value: idv });
      continue;
    }
    toWrite.push(c);
  }

  return { toWrite, skipped };
}

/** dedup + filtra vacíos de un array de strings nullable. PURO (para la query `= any($array)`). */
export function uniqueNonEmpty(values: (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const v of values) {
    if (v && v.length > 0) seen.add(v);
  }
  return [...seen];
}

// ─── T3.3/T3.4 — Acumulado de conteos a través de los chunks (PURO) ──────────────────

/** Funde el resultado de un chunk del RPC en el acumulado. PURO (no muta el input — devuelve uno nuevo). */
export function accumulateChunk(acc: WriteAccumulator, chunk: RpcChunkResult): WriteAccumulator {
  return {
    imported_ok: acc.imported_ok + chunk.imported_ok,
    imported_errors: acc.imported_errors + chunk.imported_errors,
    errors: acc.errors.concat(
      (chunk.errors ?? []).map((e) => ({ index: e.row_index, reason: e.reason })),
    ),
  };
}

// ─── T3.4 — Resumen / truncado del error_details (PURO, R11.5 / CHECK 256KB) ─────────

/**
 * Construye el error_details ACOTADO (R11.5) y GARANTIZA que su serialización no supere
 * MAX_ERROR_DETAILS_BYTES (presupuesto bajo el CHECK octet_length de 0073). PURO.
 *
 * Estrategia: resumen por motivo (siempre completo, es barato) + un sample de las primeras N filas.
 * Si aun así el JSON serializado excede el presupuesto (motivos con strings de sqlerrm largos), se
 * recorta el sample iterativamente y, en última instancia, también by_reason — NUNCA se devuelve algo
 * que choque el CHECK (eso abortaría el insert del log y perdería el audit de la corrida).
 */
export function summarizeErrorDetails(
  errors: RowErrorEntry[],
  opts: { sampleSize?: number; maxBytes?: number } = {},
): ErrorDetailsSummary {
  const sampleSize = opts.sampleSize ?? ERROR_SAMPLE_SIZE;
  const maxBytes = opts.maxBytes ?? MAX_ERROR_DETAILS_BYTES;

  const by_reason: Record<string, number> = {};
  for (const e of errors) {
    const key = e.reason || 'unknown';
    by_reason[key] = (by_reason[key] ?? 0) + 1;
  }

  const total_errors = errors.length;
  let sample = errors.slice(0, sampleSize);
  let truncated = total_errors > sample.length;

  const fits = (s: RowErrorEntry[], t: boolean): boolean =>
    byteLengthUtf8(JSON.stringify({ by_reason, sample: s, total_errors, truncated: t })) <= maxBytes;

  if (!fits(sample, truncated)) {
    truncated = true;
    while (sample.length > 0 && !fits(sample, truncated)) {
      sample = sample.slice(0, Math.floor(sample.length / 2));
    }
    if (!fits(sample, truncated)) {
      const trimmedByReason = capByReason(by_reason, maxBytes, total_errors);
      return { by_reason: trimmedByReason, sample: [], total_errors, truncated: true };
    }
  }

  return { by_reason, sample, total_errors, truncated };
}

/**
 * Recorta `by_reason` a los motivos más frecuentes hasta que el JSON entre en maxBytes. PURO.
 * Garantiza un objeto que serializado (con sample vacío) no supera el presupuesto. Último recurso.
 */
function capByReason(
  byReason: Record<string, number>,
  maxBytes: number,
  totalErrors: number,
): Record<string, number> {
  const entries = Object.entries(byReason).sort((a, b) => b[1] - a[1]);
  let kept = entries;
  const fits = (e: [string, number][]): boolean => {
    const obj = Object.fromEntries(e);
    return (
      byteLengthUtf8(
        JSON.stringify({ by_reason: obj, sample: [], total_errors: totalErrors, truncated: true }),
      ) <= maxBytes
    );
  };
  while (kept.length > 0 && !fits(kept)) {
    kept = kept.slice(0, Math.max(0, Math.floor(kept.length / 2)));
  }
  return Object.fromEntries(kept);
}

/**
 * Longitud en bytes UTF-8 de un string (para presupuestar contra el CHECK octet_length de Postgres).
 * TextEncoder existe en RN (Hermes), web y Node — sin dependencia. Fallback portable (sin Buffer, que
 * no está tipado en el contexto RN/web) vía encodeURIComponent por si TextEncoder no estuviera.
 */
export function byteLengthUtf8(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, '_').length;
}
