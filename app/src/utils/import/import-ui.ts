// Pure UI-side helpers for the rodeo bulk import wizard (spec 12, Fase 4 — T4.1..T4.5).
//
// No I/O, no react-native/expo/supabase imports: testeable con node:test (mismo patrón que
// import-write.ts / parse-csv.ts). The Fase-4 hook (useImportRodeo) consumes these to turn the
// parsed table + the column mapping into normalized rows, to assemble the validation/preview
// state, and to map every machine error reason to legible Spanish copy (R5.4 / nota de seguridad
// carry-forward: NUNCA renderizar sqlerrm/error.message crudo al operador — todo motivo pasa por
// acá y sale como texto entendible).

import {
  columnIndexFor,
  type ColumnMapping,
  type CensusField,
} from './column-mapping';
import { breedNameFromCode } from './breed-senasa';
import { normalizeRow, type NormalizedRow, type RawMappedRow } from './normalize-row';
import type { RowError, RowErrorReason, IntraDuplicateGroup } from './validate-rows';
import type { CandidateRow, ExistingDuplicateReason } from './import-write';
import type { SigsaRecord } from './parse-sigsa-txt';

/** The census fields the mapping step exposes, in display order (R4 — campos del censo). */
export const CENSUS_FIELDS: readonly CensusField[] = Object.freeze([
  'tag_electronic',
  'idv',
  'visual_id_alt',
  'sex',
  'birth_date',
  'breed',
  'category',
  'lote',
]);

/** Census fields that are REQUIRED for a row to be writable (≥1 identifier + sex, R5.1/R5.2). */
export const REQUIRED_CENSUS_FIELDS: readonly CensusField[] = Object.freeze(['sex']);
/** The identifier fields — at least one mapped is needed (ADR-005, R5.1). */
export const IDENTIFIER_FIELDS: readonly CensusField[] = Object.freeze([
  'tag_electronic',
  'idv',
  'visual_id_alt',
]);

/** Spanish label for each census field (UI — voseo, manga-friendly). */
const CENSUS_FIELD_LABELS: Readonly<Record<CensusField, string>> = Object.freeze({
  tag_electronic: 'Caravana electrónica',
  idv: 'Caravana visual (IDV)',
  visual_id_alt: 'Otro ID visual',
  sex: 'Sexo',
  birth_date: 'Fecha de nacimiento',
  breed: 'Raza',
  category: 'Categoría',
  lote: 'Lote',
});

/** Legible label for a census field (UI). */
export function censusFieldLabel(field: CensusField): string {
  return CENSUS_FIELD_LABELS[field];
}

/**
 * Whether the current mapping is enough to build a preview (R4.2/R5): at least one identifier
 * column AND the sex column must be mapped. The mapping step blocks "Continuar" until this is true.
 */
export function mappingIsComplete(mapping: ColumnMapping): boolean {
  const hasIdentifier = IDENTIFIER_FIELDS.some((f) => columnIndexFor(mapping, f) >= 0);
  const hasSex = columnIndexFor(mapping, 'sex') >= 0;
  return hasIdentifier && hasSex;
}

/**
 * Build a RawMappedRow (object keyed by census field) from a parsed string[] data row + the column
 * mapping. PURE. A cell index out of range / unmapped field → undefined (normalizeRow handles it).
 */
export function rowToRawMapped(cells: string[], mapping: ColumnMapping): RawMappedRow {
  const raw: RawMappedRow = {};
  for (const field of CENSUS_FIELDS) {
    const col = columnIndexFor(mapping, field);
    if (col < 0) continue;
    const value = cells[col];
    if (typeof value === 'string') {
      // We never assign empty undefined — normalizeRow treats '' as absent anyway.
      raw[field] = value;
    }
  }
  return raw;
}

/** Normalize a full CSV/Excel table (data rows) per the mapping → NormalizedRow[]. PURE. */
export function normalizeTableRows(rows: string[][], mapping: ColumnMapping): NormalizedRow[] {
  return rows.map((cells) => normalizeRow(rowToRawMapped(cells, mapping)));
}

/**
 * Map ONE parsed SIGSA record to a RawMappedRow (R6.2 — positional; RAZA code → readable name via
 * breed-senasa best-effort, fallback to code). PURE. A malformed record (error set) still maps its
 * best-effort fields; validate-rows decides if it's writable. The SIGSA TXT has no idv/visual/category
 * (R10.5 — the RPC sets the placeholder category by sex), so those stay undefined.
 */
export function sigsaRecordToRawMapped(record: SigsaRecord): RawMappedRow {
  const raw: RawMappedRow = {};
  if (record.rfid) raw.tag_electronic = record.rfid;
  if (record.sexRaw) raw.sex = record.sexRaw;
  if (record.breedCode) raw.breed = breedNameFromCode(record.breedCode);
  if (record.birthRaw) raw.birth_date = record.birthRaw;
  return raw;
}

/** Normalize the parsed SIGSA records → NormalizedRow[] (R6.2/R10.1). PURE. */
export function normalizeSigsaRows(records: SigsaRecord[]): NormalizedRow[] {
  return records.map((r) => normalizeRow(sigsaRecordToRawMapped(r)));
}

// ─── Error / duplicate reason → legible Spanish copy (R5.4, nota de seguridad #2) ────────────
//
// Every motivo that reaches the operator passes through here. We NEVER surface a raw sqlerrm /
// error.message: a write-time race error from the RPC (R8.4) carries a Postgres reason string; the
// preview/result UI shows a generic legible line for it instead of the raw detail.

const ROW_ERROR_COPY: Readonly<Record<RowErrorReason, string>> = Object.freeze({
  missing_identifier: 'Falta un identificador (caravana electrónica, IDV u otro ID visual).',
  missing_sex: 'Falta el sexo o no se entiende el valor.',
  field_over_cap: 'Un campo es demasiado largo.',
  invalid_field: 'Un dato de la fila no es válido.',
});

/** Legible copy for a per-row validation error (R5.4). PURE. */
export function rowErrorCopy(reasons: readonly RowErrorReason[]): string {
  // One line per distinct reason, deduped, in a stable order.
  const seen = new Set<RowErrorReason>();
  const lines: string[] = [];
  for (const r of reasons) {
    if (seen.has(r)) continue;
    seen.add(r);
    lines.push(ROW_ERROR_COPY[r] ?? 'Un dato de la fila no es válido.');
  }
  return lines.join(' ');
}

const EXISTING_DUP_COPY: Readonly<Record<ExistingDuplicateReason, string>> = Object.freeze({
  duplicate_idv_existing: 'Ya existe un animal con esa caravana visual (IDV) en este campo.',
  duplicate_tag_existing: 'Ya existe un animal con esa caravana electrónica.',
});

/** Legible copy for a row skipped by dedup against existing animals (R7.2/R7.4). PURE. */
export function existingDuplicateCopy(reason: ExistingDuplicateReason): string {
  return EXISTING_DUP_COPY[reason] ?? 'Ya existe un animal con ese identificador.';
}

/** Legible copy for an intra-file duplicate group (R7.1). PURE. */
export function intraDuplicateCopy(by: IntraDuplicateGroup['by']): string {
  return by === 'idv'
    ? 'Repetida en el archivo: misma caravana visual (IDV) en más de una fila.'
    : 'Repetida en el archivo: misma caravana electrónica en más de una fila.';
}

/**
 * Legible copy for a WRITE-TIME error from the RPC (R8.4 — carrera/unique server-side). The RPC
 * reason string is a Postgres detail (sqlerrm) which we MUST NOT show raw (nota de seguridad #2):
 * any of the known shapes maps to a clean line; anything else → a generic "no se pudo escribir".
 */
export function writeErrorCopy(reason: string): string {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('duplicate') || r.includes('unique') || r.includes('23505')) {
    return 'Ya existe un animal con ese identificador (se detectó al escribir).';
  }
  return 'No se pudo escribir esta fila.';
}

// ─── Preview model (lo arma el hook con validate-rows + dedup; lo renderiza el paso 3) ────────

/** One row in the preview list, with a legible label + status, capped for perf (R5.4). */
export type PreviewItem =
  | { index: number; status: 'valid'; label: string; categoryLabel: string | null }
  | { index: number; status: 'error'; label: string; reason: string }
  | { index: number; status: 'duplicate'; label: string; reason: string };

/** A short human label for a row in the preview list (its best identifier or "Fila N"). PURE. */
export function rowLabel(row: NormalizedRow, index: number): string {
  if (row.idv) return `IDV ${row.idv}`;
  if (row.visualIdAlt) return row.visualIdAlt;
  if (row.tagElectronic) return `TAG ${row.tagElectronic}`;
  return `Fila ${index + 1}`;
}

/** Max preview rows rendered (perf con miles de filas, R5.4: primeras N + "y N más"). */
export const PREVIEW_CAP = 50;

/**
 * Build the ordered, capped preview list from the validated rows + the dedup-against-existing result.
 * PURE. The hook passes the normalized rows + the validation result + the existing-dup skips; this
 * folds them into a single legible list (valids first, then errors, then duplicates) capped at
 * PREVIEW_CAP — the COUNTS are exact (computed elsewhere), only the rendered list is capped.
 */
export function buildPreviewItems(args: {
  rows: NormalizedRow[];
  validIndices: number[];
  errors: RowError[];
  intraDuplicates: IntraDuplicateGroup[];
  existingSkips: { index: number; reason: ExistingDuplicateReason }[];
  /** Resolved category label per row index (best-effort, optional — UI nicety). */
  categoryLabelByIndex?: Map<number, string>;
  cap?: number;
}): { items: PreviewItem[]; hiddenCount: number } {
  const cap = args.cap ?? PREVIEW_CAP;
  const items: PreviewItem[] = [];

  for (const index of args.validIndices) {
    const row = args.rows[index];
    items.push({
      index,
      status: 'valid',
      label: rowLabel(row, index),
      categoryLabel: args.categoryLabelByIndex?.get(index) ?? null,
    });
  }
  for (const e of args.errors) {
    items.push({
      index: e.index,
      status: 'error',
      label: rowLabel(e.row, e.index),
      reason: rowErrorCopy(e.reasons),
    });
  }
  // Intra-file duplicates: one preview entry per row in each group.
  for (const group of args.intraDuplicates) {
    for (const index of group.indices) {
      items.push({
        index,
        status: 'duplicate',
        label: rowLabel(args.rows[index], index),
        reason: intraDuplicateCopy(group.by),
      });
    }
  }
  for (const skip of args.existingSkips) {
    items.push({
      index: skip.index,
      status: 'duplicate',
      label: rowLabel(args.rows[skip.index], skip.index),
      reason: existingDuplicateCopy(skip.reason),
    });
  }

  const hiddenCount = Math.max(0, items.length - cap);
  return { items: items.slice(0, cap), hiddenCount };
}

/** Build the CandidateRow[] for the service from the valid row indices. PURE. */
export function toCandidates(rows: NormalizedRow[], validIndices: number[]): CandidateRow[] {
  return validIndices.map((index) => ({ index, row: rows[index] }));
}

/** Max chars shown in the preview category badge (defensive: the raw value is opaque, R3.5). */
export const CATEGORY_BADGE_MAX = 32;

/**
 * Build the per-valid-row category label map for the preview badge (nit del reviewer):
 * "lo que dice tu archivo" — el texto CRUDO de la columna de categoría que el operador mapeó
 * (ej. "Vaca"/"Vaquillona"), NO la categoría que resuelve el RPC server-side (R10.3, eso es
 * del server y depende del catálogo del sistema del rodeo). PURE.
 *
 * Solo se incluye una fila si: (a) es válida (índice en validIndices) y (b) trae un valor de
 * categoría no vacío (row.category — ya trimmeado por normalizeRow). SIGSA no trae categoría
 * (row.category siempre null) → sin badge, automático. Sin columna de categoría mapeada →
 * row.category null → sin badge. El valor se capa a CATEGORY_BADGE_MAX (defensa: es texto
 * opaco del archivo, R3.5; el badge solo lo muestra en un <Text>, sin sink).
 */
export function buildCategoryLabelByIndex(
  rows: NormalizedRow[],
  validIndices: number[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const index of validIndices) {
    const raw = rows[index]?.category;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    map.set(index, trimmed.length > CATEGORY_BADGE_MAX ? trimmed.slice(0, CATEGORY_BADGE_MAX) : trimmed);
  }
  return map;
}
