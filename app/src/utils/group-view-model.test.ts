// Tests del view-model PURO de la vista de grupo paginada (spec 10 delta rodeo-grande, Fases 3-4).
// node:test + type-stripping nativo (sin Jest). Lógica pura en utils/group-view-model.ts.
// Cubre: RG1.5/RG1.6 (canLoadMore), RG4.5 (dedupById), RG3.6 (intersectSearchWithChips), RG3.8 (isSearchActive),
// RG3.9 (sexFilterAvailable).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_GROUP_FILTER,
  isSearchActive,
  hasActiveChips,
  canLoadMore,
  dedupById,
  intersectSearchWithChips,
  sexFilterAvailable,
  shouldYieldWindowRefresh,
  type GroupFilter,
} from './group-view-model.ts';
import type { AnimalSex } from './animal-category.ts';

// ─── isSearchActive (RG3.6/RG3.8) ────────────────────────────────────────────────────────────

test('RG3.8: isSearchActive — vacío / solo espacios = sin búsqueda; texto = búsqueda activa', () => {
  assert.equal(isSearchActive(''), false);
  assert.equal(isSearchActive('   '), false);
  assert.equal(isSearchActive('123'), true);
  assert.equal(isSearchActive('  A9  '), true);
});

// ─── hasActiveChips ──────────────────────────────────────────────────────────────────────────

test('hasActiveChips — true si hay categoría o sexo activo', () => {
  assert.equal(hasActiveChips(EMPTY_GROUP_FILTER), false);
  assert.equal(hasActiveChips({ categoryCode: 'ternero', sex: null }), true);
  assert.equal(hasActiveChips({ categoryCode: null, sex: 'male' }), true);
});

// ─── canLoadMore (RG1.5/RG1.6) ─────────────────────────────────────────────────────────────────

test('RG1.6: canLoadMore — NO dispara si ya hay una página en vuelo (un solo loadMore a la vez)', () => {
  assert.equal(
    canLoadMore({ loading: false, loadingMore: true, reachedEnd: false, isSearching: false }),
    false,
  );
});

test('RG1.5: canLoadMore — NO dispara si la lista ya llegó al final', () => {
  assert.equal(
    canLoadMore({ loading: false, loadingMore: false, reachedEnd: true, isSearching: false }),
    false,
  );
});

test('canLoadMore — NO dispara durante la carga inicial ni en modo búsqueda; SÍ en el caso feliz', () => {
  assert.equal(
    canLoadMore({ loading: true, loadingMore: false, reachedEnd: false, isSearching: false }),
    false,
    'carga inicial bloquea',
  );
  assert.equal(
    canLoadMore({ loading: false, loadingMore: false, reachedEnd: false, isSearching: true }),
    false,
    'modo búsqueda no pagina',
  );
  assert.equal(
    canLoadMore({ loading: false, loadingMore: false, reachedEnd: false, isSearching: false }),
    true,
    'caso feliz: pagina',
  );
});

// ─── dedupById (RG4.5 — keys estables) ─────────────────────────────────────────────────────────

test('RG4.5: dedupById — elimina duplicados por profileId preservando el orden (1ª aparición gana)', () => {
  const rows = [
    { profileId: 'a', v: 1 },
    { profileId: 'b', v: 2 },
    { profileId: 'a', v: 99 }, // duplicado (refresh + loadMore solapados) → se descarta
    { profileId: 'c', v: 3 },
  ];
  const out = dedupById(rows);
  assert.deepEqual(out.map((r) => r.profileId), ['a', 'b', 'c']);
  assert.equal(out[0].v, 1, 'gana la 1ª aparición');
});

test('RG4.5: dedupById — anexar una página (concat + dedup) no duplica una fila ya presente', () => {
  const prev = [{ profileId: 'a' }, { profileId: 'b' }];
  const page = [{ profileId: 'b' }, { profileId: 'c' }]; // 'b' reaparece
  assert.deepEqual(dedupById([...prev, ...page]).map((r) => r.profileId), ['a', 'b', 'c']);
});

// ─── intersectSearchWithChips (RG3.6) ──────────────────────────────────────────────────────────

const A = (profileId: string, categoryCode: string, sex: AnimalSex) => ({ profileId, categoryCode, sex });

test('RG3.6: intersectSearchWithChips — sin chips devuelve todo', () => {
  const items = [A('1', 'ternero', 'male'), A('2', 'vaquillona', 'female')];
  assert.deepEqual(intersectSearchWithChips(items, EMPTY_GROUP_FILTER), items);
});

test('RG3.6: intersectSearchWithChips — filtra por categoría, por sexo y COMBINADO', () => {
  const items = [
    A('1', 'ternero', 'male'),
    A('2', 'ternera', 'female'),
    A('3', 'toro', 'male'),
  ];
  assert.deepEqual(
    intersectSearchWithChips(items, { categoryCode: 'ternero', sex: null }).map((a) => a.profileId),
    ['1'],
  );
  assert.deepEqual(
    intersectSearchWithChips(items, { categoryCode: null, sex: 'male' }).map((a) => a.profileId),
    ['1', '3'],
  );
  assert.deepEqual(
    intersectSearchWithChips(items, { categoryCode: 'toro', sex: 'male' }).map((a) => a.profileId),
    ['3'],
  );
  // Combinación imposible (categoría macho + sexo hembra) → vacío.
  assert.deepEqual(intersectSearchWithChips(items, { categoryCode: 'ternero', sex: 'female' } as GroupFilter), []);
});

// ─── sexFilterAvailable (RG3.9) ────────────────────────────────────────────────────────────────

test('RG3.9: sexFilterAvailable — el chip de sexo se ofrece SOLO si el grupo tiene AMBOS sexos', () => {
  assert.equal(sexFilterAvailable(['male', 'female']), true);
  assert.equal(sexFilterAvailable(['female', 'male']), true);
  assert.equal(sexFilterAvailable(['male']), false);
  assert.equal(sexFilterAvailable(['female']), false);
  assert.equal(sexFilterAvailable([]), false);
});

// ─── shouldYieldWindowRefresh (FIX del race de ensanchar-filtro) ─────────────────────────────────

test('shouldYieldWindowRefresh — un refresh de fondo CEDE si hay una carga de 1ª página/refresh en vuelo (listLoadInFlight)', () => {
  // El caso del bug: al ENSANCHAR un filtro, `loadFirstPage` está en vuelo (loadingRef=true) → un refreshWindow
  // de foco/sync que arranca después DEBE ceder (no leer el loadedCount STALE angosto ni bumpear listSeq).
  assert.equal(
    shouldYieldWindowRefresh({ listLoadInFlight: true, loadingMore: false }),
    true,
    'carga de 1ª página en vuelo ⇒ el refresh de fondo cede',
  );
});

test('shouldYieldWindowRefresh — un refresh de fondo CEDE si hay un loadMore en vuelo (no clobber-ea la página anexada)', () => {
  assert.equal(
    shouldYieldWindowRefresh({ listLoadInFlight: false, loadingMore: true }),
    true,
    'loadMore en vuelo ⇒ el refresh de fondo cede (preserva la página que el usuario está scrolleando)',
  );
});

test('shouldYieldWindowRefresh — corre normal si NO hay ninguna carga de foreground en vuelo (refresh estable)', () => {
  assert.equal(
    shouldYieldWindowRefresh({ listLoadInFlight: false, loadingMore: false }),
    false,
    'sin foreground en vuelo (filtro estable) ⇒ el refresh silencioso corre normal',
  );
  // Defensivo: si ambos estuvieran activos, también cede.
  assert.equal(shouldYieldWindowRefresh({ listLoadInFlight: true, loadingMore: true }), true);
});
