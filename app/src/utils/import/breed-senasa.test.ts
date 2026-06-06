// Tests de la tabla de razas SENASA (spec 12, T1.6 / R6.2, R6.3).
// node:test + type-stripping nativo (sin Jest).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  breedNameFromCode,
  isKnownBreedCode,
  SENASA_BREED_COUNT,
} from './breed-senasa.ts';

test('R6.2 códigos conocidos → nombre legible (grafías literales del manual)', () => {
  assert.equal(breedNameFromCode('AA'), 'Aberdeen Angus');
  assert.equal(breedNameFromCode('H'), 'Hereford');
  assert.equal(breedNameFromCode('PH'), 'Polled Hereford');
  assert.equal(breedNameFromCode('HA'), 'Holando Argentino');
  assert.equal(breedNameFromCode('B'), 'Brahman');
  assert.equal(breedNameFromCode('BG'), 'Brangus');
  assert.equal(breedNameFromCode('BF'), 'Braford');
  assert.equal(breedNameFromCode('OR'), 'Otra Raza');
  assert.equal(breedNameFromCode('S/E'), 'Sin Especificar');
});

test('R6.2 lookup case-insensitive (el código del manual es uppercase, pero CSV puede variar)', () => {
  assert.equal(breedNameFromCode('aa'), 'Aberdeen Angus');
  assert.equal(breedNameFromCode('s/e'), 'Sin Especificar');
  assert.equal(breedNameFromCode(' AA '), 'Aberdeen Angus', 'trim defensivo');
});

test('R6.2 código fuera de tabla → se CONSERVA tal cual (fallback)', () => {
  assert.equal(breedNameFromCode('XYZ'), 'XYZ');
  assert.equal(breedNameFromCode('Angus'), 'Angus', 'texto libre no-código se devuelve igual');
  assert.equal(breedNameFromCode(' ZZ '), 'ZZ', 'trim + conserva');
});

test('borde: vacío / no-string → string vacío (defensivo)', () => {
  assert.equal(breedNameFromCode(''), '');
  assert.equal(breedNameFromCode('   '), '');
  // @ts-expect-error robustez ante no-string
  assert.equal(breedNameFromCode(null), '');
});

test('isKnownBreedCode distingue código de la tabla vs texto libre', () => {
  assert.equal(isKnownBreedCode('AA'), true);
  assert.equal(isKnownBreedCode('aa'), true);
  assert.equal(isKnownBreedCode('Angus'), false);
  assert.equal(isKnownBreedCode(''), false);
});

test('cobertura: la tabla tiene los 32 códigos oficiales', () => {
  assert.equal(SENASA_BREED_COUNT, 32);
});
