// serve-log.test.ts — guard del NO-LEAK del wrapper `serveEf` (spec 23, R2.8/R2.9). node:test.
//
// `serve-log.ts` es el módulo PURO extraído de `serve.ts` (solo globals web: Request/Response/atob/JSON) →
// node:test lo importa y ejerce las MISMAS funciones que producción (buildEfIn/buildEfOut/readSubBestEffort),
// no un espejo a mano. Falsifica el invariante de seguridad: los objetos que se loguean NUNCA contienen el
// token / JWT / header Authorization ni el body/`message` de la respuesta — solo el TAMAÑO (bodyBytes), el
// `sub` (actor) y `error.code`. Corre en el harness de node (type-stripping nativo), sin Deno.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildEfIn, buildEfOut, readSubBestEffort } from './serve-log.ts';

// JWT con sub='u1' y un claim secreto. La firma es irrelevante (readSubBestEffort no la verifica).
// { "alg":"HS256","typ":"JWT" } . { "sub":"u1", "secret_claim":"<SECRET>" } . <sig>
const SECRET_CLAIM = 'TOPSECRET-CLAIM-c0ffee';
const SUB = 'u1';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeJwt(): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ sub: SUB, secret_claim: SECRET_CLAIM });
  const sig = 'ZmFrZS1zaWduYXR1cmU'; // 'fake-signature' base64url — NO se verifica.
  return `${header}.${payload}.${sig}`;
}

test('R2.9: readSubBestEffort saca el sub sin devolver nunca el token', () => {
  const token = makeJwt();
  const req = new Request('https://ef.local/x', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const sub = readSubBestEffort(req);
  assert.equal(sub, SUB);
  // El valor devuelto NO es el token ni contiene el claim secreto.
  assert.equal(String(sub).includes(token), false);
  assert.equal(String(sub).includes(SECRET_CLAIM), false);
});

test('R2.9: readSubBestEffort ante Authorization ausente/basura → undefined (no lanza)', () => {
  const noAuth = new Request('https://ef.local/x', { method: 'POST' });
  assert.equal(readSubBestEffort(noAuth), undefined);
  const junk = new Request('https://ef.local/x', {
    method: 'POST',
    headers: { Authorization: 'Bearer not-a-jwt' },
  });
  assert.equal(readSubBestEffort(junk), undefined);
});

test('R2.8/R2.9: buildEfIn loguea SOLO bodyBytes + actor — nunca el token/JWT/Authorization ni el claim', () => {
  const token = makeJwt();
  const req = new Request('https://ef.local/invite_user', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-length': '512',
    },
  });

  const efIn = buildEfIn('invite_user', 'req-123', req);

  // El actor sale del sub del JWT (best-effort), no del token crudo; bodyBytes es number (tamaño, no body).
  assert.equal(efIn.actor, SUB);
  assert.equal(efIn.bodyBytes, 512);
  assert.equal(typeof efIn.bodyBytes, 'number');

  // Solo las claves esperadas (falsifica: si alguien agrega el header/token, cae acá).
  assert.deepEqual(Object.keys(efIn).sort(), ['actor', 'bodyBytes', 'evt', 'fn', 'requestId']);

  // Barrido de substrings sobre el JSON logueado: NUNCA el token crudo, el claim secreto, ni las palabras
  // Authorization / Bearer.
  const s = JSON.stringify(efIn);
  assert.equal(s.includes(token), false, 'no debe salir el token/JWT crudo');
  assert.equal(s.includes(SECRET_CLAIM), false, 'no debe salir el claim secreto del JWT');
  assert.equal(s.includes('Authorization'), false, 'no debe salir el header Authorization');
  assert.equal(s.includes('Bearer'), false, 'no debe salir el esquema Bearer');
});

test('R2.8: buildEfIn sin content-length → bodyBytes null (no lee el body)', () => {
  const req = new Request('https://ef.local/health', { method: 'POST' });
  const efIn = buildEfIn('health', 'req-0', req);
  assert.equal(efIn.bodyBytes, null);
});

test('R2.8/R2.9: buildEfOut en 4xx incluye error.code pero NUNCA el message ni el body', async () => {
  const res = new Response(
    JSON.stringify({ error: { code: 'x', message: 'SECRETO-DEL-DRIVER-postgres' } }),
    { status: 409, headers: { 'Content-Type': 'application/json' } },
  );
  const efOut = await buildEfOut('change_member_role', 'req-9', res, Date.now() - 5);

  assert.equal(efOut.code, 'x');
  assert.equal(efOut.status, 409);
  assert.equal(typeof efOut.ms, 'number');
  assert.ok(efOut.ms >= 0);

  // Solo las claves esperadas — nada de `message`/`error`/body anidado.
  assert.deepEqual(
    Object.keys(efOut).sort(),
    ['code', 'evt', 'fn', 'ms', 'requestId', 'status'],
  );

  const s = JSON.stringify(efOut);
  assert.equal(s.includes('SECRETO-DEL-DRIVER-postgres'), false, 'no debe salir el message');
  assert.equal(s.includes('message'), false, 'no debe salir la clave message');

  // El body de la respuesta original quedó intacto (buildEfOut usó res.clone(), no consumió el stream).
  const body = (await res.json()) as { error: { message: string } };
  assert.equal(body.error.message, 'SECRETO-DEL-DRIVER-postgres');
});

test('R2.8: buildEfOut en 2xx NO toca/parsea el body (code undefined, sin leak)', async () => {
  const res = new Response(
    JSON.stringify({ token: 'SESSION-SECRET-9', data: { peso: 385 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
  // Espía sobre clone(): en 2xx el wrapper NO debe clonar ni parsear el body de la respuesta.
  let cloneCalled = false;
  const origClone = res.clone.bind(res);
  (res as unknown as { clone: () => Response }).clone = () => {
    cloneCalled = true;
    return origClone();
  };

  const efOut = await buildEfOut('health', 'req-2', res, Date.now());

  assert.equal(efOut.code, undefined);
  assert.equal(efOut.status, 200);
  assert.equal(cloneCalled, false, '2xx no debe clonar ni leer el body de la respuesta');

  const s = JSON.stringify(efOut);
  assert.equal(s.includes('SESSION-SECRET-9'), false);
  assert.equal(s.includes('385'), false);
});

test('R2.8: buildEfOut en 4xx con body no-JSON → code undefined sin lanzar', async () => {
  const res = new Response('<<not json>>', { status: 500 });
  const efOut = await buildEfOut('remove_member', 'req-5', res, Date.now());
  assert.equal(efOut.code, undefined);
  assert.equal(efOut.status, 500);
  const s = JSON.stringify(efOut);
  assert.equal(s.includes('not json'), false, 'no debe salir el body no-JSON');
});
