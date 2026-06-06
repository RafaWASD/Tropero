// Tests de la normalización por fila (spec 12, T1.10 / R3.4, R4.3, R4.4, R4.5).
// node:test + type-stripping nativo (sin Jest). Reusa el parser real parser-rs420.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSex,
  parseBirthDate,
  normalizeTagValue,
  normalizeRow,
  FIELD_CAPS,
} from './normalize-row.ts';

// ─── R4.3 sexo tolerante ───
test('R4.3 sexo tolerante → male/female', () => {
  assert.equal(normalizeSex('M'), 'male');
  assert.equal(normalizeSex('macho'), 'male');
  assert.equal(normalizeSex('Macho'), 'male');
  assert.equal(normalizeSex('toro'), 'male');
  assert.equal(normalizeSex('H'), 'female');
  assert.equal(normalizeSex('hembra'), 'female');
  assert.equal(normalizeSex('VACA'), 'female');
  assert.equal(normalizeSex('vaquillona'), 'female');
});

test('R4.3/R5.2 sexo basura / vacío → null (la fila se marcará error)', () => {
  assert.equal(normalizeSex('xyz'), null);
  assert.equal(normalizeSex(''), null);
  assert.equal(normalizeSex('   '), null);
  assert.equal(normalizeSex(undefined), null);
});

// ─── R4.4 fecha tolerante ───
test('R4.4 fecha DD/MM/AAAA → YYYY-MM-DD', () => {
  assert.equal(parseBirthDate('05/03/2024'), '2024-03-05');
  assert.equal(parseBirthDate('5/3/2024'), '2024-03-05', 'sin ceros a la izquierda');
  assert.equal(parseBirthDate('05-03-2024'), '2024-03-05', 'separador guion');
  assert.equal(parseBirthDate('05.03.2024'), '2024-03-05', 'separador punto');
});

test('R4.4 fecha MM/AAAA → primer día del mes', () => {
  assert.equal(parseBirthDate('08/2025'), '2025-08-01');
  assert.equal(parseBirthDate('8/2025'), '2025-08-01');
});

test('R4.4 fecha AAAA → primer día del año', () => {
  assert.equal(parseBirthDate('2024'), '2024-01-01');
});

test('R4.4 ISO YYYY-MM-DD se acepta tal cual', () => {
  assert.equal(parseBirthDate('2024-03-05'), '2024-03-05');
});

test('R4.4 fecha inválida → NULL sin romper (no bloquea la fila)', () => {
  assert.equal(parseBirthDate('13/13/2024'), null, 'mes 13 → null');
  assert.equal(parseBirthDate('31/02/2024'), null, '31 de febrero no existe → null');
  assert.equal(parseBirthDate('32/01/2024'), null, 'día 32 → null');
  assert.equal(parseBirthDate('00/2025'), null, 'mes 0 → null');
  assert.equal(parseBirthDate('texto'), null);
  assert.equal(parseBirthDate(''), null);
  assert.equal(parseBirthDate(undefined), null);
});

// ─── R4.5 TAG vía parser real ───
test('R4.5 TAG válido de 15 dígitos → se acepta', () => {
  assert.equal(normalizeTagValue('982000123456789'), '982000123456789');
  assert.equal(normalizeTagValue('032010000000000'), '032010000000000', 'prefijo país AR');
  // normalizeTag descarta ruido de framing (control bytes / espacios).
  assert.equal(normalizeTagValue('  982000123456789  '), '982000123456789', 'trim de bordes');
});

test('R4.5 TAG inválido → se descarta (null)', () => {
  assert.equal(normalizeTagValue('98200012345678'), null, '14 dígitos → inválido');
  assert.equal(normalizeTagValue('9820001234567890'), null, '16 dígitos → inválido');
  assert.equal(normalizeTagValue('98200012345678X'), null, 'no-numérico → inválido');
  assert.equal(normalizeTagValue(''), null);
  assert.equal(normalizeTagValue(undefined), null);
});

// ─── R3.4 topes de largo ───
test('R3.4 campo > tope → marca issue y devuelve null (no se escribe)', () => {
  const longIdv = 'a'.repeat(FIELD_CAPS.idv + 1); // 65
  const row = normalizeRow({ idv: longIdv, sex: 'M' });
  assert.equal(row.idv, null, 'el idv sobre-tope NO se escribe');
  assert.ok(
    row.issues.some((i) => i.field === 'idv'),
    'la fila lleva una issue de idv sobre-tope',
  );
});

test('R3.4 campo exactamente en el tope → pasa', () => {
  const exactIdv = 'a'.repeat(FIELD_CAPS.idv); // 64
  const row = normalizeRow({ idv: exactIdv, sex: 'H' });
  assert.equal(row.idv, exactIdv);
  assert.equal(row.issues.length, 0);
});

test('R3.4 breed > 64 / entry_origin no aplica acá / notes no aplica acá', () => {
  const row = normalizeRow({ breed: 'b'.repeat(FIELD_CAPS.breed + 5), sex: 'M' });
  assert.equal(row.breed, null);
  assert.ok(row.issues.some((i) => i.field === 'breed'));
});

// ─── normalizeRow integración ───
test('normalizeRow: fila completa válida normaliza todo', () => {
  const row = normalizeRow({
    tag_electronic: '982000123456789',
    idv: '0241',
    visual_id_alt: 'R-14',
    sex: 'macho',
    birth_date: '05/03/2024',
    breed: 'Angus',
    category: 'Vaquillona',
    lote: 'Lote 5',
  });
  assert.deepEqual(
    {
      tag: row.tagElectronic,
      idv: row.idv,
      visual: row.visualIdAlt,
      sex: row.sex,
      birth: row.birthDate,
      breed: row.breed,
      cat: row.category,
      lote: row.lote,
    },
    {
      tag: '982000123456789',
      idv: '0241',
      visual: 'R-14',
      sex: 'male',
      birth: '2024-03-05',
      breed: 'Angus',
      cat: 'Vaquillona',
      lote: 'Lote 5',
    },
  );
  assert.equal(row.issues.length, 0);
});

test('normalizeRow: TAG inválido presente → issue + tag null, pero la fila no se descarta acá', () => {
  const row = normalizeRow({ tag_electronic: '123', idv: '0241', sex: 'M' });
  assert.equal(row.tagElectronic, null);
  assert.equal(row.idv, '0241', 'la fila puede resolver por idv');
  assert.ok(row.issues.some((i) => i.field === 'tag_electronic'));
});

test('normalizeRow: sexo no reconocido presente → issue de sexo', () => {
  const row = normalizeRow({ idv: '0241', sex: 'macha' });
  assert.equal(row.sex, null);
  assert.ok(row.issues.some((i) => i.field === 'sex'));
});

test('normalizeRow: campos ausentes → null sin issues espurias', () => {
  const row = normalizeRow({ sex: 'H' });
  assert.equal(row.tagElectronic, null);
  assert.equal(row.idv, null);
  assert.equal(row.birthDate, null);
  assert.equal(row.issues.length, 0, 'ausencia no genera issue (solo presencia inválida)');
});
