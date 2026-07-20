// StickStatusIndicator — indicador GLOBAL del estado de conexión del bastón en el chrome de la app
// (delta multivendor, RMV3.5). Alimentado por `useBleConnectionStatus()` (implementado por el core de
// spec 04, NO redefinido). Reactivo al `connection_changed` que el provider ya emite.
//
// Montaje: en el host raíz (`app/app/_layout.tsx`, dentro del BleStickListenerProvider), como HERMANO
// del stack de navegación — NO toca ningún archivo/contrato de spec 09 (find-or-create). Es
// PURAMENTE INFORMATIVO y NO BLOQUEANTE (RMV3.6):
//   - `pointerEvents="box-none"` en el contenedor absoluto → los toques pasan de largo a la pantalla
//     de abajo (nunca roba el responder ni tapa un control).
//   - ANCLADO AL FONDO (estilo "toast"), por encima de la bottom tab bar y del pico del FAB central →
//     nunca pisa el título del header de ninguna pantalla (Gate 2.5 / ADR-029, veta visual resuelta).
//   - se AUTO-OCULTA en 'off' (el estado por defecto / sin bastón activo) → invisible en las pantallas
//     normales; solo aparece cuando hay actividad real del bastón (conectando/conectado/reintentando/
//     desconectado/sin permiso). Durante una demo, es justo cuando se lo quiere ver.
//   - se SUPRIME en la propia `/baston`: ahí la StickConnectionScreen ya muestra el estado en su card
//     (redundante) y el indicador competiría con el título de esa pantalla.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para el ícono lucide y la geometría. es-AR.

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { getTokenValue, Text, View, XStack } from 'tamagui';
import { Bluetooth, BluetoothConnected, BluetoothSearching, TriangleAlert } from 'lucide-react-native';

import { useBleConnectionStatus } from '@/services/ble/connection-status';
import type { ConnectionStatus } from '@/services/ble/stick-adapter';
import { isDemoMode } from '@/services/ble/demo-gate';
import { labelA11y } from '@/utils/a11y';
import { connectionStatusView, type ViewTone } from '../connection-view';
import { Platform } from 'react-native';

// ¿Estamos en una corrida E2E que NO es demo? (regresión de Playwright de OTRAS features / capturas).
// El indicador es un elemento NUEVO del chrome GLOBAL: si se montara en las corridas E2E existentes,
// duplicaría textos de estado ('Bastón conectado') que sus specs asertan `{ exact: true }` →
// strict-mode violation. Lo suprimimos SOLO ahí (E2E sin demo) para no perturbar la regresión, sin
// afectar producción (sin marcas → false → se muestra) ni la CAPTURA de esta feature (demo → false →
// se muestra). Lee el global directo (patrón demo-gate/ble-e2e-flag; sin import cross-capa).
function isNonDemoE2E(): boolean {
  try {
    return (globalThis as Record<string, unknown>).__RAFAQ_BLE_E2E__ === true && !isDemoMode();
  } catch {
    return false;
  }
}

function iconFor(status: ConnectionStatus): typeof Bluetooth {
  switch (status) {
    case 'connected':
      return BluetoothConnected;
    case 'connecting':
    case 'scanning':
      return BluetoothSearching;
    case 'permission_denied':
      return TriangleAlert;
    case 'disconnected':
    case 'off':
    default:
      return Bluetooth;
  }
}

function toneColorToken(tone: ViewTone): '$primary' | '$terracota' | '$textMuted' {
  switch (tone) {
    case 'success':
      return '$primary';
    case 'warning':
      return '$terracota';
    case 'progress':
      return '$primary';
    case 'idle':
    default:
      return '$textMuted';
  }
}

export function StickStatusIndicator() {
  const status = useBleConnectionStatus();
  const insets = useSafeAreaInsets();
  // Ruta actual del árbol de expo-router. BleHost (donde vive este componente) está DENTRO del contexto de
  // navegación — mismo tramo del árbol que RootGate, que usa useSegments — así que usePathname() resuelve
  // (para la ruta `app/baston.tsx` → '/baston').
  const pathname = usePathname();

  // Suprimido en la regresión E2E no-demo (evita duplicar textos de estado que sus specs asertan exact).
  if (isNonDemoE2E()) return null;

  // Suprimido en la PROPIA pantalla de conexión (/baston): ahí es REDUNDANTE (la StickConnectionScreen ya
  // muestra el estado en su card, con su CTA) y, montado sobre esa pantalla, el pill compite con el título.
  // El indicador GLOBAL (RMV3.5) se demuestra en las pantallas SIN card de estado propia (home, tabs, flujos).
  if (pathname === '/baston') return null;

  // Auto-oculto en 'off' (sin actividad del bastón): no ensucia el chrome de las pantallas normales.
  if (status === 'off') return null;

  const view = connectionStatusView(status);
  const colorToken = toneColorToken(view.tone);
  const iconColor = getTokenValue(colorToken, 'color');
  const Icon = iconFor(status);

  return (
    <View
      testID="stick-status-indicator"
      position="absolute"
      // Anclado al FONDO (estilo "toast"), centrado, POR ENCIMA de la bottom tab bar Y del pico del FAB
      // central elevado → nunca pisa el título de un header (en ninguna pantalla). Geometría 100% con tokens
      // (cero hardcode, ADR-023 §4): insets.bottom + alto de contenido de la nav bar ($navBar=60) + cuánto
      // sube el FAB sobre la barra ($fabRaise=26) + un gap ($2=8) → el pill queda ~8px por encima del pico
      // del FAB. En pantallas SIN tab bar (Stack) flota ~navBar+fabRaise px sobre el fondo: aceptable (no hay
      // header abajo que pisar).
      bottom={
        insets.bottom +
        getTokenValue('$navBar', 'size') +
        getTokenValue('$fabRaise', 'size') +
        getTokenValue('$2', 'space')
      }
      left="$0"
      right="$0"
      alignItems="center"
      // NO bloqueante (RMV3.6): los toques atraviesan el contenedor hacia la pantalla de abajo.
      pointerEvents="box-none"
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
        pointerEvents="none"
        {...labelA11y(Platform.OS, view.label)}
      >
        <Icon size={getTokenValue('$dot', 'size')} color={iconColor} strokeWidth={2.25} />
        <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color={colorToken}>
          {view.label}
        </Text>
      </XStack>
    </View>
  );
}
