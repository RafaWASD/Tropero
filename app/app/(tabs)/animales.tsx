// app/(tabs)/animales.tsx — STUB de la tab Animales (ADR-018, spec 09 R1).
// Puerta manual de BUSCAR ANIMAL (AnimalsTabScreen). Placeholder del shell (B.0).
import { Text, YStack } from 'tamagui';

export default function AnimalesScreen() {
  return (
    <YStack flex={1} backgroundColor="$bg" alignItems="center" justifyContent="center" padding="$4">
      <Text fontSize="$8" fontWeight="700" color="$textPrimary">
        Animales
      </Text>
      <Text fontSize="$4" color="$textMuted" marginTop="$2">
        Stub — BUSCAR ANIMAL (spec 09)
      </Text>
    </YStack>
  );
}
