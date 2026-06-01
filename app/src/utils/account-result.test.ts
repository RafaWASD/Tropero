// Tests de la lógica pura de mapeo de resultados de la cuenta (spec 01, Fase 6 — R2.1/R2.2/R2.4/R2.5.1).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con el resto del cliente).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAuthEmailError,
  classifyDeleteNetworkError,
  mapDeleteAccountErrorBody,
  parseBlockingEstablishments,
} from './account-result.ts';

// ─── classifyAuthEmailError (R2.1/R2.2) ─────────────────────────────────────────────

test('changeEmail error: email ya en uso (code email_exists) → email_taken', () => {
  const r = classifyAuthEmailError({ code: 'email_exists', message: 'Email already registered' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'email_taken');
});

test('changeEmail error: "already registered" en el mensaje → email_taken', () => {
  const r = classifyAuthEmailError({ message: 'A user with this email address has already been registered' });
  assert.equal(r.ok === false && r.reason, 'email_taken');
});

test('changeEmail error: email inválido → invalid', () => {
  const r = classifyAuthEmailError({ message: 'Unable to validate email address: invalid format' });
  assert.equal(r.ok === false && r.reason, 'invalid');
});

test('changeEmail error: fallo de red → network', () => {
  const r = classifyAuthEmailError({ message: 'Network request failed' });
  assert.equal(r.ok === false && r.reason, 'network');
  // Network gana sobre cualquier otra clasificación aunque el texto mencionara "email".
  const r2 = classifyAuthEmailError({ message: 'Failed to fetch the email endpoint' });
  assert.equal(r2.ok === false && r2.reason, 'network');
});

test('changeEmail error: mensaje genérico → unknown', () => {
  const r = classifyAuthEmailError({ message: 'Something exploded' });
  assert.equal(r.ok === false && r.reason, 'unknown');
});

test('changeEmail error: sin mensaje ni code → unknown con copy default', () => {
  const r = classifyAuthEmailError({});
  assert.equal(r.ok === false && r.reason, 'unknown');
  assert.equal(r.ok === false && typeof r.message, 'string');
});

// ─── parseBlockingEstablishments (R2.5.1) ───────────────────────────────────────────

test('parseBlockingEstablishments: extrae {id,name} de la lista válida', () => {
  const out = parseBlockingEstablishments([
    { id: 'e1', name: 'La Esperanza' },
    { id: 'e2', name: 'El Ombú' },
  ]);
  assert.deepEqual(out, [
    { id: 'e1', name: 'La Esperanza' },
    { id: 'e2', name: 'El Ombú' },
  ]);
});

test('parseBlockingEstablishments: name faltante → string vacío (no rompe)', () => {
  const out = parseBlockingEstablishments([{ id: 'e1' }]);
  assert.deepEqual(out, [{ id: 'e1', name: '' }]);
});

test('parseBlockingEstablishments: descarta items sin id string', () => {
  const out = parseBlockingEstablishments([
    { id: 'e1', name: 'OK' },
    { id: 42, name: 'sin-id-string' },
    { name: 'sin-id' },
    null,
    'basura',
  ]);
  assert.deepEqual(out, [{ id: 'e1', name: 'OK' }]);
});

test('parseBlockingEstablishments: no-array (null/objeto/undefined) → []', () => {
  assert.deepEqual(parseBlockingEstablishments(null), []);
  assert.deepEqual(parseBlockingEstablishments(undefined), []);
  assert.deepEqual(parseBlockingEstablishments({ id: 'x' }), []);
  assert.deepEqual(parseBlockingEstablishments('nope'), []);
});

// ─── mapDeleteAccountErrorBody (R2.4/R2.5/R2.5.1) ───────────────────────────────────

test('deleteAccount error: 409 sole_owner → reason sole_owner + lista de campos (R2.5.1)', () => {
  const r = mapDeleteAccountErrorBody(
    {
      error: {
        code: 'sole_owner',
        message: 'sole owner of 2 active establishment(s)',
        establishments: [
          { id: 'e1', name: 'La Esperanza' },
          { id: 'e2', name: 'El Ombú' },
        ],
      },
    },
    'fallback',
  );
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'sole_owner');
  assert.equal(r.ok === false && r.establishments.length, 2);
  assert.equal(r.ok === false && r.establishments[0].name, 'La Esperanza');
});

test('deleteAccount error: sole_owner sin establishments → lista vacía (caso race del edge)', () => {
  const r = mapDeleteAccountErrorBody({ error: { code: 'sole_owner', message: 'x' } }, 'fb');
  assert.equal(r.ok === false && r.reason, 'sole_owner');
  assert.deepEqual(r.ok === false && r.establishments, []);
});

test('deleteAccount error: 401 unauthorized → reason unauthorized, sin campos', () => {
  const r = mapDeleteAccountErrorBody({ error: { code: 'unauthorized', message: 'no session' } }, 'fb');
  assert.equal(r.ok === false && r.reason, 'unauthorized');
  assert.deepEqual(r.ok === false && r.establishments, []);
});

test('deleteAccount error: db_error / unexpected → reason unknown', () => {
  const db = mapDeleteAccountErrorBody({ error: { code: 'db_error', message: 'boom' } }, 'fb');
  assert.equal(db.ok === false && db.reason, 'unknown');
  const unx = mapDeleteAccountErrorBody({ error: { code: 'unexpected', message: 'boom' } }, 'fb');
  assert.equal(unx.ok === false && unx.reason, 'unknown');
});

test('deleteAccount error: body sin code → unknown con el message del body', () => {
  const r = mapDeleteAccountErrorBody({ error: { message: 'algo' } }, 'fallback');
  assert.equal(r.ok === false && r.reason, 'unknown');
  assert.equal(r.ok === false && r.message, 'algo');
});

test('deleteAccount error: body nulo → unknown con el rawMessage de fallback', () => {
  const r = mapDeleteAccountErrorBody(null, 'crudo');
  assert.equal(r.ok === false && r.reason, 'unknown');
  assert.equal(r.ok === false && r.message, 'crudo');
});

// ─── classifyDeleteNetworkError ─────────────────────────────────────────────────────

test('deleteAccount: error de fetch sin body → network', () => {
  const r = classifyDeleteNetworkError('Failed to fetch');
  assert.equal(r.ok === false && r.reason, 'network');
});

test('deleteAccount: mensaje crudo no-red → unknown', () => {
  const r = classifyDeleteNetworkError('weird');
  assert.equal(r.ok === false && r.reason, 'unknown');
});
