// Presentación de cada estado de conexión del bastón (spec 09 chunk BLE global, RB8.2). Mapea un
// ConnectionStatus (de spec 04) a copy es-AR + ícono lucide + token de color, para el BleConnectionChip.
//
// Mismo modelo que el `statusView` del harness `baston-test.tsx` (que es self-contained y no se toca —
// regla dura del chunk). Acá vive la versión COMPARTIDA, consumida por el chip de producción. El copy se
// adapta al contexto del chip (header de la tab Animales), más corto que el del harness; el invariante
// RB8.2 es que NINGÚN estado bloquea la puerta manual (blocksManualEntry === false siempre).
//
// PURO de RN: solo tipos + datos (el ícono es un componente lucide, pero no se renderiza acá). El chip
// lee `getTokenValue(colorToken)` para colorear el ícono y usa el `colorToken` como color del texto.

import { Bluetooth, BluetoothConnected, BluetoothSearching, TriangleAlert } from 'lucide-react-native';

import type { ConnectionStatus } from '../services/ble/stick-adapter';

/** Token de color admitido para el ícono/texto del chip (subconjunto del DS). */
export type BleStatusColorToken = '$textMuted' | '$primary' | '$terracota';

export type BleConnectionView = {
  /** Copy corto del estado (es-AR), visible en el chip. */
  label: string;
  /** Ícono lucide del estado. */
  Icon: typeof Bluetooth;
  /** Token de color del DS para ícono + texto. */
  colorToken: BleStatusColorToken;
  /** ¿El estado representa una conexión activa? (para el connect/disconnect del CTA). */
  connected: boolean;
};

/**
 * Mapa de presentación del estado de conexión del bastón (RB8.2). Copy es-AR + ícono + token.
 * Ningún estado bloquea la puerta manual (manual-first): es solo presentación.
 */
export function bleConnectionView(status: ConnectionStatus): BleConnectionView {
  switch (status) {
    case 'connected':
      return { label: 'Bastón conectado', Icon: BluetoothConnected, colorToken: '$primary', connected: true };
    case 'connecting':
      return { label: 'Conectando…', Icon: BluetoothSearching, colorToken: '$primary', connected: false };
    case 'scanning':
      return { label: 'Reintentando…', Icon: BluetoothSearching, colorToken: '$terracota', connected: false };
    case 'disconnected':
      return { label: 'Bastón desconectado', Icon: Bluetooth, colorToken: '$terracota', connected: false };
    case 'permission_denied':
      return { label: 'Sin permiso', Icon: TriangleAlert, colorToken: '$terracota', connected: false };
    case 'off':
    default:
      return { label: 'Conectar bastón', Icon: Bluetooth, colorToken: '$textMuted', connected: false };
  }
}
