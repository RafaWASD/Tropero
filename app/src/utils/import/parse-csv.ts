// Pure CSV parser for the rodeo bulk import (spec 12, T1.1 / R3.2, R3.3, R4.1).
//
// No I/O, no dependencies: takes the raw file text (already read by the caller's
// document-picker layer) and returns { headers, rows }. Runs under node:test (same
// pattern as src/utils/* and parser-rs420.ts) — no react-native, no streaming libs.
//
// SECURITY / ANTI-DoW (R3.3): the row cap is applied DURING parsing, not after. We
// scan character-by-character and stop materializing rows once MAX_ROWS data rows are
// reached; we flag `rowsExceeded` so the caller can reject-and-report (R3.2) instead of
// truncating silently. A 10^7-line file therefore never gets fully materialized.
//
// Every parsed value is treated as opaque TEXT (R3.5): a cell like `=cmd()` or
// `=HYPERLINK(...)` is the literal string "=cmd()", never a formula — this parser does
// not interpret, evaluate, or re-export anything. Neutralization of values used in DB
// filters happens downstream (escapeIlike in the service); here we only split text.

/** Max data rows per import run (R3.2 / design §4 — Puerta 1 D4 = 5000). */
export const MAX_ROWS = 5000;

/** Max cells (columns) per row — defensive cap so a pathological row can't blow memory (R3.3). */
export const MAX_CELLS_PER_ROW = 256;

export type ParsedTable = {
  /** Header row (first non-empty record). Empty array if the file had no rows at all. */
  headers: string[];
  /** Data rows (each a string[] of cell values), capped at MAX_ROWS. */
  rows: string[][];
  /**
   * True when the file contained MORE than MAX_ROWS data rows. The caller MUST
   * reject-and-report (R3.2): we do NOT silently truncate as if the file were complete.
   */
  rowsExceeded: boolean;
  /** True when at least one row hit MAX_CELLS_PER_ROW and extra cells were dropped. */
  cellsExceeded: boolean;
};

type ParseState = {
  rows: string[][];
  current: string[];
  field: string;
  inQuotes: boolean;
  cellsExceeded: boolean;
  rowsExceeded: boolean;
  /** Number of fully-committed records (header + data) so far. */
  committed: number;
};

/**
 * Parse CSV text into { headers, rows } with row/cell caps applied during the scan.
 *
 * Handles RFC-4180-ish quoting: fields may be wrapped in double quotes; an escaped
 * quote inside a quoted field is `""`; quoted fields may contain commas, newlines and
 * quotes. Outside quotes, `\r\n`, `\n` and lone `\r` all end a record. A trailing
 * newline does NOT produce a spurious empty row.
 *
 * The cap counts DATA rows (records after the header). Once MAX_ROWS data rows are
 * committed, parsing stops materializing further rows and sets `rowsExceeded`.
 */
export function parseCsv(text: string): ParsedTable {
  if (typeof text !== 'string' || text.length === 0) {
    return { headers: [], rows: [], rowsExceeded: false, cellsExceeded: false };
  }

  const state: ParseState = {
    rows: [],
    current: [],
    field: '',
    inQuotes: false,
    cellsExceeded: false,
    rowsExceeded: false,
    committed: 0,
  };

  // Header counts as record 0; data rows are records 1..N. We stop after committing
  // the header + MAX_ROWS data rows (committed === MAX_ROWS + 1). The very next record
  // that WOULD be committed flips rowsExceeded.
  const maxCommittedRecords = MAX_ROWS + 1;

  let started = false; // has the current record received any char (to detect empty trailing rows)
  const len = text.length;

  for (let i = 0; i < len; i++) {
    const ch = text[i];

    if (state.inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          state.field += '"';
          i++; // consume the escaped quote
        } else {
          state.inQuotes = false;
        }
      } else {
        state.field += ch;
      }
      started = true;
      continue;
    }

    if (ch === '"') {
      state.inQuotes = true;
      started = true;
      continue;
    }

    if (ch === ',') {
      pushField(state);
      started = true;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      // Normalize CRLF: skip the \n that follows a \r.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      // Only commit a record if it received content (avoids a spurious empty record from
      // a trailing newline or a blank line).
      if (started) {
        pushField(state);
        const stop = commitRecord(state, maxCommittedRecords);
        if (stop) break;
      }
      started = false;
      continue;
    }

    // Ordinary character.
    state.field += ch;
    started = true;
  }

  // Flush the last record if the file did not end with a newline.
  if (started && !state.rowsExceeded) {
    pushField(state);
    commitRecord(state, maxCommittedRecords);
  }

  const [headers, ...rows] = state.rows.length > 0 ? state.rows : [[]];
  return {
    headers: headers ?? [],
    rows,
    rowsExceeded: state.rowsExceeded,
    cellsExceeded: state.cellsExceeded,
  };
}

/** Commit the accumulated field into the current record, respecting the per-row cell cap. */
function pushField(state: ParseState): void {
  if (state.current.length >= MAX_CELLS_PER_ROW) {
    state.cellsExceeded = true;
    state.field = '';
    return;
  }
  state.current.push(state.field);
  state.field = '';
}

/**
 * Commit the current record. Returns true when parsing should STOP because the data-row
 * cap was exceeded (one record beyond the header + MAX_ROWS). When that happens we set
 * rowsExceeded and do NOT materialize the offending record (no silent truncation as if
 * the file were complete — the caller rejects the whole run, R3.2).
 */
function commitRecord(state: ParseState, maxCommittedRecords: number): boolean {
  if (state.committed >= maxCommittedRecords) {
    // We were about to commit a data row beyond the cap → flag and stop.
    state.rowsExceeded = true;
    state.current = [];
    return true;
  }
  state.rows.push(state.current);
  state.current = [];
  state.committed++;
  return false;
}
