// BleConnectionChip — indicador mínimo del estado de conexión del bastón (spec 09 chunk BLE global,
// RB8). Vive en el header de la tab Animales (y en el de `maniobra/identificar`). Refleja el
// ConnectionStatus del provider (vía useBleConnectionStatus) con copy es-AR + ícono, y NUNCA bloquea la
// puerta manual (RB8.2, manual-first): es puramente informativo + un atajo para conectar.
//
// Connect web-serial (RB8.3): tocar el chip cuando NO está conectado dispara `transport.connect()` con el
// gesto de usuario (web-serial: requestPort → el navegador abre el diálogo de puertos COM). Reusa el
// patrón `onConnect` del harness baston-test.tsx. Sin pantalla de pairing pulida (diferida, DEC-5).
//
// ── SIN TRANSPORTE, EL CHIP NO EXISTE (bugfix 2026-07-29, reporte de Raf en device Android) ──────────
// Antes, en native manual-first (no hay adapter de transporte construido: `provider.transport == null`),
// el chip se renderizaba igual, decía "Conectar bastón" y su tap era un no-op silencioso —una promesa
// que no podía cumplir— mientras el hero de la misma pantalla decía "El bastón no está disponible en
// este dispositivo". Ahora la decisión la toma la función PURA `bleConnectionView`, que devuelve `null`
// sin transporte → este componente no renderiza nada. La condición es "no hay transporte", NO "es
// Android": cuando la Fase 4 construya el adapter SPP, el chip vuelve solo sin tocar este archivo.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para el ícono lucide. Voseo es-AR.

import { useCallback } from 'react';
import { Platform, Pressable } from 'react-native';
import { getTokenValue, Text, XStack } from 'tamagui';
import { Bluetooth, BluetoothConnected, BluetoothSearching, TriangleAlert } from 'lucide-react-native';

import { useBleConnectionStatus } from '../services/ble/connection-status';
import { useBleProviderApi } from '../services/ble/BleStickListenerProvider';
import { bleConnectionView, type BleStatusIcon } from './ble-connection-view';
import { buttonA11y } from '../utils/a11y';

// La vista pura viaja con una CLAVE de ícono (para poder testearla en node:test sin cargar lucide,
// cuyo barrel ESM no resuelve fuera de Metro); acá se resuelve al componente. Mismo patrón que el
// `statusIcon()` de StickConnectionScreen y el `iconFor()` de StickStatusIndicator.
const CHIP_ICONS: Record<BleStatusIcon, typeof Bluetooth> = {
  bluetooth: Bluetooth,
  'bluetooth-connected': BluetoothConnected,
  'bluetooth-searching': BluetoothSearching,
  alert: TriangleAlert,
};

export function BleConnectionChip() {
  const status = useBleConnectionStatus();
  const api = useBleProviderApi();
  const transport = api?.transport ?? null;
  const view = bleConnectionView(status, { hasTransport: transport != null });
  const connected = view?.connected ?? false;

  // Conectar requiere un GESTO DE USUARIO (este onPress lo es): web-serial rechaza requestPort sin gesto.
  // Si ya está conectado, el tap no hace nada (el chip pasa a informativo). El caso "sin transporte" ya
  // NO llega acá: sin transporte el chip no se renderiza (view === null), así que este handler nunca
  // dispara un connect() que sería no-op. El guard `?.` queda como defensa (el transporte podría
  // desmontarse entre el render y el tap), no como el camino esperado.
  const onPress = useCallback(() => {
    if (connected) return;
    void transport?.connect().catch(() => undefined);
  }, [transport, connected]);

  // Sin transporte instanciado no hay nada que conectar ni ningún estado que reportar → sin chip.
  if (view === null) return null;

  const iconColor = getTokenValue(view.colorToken, 'color');
  const Icon = CHIP_ICONS[view.icon];

  return (
    <Pressable
      testID="ble-connection-chip"
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
        <Icon size={getTokenValue('$dot', 'size')} color={iconColor} strokeWidth={2.25} />
        <Text fontFamily="$body" fontSize="$2" fontWeight="600" color={view.colorToken}>
          {view.label}
        </Text>
      </XStack>
    </Pressable>
  );
}
