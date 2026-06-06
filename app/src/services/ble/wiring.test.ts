// Tests de la lógica PURA del wiring del provider/hooks (Fase 3): selección de adaptador por
// plataforma/entorno (R10.3/R11.2), permisos por transporte (R12), helpers de estado de
// conexión (R9), y forma del logging no bloqueante (R15). node:test, sin RN. El render real
// del provider/hooks (React) queda para el device/web — acá se cubre la decisión.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectTransportAdapter } from './adapter-selection.ts';
import { permissionModelFor, permissionDenialBlocksApp } from './permissions.ts';
import { isConnectedStatus, blocksManualEntry } from './connection-status.ts';
import { logTransportEvent } from './logging.ts';

// ─── R10.3 / R11.2: selección de adaptador por plataforma/entorno ───────────────────────

test('R10.2: mode="mock" fuerza el adapter-mock en cualquier plataforma', () => {
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'mock' }), 'mock');
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'mock' }), 'mock');
});

test('R10.3/R5.1: en web (auto) se monta web-serial', () => {
  assert.equal(selectTransportAdapter({ platformOS: 'web', mode: 'auto' }), 'web-serial');
});

test('R7: en native sin transporte buildable (auto), el piso es manual (spp-android es Fase 4)', () => {
  // En este run NO se elige spp-android (placeholder que tira); el manual es el único piso.
  assert.equal(selectTransportAdapter({ platformOS: 'ios', mode: 'auto' }), 'manual');
  assert.equal(selectTransportAdapter({ platformOS: 'android', mode: 'auto' }), 'manual');
});

test('R8.7: nunca se elige hid-wedge (GATED)', () => {
  for (const platformOS of ['web', 'ios', 'android']) {
    for (const mode of ['auto', 'mock'] as const) {
      assert.notEqual(selectTransportAdapter({ platformOS, mode }), 'hid-wedge');
    }
  }
});

// ─── R12: permisos por transporte ───────────────────────────────────────────────────────

test('R12.4: web-serial depende del permiso del navegador (browser)', () => {
  assert.deepEqual(permissionModelFor('web-serial'), { kind: 'browser' });
});

test('R12: manual/mock no requieren permisos', () => {
  assert.deepEqual(permissionModelFor('manual'), { kind: 'none' });
  assert.deepEqual(permissionModelFor('mock'), { kind: 'none' });
});

test('R12.1: spp-android requiere permisos bluetooth de app; R12.3: hid-wedge usa teclado del SO', () => {
  assert.deepEqual(permissionModelFor('spp-android'), { kind: 'android-bluetooth' });
  assert.deepEqual(permissionModelFor('hid-wedge'), { kind: 'os-keyboard' });
});

test('R12.5/R7.2: un permiso denegado NUNCA bloquea la app (manual-first)', () => {
  assert.equal(permissionDenialBlocksApp(), false);
});

// ─── R9: estado de conexión — helpers ───────────────────────────────────────────────────

test('R9.2: isConnectedStatus es true solo en "connected"', () => {
  assert.equal(isConnectedStatus('connected'), true);
  for (const s of ['off', 'permission_denied', 'scanning', 'connecting', 'disconnected'] as const) {
    assert.equal(isConnectedStatus(s), false);
  }
});

test('R9.6/R7.2: NINGÚN estado de conexión bloquea la carga manual', () => {
  for (const s of [
    'off',
    'permission_denied',
    'scanning',
    'connecting',
    'connected',
    'disconnected',
  ] as const) {
    assert.equal(blocksManualEntry(s), false);
  }
});

// ─── R15: logging no bloqueante ─────────────────────────────────────────────────────────

test('R15.1/R15.2: logTransportEvent nunca tira (best-effort), aun con console roto', () => {
  // No debe propagar excepción bajo ninguna forma de evento.
  assert.doesNotThrow(() => logTransportEvent({ kind: 'connection_changed', connected: true }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'eid_rejected', reason: 'parse_failed' }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'reconnect_attempt', attempt: 3 }));
  assert.doesNotThrow(() => logTransportEvent({ kind: 'read_loop_error', message: 'boom' }));

  // Aun si console.info tira, el logger se lo traga (R15.2).
  const original = console.info;
  try {
    // eslint-disable-next-line no-console
    console.info = () => {
      throw new Error('console roto');
    };
    assert.doesNotThrow(() => logTransportEvent({ kind: 'connect_error', message: 'x' }));
  } finally {
    console.info = original;
  }
});
