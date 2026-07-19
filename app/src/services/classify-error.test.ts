// Tests de la clasificación de errores (spec 01, delta TELÉFONO). node:test, sin SDK ni red.
//
// ⚠️ ESTE ARCHIVO ES LA PATA EJECUTABLE DE LA ACEPTACIÓN DEL RIESGO R-7 (HIGH-1 del Gate 1).
//    El riesgo aceptado es que el rechazo del CHECK deje PII en el log del SERVIDOR (el
//    `DETAIL: Failing row contains (...)` con email y teléfono en claro). La aceptación se apoya en dos
//    patas: (1) cliente y CHECK alineados en todos los bordes → el rechazo es prácticamente
//    inalcanzable (phone.test.ts + phone-vectors.json), y (2) esa PII tampoco viaja al CLIENTE por
//    `error.details` (esto). Si estos tests se borran o se aflojan, R-7 se re-evalúa.

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyError } from './classify-error.ts';
import { PHONE_FORMAT_REJECTED_COPY } from '../utils/phone.ts';

// PII SIMULADA — el shape real que devuelve PostgREST ante un CHECK violado sobre user_private.
const PII_EMAIL = 'facundo.privado@ejemplo-real.com';
const PII_PHONE = '+541123456789';
const CHECK_ERROR_WITH_PII = {
  code: '23514',
  message:
    'new row for relation "user_private" violates check constraint "user_private_phone_format_chk"',
  details: `Failing row contains (0f3a1c22-8f4e-4d0a-9f11-2c9a7b6d5e40, ${PII_EMAIL}, ${PII_PHONE}, 2026-07-18 12:00:00+00, 2026-07-18 12:00:00+00).`,
  hint: `Revisá el valor ${PII_PHONE} del usuario ${PII_EMAIL}.`,
};

test('RTEL.8.3: un 23514 sobre el CHECK de formato devuelve el copy accionable de teléfono', () => {
  const result = classifyError(CHECK_ERROR_WITH_PII);
  assert.equal(result.kind, 'phone_format');
  assert.equal(result.message, PHONE_FORMAT_REJECTED_COPY);
  // No se degrada a "error de red" (el usuario tiene conexión; el número está mal).
  assert.notEqual(result.kind, 'network');
});

test('RTEL.8.5 (R-7): la clasificación NO expone details, hint ni el mensaje crudo de Postgres', () => {
  const result = classifyError(CHECK_ERROR_WITH_PII);
  const exposed = JSON.stringify(result);

  // 1. Nada de la PII de la fila que falló.
  assert.ok(!exposed.includes(PII_EMAIL), 'el email no debe llegar a la UI');
  assert.ok(!exposed.includes(PII_PHONE), 'el teléfono no debe llegar a la UI');
  // 2. Nada del `Failing row contains (...)`, que es el vehículo del leak.
  assert.ok(!/Failing row/i.test(exposed), 'el DETAIL de Postgres no debe llegar a la UI');
  assert.ok(!exposed.includes(CHECK_ERROR_WITH_PII.details), 'details no se propaga');
  assert.ok(!exposed.includes(CHECK_ERROR_WITH_PII.hint), 'hint no se propaga');
  // 3. Tampoco el message crudo (la rama genérica devuelve `msg`; esta rama NO debe copiar ese patrón).
  assert.ok(!exposed.includes(CHECK_ERROR_WITH_PII.message), 'el message crudo no se propaga');
  assert.ok(!/violates check constraint/i.test(exposed), 'sin jerga de Postgres en la UI');
  // 4. El resultado tiene EXACTAMENTE las dos claves del contrato (nada se coló de arrastre).
  assert.deepEqual(Object.keys(result).sort(), ['kind', 'message']);
});

test('RTEL.8.6: la firma no consume details ni hint (el mismo error sin ellos clasifica igual)', () => {
  // Si alguien ampliara la firma para "dar mejor diagnóstico", este test seguiría verde pero el de
  // arriba se pondría rojo. Este fija la otra mitad: details/hint son IRRELEVANTES para el resultado.
  const withoutPii = {
    code: CHECK_ERROR_WITH_PII.code,
    message: CHECK_ERROR_WITH_PII.message,
  };
  assert.deepEqual(classifyError(withoutPii), classifyError(CHECK_ERROR_WITH_PII));
});

test('la rama genérica tampoco arrastra details ni hint', () => {
  const genericWithPii = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "algo_unique"',
    details: `Key (email)=(${PII_EMAIL}) already exists.`,
    hint: PII_PHONE,
  };
  const result = classifyError(genericWithPii);
  const exposed = JSON.stringify(result);
  assert.equal(result.kind, 'unknown');
  assert.ok(!exposed.includes(PII_EMAIL));
  assert.ok(!exposed.includes(PII_PHONE));
});

test('un 23514 de OTRO constraint no se disfraza de error de teléfono', () => {
  const other = {
    code: '23514',
    message: 'new row for relation "animals" violates check constraint "animals_tag_len_chk"',
  };
  const result = classifyError(other);
  assert.equal(result.kind, 'unknown');
  assert.notEqual(result.message, PHONE_FORMAT_REJECTED_COPY);
});

test('los errores de red siguen clasificando como network (sin regresión)', () => {
  assert.equal(classifyError({ message: 'Failed to fetch' }).kind, 'network');
  assert.equal(classifyError({ message: 'Network request failed' }).kind, 'network');
  assert.equal(classifyError({ message: 'TypeError: fetch failed' }).kind, 'network');
});

test('null / vacío → unknown con copy no vacío (sin regresión)', () => {
  assert.deepEqual(classifyError(null), { kind: 'unknown', message: 'Error desconocido' });
  assert.deepEqual(classifyError({}), { kind: 'unknown', message: 'Error desconocido' });
});
