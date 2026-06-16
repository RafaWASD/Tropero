// app/maniobra/_components/PlaceholderStep.tsx — paso PLACEHOLDER de una maniobra aún no cableada (M3).
//
// El frame de carga rápida (M2.2) es genérico: itera TODAS las maniobras de la sesión. Las que M2.2 no
// cablea todavía (vacunación, sangrado, raspado, condición corporal, dientes, tacto vaquillona,
// inseminación, + antiparasitario/antibiótico de M3) se muestran con ESTE placeholder claro ("pendiente
// M3") que NO rompe la secuencia: el operario la SALTA y avanza al siguiente paso. NO persiste evento
// (el orquestador devuelve `skipped`). Cuando M3 implemente la maniobra, su renderer reemplaza este
// placeholder en el dispatcher del frame — el frame no cambia.
//
// Cero hardcode (ADR-023 §4): tokens. Recorte de descendentes: lineHeight matching en el heading.

import { Platform } from 'react-native';
import { getTokenValue, Text, View, YStack } from 'tamagui';
import { Wrench } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';

export type PlaceholderStepProps = {
  /** Nombre es-AR de la maniobra (R1.6), para que el operario sepa cuál quedó pendiente. */
  maneuverLabel: string;
  /** Avanza al siguiente paso sin persistir (marca la maniobra como saltada). */
  onSkip: () => void;
  bottomPad: number;
};

export function PlaceholderStep({ maneuverLabel, onSkip, bottomPad }: PlaceholderStepProps) {
  const muted = getTokenValue('$textMuted', 'color');
  const heroIcon = getTokenValue('$heroIcon', 'size');

  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$4" paddingBottom={bottomPad} gap="$4">
      <YStack flex={1} alignItems="center" justifyContent="center" gap="$5">
        <View
          width={getTokenValue('$heroScan', 'size') * 0.5}
          height={getTokenValue('$heroScan', 'size') * 0.5}
          borderRadius="$pill"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$divider"
          alignItems="center"
          justifyContent="center"
        >
          <Wrench size={heroIcon} color={muted} strokeWidth={2} />
        </View>
        <YStack alignItems="center" gap="$2">
          <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" textAlign="center" numberOfLines={1}>
            {maneuverLabel}
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
            Esta maniobra todavía no se carga en la app (llega en la próxima entrega). Por ahora seguí con la siguiente.
          </Text>
        </YStack>
      </YStack>

      <View
        testID="confirm-step"
        backgroundColor="$primary"
        borderRadius="$pill"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        pressStyle={{ backgroundColor: '$primaryPress' }}
        onPress={onSkip}
        {...buttonA11y(Platform.OS, { label: 'Saltar y seguir' })}
      >
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          Saltar y seguir
        </Text>
      </View>
    </YStack>
  );
}
