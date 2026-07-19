// Tests de validación de inputs de auth (spec 01, R1.1 / T3.2).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con backend).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidEmail,
  isValidPassword,
  isValidName,
  isValidPhone,
  isValidPersonName,
  phoneDigits,
  sanitizePhoneInput,
  validateSignUp,
  validateSignIn,
  validateCreateEstablishment,
  validateProfile,
  validateNewEmail,
  PASSWORD_MIN_LENGTH,
  PHONE_MAX_LENGTH,
  NAME_MAX_LENGTH,
} from './validation.ts';
import type { PhoneValue } from './phone.ts';

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

test('RTEL.5.1/RTEL.5.2 isValidPhone: AR = 10 dígitos exactos; con "+" = 8 a 15 (ignora separadores)', () => {
  // ⚠️ CAMBIO DE CRITERIO del delta TELÉFONO (D2), intencional: antes cualquier cosa de 8 a 15 dígitos
  // daba true, con lo que un número argentino incompleto pasaba la validación. Ahora el modo AR exige
  // los 10 dígitos nacionales y el rango 8–15 queda para el escape internacional (que empieza con '+').
  assert.equal(isValidPhone(''), false);
  assert.equal(isValidPhone('123'), false);
  assert.equal(isValidPhone('12345678'), false); // 8 dígitos SIN '+': ya no alcanza (era true)
  assert.equal(isValidPhone('123456789'), false); // 9 dígitos: falta uno
  assert.equal(isValidPhone('11 2345 6789'), true); // 10 dígitos con espacios
  assert.equal(isValidPhone('+54 9 11 2345-6789'), true); // E.164 AR completo (el 9 se remueve)
  assert.equal(isValidPhone('01123456789'), true); // 0 troncal
  assert.equal(isValidPhone('+12345678'), true); // internacional: 8 dígitos (mínimo)
  assert.equal(isValidPhone('+123456789012345'), true); // internacional: 15 dígitos (máximo)
  assert.equal(isValidPhone('+1234567890123456'), false); // 16 dígitos: pasado el tope
  assert.equal(isValidPhone('+0123456789'), false); // MEDIUM-1: código de país con 0
  assert.equal(isValidPhone('abcd'), false); // letras → 0 dígitos
});

test('R2.1 phoneDigits extrae solo dígitos', () => {
  assert.equal(phoneDigits('+54 9 11 2345-6789'), '5491123456789');
  assert.equal(phoneDigits('11 2345 6789'), '1123456789');
  assert.equal(phoneDigits('(011) 4567-8900'), '01145678900');
  assert.equal(phoneDigits('abc'), '');
  assert.equal(phoneDigits(''), '');
});

test('R2.1 sanitizePhoneInput descarta letras y caracteres no permitidos al tipear', () => {
  // Las LETRAS no pueden quedar en el campo.
  assert.equal(sanitizePhoneInput('11abc2345'), '112345');
  assert.equal(sanitizePhoneInput('telefono'), '');
  // Conserva los separadores de formato permitidos.
  assert.equal(sanitizePhoneInput('+54 9 11 2345-6789'), '+54 9 11 2345-6789');
  assert.equal(sanitizePhoneInput('(011) 4567-8900'), '(011) 4567-8900');
  // Descarta símbolos no permitidos (., /, *, #, etc.).
  assert.equal(sanitizePhoneInput('11.2345/6789'), '1123456789');
  // Recorta a PHONE_MAX_LENGTH.
  const long = '1'.repeat(PHONE_MAX_LENGTH + 10);
  assert.equal(sanitizePhoneInput(long).length, PHONE_MAX_LENGTH);
  // Vacío queda vacío.
  assert.equal(sanitizePhoneInput(''), '');
});

test('R2.1 isValidPersonName: no vacío y a lo sumo NAME_MAX_LENGTH', () => {
  assert.equal(isValidPersonName(''), false);
  assert.equal(isValidPersonName('   '), false); // solo espacios
  assert.equal(isValidPersonName('Raf'), true);
  assert.equal(isValidPersonName('  Juan Pérez  '), true); // trim
  assert.equal(isValidPersonName('a'.repeat(NAME_MAX_LENGTH)), true); // borde
  assert.equal(isValidPersonName('a'.repeat(NAME_MAX_LENGTH + 1)), false); // pasado el tope
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

test('R2.1/RTEL.5.4/RTEL.5.5 validateProfile: nombre obligatorio; teléfono opcional pero completo', () => {
  // El teléfono llega como PhoneValue (los tres estados de PhoneField), NO como texto crudo: el
  // componente es el único que ve lo tipeado (RTEL.3.1.1).
  const VALID: PhoneValue = { kind: 'valid', canonical: '+541123456789' };

  // Nombre vacío → error de nombre.
  const noName = validateProfile({ name: '  ', phone: VALID });
  assert.ok(noName.name);
  assert.equal(noName.phoneInvalid, false);
  assert.equal(noName.valid, false);

  // Nombre demasiado largo → error de nombre.
  const longName = validateProfile({
    name: 'a'.repeat(NAME_MAX_LENGTH + 1),
    phone: { kind: 'empty' },
  });
  assert.ok(longName.name);
  assert.equal(longName.valid, false);

  // RTEL.5.4 — teléfono vacío = OK (opcional): el perfil persiste null.
  const emptyPhone = validateProfile({ name: 'Raf', phone: { kind: 'empty' } });
  assert.equal(emptyPhone.name, null);
  assert.equal(emptyPhone.phoneInvalid, false);
  assert.equal(emptyPhone.valid, true);

  // RTEL.5.5 — teléfono a medio cargar (o no normalizable) → bloquea el guardado.
  const incomplete = validateProfile({ name: 'Raf', phone: { kind: 'incomplete' } });
  assert.equal(incomplete.name, null);
  assert.equal(incomplete.phoneInvalid, true);
  assert.equal(incomplete.valid, false);

  // Teléfono válido → guarda.
  const good = validateProfile({ name: 'Raf', phone: VALID });
  assert.equal(good.name, null);
  assert.equal(good.phoneInvalid, false);
  assert.equal(good.valid, true);
});

test('R2.1/R2.2 validateNewEmail: formato + distinto del actual', () => {
  // Formato inválido.
  assert.ok(validateNewEmail({ newEmail: 'no-mail', currentEmail: 'raf@rafq.ar' }));
  assert.ok(validateNewEmail({ newEmail: '', currentEmail: 'raf@rafq.ar' }));

  // Igual al actual (case/whitespace insensible) → error.
  assert.ok(validateNewEmail({ newEmail: 'raf@rafq.ar', currentEmail: 'raf@rafq.ar' }));
  assert.ok(validateNewEmail({ newEmail: '  RAF@RAFQ.AR ', currentEmail: 'raf@rafq.ar' }));

  // Email nuevo válido y distinto → OK (null).
  assert.equal(validateNewEmail({ newEmail: 'nuevo@rafq.ar', currentEmail: 'raf@rafq.ar' }), null);
  // Sin email actual conocido → solo valida formato.
  assert.equal(validateNewEmail({ newEmail: 'nuevo@rafq.ar', currentEmail: null }), null);
});
