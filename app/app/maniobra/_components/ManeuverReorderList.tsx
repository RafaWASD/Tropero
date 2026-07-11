// app/maniobra/_components/ManeuverReorderList.tsx — LISTA UNIFICADA de maniobras de la jornada
// (spec 03 M1.4, etapa 2; R1.4/R1.5 selección + R1.12 orden + R1.13 persistencia).
//
// UNA sola lista (estilo Weverse "Change order"):
//   - Las maniobras SELECCIONADAS están ARRIBA, en su orden operativo, cada una con su NÚMERO de orden
//     + un GRIP de drag. Arrastrar POR EL GRIP las REORDENA entre sí.
//   - Las NO seleccionadas quedan ABAJO (bajo un rótulo), tappables para sumarlas (suben al tope).
//   - TAP en una fila seleccionada = la deselecciona; TAP en una del pool = la suma (verde + ✓).
//
// SCROLL + DRAG (fix UX 2, Raf 2026-06-14): el padre (`jornada.tsx`) envuelve TODA la etapa 2 en un
// `Animated.ScrollView` (reanimated) → un swipe vertical normal SCROLLEA (la 9na maniobra + el pool +
// el "Detalle de la tanda" + el CTA son alcanzables). El drag de reorder NO roba ese swipe: el Pan del
// grip se ACTIVA solo tras cruzar un umbral vertical (`activeOffsetY`) y falla ante movimiento horizontal
// → un swipe normal va al ScrollView; agarrar el grip y arrastrar inicia el reorder. AUTO-SCROLL: cuando
// el dedo arrastrado se acerca al borde superior/inferior del viewport, el ScrollView se desplaza solo
// (frame callback en el UI thread); el cómputo del destino compensa el desplazamiento del scroll para que
// el ítem siga al dedo. BOUNDS: el ítem arrastrado se CLAMPEA a la región de las seleccionadas — no sube
// arriba del título "En la jornada" ni baja al pool.
//
// DRAG "BURBUJA": la fila levantada ESCALA ~1.04 + sombra/elevación fuerte + esquinas más redondas +
// sigue el dedo 1:1; los hermanos se CORREN animados (spring) para hacer lugar; spring al soltar; háptica
// al agarrar y al soltar. Gesto + animación en el HILO DE UI (reanimated worklets, gesture-handler) — el
// JS thread solo recibe el commit final del reorder.
//
// Implementación a mano (NO react-native-draggable-flatlist / -reorderable-list): (a) esas libs tienen
// soporte web pobre o nulo y el e2e del wizard corre en react-native-web (Playwright) → romperían las
// capturas; (b) reanimated 4.3.1 / RN 0.85 / worklets 0.8.3 no son targets soportados por ellas (peer-deps)
// y sumaría superficie de postinstall (onlyBuiltDependencies, ADR-011); (c) la lista es chica y acotada
// (≤10 filas de alto fijo) → un layout absoluto con un mapa `positions` worklet da control TOTAL del
// lift/sombra/reflow + el clamp de bounds + el auto-scroll a 60fps, y permite el test hook que congela el
// estado "burbuja" para la captura. El cómputo del orden (moveManeuver) es PURO y testeado; reanimated
// expone `scrollTo`/`useScrollOffset` con implementación web → auto-scroll cross-platform.
//
// RECORTE DE DESCENDENTES (memoria, regla dura): los labels traen g/j/p ("Vacunación", "Sangrado",
// "Raspado de toros") → todo Text con numberOfLines lleva lineHeight matching.
//
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a APIs no-Tamagui (lucide, reanimated shadows) se lee
// con getTokenValue / shadows del config. Targets manga ≥$touchMin.

import { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle, Check, ChevronRight, GripVertical, Plus } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedRef,
  type SharedValue,
} from 'react-native-reanimated';

import { shadows } from '../../../tamagui.config';
import type { ManeuverKind } from '@/utils/maneuver-gating';
import { maneuverLabel } from '@/utils/maneuver-wizard';
import { hapticPickUp, hapticDrop } from '@/utils/haptics';

// Alto fijo de cada fila SELECCIONADA (incl. el gap visual) — el cómputo del índice destino del drag
// depende de que todas las filas reordenables midan lo MISMO (configurables y no). Subido a 80 (card 72,
// patrón animalRow) para que las filas CONFIGURABLES quepan con su segunda línea (preconfig inline) sin
// romper la matemática del drag; las de una línea centran su contenido. $touchMin holgado para el grip.
const ROW_HEIGHT = 80;
// Escala del ítem levantado ("burbuja"). Sutil pero perceptible (Raf: ~1.04).
const LIFT_SCALE = 1.04;
// Spring de reflow/asentado (común a hermanos y al soltar): rápido pero con un toque de rebote vivo.
const SPRING = { damping: 20, stiffness: 240, mass: 0.6 } as const;
// El Pan del grip se ACTIVA recién tras cruzar este umbral vertical (px) → un swipe corto/normal lo
// deja pasar al ScrollView (scroll). Movimiento horizontal lo descalifica (failOffsetX).
const DRAG_ACTIVATE_Y = 8;
// Zona (px) cerca del borde sup/inf del viewport donde el auto-scroll se dispara al arrastrar.
const EDGE_ZONE = 72;
// Velocidad del auto-scroll (px por frame, ~60fps).
const AUTO_SCROLL_SPEED = 9;

/** Contexto de scroll que el padre (`jornada.tsx`) inyecta para el auto-scroll durante el drag. */
export type ReorderScrollContext = {
  /** Ref animado del `Animated.ScrollView` que envuelve la etapa 2 (para `scrollTo`). */
  scrollRef: AnimatedRef<Animated.ScrollView>;
  /** Offset de scroll actual del ScrollView (shared value, vía useScrollOffset). */
  scrollOffset: SharedValue<number>;
  /** Y en pantalla (window) del borde superior del viewport del ScrollView. */
  viewportTop: SharedValue<number>;
  /** Alto en pantalla (window) del viewport visible del ScrollView. */
  viewportHeight: SharedValue<number>;
};

/**
 * Preconfig INLINE de una maniobra (R1.7): si la maniobra es configurable (vacunación/inseminación),
 * devuelve su valor cargado (`value`) o el `hint` cuando no hay nada. Las NO configurables devuelven
 * null → su fila NO muestra segunda línea ni abre el sheet (el cuerpo es inerte).
 *
 * `warn` (delta-fix D2): la maniobra EXIGE un preconfig que FALTA (Vacunación sin ≥1 vacuna definida) →
 * su fila muestra una MARCA de alto contraste "Faltan vacunas" (terracota) en vez del hint muted, y el
 * continue de la etapa 2 queda bloqueado (jornada.tsx). Solo pesa cuando no hay `value`.
 */
export type InlineConfigResolver = (
  m: ManeuverKind,
) => { value: string | null; hint: string; warn?: boolean } | null;

export type ManeuverReorderListProps = {
  /** TODAS las maniobras ofrecidas por el gating del rodeo (capa 1), en su orden de catálogo. */
  offered: ManeuverKind[];
  /** Las SELECCIONADAS, EN ORDEN (el que se persiste en config.maniobras). Subconjunto de `offered`. */
  chosen: ManeuverKind[];
  /** Tap en una fila: alterna selección (sube al tope / baja al pool). En la seleccionada, lo dispara el BADGE. */
  onToggle: (m: ManeuverKind) => void;
  /** Soltar una fila seleccionada en otra posición: el padre reordena (moveManeuver). */
  onReorder: (from: number, to: number) => void;
  /** Tocar el CUERPO de una fila seleccionada configurable: abre el bottom sheet de preconfig (R1.7). */
  onOpenConfig?: (m: ManeuverKind) => void;
  /** Resuelve el preconfig inline (segunda línea) de cada maniobra. Sin él, ninguna fila es configurable. */
  inlineConfig?: InlineConfigResolver;
  /** Contexto de scroll para el auto-scroll durante el drag (opcional: sin él, drag sin auto-scroll). */
  scrollContext?: ReorderScrollContext;
  /**
   * TEST HOOK (solo captura): congela la fila `n` (0-based, dentro de las seleccionadas) en estado
   * "burbuja" (levantada) para fotografiar el lift/sombra. NO se usa en runtime real. Default: -1 (off).
   */
  frozenDragIndex?: number;
};

// ─── Fila SELECCIONADA: número de orden + grip + drag burbuja (clampeado, con auto-scroll) ───────

function SelectedRow({
  maneuver,
  index,
  total,
  positions,
  activeKey,
  autoScrollDir,
  onReorder,
  onToggle,
  onOpenConfig,
  inline,
  scrollContext,
  frozen,
}: {
  maneuver: ManeuverKind;
  index: number;
  total: number;
  /** Posición ACTUAL (índice visual) de cada maniobra, compartida (worklet) para el reflow de hermanos. */
  positions: SharedValue<Record<string, number>>;
  /** Clave de la fila que se arrastra ('' = ninguna), compartida para z-order/lift. */
  activeKey: SharedValue<string>;
  /** Dirección de auto-scroll en curso (-1 arriba / 0 ninguna / +1 abajo), leída por el frame callback. */
  autoScrollDir: SharedValue<number>;
  onReorder: (from: number, to: number) => void;
  onToggle: (m: ManeuverKind) => void;
  /** Abrir el sheet de preconfig (cuerpo de la fila, solo si es configurable). */
  onOpenConfig?: (m: ManeuverKind) => void;
  /** Preconfig inline de ESTA maniobra: valor cargado o hint (+ warn si falta un preconfig exigido). null = no configurable. */
  inline: { value: string | null; hint: string; warn?: boolean } | null;
  scrollContext?: ReorderScrollContext;
  frozen: boolean;
}) {
  // Offset Y visual del ítem durante el drag (UI thread). 0 = en reposo. CLAMPEADO a los bounds.
  const dragY = useSharedValue(0);
  // Posición visual lógica propia (a dónde la llevó el reflow). Arranca = index.
  const myPos = useSharedValue(index);
  // Offset de scroll al iniciar el drag (para compensar el auto-scroll en el cómputo del destino).
  const scrollAtStart = useSharedValue(0);

  const commit = useCallback(
    (from: number, to: number) => {
      hapticDrop();
      if (to !== from) onReorder(from, to);
    },
    [onReorder],
  );

  const grab = useCallback(() => {
    hapticPickUp();
  }, []);

  // Bounds (worklet): el ítem arrastrado nunca sube arriba de la 1ra seleccionada ni baja de la última.
  // dragY ∈ [-index*ROW_HEIGHT, (total-1-index)*ROW_HEIGHT] → top del ítem ∈ [0, (total-1)*ROW_HEIGHT].
  const minDragY = -index * ROW_HEIGHT;
  const maxDragY = (total - 1 - index) * ROW_HEIGHT;

  // Pan en el GRIP. Se activa SOLO tras cruzar DRAG_ACTIVATE_Y vertical (deja pasar el swipe de scroll) y
  // falla ante movimiento horizontal. Mientras arrastra: el ítem sigue al dedo (compensando el scroll),
  // clampeado a la región; recoloca hermanos al cruzar medio-row; auto-scroll cerca de los bordes; al
  // soltar computa el destino y delega el reorder PURO al padre (runOnJS). Todo en el UI thread.
  const pan = Gesture.Pan()
    .activeOffsetY([-DRAG_ACTIVATE_Y, DRAG_ACTIVATE_Y])
    .failOffsetX([-DRAG_ACTIVATE_Y, DRAG_ACTIVATE_Y])
    .onStart(() => {
      activeKey.value = maneuver;
      myPos.value = positions.value[maneuver] ?? index;
      scrollAtStart.value = scrollContext ? scrollContext.scrollOffset.value : 0;
      runOnJS(grab)();
    })
    .onUpdate((e) => {
      // Desplazamiento efectivo = lo que se movió el dedo + lo que se auto-scrolleó el contenido.
      const scrollDelta = scrollContext ? scrollContext.scrollOffset.value - scrollAtStart.value : 0;
      const effY = e.translationY + scrollDelta;
      // El ítem sigue al dedo (visual), CLAMPEADO a los bounds de la región de seleccionadas.
      dragY.value = Math.max(minDragY, Math.min(maxDragY, effY));
      // Posición visual destino del ítem arrastrado = su fila base + filas cruzadas (clamp [0, total-1]).
      const newPos = Math.max(0, Math.min(total - 1, index + Math.round(effY / ROW_HEIGHT)));
      const oldPos = myPos.value;
      if (newPos !== oldPos) {
        // Recolocamos los hermanos: el rango entre oldPos y newPos se corre una posición.
        const next: Record<string, number> = { ...positions.value };
        for (const key of Object.keys(next)) {
          if (key === maneuver) continue;
          const p = next[key];
          if (oldPos < newPos && p > oldPos && p <= newPos) next[key] = p - 1;
          else if (oldPos > newPos && p >= newPos && p < oldPos) next[key] = p + 1;
        }
        next[maneuver] = newPos;
        positions.value = next;
        myPos.value = newPos;
      }
      // AUTO-SCROLL: si el dedo entró en la zona de borde del viewport, marcamos la dirección (el frame
      // callback hace el desplazamiento continuo). Fuera de las zonas, sin auto-scroll.
      if (scrollContext) {
        const height = scrollContext.viewportHeight.value;
        // Sin un viewport medido (measureInWindow aún no corrió / no disponible) NO auto-scrolleamos:
        // de lo contrario `bottom - EDGE_ZONE` sería negativo y dispararía scroll-abajo espurio siempre.
        if (height <= 0) {
          autoScrollDir.value = 0;
        } else {
          const top = scrollContext.viewportTop.value;
          const bottom = top + height;
          if (e.absoluteY < top + EDGE_ZONE) autoScrollDir.value = -1;
          else if (e.absoluteY > bottom - EDGE_ZONE) autoScrollDir.value = 1;
          else autoScrollDir.value = 0;
        }
      }
    })
    .onEnd(() => {
      runOnJS(commit)(index, myPos.value);
      dragY.value = 0;
      activeKey.value = '';
      autoScrollDir.value = 0;
    })
    .onFinalize(() => {
      // Por si el gesto se cancela sin onEnd (p. ej. interrumpido): apagamos el auto-scroll.
      autoScrollDir.value = 0;
    });

  // El ítem se posiciona por su `positions[maneuver]` (springeado). Si lo arrastra, sigue al dedo 1:1
  // (su fila base `index` + dragY clampeado, sin spring) y se "levanta" (scale + sombra fuerte + z alto).
  const animatedStyle = useAnimatedStyle(() => {
    const isActive = activeKey.value === maneuver || frozen;
    const pos = positions.value[maneuver] ?? index;
    return {
      transform: [
        { translateY: isActive ? index * ROW_HEIGHT + dragY.value : withSpring(pos * ROW_HEIGHT, SPRING) },
        { scale: withTiming(isActive ? LIFT_SCALE : 1, { duration: isActive ? 120 : 160 }) },
      ],
      zIndex: isActive ? 50 : 1,
      shadowOpacity: withTiming(isActive ? 0.22 : 0.06, { duration: 140 }),
      shadowRadius: withTiming(isActive ? 18 : 12, { duration: 140 }),
      elevation: isActive ? 12 : 2,
    };
  });

  // Fila SELECCIONADA = recipe A (§2.1): fondo $primary (oscuro) → texto/íconos $white; el hint sin-valor
  // usa $greenLight (se lee como "muted" sobre el fondo oscuro sin caer en $primary/$textMuted ilegibles).
  const WHITE = getTokenValue('$white', 'color');
  const GREENLIGHT = getTokenValue('$greenLight', 'color');
  const SHADOW_COLOR = shadows.card.shadowColor;
  const HANDLE_SIZE = 24;

  const configurable = inline != null;
  const hasValue = inline?.value != null && inline.value.length > 0;
  // Marca de alto contraste "Faltan vacunas" (D2): la maniobra exige un preconfig que falta y no hay valor.
  const warnMissing = inline?.warn === true && !hasValue;

  // ZONAS DE TOQUE (UX 3, Raf):
  //  - BADGE (✓/número, izquierda) = QUITAR la maniobra (deseleccionar). Siempre.
  //  - CUERPO (label + 2da línea)  = abrir el sheet de preconfig SI es configurable; si no, inerte.
  //  - GRIP (derecha)              = drag (R1.12). Traga el tap para no quitar al tocarlo.
  // Cada Tap falla ante movimiento → no roba el scroll del padre.
  const badgeTap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (success) runOnJS(onToggle)(maneuver);
    });
  const bodyTap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((_e, success) => {
      if (success && configurable && onOpenConfig) runOnJS(onOpenConfig)(maneuver);
    });
  // En el grip, un tap suelto NO debe hacer nada (el grip es solo-reordenar): un Tap que lo "traga"
  // gana al de la fila por estar más adentro. Así tocar el grip sin arrastrar no dispara otra acción.
  const gripTapSwallow = Gesture.Tap().maxDuration(250);
  const gripGesture = Gesture.Race(pan, gripTapSwallow);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          // design-lint-disable-next-line -- absolute fill (inset 0): geometría estructural, no spacing themeable
          left: 0,
          // design-lint-disable-next-line -- absolute fill (inset 0): geometría estructural, no spacing themeable
          right: 0,
          height: ROW_HEIGHT,
          justifyContent: 'center',
          shadowColor: SHADOW_COLOR,
          shadowOffset: shadows.card.shadowOffset,
        },
        animatedStyle,
      ]}
    >
      <XStack
        backgroundColor="$primary"
        borderRadius={frozen ? '$pill' : '$card'}
        borderWidth={1}
        borderColor="$primary"
        paddingHorizontal="$3"
        height={ROW_HEIGHT - 8}
        alignItems="center"
        gap="$2"
        testID={`selected-row-${index}`}
      >
        {/* BADGE (número de orden 1-based) = QUITAR la maniobra. Target ≥ touchMin (alto de la fila). */}
        <GestureDetector gesture={badgeTap}>
          <View
            width={36}
            height={ROW_HEIGHT - 8}
            alignItems="center"
            justifyContent="center"
            testID={`selected-remove-${index}`}
            {...(Platform.OS === 'web'
              ? { role: 'button' as const, 'aria-label': `Quitar ${maneuverLabel(maneuver)}` }
              : { accessibilityRole: 'button' as const, accessibilityLabel: `Quitar ${maneuverLabel(maneuver)}` })}
          >
            <View width={26} height={26} borderRadius="$pill" alignItems="center" justifyContent="center" backgroundColor="$white">
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$primary" numberOfLines={1}>
                {index + 1}
              </Text>
            </View>
          </View>
        </GestureDetector>

        {/* CUERPO (✓ + label + 2da línea de preconfig inline) = abrir el sheet SI es configurable. */}
        <GestureDetector gesture={bodyTap}>
          <XStack
            flex={1}
            minWidth={0}
            height={ROW_HEIGHT - 8}
            alignItems="center"
            gap="$2"
            testID={`selected-body-${index}`}
            {...(Platform.OS === 'web'
              ? {
                  role: 'button' as const,
                  'aria-label': configurable
                    ? `${maneuverLabel(maneuver)} (tocá para configurar)`
                    : `${maneuverLabel(maneuver)} (seleccionada, posición ${index + 1})`,
                }
              : {
                  accessibilityRole: 'button' as const,
                  accessibilityLabel: configurable
                    ? `${maneuverLabel(maneuver)} (tocá para configurar)`
                    : `${maneuverLabel(maneuver)} (seleccionada, posición ${index + 1})`,
                  accessibilityState: { selected: true },
                })}
          >
            <Check size={18} color={WHITE} strokeWidth={3} />
            <YStack flex={1} minWidth={0}>
              <Text
                fontFamily="$body"
                fontSize="$5"
                lineHeight="$5"
                fontWeight="700"
                color="$white"
                numberOfLines={1}
              >
                {maneuverLabel(maneuver)}
              </Text>
              {/* 2da LÍNEA INLINE (solo configurables, R1.7): valor cargado ($white, énfasis) o hint ($greenLight,
                  muted sobre el fondo oscuro — recipe A §2.1). D2: si el preconfig EXIGIDO falta (warnMissing),
                  MARCA de alto contraste — pill terracota "Faltan vacunas" (blanco sobre terracota, ~5.8:1) que
                  pop-ea contra el verde botella y señala QUÉ maniobra completar. */}
              {configurable ? (
                warnMissing ? (
                  <XStack
                    alignSelf="flex-start"
                    alignItems="center"
                    gap="$1"
                    backgroundColor="$terracota"
                    borderRadius="$pill"
                    paddingHorizontal="$2"
                    paddingVertical="$1"
                    testID={`selected-config-warn-${index}`}
                  >
                    <AlertTriangle size={14} color={WHITE} strokeWidth={3} />
                    <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$white" numberOfLines={1}>
                      {inline!.hint}
                    </Text>
                  </XStack>
                ) : (
                  <Text
                    fontFamily="$body"
                    fontSize="$3"
                    lineHeight="$3"
                    fontWeight={hasValue ? '600' : '400'}
                    color={hasValue ? '$white' : '$greenLight'}
                    numberOfLines={1}
                    testID={`selected-config-${index}`}
                  >
                    {hasValue ? inline!.value : inline!.hint}
                  </Text>
                )
              ) : null}
            </YStack>
            {/* Chevroncito de "configurable" (solo si lo es): señal de affordance del cuerpo (tocá la fila →
                abre la config). D2 ENHANCEMENT (Puerta 2, pedido de Raf): cuando faltan vacunas, el chevron NO
                alcanza como señal → se vuelve un CTA de ALTO CONTRASTE = círculo TERRACOTA lleno + chevron
                BLANCO ("tocá acá para completar", ~5.1:1 blanco/terracota). Terracota SUELTO sobre el verde
                botella ($primary) da 1.59:1 (falla WCAG para gráficos) → el círculo lleno con contenido blanco
                es lo que da contraste + lee como "botón". Sin warn: chevron normal (blanco con valor, muted en
                el hint). Todo dentro del cuerpo tappable → tocarlo abre la config (arregla el faltante). */}
            {configurable ? (
              warnMissing ? (
                <View
                  width={28}
                  height={28}
                  borderRadius="$pill"
                  backgroundColor="$terracota"
                  alignItems="center"
                  justifyContent="center"
                  testID={`selected-config-fix-${index}`}
                >
                  <ChevronRight size={18} color={WHITE} strokeWidth={3} />
                </View>
              ) : (
                <ChevronRight size={18} color={hasValue ? WHITE : GREENLIGHT} />
              )
            ) : null}
          </XStack>
        </GestureDetector>

        {/* GRIP de drag (R1.12): Pan grip-gated (activeOffsetY) para reordenar; traga el tap. */}
        <GestureDetector gesture={gripGesture}>
          <View
            paddingVertical="$2"
            paddingHorizontal="$1"
            height={ROW_HEIGHT - 8}
            justifyContent="center"
            alignItems="center"
            testID={`drag-handle-${index}`}
            {...(Platform.OS === 'web'
              ? { role: 'button' as const, 'aria-label': `Reordenar ${maneuverLabel(maneuver)}` }
              : { accessibilityRole: 'button' as const, accessibilityLabel: `Reordenar ${maneuverLabel(maneuver)}` })}
          >
            <GripVertical size={HANDLE_SIZE} color={WHITE} />
          </View>
        </GestureDetector>
      </XStack>
    </Animated.View>
  );
}

// ─── Fila NO seleccionada (pool de abajo): tap para sumar ───────────────────────────────────

function PoolRow({ maneuver, onToggle }: { maneuver: ManeuverKind; onToggle: (m: ManeuverKind) => void }) {
  const FAINT = getTokenValue('$textFaint', 'color');
  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success) runOnJS(onToggle)(maneuver);
  });
  return (
    <GestureDetector gesture={tap}>
      <XStack
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$3"
        minHeight="$touchMin"
        alignItems="center"
        gap="$2"
        testID={`pool-row-${maneuver}`}
        {...(Platform.OS === 'web'
          ? { role: 'button' as const, 'aria-label': `${maneuverLabel(maneuver)} (tocá para sumar)` }
          : {
              accessibilityRole: 'button' as const,
              accessibilityLabel: `${maneuverLabel(maneuver)} (tocá para sumar)`,
              accessibilityState: { selected: false },
            })}
      >
        {/* Casilla vacía + label. */}
        <View width={26} height={26} borderRadius="$2" borderWidth={2} borderColor="$textFaint" alignItems="center" justifyContent="center">
          <Plus size={16} color={FAINT} strokeWidth={3} />
        </View>
        <Text
          flex={1}
          minWidth={0}
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="600"
          color="$textPrimary"
          numberOfLines={1}
        >
          {maneuverLabel(maneuver)}
        </Text>
      </XStack>
    </GestureDetector>
  );
}

/**
 * Lista UNIFICADA: seleccionadas-arriba (reordenables por drag burbuja, clampeado, con auto-scroll) +
 * pool-abajo (tap para sumar). La zona de seleccionadas es un contenedor de alto fijo (n * ROW_HEIGHT)
 * con filas en layout ABSOLUTO posicionadas por un mapa `positions` worklet → al arrastrar, los hermanos
 * se recolocan con springs en el UI thread. El pool es flujo normal. El padre la envuelve en un
 * `Animated.ScrollView` y le pasa `scrollContext` → un swipe normal scrollea, el grip arrastra, y el
 * auto-scroll corre el ScrollView cerca de los bordes. El orden persiste vía onReorder→config.
 */
export function ManeuverReorderList({
  offered,
  chosen,
  onToggle,
  onReorder,
  onOpenConfig,
  inlineConfig,
  scrollContext,
  frozenDragIndex = -1,
}: ManeuverReorderListProps) {
  // El pool = ofrecidas que NO están elegidas, en el orden del catálogo.
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const pool = useMemo(() => offered.filter((m) => !chosenSet.has(m)), [offered, chosenSet]);

  // Mapa de posiciones (índice visual) de las seleccionadas, para el reflow de hermanos en el UI thread.
  const positions = useSharedValue<Record<string, number>>({});
  const activeKey = useSharedValue('');
  // Dirección de auto-scroll en curso (-1/0/+1), seteada por el drag y leída por el frame callback.
  const autoScrollDir = useSharedValue(0);

  // AUTO-SCROLL continuo: mientras `autoScrollDir` ≠ 0 (dedo en una zona de borde), desplazamos el
  // ScrollView cada frame. Sin scrollContext (test/sin padre scrolleable) no hace nada.
  useFrameCallback(() => {
    'worklet';
    if (!scrollContext || autoScrollDir.value === 0) return;
    const next = scrollContext.scrollOffset.value + autoScrollDir.value * AUTO_SCROLL_SPEED;
    scrollTo(scrollContext.scrollRef, 0, Math.max(0, next), false);
  });

  // Sincronizamos el mapa con el `chosen` actual (orden de verdad = props del padre). Solo cuando cambia
  // el orden/set de chosen (commit de toggle/reorder); NUNCA durante un drag (el padre no re-renderiza
  // mientras se arrastra). Vía effect (no en render) para no escribir el shared value en el cuerpo.
  const chosenKey = chosen.join(',');
  useEffect(() => {
    const seed: Record<string, number> = {};
    chosen.forEach((m, i) => {
      seed[m] = i;
    });
    positions.value = seed;
    activeKey.value = '';
    autoScrollDir.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenKey]);

  return (
    <YStack gap="$3" testID="maneuver-reorder-list">
      {chosen.length > 0 ? (
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1}>
            En la jornada (arrastrá para ordenar)
          </Text>
          {/* Contenedor de alto fijo: las filas absolutas se posicionan por su translateY. */}
          <View height={chosen.length * ROW_HEIGHT} position="relative">
            {chosen.map((m, i) => (
              <SelectedRow
                key={m}
                maneuver={m}
                index={i}
                total={chosen.length}
                positions={positions}
                activeKey={activeKey}
                autoScrollDir={autoScrollDir}
                onReorder={onReorder}
                onToggle={onToggle}
                onOpenConfig={onOpenConfig}
                inline={inlineConfig ? inlineConfig(m) : null}
                scrollContext={scrollContext}
                frozen={i === frozenDragIndex}
              />
            ))}
          </View>
        </YStack>
      ) : null}

      {pool.length > 0 ? (
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1}>
            {chosen.length > 0 ? 'Sumá más maniobras' : 'Tocá las maniobras de la jornada'}
          </Text>
          {pool.map((m) => (
            <PoolRow key={m} maneuver={m} onToggle={onToggle} />
          ))}
        </YStack>
      ) : null}
    </YStack>
  );
}
