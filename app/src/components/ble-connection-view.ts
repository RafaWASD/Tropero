// Presentación de cada estado de conexión del bastón (spec 09 chunk BLE global, RB8.2). Mapea un
// ConnectionStatus (de spec 04) a copy es-AR + CLAVE de ícono + token de color, para el BleConnectionChip.
//
// Mismo modelo que el `statusView` del harness `baston-test.tsx` (que es self-contained y no se toca —
// regla dura del chunk). Acá vive la versión COMPARTIDA, consumida por el chip de producción. El copy se
// adapta al contexto del chip (header de la tab Animales), más corto que el del harness; el invariante
// RB8.2 es que NINGÚN estado bloquea la puerta manual (blocksManualEntry === false siempre).
//
// ── DECISIÓN DE EXISTENCIA DEL CHIP (bugfix 2026-07-29, reporte de Raf en device Android) ────────────
// Esta función decide TAMBIÉN si el chip debe existir: devuelve `null` cuando NO hay transporte
// instanciado (`provider.transport == null`). Motivo: el chip es a la vez indicador Y atajo de conexión
// (RB8.3) — su tap dispara `transport.connect()`. Sin transporte ese tap es un no-op, así que el chip
// prometía una acción que no podía cumplir (y contradecía a su propia pantalla, que dos elementos más
// abajo dice "El bastón no está disponible en este dispositivo"). Sin transporte no hay ningún estado
// de conexión que reportar —el único alcanzable es 'off', invariante para toda la vida del proceso—,
// así que el chip no informa nada: es ruido permanente en el header de una tab. Se oculta.
//
// La condición es "NO HAY TRANSPORTE", **no** "es Android": cuando la Fase 4 construya el adapter SPP,
// `instantiateTransport` devolverá un StickAdapter y el chip vuelve solo, sin tocar este archivo.
// Mismo criterio (transport != null) que ya usaban `maniobra/identificar` y `TagScanSheet` vía
// `resolveListenConnState`. En WEB el transporte SIEMPRE existe (web-serial) → nada cambia ahí.
//
// PURO: solo tipos + datos, e imports SOLO de tipos (erasados) y por ruta relativa — igual que
// `features/ble-stick/connection-view.ts`. Es lo que lo hace testeable en node:test: importar
// `lucide-react-native` en runtime rompe el loader (su barrel ESM no carga fuera de Metro), así que el
// ícono viaja como CLAVE y el componente la mapea al componente lucide (mismo patrón que el
// `statusIcon()` de StickConnectionScreen y el `iconFor()` de StickStatusIndicator).

import type { ConnectionStatus } from '../services/ble/stick-adapter';

/** Token de color admitido para el ícono/texto del chip (subconjunto del DS). */
export type BleStatusColorToken = '$textMuted' | '$primary' | '$terracota';

/** Clave del ícono del estado. El componente la mapea al ícono lucide (ver CHIP_ICONS en el chip). */
export type BleStatusIcon = 'bluetooth' | 'bluetooth-connected' | 'bluetooth-searching' | 'alert';

export type BleConnectionView = {
  /** Copy corto del estado (es-AR), visible en el chip. */
  label: string;
  /** Clave del ícono del estado (el componente resuelve el componente lucide). */
  icon: BleStatusIcon;
  /** Token de color del DS para ícono + texto. */
  colorToken: BleStatusColorToken;
  /** ¿El estado representa una conexión activa? (para el connect/disconnect del CTA). */
  connected: boolean;
};

/** Entorno del transporte que el chip necesita para decidir si existe. */
export type BleConnectionEnv = {
  /**
   * ¿Hay un transporte INSTANCIADO? (`provider.transport != null`). false en native manual-first (no
   * hay adapter construido todavía) → el chip no se renderiza. Parámetro OBLIGATORIO a propósito: un
   * call site nuevo tiene que decidirlo explícitamente, no heredar un default optimista.
   */
  hasTransport: boolean;
};

/**
 * Mapa de presentación del estado de conexión del bastón (RB8.2). Copy es-AR + ícono + token.
 * Ningún estado bloquea la puerta manual (manual-first): es solo presentación.
 *
 * Devuelve `null` cuando NO hay transporte → el chip NO se renderiza (ver cabecera). Es un corte
 * ANTES del switch, no un caso más: sin transporte ningún estado puede ofrecer conectar, ni siquiera
 * el transitorio 'connected'/'disconnected' que quedaría si el transporte se desmontara en caliente
 * (cambio de `mode` del provider).
 */
export function bleConnectionView(
  status: ConnectionStatus,
  env: BleConnectionEnv,
): BleConnectionView | null {
  if (!env.hasTransport) return null;

  switch (status) {
    case 'connected':
      return { label: 'Bastón conectado', icon: 'bluetooth-connected', colorToken: '$primary', connected: true };
    case 'connecting':
      return { label: 'Conectando…', icon: 'bluetooth-searching', colorToken: '$primary', connected: false };
    case 'scanning':
      return { label: 'Reintentando…', icon: 'bluetooth-searching', colorToken: '$terracota', connected: false };
    case 'disconnected':
      return { label: 'Bastón desconectado', icon: 'bluetooth', colorToken: '$terracota', connected: false };
    case 'permission_denied':
      return { label: 'Sin permiso', icon: 'alert', colorToken: '$terracota', connected: false };
    case 'off':
    default:
      return { label: 'Conectar bastón', icon: 'bluetooth', colorToken: '$textMuted', connected: false };
  }
}
