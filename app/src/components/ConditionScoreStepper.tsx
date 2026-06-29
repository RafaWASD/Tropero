// ConditionScoreStepper — STEPPER de condición corporal PRESENTACIONAL y CONTROLADO (spec 03 R6.6 +
// delta spec 02 alta-form-refinamiento RAF2.2). Extraído del cuerpo de `CondicionCorporalStep` (maniobra)
// para reusarlo en el ALTA sin duplicar JSX ni aritmética.
//
// VALOR hero en su propia línea full-width (token $11=64px) con coma decimal es-AR ("3,00"), botones
// − / + GIGANTES ($stepperBtn) debajo lado a lado, y pista de escala (marcas 1…5 con la activa en verde)
// abajo. El valor tiene todo el ancho → nunca se trunca (web-safe; SIN numberOfLines/adjustsFontSizeToFit).
// Toda la aritmética (clamp/snap a 0,25, ±, formato es-AR) vive en la util PURA `condition-stepper.ts`
// (testeada sin UI) — este componente sólo dibuja y delega vía `onChange`. Botón − deshabilitado en el
// piso (1,00), + en el tope (5,00).
//
// CONTROLADO: el padre es dueño del `score` y recibe el resultado (snapeado) por `onChange`. La maniobra
// lo envuelve con su `useState` + CTA "Confirmar"; el alta lo usa con tri-estado (null = "sin cargar",
// mostrado `dimmed`). `compact` ajusta el layout para embeberlo en el scroll del paso 4 (sin ocupar
// flex={1} de pantalla como en la maniobra). Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue.
// Recorte de descendentes: lineHeight matcheado en el valor hero (las marcas son dígitos sin descendentes).

import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Minus, Plus } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import {
  decrementScore,
  formatScoreAR,
  incrementScore,
  isScoreAtMax,
  isScoreAtMin,
  SCORE_MAX,
  SCORE_MIN,
  snapScore,
} from '@/utils/condition-stepper';

/** Marcas enteras de la escala (1…5) para la pista visual de progreso bajo el valor. */
const SCALE_MARKS: readonly number[] = Array.from(
  { length: SCORE_MAX - SCORE_MIN + 1 },
  (_, i) => SCORE_MIN + i,
);

/** Un botón GIGANTE − / + del stepper (cuadrado $stepperBtn). Deshabilitado en el límite (sin a dónde ir). */
function StepperButton({
  dir,
  icon,
  disabled,
  onPress,
}: {
  dir: 'minus' | 'plus';
  icon: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View
      testID={`score-${dir}`}
      width="$stepperBtn"
      height="$stepperBtn"
      backgroundColor={disabled ? '$surface' : '$primary'}
      borderRadius="$card"
      borderWidth={2}
      borderColor={disabled ? '$divider' : '$primary'}
      alignItems="center"
      justifyContent="center"
      opacity={disabled ? 0.5 : 1}
      pressStyle={disabled ? undefined : { backgroundColor: '$primaryPress' }}
      onPress={disabled ? undefined : onPress}
      {...buttonA11y(Platform.OS, { label: dir === 'minus' ? 'Bajar condición' : 'Subir condición', disabled })}
    >
      {icon}
    </View>
  );
}

export type ConditionScoreStepperProps = {
  /** Valor a mostrar (controlado). En el alta es `conditionScore ?? SCORE_DEFAULT` (mostrado `dimmed` si null). */
  score: number;
  /** Emite el resultado YA snapeado del increment/decrement. El padre persiste/setea el estado. */
  onChange: (next: number) => void;
  /** Layout embebido (alta, paso 4): sin ocupar flex={1} de pantalla; padding/gap más compactos. */
  compact?: boolean;
  /** Atenúa el valor hero + apaga la marca activa: "sin cargar" (alta con conditionScore null). */
  dimmed?: boolean;
};

export function ConditionScoreStepper({
  score,
  onChange,
  compact = false,
  dimmed = false,
}: ConditionScoreStepperProps) {
  const WHITE = getTokenValue('$white', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  const STEP_ICON = getTokenValue('$icon', 'size');
  const atMin = isScoreAtMin(score);
  const atMax = isScoreAtMax(score);
  // La marca entera ACTIVA = la parte entera del score (3,25 → marca 3). En "sin cargar" (dimmed) ninguna
  // marca queda activa (−1 ∉ 1..5) → la pista se lee como "todavía sin elegir".
  const activeMark = dimmed ? -1 : Math.floor(snapScore(score));

  return (
    <YStack
      flex={compact ? undefined : 1}
      marginVertical={compact ? undefined : '$2'}
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      paddingHorizontal="$4"
      paddingVertical={compact ? '$4' : '$5'}
      justifyContent="center"
      gap={compact ? '$4' : '$6'}
    >
      {/* VALOR hero EN SU PROPIA LÍNEA full-width → NUNCA se trunca (SIN numberOfLines/adjustsFontSizeToFit). */}
      <View testID="score-display" alignItems="center" justifyContent="center" width="100%">
        <Text
          fontFamily="$heading"
          fontSize="$11"
          lineHeight="$11"
          fontWeight="700"
          color={dimmed ? '$textMuted' : '$textPrimary'}
          textAlign="center"
        >
          {formatScoreAR(score)}
        </Text>
      </View>
      <XStack alignItems="center" justifyContent="center" gap="$5" width="100%">
        <StepperButton
          dir="minus"
          disabled={atMin}
          icon={<Minus size={STEP_ICON} color={atMin ? FAINT : WHITE} strokeWidth={3} />}
          onPress={() => onChange(decrementScore(score))}
        />
        <StepperButton
          dir="plus"
          disabled={atMax}
          icon={<Plus size={STEP_ICON} color={atMax ? FAINT : WHITE} strokeWidth={3} />}
          onPress={() => onChange(incrementScore(score))}
        />
      </XStack>

      {/* Pista de escala VISUAL: las 5 marcas (1…5) con la actual resaltada (verde). */}
      <XStack gap="$2" alignItems="flex-end" height="$icon">
        {SCALE_MARKS.map((mark) => {
          const isActive = mark === activeMark;
          return (
            <YStack key={mark} flex={1} alignItems="center" gap="$1">
              <View
                width="100%"
                height={isActive ? '$dot' : '$progressTrack'}
                borderRadius="$pill"
                backgroundColor={isActive ? '$primary' : '$divider'}
              />
              <Text
                fontFamily="$body"
                fontSize="$4"
                lineHeight="$4"
                fontWeight={isActive ? '700' : '500'}
                color={isActive ? '$primary' : '$textFaint'}
                numberOfLines={1}
              >
                {mark}
              </Text>
            </YStack>
          );
        })}
      </XStack>
    </YStack>
  );
}
