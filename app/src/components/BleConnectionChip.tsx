// BleConnectionChip — indicador mínimo del estado de conexión del bastón (spec 09 chunk BLE global,
// RB8). Vive en el header de la tab Animales. Refleja el ConnectionStatus del provider (vía
// useBleConnectionStatus) con copy es-AR + ícono, y NUNCA bloquea la puerta manual (RB8.2, manual-first):
// es puramente informativo + un atajo para conectar.
//
// Connect web-serial (RB8.3): tocar el chip cuando NO está conectado dispara `transport.connect()` con el
// gesto de usuario (web-serial: requestPort → el navegador abre el diálogo de puertos COM). Reusa el
// patrón `onConnect` del harness baston-test.tsx. Sin pantalla de pairing pulida (diferida, DEC-5). En
// native sin transporte conectable (manual-first), el chip solo muestra el estado (el tap no hace nada
// dañino — connect() de un transporte ausente es no-op).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para el ícono lucide. Voseo es-AR.

import { useCallback } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, XStack } from 'tamagui';

import { useBleConnectionStatus } from '../services/ble/connection-status';
import { useBleProviderApi } from '../services/ble/BleStickListenerProvider';
import { bleConnectionView } from './ble-connection-view';
import { buttonA11y } from '../utils/a11y';

export function BleConnectionChip() {
  const status = useBleConnectionStatus();
  const api = useBleProviderApi();
  const view = bleConnectionView(status);
  const iconColor = getTokenValue(view.colorToken, 'color');

  // Conectar requiere un GESTO DE USUARIO (este onPress lo es): web-serial rechaza requestPort sin gesto.
  // Si ya está conectado, el tap no hace nada (el chip pasa a informativo). Sin transporte (native
  // manual-first), connect() es no-op → el chip queda solo informando el estado.
  const onPress = useCallback(() => {
    if (view.connected) return;
    void api?.transport?.connect().catch(() => undefined);
  }, [api, view.connected]);

  return (
    <Pressable
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: view.label, disabled: view.connected })}
    >
      <XStack
        alignItems="center"
        gap="$2"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$divider"
        borderRadius="$pill"
        paddingHorizontal="$3"
        paddingVertical="$2"
      >
        <view.Icon size={getTokenValue('$dot', 'size')} color={iconColor} strokeWidth={2.25} />
        <Text fontFamily="$body" fontSize="$2" fontWeight="600" color={view.colorToken}>
          {view.label}
        </Text>
      </XStack>
    </Pressable>
  );
}
