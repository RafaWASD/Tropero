// app/maniobra/_components/RodeoMismatchBanner.tsx — aviso NO-bloqueante de "rodeo de jornada mal
// elegido" (spec 03 M2.1-edge, R4.7 / prevención de error Nielsen #5).
//
// Cuando los primeros ~3 animales CONSECUTIVOS de la jornada son todos de un MISMO rodeo distinto al de
// la sesión (heurística pura `shouldWarnMisconfiguredRodeo`), es probable que el operario haya elegido
// mal el rodeo de la jornada. En vez de empujarlo a pasar los animales uno por uno (R4.4), le sugerimos
// CAMBIAR EL RODEO DE LA SESIÓN a ese rodeo de una sola vez.
//
// NO-BLOQUEANTE (regla del leader): es un BANNER anclado arriba (debajo del header de sesión), NO un sheet
// modal — la identificación sigue funcionando detrás. Dismissable (× / "Ahora no"). Confirmar → cambia el
// rodeo de la sesión (`setSessionRodeo`, R4.7).
//
// ROBUSTEZ DE NOMBRES LARGOS (fix-loop, bug visual real): en prod un rodeo puede llamarse "Rodeo de cría
// de reposición 2024". Antes los 2 botones iban lado a lado (`flex={1}` cada uno) y el nombre largo
// CLIPEABA en el botón "Cambiar a {rodeo}". Fix:
//   - los 2 botones se APILAN VERTICALMENTE (full-width) → cada uno tiene todo el ancho.
//   - el nombre del rodeo dentro del botón "Cambiar a {rodeo}" va con numberOfLines={1} + ellipsize
//     (el botón primario se arma inline para poder controlar el Text — el componente Button no expone
//     numberOfLines en su label).
//
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. es-AR.
// RECORTE DE DESCENDENTES (regla dura): copy + label con numberOfLines → lineHeight matching.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { TriangleAlert, X } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y } from '@/utils/a11y';

export type RodeoMismatchBannerProps = {
  /** Rodeo de la racha (al que se sugiere cambiar la jornada). */
  rodeoName: string;
  /** Cantidad de animales consecutivos vistos de ese rodeo (para el copy: "Los últimos N…"). */
  count: number;
  /** Confirmar → cambiar el rodeo de la sesión a `rodeoName` (R4.7). */
  onChangeRodeo: () => void;
  /** Descartar el aviso (no frena la fila; no vuelve a abrir para esta racha). */
  onDismiss: () => void;
};

export function RodeoMismatchBanner({ rodeoName, count, onChangeRodeo, onDismiss }: RodeoMismatchBannerProps) {
  const alertColor = getTokenValue('$terracota', 'color');
  const mutedColor = getTokenValue('$textMuted', 'color');
  const navIcon = getTokenValue('$navIcon', 'size');

  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$card"
      marginHorizontal="$3"
      marginTop="$2"
      padding="$3"
      gap="$3"
      testID="rodeo-mismatch-banner"
    >
      <XStack alignItems="flex-start" gap="$2">
        <View flexShrink={0} paddingTop="$1">
          <TriangleAlert size={navIcon} color={alertColor} strokeWidth={2.25} />
        </View>
        <YStack flex={1} gap="$1" minWidth={0}>
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$textPrimary" numberOfLines={2}>
            Los últimos {count} animales son de {rodeoName}
          </Text>
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={3}>
            ¿Querés cambiar la jornada a ese rodeo? Así no tenés que pasar los animales de a uno.
          </Text>
        </YStack>
        {/* Cerrar (×): descarta sin cambiar nada (no bloquea la fila). */}
        <Pressable onPress={onDismiss} hitSlop={8} {...buttonA11y(Platform.OS, { label: 'Cerrar aviso' })}>
          <View flexShrink={0}>
            <X size={navIcon} color={mutedColor} strokeWidth={2.25} />
          </View>
        </Pressable>
      </XStack>

      {/* Botones APILADOS (full-width) — robustos a nombres de rodeo largos (cada uno tiene todo el ancho;
          el nombre dentro del primario trunca con numberOfLines={1}). */}
      <YStack gap="$2">
        <View
          backgroundColor="$primary"
          borderRadius="$pill"
          minHeight="$touchMin"
          paddingHorizontal="$5"
          alignItems="center"
          justifyContent="center"
          pressStyle={{ backgroundColor: '$primaryPress' }}
          onPress={onChangeRodeo}
          {...buttonA11y(Platform.OS, { label: `Cambiar a ${rodeoName}` })}
        >
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$white" numberOfLines={1} ellipsizeMode="tail">
            Cambiar a {rodeoName}
          </Text>
        </View>
        <Button variant="secondary" fullWidth onPress={onDismiss}>
          Ahora no
        </Button>
      </YStack>
    </View>
  );
}
