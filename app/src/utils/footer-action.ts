// Lógica PURA del primitivo FOOTER-FIJO con CTA (feature U2 — CTA siempre visible: teclado + scroll).
// Sin RN, sin red: testeable con node:test.
//
// El primitivo (src/components/FooterActionShell.tsx) resuelve el patrón canónico del repo — header fijo /
// body scrolleable / **footer fijo con el CTA** (skill design-review + memoria feedback_ux_basicos_sheets_forms)
// — con estas 4 responsabilidades; las 3 DECISIONES puras viven acá:
//
//   1. RESERVA DE SAFE-AREA inferior robusta (`computeSafeBottomInset`): el CTA nunca queda pegado a la
//      barra del sistema NI colapsa a 0 en el frame-0 de Android edge-to-edge (mismo bug de U7:
//      `useSafeAreaInsets().bottom` puede reportar 0 en los primeros frames si el SafeAreaProvider raíz
//      no está sembrado con initialWindowMetrics).
//      RESERVA = max(inset vigente, inset de arranque, PISO) + (¿aplica? AIRE). Tres conceptos, no dos
//      — ver el docblock de la función. Es LA función compartida del repo para el borde inferior; la
//      consume el hook `hooks/useSafeBottomInset` (todos los footers/sheets/pantallas/el bottom-nav) y
//      NADIE MÁS. No se re-implementa a mano en ningún lado (lo hace cumplir el guard
//      `utils/safe-bottom-inset-guard.test.ts`).
//      PURA de verdad: el "¿aplica el aire?" entra POR PARÁMETRO (`applyGap`), no se consulta
//      `Platform` acá adentro — este archivo tiene que seguir corriendo con `node:test`.
//   2. PADDING DEL FOOTER keyboard-aware (`resolveFooterPaddingBottom`): con el teclado ABIERTO, la
//      safe-area inferior NO se ve (el teclado la tapa) → reservar ~34px sobre el teclado deja un hueco
//      feo. Con teclado abierto reservamos solo un respiro chico; con teclado cerrado, la safe-area plena.
//   3. DECISIÓN DEL PEEK (`shouldShowScrollPeek`): reusa la geometría pura de scroll-affordance.ts → el
//      fade+peek de "hay más abajo" se muestra ⟺ hay contenido oculto por debajo del fold.
//
// El LIFT sobre el teclado en sí (subir el footer) lo hace el primitivo `components/KeyboardAvoidingShell`
// (iOS: `behavior='padding'`; Android: `paddingBottom` = alto del teclado vía `useAnimatedKeyboard`, porque
// bajo edge-to-edge la ventana ya NO se encoge sola) — no es lógica pura.

import { scrollFades, type ScrollGeometry } from './scroll-affordance';

/** Normaliza a un número finito ≥ 0 (defiende de NaN/undefined/negativos de un inset raro). */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface SafeBottomInsetInput {
  /** Inset inferior VIGENTE (useSafeAreaInsets().bottom). Puede ser 0 en el frame-cero de Android. */
  liveInsetBottom: number;
  /**
   * Inset inferior medido al ARRANQUE (initialWindowMetrics?.insets.bottom ?? 0). Piso anti-frame-cero
   * del INSET DEL SISTEMA (no de la reserva total) en Android edge-to-edge: llega SINCRÓNICO desde
   * getConstants en nativo; 0 en web (initialWindowMetrics es null) y en Android viejo sin barra.
   */
  initialInsetBottom: number;
  /**
   * PISO (token $navBottomMin = 12): respiro mínimo cuando NO hay inset del sistema (web, Android
   * viejo con botones físicos). Compite en el `max`, no se suma: si el SO ya obliga a 34 o 48, no
   * aporta nada.
   */
  minInset: number;
  /**
   * AIRE (token $navBarGap = 16) que se SUMA al inset del sistema — solo si `applyGap`.
   * (Se llama `gap` y no `min` a propósito: es la separación contra la barra de navegación del SO,
   * no un mínimo que compite con el inset.)
   */
  gap: number;
  /**
   * ¿Corresponde sumar el AIRE en esta plataforma? Entra por parámetro para que esta función siga
   * siendo pura y testeable con `node:test` (nada de `Platform` acá adentro). El único lugar que
   * decide el valor es `hooks/useSafeBottomInset` (`Platform.OS === 'android'`) — ver ahí el porqué.
   */
  applyGap: boolean;
  /**
   * AIRE PROPIO de la superficie, que se suma al inset del sistema ADEMÁS del canónico. Para las
   * superficies que ya tenían más aire que el resto antes de esta unidad (p. ej. el sheet de escaneo
   * de caravana: `inset + $6`). Default 0. Esta unidad AGREGA aire, nunca lo saca.
   */
  extra?: number;
  /**
   * PISO PROPIO de la superficie, cuando es mayor que el canónico (p. ej. los sheets que usaban
   * `max(inset, $4)`). Compite en el `max` igual que `minInset`. Default 0.
   */
  floor?: number;
}

/**
 * Reserva inferior ROBUSTA para cualquier cosa anclada al borde de abajo:
 *
 *   `max(insetVigente, insetArranque, piso, pisoPropio) + airePropio + (aplicaAire ? aire : 0)`
 *
 * TRES conceptos distintos (el bug de esta unidad fue confundir dos de ellos, y el primer intento de
 * arreglo fue confundir los otros dos):
 *
 *  1. INSET = `max(insetVigente, insetArranque)`, lo que el SO obliga a NO tapar. El `max` entre
 *     vigente y arranque es el blindaje del frame-0 de Android edge-to-edge de U7
 *     (`initialWindowMetrics` llega sincrónico; el vigente puede ser 0 unos frames).
 *  2. PISO (`minInset`) = respiro mínimo cuando NO hay inset. Solo puede ganar en web (inset 0).
 *  3. AIRE (`gap`) = separación contra la BARRA DE NAVEGACIÓN del SO. Se SUMA, y **solo donde el
 *     inset está íntegramente ocupado por una barra que el SO dibuja sobre el contenido: Android**.
 *     En Android el inset inferior vale EXACTAMENTE el alto de la barra de navegación → reservar el
 *     inset deja el contenido apoyado sobre su borde (medido en device: CTA a 1dp de la barra).
 *     En iOS el inset de 34pt es espacio pintado con el fondo de la app con una pildorita fina
 *     adentro: el inset ya *es* el aire, y sumarle más solo come zona de pulgar.
 *
 * Historia (para que nadie re-proponga ninguna de las dos versiones muertas):
 *  - `max(vigente, arranque, mínimo=12)` (hasta la unidad «aire»): el mínimo solo podía ganar con
 *    inset 0, así que en Android la reserva era EXACTAMENTE la barra → CTA soldado (bug 🔴).
 *  - `max(vigente, arranque) + 16` en TODAS las plataformas (primer intento, DESCARTADO): arreglaba
 *    Android pero engordaba iOS (tab bar 94 → 110pt) y borraba el piso de web (12 → 16), sin ninguna
 *    razón de diseño en ninguno de los dos casos.
 *
 * Resultados con el default (`extra`/`floor` en 0):
 *   web 12 · iOS 34 · Android gestos 24+16=40 · Android 3 botones 48+16=64.
 */
export function computeSafeBottomInset({
  liveInsetBottom,
  initialInsetBottom,
  minInset,
  gap,
  applyGap,
  extra = 0,
  floor = 0,
}: SafeBottomInsetInput): number {
  const systemInset = Math.max(nonNegative(liveInsetBottom), nonNegative(initialInsetBottom));
  // El aire PROPIO se suma al inset ANTES del `max` con los pisos: si el SO no reserva nada (web),
  // la superficie se queda con su propio aire (no con piso + aire, que sería sumar dos veces lo mismo).
  const base = Math.max(systemInset + nonNegative(extra), nonNegative(minInset), nonNegative(floor));
  return base + (applyGap ? nonNegative(gap) : 0);
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
 * El LIFT del footer por encima del teclado lo hace el `KeyboardAvoidingShell` (que descuenta el teclado
 * COMPLETO, barra de navegación de Android incluida); esto solo evita el doble espacio: el resultado es que
 * el footer queda a `keyboardOpenGap` del borde del teclado, ni más ni menos.
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
