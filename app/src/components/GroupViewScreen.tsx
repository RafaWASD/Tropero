// GroupViewScreen — scaffold PRESENTACIONAL compartido de la vista de grupo (rodeo/[id] + lote/[id])
// (spec 10, T-UI.1 / R1.1–R1.6, R7.1). Sin fetch (architecture.md): la pantalla (ruta) orquesta los datos
// con useGroupView + su loader, y pasa el estado + un `onAction` + un `renderRow`. Este componente arma:
//   - header con back,
//   - GroupMetaHeader (tipo + nombre + cabezas),
//   - card de acciones masivas (GroupActionsBar),
//   - lista de animales activos (GroupAnimalsList) con el renderRow de la pantalla.
//
// (Sin card de "Datos que se cargan acá": era redundante con las 3 acciones del grupo de abajo —Nielsen
//  #8—; el gating de las acciones se sigue resolviendo en group-data.ts, solo se quitó el chip visual.)
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Card } from './Card';
import { FormError } from './AuthBits';
import { GroupActionsBar } from './GroupActionsBar';
import { GroupMetaHeader, GroupAnimalsList } from './GroupViewBits';
import { backOr } from '../utils/nav';
import { buttonA11y } from '../utils/a11y';
import type { GroupAction } from '../utils/group-actions';
import type { GroupViewState } from '../hooks/useGroupView';

export type GroupViewScreenProps<T> = {
  /** Ícono del tipo de grupo (Boxes para rodeo, Layers para lote). */
  icon: LucideIcon;
  /** Tipo de grupo ("Rodeo" / "Lote"). */
  kindLabel: string;
  /** Nombre del grupo. */
  name: string;
  /** Estado de carga del grupo (useGroupView). */
  view: GroupViewState & { animals: T[] };
  /** Copy del empty-state de la lista. */
  emptyCopy: string;
  /** Dispara una acción masiva (la pantalla navega). */
  onAction: (action: GroupAction) => void;
  /** La pantalla arma cada fila (AnimalRow compacto). */
  renderRow: (animal: T) => React.ReactNode;
  /** Ruta de fallback del back si el stack está vacío (default: Inicio). */
  backFallback?: '/(tabs)' | '/lotes' | '/rodeos';
};

export function GroupViewScreen<T>({
  icon,
  kindLabel,
  name,
  view,
  emptyCopy,
  onAction,
  renderRow,
  backFallback = '/(tabs)',
}: GroupViewScreenProps<T>) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const muted = getTokenValue('$textMuted', 'color');
  const { animals, actions, loading, error } = view;

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={() => backOr(router, backFallback)} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {error ? (
          <FormError message={error} />
        ) : (
          <>
            <GroupMetaHeader icon={icon} kindLabel={kindLabel} name={name} headCount={animals.length} loading={loading} />

            {/* La card de acciones se muestra solo si hay AL MENOS UNA acción ofrecible (fix Raf 2026-06-12:
                un grupo sin candidatos ni config habilitada NO muestra una card vacía). */}
            {actions && (actions.vaccinate || actions.wean || actions.castrate) ? (
              <Card gap="$3">
                <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
                  Acciones del grupo
                </Text>
                <GroupActionsBar availability={actions} onAction={onAction} />
              </Card>
            ) : null}

            <GroupAnimalsList animals={animals} loading={loading} emptyCopy={emptyCopy} renderRow={renderRow} />
          </>
        )}
      </ScrollView>
    </YStack>
  );
}
