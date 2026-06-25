// ExportAnimalRow — fila de un animal en la lista de la pantalla de exportación SIGSA (spec 08, T15 /
// R12.1, R8.3).
//
// Dos modos (lo decide el caller con `reasons`):
//   - LISTO (reasons ausente/[]): el animal pasa la validación → TAG legible (hero) + glifo de sexo +
//     chevron (afford de "se abre la ficha"). Tap → ficha del animal (consultar/editar).
//   - A COMPLETAR (reasons con ≥1 motivo, R8.2): el animal NO se puede exportar todavía → TAG legible
//     (hero) + el/los motivos faltantes en TERRACOTA (señal de "ojo con este", mismo lenguaje del
//     AbortionFlag/FutureBullBadge: $surface + $terracota, sin token terracota-claro nuevo) + chevron.
//     Tap → ficha para completar el dato y reintentar (R8.3).
//
// Criticidad MIXTA (tarea de oficina, no manga-only, pero RAFAQ big-touch): target ≥ $touchMin, TAG
// grande que pop-ea (es el dato por el que el productor reconoce el animal), divider entre filas.
//
// Cero hardcode de color/spacing (ADR-023 §4): tokens; lo que cruza a la API no-Tamagui de lucide
// (color/size del ícono) se lee con getTokenValue. El TAG legible + los labels de motivos los arma la
// capa pura (sigsa-display.ts) — la fila NO formatea ni valida, solo presenta. es-AR voseo.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle, ChevronRight } from 'lucide-react-native';

import { formatRfidMasked, incompleteReasonLabels } from '../../utils/sigsa-display';
import { buttonA11y } from '../../utils/a11y';
import type { ExportValidationReason } from '../../services/sigsa/types';

export type AnimalSex = 'male' | 'female' | null;

export type ExportAnimalRowProps = {
  /** RFID crudo del animal (`animal_tag_electronic`). El hero de la fila (legible vía formatRfidMasked). */
  rfid: string | null;
  /** Sexo crudo (`animal_sex`): alimenta el glifo del avatar fallback (♀/♂). null → sin glifo. */
  sex?: AnimalSex;
  /**
   * Motivos por los que el animal está "a completar" (R8.2/R8.3). Ausente o [] → fila en modo LISTO.
   * Con ≥1 motivo → modo A COMPLETAR (los labels se muestran en terracota + el ícono de advertencia).
   */
  reasons?: ExportValidationReason[];
  /** Tap en la fila → abre la ficha del animal (consultar si listo, completar si "a completar", R8.3). */
  onPress?: () => void;
};

// Glifo de sexo (U+2640 ♀ / U+2642 ♂) — neutro, mismo criterio que AnimalRow (recognition > recall).
const SEX_GLYPH: Record<'male' | 'female', string> = { female: '♀', male: '♂' };

/** Avatar fallback: círculo $surface con el glifo de sexo centrado. Si no hay sexo → guion neutro. */
function SexAvatar({ sex }: { sex: AnimalSex }) {
  const size = getTokenValue('$icon', 'size'); // 48
  const glyph = sex === 'male' || sex === 'female' ? SEX_GLYPH[sex] : '—';
  return (
    <View
      width={size}
      height={size}
      borderRadius="$pill"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
    >
      <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="500" color="$textMuted">
        {glyph}
      </Text>
    </View>
  );
}

export function ExportAnimalRow({ rfid, sex = null, reasons, onPress }: ExportAnimalRowProps) {
  const chevronColor = getTokenValue('$textFaint', 'color');
  const chevronSize = getTokenValue('$navIcon', 'size'); // 24
  const terracota = getTokenValue('$terracota', 'color');

  const hero = formatRfidMasked(rfid);
  const motivos = reasons && reasons.length > 0 ? incompleteReasonLabels(reasons) : [];
  const isIncomplete = motivos.length > 0;

  // a11y: TAG + (a completar: los motivos) — un nombre accesible que describe el estado de la fila.
  const a11yLabel = isIncomplete
    ? `${hero}, a completar: ${motivos.join(', ')}`
    : `${hero}, listo para declarar`;

  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: a11yLabel })}>
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        gap="$3"
        paddingHorizontal="$4"
        paddingVertical="$2"
        backgroundColor="$white"
        borderBottomWidth={1}
        borderBottomColor="$divider"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <SexAvatar sex={sex} />

        {/* Centro (flex): TAG hero + (a completar) los motivos faltantes. minWidth=0 → trunca sin empujar. */}
        <YStack flex={1} minWidth={0} gap="$1">
          <Text
            fontFamily="$body"
            fontSize="$6"
            lineHeight="$6"
            fontWeight="700"
            color="$textPrimary"
            numberOfLines={1}
          >
            {hero}
          </Text>

          {isIncomplete ? (
            <XStack alignItems="flex-start" gap="$1" minWidth={0}>
              <View flexShrink={0} paddingTop="$1">
                <AlertTriangle size={14} color={terracota} strokeWidth={2.5} />
              </View>
              <Text
                flex={1}
                minWidth={0}
                fontFamily="$body"
                fontSize="$3"
                lineHeight="$3"
                fontWeight="500"
                color="$terracota"
                numberOfLines={2}
              >
                {motivos.join(' · ')}
              </Text>
            </XStack>
          ) : (
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
              Listo para declarar
            </Text>
          )}
        </YStack>

        <View flexShrink={0} alignItems="flex-end" justifyContent="center">
          <ChevronRight size={chevronSize} color={chevronColor} strokeWidth={2} />
        </View>
      </XStack>
    </Pressable>
  );
}
