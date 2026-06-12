// Tests de la lógica PURA del wizard de "primeros pasos" (onboarding) de la home. node:test (mismo
// runner que el resto de la suite unit, sin Jest/RN). Foco: el criterio CONSERVADOR de ocultar el
// stepper — solo con los 3 pasos confirmados done, sin afirmar "completo" con info incompleta.

import test from 'node:test';
import assert from 'node:assert/strict';

import { allOnboardingStepsDone } from './onboarding';

test('los 3 pasos confirmados done → true (se oculta el stepper)', () => {
  assert.equal(
    allOnboardingStepsDone({ rodeoDone: true, hasAnimals: true, teamStarted: true }),
    true,
  );
});

test('hasAnimals === null ("todavía no sabemos") → false (NO ocultar; anti-parpadeo)', () => {
  // El caso crítico: durante la carga del count NO afirmamos "completo" aunque rodeo y equipo lo
  // estén. Un usuario ya-onboardeado no debe ver un flash del stepper, pero un usuario nuevo TAMPOCO
  // debe ver el stepper desaparecer antes de saber si cargó animales.
  assert.equal(
    allOnboardingStepsDone({ rodeoDone: true, hasAnimals: null, teamStarted: true }),
    false,
  );
});

test('hasAnimals === false (campo sin animales) → false (falta ese paso)', () => {
  assert.equal(
    allOnboardingStepsDone({ rodeoDone: true, hasAnimals: false, teamStarted: true }),
    false,
  );
});

test('falta el equipo (teamStarted false) → false', () => {
  assert.equal(
    allOnboardingStepsDone({ rodeoDone: true, hasAnimals: true, teamStarted: false }),
    false,
  );
});

test('falta el rodeo (rodeoDone false) → false', () => {
  assert.equal(
    allOnboardingStepsDone({ rodeoDone: false, hasAnimals: true, teamStarted: true }),
    false,
  );
});

test('ningún paso hecho (usuario recién llegado, count cargando) → false (stepper visible)', () => {
  assert.equal(
    allOnboardingStepsDone({ rodeoDone: false, hasAnimals: null, teamStarted: false }),
    false,
  );
});
