// app/maniobra/_components/CondicionCorporalStep.tsx — PASO de CONDICIÓN CORPORAL (spec 03 M3.2a, R6.6).
//
// Selector CERRADO 1,00–5,00 con step 0,25 (default 3,00) → condition_score_events. El CUERPO del stepper
// (valor hero full-width + botones − / + GIGANTES + pista de escala 1…5) vive ahora en el componente
// COMPARTIDO `ConditionScoreStepper` (delta spec 02 alta-form-refinamiento, RAF2.2): este paso de la
// maniobra lo ENVUELVE con su estado interno (default 3,00 o el cargado para corrección, R5.9) y su CTA
// "Confirmar" full-width en la zona del pulgar. Comportamiento IDÉNTICO al previo (R6.6 sin cambios):
// mismos testIDs (score-display / score-minus / score-plus / confirm-step), misma a11y, mismos tokens.
//
// Toda la aritmética del paso (clamp/snap a la grilla de 0,25, ±, formato es-AR) sigue en la util PURA
// `condition-stepper.ts` (testeada sin UI) — la consume el componente compartido. El score que se persiste
// es float de máquina (lo arma el StepValue del orquestador). Cero hardcode (ADR-023 §4): tokens; lucide
// vía getTokenValue. Recorte de descendentes: lineHeight matcheado en todo Text.

import { useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { ConditionScoreStepper } from '@/components';
import { buttonA11y } from '@/utils/a11y';
import { SCORE_DEFAULT, snapScore } from '@/utils/condition-stepper';

export type CondicionCorporalStepProps = {
  /** Score ya cargado (corrección desde el resumen, R5.9) o null si es la 1ra captura → default 3,00. */
  initialScore?: number | null;
  /** Devuelve el score confirmado (1,00–5,00 en grilla de 0,25) al frame, que lo persiste con session_id. */
  onConfirm: (score: number) => void;
  bottomPad: number;
};

export function CondicionCorporalStep({ initialScore = null, onConfirm, bottomPad }: CondicionCorporalStepProps) {
  // Arranca en el valor cargado (corrección, R5.9, snapeado a grilla) o en el default 3,00 (1ra captura).
  const [score, setScore] = useState<number>(() =>
    initialScore != null ? snapScore(initialScore) : SCORE_DEFAULT,
  );

  const WHITE = getTokenValue('$white', 'color');

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2">
      {/* CUERPO del stepper (card con peso que ocupa el alto útil, densidad R12.5). El componente compartido
          renderiza el valor hero + − / + + la pista de escala; el estado y el CTA viven acá. */}
      <ConditionScoreStepper score={score} onChange={setScore} />

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
