// SENASA/SIGSA breed code → readable name (spec 12, T1.5 / R6.2).
//
// Pure, no I/O. Seeded INLINE from the verified table in
// specs/active/08-export-sigsa/razas-senasa-codigos.md (Tabla 1 — 32 codes, extracted
// from the official SIGSA manual v2.42.80 with pdftotext -layout, cross-checked by hand).
// Grafías LITERALES del manual (SIGSA valida contra estos códigos exactos).
//
// Used by the SIGSA TXT path (R6.2): the parsed RAZA field is a CODE → resolved to a
// readable name best-effort. An UNKNOWN code is returned as-is (R6.2 fallback): the
// import never fails a row for an unrecognized breed (R6.3) — breed is free text in
// animal_profiles.breed until feature 08's controlled catalog lands.

/**
 * The 32 official SENASA breed codes → readable name. Codes are case-sensitive against
 * the manual (e.g. `AA`, `S/E`), so we key by the exact grafía; lookup uppercases the
 * input defensively (the TXT export uses uppercase codes, but CSV text could vary).
 */
const SENASA_BREEDS: Readonly<Record<string, string>> = Object.freeze({
  HA: 'Holando Argentino',
  PH: 'Polled Hereford',
  J: 'Jersey',
  LA: 'Limangus',
  FS: 'Simmental',
  SG: 'Santa Gertrudis',
  OR: 'Otra Raza',
  L: 'Limousine',
  K: 'Kiwi',
  BO: 'Bosmara',
  SRB: 'Sueca Roja y Blanca',
  SA: 'Senangus',
  B: 'Brahman',
  SH: 'Shorthorn',
  SP: 'Senepol',
  TL: 'Tuli',
  SI: 'San Ignacio',
  GC: 'Ganado Cruza',
  H: 'Hereford',
  W: 'Wagyu',
  SF: 'Seneford',
  CH: 'Charolais',
  AA: 'Aberdeen Angus',
  BG: 'Brangus',
  BF: 'Braford',
  CR: 'Criolla',
  MG: 'Murray Grey',
  G: 'Galloway',
  ME: 'Mediterranea',
  JA: 'Jafarabadi',
  MU: 'Murrah',
  'S/E': 'Sin Especificar',
});

/**
 * Resolve a SENASA breed code to its readable name (best-effort, R6.2).
 *
 * - Known code (case-insensitive match against the table) → the readable name.
 * - Unknown / empty code → the code returned AS-IS (trimmed). The import never blocks a
 *   row for an unrecognized breed (R6.3); the raw value is preserved for `breed`.
 *
 * Pure, never throws.
 */
export function breedNameFromCode(code: string): string {
  if (typeof code !== 'string') return '';
  const trimmed = code.trim();
  if (trimmed.length === 0) return '';
  const name = SENASA_BREEDS[trimmed.toUpperCase()];
  return name ?? trimmed; // fallback: keep the code as-is (R6.2)
}

/** True when `code` is one of the 32 official SENASA breed codes (case-insensitive). */
export function isKnownBreedCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (trimmed.length === 0) return false;
  return trimmed.toUpperCase() in SENASA_BREEDS;
}

/** Total count of seeded codes (exposed for the test's coverage assertion). */
export const SENASA_BREED_COUNT = Object.keys(SENASA_BREEDS).length;
