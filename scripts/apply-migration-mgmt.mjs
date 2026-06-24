#!/usr/bin/env node
// scripts/apply-migration-mgmt.mjs — aplica un archivo .sql al proyecto Supabase REMOTO vía la
// Management API (database/query), usando SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN del
// .env.local de la RAÍZ. Fallback para cuando el MCP de Supabase tiene el token cacheado/viejo
// (ver memoria reference_check_red_rate_limit). Mismo endpoint que el adminQuery de las suites.
//
// Uso: node scripts/apply-migration-mgmt.mjs supabase/migrations/0106_xxx.sql
//
// ⚠️ Escribe a la DB compartida (beta). Solo correr con OK de deploy de Raf.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error('Falta SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN en .env.local');
  process.exit(2);
}
if (!file) {
  console.error('Uso: node scripts/apply-migration-mgmt.mjs <ruta-al-.sql>');
  process.exit(2);
}

const sql = readFileSync(resolve(repoRoot, file), 'utf8');
console.log(`Aplicando ${file} (${sql.length} chars) a project ${PROJECT_REF} vía Management API...`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
  body: Buffer.from(JSON.stringify({ query: sql }), 'utf8'),
});
const body = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body}`);
  process.exit(1);
}
console.log(`OK (HTTP ${res.status}). Respuesta: ${body.slice(0, 400)}`);
