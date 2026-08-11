// RootErrorBoundary — ErrorBoundary RAÍZ es-AR (feature 17, R2.x).
//
// Va DENTRO de TamaguiProvider (el fallback usa el design system) y por ENCIMA de TODOS los data providers
// (Auth/PowerSync/Profile/Establishment/Rodeo) → captura un throw de RENDER de cualquiera (R2.1). Sin
// error: passthrough puro (R2.4) — NO altera el boot/splash/gating. Con error: fallback "Algo salió mal" +
// "Reintentar" (R2.2/R2.3) y reporte best-effort a Sentry con `mechanism: RootErrorBoundary` (R2.5),
// respetando el no-op de web/E2E (R1.3, el wrapper platform-split de sentry es no-op ahí).
//
// El `DiagnosticErrorBoundary` preexistente (temporal, bring-up nativo, FUERA de Tamagui) NO se toca: su
// limpieza es del cierre de bring-up nativo, fuera de scope.

import React, { useState, type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, YStack } from 'tamagui';

import { Button } from '@/components';
import { isDevCrashEnabled } from '@/utils/dev-crash-gate';
import { captureExceptionSafe } from '@/services/observability/sentry';

/**
 * Fallback presentacional es-AR (R2.2). Exportado para que el spike de captura (Gate 2.5) muestre EL MISMO
 * componente que producción sin fabricar un crash real. Título con `lineHeight="$8"` matcheando el
 * `fontSize="$8"` — "Algo salió mal" tiene DESCENDENTE (la `g`) y Tamagui no aplica el lineHeight del token
 * con `fontSize` suelto → sin esto la `g` se recorta (regla de clase del repo).
 */
export function RootErrorBoundaryFallback({ onRetry }: { onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <YStack
      flex={1}
      width="100%"
      backgroundColor="$bg"
      paddingTop={insets.top}
      paddingBottom={insets.bottom}
      paddingHorizontal="$5"
      alignItems="center"
      justifyContent="center"
      gap="$5"
    >
      <YStack gap="$3" alignItems="center" maxWidth={360}>
        <Text
          fontFamily="$body"
          fontSize="$8"
          lineHeight="$8"
          fontWeight="700"
          color="$textPrimary"
          textAlign="center"
        >
          Algo salió mal
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="400"
          color="$textMuted"
          textAlign="center"
        >
          Se produjo un error inesperado. Podés reintentar; si vuelve a pasar, cerrá y volvé a abrir la app.
        </Text>
      </YStack>
      <YStack width="100%" maxWidth={360}>
        <Button variant="primary" fullWidth onPress={onRetry}>
          Reintentar
        </Button>
      </YStack>
    </YStack>
  );
}

/**
 * Acción "crash de prueba" DEV-ONLY (R2.6): visible SOLO en un bundle de desarrollo (`__DEV__`) Y con
 * ambiente `development` — las dos llaves. Un pequeño chip que, al tocarse, lanza un error de RENDER → lo
 * atrapa este mismo boundary → fallback + captureException. Valida el pipeline ErrorBoundary → Sentry.
 * NUNCA en preview/producción ni en E2E, y nunca en un binario release (aunque le falte `EXPO_PUBLIC_ENV`).
 * La decisión —las dos llaves— vive en `@/utils/dev-crash-gate` (`isDevCrashEnabled()`), fuera de este
 * .tsx, para que sea testeable por comportamiento; este componente NO la re-implementa (ni entera ni a
 * medias). Así no le aparece a los testers (el APK `preview` y TestFlight son ambiente `preview`) ni
 * interfiere con los ~70 specs de regresión (que corren en env 'e2e').
 * Vive DENTRO del boundary (sibling de children) para que su throw sea capturado. Al reintentar, remonta con
 * `armed=false` (no loopea).
 */
function DevCrashTrigger() {
  const [armed, setArmed] = useState(false);
  if (armed) {
    throw new Error('Crash de prueba (RootErrorBoundary → Sentry)');
  }
  // Chip flotante arriba-IZQUIERDA (el indicador del bastón vive arriba-derecha → sin colisión). Posición
  // por TOKENS (no `insets.top` → fuera del radar del guard de bandas; no hay overlay fuera de development:
  // el trigger no se monta en preview/producción/E2E). Tap directo en la pieza Tamagui (regla del repo:
  // onPress + a11y en el mismo componente, no un Pressable de RN envolviéndolo).
  return (
    <YStack
      position="absolute"
      top="$10"
      left="$3"
      zIndex={100}
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$2"
      paddingVertical="$1"
      opacity={0.6}
      pressStyle={{ opacity: 1 }}
      onPress={() => setArmed(true)}
      accessibilityRole="button"
      accessibilityLabel="Crash de prueba (dev)"
    >
      <Text fontFamily="$body" fontSize="$1" fontWeight="500" color="$textMuted">
        crash
      </Text>
    </YStack>
  );
}

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  hasError: boolean;
}

export class RootErrorBoundary extends React.Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    // R2.5 — reporte best-effort (no-op en web/E2E por el wrapper platform-split). El `mechanism` distingue
    // este boundary del eco que `captureConsole` sube del console.error que React emite del mismo crash.
    captureExceptionSafe(error, { mechanism: 'RootErrorBoundary' });
  }

  reset(): void {
    // R2.3 — resetea el boundary y re-monta el árbol (children remontan limpios).
    this.setState({ hasError: false });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <RootErrorBoundaryFallback onRetry={this.reset} />;
    }
    // R2.4 — passthrough sin error. El trigger dev-only va como sibling DENTRO del boundary.
    return (
      <>
        {this.props.children}
        {isDevCrashEnabled() ? <DevCrashTrigger /> : null}
      </>
    );
  }
}
