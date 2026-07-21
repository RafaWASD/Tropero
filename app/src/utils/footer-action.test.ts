// Tests de la lógica PURA del primitivo footer-fijo con CTA (U2). node:test.
// Foco: (1) reserva de safe-area robusta con blindaje frame-0 Android (idéntico patrón a U7);
// (2) padding del footer keyboard-aware (no dejar hueco con el teclado abierto); (3) decisión del peek.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSafeBottomInset,
  resolveFooterPaddingBottom,
  shouldShowScrollPeek,
} from './footer-action.ts';

// Token real del design system (tamagui.config.ts): navBottomMin = 12.
const MIN = 12;
const inset = (liveInsetBottom: number, initialInsetBottom: number) =>
  computeSafeBottomInset({ liveInsetBottom, initialInsetBottom, minInset: MIN });

// ─── computeSafeBottomInset — reserva de safe-area ────────────────────────────────────────

test('iOS home indicator (~34) estable: reserva = 34', () => {
  assert.equal(inset(34, 34), 34);
});

test('Android frame-cero (live=0) pero arranque midió 48 (3 botones): NO colapsa al mínimo → 48', () => {
  // EL BUG que blinda: sin el piso de arranque, live=0 caería al mínimo (12) y el CTA quedaría pegado.
  assert.equal(inset(0, 48), 48);
  assert.notEqual(inset(0, 48), MIN);
});

test('Android gesture bar (~24) estable: respeta el inset real', () => {
  assert.equal(inset(24, 24), 24);
});

test('Web (initialWindowMetrics=null → 0) sin inset vigente → cae al mínimo (12)', () => {
  assert.equal(inset(0, 0), MIN);
});

test('Inset menor al mínimo (5) → gana el mínimo (12)', () => {
  assert.equal(inset(5, 5), MIN);
});

test('Toma el MAYOR entre inset vigente y de arranque (ambas direcciones)', () => {
  assert.equal(inset(48, 24), 48); // vigente creció (nav-mode cambió)
  assert.equal(inset(0, 34), 34); // frame-cero clásico: gana el de arranque
});

test('NaN / negativos / no-finitos → 0 (caen al mínimo, no rompen el layout)', () => {
  assert.equal(inset(NaN, NaN), MIN);
  assert.equal(inset(-10, -5), MIN);
  assert.equal(inset(Infinity, 0), MIN);
});

// ─── resolveFooterPaddingBottom — keyboard-aware ──────────────────────────────────────────

test('teclado CERRADO → la reserva de safe-area plena', () => {
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: false, safeInset: 34, keyboardOpenGap: 8 }), 34);
});

test('teclado ABIERTO → solo el respiro chico (la safe-area la tapa el teclado → no reservarla)', () => {
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: true, safeInset: 34, keyboardOpenGap: 8 }), 8);
  // clave: con el teclado abierto NO se reserva el safe-inset (evita el hueco de ~34px sobre el teclado).
  assert.notEqual(
    resolveFooterPaddingBottom({ keyboardVisible: true, safeInset: 34, keyboardOpenGap: 8 }),
    34,
  );
});

test('resolveFooterPaddingBottom: valores raros → 0 (no rompen)', () => {
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: false, safeInset: NaN, keyboardOpenGap: 8 }), 0);
  assert.equal(resolveFooterPaddingBottom({ keyboardVisible: true, safeInset: 34, keyboardOpenGap: -5 }), 0);
});

// ─── shouldShowScrollPeek — decisión del affordance ───────────────────────────────────────

test('body que CABE entero (sin overflow) → NO peek', () => {
  assert.equal(shouldShowScrollPeek({ scrollY: 0, viewportHeight: 800, contentHeight: 600 }), false);
});

test('body con contenido oculto abajo (arriba del fold) → peek', () => {
  assert.equal(shouldShowScrollPeek({ scrollY: 0, viewportHeight: 400, contentHeight: 1200 }), true);
});

test('scrolleado hasta el fondo → NO peek (ya no hay nada oculto abajo)', () => {
  // maxScroll = 1200 - 400 = 800; en el fondo → bottom:false.
  assert.equal(shouldShowScrollPeek({ scrollY: 800, viewportHeight: 400, contentHeight: 1200 }), false);
});

test('scroll parcial con contenido restante → peek sigue visible', () => {
  assert.equal(shouldShowScrollPeek({ scrollY: 200, viewportHeight: 400, contentHeight: 1200 }), true);
});
