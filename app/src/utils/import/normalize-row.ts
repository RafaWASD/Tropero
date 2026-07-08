// Per-row normalization for the rodeo import (spec 12, T1.9 / R3.4, R4.3, R4.4, R4.5, R6).
//
// Pure, no I/O. Takes a raw mapped row (the cell values pulled out per the column mapping)
// and produces a normalized census record + per-field issues. Runs under node:test.
//
// REUSES THE REAL PARSER (R4.5): TAG normalization/validation goes through
// `normalizeTag` + `isValidTag` of app/src/services/ble/parser-rs420.ts (spec 04 R8 —
// ISO 11784/11785 FDX-B, 15 digits). We do NOT reimplement tag logic here.
//
// Length caps (R3.4) MIRROR the authoritative server-side CHECK char_length of migration
// 0070: idv/breed/coat_color ≤ 64, entry_origin ≤ 120, notes ≤ 4000, tag_electronic ≤ 64
// (delta IDU: visual_id_alt eliminada). The client cap is a UX/perf barrier; the DB is the final authority
// (R9.5). A field exceeding its cap becomes a ROW ERROR (R5) — we do NOT silently truncate.

import { normalizeTag, isValidTag } from '../../services/ble/parser-rs420';

/** Server-side length caps mirrored from migration 0070 (R3.4). Single source of truth here. */
export const FIELD_CAPS = Object.freeze({
  idv: 64,
  breed: 64,
  coat_color: 64,
  tag_electronic: 64,
  entry_origin: 120,
  notes: 4000,
} as const);

export type Sex = 'male' | 'female';

/** A reason a single field could not be normalized cleanly (surfaced per row in validation). */
export type FieldIssue = {
  field: string;
  reason: string;
};

/** The normalized census fields produced from a raw row. Absent/invalid → null (nullable fields). */
export type NormalizedRow = {
  /** Valid 15-digit EID, or null if the mapped TAG was absent/invalid (R4.5). */
  tagElectronic: string | null;
  /** Caravana visual (idv), trimmed, or null if absent. (delta IDU: visualIdAlt eliminado.) */
  idv: string | null;
  /** male | female, or null if absent / not mappable (R4.3). */
  sex: Sex | null;
  /** birth_date as 'YYYY-MM-DD', or null if absent / unparseable (R4.4 — nullable, never blocks). */
  birthDate: string | null;
  /** Breed free text (trimmed), or null. Caller resolves SIGSA codes via breed-senasa.ts before this. */
  breed: string | null;
  /** Raw category text (trimmed), or null. Catalog resolution is in the service (R10.3). */
  category: string | null;
  /** Raw lote/group name (trimmed), or null. Matched to management_groups in the service (R10.4). */
  lote: string | null;
  /** Per-field issues (e.g. sex unmappable, field over cap). Empty when clean. */
  issues: FieldIssue[];
};

/** The raw cell values for one row, already pulled out per the column mapping (any may be undefined). */
export type RawMappedRow = {
  tag_electronic?: string;
  idv?: string;
  sex?: string;
  birth_date?: string;
  breed?: string;
  category?: string;
  lote?: string;
};

const SEX_MALE = new Set(['m', 'macho', 'male', 'toro', 'torito', 'novillo', 'novillito', 'ternero']);
const SEX_FEMALE = new Set([
  'h',
  'hembra',
  'female',
  'f',
  'vaca',
  'vaquillona',
  'ternera',
  'vaquilla',
]);

/**
 * Normalize a sex value tolerant to the producer's spreadsheet (R4.3): `M`/`H`,
 * `macho`/`hembra`, `toro`/`vaca` and case variants → `male`/`female`. Returns null when
 * the value is absent or doesn't resolve (the caller marks the row as error, R5.2).
 *
 * Note: we accept the SIGSA codes `M`/`H` here too (the TXT path feeds `sexRaw` straight in).
 * Pure, never throws.
 */
export function normalizeSex(raw: string | undefined): Sex | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return null;
  if (SEX_MALE.has(v)) return 'male';
  if (SEX_FEMALE.has(v)) return 'female';
  return null;
}

/**
 * Parse a birth date tolerating `DD/MM/AAAA`, `MM/AAAA` and `AAAA` (R4.4), producing
 * `YYYY-MM-DD`. Month-only → first day of month; year-only → first day of year. Separators
 * `/`, `-`, `.` are accepted. An invalid/out-of-range date (e.g. `13/13/2024`, `32/01/2024`)
 * returns null WITHOUT throwing — the date is nullable and never blocks the row (R4.4).
 * Also accepts an already-ISO `YYYY-MM-DD`.
 */
export function parseBirthDate(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0) return null;

  // Already ISO (YYYY-MM-DD).
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const parts = v.split(/[/\-.]/).map((p) => p.trim());

  if (parts.length === 3) {
    // DD/MM/AAAA (the common Argentine spreadsheet format).
    const [dd, mm, yyyy] = parts;
    if (!isAllDigits(dd, mm, yyyy)) return null;
    return buildDate(Number(yyyy), Number(mm), Number(dd));
  }
  if (parts.length === 2) {
    // MM/AAAA → first day of month.
    const [mm, yyyy] = parts;
    if (!isAllDigits(mm, yyyy)) return null;
    return buildDate(Number(yyyy), Number(mm), 1);
  }
  if (parts.length === 1) {
    // AAAA → first day of year.
    const [yyyy] = parts;
    if (!isAllDigits(yyyy) || yyyy.length !== 4) return null;
    return buildDate(Number(yyyy), 1, 1);
  }
  return null;
}

/** Build a validated 'YYYY-MM-DD'. Returns null for out-of-range or overflowing dates. */
function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Reject overflow (e.g. 31/02 → not a real date) using a UTC round-trip.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Normalize a TAG/RFID using the REAL parser (R4.5): `normalizeTag` strips framing/edge
 * noise, `isValidTag` checks the 15-digit FDX-B shape. Returns the clean EID when valid,
 * or null when absent/invalid (the row then resolves by another identifier or errors, R5.1).
 */
export function normalizeTagValue(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = normalizeTag(raw);
  if (cleaned.length === 0) return null;
  return isValidTag(cleaned) ? cleaned : null;
}

/** Trim a text field to null-if-empty; flag a FieldIssue if it exceeds its server cap (R3.4). */
function normalizeCapped(
  raw: string | undefined,
  field: keyof typeof FIELD_CAPS,
  issues: FieldIssue[],
): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  if (v.length > FIELD_CAPS[field]) {
    issues.push({ field, reason: `excede el largo máximo (${FIELD_CAPS[field]} caracteres)` });
    // Return null so the over-cap value is NOT written; the row carries the issue → error (R5).
    return null;
  }
  return v;
}

/**
 * Normalize a full mapped row into the census record + per-field issues (R3.4/R4.3/R4.4/R4.5).
 * Does NOT decide row validity (that's validate-rows.ts) — it only normalizes and flags.
 * Pure, never throws.
 */
export function normalizeRow(raw: RawMappedRow): NormalizedRow {
  const issues: FieldIssue[] = [];

  const sex = normalizeSex(raw.sex);
  if (raw.sex != null && raw.sex.trim().length > 0 && sex === null) {
    issues.push({ field: 'sex', reason: `valor de sexo no reconocido: "${raw.sex.trim()}"` });
  }

  // TAG: invalid-but-present is a soft issue (the row may still resolve by idv/visual).
  const tagElectronic = normalizeTagValue(raw.tag_electronic);
  if (raw.tag_electronic != null && raw.tag_electronic.trim().length > 0 && tagElectronic === null) {
    issues.push({ field: 'tag_electronic', reason: 'TAG/RFID inválido (no es un EID de 15 dígitos)' });
  }

  return {
    tagElectronic,
    idv: normalizeCapped(raw.idv, 'idv', issues),
    sex,
    birthDate: parseBirthDate(raw.birth_date),
    breed: normalizeCapped(raw.breed, 'breed', issues),
    category: normalizeText(raw.category),
    lote: normalizeText(raw.lote),
    issues,
  };
}

/** Trim to null-if-empty without a cap (category/lote are matched, not stored verbatim). */
function normalizeText(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length === 0 ? null : v;
}

function isAllDigits(...vals: string[]): boolean {
  return vals.every((v) => /^\d+$/.test(v));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
