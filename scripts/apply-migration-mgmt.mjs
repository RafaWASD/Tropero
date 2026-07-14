#!/usr/bin/env node
// scripts/apply-migration-mgmt.mjs — aplica un archivo .sql al proyecto Supabase REMOTO vía la
// Management API (database/query), usando el ref/token del ambiente resuelto (dev por default) del
// .env.local de la RAÍZ. Fallback para cuando el MCP de Supabase tiene el token cacheado/viejo
// (ver memoria reference_check_red_rate_limit). Mismo endpoint que el adminQuery de las suites.
//
// Uso: node scripts/apply-migration-mgmt.mjs [--env dev|prod] supabase/migrations/0106_xxx.sql
//   - sin --env → DEV (comportamiento IDÉNTICO al histórico, spec 16 R5.1/R5.3).
//   - --env prod → exige RAFAQ_CONFIRM_PROD=1 (guarda destino-aware, R5.2/R5.12).
//
// ⚠️ Escribe a la DB compartida (beta). Solo correr con OK de deploy de Raf.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget, positionalArgs, ProdGuardError } from './lib/env-target.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Cargar .env.local de la raíz (mismo parser que scripts/run-tests.mjs).
const envLocalPath = resolve(repoRoot, '.env.local');
if (existsSync(envLocalPath)) {
  for (const line of readFileSync(envLocalPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m || m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const argv = process.argv.slice(2);
const [file] = positionalArgs(argv);

if (!file) {
  console.error('Uso: node scripts/apply-migration-mgmt.mjs [--env dev|prod] <ruta-al-.sql>');
  process.exit(2);
}

let target;
try {
  target = resolveTarget(argv, process.env); // dev por default; guarda de prod destino-aware (R5.2/R5.12)
} catch (err) {
  // NUNCA loguea el token (R5.13): resolveTarget/ProdGuardError solo exponen el ref (no secreto).
  if (err instanceof ProdGuardError) {
    console.error(`ABORTADO: ${err.message}\n  Exportá RAFAQ_CONFIRM_PROD=1 para confirmar el destino PROD.`);
  } else {
    console.error(err.message);
  }
  process.exit(2);
}

const sql = readFileSync(resolve(repoRoot, file), 'utf8');
console.log(`Aplicando ${file} (${sql.length} chars) a project ${target.ref} [${target.env}] vía Management API...`);

const res = await fetch(`${target.host}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json; charset=utf-8' },
  body: Buffer.from(JSON.stringify({ query: sql }), 'utf8'),
});
const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body}`);
  process.exit(1);
}
console.log(`OK (HTTP ${res.status}). Respuesta: ${body.slice(0, 400)}`);
