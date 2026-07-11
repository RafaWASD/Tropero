// app/lote/[id].tsx — VISTA DE GRUPO de un LOTE / management_group (spec 10 T-UI.1 / R1.1–R1.6, R7.1) +
// BAJA EN TANDA (delta lotes-venta, RLV.2/RLV.3).
//
// Se llega desde Inicio (card de lote, R2.2). Muestra, para un lote del establecimiento activo:
//   - metadatos del grupo (nombre + cabezas activas), su configuración resumida (acciones gateadas), y la
//     lista de sus animales ACTIVOS (R1.3) reusando AnimalRow COMPACTO (R1.2/R11.9);
//   - la acción "Vender / Descartar" (RLV.2, visible con ≥1 activo) → MODO SELECCIÓN: cada fila lleva un
//     checkbox, header con "seleccionar todos" + contador (RLV.3/RLV.3.2), CTA "Registrar salida (N)"
//     habilitado con ≥1 seleccionado (RLV.3.1) → navega a `app/lote/venta.tsx` con los profileIds + groupId.
//
// Lote = agrupación cross-rodeo posible (ADR-020). Offline-first (spec 15): la lista sale de fetchGroupMembers
// (SQLite local, RLS-scopeado, RLV.21.1). NUNCA se hardcodea establishment_id (ppio 6). Cero hardcode
// (ADR-023 §4): tokens; lucide con getTokenValue. Recorte de descendentes: lineHeight en headings/numberOfLines.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, XStack, YStack } from 'tamagui';
import { Layers, Tag, X } from 'lucide-react-native';

import { AnimalRow, GroupViewScreen } from '@/components';
import { useEstablishment } from '@/contexts';
import { useGroupView, type GroupViewData } from '@/hooks';
import { fetchGroupMembers, fetchManagementGroups } from '@/services/management-groups';
import { fetchLoteGroupActions } from '@/services/group-data';
import { formatAnimalAge } from '@/utils/animal-age';
import { navigateToGroupAction } from '@/utils/group-nav';
import type { GroupAction } from '@/utils/group-actions';
import {
  emptySelection,
  toggleSelection,
  toggleSelectAll,
  isAllSelected,
  selectionCount,
  resolveSelectedIds,
  type BatchSelection,
} from '@/utils/batch-exit-selection';
import { buttonA11y } from '@/utils/a11y';

export default function LoteGroupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === 'string' ? params.id : null;

  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const [loteName, setLoteName] = useState('Lote');
  useEffect(() => {
    if (!establishmentId || !groupId) return;
    let active = true;
    void fetchManagementGroups(establishmentId).then((r) => {
      if (!active) return;
      if (r.ok) setLoteName(r.value.find((g) => g.id === groupId)?.name ?? 'Lote');
    });
    return () => {
      active = false;
    };
  }, [establishmentId, groupId]);

  const loader = useCallback(
    async (): Promise<{ ok: true; data: GroupViewData } | { ok: false; message: string }> => {
      if (!establishmentId || !groupId) return { ok: false, message: 'No se encontró el lote.' };
      const membersR = await fetchGroupMembers(establishmentId, groupId);
      if (!membersR.ok) {
        return {
          ok: false,
          message:
            membersR.error.kind === 'network'
              ? 'Sin conexión: no pudimos cargar el lote.'
              : 'No pudimos cargar el lote.',
        };
      }
      const members = membersR.value;
      const actionsR = await fetchLoteGroupActions(members);
      const actions = actionsR.ok ? actionsR.value : { castrate: false, vaccinate: false, wean: false };
      return { ok: true, data: { animals: members, actions } };
    },
    [establishmentId, groupId],
  );

  const view = useGroupView(groupId ? loader : null);

  const onAction = useCallback(
    (action: GroupAction) => {
      if (!groupId) return;
      navigateToGroupAction(router, action, { groupType: 'lote', groupId });
    },
    [router, groupId],
  );

  // ── MODO SELECCIÓN (baja en tanda, RLV.2/RLV.3) ──────────────────────────────────────
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<BatchSelection>(emptySelection());
  const memberIds = useMemo(() => view.animals.map((a) => a.profileId), [view.animals]);

  const enterSelection = useCallback(() => {
    setSelection(emptySelection());
    setSelectionMode(true);
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelection(emptySelection());
  }, []);
  const onToggleOne = useCallback((profileId: string) => {
    setSelection((prev) => toggleSelection(prev, profileId));
  }, []);
  const onToggleAll = useCallback(() => {
    setSelection((prev) => toggleSelectAll(prev, memberIds));
  }, [memberIds]);

  // Al RE-ENFOCAR el lote (volver de la baja en tanda `lote/venta.tsx` vía router.back), salir del modo
  // selección → la vista vuelve al estado normal mostrando MENOS cabezas (RLV.9). No interfiere con el
  // "Vender / Descartar" (que es un tap posterior al foco, sin transición de navegación).
  useFocusEffect(
    useCallback(() => {
      setSelectionMode(false);
      setSelection(emptySelection());
    }, []),
  );

  const count = selectionCount(selection);
  const allSelected = isAllSelected(selection, memberIds);

  const goToVenta = useCallback(() => {
    if (!groupId) return;
    const ids = resolveSelectedIds(selection, memberIds);
    if (ids.length === 0) return;
    router.push({ pathname: '/lote/venta', params: { groupId, profileIds: ids.join(',') } });
  }, [router, groupId, selection, memberIds]);

  // ── MODO SELECCIÓN: layout propio (checkbox por fila + "todos" + contador + CTA). ──
  if (selectionMode) {
    return (
      <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
        <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4" gap="$1">
          <XStack width="100%" alignItems="center" gap="$3" paddingVertical="$3">
            <Pressable hitSlop={8} onPress={exitSelection} {...buttonA11y(Platform.OS, { label: 'Cancelar selección' })}>
              <X size={28} color={getTokenValue('$textMuted', 'color')} strokeWidth={2} />
            </Pressable>
            <Text flex={1} fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              Elegí los animales
            </Text>
            <Pressable
              hitSlop={8}
              onPress={onToggleAll}
              testID="lote-seleccion-todos"
              {...buttonA11y(Platform.OS, { label: allSelected ? 'Deseleccionar todos' : 'Seleccionar todos' })}
            >
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary" numberOfLines={1}>
                {allSelected ? 'Ninguno' : 'Todos'}
              </Text>
            </Pressable>
          </XStack>
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={1} paddingBottom="$2">
            {count} {count === 1 ? 'seleccionado' : 'seleccionados'}
          </Text>
        </YStack>

        <ScrollView
          flex={1}
          width="100%"
          maxWidth="100%"
          contentContainerStyle={{ paddingBottom: getTokenValue('$4', 'space') }}
          showsHorizontalScrollIndicator={false}
        >
          {view.animals.map((a) => (
            <AnimalRow
              key={a.profileId}
              compact
              idv={a.idv ?? undefined}
              apodo={a.apodo}
              rodeoUsesApodo={a.rodeoUsesApodo}
              tagElectronic={a.tagElectronic}
              category={a.categoryName || a.categoryCode}
              categoryCode={a.categoryCode}
              age={formatAnimalAge(a.animalBirthDate)}
              sex={a.sex}
              rodeo={a.rodeoName}
              futureBull={a.futureBull}
              checked={selection.has(a.profileId)}
              onToggle={() => onToggleOne(a.profileId)}
            />
          ))}
        </ScrollView>

        {/* CTA fijo abajo: habilitado con ≥1 seleccionado (RLV.3.1). */}
        <YStack width="100%" paddingHorizontal="$4" paddingTop="$3" paddingBottom={insets.bottom + 12} borderTopWidth={1} borderTopColor="$divider" backgroundColor="$bg">
          <Pressable
            style={{ width: '100%' }}
            onPress={count > 0 ? goToVenta : undefined}
            testID="lote-registrar-salida"
            {...buttonA11y(Platform.OS, { label: 'Registrar salida', disabled: count === 0 })}
          >
            <XStack
              width="100%"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              borderRadius="$pill"
              backgroundColor="$terracota"
              paddingHorizontal="$5"
              opacity={count === 0 ? 0.5 : 1}
              pressStyle={{ opacity: 0.85 }}
            >
              <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
                {count > 0 ? `Registrar salida (${count})` : 'Registrar salida'}
              </Text>
            </XStack>
          </Pressable>
        </YStack>
      </YStack>
    );
  }

  // ── MODO NORMAL: la vista de grupo + la afordancia "Vender / Descartar" (RLV.2, ≥1 activo). ──
  const canSell = !view.loading && !view.error && view.animals.length > 0;
  return (
    <YStack flex={1} width="100%" maxWidth="100%" backgroundColor="$bg">
      <GroupViewScreen
        icon={Layers}
        kindLabel="Lote"
        name={loteName}
        view={view}
        emptyCopy="Este lote todavía no tiene animales activos."
        onAction={onAction}
        backFallback="/lotes"
        renderRow={(a) => (
          <AnimalRow
            key={a.profileId}
            compact
            idv={a.idv ?? undefined}
            apodo={a.apodo}
            rodeoUsesApodo={a.rodeoUsesApodo}
            tagElectronic={a.tagElectronic}
            category={a.categoryName || a.categoryCode}
            categoryCode={a.categoryCode}
            age={formatAnimalAge(a.animalBirthDate)}
            sex={a.sex}
            rodeo={a.rodeoName}
            futureBull={a.futureBull}
            onPress={() => router.push({ pathname: '/animal/[id]', params: { id: a.profileId } })}
          />
        )}
      />

      {canSell ? (
        <YStack width="100%" paddingHorizontal="$4" paddingTop="$3" paddingBottom={insets.bottom + 12} borderTopWidth={1} borderTopColor="$divider" backgroundColor="$bg">
          <Pressable
            style={{ width: '100%' }}
            onPress={enterSelection}
            testID="lote-vender-descartar"
            {...buttonA11y(Platform.OS, { label: 'Vender o descartar animales del lote' })}
          >
            <XStack
              width="100%"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              gap="$2"
              borderRadius="$pill"
              borderWidth={2}
              borderColor="$terracota"
              backgroundColor="$white"
              paddingHorizontal="$5"
              pressStyle={{ backgroundColor: '$surface' }}
            >
              <Tag size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$terracota', 'color')} strokeWidth={2.5} />
              <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$terracota">
                Vender / Descartar
              </Text>
            </XStack>
          </Pressable>
        </YStack>
      ) : null}
    </YStack>
  );
}
