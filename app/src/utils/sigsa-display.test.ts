// Tests de la lógica PURA de presentación de la UI de exportación SIGSA (spec 08, T14/T15/T16).
// node:test. Foco en los BORDES que la pantalla muestra:
//   - formatRfidMasked: 15 díg → prefijo·sufijo; null/'' → "Sin caravana"; longitud != 15 → completo.
//   - incompleteReasonLabel(s): cada motivo → label es-AR; orden + dedup; vacío → [].
//   - exportLogDateLabel: ISO válido → "día mes año · hh:mm"; null/inválido → "Sin fecha".
//   - animalCountLabel: singular/plural; 0; negativo defensivo.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatRfidMasked,
  incompleteReasonLabel,
  incompleteReasonLabels,
  exportLogDateLabel,
  animalCountLabel,
} from './sigsa-display';

// ─── formatRfidMasked ────────────────────────────────────────────────────────────────────────────────

test('formatRfidMasked: un RFID de 15 dígitos se enmascara como primeros6·últimos4', () => {
  assert.equal(formatRfidMasked('032010000000000'), '032010·0000');
  // sufijo no-cero para que se vea que toma los ÚLTIMOS 4, no repite el prefijo.
  assert.equal(formatRfidMasked('032010000001234'), '032010·1234');
});

test('formatRfidMasked: null / undefined / vacío → "Sin caravana"', () => {
  assert.equal(formatRfidMasked(null), 'Sin caravana');
  assert.equal(formatRfidMasked(undefined), 'Sin caravana');
  assert.equal(formatRfidMasked(''), 'Sin caravana');
  assert.equal(formatRfidMasked('   '), 'Sin caravana'); // solo espacios → trim → vacío
});

test('formatRfidMasked: longitud != 15 (inválido) se muestra COMPLETO (no se enmascara lo que hay que corregir)', () => {
  assert.equal(formatRfidMasked('12345678'), '12345678'); // 8 díg
  assert.equal(formatRfidMasked('0320100000000001'), '0320100000000001'); // 16 díg
});

// ─── incompleteReasonLabel(s) ─────────────────────────────────────────────────────────────────────────

test('incompleteReasonLabel: cada motivo mapea a su label es-AR', () => {
  assert.equal(incompleteReasonLabel('missing_rfid'), 'Falta la caravana electrónica');
  assert.equal(incompleteReasonLabel('invalid_rfid'), 'Caravana electrónica inválida');
  assert.equal(incompleteReasonLabel('missing_birth_date'), 'Falta la fecha de nacimiento');
  assert.equal(incompleteReasonLabel('missing_breed'), 'Falta la raza');
});

test('incompleteReasonLabels: preserva el orden de los motivos (R8.3 — "el o los datos faltantes")', () => {
  assert.deepEqual(
    incompleteReasonLabels(['missing_breed', 'missing_birth_date']),
    ['Falta la raza', 'Falta la fecha de nacimiento'],
  );
});

test('incompleteReasonLabels: dedup defensivo (no repite un label si el motivo aparece dos veces)', () => {
  assert.deepEqual(incompleteReasonLabels(['missing_breed', 'missing_breed']), ['Falta la raza']);
});

test('incompleteReasonLabels: lista vacía → []', () => {
  assert.deepEqual(incompleteReasonLabels([]), []);
});

// ─── exportLogDateLabel ──────────────────────────────────────────────────────────────────────────────

test('exportLogDateLabel: ISO válido → fecha + hora es-AR (no segundos)', () => {
  const label = exportLogDateLabel('2026-03-15T14:32:09.000Z');
  // No fijamos el string EXACTO (depende de la TZ del runner), pero debe tener el separador "·" y un
  // "hh:mm" (2 grupos de 2 dígitos), y NO debe contener los segundos (":09").
  assert.match(label, /·/);
  assert.match(label, /\d{1,2}:\d{2}/);
  assert.ok(!label.includes(':09'), `no debería incluir segundos: "${label}"`);
});

test('exportLogDateLabel: null / undefined / fecha inválida → "Sin fecha"', () => {
  assert.equal(exportLogDateLabel(null), 'Sin fecha');
  assert.equal(exportLogDateLabel(undefined), 'Sin fecha');
  assert.equal(exportLogDateLabel('no-es-una-fecha'), 'Sin fecha');
  assert.equal(exportLogDateLabel(''), 'Sin fecha');
});

// ─── animalCountLabel ────────────────────────────────────────────────────────────────────────────────

test('animalCountLabel: singular vs plural es-AR', () => {
  assert.equal(animalCountLabel(1), '1 animal');
  assert.equal(animalCountLabel(0), '0 animales');
  assert.equal(animalCountLabel(42), '42 animales');
});

test('animalCountLabel: negativo defensivo → 0 animales (no un conteo negativo)', () => {
  assert.equal(animalCountLabel(-3), '0 animales');
});
