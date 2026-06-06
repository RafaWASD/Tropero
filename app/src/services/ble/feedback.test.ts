// Tests de la DECISIÓN de feedback (R4.1, R4.2, R4.5) + de la preferencia de beep (R4.3).
// node:test, PURO: se testea decideFeedback/parseBeepPref (sin RN); el EFECTO físico
// (playFeedback / Vibration / Web Audio) NO se testea en CI (necesita device/browser).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideFeedback, parseBeepPref, BEEP_DEFAULT_ENABLED } from './feedback-logic.ts';

// ─── R4.1 / R4.2 / R4.5: decisión de canales ────────────────────────────────────────────

test('R4.1: en native la vibración se dispara SIEMPRE, con beep ON y con beep OFF', () => {
  assert.equal(decideFeedback('native', true).vibrate, true);
  assert.equal(decideFeedback('native', false).vibrate, true); // apagar el beep no apaga la vibración
});

test('R4.5: en web la vibración se degrada en silencio (no se dispara)', () => {
  assert.equal(decideFeedback('web', true).vibrate, false);
  assert.equal(decideFeedback('web', false).vibrate, false);
});

test('R4.2/R4.3: el beep se dispara SOLO con la preferencia habilitada', () => {
  assert.equal(decideFeedback('native', true).beep, true);
  assert.equal(decideFeedback('native', false).beep, false);
  assert.equal(decideFeedback('web', true).beep, true);
  assert.equal(decideFeedback('web', false).beep, false);
});

test('R4.5: el canal del beep es web-audio en web y native en device; null si el beep está OFF', () => {
  assert.equal(decideFeedback('web', true).beepChannel, 'web-audio');
  assert.equal(decideFeedback('native', true).beepChannel, 'native');
  assert.equal(decideFeedback('web', false).beepChannel, null);
  assert.equal(decideFeedback('native', false).beepChannel, null);
});

// ─── R4.3: preferencia de beep persistida (lógica pura del parseo) ──────────────────────

test('R4.3: el beep está ON por defecto (sin valor persistido)', () => {
  assert.equal(BEEP_DEFAULT_ENABLED, true);
  assert.equal(parseBeepPref(null), true);
  assert.equal(parseBeepPref(''), true); // valor inesperado → default
  assert.equal(parseBeepPref('garbage'), true); // storage corrupto → default (defensivo)
});

test('R4.3: el flag persistido se interpreta como booleano (1=ON, 0=OFF)', () => {
  assert.equal(parseBeepPref('1'), true);
  assert.equal(parseBeepPref('0'), false);
});
