// Tests de los validadores del form de alta (spec 09 R4 / spec 02 design §validaciones).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAnimalCreate, parseWeight, type AnimalCreateForm } from './animal-form.ts';

const TODAY = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

function base(overrides: Partial<AnimalCreateForm> = {}): AnimalCreateForm {
  return {
    sex: 'female',
    birthDate: '',
    entryDate: '',
    entryWeight: '',
    breed: '',
    coatColor: '',
    ...overrides,
  };
}

test('R4.5 sexo obligatorio', () => {
  const r = validateAnimalCreate(base({ sex: null }), TODAY);
  assert.ok(r.sex);
  assert.equal(r.valid, false);

  const okM = validateAnimalCreate(base({ sex: 'male' }), TODAY);
  assert.equal(okM.sex, null);
  assert.equal(okM.valid, true);
});

test('form mínimo válido = solo sexo (resto opcional)', () => {
  const r = validateAnimalCreate(base({ sex: 'female' }), TODAY);
  assert.equal(r.valid, true);
  assert.equal(r.birthDate, null);
  assert.equal(r.entryDate, null);
  assert.equal(r.entryWeight, null);
});

test('birth_date futura → error; pasada/presente → OK', () => {
  const future = validateAnimalCreate(base({ birthDate: '2026-12-31' }), TODAY);
  assert.ok(future.birthDate);
  assert.equal(future.valid, false);

  const past = validateAnimalCreate(base({ birthDate: '2025-01-01' }), TODAY);
  assert.equal(past.birthDate, null);

  const today = validateAnimalCreate(base({ birthDate: '2026-06-01' }), TODAY);
  assert.equal(today.birthDate, null);
});

test('birth_date formato inválido → error', () => {
  assert.ok(validateAnimalCreate(base({ birthDate: '01/06/2026' }), TODAY).birthDate);
  assert.ok(validateAnimalCreate(base({ birthDate: '2026-02-31' }), TODAY).birthDate); // 31 feb
});

test('entry_date ≥ birth_date; antes → error', () => {
  const ok = validateAnimalCreate(
    base({ birthDate: '2025-01-01', entryDate: '2025-03-01' }),
    TODAY,
  );
  assert.equal(ok.entryDate, null);
  assert.equal(ok.valid, true);

  const before = validateAnimalCreate(
    base({ birthDate: '2025-03-01', entryDate: '2025-01-01' }),
    TODAY,
  );
  assert.ok(before.entryDate);
  assert.equal(before.valid, false);
});

test('entry_date futura → error', () => {
  const r = validateAnimalCreate(base({ entryDate: '2027-01-01' }), TODAY);
  assert.ok(r.entryDate);
});

test('entry_weight > 0 si presente; vacío OK; 0/negativo/no-numérico → error', () => {
  assert.equal(validateAnimalCreate(base({ entryWeight: '' }), TODAY).entryWeight, null);
  assert.equal(validateAnimalCreate(base({ entryWeight: '320' }), TODAY).entryWeight, null);
  assert.equal(validateAnimalCreate(base({ entryWeight: '320,5' }), TODAY).entryWeight, null); // coma es-AR
  assert.ok(validateAnimalCreate(base({ entryWeight: '0' }), TODAY).entryWeight);
  assert.ok(validateAnimalCreate(base({ entryWeight: '-5' }), TODAY).entryWeight);
  assert.ok(validateAnimalCreate(base({ entryWeight: 'mucho' }), TODAY).entryWeight);
});

test('FIXB entry_weight: máximo 4 cifras (9999 OK; 10000 rechazado)', () => {
  // 9999 (límite de 4 cifras) y el récord histórico (1.740) pasan.
  assert.equal(validateAnimalCreate(base({ entryWeight: '9999' }), TODAY).entryWeight, null);
  assert.equal(validateAnimalCreate(base({ entryWeight: '1740' }), TODAY).entryWeight, null);
  // 10000 (5 cifras) → error de dominio.
  const err = validateAnimalCreate(base({ entryWeight: '10000' }), TODAY).entryWeight;
  assert.ok(err);
  assert.match(String(err), /4 cifras/);
});

test('parseWeight: coma o punto decimal, rechaza basura', () => {
  assert.equal(parseWeight('320'), 320);
  assert.equal(parseWeight('320,5'), 320.5);
  assert.equal(parseWeight('320.5'), 320.5);
  assert.equal(parseWeight(''), null);
  assert.equal(parseWeight('abc'), null);
  assert.equal(parseWeight('3a'), null);
});
