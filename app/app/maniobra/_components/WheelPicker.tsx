// app/maniobra/_components/WheelPicker.tsx — RUEDA INERCIAL genérica (drum/barrel picker) del spec 03 M6.
//
// Wheel picker vertical con MOMENTUM/FLING + SNAP al valor + TICK HÁPTICO por valor. Es la mecánica base
// de la circunferencia escrotal (R14.5) y se reusa para la rueda de meses (mismo idiom): le pasás un
// `WheelSpec` (rango/paso), el valor inicial, cómo formatear cada celda, y te avisa por `onValueChange`
// cuál es el valor CENTRADO (el seleccionado) en cada commit del scroll.
//
// MECÁNICA (R14.5):
//   - Inercia/fling: un `ScrollView` de RN (Animated de reanimated) con `decelerationRate="fast"` → un
//     fling rápido pasa muchos valores; un drag lento es preciso. Es el motor de scroll NATIVO (web +
//     native), el más fiable en react-native-web (no reimplementamos física de scroll a mano).
//   - Snap al valor: `snapToInterval = wheelCell` (alto de una celda) → al soltar, la rueda se asienta en
//     un valor exacto (no entre dos). El padding superior/inferior = (alto visible − celda)/2 centra la
//     primera/última celda en la línea de selección (Gestalt: el centro = lo elegido).
//   - Tick háptico: en cada cambio de índice centrado (durante el scroll) → `hapticTick()` (pulso de 8ms,
//     operable sin mirar fijo). Web degrada en silencio.
//   - GRADIENTE de TAMAÑO + opacidad por celda (reanimated, UI thread): la celda centrada va más GRANDE y
//     sólida (énfasis = el valor elegido RESALTA); los vecinos inmediatos quedan medianos; los lejanos,
//     chicos y atenuados → lectura de "drum" 3D y jerarquía clara de un vistazo (fix-loop v2). El gradiente
//     de tamaño se hace con `transform: scale` sobre un texto BASE chico ($wheelValueText=26): la celda
//     central escalada (~×1,22 → ~32px) sigue entrando HOLGADA en wheelCell=64 (el bug original era el
//     glifo base de 84px, no la escala en sí) → ningún valor desborda la celda ni cruza las líneas.
//
// Líneas de selección: dos hairlines (arriba/abajo de la celda central) marcan el valor elegido. La celda
// central escalada entra HOLGADA en wheelCell → las líneas bracketean SOLO la central sin cruzar/recortar el
// texto de los vecinos (incluidos los ".5" como "35,5"/"38,5"). La selección se lee por (a) las líneas, (b)
// el gradiente de TAMAÑO (centro grande/bold vs vecinos chicos) y (c) la opacidad (centro sólido, vecinos
// atenuados). El HERO es el CAMPO EDITABLE de arriba (readout "36,5 cm" tipeable) que pone el STEP
// (CircunferenciaEscrotalStep), no esta rueda — la rueda es el SELECTOR (su centro enfatizado lo espeja).
//
// es-AR / formato: la rueda NO formatea — recibe `formatValue(value) => string` (el step decide coma
// decimal, unidad, etc., reusando wheel-picker.ts). RECORTE DE DESCENDENTES (regla dura): la celda lleva
// lineHeight matching. Cero hardcode (ADR-023 §4): tokens; getTokenValue para geometría/colores que
// cruzan a APIs no-Tamagui. Targets: la rueda se ARRASTRA (el target es el área, no una celda).

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import { hapticTick } from '@/utils/haptics';
import {
  indexToOffset,
  indexToValue,
  isOffsetSnapped,
  snapOffset,
  tapTarget,
  valueToIndex,
  wheelValues,
  type WheelSpec,
} from '@/utils/wheel-picker';

/** Debounce del SETTLE en web (ms): react-native-web emite el `onScroll` final ~100ms después de la última
 *  movida (NO dispara onMomentum/onScrollEndDrag — `reference_rn_web_pitfalls`). Esperamos un toque más que
 *  esa ventana para lockear una sola vez cuando el scroll ya se detuvo. En native el lock va por los handlers
 *  nativos (inmediato); este debounce es el camino WEB. */
const WEB_SETTLE_MS = 140;

/** Cuántas celdas de CONTEXTO se ven a cada lado de la central (la rueda muestra 2*N+1 celdas visibles). */
const CONTEXT_CELLS = 2;

export type WheelPickerProps = {
  /** Descriptor de la rueda (rango/paso). De wheel-picker.ts (CE_WHEEL / AGE_WHEEL). */
  spec: WheelSpec;
  /** Valor seleccionado actual (controlado por el step). Se snapea/clampa al rango internamente. */
  value: number;
  /** Llamado con el valor CENTRADO al asentarse / cruzar una celda (el step lo guarda como selección). */
  onValueChange: (value: number) => void;
  /** Cómo mostrar cada celda (el step decide es-AR/unidad, reusando formatCmAR/formatMonthsAR). */
  formatValue: (value: number) => string;
  /** testID para el e2e/captura (la rueda y su valor centrado). */
  testID?: string;
  /** Label accesible de la rueda (ej. "Rueda de circunferencia escrotal"). */
  accessibilityLabel?: string;
};

/** Gradiente de tamaño del drum (fix-loop v2): la celda central RESALTA (más grande + sólida), los vecinos
 *  inmediatos quedan medianos y los lejanos chicos+atenuados. Escalas/opacidades centralizadas acá (no
 *  hardcode disperso). El glifo BASE es $wheelValueText=26; CENTER_SCALE lo lleva a ~32px (entra holgado en
 *  wheelCell=64). El clamp evita que las celdas fuera del viewport pesen en el cálculo. */
const CENTER_SCALE = 1.22; // celda central: ~26 × 1,22 ≈ 32px (RESALTA), entra holgado en cell=64
const FAR_SCALE = 0.78; // celdas lejanas (dist ≥ 2): ~26 × 0,78 ≈ 20px (chicas)
const SCALE_DROP = 0.34; // cuánto baja la escala por celda de distancia: dist 1 ≈ 0,88 → ~23px (medianas)
const MIN_OPACITY = 0.16; // piso de opacidad de las celdas más lejanas (atenuadas pero legibles de reojo)
const OPACITY_DROP = 0.46; // cuánto baja la opacidad por celda de distancia: dist 1 ≈ 0,54

/** Una celda de la rueda: el GRADIENTE de tamaño (scale) + opacidad lo da la distancia al centro en el UI
 *  thread (drum 3D + jerarquía: la central RESALTA, los vecinos se subordinan). La escala se aplica sobre un
 *  texto base CHICO ($wheelValueText=26) → la central escalada (~32px) entra HOLGADA en `cell`=64 con
 *  lineHeight matcheado → NINGÚN valor, ni los ".5", desborda la celda ni cruza las líneas de selección.
 *
 *  TAP-TO-SELECT (delta #16, RTW.1.1/RTW.3.1/RTW.3.2/RTW.5.3): la celda es un `Pressable` que, al tocarla,
 *  llama `onTap(index)` — el índice lo CONOCE la celda (sin mapeo de coordenada-a-valor, D3). El área tappable
 *  es la caja de layout de la celda (alto `cell`, ancho completo → target grande 🔴 manga; la escala visual
 *  no afecta el layout). Solo las celdas del `values.map` que quedan DENTRO del drum (viewport) se pueden
 *  tocar; las scrolleadas fuera están clipeadas por el overflow → no son alcanzables (RTW.3.1). A11y de botón
 *  con el valor como label (RTW.5.3, DOM-válida en web vía `buttonA11y`). El press-responder del `ScrollView`
 *  cancela el press si el gesto se vuelve un DRAG → el arrastre inercial no queda roto (RTW.2.1). */
function WheelCell({
  label,
  index,
  scrollIndex,
  cell,
  cellTextSize,
  onTap,
  cellTestID,
}: {
  label: string;
  index: number;
  scrollIndex: SharedValue<number>;
  cell: number;
  cellTextSize: number;
  onTap: (index: number) => void;
  cellTestID?: string;
}) {
  const style = useAnimatedStyle(() => {
    'worklet';
    const dist = Math.abs(scrollIndex.value - index);
    // Escala: central (dist 0) = CENTER_SCALE (grande, RESALTA); cae SCALE_DROP por celda hasta el piso
    // FAR_SCALE (lejanas, chicas). Interpola suave durante el fling (dist es fraccional en el UI thread).
    const scale = Math.max(FAR_SCALE, CENTER_SCALE - dist * SCALE_DROP);
    // Opacidad: central sólida (1); cada celda de distancia atenúa OPACITY_DROP hasta el piso MIN_OPACITY.
    const opacity = Math.max(MIN_OPACITY, 1 - dist * OPACITY_DROP);
    return { opacity, transform: [{ scale }] };
  });

  // La celda mide exactamente `cell` de alto (= snapToInterval, y lo que bracketean las líneas). El texto
  // base chico ($wheelValueText) con lineHeight matcheado, ESCALADO en el centro, entra centrado con respiro
  // → ni el centro grande ni los ".5" de los vecinos desbordan la celda ni son cruzados por las líneas. El
  // `Pressable` envuelve el contenido (el gradiente vive en el Animated.View interno, intacto): tap → onTap.
  return (
    <Pressable
      onPress={() => onTap(index)}
      testID={cellTestID}
      {...buttonA11y(Platform.OS, { label: `Seleccionar ${label}` })}
    >
      <Animated.View style={[{ height: cell, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Text
          fontFamily="$heading"
          fontSize={cellTextSize}
          lineHeight={cellTextSize}
          fontWeight="700"
          color="$textPrimary"
          numberOfLines={1}
          allowFontScaling={false}
          textAlign="center"
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export function WheelPicker({
  spec,
  value,
  onValueChange,
  formatValue,
  testID,
  accessibilityLabel,
}: WheelPickerProps) {
  const cell = getTokenValue('$wheelCell', 'size'); // 64 — alto de celda = snapToInterval
  const cellTextSize = getTokenValue('$wheelValueText', 'size'); // 26 — tamaño UNIFORME del valor de la celda
  const visibleCells = CONTEXT_CELLS * 2 + 1; // 5 celdas visibles (2 de contexto a cada lado)
  const listHeight = cell * visibleCells;
  // Padding que centra la 1ra/última celda en la línea de selección: (alto visible − celda)/2.
  const padCenter = (listHeight - cell) / 2;

  const values = useMemo(() => wheelValues(spec), [spec]);
  const initialIndex = valueToIndex(value, spec);

  // Índice centrado en el UI thread (alimenta el transform de las celdas). Inicia en el valor entrante.
  const scrollIndex = useSharedValue(initialIndex);
  // Último índice notificado al JS thread (shared value para que el worklet lo compare sin saltar a JS
  // en cada frame) → solo se dispara onValueChange/háptica al CRUZAR de celda, no en cada píxel.
  const lastNotified = useSharedValue(initialIndex);
  // Último offset crudo del scroller (px). Lo mantiene el worklet en cada frame → el SETTLE web (JS thread)
  // lee de acá el offset al detenerse sin depender de un closure stale ni del evento nativo.
  const offsetY = useSharedValue(indexToOffset(initialIndex, cell));

  // Ref del scroller para posicionar el offset inicial imperativamente (web-safe: en react-native-web el
  // prop contentOffset no siempre aplica al montar → un scrollTo en el efecto lo garantiza).
  const scrollRef = useRef<Animated.ScrollView>(null);
  const initialOffset = indexToOffset(initialIndex, cell);
  // Timer del debounce de SETTLE en web (lock una sola vez cuando el scroll se detiene).
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Posiciona la rueda en el valor entrante al montar (última medida / 36 / edad prellenada).
    scrollRef.current?.scrollTo({ y: initialOffset, animated: false });
    // Solo al montar (el valor entrante es la posición inicial; cambios posteriores los maneja el scroll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Notifica el valor de un índice (con tick háptico). Corre en el JS thread (llamado vía runOnJS). */
  const notifyIndex = useCallback(
    (idx: number) => {
      hapticTick();
      onValueChange(indexToValue(idx, spec));
    },
    [onValueChange, spec],
  );

  const count = values.length;

  // ── LOCK / SNAP DETERMINÍSTICO al soltar (R14.5/R14.7) ──────────────────────────────────────────────
  // El `snapToInterval`/`decelerationRate` del ScrollView NO lockea en react-native-web (la rueda queda
  // descansando ENTRE dos valores — `reference_rn_web_pitfalls`). Al detenerse el scroll, asentamos la
  // rueda EXACTO en la celda cuyo centro quede más cerca de la línea de selección. Idempotente: si el
  // offset ya es el del centro de su celda (ya snapeado), es no-op (no relockea, no spamea onValueChange/
  // háptica, no entra en loop por el onScroll que dispara el propio scrollTo programático).
  const lockToOffset = useCallback(
    (rawOffset: number) => {
      if (isOffsetSnapped(rawOffset, cell, spec)) return; // ya lockeado → no-op (anti-loop / anti-jitter).
      const snap = snapOffset(rawOffset, cell, spec);
      // Sincroniza los shared values ANTES del scrollTo: cuando el onScroll programático dispare en el
      // índice destino, `idx === lastNotified` y NO re-notifica (mismo guard que la sincronía campo→rueda).
      offsetY.value = snap.offset;
      scrollIndex.value = snap.index;
      scrollRef.current?.scrollTo({ y: snap.offset, animated: true });
      if (snap.index !== lastNotified.value) {
        lastNotified.value = snap.index;
        notifyIndex(snap.index); // tick háptico + onValueChange UNA sola vez (ya en JS thread).
      }
    },
    // shared values y refs no son deps reactivas; cell/spec sí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cell, spec, notifyIndex],
  );

  /** SETTLE (camino WEB): se agenda en cada onScroll y se reprograma mientras la rueda se mueve; cuando el
   *  scroll se detiene (último onScroll de rn-web ~100ms), el timer corre y lockea desde el offset vivo. */
  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      lockToOffset(offsetY.value);
    }, WEB_SETTLE_MS);
    // shared values/refs no son deps reactivas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockToOffset]);

  // Limpia el timer del settle al desmontar (no lockear sobre un scroller ya ido).
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  /** LOCK NATIVO — MOMENTUM-END (iOS/Android): el fling terminó en su punto de reposo → lock INMEDIATO y
   *  AUTORITATIVO desde el offset del evento. En web este handler no dispara. */
  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (settleTimer.current) {
        clearTimeout(settleTimer.current); // cancela cualquier settle (web) / drag-snap (native) pendiente.
        settleTimer.current = null;
      }
      lockToOffset(e.nativeEvent.contentOffset.y);
    },
    [lockToOffset],
  );

  /** LOCK NATIVO — DRAG-END (iOS/Android): el usuario soltó. Si NO hay momentum, este es el único end-event
   *  → hay que lockear. Si SÍ hay momentum, llega `onMomentumScrollEnd` en el próximo frame con el reposo
   *  REAL. Para NO pelearse con el momentum entrante (snap animado vs fling nativo), DIFERIMOS el snap del
   *  drag-end por la misma ventana de settle: si el momentum arranca, su momentum-end cancela este timer y
   *  lockea el reposo real; si no hay momentum, el timer corre y lockea desde el offset vivo. En web no
   *  dispara (ahí lockea el settle del onScroll). */
  const onDragEnd = useCallback(() => {
    scheduleSettle();
  }, [scheduleSettle]);

  // ÚNICO scroll handler (UI thread): mueve el shared value para el transform 3D y, al CRUZAR de celda,
  // salta a JS (runOnJS) para el tick háptico + onValueChange. Comparar el índice contra `lastNotified`
  // en el worklet evita spamear el JS thread (solo cruces de celda, no cada frame). Clamp del índice al
  // rango [0, count-1] para no notificar fuera de las celdas reales (el padding de centrado no cuenta).
  // Además agenda el SETTLE web (debounce en JS) → al detenerse el scroll, lockea (en native no molesta:
  // los handlers nativos cancelan el timer y lockean primero).
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      'worklet';
      offsetY.value = e.contentOffset.y;
      const raw = e.contentOffset.y / cell;
      scrollIndex.value = raw;
      let idx = Math.round(raw);
      if (idx < 0) idx = 0;
      if (idx > count - 1) idx = count - 1;
      if (idx !== lastNotified.value) {
        lastNotified.value = idx;
        runOnJS(notifyIndex)(idx);
      }
      runOnJS(scheduleSettle)();
    },
  });

  // ── TAP-TO-SELECT (delta #16, RTW.1/RTW.2/RTW.4/RTW.5) ──────────────────────────────────────────────
  // El operario tapeó una celda VISIBLE del drum (`tappedIndex` lo conoce la celda — sin coordenada-a-valor,
  // D3/RTW.3.2). Corre en el JS thread (lee `.value` de los shared values). Replica el patrón de
  // `lockToOffset` pero keyed en un ÍNDICE CONOCIDO (no en un offset crudo): el destino sale de `tapTarget`
  // (offset = múltiplo exacto de `cell`), se SINCRONIZAN los shared values ANTES del scrollTo (el valor final
  // committeado es el de la celda tapeada, no un intermedio), se ANIMA suave hasta centrar (reusa el
  // scrollTo({animated:true}) existente) y se dispara la MISMA háptica de settle + onValueChange que el drag.
  const handleCellTap = useCallback(
    (tappedIndex: number) => {
      const t = tapTarget(offsetY.value, tappedIndex, cell, spec);
      if (t.isCentral) return; // celda YA centrada → no-op de valor (RTW.1.4: sin onValueChange espurio).
      if (settleTimer.current) {
        clearTimeout(settleTimer.current); // cancela settle/lock diferido pendiente (RTW.2.3, RTW.5.1).
        settleTimer.current = null;
      }
      // Sync ANTES del scrollTo (mismo patrón que `lockToOffset`): cuando el onScroll programático de la
      // animación aterrice en el índice destino, `idx === lastNotified` → NO re-notifica; y el momentum-end
      // (native) / settle (web) que cierre la animación ve el offset ya snapeado → `lockToOffset` no-op
      // (RTW.2.2/2.4). El efecto value→rueda ve el eco del propio tap y no re-mueve la rueda (RTW.5.4).
      offsetY.value = t.offset;
      scrollIndex.value = t.index;
      lastNotified.value = t.index;
      // Anima suave hasta centrar el valor tapeado (RTW.1.2). Un fling en curso lo interrumpe este scrollTo al
      // nuevo target + el cancel del settle diferido → se asienta en el TAP, no donde iba el fling (RTW.5.1).
      scrollRef.current?.scrollTo({ y: t.offset, animated: true });
      notifyIndex(t.index); // háptica settle + onValueChange UNA vez, mismo camino que el drag (RTW.1.3/RTW.4.1).
    },
    // shared values y refs no son deps reactivas; cell/spec/notifyIndex sí (mismo criterio que lockToOffset).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cell, spec, notifyIndex],
  );

  // SINCRONÍA EXTERNA → rueda (fix-loop v2, R14.5 sub-cláusula): cuando el `value` controlado cambia por una
  // fuente EXTERNA (el operario tipeó en el CAMPO editable y commiteó), la rueda se mueve/snapea a ese valor.
  // `lastNotified` guarda el índice que la PROPIA rueda emitió por scroll → si el `value` entrante mapea a un
  // índice DISTINTO, vino de afuera: scrolleamos hasta ahí (sin disparar onValueChange de vuelta). Si coincide
  // (es el eco del propio scroll), no hacemos nada → no hay loop de feedback rueda↔campo.
  const targetIndex = valueToIndex(value, spec);
  useEffect(() => {
    if (targetIndex === lastNotified.value) return; // eco del propio scroll: ya estamos ahí.
    // `lastNotified`/`scrollIndex` se setean ANTES del scrollTo → cuando el onScroll programático dispare
    // en el índice destino, `idx === lastNotified` y NO re-notifica (no hay loop de feedback). El salto es
    // INSTANTÁNEO (animated:false) a propósito: un scroll animado pasaría por los índices intermedios y cada
    // onScroll llamaría onValueChange, pisando el valor tipeado con un valor a mitad de camino (bug v2).
    const targetOffset = indexToOffset(targetIndex, cell);
    lastNotified.value = targetIndex;
    scrollIndex.value = targetIndex;
    offsetY.value = targetOffset; // mantené el offset vivo en sync → un settle posterior lo ve ya snapeado.
    if (settleTimer.current) {
      clearTimeout(settleTimer.current); // descartá un settle web pendiente: el salto externo ya posiciona.
      settleTimer.current = null;
    }
    scrollRef.current?.scrollTo({ y: targetOffset, animated: false });
    // targetIndex deriva de value/spec; los shared values no son deps reactivas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIndex, cell]);

  const HAIRLINE = getTokenValue('$divider', 'color');
  const SELECT_LINE = getTokenValue('$primary', 'color');

  return (
    <YStack
      testID={testID}
      height={listHeight}
      width="100%"
      alignItems="center"
      justifyContent="center"
      position="relative"
      {...(accessibilityLabel ? labelA11y(Platform.OS, accessibilityLabel) : {})}
    >
      {/* LÍNEAS DE SELECCIÓN: dos hairlines $primary que enmarcan la celda central (el valor elegido).
          Decorativas (pointerEvents none) → no interceptan el drag de la rueda. */}
      <View
        position="absolute"
        top={padCenter}
        left="$0"
        right="$0"
        height={cell}
        borderTopWidth={2}
        borderBottomWidth={2}
        borderColor={SELECT_LINE}
        pointerEvents="none"
        zIndex={2}
      />

      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        // snapToInterval/decelerationRate AYUDAN en native (no se degradan); el LOCK determinístico (JS) es
        // el que garantiza el snap en web, donde snapToInterval NO es fiable (`reference_rn_web_pitfalls`).
        snapToInterval={cell}
        decelerationRate="fast"
        // LOCK NATIVO (no disparan en web → ahí lockea el debounce de settle desde onScroll): momentum-end =
        // lock autoritativo inmediato; drag-end = diferido (cede al momentum entrante, sin fight/jitter).
        onMomentumScrollEnd={onMomentumEnd}
        onScrollEndDrag={onDragEnd}
        contentOffset={{ x: 0, y: initialOffset }}
        contentContainerStyle={{ paddingTop: padCenter, paddingBottom: padCenter }}
        style={{ width: '100%' }}
      >
        {values.map((v, i) => (
          <WheelCell
            key={v}
            label={formatValue(v)}
            index={i}
            scrollIndex={scrollIndex}
            cell={cell}
            cellTextSize={cellTextSize}
            onTap={handleCellTap}
            cellTestID={testID ? `${testID}-cell-${i}` : undefined}
          />
        ))}
      </Animated.ScrollView>

      {/* Hairlines de fade superior/inferior (refuerzan el borde del "drum"). Decorativas. */}
      <View position="absolute" top="$0" left="$0" right="$0" height={1} backgroundColor={HAIRLINE} pointerEvents="none" />
      <View position="absolute" bottom="$0" left="$0" right="$0" height={1} backgroundColor={HAIRLINE} pointerEvents="none" />
    </YStack>
  );
}
