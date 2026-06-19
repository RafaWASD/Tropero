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
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test app/src/utils/validation.test.ts app/src/utils/auth-errors.test.ts app/src/utils/lockout.test.ts app/src/utils/establishment.test.ts app/src/utils/establishment-mapping.test.ts app/src/utils/invite.test.ts app/src/utils/account-result.test.ts app/src/utils/rodeo-template.test.ts app/src/utils/a11y.test.ts app/src/utils/animal-identifier.test.ts app/src/utils/animal-category.test.ts app/src/utils/animal-category-picker.test.ts app/src/utils/animal-category-fields.test.ts app/src/utils/animal-birth-year.test.ts app/src/utils/animal-age.test.ts app/src/utils/group-actions.test.ts app/src/utils/animal-form.test.ts app/src/utils/animal-input.test.ts app/src/utils/event-timeline.test.ts app/src/utils/event-input.test.ts app/src/utils/bulk-candidates.test.ts app/src/utils/bulk-selection.test.ts app/src/utils/bulk-idempotency.test.ts app/src/utils/bulk-operations-plan.test.ts app/src/utils/castration-copy.test.ts app/src/utils/cut-eligibility.test.ts app/src/services/cut-service-core.test.ts app/src/utils/selection-display.test.ts app/src/utils/vaccination-preview.test.ts app/src/utils/last-rodeo.test.ts app/src/utils/eid-format.test.ts app/src/utils/nav.test.ts app/src/utils/management-group.test.ts app/src/utils/onboarding.test.ts app/src/utils/env-resolve.test.ts app/src/services/establishment-store.test.ts app/src/services/exit-animal.test.ts app/src/services/transfer-animal.test.ts app/src/services/tag-lookup.test.ts app/src/services/powersync/platform-select.test.ts app/src/services/powersync/upload-classify.test.ts app/src/services/powersync/status-derive.test.ts app/src/services/powersync/online-guard.test.ts app/src/services/powersync/first-sync.test.ts app/src/services/powersync/schema.test.ts app/src/services/powersync/local-reads.test.ts app/src/services/powersync/maneuver-reads.test.ts app/src/services/powersync/upload.test.ts app/src/services/powersync/upload-rejections.test.ts app/src/utils/maneuver-gating.test.ts app/src/utils/maneuver-gating-load.test.ts app/src/utils/maneuver-config.test.ts app/src/utils/maneuver-wizard.test.ts app/src/utils/maniobra-identify.test.ts app/src/utils/maniobra-edge.test.ts app/src/utils/maniobra-listen-state.test.ts app/src/utils/maniobra-resume.test.ts app/src/utils/maneuver-step-kind.test.ts app/src/utils/maneuver-sequence.test.ts app/src/utils/maneuver-event-query.test.ts app/src/utils/maneuver-applicability.test.ts app/src/utils/condition-stepper.test.ts app/src/utils/hero-text-size.test.ts app/src/utils/teeth-options.test.ts app/src/utils/custom-value.test.ts app/src/utils/custom-field.test.ts app/src/utils/custom-render.test.ts app/src/services/ble/parser-rs420.test.ts app/src/services/ble/dedup.test.ts app/src/services/ble/contract.test.ts app/src/services/ble/feedback.test.ts app/src/services/ble/adapter-mock.test.ts app/src/services/ble/adapter-web-serial.test.ts app/src/services/ble/wiring.test.ts app/src/services/ble/offline-noread.test.ts app/src/utils/import/parse-csv.test.ts app/src/utils/import/parse-sigsa-txt.test.ts app/src/utils/import/breed-senasa.test.ts app/src/utils/import/column-mapping.test.ts app/src/utils/import/normalize-row.test.ts app/src/utils/import/validate-rows.test.ts app/src/utils/import/import-write.test.ts app/src/utils/import/parse-xlsx.test.ts app/src/utils/import/import-ui.test.ts app/src/services/sigsa/sigsa-txt-generator.test.ts app/src/services/sigsa/sigsa-validator.test.ts`,
);

// La suite RLS y la suite Edge necesitan keys de Supabase. Si no hay service_role,
// se saltean con un warning (para builds CI sin credenciales). Para el check
// local completo, exigimos las claves.
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
  run('RLS suite', `node --test supabase/tests/rls/run.cjs`);
  run('Edge Functions suite', `node --test supabase/tests/edge/run.cjs`);
  run('Animal suite (spec 02)', `node --test supabase/tests/animal/run.cjs`);
  run('Maneuvers suite (spec 03)', `node --test supabase/tests/maneuvers/run.cjs`);
  // spec 03 chunk M5 (datos/maniobras CUSTOM) — delta backend: RLS reabierta de field_definitions +
  // custom_measurements/custom_attributes + gating genérico fail-closed + validación de value por
  // ui_component + inmutabilidad + caps INPUT-1. ⚠️ DESCOMENTAR cuando el LEADER aplique 0093–0097 al
  // remoto (la suite corre contra la DB remota → fallaría antes del apply). Patrón de spec 12/14.
  run('Custom suite (spec 03 M5)', `node --test supabase/tests/custom/run.cjs`);
  // spec 14 (user_private) — enganchada por el leader tras aplicar la migración 0068 + redeploy
  // de invite_user/accept_invitation (deploy coordinado, 2026-06-04).
  run('User_private suite (spec 14)', `node --test supabase/tests/user_private/run.cjs`);
  // spec 12 (import masivo de rodeo) — backend: import_log RLS + RPC import_rodeo_bulk
  // (SECURITY DEFINER, authz cross-tenant). Enganchada por el leader tras el run de backend
  // (las migraciones 0073/0074 ya aplicadas al remoto vía Management API, 2026-06-06).
  run('Import suite (spec 12)', `node --test supabase/tests/import/run.cjs`);
  // spec 15 (no-bypass por device) — la frontera de AUTORIZACIÓN de las sync streams (T7.2 + T9.7):
  // por cada clase de stream, A no recibe la data de B, user_private es self-only, catálogos globales
  // llegan a todos, soft-deleted sale del sync set, y las tablas hijas denormalizadas (paso 2) no
  // cruzan tenant. Espejo de la RLS suite, pero sobre las streams (simulando el predicado contra
  // Postgres con el user_id de cada actor — design §7). Autocontenida (2 campos/usuarios dedicados).
  run('Sync streams no-bypass suite (spec 15)', `node --test supabase/tests/sync_streams/run.cjs`);
  // spec 10 (operaciones-rodeo) — Fase 1 backend delta: future_bull + denorm is_castrated con
  // write-through perfil->animals + propagación down con pre-filtro LIM-2 + recompute simétrico.
  // Migraciones 0084/0085/0086 ya aplicadas al remoto vía Management API (database/query).
  run('Operaciones-rodeo suite (spec 10 Fase 1)', `node --test supabase/tests/operaciones_rodeo/run.cjs`);
} else {
  console.log('\n>>> RLS + Edge + Animal + Maneuvers + user_private + Import + Sync-streams + Operaciones-rodeo suites — SKIPPED (falta SUPABASE_SERVICE_ROLE_KEY en env)');
}

console.log('\nAll tests passed.');
