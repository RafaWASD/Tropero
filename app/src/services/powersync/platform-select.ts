// Lógica PURA de selección del SDK de PowerSync por plataforma (T1.4 / R2.2).
//
// SIN imports de RN/expo/SDK: testeable con node:test. El factory real (database.ts) importa
// react-native + los paquetes del SDK y NO carga bajo node:test; acá vive solo la DECISIÓN
// (web vs native) para poder verificarla unit (mismo patrón pure-logic ↔ I/O del repo).

/** Cuál de los dos paquetes del SDK usar según Platform.OS. */
export type PowerSyncPackage = 'web' | 'native';

/**
 * Resuelve el paquete del SDK a usar: '@powersync/web' (WASM) en web, '@powersync/react-native'
 * en device (ios/android/cualquier otro). PURA (testeable): web SOLO para os === 'web'; todo lo
 * demás → native. Fail-safe: un os desconocido cae a native (el target de producción).
 */
export function pickPowerSyncPackage(os: string): PowerSyncPackage {
  return os === 'web' ? 'web' : 'native';
}
