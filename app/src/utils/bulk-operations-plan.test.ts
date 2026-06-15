// Tests del PLANNER puro de operaciones masivas (spec 10, T-CL.8/T-CL.10 / R3.x, R6.1, R6.3, R10.2,
// R10.5, R13.7). node:test, sin I/O. Verifican: la doble-CrudEntry de la castración (UPDATE + observación),
// el batching (~N por batch), la idempotencia de evento (re-ejecutar ⇒ 0 nuevos), y que la observación
// lleva el establishment del PERFIL + texto "Castrado" + id distinto del de evento.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DatabaseSync } from 'node:sqlite';

import type { GroupProfile } from './bulk-candidates.ts';
import {
  planVaccination,
  planWeaning,
  planCastration,
  drainBulkPlan,
  DEFAULT_BATCH_SIZE,
  type PlannedStatement,
} from './bulk-operations-plan.ts';
import { bulkEventId } from './bulk-idempotency.ts';
import { OBSERVATION_CASTRATED } from './castration-copy.ts';

// ─── Fixtures ──────────────────────────────────────────────────────────────────────────────

function profile(id: string, over: Partial<GroupProfile> = {}): GroupProfile {
  return {
    profileId: id,
    rodeoId: 'r-1',
    sex: 'male',
    categoryCode: 'ternero',
    isCastrated: false,
    futureBull: false,
    hasWeaning: false,
    status: 'active',
    deletedAt: null,
    ...over,
  };
}

// Builders inyectados (mismos shapes que los reales de local-reads, pero deterministas en el test).
// La VÍA se eliminó del path de vacunación (decisión de producto 2026-06-15): el builder ya no recibe route.
const vaccBuilder = (id: string, profileId: string, productName: string, eventDate: string) => ({
  sql: 'INSERT INTO sanitary_events ... VALUES (?, ?, ...)',
  args: [id, profileId, productName, eventDate],
});
const weanBuilder = (id: string, profileId: string, eventDate: string, createdAt: string) => ({
  sql: 'INSERT INTO reproductive_events ... weaning',
  args: [id, profileId, eventDate, createdAt],
});
const castBuilder = (profileId: string, value: boolean) => ({
  sql: 'UPDATE animal_profiles SET is_castrated ...',
  args: [profileId, value],
});
const obsBuilder = (id: string, profileId: string, establishmentId: string, text: string) => ({
  sql: 'INSERT INTO animal_events ... observacion',
  args: [id, profileId, establishmentId, text],
});

// ─── Vacunación / destete: 1 statement por animal + idempotencia (R3.1/R3.2/R6.1/R6.3) ────────

test('R3.1/R6.1: vacunación = 1 INSERT por animal con id UUIDv5 determinístico, campos de la pre-config', () => {
  const candidates = [profile('p-1'), profile('p-2', { categoryCode: 'vaca' })];
  const plan = planVaccination(
    candidates,
    { productName: 'Aftosa', eventDate: '2026-06-11' },
    new Set(),
    vaccBuilder,
  );
  assert.equal(plan.totalAnimals, 2);
  assert.equal(plan.totalStatements, 2); // 1/animal
  // El id es el UUIDv5 determinístico de (animal, 'vaccination', fecha).
  const expectedId = bulkEventId({ animalProfileId: 'p-1', type: 'vaccination', date: '2026-06-11' });
  assert.equal(plan.mutations[0].statements[0].args[0], expectedId);
  assert.equal(plan.mutations[0].statements[0].args[2], 'Aftosa');
  // La VÍA se eliminó: el builder ya no recibe route → el último arg es eventDate (NO 'subcutánea').
  assert.equal(plan.mutations[0].statements[0].args[3], '2026-06-11');
});

test('R6.3: re-ejecutar la MISMA vacunación (ids ya presentes) ⇒ 0 mutaciones nuevas', () => {
  const candidates = [profile('p-1'), profile('p-2')];
  const date = '2026-06-11';
  const existing = new Set(
    candidates.map((p) => bulkEventId({ animalProfileId: p.profileId, type: 'vaccination', date })),
  );
  const plan = planVaccination(candidates, { productName: 'Aftosa', eventDate: date }, existing, vaccBuilder);
  assert.equal(plan.totalAnimals, 0);
  assert.equal(plan.totalStatements, 0);
  assert.deepEqual(plan.batches, []);
});

test('R6.3: re-ejecutar con UNO ya aplicado ⇒ solo el OTRO se planifica', () => {
  const candidates = [profile('p-1'), profile('p-2')];
  const date = '2026-06-11';
  const existing = new Set([bulkEventId({ animalProfileId: 'p-1', type: 'vaccination', date })]);
  const plan = planVaccination(candidates, { productName: 'Aftosa', eventDate: date }, existing, vaccBuilder);
  assert.equal(plan.totalAnimals, 1);
  assert.equal(plan.mutations[0].profileId, 'p-2');
});

test('R3.2/R3.5: destete = 1 weaning por ternero (mellizos = uno cada uno), id determinístico + createdAt', () => {
  // Dos mellizos = dos perfiles distintos → dos weanings.
  const twins = [profile('calf-a', { categoryCode: 'ternera', sex: 'female' }), profile('calf-b')];
  const plan = planWeaning(
    twins,
    { eventDate: '2026-06-11', createdAt: '2026-06-11T10:00:00.000Z' },
    new Set(),
    weanBuilder,
  );
  assert.equal(plan.totalAnimals, 2);
  assert.equal(plan.totalStatements, 2);
  const expected = bulkEventId({ animalProfileId: 'calf-a', type: 'weaning', date: '2026-06-11' });
  assert.equal(plan.mutations[0].statements[0].args[0], expected);
  assert.equal(plan.mutations[0].statements[0].args[3], '2026-06-11T10:00:00.000Z'); // createdAt
});

// ─── Castración: 2 CrudEntries por animal (UPDATE + observación) — R3.3/R13.7 ──────────────────

test('R3.3/R13.7: castración = SIEMPRE 2 statements por animal (UPDATE + observación "Castrado")', () => {
  const candidates = [profile('p-1'), profile('p-2', { categoryCode: 'torito' })];
  let seq = 0;
  const idGen = () => `obs-${seq++}`;
  const plan = planCastration(
    candidates,
    (pid) => (pid === 'p-1' ? 'est-A' : 'est-B'), // establishment del PERFIL (R13.7)
    castBuilder,
    obsBuilder,
    idGen,
  );
  assert.equal(plan.totalAnimals, 2);
  assert.equal(plan.totalStatements, 4); // 2 CrudEntries/animal

  const m1 = plan.mutations[0];
  assert.equal(m1.statements.length, 2);
  // (1) UPDATE de castración: value=true.
  assert.match(m1.statements[0].sql, /UPDATE animal_profiles/);
  assert.equal(m1.statements[0].args[1], true);
  // (2) observación: id RANDOM (no el de evento), establishment del PERFIL, texto "Castrado".
  assert.match(m1.statements[1].sql, /animal_events/);
  assert.equal(m1.statements[1].args[0], 'obs-0'); // id random inyectado
  assert.equal(m1.statements[1].args[2], 'est-A'); // establishment del perfil p-1
  assert.equal(m1.statements[1].args[3], OBSERVATION_CASTRATED); // "Castrado"
  // p-2 lleva el establishment de SU perfil (est-B), nunca uno inventado.
  assert.equal(plan.mutations[1].statements[1].args[2], 'est-B');
});

test('R13.7: el id de la observación NO es el UUIDv5 de evento (autoría por apply, design §3.5)', () => {
  const plan = planCastration(
    [profile('p-1')],
    () => 'est-A',
    castBuilder,
    obsBuilder,
    () => 'random-obs-id',
  );
  const eventLikeId = bulkEventId({ animalProfileId: 'p-1', type: 'vaccination', date: '2026-06-11' });
  assert.notEqual(plan.mutations[0].statements[1].args[0], eventLikeId);
  assert.equal(plan.mutations[0].statements[1].args[0], 'random-obs-id');
});

test('R13.7 (defensivo): un perfil sin establishment se OMITE del plan (no se observa sin establishment)', () => {
  const plan = planCastration(
    [profile('p-1'), profile('p-2')],
    (pid) => (pid === 'p-1' ? 'est-A' : null), // p-2 no resuelve establishment
    castBuilder,
    obsBuilder,
    () => 'obs',
  );
  assert.equal(plan.totalAnimals, 1);
  assert.equal(plan.mutations[0].profileId, 'p-1');
});

test('castración: re-aplicar NO duplica por SEMÁNTICA (los ya castrados ni son candidatos — barrera en bulk-candidates)', () => {
  // El planner de castración no filtra idempotencia (es estado absoluto): si el caller le pasa SOLO los
  // no-castrados (lo que hace bulk-candidates), no hay duplicación. Acá verificamos que NO inventa
  // statements de más y que el guard IS DISTINCT FROM server-side hace el re-UPDATE no-op (documentado).
  const plan = planCastration([profile('p-1')], () => 'est-A', castBuilder, obsBuilder, () => 'obs');
  assert.equal(plan.totalStatements, 2); // exactamente UPDATE + observación, ni uno más
});

// ─── Batching (R10.5) ────────────────────────────────────────────────────────────────────────

test('R10.5: el plan se parte en batches de ~batchSize (índices dentro de mutations)', () => {
  const candidates = Array.from({ length: 250 }, (_, i) => profile(`p-${i}`));
  const plan = planVaccination(candidates, { productName: 'X', eventDate: '2026-06-11' }, new Set(), vaccBuilder, 100);
  assert.equal(plan.totalAnimals, 250);
  assert.equal(plan.batches.length, 3); // 100 + 100 + 50
  assert.equal(plan.batches[0].length, 100);
  assert.equal(plan.batches[2].length, 50);
  // Los índices cubren TODAS las mutaciones, sin huecos ni solapes.
  const flat = plan.batches.flat();
  assert.equal(flat.length, 250);
  assert.deepEqual(flat, Array.from({ length: 250 }, (_, i) => i));
});

test('R10.5: batchSize default = ~100 cuando no se especifica', () => {
  assert.equal(DEFAULT_BATCH_SIZE, 100);
  const candidates = Array.from({ length: 150 }, (_, i) => profile(`p-${i}`));
  const plan = planCastration(candidates, () => 'est', castBuilder, obsBuilder, () => 'o');
  assert.equal(plan.batches.length, 2); // 100 + 50 (default)
  assert.equal(plan.totalStatements, 300); // 2/animal × 150
});

test('plan vacío: sin candidatos ⇒ 0 mutaciones, 0 statements, 0 batches', () => {
  const plan = planVaccination([], { productName: 'X', eventDate: '2026-06-11' }, new Set(), vaccBuilder);
  assert.equal(plan.totalAnimals, 0);
  assert.equal(plan.totalStatements, 0);
  assert.deepEqual(plan.batches, []);
});

// ─── Drenado (T-CL.9/T-CL.10): independencia, fallo a mitad, progreso ──────────────────────────

test('T-CL.10 / R10.2: fallo a mitad ⇒ las exitosas ENCOLAN, la fallida se reporta POR ANIMAL, sin rollback', async () => {
  const candidates = [profile('p-1'), profile('p-2'), profile('p-3')];
  const plan = planVaccination(candidates, { productName: 'X', eventDate: '2026-06-11' }, new Set(), vaccBuilder);

  // Writer que falla SOLO en el statement de p-2 (la fila de su INSERT trae args[1] === 'p-2').
  const written: string[] = [];
  const write = async (stmt: PlannedStatement) => {
    const profileId = stmt.args[1] as string;
    if (profileId === 'p-2') return { ok: false, message: 'execute local falló' };
    written.push(profileId);
    return { ok: true };
  };

  const result = await drainBulkPlan(plan, write);
  // p-1 y p-3 ENCOLARON (no se rollbackean por el fallo de p-2 — independencia, R10.2).
  assert.equal(result.enqueued, 2);
  assert.deepEqual(written.sort(), ['p-1', 'p-3']);
  // p-2 se REPORTA por animal con motivo (R10.3).
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].profileId, 'p-2');
  assert.match(result.rejected[0].message, /falló/);
});

test('T-CL.10 / R10.2: castración — si la observación (2da CrudEntry) falla, el animal se reporta (no se duplica el UPDATE)', async () => {
  const plan = planCastration([profile('p-1')], () => 'est-A', castBuilder, obsBuilder, () => 'obs');
  const calls: string[] = [];
  // Falla la SEGUNDA statement (la observación: su sql incluye 'animal_events').
  const write = async (stmt: PlannedStatement) => {
    calls.push(stmt.sql);
    if (/animal_events/.test(stmt.sql)) return { ok: false, message: 'obs falló' };
    return { ok: true };
  };
  const result = await drainBulkPlan(plan, write);
  // El UPDATE se intentó UNA vez (no se re-ejecuta tras el fallo de la obs — break), el animal se reporta.
  assert.equal(calls.filter((s) => /UPDATE animal_profiles/.test(s)).length, 1);
  assert.equal(result.enqueued, 0);
  assert.equal(result.rejected[0].profileId, 'p-1');
});

test('T-CL.9 / R10.4: el progreso reporta "X de N" por animal encolado', async () => {
  const candidates = [profile('p-1'), profile('p-2')];
  const plan = planVaccination(candidates, { productName: 'X', eventDate: '2026-06-11' }, new Set(), vaccBuilder);
  const progress: { done: number; total: number }[] = [];
  await drainBulkPlan(plan, async () => ({ ok: true }), {
    onProgress: (p) => progress.push({ ...p }),
  });
  // Arranca en 0/N y termina en N/N, monotónico.
  assert.deepEqual(progress[0], { done: 0, total: 2 });
  assert.deepEqual(progress[progress.length - 1], { done: 2, total: 2 });
});

test('T-CL.10 / R6.3: re-ejecutar la masiva NO duplica (la idempotencia ya filtró el plan ⇒ drenado vacío)', async () => {
  const candidates = [profile('p-1'), profile('p-2')];
  const date = '2026-06-11';
  // 1ra corrida: nada existe → 2 mutaciones.
  const plan1 = planVaccination(candidates, { productName: 'X', eventDate: date }, new Set(), vaccBuilder);
  const ids = plan1.mutations.map((m) => m.statements[0].args[0] as string);
  // 2da corrida: los ids ya existen localmente → el plan filtra TODO (R6.3).
  const plan2 = planVaccination(candidates, { productName: 'X', eventDate: date }, new Set(ids), vaccBuilder);
  let writes = 0;
  const result = await drainBulkPlan(plan2, async () => { writes += 1; return { ok: true }; });
  assert.equal(writes, 0);
  assert.equal(result.enqueued, 0);
});

// ─── Castración: 2 CrudEntries reales contra SQLite (UPDATE + observación queryable) — T-CL.13 ──

test('T-CL.13 (d): masiva de N ⇒ exactamente N UPDATEs + N observaciones queryables (animal_events)', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE animal_profiles (id TEXT, is_castrated INTEGER DEFAULT 0, future_bull INTEGER DEFAULT 0, deleted_at TEXT);');
  db.exec('CREATE TABLE animal_events (id TEXT, animal_profile_id TEXT, establishment_id TEXT, event_type TEXT, text TEXT, author_id TEXT);');
  for (const id of ['p-1', 'p-2', 'p-3']) {
    db.exec(`INSERT INTO animal_profiles (id, is_castrated, future_bull) VALUES ('${id}', 0, 1);`);
  }

  // Builders REALES (los de local-reads producirían el mismo SQL; acá uso un equivalente mínimo ejecutable).
  const realCast = (profileId: string, value: boolean): PlannedStatement => ({
    sql: 'UPDATE animal_profiles SET is_castrated = 1, future_bull = 0 WHERE id = ? AND deleted_at IS NULL',
    args: [profileId],
  });
  const realObs = (id: string, profileId: string, establishmentId: string, text: string): PlannedStatement => ({
    // NOTA: NO incluye author_id (lo fuerza el trigger 0034) — invariante de seguridad.
    sql: "INSERT INTO animal_events (id, animal_profile_id, establishment_id, event_type, text) VALUES (?, ?, ?, 'observacion', ?)",
    args: [id, profileId, establishmentId, text],
  });

  const candidates = [profile('p-1'), profile('p-2'), profile('p-3')];
  let obsSeq = 0;
  const plan = planCastration(
    candidates,
    () => 'est-A',
    realCast,
    realObs,
    () => `obs-${obsSeq++}`,
  );
  await drainBulkPlan(plan, async (stmt) => {
    db.prepare(stmt.sql).run(...(stmt.args as never[]));
    return { ok: true };
  });

  // N=3 UPDATEs: todos castrados, future_bull limpio.
  const castrated = db.prepare('SELECT COUNT(*) AS n FROM animal_profiles WHERE is_castrated = 1 AND future_bull = 0').get() as { n: number };
  assert.equal(castrated.n, 3);
  // N=3 observaciones "Castrado" en animal_events (lo que fetchTimeline lee — T-CL.13 c/d).
  const obs = db.prepare("SELECT COUNT(*) AS n FROM animal_events WHERE event_type = 'observacion' AND text = 'Castrado'").get() as { n: number };
  assert.equal(obs.n, 3);
  // author_id NUNCA seteado por el cliente (queda NULL hasta el trigger al subir) — invariante de seguridad.
  const withAuthor = db.prepare('SELECT COUNT(*) AS n FROM animal_events WHERE author_id IS NOT NULL').get() as { n: number };
  assert.equal(withAuthor.n, 0);
  // establishment del PERFIL (est-A), no inventado.
  const estA = db.prepare("SELECT COUNT(*) AS n FROM animal_events WHERE establishment_id = 'est-A'").get() as { n: number };
  assert.equal(estA.n, 3);

  db.close();
});
