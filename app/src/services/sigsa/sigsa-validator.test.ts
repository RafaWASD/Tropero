// Tests del validador PURO pre-export SIGSA (spec 08, T10 / R8.1, R8.2, R8.3, R8.6).
// node:test + type-stripping nativo (sin Jest); mismo patrón que parse-sigsa-txt.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateForExport } from './sigsa-validator.ts';
import type { PendingAnimalInfo } from './types.ts';

/** Helper: animal crudo VÁLIDO (pasa las 3 validaciones), sobreescribible por campo. */
function validAnimal(overrides: Partial<PendingAnimalInfo> = {}): PendingAnimalInfo {
  return {
    animalProfileId: 'ap-1',
    rfid: '032010000000000',
    sex: 'male',
    birthDate: '2025-08-15',
    breedId: 'breed-uuid-1',
    breedCode: 'AA',
    ...overrides,
  };
}

test('R8.2 T10-a — tag_electronic null → incomplete con razón missing_rfid', () => {
  const out = validateForExport([validAnimal({ animalProfileId: 'ap-x', rfid: null })]);
  assert.equal(out.exportable.length, 0);
  assert.equal(out.incomplete.length, 1);
  assert.equal(out.incomplete[0].animalProfileId, 'ap-x');
  assert.ok(out.incomplete[0].reasons.includes('missing_rfid'));
});

test('R8.6 T10-b — RFID de 14 dígitos → incomplete con razón invalid_rfid', () => {
  const out = validateForExport([validAnimal({ rfid: '03201000000000' })]); // 14 dígitos
  assert.equal(out.exportable.length, 0);
  assert.deepEqual(out.incomplete[0].reasons, ['invalid_rfid']);
});

test('R8.6 T10-c — RFID de 15 dígitos numéricos pasa', () => {
  const out = validateForExport([validAnimal({ rfid: '032010000000000' })]);
  assert.equal(out.incomplete.length, 0);
  assert.equal(out.exportable.length, 1);
  assert.equal(out.exportable[0].rfid, '032010000000000');
});

test('R8.6 T10-d — RFID con letras → incomplete (invalid_rfid)', () => {
  const out = validateForExport([validAnimal({ rfid: '03201000000000X' })]);
  assert.equal(out.exportable.length, 0);
  assert.ok(out.incomplete[0].reasons.includes('invalid_rfid'));
});

test('R8.2 T10-e — birth_date null → incomplete con razón missing_birth_date', () => {
  const out = validateForExport([validAnimal({ birthDate: null })]);
  assert.equal(out.exportable.length, 0);
  assert.deepEqual(out.incomplete[0].reasons, ['missing_birth_date']);
});

test('R8.2 T10-f — breed_id null → incomplete con razón missing_breed', () => {
  const out = validateForExport([validAnimal({ breedId: null, breedCode: null })]);
  assert.equal(out.exportable.length, 0);
  assert.deepEqual(out.incomplete[0].reasons, ['missing_breed']);
});

test('R8.1 T10-g — animal que pasa las 3 validaciones queda en exportable (normalizado)', () => {
  const out = validateForExport([
    validAnimal({ rfid: '032010000000002', sex: 'female', birthDate: '2024-01-09', breedCode: 'H' }),
  ]);
  assert.equal(out.incomplete.length, 0);
  assert.equal(out.exportable.length, 1);
  assert.deepEqual(out.exportable[0], {
    rfid: '032010000000002',
    sex: 'H', // female → H
    breedCode: 'H',
    birthMonthYear: '01/2024', // ISO 2024-01-09 → MM/AAAA
  });
});

test('R5.2 — mapeo de sexo: male→M, female→H', () => {
  const macho = validateForExport([validAnimal({ sex: 'male' })]);
  assert.equal(macho.exportable[0].sex, 'M');
  const hembra = validateForExport([validAnimal({ sex: 'female' })]);
  assert.equal(hembra.exportable[0].sex, 'H');
});

test('R6.4 — birthDate ISO se formatea MM/AAAA con mes de 2 dígitos', () => {
  const out = validateForExport([validAnimal({ birthDate: '2025-03-01' })]);
  assert.equal(out.exportable[0].birthMonthYear, '03/2025');
});

test('R6.4 — acepta ISO completo con hora y NO corre el mes por timezone', () => {
  // Trabajamos sobre los componentes del string, sin construir Date → sin corrimiento de zona.
  const out = validateForExport([validAnimal({ birthDate: '2025-08-31T23:30:00.000Z' })]);
  assert.equal(out.exportable[0].birthMonthYear, '08/2025');
});

test('R8.3 — colecciona TODAS las razones aplicables por animal (no solo la primera)', () => {
  // Animal sin RFID, sin fecha y sin raza: 3 razones, no 1.
  const out = validateForExport([
    { animalProfileId: 'ap-roto', rfid: null, sex: 'male', birthDate: null, breedId: null, breedCode: null },
  ]);
  assert.equal(out.exportable.length, 0);
  assert.equal(out.incomplete.length, 1);
  assert.deepEqual(
    out.incomplete[0].reasons.slice().sort(),
    ['missing_birth_date', 'missing_breed', 'missing_rfid'].sort(),
  );
});

test('borde — birthDate con formato no-ISO (mes 1 dígito o basura) → missing_birth_date (fail-closed)', () => {
  // El DB normalmente entrega 'YYYY-MM-DD' (mes zero-padded). Si llega algo raro, NO lo
  // emitimos mal-formado: lo tratamos como fecha ausente para que el usuario lo corrija.
  const malFormato = validateForExport([validAnimal({ birthDate: '2025-8-15' })]); // mes 1 dígito
  assert.deepEqual(malFormato.incomplete[0].reasons, ['missing_birth_date']);
  const basura = validateForExport([validAnimal({ birthDate: 'no-es-fecha' })]);
  assert.deepEqual(basura.incomplete[0].reasons, ['missing_birth_date']);
  const mesInvalido = validateForExport([validAnimal({ birthDate: '2025-13-01' })]); // mes 13
  assert.deepEqual(mesInvalido.incomplete[0].reasons, ['missing_birth_date']);
});

test('R8.3 — RFID inválido + sin raza junta invalid_rfid Y missing_breed', () => {
  const out = validateForExport([
    validAnimal({ rfid: '123', breedId: null, breedCode: null }),
  ]);
  assert.deepEqual(out.incomplete[0].reasons.slice().sort(), ['invalid_rfid', 'missing_breed'].sort());
});

test('borde — breed_id presente pero senasa_code nulo (JOIN no resolvió) → missing_breed', () => {
  // Defensa: si breed_id no es null pero el JOIN no trajo el código, igual bloqueamos.
  const out = validateForExport([validAnimal({ breedId: 'b-1', breedCode: null })]);
  assert.deepEqual(out.incomplete[0].reasons, ['missing_breed']);
});

test('R8.1 — lote mixto: separa exportables de incompletos preservando el id', () => {
  const out = validateForExport([
    validAnimal({ animalProfileId: 'ok-1', rfid: '032010000000010' }),
    validAnimal({ animalProfileId: 'bad-1', rfid: null }),
    validAnimal({ animalProfileId: 'ok-2', rfid: '032010000000011', sex: 'female', breedCode: 'BG' }),
    validAnimal({ animalProfileId: 'bad-2', breedId: null, breedCode: null }),
  ]);
  assert.equal(out.exportable.length, 2);
  assert.equal(out.incomplete.length, 2);
  assert.deepEqual(
    out.incomplete.map((i) => i.animalProfileId).sort(),
    ['bad-1', 'bad-2'],
  );
  assert.deepEqual(
    out.exportable.map((e) => e.rfid).sort(),
    ['032010000000010', '032010000000011'],
  );
});

test('borde — array vacío → ambos conjuntos vacíos', () => {
  const out = validateForExport([]);
  assert.deepEqual(out.exportable, []);
  assert.deepEqual(out.incomplete, []);
});

test('robustez — input no-array → conjuntos vacíos (defensivo, never throws)', () => {
  // @ts-expect-error input no-array
  const out = validateForExport(null);
  assert.deepEqual(out.exportable, []);
  assert.deepEqual(out.incomplete, []);
});

test('robustez — fila null dentro del array no rompe el lote', () => {
  const out = validateForExport([
    // @ts-expect-error fila nula defensiva
    null,
    validAnimal({ animalProfileId: 'ok-1', rfid: '032010000000010' }),
  ]);
  assert.equal(out.exportable.length, 1);
  assert.equal(out.exportable[0].rfid, '032010000000010');
});
