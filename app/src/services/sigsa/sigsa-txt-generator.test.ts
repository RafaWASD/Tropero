// Tests del generador PURO del TXT SIGSA (spec 08, T9 / R5.1, R5.2, R5.5, R5.6, R6.1-R6.5, R8.6).
// node:test + type-stripping nativo (sin Jest); mismo patrón que parse-sigsa-txt.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateSigsaTxt } from './sigsa-txt-generator.ts';
import { validateForExport } from './sigsa-validator.ts';
import type { AnimalExportRecord, PendingAnimalInfo } from './types.ts';
// Round-trip (gotcha 2): el generador es el INVERSO del parser del importador.
import { parseSigsaTxt } from '../../utils/import/parse-sigsa-txt.ts';

test('R5.1/R6.1 T9-a — un animal genera {RFID}-{SEXO}-{RAZA}-{MM/AAAA}', () => {
  const rec: AnimalExportRecord = {
    rfid: '032010000000000',
    sex: 'M',
    breedCode: 'H',
    birthMonthYear: '08/2025',
  };
  assert.equal(generateSigsaTxt([rec]), '032010000000000-M-H-08/2025');
});

test('R6.2 T9-b — dos animales se separan con `;` sin trailing por default', () => {
  const recs: AnimalExportRecord[] = [
    { rfid: '032010000000000', sex: 'M', breedCode: 'H', birthMonthYear: '08/2025' },
    { rfid: '032010000000001', sex: 'H', breedCode: 'AA', birthMonthYear: '08/2025' },
  ];
  const out = generateSigsaTxt(recs);
  assert.equal(out, '032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025');
  assert.equal(out.endsWith(';'), false, 'sin trailing semicolon por default (R6.3)');
});

test('R6.3 T9-c — con trailingSemicolon: true el string termina en `;`', () => {
  const recs: AnimalExportRecord[] = [
    { rfid: '032010000000000', sex: 'M', breedCode: 'H', birthMonthYear: '08/2025' },
    { rfid: '032010000000001', sex: 'H', breedCode: 'AA', birthMonthYear: '08/2025' },
  ];
  const out = generateSigsaTxt(recs, { trailingSemicolon: true });
  assert.equal(out, '032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;');
  assert.equal(out.endsWith(';'), true);
});

test('R6.4 T9-d — mes `01` se respeta como 2 dígitos (no `1`)', () => {
  const rec: AnimalExportRecord = {
    rfid: '032010000000000',
    sex: 'M',
    breedCode: 'B',
    birthMonthYear: '01/2024',
  };
  const out = generateSigsaTxt([rec]);
  assert.equal(out, '032010000000000-M-B-01/2024');
  assert.ok(out.includes('-01/2024'), 'mes con cero a la izquierda');
  // Y rechaza un mes de 1 dígito (no normaliza silenciosamente: el validador ya emite MM/AAAA).
  assert.throws(
    () => generateSigsaTxt([{ ...rec, birthMonthYear: '1/2024' }]),
    /fecha MM\/AAAA inválida/,
    'mes de 1 dígito → lanza (R6.4)',
  );
});

test('R8.6 T9-e — lanza si el RFID no tiene 15 dígitos numéricos', () => {
  const base: AnimalExportRecord = {
    rfid: '032010000000000',
    sex: 'M',
    breedCode: 'H',
    birthMonthYear: '08/2025',
  };
  // 14 dígitos
  assert.throws(() => generateSigsaTxt([{ ...base, rfid: '03201000000000' }]), /RFID inválido/);
  // 16 dígitos
  assert.throws(() => generateSigsaTxt([{ ...base, rfid: '0320100000000001' }]), /RFID inválido/);
  // con letras
  assert.throws(() => generateSigsaTxt([{ ...base, rfid: '03201000000000X' }]), /RFID inválido/);
  // vacío
  assert.throws(() => generateSigsaTxt([{ ...base, rfid: '' }]), /RFID inválido/);
});

test('R6.5 T9-f — lanza si breedCode está vacío', () => {
  const rec: AnimalExportRecord = {
    rfid: '032010000000000',
    sex: 'M',
    breedCode: '',
    birthMonthYear: '08/2025',
  };
  assert.throws(() => generateSigsaTxt([rec]), /código de raza vacío/);
});

test('R6.5 — lanza si el código de raza NO está en el catálogo SENASA oficial (no inventa códigos)', () => {
  const rec: AnimalExportRecord = {
    rfid: '032010000000000',
    sex: 'M',
    breedCode: 'ZZ', // no existe en la Tabla 1
    birthMonthYear: '08/2025',
  };
  assert.throws(() => generateSigsaTxt([rec]), /código de raza desconocido/);
});

test('R6.5 — acepta TODOS los códigos del catálogo oficial (incl. S/E con barra)', () => {
  // Muestra representativa de la Tabla 1, incluyendo el caso con barra 'S/E'.
  const codes = ['AA', 'H', 'PH', 'BG', 'BF', 'SI', 'GC', 'OR', 'S/E'];
  for (const code of codes) {
    const out = generateSigsaTxt([
      { rfid: '032010000000000', sex: 'M', breedCode: code, birthMonthYear: '08/2025' },
    ]);
    assert.equal(out, `032010000000000-M-${code}-08/2025`, `código ${code} válido`);
  }
});

test('R5.6 T9-g — output es UTF-8 sin BOM (no hay U+FEFF al inicio)', () => {
  const out = generateSigsaTxt([
    { rfid: '032010000000000', sex: 'M', breedCode: 'H', birthMonthYear: '08/2025' },
  ]);
  assert.equal(out.charCodeAt(0), '0'.charCodeAt(0), 'empieza con el dígito del RFID, no con BOM');
  assert.equal(out.includes('﻿'), false, 'sin BOM en ningún lado');
});

test('borde — lista vacía → string vacío (sin `;` aunque trailingSemicolon sea true)', () => {
  assert.equal(generateSigsaTxt([]), '');
  assert.equal(generateSigsaTxt([], { trailingSemicolon: true }), '');
});

test('R5.5 — el registro tiene EXACTAMENTE 4 campos (no se cuela RENSPA/especie/etc.)', () => {
  const out = generateSigsaTxt([
    { rfid: '032010000000000', sex: 'H', breedCode: 'AA', birthMonthYear: '12/2025' },
  ]);
  assert.equal(out.split('-').length, 4, '4 campos separados por guion del medio');
});

test('gotcha 2 — round-trip contra parse-sigsa-txt: parse → map → generate reproduce el ejemplo del manual', () => {
  // Ejemplo LITERAL del manual SENASA (razas-senasa-codigos.md §formato).
  const ejemploManual =
    '032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025';

  // 1. Parsear con el parser inverso del importador.
  const parsed = parseSigsaTxt(ejemploManual);
  assert.equal(parsed.records.length, 3);
  assert.equal(parsed.recordsExceeded, false);
  for (const r of parsed.records) {
    assert.equal(r.error, undefined, 'el ejemplo del manual parsea sin errores');
  }

  // 2. Mapear los SigsaRecord crudos a AnimalExportRecord (sexRaw ya es 'M'/'H'; breedCode ya es código).
  const records: AnimalExportRecord[] = parsed.records.map((r) => {
    assert.ok(r.sexRaw === 'M' || r.sexRaw === 'H', `sexo válido: ${r.sexRaw}`);
    return {
      rfid: r.rfid,
      sex: r.sexRaw as 'M' | 'H',
      breedCode: r.breedCode,
      birthMonthYear: r.birthRaw,
    };
  });

  // 3. Generar y verificar que reproduce EXACTAMENTE el string original (trailingSemicolon: false).
  const regenerated = generateSigsaTxt(records, { trailingSemicolon: false });
  assert.equal(regenerated, ejemploManual, 'round-trip reproduce el ejemplo literal del manual');
});

test('integración validador→generador — la salida limpia del validador genera el TXT sin lanzar', () => {
  // El contrato real: validateForExport produce AnimalExportRecord[] que el generador consume.
  // Este test verifica que el mapeo (sex male→M/female→H, ISO→MM/AAAA) encaja con el formato esperado.
  const raw: PendingAnimalInfo[] = [
    { animalProfileId: 'a', rfid: '032010000000000', sex: 'male', birthDate: '2025-08-15', breedId: 'b', breedCode: 'H' },
    { animalProfileId: 'b', rfid: '032010000000001', sex: 'female', birthDate: '2025-08-01', breedId: 'b', breedCode: 'AA' },
  ];
  const { exportable, incomplete } = validateForExport(raw);
  assert.equal(incomplete.length, 0);
  const txt = generateSigsaTxt(exportable);
  assert.equal(txt, '032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025');
});

test('robustez — input no-array lanza TypeError (defensivo)', () => {
  // @ts-expect-error input no-array
  assert.throws(() => generateSigsaTxt(null), TypeError);
  // @ts-expect-error input no-array
  assert.throws(() => generateSigsaTxt(undefined), TypeError);
});
