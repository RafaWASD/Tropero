// app/maniobra/_components/SugerenciaVaciasSheet.tsx — PICKER de lote para las VACÍAS de la sesión
// (delta lotes-venta, RLV.12/RLV.13/RLV.14).
//
// Se abre desde la sugerencia post-tacto del ExitJornadaSheet (fase 'terminated', "Elegir lote"). Ofrece:
//   - ELEGIR un lote EXISTENTE del campo (RLV.12) → onChooseExisting(groupId);
//   - CREAR un lote nuevo ahí mismo (RLV.13), con "Descarte" propuesto por default (editable) →
//     onCreateNew(name). SOLO se ofrece a OWNER (`canCreate`): crear un lote es owner-only server-side
//     (RLS management_groups_insert = is_owner_of, 0037) → ofrecerlo a un no-owner dejaría un INSERT que el
//     server rechaza al subir (con la asignación de las vacías colgando). Un no-owner solo elige existentes
//     (assignAnimalToGroup = has_role_in, cualquier rol operativo). RECONCILIACIÓN de RLV.13 (ver design §4.2).
//
// PRESENTACIONAL (architecture.md): NO llama services — el caller (identificar.tsx) persiste
// (createManagementGroup + assignAnimalToGroup por vaca). Molde de LotePickerSheet: scrim con guard anti
// tap-through (reference_rn_web_pitfalls) + HEADER FIJO (título que NUNCA se recorta) + BODY SCROLL + FOOTER
// FIJO. RECORTE DE DESCENDENTES: los nombres de lote son texto libre (g/p/q/y/j) → lineHeight matcheado. Cero
// hardcode (ADR-023 §4): tokens; lucide con getTokenValue. es-AR voseo.

import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Plus } from 'lucide-react-native';

import { ComboOptionRow, FormField } from '@/components';
import { buttonA11y } from '@/utils/a11y';
import { validateGroupName, MANAGEMENT_GROUP_NAME_MAX } from '@/utils/management-group';
import type { ManagementGroup } from '@/services/management-groups';

export type SugerenciaVaciasSheetProps = {
  /** ¿El sheet está abierto? */
  open: boolean;
  /** Cantidad de vacías a agregar (para el título). */
  count: number;
  /** Lotes activos del campo (fetchManagementGroups). Puede estar vacío. */
  groups: ManagementGroup[];
  /** ¿Puede el usuario CREAR un lote? (owner-only, RLS 0037). Si false, solo elige existentes. */
  canCreate: boolean;
  /** ¿Asignación en vuelo? Deshabilita las acciones (anti doble-tap). */
  busy?: boolean;
  /** Cerrar sin asignar ("Ahora no" / scrim). */
  onClose: () => void;
  /** Elegir un lote existente (RLV.12). */
  onChooseExisting: (groupId: string) => void;
  /** Crear un lote nuevo con este nombre (RLV.13). El caller lo crea + asigna las vacías. */
  onCreateNew: (name: string) => void;
};

export function SugerenciaVaciasSheet({
  open,
  count,
  groups,
  canCreate,
  busy = false,
  onClose,
  onChooseExisting,
  onCreateNew,
}: SugerenciaVaciasSheetProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // Sub-modo "crear lote nuevo" + su nombre (default "Descarte", RLV.13).
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Descarte');
  const [nameErr, setNameErr] = useState<string | null>(null);

  // Guard anti tap-through (idéntico a LotePickerSheet): el click huérfano del open no debe cerrar el scrim.
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    if (!open) {
      readyToDismissRef.current = false;
      // Reset del sub-modo al cerrar → reabrir arranca limpio en la lista.
      setCreating(false);
      setName('Descarte');
      setNameErr(null);
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

  const submitCreate = () => {
    const v = validateGroupName(name);
    if (!v.ok) {
      setNameErr(v.error);
      return;
    }
    onCreateNew(v.value);
  };

  const countWord = count === 1 ? 'vaca vacía' : 'vacías';
  const hasGroups = groups.length > 0;

  return (
    <View position="absolute" top="$0" left="$0" right="$0" bottom="$0" backgroundColor="$scrim" justifyContent="flex-end">
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="sugerencia-vacias-scrim"
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
        testID="sugerencia-vacias-sheet"
      >
        {/* HEADER FIJO (grip + título). flexShrink:0 → el título nunca se recorta al crecer la lista. */}
        <YStack flexShrink={0} gap="$3">
          <View alignSelf="center" width={getTokenValue('$icon', 'size')} height={getTokenValue('$progressTrack', 'size')} borderRadius="$pill" backgroundColor="$divider" />
          <YStack gap="$1">
            <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={2}>
              Agregar {count} {countWord} a un lote
            </Text>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={2}>
              {creating ? 'Nombrá el lote nuevo.' : 'Elegí un lote existente o creá uno.'}
            </Text>
          </YStack>
        </YStack>

        {/* CUERPO scrolleable. */}
        <ScrollView flex={1} style={{ minHeight: 0 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: getTokenValue('$2', 'space') }} keyboardShouldPersistTaps="handled">
          {creating ? (
            <YStack gap="$3">
              <FormField
                label="Nombre del lote"
                value={name}
                onChangeText={(t) => {
                  setName(t);
                  if (nameErr) setNameErr(null);
                }}
                placeholder="Descarte"
                error={nameErr}
                maxLength={MANAGEMENT_GROUP_NAME_MAX}
                autoCapitalize="sentences"
                testID="sugerencia-vacias-nombre"
              />
              <Pressable
                style={{ width: '100%' }}
                onPress={busy ? undefined : submitCreate}
                testID="sugerencia-vacias-crear"
                {...buttonA11y(Platform.OS, { label: 'Crear lote y agregar', disabled: busy })}
              >
                <XStack width="100%" minHeight="$touchMin" alignItems="center" justifyContent="center" borderRadius="$pill" backgroundColor="$primary" opacity={busy ? 0.6 : 1} pressStyle={{ backgroundColor: '$primaryPress' }}>
                  <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$white">
                    {busy ? 'Agregando…' : 'Crear y agregar'}
                  </Text>
                </XStack>
              </Pressable>
              <View minHeight="$touchMin" alignItems="center" justifyContent="center" pressStyle={{ opacity: 0.6 }} onPress={() => setCreating(false)} {...buttonA11y(Platform.OS, { label: 'Volver a la lista' })}>
                <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
                  Volver
                </Text>
              </View>
            </YStack>
          ) : (
            <>
              {/* Lista de lotes existentes (RLV.12) — filas planas dentro de un contenedor bordeado. */}
              {hasGroups ? (
                <YStack gap="$1" borderRadius="$card" borderWidth={1} borderColor="$divider" backgroundColor="$surface" paddingVertical="$2" paddingHorizontal="$2">
                  {groups.map((g) => (
                    <ComboOptionRow
                      key={g.id}
                      size="comfortable"
                      testID={`sugerencia-lote-${g.id}`}
                      a11yLabel={`Lote ${g.name}`}
                      label={g.name}
                      selected={false}
                      onPress={busy ? () => undefined : () => onChooseExisting(g.id)}
                    />
                  ))}
                </YStack>
              ) : (
                <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textFaint" numberOfLines={3} paddingHorizontal="$2" paddingTop="$1">
                  {canCreate
                    ? 'Este campo todavía no tiene lotes. Creá uno abajo.'
                    : 'Este campo todavía no tiene lotes. Pedile al dueño que cree uno.'}
                </Text>
              )}

              {/* Crear lote nuevo (RLV.13) — SOLO owner (RLS 0037). Fila de acción con "+". */}
              {canCreate ? (
                <Pressable onPress={() => setCreating(true)} testID="sugerencia-vacias-crear-nuevo" {...buttonA11y(Platform.OS, { label: 'Crear lote nuevo' })}>
                  <XStack alignItems="center" gap="$3" minHeight="$touchMin" borderRadius="$card" borderWidth={1} borderColor="$divider" backgroundColor="$white" paddingHorizontal="$4" pressStyle={{ backgroundColor: '$surface' }}>
                    <View width="$icon" height="$icon" borderRadius="$pill" backgroundColor="$greenLight" alignItems="center" justifyContent="center" flexShrink={0}>
                      <Plus size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
                    </View>
                    <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                      Crear lote nuevo
                    </Text>
                  </XStack>
                </Pressable>
              ) : null}
            </>
          )}
        </ScrollView>

        {/* FOOTER FIJO: "Ahora no" (saltar, RLV.11 — igual que el scrim, accesible sin apuntar al borde). */}
        <YStack flexShrink={0}>
          <View testID="sugerencia-vacias-sheet-ahora-no" minHeight="$touchMin" alignItems="center" justifyContent="center" pressStyle={{ opacity: 0.6 }} onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Ahora no' })}>
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
              Ahora no
            </Text>
          </View>
        </YStack>
      </YStack>
    </View>
  );
}
