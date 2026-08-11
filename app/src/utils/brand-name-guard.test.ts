// GUARD: el NOMBRE DE LA MARCA cara al usuario es uno solo, se escribe de una sola forma, y el
// wordmark no se recorta.
//
// ── EL BUG QUE CIERRA (rebrand fase 1, vuelta 2 — 2026-08-10) ────────────────────────────────────────
// La vuelta 1 del rebrand se hizo **por grep del nombre viejo** sobre los archivos que alguien recordó.
// Resultado medido: la Home decía "miTropero" y el LOGIN —la primera pantalla de todo usuario nuevo—
// seguía diciendo el nombre viejo. Y el mail transaccional llegaba **de** un remitente con el nombre
// viejo y **firmado** con el nuevo. O sea: el rebrand se declaró hecho estando roto justo en el camino
// de alta, que es el único que ve alguien que todavía no es cliente.
//
// ── POR QUÉ SOBRE LA AUSENCIA ────────────────────────────────────────────────────────────────────────
// Porque el modo de falla no es "una pantalla lo dice mal": es "una pantalla NO estaba en la lista".
// Un grep enumera lo que ya sabés que existe; este guard enumera el ÁRBOL. Una pantalla nueva que
// escriba el nombre viejo, o que lo escriba con otra grafía, nace en ROJO sin que nadie tenga que
// acordarse de agregarla a ningún lado.
//
// ── LAS REGLAS ───────────────────────────────────────────────────────────────────────────────────────
//   A  El nombre VIEJO no aparece en código de `app/app` + `app/src`. Excepciones: los identificadores
//      INTERNOS que lo llevan por motivos técnicos (flags globales `__RAFAQ_*__` de E2E/demo y el
//      nombre del archivo SQLite local) — declarados uno por uno, con su motivo.
//   B  El nombre NUEVO se escribe SIEMPRE `miTropero` (mi minúscula, pegado, T mayúscula). Ni
//      "MiTropero", ni "Mi Tropero", ni "mitropero".
//   C  El WORDMARK (el nombre como texto suelto en un `<Text>`) declara `lineHeight` matching su
//      `fontSize`. Es la trampa concreta de este rebrand: el nombre viejo era todo mayúsculas y no
//      tenía NINGÚN descendente; "miTropero" tiene la `p`. Tamagui no aplica el lineHeight del token
//      con `fontSize` suelto → la `p` se recorta. Ninguna E2E funcional ve eso (el texto "está"),
//      solo una captura mirada a ojo o esta firma en el código.
//   E  El remitente de los mails transaccionales muestra el nombre nuevo **y sigue apuntando a
//      `noreply@rafq.ar`**. Las dos mitades importan: Resend verifica el DOMINIO de la dirección, no el
//      display name — rebrandear el dominio antes de verificar `mitropero.com.ar` deja de mandar mails.
//
// ── FALSIFICACIÓN (el test PROPIEDAD) ────────────────────────────────────────────────────────────────
// El oráculo no se escribe de memoria: se saca del git. `PRE_FIX_FILES` trae con `git show` el cuerpo
// LITERAL que cada superficie tenía ANTES del rebrand y exige que dispare. Si alguien afloja una regla,
// el cuerpo histórico deja de disparar y este test cae.
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

// ⚠️ El nombre VIEJO se arma POR CONCATENACIÓN, con DOS partiduras distintas (misma disciplina que
// `today-iso-guard`): así este archivo no contiene la cadena literal que prohíbe —un grep de aceptación
// sobre el árbol sigue dando cero— y un desalineamiento entre la regla y sus casos sintéticos no puede
// cancelarse solo (el assert de igualdad lo caza).
const OLD_NAME = ['RAF', 'AQ'].join(''); // lo que usa la REGLA
const OLD_NAME_FIXTURE = ['R', 'AFAQ'].join(''); // lo que usan los CASOS SINTÉTICOS

/** El nombre nuevo, con su grafía canónica. Es la ÚNICA forma aceptada. */
const BRAND = 'miTropero';

/** Cualquier grafía del nombre nuevo (para exigir que la usada sea exactamente `BRAND`). */
const ANY_BRAND_SPELLING = /mi[\s_-]*tropero/gi;

/**
 * Excepciones de la REGLA A: identificadores INTERNOS que llevan el nombre viejo y NO se rebrandean.
 * Cada uno con el motivo escrito — una exención sin dueño es un agujero con permiso.
 */
const INTERNAL_LITERAL_ALLOW: Record<string, string> = {
  'rafaq.db':
    'nombre del archivo SQLite LOCAL (PowerSync). Renombrarlo le deja la base vieja huérfana a todo ' +
    'device ya instalado: pierde lo que todavía no había sincronizado. No es marca, es almacenamiento.',
};

/**
 * Un `__` inmediatamente antes del nombre viejo lo marca como FLAG GLOBAL interno
 * (`__RAFAQ_BLE_E2E__`, `__RAFAQ_MANEUVER_FAULT__`, `__rafaqBle`). Son marcas que pone Playwright antes
 * del bundle; no las ve ningún usuario y renombrarlas rompe la suite sin ganar nada.
 */
const INTERNAL_FLAG_PREFIX = '__';

/** Válvula de escape por línea, con justificación obligatoria (patrón de los guards del repo). */
const DISABLE_NEXT_LINE = /brand-name-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /brand-name-disable-line\s*--\s*\S/;

// ── El remitente de los mails (REGLA E) ─────────────────────────────────────────────────────────────
const EMAIL_MODULE = 'supabase/functions/_shared/email.ts';
/** La dirección NO se rebrandea en fase 1: Resend verifica el dominio, no el display name. */
const SENDER_ADDRESS = 'noreply@rafq.ar';

// ── LA PROPIEDAD: el oráculo sale del git ───────────────────────────────────────────────────────────
/** El commit anterior al rebrand fase 1 (HEAD al arrancar la vuelta 2). */
const BASELINE = '34066055c90351702cf402c171a6ed318d78cc9d';
/**
 * Las superficies que en `BASELINE` mostraban el nombre VIEJO al usuario. Revertir cualquiera a esa
 * forma tiene que poner este guard en ROJO — es la propiedad que define si el guard sirve. Las tres
 * primeras son las que la vuelta 1 se salteó; la cuarta es la que sí arregló (control histórico).
 */
const PRE_FIX_FILES: readonly string[] = [
  'app/src/components/AuthScreenShell.tsx', // wordmark de las 12 pantallas con AuthScreenShell
  'app/app/invite.tsx', // subtítulo de la pantalla de invitación
  'app/src/utils/invite.ts', // copy saliente por WhatsApp
  'app/app/(tabs)/index.tsx', // wordmark del header de la home
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
      // Los `.test.*` quedan fuera: traen las firmas en sus casos sintéticos y se auto-reportarían.
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

/** Índices de todos los matches de `re` sobre `code`. */
function allMatches(code: string, re: RegExp): { idx: number; text: string }[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out: { idx: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(code)) !== null) {
    out.push({ idx: m.index, text: m[0] });
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

/** REGLA A — el nombre VIEJO en código, descontando los identificadores internos declarados. */
function oldNameHits(code: string, rel: string): { rule: string; idx: number }[] {
  const out: { rule: string; idx: number }[] = [];
  const re = new RegExp(OLD_NAME, 'gi');
  for (const { idx } of allMatches(code, re)) {
    // (1) Flag global interno: `__RAFAQ_…` / `__rafaq…`.
    if (code.slice(idx - INTERNAL_FLAG_PREFIX.length, idx) === INTERNAL_FLAG_PREFIX) continue;
    // (2) Literal interno declarado (hoy: el nombre del archivo SQLite local).
    const allowed = Object.keys(INTERNAL_LITERAL_ALLOW).some(
      (lit) => code.slice(idx, idx + lit.length).toLowerCase() === lit.toLowerCase(),
    );
    if (allowed) continue;
    out.push({ rule: `A nombre viejo (${rel})`, idx });
  }
  return out;
}

/** REGLA B — grafía del nombre nuevo. Cualquier variante que no sea exactamente `miTropero`. */
function spellingHits(code: string): { rule: string; idx: number }[] {
  const out: { rule: string; idx: number }[] = [];
  for (const { idx, text } of allMatches(code, ANY_BRAND_SPELLING)) {
    if (text === BRAND) continue;
    // Carve-out: un DOMINIO (`mitropero.com.ar`, `mitropero.ar`) es minúscula por definición del DNS y
    // no es el wordmark. Se reconoce por el punto + letras inmediatamente después.
    if (/^\.[a-z]/.test(code.slice(idx + text.length, idx + text.length + 2))) continue;
    out.push({ rule: `B grafía "${text}" (la única forma es ${BRAND})`, idx });
  }
  return out;
}

/**
 * REGLA C — el wordmark declara `lineHeight` matching su `fontSize`.
 * Se busca el nombre como TEXTO SUELTO de un elemento JSX (`>miTropero<`), se retrocede hasta la
 * apertura de ese elemento y se leen sus props. Si declara `fontSize="$N"`, tiene que declarar también
 * `lineHeight="$N"` con el MISMO token. Sin eso, Tamagui no aplica el lineHeight y la `p` se recorta.
 */
function wordmarkTags(code: string): { idx: number; openTag: string }[] {
  const out: { idx: number; openTag: string }[] = [];
  const re = new RegExp(`>\\s*${BRAND}\\s*<`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const openStart = code.lastIndexOf('<', m.index);
    if (openStart < 0) continue;
    const openEnd = code.indexOf('>', openStart);
    if (openEnd < 0 || openEnd > m.index) continue;
    out.push({ idx: openStart, openTag: code.slice(openStart, openEnd + 1) });
  }
  return out;
}

function clippedWordmarks(code: string): { rule: string; idx: number }[] {
  const out: { rule: string; idx: number }[] = [];
  for (const { idx, openTag } of wordmarkTags(code)) {
    const fontSize = /fontSize\s*=\s*(?:"([^"]+)"|\{\s*['"]([^'"]+)['"]\s*\})/.exec(openTag);
    if (!fontSize) continue; // sin fontSize explícito no hay token que Tamagui pueda ignorar
    const size = fontSize[1] ?? fontSize[2];
    const lineHeight = /lineHeight\s*=\s*(?:"([^"]+)"|\{\s*['"]([^'"]+)['"]\s*\})/.exec(openTag);
    const lh = lineHeight ? (lineHeight[1] ?? lineHeight[2]) : null;
    if (lh !== size) {
      out.push({
        rule: `C wordmark sin lineHeight matching (fontSize=${size}, lineHeight=${lh ?? 'ausente'})`,
        idx,
      });
    }
  }
  return out;
}

/** Todas las reglas de árbol sobre un texto ya sin comentarios. */
function violationsIn(code: string, rel: string): { rule: string; idx: number }[] {
  return [...oldNameHits(code, rel), ...spellingHits(code), ...clippedWordmarks(code)];
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

test('A — ninguna pantalla de app/app + app/src muestra el nombre VIEJO de la marca', () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('A')),
    [],
    'El rebrand se hizo la primera vez por grep de los archivos que alguien recordó, y así quedó el ' +
      'login diciendo el nombre viejo mientras la home decía el nuevo. Si esto es una superficie que ve ' +
      `el usuario, escribí "${BRAND}". Si es un identificador INTERNO que no se puede renombrar, ` +
      'declarálo en `INTERNAL_LITERAL_ALLOW` con su motivo (o usá la válvula ' +
      '`brand-name-disable-line -- <razón>`). Exenciones vigentes: ' +
      Object.entries(INTERNAL_LITERAL_ALLOW)
        .map(([lit, why]) => `${lit} (${why})`)
        .join(' · '),
  );
});

test(`B — el nombre nuevo se escribe SIEMPRE "${BRAND}" (mi minúscula, pegado, T mayúscula)`, () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('B')),
    [],
    `La grafía es parte de la marca: "${BRAND}", no "MiTropero" ni "Mi Tropero" ni "mitropero". Un ` +
      'nombre escrito de tres formas distintas en tres pantallas se lee como tres productos. (Un ' +
      'DOMINIO en minúscula —`mitropero.com.ar`— está exento: lo pide el DNS, no es el wordmark.)',
  );
});

test('C — el wordmark declara lineHeight matching su fontSize (la `p` tiene descendente)', () => {
  assert.deepEqual(
    scanTree((r) => r.startsWith('C')),
    [],
    `"${BRAND}" tiene DESCENDENTE (la \`p\`) y el nombre viejo, todo mayúsculas, no tenía ninguno. ` +
      'Tamagui NO aplica el lineHeight del token cuando le das `fontSize` suelto → la `p` sale ' +
      'recortada. Agregá `lineHeight="$N"` con el MISMO token que el `fontSize="$N"`. Es el bug ' +
      'recurrente del repo (feedback_descender_clipping): se vetó a ojo sobre una captura, no se ' +
      'dedujo del código.',
  );
});

test('E — el remitente de los mails muestra el nombre nuevo y NO rebrandea el dominio (fase 2)', () => {
  const code = stripComments(readFileSync(join(REPO_ROOT, EMAIL_MODULE), 'utf8'));
  // Mitad 1: el display name está rebrandeado (era la punta que llegaba "de" el nombre viejo).
  assert.match(
    code,
    new RegExp(`['"\`]${BRAND}\\s*<`),
    `el remitente por defecto tiene que mostrar "${BRAND}". Con el nombre viejo acá, el mail llega DE ` +
      'una marca y FIRMADO por otra, que es peor que cualquiera de las dos puntas coherentes.',
  );
  assert.doesNotMatch(code, new RegExp(OLD_NAME, 'i'), 'no puede quedar el nombre viejo en el módulo de mails');
  // Mitad 2: la DIRECCIÓN no se toca. Resend verifica el DOMINIO, no el display name.
  assert.ok(
    code.includes(SENDER_ADDRESS),
    `la dirección tiene que seguir siendo ${SENDER_ADDRESS}: Resend verifica el DOMINIO del remitente, ` +
      'no el nombre para mostrar. Cambiarlo a un dominio nuevo ANTES de verificarlo en Resend deja de ' +
      'mandar los mails (fase 2, no fase 1).',
  );
  // Y la firma del cuerpo, que es la otra mitad de la incoherencia original.
  assert.match(code, new RegExp(`Equipo ${BRAND}`), 'la firma del cuerpo del mail también nombra la marca');
});

// ─── LA PROPIEDAD: el oráculo sale del git, no de la memoria ─────────────────────────────────────

test('PROPIEDAD — revertir CUALQUIERA de las superficies a su forma pre-rebrand pone el guard en ROJO', () => {
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
    if (violationsIn(code, rel).length === 0) ciegos.push(path);
  }
  assert.deepEqual(
    ciegos,
    [],
    'Estas superficies, con su cuerpo REAL de antes del rebrand, NO disparan ninguna regla: el guard es ' +
      'ciego a la forma en que el problema estaba escrito de verdad.',
  );
});

test('PROPIEDAD (control) — el árbol de HOY no dispara sobre esas mismas superficies', () => {
  const falsos: string[] = [];
  for (const path of PRE_FIX_FILES) {
    const rel = path.replace(/^app\//, '');
    const code = stripComments(readFileSync(join(APP_ROOT, rel), 'utf8'));
    const hits = violationsIn(code, rel);
    if (hits.length > 0) falsos.push(`${path}: ${hits.map((h) => h.rule).join(', ')}`);
  }
  assert.deepEqual(falsos, [], 'la versión REBRANDEADA de estas superficies no puede disparar ninguna regla');
});

// ─── Las superficies del wordmark existen (anti-vacío) ───────────────────────────────────────────

test('el wordmark existe en las DOS superficies de identidad (auth + home), y dice el nombre nuevo', () => {
  // Sin esto, borrar los dos wordmarks dejaría las reglas A/B/C verdes para siempre: prohíben decirlo
  // MAL, no obligan a decirlo. Estas son las dos superficies donde la marca se muestra como tal.
  const surfaces = ['src/components/AuthScreenShell.tsx', 'app/(tabs)/index.tsx'];
  for (const rel of surfaces) {
    const code = stripComments(readFileSync(join(APP_ROOT, rel), 'utf8'));
    const tags = wordmarkTags(code);
    assert.equal(tags.length, 1, `${rel} tiene que renderizar el wordmark "${BRAND}" exactamente una vez`);
    assert.match(tags[0].openTag, /fontSize\s*=/, `${rel}: el wordmark declara su fontSize`);
    assert.match(tags[0].openTag, /lineHeight\s*=/, `${rel}: y su lineHeight (la \`p\` tiene descendente)`);
  }
});

test('AuthScreenShell es el wordmark de TODAS las pantallas de auth (no una copia por pantalla)', () => {
  // El motivo por el que arreglar UN archivo alcanzó: las 12 pantallas del camino de alta lo componen.
  // Si alguien vuelve a escribir el wordmark a mano en una pantalla, la regla C la mira igual; este
  // test defiende el otro lado — que el shell siga siendo el que lo pone.
  const consumers = ROOTS.flatMap(listFiles).filter((f) =>
    /\bAuthScreenShell\b/.test(stripComments(readFileSync(f, 'utf8'))),
  );
  assert.ok(
    consumers.length >= 10,
    `el wordmark de auth se compone desde AuthScreenShell; hoy lo usan ${consumers.length} archivos ` +
      '(esperado ≥10 incluyendo sign-in/sign-up/forgot-password/verify-email/update-password/invite)',
  );
});

// ─── Auto-detección: los casos sintéticos ────────────────────────────────────────────────────────

test('el guard DETECTA las firmas (no pasa verde por no estar mirando nada)', () => {
  assert.equal(OLD_NAME, OLD_NAME_FIXTURE, 'la regla y los casos sintéticos tienen que nombrar el MISMO nombre');
  const hit = (code: string, rel = 'src/nuevo.ts') => violationsIn(code, rel).length > 0;

  // REGLA A — el nombre viejo, en las formas en que aparecería.
  assert.ok(hit(`<Text>${OLD_NAME_FIXTURE}</Text>`), 'wordmark JSX');
  assert.ok(hit(`subtitle="Te invitaron a un campo en ${OLD_NAME_FIXTURE}."`), 'copy de una prop');
  assert.ok(hit(`return \`… en ${OLD_NAME_FIXTURE}. Abrí este link\`;`), 'copy en un template literal');
  assert.ok(hit(`const t = 'Equipo ${OLD_NAME_FIXTURE.toLowerCase()}';`), 'y en minúscula también');
  // Su control: los identificadores internos NO disparan.
  assert.ok(!hit(`const K = '__${OLD_NAME_FIXTURE}_BLE_E2E__';`), 'flag global de E2E');
  assert.ok(!hit(`(globalThis as R).__${OLD_NAME_FIXTURE}_MANEUVER_FAULT__ === true`), 'flag leído inline');
  assert.ok(!hit(`const H = '__${OLD_NAME_FIXTURE.toLowerCase()}Ble';`), 'handle de E2E en camelCase');
  assert.ok(!hit(`const DB_FILENAME = '${OLD_NAME_FIXTURE.toLowerCase()}.db';`), 'archivo SQLite local');
  // Y una mención en un COMENTARIO tampoco (se blanquea antes de escanear).
  assert.ok(!hit(stripComments(`// firma verde de ${OLD_NAME_FIXTURE}, igual que CategoryBadge`)));
  assert.ok(!hit(stripComments(`/* el wordmark viejo decía ${OLD_NAME_FIXTURE} */`)));
  // El scheme / los ids de fase 2 NO son el nombre viejo (son otra cadena) → no disparan.
  assert.ok(!hit("const APP_ID = 'ar.rafq.app';"), 'el bundle id es fase 2 y no contiene el nombre');
  assert.ok(!hit("placeholder=\"https://app.rafq.ar/invite?token=…\""), 'la URL de invitación tampoco');

  // REGLA B — las grafías equivocadas del nombre nuevo.
  assert.ok(hit('<Text>MiTropero</Text>'), 'M mayúscula');
  assert.ok(hit('<Text>Mi Tropero</Text>'), 'partido en dos palabras');
  assert.ok(hit("const t = 'Bienvenido a mitropero';"), 'todo minúscula');
  assert.ok(hit("const t = 'MITROPERO';"), 'todo mayúscula');
  assert.ok(!hit(`const t = 'Te invito a sumarte en ${BRAND}.';`), 'la grafía correcta no dispara');
  assert.ok(!hit("const url = 'https://mitropero.com.ar/invite';"), 'un dominio en minúscula está exento');

  // REGLA C — el wordmark sin lineHeight matching (LA trampa de este rebrand).
  assert.ok(
    hit(`<Text fontFamily="$body" fontSize="$7" fontWeight="700">\n  ${BRAND}\n</Text>`),
    'fontSize sin lineHeight → la `p` se recorta',
  );
  assert.ok(
    hit(`<Text fontSize="$7" lineHeight="$5">${BRAND}</Text>`),
    'lineHeight de OTRO token no alcanza (tiene que matchear)',
  );
  assert.ok(
    !hit(`<Text fontSize="$7" lineHeight="$7" fontWeight="700">\n  ${BRAND}\n</Text>`),
    'con el par matching no dispara',
  );
  assert.ok(!hit(`<Text fontWeight="700">${BRAND}</Text>`), 'sin fontSize explícito no hay token que ignorar');
  assert.ok(!hit(`const saludo = '${BRAND}';`), 'el nombre en una string suelta no es un wordmark JSX');

  // La válvula de escape exige una razón escrita.
  assert.ok(DISABLE_NEXT_LINE.test('// brand-name-disable-next-line -- es el id legacy del backend'));
  assert.ok(!DISABLE_NEXT_LINE.test('// brand-name-disable-next-line'));
  assert.ok(!DISABLE_LINE.test('// brand-name-disable-line --'));
});

test('las EXENCIONES son mínimas, están justificadas y siguen VIVAS', () => {
  for (const [lit, why] of Object.entries(INTERNAL_LITERAL_ALLOW)) {
    assert.ok(why.trim().length > 20, `la exención de "${lit}" necesita un motivo escrito, no una etiqueta`);
    // Una exención huérfana (el literal ya no existe en el árbol) es ruido que tapa el próximo caso real.
    const usada = ROOTS.flatMap(listFiles).some((f) => readFileSync(f, 'utf8').includes(lit));
    assert.ok(usada, `"${lit}" está eximido pero ya no existe en el árbol: la exención quedó huérfana`);
  }
  assert.ok(
    Object.keys(INTERNAL_LITERAL_ALLOW).length <= 3,
    'las exenciones no pueden crecer sin que alguien lo note: si hacen falta más, revisá el diseño',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  assertScanCoverage({
    guard: 'brand-name',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: (f) => relative(APP_ROOT, f).split(sep).join('/'),
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripComments,
  });
});
