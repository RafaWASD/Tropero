// Cálculo PURO del alto del bottom-nav (app/(tabs)/_layout.tsx) a partir de la reserva inferior
// COMPARTIDA de la app. Este módulo YA NO calcula la reserva: la recibe.
//
// ── Bugfix U7 — navbar pegado a la barra del sistema en Android ──────────────────────────
// En Expo SDK 56 / Android 15 el edge-to-edge es OBLIGATORIO (y no se puede desactivar): la
// ventana dibuja DEBAJO de la barra del sistema, así que la app DEBE compensar con
// paddingBottom = inset inferior para no quedar tapada. `useSafeAreaInsets()` además puede
// reportar `bottom = 0` en los primeros frames en Android (el SafeAreaProvider mide async), y
// si el nav se quedaba con ese 0 transitorio el contenido quedaba PEGADO a la barra.
// FIX (U7, se CONSERVA): tomar también el inset medido al ARRANQUE (`initialWindowMetrics`),
// que en nativo llega SINCRÓNICO desde getConstants() ya con el valor real de la barra.
//
// ── Unidad «aire» — lo que U7 NO podía arreglar ──────────────────────────────────────────
// U7 dejó la fórmula como `max(insetVigente, insetArranque, mínimo=12)`. Con una barra real de
// 48dp, `max(48, 12) = 48`: el mínimo SOLO podía ganar cuando el inset era 0 (web). O sea, el nav
// reservaba la barra y NADA MÁS → su borde quedaba soldado al borde de la barra del sistema
// (medido en device: 1dp de aire). El AIRE contra la barra de navegación del SO se SUMA al inset,
// y solo donde esa barra existe como losa opaca sobre el contenido: Android. La reserva completa
// vive en UN solo lugar (`computeSafeBottomInset` + el hook `useSafeBottomInset`), así el
// bottom-nav y los footers/sheets no pueden divergir. Este módulo solo compone el ALTO.
//
// NO se esconde la barra del sistema (modo inmersivo): eso es para video/juegos y va contra las
// guías de Android en una app de carga de datos (ver docs/plan-mejoras-2026-07-20.md §U7).

export interface TabBarInsetLayout {
  /** Alto TOTAL del bottom-nav = contenido ($navBar) + paddingBottom. */
  height: number;
  /** Padding inferior que empuja íconos/labels por encima de la barra del sistema. */
  paddingBottom: number;
}

export interface TabBarInsetInput {
  /** Alto de contenido del nav (token $navBar). */
  navHeight: number;
  /**
   * Reserva inferior compartida de la app (`useSafeBottomInset()`): inset del sistema con el
   * blindaje del frame-0, piso, y el aire de Android. El nav usa EXACTAMENTE la misma que los
   * footers y los sheets — si difiere, el pill de estado del bastón (que se posiciona relativo al
   * nav) se desalinea.
   */
  safeBottomInset: number;
}

/** Normaliza a un número finito ≥ 0 (defiende de NaN/undefined/negativos de un inset raro). */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Devuelve `{ height, paddingBottom }` del bottom-nav.
 *
 * - `paddingBottom` = la reserva compartida, tal cual (web 12 · iOS 34 · Android 3 botones 64).
 * - `height = navHeight + paddingBottom` → el CONTENIDO del nav siempre mide `navHeight`; el
 *   padding vive por debajo, así los íconos/labels nunca quedan tapados ni el bar “flota”.
 */
export function computeTabBarInsetLayout({
  navHeight,
  safeBottomInset,
}: TabBarInsetInput): TabBarInsetLayout {
  const paddingBottom = nonNegative(safeBottomInset);
  return { height: nonNegative(navHeight) + paddingBottom, paddingBottom };
}
