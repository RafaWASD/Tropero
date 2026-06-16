// Tests del sub-estado del HERO ADAPTATIVO de la identificación de la manga (spec 03 M2.1, R3.6/R3.7).
// Cubre los 3 sub-estados de forma determinística — el 'manual' (transport==null) NO es expresable con el
// mock-adapter en web (siempre tiene transporte) → este test puro lo cubre sin device.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveListenConnState, isManualPromoted } from './maniobra-listen-state.ts';

test('CONECTADO → connected (gana siempre, el transporte existe)', () => {
  assert.equal(resolveListenConnState({ isConnected: true, conectable: true }), 'connected');
  // Defensivo: aunque conectable fuera false, si está conectado, gana 'connected'.
  assert.equal(resolveListenConnState({ isConnected: true, conectable: false }), 'connected');
});

test('DESCONECTADO + CONECTABLE → connectable (web antes de elegir puerto / bastón caído)', () => {
  assert.equal(resolveListenConnState({ isConnected: false, conectable: true }), 'connectable');
});

test('DESCONECTADO + NO CONECTABLE → manual (native manual-first)', () => {
  assert.equal(resolveListenConnState({ isConnected: false, conectable: false }), 'manual');
});

test('isManualPromoted: true SOLO en el sub-estado manual', () => {
  assert.equal(isManualPromoted({ isConnected: false, conectable: false }), true);
  assert.equal(isManualPromoted({ isConnected: false, conectable: true }), false);
  assert.equal(isManualPromoted({ isConnected: true, conectable: true }), false);
  assert.equal(isManualPromoted({ isConnected: true, conectable: false }), false);
});
