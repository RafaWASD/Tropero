// Tests de la lógica pura del rodeo + caravana visual del ternero al parto (spec 02 delta
// parto-rodeo-caravana, RPRC.1.6/1.7/1.8/3.2/3.3). Pura, sin RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEffectiveCalfRodeoId,
  resolveMotherSystemId,
  eligibleCalfRodeos,
  canEditCalfRodeo,
  calfIdvForSubmit,
} from './calf-birth.ts';
import type { Rodeo } from '../services/rodeos.ts';

// Helper de fixtures: un Rodeo mínimo (solo importan id/name/systemId para estos helpers).
function rodeo(id: string, systemId: string, name = id): Rodeo {
  return {
    id,
    establishmentId: 'est-1',
    name,
    speciesId: 'sp-bovino',
    systemId,
    active: true,
    serviceMonths: null,
  };
}

const CRIA = 'sys-cria';
const INVERNADA = 'sys-invernada';

// ─── resolveEffectiveCalfRodeoId (RPRC.3.1) ────────────────────────────────────────────────

test('resolveEffectiveCalfRodeoId: sin selección → el de la madre', () => {
  assert.equal(resolveEffectiveCalfRodeoId(null, 'r-madre'), 'r-madre');
});

test('resolveEffectiveCalfRodeoId: con selección → la elegida (aunque sea distinta de la madre)', () => {
  assert.equal(resolveEffectiveCalfRodeoId('r-destete', 'r-madre'), 'r-destete');
});

test('resolveEffectiveCalfRodeoId: sin selección y sin madre → null', () => {
  assert.equal(resolveEffectiveCalfRodeoId(null, null), null);
});

// ─── resolveMotherSystemId (RPRC.1.6, fallback del read local) ─────────────────────────────

test('resolveMotherSystemId: rodeo de la madre presente → su systemId', () => {
  const rodeos = [rodeo('r-madre', CRIA), rodeo('r-otro', INVERNADA)];
  assert.equal(resolveMotherSystemId(rodeos, 'r-madre'), CRIA);
});

test('resolveMotherSystemId: rodeo de la madre AUSENTE de la lista → null (dispara fallback)', () => {
  const rodeos = [rodeo('r-otro', INVERNADA)];
  assert.equal(resolveMotherSystemId(rodeos, 'r-madre'), null);
});

test('resolveMotherSystemId: sin rodeo de madre → null', () => {
  assert.equal(resolveMotherSystemId([rodeo('r-a', CRIA)], null), null);
});

// ─── eligibleCalfRodeos (RPRC.1.5/1.6/1.7) ─────────────────────────────────────────────────

test('eligibleCalfRodeos: filtra por el sistema de la madre (incluye el de la madre + hermanos del mismo sistema)', () => {
  const rodeos = [
    rodeo('r-madre', CRIA, 'General'),
    rodeo('r-destete', CRIA, 'Destete'),
    rodeo('r-inv', INVERNADA, 'Invernada'),
  ];
  const elig = eligibleCalfRodeos(rodeos, CRIA);
  assert.deepEqual(
    elig.map((r) => r.id),
    ['r-madre', 'r-destete'],
  );
});

test('eligibleCalfRodeos: NO ofrece rodeos de otro sistema (RPRC.1.6)', () => {
  const rodeos = [rodeo('r-madre', CRIA), rodeo('r-inv', INVERNADA)];
  const elig = eligibleCalfRodeos(rodeos, CRIA);
  assert.ok(!elig.some((r) => r.systemId === INVERNADA));
});

test('eligibleCalfRodeos: systemId null → [] (fallback RPRC.1.8)', () => {
  const rodeos = [rodeo('r-madre', CRIA)];
  assert.deepEqual(eligibleCalfRodeos(rodeos, null), []);
});

// ─── canEditCalfRodeo (RPRC.1.5 vs. fallback RPRC.1.8) ──────────────────────────────────────

test('canEditCalfRodeo: madre figura entre los elegibles → editable', () => {
  const rodeos = [rodeo('r-madre', CRIA), rodeo('r-destete', CRIA)];
  const elig = eligibleCalfRodeos(rodeos, CRIA);
  assert.equal(canEditCalfRodeo(elig, 'r-madre'), true);
});

test('canEditCalfRodeo: madre de OTRO campo (su rodeo no está entre los elegibles del activo, aunque compartan systemId global) → NO editable (RPRC.1.8)', () => {
  // Campo activo tiene rodeos de cría; la madre es de otro campo (su rodeo NO figura), mismo systemId global.
  const activeFieldRodeos = [rodeo('r-activo-1', CRIA), rodeo('r-activo-2', CRIA)];
  const elig = eligibleCalfRodeos(activeFieldRodeos, CRIA);
  assert.equal(canEditCalfRodeo(elig, 'r-madre-otro-campo'), false);
});

test('canEditCalfRodeo: sin elegibles ([] por systemId null) → NO editable', () => {
  assert.equal(canEditCalfRodeo([], 'r-madre'), false);
});

test('canEditCalfRodeo: sin rodeo de madre → NO editable', () => {
  const elig = eligibleCalfRodeos([rodeo('r-a', CRIA)], CRIA);
  assert.equal(canEditCalfRodeo(elig, null), false);
});

// ─── calfIdvForSubmit POR CRÍA (delta parto-caravana-visual-por-ternero, PCV.3.1/3.3) ───────

test('calfIdvForSubmit: idv no vacío → el idv (trim)', () => {
  assert.equal(calfIdvForSubmit('982000123'), '982000123');
  assert.equal(calfIdvForSubmit('  982000123  '), '982000123');
});

test('calfIdvForSubmit: idv vacío → null (omitido, sin forzar — PCV.2/3.3)', () => {
  assert.equal(calfIdvForSubmit(''), null);
  assert.equal(calfIdvForSubmit('   '), null);
});

test('calfIdvForSubmit: es POR CRÍA — cada cría con su idv → su idv (ya NO se descarta con mellizos; supera RPRC.3.3)', () => {
  // Cada CalfBlock (single o mellizo) resuelve su idv de forma INDEPENDIENTE, sin gate por longitud de camada.
  assert.equal(calfIdvForSubmit('0234'), '0234');
  assert.equal(calfIdvForSubmit('0235'), '0235');
  // El leading cero NO se clampa (el campo solo sanitiza a dígitos, no clampa un tipeo).
  assert.equal(calfIdvForSubmit('0500'), '0500');
});
