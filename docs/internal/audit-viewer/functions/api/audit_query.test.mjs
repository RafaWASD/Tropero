// Test de la Cloudflare Pages Function `audit_query` (proxy same-origin del visor de auditoría).
// Runner: node:test. Corre MANUAL (no está cableado a scripts/run-tests.mjs, que vive en scripts/ —
// fuera del slice docs/internal/audit-viewer/**):
//   node --test docs/internal/audit-viewer/functions/api/audit_query.test.mjs
// Cubre RCFA.1.2 (401 sin header, sin fetch), RCFA.1.3 (reenvía JWT + body + proxy secret),
// RCFA.1.4 (respuesta upstream tal cual), RCFA.1.6 (no propaga otros headers del cliente).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from './audit_query.js';

const EF_URL = 'https://example.supabase.co/functions/v1/audit_query';
const ENV = { MITROPERO_AUDIT_EF_URL: EF_URL, MITROPERO_AUDIT_PROXY_SECRET: 'proxy-secret-xyz' };

// Instala un fetch mock que registra la llamada y devuelve una Response canned. Devuelve el registro.
function stubFetch(response) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function ctx(headers, body, env = ENV) {
  const request = new Request('https://visor.example/api/audit_query', {
    method: 'POST',
    headers,
    body,
  });
  return { request, env };
}

test('sin Cf-Access-Jwt-Assertion → 401 y NO llama a la EF (RCFA.1.2)', async () => {
  const fetchStub = stubFetch(new Response('{"rows":[]}', { status: 200 }));
  try {
    const res = await onRequestPost(ctx({ 'Content-Type': 'application/json' }, '{"table_name":"user_roles"}'));
    assert.equal(res.status, 401);
    assert.equal(fetchStub.calls.length, 0, 'no debe llamar a la EF');
    const json = await res.json();
    assert.equal(json.error.code, 'unauthorized');
  } finally {
    fetchStub.restore();
  }
});

test('header vacío → 401 sin fetch (RCFA.1.2)', async () => {
  const fetchStub = stubFetch(new Response('{}', { status: 200 }));
  try {
    const res = await onRequestPost(ctx({ 'Cf-Access-Jwt-Assertion': '' }, '{}'));
    assert.equal(res.status, 401);
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test('con JWT → reenvía a la EF con JWT + proxy secret + Content-Type y el body crudo (RCFA.1.3)', async () => {
  const fetchStub = stubFetch(new Response('{"rows":[{"id":"1"}],"next_cursor":null}', { status: 200 }));
  try {
    const rawBody = '{"table_name":"user_roles","op":"UPDATE"}';
    const res = await onRequestPost(ctx({ 'Cf-Access-Jwt-Assertion': 'jwt-abc' }, rawBody));

    assert.equal(fetchStub.calls.length, 1);
    const call = fetchStub.calls[0];
    assert.equal(call.url, EF_URL);
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['Cf-Access-Jwt-Assertion'], 'jwt-abc');
    assert.equal(call.init.headers['X-Mitropero-Proxy-Secret'], 'proxy-secret-xyz');
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.equal(call.init.body, rawBody, 'el body se reenvía crudo, idéntico');

    // Respuesta upstream tal cual (RCFA.1.4)
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.rows[0].id, '1');
  } finally {
    fetchStub.restore();
  }
});

test('devuelve el status upstream tal cual, ej. 400 (RCFA.1.4)', async () => {
  const fetchStub = stubFetch(
    new Response('{"error":{"code":"invalid_filter","message":"x"}}', { status: 400 })
  );
  try {
    const res = await onRequestPost(ctx({ 'Cf-Access-Jwt-Assertion': 'jwt-abc' }, '{"op":"NOPE"}'));
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error.code, 'invalid_filter');
  } finally {
    fetchStub.restore();
  }
});

test('NO propaga otros headers del cliente (Authorization/apikey) a la EF (RCFA.1.6)', async () => {
  const fetchStub = stubFetch(new Response('{"rows":[]}', { status: 200 }));
  try {
    await onRequestPost(ctx({
      'Cf-Access-Jwt-Assertion': 'jwt-abc',
      'Authorization': 'Bearer spoofed',
      'apikey': 'spoofed-anon',
      'X-Mitropero-Proxy-Secret': 'spoofed-by-client',
    }, '{}'));

    const sent = fetchStub.calls[0].init.headers;
    // El proxy secret sale del env, NO del cliente (aunque el cliente lo intente spoofear).
    assert.equal(sent['X-Mitropero-Proxy-Secret'], 'proxy-secret-xyz');
    assert.equal(sent['Authorization'], undefined, 'no reenvía Authorization del cliente');
    assert.equal(sent['apikey'], undefined, 'no reenvía apikey del cliente');
    // Solo los 3 headers de confianza.
    assert.deepEqual(
      Object.keys(sent).sort(),
      ['Cf-Access-Jwt-Assertion', 'Content-Type', 'X-Mitropero-Proxy-Secret']
    );
  } finally {
    fetchStub.restore();
  }
});

test('sin MITROPERO_AUDIT_PROXY_SECRET en env → no manda el header (fail-closed en la EF) (§6-bis)', async () => {
  const fetchStub = stubFetch(new Response('{"rows":[]}', { status: 200 }));
  try {
    const env = { MITROPERO_AUDIT_EF_URL: EF_URL }; // sin proxy secret
    await onRequestPost(ctx({ 'Cf-Access-Jwt-Assertion': 'jwt-abc' }, '{}', env));
    const sent = fetchStub.calls[0].init.headers;
    assert.equal(sent['X-Mitropero-Proxy-Secret'], undefined);
    // La EF, que exige el secreto, responderá 401 → fail-closed.
  } finally {
    fetchStub.restore();
  }
});
