// adapter-spp-android — PLACEHOLDER. RS420 nativo por Bluetooth Classic SPP
// (react-native-bluetooth-classic), cubre al cliente beta (R6, R12).
//
// ⛔ FUERA DE ESTE RUN (capa buildable-hoy). Requiere DEV BUILD + teléfono Android (Raf lo
// compra) + vetar el config plugin de react-native-bluetooth-classic con Expo SDK 56 (T4.0).
// Por eso acá NO hay implementación nativa: dejar este archivo como contrato declarado para
// que la Fase 4 lo complete detrás de la MISMA interfaz StickAdapter, sin tocar el contrato
// de ingesta ni los otros adaptadores (R11.2, R11.3).
//
// Plan completo en specs/active/04-bluetooth-baston/android-spp-impl-plan.md.
// Algoritmo: RFCOMM SPP (UUID config.SPP_UUID) → líneas ASCII → ingestRawLine (reusa
// parser-rs420) → contrato. Pairing PIN 1234, remembered-device, reconexión backoff,
// baud-independiente (R6.1, R6.5, R6.8).

import type { StickAdapter, ConnectionStatus, Unsubscribe } from './stick-adapter';

const NOT_BUILT = 'adapter-spp-android no está implementado en este run (requiere dev build + Android, Fase 4 de spec 04).';

/**
 * Placeholder de la Fase 4. NO se monta en el provider en este run (el provider solo monta
 * web-serial/mock/manual). Si se instancia y usa, falla con un mensaje claro en vez de
 * romper silenciosamente — esto NO debe ocurrir en la capa buildable-hoy.
 */
export class SppAndroidAdapter implements StickAdapter {
  readonly kind = 'spp-android' as const;

  async connect(): Promise<void> {
    throw new Error(NOT_BUILT);
  }
  async disconnect(): Promise<void> {
    throw new Error(NOT_BUILT);
  }
  onTagRead(_cb: (rawLine: string) => void): Unsubscribe {
    throw new Error(NOT_BUILT);
  }
  onStatus(_cb: (status: ConnectionStatus) => void): Unsubscribe {
    throw new Error(NOT_BUILT);
  }
  enable(): void {
    throw new Error(NOT_BUILT);
  }
  disable(): void {
    throw new Error(NOT_BUILT);
  }
}
