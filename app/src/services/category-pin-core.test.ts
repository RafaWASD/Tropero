// Tests del núcleo PURO de la fijación manual de categoría (delta spec 02 `ficha-categoria-tacto`,
// RCM.5.1/RCM.5.2/RCM.6.2/RCM.6.3/RCM.6.6). Fakes del resolve + de los DOS writes: acá se verifica CUÁL
// builder se usa, CON QUÉ id, y —sobre todo— que en los caminos de error NO se llama a ningún write.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideCategoryPin,
  PIN_CATEGORY_UNRESOLVED_MESSAGE,
  PIN_DERIVED_UNRESOLVED_MESSAGE,
  type PinWriteOutcome,
} from './category-pin-core.ts';

type Call = { which: 'pin' | 'revert'; categoryId: string };

/** Dobles de los dos writes que REGISTRAN la llamada (cuál y con qué id) — el oráculo de la decisión. */
function spies(outcome: PinWriteOutcome = { ok: true, value: true }) {
  const calls: Call[] = [];
  return {
    calls,
    writePin: async (categoryId: string) => {
      calls.push({ which: 'pin', categoryId });
      return outcome;
    },
    writeRevert: async (categoryId: string) => {
      calls.push({ which: 'revert', categoryId });
      return outcome;
    },
  };
}

test('RCM.5.1 — elegida ≠ derivada → FIJAR con el id de la ELEGIDA, override=true', async () => {
  const s = spies();
  const r = await decideCategoryPin({
    chosen: { code: 'multipara', categoryId: 'cat-multi' },
    derived: { code: 'vaquillona', categoryId: 'cat-vaq' },
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, [{ which: 'pin', categoryId: 'cat-multi' }], 'un solo write, el de fijación');
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, { override: true, categoryCode: 'multipara' });
});

test('RCM.5.2 (P2) — elegida = derivada → REVERT con el id de la DERIVADA, override=false', async () => {
  const s = spies();
  const r = await decideCategoryPin({
    // Mismo code, ids DISTINTOS a propósito: el que se escribe tiene que ser el de la DERIVADA (es la
    // resolución compartida con "Quitar fijación" — si se escribiera el otro, este test cae).
    chosen: { code: 'vaquillona', categoryId: 'cat-vaq-desde-el-picker' },
    derived: { code: 'vaquillona', categoryId: 'cat-vaq-derivada' },
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, [{ which: 'revert', categoryId: 'cat-vaq-derivada' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, { override: false, categoryCode: 'vaquillona' });
});

test('RCM.6.2 — el code elegido NO resuelve en el catálogo → error es-AR y CERO writes', async () => {
  const s = spies();
  const r = await decideCategoryPin({
    chosen: null,
    derived: { code: 'vaquillona', categoryId: 'cat-vaq' },
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, [], 'NO se escribe nada (0021 rechazaría con 23514 al subir)');
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.message, PIN_CATEGORY_UNRESOLVED_MESSAGE);
  assert.equal(!r.ok && r.error.kind, 'unknown');
});

test('RCM.6.2 — id de la elegida VACÍO (no solo null) tampoco escribe', async () => {
  const s = spies();
  const r = await decideCategoryPin({
    chosen: { code: 'multipara', categoryId: '' },
    derived: null,
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, []);
  assert.equal(r.ok, false);
});

test('RCM.6.3 — derivada IRRESOLUBLE: fijar SÍ se puede (no la necesita) → write de fijación', async () => {
  const s = spies();
  const r = await decideCategoryPin({
    chosen: { code: 'multipara', categoryId: 'cat-multi' },
    derived: null,
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, [{ which: 'pin', categoryId: 'cat-multi' }]);
  assert.deepEqual(r.ok && r.value, { override: true, categoryCode: 'multipara' });
});

test('RCM.6.3 — derivada con code igual pero SIN id utilizable → error es-AR y CERO writes', async () => {
  const s = spies();
  const r = await decideCategoryPin({
    chosen: { code: 'vaquillona', categoryId: 'cat-vaq' },
    derived: { code: 'vaquillona', categoryId: '' },
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, [], 'el revert sin id no se ejecuta con un category_id vacío');
  assert.equal(!r.ok && r.error.message, PIN_DERIVED_UNRESOLVED_MESSAGE);
});

test('el error del WRITE se propaga tal cual (kind incluido) y no se inventa un mensaje', async () => {
  const s = spies({ ok: false, error: { kind: 'network', message: 'sin red' } });
  const r = await decideCategoryPin({
    chosen: { code: 'multipara', categoryId: 'cat-multi' },
    derived: { code: 'vaquillona', categoryId: 'cat-vaq' },
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error.kind, 'network');
  assert.equal(!r.ok && r.error.message, 'sin red');
});

test('el error del write en el camino REVERT también se propaga', async () => {
  const s = spies({ ok: false, error: { kind: 'unknown', message: 'db locked' } });
  const r = await decideCategoryPin({
    chosen: { code: 'vaquillona', categoryId: 'x' },
    derived: { code: 'vaquillona', categoryId: 'cat-vaq' },
    writePin: s.writePin,
    writeRevert: s.writeRevert,
  });
  assert.deepEqual(s.calls, [{ which: 'revert', categoryId: 'cat-vaq' }]);
  assert.equal(!r.ok && r.error.message, 'db locked');
});

test('los dos writes son MUTUAMENTE EXCLUYENTES: nunca se llaman los dos, nunca se llama dos veces', async () => {
  const combos = [
    { chosen: { code: 'a', categoryId: 'ia' }, derived: { code: 'a', categoryId: 'ida' } },
    { chosen: { code: 'a', categoryId: 'ia' }, derived: { code: 'b', categoryId: 'idb' } },
    { chosen: { code: 'a', categoryId: 'ia' }, derived: null },
  ];
  for (const c of combos) {
    const s = spies();
    await decideCategoryPin({ ...c, writePin: s.writePin, writeRevert: s.writeRevert });
    assert.equal(s.calls.length, 1, `exactamente un write para ${JSON.stringify(c)}`);
  }
});

test('el `categoryCode` devuelto es el que quedó GUARDADO (para el optimismo en sitio, RCM.6.5)', async () => {
  // Caso revert: lo que queda guardado es la DERIVADA, no lo que el usuario tocó (mismo code acá, pero el
  // contrato es "lo que quedó"). Caso pin: la elegida.
  const s1 = spies();
  const r1 = await decideCategoryPin({
    chosen: { code: 'vaquillona', categoryId: 'a' },
    derived: { code: 'vaquillona', categoryId: 'b' },
    writePin: s1.writePin,
    writeRevert: s1.writeRevert,
  });
  assert.equal(r1.ok && r1.value.categoryCode, 'vaquillona');
  const s2 = spies();
  const r2 = await decideCategoryPin({
    chosen: { code: 'ternera', categoryId: 'a' },
    derived: { code: 'vaquillona', categoryId: 'b' },
    writePin: s2.writePin,
    writeRevert: s2.writeRevert,
  });
  assert.equal(r2.ok && r2.value.categoryCode, 'ternera');
});
