// Tests del mapeo PURO "datos por categoría" + la lista de dientes (sub-chunk B, dominio §2).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fieldsForCategory,
  categoryHasField,
  TEETH_OPTIONS,
  isValidTeethState,
} from './animal-category-fields.ts';

// ─── fieldsForCategory: la tabla §2 (corregida por Facundo) ────────────────────────────────

test('recría (machos y hembras) → solo PESO; nada de dientes/condición/preñez', () => {
  // El mapeo es por code (los codes ya son sexo-específicos); el sexo del arg no cambia el resultado.
  const maleRecria = ['ternero', 'novillito', 'novillo', 'torito'];
  const femaleRecria = ['ternera', 'vaquillona'];
  for (const code of [...maleRecria, ...femaleRecria]) {
    const sex = maleRecria.includes(code) ? ('male' as const) : ('female' as const);
    assert.deepEqual(fieldsForCategory(sex, code), ['weight'], `${code} debería pedir solo peso`);
    assert.equal(categoryHasField(sex, code, 'teeth'), false, `${code} NO pide dientes`);
    assert.equal(categoryHasField(sex, code, 'conditionScore'), false, `${code} NO pide condición`);
    assert.equal(categoryHasField(sex, code, 'pregnancy'), false, `${code} NO pide preñez`);
  }
});

test('vaca_segundo_servicio / multipara → dientes + condición + preñez + cría al pie (NO peso)', () => {
  for (const code of ['vaca_segundo_servicio', 'multipara']) {
    const fields = fieldsForCategory('female', code);
    assert.deepEqual(fields, ['teeth', 'conditionScore', 'pregnancy', 'nursing'], code);
    assert.equal(categoryHasField('female', code, 'weight'), false, `${code} NO pide peso`);
  }
});

test('toro → dientes + condición (sin peso, sin preñez, sin cría al pie; CE diferida)', () => {
  const fields = fieldsForCategory('male', 'toro');
  assert.deepEqual(fields, ['teeth', 'conditionScore']);
  assert.equal(categoryHasField('male', 'toro', 'weight'), false);
  assert.equal(categoryHasField('male', 'toro', 'pregnancy'), false);
  assert.equal(categoryHasField('male', 'toro', 'nursing'), false);
});

test('vaquillona_prenada → preñez + condición (a lo sumo); sin peso, sin dientes, sin cría al pie', () => {
  const fields = fieldsForCategory('female', 'vaquillona_prenada');
  assert.deepEqual(fields, ['pregnancy', 'conditionScore']);
  assert.equal(categoryHasField('female', 'vaquillona_prenada', 'weight'), false);
  assert.equal(categoryHasField('female', 'vaquillona_prenada', 'teeth'), false);
  assert.equal(categoryHasField('female', 'vaquillona_prenada', 'nursing'), false);
});

test('un ternero NUNCA pide dientes; una multípara NUNCA pide peso (anti-confusión del brief)', () => {
  assert.equal(categoryHasField('male', 'ternero', 'teeth'), false);
  assert.equal(categoryHasField('female', 'multipara', 'weight'), false);
});

test('codes fuera del alta (cut / vaca_cabana / desconocido) → sin campos extra', () => {
  assert.deepEqual(fieldsForCategory('female', 'cut'), []);
  assert.deepEqual(fieldsForCategory('female', 'vaca_cabana'), []);
  assert.deepEqual(fieldsForCategory('male', 'code_inexistente'), []);
});

test('fieldsForCategory tolera espacios accidentales en el code', () => {
  assert.deepEqual(fieldsForCategory('female', '  multipara  '), [
    'teeth',
    'conditionScore',
    'pregnancy',
    'nursing',
  ]);
});

// ─── TEETH_OPTIONS: lista cerrada del enum teeth_state con labels de campo (Facundo) ──────────

test('TEETH_OPTIONS cubre exactamente los 8 valores del enum teeth_state_enum (DB 0020)', () => {
  const values = TEETH_OPTIONS.map((o) => o.value).sort();
  assert.deepEqual(values, ['1/2', '1/4', '2d', '3/4', '4d', '6d', 'boca_llena', 'sin_dientes'].sort());
});

test('TEETH_OPTIONS labels de campo (Facundo): sin_dientes→"Sin dientes", 2d→"2 dientes", boca_llena→"Boca llena"', () => {
  const byValue = Object.fromEntries(TEETH_OPTIONS.map((o) => [o.value, o.label]));
  assert.equal(byValue['sin_dientes'], 'Sin dientes');
  assert.equal(byValue['1/4'], '1/4');
  assert.equal(byValue['1/2'], '1/2');
  assert.equal(byValue['3/4'], '3/4');
  assert.equal(byValue['2d'], '2 dientes');
  assert.equal(byValue['4d'], '4 dientes');
  assert.equal(byValue['6d'], '6 dientes');
  assert.equal(byValue['boca_llena'], 'Boca llena');
});

test('isValidTeethState acepta los valores del enum y rechaza cualquier otro', () => {
  for (const o of TEETH_OPTIONS) assert.equal(isValidTeethState(o.value), true);
  assert.equal(isValidTeethState('8d'), false);
  assert.equal(isValidTeethState(''), false);
  assert.equal(isValidTeethState(null), false);
  assert.equal(isValidTeethState(undefined), false);
});
