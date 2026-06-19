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

import { Platform } from 'react-native';
import { Text, View, XStack } from 'tamagui';

import { labelA11y } from '../utils/a11y';
import { isCutCategory } from '../utils/cut-eligibility';

export type CategoryBadgeProps = {
  /** Etiqueta de categoría ya resuelta (es-AR), ej. "Vaquillona". Si vacía → no se renderiza. */
  label: string;
  /** ¿La categoría fue fijada manualmente (override)? → punto sutil de marca. */
  manual?: boolean;
  /** Densidad: 'sm' para la fila de lista, 'md' para el hero de la ficha. Default 'sm'. */
  size?: 'sm' | 'md';
  /**
   * code de la categoría (ej. 'cut', 'multipara') cuando el call-site lo tiene (hero de la ficha, AnimalRow)
   * — delta spec 02 (RCUT.6.2). Ruta PREFERIDA de detección CUT (`code === 'cut'`). Sin `code`, una categoría
   * llamada literalmente "CUT" igual cae amarilla por el fallback de `label` (valor fijo del catálogo 0015).
   */
  code?: string | null;
};

export function CategoryBadge({ label, manual = false, size = 'sm', code }: CategoryBadgeProps) {
  const trimmed = label.trim();
  if (trimmed.length === 0) return null;

  const isMd = size === 'md';
  // Delta spec 02 (RCUT.6.1/RCUT.6.2): la categoría CUT (descarte) se pinta AMARILLA (texto $cutText sobre
  // fondo $cutBg), distinta del verde del resto, para que el descarte se lea de un vistazo. Detección por
  // `code === 'cut'` (preferido) o fallback por `label === 'CUT'` (módulo puro). El a11yLabel NO cambia: la
  // categoría se sigue comunicando por texto (el color es señal ADICIONAL, no la única — RCUT.6.4).
  const isCut = isCutCategory({ code, label });
  const a11yLabel = manual ? `Categoría ${trimmed}, fijada manualmente` : `Categoría ${trimmed}`;

  return (
    <View
      backgroundColor={isCut ? '$cutBg' : '$greenLight'}
      borderRadius="$pill"
      paddingHorizontal={isMd ? '$3' : '$2'}
      paddingVertical="$1"
      alignSelf="flex-start"
      // `View` es un primitivo de Tamagui → NO mapea accessibilityLabel a aria-label en web (lo
      // filtraría crudo al DOM). labelA11y emite el atributo correcto por plataforma.
      {...labelA11y(Platform.OS, a11yLabel)}
    >
      <XStack alignItems="center" gap="$1">
        <Text
          fontFamily="$body"
          fontSize={isMd ? '$4' : '$2'}
          fontWeight="600"
          color={isCut ? '$cutText' : '$primary'}
          numberOfLines={1}
        >
          {trimmed}
        </Text>
        {/* Override manual: un punto tras el texto (señal sutil, no rompe la firma). Toma el color del texto
            (amber en CUT, verde en el resto) para mantener la coherencia de la variante. */}
        {manual ? (
          <View
            width={isMd ? 6 : 5}
            height={isMd ? 6 : 5}
            borderRadius="$pill"
            backgroundColor={isCut ? '$cutText' : '$primary'}
          />
        ) : null}
      </XStack>
    </View>
  );
}
