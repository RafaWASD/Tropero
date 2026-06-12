// Tests del preview de la VACUNACIÓN masiva (spec 10, T-UI.6 / R4.2, R4.3, R4.4, R6.3, R7.2).
// PURO: sin SDK/RN/supabase → corre siempre con node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVaccinationPreview,
  deriveCategoryFilterOptions,
} from './vaccination-preview.ts';
import { bulkEventId } from './bulk-idempotency.ts';
import type { GroupProfile } from './bulk-candidates.ts';

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

const DATE = '2026-06-12';
const idFor = (profileId: string) =>
  bulkEventId({ animalProfileId: profileId, type: 'vaccination', date: DATE });

// ─── R4.2: N eventos sobre M animales (sin skips) ─────────────────────────────────────────────

test('R4.2: sin skips → N eventos = M animales = total candidatos', () => {
  const candidates = [profile({ profileId: 'a' }), profile({ profileId: 'b' }), profile({ profileId: 'c' })];
  const preview = buildVaccinationPreview(candidates, DATE, new Set());
  assert.equal(preview.animalsToApply, 3);
  assert.equal(preview.eventsToApply, 3); // 1 evento por animal (R3.1)
  assert.equal(preview.totalCandidates, 3);
  assert.equal(preview.skippedTotal, 0);
  assert.deepEqual(
    preview.toApply.map((p) => p.profileId),
    ['a', 'b', 'c'], // orden preservado
  );
});

test('R4.2: conjunto candidato vacío → preview en cero (empty state)', () => {
  const preview = buildVaccinationPreview([], DATE, new Set());
  assert.equal(preview.animalsToApply, 0);
  assert.equal(preview.eventsToApply, 0);
  assert.equal(preview.totalCandidates, 0);
  assert.equal(preview.skippedTotal, 0);
});

// ─── R4.3/R6.3: skip already_applied (idempotencia) ───────────────────────────────────────────

test('R4.3/R6.3: los ya-vacunados de esa fecha se SALTAN (already_applied) por id determinístico', () => {
  const candidates = [profile({ profileId: 'a' }), profile({ profileId: 'b' }), profile({ profileId: 'c' })];
  // 'b' ya tiene el evento de esta fecha localmente (su UUIDv5 está presente).
  const existing = new Set([idFor('b')]);
  const preview = buildVaccinationPreview(candidates, DATE, existing);
  assert.equal(preview.totalCandidates, 3);
  assert.equal(preview.animalsToApply, 2);
  assert.equal(preview.skipped.alreadyApplied, 1);
  assert.equal(preview.skipped.rodeoDisabled, 0);
  assert.equal(preview.skippedTotal, 1);
  assert.deepEqual(preview.toApply.map((p) => p.profileId), ['a', 'c']);
});

test('R6.3: re-ejecutar con TODOS ya aplicados → 0 nuevos (el preview refleja solo lo nuevo)', () => {
  const candidates = [profile({ profileId: 'a' }), profile({ profileId: 'b' })];
  const existing = new Set([idFor('a'), idFor('b')]);
  const preview = buildVaccinationPreview(candidates, DATE, existing);
  assert.equal(preview.animalsToApply, 0);
  assert.equal(preview.skipped.alreadyApplied, 2);
  assert.equal(preview.toApply.length, 0);
});

// ─── R7.2: skip rodeo sin vacunación habilitado (lote cross-rodeo) ────────────────────────────

test('R7.2: en lote cross-rodeo, los de rodeo SIN vacunación habilitado se saltan (rodeoDisabled)', () => {
  const candidates = [
    profile({ profileId: 'a', rodeoId: 'on' }),
    profile({ profileId: 'b', rodeoId: 'off' }),
    profile({ profileId: 'c', rodeoId: 'on' }),
  ];
  const enabled = (rodeoId: string) => rodeoId === 'on';
  const preview = buildVaccinationPreview(candidates, DATE, new Set(), enabled);
  assert.equal(preview.animalsToApply, 2);
  assert.equal(preview.skipped.rodeoDisabled, 1);
  assert.equal(preview.skipped.alreadyApplied, 0);
  assert.deepEqual(preview.toApply.map((p) => p.profileId), ['a', 'c']);
});

test('R7.2: sin predicado de gating (rodeo único / irresoluble) NO excluye a nadie por rodeo', () => {
  const candidates = [profile({ profileId: 'a', rodeoId: 'x' }), profile({ profileId: 'b', rodeoId: 'y' })];
  const preview = buildVaccinationPreview(candidates, DATE, new Set()); // sin predicado
  assert.equal(preview.animalsToApply, 2);
  assert.equal(preview.skipped.rodeoDisabled, 0);
});

// ─── Precedencia de skips: rodeoDisabled GANA, sin doble-conteo ───────────────────────────────

test('R4.3: rodeoDisabled tiene PRECEDENCIA sobre already_applied (sin doble-conteo en los totales)', () => {
  // 'b' está en rodeo OFF y además YA tiene el evento → se cuenta UNA vez, en rodeoDisabled.
  const candidates = [
    profile({ profileId: 'a', rodeoId: 'on' }),
    profile({ profileId: 'b', rodeoId: 'off' }),
  ];
  const existing = new Set([idFor('b')]);
  const enabled = (rodeoId: string) => rodeoId === 'on';
  const preview = buildVaccinationPreview(candidates, DATE, existing, enabled);
  assert.equal(preview.skipped.rodeoDisabled, 1);
  assert.equal(preview.skipped.alreadyApplied, 0); // NO se contó dos veces
  assert.equal(preview.skippedTotal, 1);
  assert.equal(preview.animalsToApply, 1); // solo 'a'
});

// ─── R4.4: el conjunto a aplicar excluye los saltados (no se crea mutación sobre un saltado) ──

test('R4.4: toApply NO incluye ningún animal saltado (ni already_applied ni rodeoDisabled)', () => {
  const candidates = [
    profile({ profileId: 'apply', rodeoId: 'on' }),
    profile({ profileId: 'applied', rodeoId: 'on' }),
    profile({ profileId: 'disabled', rodeoId: 'off' }),
  ];
  const existing = new Set([idFor('applied')]);
  const enabled = (rodeoId: string) => rodeoId === 'on';
  const preview = buildVaccinationPreview(candidates, DATE, existing, enabled);
  assert.deepEqual(preview.toApply.map((p) => p.profileId), ['apply']);
  assert.equal(preview.skippedTotal, 2);
});

// ─── Filtro de categoría derivado del conjunto candidato (R4.1) ───────────────────────────────

test('R4.1: deriveCategoryFilterOptions = categorías REALMENTE presentes, con conteo y orden de aparición', () => {
  const profiles = [
    { categoryCode: 'ternero', categoryName: 'Ternero' },
    { categoryCode: 'ternera', categoryName: 'Ternera' },
    { categoryCode: 'ternero', categoryName: 'Ternero' },
    { categoryCode: 'vaca_segundo_servicio', categoryName: 'Vaca 2º servicio' },
  ];
  const opts = deriveCategoryFilterOptions(profiles);
  assert.deepEqual(
    opts.map((o) => [o.code, o.count]),
    [
      ['ternero', 2],
      ['ternera', 1],
      ['vaca_segundo_servicio', 1],
    ],
  );
  assert.equal(opts[0].name, 'Ternero'); // name legible preservado
});

test('R4.1: deriveCategoryFilterOptions cae al code si no hay name legible; lista vacía → []', () => {
  assert.deepEqual(deriveCategoryFilterOptions([]), []);
  const opts = deriveCategoryFilterOptions([{ categoryCode: 'torito' }]);
  assert.equal(opts[0].name, 'torito');
});
