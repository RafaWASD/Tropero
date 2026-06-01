// Tests de a11y.ts — props de accesibilidad multiplataforma (fix-loop C1, BUG 2).
// node:test + type-stripping nativo (sin Jest; mismo patrón que el resto de utils).
//
// La propiedad load-bearing: en WEB NUNCA se emite `accessibilityLabel` (ni accessibility* alguno),
// solo atributos ARIA DOM-válidos (role / aria-*). Eso es lo que evita el warning de React que en
// DEV monta el overlay que bloqueaba los toques (BUG 2). En NATIVE, al revés: solo accessibility*.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { switchA11y, buttonA11y } from './a11y.ts';

test('switchA11y web: emite ARIA DOM-válido, SIN accessibility* (no filtra al DOM)', () => {
  const props = switchA11y('web', { label: 'Peso al nacer', checked: true, disabled: false });
  assert.deepEqual(props, {
    role: 'switch',
    'aria-checked': true,
    'aria-disabled': false,
    'aria-label': 'Peso al nacer',
  });
  // Garantía dura: ninguna prop accessibility* cruda (la que React no reconoce en el DOM).
  for (const key of Object.keys(props)) {
    assert.ok(!key.startsWith('accessibility'), `web no debe emitir ${key}`);
  }
});

test('switchA11y web refleja checked/disabled', () => {
  const off = switchA11y('web', { label: 'X', checked: false, disabled: true });
  assert.equal(off['aria-checked' as keyof typeof off], false);
  assert.equal(off['aria-disabled' as keyof typeof off], true);
});

test('switchA11y native: emite accessibility*, SIN atributos ARIA crudos', () => {
  const props = switchA11y('ios', { label: 'Peso al nacer', checked: false, disabled: false });
  assert.deepEqual(props, {
    accessibilityRole: 'switch',
    accessibilityState: { checked: false, disabled: false },
    accessibilityLabel: 'Peso al nacer',
  });
  for (const key of Object.keys(props)) {
    assert.ok(!key.startsWith('aria-') && key !== 'role', `native no debe emitir ${key}`);
  }
});

test('buttonA11y web: aria-label + role, SIN accessibility*', () => {
  const props = buttonA11y('web', { label: 'Volver' });
  assert.deepEqual(props, { role: 'button', 'aria-label': 'Volver' });
  for (const key of Object.keys(props)) {
    assert.ok(!key.startsWith('accessibility'), `web no debe emitir ${key}`);
  }
});

test('buttonA11y web con disabled/selected → aria-disabled/aria-pressed', () => {
  const props = buttonA11y('web', { label: 'Sistema Cría', disabled: false, selected: true });
  assert.deepEqual(props, {
    role: 'button',
    'aria-label': 'Sistema Cría',
    'aria-disabled': false,
    'aria-pressed': true,
  });
});

test('buttonA11y web omite aria-disabled/aria-pressed si no se pasan (no ruido en el DOM)', () => {
  const props = buttonA11y('web', { label: 'X' });
  assert.ok(!('aria-disabled' in props));
  assert.ok(!('aria-pressed' in props));
});

test('buttonA11y native: accessibilityLabel + role + state', () => {
  const props = buttonA11y('android', { label: 'Eliminar', disabled: true });
  assert.deepEqual(props, {
    accessibilityRole: 'button',
    accessibilityLabel: 'Eliminar',
    accessibilityState: { disabled: true },
  });
});

test('buttonA11y native sin disabled/selected: sin accessibilityState', () => {
  const props = buttonA11y('ios', { label: 'Volver' });
  assert.deepEqual(props, { accessibilityRole: 'button', accessibilityLabel: 'Volver' });
});
