// Tests del estado de selección masiva (spec 10, T-CL.4 / R11.3, R11.4, R11.5, R11.7, R11.8, R5.6).
// PURO: sin SDK/RN/supabase → corre siempre con node:test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { type GroupProfile } from './bulk-candidates.ts';
import {
  buildBulkSelectionState,
  clearOverridesInSelection,
  toggleProfile,
  toggleSection,
  sectionCheckState,
  selectedCount,
  summarizeSelection,
} from './bulk-selection.ts';

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

const selectedIds = (s: { selected: ReadonlySet<string> }) => [...s.selected].sort();
const sectionByKey = (state: ReturnType<typeof buildBulkSelectionState>, key: string) =>
  state.sections.find((sec) => sec.key === key)!;

// ─── R11.3: defaults EXACTOS de castración ──────────────────────────────────────────────────

test('R11.3: castración pre-tilda SOLO terneros comunes; ⭐ y adultos arrancan SIN tildar', () => {
  const candidates = [
    profile({ profileId: 'tern-comun-1', categoryCode: 'ternero', futureBull: false }),
    profile({ profileId: 'tern-comun-2', categoryCode: 'ternero', futureBull: false }),
    profile({ profileId: 'tern-estrella', categoryCode: 'ternero', futureBull: true }), // ⭐ → NO tildado
    profile({ profileId: 'torito', categoryCode: 'torito' }), // adulto → NO tildado
    profile({ profileId: 'toro', categoryCode: 'toro' }), // adulto → NO tildado
  ];
  const state = buildBulkSelectionState('castrate', candidates);
  // Solo los 2 terneros comunes arrancan tildados.
  assert.deepEqual(selectedIds(state), ['tern-comun-1', 'tern-comun-2']);
  // Las secciones: Terneros (los 3) + Adultos (torito/toro).
  assert.deepEqual(
    sectionByKey(state, 'terneros').profiles.map((p) => p.profileId).sort(),
    ['tern-comun-1', 'tern-comun-2', 'tern-estrella'],
  );
  assert.deepEqual(
    sectionByKey(state, 'adultos').profiles.map((p) => p.profileId).sort(),
    ['torito', 'toro'],
  );
});

test('R11.3: el ⭐ (future_bull) NUNCA arranca tildado en castración, aunque sea el único ternero', () => {
  const candidates = [profile({ profileId: 'solo-estrella', categoryCode: 'ternero', futureBull: true })];
  const state = buildBulkSelectionState('castrate', candidates);
  assert.deepEqual(selectedIds(state), []);
});

// ─── R11.4: defaults EXACTOS de destete ─────────────────────────────────────────────────────

test('R11.4: destete pre-tilda a TODOS los terneros/as (ambos sexos), sin lógica de ⭐', () => {
  const candidates = [
    profile({ profileId: 'ternero-1', categoryCode: 'ternero' }),
    profile({ profileId: 'ternero-estrella', categoryCode: 'ternero', futureBull: true }), // ⭐ igual tildado
    profile({ profileId: 'ternera-1', categoryCode: 'ternera', sex: 'female' }),
  ];
  const state = buildBulkSelectionState('wean', candidates);
  assert.deepEqual(selectedIds(state), ['ternera-1', 'ternero-1', 'ternero-estrella']);
  // Secciones: Terneros / Terneras.
  assert.deepEqual(
    sectionByKey(state, 'terneros').profiles.map((p) => p.profileId).sort(),
    ['ternero-1', 'ternero-estrella'],
  );
  assert.deepEqual(
    sectionByKey(state, 'terneras').profiles.map((p) => p.profileId),
    ['ternera-1'],
  );
});

// ─── R11.5 / R11.7: contador vivo + CTA count == seleccionados ───────────────────────────────

test('R11.7: selectedCount == cantidad de tildados (CTA en vivo)', () => {
  const candidates = [
    profile({ profileId: 'a', categoryCode: 'ternero' }),
    profile({ profileId: 'b', categoryCode: 'ternero' }),
    profile({ profileId: 'c', categoryCode: 'torito' }),
  ];
  const state = buildBulkSelectionState('castrate', candidates);
  assert.equal(selectedCount(state), 2); // a, b (terneros comunes); c (adulto) no
});

test('R11.7: CTA en 0 cuando se destilda todo (la UI lo deshabilita)', () => {
  const candidates = [profile({ profileId: 'a', categoryCode: 'ternero' })];
  let state = buildBulkSelectionState('castrate', candidates);
  assert.equal(selectedCount(state), 1);
  const next = toggleProfile(state.selected, 'a');
  state = { ...state, selected: next };
  assert.equal(selectedCount(state), 0);
});

test('R11.5: toggle de UN animal es inmutable (no muta el set recibido) y se refleja en el conteo', () => {
  const candidates = [
    profile({ profileId: 'a', categoryCode: 'torito' }), // adulto, arranca destildado
    profile({ profileId: 'b', categoryCode: 'ternero' }),
  ];
  const state = buildBulkSelectionState('castrate', candidates);
  const before = new Set(state.selected);
  const next = toggleProfile(state.selected, 'a'); // tilda el adulto
  // El set original NO se mutó.
  assert.deepEqual([...state.selected].sort(), [...before].sort());
  // El nuevo set suma 'a'.
  assert.deepEqual([...next].sort(), ['a', 'b']);
});

// ─── R11.5: "todos/ninguno" por sección + estado del control ─────────────────────────────────

test('R11.5: toggleSection(check=true) tilda TODA la sección sin tocar las otras', () => {
  const candidates = [
    profile({ profileId: 'tern', categoryCode: 'ternero' }),
    profile({ profileId: 'tor', categoryCode: 'torito' }),
    profile({ profileId: 'tro', categoryCode: 'toro' }),
  ];
  const state = buildBulkSelectionState('castrate', candidates);
  const adultos = sectionByKey(state, 'adultos');
  const next = toggleSection(state.selected, adultos, true);
  // Ahora están tildados el ternero (default) + los 2 adultos.
  assert.deepEqual([...next].sort(), ['tern', 'tor', 'tro']);
});

test('R11.5: toggleSection(check=false) destilda TODA la sección', () => {
  const candidates = [
    profile({ profileId: 'a', categoryCode: 'ternera', sex: 'female' }),
    profile({ profileId: 'b', categoryCode: 'ternera', sex: 'female' }),
    profile({ profileId: 'm', categoryCode: 'ternero' }),
  ];
  const state = buildBulkSelectionState('wean', candidates); // todos tildados
  const terneras = sectionByKey(state, 'terneras');
  const next = toggleSection(state.selected, terneras, false);
  assert.deepEqual([...next].sort(), ['m']); // solo el ternero queda tildado
});

test('R11.5: sectionCheckState = all/none/some según la selección', () => {
  const candidates = [
    profile({ profileId: 'tern', categoryCode: 'ternero' }),
    profile({ profileId: 'tor1', categoryCode: 'torito' }),
    profile({ profileId: 'tor2', categoryCode: 'toro' }),
  ];
  const state = buildBulkSelectionState('castrate', candidates);
  const terneros = sectionByKey(state, 'terneros');
  const adultos = sectionByKey(state, 'adultos');
  // Default: terneros all (el único ternero está tildado), adultos none.
  assert.equal(sectionCheckState(state.selected, terneros), 'all');
  assert.equal(sectionCheckState(state.selected, adultos), 'none');
  // Tildar UN adulto → 'some' (indeterminado).
  const some = toggleProfile(state.selected, 'tor1');
  assert.equal(sectionCheckState(some, adultos), 'some');
  // Tildar el otro → 'all'.
  const all = toggleProfile(some, 'tor2');
  assert.equal(sectionCheckState(all, adultos), 'all');
});

test('R11.5: sectionCheckState de una sección VACÍA = none', () => {
  const candidates = [profile({ profileId: 'tern', categoryCode: 'ternero' })];
  const state = buildBulkSelectionState('castrate', candidates);
  const adultos = sectionByKey(state, 'adultos'); // vacía
  assert.equal(adultos.profiles.length, 0);
  assert.equal(sectionCheckState(state.selected, adultos), 'none');
});

// ─── R11.8 / R5.6: desglose del bottom-sheet ─────────────────────────────────────────────────

test('R11.8: el desglose por categoría suma EXACTAMENTE el total seleccionado', () => {
  const candidates = [
    profile({ profileId: 't1', categoryCode: 'ternero' }),
    profile({ profileId: 't2', categoryCode: 'ternero' }),
    profile({ profileId: 'tor1', categoryCode: 'torito' }),
    profile({ profileId: 'tor2', categoryCode: 'torito' }),
    profile({ profileId: 'tro', categoryCode: 'toro' }),
  ];
  let state = buildBulkSelectionState('castrate', candidates);
  // Tildar TODO (terneros + adultos) para un desglose rico.
  let sel = state.selected;
  for (const sec of state.sections) sel = toggleSection(sel, sec, true);
  state = { ...state, selected: sel };

  const summary = summarizeSelection(state);
  assert.equal(summary.total, 5);
  // El desglose suma el total.
  const sum = summary.byCategory.reduce((n, c) => n + c.count, 0);
  assert.equal(sum, summary.total);
  // Y los conteos por categoría son correctos.
  const map = Object.fromEntries(summary.byCategory.map((c) => [c.categoryCode, c.count]));
  assert.deepEqual(map, { ternero: 2, torito: 2, toro: 1 });
});

test('R11.8: futureBullCount cuenta los ⭐ SELECCIONADOS (aviso de futuros toritos)', () => {
  const candidates = [
    profile({ profileId: 'comun', categoryCode: 'ternero', futureBull: false }),
    profile({ profileId: 'estrella-1', categoryCode: 'ternero', futureBull: true }),
    profile({ profileId: 'estrella-2', categoryCode: 'ternero', futureBull: true }),
  ];
  const state = buildBulkSelectionState('castrate', candidates);
  // Default: solo 'comun' tildado → 0 ⭐ seleccionados.
  assert.equal(summarizeSelection(state).futureBullCount, 0);
  // Tildar un ⭐ → futureBullCount=1; el total sube a 2.
  const sel = toggleProfile(state.selected, 'estrella-1');
  const summary = summarizeSelection(state, sel);
  assert.equal(summary.total, 2);
  assert.equal(summary.futureBullCount, 1);
});

test('R5.6: overrideCount cuenta los SELECCIONADOS con category_override=true', () => {
  const candidates = [
    profile({ profileId: 'normal', categoryCode: 'ternero', categoryOverride: false }),
    profile({ profileId: 'fijado', categoryCode: 'ternero', categoryOverride: true }),
  ];
  const state = buildBulkSelectionState('castrate', candidates); // ambos terneros comunes → tildados
  const summary = summarizeSelection(state);
  assert.equal(summary.total, 2);
  assert.equal(summary.overrideCount, 1);
});

test('R5.6: overrideCount default 0 cuando categoryOverride no se provee (campo opcional)', () => {
  const candidates = [profile({ profileId: 'a', categoryCode: 'ternero' })]; // sin categoryOverride
  const state = buildBulkSelectionState('castrate', candidates);
  assert.equal(summarizeSelection(state).overrideCount, 0);
});

// ─── R5.6: clearOverridesInSelection (refresh OPTIMISTA tras revertir — fix re-fetch que parpadea) ──

test('clearOverridesInSelection: limpia override de los revertidos → overrideCount baja, selección intacta', () => {
  const candidates = [
    profile({ profileId: 'fijado-1', categoryCode: 'ternero', categoryOverride: true }),
    profile({ profileId: 'fijado-2', categoryCode: 'ternero', categoryOverride: true }),
    profile({ profileId: 'normal', categoryCode: 'ternero', categoryOverride: false }),
  ];
  const state = buildBulkSelectionState('castrate', candidates); // los 3 terneros comunes → tildados
  assert.equal(summarizeSelection(state).overrideCount, 2);

  // Revertimos solo 'fijado-1'.
  const next = clearOverridesInSelection(state, new Set(['fijado-1']));
  // overrideCount baja a 1 (queda 'fijado-2'); el total/selección NO cambia.
  assert.equal(summarizeSelection(next).overrideCount, 1);
  assert.equal(summarizeSelection(next).total, 3);
  assert.deepEqual(selectedIds(next), selectedIds(state));

  // Revertimos los dos → overrideCount 0.
  const cleared = clearOverridesInSelection(state, new Set(['fijado-1', 'fijado-2']));
  assert.equal(summarizeSelection(cleared).overrideCount, 0);
  assert.equal(summarizeSelection(cleared).total, 3);
});

test('clearOverridesInSelection: PURO — no muta el estado de entrada', () => {
  const candidates = [profile({ profileId: 'fijado', categoryCode: 'ternero', categoryOverride: true })];
  const state = buildBulkSelectionState('castrate', candidates);
  const next = clearOverridesInSelection(state, new Set(['fijado']));
  // El input conserva su override (no mutado); el resultado es un objeto NUEVO.
  assert.equal(summarizeSelection(state).overrideCount, 1);
  assert.equal(summarizeSelection(next).overrideCount, 0);
  assert.notEqual(next, state);
  assert.notEqual(next.sections, state.sections);
});

test('clearOverridesInSelection: set vacío → devuelve el MISMO estado (no-op, identidad estable)', () => {
  const candidates = [profile({ profileId: 'fijado', categoryCode: 'ternero', categoryOverride: true })];
  const state = buildBulkSelectionState('castrate', candidates);
  const next = clearOverridesInSelection(state, new Set());
  assert.equal(next, state); // misma referencia: no re-render de gusto
});

test('clearOverridesInSelection: ids ajenos (no tildados / inexistentes) no afectan a nadie', () => {
  const candidates = [profile({ profileId: 'fijado', categoryCode: 'ternero', categoryOverride: true })];
  const state = buildBulkSelectionState('castrate', candidates);
  const next = clearOverridesInSelection(state, new Set(['otro-que-no-existe']));
  assert.equal(summarizeSelection(next).overrideCount, 1); // 'fijado' sigue con override
});

test('R11.8/R5.6: desglose de DESTETE suma terneros+terneras y cuenta override (sin lógica ⭐)', () => {
  const candidates = [
    profile({ profileId: 'tm1', categoryCode: 'ternero' }),
    profile({ profileId: 'tm2', categoryCode: 'ternero', categoryOverride: true }),
    profile({ profileId: 'tf1', categoryCode: 'ternera', sex: 'female' }),
    profile({ profileId: 'tf-estrella', categoryCode: 'ternera', sex: 'female', futureBull: true }),
  ];
  const state = buildBulkSelectionState('wean', candidates); // todos tildados
  const summary = summarizeSelection(state);
  assert.equal(summary.total, 4);
  const map = Object.fromEntries(summary.byCategory.map((c) => [c.categoryCode, c.count]));
  assert.deepEqual(map, { ternero: 2, ternera: 2 });
  assert.equal(summary.overrideCount, 1); // tm2
  // En destete el ⭐ NO genera aviso: futureBullCount se reporta pero la UI lo ignora en wean (R11.4).
  // El módulo es operación-agnóstico en el conteo; la decisión de mostrarlo es de la UI (Fase 4).
  assert.equal(summary.futureBullCount, 1);
});

test('R11.8: summarize sobre 0 seleccionados → total 0, sin categorías, sin ⭐ ni override', () => {
  const candidates = [profile({ profileId: 'a', categoryCode: 'torito' })]; // adulto → no tildado
  const state = buildBulkSelectionState('castrate', candidates);
  const summary = summarizeSelection(state);
  assert.deepEqual(summary, { total: 0, byCategory: [], futureBullCount: 0, overrideCount: 0 });
});

// ─── invariante CTA == desglose ──────────────────────────────────────────────────────────────

test('invariante: selectedCount(state) == summarizeSelection(state).total para cualquier selección', () => {
  const candidates = [
    profile({ profileId: 'a', categoryCode: 'ternero', futureBull: true }),
    profile({ profileId: 'b', categoryCode: 'ternero' }),
    profile({ profileId: 'c', categoryCode: 'torito' }),
    profile({ profileId: 'd', categoryCode: 'toro' }),
  ];
  let state = buildBulkSelectionState('castrate', candidates);
  // Varios toggles arbitrarios.
  let sel = state.selected;
  sel = toggleProfile(sel, 'a'); // tilda ⭐
  sel = toggleProfile(sel, 'c'); // tilda adulto
  sel = toggleProfile(sel, 'b'); // destilda el ternero común
  state = { ...state, selected: sel };
  assert.equal(selectedCount(state), summarizeSelection(state).total);
});
