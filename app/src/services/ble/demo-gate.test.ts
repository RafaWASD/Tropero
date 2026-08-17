// Tests del GATE DEMO (RMV4.4/4.5, triple-guard 2). node:test, PURO. El gate es
// `isDemoMode() = marca global && (dev || build de demo explícito)`. En node `__DEV__` no está
// declarado y expo-constants no está → el "build allowed" lo maneja SOLO `__DEV__`, que los
// tests simulan seteando `globalThis.__DEV__`. Se limpian los globals tras cada caso (no leak).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDemoMode, isDemoBuildAllowed, BLE_DEMO_GLOBAL_KEY } from './demo-gate.ts';

const g = globalThis as Record<string, unknown>;

const E2E_KEY = '__MITROPERO_BLE_E2E__';
const E2E_ALLOW_KEY = '__MITROPERO_BLE_DEMO_ALLOW_E2E__';

/**
 * Corre `fn` con la marca demo, `__DEV__`, y las marcas de E2E en el estado pedido, y limpia TODO
 * después (incl. las de E2E → sin leak entre casos: un caso que setea `__MITROPERO_BLE_E2E__` no puede
 * ensuciar el "prod-safe" del siguiente). `undefined` = la marca NO existe (delete).
 */
function withEnv(
  opts: { mark?: boolean; dev?: boolean; e2e?: boolean; e2eAllow?: boolean },
  fn: () => void,
): void {
  const keys = [BLE_DEMO_GLOBAL_KEY, '__DEV__', E2E_KEY, E2E_ALLOW_KEY] as const;
  const next = [opts.mark, opts.dev, opts.e2e, opts.e2eAllow];
  const had = keys.map((k) => k in g);
  const prev = keys.map((k) => g[k]);
  try {
    keys.forEach((k, i) => {
      if (next[i] === undefined) delete g[k];
      else g[k] = next[i];
    });
    fn();
  } finally {
    keys.forEach((k, i) => {
      if (had[i]) g[k] = prev[i];
      else delete g[k];
    });
  }
}

// ─── RMV4.4: sin marca → false (aunque sea dev) ─────────────────────────────────────────────

test('RMV4.4: sin la marca global __MITROPERO_BLE_DEMO__ → isDemoMode() false (aun en dev)', () => {
  withEnv({ mark: undefined, dev: true }, () => {
    assert.equal(isDemoMode(), false);
  });
});

// ─── RMV4.4: con marca + dev → true ─────────────────────────────────────────────────────────

test('RMV4.4: con la marca + __DEV__ true → isDemoMode() true', () => {
  withEnv({ mark: true, dev: true }, () => {
    assert.equal(isDemoBuildAllowed(), true);
    assert.equal(isDemoMode(), true);
  });
});

// ─── RMV4.4: con marca pero en PROD (sin dev, sin build de demo) → false (prod-safe) ────────

test('RMV4.4/RMV4.7: con la marca pero __DEV__ false y sin build de demo → isDemoMode() false (prod-safe)', () => {
  withEnv({ mark: true, dev: false }, () => {
    // isDemoBuildAllowed = dev(false) || explicitDemoBuild(false en node: expo-constants no está) = false
    assert.equal(isDemoBuildAllowed(), false);
    assert.equal(isDemoMode(), false);
  });
});

test('RMV4.4/RMV4.7: con la marca y __DEV__ ausente (prod típico) → isDemoMode() false', () => {
  withEnv({ mark: true, dev: undefined }, () => {
    assert.equal(isDemoMode(), false);
  });
});

// ─── Refinamiento E2E/captura: __MITROPERO_BLE_E2E__ (no-prod) habilita el "build allowed" ──────────

test('E2E: con la marca + __MITROPERO_BLE_E2E__ (sin dev, sin build de demo) → allowed true → isDemoMode true', () => {
  withEnv({ mark: true, dev: false, e2e: true }, () => {
    assert.equal(isDemoBuildAllowed(), true);
    assert.equal(isDemoMode(), true);
  });
});

test('E2E: __MITROPERO_BLE_E2E__ SIN la marca demo → isDemoMode false (regresión E2E normal: cae a mock/manual)', () => {
  withEnv({ mark: undefined, dev: false, e2e: true }, () => {
    // El build queda "allowed" (contexto E2E) pero sin __MITROPERO_BLE_DEMO__ NO es modo demo → el host
    // no elige 'demo' y la corrida E2E normal sigue en mock/manual (regresión intacta).
    assert.equal(isDemoBuildAllowed(), true);
    assert.equal(isDemoMode(), false);
  });
});

test('E2E: override __MITROPERO_BLE_DEMO_ALLOW_E2E__ = false anula el allow aun bajo __MITROPERO_BLE_E2E__', () => {
  withEnv({ mark: true, dev: false, e2e: true, e2eAllow: false }, () => {
    assert.equal(isDemoBuildAllowed(), false);
    assert.equal(isDemoMode(), false);
  });
});

// ─── RMV4.7: PRODUCCIÓN sin NINGÚN flag → false (prod-safe, la garantía dura) ────────────────

test('RMV4.7: producción sin ningún flag (mark/dev/e2e ausentes) → isDemoBuildAllowed y isDemoMode false', () => {
  withEnv({ mark: undefined, dev: undefined, e2e: undefined, e2eAllow: undefined }, () => {
    assert.equal(isDemoBuildAllowed(), false);
    assert.equal(isDemoMode(), false);
  });
  // Aun con la marca demo puesta, sin dev/build-demo/e2e el build no la permite → simulador imposible.
  withEnv({ mark: true, dev: undefined, e2e: undefined, e2eAllow: undefined }, () => {
    assert.equal(isDemoMode(), false);
  });
});

// ─── RMV4.4: la marca debe ser exactamente true (no truthy) ─────────────────────────────────

test('RMV4.4: la marca solo cuenta si es === true (no un truthy como 1 o "x")', () => {
  withEnv({ dev: true }, () => {
    g[BLE_DEMO_GLOBAL_KEY] = 1;
    assert.equal(isDemoMode(), false);
    g[BLE_DEMO_GLOBAL_KEY] = 'true';
    assert.equal(isDemoMode(), false);
    g[BLE_DEMO_GLOBAL_KEY] = true;
    assert.equal(isDemoMode(), true);
  });
});
