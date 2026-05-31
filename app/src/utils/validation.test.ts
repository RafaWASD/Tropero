// Tests de validación de inputs de auth (spec 01, R1.1 / T3.2).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con backend).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidEmail,
  isValidPassword,
  isValidName,
  validateSignUp,
  validateSignIn,
  PASSWORD_MIN_LENGTH,
} from './validation.ts';

test('R1.1 isValidEmail acepta emails válidos', () => {
  assert.equal(isValidEmail('raf@rafq.ar'), true);
  assert.equal(isValidEmail('  raf@rafq.ar  '), true); // trim
  assert.equal(isValidEmail('juan.perez@gmail.com'), true);
});

test('R1.1 isValidEmail rechaza emails inválidos', () => {
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('raf'), false);
  assert.equal(isValidEmail('raf@'), false);
  assert.equal(isValidEmail('raf@rafq'), false); // sin TLD
  assert.equal(isValidEmail('raf @rafq.ar'), false); // espacio
  assert.equal(isValidEmail('raf@@rafq.ar'), false);
});

test('R1.1 isValidPassword exige al menos 8 caracteres', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 8);
  assert.equal(isValidPassword('1234567'), false);
  assert.equal(isValidPassword('12345678'), true);
  assert.equal(isValidPassword('una-clave-larga'), true);
});

test('R1.1 isValidName exige no vacío', () => {
  assert.equal(isValidName(''), false);
  assert.equal(isValidName('   '), false);
  assert.equal(isValidName('Raf'), true);
});

test('T3.2 validateSignUp marca cada campo y el flag valid', () => {
  const bad = validateSignUp({ name: '', email: 'no-mail', password: '123' });
  assert.ok(bad.name);
  assert.ok(bad.email);
  assert.ok(bad.password);
  assert.equal(bad.valid, false);

  const good = validateSignUp({ name: 'Raf', email: 'raf@rafq.ar', password: '12345678' });
  assert.equal(good.name, null);
  assert.equal(good.email, null);
  assert.equal(good.password, null);
  assert.equal(good.valid, true);
});

test('T3.2 validateSignIn solo valida formato (no longitud de password)', () => {
  // En login una password corta NO debe disparar el error de "8 caracteres".
  const r = validateSignIn({ email: 'raf@rafq.ar', password: 'x' });
  assert.equal(r.email, null);
  assert.equal(r.password, null);
  assert.equal(r.valid, true);

  const empty = validateSignIn({ email: 'raf@rafq.ar', password: '' });
  assert.ok(empty.password);
  assert.equal(empty.valid, false);

  const badEmail = validateSignIn({ email: 'x', password: 'algo' });
  assert.ok(badEmail.email);
  assert.equal(badEmail.valid, false);
});
