// Tests del filtrado por sexo del picker de la alta guiada (alta guiada A, paso 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoriesForSex,
  MALE_CATEGORY_CODES,
  FEMALE_CATEGORY_CODES,
} from './animal-category-picker.ts';

// Catálogo de (bovino, cría) tal cual lo devuelve fetchSystemCategories (orden de sort_order del
// seed 0015 + 0059): incluye cut y vaca_cabana, que NO son elegibles en la alta guiada.
const CRIA_CATALOG = [
  { code: 'ternero', name: 'Ternero' },
  { code: 'ternera', name: 'Ternera' },
  { code: 'vaquillona', name: 'Vaquillona' },
  { code: 'vaquillona_prenada', name: 'Vaquillona preñada' },
  { code: 'vaca_segundo_servicio', name: 'Vaca segundo servicio' },
  { code: 'multipara', name: 'Multípara' },
  { code: 'cut', name: 'CUT' },
  { code: 'vaca_cabana', name: 'Vaca cabaña' },
  { code: 'toro', name: 'Toro' },
  { code: 'torito', name: 'Torito' },
  { code: 'novillito', name: 'Novillito' },
  { code: 'novillo', name: 'Novillo' },
];

test('macho: solo las 5 categorías de macho, sin cut/vaca_cabana ni ninguna de hembra', () => {
  const out = categoriesForSex(CRIA_CATALOG, 'male').map((c) => c.code);
  assert.deepEqual([...out].sort(), [...MALE_CATEGORY_CODES].sort());
  assert.ok(!out.includes('cut'));
  assert.ok(!out.includes('vaca_cabana'));
  assert.ok(!out.includes('multipara'));
  assert.ok(!out.includes('vaquillona'));
});

test('hembra: solo las 5 categorías de hembra, sin cut/vaca_cabana ni ninguna de macho', () => {
  const out = categoriesForSex(CRIA_CATALOG, 'female').map((c) => c.code);
  assert.deepEqual([...out].sort(), [...FEMALE_CATEGORY_CODES].sort());
  assert.ok(!out.includes('cut'));
  assert.ok(!out.includes('vaca_cabana'));
  assert.ok(!out.includes('toro'));
  assert.ok(!out.includes('novillito'));
});

test('preserva el ORDEN de entrada (sort_order del catálogo), no reordena', () => {
  // En el catálogo de entrada, ternero (10) viene antes que torito (95) y toro (90). El filtro de
  // macho debe respetar ese orden de entrada: ternero primero, luego toro, torito, novillito, novillo
  // (tal como aparecen en el array de entrada).
  const out = categoriesForSex(CRIA_CATALOG, 'male').map((c) => c.code);
  assert.deepEqual(out, ['ternero', 'toro', 'torito', 'novillito', 'novillo']);
});

test('un code DESCONOCIDO (no mapeado a ningún sexo) no se ofrece a ninguno', () => {
  const withUnknown = [...CRIA_CATALOG, { code: 'quimera', name: 'Quimera' }];
  assert.ok(!categoriesForSex(withUnknown, 'male').some((c) => c.code === 'quimera'));
  assert.ok(!categoriesForSex(withUnknown, 'female').some((c) => c.code === 'quimera'));
});

test('catálogo vacío → []', () => {
  assert.deepEqual(categoriesForSex([], 'male'), []);
  assert.deepEqual(categoriesForSex([], 'female'), []);
});

test('los names legibles se preservan tal cual (el screen muestra el name, no el code)', () => {
  const fem = categoriesForSex(CRIA_CATALOG, 'female');
  const multi = fem.find((c) => c.code === 'multipara');
  assert.equal(multi?.name, 'Multípara');
});
