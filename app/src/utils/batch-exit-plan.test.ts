// Tests del LOOP CLIENT-SIDE de la baja en tanda (delta lotes-venta, RLV.7/RLV.8/RLV.9.1/RLV.22/RLV.23).
// node:test + type-stripping nativo (sin Jest). Lógica pura en utils/batch-exit-plan.ts. El SERVICE
// `services/batch-exit.ts::exitAnimalsBatch` es un THIN wrapper que llama a `planBatchExit` + `runBatchExit`
// con las ops REALES (enqueueExitAnimal + assignAnimalToGroup); acá probamos esas dos con deps FAKE (el
// service importa el SDK → no carga bajo node:test, mismo patrón que exit-animal.ts ↔ animals.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planBatchExit,
  runBatchExit,
  type PlannedBatchExit,
  type BatchExitDeps,
} from './batch-exit-plan.ts';

// ─── planBatchExit (RLV.7 params por animal, RLV.5.1 fecha común, RLV.4.1 motivo) ──────

test('planBatchExit — Venta: params por animal con status/reason y fecha común aplicada a TODOS (RLV.5.1)', () => {
  const plan = planBatchExit(
    { reason: 'sale', exitDate: '2026-07-10', commonPrice: 250000, commonWeight: 380 },
    [{ profileId: 'p1' }, { profileId: 'p2' }],
  );
  assert.equal(plan.length, 2);
  for (const item of plan) {
    assert.equal(item.status, 'sold');
    assert.equal(item.params.p_status, 'sold');
    assert.equal(item.params.p_exit_reason, 'sale');
    assert.equal(item.exitDate, '2026-07-10'); // RLV.5.1: misma fecha a todos
    assert.equal(item.params.p_exit_date, '2026-07-10');
  }
  // Sin override → precio/peso comunes a los dos (RLV.5.2).
  assert.deepEqual(
    plan.map((i) => [i.params.p_exit_price, i.params.p_exit_weight]),
    [[250000, 380], [250000, 380]],
  );
  // El p_profile_id es el del animal (anti-IDOR: el cliente solo manda el profileId, RLV.21).
  assert.deepEqual(plan.map((i) => i.params.p_profile_id), ['p1', 'p2']);
});

test('planBatchExit — Venta: el override de un animal PISA el común (RLV.6), los demás siguen el común', () => {
  const plan = planBatchExit(
    { reason: 'sale', exitDate: '2026-07-10', commonPrice: 250000, commonWeight: 380 },
    [
      { profileId: 'p1', overridePrice: 300000, overrideWeight: 410 },
      { profileId: 'p2' },
    ],
  );
  assert.deepEqual([plan[0].params.p_exit_price, plan[0].params.p_exit_weight], [300000, 410]);
  assert.deepEqual([plan[1].params.p_exit_price, plan[1].params.p_exit_weight], [250000, 380]);
});

test('planBatchExit — Muerte: NO manda precio/peso aunque el común tuviera valores (RLV.4.1)', () => {
  const plan = planBatchExit(
    { reason: 'death', exitDate: '2026-07-10', commonPrice: 250000, commonWeight: 380 },
    [{ profileId: 'p1', overridePrice: 300000 }],
  );
  assert.equal(plan[0].status, 'dead');
  assert.equal(plan[0].params.p_status, 'dead');
  assert.equal(plan[0].params.p_exit_reason, 'death');
  // Muerte no captura datos de venta → null aunque haya común/override.
  assert.equal(plan[0].params.p_exit_price, null);
  assert.equal(plan[0].params.p_exit_weight, null);
});

test('planBatchExit — motivo inválido (culling/transfer/vacío) → plan VACÍO (defensivo, RLV.4.2)', () => {
  for (const reason of ['culling', 'transfer', 'theft', '']) {
    assert.deepEqual(planBatchExit({ reason, exitDate: '2026-07-10', commonPrice: null, commonWeight: null }, [{ profileId: 'p1' }]), []);
  }
});

// ─── runBatchExit (loop: N enqueue + N clear, orden, fail-closed) ──────────────────────

/** Fake deps que registran las llamadas en orden. `failEnqueueAt`/`failClearAt` fuerzan un fallo. */
function makeSpyDeps(opts: { failEnqueueAt?: string; failClearAt?: string } = {}): {
  deps: BatchExitDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const deps: BatchExitDeps = {
    enqueueExit: async (item) => {
      calls.push(`enqueue:${item.profileId}`);
      return { ok: opts.failEnqueueAt !== item.profileId };
    },
    clearMembership: async (profileId) => {
      calls.push(`clear:${profileId}`);
      return { ok: opts.failClearAt !== profileId };
    },
  };
  return { deps, calls };
}

const PLAN2: PlannedBatchExit[] = [
  { profileId: 'p1', status: 'sold', exitDate: '2026-07-10', params: { p_profile_id: 'p1', p_status: 'sold', p_exit_reason: 'sale', p_exit_date: '2026-07-10', p_exit_weight: null, p_exit_price: null } },
  { profileId: 'p2', status: 'sold', exitDate: '2026-07-10', params: { p_profile_id: 'p2', p_status: 'sold', p_exit_reason: 'sale', p_exit_date: '2026-07-10', p_exit_weight: null, p_exit_price: null } },
];

test('RLV.7/RLV.9.1: por animal encola la baja Y limpia la membresía, EN ORDEN (enqueue→clear)', async () => {
  const { deps, calls } = makeSpyDeps();
  const r = await runBatchExit(PLAN2, deps);
  assert.deepEqual(r, { ok: true, count: 2 });
  // N enqueue + N clear, intercalados por animal, enqueue antes de clear (design §2.3).
  assert.deepEqual(calls, ['enqueue:p1', 'clear:p1', 'enqueue:p2', 'clear:p2']);
});

test('RLV.22: plan vacío → no-op ok, count 0 (no dispara ninguna escritura)', async () => {
  const { deps, calls } = makeSpyDeps();
  const r = await runBatchExit([], deps);
  assert.deepEqual(r, { ok: true, count: 0 });
  assert.deepEqual(calls, []);
});

test('RLV.8 fail-closed: si un ENQUEUE falla, corta y devuelve las completas hasta ahí (no toca el resto)', async () => {
  const { deps, calls } = makeSpyDeps({ failEnqueueAt: 'p2' });
  const r = await runBatchExit(PLAN2, deps);
  assert.deepEqual(r, { ok: false, count: 1 }); // p1 completo; p2 falló al encolar
  // p1 enqueue+clear OK; p2 enqueue falla → NO se llama clear:p2 ni se sigue.
  assert.deepEqual(calls, ['enqueue:p1', 'clear:p1', 'enqueue:p2']);
});

test('RLV.8 fail-closed: si el CLEAR de membresía falla, corta (la baja ya encolada queda; count no cuenta ese)', async () => {
  const { deps, calls } = makeSpyDeps({ failClearAt: 'p1' });
  const r = await runBatchExit(PLAN2, deps);
  assert.deepEqual(r, { ok: false, count: 0 }); // p1 encoló pero el clear falló → no cuenta, corta
  assert.deepEqual(calls, ['enqueue:p1', 'clear:p1']);
});
