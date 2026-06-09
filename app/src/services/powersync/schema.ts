// AppSchema — el schema LOCAL de PowerSync (spec 15, T1.3 / R2.1).
//
// PowerSync no enforça tipos: AppSchema es una VISTA sobre lo que sincronizan las sync streams
// (sync-streams/rafaq.yaml). Espeja las 26 tablas sincronizadas del schema as-built + 1 tabla
// OUTBOX (`op_intents`, insertOnly) + las 5 tablas OVERLAY optimista (`pending_*`, localOnly).
//
// Reglas del SDK (verificadas contra @powersync/common 1.53.2 instalado):
//  - Cada tabla lleva una columna `id` (TEXT) IMPLÍCITA que es su PK local. NO se declara a mano
//    (el SDK tira "An id column is automatically added, custom id columns are not supported").
//  - Las filas que bajan por la stream DEBEN traer un `id`. Para las tablas cuyo PK as-built NO se
//    llama `id` (user_private: PK `user_id`) o es COMPUESTO (rodeo_data_config, birth_calves), la
//    stream EMITE un `id` con alias/sintético (ver rafaq.yaml). Acá esas tablas mantienen sus
//    columnas as-built como columnas normales; el `id` implícito porta el valor aliased/sintético.
//    → reconciliación de la "decisión abierta de PK" (design §PK), resuelta en T1.3.
//  - column.text/integer/real. timestamptz/date/uuid → TEXT (PowerSync no tipa, SQLite es laxo).
//  - localOnly: true  → NO genera CrudEntry (overlay optimista, no se sube). R6.11/R6.12.
//  - insertOnly: true → SÍ genera CrudEntry pero NO persiste la fila como dato local; es la outbox
//    write-side (R6.8). uploadData() la mapea a supabase.rpc(...) por op.table === 'op_intents'.
//
// Solo se declaran las columnas que la app lee/escribe (una columna no declarada simplemente no es
// queryable; no rompe el sync). Se priorizan las columnas que usan los services del camino de campo.

import { column, Schema, Table } from '@powersync/common';

// ─── Catálogos globales (read-only, sin filtro de establecimiento) ────────────────────
const species = new Table({
  code: column.text,
  name: column.text,
  icon: column.text,
  active: column.integer,
  created_at: column.text,
  updated_at: column.text,
});

const systems_by_species = new Table({
  species_id: column.text,
  code: column.text,
  name: column.text,
  active: column.integer,
  created_at: column.text,
  updated_at: column.text,
});

const categories_by_system = new Table({
  system_id: column.text,
  code: column.text,
  name: column.text,
  parent_category_id: column.text,
  sort_order: column.integer,
  active: column.integer,
  created_at: column.text,
  updated_at: column.text,
});

const field_definitions = new Table({
  data_key: column.text,
  label: column.text,
  description: column.text,
  category: column.text,
  data_type: column.text,
  ui_component: column.text,
  config_schema: column.text,
  schema_version: column.integer,
  active: column.integer,
  created_at: column.text,
  updated_at: column.text,
});

const system_default_fields = new Table({
  system_id: column.text,
  field_definition_id: column.text,
  default_enabled: column.integer,
  required_for_system: column.integer,
  sort_order: column.integer,
});

// ─── Self-only (PII + per-user; nunca cruza a un coworker) ────────────────────────────
// user_private: PK as-built `user_id`. La stream emite `SELECT user_id AS id, ...` → el `id`
// implícito porta el user_id. Mantenemos `user_id` como columna para consultarlo explícitamente.
const user_private = new Table({
  user_id: column.text,
  email: column.text,
  phone: column.text,
  created_at: column.text,
  updated_at: column.text,
});

// user_roles: una fila por (user, est, role). Llega por self_user_roles (propio) y por est_members
// (matriz owner-gated de coworkers). PK `id` simple.
// PASO 2 (ADR-026 §C / c2 / 0080): `member_name` denormalizado desde `users.name` (la tabla global
// `users` NO entra al sync set). buildMembersQuery/buildOwnNameQuery (local-reads) ya leen esta columna
// para mostrar nombres de coworkers (y el propio) offline. PII (email/phone) sigue en user_private.
const user_roles = new Table({
  user_id: column.text,
  establishment_id: column.text,
  role: column.text,
  active: column.integer,
  member_name: column.text,
  created_at: column.text,
  deactivated_at: column.text,
});

// ─── Per-establishment ────────────────────────────────────────────────────────────────
// users: perfil PÚBLICO de coworkers (id, name). email/phone YA NO viven acá (0068 los movió a
// user_private) → no hay PII en esta tabla.
const users = new Table({
  name: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const establishments = new Table({
  name: column.text,
  province: column.text,
  city: column.text,
  latitude: column.real,
  longitude: column.real,
  total_hectares: column.real,
  plan_type: column.text,
  plan_started_at: column.text,
  plan_limits: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const invitations = new Table({
  establishment_id: column.text,
  invited_by: column.text,
  email: column.text,
  role: column.text,
  token: column.text,
  status: column.text,
  expires_at: column.text,
  accepted_at: column.text,
  cancelled_at: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const rodeos = new Table({
  establishment_id: column.text,
  name: column.text,
  species_id: column.text,
  system_id: column.text,
  active: column.integer,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

// rodeo_data_config: PK COMPUESTA (rodeo_id, field_definition_id). La stream emite un id sintético
// `SELECT (rodeo_id || ':' || field_definition_id) AS id, ...`. Read-only local en MVP.
// PASO 2 (ADR-026 §A / 0078): `establishment_id` denormalizado (derivado del rodeo por trigger).
// Va como columna NORMAL más; NO se declara `id` propio (el SDK lo agrega y lo prohíbe — lo porta el alias).
const rodeo_data_config = new Table({
  rodeo_id: column.text,
  field_definition_id: column.text,
  establishment_id: column.text,
  enabled: column.integer,
  custom_config: column.text,
  created_at: column.text,
  updated_at: column.text,
});

const management_groups = new Table({
  establishment_id: column.text,
  name: column.text,
  active: column.integer,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const animal_profiles = new Table({
  animal_id: column.text,
  establishment_id: column.text,
  rodeo_id: column.text,
  management_group_id: column.text,
  idv: column.text,
  visual_id_alt: column.text,
  category_id: column.text,
  category_override: column.integer,
  breed: column.text,
  coat_color: column.text,
  birth_weight: column.real,
  teeth_state: column.text,
  is_cut: column.integer,
  entry_date: column.text,
  entry_weight: column.real,
  entry_origin: column.text,
  exit_date: column.text,
  exit_reason: column.text,
  exit_weight: column.real,
  exit_price: column.real,
  status: column.text,
  notes: column.text,
  // PASO 2 (ADR-026 §B / b1 / 0079): identidad del animal GLOBAL denormalizada sobre el perfil per-campo,
  // mantenida fiel por trigger (force desde `animals` + propagación). `animals` NO entra al sync set; la UI
  // lee la identidad offline DESDE acá (swap T4). Tipos = animals (0019): text, text, date→TEXT.
  animal_tag_electronic: column.text,
  animal_sex: column.text,
  animal_birth_date: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

// animals: global (sin establishment_id, ADR-004). Llega por existencia de perfil (est_animals).
const animals = new Table({
  tag_electronic: column.text,
  species_id: column.text,
  sex: column.text,
  birth_date: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const animal_category_history = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  from_category_id: column.text,
  to_category_id: column.text,
  changed_at: column.text,
  changed_by: column.text,
  reason: column.text,
});

const sessions = new Table({
  establishment_id: column.text,
  rodeo_id: column.text,
  config: column.text,
  status: column.text,
  work_lot_label: column.text,
  animal_count: column.integer,
  event_count: column.integer,
  notes: column.text,
  created_by: column.text,
  started_at: column.text,
  ended_at: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const maneuver_presets = new Table({
  establishment_id: column.text,
  name: column.text,
  config: column.text,
  created_by: column.text,
  created_at: column.text,
  updated_at: column.text,
  deleted_at: column.text,
});

const semen_registry = new Table({
  establishment_id: column.text,
  pajuela_name: column.text,
  bull_name: column.text,
  breed: column.text,
  supplier: column.text,
  notes: column.text,
  created_at: column.text,
  deleted_at: column.text,
});

// ─── Eventos ──────────────────────────────────────────────────────────────────────────
// PASO 2 (ADR-026 §A / 0077): se DENORMALIZÓ `establishment_id` sobre las 5 tablas de evento +
// animal_category_history (lo derivaban del perfil por FK). Un trigger-force lo mantiene fiel desde
// `animal_profiles.establishment_id` (anti-spoof). Se declara acá (column.text — uuid→TEXT) para que
// la fila local lo materialice cuando baje por su stream (ev_*); el scoping del wire es server-side.
const weight_events = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  session_id: column.text,
  weight_kg: column.real,
  weight_date: column.text,
  time: column.text,
  source: column.text,
  notes: column.text,
  created_by: column.text,
  created_at: column.text,
  deleted_at: column.text,
});

const reproductive_events = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  session_id: column.text,
  event_type: column.text,
  event_date: column.text,
  service_type: column.text,
  bull_id: column.text,
  semen_id: column.text,
  pregnancy_status: column.text,
  estimated_days: column.integer,
  estimated_birth: column.text,
  calf_id: column.text,
  calf_weight: column.real,
  calf_sex: column.text,
  calf_tag_electronic: column.text,
  notes: column.text,
  created_by: column.text,
  created_at: column.text,
  deleted_at: column.text,
});

const sanitary_events = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  session_id: column.text,
  campaign_id: column.text,
  event_type: column.text,
  product_name: column.text,
  active_ingredient: column.text,
  dose_ml: column.real,
  route: column.text,
  event_date: column.text,
  next_dose_date: column.text,
  result: column.text,
  adverse_reaction: column.integer,
  notes: column.text,
  created_by: column.text,
  created_at: column.text,
  deleted_at: column.text,
});

const condition_score_events = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  session_id: column.text,
  score: column.real,
  event_date: column.text,
  notes: column.text,
  created_by: column.text,
  created_at: column.text,
  deleted_at: column.text,
});

const lab_samples = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  session_id: column.text,
  sample_type: column.text,
  tube_number: column.text,
  collection_date: column.text,
  lab_destination: column.text,
  result: column.text,
  result_interpretation: column.text,
  result_received_date: column.text,
  notes: column.text,
  created_by: column.text,
  created_at: column.text,
  deleted_at: column.text,
});

const animal_events = new Table({
  animal_profile_id: column.text,
  establishment_id: column.text,
  author_id: column.text,
  created_at: column.text,
  event_type: column.text,
  text: column.text,
  structured_payload: column.text,
  edit_window_until: column.text,
  deleted_at: column.text,
});

// birth_calves: PK COMPUESTA (birth_event_id, calf_profile_id). La stream emite un id sintético
// `SELECT (birth_event_id || ':' || calf_profile_id) AS id, ...`. Read-only local (server-poblada).
// PASO 2 (ADR-026 §A / 0078): `establishment_id` denormalizado (derivado del parto→madre por trigger).
// Va como columna NORMAL más; NO se declara `id` propio (el SDK lo agrega y lo prohíbe — lo porta el alias).
const birth_calves = new Table({
  birth_event_id: column.text,
  calf_profile_id: column.text,
  establishment_id: column.text,
  created_at: column.text,
});

// ─── OUTBOX (write-side, NO sincronizada) — op_intents (insertOnly, R6.8) ──────────────
// insertOnly: genera CrudEntry para que uploadData() la procese (→ supabase.rpc), pero NO replica
// la fila como CRUD plano ni persiste como dato local. El `id` implícito = client_op_id (idempotencia
// R6.10). NUNCA se hace supabase.from('op_intents').insert(...): la fila vive solo en AppSchema.
const op_intents = new Table(
  {
    op_type: column.text,
    params_json: column.text,
    created_at: column.text,
  },
  { insertOnly: true },
);

// ─── OVERLAY optimista (localOnly, NO genera CrudEntry) — pending_* (R6.11/R6.12) ─────
// El efecto optimista de las ops (b) RPC-bound vive acá, NO en las tablas sincronizadas (evita el
// doble-upload: la única CrudEntry de una op (b) es su op_intent). Cada fila lleva el client_op_id
// del intent que la generó (para limpiar/rollbackear el overlay por client_op_id). Las lecturas
// hacen UNION synced + overlay. El wiring de escritura/lectura del overlay es Run T6 (acá solo el
// schema). Las columnas espejan lo mínimo que la UI muestra offline del ternero/alta/baja.
const pending_animals = new Table(
  {
    client_op_id: column.text,
    tag_electronic: column.text,
    species_id: column.text,
    sex: column.text,
    birth_date: column.text,
  },
  { localOnly: true },
);

const pending_animal_profiles = new Table(
  {
    client_op_id: column.text,
    animal_id: column.text,
    establishment_id: column.text,
    rodeo_id: column.text,
    management_group_id: column.text,
    idv: column.text,
    visual_id_alt: column.text,
    category_id: column.text,
    breed: column.text,
    status: column.text,
  },
  { localOnly: true },
);

const pending_reproductive_events = new Table(
  {
    client_op_id: column.text,
    animal_profile_id: column.text,
    event_type: column.text,
    event_date: column.text,
    notes: column.text,
  },
  { localOnly: true },
);

const pending_birth_calves = new Table(
  {
    client_op_id: column.text,
    birth_event_id: column.text,
    calf_profile_id: column.text,
  },
  { localOnly: true },
);

// pending_status_overrides: overlay de "ocultar/marcar" para bajas (exit) y soft-deletes — en vez de
// un UPDATE sobre la fila sincronizada. La lectura excluye/marca la fila objetivo (target_table,
// target_id) según effect ('soft_deleted' | 'exited').
const pending_status_overrides = new Table(
  {
    client_op_id: column.text,
    target_table: column.text,
    target_id: column.text,
    effect: column.text,
    status: column.text,
  },
  { localOnly: true },
);

// El KEY del objeto = nombre de la tabla local (debe matchear el output de la sync stream).
export const AppSchema = new Schema({
  // catálogos globales
  species,
  systems_by_species,
  categories_by_system,
  field_definitions,
  system_default_fields,
  // self-only
  user_private,
  user_roles,
  // per-establishment
  users,
  establishments,
  invitations,
  rodeos,
  rodeo_data_config,
  management_groups,
  animal_profiles,
  animals,
  animal_category_history,
  sessions,
  maneuver_presets,
  semen_registry,
  // eventos
  weight_events,
  reproductive_events,
  sanitary_events,
  condition_score_events,
  lab_samples,
  animal_events,
  birth_calves,
  // outbox (insertOnly, write-side)
  op_intents,
  // overlay optimista (localOnly)
  pending_animals,
  pending_animal_profiles,
  pending_reproductive_events,
  pending_birth_calves,
  pending_status_overrides,
});

export type Database = (typeof AppSchema)['types'];
