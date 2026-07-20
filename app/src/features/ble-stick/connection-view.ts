// connection-view — presentación PURA de la pantalla de conexión del bastón (delta multivendor,
// RMV3.4/3.7/3.8/4.6). Sin React, sin RN, sin I/O → testeable en node:test (mismo patrón que el
// `statusView` de `baston-test.tsx`, pero EXTRAÍDO como módulo puro para trazabilidad).
//
// Mapea:
//   - `ConnectionStatus` (del core) → { label, hint, cta } es-AR de cada estado de conexión (RMV3.4).
//   - un `ReaderBinding` / driver resuelto → el estado de fila de un device descubierto (RMV3.7/3.8).
//   - una lectura del simulador → la marca visual "DEMO" (integridad SENASA, RMV4.6).
//
// Todos los estados son NO bloqueantes (RMV3.6): la carga manual sigue disponible siempre. Ningún
// mapeo acá gatea nada; es solo copy + tono + qué hace el CTA. Imports SOLO de tipos (erasados) y por
// ruta relativa (el `@/` alias no lo resuelve el loader de node:test — patrón de las suites ble).

import type { ConnectionStatus } from '../../services/ble/stick-adapter';
import type { ReaderBinding } from '../../services/ble/selection-priority';
import type { ReaderDriver } from '../../services/ble/driver-types';

/** Qué acción dispara el CTA primario de un estado. 'none' = en progreso / auto-reintento (sin CTA). */
export type ConnectionCta = 'connect' | 'retry' | 'disconnect' | 'none';

/** Tono visual de un estado/fila (el componente lo mapea a token de color). */
export type ViewTone = 'idle' | 'progress' | 'success' | 'warning';

export interface ConnectionStatusView {
  /** Copy corto del estado (es-AR, voseo). */
  label: string;
  /** Sub-copy accionable (es-AR). Nunca un stack trace ni jerga técnica. */
  hint: string;
  /** Qué hace el CTA primario. 'none' → sin CTA (conectando / reintentando solo). */
  cta: ConnectionCta;
  /** Texto del CTA (null si `cta === 'none'`). */
  ctaLabel: string | null;
  /** ¿El estado representa una conexión activa? (para el connect/disconnect del CTA). */
  connected: boolean;
  tone: ViewTone;
}

/**
 * Presentación de cada `ConnectionStatus` del core (RMV3.4). es-AR, voseo, sin jerga. Ningún estado
 * bloquea la carga manual (RMV3.6): el CTA solo ofrece conectar/reintentar/desconectar. Exhaustivo
 * sobre la unión de `ConnectionStatus` (el `default` cubre 'off' y cualquier extensión futura).
 */
export function connectionStatusView(status: ConnectionStatus): ConnectionStatusView {
  switch (status) {
    case 'connected':
      return {
        label: 'Bastón conectado',
        hint: 'Bastoneá un animal: la lectura entra sola, sin tocar la pantalla.',
        cta: 'disconnect',
        ctaLabel: 'Desconectar',
        connected: true,
        tone: 'success',
      };
    case 'connecting':
      return {
        label: 'Conectando…',
        hint: 'Estamos abriendo la conexión con el bastón.',
        cta: 'none',
        ctaLabel: null,
        connected: false,
        tone: 'progress',
      };
    case 'scanning':
      return {
        label: 'Reintentando…',
        hint: 'Se perdió la conexión; reintentando. La carga manual sigue disponible.',
        cta: 'none',
        ctaLabel: null,
        connected: false,
        tone: 'warning',
      };
    case 'disconnected':
      return {
        label: 'Bastón desconectado',
        hint: 'Se apagó, quedó fuera de rango o cancelaste. Volvé a conectar cuando quieras.',
        cta: 'connect',
        ctaLabel: 'Volver a conectar',
        connected: false,
        tone: 'warning',
      };
    case 'permission_denied':
      return {
        label: 'Sin permiso',
        hint: 'Falta el permiso de Bluetooth (o este equipo no soporta el bastón). Revisalo y reintentá.',
        cta: 'retry',
        ctaLabel: 'Reintentar',
        connected: false,
        tone: 'warning',
      };
    case 'off':
    default:
      return {
        label: 'Bastón sin conectar',
        hint: 'Conectá el bastón para leer caravanas sin tocar la pantalla. También podés cargar a mano.',
        cta: 'connect',
        ctaLabel: 'Conectar bastón',
        connected: false,
        tone: 'idle',
      };
  }
}

/** Estado de la fila de un device descubierto en la pantalla (RMV3.7/3.8). */
export type DeviceRowState =
  | 'recognized-available' // driver reconocido + adapter construido en este build → conectable
  | 'recognized-unavailable' // driver reconocido pero el adapter NO está construido todavía (RMV3.7)
  | 'recognized-unreachable' // driver reconocido pero sin transporte alcanzable en esta plataforma (RMV2.5)
  | 'unrecognized'; // ningún driver matchea el device (RMV3.8)

export interface DeviceRowView {
  state: DeviceRowState;
  /** Nombre a mostrar (marca del driver reconocido, o el nombre crudo del device desconocido). */
  title: string;
  /** Sub-copy es-AR del estado de la fila. Siempre ofrece la salida manual cuando no es conectable. */
  subtitle: string;
  /** ¿La fila es accionable (tocar → intentar conectar)? SOLO cuando es 'recognized-available'. */
  actionable: boolean;
  tone: ViewTone;
}

/**
 * Estado de fila de un device descubierto (RMV3.7/3.8). Precedencia:
 *   1. hay `binding` → reconocido + hay transporte con adapter mapeado en la plataforma:
 *        · `binding.available` true  → conectable (RMV3.7).
 *        · `binding.available` false → reconocido pero el adapter no está construido en este build
 *          → NO se intenta conectar (RMV3.7); carga manual como salida.
 *   2. sin binding pero con `driver` → reconocido pero sin transporte alcanzable en esta plataforma
 *      (ej. RS420 en iOS: declara solo spp+serial, ninguno mapeado → manual, RMV2.5).
 *   3. sin driver → NO reconocido (RMV3.8): ningún driver matchea → carga manual como piso.
 * NUNCA bloquea (RMV3.6): salvo el caso conectable, la fila apunta a la carga manual.
 */
export function deviceRowView(input: {
  driver: ReaderDriver | null;
  binding: ReaderBinding | null;
  deviceName?: string;
}): DeviceRowView {
  const { driver, binding, deviceName } = input;

  if (binding !== null) {
    if (binding.available) {
      return {
        state: 'recognized-available',
        title: binding.driver.displayName,
        subtitle: 'Reconocido. Tocá para conectar.',
        actionable: true,
        tone: 'success',
      };
    }
    return {
      state: 'recognized-unavailable',
      title: binding.driver.displayName,
      subtitle: 'Reconocido, todavía no disponible en esta versión. Cargá la caravana a mano.',
      actionable: false,
      tone: 'idle',
    };
  }

  if (driver !== null) {
    return {
      state: 'recognized-unreachable',
      title: driver.displayName,
      subtitle: 'Reconocido, pero no se conecta en este dispositivo. Cargá la caravana a mano.',
      actionable: false,
      tone: 'idle',
    };
  }

  const trimmed = deviceName?.trim();
  return {
    state: 'unrecognized',
    title: trimmed && trimmed.length > 0 ? trimmed : 'Dispositivo desconocido',
    subtitle: 'No reconocido. Podés cargar la caravana a mano.',
    actionable: false,
    tone: 'warning',
  };
}

/**
 * Marca visual de una lectura del SIMULADOR (RMV4.6, integridad SENASA): las lecturas del bastón
 * simulado se muestran con el badge "DEMO" en la confirmación y en la lista; una lectura real → sin
 * badge. Puro: el componente decide `isFromSimulator = transport.kind === 'simulator'` y renderiza.
 */
export function readingBadge(isFromSimulator: boolean): 'DEMO' | null {
  return isFromSimulator ? 'DEMO' : null;
}
