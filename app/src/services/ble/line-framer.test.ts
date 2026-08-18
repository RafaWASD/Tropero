// Tests del `LineFramer` — el reensamblador de trama del transporte (R5.3, RBM2.8/2.9, RBM2.19).
// node:test, PURO (sin RN, sin radio, sin device).
//
// ── POR QUÉ ESTE ARCHIVO NACE RECIÉN AHORA, Y QUÉ CUBRE QUE NO ESTABA CUBIERTO ──────────────────
// El framer existe desde el harness de Web Serial y NUNCA tuvo suite propia: su comportamiento se
// verificaba de refilón en `adapter-web-serial.test.ts` (framing por `\n`) y en
// `ble-gatt-protocol.test.ts` (troceo de 20 bytes, delimitador del lector). Los dos miran el CAMINO
// FELIZ. El invariante que faltaba —que el buffer TENGA UN TOPE— no lo vigilaba nada, y lo señaló el
// Gate 2 del delta `ios-ble-mfi` como HIGH-1: hasta este delta el único call site de producción era web
// y detrás del gesto obligatorio de `requestPort()`; `adapter-ble-gatt` es el primero NATIVO, sobre la
// radio, y que auto-conecta sin gesto.
//
// Lo que esta suite exige, y que ninguna otra puede dar:
//   (a) el CASO LEGÍTIMO sigue intacto: una trama partida en notificaciones de 20 bytes se reensambla
//       (el tope no puede pagarse rompiendo el motivo por el que el framer existe);
//   (b) un chorro SIN fin de trama no crece sin límite, deja un evento DISTINGUIBLE, y el framer no
//       queda envenenado después;
//   (c) el tope no es una opción que un call site pueda apagar;
//   (d) el costo por notificación no vuelve a ser cuadrático.
//
// MUTANTES QUE ESTA SUITE MATA (verificados a mano, no supuestos — ver progress/impl_ios-ble-mfi-gate2-fix.md):
//   M1. borrar el bloque del tope en `push()`                     → "el buffer NO crece sin límite" + "el descarte se DICE"
//   M2. truncar en silencio (descartar sin `logTransportEvent`)   → "el descarte se DICE, y es DISTINGUIBLE"
//   M3. dejar que `maxBufferChars = 0` signifique "sin tope"      → "el tope no es opcional"
//   M4. emitir la línea sin cabeza post-descarte (sin resync)     → "la trama recortada NO se ingiere"
//   M5. quitar el tope ante la carga del test de costo            → el presupuesto de tiempo (2200 ms vs 500)
//   M6. no consumir el delimitador COMPLETO (multi-carácter)     → "CR+LF partido entre dos chunks"
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LineFramer, LINE_FRAMER_MAX_BUFFER } from './line-framer.ts';
import { parseRs420Line } from './parser-rs420.ts';
import { BLE_DEFAULT_NOTIFY_PAYLOAD } from './ble-gatt-protocol.ts';

/** Trama real capturada en el campo, sin su fin de trama (lo pone cada test). */
const FRAME_BODY = '\x021000000982000364696050260530101701';
const EID_982 = '982000364696050';

/** Parte un texto en trozos de `size` caracteres, como el troceo por MTU de una notificación GATT. */
function chunk(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Captura los eventos de `logTransportEvent` (console.info('[ble]', kind, json)) del bloque. */
function withLogs(fn: () => void): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const original = console.info;
  // eslint-disable-next-line no-console
  console.info = (...args: unknown[]) => {
    if (args[0] === '[ble]') events.push(JSON.parse(String(args[2])) as Record<string, unknown>);
  };
  try {
    fn();
  } finally {
    // eslint-disable-next-line no-console
    console.info = original;
  }
  return events;
}

/**
 * Los descartes por tope que emitió el bloque. Sale como SUB-EVENTO POR MENSAJE de `read_loop_error`
 * (`ble_framer_overflow: …`), que es la forma que ya usan `ble_decode_failed` / `ble_monitor_lost` /
 * `ble_scan_error` en este transporte: una entrada que llega y se descarta es esa misma familia. El
 * filtro exige las DOS mitades (kind + prefijo) para que un `read_loop_error` cualquiera no lo satisfaga.
 */
function overflows(events: Array<Record<string, unknown>>): string[] {
  return events
    .filter((e) => e.kind === 'read_loop_error' && String(e.message).startsWith('ble_framer_overflow:'))
    .map((e) => String(e.message));
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A. El caso LEGÍTIMO, que el tope no puede romper (RBM2.8/2.9/2.12)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.8/2.12: la trama partida en notificaciones de 20 bytes se reensambla en UNA lectura', () => {
  // Es el motivo por el que el framer existe: en BLE el payload por notificación con el MTU por defecto
  // son 20 bytes y la trama del lector mide 35. Si el tope rompiera esto, el arreglo de HIGH-1 se habría
  // pagado con el transporte entero.
  const framer = new LineFramer();
  const trozos = chunk(`${FRAME_BODY}\n`, BLE_DEFAULT_NOTIFY_PAYLOAD);
  assert.ok(trozos.length >= 2, 'el fixture tiene que partirse de verdad (si no, no prueba nada)');
  const lines: string[] = [];
  const eventos = withLogs(() => {
    for (const t of trozos) lines.push(...framer.push(t));
  });
  assert.equal(lines.length, 1, 'las 2 notificaciones son UNA trama');
  assert.deepEqual(parseRs420Line(lines[0]), { eid: EID_982 }, 'y el EID sale entero del parser real');
  assert.deepEqual(eventos, [], 'el camino normal no loguea nada');
  assert.equal(framer.pending, 0, 'la trama cerrada no queda pendiente en el buffer');
});

test('una trama partida de a UN carácter también se reensambla (el peor troceo posible)', () => {
  const framer = new LineFramer();
  const lines: string[] = [];
  for (const c of `${FRAME_BODY}\n`) lines.push(...framer.push(c));
  assert.deepEqual(lines.map((l) => parseRs420Line(l)?.eid), [EID_982]);
});

test('RBM2.19: una RÁFAGA legítima de 500 tramas NO se acerca al tope', () => {
  // El malentendido natural del tope sería creer que acota "cuántas lecturas entran juntas". No: lo que
  // queda pendiente es solo el PEDAZO que todavía no cerró trama, porque las que cerraron se emiten y se
  // descartan en el mismo push. Sin este test, bajar el tope a un valor absurdo (35) pasaría verde.
  const framer = new LineFramer();
  const rafaga = Array.from({ length: 500 }, () => `${FRAME_BODY}\n`).join('');
  const eventos = withLogs(() => {
    const lines = framer.push(rafaga);
    assert.equal(lines.length, 500, 'las 500 tramas pegadas son 500 lecturas (RBM2.9)');
  });
  assert.deepEqual(eventos, [], 'una ráfaga legítima NO puede disparar el tope');
  assert.equal(framer.pending, 0);
});

test('RBM2.8: un fin de trama de DOS caracteres (CR+LF) partido entre dos chunks corta igual', () => {
  // El caso que el troceo de 20 bytes del BLE produce solo: el fin de trama de dos caracteres cae partido
  // entre dos notificaciones —el CR queda en la cola del buffer y el LF abre el chunk siguiente—. Es
  // además el primero que rompe cualquier "optimización" de la búsqueda del delimitador: se midió una
  // (arrancar el `indexOf` en el solape en vez de en 0) y se DESCARTÓ, porque dentro del tope no movía el
  // tiempo (números en el test de costo) y no se paga riesgo de framing por una mejora de cero.
  const framer = new LineFramer('\r\n');
  assert.deepEqual(framer.push('uno\r'), [], 'todavía no cerró: el delimitador está a medio llegar');
  assert.deepEqual(framer.push('\ndos\r\n'), ['uno', 'dos']);
  assert.equal(framer.pending, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// B. El tope: fail-closed con log distinguible (RBM2.19 — HIGH-1 del Gate 2)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** El chorro del mundo malo: bytes plausibles y NINGÚN fin de trama. */
function flood(framer: LineFramer, totalChars: number, chunkSize = BLE_DEFAULT_NOTIFY_PAYLOAD): string[][] {
  const out: string[][] = [];
  const payload = '9'.repeat(chunkSize);
  for (let sent = 0; sent < totalChars; sent += chunkSize) out.push(framer.push(payload));
  return out;
}

test('RBM2.19: un chorro SIN fin de trama no hace crecer el buffer sin límite', () => {
  // EL MUTANTE QUE ESTE TEST MATA (M1): borrar el bloque del tope. Sin él, `pending` termina valiendo
  // 1.000.000 y esta aserción cae. El daño real llega antes por CPU que por memoria (el `indexOf` barre
  // el buffer entero por notificación), y eso se lleva el proceso → se lleva la CARGA MANUAL, que es ley
  // (R7.2 / RBM9.5).
  const framer = new LineFramer();
  withLogs(() => {
    for (const emitidas of flood(framer, 1_000_000)) {
      assert.deepEqual(emitidas, [], 'sin fin de trama no hay línea que emitir');
    }
  });
  assert.ok(
    framer.pending <= LINE_FRAMER_MAX_BUFFER,
    `el buffer quedó en ${framer.pending} caracteres con un tope de ${LINE_FRAMER_MAX_BUFFER}`,
  );
});

test('RBM2.19: el descarte se DICE, con su prefijo propio y con el tamaño (no es un silencio)', () => {
  // EL MUTANTE QUE ESTE TEST MATA (M2): descartar sin loguear. Un truncado silencioso deja el síntoma
  // "el bastón no lee" indistinguible de "el operario no está bastoneando" — la clase de bug que esta
  // unidad entera viene cerrando (RBM1.4). Y tiene que ser DISTINGUIBLE de la mudez: `connected_silent`
  // significa lo contrario (no llegan bytes) y encima el chorro lo mantenía en verde permanente.
  const framer = new LineFramer('\n', 64);
  const eventos = withLogs(() => flood(framer, 200, 20));
  const overflow = overflows(eventos);
  assert.equal(overflow.length >= 1, true, `no se dijo nada: ${JSON.stringify(eventos)}`);
  assert.ok(overflow[0].endsWith('de tope 64'), `el evento dice CUÁL era el tope: ${overflow[0]}`);
  const tirados = Number(overflow[0].split('descartados ')[1].split(' ')[0]);
  assert.ok(
    Number.isFinite(tirados) && tirados > 64,
    `el evento dice CUÁNTO se tiró (si no, el descarte no se puede dimensionar): ${overflow[0]}`,
  );
  assert.equal(
    eventos.some((e) => e.kind === 'connected_silent'),
    false,
    'el descarte NO puede confundirse con la mudez: son causas opuestas',
  );
});

/**
 * Un `push` con su cosecha: las LÍNEAS que devolvió y los EVENTOS que emitió por el camino. `withLogs`
 * sola devuelve los eventos, así que compararla contra las líneas esperadas es un verde/rojo mentiroso.
 */
function pushed(framer: LineFramer, chunk: string): { lines: string[]; events: Array<Record<string, unknown>> } {
  let lines: string[] = [];
  const events = withLogs(() => {
    lines = framer.push(chunk);
  });
  return { lines, events };
}

test('RBM2.19: después del descarte el framer SIGUE leyendo, y la trama SIN CABEZA no se ingiere', () => {
  // Dos cosas en un solo oráculo, porque son la misma vuelta del stream:
  //  (a) NO QUEDA ENVENENADO. Si el tope dejara el framer inutilizable, el arreglo sería un modo de falla
  //      nuevo: el operario tendría que reconectar el bastón para volver a leer y nadie le diría por qué.
  //  (b) LA PRIMERA LÍNEA POST-DESCARTE SE TIRA (mutante M4). De ese pedazo tiramos el principio, así que
  //      no sabemos dónde arranca. Emitirla sería entregarle al `frameParser` una trama recortada por un
  //      lugar arbitrario; para el RS420 de hoy eso da `null`, pero el delta existe para que entren
  //      parsers de otros fabricantes (RBM1.1/RBM1.6) y uno que BUSQUE el EID en vez de anclarlo podría
  //      extraer un EID que nadie leyó. Un EID inventado es lo único inaceptable de este camino (RBM1.8).
  const framer = new LineFramer('\n', 64);
  const overflow = withLogs(() => flood(framer, 200, 20));
  assert.ok(
    overflows(overflow).length >= 1,
    'precondición: el tope tiene que haber disparado (si no, el resto del test no prueba nada)',
  );

  // Llega la COLA del pedazo que se descartó (recién ahí cierra trama) y detrás una trama entera y buena.
  const primero = pushed(framer, `999999999999999\n${FRAME_BODY}\n`);
  assert.deepEqual(
    primero.lines,
    [FRAME_BODY],
    'la cola sin cabeza se descarta y la trama COMPLETA que viene atrás sí se emite',
  );
  assert.deepEqual(parseRs420Line(primero.lines[0]), { eid: EID_982 });
  assert.deepEqual(primero.events, [], 'recuperarse no vuelve a loguear: el descarte ya se dijo');
  assert.equal(framer.pending, 0);

  // Y a partir de acá es un framer normal: no arrastra el estado de resync.
  assert.deepEqual(pushed(framer, `${FRAME_BODY}\n`).lines, [FRAME_BODY]);
});

test('RBM2.19: `flush()` después de un descarte NO devuelve el fragmento sin cabeza', () => {
  // `flush()` es "el puerto se cierra, dame lo que quede". Lo que queda después de un descarte es un
  // pedazo del que tiramos el principio: devolverlo lo manda igual al parser por el camino del cierre,
  // que es la misma ingesta de una trama recortada, por la puerta de al lado.
  const framer = new LineFramer('\n', 64);
  withLogs(() => flood(framer, 200, 20));
  framer.push('cola-sin-cabeza');
  assert.equal(framer.flush(), null);
  // Y el flag se limpia: el framer que sigue vivo después del flush vuelve a emitir normal.
  assert.deepEqual(pushed(framer, `${FRAME_BODY}\n`).lines, [FRAME_BODY]);
});

test('RBM2.19: `reset()` limpia el buffer Y el estado de resync (link nuevo, framer nuevo)', () => {
  const framer = new LineFramer('\n', 64);
  withLogs(() => flood(framer, 200, 20));
  framer.reset();
  assert.equal(framer.pending, 0);
  // Tras un reset el framer arranca de cero: la primera línea que cierre es legítima (el arrastre de un
  // link caído al link siguiente es el bug que costó la primera lectura buena en el SPP, banco §4.4).
  assert.deepEqual(pushed(framer, `${FRAME_BODY}\n`).lines, [FRAME_BODY]);
});

test('RBM2.19: el tope NO es opcional — un valor inválido cae al default, nunca a "sin tope"', () => {
  // EL MUTANTE QUE ESTE TEST MATA (M3): tratar `0` (o `Infinity`, o un `NaN` que venga de un `parseInt`)
  // como "sin límite". Un invariante de seguridad que un call site puede apagar pasando un número no es
  // un invariante: es una opción, y una opción se elige mal exactamente una vez.
  for (const malo of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const framer = new LineFramer('\n', malo);
    const eventos = withLogs(() => flood(framer, LINE_FRAMER_MAX_BUFFER * 3));
    const overflow = overflows(eventos);
    assert.ok(overflow.length >= 1, `con maxBufferChars=${String(malo)} el tope no disparó`);
    assert.ok(
      overflow[0].endsWith(`de tope ${LINE_FRAMER_MAX_BUFFER}`),
      `el tope efectivo tiene que ser el default y no el valor malo: ${overflow[0]}`,
    );
    assert.ok(framer.pending <= LINE_FRAMER_MAX_BUFFER);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// C. Costo por notificación: acotado Y no cuadrático
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('RBM2.19: 25.000 notificaciones de un chorro sin trama se procesan dentro del presupuesto', () => {
  // POR QUÉ HAY UN TEST DE TIEMPO ACÁ, que normalmente no se hace: el modo de falla de HIGH-1 NO era
  // memoria, era CPU. Sin tope, cada notificación vuelve a APLANAR un buffer que crece (el `indexOf`
  // necesita la cadena plana), así que el costo es cuadrático en el total y el hilo de JS —el mismo que
  // dibuja la pantalla que el operario está usando en la manga— se muere mucho antes que la RAM. Un test
  // que solo mirara `pending` no distinguiría "acotado" de "acotado y barato".
  //
  // MEDIDO en esta máquina con esta misma carga (500 KB en notificaciones de 20 bytes):
  //   · as-built (con tope) ..........   4-6 ms
  //   · SIN TOPE ................. 2200-2450 ms
  // O sea: lo que mantiene el costo lineal es EL TOPE, y nada más. Se midió además una optimización del
  // barrido (arrancar el `indexOf` en el solape en vez de en 0, O(chunk) en vez de O(buffer)): DENTRO del
  // tope no movía el tiempo, así que se descartó — no se paga riesgo de framing por una mejora de cero.
  // El presupuesto queda flojo a propósito (500 ms = ~50× lo medido): vigila el ORDEN DE MAGNITUD.
  const framer = new LineFramer();
  const notificaciones = 25_000;
  const t0 = Date.now();
  withLogs(() => flood(framer, notificaciones * BLE_DEFAULT_NOTIFY_PAYLOAD));
  const ms = Date.now() - t0;
  assert.ok(
    ms < 500,
    `${notificaciones} notificaciones tardaron ${ms} ms: el costo por notificación volvió a crecer con lo acumulado`,
  );
  assert.ok(framer.pending <= LINE_FRAMER_MAX_BUFFER);
});

test('el framer no tira ni acumula con entradas degeneradas (chunk vacío / no-string)', () => {
  const framer = new LineFramer();
  assert.deepEqual(framer.push(''), []);
  assert.deepEqual(framer.push(undefined as unknown as string), []);
  assert.deepEqual(framer.push(null as unknown as string), []);
  assert.equal(framer.pending, 0);
  // Y una entrada degenerada no rompe la trama que estaba a medio llegar.
  framer.push(FRAME_BODY);
  framer.push('');
  assert.deepEqual(framer.push('\n'), [FRAME_BODY]);
});
