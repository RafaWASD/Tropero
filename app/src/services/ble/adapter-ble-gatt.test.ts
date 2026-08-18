// Tests del adapter BLE GATT (RBM2, RBM3; T3.12/T3.13 del delta ios-ble-mfi). node:test, sin RN, sin
// `react-native-ble-plx`, sin bastón.
//
// ── QUÉ PRUEBA ESTA SUITE, Y QUÉ NO ─────────────────────────────────────────────────────────────
// La I/O entra por `BleEnv`, así que la MÁQUINA DE ESTADOS COMPLETA se ejercita acá con dobles:
// permisos (pedidos vs consultados), radio apagada / no autorizada / no soportada, escaneo filtrado y
// acotado, device reconocido y NO reconocido, conexión, suscripción a notificaciones, reensamblado con
// el troceo real, corte del SO, desconexión de OTRO device, promesas que NO RESUELVEN NUNCA, backoff con
// dwell, background/foreground, doble connect, connect con otro target, y teardown sin timers ni
// suscripciones huérfanas (RBM3.11).
//
// Lo que **NO** prueba, dicho para que el verde no se lea de más: que un dispositivo real notifique y
// que esto lea de verdad. Eso es el banco del ESP32 en `MODO_GATT` (RBM6.1, fase F6) y hasta entonces el
// transporte NO está verificado. Es la lección de `dad711f`: un transporte "escrito y testeado" sin
// device tenía tres 🔴 de máquina de estados.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { stripSourceComments } from '../../utils/strip-comments.ts';
import {
  BleGattAdapter,
  DEFAULT_BLE_TIMINGS,
  bleGattDriverFrom,
  isBleGattTransportAvailable,
  loadBleManager,
  __resetBleModuleStateForTests,
  type BleCharacteristicLike,
  type BleDeviceLike,
  type BleEnv,
  type BleManagerLike,
  type BleModuleEnv,
  type BleSubscription,
  type BleTimerLabel,
  type BleTimings,
} from './adapter-ble-gatt.ts';
import { DRIVER_REGISTRY } from './driver-registry.ts';
import { ingestRawLine } from './contract.ts';
import { ingestModeFor, readSourceFor, type AdapterKind } from './adapter-selection.ts';
import { permissionModelFor } from './permissions.ts';
import { backoffDelayMs } from './line-framer.ts';
import { LINK_DWELL_MS, UNPROMPTED_RETRY_BUDGET_MS } from './connect-trigger.ts';
import { parseRs420Line } from './parser-rs420.ts';
import { BLE_DEFAULT_NOTIFY_PAYLOAD } from './ble-gatt-protocol.ts';
import type { ConnectionStatus } from './stick-adapter.ts';
import {
  androidBluetoothPermissionsFor,
  ANDROID_API_BLUETOOTH_RUNTIME,
  type BluetoothPermissionOutcome,
} from './permissions-android.ts';
import type { ReaderDriver } from './driver-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─── Fixtures ────────────────────────────────────────────────────────────────────────────────────

const NUS_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_NOTIFY = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_SERVICE_CANON = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_NOTIFY_CANON = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const DEV_ID = '11:22:33:44:55:66';
const OTHER_ID = 'AA:BB:CC:00:00:99';

/** La trama del lector SIN su fin de trama (el terminador lo pone cada perfil de driver). */
const FRAME_BODY = '\x021000000982000364696050260530101701';
const RAW_FRAME = `${FRAME_BODY}\r`;
const EID_982 = '982000364696050';

/**
 * Driver SINTÉTICO, local al test. RBM5.11: acá NO se registra ningún lector real —no tenemos ni el
 * Gallagher HR5 v3 ni sus UUID/formato de trama, y un driver con parámetros adivinados convertiría esa
 * incógnita en un verde falso. El del emulador ESP32 es F4, no F3.
 */
function testDriver(over: Partial<ReaderDriver> = {}): ReaderDriver {
  return {
    vendorId: 'test-gatt',
    displayName: 'Lector sintético (test)',
    transports: [{ kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: NUS_NOTIFY } }],
    frameParser: { parse: parseRs420Line },
    deviceMatch: { namePattern: /TEST-GATT/i },
    streaming: true,
    ...over,
  };
}

const TEST_DRIVER = testDriver();

// ── SEGUNDO JUEGO DE PARÁMETROS DE DRIVER, Y POR QUÉ SIN ÉL LA SUITE NO PUEDE PROBAR RBM2.4/2.6/2.8 ──
// Es el 🟠-1 del review de F3, y es el bug de CLASE del `??` del `fakeDevice` una capa más arriba: un
// fixture que no puede expresar la VARIACIÓN no puede probar la PARAMETRIZACIÓN. Mientras todos los
// drivers de esta suite declaraban los mismos UUID Nordic UART y ningún fin de trama propio, los valores
// "del driver" y los de un hardcodeo eran LOS MISMOS BYTES, así que tres mutantes que vuelven a fijar un
// parámetro de fabricante ADENTRO del transporte —exactamente la deuda RMV5.2 que este delta vino a
// cerrar— quedaban en verde con las 136 pruebas pasando:
//
//   · `[params.serviceUuid]` → el literal NUS en el filtro del escaneo   (`adapter-ble-gatt.ts:1088`)
//   · `params.serviceUuid, params.notifyCharUuid` → los dos literales    (`:970-971`)
//   · `new LineFramer(params.delimiter)` → `new LineFramer()`            (`:968`)
//
// El invariante NO se vigila con aserciones sobre el fuente ni sobre nombres (esa clase de guard ya nos
// dejó una grafía afuera dos veces en esta unidad): se OBSERVA. Con un segundo driver cuyos tres
// parámetros son distintos, el comportamiento delata el hardcodeo solo. Y tiene que entrar AHORA: F4
// registra el `ESP32_GATT_DRIVER` con estos mismos UUID NUS, y a partir de ahí el agujero sería invisible
// —el hardcode seguiría verde contra el emulador y contra el banco— hasta el primer lector de tercero
// (Gallagher HR5 v3), donde el síntoma es "escanea y no encuentra nada" / "conecta y se queda mudo".
//
// Los valores son SINTÉTICOS (RBM5.11: acá no se declara ningún lector real), pero las FORMAS son las que
// aparecen de verdad: el servicio en la forma corta de 16 bits en MAYÚSCULAS (así lo escribe ADR-003, y
// así ejercita además la expansión de `normalizeUuid128`), la característica en minúsculas, y un fin de
// trama `\r` — el mundo malo medido en device (🟠-5 del SPP: `term cr` → conectado, mudo, 0 ingestas y
// 0 errores).
const ALT_SERVICE = 'FFE0';
const ALT_NOTIFY = 'ffe1';
const ALT_SERVICE_CANON = '0000ffe0-0000-1000-8000-00805f9b34fb';
const ALT_NOTIFY_CANON = '0000ffe1-0000-1000-8000-00805f9b34fb';
const ALT_DELIMITER = '\r';
const ALT_DEV_ID = '77:88:99:AA:BB:CC';

// Sin factoría con `over`: `testDriver()` ya es la que parametriza, y un knob sin call site es
// exactamente lo que este fix-loop vino a sacar (🟡-3).
const ALT_DRIVER: ReaderDriver = testDriver({
  vendorId: 'test-gatt-alt',
  displayName: 'Lector sintético ALTERNATIVO (test)',
  transports: [
    {
      kind: 'ble-gatt',
      params: { serviceUuid: ALT_SERVICE, notifyCharUuid: ALT_NOTIFY, delimiter: ALT_DELIMITER },
    },
  ],
  deviceMatch: { namePattern: /ALT-GATT/i },
});

/** Un juego COMPLETO de parámetros de transporte, con el device que lo anuncia. */
interface DriverProfile {
  label: string;
  driver: ReaderDriver;
  /** Lo que el adapter tiene que pasarle al escaneo y al monitor (canónico de 128 bits). */
  serviceCanon: string;
  notifyCanon: string;
  /** El fin de trama DE ESTE lector. */
  delimiter: string;
  /** El del OTRO perfil: NO puede cerrar una línea de este driver. */
  foreignDelimiter: string;
  deviceOpts: FakeDeviceOptions;
}

const DRIVER_PROFILES: DriverProfile[] = [
  {
    label: 'Nordic UART + \\n (el supuesto del RS420)',
    driver: TEST_DRIVER,
    serviceCanon: NUS_SERVICE_CANON,
    notifyCanon: NUS_NOTIFY_CANON,
    delimiter: '\n',
    foreignDelimiter: ALT_DELIMITER,
    deviceOpts: { id: DEV_ID, name: 'TEST-GATT-01', serviceUUIDs: [NUS_SERVICE] },
  },
  {
    label: 'servicio de 16 bits + \\r (otro fabricante)',
    driver: ALT_DRIVER,
    serviceCanon: ALT_SERVICE_CANON,
    notifyCanon: ALT_NOTIFY_CANON,
    delimiter: ALT_DELIMITER,
    foreignDelimiter: '\n',
    deviceOpts: { id: ALT_DEV_ID, name: 'ALT-GATT-07', serviceUUIDs: [ALT_SERVICE] },
  },
];

/** Promesa que NO resuelve NUNCA: el corazón de los tests del latch (RBM3.2). */
function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/**
 * Reloj de arranque de los tests que MIDEN UN INTERVALO. No es 0 a propósito (🟡-3 del review de F3: el
 * knob `clock` del doble estaba declarado y nadie lo pasaba, así que TODA la suite corría desde t=0).
 *
 * Con el reloj en 0, `now() - lastDataAt` y `now()` dan EL MISMO NÚMERO, y lo mismo pasa con
 * `now() - connectedAt`: la resta —o sea, la medición— no se puede falsificar. Medido: `silentMs =
 * this.now()` (RBM3.10) y `this.now() >= LINK_DWELL_MS` (RBM3.9) sobreviven la suite entera si todo
 * arranca en cero. Es la misma monocultura de fixtures que el 🟠-1, en el eje del tiempo.
 */
const CLOCK_START = 1_723_000_000_000;

/**
 * Presupuestos chicos: un await colgado vence en ~1 tick en vez de en 20 s.
 *
 * Los cuatro son DISTINTOS entre sí a propósito, y es la misma lección que el 🟠-1 (una monocultura de
 * fixture hace incomprobable un parámetro): con los cuatro en 5, **cuál** presupuesto guarda **cuál**
 * await no se puede observar. Medido: envolver el `connectToDevice` con el presupuesto de una llamada
 * cualquiera (`call` en vez de `connect` — en producción, abandonar el connect a los 10 s cuando Android
 * tarda 10-12 s en rendirse) sobrevivía la suite entera. Ahora el `ms` del `bridge_timeout` lo delata.
 */
const FAST_TIMEOUTS: Partial<BleTimings> = {
  call: 5,
  prompt: 6,
  connect: 7,
  scan: 8,
  livenessPoll: 0,
  silence: 0,
};

function base64(text: string): string {
  return Buffer.from(text, 'latin1').toString('base64');
}

/** Deja correr los `await` internos (los timeouts del puente usan `setTimeout` real). */
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

// ─── Dobles de `react-native-ble-plx` ────────────────────────────────────────────────────────────

interface FakeDeviceOptions {
  id?: string;
  name?: string | null;
  localName?: string | null;
  serviceUUIDs?: string[] | null;
  /** `discoverAllServicesAndCharacteristics` no resuelve nunca. */
  hangDiscover?: boolean;
  /** `discoverAllServicesAndCharacteristics` RECHAZA (distinto de colgarse: ver el test del log). */
  discoverRejects?: Error;
}

function fakeDevice(opts: FakeDeviceOptions = {}) {
  const state = {
    discoverCalls: 0,
    monitorArgs: [] as Array<[string, string]>,
    monitorListeners: [] as Array<(e: unknown, c: BleCharacteristicLike | null) => void>,
    disconnectListeners: [] as Array<(e: unknown, d: BleDeviceLike | null) => void>,
    cancelCalls: 0,
    removedSubs: 0,
  };

  // ⚠️ `??` NO SIRVE en los campos NULABLES de este fixture, y no es un detalle de estilo: con
  // `opts.name ?? 'TEST-GATT-01'`, pedir un device SIN nombre (`{ name: null }`) devolvía uno CON el
  // nombre por default —o sea, uno que el driver RECONOCE— exactamente en los dos tests que prueban lo
  // contrario. Consecuencia medida: el test del `localName` quedaba VERDE matcheando por el GAP name
  // (probaba lo que ya sabíamos y no lo que dice su título), y la contraprueba del auto-sellado se
  // rompía por el camino equivocado (`no hay timer 'scan' pendiente`, porque el escaneo SÍ había
  // matcheado). Un fixture que no puede expresar "el SO no expone este campo" no puede probar nada
  // sobre un device anónimo. `in` distingue "no lo declaré" (→ default) de "lo declaré null" (→ el SO
  // no lo expone), que es justo la diferencia que importa acá.
  const name = 'name' in opts ? opts.name ?? null : 'TEST-GATT-01';
  const localName = 'localName' in opts ? opts.localName ?? null : null;
  const serviceUUIDs = 'serviceUUIDs' in opts ? opts.serviceUUIDs ?? null : [NUS_SERVICE];

  const device: BleDeviceLike = {
    id: opts.id ?? DEV_ID,
    name,
    localName,
    serviceUUIDs,
    discoverAllServicesAndCharacteristics() {
      state.discoverCalls += 1;
      if (opts.hangDiscover) return neverResolves<unknown>();
      if (opts.discoverRejects) return Promise.reject(opts.discoverRejects);
      return Promise.resolve(device);
    },
    monitorCharacteristicForService(serviceUuid, characteristicUuid, listener) {
      state.monitorArgs.push([serviceUuid, characteristicUuid]);
      state.monitorListeners.push(listener);
      const sub: BleSubscription = {
        remove() {
          state.removedSubs += 1;
          // FIEL A LA LIB, y sin knob para apagarlo: su `remove()` hace `BleModule.cancelTransaction(...)`,
          // lo que RECHAZA la promesa del monitor, y `_handleMonitorCharacteristic` traduce ese rechazo en
          // `listener(error, null)`. O sea: nuestro propio teardown dispara el handler de error de lectura,
          // y un fake que no lo reprodujera dejaría sin oráculo el caso "un disconnect() del operario
          // termina RECONECTANDO".
          listener(new Error('cancelled'), null);
        },
      };
      return sub;
    },
    onDisconnected(listener) {
      state.disconnectListeners.push(listener);
      return {
        remove() {
          state.removedSubs += 1;
        },
      };
    },
    cancelConnection() {
      state.cancelCalls += 1;
      return Promise.resolve(device);
    },
  };

  /** Simula una notificación con el valor en base64 (como lo entrega la lib). */
  const notify = (text: string) => {
    for (const l of [...state.monitorListeners]) l(null, { value: base64(text) });
  };
  /** Notificación con un valor que NO se puede decodificar. */
  const notifyRaw = (value: unknown) => {
    for (const l of [...state.monitorListeners]) l(null, { value: value as string });
  };
  /** El SO reporta la desconexión de este device (o de otro, si se le pasa un id). */
  const emitDisconnected = (id: string = device.id, error: unknown = null) => {
    for (const l of [...state.disconnectListeners]) l(error, { ...device, id } as BleDeviceLike);
  };
  /** El monitor MUERE (la lib llama a la callback con el error y remueve su suscripción). */
  const emitMonitorError = (error: unknown = new Error('gatt fail')) => {
    for (const l of [...state.monitorListeners]) l(error, null);
  };

  return { device, state, notify, notifyRaw, emitDisconnected, emitMonitorError };
}

interface FakeManagerOptions {
  state?: string;
  hangState?: boolean;
  device?: BleDeviceLike;
  connectRejects?: Error;
  hangConnect?: boolean;
  /** El `connectToDevice` espera a que el test lo suelte (`state.releaseConnect()`). */
  gateConnect?: boolean;
  /** Devices que el escaneo reporta (sincrónicamente, al arrancar). */
  scanEmits?: BleDeviceLike[];
  /** El escaneo reporta un error por su listener. */
  scanListenerError?: unknown;
  /** `startDeviceScan` RECHAZA (sin permiso, radio abajo): el listener no se llama nunca. */
  scanRejects?: Error;
  /** `startDeviceScan` no resuelve NI rechaza, y no reporta devices. */
  hangScan?: boolean;
  /** La lib no expone `isDeviceConnected` (sin sonda de liveness). */
  omitLivenessProbe?: boolean;
  livenessRejects?: Error;
  hangLiveness?: boolean;
  hangStopScan?: boolean;
}

function fakeManager(opts: FakeManagerOptions = {}) {
  let releaseConnect: () => void = () => undefined;
  const connectGate = opts.gateConnect
    ? new Promise<void>((resolve) => {
        releaseConnect = resolve;
      })
    : Promise.resolve();

  const dev = opts.device ?? fakeDevice().device;

  const state = {
    stateCalls: 0,
    scanCalls: [] as Array<{ uuids: string[] | null; options: Record<string, unknown> | null }>,
    scanListeners: [] as Array<(e: unknown, d: BleDeviceLike | null) => void>,
    stopScanCalls: 0,
    connectCalls: [] as Array<{ id: string; options?: Record<string, unknown> }>,
    isConnectedCalls: [] as string[],
    /** Lo que el nativo cree del link (la 2ª fuente de verdad). */
    linkAlive: true,
    /** El listener GLOBAL de la lib: RBM3.4 exige que NUNCA se use. */
    globalDisconnectSubs: 0,
    releaseConnect: () => releaseConnect(),
    /** Emite un device por el listener del escaneo en curso. */
    emitScan(device: BleDeviceLike) {
      for (const l of [...state.scanListeners]) l(null, device);
    },
  };

  const manager: BleManagerLike & { onDeviceDisconnected?: unknown } = {
    state() {
      state.stateCalls += 1;
      if (opts.hangState) return neverResolves<string>();
      return Promise.resolve(opts.state ?? 'PoweredOn');
    },
    startDeviceScan(uuids, options, listener) {
      state.scanCalls.push({ uuids, options });
      state.scanListeners.push(listener);
      if (opts.scanRejects) return Promise.reject(opts.scanRejects);
      if (opts.hangScan) return neverResolves<void>();
      if (opts.scanListenerError !== undefined) listener(opts.scanListenerError, null);
      for (const d of opts.scanEmits ?? []) listener(null, d);
      return Promise.resolve();
    },
    stopDeviceScan() {
      state.stopScanCalls += 1;
      state.scanListeners = [];
      if (opts.hangStopScan) return neverResolves<void>();
      return Promise.resolve();
    },
    connectToDevice(id, options) {
      state.connectCalls.push({ id, options });
      if (opts.hangConnect) return neverResolves<BleDeviceLike>();
      if (opts.connectRejects) return Promise.reject(opts.connectRejects);
      return connectGate.then(() => dev);
    },
    // ⚠️ ACÁ NO HAY `cancelDeviceConnection(id)`, y la ausencia es el guard (🟡-3 del review de F3): cerrar
    // el link POR ID —en vez de por el objeto `device` que abrió ESTE intento— es exactamente el bug que
    // `canCloseOrphanLink` existe para evitar (un intento vencido le mataría el link al que conectó
    // después). Como `BleManagerLike` tampoco lo declara, un call site nuevo NO COMPILA: es más fuerte que
    // un contador que nadie asierta, que era lo que había.
    ...(opts.omitLivenessProbe
      ? {}
      : {
          isDeviceConnected(id: string) {
            state.isConnectedCalls.push(id);
            if (opts.hangLiveness) return neverResolves<boolean>();
            if (opts.livenessRejects) return Promise.reject(opts.livenessRejects);
            return Promise.resolve(state.linkAlive);
          },
        }),
    // Presente a propósito: el test de RBM3.4 exige que el adapter NO lo use (es el listener GLOBAL,
    // el que en el SPP hacía que unos auriculares le cerraran el socket al bastón).
    onDeviceDisconnected() {
      state.globalDisconnectSubs += 1;
      return { remove() {} };
    },
  };

  return { manager: manager as BleManagerLike, state, device: dev };
}

interface FakeEnvOptions {
  manager?: BleManagerLike | null;
  /** Lo que devuelve `ensurePermissions()` (el que PUEDE mostrar el diálogo del SO). */
  permission?: BluetoothPermissionOutcome;
  /**
   * Lo que devuelve `checkPermissions()` (el que solo CONSULTA). Sin declararlo cae a `permission`, y
   * entonces los dos caminos son indistinguibles POR RESULTADO: el mundo real que hay que poder expresar
   * es `check → denied` + `ensure → granted` (nunca se pidió el permiso; el gesto lo consigue).
   */
  checkPermission?: BluetoothPermissionOutcome;
  remembered?: string | null;
  foreground?: boolean;
  timeouts?: Partial<BleTimings>;
  /** Instante inicial del reloj inyectado. Los tests que MIDEN un intervalo pasan `CLOCK_START`. */
  clock?: number;
  hangPermissions?: boolean;
  hangRemembered?: boolean;
}

function fakeEnv(opts: FakeEnvOptions = {}) {
  const state = {
    written: [] as string[],
    scheduled: [] as Array<{ fn: () => void; ms: number; label: BleTimerLabel }>,
    foregroundListeners: [] as Array<() => void>,
    foreground: opts.foreground ?? true,
    /** Veces que se PIDIÓ el permiso (o sea: veces que pudo aparecer el diálogo del SO). */
    permissionCalls: 0,
    /** Veces que se CONSULTÓ el permiso (nunca muestra nada). */
    permissionChecks: 0,
    rememberedReads: 0,
    clock: opts.clock ?? 0,
    advance(ms: number) {
      state.clock += ms;
    },
    timers(label: BleTimerLabel) {
      return state.scheduled.filter((e) => e.label === label);
    },
    /** Dispara el primer timer de esa etiqueta (y lo saca de la cola, como `setTimeout`). */
    fire(label: BleTimerLabel) {
      const entry = state.scheduled.find((e) => e.label === label);
      assert.ok(entry, `no hay timer '${label}' pendiente`);
      entry.fn();
    },
    resumeForeground() {
      state.foreground = true;
      for (const cb of [...state.foregroundListeners]) cb();
    },
  };

  const env: BleEnv = {
    loadManager: () => opts.manager ?? null,
    ensurePermissions: () => {
      state.permissionCalls += 1;
      if (opts.hangPermissions) return neverResolves<BluetoothPermissionOutcome>();
      return Promise.resolve(opts.permission ?? 'granted');
    },
    checkPermissions: () => {
      state.permissionChecks += 1;
      if (opts.hangPermissions) return neverResolves<BluetoothPermissionOutcome>();
      return Promise.resolve(opts.checkPermission ?? opts.permission ?? 'granted');
    },
    readRemembered: () => {
      state.rememberedReads += 1;
      if (opts.hangRemembered) return neverResolves<string | null>();
      return Promise.resolve(opts.remembered ?? null);
    },
    writeRemembered: async (id: string) => {
      state.written.push(id);
    },
    isForeground: () => state.foreground,
    schedule: (fn: () => void, ms: number, label: BleTimerLabel) => {
      const entry: { fn: () => void; ms: number; label: BleTimerLabel } = {
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
    // Sin timeouts ni poll por defecto: los tests que ejercitan el vencimiento pasan FAST_TIMEOUTS.
    timeouts: opts.timeouts ?? { call: 0, prompt: 0, connect: 0, scan: 0, livenessPoll: 0, silence: 0 },
  };
  return { env, state };
}

function track(adapter: BleGattAdapter) {
  const statuses: ConnectionStatus[] = [];
  const tags: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  adapter.onTagRead((t) => tags.push(t));
  return { statuses, tags };
}

/** Adapter conectado a un device, listo para ejercitar el stream. Devuelve todo lo que hace falta. */
async function connected(over: { deviceOpts?: FakeDeviceOptions; envOpts?: FakeEnvOptions } = {}) {
  const d = fakeDevice(over.deviceOpts);
  const m = fakeManager({ device: d.device });
  const e = fakeEnv({ manager: m.manager, ...over.envOpts });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'connected', 'el fixture tiene que quedar CONECTADO');
  return { adapter, d, m, e, seen };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A. Identidad, driver inmutable y el `ReadSource` que se resuelve AL CABLEAR
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.1/RBM2.11: el adapter es kind `ble-gatt` y su modo de ingesta es `raw-line`', () => {
  const { env } = fakeEnv();
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  assert.equal(adapter.kind, 'ble-gatt');
  assert.equal(ingestModeFor('ble-gatt'), 'raw-line');
  assert.deepEqual(permissionModelFor('ble-gatt'), { kind: 'ble' });
});

test('RBM1.3: el adapter EXPONE su driver (identidad) para que el contrato lea su frameParser', () => {
  const { env } = fakeEnv();
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  assert.equal(adapter.driver, TEST_DRIVER);
  const otro = testDriver({ vendorId: 'otro' });
  assert.equal(new BleGattAdapter(otro, env).driver, otro);
});

test('⚪-3 de F1: el `ReadSource` se resuelve al CABLEAR y el driver NO MUTA al elegir un device', async () => {
  // EL RIESGO QUE ESTE TEST FIJA (el reviewer de F1 lo dejó escrito para esta fase): el provider resuelve
  // `readSourceFor(adapter)` UNA vez al cablear, no por bastonazo. Si elegir un device en el escaneo
  // MUTARA el driver del adapter ya montado, el `ReadSource` quedaría con el parser viejo y el transporte
  // nacería MUDO — conecta, recibe tramas, no ingiere ni una, 0 lecturas y 0 errores.
  const avisos: AdapterKind[] = [];
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, scanEmits: [d.device] });
  const { env } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);

  const alCablear = readSourceFor(adapter, (k) => avisos.push(k));
  assert.equal(alCablear.mode, 'raw-line');
  assert.equal(alCablear.frameParser, TEST_DRIVER.frameParser, 'el parser sale del driver del adapter');
  // `assert.equal(length)` y NO `deepEqual(avisos, [])`: la firma de `deepEqual` en @types/node es
  // `asserts actual is T`, así que comparar contra `[]` NARRA `avisos` a `never[]` para el resto del
  // bloque y el `avisos.push(k)` de abajo deja de compilar (`app/tsconfig.json` excluye los tests, así
  // que eso NO lo ve el typecheck del repo — se encontró corriendo tsc a mano sobre este archivo).
  assert.equal(avisos.length, 0, 'un adapter con driver NO avisa fail-closed');

  const seen = track(adapter);
  // Un ciclo completo: escaneo → elección de device → conexión → lectura.
  await adapter.connect();
  assert.equal(seen.statuses.at(-1), 'connected');
  d.notify(`${RAW_FRAME}\n`);

  // El driver es EL MISMO OBJETO: el `ReadSource` de arriba sigue siendo válido.
  assert.equal(adapter.driver, TEST_DRIVER, 'elegir un device NO puede mutar el driver de la instancia');
  const despues = readSourceFor(adapter, (k) => avisos.push(k));
  assert.equal(despues.frameParser, alCablear.frameParser, 'mismo parser antes y después de conectar');
  // Y la lectura se ingiere con ESE parser (el oráculo de punta a punta).
  assert.deepEqual(ingestRawLine(seen.tags[0], alCablear.frameParser!), { ok: true, eid: EID_982 });
});

test('RBM5.11: `bleGattDriverFrom` devuelve el primero que declara ble-gatt, o null', () => {
  assert.equal(bleGattDriverFrom([]), null);
  const sinGatt = testDriver({ transports: [{ kind: 'spp', params: { sppUuid: NUS_SERVICE } }] });
  assert.equal(bleGattDriverFrom([sinGatt]), null);
  assert.equal(bleGattDriverFrom([sinGatt, TEST_DRIVER]), TEST_DRIVER);
});

test('GUARD: si el registro llega a declarar DOS drivers `ble-gatt`, "el primero" deja de alcanzar', () => {
  // Elegir CUÁL lector se monta cuando hay varios candidatos es RBM5.6 (F4: sale del bastón recordado).
  // Mientras haya como máximo UNO, `bleGattDriverFrom` es determinístico y no hay decisión que tomar.
  // Este guard hace que el día que entre el segundo (el Gallagher HR5 v3, cuando llegue su documentación)
  // NAZCA EN ROJO en vez de que "el primero" se convierta en un fallback silencioso — que es exactamente
  // la familia de bug (`DRIVER_REGISTRY[0]`) que el review de F1 rechazó.
  const conGatt = DRIVER_REGISTRY.filter((d) => d.transports.some((t) => t.kind === 'ble-gatt'));
  assert.ok(
    conGatt.length <= 1,
    `el registro declara ${conGatt.length} drivers ble-gatt (${conGatt
      .map((d) => d.vendorId)
      .join(', ')}): hay que cablear la preferencia del bastón recordado (RBM5.6/T4.6) antes de que "el primero" decida por el operario`,
  );
});

test('RBM2.3: sin driver ble-gatt en el registro, el transporte NO está disponible (y lo dice)', async () => {
  const logs = await withLogs(async () => {
    assert.equal(isBleGattTransportAvailable([]), false);
  });
  assert.ok(
    logs.some((l) => l.includes('no_ble_gatt_driver')),
    'los dos motivos de "no disponible" se loguean por separado: sin driver no hay ni filtro de escaneo',
  );
});

test('RBM2.2/RBM2.3: sin módulo nativo, `loadBleManager` devuelve null y el transporte no se monta', async () => {
  __resetBleModuleStateForTests();
  // En node no hay RN: el require perezoso falla y se devuelve null EN SILENCIO (es lo esperado en
  // web/CI, no una falla que valga la pena reportar).
  assert.equal(loadBleManager(), null);
  const logs = await withLogs(async () => {
    assert.equal(isBleGattTransportAvailable([TEST_DRIVER]), false);
  });
  assert.ok(logs.some((l) => l.includes('no_native_module')));
  assert.equal(
    logs.some((l) => l.includes('ble_manager_load_failed')),
    false,
    '"no hay RN" no es "la lib explotó": si se loguearan igual, el ruido taparía el caso que importa',
  );
});

// ── RBM3.8 / 🟠-1 del review de F4: EL ARRANQUE EN FRÍO NO PUEDE CONSTRUIR EL MANAGER ──────────────
// En iOS el diálogo de permiso de Bluetooth no lo pide una API: lo muestra el SO cuando la app usa
// CoreBluetooth por primera vez, y **construir el central manager es ese primer uso**. El as-built de F4
// lo construía dentro de `isBleGattTransportAvailable()`, o sea dentro de `instantiateTransport` — el
// primer render del provider, sin un solo gesto del operario. El comentario del archivo afirmaba lo
// contrario, y esa clase de defecto ("el comentario promete más que el código") ya costó un 🔴 en esta
// unidad. Por eso el oráculo es de COMPORTAMIENTO y no una aserción sobre el texto: se CUENTAN las
// construcciones del manager en el borde inyectado.

/** Borde del módulo nativo con contadores: el binario "está" y construir el manager se cuenta. */
function countingModuleEnv(opts: { present?: boolean } = {}) {
  const state = { presenceChecks: 0, constructions: 0 };
  const manager = fakeManager().manager;
  const env: BleModuleEnv = {
    nativeModulePresent: () => {
      state.presenceChecks += 1;
      return opts.present ?? true;
    },
    constructManager: () => {
      state.constructions += 1;
      return manager;
    },
  };
  return { env, state, manager };
}

test('RBM3.8: `isBleGattTransportAvailable` CONSULTA el módulo nativo y NO construye el manager', () => {
  const mod = countingModuleEnv();
  __resetBleModuleStateForTests(mod.env);
  try {
    assert.equal(isBleGattTransportAvailable([TEST_DRIVER]), true);
    assert.equal(mod.state.presenceChecks, 1, 'tiene que consultar la presencia del binario');
    assert.equal(
      mod.state.constructions,
      0,
      'construir el BleManager crea el CBCentralManager → el diálogo del SO en iOS: no puede pasar en un chequeo de disponibilidad',
    );
    // Y sin driver `ble-gatt` en el registro corta ANTES incluso de consultar el módulo (el orden de los
    // dos gates es parte de la decisión: el barato primero).
    const antes = mod.state.presenceChecks;
    assert.equal(isBleGattTransportAvailable([]), false);
    assert.equal(mod.state.presenceChecks, antes, 'sin driver no hace falta preguntarle nada al SO');
    assert.equal(mod.state.constructions, 0);
  } finally {
    __resetBleModuleStateForTests();
  }
});

test('RBM3.8: un ARRANQUE EN FRÍO (montar el transporte + autoConnect sin bastón) construye CERO managers', async () => {
  // Reproduce la secuencia exacta de producción, con el ENTORNO REAL del adapter (`defaultBleEnv`, o sea
  // el `loadManager` de verdad): `instantiateTransport('ble-gatt')` pregunta si el transporte está
  // disponible, construye el adapter y el efecto de wiring llama `autoConnect()`. En un teléfono recién
  // instalado no hay bastón recordado, así que la radio no se puede tocar (RBM3.8).
  const mod = countingModuleEnv();
  __resetBleModuleStateForTests(mod.env);
  try {
    assert.equal(isBleGattTransportAvailable([TEST_DRIVER]), true, 'el transporte se monta');
    const adapter = new BleGattAdapter(TEST_DRIVER); // env REAL: readRemembered/loadManager de producción
    const seen = track(adapter);
    await withLogs(async () => {
      await adapter.autoConnect();
    });
    assert.deepEqual(seen.statuses, [], 'un arranque en frío no emite estado: nunca se intentó');
    assert.equal(
      mod.state.constructions,
      0,
      'el arranque en frío construyó el manager: en iOS eso es el diálogo de Bluetooth sin un gesto del operario',
    );
  } finally {
    __resetBleModuleStateForTests();
  }
});

test('RBM2.16: con un bastón recordado, el manager SÍ se construye — y una sola vez (control positivo)', async () => {
  // Contraprueba del test de arriba: si "cero construcciones" fuera cierto SIEMPRE, el oráculo no probaría
  // nada (bastaría con romper `loadBleManager` para que los dos pasaran). Acá el gate del bastón recordado
  // SÍ pasa, así que la construcción tiene que ocurrir — y quedar cacheada (el `BleManager` de la lib es
  // un singleton).
  const mod = countingModuleEnv();
  __resetBleModuleStateForTests(mod.env);
  try {
    const { env } = fakeEnv({ remembered: DEV_ID });
    // El `loadManager` REAL (el que construye), con el resto del entorno inyectado.
    (env as { loadManager: () => BleManagerLike | null }).loadManager = loadBleManager;
    const adapter = new BleGattAdapter(TEST_DRIVER, env);
    track(adapter);
    await withLogs(async () => {
      await adapter.autoConnect();
    });
    assert.equal(mod.state.constructions, 1, 'con bastón recordado el autoConnect tiene que llegar a la radio');
    assert.equal(loadBleManager(), mod.manager, 'y devuelve el mismo manager');
    assert.equal(mod.state.constructions, 1, 'el manager se cachea: una construcción por proceso');
  } finally {
    __resetBleModuleStateForTests();
  }
});

test('RBM2.3: sin el binario en el build, ni disponibilidad ni manager (y nunca se intenta construir)', () => {
  const mod = countingModuleEnv({ present: false });
  __resetBleModuleStateForTests(mod.env);
  try {
    assert.equal(isBleGattTransportAvailable([TEST_DRIVER]), false);
    assert.equal(loadBleManager(), null);
    assert.equal(mod.state.constructions, 0, 'sin binario, construir tiraría (`BleModule === undefined`)');
  } finally {
    __resetBleModuleStateForTests();
  }
});

test('un adapter construido SIN driver no tira (no se lleva el render) y corta con log', async () => {
  const m = fakeManager();
  const { env } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(null, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.equal(m.state.connectCalls.length, 0, 'sin driver no hay a qué conectarse');
  assert.ok(logs.some((l) => l.includes('driver-sin-ble-gatt')));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B. Params del driver: nada hardcodeado, y el delimitador imposible NO abre la conexión
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.10: un delimitador que no podemos framear NO abre la conexión (con su motivo en el log)', async () => {
  const m = fakeManager();
  const { env } = fakeEnv({ manager: m.manager });
  const roto = testDriver({
    transports: [
      { kind: 'ble-gatt', params: { serviceUuid: NUS_SERVICE, notifyCharUuid: NUS_NOTIFY, delimiter: '' } },
    ],
  });
  const adapter = new BleGattAdapter(roto, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.equal(m.state.connectCalls.length, 0, 'conectar y quedarse mudo es peor que no conectar');
  assert.ok(logs.some((l) => l.includes('delimitador-no-soportado')));
});

test('RBM2.4/RBM2.6: los UUID del driver llegan al monitor NORMALIZADOS, y el connect no pide MTU', async () => {
  // ⚠️ Este test mide la NORMALIZACIÓN (el driver los declara en mayúsculas con guiones, el nativo los
  // quiere canónicos en minúsculas) y el `deepEqual` EXHAUSTIVO de las opciones del connect (un
  // `requestMTU` nuevo cae acá, RBM2.12). Lo que NO puede medir es que los UUID salgan DEL DRIVER: los del
  // driver y los de un hardcodeo de los NUS son los mismos bytes. Esa mitad la prueban los dos tests
  // parametrizados de abajo, y por eso el título de este ya no la reclama (🟠-1 del review de F3).
  const { d, m } = await connected();
  assert.deepEqual(d.state.monitorArgs, [[NUS_SERVICE_CANON, NUS_NOTIFY_CANON]]);
  assert.equal(d.state.discoverCalls, 1, 'hay que descubrir servicios antes de suscribirse');
  assert.deepEqual(m.state.connectCalls[0].options, { autoConnect: false, timeout: 0 });
});

test('ANTI-VACUIDAD de los perfiles: los dos juegos de parámetros son DISTINTOS en los TRES campos', () => {
  // Sin esto los tests parametrizados de abajo serían teatro el día que alguien "prolije" los fixtures
  // igualando los UUID o los delimitadores: pasarían igual con los tres parámetros hardcodeados.
  assert.ok(DRIVER_PROFILES.length >= 2, 'hace falta MÁS DE UN juego de parámetros o no hay variación');
  const [a, b] = DRIVER_PROFILES;
  assert.notEqual(a.serviceCanon, b.serviceCanon, 'los servicios tienen que diferir');
  assert.notEqual(a.notifyCanon, b.notifyCanon, 'las características tienen que diferir');
  assert.notEqual(a.delimiter, b.delimiter, 'los fines de trama tienen que diferir');
  // Y ninguno de los del perfil alternativo puede coincidir con NINGUNO de los canónicos NUS: un
  // hardcodeo de los NUS no puede matchear al perfil alternativo ni por casualidad.
  for (const uuid of [b.serviceCanon, b.notifyCanon]) {
    assert.ok(uuid !== NUS_SERVICE_CANON && uuid !== NUS_NOTIFY_CANON, `${uuid} colisiona con los NUS`);
  }
  assert.equal(a.foreignDelimiter, b.delimiter, 'el terminador "ajeno" de cada perfil es el del otro');
  assert.equal(b.foreignDelimiter, a.delimiter);
});

test('ANTI-VACUIDAD de los presupuestos del doble: los cuatro de `FAST_TIMEOUTS` son DISTINTOS', () => {
  // Misma clase que el test de arriba, en el eje de los presupuestos: si los cuatro fueran iguales, los
  // tests que asertan el `ms` de un `bridge_timeout` no podrían ver CUÁL presupuesto se usó.
  const budgets = [FAST_TIMEOUTS.call, FAST_TIMEOUTS.prompt, FAST_TIMEOUTS.connect, FAST_TIMEOUTS.scan];
  assert.equal(new Set(budgets).size, budgets.length, `los presupuestos del doble se repiten: ${budgets}`);
  for (const ms of budgets) assert.ok(typeof ms === 'number' && ms > 0, 'y todos tienen que ser techos reales');
});

for (const profile of DRIVER_PROFILES) {
  test(`RBM2.4/RBM2.6/RBM2.8: los TRES parámetros del transporte salen DEL DRIVER — ${profile.label}`, async () => {
    // De punta a punta con el juego de parámetros de ESTE driver: escaneo → device reconocido →
    // conexión → suscripción → reensamblado → EID. Cada aserción mata uno de los tres mutantes que
    // re-hardcodean un parámetro de fabricante adentro del transporte (ver el comentario de los perfiles).
    const d = fakeDevice(profile.deviceOpts);
    const m = fakeManager({ device: d.device, scanEmits: [d.device] });
    const { env, state } = fakeEnv({ manager: m.manager });
    const adapter = new BleGattAdapter(profile.driver, env);
    const seen = track(adapter);
    await adapter.connect(); // SIN target: hay que pasar por el escaneo, que es donde se ve el filtro
    assert.equal(seen.statuses.at(-1), 'connected', 'el fixture tiene que llegar a conectar');
    // Bonus del segundo perfil, encontrado con el mismo instrumento (autorrevisión): el device del perfil
    // alternativo tiene OTRO id, así que acá se ve que el bastón que se RECUERDA es el que se conectó y no
    // una constante. Medido: con `writeRemembered('11:22…')` hardcodeado la suite pasaba entera, y en
    // producción eso deja a R6.4/RBM2.16 reconectando SIEMPRE al mismo id (el que el operario eligió, no).
    assert.deepEqual(state.written, [d.device.id], 'se recuerda el device que se conectó');

    // (a) EL FILTRO DEL ESCANEO (`adapter-ble-gatt.ts:1088`).
    assert.equal(m.state.scanCalls.length, 1);
    assert.deepEqual(
      m.state.scanCalls[0].uuids,
      [profile.serviceCanon],
      'se escanea filtrando por el servicio DE ESTE driver (un literal de fabricante acá deja al lector siguiente sin encontrar nada)',
    );

    // (b) EL SERVICIO Y LA CARACTERÍSTICA DEL MONITOR (`:970-971`).
    assert.deepEqual(
      d.state.monitorArgs,
      [[profile.serviceCanon, profile.notifyCanon]],
      'se monitorea la característica DE ESTE driver (un literal acá conecta y se queda mudo)',
    );

    // (c) EL FIN DE TRAMA DEL FRAMER (`:968`). Las DOS direcciones: el terminador del OTRO lector no
    // cierra nada, y el propio sí. Sin la primera mitad, un framer con el default `\n` pasaría en verde
    // para el perfil que justamente usa `\n`.
    d.notify(`${FRAME_BODY}${profile.foreignDelimiter}`);
    assert.equal(
      seen.tags.length,
      0,
      'el fin de trama del OTRO lector NO cierra una línea de este (si cerrara, el delimitador no sería del driver)',
    );
    d.notify(profile.delimiter);
    assert.equal(seen.tags.length, 1, 'el fin de trama DE ESTE lector cierra la línea');
    assert.deepEqual(ingestRawLine(seen.tags[0], profile.driver.frameParser), { ok: true, eid: EID_982 });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// C. Permisos (RBM2.13/RBM2.14/RBM3.8)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.14: permiso DENEGADO → `permission_denied`, sin backoff y sin tocar la radio', async () => {
  const m = fakeManager();
  const { env, state } = fakeEnv({ manager: m.manager, permission: 'denied' });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'permission_denied');
  assert.equal(m.state.connectCalls.length, 0);
  assert.equal(m.state.stateCalls, 0, 'sin permiso no se consulta ni el estado de la radio');
  assert.deepEqual(state.timers('reconnect'), [], 'el reintento lo dispara el operario, no un backoff');
});

test('RBM2.13: el entorno REAL pide el conjunto de permisos DEL TRANSPORTE BLE, no el del SPP', () => {
  // ⚠️ ORÁCULO ESTÁTICO, y está declarado como tal. Toda la suite inyecta un `BleEnv` falso, así que
  // NADA de acá ejerce `defaultBleEnv()`: el conjunto de permisos que el transporte pide de verdad es
  // el único punto de este archivo que ningún test de comportamiento toca. Se midió: cambiar los dos
  // literales a `'spp'` deja 121 tests en VERDE (el mutante M4 del informe de F3), y en producción eso
  // significa que en API ≥ 31 no se pide `BLUETOOTH_SCAN` y en API ≤ 30 no se pide `ACCESS_FINE_LOCATION`
  // → el escaneo no devuelve NADA, sin un error y sin un log. Es el silencio indistinguible de "el
  // operario no está bastoneando", otra vez.
  //
  // Un oráculo de comportamiento no es posible sin RN: las dos funciones asincrónicas devuelven
  // `'unavailable'` para los dos transportes cuando no hay `PermissionsAndroid`, así que el argumento no
  // se puede observar desde node:test.
  const src = stripSourceComments(readFileSync(resolve(HERE, 'adapter-ble-gatt.ts'), 'utf8'));
  const calls = [...src.matchAll(/(?:ensure|check)AndroidBluetoothPermissions\(\s*'([^']*)'\s*\)/g)].map(
    (m) => m[1],
  );
  assert.equal(calls.length, 2, `se esperaban los 2 call sites de permisos (ensure + check), hay ${calls.length}: el extractor quedó ciego o alguien agregó/borró uno`);
  assert.deepEqual(calls, ['ble-gatt', 'ble-gatt'], 'los dos caminos (gesto y automático) piden el conjunto del transporte BLE');

  // CONTRAPRUEBA: que los dos conjuntos sean DISTINTOS de verdad. Si `spp` y `ble-gatt` pidieran lo
  // mismo, este guard no estaría vigilando nada (y la tabla exhaustiva de RBM2.13 tampoco).
  assert.notDeepEqual(
    androidBluetoothPermissionsFor(ANDROID_API_BLUETOOTH_RUNTIME, 'ble-gatt'),
    androidBluetoothPermissionsFor(ANDROID_API_BLUETOOTH_RUNTIME, 'spp'),
    'si los conjuntos fueran iguales, pedir el del SPP sería inocuo y este guard sería teatro',
  );
  assert.notDeepEqual(
    androidBluetoothPermissionsFor(ANDROID_API_BLUETOOTH_RUNTIME - 1, 'ble-gatt'),
    androidBluetoothPermissionsFor(ANDROID_API_BLUETOOTH_RUNTIME - 1, 'spp'),
    'en API ≤ 30 la diferencia es ACCESS_FINE_LOCATION, que es lo que el escaneo BLE exige',
  );
});

test('RBM3.8: el camino AUTOMÁTICO consulta el permiso; jamás lo pide (ni al arrancar ni al reintentar)', async () => {
  const m = fakeManager({ connectRejects: new Error('boom') });
  const { env, state } = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  assert.equal(state.permissionCalls, 0, 'un diálogo del SO en el primer frame es el gesto que nadie pidió');
  assert.ok(state.permissionChecks >= 1);

  // Y el reintento del backoff tampoco pide.
  const antes = state.permissionCalls;
  state.fire('reconnect');
  await flush();
  assert.equal(state.permissionCalls, antes);
});

test('RBM3.8: el GESTO del operario sí pide el permiso (es el único momento con contexto)', async () => {
  const m = fakeManager();
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  track(adapter);
  await adapter.connect(DEV_ID);
  assert.equal(state.permissionCalls, 1);
  assert.equal(state.permissionChecks, 0);
});

test('RBM3.8: CONSULTAR y PEDIR pueden dar resultados distintos, y cada camino respeta EL SUYO', async () => {
  // 🟡-3 del review de F3: el knob `checkPermission` del doble estaba declarado y NINGÚN test lo pasaba,
  // así que en toda la suite `checkPermissions()` y `ensurePermissions()` devolvían LO MISMO — los dos
  // caminos solo se distinguían por los CONTADORES de llamadas, nunca por su RESULTADO. Consecuencia
  // medida: borrar el gate de permiso del `autoConnect` dejaba las 140 pruebas en verde.
  //
  // El mundo real que ejercita este test es el más común de todos: el operario abre la app por primera vez
  // después de elegir un bastón —el permiso NO está concedido todavía— y recién su GESTO puede mostrar el
  // diálogo y conseguirlo. `check → denied` y `ensure → granted` en la misma corrida.
  const d = fakeDevice();
  const m = fakeManager({ device: d.device });
  const { env, state } = fakeEnv({
    manager: m.manager,
    checkPermission: 'denied',
    permission: 'granted',
    remembered: DEV_ID,
  });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);

  // (1) El arranque CONSULTA: sin permiso concedido no arranca, y no puede pedirlo.
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.equal(state.permissionChecks, 1);
  assert.equal(state.permissionCalls, 0, 'un diálogo del SO en el primer frame es el gesto que nadie pidió');
  assert.equal(m.state.connectCalls.length, 0, 'el gate de permiso del arranque tiene que GATEAR de verdad');
  assert.equal(m.state.stateCalls, 0, 'y sin permiso no se toca la radio');
  assert.deepEqual(seen.statuses, [], 'un gate que no pasa NO emite estado: se queda en `off` (honesto)');
  assert.ok(logs.some((l) => l.includes('autoconnect_skipped') && l.includes('permission')));

  // (2) El gesto PIDE: aparece el diálogo, el operario concede, y conecta.
  await adapter.connect(DEV_ID);
  assert.equal(state.permissionCalls, 1, 'el gesto es el único momento con contexto para pedirlo');
  assert.equal(seen.statuses.at(-1), 'connected');
});

test('permiso `unavailable` (sin RN / puente roto) → `disconnected` con log, no `granted`', async () => {
  const m = fakeManager();
  const { env } = fakeEnv({ manager: m.manager, permission: 'unavailable' });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.equal(m.state.connectCalls.length, 0);
  assert.ok(logs.some((l) => l.includes('ble_permission_unavailable')));
});

test('RBM3.2: el permiso que NO RESUELVE NUNCA vence, libera el latch y deja reintentar', async () => {
  const m = fakeManager();
  const { env } = fakeEnv({ manager: m.manager, hangPermissions: true, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  const vencido = logs.find((l) => l.includes('bridge_timeout') && l.includes('ensure_permissions'));
  assert.ok(vencido);
  assert.equal(
    (JSON.parse(vencido) as { ms: number }).ms,
    FAST_TIMEOUTS.prompt,
    'el presupuesto de un diálogo es el de esperar a una PERSONA (`prompt`), no el de una llamada',
  );

  // EL PUNTO: el latch quedó libre. Con un env sano, el connect siguiente funciona (sin esto, el bastón
  // queda muerto hasta reiniciar la app — los 2 min 40 s medidos en el A07).
  const sano = fakeManager();
  (env as { loadManager: () => BleManagerLike }).loadManager = () => sano.manager;
  (env as { ensurePermissions: () => Promise<BluetoothPermissionOutcome> }).ensurePermissions = () =>
    Promise.resolve('granted');
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'connected');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// D. La radio: se consulta, NUNCA se pide prenderla (RBM3.8)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('radio APAGADA → `disconnected` con log, sin conectar, y el reintento sigue vivo', async () => {
  const m = fakeManager({ state: 'PoweredOff' });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'scanning', 'tras el disconnected queda el backoff armado');
  assert.equal(m.state.connectCalls.length, 0);
  assert.ok(logs.some((l) => l.includes('ble_state_not_ready') && l.includes('PoweredOff')));
  assert.equal(state.timers('reconnect').length, 1, 'PoweredOff puede cambiar solo → se reintenta');
});

test('RBM2.14 (iOS): radio `Unauthorized` → `permission_denied` con CTA y SIN backoff', async () => {
  // En iOS no hay API para volver a pedir el permiso de Bluetooth: se arregla en Ajustes. Es el MISMO
  // estado que un permiso denegado en Android, y por eso NO se reintenta solo.
  const m = fakeManager({ state: 'Unauthorized' });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'permission_denied');
  assert.deepEqual(state.timers('reconnect'), []);
  assert.ok(logs.some((l) => l.includes('ble_state_unauthorized')));
});

test('radio `Unsupported` (el teléfono no tiene BLE) → `disconnected` y NO se reintenta nunca', async () => {
  const m = fakeManager({ state: 'Unsupported' });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.deepEqual(state.timers('reconnect'), [], 'reintentar contra hardware que no existe es martillar');
});

test('el `autoConnect` NO arranca con la radio apagada (y no puede pedir prenderla)', async () => {
  const m = fakeManager({ state: 'PoweredOff' });
  const { env, state } = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.deepEqual(seen.statuses, [], 'un gate que no pasa NO emite estado: se queda en `off`');
  assert.equal(m.state.connectCalls.length, 0);
  assert.deepEqual(state.timers('reconnect'), []);
  assert.ok(logs.some((l) => l.includes('autoconnect_skipped') && l.includes('bluetooth_off')));
});

test('el estado de la radio ILEGIBLE (puente colgado) no inventa "prendé el Bluetooth" en un gesto', async () => {
  // Al revés que en `autoConnect`: acá el operario pidió conectar, así que ante la duda se sigue y el
  // error real lo da el connect. Un diálogo/copy inventado sobre una radio que no pudimos leer es peor
  // diagnóstico que el error verdadero.
  const m = fakeManager({ hangState: true });
  const { env } = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(m.state.connectCalls.length, 1, 'se sigue adelante');
  assert.equal(seen.statuses.at(-1), 'connected');
  assert.ok(logs.some((l) => l.includes('bridge_timeout') && l.includes('ble_state')));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// E. Escaneo: FILTRADO por servicio y ACOTADO por presupuesto (RBM2.4/RBM2.5/RBM5.13)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.4: el escaneo va FILTRADO por el `serviceUuid` del driver (nunca sin filtro)', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, scanEmits: [d.device] });
  const { env } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  await adapter.connect();
  assert.equal(m.state.scanCalls.length, 1);
  assert.deepEqual(m.state.scanCalls[0].uuids, [NUS_SERVICE_CANON]);
  assert.deepEqual(m.state.scanCalls[0].options, { allowDuplicates: false });
  assert.ok(seen.statuses.includes('scanning'));
  assert.equal(seen.statuses.at(-1), 'connected');
  assert.equal(m.state.stopScanCalls, 1, 'el escaneo se detiene AL CONECTAR');
});

test('RBM2.5: el escaneo que se agota se DETIENE, loguea `ble_scan_timeout` y no dispara backoff', async () => {
  const m = fakeManager(); // ningún device aparece
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    const p = adapter.connect();
    await flush();
    assert.equal(state.timers('scan').length, 1, 'el escaneo nace con presupuesto');
    state.fire('scan');
    await p;
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.equal(m.state.stopScanCalls, 1, 'un escaneo que nadie apaga es el latch eterno de BLE');
  const timeout = logs.find((l) => l.includes('ble_scan_timeout'));
  assert.ok(timeout);
  assert.match(timeout, /"seen":0/);
  assert.deepEqual(
    state.timers('reconnect'),
    [],
    'el descubrimiento es un GESTO: reintentarlo solo deja la radio escaneando para siempre',
  );
});

test('RBM5.13: un device que anuncia el MISMO servicio pero NO lo reconoce el driver no se conecta', async () => {
  // El caso real: el bridge de la balanza Vesta (ADR-003) anuncia los mismos UUID Nordic UART. Un match
  // por UUID de servicio lo tomaría por bastón y le mandaría el peso al ingesta de EID. Lo único que los
  // distingue es el NOMBRE.
  const bridge = fakeDevice({ id: OTHER_ID, name: 'VESTA_BRIDGE', serviceUUIDs: [NUS_SERVICE] });
  const m = fakeManager({ scanEmits: [bridge.device] });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    const p = adapter.connect();
    await flush();
    state.fire('scan');
    await p;
  });
  assert.equal(m.state.connectCalls.length, 0, 'no es un bastón: no se conecta');
  assert.equal(seen.statuses.at(-1), 'disconnected');
  const noReconocido = logs.find((l) => l.includes('ble_device_not_recognized'));
  assert.ok(noReconocido, 'el device que anuncia el servicio y no matchea tiene que dejar rastro');
  assert.match(
    noReconocido,
    /ble_device_not_recognized: #1 del escaneo/,
    'el ordinal dentro del escaneo es lo que hace legible "vi N cosas y ninguna era un bastón"',
  );
  // MEDIUM-2 del Gate 2: el IDENTIFICADOR del dispositivo ajeno NO sale en ningún log. En Android es la
  // MAC, el dispositivo es de un TERCERO (acá el bridge de la balanza; en el campo, lo que haya cerca) y
  // el destino de estos eventos es un breadcrumb de Sentry, donde el scrubber de `redact.ts` es key-based
  // y no puede alcanzar un valor interpolado dentro de una oración.
  assert.equal(
    logs.some((l) => l.includes(OTHER_ID)),
    false,
    'el id del dispositivo ajeno no puede salir a la telemetría (iba interpolado en el `message`)',
  );
  const timeout = logs.find((l) => l.includes('ble_scan_timeout'));
  assert.match(
    timeout as string,
    /"seen":1/,
    '`seen` separa "no hay nada" de "hay algo con ese servicio que no es un bastón"',
  );
});

test('META-TEST del fixture: un device declarado ANÓNIMO sale anónimo de verdad', () => {
  // El guard del fixture, sobre la AUSENCIA de los campos. Sin esto, volver a poner `??` en `fakeDevice`
  // deja los dos tests de abajo verdes probando otra cosa (fue exactamente lo que pasó: el `localName`
  // matcheaba por el GAP name del default). Un fixture derivado de lo que verifica es la familia de
  // verde mentiroso que esta feature ya se comió.
  const anon = fakeDevice({ name: null, localName: null, serviceUUIDs: null }).device;
  assert.equal(anon.name, null, 'pedir `name: null` NO puede devolver el nombre por default');
  assert.equal(anon.localName, null);
  assert.equal(anon.serviceUUIDs, null, 'pedir `serviceUUIDs: null` NO puede devolver los UUID por default');
  // Y el default sigue siendo el device reconocible (si no, TODOS los tests del camino feliz probarían
  // el camino del device anónimo sin que nadie se enterara).
  const porDefecto = fakeDevice().device;
  assert.equal(porDefecto.name, 'TEST-GATT-01');
  assert.deepEqual(porDefecto.serviceUUIDs, [NUS_SERVICE]);
});

test('el reconocimiento acepta el nombre del ANUNCIO (`localName`) y no solo el GAP name', async () => {
  const d = fakeDevice({ name: null, localName: 'test-gatt-42' });
  assert.equal(d.device.name, null, 'sin esto el test matchearía por el GAP name y no probaría el localName');
  const m = fakeManager({ device: d.device, scanEmits: [d.device] });
  const { env } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  await adapter.connect();
  assert.equal(seen.statuses.at(-1), 'connected', 'los dos nombres que expone el SO se prueban');
});

test('el escaneo NO se auto-sella: el filtro NUESTRO no cuenta como "lo que el device anunció"', async () => {
  // EL MUTANTE QUE ESTE TEST MATA: que `recognizes()` le pase al driver `[params.serviceUuid]` —el UUID
  // con el que filtramos el escaneo— como `advertisedServiceUuids`. Todo resultado del escaneo anuncia
  // ese servicio POR DEFINICIÓN, así que cualquier device matchearía por UUID y el chequeo por nombre
  // quedaría decorativo: el bridge de la balanza Vesta (ADR-003, mismos UUID Nordic UART) entraría como
  // bastón y su peso iría al ingesta de EID (RBM5.13).
  //
  // Por eso el driver de este test SÍ reconoce por UUID anunciado (además del nombre): con `TEST_DRIVER`,
  // que matchea SOLO por nombre, el mutante pasaría en verde —el matcher no mira UUIDs y no hay nada que
  // sellar—. El oráculo necesita un driver que pueda ser engañado.
  const porUuid = testDriver({
    deviceMatch: { namePattern: /TEST-GATT/i, advertisedServiceUuids: [NUS_SERVICE] },
  });

  // CONTROL POSITIVO (anti-vacuidad): el camino por UUID del driver está VIVO. Sin esta mitad, el
  // "no conecta" de abajo podría venir de que el matcher por UUID no funciona en absoluto.
  const real = fakeDevice({ id: DEV_ID, name: null, localName: null, serviceUUIDs: [NUS_SERVICE] });
  const mOk = fakeManager({ device: real.device, scanEmits: [real.device] });
  const { env: envOk } = fakeEnv({ manager: mOk.manager });
  const conUuid = new BleGattAdapter(porUuid, envOk);
  const seenOk = track(conUuid);
  await conUuid.connect();
  assert.equal(seenOk.statuses.at(-1), 'connected', 'un device que ANUNCIA el servicio sí se reconoce');

  // EL CASO: el device no expone nombre NI anuncia servicios (el SO no siempre los entrega en el
  // primer anuncio). No hay NADA que el driver pueda reconocer → no se conecta, se sigue escaneando, y
  // el presupuesto vence.
  const anonimo = fakeDevice({ id: OTHER_ID, name: null, localName: null, serviceUUIDs: null });
  const m = fakeManager({ scanEmits: [anonimo.device] });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(porUuid, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    const p = adapter.connect();
    await flush();
    assert.equal(state.timers('scan').length, 1, 'el escaneo SIGUE en curso: un device anónimo no lo cierra');
    state.fire('scan');
    await p;
  });
  assert.equal(m.state.connectCalls.length, 0, 'un device sin nombre y sin UUID anunciado NO es un bastón');
  assert.equal(seen.statuses.at(-1), 'disconnected');
  const noReconocido = logs.find((l) => l.includes('ble_device_not_recognized'));
  assert.ok(noReconocido, 'un device sin nombre y sin UUID anunciado deja rastro de que apareció');
  assert.match(noReconocido, /ble_device_not_recognized: #1 del escaneo/, 'fue el primero de este escaneo');
  // MEDIUM-2 del Gate 2: esta aserción antes exigía LO CONTRARIO (`l.includes(OTHER_ID)`), o sea que el
  // identificador del dispositivo ajeno estuviera en el log. Ahora exige que NO esté: el ordinal alcanza
  // para el diagnóstico y la MAC de un tercero no tiene por qué viajar a un vendor de telemetría.
  assert.equal(
    logs.some((l) => l.includes(OTHER_ID)),
    false,
    'ningún log puede llevar el identificador del dispositivo que no reconocimos',
  );
});

test('RBM2.5: `startDeviceScan` que RECHAZA corta el escaneo enseguida (no espera el presupuesto)', async () => {
  const m = fakeManager({ scanRejects: new Error('BluetoothLE is powered off') });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect();
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.ok(logs.some((l) => l.includes('start_device_scan') && l.includes('powered off')));
  assert.deepEqual(state.timers('scan'), [], 'el presupuesto se cancela al fallar');
  assert.equal(
    logs.some((l) => l.includes('ble_scan_timeout')),
    false,
    'decir "timeout" cuando el escaneo NI ARRANCÓ es un diagnóstico falso',
  );
});

test('un error por el listener del escaneo se loguea y corta (no queda escaneando en silencio)', async () => {
  const m = fakeManager({ scanListenerError: new Error('scan failed') });
  const { env } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect();
  });
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.ok(logs.some((l) => l.includes('ble_scan_error')));
  assert.equal(m.state.stopScanCalls, 1);
});

test('RBM3.2: un escaneo que NO SE ASIENTA NUNCA no puede dejar el latch tomado', async () => {
  // El techo de afuera (`withTimeoutOr('scan_for_target')`) es lo que garantiza que ni un timer que no
  // llega ni un `startDeviceScan` colgado dejen el bastón muerto hasta reiniciar la app.
  const m = fakeManager({ hangScan: true });
  const { env } = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  await adapter.connect();
  assert.equal(seen.statuses.at(-1), 'disconnected');

  // Latch libre: el connect siguiente (con target explícito) funciona.
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'connected');
});

test('un `disconnect()` en medio del escaneo APAGA LA RADIO (no solo cancela el presupuesto)', async () => {
  const m = fakeManager({ hangScan: true });
  const { env, state } = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  void adapter.connect();
  await flush();
  assert.equal(m.state.scanCalls.length, 1);
  assert.equal(state.timers('scan').length, 1);

  await adapter.disconnect();
  assert.equal(m.state.stopScanCalls, 1, 'la radio no puede quedar escaneando tras un disconnect');
  assert.deepEqual(state.timers('scan'), []);
  assert.equal(seen.statuses.at(-1), 'disconnected');
});

test('RBM2.16: con bastón recordado NO se escanea (se conecta derecho al que el operario eligió)', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device });
  const { env } = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, env);
  const seen = track(adapter);
  await adapter.connect();
  assert.equal(m.state.scanCalls.length, 0);
  assert.deepEqual(m.state.connectCalls.map((c) => c.id), [DEV_ID]);
  assert.equal(seen.statuses.at(-1), 'connected');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// F. El stream: notificación → base64 → framer del driver → línea CRUDA (RBM2.7/2.8/2.9/2.12)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.7/RBM2.8: una notificación con la trama completa entrega la LÍNEA CRUDA (con su STX)', async () => {
  const { d, seen } = await connected();
  d.notify(`${RAW_FRAME}\n`);
  assert.equal(seen.tags.length, 1);
  assert.equal(seen.tags[0].charCodeAt(0), 0x02, 'el byte de control llega INTACTO al contrato');
  assert.deepEqual(ingestRawLine(seen.tags[0], TEST_DRIVER.frameParser), { ok: true, eid: EID_982 });
});

test('RBM2.8/RBM2.12: la trama partida en trozos de 20 bytes (MTU por defecto) es UNA lectura', async () => {
  const { d, seen } = await connected();
  const wire = `${RAW_FRAME}\n`;
  const trozos: string[] = [];
  for (let i = 0; i < wire.length; i += BLE_DEFAULT_NOTIFY_PAYLOAD) {
    trozos.push(wire.slice(i, i + BLE_DEFAULT_NOTIFY_PAYLOAD));
  }
  assert.ok(trozos.length >= 2, 'si el fixture no se parte, este test no prueba nada');
  for (const t of trozos) d.notify(t);
  assert.equal(seen.tags.length, 1);
  assert.deepEqual(ingestRawLine(seen.tags[0], TEST_DRIVER.frameParser), { ok: true, eid: EID_982 });
});

test('RBM2.9: dos tramas PEGADAS en una notificación son DOS lecturas', async () => {
  const { d, seen } = await connected();
  const otra = RAW_FRAME.replace(EID_982, '982000364696051');
  d.notify(`${RAW_FRAME}\n${otra}\n`);
  assert.equal(seen.tags.length, 2);
  assert.deepEqual(
    seen.tags.map((t) => parseRs420Line(t)?.eid),
    [EID_982, '982000364696051'],
  );
});

test('una notificación que no se puede decodificar se DESCARTA con log (no es silencio)', async () => {
  const { d, seen } = await connected();
  const logs = await withLogs(async () => {
    d.notifyRaw('no-es-base64!');
    d.notifyRaw(undefined);
    await flush();
  });
  assert.deepEqual(seen.tags, []);
  assert.equal(logs.filter((l) => l.includes('ble_decode_failed')).length, 2);
});

test('el buffer del framer NO se arrastra entre sesiones (una trama a medias no contamina la próxima)', async () => {
  const { adapter, d, m, seen } = await connected();
  d.notify(RAW_FRAME); // media trama, sin terminador
  assert.deepEqual(seen.tags, []);

  // Se cae el link y se reconecta: la trama trunca NO puede pegarse con la primera del link nuevo (es
  // el arrastre que en el SPP hacía perder la primera lectura buena tras corregir el terminador).
  d.emitDisconnected();
  await flush();
  await adapter.connect(DEV_ID);
  assert.equal(m.device, d.device, 'el link nuevo es sobre el MISMO device del fake (si no, no hay arrastre posible)');
  // El fake NO remueve sus listeners al hacer `remove()`, así que la notificación llega también al
  // listener de la sesión vieja: que salga UNA sola lectura es además la prueba de que el guard de
  // sesión lo dejó sordo.
  d.notify(`${RAW_FRAME}\n`);
  assert.equal(seen.tags.length, 1);
  assert.deepEqual(parseRs420Line(seen.tags[0]), { eid: EID_982 });
});

test('R10.5: `disable()` corta la ESCUCHA sin desconectar; `enable()` la reanuda', async () => {
  const { adapter, d, seen } = await connected();
  adapter.disable();
  d.notify(`${RAW_FRAME}\n`);
  assert.deepEqual(seen.tags, []);
  assert.equal(seen.statuses.at(-1), 'connected', 'disable NO desconecta el transporte físico');
  adapter.enable();
  d.notify(`${RAW_FRAME}\n`);
  assert.equal(seen.tags.length, 1);
});

test('RBM2.19: un chorro sostenido SIN fin de trama se descarta con log y el transporte SIGUE leyendo', async () => {
  // HIGH-1 del Gate 2, del lado del transporte. `line-framer.test.ts` prueba el TOPE; esto prueba que el
  // adapter lo tiene CABLEADO y que el descarte sale por el log del transporte en vez de morirse adentro
  // del framer. El disparador realista no es un atacante: es un lector con otro fin de trama —el
  // `term cr` que ya se pagó en el SPP— y en BLE no hay framing nativo, así que el framer de JS es lo
  // ÚNICO que corta.
  const { d, seen } = await connected();
  const logs = await withLogs(async () => {
    // 300 notificaciones de 20 bytes = 6 KB sin un solo terminador (el tope está en 4 KB).
    for (let i = 0; i < 300; i += 1) d.notify('9'.repeat(BLE_DEFAULT_NOTIFY_PAYLOAD));
    await flush();
  });
  assert.ok(
    logs.some((l) => l.includes('ble_framer_overflow')),
    'el descarte del framer tiene que llegar al log del transporte: sin eso el operario bastonea, no pasa nada, y no queda rastro',
  );
  assert.deepEqual(seen.tags, [], 'nada de ese chorro se ingiere: nunca cerró una trama');
  assert.equal(seen.statuses.at(-1), 'connected', 'el descarte NO desconecta (manual-first intacto, R7.2)');

  // Y el transporte sigue leyendo. La cola del pedazo descartado cierra primero y se TIRA (le falta el
  // principio: entregarla sería ingerir una trama recortada, RBM1.8); la trama entera que llega detrás sí
  // se lee, sin que nadie tenga que reconectar el bastón.
  d.notify('999999999999999\n');
  d.notify(`${RAW_FRAME}\n`);
  assert.equal(seen.tags.length, 1, 'fail-closed no es fail-dead');
  assert.deepEqual(ingestRawLine(seen.tags[0], TEST_DRIVER.frameParser), { ok: true, eid: EID_982 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// G. Desconexión: SOLO la del propio device (RBM3.4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.4: la suscripción de desconexión es POR DEVICE — el listener GLOBAL no se usa nunca', async () => {
  const { d, m } = await connected();
  assert.equal(d.state.disconnectListeners.length, 1, 'se suscribe al evento DEL DEVICE');
  assert.equal(
    m.state.globalDisconnectSubs,
    0,
    'el listener global de la lib (`manager.onDeviceDisconnected`) NO se usa: en el SPP, ese evento lo ' +
      'dispara CUALQUIER device y unos auriculares apagándose le cerraban el socket al bastón',
  );
});

test('RBM3.4: la desconexión de OTRO device no afecta al bastón', async () => {
  const { d, seen, e } = await connected();
  d.emitDisconnected(OTHER_ID);
  await flush();
  assert.equal(seen.statuses.at(-1), 'connected', 'sigue conectado');
  assert.deepEqual(e.state.timers('reconnect'), [], 'y no arranca ninguna reconexión');
  assert.equal(d.state.cancelCalls, 0);
});

test('la desconexión del PROPIO device corta, avisa y programa la reconexión', async () => {
  const { d, seen, e } = await connected();
  const logs = await withLogs(async () => {
    d.emitDisconnected(DEV_ID, new Error('device disconnected'));
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'));
  assert.equal(e.state.timers('reconnect').length, 1);
  assert.ok(logs.some((l) => l.includes('ble_disconnected')));
});

test('un evento de desconexión SIN id legible se acepta (mejor un teardown de más que un "conectado" falso)', async () => {
  const { d, seen } = await connected();
  d.emitDisconnected('', null);
  await flush();
  assert.ok(seen.statuses.includes('disconnected'));
});

test('el monitor que MUERE se trata como pérdida del stream (conectado y SORDO es el peor estado)', async () => {
  // La lib remueve la suscripción cuando su promesa se asienta, así que después de un error del monitor
  // NO van a llegar más notificaciones: el link quedaría "conectado" y estructuralmente sordo — el
  // operario bastonea y no pasa nada, sin un solo indicio.
  const { d, seen, e } = await connected();
  const logs = await withLogs(async () => {
    d.emitMonitorError(new Error('gatt fail'));
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'));
  assert.equal(e.state.timers('reconnect').length, 1);
  assert.ok(logs.some((l) => l.includes('ble_monitor_lost')));
});

test('NUESTRO PROPIO teardown dispara el error del monitor (cancelTransaction) y eso NO reconecta', async () => {
  // Trampa real de esta lib: `subscription.remove()` → `cancelTransaction` → la promesa del monitor
  // RECHAZA → nuestra callback se llama con error. Si el handler de error reconectara sin mirar la
  // sesión, un `disconnect()` del operario terminaría RECONECTANDO el bastón que acababa de apagar.
  const { adapter, d, seen, e } = await connected();
  await adapter.disconnect();
  await flush();
  assert.ok(d.state.removedSubs >= 1, 'el teardown removió las suscripciones (y eso disparó el error)');
  assert.equal(seen.statuses.at(-1), 'disconnected');
  assert.deepEqual(e.state.timers('reconnect'), [], 'un disconnect explícito NO reconecta');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// H. Liveness: segunda fuente de verdad, fail-closed (RBM3.5 / BENCH-1)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.5: al volver a FOREGROUND con el link muerto, la app deja de decir "conectado"', async () => {
  const { m, seen, e } = await connected();
  m.state.linkAlive = false; // el link se cayó con la app minimizada: el evento se perdió
  const logs = await withLogs(async () => {
    e.state.resumeForeground();
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'));
  assert.ok(logs.some((l) => l.includes('liveness_lost') && l.includes('foreground')));
  assert.deepEqual(m.state.isConnectedCalls, [DEV_ID], 'se sonda con el id EXACTO con el que se conectó');
  assert.equal(e.state.timers('reconnect').length, 1);
});

test('RBM3.5: el POLL periódico detecta el link muerto sin depender de ningún evento', async () => {
  const { m, seen, e } = await connected({
    envOpts: { timeouts: { call: 0, prompt: 0, connect: 0, scan: 0, livenessPoll: 15_000, silence: 45_000 } },
  });
  assert.equal(e.state.timers('watchdog').length, 1);
  m.state.linkAlive = false;
  const logs = await withLogs(async () => {
    e.state.fire('watchdog');
    await flush();
  });
  assert.ok(logs.some((l) => l.includes('liveness_lost') && l.includes('poll')));
  assert.ok(seen.statuses.includes('disconnected'));
});

test('RBM3.5: la sonda que RECHAZA se lee como "no estamos conectados" (fail-closed)', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, livenessRejects: new Error('BluetoothLE is powered off') });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  await adapter.connect(DEV_ID);
  const logs = await withLogs(async () => {
    e.state.resumeForeground();
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'), 'ante duda NO se sigue afirmando "conectado"');
  assert.ok(logs.some((l) => l.includes('liveness_lost') && l.includes('powered off')));
});

test('RBM3.5: la sonda que NO RESUELVE NUNCA vence y también cae del lado cerrado', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, hangLiveness: true });
  const e = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  await adapter.connect(DEV_ID);
  await withLogs(async () => {
    e.state.resumeForeground();
    await wait(20);
  });
  assert.ok(seen.statuses.includes('disconnected'));
});

test('sin sonda de liveness (lib vieja) se DICE una vez, no se finge que está cubierto', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, omitLivenessProbe: true });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'connected');
  assert.equal(logs.filter((l) => l.includes('liveness_probe_unavailable')).length, 1);
  // Y el retorno a foreground no puede tirar sin sonda.
  e.state.resumeForeground();
  await flush();
  assert.equal(seen.statuses.at(-1), 'connected');
});

test('la sonda con el link VIVO no molesta (no hay teardown ni reconexión espuria)', async () => {
  const { seen, e, d } = await connected();
  e.state.resumeForeground();
  await flush();
  assert.equal(seen.statuses.at(-1), 'connected');
  assert.equal(d.state.cancelCalls, 0);
  assert.deepEqual(e.state.timers('reconnect'), []);
});

test('RBM3.10: conectado y MUDO queda escrito (`connected_silent`) y NO se desconecta', async () => {
  const { seen, e } = await connected({
    // El reloj arranca en un instante REAL (no en 0): así el `ms` del log es la medición del intervalo y
    // no el valor absoluto del reloj, que a t=0 son indistinguibles (ver `CLOCK_START`).
    envOpts: {
      clock: CLOCK_START,
      timeouts: { call: 0, prompt: 0, connect: 0, scan: 0, livenessPoll: 15_000, silence: 45_000 },
    },
  });
  e.state.advance(60_000); // un rato tranquilo en la manga: nadie bastoneó
  const logs = await withLogs(async () => {
    e.state.fire('watchdog');
    await flush();
  });
  const silent = logs.find((l) => l.includes('connected_silent'));
  assert.ok(silent, 'el silencio tiene que dejar rastro: es lo único que distingue mudo de sordo');
  assert.equal(
    (JSON.parse(silent) as { ms: number }).ms,
    60_000,
    'el `ms` es CUÁNTO estuvo mudo (un valor absoluto del reloj acá no significa nada)',
  );
  assert.equal(seen.statuses.at(-1), 'connected', 'el silencio NO desconecta: es normal si nadie bastonea');
  assert.equal(e.state.timers('watchdog').length, 1, 'el watchdog se re-arma');
});

test('HIGH-1 del Gate 2: los bytes que NO cierran trama dejan de esconderse detrás del reloj de salud', async () => {
  // EL MUTANTE QUE ESTE TEST MATA: mover el reloj de salud con CADA CHUNK (lo que hacía el `lastDataAt`
  // de antes). Con eso, el peor estado del transporte —conectado, con el lector hablando y NINGUNA trama
  // cerrando: el terminador equivocado, o un peer inundando la característica— dejaba el watchdog en
  // verde PERMANENTE y no salía UNA SOLA LÍNEA de log. No es que la defensa no actuara (ya sabíamos que
  // solo loguea): es que ni loguaba, mientras el buffer del framer crecía por debajo.
  const { seen, e, d } = await connected({
    envOpts: {
      clock: CLOCK_START,
      timeouts: { call: 0, prompt: 0, connect: 0, scan: 0, livenessPoll: 15_000, silence: 45_000 },
    },
  });
  const logs = await withLogs(async () => {
    // Un minuto de "el bastón habla y no cierra trama" (200 bytes en total: MUY por debajo del tope del
    // framer, así que lo único que puede delatarlo es el reloj de salud, no el descarte).
    for (let i = 0; i < 10; i += 1) {
      e.state.advance(6_000);
      d.notify('9'.repeat(BLE_DEFAULT_NOTIFY_PAYLOAD));
    }
    e.state.fire('watchdog');
    await flush();
  });
  const unframed = logs.find((l) => l.includes('ble_stream_unframed'));
  assert.ok(unframed, `el estado tiene que quedar ESCRITO: ${logs.join(' | ')}`);
  assert.match(unframed, /bytes hace 0 ms/, 'los bytes SÍ estaban llegando (por eso no es mudez)');
  assert.match(
    unframed,
    /sin cerrar trama hace 60000 ms/,
    'y hace un minuto que no cierra una trama: la firma exacta del terminador equivocado',
  );
  assert.equal(
    logs.some((l) => l.includes('connected_silent')),
    false,
    'NO es `connected_silent`: ese evento significa que no llega un byte (RBM3.10), y acá llegan',
  );
  assert.equal(
    logs.some((l) => l.includes('ble_framer_overflow')),
    false,
    'a 200 bytes el tope NO tiene que haber disparado: si disparara, este test mediría otra cosa',
  );
  assert.deepEqual(seen.tags, [], 'y no se ingirió nada: nunca hubo una línea');
  assert.equal(seen.statuses.at(-1), 'connected', 'el diagnóstico no desconecta (RBM3.10)');
});

test('una trama que quedó A MEDIAS hace rato NO convierte la mudez en "entra basura"', async () => {
  // EL MUTANTE QUE ESTE TEST MATA: discriminar con `bytesMs < silentMs` en vez de con la VENTANA de
  // silencio. Parecen equivalentes y no lo son: un pedazo de trama que quedó a medias en un momento
  // benigno (el operario sacó el bastón de rango a mitad de un bastonazo) deja el reloj del byte un
  // poquito por delante del de la trama PARA SIEMPRE, y con la comparación entre relojes el link mudo
  // se reportaría "con bytes que no cierran trama" en todos los polls siguientes — un diagnóstico
  // falso, que es peor que no tener ninguno.
  const { e, d } = await connected({
    envOpts: {
      clock: CLOCK_START,
      timeouts: { call: 0, prompt: 0, connect: 0, scan: 0, livenessPoll: 15_000, silence: 45_000 },
    },
  });
  e.state.advance(5_000);
  d.notify(RAW_FRAME); // media trama: llegó sin su fin de trama y ahí quedó
  e.state.advance(60_000); // y después, silencio de verdad: nadie bastonea
  const logs = await withLogs(async () => {
    e.state.fire('watchdog');
    await flush();
  });
  assert.ok(
    logs.some((l) => l.includes('connected_silent')),
    `el link está MUDO y así tiene que decirlo: ${logs.join(' | ')}`,
  );
  assert.equal(
    logs.some((l) => l.includes('ble_stream_unframed')),
    false,
    'no entró un byte en toda la ventana de silencio: llamarlo "entra basura" sería inventar una causa',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// I. Backoff: dwell, foreground al DISPARAR, y el tope de la cadena sin gesto (RBM3.1/3.6/3.9)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.9: un FLAP no resetea el backoff (el dwell exige que el link haya DURADO)', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device });
  // Reloj en un instante REAL: el dwell es un INTERVALO (`now - connectedAt`), y a t=0 medir el intervalo
  // y leer el reloj absoluto dan lo mismo — con el reloj en 0 este test no puede ver la diferencia.
  const e = fakeEnv({ manager: m.manager, clock: CLOCK_START });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  track(adapter);
  await adapter.connect(DEV_ID);

  const delays: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    e.state.advance(200); // el link vivió 200 ms: NO cuenta como sano
    d.emitDisconnected();
    await flush();
    const timer = e.state.timers('reconnect')[0];
    assert.ok(timer, `ciclo ${i}: tiene que haber reintento`);
    delays.push(timer.ms);
    timer.fn(); // dispara el reintento → reconecta
    await flush();
  }
  assert.deepEqual(delays, [backoffDelayMs(0), backoffDelayMs(1), backoffDelayMs(2)], 'el backoff CRECE');
});

test('RBM3.9: un link que DURÓ resetea el backoff al piso', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device });
  const e = fakeEnv({ manager: m.manager, clock: CLOCK_START });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  track(adapter);
  await adapter.connect(DEV_ID);

  // Primer flap: sube a attempt 1.
  e.state.advance(100);
  d.emitDisconnected();
  await flush();
  e.state.timers('reconnect')[0].fn();
  await flush();

  // Ahora el link dura de verdad.
  e.state.advance(LINK_DWELL_MS + 1);
  d.emitDisconnected();
  await flush();
  assert.equal(e.state.timers('reconnect')[0].ms, backoffDelayMs(0), 'un corte único reconecta al piso');
});

test('RBM3.6: el foreground se verifica AL DISPARAR el timer, no solo al programarlo', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  track(adapter);
  await adapter.connect(DEV_ID);
  d.emitDisconnected();
  await flush();
  const timer = e.state.timers('reconnect')[0];
  assert.ok(timer);

  // Entre ARMAR y DISPARAR, la app se fue a background (el teléfono al bolsillo).
  e.state.foreground = false;
  const antes = m.state.connectCalls.length;
  timer.fn();
  await flush();
  assert.equal(m.state.connectCalls.length, antes, 'no se conecta desde background (R6.9/RBM2.15)');

  // Y no se abandona: al volver a primer plano, reintenta.
  e.state.resumeForeground();
  await flush();
  assert.ok(e.state.timers('reconnect').length >= 1);
});

test('RBM3.1: la cadena que NADIE pidió tiene tope: al agotarse queda en `off`, con su log', async () => {
  const m = fakeManager({ connectRejects: new Error('device not found') });
  const e = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);

  await adapter.autoConnect();
  assert.ok(e.state.timers('reconnect').length >= 1);
  const intentos = m.state.connectCalls.length;

  // El presupuesto se vence DURANTE el delay del backoff, que es el caso normal (el tope son 120 s y el
  // backoff topea en 8 s por vuelta).
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
  const logs = await withLogs(async () => {
    e.state.fire('reconnect');
    await flush();
  });
  assert.equal(seen.statuses.at(-1), 'off', '`off` = no conectado y sin estar intentando (con CTA)');
  assert.equal(adapter.autoConnectExhausted, true);
  assert.ok(logs.some((l) => l.includes('autoconnect_exhausted')));
  assert.deepEqual(e.state.timers('reconnect'), [], 'la cadena MURIÓ: no queda nada martillando');
  // ⚪-4 del review de F3: el tope se chequea DOS veces (la cabecera de `scheduleReconnect` y adentro del
  // timer), y borrar la copia del TIMER dejaba las 136 en verde — porque el desenlace observado seguía
  // siendo `off`, al que se llegaba por la cabecera DESPUÉS de un intento más. Sin esta aserción esa copia
  // es un cinturón sin oráculo; con ella, el tope no se puede correr un intento (que en device es la radio
  // martillando ~10 s más por cada apertura de la app).
  assert.equal(
    m.state.connectCalls.length,
    intentos,
    'con el presupuesto ya vencido el timer NO puede intentar una vez más: eso corre el tope',
  );
});

test('RBM3.1: una cadena con el presupuesto VENCIDO muere aunque la app esté en BACKGROUND', async () => {
  // ESTE TEST EXISTE PORQUE UN MUTANTE SOBREVIVIÓ (MB3.1 de la tabla del informe de F3). El chequeo del
  // presupuesto está DOS veces —una en la cabecera de `scheduleReconnect` y otra adentro del timer— y
  // borrar la de la CABECERA dejaba las 133 pruebas en verde: todos los caminos que había pasaban por el
  // timer. Lo que la cabecera cubre y el timer no: llegar a programar un reintento con la cadena YA
  // vencida y la app en background. Sin ella el orden se invierte (primero el gate de foreground), la
  // cadena se PARQUEA esperando el retorno a primer plano en vez de morir, y el tope pasa a ser evitable
  // guardando el teléfono en el bolsillo — o sea, el tope de RBM3.1 dejaría de existir justo en el caso
  // que lo motivó ("ese bastón lo vendí / quedó en otro campo" + el teléfono en el bolsillo).
  const m = fakeManager({ connectRejects: new Error('device not found') });
  const e = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);

  await adapter.autoConnect(); // cadena CON tope (nadie la pidió) → falla → reintento armado
  assert.ok(e.state.timers('reconnect').length >= 1, 'el fixture necesita un reintento armado');

  // El intento siguiente TARDA (en producción son hasta 20 s por connect, y la cadena topea a los 120 s)
  // y el operario guarda el teléfono MIENTRAS corre: el presupuesto se vence y la app queda en
  // background ANTES de que se programe el reintento que viene.
  (m.manager as { connectToDevice: BleManagerLike['connectToDevice'] }).connectToDevice = (id) => {
    m.state.connectCalls.push({ id });
    e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
    e.state.foreground = false;
    return Promise.reject(new Error('device not found'));
  };
  const logs = await withLogs(async () => {
    e.state.fire('reconnect');
    await flush();
  });

  assert.equal(seen.statuses.at(-1), 'off', 'la cadena vencida MUERE (con CTA), no se parquea');
  assert.equal(adapter.autoConnectExhausted, true);
  assert.ok(logs.some((l) => l.includes('autoconnect_exhausted')));
  assert.deepEqual(e.state.timers('reconnect'), [], 'no queda ningún reintento pendiente');
  assert.equal(
    e.state.foregroundListeners.length,
    0,
    'y NADIE queda esperando el foreground para volver a martillar: eso sería el tope evitable',
  );
});

test('RBM3.1: el tope de la cadena automática NO acota los primeros 2 minutos de vida de la app', async () => {
  // 🔴-A del review del SPP: el presupuesto tiene que MORIR al conectar. Sin eso, el operario abría la
  // app, se conectaba solo, trabajaba 10 minutos, el bastón se iba de rango un segundo → CERO reintentos
  // por el resto de la sesión.
  const d = fakeDevice();
  const m = fakeManager({ device: d.device });
  const e = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  await adapter.autoConnect();
  assert.equal(seen.statuses.at(-1), 'connected');

  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS * 5); // media jornada de trabajo
  d.emitDisconnected();
  await flush();
  assert.equal(e.state.timers('reconnect').length, 1, 'sigue reintentando: la cadena vieja ya había TERMINADO');
  assert.notEqual(seen.statuses.at(-1), 'off');
});

test('RBM3.1: un tap del operario DESTOPA la cadena que se había agotado', async () => {
  const m = fakeManager({ connectRejects: new Error('device not found') });
  const e = fakeEnv({ manager: m.manager, remembered: DEV_ID });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  await adapter.autoConnect();
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
  e.state.fire('reconnect');
  await flush();
  assert.equal(seen.statuses.at(-1), 'off');

  // El operario toca "Volver a conectar": cadena del operario, SIN tope y desde el piso del backoff.
  await adapter.connect();
  assert.equal(adapter.autoConnectExhausted, false);
  const timer = e.state.timers('reconnect')[0];
  assert.ok(timer);
  assert.equal(timer.ms, backoffDelayMs(0));
  e.state.advance(UNPROMPTED_RETRY_BUDGET_MS * 10);
  e.state.fire('reconnect');
  await flush();
  assert.notEqual(seen.statuses.at(-1), 'off', 'la cadena del operario no se agota por tiempo');
});

test('RBM3.1/RBM3.7: un tap con el intento EN VUELO también DESTOPA la cadena (no solo si ya murió)', async () => {
  // 🟡-2 del review de F3: `adapter-ble-gatt.ts:651` —el `applyChainPolicy(trigger)` de la rama "hay un
  // intento en vuelo"— se podía borrar con las 136 pruebas en verde. `RBM3.1: un tap del operario DESTOPA
  // la cadena que se había agotado` cubre el caso en que la cadena YA TERMINÓ (`off`), no el de un intento
  // en curso, que es la puerta por la que entra el mismo síntoma:
  //
  //   el operario abre la app (cadena del arranque, capada a 120 s), el bastón tarda, toca "Volver a
  //   conectar" a los 90 s → sin esa línea el tap NO destopa nada: la cadena muere igual al vencerse el
  //   presupuesto de la cadena que él NO pidió, y su gesto queda sin ningún efecto observable.
  //
  // El oráculo es la diferencia entre las dos mitades de este test, así que no puede pasar por vacuidad:
  // el mismo escenario SIN el tap tiene que morir en `off`.
  const conTap = async (tap: boolean) => {
    const d = fakeDevice({ discoverRejects: new Error('gatt status 133') });
    const m = fakeManager({ device: d.device, gateConnect: true });
    const e = fakeEnv({ manager: m.manager, remembered: DEV_ID });
    const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
    const seen = track(adapter);
    const logs = await withLogs(async () => {
      const auto = adapter.autoConnect(); // cadena CON tope: nadie la pidió
      await flush();
      assert.equal(m.state.connectCalls.length, 1, 'el intento del arranque tiene que estar EN VUELO');
      assert.equal(seen.statuses.at(-1), 'connecting');

      if (tap) {
        await adapter.connect(DEV_ID); // el tap del operario, con el intento en curso
        assert.equal(m.state.connectCalls.length, 1, 'el tap NO abre un segundo link al mismo device');
      }

      // El intento tarda (en producción hasta 20 s por connect) y mientras corre se vence el tope de la
      // cadena del ARRANQUE. Después falla, que es cuando se decide si la cadena sigue o muere.
      e.state.advance(UNPROMPTED_RETRY_BUDGET_MS + 1);
      m.state.releaseConnect();
      await auto;
      await flush();
    });
    return { adapter, e, seen, logs };
  };

  // (1) CON el tap: la cadena es del operario → sin tope → sigue reintentando.
  const tapeado = await conTap(true);
  assert.ok(tapeado.logs.some((l) => l.includes('connect_reasserted')), 'el tap deja log');
  assert.notEqual(tapeado.seen.statuses.at(-1), 'off', 'el gesto del operario no puede quedar sin efecto');
  assert.equal(tapeado.adapter.autoConnectExhausted, false);
  assert.equal(tapeado.e.state.timers('reconnect').length, 1, 'la cadena del operario SIGUE viva');
  assert.equal(
    tapeado.logs.some((l) => l.includes('autoconnect_exhausted')),
    false,
    'el tope que se agota es el de la cadena que NADIE pidió, y esta ya no es esa',
  );

  // (2) CONTROL: el mismo escenario SIN el tap muere en `off` — o sea, el presupuesto SÍ se venció y lo
  // único que cambia el desenlace es el gesto.
  const solo = await conTap(false);
  assert.equal(solo.seen.statuses.at(-1), 'off', 'sin tap la cadena del arranque muere: el tope existe');
  assert.equal(solo.adapter.autoConnectExhausted, true);
  assert.ok(solo.logs.some((l) => l.includes('autoconnect_exhausted')));
});

test('el `autoConnect` sin bastón recordado NO toca la radio (arranque en frío)', async () => {
  const m = fakeManager();
  const e = fakeEnv({ manager: m.manager, remembered: null });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.deepEqual(seen.statuses, []);
  assert.equal(m.state.stateCalls, 0);
  assert.equal(m.state.scanCalls.length, 0, 'un arranque en frío NO escanea (sería el diálogo que nadie pidió)');
  assert.equal(e.state.permissionChecks, 0, 'ni consulta permisos: la lectura local va primero');
  assert.ok(logs.some((l) => l.includes('no_remembered')));
});

test('el `autoConnect` en BACKGROUND no arranca', async () => {
  const m = fakeManager();
  const e = fakeEnv({ manager: m.manager, remembered: DEV_ID, foreground: false });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  track(adapter);
  const logs = await withLogs(async () => {
    await adapter.autoConnect();
  });
  assert.equal(m.state.connectCalls.length, 0);
  assert.ok(logs.some((l) => l.includes('autoconnect_skipped') && l.includes('background')));
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// J. El latch, la generación de intento y el connect a OTRO bastón (RBM3.2/RBM3.7)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM3.7: un segundo connect al MISMO target no duplica el intento, pero deja log', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, gateConnect: true });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  track(adapter);
  const logs = await withLogs(async () => {
    const first = adapter.connect(DEV_ID);
    await flush();
    await adapter.connect(DEV_ID); // el operario toca de nuevo
    m.state.releaseConnect();
    await first;
  });
  assert.equal(m.state.connectCalls.length, 1, 'no se abren dos links al mismo device');
  assert.ok(logs.some((l) => l.includes('connect_reasserted')));
});

test('RBM3.7: un connect a OTRO bastón durante un intento se ENCOLA y se atiende (no se descarta)', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, gateConnect: true });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  track(adapter);
  const logs = await withLogs(async () => {
    const first = adapter.connect(DEV_ID);
    await flush();
    await adapter.connect(OTHER_ID); // "no, era el otro bastón"
    m.state.releaseConnect();
    await first;
    await flush();
  });
  assert.ok(logs.some((l) => l.includes('connect_superseded') && l.includes(OTHER_ID)));
  assert.deepEqual(
    m.state.connectCalls.map((c) => c.id),
    [DEV_ID, OTHER_ID],
    'el bastón que el operario tocó DESPUÉS se atiende al terminar el intento vigente',
  );
});

test('RBM3.2: el connect que NO RESUELVE NUNCA vence, deja bridge_timeout con SU label y libera el latch', async () => {
  const m = fakeManager({ hangConnect: true });
  const e = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  const timeout = logs.find((l) => l.includes('bridge_timeout'));
  assert.ok(timeout);
  assert.match(timeout, /"label":"connect_to_device"/);
  assert.equal(timeout.includes('connect_path'), false, 'el label del tramo NO puede tapar al del await');
  assert.equal(
    (JSON.parse(timeout) as { ms: number }).ms,
    FAST_TIMEOUTS.connect,
    'el connect se acota con el presupuesto DEL CONNECT (abandonarlo con el de una llamada corta el link que Android estaba por abrir)',
  );
  assert.ok(seen.statuses.includes('disconnected'));
  assert.equal(e.state.timers('reconnect').length, 1, 'una falla de conexión sí reintenta');
});

test('RBM3.2: `disconnect()` libera el latch aunque el intento siga colgado', async () => {
  const m = fakeManager({ hangConnect: true });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  void adapter.connect(DEV_ID); // no resuelve nunca
  await flush();
  assert.equal(m.state.connectCalls.length, 1);

  await adapter.disconnect();
  const sano = fakeManager();
  (e.env as { loadManager: () => BleManagerLike }).loadManager = () => sano.manager;
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'connected', 'el bastón no queda muerto hasta reiniciar la app');
});

test('un `disconnect()` mientras se abría el link CIERRA el link que llega tarde', async () => {
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, gateConnect: true });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const p = adapter.connect(DEV_ID);
  await flush();
  await adapter.disconnect();
  m.state.releaseConnect();
  await p;
  await flush();
  assert.ok(d.state.cancelCalls >= 1, 'el link abierto a espaldas del operario se cierra');
  assert.equal(seen.statuses.at(-1), 'disconnected');
});

test('un intento VIEJO que despierta no le cierra el link al intento NUEVO (`orphan_socket_kept`)', async () => {
  // `cancelConnection()` cierra la conexión de ESE DEVICE, no "la que abrió este intento": un intento
  // vencido que resuelve tarde le mataría el link al que conectó después, y la app quedaría diciendo
  // "conectado" sobre un link muerto (el mismo síntoma que BENCH-1, producido por la limpieza).
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, hangConnect: true });
  const e = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);

  const logs = await withLogs(async () => {
    // Intento 1: se cuelga y vence. Su promesa resuelve DESPUÉS, ya con el intento 2 dueño del device.
    // El resolver vive en un HOLDER y no en un `let`: TS narra un `let` asignado dentro de un callback a
    // su valor inicial (`null` → `never` al invocarlo), y este archivo NO pasa por el typecheck del repo
    // (`app/tsconfig.json` excluye los tests), así que el error solo aparecía corriendo tsc a mano.
    const late: { resolve: ((dev: BleDeviceLike) => void) | null } = { resolve: null };
    (m.manager as { connectToDevice: BleManagerLike['connectToDevice'] }).connectToDevice = (id) => {
      m.state.connectCalls.push({ id });
      return new Promise<BleDeviceLike>((res) => {
        late.resolve = res;
      });
    };
    await adapter.connect(DEV_ID); // vence a los 5 ms
    // Intento 2, sano.
    const sano = fakeManager({ device: d.device });
    (e.env as { loadManager: () => BleManagerLike }).loadManager = () => sano.manager;
    await adapter.connect(DEV_ID);
    assert.equal(seen.statuses.at(-1), 'connected');
    // Ahora resuelve el viejo.
    assert.ok(late.resolve, 'el intento 1 tiene que haber quedado colgado (si no, no hay nada tarde)');
    late.resolve(d.device);
    await flush();
  });
  assert.ok(logs.some((l) => l.includes('orphan_socket_kept')));
  assert.equal(seen.statuses.at(-1), 'connected', 'el link vigente sobrevive al intento viejo');
});

test('el descubrimiento de servicios que se cuelga vence y cae en backoff (no queda a medio armar)', async () => {
  const d = fakeDevice({ hangDiscover: true });
  const m = fakeManager({ device: d.device });
  const e = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(seen.statuses.at(-1), 'scanning', 'el backoff quedó armado tras el disconnected');
  assert.equal(d.state.monitorListeners.length, 0, 'no se suscribe a notificaciones sin descubrir servicios');
  assert.ok(logs.some((l) => l.includes('discover_services')));
  assert.equal(e.state.timers('reconnect').length, 1);
});

test('el descubrimiento que RECHAZA se loguea como error del nativo, NO como vencimiento', async () => {
  // Los dos kinds existen a propósito y son la diferencia entre "el nativo contestó un error" (mirar el
  // error) y "el nativo NO contestó" (mirar el puente). Un solo kind los volvía indistinguibles en
  // logcat, que es justo cuando hay que decidir si el problema es el lector o el teléfono.
  const d = fakeDevice({ discoverRejects: new Error('device disconnected') });
  const m = fakeManager({ device: d.device });
  const e = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(DEV_ID);
  });
  assert.equal(d.state.monitorListeners.length, 0, 'sin servicios descubiertos no se suscribe a nada');
  assert.ok(seen.statuses.includes('disconnected'));
  assert.ok(
    logs.some((l) => l.includes('connect_error') && l.includes('device disconnected')),
    'el error REAL del nativo tiene que aparecer en el log',
  );
  assert.equal(
    logs.some((l) => l.includes('bridge_timeout')),
    false,
    'decir "timeout" cuando el nativo SÍ contestó (con un error) es un diagnóstico falso',
  );
  assert.equal(e.state.timers('reconnect').length, 1, 'una falla de conexión reintenta');
});

test('un `stopDeviceScan` que NO VUELVE no cuelga el camino de conexión (best-effort acotado)', async () => {
  // La radio puede quedar escaneando si el nativo no contesta —eso se loguea— pero lo que NO puede pasar
  // es que el camino de conexión se quede esperándolo: `finish()` no awaitea el stop, y encima tiene su
  // propio techo. Sin esto, un `stopDeviceScan` colgado dejaría el latch tomado (🔴-1 por otra puerta).
  const d = fakeDevice();
  const m = fakeManager({ device: d.device, scanEmits: [d.device], hangStopScan: true });
  const e = fakeEnv({ manager: m.manager, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(); // sin target: escanea, encuentra, y al conectar intenta detener el escaneo
    await wait(20); // deja vencer el techo del stop (y que su log salga)
  });
  assert.equal(seen.statuses.at(-1), 'connected', 'el link se abre igual: el stop es best-effort');
  assert.equal(m.state.stopScanCalls, 1);
  assert.ok(
    logs.some((l) => l.includes('bridge_timeout') && l.includes('stop_device_scan')),
    'que la radio pueda haber quedado escaneando se DICE (es batería en la manga)',
  );
  // Y el latch quedó libre: el connect siguiente funciona.
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'connected');
});

test('RBM2.16: el device conectado se PERSISTE (y el recordado se lee con techo)', async () => {
  const { e } = await connected();
  assert.deepEqual(e.state.written, [DEV_ID]);
});

test('RBM3.2: el `readRemembered` colgado vence y no deja el latch tomado', async () => {
  const m = fakeManager();
  const e = fakeEnv({ manager: m.manager, hangRemembered: true, timeouts: FAST_TIMEOUTS });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  const logs = await withLogs(async () => {
    await adapter.connect(); // sin target: tiene que leer el recordado
  });
  assert.ok(logs.some((l) => l.includes('read_remembered')));
  assert.ok(seen.statuses.at(-1) === 'disconnected' || seen.statuses.at(-1) === 'scanning');
  await adapter.connect(DEV_ID);
  assert.equal(seen.statuses.at(-1), 'connected');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// K. Teardown: ni timers ni suscripciones huérfanas
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('el teardown no deja timers ni suscripciones huérfanas', async () => {
  const { adapter, d, e } = await connected({
    envOpts: { timeouts: { call: 0, prompt: 0, connect: 0, scan: 0, livenessPoll: 15_000, silence: 45_000 } },
  });
  assert.equal(e.state.timers('watchdog').length, 1);
  assert.equal(e.state.foregroundListeners.length, 1, 'la sonda de foreground vive mientras hay link');

  await adapter.disconnect();
  assert.deepEqual(e.state.timers('watchdog'), []);
  assert.deepEqual(e.state.timers('reconnect'), []);
  assert.deepEqual(e.state.foregroundListeners, [], 'ninguna suscripción sobrevive al teardown');
  assert.ok(d.state.cancelCalls >= 1);
});

test('reconectar no DUPLICA suscripciones (dos monitores sobre el mismo link = lecturas dobles)', async () => {
  const { adapter, d, seen } = await connected();
  await adapter.connect(DEV_ID); // segundo connect al mismo device
  d.notify(`${RAW_FRAME}\n`);
  assert.equal(seen.tags.length, 1, 'una notificación = UNA lectura, aunque se haya reconectado');
});

test('el `disconnect()` deja el estado en `disconnected` y no emite nada más', async () => {
  const { adapter, seen } = await connected();
  await adapter.disconnect();
  assert.equal(seen.statuses.at(-1), 'disconnected');
});

test('los presupuestos por defecto son los del puente + el del escaneo (y son positivos)', () => {
  assert.equal(DEFAULT_BLE_TIMINGS.scan, 10_000);
  for (const [key, ms] of Object.entries(DEFAULT_BLE_TIMINGS)) {
    assert.ok(ms > 0, `${key} tiene que ser positivo en producción (0 = sin techo, y eso es el 🔴-1)`);
  }
  assert.ok(
    DEFAULT_BLE_TIMINGS.scan < DEFAULT_BLE_TIMINGS.connect * 2,
    'un escaneo no puede durar más que un par de intentos de conexión',
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// L. El identificador del bastón NO viaja en el free-text de un log (§7.2 del Gate 2)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Los mensajes de `react-native-ble-plx` se arman interpolando el id del dispositivo
// (`BleError.js`: 'Device {deviceID} was disconnected', '… connection failed', 'Services discovery
// failed for device {deviceID}'). Con el `errorMessage(e)` que había —`e.message` crudo— eso llegaba
// a los breadcrumbs de Sentry adentro de `message`, que es free-text: ahí el scrubber por claves de
// `observability/redact.ts` no puede llegar aunque tenga la clave. El id de Android es LA MAC.

/** Un `BleError` como lo construye la lib: mensaje YA interpolado + `errorCode`, sin `deviceID` adentro. */
function bleError(errorCode: number, message: string): Error & { errorCode: number } {
  return Object.assign(new Error(message), { errorCode });
}

/** Los `message` (free-text) de los eventos logueados. Los CAMPOS con clave no entran acá a propósito. */
function mensajes(logs: string[]): string[] {
  const out: string[] = [];
  for (const line of logs) {
    const ev = JSON.parse(line) as { message?: unknown };
    if (typeof ev.message === 'string') out.push(ev.message);
  }
  return out;
}

test('§7.2: la desconexión con un `BleError` de la lib NO deja la MAC en el log (y dice qué pasó)', async () => {
  const { d, seen } = await connected();
  const logs = await withLogs(async () => {
    d.emitDisconnected(DEV_ID, bleError(201, `Device ${DEV_ID} was disconnected`));
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'), 'el comportamiento no cambia: sigue cortando');
  const msgs = mensajes(logs);
  assert.ok(msgs.length > 0, 'sin mensajes esto sería un verde vacío');
  assert.deepEqual(
    msgs.filter((m) => m.includes(DEV_ID)),
    [],
    'la MAC del bastón no puede aparecer en el free-text de ningún evento',
  );
  assert.ok(
    msgs.some((m) => m.includes('ble_disconnected') && m.includes('errorCode:201')),
    'y no se pierde diagnóstico: el código mapea 1:1 con la plantilla del mensaje',
  );
});

test('§7.2: el monitor que muere con un `BleError` tampoco filtra el id', async () => {
  const { d, seen } = await connected();
  const logs = await withLogs(async () => {
    d.emitMonitorError(bleError(300, `Services discovery failed for device ${DEV_ID}`));
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'));
  const msgs = mensajes(logs);
  assert.deepEqual(msgs.filter((m) => m.includes(DEV_ID)), []);
  assert.ok(msgs.some((m) => m.includes('ble_monitor_lost') && m.includes('errorCode:300')));
});

test('§7.2: un error SIN código conocido pero CON la MAC adentro se blanquea, y la causa sobrevive', async () => {
  // El camino que la tabla de códigos no cubre: un error cualquiera del puente cuyo texto trae la MAC.
  const d = fakeDevice();
  const m = fakeManager({
    device: d.device,
    livenessRejects: new Error(`gatt server for ${DEV_ID} is gone`),
  });
  const e = fakeEnv({ manager: m.manager });
  const adapter = new BleGattAdapter(TEST_DRIVER, e.env);
  const seen = track(adapter);
  await adapter.connect(DEV_ID);
  const logs = await withLogs(async () => {
    e.state.resumeForeground();
    await flush();
  });
  assert.ok(seen.statuses.includes('disconnected'), 'fail-closed intacto');
  const msgs = mensajes(logs);
  assert.deepEqual(msgs.filter((m2) => m2.includes(DEV_ID)), []);
  assert.ok(
    msgs.some((m2) => m2.includes('gatt server for <device> is gone')),
    'se blanquea el identificador, NO el motivo',
  );
});

test('§7.2 (la CLASE): en un flujo entero, ningún `message` lleva el id — pero el CAMPO sí puede', async () => {
  // El barrido sobre la ausencia: no se listan los tres eventos que hoy interpolan, se exige que NINGUNO
  // lo haga. Un camino de log nuevo que vuelva a interpolar el id cae acá aunque nadie lo agregue a una
  // lista. La distinción que sí importa: `connect_superseded { deviceId }` lo lleva como CAMPO CON CLAVE,
  // y eso es alcanzable por el scrubber key-based de `redact.ts` (`device_id` está en `PII_KEYS_RAW`).
  const logs = await withLogs(async () => {
    // (a) el SO reporta la desconexión con el error de la lib
    const a = fakeDevice();
    const ma = fakeManager({ device: a.device });
    const ea = fakeEnv({ manager: ma.manager, timeouts: FAST_TIMEOUTS });
    const adapterA = new BleGattAdapter(TEST_DRIVER, ea.env);
    await adapterA.connect(DEV_ID);
    a.emitDisconnected(DEV_ID, bleError(204, `Device ${DEV_ID} not found`));
    await flush();

    // (b) el monitor muere
    const b = fakeDevice();
    const mb = fakeManager({ device: b.device });
    const eb = fakeEnv({ manager: mb.manager, timeouts: FAST_TIMEOUTS });
    const adapterB = new BleGattAdapter(TEST_DRIVER, eb.env);
    await adapterB.connect(DEV_ID);
    b.emitMonitorError(bleError(201, `Device ${DEV_ID} was disconnected`));
    await flush();

    // (c) el escaneo falla (otra superficie, otro call site)
    const mc = fakeManager({ scanListenerError: bleError(200, `Device ${OTHER_ID} connection failed`) });
    const ec = fakeEnv({ manager: mc.manager, timeouts: FAST_TIMEOUTS });
    await new BleGattAdapter(TEST_DRIVER, ec.env).connect();
    await flush();
  });
  const msgs = mensajes(logs);
  assert.ok(msgs.length >= 3, `el flujo tiene que dejar mensajes de las tres superficies (dejó ${msgs.length})`);
  assert.deepEqual(
    msgs.filter((m2) => m2.includes(DEV_ID) || m2.includes(OTHER_ID)),
    [],
    'ningún identificador de dispositivo en el free-text de ningún evento del flujo',
  );
});
