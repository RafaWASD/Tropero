// Tests del parser puro del protocolo SPP del lector Allflex RS420 (spec 04, T1 / R8).
// node:test + type-stripping nativo de Node 24 (sin Jest; mismo patrón que utils/*).
//
// Líneas crudas reales capturadas en campo (sin el byte de control inicial, que va
// al principio de cada trama) — ver specs/active/04-bluetooth-baston/field-findings.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRs420Line, isValidTag, normalizeTag } from './parser-rs420.ts';

// ─── parseRs420Line: ejemplos reales capturados ─────────────────────────────────

test('R8: parsea las dos capturas reales al EID correcto (982 fabricante / 032 país)', () => {
  // 1000000 (header) + 982000364696050 (EID) + 260530101701 (ts).
  assert.deepEqual(parseRs420Line('1000000982000364696050260530101701'), {
    eid: '982000364696050',
  });
  // 1000000 (header) + 032010006382438 (EID) + 260530102708 (ts).
  assert.deepEqual(parseRs420Line('1000000032010006382438260530102708'), {
    eid: '032010006382438',
  });
});

test('R8: tolera el byte de control inicial (STX 0x02) y los terminadores \\r\\n', () => {
  // Trama tal cual sale del SPP: STX + header + EID + ts + CRLF.
  assert.deepEqual(parseRs420Line('\x021000000982000364696050260530101701\r\n'), {
    eid: '982000364696050',
  });
  // Solo \r (sin \n) y con espacios de borde.
  assert.deepEqual(parseRs420Line('  \x021000000032010006382438260530102708\r  '), {
    eid: '032010006382438',
  });
  // Sin byte de control, solo \n (otra variante de terminador).
  assert.deepEqual(parseRs420Line('1000000982000364696050260530102714\n'), {
    eid: '982000364696050',
  });
});

test('R8: las 9 lecturas repetidas del mismo tag (ts incrementando) → mismo EID', () => {
  // Bastoneadas del MISMO animal: el ts del lector incrementa, el EID no cambia.
  const lines = [
    '\x021000000982000364696050260530101701',
    '\x021000000982000364696050260530101703',
    '\x021000000982000364696050260530101717',
    '\x021000000982000364696050260530101719',
    '\x021000000982000364696050260530101721',
    '\x021000000982000364696050260530101722',
    '\x021000000982000364696050260530101724',
    '\x021000000982000364696050260530101729',
    '\x021000000982000364696050260530101731',
  ];
  const eids = lines.map((l) => parseRs420Line(l)?.eid);
  // Todas parsean (ninguna null) y todas al mismo EID.
  assert.equal(eids.length, 9);
  for (const eid of eids) assert.equal(eid, '982000364696050');
  assert.equal(new Set(eids).size, 1);
});

// ─── parseRs420Line: malformados → null (nunca tira excepción) ───────────────────

test('R8: string vacío o solo whitespace/control → null', () => {
  assert.equal(parseRs420Line(''), null);
  assert.equal(parseRs420Line('   '), null);
  assert.equal(parseRs420Line('\x02\r\n'), null);
});

test('R8: basura sin estructura → null', () => {
  assert.equal(parseRs420Line('hola mundo'), null);
  assert.equal(parseRs420Line('not-a-tag-at-all'), null);
});

test('R8: cabecera incorrecta → null (no es el lector RS420)', () => {
  // Header 1000001 en vez de 1000000.
  assert.equal(parseRs420Line('1000001982000364696050260530101701'), null);
  // Sin cabecera fija: arranca directo con el EID.
  assert.equal(parseRs420Line('982000364696050260530101701'), null);
});

test('R8: EID de 14 o 16 dígitos → null (debe ser exactamente 15)', () => {
  // 14 dígitos de EID (uno de menos) → el match anclado falla.
  assert.equal(parseRs420Line('100000098200036469605260530101701'), null);
  // 16 dígitos de EID (uno de más).
  assert.equal(parseRs420Line('10000009820003646960500260530101701'), null);
});

test('R8: caracteres no numéricos dentro de la trama → null', () => {
  // Una letra en el medio del EID.
  assert.equal(parseRs420Line('1000000982000X64696050260530101701'), null);
  // Timestamp con basura.
  assert.equal(parseRs420Line('1000000982000364696050ABCDEF101701'), null);
});

test('R8: trama incompleta (sin timestamp) → null', () => {
  // Header + EID válido pero sin los 12 dígitos de timestamp.
  assert.equal(parseRs420Line('1000000982000364696050'), null);
});

test('R8: no string → null (defensivo, nunca tira)', () => {
  // @ts-expect-error: contrato robusto ante input no-string en runtime.
  assert.equal(parseRs420Line(null), null);
  // @ts-expect-error
  assert.equal(parseRs420Line(undefined), null);
  // @ts-expect-error
  assert.equal(parseRs420Line(12345), null);
});

// ─── isValidTag (R8) ─────────────────────────────────────────────────────────────

test('R8: acepta EID de fabricante (982) y de país (032), ambos 15 dígitos', () => {
  assert.equal(isValidTag('982000364696050'), true); // 982 = fabricante (>=900)
  assert.equal(isValidTag('032010006382438'), true); // 032 = Argentina (país)
});

test('R8: rechaza longitudes erróneas', () => {
  assert.equal(isValidTag(''), false);
  assert.equal(isValidTag('98200036469605'), false); // 14 dígitos
  assert.equal(isValidTag('9820003646960500'), false); // 16 dígitos
});

test('R8: rechaza no-numéricos', () => {
  assert.equal(isValidTag('98200036469605X'), false); // 15 chars pero con letra
  assert.equal(isValidTag('982 000364696050'), false); // espacio (display, no EID crudo)
  assert.equal(isValidTag('982-00036469605'), false); // guión
});

// ─── normalizeTag (helper puro) ──────────────────────────────────────────────────

test('normalizeTag: recorta byte de control inicial, \\r\\n y whitespace de borde', () => {
  assert.equal(normalizeTag('\x02 hola \r\n'), 'hola');
  assert.equal(normalizeTag('   1000000982000364696050260530101701   '), '1000000982000364696050260530101701');
});

test('normalizeTag: no toca caracteres internos (un interior malformado lo decide el parser)', () => {
  assert.equal(normalizeTag('982 000364696050'), '982 000364696050'); // espacio interno preservado
});
