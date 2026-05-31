// Tests del mapeo de errores de Supabase Auth a copy en voseo (spec 01, T3.2).
// Cubre los casos del paso 8 (autorrevisión): email ya registrado, password débil,
// credenciales inválidas, sin red, rate-limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authErrorMessage } from './auth-errors.ts';

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
