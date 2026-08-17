// Tests del adapter MFi / ExternalAccessory de iOS (RBM4, RBM3; T5.5 del delta ios-ble-mfi).
// node:test, sin RN, sin `react-native-bluetooth-classic`, sin iPhone y **sin accesorio MFi** (no lo
// tenemos y no lo podemos tener: hace falta el chip de autenticación de Apple).
//
// ── QUÉ PRUEBA ESTA SUITE, Y QUÉ NO ─────────────────────────────────────────────────────────────
// La I/O entra por `MfiEnv` y el borde del módulo nativo por `MfiModuleEnv`, así que la MÁQUINA DE
// ESTADOS COMPLETA se ejercita acá con dobles: el GATE de datos y sus seis motivos, el listado de
// accesorios filtrado por `protocolString`, la apertura de la sesión con las opciones DEL DRIVER, el
// stream, promesas que NO RESUELVEN NUNCA, el socket huérfano, la desconexión de OTRO accesorio, la sonda
// de liveness, la mudez, el backoff con dwell y tope, background/foreground y el teardown sin timers ni
// suscripciones colgadas (RBM3.11 aplicado a este transporte).
//
// ── LO QUE NINGÚN UNIT DE ACÁ PUEDE PROBAR (declarado para que el verde no se lea de más) ────────
//  (a) que un accesorio MFi real entregue un stream y que esto lo lea. No hay banco posible sin un lector
//      con licencia MFi **y** sin la cadena de protocolo del fabricante (RBM4.6). El transporte queda
//      PREARMADO, no verificado — y eso está dicho también en la cabecera del adapter.
//  (b) que el `sendEvent` del nativo llegue a JS bajo bridgeless (emite por `RCTBridge`, que ahí es un
//      `RCTBridgeProxy`). El síntoma sería "conectado y mudo", y por eso el adapter lo deja ESCRITO
//      (`connected_silent`) en vez de dejarlo invisible.
//  (c) que el diálogo de Bluetooth del SO no aparezca en un arranque en frío. Lo que sí se prueba acá —y
//      es lo único falsificable sin device— es que el arranque en frío **no toca el módulo nativo**, que
//      es la condición que lo sostiene (RBM4.2 + hallazgo 6 del fuente instalado).
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { stripSourceComments } from '../../utils/strip-comments.ts';
import {
  MfiIosAdapter,
  defaultMfiEnv,
  isMfiTransportAvailable,
  mfiDriverFrom,
  __resetMfiModuleStateForTests,
  type MfiDeviceLike,
  type MfiEnv,
  type MfiModuleEnv,
  type MfiNative,
  type MfiSubscription,
  type MfiTimerLabel,
} from './adapter-mfi-ios.ts';
import { DRIVER_REGISTRY } from './driver-registry.ts';
import { ingestRawLine } from './contract.ts';
import { ingestModeFor, readSourceFor } from './adapter-selection.ts';
import { permissionModelFor } from './permissions.ts';
import { backoffDelayMs } from './line-framer.ts';
import { LINK_DWELL_MS, UNPROMPTED_RETRY_BUDGET_MS } from './connect-trigger.ts';
import { parseRs420Line } from './parser-rs420.ts';
import { mfiConnectOptions } from './ea-protocols.ts';
import { DEFAULT_BRIDGE_TIMINGS, type BridgeTimings } from './bridge-timeout.ts';
import type { ConnectionStatus } from './stick-adapter.ts';
import type { ReaderDriver } from './driver-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

/**
 * Cadenas de protocolo SINTÉTICAS. **Ninguna es de un fabricante real** (RBM4.6: inventarla no habilita
 * ningún accesorio y es exactamente lo que el requisito prohíbe). Son el DATO del día que el trámite MFi
 * entregue la cadena, y por eso toda esta suite corre con ellas: es la única forma de demostrar que ese
 * día no hay que escribir código (RBM4.7).
 */
const PROTOCOL_A = 'com.ejemplo.lector-sintetico';
const PROTOCOL_B = 'com.otroejemplo.lector-b';

const SERIAL_A = 'SER-A-000123';
const SERIAL_B = 'SER-B-999888';

/** La trama del lector SIN su fin de trama: el nativo de iOS lo consume y no lo entrega (hallazgo 2). */
const FRAME_BODY = '\x021000000982000364696050260530101701';
const EID_982 = '982000364696050';
const OTHER_FRAME_BODY = '\x021000000982000364696051260530101702';
const EID_051 = '982000364696051';

function mfiDriver(over: { protocolString?: string; delimiter?: string; vendorId?: string } = {}): ReaderDriver {
  const { protocolString = PROTOCOL_A, delimiter, vendorId = 'mfi-sintetico' } = over;
  return {
    vendorId,
    displayName: 'Lector MFi sintético (test)',
    transports: [{ kind: 'mfi', params: { protocolString, ...(delimiter === undefined ? {} : { delimiter }) } }],
    frameParser: { parse: parseRs420Line },
    deviceMatch: { namePattern: /sintetico/i },
    streaming: true,
  };
}

const DRIVER_A = mfiDriver();

// ── SEGUNDO PERFIL DE DRIVER, Y POR QUÉ SIN ÉL LA SUITE NO PUEDE PROBAR "DEL DRIVER" ─────────────
// Es la lección del 🟠-1 del review de F3, traída acá antes de que la pague nadie: mientras todos los
// fixtures declaren la MISMA cadena y el MISMO fin de trama, un literal hardcodeado adentro del transporte
// y el valor del driver son LOS MISMOS BYTES — así que "la cadena y el terminador salen del driver"
// (RBM4.4/RBM4.9, la deuda RMV5.2 que este delta vino a cerrar) no queda falsificado. Los dos perfiles
// difieren en los DOS campos, y hay un test de anti-vacuidad que lo exige.
const DRIVER_B = mfiDriver({ protocolString: PROTOCOL_B, delimiter: '\r', vendorId: 'mfi-sintetico-b' });

interface DriverProfile {
  label: string;
  driver: ReaderDriver;
  protocolString: string;
  delimiter: string;
  serial: string;
}

const DRIVER_PROFILES: DriverProfile[] = [
  { label: 'cadena A + \\n (el supuesto del RS420)', driver: DRIVER_A, protocolString: PROTOCOL_A, delimiter: '\n', serial: SERIAL_A },
  { label: 'cadena B + \\r (otro fabricante)', driver: DRIVER_B, protocolString: PROTOCOL_B, delimiter: '\r', serial: SERIAL_B },
];

/** Promesa que NO resuelve NUNCA: el corazón de los tests del latch (RBM3.2). */
function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/**
 * Reloj de arranque de los tests que MIDEN UN INTERVALO. No es 0 a propósito (es el 🟡-3 del review de F3):
 * con el reloj en 0, `now() - lastDataAt` y `now()` dan EL MISMO NÚMERO, así que la resta —o sea, la
 * medición del `connected_silent` y del dwell— no se puede falsificar.
 */
const CLOCK_START = 1_723_000_000_000;

/**
 * Presupuestos chicos y **distintos entre sí**: con todos iguales, CUÁL presupuesto acota CUÁL await no se
 * puede observar (medido en F3: envolver el connect con el presupuesto de una llamada corta sobrevivía la
 * suite entera). Los tests asertan el `ms` del `bridge_timeout`.
 */
const FAST_TIMEOUTS: Partial<BridgeTimings> = {
  call: 5,
  connect: 7,
  storage: 3,
  livenessPoll: 0,
  silence: 0,
};

/** Sin vencimientos ni timers de link: el default de los tests que no ejercitan el borde temporal. */
const NO_TIMEOUTS: Partial<BridgeTimings> = {
  call: 0,
  prompt: 0,
  connect: 0,
  storage: 0,
  livenessPoll: 0,
  silence: 0,
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Captura los eventos de `logTransportEvent` (console.info('[ble]', kind, json)). */
async function withLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.info;
  // eslint-disable-next-line no-console
  console.info = (...args: unknown[]) => {
    if (args[0] === '[ble]') lines.push(String(args[2]));
  };
  try {
    await fn();
  } finally {
    // eslint-disable-next-line no-console
    console.info = original;
  }
  return lines;
}

// ─── Dobles de la rama iOS de `react-native-bluetooth-classic` ───────────────────────────────────

interface FakeAccessoryOptions {
  id?: string;
  name?: string;
  protocolStrings?: string[];
  /** El wrapper JS de la lib no copia `protocolStrings`: las deja en su privado `_nativeDevice`. */
  asLibWrapper?: boolean;
}

/**
 * Una entrada de `getBondedDevices()` **tal como la devuelve la librería**.
 *
 * Por defecto emula el WRAPPER (`BluetoothDevice`), que es lo que el adapter recibe de verdad y es el
 * hallazgo nº7: el nativo publica `protocolStrings` en su diccionario y el wrapper **no lo copia** — lo
 * deja en `_nativeDevice`. Un fixture que devolviera solo la forma cruda haría verde un adapter que en
 * device no encontraría NUNCA un accesorio.
 */
function fakeAccessory(opts: FakeAccessoryOptions = {}): Record<string, unknown> {
  const id = opts.id ?? SERIAL_A;
  const name = opts.name ?? 'Lector sintetico';
  const protocolStrings = opts.protocolStrings ?? [PROTOCOL_A];
  const raw = { name, address: id, id, bonded: true, protocolStrings, type: 'CLASSIC', extra: {} };
  if (opts.asLibWrapper === false) return raw;
  const { protocolStrings: _oculto, ...sinProtocolos } = raw;
  return { ...sinProtocolos, _nativeDevice: raw };
}

interface FakeNativeOptions {
  /** Lo que resuelve `getBondedDevices()`. */
  bonded?: unknown;
  hangBonded?: boolean;
  bondedRejects?: unknown;
  connectRejects?: unknown;
  hangConnect?: boolean;
  /** `connectToDevice` espera a que el test lo suelte (`state.releaseConnect()`). */
  gateConnect?: boolean;
  /** La lib no expone `isDeviceConnected` (sin segunda fuente de verdad del liveness). */
  omitLivenessProbe?: boolean;
  /** La lib no expone `onDeviceDisconnected`. */
  omitDisconnectEvent?: boolean;
  livenessRejects?: unknown;
  hangLiveness?: boolean;
  hangDisconnect?: boolean;
  /** El device que devuelve `connectToDevice` (default: uno construido acá). */
  deviceAddress?: string;
}

function fakeNative(opts: FakeNativeOptions = {}) {
  let releaseConnect: () => void = () => undefined;
  const connectGate = opts.gateConnect
    ? new Promise<void>((resolveGate) => {
        releaseConnect = resolveGate;
      })
    : Promise.resolve();

  const state = {
    bondedCalls: 0,
    connectCalls: [] as Array<{ id: string; options?: Record<string, unknown> }>,
    isConnectedCalls: [] as string[],
    dataListeners: [] as Array<(e: { data?: string }) => void>,
    disconnectListeners: [] as Array<(e: unknown) => void>,
    deviceDisconnects: 0,
    removedSubs: 0,
    /** Lo que el NATIVO cree del link (la 2ª fuente de verdad, BENCH-1). */
    linkAlive: true,
    releaseConnect: () => releaseConnect(),
  };

  const device: MfiDeviceLike = {
    address: opts.deviceAddress ?? SERIAL_A,
    name: 'Lector sintetico',
    onDataReceived(cb) {
      state.dataListeners.push(cb);
      const sub: MfiSubscription = {
        remove() {
          state.removedSubs += 1;
          state.dataListeners = state.dataListeners.filter((l) => l !== cb);
        },
      };
      return sub;
    },
    disconnect() {
      state.deviceDisconnects += 1;
      if (opts.hangDisconnect) return neverResolves<boolean>();
      return Promise.resolve(true);
    },
  };

  const native: MfiNative = {
    getBondedDevices() {
      state.bondedCalls += 1;
      if (opts.hangBonded) return neverResolves<unknown>();
      if (opts.bondedRejects !== undefined) return Promise.reject(opts.bondedRejects);
      return Promise.resolve(opts.bonded ?? [fakeAccessory()]);
    },
    connectToDevice(id, options) {
      state.connectCalls.push({ id, options });
      if (opts.hangConnect) return neverResolves<MfiDeviceLike>();
      // ⚠️ El rechazo también pasa por el gate (y no antes), así que `gateConnect` + `connectRejects` deja
      // expresar "el intento está EN VUELO y todavía no falló". Sin eso no se puede escribir el escenario
      // en el que el presupuesto de la cadena vence MIENTRAS hay un intento abierto — el único caso que
      // distingue los dos chequeos del tope (ver el test de la cabecera vs. el del timer).
      if (opts.connectRejects !== undefined) {
        return connectGate.then(() => Promise.reject(opts.connectRejects)) as Promise<MfiDeviceLike>;
      }
      return connectGate.then(() => device);
    },
    ...(opts.omitLivenessProbe
      ? {}
      : {
          isDeviceConnected(address: string) {
            state.isConnectedCalls.push(address);
            if (opts.hangLiveness) return neverResolves<boolean>();
            if (opts.livenessRejects !== undefined) return Promise.reject(opts.livenessRejects);
            return Promise.resolve(state.linkAlive);
          },
        }),
    ...(opts.omitDisconnectEvent
      ? {}
      : {
          onDeviceDisconnected(cb: (event: unknown) => void) {
            state.disconnectListeners.push(cb);
            return {
              remove() {
                state.removedSubs += 1;
                state.disconnectListeners = state.disconnectListeners.filter((l) => l !== cb);
              },
            };
          },
        }),
  };

  /** El accesorio entrega un mensaje YA delimitado (el nativo lo framea: hallazgo 2). */
  const emitData = (data: unknown) => {
    for (const l of [...state.dataListeners]) l({ data: data as string });
  };
  /** El SO reporta la desconexión de un accesorio (por default, el NUESTRO). El evento es GLOBAL. */
  const emitDisconnected = (id: string | null = device.address ?? null) => {
    const event = id == null ? { eventType: 'DEVICE_DISCONNECTED' } : { device: { address: id, id } };
    for (const l of [...state.disconnectListeners]) l(event);
  };

  return { native, device, state, emitData, emitDisconnected };
}

// ─── Doble del BORDE del módulo nativo (`MfiModuleEnv`) ──────────────────────────────────────────

interface FakeModuleOptions {
  isIos?: boolean;
  present?: boolean;
  native?: MfiNative | null;
}

/**
 * Cuenta CADA toque al borde del módulo nativo. Es lo que convierte RBM4.2 en un oráculo de
 * comportamiento en vez de una aserción sobre un comentario: `nativeModulePresent()` lee
 * `NativeModules.RNBluetoothClassic`, y en bridgeless eso YA INSTANCIA el módulo (con él
 * `EAAccessoryManager.shared()` y el force-cast del `init()` sobre la clave del plist).
 */
function fakeModuleEnv(opts: FakeModuleOptions = {}) {
  const state = { platformChecks: 0, presenceChecks: 0, loads: 0 };
  const env: MfiModuleEnv = {
    platformIsIos: () => {
      state.platformChecks += 1;
      return opts.isIos ?? true;
    },
    nativeModulePresent: () => {
      state.presenceChecks += 1;
      return opts.present ?? true;
    },
    loadNative: () => {
      state.loads += 1;
      return opts.native ?? null;
    },
  };
  __resetMfiModuleStateForTests(env);
  return { env, state, get touches() {
    return state.presenceChecks + state.loads;
  } };
}

interface FakeEnvOptions {
  moduleEnv?: MfiModuleEnv;
  /** Las cadenas de protocolo que el BUILD declara. `[]` = el estado de hoy (el gate cerrado). */
  declared?: readonly string[];
  remembered?: string | null;
  foreground?: boolean;
  timeouts?: Partial<BridgeTimings>;
  clock?: number;
  hangRemembered?: boolean;
  hangWrite?: boolean;
}

function fakeEnv(opts: FakeEnvOptions = {}) {
  const state = {
    written: [] as string[],
    scheduled: [] as Array<{ fn: () => void; ms: number; label: MfiTimerLabel }>,
    foregroundListeners: [] as Array<() => void>,
    foreground: opts.foreground ?? true,
    rememberedReads: 0,
    declaredReads: 0,
    clock: opts.clock ?? 0,
    advance(ms: number) {
      state.clock += ms;
    },
    timers(label: MfiTimerLabel) {
      return state.scheduled.filter((e) => e.label === label);
    },
    /** Dispara el primer timer de esa etiqueta (y lo saca de la cola, como `setTimeout`). */
    fire(label: MfiTimerLabel) {
      const entry = state.scheduled.find((e) => e.label === label);
      assert.ok(entry, `no hay timer '${label}' pendiente`);
      entry.fn();
    },
    resumeForeground() {
      state.foreground = true;
      for (const cb of [...state.foregroundListeners]) cb();
    },
  };

  const env: MfiEnv = {
    // Delega en el borde del módulo nativo, EXACTAMENTE como `defaultMfiEnv()`: así un solo contador
    // cubre las dos puertas (la del guard de disponibilidad y la del adapter).
    loadNative: () => (opts.moduleEnv ?? fakeModuleEnv().env).loadNative(),
    declaredProtocols: () => {
      state.declaredReads += 1;
      return opts.declared ?? [];
    },
    readRemembered: () => {
      state.rememberedReads += 1;
      if (opts.hangRemembered) return neverResolves<string | null>();
      return Promise.resolve(opts.remembered ?? null);
    },
    writeRemembered: async (deviceId: string) => {
      if (opts.hangWrite) return neverResolves<void>();
      state.written.push(deviceId);
    },
    isForeground: () => state.foreground,
    schedule: (fn: () => void, ms: number, label: MfiTimerLabel) => {
      const entry: { fn: () => void; ms: number; label: MfiTimerLabel } = {
        ms,
        label,
        fn: () => {
          state.scheduled = state.scheduled.filter((e) => e !== entry);
          fn();
        },
      };
      state.scheduled.push(entry);
      return () => {
        state.scheduled = state.scheduled.filter((e) => e !== entry);
      };
    },
    onForeground: (cb: () => void) => {
      state.foregroundListeners.push(cb);
      return () => {
        state.foregroundListeners = state.foregroundListeners.filter((c) => c !== cb);
      };
    },
    now: () => state.clock,
    timeouts: opts.timeouts ?? NO_TIMEOUTS,
  };
  return { env, state };
}

function track(adapter: MfiIosAdapter) {
  const statuses: ConnectionStatus[] = [];
  const tags: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  adapter.onTagRead((t) => tags.push(t));
  return { statuses, tags };
}

/**
 * Un adapter CONECTADO con la cadena declarada, listo para ejercitar el stream. Es el mundo "el día que
 * llegue el dato del fabricante", que es el único en el que este transporte hace algo.
 */
async function connected(
  over: { profile?: DriverProfile; nativeOpts?: FakeNativeOptions; envOpts?: FakeEnvOptions } = {},
) {
  const profile = over.profile ?? DRIVER_PROFILES[0];
  const n = fakeNative({ deviceAddress: profile.serial, ...over.nativeOpts });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [profile.protocolString], ...over.envOpts });
  const adapter = new MfiIosAdapter(profile.driver, e.env);
  const seen = track(adapter);
  await adapter.connect(profile.serial);
  assert.equal(seen.statuses.at(-1), 'connected', 'el fixture tiene que quedar CONECTADO');
  return { adapter, n, m, e, seen, profile };
}

function source(rel = 'adapter-mfi-ios.ts'): string {
  return stripSourceComments(readFileSync(resolve(HERE, rel), 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A. Identidad, driver inmutable y el `ReadSource` que se resuelve AL CABLEAR
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM4.1/RBM4.9: el adapter es kind `mfi-ios`, su modo de ingesta es `raw-line` y su permiso es `ios-mfi`', () => {
  fakeModuleEnv();
  const adapter = new MfiIosAdapter(DRIVER_A, fakeEnv().env);
  assert.equal(adapter.kind, 'mfi-ios');
  // `raw-line` y no `eid`: el accesorio entrega la TRAMA del lector, no un EID limpio (RBM4.9).
  assert.equal(ingestModeFor('mfi-ios'), 'raw-line');
  // Y su modelo de permiso es PROPIO: en MFi no hay permiso de runtime que pedir ni API para pedir que
  // prendan la radio (iOS gatea por la lista de protocolos del build y por el Accessory Picker del SO).
  assert.deepEqual(permissionModelFor('mfi-ios'), { kind: 'ios-mfi' });
});

test('RBM1.1/RBM1.3: el `frameParser` sale DEL DRIVER del adapter, y el driver es inmutable por instancia', async () => {
  const { adapter, n, profile } = await connected();
  const avisos: string[] = [];
  const cablear = readSourceFor(adapter, (k) => avisos.push(k));
  assert.deepEqual(avisos, [], 'el adapter expone driver: no puede haber aviso de parser no resuelto');
  assert.equal(cablear.mode, 'raw-line');
  assert.equal(cablear.frameParser, profile.driver.frameParser, 'el parser es EL DEL DRIVER, por identidad');
  // El driver NO cambia por conectar (el provider resuelve el `ReadSource` una vez al cablear).
  n.emitData(FRAME_BODY);
  assert.equal(adapter.driver, profile.driver);
  assert.equal(readSourceFor(adapter, () => undefined).frameParser, cablear.frameParser);
});

test('RBM1.4 fail-closed: sin driver `mfi` el adapter NO expone parser (la línea se descartaría con aviso)', () => {
  fakeModuleEnv();
  // Es el estado de HOY: ningún lector del registro declara `mfi` (RBM4.6), así que el constructor por
  // default deja el campo AUSENTE. Un `null` ahí cambiaría la forma del adapter sin motivo.
  const adapter = new MfiIosAdapter(null, fakeEnv().env);
  assert.equal(adapter.driver, undefined);
  assert.equal('driver' in adapter, true, 'el campo existe declarado, con valor undefined');
  const avisos: string[] = [];
  const rs = readSourceFor(adapter, (k) => avisos.push(k));
  assert.equal(rs.frameParser, null, 'sin driver no hay parser: la línea se descarta (RBM1.4)');
  assert.deepEqual(avisos, ['mfi-ios'], 'y el descarte deja aviso, no silencio');
});

test('RBM4.6: `mfiDriverFrom` sobre el registro REAL devuelve null (nadie inventó una protocolString)', () => {
  assert.equal(mfiDriverFrom(DRIVER_REGISTRY), null);
  assert.equal(mfiDriverFrom([]), null);
  // Y con un lector que la declara, lo encuentra (el día que llegue el dato del fabricante).
  assert.equal(mfiDriverFrom([...DRIVER_REGISTRY, DRIVER_A]), DRIVER_A);
  // "El primero", con orden estable: dos candidatos → siempre el mismo (RBM5.8).
  assert.equal(mfiDriverFrom([DRIVER_A, DRIVER_B]), DRIVER_A);
  assert.equal(mfiDriverFrom([DRIVER_B, DRIVER_A]), DRIVER_B);
});

test('GUARD: si el registro llega a declarar DOS drivers `mfi`, "el primero" deja de alcanzar', () => {
  // Mismo guard que el del BLE, y por el mismo motivo: mientras haya como máximo UNO, `mfiDriverFrom` es
  // determinístico y no hay decisión que tomar. El día que entren dos lectores MFi (Allflex y Datamars
  // tienen cadenas distintas), "el primero" se convertiría en un fallback silencioso — la familia de bug
  // `DRIVER_REGISTRY[0]` que el review de F1 rechazó. Que nazca en rojo.
  const conMfi = DRIVER_REGISTRY.filter((d) => d.transports.some((t) => t.kind === 'mfi'));
  assert.ok(
    conMfi.length <= 1,
    `el registro declara ${conMfi.length} drivers mfi (${conMfi.map((d) => d.vendorId).join(', ')}): hay que decidir CUÁL se monta (RBM5.6) antes de que "el primero" decida por el operario`,
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B. EL GATE DE DATOS (RBM4.2) — con la lista de protocolos vacía NO SE TOCA EL NATIVO
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM4.2: arranque en frío con la lista VACÍA → CERO toques al módulo nativo (el mutante obligatorio)', async () => {
  // ── EL ORÁCULO DE RBM4.2, Y POR QUÉ SE CUENTA EN VEZ DE LEER UN COMENTARIO ────────────────────────
  // Leer `NativeModules.RNBluetoothClassic` **instancia** el módulo en bridgeless
  // (`BridgelessNativeModuleProxy` → `RCTTurboModuleManager` → `[moduleClass new]`), y su `init()`
  // construye `EAAccessoryManager.shared()` y hace un force-cast `as! [String]` sobre la clave del plist.
  // Encima, en iOS **cada** método del nativo pasa por `checkBluetoothAdapter()`, que usa un
  // `CBCentralManager` lazy — y la propia lib documenta que eso "prompt bluetooth permission on first call
  // of any bluetooth-related method". O sea: tocar el nativo en el arranque le puede mostrar el diálogo de
  // Bluetooth del SO a un operario que no tocó nada (es el 🟠-1 del review de F4, en este transporte).
  //
  // Se cuenta un ARRANQUE EN FRÍO COMPLETO: el guard de disponibilidad que consulta la pantalla + el
  // provider instanciando el adapter + `autoConnect()` + un `connect()` del operario. Tiene que dar CERO.
  const m = fakeModuleEnv({ native: fakeNative().native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [], remembered: SERIAL_A });
  const logs = await withLogs(async () => {
    assert.equal(isMfiTransportAvailable(DRIVER_REGISTRY, []), false, 'sin protocolo declarado no hay transporte');
    const adapter = new MfiIosAdapter(DRIVER_A, e.env);
    const seen = track(adapter);
    await adapter.autoConnect();
    await adapter.connect();
    await flush();
    // Estado honesto y **sin reintentos**: el resultado sería idéntico para siempre (RMV3.7).
    assert.deepEqual(seen.statuses, ['disconnected'], 'el gate no puede emitir connecting ni scanning');
    assert.deepEqual(e.state.scheduled, [], 'no se reintenta lo que solo se arregla con otro build');
  });
  assert.equal(m.state.presenceChecks, 0, 'se leyó NativeModules.RNBluetoothClassic con la lista vacía (RBM4.2)');
  assert.equal(m.state.loads, 0, 'se cargó la librería con la lista vacía (RBM4.2)');
  assert.equal(e.state.rememberedReads, 0, 'ni siquiera hace falta leer el storage: el gate corta antes');
  // Y el motivo queda ESCRITO: desde afuera este camino se ve igual que "el operario no está bastoneando".
  assert.ok(
    logs.some((l) => l.includes('"kind":"mfi_unavailable"') && l.includes('"reason":"build-sin-protocolos"')),
    `falta el mfi_unavailable{build-sin-protocolos}: ${logs.join(' | ')}`,
  );
});

test('RBM4.2 CONTROL POSITIVO: con la cadena declarada el nativo SÍ se toca (si no, el test de arriba pasa por vacuidad)', async () => {
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  await adapter.connect();
  assert.equal(seen.statuses.at(-1), 'connected');
  assert.ok(m.state.loads > 0, 'con el gate abierto la librería se carga');
  assert.equal(isMfiTransportAvailable([DRIVER_A], [PROTOCOL_A]), true);
  assert.ok(m.state.presenceChecks > 0, 'y el guard de disponibilidad sí consulta NativeModules');
});

test('RBM4.2: el ORDEN de los chequeos de `isMfiTransportAvailable` es el requisito (el nativo va ÚLTIMO)', async () => {
  // Cada corte tiene que pasar ANTES de leer `NativeModules`, y cada motivo va al log porque desde la UI
  // los seis se ven idénticos (nada) y mandan a lugares distintos: al fabricante, a `app.config.ts`, al
  // registro de drivers o al build.
  const casos: Array<[string, () => boolean, FakeModuleOptions]> = [
    ['plataforma-no-ios', () => isMfiTransportAvailable([DRIVER_A], [PROTOCOL_A]), { isIos: false }],
    ['driver-sin-mfi', () => isMfiTransportAvailable(DRIVER_REGISTRY, [PROTOCOL_A]), {}],
    ['build-sin-protocolos', () => isMfiTransportAvailable([DRIVER_A], []), {}],
    ['protocolo-no-declarado', () => isMfiTransportAvailable([DRIVER_A], ['com.otra.cosa']), {}],
    [
      'delimitador-no-soportado',
      () => isMfiTransportAvailable([mfiDriver({ delimiter: '\r\n' })], [PROTOCOL_A]),
      {},
    ],
  ];
  const vistos: string[] = [];
  for (const [reason, run, moduleOpts] of casos) {
    const m = fakeModuleEnv(moduleOpts);
    const logs = await withLogs(async () => {
      assert.equal(run(), false, `${reason}: el transporte no puede estar disponible`);
    });
    assert.equal(m.state.presenceChecks, 0, `${reason}: se leyó NativeModules antes de cortar`);
    assert.equal(m.state.loads, 0, `${reason}: se cargó la lib antes de cortar`);
    const log = logs.find((l) => l.includes('"kind":"mfi_unavailable"'));
    assert.ok(log, `${reason}: no se logueó el motivo`);
    assert.ok(log.includes(`"reason":"${reason}"`), `esperaba ${reason}, salió ${log}`);
    vistos.push(reason);
  }
  // ANTI-VACUIDAD: los cinco motivos son DISTINTOS (si colapsaran, el log no serviría para diagnosticar).
  assert.equal(new Set(vistos).size, 5);
  // Y el sexto (`modulo-nativo-ausente`) es el ÚNICO que se alcanza pasando el gate de datos: ahí sí se
  // consulta `NativeModules`, y devuelve false.
  const m = fakeModuleEnv({ present: false });
  const logs = await withLogs(async () => {
    assert.equal(isMfiTransportAvailable([DRIVER_A], [PROTOCOL_A]), false);
  });
  assert.equal(m.state.presenceChecks, 1, 'con el gate abierto SÍ se consulta el módulo (una vez)');
  assert.equal(m.state.loads, 0, 'consultar no es cargar');
  assert.ok(logs.some((l) => l.includes('"reason":"modulo-nativo-ausente"')));
});

test('RBM4.2/RBM5.10: sin el módulo nativo en el build, `connect()` queda manual-first y sin reintentos', async () => {
  const m = fakeModuleEnv({ native: null });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect();
  });
  assert.deepEqual(seen.statuses, ['disconnected']);
  assert.deepEqual(e.state.scheduled, [], 'un binario que falta no aparece martillando la radio');
  assert.ok(logs.some((l) => l.includes('"reason":"modulo-nativo-ausente"')));
});

test('RBM4.5/RMV3.7: un driver con una cadena que el build NO declara no intenta conectar', async () => {
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: ['com.otro.fabricante'] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(SERIAL_A);
  });
  assert.deepEqual(seen.statuses, ['disconnected']);
  assert.equal(n.state.connectCalls.length, 0, 'no se intenta una conexión que el SO va a rechazar');
  assert.equal(m.state.loads, 0);
  assert.ok(logs.some((l) => l.includes('"reason":"protocolo-no-declarado"')));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// C. El camino feliz: listar por protocolo → abrir la sesión → stream
// ═══════════════════════════════════════════════════════════════════════════════════════════════

for (const profile of DRIVER_PROFILES) {
  test(`RBM4.4/RBM4.9 [${profile.label}]: la cadena y el fin de trama que se le pasan al nativo salen DEL DRIVER`, async () => {
    const n = fakeNative({
      deviceAddress: profile.serial,
      // Dos accesorios prendidos: uno que NO habla esta cadena y el nuestro. El filtro tiene que elegir
      // por `protocolString` (hallazgo 1: en iOS no hay descubrimiento, solo listar y filtrar).
      bonded: [
        fakeAccessory({ id: 'IMPOSTOR', name: 'Otro accesorio MFi', protocolStrings: ['com.tercero.cosa'] }),
        fakeAccessory({ id: profile.serial, protocolStrings: ['com.previo.x', profile.protocolString] }),
      ],
    });
    const m = fakeModuleEnv({ native: n.native });
    const e = fakeEnv({ moduleEnv: m.env, declared: [profile.protocolString] });
    const adapter = new MfiIosAdapter(profile.driver, e.env);
    const seen = track(adapter);

    await adapter.connect();

    assert.deepEqual(seen.statuses, ['connecting', 'connected']);
    assert.equal(n.state.bondedCalls, 1, 'sin id conocido hay que LISTAR (no hay descubrimiento en iOS)');
    assert.deepEqual(
      n.state.connectCalls.map((c) => c.id),
      [profile.serial],
      'se abre la sesión con el accesorio que declara la cadena, no con el primero de la lista',
    );
    // Las opciones son las del DRIVER, y son EXACTAMENTE las dos claves que la rama iOS lee.
    assert.deepEqual(n.state.connectCalls[0].options, mfiConnectOptions(profile.delimiter));
    assert.deepEqual(n.state.connectCalls[0].options, { CONNECTION_TYPE: 'delimited', DELIMITER: profile.delimiter });
    // Y el accesorio + su transporte quedan persistidos: es lo que hace que el próximo arranque monte MFi
    // en vez del piso por plataforma (RBM5.6).
    assert.deepEqual(e.state.written, [profile.serial]);
  });
}

test('ANTI-VACUIDAD de los dos perfiles: difieren en la cadena Y en el fin de trama', () => {
  // Sin esto, un literal hardcodeado adentro del transporte y el valor del driver serían los mismos bytes
  // y el test de arriba no probaría el ORIGEN de nada (es el 🟠-1 del review de F3).
  assert.notEqual(DRIVER_PROFILES[0].protocolString, DRIVER_PROFILES[1].protocolString);
  assert.notEqual(DRIVER_PROFILES[0].delimiter, DRIVER_PROFILES[1].delimiter);
  assert.notEqual(DRIVER_PROFILES[0].serial, DRIVER_PROFILES[1].serial);
});

test('RBM4.9/RBM1.8: la lectura entra CRUDA al contrato y sale el EID con el parser del driver', async () => {
  const { adapter, n, seen } = await connected();
  n.emitData(FRAME_BODY);
  assert.deepEqual(seen.tags, [FRAME_BODY], 'el nativo ya frameó: la línea va cruda, sin volver a framear');
  const rs = readSourceFor(adapter, () => undefined);
  assert.deepEqual(ingestRawLine(seen.tags[0], rs.frameParser!), { ok: true, eid: EID_982 });
});

test('dos mensajes PEGADOS en un payload salen como dos lecturas; el vacío y el no-string, como ninguna', async () => {
  const { n, seen } = await connected();
  // Camino defensivo: el nativo entrega UN mensaje por evento, pero si trajera dos pegados se separan por
  // el MISMO delimitador que se le pidió (el del driver) — separar por otro sería inventar tramas.
  n.emitData(`${FRAME_BODY}\n${OTHER_FRAME_BODY}`);
  assert.deepEqual(seen.tags, [FRAME_BODY, OTHER_FRAME_BODY]);
  n.emitData('');
  n.emitData(undefined);
  n.emitData(42);
  n.emitData('   \r\n  ');
  assert.equal(seen.tags.length, 2, 'un payload vacío/no-string/solo-whitespace no puede producir lecturas');
});

test('R10.5: `disable()` corta la ENTREGA sin desconectar, y `enable()` la repone', async () => {
  const { adapter, n, seen } = await connected();
  adapter.disable();
  n.emitData(FRAME_BODY);
  assert.deepEqual(seen.tags, [], 'con la escucha apagada no se propaga (MODO MANIOBRAS lee por su cuenta)');
  assert.equal(n.state.deviceDisconnects, 0, 'disable NO desconecta el transporte físico');
  adapter.enable();
  n.emitData(OTHER_FRAME_BODY);
  assert.deepEqual(seen.tags, [OTHER_FRAME_BODY]);
});

test('accesorio NO encontrado: log con `seen`, estado honesto y SÍ se reintenta (lo pueden prender)', async () => {
  const n = fakeNative({
    bonded: [
      fakeAccessory({ id: 'OTRO-1', protocolStrings: ['com.tercero.a'] }),
      fakeAccessory({ id: 'OTRO-2', protocolStrings: ['com.tercero.b'] }),
    ],
  });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect();
  });
  assert.equal(n.state.connectCalls.length, 0, 'no se abre sesión con un accesorio que no habla la cadena');
  assert.deepEqual(seen.statuses, ['connecting', 'disconnected', 'scanning']);
  // `seen=2` separa dos causas que desde la UI se ven igual: CERO accesorios prendidos (el bastón está
  // apagado o no está emparejado en Ajustes) vs. accesorios prendidos que no hablan esta cadena.
  assert.ok(
    logs.some((l) => l.includes('mfi_accessory_not_found: seen=2')),
    `falta el conteo de accesorios vistos: ${logs.join(' | ')}`,
  );
  assert.equal(e.state.timers('reconnect').length, 1, 'lo pueden prender o emparejar en cualquier momento');
});

test('con un accesorio ya conocido NO se lista (ni se toca `getBondedDevices`)', async () => {
  const { n } = await connected();
  assert.equal(n.state.bondedCalls, 0, 'un id explícito ahorra el listado (y su viaje por el puente)');
});

test('el accesorio elegido se recuerda ANTES del éxito para que el reintento no vuelva a listar', async () => {
  // Si el objetivo se anotara solo al conectar, el reintento del backoff llamaría `connect(undefined)` y
  // volvería a listar desde cero, perdiendo el accesorio que ya habíamos identificado.
  const n = fakeNative({ connectRejects: { code: 'connection_failed', message: 'Could not connect to EAAccessory' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  await adapter.connect();
  assert.equal(n.state.bondedCalls, 1);
  assert.equal(e.state.timers('reconnect').length, 1);
  e.state.fire('reconnect');
  await flush();
  assert.equal(n.state.bondedCalls, 1, 'el reintento NO vuelve a listar: ya sabe a quién dialar');
  assert.deepEqual(
    n.state.connectCalls.map((c) => c.id),
    [SERIAL_A, SERIAL_A],
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// D. Latch, generación de intento y promesas que NO RESUELVEN (RBM3.2, 🔴-1 del SPP)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.2: un `connectToDevice` que NO resuelve vence con SU presupuesto y LIBERA el latch', async () => {
  const n = fakeNative({ hangConnect: true });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], timeouts: FAST_TIMEOUTS });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(SERIAL_A);
  });
  // El `ms` del log identifica CUÁL presupuesto acotó el await (los cuatro del fixture son distintos).
  assert.ok(
    logs.some((l) => l.includes('"label":"connect_to_device"') && l.includes(`"ms":${FAST_TIMEOUTS.connect}`)),
    `esperaba bridge_timeout{connect_to_device, ms:${FAST_TIMEOUTS.connect}}: ${logs.join(' | ')}`,
  );
  assert.equal(seen.statuses.at(-1), 'scanning', 'tras el vencimiento se reprograma el intento');
  // Y el latch está libre: un connect posterior HACE algo (con el latch tomado sería un no-op mudo, que es
  // el 🔴-1 del SPP: 2 min 40 s de bastón muerto medidos en el A07).
  const antes = n.state.connectCalls.length;
  await adapter.connect(SERIAL_B);
  assert.ok(n.state.connectCalls.length > antes, 'el latch quedó tomado: todo connect posterior es un no-op');
});

test('MEDIUM-1: la sesión que resuelve DESPUÉS del vencimiento se cierra… salvo que la dirección ya sea de otro', async () => {
  const n = fakeNative({ gateConnect: true });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], timeouts: FAST_TIMEOUTS });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  await adapter.connect(SERIAL_A);
  // El nativo contesta tarde, con la sesión ya abierta: si no se cierra queda en su `connections` sin que
  // nadie la lea, y la sonda de liveness diría "vivo" sobre una sesión fantasma.
  n.state.releaseConnect();
  await flush();
  assert.equal(n.state.deviceDisconnects, 1, 'la sesión huérfana tiene que cerrarse');
});

test('🟠-2: `connect()` a OTRO accesorio con un intento en vuelo se ENCOLA (no se descarta en silencio)', async () => {
  const n = fakeNative({ gateConnect: true });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const logs = await withLogs(async () => {
    const primero = adapter.connect(SERIAL_A);
    await adapter.connect(SERIAL_B); // con el primero en vuelo
    n.state.releaseConnect();
    await primero;
    await flush();
  });
  assert.ok(logs.some((l) => l.includes('"kind":"connect_superseded"') && l.includes(SERIAL_B)));
  assert.deepEqual(
    n.state.connectCalls.map((c) => c.id),
    [SERIAL_A, SERIAL_B],
    'el objetivo encolado se atiende al terminar el intento vigente',
  );
});

test('🟠-B: `connect()` SIN target con un intento en vuelo no es un no-op mudo (`connect_reasserted`)', async () => {
  const n = fakeNative({ gateConnect: true });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const logs = await withLogs(async () => {
    const primero = adapter.connect(SERIAL_A);
    await adapter.connect(); // el tap del operario: "quiero que insista"
    n.state.releaseConnect();
    await primero;
  });
  assert.ok(logs.some((l) => l.includes('"kind":"connect_reasserted"') && l.includes('"trigger":"operator"')));
  assert.equal(n.state.connectCalls.length, 1, 'no duplica el intento: re-aplica la política de la cadena');
});

test('un `disconnect()` MIENTRAS se abre la sesión la cierra y no emite `connected`', async () => {
  const n = fakeNative({ gateConnect: true });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const enVuelo = adapter.connect(SERIAL_A);
  // El `flush` NO es decoración: sin él el `disconnect()` llega ANTES de que el intento toque el puente y
  // el escenario que este test quiere (la sesión abriéndose a espaldas del disconnect) no existe. La
  // aserción de abajo es la que lo hace visible en vez de dejarlo pasar en verde por el motivo equivocado.
  await flush();
  assert.equal(n.state.connectCalls.length, 1, 'el intento tiene que estar EN VUELO en el puente');
  await adapter.disconnect();
  n.state.releaseConnect();
  await enVuelo;
  await flush();
  assert.equal(seen.statuses.includes('connected'), false, 'el operario dijo "desconectar": no puede terminar conectado');
  assert.equal(n.state.deviceDisconnects, 1, 'la sesión que se abrió a espaldas del disconnect se cierra');
  assert.deepEqual(n.state.dataListeners, [], 'y no queda ningún listener de datos vivo');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E. Desconexión del SO, liveness y mudez (RBM3.4, RBM3.5, RBM3.10)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.4: el evento de desconexión es GLOBAL — apagar OTRO accesorio no puede cerrar nuestra sesión', async () => {
  // En iOS `onDeviceDisconnected` se suscribe a `DEVICE_DISCONNECTED` PELADO (comparar con `onDeviceRead`,
  // que sí es `DEVICE_READ@<serial>`) y lo alimenta el observer de `.EAAccessoryDidDisconnect`, que se
  // dispara con CUALQUIER accesorio MFi del teléfono. Sin el filtro por nuestra dirección, apagar unos
  // auriculares MFi cerraría el bastón y dispararía el backoff sobre un link sano (🔴-2 del SPP).
  const { adapter, n, seen, e } = await connected();
  n.emitDisconnected('AA:BB:CC:DD:EE:FF');
  await flush();
  assert.equal(seen.statuses.at(-1), 'connected', 'la desconexión de otro accesorio no nos toca');
  assert.equal(e.state.timers('reconnect').length, 0, 'ni dispara el backoff');
  n.emitData(FRAME_BODY);
  assert.deepEqual(seen.tags, [FRAME_BODY], 'y el stream sigue vivo');
  // La NUESTRA sí: teardown + estado + reintento.
  n.emitDisconnected();
  await flush();
  assert.equal(seen.statuses.at(-1), 'scanning');
  assert.equal(e.state.timers('reconnect').length, 1);
  void adapter;
});

test('RBM3.5: un evento de desconexión SIN id legible se acepta (mejor un teardown de más que un "conectado" falso)', async () => {
  const { n, seen } = await connected();
  n.emitDisconnected(null);
  await flush();
  assert.equal(seen.statuses.at(-1), 'scanning', 'la señal que teníamos es que se cayó: fail-closed');
});

test('RBM3.5/BENCH-1: la sonda de liveness reconcilia sin depender de ningún evento (poll y foreground)', async () => {
  const { n, e, seen } = await connected({
    envOpts: { timeouts: { ...NO_TIMEOUTS, livenessPoll: 1_000 }, clock: CLOCK_START },
  });
  // El nativo ya no tiene la sesión (el evento se perdió: el `sendEvent` de la lib lo descarta si no hay
  // bridge, y bajo bridgeless emite por `RCTBridgeProxy`).
  n.state.linkAlive = false;
  e.state.fire('watchdog');
  await flush();
  assert.equal(seen.statuses.at(-1), 'scanning', 'el poll tiene que cazar el link muerto');
  assert.deepEqual(n.state.isConnectedCalls, [SERIAL_A], 'la sonda pregunta por NUESTRA dirección');
});

test('RBM3.5: al volver a FOREGROUND se reconcilia el estado (el evento pudo perderse con la app minimizada)', async () => {
  const { n, e, seen } = await connected({ envOpts: { timeouts: NO_TIMEOUTS } });
  n.state.linkAlive = false;
  e.state.resumeForeground();
  await flush();
  assert.equal(seen.statuses.at(-1), 'scanning');
  assert.deepEqual(n.state.isConnectedCalls, [SERIAL_A]);
});

test('RBM3.5 fail-closed: si la sonda RECHAZA no seguimos afirmando "conectado"', async () => {
  const { n, e, seen } = await connected({
    nativeOpts: { livenessRejects: { code: 'bluetooth_disabled', message: 'Bluetooth is not enabled' } },
    envOpts: { timeouts: { ...NO_TIMEOUTS, livenessPoll: 1_000 }, clock: CLOCK_START },
  });
  const logs = await withLogs(async () => {
    e.state.fire('watchdog');
    await flush();
  });
  assert.equal(seen.statuses.at(-1), 'scanning');
  assert.ok(
    logs.some((l) => l.includes('"kind":"liveness_lost"') && l.includes('Bluetooth is not enabled')),
    `el motivo del rechazo tiene que quedar escrito: ${logs.join(' | ')}`,
  );
  void n;
});

test('sin `isDeviceConnected` en el módulo se DICE que no hay sonda (una vez), en vez de fingir BENCH-1', async () => {
  const logs = await withLogs(async () => {
    await connected({ nativeOpts: { omitLivenessProbe: true } });
  });
  assert.equal(
    logs.filter((l) => l.includes('liveness_probe_unavailable')).length,
    1,
    'una vez por conexión, no en cada poll',
  );
});

test('RBM3.10: el silencio de un link conectado queda ESCRITO (`connected_silent`) y NO desconecta', async () => {
  // Un lector con el terminador equivocado, un lector dormido, una sesión muerta y —en iOS— el evento de
  // lectura que no llega a JS producen el MISMO síntoma desde afuera: "connected", cero lecturas, cero
  // errores. El silencio no desconecta (es normal cuando el operario no bastonea) pero se escribe, que es
  // lo único que hace distinguibles esos casos (🟠-5 / BENCH-2).
  const { n, e, seen } = await connected({
    envOpts: { timeouts: { ...NO_TIMEOUTS, livenessPoll: 1_000, silence: 45_000 }, clock: CLOCK_START },
  });
  const logs = await withLogs(async () => {
    e.state.advance(60_000);
    e.state.fire('watchdog');
    await flush();
  });
  const silent = logs.find((l) => l.includes('"kind":"connected_silent"'));
  assert.ok(silent, `falta el connected_silent: ${logs.join(' | ')}`);
  // El `ms` es el INTERVALO medido, no `now()`: con el reloj arrancando en un instante real, un
  // `silentMs = this.now()` (o sea, borrar la resta) daría un número absurdo y este assert cae.
  assert.ok(silent.includes('"ms":60000'), `el intervalo medido tiene que ser 60000: ${silent}`);
  assert.equal(seen.statuses.at(-1), 'connected', 'el silencio NO desconecta');
  assert.equal(n.state.deviceDisconnects, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F. Reconexión: tope de la cadena que nadie pidió, dwell y foreground (RBM3.1, RBM3.6, RBM3.9)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.1: la cadena que NADIE pidió muere al vencer su presupuesto (y NO suma un intento más)', async () => {
  const n = fakeNative({ connectRejects: { code: 'device_not_found', message: 'Device is not currently bonded/paired' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: SERIAL_A, clock: CLOCK_START });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  await adapter.autoConnect();
  const intentos = n.state.connectCalls.length;
  assert.equal(e.state.timers('reconnect').length, 1);
  // Pasa el presupuesto de la cadena sin gesto y el timer dispara: tiene que MORIR sin intentar de nuevo.
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
  const logs = await withLogs(async () => {
    e.state.fire('reconnect');
    await flush();
  });
  assert.equal(
    n.state.connectCalls.length,
    intentos,
    'el timer sumó un intento con el presupuesto ya vencido (en device son ~10 s de radio martillando por apertura de la app)',
  );
  assert.equal(seen.statuses.at(-1), 'off', "'off' es el estado honesto de 'no conectado y sin estar intentando'");
  assert.equal(adapter.autoConnectExhausted, true, 'la pantalla necesita esto para el copy honesto (R6.4)');
  assert.ok(logs.some((l) => l.includes('"kind":"autoconnect_exhausted"')));
  assert.deepEqual(e.state.scheduled, [], 'no queda ningún timer vivo');
});

test('RBM3.1: el tope se chequea ANTES del gate de foreground (guardar el teléfono no lo hace evitable)', async () => {
  const n = fakeNative({ connectRejects: { code: 'device_not_found' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: SERIAL_A, clock: CLOCK_START });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  await adapter.autoConnect();
  // La app se va a background Y el presupuesto vence: la cadena tiene que morir, no quedarse esperando el
  // retorno a primer plano para seguir martillando.
  e.state.foreground = false;
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
  e.state.fire('reconnect');
  await flush();
  assert.equal(seen.statuses.at(-1), 'off');
  assert.deepEqual(e.state.scheduled, []);
});

test('RBM3.1: el tope de la CABECERA es el que mata una cadena vencida con la app en BACKGROUND', async () => {
  // ── POR QUÉ ESTE TEST EXISTE: LO PIDIÓ UN MUTANTE QUE SOBREVIVIÓ ──────────────────────────────────
  // El tope está implementado DOS veces a propósito (en la cabecera de `scheduleReconnect` y adentro del
  // timer), y las dos veces ANTES del gate de foreground. Medido: borrar el del TIMER mata dos tests, y
  // borrar el de la CABECERA no mataba ninguno — o sea que no eran dos oráculos, era un oráculo y un
  // cinturón. Es literalmente el mismo hallazgo que el review de F3 dejó escrito para el adapter BLE.
  //
  // El caso que SOLO cubre la cabecera: el presupuesto se vence MIENTRAS hay un intento en vuelo y la app
  // se fue a background. El fallo llama a `scheduleReconnect()` DIRECTO (no por el timer), así que el único
  // chequeo del tope que puede correr es el de la cabecera. Sin él, la cadena se parquea esperando el
  // foreground y vuelve a martillar la radio cuando el operario saque el teléfono del bolsillo → el tope se
  // vuelve evitable guardando el teléfono, que es justo lo que este requisito prohíbe.
  const n = fakeNative({ gateConnect: true, connectRejects: { code: 'device_not_found' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: SERIAL_A, clock: CLOCK_START });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const enVuelo = adapter.autoConnect();
  await flush();
  assert.equal(n.state.connectCalls.length, 1, 'el intento tiene que estar EN VUELO (si no, el caso no existe)');
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
  e.state.foreground = false;
  n.state.releaseConnect();
  await enVuelo;
  await flush();
  assert.equal(seen.statuses.at(-1), 'off', 'la cadena vencida tiene que MORIR, no parquearse esperando el foreground');
  assert.deepEqual(e.state.scheduled, []);
  assert.deepEqual(e.state.foregroundListeners, [], 'no puede quedar un listener de foreground de zombi');
  assert.equal(adapter.autoConnectExhausted, true);
});

test('RBM3.6: el foreground se chequea AL DISPARAR el timer, no solo al programarlo', async () => {
  const n = fakeNative({ connectRejects: { code: 'device_not_found' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  await adapter.connect(SERIAL_A);
  const intentos = n.state.connectCalls.length;
  // Entre armar (hasta 8 s de backoff) y disparar, la app se fue a background.
  e.state.foreground = false;
  e.state.fire('reconnect');
  await flush();
  assert.equal(n.state.connectCalls.length, intentos, 'en background no se toca la radio (R6.9)');
  // Y al volver, se reprograma solo (el caso de "guardé el teléfono en el bolsillo").
  e.state.resumeForeground();
  await flush();
  assert.equal(e.state.timers('reconnect').length, 1);
});

/** Provoca un corte del link y devuelve el delay del reintento que quedó programado. */
async function cortarYLeerDelay(
  n: ReturnType<typeof fakeNative>,
  e: ReturnType<typeof fakeEnv>,
  duroMs: number,
): Promise<number> {
  e.state.advance(duroMs);
  n.emitDisconnected();
  await flush();
  const timer = e.state.timers('reconnect')[0];
  assert.ok(timer, 'el corte tiene que programar un reintento');
  return timer.ms;
}

test('RBM3.9: el backoff solo se resetea si el link DURÓ (un flap no lo deja martillando en attempt:0)', async () => {
  const { n, e } = await connected({ envOpts: { clock: CLOCK_START } });
  // Flap 1: el link se cae a los 100 ms → primer reintento, backoff del piso.
  assert.equal(await cortarYLeerDelay(n, e, 100), backoffDelayMs(0));
  e.state.fire('reconnect');
  await flush();
  assert.deepEqual(e.state.timers('reconnect'), [], 'el reintento tiene que haber RECONECTADO');
  // Flap 2, también corto: el delay tiene que CRECER. Si el reset no mirara el dwell, este link de 100 ms
  // dejaría el backoff en el piso para siempre → reintento cada 500 ms mientras el bastón flapea.
  assert.equal(await cortarYLeerDelay(n, e, 100), backoffDelayMs(1), 'un flap no puede resetear el backoff');
  assert.notEqual(backoffDelayMs(0), backoffDelayMs(1), 'ANTI-VACUIDAD: el backoff tiene que crecer');
});

test('RBM3.9: un link que DURÓ el dwell sí resetea el backoff', async () => {
  // La contraparte del test de arriba, y sin ella "no resetea nunca" también pasaría: el reset TIENE que
  // ocurrir cuando el link fue sano, o un bastón que se apaga a la noche arranca al otro día con el delay
  // más largo del backoff.
  const { n, e } = await connected({ envOpts: { clock: CLOCK_START } });
  assert.equal(await cortarYLeerDelay(n, e, 100), backoffDelayMs(0));
  e.state.fire('reconnect');
  await flush();
  assert.equal(await cortarYLeerDelay(n, e, 100), backoffDelayMs(1));
  e.state.fire('reconnect');
  await flush();
  // Ahora el link DURA más que el dwell → el contador vuelve al piso.
  assert.equal(await cortarYLeerDelay(n, e, LINK_DWELL_MS + 1), backoffDelayMs(0), 'un link sano reinicia el backoff');
});

test('RBM3.1: un GESTO del operario DESTOPA la cadena que nadie pidió', async () => {
  const n = fakeNative({ connectRejects: { code: 'device_not_found' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: SERIAL_A, clock: CLOCK_START });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  await adapter.autoConnect();
  // "Abro la app, el bastón tarda, toco «Volver a conectar» a los 90 s": el gesto arranca una cadena SIN
  // tope, así que a los 121 s la cadena NO tiene que morir.
  e.state.advance(90_000);
  await adapter.connect();
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
  e.state.fire('reconnect');
  await flush();
  assert.notEqual(seen.statuses.at(-1), 'off', 'el gesto del operario no puede quedar sin efecto observable');
  assert.equal(adapter.autoConnectExhausted, false);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// G. `autoConnect()` — el arranque en frío (R6.4, RBM3.8)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('R6.4/RBM3.8: sin accesorio recordado el arranque NO lista, NO toca el nativo y NO emite estado', async () => {
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: null });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.deepEqual(seen.statuses, [], "'off' es el estado honesto de 'nunca se intentó'");
  assert.equal(m.state.loads, 0, 'un arranque en frío sin recordado no puede tocar el módulo nativo');
  assert.equal(n.state.bondedCalls, 0);
  assert.ok(logs.some((l) => l.includes('"kind":"autoconnect_skipped"') && l.includes('"reason":"no_remembered"')));
});

test('R6.4: con accesorio recordado el arranque reconecta a ESE id (sin listar)', async () => {
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: SERIAL_A });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  await adapter.autoConnect();
  assert.equal(seen.statuses.at(-1), 'connected');
  assert.deepEqual(
    n.state.connectCalls.map((c) => c.id),
    [SERIAL_A],
  );
  assert.equal(n.state.bondedCalls, 0);
});

test('RBM3.6: en background el arranque no hace NADA (ni lee el storage)', async () => {
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], remembered: SERIAL_A, foreground: false });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.equal(e.state.rememberedReads, 0);
  assert.equal(m.state.loads, 0);
  assert.ok(logs.some((l) => l.includes('"reason":"background"')));
});

test('el gate de datos gana al gate del recordado: el motivo tiene que ser `mfi_unavailable`, no `no_remembered`', async () => {
  // Los dos se ven idénticos desde la UI (nada) y mandan a lugares DISTINTOS: uno al fabricante/al build,
  // el otro a "elegí un bastón". Confundirlos es mandar a buscar el dato equivocado.
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [], remembered: SERIAL_A });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.ok(logs.some((l) => l.includes('"kind":"mfi_unavailable"')));
  assert.equal(logs.some((l) => l.includes('"reason":"no_remembered"')), false);
  assert.equal(e.state.rememberedReads, 0, 'el gate de datos corta ANTES de leer el storage');
});

test('RBM3.2: un storage que NO CONTESTA no cuelga el arranque (vence con su presupuesto)', async () => {
  const n = fakeNative();
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({
    moduleEnv: m.env,
    declared: [PROTOCOL_A],
    hangRemembered: true,
    timeouts: FAST_TIMEOUTS,
  });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
    await flush();
  });
  assert.ok(
    logs.some((l) => l.includes('"label":"read_remembered"') && l.includes(`"ms":${FAST_TIMEOUTS.storage}`)),
    `esperaba bridge_timeout{read_remembered, ms:${FAST_TIMEOUTS.storage}}: ${logs.join(' | ')}`,
  );
  assert.equal(m.state.loads, 0, 'sin poder leer el recordado no se toca el nativo');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// H. El MOTIVO del rechazo decide si se reintenta (hallazgo 4 + `mfiConnectRetryPolicy`)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM4.5: un `connect_failed` (sin intersección de protocolo) NO se reintenta — hace falta OTRO BUILD', async () => {
  const n = fakeNative({
    connectRejects: { code: 'connect_failed', message: 'Device could not establish connection' },
  });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(SERIAL_A);
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.deepEqual(e.state.scheduled, [], 'martillar la radio no consigue una autorización del fabricante');
  assert.ok(
    logs.some((l) => l.includes('connect_path:protocolo-rechazado')),
    `el motivo tiene que viajar en el log: ${logs.join(' | ')}`,
  );
});

test('la radio apagada SÍ se reintenta (la pueden prender del centro de control en cualquier momento)', async () => {
  const n = fakeNative({ connectRejects: { code: 'bluetooth_disabled', message: 'Bluetooth is not enabled' } });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A] });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const logs = await withLogs(async () => {
    await adapter.connect(SERIAL_A);
  });
  assert.equal(e.state.timers('reconnect').length, 1);
  assert.ok(logs.some((l) => l.includes('connect_path:radio-apagada')));
});

test('un `getBondedDevices` que no contesta vence, se loguea y NO deja el intento colgado', async () => {
  const n = fakeNative({ hangBonded: true });
  const m = fakeModuleEnv({ native: n.native });
  const e = fakeEnv({ moduleEnv: m.env, declared: [PROTOCOL_A], timeouts: FAST_TIMEOUTS });
  const adapter = new MfiIosAdapter(DRIVER_A, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect();
    await flush();
  });
  assert.ok(
    logs.some((l) => l.includes('"label":"get_bonded_devices"') && l.includes(`"ms":${FAST_TIMEOUTS.call}`)),
    `esperaba bridge_timeout{get_bonded_devices, ms:${FAST_TIMEOUTS.call}}: ${logs.join(' | ')}`,
  );
  assert.equal(seen.statuses.at(-1), 'scanning', 'un puente que no contesta se reintenta, no se abandona mudo');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// I. Teardown sin fugas
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('`disconnect()` cierra la sesión, remueve las suscripciones y no deja timers vivos', async () => {
  const { adapter, n, e, seen } = await connected({
    envOpts: { timeouts: { ...NO_TIMEOUTS, livenessPoll: 1_000 }, clock: CLOCK_START },
  });
  assert.equal(e.state.timers('watchdog').length, 1, 'el fixture tiene que tener el watchdog armado');
  await adapter.disconnect();
  assert.deepEqual(e.state.scheduled, [], 'quedó un timer vivo después del disconnect');
  assert.deepEqual(n.state.dataListeners, []);
  assert.deepEqual(n.state.disconnectListeners, []);
  assert.equal(n.state.deviceDisconnects, 1);
  assert.equal(seen.statuses.at(-1), 'disconnected');
  // Y una lectura que llegara TARDE (de la sesión ya cerrada) no se propaga.
  n.emitData(FRAME_BODY);
  assert.deepEqual(seen.tags, []);
});

test('dos `connect()` seguidos NO dejan dos suscripciones a datos (cada lectura se entrega UNA vez)', async () => {
  // Dos `onDataReceived` sobre la misma sesión entregan cada lectura dos veces, y la ventana de dedup lo
  // TAPA: un leak invisible desde la UI.
  const { adapter, n, seen } = await connected();
  await adapter.connect(SERIAL_A);
  assert.equal(n.state.dataListeners.length, 1, `quedaron ${n.state.dataListeners.length} listeners de datos`);
  n.emitData(FRAME_BODY);
  assert.deepEqual(seen.tags, [FRAME_BODY]);
});

test('un `device.disconnect()` que no contesta no deja colgado el teardown (ni el latch tomado)', async () => {
  const { adapter, n, e } = await connected({
    nativeOpts: { hangDisconnect: true },
    envOpts: { timeouts: FAST_TIMEOUTS },
  });
  await adapter.disconnect();
  // Si el teardown se colgara, este connect no llegaría nunca al puente.
  await adapter.connect(SERIAL_B);
  assert.ok(
    n.state.connectCalls.some((c) => c.id === SERIAL_B),
    'el latch quedó tomado por un disconnect que no contesta',
  );
  void e;
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// J. Guards estáticos: lo que este adapter NO PUEDE llamar (hallazgos 1, 4 y 5)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('GUARD (hallazgos 1 y 5): el adapter no llama métodos que en iOS no existen o cuelgan el nativo', () => {
  const src = source();
  for (const [método, porQue] of [
    ['availableFromDevice', 'el .m exporta `available:` y el Swift implementa `availableFromDevice` → el método que la capa JS llama NO existe; y el `available()` de la conexión delimitada tiene un `while (content.index(of:) != nil)` con `content` inmutable = bucle infinito'],
    ['startDiscovery', 'tira `Method not implemented.` en iOS (el emparejamiento lo hace el Accessory Picker del SO)'],
    ['pairDevice', 'ídem: no existe en iOS'],
    ['requestBluetoothEnabled', 'ídem: en iOS no hay API para pedir que prendan la radio, solo Ajustes'],
    ['readFromDevice', 'la lectura manual usa el mismo `read()` del nativo: el stream va por el evento'],
  ] as const) {
    assert.equal(src.includes(método), false, `el adapter llama a \`${método}\`: ${porQue}`);
  }
});

test('GUARD (hallazgo 4): el adapter NO reusa las opciones del SPP (`charset` force-casteado = crash en iOS)', () => {
  // El nativo hace `String.Encoding.from(value as! CFStringEncoding)` — un force-cast a UInt32 — y
  // `sppConnectOptions()` pasa `charset: 'ascii'` (un STRING): ese mismo objeto en iOS **trapea en Swift**,
  // o sea se lleva la app. No falla la conexión: crashea. Por eso este transporte tiene su propio
  // constructor de opciones (`mfiConnectOptions`) y este guard prohíbe la "simplificación".
  const src = source();
  assert.equal(src.includes('sppConnectOptions'), false, 'reusar las opciones del SPP CRASHEA la app en iOS');
  assert.match(src, /mfiConnectOptions\(/, 'las opciones tienen que salir del constructor propio');
  // Y ni `charset` ni `read_size` aparecen a mano en el adapter (el segundo lo sobrescribe el default del
  // nativo por un bug de encadenado del `if let`).
  assert.equal(/charset|read_size|READ_SIZE/i.test(src), false);
});

test('RBM9.4 offline-first: este transporte NO puede tocar la red (el peón en la manga no tiene señal)', () => {
  // El link es LOCAL entre el accesorio y el teléfono, así que ni conectar, ni leer, ni parsear, ni
  // deduplicar puede requerir internet. Es un guard estático y no un test de comportamiento porque el modo
  // de falla es una LÍNEA NUEVA, no un estado: un `fetch` de telemetría metido "para diagnosticar" haría que
  // el bastón dejara de conectarse en el campo, que es exactamente donde se usa. Cubre además la frontera de
  // datos: este adapter no habla con Supabase ni con PowerSync (el EID entra al motor de spec 09, que no se
  // toca — RBM9.3/RBM9.6).
  const src = source();
  for (const prohibido of ['fetch(', 'XMLHttpRequest', 'supabase', 'powersync', 'establishment_id', 'axios']) {
    assert.equal(
      src.toLowerCase().includes(prohibido.toLowerCase()),
      false,
      `el adapter menciona '${prohibido}': el transporte tiene que funcionar sin red y sin tocar la frontera de datos`,
    );
  }
});

test('GUARD: el `require` de la lib y de `react-native` es PEREZOSO (este archivo se importa en web y en CI)', () => {
  const src = source();
  // Ningún import top-level de la lib nativa ni de RN: si lo hubiera, importar este módulo desde node:test
  // (o desde web) explotaría — y el provider lo importa SIEMPRE, en las cuatro plataformas.
  assert.equal(/^import .*react-native/m.test(src), false, 'import top-level de react-native o de la lib');
  assert.match(src, /require\('react-native-bluetooth-classic'\)/, 'la lib entra por require perezoso');
  assert.match(src, /require\('react-native'\)/);
});

test('el entorno REAL (`defaultMfiEnv`) es construible sin RN y su gate no toca nada en CI', async () => {
  // No es adorno: el provider construye este env en el primer render, en las cuatro plataformas. Si algo de
  // acá explotara sin RN, se llevaría el render (y en CI, la suite).
  __resetMfiModuleStateForTests();
  const env = defaultMfiEnv();
  assert.deepEqual(env.declaredProtocols(), [], 'sin runtime de expo la lista es [] (fail-closed)');
  assert.equal(await env.readRemembered(), null, 'sin RN el storage no resuelve nada, y no tira');
  await env.writeRemembered(SERIAL_A); // best-effort: no puede tirar
  assert.equal(env.isForeground(), true, 'sin RN no gateamos por foreground');
  const cancel = env.schedule(() => undefined, 1_000, 'reconnect');
  cancel();
  env.onForeground(() => undefined)();
  // Y el guard de disponibilidad, con el borde REAL: en node no hay `react-native`, así que corta en el
  // primer chequeo (`plataforma-no-ios`) sin tocar nada.
  const logs = await withLogs(async () => {
    assert.equal(isMfiTransportAvailable(), false);
  });
  assert.ok(logs.some((l) => l.includes('"reason":"plataforma-no-ios"')));
  assert.equal(DEFAULT_BRIDGE_TIMINGS.storage > 0, true, 'el presupuesto real del storage tiene que ser positivo');
});

test('R7/RBM9.5: ningún camino de este adapter TIRA — una falla es un estado, no una excepción', async () => {
  // La carga manual nunca se bloquea, y la forma de garantizarlo es que el adapter no propague. Se barren
  // los caminos de falla que existen, incluido el que rompe el módulo entero.
  const casos: Array<[string, FakeNativeOptions, FakeEnvOptions]> = [
    ['sin protocolo declarado', {}, { declared: [] }],
    ['el nativo rechaza el connect', { connectRejects: new Error('boom') }, { declared: [PROTOCOL_A] }],
    ['el nativo rechaza el listado', { bondedRejects: new Error('boom') }, { declared: [PROTOCOL_A] }],
    ['el listado devuelve basura', { bonded: 'no es una lista' }, { declared: [PROTOCOL_A] }],
    ['el storage de escritura se cuelga', {}, { declared: [PROTOCOL_A], hangWrite: true, timeouts: FAST_TIMEOUTS }],
  ];
  for (const [label, nativeOpts, envOpts] of casos) {
    const n = fakeNative(nativeOpts);
    const m = fakeModuleEnv({ native: n.native });
    const e = fakeEnv({ moduleEnv: m.env, ...envOpts });
    const adapter = new MfiIosAdapter(DRIVER_A, e.env);
    await withLogs(async () => {
      await adapter.connect(); // no puede tirar
      await adapter.autoConnect();
      await adapter.disconnect();
      await flush();
    });
    assert.ok(true, label);
  }
  await wait(1);
});
