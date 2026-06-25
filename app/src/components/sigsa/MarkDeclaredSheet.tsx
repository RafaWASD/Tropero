// app/src/components/sigsa/MarkDeclaredSheet.tsx — ACTION-SHEET de una fila "Listos" de la exportación SIGSA
// (spec 08, T19 / R10.2). Tap en un animal LISTO abre este sheet con 2 acciones + cancelar:
//   1. "Marcar como ya declarado por otro medio" — crea la fila en sigsa_declarations SIN archivo (el animal
//      sale de pendientes). COPY EXACTO (decisión 2, leader 2026-06-24): NO "Declarar" — el usuario NO debe
//      creer que esto sube algo a SENASA; solo apaga el recordatorio local. Pide un CONFIRM breve antes de
//      ejecutar ("No genera archivo; el animal sale de pendientes").
//   2. "Ver la ficha del animal" — navega a la ficha (consultar / completar).
//   + Cancelar.
//
// (Las filas de "A completar" NO usan este sheet — su tap va DIRECTO a la ficha para completar el dato, R8.3.)
//
// PATRÓN canónico de sheet (regla de la skill design-review, idéntico a LotePickerSheet): backdrop $scrim con
// GUARD anti tap-through web (doble-rAF) + sheet anclado abajo con grip → HEADER FIJO (título que no se recorta)
// + cuerpo (lista corta de acciones, sin scroll necesario pero estructurado igual) + FOOTER FIJO (Cancelar).
// Dos FASES: 'menu' (las 2 acciones) → 'confirm' (la confirmación breve del marcado). Reabrir el sheet vuelve
// a 'menu'.
//
// Cero hardcode (ADR-023 §4): tokens; íconos lucide vía getTokenValue. es-AR voseo.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { CheckCircle2, FileText } from 'lucide-react-native';

import { buttonA11y } from '../../utils/a11y';
import { formatRfidMasked } from '../../utils/sigsa-display';

export type MarkDeclaredSheetProps = {
  /** ¿El sheet está abierto? (montaje controlado por la pantalla). */
  open: boolean;
  /** Cerrar sin elegir (tap en el scrim o "Cancelar"). */
  onClose: () => void;
  /** RFID del animal de la fila tocada (para el TAG legible en el header). null defensivo. */
  rfid: string | null;
  /** Confirmar "marcar como ya declarado por otro medio" (R10.2). La pantalla llama markDeclared + cierra. */
  onConfirmMarkDeclared: () => void;
  /** "Ver la ficha del animal" → navega a la ficha. */
  onViewAnimal: () => void;
  /** true mientras la marca está en curso (deshabilita los botones para evitar doble-tap). */
  busy?: boolean;
};

export function MarkDeclaredSheet({
  open,
  onClose,
  rfid,
  onConfirmMarkDeclared,
  onViewAnimal,
  busy = false,
}: MarkDeclaredSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');

  const [phase, setPhase] = useState<'menu' | 'confirm'>('menu');

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico a LotePickerSheet (doble rAF). Re-armado cada vez que se abre.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    if (!open) {
      readyToDismissRef.current = false;
      return;
    }
    // Cada apertura arranca en el menú (no en una confirmación residual de una apertura anterior).
    setPhase('menu');
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
  }, [open]);

  if (!open) return null;

  const onBackdropPress = () => {
    if (!readyToDismissRef.current || busy) return;
    onClose();
  };

  const hero = formatRfidMasked(rfid);

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
        testID="mark-declared-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="mark-declared-sheet"
      >
        {/* ── HEADER FIJO (grip + título con el TAG). flexShrink:0. ── */}
        <YStack flexShrink={0} gap="$3">
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <YStack gap="$1">
            {/* Título $7 con lineHeight matcheado. */}
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {phase === 'confirm' ? 'Marcar como declarado' : hero}
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={3}>
              {phase === 'confirm'
                ? 'No genera ningún archivo: solo saca este animal de la lista de pendientes (declarado por otro medio).'
                : '¿Qué querés hacer con este animal?'}
            </Text>
          </YStack>
        </YStack>

        {/* ── CUERPO: acciones (fase menu) o la confirmación (fase confirm). ── */}
        {phase === 'menu' ? (
          <YStack flexShrink={0} gap="$2">
            {/* Acción 1: marcar como ya declarado por otro medio (COPY EXACTO, decisión 2). Pasa a confirm. */}
            <ActionItem
              testID="mark-declared-action-mark"
              icon={<CheckCircle2 size={getTokenValue('$navIcon', 'size')} color={primary} strokeWidth={2} />}
              label="Marcar como ya declarado por otro medio"
              onPress={() => setPhase('confirm')}
            />
            {/* Acción 2: ver la ficha del animal. */}
            <ActionItem
              testID="mark-declared-action-view"
              icon={<FileText size={getTokenValue('$navIcon', 'size')} color={muted} strokeWidth={2} />}
              label="Ver la ficha del animal"
              onPress={onViewAnimal}
            />
          </YStack>
        ) : (
          <YStack flexShrink={0} gap="$2">
            <Pressable
              disabled={busy}
              testID="mark-declared-confirm"
              onPress={onConfirmMarkDeclared}
              {...buttonA11y(Platform.OS, { label: 'Confirmar: marcar como ya declarado por otro medio', disabled: busy })}
            >
              <XStack
                width="100%"
                alignItems="center"
                justifyContent="center"
                minHeight="$touchMin"
                borderRadius="$pill"
                backgroundColor="$primary"
                paddingHorizontal="$5"
                opacity={busy ? 0.6 : 1}
                pressStyle={{ opacity: 0.85 }}
              >
                <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$white" numberOfLines={1}>
                  {busy ? 'Marcando…' : 'Sí, marcar como declarado'}
                </Text>
              </XStack>
            </Pressable>
            {/* Volver al menú (no cancela todo el sheet, solo deshace la elección de marcar). */}
            <View
              testID="mark-declared-back"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              pressStyle={{ opacity: 0.6 }}
              onPress={() => !busy && setPhase('menu')}
              {...buttonA11y(Platform.OS, { label: 'Volver' })}
            >
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
                Volver
              </Text>
            </View>
          </YStack>
        )}

        {/* ── FOOTER FIJO (Cancelar) — solo en el menú (en confirm, "Volver" cumple ese rol). ── */}
        {phase === 'menu' ? (
          <YStack flexShrink={0}>
            <View
              testID="mark-declared-cancelar"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              pressStyle={{ opacity: 0.6 }}
              onPress={onClose}
              {...buttonA11y(Platform.OS, { label: 'Cancelar' })}
            >
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
                Cancelar
              </Text>
            </View>
          </YStack>
        ) : null}
      </YStack>
    </View>
  );
}

/** Una acción del menú: ícono + label, target ≥$touchMin. El label de marcar puede ser largo → 2 líneas. */
function ActionItem({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <XStack
      testID={testID}
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
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label })}
    >
      <View flexShrink={0}>{icon}</View>
      <Text
        flex={1}
        minWidth={0}
        fontFamily="$body"
        fontSize="$5"
        lineHeight="$5"
        fontWeight="600"
        color="$textPrimary"
        numberOfLines={2}
      >
        {label}
      </Text>
    </XStack>
  );
}
