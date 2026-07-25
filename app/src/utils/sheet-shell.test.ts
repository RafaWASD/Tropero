// Tests de la lógica PURA del primitivo bottom sheet (BottomSheetShell). node:test.
// Foco: la CONDENSACIÓN con el teclado arriba — qué se suelta y qué NO se suelta nunca.

import test from 'node:test';
import assert from 'node:assert/strict';

import { sheetCondensation } from './sheet-shell.ts';

// ─── Teclado ABAJO: el sheet se ve completo (comportamiento previo al fix, sin regresión) ────────

test('teclado cerrado: se muestran descripción, CTA secundario y la X', () => {
  assert.deepEqual(sheetCondensation({ keyboardVisible: false }), {
    showDescription: true,
    showSecondaryAction: true,
    showCloseButton: true,
  });
});

// ─── Teclado ARRIBA: se suelta lo prescindible ───────────────────────────────────────────────────

test('teclado abierto: se OCULTA la descripción del header (gana alto para el input y los chips)', () => {
  assert.equal(sheetCondensation({ keyboardVisible: true }).showDescription, false);
});

test('teclado abierto: se OCULTA el CTA secundario (Cancelar/Cerrar) — no es la acción en curso', () => {
  assert.equal(sheetCondensation({ keyboardVisible: true }).showSecondaryAction, false);
});

// ─── Invariante DURO: la salida nunca desaparece (Nielsen #3) ────────────────────────────────────

test('la X de cierre está SIEMPRE, con y sin teclado (control y libertad — es la única salida visible con el teclado arriba)', () => {
  assert.equal(sheetCondensation({ keyboardVisible: true }).showCloseButton, true);
  assert.equal(sheetCondensation({ keyboardVisible: false }).showCloseButton, true);
});

test('la condensación depende SOLO del teclado (decisión pura, sin estado oculto)', () => {
  const a = sheetCondensation({ keyboardVisible: true });
  const b = sheetCondensation({ keyboardVisible: true });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, sheetCondensation({ keyboardVisible: false }));
});
