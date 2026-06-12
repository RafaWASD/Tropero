// Lógica PURA de PRESENTACIÓN de la pantalla de selección masiva (spec 10, T-UI.4 / R11.6, R11.9). SIN
// I/O, SIN RN/expo: testeable con node:test (mismo patrón que bulk-selection.ts / animal-age.ts). La
// pantalla `seleccion-masiva.tsx` consume estas funciones; acá solo el ORDEN por identificador dentro de
// una sección (R11.9), el FILTRO de búsqueda (R11.9: solo si la lista supera el umbral) y el umbral.

/** Forma mínima de un perfil para ordenar/buscar por identificador (la cumple GroupSelectionProfile). */
export type DisplayProfile = {
  idv: string | null;
  visualIdAlt: string | null;
  tagElectronic: string | null;
};

/**
 * Umbral de candidatos a partir del cual la pantalla de selección muestra un buscador (R11.9: "búsqueda
 * arriba solo si la lista supera ~20 animales", mismo patrón que "Mis campos" >8). Constante exacta del
 * design system / Gate 0 v2 D11. > SEARCH_THRESHOLD candidatos en una sección → buscador visible.
 */
export const SEARCH_THRESHOLD = 20;

/** Identificador "hero" por el que se ordena/busca: idv → visualId → '' (orden estable). */
function identifierOf(p: DisplayProfile): string {
  return (p.idv ?? p.visualIdAlt ?? '').trim();
}

/**
 * Ordena candidatos por IDENTIFICADOR dentro de una sección (R11.9: "orden por identificador"). Numérico
 * cuando ambos son numéricos (1042 antes que 1043 antes que 220 — comparación natural de caravanas), y
 * alfabético es-AR como respaldo. NO muta el array recibido (devuelve uno nuevo). Empate por identificador
 * → desempate por profileId para un orden 100% determinístico (evita "saltos" de fila entre renders).
 */
export function sortByIdentifier<T extends DisplayProfile & { profileId: string }>(
  profiles: readonly T[],
): T[] {
  return [...profiles].sort((a, b) => {
    const ia = identifierOf(a);
    const ib = identifierOf(b);
    const na = Number(ia);
    const nb = Number(ib);
    const bothNumeric = ia !== '' && ib !== '' && Number.isFinite(na) && Number.isFinite(nb);
    if (bothNumeric && na !== nb) return na - nb;
    if (!bothNumeric) {
      const cmp = ia.localeCompare(ib, 'es-AR', { numeric: true });
      if (cmp !== 0) return cmp;
    }
    return a.profileId.localeCompare(b.profileId);
  });
}

/**
 * ¿La pantalla debe mostrar el buscador? (R11.9): solo cuando el TOTAL de candidatos supera el umbral
 * (~20). Se mide sobre el total del grupo (no por sección) — el buscador filtra todas las secciones.
 */
export function shouldShowSearch(totalCandidates: number): boolean {
  return totalCandidates > SEARCH_THRESHOLD;
}

/**
 * Filtra candidatos por una query de búsqueda (R11.9), case-insensitive, sobre idv / visualId / caravana
 * electrónica (los identificadores que el operario lee del animal). Query vacía/espacios → devuelve TODO
 * (sin filtrar). NO muta. PURA.
 */
export function filterBySearch<T extends DisplayProfile>(profiles: readonly T[], rawQuery: string): T[] {
  const q = rawQuery.trim().toLocaleLowerCase('es-AR');
  if (q === '') return [...profiles];
  return profiles.filter((p) => {
    const haystack = [p.idv, p.visualIdAlt, p.tagElectronic]
      .filter((s): s is string => s != null)
      .join(' ')
      .toLocaleLowerCase('es-AR');
    return haystack.includes(q);
  });
}

// ─── Etiquetas pluralizadas del desglose del bottom-sheet (R11.8) ────────────────────────────

/** Plurales es-AR de las categorías candidatas de las masivas (castración + destete). */
const CATEGORY_PLURAL: Readonly<Record<string, string>> = {
  ternero: 'terneros',
  ternera: 'terneras',
  torito: 'toritos',
  toro: 'toros',
  novillito: 'novillitos',
  novillo: 'novillos',
};

/**
 * Etiqueta es-AR del desglose por categoría del bottom-sheet (R11.8): "8 terneros" / "1 torito". Usa el
 * plural conocido de la categoría; si el code no está en el mapa, cae al `fallbackSingular` (el `name` del
 * catálogo, ej. "Ternero") en minúscula + cantidad — defensivo, nunca queda en blanco. PURA.
 */
export function pluralCategoryLabel(code: string, count: number, fallbackSingular: string): string {
  const plural = CATEGORY_PLURAL[code];
  if (plural) return `${count} ${count === 1 ? singularOf(plural) : plural}`;
  const base = (fallbackSingular || code).toLocaleLowerCase('es-AR');
  return `${count} ${base}`;
}

/** Singular crudo de un plural conocido (quita la 's' final) — solo para los plurales del mapa. */
function singularOf(plural: string): string {
  return plural.endsWith('s') ? plural.slice(0, -1) : plural;
}
