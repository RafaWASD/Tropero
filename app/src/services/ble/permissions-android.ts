// Permisos Bluetooth de Android en RUNTIME (R12.1, RMV5.8, RBM2.13). La parte que DECIDE (qué
// permisos hace falta pedir en cada nivel de API **y para cada transporte**, y cómo se lee el
// resultado) es PURA y se testea bajo node:test; la que TOCA RN (`PermissionsAndroid`) va detrás de
// un require PEREZOSO, igual que en `adapter-spp-android.ts`, para que este módulo se importe en
// web/CI sin RN.
//
// ── POR QUÉ LA TABLA ES POR TRANSPORTE Y NO SOLO POR NIVEL DE API (RBM2.13) ────────────────────────
// Hasta el delta `ios-ble-mfi` había UN solo transporte con permisos (`spp`), así que "los permisos
// del bastón" y "los permisos del SPP" eran lo mismo y la función solo miraba el nivel de API. Con el
// transporte `ble-gatt` dejan de coincidir: el SPP **no descubre** (lista los emparejados del
// sistema) y el BLE **escanea**, que es justo el camino que exige `BLUETOOTH_SCAN` en Android 12+ y
// `ACCESS_FINE_LOCATION` en Android ≤ 11. Un conjunto único sería incorrecto para los dos a la vez:
// o le pide ubicación al usuario del SPP sin motivo, o le niega el escaneo al del BLE.
//
// La tabla es EXHAUSTIVA por `TransportKind` (`satisfies Record<TransportKind, …>`): un transporte
// nuevo **no compila** hasta que alguien declare su conjunto. Y el `transport` es un parámetro
// **REQUERIDO, sin default**: un default a `'spp'` haría que un call site nuevo que se lo olvide pida
// en silencio el conjunto equivocado, y el síntoma sería un `SecurityException` del escaneo sin nada
// que lo explique (es la misma clase de defecto que el fallback silencioso del parser que el review de
// F1 rechazó). Que no compile es la única forma de que la ausencia se note.
//
// Qué pide cada transporte, y por qué:
//   - `spp` (as-built, SIN CAMBIOS — regresión verificada en `permissions-android.test.ts`):
//       · API ≥ 31 → `BLUETOOTH_CONNECT`, el permiso que exigen las TRES llamadas del camino:
//         `getBondedDevices()`, `createRfcommSocketToServiceRecord()` + `connect()` y
//         `ACTION_REQUEST_ENABLE`. Sin él el nativo tira SecurityException.
//       · API ≤ 30 → NINGUNO. `BLUETOOTH` / `BLUETOOTH_ADMIN` son permisos NORMALES (se conceden al
//         instalar, no se piden con diálogo), y este camino no hace `startDiscovery`.
//   - `ble-gatt` (nuevo):
//       · API ≥ 31 → `BLUETOOTH_SCAN` **+** `BLUETOOTH_CONNECT`: el escaneo pide el primero y el
//         `connectToDevice` + descubrimiento de servicios pide el segundo. Faltando cualquiera de los
//         dos, `react-native-ble-plx` devuelve el error del SO, no una lista vacía.
//       · API ≤ 30 → `ACCESS_FINE_LOCATION`: antes de Android 12 el escaneo BLE es un permiso de
//         UBICACIÓN (Android lo trata como tal porque un escaneo permite inferir dónde estás). Está
//         declarado en el manifiesto **topeado a `maxSdkVersion=30`** (`with-bluetooth-classic.js`),
//         que es exactamente esta ventana.
//         ⚠️ Device-gated y NO cubierto por esta función: en API ≤ 30 el escaneo además exige que el
//         SERVICIO de ubicación del teléfono esté PRENDIDO. Eso no es un permiso de app y no se
//         resuelve acá; es un estado del adapter (F3/RBM6).
//   - `serial` → ninguno: es Web Serial (navegador), no hay modelo de permisos de Android.
//   - `ble-hid` → ninguno: el emparejamiento lo hace el SO en sus ajustes y la app solo recibe
//     keystrokes de un teclado. Pedir permisos de Bluetooth para leer el teclado sería pedir de más.
//   - `mfi` → ninguno: es iOS (ExternalAccessory). En Android ese transporte no existe.
//
// Manual-first (R7.2/R12.5): un permiso denegado NO bloquea nada. El adapter lo refleja como
// 'permission_denied' (estado con CTA de reintento) y la carga manual sigue operativa.

import type { TransportKind } from './driver-types';

/** Nivel de API en el que Android reemplaza el modelo viejo por BLUETOOTH_CONNECT/SCAN (Android 12). */
export const ANDROID_API_BLUETOOTH_RUNTIME = 31;

/** Permiso de runtime para hablar con un device (Classic emparejado o GATT) — Android 12+. */
export const PERMISSION_BLUETOOTH_CONNECT = 'android.permission.BLUETOOTH_CONNECT';

/** Permiso de runtime para ESCANEAR (Android 12+). Declarado con `neverForLocation`. */
export const PERMISSION_BLUETOOTH_SCAN = 'android.permission.BLUETOOTH_SCAN';

/** Permiso de runtime que Android ≤ 11 exige para escanear BLE (lo trata como ubicación). */
export const PERMISSION_ACCESS_FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION';

/** Resultado de la gestión de permisos, en el vocabulario del adapter. */
export type BluetoothPermissionOutcome = 'granted' | 'denied' | 'unavailable';

/** Los dos regímenes de permisos de Android que separan las llaves de la tabla. */
interface TransportPermissionSet {
  /** API ≥ 31 (Android 12+): modelo `BLUETOOTH_*` de runtime. */
  readonly modern: readonly string[];
  /** API ≤ 30: modelo viejo (los `BLUETOOTH*` son de instalación; el escaneo BLE es ubicación). */
  readonly legacy: readonly string[];
}

/**
 * LA TABLA (RBM2.13). Exhaustiva por `TransportKind` vía `satisfies`: agregar un transporte al tipo
 * y no declararlo acá **no compila**. Los conjuntos vacíos son decisiones escritas, no huecos (ver
 * la cabecera del archivo).
 */
export const ANDROID_BLUETOOTH_PERMISSIONS = {
  spp: { modern: [PERMISSION_BLUETOOTH_CONNECT], legacy: [] },
  'ble-gatt': {
    modern: [PERMISSION_BLUETOOTH_SCAN, PERMISSION_BLUETOOTH_CONNECT],
    legacy: [PERMISSION_ACCESS_FINE_LOCATION],
  },
  serial: { modern: [], legacy: [] },
  'ble-hid': { modern: [], legacy: [] },
  mfi: { modern: [], legacy: [] },
} as const satisfies Record<TransportKind, TransportPermissionSet>;

/**
 * ¿Hay política declarada para este transporte? (PURA). Existe porque los consumidores leen "lista
 * vacía" como **"no hay nada que pedir" → concedido**, y eso es correcto para `serial`/`ble-hid`/`mfi`
 * pero sería **fail-OPEN** para un transporte desconocido (que solo puede llegar por un cast desde JS
 * sin tipos): se daría por concedido algo que ni sabemos qué pide, y el síntoma sería un
 * `SecurityException` del SO sin nada que lo explique. Los dos caminos asincrónicos consultan esto
 * primero y devuelven 'unavailable' — que es lo que significa de verdad "no sé".
 */
export function hasAndroidPermissionPolicy(transport: TransportKind): boolean {
  return Object.prototype.hasOwnProperty.call(ANDROID_BLUETOOTH_PERMISSIONS, transport);
}

/**
 * Qué permisos de RUNTIME hay que pedir para ESTE transporte en ESTE nivel de API (PURA). Lista
 * vacía = no hay que pedir nada. `transport` es requerido a propósito (ver cabecera).
 *
 * ⚠️ Un transporte sin fila devuelve `[]`, que los consumidores leen como "concedido": la distinción
 * entre "nada que pedir" y "no sé qué pedir" **no cabe en un `string[]`** y se resuelve con
 * `hasAndroidPermissionPolicy` (arriba), no acá. Lo único que esta función garantiza para un
 * transporte desconocido es que **no hereda el conjunto de otro** (nada de `?? …spp`), que es la
 * familia de bug que el review de F1 rechazó.
 */
export function androidBluetoothPermissionsFor(apiLevel: number, transport: TransportKind): string[] {
  // `hasAndroidPermissionPolicy` y no `set === undefined`: un `transport` casteado que caiga en una
  // clave del PROTOTIPO (`'constructor'`, `'toString'`) devolvería un objeto que no es `undefined` y
  // el spread de su `.modern` inexistente **tiraría** ("undefined is not iterable"). Un lookup por
  // clave de string sobre un objeto literal es superficie hostil y se cierra con `hasOwnProperty`.
  if (!hasAndroidPermissionPolicy(transport)) return [];
  const set = ANDROID_BLUETOOTH_PERMISSIONS[transport];
  // Un `apiLevel` ilegible (un `Platform.Version` raro) cae al régimen VIEJO. Es la conducta
  // as-built y se conserva a propósito (el test de regresión la pinea): para `spp` da lista vacía,
  // que es lo que hacía antes de que existiera el segundo transporte. Y para `ble-gatt` el desenlace
  // también es el correcto, por un mecanismo que conviene tener escrito: `ACCESS_FINE_LOCATION` está
  // declarado en el manifiesto con `maxSdkVersion="30"`, así que en un teléfono API ≥ 31 ese permiso
  // NO pertenece al conjunto de la app y `requestMultiple` lo devuelve denegado **sin mostrar
  // diálogo** → estado `permission_denied` con CTA y carga manual intacta, en vez de un pedido de
  // ubicación injustificado. Nota: en Android `Platform.Version` es siempre el entero de la API, así
  // que esta rama es defensiva y no un camino esperado.
  const modern = Number.isFinite(apiLevel) && apiLevel >= ANDROID_API_BLUETOOTH_RUNTIME;
  return [...(modern ? set.modern : set.legacy)];
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
 * Igual que `classifyPermissionResults` pero para el resultado booleano de `PermissionsAndroid.check`
 * (PURA). 'granted' solo si TODOS los requeridos están concedidos. Fail-closed: un permiso que no
 * aparece en el mapa cuenta como NO concedido — nunca se asume que sí.
 */
export function classifyPermissionChecks(
  required: string[],
  results: Record<string, boolean> | null | undefined,
): 'granted' | 'denied' {
  if (required.length === 0) return 'granted';
  if (results == null) return 'denied';
  return required.every((p) => results[p] === true) ? 'granted' : 'denied';
}

/**
 * Pide (si hace falta) los permisos Bluetooth de runtime **del transporte que se le pasa**. Require
 * PEREZOSO de RN: en web/CI, donde `react-native` no resuelve o `PermissionsAndroid` no existe,
 * devuelve 'unavailable' sin tirar. Fuera de Android devuelve 'granted' (no hay modelo de permisos de
 * app que aplicar acá).
 */
export async function ensureAndroidBluetoothPermissions(
  transport: TransportKind,
): Promise<BluetoothPermissionOutcome> {
  // Antes de tocar RN: si no hay política declarada para este transporte, "no sé" ≠ "concedido".
  if (!hasAndroidPermissionPolicy(transport)) return 'unavailable';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform, PermissionsAndroid } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return 'granted';

    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    const required = androidBluetoothPermissionsFor(apiLevel, transport);
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

/**
 * CONSULTA si los permisos Bluetooth de runtime YA están concedidos, **sin pedirlos** (R6.4).
 *
 * ── POR QUÉ EXISTE Y NO ALCANZA `ensureAndroidBluetoothPermissions` ──────────────────────────────
 * La reconexión automática al ABRIR la app (R6.4) y la cadena de reintentos con backoff (R6.9) son
 * caminos que el operario **no pidió en ese instante**. `ensure…` llama
 * `PermissionsAndroid.requestMultiple`, que sobre un permiso ya concedido resuelve sin UI — pero
 * sobre uno **denegado una vez** (sin "no volver a preguntar") **vuelve a mostrar el diálogo**. O sea:
 * un timer de reintento, o el primer frame de la app, podían tirarle el diálogo de permisos en la
 * cara sin contexto de por qué. Eso es exactamente cómo se gana un "denegar para siempre".
 *
 * `PermissionsAndroid.check` no muestra nada: contesta sí/no. Los caminos automáticos usan ESTA; el
 * gesto del operario (tocar "Conectar bastón" / elegir un device de la lista) usa `ensure…`, que es el
 * único momento con contexto para pedir.
 *
 * Mismos bordes que `ensure…`: fuera de Android → 'granted'; API ≤ 30 (sin permisos de runtime que
 * chequear) → 'granted'; sin RN o sin `PermissionsAndroid.check` → 'unavailable' (nunca tira).
 */
export async function checkAndroidBluetoothPermissions(
  transport: TransportKind,
): Promise<BluetoothPermissionOutcome> {
  // Mismo criterio que en `ensure…`: sin política declarada, 'unavailable' (el camino automático NO
  // arranca) en vez del 'granted' que produciría una lista vacía.
  if (!hasAndroidPermissionPolicy(transport)) return 'unavailable';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform, PermissionsAndroid } = require('react-native') as typeof import('react-native');
    if (Platform.OS !== 'android') return 'granted';

    const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : Number(Platform.Version);
    const required = androidBluetoothPermissionsFor(apiLevel, transport);
    if (required.length === 0) return 'granted';

    if (PermissionsAndroid == null || typeof PermissionsAndroid.check !== 'function') {
      return 'unavailable';
    }
    const results: Record<string, boolean> = {};
    for (const permission of required) {
      results[permission] = await PermissionsAndroid.check(
        permission as Parameters<typeof PermissionsAndroid.check>[0],
      );
    }
    return classifyPermissionChecks(required, results);
  } catch {
    // Sin RN (web/CI) o falla del puente: no se puede saber. 'unavailable' → el camino automático
    // NO arranca (y el manual sigue operativo, R7).
    return 'unavailable';
  }
}
