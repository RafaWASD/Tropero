// Estado de conexión del bastón + hook de lectura (R9.2, R9.3, R9.4). El estado lo mantiene
// el provider (un adaptador activo); este módulo provee el modelo y el hook que el chrome de
// la app y spec 09 R2.5 consumen vía useBleConnectionStatus().
//
// La forma del evento connection_changed (R9.4) la construye el contrato (buildConnectionEvent).
// useBleConnectionStatus se implementa como un selector sobre el contexto del provider
// (Preguntas abiertas #1 de requirements: a confirmar con spec 09 Fase 4 si es hook propio o
// selector; acá es un hook propio que lee el mismo estado del provider — ambos leen lo mismo,
// no bloquea).

import { createContext, useContext } from 'react';

import type { ConnectionStatus } from './stick-adapter';

/** ¿El estado representa una conexión activa con el transporte? (para isConnected) */
export function isConnectedStatus(status: ConnectionStatus): boolean {
  return status === 'connected';
}

/** ¿El estado bloquea la carga manual? NUNCA (R9.6, R7.2). Documentado como invariante. */
export function blocksManualEntry(_status: ConnectionStatus): boolean {
  return false;
}

/**
 * Contexto que el BleStickListenerProvider llena con el estado de conexión actual. Default
 * 'off' (sin provider montado / antes de conectar). Todos los estados son no bloqueantes.
 */
export const ConnectionStatusContext = createContext<ConnectionStatus>('off');

/**
 * Hook global de estado de conexión del bastón (R9.3). Lo consume el indicador del chrome y
 * spec 09 R2.5. Lee el estado del provider; sin provider montado retorna 'off' (no rompe).
 */
export function useBleConnectionStatus(): ConnectionStatus {
  return useContext(ConnectionStatusContext);
}
