// app/maniobra/_components/LotePickerSheet.tsx — BOTTOM SHEET para elegir/cambiar/quitar el LOTE de un
// animal desde el wizard de maniobra (spec 03 R9.2). El lote = management_group (ADR-020): tercer eje del
// animal, PER-ANIMAL y MANUAL — nunca auto-asignado por la sesión (R9.1). Este sheet es la ÚNICA acción de
// asignación de lote del wizard.
//
// Lista (helper PURO lotePickerOptions): PRIMERO "Sin lote" (selecciona null → quita el lote, R9.3), luego
// los grupos activos del campo. Tap en una opción = selecciona + cierra (onSelect → el frame persiste vía
// assignAnimalToGroup; onClose). Espeja el GroupOption del alta (crear-animal.tsx) pero AISLADO (no se
// importa de ahí, restricción de terminal paralela): fila tappable con el nombre + check si seleccionada.
//
// PATRÓN canónico de sheet (regla de la skill design-review): backdrop $scrim tappable (con guard anti
// tap-through web, reference_rn_web_pitfalls) + sheet anclado abajo con grip + maxHeight → HEADER FIJO
// (flexShrink:0, título "Elegir lote" que NUNCA se recorta al crecer la lista) + BODY SCROLLEABLE
// (ScrollView flex:1, la lista de lotes puede crecer → scrollea adentro, no tapa el título).
//
// Empty-state: campo sin grupos (`groups.length === 0`) → solo "Sin lote" + un hint atenuado (creá lotes
// desde la sección Lotes). NO crashea.
//
// RECORTE DE DESCENDENTES (memoria): los nombres de lote son TEXTO LIBRE del usuario (pueden tener g/p/q/y/j
// — ej. "Engorde primavera") → todo Text con numberOfLines lleva lineHeight matching. Cero hardcode
// (ADR-023 §4): tokens; lo que cruza a APIs no-Tamagui (lucide) vía getTokenValue. es-AR voseo.

import { useEffect, useRef } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';
import { lotePickerOptions } from '@/utils/lote-picker';
import type { ManagementGroup } from '@/services/management-groups';

export type LotePickerSheetProps = {
  /** ¿El sheet está abierto? (montaje controlado por el frame). */
  open: boolean;
  /** Cerrar sin elegir (tap en el scrim o "Cancelar"). */
  onClose: () => void;
  /** Lotes activos del campo (offline, fetchManagementGroups). Puede estar vacío. */
  groups: ManagementGroup[];
  /** El lote ACTUAL del animal (`management_group_id`), o null si no tiene lote. */
  selectedId: string | null;
  /** Elegir un lote (groupId) o "Sin lote" (null → quita el lote). El frame persiste + cierra. */
  onSelect: (groupId: string | null) => void;
};

export function LotePickerSheet({ open, onClose, groups, selectedId, onSelect }: LotePickerSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil) ──
  // Idéntico a ManeuverConfigSheet/NuevaJornadaConfirmSheet: el tap que abre este sheet (la afordancia
  // "Lote" del resumen) deja, en web táctil, un `click` emulado (touch→mouse) ~20ms después que cae sobre
  // el scrim recién montado → lo cerraría a ~1ms. El scrim ignora presses hasta estar "listo para
  // descartar" (armado en el PRÓXIMO frame vía doble rAF). Para entonces el click huérfano ya pasó, pero
  // un tap DELIBERADO posterior SÍ cierra. Ref (no estado): el scrim lo lee sin re-render. Se RE-ARMA cada
  // vez que se abre (open en deps) — un sheet reabierto necesita el guard fresco.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    if (!open) {
      readyToDismissRef.current = false;
      return;
    }
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
    if (!readyToDismissRef.current) return;
    onClose();
  };

  // Opciones en su orden canónico (helper PURO): "Sin lote" primero + los grupos, con su `selected`.
  const options = lotePickerOptions(groups, selectedId);
  const hasGroups = groups.length > 0;

  return (
    // Backdrop $scrim que cubre la pantalla + sheet anclado abajo. El backdrop cierra (= cancelar).
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
        testID="lote-sheet-scrim"
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
        testID="lote-sheet"
      >
        {/* ── HEADER FIJO (grip + título). flexShrink:0 → el título nunca se recorta al crecer la lista. ── */}
        <YStack flexShrink={0} gap="$3">
          {/* Grip visual del sheet. */}
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <YStack gap="$1">
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              Elegir lote
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={2}>
              Asignar este animal a un lote es opcional.
            </Text>
          </YStack>
        </YStack>

        {/* ── CUERPO scrolleable (flex:1 + minHeight:0 web) → la lista crece adentro, no tapa el título. ── */}
        <ScrollView flex={1} style={{ minHeight: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$2', 'space') }}>
          {options.map((opt) => (
            <LoteOption
              key={opt.id ?? 'none'}
              testID={opt.id === null ? 'lote-option-none' : `lote-option-${opt.id}`}
              name={opt.name}
              selected={opt.selected}
              onPress={() => onSelect(opt.id)}
            />
          ))}

          {/* Empty-state: el campo todavía no tiene lotes → hint atenuado bajo "Sin lote". No crashea. */}
          {!hasGroups ? (
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textFaint" numberOfLines={3} paddingHorizontal="$2" paddingTop="$1">
              Este campo todavía no tiene lotes. Creá lotes desde la sección Lotes.
            </Text>
          ) : null}
        </ScrollView>

        {/* ── FOOTER FIJO (Cancelar). flexShrink:0 → siempre abajo. Tap en una opción ya cierra; este es la
              salida sin elegir (espejo del scrim, accesible sin apuntar al borde). ── */}
        <YStack flexShrink={0}>
          <View
            testID="lote-sheet-cancelar"
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
      </YStack>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// OPCIÓN de lote — fila tappable (espeja el GroupOption del alta, pero AISLADA). Nombre + check si
// seleccionada. Alto ≥$touchMin (manga, Fitts). El nombre = texto libre con posibles descendentes →
// lineHeight matching (regla dura de recorte). Tap = elige y cierra (el frame lo cablea).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function LoteOption({
  name,
  selected,
  onPress,
  testID,
}: {
  name: string;
  selected: boolean;
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
      borderColor={selected ? '$primary' : '$divider'}
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      pressStyle={{ backgroundColor: '$greenLight' }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: `Lote ${name}`, selected })}
    >
      <Text
        flex={1}
        minWidth={0}
        fontFamily="$body"
        fontSize="$5"
        lineHeight="$5"
        fontWeight={selected ? '700' : '600'}
        color="$textPrimary"
        numberOfLines={1}
      >
        {name}
      </Text>
      {selected ? (
        <Check size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
      ) : null}
    </XStack>
  );
}
