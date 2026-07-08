// Lógica PURA de la caravana del ternero en el prompt "¿Vincular su cría al pie?" (spec 02 delta #15,
// RCAP.2). Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que
// animal-identifier.ts / animal-birth-year.ts).
//
// El prompt pide UNA caravana/identificador del ternero. Esta función decide la RAMA del find-or-create de
// spec 09 que dispara el componente (delta IDENTIFICADORES UNIFICADOS, IDU.4.7 — busca por los 3):
//   - EID (15 díg puros)      → lookupByTag (match exacto + lectura cross-campo → "está en otro campo").
//   - término no vacío        → searchAnimals (idv EXACTO/substring alfanumérico + APODO, campo activo).
//   - vacío                   → error inline, NO dispara el find-or-create (RCAP.2.5).
//
// El delta relaja el gate numérico (antes solo aceptaba dígitos ≥3): ahora un idv ALFANUMÉRICO ("AB123") o
// un APODO ("Manchada") disparan la rama de búsqueda. Para el camino CREATE (no encontrado), el valor
// tipeado fluye al ternero creado: EID → calves[0].tag; el resto → p_calf_idv (que ahora es alfanumérico;
// `calfIdvForSubmit` lo trimea). El `value` del EID viene COMPACTO (15 díg); el de la rama search viene
// TRIMEADO (conserva letras/espacios para la búsqueda por apodo).

/** Separadores de formato de una caravana (espacio, guion, punto, barra) — se descartan solo para el EID. */
const STRUCTURED_SEPARATORS = /[\s\-./]/g;

/** Largo exacto de una caravana electrónica FDX-B (ISO 11784/11785), prefijo país 982/032… */
export const CALF_EID_LENGTH = 15;

/**
 * Clasificación del identificador del ternero tipeado en el prompt (delta IDU, IDU.4.7):
 *   - `empty` → campo vacío → error inline, sin find-or-create (RCAP.2.5).
 *   - `eid`   → 15 dígitos puros → caravana electrónica → lookupByTag (RCAP.2.2 rama EID).
 *   - `idv`   → cualquier otro término no vacío (idv alfanumérico o apodo) → searchAnimals (rama búsqueda).
 */
export type CalfQueryClass =
  | { kind: 'empty' }
  | { kind: 'eid'; value: string }
  | { kind: 'idv'; value: string };

/**
 * Clasifica el identificador del ternero (PURA, RCAP.2.1/2.5 + IDU.4.7). Decide la rama del find-or-create:
 * 15 dígitos puros = EID (lookupByTag); cualquier otro término no vacío (idv alfanumérico, número de
 * caravana, apodo) = rama de búsqueda (searchAnimals, que ahora cubre idv alfanumérico + apodo). NO ejecuta
 * queries — solo dice qué rama disparar + el valor a pasar. Ya NO exige "≥3 dígitos" ni numericidad: el
 * apodo puede ser "Manchada" (IDU.4.7). Vacío → `empty` (error inline, nunca dispara el motor con basura).
 */
export function classifyCalfQuery(raw: string): CalfQueryClass {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  const compact = trimmed.replace(STRUCTURED_SEPARATORS, '');
  // 15 dígitos PUROS → caravana electrónica (el compacto quita separadores de formato de un tipeo humano).
  if (/^\d{15}$/.test(compact)) return { kind: 'eid', value: compact };
  // Cualquier otro término no vacío → rama de búsqueda (idv alfanumérico + apodo). Se pasa TRIMEADO (los
  // espacios de un apodo importan para el LIKE; el CREATE lo trimea con calfIdvForSubmit).
  return { kind: 'idv', value: trimmed };
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
