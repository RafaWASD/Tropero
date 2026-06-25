// Tests de la validación PURA del RENSPA (spec 08, R2.2). node:test. Espeja el CHECK 0110.

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateRenspa, RENSPA_MAX_LENGTH } from './renspa-validate';

test('validateRenspa: vacío → OK con value null (RENSPA es opcional / borrarlo es legítimo)', () => {
  assert.deepEqual(validateRenspa(''), { ok: true, value: null });
  assert.deepEqual(validateRenspa('   '), { ok: true, value: null }); // solo espacios → trim → null
});

test('validateRenspa: un RENSPA válido → OK con el value trimeado', () => {
  assert.deepEqual(validateRenspa('01.001.0.00001'), { ok: true, value: '01.001.0.00001' });
  assert.deepEqual(validateRenspa('  AB123  '), { ok: true, value: 'AB123' }); // se trimea
});

test('validateRenspa: exactamente 20 chars → OK (límite inclusivo)', () => {
  const at20 = 'a'.repeat(RENSPA_MAX_LENGTH);
  assert.equal(at20.length, 20);
  assert.deepEqual(validateRenspa(at20), { ok: true, value: at20 });
});

test('validateRenspa: > 20 chars → error accionable', () => {
  const over = 'a'.repeat(RENSPA_MAX_LENGTH + 1);
  const r = validateRenspa(over);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /20 caracteres/);
});

test('validateRenspa: el tope se mide sobre el TRIM (espacios de borde no cuentan al límite)', () => {
  // 20 chars reales + espacios alrededor → válido (lo que se guarda es el trim de 20).
  const padded = '   ' + 'x'.repeat(20) + '   ';
  const r = validateRenspa(padded);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value, 'x'.repeat(20));
});
