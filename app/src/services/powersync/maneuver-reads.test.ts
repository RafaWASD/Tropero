// Tests de los SQL builders PUROS de MODO MANIOBRAS (spec 03 M1.2/M1.3 — sessions + maneuver_presets +
// gating capa 1). node:test + node:sqlite (DatabaseSync, nativo de Node 24): ejecutamos el SQL REAL
// contra tablas en memoria para verificar la SEMÁNTICA (qué columnas, qué filtros de dominio, qué orden),
// no solo el string. PURO: no carga el SDK de PowerSync, supabase ni RN.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  buildCreateSessionInsert,
  buildCloseSessionUpdate,
  buildSetWorkLotLabelUpdate,
  buildSetSessionCountsUpdate,
  buildSetSessionRodeoUpdate,
  buildMoveAnimalToRodeoUpdate,
  buildActiveSessionQuery,
  buildSessionByIdQuery,
  buildCreateManeuverPresetInsert,
  buildUpdateManeuverPresetUpdate,
  buildManeuverPresetsQuery,
  buildManeuverPresetByIdQuery,
  buildRodeoSystemQuery,
  buildActiveProfileRodeoQuery,
  buildAddCustomMeasurementInsert,
  buildSetCustomAttributeUpsert,
} from './local-reads';

// Espeja el AppSchema (TEXT/INTEGER; SQLite es laxo). started_at NO tiene default acá: el local write NO
// lo manda (lo pone el DB al subir) → queda NULL local, igual que en producción.
const SCHEMA =
  'CREATE TABLE sessions (id TEXT PRIMARY KEY, establishment_id TEXT, rodeo_id TEXT, config TEXT, ' +
  'status TEXT, work_lot_label TEXT, animal_count INTEGER, event_count INTEGER, notes TEXT, ' +
  'created_by TEXT, started_at TEXT, ended_at TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);' +
  'CREATE TABLE maneuver_presets (id TEXT PRIMARY KEY, establishment_id TEXT, name TEXT, config TEXT, ' +
  'created_by TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);' +
  'CREATE TABLE rodeos (id TEXT PRIMARY KEY, establishment_id TEXT, name TEXT, species_id TEXT, ' +
  'system_id TEXT, active INTEGER, deleted_at TEXT);' +
  'CREATE TABLE animal_profiles (id TEXT PRIMARY KEY, rodeo_id TEXT, deleted_at TEXT);' +
  // overlay optimista (localOnly): el soft-delete de preset escribe acá vía la OUTBOX → el preset se oculta.
  'CREATE TABLE pending_status_overrides (id TEXT, client_op_id TEXT, target_table TEXT, ' +
  'target_id TEXT, effect TEXT, status TEXT, exit_date TEXT);' +
  // spec 03 M5: captura custom append-only (id REAL) + propiedad custom current-value (id SINTÉTICO local
  // por la PK compuesta). recorded_by/updated_by/establishment_id NO se declaran acá (los fuerza el trigger
  // al subir) → quedan NULL local, igual que en producción.
  'CREATE TABLE custom_measurements (id TEXT PRIMARY KEY, animal_profile_id TEXT, ' +
  'field_definition_id TEXT, value TEXT, session_id TEXT, notes TEXT, recorded_by TEXT, ' +
  'establishment_id TEXT, recorded_at TEXT, created_at TEXT, deleted_at TEXT);' +
  'CREATE TABLE custom_attributes (id TEXT PRIMARY KEY, animal_profile_id TEXT, ' +
  'field_definition_id TEXT, value TEXT, updated_by TEXT, establishment_id TEXT, updated_at TEXT, ' +
  'created_at TEXT);';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

function run(db: DatabaseSync, q: { sql: string; args: unknown[] }): void {
  db.prepare(q.sql).run(...(q.args as never[]));
}
function all<T>(db: DatabaseSync, q: { sql: string; args: unknown[] }): T[] {
  return db.prepare(q.sql).all(...(q.args as never[])) as T[];
}

// ─── sessions: createSession (R1.9/R1.10/R1.11) ───────────────────────────────────────

// helper: crea una sesión con started_at por default (un instante fijo) salvo override.
function insSession(
  db: DatabaseSync,
  id: string,
  est: string,
  rodeo: string,
  config = '{}',
  label: string | null = null,
  startedAt = '2026-06-13T10:00:00Z',
): void {
  run(db, buildCreateSessionInsert(id, est, rodeo, config, label, startedAt));
}

test('buildCreateSessionInsert: crea la sesión con status active, contadores en 0, config TEXT, started_at de cliente, created_by NULL', () => {
  const db = freshDb();
  run(db, buildCreateSessionInsert('s1', 'est-A', 'rod-1', '{"maniobras":["tacto"]}', 'Lote rojo', '2026-06-13T09:30:00Z'));
  const rows = all<{
    id: string;
    establishment_id: string;
    rodeo_id: string;
    config: string;
    status: string;
    work_lot_label: string | null;
    animal_count: number;
    event_count: number;
    started_at: string | null;
    created_by: string | null;
  }>(db, { sql: 'SELECT * FROM sessions', args: [] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, 's1');
  assert.equal(r.establishment_id, 'est-A');
  assert.equal(r.rodeo_id, 'rod-1');
  assert.equal(r.config, '{"maniobras":["tacto"]}');
  assert.equal(r.status, 'active');
  assert.equal(r.work_lot_label, 'Lote rojo');
  assert.equal(r.animal_count, 0);
  assert.equal(r.event_count, 0);
  assert.equal(r.started_at, '2026-06-13T09:30:00Z'); // de cliente (persiste al subir, R10.5 reanudación offline).
  assert.equal(r.created_by, null); // lo FUERZA el trigger al subir (R11.2) — no se manda local.
});

test('buildCreateSessionInsert: work_lot_label null se persiste como NULL (R9.4 opcional)', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  const r = all<{ work_lot_label: string | null }>(db, {
    sql: 'SELECT work_lot_label FROM sessions',
    args: [],
  })[0];
  assert.equal(r.work_lot_label, null);
});

// ─── sessions: closeSession (R10.7) ───────────────────────────────────────────────────

test('buildCloseSessionUpdate: pasa a closed + setea ended_at; ignora una sesión soft-deleted', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  insSession(db, 's2', 'est-A', 'rod-1');
  db.prepare("UPDATE sessions SET deleted_at = '2026-01-01' WHERE id = 's2'").run();

  run(db, buildCloseSessionUpdate('s1', '2026-06-13T10:00:00Z'));
  run(db, buildCloseSessionUpdate('s2', '2026-06-13T10:00:00Z')); // borrada → no debe tocarse

  const s1 = all<{ status: string; ended_at: string | null }>(db, {
    sql: "SELECT status, ended_at FROM sessions WHERE id = 's1'",
    args: [],
  })[0];
  assert.equal(s1.status, 'closed');
  assert.equal(s1.ended_at, '2026-06-13T10:00:00Z');

  const s2 = all<{ status: string; ended_at: string | null }>(db, {
    sql: "SELECT status, ended_at FROM sessions WHERE id = 's2'",
    args: [],
  })[0];
  assert.equal(s2.status, 'active'); // intacta (deleted_at IS NOT NULL → el UPDATE la filtra)
  assert.equal(s2.ended_at, null);
});

// ─── sessions: closeActiveSessions (R10.6 — enforzar ≤1 activa por establishment) ──────

import { buildCloseActiveSessionsUpdate } from './local-reads';

test('buildCloseActiveSessionsUpdate: cierra TODAS las activas del establishment (no solo la más reciente)', () => {
  const db = freshDb();
  // 3 activas del MISMO establishment (las huérfanas acumuladas que el bug deja).
  insSession(db, 's1', 'est-A', 'rod-1');
  insSession(db, 's2', 'est-A', 'rod-1');
  insSession(db, 's3', 'est-A', 'rod-2');

  run(db, buildCloseActiveSessionsUpdate('est-A', '2026-06-16T12:00:00Z'));

  const rows = all<{ id: string; status: string; ended_at: string | null }>(db, {
    sql: 'SELECT id, status, ended_at FROM sessions ORDER BY id',
    args: [],
  });
  for (const r of rows) {
    assert.equal(r.status, 'closed', `sesión ${r.id} debería quedar closed`);
    assert.equal(r.ended_at, '2026-06-16T12:00:00Z');
  }
});

test('buildCloseActiveSessionsUpdate: NO toca otros establishments, ni sesiones cerradas, ni soft-deleted', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1'); // activa de A → se cierra
  insSession(db, 's2', 'est-B', 'rod-1'); // activa de OTRO establishment → intacta (multi-tenant)
  insSession(db, 's3', 'est-A', 'rod-1'); // ya cerrada → no se re-toca (conserva su ended_at original)
  db.prepare("UPDATE sessions SET status = 'closed', ended_at = '2026-01-01' WHERE id = 's3'").run();
  insSession(db, 's4', 'est-A', 'rod-1'); // activa pero soft-deleted → intacta
  db.prepare("UPDATE sessions SET deleted_at = '2026-01-01' WHERE id = 's4'").run();

  run(db, buildCloseActiveSessionsUpdate('est-A', '2026-06-16T12:00:00Z'));

  const byId = (id: string) =>
    all<{ status: string; ended_at: string | null }>(db, {
      sql: 'SELECT status, ended_at FROM sessions WHERE id = ?',
      args: [id],
    })[0];

  assert.equal(byId('s1').status, 'closed'); // activa de A → cerrada
  assert.equal(byId('s1').ended_at, '2026-06-16T12:00:00Z');
  assert.equal(byId('s2').status, 'active'); // otro establishment → intacta
  assert.equal(byId('s2').ended_at, null);
  assert.equal(byId('s3').status, 'closed'); // ya cerrada → su ended_at NO se pisa
  assert.equal(byId('s3').ended_at, '2026-01-01');
  assert.equal(byId('s4').status, 'active'); // soft-deleted → el UPDATE la filtra
  assert.equal(byId('s4').ended_at, null);
});

// ─── sessions: work_lot_label + counters ──────────────────────────────────────────────

test('buildSetWorkLotLabelUpdate: setea y limpia (null) el label informativo', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  run(db, buildSetWorkLotLabelUpdate('s1', 'Vacas paridas'));
  assert.equal(
    all<{ work_lot_label: string | null }>(db, { sql: 'SELECT work_lot_label FROM sessions', args: [] })[0]
      .work_lot_label,
    'Vacas paridas',
  );
  run(db, buildSetWorkLotLabelUpdate('s1', null));
  assert.equal(
    all<{ work_lot_label: string | null }>(db, { sql: 'SELECT work_lot_label FROM sessions', args: [] })[0]
      .work_lot_label,
    null,
  );
});

test('buildSetSessionCountsUpdate: setea contadores ABSOLUTOS (no incrementa)', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  run(db, buildSetSessionCountsUpdate('s1', 7, 21));
  const r = all<{ animal_count: number; event_count: number }>(db, {
    sql: 'SELECT animal_count, event_count FROM sessions',
    args: [],
  })[0];
  assert.equal(r.animal_count, 7);
  assert.equal(r.event_count, 21);
});

// ─── sessions: setSessionRodeo (R4.7 — cambiar el rodeo de la jornada mal elegida) ─────────────────

test('buildSetSessionRodeoUpdate: re-apunta el rodeo de una sesión ACTIVA (R4.7)', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  run(db, buildSetSessionRodeoUpdate('s1', 'rod-2'));
  const r = all<{ rodeo_id: string }>(db, { sql: "SELECT rodeo_id FROM sessions WHERE id = 's1'", args: [] })[0];
  assert.equal(r.rodeo_id, 'rod-2');
});

test('buildSetSessionRodeoUpdate: NO toca una sesión cerrada ni una soft-deleted (solo activas)', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  insSession(db, 's2', 'est-A', 'rod-1');
  db.prepare("UPDATE sessions SET status = 'closed' WHERE id = 's1'").run();
  db.prepare("UPDATE sessions SET deleted_at = '2026-01-01' WHERE id = 's2'").run();

  run(db, buildSetSessionRodeoUpdate('s1', 'rod-9')); // cerrada → no debe tocarse
  run(db, buildSetSessionRodeoUpdate('s2', 'rod-9')); // borrada → no debe tocarse

  const s1 = all<{ rodeo_id: string }>(db, { sql: "SELECT rodeo_id FROM sessions WHERE id = 's1'", args: [] })[0];
  const s2 = all<{ rodeo_id: string }>(db, { sql: "SELECT rodeo_id FROM sessions WHERE id = 's2'", args: [] })[0];
  assert.equal(s1.rodeo_id, 'rod-1');
  assert.equal(s2.rodeo_id, 'rod-1');
});

// ─── animal_profiles: moveAnimalToRodeo (R4.4 — pasar el animal a este rodeo) ──────────

test('buildMoveAnimalToRodeoUpdate: re-apunta el rodeo_id del perfil ACTIVO (R4.4 "pasar a este rodeo")', () => {
  const db = freshDb();
  db.prepare('INSERT INTO animal_profiles (id, rodeo_id, deleted_at) VALUES (?, ?, NULL)').run('ap-1', 'rod-B');
  // Pasamos el animal del rodeo B al rodeo A (el de la jornada).
  run(db, buildMoveAnimalToRodeoUpdate('ap-1', 'rod-A'));
  const r = all<{ rodeo_id: string }>(db, { sql: "SELECT rodeo_id FROM animal_profiles WHERE id = 'ap-1'", args: [] })[0];
  assert.equal(r.rodeo_id, 'rod-A');
});

test('buildMoveAnimalToRodeoUpdate: NO toca un perfil soft-deleted (deleted_at IS NULL)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO animal_profiles (id, rodeo_id, deleted_at) VALUES (?, ?, '2026-01-01')").run('ap-2', 'rod-B');
  run(db, buildMoveAnimalToRodeoUpdate('ap-2', 'rod-A')); // borrado → no debe tocarse
  const r = all<{ rodeo_id: string }>(db, { sql: "SELECT rodeo_id FROM animal_profiles WHERE id = 'ap-2'", args: [] })[0];
  assert.equal(r.rodeo_id, 'rod-B'); // intacto
});

// ─── sessions: getActiveSession (R10.5/R10.6) ─────────────────────────────────────────

test('buildActiveSessionQuery: devuelve SOLO la activa del establishment (no closed, no borrada, no de otro est)', () => {
  const db = freshDb();
  insSession(db, 's-active', 'est-A', 'rod-1', '{}', null, '2026-06-13T09:00:00Z');
  // closed del mismo est → no
  insSession(db, 's-closed', 'est-A', 'rod-1');
  db.prepare("UPDATE sessions SET status = 'closed' WHERE id = 's-closed'").run();
  // borrada del mismo est → no
  insSession(db, 's-del', 'est-A', 'rod-1');
  db.prepare("UPDATE sessions SET deleted_at = '2026-01-01' WHERE id = 's-del'").run();
  // activa de OTRO est → no (defensa; la stream ya scopea, pero el filtro establishment_id lo confirma)
  insSession(db, 's-other', 'est-B', 'rod-9');

  const rows = all<{ id: string }>(db, buildActiveSessionQuery('est-A'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 's-active');
});

test('buildActiveSessionQuery: con 2 activas (borde) devuelve la más reciente por started_at DESC', () => {
  const db = freshDb();
  insSession(db, 's-old', 'est-A', 'rod-1', '{}', null, '2026-06-13T08:00:00Z');
  insSession(db, 's-new', 'est-A', 'rod-1', '{}', null, '2026-06-13T12:00:00Z');

  const rows = all<{ id: string }>(db, buildActiveSessionQuery('est-A'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 's-new');
});

test('buildSessionByIdQuery: lee por id; una borrada → 0 filas', () => {
  const db = freshDb();
  insSession(db, 's1', 'est-A', 'rod-1');
  assert.equal(all<{ id: string }>(db, buildSessionByIdQuery('s1')).length, 1);
  db.prepare("UPDATE sessions SET deleted_at = '2026-01-01' WHERE id = 's1'").run();
  assert.equal(all<{ id: string }>(db, buildSessionByIdQuery('s1')).length, 0);
});

// ─── maneuver_presets (R2.1/R2.2/R2.5) ────────────────────────────────────────────────

test('buildCreateManeuverPresetInsert: crea el preset; created_by NULL (lo fuerza el trigger al subir)', () => {
  const db = freshDb();
  run(db, buildCreateManeuverPresetInsert('p1', 'est-A', 'Tacto + vacuna', '{"maniobras":["tacto","vacunacion"]}'));
  const r = all<{ id: string; name: string; config: string; created_by: string | null }>(db, {
    sql: 'SELECT id, name, config, created_by FROM maneuver_presets',
    args: [],
  })[0];
  assert.equal(r.id, 'p1');
  assert.equal(r.name, 'Tacto + vacuna');
  assert.equal(r.config, '{"maniobras":["tacto","vacunacion"]}');
  assert.equal(r.created_by, null);
});

test('buildUpdateManeuverPresetUpdate: renombra + reconfigura; ignora un preset borrado', () => {
  const db = freshDb();
  run(db, buildCreateManeuverPresetInsert('p1', 'est-A', 'Viejo', '{}'));
  run(db, buildCreateManeuverPresetInsert('p2', 'est-A', 'Borrado', '{}'));
  db.prepare("UPDATE maneuver_presets SET deleted_at = '2026-01-01' WHERE id = 'p2'").run();

  run(db, buildUpdateManeuverPresetUpdate('p1', 'Nuevo nombre', '{"maniobras":["pesaje"]}'));
  run(db, buildUpdateManeuverPresetUpdate('p2', 'No debe cambiar', '{}'));

  const p1 = all<{ name: string; config: string }>(db, {
    sql: "SELECT name, config FROM maneuver_presets WHERE id = 'p1'",
    args: [],
  })[0];
  assert.equal(p1.name, 'Nuevo nombre');
  assert.equal(p1.config, '{"maniobras":["pesaje"]}');
  const p2 = all<{ name: string }>(db, {
    sql: "SELECT name FROM maneuver_presets WHERE id = 'p2'",
    args: [],
  })[0];
  assert.equal(p2.name, 'Borrado'); // intacto (deleted_at filtra el UPDATE)
});

test('buildManeuverPresetsQuery: lista los activos del est ordenados por nombre; excluye borrados y otros est', () => {
  const db = freshDb();
  run(db, buildCreateManeuverPresetInsert('p1', 'est-A', 'Tacto', '{}'));
  run(db, buildCreateManeuverPresetInsert('p2', 'est-A', 'Destete', '{}')); // Destete < Tacto (ASCII)
  run(db, buildCreateManeuverPresetInsert('p3', 'est-A', 'Borrado', '{}'));
  db.prepare("UPDATE maneuver_presets SET deleted_at = '2026-01-01' WHERE id = 'p3'").run();
  run(db, buildCreateManeuverPresetInsert('p4', 'est-B', 'OtroCampo', '{}'));

  const rows = all<{ id: string; name: string }>(db, buildManeuverPresetsQuery('est-A'));
  assert.deepEqual(rows.map((r) => r.name), ['Destete', 'Tacto']);
});

test('buildManeuverPresetsQuery: un preset con soft_deleted pendiente (overlay) se OCULTA al instante (R6.11)', () => {
  const db = freshDb();
  run(db, buildCreateManeuverPresetInsert('p1', 'est-A', 'Vivo', '{}'));
  run(db, buildCreateManeuverPresetInsert('p2', 'est-A', 'Borrando', '{}'));
  // softDeletePreset (OUTBOX) escribe un override 'soft_deleted' para p2 ANTES de que la RPC corra.
  db.prepare(
    "INSERT INTO pending_status_overrides (id, client_op_id, target_table, target_id, effect) " +
      "VALUES ('ov1', 'op1', 'maneuver_presets', 'p2', 'soft_deleted')",
  ).run();

  const rows = all<{ id: string; name: string }>(db, buildManeuverPresetsQuery('est-A'));
  assert.deepEqual(rows.map((r) => r.name), ['Vivo']); // p2 oculto por el overlay
});

test('buildManeuverPresetByIdQuery: lee por id; uno borrado → 0 filas', () => {
  const db = freshDb();
  run(db, buildCreateManeuverPresetInsert('p1', 'est-A', 'Preset', '{}'));
  assert.equal(all<{ id: string }>(db, buildManeuverPresetByIdQuery('p1')).length, 1);
  db.prepare("UPDATE maneuver_presets SET deleted_at = '2026-01-01' WHERE id = 'p1'").run();
  assert.equal(all<{ id: string }>(db, buildManeuverPresetByIdQuery('p1')).length, 0);
});

// ─── gating capa 1: resolución del rodeo (M1.1) ───────────────────────────────────────

test('buildRodeoSystemQuery: devuelve el system_id del rodeo', () => {
  const db = freshDb();
  db.prepare('INSERT INTO rodeos (id, system_id) VALUES (?, ?)').run('rod-1', 'sys-cria');
  const rows = all<{ system_id: string }>(db, buildRodeoSystemQuery('rod-1'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].system_id, 'sys-cria');
});

test('buildActiveProfileRodeoQuery: devuelve el rodeo del perfil ACTIVO; un perfil soft-deleted → 0 filas (fail-safe UI)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO animal_profiles (id, rodeo_id, deleted_at) VALUES (?, ?, NULL)').run('ap-1', 'rod-7');
  db.prepare("INSERT INTO animal_profiles (id, rodeo_id, deleted_at) VALUES (?, ?, '2026-01-01')").run('ap-2', 'rod-7');

  const active = all<{ rodeo_id: string }>(db, buildActiveProfileRodeoQuery('ap-1'));
  assert.equal(active.length, 1);
  assert.equal(active[0].rodeo_id, 'rod-7');

  // perfil soft-deleted → 0 filas (paralelo al fail-closed de la capa 2: no se resuelve el rodeo).
  assert.equal(all<{ rodeo_id: string }>(db, buildActiveProfileRodeoQuery('ap-2')).length, 0);
  // perfil inexistente → 0 filas.
  assert.equal(all<{ rodeo_id: string }>(db, buildActiveProfileRodeoQuery('nope')).length, 0);
});

// ─── custom_measurements: captura de maniobra custom (M5-C.1, R13.11 append-only) ──────────────

test('buildAddCustomMeasurementInsert: inserta una captura con id REAL, value jsonb TEXT, session_id; audit NULL local', () => {
  const db = freshDb();
  run(db, buildAddCustomMeasurementInsert('cm1', 'ap-1', 'fd-angulo', '42.5', 's1', 'pezuña trasera'));
  const r = all<{
    id: string;
    animal_profile_id: string;
    field_definition_id: string;
    value: string;
    session_id: string | null;
    notes: string | null;
    recorded_by: string | null;
    establishment_id: string | null;
  }>(db, { sql: 'SELECT * FROM custom_measurements', args: [] })[0];
  assert.equal(r.id, 'cm1');
  assert.equal(r.animal_profile_id, 'ap-1');
  assert.equal(r.field_definition_id, 'fd-angulo');
  assert.equal(r.value, '42.5'); // el número JSON serializado por el service (no string)
  assert.equal(r.session_id, 's1');
  assert.equal(r.notes, 'pezuña trasera');
  assert.equal(r.recorded_by, null); // lo FUERZA el trigger al subir (R13.23) — no se manda local
  assert.equal(r.establishment_id, null); // idem (derivado del perfil, anti-spoof) — no se manda local
});

test('buildAddCustomMeasurementInsert: APPEND-ONLY — dos capturas del mismo (animal, field) son DOS filas (time-series)', () => {
  const db = freshDb();
  run(db, buildAddCustomMeasurementInsert('cm1', 'ap-1', 'fd-angulo', '42.5', 's1', null));
  run(db, buildAddCustomMeasurementInsert('cm2', 'ap-1', 'fd-angulo', '44', 's2', null));
  const rows = all<{ id: string; value: string }>(db, {
    sql: 'SELECT id, value FROM custom_measurements ORDER BY id',
    args: [],
  });
  assert.equal(rows.length, 2, 'append-only: NO pisa la captura anterior');
  assert.deepEqual(rows.map((r) => r.value), ['42.5', '44']);
});

test('buildAddCustomMeasurementInsert: session_id y notes opcionales → NULL (captura desde la ficha, sin jornada)', () => {
  const db = freshDb();
  run(db, buildAddCustomMeasurementInsert('cm1', 'ap-1', 'fd-temp', 'true', null, null));
  const r = all<{ value: string; session_id: string | null; notes: string | null }>(db, {
    sql: 'SELECT value, session_id, notes FROM custom_measurements',
    args: [],
  })[0];
  assert.equal(r.value, 'true'); // boolean JSON
  assert.equal(r.session_id, null);
  assert.equal(r.notes, null);
});

// ─── custom_attributes: current-value de propiedad custom (M5-C.1, R13.12 upsert por PK compuesta) ──────

test('buildSetCustomAttributeUpsert: inserta el current-value con id SINTÉTICO (animal:field); audit NULL local', () => {
  const db = freshDb();
  run(db, buildSetCustomAttributeUpsert('ap-1', 'fd-color', '"overo"'));
  const r = all<{
    id: string;
    animal_profile_id: string;
    field_definition_id: string;
    value: string;
    updated_by: string | null;
    establishment_id: string | null;
  }>(db, { sql: 'SELECT * FROM custom_attributes', args: [] })[0];
  assert.equal(r.id, 'ap-1:fd-color'); // id sintético = el alias de la stream (DOWN) → LWW al bajar la real
  assert.equal(r.animal_profile_id, 'ap-1');
  assert.equal(r.field_definition_id, 'fd-color');
  assert.equal(r.value, '"overo"'); // string JSON
  assert.equal(r.updated_by, null); // lo FUERZA el trigger al subir (R13.23) — no se manda local
  assert.equal(r.establishment_id, null); // idem (derivado del perfil, anti-spoof)
});

test('buildSetCustomAttributeUpsert: UPSERT — re-editar el mismo (animal, field) PISA el valor (NO duplica, current-value)', () => {
  const db = freshDb();
  run(db, buildSetCustomAttributeUpsert('ap-1', 'fd-color', '"overo"'));
  run(db, buildSetCustomAttributeUpsert('ap-1', 'fd-color', '"colorado"')); // editable anytime (R13.12)
  const rows = all<{ id: string; value: string }>(db, {
    sql: 'SELECT id, value FROM custom_attributes',
    args: [],
  });
  assert.equal(rows.length, 1, 'current-value: una sola fila por (animal, field), no historial');
  assert.equal(rows[0].value, '"colorado"'); // el ÚLTIMO valor gana (LWW)
});

test('buildSetCustomAttributeUpsert: distintos (animal, field) son filas distintas (id sintético único por par)', () => {
  const db = freshDb();
  run(db, buildSetCustomAttributeUpsert('ap-1', 'fd-color', '"overo"'));
  run(db, buildSetCustomAttributeUpsert('ap-2', 'fd-color', '"negro"')); // otro animal
  run(db, buildSetCustomAttributeUpsert('ap-1', 'fd-temperamento', '"manso"')); // mismo animal, otro field
  const rows = all<{ id: string }>(db, { sql: 'SELECT id FROM custom_attributes ORDER BY id', args: [] });
  assert.deepEqual(rows.map((r) => r.id), ['ap-1:fd-color', 'ap-1:fd-temperamento', 'ap-2:fd-color']);
});
