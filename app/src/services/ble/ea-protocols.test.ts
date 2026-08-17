// Tests de la LISTA DE PROTOCOLOS MFi y del gate del binding `mfi-ios` (RBM4.2/4.4/4.5, RBM5.5;
// delta ios-ble-mfi T4.2). node:test, PURO.
//
// Lo que estos tests compran es RBM4.7: **"el día que llegue la cadena del fabricante, el diff es una
// línea en `app.config.ts` + una `TransportCapability` en el driver, cero código"**. Eso no se puede
// demostrar con el dato real (no lo tenemos: el trámite MFi es de Facundo), así que se demuestra con una
// cadena SINTÉTICA inyectada — que es exactamente por qué la lista declarada entra por parámetro y no se
// lee adentro del motor de selección (RBM5.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  declaredEaProtocols,
  eaProtocolsFrom,
  eaProtocolsFromExpoConfig,
  mfiAvailability,
  EA_PROTOCOLS_INFO_PLIST_KEY,
  // F5 — las piezas puras del transporte MFi (T5.2), moldeadas sobre el Swift instalado (RBM4.8).
  MFI_CONNECT_RETRY,
  classifyMfiConnectError,
  mfiConnectOptions,
  mfiConnectRetryPolicy,
  mfiDelimiterIsSupported,
  normalizeMfiAccessories,
  pickMfiAccessory,
  resolveMfiParams,
  type MfiConnectFailure,
} from './ea-protocols.ts';
import appConfig from '../../../app.config.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { parseRs420Line } from './parser-rs420.ts';
import { sppConnectOptions, sppDelimiterIsSupported, SPP_DELIMITER } from './spp-protocol.ts';
import type { ReaderDriver } from './driver-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Cadena SINTÉTICA. No es la de ningún fabricante real: inventarla es justo lo que RBM4.6 prohíbe. */
const SYNTHETIC_PROTOCOL = 'com.ejemplo.lector-sintetico';

function mfiDriver(protocolString: string, delimiter?: string): ReaderDriver {
  return {
    vendorId: 'mfi-sintetico',
    displayName: 'Lector MFi sintético',
    transports: [{ kind: 'mfi', params: { protocolString, ...(delimiter === undefined ? {} : { delimiter }) } }],
    frameParser: { parse: parseRs420Line },
    deviceMatch: { namePattern: /sintetico/i },
    streaming: true,
  };
}

// ─── RBM4.4 / RBM4.5: los cuatro desenlaces de `mfiAvailability` ────────────────────────────────────

test('RBM4.5: un driver que NO declara mfi → driver-sin-mfi (y el RS420 es ese caso, RBM4.6)', () => {
  assert.deepEqual(mfiAvailability(RS420_DRIVER, [SYNTHETIC_PROTOCOL]), {
    available: false,
    reason: 'driver-sin-mfi',
  });
  // RBM4.6 verificado sobre el driver REAL: el RS420 sigue sin declarar `mfi`. Si alguien le inventara
  // una `protocolString` para "destrabar iOS", este test cae — que es el punto.
  assert.equal(
    RS420_DRIVER.transports.some((t) => t.kind === 'mfi'),
    false,
    'el RS420 no puede declarar mfi hasta que el fabricante entregue la cadena (RBM4.6)',
  );
});

test('RBM4.2/RBM4.5: build SIN protocolos declarados → build-sin-protocolos (el estado de HOY)', () => {
  assert.deepEqual(mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), []), {
    available: false,
    reason: 'build-sin-protocolos',
  });
});

test('RBM4.5: el driver declara una cadena que el build NO declara → protocolo-no-declarado', () => {
  assert.deepEqual(mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), ['com.otro.cosa']), {
    available: false,
    reason: 'protocolo-no-declarado',
  });
});

test('RBM4.4/RBM4.7: build CON la cadena del driver → available (el diff del día que llegue el dato)', () => {
  // Este es el test ejecutable de RBM4.7: la única diferencia con el caso de arriba es EL DATO (la
  // cadena en la lista declarada). Cero código.
  assert.deepEqual(mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), [SYNTHETIC_PROTOCOL]), { available: true });
  // Y con varias declaradas, alcanza que esté la suya.
  assert.deepEqual(
    mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), ['com.uno.a', SYNTHETIC_PROTOCOL, 'com.tres.c']),
    { available: true },
  );
});

test('la comparación de la cadena es EXACTA: "casi igual" no abre ninguna sesión', () => {
  // iOS matchea el `protocolString` literalmente contra el del accesorio. Una comparación laxa diría
  // `available:true` sobre un plist que el SO va a rechazar — peor que decir la verdad, porque el CTA
  // prometería conectar.
  for (const casi of [
    SYNTHETIC_PROTOCOL.toUpperCase(),
    ` ${SYNTHETIC_PROTOCOL}`,
    `${SYNTHETIC_PROTOCOL}.`,
    SYNTHETIC_PROTOCOL.replace('-', '_'),
  ]) {
    assert.deepEqual(
      mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), [casi]),
      { available: false, reason: 'protocolo-no-declarado' },
      `'${casi}' no es la cadena declarada`,
    );
  }
});

test('los TRES motivos son distintos entre sí (si colapsaran, el copy de la UI no podría distinguirlos)', () => {
  // Anti-vacuidad: los tres tests de arriba pasarían igual si `mfiAvailability` devolviera SIEMPRE el
  // mismo `reason`. La UI usa el motivo para elegir entre "falta la autorización del fabricante" y
  // "todavía no lo soportamos", que son dos mensajes con dos expectativas distintas.
  const razones = [
    mfiAvailability(RS420_DRIVER, [SYNTHETIC_PROTOCOL]),
    mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), []),
    mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), ['com.otro.cosa']),
  ].map((r) => (r.available ? 'available' : r.reason));
  assert.equal(new Set(razones).size, 3, `los motivos colapsaron: ${razones.join(', ')}`);
});

// ─── La forma de lo leído del manifiesto (la mitad pura de `declaredEaProtocols`) ───────────────────

test('eaProtocolsFrom: solo strings no vacíos; cualquier otra forma → [] (fail-closed)', () => {
  assert.deepEqual(eaProtocolsFrom([SYNTHETIC_PROTOCOL, 'com.dos.b']), [SYNTHETIC_PROTOCOL, 'com.dos.b']);
  assert.deepEqual(eaProtocolsFrom([]), []);
  // Un array con basura adentro no descarta la lista entera, pero la basura no se convierte en protocolo.
  assert.deepEqual(eaProtocolsFrom([SYNTHETIC_PROTOCOL, 42, null, '', { a: 1 }]), [SYNTHETIC_PROTOCOL]);
  // Y lo que no es lista es `[]`: la clave ausente, un string suelto, un objeto.
  for (const raro of [undefined, null, 'com.uno.a', 42, { 0: 'com.uno.a' }, true]) {
    assert.deepEqual(eaProtocolsFrom(raro), [], `no es una lista: ${JSON.stringify(raro)}`);
  }
});

test('RBM4.2: sin runtime de expo (node/CI) `declaredEaProtocols()` es [] → nada de MFi disponible', () => {
  // Declarado como lo que es: en node no hay manifiesto, así que esto ejercita el camino FAIL-CLOSED
  // (que es el que importa: si por cualquier motivo no se puede leer la lista, no se intenta abrir una
  // sesión que fallaría). El filtrado se prueba arriba, con la mitad pura.
  assert.deepEqual(declaredEaProtocols(), []);
});

test('GUARD: la clave que leemos es LA MISMA que declara `app.config.ts` (si no, la lista es siempre [])', () => {
  // Mundo malo, y es silencioso: si alguien renombra la clave acá (o en la config), `declaredEaProtocols`
  // lee `undefined` para siempre → MFi queda `build-sin-protocolos` incluso el día que la cadena del
  // fabricante esté declarada, y RBM4.7 ("cero código ese día") deja de ser cierto sin que nada se ponga
  // rojo. Las dos puntas del mismo nombre tienen que coincidir.
  assert.equal(EA_PROTOCOLS_INFO_PLIST_KEY, 'UISupportedExternalAccessoryProtocols');
  const config = readFileSync(resolve(HERE, '..', '..', '..', 'app.config.ts'), 'utf8');
  assert.ok(
    config.includes(EA_PROTOCOLS_INFO_PLIST_KEY),
    `app.config.ts no declara '${EA_PROTOCOLS_INFO_PLIST_KEY}' (RBM4.3: la clave no se saca nunca, la lista vacía es el guard anti-crash)`,
  );
});

test('RBM4.7 de punta a punta: la cadena puesta en la config REAL la levanta el camino de producción', () => {
  // El test ejecutable del "cero código el día que llegue el dato": se toma la config de verdad
  // (`app.config.ts`, función pura de `process.env`), se le agrega la cadena sintética EN EL MISMO LUGAR
  // donde va a ir la real —`ios.infoPlist[KEY]`— y se lee con la MISMA función que consume producción
  // (`declaredEaProtocols` no hace nada más que traer `expoConfig` y llamar a esta). O sea: el diff de ese
  // día es UN DATO, ejecutado acá.
  const c = appConfig();
  const conLaCadena = {
    ...c,
    ios: { ...c.ios, infoPlist: { ...(c.ios?.infoPlist ?? {}), [EA_PROTOCOLS_INFO_PLIST_KEY]: [SYNTHETIC_PROTOCOL] } },
  };
  assert.deepEqual(eaProtocolsFromExpoConfig(conLaCadena), [SYNTHETIC_PROTOCOL]);
  // Y el binding del driver que la declara pasa a DISPONIBLE con eso solo (la otra punta de RBM4.4).
  assert.deepEqual(mfiAvailability(mfiDriver(SYNTHETIC_PROTOCOL), eaProtocolsFromExpoConfig(conLaCadena)), {
    available: true,
  });
  // Hoy, sin tocar nada, la config real da `[]` (RBM4.6: no se inventa ninguna cadena).
  assert.deepEqual(eaProtocolsFromExpoConfig(c), []);
  // Fail-closed sobre cualquier forma rara del manifiesto (y sobre "la clave se movió de rama").
  for (const raro of [undefined, null, {}, { ios: {} }, { ios: { infoPlist: {} } }, { ios: { entitlements: { [EA_PROTOCOLS_INFO_PLIST_KEY]: [SYNTHETIC_PROTOCOL] } } }, 'x', 42]) {
    assert.deepEqual(eaProtocolsFromExpoConfig(raro), [], `no es un manifiesto con la clave: ${JSON.stringify(raro)}`);
  }
});

test('GUARD: y está en LA MISMA RUTA que leemos (`ios.infoPlist`), no solo en algún lugar del archivo', () => {
  // El guard de arriba mira el TEXTO del archivo: sobrevive si alguien mueve la clave a las props de un
  // plugin, a `ios.entitlements` o a un `extra`. `declaredEaProtocols()` lee exactamente
  // `expoConfig.ios.infoPlist[KEY]`, así que moverla deja la lista en `[]` PARA SIEMPRE y el día que la
  // cadena del fabricante llegue nadie se enteraría de que está declarada en el lugar equivocado.
  //
  // Se evalúa la config de verdad (es una función pura de `process.env.APP_VARIANT`; el `import type` de
  // expo se erasa bajo type-stripping) y se pasa el valor por la MISMA función que consume producción.
  const c = appConfig();
  const declarado = (c.ios?.infoPlist as Record<string, unknown> | undefined)?.[EA_PROTOCOLS_INFO_PLIST_KEY];
  assert.ok(
    Array.isArray(declarado),
    `\`ios.infoPlist.${EA_PROTOCOLS_INFO_PLIST_KEY}\` no es una lista en la ruta que lee declaredEaProtocols()`,
  );
  // Hoy tiene que estar VACÍA (RBM4.6: no se inventa la cadena de ningún fabricante). El día que llegue el
  // dato, este test cae y hay que actualizarlo A PROPÓSITO, con la cadena real a la vista.
  assert.deepEqual(eaProtocolsFrom(declarado), [], 'apareció una protocolString en el build: ¿es la real del fabricante?');
  // Y la forma declarada sobrevive el filtro: si alguien pusiera `{}` o `'com.x'` (no una lista), la
  // aserción de arriba ya cayó — pero además el filtro y la config coinciden en el tipo.
  assert.deepEqual(declarado, []);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// F5 — LAS PIEZAS PURAS DEL TRANSPORTE MFi (T5.2/T5.5). Cada una fija una decisión que salió de LEER el
// Swift instalado, no su README (RBM4.8), y la referencia al fuente está en el comentario del test.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

test('mfiDelimiterIsSupported: UN carácter ASCII, y nada más', () => {
  for (const ok of ['\n', '\r', '\u0003', 'X', ';']) {
    assert.equal(mfiDelimiterIsSupported(ok), true, `${JSON.stringify(ok)} es un carácter ASCII`);
  }
  for (const no of ['', '\r\n', 'END', 'é', undefined, null, 42, {}, ['\n']]) {
    assert.equal(mfiDelimiterIsSupported(no), false, `${JSON.stringify(no)} no puede framear en iOS`);
  }
});

test('DIFERENCIAL iOS vs Android: `\\r\\n` lo soporta el SPP y NO el MFi (y no se pueden unificar)', () => {
  // El mundo malo si alguien "unifica" los dos chequeos: en iOS el `read()` nativo consume el delimitador
  // con `index(after:)` —avanza UN carácter—, así que con `\r\n` el mensaje sale bien pero el `\n` queda al
  // frente del buffer y ARRANCA el mensaje siguiente: cada trama a partir de la segunda entra corrida un
  // byte y `parseRs420Line` la rechaza. En Android el nativo avanza `index + delimiter.length()` y funciona.
  assert.equal(sppDelimiterIsSupported('\r\n'), true, 'en Android el multi-carácter SÍ funciona');
  assert.equal(mfiDelimiterIsSupported('\r\n'), false, 'en iOS el multi-carácter NO');
  // Y la mitad que SÍ comparten: el vacío no sirve en ninguna de las dos ramas (devuelve todo el buffer).
  assert.equal(sppDelimiterIsSupported(''), false);
  assert.equal(mfiDelimiterIsSupported(''), false);
});

test('resolveMfiParams: la cadena Y el fin de trama salen DEL DRIVER (no de una constante del transporte)', () => {
  // Dos perfiles que difieren en los DOS campos: sin esto, un literal hardcodeado adentro del transporte y
  // el valor del driver serían los mismos bytes (la monocultura de fixture que el review de F3 midió).
  const a = resolveMfiParams(mfiDriver('com.uno.lector-a', '\n'));
  const b = resolveMfiParams(mfiDriver('com.dos.lector-b', '\r'));
  assert.deepEqual(a, { ok: true, params: { protocolString: 'com.uno.lector-a', delimiter: '\n' } });
  assert.deepEqual(b, { ok: true, params: { protocolString: 'com.dos.lector-b', delimiter: '\r' } });
  // ANTI-VACUIDAD: si los dos perfiles coincidieran, el test de arriba no probaría el origen de nada.
  assert.notEqual(a.ok && a.params.protocolString, b.ok && b.params.protocolString);
  assert.notEqual(a.ok && a.params.delimiter, b.ok && b.params.delimiter);
});

test('resolveMfiParams: sin `delimiter` declarado cae al del RS420 (`\\n`), que es un dato del LECTOR', () => {
  assert.deepEqual(resolveMfiParams(mfiDriver(SYNTHETIC_PROTOCOL)), {
    ok: true,
    params: { protocolString: SYNTHETIC_PROTOCOL, delimiter: SPP_DELIMITER },
  });
  assert.equal(SPP_DELIMITER, '\n');
});

test('resolveMfiParams: sus DOS motivos de fallo, distintos entre sí', () => {
  assert.deepEqual(resolveMfiParams(RS420_DRIVER), { ok: false, reason: 'driver-sin-mfi' });
  // Un delimitador declarado VACÍO tiene que llegar al chequeo y ser RECHAZADO con su motivo, no caer al
  // default en silencio (por eso el `??` y no el `||`). Y el multi-carácter, ídem.
  assert.deepEqual(resolveMfiParams(mfiDriver(SYNTHETIC_PROTOCOL, '')), {
    ok: false,
    reason: 'delimitador-no-soportado',
  });
  assert.deepEqual(resolveMfiParams(mfiDriver(SYNTHETIC_PROTOCOL, '\r\n')), {
    ok: false,
    reason: 'delimitador-no-soportado',
  });
});

test('mfiConnectOptions: EXACTAMENTE dos claves — y `charset` NO está (pasarlo CRASHEA la app en iOS)', () => {
  // El hallazgo nº4 del fuente: el nativo hace `String.Encoding.from(value as! CFStringEncoding)`, o sea un
  // force-cast a UInt32. `sppConnectOptions()` pasa `charset:'ascii'` (un STRING) y ese mismo objeto en iOS
  // **trapea en Swift** — no falla la conexión: se lleva la app. Por eso este transporte tiene su propio
  // constructor de opciones y NO reusa el del SPP.
  assert.deepEqual(mfiConnectOptions('\r'), { CONNECTION_TYPE: 'delimited', DELIMITER: '\r' });
  const claves = Object.keys(mfiConnectOptions('\n'));
  assert.deepEqual(claves.sort(), ['CONNECTION_TYPE', 'DELIMITER']);
  for (const clave of claves) {
    assert.equal(
      /charset|read_size/i.test(clave),
      false,
      `'${clave}': ni charset (force-cast → crash) ni read_size (el nativo lo sobrescribe con su default)`,
    );
  }
  // Y la contraprueba de que el peligro es REAL y no una precaución teórica: las opciones del SPP sí traen
  // un charset de tipo string. Si alguien "simplifica" reusándolas acá, este par de aserciones es lo que
  // documenta qué se rompe.
  const spp = sppConnectOptions('\n') as unknown as Record<string, unknown>;
  assert.equal(typeof spp.charset, 'string');
  assert.equal((mfiConnectOptions('\n') as unknown as Record<string, unknown>).charset, undefined);
  // `CONNECTION_TYPE` va en MAYÚSCULAS porque es el único nombre que la rama iOS lee
  // (`connectionOptions["CONNECTION_TYPE"] ?? "delimited"`): la variante en minúscula del SPP se ignora.
  assert.equal((mfiConnectOptions('\n') as unknown as Record<string, unknown>).connectionType, undefined);
});

// ─── Listar accesorios por protocolo (hallazgo nº1: en iOS NO hay descubrimiento) ────────────────────

test('normalizeMfiAccessories: id (o address), protocolStrings filtrados, dedup y orden estable', () => {
  const out = normalizeMfiAccessories([
    { name: 'Lector sintetico', address: 'SER-A', id: 'SER-A', protocolStrings: [SYNTHETIC_PROTOCOL] },
    { name: 'Balanza', id: 'SER-B', protocolStrings: ['com.otra.balanza'] },
    { name: null, id: 'SER-C', protocolStrings: [] },
    { name: 'Duplicado', id: 'SER-A', protocolStrings: ['com.otro.x'] }, // mismo id → se descarta
    { name: 'Sin id', protocolStrings: [SYNTHETIC_PROTOCOL] }, // sin id no hay sesión que abrir
    { name: 'Basura en protocolos', id: 'SER-D', protocolStrings: [42, '', null, 'com.ok.d'] },
    'no es un objeto',
    null,
  ]);
  // Orden por (nombre ?? id): Balanza, Basura…, Lector sintetico, SER-C. Con dos accesorios compatibles
  // prendidos, a cuál se conecta no puede depender del orden en que el SO los devuelva (RBM5.8).
  assert.deepEqual(
    out.map((a) => a.id),
    ['SER-B', 'SER-D', 'SER-A', 'SER-C'],
  );
  // El duplicado no pisó al primero (se conservó el que traía la cadena buena).
  assert.deepEqual(out.find((a) => a.id === 'SER-A')?.protocolStrings, [SYNTHETIC_PROTOCOL]);
  assert.deepEqual(out.find((a) => a.id === 'SER-D')?.protocolStrings, ['com.ok.d']);
  assert.equal(out.find((a) => a.id === 'SER-C')?.name, undefined);
  // Fail-closed sobre cualquier forma que no sea una lista.
  for (const raro of [undefined, null, {}, 'x', 42]) {
    assert.deepEqual(normalizeMfiAccessories(raro), [], `no es una lista: ${JSON.stringify(raro)}`);
  }
});

test('normalizeMfiAccessories: toma el `address` cuando no hay `id` (el nativo publica los DOS)', () => {
  const out = normalizeMfiAccessories([{ address: 'SOLO-ADDRESS', protocolStrings: [SYNTHETIC_PROTOCOL] }]);
  assert.deepEqual(out, [{ id: 'SOLO-ADDRESS', protocolStrings: [SYNTHETIC_PROTOCOL] }]);
});

// ─── HALLAZGO Nº7: el wrapper JS de la lib SE COME `protocolStrings` (y sin esto el transporte no anda) ──

test('HALLAZGO 7: `protocolStrings` también se lee del `_nativeDevice` del wrapper de la lib', () => {
  // El mundo malo, medido leyendo el fuente instalado: `BluetoothModule.getBondedDevices()` NO devuelve los
  // diccionarios del nativo, devuelve un `BluetoothDevice` por cada uno, y ese wrapper copia
  // `name/address/id/bonded/deviceClass/rssi/type/extra` — **no `protocolStrings`** (queda en su campo
  // privado `_nativeDevice`). Si el normalizador leyera solo la forma cruda, TODO accesorio saldría con
  // `protocolStrings: []`, `pickMfiAccessory` devolvería `null` SIEMPRE y el transporte quedaría clavado en
  // `mfi_accessory_not_found` — o sea RBM4.7 falso el día que llegue la cadena del fabricante, con el
  // síntoma más caro de esta unidad ("no pasa nada"). Es la lección literal del SPP (RBM4.8): la forma sale
  // de leer el código instalado, no el README.
  const wrapper = {
    name: 'ACME-Reader-9000',
    address: 'SER-W',
    id: 'SER-W',
    bonded: true,
    type: 'CLASSIC',
    extra: {},
    _nativeDevice: { name: 'ACME-Reader-9000', address: 'SER-W', id: 'SER-W', protocolStrings: [SYNTHETIC_PROTOCOL] },
  };
  const out = normalizeMfiAccessories([wrapper]);
  assert.deepEqual(out, [{ id: 'SER-W', name: 'ACME-Reader-9000', protocolStrings: [SYNTHETIC_PROTOCOL] }]);
  // Y la consecuencia, que es lo que de verdad importa: el accesorio se PUEDE elegir por protocolo.
  assert.equal(pickMfiAccessory(out, SYNTHETIC_PROTOCOL)?.id, 'SER-W');
  // La forma cruda del nativo sigue ganando cuando está (no se depende del campo privado si no hace falta),
  // y una lista MEZCLADA —que es lo que pasaría si la lib cambiara de capa a mitad de camino— se normaliza
  // igual.
  const mezcla = normalizeMfiAccessories([
    { id: 'CRUDO', protocolStrings: [SYNTHETIC_PROTOCOL] },
    { id: 'ENVUELTO', _nativeDevice: { protocolStrings: [SYNTHETIC_PROTOCOL] } },
    // Ni una ni la otra: sin cadenas. No se cuelga y no inventa.
    { id: 'PELADO' },
    // El privado con basura adentro pasa por el MISMO filtro de forma que la clave directa.
    { id: 'BASURA', _nativeDevice: { protocolStrings: [42, '', null, 'com.ok.z'] } },
  ]);
  assert.deepEqual(
    mezcla.map((a) => [a.id, a.protocolStrings]),
    [
      ['BASURA', ['com.ok.z']],
      ['CRUDO', [SYNTHETIC_PROTOCOL]],
      ['ENVUELTO', [SYNTHETIC_PROTOCOL]],
      ['PELADO', []],
    ],
  );
});

test('GUARD (RBM4.8): el fuente INSTALADO sigue teniendo las dos formas que el normalizador tolera', () => {
  // Este guard existe porque `_nativeDevice` es un campo PRIVADO de la librería: un rename ahí, o que el
  // wrapper empiece a copiar `protocolStrings` con otro nombre, dejaría la lista de accesorios en `[]` **en
  // silencio** (el peor modo de falla de este transporte: indistinguible de "el bastón está apagado"). Se
  // DERIVA del paquete instalado, así que un `pnpm update` que cambie la forma nace en rojo en vez de mudo.
  const pkg = resolve(HERE, '..', '..', '..', 'node_modules', 'react-native-bluetooth-classic');
  const nativeMap = readFileSync(resolve(pkg, 'ios', 'device', 'NativeDevice.swift'), 'utf8');
  const wrapper = readFileSync(resolve(pkg, 'lib', 'BluetoothDevice.js'), 'utf8');

  // (a) El NATIVO sí publica la clave, y de `accessory.protocolStrings` (si dejara de hacerlo, no habría
  //     forma de filtrar por protocolo en JS y el alcance del transporte cambiaría → parar y reportar).
  assert.match(
    nativeMap,
    /"protocolStrings":\s*accessory\.protocolStrings/,
    'el mapa nativo dejó de publicar protocolStrings: sin ese dato no se puede elegir el accesorio por protocolo (RBM4.8)',
  );
  // (b) El WRAPPER no la copia — es la mitad que obliga a leer el privado. Si algún día la copiara, este
  //     test cae y el `_nativeDevice` pasa a ser innecesario (una simplificación, no un bug).
  assert.equal(
    /this\.protocolStrings\s*=/.test(wrapper),
    false,
    'el wrapper de la lib ahora SÍ copia protocolStrings: se puede simplificar `mfiProtocolStringsOf` (y hay que actualizar este guard a propósito)',
  );
  // (c) …y conserva el diccionario crudo en el campo del que lo leemos.
  assert.match(
    wrapper,
    /this\._nativeDevice\s*=\s*nativeDevice;/,
    'el wrapper dejó de conservar `_nativeDevice`: la lista de accesorios saldría SIN protocolos y el transporte quedaría mudo',
  );
  // (d) Y la capa que devuelve wrappers es la que el adapter llama: `getBondedDevices()` los construye.
  const module = readFileSync(resolve(pkg, 'lib', 'BluetoothModule.js'), 'utf8');
  assert.match(
    module,
    /getBondedDevices\(\)\s*\{[\s\S]*?new BluetoothDevice\(device, this\)/,
    '`getBondedDevices()` dejó de envolver los diccionarios: revisá de qué forma llega la lista',
  );
});

test('pickMfiAccessory: elige POR PROTOCOLO — el nombre no entra (es el error simétrico de RBM5.13)', () => {
  const accesorios = normalizeMfiAccessories([
    // El nombre matchea el `deviceMatch` del driver sintético (`/sintetico/i`) pero NO declara la cadena:
    // no se puede abrir sesión con él, así que elegirlo sería un `connect_failed` garantizado.
    { id: 'IMPOSTOR', name: 'Lector sintetico viejo', protocolStrings: ['com.otro.cosa'] },
    // Este declara la cadena y tiene un nombre que NO matchea ningún patrón nuestro: es el correcto.
    { id: 'BUENO', name: 'ACME-Reader-9000', protocolStrings: ['com.previo.x', SYNTHETIC_PROTOCOL] },
  ]);
  assert.equal(pickMfiAccessory(accesorios, SYNTHETIC_PROTOCOL)?.id, 'BUENO');
  // Control negativo del mismo par: sin nadie que declare la cadena, `null` (y NO el impostor).
  assert.equal(pickMfiAccessory(accesorios, 'com.nadie.declara'), null);
  // Y la comparación es EXACTA, igual que en `mfiAvailability` (el SO matchea literal).
  assert.equal(pickMfiAccessory(accesorios, SYNTHETIC_PROTOCOL.toUpperCase()), null);
  assert.equal(pickMfiAccessory([], SYNTHETIC_PROTOCOL), null);
});

// ─── Clasificar el rechazo del nativo, y qué hacer con cada motivo ──────────────────────────────────

test('classifyMfiConnectError: cada `reject(abbr)` del Swift cae en SU motivo (por code y por mensaje)', () => {
  const casos: [unknown, MfiConnectFailure][] = [
    [{ code: 'bluetooth_disabled', message: 'Bluetooth is not enabled' }, 'radio-apagada'],
    [{ code: 'device_not_found', message: 'Device is not currently bonded/paired' }, 'accesorio-ausente'],
    [{ code: 'connect_failed', message: 'Device could not establish connection' }, 'protocolo-rechazado'],
    [{ code: 'connection_failed', message: 'Could not connect to EAAccessory' }, 'sesion-fallida'],
    [{ code: 'invalid_connection_type', message: 'Invalid connection type' }, 'opciones-invalidas'],
    // Sin `code` (algunas capas del puente solo dejan el mensaje): el mensaje también es literal del nativo.
    [new Error('Bluetooth is not enabled'), 'radio-apagada'],
    [{ message: 'Could not connect to EAAccessory' }, 'sesion-fallida'],
    // Formas inesperadas → 'error', sin tirar.
    [undefined, 'error'],
    [null, 'error'],
    ['string suelto', 'error'],
    [{ code: 42 }, 'error'],
    [new Error('boom'), 'error'],
  ];
  for (const [error, esperado] of casos) {
    assert.equal(classifyMfiConnectError(error), esperado, `${JSON.stringify(error)} → ${esperado}`);
  }
  // ANTI-VACUIDAD: la tabla de casos tiene que producir motivos DISTINTOS (si el clasificador devolviera
  // siempre lo mismo, la mitad de arriba pasaría igual).
  assert.equal(new Set(casos.map(([e]) => classifyMfiConnectError(e))).size, 6);
});

test('`connect_failed` (201, sin protocolo) y `connection_failed` (200, EASession) NO se confunden', () => {
  // Son dos códigos del nativo con dos ACCIONES distintas, y un `includes("connect")` los mezclaría: el
  // primero no se arregla con ningún reintento (hace falta otro build), el segundo sí puede ser transitorio.
  assert.equal(classifyMfiConnectError({ code: 'connect_failed' }), 'protocolo-rechazado');
  assert.equal(classifyMfiConnectError({ code: 'connection_failed' }), 'sesion-fallida');
  assert.notEqual(mfiConnectRetryPolicy('protocolo-rechazado'), mfiConnectRetryPolicy('sesion-fallida'));
});

test('la política de reintento es una TABLA exhaustiva, y no todo es "reintentar"', () => {
  // El `satisfies Record<MfiConnectFailure, …>` del fuente es el ancla de compilación (el typecheck del
  // repo NO mira los tests): un motivo nuevo no compila hasta declarar su política. Acá se fija el conjunto
  // y —lo que importa— que la tabla DISCRIMINE: si todo fuera 'retry', el adapter martillaría la radio para
  // siempre por una cadena de protocolo que este build no declara.
  assert.deepEqual(Object.keys(MFI_CONNECT_RETRY).sort(), [
    'accesorio-ausente',
    'error',
    'opciones-invalidas',
    'protocolo-rechazado',
    'radio-apagada',
    'sesion-fallida',
  ]);
  const paran = Object.entries(MFI_CONNECT_RETRY)
    .filter(([, v]) => v === 'stop')
    .map(([k]) => k)
    .sort();
  assert.deepEqual(paran, ['opciones-invalidas', 'protocolo-rechazado']);
  assert.ok(Object.values(MFI_CONNECT_RETRY).includes('retry'), 'ANTI-VACUIDAD: nada se reintentaría');
});
