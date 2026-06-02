// CategoryBadge — pill de categoría del animal (capa de identidad RAFAQ, spec 02/09 fix-loop C2).
//
// FIRMA VISUAL de RAFAQ: fondo $greenLight + texto $primary (verde botella), el MISMO lenguaje que
// la pill activa del bottom-nav (NavTabIcon: ícono $primary sobre $greenLight). Reusable a través de
// la ficha (hero), la fila de la lista (AnimalRow) y, a futuro, C3 (ficha completa) — base de la
// "capa de identidad" que pide el fix-loop. Da color y personalidad donde antes había una etiqueta
// neutra en gris (genérico).
//
// La etiqueta viene RESUELTA del catálogo (categories_by_system.name del server, ej. "Vaquillona",
// "Ternero"); el badge solo la presenta — no decide el texto. Si el animal tiene override manual de
// categoría, se marca con un punto/sufijo sutil (no rompe la firma de color).
//
// Cero hardcode (ADR-023 §4): tokens. `size` controla densidad (la fila de la lista usa 'sm', el
// hero de la ficha usa 'md').

import { Text, View, XStack } from 'tamagui';

export type CategoryBadgeProps = {
  /** Etiqueta de categoría ya resuelta (es-AR), ej. "Vaquillona". Si vacía → no se renderiza. */
  label: string;
  /** ¿La categoría fue fijada manualmente (override)? → punto sutil de marca. */
  manual?: boolean;
  /** Densidad: 'sm' para la fila de lista, 'md' para el hero de la ficha. Default 'sm'. */
  size?: 'sm' | 'md';
};

export function CategoryBadge({ label, manual = false, size = 'sm' }: CategoryBadgeProps) {
  const trimmed = label.trim();
  if (trimmed.length === 0) return null;

  const isMd = size === 'md';
  const a11yLabel = manual ? `Categoría ${trimmed}, fijada manualmente` : `Categoría ${trimmed}`;

  return (
    <View
      backgroundColor="$greenLight"
      borderRadius="$pill"
      paddingHorizontal={isMd ? '$3' : '$2'}
      paddingVertical="$1"
      alignSelf="flex-start"
      accessibilityLabel={a11yLabel}
    >
      <XStack alignItems="center" gap="$1">
        <Text
          fontFamily="$body"
          fontSize={isMd ? '$4' : '$2'}
          fontWeight="600"
          color="$primary"
          numberOfLines={1}
        >
          {trimmed}
        </Text>
        {/* Override manual: un punto $primary tras el texto (señal sutil, no rompe la firma). */}
        {manual ? (
          <View width={isMd ? 6 : 5} height={isMd ? 6 : 5} borderRadius="$pill" backgroundColor="$primary" />
        ) : null}
      </XStack>
    </View>
  );
}
