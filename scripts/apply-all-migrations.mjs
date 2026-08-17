#!/usr/bin/env node
// scripts/apply-all-migrations.mjs — replay ORDENADO de las migraciones contra el ambiente target,
// con ledger idempotente `ops.applied_migrations` (spec 16 Run B, B3 / R5.4/R5.5/R5.6/R5.13/R6.1).
//
// Uso:
//   node scripts/apply-all-migrations.mjs [--env dev|prod] [--backfill]
//     - sin --env    → DEV (default; guarda destino-aware para prod, R5.2/R5.12).
//     - --backfill   → REGISTRA en el ledger las migraciones ausentes SIN ejecutar su SQL (R5.6).
//                      Sirve para poner DEV — ya al día — en el ledger sin re-aplicar nada.
//
// Flujo (design §4):
//   1. bootstrap `ops.applied_migrations` (CREATE SCHEMA/TABLE IF NOT EXISTS + REVOKE PUBLIC/anon/auth).
//   2. leer los filenames ya en el ledger.
//   3. planificar (orden por prefijo numérico; aplicar solo las AUSENTES — lógica pura ledger-plan.mjs).
//   4. por cada migración: (normal) ejecutar el SQL vía Management API → (siempre) registrar en el ledger.
//
// L4/R5.13: NUNCA loguea el header Authorization ni el SUPABASE_ACCESS_TOKEN (hereda el patrón de
// apply-migration-mgmt.mjs — solo se loguea el ref, que no es secreto, + un slice del body de respuesta).
//
// ⚠️ Escribe a la DB (bootstrap del ledger + replay). Deploy GATEADO: solo con OK de Raf.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget, ProdGuardError, legacyConfirmNotice, CONFIRM_PROD_ENV } from './lib/env-target.mjs';
import { planMigrations } from './lib/ledger-plan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const migrationsDir = resolve(repoRoot, 'supabase', 'migrations');

// Cargar .env.local de la raíz (mismo parser que run-tests.mjs).
const envLocalPath = resolve(repoRoot, '.env.local');
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m || m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const argv = process.argv.slice(2);
const backfill = argv.includes('--backfill');

let target;
try {
  target = resolveTarget(argv, process.env); // guarda destino-aware (R5.2/R5.12); NO expone el token
} catch (err) {
  if (err instanceof ProdGuardError) {
    console.error(`ABORTADO: ${err.message}\n  Exportá ${CONFIRM_PROD_ENV}=1 para confirmar el destino PROD.`);
  } else {
    console.error(err.message);
  }
  process.exit(2);
}

const confirmNotice = legacyConfirmNotice(target.confirmedVia);
if (confirmNotice) console.error(confirmNotice);

// --- Management API helper. NUNCA loguea el token (R5.13). -----------------------------------------
async function mgmtQuery(sql) {
  const res = await fetch(`${target.host}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ query: sql }), 'utf8'),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 600)}`); // body de respuesta, sin el token del request
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

const sqlEscape = (s) => String(s).replace(/'/g, "''");

// --- 1. Bootstrap del ledger (tool-owned, no numerada). -------------------------------------------
const BOOTSTRAP_SQL = `
CREATE SCHEMA IF NOT EXISTS ops;
CREATE TABLE IF NOT EXISTS ops.applied_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text
);
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC, anon, authenticated;
`;

console.log(`[apply-all] target ref ${target.ref} [${target.env}]${backfill ? ' (--backfill: registra sin ejecutar)' : ''}`);
console.log('[apply-all] bootstrap ops.applied_migrations...');
await mgmtQuery(BOOTSTRAP_SQL);

// --- 2. Leer el ledger. ---------------------------------------------------------------------------
const appliedRows = await mgmtQuery('SELECT filename FROM ops.applied_migrations;');
const applied = Array.isArray(appliedRows) ? appliedRows.map((r) => r.filename) : [];

// --- 3. Planificar. -------------------------------------------------------------------------------
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
const { toApply, toSkip } = planMigrations({ files, applied, backfill });

console.log(`[apply-all] ${files.length} migraciones en disco · ${toSkip.length} ya en el ledger · ${toApply.length} a procesar.`);
if (toApply.length === 0) {
  console.log('[apply-all] nada que hacer (ledger al día). ✅');
  process.exit(0);
}

// --- 4. Aplicar (o solo registrar en --backfill). -------------------------------------------------
for (const { filename, execute } of toApply) {
  const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  if (execute) {
    console.log(`[apply-all] aplicando ${filename} (${sql.length} chars)...`);
    await mgmtQuery(sql);
  } else {
    console.log(`[apply-all] backfill (sin ejecutar): ${filename}`);
  }
  await mgmtQuery(
    `INSERT INTO ops.applied_migrations (filename, checksum) VALUES ('${sqlEscape(filename)}', '${checksum}') ON CONFLICT (filename) DO NOTHING;`,
  );
}

console.log(`[apply-all] OK — ${toApply.length} migración(es) ${backfill ? 'registrada(s)' : 'aplicada(s)+registrada(s)'} en ${target.env}. ✅`);
