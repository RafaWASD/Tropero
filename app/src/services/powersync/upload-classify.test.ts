// Tests de la lógica PURA del connector: credenciales + clasificación de errores de upload
// (spec 15, T1.5 / R3.1, R3.4, R3.5). node:test. connector.ts (I/O) importa supabase → no carga acá.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCredentials,
  isTransientUploadError,
  isPermanentServerCode,
} from './upload-classify.ts';

const ENDPOINT = 'https://inst.powersync.journeyapps.com';

// ─── fetchCredentials (R3.1) ──────────────────────────────────────────────────────────

test('R3.1: con sesión Supabase → { endpoint, token: access_token }', () => {
  const creds = buildCredentials(ENDPOINT, { access_token: 'jwt-123' });
  assert.deepEqual(creds, { endpoint: ENDPOINT, token: 'jwt-123' });
});

test('R3.1: SIN sesión → null (contrato del SDK: no conectar hasta el login)', () => {
  assert.equal(buildCredentials(ENDPOINT, null), null);
  assert.equal(buildCredentials(ENDPOINT, undefined), null);
});

test('R3.1: sesión sin access_token (o vacío/null) → null (no conectar con token vacío)', () => {
  assert.equal(buildCredentials(ENDPOINT, {}), null);
  assert.equal(buildCredentials(ENDPOINT, { access_token: '' }), null);
  assert.equal(buildCredentials(ENDPOINT, { access_token: null }), null);
});

// ─── Clasificación transitorio vs permanente (R3.4 / R3.5) ────────────────────────────

test('R3.4: error de red (por mensaje) → transitorio (deja en cola para reintento)', () => {
  for (const msg of ['Failed to fetch', 'network error', 'fetch failed', 'NetworkError', 'request timed out']) {
    assert.equal(isTransientUploadError({ message: msg }), true, `"${msg}" debería ser transitorio`);
  }
});

test('R3.4: 5xx / 429 → transitorio', () => {
  assert.equal(isTransientUploadError({ status: 500 }), true);
  assert.equal(isTransientUploadError({ status: 503 }), true);
  assert.equal(isTransientUploadError({ status: 429 }), true);
});

test('R3.5: RLS 42501 → permanente (descarta la op, no loop)', () => {
  assert.equal(isTransientUploadError({ code: '42501', message: 'permission denied' }), false);
});

test('R3.5: constraints clase 23 (not_null/fk/unique/check) → permanente', () => {
  for (const code of ['23502', '23503', '23505', '23514']) {
    assert.equal(isTransientUploadError({ code }), false, `${code} debería ser permanente`);
  }
});

test('R3.5: 4xx (no 429) → permanente (rechazo del cliente)', () => {
  assert.equal(isTransientUploadError({ status: 400 }), false);
  assert.equal(isTransientUploadError({ status: 403 }), false);
  assert.equal(isTransientUploadError({ status: 409 }), false);
});

test('sin señal clara de rechazo → conservador: transitorio (mejor reintentar un dato de campo)', () => {
  assert.equal(isTransientUploadError({}), true);
  assert.equal(isTransientUploadError(null), true);
  assert.equal(isTransientUploadError({ message: 'algo raro sin code ni status' }), true);
});

test('isPermanentServerCode: clases 22/23/42 + 42501; vacío/otros → no permanente', () => {
  assert.equal(isPermanentServerCode('42501'), true);
  assert.equal(isPermanentServerCode('22001'), true);
  assert.equal(isPermanentServerCode('23505'), true);
  assert.equal(isPermanentServerCode('42P01'), true);
  assert.equal(isPermanentServerCode(''), false);
  assert.equal(isPermanentServerCode('08006'), false); // connection_exception → no es 22/23/42
  assert.equal(isPermanentServerCode('P0002'), false); // not found (manejo idempotente Run T6)
});
