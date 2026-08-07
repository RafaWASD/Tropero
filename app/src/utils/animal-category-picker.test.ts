// Tests del filtrado por sexo del picker de la alta guiada (alta guiada A, paso 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoriesForSex,
  pickableCategories,
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

// ─── pickableCategories — selector de la FICHA (delta ficha-categoria-tacto, RCM.2) ────────────

test('RCM.2.3 — macho ENTERO: exactamente ternero/torito/toro (P1)', () => {
  const out = pickableCategories(CRIA_CATALOG, 'male', false).map((c) => c.code);
  assert.deepEqual([...out].sort(), ['ternero', 'torito', 'toro']);
  // Ofrecerle "Novillo"/"Novillito" a un animal marcado "Castrado: No" es el estado auto-contradictorio
  // que P1 evita.
  assert.ok(!out.includes('novillo'));
  assert.ok(!out.includes('novillito'));
});

test('RCM.2.3 — macho CASTRADO: exactamente ternero/novillito/novillo (P1)', () => {
  const out = pickableCategories(CRIA_CATALOG, 'male', true).map((c) => c.code);
  assert.deepEqual([...out].sort(), ['novillito', 'novillo', 'ternero']);
  assert.ok(!out.includes('toro'));
  assert.ok(!out.includes('torito'));
});

test('RCM.2.3 — hembra: las 5 de FEMALE_CATEGORY_CODES, con y sin isCastrated (el eje no aplica)', () => {
  const entera = pickableCategories(CRIA_CATALOG, 'female', false).map((c) => c.code);
  const castrada = pickableCategories(CRIA_CATALOG, 'female', true).map((c) => c.code);
  assert.deepEqual([...entera].sort(), [...FEMALE_CATEGORY_CODES].sort());
  assert.deepEqual(entera, castrada, 'la castración no cambia las opciones de una hembra');
});

test('RCM.2.4/RCM.2.5 — `cut` y `vaca_cabana` NUNCA se ofrecen (ninguna combinación)', () => {
  for (const sex of ['male', 'female'] as const) {
    for (const castrated of [false, true]) {
      const out = pickableCategories(CRIA_CATALOG, sex, castrated).map((c) => c.code);
      assert.ok(!out.includes('cut'), `cut ofrecido a ${sex}/${castrated}`);
      assert.ok(!out.includes('vaca_cabana'), `vaca_cabana ofrecida a ${sex}/${castrated}`);
    }
  }
});

test('RCM.2.1 — preserva el ORDEN del catálogo (sort_order), también con el filtro de castración', () => {
  // Orden de entrada del catálogo: … toro(9), torito(10), novillito(11), novillo(12).
  assert.deepEqual(pickableCategories(CRIA_CATALOG, 'male', false).map((c) => c.code), [
    'ternero',
    'toro',
    'torito',
  ]);
  assert.deepEqual(pickableCategories(CRIA_CATALOG, 'male', true).map((c) => c.code), [
    'ternero',
    'novillito',
    'novillo',
  ]);
});

test('RCM.2.6 — catálogo vacío o sin codes conocidos → [] (la ficha no ofrece "Cambiar")', () => {
  assert.deepEqual(pickableCategories([], 'male', false), []);
  assert.deepEqual(pickableCategories([], 'female', false), []);
  const otroSistema = [{ code: 'lechera_alta', name: 'Lechera alta' }];
  assert.deepEqual(pickableCategories(otroSistema, 'female', false), []);
});

test('pickableCategories no muta el catálogo de entrada ni pierde los names', () => {
  const before = JSON.stringify(CRIA_CATALOG);
  const out = pickableCategories(CRIA_CATALOG, 'male', true);
  assert.equal(JSON.stringify(CRIA_CATALOG), before, 'no muta la entrada');
  assert.equal(out.find((c) => c.code === 'novillito')?.name, 'Novillito');
});
