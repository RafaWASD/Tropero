// Tests del parser SIGSA TXT puro del importador (spec 12, T1.4 / R6.2, R10.1, R3.6).
// node:test + type-stripping nativo (sin Jest).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSigsaTxt, MAX_SIGSA_RECORDS } from './parse-sigsa-txt.ts';

test('R6.2/R10.1 TXT válido del ejemplo del manual → filas con RFID/sexo/raza/fecha', () => {
  // Ejemplo literal del manual SENASA (research-findings §2 / razas-senasa-codigos.md).
  const txt =
    '032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025';
  const out = parseSigsaTxt(txt);
  assert.equal(out.records.length, 3);
  assert.equal(out.recordsExceeded, false);

  assert.deepEqual(
    { rfid: out.records[0].rfid, sex: out.records[0].sexRaw, breed: out.records[0].breedCode, birth: out.records[0].birthRaw },
    { rfid: '032010000000000', sex: 'M', breed: 'H', birth: '08/2025' },
  );
  assert.equal(out.records[0].error, undefined);

  // El 2do animal es Hembra (H en pos SEXO) + Aberdeen Angus (AA en pos RAZA).
  assert.equal(out.records[1].sexRaw, 'H');
  assert.equal(out.records[1].breedCode, 'AA');
});

test('R6.2 POSICIÓN no contenido: `H` en SEXO = Hembra; `H` en RAZA = Hereford (no se confunde)', () => {
  // Macho Hereford: H aparece SOLO en la posición RAZA → breedCode='H', sexRaw='M'.
  const machoHereford = parseSigsaTxt('032010000000003-M-H-01/2024').records[0];
  assert.equal(machoHereford.sexRaw, 'M');
  assert.equal(machoHereford.breedCode, 'H');

  // Hembra Hereford: H aparece en AMBAS posiciones → se lee por orden, no por contenido.
  const hembraHereford = parseSigsaTxt('032010000000004-H-H-01/2024').records[0];
  assert.equal(hembraHereford.sexRaw, 'H', 'pos 2 = sexo → Hembra');
  assert.equal(hembraHereford.breedCode, 'H', 'pos 3 = raza → Hereford');
});

test('R3.6 registro malformado → fila con error, NO rompe el resto', () => {
  // 2do registro incompleto (le falta la fecha); el 1ro y el 3ro deben parsear bien.
  const txt = '032010000000000-M-AA-08/2025;032010000000001-H-B;032010000000002-M-H-09/2025';
  const out = parseSigsaTxt(txt);
  assert.equal(out.records.length, 3, 'no descarta filas: cada chunk genera un registro');
  assert.equal(out.records[0].error, undefined);
  assert.ok(out.records[1].error, 'el incompleto lleva error');
  assert.equal(out.records[2].error, undefined, 'el 3ro sigue sano');
});

test('R3.6 RFID no-15-dígitos → error de fila (sin romper)', () => {
  const out = parseSigsaTxt('123-M-AA-08/2025;032010000000001-H-AA-08/2025');
  assert.ok(out.records[0].error, 'RFID corto → error');
  assert.equal(out.records[0].rfid, '123', 'preserva el valor crudo para el reporte');
  assert.equal(out.records[1].error, undefined);
});

test('R3.6 registro con campos de MÁS (5+ guiones) → error (no fusiona por contenido)', () => {
  const out = parseSigsaTxt('032010000000000-M-AA-08/2025-extra');
  assert.ok(out.records[0].error);
});

test('borde: `;` final y saltos de línea entre dispositivos no generan registros vacíos', () => {
  const txt = '032010000000000-M-AA-08/2025;\n032010000000001-H-B-08/2025;\n';
  const out = parseSigsaTxt(txt);
  assert.equal(out.records.length, 2);
  assert.equal(out.records[0].rfid, '032010000000000');
  assert.equal(out.records[1].rfid, '032010000000001');
});

test('R3.2/R3.3 más de MAX_SIGSA_RECORDS dispositivos → corta y señala excedido', () => {
  const devices: string[] = [];
  for (let i = 0; i < MAX_SIGSA_RECORDS + 10; i++) {
    devices.push(`0320100000${String(i).padStart(5, '0')}-M-AA-08/2025`);
  }
  const out = parseSigsaTxt(devices.join(';'));
  assert.equal(out.recordsExceeded, true);
  assert.equal(out.records.length, MAX_SIGSA_RECORDS, 'no materializa más del tope');
});

test('R3.3 cap aplicado DURANTE el scan (sin newline ni `;` final en el excedente)', () => {
  // El registro excedente es el último y el archivo no termina en separador → cae al flush
  // final. Igual debe marcar excedido y no materializarlo (consistente con parse-csv).
  const devices: string[] = [];
  for (let i = 0; i < MAX_SIGSA_RECORDS + 1; i++) {
    devices.push(`0320100000${String(i).padStart(5, '0')}-M-AA-08/2025`);
  }
  const out = parseSigsaTxt(devices.join(';')); // sin `;` final
  assert.equal(out.recordsExceeded, true);
  assert.equal(out.records.length, MAX_SIGSA_RECORDS);
});

test('borde: breed o fecha vacíos pero 4 campos → registro VÁLIDO (raza/fecha opcionales)', () => {
  // 4 campos presentes con breed vacío y con fecha vacía: NO es error estructural
  // (breed opcional R6.3; fecha nullable R4.4 — se valida downstream).
  const out = parseSigsaTxt('032010000000000-M--;032010000000001-H-AA-');
  assert.equal(out.records[0].error, undefined, 'breed vacío no es error');
  assert.equal(out.records[0].breedCode, '');
  assert.equal(out.records[1].error, undefined, 'fecha vacía no es error');
  assert.equal(out.records[1].birthRaw, '');
});

test('borde: vacío / solo espacios → sin registros', () => {
  assert.deepEqual(parseSigsaTxt('').records, []);
  assert.deepEqual(parseSigsaTxt('   \n  ').records, []);
});

test('borde: input no-string → resultado vacío (defensivo, never throws)', () => {
  // @ts-expect-error robustez ante input no-string
  const out = parseSigsaTxt(undefined);
  assert.deepEqual(out.records, []);
});
