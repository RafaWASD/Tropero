// StickDeviceRow — fila de un device descubierto en la pantalla de conexión (delta multivendor,
// RMV3.7/3.8). Reconocido-conectable / reconocido-no-disponible / reconocido-no-alcanzable / no
// reconocido: el estado lo calcula `deviceRowView` (puro) y esta fila SOLO lo renderiza.
//
// Tap NATIVO (crítico, memoria RN new-arch): `onPress` + a11y van en la MISMA pieza Tamagui con
// `pressStyle` — NO se envuelve en un `<Pressable>` de RN (roba el responder en nativo → onPress no
// dispara). Solo la fila 'recognized-available' es accionable (RMV3.7); las demás son informativas y
// apuntan a la carga manual (nunca bloquean, RMV3.6).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para los íconos lucide. es-AR.

import { Platform } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { ChevronRight, TriangleAlert } from 'lucide-react-native';

import { StickIcon } from '@/theme/icons';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import type { DeviceRowView, ViewTone } from '../connection-view';

/** Mapea el tono de la vista al token de color del ícono/borde. */
function toneColorToken(tone: ViewTone): '$primary' | '$terracota' | '$textMuted' {
  switch (tone) {
    case 'success':
      return '$primary';
    case 'warning':
      return '$terracota';
    case 'progress':
    case 'idle':
    default:
      return '$textMuted';
  }
}

export type StickDeviceRowProps = {
  view: DeviceRowView;
  /** Solo se llama cuando la fila es accionable (recognized-available). */
  onPress?: () => void;
};

export function StickDeviceRow({ view, onPress }: StickDeviceRowProps) {
  const colorToken = toneColorToken(view.tone);
  const iconColor = getTokenValue(colorToken, 'color');
  const actionable = view.actionable && onPress != null;

  // Tap NATIVO en la MISMA pieza Tamagui (sin <Pressable> envolvente). Solo accionable → onPress +
  // pressStyle + role button; informativa → solo `labelA11y` (nombre accesible, sin rol de control).
  const interaction = actionable
    ? { onPress, pressStyle: { backgroundColor: '$surface' as const }, ...buttonA11y(Platform.OS, { label: `${view.title}. ${view.subtitle}` }) }
    : { ...labelA11y(Platform.OS, `${view.title}. ${view.subtitle}`) };

  return (
    <XStack
      testID="stick-device-row"
      width="100%"
      alignItems="center"
      gap="$3"
      minHeight="$touchMin"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$card"
      backgroundColor="$surface"
      paddingHorizontal="$4"
      paddingVertical="$3"
      {...interaction}
    >
      <View flexShrink={0} alignItems="center" justifyContent="center">
        {view.state === 'unrecognized' || view.state === 'unrecognized-connectable' ? (
          <TriangleAlert size={getTokenValue('$navIcon', 'size')} color={iconColor} strokeWidth={2.25} />
        ) : (
          <StickIcon size={getTokenValue('$navIcon', 'size')} color={iconColor} strokeWidth={2.25} />
        )}
      </View>

      <YStack flex={1} minWidth={0} gap="$1">
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="600"
          color="$textPrimary"
          numberOfLines={1}
        >
          {view.title}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$3"
          lineHeight="$3"
          fontWeight="400"
          color="$textMuted"
          numberOfLines={2}
        >
          {view.subtitle}
        </Text>
      </YStack>

      {actionable ? (
        <View flexShrink={0}>
          <ChevronRight size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.25} />
        </View>
      ) : null}
    </XStack>
  );
}
