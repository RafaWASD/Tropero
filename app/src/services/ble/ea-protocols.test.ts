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
} from './ea-protocols.ts';
import appConfig from '../../../app.config.ts';
import { RS420_DRIVER } from './driver-rs420.ts';
import { parseRs420Line } from './parser-rs420.ts';
import type { ReaderDriver } from './driver-types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Cadena SINTÉTICA. No es la de ningún fabricante real: inventarla es justo lo que RBM4.6 prohíbe. */
const SYNTHETIC_PROTOCOL = 'com.ejemplo.lector-sintetico';

function mfiDriver(protocolString: string): ReaderDriver {
  return {
    vendorId: 'mfi-sintetico',
    displayName: 'Lector MFi sintético',
    transports: [{ kind: 'mfi', params: { protocolString } }],
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
