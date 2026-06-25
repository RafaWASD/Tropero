#!/usr/bin/env node
// scripts/cleanup-test-orphan.mjs — borra UN animal de TEST huérfano que rojea el check.
//
// Contexto: el test "INPUT-1 CHECK" de supabase/tests/animal/run.cjs hace
//   UPDATE animals SET tag_electronic = '9'×64  (valor FIJO, no único por corrida)
// para probar el borde del CHECK de largo. Si esa corrida se interrumpe antes del teardown, deja un
// animal con ese tag → la próxima corrida choca animals_tag_unique (duplicate key) y el check queda rojo.
// NO es regresión; es basura de test. (Fix de raíz: que el test use un tag único por RUN_TAG — backlog.)
//
// GUARDRAIL: solo borra si el animal tiene EXACTAMENTE tag_electronic = '9'×64 (basura de test
// inequívoca). Si el tag no matchea, ABORTA sin tocar nada — nunca puede borrar un animal real.
//
// Uso: node scripts/cleanup-test-orphan.mjs <animal_id_uuid>
// ⚠️ Escribe a la DB compartida (beta). Correr solo con OK de deploy de Raf.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

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
const id = process.argv[2];

if (!PROJECT_REF || !ACCESS_TOKEN) {
  console.error('Falta SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN en .env.local');
  process.exit(2);
}
if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
  console.error('Uso: node scripts/cleanup-test-orphan.mjs <animal_id_uuid>');
  process.exit(2);
}

// Transacción con guardrail: aborta si el tag no es la basura de test '9'×64.
// El id ya está validado como UUID (no hay vector de inyección).
const sql = `
do $$
declare v_tag text;
begin
  select tag_electronic into v_tag from public.animals where id = '${id}';
  if v_tag is null then
    raise exception 'animal % no existe (¿ya borrado?)', '${id}';
  end if;
  if v_tag <> repeat('9', 64) then
    raise exception 'GUARDRAIL: animal % tiene tag_electronic distinto de la basura de test (9x64) — ABORTADO', '${id}';
  end if;
  delete from public.animal_category_history where animal_profile_id in
    (select id from public.animal_profiles where animal_id = '${id}');
  delete from public.animal_events where animal_profile_id in
    (select id from public.animal_profiles where animal_id = '${id}');
  delete from public.animal_profiles where animal_id = '${id}';
  delete from public.animals where id = '${id}';
end $$;`;

console.log(`Limpiando animal de test huérfano ${id} (guardrail: tag = '9'×64) en ${PROJECT_REF}...`);
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
console.log(`OK (HTTP ${res.status}). Huérfano eliminado. Respuesta: ${body.slice(0, 200)}`);
