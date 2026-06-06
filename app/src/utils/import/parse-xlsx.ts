// Pure .xlsx parser for the rodeo bulk import (spec 12, R3.8 / R3.2, R3.3, R3.5, R4.1).
//
// Puerta 1 D1 = .xlsx ENTERS the MVP, but ONLY through a VETTED/PATCHED library (R3.8):
// the official maintained SheetJS distribution installed from the CDN tarball
// (`https://cdn.sheetjs.com/xlsx-0.20.3/...`, >= 0.20.2), NOT the outdated/vulnerable npm
// `xlsx` package (CVE-2023-30533 prototype pollution / CVE-2024-22363 ReDoS). The CDN
// tarball is registered as the dependency source in app/package.json + pnpm-lock.yaml so
// Gate 2 can verify the version has no known CVE. CSV stays the primary/recommended path
// (smaller surface); .xlsx is supported through this vetted parser.
//
// This module mirrors the EXACT shape of parse-csv.ts (`{ headers, rows, rowsExceeded,
// cellsExceeded }`) so the Fase-4 hook can use both parsers interchangeably. It adds an
// OPTIONAL `parseError` flag (only .xlsx can hard-fail to parse; CSV degrades to empty),
// so the caller can distinguish a corrupt file (R3.6 → abort) from a legitimately empty one.
//
// DEFENSIVE PARSING — this is the anti-DoW / anti-injection barrier for .xlsx:
//
//  - CAP DURING PARSE (R3.3): `XLSX.read(data, { sheetRows: MAX_ROWS + 1 })`. `sheetRows`
//    tells SheetJS to stop materializing the sheet after that many rows, so a 50k-row .xlsx
//    never materializes 50k rows in memory — the cap happens AS SheetJS scans, not after
//    (equivalent to the cap-during-scan of parse-csv). We read ONE row past MAX_ROWS so we
//    can detect "file has more than MAX_ROWS data rows" from the materialized data itself.
//
//  - REJECT-AND-REPORT, NO SILENT TRUNCATION (R3.2): if the sheet's ORIGINAL dimensions
//    exceed MAX_ROWS, we flag `rowsExceeded` (the caller rejects the whole run). We never
//    return a truncated table as if it were the complete file. We detect this two ways:
//    (a) `sheet['!fullref']` — SheetJS sets this to the original range ONLY when `sheetRows`
//    actually truncated the sheet; (b) the materialized data-row count reaching MAX_ROWS + 1.
//
//  - EVERY VALUE IS UNTRUSTED (R3.5): formulas are NOT evaluated. SheetJS is a parser, not a
//    calc engine — it never recomputes formulas on read. We extract the cached/formatted
//    value (`sheet_to_json({ raw:false })` → the `.w` formatted string / `.v` cached value),
//    never the formula. A literal `=cmd()` cell is the string "=cmd()". We never re-export to
//    Excel. Downstream neutralization of values used in DB filters lives in the service
//    (escapeIlike); here we only read text.
//
//  - FIRST SHEET ONLY: we read the workbook's first sheet (the active/primary sheet). We do
//    NOT iterate N sheets (bounded work + no surprise data from hidden sheets).
//
// No react-native / expo / supabase imports — pure, runs under node:test like parse-csv.ts.

import * as XLSX from 'xlsx';

import { MAX_ROWS, MAX_CELLS_PER_ROW, type ParsedTable } from './parse-csv';

export { MAX_ROWS, MAX_CELLS_PER_ROW } from './parse-csv';

/**
 * Result of parsing an .xlsx file. Mirrors `ParsedTable` (parse-csv.ts) so the two parsers
 * are interchangeable, plus an optional `parseError` flag for the hard-failure path (R3.6):
 * a corrupt / non-xlsx file makes SheetJS throw — we catch it and report `parseError: true`
 * with empty headers/rows instead of letting the throw crash the caller.
 */
export type ParsedXlsxTable = ParsedTable & {
  /** True when the bytes could not be parsed as an .xlsx workbook (R3.6 — caller aborts). */
  parseError?: boolean;
};

/**
 * Parse .xlsx bytes into `{ headers, rows }` with the row cap applied DURING parsing
 * (anti-DoW, R3.3) and every value treated as untrusted text (R3.5).
 *
 * @param data raw file bytes (Uint8Array / ArrayBuffer) — already read by the caller's
 *             document-picker layer (expo-document-picker → expo-file-system as array).
 */
export function parseXlsx(data: Uint8Array | ArrayBuffer): ParsedXlsxTable {
  const empty: ParsedXlsxTable = {
    headers: [],
    rows: [],
    rowsExceeded: false,
    cellsExceeded: false,
  };

  if (data == null) {
    return { ...empty, parseError: true };
  }

  let workbook: XLSX.WorkBook;
  try {
    // CAP DURING PARSE (R3.3): sheetRows stops materialization after MAX_ROWS + 1 rows.
    // type:'array' accepts a Uint8Array/ArrayBuffer. We do NOT enable any option that would
    // evaluate formulas — SheetJS never recomputes on read, and we only read cached values.
    workbook = XLSX.read(data, {
      type: 'array',
      sheetRows: MAX_ROWS + 1, // header + MAX_ROWS data rows + 1 probe row to detect overflow
      cellFormula: false, // we don't need formula strings; we only want cached values (R3.5)
      cellHTML: false, // never build HTML from cell content
      cellStyles: false, // styles are irrelevant + extra surface
      cellDates: false, // keep dates as their cached/formatted text; downstream normalizes
      dense: false,
    });
  } catch {
    // Corrupt / non-xlsx bytes (e.g. broken ZIP) → SheetJS throws. R3.6: do NOT let the throw
    // break the caller; report a parse error so the hook aborts the run and writes nothing.
    return { ...empty, parseError: true };
  }

  // FIRST SHEET ONLY: read the workbook's first sheet; ignore any others.
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return empty; // a valid-but-empty workbook (no sheets) → empty table, not an error.
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet || !sheet['!ref']) {
    return empty; // empty sheet (no used range) → empty table.
  }

  // REJECT-AND-REPORT (R3.2): did the ORIGINAL sheet exceed MAX_ROWS data rows? `!fullref`
  // is set by SheetJS ONLY when `sheetRows` actually truncated the sheet, and holds the
  // original (pre-cap) range. If present, the file had more rows than our probe window → the
  // file is over the cap regardless of how many we materialized.
  let rowsExceeded = false;
  const fullRef = sheet['!fullref'];
  if (typeof fullRef === 'string' && fullRef.length > 0) {
    const originalDataRows = dataRowCountFromRef(fullRef);
    if (originalDataRows > MAX_ROWS) rowsExceeded = true;
  }

  // Extract rows from the (already row-capped) sheet. `header: 1` → arrays; `raw: false` →
  // formatted/cached values (NOT recomputed formulas, R3.5); `defval: ''` → empty string for
  // missing cells (so rows are rectangular, like parse-csv). `blankrows: false` drops fully
  // empty rows (consistent with parse-csv not emitting spurious empty rows).
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  if (aoa.length === 0) {
    return empty;
  }

  // First materialized row = headers; the rest = data rows.
  const headerRow = aoa[0] ?? [];
  const { cells: headers, cellsExceeded: headerCells } = toStringRow(headerRow);

  const rows: string[][] = [];
  let cellsExceeded = headerCells;

  // aoa has at most MAX_ROWS + 1 data rows (probe window). If we materialized MORE than
  // MAX_ROWS data rows, the file is over the cap → reject-and-report, and do NOT include the
  // overflow rows (no silent truncation as if the file were complete, R3.2).
  const dataRows = aoa.slice(1);
  if (dataRows.length > MAX_ROWS) {
    rowsExceeded = true;
  }
  const capped = dataRows.slice(0, MAX_ROWS);
  for (const r of capped) {
    const { cells, cellsExceeded: rowCells } = toStringRow(r);
    if (rowCells) cellsExceeded = true;
    rows.push(cells);
  }

  return { headers, rows, rowsExceeded, cellsExceeded };
}

/**
 * Convert a parsed row (array of unknown cell values) to a string[] of at most
 * MAX_CELLS_PER_ROW cells. Every value is coerced to a string (R3.5 — opaque text, never a
 * formula, never re-exported). `null`/`undefined` become ''. Extra cells past the cap are
 * dropped and flagged (defensive against a pathological wide row, R3.3).
 */
function toStringRow(row: unknown[]): { cells: string[]; cellsExceeded: boolean } {
  if (!Array.isArray(row)) return { cells: [], cellsExceeded: false };
  const cells: string[] = [];
  let cellsExceeded = false;
  for (let i = 0; i < row.length; i++) {
    if (cells.length >= MAX_CELLS_PER_ROW) {
      cellsExceeded = true;
      break;
    }
    const v = row[i];
    cells.push(v == null ? '' : String(v));
  }
  return { cells, cellsExceeded };
}

/**
 * Number of DATA rows (rows after the header) implied by an A1-style range like "A1:B5000".
 * Used to read the ORIGINAL sheet height from `!fullref` WITHOUT materializing the cells —
 * the anti-DoW point of the cap. Returns 0 if the range can't be decoded.
 */
function dataRowCountFromRef(ref: string): number {
  try {
    const range = XLSX.utils.decode_range(ref);
    // decode_range rows are 0-based inclusive: total rows = e.r - s.r + 1. The first row is
    // the header, so data rows = totalRows - 1.
    const totalRows = range.e.r - range.s.r + 1;
    return Math.max(0, totalRows - 1);
  } catch {
    return 0;
  }
}
