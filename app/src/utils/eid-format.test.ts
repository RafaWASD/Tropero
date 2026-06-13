// Unit de formatEidReadable (spec 09 chunk BLE global, RB3.2). node:test, PURO.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatEidReadable } from './eid-format';

test('RB3.2: agrupa un EID de 15 dígitos como PPP NNNN NNNN NNNN', () => {
  assert.equal(formatEidReadable('982000364696050'), '982 0003 6469 6050');
  assert.equal(formatEidReadable('032123456789012'), '032 1234 5678 9012');
});

test('RB3.2: un string que NO es 15 dígitos se devuelve tal cual (defensa de borde)', () => {
  assert.equal(formatEidReadable('98200036469605'), '98200036469605'); // 14 díg
  assert.equal(formatEidReadable('9820003646960500'), '9820003646960500'); // 16 díg
  assert.equal(formatEidReadable('98200036469605X'), '98200036469605X'); // no-dígito
  assert.equal(formatEidReadable(''), '');
});

test('RB3.2: input no-string no rompe (devuelve string vacío)', () => {
  // @ts-expect-error — probamos el borde defensivo con un tipo inválido a propósito.
  assert.equal(formatEidReadable(null), '');
  // @ts-expect-error — idem.
  assert.equal(formatEidReadable(undefined), '');
});
