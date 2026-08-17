// La LISTA DE PROTOCOLOS MFi del build y el gate del binding `mfi-ios` (RBM4.2/4.4/4.5, RBM5.5;
// delta ios-ble-mfi T4.2). PURO respecto de RN/expo: la única I/O es un `require` PEREZOSO de
// `expo-constants` dentro de un try/catch (patrón `demo-gate.ts`), así que este módulo se importa
// desde node:test sin arrastrar expo.
//
// ── QUÉ GATEA Y POR QUÉ NO ES CÓDIGO MUERTO ──────────────────────────────────────────────────────
// El camino iOS "de fábrica" de los lectores que el cliente ya tiene (RS420, SRS2i, XRS2i) es MFi /
// ExternalAccessory, y para abrir una sesión con un accesorio iAP el build tiene que DECLARAR su cadena
// de protocolo en `UISupportedExternalAccessoryProtocols`. Esa cadena la entrega el fabricante (trámite
// MFi, canal Facundo) y **no la tenemos**: hoy la clave está declarada VACÍA. Inventarla sería mentirle
// al SO y no habilitaría ningún accesorio (RBM4.6).
//
// Entonces el delta deja el camino PREARMADO y GATEADO POR DATOS: el día que llegue la cadena, el diff
// es una línea en `app.config.ts` + una `TransportCapability` `{kind:'mfi'}` en el driver del
// fabricante. **Cero código** (RBM4.7) — y eso está probado con una cadena SINTÉTICA inyectada, que es
// la única forma de demostrarlo sin tener el dato real.
//
// ── POR QUÉ LA LISTA ENTRA INYECTADA Y NO SE LEE ADENTRO DEL MOTOR (RBM5.5) ──────────────────────
// `selectReaderBinding` es lógica pura y determinística (RMV2.6/RMV2.8): con las mismas entradas, el
// mismo binding. Si leyera `Constants` adentro, su resultado dependería del entorno y dejaría de ser
// testeable sin device — que es justo la propiedad que el motor de selección compró. Por eso la lista
// viaja como una entrada más de `BindingEnv`, igual que `platformOS` y `builtAdapters`.

import type { ReaderDriver } from './driver-types';
// El fin de trama por DEFECTO es un dato del RS420 (no del transporte), y vive en `spp-protocol.ts`
// desde antes de este delta. Se importa en vez de recopiar el literal por el mismo motivo por el que lo
// importa `ble-gatt-protocol.ts`: dos copias del supuesto de un lector divergen, y el síntoma de que
// divergieran sería "conectado y mudo" (BENCH-2).
import { SPP_DELIMITER } from './spp-protocol';

/** Clave del `Info.plist` donde iOS espera la lista de protocolos de accesorio declarados. */
export const EA_PROTOCOLS_INFO_PLIST_KEY = 'UISupportedExternalAccessoryProtocols';

/**
 * Las cadenas de protocolo iAP que ESTE build declara. `[]` cuando no hay ninguna (el estado de hoy),
 * cuando no estamos en un runtime con expo, o cuando lo leído no es una lista de strings.
 *
 * FAIL-CLOSED por partida doble: cualquier falla devuelve `[]` → `mfiAvailability` responde
 * `build-sin-protocolos` → el binding queda `available:false` y **nadie intenta abrir una sesión que
 * fallaría** (RMV3.7). Un fallback optimista acá sería un CTA que promete y no cumple.
 *
 * ⚠️ Lee `Constants.expoConfig` y **no** `NativeModules`: leer ese global INSTANCIA el módulo nativo en
 * bridgeless, y el `init()` de `react-native-bluetooth-classic` hace un force-cast `as! [String]` sobre
 * esta misma clave (RBM4.2). `expoConfig` es el manifiesto ya resuelto — no toca ningún módulo nativo.
 */
export function declaredEaProtocols(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-constants') as { default?: { expoConfig?: unknown } };
    return eaProtocolsFromExpoConfig(mod?.default?.expoConfig);
  } catch {
    return [];
  }
}

/**
 * La RUTA dentro del manifiesto, separada y exportada. Es la mitad que un test PUEDE ejercitar contra la
 * config REAL de la app (`app.config.ts` es una función pura de `process.env`, importable en node:test), y
 * por eso está afuera del `require`: en node no hay runtime de expo, así que un test sobre
 * `declaredEaProtocols()` solo puede ver el camino fail-closed y **no probaría la ruta**.
 *
 * Y la ruta es justo lo que se puede romper en silencio: si la clave se mueve en `app.config.ts` (a las
 * props de un plugin, a `ios.entitlements`, a `extra`) o si acá se lee otra rama, esta función devuelve
 * `[]` PARA SIEMPRE — incluso el día que la cadena del fabricante esté declarada — y RBM4.7 ("cero código
 * ese día") deja de ser cierto sin que nada se ponga rojo. El test le pasa la config real con una cadena
 * sintética agregada: eso es EXACTAMENTE el diff de ese día, ejecutado.
 */
export function eaProtocolsFromExpoConfig(expoConfig: unknown): string[] {
  const plist = (expoConfig as { ios?: { infoPlist?: Record<string, unknown> } } | null | undefined)?.ios
    ?.infoPlist;
  return eaProtocolsFrom(plist?.[EA_PROTOCOLS_INFO_PLIST_KEY]);
}

/**
 * La mitad PURA de `declaredEaProtocols`: valida la forma de lo leído. Está separada y exportada porque
 * es la parte que se puede falsificar sin un runtime de expo — en node:test `require('expo-constants')`
 * no devuelve un manifiesto, así que un test sobre la función completa solo ejercita el camino
 * fail-closed y no probaría NADA del filtrado (una lista con un número adentro, un valor que no es
 * array, la clave ausente).
 */
export function eaProtocolsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Por qué un binding MFi NO está disponible. Son TRES motivos y no un `null`, porque tienen tres
 * lecturas y tres acciones distintas —y desde la UI se ven exactamente igual (nada)—:
 *   · `driver-sin-mfi`        → este lector no habla MFi. Normal: no hay nada que arreglar.
 *   · `build-sin-protocolos`  → el build no declara NINGUNA cadena (el estado de hoy). Falta el dato
 *                               del fabricante (trámite MFi).
 *   · `protocolo-no-declarado`→ el driver declara una cadena que este build NO tiene en el plist. Es un
 *                               error de CONFIGURACIÓN nuestro, no del fabricante: falta la línea en
 *                               `app.config.ts`. Es el motivo que hace diagnosticable el día que la
 *                               cadena llegue y alguien la ponga en un solo lado de los dos.
 */
export type MfiUnavailableReason = 'driver-sin-mfi' | 'build-sin-protocolos' | 'protocolo-no-declarado';

export type MfiAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: MfiUnavailableReason };

/**
 * ¿Este driver puede hablar MFi en ESTE build? (RBM4.4/RBM4.5.) PURA: el driver y la lista declarada
 * entran por parámetro.
 *
 * La comparación de la cadena es EXACTA (case-sensitive, sin trim de lo declarado): el `protocolString`
 * es un identificador de bundle inverso que el SO matchea literalmente contra el del accesorio, así que
 * "casi igual" no abre ninguna sesión — y una comparación laxa acá diría `available:true` sobre un
 * plist que iOS va a rechazar, que es peor que decir la verdad.
 */
export function mfiAvailability(driver: ReaderDriver, declared: readonly string[]): MfiAvailability {
  const cap = driver.transports.find((t) => t.kind === 'mfi');
  if (!cap || cap.kind !== 'mfi') return { available: false, reason: 'driver-sin-mfi' };
  if (declared.length === 0) return { available: false, reason: 'build-sin-protocolos' };
  if (!declared.includes(cap.params.protocolString)) {
    return { available: false, reason: 'protocolo-no-declarado' };
  }
  return { available: true };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// F5 — LAS PIEZAS PURAS DEL TRANSPORTE MFi (T5.2), MOLDEADAS SOBRE EL SWIFT INSTALADO (RBM4.8)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Todo lo de acá abajo sale de LEER el fuente de la rama iOS de `react-native-bluetooth-classic`
// (`ios/RNBluetoothClassic.swift`, `ios/conn/DelimitedStringDeviceConnectionImpl.swift`,
// `ios/device/NativeDevice.swift`, `ios/extensions/SubstringExtension.swift`), **no** su README — que es
// literal la lección del SPP: el diseño original del adapter SPP se moldeó sobre el README y describía un
// adapter que no funcionaba (framing invertido → cero lecturas con el bastón enchufado).
//
// Vive en este módulo —y no en el adapter— por lo mismo que `spp-protocol.ts` y `ble-gatt-protocol.ts`:
// el adapter hace SOLO I/O, y toda decisión de protocolo se testea sin device.

/**
 * Un accesorio MFi ya emparejado por el SO, normalizado desde `getBondedDevices()`.
 *
 * ⚠️ En iOS "bonded" **no** significa lo mismo que en Android: `getBondedDevices()` devuelve
 * `EAAccessoryManager.connectedAccessories`, o sea los accesorios que están **prendidos y emparejados**
 * (iOS los llama "connected" aunque no haya ninguna sesión abierta). El adapter no puede "descubrir":
 * el emparejamiento lo hace el propio SO en su Accessory Picker (Ajustes), y lo único que nos queda es
 * listar y filtrar.
 *
 * `protocolStrings` es la clave de todo el transporte y la trae el nativo (`NativeDevice.map()`): es lo
 * que permite decidir en JS **cuál** de los accesorios prendidos es un bastón que este build puede abrir.
 */
export interface MfiAccessory {
  /** `accessory.serialNumber` (el nativo lo publica como `id` y como `address`). */
  readonly id: string;
  readonly name?: string;
  readonly protocolStrings: readonly string[];
}

/**
 * ── HALLAZGO Nº7 DEL FUENTE INSTALADO (RBM4.8), Y ES EL QUE ROMPÍA EL TRANSPORTE ─────────────────
 * De dónde salen las cadenas de protocolo de UNA entrada de `getBondedDevices()`. Son **dos formas
 * distintas** porque la librería tiene DOS capas y solo la de abajo publica el dato:
 *
 *   · el **nativo** (`NativeDevice.map()`, `ios/device/NativeDevice.swift`) sí pone
 *     `"protocolStrings": accessory.protocolStrings` en el diccionario que resuelve la promesa;
 *   · el **wrapper JS** (`lib/BluetoothDevice.js`) que `BluetoothModule.getBondedDevices()` construye
 *     alrededor de cada diccionario copia `name/address/id/bonded/deviceClass/rssi/type/extra` y
 *     **NO copia `protocolStrings`** (ni lo declara `BluetoothNativeDevice`, que es una interfaz
 *     pensada para Android). El diccionario crudo queda en su campo `_nativeDevice`.
 *
 * Consecuencia si se lee solo la primera forma —que es lo que había—: **todo** accesorio sale con
 * `protocolStrings: []`, `pickMfiAccessory` devuelve `null` SIEMPRE y el transporte queda clavado en
 * `mfi_accessory_not_found` para siempre. O sea: el día que llegue la cadena del fabricante, RBM4.7
 * ("cero código ese día") sería **falso**, y el síntoma en device sería el peor de esta unidad ("no pasa
 * nada", indistinguible de "el bastón está apagado"). Es exactamente la clase de defecto que RBM4.8 vino
 * a evitar: el diseño original del SPP se moldeó sobre el README y describía un adapter que no andaba.
 *
 * Se aceptan las DOS formas —y no se cambia de superficie— por dos motivos: (a) es una decisión PURA y
 * falsificable sin device, mientras que listar por `NativeModules.RNBluetoothClassic` sería una segunda
 * superficie del mismo módulo (dos implementaciones de la misma verdad divergen); (b) así el normalizador
 * es correcto con el diccionario crudo **y** con el wrapper, sin depender de cuál se llame.
 *
 * El costo declarado: `_nativeDevice` es un campo privado de la lib. Un rename ahí devolvería `[]` en
 * silencio, así que hay un guard en `ea-protocols.test.ts` que lo DERIVA del fuente instalado (el mapa
 * nativo publica la clave / el wrapper no la copia y conserva `_nativeDevice`): si la lib cambia de
 * forma, nace en rojo en vez de mudo.
 */
function mfiProtocolStringsOf(entry: object): string[] {
  const direct = (entry as { protocolStrings?: unknown }).protocolStrings;
  const wrapped = (entry as { _nativeDevice?: { protocolStrings?: unknown } })._nativeDevice?.protocolStrings;
  const raw = Array.isArray(direct) ? direct : wrapped;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/**
 * Normaliza la lista cruda de `getBondedDevices()` a `MfiAccessory[]` (PURA → testeable sin device).
 * Descarta entradas sin id (no se puede abrir una sesión con algo sin serial), deduplica por id y
 * conserva SOLO las cadenas de protocolo que son strings no vacíos, vengan del diccionario nativo o del
 * wrapper de la lib (`mfiProtocolStringsOf`, hallazgo nº7).
 *
 * Ordena por (nombre ?? id) para que la lista no baile entre llamadas, igual que
 * `normalizePairedDevices`: la elección del accesorio es "el primero que habla el protocolo", así que un
 * orden inestable haría no determinístico A QUÉ bastón se conecta con dos accesorios compatibles
 * prendidos (RMV2.8/RBM5.8 valen también acá).
 */
export function normalizeMfiAccessories(raw: unknown): MfiAccessory[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: MfiAccessory[] = [];
  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue;
    const record = entry as { id?: unknown; address?: unknown; name?: unknown };
    const id =
      typeof record.id === 'string' && record.id.length > 0
        ? record.id
        : typeof record.address === 'string' && record.address.length > 0
          ? record.address
          : null;
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    const protocolStrings = mfiProtocolStringsOf(entry);
    const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : undefined;
    out.push({ id, ...(name ? { name } : {}), protocolStrings });
  }
  return out.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, 'es-AR', { sensitivity: 'base' }));
}

/**
 * El primer accesorio prendido que declara **exactamente** esta cadena de protocolo, o `null`.
 *
 * ── POR QUÉ EL MATCH ES POR `protocolString` Y NO POR `deviceMatch` (a diferencia del BLE) ─────────
 * En BLE el reconocimiento va por nombre y **no** por UUID de servicio (RBM5.13), porque los UUID
 * Nordic UART son un estándar que también anuncia el bridge de la balanza Vesta: el UUID no identifica
 * al fabricante. Acá es al revés: la cadena iAP (`com.allflex.…`) la **emite el fabricante para su
 * producto** y el propio iOS la usa como llave de autorización — un accesorio que declara la cadena de
 * Allflex ES un lector de Allflex. Exigir además que el nombre del accesorio matcheara el `namePattern`
 * del driver agregaría una forma de FALSO NEGATIVO (el nombre comercial del accesorio no lo elegimos
 * nosotros y no lo conocemos) sin cerrar ningún falso positivo: es el error simétrico del de RBM5.13 y
 * hay test de las dos direcciones.
 *
 * La comparación es EXACTA, por el mismo motivo que en `mfiAvailability`: el SO matchea literalmente.
 */
export function pickMfiAccessory(
  accessories: readonly MfiAccessory[],
  protocolString: string,
): MfiAccessory | null {
  return accessories.find((a) => a.protocolStrings.includes(protocolString)) ?? null;
}

/**
 * ¿Este fin de trama es alcanzable con el framing nativo de la rama **iOS**? (mismo criterio que
 * `sppDelimiterIsSupported`: cortar antes que fingir — 🟠-5).
 *
 * Son DOS condiciones y las dos salen del Swift instalado:
 *
 * 1. **No vacío.** `DelimitedStringDeviceConnectionImpl.read()` con delimitador vacío devuelve TODO el
 *    buffer como un mensaje (modo crudo), así que el framing tendría que hacerlo `LineFramer` de este
 *    lado — el bug de framing invertido que ya costó "cero lecturas" una vez. Y `split('')` explotaría
 *    el payload en caracteres sueltos.
 * 2. **UN solo carácter** — y ACÁ iOS se separa de Android. El `read()` nativo hace
 *    `message = content[..<index]` y después `inBuffer = String(content[content.index(after: index)...])`:
 *    `index` es el comienzo del delimitador (`SubstringExtension.index(of:)` devuelve
 *    `range.lowerBound`) e `index(after:)` avanza **UNO**. Con `\r\n`, el mensaje sale bien pero el `\n`
 *    queda al frente del buffer y **arranca el mensaje siguiente**. En Android el mismo caso funciona
 *    (el Java avanza `index + delimiter.length()`), así que esto NO se puede unificar con el chequeo del
 *    SPP: es una diferencia real entre las dos ramas de la misma librería, y hay un test diferencial que
 *    la fija para que nadie las "unifique" después.
 *
 * El carácter tiene que ser además ASCII: el buffer se decodifica con `nonLossyASCII` (el default del
 * nativo — ver `mfiConnectOptions`), donde un byte ≥ 0x80 hace fallar la decodificación entera.
 */
export function mfiDelimiterIsSupported(delimiter: unknown): delimiter is string {
  if (typeof delimiter !== 'string' || delimiter.length !== 1) return false;
  return delimiter.charCodeAt(0) < 0x80;
}

/** Los params del transporte `mfi` de un driver, ya resueltos y validados. */
export interface MfiParams {
  readonly protocolString: string;
  readonly delimiter: string;
}

export type MfiParamsFailure = 'driver-sin-mfi' | 'delimitador-no-soportado';

export type MfiParamsResult =
  | { readonly ok: true; readonly params: MfiParams }
  | { readonly ok: false; readonly reason: MfiParamsFailure };

/**
 * Resuelve los params del transporte `mfi` del driver (RBM4.4/RBM4.9). PURO y exportado → testeable sin
 * device: confirma que el adapter toma la cadena de protocolo y el fin de trama **DEL DRIVER** y no de
 * una constante hardcodeada (que es la deuda RMV5.2 que este delta vino a cerrar).
 *
 * Resultado DISCRIMINADO y no `null`, igual que `resolveBleGattParams`: el adapter tiene que poder decir
 * en el log **por qué** no abre la sesión — "este lector no habla MFi" (normal) y "el driver declara un
 * terminador que este transporte no puede framear" (bug de configuración) se ven idénticos desde la UI.
 */
export function resolveMfiParams(driver: ReaderDriver): MfiParamsResult {
  const cap = driver.transports.find((t) => t.kind === 'mfi');
  if (!cap || cap.kind !== 'mfi') return { ok: false, reason: 'driver-sin-mfi' };
  // `??` y no `||`: un delimitador declarado VACÍO tiene que llegar al chequeo y ser rechazado con su
  // motivo, no caer al default en silencio.
  const delimiter = cap.params.delimiter ?? SPP_DELIMITER;
  if (!mfiDelimiterIsSupported(delimiter)) return { ok: false, reason: 'delimitador-no-soportado' };
  return { ok: true, params: { protocolString: cap.params.protocolString, delimiter } };
}

/**
 * Opciones del `connectToDevice` de la **rama iOS**. Las claves y su forma salen del Swift instalado, y
 * cada omisión de acá es deliberada porque el nativo la maneja mal:
 *
 * · `CONNECTION_TYPE` — el ÚNICO nombre que iOS lee (`connectionOptions["CONNECTION_TYPE"] ?? "delimited"`,
 *   `RNBluetoothClassic.swift:270`). La variante en minúscula que usa el SPP de Android (`connectionType`)
 *   acá se ignora en silencio. Se pasa explícito aunque coincida con el default.
 * · `DELIMITER` — se prueba antes que `delimiter` (`DelimitedString…:70-72`). Es el fin de trama DEL
 *   DRIVER (`resolveMfiParams`), ya validado como de un carácter.
 * · **NO se pasa `charset`/`DEVICE_CHARSET`**, y no por olvido: el nativo hace
 *   `String.Encoding.from(value as! CFStringEncoding)` — un **force-cast a UInt32**. El SPP de Android
 *   pasa `charset: 'ascii'` (un STRING), y ese mismo objeto en iOS **crashea la app** (no falla la
 *   conexión: trapea en Swift). Sin la clave, el nativo usa `nonLossyASCII`, que es lo que hace falta:
 *   un byte = un carácter, con el `STX 0x02` del RS420 conservado (es el mismo requisito que RBM2.7 le
 *   pone al BLE). Es también el motivo por el que este objeto NO puede ser `sppConnectOptions()`.
 * · **NO se pasa `read_size`**: el nativo tiene un bug de encadenado (`if let READ_SIZE {…}` y después
 *   `if let read_size {…} else { 1024 }`, `DelimitedString…:66-68`), así que un `READ_SIZE` en mayúscula
 *   queda **sobrescrito por el default** y solo funciona la minúscula. El default (1024) es holgado para
 *   una trama de ~20 bytes: pasar la clave sería confiar en un camino roto sin ganar nada.
 */
export interface MfiConnectOptions {
  readonly CONNECTION_TYPE: 'delimited';
  readonly DELIMITER: string;
}

export function mfiConnectOptions(delimiter: string): MfiConnectOptions {
  return { CONNECTION_TYPE: 'delimited', DELIMITER: delimiter };
}

/**
 * Por qué rechazó `connectToDevice` en iOS. Cada valor es un `reject(abbr, …)` del nativo, y están
 * separados porque **la acción que corresponde es distinta** (ver `mfiConnectRetryPolicy`):
 *
 * · `radio-apagada`         → `bluetooth_disabled`: los guards `checkBluetoothAdapter()` del nativo. En
 *                             iOS no hay API para pedir que la prendan (eso es Android): solo Ajustes.
 * · `accesorio-ausente`     → `device_not_found`: el accesorio no está en `connectedAccessories`, o sea
 *                             está apagado o **no emparejado desde Ajustes**. Es el caso normal.
 * · `protocolo-rechazado`   → `connect_failed` (código 201): `determineProtocolString` no encontró
 *                             intersección entre el plist y `accessory.protocolStrings`. Reintentar no
 *                             puede arreglarlo: hace falta OTRO BUILD (RBM4.5, en runtime).
 * · `sesion-fallida`        → `connection_failed` (`BluetoothError.CONNECTION_FAILED`): la `EASession`
 *                             volvió nil o los streams no abrieron. Puede ser transitorio (otra app con
 *                             la sesión tomada, accesorio ocupado).
 * · `opciones-invalidas`    → `invalid_connection_type`: un bug NUESTRO en las opciones. No se reintenta.
 * · `error`                 → cualquier otra cosa (incluido un vencimiento del puente).
 */
export type MfiConnectFailure =
  | 'radio-apagada'
  | 'accesorio-ausente'
  | 'protocolo-rechazado'
  | 'sesion-fallida'
  | 'opciones-invalidas'
  | 'error';

/**
 * Clasifica el rechazo del nativo. Mira el `code` que React Native pone en el error a partir del `abbr`
 * del `reject(...)` y, si no vino, **el mensaje** — los mensajes también son literales del nativo
 * (`BluetoothError.info.message` / los `NSError` de `RNBluetoothClassic.swift`), así que la caída no es
 * adivinanza. Nunca tira: cualquier forma inesperada cae en `'error'`.
 */
export function classifyMfiConnectError(error: unknown): MfiConnectFailure {
  const bag = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof bag.code === 'string' ? bag.code : '';
  const message = typeof bag.message === 'string' ? bag.message : '';
  const haystack = `${code} ${message}`.toLowerCase();
  if (haystack.includes('bluetooth_disabled') || haystack.includes('bluetooth is not enabled')) {
    return 'radio-apagada';
  }
  if (haystack.includes('device_not_found') || haystack.includes('not currently bonded')) {
    return 'accesorio-ausente';
  }
  if (haystack.includes('invalid_connection_type')) return 'opciones-invalidas';
  // ⚠️ `connect_failed` (201, sin intersección de protocolo) y `connection_failed` (200, la EASession
  // falló) son DOS códigos distintos del nativo con dos acciones distintas, y ninguna de las dos cadenas
  // contiene a la otra — pero un `includes('connect')` las mezclaría, y mezclarlas significa martillar la
  // radio para siempre por algo que solo se arregla con otro build. Se comparan COMPLETAS, y hay test de
  // que no se confunden entre sí.
  if (haystack.includes('connect_failed') || haystack.includes('could not establish connection')) {
    return 'protocolo-rechazado';
  }
  if (haystack.includes('connection_failed') || haystack.includes('could not connect to eaaccessory')) {
    return 'sesion-fallida';
  }
  return 'error';
}

/**
 * ¿Reintentar después de este rechazo? Tabla EXHAUSTIVA (`satisfies`): un motivo nuevo **no compila**
 * hasta declarar su política, en vez de heredar "reintentar" en silencio.
 *
 * `'stop'` es para las dos causas que un reintento no puede cambiar: la cadena de protocolo que este
 * build no declara y un error nuestro en las opciones. Martillar la radio ahí es gasto de batería con
 * cero chances (y en el caso del protocolo, el diagnóstico correcto es de BUILD — lo dice el log).
 */
export const MFI_CONNECT_RETRY: Record<MfiConnectFailure, 'retry' | 'stop'> = {
  'radio-apagada': 'retry', // la pueden prender del centro de control en cualquier momento
  'accesorio-ausente': 'retry', // lo pueden prender o emparejar desde Ajustes
  'protocolo-rechazado': 'stop', // hace falta otro build: no lo arregla ningún reintento
  'sesion-fallida': 'retry', // puede ser otra app con la sesión tomada
  'opciones-invalidas': 'stop', // bug nuestro
  error: 'retry',
} as const satisfies Record<MfiConnectFailure, 'retry' | 'stop'>;

export function mfiConnectRetryPolicy(failure: MfiConnectFailure): 'retry' | 'stop' {
  return MFI_CONNECT_RETRY[failure];
}

/**
 * Por qué el transporte MFi no está resuelto, para el log (`mfi_unavailable`). Es el union de
 * `MfiUnavailableReason` (los tres motivos del GATE de datos, que la UI también usa) más los que solo
 * existen en runtime. Está declarado UNA vez y `logging.ts` lo **importa**: dos unions gemelos escritos a
 * mano fue exactamente el bug que el review de F1 encontró con `RejectReason` (un motivo nuevo se
 * agregaba de un lado y se perdía del otro, sin que nada se pusiera rojo).
 */
export type MfiUnresolvedReason =
  | MfiUnavailableReason
  | MfiParamsFailure
  /** No es iOS: ExternalAccessory no existe en Android ni en web. */
  | 'plataforma-no-ios'
  /** El binario de la lib no está en este build (o no hay RN: web/CI). */
  | 'modulo-nativo-ausente';
