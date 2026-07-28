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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// ABRIR UN SHEET BAJA EL TECLADO — la decisión del hook `hooks/useDismissKeyboardOnOpen`
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// ── EL BUG 🔴 QUE CIERRA (Raf, device Android, APK a3b8d804 / commit 56beff3) ────────────────────────
// En `maniobra/identificar`, con el input de caravana ENFOCADO y el teclado ABIERTO, tocar la ‹ del
// header (que abre el `ExitJornadaSheet` para terminar/abandonar la jornada) dejaba **el teclado
// arriba** y del sheet solo asomaba una franja de ~25px: los dos botones ("terminar maniobra" / "salir
// sin terminar") quedaban TAPADOS. Un diálogo de decisión, en un flujo 🔴 de manga, inoperable.
//
// ── POR QUÉ LA CONDUCTA CORRECTA ES BAJAR EL TECLADO (razón de producto, no parche técnico) ──────────
// Tocar "atrás para terminar la jornada" es SALIR DEL CONTEXTO DE ESCRITURA. El input que sostenía ese
// teclado queda detrás de un scrim: es inalcanzable, no se puede seguir tipeando en él y no hay ningún
// motivo para que su teclado sobreviva a la transición. Es además la convención de las dos plataformas
// (ley de Jakob) y lo que Raf esperaba textualmente ("el teclado no se cierra").
//
// ── Y ADEMÁS TAPA UN LÍMITE ESTRUCTURAL DEL LIFT ─────────────────────────────────────────────────────
// `KeyboardAvoidingShell` (el primitivo que sube las superficies por encima del teclado) tiene un
// límite DECLARADO en su header: si MONTA con el teclado ya abierto arranca en altura 0 hasta el
// próximo evento de insets (ni `KeyboardAnimationManager` en Android ni `keyboardWillChangeFrame` en
// iOS le reproducen el estado actual a un listener nuevo). Un sheet que se abre mientras se tipeaba es
// EXACTAMENTE ese caso. Si al abrirse el sheet no hay teclado, no hay nada que compensar y el límite
// deja de ser alcanzable por esta vía. (El `ExitJornadaSheet` del reporte ni siquiera monta el shell
// —no tiene input, así que el guard del teclado no se lo exige—, o sea que para él el lift no existía
// en absoluto: bajar el teclado es lo único que lo arregla sin agregarle un mecanismo que no necesita.)
//
// ── EL CONTRATO, Y POR QUÉ ES UNA TRANSICIÓN Y NO UN "cada render" ───────────────────────────────────
// Se baja el teclado en el flanco CERRADO→ABIERTO (incluido el montaje con `open=true`, que es como se
// usan los sheets que se montan/desmontan). NUNCA mientras el sheet ya está abierto: si el efecto
// volviera a disparar en cada render, el sheet no podría tener input PROPIO — cada tecla re-renderiza y
// el teclado se cerraría solo (`ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet`,
// `BreedPickerSheet`, `TagScanSheet`… quedarían inutilizables). Ese es el modo de falla que este
// predicado existe para lockear.

export interface DismissKeyboardOnOpenInput {
  /** ¿El sheet ya estaba abierto en el render anterior? (en el montaje, `false`). */
  wasOpen: boolean;
  /** ¿El sheet está abierto AHORA? */
  isOpen: boolean;
}

/**
 * ¿Hay que bajar el teclado? SOLO en el flanco cerrado→abierto.
 *
 *   montaje con open=true   (false → true)  → SÍ   (el caso de los sheets que se montan al abrirse)
 *   apertura de un sheet    (false → true)  → SÍ   (el caso de los sheets con prop `open` siempre montados)
 *   sigue abierto           (true  → true)  → NO   (si no, el input PROPIO del sheet sería inusable)
 *   se cierra               (true  → false) → NO   (al cerrar no tocamos el foco de nadie)
 *   sigue cerrado           (false → false) → NO
 */
export function shouldDismissKeyboardOnOpen({ wasOpen, isOpen }: DismissKeyboardOnOpenInput): boolean {
  return isOpen && !wasOpen;
}
