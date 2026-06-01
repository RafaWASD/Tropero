// e2e/helpers/env.ts — carga de variables de entorno para la suite E2E.
//
// REUSA el patrón de supabase/tests/rls/run.cjs: las vars se cargan desde archivos
// `.env.local` (gitignored) hacia process.env, sin pisar lo que ya venga del entorno.
// La suite E2E corre en Node (Playwright), así que necesita:
//   - EXPO_PUBLIC_SUPABASE_URL  (URL del proyecto remoto)
//   - EXPO_PUBLIC_SUPABASE_ANON_KEY  (key pública; la usa el bundle web igual)
//   - SUPABASE_SERVICE_ROLE_KEY  (server-only: crea/borra usuarios de test, bypassea RLS)
//
// Orden de búsqueda de los .env.local (el primero que defina una var gana, y NUNCA
// pisamos una var ya presente en process.env):
//   1. <repoRoot>/.env.local      → tiene service_role + todo (como run.cjs).
//   2. <repoRoot>/app/.env.local  → tiene los EXPO_PUBLIC_* (copiado del árbol principal).
//
// repoRoot = dos niveles arriba de e2e/helpers (… /app/e2e/helpers → /app → /<repoRoot>).

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Playwright transpila los .ts a CJS, así que `__dirname` está disponible nativamente.
// (NO usar import.meta.url: rompe con "exports is not defined in ES module scope".)
// e2e/helpers → e2e → app → repoRoot
export const APP_ROOT = path.resolve(__dirname, '..', '..');
export const REPO_ROOT = path.resolve(APP_ROOT, '..');

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const envText = readFileSync(filePath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').trim();
    }
  }
}

let loaded = false;

/** Carga (idempotente) los .env.local del repo hacia process.env. */
export function loadEnv(): void {
  if (loaded) return;
  loadEnvFile(path.join(REPO_ROOT, '.env.local'));
  loadEnvFile(path.join(APP_ROOT, '.env.local'));
  loaded = true;
}

export type E2EEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

/**
 * Devuelve las vars requeridas por la suite E2E o tira con un mensaje claro de qué falta
 * y dónde ponerlo. No imprime NUNCA los valores (son secretos).
 */
export function getE2EEnv(): E2EEnv {
  loadEnv();
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey =
    process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL (o SUPABASE_URL)');
  if (!anonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY (o SUPABASE_ANON_KEY)');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Faltan variables para la suite E2E: ${missing.join(', ')}.\n` +
        `Copialas a <repoRoot>/.env.local (service_role vive ahí) y a app/.env.local ` +
        `(las EXPO_PUBLIC_*). Mismo patrón que supabase/tests/rls/run.cjs.`,
    );
  }

  return { supabaseUrl, anonKey, serviceRoleKey };
}
