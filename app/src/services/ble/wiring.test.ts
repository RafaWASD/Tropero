// Tests de la lógica PURA del wiring del provider/hooks (Fase 3): selección de adaptador por
// plataforma/entorno (R10.3/R11.2), permisos por transporte (R12), helpers de estado de
// conexión (R9), y forma del logging no bloqueante (R15). node:test, sin RN. El render real
// del provider/hooks (React) queda para el device/web — acá se cubre la decisión.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { selectTransportAdapter } from './adapter-selection.ts';
import { permissionModelFor, permissionDenialBlocksApp } from './permissions.ts';
import { isConnectedStatus, blocksManualEntry } from './connection-status.ts';
import { logTransportEvent } from './logging.ts';
import { ManualAdapter } from './adapter-manual.ts';
import { MockAdapter } from './adapter-mock.ts';
import { WebSerialAdapter } from './adapter-web-serial.ts';
import { SimulatorAdapter } from './adapter-simulator.ts';
import { SppAndroidAdapter } from './adapter-spp-android.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

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

test('R7: en iOS (auto) sigue sin haber transporte alcanzable → piso manual', () => {
  // El RS420 declara spp+serial; en iOS su vía real es MFi (protocol string del fabricante,
  // gate externo). Hasta entonces la app es manual-first en iOS y el chip/CTA se ocultan solos.
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'auto' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'macos', mode: 'auto' }), 'manual');
});

test('R8.7: nunca se elige hid-wedge (GATED)', () => {
  for (const platformOS of ['web', 'ios', 'android']) {
    for (const mode of ['auto', 'mock'] as const) {
      assert.notEqual(selectTransportAdapter({ platformOS, mode }), 'hid-wedge');
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

test('R6.4: autoConnect la implementa SOLO spp-android — y los otros cuatro no es por olvido', () => {
  // El provider llama `autoConnect?.()`, así que un adapter sin el método es un no-op. Esta tabla es
  // la DECISIÓN escrita: quién auto-conecta y quién no puede.
  //   · web-serial NO PUEDE: la Web Serial API exige un gesto de usuario para `requestPort()`
  //     (su "recordar" es `navigator.serial.getPorts()`, R5.4 — otro mecanismo).
  //   · manual no tiene transporte físico (es el piso, R7).
  //   · mock lo conecta el bridge de E2E; simulator, el botón de la demo.
  // Si alguno de los cuatro empieza a implementarlo, este test cae y hay que justificar por qué.
  assert.equal(typeof new SppAndroidAdapter().autoConnect, 'function');
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
