// Tests del store observable de rechazos de upload + el helper PURO de motivo es-AR (spec 03 R10.8).
// node:test. El store es in-memory: cada test limpia primero (clearUploadRejections) para aislarse.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  rejectionReason,
  rejectionWhenLabel,
  rejectionBannerTitle,
  isManeuverRejection,
  maneuverRejectionTypeLabel,
  recordUploadRejection,
  acknowledgeUploadRejections,
  clearUploadRejections,
  _getUploadRejectionsForTest,
  MAX_UPLOAD_REJECTIONS,
} from './upload-rejections.ts';

// Shim mínimo de CrudEntry (solo los campos que el store lee: id/table/op). El resto del tipo no se toca.
function op(id: string, table: string, opType = 'PUT'): { id: string; table: string; op: string } {
  return { id, table, op: opType };
}

beforeEach(() => {
  clearUploadRejections();
});

// ─── Helper de motivo es-AR (PURO) ─────────────────────────────────────────────────────────────

test('R10.8: rejectionReason 23514 → rodeo dejó de habilitar / animal cambió de rodeo', () => {
  const msg = rejectionReason('weight_events', '23514');
  assert.match(msg, /Pesaje:/);
  assert.match(msg, /rodeo dejó de habilitar|cambió de rodeo\/campo/);
});

test('R10.8: rejectionReason 42501 → sin permiso en este campo', () => {
  const msg = rejectionReason('sanitary_events', '42501');
  assert.match(msg, /Vacuna\/sanitaria:/);
  assert.match(msg, /permiso/);
});

test('R10.8: rejectionReason código desconocido → rechazo genérico del servidor', () => {
  assert.match(rejectionReason('reproductive_events', '23505'), /Tacto\/servicio:.*servidor rechazó/);
  assert.match(rejectionReason('lab_samples', undefined), /Muestra de laboratorio:.*servidor rechazó/);
  assert.match(rejectionReason('condition_score_events', null), /Condición corporal:.*servidor rechazó/);
});

test('R10.8: el tipo de maniobra sale de la tabla (las tablas de evento, incl. CE M6)', () => {
  assert.equal(maneuverRejectionTypeLabel('weight_events'), 'Pesaje');
  assert.equal(maneuverRejectionTypeLabel('sanitary_events'), 'Vacuna/sanitaria');
  assert.equal(maneuverRejectionTypeLabel('reproductive_events'), 'Tacto/servicio');
  assert.equal(maneuverRejectionTypeLabel('lab_samples'), 'Muestra de laboratorio');
  assert.equal(maneuverRejectionTypeLabel('condition_score_events'), 'Condición corporal');
  // spec 03 M6 (M6-SEC-01): la CE tiene su label es-AR en el surfacing de manga.
  assert.equal(maneuverRejectionTypeLabel('scrotal_measurements'), 'Circunferencia escrotal');
  // Una tabla NO de maniobra → label genérico (no se usa en la UI de manga, que filtra antes).
  assert.equal(maneuverRejectionTypeLabel('animal_profiles'), 'Maniobra');
  assert.equal(maneuverRejectionTypeLabel(null), 'Maniobra');
});

// ─── Título con pluralización es-AR (sustantivo + verbo) ─────────────────────────────────────────

test('R10.8: rejectionBannerTitle conjuga el verbo según el número (1→sincronizó, N→sincronizaron)', () => {
  assert.equal(rejectionBannerTitle(1), '1 maniobra no se sincronizó');
  assert.equal(rejectionBannerTitle(2), '2 maniobras no se sincronizaron');
  assert.equal(rejectionBannerTitle(5), '5 maniobras no se sincronizaron');
  // Borde: 0 / negativo / decimal → no rompe (trunca, plural).
  assert.equal(rejectionBannerTitle(0), '0 maniobras no se sincronizaron');
  assert.equal(rejectionBannerTitle(-3), '0 maniobras no se sincronizaron');
  assert.equal(rejectionBannerTitle(2.9), '2 maniobras no se sincronizaron');
});

// ─── Cuándo (relativo, es-AR) ────────────────────────────────────────────────────────────────────

test('R10.8: rejectionWhenLabel — recién / hace N min / hace N h / dd-mm', () => {
  const now = new Date('2026-06-17T12:00:00').getTime();
  assert.equal(rejectionWhenLabel(now - 10_000, now), 'recién'); // 10s
  assert.equal(rejectionWhenLabel(now - 5 * 60_000, now), 'hace 5 min');
  assert.equal(rejectionWhenLabel(now - 3 * 3_600_000, now), 'hace 3 h');
  // ≥24h → fecha corta dd/mm del momento del rechazo.
  const twoDaysAgo = new Date('2026-06-15T09:00:00').getTime();
  assert.equal(rejectionWhenLabel(twoDaysAgo, now), '15/06');
  // futuro/inválido → recién (no rompe).
  assert.equal(rejectionWhenLabel(now + 1_000, now), 'recién');
  assert.equal(rejectionWhenLabel(NaN, now), 'recién');
});

// ─── Filtro de maniobra ────────────────────────────────────────────────────────────────────────

test('R10.8: isManeuverRejection true SOLO para las tablas de evento de maniobra (incl. CE M6)', () => {
  for (const t of [
    'weight_events', 'sanitary_events', 'reproductive_events', 'lab_samples', 'condition_score_events',
    'scrotal_measurements', // spec 03 M6 — CE: el rechazo de sync se superficia en manga (M6-SEC-01).
  ]) {
    assert.equal(isManeuverRejection(t), true, t);
  }
  for (const t of ['animal_profiles', 'rodeos', 'sessions', 'maneuver_presets', '', undefined, null]) {
    assert.equal(isManeuverRejection(t as string), false, String(t));
  }
});

test('R10.8 (M6-SEC-01): rejectionReason de la CE antepone el tipo "Circunferencia escrotal"', () => {
  // 23514 = gating capa 2 / tenant-check del session_id: el rodeo dejó de habilitar la CE o el animal cambió.
  const g = rejectionReason('scrotal_measurements', '23514');
  assert.match(g, /Circunferencia escrotal:/);
  assert.match(g, /rodeo dejó de habilitar|cambió de rodeo\/campo/);
  // 42501 = RLS: sin permiso.
  assert.match(rejectionReason('scrotal_measurements', '42501'), /Circunferencia escrotal:.*permiso/);
});

// ─── Store: record / snapshot ───────────────────────────────────────────────────────────────────

test('R10.8: recordUploadRejection guarda { id, table, op, code, at } SIN opData', () => {
  recordUploadRejection({ ...op('e1', 'weight_events'), opData: { weight_kg: 380, secret: 'x' } } as never, { code: '23514' });
  const list = _getUploadRejectionsForTest();
  assert.equal(list.length, 1);
  const r = list[0];
  assert.equal(r.id, 'e1');
  assert.equal(r.table, 'weight_events');
  assert.equal(r.op, 'PUT');
  assert.equal(r.code, '23514');
  assert.equal(typeof r.at, 'number');
  // PRIVACIDAD: el registro NO contiene opData ni ninguna clave de campo.
  assert.equal('opData' in (r as Record<string, unknown>), false);
  assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.equal(JSON.stringify(r).includes('380'), false);
});

test('R10.8: code no-string (o ausente) → undefined, no rompe', () => {
  recordUploadRejection(op('e1', 'sanitary_events') as never, { code: 23514 });
  recordUploadRejection(op('e2', 'sanitary_events') as never, {});
  recordUploadRejection(op('e3', 'sanitary_events') as never, null);
  const list = _getUploadRejectionsForTest();
  assert.equal(list.length, 3);
  for (const r of list) assert.equal(r.code, undefined);
});

test('R10.8: op sin id (lastOp null o id vacío) → NO registra (no hay clave de dedup/ack)', () => {
  recordUploadRejection(null, { code: '23514' });
  recordUploadRejection(op('', 'weight_events') as never, { code: '23514' });
  assert.equal(_getUploadRejectionsForTest().length, 0);
});

test('R10.8: recordUploadRejection NUNCA tira (best-effort) ante un op/error patológico', () => {
  // op con getters que tiran → el try/catch interno lo absorbe, no propaga.
  const poison = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(poison, 'id', { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => recordUploadRejection(poison as never, { code: '23514' }));
  assert.equal(_getUploadRejectionsForTest().length, 0);
});

// ─── Store: dedup ────────────────────────────────────────────────────────────────────────────

test('R10.8: DEDUP por id — la misma op re-rechazada NO se duplica (se actualiza)', () => {
  recordUploadRejection(op('e1', 'weight_events') as never, { code: '23514' });
  recordUploadRejection(op('e1', 'weight_events') as never, { code: '42501' });
  const list = _getUploadRejectionsForTest();
  assert.equal(list.length, 1);
  assert.equal(list[0].code, '42501'); // el más reciente gana
});

// ─── Store: cap (acotado) ────────────────────────────────────────────────────────────────────

test('R10.8: el store ACOTA a MAX_UPLOAD_REJECTIONS, descartando los más viejos', () => {
  const total = MAX_UPLOAD_REJECTIONS + 10;
  for (let i = 0; i < total; i++) {
    recordUploadRejection(op(`e${i}`, 'weight_events') as never, { code: '23514' });
  }
  const list = _getUploadRejectionsForTest();
  assert.equal(list.length, MAX_UPLOAD_REJECTIONS);
  // Los 10 más viejos (e0..e9) se descartaron; el último (eN-1) sigue.
  assert.equal(list.some((r) => r.id === 'e0'), false);
  assert.equal(list.some((r) => r.id === `e${total - 1}`), true);
});

// ─── Store: acknowledge / clear ────────────────────────────────────────────────────────────────

test('R10.8: acknowledgeUploadRejections(ids) descarta SOLO esos', () => {
  recordUploadRejection(op('e1', 'weight_events') as never, { code: '23514' });
  recordUploadRejection(op('e2', 'sanitary_events') as never, { code: '42501' });
  recordUploadRejection(op('e3', 'lab_samples') as never, { code: '23514' });
  acknowledgeUploadRejections(['e1', 'e3']);
  const list = _getUploadRejectionsForTest();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'e2');
});

test('R10.8: acknowledgeUploadRejections() sin ids = limpiar TODO (el "Entendido")', () => {
  recordUploadRejection(op('e1', 'weight_events') as never, { code: '23514' });
  recordUploadRejection(op('e2', 'sanitary_events') as never, { code: '42501' });
  acknowledgeUploadRejections();
  assert.equal(_getUploadRejectionsForTest().length, 0);
});

test('R10.8: clearUploadRejections limpia todo; acknowledge de ids inexistentes es no-op', () => {
  recordUploadRejection(op('e1', 'weight_events') as never, { code: '23514' });
  acknowledgeUploadRejections(['no-existe']); // no-op
  assert.equal(_getUploadRejectionsForTest().length, 1);
  clearUploadRejections();
  assert.equal(_getUploadRejectionsForTest().length, 0);
});

// ─── Store: observabilidad (subscribe vía el snapshot estable) ──────────────────────────────────

test('R10.8: el snapshot es estable entre cambios (referencia nueva SOLO al mutar)', () => {
  const s0 = _getUploadRejectionsForTest();
  recordUploadRejection(op('e1', 'weight_events') as never, { code: '23514' });
  const s1 = _getUploadRejectionsForTest();
  assert.notEqual(s0, s1); // mutó → referencia nueva (useSyncExternalStore re-renderiza)
  acknowledgeUploadRejections(['no-existe']); // no-op → misma referencia
  const s2 = _getUploadRejectionsForTest();
  assert.equal(s1, s2);
});
