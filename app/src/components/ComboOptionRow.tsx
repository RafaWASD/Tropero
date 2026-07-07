// ComboOptionRow — fila de opción de un combo / lista-expandible (elegir rodeo, elegir lote).
//
// POR QUÉ EXISTE (delta-fix UI, ADR-028 Nivel A): este patrón estaba DUPLICADO en pantallas casi
// idénticas (RodeoOptionRow de agregar-evento y de LinkCalfPrompt, GroupOption de crear-animal, y el
// LoteOption del sheet de lote de maniobra) y con él se repetía un bug de centrado. En esta app el
// <Text> CENTRA por defecto (config Tamagui): cuando una fila está seleccionada, el tilde ✓ + gap
// consumían ancho → el flex-box del Text se achicaba y su contenido centrado caía ~2-4px a la izquierda
// del centro real de la fila. Resultado: la opción seleccionada NO compartía eje con el resto (todas
// centradas menos la elegida).
//
// FIX: slots de ancho fijo SIMÉTRICOS. Un spacer vacío a la IZQUIERDA con el mismo ancho que el slot
// del tilde a la DERECHA. Con el Text flex={1} en el medio, el centrado cae en el centro VERDADERO de
// la fila esté o no seleccionada, y los nombres largos truncan de forma simétrica. Sin `gap` (el
// espaciado lo dan los slots) para que el ancho del label sea máximo. La selección se muestra SOLO con
// el tilde (nunca con borde/relleno/negrita) → todos los combos se ven igual.
//
// UNIFICACIÓN (delta): la misma fila sirve a combos INLINE de pantalla (`size="compact"`) y a combos en
// SHEET (`size="comfortable"`, manga/Fitts: fila más alta y tipografía más grande). El tilde y los slots
// simétricos son idénticos en ambas densidades.
//
// Cero hardcode (ADR-023 §4): tokens Tamagui; el color del ícono lucide cruza a API no-Tamagui vía
// getTokenValue. a11y por helper (utils/a11y). numberOfLines={1} CON lineHeight matcheado (regla dura
// de recorte de descendentes: nombres con g/j/p/y no se deben recortar).

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';

// Ancho del slot del tilde (y del spacer izquierdo simétrico). El ícono es 20px; el slot suma aire para
// igualar la huella previa (check 20 + gap $2 = 8 → 28) de modo que el alto/espaciado de la fila NO
// cambia respecto de antes. `SLOT` literal en px porque es una medida de layout local (no un color/token
// de diseño reutilizable): mantiene la simetría izquierda↔derecha explícita y auto-documentada. El check
// es size=20 en AMBAS densidades (mismo tilde en todos los combos = más unificado).
const CHECK = 20;
const SLOT = 28;

export type ComboOptionRowProps = {
  /** Texto de la opción (centrado sobre el eje REAL de la fila en ambos estados). */
  label: string;
  /** ¿Es la opción elegida? Se muestra SOLO con el tilde (no con borde/relleno/negrita). */
  selected: boolean;
  onPress: () => void;
  /** Nombre accesible del control (ej. `Rodeo <name>` / `Lote <name>`). */
  a11yLabel: string;
  /** testID en el control tappable (para e2e). Opcional. */
  testID?: string;
  /**
   * Densidad de la fila (default `compact`):
   * - `compact`: combos INLINE de pantalla — fontSize/lineHeight $4, alto $chipMin, padding $2/$2.
   * - `comfortable`: combos en SHEET (manga/Fitts) — fontSize/lineHeight $5, alto $touchMin, padding $4/$3.
   * El tilde (size 20) y los slots simétricos son iguales en ambas → look unificado.
   */
  size?: 'compact' | 'comfortable';
};

export function ComboOptionRow({
  label,
  selected,
  onPress,
  a11yLabel,
  testID,
  size = 'compact',
}: ComboOptionRowProps) {
  const comfortable = size === 'comfortable';
  return (
    <Pressable testID={testID} onPress={onPress} {...buttonA11y(Platform.OS, { label: a11yLabel, selected })}>
      <XStack
        alignItems="center"
        minHeight={comfortable ? '$touchMin' : '$chipMin'}
        paddingHorizontal={comfortable ? '$4' : '$2'}
        paddingVertical={comfortable ? '$3' : '$2'}
        pressStyle={{ opacity: 0.6 }}
      >
        {/* Spacer izquierdo = MISMO ancho que el slot del tilde → el label centrado cae en el eje real. */}
        <View width={SLOT} flexShrink={0} />
        <Text
          flex={1}
          minWidth={0}
          numberOfLines={1}
          fontFamily="$body"
          fontSize={comfortable ? '$5' : '$4'}
          lineHeight={comfortable ? '$5' : '$4'}
          fontWeight="500"
          color="$textPrimary"
        >
          {label}
        </Text>
        {/* Slot derecho: tilde cuando selected, vacío si no. Ancho fijo = spacer izquierdo. */}
        <View width={SLOT} alignItems="center" justifyContent="center" flexShrink={0}>
          {selected ? (
            <Check size={CHECK} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
          ) : null}
        </View>
      </XStack>
    </Pressable>
  );
}
