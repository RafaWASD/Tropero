// Lógica PURA de clasificación de identificadores de animal (spec 09 R1.4 / R3, spec 02 R5).
// Sin RN, sin red, sin supabase-js: testeable con node:test (mismo patrón que validation.ts /
// rodeo-template.ts de C1).
//
// Dos responsabilidades, ambas puras:
//   1. classifyIdentifier(query): heurística R1.4 — decide en qué campo precargar el texto que
//      el operario tipeó cuando NO hubo match y va a dar de alta:
//        - numérico/estructurado (caravana oficial / IDV) → 'idv'
//        - texto libre (descripción visual: "vaca blanca", "R-14") → 'visual_id_alt'
//   2. classifySearchQuery(query): para la búsqueda (R5), decide qué primitivas disparar
//      (match exacto por TAG, match exacto por IDV, fuzzy por visual). Un mismo texto puede
//      gatillar varias (ej. "982000..." es candidato a TAG y a IDV); siempre se intenta fuzzy
//      por visual como red. El motor find-or-create (services/animals.ts) consume esto.
//
// POR QUÉ acá y no en el screen: la heurística es la pieza que decide "idv vs visual" del CTA
// "Dar de alta" (R1.4) y el orden de búsqueda (R5); meterla en el screen la dejaría sin test y
// acoplada a la UI. Extraída a util pura como exige el brief de C2.

// Tope de largo del TÉRMINO del buscador de animales (spec 13 — F1-1, R7.3). Coherente con el techo
// de identificadores de INPUT-1 (64): un IDV/visual/TAG legítimo nunca lo supera. FUENTE ÚNICA del
// tope: classifySearchQuery (abajo) lo aplica server-side (autoritativo, recorta el término antes de
// cualquier query a PostgREST); el TextInput del buscador lo importa como `maxLength` (capa de UX,
// bypasseable). Vive acá (no en animal-input.ts) porque el corte vive en classifySearchQuery y así
// evitamos un import de valor cross-file que el type-stripping de node:test no resuelve sin extensión.
export const SEARCH_TERM_MAX_LENGTH = 64;

/** En qué campo precargar el texto tipeado al dar de alta tras un no-match (R1.4). */
export type IdentifierKind = 'idv' | 'visual';

// Una caravana electrónica ISO 11784/11785 FDX-B tiene 15 dígitos (prefijo de país, p.ej. 982
// para Argentina). El IDV/caravana oficial es numérico o "casi numérico" (puede traer espacios
// o guiones de formato: "ARG 0241 5567" igual es estructurada). El visual_id_alt es texto libre
// (descripción: color/seña, o un número de manga corto pintado).

/** Caracteres que cuentan como "estructura" de un identificador oficial (no letras de palabra). */
const STRUCTURED_SEPARATORS = /[\s\-./]/g;

/**
 * Heurística R1.4: ¿el texto tipeado parece un identificador numérico/estructurado (→ idv) o
 * texto libre descriptivo (→ visual_id_alt)?
 *
 * Regla (deliberadamente simple y predecible para el operario):
 *   - Se descartan separadores de formato (espacio, guion, punto, barra).
 *   - Si lo que queda es SOLO dígitos y tiene ≥3 dígitos → 'idv' (caravana/IDV oficial).
 *   - Cualquier otra cosa (tiene letras, o es muy corto) → 'visual' (texto libre).
 *
 * Casos:
 *   "0241 5567"        → idv     (números con espacios de formato)
 *   "982000123456789"  → idv     (caravana FDX-B 15 díg)
 *   "112"              → idv     (3+ dígitos puros: lo tratamos como IDV/caravana corta)
 *   "ARG 0241"         → visual  (tiene letras → no es un IDV numérico puro)
 *   "vaca blanca"      → visual  (texto libre)
 *   "R-14"             → visual  (mezcla letra+número, seña pintada)
 *   "12"               → visual  (menos de 3 dígitos: probablemente un número de manga corto)
 *   ""                 → visual  (degenerado; el caller no debería llamar con vacío)
 *
 * Nota: una caravana oficial argentina suele ser numérica; "ARG ..." que a veces se ve en la UI
 * es un prefijo de display, no parte del IDV tipeable, así que un texto CON letras cae a visual
 * (más seguro: visual_id_alt es texto libre y no tiene constraint de formato; el operario puede
 * corregir el campo en el form de alta si se equivocó — los 3 identificadores se muestran).
 */
export function classifyIdentifier(query: string): IdentifierKind {
  const trimmed = query.trim();
  if (trimmed.length === 0) return 'visual';
  const compact = trimmed.replace(STRUCTURED_SEPARATORS, '');
  if (/^\d+$/.test(compact) && compact.length >= 3) {
    return 'idv';
  }
  return 'visual';
}

/** Qué primitivas de búsqueda (R5) tiene sentido disparar para un texto tipeado. */
export type SearchPlan = {
  /** Probar match exacto contra animals.tag_electronic (caravana electrónica FDX-B, 15 díg). */
  tryTag: boolean;
  /** Probar match exacto contra animal_profiles.idv (numérico/estructurado). */
  tryIdv: boolean;
  /**
   * Probar match PARCIAL (substring/prefijo, ilike) contra idv Y tag_electronic. Se habilita para
   * cualquier texto numérico de ≥1 dígito (fix-loop 2): tipear un prefijo como "03200" debe
   * encontrar animales cuyo idv o caravana electrónica CONTENGAN ese texto, no solo el match exacto
   * de 15 díg. El exacto sigue priorizado arriba (lo concatena el motor antes que el substring).
   */
  tryNumericSubstring: boolean;
  /** Probar fuzzy contra animal_profiles.visual_id_alt (siempre — red de seguridad). */
  tryVisual: boolean;
  /** Texto normalizado (trim) que se usa en las queries. */
  normalized: string;
  /** Texto compacto (sin separadores) — el que se usa para el match exacto de TAG/IDV. */
  compact: string;
};

// Una caravana electrónica FDX-B son exactamente 15 dígitos. Si el texto compacto tiene 15
// dígitos, es un candidato fuerte a TAG; igual probamos IDV (un IDV podría coincidir) y visual.
const TAG_DIGITS = 15;

/**
 * Decide el plan de búsqueda (R5) para un texto tipeado. NO ejecuta queries — solo dice cuáles
 * vale la pena intentar, para que `services/animals.ts` no malgaste round-trips (ej. no buscar
 * por IDV si el texto tiene letras: el IDV/caravana son numéricos).
 *
 *   - tryTag  : el texto compacto es 15 dígitos puros (forma de caravana electrónica) — match EXACTO.
 *   - tryIdv  : el texto compacto es solo dígitos (cualquier longitud ≥1) — match EXACTO de IDV.
 *   - tryNumericSubstring : el texto compacto es solo dígitos (≥1) → match PARCIAL (ilike) sobre
 *               idv Y tag_electronic. Fix-loop 2: un prefijo numérico ("03200") debe encontrar
 *               animales cuya caravana/IDV lo CONTENGAN, no solo el match exacto. El exacto queda
 *               priorizado arriba; este es el que hace andar el buscador por caravana/número.
 *   - tryVisual: SIEMPRE true si hay texto (el visual_id_alt es texto libre; el fuzzy lo cubre).
 *
 * El orden de prioridad al resolver el resultado (exactos TAG/IDV → substring numérico → visual) lo
 * aplica el motor, no acá.
 */
export function classifySearchQuery(query: string): SearchPlan {
  // F1-1 (R7.3): recorte AUTORITATIVO server-side del término antes de cualquier query. El
  // service consume `normalized`/`compact` derivados de acá → topar la entrada acá topa TODAS
  // las sub-queries (idv/tag/visual). Recorte silencioso (truncar) en vez de rechazo: mejor UX
  // (el operario que pega texto de más igual busca por el prefijo). El TextInput tiene el mismo
  // maxLength como UX, pero el cliente es attacker-controlled (pega a PostgREST directo) → este
  // es el corte real que impide mandar un término de miles de chars a PostgREST.
  const capped = query.slice(0, SEARCH_TERM_MAX_LENGTH);
  const normalized = capped.trim();
  const compact = normalized.replace(STRUCTURED_SEPARATORS, '');
  const isDigits = compact.length > 0 && /^\d+$/.test(compact);
  return {
    tryTag: isDigits && compact.length === TAG_DIGITS,
    tryIdv: isDigits,
    tryNumericSubstring: isDigits,
    tryVisual: normalized.length > 0,
    normalized,
    compact,
  };
}
