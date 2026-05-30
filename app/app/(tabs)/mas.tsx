// app/(tabs)/mas.tsx — STUB de la tab Más (ADR-018, spec 01).
// Cajón de settings + perfil + miembros/invitaciones + asignación masiva de
// caravanas + switch de establecimiento. Placeholder del shell (B.0).
import { Text, YStack } from 'tamagui';

export default function MasScreen() {
  return (
    <YStack flex={1} backgroundColor="$bg" alignItems="center" justifyContent="center" padding="$4">
      <Text fontSize="$8" fontWeight="700" color="$textPrimary">
        Más
      </Text>
      <Text fontSize="$4" color="$textMuted" marginTop="$2">
        Stub — settings, miembros, switch de campo
      </Text>
    </YStack>
  );
}
