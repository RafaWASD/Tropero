// FooterActionShell — primitivo REUSABLE del patrón canónico "header fijo / body scroll / FOOTER FIJO
// con el CTA" (feature U2, skill design-review + memoria feedback_ux_basicos_sheets_forms). Cero hardcode
// (ADR-023 §4): todo via tokens. Es un componente de la librería, NO una pantalla (ADR-023).
//
// Resuelve 4 problemas que el CTA primario tenía repartidos por la app (a veces bajo el fold, a veces
// tapado por el teclado — en las pantallas 🔴 de maniobra es NO NEGOCIABLE):
//   1. CTA SIEMPRE VISIBLE en un footer FIJO (fuera del scroll del body → no scrollea nunca).
//   2. SUBE por encima del teclado al enfocar un campo (KeyboardAvoidingView: 'padding' en iOS; en Android
//      lo resuelve el adjustResize de la ventana) + encoge la reserva de safe-area con el teclado abierto
//      (resolveFooterPaddingBottom → no deja hueco sobre el teclado).
//   3. SCROLL AFFORDANCE (fade + chevron + peek) cuando el body tiene más contenido bajo el fold
//      (decisión pura shouldShowScrollPeek/scrollFades → una sola fuente de verdad con la lista de maniobra).
//   4. RESERVA de safe-area inferior robusta con blindaje frame-0 de Android edge-to-edge
//      (computeSafeBottomInset con initialWindowMetrics, mismo enfoque que U7 / tab-bar-insets).

import { useMemo, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView as RNScrollView,
} from 'react-native';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { getTokenValue, ScrollView, View, YStack, type ColorTokens } from 'tamagui';
import { ChevronDown } from 'lucide-react-native';

import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import {
  computeSafeBottomInset,
  resolveFooterPaddingBottom,
  shouldShowScrollPeek,
} from '../utils/footer-action';

/** El tipo EXACTO del 1er arg de getTokenValue (token de la escala) — evita el `string` genérico. */
type TamaguiToken = Parameters<typeof getTokenValue>[0];

// El LinearGradient (API no-Tamagui) llena su View contenedor (posicionado por tokens). `flex` no es
// spacing/color → no aplica el lint anti-hardcode.
const fillStyle = { flex: 1 } as const;

export type FooterActionShellProps = {
  /** El CTA (o barra de CTAs). Va en un footer FIJO keyboard-aware. `null` → sin footer (raro). */
  footer: ReactNode;
  /** Contenido del body (scrolleable por default). */
  children: ReactNode;
  /** Header FIJO opcional (arriba del KeyboardAvoidingView → nunca se comprime). Trae su propio paddingTop. */
  header?: ReactNode;
  /** ¿El body scrollea (con affordance)? Default true. `false` → body plano flex:1 (keypads, bloques). */
  scrollable?: boolean;
  /** Ref al ScrollView interno (para scroll-al-campo de validación desde la pantalla). Solo con scrollable. */
  scrollViewRef?: React.Ref<RNScrollView>;
  /** Padding horizontal del contentContainer del body (token de space). Default '$4'. */
  contentPaddingHorizontal?: TamaguiToken;
  /** Padding superior del contentContainer del body (token de space). Default '$3'. */
  contentPaddingTop?: TamaguiToken;
  /** gap entre hijos del body (token de space). Sin default (no aplica gap). */
  contentGap?: TamaguiToken;
  /** Token de fondo del root. Default '$bg'. */
  bg?: ColorTokens;
  /** Token de color del fade de scroll (debe matchear el fondo del body). Default '$bg'. */
  fadeColorToken?: TamaguiToken;
  /** Token de fondo del footer. Default '$bg'. */
  footerBg?: ColorTokens;
  /** ¿Borde superior en el footer (separa del body)? Default true. */
  footerBordered?: boolean;
  /** keyboardShouldPersistTaps del ScrollView. Default 'handled' (tap en el CTA con el teclado abierto). */
  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
  testID?: string;
};

/** Geometría mutable del scroll (evita re-render por cada medida intermedia). */
type Geom = { scrollY: number; viewport: number; content: number };

export function FooterActionShell(props: FooterActionShellProps) {
  const {
    footer,
    children,
    header,
    scrollable = true,
    scrollViewRef,
    contentPaddingHorizontal = '$4',
    contentPaddingTop = '$3',
    contentGap,
    bg = '$bg',
    fadeColorToken = '$bg',
    footerBg = '$bg',
    footerBordered = true,
    keyboardShouldPersistTaps = 'handled',
    testID,
  } = props;

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor={bg} testID={testID}>
      {header}
      <KeyboardAvoidingView style={fillStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scrollable ? (
          <AffordanceBody
            scrollViewRef={scrollViewRef}
            contentPaddingHorizontal={contentPaddingHorizontal}
            contentPaddingTop={contentPaddingTop}
            contentGap={contentGap}
            fadeColorToken={fadeColorToken}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            testID={testID}
          >
            {children}
          </AffordanceBody>
        ) : (
          <YStack flex={1} width="100%">
            {children}
          </YStack>
        )}
        {footer != null ? (
          <FooterBar bg={footerBg} bordered={footerBordered} testID={testID}>
            {footer}
          </FooterBar>
        ) : null}
      </KeyboardAvoidingView>
    </YStack>
  );
}

// ─── FOOTER FIJO keyboard-aware con reserva de safe-area robusta (frame-0 Android blindado) ──────────────

function FooterBar({
  children,
  bg,
  bordered,
  testID,
}: {
  children: ReactNode;
  bg: ColorTokens;
  bordered: boolean;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const safeInset = computeSafeBottomInset({
    liveInsetBottom: insets.bottom,
    initialInsetBottom: initialWindowMetrics?.insets.bottom ?? 0,
    minInset: getTokenValue('$navBottomMin', 'size'),
  });
  const paddingBottom = resolveFooterPaddingBottom({
    keyboardVisible,
    safeInset,
    keyboardOpenGap: getTokenValue('$2', 'space'),
  });
  return (
    <YStack
      testID={testID ? `${testID}-footer` : 'footer-action'}
      width="100%"
      paddingHorizontal="$4"
      paddingTop="$3"
      paddingBottom={paddingBottom}
      gap="$2"
      backgroundColor={bg}
      borderTopWidth={bordered ? 1 : 0}
      borderTopColor="$divider"
    >
      {children}
    </YStack>
  );
}

// ─── BODY scrolleable con AFFORDANCE (fade + chevron + peek) — misma geometría pura que la maniobra ──────
//
// El fade+chevron se muestran cuando hay contenido oculto ABAJO (shouldShowScrollPeek); el peek (padding
// extra al final del contentContainer) evita que el último elemento termine flush contra el fade. El fade
// es pointerEvents="none" → no intercepta scroll ni taps. Web-safe (onScroll/onLayout/onContentSizeChange
// andan en react-native-web). El fade vive al fondo del body (arriba del footer fijo).

const SCROLL_THROTTLE = 16; // ~60fps

function AffordanceBody({
  children,
  scrollViewRef,
  contentPaddingHorizontal,
  contentPaddingTop,
  contentGap,
  fadeColorToken,
  keyboardShouldPersistTaps,
  testID,
}: {
  children: ReactNode;
  scrollViewRef?: React.Ref<RNScrollView>;
  contentPaddingHorizontal: TamaguiToken;
  contentPaddingTop: TamaguiToken;
  contentGap?: TamaguiToken;
  fadeColorToken: TamaguiToken;
  keyboardShouldPersistTaps: 'always' | 'never' | 'handled';
  testID?: string;
}) {
  const [showPeek, setShowPeek] = useState(false);
  const geomRef = useMemo<Geom>(() => ({ scrollY: 0, viewport: 0, content: 0 }), []);

  function recompute() {
    setShowPeek(
      shouldShowScrollPeek({
        scrollY: geomRef.scrollY,
        viewportHeight: geomRef.viewport,
        contentHeight: geomRef.content,
      }),
    );
  }
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    geomRef.scrollY = e.nativeEvent.contentOffset.y;
    geomRef.viewport = e.nativeEvent.layoutMeasurement.height;
    geomRef.content = e.nativeEvent.contentSize.height;
    recompute();
  }
  function onLayout(e: LayoutChangeEvent) {
    geomRef.viewport = e.nativeEvent.layout.height;
    recompute();
  }
  function onContentSizeChange(_w: number, h: number) {
    geomRef.content = h;
    recompute();
  }

  const bgHex = getTokenValue(fadeColorToken, 'color');
  const fadeH = getTokenValue('$searchBarLg', 'size');
  const peekPad = getTokenValue('$6', 'space'); // aire al final → el último elemento no queda flush al fade/footer.

  return (
    <View flex={1} width="100%" position="relative">
      <ScrollView
        ref={scrollViewRef}
        flex={1}
        width="100%"
        maxWidth="100%"
        scrollEventThrottle={SCROLL_THROTTLE}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: getTokenValue(contentPaddingHorizontal, 'space'),
          paddingTop: getTokenValue(contentPaddingTop, 'space'),
          ...(contentGap != null ? { gap: getTokenValue(contentGap, 'space') } : null),
          // PEEK: aire al final → el último elemento no queda flush contra el fade / el footer fijo.
          paddingBottom: peekPad,
        }}
      >
        {children}
      </ScrollView>

      {/* FADE ABAJO + CHEVRON ▾ — cuando falta scrollear (contenido oculto bajo el fold). */}
      {showPeek ? (
        <View
          position="absolute"
          bottom="$0"
          left="$0"
          right="$0"
          height={fadeH}
          pointerEvents="none"
          alignItems="center"
          justifyContent="flex-end"
        >
          <View position="absolute" top="$0" left="$0" right="$0" bottom="$0" pointerEvents="none">
            <LinearGradient
              testID={testID ? `${testID}-scroll-fade-bottom` : 'footer-scroll-fade-bottom'}
              colors={['transparent', bgHex]}
              pointerEvents="none"
              style={fillStyle}
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
  );
}
