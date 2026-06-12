// Tests de la lógica PURA de presentación de la selección masiva (spec 10, T-UI.4 / R11.6, R11.9).
// PURO: sin SDK/RN/supabase → corre siempre con node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_THRESHOLD,
  sortByIdentifier,
  shouldShowSearch,
  filterBySearch,
  pluralCategoryLabel,
} from './selection-display.ts';

type Row = {
  profileId: string;
  idv: string | null;
  visualIdAlt: string | null;
  tagElectronic: string | null;
};

function row(over: Partial<Row>): Row {
  return {
    profileId: over.profileId ?? 'p-' + Math.random().toString(36).slice(2),
    idv: over.idv ?? null,
    visualIdAlt: over.visualIdAlt ?? null,
    tagElectronic: over.tagElectronic ?? null,
  };
}

// ─── sortByIdentifier (R11.9) ───────────────────────────────────────────────────────────────

test('R11.9: ordena por identificador NUMÉRICO de caravana (no lexicográfico)', () => {
  const input = [
    row({ profileId: 'a', idv: '1043' }),
    row({ profileId: 'b', idv: '220' }),
    row({ profileId: 'c', idv: '1042' }),
  ];
  const ids = sortByIdentifier(input).map((p) => p.idv);
  // Numérico: 220 < 1042 < 1043 (lexicográfico daría 1042,1043,220 — mal).
  assert.deepEqual(ids, ['220', '1042', '1043']);
});

test('R11.9: usa visualId cuando no hay idv; alfabético para no-numéricos', () => {
  const input = [
    row({ profileId: 'a', visualIdAlt: 'Zeta' }),
    row({ profileId: 'b', visualIdAlt: 'Alfa' }),
  ];
  const ids = sortByIdentifier(input).map((p) => p.visualIdAlt);
  assert.deepEqual(ids, ['Alfa', 'Zeta']);
});

test('R11.9: empate de identificador desempata por profileId (orden determinístico)', () => {
  const input = [
    row({ profileId: 'p-zzz', idv: '100' }),
    row({ profileId: 'p-aaa', idv: '100' }),
  ];
  const ids = sortByIdentifier(input).map((p) => p.profileId);
  assert.deepEqual(ids, ['p-aaa', 'p-zzz']);
});

test('sortByIdentifier NO muta el array de entrada', () => {
  const input = [row({ profileId: 'a', idv: '2' }), row({ profileId: 'b', idv: '1' })];
  const snapshot = input.map((p) => p.profileId);
  sortByIdentifier(input);
  assert.deepEqual(input.map((p) => p.profileId), snapshot);
});

// ─── shouldShowSearch (R11.9) ───────────────────────────────────────────────────────────────

test('R11.9: el buscador aparece SOLO cuando se supera el umbral (~20)', () => {
  assert.equal(SEARCH_THRESHOLD, 20);
  assert.equal(shouldShowSearch(20), false); // == umbral: NO
  assert.equal(shouldShowSearch(21), true); // > umbral: SÍ
  assert.equal(shouldShowSearch(0), false);
});

// ─── filterBySearch (R11.9) ─────────────────────────────────────────────────────────────────

test('R11.9: filtra por idv / visualId / caravana, case-insensitive', () => {
  const input = [
    row({ profileId: 'a', idv: '1042' }),
    row({ profileId: 'b', visualIdAlt: 'Manchada' }),
    row({ profileId: 'c', tagElectronic: '900111222333444' }),
  ];
  assert.deepEqual(filterBySearch(input, '104').map((p) => p.profileId), ['a']);
  assert.deepEqual(filterBySearch(input, 'mancha').map((p) => p.profileId), ['b']);
  assert.deepEqual(filterBySearch(input, '222333').map((p) => p.profileId), ['c']);
});

test('R11.9: query vacía devuelve TODO sin filtrar', () => {
  const input = [row({ profileId: 'a', idv: '1' }), row({ profileId: 'b', idv: '2' })];
  assert.equal(filterBySearch(input, '   ').length, 2);
  assert.equal(filterBySearch(input, '').length, 2);
});

// ─── pluralCategoryLabel (R11.8) ────────────────────────────────────────────────────────────

test('R11.8: pluraliza es-AR las categorías candidatas conocidas', () => {
  assert.equal(pluralCategoryLabel('ternero', 8, 'Ternero'), '8 terneros');
  assert.equal(pluralCategoryLabel('torito', 3, 'Torito'), '3 toritos');
  assert.equal(pluralCategoryLabel('toro', 1, 'Toro'), '1 toro'); // singular
  assert.equal(pluralCategoryLabel('ternera', 5, 'Ternera'), '5 terneras');
});

test('R11.8: code desconocido cae al name del catálogo en minúscula', () => {
  assert.equal(pluralCategoryLabel('vaca_cabana', 2, 'Vaca de cabaña'), '2 vaca de cabaña');
  assert.equal(pluralCategoryLabel('xyz', 1, ''), '1 xyz');
});
