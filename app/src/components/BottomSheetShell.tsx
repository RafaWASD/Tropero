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
// ── LAS 5 RESPONSABILIDADES QUE ENCAPSULA ────────────────────────────────────────────────────────────
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
//  5. SAFE-AREA robusta con blindaje frame-0 de Android edge-to-edge (`computeSafeBottomInset` con
//     initialWindowMetrics — mismo enfoque que U7 / FooterActionShell).
//
// ── ⚠️ NUNCA `flex={1}` EN EL BODY (bug U5, ya arreglado una vez) ────────────────────────────────────
// El body va `flexShrink={1}` (grow:0, shrink:1, basis:auto), NO `flex:1` (grow:1, basis:0%). Con flex:1 el
// body COLAPSABA A ALTURA 0 en NATIVO cuando el contenido es corto: el padre (YStack maxHeight:85% SIN alto
// fijo) se dimensiona por CONTENIDO; si el contenido no llega al cap del 85% no hay "espacio libre" que un
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

import { useEffect, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  type LayoutChangeEvent,
  type ScrollView as RNScrollView,
} from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { X } from 'lucide-react-native';

import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { buttonA11y } from '../utils/a11y';
import { computeSafeBottomInset, resolveFooterPaddingBottom } from '../utils/footer-action';
import { sheetCondensation } from '../utils/sheet-shell';

/** El tipo EXACTO del 1er arg de getTokenValue (token de la escala) — evita el `string` genérico. */
type TamaguiToken = Parameters<typeof getTokenValue>[0];

// Estilos de APIs no-Tamagui (KeyboardAvoidingView / Pressable del backdrop). `flex`/`width` no son
// color ni spacing con token semántico → no aplica el lint anti-hardcode (ADR-023 §4).
const avoidStyle = { flex: 1, width: '100%', justifyContent: 'flex-end' } as const;
const backdropStyle = { flex: 1, width: '100%' } as const;
const bodyStyle = { minHeight: 0 } as const;

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
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
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

  // Reserva inferior: safe-area plena con el teclado cerrado; respiro chico con el teclado abierto (la
  // safe-area la tapa el teclado → reservarla dejaría un hueco feo SOBRE el teclado). Blindaje frame-0 de
  // Android edge-to-edge vía initialWindowMetrics. Ambas decisiones son las PURAS de footer-action.ts.
  const paddingBottom = resolveFooterPaddingBottom({
    keyboardVisible,
    safeInset: computeSafeBottomInset({
      liveInsetBottom: insets.bottom,
      initialInsetBottom: initialWindowMetrics?.insets.bottom ?? 0,
      minInset: getTokenValue('$navBottomMin', 'size'),
    }),
    keyboardOpenGap: getTokenValue('$2', 'space'),
  });

  const hasFooter = footer != null || (secondaryFooter != null && showSecondaryAction);

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

        <YStack
          width="100%"
          // flexShrink:1 (NO flex:1) — ver la cabecera: se achica con el teclado arriba sin colapsar
          // cuando el contenido es corto.
          flexShrink={1}
          maxHeight={maxHeight}
          backgroundColor="$bg"
          borderTopLeftRadius="$card"
          borderTopRightRadius="$card"
          paddingHorizontal="$4"
          paddingTop="$4"
          paddingBottom={paddingBottom}
          gap="$4"
          testID={testID}
        >
          {/* ── HEADER FIJO (grip + título/descripción + X). flexShrink:0 → nunca se comprime ni se recorta. ── */}
          <YStack flexShrink={0} gap="$3">
            {showGrip ? (
              <View
                alignSelf="center"
                width={getTokenValue('$icon', 'size')}
                height={getTokenValue('$progressTrack', 'size')}
                borderRadius="$pill"
                backgroundColor="$divider"
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

              {/* X de cierre: SIEMPRE presente (Nielsen #3). Target $icon=48 (≥44) + hitSlop. Va como pieza
                  Tamagui con onPress (NO un Pressable de RN envolviendo un Tamagui con pressStyle: en
                  nativo new-arch eso roba el responder y el onPress no dispara — memoria del repo). */}
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

          {/* ── BODY scrolleable. flexShrink:1 + minHeight:0 — NUNCA flex:1 (bug U5, ver cabecera). ── */}
          <ScrollView
            ref={scrollViewRef}
            flexShrink={1}
            style={bodyStyle}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            contentContainerStyle={{ gap: getTokenValue(contentGap, 'space') }}
            testID={bodyTestID}
            onLayout={onBodyLayout}
            onContentSizeChange={onBodyContentSizeChange}
          >
            {children}
          </ScrollView>

          {/* ── FOOTER FIJO. flexShrink:0 → el CTA primario queda SIEMPRE abajo, nunca empujado fuera. ── */}
          {hasFooter ? (
            <YStack flexShrink={0} gap="$2">
              {footer}
              {secondaryFooter != null && showSecondaryAction ? secondaryFooter : null}
            </YStack>
          ) : null}
        </YStack>
      </KeyboardAvoidingView>
    </View>
  );
}
