// Tests del lockout local de login (spec 01, R1.7 / T3.5).
// Reloj inyectado (now) → determinista, sin timers reales.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_LOCKOUT,
  MAX_ATTEMPTS,
  ATTEMPT_WINDOW_MS,
  LOCKOUT_MS,
  isLockedOut,
  registerFailure,
  resetLockout,
  remainingLockMs,
  normalizeLockout,
  formatLockMinutes,
} from './lockout.ts';

test('R1.7 5 fallos en menos de 10 min bloquean por 15 min', () => {
  let state = EMPTY_LOCKOUT;
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal(isLockedOut(state, t0 + i * 1000), false, `no debería estar bloqueado tras ${i} fallos`);
    state = registerFailure(state, t0 + i * 1000);
  }
  // Tras el 5° fallo: bloqueado.
  const lockedAt = t0 + (MAX_ATTEMPTS - 1) * 1000;
  assert.equal(isLockedOut(state, lockedAt), true);
  // El bloqueo dura LOCKOUT_MS (15 min).
  assert.equal(isLockedOut(state, lockedAt + LOCKOUT_MS - 1), true);
  assert.equal(isLockedOut(state, lockedAt + LOCKOUT_MS + 1), false);
});

test('R1.7 los fallos fuera de la ventana de 10 min no acumulan', () => {
  let state = EMPTY_LOCKOUT;
  const t0 = 1_000_000;
  // 4 fallos viejos (hace > 10 min), luego 4 nuevos: NO debe bloquear (cada grupo < 5
  // dentro de su ventana).
  for (let i = 0; i < 4; i++) state = registerFailure(state, t0 + i * 1000);
  const later = t0 + ATTEMPT_WINDOW_MS + 60_000; // pasó la ventana
  for (let i = 0; i < 4; i++) state = registerFailure(state, later + i * 1000);
  assert.equal(isLockedOut(state, later + 5000), false);
});

test('R1.7 un login exitoso (resetLockout) limpia el rastro', () => {
  let state = EMPTY_LOCKOUT;
  const t0 = 2_000_000;
  for (let i = 0; i < 3; i++) state = registerFailure(state, t0 + i * 1000);
  state = resetLockout();
  assert.deepEqual(state, EMPTY_LOCKOUT);
  assert.equal(isLockedOut(state, t0), false);
});

test('registerFailure no acumula mientras ya está bloqueado', () => {
  let state = EMPTY_LOCKOUT;
  const t0 = 3_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) state = registerFailure(state, t0 + i);
  const lockedUntil = state.lockedUntil;
  // Otro fallo durante el bloqueo no extiende ni cambia el estado.
  const after = registerFailure(state, t0 + 100);
  assert.equal(after.lockedUntil, lockedUntil);
});

test('normalizeLockout levanta un bloqueo expirado al rehidratar', () => {
  const t0 = 4_000_000;
  const expired = { failures: [], lockedUntil: t0 - 1 };
  const norm = normalizeLockout(expired, t0);
  assert.equal(norm.lockedUntil, null);
  // Un bloqueo vigente se mantiene.
  const live = { failures: [], lockedUntil: t0 + 1000 };
  assert.equal(normalizeLockout(live, t0).lockedUntil, t0 + 1000);
});

test('remainingLockMs y formatLockMinutes', () => {
  const t0 = 5_000_000;
  const state = { failures: [], lockedUntil: t0 + 15 * 60 * 1000 };
  assert.equal(remainingLockMs(state, t0), 15 * 60 * 1000);
  assert.equal(remainingLockMs(state, t0 + 16 * 60 * 1000), 0);
  assert.equal(formatLockMinutes(15 * 60 * 1000), '15 minutos');
  assert.equal(formatLockMinutes(60 * 1000), '1 minuto');
  assert.equal(formatLockMinutes(1), '1 minuto'); // redondea hacia arriba, mínimo 1
});
