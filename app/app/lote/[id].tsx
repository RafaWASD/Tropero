// app/lote/[id].tsx — VISTA DE GRUPO de un LOTE / management_group (spec 10 T-UI.1 + delta «rodeo grande»
// T-RG.26) + BAJA EN TANDA (delta lotes-venta, RLV.2/RLV.3).
//
// Se llega desde Inicio (card de lote, R2.2). Muestra, para un lote del establecimiento activo:
//   - metadatos (nombre + total REAL de cabezas — COUNT scopeado, RG2.1), buscador + chips, y la lista de sus
//     animales ACTIVOS PAGINADA (scroll infinito keyset, RG1.x) reusando AnimalRow COMPACTO — vía GroupViewScreen;
//   - la acción "Vender / Descartar" (RLV.2, visible con ≥1 activo) → MODO SELECCIÓN: cada fila lleva un
//     checkbox, header con "seleccionar todos" + contador, CTA "Registrar salida (N)" → navega a
//     `app/lote/venta.tsx`.
//
// RECONCILIACIÓN con la paginación (RG5.6 / design §6.4): la lista NORMAL ahora es una PÁGINA (no el lote entero),
// así que el MODO SELECCIÓN carga el **set COMPLETO del lote** (`fetchAllGroupMembers`, sin tope) al activarse y lo
// **virtualiza** (FlatList) — "seleccionar todos" opera sobre TODOS los miembros, no la página. Además el handoff
// a `venta.tsx` NO enumera cada UUID (un lote de miles reventaría el param de URL): manda `groupId` + `mode` +
// el csv MÁS CHICO entre seleccionados/excluidos (ver `goToVenta`); `venta.tsx` resuelve el set del lado destino.
//
// Lote = agrupación cross-rodeo posible (ADR-020). Offline-first (spec 15): todo del SQLite local, RLS-scopeado.
// NUNCA se hardcodea establishment_id (ppio 6). Cero hardcode (ADR-023 §4): tokens; lucide con getTokenValue.
// Recorte de descendentes: lineHeight en headings/numberOfLines.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { Layers, Tag, X } from 'lucide-react-native';

import { AnimalRow, GroupViewScreen, InfoNote } from '@/components';
import { useEstablishment } from '@/contexts';
import { useGroupView, type GroupViewParams } from '@/hooks';
import { fetchAllGroupMembers, fetchManagementGroups } from '@/services/management-groups';
import type { AnimalListItem } from '@/services/animals';
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

  const viewParams = useMemo<GroupViewParams | null>(
    () => (establishmentId && groupId ? { establishmentId, group: { type: 'lote', id: groupId } } : null),
    [establishmentId, groupId],
  );
  const view = useGroupView(viewParams);

  const onAction = useCallback(
    (action: GroupAction) => {
      if (!groupId) return;
      navigateToGroupAction(router, action, { groupType: 'lote', groupId });
    },
    [router, groupId],
  );

  // ── MODO SELECCIÓN (baja en tanda, RLV.2/RLV.3 · reconciliado RG5.6) ──────────────────
  // La selección opera sobre el SET COMPLETO del lote (no la página): se carga `fetchAllGroupMembers` al
  // ENTRAR en modo selección (`members === null` = cargando) y se virtualiza (FlatList).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<BatchSelection>(emptySelection());
  const [members, setMembers] = useState<AnimalListItem[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const memberIds = useMemo(() => (members ?? []).map((a) => a.profileId), [members]);

  const enterSelection = useCallback(() => {
    if (!establishmentId || !groupId) return;
    setSelection(emptySelection());
    setMembers(null);
    setMembersError(null);
    setSelectionMode(true);
    void fetchAllGroupMembers(establishmentId, { type: 'lote', id: groupId }).then((r) => {
      if (!r.ok) {
        setMembersError(
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar los animales del lote.'
            : 'No pudimos cargar los animales del lote.',
        );
        setMembers([]);
        return;
      }
      setMembers(r.value);
    });
  }, [establishmentId, groupId]);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelection(emptySelection());
    setMembers(null);
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
      setMembers(null);
    }, []),
  );

  const count = selectionCount(selection);
  const allSelected = isAllSelected(selection, memberIds);

  // Handoff a venta.tsx SIN enumerar miles de UUIDs (RG5.6 / design §6.4): mandamos `groupId` + `mode` + el
  // csv MÁS CHICO entre seleccionados y excluidos. mode='all' → operar sobre TODOS menos `ids` (excluidos);
  // mode='subset' → operar sobre `ids` (seleccionados). El csv transmitido es min(sel, excl) ≤ total/2 → para
  // "seleccionar todos" (lote de miles) va VACÍO. venta.tsx resuelve el set contra `fetchGroupMembers` (anti-IDOR).
  const goToVenta = useCallback(() => {
    if (!groupId || !members) return;
    const selectedIds = resolveSelectedIds(selection, memberIds);
    if (selectedIds.length === 0) return;
    const total = memberIds.length;
    if (selectedIds.length * 2 >= total) {
      const excluded = memberIds.filter((id) => !selection.has(id));
      router.push({ pathname: '/lote/venta', params: { groupId, mode: 'all', ids: excluded.join(',') } });
    } else {
      router.push({ pathname: '/lote/venta', params: { groupId, mode: 'subset', ids: selectedIds.join(',') } });
    }
  }, [router, groupId, members, selection, memberIds]);

  // ── MODO SELECCIÓN: layout propio (checkbox por fila + "todos" + contador + CTA), VIRTUALIZADO (FlatList). ──
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
            {memberIds.length > 0 ? (
              <XStack
                hitSlop={8}
                pressStyle={{ opacity: 0.6 }}
                onPress={onToggleAll}
                testID="lote-seleccion-todos"
                {...buttonA11y(Platform.OS, { label: allSelected ? 'Deseleccionar todos' : 'Seleccionar todos' })}
              >
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary" numberOfLines={1}>
                  {allSelected ? 'Ninguno' : 'Todos'}
                </Text>
              </XStack>
            ) : null}
          </XStack>
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={1} paddingBottom="$2">
            {count} {count === 1 ? 'seleccionado' : 'seleccionados'}
          </Text>
        </YStack>

        {members === null ? (
          <YStack paddingHorizontal="$4" paddingTop="$2">
            <InfoNote>Cargando animales…</InfoNote>
          </YStack>
        ) : membersError ? (
          <YStack paddingHorizontal="$4" paddingTop="$2">
            <InfoNote>{membersError}</InfoNote>
          </YStack>
        ) : members.length === 0 ? (
          <YStack paddingHorizontal="$4" paddingTop="$2">
            <InfoNote>Este lote ya no tiene animales activos.</InfoNote>
          </YStack>
        ) : (
          <FlatList
            data={members}
            keyExtractor={(a) => a.profileId}
            renderItem={({ item: a }) => (
              <AnimalRow
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
            )}
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{ paddingBottom: getTokenValue('$4', 'space') }}
          />
        )}

        {/* CTA fijo abajo: habilitado con ≥1 seleccionado (RLV.3.1). */}
        <YStack width="100%" paddingHorizontal="$4" paddingTop="$3" paddingBottom={insets.bottom + 12} borderTopWidth={1} borderTopColor="$divider" backgroundColor="$bg">
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
            onPress={count > 0 ? goToVenta : undefined}
            testID="lote-registrar-salida"
            {...buttonA11y(Platform.OS, { label: 'Registrar salida', disabled: count === 0 })}
          >
            <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
              {count > 0 ? `Registrar salida (${count})` : 'Registrar salida'}
            </Text>
          </XStack>
        </YStack>
      </YStack>
    );
  }

  // ── MODO NORMAL: la vista de grupo + la afordancia "Vender / Descartar" (RLV.2, con ≥1 activo). ──
  const canSell = !view.error && (view.totalCount ?? view.animals.length) > 0;
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
            onPress={enterSelection}
            testID="lote-vender-descartar"
            {...buttonA11y(Platform.OS, { label: 'Vender o descartar animales del lote' })}
          >
            <Tag size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$terracota', 'color')} strokeWidth={2.5} />
            <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$terracota">
              Vender / Descartar
            </Text>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}
