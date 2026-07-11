// app/lote/_components/BatchSaleAnimalRow.tsx — fila de UN animal en la baja EN TANDA por VENTA, con su
// override OPCIONAL de precio/peso (delta lotes-venta, RLV.6/RLV.6.1).
//
// La tanda carga datos COMUNES arriba (un precio/peso para todos); esta fila deja AJUSTAR un animal puntual
// (override que gana sobre el común, RLV.6). Colapsada por default (el caso normal NO ajusta, campo-friendly):
// header con el identificador hero + una afordancia "Ajustar". Expandida: dos FormField (precio + peso) que
// reusan los sanitizadores (`sanitizePriceInput`/`sanitizeWeightInput`) y validan con las MISMAS reglas de la
// baja per-animal (`validateExitPrice`/`validateExitWeight`, RLV.6.1) — el error inline lo pinta FormField.
//
// El placeholder de cada campo HINTA el valor común ("Común: $X" / "Común: X kg") para que el operario sepa
// qué se aplica si no ajusta. RECORTE DE DESCENDENTES (regla dura): el hero es texto libre (idv/apodo con
// g/p/q/y/j) → lineHeight matcheado. Cero hardcode (ADR-023 §4): tokens; lucide con getTokenValue. es-AR.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { FormField } from '@/components';
import { buttonA11y } from '@/utils/a11y';

export type BatchSaleAnimalRowProps = {
  /** Identificador hero del animal (idv → apodo → caravana → "Animal"). */
  hero: string;
  /** ¿Está expandida la fila (mostrando los campos de override)? */
  expanded: boolean;
  /** Toggle de expandir/colapsar. */
  onToggleExpand: () => void;
  /** Precio de override (raw, sanitizado por el caller). */
  priceRaw: string;
  onPrice: (t: string) => void;
  priceErr: string | null;
  /** Peso de override (raw, sanitizado por el caller). */
  weightRaw: string;
  onWeight: (t: string) => void;
  weightErr: string | null;
  /** Hints del valor común (para el placeholder de cada campo). null → sin hint. */
  commonPriceHint?: string | null;
  commonWeightHint?: string | null;
  /** testID base (ej. `batch-row-<profileId>`) para el e2e. */
  testID?: string;
};

export function BatchSaleAnimalRow({
  hero,
  expanded,
  onToggleExpand,
  priceRaw,
  onPrice,
  priceErr,
  weightRaw,
  onWeight,
  weightErr,
  commonPriceHint,
  commonWeightHint,
  testID,
}: BatchSaleAnimalRowProps) {
  const faint = getTokenValue('$textFaint', 'color');
  const chevronSize = getTokenValue('$navIcon', 'size');
  // Si hay un override cargado, lo señalamos en el header colapsado (así se ve sin expandir).
  const hasOverride = priceRaw.trim().length > 0 || weightRaw.trim().length > 0;

  return (
    <YStack
      width="100%"
      borderWidth={1}
      borderColor={hasOverride ? '$primary' : '$divider'}
      borderRadius="$card"
      backgroundColor="$white"
      overflow="hidden"
      testID={testID}
    >
      <Pressable onPress={onToggleExpand} {...buttonA11y(Platform.OS, { label: `Ajustar ${hero}` })}>
        <XStack alignItems="center" gap="$3" minHeight="$touchMin" paddingHorizontal="$4" paddingVertical="$2" pressStyle={{ backgroundColor: '$surface' }}>
          <YStack flex={1} minWidth={0} gap="$1">
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {hero}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color={hasOverride ? '$primary' : '$textMuted'} numberOfLines={1}>
              {hasOverride ? 'Precio/peso propio' : 'Ajustar precio/peso'}
            </Text>
          </YStack>
          {expanded ? (
            <ChevronDown size={chevronSize} color={faint} strokeWidth={2} />
          ) : (
            <ChevronRight size={chevronSize} color={faint} strokeWidth={2} />
          )}
        </XStack>
      </Pressable>

      {expanded ? (
        <YStack paddingHorizontal="$4" paddingBottom="$4" paddingTop="$1" gap="$3">
          <FormField
            label="Precio de este animal en $ (opcional)"
            value={priceRaw}
            onChangeText={onPrice}
            keyboardType="decimal-pad"
            placeholder={commonPriceHint ? `Común: ${commonPriceHint}` : 'Ej. 250000'}
            error={priceErr}
            testID={testID ? `${testID}-price` : undefined}
          />
          <FormField
            label="Peso de este animal en kg (opcional)"
            value={weightRaw}
            onChangeText={onWeight}
            keyboardType="decimal-pad"
            placeholder={commonWeightHint ? `Común: ${commonWeightHint}` : 'Ej. 380'}
            error={weightErr}
            testID={testID ? `${testID}-weight` : undefined}
          />
        </YStack>
      ) : null}
    </YStack>
  );
}
