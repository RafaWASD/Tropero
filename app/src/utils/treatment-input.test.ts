// Tests de la lógica PURA de los inputs de TRATAMIENTOS (spec 02 delta tratamientos). node:test.
// Sin RN, sin red → corre siempre.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TREATMENT_PRODUCT_MAX_LENGTH,
  TREATMENT_NOTES_MAX_LENGTH,
  TREATMENT_KIND_OPTIONS,
  TREATMENT_ROUTE_OPTIONS,
  treatmentKindLabel,
  treatmentRouteLabel,
  treatmentEventType,
  sanitizeTreatmentProductInput,
  sanitizeTreatmentNotesInput,
  validateTreatmentProduct,
  validateTreatmentNotes,
  validateDose,
  validateNextDose,
} from './treatment-input.ts';

// ─── Topes: las MISMAS que los CHECKs server-side (0123 / SEC-TRT-02) ─────────────────────────
test('topes = los CHECKs server-side (RTR.1.9/1.10): 120 y 1000', () => {
  assert.equal(TREATMENT_PRODUCT_MAX_LENGTH, 120);
  assert.equal(TREATMENT_NOTES_MAX_LENGTH, 1000);
});

// ─── Kind (D-3 / RTR.1.3): enum cerrado 3 opciones ────────────────────────────────────────────
test('TREATMENT_KIND_OPTIONS: exactamente antibiotico/antiparasitario/otro (RTR.1.3)', () => {
  assert.deepEqual(
    TREATMENT_KIND_OPTIONS.map((o) => o.value),
    ['antibiotico', 'antiparasitario', 'otro'],
  );
  // labels es-AR presentes.
  assert.equal(treatmentKindLabel('antibiotico'), 'Antibiótico');
  assert.equal(treatmentKindLabel('antiparasitario'), 'Antiparasitario');
  assert.equal(treatmentKindLabel('otro'), 'Otro');
  // fallback al propio valor si no matchea.
  assert.equal(treatmentKindLabel('desconocido'), 'desconocido');
});

// ─── Mapeo kind → event_type (RTR.2.2, criterio 4) ────────────────────────────────────────────
test('treatmentEventType: antibiotico→treatment, antiparasitario→deworming, otro→other', () => {
  assert.equal(treatmentEventType('antibiotico'), 'treatment');
  assert.equal(treatmentEventType('antiparasitario'), 'deworming');
  assert.equal(treatmentEventType('otro'), 'other');
  // Ninguno es 'vaccination' → la aplicación queda exenta del gating (RTR.2.7/2.8) sin auto-exención.
  for (const { value } of TREATMENT_KIND_OPTIONS) {
    assert.notEqual(treatmentEventType(value), 'vaccination');
  }
  // fallback conservador para un kind desconocido → other (no gateado como vaccination).
  assert.equal(treatmentEventType('xyz'), 'other');
});

// ─── Route (RTR.2.3) ──────────────────────────────────────────────────────────────────────────
// Valores VIGENTES del enum server-side `sanitary_route` (0027 + 0090). Un value fuera de este set haría que
// Postgres rechazara la aplicación al sincronizar (poison-pill de la cola de PowerSync) — el guard de abajo lo
// caza en unit (fix reliability del Gate 2: 'intravenous' NO estaba en el enum y se ofrecía).
const SANITARY_ROUTE_ENUM = new Set(['intramuscular', 'subcutaneous', 'oral', 'topical', 'other', 'intranasal']);

test('TREATMENT_ROUTE_OPTIONS: TODO value está en el enum sanitary_route (0027/0090) — no poison-pill', () => {
  for (const o of TREATMENT_ROUTE_OPTIONS) {
    assert.ok(
      SANITARY_ROUTE_ENUM.has(o.value),
      `route "${o.value}" NO está en el enum sanitary_route → Postgres la rechazaría al sincronizar`,
    );
  }
  // 'intravenous' NO existe en el enum → NO debe ofrecerse (cubierto por 'other').
  assert.equal(TREATMENT_ROUTE_OPTIONS.some((o) => (o.value as string) === 'intravenous'), false);
  // Las vías comunes de tratamiento + el catch-all "Otra".
  assert.ok(TREATMENT_ROUTE_OPTIONS.some((o) => o.value === 'intramuscular'));
  assert.ok(TREATMENT_ROUTE_OPTIONS.some((o) => o.value === 'other'));
  assert.equal(treatmentRouteLabel('subcutaneous'), 'Subcutánea');
  assert.equal(treatmentRouteLabel('other'), 'Otra');
  assert.equal(treatmentRouteLabel('xxx'), 'xxx'); // fallback
});

// ─── Sanitizers: cortan en vivo al tope (RTR.1.9/1.10) ────────────────────────────────────────
test('sanitizeTreatmentProductInput: corta a 120 (mismo tope que el CHECK)', () => {
  const long = 'a'.repeat(200);
  assert.equal(sanitizeTreatmentProductInput(long).length, 120);
  assert.equal(sanitizeTreatmentProductInput('Oxi').length, 3);
});

test('sanitizeTreatmentNotesInput: corta a 1000', () => {
  const long = 'b'.repeat(2000);
  assert.equal(sanitizeTreatmentNotesInput(long).length, 1000);
});

// ─── validateTreatmentProduct (RTR.1.4 no vacío + RTR.1.9 tope) ───────────────────────────────
test('validateTreatmentProduct: requerido no vacío, trim, ≤ 120', () => {
  assert.deepEqual(validateTreatmentProduct('  '), { ok: false, error: 'Ingresá qué producto se aplicó.' });
  assert.deepEqual(validateTreatmentProduct(''), { ok: false, error: 'Ingresá qué producto se aplicó.' });
  assert.deepEqual(validateTreatmentProduct('  Oxi  '), { ok: true, value: 'Oxi' }); // trimea
  // exactamente 120 pasa; 121 falla.
  assert.equal(validateTreatmentProduct('x'.repeat(120)).ok, true);
  assert.equal(validateTreatmentProduct('x'.repeat(121)).ok, false);
});

// ─── validateTreatmentNotes (RTR.1.5 opcional + RTR.1.10 tope) ────────────────────────────────
test('validateTreatmentNotes: opcional (vacío → null), trim, ≤ 1000', () => {
  assert.deepEqual(validateTreatmentNotes(''), { ok: true, value: null });
  assert.deepEqual(validateTreatmentNotes('   '), { ok: true, value: null });
  assert.deepEqual(validateTreatmentNotes('  hola  '), { ok: true, value: 'hola' });
  assert.equal(validateTreatmentNotes('y'.repeat(1000)).ok, true);
  assert.equal(validateTreatmentNotes('y'.repeat(1001)).ok, false);
});

// ─── validateDose (RTR.2.3 opcional, > 0, coma decimal es-AR) ─────────────────────────────────
test('validateDose: opcional (vacío → null), > 0, acepta coma decimal', () => {
  assert.deepEqual(validateDose(''), { ok: true, value: null });
  assert.deepEqual(validateDose('   '), { ok: true, value: null });
  assert.deepEqual(validateDose('5'), { ok: true, value: 5 });
  assert.deepEqual(validateDose('5,5'), { ok: true, value: 5.5 }); // coma es-AR
  assert.equal(validateDose('0').ok, false); // no > 0
  assert.equal(validateDose('-3').ok, false);
  assert.equal(validateDose('abc').ok, false);
});

// ─── validateNextDose (RTR.2.3): próxima dosis OPCIONAL, permite FUTURO, solo formato ─────────
test('validateNextDose: opcional (vacío → null), permite futuro, valida formato', () => {
  assert.deepEqual(validateNextDose(''), { ok: true, value: null });
  assert.deepEqual(validateNextDose('   '), { ok: true, value: null });
  // Una fecha futura es VÁLIDA (a diferencia de la fecha de aplicación) — es "la próxima en X días".
  assert.deepEqual(validateNextDose('2099-12-31'), { ok: true, value: '2099-12-31' });
  assert.equal(validateNextDose('2026-13-01').ok, false); // mes inválido
  assert.equal(validateNextDose('2026-1-1').ok, false); // formato incompleto
  assert.equal(validateNextDose('abc').ok, false);
});
