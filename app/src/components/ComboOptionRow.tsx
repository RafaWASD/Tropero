// ComboOptionRow — fila de opción de un combo / lista-expandible (elegir rodeo, elegir lote).
//
// POR QUÉ EXISTE (delta-fix UI, ADR-028 Nivel A): este patrón estaba DUPLICADO en 3 pantallas casi
// idénticas (RodeoOptionRow de agregar-evento y de LinkCalfPrompt, GroupOption de crear-animal) y con
// él se repetía un bug de centrado. En esta app el <Text> CENTRA por defecto (config Tamagui): cuando
// una fila está seleccionada, el tilde ✓ + gap consumían ancho → el flex-box del Text se achicaba y su
// contenido centrado caía ~2-4px a la izquierda del centro real de la fila. Resultado: la opción
// seleccionada NO compartía eje con el resto (todas centradas menos la elegida).
//
// FIX: slots de ancho fijo SIMÉTRICOS. Un spacer vacío a la IZQUIERDA con el mismo ancho que el slot
// del tilde a la DERECHA. Con el Text flex={1} en el medio, el centrado cae en el centro VERDADERO de
// la fila esté o no seleccionada, y los nombres largos truncan de forma simétrica. Sin `gap` (el
// espaciado lo dan los slots) para que el ancho del label sea máximo.
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
// de diseño reutilizable): mantiene la simetría izquierda↔derecha explícita y auto-documentada.
const CHECK = 20;
const SLOT = 28;

export type ComboOptionRowProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  a11yLabel: string;
};

export function ComboOptionRow({ label, selected, onPress, a11yLabel }: ComboOptionRowProps) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: a11yLabel, selected })}>
      <XStack
        alignItems="center"
        minHeight="$chipMin"
        paddingHorizontal="$2"
        paddingVertical="$2"
        pressStyle={{ opacity: 0.6 }}
      >
        {/* Spacer izquierdo = MISMO ancho que el slot del tilde → el label centrado cae en el eje real. */}
        <View width={SLOT} flexShrink={0} />
        <Text
          flex={1}
          minWidth={0}
          numberOfLines={1}
          fontFamily="$body"
          fontSize="$4"
          lineHeight="$4"
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
