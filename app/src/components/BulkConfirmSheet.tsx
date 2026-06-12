// BulkConfirmSheet — bottom-sheet de CONFIRMACIÓN de la operación masiva (spec 10, T-UI.5 / R11.8, R5.6).
//
// Aparece SOBRE la pantalla de selección al tocar el CTA (D9). Componente PRESENTACIONAL (no hace fetch
// ni navega — architecture.md): la pantalla resuelve el desglose (summarizeSelection) + la acción de
// revertir override (service C6) y le pasa el resumen + los callbacks. Muestra:
//   - desglose por categoría de lo seleccionado ("8 terneros · 3 toritos · 1 toro"),
//   - "⚠ N futuros toritos incluidos" si hay ⭐ tildados (solo castración),
//   - aviso de override + acción de revertir si algún seleccionado tiene category_override (R5.6),
//   - copy REVERSIBLE obligatorio ("Podés corregirlo después desde la ficha de cada animal"),
//   - botones CONFIRMAR / Volver.
//
// PROHIBIDO copy amenazante ("no se puede deshacer") — la castración es estado reversible (R11.8 / Gate 0
// v2). Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle, Pin } from 'lucide-react-native';

import { Button } from './Button';
import { Card } from './Card';
import { buttonA11y, labelA11y } from '../utils/a11y';
import type { SelectionSummary } from '../utils/bulk-selection';
import type { BulkOperation } from '../utils/bulk-candidates';

export type BulkConfirmSheetProps = {
  /** La operación que se va a confirmar (decide verbo y la lógica del aviso ⭐). */
  operation: BulkOperation;
  /** Desglose de la selección (total + byCategory + futureBullCount + overrideCount). */
  summary: SelectionSummary;
  /** Texto legible de una categoría code → label es-AR (ej. 'ternero' → "Terneros"). Lo provee la pantalla. */
  categoryLabel: (code: string, count: number) => string;
  /** CONFIRMAR: encola las N mutaciones (la pantalla llama al service). */
  onConfirm: () => void;
  /** Volver: cierra el sheet sin aplicar. */
  onCancel: () => void;
  /**
   * Revertir el override de los seleccionados con category_override (R5.6): la pantalla lo resuelve (C6).
   * Si no hay seleccionados con override, no se muestra la acción. `revertingOverride` deshabilita el botón
   * mientras corre.
   */
  onRevertOverrides?: () => void;
  /** Mientras se revierten los overrides (deshabilita la acción + muestra "Quitando…"). */
  revertingOverride?: boolean;
  /** Mientras se encola (deshabilita CONFIRMAR para no doble-disparar). */
  confirming?: boolean;
};

/** Verbo es-AR del CTA de confirmación según la operación. */
function confirmVerb(operation: BulkOperation): string {
  if (operation === 'castrate') return 'Castrar';
  if (operation === 'wean') return 'Destetar';
  return 'Aplicar';
}

export function BulkConfirmSheet({
  operation,
  summary,
  categoryLabel,
  onConfirm,
  onCancel,
  onRevertOverrides,
  revertingOverride = false,
  confirming = false,
}: BulkConfirmSheetProps) {
  const insetMuted = getTokenValue('$textMuted', 'color');
  const terracota = getTokenValue('$terracota', 'color');
  const primary = getTokenValue('$primary', 'color');

  const verb = confirmVerb(operation);
  const showFutureBullWarning = operation === 'castrate' && summary.futureBullCount > 0;
  const showOverride = summary.overrideCount > 0;

  return (
    // Backdrop semitransparente que cubre toda la pantalla + sheet anclado abajo. El backdrop cierra.
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      {/* Backdrop tappable (cierra el sheet). Cubre el área por encima del sheet. */}
      <Pressable style={{ flex: 1, width: '100%' }} onPress={onCancel} {...buttonA11y(Platform.OS, { label: 'Cerrar' })} />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom="$6"
        gap="$4"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
          {operation === 'castrate' ? 'Confirmar castración' : 'Confirmar destete'}
        </Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$3', 'space') }}>
          {/* Desglose por categoría de lo seleccionado. */}
          <Card gap="$2">
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
              Vas a {verb.toLocaleLowerCase('es-AR')} {summary.total}{' '}
              {summary.total === 1 ? 'animal' : 'animales'}:
            </Text>
            <YStack gap="$1">
              {summary.byCategory.map(({ categoryCode, count }) => (
                <XStack key={categoryCode} alignItems="center" gap="$2">
                  <View width={getTokenValue('$dot', 'size')} height={getTokenValue('$dot', 'size')} borderRadius="$pill" backgroundColor="$primary" />
                  <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
                    {categoryLabel(categoryCode, count)}
                  </Text>
                </XStack>
              ))}
            </YStack>
          </Card>

          {/* ⚠ Aviso de futuros toritos incluidos (solo castración, R11.8). */}
          {showFutureBullWarning ? (
            <XStack
              alignItems="center"
              gap="$2"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$terracota"
              borderRadius="$card"
              paddingHorizontal="$3"
              paddingVertical="$3"
              {...labelA11y(Platform.OS, `${summary.futureBullCount} futuros toritos incluidos`)}
            >
              <AlertTriangle size={20} color={terracota} strokeWidth={2.5} />
              <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$terracota" flex={1}>
                {summary.futureBullCount === 1
                  ? '1 futuro torito incluido'
                  : `${summary.futureBullCount} futuros toritos incluidos`}
              </Text>
            </XStack>
          ) : null}

          {/* Aviso de override + acción de revertir (R5.6). */}
          {showOverride ? (
            <YStack
              gap="$2"
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$divider"
              borderRadius="$card"
              paddingHorizontal="$3"
              paddingVertical="$3"
            >
              <XStack alignItems="center" gap="$2">
                <Pin size={18} color={insetMuted} strokeWidth={2.5} />
                <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" flex={1}>
                  {summary.overrideCount === 1
                    ? '1 animal tiene la categoría fijada manualmente y no va a cambiar de categoría.'
                    : `${summary.overrideCount} animales tienen la categoría fijada manualmente y no van a cambiar de categoría.`}
                </Text>
              </XStack>
              {onRevertOverrides ? (
                <Pressable
                  onPress={revertingOverride ? undefined : onRevertOverrides}
                  {...buttonA11y(Platform.OS, { label: 'Quitar la fijación de categoría', disabled: revertingOverride })}
                >
                  <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
                    {revertingOverride ? 'Quitando la fijación…' : 'Quitar la fijación para que cambien de categoría'}
                  </Text>
                </Pressable>
              ) : null}
            </YStack>
          ) : null}

          {/* Copy REVERSIBLE obligatorio (R11.8 / Gate 0 v2) — NUNCA "no se puede deshacer". */}
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            Podés corregirlo después desde la ficha de cada animal.
          </Text>
        </ScrollView>

        {/* Acciones: CONFIRMAR (primary) / Volver (secondary). */}
        <YStack gap="$2">
          <Button
            variant="primary"
            fullWidth
            disabled={confirming || summary.total === 0}
            onPress={onConfirm}
          >
            {confirming ? 'Generando…' : `${verb} ${summary.total} ${summary.total === 1 ? 'animal' : 'animales'}`}
          </Button>
          <Button variant="secondary" fullWidth disabled={confirming} onPress={onCancel}>
            Volver
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}
