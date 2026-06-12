// app/vacunacion-masiva.tsx — STUB navegable de la pantalla de VACUNACIÓN MASIVA (spec 10 T-UI.6,
// PRÓXIMO chunk de Fase 4).
//
// En este chunk (T-UI.1/2/3) la GroupActionsBar ya navega acá con los params del grupo, para dejar el
// flujo ENCADENADO y navegable (design-review). La pantalla REAL (pre-config + filtro + preview "N
// eventos sobre M animales" + skip-report + progreso) se construye en T-UI.6. Por ahora muestra el
// grupo elegido + un aviso "próximamente" + volver.
//
// Cero hardcode (ADR-023 §4): tokens + componentes. Voseo es-AR.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';

import { Card, InfoNote } from '@/components';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

export default function VacunacionMasivaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => backOr(router, '/(tabs)')} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Vacunación
          </Text>
        </XStack>
      </YStack>

      <YStack flex={1} width="100%" paddingHorizontal="$4" gap="$4">
        <Card gap="$2">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
            Vacunar el grupo
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            Vas a aplicar una vacunación a todo el grupo (con filtro opcional) y confirmar antes de
            aplicar.
          </Text>
        </Card>
        <InfoNote>
          La pantalla de vacunación masiva (pre-config, filtro, preview y progreso) se está terminando.
          Volvé en la próxima versión.
        </InfoNote>
      </YStack>
    </YStack>
  );
}
