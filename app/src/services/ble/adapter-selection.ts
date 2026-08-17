// Selección del adaptador activo según plataforma/entorno (R10.3, R11.2). PURO (sin RN) →
// testeable. El provider monta el adaptador que esta función elige; cada adaptador vive
// detrás de la MISMA interfaz StickAdapter (R11.2), así sumar/quitar uno no toca el contrato.
//
// Reglas (design §"Decisión de orden de build" + R10.3):
//   - mock: si se fuerza por toggle de dev/CI (mode='mock').
//   - web-serial: en web (Platform.OS === 'web').
//   - spp-android: en Android (Bluetooth Classic SPP nativo — Fase 4, CONSTRUIDA 2026-07-29).
//   - hid-wedge: GATED (R8.7) → nunca se elige hasta pasar el gate.
//   - manual: PISO siempre disponible (R7) — no es "el activo" exclusivo, corre en paralelo.
//
// Esta función elige el KIND; que ese kind se pueda INSTANCIAR en este build es otra decisión y
// vive en `instantiateTransport` (que para 'spp-android' chequea que el módulo nativo esté
// realmente presente). Separadas a propósito: un dev build viejo, sin el binario de
// `react-native-bluetooth-classic`, sigue eligiendo 'spp-android' pero NO monta transporte → la
// app queda manual-first y el chip/CTA se ocultan solos (guard de `hasTransport`).

import type { FrameParser, ReaderDriver } from './driver-types';
// `isAdapterUsableOn` se DERIVA de `adapterForTransport` (una sola tabla plataforma↔transporte↔adapter) y
// `selectReaderBinding` es el mismo motor que usa la pantalla para cada fila (`transportChoices`, abajo).
// El import cruzado NO es un ciclo en runtime: `selection-priority.ts` solo importa de acá el TIPO
// `AdapterKind` (`import type`, erasado), así que el grafo de módulos tiene un solo sentido.
//
// ⚠️ Lo que este archivo NO puede importar es un módulo de FABRICANTE (`driver-*`, `parser-*`, y el
// `driver-registry`): es una de las dos superficies CIEGAS AL FABRICANTE (RBM1.7) y hay guard sobre eso
// (`adapter-ingest-mode.test.ts`). El registro entra INYECTADO desde la pantalla — ver `TransportChoicesEnv`.
import { isAdapterUsableOn, selectReaderBinding, type ReaderBinding } from './selection-priority';

// Delta multivendor (RMV2.7, RMV4.1): `'simulator'` se agrega de forma ADITIVA al union del core.
// Es el adapter del camino de demo (dev/demo-gated, triple-guard) — no cambia ninguno de los otros.
//
// Delta ios-ble-mfi (RBM2.11, T3.7): `'ble-gatt'` entra igual de aditivo — es el transporte BLE GATT
// cross-platform (`adapter-ble-gatt.ts`, mismo código en iOS y Android). Agregarlo al union deja en
// ROJO, por typecheck, las tres tablas que tienen que declararlo (`ADAPTER_INGEST_MODE`,
// `ADAPTER_KINDS`, `permissionModelFor`) y el switch de `instantiateTransport`: eso es el mecanismo, no
// un efecto colateral.
//
// `'mfi-ios'` entra en **F4** y no en F5 (donde el task lo ponía, T5.3), por una razón de compilación y
// no de gusto: T4.1/RBM5.2 exigen que `adapterForTransport('mfi','ios')` devuelva ese literal, y
// RBM5.5 que su binding calcule `available` — o sea que el union tiene que tenerlo para que F4
// compile. Lo que F4 declara es SOLO el kind y sus tablas; el ADAPTER (`adapter-mfi-ios.ts`) sigue
// siendo F5 y hasta entonces `instantiateTransport('mfi-ios')` devuelve `null` (transporte no montado →
// carga manual como piso, RBM5.10).
export type AdapterKind =
  | 'manual'
  | 'mock'
  | 'web-serial'
  | 'spp-android'
  | 'ble-gatt'
  | 'mfi-ios'
  | 'hid-wedge'
  | 'simulator';

// 'auto' = elige por plataforma (web-serial en web). 'mock' = adapter-mock (CI/dev toggle, R10.2).
// 'manual' = SIN transporte buildable, solo el piso manual (native manual-first / captura del sub-estado
// "manual promovido" del hero adaptativo de la manga, spec 03 M2.1) → instantiateTransport devuelve null.
// 'demo' = camino de demo por simulador (delta multivendor, RMV2.7/RMV4.3): SOLO bajo el gate demo
// (dev/demo-build); en producción `mode='auto'` NUNCA elige el simulador (triple-guard 1).
export type ProviderMode = 'auto' | 'mock' | 'manual' | 'demo';

export interface SelectionEnv {
  /** Platform.OS del runtime ('web' | 'ios' | 'android' | ...). */
  platformOS: string;
  /** Modo del provider: 'mock' fuerza el adapter-mock (CI/dev toggle, R10.2). */
  mode: ProviderMode;
  /**
   * El transporte del BASTÓN RECORDADO (RBM5.6), hidratado por el provider desde
   * `readRememberedDevice().adapterKind`. `undefined` = sin preferencia → piso por plataforma (RBM5.7,
   * que es también el caso del formato viejo del registro).
   *
   * OPCIONAL a propósito: los call sites que no tienen de dónde saberlo (y los tres modos que cortan
   * antes) no cambian de forma. Lo que NO es opcional es la validación: ver `honorsPreference`.
   */
  preferredAdapter?: AdapterKind;
}

/**
 * Adaptadores que NO se pueden ELEGIR como transporte activo aunque algo los prefiera.
 *
 * La regla que los une —y el criterio para entrar y salir de esta lista— es una sola: **`AdapterKind`
 * que `instantiateTransport` no puede construir hoy**. Honrar una preferencia así no deja al operario con
 * "el transporte que pidió": lo deja **sin ninguno**, porque le saca el piso por plataforma y devuelve un
 * kind que se instancia en `null`. Y el que la escribe es un valor de STORAGE (RBM5.6 es la primera
 * entrada por la que storage elige un transporte), así que el invariante dejó de ser cierto "porque
 * ninguna rama lo escribe".
 *
 *   · `'hid-wedge'`: GATEADO por el gate físico de R8.7/RBM8 (`adapter-hid-wedge.ts` es un placeholder).
 *     El mundo malo concreto: un registro manoseado —o un downgrade después de que F7 exista— le saca a
 *     Android su `spp-android` y lo deja sin transporte, en silencio.
 *   · `'mfi-ios'` (🟡-1 del review de F4): el kind existe desde F4 porque el mapeo de RBM5.2 y el
 *     `available` de RBM5.5 lo exigen, pero `adapter-mfi-ios.ts` es **F5** y hasta entonces
 *     `instantiateTransport('mfi-ios')` devuelve `null`. Sin este gate, una preferencia `'mfi-ios'` le
 *     quita a un iPhone el `ble-gatt` que le corresponde por piso y lo deja **sin transporte**, en
 *     silencio — el MISMO escenario con el que se justificó gatear `hid-wedge`, y con fecha: **F5 va a
 *     escribir ese `adapterKind`**. Tratar los dos casos distinto era la asimetría que el review marcó.
 *
 * Los otros kinds que no son transportes elegibles por preferencia (`manual`, `mock`, `simulator`) ya
 * quedan afuera por `isAdapterUsableOn`: ningún `TransportKind` mapea a ellos.
 *
 * ⚠️ Sacar un kind de esta lista es una decisión visible en el diff, y tiene que salir **en el mismo diff
 * que lo construye** (`BUILT_ADAPTERS` de la pantalla + `instantiateTransport`): el guard de
 * alcanzabilidad de `wiring.test.ts` verifica las dos direcciones — que nada no-construido se honre, y
 * que nada construido quede sin forma de elegirse.
 */
const NOT_SELECTABLE_AS_PREFERENCE = ['hid-wedge', 'mfi-ios'] as const satisfies readonly AdapterKind[];

/**
 * ¿Se honra la preferencia del bastón recordado? (RBM5.6.) Dos condiciones, las dos fail-closed:
 *   (1) el `AdapterKind` puede existir en ESTA plataforma (`isAdapterUsableOn`, derivado de
 *       `adapterForTransport` → una sola tabla de la verdad). Un teléfono que cambió de plataforma no
 *       existe, pero un registro escrito en Android y restaurado en un backup de iOS sí, y montar
 *       `spp-android` en iOS sería un transporte imposible;
 *   (2) el kind no está gateado (`NOT_SELECTABLE_AS_PREFERENCE`).
 * Si alguna falla, se cae al piso por plataforma — nunca se deja al operario sin transporte por un dato
 * de storage.
 */
function honorsPreference(kind: AdapterKind | undefined, platformOS: string): kind is AdapterKind {
  if (kind == null) return false;
  if ((NOT_SELECTABLE_AS_PREFERENCE as readonly AdapterKind[]).includes(kind)) return false;
  return isAdapterUsableOn(kind, platformOS);
}

/**
 * Elige el adaptador de TRANSPORTE activo (además del manual, que es piso permanente).
 * Devuelve el `kind` del transporte a montar: 'mock' si se fuerza, el del BASTÓN RECORDADO si hay uno
 * usable (RBM5.6), 'web-serial' en web, 'spp-android' en Android (RS420 por Classic SPP) y —desde este
 * delta— 'ble-gatt' en iOS. NUNCA elige 'hid-wedge' (GATED, R8.7).
 *
 * ── EL ORDEN DE LAS RAMAS ES PARTE DEL CONTRATO ──────────────────────────────────────────────────
 * `mock` / `demo` / `manual` se chequean ANTES de la preferencia, así que los tres devuelven
 * EXACTAMENTE lo mismo que antes del delta (RBM5.9) y las ~70 specs E2E —que corren en `mock`— tienen
 * CERO riesgo, igual que cuando entró `autoConnect`. La preferencia va después de esos tres y antes de
 * la plataforma: es lo que hace que el transporte siga al bastón que el operario eligió y no a la
 * plataforma sola (sin esto, en Android se monta siempre `spp-android` y un lector BLE es inalcanzable
 * en producción justo donde está el productor argentino).
 *
 * ── iOS PASA DE 'manual' A 'ble-gatt' (RBM5.6, design §6.2) ──────────────────────────────────────
 * Es el único transporte que iOS tiene hoy (el SPP no existe ahí y MFi está gateado por la cadena del
 * fabricante). Si el build no trae el módulo nativo de BLE, `instantiateTransport` devuelve `null` y la
 * app queda manual-first EXACTAMENTE como antes (mismo guard que `isSppNativeAvailable`): la selección
 * elige el kind, la instanciación decide si se puede montar. Son dos decisiones separadas a propósito.
 */
export function selectTransportAdapter(env: SelectionEnv): AdapterKind {
  if (env.mode === 'mock') return 'mock';
  // Delta multivendor (RMV2.7/RMV4.3, triple-guard 1): la rama demo va ANTES de la lógica de
  // plataforma y NUNCA la alcanza `mode='auto'` (el default de producción). Solo `mode='demo'`
  // (que el host pone bajo el gate demo) devuelve el simulador. Los modos auto/mock/manual
  // devuelven EXACTAMENTE lo mismo que antes del delta (regresión cubierta por wiring/selection tests).
  if (env.mode === 'demo') return 'simulator';
  // 'manual' fuerza el piso manual SIN transporte buildable (instantiateTransport('manual') → null). Lo usa
  // el provider bajo el flag de E2E para reproducir el sub-estado "manual promovido" del hero (transport==null).
  if (env.mode === 'manual') return 'manual';
  // Delta ios-ble-mfi (RBM5.6): el transporte del BASTÓN RECORDADO gana al piso por plataforma. Validado
  // (usable en esta plataforma + no gateado) para que un dato de storage no pueda dejar a nadie sin
  // transporte.
  if (honorsPreference(env.preferredAdapter, env.platformOS)) return env.preferredAdapter;
  if (env.platformOS === 'web') return 'web-serial';
  // Android → SPP nativo (Bluetooth Classic). Es el único transporte con el que el RS420 habla en
  // Android, y desde 2026-07-29 el adapter + la dep nativa están en el build.
  if (env.platformOS === 'android') return 'spp-android';
  // iOS → BLE GATT (delta ios-ble-mfi): el único transporte que iOS tiene hoy. Sin el módulo nativo en
  // el build, `instantiateTransport` devuelve null y la app queda manual-first como antes.
  if (env.platformOS === 'ios') return 'ble-gatt';
  // Cualquier otra plataforma (macos, windows, un web-view raro): sin transporte alcanzable → piso
  // manual, la app funciona igual.
  return 'manual';
}

// ─── ELEGIR EL TRANSPORTE POR GESTO (🟠-2 del review de F4, RBM5.6/RBM5.14) ──────────────────────
//
// ── EL PROBLEMA QUE CIERRA, DICHO SIN ADORNOS ───────────────────────────────────────────────────
// RBM5.6 monta el transporte del BASTÓN RECORDADO, y el `adapterKind` de ese registro lo escribe **el
// adapter que conectó**. En Android eso cerraba un bucle sin entrada: para que la preferencia diga
// `ble-gatt` hay que haber conectado por `ble-gatt`, y para conectar por `ble-gatt` hay que tenerlo
// montado, y solo se monta si la preferencia lo dice. Huevo y gallina → **el transporte BLE quedaba
// inalcanzable en producción justo en la plataforma donde está el productor argentino**, que es
// literalmente el problema que RBM5.6 dice resolver, y el banco de Android (F6/T6.2) no tenía con qué
// arrancar. Es el mismo patrón que ya pagamos con R6.6 (un mecanismo completo, con cero call sites): un
// mecanismo sin escritor es una promesa, no una función.
//
// ── LA FORMA: LA PANTALLA OFRECE LOS TRANSPORTES, EL ADAPTER SIGUE SIENDO EL ÚNICO QUE PERSISTE ──
// `transportChoices` devuelve los transportes que ESTA plataforma puede montar y que **no** son el que
// está montado ahora. La pantalla los renderiza con el MISMO `deviceRowView` que el resto de las filas
// (nombre del lector + estado), y tocar una:
//   1. le pide al provider montar ese `AdapterKind` (`chooseTransport`, gesto del operario);
//   2. el provider lo monta y lo CONECTA (`mountActionFor` → `'connect'`, o sea trigger `operator`);
//   3. el adapter escanea/dialoga, y al conectar **persiste el device que contestó** junto con su
//      `adapterKind` (`writeRememberedDevice(id, {adapterKind})`) → el próximo arranque monta ESE
//      transporte solo.
// O sea: no se persiste nada en el momento de elegir. Es deliberado y es la lección de MEDIUM-2 + del
// `vendorId` guardado como si fuera un id de device: **lo único que se recuerda es lo que funcionó**, y
// el único que sabe con qué id y por qué transporte se abrió el link es el adapter.
//
// ── POR QUÉ VIVE EN ESTE ARCHIVO Y NO EN `selection-priority.ts` ────────────────────────────────
// Sería el lugar "natural" (ese módulo se declara como *la capa que la pantalla usa cuando el operario
// elige*), pero esta función tiene que preguntarle a `selectTransportAdapter` si la preferencia se
// honraría —y esa función vive ACÁ—, así que ponerla allá crearía un ciclo de runtime real entre los dos
// módulos (hoy el grafo tiene un solo sentido y está declarado arriba). La alternativa era inyectar el
// predicado y perder la derivación real en el test; se eligió no partir la verdad en dos.
//
// ── POR QUÉ NO HAY UNA LISTA DE RESULTADOS DE ESCANEO (el "listar → elegir" de RBM5.14) ─────────
// El `StickAdapter` no expone el escaneo y RBM9.6 prohíbe tocar su interfaz en este delta. Escanear por
// afuera del adapter sería una SEGUNDA implementación de la misma operación de radio (con sus permisos,
// su presupuesto y su `stopDeviceScan`), y dos implementaciones de la misma verdad divergen — es el bug
// de clase de este camino. Lo que se ofrece es la fila **del lector**, que es la decisión que el operario
// realmente toma ("quiero usar ESTE bastón"); el escaneo filtrado por `serviceUuid` + el reconocimiento
// por `deviceMatch` los sigue haciendo el adapter, que es donde están probados.

/** Un transporte que el operario puede ELEGIR desde la pantalla de conexión (RBM5.14). */
export interface TransportChoice {
  /** El `AdapterKind` que se monta al elegirla. */
  adapterKind: AdapterKind;
  /** El binding de ese lector en esta plataforma: de acá sale la fila (título, estado, tono). */
  binding: ReaderBinding;
  /**
   * El lector con el que ese transporte va a hablar. Es **el primero del registro** que resuelve a ese
   * `AdapterKind`, que es exactamente la regla con la que el adapter elige el suyo (`bleGattDriverFrom`,
   * y el default del SPP): si divergieran, la fila prometería un lector que el transporte no va a usar.
   * Hay un test que lo cruza contra el `driver` de los adapters instanciados.
   */
  driver: ReaderDriver;
  /**
   * ¿Ese transporte se puede INSTANCIAR en este build/dispositivo? Entra inyectado (`canInstantiate`)
   * porque la respuesta depende de `NativeModules` y esta capa es pura. Decide si la fila es accionable:
   * sin esto, tocarla dejaría al operario sin transporte (el kind se monta en `null`) — la afordancia
   * muerta que el bugfix del 2026-07-29 cerró.
   */
  installable: boolean;
}

export interface TransportChoicesEnv {
  platformOS: string;
  /**
   * El MODO del provider, y es OBLIGATORIO por un bug medido (lo encontró la E2E del capture, no un
   * razonamiento): `mock`, `demo` y `manual` cortan ANTES de la preferencia en `selectTransportAdapter`
   * (RBM5.9), así que en esos tres modos elegir un transporte **no puede montar nada** — y ofrecerlo era una
   * fila que además DUPLICABA la del transporte montado (en `mock`, el kind montado no es el piso de la
   * plataforma, así que el piso aparecía como "alternativa"). Con el modo acá, la derivación de abajo los
   * deja afuera solos, y las ~70 specs E2E —que corren en `mock`— ven CERO filas nuevas.
   */
  mode: ProviderMode;
  /**
   * El `kind` del transporte MONTADO ahora (`provider.transport?.kind`). Se EXCLUYE de la lista: la
   * pantalla ya lo muestra en su fila/sección propia, y ofrecerlo dos veces invita a "cambiar" a lo mismo.
   * `undefined` (no se pudo instanciar nada) → no se excluye ninguno.
   */
  mountedKind?: AdapterKind;
  /** Adaptadores construidos en este build (la MISMA lista que alimenta el binding de la pantalla). */
  builtAdapters: AdapterKind[];
  /** Cadenas de protocolo MFi declaradas por el build (RBM5.5), requerida por el mismo motivo. */
  declaredEaProtocols: readonly string[];
  /** ¿Se puede instanciar ese kind acá y ahora? (`isSppNativeAvailable`/`isBleGattTransportAvailable`). */
  canInstantiate: (kind: AdapterKind) => boolean;
  /**
   * El registro de lectores. **REQUERIDO y sin default a `DRIVER_REGISTRY`**, y no es una preferencia de
   * estilo: este módulo es una de las dos SUPERFICIES CIEGAS AL FABRICANTE (RBM1.7, guard en
   * `adapter-ingest-mode.test.ts`). Nombrar acá el registro abriría la puerta a `DRIVER_REGISTRY[0]
   * .frameParser` — el fallback silencioso que el review de F1 falsificó (mutante MR1b) y que produce
   * lecturas para UN lector y silencio total para todos los demás. El registro entra desde la pantalla,
   * que sí conoce lectores porque muestra sus nombres.
   */
  registry: ReaderDriver[];
}

/**
 * Los transportes ALTERNATIVOS que el operario puede elegir en esta plataforma (RBM5.14), en orden
 * determinístico (el del registro, RBM5.8).
 *
 * Un transporte entra solo si elegirlo **haría algo**, y eso NO se decide con una segunda tabla: se
 * DERIVA de `selectTransportAdapter` **con el modo real del provider**, preguntándole si honraría esa
 * preferencia. Consecuencias que salen gratis: un kind gateado (`hid-wedge`, y `mfi-ios` hasta F5) no se
 * ofrece nunca; uno que no existe en la plataforma tampoco (`spp-android` en iOS, RBM5.3); en `mock`,
 * `demo` y `manual` la lista es **vacía** (esos modos ignoran la preferencia, RBM5.9); y el día que un gate
 * se abra, la fila aparece sin tocar esta función.
 */
export function transportChoices(env: TransportChoicesEnv): TransportChoice[] {
  const choices: TransportChoice[] = [];
  const seen = new Set<AdapterKind>();
  for (const driver of env.registry) {
    const binding = selectReaderBinding({
      platformOS: env.platformOS,
      driver,
      builtAdapters: env.builtAdapters,
      declaredEaProtocols: env.declaredEaProtocols,
    });
    if (binding === null) continue; // ese lector no es alcanzable en esta plataforma (RMV2.5)
    const kind = binding.adapterKind;
    if (kind === env.mountedKind) continue; // ya está montado: no es una alternativa
    // Un `AdapterKind` una sola vez: al montarlo, el adapter usa EL PRIMER driver del registro que lo
    // declara, así que una segunda fila del mismo transporte prometería un lector que no se va a usar.
    // (Que hoy no haya dos lo vigila el guard de `adapter-ble-gatt.test.ts`; esto lo hace inofensivo.)
    if (seen.has(kind)) continue;
    if (
      selectTransportAdapter({ platformOS: env.platformOS, mode: env.mode, preferredAdapter: kind }) !== kind
    ) {
      continue; // la selección NO honraría esa preferencia (modo, gate o plataforma) → ofrecerla sería mentir
    }
    seen.add(kind);
    choices.push({ adapterKind: kind, binding, driver, installable: env.canInstantiate(kind) });
  }
  return choices;
}

/**
 * Qué hace el provider con un transporte RECIÉN MONTADO. Son tres cosas distintas y hasta ahora la
 * decisión era un `autoConnect?.()` suelto:
 *   · `'connect'`     → lo montó un GESTO del operario (eligió ese transporte en la pantalla): conectar
 *                       de una, con trigger `operator` (puede pedir permisos y su cadena no tiene tope).
 *                       Sin esto, elegir un transporte exigiría **dos** taps —uno para montarlo y otro
 *                       para conectarlo— con un cambio de layout en el medio.
 *   · `'autoconnect'` → arranque normal: el adapter decide solo, y su primer gate es "¿hay bastón
 *                       recordado?" (R6.4/RBM3.8: un arranque en frío no toca la radio).
 *   · `'none'`        → el transporte no auto-conecta (mock/simulator los dispara su propio botón;
 *                       web-serial NO PUEDE, la Web Serial API exige un gesto para `requestPort()`).
 *
 * Es una función pura y no un `if` adentro del provider porque el provider es `.tsx`: lo que se decide
 * ahí adentro solo se puede vigilar con un regex, y un regex vigila la grafía de hoy.
 */
export type MountAction = 'connect' | 'autoconnect' | 'none';

export function mountActionFor(env: { chosenByGesture: boolean; canAutoConnect: boolean }): MountAction {
  if (env.chosenByGesture) return 'connect';
  return env.canAutoConnect ? 'autoconnect' : 'none';
}

// ─── Modo de INGESTA por adaptador (🟡-1 del review, 2026-07-30) ─────────────────────────────────
//
// Cómo entra al contrato lo que emite un adapter. Son dos puertas distintas del MISMO motor
// (`EidIngestEngine`) y elegir la equivocada deja el bastón MUDO con la suite entera en verde:
//   · 'raw-line' → línea CRUDA del lector → `processRawLine` → el `frameParser` del DRIVER de ese
//                  adapter (para el RS420, `parseRs420Line`: descarta STX, cabecera fija y
//                  timestamp) → `isValidTag`. Con qué parser exactamente lo resuelve
//                  `resolveFrameParser` (abajo), fail-closed si el adapter no expone driver.
//   · 'eid'      → el adapter ya entrega el EID limpio (manual, mock, simulador, y el wedge HID
//                  cuando destrabe R8.7) → `processEid`, sin desframear nada.
//
// ── POR QUÉ ES UNA TABLA Y NO UN `kind === 'x' || kind === 'y'` INLINE ──────────────────────────
// Hasta hoy la decisión vivía como una comparación de DOS LITERALES dentro de
// `BleStickListenerProvider.tsx`, sin un solo test. Si a esa lista le faltara `spp-android`, cada
// trama del RS420 iría por `processEid` → `normalizeTag` le saca el STX → quedan 34 dígitos →
// `isValidTag` false → `invalid_eid`, CERO lecturas, y ni la suite unit ni la E2E (que corre en web
// con mock/manual/simulator) lo verían. Es la TERCERA repetición de la misma clase de bug de este
// camino (framing invertido, `isRawStream`, `BLE_OWNED_ROUTES`).
//
// El guard se escribe sobre LA AUSENCIA: `satisfies Record<AdapterKind, IngestMode>` hace que un
// `AdapterKind` nuevo **no compile** hasta declarar su modo — un adapter nuevo nace en rojo. El
// complemento en runtime (una lista independiente de kinds + el chequeo de que el provider llame a
// `ingestModeFor`) vive en `adapter-ingest-mode.test.ts`.
export type IngestMode = 'raw-line' | 'eid';

export const ADAPTER_INGEST_MODE = {
  manual: 'eid',
  mock: 'eid',
  simulator: 'eid',
  'web-serial': 'raw-line',
  'spp-android': 'raw-line',
  // Delta ios-ble-mfi (RBM2.11): el lector entrega su TRAMA por la característica de notificaciones
  // (el emulador en MODO_GATT reproduce la del RS420, con su STX), no un EID limpio → hay que
  // desframear con el `frameParser` de su driver. Si esta fila dijera 'eid', cada trama iría por
  // `processEid` → `normalizeTag` le saca el STX → 34 dígitos → `isValidTag` false → CERO lecturas,
  // con la suite entera en verde (es literalmente el bug de clase que 🟡-1 vino a cerrar).
  'ble-gatt': 'raw-line',
  // Delta ios-ble-mfi (RBM4.9): el accesorio MFi entrega la TRAMA del lector por el stream de
  // ExternalAccessory (es el mismo RS420 hablando por otro cable), no un EID limpio → `raw-line`, con el
  // `frameParser` del driver. La fila se declara en F4 junto con el kind aunque el adapter llegue en F5:
  // el `satisfies Record<AdapterKind, IngestMode>` no compila sin ella, que es el mecanismo funcionando.
  'mfi-ios': 'raw-line',
  // GATED (R8.7). Un keyboard-wedge tipea los dígitos del EID (y un Enter), no la trama del lector:
  // no hay STX ni cabecera que desframear. Si algún wedge tipeara la trama completa (el `hidraw on`
  // del emulador), ese lector necesita su propio adapter, no cambiar esta fila.
  'hid-wedge': 'eid',
} as const satisfies Record<AdapterKind, IngestMode>;

/** Modo de ingesta de un adaptador. Total sobre `AdapterKind` por construcción (ver arriba). */
export function ingestModeFor(kind: AdapterKind): IngestMode {
  return ADAPTER_INGEST_MODE[kind];
}

// ─── CON QUÉ se desframea una línea cruda (RBM1.1/RBM1.4, delta ios-ble-mfi) ──────────────────────
//
// `ingestModeFor` dice POR QUÉ PUERTA del contrato entra una lectura; esta función dice CON QUÉ
// PARSER se desframea. Son las dos mitades de la MISMA decisión, y por eso viven juntas: separarlas
// fue lo que dejó al contrato llamando `parseRs420Line` hardcodeado mientras el registro de drivers
// declaraba un `frameParser` que **no se invocaba en producción** (deuda RMV5.2, cerrada acá).
//
// ── FAIL-CLOSED, Y POR QUÉ NO "SI NO HAY DRIVER, RS420" (RBM1.4) ────────────────────────────────
// La alternativa tentadora es caer al parser del RS420 cuando el adapter no expone driver. Está
// descartada con motivo: ese fallback produce lecturas para UN lector y **silencio total** para
// todos los demás, y el silencio es indistinguible de "el operario no está bastoneando" — el mismo
// síntoma que costó el terminador equivocado del SPP (🟠-5 / BENCH-2: `term cr` → 0 ingestas, 0
// errores, en device). Un rechazo con log es diagnosticable; un fallback, no.
//
// ── POR QUÉ EL SINK DEL LOG SE INYECTA Y NO SE IMPORTA ──────────────────────────────────────────
// Esta función es PURA (sin RN, sin I/O, sin importar `logging.ts`) y el aviso del camino
// fail-closed entra por `onUnresolved`, exactamente como `acceptingTargets(subscribers, onError)`
// en `read-dispatch.ts`. Dos consecuencias buscadas: (1) el "null + log" del caso anómalo se
// verifica por COMPORTAMIENTO en node:test con un espía, en vez de por un regex sobre el provider;
// (2) el parámetro es REQUERIDO —no opcional con no-op por default— porque un call site que se
// olvide del sink perdería la única señal de que el transporte montado no puede parsear nada.

/**
 * El `frameParser` con el que hay que desframear las líneas de ESTE adaptador, o `null` si no hay
 * ninguno aplicable.
 *
 * - modo `'eid'` (manual, mock, simulator, hid-wedge) → `null` **normal y silencioso**: esos
 *   adaptadores ya entregan el EID limpio y no hay nada que desframear (entran por `processEid`).
 * - modo `'raw-line'` con driver → el `frameParser` de su `ReaderDriver` (RBM1.1).
 * - modo `'raw-line'` SIN driver → `null` + `onUnresolved(kind)`: fail-closed (RBM1.4). El caller
 *   DEBE descartar la línea; nunca caer a un parser por defecto.
 */
export function resolveFrameParser(
  adapter: { readonly kind: AdapterKind; readonly driver?: ReaderDriver },
  onUnresolved: (kind: AdapterKind) => void,
): FrameParser | null {
  if (ingestModeFor(adapter.kind) !== 'raw-line') return null;
  const parser = adapter.driver?.frameParser;
  // `typeof parse === 'function'` y no solo `!= null`: un driver a medio escribir (o venido de un
  // JSON/config) puede traer un `frameParser` sin `parse`, y eso tiene que caer del lado del
  // descarte —igual que no traer driver— en vez de tirar `frameParser.parse is not a function`
  // dentro del read-loop del transporte.
  if (!parser || typeof parser.parse !== 'function') {
    onUnresolved(adapter.kind);
    return null;
  }
  return parser;
}

// ─── DE DÓNDE VINO UNA LECTURA, YA RESUELTO (RBM1.1/RBM1.4) ──────────────────────────────────────
//
// `ReadSource` + `readSourceFor` VIVÍAN EN EL PROVIDER hasta el review de F1, y ahí no había forma de
// probarlos: `BleStickListenerProvider.tsx` importa `react-native`, así que ninguna suite `node:test`
// puede importarlo y el único oráculo posible era un REGEX sobre el fuente. El reviewer lo falsificó:
// con `resolveFrameParser(...) ?? DRIVER_REGISTRY[0].frameParser` adentro de esa función —el fallback
// silencioso que RBM1.4 prohíbe, escrito sin nombrar `parseRs420Line` ni `RS420_DRIVER`— el guard
// estático quedaba en VERDE y los 233 tests de las suites BLE también (mutante MR1b).
//
// La función es PURA (kind + `ingestModeFor` + `resolveFrameParser` + un sink inyectado), así que su
// lugar es acá, donde `frame-parser-resolve.test.ts` la ejerce POR COMPORTAMIENTO —identidad del
// parser, `null` + aviso en el fail-closed, silencio en los kinds `'eid'`— y cualquier grafía futura
// del fallback cae por lo que HACE, no por cómo se escribe. El guard estático del provider queda como
// red barata, no como único oráculo.

/**
 * De dónde vino una lectura, YA RESUELTO. Se calcula UNA VEZ al cablear cada adaptador —no por
 * bastonazo— y viaja con la lectura hasta el contrato:
 *   · `kind`        → para poder decir en el log QUÉ transporte quedó sin parser;
 *   · `mode`        → por qué puerta del contrato entra (`ingestModeFor`, tabla exhaustiva 🟡-1);
 *   · `frameParser` → CON QUÉ se desframea, sacado del `ReaderDriver` del adapter
 *                     (`resolveFrameParser`). `null` con `mode==='raw-line'` es el estado
 *                     FAIL-CLOSED: la lectura se descarta y se loguea, nunca cae a un parser por
 *                     defecto (RBM1.4).
 */
export interface ReadSource {
  readonly kind: AdapterKind;
  readonly mode: IngestMode;
  readonly frameParser: FrameParser | null;
}

/**
 * Resuelve el `ReadSource` de un adaptador: las DOS mitades de la misma decisión (por qué puerta entra
 * la lectura y con qué se desframea) resueltas en un solo lugar, para que ninguna superficie se escriba
 * la suya a mano.
 *
 * `onUnresolved` es el sink del aviso del fail-closed, inyectado y REQUERIDO (esta capa es pura y no
 * importa `logging.ts`): el provider le pasa el `parser_unresolved{at:'mount'}` = se cableó un
 * transporte que NO PUEDE parsear nada. Los kinds de modo `'eid'` no avisan nada: no tienen qué
 * desframear (ver `resolveFrameParser`).
 *
 * Se resuelve al CABLEAR y no dentro del camino caliente a propósito: el camino caliente corre una vez
 * por bastonazo y su tabla de invocables (`HOT_PATH_CALLABLE`, `read-dispatch.test.ts`) es una lista
 * cerrada. Eso es correcto **mientras el `driver` sea inmutable por instancia de adapter** (hoy lo es:
 * `readonly` + inyectado por constructor) — ver la nota para F3 en el design del delta.
 */
export function readSourceFor(
  adapter: { readonly kind: AdapterKind; readonly driver?: ReaderDriver },
  onUnresolved: (kind: AdapterKind) => void,
): ReadSource {
  return {
    kind: adapter.kind,
    mode: ingestModeFor(adapter.kind),
    frameParser: resolveFrameParser(adapter, onUnresolved),
  };
}

/**
 * Todos los kinds, ENUMERADOS A MANO, para que algo pueda recorrerlos en runtime.
 *
 * Vive acá y no en el test por un motivo concreto: `app/tsconfig.json` EXCLUYE `**​/*.test.ts`, así que
 * una aserción de tipos escrita en un test **no la chequea nadie** (node:test solo borra los tipos). El
 * ancla de exhaustividad tiene que estar en un archivo que el typecheck sí mire.
 */
export const ADAPTER_KINDS = [
  'manual',
  'mock',
  'web-serial',
  'spp-android',
  'ble-gatt',
  'mfi-ios',
  'hid-wedge',
  'simulator',
] as const satisfies readonly AdapterKind[];

// EXHAUSTIVIDAD en tiempo de compilación: si `AdapterKind` gana un miembro que no está en
// `ADAPTER_KINDS`, `Exclude<…>` deja de ser `never` y esta asignación NO COMPILA.
type KindMissingFromList = Exclude<AdapterKind, (typeof ADAPTER_KINDS)[number]>;
const _adapterKindsAreExhaustive: KindMissingFromList extends never ? true : never = true;
void _adapterKindsAreExhaustive;
