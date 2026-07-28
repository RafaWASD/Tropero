// Tests de la lógica PURA del primitivo bottom sheet (BottomSheetShell). node:test.
// Foco: la CONDENSACIÓN con el teclado arriba — qué se suelta y qué NO se suelta nunca.

import test from 'node:test';
import assert from 'node:assert/strict';

import { sheetCondensation, shouldDismissKeyboardOnOpen } from './sheet-shell.ts';

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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// ABRIR UN SHEET BAJA EL TECLADO (bug 🔴 device Android, APK a3b8d804: el ExitJornadaSheet quedaba
// debajo del teclado y sus dos botones eran inalcanzables).
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test('MONTAJE con el sheet abierto → baja el teclado (el caso del reporte: ‹ con el input enfocado)', () => {
  // Los sheets que se montan al abrirse (ExitJornadaSheet, CandidatePicker, OtherRodeoSheet…) llegan acá
  // con wasOpen=false en su primer efecto.
  assert.equal(shouldDismissKeyboardOnOpen({ wasOpen: false, isOpen: true }), true);
});

test('APERTURA de un sheet siempre montado (prop `open` false→true) → baja el teclado', () => {
  // LotePickerSheet / MarkDeclaredSheet viven montados y se muestran por prop: el flanco es lo que cuenta,
  // no el montaje (si mirásemos solo el montaje, estos dos nunca bajarían el teclado).
  assert.equal(shouldDismissKeyboardOnOpen({ wasOpen: false, isOpen: true }), true);
});

test('🔒 SHEET YA ABIERTO (true→true) → NO baja el teclado: si no, su input PROPIO sería inusable', () => {
  // El modo de falla que este predicado lockea: un efecto que dispare en cada render cerraría el teclado
  // en cada tecla → ManeuverConfigSheet / CustomFieldSheet / SavePresetSheet / BreedPickerSheet / TagScanSheet
  // (los sheets con input propio) quedarían rotos, y en web no se vería NADA (RNW no monta teclado virtual).
  assert.equal(shouldDismissKeyboardOnOpen({ wasOpen: true, isOpen: true }), false);
});

test('al CERRAR (true→false) no se toca el foco de nadie', () => {
  assert.equal(shouldDismissKeyboardOnOpen({ wasOpen: true, isOpen: false }), false);
});

test('sheet cerrado que sigue cerrado (false→false) → no hace nada', () => {
  assert.equal(shouldDismissKeyboardOnOpen({ wasOpen: false, isOpen: false }), false);
});

test('REAPERTURA: cerrar y volver a abrir vuelve a bajar el teclado (el flanco se re-arma)', () => {
  // Secuencia completa de un sheet con prop `open`, simulando el ref del hook.
  let wasOpen = false;
  const seen: boolean[] = [];
  for (const isOpen of [true, true, false, true]) {
    seen.push(shouldDismissKeyboardOnOpen({ wasOpen, isOpen }));
    wasOpen = isOpen;
  }
  assert.deepEqual(seen, [true, false, false, true]);
});
