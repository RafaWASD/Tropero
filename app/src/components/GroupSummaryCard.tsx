// GroupSummaryCard — card de un GRUPO (rodeo o lote) en Inicio rodeo-céntrico (spec 10, T-UI.2 / R2.1,
// R2.2). Tappable → vista de grupo (R2.2). Componente PRESENTACIONAL (sin fetch): la home le pasa nombre
// + cabezas + un onPress.
//
// Anatomía (mismo lenguaje que MotherCard / las CTA icono+texto de la ficha): ícono del tipo en halo
// $greenLight, nombre hero + subtítulo de cabezas, chevron de afford. Target ≥$touchMin (manga-friendly,
// Fitts). Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. a11y por helper.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { ChevronRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { buttonA11y } from '../utils/a11y';

export type GroupSummaryCardProps = {
  /**
   * Ícono lucide del tipo. CONVENCIÓN CANÓNICA del repo: `Boxes` (cubos) para rodeo,
   * `Layers` (pila) para lote. Aplica en TODA la app (Inicio, "Más", ficha del animal,
   * vistas de grupo). No invertir.
   */
  icon: LucideIcon;
  /** Nombre del grupo. */
  name: string;
  /** Cabezas activas del grupo. */
  headCount: number;
  /** Subtítulo opcional adicional (ej. el sistema "Cría" del rodeo). Va antes de las cabezas. */
  meta?: string;
  /** Tap → vista de grupo (R2.2). */
  onPress: () => void;
};

export function GroupSummaryCard({ icon: Icon, name, headCount, meta, onPress }: GroupSummaryCardProps) {
  const primary = getTokenValue('$primary', 'color');
  const faint = getTokenValue('$textFaint', 'color');
  const headLabel = `${headCount} ${headCount === 1 ? 'cabeza' : 'cabezas'}`;
  const subtitle = meta ? `${meta} · ${headLabel}` : headLabel;

  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `${name}, ${subtitle}` })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor="$divider"
        backgroundColor="$white"
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon size={22} color={primary} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary" numberOfLines={1} minWidth={0}>
            {name}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        </YStack>
        <View flexShrink={0}>
          <ChevronRight size={22} color={faint} strokeWidth={2} />
        </View>
      </XStack>
    </Pressable>
  );
}
