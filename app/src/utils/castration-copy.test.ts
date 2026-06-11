// Tests del copy de la observación automática de castración (spec 10, T-CL.13 / R13.7). node:test, puro.
// Pinea el texto exacto (simétrico) — la observación es la fuente de atribución del flip de is_castrated.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OBSERVATION_CASTRATED,
  OBSERVATION_UNCASTRATED,
  castrationObservationText,
} from './castration-copy.ts';

test('R13.7: castrar ⇒ "Castrado"', () => {
  assert.equal(castrationObservationText(true), 'Castrado');
  assert.equal(OBSERVATION_CASTRATED, 'Castrado');
});

test('R13.7: revertir ⇒ "Corrección: marcado como no castrado" (simetría)', () => {
  assert.equal(castrationObservationText(false), 'Corrección: marcado como no castrado');
  assert.equal(OBSERVATION_UNCASTRATED, 'Corrección: marcado como no castrado');
});

test('R13.7: castrar y revertir dan textos DISTINTOS (la corrección es auditable como el acto)', () => {
  assert.notEqual(castrationObservationText(true), castrationObservationText(false));
});
