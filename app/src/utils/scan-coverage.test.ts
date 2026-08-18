// EL GUARD DE LA PROPIA ALLOWLIST — `SCAN_COVERAGE_ALLOW` de `utils/scan-coverage.ts`.
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────────
// `assertScanCoverage` es el meta-guard que los diez guards estáticos del repo corren sobre SÍ MISMOS
// para no pasar verdes en vacío. Su allowlist estuvo declarada y VACÍA desde que se escribió ("Hoy:
// ninguno"). El 2026-08-17 se estrenó con UNA entrada (`src/services/ble/logging.ts`, ver el motivo
// escrito en el lugar), y una allowlist estrenada es un PRECEDENTE: a partir de acá, cualquiera que se
// tope con un guard rojo tiene delante una salida de emergencia de una línea.
//
// **Una allowlist sin freno se vuelve la salida de emergencia de todos**, y entonces el guard que la
// tiene deja de significar algo sin que nadie se entere — exactamente el modo de falla (verde por no
// estar mirando) que `scan-coverage.ts` vino a cerrar, una capa más arriba. Este archivo es el freno, y
// tiene cuatro dientes:
//
//   1. MOTIVO ESCRITO EN EL LUGAR — sustantivo, no un puntero a un informe que dentro de seis meses
//      nadie va a abrir. Una exención que no se puede evaluar no se saca nunca.
//   2. TOPE — la lista no puede crecer sin que alguien lo note. Subir el tope es un acto deliberado, en
//      el mismo commit que agrega la entrada, y queda en el diff.
//   3. GANADA CONTRA EL ÁRBOL REAL — si el archivo dejó de violar el chequeo que la entrada exime, la
//      entrada SOBRA y esto se pone rojo. Es lo que hace que la lista se limpie sola en vez de acumular
//      permisos vencidos.
//   4. UNA SOLA PUERTA — ningún guard puede pasar su propia `allow` inline. Dos puertas a una allowlist
//      es una allowlist sin freno, porque la segunda no la mira nadie.
//
// Y arriba de los cuatro está LA DEMOSTRACIÓN (el último test): que la entrada haga lo que dice, medido
// en LAS DOS DIRECCIONES sobre el archivo real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from './strip-comments.ts';
import {
  assertScanCoverage,
  BIG_FILE_LINES,
  MIN_RETAINED_RATIO,
  SCAN_COVERAGE_ALLOW,
} from './scan-coverage.ts';

const HERE = resolve(fileURLToPath(import.meta.url), '..'); // app/src/utils
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** El archivo que declara la allowlist: se excluye de la regla "nadie pasa `allow` inline". */
const OWNER = 'src/utils/scan-coverage.test.ts';

/**
 * Piso de call sites de `assertScanCoverage` en el árbol. Hoy son 11 guards. El piso está abajo para
 * tolerar que se borre alguno, pero se pone ROJO si el listado se rompe: un guard de la allowlist que
 * no encuentra guards es otra vez el verde en vacío.
 */
const CALL_SITES_FLOOR = 9;

/** Tope de la allowlist. Hoy: 1. Subirlo es el acto deliberado que este guard obliga a hacer. */
const ALLOW_MAX = 1;

/** Largo mínimo del motivo. Dos líneas de prosa; una etiqueta o un "ver el informe" no llegan. */
const WHY_MIN_CHARS = 200;

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
    } else if (/\.tsx?$/.test(name)) {
      // ⚠️ ACÁ SÍ entran los `.test.ts`: los guards VIVEN en archivos de test. Excluirlos —que es lo
      // que hacen los otros guards, con razón, porque buscan código de producción— dejaría a este
      // mirando exactamente cero call sites.
      found.push(p);
    }
  }
  return found;
}

const nonBlankLines = (src: string) => src.split(/\r?\n/).filter((l) => l.trim() !== '').length;

/** Retención real de un archivo con el escáner canónico (el que usan los diez guards). */
function retentionOf(abs: string): { before: number; after: number; ratio: number } {
  const raw = readFileSync(abs, 'utf8');
  const before = nonBlankLines(raw);
  const after = nonBlankLines(stripSourceComments(raw));
  return { before, after, ratio: before === 0 ? 1 : after / before };
}

/**
 * Texto de cada llamada a `assertScanCoverage(...)` de un fuente, balanceando paréntesis. No alcanza con
 * cortar en el primer `)`: el objeto de opciones lleva arrow functions con paréntesis adentro.
 */
function callSites(src: string): string[] {
  const out: string[] = [];
  const needle = 'assertScanCoverage(';
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return out;
    // La DECLARACIÓN no es un call site (`scan-coverage.ts` define la función y no la usa).
    if (/\bfunction\s+$/.test(src.slice(Math.max(0, at - 24), at))) {
      from = at + needle.length;
      continue;
    }
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(at, i + 1));
    from = i + 1;
  }
}

/** Los `.ts`/`.tsx` sueltos de `app/` (ahí viven `ios-purpose-strings-guard`, `eas-profiles-guard`…). */
function topLevelFiles(): string[] {
  return readdirSync(APP_ROOT)
    .map((n) => join(APP_ROOT, n))
    .filter((p) => statSync(p).isFile() && /\.tsx?$/.test(p));
}

/**
 * Los guards del árbol: archivos que llaman a `assertScanCoverage`, sin el dueño de la allowlist.
 * ⚠️ Barre `app/app` + `app/src` **y la raíz de `app/`**: los otros guards no miran la raíz (buscan
 * código de producción y ahí no hay), pero un guard NUEVO puede vivir ahí —`ios-purpose-strings-guard`
 * y `eas-profiles-guard` ya viven— y sería exactamente la segunda puerta que este archivo prohíbe.
 */
function guardFiles(): { rel: string; code: string; calls: string[] }[] {
  const out: { rel: string; code: string; calls: string[] }[] = [];
  for (const abs of [...ROOTS.flatMap(listFiles), ...topLevelFiles()]) {
    const rel = relOf(abs);
    if (rel === OWNER) continue;
    const code = stripSourceComments(readFileSync(abs, 'utf8'));
    const calls = callSites(code);
    if (calls.length > 0) out.push({ rel, code, calls });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 — El freno: motivo, tope, existencia, y que la exención esté GANADA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('cada exención trae su motivo ESCRITO EN EL LUGAR (no un puntero a un informe)', () => {
  const entries = Object.entries(SCAN_COVERAGE_ALLOW);
  assert.ok(entries.length > 0, 'si la allowlist quedó vacía, borrá este archivo o el freno miente');
  for (const [label, ex] of entries) {
    const why = ex.why.trim();
    assert.ok(
      why.length >= WHY_MIN_CHARS,
      `la exención de ${label} tiene un motivo de ${why.length} caracteres: hace falta explicar POR QUÉ ` +
        `la anomalía es legítima (≥ ${WHY_MIN_CHARS}), no etiquetarla`,
    );
    assert.ok(
      !/^\s*(ver|véase|vease|see|cf\b|ref\b|TODO|temporal|por ahora)/i.test(why),
      `la exención de ${label} ARRANCA con un puntero ("${why.slice(0, 24)}…"): el motivo va acá. Un ` +
        'informe se archiva; esta línea se lee cada vez que alguien se topa con la entrada',
    );
    assert.ok(
      ex.check === 'retention' || ex.check === 'braces',
      `la exención de ${label} no dice de QUÉ chequeo exime`,
    );
  }
});

test('la allowlist NO puede crecer sin que alguien lo note', () => {
  assert.ok(
    Object.keys(SCAN_COVERAGE_ALLOW).length <= ALLOW_MAX,
    `la allowlist del meta-guard tiene ${Object.keys(SCAN_COVERAGE_ALLOW).length} entradas y el tope es ` +
      `${ALLOW_MAX}. Subir el tope se hace EN EL MISMO COMMIT que agrega la entrada y con su motivo, para ` +
      'que quede en el diff: una allowlist que crece de a una y en silencio termina siendo la salida de ' +
      'emergencia de todos, y entonces el guard que la tiene ya no significa nada.',
  );
});

test('cada archivo eximido EXISTE (una exención huérfana es un permiso que nadie revisa)', () => {
  for (const label of Object.keys(SCAN_COVERAGE_ALLOW)) {
    const abs = join(APP_ROOT, label);
    let ok = false;
    try {
      ok = statSync(abs).isFile();
    } catch {
      ok = false;
    }
    assert.ok(
      ok,
      `${label} está eximido pero no existe: se renombró o se borró y la entrada quedó huérfana. Una ` +
        'entrada huérfana no exime nada y encima esconde que la exención ya no hace falta.',
    );
  }
});

test('cada exención está GANADA contra el árbol real (si sobra, se pone roja)', () => {
  // El diente que limpia la lista sola. Si alguien purga la prosa de `logging.ts` y la retención sube por
  // encima del piso, la entrada deja de hacer falta — y este test la manda a borrar en vez de dejarla
  // ahí para siempre, que es cómo una allowlist se convierte en decoración.
  for (const [label, ex] of Object.entries(SCAN_COVERAGE_ALLOW)) {
    if (ex.check !== 'retention') continue;
    const { before, after, ratio } = retentionOf(join(APP_ROOT, label));
    assert.ok(
      ratio < MIN_RETAINED_RATIO,
      `${label} está eximido del piso de retención pero HOY retiene ${ratio.toFixed(3)} ` +
        `(${before} líneas → ${after}), que ya está por encima del piso de ${MIN_RETAINED_RATIO}. La ` +
        'exención sobra: borrala.',
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2 — Que la exención sea ANGOSTA, y que la puerta sea UNA
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test('eximir de la RETENCIÓN no saca el archivo del escaneo: el balance le sigue corriendo', () => {
  // Es la diferencia entre "este archivo puede retener poco" y "este archivo deja de existir para el
  // guard". La segunda le devuelve al guard la ceguera que el meta-guard vino a cerrar.
  const roto = ['function f() {', '  if (x) {', '    return 1;', '}'].join('\n');
  const opts = {
    guard: 'fixture',
    files: ['fake.ts'],
    minFiles: 1,
    label: () => 'fake.ts',
    read: () => roto,
    strip: (s: string) => s,
  };

  assert.throws(
    () =>
      assertScanCoverage({
        ...opts,
        allow: { 'fake.ts': { check: 'retention', why: 'fixture del test' } },
      }),
    /LLAVES DESBALANCEADAS/,
    'eximido de la retención, el desbalance de llaves TIENE que seguir apareciendo',
  );

  // Control: la exención de `braces` sí lo tapa (y existe para el fuente raro que el escáner no lee bien).
  assert.doesNotThrow(() =>
    assertScanCoverage({
      ...opts,
      allow: { 'fake.ts': { check: 'braces', why: 'fixture del test' } },
    }),
  );
});

test('eximir del BALANCE no exime de la retención (la simétrica del anterior)', () => {
  const comido = ['// a', '// b', '// c', 'const x = 1;'].join('\n');
  const opts = {
    guard: 'fixture',
    files: ['fake.ts'],
    minFiles: 1,
    label: () => 'fake.ts',
    read: () => comido,
    // Blanqueo que se come TODO menos la última línea, sobre un archivo "grande" simulado.
    strip: (s: string) => s.split('\n').slice(-1).join('\n'),
  };
  const grande = { ...opts, read: () => `${'// x\n'.repeat(BIG_FILE_LINES)}const x = 1;` };
  assert.throws(
    () =>
      assertScanCoverage({
        ...grande,
        allow: { 'fake.ts': { check: 'braces', why: 'fixture del test' } },
      }),
    /COMIENDO/,
  );
});

test('LA PUERTA A LA ALLOWLIST ES UNA: ningún guard pasa su propia `allow` inline', () => {
  const guards = guardFiles();
  assert.ok(
    guards.length >= CALL_SITES_FLOOR,
    `este guard encontró ${guards.length} guards con auto-verificación y el piso es ${CALL_SITES_FLOOR}: ` +
      'el listado se rompió',
  );
  const conAllow: string[] = [];
  for (const g of guards) {
    for (const call of g.calls) {
      if (/(^|[^\w.])allow\s*:/.test(call)) conAllow.push(g.rel);
    }
  }
  assert.deepEqual(
    conAllow,
    [],
    'Estos guards le pasan una `allow` inline a `assertScanCoverage`. La allowlist es UNA y compartida ' +
      '(`SCAN_COVERAGE_ALLOW`), con su freno en este archivo. Una segunda puerta, en el call site, no la ' +
      `mira nadie: ${conAllow.join(', ')}`,
  );
});

test('los guards calculan el MISMO `label`, que es lo que hace que UNA entrada alcance para todos', () => {
  // Si un guard etiquetara distinto (path absoluto, `\` de Windows, relativo al repo), la entrada
  // compartida no lo cubriría y ESE guard se pondría rojo igual — con el mensaje del blanqueo, a nueve
  // guards de distancia del síntoma. El invariante que sostiene la allowlist compartida es este.
  const CANON = /^\(\s*\w+\s*(?::\s*string\s*)?\)\s*=>\s*relative\(\s*APP_ROOT\s*,\s*\w+\s*\)\.split\(\s*sep\s*\)\.join\(\s*'\/'\s*\)/;
  const raros: string[] = [];
  const guards = guardFiles();
  assert.ok(guards.length >= CALL_SITES_FLOOR, `sin guards que mirar (${guards.length}) esto es un verde vacío`);
  for (const g of guards) {
    for (const call of g.calls) {
      const m = call.match(/label\s*:\s*([\s\S]*?),\s*\n/);
      if (m == null) {
        raros.push(`${g.rel}: no se pudo leer el \`label\``);
        continue;
      }
      const expr = m[1].trim();
      if (CANON.test(expr)) continue;
      // Alias (`relOf`, `rel`): tiene que estar definido en el mismo archivo con la forma canónica.
      const alias = expr.match(/^[A-Za-z_$][\w$]*$/);
      if (alias != null) {
        const def = g.code.match(new RegExp(`\\b(?:const|let)\\s+${expr}\\s*=\\s*([\\s\\S]{0,160})`));
        if (def != null && CANON.test(def[1].trim())) continue;
      }
      raros.push(`${g.rel}: label = ${expr.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  assert.deepEqual(
    raros,
    [],
    'Estos guards etiquetan los archivos de una forma que la allowlist compartida NO puede matchear:\n' +
      raros.join('\n'),
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — LA DEMOSTRACIÓN: que la entrada haga lo que dice, medida en las DOS direcciones
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const LOGGING = 'src/services/ble/logging.ts';
/** El ancla del mutante: una línea real del union, elegida por ser la más estable del archivo. */
const UNION_ANCHOR = "  | { kind: 'reconnect_attempt'; attempt: number }";
/** Dos miembros de UNA LÍNEA y SIN un solo comentario: el crecimiento mínimo posible del union. */
const DOS_MIEMBROS = [
  "  | { kind: 'mutante_uno'; a: number }",
  "  | { kind: 'mutante_dos'; b: number }",
].join('\n');

function coverageDe(read: (f: string) => string, allow?: typeof SCAN_COVERAGE_ALLOW): () => void {
  return () =>
    assertScanCoverage({
      guard: 'demostración',
      files: [join(APP_ROOT, LOGGING)],
      minFiles: 1,
      label: relOf,
      read,
      strip: stripSourceComments,
      ...(allow === undefined ? {} : { allow }),
    });
}

test('el mutante de DOS LÍNEAS: con la entrada NO rompe, sin la entrada SÍ (las dos direcciones)', () => {
  const raw = readFileSync(join(APP_ROOT, LOGGING), 'utf8');
  assert.ok(
    raw.includes(UNION_ANCHOR),
    `el ancla del mutante ya no está en ${LOGGING}. Elegí otra línea del union y actualizá UNION_ANCHOR: ` +
      'sin ancla, este test mediría otra cosa.',
  );
  const mutado = raw.replace(UNION_ANCHOR, `${UNION_ANCHOR}\n${DOS_MIEMBROS}`);
  const read = (f: string) => (relOf(f) === LOGGING ? mutado : readFileSync(f, 'utf8'));

  // La medición que motivó todo: 148 líneas no vacías + 2 = 150, o sea el umbral de "archivo grande",
  // con una retención que YA estaba abajo del piso.
  const before = nonBlankLines(mutado);
  const after = nonBlankLines(stripSourceComments(mutado));
  assert.ok(
    before >= BIG_FILE_LINES,
    `con dos miembros más, ${LOGGING} tiene ${before} líneas no vacías y el umbral es ${BIG_FILE_LINES}: ` +
      'el mutante ya no ejerce el chequeo de retención (el archivo se achicó). Este test estaría verde ' +
      'por la razón equivocada.',
  );
  assert.ok(
    after / before < MIN_RETAINED_RATIO,
    `la retención mutada es ${(after / before).toFixed(3)} y el piso ${MIN_RETAINED_RATIO}: el mutante no ` +
      'dispara nada. Si la prosa del archivo se purgó, borrá la entrada de la allowlist (hay un test que ' +
      'ya lo pide) en vez de dejar este verde vacío.',
  );

  // ← SIN la entrada: cae, con el mensaje del blanqueo que no tiene nada que ver con quien tocó el union.
  assert.throws(coverageDe(read, {}), /COMIENDO[\s\S]*logging\.ts/);
  // ← CON la entrada (la de verdad, la compartida): no cae.
  assert.doesNotThrow(coverageDe(read));
});

test('el archivo REAL de hoy pasa por las dos (el mutante es lo que mueve la aguja, no el archivo)', () => {
  const read = (f: string) => readFileSync(f, 'utf8');
  // Sin mutar, `logging.ts` está DEBAJO del umbral de tamaño, así que ni siquiera entra al chequeo:
  // el verde de arriba viene del mutante, no de que el archivo hoy esté sano.
  const { before, ratio } = retentionOf(join(APP_ROOT, LOGGING));
  assert.ok(before < BIG_FILE_LINES, `${LOGGING} hoy tiene ${before} líneas no vacías (< ${BIG_FILE_LINES})`);
  assert.ok(ratio < MIN_RETAINED_RATIO, `y retiene ${ratio.toFixed(3)}, que ya está bajo el piso`);
  assert.doesNotThrow(coverageDe(read, {}));
  assert.doesNotThrow(coverageDe(read));
});
