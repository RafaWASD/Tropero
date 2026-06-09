// Tests de forma/validez de AppSchema (spec 15, T1.3 / R2.1, R6.8, R6.11, R6.12).
// node:test. @powersync/common SÍ carga bajo node (es JS puro, sin RN) → ejercemos el SDK REAL:
// validate() corre la validación del propio PowerSync; toJSON() expone la forma que el SDK emite.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AppSchema } from './schema.ts';

type TableJson = {
  name: string;
  local_only?: boolean;
  insert_only?: boolean;
  columns: { name: string }[];
};

function tablesByName(): Map<string, TableJson> {
  const json = AppSchema.toJSON() as { tables: TableJson[] };
  return new Map(json.tables.map((t) => [t.name, t]));
}

// Las 26 tablas SINCRONIZADAS (espejo del schema as-built, design §3).
const SYNCED_TABLES = [
  'species',
  'systems_by_species',
  'categories_by_system',
  'field_definitions',
  'system_default_fields',
  'user_private',
  'user_roles',
  'users',
  'establishments',
  'invitations',
  'rodeos',
  'rodeo_data_config',
  'management_groups',
  'animal_profiles',
  'animals',
  'animal_category_history',
  'sessions',
  'maneuver_presets',
  'semen_registry',
  'weight_events',
  'reproductive_events',
  'sanitary_events',
  'condition_score_events',
  'lab_samples',
  'animal_events',
  'birth_calves',
];

const PENDING_TABLES = [
  'pending_animals',
  'pending_animal_profiles',
  'pending_reproductive_events',
  'pending_birth_calves',
  'pending_status_overrides',
];

test('R2.1: AppSchema valida contra el SDK (no tira la validación de PowerSync)', () => {
  assert.doesNotThrow(() => AppSchema.validate());
});

test('R2.1: están las 26 tablas sincronizadas del schema as-built', () => {
  const tables = tablesByName();
  for (const name of SYNCED_TABLES) {
    assert.ok(tables.has(name), `falta la tabla sincronizada ${name}`);
  }
});

test('R6.8: outbox op_intents es insertOnly (genera CrudEntry pero no replica fila plana)', () => {
  const t = tablesByName().get('op_intents');
  assert.ok(t, 'falta op_intents');
  assert.equal(t.insert_only, true);
  assert.equal(t.local_only, false);
  // El client_op_id NO es una columna declarada: ES el id implícito (clave de idempotencia, R6.10).
  const cols = t.columns.map((c) => c.name);
  assert.deepEqual(cols.sort(), ['created_at', 'op_type', 'params_json']);
});

test('R6.11/R6.12: los overlay pending_* son localOnly (NO generan CrudEntry → no se suben)', () => {
  const tables = tablesByName();
  for (const name of PENDING_TABLES) {
    const t = tables.get(name);
    assert.ok(t, `falta el overlay ${name}`);
    assert.equal(t.local_only, true, `${name} debe ser localOnly`);
    assert.equal(t.insert_only, false, `${name} no debe ser insertOnly`);
    // Cada fila del overlay lleva client_op_id (para limpiar/rollbackear por intent).
    assert.ok(
      t.columns.some((c) => c.name === 'client_op_id'),
      `${name} debe tener client_op_id`,
    );
  }
});

test('R6.8/R6.12: las tablas SINCRONIZADAS NO son localOnly ni insertOnly (sí generan CrudEntry plano)', () => {
  const tables = tablesByName();
  for (const name of SYNCED_TABLES) {
    const t = tables.get(name)!;
    assert.equal(t.local_only, false, `${name} no debe ser localOnly`);
    assert.equal(t.insert_only, false, `${name} no debe ser insertOnly`);
  }
});

test('PK especial: user_private/rodeo_data_config/birth_calves NO declaran columna `id` (la implícita la porta el alias de la stream)', () => {
  const tables = tablesByName();
  for (const name of ['user_private', 'rodeo_data_config', 'birth_calves']) {
    const t = tables.get(name)!;
    const cols = t.columns.map((c) => c.name);
    assert.ok(!cols.includes('id'), `${name} no debe declarar 'id' (el SDK lo agrega implícito)`);
  }
  // user_private mantiene user_id como columna consultable.
  assert.ok(tables.get('user_private')!.columns.some((c) => c.name === 'user_id'));
  // las compuestas mantienen sus columnas componentes.
  const rdc = tables.get('rodeo_data_config')!.columns.map((c) => c.name);
  assert.ok(rdc.includes('rodeo_id') && rdc.includes('field_definition_id'));
  const bc = tables.get('birth_calves')!.columns.map((c) => c.name);
  assert.ok(bc.includes('birth_event_id') && bc.includes('calf_profile_id'));
});

test('PASO 2 (ADR-026 §A): las 8 tablas hijas declaran establishment_id denormalizado (0077/0078)', () => {
  const tables = tablesByName();
  const CHILD_TABLES = [
    'weight_events',
    'reproductive_events',
    'sanitary_events',
    'condition_score_events',
    'lab_samples',
    'animal_category_history',
    'birth_calves',
    'rodeo_data_config',
  ];
  for (const name of CHILD_TABLES) {
    const cols = tables.get(name)!.columns.map((c) => c.name);
    assert.ok(
      cols.includes('establishment_id'),
      `${name} debe declarar establishment_id (denormalizado paso 2) para materializarlo local`,
    );
  }
  // birth_calves/rodeo_data_config son PK especial: establishment_id va como columna normal, SIN `id` propio.
  for (const name of ['birth_calves', 'rodeo_data_config']) {
    const cols = tables.get(name)!.columns.map((c) => c.name);
    assert.ok(!cols.includes('id'), `${name} no debe declarar 'id' (lo agrega el SDK)`);
  }
});

test('PASO 2 (ADR-026 §B, b1 / 0079): animal_profiles declara la identidad denormalizada del animal', () => {
  const cols = tablesByName().get('animal_profiles')!.columns.map((c) => c.name);
  for (const c of ['animal_tag_electronic', 'animal_sex', 'animal_birth_date']) {
    assert.ok(cols.includes(c), `animal_profiles debe declarar ${c} (identidad denormalizada, b1)`);
  }
});

test('PASO 2 (ADR-026 §C, c2 / 0080): user_roles declara member_name (nombres de coworkers offline)', () => {
  const cols = tablesByName().get('user_roles')!.columns.map((c) => c.name);
  assert.ok(cols.includes('member_name'), 'user_roles debe declarar member_name (c2) — lo leen buildMembersQuery/buildOwnNameQuery');
  // c2 NO denormaliza PII: member_name es el `name` público, no email/phone (esos viven en user_private).
  assert.ok(!cols.includes('email'), 'user_roles no debe exponer email (PII en user_private)');
  assert.ok(!cols.includes('phone'), 'user_roles no debe exponer phone (PII en user_private)');
});

test('users NO trae email/phone (PII movida a user_private, 0068 / ADR-025)', () => {
  const cols = tablesByName().get('users')!.columns.map((c) => c.name);
  assert.ok(!cols.includes('email'), 'users no debe exponer email');
  assert.ok(!cols.includes('phone'), 'users no debe exponer phone');
});

test('el schema total = 26 sincronizadas + op_intents + 5 overlay = 32 tablas', () => {
  const json = AppSchema.toJSON() as { tables: TableJson[] };
  assert.equal(json.tables.length, SYNCED_TABLES.length + 1 + PENDING_TABLES.length);
});
