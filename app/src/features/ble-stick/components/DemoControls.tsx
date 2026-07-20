// DemoControls — controles de SIMULACIÓN para demos humanas en vivo (delta multivendor, RMV4.5/4.6).
// Un botón "Simular lectura" (+ auto-play opcional) que empuja un EID sintético VÁLIDO por el
// SimulatorAdapter → el mismo contrato de ingesta (validate + dedup + confirmación pre-commit +
// feedback) que un bastón real, SIN hardware.
//
// TRIPLE-GUARD 3 (integridad SENASA, RMV4.5): este componente RE-CHEQUEA `isDemoMode()` antes de
// montarse y solo opera si el transporte activo es el simulador (`kind === 'simulator'`). En un build
// de producción `isDemoMode()` es false y el provider jamás instancia el simulador (guards 1/2) →
// este componente devuelve `null` y no hay ningún camino para emitir una lectura simulada.
//
// Las lecturas del simulador se marcan "DEMO" (RMV4.6) en la pantalla que las lista (esta pieza solo
// las DISPARA; el marcado visual lo hace la lista con `readingBadge`). Tap NATIVO vía el `<Button>`
// canónico (onPress sobre el frame Tamagui, sin `<Pressable>` envolvente). Cero hardcode (ADR-023 §4).

import { useCallback, useState } from 'react';
import { getTokenValue, Text, XStack, YStack } from 'tamagui';
import { FlaskConical } from 'lucide-react-native';

import { Button, Card } from '@/components';
import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { SimulatorAdapter } from '@/services/ble/adapter-simulator';
import { isDemoMode } from '@/services/ble/demo-gate';

export function DemoControls() {
  const api = useBleProviderApi();
  const [autoPlaying, setAutoPlaying] = useState(false);

  // Re-chequeo del gate (triple-guard 3, RMV4.5): sin modo demo, este componente no existe.
  const simulator =
    isDemoMode() && api?.transport instanceof SimulatorAdapter ? api.transport : null;

  const onSimulate = useCallback(() => {
    if (!simulator) return;
    // Aseguramos 'connected' (idempotente) para que el indicador refleje la demo, y emitimos.
    void simulator.connect().catch(() => undefined);
    simulator.emit();
  }, [simulator]);

  const onToggleAutoPlay = useCallback(() => {
    if (!simulator) return;
    if (autoPlaying) {
      simulator.stop();
      setAutoPlaying(false);
    } else {
      void simulator.connect().catch(() => undefined);
      simulator.startAutoPlay();
      setAutoPlaying(true);
    }
  }, [simulator, autoPlaying]);

  if (!simulator) return null;

  return (
    <Card gap="$3" borderWidth={1} borderColor="$primary">
      <XStack alignItems="center" gap="$2">
        <FlaskConical size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
        <YStack flex={1} minWidth={0} gap="$1">
          <XStack alignItems="center" gap="$2">
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary">
              Modo demo
            </Text>
            <XStack
              alignItems="center"
              backgroundColor="$primary"
              borderRadius="$pill"
              paddingHorizontal="$2"
              paddingVertical="$1"
            >
              <Text fontFamily="$body" fontSize="$1" lineHeight="$1" fontWeight="700" color="$white" letterSpacing={1}>
                DEMO
              </Text>
            </XStack>
          </XStack>
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
            Simulá lecturas sin bastón. Las lecturas simuladas se marcan DEMO y nunca se declaran como reales.
          </Text>
        </YStack>
      </XStack>

      <Button testID="demo-simulate" variant="primary" fullWidth onPress={onSimulate}>
        Simular lectura
      </Button>
      <Button
        testID="demo-autoplay"
        variant="secondary"
        fullWidth
        onPress={onToggleAutoPlay}
      >
        {autoPlaying ? 'Detener automático' : 'Reproducir automático'}
      </Button>
    </Card>
  );
}
