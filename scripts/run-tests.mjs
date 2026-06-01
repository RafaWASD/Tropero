#!/usr/bin/env node
// scripts/run-tests.mjs — orquestador de tests del repo.
//
// Corre, en orden:
//   1. Typecheck del cliente (app/) vía pnpm.cmd typecheck.
//   2. Suite RLS contra la base remota (supabase/tests/rls/run.cjs).
//
// El runner asume `node scripts/check.mjs` que ya hace chdir a repoRoot.
// Lo importa el harness desde .harness/config.json::testCommand.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
process.chdir(repoRoot);

// Carga .env.local (anon/service keys + project ref) en process.env.
const envLocalPath = resolve(repoRoot, '.env.local');
if (existsSync(envLocalPath)) {
  const text = readFileSync(envLocalPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

function run(label, cmd) {
  console.log(`\n>>> ${label}`);
  console.log(`    ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: repoRoot });
  console.log(`<<< ${label} OK`);
}

const pnpmCmd = platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

run('typecheck client', `cd app && ${pnpmCmd} typecheck`);

// Tests unitarios del CLIENTE (lógica pura: validación, mapeo de errores de auth,
// lockout). node:test con type-stripping nativo de Node 24 (sin Jest; mismo patrón
// que las suites backend). No tocan red ni RN: corren siempre, sin keys de Supabase.
// --disable-warning silencia el aviso MODULE_TYPELESS_PACKAGE_JSON (no hay
// "type":"module" en app/package.json; los .ts se reparsean como ESM, es benigno).
run(
  'client unit tests',
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test app/src/utils/validation.test.ts app/src/utils/auth-errors.test.ts app/src/utils/lockout.test.ts app/src/utils/establishment.test.ts app/src/utils/establishment-mapping.test.ts app/src/utils/invite.test.ts app/src/services/establishment-store.test.ts app/src/services/ble/parser-rs420.test.ts`,
);

// La suite RLS y la suite Edge necesitan keys de Supabase. Si no hay service_role,
// se saltean con un warning (para builds CI sin credenciales). Para el check
// local completo, exigimos las claves.
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  run('RLS suite', `node --test supabase/tests/rls/run.cjs`);
  run('Edge Functions suite', `node --test supabase/tests/edge/run.cjs`);
  run('Animal suite (spec 02)', `node --test supabase/tests/animal/run.cjs`);
  run('Maneuvers suite (spec 03)', `node --test supabase/tests/maneuvers/run.cjs`);
} else {
  console.log('\n>>> RLS + Edge + Animal + Maneuvers suites — SKIPPED (falta SUPABASE_SERVICE_ROLE_KEY en env)');
}

console.log('\nAll tests passed.');
