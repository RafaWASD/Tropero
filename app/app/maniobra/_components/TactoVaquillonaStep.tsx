// app/maniobra/_components/TactoVaquillonaStep.tsx — PASO de TACTO VAQUILLONA (spec 03 M3.2a, R6.3 / R5.13).
//
// Resultado de aptitud reproductiva de una vaquillona: apta | no_apta | diferida → reproductive_events
// (event_type='tacto_vaquillona', heifer_fitness 0053). Porta el lenguaje visual YA APROBADO del tacto de
// vaca (TactoStep): bloques de decisión full-width que se REPARTEN el alto del viewport (R5.2/R12.5), alto
// contraste, label gigante centrado, un toque = elige y avanza (NO se rediseña).
//
// 3 bloques (mismo patrón que tacto vaca PREÑADA/VACÍA, pero 3) con COLOR INEQUÍVOCO en manga (dirección
// del leader):
//   [ APTA ]      verde botella ($primary)  + ✓   → onConfirm('apta')
//   [ NO APTA ]   terracota ($terracota)    + ✗   → onConfirm('no_apta')
//   [ DIFERIDA ]  ámbar ($amber)            + ⏲    → onConfirm('diferida')
// Cero ambigüedad de color: verde=apta, terracota=no apta, ámbar=diferida (espera/pausa). Cada bloque
// flex:1 → se reparten el alto (densidad ≥60%, R12.5; lado >60px holgado en 412×915).
//
// Recorte de descendentes (memoria): "DIFERIDA" no trae descendentes, pero el componente lleva lineHeight
// matching en todos los Text por convención (regla dura). Cero hardcode (ADR-023 §4): tokens; lo que cruza
// a lucide vía getTokenValue. El header de identidad + la línea de maniobra los pone el FRAME (carga.tsx).

import { Platform } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { Check, Clock, X } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import type { HeiferFitness } from '@/utils/maneuver-sequence';

export type TactoVaquillonaStepProps = {
  /** Devuelve la aptitud elegida (heifer_fitness) al frame, que persiste el reproductive_events. */
  onConfirm: (fitness: HeiferFitness) => void;
  bottomPad: number;
};

/** Color de fondo de un bloque (token Tamagui). Acotado a los 3 del tacto vaquillona + sus press. */
type FitnessColor = '$primary' | '$primaryPress' | '$terracota' | '$amber' | '$amberPress';

/** Un bloque de decisión gigante full-width (flex:1) — label centrado + ícono. Espeja DecisionBlock de TactoStep. */
function FitnessBlock({
  label,
  bg,
  pressBg,
  icon,
  onPress,
}: {
  label: string;
  bg: FitnessColor;
  pressBg: FitnessColor;
  icon: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <View
      testID={`fitness-block-${label}`}
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

export function TactoVaquillonaStep({ onConfirm, bottomPad }: TactoVaquillonaStepProps) {
  const WHITE = getTokenValue('$white', 'color');
  const ICON = getTokenValue('$icon', 'size');

  return (
    <YStack
      flex={1}
      backgroundColor="$bg"
      paddingHorizontal="$4"
      paddingTop="$2"
      paddingBottom={bottomPad}
      gap="$3"
    >
      <FitnessBlock
        label="APTA"
        bg="$primary"
        pressBg="$primaryPress"
        icon={<Check size={ICON} color={WHITE} strokeWidth={3} />}
        onPress={() => onConfirm('apta')}
      />
      <FitnessBlock
        label="NO APTA"
        bg="$terracota"
        pressBg="$terracota"
        icon={<X size={ICON} color={WHITE} strokeWidth={3} />}
        onPress={() => onConfirm('no_apta')}
      />
      <FitnessBlock
        label="DIFERIDA"
        bg="$amber"
        pressBg="$amberPress"
        icon={<Clock size={ICON} color={WHITE} strokeWidth={3} />}
        onPress={() => onConfirm('diferida')}
      />
    </YStack>
  );
}
