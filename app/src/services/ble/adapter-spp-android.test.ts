// Tests del adapter SPP-Android (RMV5). node:test, sin RN, sin RS420.
//
// La pasada anterior dejaba esto en "partes puras, la conexión es device-gated". Eso escondía DOS
// bugs que solo aparecían con el bastón enchufado (framing por línea sobre un stream ya delimitado;
// `pairDevice()` que nunca resuelve sobre un device ya emparejado). Ahora la I/O entra por `SppEnv`,
// así que la MÁQUINA DE ESTADOS completa —permisos, BT apagado, device recordado, stream, corte,
// backoff, foreground— se ejercita acá con dobles. Lo único que sigue siendo device-gated es que un
// RS420 físico emita la trama por el socket (RMV5.9): el resto ya no es fe.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SppAndroidAdapter,
  resolveSppParams,
  isSppNativeAvailable,
  listPairedSppDevices,
  __resetSppModuleStateForTests,
  LINK_DWELL_MS,
  type SppDeviceLike,
  type SppEnv,
  type SppNative,
  type SppSubscription,
  type SppTimerLabel,
} from './adapter-spp-android.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { SPP_UUID } from './config.ts';
import { SPP_DELIMITER } from './spp-protocol.ts';
import { backoffDelayMs } from './line-framer.ts';
import { UNPROMPTED_RETRY_BUDGET_MS } from './connect-trigger.ts';
import type { ConnectionStatus } from './stick-adapter.ts';
import type { ReaderDriver } from './driver-types.ts';

const RAW_LINE = '\x021000000982000364696050260530101701\r';
const EID_982 = '982000364696050';
const MAC = 'AA:BB:CC:DD:EE:FF';
/** Otro device Classic del teléfono (los auriculares del operario) — 🔴-2. */
const OTHER_MAC = '00:11:22:33:44:99';

/** Promesa que NO resuelve NUNCA: el corazón de los tests de 🔴-1. */
function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/** Presupuestos chicos: un await colgado vence en ~1 tick en vez de en 30 s. */
const FAST_TIMEOUTS = { call: 5, prompt: 5, connect: 5, livenessPoll: 0, silence: 0 } as const;

/** Espera real (los timeouts del puente usan `setTimeout` de verdad, no el `schedule` inyectado). */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Dobles de la lib nativa ────────────────────────────────────────────────────────────────

interface FakeNativeOptions {
  bluetoothEnabled?: boolean;
  enableAccepted?: boolean;
  bonded?: unknown[];
  connectRejects?: Error | null;
  omitDisconnectEvents?: boolean;
  /** El `connectToDevice` no resuelve nunca (🔴-1, camino del connect). */
  hangConnect?: boolean;
  /** El `requestBluetoothEnabled` no resuelve nunca (🔴-1, camino del diálogo del SO). */
  hangEnable?: boolean;
  /** El `connectToDevice` espera a que el test lo suelte (`state.releaseConnect()`). */
  gateConnect?: boolean;
  /** La lib no expone `isDeviceConnected` (sin sonda de liveness). */
  omitLivenessProbe?: boolean;
  /** La sonda RECHAZA (el nativo lo hace con `BLUETOOTH_NOT_ENABLED`). */
  livenessRejects?: Error;
  /** El `getBondedDevices` no resuelve nunca (🟠-4). */
  hangBonded?: boolean;
  /** Dirección que reporta el device conectado (default = la que se pidió). */
  deviceAddress?: string;
}

function fakeNative(opts: FakeNativeOptions = {}) {
  let releaseConnect: () => void = () => undefined;
  const connectGate = opts.gateConnect
    ? new Promise<void>((resolve) => {
        releaseConnect = resolve;
      })
    : Promise.resolve();

  const state = {
    bluetoothEnabled: opts.bluetoothEnabled ?? true,
    requestEnabledCalls: 0,
    connectCalls: [] as Array<{ address: string; options?: Record<string, unknown> }>,
    dataListeners: [] as Array<(e: { data?: string }) => void>,
    disconnectListeners: [] as Array<(e: unknown) => void>,
    deviceDisconnectCalls: 0,
    removedSubs: 0,
    /** Lo que el nativo cree del socket (`mConnections.containsKey`): la 2ª fuente de verdad. */
    socketAlive: true,
    isDeviceConnectedCalls: [] as string[],
    bondedCalls: 0,
    releaseConnect: () => releaseConnect(),
  };

  const sub = (): SppSubscription => ({
    remove() {
      state.removedSubs += 1;
    },
  });

  const device: SppDeviceLike = {
    address: opts.deviceAddress ?? MAC,
    onDataReceived(cb) {
      state.dataListeners.push(cb);
      return sub();
    },
    async disconnect() {
      state.deviceDisconnectCalls += 1;
      state.socketAlive = false;
      return true;
    },
  };

  const native: SppNative = {
    async isBluetoothEnabled() {
      return state.bluetoothEnabled;
    },
    requestBluetoothEnabled() {
      state.requestEnabledCalls += 1;
      if (opts.hangEnable) return neverResolves<boolean>();
      if (opts.enableAccepted ?? true) {
        state.bluetoothEnabled = true;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
    getBondedDevices() {
      state.bondedCalls += 1;
      if (opts.hangBonded) return neverResolves<unknown>();
      return Promise.resolve(opts.bonded ?? []);
    },
    connectToDevice(address, options) {
      state.connectCalls.push({ address, options });
      if (opts.hangConnect) return neverResolves<SppDeviceLike>();
      if (opts.connectRejects) return Promise.reject(opts.connectRejects);
      return connectGate.then(() => device);
    },
    ...(opts.omitDisconnectEvents
      ? {}
      : {
          onDeviceDisconnected(cb: (e: unknown) => void) {
            state.disconnectListeners.push(cb);
            return sub();
          },
        }),
    ...(opts.omitLivenessProbe
      ? {}
      : {
          async isDeviceConnected(address: string) {
            state.isDeviceConnectedCalls.push(address);
            if (opts.livenessRejects) throw opts.livenessRejects;
            return state.socketAlive;
          },
        }),
  };

  return { native, state, device };
}

interface FakeEnvOptions {
  native?: SppNative | null;
  /** Resultado de PEDIR el permiso (`ensurePermissions`, camino del gesto). */
  permission?: 'granted' | 'denied' | 'unavailable';
  /**
   * Resultado de CONSULTAR el permiso (`checkPermissions`, camino automático: arranque + reintentos).
   * Default: lo mismo que `permission`, así los tests que no distinguen no tienen que declararlo.
   */
  checkPermission?: 'granted' | 'denied' | 'unavailable';
  remembered?: string | null;
  foreground?: boolean;
  /** Presupuestos del puente. Default: SIN timeout (los tests que no lo ejercitan no lo sufren). */
  timeouts?: Partial<{ call: number; prompt: number; connect: number; livenessPoll: number; silence: number }>;
  /** Reloj falso inicial (avanzable con `state.advance(ms)`). */
  clock?: number;
  /** El `ensurePermissions` no resuelve nunca (🔴-1, camino del permiso de runtime). */
  hangPermissions?: boolean;
}

function fakeEnv(opts: FakeEnvOptions = {}) {
  const state = {
    written: [] as string[],
    scheduled: [] as Array<{ fn: () => void; ms: number; label: SppTimerLabel }>,
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
    /** Timers de RECONEXIÓN pendientes (el watchdog vive en la misma cola y no es lo que se asserta). */
    reconnects() {
      return state.scheduled.filter((e) => e.label === 'reconnect');
    },
    watchdogs() {
      return state.scheduled.filter((e) => e.label === 'watchdog');
    },
    /** Simula el retorno a foreground (dispara TODOS los suscriptos, como AppState). */
    resumeForeground() {
      state.foreground = true;
      for (const cb of [...state.foregroundListeners]) cb();
    },
  };
  const env: SppEnv = {
    loadNative: () => opts.native ?? null,
    ensurePermissions: () => {
      state.permissionCalls += 1;
      if (opts.hangPermissions) return neverResolves<'granted' | 'denied' | 'unavailable'>();
      return Promise.resolve(opts.permission ?? 'granted');
    },
    checkPermissions: () => {
      state.permissionChecks += 1;
      if (opts.hangPermissions) return neverResolves<'granted' | 'denied' | 'unavailable'>();
      return Promise.resolve(opts.checkPermission ?? opts.permission ?? 'granted');
    },
    readRemembered: async () => {
      state.rememberedReads += 1;
      return opts.remembered ?? null;
    },
    writeRemembered: async (id: string) => {
      state.written.push(id);
    },
    isForeground: () => state.foreground,
    schedule: (fn: () => void, ms: number, label: SppTimerLabel) => {
      // Un timer que YA DISPARÓ deja de estar pendiente (igual que `setTimeout` real). Sin esto, un
      // test que dispara el timer a mano vería el mismo entry "pendiente" para siempre y no podría
      // distinguir "se re-armó" de "quedó el viejo".
      const entry: { fn: () => void; ms: number; label: SppTimerLabel } = {
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
    // Sin timeouts por defecto: los tests que ejercitan el vencimiento pasan `FAST_TIMEOUTS`.
    timeouts: opts.timeouts ?? { call: 0, prompt: 0, connect: 0, livenessPoll: 0, silence: 0 },
  };
  return { env, state };
}

/**
 * Deja correr los `await` internos de `connect()`. El reintento programado se dispara con
 * `void this.connect(...)` (no se puede awaitear desde afuera: es el timer del adapter), así que
 * después de invocar un timer hay que soltar el event loop antes de asertar el estado siguiente.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function track(adapter: SppAndroidAdapter) {
  const statuses: ConnectionStatus[] = [];
  const tags: string[] = [];
  adapter.onStatus((s) => statuses.push(s));
  adapter.onTagRead((t) => tags.push(t));
  return { statuses, tags };
}

// ─── RMV5.2: el adapter toma sppUuid/pin del DRIVER (no hardcodeados) ───────────────────────

test('RMV5.2: resolveSppParams(RS420) → { sppUuid: SPP_UUID, pin: "1234", delimiter: "\\n" }', () => {
  assert.deepEqual(resolveSppParams(RS420_DRIVER), {
    sppUuid: SPP_UUID,
    pin: '1234',
    delimiter: SPP_DELIMITER,
  });
});

test('RMV5.2: otro driver SPP se soporta cambiando el driver, no el adapter (params del driver)', () => {
  const OTHER: ReaderDriver = {
    ...RS420_DRIVER,
    vendorId: 'other-spp',
    transports: [
      { kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '0000', delimiter: '\r' } },
    ],
  };
  assert.deepEqual(resolveSppParams(OTHER), {
    sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb',
    pin: '0000',
    delimiter: '\r',
  });
});

test('🟠-5: un driver sin `delimiter` cae al del RS420 (el default es un supuesto del LECTOR)', () => {
  const NO_DELIM: ReaderDriver = {
    ...RS420_DRIVER,
    transports: [{ kind: 'spp', params: { sppUuid: SPP_UUID } }],
  };
  assert.equal(resolveSppParams(NO_DELIM)?.delimiter, SPP_DELIMITER);
});

test('RBM1.3/RBM1.5: el adapter EXPONE su driver (default RS420) para que el contrato lea su frameParser', () => {
  // T1.4 del delta ios-ble-mfi. Es lo que hace que `resolveFrameParser(transport, …)` devuelva el
  // parser del RS420 en vez de `null`: sin esto, el modo 'raw-line' del SPP caería en el fail-closed
  // (RBM1.4) y el bastón que HOY lee en device quedaría mudo. Se verifica la IDENTIDAD del driver.
  assert.equal(new SppAndroidAdapter().driver, RS420_DRIVER);
  const OTRO: ReaderDriver = { ...RS420_DRIVER, vendorId: 'otro-spp' };
  assert.equal(new SppAndroidAdapter(OTRO).driver, OTRO);
});

test('RMV5.2: un driver sin transporte SPP → resolveSppParams null', () => {
  const NO_SPP: ReaderDriver = { ...RS420_DRIVER, transports: [{ kind: 'serial', params: { baud: 9600 } }] };
  assert.equal(resolveSppParams(NO_SPP), null);
});

test('RMV5.2: un driver con OTRO UUID RFCOMM NO se conecta (la lib solo abre el SPP estándar)', async () => {
  const OTHER: ReaderDriver = {
    ...RS420_DRIVER,
    transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb' } }],
  };
  const { native, state } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(OTHER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(state.connectCalls.length, 0, 'no se abre el socket con un UUID que la lib no soporta');
});

// ─── RMV5.5: reuso del backoff incremental del core ─────────────────────────────────────────

test('RMV5.5: el adapter reusa backoffDelayMs del core (crece y se topea)', () => {
  assert.equal(backoffDelayMs(0), 500);
  assert.equal(backoffDelayMs(4), 8000);
  assert.equal(backoffDelayMs(10), 8000);
});

// ─── RMV5.6: import perezoso — importar el módulo NO tira sin la lib nativa ──────────────────

test('RMV5.6: import("./adapter-spp-android") NO tira en node/CI sin react-native-bluetooth-classic', async () => {
  await assert.doesNotReject(async () => {
    const mod = await import('./adapter-spp-android.ts');
    assert.equal(typeof mod.SppAndroidAdapter, 'function');
    assert.equal(typeof mod.resolveSppParams, 'function');
  });
});

test('RMV5.6/R7: sin lib nativa, connect() no tira, refleja "disconnected" y NO reintenta', async () => {
  const { env, state } = fakeEnv({ native: null });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  assert.equal(adapter.kind, 'spp-android');
  const { statuses } = track(adapter);
  await assert.doesNotReject(() => adapter.connect(MAC));
  assert.equal(statuses.at(-1), 'disconnected');
  // Sin módulo nativo el resultado sería idéntico para siempre: un backoff acá es un loop inútil.
  assert.equal(state.scheduled.length, 0);
});

test('RMV5.6: isSppNativeAvailable() es false fuera de Android / sin RN (no tira)', () => {
  assert.equal(isSppNativeAvailable(), false);
});

test('enable/disable no tiran y disconnect es idempotente sin conexión', async () => {
  const adapter = new SppAndroidAdapter();
  adapter.enable();
  adapter.disable();
  await assert.doesNotReject(() => adapter.disconnect());
  await assert.doesNotReject(() => adapter.disconnect());
});

// ─── R12.1/R12.5: permisos ──────────────────────────────────────────────────────────────────

test('R12.1: permiso denegado → estado "permission_denied" (con CTA), SIN abrir el socket ni reintentar', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, permission: 'denied' });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'permission_denied');
  assert.equal(nativeState.connectCalls.length, 0);
  // Sin backoff: reintentar solo le vuelve a tirar el diálogo del SO al operario.
  assert.equal(state.scheduled.length, 0);
});

test('R12.5: permiso no disponible (sin RN) → disconnected, nunca una excepción', async () => {
  const { native } = fakeNative();
  const { env } = fakeEnv({ native, permission: 'unavailable' });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await assert.doesNotReject(() => adapter.connect(MAC));
  assert.equal(statuses.at(-1), 'disconnected');
});

// ─── Bluetooth apagado ──────────────────────────────────────────────────────────────────────

test('BT apagado + el operario acepta prenderlo → sigue y conecta', async () => {
  const { native, state: nativeState } = fakeNative({ bluetoothEnabled: false, enableAccepted: true });
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(nativeState.requestEnabledCalls, 1);
  assert.equal(statuses.at(-1), 'connected');
});

test('BT apagado + el operario dice que no → disconnected, sin socket y SIN loop de reintentos', async () => {
  const { native, state: nativeState } = fakeNative({ bluetoothEnabled: false, enableAccepted: false });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(nativeState.connectCalls.length, 0);
  assert.equal(state.scheduled.length, 0, 'reintentar le vuelve a tirar el diálogo del sistema en la cara');
});

// ─── RMV5.4: device recordado ───────────────────────────────────────────────────────────────

test('RMV5.4: sin deviceId se usa el recordado; al conectar se persiste el elegido', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  await adapter.connect();
  assert.equal(nativeState.connectCalls[0]?.address, MAC);
  assert.deepEqual(state.written, [MAC]);
});

test('RMV5.4: sin deviceId ni recordado → disconnected sin tocar el nativo', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native, remembered: null });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect();
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(nativeState.connectCalls.length, 0);
});

test('el deviceId explícito gana sobre el recordado (elegir otro bastón de la lista)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: 'AA:AA:AA:AA:AA:AA' });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  await adapter.connect(MAC);
  assert.equal(nativeState.connectCalls[0]?.address, MAC);
  assert.deepEqual(state.written, [MAC]);
});

// ─── RMV5.3: el stream real → línea cruda al contrato ───────────────────────────────────────

test('RMV5.3: cada payload delimitado del nativo llega CRUDO al contrato y parsea al EID', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'connected');

  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, [RAW_LINE]);
  assert.deepEqual(RS420_DRIVER.frameParser.parse(tags[0]), { eid: EID_982 });
});

test('RMV5.3 (regresión del bug de framing): el adapter emite CON un payload sin \\n', async () => {
  // El adapter viejo pasaba `event.data` por LineFramer (corta por `\n`): con el payload real
  // —que el nativo entrega SIN `\n`— no emitía nunca. Este test lo habría cazado sin hardware.
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { tags } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(RAW_LINE.includes('\n'), false);
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.equal(tags.length, 1);
});

test('R10.5: disable() suspende la ESCUCHA sin desconectar; enable() la reanuda', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { tags } = track(adapter);
  await adapter.connect(MAC);

  adapter.disable();
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, []);
  assert.equal(nativeState.deviceDisconnectCalls, 0, 'disable NO desconecta el transporte físico');

  adapter.enable();
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.equal(tags.length, 1);
});

test('un payload basura no emite nada ni tira', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { tags } = track(adapter);
  await adapter.connect(MAC);
  assert.doesNotThrow(() => {
    nativeState.dataListeners.forEach((cb) => cb({ data: undefined }));
    nativeState.dataListeners.forEach((cb) => cb({} as { data?: string }));
    nativeState.dataListeners.forEach((cb) => cb({ data: '\r\n' }));
  });
  assert.deepEqual(tags, []);
});

// ─── Pairing: NUNCA se llama pairDevice (colgaba sobre un device ya emparejado) ──────────────

test('RMV5.4 (regresión): connect() NO llama pairDevice — createBond() sobre un emparejado nunca resuelve', async () => {
  const { native } = fakeNative();
  let pairCalls = 0;
  const withPair = {
    ...native,
    pairDevice: async () => {
      pairCalls += 1;
      return new Promise<never>(() => undefined); // exactamente lo que hace el nativo: no resuelve
    },
  } as unknown as SppNative;
  const { env } = fakeEnv({ native: withPair });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(pairCalls, 0);
  assert.equal(statuses.at(-1), 'connected', 'el estado NO se queda clavado en "connecting"');
});

// ─── Desconexión + reconexión con backoff (RMV5.5) ──────────────────────────────────────────

test('RMV5.5: falla de conexión → disconnected + reintento programado con el backoff del core', async () => {
  const { native } = fakeNative({ connectRejects: new Error('socket closed') });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.deepEqual(statuses, ['connecting', 'disconnected', 'scanning']);
  assert.equal(state.scheduled.length, 1);
  assert.equal(state.scheduled[0].ms, backoffDelayMs(0));
});

test('RMV5.5: el backoff CRECE entre reintentos sucesivos', async () => {
  const { native, state: nativeState } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  const first = state.scheduled.shift();
  assert.equal(first?.ms, backoffDelayMs(0));
  first?.fn(); // dispara el reintento (que vuelve a fallar)
  await flush();
  assert.equal(state.scheduled[0]?.ms, backoffDelayMs(1));
  // Y el reintento va al MISMO device, no a "el recordado" (que en el primer emparejamiento no
  // existe todavía): sin esto la cadena de reintentos moría después del primer fallo.
  assert.deepEqual(nativeState.connectCalls.map((c) => c.address), [MAC, MAC]);
});

test('el bastón se apaga (evento del SO) → disconnected + reintento', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'connected');

  nativeState.disconnectListeners.forEach((cb) => cb({ device: { address: MAC } }));
  assert.equal(statuses.includes('disconnected'), true);
  assert.equal(state.scheduled.length, 1, 'reintenta solo cuando el bastón vuelve a rango');
});

test('🟡-3: una conexión que DURÓ resetea el backoff (el próximo corte no arranca en 8s)', async () => {
  // Toda la cadena de acá corre por el TIMER (`retry`), nunca por un `connect()`: así lo que resetea el
  // contador es el DWELL y nada más. Si el segundo tramo se disparara con un tap, el reset lo haría la
  // cadena nueva y el test no probaría el dwell (ver la nota del test del flap).
  const failing = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native: failing.native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  state.reconnects()[0]?.fn(); // reintento 1: vuelve a fallar
  await flush();
  assert.equal(state.reconnects()[0]?.ms, backoffDelayMs(1), 'el backoff creció');

  // Ahora el nativo conecta bien: el reintento SIGUIENTE establece el link…
  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  state.reconnects()[0]?.fn();
  await flush();
  // … y el link VIVE más que el dwell → al caerse, el contador vuelve al piso.
  state.advance(LINK_DWELL_MS);
  good.state.disconnectListeners.forEach((cb) => cb({ device: { address: MAC } }));
  assert.equal(state.reconnects()[0]?.ms, backoffDelayMs(0));
});

test('🟡-3: un link que NO dura no resetea el backoff (flap: el delay crece entre ciclos)', async () => {
  // El as-built anterior reseteaba `reconnectAttempt` apenas resolvía `connectToDevice`, así que
  // `flap 4 3000` daba `attempt:0` las CUATRO veces (medido en device, banco §4.3): connect → drop
  // → 500 ms → connect, indefinido, con la radio martillando. El README del emulador esperaba
  // "backoff creciente" y el as-built lo desmentía; ahora el dwell lo hace cierto.
  //
  // OJO CON EL MODELO: los reconnects del flap los dispara el TIMER (trigger `retry`), no un tap. Una
  // versión anterior de este test llamaba `adapter.connect(MAC)` en cada ciclo como atajo, y eso dejó
  // de ser equivalente cuando el tope de la cadena entró en escena: un `connect()` es un GESTO, y un
  // gesto arranca una cadena NUEVA (backoff desde el piso, sin tope). Con el atajo, el test medía
  // 500/500/500 y parecía una regresión del dwell. Ahora modela el flap real.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  const delays: number[] = [];

  await adapter.connect(MAC); // el operario conecta UNA vez
  for (let cycle = 0; cycle < 3; cycle++) {
    state.advance(4_000); // el link vive 4 s: MENOS que el dwell → no cuenta como sano
    nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });
    const pending = state.reconnects()[0];
    assert.ok(pending, `ciclo ${cycle}: tiene que haber un reintento programado`);
    delays.push(pending.ms);
    pending.fn(); // el TIMER reconecta (trigger 'retry': hereda la cadena)
    await flush();
  }

  assert.deepEqual(delays, [backoffDelayMs(0), backoffDelayMs(1), backoffDelayMs(2)]);
});

test('RMV5.5: en background NO se reintenta, pero queda ARMADO para el retorno a foreground', async () => {
  const { native } = fakeNative({ connectRejects: new Error('fuera de rango') });
  const { env, state } = fakeEnv({ native, foreground: false });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  // Nada programado (foreground-only, RMV5.5) …
  assert.equal(state.scheduled.length, 0);
  // … pero SÍ hay un listener esperando: el código anterior hacía `return` y no re-armaba nada,
  // así que minimizar la app en el momento del reintento la dejaba desconectada para siempre.
  assert.equal(state.foregroundListeners.length, 1);

  state.foreground = true;
  state.foregroundListeners.forEach((cb) => cb());
  assert.equal(state.scheduled.length, 1);
  assert.equal(state.foregroundListeners.length, 0, 'el listener de foreground se da de baja');
});

test('un connect() nuevo CANCELA el reintento pendiente (si no, el corte siguiente se queda sin reconexión)', async () => {
  const failing = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native: failing.native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  assert.equal(state.scheduled.length, 1, 'quedó un reintento pendiente');

  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(MAC); // el operario toca "Volver a conectar" antes de que salte el timer
  assert.equal(state.scheduled.length, 0, 'el timer viejo no puede reconectar sobre una conexión viva');
});

test('disconnect() cancela el reintento programado y libera el listener de foreground', async () => {
  const { native } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(state.scheduled.length, 1);
  await adapter.disconnect();
  assert.equal(state.scheduled.length, 0);
  assert.equal(state.foregroundListeners.length, 0);
  assert.equal(statuses.at(-1), 'disconnected');
});

test('disconnect() cierra el socket y da de baja las suscripciones', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { tags } = track(adapter);
  await adapter.connect(MAC);
  await adapter.disconnect();
  assert.equal(nativeState.deviceDisconnectCalls, 1);
  assert.equal(nativeState.removedSubs, 2, 'se remueven la de datos y la de desconexión');
  // Aun si el nativo emitiera una lectura tardía, ya no hay a quién entregársela.
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, []);
});

test('elegir OTRO bastón estando conectado cierra el anterior (sin doble onDataReceived)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { tags } = track(adapter);
  await adapter.connect(MAC);
  await adapter.connect('AA:BB:CC:DD:EE:11');
  assert.equal(nativeState.deviceDisconnectCalls, 1, 'se cerró la conexión anterior');
  // Solo la suscripción VIVA emite: si quedaran las dos, cada lectura entraría duplicada (y la
  // ventana de dedup lo taparía, que es peor que verlo).
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.equal(tags.length, 1);
});

test('disconnect() DURANTE el connect (antes de abrir el socket) aborta el intento entero', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);
  const connecting = adapter.connect(MAC);
  await adapter.disconnect(); // el operario toca "Desconectar" mientras se abre el socket
  await connecting;
  assert.equal(statuses.at(-1), 'disconnected');
  // El intento viejo despierta, ve que ya no es la generación vigente y se va: ni siquiera llega a
  // pedirle el socket al nativo.
  assert.equal(nativeState.connectCalls.length, 0);
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, [], 'no queda ninguna suscripción viva');
});

test('disconnect() con el socket YA abriéndose: el device que llega tarde se CIERRA', async () => {
  // El caso que de verdad importa: el `connectToDevice` está en vuelo (bloquea segundos con el
  // bastón apagado) y el operario toca "Desconectar". Si no se cerrara, quedaría una conexión
  // abierta a espaldas de la app — y encima la sonda de liveness la vería "viva".
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);
  const connecting = adapter.connect(MAC);
  await flush(); // deja que el intento llegue a colgarse DENTRO de connectToDevice
  assert.equal(nativeState.connectCalls.length, 1, 'el socket ya se estaba abriendo');

  await adapter.disconnect();
  nativeState.releaseConnect(); // el nativo resuelve DESPUÉS del disconnect
  await connecting;

  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(nativeState.deviceDisconnectCalls, 1, 'el socket que llegó tarde se cerró');
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, [], 'no queda ninguna suscripción viva');
});

test('dos connect() concurrentes no abren dos sockets (evita ALREADY_CONNECTING del nativo)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await Promise.all([adapter.connect(MAC), adapter.connect(MAC)]);
  assert.equal(nativeState.connectCalls.length, 1);
});

test('un nativo SIN onDeviceDisconnected no rompe la conexión (capacidad opcional)', async () => {
  const { native } = fakeNative({ omitDisconnectEvents: true });
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await assert.doesNotReject(() => adapter.connect(MAC));
  assert.equal(statuses.at(-1), 'connected');
});

// ─── RMV3.2: lista de emparejados ───────────────────────────────────────────────────────────

test('RMV3.2: listPairedSppDevices devuelve los emparejados normalizados', async () => {
  const { native } = fakeNative({
    bonded: [
      { address: 'AA:BB:CC:DD:EE:01', name: 'RS 420' },
      { address: 'AA:BB:CC:DD:EE:02', name: 'Auriculares' },
    ],
  });
  const { env } = fakeEnv({ native });
  const result = await listPairedSppDevices(env);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.devices.map((d) => d.name), ['Auriculares', 'RS 420']);
});

test('RMV3.2: sin módulo nativo → { ok:false, unavailable } (nunca tira)', async () => {
  const { env } = fakeEnv({ native: null });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'unavailable' });
});

test('RMV3.2: permiso denegado → { ok:false, permission_denied } sin llamar al nativo', async () => {
  const { native, state: nativeState } = fakeNative({ bonded: [{ address: MAC }] });
  const { env } = fakeEnv({ native, permission: 'denied' });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'permission_denied' });
  assert.equal(nativeState.requestEnabledCalls, 0);
});

test('RMV3.2: BT apagado y el operario no lo prende → { ok:false, bluetooth_off }', async () => {
  const { native } = fakeNative({ bluetoothEnabled: false, enableAccepted: false });
  const { env } = fakeEnv({ native });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'bluetooth_off' });
});

test('RMV3.2: si el nativo tira, se degrada a { ok:false, error } (manual-first, R7)', async () => {
  const { native } = fakeNative();
  const boom: SppNative = {
    ...native,
    getBondedDevices: async () => {
      throw new Error('SecurityException');
    },
  };
  const { env } = fakeEnv({ native: boom });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'error' });
});

test('RMV3.2: teléfono sin ningún emparejado → ok con lista vacía (la UI lo distingue de un error)', async () => {
  const { native } = fakeNative({ bonded: [] });
  const { env } = fakeEnv({ native });
  const result = await listPairedSppDevices(env);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.devices, []);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// BLOQUEANTES CERRADOS EL 2026-07-30 (review adversarial de `dad711f` + banco contra el ESP32)
//
// Cada test de esta sección asserta un DEFECTO CONFIRMADO, no una hipótesis: el reviewer los probó
// con un probe adversarial propio (7/7) y el banco reprodujo tres de ellos en el A07 real.
// ═══════════════════════════════════════════════════════════════════════════════════════════

// ─── 🔴-1 · Ningún await del puente puede dejar el latch tomado ─────────────────────────────

test('🔴-1: un connectToDevice que NO RESUELVE vence, y el connect() siguiente SÍ llega al nativo', async () => {
  // Antes: `connectInFlight` quedaba en true PARA SIEMPRE y todo connect posterior —del operario,
  // del chip, del timer— era un no-op mudo hasta matar la app (el adapter se construye una sola vez
  // por vida del proceso).
  const hanging = fakeNative({ hangConnect: true });
  const { env, state } = fakeEnv({ native: hanging.native, timeouts: FAST_TIMEOUTS });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.connect(MAC);
  assert.equal(hanging.state.connectCalls.length, 1);
  assert.equal(statuses.at(-1), 'scanning', 'venció y cayó a la cadena de reintentos');
  assert.equal(state.reconnects().length, 1);

  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(MAC);
  assert.equal(good.state.connectCalls.length, 1, 'el latch se liberó: el nativo recibe la llamada');
  assert.equal(statuses.at(-1), 'connected');
});

test('🔴-1: un requestBluetoothEnabled que NO RESUELVE vence (el diálogo del SO no toma rehenes)', async () => {
  // Repro exacto del banco §4.2: BT apagado → la app pide activarlo → el operario lo prende desde
  // el PANEL RÁPIDO en vez de contestar el diálogo → `onActivityResult` no llega nunca → 2 min 40 s
  // sin un solo evento, con el bastón disponible.
  const hanging = fakeNative({ bluetoothEnabled: false, hangEnable: true });
  const { env } = fakeEnv({ native: hanging.native, timeouts: FAST_TIMEOUTS });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.connect(MAC);
  assert.equal(hanging.state.requestEnabledCalls, 1);
  assert.equal(hanging.state.connectCalls.length, 0);
  assert.equal(statuses.at(-1), 'disconnected', 'estado con CTA, no "Conectando…" eterno');

  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(MAC);
  assert.equal(good.state.connectCalls.length, 1, 'el latch se liberó');
});

test('🔴-1: un ensurePermissions que NO RESUELVE vence y no deja el latch tomado', async () => {
  const { native } = fakeNative();
  const { env, state } = fakeEnv({ native, hangPermissions: true, timeouts: FAST_TIMEOUTS });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'disconnected');
  await adapter.connect(MAC);
  assert.equal(state.permissionCalls, 2, 'el segundo connect entró de verdad al camino');
});

test('🔴-1: el log de vencimiento nombra el await QUE se perdió, no el tramo que lo atrapó', async () => {
  // Es el diagnóstico del que depende toda la observabilidad de este fix: en logcat hay que poder
  // separar "el nativo contestó un error" de "el nativo NO contestó", y saber CUÁL no contestó. El
  // `catch` que recibe el error está varias líneas más abajo y cubre más de una llamada, así que si
  // ganara su label el log diría el tramo en vez del await.
  const hanging = fakeNative({ hangConnect: true });
  const { env } = fakeEnv({ native: hanging.native, timeouts: FAST_TIMEOUTS });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  const lines: string[] = [];
  const original = console.info;
  // eslint-disable-next-line no-console
  console.info = (...args: unknown[]) => {
    if (args[0] === '[ble]') lines.push(String(args[2]));
  };
  try {
    await adapter.connect(MAC);
  } finally {
    // eslint-disable-next-line no-console
    console.info = original;
  }

  const timeout = lines.find((l) => l.includes('bridge_timeout'));
  assert.ok(timeout, 'tiene que haber un bridge_timeout');
  assert.match(timeout, /"label":"connect_to_device"/);
  assert.equal(timeout.includes('connect_path'), false, 'el label del tramo NO puede tapar al del await');
});

test('🔴-1 (b): disconnect() LIBERA el latch aunque el intento siga colgado, sin abrir dos sockets', async () => {
  // Sin timeout a propósito: se prueba que el latch no depende de que la promesa vencida se asiente.
  const hanging = fakeNative({ hangConnect: true });
  const { env } = fakeEnv({ native: hanging.native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  void adapter.connect(MAC); // no resuelve nunca
  await flush();
  assert.equal(hanging.state.connectCalls.length, 1);

  await adapter.disconnect();
  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(MAC);
  assert.equal(good.state.connectCalls.length, 1, 'el connect posterior llega al nativo');
});

test('🔴-1 (b): un intento invalidado por disconnect+connect NO pisa la conexión nueva', async () => {
  // El riesgo de liberar el latch en `disconnect()` es abrir la ventana de DOS intentos pisándose: el
  // viejo despierta de su await, se cree vigente y sobreescribe `this.device`/`this.dataSub` de la
  // conexión nueva → socket huérfano abierto y lecturas que nadie lee. Lo cierra la GENERACIÓN de
  // intento, y esto es lo que lo prueba (sin esto, el test de arriba pasa igual: una promesa que no
  // resuelve nunca no puede pisar nada).
  const stale = fakeNative({ gateConnect: true });
  const { env } = fakeEnv({ native: stale.native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);

  const first = adapter.connect(MAC);
  await flush(); // el intento viejo queda colgado DENTRO de connectToDevice
  await adapter.disconnect();

  // El operario vuelve a conectar: el latch está libre, así que este intento SÍ arranca.
  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'connected');

  // Y AHORA el nativo del intento viejo resuelve.
  stale.state.releaseConnect();
  await first;

  assert.equal(statuses.at(-1), 'connected', 'el intento viejo no cambió el estado');
  // Y NO le cierra el socket al que conectó (MEDIUM-1 del Gate 2): `device.disconnect()` de la lib
  // cierra el socket de ESA DIRECCIÓN (`disconnectFromDevice(this.address)`), no el de este intento —
  // y el nativo, si la dirección ya está conectada, devuelve la conexión EXISTENTE. O sea que en el
  // teléfono el "socket viejo" y el nuevo son EL MISMO, y cerrarlo dejaría la app diciendo "conectado"
  // sobre un socket muerto: el síntoma de BENCH-1, producido por la limpieza que vino a evitar un
  // socket fantasma. (Los dos dobles de este test son devices independientes, que es justo lo que hacía
  // que la versión anterior de esta aserción pareciera correcta.)
  assert.equal(stale.state.deviceDisconnectCalls, 0, 'el intento viejo NO toca la dirección ajena');
  // La suscripción viva es la de la conexión NUEVA, y es UNA sola.
  good.state.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, [RAW_LINE]);
  // El device viejo no dejó ninguna suscripción escuchando.
  stale.state.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.equal(tags.length, 1, 'el device viejo no quedó suscripto');
});

test('MEDIUM-1: el socket que llega tarde sí se cierra si el operario DESCONECTÓ (no hay dueño nuevo)', async () => {
  // La contracara del test de arriba: la generación también avanza por un `disconnect()`, y ahí el
  // operario NO quiere nada en esa dirección → cerrar es lo correcto. Las dos razones por las que la
  // generación avanza tienen respuestas opuestas, y `canCloseOrphanSocket` es la que las separa.
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  const connecting = adapter.connect(MAC);
  await flush();
  await adapter.disconnect(); // y NO se vuelve a conectar
  nativeState.releaseConnect();
  await connecting;

  assert.equal(nativeState.deviceDisconnectCalls, 1, 'sin dueño nuevo, el socket huérfano se cierra');
});

// ─── 🔴-2 · El evento de desconexión del SO es GLOBAL: hay que filtrarlo por dirección ───────

test('🔴-2: la desconexión de OTRO device Classic NO mata la conexión del bastón', async () => {
  // El evento lo dispara `ActionACLReceiver`, un BroadcastReceiver de `ACTION_ACL_DISCONNECTED`
  // de TODOS los devices del teléfono. Escenario de campo: el operario apaga los auriculares, o se
  // baja de la camioneta con el manos libres pareado.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'connected');

  nativeState.disconnectListeners.forEach((cb) => cb({ device: { address: OTHER_MAC } }));

  assert.equal(statuses.at(-1), 'connected', 'la conexión del bastón SOBREVIVE');
  assert.equal(nativeState.deviceDisconnectCalls, 0, 'no se cerró el socket');
  assert.equal(state.reconnects().length, 0, 'no se disparó el backoff');
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, [RAW_LINE], 'y sigue ingiriendo lecturas');
});

test('🔴-2: la desconexión de NUESTRA dirección sí desconecta (comparación case-insensitive)', async () => {
  // El SO devuelve las MAC en minúscula y nosotros las guardamos como vinieron de la lista.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);

  nativeState.disconnectListeners.forEach((cb) => cb({ device: { address: MAC.toLowerCase() } }));

  assert.equal(statuses.includes('disconnected'), true);
  assert.equal(state.reconnects().length, 1);
});

test('🔴-2: un evento SIN dirección legible se acepta (la señal que teníamos, documentada)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);

  nativeState.disconnectListeners.forEach((cb) => cb({}));

  assert.equal(statuses.includes('disconnected'), true);
  assert.equal(state.reconnects().length, 1);
});

// ─── 🔴 BENCH-1 · "Bastón conectado" mentiroso: liveness al volver a foreground ──────────────

test('BENCH-1: corte con la app minimizada + vuelta a foreground → la sonda lo reconcilia', async () => {
  // Reproducción del hallazgo 3/3 del banco: el link se cae con la app en background, el evento del
  // SO se pierde (el nativo lo descarta si no hay Catalyst instance activa) y al volver la pantalla
  // seguía diciendo "Bastón conectado — la lectura entra sola", indefinidamente y con el socket
  // muerto. Acá el evento NO se emite a propósito: eso es lo que pasó en el device.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'connected');

  state.foreground = false; // HOME
  nativeState.socketAlive = false; // el bastón se apagó mientras tanto; NADIE nos avisó
  assert.equal(statuses.at(-1), 'connected', 'sin la sonda, la app seguiría creyendo esto');

  state.resumeForeground();
  await flush();

  assert.deepEqual(nativeState.isDeviceConnectedCalls, [MAC], 'se sondeó al volver');
  assert.equal(statuses.at(-1), 'scanning', 'se reconcilió y arrancó la reconexión');
  assert.equal(state.reconnects().length, 1);
});

test('BENCH-1: volver a foreground con el socket VIVO no toca nada (sin teardown gratuito)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);
  await adapter.connect(MAC);

  state.foreground = false;
  state.resumeForeground();
  await flush();

  assert.equal(statuses.at(-1), 'connected');
  assert.equal(nativeState.deviceDisconnectCalls, 0);
  assert.equal(state.reconnects().length, 0);
  nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE }));
  assert.deepEqual(tags, [RAW_LINE]);
});

test('BENCH-1: si la sonda RECHAZA (BT apagado) se falla CERRADO — no se sigue prometiendo conexión', async () => {
  const { native } = fakeNative({ livenessRejects: new Error('BLUETOOTH_NOT_ENABLED') });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);

  state.foreground = false;
  state.resumeForeground();
  await flush();

  assert.equal(statuses.at(-1), 'scanning');
});

test('BENCH-1: una lib SIN isDeviceConnected no rompe (se queda como estaba, y el log lo dice)', async () => {
  const { native, state: nativeState } = fakeNative({ omitLivenessProbe: true });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);

  state.foreground = false;
  state.resumeForeground();
  await flush();

  assert.equal(statuses.at(-1), 'connected');
  assert.equal(nativeState.deviceDisconnectCalls, 0);
});

test('BENCH-1: la sonda de foreground se da de baja al desconectar (no queda escuchando de por vida)', async () => {
  const { native } = fakeNative();
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  assert.equal(state.foregroundListeners.length, 1, 'armada mientras hay link');
  await adapter.disconnect();
  assert.equal(state.foregroundListeners.length, 0);
});

// ─── BENCH-1 + 🟠-5 · El watchdog: sonda PERIÓDICA de liveness + registro de la mudez ────────

const POLLING = { livenessPoll: 1_000, silence: 3_000 } as const;

/** Captura los `kind` que pasan por `logTransportEvent` mientras corre `fn`. */
async function captureLogKinds(fn: () => Promise<void>): Promise<string[]> {
  const kinds: string[] = [];
  const original = console.info;
  // eslint-disable-next-line no-console
  console.info = (...args: unknown[]) => {
    if (args[0] === '[ble]') kinds.push(String(args[1]));
  };
  try {
    await fn();
  } finally {
    // eslint-disable-next-line no-console
    console.info = original;
  }
  return kinds;
}

test('BENCH-1: la sonda de liveness es PERIÓDICA — no depende de ningún evento ni de AppState', async () => {
  // Es la parte que de verdad acota el "Bastón conectado" mentiroso: aunque el evento del SO se
  // pierda Y la app nunca cambie de estado (corte con la pantalla abierta, o el retorno a foreground
  // llegando unos ms antes de que el lado Java se entere), el poll lo caza dentro de una ventana
  // conocida.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, timeouts: POLLING });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);

  const watchdog = state.watchdogs()[0];
  assert.ok(watchdog, 'el watchdog se arma al conectar');
  assert.equal(watchdog.ms, 1_000);

  watchdog.fn();
  await flush();
  assert.deepEqual(nativeState.isDeviceConnectedCalls, [MAC], 'sondea aunque no haya pasado nada');
  assert.equal(statuses.at(-1), 'connected', 'vivo → no toca nada');
  assert.equal(state.watchdogs().length, 1, 'y se re-arma');

  // Ahora el link se muere sin que nadie avise: ni evento, ni cambio de foreground.
  nativeState.socketAlive = false;
  state.watchdogs()[0]?.fn();
  await flush();
  assert.equal(statuses.at(-1), 'scanning');
  assert.equal(state.reconnects().length, 1);
});

test('🟠-5: conectado sin un byte hace N s → queda ESCRITO (pero el silencio no desconecta)', async () => {
  // El silencio NO prueba que el link esté muerto (el operario puede no estar bastoneando): no
  // dispara ninguna acción. Deja rastro, que es lo que permite distinguir en logcat las tres causas
  // que hoy dan el mismo síntoma (terminador equivocado / lector dormido / socket muerto).
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, timeouts: POLLING });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  const kinds = await captureLogKinds(async () => {
    await adapter.connect(MAC);
    state.advance(3_000); // silencio ≥ el umbral
    state.watchdogs()[0]?.fn();
    await flush();
  });

  assert.equal(kinds.includes('connected_silent'), true, 'la mudez queda registrada');
  assert.equal(statuses.at(-1), 'connected', 'mudo pero vivo sigue conectado');
  assert.equal(nativeState.deviceDisconnectCalls, 0);
});

test('🟠-5: una lectura reciente NO genera el log de mudez (mide silencio, no tiempo conectado)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, timeouts: POLLING });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  const kinds = await captureLogKinds(async () => {
    await adapter.connect(MAC);
    state.advance(2_900);
    nativeState.dataListeners.forEach((cb) => cb({ data: RAW_LINE })); // bastonazo
    state.advance(200); // el poll vence, pero hace solo 200 ms del último byte
    state.watchdogs()[0]?.fn();
    await flush();
  });

  assert.equal(kinds.includes('connected_silent'), false);
  assert.deepEqual(nativeState.isDeviceConnectedCalls, [MAC], 'la sonda de liveness corre igual');
});

test('BENCH-1: el watchdog muere con el link (no queda un timer huérfano tras desconectar)', async () => {
  const { native } = fakeNative();
  const { env, state } = fakeEnv({ native, timeouts: POLLING });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  assert.equal(state.watchdogs().length, 1);
  await adapter.disconnect();
  assert.equal(state.watchdogs().length, 0);
});

test('BENCH-1: el poll no se apila — un solo watchdog vivo aunque se reconecte varias veces', async () => {
  const { native } = fakeNative();
  const { env, state } = fakeEnv({ native, timeouts: POLLING });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  await adapter.connect(MAC);
  await adapter.connect(OTHER_MAC);
  assert.equal(state.watchdogs().length, 1);
});

// ─── 🟠-5 · El terminador sale del DRIVER, con chequeo honesto ───────────────────────────────

test('🟠-5: el delimitador del driver es el que se le pide al nativo Y el que separa el payload', async () => {
  const CR_DRIVER: ReaderDriver = {
    ...RS420_DRIVER,
    transports: [{ kind: 'spp', params: { sppUuid: SPP_UUID, delimiter: '\r' } }],
  };
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(CR_DRIVER, env);
  const { tags } = track(adapter);
  await adapter.connect(MAC);

  assert.equal(nativeState.connectCalls[0]?.options?.delimiter, '\r');
  // Dos tramas pegadas separadas por el terminador DEL DRIVER (no por un `\n` inventado).
  nativeState.dataListeners.forEach((cb) => cb({ data: 'AAA\rBBB' }));
  assert.deepEqual(tags, ['AAA', 'BBB']);
});

test('🟠-5: un driver con delimitador VACÍO no abre el socket (cortar antes que quedar mudo)', async () => {
  // Delimitador vacío es legal para el nativo pero significa "entregá todo el buffer crudo": el
  // framing tendría que hacerlo `LineFramer` de este lado, que es el bug que costó "cero lecturas".
  const BAD: ReaderDriver = {
    ...RS420_DRIVER,
    transports: [{ kind: 'spp', params: { sppUuid: SPP_UUID, delimiter: '' } }],
  };
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(BAD, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(nativeState.connectCalls.length, 0);
});

// ─── 🟠-1 · El gate de foreground se chequea AL DISPARAR el timer, no solo al programarlo ────

test('🟠-1: si la app se fue a background entre armar y disparar, NO se conecta (R6.9)', async () => {
  const { native, state: nativeState } = fakeNative({ connectRejects: new Error('fuera de rango') });
  const { env, state } = fakeEnv({ native, foreground: true });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  assert.equal(nativeState.connectCalls.length, 1);
  const retry = state.reconnects()[0];
  assert.ok(retry);

  state.foreground = false; // el teléfono se fue al bolsillo durante el backoff
  retry.fn();
  await flush();

  assert.equal(nativeState.connectCalls.length, 1, 'no se intentó conectar desde background');
  assert.equal(state.foregroundListeners.length, 1, 'quedó esperando el retorno a foreground');

  state.resumeForeground();
  assert.equal(state.reconnects().length, 1, 'y al volver se re-arma el reintento');
});

// ─── 🟠-2 · Un connect() a OTRO bastón no se descarta en silencio ────────────────────────────

test('🟠-2: elegir OTRO bastón mientras se conecta al primero se ATIENDE al terminar', async () => {
  // Antes: el operario tocaba el bastón A (cuyo connectToDevice bloquea segundos si está apagado),
  // se daba cuenta de que era el otro, tocaba el B, no pasaba NADA —ni estado ni log— y terminaba
  // conectado a A.
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  const first = adapter.connect(MAC);
  await flush();
  await adapter.connect(OTHER_MAC); // llega con el intento en curso

  nativeState.releaseConnect();
  await first;

  assert.deepEqual(
    nativeState.connectCalls.map((c) => c.address),
    [MAC, OTHER_MAC],
    'se conectó al que el operario eligió ÚLTIMO',
  );
  assert.equal(statuses.at(-1), 'connected');
  assert.deepEqual(state.written, [MAC, OTHER_MAC]);
});

test('🟠-2: un connect() SIN target con un intento en curso no encola nada (es el mismo pedido)', async () => {
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  const first = adapter.connect(MAC);
  await flush();
  await adapter.connect(); // "conectá a lo que estabas"
  nativeState.releaseConnect();
  await first;

  assert.equal(nativeState.connectCalls.length, 1);
});

test('🟠-2: un disconnect() mientras hay otro bastón encolado lo descarta (gana el operario)', async () => {
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  const first = adapter.connect(MAC);
  await flush();
  await adapter.connect(OTHER_MAC);
  await adapter.disconnect();
  nativeState.releaseConnect();
  await first;

  assert.deepEqual(nativeState.connectCalls.map((c) => c.address), [MAC]);
  assert.equal(statuses.at(-1), 'disconnected');
});

// ─── §9.3 del review · La cadena de reintentos NUNCA tira el diálogo del sistema ─────────────

test('un REINTENTO automático con el Bluetooth apagado no pide prenderlo, y sigue reintentando', async () => {
  // El diálogo "¿activar Bluetooth?" disparado por un timer es un gesto que el operario no pidió.
  // Y no reintentar tampoco sirve: en el banco el operario prendió el BT desde el panel rápido, así
  // que la app tiene que engancharlo sola dentro de la ventana del backoff (≤ 8 s).
  const { native, state: nativeState } = fakeNative({ connectRejects: new Error('fuera de rango') });
  const { env, state } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(state.reconnects().length, 1);

  const promptsBefore = state.permissionCalls;
  nativeState.bluetoothEnabled = false; // el operario apagó el Bluetooth
  state.reconnects()[0].fn();
  await flush();

  assert.equal(nativeState.requestEnabledCalls, 0, 'NINGÚN diálogo del sistema desde un timer');
  assert.equal(
    state.permissionCalls,
    promptsBefore,
    'y tampoco el de PERMISOS: el reintento consulta, no pide (requestMultiple sobre un permiso denegado una vez lo vuelve a mostrar)',
  );
  assert.equal(statuses.at(-1), 'scanning', 'pero la cadena de reintentos sigue viva');
  assert.equal(state.reconnects().length, 1);
});

test('un connect() DEL OPERARIO con el Bluetooth apagado sí pide prenderlo', async () => {
  const { native, state: nativeState } = fakeNative({ bluetoothEnabled: false, enableAccepted: true });
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);
  await adapter.connect(MAC);
  assert.equal(nativeState.requestEnabledCalls, 1);
  assert.equal(statuses.at(-1), 'connected');
});

// ─── 🟠-4 · La lista de emparejados: guard de re-entrada + todo await acotado ────────────────

test('🟠-4: dos listPairedSppDevices concurrentes son UNA sola llamada al nativo (coalesce)', async () => {
  // No es solo eficiencia: dos pedidos solapados eran uno de los dos caminos por los que se pisaba
  // el `mEnabledPromise` del nativo y quedaba una promesa huérfana para siempre (🔴-1).
  __resetSppModuleStateForTests();
  const { native, state: nativeState } = fakeNative({ bonded: [{ address: MAC, name: 'RS 420' }] });
  const { env } = fakeEnv({ native });
  const [a, b] = await Promise.all([listPairedSppDevices(env), listPairedSppDevices(env)]);
  assert.equal(nativeState.bondedCalls, 1);
  assert.deepEqual(a, b);
});

test('🟠-4: un getBondedDevices que NO RESUELVE cae a { ok:false, error } (nunca "Buscando…" eterno)', async () => {
  __resetSppModuleStateForTests();
  const { native } = fakeNative({ hangBonded: true });
  const { env } = fakeEnv({ native, timeouts: FAST_TIMEOUTS });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'error' });
});

test('🟠-4: un ensurePermissions que NO RESUELVE cae a { ok:false, unavailable }', async () => {
  __resetSppModuleStateForTests();
  const { native } = fakeNative();
  const { env } = fakeEnv({ native, hangPermissions: true, timeouts: FAST_TIMEOUTS });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'unavailable' });
});

test('🟠-4: un requestBluetoothEnabled colgado no deja la lista clavada (vence y degrada)', async () => {
  __resetSppModuleStateForTests();
  const { native } = fakeNative({ bluetoothEnabled: false, hangEnable: true });
  const { env } = fakeEnv({ native, timeouts: FAST_TIMEOUTS });
  assert.deepEqual(await listPairedSppDevices(env), { ok: false, reason: 'bluetooth_off' });
  await wait(10); // deja vencer cualquier timer residual antes del test siguiente
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// R6.4 · RECONEXIÓN AUTOMÁTICA AL ABRIR LA APP (🟠-3 del review)
//
// El review lo marcó como "sin implementar y SIN TEST — no puede tenerlo: no existe el camino".
// Decisión de Raf (2026-07-30): *"que se reconecte sola al abrir, sí"*. Estos son los casos que
// faltaban, y la mitad de ellos asserta lo que el arranque NO tiene que hacer: el primer frame de la
// app no pide permisos, no muestra el diálogo de activar Bluetooth y no toca la radio de un teléfono
// cuyo dueño nunca eligió un bastón.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('R6.4: con device recordado + permiso concedido + BT prendido → conecta SOLO, sin gesto', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.equal(nativeState.connectCalls[0]?.address, MAC, 'conectó al bastón que el operario ya había elegido');
  assert.equal(statuses.at(-1), 'connected');
});

test('R6.4: SIN device recordado no toca NADA — ni la radio, ni los permisos, ni el estado', async () => {
  // Arranque en frío (nadie eligió un bastón nunca). El orden de los gates importa: el device
  // recordado es una lectura LOCAL y va PRIMERO, justamente para que este caso no consulte permisos
  // ni pregunte por el Bluetooth.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: null });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.equal(nativeState.connectCalls.length, 0);
  assert.equal(state.permissionChecks, 0, 'no se consultó el permiso');
  assert.equal(state.permissionCalls, 0, 'y menos se pidió');
  assert.deepEqual(statuses, [], 'no se emitió NINGÚN estado: se queda en "off" (nunca se intentó)');
  assert.equal(state.reconnects().length, 0, 'ni se armó un reintento');
});

test('R6.4: con el Bluetooth APAGADO no muestra el diálogo de activar (el arranque no pide nada)', async () => {
  const { native, state: nativeState } = fakeNative({ bluetoothEnabled: false, enableAccepted: true });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.equal(nativeState.requestEnabledCalls, 0, 'NINGÚN diálogo del sistema desde el arranque');
  assert.equal(nativeState.connectCalls.length, 0);
  assert.deepEqual(statuses, [], 'y el estado queda en "off", no en un "desconectado" mentiroso');
  assert.equal(state.reconnects().length, 0);
});

test('R6.4: si el permiso NO está concedido, lo CONSULTA pero NO lo pide', async () => {
  // Un prompt de permisos en el primer frame es hostil y el operario no tiene contexto de por qué.
  // Se lo pide el gesto (tocar "Conectar bastón"), que es el único momento con contexto.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC, checkPermission: 'denied' });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.equal(state.permissionChecks, 1, 'se consultó');
  assert.equal(state.permissionCalls, 0, 'NO se pidió (nada de diálogo de permisos en el arranque)');
  assert.equal(nativeState.connectCalls.length, 0);
  assert.deepEqual(statuses, [], 'sin "Sin permiso" en el chrome de alguien que no pidió nada');
});

test('R6.4: si el permiso está concedido, el arranque NO vuelve a pedirlo (usa check, no request)', async () => {
  const { native } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();

  assert.equal(state.permissionCalls, 0, 'ni una vez: el camino automático solo consulta');
  assert.ok(state.permissionChecks >= 1);
});

test('R6.4/R6.9: en background el arranque no conecta ni consulta nada', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC, foreground: false });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.equal(nativeState.connectCalls.length, 0);
  assert.equal(state.rememberedReads, 0, 'ni se leyó el storage');
  assert.deepEqual(statuses, []);
});

test('R6.4: sin módulo nativo (web/CI/dev build viejo) el arranque no rompe ni promete nada', async () => {
  const { env, state } = fakeEnv({ native: null, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await assert.doesNotReject(() => adapter.autoConnect());
  assert.deepEqual(statuses, []);
  assert.equal(state.permissionChecks, 0, 'no se consulta el permiso de algo que no se puede usar');
});

test('R6.4: dos autoConnect() (StrictMode / re-montaje) NO abren dos sockets', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  await adapter.autoConnect();

  assert.equal(nativeState.connectCalls.length, 1);
});

test('R6.4: el ciclo autoConnect → disconnect → autoConnect (cleanup del efecto) termina CONECTADO', async () => {
  // Es el ciclo que hace React cuando el efecto del provider vuelve a correr (StrictMode, cambio de
  // `mode`, re-montaje): monta → cleanup (que llama `disconnect()`) → monta de nuevo.
  //
  // La primera versión de `autoConnect()` gateaba por `this.closed` para "no reconectar a espaldas del
  // operario", y eso **mataba R6.4 en silencio** justo acá: el cleanup pone `closed = true` y el
  // arranque siguiente se abstenía, sin que nada se pusiera rojo. `disconnect()` significa dos cosas
  // opuestas según quién lo llame (el operario, o el provider desarmando el cableado) y el único que
  // puede re-invocar `autoConnect()` es el segundo. Este test fija el resultado correcto del ciclo:
  // termina con UNA conexión viva, no con cero.
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  await adapter.disconnect(); // cleanup del efecto
  await adapter.autoConnect();

  assert.equal(statuses.at(-1), 'connected', 'R6.4 sigue viva después de un re-run del efecto');
  assert.equal(nativeState.connectCalls.length, 2, 'una por montaje, y nunca dos socket vivos a la vez');
  assert.equal(nativeState.deviceDisconnectCalls, 1, 'el socket del primer montaje se cerró');
});

test('R6.4: un arranque que FALLA cae en el mismo estado que un connect por gesto fallido', async () => {
  // No puede empeorar el arranque de la app: misma cadena de reintentos, y la carga manual intacta.
  const { native } = fakeNative({ connectRejects: new Error('fuera de rango') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.deepEqual(statuses, ['connecting', 'disconnected', 'scanning']);
  assert.equal(state.reconnects()[0]?.ms, backoffDelayMs(0));
});

test('R6.4: el arranque reintenta al MISMO device recordado (no a "el recordado" de nuevo)', async () => {
  const { native, state: nativeState } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  state.reconnects()[0]?.fn();
  await flush();

  assert.deepEqual(nativeState.connectCalls.map((c) => c.address), [MAC, MAC]);
});

test('R6.4: un readRemembered que NO RESUELVE no cuelga el arranque de la app', async () => {
  // Es el primer await del primer frame: si no venciera, el auto-connect quedaría a medio camino con
  // el latch libre y nadie se enteraría. (El storage es SecureStore: cruza el puente.)
  const { native, state: nativeState } = fakeNative();
  const hangingEnv = fakeEnv({ native, remembered: MAC, timeouts: FAST_TIMEOUTS });
  hangingEnv.env.readRemembered = () => neverResolves<string | null>();
  const adapter = new SppAndroidAdapter(RS420_DRIVER, hangingEnv.env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();

  assert.equal(nativeState.connectCalls.length, 0);
  assert.deepEqual(statuses, []);
});

test('R6.4: el gesto SÍ pide permiso y SÍ pide prender el BT (el arranque es lo distinto, no el gesto)', async () => {
  // Contraprueba: si este test no existiera, el "arranque no pide nada" podría estar implementado
  // rompiendo el camino del operario y nadie lo vería.
  const { native, state: nativeState } = fakeNative({ bluetoothEnabled: false, enableAccepted: true });
  const { env, state } = fakeEnv({ native, remembered: MAC, checkPermission: 'denied' });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.connect(MAC); // GESTO

  assert.equal(state.permissionCalls, 1, 'el gesto pide el permiso');
  assert.equal(nativeState.requestEnabledCalls, 1, 'y pide prender el Bluetooth');
  assert.equal(statuses.at(-1), 'connected');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// TOPE DE LA CADENA QUE NADIE PIDIÓ (defecto que introdujo R6.4, decidido por el leader)
//
// Antes de R6.4 el reintento infinito exigía un gesto deliberado. Con el arranque auto-conectando, un
// bastón vendido / roto / que quedó en otro campo deja la app permanentemente con cara de rota,
// martillando la radio en cada apertura, y `scanning` no tiene CTA para frenarla. Estos tests fijan:
// que la cadena SIN gesto muera, que la CON gesto no, y qué queda en pantalla al morir.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Corre la cadena de reintentos disparando timers hasta que no queda ninguno (o se agota el margen).
 * `await flush()` entre vuelta y vuelta NO es opcional: el reintento arma el siguiente timer recién
 * cuando su `connect()` asíncrono se asienta, así que sin soltar el event loop el drenaje mide 1 y
 * parece que la cadena murió.
 */
async function drainRetries(
  state: { reconnects: () => Array<{ fn: () => void }> },
  max = 60,
): Promise<number> {
  let fired = 0;
  for (let i = 0; i < max; i++) {
    const pending = state.reconnects()[0];
    if (!pending) break;
    pending.fn();
    fired += 1;
    await flush();
  }
  return fired;
}

test('TOPE: la cadena del ARRANQUE deja de reintentar al agotar el presupuesto, con CTA y sin olvidar el device', async () => {
  const { native, state: nativeState } = fakeNative({ connectRejects: new Error('fuera de rango') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  assert.equal(state.reconnects().length, 1, 'arrancó la cadena');

  // El bastón no aparece nunca. Se avanza el reloj más allá del presupuesto y se dispara el reintento.
  state.advance(UNPROMPTED_RETRY_BUDGET_MS);
  state.reconnects()[0]?.fn();
  await flush();

  assert.equal(state.reconnects().length, 0, 'DEJÓ de reintentar (antes seguía para siempre)');
  assert.equal(state.foregroundListeners.length, 0, 'y no quedó esperando el retorno a foreground');
  assert.equal(statuses.at(-1), 'off', 'estado final con CTA (scanning no tiene ninguno)');
  assert.equal(adapter.autoConnectExhausted, true, 'y la pantalla puede decir la verdad');

  // NO se olvidó el device recordado: que hoy no aparezca no significa que no sea su bastón.
  const connectsAntes = nativeState.connectCalls.length;
  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(); // sin target: tiene que caer en el RECORDADO
  assert.equal(good.state.connectCalls[0]?.address, MAC, 'el bastón guardado sigue guardado');
  assert.ok(connectsAntes > 0);
});

test('TOPE: el tap del CTA arranca una cadena SIN tope (el operario está tratando de conectar)', async () => {
  const { native } = fakeNative({ connectRejects: new Error('fuera de rango') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  // Se agota la cadena del arranque…
  await adapter.autoConnect();
  state.advance(UNPROMPTED_RETRY_BUDGET_MS);
  state.reconnects()[0]?.fn();
  await flush();
  assert.equal(state.reconnects().length, 0);

  // … el operario toca "Volver a conectar" y ahora SÍ se insiste indefinidamente.
  await adapter.connect(MAC);
  assert.equal(adapter.autoConnectExhausted, false, 'se está intentando de nuevo: el copy honesto ya no aplica');
  state.advance(10 * UNPROMPTED_RETRY_BUDGET_MS); // muchísimo más que el presupuesto
  const fired = await drainRetries(state, 12);
  assert.equal(fired, 12, 'la cadena del operario NO se agota');
  assert.equal(statuses.at(-1), 'scanning');
});

test('TOPE: el presupuesto NO se re-arma en cada reintento (si no, no se alcanzaría nunca)', async () => {
  // Es la trampa: si el timer arrancara la cadena en vez de heredarla, cada vuelta reiniciaría el
  // presupuesto y el tope sería decorativo.
  const { native } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  // Tres reintentos ANTES de que se agote el presupuesto: la cadena sigue viva…
  for (let i = 0; i < 3; i++) {
    state.advance(UNPROMPTED_RETRY_BUDGET_MS / 4);
    state.reconnects()[0]?.fn();
    await flush();
  }
  assert.ok(state.reconnects().length > 0, 'todavía dentro del presupuesto');

  // … y al cruzarlo, muere (o sea: el reloj corrió desde el ARRANQUE, no desde el último reintento).
  state.advance(UNPROMPTED_RETRY_BUDGET_MS / 2);
  state.reconnects()[0]?.fn();
  await flush();
  assert.equal(state.reconnects().length, 0);
});

test('TOPE: una cadena con presupuesto vencido MUERE aunque la app esté en background', async () => {
  // El chequeo del tope va ANTES del gate de foreground a propósito: si fuera después, una cadena
  // vencida se quedaría esperando el retorno a primer plano para seguir martillando.
  const { native } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  const pending = state.reconnects()[0];
  assert.ok(pending);

  state.foreground = false; // el teléfono se fue al bolsillo
  state.advance(UNPROMPTED_RETRY_BUDGET_MS);
  pending.fn();
  await flush();

  assert.equal(state.foregroundListeners.length, 0, 'no quedó nada esperando');
  assert.equal(state.reconnects().length, 0);
  assert.equal(statuses.at(-1), 'off');
});

test('TOPE: una conexión que SÍ se logra dentro del presupuesto no lo sufre ("lo prendí un minuto después")', async () => {
  const failing = fakeNative({ connectRejects: new Error('todavía apagado') });
  const { env, state } = fakeEnv({ native: failing.native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  // Un minuto de reintentos fallidos (el operario caminando hasta la manga)…
  state.advance(60_000);
  // … y ahora prende el bastón: el reintento siguiente conecta.
  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  state.reconnects()[0]?.fn();
  await flush();

  assert.equal(statuses.at(-1), 'connected');
  assert.equal(adapter.autoConnectExhausted, false);
});

test('TOPE: al agotarse, el backoff vuelve al piso (el tap del operario no espera 8 s)', async () => {
  const { native } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  // Varios reintentos: el backoff sube.
  for (let i = 0; i < 4; i++) {
    state.advance(1_000);
    state.reconnects()[0]?.fn();
    await flush();
  }
  assert.equal(state.reconnects()[0]?.ms, backoffDelayMs(4), 'el backoff está en el techo');

  state.advance(UNPROMPTED_RETRY_BUDGET_MS);
  state.reconnects()[0]?.fn();
  await flush();

  // El operario toca: la cadena nueva arranca del piso, no del techo.
  await adapter.connect(MAC);
  assert.equal(state.reconnects()[0]?.ms, backoffDelayMs(0));
});

test('TOPE: se loguea el agotamiento con cuánto duró y cuántos intentos entraron', async () => {
  const { native } = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  const lines: string[] = [];
  const original = console.info;
  // eslint-disable-next-line no-console
  console.info = (...args: unknown[]) => {
    if (args[0] === '[ble]') lines.push(String(args[2]));
  };
  try {
    await adapter.autoConnect();
    state.advance(UNPROMPTED_RETRY_BUDGET_MS);
    state.reconnects()[0]?.fn();
    await flush();
  } finally {
    // eslint-disable-next-line no-console
    console.info = original;
  }

  const exhausted = lines.find((l) => l.includes('autoconnect_exhausted'));
  assert.ok(exhausted, 'sin este log, "no se conectó y dejó de intentar" es inadivinable');
  assert.match(exhausted, /"ms":\d+/);
  assert.match(exhausted, /"attempts":\d+/);
});

test('TOPE: un corte DESPUÉS de una conexión del operario no hereda ningún tope', async () => {
  // La distinción es el ORIGEN de la cadena, no el estado: el operario conectó, el link se cayó, y la
  // reconexión que sigue es de SU cadena → indefinida.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.connect(MAC);
  nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });
  assert.equal(state.reconnects().length, 1);

  state.advance(10 * UNPROMPTED_RETRY_BUDGET_MS);
  const pending = state.reconnects()[0];
  assert.ok(pending);
  pending.fn();
  await flush();
  assert.ok(state.reconnects().length >= 0); // no explota
  // Y sigue habiendo cadena: el tiempo no la mata.
  nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });
  assert.equal(state.reconnects().length, 1, 'la cadena del operario sigue viva pasado cualquier tiempo');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// FIX-LOOP · el hueco que el reviewer (su mutante M7) y el Gate 2 (HIGH-1) encontraron por separado
//
// El bloque `TOPE:` de arriba cubría la cadena que NUNCA conectó y la del operario. Faltaba justo la
// que R6.4 volvió el camino por defecto de cada apertura: **el arranque conectó, y el link se cae
// después**. El reviewer corrió el fix candidato como mutante y la suite quedó 104/104 — o sea, sus 8
// casos no distinguían el bug del arreglo. Estos sí.
// ═══════════════════════════════════════════════════════════════════════════════════════════

test('🔴-A: un corte DESPUÉS de una conexión del ARRANQUE reintenta, aunque hayan pasado >120 s', async () => {
  // EL bug de esta pasada. Sin el fix: el operario abre la app, R6.4 conecta sola, trabaja 10 minutos,
  // el bastón se va de rango un segundo → CERO reintentos por el resto de la sesión, estado 'off' (el
  // único que el StickStatusIndicator se auto-oculta) y la pantalla inventando "no encontramos el
  // bastón" sobre un bastón que estaba conectado tres segundos antes.
  //
  // El invariante: el presupuesto existe por "ese bastón lo vendí"; cuando el bastón CONTESTA, ese
  // motivo dejó de aplicar. Lo que viene después es la segunda cláusula de R6.4 ("vuelve a estar en
  // rango"), que no tiene tope.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  assert.equal(statuses.at(-1), 'connected', 'el arranque conectó solo');

  // El operario trabaja MUCHO más que el presupuesto…
  state.advance(5 * UNPROMPTED_RETRY_BUDGET_MS);
  // … y el bastón se va de rango.
  nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });

  assert.equal(state.reconnects().length, 1, 'TIENE que reintentar: el bastón existe, contestó hace un rato');
  assert.equal(statuses.at(-1), 'scanning');
  assert.equal(adapter.autoConnectExhausted, false, 'y nadie puede decir "no encontramos el bastón"');
});

test('🔴-A: y sigue reintentando indefinidamente (no es un reintento y se rinde)', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  state.advance(3 * UNPROMPTED_RETRY_BUDGET_MS);
  nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });

  // El bastón ya no vuelve nunca: la cadena post-conexión NO tiene techo de tiempo.
  const failing = fakeNative({ connectRejects: new Error('fuera de rango') });
  (env as { loadNative: () => SppNative }).loadNative = () => failing.native;
  state.advance(10 * UNPROMPTED_RETRY_BUDGET_MS);
  const fired = await drainRetries(state, 10);
  assert.equal(fired, 10, 'la cadena de "vuelve a estar en rango" (R6.4) no se rinde');
});

test('🔴-A: la contraprueba — la cadena que NUNCA conectó sigue teniendo tope', async () => {
  // El fix no puede llevarse puesto el tope: es lo que impide que un bastón vendido deje la app
  // martillando la radio en cada apertura.
  const { native } = fakeNative({ connectRejects: new Error('ese bastón lo vendí') });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  state.advance(UNPROMPTED_RETRY_BUDGET_MS);
  state.reconnects()[0]?.fn();
  await flush();

  assert.equal(state.reconnects().length, 0, 'sin haber conectado nunca, el tope sigue aplicando');
  assert.equal(statuses.at(-1), 'off');
  assert.equal(adapter.autoConnectExhausted, true);
});

test('🔴-A: la contraprueba corta — un corte DENTRO del presupuesto también reintenta', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  await adapter.autoConnect();
  state.advance(30_000); // bien dentro de los 120 s
  nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });
  assert.equal(state.reconnects().length, 1);
});

test('🔴-A: un teardown por LIVENESS de un link establecido tampoco mata la reconexión', async () => {
  // El compose que marcó el reviewer: la sonda es fail-closed, así que un puente momentáneamente lento
  // hace teardown de un socket VIVO (precio aceptado, ~1-2 s). Sobre una sesión de más de 120 s eso
  // desactivaba el bastón por el resto de la sesión y le echaba la culpa al bastón.
  const { native, state: nativeState } = fakeNative();
  const { env, state } = fakeEnv({ native, remembered: MAC, timeouts: POLLING });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  await adapter.autoConnect();
  state.advance(4 * UNPROMPTED_RETRY_BUDGET_MS);
  nativeState.socketAlive = false; // la sonda va a decir que está muerto
  state.watchdogs()[0]?.fn();
  await flush();

  assert.equal(statuses.at(-1), 'scanning', 'reconcilia y RECONECTA, no se rinde');
  assert.equal(state.reconnects().length, 1);
});

test('🟠-B: el tap del chip (connect() SIN target) destopa la cadena del arranque y deja log', async () => {
  // El camino real: `BleConnectionChip` llama `connect()` sin argumentos, y está renderizado en la tab
  // Animales y en maniobra/identificar. Antes esto era un no-op MUDO: el operario tocaba, no pasaba
  // nada, y la app se rendía igual a los 120 s habiendo él pedido lo contrario.
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env, state } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses } = track(adapter);

  const auto = adapter.autoConnect(); // arranca la cadena CAPADA y se cuelga en connectToDevice
  await flush();

  const kinds = await captureLogKinds(async () => {
    await adapter.connect(); // ← EL TAP DEL CHIP, sin target: no encola nada, pero SÍ destopa
  });
  assert.equal(kinds.includes('connect_reasserted'), true, 'ya no es mudo');

  nativeState.releaseConnect();
  await auto;
  assert.equal(statuses.at(-1), 'connected');

  // Y la cadena ya no tiene tope: pasado el presupuesto, un corte sigue reintentando.
  state.advance(5 * UNPROMPTED_RETRY_BUDGET_MS);
  nativeState.disconnectListeners.at(-1)?.({ device: { address: MAC } });
  assert.equal(state.reconnects().length, 1, 'el tap destopó la cadena');
});

test('🟠-B: el mismo target explícito con el latch tomado tampoco es mudo', async () => {
  const { native, state: nativeState } = fakeNative({ gateConnect: true });
  const { env } = fakeEnv({ native, remembered: MAC });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);

  const first = adapter.connect(MAC);
  await flush();
  const kinds = await captureLogKinds(async () => {
    await adapter.connect(MAC); // mismo target: no hay nada que encolar
  });
  assert.equal(kinds.includes('connect_reasserted'), true);

  nativeState.releaseConnect();
  await first;
  assert.equal(nativeState.connectCalls.length, 1, 'y sigue sin abrir dos sockets');
});
