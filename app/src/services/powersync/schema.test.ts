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
  // Run T9.8 — overlay del alta de rodeo OFFLINE (intent create_rodeo).
  'pending_rodeos',
  'pending_rodeo_data_config',
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

test('spec 10 (T-CL.12 / R13.3, R12.1): animal_profiles declara is_castrated + future_bull (denorm 0084/0085)', () => {
  const cols = tablesByName().get('animal_profiles')!.columns.map((c) => c.name);
  // is_castrated (0084): el espejo C6 lo lee como el REAL con precedencia (R13.6) → completa el cableado
  // de T-CL.7. future_bull (0085): la ficha lo muestra/togglea (R12.x). Sin declararlas, la stream
  // est_animal_profiles (SELECT *) NO las materializa en SQLite → "no such column" en vivo.
  assert.ok(cols.includes('is_castrated'), 'animal_profiles debe declarar is_castrated (0084, espejo C6 real)');
  assert.ok(cols.includes('future_bull'), 'animal_profiles debe declarar future_bull (0085, badge ⭐/toggle)');
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

// ─────────────────────────────────────────────────────────────────────────────
// GUARD anti-recurrencia (T4 bug "no such column: ap.created_by", 2026-06-09).
//
// Los SQL builders de local-reads.ts (T3+T4) SELECTean columnas de las tablas sincronizadas.
// Si el AppSchema NO declara una columna que un builder lee, PowerSync NO la materializa en el
// SQLite local y la query revienta en vivo con "no such column". Los unit tests de local-reads
// testean el STRING SQL, no corren contra el SQLite real → no cazan el gap. Este guard cierra
// el hueco: por cada tabla, verifica que el AppSchema declara TODA columna que los builders leen.
//
// `id` se EXCLUYE: es la PK implícita que el SDK agrega (no se declara, pero siempre es queryable).
// El mapa es MANUAL (derivado de local-reads.ts): cada columna está atribuida a su tabla DUEÑA,
// resolviendo los alias de JOIN (ap=animal_profiles, r=rodeos, c/m por contexto, etc.). Si se
// agrega un builder que lee una columna nueva, sumarla acá → el guard exige declararla en schema.ts.
const COLUMNS_READ_BY_BUILDERS: Record<string, string[]> = {
  // catálogos globales
  field_definitions: ['data_key', 'label', 'description', 'category', 'data_type', 'ui_component', 'active'],
  system_default_fields: ['field_definition_id', 'default_enabled', 'required_for_system', 'sort_order', 'system_id'],
  rodeo_data_config: ['field_definition_id', 'enabled', 'rodeo_id'],
  categories_by_system: ['code', 'name', 'system_id', 'active', 'sort_order'],
  species: ['code', 'active'],
  systems_by_species: ['species_id', 'code', 'name', 'active'],
  // contexto de establecimiento / miembros
  rodeos: ['establishment_id', 'name', 'species_id', 'system_id', 'active', 'deleted_at', 'created_at'],
  user_roles: ['role', 'user_id', 'establishment_id', 'active', 'member_name'],
  user_private: ['phone', 'email', 'user_id'],
  establishments: ['name', 'province', 'city', 'deleted_at', 'total_hectares'],
  invitations: ['role', 'email', 'created_at', 'expires_at', 'token', 'establishment_id', 'status'],
  management_groups: ['name', 'establishment_id', 'active', 'deleted_at'],
  // camino de datos
  animal_profiles: [
    'animal_id', 'establishment_id', 'idv', 'visual_id_alt', 'category_id', 'category_override',
    'breed', 'coat_color', 'entry_date', 'entry_weight', 'status', 'created_by', 'exit_date',
    'exit_reason', 'rodeo_id', 'management_group_id', 'animal_tag_electronic', 'animal_sex',
    'animal_birth_date', 'deleted_at', 'created_at',
    // spec 10 (T-CL.12): is_castrated (0084, espejo C6 con precedencia — lista + detalle) + future_bull
    // (0085, badge ⭐ / toggle de la ficha — detalle). Sin declararlas, PowerSync no las materializa →
    // "no such column" en buildAnimalsListQuery/buildAnimalDetailQuery en vivo.
    'is_castrated', 'future_bull',
  ],
  // timeline (7 orígenes)
  weight_events: ['weight_kg', 'source', 'notes', 'weight_date', 'created_at', 'animal_profile_id', 'deleted_at'],
  reproductive_events: [
    'event_type', 'pregnancy_status', 'calf_id', 'notes', 'event_date', 'created_at',
    'animal_profile_id', 'deleted_at', 'service_type',
  ],
  sanitary_events: ['event_type', 'product_name', 'route', 'notes', 'event_date', 'created_at', 'animal_profile_id', 'deleted_at'],
  condition_score_events: ['score', 'notes', 'event_date', 'created_at', 'animal_profile_id', 'deleted_at'],
  lab_samples: [
    'sample_type', 'tube_number', 'result', 'result_received_date', 'collection_date',
    'created_at', 'animal_profile_id', 'deleted_at',
  ],
  animal_category_history: ['from_category_id', 'to_category_id', 'changed_at', 'reason', 'animal_profile_id'],
  animal_events: [
    'event_type', 'text', 'structured_payload', 'author_id', 'edit_window_until',
    'created_at', 'animal_profile_id', 'deleted_at',
  ],
  birth_calves: ['birth_event_id', 'calf_profile_id'],
};

test('GUARD: el AppSchema declara TODA columna que los builders de local-reads.ts (T3+T4) leen', () => {
  const tables = tablesByName();
  for (const [tableName, neededCols] of Object.entries(COLUMNS_READ_BY_BUILDERS)) {
    const t = tables.get(tableName);
    assert.ok(t, `falta la tabla sincronizada ${tableName}`);
    const declared = new Set(t.columns.map((c) => c.name));
    for (const col of neededCols) {
      if (col === 'id') continue; // PK implícita: el SDK la agrega, no se declara.
      assert.ok(
        declared.has(col),
        `AppSchema.${tableName} NO declara '${col}', pero un builder de local-reads.ts lo SELECTea ` +
          `→ PowerSync no lo materializa → "no such column" en vivo. Agregalo en schema.ts.`,
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GUARD del OVERLAY (T6): las lecturas UNIONan synced + pending_* (R6.11). Si el overlay no declara
// una columna que el UNION lee, el SQLite local revienta con "no such column" en vivo (los unit tests
// de local-reads solo ven el STRING SQL, no corren contra SQLite). Este guard lo caza.
const OVERLAY_COLUMNS_READ_BY_BUILDERS: Record<string, string[]> = {
  // lista/detalle/count UNIONan pending_animal_profiles (espejo de animal_profiles + identidad b1).
  pending_animal_profiles: [
    'client_op_id', 'animal_id', 'establishment_id', 'rodeo_id', 'management_group_id', 'idv',
    'visual_id_alt', 'category_id', 'category_override', 'breed', 'coat_color', 'entry_date',
    'entry_weight', 'status', 'created_by', 'exit_date', 'exit_reason', 'animal_tag_electronic',
    'animal_sex', 'animal_birth_date', 'created_at',
  ],
  // timeline (parto optimista) + mother UNIONan pending_reproductive_events.
  pending_reproductive_events: ['client_op_id', 'animal_profile_id', 'event_type', 'event_date', 'notes'],
  // mother UNIONa pending_birth_calves (join por client_op_id a pending_reproductive_events).
  pending_birth_calves: ['client_op_id', 'calf_profile_id'],
  // la ocultación de exits/soft-deletes lee pending_status_overrides en TODAS las lecturas afectadas.
  // exit_date (residual #2): buildAnimalDetailQuery lo COALESCEa para el badge "Vendido el {fecha}" offline.
  pending_status_overrides: ['client_op_id', 'target_table', 'target_id', 'effect', 'status', 'exit_date'],
  // Run T9.8 — buildRodeosQuery UNIONa pending_rodeos; buildRodeoConfigQuery UNIONa pending_rodeo_data_config.
  pending_rodeos: ['client_op_id', 'establishment_id', 'name', 'species_id', 'system_id', 'active', 'created_at'],
  pending_rodeo_data_config: ['client_op_id', 'rodeo_id', 'field_definition_id', 'enabled'],
};

test('GUARD (T6): el overlay pending_* declara TODA columna que el UNION de lectura lee', () => {
  const tables = tablesByName();
  for (const [tableName, neededCols] of Object.entries(OVERLAY_COLUMNS_READ_BY_BUILDERS)) {
    const t = tables.get(tableName);
    assert.ok(t, `falta el overlay ${tableName}`);
    const declared = new Set(t.columns.map((c) => c.name));
    for (const col of neededCols) {
      if (col === 'id') continue; // PK implícita.
      assert.ok(
        declared.has(col),
        `AppSchema.${tableName} (overlay) NO declara '${col}', pero el UNION de una lectura T6 lo lee ` +
          `→ "no such column" en vivo. Agregalo en schema.ts.`,
      );
    }
  }
});
