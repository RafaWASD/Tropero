// Lógica PURA de clasificación de identificadores de animal (spec 09 R1.4 / R3, spec 02 R5) + el hero de
// la lista/ficha + el warning-soft del apodo. Sin RN, sin red, sin supabase-js: testeable con node:test
// (mismo patrón que validation.ts / rodeo-template.ts de C1).
//
// Delta `identificadores-unificados` (IDU): modelo de 3 identificadores OPCIONALES —
//   1. Caravana Electrónica (tag_electronic, 15 díg, única global)
//   2. Caravana Visual (idv, alfanum ≤15, única por campo)
//   3. Nombre/Apodo (custom `apodo`, alfanum ≤15 + espacios/guiones, soft-warning por campo)
// El 4to histórico `visual_id_alt` se ELIMINA del todo (backend + PowerSync + frontend). Este módulo ya
// NO clasifica ni busca por visual_id_alt (se quitó `tryVisual` / `classifyIdentifier → 'visual'`).
//
// Responsabilidades PURAS:
//   1. classifySearchQuery(query): para la búsqueda unificada (IDU.4), decide qué canales disparar (match
//      exacto por TAG, exacto/substring por IDV, substring por APODO). Un mismo texto puede gatillar varios
//      (ej. 15 díg = TAG y/o IDV); se prueban en PARALELO y el motor (services/animals.ts) prioriza los
//      exactos. Todo término no-vacío (con letras o dígitos) es candidato a idv + apodo (IDU.4.2/4.3).
//   2. pickHeroIdentifier(...): el identificador HERO de la lista/ficha (apodo → idv → tag → none, IDU.6).
//   3. isApodoDuplicateInField(...): el warning-soft de apodo duplicado por campo (IDU.5.4–5.7).

// Tope de largo del TÉRMINO del buscador de animales (spec 13 — F1-1, R7.3). Coherente con el techo
// de identificadores de INPUT-1 (64): un IDV/apodo/TAG legítimo nunca lo supera. FUENTE ÚNICA del
// tope: classifySearchQuery (abajo) lo aplica server-side (autoritativo, recorta el término antes de
// cualquier query a PostgREST); el TextInput del buscador lo importa como `maxLength` (capa de UX,
// bypasseable). Vive acá (no en animal-input.ts) porque el corte vive en classifySearchQuery y así
// evitamos un import de valor cross-file que el type-stripping de node:test no resuelve sin extensión.
export const SEARCH_TERM_MAX_LENGTH = 64;

// Una caravana electrónica ISO 11784/11785 FDX-B tiene 15 dígitos (prefijo de país, p.ej. 982 para
// Argentina). El IDV/caravana visual es alfanumérico (CUIG/binomio). El apodo es un nombre libre (letras,
// dígitos, espacios, guiones). Los separadores de formato (espacio, guion, punto, barra) que el operario
// puede tipear entre dígitos de una caravana se descartan al COMPACTAR para el match exacto por TAG/IDV;
// para el apodo se usa el término NORMALIZADO (los espacios/guiones SÍ importan en un nombre).
/** Caracteres que cuentan como "estructura" de una caravana (no letras de palabra). */
const STRUCTURED_SEPARATORS = /[\s\-./]/g;

/** Qué canales de búsqueda (IDU.4) tiene sentido disparar para un texto tipeado. */
export type SearchPlan = {
  /** compact = 15 dígitos → candidato a match EXACTO de Caravana Electrónica (tag_electronic). */
  tryTagExact: boolean;
  /** término no vacío → match EXACTO de idv (alfanumérico; el motor lo prioriza sobre substring/apodo). */
  tryIdvExact: boolean;
  /** término no vacío → match PARCIAL (LIKE) sobre idv + tag_electronic denormalizado. */
  tryIdvSubstring: boolean;
  /** término no vacío → match PARCIAL (LIKE) sobre el apodo (custom_attributes join). NUEVO. */
  tryApodo: boolean;
  /** Texto normalizado (trim + cap) — el que se usa para el LIKE de apodo (conserva espacios/guiones). */
  normalized: string;
  /** Texto compacto (sin separadores) — el que se usa para el match exacto/substring de TAG/IDV. */
  compact: string;
};

// Una caravana electrónica FDX-B son exactamente 15 dígitos. Si el texto compacto tiene 15 dígitos, es un
// candidato fuerte a TAG; igual probamos IDV (un IDV podría ser 15 dígitos) y apodo.
const TAG_DIGITS = 15;

/**
 * Decide el plan de búsqueda unificada (IDU.4.1/4.2/4.3/4.5) para un texto tipeado. NO ejecuta queries —
 * solo dice qué canales vale la pena intentar. Cambios del delta vs. el modelo viejo:
 *   - `tryIdvExact`/`tryIdvSubstring` dejan de gatear por `isDigits`: se habilitan para TODO término no
 *     vacío (un idv alfanumérico o su prefijo se encuentra; antes solo dígitos disparaban idv).
 *   - Se ELIMINA `tryVisual` (visual_id_alt se borró del todo).
 *   - Se AGREGA `tryApodo` (todo término no vacío → LIKE sobre el apodo).
 *   - `tryTagExact` = el compact es 15 dígitos (sin cambio conceptual).
 * La desambiguación (un mismo texto matchea varios canales) la resuelve el motor (searchAnimals), que
 * prioriza los EXACTOS (tag/idv) sobre los substring/apodo y deduplica por profileId.
 */
export function classifySearchQuery(query: string): SearchPlan {
  // F1-1 (R7.3): recorte AUTORITATIVO server-side del término antes de cualquier query. El service consume
  // `normalized`/`compact` derivados de acá → topar la entrada acá topa TODOS los canales. Recorte silencioso
  // (truncar) en vez de rechazo: mejor UX (el operario que pega texto de más igual busca por el prefijo).
  const capped = query.slice(0, SEARCH_TERM_MAX_LENGTH);
  const normalized = capped.trim();
  const compact = normalized.replace(STRUCTURED_SEPARATORS, '');
  const nonEmpty = normalized.length > 0;
  const isDigits = compact.length > 0 && /^\d+$/.test(compact);
  return {
    tryTagExact: isDigits && compact.length === TAG_DIGITS,
    tryIdvExact: nonEmpty,
    tryIdvSubstring: nonEmpty,
    tryApodo: nonEmpty,
    normalized,
    compact,
  };
}

// ─── Hero de la lista / ficha (IDU.6) ─────────────────────────────────────────────────────

/** Qué tipo de identificador quedó como HERO (campo grande) de la fila/ficha. */
export type HeroKind = 'apodo' | 'idv' | 'tag' | 'none';

export type HeroResult = {
  kind: HeroKind;
  /** El texto hero (null si kind==='none' — el caller elige el fallback: "sin caravana" / "Animal"). */
  value: string | null;
  /** La caravana a mostrar CHICA cuando el hero es apodo (idv o electrónica). null si el hero ya es caravana. */
  secondary: { kind: 'idv' | 'tag'; value: string } | null;
};

/** Trim + null si queda vacío (un idv/apodo/tag "  " no cuenta como identificador presente). */
function cleanHero(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * Resuelve el identificador HERO de un animal (IDU.6.1/6.4/6.6), PURO. Prioridad:
 *   apodo (SOLO si el rodeo usa apodo Y el animal tiene apodo) → idv → tag_electronic → none.
 * Cuando el hero es el apodo, la caravana (idv o electrónica) baja a `secondary` (línea chica). El copy del
 * fallback (kind==='none') lo elige el call site (AnimalRow: "sin caravana"; ficha: "Animal") — la función
 * pura NO hardcodea copy de UI, así se testea sin acoplar a la vista.
 */
export function pickHeroIdentifier(input: {
  apodo: string | null;
  rodeoUsesApodo: boolean;
  idv: string | null;
  tag: string | null;
}): HeroResult {
  const apodo = cleanHero(input.apodo);
  const idv = cleanHero(input.idv);
  const tag = cleanHero(input.tag);
  if (input.rodeoUsesApodo && apodo) {
    const secondary: HeroResult['secondary'] = idv
      ? { kind: 'idv', value: idv }
      : tag
        ? { kind: 'tag', value: tag }
        : null;
    return { kind: 'apodo', value: apodo, secondary };
  }
  if (idv) return { kind: 'idv', value: idv, secondary: null };
  if (tag) return { kind: 'tag', value: tag, secondary: null };
  return { kind: 'none', value: null, secondary: null };
}

// ─── Warning-soft de apodo duplicado por campo (IDU.5.4–5.7) ───────────────────────────────

/**
 * ¿El apodo candidato ya lo usa OTRO animal del campo? (PURO, IDU.5.4/5.6/5.7). Case-insensitive, trim.
 * `others` = los apodos de los DEMÁS animales activos del establecimiento (el propio ya lo excluyó el
 * caller por profile_id, IDU.5.6). Un apodo vacío nunca dispara el aviso. El scope "por campo" (IDU.5.7) lo
 * garantiza el caller al leer solo los apodos del establecimiento activo. NO bloquea el guardado (IDU.5.5):
 * el caller solo muestra un aviso informativo.
 */
export function isApodoDuplicateInField(candidate: string, others: readonly string[]): boolean {
  const c = candidate.trim().toLowerCase();
  if (c.length === 0) return false;
  return others.some((o) => o.trim().toLowerCase() === c);
}
