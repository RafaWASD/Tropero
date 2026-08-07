// GUARD: "la fecha de hoy" (el día calendario del operario) sale de UN solo lugar — `utils/today-iso.ts`.
// Ningún archivo de `app/app` ni `app/src` puede derivarla por su cuenta, ni en UTC ni en local.
//
// ── EL BUG QUE CIERRA (🔴 A.2, QA de maniobras en device 2026-08-06) ─────────────────────────────────
// "Hoy" estaba escrito a mano DOCE veces. Cuatro copias usaban `new Date().toISOString().slice(0, 10)`,
// que es UTC: en Argentina (UTC−3), entre las 21:00 y las 23:59 locales el UTC ya está en el día
// siguiente, y como las columnas destino son Postgres `date`, **el dato entraba corrido** (medido en el
// A07: 7 eventos cargados el 06/08 22:54 quedaron fechados 07/08). Y otras DOS —encontradas en el
// fix-loop— anclaban un INSTANTE real por su día **UTC** con getters (`Date.UTC(x.getUTCFullYear(), …)`),
// corriendo la EDAD de todo animal un día y con ella su categoría y su aptitud reproductiva.
//
// ── POR QUÉ UN GUARD, Y POR QUÉ SOBRE LA AUSENCIA ────────────────────────────────────────────────────
// Porque la regla YA existía escrita (`docs/conventions.md` + el header de `format-date-es-ar.ts`) y aun
// así se cumplió en 8 lugares y se violó en 4. Una regla que depende de que cada autor la recuerde no es
// una regla: es una estadística. Y ningún test funcional la caza — 21 de las 24 horas del día el UTC y el
// local coinciden, así que la suite pasa verde en cualquier corrida diurna.
//
// ── ⚠️ CÓMO SE DERIVA EL ORÁCULO (la lección del fix-loop, leerla antes de tocar nada) ───────────────
// La PRIMERA versión de este guard tenía las reglas escritas **de memoria**, sobre una forma IMAGINADA del
// bug (año primero, `getDate()` después). La forma REAL del repo pone `mm`/`dd` en consts ANTES y el
// `getFullYear()` en el template final. Resultado medido por el reviewer: **7 de los 12 archivos,
// revertidos a su forma pre-fix, dejaban este guard VERDE**. El guard existía, se veía prolijo, y no
// miraba nada. (Era la segunda vez en la misma unidad: la primera fue una regex rota cuyo fixture se
// construía desde la misma constante rota.)
//
// Por eso el oráculo ahora **NO se escribe: se saca del git**. El test `PROPIEDAD` de abajo trae con
// `git show <baseline>:<archivo>` el cuerpo LITERAL pre-fix de cada uno de los 13 archivos que tenían una
// derivación propia y exige que **cada uno dispare al menos una regla**. Es la única versión de este test
// que no se puede escribir de memoria: si alguien relaja una regla, el cuerpo histórico deja de disparar y
// el test cae.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from './strip-comments';
import { assertScanCoverage } from './scan-coverage';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const REPO_ROOT = resolve(APP_ROOT, '..');
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Ver `utils/scan-coverage.ts`. */
const SCANNED_FILES_FLOOR = 300;

/** El ÚNICO archivo que puede derivar el día calendario de hoy a partir de un `Date`. */
const CANONICAL = 'src/utils/today-iso.ts';

// ⚠️ Las firmas prohibidas se ARMAN POR CONCATENACIÓN a propósito: así este archivo no contiene la cadena
// literal que prohíbe, y un grep de aceptación sobre `app/app` + `app/src` sigue dando CERO.
//
// ⚠️⚠️ LOS DOS SE ARMAN CON PARTIDURAS DISTINTAS, Y NO ES CAPRICHO: la primera versión componía la regex
// como `${TO_ISO}String\(\)` sobre un `TO_ISO` que YA valía el nombre completo → buscaba un método
// inexistente. Y el test de auto-detección construía su caso sintético con el MISMO `TO_ISO`, así que
// reproducía el error y daba verde: cuatro mutantes sobrevivieron al guard entero. Con dos decomposiciones
// distintas + el assert de igualdad, un desalineamiento no puede volver a cancelarse solo.
const TO_ISO = ['toISO', 'String'].join(''); // lo que usa la REGEX
const TO_ISO_FIXTURE = ['to', 'ISOString'].join(''); // lo que usan los CASOS SINTÉTICOS

/** Los métodos que serializan un `Date` a ISO completo. `toJSON()` es un alias exacto de `toISOString()`. */
const ISO_METHODS = `(?:${TO_ISO}|toJSON)`;
/** Operaciones que RECORTAN un string (convertir un ISO completo en un día calendario). */
const TRUNCATIONS = '(?:slice|substring|substr|split)';

/**
 * REGLA A1 — truncar un ISO **en la misma expresión**.
 * `toISOString()` devuelve UTC; recortarlo es "derivar el día calendario en UTC", que es EL bug. La regla
 * prohíbe CUALQUIER truncación, no la forma `(0, 10)`: un instante real se serializa ENTERO (así se usa en
 * los ~10 call sites legítimos de `created_at`/`deleted_at`), así que no hay uso legítimo de un ISO
 * recortado y no hace falta adivinar los argumentos. Tolera saltos de línea (Prettier parte la cadena).
 */
const TRUNCATED_ISO = new RegExp(`${ISO_METHODS}\\(\\)\\s*\\.\\s*${TRUNCATIONS}\\s*\\(`);

/**
 * REGLA A2 — el ISO **a una variable** y el recorte después.
 * Evasión que el reviewer encontró viva: `const iso = d.toISOString(); return iso.slice(0, 10);`. Se
 * captura el nombre de la variable asignada desde un método ISO y se busca una truncación aplicada a ESE
 * nombre. Una variable que guarda un ISO completo y después se recorta ES el bug, así que no hay falso
 * positivo plausible.
 */
// `[^;]` (y no `[^;=]`) para que una anotación de tipo no rompa el match: `const iso: string = …`.
const ISO_ASSIGNMENT = new RegExp(
  `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*[:=][^;]*?\\b${ISO_METHODS}\\s*\\(\\)`,
  'g',
);

/**
 * REGLA B — COMPONER un `AAAA-MM-DD` a mano desde los getters de `Date`.
 * Es la mitad "correcta pero duplicada" del bug: 8 de las 12 copias devolvían el valor bien y aun así el
 * error se coló en las otras 4, porque con la derivación repartida el próximo archivo copia del vecino.
 *
 * La detección arranca por la **FORMA DEL RESULTADO** —un empalme con guion dentro de un template, o un
 * `join('-')`— y recién después pide un getter de `Date` **en una ventana que mira PARA LOS DOS LADOS**.
 * Mirar solo hacia adelante desde `getFullYear()` es lo que dejaba pasar 7 de 12: la forma real pone
 * `mm`/`dd` en consts ANTES del template.
 * Mostrar un `dd/mm/aaaa` (`format-date-es-ar.ts`) usa los mismos getters y NO dispara: no hay guiones.
 */
const DASHED_COMPOSITION = /`[^`]*\}-\$\{[^`]*`|\.join\(\s*['"`]-['"`]\s*\)|\.join\(\s*[A-Za-z_$][\w$]*\s*\)/g;
/**
 * Un `join(SEP)` cuenta como empalme con guion si `SEP` es una const del archivo que vale `'-'` — se
 * resuelve UN nivel de indirección (el mismo criterio que los otros guards del repo). **Lo que el guard NO
 * ve, dicho de frente**: dos o más niveles (`const A = B;`), un separador importado de otro módulo, o uno
 * construido en runtime. Para eso haría falta un AST; si aparece esa forma, el que la escriba tiene que
 * estar mintiendo a propósito.
 */
function dashConstNames(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*['"`]-['"`]/g)) {
    out.add(m[1]);
  }
  return out;
}
const DATE_GETTER = /\.get(?:UTC)?(?:FullYear|Month|Date)\s*\(\s*\)/g;
/**
 * El getter tiene que usarse como VALOR, no dentro de una COMPARACIÓN. Es el discriminador que separa la
 * composición real (`const mm = String(d.getMonth() + 1)…`, el getter ALIMENTA el string) de la validación
 * de desborde de un parser date-only (`d.getUTCMonth() !== month - 1`, el getter solo se compara). Sin
 * esto, la regla marcaba `import/normalize-row.ts`, que recompone la ISO desde números ya parseados.
 */
const COMPARISON_AFTER = /^\s*(?:!==|===|!=|==|<=|>=|<|>)/;
/** Cuánto mira la regla B a cada lado del empalme. Una composición ISO entra holgada en 400/200. */
const COMPOSE_BACK = 400;
const COMPOSE_FWD = 200;

/**
 * REGLA D — el idiom "día **UTC** de", sobre un instante real.
 * `Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())` es el ancla de un día calendario. Cuando
 * `x` es un INSTANTE real (un `new Date()`), toma el día UTC y en AR corre +1 de 21:00 a 23:59 — el mismo
 * bug de A.2 escrito con getters. Estaba VIVO en dos lugares (`animal-category.ts startOfDay` y
 * `repro-status.ts ageInDaysFromBirthDate`), y los dos alimentaban el corte de 365 días que decide
 * categoría y aptitud reproductiva.
 *
 * Sintácticamente no se puede distinguir un instante de una fecha date-only ya parseada, así que la regla
 * prohíbe el IDIOM y obliga a declarar las excepciones. El ancla correcta es `localDayAnchorUtc()`.
 */
// ⚠️ Dos afinaciones que salieron de MEDIR contra el árbol, no de imaginar:
//  1. El salto entre los getters NO se puede escribir `[^)]*`: entre `getUTCFullYear()` y `getUTCDate()`
//     hay un `getUTCMonth()`, o sea paréntesis. Esa versión no matcheaba NADA (la cazó el test PROPIEDAD).
//  2. Los getters tienen que estar EN LOS ARGUMENTOS de `Date.UTC(...)`. Con un salto libre, la regla
//     marcaba los PARSERS de fechas date-only (`new Date(Date.UTC(year, month - 1, day))` seguido de la
//     validación de desborde, que lee los mismos getters) — 3 falsos positivos legítimos.
const UTC_DAY_ANCHOR =
  /Date\.UTC\(\s*[A-Za-z_$][\w$.]*\.getUTCFullYear\s*\(\s*\)\s*,\s*[A-Za-z_$][\w$.]*\.getUTCMonth\s*\(\s*\)/;

/**
 * REGLA C — la puerta de atrás por LOCALE.
 * `toLocaleDateString('sv-SE')` (o `'en-CA'`) devuelve literalmente `AAAA-MM-DD`. Hoy el árbol tiene CERO
 * usos de estas APIs de FECHA (los ~15 `toLocaleString` que hay son de NÚMERO es-AR y no matchean), así que
 * la regla es gratis y cierra el hueco antes de que alguien lo encuentre.
 */
const LOCALE_DATE = /\btoLocaleDateString\s*\(|\bIntl\s*\.\s*DateTimeFormat\s*\(/;

/**
 * Excepciones de la REGLA B, cada una con su motivo escrito. Son los serializadores del dominio date-only,
 * que es UTC por diseño: componen un `AAAA-MM-DD` a partir de un `Date` que YA ES una fecha sin hora.
 */
const COMPOSE_ALLOW: Record<string, string> = {
  [CANONICAL]: 'la fuente canónica: es la que define cómo se compone el día local',
  'src/utils/animal-category.ts':
    '`isoUtcDate` es el inverso de `parseIsoDate` — serializa un Date YA normalizado a medianoche UTC ' +
    '(un midpoint de imputación), no un instante real',
};

/**
 * Excepciones de la REGLA D, cada una con su motivo. Las dos normalizan un `Date` que viene de parsear un
 * string date-only con `Date.UTC(y, m, d)` unas líneas más arriba (validación de desborde incluida) — o
 * sea que sus componentes UTC SON la fecha que el usuario tipeó. Ahí el dominio UTC es el correcto.
 */
const UTC_ANCHOR_ALLOW: Record<string, string> = {
  'src/utils/animal-form.ts': 'normaliza un date-only ya parseado (validateBirthDate), no un instante',
  'src/utils/event-input.ts': 'normaliza un date-only ya parseado (validateEventDate), no un instante',
};

/** Válvula de escape por línea, con justificación (mismo patrón que los otros guards del repo). */
const DISABLE_NEXT_LINE = /today-iso-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /today-iso-disable-line\s*--\s*\S/;

// ── LA PROPIEDAD ────────────────────────────────────────────────────────────────────────────────────
/** El commit anterior a esta unidad: ahí viven los cuerpos REALES que el guard tiene que saber cazar. */
const BASELINE = '1922e0eeaddd3f738b7cab7ff09de238af87def0';
/**
 * Los 13 archivos que en `BASELINE` derivaban un día calendario por su cuenta. **Revertir cualquiera a esa
 * forma tiene que poner este guard en ROJO** — es la propiedad que define si el guard sirve.
 * Los 4 primeros lo hacían en UTC (regla A); los 8 siguientes en local pero duplicado (regla B); el último
 * anclaba un instante por su día UTC (regla D, el 🔴 vivo del fix-loop).
 */
const PRE_FIX_FILES: readonly string[] = [
  'app/app/maniobra/carga.tsx',
  'app/app/seleccion-masiva.tsx',
  'app/app/vacunacion-masiva.tsx',
  'app/src/utils/maneuver-category-preview.ts',
  'app/app/agregar-evento.tsx',
  'app/app/animal/baja.tsx',
  'app/app/crear-animal.tsx',
  'app/app/lote/venta.tsx',
  'app/src/components/TreatmentApplicationSheet.tsx',
  'app/src/components/TreatmentStartSheet.tsx',
  'app/src/utils/link-calf-query.ts',
  'app/src/utils/animal-birth-year.ts',
  'app/src/utils/animal-category.ts',
];

/** Trae el contenido de un archivo tal como estaba en `BASELINE`. */
function atBaseline(path: string): string {
  return execFileSync('git', ['show', `${BASELINE}:${path}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

// ─── Motor de escaneo ────────────────────────────────────────────────────────────────────────────

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
      found.push(...listFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      // Los `.test.*` quedan fuera: contienen las firmas en sus casos sintéticos y se auto-reportarían.
      found.push(p);
    }
  }
  return found;
}

/** Blanquea comentarios preservando saltos de línea (escáner CON ESTADO compartido del repo). */
const stripComments = stripSourceComments;

/** Nº de línea (1-based) del índice `i` dentro de `src`. */
function lineAt(src: string, i: number): number {
  let line = 1;
  for (let k = 0; k < i; k++) if (src[k] === '\n') line++;
  return line;
}

/** Índices de todos los matches de una regex sobre `code`. */
function allMatches(code: string, re: RegExp): number[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(code)) !== null) {
    out.push(m.index);
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

/** REGLA A2: índices de una truncación aplicada a una variable que guarda un ISO completo. */
function truncatedIsoVariables(code: string): number[] {
  const out: number[] = [];
  const decl = new RegExp(ISO_ASSIGNMENT.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = decl.exec(code)) !== null) {
    const name = m[1];
    const use = new RegExp(`\\b${name}\\s*\\.\\s*${TRUNCATIONS}\\s*\\(`);
    const rest = code.slice(m.index + m[0].length);
    const at = rest.search(use);
    if (at >= 0) out.push(m.index + m[0].length + at);
  }
  return out;
}

/** ¿La ventana tiene un getter de `Date` usado como VALOR (no dentro de una comparación)? */
function hasDateGetterAsValue(window: string): boolean {
  const re = new RegExp(DATE_GETTER.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    if (!COMPARISON_AFTER.test(window.slice(m.index + m[0].length, m.index + m[0].length + 8))) return true;
  }
  return false;
}

/** REGLA B: índices donde arranca una composición manual de `AAAA-MM-DD`. */
function composedDates(code: string): number[] {
  const out: number[] = [];
  const dashConsts = dashConstNames(code);
  const re = new RegExp(DASHED_COMPOSITION.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    // Un `join(<ident>)` solo cuenta si ese identificador es una const que vale '-'.
    const byIdent = /\.join\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(m[0]);
    if (byIdent && !dashConsts.has(byIdent[1])) continue;
    const window = code.slice(Math.max(0, m.index - COMPOSE_BACK), m.index + COMPOSE_FWD);
    if (hasDateGetterAsValue(window)) out.push(m.index);
  }
  return out;
}

/** Todas las reglas sobre un texto ya sin comentarios. `rel` decide las exenciones. */
function violationsIn(code: string, rel: string): { rule: string; idx: number }[] {
  const hits: { rule: string; idx: number }[] = [];
  for (const idx of allMatches(code, TRUNCATED_ISO)) hits.push({ rule: 'A1 ISO recortado', idx });
  for (const idx of truncatedIsoVariables(code)) hits.push({ rule: 'A2 ISO a variable y recortado', idx });
  if (!Object.prototype.hasOwnProperty.call(COMPOSE_ALLOW, rel)) {
    for (const idx of composedDates(code)) hits.push({ rule: 'B composición AAAA-MM-DD a mano', idx });
  }
  if (!Object.prototype.hasOwnProperty.call(UTC_ANCHOR_ALLOW, rel)) {
    for (const idx of allMatches(code, UTC_DAY_ANCHOR)) hits.push({ rule: 'D día UTC de un instante', idx });
  }
  for (const idx of allMatches(code, LOCALE_DATE)) hits.push({ rule: 'C fecha por locale', idx });
  return hits;
}

/** Escanea el árbol real y devuelve las violaciones formateadas (respetando las válvulas de escape). */
function scanTree(pick: (rule: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split(/\r?\n/);
      const code = stripComments(raw);
      const rel = relative(APP_ROOT, file).split(sep).join('/');
      for (const { rule, idx } of violationsIn(code, rel)) {
        if (!pick(rule)) continue;
        const line = lineAt(code, idx);
        const here = rawLines[line - 1] ?? '';
        const previous = rawLines[line - 2] ?? '';
        if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) continue;
        out.push(`[${rule}] ${rel}:${line}  ${here.trim()}`);
      }
    }
  }
  return out;
}

// ─── Las reglas, sobre el árbol real ─────────────────────────────────────────────────────────────

test('A — nadie deriva una fecha date-only recortando un ISO (eso es UTC, y el dato entra corrido)', () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('A')),
    [],
    'Recortar `toISOString()`/`toJSON()` da el día calendario en UTC. En Argentina (UTC−3) todo lo que se ' +
      'carga después de las 21:00 queda fechado MAÑANA, y como la columna es `date` el dato entra corrido ' +
      '(no es display). Usá `todayIsoLocal()` de `utils/today-iso.ts`. Un INSTANTE real (created_at, ' +
      'deleted_at) sí se serializa con `toISOString()` ENTERO — sin recortar.',
  );
});

test('B — nadie compone un `AAAA-MM-DD` a mano desde los getters de Date (la fuente es una sola)', () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('B')),
    [],
    'La composición `${y}-${mm}-${dd}` vive SOLO en `' +
      CANONICAL +
      '`. Estaba copiada en 8 archivos y por eso el error se coló en 4 de ellos sin que nadie lo notara. ' +
      'Importá `todayIsoLocal()`. Excepciones declaradas: ' +
      Object.entries(COMPOSE_ALLOW)
        .map(([f, why]) => `${f} (${why})`)
        .join(' · '),
  );
});

test('C — nadie deriva una fecha por LOCALE (`sv-SE`/`en-CA` devuelven AAAA-MM-DD por la puerta de atrás)', () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('C')),
    [],
    '`toLocaleDateString` / `Intl.DateTimeFormat` con `sv-SE` o `en-CA` devuelven literalmente ' +
      '`AAAA-MM-DD`: es la misma derivación por otra puerta, y encima trae de vuelta el drift −1 día que ' +
      'ya nos costó un rojo. Para MOSTRAR usá `utils/format-date-es-ar.ts`; para el valor de máquina, ' +
      '`todayIsoLocal()`.',
  );
});

test('D — nadie ancla un día por sus componentes UTC (era el 🔴 vivo: la edad corrida un día)', () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('D')),
    [],
    '`Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())` toma el día **UTC** de `x`. Si `x` es ' +
      'un INSTANTE real, en AR eso es MAÑANA de 21:00 a 23:59 y todo animal figura un día más viejo — el ' +
      'corte de 365 días (categoría, aptitud reproductiva) se cruza antes de tiempo. Usá ' +
      '`localDayAnchorUtc()` de `utils/today-iso.ts`. Excepciones declaradas: ' +
      Object.entries(UTC_ANCHOR_ALLOW)
        .map(([f, why]) => `${f} (${why})`)
        .join(' · '),
  );
});

// ─── LA PROPIEDAD: el oráculo sale del git, no de la memoria ─────────────────────────────────────

test('PROPIEDAD — revertir CUALQUIERA de los 13 archivos a su forma pre-fix pone el guard en ROJO', () => {
  // Este es EL test del guard. No compara contra una forma imaginada del bug: trae el cuerpo LITERAL que
  // cada archivo tenía en el baseline y exige que dispare. Es lo que habría cazado, en la primera corrida,
  // que la regla B no veía 7 de 12.
  let historia: string;
  try {
    historia = execFileSync('git', ['cat-file', '-t', BASELINE], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error(
      `no se pudo leer el baseline ${BASELINE} del git (${String(e)}). Este guard deriva su oráculo del ` +
        'historial: sin él no puede afirmar que detecta las formas REALES del bug. Si el repo se clonó ' +
        'shallow, traé el commit (`git fetch --unshallow`) antes de correr la suite.',
    );
  }
  assert.equal(historia, 'commit', `${BASELINE} tiene que ser un commit`);

  const ciegos: string[] = [];
  for (const path of PRE_FIX_FILES) {
    const code = stripComments(atBaseline(path));
    const rel = path.replace(/^app\//, '');
    const hits = violationsIn(code, rel);
    if (hits.length === 0) ciegos.push(path);
  }
  assert.deepEqual(
    ciegos,
    [],
    'Estos archivos, con su cuerpo REAL de antes del fix, NO disparan ninguna regla: el guard es ciego a ' +
      'la forma en que el bug estaba escrito de verdad. Es exactamente el defecto que este test existe ' +
      'para impedir (medido una vez: 7 de 12 pasaban verdes).',
  );
});

test('PROPIEDAD (control) — el árbol de HOY no dispara sobre esos mismos archivos', () => {
  // La contracara: si las reglas fueran tan amplias que TAMBIÉN marcan la versión arreglada, el test de
  // arriba sería trivial y el guard, inusable. Se verifica sobre los mismos 13 archivos.
  const falsos: string[] = [];
  for (const path of PRE_FIX_FILES) {
    const rel = path.replace(/^app\//, '');
    const code = stripComments(readFileSync(join(APP_ROOT, rel), 'utf8'));
    const hits = violationsIn(code, rel);
    if (hits.length > 0) falsos.push(`${path}: ${hits.map((h) => h.rule).join(', ')}`);
  }
  assert.deepEqual(falsos, [], 'la versión ARREGLADA de estos archivos no puede disparar ninguna regla');
});

// ─── La fuente canónica ──────────────────────────────────────────────────────────────────────────

test('la fuente canónica existe, es PURA y devuelve el día LOCAL (no un no-op)', () => {
  // Sin esto, alguien podría vaciar `today-iso.ts` (o hacerlo devolver UTC) y las reglas de arriba
  // seguirían verdes: prohíben derivar la fecha en cualquier lado MENOS ahí.
  const code = stripComments(readFileSync(join(APP_ROOT, CANONICAL), 'utf8'));
  assert.match(code, /export function todayIsoLocal\(/, 'tiene que exportar todayIsoLocal (el string)');
  assert.match(code, /export function localDayAnchorUtc\(/, 'y localDayAnchorUtc (el ancla Date)');
  assert.doesNotMatch(code, /\bimport\b/, 'es PURA (sin imports: corre en Hermes, web y node)');
  assert.match(code, /getFullYear\(\)/, 'lee el año con el getter LOCAL');
  assert.doesNotMatch(code, /getUTCFullYear|getUTCMonth|getUTCDate/, 'y nunca con getters UTC de calendario');
});

// ─── Auto-detección: los casos sintéticos ────────────────────────────────────────────────────────

test('el guard DETECTA las firmas (no pasa verde por no estar mirando nada)', () => {
  // Complementa al test PROPIEDAD: cubre las formas que el repo NUNCA tuvo pero que un archivo nuevo puede
  // traer. Las que el repo SÍ tuvo las cubre el git, no esta lista.
  assert.equal(TO_ISO, TO_ISO_FIXTURE, 'la regex y los casos sintéticos tienen que nombrar el MISMO método');
  const hit = (code: string, rel = 'src/nuevo.ts') => violationsIn(code, rel).length > 0;

  // Regla A1: las variantes de recorte.
  assert.ok(hit(`return new Date().${TO_ISO_FIXTURE}().slice(0, 10);`));
  assert.ok(hit(`x.${TO_ISO_FIXTURE}().substring(0, 10)`));
  assert.ok(hit(`x.${TO_ISO_FIXTURE}().substr(0,10)`));
  assert.ok(hit(`x.${TO_ISO_FIXTURE}().split('T')[0]`));
  assert.ok(hit(`return new Date()\n  .${TO_ISO_FIXTURE}()\n  .slice(0, 10);`), 'partido por el formatter');
  assert.ok(hit(`return d.toJSON().slice(0, 10);`), 'toJSON es un alias exacto de toISOString');
  // Regla A2: el ISO a una variable y el recorte después (evasión encontrada por el reviewer).
  assert.ok(hit(`const iso = d.${TO_ISO_FIXTURE}();\nreturn iso.slice(0, 10);`));
  assert.ok(hit(`const stamp: string = new Date().${TO_ISO_FIXTURE}();\nconst day = stamp.split('T')[0];`));

  // Regla B: la composición, con y sin consts intermedias, en los dos órdenes, y con join.
  assert.ok(
    hit(
      'function fechaDeHoy() {\n  const d = new Date();\n' +
        "  const mm = String(d.getMonth() + 1).padStart(2, '0');\n" +
        "  const dd = String(d.getDate()).padStart(2, '0');\n" +
        '  return `${d.getFullYear()}-${mm}-${dd}`;\n}',
    ),
    'la forma REAL del repo (mm/dd en consts ANTES) — la que el guard viejo no veía',
  );
  assert.ok(
    hit(
      'const y = now.getFullYear();\nconst m = pad(now.getMonth() + 1);\n' +
        'const dd = pad(now.getDate());\nconst iso = `${y}-${m}-${dd}`;',
    ),
    'con los tres getters hoisteados a consts',
  );
  assert.ok(hit("[d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-')"), 'armado con join');
  assert.ok(hit('const iso = `${d.getUTCFullYear()}-${mm}-${dd}`;'), 'y con getters UTC también');
  assert.ok(
    hit("const SEP = '-';\nconst iso = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join(SEP);"),
    'el guion escondido detrás de una const (un nivel de indirección SÍ se resuelve)',
  );
  // Y su control: un `join` de otra cosa, cerca de getters, NO dispara.
  assert.ok(
    !hit("const SEP = ', ';\nconst txt = [d.getFullYear(), d.getMonth()].join(SEP);"),
    'un join que no es con guion no compone una fecha ISO',
  );

  // Regla D: el ancla por día UTC.
  assert.ok(hit('const hoy = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));'));
  // Regla C: la puerta de atrás por locale.
  assert.ok(hit("const iso = d.toLocaleDateString('sv-SE');"));
  assert.ok(hit("const f = new Intl.DateTimeFormat('en-CA');"));

  // ── LO CORRECTO NO DISPARA ──────────────────────────────────────────────────────────────────────
  assert.ok(!hit(`  createdAt: new Date().${TO_ISO_FIXTURE}(),`), 'instante real serializado ENTERO');
  assert.ok(!hit(`  .update({ deleted_at: new Date().${TO_ISO_FIXTURE}() })`));
  assert.ok(!hit(`  lastSyncedAt: s.lastSyncedAt?.${TO_ISO_FIXTURE}(),`));
  assert.ok(
    !hit('const date = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;'),
    'el display es-AR (día primero, con BARRAS) es legítimo',
  );
  assert.ok(
    !hit(
      'return (\n  a.getFullYear() === b.getFullYear() &&\n  a.getMonth() === b.getMonth() &&\n' +
        '  a.getDate() === b.getDate()\n);',
    ),
    'comparar componentes no compone ninguna fecha',
  );
  assert.ok(!hit("  return n.toLocaleString('es-AR');"), 'el formato de NÚMERO es-AR no es una fecha');
  assert.ok(!hit('const anio = d.getUTCFullYear();'), 'un getter UTC suelto no es el ancla de un día');
  assert.ok(!hit('const key = `${rodeoId}-${animalId}`;'), 'un template con guion sin getters de Date');
  // Una mención en un comentario tampoco (se blanquea antes de escanear).
  assert.ok(!hit(stripComments(`// antes: new Date().${TO_ISO_FIXTURE}().slice(0, 10)`)));
  assert.ok(!hit(stripComments('/* devolvía `${y}-${m}-${dd}` con d.getDate() */')));

  // La válvula de escape exige una razón escrita: sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// today-iso-disable-next-line -- el backend espera UTC acá'));
  assert.ok(!DISABLE_NEXT_LINE.test('// today-iso-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// today-iso-disable-next-line --'));
});

test('las EXENCIONES son mínimas, existen y están justificadas', () => {
  // Una exención sin dueño es un agujero con permiso. Cada archivo eximido tiene que existir, tener un
  // motivo escrito, y —si desaparece— que el guard avise en vez de callarse.
  for (const [rel, why] of [...Object.entries(COMPOSE_ALLOW), ...Object.entries(UTC_ANCHOR_ALLOW)]) {
    assert.ok(why.trim().length > 20, `la exención de ${rel} necesita un motivo escrito, no una etiqueta`);
    const abs = join(APP_ROOT, rel);
    assert.ok(statSync(abs).isFile(), `${rel} está eximido pero no existe: la exención quedó huérfana`);
  }
  assert.ok(
    Object.keys(COMPOSE_ALLOW).length + Object.keys(UTC_ANCHOR_ALLOW).length <= 4,
    'las exenciones no pueden crecer sin que alguien lo note: si hacen falta más, revisá el diseño',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  assertScanCoverage({
    guard: 'today-iso',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: (f) => relative(APP_ROOT, f).split(sep).join('/'),
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripComments,
  });
});

test('el guard recorre el árbol real (y ve los archivos que tenían la derivación propia)', () => {
  const scanned = ROOTS.flatMap(listFiles).map((f) => relative(APP_ROOT, f).split(sep).join('/'));
  assert.ok(scanned.length >= SCANNED_FILES_FLOOR, `debería escanear el árbol real (vio ${scanned.length})`);
  for (const path of PRE_FIX_FILES) {
    const rel = path.replace(/^app\//, '');
    assert.ok(scanned.includes(rel), `${rel} debería estar dentro del árbol escaneado`);
  }
  assert.ok(scanned.includes(CANONICAL), `${CANONICAL} tiene que existir con ese path exacto`);
});
