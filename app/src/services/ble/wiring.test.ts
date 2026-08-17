// Tests de la lógica PURA del wiring del provider/hooks (Fase 3): selección de adaptador por
// plataforma/entorno (R10.3/R11.2), permisos por transporte (R12), helpers de estado de
// conexión (R9), y forma del logging no bloqueante (R15). node:test, sin RN. El render real
// del provider/hooks (React) queda para el device/web — acá se cubre la decisión.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  selectTransportAdapter,
  transportChoices,
  mountActionFor,
  ADAPTER_KINDS,
  type AdapterKind,
} from './adapter-selection.ts';
import { isAdapterUsableOn, selectReaderBinding } from './selection-priority.ts';
import { DRIVER_REGISTRY } from './driver-registry.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { ReaderDriver } from './driver-types.ts';
import { permissionModelFor, permissionDenialBlocksApp } from './permissions.ts';
import { isConnectedStatus, blocksManualEntry } from './connection-status.ts';
import { logTransportEvent } from './logging.ts';
import { ManualAdapter } from './adapter-manual.ts';
import { MockAdapter } from './adapter-mock.ts';
import { WebSerialAdapter } from './adapter-web-serial.ts';
import { SimulatorAdapter } from './adapter-simulator.ts';
import { SppAndroidAdapter } from './adapter-spp-android.ts';
import { BleGattAdapter } from './adapter-ble-gatt.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const SCREEN = '../../features/ble-stick/screens/StickConnectionScreen.tsx';

/** Fuente de un archivo del árbol, SIN comentarios (un guard no puede pasar por un comentario). */
function src(rel: string): string {
  return stripSourceComments(readFileSync(resolve(HERE, rel), 'utf8'));
}

/**
 * La cadena de protocolo iAP SINTÉTICA y el driver que la declara. **No es la de ningún fabricante real**
 * (RBM4.6: inventarla es exactamente lo que el requisito prohíbe, y no habilitaría ningún accesorio).
 * Existe para poder EJECUTAR el diff del día que el trámite MFi entregue el dato: una línea en
 * `app.config.ts` + una `TransportCapability {kind:'mfi'}` en el driver del fabricante. Cero código.
 */
const SYNTHETIC_MFI_PROTOCOL = 'com.ejemplo.lector-sintetico';
const SYNTHETIC_MFI_DRIVER: ReaderDriver = {
  vendorId: 'mfi-sintetico',
  displayName: 'Lector MFi sintético (test)',
  transports: [{ kind: 'mfi', params: { protocolString: SYNTHETIC_MFI_PROTOCOL } }],
  frameParser: { parse: parseRs420Line },
  deviceMatch: { namePattern: /sintetico/i },
  streaming: true,
};

// ─── R10.3 / R11.2: selección de adaptador por plataforma/entorno ───────────────────────

test('R10.2: mode="mock" fuerza el adapter-mock en cualquier plataforma', () => {
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'mock' }), 'mock');
});

test('R10.3/R5.1: en web (auto) se monta web-serial', () => {
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'auto' }), 'web-serial');
});

test('R6/RMV5.1: en Android (auto) se monta el SPP nativo (Bluetooth Classic)', () => {
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'auto' }), 'spp-android');
});

test('RBM5.6: en iOS (auto) el piso pasa de "manual" a "ble-gatt" — y R7 sigue en pie', () => {
  // ── ESTE TEST DECÍA "sigue sin haber transporte alcanzable → piso manual" Y EL DELTA LO CAMBIÓ ─────
  // Autorización: **RBM5.6** + design §6.2 (*"iOS pasa de 'manual' a 'ble-gatt' como piso: es el único
  // transporte que iOS tiene"*), y **RBM5.9** congela el `auto` de "Android y web", dejando iOS afuera a
  // propósito. Lo que el test viejo afirmaba —que en iOS no hay NINGÚN transporte— dejó de ser cierto
  // cuando entró `adapter-ble-gatt` (F3), que corre con el MISMO código en iOS y en Android (RBM2.1).
  //
  // R7 (carga manual como piso permanente) NO se pierde con esto, y son tres mecanismos distintos:
  //   1. `selectTransportAdapter` elige el KIND; `instantiateTransport` decide si se puede montar y
  //      devuelve `null` sin el módulo nativo de BLE en el build (mismo guard que `isSppNativeAvailable`)
  //      → la app queda manual-first EXACTAMENTE como antes;
  //   2. el `ManualAdapter` del provider está montado siempre, en paralelo al transporte (no es "el
  //      activo" exclusivo);
  //   3. ningún estado de conexión bloquea la carga manual (test de R9.6/R7.2, abajo) ni un permiso
  //      denegado lo hace (`permissionDenialBlocksApp`).
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'auto' }), 'ble-gatt');
  // `macos` NO se contagia: sigue sin transporte alcanzable → piso manual (RBM5.10).
  assert.equal(selectTransportAdapter({ platformOS: 'macos', mode: 'auto' }), 'manual');
  // Y la mitad de R7 que se puede aserrar acá: ningún estado deja la carga manual bloqueada.
  for (const s of ['off', 'permission_denied', 'connecting', 'connected', 'disconnected'] as const) {
    assert.equal(blocksManualEntry(s), false, `${s} no puede bloquear la carga manual (R7.2)`);
  }
});

test('R8.7: nunca se elige hid-wedge (GATED), ni siquiera con la preferencia recordada apuntándole', () => {
  for (const platformOS of ['web', 'ios', 'android']) {
    for (const mode of ['auto', 'mock'] as const) {
      assert.notEqual(selectTransportAdapter({ platformOS, mode }), 'hid-wedge');
      // RBM5.6 abrió la primera entrada por la que un valor de STORAGE puede elegir el transporte, así
      // que el invariante dejó de ser cierto "porque ninguna rama lo escribe" y necesita el gate
      // explícito (`NOT_SELECTABLE_AS_PREFERENCE`). Un registro con `adapterKind:'hid-wedge'` no puede
      // dejar al operario sin transporte.
      assert.notEqual(
        selectTransportAdapter({ platformOS, mode, preferredAdapter: 'hid-wedge' }),
        'hid-wedge',
      );
    }
  }
});

// ─── R12: permisos por transporte ───────────────────────────────────────────────────────

test('R12.4: web-serial depende del permiso del navegador (browser)', () => {
  assert.deepEqual(permissionModelFor('web-serial'), { kind: 'browser' });
});

test('R12: manual/mock no requieren permisos', () => {
  assert.deepEqual(permissionModelFor('manual'), { kind: 'none' });
  assert.deepEqual(permissionModelFor('mock'), { kind: 'none' });
});

test('R12.1: spp-android requiere permisos bluetooth de app; R12.3: hid-wedge usa teclado del SO', () => {
  assert.deepEqual(permissionModelFor('spp-android'), { kind: 'android-bluetooth' });
  assert.deepEqual(permissionModelFor('hid-wedge'), { kind: 'os-keyboard' });
});

test('RBM4.9: `mfi-ios` tiene su PROPIO modelo de permiso (`ios-mfi`), y no comparte el de BLE', () => {
  // La fila la declara F4 con el kind (el adapter llega en F5). No es un detalle de taxonomía: iOS no
  // pide ningún permiso de RUNTIME para un accesorio MFi — gatea el acceso por la LISTA DE PROTOCOLOS del
  // `Info.plist` y por el emparejamiento que hace el propio SO en su Accessory Picker. O sea que "no
  // disponible" en MFi es un dato de BUILD que falta (`mfiAvailability`), no un permiso denegado. Si
  // compartiera `{kind:'ble'}`, la UI mostraría el estado `permission_denied` con su CTA de "Reintentar"
  // sobre algo que ningún permiso puede arreglar: el operario reintentaría para siempre.
  assert.deepEqual(permissionModelFor('mfi-ios'), { kind: 'ios-mfi' });
  assert.notDeepEqual(permissionModelFor('mfi-ios'), permissionModelFor('ble-gatt'));
  // Y los ocho kinds tienen su modelo (total por construcción: el switch de `permissionModelFor` es
  // exhaustivo sobre `AdapterKind`; acá se verifica que ninguno devuelva `undefined` en runtime).
  for (const kind of ADAPTER_KINDS) {
    const model = permissionModelFor(kind);
    assert.ok(model && typeof model.kind === 'string', `${kind} sin modelo de permiso`);
  }
  // Y ninguno bloquea la app (R12.5/R7.2), tampoco el nuevo.
  assert.equal(permissionDenialBlocksApp(), false);
});

test('R12.5/R7.2: un permiso denegado NUNCA bloquea la app (manual-first)', () => {
  assert.equal(permissionDenialBlocksApp(), false);
});

// ─── R9: estado de conexión — helpers ───────────────────────────────────────────────────

test('R9.2: isConnectedStatus es true solo en "connected"', () => {
  assert.equal(isConnectedStatus('connected'), true);
  for (const s of ['off', 'permission_denied', 'scanning', 'connecting', 'disconnected'] as const) {
    assert.equal(isConnectedStatus(s), false);
  }
});

test('R9.6/R7.2: NINGÚN estado de conexión bloquea la carga manual', () => {
  for (const s of [
    'off',
    'permission_denied',
    'scanning',
    'connecting',
    'connected',
    'disconnected',
  ] as const) {
    assert.equal(blocksManualEntry(s), false);
  }
});

// ─── R15: logging no bloqueante ─────────────────────────────────────────────────────────

test('R15.1/R15.2: logTransportEvent nunca tira (best-effort), aun con console roto', () => {
  // No debe propagar excepción bajo ninguna forma de evento.
  assert.doesNotThrow(() => logTransportEvent({ kind: 'connection_changed', connected: true }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'eid_rejected', reason: 'parse_failed' }));
  // 🟡-2 (review de F1): el motivo NUEVO —el `parse` del driver tiró— también se construye y se
  // loguea. El `reason` del evento es el `RejectReason` del contrato importado, no una copia: si
  // alguien agrega un motivo allá y no llega acá, deja de compilar.
  assert.doesNotThrow(() => logTransportEvent({ kind: 'eid_rejected', reason: 'parser_threw' }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'reconnect_attempt', attempt: 3 }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'read_loop_error', message: 'boom' }));
  // Diagnóstico de los bloqueantes cerrados el 2026-07-30: los cuatro existen para poder distinguir
  // en logcat causas que hoy dan EXACTAMENTE el mismo síntoma ("conectado y mudo").
  assert.doesNotThrow(() => logTransportEvent({ kind: 'bridge_timeout', label: 'connect_to_device', ms: 20000 }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'connect_superseded', deviceId: 'AA:BB:CC:DD:EE:FF' }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'liveness_lost', reason: 'poll', message: 'socket_closed' }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'connected_silent', ms: 45000 }));
  // R6.4: los seis motivos por los que el arranque puede NO auto-conectar. Desde la UI se ven todos
  // igual (nada), así que el log es la única forma de diagnosticar un "no se conectó solo".
  for (const reason of ['no_remembered', 'permission', 'bluetooth_off', 'background', 'unavailable', 'busy'] as const) {
    assert.doesNotThrow(() => logTransportEvent({ kind: 'autoconnect_skipped', reason }));
  }
  // 🔴-2 (barrido 2026-08-06): el descarte de una lectura que no iba a recibir NADIE. El silencio correcto
  // es indistinguible de "el bastón no leyó" desde afuera, así que este evento es la única forma de ver el
  // agujero — y hasta el review (⚪-J) su payload no lo ejecutaba nada: solo se verificaba que el literal
  // apareciera en el provider.
  assert.doesNotThrow(() => logTransportEvent({ kind: 'read_dropped_no_consumer', subscribers: 0 }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'read_dropped_no_consumer', subscribers: 3 }));
  // Y el subscriber que TIRA dentro del despacho (🟠-D): el provider lo acota y lo loguea por este canal.
  assert.doesNotThrow(() => logTransportEvent({ kind: 'read_loop_error', message: 'tag_subscriber_threw' }));
  // RBM1.4 (delta ios-ble-mfi): el fail-closed del parser de trama, en sus DOS momentos. Igual que
  // con `read_dropped_no_consumer` (⚪-J), el payload se EJECUTA acá y no solo se verifica que el
  // literal aparezca en el provider — un evento que nada construye es un log que nadie probó.
  assert.doesNotThrow(() => logTransportEvent({ kind: 'parser_unresolved', adapter: 'spp-android', at: 'mount' }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'parser_unresolved', adapter: 'web-serial', at: 'read' }));

  // Aun si console.info tira, el logger se lo traga (R15.2).
  const original = console.info;
  try {
    // eslint-disable-next-line no-console
    console.info = () => {
      throw new Error('console roto');
    };
    assert.doesNotThrow(() => logTransportEvent({ kind: 'connect_error', message: 'x' }));
  } finally {
    console.info = original;
  }
});

// ─── R6.4: la reconexión automática al ABRIR la app (🟠-3 del review) ───────────────────────

test('R6.4: el provider LLAMA a transport.autoConnect() al montar (si no, R6.4 muere en silencio)', () => {
  // GUARD, no test de comportamiento. El provider es `.tsx`: no lo cubre ninguna suite node:test ni el
  // E2E (que corre web/mock, donde `autoConnect` no existe). Si alguien saca esa línea, el bastón deja
  // de reconectar solo al abrir y NADA se pone rojo — que es exactamente el estado del que venimos:
  // acá había un comentario que decía "NO auto-conectamos" mientras R6.4 pedía lo contrario.
  const src = stripSourceComments(
    readFileSync(resolve(HERE, 'BleStickListenerProvider.tsx'), 'utf8'),
  );
  assert.match(src, /transport\.autoConnect\?\.\(\)/);
});

test('RBM5.6: el provider HIDRATA la preferencia del bastón recordado (si no, la rama es inalcanzable)', () => {
  // MISMA clase de guard que el de `autoConnect`, y por el mismo motivo: el provider es `.tsx` (ninguna
  // suite node:test lo importa) y la E2E corre en `mock`, donde `selectTransportAdapter` corta ANTES de
  // la preferencia. Sin esta hidratación, `SelectionEnv.preferredAdapter` nunca llega con un valor en
  // producción: el adapter escribe el `adapterKind` en storage, nadie lo lee, y **el transporte BLE
  // sigue siendo inalcanzable en Android** (que es literalmente el problema que RBM5.6 vino a resolver)
  // con toda la suite de `selectTransportAdapter` en verde.
  const src = stripSourceComments(
    readFileSync(resolve(HERE, 'BleStickListenerProvider.tsx'), 'utf8'),
  );
  assert.match(src, /readRememberedDevice\(\)/, 'el provider no lee el bastón recordado');
  assert.match(
    src,
    /setPreferredAdapter\(\s*remembered\.adapterKind\s*\)/,
    'lo lee pero no hidrata la preferencia: RBM5.6 queda siendo código que nadie puede alcanzar',
  );
  // Y la preferencia tiene que ENTRAR a la selección (no quedar en un useState que nadie usa).
  assert.match(
    src,
    /selectTransportAdapter\(\{[^}]*preferredAdapter[^}]*\}\)/,
    'la preferencia hidratada no se le pasa a selectTransportAdapter',
  );
  // El re-montaje se decide por el KIND ya resuelto, no por la preferencia cruda: si el `useMemo`
  // dependiera de `preferredAdapter`, una preferencia que coincide con el piso re-montaría el transporte
  // por nada (montar → hidratar → re-montar, el riesgo declarado en el design §13).
  assert.match(src, /useMemo\(\(\) => instantiateTransport\(resolvedKind\), \[resolvedKind\]\)/);
  // Y solo se lee en `mode === 'auto'`: los otros tres modos cortan antes en `selectTransportAdapter`
  // (RBM5.9), así que leer storage ahí sería I/O que no puede cambiar nada — con las ~70 specs E2E en
  // `mock` pagándolo.
  assert.match(src, /if \(mode !== 'auto'\) return;/);
});

test('R6.4: autoConnect la implementan los DOS transportes con radio — y los otros cuatro no es por olvido', () => {
  // El provider llama `autoConnect?.()`, así que un adapter sin el método es un no-op. Esta tabla es
  // la DECISIÓN escrita: quién auto-conecta y quién no puede.
  //   · web-serial NO PUEDE: la Web Serial API exige un gesto de usuario para `requestPort()`
  //     (su "recordar" es `navigator.serial.getPorts()`, R5.4 — otro mecanismo).
  //   · manual no tiene transporte físico (es el piso, R7).
  //   · mock lo conecta el bridge de E2E; simulator, el botón de la demo.
  // Si alguno de los cuatro empieza a implementarlo, este test cae y hay que justificar por qué.
  //
  // ⚠️ El delta ios-ble-mfi suma el SEGUNDO: `ble-gatt` lo implementa por **RBM2.16** ("deberá reusar
  // `remembered-device.ts` … e implementar `autoConnect()` con la misma política de `ConnectTrigger` que
  // el SPP"). Este test decía "SOLO spp-android" y el título ya era falso desde F3 sin que nada cayera:
  // el adapter nuevo no estaba en la lista, así que la tabla no lo miraba. Y no es cosmético — F4 es lo
  // que hace que ese `autoConnect` se ALCANCE en producción (el piso de iOS y la preferencia del bastón
  // recordado son las dos únicas formas de montar `ble-gatt`), o sea que desde este delta un iPhone
  // arranca escaneando por BLE sin gesto. Es exactamente lo que R6.4 pide, pero tiene que estar dicho.
  assert.equal(typeof new SppAndroidAdapter().autoConnect, 'function');
  assert.equal(typeof new BleGattAdapter().autoConnect, 'function');
  for (const adapter of [new ManualAdapter(), new MockAdapter(), new WebSerialAdapter(), new SimulatorAdapter()]) {
    assert.equal(
      typeof (adapter as { autoConnect?: unknown }).autoConnect,
      'undefined',
      `${adapter.kind} no debería auto-conectar (ver el comentario de arriba)`,
    );
  }
});

test('R6.4: el TOPE de la cadena sin gesto está declarado por trigger, no adivinado por estado', () => {
  // Guard de coherencia entre los dos módulos: el adapter tiene que DERIVAR la política del trigger
  // (`policyFor`) y no volver a decidirla con un booleano suelto. El booleano `auto` era exactamente eso,
  // y es lo que dejaba la cadena infinita indistinguible de la del operario.
  const src = stripSourceComments(readFileSync(resolve(HERE, 'adapter-spp-android.ts'), 'utf8'));
  assert.match(src, /policyFor\(/);
  assert.match(src, /from '\.\/connect-trigger'/);
  // Y el latch del `auto: boolean` NO puede volver: si vuelve, la política se vuelve a decidir a mano.
  assert.equal(
    /doConnect\([^)]*auto: boolean/.test(src),
    false,
    'volvió el booleano `auto` en doConnect: la política del trigger es una tabla, no un flag',
  );
});

// ─── R6.6 / MEDIUM-2 · el bastón RECORDADO tiene que poder morir ─────────────────────────────

test('R6.6: `forgetRememberedDevice` está CABLEADO — olvidar a mano, al cerrar sesión y al dar de baja', () => {
  // GUARD sobre la ausencia. R6.6 existe desde el core ("una acción para cambiar y otra para OLVIDAR el
  // bastón guardado, limpiando el identificador persistido") y la función existía desde entonces… con
  // CERO call sites. Mientras la MAC era un dato inerte en SecureStore era una ausencia dormida; desde
  // R6.4 la app abre un RFCOMM contra ella **sin gesto** en cada apertura, así que la ausencia se volvió
  // peligrosa: un teléfono compartido (cambio de turno del peón) arranca conectándose al bastón del
  // turno anterior, y unos auriculares tocados por error quedan guardados como "el bastón".
  //
  // Los tres call sites son los tres momentos en que ese dato deja de ser válido. Se chequean por
  // FUENTE porque ninguno de los tres es testeable en node:test (React context, edge function, .tsx).
  const sites: Array<[string, string]> = [
    ['la pantalla de conexión (R6.6, acción explícita)', '../../features/ble-stick/screens/StickConnectionScreen.tsx'],
    ['el cierre de sesión (teléfono compartido)', '../../contexts/AuthContext.tsx'],
    ['la baja de cuenta', '../account.ts'],
  ];
  for (const [porQue, rel] of sites) {
    const src = stripSourceComments(readFileSync(resolve(HERE, rel), 'utf8'));
    assert.match(
      src,
      /forgetRememberedDevice\(/,
      `falta limpiar el bastón recordado en ${porQue} (${rel}): la app se auto-conecta a esa MAC en cada apertura`,
    );
  }
});

test('MEDIUM-2: la pantalla NO persiste el device antes de saber si conecta', () => {
  // Antes: `writeRememberedDevice(device.id)` y DESPUÉS `connect(device.id)` — o sea que se recordaba lo
  // que nunca funcionó, sobre una fila que deja tocar CUALQUIER emparejado a propósito
  // (`allowUnrecognized: true`). El único que puede persistir es el adapter, en el punto donde el bastón
  // contestó. Este guard mira la función de la lista de emparejados, que es la del camino SPP.
  const src = stripSourceComments(
    readFileSync(resolve(HERE, '../../features/ble-stick/screens/StickConnectionScreen.tsx'), 'utf8'),
  );
  const onChoosePaired = /const onChoosePaired = useCallback\(([\s\S]*?)\n  \);/.exec(src)?.[1] ?? '';
  assert.ok(onChoosePaired.length > 0, 'no se encontró onChoosePaired (¿se renombró?)');
  assert.equal(
    /writeRememberedDevice\(/.test(onChoosePaired),
    false,
    'la pantalla volvió a persistir la MAC antes de conectar: recordaría un device que nunca funcionó',
  );
  assert.match(onChoosePaired, /transport\?\.connect\(/);
});

test('MEDIUM-2 (delta ios-ble-mfi): la pantalla NO persiste NADA — ni el vendorId como si fuera un id', () => {
  // El guard de arriba mira SOLO `onChoosePaired` (el camino SPP). El camino del device reconocido
  // (`onChooseDevice`) hacía `writeRememberedDevice(binding.driver.vendorId)` — un **vendorId guardado
  // como si fuera un id de device**, "marcador de reconexión" de cuando ningún adapter real leía ese
  // valor. Con el transporte BLE eso pasó a ser un bug VIVO y verificado en el fuente del adapter
  // (`adapter-ble-gatt.ts`: `let target = deviceId ?? readRemembered()`, y solo si no hay target
  // escanea): un `'esp32-gatt-emu'` guardado ahí manda a `connectToDevice()` contra un id que no existe
  // → el bastón no se encuentra NUNCA MÁS, y el CTA de "Olvidar" solo se renderiza en el camino SPP.
  // El único que puede persistir es el adapter, en el punto donde el bastón contestó (y ahí escribe
  // además el `adapterKind`, RBM5.6). Por eso el guard es sobre TODO el archivo, no sobre una función.
  const src = stripSourceComments(
    readFileSync(resolve(HERE, '../../features/ble-stick/screens/StickConnectionScreen.tsx'), 'utf8'),
  );
  assert.equal(
    /writeRememberedDevice/.test(src),
    false,
    'la pantalla volvió a persistir el bastón recordado: el único que sabe con qué id (y con qué adapterKind) se abrió el link es el ADAPTER',
  );
  // Y los TRES escritores legítimos siguen pasando su `adapterKind`: sin ese literal la preferencia de
  // RBM5.6 nunca se escribe y toda la rama de `selectTransportAdapter` queda inalcanzable en producción.
  // (`mfi-ios` entra en F5, con su adapter: es el tercer transporte con radio.)
  for (const [rel, kind] of [
    ['./adapter-spp-android.ts', 'spp-android'],
    ['./adapter-ble-gatt.ts', 'ble-gatt'],
    ['./adapter-mfi-ios.ts', 'mfi-ios'],
  ] as const) {
    const adapterSrc = stripSourceComments(readFileSync(resolve(HERE, rel), 'utf8'));
    assert.match(
      adapterSrc,
      new RegExp(`writeRememberedDevice\\([^)]*adapterKind:\\s*'${kind}'`),
      `${rel} no escribe su adapterKind al recordar el device (RBM5.6 quedaría siendo código inalcanzable)`,
    );
  }
});

test('R6.6/RBM5.6: el CTA de "olvidar" NO puede vivir adentro de una rama por transporte', () => {
  // La trampa que se cierra sola: desde RBM5.6 el registro del bastón recordado decide QUÉ TRANSPORTE se
  // monta, así que un teléfono que alguna vez conectó por BLE monta `ble-gatt` para siempre. Si el único
  // botón que borra ese registro vive adentro de `{isSpp ? … }`, queda ESCONDIDO por la preferencia misma
  // → el RS420 por SPP se vuelve inalcanzable y no hay gesto que lo arregle (R6.6 incumplido por
  // ubicación, no por ausencia — que es más difícil de ver). El oráculo: el CTA existe y NO está en
  // ninguna de las dos ramas del ternario.
  const src = stripSourceComments(
    readFileSync(resolve(HERE, '../../features/ble-stick/screens/StickConnectionScreen.tsx'), 'utf8'),
  );
  assert.match(src, /testID="stick-forget-cta"/, 'desapareció el CTA de olvidar (R6.6)');
  const ternario = /\{isSpp \? \(([\s\S]*?)\n {10}\) : \(([\s\S]*?)\n {10}\)\}/.exec(src);
  assert.ok(ternario, 'no se encontró el ternario de `isSpp` (¿cambió el layout de la sección?)');
  const [, ramaSpp, ramaResto] = ternario;
  assert.equal(
    /stick-forget-cta/.test(ramaSpp),
    false,
    'el CTA de olvidar volvió adentro de la rama SPP: en iOS/BLE queda inalcanzable justo cuando hace falta',
  );
  assert.equal(
    /stick-forget-cta/.test(ramaResto),
    false,
    'el CTA de olvidar quedó adentro de la rama no-SPP: el camino del RS420 emparejado lo pierde',
  );
  // Y la otra forma de esconderlo SIN moverlo: gatearlo por el transporte en su propia condición
  // (`{isSpp && hasRemembered ? …}`). La condición tiene que ser EXACTAMENTE "hay bastón guardado".
  const condición = /\{([^{}]*?)\?\s*\(\s*<Button testID="stick-forget-cta"/.exec(src)?.[1] ?? '';
  assert.equal(
    condición.trim(),
    'hasRemembered',
    'el CTA de olvidar se gateó por algo más que "hay bastón guardado" (¿por transporte?)',
  );
});

test('RBM5.5/RBM4.7: la pantalla pasa la lista REAL de protocolos declarados, no un `[]` literal', () => {
  // `BindingEnv.declaredEaProtocols` es REQUERIDA para que el call site no pueda olvidarla… pero el tipo
  // acepta igual un `[]`, y con un `[]` el binding MFi diría `build-sin-protocolos` PARA SIEMPRE —incluso
  // el día que la cadena del fabricante esté en el plist—, o sea que RBM4.7 ("cero código ese día") sería
  // falso sin que nada se pusiera rojo. El único call site de producción es un `.tsx` (no importable en
  // node:test), así que el oráculo posible es la fuente. La mitad de COMPORTAMIENTO —la conjunción y sus
  // tres motivos— está cubierta por `selection-priority.test.ts` y `ea-protocols.test.ts`.
  const src = stripSourceComments(
    readFileSync(resolve(HERE, '../../features/ble-stick/screens/StickConnectionScreen.tsx'), 'utf8'),
  );
  const llamada = /selectReaderBinding\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? '';
  assert.ok(llamada.length > 0, 'no se encontró la llamada a selectReaderBinding (¿se movió?)');
  assert.match(
    llamada,
    /declaredEaProtocols:\s*declaredEaProtocols\(\)/,
    'la pantalla no pasa `declaredEaProtocols()`: el gate de MFi quedaría clavado en "build-sin-protocolos"',
  );
  // Y el `BUILT_ADAPTERS` de la pantalla. **F5 lo cambió a propósito y esta es su autorización escrita**:
  // en F4 este guard exigía que `'mfi-ios'` NO estuviera, porque `adapter-mfi-ios.ts` no existía y
  // declararlo construido habría hecho que su binding saliera `available:true` sobre un transporte que
  // `instantiateTransport` no podía montar (la afordancia muerta del bugfix del 2026-07-29). En F5 el
  // adapter EXISTE, así que la exigencia se invierte y por DOS requisitos, no por gusto:
  //   · **RBM4.5** — con `mfi-ios` afuera de esta lista, el binding de un lector MFi diría
  //     `adapter-no-construido` ("todavía no lo soportamos") cuando la verdad es `build-sin-protocolos`
  //     ("falta la autorización del fabricante"). El motivo equivocado manda a buscar el dato equivocado,
  //     y esa distinción es literalmente lo que RBM4.5 compró para el copy de la pantalla.
  //   · **RBM4.7** — "el día que llegue la cadena el diff es el DATO, cero código". Si el kind tuviera que
  //     entrar a esta lista ese día, sería código.
  // ⚠️ Y NO significa que hoy se pueda montar: `available` es capacidad de BUILD y para MFi RBM5.5 lo cruza
  // con la lista de protocolos declarada (hoy VACÍA) → el binding sigue `available:false` con su motivo
  // honesto. La otra mitad ("¿este dispositivo puede montarlo?") la responde `TRANSPORT_INSTALLABLE`, que
  // para `mfi-ios` es `isMfiTransportAvailable` e incluye el gate de datos → hoy false en cualquier iPhone.
  const built = /const BUILT_ADAPTERS[^=]*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
  assert.ok(built.length > 0, 'no se encontró BUILT_ADAPTERS (¿se renombró?)');
  assert.match(built, /'ble-gatt'/, 'falta ble-gatt en BUILT_ADAPTERS: su binding diría "no disponible"');
  assert.match(
    built,
    /'mfi-ios'/,
    'falta mfi-ios en BUILT_ADAPTERS: con el adapter escrito (F5), su binding mentiría el motivo (diría "no construido" en vez de "falta el protocolo del fabricante", RBM4.5)',
  );
  // Y el conjunto COMPLETO, no solo los dos que importan hoy: `selection-priority.test.ts` usa un espejo
  // de esta lista (`BUILT_TODAY`) para los casos "como en el build real", y un espejo que puede driftar no
  // prueba nada. Un kind que entre o salga de la pantalla tiene que pasar por acá.
  const declarados = [...built.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(declarados, [
    'ble-gatt',
    'manual',
    'mfi-ios',
    'mock',
    'simulator',
    'spp-android',
    'web-serial',
  ]);
  for (const kind of declarados) {
    assert.ok((ADAPTER_KINDS as readonly string[]).includes(kind), `'${kind}' no es un AdapterKind`);
  }
  // `hid-wedge` sigue AFUERA, y eso NO cambió con F5: su gate es el físico (R8.7/RBM8.0) y su archivo es
  // un placeholder de 22 líneas. Se asierra explícito para que el diff que lo agregue sea deliberado.
  assert.equal(declarados.includes('hid-wedge'), false, 'hid-wedge sigue gateado por el gate físico (RBM8.0)');
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 🟠-2 del review de F4 · UN TRANSPORTE ALCANZABLE POR PREFERENCIA NECESITA QUIÉN LO ELIJA Y QUIÉN
// LO ESCRIBA. Los guards de esta sección están escritos sobre LA AUSENCIA.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// El estado del que venimos: RBM5.6 monta el transporte del bastón recordado y el `adapterKind` de ese
// registro **lo escribe el adapter al conectar**. En Android eso cerraba un bucle sin entrada (para que la
// preferencia diga `ble-gatt` había que haber conectado por `ble-gatt`), así que el transporte BLE era
// **inalcanzable en producción justo en la plataforma donde está el productor** —el problema que RBM5.6
// dice resolver— y el banco de F6/T6.2 no tenía con qué arrancar. Es el mismo patrón que ya pagamos con
// R6.6 (mecanismo completo, cero call sites): un mecanismo sin escritor es una promesa, no una función.

/** Todos los .ts/.tsx de producción bajo esas raíces (sin tests: un test no es un escritor). */
function productionSources(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === '__shots__') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      out.push(full);
    }
  };
  for (const root of roots) walk(resolve(HERE, root));
  return out;
}

/** El módulo (path relativo al repo, con `/`) de un archivo absoluto. */
function relToApp(file: string): string {
  return file.replace(/\\/g, '/').replace(/^.*\/app\//, 'app/');
}

/**
 * Qué módulos escriben la preferencia del bastón recordado, y con qué `adapterKind`. Barrido del ÁRBOL
 * (no una lista escrita a mano): así el escritor nº3 aparece solo.
 *
 * Las raíces son **`app/src` y `app/app` completas** y no solo la carpeta del bastón: los otros dos
 * consumidores del registro viven afuera (`contexts/AuthContext.tsx` y `services/account.ts` lo BORRAN al
 * cerrar sesión y al dar de baja), así que un escritor nuevo puede nacer en cualquier lado. `app/e2e` queda
 * afuera a propósito y con motivo: ahí el registro se SIEMBRA como fixture (la captura escribe el
 * `localStorage` directo, que es justamente cómo se ejercita `parseRememberedValue` en el navegador), y un
 * fixture no es un escritor de producción.
 */
function preferenceWriters(): { byKind: Map<string, string[]>; files: string[]; keyLiterals: string[] } {
  const byKind = new Map<string, string[]>();
  const files: string[] = [];
  const keyLiterals: string[] = [];
  for (const file of productionSources(['../..', '../../../app'])) {
    const code = stripSourceComments(readFileSync(file, 'utf8'));
    const rel = relToApp(file);
    if (code.includes("'rafq.ble.remembered_device'")) keyLiterals.push(rel);
    if (!/writeRememberedDevice\s*\(/.test(code)) continue;
    files.push(rel);
    for (const m of code.matchAll(/writeRememberedDevice\([^)]*adapterKind:\s*'([^']+)'/g)) {
      byKind.set(m[1], [...(byKind.get(m[1]) ?? []), rel]);
    }
  }
  return { byKind, files: [...new Set(files)].sort(), keyLiterals: [...new Set(keyLiterals)].sort() };
}

test('🟡-3: los módulos habilitados a ESCRIBIR el bastón recordado son una lista CERRADA', () => {
  // El guard anterior miraba TRES ARCHIVOS NOMBRADOS (que la pantalla no escriba, que los dos adapters
  // escriban su kind). Un CUARTO archivo que llamara `writeRememberedDevice(algoQueNoEsUnDeviceId)` pasaba
  // en verde — que es la crítica que este repo ya se hizo cuatro veces: el guard escrito sobre las
  // instancias en vez de sobre el invariante. Ahora se barre el árbol y la lista de escritores es cerrada.
  //
  // Por qué importa quién escribe: lo que se guarda ahí se DIALA sin gesto en cada apertura (R6.4) y
  // además DECIDE QUÉ TRANSPORTE SE MONTA (RBM5.6). Un `vendorId` guardado como si fuera un id de device
  // —el bug que F4 encontró— manda `connectToDevice()` contra un id que no existe: el bastón no se
  // encuentra nunca más.
  const { byKind, files, keyLiterals } = preferenceWriters();
  assert.deepEqual(
    files,
    [
      // El BORDE (define la función y toca el storage). No escribe: expone.
      'app/src/services/ble/remembered-device.ts',
      // Los TRES transportes con radio: son los ÚNICOS que saben con qué id y por qué transporte se abrió
      // el link de verdad, y escriben en el punto donde el bastón contestó. `adapter-mfi-ios.ts` entra en
      // F5 con su adapter (y este guard fue el que lo hizo NACER EN ROJO: la lista es cerrada a propósito,
      // así que sumar un escritor es una decisión visible en el diff y no un olvido).
      'app/src/services/ble/adapter-ble-gatt.ts',
      'app/src/services/ble/adapter-mfi-ios.ts',
      'app/src/services/ble/adapter-spp-android.ts',
    ].sort(),
    'apareció (o desapareció) un escritor de la preferencia del bastón recordado: tiene que ser el ADAPTER que conectó, no una pantalla',
  );
  // Y la clave de storage vive en UN solo lugar: un segundo módulo con el literal saltearía el formato
  // entero (`parseRememberedValue`/`serializeRememberedValue`) y con él la compatibilidad de RBM5.7.
  assert.deepEqual(keyLiterals, ['app/src/services/ble/remembered-device.ts']);
  // Cada escritor pasa SU adapterKind (sin ese literal, la preferencia no se escribe nunca y RBM5.6 vuelve
  // a ser código inalcanzable).
  assert.deepEqual(byKind.get('ble-gatt'), ['app/src/services/ble/adapter-ble-gatt.ts']);
  assert.deepEqual(byKind.get('spp-android'), ['app/src/services/ble/adapter-spp-android.ts']);
  assert.deepEqual(byKind.get('mfi-ios'), ['app/src/services/ble/adapter-mfi-ios.ts']);
  // ANTI-VACUIDAD del mapa: un `byKind` vacío (regex que dejó de matchear la forma de la llamada) haría
  // pasar las tres aserciones de arriba si alguien las escribiera con `?? []`. Acá se exige que el barrido
  // haya visto EXACTAMENTE los tres kinds y ninguno más.
  assert.deepEqual([...byKind.keys()].sort(), ['ble-gatt', 'mfi-ios', 'spp-android']);
});

test('🟠-2: cada adapter usa el bastón recordado SOLO si el registro es de SU transporte', () => {
  // La contracara de poder ELEGIR el transporte: el registro guarda UN bastón (R6.7) con SU `adapterKind`,
  // así que desde que el montado puede no ser el que escribió, `connect()` sin id podía dialar el id del
  // OTRO transporte — un RFCOMM contra un device que solo anuncia GATT (o al revés) **no falla rápido, se
  // queda esperando**, que es el síntoma más caro de esta unidad.
  //
  // Guard ESTÁTICO y declarado como tal: toda la suite de los adapters inyecta un `env` falso, así que
  // `defaultBleEnv`/`defaultSppEnv` no los ejerce nada (mismo caso que el literal del transporte en
  // `ensurePermissions`, RBM2.13). La mitad de COMPORTAMIENTO —qué devuelve el filtro para cada
  // combinación, y que sea exhaustivo sobre `AdapterKind`— vive en `remembered-format.test.ts`.
  for (const [rel, kind, legacy, porQue] of [
    ['./adapter-ble-gatt.ts', 'ble-gatt', 'false', 'un registro viejo (sin adapterKind) solo pudo escribirlo el SPP'],
    ['./adapter-spp-android.ts', 'spp-android', 'true', 'negarle el formato viejo le borra el bastón a todo teléfono instalado (RBM5.7)'],
    // MFi (F5): el mundo malo propio de este transporte es abrir una `EASession` contra una MAC de
    // Bluetooth Classic guardada por el SPP. `acceptsLegacy: false` por el mismo motivo que el BLE, y con
    // una razón extra: en iOS el id NO es una MAC sino el `serialNumber` del accesorio, así que un registro
    // del formato viejo (que solo pudo escribirlo el SPP, en Android) no puede ser de un accesorio MFi.
    ['./adapter-mfi-ios.ts', 'mfi-ios', 'false', 'en iOS el id es el serialNumber del accesorio, no una MAC de Classic'],
  ] as const) {
    const s = src(rel);
    assert.match(s, /rememberedDeviceIdFor\(/, `${rel} lee el registro sin filtrar por transporte`);
    assert.match(
      s,
      new RegExp(`'${kind}',\\s*\\{ acceptsLegacy: ${legacy} \\}`),
      `${rel}: tiene que filtrar por SU kind con acceptsLegacy:${legacy} — ${porQue}`,
    );
    assert.equal(
      /readRememberedDevice\(\)\)\?\.deviceId/.test(s),
      false,
      `${rel} volvió a tomar el deviceId crudo del registro: puede dialar el device del otro transporte`,
    );
  }
});

/** Los `AdapterKind` que la pantalla declara construidos, leídos de su fuente (es un `.tsx`). */
function builtAdaptersOfScreen(): AdapterKind[] {
  const built = [...(/const BUILT_ADAPTERS[^=]*=\s*\[([^\]]*)\]/.exec(src(SCREEN))?.[1] ?? '').matchAll(/'([^']+)'/g)]
    .map((m) => m[1] as AdapterKind);
  assert.ok(built.length > 0, 'no se pudo leer BUILT_ADAPTERS de la pantalla (¿se renombró?)');
  return built;
}

/**
 * ¿Hay en el registro algún LECTOR que resuelva a ese `AdapterKind` en esa plataforma?
 *
 * Es la precondición de "ofrecible", y hace falta nombrarla porque `transportChoices` recorre EL REGISTRO:
 * un transporte que ningún lector declara no puede tener fila. Eso **no** es un cableado faltante, es un
 * DATO faltante — y en el caso de `mfi` el dato faltante lo impone un requisito (RBM4.6: no se inventa la
 * `protocolString` de ningún fabricante). Distinguir las dos cosas es lo que evita las dos degeneraciones:
 * aflojar el guard "porque no se puede cumplir", o "cumplirlo" inventando un driver.
 */
function hasReaderFor(
  kind: AdapterKind,
  platformOS: string,
  registry: ReaderDriver[],
  declaredEaProtocols: readonly string[],
  builtAdapters: AdapterKind[],
): boolean {
  return registry.some(
    (driver) =>
      selectReaderBinding({ platformOS, driver, builtAdapters, declaredEaProtocols })?.adapterKind === kind,
  );
}

/**
 * Corre el invariante de alcanzabilidad sobre TODAS las plataformas y devuelve los pares
 * `plataforma/kind` que quedaron EXENTOS por no tener ningún lector en el registro. Lo que sí es
 * alcanzable se asierra acá adentro (honrado + ofrecido + con escritor).
 */
function checkReachability(registry: ReaderDriver[], declaredEaProtocols: readonly string[]) {
  const built = builtAdaptersOfScreen();
  const { byKind } = preferenceWriters();
  const sinLector: string[] = [];
  let paresNoPiso = 0;

  for (const platformOS of ['web', 'ios', 'android', 'macos']) {
    const piso = selectTransportAdapter({ platformOS, mode: 'auto' });
    // Lo que la PANTALLA ofrece elegir en esa plataforma (con el piso montado, que es el arranque normal).
    // `canInstantiate: () => true` a propósito: acá se mide la alcanzabilidad ESTRUCTURAL, no si el APK de
    // hoy trae el binario (eso lo dice la fila con "todavía no disponible en esta versión").
    const ofrecidos = new Set(
      transportChoices({
        platformOS,
        // El modo de PRODUCCIÓN: es el único en el que la preferencia se honra (RBM5.9), o sea el único en el
        // que la alcanzabilidad por preferencia significa algo.
        mode: 'auto',
        mountedKind: piso,
        builtAdapters: built,
        declaredEaProtocols,
        canInstantiate: () => true,
        registry,
      }).map((c) => c.adapterKind),
    );
    for (const kind of ADAPTER_KINDS) {
      const honrado = selectTransportAdapter({ platformOS, mode: 'auto', preferredAdapter: kind }) === kind;
      if (!built.includes(kind)) {
        assert.equal(
          honrado,
          false,
          `${platformOS}: '${kind}' NO está construido en este build y la preferencia lo honraría → el operario queda SIN transporte, en silencio`,
        );
        continue;
      }
      if (!isAdapterUsableOn(kind, platformOS)) continue; // no existe en esta plataforma: nada que exigir
      if (kind === piso) continue; // alcanzable sin preferencia (es el piso)
      if (!hasReaderFor(kind, platformOS, registry, declaredEaProtocols, built)) {
        sinLector.push(`${platformOS}/${kind}`);
        continue;
      }
      paresNoPiso += 1;
      assert.equal(
        honrado,
        true,
        `${platformOS}: '${kind}' se construye y existe acá, pero NO es el piso y la preferencia no lo honra → inalcanzable`,
      );
      assert.ok(
        ofrecidos.has(kind),
        `${platformOS}: '${kind}' solo se monta por preferencia y la pantalla NO lo ofrece → nadie puede elegirlo (es el bucle de 🟠-2)`,
      );
      assert.ok(
        (byKind.get(kind) ?? []).length > 0,
        `${platformOS}: '${kind}' se puede elegir pero NADIE escribe esa preferencia → la elección no sobrevive al reinicio`,
      );
    }
  }
  return { sinLector: sinLector.sort(), paresNoPiso };
}

test('🟠-2 GUARD SOBRE LA AUSENCIA: todo transporte construido y usable es ALCANZABLE en su plataforma', () => {
  // El invariante, en una frase: un `AdapterKind` que este build construye, que existe en esta plataforma
  // y que **algún lector del registro declara** tiene que poder montarse — o es el piso por plataforma, o
  // el operario lo puede ELEGIR en la pantalla y esa elección SOBREVIVE al reinicio (alguien escribe la
  // preferencia). Si no, es código que nadie puede alcanzar, con toda la suite en verde: exactamente
  // `ble-gatt` en Android antes de este fix, y R6.6 antes de que se cableara.
  //
  // La otra mitad es fail-closed: lo que este build NO construye NO se puede honrar como preferencia (si
  // no, un valor de storage le saca el piso al operario y lo deja sin transporte, en silencio).
  const { sinLector, paresNoPiso } = checkReachability(DRIVER_REGISTRY, []);

  // ── LA EXENCIÓN ES CERRADA Y SE NOMBRA (si no, "no tiene lector" sería una puerta para aflojar el guard) ──
  // Hoy hay exactamente UN par exento y su motivo lo impone un requisito: `mfi-ios` en iOS no tiene lector
  // porque **RBM4.6 prohíbe inventar una `protocolString`**, y sin una `TransportCapability {kind:'mfi'}` en
  // algún driver, `transportChoices` (que recorre el registro) no puede tener fila. Sumar un par a esta
  // lista es una decisión visible en el diff.
  assert.deepEqual(
    sinLector,
    ['ios/mfi-ios'],
    'cambió el conjunto de transportes construidos SIN NINGÚN LECTOR en el registro: si es uno nuevo, o le falta el driver o le falta el cableado — no lo agregues acá sin el motivo',
  );
  // Y el motivo se verifica, no se declara: el registro REAL no tiene ni un lector que hable `mfi`.
  assert.equal(
    DRIVER_REGISTRY.some((d) => d.transports.some((t) => t.kind === 'mfi')),
    false,
    'apareció un driver con transporte mfi: ¿es la cadena REAL del fabricante? (RBM4.6) — entonces este test tiene que pasar al caso alcanzable',
  );
  // ANTI-VACUIDAD: si ningún kind cayera en la rama "no es el piso", el invariante no probaría nada. Hoy el
  // par es exactamente `ble-gatt` en Android — el que 🟠-2 vino a destrabar.
  assert.ok(paresNoPiso > 0, 'ANTI-VACUIDAD: ningún transporte alcanzable-solo-por-preferencia (el guard no midió nada)');
});

test('🟠-2/RBM4.7: con la cadena del fabricante, `mfi-ios` queda ALCANZABLE sin escribir una línea de código', () => {
  // ── ESTE ES EL TEST QUE REEMPLAZA LA EXENCIÓN POR UNA PRUEBA ────────────────────────────────────────
  // El guard de arriba exime a `ios/mfi-ios` porque hoy ningún lector declara `mfi` (RBM4.6). Una exención
  // sin contraparte sería justo la forma de aflojar un guard sobre la ausencia: "no se puede cumplir" es
  // indistinguible de "no lo cableé". Así que acá se corre el MISMO invariante inyectando SOLO LOS DOS
  // DATOS del día que llegue la cadena —una `TransportCapability {kind:'mfi'}` en un driver y la cadena en
  // la lista declarada del build— y se exige que el par pase entero: honrado por la preferencia, ofrecido
  // por la pantalla y con un escritor que lo persista. Eso es literalmente RBM4.7 ("cero código ese día")
  // medido sobre el cableado, y es lo que hace que la exención de arriba sea honesta.
  const registry = [...DRIVER_REGISTRY, SYNTHETIC_MFI_DRIVER];
  const { sinLector, paresNoPiso } = checkReachability(registry, [SYNTHETIC_MFI_PROTOCOL]);
  assert.deepEqual(sinLector, [], 'con un lector MFi en el registro no queda ningún transporte sin lector');
  assert.ok(paresNoPiso >= 2, `se esperaban ≥2 pares no-piso (android/ble-gatt + ios/mfi-ios), hubo ${paresNoPiso}`);
  // Y la contraprueba de que el fixture ejercita el par nuevo y no solo el viejo: sin el driver sintético el
  // par sale exento, con él NO. (Si `checkReachability` dejara de mirar `mfi-ios`, las dos mitades pasarían.)
  assert.deepEqual(checkReachability(DRIVER_REGISTRY, [SYNTHETIC_MFI_PROTOCOL]).sinLector, ['ios/mfi-ios']);
});

test('🟠-2: la pantalla OFRECE los otros transportes, y NO desde adentro de la rama de uno de ellos', () => {
  // Guard de fuente (la pantalla es `.tsx`), con la mitad de comportamiento en `selection-priority.test.ts`.
  // La UBICACIÓN es parte del invariante y es la misma trampa que el CTA de olvidar: si las filas de los
  // otros transportes vivieran adentro de `{isSpp ? … }`, en Android (rama SPP) no habría forma de elegir el
  // BLE — o sea, el bug que este fix cierra, reintroducido por ubicación en vez de por ausencia.
  const s = src(SCREEN);
  assert.match(s, /transportChoices\(\{/, 'la pantalla no calcula los transportes elegibles');
  assert.match(s, /choices\.map\(/, 'los calcula y no los renderiza');
  const ternario = /\{isSpp \? \(([\s\S]*?)\n {10}\) : \(([\s\S]*?)\n {10}\)\}/.exec(s);
  assert.ok(ternario, 'no se encontró el ternario de `isSpp` (¿cambió el layout de la sección?)');
  for (const [i, rama] of [ternario[1], ternario[2]].entries()) {
    assert.equal(
      /choices\.map\(/.test(rama),
      false,
      `las filas de los otros transportes quedaron adentro de la rama ${i === 0 ? 'SPP' : 'no-SPP'} del ternario: la otra plataforma pierde la única forma de elegir`,
    );
  }
  // Y la elección tiene que LLEGAR al provider: sin esto la fila es decorativa.
  assert.match(s, /api\?\.chooseTransport\(/, 'tocar la fila no le pide al provider montar ese transporte');
  // Las entradas de `transportChoices` salen de las MISMAS fuentes que el resto de la pantalla (un `[]`
  // literal o un `mountedKind` fijo dejarían la lista muerta o mintiendo, con todo en verde).
  const llamada = /transportChoices\(\{([\s\S]*?)\}\)/.exec(s)?.[1] ?? '';
  assert.match(llamada, /mountedKind:\s*transport\?\.kind/);
  // El MODO sale del provider y NO es un `'auto'` literal. Es el bug que la E2E del capture midió: con
  // `'auto'` hardcodeado, en `mock` (las ~70 specs) el piso de la plataforma aparecía como "alternativa" y
  // la pantalla renderizaba DOS filas idénticas.
  assert.match(llamada, /mode:\s*api\?\.providerMode/);
  assert.equal(
    /mode:\s*'auto'/.test(llamada),
    false,
    "la pantalla volvió a asumir mode:'auto': en mock/demo/manual ofrecería transportes que no se pueden montar",
  );
  assert.match(llamada, /builtAdapters:\s*BUILT_ADAPTERS/);
  assert.match(llamada, /declaredEaProtocols:\s*declaredEaProtocols\(\)/);
  assert.match(llamada, /canInstantiate:\s*canInstantiateTransport/);
});

test('🟠-2: el probe de "se puede instanciar" de la pantalla NO puede driftar del de `instantiateTransport`', () => {
  // Son dos archivos que responden la MISMA pregunta ("¿este build/dispositivo puede montar ese
  // transporte?") y dos respuestas de la misma verdad divergen — el bug de clase de este camino
  // (`isRawStream`, `BLE_OWNED_ROUTES`, las tres copias de `toneColorToken`). Acá la divergencia significaría
  // una fila que ofrece conectar un transporte que el provider no va a montar.
  const provider = src('BleStickListenerProvider.tsx');
  const mapa = /const TRANSPORT_INSTALLABLE[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(src(SCREEN))?.[1] ?? '';
  assert.ok(mapa.length > 0, 'no se encontró TRANSPORT_INSTALLABLE en la pantalla (¿se renombró?)');
  const entradas = [...mapa.matchAll(/'([^']+)':\s*([A-Za-z_$][\w$]*)\s*,/g)];
  assert.ok(entradas.length > 0, 'el mapa de probes quedó sin una sola función nombrada');
  for (const [, kind, fn] of entradas) {
    assert.ok((ADAPTER_KINDS as readonly string[]).includes(kind), `'${kind}' no es un AdapterKind`);
    assert.match(
      provider,
      new RegExp(`${fn}\\(\\)`),
      `la pantalla usa ${fn}() para '${kind}' y \`instantiateTransport\` no: la fila y el montaje pueden discrepar`,
    );
  }
  // Y los TRES transportes con radio tienen que estar declarados con su probe (los que pueden faltar en un
  // build: sin módulo nativo, el adapter está compilado y no se puede montar).
  assert.match(mapa, /'spp-android':\s*isSppNativeAvailable/);
  assert.match(mapa, /'ble-gatt':\s*isBleGattTransportAvailable/);
  // `mfi-ios` (F5): su probe incluye además el GATE DE DATOS (la lista de protocolos del build), así que
  // hoy devuelve false en cualquier iPhone → la fila de un lector MFi no es accionable. Sin esta entrada, la
  // pantalla lo daría por instalable y tocarlo dejaría al operario sin transporte (`instantiateTransport`
  // devuelve null): la afordancia muerta del bugfix del 2026-07-29.
  assert.match(mapa, /'mfi-ios':\s*isMfiTransportAvailable/);
});

test('🟠-2: el LECTOR que la fila promete es el que el adapter va a usar de verdad', () => {
  // `transportChoices` elige "el primero del registro que resuelve a ese kind" y cada adapter elige el suyo
  // por su cuenta (`bleGattDriverFrom`, el default del SPP). Si divergieran, la fila diría "Allflex RS420" y
  // el transporte hablaría con otro driver — o sea con otro `frameParser`: conecta y no ingiere nada.
  const instanciados: Partial<Record<AdapterKind, unknown>> = {
    'ble-gatt': new BleGattAdapter().driver,
    'spp-android': new SppAndroidAdapter().driver,
  };
  let vistos = 0;
  for (const [platformOS, mountedKind] of [
    ['android', 'spp-android'],
    ['android', 'ble-gatt'],
    ['ios', undefined],
  ] as const) {
    for (const choice of transportChoices({
      platformOS,
      mode: 'auto',
      mountedKind,
      builtAdapters: ['web-serial', 'mock', 'manual', 'simulator', 'spp-android', 'ble-gatt'],
      declaredEaProtocols: [],
      canInstantiate: () => true,
      registry: DRIVER_REGISTRY,
    })) {
      const esperado = instanciados[choice.adapterKind];
      if (esperado === undefined) continue;
      vistos += 1;
      assert.equal(
        choice.driver,
        esperado,
        `${platformOS}: la fila de '${choice.adapterKind}' promete ${choice.driver.displayName} y el adapter usa otro driver`,
      );
    }
  }
  assert.ok(vistos >= 2, 'ANTI-VACUIDAD: no se cruzó ni el BLE ni el SPP');
});

// ─── `mountActionFor`: qué se hace con un transporte recién montado (🟠-2) ────────────────────────

test('🟠-2: un transporte montado POR GESTO se conecta; uno del arranque solo auto-conecta', () => {
  // Sin esto, elegir un transporte en la pantalla no haría nada visible: `autoConnect` corta en su primer
  // gate ("¿hay bastón recordado?") y en el escenario que 🟠-2 destraba justamente NO hay (es la primera
  // conexión por ese transporte). El operario tocaría la fila y no pasaría nada.
  assert.equal(mountActionFor({ chosenByGesture: true, canAutoConnect: true }), 'connect');
  // Y también si ese transporte no implementa autoConnect: el gesto igual conecta.
  assert.equal(mountActionFor({ chosenByGesture: true, canAutoConnect: false }), 'connect');
  // Arranque normal: el adapter decide solo (R6.4), con sus gates.
  assert.equal(mountActionFor({ chosenByGesture: false, canAutoConnect: true }), 'autoconnect');
  // web-serial / mock / simulator: nada. Un `connect()` desde el montaje en web-serial sería un
  // `requestPort()` sin gesto (el navegador lo rechaza) y en mock rompería las ~70 specs E2E.
  assert.equal(mountActionFor({ chosenByGesture: false, canAutoConnect: false }), 'none');
});

test('🟠-2: el provider DERIVA la acción de montaje (y el gesto no se pierde en un `autoConnect`)', () => {
  const provider = src('BleStickListenerProvider.tsx');
  assert.match(provider, /mountActionFor\(\{/, 'el provider volvió a decidir a mano qué hacer al montar');
  const llamada = /mountActionFor\(\{([\s\S]*?)\}\)/.exec(provider)?.[1] ?? '';
  assert.match(llamada, /chosenByGesture:\s*chosenByGestureRef\.current === transport\.kind/);
  assert.match(llamada, /canAutoConnect:\s*typeof transport\.autoConnect === 'function'/);
  assert.match(provider, /action === 'connect'/, 'la rama del gesto no llama a connect()');
  // Y la API que la pantalla usa tiene que existir de verdad (no un campo declarado en el tipo y nunca
  // provisto: ahí `api?.chooseTransport(...)` sería un no-op silencioso).
  assert.match(provider, /const chooseTransport = useCallback\(/);
  assert.match(provider, /setPreferredAdapter\(kind\)/, 'chooseTransport no cambia la preferencia: no monta nada');
  assert.match(provider, /chooseTransport,/, 'chooseTransport no viaja en el api del provider');
  assert.match(provider, /providerMode: mode,/, 'el modo no viaja en el api: la pantalla no puede saber si ofrecer transportes');
  // Y el GESTO le gana a la HIDRATACIÓN. La lectura del bastón recordado es asincrónica (SecureStore, techo
  // de 2 s): sin este guard, un operario que elige otro transporte mientras la lectura está en vuelo ve el
  // transporte que acababa de elegir **desmontarse solo** dos segundos después, sin haber tocado nada.
  const hidratacion = /void readRememberedDevice\(\)\.then\(\(remembered\) => \{([\s\S]*?)\n {4}\}\);/.exec(provider)?.[1] ?? '';
  assert.ok(hidratacion.length > 0, 'no se encontró la hidratación de la preferencia (¿se movió?)');
  assert.match(
    hidratacion,
    /chosenByGestureRef\.current == null/,
    'la hidratación puede pisar la elección del operario: el gesto tiene que ganarle a la lectura asincrónica',
  );
});
