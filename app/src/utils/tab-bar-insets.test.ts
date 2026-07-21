// Tests del cálculo PURO del alto/paddingBottom del bottom-nav (bugfix U7). node:test.
// Foco: el navbar respeta la safe area inferior en TODAS las plataformas y — el bug — NO
// queda pegado a la barra del sistema en Android cuando el inset vigente aún es 0 (frame-cero
// del SafeAreaProvider sin sembrar): ahí el PISO es el inset medido al arranque (initialWindowMetrics).

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTabBarInsetLayout } from './tab-bar-insets.ts';

// Tokens reales del design system (tamagui.config.ts): navBar=60, navBottomMin=12.
const NAV_HEIGHT = 60;
const NAV_MIN = 12;

const layout = (liveInsetBottom: number, initialInsetBottom: number) =>
  computeTabBarInsetLayout({ liveInsetBottom, initialInsetBottom, navHeight: NAV_HEIGHT, navBottomMin: NAV_MIN });

// ─── iOS: sin regresión (era "impecable") ───────────────────────────────────────────────

test('iOS home indicator (~34): padding = inset, height = navBar + inset', () => {
  const { height, paddingBottom } = layout(34, 34);
  assert.equal(paddingBottom, 34);
  assert.equal(height, NAV_HEIGHT + 34); // 94
});

// ─── Android edge-to-edge: EL BUG U7 ─────────────────────────────────────────────────────

test('Android frame-cero (live=0) pero arranque midió 48 (3 botones): NO colapsa al mínimo → padding 48', () => {
  const { height, paddingBottom } = layout(0, 48);
  assert.equal(paddingBottom, 48); // el fix: NO 12 (que dejaba el nav pegado a la barra)
  assert.equal(height, NAV_HEIGHT + 48); // 108
  assert.notEqual(paddingBottom, NAV_MIN);
});

test('Android gesture bar (~24) estable: respeta el inset real', () => {
  const { height, paddingBottom } = layout(24, 24);
  assert.equal(paddingBottom, 24);
  assert.equal(height, NAV_HEIGHT + 24); // 84
});

test('Android: el inset vigente resuelve DESPUÉS del arranque → coincide con el piso (sin salto)', () => {
  // arranque midió 48; una vez que el provider async reporta 48, el max sigue dando 48.
  assert.equal(layout(0, 48).paddingBottom, 48);
  assert.equal(layout(48, 48).paddingBottom, 48);
});

test('Android: frame-cero con inset de arranque chico (gesture 24) → 24, no el mínimo 12', () => {
  assert.equal(layout(0, 24).paddingBottom, 24);
});

// ─── Web / Android viejo con botones físicos: mínimo de respiro ─────────────────────────

test('Web (initialWindowMetrics=null → 0) y sin inset vigente → cae al mínimo (12), sin cambio vs. original', () => {
  const { height, paddingBottom } = layout(0, 0);
  assert.equal(paddingBottom, NAV_MIN); // 12
  assert.equal(height, NAV_HEIGHT + NAV_MIN); // 72
});

test('Inset menor al mínimo (ej. 5) → gana el mínimo (12)', () => {
  assert.equal(layout(5, 5).paddingBottom, NAV_MIN);
});

// ─── Robustez: el max entre live e inicial, y guardas de valores raros ──────────────────

test('Toma el MAYOR entre inset vigente y de arranque (live > inicial)', () => {
  // nav-mode cambió a uno más grande en vivo: gana el vigente (no sub-padea).
  assert.equal(layout(48, 24).paddingBottom, 48);
});

test('Toma el MAYOR entre inset vigente y de arranque (inicial > live)', () => {
  // frame-cero clásico: el vigente aún no llegó, gana el de arranque.
  assert.equal(layout(0, 34).paddingBottom, 34);
});

test('NaN / negativos / no-finitos se tratan como 0 (no rompen el layout)', () => {
  assert.equal(layout(NaN, NaN).paddingBottom, NAV_MIN);
  assert.equal(layout(-10, -5).paddingBottom, NAV_MIN);
  assert.equal(layout(Infinity, 0).paddingBottom, NAV_MIN);
  // navHeight/navBottomMin raros no producen NaN en height.
  const { height, paddingBottom } = computeTabBarInsetLayout({
    liveInsetBottom: 40,
    initialInsetBottom: 40,
    navHeight: NaN,
    navBottomMin: NaN,
  });
  assert.equal(paddingBottom, 40);
  assert.equal(height, 40); // navHeight NaN → 0, + 40
  assert.ok(Number.isFinite(height));
});

test('height = navHeight + paddingBottom SIEMPRE (el contenido del nav no se come el padding)', () => {
  for (const [live, init] of [[0, 0], [0, 48], [34, 34], [24, 24], [5, 5]] as const) {
    const { height, paddingBottom } = layout(live, init);
    assert.equal(height - paddingBottom, NAV_HEIGHT);
  }
});
