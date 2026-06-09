// Tests de la derivación del estado de sync para la UI (spec 15, T1.8 / R10.1). node:test. PURO.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSyncUiState, syncStatusLabel } from './status-derive.ts';

test('R10.1: conectado, sin flujo, cola 0 → al día', () => {
  const s = deriveSyncUiState({ connected: true, hasSynced: true, dataFlowStatus: {} }, 0);
  assert.deepEqual(s, { connected: true, syncing: false, pendingCount: 0, hasSynced: true });
  assert.equal(syncStatusLabel(s), 'Al día.');
});

test('R10.1: conectado y bajando → syncing', () => {
  const s = deriveSyncUiState({ connected: true, dataFlowStatus: { downloading: true } }, 0);
  assert.equal(s.syncing, true);
  assert.equal(syncStatusLabel(s), 'Sincronizando…');
});

test('R10.1: conectado y subiendo → syncing', () => {
  const s = deriveSyncUiState({ connected: true, dataFlowStatus: { uploading: true } }, 3);
  assert.equal(s.syncing, true);
});

test('R10.1: offline con cola pendiente → "se subirán cuando vuelva la red"', () => {
  const s = deriveSyncUiState({ connected: false }, 5);
  assert.equal(s.connected, false);
  assert.equal(s.pendingCount, 5);
  assert.match(syncStatusLabel(s), /Sin conexión/);
  assert.match(syncStatusLabel(s), /5 cambio/);
});

test('R10.1: offline sin cola → "Sin conexión."', () => {
  const s = deriveSyncUiState({ connected: false }, 0);
  assert.equal(syncStatusLabel(s), 'Sin conexión.');
});

test('conectado, al día pero con cola > 0 → "Subiendo N cambio(s)…"', () => {
  const s = deriveSyncUiState({ connected: true, dataFlowStatus: {} }, 2);
  assert.match(syncStatusLabel(s), /Subiendo 2 cambio/);
});

test('defaults seguros: status null/undefined → desconectado, sin sync, 0', () => {
  assert.deepEqual(deriveSyncUiState(null, 0), {
    connected: false,
    syncing: false,
    pendingCount: 0,
    hasSynced: false,
  });
  assert.deepEqual(deriveSyncUiState(undefined, 0), {
    connected: false,
    syncing: false,
    pendingCount: 0,
    hasSynced: false,
  });
});

test('pendingCount se clampa a ≥ 0 entero (defensivo ante valores raros)', () => {
  assert.equal(deriveSyncUiState({ connected: true }, -3).pendingCount, 0);
  assert.equal(deriveSyncUiState({ connected: true }, 2.9).pendingCount, 2);
  assert.equal(deriveSyncUiState({ connected: true }, NaN).pendingCount, 0);
});
