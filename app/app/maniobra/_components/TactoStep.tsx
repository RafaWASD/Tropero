// app/maniobra/_components/TactoStep.tsx — PASO de TACTO DE VACA cableado (spec 03 M2.2, R6.2 / §6.bis.2).
//
// Porta el lenguaje visual YA APROBADO del spike M2.0 (`app/maniobra/carga.tsx`): bloques de decisión
// full-width que se REPARTEN el alto del viewport (R5.2/R12.5), alto contraste, label gigante centrado.
// NO se rediseña — se estructura como paso de 2 SUB-PASOS condicionales que devuelve UN pregnancy_status al
// frame (onConfirm), que persiste UN único reproductive_events (R6.2):
//
//   Sub-paso 1 — ¿Preñada?     [ PREÑADA ]   [ VACÍA ]      (2 bloques gigantes)
//     · VACÍA   → onConfirm('empty')  → cierra la maniobra (sin sub-paso 2).
//     · PREÑADA → abre el sub-paso 2 condicional de tamaño.
//   Sub-paso 2 — Tamaño (solo si PREÑADA): [ CABEZA ] [ CUERPO ] [ COLA ]   (3 bloques gigantes)
//     · CABEZA→'large' · CUERPO→'medium' · COLA→'small'  (labels de campo as-built dominio Facundo §4,
//       event-timeline.PREGNANCY_LABELS: small=Cola, medium=Cuerpo, large=Cabeza). onConfirm(<tamaño>).
//
// El paso 2 (tamaño) figura como M3 en el split, pero M2.2 lo cablea para NO persistir un tacto incompleto
// (el enum no tiene un "preñada sin tamaño") → el dato es completo y correcto. Reconciliación documentada.
//
// Recorte de descendentes (memoria): "PREÑADA" trae ñ → veta el clip en el texto gigante ($10). Cero
// hardcode (ADR-023 §4): tokens. El header de identidad + la línea de maniobra los pone el FRAME.

import { useState } from 'react';
import { Platform } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { ArrowLeft, Check, X } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import type { PregnancyStatus } from '@/utils/maneuver-sequence';

export type TactoStepProps = {
  /** Devuelve el pregnancy_status final (un único reproductive_events) al frame, que lo persiste. */
  onConfirm: (status: PregnancyStatus) => void;
  bottomPad: number;
};

type Phase = 'binary' | 'size';

/** Color de fondo de un bloque de decisión (token Tamagui). Acotado a los que usa el tacto. */
type DecisionColor = '$primary' | '$primaryPress' | '$terracota';

/** Un bloque de decisión gigante full-width que se reparte el alto (flex:1). Label centrado + ícono opcional. */
function DecisionBlock({
  label,
  bg,
  pressBg,
  icon,
  onPress,
}: {
  label: string;
  bg: DecisionColor;
  pressBg: DecisionColor;
  icon?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <View
      testID="decision-block"
      flex={1}
      backgroundColor={bg}
      borderRadius="$card"
      alignItems="center"
      justifyContent="center"
      gap="$2"
      pressStyle={{ backgroundColor: pressBg }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label })}
    >
      {icon}
      <Text fontFamily="$heading" fontSize="$10" lineHeight="$10" fontWeight="700" color="$white" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function TactoStep({ onConfirm, bottomPad }: TactoStepProps) {
  const [phase, setPhase] = useState<Phase>('binary');
  const WHITE = getTokenValue('$white', 'color');
  const DECISION_ICON = getTokenValue('$icon', 'size');

  if (phase === 'binary') {
    return (
      <YStack
        flex={1}
        backgroundColor="$bg"
        paddingHorizontal="$4"
        paddingTop="$2"
        paddingBottom={bottomPad}
        gap="$3"
      >
        <DecisionBlock
          label="PREÑADA"
          bg="$primary"
          pressBg="$primaryPress"
          icon={<Check size={DECISION_ICON} color={WHITE} strokeWidth={3} />}
          onPress={() => setPhase('size')}
        />
        <DecisionBlock
          label="VACÍA"
          bg="$terracota"
          pressBg="$terracota"
          icon={<X size={DECISION_ICON} color={WHITE} strokeWidth={3} />}
          onPress={() => onConfirm('empty')}
        />
      </YStack>
    );
  }

  // Sub-paso 2 — tamaño (solo si PREÑADA). 3 bloques: CABEZA/CUERPO/COLA → large/medium/small (Facundo §4).
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$3">
      <DecisionBlock label="CABEZA" bg="$primary" pressBg="$primaryPress" onPress={() => onConfirm('large')} />
      <DecisionBlock label="CUERPO" bg="$primary" pressBg="$primaryPress" onPress={() => onConfirm('medium')} />
      <DecisionBlock label="COLA" bg="$primary" pressBg="$primaryPress" onPress={() => onConfirm('small')} />

      {/* Volver al sub-paso 1 (corrección antes de confirmar) — secundario, no compite con los bloques. */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        minHeight="$touchMin"
        pressStyle={{ opacity: 0.6 }}
        onPress={() => setPhase('binary')}
        {...buttonA11y(Platform.OS, { label: 'Volver a preñada o vacía' })}
      >
        <ArrowLeft size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2} />
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
          Volver
        </Text>
      </View>
    </YStack>
  );
}
