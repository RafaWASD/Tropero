// Skeleton — placeholder de carga pulsante (polish U6b, docs/plan-mejoras-2026-07-20.md). Primitivo
// reutilizable + presets que ESPEJAN los componentes reales (AnimalRow / GroupSummaryCard / LoteCard),
// para la PRIMERA carga sin datos (loading && data===null) — nunca en refresh (convención
// docs/conventions.md §UI-actualización-optimista).
//
// ANIMACIÓN = PULSE de opacidad (NO shimmer de gradiente): un `useSharedValue` + `withRepeat` de
// Reanimated anima la opacity del bloque entre ~0.5 y ~1.0 (easing inOut ease, período ~1100ms).
// Razón: idéntico en web/nativo (un gradient-mask rompe en nativo), barato en gama baja, y reduce-motion
// trivial. Molde de Reanimated tomado de app/maniobra/_components/ManeuverReorderList.tsx.
//
// PULSO SINCRONIZADO: cada bloque llama a `useSkeletonPulse()` (mismo config, misma fase al montar juntos)
// → todos los bloques de una pantalla pulsan al unísono sin tironear. Reduce-motion (AccessibilityInfo):
// si está activo, opacity FIJA ~0.7 (sin animar).
//
// CERO tokens nuevos (ADR-023 §4): el bloque usa `backgroundColor="$divider"` (ya existe) y anima SOLO la
// opacity → no toca el design system. Radios/spacing por token; width/height son geometría libre.

import { useEffect, useState } from 'react';
import { AccessibilityInfo, type DimensionValue } from 'react-native';
import { View, XStack, YStack, getTokenValue } from 'tamagui';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Card } from './Card';

// ─── Pulso compartido ───────────────────────────────────────────────────────────

// Extremos de opacidad del pulso + duración del medio-ciclo (ida). withRepeat(reverse) → período ≈ 2×.
const PULSE_MIN = 0.5;
const PULSE_MAX = 1;
const PULSE_HALF_MS = 550; // medio-ciclo → pulso completo ≈ 1100ms (objetivo 1000-1200ms)
// Opacidad FIJA cuando reduce-motion está activo (sin animar). También es el valor inicial (evita un
// flash al valor bajo antes de que arranque la animación).
const REDUCED_OPACITY = 0.7;

/**
 * Shared value de opacidad que PULSA en loop (0.5↔1.0, easing inOut). Reduce-motion → queda FIJO en 0.7.
 * Cada bloque lo llama por separado, pero al montar juntos con el mismo config arrancan EN FASE → los
 * skeletons de una pantalla pulsan al unísono. Cancela la animación al desmontar.
 */
export function useSkeletonPulse(): SharedValue<number> {
  const opacity = useSharedValue(REDUCED_OPACITY);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Preferencia del sistema (accesibilidad). Defensivo: en algún entorno de test la API puede faltar —
  // el `?.()` guarda la LLAMADA, pero no el `.then` posterior, así que resolvemos a una variable y
  // chequeamos que sea un thenable antes de encadenar (si no, arrancamos animando = default sensato).
  useEffect(() => {
    let mounted = true;
    const query = AccessibilityInfo.isReduceMotionEnabled?.();
    if (query && typeof query.then === 'function') {
      query
        .then((enabled) => {
          if (mounted) setReduceMotion(enabled);
        })
        .catch(() => {});
    }
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => {
      if (mounted) setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    cancelAnimation(opacity);
    if (reduceMotion) {
      opacity.value = REDUCED_OPACITY;
      return;
    }
    opacity.value = PULSE_MIN;
    opacity.value = withRepeat(
      withTiming(PULSE_MAX, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [reduceMotion, opacity]);

  return opacity;
}

// ─── Primitivos ───────────────────────────────────────────────────────────────

export type SkeletonProps = {
  /** Ancho del bloque. Número (px) o '%'. Default '100%'. */
  width?: DimensionValue;
  /** Alto del bloque. Número (px) o '%'. Default 12. */
  height?: DimensionValue;
  /** Radio del bloque: token ('$2'/'$3'/'$pill') o número. Default '$2'. */
  radius?: React.ComponentProps<typeof View>['borderRadius'];
};

/**
 * Bloque base pulsante. La opacity la anima el `Animated.View` (Reanimated); el fondo $divider + el radio
 * van en un `View` de Tamagui que llena el bloque (token-native, sin hardcode). El sizing (width/height)
 * vive en el `Animated.View` para que los '%' resuelvan contra el contenedor de forma determinista.
 */
export function Skeleton({ width = '100%', height = 12, radius = '$2' }: SkeletonProps) {
  const opacity = useSkeletonPulse();
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[{ width, height }, animatedStyle]}>
      <View flex={1} borderRadius={radius} backgroundColor="$divider" />
    </Animated.View>
  );
}

/** Atajo circular (radio pill). Ej. avatares / halos de ícono. */
export function SkeletonCircle({ size }: { size: DimensionValue }) {
  return <Skeleton width={size} height={size} radius="$pill" />;
}

// Alto de una línea de texto del SkeletonText (geometría libre, no un token de spacing).
const TEXT_LINE_HEIGHT = 13;

export type SkeletonTextProps = {
  /** Cantidad de líneas apiladas. Default 2. */
  lines?: number;
  /** Ancho de las líneas (salvo la última). Default '100%'. */
  width?: DimensionValue;
  /** Ancho de la ÚLTIMA línea (más corta, imita el fin de párrafo). Default '60%'. Solo con lines>1. */
  lastLineWidth?: DimensionValue;
};

/** N líneas apiladas (gap $2), la última más corta. */
export function SkeletonText({ lines = 2, width = '100%', lastLineWidth = '60%' }: SkeletonTextProps) {
  return (
    <YStack width="100%" gap="$2">
      {Array.from({ length: lines }).map((_, i) => {
        const isLast = i === lines - 1;
        return (
          <Skeleton
            key={i}
            width={isLast && lines > 1 ? lastLineWidth : width}
            height={TEXT_LINE_HEIGHT}
            radius="$2"
          />
        );
      })}
    </YStack>
  );
}

// ─── Presets que espejan componentes reales ─────────────────────────────────────
// Espejan las DIMENSIONES reales por token ($animalRow / $icon / $touchMin / $card / $chipMin). Los altos
// de línea (18/13) son geometría que imita los fontSize $6/$3 (no hay token de spacing equivalente).

/**
 * Espeja `AnimalRow` (src/components/AnimalRow.tsx, vista normal): alto $animalRow (72) + paddingHorizontal
 * $4 + gap $3 → avatar $icon (48) + hero + subtítulo + bloque chico a la derecha, con divider inferior.
 */
export function AnimalRowSkeleton() {
  const icon = getTokenValue('$icon', 'size'); // 48 — mismo avatar que AnimalRow
  return (
    <XStack
      width="100%"
      minHeight="$animalRow"
      alignItems="center"
      gap="$3"
      paddingHorizontal="$4"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderBottomColor="$divider"
    >
      <SkeletonCircle size={icon} />
      <YStack flex={1} minWidth={0} gap="$2">
        {/* Hero (identificador, fontSize $6=18) ancho; subtítulo (fontSize $3=13) más corto. */}
        <Skeleton width="55%" height={18} radius="$2" />
        <Skeleton width="35%" height={13} radius="$2" />
      </YStack>
      {/* Chevron / chip "Sin electrónica" a la derecha. */}
      <Skeleton width={20} height={20} radius="$2" />
    </XStack>
  );
}

/**
 * Espeja `GroupSummaryCard` (src/components/GroupSummaryCard.tsx): alto $touchMin (56) + borde 2px $divider
 * + radio $card → círculo $icon (48) + dos líneas + chevron. Cards de "Mis rodeos"/"Lotes" en la home.
 */
export function GroupSummaryCardSkeleton() {
  const icon = getTokenValue('$icon', 'size'); // 48
  return (
    <XStack
      width="100%"
      alignItems="center"
      gap="$3"
      minHeight="$touchMin"
      borderRadius="$card"
      borderWidth={2}
      borderColor="$divider"
      backgroundColor="$white"
      paddingHorizontal="$4"
      paddingVertical="$3"
    >
      <SkeletonCircle size={icon} />
      <YStack flex={1} minWidth={0}>
        <SkeletonText lines={2} width="60%" lastLineWidth="40%" />
      </YStack>
      <Skeleton width={20} height={20} radius="$2" />
    </XStack>
  );
}

/**
 * Espeja `LoteCard` (app/lotes.tsx) en su forma colapsada: `Card` ($surface, radio $card, padding $4) →
 * círculo 28 + línea de título (fontSize $6) + chevron. Solo la cabecera (el skeleton no muestra acciones).
 */
export function LoteCardSkeleton() {
  return (
    <Card gap="$3">
      <XStack alignItems="center" gap="$2" minHeight="$chipMin">
        <SkeletonCircle size={28} />
        <Skeleton width="55%" height={18} radius="$2" />
        <View flex={1} />
        <Skeleton width={20} height={20} radius="$2" />
      </XStack>
    </Card>
  );
}
