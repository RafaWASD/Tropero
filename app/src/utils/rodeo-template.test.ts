// Tests de la lógica pura de la plantilla de datos del rodeo (C1 — ADR-021).
// node:test nativo (sin red/RN), enganchados en scripts/run-tests.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardToggles,
  buildEditToggles,
  groupTogglesByCategory,
  computeConfigDiff,
  computeEditDiff,
  buildEffectiveConfigRows,
  setToggle,
  categoryLabel,
  type FieldDefinition,
  type SystemDefaultField,
  type TemplateToggle,
} from './rodeo-template.ts';

// ─── Fixtures: un mini-catálogo representativo de cría ───────────────────────────

// establishmentId/options agregados a FieldDefinition por M7 (R13.29: discriminar fila custom; precargar
// editor). Estos fixtures son de FÁBRICA (establishmentId: null, options: []).
const FD = {
  servicio: { id: 'fd-servicio', dataKey: 'servicio', label: 'Servicio / entore', description: 'Monta o IA', category: 'reproductivo', dataType: 'evento_individual', uiComponent: 'composite', establishmentId: null, options: [] },
  prenez: { id: 'fd-prenez', dataKey: 'prenez', label: 'Preñez', description: 'Tacto', category: 'reproductivo', dataType: 'maniobra', uiComponent: 'enum_single', establishmentId: null, options: [] },
  inseminacion: { id: 'fd-insem', dataKey: 'inseminacion', label: 'Inseminación artificial', description: 'IATF', category: 'reproductivo', dataType: 'maniobra', uiComponent: 'composite', establishmentId: null, options: [] },
  peso: { id: 'fd-peso', dataKey: 'peso', label: 'Pesaje', description: 'Peso vivo', category: 'productivo', dataType: 'maniobra', uiComponent: 'numeric', establishmentId: null, options: [] },
  vacunacion: { id: 'fd-vac', dataKey: 'vacunacion', label: 'Vacunación', description: 'Vacuna', category: 'sanitario', dataType: 'maniobra', uiComponent: 'silent_apply', establishmentId: null, options: [] },
  dientes: { id: 'fd-dientes', dataKey: 'dientes', label: 'Estado de dientes', description: 'Dentario', category: 'manejo', dataType: 'maniobra', uiComponent: 'enum_single', establishmentId: null, options: [] },
} satisfies Record<string, FieldDefinition>;

const CATALOG: FieldDefinition[] = Object.values(FD);

// system_default_fields de "cría": prenez/peso/vacunacion/dientes/servicio ON, inseminacion OFF.
// inseminacion existe en el catálogo pero NO es default del sistema (no tiene fila) → simula
// un field no-default disponible para habilitar (caso "tambo + preñez", acá invertido).
const DEFAULTS: SystemDefaultField[] = [
  { fieldDefinitionId: FD.servicio.id, defaultEnabled: true, requiredForSystem: false, sortOrder: 1 },
  { fieldDefinitionId: FD.prenez.id, defaultEnabled: true, requiredForSystem: false, sortOrder: 2 },
  { fieldDefinitionId: FD.peso.id, defaultEnabled: true, requiredForSystem: false, sortOrder: 3 },
  { fieldDefinitionId: FD.vacunacion.id, defaultEnabled: true, requiredForSystem: false, sortOrder: 4 },
  { fieldDefinitionId: FD.dientes.id, defaultEnabled: true, requiredForSystem: false, sortOrder: 5 },
  // inseminacion: NO está en defaults → no-default del sistema.
];

// ─── buildWizardToggles ──────────────────────────────────────────────────────────

test('buildWizardToggles: una fila por system_default_field, enabled = default_enabled', () => {
  const toggles = buildWizardToggles(CATALOG, DEFAULTS);
  assert.equal(toggles.length, 5); // solo los 5 defaults (inseminacion no-default no entra al wizard)
  const prenez = toggles.find((t) => t.field.id === FD.prenez.id);
  assert.ok(prenez);
  assert.equal(prenez.enabled, true);
  assert.equal(prenez.isDefault, true);
  // inseminacion (no-default) NO aparece en el wizard.
  assert.equal(toggles.find((t) => t.field.id === FD.inseminacion.id), undefined);
});

test('buildWizardToggles: un default OFF arranca destildado', () => {
  const defaultsWithOff: SystemDefaultField[] = [
    { fieldDefinitionId: FD.inseminacion.id, defaultEnabled: false, requiredForSystem: false, sortOrder: 9 },
  ];
  const toggles = buildWizardToggles(CATALOG, defaultsWithOff);
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0].enabled, false);
});

test('buildWizardToggles: salta defaults cuyo field no está en el catálogo (defensivo)', () => {
  const defaultsWithGhost: SystemDefaultField[] = [
    ...DEFAULTS,
    { fieldDefinitionId: 'fd-fantasma', defaultEnabled: true, requiredForSystem: false, sortOrder: 99 },
  ];
  const toggles = buildWizardToggles(CATALOG, defaultsWithGhost);
  assert.equal(toggles.length, 5); // el fantasma no se incluye
});

// ─── buildEditToggles ──────────────────────────────────────────────────────────

test('buildEditToggles: muestra TODO el catálogo con su estado efectivo (no-default habilitable)', () => {
  // rodeo_data_config: prenez=true, peso=false (el owner lo destildó), resto sin tocar.
  const config = [
    { fieldDefinitionId: FD.servicio.id, enabled: true },
    { fieldDefinitionId: FD.prenez.id, enabled: true },
    { fieldDefinitionId: FD.peso.id, enabled: false },
    { fieldDefinitionId: FD.vacunacion.id, enabled: true },
    { fieldDefinitionId: FD.dientes.id, enabled: true },
  ];
  const toggles = buildEditToggles(CATALOG, DEFAULTS, config);
  assert.equal(toggles.length, CATALOG.length); // los 6 fields del catálogo
  assert.equal(toggles.find((t) => t.field.id === FD.peso.id)?.enabled, false);
  // inseminacion: no-default, sin fila en config → enabled false, isDefault false (habilitable).
  const insem = toggles.find((t) => t.field.id === FD.inseminacion.id);
  assert.ok(insem);
  assert.equal(insem.enabled, false);
  assert.equal(insem.isDefault, false);
});

// ─── groupTogglesByCategory ──────────────────────────────────────────────────────

test('groupTogglesByCategory: orden canónico de categorías + sort_order dentro de cada una', () => {
  const toggles = buildWizardToggles(CATALOG, DEFAULTS);
  const sections = groupTogglesByCategory(toggles);
  assert.deepEqual(
    sections.map((s) => s.category),
    ['reproductivo', 'productivo', 'sanitario', 'manejo'],
  );
  // dentro de reproductivo: servicio (sort 1) antes que prenez (sort 2).
  const repro = sections[0];
  assert.deepEqual(
    repro.toggles.map((t) => t.field.dataKey),
    ['servicio', 'prenez'],
  );
});

test('groupTogglesByCategory: una categoría no prevista cae al final (defensivo)', () => {
  const exotic: FieldDefinition = { id: 'fd-x', dataKey: 'x', label: 'X', description: null, category: 'experimental', dataType: 'propiedad', uiComponent: 'text', establishmentId: null, options: [] };
  const toggles: TemplateToggle[] = [
    { field: FD.prenez, enabled: true, required: false, isDefault: true, sortOrder: 2 },
    { field: exotic, enabled: true, required: false, isDefault: true, sortOrder: 1 },
  ];
  const sections = groupTogglesByCategory(toggles);
  assert.equal(sections[sections.length - 1].category, 'experimental');
});

// ─── computeConfigDiff (wizard → tras crear el rodeo) ────────────────────────────

test('computeConfigDiff: sin cambios respecto del default → 0 ops (el trigger ya pre-pobló)', () => {
  const toggles = buildWizardToggles(CATALOG, DEFAULTS); // todos en su default
  const ops = computeConfigDiff(toggles, DEFAULTS);
  assert.equal(ops.length, 0);
});

test('computeConfigDiff: destildar un default ON → UPDATE enabled=false', () => {
  let toggles = buildWizardToggles(CATALOG, DEFAULTS);
  toggles = setToggle(toggles, FD.peso.id, false);
  const ops = computeConfigDiff(toggles, DEFAULTS);
  assert.deepEqual(ops, [{ kind: 'update', fieldDefinitionId: FD.peso.id, enabled: false }]);
});

test('computeConfigDiff: tildar un default OFF (fila pre-poblada con false) → UPDATE enabled=true', () => {
  // inseminacion como default OFF: el trigger ya puso una fila con enabled=false. Tildarlo es un
  // UPDATE (la fila existe), NO un INSERT.
  const defaultsWithOff: SystemDefaultField[] = [
    ...DEFAULTS,
    { fieldDefinitionId: FD.inseminacion.id, defaultEnabled: false, requiredForSystem: false, sortOrder: 6 },
  ];
  let toggles = buildWizardToggles(CATALOG, defaultsWithOff);
  toggles = setToggle(toggles, FD.inseminacion.id, true);
  const ops = computeConfigDiff(toggles, defaultsWithOff);
  assert.deepEqual(ops, [{ kind: 'update', fieldDefinitionId: FD.inseminacion.id, enabled: true }]);
});

test('computeConfigDiff: habilitar un NO-default (sin fila pre-poblada) → INSERT enabled=true', () => {
  // En el wizard estándar no se muestran no-defaults, pero el diff debe soportar el caso
  // (ej. una variante de UI que liste no-defaults). Simulamos un toggle no-default habilitado.
  const desired: TemplateToggle[] = [
    { field: FD.inseminacion, enabled: true, required: false, isDefault: false, sortOrder: 99 },
  ];
  const ops = computeConfigDiff(desired, DEFAULTS);
  assert.deepEqual(ops, [{ kind: 'insert', fieldDefinitionId: FD.inseminacion.id, enabled: true }]);
});

test('computeConfigDiff: NO-default dejado en false → no-op (no se inserta enabled=false)', () => {
  const desired: TemplateToggle[] = [
    { field: FD.inseminacion, enabled: false, required: false, isDefault: false, sortOrder: 99 },
  ];
  const ops = computeConfigDiff(desired, DEFAULTS);
  assert.equal(ops.length, 0);
});

test('computeConfigDiff: un required NUNCA emite op aunque venga enabled=false (UI buggeada)', () => {
  const requiredDefaults: SystemDefaultField[] = [
    { fieldDefinitionId: FD.prenez.id, defaultEnabled: true, requiredForSystem: true, sortOrder: 1 },
  ];
  const desired: TemplateToggle[] = [
    { field: FD.prenez, enabled: false, required: true, isDefault: true, sortOrder: 1 },
  ];
  const ops = computeConfigDiff(desired, requiredDefaults);
  assert.equal(ops.length, 0);
});

// ─── computeEditDiff (editar plantilla → contra estado efectivo) ──────────────────

test('computeEditDiff: cambio sobre fila existente → UPDATE', () => {
  const current = [
    { fieldDefinitionId: FD.prenez.id, enabled: true },
    { fieldDefinitionId: FD.peso.id, enabled: true },
  ];
  const desired: TemplateToggle[] = [
    { field: FD.prenez, enabled: true, required: false, isDefault: true, sortOrder: 2 },
    { field: FD.peso, enabled: false, required: false, isDefault: true, sortOrder: 3 }, // destildado
  ];
  const ops = computeEditDiff(desired, current);
  assert.deepEqual(ops, [{ kind: 'update', fieldDefinitionId: FD.peso.id, enabled: false }]);
});

test('computeEditDiff: habilitar un no-default sin fila → INSERT', () => {
  const current: { fieldDefinitionId: string; enabled: boolean }[] = [];
  const desired: TemplateToggle[] = [
    { field: FD.inseminacion, enabled: true, required: false, isDefault: false, sortOrder: 99 },
  ];
  const ops = computeEditDiff(desired, current);
  assert.deepEqual(ops, [{ kind: 'insert', fieldDefinitionId: FD.inseminacion.id, enabled: true }]);
});

test('computeEditDiff: no-default sin fila dejado en false → no-op', () => {
  const current: { fieldDefinitionId: string; enabled: boolean }[] = [];
  const desired: TemplateToggle[] = [
    { field: FD.inseminacion, enabled: false, required: false, isDefault: false, sortOrder: 99 },
  ];
  const ops = computeEditDiff(desired, current);
  assert.equal(ops.length, 0);
});

test('computeEditDiff: re-habilitar un no-default que YA tenía fila (enabled=false) → UPDATE, no INSERT', () => {
  const current = [{ fieldDefinitionId: FD.inseminacion.id, enabled: false }];
  const desired: TemplateToggle[] = [
    { field: FD.inseminacion, enabled: true, required: false, isDefault: false, sortOrder: 99 },
  ];
  const ops = computeEditDiff(desired, current);
  assert.deepEqual(ops, [{ kind: 'update', fieldDefinitionId: FD.inseminacion.id, enabled: true }]);
});

// ─── buildEffectiveConfigRows (overlay optimista del alta de rodeo OFFLINE, Run T9.8) ──

test('buildEffectiveConfigRows: sin cambios → una fila por toggle del wizard con su estado default', () => {
  const toggles = buildWizardToggles(CATALOG, DEFAULTS); // 5 default-fields, todos ON
  const diff = computeConfigDiff(toggles, DEFAULTS); // 0 ops
  const rows = buildEffectiveConfigRows(toggles, diff);
  // = exactamente la plantilla que el trigger 0018 seedearía: una fila por default-field, su estado.
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.enabled === true));
  assert.deepEqual(
    rows.map((r) => r.fieldDefinitionId).sort(),
    [FD.servicio.id, FD.prenez.id, FD.peso.id, FD.vacunacion.id, FD.dientes.id].sort(),
  );
});

test('buildEffectiveConfigRows: destildar un default → la fila refleja enabled=false (no se omite)', () => {
  let toggles = buildWizardToggles(CATALOG, DEFAULTS);
  toggles = setToggle(toggles, FD.peso.id, false);
  const diff = computeConfigDiff(toggles, DEFAULTS); // 1 update (peso→false)
  const rows = buildEffectiveConfigRows(toggles, diff);
  // Sigue habiendo una fila por cada default-field (el trigger las seedea); peso quedó en false.
  assert.equal(rows.length, 5);
  const peso = rows.find((r) => r.fieldDefinitionId === FD.peso.id);
  assert.equal(peso?.enabled, false);
});

test('buildEffectiveConfigRows: un NO-default habilitado (diff insert) suma su fila sin duplicar', () => {
  // Wizard estándar (5 default-fields) + un no-default habilitado por una variante de UI (diff insert).
  const toggles = buildWizardToggles(CATALOG, DEFAULTS);
  const diff = [
    ...computeConfigDiff(toggles, DEFAULTS),
    { kind: 'insert' as const, fieldDefinitionId: FD.inseminacion.id, enabled: true },
  ];
  const rows = buildEffectiveConfigRows(toggles, diff);
  assert.equal(rows.length, 6, 'los 5 defaults + el no-default habilitado');
  const insem = rows.find((r) => r.fieldDefinitionId === FD.inseminacion.id);
  assert.deepEqual(insem, { fieldDefinitionId: FD.inseminacion.id, enabled: true });
  // No hay duplicados de field_definition_id.
  const ids = rows.map((r) => r.fieldDefinitionId);
  assert.equal(new Set(ids).size, ids.length);
});

test('buildEffectiveConfigRows: un no-default que YA está como toggle no se duplica por el diff', () => {
  // Caso defensivo: si un field aparece como toggle Y como insert del diff (no debería, pero…) → 1 fila.
  const toggles: TemplateToggle[] = [
    { field: FD.inseminacion, enabled: true, required: false, isDefault: false, sortOrder: 99 },
  ];
  const diff = [{ kind: 'insert' as const, fieldDefinitionId: FD.inseminacion.id, enabled: true }];
  const rows = buildEffectiveConfigRows(toggles, diff);
  assert.equal(rows.length, 1);
});

// ─── setToggle ──────────────────────────────────────────────────────────────────

test('setToggle: cambia solo el field objetivo, inmutable, respeta required', () => {
  const toggles: TemplateToggle[] = [
    { field: FD.prenez, enabled: true, required: false, isDefault: true, sortOrder: 2 },
    { field: FD.peso, enabled: true, required: true, isDefault: true, sortOrder: 3 },
  ];
  const next = setToggle(toggles, FD.prenez.id, false);
  assert.equal(next[0].enabled, false);
  assert.equal(toggles[0].enabled, true); // original intacto (inmutable)
  // required no cambia aunque se pida.
  const next2 = setToggle(toggles, FD.peso.id, false);
  assert.equal(next2[1].enabled, true);
});

// ─── categoryLabel ──────────────────────────────────────────────────────────────

test('categoryLabel: etiquetas es-AR de las categorías canónicas + fallback', () => {
  assert.equal(categoryLabel('reproductivo'), 'Reproductivo');
  assert.equal(categoryLabel('identificacion'), 'Identificación');
  assert.equal(categoryLabel('experimental'), 'Experimental'); // fallback capitaliza
  assert.equal(categoryLabel(''), '');
});
