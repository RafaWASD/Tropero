// sheet-gestures.ts — lógica PURA de las VÍAS DE CIERRE POR GESTO del primitivo bottom sheet
// (`src/components/BottomSheetShell.tsx`): el ARRASTRE-PARA-CERRAR y el BACK FÍSICO de Android.
// Sin RN, sin gesture-handler, sin reanimated: testeable con node:test. Las decisiones (¿desde dónde se
// puede arrastrar?, ¿cuánto se traslada?, ¿al soltar cierra o vuelve?, ¿qué hace el back?) viven acá para
// poder falsificarlas; el componente solo mide (alto del sheet, offset del scroll) y cablea los gestos.
//
// Las funciones llevan la directiva 'worklet' (el plugin de react-native-worklets las workletiza para que el
// gesto las llame en el UI thread; en Node/tests la directiva es un string inerte y son funciones comunes).
// Mismo patrón que `reorder-autoscroll.ts`: TODOS los umbrales entran por parámetro — las constantes viven
// exportadas acá (fuente única) y el componente las captura en el closure del gesto, así el worklet nunca
// depende de resolver un import en el runtime de UI.
//
// ── BUG 🔴 MANGA QUE CIERRA (Raf, device iOS) ─────────────────────────────────────────────────────────
// El shell DIBUJABA un grabber (`showGrip`, default true) pero NO tenía ningún gesture handler: un
// significante sin la acción que promete (Norman) — y peor, arrastrarlo hacía lo CONTRARIO de lo prometido:
// el arrastre caía al gesto nativo del modal de iOS y cerraba la PANTALLA DE ABAJO (la jornada entera) en
// vez del sheet de arriba. La convención de iOS (ley de Jakob) es que el sheet FRONTAL es el que se cierra
// primero, nunca el de atrás. Ahora el shell es dueño de su propio gesto (y el fix hermano en
// `app/app/_layout.tsx` le sacó el gesto de descarte a las pantallas de la jornada).
//
// ── LAS REGLAS, Y POR QUÉ ────────────────────────────────────────────────────────────────────────────
//  1. ANCLA: el HEADER (grabber + zona del título) arrastra SIEMPRE. Desde el BODY solo se arrastra si el
//     ScrollView está en el tope — si el operario tiene contenido scrolleado, ese arrastre es SUYO, no del
//     sheet ("nunca le robes el scroll"). Sin medida del header, fail-closed a la regla del body.
//  2. SOLO HACIA ABAJO: no hay snap points ni sheet expandible → arrastrar hacia arriba no traslada nada
//     (se clampea en 0) en vez de despegar el sheet de su ancla inferior.
//  3. AL SOLTAR: cierra si el recorrido pasó el umbral de DISTANCIA (fracción del alto del sheet, con piso
//     absoluto) **o** si fue un FLICK rápido hacia abajo con recorrido mínimo; si no, vuelve con spring.
//     Un flick hacia ARRIBA al soltar CANCELA el cierre aunque la distancia alcance (el operario se
//     arrepintió a mitad del gesto: la última intención manda). Fail-closed: cualquier medida ausente o no
//     finita NO cierra — perder lo cargado en el sheet por un NaN es el peor resultado posible.

/** Fracción del ALTO del sheet que hay que recorrer para que soltar cierre. 25% ≈ un cuarto del sheet:
 *  suficiente para no cerrarlo de un roce, poco para no exigir un arrastre de pantalla completa. */
export const SHEET_DISMISS_RATIO = 0.25;
/** Piso ABSOLUTO de recorrido (px) para cerrar por distancia. Protege a los sheets CORTOS (un sheet de 200px
 *  daría 50px con el ratio: demasiado poco para un dedo con barro). 64 ≈ 8× el umbral de activación del pan. */
export const SHEET_DISMISS_MIN_DISTANCE = 64;
/** Velocidad (px/s) hacia abajo que cierra con poco recorrido (flick). ~900 es un gesto claramente intencional;
 *  un arrastre lento y controlado queda por debajo y se juzga por distancia. */
export const SHEET_DISMISS_FLING_VELOCITY = 900;
/** Recorrido mínimo (px) que igual exige el flick: sin esto, un tap con micro-movimiento y velocidad alta
 *  podría cerrar el sheet sin que el operario haya arrastrado nada. */
export const SHEET_DISMISS_FLING_MIN_TRAVEL = 24;
/** Velocidad (px/s) hacia ARRIBA al soltar que CANCELA el cierre aunque la distancia alcance (arrepentimiento). */
export const SHEET_DISMISS_CANCEL_VELOCITY = 300;
/** Umbral (px) de activación del pan: por debajo de esto el toque sigue siendo un tap / un scroll. */
export const SHEET_DRAG_ACTIVATE_Y = 8;

// ─── 1. ¿Desde dónde se puede arrastrar? ─────────────────────────────────────────────────────────────

/**
 * ZONA del sheet donde nació el toque. El componente monta **un detector por zona, espacialmente DISJUNTOS**
 * (el del header solo sobre el header; el del cuerpo solo sobre el `ScrollView`) → cada toque lo trackea UN
 * solo Pan. No es cosmética: cuando dos Pan anidados ven el mismo toque, en iOS **no hay orquestador** de
 * gesture-handler (la exclusión la hace UIKit), y el orden entre el Failed del perdedor y el Began del
 * ganador es interno de UIKit → cualquier estado compartido entre las dos instancias queda a merced de ese
 * orden. Con detectores disjuntos el invariante no depende del dispatch. El **FOOTER no es zona de
 * arrastre**: ahí viven los CTAs (arrastrar desde un botón no es una intención de cerrar).
 */
export type SheetDragZone = 'header' | 'body';

export type SheetDragGateInput = {
  /** Zona donde nació el toque (= qué detector lo está atendiendo). */
  zone: SheetDragZone;
  /** ¿El ScrollView del body está en el tope (offset ≤ 0)? */
  bodyAtTop: boolean;
};

/**
 * ¿Este toque puede arrastrar el sheet? **Header → siempre** (es el ancla: grabber + título, como cualquier
 * sheet de iOS). **Cuerpo → solo con el body en el TOPE**, para no robarle el scroll al contenido.
 *
 * Fail-closed por defecto: toda zona que no sea el header se juzga con la regla conservadora del cuerpo.
 */
export function sheetDragAllowedFrom({ zone, bodyAtTop }: SheetDragGateInput): boolean {
  'worklet';
  if (zone === 'header') return true;
  return bodyAtTop === true;
}

// ─── 2. ¿Cuánto se traslada? ─────────────────────────────────────────────────────────────────────────

/**
 * Traslación VISUAL del sheet para un desplazamiento crudo del dedo: 1:1 hacia abajo (manipulación directa),
 * 0 hacia arriba (el sheet está anclado abajo y no tiene snap points). NaN/±Infinity → 0.
 */
export function sheetDragOffset(rawTranslationY: number): number {
  'worklet';
  if (!Number.isFinite(rawTranslationY) || rawTranslationY <= 0) return 0;
  return rawTranslationY;
}

// ─── 3. ¿Al soltar cierra o vuelve? ──────────────────────────────────────────────────────────────────

export type SheetDismissInput = {
  /** Recorrido acumulado hacia abajo al soltar (px, ya clampeado por `sheetDragOffset`). */
  translationY: number;
  /** Velocidad vertical al soltar (px/s; + hacia abajo, − hacia arriba). */
  velocityY: number;
  /** Alto MEDIDO del sheet (px). 0 / no finito → solo se juzga contra el piso absoluto. */
  sheetHeight: number;
  /** Fracción del alto que dispara el cierre (SHEET_DISMISS_RATIO). */
  ratio: number;
  /** Piso absoluto de recorrido (SHEET_DISMISS_MIN_DISTANCE). */
  minDistance: number;
  /** Velocidad de flick que cierra con poco recorrido (SHEET_DISMISS_FLING_VELOCITY). */
  flingVelocity: number;
  /** Recorrido mínimo que igual exige el flick (SHEET_DISMISS_FLING_MIN_TRAVEL). */
  flingMinTravel: number;
  /** Velocidad hacia arriba que cancela el cierre (SHEET_DISMISS_CANCEL_VELOCITY). */
  cancelVelocity: number;
};

/**
 * ¿Soltar acá CIERRA el sheet? Distancia (fracción del alto, con piso) **o** flick rápido hacia abajo;
 * un flick hacia arriba cancela. Fail-closed ante cualquier medida no finita: NO cierra (volver con spring
 * es recuperable; cerrar de más pierde lo que el operario estaba cargando).
 */
export function shouldDismissSheet({
  translationY,
  velocityY,
  sheetHeight,
  ratio,
  minDistance,
  flingVelocity,
  flingMinTravel,
  cancelVelocity,
}: SheetDismissInput): boolean {
  'worklet';
  if (!Number.isFinite(translationY) || translationY <= 0) return false;
  if (!Number.isFinite(velocityY)) return false;

  // Arrepentimiento: soltó tirando hacia ARRIBA → vuelve, aunque el recorrido alcanzara.
  const cancelAt = Number.isFinite(cancelVelocity) && cancelVelocity > 0 ? cancelVelocity : 0;
  if (cancelAt > 0 && velocityY <= -cancelAt) return false;

  // Piso absoluto: si no es utilizable, NO inventamos umbral (fail-closed).
  const floor = Number.isFinite(minDistance) && minDistance > 0 ? minDistance : Number.POSITIVE_INFINITY;
  // Umbral por distancia: el mayor entre el piso y la fracción del alto medido. Sin alto medido, el piso.
  const byRatio =
    Number.isFinite(sheetHeight) && sheetHeight > 0 && Number.isFinite(ratio) && ratio > 0
      ? sheetHeight * ratio
      : 0;
  const distanceThreshold = Math.max(floor, byRatio);
  if (translationY >= distanceThreshold) return true;

  // Flick hacia abajo: rápido Y con recorrido mínimo (un tap tembloroso no cierra).
  const flingAt = Number.isFinite(flingVelocity) && flingVelocity > 0 ? flingVelocity : Number.POSITIVE_INFINITY;
  const travelAt = Number.isFinite(flingMinTravel) && flingMinTravel > 0 ? flingMinTravel : Number.POSITIVE_INFINITY;
  return velocityY >= flingAt && translationY >= travelAt;
}

// ─── 4. ¿Qué hace el arrastre con el TECLADO ABIERTO? ────────────────────────────────────────────────

export type SheetDragIntent = 'dismiss-keyboard' | 'drag-sheet';

/**
 * DECISIÓN (una sola, no las dos): con el teclado ARRIBA, el arrastre hacia abajo **baja el teclado y NO
 * cierra el sheet**. Cerrar el sheet requiere un segundo gesto (o la X del header, que está SIEMPRE).
 *
 * Por qué:
 *   - El teclado está abierto porque el operario está TIPEANDO (una vacuna, el nombre de una rutina). Un
 *     gesto que cierra el sheet ahí borra lo tipeado: es la misma clase de bug destructivo que este fix vino
 *     a matar. Bajar el teclado es reversible; cerrar el sheet, no.
 *   - "Arrastrar hacia abajo baja el teclado" ya es el idiom del sistema (`keyboardDismissMode: 'on-drag'`),
 *     así que no inventamos una interacción nueva (ley de Jakob).
 *   - Técnico: con el teclado arriba el sheet está LEVANTADO por el KeyboardAvoidingView; trasladarlo al
 *     mismo tiempo que el KAV re-layoutea es pelearse con dos animaciones por el mismo píxel.
 *   - La salida sigue disponible sin ambigüedad: la X del header no se condensa nunca (Nielsen #3).
 */
export function sheetDragIntent({ keyboardVisible }: { keyboardVisible: boolean }): SheetDragIntent {
  'worklet';
  return keyboardVisible ? 'dismiss-keyboard' : 'drag-sheet';
}

// ─── 5. BACK FÍSICO de Android ───────────────────────────────────────────────────────────────────────

/**
 * Qué hace el **botón físico de atrás** de Android con un sheet abierto: **cierra el sheet y CONSUME el
 * evento** (devuelve `true`).
 *
 * Por qué importa (bug de la misma clase que el arrastre): en Android el back **no es un descubrimiento
 * accidental, es el botón que el operario usa todo el tiempo**. Sin este handler, el back con un sheet
 * abierto no cierra el sheet: hace **pop de la RUTA** — en el wizard eso se lleva puesta la configuración
 * entera de la jornada, que es exactamente el daño que este delta vino a matar en iOS.
 *
 * Dos invariantes que este helper deja LOCKEADOS por test:
 *   1. **Cierra por el MISMO `onClose` del sheet**, no por un atajo: ese callback es el que hace el flush de
 *      lo tipeado-sin-agregar (`pendingCloseCommit` del `ManeuverConfigSheet`) — un `setState(false)` directo
 *      perdería el dato.
 *   2. **Consume SIEMPRE** (`true`) mientras el sheet esté montado: devolver `false` dejaría que el evento
 *      siga hasta el navigator y ahí vuelve el pop de ruta (el bug).
 * El orden entre sheets superpuestos NO se decide acá: lo da el orden de suscripción de RN (el último
 * handler registrado corre primero) y el componente se suscribe UNA vez al montar → gana el de más arriba.
 */
export function sheetBackPress(close: () => void): boolean {
  close();
  return true;
}

/**
 * ¿Corresponde REGISTRAR el handler de back en esta plataforma? Solo **Android**: es la única con botón
 * atrás de hardware (en iOS el evento no existe; en web tampoco). Es un predicado PURO —y no un
 * `Platform.OS !== 'android'` suelto— porque es la rama que gatea la vía de cierre de los 4 sheets y sin
 * test sería la única decisión del módulo sin cubrir. Mismo patrón que `shouldRegisterHardwareBack` del
 * hook de pantalla (`utils/maniobra-back.ts`): NO se importa aquel para no meter una util de maniobra
 * dentro de un primitivo genérico de `src/components` (lo usa también spec 08).
 */
export function sheetBackHandlerApplies(os: string): boolean {
  return os === 'android';
}
