// Lógica PURA del primitivo BOTTOM SHEET del repo (`src/components/BottomSheetShell.tsx`).
// Sin RN, sin red: testeable con node:test.
//
// CONTEXTO — BUG 🔴 MANGA (Raf, device iOS): al enfocar el input de un bottom sheet, el teclado tapaba
// TODO el sheet (del "Vacunación" de la etapa 2 del wizard solo se veía el título): no se veía lo que se
// escribía, no había feedback de los chips ya cargados, y NINGÚN CTA para confirmar. Era un bug de CLASE:
// ningún sheet del repo tenía keyboard-avoidance (el patrón copiado a mano era `View absolute inset0
// $scrim` + backdrop + `YStack maxHeight 85%` anclado abajo, y en iOS el teclado se dibuja ENCIMA).
//
// El LIFT sobre el teclado (subir el sheet) lo hace el primitivo `components/KeyboardAvoidingShell` (iOS
// `behavior='padding'`; Android `paddingBottom` = alto del teclado, porque con edge-to-edge la ventana ya
// no se encoge sola) y la reserva de safe-area la resuelve `footer-action.ts` (`computeSafeBottomInset` +
// `resolveFooterPaddingBottom`, se REUSAN — no se reimplementan). Lo único propio del sheet es la DECISIÓN
// DE CONDENSACIÓN de acá abajo.

export interface SheetCondensationInput {
  /** ¿El teclado del SO está visible? (hook useKeyboardVisible). */
  keyboardVisible: boolean;
}

export interface SheetCondensation {
  /** ¿Se muestra el subtítulo/descripción del header? */
  showDescription: boolean;
  /** ¿Se muestra el CTA SECUNDARIO ("Cancelar"/"Cerrar") del footer? */
  showSecondaryAction: boolean;
  /** ¿Se muestra la X de cierre del header? (SIEMPRE — Nielsen #3, control y libertad). */
  showCloseButton: boolean;
}

/**
 * CONDENSACIÓN del sheet con el teclado ARRIBA. Con el teclado abierto el alto útil se parte al medio
 * (~55% de la pantalla se lo come el teclado), así que el sheet suelta lo prescindible para que entre lo
 * IMPRESCINDIBLE: contenido ya cargado (chips) + input + CTA primario.
 *
 *   - Se OCULTA la descripción del header: es ayuda de orientación, ya la leíste antes de tipear.
 *   - Se OCULTA el CTA secundario ("Cancelar"/"Cerrar"): es la acción de escape, no la que estás haciendo.
 *     Su función NO se pierde — la absorbe la X del header (+ el tap en el backdrop).
 *   - La X del header está SIEMPRE (con y sin teclado): Nielsen #3 "control y libertad del usuario" — la
 *     salida no puede depender de un elemento que aparece/desaparece, y con el teclado abierto es la ÚNICA
 *     salida visible sin bajar el teclado. Se devuelve como decisión (no como constante) para que quede
 *     LOCKEADA por test: si alguien la esconde con el teclado, el test cae.
 *
 * El TÍTULO nunca se condensa (identifica QUÉ estás cargando) ni el CTA primario (es el objetivo).
 */
export function sheetCondensation({ keyboardVisible }: SheetCondensationInput): SheetCondensation {
  return {
    showDescription: !keyboardVisible,
    showSecondaryAction: !keyboardVisible,
    showCloseButton: true,
  };
}
