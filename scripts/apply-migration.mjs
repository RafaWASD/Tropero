#!/usr/bin/env node
// scripts/apply-migration.mjs — aplica UN archivo de migración al proyecto Supabase remoto vía la
// Management API (POST /v1/projects/<ref>/database/query). Lo usa el leader para aplicar migraciones que
// el MCP (read-only) no puede correr. La migración debe traer su propio BEGIN/COMMIT.
//
// SEGURIDAD: carga `.env.local` INTERNAMENTE (mismo patrón que run-tests.mjs). El SUPABASE_ACCESS_TOKEN
// se lee del archivo a process.env y se usa en el header Authorization — NUNCA se imprime ni se loguea.
// Solo se imprime el status HTTP + el body de la respuesta (que no contiene el token).
//
// Uso: node scripts/apply-migration.mjs supabase/migrations/0076_xxx.sql

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Cargar .env.local en process.env (idéntico a run-tests.mjs). No se imprime ningún valor.
const envLocalPath = resolve(repoRoot, '.env.local');
if (existsSync(envLocalPath)) {
  const text = readFileSync(envLocalPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error('Falta SUPABASE_PROJECT_REF o SUPABASE_ACCESS_TOKEN en .env.local. No se aplica nada.');
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('Uso: node scripts/apply-migration.mjs <path-al-.sql>');
  process.exit(1);
}

const sql = readFileSync(resolve(repoRoot, file), 'utf8');
console.log(`Aplicando ${file} (${sql.length} chars) al proyecto ${ref}…`);

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  },
  // Body como bytes UTF-8 explícitos (PS/Node encoding gotcha con acentos/em-dash).
  body: Buffer.from(JSON.stringify({ query: sql }), 'utf8'),
});

const bodyText = await res.text();
console.log(`HTTP ${res.status} ${res.statusText}`);
console.log(bodyText.slice(0, 4000));
if (!res.ok) {
  console.error('FALLÓ la aplicación de la migración.');
  process.exit(1);
}
console.log('OK — migración aplicada.');
