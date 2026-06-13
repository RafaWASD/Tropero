// app/maniobra.tsx — STUB de MODO MANIOBRAS (ADR-018, spec 03).
//
// Destino del FAB central elevado. Se presenta como modal (ver _layout.tsx raíz).
// El wizard real de la sesión de manga se implementa en spec 03 (Ola 3 del plan);
// hasta entonces esto es un placeholder navegable (B.0).
import { useRouter } from 'expo-router';
import { Zap } from 'lucide-react-native';
import { Button, Text, YStack, getTokenValue } from 'tamagui';

export default function ManiobraScreen() {
  const router = useRouter();
  const PRIMARY = getTokenValue('$primary', 'color');
  return (
    <YStack flex={1} backgroundColor="$bg" alignItems="center" justifyContent="center" padding="$4" gap="$4">
      <Zap size={48} color={PRIMARY} fill={PRIMARY} />
      <Text fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
        MODO MANIOBRAS
      </Text>
      <Text fontSize="$4" color="$textMuted" textAlign="center">
        Stub — wizard de la sesión de manga (spec 03)
      </Text>
      <Button
        backgroundColor="$primary"
        color="$white"
        height="$touchMin"
        borderRadius="$pill"
        paddingHorizontal="$6"
        onPress={() => router.back()}
      >
        Cerrar
      </Button>
    </YStack>
  );
}
