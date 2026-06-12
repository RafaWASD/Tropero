// GroupViewBits — piezas presentacionales COMPARTIDAS por la vista de grupo (rodeo/[id] + lote/[id])
// (spec 10, T-UI.1 / R1.1, R1.2, R1.3). Componentes sin fetch (architecture.md): la pantalla orquesta
// los datos y pasa props.
//
//   - GroupMetaHeader: el "hero" del grupo — ícono + tipo (Rodeo/Lote) + nombre + cabezas activas.
//   - GroupAnimalsList: la lista de animales activos (R1.3), con su header de conteo + empty/loading.
//     Recibe `renderRow` para que cada pantalla arme su AnimalRow compacto con sus datos.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import type { LucideIcon } from 'lucide-react-native';

import { Card } from './Card';
import { InfoNote } from './AuthBits';

// ─── Header de metadatos del grupo (R1.1) ────────────────────────────────────────────────

export function GroupMetaHeader({
  icon: Icon,
  kindLabel,
  name,
  headCount,
  loading,
}: {
  /** Ícono lucide del tipo de grupo (Boxes para rodeo, Layers para lote). */
  icon: LucideIcon;
  /** Tipo de grupo legible ("Rodeo" / "Lote"). */
  kindLabel: string;
  /** Nombre del grupo. */
  name: string;
  /** Cabezas activas (= largo de la lista de animales activos, R1.3). */
  headCount: number;
  /** Mientras carga, el conteo muestra "…" en vez de 0 (no mentir "0 cabezas"). */
  loading: boolean;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <YStack width="100%" gap="$3" paddingTop="$1">
      <XStack alignItems="center" gap="$3">
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon size={24} color={primary} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            {kindLabel}
          </Text>
          <Text
            fontFamily="$body"
            fontSize="$8"
            lineHeight="$8"
            fontWeight="700"
            color="$textPrimary"
            numberOfLines={1}
            minWidth={0}
          >
            {name}
          </Text>
        </YStack>
      </XStack>
      <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
        {loading ? 'Cargando…' : `${headCount} ${headCount === 1 ? 'animal activo' : 'animales activos'}`}
      </Text>
    </YStack>
  );
}

// ─── Lista de animales del grupo (R1.2, R1.3) ────────────────────────────────────────────

export function GroupAnimalsList<T>({
  animals,
  loading,
  emptyCopy,
  renderRow,
}: {
  animals: readonly T[];
  loading: boolean;
  /** Copy del empty-state cuando el grupo no tiene animales activos. */
  emptyCopy: string;
  /** La pantalla arma cada fila (AnimalRow compacto con sus datos — incl. la `key`). */
  renderRow: (animal: T) => React.ReactNode;
}) {
  return (
    <YStack width="100%" gap="$3">
      <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
        Animales
      </Text>
      {loading ? (
        <InfoNote>Cargando animales…</InfoNote>
      ) : animals.length === 0 ? (
        <InfoNote>{emptyCopy}</InfoNote>
      ) : (
        // Card sin padding interno para que las filas (con su propio padding + divider) lleguen al
        // borde; overflow:hidden para que el borde inferior de la última fila respete el radio.
        <Card padding="$0" overflow="hidden">
          {animals.map((a) => renderRow(a))}
        </Card>
      )}
    </YStack>
  );
}
