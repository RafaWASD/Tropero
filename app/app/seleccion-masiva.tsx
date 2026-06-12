// app/seleccion-masiva.tsx — STUB navegable de la pantalla de SELECCIÓN EXPLÍCITA (castrar/destetar)
// de la operación masiva (spec 10 T-UI.4, PRÓXIMO chunk de Fase 4).
//
// En este chunk (T-UI.1/2/3) la GroupActionsBar ya navega acá con los params del grupo + operación,
// para dejar el flujo ENCADENADO y navegable (para el design-review). La pantalla REAL (secciones por
// categoría + defaults + checkbox + CTA con número vivo + bottom-sheet) se construye en T-UI.4/T-UI.5.
// Por ahora muestra qué operación se eligió sobre qué grupo + un aviso "próximamente" + volver.
//
// Cero hardcode (ADR-023 §4): tokens + componentes. Voseo es-AR.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';

import { Card, InfoNote } from '@/components';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

export default function SeleccionMasivaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupType?: string; groupId?: string; op?: string }>();
  const op = params.op === 'wean' ? 'destete' : 'castración';
  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => backOr(router, '/(tabs)')} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Selección
          </Text>
        </XStack>
      </YStack>

      <YStack flex={1} width="100%" paddingHorizontal="$4" gap="$4">
        <Card gap="$2">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
            {op === 'destete' ? 'Destetar animales' : 'Castrar animales'}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            Vas a elegir qué animales {op === 'destete' ? 'destetar' : 'castrar'} del grupo.
          </Text>
        </Card>
        <InfoNote>
          La pantalla de selección (tildar animales, defaults y confirmación) se está terminando. Volvé
          en la próxima versión.
        </InfoNote>
      </YStack>
    </YStack>
  );
}
