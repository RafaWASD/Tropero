// RoleBadge — chip neutro del rol de un usuario en un campo (spec 01).
//
// FUENTE ÚNICA del chip de rol: lo usan EstablishmentCard ("Mis campos") y la pantalla Miembros
// (Fase 5). Borde $divider sobre $surface, texto $textMuted, etiqueta vía roleLabel (Dueño /
// Operario / Veterinario — fuente única de utils/establishment). Extraído de EstablishmentCard
// para no divergir la etiqueta/estilo entre pantallas (Nielsen #4 consistencia).
//
// Cero hardcode (ADR-023 §4): tokens.

import { Text, View } from 'tamagui';
import { roleLabel } from '../utils/establishment';
import type { UserRole } from '../types';

export type RoleBadgeProps = {
  role: UserRole;
};

export function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$3"
      paddingVertical="$1"
    >
      <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
        {roleLabel(role)}
      </Text>
    </View>
  );
}
