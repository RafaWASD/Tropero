// Tests del derivador/validador de dato custom (spec 03 M5-C.2, R13.5–R13.9). PURO (node:test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  baseSlug,
  slugifyDataKey,
  validateCustomFieldDraft,
  buildCreateCustomFieldPayload,
  uiComponentNeedsOptions,
  UI_COMPONENT_OPTIONS,
  DATA_KEY_MAX,
  LABEL_MAX,
  OPTIONS_MAX,
  OPTION_LABEL_MAX,
  CUSTOM_FIELD_CATEGORY,
} from './custom-field.ts';

// ─── baseSlug ──────────────────────────────────────────────────────────────────────────────────────

test('baseSlug: minúsculas, sin acentos, no-alfanum → _', () => {
  assert.equal(baseSlug('Ángulo de Pezuña'), 'angulo_de_pezuna');
  assert.equal(baseSlug('Score corporal #1'), 'score_corporal_1');
  assert.equal(baseSlug('  Apodo  '), 'apodo');
});

test('baseSlug: colapsa _ repetidos y recorta los de los extremos', () => {
  assert.equal(baseSlug('a---b'), 'a_b');
  assert.equal(baseSlug('__hola__'), 'hola');
  assert.equal(baseSlug('!!!'), ''); // sin alfanuméricos → vacío
});

test('baseSlug: resultado siempre matchea ^[a-z0-9_]*$', () => {
  for (const input of ['Ñandú', 'Peso (kg)', '12 de Octubre', 'a.b/c', 'Ángulo+−']) {
    assert.match(baseSlug(input), /^[a-z0-9_]*$/, `falló para "${input}"`);
  }
});

// ─── slugifyDataKey ────────────────────────────────────────────────────────────────────────────────

test('slugifyDataKey: deriva un slug válido del label', () => {
  const k = slugifyDataKey('Ángulo de pezuña');
  assert.equal(k, 'angulo_de_pezuna');
  assert.match(k, /^[a-z0-9_]+$/);
  assert.ok(k.length >= 1 && k.length <= DATA_KEY_MAX);
});

test('slugifyDataKey: label sin alfanuméricos cae a "dato"', () => {
  assert.equal(slugifyDataKey('🐄🐄'), 'dato');
  assert.equal(slugifyDataKey('   '), 'dato');
});

test('slugifyDataKey: colisión → sufijo _2, _3, …', () => {
  assert.equal(slugifyDataKey('Apodo', ['apodo']), 'apodo_2');
  assert.equal(slugifyDataKey('Apodo', ['apodo', 'apodo_2']), 'apodo_3');
});

test('slugifyDataKey: existing case-insensitive', () => {
  // El server guarda en minúscula; aunque pasen el existing en mayúscula, no debe colisionar silenciosamente.
  assert.equal(slugifyDataKey('Apodo', ['APODO']), 'apodo_2');
});

test('slugifyDataKey: nunca excede DATA_KEY_MAX, ni con sufijo', () => {
  const longLabel = 'a'.repeat(200);
  const base = slugifyDataKey(longLabel);
  assert.ok(base.length <= DATA_KEY_MAX);
  // Colisión sobre el recorte → el sufijo entra recortando la base.
  const withSuffix = slugifyDataKey(longLabel, [base]);
  assert.ok(withSuffix.length <= DATA_KEY_MAX, `largo ${withSuffix.length} > ${DATA_KEY_MAX}`);
  assert.notEqual(withSuffix, base);
  assert.match(withSuffix, /^[a-z0-9_]+$/);
});

test('slugifyDataKey: el resultado nunca está en existing', () => {
  const existing = ['peso', 'peso_2', 'peso_3', 'peso_4'];
  const k = slugifyDataKey('Peso', existing);
  assert.ok(!existing.includes(k));
  assert.match(k, /^[a-z0-9_]+$/);
});

// ─── catálogo de ui_component ────────────────────────────────────────────────────────────────────────

test('UI_COMPONENT_OPTIONS: ofrece exactamente los 7 de R13.8', () => {
  const set = UI_COMPONENT_OPTIONS.map((o) => o.uiComponent).sort();
  assert.deepEqual(set, [
    'boolean', 'date', 'enum_multi', 'enum_single', 'numeric', 'numeric_stepped', 'text',
  ]);
  // todos con label es-AR no vacío
  for (const o of UI_COMPONENT_OPTIONS) assert.ok(o.label.trim().length > 0);
});

test('uiComponentNeedsOptions: solo los enum', () => {
  assert.equal(uiComponentNeedsOptions('enum_single'), true);
  assert.equal(uiComponentNeedsOptions('enum_multi'), true);
  for (const c of ['numeric', 'numeric_stepped', 'text', 'boolean', 'date'] as const) {
    assert.equal(uiComponentNeedsOptions(c), false);
  }
});

// ─── validateCustomFieldDraft ──────────────────────────────────────────────────────────────────────

test('validate: label vacío → error', () => {
  const r = validateCustomFieldDraft({ label: '   ', dataType: 'maniobra', uiComponent: 'numeric' });
  assert.equal(r.ok, false);
});

test('validate: label demasiado largo → error', () => {
  const r = validateCustomFieldDraft({ label: 'x'.repeat(LABEL_MAX + 1), dataType: 'maniobra', uiComponent: 'numeric' });
  assert.equal(r.ok, false);
});

test('validate: numeric con label OK → ok (sin opciones)', () => {
  const r = validateCustomFieldDraft({ label: 'Ángulo de pezuña', dataType: 'maniobra', uiComponent: 'numeric' });
  assert.equal(r.ok, true);
});

test('validate: enum sin opciones → error', () => {
  const r = validateCustomFieldDraft({ label: 'Pezuña', dataType: 'maniobra', uiComponent: 'enum_single', options: [] });
  assert.equal(r.ok, false);
});

test('validate: enum con opciones válidas → ok', () => {
  const r = validateCustomFieldDraft({
    label: 'Pezuña', dataType: 'maniobra', uiComponent: 'enum_single', options: ['adentro', 'afuera', 'normal'],
  });
  assert.equal(r.ok, true);
});

test('validate: enum con > OPTIONS_MAX → error', () => {
  const opts = Array.from({ length: OPTIONS_MAX + 1 }, (_, i) => `opt_${i}`);
  const r = validateCustomFieldDraft({ label: 'X', dataType: 'maniobra', uiComponent: 'enum_multi', options: opts });
  assert.equal(r.ok, false);
});

test('validate: opción demasiado larga → error', () => {
  const r = validateCustomFieldDraft({
    label: 'X', dataType: 'maniobra', uiComponent: 'enum_single', options: ['x'.repeat(OPTION_LABEL_MAX + 1)],
  });
  assert.equal(r.ok, false);
});

test('validate: opciones duplicadas (case-insensitive) → error', () => {
  const r = validateCustomFieldDraft({
    label: 'X', dataType: 'maniobra', uiComponent: 'enum_multi', options: ['Adentro', 'adentro'],
  });
  assert.equal(r.ok, false);
});

// ─── buildCreateCustomFieldPayload ───────────────────────────────────────────────────────────────────

test('buildPayload: numeric maniobra → shape exacto del INSERT 0093, config_schema null', () => {
  const p = buildCreateCustomFieldPayload({
    id: 'id-1', establishmentId: 'est-A',
    draft: { label: 'Ángulo de pezuña', dataType: 'maniobra', uiComponent: 'numeric' },
    existingDataKeys: [],
  });
  assert.deepEqual(p, {
    id: 'id-1',
    establishment_id: 'est-A',
    data_key: 'angulo_de_pezuna',
    label: 'Ángulo de pezuña',
    data_type: 'maniobra',
    ui_component: 'numeric',
    category: CUSTOM_FIELD_CATEGORY,
    config_schema: null,
  });
});

test('buildPayload: enum → config_schema={options} trimeadas y sin vacías', () => {
  const p = buildCreateCustomFieldPayload({
    id: 'id-2', establishmentId: 'est-A',
    draft: { label: 'Pezuña', dataType: 'propiedad', uiComponent: 'enum_single', options: [' adentro ', 'afuera', '  '] },
    existingDataKeys: [],
  });
  assert.deepEqual(p.config_schema, { options: ['adentro', 'afuera'] });
  assert.equal(p.data_type, 'propiedad');
  assert.equal(p.ui_component, 'enum_single');
});

test('buildPayload: label se trimea; data_key respeta unicidad', () => {
  const p = buildCreateCustomFieldPayload({
    id: 'id-3', establishmentId: 'est-A',
    draft: { label: '  Apodo  ', dataType: 'propiedad', uiComponent: 'text' },
    existingDataKeys: ['apodo'],
  });
  assert.equal(p.label, 'Apodo');
  assert.equal(p.data_key, 'apodo_2');
  assert.match(p.data_key, /^[a-z0-9_]+$/);
});

test('buildPayload: NUNCA manda recorded_by/establishment forzado/columnas inmutables extra', () => {
  const p = buildCreateCustomFieldPayload({
    id: 'id-4', establishmentId: 'est-A',
    draft: { label: 'Marca', dataType: 'maniobra', uiComponent: 'boolean' },
    existingDataKeys: [],
  });
  const keys = Object.keys(p).sort();
  assert.deepEqual(keys, [
    'category', 'config_schema', 'data_key', 'data_type', 'establishment_id', 'id', 'label', 'ui_component',
  ]);
});
