// Tests de la lógica PURA de SALTEAR un animal (spec 03 delta `skip-animal-maniobra`). node:test. Foco:
// (a) contar/detectar datos parciales cargados; (b) juntar las filas a descartar por tabla desde el CaptureMap
// + los ids del frame (dientes EXCLUIDO, custom incluido, multi-write con extras, dedupe); (c) el soft-delete
// idempotente (forma del UPDATE + EJECUCIÓN real con node:sqlite).

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  buildManeuverEventSoftDeleteQuery,
  collectManeuverDiscardTargets,
  countPersistedCaptures,
  hasPersistedCaptures,
  type CapturedEventIds,
} from './maneuver-skip';
import type { CaptureMap, CustomCaptureMap } from './maneuver-sequence';

const NO_IDS: CapturedEventIds = { event: {}, extra: {}, custom: {} };

// ─── (a) ¿hay datos parciales cargados? ──────────────────────────────────────────────────

test('sin capturas → 0 / false', () => {
  assert.equal(countPersistedCaptures({}, {}), 0);
  assert.equal(hasPersistedCaptures({}, {}), false);
});

test('una maniobra skipped NO cuenta (placeholder, no persistió)', () => {
  const captured: CaptureMap = { pesaje: { kind: 'skipped' } };
  assert.equal(countPersistedCaptures(captured, {}), 0);
  assert.equal(hasPersistedCaptures(captured, {}), false);
});

test('capturas reales de fábrica + custom → cuenta ambas', () => {
  const captured: CaptureMap = {
    pesaje: { kind: 'pesaje', weightKg: 412 },
    tacto: { kind: 'tacto', pregnancy: 'empty' },
    dientes: { kind: 'dientes', teethState: 'boca_llena', cut: false }, // dientes cuenta como cargado
  };
  const custom: CustomCaptureMap = { 'field-1': { kind: 'number', value: 7 } };
  assert.equal(countPersistedCaptures(captured, custom), 4);
  assert.equal(hasPersistedCaptures(captured, custom), true);
});

// ─── (b) juntar las filas de evento a descartar ──────────────────────────────────────────

test('pesaje cargado → target weight_events con su eventId', () => {
  const captured: CaptureMap = { pesaje: { kind: 'pesaje', weightKg: 412 } };
  const ids: CapturedEventIds = { event: { pesaje: 'w-1' }, extra: {}, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  assert.deepEqual(targets, [{ table: 'weight_events', ids: ['w-1'] }]);
});

test('tacto + inseminacion → agrupados en reproductive_events (una tabla, dos ids)', () => {
  const captured: CaptureMap = {
    tacto: { kind: 'tacto', pregnancy: 'large' },
    inseminacion: { kind: 'inseminacion', semenName: 'Toro 5' },
  };
  const ids: CapturedEventIds = { event: { tacto: 're-1', inseminacion: 're-2' }, extra: {}, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].table, 'reproductive_events');
  assert.deepEqual([...targets[0].ids].sort(), ['re-1', 're-2']);
});

test('vacunación multi → sanitary_events con eventId + todos los extras', () => {
  const captured: CaptureMap = { vacunacion: { kind: 'vaccination', products: ['Aftosa', 'Carbunclo', 'Mancha'] } };
  const ids: CapturedEventIds = { event: { vacunacion: 's-0' }, extra: { vacunacion: ['s-1', 's-2'] }, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].table, 'sanitary_events');
  assert.deepEqual(targets[0].ids, ['s-0', 's-1', 's-2']);
});

test('raspado (2 tubos) → lab_samples con tricho (eventId) + campylo (extra)', () => {
  const captured: CaptureMap = { raspado: { kind: 'lab_double', tubeTricho: '10', tubeCampylo: '11' } };
  const ids: CapturedEventIds = { event: { raspado: 'l-tricho' }, extra: { raspado: ['l-campylo'] }, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  assert.deepEqual(targets, [{ table: 'lab_samples', ids: ['l-tricho', 'l-campylo'] }]);
});

test('circunferencia escrotal → scrotal_measurements; condición corporal → condition_score_events', () => {
  const captured: CaptureMap = {
    circunferencia_escrotal: { kind: 'scrotal', circumferenceCm: 36, ageMonths: 24 },
    condicion_corporal: { kind: 'score', score: 3.5 },
  };
  const ids: CapturedEventIds = { event: { circunferencia_escrotal: 'ce-1', condicion_corporal: 'cs-1' }, extra: {}, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  const byTable = Object.fromEntries(targets.map((t) => [t.table, t.ids]));
  assert.deepEqual(byTable['scrotal_measurements'], ['ce-1']);
  assert.deepEqual(byTable['condition_score_events'], ['cs-1']);
});

test('DIENTES se EXCLUYE del descarte (UPDATE de propiedad, no fila de evento)', () => {
  const captured: CaptureMap = { dientes: { kind: 'dientes', teethState: 'boca_llena', cut: true } };
  const ids: CapturedEventIds = { event: { dientes: 'x-should-not-use' }, extra: {}, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  assert.deepEqual(targets, []);
});

test('skipped se excluye; un id ausente no agrega nada', () => {
  const captured: CaptureMap = {
    pesaje: { kind: 'skipped' },
    tacto: { kind: 'tacto', pregnancy: 'empty' }, // sin id en el mapa → no se agrega
  };
  const targets = collectManeuverDiscardTargets(captured, {}, NO_IDS);
  assert.deepEqual(targets, []);
});

test('custom cargada → custom_measurements con su id', () => {
  const custom: CustomCaptureMap = { 'fd-1': { kind: 'string', value: 'x' } };
  const ids: CapturedEventIds = { event: {}, extra: {}, custom: { 'fd-1': 'cm-1' } };
  const targets = collectManeuverDiscardTargets({}, custom, ids);
  assert.deepEqual(targets, [{ table: 'custom_measurements', ids: ['cm-1'] }]);
});

test('dedupe por tabla (defensivo: el mismo id no se repite)', () => {
  const captured: CaptureMap = { vacunacion: { kind: 'vaccination', products: ['A', 'B'] } };
  const ids: CapturedEventIds = { event: { vacunacion: 's-0' }, extra: { vacunacion: ['s-0', 's-1'] }, custom: {} };
  const targets = collectManeuverDiscardTargets(captured, {}, ids);
  assert.deepEqual(targets, [{ table: 'sanitary_events', ids: ['s-0', 's-1'] }]);
});

// ─── (b.bis) corrección de UN paso YA capturado → SALTEADO (skip por-paso v2, R5.15) ─────────
//
// El frame arma `{[maneuver]: prev}` (un ÚNICO paso) y descarta SOLO las filas de ese paso — el resto de las
// capturas del animal quedan intactas. Es el mismo collectManeuverDiscardTargets, ACOTADO a un paso (no al
// animal entero). Estos tests fijan ese contrato (lo que consume carga.tsx al corregir captura→salteado).

test('corrección captura→salteado: target de UN solo paso (acotado, no todo el animal)', () => {
  // Se saltea el pesaje (ya capturado) desde el resumen → solo weight_events (su fila). Nada más se toca.
  const prev: CaptureMap = { pesaje: { kind: 'pesaje', weightKg: 412 } };
  const ids: CapturedEventIds = { event: { pesaje: 'w-1' }, extra: {}, custom: {} };
  assert.deepEqual(collectManeuverDiscardTargets(prev, {}, ids), [{ table: 'weight_events', ids: ['w-1'] }]);
});

test('corrección captura→salteado de vacunación: soft-borra TODAS las filas del paso (eventId + extras)', () => {
  const prev: CaptureMap = { vacunacion: { kind: 'vaccination', products: ['Aftosa', 'Mancha'] } };
  const ids: CapturedEventIds = { event: { vacunacion: 's-0' }, extra: { vacunacion: ['s-1'] }, custom: {} };
  assert.deepEqual(collectManeuverDiscardTargets(prev, {}, ids), [
    { table: 'sanitary_events', ids: ['s-0', 's-1'] },
  ]);
});

test('corrección dientes→salteado: NO borra (propiedad de animal_profiles, el teeth_state queda)', () => {
  // dientes es un UPDATE de propiedad (no fila de evento) → excluido del descarte, igual que en skip-animal.
  const prev: CaptureMap = { dientes: { kind: 'dientes', teethState: 'boca_llena', cut: false } };
  const ids: CapturedEventIds = { event: { dientes: 'x' }, extra: {}, custom: {} };
  assert.deepEqual(collectManeuverDiscardTargets(prev, {}, ids), []);
});

// ─── (c) soft-delete idempotente ─────────────────────────────────────────────────────────

test('buildManeuverEventSoftDeleteQuery → UPDATE deleted_at guard, id como arg', () => {
  const q = buildManeuverEventSoftDeleteQuery('weight_events', 'w-1');
  assert.match(q.sql, /^UPDATE weight_events SET deleted_at = datetime\('now'\) WHERE id = \? AND deleted_at IS NULL$/);
  assert.deepEqual(q.args, ['w-1']);
});

test('EJECUCIÓN real (node:sqlite): soft-delete setea deleted_at y es idempotente', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE weight_events (id TEXT PRIMARY KEY, deleted_at TEXT)');
  db.exec("INSERT INTO weight_events (id, deleted_at) VALUES ('w-1', NULL), ('w-2', NULL)");

  const q = buildManeuverEventSoftDeleteQuery('weight_events', 'w-1');
  const first = db.prepare(q.sql).run(...q.args);
  assert.equal(first.changes, 1, 'primera vez borra 1 fila');

  const row = db.prepare('SELECT deleted_at FROM weight_events WHERE id = ?').get('w-1') as { deleted_at: string | null };
  assert.notEqual(row.deleted_at, null, 'deleted_at quedó seteado');

  // Idempotente: re-correr no vuelve a tocar la fila (guard deleted_at IS NULL).
  const second = db.prepare(q.sql).run(...q.args);
  assert.equal(second.changes, 0, 'segunda vez no cambia nada');

  // La otra fila queda intacta.
  const other = db.prepare('SELECT deleted_at FROM weight_events WHERE id = ?').get('w-2') as { deleted_at: string | null };
  assert.equal(other.deleted_at, null, 'la otra fila no se tocó');
  db.close();
});
