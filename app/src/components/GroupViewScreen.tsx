// GroupViewScreen — scaffold PRESENTACIONAL compartido de la vista de grupo (rodeo/[id] + lote/[id])
// (spec 10, T-UI.1 + delta «rodeo grande» T-RG.22/23). Sin fetch (architecture.md): la pantalla (ruta)
// orquesta los datos con `useGroupView` (contrato paginado) y pasa el estado + `onAction` + `renderRow`.
//
// Reestructurado a **FlatList VIRTUALIZADA** (RG4.1/RG4.2 — FlatList, NO FlashList) para no colgar en un
// grupo de miles: `ScrollView`+`.map()` → `FlatList` con scroll infinito (`onEndReached` → `loadMore`,
// RG1.3). Layout:
//   - header con back (fijo),
//   - GroupSearchBar (buscador + chips categoría/sexo) FIJO arriba, FUERA de la FlatList (RG4.4 — siempre
//     alcanzable sin scrollear),
//   - FlatList: `ListHeaderComponent` = GroupMetaHeader (totalCount real) + card de acciones masivas
//     (scrollean, RG4.3); `renderItem` = el `renderRow` de la pantalla (AnimalRow compacto); `keyExtractor`
//     = `profileId` (keys estables, RG4.5); `ListFooterComponent` = spinner "cargando más" (RG4.6);
//     `ListEmptyComponent` = loading/empty/no-match.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { KeyboardAvoidingShell } from './KeyboardAvoidingShell';
import { Card } from './Card';
import { FormError, InfoNote } from './AuthBits';
import { GroupActionsBar } from './GroupActionsBar';
import { GroupMetaHeader } from './GroupViewBits';
import { GroupSearchBar } from './GroupSearchBar';
import { backOr } from '../utils/nav';
import { buttonA11y } from '../utils/a11y';
import type { AnimalListItem } from '../services/animals';
import type { GroupAction } from '../utils/group-actions';
import type { GroupViewState } from '../hooks/useGroupView';

// Estilo del `KeyboardAvoidingShell` (API no-Tamagui). `flex` no es spacing/color → no aplica el lint
// anti-hardcode (ADR-023 §4).
const fillStyle = { flex: 1 } as const;

export type GroupViewScreenProps = {
  /** Ícono del tipo de grupo (Boxes para rodeo, Layers para lote). */
  icon: LucideIcon;
  /** Tipo de grupo ("Rodeo" / "Lote"). */
  kindLabel: string;
  /** Nombre del grupo. */
  name: string;
  /** Estado paginado del grupo (useGroupView). */
  view: GroupViewState;
  /** Copy del empty-state de la lista (grupo sin animales activos). */
  emptyCopy: string;
  /** Dispara una acción masiva (la pantalla navega). */
  onAction: (action: GroupAction) => void;
  /** La pantalla arma cada fila (AnimalRow compacto). */
  renderRow: (animal: AnimalListItem) => React.ReactNode;
  /** Ruta de fallback del back si el stack está vacío (default: Inicio). */
  backFallback?: '/(tabs)' | '/lotes' | '/rodeos';
};

export function GroupViewScreen({
  icon,
  kindLabel,
  name,
  view,
  emptyCopy,
  onAction,
  renderRow,
  backFallback = '/(tabs)',
}: GroupViewScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const muted = getTokenValue('$textMuted', 'color');
  const [openPicker, setOpenPicker] = useState<'category' | 'sex' | null>(null);

  const { animals, actions, totalCount, loading, loadingMore, error } = view;
  const hasActions = actions && (actions.vaccinate || actions.wean || actions.castrate);

  // Header de la lista (scrollea con ella, RG4.3): meta con el total REAL + card de acciones masivas.
  const listHeader = (
    <YStack width="100%" gap="$4" paddingBottom="$4">
      <GroupMetaHeader icon={icon} kindLabel={kindLabel} name={name} totalCount={totalCount} />
      {/* La card de acciones se muestra solo si hay AL MENOS UNA acción ofrecible (grupo sin candidatos ni
          config habilitada NO muestra una card vacía). */}
      {hasActions ? (
        <Card gap="$3">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
            Acciones del grupo
          </Text>
          <GroupActionsBar availability={actions} onAction={onAction} />
        </Card>
      ) : null}
    </YStack>
  );

  // Empty-state de la lista (RG3.8 / búsqueda sin match / grupo vacío). Se muestra cuando `animals` está vacío.
  const emptyElement = (
    <YStack width="100%" paddingTop="$2">
      {loading ? (
        <InfoNote>Cargando animales…</InfoNote>
      ) : view.isSearching ? (
        view.searchPending ? (
          <InfoNote>Buscando…</InfoNote>
        ) : (
          <InfoNote>{`No encontramos «${view.query.trim()}» en este grupo.`}</InfoNote>
        )
      ) : view.categoryCode !== null || view.sex !== null ? (
        <InfoNote>Ningún animal coincide con el filtro.</InfoNote>
      ) : (
        <InfoNote>{emptyCopy}</InfoNote>
      )}
    </YStack>
  );

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* TECLADO (unidad «barrida de teclado»): el input vive en `GroupSearchBar`, que es una PARTE, no una
          superficie — la cobertura la pone ACÁ, la pantalla que la monta (la usan `lote/[id]` y `rodeo/[id]`).
          El buscador está arriba y no se tapa; lo que el teclado tapaba era la LISTA de resultados. Con la
          columna adentro del primitivo, la lista termina justo por encima del teclado. */}
      <KeyboardAvoidingShell style={fillStyle}>
        {/* Header fijo con back. */}
        <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
          <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
            <Pressable hitSlop={8} onPress={() => backOr(router, backFallback)} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
              <ChevronLeft size={28} color={muted} strokeWidth={2} />
            </Pressable>
          </XStack>
        </YStack>

        {/* Buscador + chips FIJOS arriba (fuera de la FlatList, RG4.4). */}
        <GroupSearchBar
          query={view.query}
          onChangeQuery={view.setQuery}
          categoryCode={view.categoryCode}
          onSelectCategory={view.setCategoryCode}
          categoryOptions={view.categoryOptions}
          sex={view.sex}
          onSelectSex={view.setSex}
          sexFilterAvailable={view.sexFilterAvailable}
          openPicker={openPicker}
          onOpenPicker={setOpenPicker}
        />

        {error && animals.length === 0 ? (
          <YStack paddingHorizontal="$4" paddingTop="$4">
            <FormError message={error} />
          </YStack>
        ) : (
          <FlatList
            data={animals}
            keyExtractor={(a) => a.profileId}
            renderItem={({ item }) => <>{renderRow(item)}</>}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={emptyElement}
            ListFooterComponent={
              loadingMore ? (
                <XStack width="100%" alignItems="center" justifyContent="center" gap="$2" paddingVertical="$4">
                  <ActivityIndicator color={muted} />
                  <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted">
                    Cargando más…
                  </Text>
                </XStack>
              ) : null
            }
            onEndReached={view.loadMore}
            onEndReachedThreshold={0.5}
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1, width: '100%' }}
            contentContainerStyle={{
              paddingHorizontal: getTokenValue('$4', 'space'),
              paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
            }}
          />
        )}
      </KeyboardAvoidingShell>
    </YStack>
  );
}
