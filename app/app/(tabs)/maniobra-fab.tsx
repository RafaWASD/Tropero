// app/(tabs)/maniobra-fab.tsx — ruta placeholder del FAB central (ADR-018).
//
// El FAB de la barra NO selecciona esta tab: su tabBarButton custom navega a
// /maniobra (modal). Este archivo existe solo para que Expo Router tenga una
// ruta válida bajo el nombre "maniobra-fab" referenciado en (tabs)/_layout.tsx.
// En la práctica nunca se renderiza (el botón intercepta el press).
import { Text, YStack } from 'tamagui';

export default function ManiobraFabPlaceholder() {
  return (
    <YStack flex={1} backgroundColor="$bg" alignItems="center" justifyContent="center">
      <Text color="$textMuted">…</Text>
    </YStack>
  );
}
