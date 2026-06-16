// Tests de la lógica PURA del resumen de la tarjeta "Retomar la jornada de hoy" (spec 03 M4, R10.5/R10.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resumeManeuversSummary,
  resumeAnimalCountLabel,
  resumeStartedDateLabel,
} from './maniobra-resume.ts';

test('resumeManeuversSummary: maniobras válidas → coma-join con separador medio', () => {
  const s = resumeManeuversSummary({ maniobras: ['pesaje', 'tacto', 'vacunacion'] });
  // No hardcodeo los labels exactos (es-AR pueden cambiar); verifico la forma (separador + 3 partes).
  assert.equal(s.split(' · ').length, 3);
  assert.ok(s.includes(' · '));
});

test('resumeManeuversSummary: config sin maniobras o corrupto → "" (no tira)', () => {
  assert.equal(resumeManeuversSummary({}), '');
  assert.equal(resumeManeuversSummary({ maniobras: [] }), '');
  // Valores no-ManeuverKind se filtran por extractManeuvers → ''.
  assert.equal(resumeManeuversSummary({ maniobras: ['no_existe' as never] }), '');
});

test('resumeAnimalCountLabel: pluralización es-AR (1 → animal, resto → animales)', () => {
  assert.equal(resumeAnimalCountLabel(0), '0 animales');
  assert.equal(resumeAnimalCountLabel(1), '1 animal');
  assert.equal(resumeAnimalCountLabel(2), '2 animales');
  assert.equal(resumeAnimalCountLabel(12), '12 animales');
  // Defensivo: negativos / fraccionarios se normalizan.
  assert.equal(resumeAnimalCountLabel(-3), '0 animales');
  assert.equal(resumeAnimalCountLabel(3.9), '3 animales');
});

test('resumeStartedDateLabel: jornada de HOY → null (no se muestra la fecha)', () => {
  const now = new Date('2026-06-16T15:00:00');
  // Mismo día calendario local, distinta hora → null.
  assert.equal(resumeStartedDateLabel('2026-06-16T08:30:00', now), null);
  assert.equal(resumeStartedDateLabel('2026-06-16T23:59:00', now), null);
});

test('resumeStartedDateLabel: jornada de OTRO día → fecha corta es-AR (dd/mm)', () => {
  const now = new Date('2026-06-16T15:00:00');
  assert.equal(resumeStartedDateLabel('2026-06-15T08:30:00', now), '15/06');
  assert.equal(resumeStartedDateLabel('2026-06-12T20:00:00', now), '12/06');
});

test('resumeStartedDateLabel: startedAt null o inválido → null (no rompe la tarjeta)', () => {
  const now = new Date('2026-06-16T15:00:00');
  assert.equal(resumeStartedDateLabel(null, now), null);
  assert.equal(resumeStartedDateLabel('no-es-fecha', now), null);
});
