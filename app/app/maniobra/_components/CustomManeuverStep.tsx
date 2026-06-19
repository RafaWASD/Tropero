// app/maniobra/_components/CustomManeuverStep.tsx — PASO de MANIOBRA CUSTOM, render GENÉRICO por ui_component
// (spec 03 M5-C.3, R13.8). El dispatcher de carga.tsx renderiza un ítem source:'custom' con este componente:
// por su `ui_component` elige el INPUT de manga, REUSANDO los idioms LOCKEADOS (no diseño nuevo):
//   - numeric          → keypad de PesajeStep (sin "kg").
//   - numeric_stepped  → stepper de CondicionCorporalStep (paso 1, libre de rango).
//   - enum_single      → bloques NEUTROS tipo DientesStep (elegí UNO de N, sin pre-selección; un toque elige + avanza).
//   - enum_multi       → multi-select de chips tipo SilentVaccinationStep (sin texto libre: solo las opciones).
//   - text             → input grande tipo SilentSanitaryStep + CTA "Guardar y seguir".
//   - boolean          → 2 bloques Sí / No (tipo TactoStep PREÑADA/VACÍA).
//   - date             → input con máscara es-AR (maskDateInput, AAAA-MM-DD) + CTA.
// El HEADER (línea de maniobra con el `label`) + el contador los pone el FRAME (carga.tsx); el CTA lo pone
// este componente (cada idiom). La captura confirma → onConfirm(CustomCaptureValue), el frame escribe a
// custom_measurements (addCustomMeasurement, value tipado por serializeCustomValue). Corrección desde el
// resumen (R5.9): recibe initialValue y arranca con ese valor (mismo patrón que las de fábrica).
//
// 🔴 manga: targets XL, una decisión por pantalla, idioms lockeados. Cero hardcode (ADR-023 §4): tokens; lucide
// vía getTokenValue. es-AR. Recorte de descendentes: lineHeight matching en todo Text con numberOfLines.

import { useMemo, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  TextInput,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronDown, Delete, Minus, Plus, X } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import { maskDateInput } from '@/utils/animal-input';
import type { CustomUiComponent } from '@/utils/custom-field';
import { isCustomValueComplete, type CustomCaptureValue } from '@/utils/custom-render';
import { scrollFades, type ScrollFades } from '@/utils/scroll-affordance';

/** El tipo EXACTO del 1er arg de getTokenValue (token de la escala) — evita el `string` genérico que tsc
 *  rechaza al pasar tokens dinámicos. */
type TamaguiToken = Parameters<typeof getTokenValue>[0];

export type CustomManeuverStepProps = {
  uiComponent: CustomUiComponent;
  /** Opciones del enum (enum_single/enum_multi); ignorado para los demás. */
  options: readonly string[];
  /** Valor ya cargado (corrección desde el resumen, R5.9) o null si es la 1ra captura. */
  initialValue?: CustomCaptureValue | null;
  /** Devuelve el valor confirmado (tipado) al frame, que lo persiste en custom_measurements (R13.11). */
  onConfirm: (value: CustomCaptureValue) => void;
  bottomPad: number;
};

export function CustomManeuverStep(props: CustomManeuverStepProps) {
  switch (props.uiComponent) {
    case 'numeric':
      return <NumericKeypad {...props} />;
    case 'numeric_stepped':
      return <NumericStepper {...props} />;
    case 'enum_single':
      return <EnumSingleBlocks {...props} />;
    case 'enum_multi':
      return <EnumMultiSelect {...props} />;
    case 'boolean':
      return <BooleanBlocks {...props} />;
    case 'date':
      return <DateInput {...props} />;
    case 'text':
    default:
      return <TextInputStep {...props} />;
  }
}

// ─── CTA "✓ Confirmar y seguir" (idiom compartido por los pasos con CTA propio) ────────────────────────

function ConfirmCta({
  enabled,
  onPress,
  bottomPad,
  label = 'Confirmar y seguir',
}: {
  enabled: boolean;
  onPress: () => void;
  bottomPad: number;
  label?: string;
}) {
  return (
    <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom={bottomPad}>
      <View
        testID="custom-confirm"
        backgroundColor={enabled ? '$primary' : '$divider'}
        borderRadius="$pill"
        minHeight="$touchMin"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        opacity={enabled ? 1 : 0.7}
        pressStyle={enabled ? { backgroundColor: '$primaryPress' } : undefined}
        onPress={enabled ? onPress : undefined}
        {...buttonA11y(Platform.OS, { label, disabled: !enabled })}
      >
        <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </YStack>
  );
}

// ─── ScrollAffordanceList — lista scrolleable con AFFORDANCE de scroll (bug cazado por Raf) ──────────────
//
// Cuando las opciones de un enum (single/multi) EXCEDEN el alto disponible, no se notaba que se podía
// scrollear (el operario creía que las visibles eran TODAS). Esta lista deja CLARO que hay más:
//   - FADE-gradiente en el borde con contenido oculto (abajo si falta scrollear; arriba si ya scrolleó) →
//     decisión PURA en `scrollFades` (scroll-affordance.ts).
//   - CHEVRON ▾ atenuado sobre el fade de abajo → señal explícita "seguí bajando".
//   - PEEK: el contentContainer agrega `paddingBottom` extra → el último ítem NO termina justo en el borde,
//     asoma un parcial → refuerza "hay más" (un borde limpio de ítem completo se lee como "esto es todo").
// Los overlays son `pointerEvents="none"` → NO interceptan el scroll ni los taps de los ítems. Web-safe:
// `onScroll`/`onContentSizeChange`/`onLayout` andan en react-native-web. testID en los fades para el e2e.

const SCROLL_AFFORDANCE_THROTTLE = 16; // ~60fps; suficiente para el flag, sin floodear en web.
// El LinearGradient (API no-Tamagui) llena su View contenedor (que ya tiene el posicionamiento por tokens).
// `flex` no es spacing/color → no aplica el lint anti-hardcode; el tamaño/posición viven en el View padre.
const fillStyle = { flex: 1 } as const;

function ScrollAffordanceList({
  children,
  testIDPrefix,
  bottomPad,
  contentGap = '$2',
  fillHeight = false,
  fadeColorToken = '$bg',
}: {
  children: ReactNode;
  /** Prefijo de testID para los fades (ej. "custom-enum" → "custom-enum-scroll-fade-bottom"). */
  testIDPrefix: string;
  /** Padding inferior del contentContainer (deja respirar + asegura el PEEK del último ítem). */
  bottomPad: number;
  /** gap entre ítems (token de space). */
  contentGap?: TamaguiToken;
  /** Token de color del fade (debe matchear el FONDO sobre el que va la lista: $bg fuera de card, $surface
   *  adentro de una card). El gradiente va de transparente a este color para "desvanecer" lo oculto. */
  fadeColorToken?: TamaguiToken;
  /**
   * `flexGrow:1` en el contentContainer → con POCAS opciones los ítems `flexGrow` se reparten el alto (bloques
   * gigantes de manga, idiom DientesStep); con MUCHAS overflowea y scrollea (ítems a su minHeight). enum_single
   * lo usa (bloques que llenan); enum_multi NO (vive dentro de una card con su propio layout top-aligned).
   */
  fillHeight?: boolean;
}) {
  const [fades, setFades] = useState<ScrollFades>({ top: false, bottom: false });
  // Guardamos viewport y content por separado: el fade se recomputa ante CUALQUIER cambio de los tres.
  const geomRef = useMemoGeomRef();

  function recompute() {
    setFades(scrollFades({ scrollY: geomRef.scrollY, viewportHeight: geomRef.viewport, contentHeight: geomRef.content }));
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
  const fadeH = getTokenValue('$searchBarLg', 'size'); // alto del fade ≈ un ítem → cubre el parcial que asoma.
  const transparent = 'transparent';
  // El padding inferior del contentContainer (PEEK): un poco más que bottomPad → el último ítem asoma parcial.
  const peekPadBottom = bottomPad + getTokenValue('$5', 'space');

  return (
    <View flex={1} position="relative">
      <ScrollView
        flex={1}
        showsVerticalScrollIndicator
        scrollEventThrottle={SCROLL_AFFORDANCE_THROTTLE}
        onScroll={onScroll}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        contentContainerStyle={{
          gap: getTokenValue(contentGap, 'space'),
          // PEEK: padding extra abajo → el último ítem no termina pegado al borde → asoma un parcial.
          paddingBottom: peekPadBottom,
          ...(fillHeight ? { flexGrow: 1 } : null),
        }}
      >
        {children}
      </ScrollView>

      {/* FADE ARRIBA — solo cuando ya se scrolleó (hay contenido oculto arriba). El posicionamiento va en el
          View de Tamagui (tokens $0); la altura del fade va en el `style` del gradiente (API no-Tamagui). */}
      {fades.top ? (
        <View position="absolute" top="$0" left="$0" right="$0" height={fadeH} pointerEvents="none">
          <LinearGradient
            testID={`${testIDPrefix}-scroll-fade-top`}
            colors={[bgHex, transparent]}
            pointerEvents="none"
            style={fillStyle}
          />
        </View>
      ) : null}

      {/* FADE ABAJO + CHEVRON ▾ — cuando falta scrollear (hay contenido oculto abajo). */}
      {fades.bottom ? (
        <View position="absolute" bottom="$0" left="$0" right="$0" height={fadeH} pointerEvents="none" alignItems="center" justifyContent="flex-end">
          <View position="absolute" top="$0" left="$0" right="$0" bottom="$0" pointerEvents="none">
            <LinearGradient
              testID={`${testIDPrefix}-scroll-fade-bottom`}
              colors={[transparent, bgHex]}
              pointerEvents="none"
              style={fillStyle}
            />
          </View>
          <View paddingBottom="$1">
            <ChevronDown size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.5} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Ref mutable simple para la geometría del scroll (evita re-renders por cada medida intermedia). */
function useMemoGeomRef() {
  return useMemo(() => ({ scrollY: 0, viewport: 0, content: 0 }), []);
}

// ─── numeric → keypad de PesajeStep (sin "kg") ─────────────────────────────────────────────────────────

const KEY_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', 'del'],
];
const DECIMAL_SEP = ',';

function formatNumAR(raw: string): string {
  if (raw.length === 0) return '0';
  const [intPart, decPart] = raw.split(DECIMAL_SEP);
  const intNum = Number(intPart === '' ? '0' : intPart);
  const intFmt = Number.isFinite(intNum) ? intNum.toLocaleString('es-AR') : intPart;
  return raw.includes(DECIMAL_SEP) ? `${intFmt}${DECIMAL_SEP}${decPart}` : intFmt;
}

function parseNum(raw: string): number {
  if (raw.length === 0) return NaN;
  const n = Number(raw.replace(DECIMAL_SEP, '.'));
  return Number.isFinite(n) ? n : NaN;
}

function initialNumRaw(v: CustomCaptureValue | null | undefined): string {
  if (!v || v.kind !== 'number' || !Number.isFinite(v.value)) return '';
  return Number.isInteger(v.value) ? String(v.value) : String(v.value).replace('.', DECIMAL_SEP);
}

function NumericKeypad({ initialValue, onConfirm, bottomPad }: CustomManeuverStepProps) {
  const [raw, setRaw] = useState<string>(() => initialNumRaw(initialValue));
  const PRIMARY = getTokenValue('$primary', 'color');
  const KEY_ICON = getTokenValue('$icon', 'size');
  const n = parseNum(raw);
  // Un numérico custom permite cualquier finito (ángulo, score; 0/negativo válidos); solo exige "hay un número".
  const canConfirm = Number.isFinite(n) && raw.length > 0;

  function pressKey(k: string) {
    if (k === 'del') {
      setRaw((p) => p.slice(0, -1));
      return;
    }
    if (k === DECIMAL_SEP) {
      setRaw((p) => (p.includes(DECIMAL_SEP) ? p : p.length === 0 ? `0${DECIMAL_SEP}` : p + DECIMAL_SEP));
      return;
    }
    setRaw((p) => (p.replace(DECIMAL_SEP, '').length >= 6 ? p : p + k));
  }

  return (
    <YStack flex={1} backgroundColor="$bg">
      <XStack testID="custom-num-display" paddingHorizontal="$4" paddingTop="$2" paddingBottom="$3" justifyContent="center">
        <Text fontFamily="$heading" fontSize="$11" lineHeight="$11" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {formatNumAR(raw)}
        </Text>
      </XStack>
      <YStack flex={1} paddingHorizontal="$4" gap="$2">
        {KEY_ROWS.map((row, ri) => (
          <XStack key={`row-${ri}`} flex={1} gap="$2">
            {row.map((k) => (
              <View
                key={k}
                flexGrow={1}
                flexShrink={1}
                flexBasis={0}
                minWidth={0}
                overflow="hidden"
                backgroundColor="$surface"
                borderRadius="$card"
                borderWidth={2}
                borderColor="$textFaint"
                alignItems="center"
                justifyContent="center"
                pressStyle={{ backgroundColor: '$greenLight' }}
                onPress={() => pressKey(k)}
                {...buttonA11y(Platform.OS, { label: k === 'del' ? 'Borrar' : k })}
              >
                {k === 'del' ? (
                  <Delete size={KEY_ICON} color={PRIMARY} />
                ) : (
                  <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                    {k}
                  </Text>
                )}
              </View>
            ))}
          </XStack>
        ))}
      </YStack>
      <ConfirmCta enabled={canConfirm} onPress={() => onConfirm({ kind: 'number', value: n })} bottomPad={bottomPad} />
    </YStack>
  );
}

// ─── numeric_stepped → stepper de CondicionCorporalStep (paso de a 1, libre de rango) ──────────────────

const STEP = 1;

function NumericStepper({ initialValue, onConfirm, bottomPad }: CustomManeuverStepProps) {
  const start = initialValue && initialValue.kind === 'number' && Number.isFinite(initialValue.value)
    ? initialValue.value
    : 0;
  const [value, setValue] = useState<number>(start);
  const WHITE = getTokenValue('$white', 'color');
  const STEP_ICON = getTokenValue('$icon', 'size');

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2">
      <YStack
        flex={1}
        marginVertical="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$5"
        justifyContent="center"
        gap="$6"
      >
        <View testID="custom-stepper-display" alignItems="center" justifyContent="center" width="100%">
          <Text fontFamily="$heading" fontSize="$11" lineHeight="$11" fontWeight="700" color="$textPrimary" textAlign="center">
            {value.toLocaleString('es-AR')}
          </Text>
        </View>
        <XStack alignItems="center" justifyContent="center" gap="$5" width="100%">
          <View
            testID="custom-stepper-minus"
            width="$stepperBtn"
            height="$stepperBtn"
            backgroundColor="$primary"
            borderRadius="$card"
            borderWidth={2}
            borderColor="$primary"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$primaryPress' }}
            onPress={() => setValue((v) => v - STEP)}
            {...buttonA11y(Platform.OS, { label: 'Bajar' })}
          >
            <Minus size={STEP_ICON} color={WHITE} strokeWidth={3} />
          </View>
          <View
            testID="custom-stepper-plus"
            width="$stepperBtn"
            height="$stepperBtn"
            backgroundColor="$primary"
            borderRadius="$card"
            borderWidth={2}
            borderColor="$primary"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$primaryPress' }}
            onPress={() => setValue((v) => v + STEP)}
            {...buttonA11y(Platform.OS, { label: 'Subir' })}
          >
            <Plus size={STEP_ICON} color={WHITE} strokeWidth={3} />
          </View>
        </XStack>
      </YStack>
      <ConfirmCta enabled onPress={() => onConfirm({ kind: 'number', value })} bottomPad={bottomPad} />
    </YStack>
  );
}

// ─── enum_single → bloques NEUTROS tipo DientesStep (elegí UNO de N; un toque elige + confirma) ──────────
//
// VETO (M5-C.3, 2026-06-17): un enum_single GENÉRICO no tiene semántica "apta/no-apta" (eso es TactoVaquillona,
// donde el ✓/✗/⏲ son íconos SEMÁNTICOS del resultado). Acá las N opciones son "elegí UNA" → render NEUTRO en
// reposo, idiom de DientesStep ("elegí uno de N estados", sin pre-selección): superficie + borde, label
// centrado, SIN ✓ en reposo (un ✓ en cada bloque se leía como si las N estuvieran SELECCIONADAS/confirmadas).
// Un toque = elige + avanza (manga: una decisión por pantalla); la elegida se marca un instante (relleno
// $primary + ✓) antes de que el frame avance, para feedback de "tocaste ESTA". La captura del value es la
// misma: onConfirm({ kind:'string', value: opt }) — no cambia la lógica.

function EnumSingleBlocks({ options, onConfirm, bottomPad }: CustomManeuverStepProps) {
  const WHITE = getTokenValue('$white', 'color');
  const ICON = getTokenValue('$icon', 'size');
  const opts = options.length > 0 ? options : ['—'];
  // La opción tocada (se rellena un instante para feedback "elegiste ESTA"); el frame avanza acto seguido.
  const [picked, setPicked] = useState<string | null>(null);

  function pick(opt: string) {
    setPicked(opt);
    onConfirm({ kind: 'string', value: opt });
  }

  // Bloques DENTRO de un ScrollAffordanceList (fillHeight): pocas opciones → bloques gigantes que llenan el
  // alto (idiom DientesStep); MUCHAS (las que reportó Raf) → scrollea con affordance (fade abajo + chevron +
  // peek) → el operario VE que hay más opciones. Cada bloque tiene minHeight manga (no se aplasta con N alto).
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2">
      <ScrollAffordanceList testIDPrefix="custom-enum" bottomPad={bottomPad} fillHeight>
        {opts.map((opt) => {
          const isPicked = picked === opt;
          return (
            <View
              key={opt}
              testID={`custom-enum-block-${opt}`}
              flexGrow={1}
              flexBasis={0}
              minHeight={getTokenValue('$searchBarLg', 'size')}
              backgroundColor={isPicked ? '$primary' : '$surface'}
              borderRadius="$card"
              borderWidth={2}
              borderColor={isPicked ? '$primary' : '$divider'}
              flexDirection="row"
              alignItems="center"
              justifyContent="center"
              gap="$2"
              pressStyle={{ backgroundColor: '$greenLight' }}
              onPress={() => pick(opt)}
              {...buttonA11y(Platform.OS, { label: opt, selected: isPicked })}
            >
              {isPicked ? <Check size={ICON} color={WHITE} strokeWidth={3} /> : null}
              <Text
                fontFamily="$heading"
                fontSize="$9"
                lineHeight="$9"
                fontWeight="700"
                color={isPicked ? '$white' : '$textPrimary'}
                textAlign="center"
                numberOfLines={2}
              >
                {opt}
              </Text>
            </View>
          );
        })}
      </ScrollAffordanceList>
    </YStack>
  );
}

// ─── boolean → 2 bloques Sí / No (tipo TactoStep PREÑADA/VACÍA) ────────────────────────────────────────

function BooleanBlocks({ onConfirm, bottomPad }: CustomManeuverStepProps) {
  const WHITE = getTokenValue('$white', 'color');
  const ICON = getTokenValue('$icon', 'size');
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      <View
        testID="custom-bool-yes"
        flex={1}
        backgroundColor="$primary"
        borderRadius="$card"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        pressStyle={{ backgroundColor: '$primaryPress' }}
        onPress={() => onConfirm({ kind: 'boolean', value: true })}
        {...buttonA11y(Platform.OS, { label: 'Sí' })}
      >
        <Check size={ICON} color={WHITE} strokeWidth={3} />
        <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$white" numberOfLines={1}>
          SÍ
        </Text>
      </View>
      <View
        testID="custom-bool-no"
        flex={1}
        backgroundColor="$terracota"
        borderRadius="$card"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        pressStyle={{ backgroundColor: '$terracota' }}
        onPress={() => onConfirm({ kind: 'boolean', value: false })}
        {...buttonA11y(Platform.OS, { label: 'No' })}
      >
        <X size={ICON} color={WHITE} strokeWidth={3} />
        <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$white" numberOfLines={1}>
          NO
        </Text>
      </View>
    </YStack>
  );
}

// ─── enum_multi → multi-select de chips tipo SilentVaccinationStep (solo las opciones, sin texto libre) ──

function EnumMultiSelect({ options, initialValue, onConfirm, bottomPad }: CustomManeuverStepProps) {
  const start = initialValue && initialValue.kind === 'multi' ? initialValue.value : [];
  const [selected, setSelected] = useState<string[]>(() => [...start]);
  const selectedSet = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const opts = options.length > 0 ? options : [];

  function toggle(opt: string) {
    setSelected((prev) =>
      prev.some((p) => p.toLowerCase() === opt.toLowerCase())
        ? prev.filter((p) => p.toLowerCase() !== opt.toLowerCase())
        : [...prev, opt],
    );
  }

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      <YStack
        flex={1}
        marginTop="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$4"
        gap="$3"
      >
        {/* Sub-header de la card. numberOfLines={2} + lineHeight matching: "Elegí"/"correspondan" tienen
            descendentes (g) → con {1} se recortaban en el borde superior de la card. */}
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={2}>
          Elegí las que correspondan
        </Text>
        {/* Lista con AFFORDANCE de scroll (fade $surface — el fondo de la card — + chevron + peek): con muchas
            opciones se nota que hay más para scrollear (bug cazado por Raf). NO fillHeight: la card ya da el
            alto; la lista es top-aligned (idiom SilentVaccinationStep). */}
        <ScrollAffordanceList testIDPrefix="custom-multi" bottomPad={0} fadeColorToken="$surface">
          {opts.map((opt) => {
            const isOn = selectedSet.has(opt.toLowerCase());
            return (
              <View
                key={opt}
                testID={`custom-multi-${opt}`}
                minHeight="$touchMin"
                borderRadius="$card"
                borderWidth={2}
                borderColor={isOn ? '$primary' : '$divider'}
                backgroundColor={isOn ? '$primary' : '$white'}
                flexDirection="row"
                alignItems="center"
                paddingHorizontal="$4"
                gap="$3"
                pressStyle={{ opacity: 0.85 }}
                onPress={() => toggle(opt)}
                {...buttonA11y(Platform.OS, { label: opt, selected: isOn })}
              >
                {isOn ? <Check size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} /> : null}
                <Text
                  flex={1}
                  minWidth={0}
                  fontFamily="$body"
                  fontSize="$6"
                  lineHeight="$6"
                  fontWeight="600"
                  color={isOn ? '$white' : '$textPrimary'}
                  numberOfLines={2}
                >
                  {opt}
                </Text>
              </View>
            );
          })}
        </ScrollAffordanceList>
      </YStack>
      {/* CTA habilitado SIEMPRE: una multi "sin nada elegido" igual es un dato válido (R13.16: array vacío es
          un enum_multi legítimo server-side). El operario confirma lo seleccionado (incluso vacío). */}
      <ConfirmCta enabled onPress={() => onConfirm({ kind: 'multi', value: selected })} bottomPad={bottomPad} />
    </YStack>
  );
}

// ─── text → input grande tipo SilentSanitaryStep ───────────────────────────────────────────────────────

function TextInputStep({ initialValue, onConfirm, bottomPad }: CustomManeuverStepProps) {
  const start = initialValue && initialValue.kind === 'string' ? initialValue.value : '';
  const [typed, setTyped] = useState<string>(start);
  const value: CustomCaptureValue = { kind: 'string', value: typed };
  const canConfirm = isCustomValueComplete(value);
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" gap="$3">
      <YStack
        flex={1}
        marginTop="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$5"
        gap="$4"
      >
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder="Escribí el dato"
          placeholderTextColor={getTokenValue('$textMuted', 'color')}
          autoCapitalize="sentences"
          returnKeyType="done"
          testID="custom-text-input"
          style={{
            minHeight: getTokenValue('$searchBarLg', 'size'),
            borderRadius: getTokenValue('$card', 'radius'),
            borderWidth: 1,
            borderColor: getTokenValue('$divider', 'color'),
            backgroundColor: getTokenValue('$white', 'color'),
            paddingHorizontal: getTokenValue('$4', 'space'),
            fontSize: getTokenValue('$inputText', 'size'),
            fontFamily: 'Inter',
            color: getTokenValue('$textPrimary', 'color'),
          }}
          {...labelA11y(Platform.OS, 'Dato personalizado')}
        />
      </YStack>
      <ConfirmCta enabled={canConfirm} onPress={() => onConfirm({ kind: 'string', value: typed.trim() })} bottomPad={bottomPad} label="Guardar y seguir" />
    </YStack>
  );
}

// ─── date → input con máscara es-AR (maskDateInput → AAAA-MM-DD, formato de máquina) ───────────────────

function DateInput({ initialValue, onConfirm, bottomPad }: CustomManeuverStepProps) {
  const start = initialValue && initialValue.kind === 'string' ? initialValue.value : '';
  const [typed, setTyped] = useState<string>(start);
  // AAAA-MM-DD completo (10 chars) habilita; el server re-valida el formato de fecha.
  const canConfirm = /^\d{4}-\d{2}-\d{2}$/.test(typed);
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" gap="$3">
      <YStack
        flex={1}
        marginTop="$2"
        backgroundColor="$surface"
        borderRadius="$card"
        borderWidth={1}
        borderColor="$divider"
        paddingHorizontal="$4"
        paddingVertical="$5"
        gap="$4"
      >
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" numberOfLines={1}>
          Fecha (AAAA-MM-DD)
        </Text>
        <TextInput
          value={typed}
          onChangeText={(t) => setTyped(maskDateInput(t))}
          placeholder="2026-06-17"
          placeholderTextColor={getTokenValue('$textMuted', 'color')}
          keyboardType="number-pad"
          returnKeyType="done"
          testID="custom-date-input"
          style={{
            minHeight: getTokenValue('$searchBarLg', 'size'),
            borderRadius: getTokenValue('$card', 'radius'),
            borderWidth: 1,
            borderColor: getTokenValue('$divider', 'color'),
            backgroundColor: getTokenValue('$white', 'color'),
            paddingHorizontal: getTokenValue('$4', 'space'),
            fontSize: getTokenValue('$inputText', 'size'),
            fontFamily: 'Inter',
            color: getTokenValue('$textPrimary', 'color'),
          }}
          {...labelA11y(Platform.OS, 'Fecha')}
        />
      </YStack>
      <ConfirmCta enabled={canConfirm} onPress={() => onConfirm({ kind: 'string', value: typed })} bottomPad={bottomPad} />
    </YStack>
  );
}
