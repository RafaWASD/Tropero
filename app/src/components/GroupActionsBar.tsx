// GroupActionsBar — botonera de las acciones masivas de la vista de grupo (spec 10, T-UI.1 / R1.4,
// R1.5, R1.6, R7.1). Componente PRESENTACIONAL (no hace fetch — architecture.md): la pantalla resuelve
// el gating (services/group-data.ts) y le pasa `availability` + `onAction`.
//
// Las 3 acciones del MVP (R1.4), con VERBO PELADO (sin "todos", Gate 0 v2 D1):
//   - Vacunar  — GATEADA: visible solo si availability.vaccinate (R1.5/R1.6/R7.1).
//   - Destetar — GATEADA: visible solo si availability.wean.
//   - Castrar  — SIEMPRE visible (R1.5: no se gatea — castrado es estado del animal).
// Cada botón navega al flujo de selección (la pantalla decide la ruta — el destino real es del PRÓXIMO
// chunk; acá solo el disparo). Si una gateada no aplica, el botón NO se renderiza (R1.6).
//
// Layout manga-friendly (Fitts): botones grandes (≥$touchMin), apilados a ancho completo (una decisión
// por toque). Las TRES acciones van como botones-par OUTLINE del MISMO peso visual — ninguna es default
// (ni siquiera Castrar): el operario elige a propósito (R1.4). Orden por frecuencia operativa (Vacunar es
// la rutina, Destetar le sigue): las gateadas arriba cuando están, y Castrar —la acción siempre-presente
// (R1.5: no se gatea)— al final. Cero hardcode (ADR-023 §4): tokens.

import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { Scissors, Syringe, Milk } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { buttonA11y } from '../utils/a11y';
import type { GroupAction, GroupActionsAvailability } from '../utils/group-actions';

export type GroupActionsBarProps = {
  /** Gating resuelto por la pantalla (services/group-data.ts): qué acciones se ofrecen (R1.5/R7.1). */
  availability: GroupActionsAvailability;
  /** Dispara la acción elegida → la pantalla navega al flujo de selección / vacunación. */
  onAction: (action: GroupAction) => void;
};

export function GroupActionsBar({ availability, onAction }: GroupActionsBarProps) {
  return (
    <YStack width="100%" gap="$3">
      {/* Orden por frecuencia operativa (Vacunar es la rutina; Castrar es deliberada): las gateadas
          arriba cuando están, Castrar al final. Las TRES con el MISMO peso visual (outline) — ninguna
          es "la acción por defecto": el operario elige a propósito (R1.4). Castrar NO se gatea (R1.5). */}
      {availability.vaccinate ? (
        <ActionButton icon={Syringe} label="Vacunar" onPress={() => onAction('vaccinate')} />
      ) : null}
      {availability.wean ? (
        <ActionButton icon={Milk} label="Destetar" onPress={() => onAction('wean')} />
      ) : null}
      <ActionButton icon={Scissors} label="Castrar" onPress={() => onAction('castrate')} />
    </YStack>
  );
}

/**
 * Un botón de acción icono + texto (el Button canónico es solo-texto). Outline verde + texto verde
 * (mismo lenguaje que las CTA icono+texto de rodeos.tsx / la ficha). ≥$touchMin (manga-friendly). a11y
 * por helper. Cero hardcode (tokens + getTokenValue para el ícono lucide).
 */
function ActionButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <Pressable style={{ width: '100%' }} onPress={onPress} {...buttonA11y(Platform.OS, { label })}>
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        borderRadius="$pill"
        backgroundColor="transparent"
        borderWidth={2}
        borderColor="$primary"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <Icon size={20} color={primary} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}
