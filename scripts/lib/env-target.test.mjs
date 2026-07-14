// Tests de scripts/lib/env-target.mjs (spec 16 Run B, B1 / R5.1/R5.2/R5.3/R5.12/R5.13).
// node:test puro (sin red, sin process.exit). Verifica la resolución de target + la guarda destino-aware.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTarget, ProdGuardError, parseEnvFlag, positionalArgs, knownProdRefs } from './env-target.mjs';

const DEV = { SUPABASE_PROJECT_REF: 'devref123', SUPABASE_ACCESS_TOKEN: 'sbp_tok' };
const DEV_PROD = { ...DEV, SUPABASE_PROJECT_REF_PROD: 'prodref999' };

test('B1(a) R5.1: sin --env → target dev con el ref de dev', () => {
  const t = resolveTarget([], DEV);
  assert.equal(t.env, 'dev');
  assert.equal(t.ref, 'devref123');
  assert.equal(t.pointsToProd, false);
  assert.equal(t.host, 'https://api.supabase.com/v1/projects/devref123');
});

test('B1(a) R5.1: un posicional (archivo) sin --env → sigue dev', () => {
  const t = resolveTarget(['supabase/migrations/0125_health_status.sql'], DEV);
  assert.equal(t.env, 'dev');
  assert.equal(t.ref, 'devref123');
});

test('B1(b) R5.2: --env prod SIN RAFAQ_CONFIRM_PROD=1 → ProdGuardError', () => {
  assert.throws(
    () => resolveTarget(['--env', 'prod'], DEV_PROD),
    (err) => {
      assert.ok(err instanceof ProdGuardError);
      assert.equal(err.reason, 'explicit-prod');
      assert.equal(err.ref, 'prodref999');
      return true;
    },
  );
});

test('B1(c) R5.3: --env prod + RAFAQ_CONFIRM_PROD=1 → target prod con ref/token correctos', () => {
  const t = resolveTarget(['--env', 'prod'], { ...DEV_PROD, RAFAQ_CONFIRM_PROD: '1' });
  assert.equal(t.env, 'prod');
  assert.equal(t.ref, 'prodref999');
  assert.equal(t.token, 'sbp_tok');
  assert.equal(t.pointsToProd, true);
  assert.equal(t.host, 'https://api.supabase.com/v1/projects/prodref999');
});

test('B1(c) --env=prod (forma con =) también resuelve prod con confirm', () => {
  const t = resolveTarget(['--env=prod'], { ...DEV_PROD, RAFAQ_CONFIRM_PROD: '1' });
  assert.equal(t.env, 'prod');
  assert.equal(t.ref, 'prodref999');
});

test('B1(d): --env inválido → Error (no ProdGuardError)', () => {
  assert.throws(
    () => resolveTarget(['--env', 'staging'], DEV_PROD),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(!(err instanceof ProdGuardError));
      assert.match(err.message, /--env inválido/);
      return true;
    },
  );
});

test('B1(e) R5.12 destino-aware: --env dev pero ref dev == ref PROD → exige confirm IGUAL', () => {
  // Slot dev mal seteado: SUPABASE_PROJECT_REF apunta al ref conocido de PROD.
  const misconfigured = { SUPABASE_PROJECT_REF: 'prodref999', SUPABASE_ACCESS_TOKEN: 'sbp_tok', SUPABASE_PROJECT_REF_PROD: 'prodref999' };
  assert.throws(
    () => resolveTarget([], misconfigured), // default dev, SIN confirm
    (err) => {
      assert.ok(err instanceof ProdGuardError);
      assert.equal(err.reason, 'destino-aware');
      assert.equal(err.ref, 'prodref999');
      return true;
    },
  );
  // Con confirm, procede (target dev, pero marcado pointsToProd).
  const t = resolveTarget([], { ...misconfigured, RAFAQ_CONFIRM_PROD: '1' });
  assert.equal(t.env, 'dev');
  assert.equal(t.pointsToProd, true);
});

test('B1(e) destino-aware por RAFAQ_KNOWN_PROD_REFS (lista): ref dev en la lista → exige confirm', () => {
  const env = { SUPABASE_PROJECT_REF: 'aaa', SUPABASE_ACCESS_TOKEN: 'tok', RAFAQ_KNOWN_PROD_REFS: 'bbb, aaa , ccc' };
  assert.throws(() => resolveTarget([], env), ProdGuardError);
});

test('R5.12: default dev con ref dev ≠ ref prod → NO exige confirm (no falso positivo)', () => {
  const t = resolveTarget([], DEV_PROD); // devref123 ≠ prodref999
  assert.equal(t.env, 'dev');
  assert.equal(t.pointsToProd, false);
});

test('R5.13: ProdGuardError NUNCA incluye el token en su mensaje', () => {
  try {
    resolveTarget(['--env', 'prod'], DEV_PROD);
    assert.fail('debía tirar');
  } catch (err) {
    assert.ok(!err.message.includes('sbp_tok'));
    assert.equal(err.token, undefined); // ni siquiera lo carga como propiedad
  }
});

test('resolveTarget: falta SUPABASE_ACCESS_TOKEN → Error (con confirm ya pasado)', () => {
  assert.throws(
    () => resolveTarget(['--env', 'prod'], { SUPABASE_PROJECT_REF_PROD: 'p', RAFAQ_CONFIRM_PROD: '1' }),
    /Falta SUPABASE_ACCESS_TOKEN/,
  );
});

test('resolveTarget: --env prod + confirm pero falta ref PROD → Error de ref (tras la guarda)', () => {
  assert.throws(
    () => resolveTarget(['--env', 'prod'], { SUPABASE_ACCESS_TOKEN: 'tok', RAFAQ_CONFIRM_PROD: '1' }),
    /Falta SUPABASE_PROJECT_REF_PROD/,
  );
});

test('parseEnvFlag: soporta --env x, --env=x, ausencia', () => {
  assert.equal(parseEnvFlag(['--env', 'prod']), 'prod');
  assert.equal(parseEnvFlag(['--env=dev']), 'dev');
  assert.equal(parseEnvFlag(['foo.sql']), undefined);
});

test('positionalArgs: descarta --env <val>, --env=val, --backfill, --out-dir <val>', () => {
  assert.deepEqual(positionalArgs(['--env', 'prod', 'file.sql']), ['file.sql']);
  assert.deepEqual(positionalArgs(['file.sql', '--env=dev']), ['file.sql']);
  assert.deepEqual(positionalArgs(['--backfill', '--env', 'dev']), []);
  assert.deepEqual(positionalArgs(['--out-dir', '/tmp/x', 'a.sql']), ['a.sql']);
});

test('knownProdRefs: une SUPABASE_PROJECT_REF_PROD + RAFAQ_KNOWN_PROD_REFS, trimmea', () => {
  const s = knownProdRefs({ SUPABASE_PROJECT_REF_PROD: ' p1 ', RAFAQ_KNOWN_PROD_REFS: 'p2, p3' });
  assert.ok(s.has('p1') && s.has('p2') && s.has('p3'));
  assert.equal(knownProdRefs({}).size, 0);
});
