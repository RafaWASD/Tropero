// Tests de la lógica PURA del auto-scroll del drag de reorder (spec 03 R1.12, bugfix "se va al fondo").
// node:test. Foco: la región que ENTRA en el viewport no scrollea nada (el bug reportado por Raf: la página
// volaba al fondo de TODO el contenido); la región larga avanza hasta revelar su fondo CON aire y ahí corta;
// simétrico hacia arriba + piso duro de offset 0; medidas ausentes/no finitas → 0 (nunca sin tope).
//
// Convención de la geometría de los casos (mobile 412×915, la del capture config):
//   viewportTop = 120, viewportHeight = 600 → viewportBottom = 720.

import test from 'node:test';
import assert from 'node:assert/strict';

import { autoScrollDelta, type ReorderAutoScrollInput } from './reorder-autoscroll';

const VIEWPORT_TOP = 120;
const VIEWPORT_HEIGHT = 600;
const VIEWPORT_BOTTOM = VIEWPORT_TOP + VIEWPORT_HEIGHT; // 720
const SPEED = 9;
const MARGIN = 24;
const ROW = 80; // ROW_HEIGHT de la lista

function input(over: Partial<ReorderAutoScrollInput> = {}): ReorderAutoScrollInput {
  return {
    dir: 1,
    speed: SPEED,
    regionTop: VIEWPORT_TOP,
    regionHeight: 3 * ROW,
    viewportTop: VIEWPORT_TOP,
    viewportHeight: VIEWPORT_HEIGHT,
    currentOffset: 0,
    margin: MARGIN,
    ...over,
  };
}

// ─── EL BUG: región que YA entra entera en el viewport → NO se scrollea (ni abajo ni arriba) ──────
test('región más chica que el viewport y visible con aire → delta 0 en ambas direcciones', () => {
  // 3 filas (240px) bien adentro del viewport (aire arriba y abajo): no hay NADA que revelar.
  const g = input({ regionTop: VIEWPORT_TOP + 100, regionHeight: 3 * ROW });
  assert.equal(autoScrollDelta({ ...g, dir: 1 }), 0);
  assert.equal(autoScrollDelta({ ...g, dir: -1, currentOffset: 400 }), 0);
});

test('región pegada al tope del viewport → sube SOLO el margen (aire sobre la 1ra fila), no más', () => {
  // Simétrico al corte de abajo: el aire también aplica arriba (deja ver el rótulo "En la jornada"),
  // y una vez conseguido corta. 24px de aire = 3 frames a 9px/frame.
  const g = input({ dir: -1, regionTop: VIEWPORT_TOP, regionHeight: 3 * ROW, currentOffset: 400 });
  assert.equal(autoScrollDelta(g), -SPEED);
  assert.equal(autoScrollDelta({ ...g, regionTop: VIEWPORT_TOP + MARGIN }), 0);
});

test('región de 5 filas que entra entera (el caso reportado: grip de la nº5 cerca del borde) → delta 0', () => {
  // 5 filas = 400px dentro de un viewport de 600 → el fondo de la región está a la vista con aire de sobra.
  const g = input({ dir: 1, regionHeight: 5 * ROW, regionTop: VIEWPORT_TOP + 40 });
  assert.equal(autoScrollDelta(g), 0);
});

// ─── Región larga con el fondo FUERA de pantalla → avanza (revelar es legítimo) ───────────────────
test('fondo de la región fuera de pantalla → avanza a `speed`', () => {
  // 9 filas = 720px desde el tope del viewport → el fondo cae 120px por debajo del viewport.
  const g = input({ dir: 1, regionHeight: 9 * ROW });
  assert.equal(autoScrollDelta(g), SPEED);
});

test('el ítem en el último slot NO gatea el auto-scroll: mientras quede región oculta, sigue revelando', () => {
  // (Regresión de la decisión de diseño: el corte es por VISIBILIDAD de la región, no por los bounds del
  // ítem arrastrado — el input de la función ni siquiera conoce al ítem.)
  const g = input({ dir: 1, regionHeight: 12 * ROW });
  assert.equal(autoScrollDelta(g), SPEED);
});

// ─── El último paso se recorta al remanente: aterriza con `margin` de aire, sin overshoot ────────
test('remanente menor que la velocidad → avanza solo lo que falta (sin overshoot)', () => {
  // Queremos que falten 5px: regionBottom + margin - viewportBottom = 5.
  const regionHeight = 9 * ROW;
  const regionTop = VIEWPORT_BOTTOM + 5 - MARGIN - regionHeight;
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop, regionHeight })), 5);
});

test('fondo de la región ya visible CON el margen → corta (0), no un frame más', () => {
  const regionHeight = 9 * ROW;
  // Fondo exactamente a `margin` del borde inferior del viewport → remanente 0.
  const regionTop = VIEWPORT_BOTTOM - MARGIN - regionHeight;
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop, regionHeight })), 0);
  // Un pelo más arriba (ya sobra aire) → sigue en 0, nunca negativo.
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop: regionTop - 30, regionHeight })), 0);
});

test('el margen es lo que deja la última fila con AIRE: sin margen cortaría con la fila pegada al borde', () => {
  const regionHeight = 9 * ROW;
  const regionTop = VIEWPORT_BOTTOM - regionHeight; // fondo EXACTAMENTE en el borde inferior del viewport
  // Sin margen: ya está "revelada" → corta con la última fila al ras del borde (lo que NO queremos).
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop, regionHeight, margin: 0 })), 0);
  // Con margen: sigue scrolleando hasta despegarla del borde (acá el remanente es el margen entero).
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop, regionHeight, margin: 5 })), 5);
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop, regionHeight, margin: MARGIN })), SPEED);
});

// ─── Borde SUPERIOR: simétrico + piso duro en offset 0 ───────────────────────────────────────────
test('tope de la región por encima del viewport → sube a `speed`', () => {
  const g = input({ dir: -1, regionTop: VIEWPORT_TOP - 300, regionHeight: 9 * ROW, currentOffset: 500 });
  assert.equal(autoScrollDelta(g), -SPEED);
});

test('tope de la región ya visible con su margen → corta (0)', () => {
  const regionTop = VIEWPORT_TOP + MARGIN;
  assert.equal(
    autoScrollDelta(input({ dir: -1, regionTop, regionHeight: 9 * ROW, currentOffset: 500 })),
    0,
  );
  // Con la región ya bien adentro del viewport tampoco sube.
  assert.equal(
    autoScrollDelta(input({ dir: -1, regionTop: regionTop + 200, regionHeight: 9 * ROW, currentOffset: 500 })),
    0,
  );
});

test('remanente hacia arriba menor que la velocidad → sube solo lo que falta', () => {
  // Falta 4px: viewportTop - (regionTop - margin) = 4.
  const regionTop = VIEWPORT_TOP + MARGIN - 4;
  assert.equal(autoScrollDelta(input({ dir: -1, regionTop, regionHeight: 9 * ROW, currentOffset: 500 })), -4);
});

test('offset 0 (o imposible/negativo) → nunca scrollea a offset negativo', () => {
  const g = input({ dir: -1, regionTop: VIEWPORT_TOP - 300, regionHeight: 9 * ROW });
  assert.equal(autoScrollDelta({ ...g, currentOffset: 0 }), 0);
  assert.equal(autoScrollDelta({ ...g, currentOffset: -50 }), 0);
  // Con 3px de offset disponible, sube solo esos 3 (el resto lo come el piso).
  assert.equal(autoScrollDelta({ ...g, currentOffset: 3 }), -3);
  assert.equal(Object.is(autoScrollDelta({ ...g, currentOffset: 0 }), -0), false);
});

// ─── Guardas defensivas: sin medida NO se auto-scrollea (jamás se cae al comportamiento sin tope) ─
test('dirección 0 (dedo fuera de las zonas de borde) → 0', () => {
  assert.equal(autoScrollDelta(input({ dir: 0, regionHeight: 12 * ROW })), 0);
});

test('viewport sin medir (0/NaN) → 0', () => {
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: 12 * ROW, viewportHeight: 0 })), 0);
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: 12 * ROW, viewportHeight: Number.NaN })), 0);
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: 12 * ROW, viewportTop: Number.NaN })), 0);
});

test('región sin medir (measure() null → NaN/0) → 0', () => {
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop: Number.NaN, regionHeight: 12 * ROW })), 0);
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: 0 })), 0);
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: Number.NaN })), 0);
  assert.equal(autoScrollDelta(input({ dir: -1, regionTop: Number.NaN, currentOffset: 500 })), 0);
});

test('velocidad inválida → 0', () => {
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: 12 * ROW, speed: 0 })), 0);
  assert.equal(autoScrollDelta(input({ dir: 1, regionHeight: 12 * ROW, speed: Number.NaN })), 0);
});

test('margen no finito se trata como 0 (no rompe el clamp)', () => {
  const regionHeight = 9 * ROW;
  const regionTop = VIEWPORT_BOTTOM - regionHeight;
  assert.equal(autoScrollDelta(input({ dir: 1, regionTop, regionHeight, margin: Number.NaN })), 0);
});
