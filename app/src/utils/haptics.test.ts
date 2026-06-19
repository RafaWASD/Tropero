// Tests del helper de feedback háptico (spec 03 M1.4 + M6). node:test.
// Foco: las funciones NUNCA crashean aunque `react-native` (Vibration) no exista en el entorno de test
// (Node sin RN) — degradan en silencio (web-safe / best-effort, R4.5 generaliza). No verificamos que
// vibre (no hay device en node:test); verificamos que la API es no-op segura.

import test from 'node:test';
import assert from 'node:assert/strict';

import { hapticDrop, hapticPickUp, hapticTick } from './haptics';

test('hapticPickUp / hapticDrop / hapticTick: no crashean sin Vibration (degradan en silencio)', () => {
  assert.doesNotThrow(() => hapticPickUp());
  assert.doesNotThrow(() => hapticDrop());
  assert.doesNotThrow(() => hapticTick());
});

test('hapticTick: idempotente / repetible (se dispara una vez por celda en un fling)', () => {
  assert.doesNotThrow(() => {
    for (let i = 0; i < 50; i += 1) hapticTick();
  });
});
