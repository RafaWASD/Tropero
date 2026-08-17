// request-headers.test.ts — guard del RENAME EN DOS TIEMPOS de los headers propios (rebrand fase 5).
//
// `request-headers.ts` y `cors.ts` son módulos PUROS (sólo globals web: Request/Headers/Response, sin deps
// Deno-only) → node:test importa LAS MISMAS funciones que corren en producción, no un espejo a mano.
//
// ── QUÉ FALSIFICA, Y POR QUÉ CADA COSA ───────────────────────────────────────────────────────────────
//  1. Que el servidor lea el nombre VIEJO. Es LA propiedad del rename en dos tiempos: hay builds
//     instaladas afuera y no hay OTA. Si esto se cae, todo lo que hagan esos clientes entra al audit con
//     `request_id` NULL — no rompe nada visible, la correlación se pierde en silencio.
//  2. Que el `Access-Control-Allow-Headers` contenga TODOS los nombres que el servidor acepta. Es el modo
//     de falla del CORS de la spec 23: en nativo no hay preflight, así que un header permitido de menos
//     sólo se ve en web, y se ve como "no anda", no como "falta un header".
//  3. Que ningún archivo de `supabase/functions` vuelva a escribir el nombre a mano. Escrito sobre la
//     AUSENCIA: no enumera los tres call-sites que había, escanea el árbol — un archivo nuevo que
//     hardcodee el literal nace en ROJO sin que nadie tenga que acordarse de agregarlo acá.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { corsHeaders } from './cors.ts';
import {
  ACCEPTED_REQUEST_ID_HEADERS,
  ACTOR_HEADER,
  LEGACY_ACTOR_HEADER,
  LEGACY_REQUEST_ID_HEADER,
  readRequestIdHeader,
  REQUEST_ID_HEADER,
} from './request-headers.ts';
import { stripSourceComments } from '../../../app/src/utils/strip-comments.ts';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const FUNCTIONS_ROOT = resolve(HERE, '..');

const RID = '3f2b9c1e-8d4a-4b6f-9c2e-1a7d5e0b4c33';
const RID2 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://ef.local/x', { method: 'POST', headers });
}

// ── 1. La lectura tolerante ──────────────────────────────────────────────────────────────────────────

test('fase 5 — el servidor lee CADA uno de los nombres aceptados (incluido el viejo)', () => {
  // Recorre la LISTA, no una enumeración a mano: un nombre agregado a `ACCEPTED_REQUEST_ID_HEADERS` que
  // el lector no mire se cae acá, en vez de quedar como una tolerancia declarada que no existe.
  for (const name of ACCEPTED_REQUEST_ID_HEADERS) {
    assert.equal(
      readRequestIdHeader(reqWith({ [name]: RID })),
      RID,
      `${name} está declarado como aceptado pero readRequestIdHeader no lo lee`,
    );
  }
});

test('fase 5 — el nombre VIEJO sigue resolviendo (clientes ya instalados, sin OTA)', () => {
  // Explícito y por separado del loop de arriba: si alguien "limpia" la lista sin leer el backlog, este
  // test nombra la consecuencia en vez de desaparecer junto con la entrada.
  assert.equal(readRequestIdHeader(reqWith({ [LEGACY_REQUEST_ID_HEADER]: RID })), RID);
  assert.ok(
    ACCEPTED_REQUEST_ID_HEADERS.includes(LEGACY_REQUEST_ID_HEADER),
    'sacar el nombre viejo de la lista es la FASE DE LIMPIEZA (docs/backlog.md): sólo cuando no queden ' +
      'builds instaladas escribiendo el nombre viejo. Hacerlo antes pierde la correlación en silencio.',
  );
});

test('fase 5 — con los DOS presentes gana el NUEVO (precedencia determinista)', () => {
  assert.equal(
    readRequestIdHeader(reqWith({ [REQUEST_ID_HEADER]: RID, [LEGACY_REQUEST_ID_HEADER]: RID2 })),
    RID,
  );
});

test('sin ninguno de los dos → null (el llamador genera uno server-side, R2.3 spec 23)', () => {
  assert.equal(readRequestIdHeader(reqWith({ 'content-type': 'application/json' })), null);
});

test('un header con basura se trata como AUSENTE (R2.4: nada de log-injection ni ids inventados)', () => {
  assert.equal(readRequestIdHeader(reqWith({ [REQUEST_ID_HEADER]: 'no-soy-un-uuid' })), null);
  assert.equal(readRequestIdHeader(reqWith({ [REQUEST_ID_HEADER]: '' })), null);
  assert.equal(readRequestIdHeader(reqWith({ [LEGACY_REQUEST_ID_HEADER]: '../../etc/passwd' })), null);
});

test('el criterio es "el primero VÁLIDO", no "el primero PRESENTE"', () => {
  // El caso que motivó la regla: header nuevo con basura (o vacío) + header viejo bueno. Con "el primero
  // presente" se devolvía la basura, `serveEf` la descartaba y generaba un id nuevo → se perdía la
  // correlación con el id que el cliente ya había puesto en su evento de dominio. Y además quedaba con un
  // criterio DISTINTO al de `audit.resolve_request_id()` en la base, que sí cae al viejo ante un nuevo
  // inválido: dos capas resolviendo parecido pero no igual es exactamente cómo se cuelan estos bugs.
  assert.equal(
    readRequestIdHeader(reqWith({ [REQUEST_ID_HEADER]: 'basura', [LEGACY_REQUEST_ID_HEADER]: RID })),
    RID,
  );
  assert.equal(
    readRequestIdHeader(reqWith({ [REQUEST_ID_HEADER]: '', [LEGACY_REQUEST_ID_HEADER]: RID })),
    RID,
  );
  // …y con los dos inválidos, null (no se elige "el menos malo").
  assert.equal(
    readRequestIdHeader(reqWith({ [REQUEST_ID_HEADER]: 'a', [LEGACY_REQUEST_ID_HEADER]: 'b' })),
    null,
  );
});

test('la lectura es case-insensitive (HTTP lo es; fetch manda los nombres en minúscula)', () => {
  assert.equal(readRequestIdHeader(reqWith({ 'x-mitropero-request-id': RID })), RID);
  assert.equal(readRequestIdHeader(reqWith({ 'x-rafaq-request-id': RID })), RID);
});

test('la grafía de los nombres es la esperada (nuevo Train-Case, viejo intacto)', () => {
  assert.equal(REQUEST_ID_HEADER, 'X-Mitropero-Request-Id');
  assert.equal(ACTOR_HEADER, 'X-Mitropero-Actor');
  assert.equal(LEGACY_REQUEST_ID_HEADER, 'X-Rafaq-Request-Id');
  assert.equal(LEGACY_ACTOR_HEADER, 'X-Rafaq-Actor');
});

// ── 2. CORS derivado, no escrito a mano ──────────────────────────────────────────────────────────────

test('CORS permite TODOS los nombres que la EF acepta (el skew de la spec 23, cerrado por construcción)', () => {
  const allow = corsHeaders['Access-Control-Allow-Headers'];
  const permitidos = allow.split(',').map((h) => h.trim().toLowerCase());
  const faltantes = ACCEPTED_REQUEST_ID_HEADERS.filter(
    (h) => !permitidos.includes(h.toLowerCase()),
  );
  assert.deepEqual(
    faltantes,
    [],
    `el preflight no permite ${faltantes.join(', ')}, que la EF SÍ lee. En nativo no hay preflight, así ` +
      'que esto sólo se rompe en web — y se rompe como "la acción no anda", no como "falta un header".',
  );
});

test('CORS conserva los headers de infra (derivar la lista no puede comerse authorization/apikey)', () => {
  const permitidos = corsHeaders['Access-Control-Allow-Headers']
    .split(',')
    .map((h) => h.trim().toLowerCase());
  for (const base of ['authorization', 'x-client-info', 'apikey', 'content-type']) {
    assert.ok(permitidos.includes(base), `falta ${base} en Access-Control-Allow-Headers`);
  }
});

test('CORS NO anuncia los headers de ACTOR (el actor jamás viene del caller)', () => {
  // Contraprueba del modelo anti-spoof: el actor lo mintea la EF con el `user.id` del JWT ya validado.
  // Anunciarlo como aceptable desde el navegador sería publicitar un canal que no existe (y que si
  // existiera sería el agujero exacto que `audit.resolve_actor()` cierra con el gate de service_role).
  const permitidos = corsHeaders['Access-Control-Allow-Headers'].toLowerCase();
  assert.ok(!permitidos.includes(ACTOR_HEADER.toLowerCase()));
  assert.ok(!permitidos.includes(LEGACY_ACTOR_HEADER.toLowerCase()));
});

// ── 3. Una sola definición (guard sobre la AUSENCIA) ─────────────────────────────────────────────────

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

test('ningún archivo de supabase/functions escribe el nombre del header a mano', () => {
  // El único lugar donde los literales pueden estar es `request-headers.ts` (y este test). Todo lo demás
  // importa las constantes. Si alguien vuelve a hardcodear `'X-…-Request-Id'` en una EF nueva, el rename
  // se parte por la mitad sin que nada avise: el server lee un nombre y el cliente manda otro.
  const HEADER_LITERAL = /['"`]x-(mitropero|rafaq)-(actor|request-id)['"`]/i;
  const EXENTOS = new Set(['_shared/request-headers.ts', '_shared/request-headers.test.ts']);
  const ofensores: string[] = [];
  for (const file of listTsFiles(FUNCTIONS_ROOT)) {
    const rel = relative(FUNCTIONS_ROOT, file).split(sep).join('/');
    if (EXENTOS.has(rel)) continue;
    const code = stripSourceComments(readFileSync(file, 'utf8'));
    if (HEADER_LITERAL.test(code)) ofensores.push(rel);
  }
  assert.deepEqual(
    ofensores,
    [],
    'estos archivos escriben el nombre del header como literal en vez de importar la constante de ' +
      '`_shared/request-headers.ts`. Con más de una definición, el rename en dos tiempos se parte por la ' +
      'mitad y el síntoma es correlación perdida en silencio.',
  );
});

test('el guard del literal DETECTA (no pasa verde por no estar mirando nada)', () => {
  const HEADER_LITERAL = /['"`]x-(mitropero|rafaq)-(actor|request-id)['"`]/i;
  assert.ok(HEADER_LITERAL.test(`req.headers.get('X-Mitropero-Request-Id')`));
  assert.ok(HEADER_LITERAL.test(`headers['X-Rafaq-Actor'] = actorId`));
  assert.ok(HEADER_LITERAL.test('const h = `x-mitropero-actor`;'));
  assert.ok(!HEADER_LITERAL.test('req.headers.get(REQUEST_ID_HEADER)'), 'la constante NO es una violación');
  assert.ok(!HEADER_LITERAL.test(`'authorization, x-client-info'`), 'ni un header ajeno');
  // Y que el blanqueo de comentarios funcione: una MENCIÓN en prosa no puede poner el guard en rojo
  // (los headers de `_shared/*.ts` están documentados en comentarios, con backticks incluidos).
  assert.ok(
    !HEADER_LITERAL.test(stripSourceComments('// propaga el actor por el header `X-Mitropero-Actor`\n')),
    'un comentario que NOMBRA el header no es una definición duplicada',
  );
});

test('el escaneo cubrió el árbol de verdad (anti-vacío)', () => {
  const files = listTsFiles(FUNCTIONS_ROOT);
  assert.ok(files.length >= 15, `esperaba ≥15 .ts bajo supabase/functions, encontré ${files.length}`);
  // Y que las tres puntas que el rename tocó estén EFECTIVAMENTE dentro del escaneo.
  const rels = files.map((f) => relative(FUNCTIONS_ROOT, f).split(sep).join('/'));
  for (const punta of ['_shared/serve.ts', '_shared/supabase.ts', '_shared/cors.ts']) {
    assert.ok(rels.includes(punta), `${punta} tiene que estar en el escaneo`);
  }
});
