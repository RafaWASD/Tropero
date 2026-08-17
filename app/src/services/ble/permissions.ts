// Permisos por transporte (R12). Cada adaptador tiene un modelo de permiso distinto: el
// SPP-Android requiere permisos de app (dev build, fuera de este run); el web-serial depende
// del permiso del NAVEGADOR (gesto requestPort, R12.4); manual/mock no requieren nada; el
// HID-wedge (GATED) no requiere permisos BLE de app (R12.3).
//
// PURO (sin RN): solo describe el modelo. La solicitud real de permisos Android la hace
// adapter-spp-android (Fase 4). Un permiso denegado se refleja como estado 'permission_denied'
// con CTA, y la carga manual sigue operativa (R12.5, R7.2) — nunca bloquea.

import type { StickAdapter } from './stick-adapter';

export type PermissionModel =
  | { kind: 'none' } // manual, mock — sin permisos
  | { kind: 'browser' } // web-serial — gesto requestPort (R12.4)
  | { kind: 'android-bluetooth' } // spp-android — BLUETOOTH_CONNECT (R12.1, dev build)
  /**
   * ble-gatt — modelo PROPIO y no `android-bluetooth` (RBM2.13, delta ios-ble-mfi). Dos motivos, y
   * los dos importan:
   *   · el conjunto de Android es DISTINTO del SPP (el BLE escanea: `BLUETOOTH_SCAN` +
   *     `BLUETOOTH_CONNECT` en API ≥ 31, `ACCESS_FINE_LOCATION` en API ≤ 30 — la tabla exhaustiva
   *     está en `permissions-android.ts`);
   *   · el transporte es CROSS-PLATFORM, así que su modelo no puede llamarse "android-*": en iOS el
   *     permiso de Bluetooth no se pide con una API (no hay `request`), lo pide el SO la primera vez
   *     que se usa la radio y su denegación llega como el estado `Unauthorized` del manager.
   */
  | { kind: 'ble' }
  | { kind: 'os-keyboard' }; // hid-wedge — teclado del SO, sin permisos de app (R12.3)

/** Devuelve el modelo de permiso de un adaptador por su `kind` (R12). */
export function permissionModelFor(kind: StickAdapter['kind']): PermissionModel {
  switch (kind) {
    case 'manual':
    case 'mock':
    // Delta multivendor: el simulador (demo) no requiere permisos — es un StickAdapter puro en
    // memoria, sin transporte físico (RMV4.1). Aditivo al switch exhaustivo.
    case 'simulator':
      return { kind: 'none' };
    case 'web-serial':
      return { kind: 'browser' };
    case 'spp-android':
      return { kind: 'android-bluetooth' };
    case 'ble-gatt':
      return { kind: 'ble' };
    case 'hid-wedge':
      return { kind: 'os-keyboard' };
  }
}

/**
 * Invariante de manual-first (R12.5, R7.2): NINGÚN estado de permiso bloquea la carga manual.
 * Un permiso denegado se refleja en el indicador con CTA, pero la app sigue operativa.
 */
export function permissionDenialBlocksApp(): boolean {
  return false;
}
