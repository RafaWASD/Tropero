// Tests de la lógica PURA del tamaño del texto HERO de un nombre de longitud variable (spec 03 M3.2b, fix
// web del overflow del nombre de producto). node:test.
// Foco: step-down length-aware (nombre típico GRANDE / largo más chico), bordes de bucket, trim, vacío,
// caso patológico (string larguísimo sin espacios → piso, nunca crash/overflow), lineHeight matching.

import test from 'node:test';
import assert from 'node:assert/strict';

import { heroFontTokenForName } from './hero-text-size';

// ─── Nombres TÍPICOS de producto veterinario entran GRANDES (dominante, manga a pleno sol) ──────

test('nombre corto (≤10 ch) usa el token más grande $11', () => {
  // Casos cortos reales: vacunas/pajuelas cortas.
  assert.deepEqual(heroFontTokenForName('Aftosa'), { fontSize: '$11', lineHeight: '$11' });
  assert.deepEqual(heroFontTokenForName('Mancha'), { fontSize: '$11', lineHeight: '$11' });
  assert.deepEqual(heroFontTokenForName('Toro 123'), { fontSize: '$11', lineHeight: '$11' });
});

test('nombre típico de vet (11-16 ch) usa $10, no overflowea', () => {
  // "Ivermectina"(11), "Bencimidazol"(12), "Oxitetraciclina"(15): los nombres que reportó el leader.
  assert.deepEqual(heroFontTokenForName('Ivermectina'), { fontSize: '$10', lineHeight: '$10' });
  assert.deepEqual(heroFontTokenForName('Bencimidazol'), { fontSize: '$10', lineHeight: '$10' });
  assert.deepEqual(heroFontTokenForName('Oxitetraciclina'), { fontSize: '$10', lineHeight: '$10' });
});

test('nombre largo (17-24 ch) baja a $9 para entrar completo', () => {
  // "Closantel + Ivermectina"(23): combinación de dos principios activos.
  assert.deepEqual(heroFontTokenForName('Closantel + Ivermectina'), { fontSize: '$9', lineHeight: '$9' });
  // Pajuela tipo "GANADOR 1234 RA"(15) entra en $10; una más larga cae a $9.
  assert.deepEqual(heroFontTokenForName('GANADOR 1234 RA 2024'), { fontSize: '$9', lineHeight: '$9' });
});

test('nombre muy largo (25-40 ch) baja a $8', () => {
  const n = 'Closantel + Ivermectina + Vitam'; // 31 ch
  assert.equal(n.length, 31);
  assert.deepEqual(heroFontTokenForName(n), { fontSize: '$8', lineHeight: '$8' });
});

// ─── Bordes de bucket: el step-down cambia EXACTAMENTE en el límite ─────────────────────────────

test('bordes de bucket: el límite superior de cada bucket usa el token de ESE bucket', () => {
  assert.equal('a'.repeat(10).length, 10);
  assert.deepEqual(heroFontTokenForName('a'.repeat(10)), { fontSize: '$11', lineHeight: '$11' }); // 10 → $11
  assert.deepEqual(heroFontTokenForName('a'.repeat(11)), { fontSize: '$10', lineHeight: '$10' }); // 11 → $10
  assert.deepEqual(heroFontTokenForName('a'.repeat(16)), { fontSize: '$10', lineHeight: '$10' }); // 16 → $10
  assert.deepEqual(heroFontTokenForName('a'.repeat(17)), { fontSize: '$9', lineHeight: '$9' }); // 17 → $9
  assert.deepEqual(heroFontTokenForName('a'.repeat(24)), { fontSize: '$9', lineHeight: '$9' }); // 24 → $9
  assert.deepEqual(heroFontTokenForName('a'.repeat(25)), { fontSize: '$8', lineHeight: '$8' }); // 25 → $8
  assert.deepEqual(heroFontTokenForName('a'.repeat(40)), { fontSize: '$8', lineHeight: '$8' }); // 40 → $8
  assert.deepEqual(heroFontTokenForName('a'.repeat(41)), { fontSize: '$7', lineHeight: '$7' }); // 41 → $7 (piso)
});

// ─── CASO PATOLÓGICO: string larguísimo sin espacios → piso $7 (el componente word-breakea + elipsa) ──

test('caso patológico (string larguísimo sin espacios) cae al piso $7 sin crash', () => {
  // Lo que tipeó Raf: "Ivermectinaaaaaaaaaa…" muy largo, sin espacios → no parte por palabra.
  const patologico = 'Ivermectina' + 'a'.repeat(60); // 71 ch sin espacios
  assert.deepEqual(heroFontTokenForName(patologico), { fontSize: '$7', lineHeight: '$7' });
  // Un string absurdo (200 ch) sigue dando un token válido, nunca undefined/crash.
  const absurdo = 'x'.repeat(200);
  assert.deepEqual(heroFontTokenForName(absurdo), { fontSize: '$7', lineHeight: '$7' });
});

// ─── trim: los espacios de borde no empujan a un bucket más chico ───────────────────────────────

test('mide sobre el nombre recortado (los espacios de borde no cuentan)', () => {
  // "Ivermectina"(11) con padding → sigue siendo $10 (no $9).
  assert.deepEqual(heroFontTokenForName('   Ivermectina   '), { fontSize: '$10', lineHeight: '$10' });
  // Un string SOLO de espacios → longitud 0 → token más grande (es "vacío").
  assert.deepEqual(heroFontTokenForName('     '), { fontSize: '$11', lineHeight: '$11' });
});

// ─── Vacío / placeholder: corto → token grande (texto fijo y corto, no overflowea) ──────────────

test('nombre vacío usa el token más grande (placeholder "Sin producto" es corto)', () => {
  assert.deepEqual(heroFontTokenForName(''), { fontSize: '$11', lineHeight: '$11' });
  // El placeholder real "Sin producto"(12) cae en $10 — entra completo y grande.
  assert.deepEqual(heroFontTokenForName('Sin producto'), { fontSize: '$10', lineHeight: '$10' });
  assert.deepEqual(heroFontTokenForName('Sin pajuela'), { fontSize: '$10', lineHeight: '$10' });
});

// ─── lineHeight matching: SIEMPRE par con fontSize (recorte de descendentes) ────────────────────

test('el lineHeight siempre matchea el fontSize (regla de descenders)', () => {
  for (const n of ['', 'Aftosa', 'Ivermectina', 'Closantel + Ivermectina', 'x'.repeat(100)]) {
    const t = heroFontTokenForName(n);
    assert.equal(t.fontSize.replace('$', ''), t.lineHeight.replace('$', ''));
  }
});
