// Lógica PURA del affordance de SCROLL de una lista (spec 03 M5-CLIENTE bugfix). Sin RN, sin red: testeable
// con node:test.
//
// PROBLEMA (bug cazado en vivo por Raf): en las listas enum_single/enum_multi de una maniobra CUSTOM con
// MUCHAS opciones (8-12, que exceden el viewport), NO se notaba que se podía SCROLLEAR — el operario creía que
// las opciones visibles eran TODAS. Le faltaba un affordance claro de "hay más abajo".
//
// SOLUCIÓN (affordance estándar): un fade-gradiente en el borde donde hay contenido oculto. Si hay contenido
// por DEBAJO del viewport → fade abajo; si ya scrolleó y hay contenido por ARRIBA → fade arriba. Combinado con
// un PEEK (un ítem parcial asomando en el borde, que se logra dimensionando la lista para no terminar justo en
// el borde de un ítem) el operario VE que la lista sigue.
//
// Esta función decide SOLO los flags (qué fade mostrar) a partir de la geometría del scroll. El render del
// gradiente + el peek viven en el componente. Cero dependencia de RN → unit puro.

/** Geometría de un ScrollView en un instante: cuánto se scrolleó, el alto visible y el alto total. */
export type ScrollGeometry = {
  /** Offset vertical scrolleado (px desde el tope). 0 = arriba de todo. */
  scrollY: number;
  /** Alto VISIBLE del viewport del ScrollView (px). */
  viewportHeight: number;
  /** Alto TOTAL del contenido (px). Si <= viewportHeight no hay nada que scrollear. */
  contentHeight: number;
};

/** Qué fades de affordance mostrar (los bordes con contenido oculto). */
export type ScrollFades = {
  /** Hay contenido oculto ARRIBA (ya se scrolleó hacia abajo) → mostrar fade arriba. */
  top: boolean;
  /** Hay contenido oculto ABAJO (falta scrollear) → mostrar fade abajo. */
  bottom: boolean;
};

/**
 * Tolerancia (px) para considerar "estoy en el borde". Evita parpadeo del fade por subpíxeles/rebote: a < EPS
 * del tope NO mostramos fade arriba; a < EPS del fondo NO mostramos fade abajo. Pequeño respecto a un ítem
 * (touchMin=56).
 */
export const SCROLL_FADE_EPS = 2;

/**
 * Decide qué fades mostrar dada la geometría del scroll (función pura).
 *   - Si el contenido NO excede el viewport (cabe entero) → sin fades (no hay nada oculto).
 *   - top: hay algo oculto arriba ⟺ scrollY > EPS (ya bajaste del tope).
 *   - bottom: hay algo oculto abajo ⟺ queda distancia hasta el fondo (scrollY + viewport < content − EPS).
 * Valores negativos/NaN se tratan como 0 (defensivo: medidas que aún no llegaron).
 */
export function scrollFades(g: ScrollGeometry): ScrollFades {
  const viewport = safeNonNeg(g.viewportHeight);
  const content = safeNonNeg(g.contentHeight);
  const scrollY = safeNonNeg(g.scrollY);

  // Sin overflow real → nada que scrollear → sin affordance.
  if (content <= viewport + SCROLL_FADE_EPS) return { top: false, bottom: false };

  const maxScroll = content - viewport;
  return {
    top: scrollY > SCROLL_FADE_EPS,
    bottom: scrollY < maxScroll - SCROLL_FADE_EPS,
  };
}

/** ¿El contenido excede el viewport (hay scroll posible)? Útil para decidir si reservar el peek. */
export function hasOverflow(g: Pick<ScrollGeometry, 'viewportHeight' | 'contentHeight'>): boolean {
  return safeNonNeg(g.contentHeight) > safeNonNeg(g.viewportHeight) + SCROLL_FADE_EPS;
}

function safeNonNeg(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
