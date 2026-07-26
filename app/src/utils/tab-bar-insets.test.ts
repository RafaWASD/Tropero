// Tests del cálculo PURO del alto del bottom-nav (bugfix U7 + unidad «aire»). node:test.
//
// La RESERVA inferior ya no se calcula acá: la calcula `computeSafeBottomInset` (una sola fórmula para
// el nav, los footers y los sheets — tests en footer-action.test.ts) y este módulo solo la compone con
// el alto de contenido del nav. Lo que se testea acá:
//   (a) el contrato `height = navHeight + paddingBottom` (el padding vive POR DEBAJO del contenido, así
//       los íconos/labels nunca quedan tapados ni el bar "flota");
//   (b) que la reserva pase TAL CUAL, sin re-tocarla (si alguien vuelve a meter un `max` o un `+ gap`
//       acá, el nav se desincroniza de los footers y del pill del bastón);
//   (c) robustez ante valores raros.
// Los valores de la tabla de la decisión (web 12 · iOS 34 · Android 3 botones 64) se verifican como
// composición, con la reserva que produce la pura compartida.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSafeBottomInset } from './footer-action.ts';
import { computeTabBarInsetLayout } from './tab-bar-insets.ts';

// Tokens reales del design system (tamagui.config.ts): navBar=60, navBottomMin=12, navBarGap=16.
const NAV_HEIGHT = 60;
const PISO = 12;
const GAP = 16;

const layout = (safeBottomInset: number) =>
  computeTabBarInsetLayout({ navHeight: NAV_HEIGHT, safeBottomInset });

/** La reserva compartida tal como la produce el hook, por plataforma. */
const reserve = (liveInsetBottom: number, initialInsetBottom: number, applyGap: boolean) =>
  computeSafeBottomInset({
    liveInsetBottom,
    initialInsetBottom,
    minInset: PISO,
    gap: GAP,
    applyGap,
  });

// ─── El contrato de composición ──────────────────────────────────────────────────────────

test('el paddingBottom es la reserva compartida TAL CUAL (el nav no la re-calcula)', () => {
  for (const r of [0, 12, 34, 40, 64, 96]) {
    assert.equal(layout(r).paddingBottom, r);
  }
});

test('height = navHeight + paddingBottom SIEMPRE (el contenido del nav no se come el padding)', () => {
  for (const r of [0, 12, 34, 40, 64]) {
    const { height, paddingBottom } = layout(r);
    assert.equal(height - paddingBottom, NAV_HEIGHT);
  }
});

// ─── La tabla de la decisión, compuesta con la reserva real ──────────────────────────────

test('REGRESIÓN del bug 🔴 — Android 3 botones (inset 48): padding 64, ESTRICTAMENTE mayor que el inset', () => {
  // Con `max(insets.bottom, mínimo=12)` el padding daba 48 = exactamente la barra de navegación → el
  // nav quedaba soldado a su borde (medido en device: 1dp). Cualquier vuelta a un `max` cae acá.
  const { height, paddingBottom } = layout(reserve(48, 48, true));
  assert.equal(paddingBottom, 64);
  assert.ok(paddingBottom > 48, 'el nav DEBE dejar aire por encima de la barra de navegación Android');
  assert.equal(height, NAV_HEIGHT + 64); // 124
});

test('REGRESIÓN de la aditiva-en-todas-las-plataformas: iOS queda en 34 (nav 94pt), NO en 50 (110pt)', () => {
  // El inset de 34pt de iOS ya ES el aire (espacio pintado con el fondo de la app + home indicator
  // fino). Sumarle el gap hacía la tab bar 110pt: 33% más alta que la nativa de iOS. Descartado.
  const { height, paddingBottom } = layout(reserve(34, 34, false));
  assert.equal(paddingBottom, 34);
  assert.equal(height, NAV_HEIGHT + 34); // 94, igual que antes de esta unidad
  assert.notEqual(height, NAV_HEIGHT + 34 + GAP);
});

test('REGRESIÓN del piso perdido: web → padding 12 (nav 72), NO 16', () => {
  const { height, paddingBottom } = layout(reserve(0, 0, false));
  assert.equal(paddingBottom, PISO);
  assert.equal(height, NAV_HEIGHT + PISO); // 72, igual que antes de esta unidad
});

test('Android gesture bar (~24): 24 + 16 = 40 → nav de 100', () => {
  const { height, paddingBottom } = layout(reserve(24, 24, true));
  assert.equal(paddingBottom, 40);
  assert.equal(height, NAV_HEIGHT + 40);
});

// ─── Android edge-to-edge: blindaje frame-cero (U7), conservado ──────────────────────────

test('Android frame-cero (live=0) pero arranque midió 48: usa el de arranque → padding 64, sin salto', () => {
  assert.equal(layout(reserve(0, 48, true)).paddingBottom, 64);
  assert.equal(layout(reserve(48, 48, true)).paddingBottom, 64); // mismo valor cuando el vigente resuelve
});

test('Android frame-cero con gesture bar (24) → 40', () => {
  assert.equal(layout(reserve(0, 24, true)).paddingBottom, 40);
});

// ─── Robustez ────────────────────────────────────────────────────────────────────────────

test('NaN / negativos / no-finitos se tratan como 0 (no rompen el layout)', () => {
  assert.equal(layout(NaN).paddingBottom, 0);
  assert.equal(layout(-10).paddingBottom, 0);
  assert.equal(layout(Infinity).paddingBottom, 0);
  const { height, paddingBottom } = computeTabBarInsetLayout({ navHeight: NaN, safeBottomInset: 40 });
  assert.equal(paddingBottom, 40);
  assert.equal(height, 40); // navHeight NaN → 0
  assert.ok(Number.isFinite(height));
});
