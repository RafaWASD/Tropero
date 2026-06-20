// app/maniobra/_components/CustomFieldActionsSheet.tsx — MENÚ DE ACCIONES (⋯) de un dato CUSTOM
// (spec 03 M7, R13.29). El kebab ⋯ de cada fila CUSTOM de "Editar plantilla del rodeo" (editar-plantilla.tsx)
// abre ESTE sheet. Dos acciones:
//   - EDITAR (R13.32) → el caller abre el CustomFieldSheet en modo 'edit' (solo label + opciones).
//   - ELIMINAR (R13.31) → el caller abre el diálogo de confirmación CON IMPACTO (ConfirmDeleteSheet).
//
// OWNER-ONLY (R13.29): el ⋯ solo se renderiza en filas custom y la pantalla ya está dentro del bloque
// owner-only → este sheet hereda esa puerta. Affordance EXPLÍCITA (no swipe/long-press).
//
// PATRÓN del sheet (idiom LOCKEADO de ExitJornadaSheet) + guard tap-through doble-rAF. RECORTE DE
// DESCENDENTES: lineHeight matching. Cero hardcode (ADR-023 §4): tokens. es-AR voseo.

import { useEffect, useRef } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Pencil, Trash2 } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y } from '@/utils/a11y';

export type CustomFieldActionsSheetProps = {
  /** Nombre (label) del dato custom (para el título del menú). */
  fieldLabel: string;
  /** Editar el dato (label + opciones, R13.32). */
  onEdit: () => void;
  /** Eliminar el dato (soft-delete con confirmación de impacto, R13.31). */
  onDelete: () => void;
  /** Cerrar el menú sin elegir nada. */
  onClose: () => void;
};

export function CustomFieldActionsSheet({
  fieldLabel,
  onEdit,
  onDelete,
  onClose,
}: CustomFieldActionsSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      readyToDismissRef.current = true;
    };
    if (typeof requestAnimationFrame === 'function') {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(arm);
      });
    } else {
      timer = setTimeout(arm, 0);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const onBackdropPress = () => {
    if (!readyToDismissRef.current) return;
    onClose();
  };

  return (
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="custom-field-actions-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="custom-field-actions-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Título: el label del dato. lineHeight matching. */}
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {fieldLabel}
        </Text>

        <YStack gap="$2">
          <ActionRow
            icon={<Pencil size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} />}
            label="Editar"
            hint="Cambiá el nombre o las opciones."
            onPress={onEdit}
            testID="custom-field-action-editar"
          />
          <ActionRow
            icon={<Trash2 size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$terracota', 'color')} />}
            label="Eliminar"
            tone="danger"
            onPress={onDelete}
            testID="custom-field-action-eliminar"
          />
          <Button variant="secondary" fullWidth onPress={onClose}>
            Cancelar
          </Button>
        </YStack>
      </YStack>
    </View>
  );
}

// Una fila de acción del menú: ícono + label (+ hint), target manga ≥$touchMin, tappable.
function ActionRow({
  icon,
  label,
  hint,
  tone = 'normal',
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  tone?: 'normal' | 'danger';
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} {...buttonA11y(Platform.OS, { label })}>
      <XStack
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        paddingHorizontal="$3"
        paddingVertical="$2"
        borderRadius="$card"
        borderWidth={1}
        borderColor={tone === 'danger' ? '$terracota' : '$divider'}
        backgroundColor="$surface"
        pressStyle={{ backgroundColor: '$greenLight' }}
      >
        <View width={28} alignItems="center" justifyContent="center">
          {icon}
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text
            fontFamily="$body"
            fontSize="$5"
            lineHeight="$5"
            fontWeight="700"
            color={tone === 'danger' ? '$terracota' : '$textPrimary'}
            numberOfLines={1}
          >
            {label}
          </Text>
          {hint ? (
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </YStack>
      </XStack>
    </Pressable>
  );
}
