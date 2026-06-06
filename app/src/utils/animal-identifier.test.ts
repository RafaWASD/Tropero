// Tests de la heurística de identificadores (spec 09 R1.4 / R5).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con el resto).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyIdentifier,
  classifySearchQuery,
  SEARCH_TERM_MAX_LENGTH,
} from './animal-identifier.ts';

test('R1.4 classifyIdentifier: numérico/estructurado → idv', () => {
  assert.equal(classifyIdentifier('0241 5567'), 'idv'); // números con espacios de formato
  assert.equal(classifyIdentifier('982000123456789'), 'idv'); // caravana FDX-B 15 díg
  assert.equal(classifyIdentifier('112'), 'idv'); // 3 dígitos: borde inferior → idv
  assert.equal(classifyIdentifier('0241-5567'), 'idv'); // guiones de formato
  assert.equal(classifyIdentifier('  5571  '), 'idv'); // trim + 4 dígitos
});

test('R1.4 classifyIdentifier: texto libre / con letras / muy corto → visual', () => {
  assert.equal(classifyIdentifier('ARG 0241'), 'visual'); // tiene letras
  assert.equal(classifyIdentifier('vaca blanca'), 'visual'); // descripción
  assert.equal(classifyIdentifier('R-14'), 'visual'); // seña pintada letra+número
  assert.equal(classifyIdentifier('12'), 'visual'); // < 3 dígitos: número de manga corto
  assert.equal(classifyIdentifier(''), 'visual'); // degenerado
  assert.equal(classifyIdentifier('   '), 'visual'); // solo espacios
});

test('R5 classifySearchQuery: caravana de 15 dígitos dispara TAG + IDV + substring + visual', () => {
  const p = classifySearchQuery('982 000123456789');
  assert.equal(p.tryTag, true);
  assert.equal(p.tryIdv, true);
  assert.equal(p.tryNumericSubstring, true);
  assert.equal(p.tryVisual, true);
  assert.equal(p.compact, '982000123456789');
  assert.equal(p.normalized, '982 000123456789');
});

test('R5 classifySearchQuery: numérico no-15 → IDV + substring + visual, NO TAG', () => {
  const p = classifySearchQuery('0241 5567');
  assert.equal(p.tryTag, false); // no son 15 dígitos
  assert.equal(p.tryIdv, true);
  assert.equal(p.tryNumericSubstring, true);
  assert.equal(p.tryVisual, true);
  assert.equal(p.compact, '02415567');
});

// Fix-loop 2: el bug central. Raf tipeó "03200" (prefijo de una caravana/IDV) y daba "no
// encontramos" porque solo el match exacto (15 díg) buscaba la caravana. Ahora un prefijo numérico
// de cualquier longitud debe HABILITAR el substring sobre idv + tag (no solo el exacto).
test('R5 (fix-loop 2) classifySearchQuery: prefijo numérico corto habilita substring de idv+tag', () => {
  const p = classifySearchQuery('03200');
  assert.equal(p.tryTag, false); // 5 díg, no 15 → no es match exacto de caravana
  assert.equal(p.tryIdv, true); // intenta el exacto de IDV…
  assert.equal(p.tryNumericSubstring, true); // …Y el substring parcial sobre idv + tag (el fix)
  assert.equal(p.tryVisual, true);
  assert.equal(p.compact, '03200');
});

test('R5 (fix-loop 2) classifySearchQuery: prefijo numérico con separadores se compacta para el substring', () => {
  const p = classifySearchQuery(' 0 3200 '); // espacios de formato
  assert.equal(p.tryNumericSubstring, true);
  assert.equal(p.compact, '03200'); // separadores fuera: el substring usa el compacto
});

test('R5 classifySearchQuery: texto con letras → solo visual (NO substring numérico)', () => {
  const p = classifySearchQuery('vaca manchada');
  assert.equal(p.tryTag, false);
  assert.equal(p.tryIdv, false);
  assert.equal(p.tryNumericSubstring, false); // tiene letras → el substring numérico no aplica
  assert.equal(p.tryVisual, true);
});

test('R5 classifySearchQuery: vacío → nada que buscar', () => {
  const p = classifySearchQuery('   ');
  assert.equal(p.tryTag, false);
  assert.equal(p.tryIdv, false);
  assert.equal(p.tryNumericSubstring, false);
  assert.equal(p.tryVisual, false);
  assert.equal(p.normalized, '');
});

// ─── F1-1 (R7.3 / R8.2 / R8.3): tope de largo AUTORITATIVO del término en el service ───
// El recorte vive en classifySearchQuery (lo consume el service antes de cualquier query a
// PostgREST). Test PURO (sin red), complementa el test cliente↔PostgREST (T14).

test('F1-1 (R7.3): un término por encima de 64 chars se RECORTA a 64 (normalized + compact)', () => {
  const long = 'a'.repeat(SEARCH_TERM_MAX_LENGTH + 50); // 114 chars
  const p = classifySearchQuery(long);
  assert.equal(p.normalized.length, SEARCH_TERM_MAX_LENGTH, 'normalized debe quedar topado en 64');
  assert.ok(p.compact.length <= SEARCH_TERM_MAX_LENGTH, 'compact nunca supera 64');
  // El término recortado NUNCA viaja entero a la query: no se manda un string de miles de chars.
  assert.ok(p.normalized.length < long.length);
});

test('F1-1 (R7.3): un término largo de DÍGITOS se recorta a 64 antes de clasificar TAG/IDV', () => {
  const longDigits = '9'.repeat(SEARCH_TERM_MAX_LENGTH + 10); // 74 dígitos
  const p = classifySearchQuery(longDigits);
  assert.equal(p.compact.length, SEARCH_TERM_MAX_LENGTH, 'compact topado en 64');
  assert.equal(p.tryTag, false, '64 dígitos ≠ 15 → no dispara el match exacto de TAG');
  assert.equal(p.tryIdv, true);
  assert.equal(p.tryNumericSubstring, true);
});

test('F1-1 (R7.3): un término <= 64 NO se altera (no recorta input legítimo, R7.5)', () => {
  const ok = '982000123456789'; // caravana legítima de 15 díg
  const p = classifySearchQuery(ok);
  assert.equal(p.compact, ok, 'un término legítimo pasa intacto');
  assert.equal(p.tryTag, true);
});

test('F1-1 (R7.2): metacaracteres de .or() en el término NO rompen la clasificación (se tratan como texto)', () => {
  // Un término con los metacaracteres de PostgREST .or() (`. ( ) : * , % _`) cae a visual y se
  // pasa intacto a normalized; la query usa .ilike(col, pattern) parametrizado (el valor viaja
  // fuera del string de filtro) → no puede alterar la estructura del filtro. Acá verificamos que
  // la lógica pura no lo rompe (clasifica como visual, no inyecta otra primitiva).
  const malicious = 'idv.eq.0):*,id';
  const p = classifySearchQuery(malicious);
  assert.equal(p.tryIdv, false, 'tiene no-dígitos → no dispara IDV exacto');
  assert.equal(p.tryNumericSubstring, false);
  assert.equal(p.tryVisual, true, 'cae a visual (texto libre)');
  assert.equal(p.normalized, malicious, 'se preserva como texto literal del término');
});
