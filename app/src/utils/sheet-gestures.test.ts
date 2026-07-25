// Tests de la lógica PURA de las VÍAS DE CIERRE POR GESTO del BottomSheetShell. node:test.
// Foco: el UMBRAL de cierre (distancia / flick / arrepentimiento), el gate por zona del toque (header vs
// body scrolleado), el clamp de la traslación, qué hace el arrastre con el teclado arriba, y qué hace el
// BACK FÍSICO de Android (cierra el sheet por el mismo onClose y consume el evento).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET_DISMISS_CANCEL_VELOCITY,
  SHEET_DISMISS_FLING_MIN_TRAVEL,
  SHEET_DISMISS_FLING_VELOCITY,
  SHEET_DISMISS_MIN_DISTANCE,
  SHEET_DISMISS_RATIO,
  sheetBackHandlerApplies,
  sheetBackPress,
  sheetDragAllowedFrom,
  sheetDragIntent,
  sheetDragOffset,
  shouldDismissSheet,
  type SheetDismissInput,
} from './sheet-gestures.ts';

/** Los umbrales REALES del componente (fuente única: las constantes del módulo). */
const T = {
  ratio: SHEET_DISMISS_RATIO,
  minDistance: SHEET_DISMISS_MIN_DISTANCE,
  flingVelocity: SHEET_DISMISS_FLING_VELOCITY,
  flingMinTravel: SHEET_DISMISS_FLING_MIN_TRAVEL,
  cancelVelocity: SHEET_DISMISS_CANCEL_VELOCITY,
} as const;

const dismiss = (over: Partial<SheetDismissInput>): boolean =>
  shouldDismissSheet({ translationY: 0, velocityY: 0, sheetHeight: 600, ...T, ...over });

// ─── Gate: ¿desde dónde se puede arrastrar? ──────────────────────────────────────────────────────

test('el HEADER arrastra siempre, aunque el body esté scrolleado', () => {
  assert.equal(sheetDragAllowedFrom({ zone: 'header', bodyAtTop: false }), true);
  assert.equal(sheetDragAllowedFrom({ zone: 'header', bodyAtTop: true }), true);
});

test('desde el BODY solo se arrastra con el scroll en el TOPE (no le robamos el scroll al operario)', () => {
  assert.equal(sheetDragAllowedFrom({ zone: 'body', bodyAtTop: true }), true);
  assert.equal(sheetDragAllowedFrom({ zone: 'body', bodyAtTop: false }), false);
});

test('el gate depende SOLO de (zona, scroll en el tope) — sin geometría ni estado oculto', () => {
  const a = sheetDragAllowedFrom({ zone: 'body', bodyAtTop: false });
  assert.equal(a, sheetDragAllowedFrom({ zone: 'body', bodyAtTop: false }));
  assert.notEqual(a, sheetDragAllowedFrom({ zone: 'body', bodyAtTop: true }));
});

// ─── Traslación: solo hacia abajo ────────────────────────────────────────────────────────────────

test('la traslación sigue al dedo 1:1 hacia abajo', () => {
  assert.equal(sheetDragOffset(0), 0);
  assert.equal(sheetDragOffset(37.5), 37.5);
});

test('arrastrar hacia ARRIBA no despega el sheet de su ancla inferior (clamp en 0)', () => {
  assert.equal(sheetDragOffset(-1), 0);
  assert.equal(sheetDragOffset(-400), 0);
});

test('una traslación no finita se neutraliza en 0', () => {
  assert.equal(sheetDragOffset(Number.NaN), 0);
  assert.equal(sheetDragOffset(Number.POSITIVE_INFINITY), 0);
});

// ─── Umbral de cierre: DISTANCIA ─────────────────────────────────────────────────────────────────

test('recorrido corto y sin velocidad: NO cierra (vuelve con spring)', () => {
  assert.equal(dismiss({ translationY: 20, velocityY: 0, sheetHeight: 600 }), false);
  assert.equal(dismiss({ translationY: 149, velocityY: 0, sheetHeight: 600 }), false);
});

test('recorrido ≥ 25% del alto del sheet: CIERRA', () => {
  // 600 * 0.25 = 150
  assert.equal(dismiss({ translationY: 150, velocityY: 0, sheetHeight: 600 }), true);
  assert.equal(dismiss({ translationY: 400, velocityY: 0, sheetHeight: 600 }), true);
});

test('en un sheet CORTO manda el piso absoluto, no el 25% (un roce de 50px no lo cierra)', () => {
  // 200 * 0.25 = 50 < 64 (piso)
  assert.equal(dismiss({ translationY: 50, velocityY: 0, sheetHeight: 200 }), false);
  assert.equal(dismiss({ translationY: SHEET_DISMISS_MIN_DISTANCE, velocityY: 0, sheetHeight: 200 }), true);
});

test('sin alto medido del sheet, el umbral es el piso absoluto (nunca "cualquier arrastre cierra")', () => {
  assert.equal(dismiss({ translationY: 10, velocityY: 0, sheetHeight: 0 }), false);
  assert.equal(dismiss({ translationY: 63, velocityY: 0, sheetHeight: 0 }), false);
  assert.equal(dismiss({ translationY: 64, velocityY: 0, sheetHeight: 0 }), true);
  assert.equal(dismiss({ translationY: 300, velocityY: 0, sheetHeight: Number.NaN }), true);
});

// ─── Umbral de cierre: FLICK ─────────────────────────────────────────────────────────────────────

test('flick rápido hacia abajo con poco recorrido: CIERRA', () => {
  assert.equal(dismiss({ translationY: 30, velocityY: 1500, sheetHeight: 600 }), true);
});

test('flick rápido pero SIN recorrido mínimo (tap tembloroso): NO cierra', () => {
  assert.equal(dismiss({ translationY: 5, velocityY: 3000, sheetHeight: 600 }), false);
});

test('arrastre lento y corto: ni distancia ni flick → NO cierra', () => {
  assert.equal(dismiss({ translationY: 40, velocityY: 200, sheetHeight: 600 }), false);
});

// ─── Arrepentimiento: flick hacia arriba al soltar ───────────────────────────────────────────────

test('soltar tirando HACIA ARRIBA cancela el cierre aunque la distancia alcance', () => {
  assert.equal(dismiss({ translationY: 400, velocityY: -1200, sheetHeight: 600 }), false);
});

test('una velocidad ascendente chica (temblor) no cancela un recorrido que ya alcanzó', () => {
  assert.equal(dismiss({ translationY: 400, velocityY: -50, sheetHeight: 600 }), true);
});

// ─── Fail-closed duro: nunca cerramos por una medida rota ────────────────────────────────────────

test('medidas no finitas o negativas NO cierran (perder lo cargado es el peor resultado)', () => {
  assert.equal(dismiss({ translationY: Number.NaN, velocityY: 5000, sheetHeight: 600 }), false);
  assert.equal(dismiss({ translationY: 500, velocityY: Number.NaN, sheetHeight: 600 }), false);
  assert.equal(dismiss({ translationY: -500, velocityY: 0, sheetHeight: 600 }), false);
  assert.equal(dismiss({ translationY: 0, velocityY: 0, sheetHeight: 600 }), false);
});

test('sin umbrales utilizables (piso y flick no finitos) el gesto NO cierra', () => {
  assert.equal(
    shouldDismissSheet({
      translationY: 5000,
      velocityY: 9000,
      sheetHeight: 600,
      ratio: Number.NaN,
      minDistance: Number.NaN,
      flingVelocity: Number.NaN,
      flingMinTravel: Number.NaN,
      cancelVelocity: Number.NaN,
    }),
    false,
  );
});

// ─── Teclado arriba: UNA sola conducta ───────────────────────────────────────────────────────────

test('con el teclado ARRIBA el arrastre baja el teclado y NO cierra el sheet', () => {
  assert.equal(sheetDragIntent({ keyboardVisible: true }), 'dismiss-keyboard');
});

test('con el teclado abajo el arrastre arrastra el sheet', () => {
  assert.equal(sheetDragIntent({ keyboardVisible: false }), 'drag-sheet');
});

test('la intención depende SOLO del teclado (decisión pura, sin estado oculto)', () => {
  assert.notEqual(sheetDragIntent({ keyboardVisible: true }), sheetDragIntent({ keyboardVisible: false }));
});

// ─── Back físico de Android: cierra el sheet, NO la ruta ─────────────────────────────────────────

test('el back de Android CONSUME el evento (si no, el navigator hace pop de la ruta = el bug)', () => {
  assert.equal(
    sheetBackPress(() => {}),
    true,
  );
});

test('el back cierra por el MISMO onClose del sheet, una sola vez (ahí vive el flush de lo tipeado)', () => {
  let calls = 0;
  sheetBackPress(() => {
    calls += 1;
  });
  assert.equal(calls, 1);
});

test('el handler de back se registra SOLO en Android (única plataforma con botón atrás de hardware)', () => {
  assert.equal(sheetBackHandlerApplies('android'), true);
  assert.equal(sheetBackHandlerApplies('ios'), false);
  assert.equal(sheetBackHandlerApplies('web'), false);
  assert.equal(sheetBackHandlerApplies('windows'), false);
  assert.equal(sheetBackHandlerApplies(''), false);
});

