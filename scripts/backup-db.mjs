#!/usr/bin/env node
// scripts/backup-db.mjs — pg_dump del POOLER de PROD → `.sql.gz`, comprimido + con timestamp
// (spec 16 Run B, B4 / R5.7/R5.8/R5.10/R5.11/R5.13).
//
// Uso:  node scripts/backup-db.mjs --env prod [--out-dir <dir>]
//   - Output DEFAULT fuera del working tree: ~/.mitropero-backups/mitropero-prod-<ISO>.sql.gz (H1/R5.10).
//     La GitHub Action pasa --out-dir "$RUNNER_TEMP" (design §7).
//   - Conn string por env (SUPABASE_DB_URL_PROD) → a pg_dump por VARIABLES libpq, NUNCA por argv (L2/R5.11).
//   - Aborta SIN crear archivo si falta la conn string (R5.8).
//
// GUARDA (destino-aware, fail-closed): backup-db SIEMPRE apunta a PROD (lee SUPABASE_DB_URL_PROD y
// exfiltra PII de PROD) → exige MITROPERO_CONFIRM_PROD=1 SIEMPRE, con o sin --env (as-built: más
// estricto que R5.2, alineado a M5/R5.12). La Action lo setea; un run local exige exportarlo a mano.
// El nombre PRE-rebrand (RAFAQ_CONFIRM_PROD) se sigue aceptando — el criterio vive en UN solo lugar
// (`prodConfirmed` en lib/env-target.mjs), no duplicado acá: el workflow y el script tienen que aceptar
// exactamente lo mismo o el backup nocturno se corta (lo ata `lib/backup-ci-consistency.test.mjs`).
//
// ⚠️ Lee PROD (read-only). El artifact trae PII: se cifra (gpg) en la Action ANTES de subirlo (M3/R8.6).

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseEnvFlag, prodConfirmedVia, legacyConfirmNotice, CONFIRM_PROD_ENV } from './lib/env-target.mjs';
import { buildBackupPlan, safeSummary } from './lib/backup-cmd.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

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

// --out-dir (opcional).
function flagValue(name) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name) return argv[i + 1];
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
  }
  return undefined;
}
const outDir = flagValue('--out-dir');
const envFlag = parseEnvFlag(argv);
if (envFlag !== undefined && envFlag !== 'dev' && envFlag !== 'prod') {
  console.error(`--env inválido: "${envFlag}". Valores válidos: dev | prod.`);
  process.exit(2);
}

// GUARDA destino-aware: backup SIEMPRE es PROD → exige confirmación (fail-closed, R5.2/R5.12).
const confirmedVia = prodConfirmedVia(process.env);
if (confirmedVia === null) {
  console.error(
    `ABORTADO: backup-db apunta a PROD (SUPABASE_DB_URL_PROD) y exfiltra PII. Exportá ${CONFIRM_PROD_ENV}=1 para confirmar.`,
  );
  process.exit(2);
}
const notice = legacyConfirmNotice(confirmedVia);
if (notice) console.error(notice); // a stderr: no contamina el stdout del script

// Plan (throws si falta la conn string → aborta ANTES de crear archivo, R5.8). NUNCA loguear la conn string.
let plan;
try {
  plan = buildBackupPlan({ env: process.env, homedir: homedir(), outDir });
} catch (err) {
  console.error(err.message); // el mensaje NO incluye la conn string
  process.exit(2);
}

mkdirSync(plan.dir, { recursive: true });
console.log(safeSummary(plan)); // log SEGURO: host/db/out, sin password ni conn string (R5.13)

const partialPath = `${plan.outPath}.partial`;

// pg_dump → gzip → archivo parcial → rename al final (R5.8: nunca dejar un final vacío/parcial).
const dump = spawn('pg_dump', plan.pgDumpArgs, {
  env: { ...process.env, ...plan.pgEnv }, // conn por libpq env vars, NO por argv (L2/R5.11)
  stdio: ['ignore', 'pipe', 'inherit'],
});

const gzip = createGzip({ level: 9 });
const out = createWriteStream(partialPath);
let failed = false;
let writeFinished = false;
let dumpCode = null;
let renamed = false;

function abort(msg, code = 1) {
  if (failed) return;
  failed = true;
  console.error(msg);
  try { rmSync(partialPath, { force: true }); } catch { /* best-effort cleanup */ }
  process.exitCode = code;
}

// Finaliza SOLO cuando el write terminó de flushear Y pg_dump salió 0 (evita la race de que 'finish'
// del stream dispare antes/después de 'close' del proceso). Rename atómico del parcial al final (R5.8).
function maybeFinalize() {
  if (failed || renamed || !writeFinished || dumpCode !== 0) return;
  renamed = true;
  try {
    renameSync(partialPath, plan.outPath);
  } catch (err) {
    abort(`ERROR renombrando el backup final: ${err.message}`);
    return;
  }
  console.log(`OK: backup generado → ${plan.outPath}`);
}

dump.on('error', (err) => abort(`ERROR: no se pudo ejecutar pg_dump (¿postgresql-client instalado?): ${err.message}`, 127));
dump.stdout.pipe(gzip).pipe(out);
gzip.on('error', (err) => abort(`ERROR gzip: ${err.message}`));
out.on('error', (err) => abort(`ERROR escribiendo el backup: ${err.message}`));
out.on('finish', () => { writeFinished = true; maybeFinalize(); });

dump.on('close', (code) => {
  dumpCode = code;
  if (code !== 0) {
    abort(`ERROR: pg_dump salió con código ${code}. No se genera backup (fail-fast, R8.5).`, code || 1);
    return;
  }
  maybeFinalize();
});
