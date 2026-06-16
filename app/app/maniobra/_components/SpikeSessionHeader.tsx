// app/maniobra/_components/SpikeSessionHeader.tsx — header de SESIÓN del SPIKE de identificación
// (spec 03 M2.1, US-3/US-5). DISTINTO del SpikeIdentityHeader (que es la identidad del animal en la
// carga rápida): este header vive ARRIBA de la pantalla de escaneo y comunica el ESTADO DE LA JORNADA
// (visibilidad del estado del sistema, Nielsen #1), no la del animal — todavía no hay animal.
//
// ⚠️ SPIKE VISUAL, MOCK. Una sola línea, SLIM (no roba alto al hero de escaneo). Tres zonas:
//   - Izq: botón volver/pausar (ChevronLeft) — target ≥touchMin para la mano con guante (Fitts).
//   - Centro: contexto de la jornada = nombre del RODEO (hero, bold) + cola de MANIOBRAS como chips
//     truncados ("Tacto · Pesaje · Vacunación"), con "+N" si no entran. El rodeo es lo que más importa
//     (gatea qué maniobras aplican), así que va arriba y bold; la cola va debajo en muted.
//   - Der: contador de PROGRESO de la jornada (animales procesados hoy), chip verde pálido — el
//     operario ve "cuántas llevo" sin abrir nada.
//
// Fondo $surface (bone) → CONTEXTO, distinto de la zona de acción ($bg) → figura-fondo (Gestalt),
// MISMO idiom que SpikeIdentityHeader para que las dos pantallas se sientan del mismo modo (Jakob).
//
// RECORTE DE DESCENDENTES (memoria, regla dura): el nombre del rodeo ("Cría hembras" trae j) y la cola
// ("Vacunación" trae j) llevan numberOfLines → lineHeight matching para no recortar g/q/p/j/y/ñ.
//
// Cero hardcode (ADR-023 §4): tokens; los íconos lucide cruzan a API no-Tamagui → getTokenValue.

import { Platform } from 'react-native';
import type { ReactNode } from 'react';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { ChevronLeft } from 'lucide-react-native';

import { buttonA11y } from '@/utils/a11y';

export type SpikeSessionHeaderProps = {
  /** Rodeo de la sesión (hero del contexto, bold). */
  rodeo: string;
  /** Cola de maniobras de la jornada, ya formateada ("Tacto · Pesaje · Vacunación"). */
  maniobrasLabel: string;
  /** Contador de progreso de la jornada, ej. "12 hoy" / "0 hoy". */
  progreso: string;
  /** Acción del botón izquierdo (volver/pausar). En el spike es no-op. */
  onBack?: () => void;
  /**
   * Slot opcional a la derecha del centro, ANTES del contador de progreso. En la pantalla real lo usa el
   * chip de conexión del bastón (R3.6/R3.7: el operario ve el estado de conexión de un vistazo). En el
   * spike (mock) se omite.
   */
  right?: ReactNode;
};

export function SpikeSessionHeader({ rodeo, maniobrasLabel, progreso, onBack, right }: SpikeSessionHeaderProps) {
  const navIcon = getTokenValue('$navIcon', 'size');
  const textMuted = getTokenValue('$textMuted', 'color');

  return (
    <XStack
      backgroundColor="$surface"
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderBottomColor="$divider"
      alignItems="center"
      gap="$2"
    >
      {/* Izq: volver / pausar. Target ≥touchMin (guante, Fitts). */}
      <View
        width="$touchMin"
        height="$touchMin"
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.6 }}
        onPress={onBack}
        {...buttonA11y(Platform.OS, { label: 'Volver' })}
      >
        <ChevronLeft size={navIcon} color={textMuted} strokeWidth={2.25} />
      </View>

      {/* Centro: rodeo (hero, bold) + cola de maniobras (muted). flex={1} → toma el ancho sobrante y
          trunca; NO empuja al contador de la derecha. */}
      <YStack flex={1} gap="$1" minWidth={0}>
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary" numberOfLines={1}>
          {rodeo}
        </Text>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
          {maniobrasLabel}
        </Text>
      </YStack>

      {/* Slot derecho opcional (chip de conexión del bastón, R3.6/R3.7). flexShrink={0} → no se recorta. */}
      {right ? <View flexShrink={0}>{right}</View> : null}

      {/* Der: contador de progreso (chip verde pálido). flexShrink={0} → nunca se recorta. */}
      <View
        flexShrink={0}
        backgroundColor="$greenLight"
        borderRadius="$pill"
        paddingHorizontal="$3"
        paddingVertical="$1"
      >
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$primary" numberOfLines={1}>
          {progreso}
        </Text>
      </View>
    </XStack>
  );
}
