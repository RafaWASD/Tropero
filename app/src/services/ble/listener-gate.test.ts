// Tests de la decisión PURA de escucha del listener del bastón (R10.5/R10.6 + delta caravana-ficha bastoneo
// RCF.6). Cubre el punto CRÍTICO de la propiedad exclusiva: un scanner acotado fuerza la escucha aunque
// busyMode esté prendido, y al liberarse la escucha vuelve exactamente a `enabled && !busy`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveListening } from './listener-gate.ts';

test('sin scanner acotado: escucha = enabled && !busy (comportamiento base R10.5/R10.6)', () => {
  assert.equal(resolveListening({ scopedScannerActive: false, enabled: true, busy: false }), true);
  // busyMode (form CREATE/EDIT abierto, o la ficha con useBusyWhileMounted) suspende la escucha.
  assert.equal(resolveListening({ scopedScannerActive: false, enabled: true, busy: true }), false);
  // disabled (MODO MANIOBRAS suspendió el listener global) suspende la escucha.
  assert.equal(resolveListening({ scopedScannerActive: false, enabled: false, busy: false }), false);
  assert.equal(resolveListening({ scopedScannerActive: false, enabled: false, busy: true }), false);
});

test('RCF.6: un scanner acotado FUERZA la escucha aunque busyMode esté prendido (des-suspende para SÍ)', () => {
  // La ficha suspende el listener global (busy=true); el sheet de bastoneo abre su scanner acotado → escucha.
  assert.equal(resolveListening({ scopedScannerActive: true, enabled: true, busy: true }), true);
  // Gana incluso si el listener global estaba disabled (defensa: el scanner acotado es dueño exclusivo).
  assert.equal(resolveListening({ scopedScannerActive: true, enabled: false, busy: true }), true);
  assert.equal(resolveListening({ scopedScannerActive: true, enabled: false, busy: false }), true);
  assert.equal(resolveListening({ scopedScannerActive: true, enabled: true, busy: false }), true);
});

test('RCF.6 invariante: al LIBERAR el scanner acotado, la escucha vuelve a `enabled && !busy`', () => {
  // Con la ficha (busy=true) y el scanner liberado → la escucha se RE-SUSPENDE sola (no queda colgada).
  const withScanner = resolveListening({ scopedScannerActive: true, enabled: true, busy: true });
  const released = resolveListening({ scopedScannerActive: false, enabled: true, busy: true });
  assert.equal(withScanner, true);
  assert.equal(released, false); // un bastonazo posterior en la ficha no dispara nada, como antes de abrir el sheet
});
