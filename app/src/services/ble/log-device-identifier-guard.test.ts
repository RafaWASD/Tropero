// GUARD SOBRE LA AUSENCIA — el identificador de un dispositivo NO puede terminar en el free-text de un
// log del transporte.
//
// ── QUÉ CIERRA (y por qué un guard y no tres fixes) ─────────────────────────────────────────────────
// El §7.2 del Gate 2 del delta `ios-ble-mfi` encontró la MAC de NUESTRO bastón viajando a los
// breadcrumbs de Sentry adentro del `message` de `ble_disconnected` / `ble_monitor_lost` /
// `ble_scan_error` / `logBridgeFailure`. La cadena era: los mensajes de las libs de Bluetooth
// INTERPOLAN el id del dispositivo, y los tres adapters tenían su propio `errorMessage(e)` que devolvía
// `e.message` crudo. El scrubber de `observability/redact.ts` es key-based: alcanza un CAMPO
// (`connect_superseded { deviceId }`), no un identificador embebido en un texto.
//
// Arreglar los tres call sites no cierra nada: la forma se re-escribe sola en el próximo adapter (el de
// MFi todavía no tiene módulo nativo, y cuando lo tenga va a rechazar con mensajes que llevan el serial
// del accesorio). Lo que cierra es **enumerar las superficies que loguean y exigir que NINGUNA lea el
// texto de un error por su cuenta**: el camino único es `safeErrorText` de `error-text.ts`, y un camino
// de log nuevo que interpole un identificador nace en rojo.
//
// ── LAS TRES REGLAS ─────────────────────────────────────────────────────────────────────────────────
//  A. Un archivo que llama a `logTransportEvent` NO lee el texto de un error por su cuenta (`.message`,
//     `String(e)`, `${e}`). El único convertidor es `safeErrorText`.
//  B. Ninguna EXPRESIÓN de un `message:` nombra un identificador de dispositivo — ni interpolada
//     (`${device.id}`) ni concatenada (`'x: ' + device.id`), que son la misma fuga con otra sintaxis.
//     (El TEXTO LITERAL sí puede: `ble_device_not_recognized` es el nombre del evento, no un id. Y el
//     CAMPO CON CLAVE también: `connect_superseded { deviceId }` es alcanzable por el scrubber.)
//  C. `error-text.ts` es el ÚNICO de `services/ble/` que define un convertidor error→texto. La copia a
//     mano es el bug de clase que ya nos costó el union `RejectReason` recopiado de `contract.ts`.
//
// ── LO QUE ESTO NO CUBRE (declarado, no descubierto después) ────────────────────────────────────────
// Un texto armado LEJOS del call site y logueado por una variable (`const msg = \`x ${device.id}\`;` en un
// archivo y `logTransportEvent({ message: msg })` en otro) se le escapa: eso es data flow, no un escaneo
// estático. Se acepta porque la fuga real no tenía esa forma —era el `.message` del error, leído en el
// mismo archivo que loguea, que es exactamente lo que la regla A cierra— y porque el barrido de
// COMPORTAMIENTO de las tres suites de adapter (`§7.2 …`) mira los eventos EMITIDOS, no el fuente: ahí
// el origen del string no importa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../../utils/strip-comments.ts';
import { assertScanCoverage } from '../../utils/scan-coverage.ts';

const HERE = resolve(fileURLToPath(import.meta.url), '..'); // app/src/services/ble
const APP_ROOT = resolve(HERE, '..', '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Ver `utils/scan-coverage.ts`. */
const SCANNED_FILES_FLOOR = 300;

/** El ÚNICO archivo autorizado a convertir un error en texto para un log. */
const CANONICAL = 'src/services/ble/error-text.ts';

/** Piso de superficies que loguean. Hoy son 6 (3 adapters + framer + provider + la pantalla de banco). */
const LOGGERS_FLOOR = 5;

const relOf = (file: string) => relative(APP_ROOT, file).split(sep).join('/');

function listFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__shots__') continue;
      found.push(...listFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      found.push(p);
    }
  }
  return found;
}

// ─── Las firmas ──────────────────────────────────────────────────────────────────────────────────

/**
 * Leer el texto de un error a mano. `\.message` cubre las dos grafías que había (`e.message` y el
 * `(e as { message?: unknown }).message` de los helpers viejos); las otras dos son las puertas de atrás
 * obvias, que dan el MISMO string.
 */
const LEE_EL_ERROR: { name: string; re: RegExp }[] = [
  { name: '.message', re: /\.\s*message\b/ },
  { name: 'String(error)', re: /\bString\(\s*(?:e|err|error|ex)\s*\)/ },
  { name: '${error}', re: /\$\{\s*(?:e|err|error|ex)\s*\}/ },
];

/** Nombres que denotan la IDENTIDAD de un dispositivo. `accessories` (una lista) no está: es un conteo. */
const IDENTIFICADOR =
  /\b(device|devices|deviceId|deviceID|device_id|address|addr|mac|serial|serialNumber|accessory|peripheral|target)\b/i;

/** Los convertidores error→texto escritos a mano (el nombre que tuvieron las tres copias, y sus primos). */
const CONVERTIDOR_LOCAL = /\b(?:function|const|let)\s+(errorMessage|errorText|messageOf|toMessage)\b/;

// ─── Extracción ──────────────────────────────────────────────────────────────────────────────────

/** Texto de cada llamada a `logTransportEvent(...)`, balanceando paréntesis. */
function logCalls(code: string): string[] {
  const out: string[] = [];
  const needle = 'logTransportEvent(';
  let from = 0;
  for (;;) {
    const at = code.indexOf(needle, from);
    if (at === -1) return out;
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(code.slice(at, i + 1));
    from = i + 1;
  }
}

/**
 * Valores del campo `message:` dentro de una llamada. Corta en la `,` o la `}` de nivel cero, contando
 * comillas: un `,` adentro de un template (o de un `${…}`, que vive adentro del template) no corta.
 */
function messageValues(call: string): string[] {
  const out: string[] = [];
  const re = /\bmessage\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(call)) != null) {
    const start = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    let i = start;
    for (; i < call.length; i++) {
      const ch = call[i];
      if (quote != null) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === '}') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) break;
    }
    out.push(call.slice(start, i).trim());
  }
  return out;
}

/**
 * La parte EXPRESIÓN de un valor de `message`: lo que está adentro de un `${…}` más lo que está fuera de
 * toda comilla (o sea, los operandos de una concatenación). El texto literal se descarta — si no, el
 * nombre del evento (`ble_device_not_recognized`) dispararía la regla y el guard se terminaría apagando.
 *
 * Cubrir la concatenación no es teórico: `message: 'x: ' + device.id` es la misma fuga con otra sintaxis,
 * y un extractor que solo mirara `${…}` la dejaría pasar en silencio.
 */
function expresiones(value: string): string {
  // Los argumentos de `safeErrorText(…)` son el camino sano: se saca la llamada entera (con un nivel de
  // paréntesis anidados) para que su segundo argumento —el `target`— no cuente como fuga.
  const limpio = value.replace(/safeErrorText\s*\((?:[^()]|\([^()]*\))*\)/g, '<safe>');
  let out = '';
  let i = 0;
  while (i < limpio.length) {
    const ch = limpio[i];
    if (ch === "'" || ch === '"') {
      i++;
      while (i < limpio.length && limpio[i] !== ch) i += limpio[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < limpio.length && limpio[i] !== '`') {
        if (limpio[i] === '\\') {
          i += 2;
          continue;
        }
        if (limpio[i] === '$' && limpio[i + 1] === '{') {
          i += 2;
          let depth = 1;
          while (i < limpio.length && depth > 0) {
            if (limpio[i] === '{') depth++;
            else if (limpio[i] === '}') depth--;
            if (depth > 0) out += limpio[i];
            i++;
          }
          out += ' ';
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Los archivos de app que loguean eventos de transporte. */
function loggers(): { rel: string; code: string }[] {
  const out: { rel: string; code: string }[] = [];
  for (const abs of ROOTS.flatMap(listFiles)) {
    const code = stripSourceComments(readFileSync(abs, 'utf8'));
    if (code.includes('logTransportEvent(')) out.push({ rel: relOf(abs), code });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// El guard sobre el ÁRBOL REAL
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('REGLA A: ninguna superficie que loguea lee el texto de un error por su cuenta', () => {
  const surfaces = loggers();
  assert.ok(
    surfaces.length >= LOGGERS_FLOOR,
    `este guard encontró ${surfaces.length} superficies que loguean y el piso es ${LOGGERS_FLOOR}: el ` +
      'listado se rompió y estaría pasando verde por no estar mirando',
  );
  // Control de que el escaneo llega a donde tiene que llegar (los tres adapters son el lugar del bug).
  for (const esperado of [
    'src/services/ble/adapter-ble-gatt.ts',
    'src/services/ble/adapter-spp-android.ts',
    'src/services/ble/adapter-mfi-ios.ts',
  ]) {
    assert.ok(surfaces.some((s) => s.rel === esperado), `${esperado} tiene que estar dentro del escaneo`);
  }

  const hits: string[] = [];
  for (const s of surfaces) {
    for (const firma of LEE_EL_ERROR) {
      if (firma.re.test(s.code)) hits.push(`${s.rel}  [${firma.name}]`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    'Estos archivos LOGUEAN y además leen el texto de un error a mano. Los mensajes de las libs de ' +
      'Bluetooth interpolan el id del dispositivo (la MAC en Android, el serial del accesorio en MFi), ' +
      'así que ese texto no puede ir a un log sin pasar por `safeErrorText` de `error-text.ts` — el ' +
      'scrubber de Sentry es por CLAVES y no llega a un id embebido en un texto. Si lo que necesitás es ' +
      'CLASIFICAR por el texto (como `classifyMfiConnectError` en `ea-protocols.ts`), hacelo en un ' +
      `módulo que NO loguee — la regla es sobre las superficies que EMITEN:\n${hits.join('\n')}`,
  );
});

test('REGLA B: ningún `message` NOMBRA un identificador de dispositivo (interpolado o concatenado)', () => {
  const hits: string[] = [];
  let valores = 0;
  for (const s of loggers()) {
    for (const call of logCalls(s.code)) {
      for (const value of messageValues(call)) {
        valores++;
        const expr = expresiones(value);
        if (IDENTIFICADOR.test(expr)) hits.push(`${s.rel}  ${value.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }
  // Medido hoy: 35. El piso es la mitad — si el extractor se rompe, se pone rojo en vez de barrer nada.
  assert.ok(valores >= 20, `se leyeron ${valores} campos \`message\`: el extractor se rompió`);
  assert.deepEqual(
    hits,
    [],
    'Estos eventos meten un identificador de dispositivo en el FREE-TEXT del `message`. Si el dato hace ' +
      'falta, va como CAMPO CON CLAVE del evento (ahí sí lo alcanza el scrubber de `redact.ts`, que tiene ' +
      `\`device_id\` en \`PII_KEYS_RAW\`); en el texto, no lo alcanza nada:\n${hits.join('\n')}`,
  );
});

test('REGLA C: el convertidor error→texto es UNO (la copia a mano es el bug de clase)', () => {
  const hits: string[] = [];
  for (const abs of listFiles(HERE)) {
    const rel = relOf(abs);
    if (rel === CANONICAL) continue;
    if (CONVERTIDOR_LOCAL.test(stripSourceComments(readFileSync(abs, 'utf8')))) hits.push(rel);
  }
  assert.deepEqual(
    hits,
    [],
    `Estos archivos definen su propio convertidor error→texto. Había TRES copias (una por adapter) y las ` +
      `tres devolvían el mensaje crudo: ${hits.join(', ')}. El convertidor vive en ${CANONICAL}.`,
  );
  // El canónico existe y exporta lo que dice exportar (una regla que apunta a un archivo que no está es
  // una regla que no vigila nada).
  const canon = readFileSync(join(APP_ROOT, CANONICAL), 'utf8');
  assert.ok(/export function safeErrorText\(/.test(canon), `${CANONICAL} tiene que exportar safeErrorText`);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ANTI-VACUIDAD: las reglas ven el cuerpo VIEJO, y no ven el nuevo
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('las tres reglas DISPARAN sobre las formas que tenía el código antes del fix', () => {
  // Sin esto, un guard con el predicado equivocado se ve exactamente igual que uno que funciona: verde.
  const viejoHelperGatt = `function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'unknown';
}`;
  assert.ok(CONVERTIDOR_LOCAL.test(viejoHelperGatt), 'C: el helper viejo tiene que disparar');
  assert.ok(LEE_EL_ERROR[0].re.test(viejoHelperGatt), 'A: leer `.message` tiene que disparar');
  assert.ok(
    LEE_EL_ERROR[0].re.test('const msg = (e as { message?: unknown }).message;'),
    'A: también en la grafía con cast, que es la que tenían dos de las tres copias',
  );
  assert.ok(LEE_EL_ERROR[1].re.test('const why = String(error);'), 'A: String(error)');
  assert.ok(LEE_EL_ERROR[2].re.test('`ble_disconnected: ${error}`'), 'A: interpolar el error pelado');

  const viejoCallSite =
    "logTransportEvent({ kind: 'connect_error', message: `ble_device_not_recognized: ${device.id}` });";
  const [value] = messageValues(logCalls(viejoCallSite)[0]);
  assert.ok(value != null, 'B: el extractor tiene que encontrar el `message`');
  assert.ok(
    IDENTIFICADOR.test(expresiones(value)),
    'B: el MEDIUM-2 del Gate 2 (el id del device ajeno en el texto) tiene que disparar',
  );
  for (const forma of ['${target}', '${deviceId}', '${this.address}', '${accessory.serialNumber}']) {
    const call = logCalls(`logTransportEvent({ kind: 'connect_error', message: \`x: ${forma}\` });`)[0];
    assert.ok(IDENTIFICADOR.test(expresiones(messageValues(call)[0])), `B: ${forma} tiene que disparar`);
  }
  // La MISMA fuga con otra sintaxis: concatenación en vez de interpolación.
  const concat = logCalls("logTransportEvent({ kind: 'connect_error', message: 'ble_x: ' + device.id });")[0];
  assert.ok(
    IDENTIFICADOR.test(expresiones(messageValues(concat)[0])),
    'B: la concatenación tiene que disparar igual que la interpolación',
  );
});

test('las reglas NO disparan sobre lo que hoy es correcto (si no, el guard se desactiva solo)', () => {
  // Un guard que da falsos positivos se termina apagando, y apagado no vigila nada.
  const sanos = [
    "logTransportEvent({ kind: 'connect_error', message: `ble_scan_error: ${safeErrorText(error)}` });",
    "logTransportEvent({ kind: 'read_loop_error', message: `ble_monitor_lost: ${safeErrorText(error, target)}` });",
    "logTransportEvent({ kind: 'connect_error', message: `ble_device_not_recognized: #${seen.size} del escaneo` });",
    "logTransportEvent({ kind: 'connect_error', message: `mfi_accessory_not_found: seen=${accessories.length}` });",
    "logTransportEvent({ kind: 'connect_error', message: `ble_params_unresolved: ${resolved.reason}` });",
    "logTransportEvent({ kind: 'read_loop_error', message: 'ble_decode_failed' });",
  ];
  for (const src of sanos) {
    for (const value of messageValues(logCalls(src)[0])) {
      assert.equal(IDENTIFICADOR.test(expresiones(value)), false, `falso positivo en: ${src}`);
    }
  }
  // El CAMPO con clave sigue siendo legal: es lo que el scrubber por claves sí puede tocar.
  const campo = "logTransportEvent({ kind: 'connect_superseded', deviceId });";
  assert.deepEqual(messageValues(logCalls(campo)[0]), [], 'un campo con clave no es un `message`');
  // Y el `message` que NO interpola nada tampoco molesta aunque el literal diga "device".
  assert.equal(
    IDENTIFICADOR.test(expresiones("'ble_device_not_recognized: sin id'")),
    false,
    'el nombre del evento es TEXTO LITERAL, no un identificador leído de ningún lado',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  assertScanCoverage({
    guard: 'log-device-identifier',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: relOf,
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripSourceComments,
  });
});
