// Tests de la clasificación de búsqueda unificada + hero + warning-soft (spec 09 R1.4 / R5, delta IDU).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con el resto).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySearchQuery,
  pickHeroIdentifier,
  isApodoDuplicateInField,
  SEARCH_TERM_MAX_LENGTH,
} from './animal-identifier.ts';

// ─── classifySearchQuery: modelo de 3 (IDU.4.1/4.2/4.3/4.5) ────────────────────────────────

test('IDU.4 classifySearchQuery: 15 dígitos → TAG exacto + IDV (exacto+substring) + apodo', () => {
  const p = classifySearchQuery('982 000123456789');
  assert.equal(p.tryTagExact, true);
  assert.equal(p.tryIdvExact, true);
  assert.equal(p.tryIdvSubstring, true);
  assert.equal(p.tryApodo, true);
  assert.equal(p.compact, '982000123456789');
  assert.equal(p.normalized, '982 000123456789');
});

test('IDU.4 classifySearchQuery: numérico no-15 → IDV + apodo, NO TAG exacto', () => {
  const p = classifySearchQuery('0241 5567');
  assert.equal(p.tryTagExact, false); // no son 15 dígitos
  assert.equal(p.tryIdvExact, true);
  assert.equal(p.tryIdvSubstring, true);
  assert.equal(p.tryApodo, true);
  assert.equal(p.compact, '02415567');
});

// IDU.4.3: un idv ALFANUMÉRICO o su prefijo (con letras) ahora dispara idv (antes solo dígitos).
test('IDU.4.3 classifySearchQuery: texto con letras HABILITA idv + apodo (idv alfanumérico buscable)', () => {
  const p = classifySearchQuery('AB123');
  assert.equal(p.tryTagExact, false);
  assert.equal(p.tryIdvExact, true, 'un idv alfanumérico se busca (antes solo dígitos)');
  assert.equal(p.tryIdvSubstring, true);
  assert.equal(p.tryApodo, true, 'y el apodo también');
  assert.equal(p.compact, 'AB123');
});

// IDU.4.4: un nombre libre ("Manchada") busca por apodo (+ idv por si un idv alfanumérico coincide).
test('IDU.4.4 classifySearchQuery: nombre libre → apodo (+ idv), sin TAG', () => {
  const p = classifySearchQuery('Manchada');
  assert.equal(p.tryTagExact, false);
  assert.equal(p.tryApodo, true);
  assert.equal(p.tryIdvExact, true);
  assert.equal(p.normalized, 'Manchada');
});

test('IDU.4 classifySearchQuery: apodo con espacios preserva el normalized (los espacios importan)', () => {
  const p = classifySearchQuery('  La Colorada  ');
  assert.equal(p.tryApodo, true);
  assert.equal(p.normalized, 'La Colorada', 'trim pero conserva el espacio interno del nombre');
  assert.equal(p.compact, 'LaColorada', 'el compacto quita separadores (para TAG/IDV)');
});

test('IDU.4 classifySearchQuery: vacío → nada que buscar', () => {
  const p = classifySearchQuery('   ');
  assert.equal(p.tryTagExact, false);
  assert.equal(p.tryIdvExact, false);
  assert.equal(p.tryIdvSubstring, false);
  assert.equal(p.tryApodo, false);
  assert.equal(p.normalized, '');
});

// ─── F1-1 (R7.3): tope de largo AUTORITATIVO del término ────────────────────────────────────

test('F1-1 (R7.3): un término por encima de 64 chars se RECORTA a 64 (normalized + compact)', () => {
  const long = 'a'.repeat(SEARCH_TERM_MAX_LENGTH + 50);
  const p = classifySearchQuery(long);
  assert.equal(p.normalized.length, SEARCH_TERM_MAX_LENGTH, 'normalized topado en 64');
  assert.ok(p.compact.length <= SEARCH_TERM_MAX_LENGTH, 'compact nunca supera 64');
  assert.ok(p.normalized.length < long.length);
});

test('F1-1 (R7.3): un término largo de DÍGITOS se recorta a 64 antes de clasificar TAG', () => {
  const longDigits = '9'.repeat(SEARCH_TERM_MAX_LENGTH + 10);
  const p = classifySearchQuery(longDigits);
  assert.equal(p.compact.length, SEARCH_TERM_MAX_LENGTH, 'compact topado en 64');
  assert.equal(p.tryTagExact, false, '64 dígitos ≠ 15 → no dispara el match exacto de TAG');
  assert.equal(p.tryIdvExact, true);
});

test('F1-1 (R7.2): metacaracteres de .or() en el término NO rompen la clasificación', () => {
  const malicious = 'idv.eq.0):*,id';
  const p = classifySearchQuery(malicious);
  assert.equal(p.tryTagExact, false);
  assert.equal(p.tryIdvExact, true, 'todo término no vacío es candidato a idv/apodo (se escapa aguas abajo)');
  assert.equal(p.tryApodo, true);
  assert.equal(p.normalized, malicious, 'se preserva como texto literal del término');
});

// ─── pickHeroIdentifier (IDU.6) ─────────────────────────────────────────────────────────────

test('IDU.6.1 pickHeroIdentifier: rodeo con apodo + animal con apodo → hero apodo, caravana secundaria (idv)', () => {
  const h = pickHeroIdentifier({ apodo: 'Manchada', rodeoUsesApodo: true, idv: 'AB123', tag: '982000000000001' });
  assert.equal(h.kind, 'apodo');
  assert.equal(h.value, 'Manchada');
  assert.deepEqual(h.secondary, { kind: 'idv', value: 'AB123' });
});

test('IDU.6.1 pickHeroIdentifier: hero apodo cae a tag como secundario si no hay idv', () => {
  const h = pickHeroIdentifier({ apodo: 'Toño', rodeoUsesApodo: true, idv: null, tag: '982000000000001' });
  assert.equal(h.kind, 'apodo');
  assert.deepEqual(h.secondary, { kind: 'tag', value: '982000000000001' });
});

test('IDU.6.1 pickHeroIdentifier: hero apodo sin caravana → secondary null', () => {
  const h = pickHeroIdentifier({ apodo: 'Ñata', rodeoUsesApodo: true, idv: null, tag: null });
  assert.equal(h.kind, 'apodo');
  assert.equal(h.secondary, null);
});

test('IDU.6.4 pickHeroIdentifier: rodeo SIN apodo → idv es el hero aunque el animal tenga apodo', () => {
  const h = pickHeroIdentifier({ apodo: 'Manchada', rodeoUsesApodo: false, idv: 'AB123', tag: '982000000000001' });
  assert.equal(h.kind, 'idv');
  assert.equal(h.value, 'AB123');
  assert.equal(h.secondary, null);
});

test('IDU.6.4 pickHeroIdentifier: rodeo con apodo pero animal SIN apodo → idv → tag', () => {
  const conIdv = pickHeroIdentifier({ apodo: null, rodeoUsesApodo: true, idv: 'AB123', tag: '982000000000001' });
  assert.equal(conIdv.kind, 'idv');
  const soloTag = pickHeroIdentifier({ apodo: '  ', rodeoUsesApodo: true, idv: null, tag: '982000000000001' });
  assert.equal(soloTag.kind, 'tag');
  assert.equal(soloTag.value, '982000000000001');
});

test('IDU.6.6 pickHeroIdentifier: sin ningún identificador → none (el caller elige el fallback)', () => {
  const h = pickHeroIdentifier({ apodo: null, rodeoUsesApodo: true, idv: null, tag: null });
  assert.equal(h.kind, 'none');
  assert.equal(h.value, null);
  assert.equal(h.secondary, null);
});

test('IDU.6 pickHeroIdentifier: valores en blanco (espacios) NO cuentan como presentes', () => {
  const h = pickHeroIdentifier({ apodo: '   ', rodeoUsesApodo: true, idv: '  ', tag: '   ' });
  assert.equal(h.kind, 'none');
});

// ─── isApodoDuplicateInField (IDU.5.4–5.7) ──────────────────────────────────────────────────

test('IDU.5.4 isApodoDuplicateInField: match case-insensitive + trim → true', () => {
  assert.equal(isApodoDuplicateInField('Manchada', ['Pinta', 'manchada', 'Lola']), true);
  assert.equal(isApodoDuplicateInField('  la colorada ', ['La Colorada']), true);
});

test('IDU.5.4 isApodoDuplicateInField: sin match → false', () => {
  assert.equal(isApodoDuplicateInField('Manchada', ['Pinta', 'Lola']), false);
  assert.equal(isApodoDuplicateInField('Nueva', []), false);
});

test('IDU.5.4 isApodoDuplicateInField: candidato vacío nunca dispara el aviso', () => {
  assert.equal(isApodoDuplicateInField('', ['algo']), false);
  assert.equal(isApodoDuplicateInField('   ', ['algo', '  ']), false);
});

test('IDU.5.6 isApodoDuplicateInField: el propio ya lo excluye el caller (no está en others)', () => {
  // El caller filtra el profile_id del animal en edición ANTES de armar `others`, así que un animal
  // que solo coincide consigo mismo pasa `others` sin su propio apodo → no dispara.
  assert.equal(isApodoDuplicateInField('Manchada', []), false);
});
