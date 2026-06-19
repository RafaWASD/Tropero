// Tests de la lógica PURA del tamaño de la LÍNEA DE MANIOBRA de longitud variable (spec 03 M5-CLIENTE bugfix
// del título recortado). node:test.
// Foco: step-down length-aware ($5 normal / $4 muy largo), borde del umbral, trim, vacío, lineHeight matching.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maneuverTitleFontToken,
  MANEUVER_TITLE_STEPDOWN_CHARS,
} from './maneuver-title-size';

// ─── Labels TÍPICOS (fábrica + custom de longitud normal) entran a $5 ────────────────────────────
test('label corto/típico usa el token base $5', () => {
  assert.deepEqual(maneuverTitleFontToken('Tacto'), { fontSize: '$5', lineHeight: '$5' });
  assert.deepEqual(maneuverTitleFontToken('Condición corporal'), { fontSize: '$5', lineHeight: '$5' });
  // El label largo que reportó Raf (41 ch) sigue en $5 — entra en 2 líneas a $5 (umbral 56).
  assert.deepEqual(maneuverTitleFontToken('Ángulo de inclinación de pezuña posterior'), {
    fontSize: '$5',
    lineHeight: '$5',
  });
});

// ─── Label MUY largo (> umbral) baja a $4 para caber en 2 líneas a 360px ──────────────────────────
test('label muy largo (> umbral) baja a $4', () => {
  const muyLargo = 'a'.repeat(MANEUVER_TITLE_STEPDOWN_CHARS + 1);
  assert.deepEqual(maneuverTitleFontToken(muyLargo), { fontSize: '$4', lineHeight: '$4' });
  // Un label realista pero muy largo (descripción larga puesta como label).
  const realLargo = 'Ángulo de inclinación de la pezuña posterior izquierda en reposo'; // > 56
  assert.ok(realLargo.length > MANEUVER_TITLE_STEPDOWN_CHARS);
  assert.deepEqual(maneuverTitleFontToken(realLargo), { fontSize: '$4', lineHeight: '$4' });
});

// ─── Borde EXACTO del umbral ──────────────────────────────────────────────────────────────────────
test('borde del umbral: == umbral usa $5; > umbral usa $4', () => {
  assert.deepEqual(maneuverTitleFontToken('a'.repeat(MANEUVER_TITLE_STEPDOWN_CHARS)), {
    fontSize: '$5',
    lineHeight: '$5',
  });
  assert.deepEqual(maneuverTitleFontToken('a'.repeat(MANEUVER_TITLE_STEPDOWN_CHARS + 1)), {
    fontSize: '$4',
    lineHeight: '$4',
  });
});

// ─── trim: los espacios de borde no empujan a un bucket más chico ────────────────────────────────
test('mide sobre el label recortado (los espacios de borde no cuentan)', () => {
  const conPadding = '   ' + 'a'.repeat(MANEUVER_TITLE_STEPDOWN_CHARS) + '   ';
  assert.deepEqual(maneuverTitleFontToken(conPadding), { fontSize: '$5', lineHeight: '$5' });
});

// ─── Vacío / nulo → token base, sin crash ────────────────────────────────────────────────────────
test('label vacío o nulo usa el token base sin crash', () => {
  assert.deepEqual(maneuverTitleFontToken(''), { fontSize: '$5', lineHeight: '$5' });
  assert.deepEqual(maneuverTitleFontToken('     '), { fontSize: '$5', lineHeight: '$5' });
  // @ts-expect-error — robustez ante undefined en runtime (no debería pasar, pero no debe crashear).
  assert.deepEqual(maneuverTitleFontToken(undefined), { fontSize: '$5', lineHeight: '$5' });
});

// ─── lineHeight matching: SIEMPRE par con fontSize (recorte de descendentes) ─────────────────────
test('el lineHeight siempre matchea el fontSize (regla de descenders)', () => {
  for (const n of ['', 'Tacto', 'Ángulo de inclinación de pezuña posterior', 'x'.repeat(100)]) {
    const t = maneuverTitleFontToken(n);
    assert.equal(t.fontSize.replace('$', ''), t.lineHeight.replace('$', ''));
  }
});
