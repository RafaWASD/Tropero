// BottomSheetShell — primitivo REUSABLE del BOTTOM SHEET del repo: backdrop $scrim tappable + sheet
// anclado abajo con header FIJO / body SCROLL / footer FIJO, **keyboard-aware**. Es el hermano de
// `FooterActionShell` (que resolvió el mismo patrón para PANTALLAS) y reusa su lógica pura de safe-area.
// Cero hardcode (ADR-023 §4): todo por tokens; lo que cruza a APIs no-Tamagui, vía getTokenValue.
//
// ── POR QUÉ EXISTE — BUG 🔴 MANGA (Raf, device iOS, build preview-dev) ────────────────────────────────
// Al enfocar el input de un bottom sheet, el teclado tapaba TODO el sheet: del "Vacunación" de la etapa 2
// del wizard solo se veía el TÍTULO — el input, los chips ya agregados, el botón "+", las sugerencias y
// los DOS CTAs quedaban DEBAJO del teclado ("no se ve lo que estás escribiendo, no tenés feedback de si
// escribiste la vacuna bien o mal, y no ves ningún CTA para confirmar"). Era un bug de CLASE, no de
// instancia: NINGÚN sheet del repo tenía keyboard-avoidance — el patrón as-built (copiado a mano en cada
// sheet) era `View absolute inset0 $scrim justifyContent:flex-end` + backdrop + `YStack maxHeight 85%`
// anclado abajo, y en iOS el teclado se dibuja ENCIMA de eso sin empujar nada.
//
// ── LAS RESPONSABILIDADES QUE ENCAPSULA (las 2 últimas —arrastre y back— tienen bloque propio abajo) ──
// El contrato normativo para consumidores (incl. las DOS precondiciones de adopción) vive en
// `docs/design-system.md` §6 → `BottomSheetShell`.
//  1. BACKDROP $scrim tappable que cierra, CON el guard anti "click huérfano" de web (doble rAF) — ver el
//     comentario largo del guard más abajo (conocimiento caro, no se pierde).
//  2. LIFT sobre el teclado: `KeyboardAvoidingView` ('padding' en iOS; en Android lo resuelve el
//     adjustResize de la ventana — Expo default `softwareKeyboardLayoutMode`, verificado sin override en
//     `app.config.ts`) + reserva de safe-area que ENCOGE con el teclado abierto (sin doble espacio:
//     `resolveFooterPaddingBottom` de `utils/footer-action.ts`, la misma de FooterActionShell).
//  3. ESQUELETO CANÓNICO: header FIJO (flexShrink:0) / body ScrollView (flexShrink:1 + minHeight:0) /
//     footer FIJO (flexShrink:0) → el título nunca se recorta al crecer el contenido y el CTA nunca se va
//     abajo del fold (skill design-review + memoria feedback_ux_basicos_sheets_forms).
//  4. CONDENSACIÓN con el teclado ARRIBA (decisión pura `sheetCondensation`): se suelta la descripción y
//     el CTA secundario; quedan SIEMPRE el título, el contenido cargado, el input y el CTA primario. La X
//     del header existe SIEMPRE (Nielsen #3: con el teclado abierto es la única salida visible).
//  5. SAFE-AREA robusta = inset del sistema (con blindaje frame-0 de Android edge-to-edge) + el piso de
//     web + el aire contra la barra de navegación en Android: hook compartido `useSafeBottomInset`,
//     misma fórmula que el bottom-nav y los footers.
//  5-bis. AFFORDANCE DE SCROLL del body (peek + fade + chevron ▾) con la MISMA decisión pura que
//     `FooterActionShell` y las listas de maniobra (`shouldShowScrollPeek`): aire al final del contenido
//     para que el último elemento nunca quede rebanado al ras del CTA, y señal de "hay más abajo" cuando
//     el body desborda (el indicador nativo está apagado y en iOS solo se ve mientras scrolleás).
//
// ── 6ta RESPONSABILIDAD: ARRASTRE-PARA-CERRAR (bug 🔴 manga, Raf device iOS) ─────────────────────────
// El shell DIBUJABA un grabber (`showGrip`, default true, ningún consumidor lo pisa) pero NO tenía ningún
// gesture handler: un significante sin la acción que promete (Norman). Y hacía lo CONTRARIO de lo prometido:
// el arrastre caía al gesto de descarte del modal de iOS y cerraba la PANTALLA DE ABAJO (la jornada entera)
// en vez del sheet de arriba — cuando la convención de iOS (ley de Jakob) es que el sheet FRONTAL es el que
// se cierra primero. Ahora el shell es dueño de su gesto (y el fix hermano de `app/app/_layout.tsx` le sacó
// el gesto de descarte a las pantallas de la jornada, así ya no hay dos dueños para el mismo arrastre).
// Reglas (las decisiones PURAS viven en `utils/sheet-gestures.ts`, testeadas):
//   · DOS detectores en vistas DISJUNTAS: uno sobre el HEADER (grabber + título) y otro sobre el ScrollView
//     del BODY. Ningún toque lo ven los dos (ver el porqué en el comentario de `headerInert`/`bodyInert`) y
//     el FOOTER no es ancla de arrastre: ahí viven los CTAs.
//   · ANCLA = el HEADER: arrastra SIEMPRE. Desde el BODY, solo con el ScrollView en el TOPE — si hay
//     contenido scrolleado, ese arrastre es del operario, no del sheet.
//   · Solo hacia ABAJO (no hay snap points): hacia arriba se clampea en 0.
//   · Al soltar: cierra por DISTANCIA (25% del alto del sheet, con piso absoluto) o por FLICK rápido; un
//     flick hacia arriba cancela; si no alcanza, vuelve con spring. Fail-closed ante medidas rotas.
//   · Con el TECLADO ARRIBA el arrastre BAJA EL TECLADO y NO cierra (una sola conducta, ver `sheetDragIntent`).
//   · Al cerrar llamamos `onClose()` y ADEMÁS devolvemos el sheet a su lugar con spring: los 4 consumidores
//     DESMONTAN el shell al cerrar (el reset es invisible), y si alguno alguna vez no lo desmontara, el sheet
//     queda en su lugar en vez de trabado fuera de pantalla (fail-safe, no "sheet fantasma").
// WEB (`touchAction`): el detector del cuerpo va con `touch-action: pan-y` para NO romper el scroll táctil
// del body en react-native-web (el default de RNGH es `none`, que se lo comería). El del header queda en
// `none` (ahí no hay nada que scrollear) → el arrastre del grabber también anda en web táctil.
//
// ── 7ma RESPONSABILIDAD: el BACK FÍSICO de Android cierra EL SHEET, no la ruta ───────────────────────
// Mismo bug de clase que el arrastre, en la plataforma donde el gesto NO es un descubrimiento accidental
// sino el botón que el operario usa todo el tiempo: sin handler, el back con un sheet abierto no cierra el
// sheet — hace **pop de la RUTA** (en el wizard, chau configuración de la jornada). El shell registra un
// `BackHandler` mientras está montado que cierra por el MISMO `onClose` (ahí vive el flush de lo tipeado
// sin agregar) y CONSUME el evento. Sheets superpuestos: RN corre los handlers en orden inverso al de
// registro y el shell se suscribe UNA sola vez al montar → atiende el de más arriba (la guarda de PANTALLA
// —`useHardwareBack` de las 3 pantallas del flujo— se registra ANTES y difiere al sheet, por diseño). Solo
// Android: es la única plataforma con back físico. (El stub de `BackHandler` de react-native-web loguea un
// `console.error` al suscribirse, aunque en el export web de este repo se midió que no resuelve a ese stub;
// igual no registramos: en iOS/web el evento nunca puede disparar.)
//
// ── ⚠️ NUNCA `flex={1}` EN EL BODY (bug U5, ya arreglado una vez) ────────────────────────────────────
// El body va `flexShrink={1}` (grow:0, shrink:1, basis:auto), NO `flex:1` (grow:1, basis:0%). Con flex:1 el
// body COLAPSABA A ALTURA 0 en NATIVO cuando el contenido es corto: la caja del sheet (cap `maxHeight:85%`,
// SIN alto fijo — desde el fix del arrastre ese cap vive en la envoltura animada, misma geometría)
// se dimensiona por CONTENIDO; si el contenido no llega al cap del 85% no hay "espacio libre" que un
// flexGrow:1 pueda absorber → en Yoga el ScrollView cae a su basis:0% → altura 0 (en web no pasaba, por eso
// la E2E no lo cazó: era el bug 🔴 "no se ve el input para cargar vacunas"). Con flexShrink:1/basis:auto:
//   · contenido CORTO → se dimensiona al contenido (el input SE VE). ✅
//   · contenido ALTO (muchos chips + sugerencias + teclado) → el padre clampea al maxHeight y, como header
//     y footer son flexShrink:0, ESTE ScrollView (shrink:1) absorbe el faltante, se achica y SCROLLEA
//     internamente, con el footer siempre abajo. ✅
// `minHeight:0` se conserva (necesario en web para que el flex item pueda achicarse bajo su contenido).
// La MISMA razón vale para el `flexShrink={1}` de la COLUMNA del sheet: con el teclado arriba el alto útil
// se parte al medio y la columna tiene que poder achicarse (si no, se desborda hacia ARRIBA y el título se
// va de pantalla) sin colapsar cuando el contenido es corto.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView as RNScrollView,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronDown, X } from 'lucide-react-native';

import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { useSafeBottomInset } from '../hooks/useSafeBottomInset';
import { buttonA11y } from '../utils/a11y';
import { resolveFooterPaddingBottom, shouldShowScrollPeek } from '../utils/footer-action';
import {
  SHEET_DISMISS_CANCEL_VELOCITY,
  SHEET_DISMISS_FLING_MIN_TRAVEL,
  SHEET_DISMISS_FLING_VELOCITY,
  SHEET_DISMISS_MIN_DISTANCE,
  SHEET_DISMISS_RATIO,
  SHEET_DRAG_ACTIVATE_Y,
  sheetBackHandlerApplies,
  sheetBackPress,
  sheetDragAllowedFrom,
  sheetDragIntent,
  sheetDragOffset,
  shouldDismissSheet,
  type SheetDragZone,
} from '../utils/sheet-gestures';
import { sheetCondensation } from '../utils/sheet-shell';

/** El tipo EXACTO del 1er arg de getTokenValue (token de la escala) — evita el `string` genérico. */
type TamaguiToken = Parameters<typeof getTokenValue>[0];

// Estilos de APIs no-Tamagui (KeyboardAvoidingView / Pressable del backdrop). `flex`/`width` no son
// color ni spacing con token semántico → no aplica el lint anti-hardcode (ADR-023 §4).
const avoidStyle = { flex: 1, width: '100%', justifyContent: 'flex-end' } as const;
const backdropStyle = { flex: 1, width: '100%' } as const;
const bodyStyle = { minHeight: 0 } as const;
// El LinearGradient (API no-Tamagui) llena su contenedor, que sí está posicionado por tokens.
const fadeFillStyle = { flex: 1, width: '100%' } as const;

// Spring de VUELTA del arrastre cuando no alcanzó el umbral: rápido, con un toque de rebote (misma familia
// que el spring de reflow del reorder). Es geometría de gesto, no spacing themeable → const nombrada.
const RETURN_SPRING = { damping: 22, stiffness: 220, mass: 0.6 } as const;

export type BottomSheetShellProps = {
  /** Título del sheet (heading $7 con lineHeight matching — nunca se condensa). */
  title: string;
  /** Sub-línea de ayuda del header. Se OCULTA con el teclado abierto (condensación). */
  description?: string;
  /** Contenido del body (scrolleable). */
  children: ReactNode;
  /** CTA PRIMARIO — footer fijo, visible SIEMPRE (también con el teclado arriba). */
  footer?: ReactNode;
  /**
   * CTA SECUNDARIO ("Cancelar"/"Cerrar") — se OCULTA con el teclado arriba (su función la absorbe la X del
   * header + el tap en el backdrop). Si el sheet NO tiene `footer` (caso picker: la acción primaria es tocar
   * una fila), con el teclado arriba el footer desaparece ENTERO — buscado: le devuelve todo el alto útil a
   * la lista, y la salida sigue disponible en la X.
   */
  secondaryFooter?: ReactNode;
  /** Cerrar el sheet: lo disparan el backdrop (con guard) y la X del header. */
  onClose: () => void;
  /** testID del CONTENEDOR del sheet (el que ya usan los E2E). */
  testID: string;
  /** testID del backdrop/scrim (el que ya usan los E2E). */
  scrimTestID: string;
  /** testID de la X de cierre. Default `${testID}-close`. */
  closeTestID?: string;
  /** testID del ScrollView del body (oráculos de geometría del e2e). Sin default. */
  bodyTestID?: string;
  /** Label a11y del backdrop. Default 'Cerrar'. */
  scrimA11yLabel?: string;
  /** Label a11y de la X. Default 'Cerrar'. */
  closeA11yLabel?: string;
  /** Alto máximo del sheet (fracción de la pantalla visible). Default '85%'. */
  maxHeight?: `${number}%`;
  /** Ref al ScrollView del body (scroll-al-campo de validación desde el sheet concreto). */
  scrollViewRef?: React.Ref<RNScrollView>;
  /** gap del contentContainer del body (token de space). Default '$3'. */
  contentGap?: TamaguiToken;
  /** onLayout del ScrollView del body (alto del viewport para scroll determinista). */
  onBodyLayout?: (e: LayoutChangeEvent) => void;
  /** onContentSizeChange del ScrollView del body (scroll encadenado al crecimiento real). */
  onBodyContentSizeChange?: (w: number, h: number) => void;
  /**
   * keyboardShouldPersistTaps del body. Default 'handled' — con el teclado ABIERTO, un tap sobre un chip
   * de sugerencia / una opción de la lista dispara su onPress en el PRIMER toque (con el default 'never'
   * de RN el primer tap solo baja el teclado y se pierde: dos toques por dato en la manga).
   */
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  /** ¿Grip visual arriba? Default true. */
  showGrip?: boolean;
};

export function BottomSheetShell({
  title,
  description,
  children,
  footer,
  secondaryFooter,
  onClose,
  testID,
  scrimTestID,
  closeTestID,
  bodyTestID,
  scrimA11yLabel = 'Cerrar',
  closeA11yLabel = 'Cerrar',
  maxHeight = '85%',
  scrollViewRef,
  contentGap = '$3',
  onBodyLayout,
  onBodyContentSizeChange,
  keyboardShouldPersistTaps = 'handled',
  showGrip = true,
}: BottomSheetShellProps) {
  const keyboardVisible = useKeyboardVisible();
  // Reserva inferior canónica con el teclado CERRADO — hook compartido de la app.
  const safeBottomInset = useSafeBottomInset();
  const { showDescription, showSecondaryAction, showCloseButton } = sheetCondensation({ keyboardVisible });

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web, Raf) ──
  // Un sheet se abre por un tap (un `Gesture.Tap()` de gesture-handler en la fila de maniobra, o el
  // onPress de un botón). En WEB TÁCTIL ese tap deja un `click` DOM nativo que se dispara DESPUÉS del
  // pointerup y se RE-HIT-TESTEA contra lo que haya bajo el dedo: para entonces el sheet ya montó y su
  // SCRIM (un Pressable con onPress=onClose que cubre la pantalla) está justo ahí → lo cierra al instante
  // (~1ms). En NATIVE el gesto consume el touch y no hay click suelto → por eso solo se ve en web. Fix: el
  // scrim ignora presses hasta estar "listo para descartar". Arranca false al montar y se activa en el
  // PRÓXIMO frame (doble requestAnimationFrame): para entonces el click huérfano del open ya pasó, pero un
  // tap DELIBERADO posterior del usuario SÍ cierra (no rompe la salida por backdrop, R3/UX). El guard es
  // SOLO para el scrim; la X / los CTAs / los chips andan desde el 1er tick (no pasan por acá). Usamos un
  // ref (no estado): el scrim lo lee en el onPress, sin re-render. Fallback setTimeout(0) por si rAF no
  // está disponible (entornos sin DOM). Regresión cubierta por e2e/maniobra-config-sheet-race.spec.ts.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      readyToDismissRef.current = true;
    };
    if (typeof requestAnimationFrame === 'function') {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(arm);
      });
    } else {
      timer = setTimeout(arm, 0);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Cierre por backdrop gateado: ignora el press si el guard todavía no se armó (click huérfano del open).
  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  // Reserva inferior: con el teclado cerrado, la canónica del repo (`useSafeBottomInset`, con el
  // blindaje frame-0 de Android edge-to-edge adentro); con el teclado abierto, un respiro chico (la
  // safe-area la tapa el teclado → reservarla dejaría un hueco feo SOBRE el teclado).
  const paddingBottom = resolveFooterPaddingBottom({
    keyboardVisible,
    safeInset: safeBottomInset,
    keyboardOpenGap: getTokenValue('$2', 'space'),
  });

  const hasFooter = footer != null || (secondaryFooter != null && showSecondaryAction);

  // ── BACK FÍSICO de Android (ver cabecera §7ma responsabilidad) ──────────────────────────────────
  // Con el sheet abierto, el back CIERRA EL SHEET y consume el evento; sin esto hace pop de la RUTA (en el
  // wizard se lleva puesta la jornada entera). Cierra por el MISMO `onClose` (ahí vive el flush de lo
  // tipeado-sin-agregar del ManeuverConfigSheet), vía la regla pura `sheetBackPress`.
  // SUSCRIPCIÓN ÚNICA AL MONTAR (deps `[]` + ref al callback): RN corre los handlers en orden INVERSO al de
  // registro → el último sheet MONTADO (el de más arriba) atiende primero y consume, y los de abajo no se
  // enteran. Si re-suscribiéramos en cada cambio de identidad de `onClose`, un sheet de abajo podría pasar a
  // ser "el último registrado" y robarle el back al de arriba.
  // ⚠️ PRECONDICIÓN DE ADOPCIÓN: el handler se registra al MONTAR, no al "abrir" (el shell no tiene noción de
  // abierto/cerrado). Los 4 consumidores DESMONTAN el shell al cerrar, así que el back solo se intercepta
  // mientras hay sheet a la vista. Un consumidor que lo dejara montado detrás de un toggle de visibilidad se
  // comería TODOS los back de Android de la app, en silencio (ese patrón existe en el repo: `carga.tsx`
  // renderiza `LotePickerSheet` siempre montado con prop `open`). Está declarado en el contrato del shell
  // (`docs/design-system.md` §6, responsabilidad 9).
  // Plataforma: predicado PURO y testeado (`sheetBackHandlerApplies`) — solo Android tiene back de hardware.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!sheetBackHandlerApplies(Platform.OS)) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => sheetBackPress(() => onCloseRef.current()));
    return () => sub.remove();
  }, []);

  // ── ARRASTRE-PARA-CERRAR (ver cabecera §6ta responsabilidad) ────────────────────────────────────
  // Estado del gesto en el UI thread: traslación actual, alto medido del sheet (para el umbral por
  // fracción) y un flag de "gesto inerte" POR DETECTOR.
  const translateY = useSharedValue(0);
  const sheetHeight = useSharedValue(0);
  // El gesto en curso NO mueve el sheet. Dos motivos, un flag: (a) el toque arrancó en una zona que no
  // habilita el arrastre (cuerpo con scroll), (b) el arrastre se consumió BAJANDO EL TECLADO. Se limpia en
  // el `onFinalize` de su propio gesto.
  // UNO POR DETECTOR, no compartido: `onFinalize` corre también en FAILED/CANCELLED, así que un flag común
  // entre dos Pan permite que el gesto perdedor lo resetee a `false` DESPUÉS de que el ganador lo puso en
  // `true` (en iOS el orden entre el Failed del perdedor y el Began del ganador lo decide UIKit, no RNGH) →
  // con el teclado arriba el sheet podría cerrarse igual y descartar lo tipeado. Los detectores además son
  // espacialmente DISJUNTOS (ningún toque lo ven los dos), así que esto es el segundo cerrojo: el invariante
  // queda local a cada gesto y no depende de que nadie vuelva a anidarlos.
  const headerInert = useSharedValue(false);
  const bodyInert = useSharedValue(false);

  // ⚠️ NUNCA le pases a `runOnJS` un MÉTODO DE MÓDULO pelado (`runOnJS(Keyboard.dismiss)`, `runOnJS(
  // Clipboard.setString)`…): **crashea DURO la app en device** (Raf, iOS, build 76f0837c — "si toco el
  // grabber con el teclado abierto la app crashea por completo"). Mecanismo, verificado leyendo la salida
  // REAL de babel de este archivo + el serializador de `react-native-worklets` 0.8.3:
  //   1. El plugin captura en el `__closure` del worklet el IDENTIFICADOR RAÍZ de la expresión → capturaba
  //      el objeto `Keyboard` ENTERO (una instancia de la clase `KeyboardImpl` de RN), no la función.
  //   2. `createSerializable` (memory/serializable.native.js) solo sabe clonar objetos con prototipo
  //      `Object.prototype`, host objects y TurboModules; una instancia de clase cae en
  //      `inaccessibleObject()` → en el runtime de UI queda un **Proxy que TIRA ante CUALQUIER acceso**.
  //   3. Por eso no explota al abrir el sheet (el proxy se crea callado) sino recién cuando se LEE
  //      `Keyboard.dismiss` — es decir, SOLO en la rama del teclado abierto. Y un throw dentro de un
  //      callback de gesto en el hilo de UI, en release, no burbujea como error de JS: revienta nativo.
  // (No era el `this`: el `dismiss()` de RN 0.85 no usa `this`, llama al helper `dismissKeyboard`.)
  // El camino correcto es SIEMPRE un callback JS propio y estable, como este: el closure captura una
  // función común → worklets la convierte en `remoteFunction` y `runOnJS` la agenda sin tocar módulos.
  // Lockeado por `src/components/worklet-callbacks-guard.test.ts` (escanea el árbol y falla ante el patrón).
  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);
  // El teclado se lee del hook (JS) y se espeja a un shared value: el worklet del gesto necesita el valor
  // VIVO al momento del toque, no el capturado cuando se creó el gesto.
  const keyboardUp = useSharedValue(keyboardVisible);
  useEffect(() => {
    keyboardUp.value = keyboardVisible;
  }, [keyboardVisible, keyboardUp]);

  // ── GEOMETRÍA DEL BODY: gate del arrastre + affordance de scroll ────────────────────────────────
  // Dos consumidores de la MISMA geometría, actualizados en el mismo handler:
  //  · `bodyAtTop` (¿el ScrollView está en el tope?) gatea el arrastre iniciado DENTRO del body: con
  //    contenido scrolleado ese arrastre es scroll del operario y NO se lo robamos. Es estado de React
  //    (no shared value) porque alimenta `.enabled()` del gesto; solo cambia al CRUZAR el tope.
  //  · `showPeek` (¿queda contenido oculto ABAJO?) prende el fade + chevron del borde inferior del body.
  //    Decisión PURA compartida con `FooterActionShell` y con las listas de maniobra
  //    (`shouldShowScrollPeek` de `utils/footer-action.ts`) → una sola fuente de verdad del affordance.
  const [bodyAtTop, setBodyAtTop] = useState(true);
  const [showPeek, setShowPeek] = useState(false);
  const bodyAtTopRef = useRef(true);
  const showPeekRef = useRef(false);
  const bodyGeom = useRef({ scrollY: 0, viewport: 0, content: 0 });
  const recomputeBody = useCallback(() => {
    const { scrollY, viewport, content } = bodyGeom.current;
    const atTop = scrollY <= 0.5;
    if (atTop !== bodyAtTopRef.current) {
      bodyAtTopRef.current = atTop;
      setBodyAtTop(atTop);
    }
    const peek = shouldShowScrollPeek({ scrollY, viewportHeight: viewport, contentHeight: content });
    if (peek !== showPeekRef.current) {
      showPeekRef.current = peek;
      setShowPeek(peek);
    }
  }, []);
  const onBodyScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      bodyGeom.current = {
        scrollY: e.nativeEvent.contentOffset.y,
        viewport: e.nativeEvent.layoutMeasurement.height,
        content: e.nativeEvent.contentSize.height,
      };
      recomputeBody();
    },
    [recomputeBody],
  );
  // El alto del viewport y el del contenido también llegan por layout/content-size (antes del primer scroll:
  // es lo que hace aparecer el fade en un sheet que ya nace desbordado). Se ENCADENAN con los callbacks del
  // consumidor — que los usa para su scroll-al-campo — en vez de pisarlos.
  const onBodyLayoutChained = useCallback(
    (e: LayoutChangeEvent) => {
      bodyGeom.current.viewport = e.nativeEvent.layout.height;
      recomputeBody();
      onBodyLayout?.(e);
    },
    [onBodyLayout, recomputeBody],
  );
  const onBodyContentSizeChained = useCallback(
    (w: number, h: number) => {
      bodyGeom.current.content = h;
      recomputeBody();
      onBodyContentSizeChange?.(w, h);
    },
    [onBodyContentSizeChange, recomputeBody],
  );

  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      sheetHeight.value = e.nativeEvent.layout.height;
    },
    [sheetHeight],
  );

  // El gesto de arrastre, UNO POR ZONA. Los dos comparten TODA la lógica (mismo umbral, mismo fail-closed,
  // misma conducta con el teclado) y se diferencian solo en el gate de zona y en su flag `inert` propio.
  // `zone` y `bodyAtTop` entran POR PARÁMETRO (no por closure) para que el builder NO dependa de `bodyAtTop`:
  // así cruzar el tope del scroll no reconstruye el gesto del header (que no lo lee).
  const buildDragGesture = useCallback(
    ({ zone, inert, bodyAtTop: atTop }: { zone: SheetDragZone; inert: SharedValue<boolean>; bodyAtTop: boolean }) =>
      Gesture.Pan()
        // Se activa SOLO tras cruzar el umbral HACIA ABAJO (un tap sobre la X / un chip nunca lo dispara)
        // y FALLA ante movimiento hacia arriba → el scroll del body se va limpio, sin competencia.
        .activeOffsetY(SHEET_DRAG_ACTIVATE_Y)
        .failOffsetY(-SHEET_DRAG_ACTIVATE_Y)
        // ⚠️ CADA CALLBACK VA ENVUELTO EN try/catch. NO es paranoia decorativa: una excepción NO ATRAPADA
        // dentro de un worklet **mata la app entera** (SIGABRT), sin redbox y sin log de JS — así crasheó
        // este mismo shell en device (ver el bloque de `dismissKeyboard`; el `.ips` de Raf muestra
        // `runSyncOnRuntime → HermesRuntimeImpl::call → throwPendingError → std::terminate → abort`). El
        // guard de worklets (`callGuardDEV`) **solo existe en builds de DEBUG** (lo dice su propio archivo:
        // "Used only with debug builds"): en release nadie atrapa nada. Así que degradamos a "el gesto no
        // hace nada" (misma política fail-closed que ya usa la geometría no finita) en vez de cerrar la app
        // en medio de una jornada. En DEV **re-lanzamos** para no tapar el error: ahí sí hay callGuard y
        // sale por el canal normal (`__DEV__` se lee dentro de worklets — el propio `withTiming` de
        // reanimated lo hace). La recuperación de cada `catch` solo escribe shared values, así que EN LA
        // PRÁCTICA no puede re-tirar (son `useSharedValue` legítimos = host objects serializables). No es
        // una garantía absoluta: si lo que tiró adentro del `try` fuese el acceso a `inert`/`translateY`,
        // el `catch` tiraría igual y volveríamos al abort — por eso importa que en este shell esos shared
        // values se creen acá y nunca vengan de props.
        .onBegin(() => {
          'worklet';
          try {
            // Gate por ZONA (regla pura): el header arrastra siempre; el cuerpo, solo con el scroll en el
            // tope. El detector del cuerpo además viene `.enabled(atTop)` — eso es lo que evita que el Pan
            // le ROBE el toque al ScrollView; esto deja el invariante también dentro del gesto.
            inert.value = !sheetDragAllowedFrom({ zone, bodyAtTop: atTop });
          } catch (e) {
            inert.value = true; // gesto inerte: no mueve ni cierra nada
            if (__DEV__) throw e;
          }
        })
        .onStart(() => {
          'worklet';
          try {
            if (inert.value) return;
            // TECLADO ARRIBA → este arrastre BAJA EL TECLADO y no toca el sheet (decisión única, ver
            // `sheetDragIntent`): lo que se está tipeando no se pierde por un gesto.
            if (sheetDragIntent({ keyboardVisible: keyboardUp.value }) === 'dismiss-keyboard') {
              inert.value = true;
              // Callback JS propio (NUNCA `Keyboard.dismiss` pelado — ver el bloque de `dismissKeyboard`).
              runOnJS(dismissKeyboard)();
            }
          } catch (e) {
            inert.value = true;
            if (__DEV__) throw e;
          }
        })
        .onUpdate((e) => {
          'worklet';
          try {
            if (inert.value) return;
            translateY.value = sheetDragOffset(e.translationY);
          } catch (err) {
            inert.value = true; // deja de seguir al dedo; el sheet queda donde está y vuelve en onFinalize
            if (__DEV__) throw err;
          }
        })
        .onEnd((e) => {
          'worklet';
          try {
            if (inert.value) return;
            const travelled = sheetDragOffset(e.translationY);
            const dismiss = shouldDismissSheet({
              translationY: travelled,
              velocityY: e.velocityY,
              sheetHeight: sheetHeight.value,
              ratio: SHEET_DISMISS_RATIO,
              minDistance: SHEET_DISMISS_MIN_DISTANCE,
              flingVelocity: SHEET_DISMISS_FLING_VELOCITY,
              flingMinTravel: SHEET_DISMISS_FLING_MIN_TRAVEL,
              cancelVelocity: SHEET_DISMISS_CANCEL_VELOCITY,
            });
            if (dismiss) runOnJS(onClose)();
          } catch (err) {
            // Fail-closed: ante la duda NO cerramos (perder lo cargado es peor que un gesto que no responde).
            inert.value = true;
            if (__DEV__) throw err;
          }
        })
        .onFinalize(() => {
          'worklet';
          try {
            // SIEMPRE (cerró, no alcanzó, o el gesto se canceló): el sheet vuelve a su lugar. Ver cabecera:
            // los consumidores desmontan al cerrar, así que esto es invisible en el caso normal y fail-safe
            // en el hipotético consumidor que no desmonte. El `!== 0` evita disparar un spring inútil en cada
            // TAP (onFinalize corre también cuando el gesto nunca activó: tocar la X pasa por acá). Toca SOLO
            // su propio `inert` — nunca el del otro detector (ese fue el bug del flag compartido).
            inert.value = false;
            if (translateY.value !== 0) translateY.value = withSpring(0, RETURN_SPRING);
          } catch (e) {
            // Reset DURO (sin animación): el sheet no puede quedar trabado fuera de su lugar.
            inert.value = false;
            translateY.value = 0;
            if (__DEV__) throw e;
          }
        }),
    [dismissKeyboard, keyboardUp, onClose, sheetHeight, translateY],
  );

  // Un detector POR ZONA, montados en vistas DISJUNTAS (header ↔ ScrollView del cuerpo): ningún toque lo ven
  // los dos. El del header siempre activo; el del cuerpo, `.enabled` solo con el scroll en el tope (que es lo
  // que evita robarle el scroll al ScrollView). Instancias distintas — RNGH no permite reusar el mismo objeto
  // Gesture en dos detectores. El FOOTER queda fuera de las dos: ahí viven los CTAs.
  const headerDrag = useMemo(
    () => buildDragGesture({ zone: 'header', inert: headerInert, bodyAtTop: true }),
    [buildDragGesture, headerInert],
  );
  const bodyDrag = useMemo(
    () => buildDragGesture({ zone: 'body', inert: bodyInert, bodyAtTop }).enabled(bodyAtTop),
    [buildDragGesture, bodyInert, bodyAtTop],
  );

  // SIN `try/catch`, a diferencia de los callbacks del gesto (y no por falta de un fallback: el estado de
  // reposo `{ translateY: 0 }` es exactamente lo que ya escribe el `catch` de `onFinalize`). El motivo es
  // que acá un catch solo TAPARÍA el síntoma: lo único que este worklet hace es leer `translateY.value`, y
  // si esa lectura tirara, `onUpdate` y `onFinalize` —que escriben ese mismo shared value— ya estarían
  // tirando también: el shell estaría roto de raíz y esos catch harían su trabajo.
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo.
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      {/* El KAV envuelve la COLUMNA (scrim libre + sheet): con el teclado arriba encoge el alto útil desde
          abajo → el scrim (flex:1) absorbe y el sheet SUBE por encima del teclado. */}
      <KeyboardAvoidingView style={avoidStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          style={backdropStyle}
          onPress={onBackdropPress}
          testID={scrimTestID}
          {...buttonA11y(Platform.OS, { label: scrimA11yLabel })}
        />

        {/* ENVOLTURA ANIMADA del arrastre (SIN gesto propio: los detectores van en el header y en el body,
            disjuntos). LLEVA LAS RESTRICCIONES DE CAJA del sheet (flexShrink:1 + maxHeight, que antes vivían
            en el YStack de abajo): un `maxHeight` en % necesita un padre con alto DEFINIDO, y el padre del
            YStack pasó a ser esta envoltura de alto AUTO → dejarlo adentro lo volvería indeterminado (o peor,
            85% de 85%). Con el cap acá, el YStack (flexShrink:1, basis auto) se comporta EXACTO igual que
            antes: se dimensiona al contenido cuando es corto y se achica —cediendo el faltante al body
            scrolleable— cuando el contenido o el teclado no lo dejan entrar. */}
        <Animated.View style={[{ width: '100%', flexShrink: 1, maxHeight }, dragStyle]}>
            <YStack
              width="100%"
              // flexShrink:1 (NO flex:1) — ver la cabecera: se achica con el teclado arriba sin colapsar
              // cuando el contenido es corto.
              flexShrink={1}
              backgroundColor="$bg"
              borderTopLeftRadius="$card"
              borderTopRightRadius="$card"
              paddingHorizontal="$4"
              paddingTop="$4"
              paddingBottom={paddingBottom}
              gap="$4"
              testID={testID}
              onLayout={onSheetLayout}
            >
              {/* ── HEADER FIJO (grip + título/descripción + X). flexShrink:0 → nunca se comprime ni se
                  recorta. Es también el ANCLA del arrastre (grabber + título): su detector NO se gatea por
                  scroll — el header arrastra SIEMPRE, como cualquier sheet de iOS. Un TAP sobre la X no lo
                  dispara: el pan exige `SHEET_DRAG_ACTIVATE_Y` px de recorrido para activarse. ── */}
              <GestureDetector gesture={headerDrag}>
                <YStack flexShrink={0} gap="$3">
                  {showGrip ? (
                    <View
                      alignSelf="center"
                      width={getTokenValue('$icon', 'size')}
                      height={getTokenValue('$progressTrack', 'size')}
                      borderRadius="$pill"
                      backgroundColor="$divider"
                      testID={`${testID}-grip`}
                    />
                  ) : null}

                  <XStack alignItems="center" gap="$2">
                    <YStack flex={1} minWidth={0} gap="$1">
                      {/* lineHeight matching (regla dura: los títulos traen descendentes — "Vacunación" g/j). */}
                      <Text
                        fontFamily="$heading"
                        fontSize="$7"
                        lineHeight="$7"
                        fontWeight="700"
                        color="$textPrimary"
                        numberOfLines={1}
                      >
                        {title}
                      </Text>
                      {description != null && showDescription ? (
                        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={2}>
                          {description}
                        </Text>
                      ) : null}
                    </YStack>

                    {/* X de cierre: SIEMPRE presente (Nielsen #3). Target $icon=48 (≥44) + hitSlop. Va como
                        pieza Tamagui con onPress (NO un Pressable de RN envolviendo un Tamagui con
                        pressStyle: en nativo new-arch eso roba el responder y el onPress no dispara). */}
                    {showCloseButton ? (
                      <View
                        testID={closeTestID ?? `${testID}-close`}
                        width={getTokenValue('$icon', 'size')}
                        height={getTokenValue('$icon', 'size')}
                        borderRadius="$pill"
                        alignItems="center"
                        justifyContent="center"
                        backgroundColor="$surface"
                        flexShrink={0}
                        hitSlop={8}
                        pressStyle={{ backgroundColor: '$greenLight' }}
                        onPress={onClose}
                        {...buttonA11y(Platform.OS, { label: closeA11yLabel })}
                      >
                        <X
                          size={getTokenValue('$navIcon', 'size')}
                          color={getTokenValue('$textMuted', 'color')}
                          strokeWidth={2.5}
                        />
                      </View>
                    ) : null}
                  </XStack>
                </YStack>
              </GestureDetector>

              {/* ── BODY scrolleable + AFFORDANCE de scroll. ────────────────────────────────────────────
                  La envoltura `flexShrink:1 + minHeight:0` sostiene el fade ABSOLUTO al borde inferior del
                  body (necesita un ancestro posicionado que termine donde termina el viewport del scroll).
                  Lleva la MISMA geometría flex que tenía el ScrollView (grow:0 / shrink:1 / basis auto) y el
                  ScrollView adentro la conserva → NO es el patrón del bug U5, que era `flex:1` (basis 0%)
                  colapsando a altura 0 con contenido corto. NUNCA poner `flex:1` acá.
                  `onScroll`/`onLayout`/`onContentSizeChange` son del shell y ENCADENAN los del consumidor
                  (que los usa para su scroll-al-campo): alimentan el gate del arrastre (`bodyAtTop`) y el
                  affordance (`showPeek`).
                  El detector del CUERPO se monta sobre el CONTENIDO del scroll (no sobre la envoltura del
                  sheet ni sobre el ScrollView): así su región no se solapa con la del header y el footer no
                  queda cubierto por ninguno. Sobre el `ScrollView` de Tamagui NO va porque
                  gesture-handler-web termina aplicando su estilo a un nodo que no es el scroller y el pan
                  del cuerpo queda MUERTO en web (medido ad-hoc durante el desarrollo con un dump del DOM;
                  no es un caso vivo de la suite: la alternativa ya no está en el árbol). `touch-action:
                  pan-y` (web-only) para que el navegador conserve el scroll táctil del body; ese sí está
                  lockeado por `e2e/sheet-arrastre.spec.ts` leyendo el testID de abajo. */}
              <View flexShrink={1} style={bodyStyle} width="100%" position="relative">
                <ScrollView
                  ref={scrollViewRef}
                  flexShrink={1}
                  style={bodyStyle}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                  // PEEK: aire al final del contenido → el último elemento NUNCA queda rebanado al ras del
                  // CTA (se leía como layout roto en vez de "seguí scrolleando"). Mismo token que el peek de
                  // `FooterActionShell`. El `gap` vive en el View de abajo (único hijo del contentContainer).
                  contentContainerStyle={{ paddingBottom: getTokenValue('$6', 'space') }}
                  testID={bodyTestID}
                  onLayout={onBodyLayoutChained}
                  onContentSizeChange={onBodyContentSizeChained}
                  onScroll={onBodyScroll}
                  scrollEventThrottle={16}
                >
                  <GestureDetector gesture={bodyDrag} touchAction="pan-y">
                    <YStack
                      width="100%"
                      gap={getTokenValue(contentGap, 'space')}
                      testID={`${testID}-body-drag`}
                    >
                      {children}
                    </YStack>
                  </GestureDetector>
                </ScrollView>

                {/* FADE + chevron ▾ cuando queda contenido oculto ABAJO: la señal de "hay más" que el sheet
                    no tenía (el indicador nativo está apagado y en iOS solo aparece mientras scrolleás).
                    `pointerEvents="none"` → no intercepta ni el scroll ni el arrastre ni los taps. */}
                {showPeek ? (
                  <View
                    position="absolute"
                    bottom="$0"
                    left="$0"
                    right="$0"
                    height={getTokenValue('$searchBarLg', 'size')}
                    pointerEvents="none"
                    alignItems="center"
                    justifyContent="flex-end"
                    testID={`${testID}-scroll-peek`}
                  >
                    <View position="absolute" top="$0" left="$0" right="$0" bottom="$0" pointerEvents="none">
                      <LinearGradient
                        colors={['transparent', getTokenValue('$bg', 'color')]}
                        pointerEvents="none"
                        style={fadeFillStyle}
                      />
                    </View>
                    <View paddingBottom="$1">
                      <ChevronDown
                        size={getTokenValue('$navIcon', 'size')}
                        color={getTokenValue('$textMuted', 'color')}
                        strokeWidth={2.5}
                      />
                    </View>
                  </View>
                ) : null}
              </View>

              {/* ── FOOTER FIJO. flexShrink:0 → el CTA primario queda SIEMPRE abajo, nunca empujado fuera. ── */}
              {hasFooter ? (
                <YStack flexShrink={0} gap="$2">
                  {footer}
                  {secondaryFooter != null && showSecondaryAction ? secondaryFooter : null}
                </YStack>
              ) : null}
            </YStack>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
