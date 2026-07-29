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
  type SppDeviceLike,
  type SppEnv,
  type SppNative,
  type SppSubscription,
} from './adapter-spp-android.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { SPP_UUID } from './config.ts';
import { backoffDelayMs } from './line-framer.ts';
import type { ConnectionStatus } from './stick-adapter.ts';
import type { ReaderDriver } from './driver-types.ts';

const RAW_LINE = '\x021000000982000364696050260530101701\r';
const EID_982 = '982000364696050';
const MAC = 'AA:BB:CC:DD:EE:FF';

// ─── Dobles de la lib nativa ────────────────────────────────────────────────────────────────

interface FakeNativeOptions {
  bluetoothEnabled?: boolean;
  enableAccepted?: boolean;
  bonded?: unknown[];
  connectRejects?: Error | null;
  omitDisconnectEvents?: boolean;
}

function fakeNative(opts: FakeNativeOptions = {}) {
  const state = {
    bluetoothEnabled: opts.bluetoothEnabled ?? true,
    requestEnabledCalls: 0,
    connectCalls: [] as Array<{ address: string; options?: Record<string, unknown> }>,
    dataListeners: [] as Array<(e: { data?: string }) => void>,
    disconnectListeners: [] as Array<(e: unknown) => void>,
    deviceDisconnectCalls: 0,
    removedSubs: 0,
  };

  const sub = (): SppSubscription => ({
    remove() {
      state.removedSubs += 1;
    },
  });

  const device: SppDeviceLike = {
    address: MAC,
    onDataReceived(cb) {
      state.dataListeners.push(cb);
      return sub();
    },
    async disconnect() {
      state.deviceDisconnectCalls += 1;
      return true;
    },
  };

  const native: SppNative = {
    async isBluetoothEnabled() {
      return state.bluetoothEnabled;
    },
    async requestBluetoothEnabled() {
      state.requestEnabledCalls += 1;
      if (opts.enableAccepted ?? true) {
        state.bluetoothEnabled = true;
        return true;
      }
      return false;
    },
    async getBondedDevices() {
      return opts.bonded ?? [];
    },
    async connectToDevice(address, options) {
      state.connectCalls.push({ address, options });
      if (opts.connectRejects) throw opts.connectRejects;
      return device;
    },
    ...(opts.omitDisconnectEvents
      ? {}
      : {
          onDeviceDisconnected(cb: (e: unknown) => void) {
            state.disconnectListeners.push(cb);
            return sub();
          },
        }),
  };

  return { native, state, device };
}

interface FakeEnvOptions {
  native?: SppNative | null;
  permission?: 'granted' | 'denied' | 'unavailable';
  remembered?: string | null;
  foreground?: boolean;
}

function fakeEnv(opts: FakeEnvOptions = {}) {
  const state = {
    written: [] as string[],
    scheduled: [] as Array<{ fn: () => void; ms: number }>,
    foregroundListeners: [] as Array<() => void>,
    foreground: opts.foreground ?? true,
    permissionCalls: 0,
  };
  const env: SppEnv = {
    loadNative: () => opts.native ?? null,
    ensurePermissions: async () => {
      state.permissionCalls += 1;
      return opts.permission ?? 'granted';
    },
    readRemembered: async () => opts.remembered ?? null,
    writeRemembered: async (id: string) => {
      state.written.push(id);
    },
    isForeground: () => state.foreground,
    schedule: (fn: () => void, ms: number) => {
      const entry = { fn, ms };
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

test('RMV5.2: resolveSppParams(RS420) → { sppUuid: SPP_UUID, pin: "1234" }', () => {
  assert.deepEqual(resolveSppParams(RS420_DRIVER), { sppUuid: SPP_UUID, pin: '1234' });
});

test('RMV5.2: otro driver SPP se soporta cambiando el driver, no el adapter (params del driver)', () => {
  const OTHER: ReaderDriver = {
    ...RS420_DRIVER,
    vendorId: 'other-spp',
    transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '0000' } }],
  };
  assert.deepEqual(resolveSppParams(OTHER), { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '0000' });
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

test('una reconexión exitosa RESETEA el backoff (el próximo corte no arranca en 8s)', async () => {
  const failing = fakeNative({ connectRejects: new Error('nope') });
  const { env, state } = fakeEnv({ native: failing.native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  track(adapter);
  await adapter.connect(MAC);
  state.scheduled.shift()?.fn();
  await flush();
  assert.equal(state.scheduled[0]?.ms, backoffDelayMs(1));
  state.scheduled = [];

  // Ahora el nativo conecta bien: el contador vuelve a 0 y el corte siguiente arranca del piso.
  const good = fakeNative();
  (env as { loadNative: () => SppNative }).loadNative = () => good.native;
  await adapter.connect(MAC);
  good.state.disconnectListeners.forEach((cb) => cb({}));
  assert.equal(state.scheduled[0]?.ms, backoffDelayMs(0));
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

test('disconnect() DURANTE el connect no deja el socket abierto a sus espaldas', async () => {
  const { native, state: nativeState } = fakeNative();
  const { env } = fakeEnv({ native });
  const adapter = new SppAndroidAdapter(RS420_DRIVER, env);
  const { statuses, tags } = track(adapter);
  const connecting = adapter.connect(MAC);
  await adapter.disconnect(); // el operario toca "Desconectar" mientras se abre el socket
  await connecting;
  assert.equal(statuses.at(-1), 'disconnected');
  assert.ok(nativeState.deviceDisconnectCalls >= 1, 'el socket recién abierto se cerró');
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
