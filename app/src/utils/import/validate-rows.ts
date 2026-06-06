// Per-row validity + intra-file dedup for the rodeo import (spec 12, T1.11 / R5.1, R5.2, R7.1).
//
// Pure, no I/O (dedup AGAINST EXISTING animals is in the service, R7.2 — not here). Takes
// the normalized rows and partitions them into valid / errors (by reason) / intra-file
// duplicates. Runs under node:test.
//
// Rules:
//   R5.1 — every row must resolve at least one non-empty identifier: a valid tag_electronic
//          (already validated by normalize-row R4.5), idv, or visual_id_alt (ADR-005). A row
//          with none is an error "a completar".
//   R5.2 — sex must be present AND mappable to male/female (normalize-row already set it to
//          null when unmappable). Missing/unmappable sex is an error.
//   R3.4 — a field-over-cap issue carried from normalization makes the row an error.
//   R7.1 — intra-file dedup: two or more rows sharing the same non-empty idv, OR the same
//          valid tag_electronic, are ALL flagged as a conflict "a completar" (none is written
//          without the operator resolving it). NOTE: dedup is computed only over rows that are
//          otherwise valid — an already-errored row isn't double-reported as a duplicate.

import type { NormalizedRow } from './normalize-row';

/** Why a row can't be written. */
export type RowErrorReason =
  | 'missing_identifier' // R5.1 — ningún identificador (a completar)
  | 'missing_sex' // R5.2 — sin sexo o sexo no mapeable
  | 'field_over_cap' // R3.4 — algún campo excede su tope server-side
  | 'invalid_field'; // otra issue de campo (ej. TAG inválido sin otro id ya cubierto por missing_identifier)

/** A row that can't be written, with its reason(s) and original index. */
export type RowError = {
  /** 0-based index of the row within the parsed data rows (for the operator's report). */
  index: number;
  reasons: RowErrorReason[];
  /** Human-readable detail per issue (from normalization + these rules). */
  details: string[];
  row: NormalizedRow;
};

/** A group of rows colliding on the same identifier within the file (R7.1). */
export type IntraDuplicateGroup = {
  /** 'idv' | 'tag_electronic' — which identifier collided. */
  by: 'idv' | 'tag_electronic';
  /** The colliding identifier value. */
  value: string;
  /** 0-based indices of all rows in the collision group (≥2). */
  indices: number[];
};

export type ValidationResult = {
  /** Indices of rows that are valid AND not intra-file duplicates → candidates for writing. */
  valid: number[];
  /** Rows that fail a per-row rule (R5.1/R5.2/R3.4). */
  errors: RowError[];
  /** Intra-file duplicate groups (R7.1). Their rows are NOT in `valid`. */
  intraDuplicates: IntraDuplicateGroup[];
};

/**
 * Validate the normalized rows and partition them (R5.1, R5.2, R3.4, R7.1).
 *
 * Order of operations:
 *   1. Per-row rules → split into errored vs candidate rows.
 *   2. Over the CANDIDATE rows only, compute intra-file dedup by idv and by tag.
 *   3. Rows in a collision group are pulled out of `valid` into `intraDuplicates`.
 *
 * Pure, never throws.
 */
export function validateRows(rows: NormalizedRow[]): ValidationResult {
  const errors: RowError[] = [];
  const candidates: number[] = []; // indices that pass per-row rules

  rows.forEach((row, index) => {
    const reasons: RowErrorReason[] = [];
    const details: string[] = [];

    // R3.4 / normalization issues — a field-over-cap issue blocks the row.
    const overCap = row.issues.filter((i) => i.reason.includes('largo máximo'));
    if (overCap.length > 0) {
      reasons.push('field_over_cap');
      for (const i of overCap) details.push(`${i.field}: ${i.reason}`);
    }

    // R5.1 — at least one identifier.
    const hasIdentifier =
      !!row.tagElectronic || !!nonEmpty(row.idv) || !!nonEmpty(row.visualIdAlt);
    if (!hasIdentifier) {
      reasons.push('missing_identifier');
      details.push('falta un identificador (TAG válido, IDV o identificación visual) — a completar');
    }

    // R5.2 — sex present and mappable.
    if (row.sex === null) {
      reasons.push('missing_sex');
      const sexIssue = row.issues.find((i) => i.field === 'sex');
      details.push(sexIssue ? sexIssue.reason : 'falta el sexo (requerido)');
    }

    if (reasons.length > 0) {
      errors.push({ index, reasons, details, row });
    } else {
      candidates.push(index);
    }
  });

  // R7.1 — intra-file dedup over the candidates only.
  const intraDuplicates = computeIntraDuplicates(rows, candidates);

  // Remove duplicate rows from `valid`.
  const duplicateIndices = new Set<number>();
  for (const group of intraDuplicates) {
    for (const idx of group.indices) duplicateIndices.add(idx);
  }
  const valid = candidates.filter((idx) => !duplicateIndices.has(idx));

  return { valid, errors, intraDuplicates };
}

/**
 * Group candidate rows by repeated non-empty idv and by repeated valid tag_electronic.
 * Any identifier shared by ≥2 candidate rows yields a collision group (R7.1). A row can
 * appear in at most one group per identifier kind; we de-dup the indices across groups so
 * a row colliding on BOTH idv and tag isn't counted twice in `valid` removal.
 */
function computeIntraDuplicates(
  rows: NormalizedRow[],
  candidates: number[],
): IntraDuplicateGroup[] {
  const byIdv = new Map<string, number[]>();
  const byTag = new Map<string, number[]>();

  for (const idx of candidates) {
    const row = rows[idx];
    const idv = nonEmpty(row.idv);
    if (idv) push(byIdv, idv, idx);
    if (row.tagElectronic) push(byTag, row.tagElectronic, idx);
  }

  const groups: IntraDuplicateGroup[] = [];
  for (const [value, indices] of byIdv) {
    if (indices.length > 1) groups.push({ by: 'idv', value, indices });
  }
  for (const [value, indices] of byTag) {
    if (indices.length > 1) groups.push({ by: 'tag_electronic', value, indices });
  }
  return groups;
}

function push(map: Map<string, number[]>, key: string, idx: number): void {
  const arr = map.get(key);
  if (arr) arr.push(idx);
  else map.set(key, [idx]);
}

function nonEmpty(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
