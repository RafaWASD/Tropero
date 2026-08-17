// Test de FORMA del requestId de correlación (spec 23). node:test.
// newRequestId() es un uuid v4 random (globalThis.crypto.randomUUID) — sin PII, sin significado.
// El test ejerce la MISMA función que consume el camino caliente (captureExceptionSafe / invokeFn):
// verifica que la forma sea uuid y que dos llamadas colisionen jamás (correlación única por-captura).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newRequestId, REQUEST_ID_HEADER } from './request-id.ts';
// El módulo del BACKEND, importado de verdad (no un espejo escrito a mano). Es puro —sin deps
// Deno-only— así que node lo carga igual que `serve-log.ts`. Los `.test.ts` están EXCLUIDOS del
// tsconfig de la app, así que este import cruzado no entra al `pnpm typecheck`.
import {
  ACCEPTED_REQUEST_ID_HEADERS,
  REQUEST_ID_HEADER as EF_REQUEST_ID_HEADER,
} from '../../../supabase/functions/_shared/request-headers.ts';
import { stripSourceComments } from './strip-comments.ts';

// uuid canónico: 8-4-4-4-12 hex. No exige el nibble de versión/variant — solo la FORMA.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

test('newRequestId(): devuelve un string con forma de uuid', () => {
  const id = newRequestId();
  assert.equal(typeof id, 'string');
  assert.match(id, UUID_RE);
});

test('newRequestId(): dos llamadas devuelven ids distintos', () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.match(a, UUID_RE);
  assert.match(b, UUID_RE);
  assert.notEqual(a, b);
});

// ── El HEADER (rebrand fase 5) ───────────────────────────────────────────────────────────────────────
// El cliente escribe SOLO el nombre nuevo; el servidor acepta además el viejo mientras queden builds
// instaladas (no hay OTA). Lo que estos tests cierran es el modo de falla del rename: que las dos puntas
// digan cosas distintas, o que un call-site nuevo vuelva a escribir el literal a mano y se salga del
// rename sin que nada avise. Ninguno de los dos se ve en runtime: se ve como correlación perdida.

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_SRC = resolve(HERE, '..');

test('el header del cliente es EXACTAMENTE el que el backend acepta (no dos literales parecidos)', () => {
  // Se compara contra el módulo REAL de las Edge Functions, no contra una copia escrita acá: si alguien
  // renombra de un solo lado, esto se cae. Dos literales "iguales a ojo" es cómo se pierde correlación.
  assert.equal(REQUEST_ID_HEADER, EF_REQUEST_ID_HEADER);
  assert.equal(REQUEST_ID_HEADER, 'X-Mitropero-Request-Id');
  assert.ok(
    ACCEPTED_REQUEST_ID_HEADERS.includes(REQUEST_ID_HEADER),
    'el nombre que el cliente ESCRIBE tiene que estar entre los que el servidor ACEPTA',
  );
});

test('ningún archivo de app/src escribe el nombre del header a mano (sobre la AUSENCIA)', () => {
  // No enumera los tres call-sites: escanea el árbol. Un servicio nuevo que hardcodee el literal —en
  // cualquiera de las dos grafías— nace en ROJO sin que nadie tenga que acordarse de agregarlo acá.
  const HEADER_LITERAL = /['"`]x-(mitropero|rafaq)-(actor|request-id)['"`]/i;
  const EXENTO = 'utils/request-id.ts'; // la ÚNICA definición
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(APP_SRC);
  assert.ok(files.length >= 200, `esperaba ≥200 fuentes bajo app/src, encontré ${files.length}`);
  const ofensores = files
    .map((f) => ({ rel: relative(APP_SRC, f).split(sep).join('/'), code: stripSourceComments(readFileSync(f, 'utf8')) }))
    .filter(({ rel, code }) => rel !== EXENTO && HEADER_LITERAL.test(code))
    .map(({ rel }) => rel);
  assert.deepEqual(
    ofensores,
    [],
    'estos archivos escriben el nombre del header como literal en vez de importar `REQUEST_ID_HEADER` de ' +
      '`utils/request-id`. Con más de una definición, un call-site se queda con el nombre viejo y la ' +
      'correlación de ESA acción se pierde sin ningún síntoma.',
  );
  // Y que el detector detecte (si no, "cero ofensores" no significa nada).
  assert.ok(HEADER_LITERAL.test(`headers: { 'X-Mitropero-Request-Id': rid }`));
  assert.ok(HEADER_LITERAL.test(`headers: { 'X-Rafaq-Request-Id': rid }`));
  assert.ok(!HEADER_LITERAL.test(`headers: { [REQUEST_ID_HEADER]: rid }`));
});

test('los tres call-sites de Edge Functions mandan el header por la constante', () => {
  // Anti-vacío del test de arriba: "ningún literal" también sería cierto si nadie mandara el header.
  const CALL_SITES = ['services/account.ts', 'services/members.ts', 'services/push-notifications.ts'];
  for (const rel of CALL_SITES) {
    const code = stripSourceComments(readFileSync(join(APP_SRC, rel), 'utf8'));
    assert.match(
      code,
      /headers:\s*\{\s*\[REQUEST_ID_HEADER\]\s*:/,
      `${rel} tiene que mandar el header de correlación usando la constante compartida`,
    );
  }
});
