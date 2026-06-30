// Lógica PURA de la caravana del ternero en el prompt "¿Vincular su cría al pie?" (spec 02 delta #15,
// RCAP.2). Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que
// animal-identifier.ts / animal-birth-year.ts).
//
// El prompt pide UNA caravana del ternero (numérica: caravana electrónica EID de 15 díg o caravana
// visual/IDV). Esta función decide la RAMA del find-or-create de spec 09 que dispara el componente:
//   - EID (15 díg puros)      → lookupByTag (match exacto + lectura cross-campo → detecta "está en otro
//                               campo", RCAP.3.4).
//   - IDV (≥3 díg, ≠15)       → searchAnimals (idv exacto + substring + visual fuzzy, campo activo).
//   - vacío / <3 díg          → error inline, NO dispara el find-or-create (RCAP.2.5).
//
// Para el camino CREATE (no encontrado), el valor TIPEADO fluye al ternero creado: EID → calves[0].tag;
// IDV numérico → p_calf_idv (RCAP.7.6 / fold Gate 1 LOW-1). El `value` ya viene COMPACTO (sin separadores
// de formato), listo para pasarse a la RPC / al lookup.

/** Separadores de formato de un identificador (espacio, guion, punto, barra) — se descartan al clasificar. */
const STRUCTURED_SEPARATORS = /[\s\-./]/g;

/** Largo exacto de una caravana electrónica FDX-B (ISO 11784/11785), prefijo país 982/032… */
export const CALF_EID_LENGTH = 15;
/** Mínimo de dígitos para tratar el texto como una caravana/IDV (espeja el ≥3 de classifyIdentifier). */
export const CALF_MIN_DIGITS = 3;

/**
 * Clasificación de la caravana del ternero tipeada en el prompt:
 *   - `empty`     → campo vacío → error inline, sin find-or-create (RCAP.2.5).
 *   - `too-short` → menos de 3 dígitos (o no-numérico, defensivo) → error inline, sin find-or-create.
 *   - `eid`       → 15 dígitos puros → caravana electrónica → lookupByTag (RCAP.2.2 rama EID).
 *   - `idv`       → ≥3 dígitos, ≠15 → caravana visual/IDV → searchAnimals (RCAP.2.2 rama IDV).
 */
export type CalfQueryClass =
  | { kind: 'empty' }
  | { kind: 'too-short' }
  | { kind: 'eid'; value: string }
  | { kind: 'idv'; value: string };

/**
 * Clasifica la caravana del ternero (PURA, RCAP.2.1/2.5). Descarta separadores de formato y decide la
 * rama del find-or-create. NO ejecuta queries — solo dice qué rama disparar + el valor compacto que fluye
 * al lookup o al CREATE. El sanitizer del campo deja solo dígitos; igual chequeamos numericidad por si
 * llega un paste con letras (degrada a `too-short` → error inline, nunca dispara el motor con basura).
 */
export function classifyCalfQuery(raw: string): CalfQueryClass {
  const compact = raw.trim().replace(STRUCTURED_SEPARATORS, '');
  if (compact.length === 0) return { kind: 'empty' };
  if (!/^\d+$/.test(compact) || compact.length < CALF_MIN_DIGITS) return { kind: 'too-short' };
  if (compact.length === CALF_EID_LENGTH) return { kind: 'eid', value: compact };
  return { kind: 'idv', value: compact };
}

/** ISO 'YYYY-MM-DD' local de `now` (orden lexicográfico = orden de fecha). `now` inyectable (tests). */
export function todayIsoLocal(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/**
 * Fecha del evento de parto del vínculo (RCAP.3.2): la fecha de nacimiento conocida del ternero si la
 * tiene (de su fila local), o la fecha de HOY en su defecto. `calfBirthDate` puede venir null/''/espacios.
 */
export function resolveLinkEventDate(
  calfBirthDate: string | null | undefined,
  now: Date = new Date(),
): string {
  const d = (calfBirthDate ?? '').trim();
  return d.length > 0 ? d : todayIsoLocal(now);
}
