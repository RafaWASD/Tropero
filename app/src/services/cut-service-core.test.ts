// Tests del núcleo PURO de marcar/quitar CUT (delta spec 02, TCUT.7 → RCUT.1/RCUT.2). node:test, con fakes
// del resolve + del write (sin SDK/SQLite). Verifica el contrato de los servicios setCut/unsetCut, que
// delegan en decideSetCut/decideUnsetCut: resuelve+escribe el UPDATE esperado / falla SIN escribir cuando no
// hay id resuelto / propaga el error del write.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  type ResolveOutcome,
  type WriteOutcome,
  CUT_RESOLVE_FAIL_MESSAGE,
  UNCUT_RESOLVE_FAIL_MESSAGE,
  decideSetCut,
  decideUnsetCut,
} from './cut-service-core.ts';

const okWrite = (): Promise<WriteOutcome> => Promise.resolve({ ok: true });

// ─── decideSetCut (RCUT.1) ───────────────────────────────────────────────────────────

test('RCUT.1.1: resuelve cutCategoryId ⇒ escribe con ESE id y devuelve ok', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: 'cat-cut', derivedCategoryId: 'cat-multi' } };
  const writes: string[] = [];
  const r = await decideSetCut(resolve, (id) => {
    writes.push(id);
    return okWrite();
  });
  assert.deepEqual(r, { ok: true, value: true });
  assert.deepEqual(writes, ['cat-cut']); // escribió UNA vez, con el cutCategoryId (no el derivado)
});

test('RCUT.1.2: cutCategoryId null ⇒ error es-AR SIN escribir', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: null, derivedCategoryId: 'cat-multi' } };
  let wrote = false;
  const r = await decideSetCut(resolve, () => {
    wrote = true;
    return okWrite();
  });
  assert.equal(r.ok, false);
  assert.equal(wrote, false, 'NO debe escribir si no resolvió la categoría CUT');
  if (!r.ok) {
    assert.equal(r.error.kind, 'unknown');
    assert.equal(r.error.message, CUT_RESOLVE_FAIL_MESSAGE);
  }
});

test('RCUT.1: resolve falla (error de I/O) ⇒ propaga el error SIN escribir', async () => {
  const resolve: ResolveOutcome = { ok: false, error: { kind: 'network', message: 'Sin conexión.' } };
  let wrote = false;
  const r = await decideSetCut(resolve, () => {
    wrote = true;
    return okWrite();
  });
  assert.equal(r.ok, false);
  assert.equal(wrote, false);
  if (!r.ok) assert.equal(r.error.kind, 'network');
});

test('RCUT.1.3: el write local falla ⇒ propaga el error del write (no inventa ok)', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: 'cat-cut', derivedCategoryId: null } };
  const r = await decideSetCut(resolve, () =>
    Promise.resolve({ ok: false, error: { kind: 'unknown', message: 'Error al escribir datos locales.' } }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.message, 'Error al escribir datos locales.');
});

// ─── decideUnsetCut (RCUT.2) ─────────────────────────────────────────────────────────

test('RCUT.2.1: resuelve derivedCategoryId ⇒ escribe con la DERIVADA y devuelve ok', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: 'cat-cut', derivedCategoryId: 'cat-multi' } };
  const writes: string[] = [];
  const r = await decideUnsetCut(resolve, (id) => {
    writes.push(id);
    return okWrite();
  });
  assert.deepEqual(r, { ok: true, value: true });
  assert.deepEqual(writes, ['cat-multi']); // escribió con el DERIVADO (no el cut) → buildUnsetCutUpdate resetea is_cut
});

test('RCUT.2.2: derivedCategoryId null ⇒ error es-AR SIN escribir (no deja is_cut colgado)', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: 'cat-cut', derivedCategoryId: null } };
  let wrote = false;
  const r = await decideUnsetCut(resolve, () => {
    wrote = true;
    return okWrite();
  });
  assert.equal(r.ok, false);
  assert.equal(wrote, false);
  if (!r.ok) {
    assert.equal(r.error.kind, 'unknown');
    assert.equal(r.error.message, UNCUT_RESOLVE_FAIL_MESSAGE);
  }
});

test('RCUT.2: resolve falla ⇒ propaga SIN escribir', async () => {
  const resolve: ResolveOutcome = { ok: false, error: { kind: 'unknown', message: 'No se encontró el animal.' } };
  let wrote = false;
  const r = await decideUnsetCut(resolve, () => {
    wrote = true;
    return okWrite();
  });
  assert.equal(r.ok, false);
  assert.equal(wrote, false);
});

test('RCUT.2: el write local del desmarcado falla ⇒ propaga el error', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: null, derivedCategoryId: 'cat-multi' } };
  const r = await decideUnsetCut(resolve, () =>
    Promise.resolve({ ok: false, error: { kind: 'unknown', message: 'boom' } }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.message, 'boom');
});

// Diferencia clave SET vs UNSET: el SET escribe el cutCategoryId; el UNSET escribe el derivedCategoryId.
test('RCUT.1/RCUT.2: SET usa cutCategoryId, UNSET usa derivedCategoryId (distintos ids)', async () => {
  const resolve: ResolveOutcome = { ok: true, value: { cutCategoryId: 'CUT', derivedCategoryId: 'DERIVED' } };
  let setId = '';
  let unsetId = '';
  await decideSetCut(resolve, (id) => { setId = id; return okWrite(); });
  await decideUnsetCut(resolve, (id) => { unsetId = id; return okWrite(); });
  assert.equal(setId, 'CUT');
  assert.equal(unsetId, 'DERIVED');
  assert.notEqual(setId, unsetId);
});

