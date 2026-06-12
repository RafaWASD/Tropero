// Tests de las opciones + validación de vía sanitaria (fix VIA-ENUM-MISMATCH, spec 10 UI-B2).
// node:test, puro. El invariante crítico: lo que viaja al INSERT es SIEMPRE un código del enum
// `public.sanitary_route` (0027) o null — NUNCA texto libre (que rompería el INSERT con 22P02).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SANITARY_ROUTES,
  routeOptions,
  isValidRoute,
  toRouteValue,
} from './sanitary-route.ts';

// El enum `public.sanitary_route` de la migración 0027 — pineado acá como oráculo independiente
// del módulo (si alguien edita SANITARY_ROUTES sin tocar el enum real, este test lo detecta).
const ENUM_0027 = ['intramuscular', 'subcutaneous', 'oral', 'topical', 'other'];

test('SANITARY_ROUTES = EXACTAMENTE el enum sanitary_route de 0027 (anti-drift, sin sobra ni falta)', () => {
  assert.deepEqual([...SANITARY_ROUTES].sort(), [...ENUM_0027].sort());
  // No hay códigos fuera del enum (p.ej. `intravenous` de humanizeRoute NO está en sanitary_route).
  for (const code of SANITARY_ROUTES) assert.ok(ENUM_0027.includes(code), `${code} no está en 0027`);
});

test('routeOptions: 5 opciones, cada una con código del enum + label es-AR no vacío', () => {
  const opts = routeOptions();
  assert.equal(opts.length, 5);
  for (const o of opts) {
    assert.ok(isValidRoute(o.code), `${o.code} debería ser válido`);
    assert.ok(o.label.length > 0, `${o.code} sin label`);
  }
  // Labels concretos (consistentes con humanizeRoute; `other` → "Otra").
  const byCode = Object.fromEntries(opts.map((o) => [o.code, o.label]));
  assert.equal(byCode.subcutaneous, 'Subcutánea');
  assert.equal(byCode.intramuscular, 'Intramuscular');
  assert.equal(byCode.oral, 'Oral');
  assert.equal(byCode.topical, 'Tópica');
  assert.equal(byCode.other, 'Otra');
});

test('routeOptions: sin códigos duplicados', () => {
  const codes = routeOptions().map((o) => o.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('isValidRoute: true para los 5 del enum', () => {
  for (const code of SANITARY_ROUTES) assert.equal(isValidRoute(code), true);
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
  // Texto libre / basura → null (la barrera dura contra el 22P02).
  assert.equal(toRouteValue('Subcutánea'), null);
  assert.equal(toRouteValue('cualquier cosa'), null);
  assert.equal(toRouteValue(''), null);
  assert.equal(toRouteValue(null), null);
  assert.equal(toRouteValue(undefined), null);
  assert.equal(toRouteValue('intravenous'), null);
});
