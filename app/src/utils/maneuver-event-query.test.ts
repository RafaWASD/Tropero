// Tests de la lógica PURA del binding maniobra→write(s) (spec 03 — orquestador, M2.2 esqueleto + M3.1
// generaliza). node:test. Foco: cada maniobra produce el/los write(s) correcto(s) CON session_id (R5.11);
// INSERT vs UPDATE de corrección (R5.9); la OR del antiparasitario; dientes=UPDATE no evento; raspado=2
// samples. + un test de EJECUCIÓN real con node:sqlite del builder de sanitary (forma del INSERT).

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  buildManeuverEventQueries,
  buildManeuverEventQuery,
  type ManeuverEventInput,
} from './maneuver-event-query';

const BASE: Omit<ManeuverEventInput, 'maneuver' | 'value'> = {
  profileId: 'prof-1',
  sessionId: 'sess-1',
  eventDate: '2026-06-14',
  createdAt: '2026-06-14T10:00:00.000Z',
  eventId: 'evt-1',
};

function q1(input: ManeuverEventInput) {
  const qs = buildManeuverEventQueries(input);
  assert.equal(qs.length, 1, 'debería producir exactamente 1 write');
  return qs[0];
}

// ─── tacto → reproductive_events con session_id (R6.2 / R5.11) ─────────────────────────

test('tacto vacía (1ra captura) → INSERT reproductive_events tacto, pregnancy_status empty, session_id al final', () => {
  const q = q1({ ...BASE, maneuver: 'tacto', value: { kind: 'tacto', pregnancy: 'empty' } });
  assert.match(q.sql, /INSERT INTO reproductive_events/);
  assert.match(q.sql, /'tacto'/);
  assert.match(q.sql, /session_id/);
  assert.deepEqual(q.args, ['evt-1', 'prof-1', '2026-06-14', 'empty', null, '2026-06-14T10:00:00.000Z', 'sess-1']);
});

test('tacto preñada → pregnancy_status del tamaño; CORRECCIÓN → UPDATE mismo id (no re-INSERT, R5.9)', () => {
  const ins = q1({ ...BASE, maneuver: 'tacto', value: { kind: 'tacto', pregnancy: 'large' } });
  assert.equal(ins.args[3], 'large');
  const upd = q1({ ...BASE, maneuver: 'tacto', value: { kind: 'tacto', pregnancy: 'medium' }, isCorrection: true });
  assert.match(upd.sql, /^UPDATE reproductive_events SET pregnancy_status/);
  assert.match(upd.sql, /WHERE id = \? AND event_type = 'tacto'/);
  assert.deepEqual(upd.args, ['medium', '2026-06-14', 'evt-1']);
});

// ─── pesaje → weight_events con session_id (R6.9 / R5.11) ──────────────────────────────

test('pesaje (1ra captura) → INSERT weight_events con session_id; CORRECCIÓN → UPDATE weight_kg', () => {
  const ins = q1({ ...BASE, maneuver: 'pesaje', value: { kind: 'pesaje', weightKg: 412 } });
  assert.match(ins.sql, /INSERT INTO weight_events/);
  assert.deepEqual(ins.args, ['evt-1', 'prof-1', 412, '2026-06-14', null, 'sess-1']);
  const upd = q1({ ...BASE, maneuver: 'pesaje', value: { kind: 'pesaje', weightKg: 350 }, isCorrection: true });
  assert.match(upd.sql, /^UPDATE weight_events SET weight_kg/);
  assert.deepEqual(upd.args, [350, '2026-06-14', 'evt-1']);
});

test('pesaje_ternero usa el mismo write-path (weight_events)', () => {
  const q = q1({ ...BASE, maneuver: 'pesaje_ternero', value: { kind: 'pesaje', weightKg: 38 } });
  assert.match(q.sql, /INSERT INTO weight_events/);
  assert.equal(q.args[2], 38);
});

// ─── tacto vaquillona → reproductive_events tacto_vaquillona + heifer_fitness (R6.3) ────

test('tacto vaquillona → INSERT reproductive_events tacto_vaquillona + heifer_fitness + session_id', () => {
  const q = q1({ ...BASE, maneuver: 'tacto_vaquillona', value: { kind: 'vaquillona', fitness: 'apta' } });
  assert.match(q.sql, /INSERT INTO reproductive_events/);
  assert.match(q.sql, /'tacto_vaquillona'/);
  assert.match(q.sql, /heifer_fitness/);
  assert.match(q.sql, /session_id/);
  // args: id, profile, event_date, heifer_fitness, created_at, session_id
  assert.deepEqual(q.args, ['evt-1', 'prof-1', '2026-06-14', 'apta', '2026-06-14T10:00:00.000Z', 'sess-1']);
});

test('tacto vaquillona CORRECCIÓN → UPDATE heifer_fitness, mismo id, filtra event_type', () => {
  const q = q1({
    ...BASE, maneuver: 'tacto_vaquillona',
    value: { kind: 'vaquillona', fitness: 'diferida' }, isCorrection: true,
  });
  assert.match(q.sql, /^UPDATE reproductive_events SET heifer_fitness/);
  assert.match(q.sql, /event_type = 'tacto_vaquillona'/);
  assert.deepEqual(q.args, ['diferida', '2026-06-14', 'evt-1']);
});

// ─── condición corporal → condition_score_events (R6.6) ────────────────────────────────

test('condición corporal → INSERT condition_score_events con session_id; CORRECCIÓN → UPDATE score', () => {
  const ins = q1({ ...BASE, maneuver: 'condicion_corporal', value: { kind: 'score', score: 3.5 } });
  assert.match(ins.sql, /INSERT INTO condition_score_events/);
  assert.deepEqual(ins.args, ['evt-1', 'prof-1', 3.5, '2026-06-14', 'sess-1']);
  const upd = q1({ ...BASE, maneuver: 'condicion_corporal', value: { kind: 'score', score: 4.25 }, isCorrection: true });
  assert.match(upd.sql, /^UPDATE condition_score_events SET score/);
  assert.deepEqual(upd.args, [4.25, '2026-06-14', 'evt-1']);
});

// ─── antiparasitario / antibiótico → sanitary_events silent_apply (R6.13/R6.15) ────────

test('antiparasitario → INSERT sanitary_events event_type deworming, product_name, SIN route (D10), session_id', () => {
  const q = q1({
    ...BASE, maneuver: 'antiparasitario',
    value: { kind: 'sanitary', eventType: 'deworming', productName: 'Ivermectina' },
  });
  assert.match(q.sql, /INSERT INTO sanitary_events/);
  assert.match(q.sql, /session_id/);
  assert.doesNotMatch(q.sql, /route/); // D10: NO se persiste route ni interno/externo
  // args: id, profile, event_type, product_name, event_date, session_id
  assert.deepEqual(q.args, ['evt-1', 'prof-1', 'deworming', 'Ivermectina', '2026-06-14', 'sess-1']);
});

test('antibiótico → INSERT sanitary_events event_type treatment, product_name, session_id', () => {
  const q = q1({
    ...BASE, maneuver: 'antibiotico',
    value: { kind: 'sanitary', eventType: 'treatment', productName: 'Oxitetraciclina' },
  });
  assert.match(q.sql, /INSERT INTO sanitary_events/);
  assert.equal(q.args[2], 'treatment');
  assert.equal(q.args[3], 'Oxitetraciclina');
  assert.equal(q.args[q.args.length - 1], 'sess-1');
});

test('antiparasitario/antibiótico CORRECCIÓN → UPDATE product_name, mismo id', () => {
  const q = q1({
    ...BASE, maneuver: 'antiparasitario',
    value: { kind: 'sanitary', eventType: 'deworming', productName: 'Doramectina' }, isCorrection: true,
  });
  assert.match(q.sql, /^UPDATE sanitary_events SET product_name/);
  assert.deepEqual(q.args, ['Doramectina', '2026-06-14', 'evt-1']);
});

// ─── vacunación multi → N sanitary_events vaccination (R6.1) ───────────────────────────

test('vacunación 1 vacuna → 1 INSERT sanitary_events vaccination con session_id', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, maneuver: 'vacunacion', value: { kind: 'vaccination', products: ['Aftosa'] },
  });
  assert.equal(qs.length, 1);
  assert.match(qs[0].sql, /'vaccination'/);
  assert.deepEqual(qs[0].args, ['evt-1', 'prof-1', 'Aftosa', '2026-06-14', 'sess-1']);
});

test('vacunación 2 vacunas → 2 INSERT sanitary_events vaccination, ids distintos, session_id en cada uno', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, eventIds: ['evt-2'],
    maneuver: 'vacunacion', value: { kind: 'vaccination', products: ['Aftosa', 'Mancha'] },
  });
  assert.equal(qs.length, 2);
  assert.equal(qs[0].args[0], 'evt-1');
  assert.equal(qs[1].args[0], 'evt-2'); // 2da vacuna usa eventIds[0]
  assert.equal(qs[0].args[2], 'Aftosa');
  assert.equal(qs[1].args[2], 'Mancha');
  for (const q of qs) assert.equal(q.args[q.args.length - 1], 'sess-1');
});

test('vacunación filtra productos vacíos (no inserta una vacuna en blanco)', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, maneuver: 'vacunacion', value: { kind: 'vaccination', products: ['Aftosa', '  ', ''] },
  });
  assert.equal(qs.length, 1);
  assert.equal(qs[0].args[2], 'Aftosa');
});

// ─── inseminación → reproductive_events service ai (R6.5) ──────────────────────────────

test('inseminación → INSERT reproductive_events service_type ai, pajuela en notes, session_id', () => {
  const q = q1({ ...BASE, maneuver: 'inseminacion', value: { kind: 'inseminacion', semenName: 'Toro X' } });
  assert.match(q.sql, /INSERT INTO reproductive_events/);
  assert.match(q.sql, /'service'/);
  assert.match(q.sql, /'ai'/);
  // args: id, profile, event_date, notes(pajuela), created_at, session_id
  assert.deepEqual(q.args, ['evt-1', 'prof-1', '2026-06-14', 'Toro X', '2026-06-14T10:00:00.000Z', 'sess-1']);
});

test('inseminación CORRECCIÓN → UPDATE notes (pajuela), filtra event_type service', () => {
  const q = q1({
    ...BASE, maneuver: 'inseminacion', value: { kind: 'inseminacion', semenName: 'Toro Y' }, isCorrection: true,
  });
  assert.match(q.sql, /^UPDATE reproductive_events SET notes/);
  assert.match(q.sql, /event_type = 'service'/);
  assert.deepEqual(q.args, ['Toro Y', '2026-06-14', 'evt-1']);
});

// ─── sangrado → lab_samples blood (R6.4) ───────────────────────────────────────────────

test('sangrado → INSERT lab_samples sample_type blood, tube_number, session_id', () => {
  const q = q1({ ...BASE, maneuver: 'sangrado', value: { kind: 'lab', tubeNumber: '42' } });
  assert.match(q.sql, /INSERT INTO lab_samples/);
  // args: id, profile, sample_type, tube_number, collection_date, session_id
  assert.deepEqual(q.args, ['evt-1', 'prof-1', 'blood', '42', '2026-06-14', 'sess-1']);
});

test('sangrado CORRECCIÓN → UPDATE tube_number', () => {
  const q = q1({ ...BASE, maneuver: 'sangrado', value: { kind: 'lab', tubeNumber: '99' }, isCorrection: true });
  assert.match(q.sql, /^UPDATE lab_samples SET tube_number/);
  assert.deepEqual(q.args, ['99', '2026-06-14', 'evt-1']);
});

// ─── raspado de toros → DOS lab_samples scrape_* (R6.11) ───────────────────────────────

test('raspado → 2 INSERT lab_samples (scrape_tricho + scrape_campylo), ids distintos, dos tube_numbers', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, eventIds: ['evt-campylo'],
    maneuver: 'raspado', value: { kind: 'lab_double', tubeTricho: '7', tubeCampylo: '8' },
  });
  assert.equal(qs.length, 2);
  assert.match(qs[0].sql, /INSERT INTO lab_samples/);
  assert.equal(qs[0].args[0], 'evt-1');
  assert.equal(qs[0].args[2], 'scrape_tricho');
  assert.equal(qs[0].args[3], '7');
  assert.equal(qs[1].args[0], 'evt-campylo');
  assert.equal(qs[1].args[2], 'scrape_campylo');
  assert.equal(qs[1].args[3], '8');
  for (const q of qs) assert.equal(q.args[q.args.length - 1], 'sess-1');
});

// ─── dientes → UPDATE animal_profiles.teeth_state (R6.7) + CUT (R6.8) — NO evento ──────

test('dientes (sin CUT) → 1 UPDATE animal_profiles.teeth_state, NO INSERT, SIN session_id (es propiedad)', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, maneuver: 'dientes', value: { kind: 'dientes', teethState: 'boca_llena', cut: false },
  });
  assert.equal(qs.length, 1);
  assert.match(qs[0].sql, /^UPDATE animal_profiles SET teeth_state/);
  assert.doesNotMatch(qs[0].sql, /session_id/); // propiedad, no evento → sin session_id
  assert.doesNotMatch(qs[0].sql, /INSERT/);
  // el id del UPDATE es el del PERFIL, no un eventId
  assert.deepEqual(qs[0].args, ['boca_llena', 'prof-1']);
});

test('dientes con CUT confirmado → 2 UPDATE: teeth_state + is_cut/category/override', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, cutCategoryId: 'cat-cut',
    maneuver: 'dientes', value: { kind: 'dientes', teethState: 'sin_dientes', cut: true },
  });
  assert.equal(qs.length, 2);
  assert.match(qs[0].sql, /SET teeth_state/);
  assert.match(qs[1].sql, /SET is_cut = 1, category_id = \?, category_override = 1/);
  assert.deepEqual(qs[1].args, ['cat-cut', 'prof-1']);
});

test('dientes CUT pero SIN cutCategoryId → solo el UPDATE de teeth_state (fail-safe, no fija categoría inválida)', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, maneuver: 'dientes', value: { kind: 'dientes', teethState: 'sin_dientes', cut: true },
  });
  assert.equal(qs.length, 1);
  assert.match(qs[0].sql, /SET teeth_state/);
});

test('dientes REVERTIR CUT (cut=false + cutCategoryId derivada) → 2do UPDATE de revert is_cut=0', () => {
  const qs = buildManeuverEventQueries({
    ...BASE, cutCategoryId: 'cat-derivada',
    maneuver: 'dientes', value: { kind: 'dientes', teethState: '6d', cut: false },
  });
  assert.equal(qs.length, 2);
  assert.match(qs[1].sql, /SET is_cut = 0, category_id = \?, category_override = 0/);
  assert.deepEqual(qs[1].args, ['cat-derivada', 'prof-1']);
});

// ─── skipped → [] (no persiste) ────────────────────────────────────────────────────────

test('skipped → 0 writes (no persiste)', () => {
  assert.deepEqual(buildManeuverEventQueries({ ...BASE, maneuver: 'vacunacion', value: { kind: 'skipped' } }), []);
});

// ─── session_id en toda 1ra captura de evento (R5.11) ──────────────────────────────────

test('toda 1ra captura de EVENTO lleva session_id (R5.11); dientes (propiedad) NO', () => {
  const eventCases: ManeuverEventInput[] = [
    { ...BASE, maneuver: 'tacto', value: { kind: 'tacto', pregnancy: 'medium' } },
    { ...BASE, maneuver: 'pesaje', value: { kind: 'pesaje', weightKg: 300 } },
    { ...BASE, maneuver: 'tacto_vaquillona', value: { kind: 'vaquillona', fitness: 'apta' } },
    { ...BASE, maneuver: 'condicion_corporal', value: { kind: 'score', score: 3 } },
    { ...BASE, maneuver: 'antiparasitario', value: { kind: 'sanitary', eventType: 'deworming', productName: 'X' } },
    { ...BASE, maneuver: 'antibiotico', value: { kind: 'sanitary', eventType: 'treatment', productName: 'Y' } },
    { ...BASE, maneuver: 'vacunacion', value: { kind: 'vaccination', products: ['Aftosa'] } },
    { ...BASE, maneuver: 'inseminacion', value: { kind: 'inseminacion', semenName: 'Z' } },
    { ...BASE, maneuver: 'sangrado', value: { kind: 'lab', tubeNumber: '1' } },
    { ...BASE, maneuver: 'raspado', value: { kind: 'lab_double', tubeTricho: '1', tubeCampylo: '2' } },
  ];
  for (const input of eventCases) {
    for (const q of buildManeuverEventQueries(input)) {
      assert.match(q.sql, /^INSERT/, `${input.maneuver}: 1ra captura es INSERT`);
      assert.equal(q.args[q.args.length - 1], 'sess-1', `${input.maneuver}: session_id al final`);
    }
  }
  // dientes (propiedad) NO lleva session_id.
  const teeth = buildManeuverEventQueries({ ...BASE, maneuver: 'dientes', value: { kind: 'dientes', teethState: '6d', cut: false } });
  assert.doesNotMatch(teeth[0].sql, /session_id/);
});

// ─── compat M2.2: buildManeuverEventQuery (1 write o null) ──────────────────────────────

test('compat buildManeuverEventQuery: 1 write → ese query; skipped → null', () => {
  const q = buildManeuverEventQuery({ ...BASE, maneuver: 'pesaje', value: { kind: 'pesaje', weightKg: 300 } });
  assert.ok(q);
  assert.match(q!.sql, /INSERT INTO weight_events/);
  assert.equal(buildManeuverEventQuery({ ...BASE, maneuver: 'vacunacion', value: { kind: 'skipped' } }), null);
});

// ─── EJECUCIÓN real (node:sqlite): el INSERT de sanitary deworming corre y persiste la fila ─────

test('ejecución (node:sqlite): el INSERT de antiparasitario persiste la fila con event_type deworming + session_id', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE sanitary_events (id TEXT PRIMARY KEY, animal_profile_id TEXT, event_type TEXT, ' +
      'product_name TEXT, event_date TEXT, session_id TEXT, route TEXT);',
  );
  const q = q1({
    ...BASE, maneuver: 'antiparasitario',
    value: { kind: 'sanitary', eventType: 'deworming', productName: 'Ivermectina' },
  });
  db.prepare(q.sql).run(...(q.args as (string | null)[]));
  const row = db.prepare('SELECT event_type, product_name, session_id, route FROM sanitary_events WHERE id = ?')
    .get('evt-1') as { event_type: string; product_name: string; session_id: string; route: string | null };
  db.close();
  assert.equal(row.event_type, 'deworming');
  assert.equal(row.product_name, 'Ivermectina');
  assert.equal(row.session_id, 'sess-1');
  assert.equal(row.route, null); // D10: route NO se escribe
});
