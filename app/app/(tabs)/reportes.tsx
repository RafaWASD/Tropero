// app/(tabs)/reportes.tsx — STUB de la tab Reportes (ADR-018, spec 07).
// Placeholder del shell de navegación (B.0).
import { Text, YStack } from 'tamagui';

export default function ReportesScreen() {
  return (
    <YStack flex={1} backgroundColor="$bg" alignItems="center" justifyContent="center" padding="$4">
      <Text fontSize="$8" fontWeight="700" color="$textPrimary">
        Reportes
      </Text>
      <Text fontSize="$4" color="$textMuted" marginTop="$2">
        Stub — KPIs y resúmenes (spec 07)
      </Text>
    </YStack>
  );
}
