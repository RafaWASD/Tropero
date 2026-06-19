// Tests de la lógica PURA de la afordancia CUT (delta spec 02, TCUT.2 → RCUT.3 / RCUT.6.2). node:test, puro.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type CutEligibilityInfo,
  canMarkCut,
  canUnmarkCut,
  isCutCategory,
} from './cut-eligibility.ts';

// Base: hembra activa, multípara, no-CUT → el caso elegible canónico.
const base: CutEligibilityInfo = {
  sex: 'female',
  status: 'active',
  categoryCode: 'multipara',
  isCut: false,
};

// ─── canMarkCut (RCUT.3.1, RCUT.3.2, RCUT.3.3) ───────────────────────────────────────

test('RCUT.3.1: hembra activa ≠ ternera, no-CUT ⇒ canMarkCut true', () => {
  assert.equal(canMarkCut(base), true);
  // Toda hembra activa ≠ ternera (D2): vaquillona / vaquillona preñada / 2º servicio / multípara.
  for (const code of ['vaquillona', 'vaquillona_prenada', 'vaca_2do_servicio', 'multipara']) {
    assert.equal(canMarkCut({ ...base, categoryCode: code }), true, code);
  }
});

test('RCUT.3.2: macho ⇒ canMarkCut false (CUT es female-only, D3)', () => {
  assert.equal(canMarkCut({ ...base, sex: 'male' }), false);
  assert.equal(canMarkCut({ ...base, sex: null }), false);
});

test('RCUT.3.1: ternera ⇒ canMarkCut false (D2: todas MENOS ternera)', () => {
  assert.equal(canMarkCut({ ...base, categoryCode: 'ternera' }), false);
});

test('RCUT.3.1: ya-CUT ⇒ canMarkCut false (no se re-marca)', () => {
  assert.equal(canMarkCut({ ...base, isCut: true }), false);
});

test('RCUT.5.6: archivada/inactiva ⇒ canMarkCut false', () => {
  const inactive: CutEligibilityInfo['status'][] = ['sold', 'dead', 'transferred'];
  for (const status of inactive) {
    assert.equal(canMarkCut({ ...base, status }), false, status);
  }
});

test('RCUT.3.3: categoryCode null/"" ⇒ canMarkCut false (conservador, no marcar a ciegas)', () => {
  assert.equal(canMarkCut({ ...base, categoryCode: null }), false);
  assert.equal(canMarkCut({ ...base, categoryCode: '' }), false);
});

// ─── canUnmarkCut (RCUT.5.4 / RCUT.7.2) ──────────────────────────────────────────────

test('RCUT.5.4: hembra activa que YA es CUT ⇒ canUnmarkCut true', () => {
  assert.equal(canUnmarkCut({ ...base, isCut: true }), true);
});

test('RCUT.5.4: hembra activa no-CUT ⇒ canUnmarkCut false (nada que quitar)', () => {
  assert.equal(canUnmarkCut(base), false);
});

test('RCUT.7.2: quitar CUT NO depende de categoryCode (un CUT ya tiene categoría fijada)', () => {
  // Incluso con categoryCode raro/null, una hembra CUT activa puede DESMARCAR (sustractivo, no gateado).
  assert.equal(canUnmarkCut({ ...base, isCut: true, categoryCode: null }), true);
  assert.equal(canUnmarkCut({ ...base, isCut: true, categoryCode: 'cut' }), true);
});

test('RCUT.5.6: archivada que es CUT ⇒ canUnmarkCut false (no se reorganiza un archivado)', () => {
  assert.equal(canUnmarkCut({ ...base, isCut: true, status: 'sold' }), false);
});

test('macho CUT (no debería existir) ⇒ canUnmarkCut false (female-only)', () => {
  assert.equal(canUnmarkCut({ ...base, sex: 'male', isCut: true }), false);
});

// ─── mutua exclusión: nunca ambas a la vez ──────────────────────────────────────────

test('canMarkCut y canUnmarkCut son mutuamente excluyentes para cualquier estado', () => {
  const sexes: CutEligibilityInfo['sex'][] = ['male', 'female', null];
  const statuses: CutEligibilityInfo['status'][] = ['active', 'sold', 'dead', 'transferred'];
  const codes: CutEligibilityInfo['categoryCode'][] = ['multipara', 'ternera', 'cut', '', null];
  for (const sex of sexes) {
    for (const status of statuses) {
      for (const categoryCode of codes) {
        for (const isCut of [true, false]) {
          const info: CutEligibilityInfo = { sex, status, categoryCode, isCut };
          assert.equal(canMarkCut(info) && canUnmarkCut(info), false, JSON.stringify(info));
        }
      }
    }
  }
});

// ─── isCutCategory (RCUT.6.2) ────────────────────────────────────────────────────────

test('RCUT.6.2: code === "cut" ⇒ true (ruta preferida)', () => {
  assert.equal(isCutCategory({ code: 'cut' }), true);
  assert.equal(isCutCategory({ code: 'cut', label: 'Vaquillona' }), true); // code manda sobre label
});

test('RCUT.6.2: code presente y ≠ "cut" ⇒ false (no cae al fallback de label)', () => {
  assert.equal(isCutCategory({ code: 'multipara' }), false);
  assert.equal(isCutCategory({ code: 'multipara', label: 'CUT' }), false); // code manda
});

test('RCUT.6.2: fallback por label "CUT" cuando no hay code (tolerante a casing/espacios)', () => {
  assert.equal(isCutCategory({ label: 'CUT' }), true);
  assert.equal(isCutCategory({ label: 'cut' }), true);
  assert.equal(isCutCategory({ label: '  CUT  ' }), true);
  assert.equal(isCutCategory({ code: '', label: 'CUT' }), true); // code vacío → cae al fallback
  assert.equal(isCutCategory({ code: null, label: 'CUT' }), true);
});

test('RCUT.6.2: label no-CUT ⇒ false; sin code ni label ⇒ false', () => {
  assert.equal(isCutCategory({ label: 'Vaquillona' }), false);
  assert.equal(isCutCategory({ label: '' }), false);
  assert.equal(isCutCategory({}), false);
  assert.equal(isCutCategory({ code: null, label: null }), false);
});
