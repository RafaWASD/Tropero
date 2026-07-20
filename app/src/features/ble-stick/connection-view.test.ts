// Tests de la presentación PURA de la pantalla de conexión (RMV3.4/3.7/3.8/4.6). node:test, sin RN.
// Imports relativos con `.ts` (patrón de las suites ble: el `@/` alias no lo resuelve el loader de
// node:test). Cubre el mapeo estado→vista, binding→fila, y la marca "DEMO".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  connectionStatusView,
  deviceRowView,
  readingBadge,
} from './connection-view.ts';
import { RS420_DRIVER } from '../../services/ble/driver-rs420.ts';
import type { ReaderBinding } from '../../services/ble/selection-priority.ts';
import type { ConnectionStatus } from '../../services/ble/stick-adapter.ts';

// ─── RMV3.4: cada ConnectionStatus tiene label/hint/cta es-AR, no bloqueante ────────────────

test('RMV3.4: connectionStatusView cubre los 6 estados con label + hint no vacíos', () => {
  const states: ConnectionStatus[] = [
    'off',
    'permission_denied',
    'scanning',
    'connecting',
    'connected',
    'disconnected',
  ];
  for (const s of states) {
    const v = connectionStatusView(s);
    assert.ok(v.label.length > 0, `label vacío en ${s}`);
    assert.ok(v.hint.length > 0, `hint vacío en ${s}`);
    // El CTA es coherente con su label: 'none' ⇔ sin ctaLabel; los demás ⇔ con ctaLabel.
    if (v.cta === 'none') assert.equal(v.ctaLabel, null, `cta 'none' con label en ${s}`);
    else assert.ok(v.ctaLabel && v.ctaLabel.length > 0, `cta sin label en ${s}`);
  }
});

test('RMV3.4: connected → cta disconnect + connected true; off/disconnected → cta connect', () => {
  const connected = connectionStatusView('connected');
  assert.equal(connected.connected, true);
  assert.equal(connected.cta, 'disconnect');
  assert.equal(connected.tone, 'success');

  const off = connectionStatusView('off');
  assert.equal(off.connected, false);
  assert.equal(off.cta, 'connect');

  const disconnected = connectionStatusView('disconnected');
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.cta, 'connect');
});

test('RMV3.4: permission_denied → retry; en progreso (connecting/scanning) → sin CTA', () => {
  assert.equal(connectionStatusView('permission_denied').cta, 'retry');
  assert.equal(connectionStatusView('connecting').cta, 'none');
  assert.equal(connectionStatusView('connecting').ctaLabel, null);
  assert.equal(connectionStatusView('scanning').cta, 'none');
});

// ─── RMV3.7: binding available true/false → fila conectable / no-disponible ──────────────────

test('RMV3.7: binding available:true → fila conectable (actionable), con la marca del driver', () => {
  const binding: ReaderBinding = {
    adapterKind: 'web-serial',
    transportKind: 'serial',
    driver: RS420_DRIVER,
    available: true,
  };
  const row = deviceRowView({ driver: RS420_DRIVER, binding });
  assert.equal(row.state, 'recognized-available');
  assert.equal(row.actionable, true);
  assert.equal(row.title, RS420_DRIVER.displayName);
});

test('RMV3.7: binding available:false → reconocido, NO disponible, NO accionable (no intenta conectar)', () => {
  const binding: ReaderBinding = {
    adapterKind: 'spp-android',
    transportKind: 'spp',
    driver: RS420_DRIVER,
    available: false,
  };
  const row = deviceRowView({ driver: RS420_DRIVER, binding });
  assert.equal(row.state, 'recognized-unavailable');
  assert.equal(row.actionable, false);
  // Ofrece la salida manual (no bloquea, RMV3.6).
  assert.match(row.subtitle, /mano/i);
});

// ─── RMV2.5: reconocido pero sin transporte alcanzable en la plataforma (RS420 en iOS) ───────

test('RMV2.5: driver reconocido pero binding null → recognized-unreachable + manual (no bloquea)', () => {
  const row = deviceRowView({ driver: RS420_DRIVER, binding: null });
  assert.equal(row.state, 'recognized-unreachable');
  assert.equal(row.actionable, false);
  assert.match(row.subtitle, /mano/i);
});

// ─── RMV3.8: device sin driver → "no reconocido" + manual ────────────────────────────────────

test('RMV3.8: sin driver ni binding → unrecognized, usa el nombre del device y ofrece manual', () => {
  const row = deviceRowView({ driver: null, binding: null, deviceName: 'Speaker XZ' });
  assert.equal(row.state, 'unrecognized');
  assert.equal(row.actionable, false);
  assert.equal(row.title, 'Speaker XZ');
  assert.match(row.subtitle, /reconocido/i);
  assert.match(row.subtitle, /mano/i);
});

test('RMV3.8: unrecognized sin nombre → título de fallback (no vacío)', () => {
  const row = deviceRowView({ driver: null, binding: null });
  assert.equal(row.state, 'unrecognized');
  assert.ok(row.title.length > 0);
});

// ─── RMV4.6: lectura del simulador → marca "DEMO"; lectura real → sin marca ───────────────────

test('RMV4.6: readingBadge marca "DEMO" solo las lecturas del simulador', () => {
  assert.equal(readingBadge(true), 'DEMO');
  assert.equal(readingBadge(false), null);
});
