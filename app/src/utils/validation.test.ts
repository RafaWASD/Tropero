// Tests de validación de inputs de auth (spec 01, R1.1 / T3.2).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con backend).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidPhone,
  validateSignUp,
  validateSignIn,
  validateCreateEstablishment,
  validateProfile,
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

test('R3.8 isValidPhone exige al menos 8 dígitos (ignora separadores)', () => {
  assert.equal(isValidPhone(''), false);
  assert.equal(isValidPhone('123'), false);
  assert.equal(isValidPhone('11 2345 6789'), true); // 10 dígitos con espacios
  assert.equal(isValidPhone('+54 9 11 1234-5678'), true);
  assert.equal(isValidPhone('abcd'), false);
});

test('R3.3 validateCreateEstablishment exige nombre y provincia', () => {
  const bad = validateCreateEstablishment({ name: '  ', province: '' });
  assert.ok(bad.name);
  assert.ok(bad.province);
  assert.equal(bad.valid, false);

  const okOnlyName = validateCreateEstablishment({ name: 'La Juanita', province: '' });
  assert.equal(okOnlyName.name, null);
  assert.ok(okOnlyName.province);
  assert.equal(okOnlyName.valid, false);

  const good = validateCreateEstablishment({ name: 'La Juanita', province: 'Buenos Aires' });
  assert.equal(good.name, null);
  assert.equal(good.province, null);
  assert.equal(good.valid, true);
});

test('R2.1 validateProfile exige nombre; teléfono opcional pero válido si se ingresa', () => {
  // Nombre vacío → error de nombre.
  const noName = validateProfile({ name: '  ', phone: '11 2345 6789' });
  assert.ok(noName.name);
  assert.equal(noName.phone, null);
  assert.equal(noName.valid, false);

  // Teléfono vacío = OK (opcional): no se fuerza a tenerlo en el form de edición.
  const emptyPhone = validateProfile({ name: 'Raf', phone: '' });
  assert.equal(emptyPhone.name, null);
  assert.equal(emptyPhone.phone, null);
  assert.equal(emptyPhone.valid, true);

  // Teléfono con basura (no vacío e inválido) → error de teléfono.
  const badPhone = validateProfile({ name: 'Raf', phone: '123' });
  assert.equal(badPhone.name, null);
  assert.ok(badPhone.phone);
  assert.equal(badPhone.valid, false);

  // Todo bien.
  const good = validateProfile({ name: 'Raf', phone: '11 2345 6789' });
  assert.equal(good.name, null);
  assert.equal(good.phone, null);
  assert.equal(good.valid, true);
});
