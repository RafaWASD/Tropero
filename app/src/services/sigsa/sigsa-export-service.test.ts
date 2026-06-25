// Tests de la CAPA DE SERVICIO de export SIGSA (spec 08, T11/T12/T19/T20). node:test + node:sqlite.
//
// PURO: NO carga el SDK de PowerSync, supabase, expo ni RN → corre siempre, sin device. El foco (igual que
// local-reads.test.ts / maneuver-reads.test.ts) es la CONSTRUCCIÓN del SQL de los builders puros + su
// SEMÁNTICA real ejecutada contra un SQLite en memoria (DatabaseSync, nativo de Node 24). La lógica del
// HOOK (useExportSigsa) que NO depende de React/contexts se prueba a través de las funciones PURAS que el
// hook usa (validateForExport → exportableCount + alineamiento de profileIds; el shape de redownload).
//
// Cobertura por task:
//   T11  — buildPendingSigsaAnimalsQuery: NO referencia `animals`; filtra no-declarados (LEFT JOIN
//          sigsa_declarations IS NULL); filtra tag NULL / status / rodeo / rango de fecha. + buildExportLogInsert
//          (1 fila, SIN generated_by) + buildSigsaDeclarationInsert (SIN declared_by).
//   T12  — exportableCount=0 (deshabilita el botón); alineamiento de los profileIds exportables 1:1 con los
//          records (lo que persistDeclarations necesita).
//   T19  — buildSigsaDeclarationInsert con export_log_id NULL (marca manual) distingue de export con archivo.
//   T20  — buildExportLogContentQuery es READ-ONLY (re-descarga no inserta declaraciones).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  buildPendingSigsaAnimalsQuery,
  buildExportLogInsert,
  buildSigsaDeclarationInsert,
  buildExportLogContentQuery,
  buildExportLogHistoryQuery,
} from '../powersync/local-reads.ts';
import { validateForExport } from './sigsa-validator.ts';
import type { PendingAnimalInfo } from './types.ts';

// ─── Esquema mínimo en memoria (las columnas que la query/inserts tocan) ──────────────────────
// animal_profiles con la identidad DENORMALIZADA (b1/0079): animal_tag_electronic/animal_sex/animal_birth_date.
// NO existe tabla `animals` acá: si la query la referenciara, el SQL fallaría → garantía estructural del
// "sin JOIN animals". breed_catalog + sigsa_declarations + export_log con lo justo.
const SCHEMA =
  'CREATE TABLE animal_profiles (id TEXT PRIMARY KEY, establishment_id TEXT, rodeo_id TEXT, status TEXT, ' +
  'breed_id TEXT, animal_tag_electronic TEXT, animal_sex TEXT, animal_birth_date TEXT, deleted_at TEXT);' +
  'CREATE TABLE breed_catalog (id TEXT PRIMARY KEY, senasa_code TEXT, name TEXT);' +
  'CREATE TABLE sigsa_declarations (id TEXT PRIMARY KEY, establishment_id TEXT, animal_profile_id TEXT, ' +
  'export_log_id TEXT, declared_at TEXT);' +
  'CREATE TABLE export_log (id TEXT PRIMARY KEY, establishment_id TEXT, generated_at TEXT, ' +
  'generated_by TEXT, animal_count INTEGER, file_name TEXT, file_content TEXT, rodeo_filter_id TEXT, ' +
  'date_from TEXT, date_to TEXT);';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}
function all<T>(db: DatabaseSync, q: { sql: string; args: unknown[] }): T[] {
  return db.prepare(q.sql).all(...(q.args as never[])) as T[];
}
function run(db: DatabaseSync, q: { sql: string; args: unknown[] }): void {
  db.prepare(q.sql).run(...(q.args as never[]));
}

// Helper: inserta un perfil con defaults razonables (override por campo).
// ⚠ Para los campos NULLABLES (breed_id/tag/sex/birth/deleted_at) distinguimos "no provisto" (usa default)
// de "provisto como null" (usa null): NO se puede usar `?? default` porque `null ?? default` devolvería el
// default y pisaría un null EXPLÍCITO del test (justo lo que estos tests quieren ejercer). `pick` mira si la
// clave está presente en el objeto.
function insProfile(
  db: DatabaseSync,
  p: Partial<{
    id: string;
    establishment_id: string;
    rodeo_id: string;
    status: string;
    breed_id: string | null;
    tag: string | null;
    sex: string | null;
    birth: string | null;
    deleted_at: string | null;
  }>,
): void {
  const pick = <K extends keyof typeof p>(key: K, dflt: (typeof p)[K]): (typeof p)[K] =>
    key in p ? p[key] : dflt;
  db.prepare(
    'INSERT INTO animal_profiles (id, establishment_id, rodeo_id, status, breed_id, ' +
      'animal_tag_electronic, animal_sex, animal_birth_date, deleted_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    pick('id', 'p1') as string,
    pick('establishment_id', 'est-1') as string,
    pick('rodeo_id', 'rod-1') as string,
    pick('status', 'active') as string,
    pick('breed_id', 'breed-AA') as string | null,
    pick('tag', '032010000000001') as string | null,
    pick('sex', 'male') as string | null,
    pick('birth', '2025-08-10') as string | null,
    pick('deleted_at', null) as string | null,
  );
}

function seedBreed(db: DatabaseSync): void {
  db.prepare('INSERT INTO breed_catalog (id, senasa_code, name) VALUES (?,?,?)').run('breed-AA', 'AA', 'Aberdeen Angus');
  db.prepare('INSERT INTO breed_catalog (id, senasa_code, name) VALUES (?,?,?)').run('breed-H', 'H', 'Hereford');
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// T11 — buildPendingSigsaAnimalsQuery: construcción del SQL
// ════════════════════════════════════════════════════════════════════════════════════════════

test('buildPendingSigsaAnimalsQuery: NO referencia la tabla `animals` (identidad denormalizada b1/0079)', () => {
  const q = buildPendingSigsaAnimalsQuery('est-1');
  // CRÍTICO (reconciliación offline del leader): la tabla global animals NO está en el SQLite local → la
  // query NO debe JOINearla ni FROMearla. La identidad sale de animal_profiles.animal_*.
  assert.doesNotMatch(q.sql, /\bFROM animals\b/);
  assert.doesNotMatch(q.sql, /\bJOIN animals\b/);
  // La identidad viene de las columnas denormalizadas de animal_profiles.
  assert.match(q.sql, /ap\.animal_tag_electronic/);
  assert.match(q.sql, /ap\.animal_sex/);
  assert.match(q.sql, /ap\.animal_birth_date/);
  assert.match(q.sql, /FROM animal_profiles ap/);
});

test('buildPendingSigsaAnimalsQuery: filtra NO declarados vía LEFT JOIN sigsa_declarations + sd.id IS NULL', () => {
  const q = buildPendingSigsaAnimalsQuery('est-1');
  assert.match(q.sql, /LEFT JOIN sigsa_declarations sd/);
  // el JOIN matchea por animal_profile_id Y establishment_id (la declaración es por (establecimiento, animal))
  assert.match(q.sql, /sd\.animal_profile_id = ap\.id AND sd\.establishment_id = ap\.establishment_id/);
  // "pendiente" = sin fila en sigsa_declarations
  assert.match(q.sql, /sd\.id IS NULL/);
  // LEFT JOIN al catálogo (no INNER: un animal sin breed_id igual aparece, queda incompleto en el validador)
  assert.match(q.sql, /LEFT JOIN breed_catalog bc/);
});

test('buildPendingSigsaAnimalsQuery: filtros de dominio base (tag NOT NULL, status active, deleted_at) + arg establishment', () => {
  const q = buildPendingSigsaAnimalsQuery('est-9');
  assert.match(q.sql, /ap\.establishment_id = \?/);
  assert.match(q.sql, /ap\.animal_tag_electronic IS NOT NULL/);
  assert.match(q.sql, /ap\.status = 'active'/);
  assert.match(q.sql, /ap\.deleted_at IS NULL/);
  // sin filtros opcionales → un solo arg (el establishment), sin placeholders huérfanos
  assert.deepEqual(q.args, ['est-9']);
  assert.equal((q.sql.match(/\?/g) ?? []).length, 1);
  // NO re-scopea por has_role_in (lo hizo la stream)
  assert.doesNotMatch(q.sql, /has_role_in/);
});

test('buildPendingSigsaAnimalsQuery: filtros opcionales rodeo + rango de fecha se agregan con sus placeholders/args', () => {
  const q = buildPendingSigsaAnimalsQuery('est-1', {
    rodeoId: 'rod-7',
    dateFrom: '2025-01-01',
    dateTo: '2025-12-31',
  });
  assert.match(q.sql, /AND ap\.rodeo_id = \?/);
  assert.match(q.sql, /AND ap\.animal_birth_date >= \?/);
  assert.match(q.sql, /AND ap\.animal_birth_date <= \?/);
  // orden de args: establishment, rodeo, dateFrom, dateTo
  assert.deepEqual(q.args, ['est-1', 'rod-7', '2025-01-01', '2025-12-31']);
});

test('buildPendingSigsaAnimalsQuery: filtros opcionales ausentes/null NO agregan placeholders', () => {
  const q = buildPendingSigsaAnimalsQuery('est-1', { rodeoId: null, dateFrom: undefined, dateTo: null });
  assert.doesNotMatch(q.sql, /ap\.rodeo_id = \?/);
  assert.doesNotMatch(q.sql, /animal_birth_date >=/);
  assert.doesNotMatch(q.sql, /animal_birth_date <=/);
  assert.deepEqual(q.args, ['est-1']);
});

// ── COMPORTAMIENTO contra node:sqlite (tablas reales) ─────────────────────────────────────────

test('buildPendingSigsaAnimalsQuery (comportamiento): excluye DECLARADOS y trae el senasa_code por el JOIN (T11 test a)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'p-pend', tag: '032010000000001', breed_id: 'breed-AA' });
  insProfile(db, { id: 'p-decl', tag: '032010000000002', breed_id: 'breed-H' });
  // p-decl YA tiene una declaración → no debe aparecer.
  db.prepare('INSERT INTO sigsa_declarations (id, establishment_id, animal_profile_id, export_log_id) VALUES (?,?,?,?)')
    .run('d1', 'est-1', 'p-decl', 'log-1');

  const rows = all<{ animal_profile_id: string; senasa_code: string | null }>(
    db,
    buildPendingSigsaAnimalsQuery('est-1'),
  );
  db.close();
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['p-pend']);
  assert.equal(rows[0].senasa_code, 'AA', 'resuelve el código del catálogo por el LEFT JOIN');
});

test('buildPendingSigsaAnimalsQuery (comportamiento): una declaración de OTRO establecimiento NO oculta al animal (JOIN por est_id)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'p1', establishment_id: 'est-1', tag: '032010000000001' });
  // declaración del MISMO animal_profile_id pero en OTRO establishment → el JOIN (que matchea est_id) NO la
  // toma → el animal sigue pendiente en est-1. (Defensa anti-cruce; la UNIQUE real es por (est, animal).)
  db.prepare('INSERT INTO sigsa_declarations (id, establishment_id, animal_profile_id, export_log_id) VALUES (?,?,?,?)')
    .run('d1', 'est-OTRO', 'p1', null);
  const rows = all<{ animal_profile_id: string }>(db, buildPendingSigsaAnimalsQuery('est-1'));
  db.close();
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['p1']);
});

test('buildPendingSigsaAnimalsQuery (comportamiento): excluye tag NULL / no-activos / soft-deleted / otro campo (T11 tests b,e)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'ok', tag: '032010000000001' }); // pendiente OK
  insProfile(db, { id: 'no-tag', tag: null }); // sin caravana → fuera (test b)
  insProfile(db, { id: 'sold', tag: '032010000000003', status: 'sold' }); // no activo → fuera (test e)
  insProfile(db, { id: 'deleted', tag: '032010000000004', deleted_at: '2026-01-01' }); // soft-deleted → fuera
  insProfile(db, { id: 'other', tag: '032010000000005', establishment_id: 'est-2' }); // otro campo → fuera
  const rows = all<{ animal_profile_id: string }>(db, buildPendingSigsaAnimalsQuery('est-1'));
  db.close();
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['ok']);
});

test('buildPendingSigsaAnimalsQuery (comportamiento): filtro por rodeo_id (T11 test c)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'a', rodeo_id: 'rod-A', tag: '032010000000001' });
  insProfile(db, { id: 'b', rodeo_id: 'rod-B', tag: '032010000000002' });
  const rows = all<{ animal_profile_id: string }>(
    db,
    buildPendingSigsaAnimalsQuery('est-1', { rodeoId: 'rod-A' }),
  );
  db.close();
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['a']);
});

test('buildPendingSigsaAnimalsQuery (comportamiento): filtro por rango de fecha de nacimiento (T11 test d)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'old', birth: '2024-06-01', tag: '032010000000001' });
  insProfile(db, { id: 'in', birth: '2025-08-15', tag: '032010000000002' });
  insProfile(db, { id: 'new', birth: '2026-02-01', tag: '032010000000003' });
  const rows = all<{ animal_profile_id: string }>(
    db,
    buildPendingSigsaAnimalsQuery('est-1', { dateFrom: '2025-01-01', dateTo: '2025-12-31' }),
  );
  db.close();
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['in']);
});

test('buildPendingSigsaAnimalsQuery (comportamiento): un animal sin breed_id aparece con senasa_code NULL (queda incompleto en el validador)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'sin-raza', breed_id: null, tag: '032010000000001' });
  const rows = all<{ animal_profile_id: string; breed_id: string | null; senasa_code: string | null }>(
    db,
    buildPendingSigsaAnimalsQuery('est-1'),
  );
  db.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].breed_id, null);
  assert.equal(rows[0].senasa_code, null);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// T11 — buildExportLogInsert + buildSigsaDeclarationInsert: NO mandan generated_by/declared_by
// ════════════════════════════════════════════════════════════════════════════════════════════

test('buildExportLogInsert: 1 fila, columnas correctas, SIN generated_by (lo fuerza el trigger 0112 HIGH-1)', () => {
  const q = buildExportLogInsert('log-1', 'est-1', {
    animalCount: 3,
    fileName: 'sigsa-campo-2026-06-25.txt',
    fileContent: 'AAA;BBB;CCC',
    rodeoFilterId: 'rod-1',
    dateFrom: '2025-01-01',
    dateTo: '2025-12-31',
  });
  // CRÍTICO (autorrevisión): generated_by NO está en la lista de columnas (el trigger lo pisa = auth.uid()).
  assert.doesNotMatch(q.sql, /generated_by/);
  // tampoco generated_at (default now() server-side)
  assert.doesNotMatch(q.sql, /generated_at/);
  assert.match(q.sql, /INSERT INTO export_log/);
  assert.match(q.sql, /\(id, establishment_id, animal_count, file_name, file_content, rodeo_filter_id, date_from, date_to\)/);
  assert.deepEqual(q.args, ['log-1', 'est-1', 3, 'sigsa-campo-2026-06-25.txt', 'AAA;BBB;CCC', 'rod-1', '2025-01-01', '2025-12-31']);
});

test('buildExportLogInsert (comportamiento): inserta exactamente 1 fila con el conteo y el contenido', () => {
  const db = freshDb();
  run(db, buildExportLogInsert('log-1', 'est-1', {
    animalCount: 2,
    fileName: 'f.txt',
    fileContent: 'X;Y',
    rodeoFilterId: null,
    dateFrom: null,
    dateTo: null,
  }));
  const rows = all<{ id: string; animal_count: number; file_content: string; generated_by: string | null }>(
    db,
    { sql: 'SELECT id, animal_count, file_content, generated_by FROM export_log', args: [] },
  );
  db.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].animal_count, 2);
  assert.equal(rows[0].file_content, 'X;Y');
  assert.equal(rows[0].generated_by, null, 'generated_by NO se manda → NULL local; el trigger lo setea al subir');
});

test('buildSigsaDeclarationInsert: columnas correctas, SIN declared_by (lo fuerza el trigger 0111 HIGH-1)', () => {
  const q = buildSigsaDeclarationInsert('dec-1', 'est-1', 'prof-1', 'log-1');
  assert.doesNotMatch(q.sql, /declared_by/);
  assert.doesNotMatch(q.sql, /declared_at/); // default now()
  assert.match(q.sql, /INSERT INTO sigsa_declarations/);
  assert.match(q.sql, /\(id, establishment_id, animal_profile_id, export_log_id\)/);
  assert.deepEqual(q.args, ['dec-1', 'est-1', 'prof-1', 'log-1']);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// T19 — marca manual: buildSigsaDeclarationInsert con export_log_id NULL
// ════════════════════════════════════════════════════════════════════════════════════════════

test('buildSigsaDeclarationInsert: export_log_id NULL = marca manual ("ya declarado por otro medio") — T19 test b', () => {
  const q = buildSigsaDeclarationInsert('dec-m', 'est-1', 'prof-9', null);
  // el último arg (export_log_id) es null → distingue la marca manual del export con archivo RAFAQ.
  assert.deepEqual(q.args, ['dec-m', 'est-1', 'prof-9', null]);
});

test('marca manual (comportamiento): tras insertar una declaración SIN export_log_id, el animal DESAPARECE de pendientes (T19 test a)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'p-marca', tag: '032010000000001' });
  // antes: pendiente.
  let rows = all<{ animal_profile_id: string }>(db, buildPendingSigsaAnimalsQuery('est-1'));
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['p-marca']);
  // marca manual: declaración con export_log_id NULL.
  run(db, buildSigsaDeclarationInsert('dec-m', 'est-1', 'p-marca', null));
  // después: ya no es pendiente (el LEFT JOIN sigsa_declarations + sd.id IS NULL lo excluye).
  rows = all<{ animal_profile_id: string }>(db, buildPendingSigsaAnimalsQuery('est-1'));
  db.close();
  assert.deepEqual(rows, []);
  // y la fila tiene export_log_id NULL (marca manual, no export con archivo).
});

test('marca manual: la fila tiene export_log_id NULL (distingue de export con archivo) — T19 test b', () => {
  const db = freshDb();
  run(db, buildSigsaDeclarationInsert('dec-m', 'est-1', 'prof-9', null));
  const row = all<{ export_log_id: string | null }>(db, {
    sql: 'SELECT export_log_id FROM sigsa_declarations WHERE id = ?',
    args: ['dec-m'],
  })[0];
  db.close();
  assert.equal(row.export_log_id, null);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// T20 — re-descarga: buildExportLogContentQuery es READ-ONLY (no inserta declaraciones)
// ════════════════════════════════════════════════════════════════════════════════════════════

test('buildExportLogContentQuery: SELECT de file_content/file_name por id, sin escribir (T20 test b)', () => {
  const q = buildExportLogContentQuery('log-1');
  // es una LECTURA pura: nada de INSERT/UPDATE/DELETE → re-descargar no crea declaraciones.
  assert.match(q.sql, /^SELECT /);
  assert.doesNotMatch(q.sql, /INSERT|UPDATE|DELETE/i);
  assert.match(q.sql, /file_content/);
  assert.match(q.sql, /FROM export_log WHERE id = \? LIMIT 1/);
  assert.deepEqual(q.args, ['log-1']);
});

test('re-descarga (comportamiento): lee el MISMO file_content del export original (T20 test a)', () => {
  const db = freshDb();
  run(db, buildExportLogInsert('log-1', 'est-1', {
    animalCount: 2,
    fileName: 'sigsa-x.txt',
    fileContent: '032010000000001-M-AA-08/2025;032010000000002-H-H-09/2025',
    rodeoFilterId: null,
    dateFrom: null,
    dateTo: null,
  }));
  const row = all<{ file_name: string; file_content: string }>(db, buildExportLogContentQuery('log-1'))[0];
  db.close();
  assert.equal(row.file_name, 'sigsa-x.txt');
  assert.equal(row.file_content, '032010000000001-M-AA-08/2025;032010000000002-H-H-09/2025');
});

test('buildExportLogHistoryQuery: lista por establishment, orden generated_at DESC, SIN file_content (es pesado)', () => {
  const q = buildExportLogHistoryQuery('est-1');
  assert.match(q.sql, /FROM export_log WHERE establishment_id = \?/);
  assert.match(q.sql, /ORDER BY generated_at DESC/);
  // el historial NO trae file_content (la re-descarga lo lee aparte por id)
  assert.doesNotMatch(q.sql, /file_content/);
  assert.deepEqual(q.args, ['est-1']);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// T12 — lógica del hook (a través de las funciones PURAS que usa): exportableCount + alineamiento
// ════════════════════════════════════════════════════════════════════════════════════════════

// El hook deriva exportableCount = validateForExport(pendingAnimals).exportable.length. Con 0 exportables,
// la pantalla deshabilita el botón y generateExport corta sin escribir. Probamos el invariante PURO.
test('exportableCount=0 cuando todos los pendientes están incompletos (deshabilita el botón) — T12 test a', () => {
  const pend: PendingAnimalInfo[] = [
    { animalProfileId: 'a', rfid: null, sex: 'male', birthDate: '2025-08-01', breedId: 'b', breedCode: 'AA' }, // missing_rfid
    { animalProfileId: 'b', rfid: '032010000000001', sex: 'female', birthDate: null, breedId: 'b', breedCode: 'AA' }, // missing_birth_date
    { animalProfileId: 'c', rfid: '032010000000002', sex: 'male', birthDate: '2025-08-01', breedId: null, breedCode: null }, // missing_breed
  ];
  const v = validateForExport(pend);
  assert.equal(v.exportable.length, 0, 'ningún exportable → el botón se deshabilita');
  assert.equal(v.incomplete.length, 3);
});

// generateExport arma los profileIds de los exportables como "los pendientes cuyo id NO está en incomplete",
// en orden. persistDeclarations los usa 1:1 con los records. Probamos que ese alineamiento es correcto:
// la cantidad y el orden de profileIds coinciden con los records exportables.
test('alineamiento profileIds ↔ records exportables (lo que persistDeclarations consume) — T12', () => {
  const pend: PendingAnimalInfo[] = [
    { animalProfileId: 'p-ok-1', rfid: '032010000000001', sex: 'male', birthDate: '2025-08-01', breedId: 'b', breedCode: 'AA' },
    { animalProfileId: 'p-bad', rfid: 'XX', sex: 'female', birthDate: '2025-08-02', breedId: 'b', breedCode: 'H' }, // invalid_rfid
    { animalProfileId: 'p-ok-2', rfid: '032010000000003', sex: 'female', birthDate: '2025-09-01', breedId: 'b', breedCode: 'H' },
  ];
  const v = validateForExport(pend);
  // reproducimos el cálculo del hook:
  const incompleteIds = new Set(v.incomplete.map((i) => i.animalProfileId));
  const exportableProfileIds = pend
    .filter((a) => a != null && !incompleteIds.has(a.animalProfileId))
    .map((a) => a.animalProfileId);

  // 2 exportables, en orden, y la misma cantidad que records.
  assert.deepEqual(exportableProfileIds, ['p-ok-1', 'p-ok-2']);
  assert.equal(exportableProfileIds.length, v.exportable.length);
  // y los records exportables corresponden a esos RFIDs, en el mismo orden (alineamiento 1:1).
  assert.deepEqual(v.exportable.map((r) => r.rfid), ['032010000000001', '032010000000003']);
});

// Cierre del ciclo (semántico): tras un export (1 export_log + N declaraciones CON export_log_id), los N
// animales DESAPARECEN de pendientes. Reproduce lo que persistDeclarations + refresh hacen, con SQL real.
test('export completo (comportamiento): tras persistir export_log + N declaraciones, los exportados salen de pendientes (T11 test f)', () => {
  const db = freshDb();
  seedBreed(db);
  insProfile(db, { id: 'p1', tag: '032010000000001', breed_id: 'breed-AA' });
  insProfile(db, { id: 'p2', tag: '032010000000002', breed_id: 'breed-H' });
  insProfile(db, { id: 'p3', tag: '032010000000003', breed_id: 'breed-AA' });
  // export de p1+p2 (p3 queda pendiente): 1 export_log + 2 declaraciones ligadas a él.
  run(db, buildExportLogInsert('log-1', 'est-1', {
    animalCount: 2, fileName: 'f.txt', fileContent: 'A;B', rodeoFilterId: null, dateFrom: null, dateTo: null,
  }));
  run(db, buildSigsaDeclarationInsert('d1', 'est-1', 'p1', 'log-1'));
  run(db, buildSigsaDeclarationInsert('d2', 'est-1', 'p2', 'log-1'));
  const rows = all<{ animal_profile_id: string }>(db, buildPendingSigsaAnimalsQuery('est-1'));
  // las declaraciones tienen export_log_id (export con archivo, no marca manual).
  const decs = all<{ export_log_id: string | null }>(db, {
    sql: 'SELECT export_log_id FROM sigsa_declarations ORDER BY id', args: [],
  });
  db.close();
  assert.deepEqual(rows.map((r) => r.animal_profile_id), ['p3'], 'solo p3 sigue pendiente');
  assert.deepEqual(decs.map((d) => d.export_log_id), ['log-1', 'log-1'], 'export con archivo → export_log_id no NULL');
});
