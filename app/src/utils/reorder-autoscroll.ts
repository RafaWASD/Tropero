// Lógica PURA del AUTO-SCROLL del drag de reorder de la etapa 2 del wizard de jornada (spec 03 R1.12).
// Sin RN, sin reanimated: testeable con node:test. La llama el frame callback del UI thread
// (`ManeuverReorderList.tsx`) → lleva la directiva 'worklet' (el plugin de react-native-worklets la
// workletiza; en Node/tests la directiva es un string inerte y la función es una función común).
//
// BUG QUE CIERRA (Raf, device iOS, 2026-07-25): al agarrar el grip de una maniobra cerca del borde inferior
// de la pantalla, el auto-scroll arrancaba y scrolleaba la página hasta el FONDO DE TODO el contenido (pool
// de no-seleccionadas + custom + "Detalle de la tanda" + CTA) — mucho más abajo que la última maniobra
// seleccionada → el operario PIERDE DE VISTA la lista que está ordenando (Nielsen #1: visibilidad del estado
// del sistema; se rompe la manipulación directa: no ves dónde va a caer lo que arrastrás). El auto-scroll
// solo tenía tope hacia ARRIBA (offset ≥ 0); hacia abajo corría hasta el final del contenido del ScrollView.
//
// REGLA (fix aprobado): el auto-scroll del drag se acota a la REGIÓN de las maniobras SELECCIONADAS, medida
// en coordenadas de PANTALLA cada frame:
//   - hacia ABAJO se permite SOLO mientras quede región por revelar (`regionBottom + margin > viewportBottom`);
//   - hacia ARRIBA, SOLO mientras el tope de la región esté por encima del viewport (`regionTop - margin <
//     viewportTop`), manteniendo el clamp duro del offset en 0;
//   - el paso se recorta al remanente exacto → la región aterriza con `margin` de aire, sin overshoot ni
//     rebote (el remanente nunca cambia de signo dentro de una misma dirección).
//
// POR QUÉ ASÍ, y no de las otras dos formas que se evaluaron:
//   - NO se gatea por "el ítem arrastrado ya llegó al extremo de sus bounds": si el ítem está en el último
//     slot pero el fondo de la región sigue fuera de pantalla, el operario NECESITA que el auto-scroll siga
//     hasta revelarlo para ver dónde va a caer. El corte correcto es por VISIBILIDAD de la región; el "no
//     scrollea de más" sale solo como consecuencia.
//   - NO se hardcodea "más de N maniobras": N sería un síntoma de la altura del viewport, no una constante.
//     Con este clamp, si la región entra entera en el viewport el delta da 0 y el auto-scroll simplemente no
//     se mueve — mismo comportamiento pedido, sin número mágico.
//
// Defensivo: cualquier medida ausente/no finita (measure() puede devolver null o valores sin computar) o un
// viewport sin medir devuelve 0 (NO auto-scrollear), nunca el comportamiento sin tope.

/** Geometría de un frame de auto-scroll durante el drag. Todo en px; las Y son de PANTALLA (window). */
export type ReorderAutoScrollInput = {
  /** Dirección pedida por el dedo: -1 (arriba), 0 (ninguna), +1 (abajo). */
  dir: number;
  /** Velocidad del auto-scroll (px por frame). */
  speed: number;
  /** Y en pantalla del TOPE de la región reordenable (`measure().pageY`). */
  regionTop: number;
  /** Alto de la región reordenable (`measure().height`). */
  regionHeight: number;
  /** Y en pantalla del TOPE del viewport del ScrollView. */
  viewportTop: number;
  /** Alto VISIBLE del viewport del ScrollView. */
  viewportHeight: number;
  /** Offset de scroll actual del ScrollView (px desde el tope del contenido; nunca negativo). */
  currentOffset: number;
  /** Aire que queda entre el borde del viewport y el borde de la región cuando termina de revelarse. */
  margin: number;
};

/**
 * Cuánto debe scrollear el ScrollView ESTE frame (px; + baja, − sube, 0 = no scrollear).
 * El resultado ya viene acotado a la región de seleccionadas y al piso de offset 0 → el llamador solo hace
 * `scrollTo(currentOffset + delta)`.
 */
export function autoScrollDelta(input: ReorderAutoScrollInput): number {
  'worklet';
  const { dir, speed, regionTop, regionHeight, viewportTop, viewportHeight, currentOffset, margin } = input;

  if (dir !== 1 && dir !== -1) return 0;
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  // Región sin medir (measure() null / layout no computado) o viewport sin medir → NO auto-scrolleamos.
  if (!Number.isFinite(regionTop) || !Number.isFinite(regionHeight) || regionHeight <= 0) return 0;
  if (!Number.isFinite(viewportTop) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;

  const offset = Number.isFinite(currentOffset) && currentOffset > 0 ? currentOffset : 0;
  const air = Number.isFinite(margin) && margin > 0 ? margin : 0;

  if (dir === 1) {
    // Bajar: solo mientras el FONDO de la región (+ aire) siga por debajo del fondo del viewport.
    const hidden = regionTop + regionHeight + air - (viewportTop + viewportHeight);
    if (hidden <= 0) return 0;
    return Math.min(speed, hidden);
  }

  // Subir: solo mientras el TOPE de la región (− aire) siga por encima del tope del viewport, y nunca
  // más allá del piso de scroll (offset 0).
  const hidden = viewportTop - (regionTop - air);
  if (hidden <= 0) return 0;
  const step = Math.min(speed, hidden, offset);
  return step <= 0 ? 0 : -step;
}
