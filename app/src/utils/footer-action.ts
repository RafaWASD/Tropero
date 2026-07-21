// Lógica PURA del primitivo FOOTER-FIJO con CTA (feature U2 — CTA siempre visible: teclado + scroll).
// Sin RN, sin red: testeable con node:test.
//
// El primitivo (src/components/FooterActionShell.tsx) resuelve el patrón canónico del repo — header fijo /
// body scrolleable / **footer fijo con el CTA** (skill design-review + memoria feedback_ux_basicos_sheets_forms)
// — con estas 4 responsabilidades; las 3 DECISIONES puras viven acá:
//
//   1. RESERVA DE SAFE-AREA inferior robusta (`computeSafeBottomInset`): el CTA nunca queda pegado a la
//      gesture bar / home indicator NI colapsa al mínimo en el frame-0 de Android edge-to-edge (mismo bug
//      de U7: `useSafeAreaInsets().bottom` puede reportar 0 en los primeros frames si el SafeAreaProvider
//      raíz no está sembrado con initialWindowMetrics). PISO = max(inset vigente, inset de arranque, mínimo).
//   2. PADDING DEL FOOTER keyboard-aware (`resolveFooterPaddingBottom`): con el teclado ABIERTO, la
//      safe-area inferior NO se ve (el teclado la tapa) → reservar ~34px sobre el teclado deja un hueco
//      feo. Con teclado abierto reservamos solo un respiro chico; con teclado cerrado, la safe-area plena.
//   3. DECISIÓN DEL PEEK (`shouldShowScrollPeek`): reusa la geometría pura de scroll-affordance.ts → el
//      fade+peek de "hay más abajo" se muestra ⟺ hay contenido oculto por debajo del fold.
//
// El LIFT sobre el teclado en sí (subir el footer) lo hace KeyboardAvoidingView en el componente
// (behavior 'padding' en iOS; en Android lo resuelve el adjustResize de la ventana) — no es lógica pura.

import { scrollFades, type ScrollGeometry } from './scroll-affordance';

/** Normaliza a un número finito ≥ 0 (defiende de NaN/undefined/negativos de un inset raro). */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface SafeBottomInsetInput {
  /** Inset inferior VIGENTE (useSafeAreaInsets().bottom). Puede ser 0 en el frame-cero de Android. */
  liveInsetBottom: number;
  /**
   * Inset inferior medido al ARRANQUE (initialWindowMetrics?.insets.bottom ?? 0). Piso anti-frame-cero en
   * Android edge-to-edge (llega SINCRÓNICO desde getConstants en nativo); 0 en web (initialWindowMetrics
   * es null) y en Android viejo sin barra.
   */
  initialInsetBottom: number;
  /** Reserva MÍNIMA cuando no hay inset (token $navBottomMin): web / Android con botones físicos. */
  minInset: number;
}

/**
 * Reserva inferior ROBUSTA para un footer fijo = `max(insetVigente, insetArranque, mínimo)`.
 * Blinda el frame-0 de Android (edge-to-edge) sin afectar iOS (ambos insets coinciden ahí) ni web
 * (ambos 0 → cae al mínimo, idéntico a antes). Mismo enfoque que `computeTabBarInsetLayout` (U7).
 */
export function computeSafeBottomInset({
  liveInsetBottom,
  initialInsetBottom,
  minInset,
}: SafeBottomInsetInput): number {
  return Math.max(
    nonNegative(liveInsetBottom),
    nonNegative(initialInsetBottom),
    nonNegative(minInset),
  );
}

export interface FooterPaddingInput {
  /** ¿El teclado está VISIBLE? (hook useKeyboardVisible). */
  keyboardVisible: boolean;
  /** Reserva de safe-area con teclado CERRADO (= computeSafeBottomInset). */
  safeInset: number;
  /** Respiro chico entre el footer y el teclado cuando está ABIERTO (token $2/$3). */
  keyboardOpenGap: number;
}

/**
 * Padding inferior del footer fijo, keyboard-aware:
 *   - Teclado CERRADO → la reserva de safe-area plena (nada tocable bajo el home indicator / gesture bar).
 *   - Teclado ABIERTO → un respiro chico: la safe-area la tapa el teclado, reservarla dejaría un hueco.
 * El LIFT del footer por encima del teclado lo hace KeyboardAvoidingView; esto solo evita el doble espacio.
 */
export function resolveFooterPaddingBottom({
  keyboardVisible,
  safeInset,
  keyboardOpenGap,
}: FooterPaddingInput): number {
  return keyboardVisible ? nonNegative(keyboardOpenGap) : nonNegative(safeInset);
}

/**
 * ¿Mostrar el affordance de peek+fade "hay más abajo"? ⟺ hay contenido oculto por DEBAJO del fold.
 * Reusa la MISMA geometría pura que la lista de maniobra (scroll-affordance.ts) → una sola fuente de
 * verdad para la decisión (sin drift). Sin overflow real → false (no hay nada oculto).
 */
export function shouldShowScrollPeek(g: ScrollGeometry): boolean {
  return scrollFades(g).bottom;
}
