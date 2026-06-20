// app/maniobra/_components/PresetActionsSheet.tsx — MENÚ DE ACCIONES (⋯) de una rutina (spec 03 M7, R2.6/R2.7).
//
// El kebab ⋯ de cada fila de "Tus rutinas" (maniobra.tsx) abre ESTE sheet. Dos acciones primarias:
//   - EDITAR → sub-menú: Renombrar (sheet de nombre, R2.7) o Reconfigurar maniobras (reabre el wizard en
//     modo edición de preset, R2.8). Una sola decisión por toque (manga).
//   - ELIMINAR → el caller abre el diálogo de confirmación (ConfirmDeleteSheet) → softDeletePreset (R2.9).
//
// CUALQUIER ROL OPERATIVO (R2.10): no se gatea por rol (la RPC 0057 + la policy maneuver_presets_update ya
// autorizan por has_role_in). El ⋯ es affordance EXPLÍCITA (no swipe/long-press, anti-manga).
//
// PATRÓN del sheet (idiom LOCKEADO de ExitJornadaSheet) + guard tap-through doble-rAF. RECORTE DE
// DESCENDENTES: lineHeight matching. Cero hardcode (ADR-023 §4): tokens. es-AR voseo.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Pencil, SlidersHorizontal, Trash2, Type } from 'lucide-react-native';

import { Button } from '@/components';
import { buttonA11y } from '@/utils/a11y';

export type PresetActionsSheetProps = {
  /** Nombre de la rutina (para el título del menú). */
  presetName: string;
  /** Renombrar la rutina (abre el sheet de nombre, R2.7). */
  onRename: () => void;
  /** Reconfigurar las maniobras (reabre el wizard en modo edición, R2.8). */
  onReconfigure: () => void;
  /** Eliminar la rutina (abre el diálogo de confirmación, R2.9). */
  onDelete: () => void;
  /** Cerrar el menú sin elegir nada (tap en el scrim / Cancelar). */
  onClose: () => void;
};

type Phase = 'menu' | 'edit';

export function PresetActionsSheet({
  presetName,
  onRename,
  onReconfigure,
  onDelete,
  onClose,
}: PresetActionsSheetProps) {
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

  // Fase: el menú principal (Editar/Eliminar) o el sub-menú de Editar (Renombrar/Reconfigurar).
  const [phase, setPhase] = useState<Phase>('menu');

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
        testID="preset-actions-scrim"
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
        testID="preset-actions-sheet"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Título: el nombre de la rutina (qué estás por accionar). lineHeight matching. */}
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {presetName}
        </Text>

        {phase === 'menu' ? (
          <YStack gap="$2">
            <ActionRow
              icon={<Pencil size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} />}
              label="Editar"
              onPress={() => setPhase('edit')}
              testID="preset-action-editar"
            />
            <ActionRow
              icon={<Trash2 size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$terracota', 'color')} />}
              label="Eliminar"
              tone="danger"
              onPress={onDelete}
              testID="preset-action-eliminar"
            />
            <Button variant="secondary" fullWidth onPress={onClose}>
              Cancelar
            </Button>
          </YStack>
        ) : (
          <YStack gap="$2">
            <ActionRow
              icon={<Type size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} />}
              label="Renombrar"
              hint="Cambiá el nombre de la rutina."
              onPress={onRename}
              testID="preset-action-renombrar"
            />
            <ActionRow
              icon={<SlidersHorizontal size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} />}
              label="Reconfigurar maniobras"
              hint="Cambiá qué maniobras tiene y en qué orden."
              onPress={onReconfigure}
              testID="preset-action-reconfigurar"
            />
            <Button variant="secondary" fullWidth onPress={() => setPhase('menu')}>
              Volver
            </Button>
          </YStack>
        )}
      </YStack>
    </View>
  );
}

// Una fila de acción del menú: ícono + label (+ hint opcional), target manga ≥$touchMin, tappable.
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
