// Convertidor ÚNICO de "un error del transporte" → "texto que puede ir a un log".
//
// ── POR QUÉ EXISTE (hallazgo §7.2 del Gate 2 del delta `ios-ble-mfi`) ────────────────────────────────
// Los mensajes de las libs de Bluetooth INTERPOLAN el identificador del dispositivo. Verificado en el
// fuente instalado, no supuesto:
//   · `react-native-ble-plx` (`src/BleError.js`): 'Device {deviceID} was disconnected', '… connection
//     failed', '… not found', 'Services discovery failed for device {deviceID}' — 20 plantillas.
//   · `react-native-bluetooth-classic` (`Exceptions.java`): 'Connection to %s failed.', 'Connection to %s
//     was lost', 'Not connected to %s', y el `%s` es `device.getAddress()`, o sea LA MAC.
// Los tres adapters tenían su propio `errorMessage(e)` que devolvía `e.message` crudo, y ese string se
// interpolaba en `ble_disconnected`, `ble_monitor_lost`, `ble_scan_error`, `liveness_lost` y
// `logBridgeFailure` → el identificador del bastón terminaba en un breadcrumb de Sentry, EN FREE-TEXT,
// que es justo donde el scrubber por claves de `observability/redact.ts` no puede llegar (es la misma
// clase que el MEDIUM-2 de ese Gate, con el agravante de que acá la copia del helper estaba ×3).
//
// ── LA REGLA, Y LO QUE CUESTA ───────────────────────────────────────────────────────────────────────
// El texto sale solo si podemos garantizar que no lleva un identificador. Dos vías, en orden:
//  1. CÓDIGO CONOCIDO QUE INTERPOLA UN ID → se emite `errorCode:<n>` y NUNCA el mensaje. Los códigos
//     mapean 1:1 con las plantillas, así que no se pierde diagnóstico: se pierde LEGIBILIDAD, y ese es el
//     precio aceptado. Es la única vía que cubre el id de iOS, que es un UUID y por FORMA es
//     indistinguible de un UUID de servicio o de característica (que sí queremos ver en el log).
//  2. EL RESTO → el mensaje, con los identificadores blanqueados: el id EXACTO del device con el que
//     estábamos hablando (cuando el call site lo conoce — cubre el serial MFi, que no tiene forma
//     reconocible) y cualquier MAC. 'Connection to <device> failed.' conserva la causa y pierde al dueño.
// Lo que NO se blanquea, a propósito: los UUID de servicio/característica (son NUESTRAS constantes, y son
// media diagnosis de un lector nuevo) y los mensajes sin id ('BluetoothLE is powered off').
//
// El guard de la ausencia está en `log-device-identifier-guard.test.ts`: un camino de log nuevo que lea
// el texto de un error por su cuenta, o que interpole un identificador en un `message`, nace en rojo.

/** Lo que reemplaza a un identificador de dispositivo en el texto de un log. */
export const REDACTED_DEVICE = '<device>';

/** Tope del texto que va al log. Un `message` del nativo es free-text: acotarlo es del mismo tipo de
 *  defensa que el tope del buffer del framer (HIGH-1). Se marca el corte, no se miente. */
export const SAFE_ERROR_TEXT_MAX = 240;

/** Un id más corto que esto no se blanquea por igualdad: sería reemplazar un pedazo de cualquier palabra. */
const MIN_ID_CHARS = 6;

/**
 * Los `BleErrorCode` de `react-native-ble-plx` cuya plantilla de mensaje interpola `{deviceID}`.
 * NO es una lista escrita a ojo: `error-text.test.ts` la DERIVA de `node_modules/react-native-ble-plx`
 * y exige que esta contenga a aquella — si un upgrade de la lib agrega una plantilla con el id, el guard
 * se pone rojo antes de que el id empiece a viajar.
 */
export const BLE_PLX_DEVICE_ID_ERROR_CODES: ReadonlySet<number> = new Set([
  200, 201, 202, 203, 204, 205, 206, // Device* (conexión, desconexión, RSSI, MTU, no encontrado)
  300, 301, 302, 303, //                Services*
  400, 401, 402, 403, 405, //           Characteristic*
  500, 501, 502, 504, //                Descriptor*
  5, //                                 InvalidIdentifiers — ver BLE_PLX_EXTRA_CODES
]);

/**
 * Los que NO salen del oráculo derivado y agregamos igual, con el motivo acá (el test exige que la
 * diferencia entre la tabla y lo derivado sea EXACTAMENTE este mapa).
 */
export const BLE_PLX_EXTRA_CODES: Readonly<Record<number, string>> = {
  5:
    'InvalidIdentifiers = "Invalid UUIDs or IDs were passed: {internalMessage}". El `{internalMessage}` ' +
    'es texto libre del nativo que en ESTE código son, literalmente, los identificadores que se pasaron.',
};

/** MAC en las dos grafías que devuelven los SO. Los UUID canónicos (8-4-4-4-12) NO matchean: sus grupos
 *  no son de dos caracteres, así que un UUID de servicio sobrevive entero (hay test). */
const MAC_RE = /\b[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}\b/g;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Saca de un texto los identificadores de dispositivo: el conocido (exacto) y los que tienen forma de MAC. */
export function scrubDeviceIdentifiers(text: string, deviceId?: string | null): string {
  let out = text;
  const known = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (known.length >= MIN_ID_CHARS) {
    out = out.replace(new RegExp(escapeForRegExp(known), 'gi'), REDACTED_DEVICE);
  }
  return out.replace(MAC_RE, REDACTED_DEVICE);
}

/** El código numérico de un `BleError` (la lib no copia `deviceID` al objeto: el código es lo que hay). */
function numericErrorCode(e: unknown): number | null {
  if (e == null || typeof e !== 'object') return null;
  const code = (e as { errorCode?: unknown }).errorCode;
  return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

/** El texto crudo del error, sin mirar todavía si lleva un identificador. */
function rawErrorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e != null && typeof e === 'object') {
    const bag = e as { message?: unknown; code?: unknown; errorCode?: unknown };
    if (typeof bag.message === 'string' && bag.message !== '') return bag.message;
    // Las promesas del puente de RN rechazan con `code` (el `abbr` del `reject(...)` nativo): es un
    // literal del nativo, no lleva identificadores, y dice más que 'unknown'.
    if (typeof bag.code === 'string' && bag.code !== '') return bag.code;
    if (bag.errorCode != null) return `errorCode:${String(bag.errorCode)}`;
  }
  return 'unknown';
}

/**
 * EL convertidor. `deviceId` es opcional y es el identificador con el que el call site estaba hablando:
 * pasarlo es lo que cubre los identificadores sin forma reconocible (el serial de un accesorio MFi).
 */
export function safeErrorText(e: unknown, deviceId?: string | null): string {
  const code = numericErrorCode(e);
  if (code != null && BLE_PLX_DEVICE_ID_ERROR_CODES.has(code)) return `errorCode:${code}`;
  const scrubbed = scrubDeviceIdentifiers(rawErrorText(e), deviceId);
  return scrubbed.length > SAFE_ERROR_TEXT_MAX ? `${scrubbed.slice(0, SAFE_ERROR_TEXT_MAX)}…` : scrubbed;
}
