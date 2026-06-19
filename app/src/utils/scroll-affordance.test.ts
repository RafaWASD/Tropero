// Tests de la lógica PURA del affordance de scroll (spec 03 M5-CLIENTE bugfix). node:test.
// Foco: sin overflow → sin fades; arriba de todo → solo fade abajo; en el medio → ambos; al fondo → solo
// arriba; tolerancia EPS; medidas no llegadas (0/NaN/negativo) → defensivo.

import test from 'node:test';
import assert from 'node:assert/strict';

import { scrollFades, hasOverflow, SCROLL_FADE_EPS } from './scroll-affordance';

// ─── Sin overflow: el contenido cabe entero → NINGÚN fade (no hay nada oculto) ───────────────────
test('contenido que cabe en el viewport → sin fades', () => {
  assert.deepEqual(scrollFades({ scrollY: 0, viewportHeight: 500, contentHeight: 300 }), {
    top: false,
    bottom: false,
  });
  // Justo igual (con tolerancia) tampoco muestra fade.
  assert.deepEqual(scrollFades({ scrollY: 0, viewportHeight: 500, contentHeight: 500 }), {
    top: false,
    bottom: false,
  });
  assert.equal(hasOverflow({ viewportHeight: 500, contentHeight: 300 }), false);
});

// ─── Overflow, arriba de todo: SOLO fade abajo (hay más por ver hacia abajo) ─────────────────────
test('overflow + scrollY=0 → solo fade abajo', () => {
  assert.deepEqual(scrollFades({ scrollY: 0, viewportHeight: 500, contentHeight: 900 }), {
    top: false,
    bottom: true,
  });
  assert.equal(hasOverflow({ viewportHeight: 500, contentHeight: 900 }), true);
});

// ─── Overflow, scrolleado al medio: AMBOS fades (oculto arriba y abajo) ───────────────────────────
test('overflow + scrolleado al medio → ambos fades', () => {
  assert.deepEqual(scrollFades({ scrollY: 200, viewportHeight: 500, contentHeight: 900 }), {
    top: true,
    bottom: true,
  });
});

// ─── Overflow, al fondo del todo: SOLO fade arriba (ya no hay más abajo) ──────────────────────────
test('overflow + scrolleado al fondo (maxScroll) → solo fade arriba', () => {
  // maxScroll = 900 - 500 = 400.
  assert.deepEqual(scrollFades({ scrollY: 400, viewportHeight: 500, contentHeight: 900 }), {
    top: true,
    bottom: false,
  });
});

// ─── Tolerancia EPS: dentro de EPS del borde NO parpadea el fade ──────────────────────────────────
test('tolerancia EPS: a EPS del tope no muestra fade arriba; a EPS del fondo no muestra fade abajo', () => {
  // A EPS del tope (scrollY <= EPS) → sin fade arriba.
  assert.equal(scrollFades({ scrollY: SCROLL_FADE_EPS, viewportHeight: 500, contentHeight: 900 }).top, false);
  // Un poco más que EPS → sí.
  assert.equal(scrollFades({ scrollY: SCROLL_FADE_EPS + 1, viewportHeight: 500, contentHeight: 900 }).top, true);
  // A EPS del fondo (scrollY >= maxScroll - EPS) → sin fade abajo.
  const maxScroll = 900 - 500;
  assert.equal(
    scrollFades({ scrollY: maxScroll - SCROLL_FADE_EPS, viewportHeight: 500, contentHeight: 900 }).bottom,
    false,
  );
});

// ─── Defensivo: medidas que aún no llegaron (0/NaN/negativo) no crashean ni inventan fades ────────
test('medidas no llegadas (0/NaN/negativo) → defensivo, sin fades espurios', () => {
  assert.deepEqual(scrollFades({ scrollY: 0, viewportHeight: 0, contentHeight: 0 }), {
    top: false,
    bottom: false,
  });
  assert.deepEqual(scrollFades({ scrollY: NaN, viewportHeight: NaN, contentHeight: NaN }), {
    top: false,
    bottom: false,
  });
  // viewport aún 0 pero ya hay contenido → no podemos decidir overflow real → tratamos viewport como 0:
  // content > 0 → bottom true (hay algo, conservador: invita a scrollear). top false (scrollY 0).
  assert.deepEqual(scrollFades({ scrollY: -10, viewportHeight: 0, contentHeight: 800 }), {
    top: false,
    bottom: true,
  });
});
