// Tests de las opciones + validación de vía sanitaria (fix VIA-ENUM-MISMATCH, spec 10 UI-B2 + delta
// intranasal). node:test, puro. Invariantes: (1) lo que viaja al INSERT es SIEMPRE un código del enum
// `public.sanitary_route` (0027 + 0090) o null — NUNCA texto libre (rompería el INSERT con 22P02);
// (2) el selector de VACUNACIÓN ofrece SOLO 3 vías curadas (SC/IM/Intranasal), subconjunto del enum.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SANITARY_ROUTES,
  routeOptions,
  vaccineRouteOptions,
  VACCINE_ROUTES,
  isValidRoute,
  toRouteValue,
} from './sanitary-route.ts';

// El enum `public.sanitary_route` REAL = migración 0027 + delta 0090 (`intranasal`) — pineado acá como
// oráculo independiente del módulo (si alguien edita SANITARY_ROUTES sin tocar el enum real, este test
// lo detecta). 6 valores.
const ENUM_SANITARY_ROUTE = [
  'intramuscular',
  'subcutaneous',
  'oral',
  'topical',
  'other',
  'intranasal', // 0090
];

test('SANITARY_ROUTES = EXACTAMENTE el enum sanitary_route (0027 + 0090) (anti-drift, sin sobra ni falta)', () => {
  assert.deepEqual([...SANITARY_ROUTES].sort(), [...ENUM_SANITARY_ROUTE].sort());
  // No hay códigos fuera del enum (p.ej. `intravenous` de humanizeRoute NO está en sanitary_route).
  for (const code of SANITARY_ROUTES) {
    assert.ok(ENUM_SANITARY_ROUTE.includes(code), `${code} no está en el enum`);
  }
});

test('routeOptions: 6 opciones, cada una con código del enum + label es-AR no vacío', () => {
  const opts = routeOptions();
  assert.equal(opts.length, 6);
  for (const o of opts) {
    assert.ok(isValidRoute(o.code), `${o.code} debería ser válido`);
    assert.ok(o.label.length > 0, `${o.code} sin label`);
  }
  // Labels concretos (consistentes con humanizeRoute; `other` → "Otra").
  const byCode = Object.fromEntries(opts.map((o) => [o.code, o.label]));
  assert.equal(byCode.subcutaneous, 'Subcutánea');
  assert.equal(byCode.intramuscular, 'Intramuscular');
  assert.equal(byCode.intranasal, 'Intranasal');
  assert.equal(byCode.oral, 'Oral');
  assert.equal(byCode.topical, 'Tópica');
  assert.equal(byCode.other, 'Otra');
});

test('routeOptions: sin códigos duplicados', () => {
  const codes = routeOptions().map((o) => o.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('vaccineRouteOptions: EXACTAMENTE las 3 vías curadas de vacuna (SC/IM/Intranasal), labels correctos', () => {
  const opts = vaccineRouteOptions();
  // Exactamente 3, en el orden de display curado.
  assert.equal(opts.length, 3);
  assert.deepEqual(opts.map((o) => o.code), ['subcutaneous', 'intramuscular', 'intranasal']);
  assert.deepEqual(VACCINE_ROUTES, ['subcutaneous', 'intramuscular', 'intranasal']);
  // Labels es-AR.
  const byCode = Object.fromEntries(opts.map((o) => [o.code, o.label]));
  assert.equal(byCode.subcutaneous, 'Subcutánea');
  assert.equal(byCode.intramuscular, 'Intramuscular');
  assert.equal(byCode.intranasal, 'Intranasal');
  // NO incluye las vías que no son de vacuna (siguen en el enum, pero NO en el selector de vacunación).
  const codes = opts.map((o) => o.code);
  for (const excluded of ['topical', 'oral', 'other']) {
    assert.ok(!codes.includes(excluded), `${excluded} NO debe estar en el selector de vacunación`);
  }
  // Sin duplicados; todas válidas como valor de DB.
  assert.equal(new Set(codes).size, codes.length);
  for (const o of opts) assert.equal(isValidRoute(o.code), true);
});

test('vaccineRouteOptions ⊂ routeOptions: toda vía de vacuna es una vía válida del enum', () => {
  const allCodes = new Set(routeOptions().map((o) => o.code));
  for (const o of vaccineRouteOptions()) {
    assert.ok(allCodes.has(o.code), `${o.code} (vacuna) debe ser un código del enum completo`);
  }
});

test('isValidRoute: true para los 6 del enum (incl. intranasal Y topical/oral, que NO son de vacuna pero SÍ del enum)', () => {
  for (const code of SANITARY_ROUTES) assert.equal(isValidRoute(code), true);
  // Explícito: intranasal (0090) es válido; topical/oral siguen siendo válidos (son del enum,
  // aunque no los ofrezca el selector de vacunación).
  assert.equal(isValidRoute('intranasal'), true);
  assert.equal(isValidRoute('topical'), true);
  assert.equal(isValidRoute('oral'), true);
});

test('isValidRoute: false para texto libre / valores fuera del enum / no-strings', () => {
  // Lo que el operario tipeaba antes (texto libre es-AR) → NO es del enum.
  assert.equal(isValidRoute('Subcutánea'), false);
  assert.equal(isValidRoute('subcutánea'), false); // con tilde, no es el código
  assert.equal(isValidRoute('intravenous'), false); // existe en humanizeRoute pero NO en sanitary_route
  assert.equal(isValidRoute('SUBCUTANEOUS'), false); // case-sensitive: el enum es lowercase
  assert.equal(isValidRoute(''), false);
  assert.equal(isValidRoute(null), false);
  assert.equal(isValidRoute(undefined), false);
  assert.equal(isValidRoute(42), false);
  assert.equal(isValidRoute({}), false);
});

test('toRouteValue: el INVARIANTE — código válido pasa, todo lo demás → null (nunca texto crudo)', () => {
  // Códigos válidos pasan tal cual.
  for (const code of SANITARY_ROUTES) assert.equal(toRouteValue(code), code);
  // Explícito: intranasal (0090) pasa; topical/oral SIGUEN pasando (son del enum — la barrera opera
  // sobre el enum completo, NO sobre el subconjunto curado de vacuna).
  assert.equal(toRouteValue('intranasal'), 'intranasal');
  assert.equal(toRouteValue('topical'), 'topical');
  assert.equal(toRouteValue('oral'), 'oral');
  // Texto libre / basura → null (la barrera dura contra el 22P02).
  assert.equal(toRouteValue('Subcutánea'), null);
  assert.equal(toRouteValue('cualquier cosa'), null);
  assert.equal(toRouteValue(''), null);
  assert.equal(toRouteValue(null), null);
  assert.equal(toRouteValue(undefined), null);
  assert.equal(toRouteValue('intravenous'), null);
});
