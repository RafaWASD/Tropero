// Tests de la presentación PURA del BleConnectionChip (spec 09 chunk BLE global, RB8.2) + de la
// DECISIÓN DE EXISTENCIA del chip (bugfix 2026-07-29). node:test, sin RN, sin lucide (por eso la vista
// devuelve una CLAVE de ícono y no el componente). Import relativo con `.ts` (patrón de las suites ble:
// el alias `@/` no lo resuelve el loader de node:test).
//
// EL BUG QUE FIJA ESTE ARCHIVO — reporte de Raf en device Android: *"el botón de conectar bastón en
// android no me está funcionando"*. En native no hay adapter de transporte construido (react-native-ble-plx
// no está instalado; `selectTransportAdapter` devuelve 'manual' → `instantiateTransport` devuelve null),
// así que el chip renderizaba "Conectar bastón" y su tap llamaba `transport?.connect()` sobre `null`: un
// no-op silencioso. Un significante que promete una acción que no puede cumplir. Ahora, sin transporte,
// el chip NO EXISTE. La condición es "no hay transporte", NO "es Android".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bleConnectionView } from './ble-connection-view.ts';
import type { ConnectionStatus } from '../services/ble/stick-adapter.ts';

/** Union COMPLETA de ConnectionStatus: ninguna rama se prueba sobre un subconjunto. */
const ALL_STATES: ConnectionStatus[] = [
  'off',
  'permission_denied',
  'scanning',
  'connecting',
  'connected',
  'disconnected',
];

const WITH_TRANSPORT = { hasTransport: true } as const;
const NO_TRANSPORT = { hasTransport: false } as const;

// ─── BUGFIX: sin transporte, el chip no existe ───────────────────────────────────────────────

test('sin transporte: el chip NO se renderiza en NINGUNO de los 6 estados (view === null)', () => {
  for (const s of ALL_STATES) {
    assert.equal(
      bleConnectionView(s, NO_TRANSPORT),
      null,
      `sin transporte, el estado ${s} devolvió una vista (el chip se renderizaría)`,
    );
  }
});

test('sin transporte gana sobre el status: el "connected" transitorio tampoco renderiza chip', () => {
  // Caso de borde real: el transporte se desmonta en caliente (cambio de `mode` del provider) y el
  // status previo queda pegado un render. El corte va ANTES del switch → no queda un chip huérfano
  // afirmando "Bastón conectado" sin transporte detrás.
  assert.equal(bleConnectionView('connected', NO_TRANSPORT), null);
  assert.equal(bleConnectionView('disconnected', NO_TRANSPORT), null);
});

// ─── RB8.2: CON transporte, el chip es EXACTAMENTE el de antes (web no se toca) ───────────────

test('RB8.2: con transporte, los 6 estados devuelven vista con label no vacío + ícono + token', () => {
  const tokens = new Set(['$textMuted', '$primary', '$terracota']);
  const icons = new Set(['bluetooth', 'bluetooth-connected', 'bluetooth-searching', 'alert']);
  for (const s of ALL_STATES) {
    const v = bleConnectionView(s, WITH_TRANSPORT);
    assert.notEqual(v, null, `con transporte, ${s} no devolvió vista`);
    assert.ok(v!.label.length > 0, `label vacío en ${s}`);
    assert.ok(tokens.has(v!.colorToken), `token fuera del DS en ${s}: ${v!.colorToken}`);
    assert.ok(icons.has(v!.icon), `ícono desconocido en ${s}: ${v!.icon}`);
  }
});

test('regresión web: con transporte, el mapeo estado→(label, ícono, token, connected) no cambió', () => {
  // El fix NO puede tocar web (ahí el transporte SIEMPRE existe: web-serial). Estos son los mismos
  // valores que antes del bugfix; `maniobra-identify.spec.ts` asserta dos de estos labels en el E2E.
  const expected: Record<
    ConnectionStatus,
    { label: string; icon: string; colorToken: string; connected: boolean }
  > = {
    connected: { label: 'Bastón conectado', icon: 'bluetooth-connected', colorToken: '$primary', connected: true },
    connecting: { label: 'Conectando…', icon: 'bluetooth-searching', colorToken: '$primary', connected: false },
    scanning: { label: 'Reintentando…', icon: 'bluetooth-searching', colorToken: '$terracota', connected: false },
    disconnected: { label: 'Bastón desconectado', icon: 'bluetooth', colorToken: '$terracota', connected: false },
    permission_denied: { label: 'Sin permiso', icon: 'alert', colorToken: '$terracota', connected: false },
    off: { label: 'Conectar bastón', icon: 'bluetooth', colorToken: '$textMuted', connected: false },
  };
  for (const s of ALL_STATES) {
    assert.deepEqual(bleConnectionView(s, WITH_TRANSPORT), expected[s], `el chip cambió en ${s}`);
  }
});

test('RB8.2: solo "connected" se declara conectado (el tap del chip no dispara connect ahí)', () => {
  for (const s of ALL_STATES) {
    const v = bleConnectionView(s, WITH_TRANSPORT);
    assert.equal(v!.connected, s === 'connected', `connected mal derivado en ${s}`);
  }
});
