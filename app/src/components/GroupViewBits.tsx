// GroupViewBits — pieza presentacional COMPARTIDA por la vista de grupo (rodeo/[id] + lote/[id])
// (spec 10, T-UI.1 + delta «rodeo grande» T-RG.24).
//
//   - GroupMetaHeader: el "hero" del grupo — ícono + tipo (Rodeo/Lote) + nombre + cabezas activas. El conteo
//     ahora es el TOTAL REAL del grupo (COUNT scopeado overlay-aware, RG2.1), NO el largo de la lista cargada:
//     muestra "…" mientras no cargó (RG2.3, nunca "0 animales" prematuro) y formato es-AR (RG2.4).
//
// (La lista de animales se ABSORBIÓ en la FlatList de `GroupViewScreen` — RG4.1 — así que `GroupAnimalsList`
//  dejó de existir como componente `Card`+`.map`.)
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR. Recorte de descendentes:
// lineHeight matching en el heading del nombre (RG7.3).

import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import type { LucideIcon } from 'lucide-react-native';

// ─── Header de metadatos del grupo (R1.1 / RG2.1) ────────────────────────────────────────

/** Formatea el conteo en es-AR (separador de miles con punto, ej. 1.050) — RG2.4. */
function formatCount(n: number): string {
  return n.toLocaleString('es-AR');
}

export function GroupMetaHeader({
  icon: Icon,
  kindLabel,
  name,
  totalCount,
}: {
  /** Ícono lucide del tipo de grupo (Boxes para rodeo, Layers para lote). */
  icon: LucideIcon;
  /** Tipo de grupo legible ("Rodeo" / "Lote"). */
  kindLabel: string;
  /** Nombre del grupo. */
  name: string;
  /**
   * Total REAL de animales activos del grupo (COUNT scopeado overlay-aware, RG2.1). `null` = todavía no
   * cargó → muestra "…" (RG2.3, no mentir "0 animales"). Formato es-AR (RG2.4).
   */
  totalCount: number | null;
}) {
  const primary = getTokenValue('$primary', 'color');
  const countLabel =
    totalCount === null
      ? '…'
      : `${formatCount(totalCount)} ${totalCount === 1 ? 'animal activo' : 'animales activos'}`;
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
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted">
        {countLabel}
      </Text>
    </YStack>
  );
}
