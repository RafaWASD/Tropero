// spp-protocol — piezas PURAS del transporte Bluetooth Classic SPP en Android (RMV5.1/5.3/5.7).
// Sin RN, sin la lib nativa, sin I/O → testeable bajo node:test. `adapter-spp-android.ts` hace
// SOLO la I/O; toda decisión de protocolo vive acá y se testea sin device.
//
// ── Por qué existe este módulo (hallazgo de la pasada de bring-up, 2026-07-29) ────────────────
// El adapter escrito en la pasada "código sin dep" asumía que `onDataReceived` entregaba CHUNKS
// crudos del socket y los pasaba por `LineFramer` (cortar por `\n`). Leído el código nativo de
// `react-native-bluetooth-classic`, eso es FALSO: el `DeviceConnection` por defecto es
// `DelimitedStringDeviceConnectionImpl` con `delimiter = "\n"` (ver `StandardOption.DELIMITER`),
// que buffera en Java y entrega UN MENSAJE COMPLETO YA SIN el delimitador. Un payload así NUNCA
// contiene `\n` → `LineFramer.push()` devolvía `[]` para siempre y el adapter no habría emitido
// una sola lectura ni con el RS420 enchufado. El framing lo hace el nativo; acá solo separamos
// defensivamente por si el payload trajera varias líneas (delimitador no aplicado / modo crudo).
//
// El `\r` de un `\r\n` sobrevive al final del mensaje: lo descarta `normalizeTag` del parser
// (parser-rs420.ts), así que la línea se entrega CRUDA al contrato, como manda RMV5.3.

/**
 * UUID RFCOMM que `react-native-bluetooth-classic` usa SIEMPRE en Android.
 *
 * ⚠️ NO es configurable: `RfcommConnectorThreadImpl` (código nativo de la lib) llama
 * `device.createRfcommSocketToServiceRecord(BluetoothUUID.SPP.uuid)` con la constante
 * `00001101-0000-1000-8000-00805F9B34FB` HARDCODEADA — la opción `uuid` que se le pase al
 * `connectToDevice` se ignora. Se declara acá para poder CONTRASTARLA contra el `sppUuid` del
 * driver (RMV5.2) en vez de fingir que el adapter la parametriza.
 */
export const RNBC_FIXED_SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

/**
 * Delimitador de mensaje POR DEFECTO. Es el del RS420 (`field-findings.md`), NO una propiedad del
 * transporte: el que manda es el `delimiter` del `TransportCapability` del driver, y este valor es
 * solo la caída para un driver que no lo declare. Ver `sppDelimiterIsSupported`.
 */
export const SPP_DELIMITER = '\n';

/**
 * ¿Este fin de trama es alcanzable con el framing nativo? (🟠-5, honestamente — mismo criterio que
 * `sppUuidIsSupported`: cortar antes que fingir).
 *
 * Un string VACÍO es legal para el nativo pero significa OTRA COSA:
 * `DelimitedStringDeviceConnectionImpl.read()` con delimitador vacío devuelve **todo el buffer** como
 * un mensaje (modo crudo por chunks), y entonces el framing tendría que hacerlo `LineFramer` de este
 * lado — que es exactamente el bug de framing invertido que ya nos costó "cero lecturas" una vez.
 * Además, un `split('')` en `splitSppPayload` explotaría el payload en caracteres sueltos. Un driver
 * que necesite ese modo necesita otro adapter, no este; acá se corta con log y estado `disconnected`.
 * Multi-carácter (`\r\n`) SÍ funciona: el nativo avanza `index + mDelimiter.length()`.
 */
export function sppDelimiterIsSupported(delimiter: unknown): delimiter is string {
  return typeof delimiter === 'string' && delimiter.length > 0;
}

/**
 * ¿El transporte SPP de este driver es alcanzable con la lib instalada? (RMV5.2, honestamente)
 *
 * Devuelve `false` si el driver declara un UUID RFCOMM distinto del único que la lib sabe abrir.
 * Es la diferencia entre "el adapter está parametrizado por el driver" y "el adapter *parece*
 * parametrizado": si un fabricante futuro publicara su lector en otro UUID de servicio, esta lib
 * abriría igual el socket del SPP estándar y leeríamos basura (o nada) en silencio. Preferimos
 * cortar y caer a manual-first (R7) antes que conectar a un servicio que no es el del driver.
 * Comparación case-insensitive: el SO devuelve los UUID en minúscula.
 */
export function sppUuidIsSupported(sppUuid: string): boolean {
  if (typeof sppUuid !== 'string') return false;
  return sppUuid.trim().toLowerCase() === RNBC_FIXED_SPP_UUID.toLowerCase();
}

/**
 * Opciones del `connectToDevice` de la lib (mapeadas a `StandardOption` del nativo).
 *
 * Claves EXACTAS: el `StandardOption.get` nativo busca la clave por `name()` / `name().toLowerCase()`
 * / `code()`, y estas son los `code()`. Todos los valores son String/Boolean a propósito: la
 * conversión `ReadableMap.toHashMap()` mapea los números de JS a `Double`, y `StandardOption` los
 * descarta por type-check (`Integer.class.isAssignableFrom(Double.class) == false`) volviendo al
 * default — o sea, pasar un número es pasar nada. No pasamos ninguno.
 *
 * `secure: true` → `createRfcommSocketToServiceRecord` (canal cifrado, exige el pairing previo con
 * el PIN del driver). Baud-independiente (RMV5.7): el SPP virtual no lleva baud y no se pasa.
 */
export interface SppConnectOptions {
  connectorType: 'rfcomm';
  connectionType: 'delimited';
  delimiter: string;
  charset: string;
  secure: boolean;
}

export function sppConnectOptions(delimiter: string = SPP_DELIMITER): SppConnectOptions {
  return {
    connectorType: 'rfcomm',
    connectionType: 'delimited',
    delimiter,
    charset: 'ascii',
    secure: true,
  };
}

/**
 * Convierte un payload de `onDataReceived` en las LÍNEAS CRUDAS a entregar al contrato (RMV5.3).
 *
 * Camino normal (framing nativo delimitado): el payload ES una línea completa sin el terminador →
 * devuelve `[payload]`. Camino defensivo: si por lo que sea el payload trajera varios mensajes
 * pegados, se separan por el MISMO delimitador que se le pidió al nativo (el del driver — separar
 * por otro sería inventar tramas). Se descartan los tramos vacíos/solo-whitespace para no ingerir
 * líneas nulas (mismo criterio que `LineFramer`). Nunca tira: un payload no-string devuelve `[]`,
 * y un delimitador inválido (vacío) NO se usa para partir — se devuelve el payload entero.
 */
export function splitSppPayload(payload: unknown, delimiter: string = SPP_DELIMITER): string[] {
  if (typeof payload !== 'string' || payload.length === 0) return [];
  const parts = sppDelimiterIsSupported(delimiter) ? payload.split(delimiter) : [payload];
  return parts.filter((line) => line.replace(/[\r\s]/g, '').length > 0);
}

/**
 * Un device Bluetooth Classic YA EMPAREJADO en el sistema, normalizado desde la lib (RMV3.2).
 * `id` es la MAC (lo que se persiste como bastón recordado); `name` es el nombre del SO.
 */
export interface PairedDevice {
  id: string;
  name?: string;
}

/**
 * Normaliza la lista cruda de `getBondedDevices()` a `PairedDevice[]` (PURA → testeable sin device).
 * Descarta entradas sin address (no se puede conectar a algo sin MAC) y deduplica por address.
 * Ordena por nombre (es-AR, case-insensitive) para que la lista no baile entre renders.
 */
export function normalizePairedDevices(raw: unknown): PairedDevice[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PairedDevice[] = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue;
    const record = entry as { address?: unknown; id?: unknown; name?: unknown };
    const address = typeof record.address === 'string' && record.address.length > 0
      ? record.address
      : typeof record.id === 'string' && record.id.length > 0
        ? record.id
        : null;
    if (address == null || seen.has(address)) continue;
    seen.add(address);
    const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : undefined;
    out.push({ id: address, name });
  }
  return out.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, 'es-AR', { sensitivity: 'base' }));
}
