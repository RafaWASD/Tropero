#!/usr/bin/env node
// scripts/check.mjs — validación del harness RAFAQ.
// Reemplaza init.ps1 (PowerShell bloqueado por Cylance Script Control).
// Uso: node scripts/check.mjs (desde cualquier directorio del repo)

import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// El script está en <repo>/scripts/check.mjs. La raíz del repo es un nivel
// arriba. Hacemos chdir para que todas las rutas relativas (existsSync,
// readFileSync, execSync con `cd app && ...`) funcionen sin importar desde
// dónde se invocó el script.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
process.chdir(repoRoot);

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};
const ok = (m) => console.log(`${C.green}[OK]${C.reset}    ${m}`);
const warn = (m) => console.log(`${C.yellow}[WARN]${C.reset}  ${m}`);
const fail = (m) => console.log(`${C.red}[FAIL]${C.reset}  ${m}`);

let exitCode = 0;
// --fast (lo usa el hook Stop): corre solo chequeos locales y rápidos
// (estructura + feature_list + higiene + lint anti-hardcode) y OMITE la suite de
// tests (typecheck del cliente + RLS contra DB remota). Evita que el hook por-turno
// se cuelgue en timeouts de red o falle sin conectividad. El check COMPLETO (con
// tests) se corre manual al iniciar sesión y antes de commitear código.
const FAST = process.argv.includes('--fast');

console.log('-- 1. Archivos base del harness ----------------------');
const base = [
  'AGENTS.md',
  'CLAUDE.md',
  'CHECKPOINTS.md',
  'feature_list.json',
  'progress/current.md',
  'progress/history.md',
  'progress/plan.md',
  'docs/architecture.md',
  'docs/conventions.md',
  'docs/verification.md',
  'docs/specs.md',
  '.claude/agents/leader.md',
  '.claude/agents/spec_author.md',
  '.claude/agents/implementer.md',
  '.claude/agents/reviewer.md',
  '.claude/agents/security_analyzer.md',
];
for (const f of base) {
  if (existsSync(f)) ok(`Existe ${f}`);
  else {
    fail(`Falta ${f}`);
    exitCode = 1;
  }
}

console.log('\n-- 2. Validando feature_list.json y specs ------------');
const validStatus = ['pending', 'context_ready', 'spec_ready', 'in_progress', 'done', 'blocked', 'deferred'];
const requiresSpec = ['spec_ready', 'in_progress', 'done'];
// Gate de refinamiento (ADR-022): una feature en context_ready debe tener
// context.md. Aplica hacia adelante — NO se retro-exige a spec_ready+
// (grandfathering de 01/02/09, aprobadas antes del gate).
const requiresContext = ['context_ready'];

try {
  const data = JSON.parse(readFileSync('feature_list.json', 'utf8'));
  if (!Array.isArray(data.features)) throw new Error('features no es array');

  const inProgress = data.features.filter((f) => f.status === 'in_progress');
  if (inProgress.length > 1) {
    fail(`${inProgress.length} features en in_progress (máximo 1)`);
    exitCode = 1;
  }

  let specErrors = 0;
  for (const f of data.features) {
    if (!validStatus.includes(f.status)) {
      fail(`Feature ${f.id} (${f.name}): status inválido "${f.status}"`);
      exitCode = 1;
    }
    if (f.sdd === true && requiresContext.includes(f.status)) {
      const p = join('specs', 'active', f.name, 'context.md');
      if (!existsSync(p)) {
        fail(`Feature ${f.id} (${f.name}) en ${f.status}: falta ${p}`);
        specErrors++;
        exitCode = 1;
      }
    }
    if (f.sdd === true && requiresSpec.includes(f.status)) {
      const dir = join('specs', 'active', f.name);
      for (const n of ['requirements.md', 'design.md', 'tasks.md']) {
        const p = join(dir, n);
        if (!existsSync(p)) {
          fail(`Feature ${f.id} (${f.name}) en ${f.status}: falta ${p}`);
          specErrors++;
          exitCode = 1;
        }
      }
    }
  }
  if (specErrors === 0) {
    ok(`feature_list.json válido (${data.features.length} features)`);
    ok('context.md presente en context_ready; specs presentes en spec_ready+');
  }
} catch (e) {
  fail(`feature_list.json inválido: ${e.message}`);
  exitCode = 1;
}

console.log('\n-- 2b. Higiene de progress/current.md ----------------');
try {
  const cur = readFileSync('progress/current.md', 'utf8');
  const lines = cur.split('\n').length;
  const sessionBlocks = (cur.match(/^##\s+(Bitácora|Sesión)/gim) || []).length;
  if (sessionBlocks >= 2 || lines > 150) {
    warn(
      `current.md parece inflado (${sessionBlocks} bloque(s) de sesión, ${lines} líneas). ` +
        `Al cerrar sesión, mové el resumen a history.md y dejá current.md limpio (AGENTS.md §6).`
    );
  } else {
    ok(`current.md en tamaño razonable (${lines} líneas)`);
  }
} catch (e) {
  warn(`No pude leer progress/current.md: ${e.message}`);
}

console.log('\n-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------');
// Guardrail de diseño: las pantallas/componentes no hardcodean color/spacing, todo
// referencia un token del design system (app/tamagui.config.ts). Falla el check ante
// cualquier violación. Script dedicado: scripts/check-hardcode.mjs.
try {
  execSync('node scripts/check-hardcode.mjs', { stdio: 'inherit' });
} catch (e) {
  fail(`Lint anti-hardcode rojo (exit ${e.status})`);
  exitCode = 1;
}

console.log('\n-- 3. Ejecutando tests -------------------------------');
if (FAST) {
  warn('Modo --fast (hook Stop): se OMITE la suite de tests (typecheck del cliente + RLS remota).');
  warn('Corré `node scripts/check.mjs` COMPLETO al iniciar sesión y antes de commitear código.');
} else {
  let testCommand = '';
  if (existsSync('.harness/config.json')) {
    try {
      const cfg = JSON.parse(readFileSync('.harness/config.json', 'utf8'));
      testCommand = (cfg.testCommand || '').trim();
    } catch (e) {
      warn(`.harness/config.json ilegible: ${e.message}`);
    }
  }

  if (!testCommand) {
    warn('Bootstrap mode: sin testCommand configurado. Saltando tests.');
    warn('Cuando exista código, creá .harness/config.json con { "testCommand": "..." }');
  } else {
    console.log(`    > ${testCommand}`);
    try {
      execSync(testCommand, { stdio: 'inherit' });
      ok('Tests verdes');
    } catch (e) {
      fail(`Tests rojos (exit ${e.status})`);
      exitCode = 1;
    }
  }
}

console.log('\n-- 4. Resumen ----------------------------------------');
if (exitCode === 0) ok('Entorno listo. Podés trabajar.');
else fail('Entorno NO listo. Resolvé los errores antes de avanzar.');

process.exit(exitCode);
