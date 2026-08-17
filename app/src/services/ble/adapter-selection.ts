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

// Delta multivendor (RMV2.7, RMV4.1): `'simulator'` se agrega de forma ADITIVA al union del core.
// Es el adapter del camino de demo (dev/demo-gated, triple-guard) — no cambia ninguno de los otros.
export type AdapterKind = 'manual' | 'mock' | 'web-serial' | 'spp-android' | 'hid-wedge' | 'simulator';

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
}

/**
 * Elige el adaptador de TRANSPORTE activo (además del manual, que es piso permanente).
 * Devuelve el `kind` del transporte a montar: 'mock' si se fuerza, 'web-serial' en web,
 * 'spp-android' en Android (RS420 por Classic SPP). En iOS sigue sin haber transporte alcanzable
 * (el RS420 declara spp+serial y su vía iOS real es MFi, gated por el protocol string del
 * fabricante) → 'manual' como único piso. NUNCA elige 'hid-wedge' (GATED, R8.7).
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
  if (env.platformOS === 'web') return 'web-serial';
  // Android → SPP nativo (Bluetooth Classic). Es el único transporte con el que el RS420 habla en
  // Android, y desde 2026-07-29 el adapter + la dep nativa están en el build.
  if (env.platformOS === 'android') return 'spp-android';
  // iOS y cualquier otra plataforma: sin transporte alcanzable todavía → piso manual (la app
  // funciona igual, manual-first). iOS va aparte (External Accessory + protocol string MFi).
  return 'manual';
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
  'hid-wedge',
  'simulator',
] as const satisfies readonly AdapterKind[];

// EXHAUSTIVIDAD en tiempo de compilación: si `AdapterKind` gana un miembro que no está en
// `ADAPTER_KINDS`, `Exclude<…>` deja de ser `never` y esta asignación NO COMPILA.
type KindMissingFromList = Exclude<AdapterKind, (typeof ADAPTER_KINDS)[number]>;
const _adapterKindsAreExhaustive: KindMissingFromList extends never ? true : never = true;
void _adapterKindsAreExhaustive;
