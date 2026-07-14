// Tests de scripts/lib/backup-cmd.mjs (spec 16 Run B, B4 / R5.7/R5.8/R5.10/R5.11/R5.13). node:test puro.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildBackupPlan, parseConnString, safeSummary, backupFilename, defaultBackupDir } from './backup-cmd.mjs';

const CONN = 'postgres://postgres.projref:s3cr3t-p4ss@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';
const HOME = '/home/runner';

test('B4(a) R5.8: sin SUPABASE_DB_URL_PROD → throw (el script aborta sin crear archivo)', () => {
  assert.throws(() => buildBackupPlan({ env: {}, homedir: HOME }), /Falta SUPABASE_DB_URL_PROD/);
  assert.throws(() => buildBackupPlan({ env: { SUPABASE_DB_URL_PROD: '   ' }, homedir: HOME }), /Falta SUPABASE_DB_URL_PROD/);
});

test('B4(b) R5.13: safeSummary NO incluye la password ni la conn string cruda', () => {
  const plan = buildBackupPlan({ env: { SUPABASE_DB_URL_PROD: CONN }, homedir: HOME });
  const s = safeSummary(plan);
  assert.ok(!s.includes('s3cr3t-p4ss'), 'la password NO debe aparecer en el log');
  assert.ok(!s.includes(CONN), 'la conn string cruda NO debe aparecer en el log');
  // sí incluye datos no secretos útiles para ops:
  assert.match(s, /host=aws-0-sa-east-1\.pooler\.supabase\.com/);
  assert.match(s, /db=postgres/);
});

test('B4(c) R5.11: la conn string / password NO va en pgDumpArgs (se pasa por env)', () => {
  const plan = buildBackupPlan({ env: { SUPABASE_DB_URL_PROD: CONN }, homedir: HOME });
  const argsJoined = plan.pgDumpArgs.join(' ');
  assert.ok(!argsJoined.includes('s3cr3t-p4ss'), 'la password NO debe estar en los args de pg_dump');
  assert.ok(!argsJoined.includes(CONN), 'la conn string NO debe estar en los args de pg_dump');
  assert.ok(!plan.pgDumpArgs.some((a) => a.startsWith('-d') || a.startsWith('--dbname')), 'sin -d/--dbname en argv');
  // la password SÍ va por env (libpq):
  assert.equal(plan.pgEnv.PGPASSWORD, 's3cr3t-p4ss');
  assert.equal(plan.pgEnv.PGHOST, 'aws-0-sa-east-1.pooler.supabase.com');
  assert.equal(plan.pgEnv.PGPORT, '6543');
  assert.equal(plan.pgEnv.PGUSER, 'postgres.projref');
  assert.equal(plan.pgEnv.PGDATABASE, 'postgres');
});

test('B4(d) R5.10: output default resuelve FUERA del repo (~/.rafaq-backups)', () => {
  const plan = buildBackupPlan({ env: { SUPABASE_DB_URL_PROD: CONN }, homedir: HOME });
  assert.ok(plan.outPath.startsWith(defaultBackupDir(HOME)), 'default va bajo ~/.rafaq-backups');
  const repoRoot = process.cwd();
  assert.ok(!plan.outPath.startsWith(repoRoot), 'el default NUNCA cae dentro del working tree');
});

test('R5.7: filename comprimido + con timestamp (rafaq-prod-<ISO>.sql.gz), sin `:` ni `.` en el stamp', () => {
  const now = new Date('2026-07-14T03:00:05.123Z');
  const name = backupFilename(now);
  assert.equal(name, 'rafaq-prod-2026-07-14T03-00-05-123Z.sql.gz');
  const plan = buildBackupPlan({ env: { SUPABASE_DB_URL_PROD: CONN }, homedir: HOME, now });
  assert.equal(path.basename(plan.outPath), name);
});

test('R5.10: --out-dir override respeta la ruta dada (para el $RUNNER_TEMP de la Action)', () => {
  const plan = buildBackupPlan({ env: { SUPABASE_DB_URL_PROD: CONN }, homedir: HOME, outDir: '/tmp/runner' });
  assert.equal(plan.dir, '/tmp/runner'); // el dir se respeta tal cual
  // el outPath queda bajo ese dir (separador según OS; comparamos con path.join para ser portable).
  assert.equal(path.dirname(plan.outPath), path.join('/tmp/runner'));
});

test('parseConnString: URI inválida → throw; puerto default pooler 6543 si falta', () => {
  assert.throws(() => parseConnString('not a uri'), /no es una URI válida/);
  const noPort = parseConnString('postgres://u:p@host/db');
  assert.equal(noPort.PGPORT, '6543');
  assert.equal(noPort.PGDATABASE, 'db');
});
