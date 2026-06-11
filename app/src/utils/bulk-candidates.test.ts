// Tests de los candidatos de operación masiva (spec 10, T-CL.2 / R1.3, R11.2, R11.4, R7.2, R3.5).
// PURO: sin SDK/RN/supabase → corre siempre con node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBulkCandidates,
  type GroupProfile,
} from './bulk-candidates.ts';

/** Helper: perfil activo por default; se pisan los campos relevantes por caso. */
function profile(over: Partial<GroupProfile>): GroupProfile {
  return {
    profileId: over.profileId ?? 'p-' + Math.random().toString(36).slice(2),
    rodeoId: 'rod-1',
    sex: 'male',
    categoryCode: 'ternero',
    isCastrated: false,
    futureBull: false,
    hasWeaning: false,
    status: 'active',
    deletedAt: null,
    ...over,
  };
}

const ids = (r: { candidates: GroupProfile[] }) => r.candidates.map((p) => p.profileId).sort();

// ─── R1.3: solo activos / no-soft-deleted en TODAS las operaciones ──────────────────────────

test('R1.3: excluye status != active y soft-deleted en las 3 operaciones', () => {
  const profiles = [
    profile({ profileId: 'active', status: 'active', deletedAt: null }),
    profile({ profileId: 'sold', status: 'sold' }),
    profile({ profileId: 'dead', status: 'dead' }),
    profile({ profileId: 'transferred', status: 'transferred' }),
    profile({ profileId: 'soft-del', status: 'active', deletedAt: '2026-01-01T00:00:00Z' }),
  ];
  for (const op of ['vaccinate', 'castrate', 'wean'] as const) {
    const r = buildBulkCandidates(op, profiles);
    assert.deepEqual(ids(r), ['active'], `op ${op} debe incluir solo el activo no soft-deleted`);
  }
});

// ─── Castración (R11.2 / D3) ────────────────────────────────────────────────────────────────

test('R11.2: castración incluye SOLO machos no castrados (ternero/torito/toro); hembras y castrados fuera', () => {
  const profiles = [
    profile({ profileId: 'ternero-m', sex: 'male', categoryCode: 'ternero', isCastrated: false }),
    profile({ profileId: 'torito', sex: 'male', categoryCode: 'torito', isCastrated: false }),
    profile({ profileId: 'toro', sex: 'male', categoryCode: 'toro', isCastrated: false }),
    // EXCLUIDOS:
    profile({ profileId: 'novillito', sex: 'male', categoryCode: 'novillito', isCastrated: true }),
    profile({ profileId: 'novillo', sex: 'male', categoryCode: 'novillo', isCastrated: true }),
    profile({ profileId: 'ternera', sex: 'female', categoryCode: 'ternera', isCastrated: false }),
    profile({ profileId: 'vaquillona', sex: 'female', categoryCode: 'vaquillona' }),
    profile({ profileId: 'sin-sexo', sex: null, categoryCode: 'ternero' }),
  ];
  const r = buildBulkCandidates('castrate', profiles);
  assert.deepEqual(ids(r), ['ternero-m', 'torito', 'toro']);
  assert.equal(r.excludedByRodeoConfig, 0);
});

test('R11.2: un macho is_castrated=true NO es candidato aunque su categoryCode siga siendo torito (drift)', () => {
  // Caso borde: el espejo aún no recomputó el code pero is_castrated ya es true → no candidato.
  const profiles = [profile({ profileId: 'cast', sex: 'male', categoryCode: 'torito', isCastrated: true })];
  const r = buildBulkCandidates('castrate', profiles);
  assert.deepEqual(ids(r), []);
});

// ─── Destete (R11.4 / D4) ───────────────────────────────────────────────────────────────────

test('R11.4: destete incluye terneros/as de AMBOS sexos sin weaning; adultos y ya-destetados fuera', () => {
  const profiles = [
    profile({ profileId: 'ternero', sex: 'male', categoryCode: 'ternero', hasWeaning: false }),
    profile({ profileId: 'ternera', sex: 'female', categoryCode: 'ternera', hasWeaning: false }),
    // EXCLUIDOS:
    profile({ profileId: 'ternero-destetado', sex: 'male', categoryCode: 'ternero', hasWeaning: true }),
    profile({ profileId: 'ternera-destetada', sex: 'female', categoryCode: 'ternera', hasWeaning: true }),
    profile({ profileId: 'torito', sex: 'male', categoryCode: 'torito' }),
    profile({ profileId: 'vaquillona', sex: 'female', categoryCode: 'vaquillona' }),
  ];
  const r = buildBulkCandidates('wean', profiles);
  assert.deepEqual(ids(r), ['ternera', 'ternero']);
  assert.equal(r.excludedByRodeoConfig, 0);
});

// ─── R3.5: mellizos = un candidato cada uno (se desteta el ternero, no el parto) ─────────────

test('R3.5: mellizos aparecen cada uno como candidato independiente', () => {
  const profiles = [
    profile({ profileId: 'mellizo-a', sex: 'male', categoryCode: 'ternero' }),
    profile({ profileId: 'mellizo-b', sex: 'female', categoryCode: 'ternera' }),
  ];
  const r = buildBulkCandidates('wean', profiles);
  assert.deepEqual(ids(r), ['mellizo-a', 'mellizo-b']);
});

// ─── R7.2: destete cross-rodeo excluye los de rodeo sin `destete`, con contador ──────────────

test('R7.2: destete cross-rodeo excluye terneros de rodeo sin destete habilitado + cuenta los excluidos', () => {
  const profiles = [
    profile({ profileId: 'a', rodeoId: 'rod-on', categoryCode: 'ternero' }),
    profile({ profileId: 'b', rodeoId: 'rod-off', categoryCode: 'ternera', sex: 'female' }),
    profile({ profileId: 'c', rodeoId: 'rod-off', categoryCode: 'ternero' }),
    profile({ profileId: 'd', rodeoId: 'rod-on', categoryCode: 'ternera', sex: 'female' }),
  ];
  const r = buildBulkCandidates('wean', profiles, {
    rodeoWeaningEnabled: (rodeoId) => rodeoId === 'rod-on',
  });
  assert.deepEqual(ids(r), ['a', 'd']);
  assert.equal(r.excludedByRodeoConfig, 2, 'b y c quedan excluidos por rodeo sin destete');
});

test('R7.2: sin predicado de gating (un solo rodeo habilitado) no excluye a nadie', () => {
  const profiles = [
    profile({ profileId: 'a', categoryCode: 'ternero' }),
    profile({ profileId: 'b', categoryCode: 'ternera', sex: 'female' }),
  ];
  const r = buildBulkCandidates('wean', profiles);
  assert.deepEqual(ids(r), ['a', 'b']);
  assert.equal(r.excludedByRodeoConfig, 0);
});

test('R7.2: el contador de excluidos NO incluye los ya-destetados (esos salen por R11.4, no por config)', () => {
  const profiles = [
    profile({ profileId: 'a', rodeoId: 'rod-off', categoryCode: 'ternero', hasWeaning: false }),
    profile({ profileId: 'destetado', rodeoId: 'rod-off', categoryCode: 'ternero', hasWeaning: true }),
  ];
  const r = buildBulkCandidates('wean', profiles, { rodeoWeaningEnabled: () => false });
  assert.deepEqual(ids(r), []);
  assert.equal(r.excludedByRodeoConfig, 1, 'solo `a` (candidato weanable) cuenta como excluido por config');
});

// ─── Vacunación (R4.1): todo + filtro opcional por categoría/sexo ────────────────────────────

test('R4.1: vacunación por default = todos los activos del grupo (sin filtro)', () => {
  const profiles = [
    profile({ profileId: 'a', sex: 'male', categoryCode: 'ternero' }),
    profile({ profileId: 'b', sex: 'female', categoryCode: 'vaquillona' }),
    profile({ profileId: 'c', sex: 'male', categoryCode: 'toro', isCastrated: false }),
  ];
  const r = buildBulkCandidates('vaccinate', profiles);
  assert.deepEqual(ids(r), ['a', 'b', 'c']);
});

test('R4.1: vacunación con filtro por categoría (subconjunto) restringe el conjunto', () => {
  const profiles = [
    profile({ profileId: 'tern', categoryCode: 'ternero' }),
    profile({ profileId: 'toro', categoryCode: 'toro' }),
    profile({ profileId: 'vaq', categoryCode: 'vaquillona', sex: 'female' }),
  ];
  const r = buildBulkCandidates('vaccinate', profiles, {
    filter: { categoryCodes: ['ternero', 'vaquillona'] },
  });
  assert.deepEqual(ids(r), ['tern', 'vaq']);
});

test('R4.1: vacunación con filtro por sexo', () => {
  const profiles = [
    profile({ profileId: 'm', sex: 'male' }),
    profile({ profileId: 'f', sex: 'female', categoryCode: 'vaquillona' }),
  ];
  const r = buildBulkCandidates('vaccinate', profiles, { filter: { sex: 'female' } });
  assert.deepEqual(ids(r), ['f']);
});

test('R4.1: filtro de vacunación combina categoría Y sexo (AND)', () => {
  const profiles = [
    profile({ profileId: 'tern-m', sex: 'male', categoryCode: 'ternero' }),
    profile({ profileId: 'tern-f', sex: 'female', categoryCode: 'ternera' }),
    profile({ profileId: 'vaq-f', sex: 'female', categoryCode: 'vaquillona' }),
  ];
  const r = buildBulkCandidates('vaccinate', profiles, {
    filter: { categoryCodes: ['ternero', 'ternera'], sex: 'female' },
  });
  assert.deepEqual(ids(r), ['tern-f']);
});

test('R4.1: filtro vacío ([] categoryCodes, sin sexo) = sin filtro (todos)', () => {
  const profiles = [profile({ profileId: 'a' }), profile({ profileId: 'b', sex: 'female', categoryCode: 'ternera' })];
  const r = buildBulkCandidates('vaccinate', profiles, { filter: { categoryCodes: [] } });
  assert.deepEqual(ids(r), ['a', 'b']);
});
