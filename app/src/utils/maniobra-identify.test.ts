// Tests de la lógica PURA de IDENTIFICACIÓN en MODO MANIOBRAS (spec 03 M2.1-core). node:test (mismo
// runner que el resto de la suite unit). Cubre R3.3 (resolución por tag → found/unknown), R4.3 (BLE
// desempata por tag → nunca ambiguo), R4.5 (otro establecimiento → avisar + saltar), R3.5 (manual
// idv/visual → found/unknown), R4.2 (manual multi-candidato → ambiguous, estado seguro), el gate de
// auto-avance, y el precargado del find-or-create.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveBleIdentify,
  resolveManualIdentify,
  shouldAutoAdvance,
  resolvePrefilledCreateParams,
  type IdentifyOutcome,
} from './maniobra-identify';

const EID = '982000412345678';

// ─── BLE (R3.3 / R4.3 / R4.5) ──────────────────────────────────────────────────────────

test('R3.3: lookupByTag edit → found (cargar sobre el animal del campo activo)', () => {
  const out = resolveBleIdentify({ mode: 'edit', profileId: 'p1' }, EID);
  assert.equal(out.kind, 'found');
  assert.equal(out.source, 'ble');
  assert.equal(out.identifier, EID);
  if (out.kind === 'found') assert.equal(out.animal.profileId, 'p1');
});

test('R4.5: lookupByTag transfer → other_establishment (avisar + saltar, NO transferir)', () => {
  const out = resolveBleIdentify(
    { mode: 'transfer', sourceProfileId: 'src', otherFieldName: 'Campo Vecino' },
    EID,
  );
  assert.equal(out.kind, 'other_establishment');
  if (out.kind === 'other_establishment') {
    assert.equal(out.sourceProfileId, 'src');
    assert.equal(out.otherFieldName, 'Campo Vecino');
    assert.equal(out.identifier, EID);
  }
});

test('R3.3: lookupByTag create → unknown (find-or-create inline con el tag precargado)', () => {
  const out = resolveBleIdentify({ mode: 'create' }, EID);
  assert.equal(out.kind, 'unknown');
  assert.equal(out.source, 'ble');
  assert.equal(out.identifier, EID);
});

test('R4.3: el BLE nunca devuelve ambiguous (el tag es único global → desempata solo)', () => {
  // Cualquiera de las 3 ramas del lookup por tag NO produce `ambiguous` (esa rama es exclusiva del manual).
  for (const r of [
    { mode: 'edit' as const, profileId: 'p' },
    { mode: 'transfer' as const, sourceProfileId: 's', otherFieldName: 'X' },
    { mode: 'create' as const },
  ]) {
    assert.notEqual(resolveBleIdentify(r, EID).kind, 'ambiguous');
  }
});

// ─── Manual (R3.5 / R4.2) ────────────────────────────────────────────────────────────────

test('R3.5: manual con 0 candidatos → unknown (find-or-create con el texto precargado)', () => {
  const out = resolveManualIdentify([], '0421');
  assert.equal(out.kind, 'unknown');
  assert.equal(out.source, 'manual');
  assert.equal(out.identifier, '0421');
});

test('R3.5: manual con 1 candidato que matchea EXACTO el idv → found (auto-avance, camino rápido)', () => {
  const out = resolveManualIdentify([{ profileId: 'pX', idv: '0421', apodo: null }], '0421');
  assert.equal(out.kind, 'found');
  if (out.kind === 'found') assert.equal(out.animal.profileId, 'pX');
});

test('IDU.4.11: 1 candidato que matchea EXACTO el APODO (case-insensitive + trim) → found', () => {
  const out = resolveManualIdentify([{ profileId: 'pV', idv: null, apodo: 'Manchada' }], ' MANCHADA ');
  assert.equal(out.kind, 'found');
  if (out.kind === 'found') assert.equal(out.animal.profileId, 'pV');
});

test('R3.5: 1 candidato que matchea EXACTO el tag electrónico → found', () => {
  const out = resolveManualIdentify([{ profileId: 'pT', idv: null, apodo: null, tagElectronic: EID }], EID);
  assert.equal(out.kind, 'found');
  if (out.kind === 'found') assert.equal(out.animal.profileId, 'pT');
});

// FIX "otra caravana" (2026-06-15): un único candidato que SÓLO matchea por substring (su caravana CONTIENE
// el texto, ej. tecleo "42" → idv "1428") NO auto-avanza: se devuelve ambiguous → confirmación explícita.
test('FIX otra-caravana: 1 candidato substring (NO exacto) → ambiguous (confirmar, NO auto-cargar el equivocado)', () => {
  const out = resolveManualIdentify(
    [{ profileId: 'wrong', idv: '1428', apodo: 'X-1428', tagElectronic: null, rodeoName: 'Cría hembras', categoryName: 'Vaquillona' }],
    '42',
  );
  assert.equal(out.kind, 'ambiguous');
  if (out.kind === 'ambiguous') {
    assert.deepEqual(out.candidateProfileIds, ['wrong']);
    assert.equal(out.identifier, '42');
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].idv, '1428');
  }
});

test('FIX otra-caravana: 1 candidato SIN campos de display (no se puede probar exactitud) → ambiguous (seguro)', () => {
  // Sin idv/visual/tag no hay forma de saber si es exacto → el camino SEGURO es confirmar (no auto-cargar).
  const out = resolveManualIdentify([{ profileId: 'pX' }], '0421');
  assert.equal(out.kind, 'ambiguous');
  if (out.kind === 'ambiguous') assert.deepEqual(out.candidateProfileIds, ['pX']);
});

test('R4.2: manual con >1 candidatos → ambiguous (estado SEGURO, NO auto-elige) + candidatos enriquecidos', () => {
  const out = resolveManualIdentify(
    [
      { profileId: 'a', apodo: 'Manchada', idv: null, tagElectronic: '982000111122223', rodeoName: 'Cría hembras', categoryName: 'Vaquillona' },
      { profileId: 'b', apodo: 'Manchada', idv: '4721', tagElectronic: null, rodeoName: 'Vaquillonas', categoryName: 'Multípara' },
    ],
    'ROJO-12',
  );
  assert.equal(out.kind, 'ambiguous');
  if (out.kind === 'ambiguous') {
    assert.deepEqual(out.candidateProfileIds, ['a', 'b']);
    assert.equal(out.identifier, 'ROJO-12');
    // R4.2: los candidatos enriquecidos llevan lo que los distingue (rodeo/categoría) para el picker.
    assert.equal(out.candidates.length, 2);
    assert.equal(out.candidates[0].rodeoName, 'Cría hembras');
    assert.equal(out.candidates[1].categoryName, 'Multípara');
  }
});

test('R4.2: candidatos sin campos de display (compat M2.1-core) caen a null/"" sin romper', () => {
  const out = resolveManualIdentify([{ profileId: 'a' }, { profileId: 'b' }], 'ROJO-12');
  assert.equal(out.kind, 'ambiguous');
  if (out.kind === 'ambiguous') {
    assert.deepEqual(out.candidateProfileIds, ['a', 'b']);
    assert.equal(out.candidates[0].apodo, null);
    assert.equal(out.candidates[0].rodeoName, '');
  }
});

// ─── Gate de AUTO-AVANCE (decisión de Raf) ─────────────────────────────────────────────────

test('auto-avance: SOLO found auto-avanza; el resto requiere acción explícita', () => {
  const found: IdentifyOutcome = {
    kind: 'found',
    source: 'ble',
    animal: { profileId: 'p' },
    identifier: EID,
  };
  const unknown: IdentifyOutcome = { kind: 'unknown', source: 'ble', identifier: EID };
  const other: IdentifyOutcome = {
    kind: 'other_establishment',
    source: 'ble',
    sourceProfileId: 's',
    otherFieldName: 'X',
    identifier: EID,
  };
  const ambiguous: IdentifyOutcome = {
    kind: 'ambiguous',
    source: 'manual',
    identifier: 't',
    candidateProfileIds: ['a', 'b'],
    candidates: [
      { profileId: 'a', apodo: 't', idv: null, tagElectronic: null, rodeoName: 'R1', categoryName: 'C1' },
      { profileId: 'b', apodo: 't', idv: null, tagElectronic: null, rodeoName: 'R2', categoryName: 'C2' },
    ],
  };
  assert.equal(shouldAutoAdvance(found), true);
  assert.equal(shouldAutoAdvance(unknown), false);
  assert.equal(shouldAutoAdvance(other), false);
  assert.equal(shouldAutoAdvance(ambiguous), false);
});

// ─── Precargado del find-or-create (R4.1) ──────────────────────────────────────────────────

test('IDU.4.10: precargado BLE → tag; manual (numérico o alfanumérico) → idv (colapsa a idv, sin visual)', () => {
  assert.deepEqual(resolvePrefilledCreateParams({ kind: 'unknown', source: 'ble', identifier: EID }), {
    tag: EID,
  });
  assert.deepEqual(resolvePrefilledCreateParams({ kind: 'unknown', source: 'manual', identifier: '0421' }), {
    idv: '0421',
  });
  // El destino histórico `visual` (visual_id_alt) se eliminó: el texto tipeado se precarga SIEMPRE en idv.
  assert.deepEqual(
    resolvePrefilledCreateParams({ kind: 'unknown', source: 'manual', identifier: ' ROJO-12 ' }),
    { idv: 'ROJO-12' },
  );
});
