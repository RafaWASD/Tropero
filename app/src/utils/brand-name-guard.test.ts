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
//   F  Las CUATRO puntas del repo que arman el link de invitación dicen EXACTAMENTE el mismo origen, y
//      ese origen es el que el SITIO PUBLICADO declara como suyo. Las cuatro son: el cliente
//      (`INVITE_BASE_URL`), las dos Edge Functions (`invite_user` y `resend_invitation`) y la página
//      publicada `docs/marketing/landing-proximamente/invite.html` — la que arma el link que el invitado
//      COPIA Y PEGA cuando "Abrir en la app" no funciona, o sea la superficie MÁS cercana a él. Ese
//      `.html` acá se LEE, nunca se edita: tiene que seguir siendo byte a byte lo que sirve el Worker.
//      ⚠️ QUÉ PROTEGE Y QUÉ NO (leelo antes de confiar en el verde):
//        · SÍ: que ninguna punta se separe de las otras, ni del origen que el sitio publicado declara en
//          su `<link rel="canonical">` (`landing-proximamente/index.html`). Ese canonical es EL ANCLA, y
//          por eso este test no tiene el dominio escrito como literal: si el origen cambia de verdad,
//          cambia PRIMERO ahí —es lo que se publica— y las puntas tienen que seguirlo.
//        · NO: mover TODO junto —las cuatro puntas Y el canonical— a un dominio ajeno sigue pasando en
//          verde. Es un límite consciente: nada dentro del repo puede saber qué dominio se compró de
//          verdad. Lo único que ataja el dominio muerto concreto es el literal `DEAD_ORIGIN`.
//        · NO: la QUINTA punta, que vive fuera del repo — el secret `APP_URL` del proyecto de Supabase
//          (DEV y PROD). Si está seteado, GANA sobre los defaults de las dos Edge Functions: este guard
//          puede estar verde y el mail salir con otro origen igual. Se alinea a mano en la consola.
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

// ── El origen del link de invitación (REGLA F) ──────────────────────────────────────────────────────
//
// El mismo origen se escribe en CUATRO lugares del repo. El link que el backend devuelve en `accept_url`
// (Edge Functions), el que la app MUESTRA para esa misma invitación (cliente, reconstruido del token) y
// el que la PÁGINA PUBLICADA le da a copiar al invitado tienen que ser el mismo string; si divergen, el
// owner comparte uno sin saber cuál y el fallo aparece recién del lado del invitado.
//
// ⚠️ LA QUINTA PUNTA NO SE PUEDE VER DESDE ACÁ: el secret `APP_URL` del proyecto de Supabase (DEV y
// PROD) pisa los defaults de las dos Edge Functions. Este guard verde NO implica que el mail salga con
// el origen correcto — solo que las cuatro puntas del REPO coinciden entre sí y con el canonical.
interface OriginSite {
  /** Path relativo a la raíz del repo. */
  file: string;
  /** Qué punta es, para que el mensaje de error diga qué se rompe. */
  what: string;
  /** Captura 1 = el origen literal. Si deja de matchear, el test TIRA (no pasa en silencio). */
  re: RegExp;
  /** Cómo arma el link a partir del origen: tiene que ser el MISMO path en las cuatro puntas. */
  build: RegExp;
  /**
   * Cómo se blanquean los comentarios de ESE lenguaje antes de extraer (para que un literal comentado
   * no engañe al extractor). Default: el escáner de TS/JS.
   */
  strip?: (src: string) => string;
}

const APP_URL_DEFAULT = /Deno\.env\.get\('APP_URL'\)\s*\?\?\s*'([^']+)'/;

/**
 * Blanquea comentarios de HTML (`<!-- … -->`) y, después, los de JS/CSS — el `<script>` de la página es
 * JavaScript, así que un `//` de ahí adentro también tiene que blanquearse. Preserva largo y saltos de
 * línea, igual que `stripSourceComments`.
 *
 * Medido sobre las dos páginas de `landing-proximamente`: cero líneas dañadas (mismo largo, ninguna
 * línea con contenido queda en blanco). Y si algún día el escáner de TS sí dañara la línea que la regla
 * necesita, el modo de falla es FAIL-CLOSED: `readOrigin` no encuentra su entrada y TIRA (rojo), no pasa
 * en verde.
 */
function stripHtmlComments(src: string): string {
  const sinHtml = src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  return stripSourceComments(sinHtml);
}

const INVITE_ORIGIN_SITES: readonly OriginSite[] = [
  {
    file: 'app/src/services/members.ts',
    what: 'INVITE_BASE_URL — el CLIENTE reconstruye con esto el link de las invitaciones PENDIENTES',
    re: /INVITE_BASE_URL\s*=\s*'([^']+)'/,
    build: /\$\{INVITE_BASE_URL\}\/invite\?token=/,
  },
  {
    file: 'supabase/functions/invite_user/index.ts',
    what: 'default de APP_URL — el `accept_url` que vuelve al CREAR la invitación',
    re: APP_URL_DEFAULT,
    build: /\$\{appUrl\}\/invite\?token=/,
  },
  {
    file: 'supabase/functions/resend_invitation/index.ts',
    what: 'default de APP_URL — el `accept_url` que vuelve al REGENERAR el token',
    re: APP_URL_DEFAULT,
    build: /\$\{appUrl\}\/invite\?token=/,
  },
  {
    // ⚠️ Esta punta se LEE, NO se edita desde el repo: el archivo tiene que seguir siendo byte a byte
    // lo que sirve el Worker de Cloudflare, o el repo y el sitio se desincronizan. Si esta regla
    // necesitara cambiarlo, se cambia primero en el sitio publicado.
    file: 'docs/marketing/landing-proximamente/invite.html',
    what:
      'la PÁGINA PUBLICADA — el link que el invitado COPIA Y PEGA en la app cuando "Abrir en la app" ' +
      'no funciona (la superficie MÁS cercana al invitado; el origen está hardcodeado, no sale de ' +
      '`window.location.origin`)',
    re: /linkCompleto\s*=\s*'([^']*)\/invite\?token='/,
    build: /linkCompleto\s*=\s*'[^']*\/invite\?token='\s*\+\s*enc\b/,
    strip: stripHtmlComments,
  },
];

/**
 * EL ANCLA de la regla F: el sitio publicado declarando SU PROPIO origen. No es un literal escrito a
 * mano en este test — es el `<link rel="canonical">` de la landing, o sea lo que el sitio le dice al
 * mundo que es. Si el origen cambia de verdad, cambia primero acá y las puntas tienen que seguirlo.
 *
 * Cierra el agujero que la comparación "entre sí" no puede ver: las cuatro puntas coherentes entre sí
 * apuntando a un dominio que nunca se compró — exactamente la forma del bug histórico de este repo.
 */
const CANONICAL_FILE = 'docs/marketing/landing-proximamente/index.html';
const CANONICAL_RE = /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/;

/**
 * El canonical de la raíz lleva barra final por definición (`https://host/`) y las puntas concatenan
 * `/invite?token=` sobre un origen SIN barra. Se normaliza UNA sola barra final — nada más: cualquier
 * otra forma (dos barras, un path) queda como está y la rechaza `PURE_ORIGIN`. Puro → falsificable.
 */
function canonicalOrigin(href: string): string {
  return href.replace(/\/$/, '');
}

/**
 * El dominio MUERTO: nunca se compró, `nslookup` da NXDOMAIN. Estuvo meses en los tres lugares y el
 * síntoma fue un invitado con un link que abre "el servidor no se encuentra". Este literal SÍ es
 * legítimo (prohíbe un valor conocido-malo); el que no puede ser literal es el valor CORRECTO.
 */
const DEAD_ORIGIN = /rafq\.ar/i;

/** Un origen puro: esquema + host (+ puerto). Sin barra final ni path — las cuatro puntas le concatenan
 *  `/invite?token=`, así que una barra de más produce `//invite` y un path de más lo rompe entero. */
const PURE_ORIGIN = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/;

/**
 * EL COMPARADOR, puro y sin I/O (para poder falsificarlo con casos sintéticos, abajo). Devuelve las
 * puntas que NO coinciden con las demás, formateadas. El oráculo son las entradas ENTRE SÍ: no hay
 * ningún origen "esperado" escrito acá — con un literal, cambiar las cuatro puntas y "actualizar el
 * test" pasaría verde sin haber detectado nada, que es justo el movimiento peligroso. (Lo que la
 * comparación entre sí NO puede ver —todas movidas juntas— lo cubre el ancla del canonical.)
 * Referencia = la MAYORÍA (así el mensaje nombra la que se movió, no las que quedaron bien). Sin
 * mayoría (empate o todas distintas) se reportan todas.
 */
function misalignedOrigins(
  entries: readonly { file: string; what: string; origin: string }[],
): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.origin, (counts.get(e.origin) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const mayoria = ranked.length > 0 && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null;
  return entries
    .filter((e) => mayoria === null || e.origin !== mayoria)
    .map(
      (e) =>
        `${e.file} dice "${e.origin}"${mayoria ? ` y las otras dicen "${mayoria}"` : ''} — ${e.what}`,
    );
}

/** Lee el origen declarado en una punta. Tira si la forma cambió: un guard que no encuentra su
 *  entrada no puede "no tener violaciones", tiene que ponerse rojo. */
function readOrigin(site: OriginSite): { origin: string; code: string } {
  const code = (site.strip ?? stripComments)(readFileSync(join(REPO_ROOT, site.file), 'utf8'));
  const m = site.re.exec(code);
  if (!m) {
    throw new Error(
      `[F] no encontré el origen del link en ${site.file} (${site.what}) con ${site.re}. Si la forma ` +
        'del código cambió (o el PATH del link dejó de ser `/invite?token=`), actualizá el extractor ' +
        'EN EL MISMO COMMIT: sin esto el guard no compara nada y las cuatro puntas pueden desalinearse ' +
        'sin que nadie se entere.',
    );
  }
  return { origin: m[1], code };
}

/** La punta registrada para ese archivo (por nombre, no por índice: la lista crece). */
function originSite(file: string): OriginSite {
  const found = INVITE_ORIGIN_SITES.find((s) => s.file === file);
  if (!found) throw new Error(`[F] ${file} no está registrado en INVITE_ORIGIN_SITES`);
  return found;
}

/** Lee el origen que el SITIO PUBLICADO declara como suyo (el ancla de la regla F). */
function readCanonicalOrigin(): string {
  const html = stripHtmlComments(readFileSync(join(REPO_ROOT, CANONICAL_FILE), 'utf8'));
  const m = CANONICAL_RE.exec(html);
  if (!m) {
    throw new Error(
      `[F] no encontré el <link rel="canonical"> en ${CANONICAL_FILE} con ${CANONICAL_RE}. Ese tag es ` +
        'EL ANCLA de la regla F: sin él, el guard no tiene contra qué comparar las puntas y sólo ' +
        'podría verificar que coincidan entre sí (lo que deja pasar "todas movidas juntas"). Si la ' +
        'landing cambió de forma, actualizá el extractor EN EL MISMO COMMIT.',
    );
  }
  const origin = canonicalOrigin(m[1]);
  if (!PURE_ORIGIN.test(origin)) {
    throw new Error(
      `[F] el canonical de ${CANONICAL_FILE} es "${m[1]}" y normalizado da "${origin}", que no es un ` +
        `origen puro (${PURE_ORIGIN}). Las puntas le concatenan "/invite?token=": el ancla tiene que ` +
        'ser esquema+host, no una URL con path.',
    );
  }
  return origin;
}

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

test('F — las CUATRO puntas del link de invitación dicen el MISMO origen que el sitio publicado', () => {
  // (0) ANTI-VACÍO: son cuatro las puntas del repo que ARMAN el link. Si alguien saca una de la lista,
  //     el guard deja de mirarla en silencio — que es exactamente cómo la página publicada estuvo
  //     afuera de esta regla hasta la vuelta 2.
  assert.equal(
    INVITE_ORIGIN_SITES.length,
    4,
    'la regla F mira CUATRO puntas: cliente + invite_user + resend_invitation + la página publicada. ' +
      'Si agregás o sacás una, actualizá este número Y los comentarios que declaran el conteo ' +
      '(`app/src/services/members.ts`, el header de este archivo y las dos Edge Functions).',
  );

  const sites = INVITE_ORIGIN_SITES.map((site) => ({ site, ...readOrigin(site) }));
  const canonical = readCanonicalOrigin();

  // (1) Ninguna apunta al dominio MUERTO.
  assert.deepEqual(
    sites.filter((s) => DEAD_ORIGIN.test(s.origin)).map((s) => `${s.site.file} → ${s.origin}`),
    [],
    'ese dominio nunca existió (NXDOMAIN). Un invitado que toca el link ve "el servidor no se ' +
      'encuentra"; el owner no se entera nunca porque él nunca abre el link que comparte.',
  );

  // (2) EL ANCLA: todas dicen el origen que el SITIO PUBLICADO declara como suyo. Sin esto, mover las
  //     cuatro puntas juntas a un dominio ajeno pasaba en verde — y esa es la forma exacta del bug
  //     histórico (las puntas coherentes entre sí, apuntando a un dominio que nunca se compró).
  assert.deepEqual(
    sites.filter((s) => s.origin !== canonical).map((s) => `${s.site.file} dice "${s.origin}" — ${s.site.what}`),
    [],
    `El sitio publicado declara su propio origen en ${CANONICAL_FILE} (<link rel="canonical">) y hoy ` +
      `vale "${canonical}". Una punta que diga otra cosa manda al invitado a un dominio que no es el ` +
      'que servimos. Si el origen cambió DE VERDAD, se cambia primero en el sitio y después acá — no ' +
      'al revés. ⚠️ Lo que esta regla NO puede ver: que el dominio del canonical esté realmente ' +
      'comprado, y el secret `APP_URL` de Supabase (DEV y PROD), que GANA sobre los defaults de las EFs.',
  );

  // (3) Las cuatro dicen EXACTAMENTE lo mismo (comparador puro, falsificado con casos sintéticos abajo).
  //     Redundante con (2) mientras el canonical exista, pero es el que NOMBRA la que se movió.
  assert.deepEqual(
    misalignedOrigins(sites.map((s) => ({ ...s.site, origin: s.origin }))),
    [],
    'Las puntas del link de invitación quedaron DESALINEADAS: el `accept_url` que manda el backend, el ' +
      'link que la app muestra para la misma invitación y el que la página le da a copiar al invitado ' +
      'apuntan a hosts distintos. Nadie se entera hasta que un invitado no puede entrar. Alineá las ' +
      'cuatro — y acordate de la QUINTA, el secret `APP_URL` de Supabase (DEV y PROD), que este test no ' +
      'puede ver y que GANA sobre los defaults de las Edge Functions.',
  );

  // (4) Forma: origen PURO (esquema + host). Las cuatro concatenan `/invite?token=`, así que una barra
  //     final produce `//invite` y un path de más rompe el link aunque las cuatro "coincidan".
  assert.deepEqual(
    sites.filter((s) => !PURE_ORIGIN.test(s.origin)).map((s) => `${s.site.file} → ${s.origin}`),
    [],
    `el origen tiene que ser esquema+host sin barra final ni path (${PURE_ORIGIN}): las cuatro puntas ` +
      'le concatenan "/invite?token=".',
  );

  // (5) …y lo concatenan IGUAL. Cuatro orígenes idénticos con paths distintos siguen dando links
  //     distintos, que es exactamente el bug que esta regla existe para cerrar.
  assert.deepEqual(
    sites.filter((s) => !s.site.build.test(s.code)).map((s) => `${s.site.file} (esperaba ${s.site.build})`),
    [],
    'una de las puntas dejó de armar el link como `<origen>/invite?token=…`. El path también es parte ' +
      'del acoplamiento: la página web publicada responde en /invite y lee `?token=`.',
  );
});

test('F — el comentario que documenta las puntas las NOMBRA a todas (el conteo no puede mentir)', () => {
  // EL DEFECTO DE LA VUELTA 1, cerrado sobre la ausencia: el comentario decía "CUATRO lugares" y
  // enumeraba tres del repo + el secret, dejando afuera la página publicada — la superficie más cercana
  // al invitado. Un conteo escrito a mano se desactualiza en silencio; acá se verifica la ENUMERACIÓN
  // contra la lista que el guard realmente mira, así una punta nueva nace obligando a documentarla.
  const DOC = 'app/src/services/members.ts';
  const doc = readFileSync(join(REPO_ROOT, DOC), 'utf8');
  const sinNombrar = INVITE_ORIGIN_SITES.filter((s) => s.file !== DOC && !doc.includes(s.file));
  assert.deepEqual(
    sinNombrar.map((s) => s.file),
    [],
    `el comentario de ${DOC} (arriba de INVITE_BASE_URL) es el índice de las puntas del origen: tiene ` +
      'que nombrar TODAS por su path. Una que no está enumerada es una que el próximo rebrand se va a ' +
      'saltear, igual que se salteó la página publicada.',
  );
  assert.ok(
    doc.includes('APP_URL'),
    `${DOC} también tiene que nombrar la punta que vive FUERA del repo (el secret \`APP_URL\` de ` +
      'Supabase): es la única que gana sobre las demás y la única que ningún test puede ver.',
  );
  assert.ok(
    doc.includes(CANONICAL_FILE),
    `${DOC} tiene que nombrar el ancla (${CANONICAL_FILE}): quien cambie el dominio necesita saber que ` +
      'el origen se declara primero en el sitio publicado y que las puntas lo siguen.',
  );
});

test('F (bis) — el placeholder que ve el usuario muestra el MISMO origen que el link real', () => {
  // Superficie del repo que MUESTRA el origen sin armar ningún link (por eso no es una de las cuatro
  // puntas, pero la lee un humano y la copia): el ejemplo del input "Link de invitación". Si queda con
  // un dominio viejo, le estamos mostrando al usuario un link que no existe justo cuando está tratando
  // de pegar el suyo.
  const { origin } = readOrigin(originSite('app/src/services/members.ts'));
  const code = stripComments(readFileSync(join(APP_ROOT, 'app', 'invite.tsx'), 'utf8'));
  const found = allMatches(code, /placeholder="(https?:\/\/[^"]+)"/).map((m) => m.text);
  assert.equal(
    found.length,
    1,
    'esperaba exactamente 1 placeholder con una URL en app/invite.tsx (el del input de pegar el ' +
      `link); encontré ${found.length}. Si se agregó otro, sumalo a esta regla en el mismo commit.`,
  );
  assert.ok(
    found[0].includes(`"${origin}/invite?token=`),
    `el placeholder muestra "${found[0]}" y el link real se arma sobre "${origin}/invite?token=". El ` +
      'ejemplo que ve el usuario tiene que ser el link que de verdad recibe.',
  );
});

test('F — el detector de desalineamiento DETECTA (casos sintéticos, sin tocar el árbol)', () => {
  // Sin esto, la regla F podría estar comparando mal (o no comparando nada) y verse igual: verde.
  // Los orígenes de acá son inventados A PROPÓSITO — el detector no puede depender de cuál sea el
  // dominio real, solo de que las puntas coincidan entre sí.
  const p = (file: string, origin: string) => ({ file, what: `punta ${file}`, origin });
  const A = 'https://uno.example';
  const B = 'https://dos.example';

  assert.deepEqual(misalignedOrigins([p('a', A), p('b', A), p('c', A)]), [], 'las tres iguales → OK');

  const unaSeMovio = misalignedOrigins([p('a', A), p('b', B), p('c', A)]);
  assert.equal(unaSeMovio.length, 1, 'con una punta movida tiene que reportar UNA');
  assert.match(unaSeMovio[0], /^b dice "https:\/\/dos\.example" y las otras dicen "https:\/\/uno\.example"/);

  // La MINORÍA es la que se movió, aunque sea la primera de la lista (si tomáramos la primera punta
  // como referencia, mover justo esa haría que el mensaje acusara a las otras dos).
  const laPrimera = misalignedOrigins([p('a', B), p('b', A), p('c', A)]);
  assert.deepEqual(laPrimera.map((s) => s.split(' ')[0]), ['a']);

  // Todas distintas: no hay mayoría, se reportan todas (no se elige una al azar como "la buena").
  assert.equal(misalignedOrigins([p('a', A), p('b', B), p('c', 'https://tres.example')]).length, 3);

  // Diferencias que un `includes`/`startsWith` dejaría pasar y que rompen el link igual.
  assert.equal(misalignedOrigins([p('a', A), p('b', `${A}/`), p('c', A)]).length, 1, 'barra final');
  assert.equal(misalignedOrigins([p('a', A), p('b', A.toUpperCase()), p('c', A)]).length, 1, 'mayúsculas');
  assert.equal(
    misalignedOrigins([p('a', A), p('b', A.replace('https', 'http')), p('c', A)]).length,
    1,
    'http vs https',
  );

  // El dominio MUERTO y la forma del origen, con los mismos predicados que usa la regla.
  assert.ok(DEAD_ORIGIN.test('https://app.rafq.ar'), 'el detector del dominio muerto tiene que verlo');
  assert.ok(!DEAD_ORIGIN.test(A), 'y no puede disparar sobre un origen cualquiera');
  assert.ok(PURE_ORIGIN.test(A) && PURE_ORIGIN.test('https://sub.dominio.example:8443'));
  assert.ok(!PURE_ORIGIN.test(`${A}/`), 'barra final');
  assert.ok(!PURE_ORIGIN.test(`${A}/invite`), 'path');
  assert.ok(!PURE_ORIGIN.test(A.replace('https', 'http')), 'http pelado en un link de invitación');

  // EL ANCLA (el canonical del sitio publicado), con los mismos predicados que usa la regla. Sin estos
  // casos, el extractor podría estar leyendo cualquier cosa —o nada— y el check (2) verse igual: verde.
  const canon = (html: string) => CANONICAL_RE.exec(html)?.[1] ?? null;
  assert.equal(canon(`<link rel="canonical" href="${A}/">`), `${A}/`, 'lo extrae del tag');
  assert.equal(canon(`<link rel="canonical" href="${A}/" />`), `${A}/`, 'y con el cierre XHTML');
  assert.equal(canon(`<meta property="og:url" content="${B}/">`), null, 'sólo el canonical, no el og:url');
  assert.equal(canon(`<link rel="icon" href="${B}/favicon.png">`), null, 'ni cualquier otro <link>');
  assert.equal(canonicalOrigin(`${A}/`), A, 'la barra final del canonical de la raíz se normaliza');
  assert.equal(canonicalOrigin(A), A, 'y sin barra queda igual');
  // Se normaliza UNA barra, no se "arregla" nada más: lo demás lo rechaza PURE_ORIGIN (fail-closed).
  assert.ok(!PURE_ORIGIN.test(canonicalOrigin(`${A}//`)), 'dos barras no se limpian: quedan rojas');
  assert.ok(!PURE_ORIGIN.test(canonicalOrigin(`${A}/invite/`)), 'un canonical con path no es un origen');

  // …y el blanqueo de comentarios de HTML: un literal comentado NO puede ser lo que lea el extractor.
  const conComentario = `<!-- viejo: <link rel="canonical" href="${B}/"> -->\n<link rel="canonical" href="${A}/">`;
  assert.equal(canon(stripHtmlComments(conComentario)), `${A}/`, 'gana el tag VIVO, no el comentado');
  assert.equal(
    stripHtmlComments(conComentario).split('\n').length,
    2,
    'el blanqueo preserva los saltos de línea (los guards reportan números de línea)',
  );
  assert.ok(
    !stripHtmlComments(`<script>\n// var linkCompleto = '${B}/invite?token=';\n</script>`).includes(B),
    'y el `//` de adentro del <script> también se blanquea: la página publicada es HTML + JS',
  );
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
  // El scheme `rafq://` sigue vigente (el rebrand del DOMINIO del link, 2026-08-11, NO lo tocó: es
  // fase 2 y la página web publicada lo usa para abrir la app). Contiene "rafq", no el nombre viejo.
  assert.ok(!hit("const deepLink = 'rafq://invite?token=' + token;"), 'el deep-link scheme tampoco');

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
