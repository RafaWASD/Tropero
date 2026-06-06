// Tests de la deduplicación por-TAG con ventana corta (R3). node:test + type-stripping
// nativo (sin Jest; mismo patrón que parser-rs420.test.ts). PURO: sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TagDedup, DEDUP_WINDOW_MS } from './dedup.ts';

const EID_A = '982000364696050';
const EID_B = '032010006382438';
const EID_C = '982000364696099';

test('R3.1: mismo EID dentro de la ventana (<3s) NO se re-emite', () => {
  const d = new TagDedup();
  assert.equal(d.shouldEmit(EID_A, 1000), true); // primera lectura
  assert.equal(d.shouldEmit(EID_A, 1000 + 100), false); // 100ms después → ignorado
  assert.equal(d.shouldEmit(EID_A, 1000 + DEDUP_WINDOW_MS - 1), false); // justo antes del borde
});

test('R3.1: mismo EID pasada la ventana (>3s) SÍ se re-emite', () => {
  const d = new TagDedup();
  assert.equal(d.shouldEmit(EID_A, 1000), true);
  assert.equal(d.shouldEmit(EID_A, 1000 + DEDUP_WINDOW_MS), true); // exactamente en el borde → emite
  assert.equal(d.shouldEmit(EID_A, 1000 + DEDUP_WINDOW_MS + 5000), true); // mucho después → emite
});

test('R3.2: tres EIDs DISTINTOS seguidos → tres emisiones AL INSTANTE (asignación masiva spec 09 R8)', () => {
  const d = new TagDedup();
  const now = 5000;
  // Tres bastoneos en el MISMO instante (sin avanzar el reloj): los tres pasan.
  assert.equal(d.shouldEmit(EID_A, now), true);
  assert.equal(d.shouldEmit(EID_B, now), true);
  assert.equal(d.shouldEmit(EID_C, now), true);
});

test('R3.3: la ventana es POR-TAG, no un cooldown global', () => {
  const d = new TagDedup();
  assert.equal(d.shouldEmit(EID_A, 1000), true);
  // EID_B inmediatamente después NO está bloqueado por la ventana de EID_A (no es global).
  assert.equal(d.shouldEmit(EID_B, 1000 + 1), true);
  // EID_A sí sigue bloqueado por SU propia ventana.
  assert.equal(d.shouldEmit(EID_A, 1000 + 2), false);
});

test('R3.1: la ventana se mide desde la última emisión CONFIRMADA, no desde el último intento', () => {
  const d = new TagDedup();
  assert.equal(d.shouldEmit(EID_A, 0), true);
  // Re-escaneos repetidos dentro de la ventana NO extienden la ventana (no refrescan el ts).
  assert.equal(d.shouldEmit(EID_A, 1000), false);
  assert.equal(d.shouldEmit(EID_A, 2000), false);
  // A los 3000ms desde la emisión confirmada (t=0), vuelve a emitir aunque hubo intentos en el medio.
  assert.equal(d.shouldEmit(EID_A, DEDUP_WINDOW_MS), true);
});

test('R3.4: la ventana es ajustable (constructor)', () => {
  const d = new TagDedup(500);
  assert.equal(d.shouldEmit(EID_A, 0), true);
  assert.equal(d.shouldEmit(EID_A, 400), false); // dentro de la ventana de 500ms
  assert.equal(d.shouldEmit(EID_A, 500), true); // pasada la ventana custom
});

test('reset() limpia el estado de dedup', () => {
  const d = new TagDedup();
  assert.equal(d.shouldEmit(EID_A, 1000), true);
  assert.equal(d.shouldEmit(EID_A, 1100), false);
  d.reset();
  assert.equal(d.shouldEmit(EID_A, 1100), true); // tras reset, vuelve a emitir
});
