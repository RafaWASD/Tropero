// Tests de scripts/lib/ledger-plan.mjs (spec 16 Run B, B3 / R5.4/R5.5/R5.6). node:test puro.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sortMigrations, planMigrations, numericPrefix } from './ledger-plan.mjs';

test('B3(a) R5.4: orden por prefijo numérico (no lexicográfico ingenuo)', () => {
  const out = sortMigrations(['0124_audit.sql', '0002_y.sql', '0011_z.sql', '0001_a.sql', '0125_health.sql']);
  assert.deepEqual(out, ['0001_a.sql', '0002_y.sql', '0011_z.sql', '0124_audit.sql', '0125_health.sql']);
});

test('B3(a): a igualdad de prefijo, ordena por filename (estable)', () => {
  const out = sortMigrations(['0100_b.sql', '0100_a.sql']);
  assert.deepEqual(out, ['0100_a.sql', '0100_b.sql']);
});

test('B3(b) R5.5: una migración ya en el ledger se saltea; solo aplica las ausentes, ordenadas', () => {
  const { toApply, toSkip } = planMigrations({
    files: ['0003_c.sql', '0001_a.sql', '0002_b.sql'],
    applied: ['0001_a.sql'],
  });
  assert.deepEqual(toSkip, ['0001_a.sql']);
  assert.deepEqual(
    toApply.map((m) => m.filename),
    ['0002_b.sql', '0003_c.sql'],
  );
  assert.ok(toApply.every((m) => m.execute === true)); // modo normal ejecuta
});

test('B3(c) R5.6: --backfill registra sin ejecutar (execute=false) las ausentes', () => {
  const { toApply } = planMigrations({
    files: ['0001_a.sql', '0002_b.sql'],
    applied: [],
    backfill: true,
  });
  assert.deepEqual(
    toApply.map((m) => m.filename),
    ['0001_a.sql', '0002_b.sql'],
  );
  assert.ok(toApply.every((m) => m.execute === false)); // backfill NO ejecuta SQL
});

test('R5.5: todas ya aplicadas → toApply vacío (idempotente / no-op)', () => {
  const { toApply, toSkip } = planMigrations({
    files: ['0001_a.sql', '0002_b.sql'],
    applied: ['0001_a.sql', '0002_b.sql'],
  });
  assert.deepEqual(toApply, []);
  assert.deepEqual(toSkip, ['0001_a.sql', '0002_b.sql']);
});

test('numericPrefix: 4 dígitos → número; sin prefijo → +Infinity (al final)', () => {
  assert.equal(numericPrefix('0125_health_status.sql'), 125);
  assert.equal(numericPrefix('0001_a.sql'), 1);
  assert.equal(numericPrefix('no_prefix.sql'), Number.POSITIVE_INFINITY);
});
