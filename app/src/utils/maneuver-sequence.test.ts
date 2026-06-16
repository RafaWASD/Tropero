// Tests de la lógica PURA del frame de carga rápida (spec 03 M2.2). node:test.
// Foco: secuencia ordenada (orden config ∩ gating, R5.14/R5.5), completitud, resumen corregible (R5.9).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSequence,
  isSequenceComplete,
  firstUncapturedIndex,
  summaryRows,
  describeStepValue,
  type CaptureMap,
  type SequenceStep,
} from './maneuver-sequence';
import type { ManeuverKind } from './maneuver-gating';

// ─── buildSequence: orden de config ∩ gating (R5.14 + R5.5) ─────────────────────────────

test('buildSequence: respeta el ORDEN de config, no el de applicable (R5.14)', () => {
  const ordered: ManeuverKind[] = ['pesaje', 'tacto', 'vacunacion'];
  const applicable: ManeuverKind[] = ['vacunacion', 'tacto', 'pesaje']; // desordenado a propósito
  const seq = buildSequence(ordered, applicable);
  assert.deepEqual(seq.map((s) => s.maneuver), ['pesaje', 'tacto', 'vacunacion']);
});

test('buildSequence: OMITE las maniobras que no aplican al rodeo real (R5.5), sin reordenar', () => {
  const ordered: ManeuverKind[] = ['tacto', 'vacunacion', 'pesaje'];
  const applicable: ManeuverKind[] = ['tacto', 'pesaje']; // vacunación NO aplica
  const seq = buildSequence(ordered, applicable);
  assert.deepEqual(seq.map((s) => s.maneuver), ['tacto', 'pesaje']);
});

test('buildSequence: position 1-based y total reflejan la secuencia FILTRADA (contador "Tacto · 2 de 4")', () => {
  const ordered: ManeuverKind[] = ['tacto', 'vacunacion', 'pesaje']; // 3 en la config
  const applicable: ManeuverKind[] = ['tacto', 'pesaje']; // 2 aplican
  const seq = buildSequence(ordered, applicable);
  assert.deepEqual(
    seq.map((s) => [s.position, s.total]),
    [
      [1, 2],
      [2, 2],
    ],
  );
});

test('buildSequence: deduplica (defensivo) preservando el primer orden', () => {
  const ordered: ManeuverKind[] = ['tacto', 'tacto', 'pesaje'];
  const applicable: ManeuverKind[] = ['tacto', 'pesaje'];
  const seq = buildSequence(ordered, applicable);
  assert.deepEqual(seq.map((s) => s.maneuver), ['tacto', 'pesaje']);
});

test('buildSequence: ninguna aplica → secuencia vacía', () => {
  const seq = buildSequence(['tacto', 'pesaje'], []);
  assert.deepEqual(seq, []);
});

// ─── isSequenceComplete / firstUncapturedIndex ─────────────────────────────────────────

const seqTactoPesaje: SequenceStep[] = [
  { maneuver: 'tacto', position: 1, total: 2 },
  { maneuver: 'pesaje', position: 2, total: 2 },
];

test('isSequenceComplete: todo capturado con dato real → true', () => {
  const cap: CaptureMap = {
    tacto: { kind: 'tacto', pregnancy: 'empty' },
    pesaje: { kind: 'pesaje', weightKg: 385 },
  };
  assert.equal(isSequenceComplete(seqTactoPesaje, cap), true);
  assert.equal(firstUncapturedIndex(seqTactoPesaje, cap), -1);
});

test('isSequenceComplete: falta un paso → false, y firstUncaptured lo apunta', () => {
  const cap: CaptureMap = { tacto: { kind: 'tacto', pregnancy: 'large' } };
  assert.equal(isSequenceComplete(seqTactoPesaje, cap), false);
  assert.equal(firstUncapturedIndex(seqTactoPesaje, cap), 1); // pesaje sin cargar
});

test('isSequenceComplete: una maniobra PERSISTIBLE marcada skipped NO cuenta como completa', () => {
  const cap: CaptureMap = {
    tacto: { kind: 'skipped' }, // tacto persiste → skipped es un dato faltante
    pesaje: { kind: 'pesaje', weightKg: 400 },
  };
  assert.equal(isSequenceComplete(seqTactoPesaje, cap), false);
  assert.equal(firstUncapturedIndex(seqTactoPesaje, cap), 0);
});

test('isSequenceComplete (M3.1): TODA maniobra del catálogo persiste → una skipped NO cuenta como lista', () => {
  // En M3.1 todas las maniobras tienen write-path → stepPersists siempre true → un valor `skipped` (un paso
  // que el operario aún no cargó) deja la secuencia INCOMPLETA (a diferencia de M2.2 donde la vacunación era
  // placeholder y un skip contaba). La aplicabilidad per-animal (raspado en hembra, R6.12) se resuelve ANTES,
  // sacando la maniobra de la secuencia — no se modela como skipped.
  const seq: SequenceStep[] = [
    { maneuver: 'pesaje', position: 1, total: 2 },
    { maneuver: 'vacunacion', position: 2, total: 2 },
  ];
  const cap: CaptureMap = {
    pesaje: { kind: 'pesaje', weightKg: 400 },
    vacunacion: { kind: 'skipped' },
  };
  assert.equal(isSequenceComplete(seq, cap), false);
  // Con la vacunación capturada de verdad → completa.
  cap.vacunacion = { kind: 'vaccination', products: ['Aftosa'] };
  assert.equal(isSequenceComplete(seq, cap), true);
});

test('isSequenceComplete: secuencia vacía → true (no frena la fila)', () => {
  assert.equal(isSequenceComplete([], {}), true);
});

// ─── describeStepValue: legibilidad es-AR del resumen (R5.9) ────────────────────────────

test('describeStepValue: tacto vacía / preñada con tamaño (labels de campo as-built Facundo)', () => {
  assert.equal(describeStepValue({ kind: 'tacto', pregnancy: 'empty' }), 'Vacía');
  assert.equal(describeStepValue({ kind: 'tacto', pregnancy: 'small' }), 'Preñada · Cola');
  assert.equal(describeStepValue({ kind: 'tacto', pregnancy: 'medium' }), 'Preñada · Cuerpo');
  assert.equal(describeStepValue({ kind: 'tacto', pregnancy: 'large' }), 'Preñada · Cabeza');
});

test('describeStepValue: pesaje en es-AR (punto de miles)', () => {
  assert.equal(describeStepValue({ kind: 'pesaje', weightKg: 385 }), '385 kg');
  assert.equal(describeStepValue({ kind: 'pesaje', weightKg: 1050 }), '1.050 kg');
});

test('describeStepValue: skipped / ausente → "Sin cargar"', () => {
  assert.equal(describeStepValue({ kind: 'skipped' }), 'Sin cargar');
  assert.equal(describeStepValue(undefined), 'Sin cargar');
});

// ─── describeStepValue: las maniobras nuevas de M3.1 (resumen R5.9) ─────────────────────

test('describeStepValue: vaquillona (apta/no_apta/diferida)', () => {
  assert.equal(describeStepValue({ kind: 'vaquillona', fitness: 'apta' }), 'Apta');
  assert.equal(describeStepValue({ kind: 'vaquillona', fitness: 'no_apta' }), 'No apta');
  assert.equal(describeStepValue({ kind: 'vaquillona', fitness: 'diferida' }), 'Diferida');
});

test('describeStepValue: condición corporal en es-AR (coma decimal, 2 decimales)', () => {
  assert.equal(describeStepValue({ kind: 'score', score: 3.5 }), '3,50');
  assert.equal(describeStepValue({ kind: 'score', score: 4.25 }), '4,25');
});

test('describeStepValue: sanitary silent_apply muestra el producto (o "Aplicado")', () => {
  assert.equal(
    describeStepValue({ kind: 'sanitary', eventType: 'deworming', productName: 'Ivermectina' }),
    'Ivermectina',
  );
  assert.equal(describeStepValue({ kind: 'sanitary', eventType: 'treatment', productName: '  ' }), 'Aplicado');
});

test('describeStepValue: vacunación multi (coma-join) / inseminación / lab', () => {
  assert.equal(
    describeStepValue({ kind: 'vaccination', products: ['Aftosa', 'Mancha'] }),
    'Aftosa, Mancha',
  );
  assert.equal(describeStepValue({ kind: 'vaccination', products: [] }), 'Aplicada');
  assert.equal(describeStepValue({ kind: 'inseminacion', semenName: 'Toro X' }), 'Toro X');
  assert.equal(describeStepValue({ kind: 'lab', tubeNumber: '42' }), 'Tubo 42');
  assert.equal(
    describeStepValue({ kind: 'lab_double', tubeTricho: '7', tubeCampylo: '8' }),
    'Trico 7 · Campylo 8',
  );
});

test('describeStepValue: dientes con/sin CUT', () => {
  assert.equal(describeStepValue({ kind: 'dientes', teethState: 'boca_llena', cut: false }), 'Boca llena');
  assert.equal(describeStepValue({ kind: 'dientes', teethState: 'sin_dientes', cut: true }), 'Sin dientes · CUT');
});

// ─── summaryRows: filas del resumen (R5.9) ──────────────────────────────────────────────

test('summaryRows: una fila por paso, en orden, con label es-AR + valor + flag captured', () => {
  const cap: CaptureMap = {
    tacto: { kind: 'tacto', pregnancy: 'large' },
    pesaje: { kind: 'pesaje', weightKg: 412 },
  };
  const rows = summaryRows(seqTactoPesaje, cap);
  assert.deepEqual(rows, [
    { maneuver: 'tacto', label: 'Tacto de preñez', value: 'Preñada · Cabeza', captured: true },
    { maneuver: 'pesaje', label: 'Pesaje', value: '412 kg', captured: true },
  ]);
});

test('summaryRows: una maniobra skipped (sin cargar) → captured false, valor "Sin cargar"', () => {
  const seq: SequenceStep[] = [{ maneuver: 'vacunacion', position: 1, total: 1 }];
  const rows = summaryRows(seq, { vacunacion: { kind: 'skipped' } });
  assert.deepEqual(rows, [
    { maneuver: 'vacunacion', label: 'Vacunación', value: 'Sin cargar', captured: false },
  ]);
});
