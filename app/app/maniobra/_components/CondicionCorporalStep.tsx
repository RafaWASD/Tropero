// app/maniobra/_components/CondicionCorporalStep.tsx — PASO de CONDICIÓN CORPORAL (spec 03 M3.2a, R6.6).
//
// Selector CERRADO 1,00–5,00 con step 0,25 (default 3,00) → condition_score_events. STEPPER de manga: el
// VALOR hero domina, EN SU PROPIA LÍNEA full-width arriba (token $11=64px, mismo que el peso de PesajeStep)
// con coma decimal es-AR ("3,00"), y botones − / + GIGANTES (≥80px, $stepperBtn=88) DEBAJO, lado a lado,
// para subir/bajar de a 0,25 con guante. El valor tiene todo el ancho → nunca se trunca (web-safe). Una
// sola decisión, rápida (R5.2: una decisión por pantalla). Pista de escala VISUAL (marcas 1…5 con la
// activa en verde) abajo. CTA "Confirmar" full-width en la zona del pulgar.
//
// Toda la aritmética del paso (clamp/snap a la grilla de 0,25, ±, formato es-AR) vive en la util PURA
// `condition-stepper.ts` (testeada sin UI) — este componente solo dibuja y delega. El botón − se
// deshabilita en el piso (1,00) y el + en el tope (5,00) — no hay a dónde seguir.
//
// es-AR (memoria reference_es_ar_number_format): el display lleva coma decimal + 2 decimales fijos (el
// número hero no salta de ancho). El score que se persiste es float de máquina (lo arma el StepValue del
// orquestador). Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. Recorte de descendentes:
// lineHeight matching en todo Text (las marcas son dígitos sin descendentes, pero mantenemos el patrón).

import { useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Check, Minus, Plus } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import {
  decrementScore,
  formatScoreAR,
  incrementScore,
  isScoreAtMax,
  isScoreAtMin,
  SCORE_DEFAULT,
  SCORE_MAX,
  SCORE_MIN,
  snapScore,
} from '@/utils/condition-stepper';

/** Marcas enteras de la escala (1…5) para la pista visual de progreso bajo el valor. */
const SCALE_MARKS: readonly number[] = Array.from(
  { length: SCORE_MAX - SCORE_MIN + 1 },
  (_, i) => SCORE_MIN + i,
);

export type CondicionCorporalStepProps = {
  /** Score ya cargado (corrección desde el resumen, R5.9) o null si es la 1ra captura → default 3,00. */
  initialScore?: number | null;
  /** Devuelve el score confirmado (1,00–5,00 en grilla de 0,25) al frame, que lo persiste con session_id. */
  onConfirm: (score: number) => void;
  bottomPad: number;
};

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

export function CondicionCorporalStep({ initialScore = null, onConfirm, bottomPad }: CondicionCorporalStepProps) {
  // Arranca en el valor cargado (corrección, R5.9, snapeado a grilla) o en el default 3,00 (1ra captura).
  const [score, setScore] = useState<number>(() =>
    initialScore != null ? snapScore(initialScore) : SCORE_DEFAULT,
  );

  const WHITE = getTokenValue('$white', 'color');
  const FAINT = getTokenValue('$textFaint', 'color');
  const STEP_ICON = getTokenValue('$icon', 'size');
  const atMin = isScoreAtMin(score);
  const atMax = isScoreAtMax(score);

  // La marca entera ACTIVA = la parte entera del score (3,25 → marca 3 resaltada). Para la pista visual.
  const activeMark = Math.floor(snapScore(score));

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2">
      {/* ── CARD del stepper: una superficie con PESO que ocupa el alto útil (densidad R12.5, sin vacíos
            muertos grandes) y delimita la zona de acción (figura-fondo) en vez de dejar el stepper flotando. ── */}
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
        {/*  VALOR hero EN SU PROPIA LÍNEA full-width (arriba) → botones − / + DEBAJO lado a lado.
            Antes el valor iba ENTRE los botones (− [valor] +) en flex={1}; con numberOfLines+ellipsize
            se truncaba a "4..." en web (adjustsFontSizeToFit es NO-OP en react-native-web → no achicaba).
            Ahora el valor tiene TODO el ancho de la card y NUNCA se trunca: SIN numberOfLines/ellipsize/
            adjustsFontSizeToFit. Sigue siendo un stepper, más prominente y robusto en web y native. */}
        <View testID="score-display" alignItems="center" justifyContent="center" width="100%">
          <Text
            fontFamily="$heading"
            fontSize="$11"
            lineHeight="$11"
            fontWeight="700"
            color="$textPrimary"
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
            onPress={() => setScore((s) => decrementScore(s))}
          />
          <StepperButton
            dir="plus"
            disabled={atMax}
            icon={<Plus size={STEP_ICON} color={atMax ? FAINT : WHITE} strokeWidth={3} />}
            onPress={() => setScore((s) => incrementScore(s))}
          />
        </XStack>

        {/* Pista de escala VISUAL: las 5 marcas (1…5) con la actual resaltada (verde) — comunica dónde cae
            el animal en el rango de un vistazo + llena el espacio con info útil (no un vacío muerto, R12.5).
            El hint de texto "1=flaca·5=gorda" se removió por pedido de Raf (en el campo ya se sabe). */}
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

      {/* CTA "✓ Confirmar" full-width (zona del pulgar). Siempre habilitado (hay un valor válido por default). */}
      <YStack paddingTop="$3" paddingBottom={bottomPad}>
        <View
          testID="confirm-step"
          backgroundColor="$primary"
          borderRadius="$pill"
          minHeight="$touchMin"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          pressStyle={{ backgroundColor: '$primaryPress' }}
          onPress={() => onConfirm(snapScore(score))}
          {...buttonA11y(Platform.OS, { label: 'Confirmar condición corporal' })}
        >
          <Check size={getTokenValue('$fabIcon', 'size')} color={WHITE} strokeWidth={3} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
            Confirmar
          </Text>
        </View>
      </YStack>
    </YStack>
  );
}
