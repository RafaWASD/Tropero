// Tests del CHECKLIST de vacunación por animal (spec 03 R6.1, delta-fix D2).
// PURO: sin SDK/RN/supabase → corre siempre con node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildVaccineChecklist, appliedVaccineNames } from './vaccine-checklist.ts';

// ─── buildVaccineChecklist: universo = vacunas definidas; default TODAS aplican ─────────────────

test('D2: primer paso (sin `applied`) → todas las definidas TILDADAS (APLICA por default)', () => {
  const items = buildVaccineChecklist(['Aftosa', 'Mancha', 'Brucelosis']);
  assert.deepEqual(
    items,
    [
      { name: 'Aftosa', applies: true },
      { name: 'Mancha', applies: true },
      { name: 'Brucelosis', applies: true },
    ],
  );
});

test('D2: sin vacunas definidas → checklist vacío (universo vacío)', () => {
  assert.deepEqual(buildVaccineChecklist([]), []);
  assert.deepEqual(buildVaccineChecklist([], undefined), []);
});

test('D2: universo dedup case-insensitive preservando orden + casing del primer visto', () => {
  const items = buildVaccineChecklist(['Aftosa', 'aftosa', 'Mancha', 'AFTOSA']);
  assert.deepEqual(items.map((i) => i.name), ['Aftosa', 'Mancha']);
  // Recorta vacías/espacios.
  assert.deepEqual(buildVaccineChecklist(['  ', 'Aftosa', '']).map((i) => i.name), ['Aftosa']);
});

// ─── Corrección (con `applied`): respeta el (des)tildado previo ─────────────────────────────────

test('D2 corrección: con `applied` → solo las aplicadas quedan tildadas (el resto NO APLICA)', () => {
  // Definidas 3, aplicadas 2 → la tercera queda destildada (el operario la marcó NO APLICA).
  const items = buildVaccineChecklist(['Aftosa', 'Mancha', 'Brucelosis'], ['Aftosa', 'Brucelosis']);
  assert.deepEqual(
    items,
    [
      { name: 'Aftosa', applies: true },
      { name: 'Mancha', applies: false },
      { name: 'Brucelosis', applies: true },
    ],
  );
});

test('D2 corrección: `applied` vacío → TODAS destildadas (el animal quedó "Sin vacuna")', () => {
  const items = buildVaccineChecklist(['Aftosa', 'Mancha'], []);
  assert.deepEqual(items, [
    { name: 'Aftosa', applies: false },
    { name: 'Mancha', applies: false },
  ]);
  // Distinto de `undefined` (primer paso): con [] NADA aplica; con undefined TODO aplica.
  assert.equal(buildVaccineChecklist(['Aftosa'], []).every((i) => !i.applies), true);
  assert.equal(buildVaccineChecklist(['Aftosa']).every((i) => i.applies), true);
});

test('D2 corrección: match case-insensitive entre definidas y aplicadas', () => {
  const items = buildVaccineChecklist(['Aftosa', 'Mancha'], ['aftosa']);
  assert.deepEqual(items.map((i) => [i.name, i.applies]), [['Aftosa', true], ['Mancha', false]]);
});

test('D2 defensa legacy: una aplicada que NO está en las definidas se preserva TILDADA al final', () => {
  // Dato de la vía de texto-libre por animal previa a D2: "Extra" no está en el preconfig definido.
  const items = buildVaccineChecklist(['Aftosa'], ['Aftosa', 'Extra']);
  assert.deepEqual(items, [
    { name: 'Aftosa', applies: true },
    { name: 'Extra', applies: true },
  ]);
});

// ─── appliedVaccineNames: el subset que se PERSISTE (N filas) ────────────────────────────────────

test('appliedVaccineNames: devuelve solo las tildadas, en orden del checklist', () => {
  const items = [
    { name: 'Aftosa', applies: true },
    { name: 'Mancha', applies: false },
    { name: 'Brucelosis', applies: true },
  ];
  assert.deepEqual(appliedVaccineNames(items), ['Aftosa', 'Brucelosis']);
});

test('appliedVaccineNames: 0 tildadas → [] (resumen "Sin vacuna", path honesto D1)', () => {
  assert.deepEqual(appliedVaccineNames([{ name: 'Aftosa', applies: false }]), []);
  assert.deepEqual(appliedVaccineNames([]), []);
});

test('round-trip: checklist default → aplicar todas; destildar una → subset correcto', () => {
  const items = buildVaccineChecklist(['Aftosa', 'Mancha']);
  assert.deepEqual(appliedVaccineNames(items), ['Aftosa', 'Mancha']);
  // El componente togglea `applies` de una fila → el subset la excluye.
  const toggled = items.map((i) => (i.name === 'Mancha' ? { ...i, applies: false } : i));
  assert.deepEqual(appliedVaccineNames(toggled), ['Aftosa']);
});
