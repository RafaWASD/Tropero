// FORMATO del "bastón recordado" (RBM5.6/RBM5.7, delta ios-ble-mfi T4.5). PURO: sin RN, sin
// SecureStore, sin localStorage → importable desde node:test. La I/O (y su techo) sigue viviendo en
// `remembered-device.ts`, que es el borde que cruza el puente nativo.
//
// ── POR QUÉ EL FORMATO CRECE ─────────────────────────────────────────────────────────────────────
// Hasta hoy el valor guardado era **un string pelado**: el id del device. Con dos transportes con radio
// (SPP Classic y BLE GATT) eso no alcanza: `selectTransportAdapter` elegía el transporte por
// PLATAFORMA, así que en Android montaba SIEMPRE `spp-android` y un lector BLE quedaba **inalcanzable
// en producción justo donde está el productor argentino** (RBM5.6). El transporte tiene que seguir al
// bastón que el operario ya eligió, y para eso el registro tiene que decir CON QUÉ se conectó.
//
// ── Y POR QUÉ EL FORMATO VIEJO NO PUEDE ROMPER (RBM5.7) ──────────────────────────────────────────
// Hay teléfonos con un valor viejo guardado (una MAC en Android). Ese valor se lee como
// "**sin preferencia** de transporte" → se cae al piso por plataforma, que es exactamente lo que hacía
// antes. Nadie queda sin bastón por una migración de formato, y nadie tiene que re-emparejar en la
// manga (la clave de storage NO se renombra: ver la auditoría de `rafq.*` de `e0a32ad`).
//
// La discriminación "¿es JSON u es el formato viejo?" es SEGURA por construcción y no por suerte: el
// escritor viejo pasaba el id por `sanitizeField` (que reemplaza todo lo que no sea
// `[A-Za-z0-9._:-]`), así que un valor viejo **no puede contener `{`, `"` ni `,`** → nunca puede
// parsear como objeto JSON. Lo único que sí puede pasar es que parsee como NÚMERO (un id de solo
// dígitos) o como BOOLEANO (un id que diga `true`), y por eso el discriminante es "¿el resultado es un
// objeto?" y no "¿`JSON.parse` no tiró?".

import { ADAPTER_KINDS, type AdapterKind } from './adapter-selection';

/**
 * El bastón recordado (R6.3 + RBM5.6). `deviceId` es lo único obligatorio: es el dato con el que se
 * reconecta. Los otros dos son opcionales porque un registro escrito por una versión anterior —o por un
 * camino que no los conoce— sigue siendo válido:
 *   · `vendorId`    → qué LECTOR era (para el día que dos drivers declaren el mismo transporte y haya
 *                     que elegir cuál; hoy `bleGattDriverFrom` devuelve el primero y hay un guard que
 *                     cae si aparece el segundo). **Hoy ningún camino de producción lo escribe** — el
 *                     formato lo soporta (round-trip probado) para que el día que haga falta sea un
 *                     campo más y no otra migración.
 *   · `adapterKind` → CON QUÉ TRANSPORTE se conectó. Es la preferencia que `selectTransportAdapter`
 *                     honra (RBM5.6). Ausente = sin preferencia = piso por plataforma (RBM5.7).
 */
export interface RememberedDevice {
  readonly deviceId: string;
  readonly vendorId?: string;
  readonly adapterKind?: AdapterKind;
}

/** Metadatos OPCIONALES del registro (lo que el escritor sabe además del id). */
export interface RememberedMeta {
  readonly vendorId?: string;
  readonly adapterKind?: AdapterKind;
}

/**
 * Charset conservador para lo que se persiste. Es el MISMO que aplicaba el escritor viejo (`safe()`),
 * y se conserva idéntico a propósito: un id ya guardado tiene que volver a escribirse igual, y es lo
 * que garantiza que un valor viejo nunca pueda parecer un objeto JSON (ver la cabecera).
 */
function sanitizeField(s: string): string {
  return s.replace(/[^A-Za-z0-9._:-]/g, '_');
}

/** ¿Este string es un `AdapterKind` conocido por ESTE build? */
function asAdapterKind(value: unknown): AdapterKind | undefined {
  if (typeof value !== 'string') return undefined;
  return (ADAPTER_KINDS as readonly string[]).includes(value) ? (value as AdapterKind) : undefined;
}

/**
 * El valor persistido → registro, o `null` si no hay nada usable.
 *
 * Tres caminos, y los tres importan:
 *   1. **JSON de un objeto** → el formato nuevo. `deviceId` tiene que ser un string no vacío (sin él el
 *      registro no sirve para reconectar → `null`). `adapterKind` solo se acepta si es un kind que
 *      ESTE build conoce: un valor desconocido (registro de una versión más nueva, storage manoseado)
 *      se **descarta y se conserva el deviceId** — FAIL-CLOSED: una preferencia que no se entiende no
 *      puede decidir qué transporte se monta, pero tampoco tiene por qué costarle el bastón al
 *      operario.
 *   2. **JSON que no es un objeto** (un id de solo dígitos parsea como número; `true` como booleano) →
 *      formato VIEJO: el valor crudo ES el id, sin preferencia.
 *   3. **No parsea** → formato viejo, igual que 2.
 */
export function parseRememberedValue(raw: string | null | undefined): RememberedDevice | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { deviceId: raw }; // formato viejo (RBM5.7): el string pelado es el id
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // Parseó, pero a un número/booleano/string/array: es el formato viejo, no un registro.
    return { deviceId: raw };
  }

  const record = parsed as Record<string, unknown>;
  const deviceId = typeof record.deviceId === 'string' ? record.deviceId.trim() : '';
  if (deviceId.length === 0) return null;

  const vendorId = typeof record.vendorId === 'string' && record.vendorId.length > 0 ? record.vendorId : undefined;
  const adapterKind = asAdapterKind(record.adapterKind);

  return {
    deviceId,
    ...(vendorId ? { vendorId } : {}),
    ...(adapterKind ? { adapterKind } : {}),
  };
}

/**
 * El `deviceId` recordado que **ESTE transporte** puede usar para reconectar, o `null` si el registro es
 * de otro (🟠-2 del review de F4).
 *
 * ── POR QUÉ HACE FALTA, Y POR QUÉ NO HACÍA FALTA ANTES ──────────────────────────────────────────
 * El registro guarda UN bastón (R6.7: un bastón por dispositivo): un `deviceId` **y** el `adapterKind`
 * con el que se conectó. Mientras el transporte montado lo decidía ese mismo registro (RBM5.6), el id y
 * el transporte no podían divergir: el que dialaba el id era siempre el que lo había escrito.
 *
 * Desde que el operario puede ELEGIR el transporte por gesto (`transportChoices`), sí pueden divergir: en
 * un Android con `{deviceId: '11:22:…', adapterKind:'spp-android'}` guardado, elegir el bastón BLE monta
 * `ble-gatt` y su `connect()` **sin id** leería el recordado → `connectToDevice()` contra la MAC de un
 * device Classic que no anuncia GATT. El síntoma es el peor de esta unidad: no falla rápido, se queda
 * esperando. Con este filtro, el transporte que no reconoce el registro **escanea** (que es lo correcto:
 * no tiene device previo).
 *
 * `acceptsLegacy` es del SPP y **solo del SPP**: un registro en el formato viejo (string pelado, sin
 * `adapterKind`) solo puede haberlo escrito el SPP, que era el único escritor antes de este delta —y en
 * Android, la única plataforma donde corre. Aceptarlo en `ble-gatt` sería dialar una MAC de Classic desde
 * el transporte equivocado, o sea el bug que esta función cierra, entrando por la puerta de la
 * compatibilidad (RBM5.7).
 */
export function rememberedDeviceIdFor(
  record: RememberedDevice | null,
  kind: AdapterKind,
  opts: { acceptsLegacy: boolean },
): string | null {
  if (record == null) return null;
  if (record.adapterKind == null) return opts.acceptsLegacy ? record.deviceId : null;
  return record.adapterKind === kind ? record.deviceId : null;
}

/**
 * Registro → valor persistido (JSON), con cada campo saneado. Devuelve `null` si el `deviceId` no
 * sobrevive el saneado (nada que guardar).
 *
 * Los campos opcionales se OMITEN cuando no vienen, en vez de escribirse como `null`/`undefined`: así
 * el valor guardado no crece con ruido y `parse(serialize(x))` es idempotente (probado).
 */
export function serializeRememberedValue(
  deviceId: string,
  meta?: RememberedMeta,
): string | null {
  // El trim va ANTES del saneado y no después: `sanitizeField` convierte los espacios en `_`, así que
  // sanear primero dejaría un id `'___'` (no vacío) para una entrada que era solo espacios. El escritor
  // viejo no trimeaba, pero ningún id del SO trae espacios al borde y ahora `parse` y `serialize`
  // coinciden en el criterio.
  const id = sanitizeField(deviceId.trim());
  if (id.length === 0) return null;
  const record: Record<string, string> = { deviceId: id };
  if (meta?.vendorId) record.vendorId = sanitizeField(meta.vendorId);
  // El `adapterKind` NO se sanea con el charset: es un literal de nuestro propio union (lo valida el
  // tipo al escribir y `asAdapterKind` al leer), y un guion se conserva igual (`ble-gatt`).
  if (meta?.adapterKind) record.adapterKind = meta.adapterKind;
  return JSON.stringify(record);
}
