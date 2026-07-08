// Column auto-detection + manual mapping for the CSV/Excel import (spec 12, T1.7 / R4.1, R4.2).
//
// Pure, no I/O. Maps each spreadsheet header to a census field of the import, by name
// matching. The operator can then ADJUST the mapping manually (including leaving a
// column unmapped). Runs under node:test.
//
// ⚠️ DISCLAIMER — SINÓNIMOS TENTATIVOS (R4.1 / spec §Historial de refinamiento): the real
// shape of the producer's spreadsheet (which columns it actually carries) is UNVALIDATED
// — there is no real beta file yet and it hasn't been reviewed with Facundo. The synonym
// list below is a best-effort guess (mirrors the tentativity pattern of spec 02 R14 / spec
// 09 UI). It WILL be tuned when a real file shows up; the manual override (R4.2) is the
// safety net so the operator is never blocked by a wrong auto-detection.
//
// All matching is on the header TEXT, treated as opaque (R3.5): normalized (lowercase,
// accent-stripped, punctuation→space) and matched against the synonym table. We never
// match by cell CONTENT here — only the header label.

/** The census fields an imported column can map to (design §1.1 / R4.1). delta IDU: `visual_id_alt` removido. */
export type CensusField =
  | 'tag_electronic'
  | 'idv'
  | 'sex'
  | 'birth_date'
  | 'breed'
  | 'category'
  | 'lote';

/** A column→field mapping. `null` means the column is intentionally unmapped. */
export type ColumnMapping = (CensusField | null)[];

/**
 * Synonyms per census field (normalized form: lowercase, no accents). TENTATIVE — see
 * the disclaimer above. Order matters only for documentation; matching is set-membership.
 * We deliberately keep these SPECIFIC to avoid greedy false-positives (e.g. a bare
 * "numero" is too ambiguous → left unmapped so the operator decides).
 */
const SYNONYMS: Readonly<Record<CensusField, readonly string[]>> = Object.freeze({
  // Electronic RFID / EID tag.
  tag_electronic: [
    'tag',
    'tag electronico',
    'rfid',
    'eid',
    'caravana electronica',
    'chip',
    'dispositivo',
    'identificacion electronica',
  ],
  // Caravana visual (idv), alfanumérica (CUIG/binomio). delta IDU: absorbe los sinónimos "visuales" (el
  // 4to campo visual_id_alt se eliminó); un header "identificación visual"/"seña" mapea al idv.
  idv: [
    'idv',
    'caravana',
    'caravana visual',
    'numero de caravana',
    'nro caravana',
    'div',
    'identificacion visual',
    'id visual',
  ],
  sex: ['sexo', 'sex', 'genero', 'macho hembra', 'm h'],
  birth_date: [
    'fecha de nacimiento',
    'fecha nacimiento',
    'nacimiento',
    'fec nac',
    'fnac',
    'birth date',
    'nac',
  ],
  breed: ['raza', 'breed', 'raza senasa'],
  category: ['categoria', 'category', 'cat'],
  lote: ['lote', 'grupo', 'grupo de manejo', 'potrero', 'tropa', 'management group'],
});

/**
 * Normalize a header label for matching: lowercase, strip accents/diacritics, collapse
 * any run of non-alphanumeric chars to a single space, trim. Opaque text (R3.5).
 */
export function normalizeHeader(header: string): string {
  if (typeof header !== 'string') return '';
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Reverse index normalized-synonym → field, built once. */
const SYNONYM_INDEX: ReadonlyMap<string, CensusField> = (() => {
  const m = new Map<string, CensusField>();
  for (const field of Object.keys(SYNONYMS) as CensusField[]) {
    for (const syn of SYNONYMS[field]) {
      const norm = normalizeHeader(syn);
      // First field to claim a synonym wins; we keep the synonym lists disjoint so this
      // never silently shadows (verified by a test).
      if (!m.has(norm)) m.set(norm, field);
    }
  }
  return m;
})();

/**
 * Auto-detect a tentative field for a single header (R4.1). Returns `null` when the
 * header doesn't confidently match exactly one census field — the operator then decides
 * (R4.2). Matching is exact-on-normalized-text: a header normalizes to a known synonym,
 * or it stays unmapped. We do NOT do fuzzy/substring matching, which would create greedy
 * false-positives on ambiguous headers (the whole point of the manual override).
 */
export function detectField(header: string): CensusField | null {
  const norm = normalizeHeader(header);
  if (norm.length === 0) return null;
  return SYNONYM_INDEX.get(norm) ?? null;
}

/**
 * Auto-detect the full mapping for a header row (R4.1). One entry per header, `null`
 * where undetected. If two headers map to the SAME field, only the FIRST keeps it and the
 * later one is left unmapped (a census field is single-source) — the operator resolves the
 * collision manually (R4.2). Ambiguous → null (the operator decides).
 */
export function autoDetectMapping(headers: string[]): ColumnMapping {
  if (!Array.isArray(headers)) return [];
  const used = new Set<CensusField>();
  return headers.map((h) => {
    const field = detectField(h);
    if (field === null) return null;
    if (used.has(field)) return null; // a later duplicate column for the same field → unmapped
    used.add(field);
    return field;
  });
}

/**
 * Apply a manual override on top of a base mapping (R4.2): set column `columnIndex` to
 * `field` (or `null` to unmap). If `field` was already assigned to ANOTHER column, that
 * other column is cleared first (a census field maps from exactly one column). Returns a
 * NEW array (pure — never mutates the input). Out-of-range index → returns a copy unchanged.
 */
export function applyMappingOverride(
  base: ColumnMapping,
  columnIndex: number,
  field: CensusField | null,
): ColumnMapping {
  const next = [...base];
  if (columnIndex < 0 || columnIndex >= next.length) return next;
  if (field !== null) {
    // Enforce single-source: clear any other column currently holding this field.
    for (let i = 0; i < next.length; i++) {
      if (i !== columnIndex && next[i] === field) next[i] = null;
    }
  }
  next[columnIndex] = field;
  return next;
}

/**
 * The index of the column mapped to a given census field, or -1 if unmapped. Convenience
 * for the row normalizer (it reads each field by its column index).
 */
export function columnIndexFor(mapping: ColumnMapping, field: CensusField): number {
  return mapping.indexOf(field);
}
