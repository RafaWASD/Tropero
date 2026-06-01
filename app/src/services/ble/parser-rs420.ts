// Pure parser for the Allflex RS420 stick reader's SPP line protocol (spec 04, T1 / R8).
//
// Transport-independent: this module knows nothing about SPP vs BLE vs the ESP32
// bridge. It takes ONE raw ASCII line emitted by the reader and extracts the EID.
// No react-native, no native modules, no transport libs, no I/O — pure functions
// only, so it runs under node:test (same pattern as src/utils/*).
//
// Wire format (captured in the field — see specs/active/04-bluetooth-baston/field-findings.md):
//
//   [1 control byte, non-printable, ~0x02 STX] + "1000000" (fixed 7-char header)
//     + <EID: 15 digits> + <YYMMDDHHMMSS: 12 digits>   terminated by \n (maybe \r\n)
//
//   e.g. \x021000000982000364696050260530101701\r\n
//                ^^^^^^^                          fixed reader header (discarded)
//                       ^^^^^^^^^^^^^^^           EID = 982000364696050 (the useful datum)
//                                      ^^^^^^^^^^^^ reader timestamp YYMMDDHHMMSS (discarded)
//
// The "1000000" header is CONSTANT (confirmed in the field with two distinct tags,
// 982... and 032...), so it is reader metadata, not part of the tag → discarded.
// The trailing 12-digit timestamp is the reader's own clock; the MVP uses the phone
// clock for correlation, so it is discarded too. Only the 15-digit EID is kept.

/**
 * Strip framing/edge noise from a raw reader line: leading control byte(s)
 * (e.g. STX 0x02), trailing CR, and any surrounding whitespace.
 *
 * Pure: removes ASCII control chars (code < 0x20) and whitespace from BOTH edges
 * only. We intentionally do NOT strip interior characters — a malformed interior is
 * the caller's signal that the line is garbage (parseRs420Line returns null).
 */
export function normalizeTag(s: string): string {
  if (typeof s !== 'string') return '';
  // Trim leading/trailing whitespace + ASCII control chars (covers STX 0x02 prefix,
  // CR/LF terminators, and any padding). \s in JS already includes \r\n\t and friends;
  // \x00-\x1f covers the remaining non-printable control bytes such as STX.
  return s.replace(/^[\s\x00-\x1f]+/, '').replace(/[\s\x00-\x1f]+$/, '');
}

/**
 * Parse a single raw RS420 line into its EID, or null if malformed.
 *
 * Robust-by-construction: after stripping edge framing we anchor a single regex to
 * the WHOLE remaining string — fixed header `1000000`, then exactly 15 EID digits,
 * then exactly 12 timestamp digits, then end. Anchoring to start+end (rather than a
 * loose search) means partial/garbage lines, wrong-length EIDs (14/16 digits), extra
 * fields, or non-numeric junk all fail the match and yield null. Never throws.
 */
export function parseRs420Line(raw: string): { eid: string } | null {
  if (typeof raw !== 'string') return null;
  const line = normalizeTag(raw);
  if (line.length === 0) return null;

  // ^1000000  fixed reader header (discarded)
  // (\d{15})  the EID — exactly 15 digits (captured)
  // \d{12}$   reader timestamp YYMMDDHHMMSS — exactly 12 digits (discarded)
  const match = /^1000000(\d{15})\d{12}$/.exec(line);
  if (!match) return null;

  return { eid: match[1] };
}

/**
 * Validate a tag EID per ISO 11784/11785 (FDX-B), R8.
 *
 * Accepts a string that is EXACTLY 15 digits whose 3-digit prefix is either:
 *   - a country code (e.g. 032 = Argentina, official ear tag), or
 *   - a manufacturer code (>= 900, e.g. 982).
 * Both forms are valid EIDs on real tags captured in the field, so we accept both.
 *
 * Rejects any length other than 15 and any non-digit content. Pure, never throws.
 */
export function isValidTag(eid: string): boolean {
  if (typeof eid !== 'string') return false;
  if (!/^\d{15}$/.test(eid)) return false;

  const prefix = Number(eid.slice(0, 3));
  // Manufacturer codes are >= 900; everything 000-899 is a country code. Both are
  // legitimate ISO prefixes, so any 15-digit numeric EID has a valid prefix by
  // definition. We keep the explicit check to document the two accepted forms and to
  // guard against a future tightening of the rule.
  const isManufacturer = prefix >= 900;
  const isCountry = prefix >= 0 && prefix < 900;
  return isManufacturer || isCountry;
}
