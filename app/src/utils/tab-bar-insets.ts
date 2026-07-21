// Cálculo PURO del alto y el paddingBottom del bottom-nav (app/(tabs)/_layout.tsx),
// respetando la safe area inferior (home indicator iOS / gesture bar o 3 botones Android).
//
// ── Bugfix U7 — navbar pegado a la barra del sistema en Android ──────────────────────────
// En Expo SDK 56 / Android 15 el edge-to-edge es OBLIGATORIO (y no se puede desactivar): la
// ventana dibuja DEBAJO de la barra del sistema, así que la app DEBE compensar con
// paddingBottom = inset inferior para no quedar tapada. El patrón `max(insets.bottom, mínimo)`
// ya estaba aplicado al tab bar, PERO `useSafeAreaInsets()` puede reportar `bottom = 0` en los
// primeros frames en Android: el SafeAreaProvider raíz NO está sembrado con initialWindowMetrics
// y mide los insets de forma asíncrona. Si el nav se quedaba con ese 0 transitorio (o si el
// update no propagaba a tiempo), colapsaba al mínimo (12) y el contenido quedaba PEGADO a la
// gesture bar / 3 botones — justo lo que reportó Raf.
//
// FIX (scope tab bar): tomamos como PISO también el inset medido al ARRANQUE
// (initialWindowMetrics), que en nativo llega SINCRÓNICO desde getConstants() ya con el valor
// real de la barra de navegación. Así, aunque el inset vigente sea 0 en el frame-cero, el nav
// arranca con el respiro correcto. iOS no cambia: su inset (~34) es estable desde el arranque,
// el `max` lo preserva idéntico. Web tampoco: initialWindowMetrics es null (→ 0) y el mínimo (12)
// se mantiene igual que antes.
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
  /** Inset inferior VIGENTE (useSafeAreaInsets().bottom). Puede ser 0 en el frame-cero de Android. */
  liveInsetBottom: number;
  /**
   * Inset inferior medido al ARRANQUE (initialWindowMetrics?.insets.bottom). Piso anti-frame-cero
   * en Android edge-to-edge; 0 en web (initialWindowMetrics es null) y en Android viejo sin barra.
   */
  initialInsetBottom: number;
  /** Alto de contenido del nav (token $navBar). */
  navHeight: number;
  /** Margen inferior MÍNIMO cuando no hay inset (token $navBottomMin): web / Android con botones físicos. */
  navBottomMin: number;
}

/** Normaliza a un número finito ≥ 0 (defiende de NaN/undefined/negativos de un inset raro). */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Devuelve `{ height, paddingBottom }` del bottom-nav.
 *
 * - `paddingBottom = max(insetVigente, insetArranque, mínimo)` → respeta la safe area real y
 *   blinda el frame-cero de Android sin tocar iOS ni web.
 * - `height = navHeight + paddingBottom` → el CONTENIDO del nav siempre mide `navHeight`; el
 *   padding vive por debajo, así los íconos/labels nunca quedan tapados ni el bar “flota”.
 */
export function computeTabBarInsetLayout({
  liveInsetBottom,
  initialInsetBottom,
  navHeight,
  navBottomMin,
}: TabBarInsetInput): TabBarInsetLayout {
  // Piso robusto: el mayor entre el inset vigente y el medido al arranque. Blinda el frame-cero
  // de Android (edge-to-edge) sin afectar iOS (ambos valores coinciden ahí).
  const safeInset = Math.max(nonNegative(liveInsetBottom), nonNegative(initialInsetBottom));
  // Mínimo de respiro cuando no hay inset (web / Android viejo con botones físicos).
  const paddingBottom = Math.max(safeInset, nonNegative(navBottomMin));
  return { height: nonNegative(navHeight) + paddingBottom, paddingBottom };
}
