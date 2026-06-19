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
  sequenceItemKey,
  type CaptureMap,
  type CustomCaptureMap,
  type CustomManeuverSpec,
  type SequenceItem,
  type SequenceStep,
} from './maneuver-sequence';
import type { ManeuverKind } from './maneuver-gating';

/** Helper: un ítem de FÁBRICA con position/total para los tests (cero custom). */
function factory(maneuver: ManeuverKind, position: number, total: number): SequenceStep {
  return { source: 'factory', maneuver, position, total };
}

/** keys legibles de la secuencia (ManeuverKind o `c:<id>`) — para asertar orden y mezcla fábrica/custom. */
function keys(seq: readonly SequenceItem[]): string[] {
  return seq.map(sequenceItemKey);
}

// ─── buildSequence: orden de config ∩ gating (R5.14 + R5.5) ─────────────────────────────

test('buildSequence: respeta el ORDEN de config, no el de applicable (R5.14)', () => {
  const ordered: ManeuverKind[] = ['pesaje', 'tacto', 'vacunacion'];
  const applicable: ManeuverKind[] = ['vacunacion', 'tacto', 'pesaje']; // desordenado a propósito
  const seq = buildSequence(ordered, applicable);
  assert.deepEqual(keys(seq), ['pesaje', 'tacto', 'vacunacion']);
});

test('buildSequence: OMITE las maniobras que no aplican al rodeo real (R5.5), sin reordenar', () => {
  const ordered: ManeuverKind[] = ['tacto', 'vacunacion', 'pesaje'];
  const applicable: ManeuverKind[] = ['tacto', 'pesaje']; // vacunación NO aplica
  const seq = buildSequence(ordered, applicable);
  assert.deepEqual(keys(seq), ['tacto', 'pesaje']);
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
  assert.deepEqual(keys(seq), ['tacto', 'pesaje']);
});

test('buildSequence: ninguna aplica → secuencia vacía', () => {
  const seq = buildSequence(['tacto', 'pesaje'], []);
  assert.deepEqual(seq, []);
});

// ─── buildSequence: maniobras CUSTOM (spec 03 M5-C.3, R13.8) — ADITIVO ───────────────────

const pezunas: CustomManeuverSpec = {
  fieldDefinitionId: 'fd-pezunas',
  uiComponent: 'enum_single',
  label: 'Ángulo de pezuñas',
  options: ['Adentro', 'Afuera', 'Normal'],
};
const score: CustomManeuverSpec = {
  fieldDefinitionId: 'fd-score',
  uiComponent: 'numeric',
  label: 'Score propio',
  options: [],
};

test('buildSequence: SIN custom = IDÉNTICO a las de fábrica (cero regresión)', () => {
  const seqA = buildSequence(['tacto', 'pesaje'], ['tacto', 'pesaje']);
  const seqB = buildSequence(['tacto', 'pesaje'], ['tacto', 'pesaje'], []);
  assert.deepEqual(seqA, seqB);
  assert.deepEqual(keys(seqA), ['tacto', 'pesaje']);
  assert.ok(seqA.every((s) => s.source === 'factory'));
});

test('buildSequence: las custom van DESPUÉS de las de fábrica, en su orden, contador COMBINADO', () => {
  const seq = buildSequence(['tacto', 'pesaje'], ['tacto', 'pesaje'], [pezunas, score]);
  assert.deepEqual(keys(seq), ['tacto', 'pesaje', 'c:fd-pezunas', 'c:fd-score']);
  assert.deepEqual(seq.map((s) => [s.position, s.total]), [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ]);
  const customItem = seq[2];
  assert.equal(customItem.source, 'custom');
  if (customItem.source === 'custom') {
    assert.equal(customItem.custom.uiComponent, 'enum_single');
    assert.deepEqual(customItem.custom.options, ['Adentro', 'Afuera', 'Normal']);
  }
});

test('buildSequence: SOLO custom (rodeo sin maniobras de fábrica en la jornada)', () => {
  const seq = buildSequence([], [], [pezunas]);
  assert.deepEqual(keys(seq), ['c:fd-pezunas']);
  assert.deepEqual(seq.map((s) => [s.position, s.total]), [[1, 1]]);
});

test('buildSequence: deduplica las custom por field_definition_id (defensivo)', () => {
  const seq = buildSequence([], [], [pezunas, pezunas]);
  assert.deepEqual(keys(seq), ['c:fd-pezunas']);
});

// ─── isSequenceComplete / firstUncapturedIndex ─────────────────────────────────────────

const seqTactoPesaje: SequenceStep[] = [factory('tacto', 1, 2), factory('pesaje', 2, 2)];

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
  const seq: SequenceStep[] = [factory('pesaje', 1, 2), factory('vacunacion', 2, 2)];
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

// ─── isSequenceComplete con maniobras CUSTOM (R13.8) ─────────────────────────────────────

test('isSequenceComplete: una custom sin valor → incompleta; firstUncaptured la apunta', () => {
  const seq = buildSequence(['tacto'], ['tacto'], [pezunas]);
  const cap: CaptureMap = { tacto: { kind: 'tacto', pregnancy: 'empty' } };
  const customCap: CustomCaptureMap = {};
  assert.equal(isSequenceComplete(seq, cap, customCap), false);
  assert.equal(firstUncapturedIndex(seq, cap, customCap), 1); // la custom es el índice 1
  // Capturada la custom → completa.
  customCap['fd-pezunas'] = { kind: 'string', value: 'Afuera' };
  assert.equal(isSequenceComplete(seq, cap, customCap), true);
  assert.equal(firstUncapturedIndex(seq, cap, customCap), -1);
});

test('firstUncapturedIndex: salta la fábrica capturada y apunta la PRIMERA custom sin valor', () => {
  const seq = buildSequence(['tacto'], ['tacto'], [pezunas, score]);
  const cap: CaptureMap = { tacto: { kind: 'tacto', pregnancy: 'large' } };
  const customCap: CustomCaptureMap = { 'fd-pezunas': { kind: 'string', value: 'Normal' } };
  assert.equal(firstUncapturedIndex(seq, cap, customCap), 2); // fd-score (índice 2) sin valor
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

test('describeStepValue: circunferencia escrotal en es-AR (coma decimal) + edad snapshot (R14.5/R14.8)', () => {
  // CE con decimal + edad → "36,5 cm · 24 meses". CE entera → sin coma. Singular "1 mes".
  assert.equal(describeStepValue({ kind: 'scrotal', circumferenceCm: 36.5, ageMonths: 24 }), '36,5 cm · 24 meses');
  assert.equal(describeStepValue({ kind: 'scrotal', circumferenceCm: 38, ageMonths: 1 }), '38 cm · 1 mes');
  // Edad desconocida (R14.7): solo la CE, sin la edad.
  assert.equal(describeStepValue({ kind: 'scrotal', circumferenceCm: 40.5, ageMonths: null }), '40,5 cm');
});

// ─── summaryRows: filas del resumen (R5.9) ──────────────────────────────────────────────

test('summaryRows: una fila por paso, en orden, con label es-AR + valor + flag captured', () => {
  const cap: CaptureMap = {
    tacto: { kind: 'tacto', pregnancy: 'large' },
    pesaje: { kind: 'pesaje', weightKg: 412 },
  };
  const rows = summaryRows(seqTactoPesaje, cap);
  assert.deepEqual(rows, [
    { maneuver: 'tacto', source: 'factory', label: 'Tacto de preñez', value: 'Preñada · Cabeza', captured: true },
    { maneuver: 'pesaje', source: 'factory', label: 'Pesaje', value: '412 kg', captured: true },
  ]);
});

test('summaryRows: una maniobra skipped (sin cargar) → captured false, valor "Sin cargar"', () => {
  const seq: SequenceStep[] = [factory('vacunacion', 1, 1)];
  const rows = summaryRows(seq, { vacunacion: { kind: 'skipped' } });
  assert.deepEqual(rows, [
    { maneuver: 'vacunacion', source: 'factory', label: 'Vacunación', value: 'Sin cargar', captured: false },
  ]);
});

test('summaryRows: una maniobra CUSTOM muestra su label + valor legible es-AR (R5.9/R13.8)', () => {
  const seq = buildSequence(['tacto'], ['tacto'], [pezunas, score]);
  const cap: CaptureMap = { tacto: { kind: 'tacto', pregnancy: 'empty' } };
  const customCap: CustomCaptureMap = {
    'fd-pezunas': { kind: 'string', value: 'Afuera' },
    'fd-score': { kind: 'number', value: 4.5 },
  };
  const rows = summaryRows(seq, cap, customCap);
  assert.deepEqual(rows, [
    { maneuver: 'tacto', source: 'factory', label: 'Tacto de preñez', value: 'Vacía', captured: true },
    { maneuver: 'fd-pezunas', source: 'custom', label: 'Ángulo de pezuñas', value: 'Afuera', captured: true },
    { maneuver: 'fd-score', source: 'custom', label: 'Score propio', value: '4,5', captured: true },
  ]);
});

test('summaryRows: una custom SIN valor → captured false, "Sin cargar"', () => {
  const seq = buildSequence([], [], [pezunas]);
  const rows = summaryRows(seq, {}, {});
  assert.deepEqual(rows, [
    { maneuver: 'fd-pezunas', source: 'custom', label: 'Ángulo de pezuñas', value: 'Sin cargar', captured: false },
  ]);
});
