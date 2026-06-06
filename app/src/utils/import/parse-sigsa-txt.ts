// Pure parser for the SIGSA device-declaration TXT (spec 12, T1.3 / R6.2, R10.1).
//
// No I/O, no dependencies: takes the raw TXT content and returns one record per device.
// Runs under node:test (same pattern as parser-rs420.ts / src/utils/*).
//
// Wire format (CONFIRMED — manual oficial SENASA SIGSA v2.42.80, see
// specs/active/08-export-sigsa/research-findings.md §2 and razas-senasa-codigos.md):
//
//   DISPOSITIVO-SEXO-RAZA-MM/AAAA  ; ...  (devices separated by ';', fields by '-')
//
//   e.g. 032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025
//          ^^^^^^^^^^^^^^^                  DISPOSITIVO = 15-digit RFID
//                          ^                SEXO = M | H
//                            ^              RAZA = SENASA code (1-3 letters; 'H' here is Hereford)
//                              ^^^^^^^      FECHANACIMIENTO = MM/AAAA
//
// ⚠️ POSITIONAL PARSING (R6.2 — design §parser, razas-senasa-codigos.md gotcha): the
// letter 'H' is ambiguous — in the SEXO position it means Hembra (female), in the RAZA
// position it means Hereford. We disambiguate by ORDER, never by content. Field 2 is
// always sex; field 3 is always the breed CODE. We do NOT scan for 'H' anywhere.
//
// The breed field stays a CODE here (best-effort code→name resolution is the caller's
// job via breed-senasa.ts, R6.2 fallback-to-code). This parser only splits + does light
// structural validation, so a malformed record yields a row WITH an error instead of
// breaking the rest of the file (R3.6 / skip-and-report). Every value is opaque text
// (R3.5): nothing is interpreted or evaluated.

/** A parsed SIGSA device record. `error` is set (and the data fields best-effort) when malformed. */
export type SigsaRecord = {
  /** 1-based index of the record within the file (for the operator's error report). */
  index: number;
  /** Raw record text as it appeared between ';' separators (trimmed). */
  raw: string;
  /** 15-digit RFID, or '' if absent/malformed. */
  rfid: string;
  /** Raw SEXO token from position 2 (e.g. 'M' | 'H'), or '' if absent. Normalization is downstream. */
  sexRaw: string;
  /** SENASA breed CODE from position 3 (e.g. 'H' = Hereford), or '' if absent. */
  breedCode: string;
  /** Raw FECHANACIMIENTO token (MM/AAAA) from position 4, or '' if absent. Date parsing is downstream. */
  birthRaw: string;
  /** Human-readable reason when the record is structurally malformed; undefined when OK. */
  error?: string;
};

export type SigsaParseResult = {
  records: SigsaRecord[];
  /** True when the file contained more than MAX_SIGSA_RECORDS devices (reject-and-report, R3.2). */
  recordsExceeded: boolean;
};

/** Max device records per SIGSA file (same anti-DoW intent as MAX_ROWS in parse-csv, R3.2/R3.3). */
export const MAX_SIGSA_RECORDS = 5000;

const RFID_RE = /^\d{15}$/;

/**
 * Parse the SIGSA TXT into one record per device, scanning by ';' / newline (devices) and
 * splitting each chunk by '-' (fields), strictly positionally. Records that don't have the 4 expected fields, or
 * whose RFID isn't 15 digits, get an `error` set but DO NOT abort the rest of the file
 * (R3.6 / skip-and-report). The cap stops materializing past MAX_SIGSA_RECORDS.
 *
 * Note: the manual's own example sometimes shows a typo (`-AA8/2025`); we validate the
 * date shape downstream (normalize-row.ts), not here — here a missing/odd date still
 * yields a record (date is nullable, R4.4), not a hard error.
 */
export function parseSigsaTxt(text: string): SigsaParseResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { records: [], recordsExceeded: false };
  }

  const records: SigsaRecord[] = [];
  let recordsExceeded = false;
  let index = 0;

  // Scan char-by-char, accumulating one device chunk at a time. Devices are separated by
  // ';' OR by a newline (some exports wrap lines). We do NOT split the whole string up
  // front: the cap is applied DURING the scan (R3.3) so a pathologically large file never
  // materializes its full chunk array in memory.
  let chunk = '';
  const len = text.length;

  const flush = (): boolean => {
    const raw = chunk.trim();
    chunk = '';
    if (raw.length === 0) return false; // empty chunk (trailing ';', blank line) → skip
    if (records.length >= MAX_SIGSA_RECORDS) {
      recordsExceeded = true;
      return true; // stop — don't materialize past the limit
    }
    index++;
    records.push(parseRecord(raw, index));
    return false;
  };

  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch === ';' || ch === '\n' || ch === '\r') {
      if (flush()) return { records, recordsExceeded };
      continue;
    }
    chunk += ch;
  }
  // Flush the trailing chunk (file may not end in a separator).
  flush();

  return { records, recordsExceeded };
}

/** Parse ONE device chunk positionally. Never throws; malformed → record with `error`. */
function parseRecord(raw: string, index: number): SigsaRecord {
  // Split into exactly the field positions. Extra '-' beyond the 4th field would corrupt
  // a positional read, so we cap the split at 4 parts: anything past field 4 is suspicious
  // → flagged. We DON'T merge it into a field by content.
  const parts = raw.split('-');

  const base: SigsaRecord = {
    index,
    raw,
    rfid: (parts[0] ?? '').trim(),
    sexRaw: (parts[1] ?? '').trim(),
    breedCode: (parts[2] ?? '').trim(),
    birthRaw: (parts[3] ?? '').trim(),
  };

  // Structural validation (positional, not content-based):
  if (parts.length < 4) {
    return { ...base, error: 'registro incompleto (se esperan 4 campos RFID-SEXO-RAZA-MM/AAAA)' };
  }
  if (parts.length > 4) {
    return { ...base, error: 'registro con campos de más (formato RFID-SEXO-RAZA-MM/AAAA)' };
  }
  if (!RFID_RE.test(base.rfid)) {
    return { ...base, error: 'RFID inválido (se esperan 15 dígitos)' };
  }

  return base;
}
