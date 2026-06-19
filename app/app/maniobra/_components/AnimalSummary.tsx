// app/maniobra/_components/AnimalSummary.tsx — RESUMEN por animal (spec 03 M2.2, R5.9/R5.10).
//
// Pantalla de VERIFICACIÓN (momento más calmo, no es carga rápida) pero consistente con el DS y
// manga-friendly: lista las maniobras cargadas del animal con su valor; TOCAR una fila vuelve a su paso
// para CORREGIR antes de confirmar (R5.9). El CTA "Confirmar y siguiente" avanza al próximo animal +
// incrementa el contador de progreso (R5.10) — el frame lo cablea.
//
// NO usa los botones gigantes de la carga rápida (esta pantalla es de revisión, no de manga a velocidad,
// mismo criterio que la etapa 3 del wizard, design §6.bis.1). Filas tappables de alto cómodo (≥touchMin).
//
// Recorte de descendentes (memoria): el heading "Revisá" y las labels (con numberOfLines) llevan
// lineHeight matching. Cero hardcode (ADR-023 §4): tokens.

import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ArrowRight, Check, ChevronRight } from 'lucide-react-native';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import type { SummaryRow } from '@/utils/maneuver-sequence';
import type { CategoryTransitionPreview } from '@/utils/maneuver-category-preview';

export type AnimalSummaryProps = {
  /** Filas del resumen (maniobra + valor legible), en orden de la secuencia. */
  rows: SummaryRow[];
  /** Tocar una fila → volver a su paso para corregir (R5.9). El frame navega a ese índice. */
  onEdit: (index: number) => void;
  /** Confirmar → avanzar al siguiente animal + contador++ (R5.10). */
  onConfirm: () => void;
  /**
   * Preview de la transición de categoría que el server aplicará al sincronizar (R8.4). Display-only:
   * cuando NO es null, se muestra un banner destacado ("Categoría: <de> → <a>") ARRIBA de la lista. null
   * (override / macho / sin cambio / sin catálogo) → no se muestra nada.
   */
  preview?: CategoryTransitionPreview | null;
};

export function AnimalSummary({ rows, onEdit, onConfirm, preview }: AnimalSummaryProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));
  const chevron = getTokenValue('$navIcon', 'size');
  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} backgroundColor="$bg">
      <YStack paddingHorizontal="$4" paddingTop="$4" paddingBottom="$2" gap="$1">
        <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          Revisá la carga
        </Text>
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={2}>
          Tocá una maniobra para corregirla antes de pasar al siguiente animal.
        </Text>
      </YStack>

      <ScrollView flex={1} contentContainerStyle={{ paddingHorizontal: getTokenValue('$4', 'size'), paddingBottom: getTokenValue('$3', 'size') }}>
        {preview ? <CategoryPreviewBanner preview={preview} /> : null}
        {rows.length === 0 ? (
          <YStack paddingVertical="$6" alignItems="center">
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
              No hay maniobras para este animal en este rodeo.
            </Text>
          </YStack>
        ) : (
          <YStack gap="$2" paddingTop="$2">
            {rows.map((row, i) => (
              <XStack
                key={row.maneuver}
                testID={`summary-row-${row.maneuver}`}
                minHeight="$touchMin"
                alignItems="center"
                gap="$3"
                backgroundColor="$surface"
                borderWidth={1}
                borderColor="$divider"
                borderRadius="$card"
                paddingHorizontal="$4"
                paddingVertical="$3"
                pressStyle={{ backgroundColor: '$greenLight' }}
                onPress={() => onEdit(i)}
                {...buttonA11y(Platform.OS, { label: `Corregir ${row.label}: ${row.value}` })}
              >
                <YStack flex={1} minWidth={0} gap="$1">
                  <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                    {row.label}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize="$4"
                    lineHeight="$4"
                    fontWeight="600"
                    color={row.captured ? '$primary' : '$textFaint'}
                    numberOfLines={1}
                  >
                    {row.value}
                  </Text>
                </YStack>
                <ChevronRight size={chevron} color={muted} strokeWidth={2} />
              </XStack>
            ))}
          </YStack>
        )}
      </ScrollView>

      {/* CTA "✓ Confirmar y siguiente" full-width (zona del pulgar). */}
      <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom={bottomPad}>
        <View
          testID="confirm-animal"
          backgroundColor="$primary"
          borderRadius="$pill"
          minHeight="$touchMin"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          pressStyle={{ backgroundColor: '$primaryPress' }}
          onPress={onConfirm}
          {...buttonA11y(Platform.OS, { label: 'Confirmar y pasar al siguiente animal' })}
        >
          <Check size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={3} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
            Confirmar y siguiente
          </Text>
        </View>
      </YStack>
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BANNER de PREVIEW de TRANSICIÓN DE CATEGORÍA (R8.4) — el operario VE el cambio que el server aplicará
// al sincronizar, ANTES de subir (display-only; el server es la verdad). Es un BLOQUE destacado (NO una
// fila tappable): "Categoría: <de> → <a>" + "Se actualiza al sincronizar." Acento $primary/$greenLight
// (es una buena noticia, no error). Tokens, cero hardcode (ADR-023 §4). Recorte de descendentes: ambos
// Text con heading o numberOfLines llevan lineHeight matching ("preñada" lleva ñ/p/q descendentes).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function CategoryPreviewBanner({ preview }: { preview: CategoryTransitionPreview }) {
  const arrow = getTokenValue('$navIcon', 'size');
  const primary = getTokenValue('$primary', 'color');
  return (
    <YStack
      testID="summary-category-preview"
      marginTop="$2"
      backgroundColor="$greenLight"
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$1"
      {...labelA11y(Platform.OS, `Categoría: ${preview.fromName} pasa a ${preview.toName}. Se actualiza al sincronizar.`)}
    >
      <XStack alignItems="center" flexWrap="wrap" gap="$2">
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$primary" numberOfLines={2}>
          Categoría: {preview.fromName}
        </Text>
        <ArrowRight size={arrow} color={primary} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$primary" numberOfLines={2}>
          {preview.toName}
        </Text>
      </XStack>
      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$primary" numberOfLines={2}>
        Se actualiza al sincronizar.
      </Text>
    </YStack>
  );
}
