// AlertList — lista accionable de una alerta (spec 07 Stream C, R7.10/R7.11). Cada ítem identifica al
// animal + el dato relevante (producto/fecha vencida · categoría/días sin pesar) para que sea accionable.
// El empty state positivo ("no hay dosis vencidas") lo decide la pantalla con `ReportEmpty tone=positive`.
//
// Cero hardcode (ADR-023 §4): tokens. Sin fetch (architecture.md). Cada fila es tappable (onPress) para
// navegar a la ficha del animal (la pantalla provee el handler).

import { Platform, Pressable } from 'react-native';
import { Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { ChevronRight, AlertTriangle, Scale } from 'lucide-react-native';

import { buttonA11y } from '../../utils/a11y';

export type AlertItem = {
  /** Clave estable (animal_profile_id + discriminador si un animal aparece dos veces). */
  key: string;
  /** Identificador visible del animal (IDV / visual_id_alt resuelto). */
  animal: string;
  /** Línea principal del dato accionable (ej. "Aftosa" / "Vaquillona"). */
  primary: string;
  /** Línea secundaria (ej. "venció hace 20 días" / "hace 200 días"). */
  secondary: string;
  /** Handler de tap (→ ficha del animal). Opcional. */
  onPress?: () => void;
};

export function AlertList({
  items,
  icon = 'dose',
}: {
  items: AlertItem[];
  /** Ícono de la alerta: 'dose' (dosis vencida) o 'weight' (sin pesar). */
  icon?: 'dose' | 'weight';
}) {
  return (
    <YStack
      backgroundColor="$surface"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      overflow="hidden"
    >
      {items.map((item, i) => (
        <YStack key={item.key}>
          {i > 0 ? <View height={1} backgroundColor="$divider" marginHorizontal="$4" /> : null}
          <AlertRow item={item} icon={icon} />
        </YStack>
      ))}
    </YStack>
  );
}

function AlertRow({ item, icon }: { item: AlertItem; icon: 'dose' | 'weight' }) {
  const muted = getTokenValue('$textMuted', 'color');
  const terracota = getTokenValue('$terracota', 'color');
  const tappable = item.onPress !== undefined;

  const row = (
    <XStack
      alignItems="center"
      gap="$3"
      paddingHorizontal="$4"
      minHeight="$animalRow"
      pressStyle={tappable ? { backgroundColor: '$bg' } : undefined}
    >
      <View
        width={40}
        height={40}
        borderRadius="$pill"
        backgroundColor="$bg"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        {icon === 'dose' ? (
          <AlertTriangle size={20} color={terracota} strokeWidth={2} />
        ) : (
          <Scale size={20} color={muted} strokeWidth={2} />
        )}
      </View>
      <YStack flex={1} minWidth={0} gap="$1">
        <XStack alignItems="baseline" gap="$2">
          <Text
            flexShrink={1}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$4"
            fontWeight="700"
            color="$textPrimary"
          >
            {item.animal}
          </Text>
          <Text
            flex={1}
            minWidth={0}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$3"
            fontWeight="500"
            color="$textMuted"
          >
            {item.primary}
          </Text>
        </XStack>
        <Text numberOfLines={1} fontFamily="$body" fontSize="$2" color="$textMuted">
          {item.secondary}
        </Text>
      </YStack>
      {tappable ? (
        <View flexShrink={0}>
          <ChevronRight size={20} color={muted} strokeWidth={2} />
        </View>
      ) : null}
    </XStack>
  );

  if (!item.onPress) return row;
  return (
    <Pressable
      onPress={item.onPress}
      {...buttonA11y(Platform.OS, { label: `${item.animal}: ${item.primary}, ${item.secondary}` })}
    >
      {row}
    </Pressable>
  );
}
