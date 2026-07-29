// Permisos Bluetooth de Android en RUNTIME (R12.1, RMV5.8). La parte que DECIDE (qué permisos
// hace falta pedir en cada nivel de API, y cómo se lee el resultado) es PURA y se testea bajo
// node:test; la que TOCA RN (`PermissionsAndroid`) va detrás de un require PEREZOSO, igual que en
// `adapter-spp-android.ts`, para que este módulo se importe en web/CI sin RN.
//
// Qué se pide y por qué:
//   - API ≥ 31 (Android 12+): `BLUETOOTH_CONNECT`. Es el permiso que exigen las TRES llamadas del
//     camino del bastón: `getBondedDevices()` (lista de emparejados), `createRfcommSocketToService
//     Record()` + `connect()` (abrir el SPP) y `ACTION_REQUEST_ENABLE` (prender el BT). Sin él, el
//     nativo tira SecurityException.
//   - API ≤ 30: NINGUNO en runtime. `BLUETOOTH` / `BLUETOOTH_ADMIN` son permisos NORMALES: se
//     conceden al instalar y no se piden con diálogo.
//   - `BLUETOOTH_SCAN` / `ACCESS_FINE_LOCATION`: NO se piden. Solo hacen falta para el DESCUBRIMIENTO
//     (`startDiscovery`), y este camino NO descubre: lista los devices ya emparejados en el sistema
//     (el RS420 se empareja una vez desde los ajustes de Android con el PIN 1234). Pedir un permiso
//     que no se usa es ruido para el operario y una declaración de más en la ficha de Play.
//
// Manual-first (R7.2/R12.5): un permiso denegado NO bloquea nada. El adapter lo refleja como
// 'permission_denied' (estado con CTA de reintento) y la carga manual sigue operativa.

/** Nivel de API en el que Android reemplaza el modelo viejo por BLUETOOTH_CONNECT/SCAN (Android 12). */
export const ANDROID_API_BLUETOOTH_RUNTIME = 31;

/** Permiso de runtime para hablar con un device Classic ya emparejado (Android 12+). */
export const PERMISSION_BLUETOOTH_CONNECT = 'android.permission.BLUETOOTH_CONNECT';

/** Resultado de la gestión de permisos, en el vocabulario del adapter. */
export type BluetoothPermissionOutcome = 'granted' | 'denied' | 'unavailable';

/**
 * Qué permisos de RUNTIME hay que pedir en este nivel de API (PURA). Lista vacía = no hay que pedir
 * nada (Android ≤ 11: los permisos Bluetooth viejos son de instalación).
 */
export function androidBluetoothPermissionsFor(apiLevel: number): string[] {
  if (!Number.isFinite(apiLevel)) return [];
  return apiLevel >= ANDROID_API_BLUETOOTH_RUNTIME ? [PERMISSION_BLUETOOTH_CONNECT] : [];
}

/**
 * Lee el mapa de resultados de `PermissionsAndroid.requestMultiple` (PURA). 'granted' solo si TODOS
 * los permisos requeridos salieron concedidos; cualquier otra cosa ('denied', 'never_ask_again',
 * ausente) es denegación. Fail-closed a propósito: un resultado desconocido NO se interpreta como sí.
 */
export function classifyPermissionResults(
  required: string[],
  results: Record<string, string> | null | undefined,
): 'granted' | 'denied' {
  if (required.length === 0) return 'granted';
  if (results == null) return 'denied';
  return required.every((p) => results[p] === 'granted') ? 'granted' : 'denied';
}

/**
 * Pide (si hace falta) los permisos Bluetooth de runtime. Require PEREZOSO de RN: en web/CI, donde
 * `react-native` no resuelve o `PermissionsAndroid` no existe, devuelve 'unavailable' sin tirar.
 * Fuera de Android devuelve 'granted' (no hay modelo de permisos de app que aplicar acá).
 */
export async function ensureAndroidBluetoothPermissions(): Promise<BluetoothPermissionOutcome> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform, PermissionsAndroid } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return 'granted';

    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    const required = androidBluetoothPermissionsFor(apiLevel);
    if (required.length === 0) return 'granted';

    if (PermissionsAndroid == null || typeof PermissionsAndroid.requestMultiple !== 'function') {
      return 'unavailable';
    }
    const results = (await PermissionsAndroid.requestMultiple(
      required as Parameters<typeof PermissionsAndroid.requestMultiple>[0],
    )) as unknown as Record<string, string>;
    return classifyPermissionResults(required, results);
  } catch {
    // Sin RN (web/CI) o falla del puente: no se puede pedir permiso. No tira — el adapter lo
    // refleja como 'disconnected' y la carga manual sigue disponible (R7).
    return 'unavailable';
  }
}
