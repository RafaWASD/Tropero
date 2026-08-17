// Tests del MOTOR DE SELECCIÓN POR CAPACIDAD (RMV2 → RBM5) + la regresión de `selectTransportAdapter`
// (RMV2.7 → RBM5.9) + el binding de MFi (RBM4.4/4.5/RBM5.5). node:test, PURO (todo inyectado, sin
// device).
//
// ── QUÉ CAMBIÓ EN ESTE ARCHIVO CON EL DELTA `ios-ble-mfi` (F4) Y CON QUÉ AUTORIZACIÓN ────────────────
// Cuatro tests del delta multivendor pasaron a ser FALSOS A PROPÓSITO. Cada uno se actualizó nombrando el
// requisito que lo autoriza, porque un test viejo que se "actualiza" sin ese respaldo es una regresión
// aceptada en silencio:
//
//   1. `RMV6.2/6.3: ble-gatt y mfi no tienen adapter buildable (null)` → **RBM5.2** los mapea
//      (`ble-gatt` en iOS y Android, `mfi` en iOS) y **RBM7.1** dice literalmente que RMV6.2/RMV6.3
//      "dejan de ser fuera de este delta". Reescrito como el mapeo nuevo + sus dos fail-closed (RBM5.3).
//   2. `RMV6.1/6.2: driver mfi-only en iOS → binding null` → **RBM4.4/RBM4.5/RBM5.5**: F4 cablea el
//      binding de MFi, así que ya no es `null` sino un binding `mfi-ios` con su `available` y su motivo.
//   3. `RMV2.7 regresión: selectTransportAdapter(...)` → la línea de **iOS auto** la cambia **RBM5.6**
//      (design §6.2: *"iOS pasa de 'manual' a 'ble-gatt' como piso"*). RBM5.9 congela `mock`/`manual`/
//      `demo` y `auto` **en Android y en web** — y esos quedaron intactos, en su propio test.
//   4. Los tres `deepEqual` de bindings NO disponibles (RS420 android sin construir, HID en iOS, HID en
//      android) ganaron `unavailableReason` y **nada más**: `adapterKind`, `transportKind` y `available`
//      son idénticos byte por byte, o sea que la prioridad de Android **no cambió** (RBM5.4 intacto). El
//      campo lo exige **RBM4.5** (el motivo tiene que ser explícito) + **RBM5.14** (la UI dice la verdad:
//      "falta la autorización del fabricante" no es lo mismo que "todavía no lo soportamos"). El
//      invariante de que TODO `available:false` traiga motivo tiene su propio test más abajo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  platformTransportPriority,
  adapterForTransport,
  isAdapterUsableOn,
  selectReaderBinding,
  TRANSPORT_KINDS,
  type BindingEnv,
  type ReaderBinding,
} from './selection-priority.ts';
import {
  selectTransportAdapter,
  transportChoices,
  ADAPTER_KINDS,
  type AdapterKind,
  type TransportChoicesEnv,
} from './adapter-selection.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { ESP32_GATT_DRIVER } from './driver-esp32-gatt.ts';
import { DRIVER_REGISTRY } from './driver-registry.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { ReaderDriver } from './driver-types.ts';

// Drivers sintéticos para probar los transportes que el RS420 NO declara.
const HID_DRIVER: ReaderDriver = {
  vendorId: 'generic-hid',
  displayName: 'Generic HID Reader',
  transports: [{ kind: 'ble-hid', params: {} }],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /hid/i },
  streaming: false,
};
const SPP_AND_HID_DRIVER: ReaderDriver = {
  vendorId: 'dual-spp-hid',
  displayName: 'Dual SPP+HID Reader',
  transports: [
    { kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '1234' } },
    { kind: 'ble-hid', params: {} },
  ],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /dual/i },
  streaming: true,
};
const MFI_ONLY_DRIVER: ReaderDriver = {
  vendorId: 'mfi-only',
  displayName: 'MFi-only Reader',
  transports: [{ kind: 'mfi', params: { protocolString: 'com.example.reader' } }],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /mfi/i },
  streaming: true,
};

const ALL_BUILT = [
  'manual',
  'mock',
  'web-serial',
  'spp-android',
  'ble-gatt',
  'mfi-ios',
  'hid-wedge',
  'simulator',
] as const;

/**
 * Lo que el build REAL construye hoy: sin `hid-wedge` (gate de R8.7) ni `mfi-ios` (su adapter es F5).
 *
 * Es un ESPEJO de `BUILT_ADAPTERS` de `StickConnectionScreen.tsx` —que es un `.tsx` y no se puede importar
 * desde node:test—, y un espejo que puede driftar no prueba nada: el conjunto completo está fijado en
 * `wiring.test.ts` ("la pantalla pasa la lista REAL de protocolos declarados"), así que un kind que entre o
 * salga de la pantalla pone eso en rojo.
 */
const BUILT_TODAY = ['manual', 'mock', 'web-serial', 'spp-android', 'ble-gatt', 'simulator'] as const;

/** Cadena SINTÉTICA (RBM4.6: no se inventa la de ningún fabricante real). */
const SYNTHETIC_PROTOCOL = 'com.ejemplo.lector-sintetico';

function env(
  platformOS: string,
  driver: ReaderDriver,
  builtAdapters: readonly string[] = ALL_BUILT,
  declaredEaProtocols: readonly string[] = [],
): BindingEnv {
  return {
    platformOS,
    driver,
    builtAdapters: [...builtAdapters] as BindingEnv['builtAdapters'],
    declaredEaProtocols,
  };
}

/** El RS420 + un transporte MFi SINTÉTICO: el driver del "día que llegue la cadena" (RBM4.7). */
const RS420_WITH_MFI: ReaderDriver = {
  ...RS420_DRIVER,
  transports: [...RS420_DRIVER.transports, { kind: 'mfi', params: { protocolString: SYNTHETIC_PROTOCOL } }],
};

/** Un lector que habla los DOS transportes nuevos de iOS: el caso de la ambigüedad de la prioridad. */
const GATT_AND_MFI_DRIVER: ReaderDriver = {
  vendorId: 'gatt-y-mfi',
  displayName: 'Lector sintético GATT + MFi',
  transports: [
    { kind: 'ble-gatt', params: { serviceUuid: 'FFE0', notifyCharUuid: 'FFE1' } },
    { kind: 'mfi', params: { protocolString: SYNTHETIC_PROTOCOL } },
  ],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /gatt-y-mfi/i },
  streaming: true,
};

/** Proyección del binding SIN el `driver` (que se asierra por IDENTIDAD, más fuerte que un deepEqual). */
function shape(b: ReaderBinding | null) {
  if (b === null) return null;
  return {
    adapterKind: b.adapterKind,
    transportKind: b.transportKind,
    available: b.available,
    ...(b.unavailableReason ? { unavailableReason: b.unavailableReason } : {}),
  };
}

// ─── RMV2.1 → RBM5.1/RBM5.4: tabla de prioridad por plataforma, determinística ───────────────

test('RBM5.1: la prioridad de iOS pasa a MFi > GATT > HID (era HID > GATT > MFi)', () => {
  // El orden lo fijó el contexto aprobado del delta y el motivo está escrito en RBM5.1: con la cadena de
  // protocolo, MFi es un stream nativo del lector que el cliente YA TIENE y no depende de que el operario
  // tenga un campo enfocado; HID queda último porque secuestra el teclado del SO y sigue gateado.
  assert.deepEqual(platformTransportPriority('ios'), ['mfi', 'ble-gatt', 'ble-hid']);
});

test('RBM5.4: la prioridad de Android y de web NO cambia (regresión del delta multivendor)', () => {
  assert.deepEqual(platformTransportPriority('android'), ['spp', 'ble-gatt', 'ble-hid']);
  assert.deepEqual(platformTransportPriority('web'), ['serial']);
  assert.deepEqual(platformTransportPriority('otro'), []);
});

test('RMV2.1/RBM5.8: la prioridad es una TABLA FIJA — dos llamadas dan la misma lista (determinismo)', () => {
  for (const os of ['ios', 'android', 'web', 'otro']) {
    assert.deepEqual(platformTransportPriority(os), platformTransportPriority(os));
  }
  // Y cada lista es de transportes CONOCIDOS: un typo en la tabla (`'ble_gatt'`) no lo caza el tipo si
  // alguien la escribe con un cast, y produciría un transporte que ningún driver declara → binding null.
  for (const os of ['ios', 'android', 'web']) {
    for (const t of platformTransportPriority(os)) {
      assert.ok((TRANSPORT_KINDS as readonly string[]).includes(t), `'${t}' no es un TransportKind`);
    }
  }
});

// ─── RMV2.2 → RBM5.2/RBM5.3: mapeo (transporte, plataforma) → AdapterKind ─────────────────────

test('RMV2.2: adapterForTransport mapea spp+android→spp-android, serial+web→web-serial, ble-hid→hid-wedge', () => {
  assert.equal(adapterForTransport('spp', 'android'), 'spp-android');
  assert.equal(adapterForTransport('spp', 'ios'), null); // no hay SPP adapter en iOS
  assert.equal(adapterForTransport('serial', 'web'), 'web-serial');
  assert.equal(adapterForTransport('serial', 'android'), null);
  assert.equal(adapterForTransport('ble-hid', 'ios'), 'hid-wedge');
  assert.equal(adapterForTransport('ble-hid', 'android'), 'hid-wedge');
});

test('RBM5.2/RBM5.3: ble-gatt mapea en iOS Y Android, mfi SOLO en iOS, spp SOLO en Android', () => {
  // ── ESTE TEST REEMPLAZA a `RMV6.2/6.3: ble-gatt y mfi no tienen adapter buildable (null)` ──────────
  // Lo autoriza **RBM5.2** ("mapear el transporte `ble-gatt` al AdapterKind 'ble-gatt' en iOS y en
  // Android, y el transporte `mfi` a 'mfi-ios' solo en iOS") y **RBM7.1**, que declara que RMV6.2/RMV6.3
  // "dejan de ser fuera de este delta". No es el test el que se acomodó al código: es el requisito el que
  // cambió, y el test viejo era la afirmación de que estos dos transportes NO existían todavía.
  assert.equal(adapterForTransport('ble-gatt', 'ios'), 'ble-gatt');
  assert.equal(adapterForTransport('ble-gatt', 'android'), 'ble-gatt');
  assert.equal(adapterForTransport('mfi', 'ios'), 'mfi-ios');

  // Y las tres mitades FAIL-CLOSED del mapeo, que son la parte que un `return 'ble-gatt'` suelto rompería:
  //   · `ble-gatt` en web → null: `react-native-ble-plx` no tiene implementación web, así que mapearlo
  //     dejaría que un `adapterKind:'ble-gatt'` viejo en localStorage (la preferencia de RBM5.6) montara
  //     un transporte que en web no puede existir;
  //   · `mfi` fuera de iOS → null (RBM5.2: "fuera de iOS, null");
  //   · `spp` fuera de Android → null (RBM5.3): el SPP no se ofrece en iOS ni como binding no disponible.
  assert.equal(adapterForTransport('ble-gatt', 'web'), null);
  assert.equal(adapterForTransport('ble-gatt', 'macos'), null);
  assert.equal(adapterForTransport('mfi', 'android'), null);
  assert.equal(adapterForTransport('mfi', 'web'), null);
  assert.equal(adapterForTransport('spp', 'web'), null);
});

test('RBM5.2: `isAdapterUsableOn` se DERIVA del mapeo (una sola tabla) y no de una segunda copia', () => {
  // Es el gate que decide si la preferencia del bastón recordado se honra (RBM5.6), así que si divergiera
  // de `adapterForTransport` montaría en iOS un transporte que iOS no tiene, o le negaría a Android el
  // suyo. Se verifica DERIVANDO lo esperado del mapeo, no repitiéndolo a mano.
  for (const os of ['ios', 'android', 'web', 'macos']) {
    const alcanzables = new Set(
      TRANSPORT_KINDS.map((t) => adapterForTransport(t, os)).filter((k): k is AdapterKind => k != null),
    );
    for (const kind of ADAPTER_KINDS) {
      assert.equal(
        isAdapterUsableOn(kind, os),
        alcanzables.has(kind),
        `${kind} en ${os}: isAdapterUsableOn no coincide con adapterForTransport`,
      );
    }
  }
  // Los casos concretos que importan, escritos igual (si la derivación de arriba se rompiera por un
  // TRANSPORT_KINDS vacío, estos siguen siendo el oráculo):
  assert.equal(isAdapterUsableOn('ble-gatt', 'ios'), true);
  assert.equal(isAdapterUsableOn('ble-gatt', 'android'), true);
  assert.equal(isAdapterUsableOn('ble-gatt', 'web'), false);
  assert.equal(isAdapterUsableOn('spp-android', 'ios'), false);
  assert.equal(isAdapterUsableOn('mfi-ios', 'android'), false);
  // Y los kinds que NO son transportes de ningún driver nunca son "usables" por preferencia.
  for (const kind of ['manual', 'mock', 'simulator'] as const) {
    for (const os of ['ios', 'android', 'web']) {
      assert.equal(isAdapterUsableOn(kind, os), false, `${kind} no es un transporte elegible`);
    }
  }
});

// ─── RMV2.3/2.4: selectReaderBinding elige el transporte de mayor prioridad + available ──────

test('RMV2.3/2.4: RS420 en android → {spp-android, spp}; available desde builtAdapters', () => {
  const built = selectReaderBinding(env('android', RS420_DRIVER, ALL_BUILT));
  assert.deepEqual(built, { adapterKind: 'spp-android', transportKind: 'spp', driver: RS420_DRIVER, available: true });
  // Sin el spp-android construido (sin dev build) → available:false, MISMO adapter y MISMO transporte
  // (RBM5.4: la prioridad de Android no cambia con el delta), más el MOTIVO explícito que agrega RBM4.5.
  const notBuilt = selectReaderBinding(env('android', RS420_DRIVER, ['manual', 'mock', 'web-serial']));
  assert.deepEqual(notBuilt, {
    adapterKind: 'spp-android',
    transportKind: 'spp',
    driver: RS420_DRIVER,
    available: false,
    unavailableReason: 'adapter-no-construido',
  });
});

test('RMV2.3: RS420 en web → {web-serial, serial, available:true}', () => {
  const b = selectReaderBinding(env('web', RS420_DRIVER, ALL_BUILT));
  assert.deepEqual(b, { adapterKind: 'web-serial', transportKind: 'serial', driver: RS420_DRIVER, available: true });
});

// ─── RMV2.5: RS420 en iOS → null (declara solo spp+serial; ninguno mapeado en iOS) ──────────

test('RMV2.5: RS420 en iOS → null (spp/serial sin adapter en iOS → no alcanzable → carga manual)', () => {
  // NO cambia con el delta y es el caso más importante de la tabla: el RS420 no habla ni GATT ni MFi
  // (RBM4.6 — su cadena de protocolo no la tenemos), así que en iOS sigue sin ser alcanzable. Que el PISO
  // de iOS pase a `ble-gatt` (RBM5.6) es otra decisión y no toca esto: el binding es del LECTOR.
  assert.equal(selectReaderBinding(env('ios', RS420_DRIVER, ALL_BUILT)), null);
});

// ─── RMV2.2/2.4: driver HID genérico → hid-wedge, GATED (available:false) ────────────────────

test('RMV2.2/2.4: driver HID genérico en iOS → {hid-wedge, ble-hid, available:false} (HID gated)', () => {
  // hid-wedge NO está en builtAdapters (GATED en el core R8.7) → available:false. El `adapterKind` y el
  // `transportKind` son los de antes del delta: la prioridad de iOS cambió (RBM5.1) pero un driver que
  // declara SOLO `ble-hid` no puede resolver a otro transporte, así que el orden no lo afecta. Lo único
  // nuevo es el `unavailableReason` (RBM4.5).
  const built = ['manual', 'mock', 'web-serial', 'spp-android', 'simulator'];
  assert.deepEqual(selectReaderBinding(env('ios', HID_DRIVER, built)), {
    adapterKind: 'hid-wedge',
    transportKind: 'ble-hid',
    driver: HID_DRIVER,
    available: false,
    unavailableReason: 'adapter-no-construido',
  });
});

test('RMV2.2/2.4: driver solo-HID en android → {hid-wedge, ble-hid, available:false}', () => {
  const built = ['manual', 'mock', 'web-serial', 'spp-android', 'simulator'];
  assert.deepEqual(selectReaderBinding(env('android', HID_DRIVER, built)), {
    adapterKind: 'hid-wedge',
    transportKind: 'ble-hid',
    driver: HID_DRIVER,
    available: false,
    unavailableReason: 'adapter-no-construido',
  });
});

// ─── RMV2.8: ambigüedad (device alcanzable por >1 vía) → prioridad determinística ───────────

test('RMV2.8: driver SPP+HID en android → spp gana (prioridad determinística, no orden de descubrimiento)', () => {
  const b = selectReaderBinding(env('android', SPP_AND_HID_DRIVER, ALL_BUILT));
  assert.equal(b?.transportKind, 'spp');
  assert.equal(b?.adapterKind, 'spp-android');
});

test('RMV2.8: el MISMO driver SPP+HID en iOS → HID (spp no mapea en iOS) — determinístico por plataforma', () => {
  const built = ['manual', 'mock', 'web-serial', 'spp-android', 'simulator'];
  const b = selectReaderBinding(env('ios', SPP_AND_HID_DRIVER, built));
  assert.equal(b?.transportKind, 'ble-hid');
  assert.equal(b?.adapterKind, 'hid-wedge');
  assert.equal(b?.available, false);
});

// ─── RMV2.5: driver sin transporte alcanzable en la plataforma → null ───────────────────────

test('RMV2.5: driver SPP-only en web → null (web solo tiene serial); en iOS → null', () => {
  const SPP_ONLY: ReaderDriver = {
    ...RS420_DRIVER,
    transports: [{ kind: 'spp', params: { sppUuid: '0000abcd-0000-1000-8000-00805f9b34fb', pin: '1234' } }],
  };
  assert.equal(selectReaderBinding(env('web', SPP_ONLY, ALL_BUILT)), null);
  assert.equal(selectReaderBinding(env('ios', SPP_ONLY, ALL_BUILT)), null);
});

// ─── RBM4.4/RBM4.5/RBM5.5: el binding de MFi (lo que F4 cablea) ──────────────────────────────

test('RBM4.4/RBM4.5/RBM5.5: driver mfi-only en iOS → binding mfi-ios (ya NO null) con su motivo', () => {
  // ── ESTE TEST REEMPLAZA a `RMV6.1/6.2: driver mfi-only en iOS → adapter null → binding null` ───────
  // Lo autoriza **RBM4.4** (con el protocolo declarado el binding resuelve DISPONIBLE), **RBM4.5** (sin
  // él, `available:false` con motivo explícito) y **RBM5.5** (el `available` de `mfi-ios` es la
  // conjunción de "construido" ∧ "protocolo declarado"). RMV6.1/6.2 decían que MFi era arquitectura sin
  // adapter mapeado; **RBM7.1** cierra eso explícitamente.
  const b = selectReaderBinding(env('ios', MFI_ONLY_DRIVER, ALL_BUILT, []));
  assert.deepEqual(shape(b), {
    adapterKind: 'mfi-ios',
    transportKind: 'mfi',
    available: false,
    unavailableReason: 'build-sin-protocolos',
  });
  assert.equal(b?.driver, MFI_ONLY_DRIVER, 'el binding tiene que viajar con SU driver');
  // Y fuera de iOS sigue sin existir (RBM5.2): el mismo driver en Android/web no es alcanzable.
  assert.equal(selectReaderBinding(env('android', MFI_ONLY_DRIVER, ALL_BUILT, [])), null);
  assert.equal(selectReaderBinding(env('web', MFI_ONLY_DRIVER, ALL_BUILT, [])), null);
});

test('RBM5.5: el `available` de mfi-ios es una CONJUNCIÓN — falla cualquiera de las dos mitades', () => {
  const conProtocolo = [SYNTHETIC_PROTOCOL];
  // (a) construido ∧ declarado → disponible.
  assert.deepEqual(shape(selectReaderBinding(env('ios', RS420_WITH_MFI, ALL_BUILT, conProtocolo))), {
    adapterKind: 'mfi-ios',
    transportKind: 'mfi',
    available: true,
  });
  // (b) construido ∧ NO declarado → 'build-sin-protocolos' / 'protocolo-no-declarado'.
  assert.equal(
    shape(selectReaderBinding(env('ios', RS420_WITH_MFI, ALL_BUILT, [])))?.unavailableReason,
    'build-sin-protocolos',
  );
  assert.equal(
    shape(selectReaderBinding(env('ios', RS420_WITH_MFI, ALL_BUILT, ['com.otra.cosa'])))?.unavailableReason,
    'protocolo-no-declarado',
  );
  // (c) NO construido ∧ declarado → 'adapter-no-construido'. El ORDEN del chequeo es "construido
  // primero" y es la parte falsificable: si el adapter no existe en este build, el estado del plist es
  // irrelevante y decir "falta el protocolo" mandaría a buscar el dato equivocado.
  assert.deepEqual(shape(selectReaderBinding(env('ios', RS420_WITH_MFI, BUILT_TODAY, conProtocolo))), {
    adapterKind: 'mfi-ios',
    transportKind: 'mfi',
    available: false,
    unavailableReason: 'adapter-no-construido',
  });
  // (d) ninguna de las dos → sigue siendo 'adapter-no-construido' (el mismo orden).
  assert.equal(
    shape(selectReaderBinding(env('ios', RS420_WITH_MFI, BUILT_TODAY, [])))?.unavailableReason,
    'adapter-no-construido',
  );
});

test('RBM4.6: el RS420 REAL sigue sin declarar mfi → en iOS su binding es null, no un MFi fantasma', () => {
  // Anti-vacuidad de los dos tests de arriba: los ejercen con `RS420_WITH_MFI`, que es un FIXTURE. Si
  // alguien le inventara la `protocolString` al driver real "para destrabar iOS", el binding del RS420 en
  // iOS pasaría a ser un `mfi-ios` y este test cae — que es el punto (RBM4.6: la cadena la entrega el
  // fabricante).
  assert.equal(
    RS420_DRIVER.transports.some((t) => t.kind === 'mfi'),
    false,
  );
  assert.equal(selectReaderBinding(env('ios', RS420_DRIVER, ALL_BUILT, [SYNTHETIC_PROTOCOL])), null);
});

// ─── La TABLA del design §6.1, entera y en un solo lugar ─────────────────────────────────────

interface TablaCaso {
  fila: string;
  driver: ReaderDriver;
  platformOS: string;
  built: readonly string[];
  declarados: readonly string[];
  esperado: ReturnType<typeof shape>;
}

const TABLA_6_1: TablaCaso[] = [
  {
    fila: 'RS420 (spp+serial) | ios → null (su vía real es MFi cuando llegue la cadena)',
    driver: RS420_DRIVER,
    platformOS: 'ios',
    built: ALL_BUILT,
    declarados: [],
    esperado: null,
  },
  {
    fila: 'RS420 | android → {spp-android, spp, available:true} (regresión)',
    driver: RS420_DRIVER,
    platformOS: 'android',
    built: ALL_BUILT,
    declarados: [],
    esperado: { adapterKind: 'spp-android', transportKind: 'spp', available: true },
  },
  {
    fila: 'RS420 | web → {web-serial, serial, available:true} (regresión)',
    driver: RS420_DRIVER,
    platformOS: 'web',
    built: ALL_BUILT,
    declarados: [],
    esperado: { adapterKind: 'web-serial', transportKind: 'serial', available: true },
  },
  {
    fila: 'RS420 + mfi sintético, build SIN protocolos | ios → build-sin-protocolos',
    driver: RS420_WITH_MFI,
    platformOS: 'ios',
    built: ALL_BUILT,
    declarados: [],
    esperado: {
      adapterKind: 'mfi-ios',
      transportKind: 'mfi',
      available: false,
      unavailableReason: 'build-sin-protocolos',
    },
  },
  {
    fila: 'RS420 + mfi sintético, build CON esa cadena | ios → available (el test de RBM4.7)',
    driver: RS420_WITH_MFI,
    platformOS: 'ios',
    built: ALL_BUILT,
    declarados: [SYNTHETIC_PROTOCOL],
    esperado: { adapterKind: 'mfi-ios', transportKind: 'mfi', available: true },
  },
  {
    fila: 'emulador GATT | ios → {ble-gatt, ble-gatt, available:true}',
    driver: ESP32_GATT_DRIVER,
    platformOS: 'ios',
    built: BUILT_TODAY,
    declarados: [],
    esperado: { adapterKind: 'ble-gatt', transportKind: 'ble-gatt', available: true },
  },
  {
    fila: 'emulador GATT | android → {ble-gatt, ble-gatt, available:true}',
    driver: ESP32_GATT_DRIVER,
    platformOS: 'android',
    built: BUILT_TODAY,
    declarados: [],
    esperado: { adapterKind: 'ble-gatt', transportKind: 'ble-gatt', available: true },
  },
  {
    fila: 'driver HID genérico | ios → {hid-wedge, ble-hid, available:false} mientras el gate no pase',
    driver: HID_DRIVER,
    platformOS: 'ios',
    built: BUILT_TODAY,
    declarados: [],
    esperado: {
      adapterKind: 'hid-wedge',
      transportKind: 'ble-hid',
      available: false,
      unavailableReason: 'adapter-no-construido',
    },
  },
  {
    fila: 'driver ble-gatt+mfi, build con protocolo | ios → mfi GANA (prioridad)',
    driver: GATT_AND_MFI_DRIVER,
    platformOS: 'ios',
    built: ALL_BUILT,
    declarados: [SYNTHETIC_PROTOCOL],
    esperado: { adapterKind: 'mfi-ios', transportKind: 'mfi', available: true },
  },
];

test('RBM5.1–RBM5.5: la tabla del design §6.1, fila por fila', () => {
  assert.equal(TABLA_6_1.length, 9, 'la tabla del design §6.1 tiene NUEVE filas');
  for (const caso of TABLA_6_1) {
    const b = selectReaderBinding(env(caso.platformOS, caso.driver, caso.built, caso.declarados));
    assert.deepEqual(shape(b), caso.esperado, caso.fila);
    if (b !== null) assert.equal(b.driver, caso.driver, `${caso.fila}: el binding tiene que traer SU driver`);
  }
});

test('RBM5.8: la tabla del design §6.1 es DETERMINÍSTICA y no depende del orden de declaración', () => {
  // Dos veces las mismas entradas → el mismo binding (y la segunda no la contamina la primera: la
  // función no guarda estado).
  for (const caso of TABLA_6_1) {
    const a = selectReaderBinding(env(caso.platformOS, caso.driver, caso.built, caso.declarados));
    const b = selectReaderBinding(env(caso.platformOS, caso.driver, caso.built, caso.declarados));
    assert.deepEqual(shape(a), shape(b), caso.fila);
  }
  // Y lo que RMV2.8/RBM5.8 compran de verdad: **el orden en que el driver declara sus transportes no
  // cambia el resultado**. Es el mutante interesante de este archivo — un motor que recorriera
  // `driver.transports` en vez de la tabla de prioridad daría `ble-gatt` acá y `mfi` con el otro orden.
  const alRevés: ReaderDriver = {
    ...GATT_AND_MFI_DRIVER,
    transports: [...GATT_AND_MFI_DRIVER.transports].reverse(),
  };
  assert.deepEqual(
    GATT_AND_MFI_DRIVER.transports.map((t) => t.kind),
    ['ble-gatt', 'mfi'],
    'anti-vacuidad: el fixture tiene que declarar el transporte de MENOR prioridad PRIMERO',
  );
  for (const d of [GATT_AND_MFI_DRIVER, alRevés]) {
    assert.deepEqual(shape(selectReaderBinding(env('ios', d, ALL_BUILT, [SYNTHETIC_PROTOCOL]))), {
      adapterKind: 'mfi-ios',
      transportKind: 'mfi',
      available: true,
    });
  }
  // El mismo driver en Android: MFi no mapea, así que gana GATT (y sigue siendo la tabla, no el orden).
  for (const d of [GATT_AND_MFI_DRIVER, alRevés]) {
    assert.deepEqual(shape(selectReaderBinding(env('android', d, ALL_BUILT, [SYNTHETIC_PROTOCOL]))), {
      adapterKind: 'ble-gatt',
      transportKind: 'ble-gatt',
      available: true,
    });
  }
});

test('RBM4.5: TODO binding no disponible trae su motivo, y TODO disponible NO lo trae', () => {
  // El invariante de forma que los `deepEqual` de arriba fijan de a uno. Sin esto, una rama nueva de
  // `selectReaderBinding` podría devolver `available:false` SIN motivo y la UI mostraría el copy genérico
  // ("todavía no lo soportamos") sobre un bastón al que solo le falta la autorización del fabricante —
  // que es exactamente lo que RBM5.14 vino a impedir. Se recorre la matriz completa, no un caso elegido.
  const drivers = [
    RS420_DRIVER,
    RS420_WITH_MFI,
    MFI_ONLY_DRIVER,
    HID_DRIVER,
    SPP_AND_HID_DRIVER,
    GATT_AND_MFI_DRIVER,
    ESP32_GATT_DRIVER,
  ];
  let vistosFalse = 0;
  let vistosTrue = 0;
  for (const driver of drivers) {
    for (const platformOS of ['ios', 'android', 'web', 'macos']) {
      for (const built of [ALL_BUILT, BUILT_TODAY, [] as readonly string[]]) {
        for (const declarados of [[], [SYNTHETIC_PROTOCOL]]) {
          const b = selectReaderBinding(env(platformOS, driver, built, declarados));
          if (b === null) continue;
          const dónde = `${driver.vendorId}/${platformOS}/built:${built.length}/decl:${declarados.length}`;
          if (b.available) {
            vistosTrue++;
            assert.equal(b.unavailableReason, undefined, `${dónde}: disponible NO puede traer motivo`);
          } else {
            vistosFalse++;
            assert.ok(b.unavailableReason, `${dónde}: available:false SIN motivo`);
          }
        }
      }
    }
  }
  // Anti-vacuidad: la matriz tiene que haber producido bindings de los DOS signos (si un cambio dejara
  // todo `null`, el bucle no asertaría nada y el test pasaría vacío).
  assert.ok(vistosTrue > 0 && vistosFalse > 0, `la matriz no ejercitó los dos signos: ${vistosTrue}/${vistosFalse}`);
});

// ─── RMV2.6: determinismo — dos runs con las mismas entradas dan el mismo binding ───────────

test('RMV2.6: selectReaderBinding es determinístico (mismas entradas → mismo binding)', () => {
  const a = selectReaderBinding(env('android', RS420_DRIVER, ALL_BUILT));
  const b = selectReaderBinding(env('android', RS420_DRIVER, ALL_BUILT));
  assert.deepEqual(a, b);
});

// ─── RBM5.9: REGRESIÓN de selectTransportAdapter — lo que el delta NO puede cambiar ──────────

test('RBM5.9 regresión: mock/manual/demo y auto en Android/web → EXACTAMENTE lo de antes del delta', () => {
  // RBM5.9 congela cuatro cosas y esta es la mitad que **no se toca**: los tres modos y el `auto` de
  // Android y de web SIN preferencia recordada. Las ~70 specs E2E corren en `mock`.
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'auto' }), 'web-serial');
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'manual' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'manual' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'manual' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'demo' }), 'simulator');
  // auto en Android → spp-android (Fase 4 construida 2026-07-29; ANTES devolvía 'manual'). **Esto es lo
  // que la sospecha de regresión de RBM5.4/RBM5.9 vigila**: el piso de Android no lo tocó el delta.
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'auto' }), 'spp-android');
  // Y una plataforma sin transporte sigue en el piso manual (RBM5.10).
  assert.equal(selectTransportAdapter({ platformOS: 'macos', mode: 'auto' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'otro', mode: 'auto' }), 'manual');
});

test('RBM5.6: el PISO de iOS pasa de "manual" a "ble-gatt" (lo único de auto que RBM5.9 NO congela)', () => {
  // ── ESTE ES EL CAMBIO, Y ESTÁ AUTORIZADO POR ESCRITO ──────────────────────────────────────────────
  // RBM5.9 congela `auto` "en Android y en web": iOS queda deliberadamente afuera. Y el design §6.2 lo
  // dice literal: *"iOS pasa de 'manual' a 'ble-gatt' como piso: es el único transporte que iOS tiene, y
  // si el módulo nativo no está en el build, `instantiateTransport` devuelve null y la app queda
  // manual-first exactamente como hoy"*. O sea: la SELECCIÓN elige el kind, la INSTANCIACIÓN decide si se
  // puede montar — y el piso manual (R7) no depende de ninguna de las dos (el `ManualAdapter` del
  // provider está siempre montado).
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'auto' }), 'ble-gatt');
  // Lo que NO cambia: en iOS el resto de los modos sigue igual (arriba) y `macos` no se contagia.
  assert.equal(selectTransportAdapter({ platformOS: 'macos', mode: 'auto' }), 'manual');
});

// ─── RBM5.6/RBM5.7: el transporte montado sigue al BASTÓN RECORDADO ──────────────────────────

test('RBM5.6: la preferencia del bastón recordado le gana al piso por plataforma', () => {
  // El problema real que esto arregla (design §6.2): en Android el piso es SIEMPRE `spp-android`, así que
  // con un lector BLE el transporte que la app monta es el del RS420 → **el BLE queda inalcanzable en
  // producción justo donde está el productor argentino**, y el banco de F6 en Android tampoco podría
  // correr el camino real.
  assert.equal(
    selectTransportAdapter({ platformOS: 'android', mode: 'auto', preferredAdapter: 'ble-gatt' }),
    'ble-gatt',
  );
  // Y la simétrica: un iPhone con preferencia... no tiene otra opción hoy, pero el piso coincide.
  assert.equal(
    selectTransportAdapter({ platformOS: 'ios', mode: 'auto', preferredAdapter: 'ble-gatt' }),
    'ble-gatt',
  );
});

test('RBM5.7: sin preferencia (o con una del formato viejo) se cae al piso por plataforma', () => {
  // `undefined` es exactamente lo que devuelve la hidratación cuando el registro está en el formato viejo
  // (un id pelado, sin `adapterKind`) o cuando todavía no resolvió: el piso por plataforma, sin romper.
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'auto', preferredAdapter: undefined }), 'spp-android');
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'auto', preferredAdapter: undefined }), 'ble-gatt');
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'auto', preferredAdapter: undefined }), 'web-serial');
});

test('RBM5.6 fail-closed: una preferencia que NO puede existir en esta plataforma se ignora', () => {
  // Un registro escrito en Android y restaurado en un backup de iOS (o storage manoseado) no puede
  // montar `spp-android` en iOS: sería un transporte imposible y dejaría al operario SIN transporte, en
  // silencio. Se cae al piso, que es la conducta ya probada.
  assert.equal(
    selectTransportAdapter({ platformOS: 'ios', mode: 'auto', preferredAdapter: 'spp-android' }),
    'ble-gatt',
  );
  assert.equal(
    selectTransportAdapter({ platformOS: 'android', mode: 'auto', preferredAdapter: 'web-serial' }),
    'spp-android',
  );
  assert.equal(
    selectTransportAdapter({ platformOS: 'web', mode: 'auto', preferredAdapter: 'ble-gatt' }),
    'web-serial',
  );
  // Y los kinds que no son transportes de ningún driver tampoco se honran (los filtra `isAdapterUsableOn`).
  for (const kind of ['manual', 'mock', 'simulator'] as const) {
    assert.equal(
      selectTransportAdapter({ platformOS: 'android', mode: 'auto', preferredAdapter: kind }),
      'spp-android',
      `'${kind}' no es un transporte elegible por preferencia`,
    );
  }
});

test('R8.7/RBM5.6: una preferencia `hid-wedge` NUNCA se honra (el gate físico sigue abierto)', () => {
  // El camino más peligroso que abre RBM5.6: la preferencia es **la primera entrada por la que un valor de
  // STORAGE puede elegir un AdapterKind**. Sin el gate explícito, un registro con `adapterKind:'hid-wedge'`
  // (storage manoseado, o un downgrade después de que F7 exista) le saca a Android su `spp-android` y lo
  // deja sin transporte, en silencio. El invariante "nunca se elige hid-wedge" dejó de ser cierto "porque
  // ninguna rama lo escribe".
  for (const platformOS of ['ios', 'android', 'web', 'macos']) {
    for (const mode of ['auto', 'mock', 'manual', 'demo'] as const) {
      assert.notEqual(
        selectTransportAdapter({ platformOS, mode, preferredAdapter: 'hid-wedge' }),
        'hid-wedge',
        `${platformOS}/${mode}: hid-wedge sigue GATEADO (R8.7)`,
      );
    }
  }
  // Y en Android la consecuencia concreta: se cae al piso, NO se queda sin transporte.
  assert.equal(
    selectTransportAdapter({ platformOS: 'android', mode: 'auto', preferredAdapter: 'hid-wedge' }),
    'spp-android',
  );
});

test('RBM5.9: la preferencia NO puede cambiar mock/manual/demo — el ORDEN de las ramas es contrato', () => {
  // Las ~70 specs E2E corren en `mock`; si la preferencia se chequeara ANTES, un `localStorage` con
  // `adapterKind:'ble-gatt'` montaría el transporte BLE en medio de la suite. Se recorre TODO el union de
  // `AdapterKind` como preferencia, no un valor elegido.
  for (const preferredAdapter of ADAPTER_KINDS) {
    for (const platformOS of ['ios', 'android', 'web']) {
      assert.equal(selectTransportAdapter({ platformOS, mode: 'mock', preferredAdapter }), 'mock');
      assert.equal(selectTransportAdapter({ platformOS, mode: 'manual', preferredAdapter }), 'manual');
      assert.equal(selectTransportAdapter({ platformOS, mode: 'demo', preferredAdapter }), 'simulator');
    }
  }
});

test('RBM5.8: `selectTransportAdapter` es determinístico sobre TODA la matriz de entradas', () => {
  const preferencias: (AdapterKind | undefined)[] = [undefined, ...ADAPTER_KINDS];
  for (const platformOS of ['ios', 'android', 'web', 'macos']) {
    for (const mode of ['auto', 'mock', 'manual', 'demo'] as const) {
      for (const preferredAdapter of preferencias) {
        const a = selectTransportAdapter({ platformOS, mode, preferredAdapter });
        const b = selectTransportAdapter({ platformOS, mode, preferredAdapter });
        assert.equal(a, b, `${platformOS}/${mode}/${preferredAdapter}`);
        assert.ok(
          (ADAPTER_KINDS as readonly string[]).includes(a),
          `${a} no es un AdapterKind conocido`,
        );
      }
    }
  }
});

test('RMV4.3 (triple-guard 1): selectTransportAdapter NUNCA devuelve simulator salvo mode=demo', () => {
  for (const platformOS of ['web', 'ios', 'android', 'otro']) {
    for (const mode of ['auto', 'mock', 'manual'] as const) {
      assert.notEqual(selectTransportAdapter({ platformOS, mode }), 'simulator');
      // Y tampoco con la preferencia puesta: `'simulator'` no es un transporte de ningún driver, así que
      // `isAdapterUsableOn` lo rechaza. Si alguien lo agregara a un `TransportKind`, este test cae.
      assert.notEqual(
        selectTransportAdapter({ platformOS, mode, preferredAdapter: 'simulator' }),
        'simulator',
      );
    }
    // solo mode='demo' → 'simulator'
    assert.equal(selectTransportAdapter({ platformOS, mode: 'demo' }), 'simulator');
  }
});

// ─── 🟡-1 del review de F4: un kind que este build NO PUEDE CONSTRUIR no se honra como preferencia ──

test('RBM5.6 fail-closed: una preferencia `mfi-ios` no se honra hasta que F5 construya su adapter', () => {
  // Es el MISMO escenario con el que se justificó gatear `hid-wedge`, y con fecha: `instantiateTransport`
  // devuelve `null` para `'mfi-ios'` (el adapter es F5), así que honrar esa preferencia le saca al iPhone el
  // `ble-gatt` que le corresponde por piso y lo deja **sin transporte, en silencio**. Y F5 **va a escribir**
  // ese `adapterKind`, así que el tratamiento asimétrico era una deuda con fecha, no una hipótesis.
  assert.equal(
    selectTransportAdapter({ platformOS: 'ios', mode: 'auto', preferredAdapter: 'mfi-ios' }),
    'ble-gatt',
    'la preferencia mfi-ios tiene que caer al piso de iOS, no dejar al operario sin transporte',
  );
  for (const platformOS of ['ios', 'android', 'web', 'macos']) {
    for (const mode of ['auto', 'mock', 'manual', 'demo'] as const) {
      assert.notEqual(
        selectTransportAdapter({ platformOS, mode, preferredAdapter: 'mfi-ios' }),
        'mfi-ios',
        `${platformOS}/${mode}: mfi-ios no se monta hasta que exista adapter-mfi-ios.ts (F5)`,
      );
    }
  }
});

// ─── 🟠-2 del review de F4: `transportChoices` — la ENTRADA por gesto a la preferencia ──────────────
//
// El bucle que esto abre: RBM5.6 monta el transporte del bastón recordado, y ese registro lo escribe el
// adapter AL CONECTAR. En Android eso no tenía entrada (para que la preferencia diga `ble-gatt` había que
// haber conectado por `ble-gatt`), así que el transporte BLE era **inalcanzable en producción justo en la
// plataforma donde está el productor** — el problema que RBM5.6 dice resolver — y el banco de F6/T6.2 no
// tenía con qué arrancar. Estas filas son la entrada.

function choicesEnv(over: Partial<TransportChoicesEnv> = {}): TransportChoicesEnv {
  return {
    platformOS: 'android',
    // El modo de PRODUCCIÓN. Los otros tres tienen su propio test (no ofrecen nada).
    mode: 'auto',
    builtAdapters: [...BUILT_TODAY] as AdapterKind[],
    declaredEaProtocols: [],
    canInstantiate: () => true,
    // El registro REAL por default: lo que la pantalla le pasa en producción. (Es requerido y sin default
    // en el módulo porque `adapter-selection.ts` es ciego al fabricante — RBM1.7.)
    registry: DRIVER_REGISTRY,
    ...over,
  };
}

/** `canInstantiate` que además REGISTRA a quién se le preguntó (para poder aserrar lo que NO se pregunta). */
function probe(answer: (kind: AdapterKind) => boolean = () => true) {
  const asked: AdapterKind[] = [];
  return {
    asked,
    canInstantiate: (kind: AdapterKind) => {
      asked.push(kind);
      return answer(kind);
    },
  };
}

test('RBM5.14/🟠-2: en Android con el SPP montado, el BLE se puede ELEGIR (la fila que destraba el banco)', () => {
  const p = probe();
  const choices = transportChoices(choicesEnv({ mountedKind: 'spp-android', canInstantiate: p.canInstantiate }));
  assert.equal(choices.length, 1, 'tiene que haber exactamente una alternativa: el transporte BLE');
  const [ble] = choices;
  assert.equal(ble.adapterKind, 'ble-gatt');
  assert.equal(ble.binding.transportKind, 'ble-gatt');
  assert.equal(ble.binding.available, true);
  assert.equal(ble.installable, true);
  // El lector de la fila es el que el adapter va a usar de verdad: el del registro que declara `ble-gatt`.
  // Se asierra por IDENTIDAD (no por nombre): una copia del driver no pasa.
  assert.equal(ble.driver, ESP32_GATT_DRIVER);
  // Y elegirla HACE algo: la selección honra esa preferencia (si no, la fila sería una afordancia muerta).
  assert.equal(
    selectTransportAdapter({ platformOS: 'android', mode: 'auto', preferredAdapter: ble.adapterKind }),
    'ble-gatt',
  );
  assert.deepEqual(p.asked, ['ble-gatt'], 'solo se pregunta por los transportes que se van a ofrecer');
});

test('RBM5.14/🟠-2: en Android con el BLE montado, el SPP se puede ELEGIR (la vuelta, o el RS420 se pierde)', () => {
  // La simétrica, y no es simetría por elegancia: desde RBM5.6, un teléfono que alguna vez conectó por BLE
  // monta `ble-gatt` para siempre. Sin esta fila, la única salida al RS420 sería "Olvidar el bastón
  // guardado" + reiniciar — o sea que la preferencia volvería a esconder su propia salida (R6.6).
  const choices = transportChoices(choicesEnv({ mountedKind: 'ble-gatt' }));
  assert.equal(choices.length, 1);
  assert.equal(choices[0].adapterKind, 'spp-android');
  assert.equal(choices[0].driver, RS420_DRIVER, 'el SPP habla con el RS420 (es el driver del adapter)');
  assert.equal(choices[0].binding.available, true);
});

test('RBM5.9/RBM5.3: en web y en iOS la lista de alternativas es VACÍA (cero cambios donde no hay qué elegir)', () => {
  // web: el único transporte de web es el montado → nada que ofrecer. Es lo que hace que esta banda no
  // cambie NADA de lo que ejercitan las ~70 specs E2E (y las capturas del Gate 2.5).
  const web = probe();
  assert.deepEqual(
    transportChoices(choicesEnv({ platformOS: 'web', mountedKind: 'web-serial', canInstantiate: web.canInstantiate })),
    [],
  );
  assert.deepEqual(web.asked, [], 'en web no se le pregunta por el módulo nativo de BLE a nadie');
  // iOS: el SPP no existe ahí (RBM5.3) y MFi está gateado hasta F5 → el BLE montado es todo lo que hay.
  assert.deepEqual(transportChoices(choicesEnv({ platformOS: 'ios', mountedKind: 'ble-gatt' })), []);
});

test('🟠-2: un transporte que la selección NO honraría no se ofrece (gateado o imposible en la plataforma)', () => {
  // Anti-afordancia-muerta, y el oráculo NO es una lista de kinds prohibidos: se DERIVA de
  // `selectTransportAdapter`. Con `mfi-ios` y `hid-wedge` declarados construidos, sus bindings salen
  // `available:true` y aun así no se ofrecen, porque montarlos no haría nada.
  const registry = [MFI_ONLY_DRIVER, HID_DRIVER];
  const conTodo = transportChoices(
    choicesEnv({ platformOS: 'ios', registry, builtAdapters: [...ALL_BUILT] as AdapterKind[] }),
  );
  assert.deepEqual(conTodo, [], 'mfi-ios y hid-wedge están gateados: ofrecerlos sería una fila que no monta nada');
  // Contraprueba de que el fixture SÍ produce bindings (si no, el test pasaría por vacuidad).
  assert.equal(
    selectReaderBinding(env('ios', MFI_ONLY_DRIVER, ALL_BUILT, ['com.example.reader']))?.available,
    true,
  );
  assert.equal(selectReaderBinding(env('ios', HID_DRIVER, ALL_BUILT))?.adapterKind, 'hid-wedge');
});

test('🟠-2: TODA alternativa ofrecida se monta de verdad si se la elige (invariante sobre la matriz)', () => {
  // El invariante que hace honesta a la lista, medido sobre todas las combinaciones plataforma × montado.
  let vistas = 0;
  for (const platformOS of ['ios', 'android', 'web', 'macos']) {
    for (const mountedKind of [undefined, ...ADAPTER_KINDS]) {
      for (const choice of transportChoices(choicesEnv({ platformOS, mountedKind }))) {
        vistas += 1;
        assert.equal(
          selectTransportAdapter({ platformOS, mode: 'auto', preferredAdapter: choice.adapterKind }),
          choice.adapterKind,
          `${platformOS}: se ofrece ${choice.adapterKind} pero la selección montaría otra cosa`,
        );
        assert.notEqual(choice.adapterKind, mountedKind, 'no se ofrece el que ya está montado');
        assert.equal(choice.binding.adapterKind, choice.adapterKind, 'la fila y el kind tienen que coincidir');
      }
    }
  }
  assert.ok(vistas > 0, 'ANTI-VACUIDAD: la matriz no produjo ni una alternativa (el invariante no probó nada)');
});

test('🟠-2: `installable:false` NO esconde la fila — la dice ("no disponible en esta versión")', () => {
  // Un APK sin el módulo nativo de BLE (dev build anterior a la dep) tiene el adapter compilado y no puede
  // montarlo. Esconder la fila dejaría al operario sin explicación de por qué su bastón BLE no aparece;
  // ofrecerla como tappable sería la afordancia muerta. La tercera opción —decirlo— es la que ya usa
  // `deviceRowView` para `recognized-unavailable` (RMV3.7).
  const choices = transportChoices(choicesEnv({ mountedKind: 'spp-android', canInstantiate: () => false }));
  assert.equal(choices.length, 1);
  assert.equal(choices[0].installable, false);
  assert.equal(choices[0].binding.available, true, 'el BUILD sí lo trae: son dos preguntas distintas');
});

test('RBM5.8/🟠-2: la lista es determinística y no repite un `AdapterKind` (aunque haya dos drivers)', () => {
  const a = transportChoices(choicesEnv({ mountedKind: 'spp-android' }));
  const b = transportChoices(choicesEnv({ mountedKind: 'spp-android' }));
  assert.deepEqual(
    a.map((c) => c.adapterKind),
    b.map((c) => c.adapterKind),
  );
  // Dos drivers declarando `ble-gatt`: UNA sola fila, con el PRIMERO del registro — la misma regla con la
  // que el adapter elige el suyo (`bleGattDriverFrom`). Dos filas prometerían un lector que no se va a usar.
  const segundoGatt: ReaderDriver = {
    ...ESP32_GATT_DRIVER,
    vendorId: 'otro-gatt',
    displayName: 'Otro lector GATT sintético',
  };
  const conDos = transportChoices(
    choicesEnv({ mountedKind: 'spp-android', registry: [...DRIVER_REGISTRY, segundoGatt] }),
  );
  assert.equal(conDos.length, 1);
  assert.equal(conDos[0].driver, ESP32_GATT_DRIVER);
});

test('RBM5.11/RBM5.12: la fila del transporte BLE dice que es un BANCO DE PRUEBAS (no un lector comercial)', () => {
  // Consecuencia visible de que el único driver `ble-gatt` del registro sea el del emulador: en Android,
  // debajo de los emparejados, aparece una fila que dice EXACTAMENTE lo que es. Es lo que RBM5.12 compró
  // (ADR-010: el ESP32 es test rig, no producto) y lo que hace posible el banco de F6 en la plataforma del
  // productor. El día que Gallagher entregue su doc, la MISMA fila dice su nombre sin código nuevo.
  const [ble] = transportChoices(choicesEnv({ mountedKind: 'spp-android' }));
  assert.match(ble.driver.displayName, /banco de pruebas/i);
  assert.equal(
    /gallagher|hr5/i.test(ble.driver.displayName),
    false,
    'RBM5.11: ningún lector comercial adivinado puede aparecer en esta fila',
  );
});

test('RBM5.9/🟠-2: en `mock`, `demo` y `manual` NO se ofrece NINGÚN transporte (lo encontró la E2E)', () => {
  // **Bug medido, no razonado**: la primera versión derivaba la oferta con `mode:'auto'` hardcodeado. En
  // `mock` —donde corren las ~70 specs E2E— el kind montado es `'mock'`, que NO es el piso de la
  // plataforma, así que el piso (`web-serial`) aparecía como "alternativa" y la pantalla renderizaba DOS
  // filas idénticas ("Allflex RS420 · Tocá para conectar"). Lo cazó la aserción del capture, no un test
  // puro: por eso ahora el modo es una entrada REQUERIDA y la oferta se deriva con él.
  //
  // Y el fondo es un invariante, no un detalle de la E2E: esos tres modos cortan ANTES de la preferencia
  // (RBM5.9), así que `chooseTransport` no puede montar nada → cualquier fila sería afordancia muerta.
  for (const mode of ['mock', 'demo', 'manual'] as const) {
    for (const platformOS of ['web', 'ios', 'android']) {
      for (const mountedKind of ['mock', 'simulator', 'manual', 'web-serial', undefined] as const) {
        assert.deepEqual(
          transportChoices(choicesEnv({ mode, platformOS, mountedKind })),
          [],
          `${platformOS}/${mode} (montado: ${mountedKind}) no puede ofrecer transportes: la selección los ignora`,
        );
      }
    }
  }
  // Contraprueba: el MISMO caso en `auto` sí ofrece (si no, el test de arriba pasaría por vacuidad).
  assert.equal(transportChoices(choicesEnv({ mode: 'auto', mountedKind: 'mock' })).length > 0, true);
});
