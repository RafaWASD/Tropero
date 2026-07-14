// Tests del mapeo de errores de Supabase Auth a copy en voseo (spec 01, T3.2).
// Cubre los casos del paso 8 (autorrevisión): email ya registrado, password débil,
// credenciales inválidas, sin red, rate-limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authErrorMessage, isNetworkOrRateLimit } from './auth-errors.ts';

test('T3.2 email ya registrado (por code y por message)', () => {
  assert.match(authErrorMessage({ code: 'user_already_exists' }, 'signup'), /ya tiene una cuenta/i);
  assert.match(
    authErrorMessage({ message: 'User already registered' }, 'signup'),
    /ya tiene una cuenta/i,
  );
});

test('T3.2 credenciales inválidas en login', () => {
  assert.match(authErrorMessage({ code: 'invalid_credentials' }, 'signin'), /incorrect/i);
  assert.match(
    authErrorMessage({ message: 'Invalid login credentials' }, 'signin'),
    /incorrect/i,
  );
});

test('T3.2 password débil', () => {
  assert.match(authErrorMessage({ code: 'weak_password' }, 'signup'), /d[ée]bil|8 caracteres/i);
  assert.match(
    authErrorMessage({ message: 'Password should be at least 6 characters' }, 'signup'),
    /d[ée]bil|8 caracteres/i,
  );
});

test('T3.2 sin red devuelve copy accionable de conexión', () => {
  assert.match(authErrorMessage({ message: 'Failed to fetch' }, 'signin'), /conexi[óo]n/i);
  assert.match(authErrorMessage({ message: 'Network request failed' }, 'signin'), /conexi[óo]n/i);
  assert.match(authErrorMessage({ name: 'AuthRetryableFetchError' }, 'signin'), /conexi[óo]n/i);
});

test('R1.7 rate-limit del server (429) se traduce a "demasiados intentos"', () => {
  assert.match(authErrorMessage({ status: 429 }, 'signin'), /demasiados intentos/i);
  assert.match(authErrorMessage({ code: 'over_request_rate_limit' }, 'signin'), /demasiados intentos/i);
});

test('T3.2 fallback por contexto cuando el error no se reconoce', () => {
  assert.match(authErrorMessage({ message: 'algo raro' }, 'signup'), /crear la cuenta/i);
  assert.match(authErrorMessage({ message: 'algo raro' }, 'signin'), /iniciar sesi[óo]n/i);
  assert.match(authErrorMessage({ message: 'algo raro' }, 'reset'), /recuperaci[óo]n/i);
});

test('T3.2 error nulo no rompe', () => {
  assert.equal(typeof authErrorMessage(null), 'string');
  assert.equal(typeof authErrorMessage(undefined), 'string');
});

// ── spec 19 (login social) — contexto 'social' (R6.1–R6.6) ────────────────────────────────────────

test('R6.3 social DEVELOPER_ERROR → copy que invita a email/password, SIN filtrar config', () => {
  const copy = authErrorMessage({ code: 'developer_error' }, 'social');
  assert.match(copy, /Google/);
  assert.match(copy, /email|contrase[ñn]a/i);
  // No filtra detalle de config (client ID / SHA-1 / "developer").
  assert.doesNotMatch(copy, /client|sha|developer|config/i);
});

test('R6.4 social Play Services ausente → copy que degrada a email/password', () => {
  const copy = authErrorMessage({ code: 'play_services_not_available' }, 'social');
  assert.match(copy, /Google Play/i);
  assert.match(copy, /email|contrase[ñn]a/i);
});

test('R6.2 social sin conexión → reusa el copy NETWORK existente', () => {
  assert.match(authErrorMessage({ message: 'Network request failed' }, 'social'), /conexi[óo]n/i);
  assert.match(authErrorMessage({ name: 'AuthRetryableFetchError' }, 'social'), /conexi[óo]n/i);
});

test('R6.5/R6.6 social fallback genérico → invita a email/password sin exponer el mensaje crudo', () => {
  // Un code desconocido de la lib (ej. Apple ERR_* raro) cae al fallback social, NO al copy crudo.
  const copy = authErrorMessage(
    { code: 'err_invalid_response', message: 'The operation could not be completed. (com.apple.AuthenticationServices.AuthorizationError 1000)' },
    'social',
  );
  assert.match(copy, /email|contrase[ñn]a/i);
  // Nunca se filtra el mensaje crudo del proveedor (R6.6).
  assert.doesNotMatch(copy, /AuthorizationError|com\.apple|operation/i);
});

test('R6.1 cancelación no llega a authErrorMessage: el servicio devuelve { ok:false } sin error → silencio', () => {
  // Contrato: la cancelación se resuelve en el servicio (sin objeto error). Si por las dudas se llamara
  // con un error nulo/undefined en contexto social, devuelve un string (no rompe), nunca vacío.
  assert.equal(typeof authErrorMessage(undefined, 'social'), 'string');
  assert.ok(authErrorMessage(undefined, 'social').length > 0);
});

// OBS-2 (fix loop sesión 21): el control de flujo de forgot-password decide la rama
// "mostrar error real vs. mensaje neutro anti-enumeración" mirando el error CRUDO,
// no el copy traducido. Estos tests fijan ese contrato.
test('OBS-2 isNetworkOrRateLimit detecta red', () => {
  assert.equal(isNetworkOrRateLimit({ message: 'Failed to fetch' }), true);
  assert.equal(isNetworkOrRateLimit({ message: 'Network request failed' }), true);
  assert.equal(isNetworkOrRateLimit({ name: 'AuthRetryableFetchError' }), true);
});

test('OBS-2 isNetworkOrRateLimit detecta rate-limit (429 y codes)', () => {
  assert.equal(isNetworkOrRateLimit({ status: 429 }), true);
  assert.equal(isNetworkOrRateLimit({ code: 'over_request_rate_limit' }), true);
  assert.equal(isNetworkOrRateLimit({ code: 'over_email_send_rate_limit' }), true);
});

test('OBS-2 isNetworkOrRateLimit es false para errores no accionables (anti-enumeración)', () => {
  // Sin status/code de red ni 429 → no cortamos el flujo (mostramos mensaje neutro).
  assert.equal(isNetworkOrRateLimit({ message: 'algo raro' }), false);
  assert.equal(isNetworkOrRateLimit({ code: 'invalid_credentials' }), false);
  assert.equal(isNetworkOrRateLimit({ status: 400 }), false);
  // Caso sin status (error parcial / desconocido) → false, fail-closed.
  assert.equal(isNetworkOrRateLimit({}), false);
  assert.equal(isNetworkOrRateLimit(null), false);
  assert.equal(isNetworkOrRateLimit(undefined), false);
});
