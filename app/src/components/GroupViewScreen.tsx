// GroupViewScreen — scaffold PRESENTACIONAL compartido de la vista de grupo (rodeo/[id] + lote/[id])
// (spec 10, T-UI.1 / R1.1–R1.6, R7.1). Sin fetch (architecture.md): la pantalla (ruta) orquesta los datos
// con useGroupView + su loader, y pasa el estado + un `onAction` + un `renderRow`. Este componente arma:
//   - header con back,
//   - GroupMetaHeader (tipo + nombre + cabezas),
//   - resumen de configuración de datos (qué se gatea — Vacunar/Destetar; Castrar no se lista, R1.5),
//   - card de acciones masivas (GroupActionsBar),
//   - lista de animales activos (GroupAnimalsList) con el renderRow de la pantalla.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, XStack, YStack } from 'tamagui';
import { ChevronLeft, Syringe, Milk } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Card } from './Card';
import { FormError } from './AuthBits';
import { GroupActionsBar } from './GroupActionsBar';
import { GroupMetaHeader, GroupAnimalsList } from './GroupViewBits';
import { backOr } from '../utils/nav';
import { buttonA11y } from '../utils/a11y';
import type { GroupAction, GroupActionsAvailability } from '../utils/group-actions';
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

            {actions ? <GroupConfigSummary actions={actions} /> : null}

            {actions ? (
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

/**
 * Resumen de la config: chips de los datos que gatea el grupo (Vacunación/Destete). Castrar siempre
 * disponible → NO se lista (no es dato configurable, R1.5). Si ninguna gateada → nota corta. */
function GroupConfigSummary({ actions }: { actions: GroupActionsAvailability }) {
  const primary = getTokenValue('$primary', 'color');
  const chips: { Icon: LucideIcon; label: string }[] = [];
  if (actions.vaccinate) chips.push({ Icon: Syringe, label: 'Vacunación' });
  if (actions.wean) chips.push({ Icon: Milk, label: 'Destete' });

  return (
    <Card gap="$3">
      <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
        Datos que se cargan acá
      </Text>
      {chips.length === 0 ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          Este grupo no tiene vacunación ni destete habilitados. Podés castrar igual.
        </Text>
      ) : (
        <XStack flexWrap="wrap" gap="$2">
          {chips.map(({ Icon, label }) => (
            <XStack
              key={label}
              alignItems="center"
              gap="$1"
              backgroundColor="$greenLight"
              borderRadius="$pill"
              paddingHorizontal="$3"
              paddingVertical="$1"
            >
              <Icon size={14} color={primary} strokeWidth={2.5} />
              <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$primary">
                {label}
              </Text>
            </XStack>
          ))}
        </XStack>
      )}
    </Card>
  );
}
