// supabase/tests/health/run.cjs
// Suite de la Edge Function `health` — spec 16 Run C (R7.1, R7.2, R7.4, R7.5, R7.7).
// Corre contra el proyecto remoto DEV. La EF `health` es PÚBLICA (verify_jwt=false) → se pinguea sin JWT
// (patrón UptimeRobot). Devuelve un JSON MÍNIMO { ok, schema_version, env } — nada sensible.
//
// ⚠️ GATEADA: requiere que el LEADER haya (1) aplicado 0125_health_status.sql a DEV y (2) deployado la EF
//    `health` a DEV con `--no-verify-jwt`. Antes del deploy, esta suite FALLA (la EF/RPC no existen) →
//    mismo patrón que spec 12/14/M6/tratamientos/audit. El hook en scripts/run-tests.mjs va COMENTADO
//    hasta el deploy. Trazabilidad R<n> → test en progress/impl_16-runC.md.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const envLocalPath = path.join(REPO_ROOT, '.env.local');
if (fs.existsSync(envLocalPath)) {
  const envText = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Faltan vars: SUPABASE_URL, SUPABASE_ANON_KEY');
  process.exit(2);
}

const FN_URL = `${SUPABASE_URL}/functions/v1/health`;
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/health_status`;

// Set de claves permitidas en el body de `health`. Cualquier clave fuera de acá = leak (R7.5).
const ALLOWED_KEYS = ['ok', 'schema_version', 'env'];

test('Edge Function health (spec 16 Run C)', async (t) => {
  // -------------------------------------------------------------------
  // C4(a) — R7.1/R7.2: 200 con ok:true y schema_version = prefijo 4 dígitos (o 'unknown').
  // Se invoca con GET sin headers (exactamente el patrón de monitoreo de UptimeRobot).
  // -------------------------------------------------------------------
  await t.test('C4(a) R7.1/R7.2: 200 con ok:true y schema_version ^\\d{4}$|^unknown$', async () => {
    const res = await fetch(FN_URL, { method: 'GET' });
    assert.equal(res.status, 200, `esperaba 200, obtuve ${res.status}`);
    const body = await res.json();
    assert.equal(body.ok, true, 'ok debería ser true');
    assert.match(
      String(body.schema_version),
      /^\d{4}$|^unknown$/,
      `schema_version debería ser prefijo de 4 dígitos o 'unknown', fue ${JSON.stringify(body.schema_version)}`,
    );
  });

  // -------------------------------------------------------------------
  // C4(b) — R7.4: invocable SIN Authorization header (verify_jwt=false). UptimeRobot no manda JWT.
  // Mando también un POST para confirmar que la EF es método-agnóstica (no restringe a GET).
  // -------------------------------------------------------------------
  await t.test('C4(b) R7.4: invocable sin Authorization header (verify_jwt=false)', async () => {
    const res = await fetch(FN_URL, { method: 'POST' }); // sin apikey, sin Authorization, sin body
    assert.equal(
      res.status,
      200,
      `sin JWT debería ser 200 (verify_jwt=false), obtuve ${res.status}`,
    );
    const body = await res.json();
    assert.equal(body.ok, true, 'ok debería ser true aun sin auth');
  });

  // -------------------------------------------------------------------
  // C4(c) — R7.5: el body no trae ninguna clave fuera de {ok, schema_version, env} (no leak de datos de
  // negocio / conteos / PII / filename completo de la migración).
  // -------------------------------------------------------------------
  await t.test('C4(c) R7.5: el body no expone claves fuera de {ok,schema_version,env} (no leak)', async () => {
    const res = await fetch(FN_URL, { method: 'GET' });
    assert.equal(res.status, 200, `esperaba 200, obtuve ${res.status}`);
    const body = await res.json();
    for (const k of Object.keys(body)) {
      assert.ok(ALLOWED_KEYS.includes(k), `clave inesperada en el body de health: "${k}"`);
    }
    // Defensa extra: el body serializado no debe filtrar nombres de tablas de negocio, conteos, PII,
    // ni el filename completo de la migración (L1).
    const blob = JSON.stringify(body).toLowerCase();
    for (const leak of [
      'animal', 'establishment', 'user', 'tenant', 'count',
      'health_status', '.sql', 'select', 'password', 'email',
    ]) {
      assert.ok(!blob.includes(leak), `el body no debería filtrar "${leak}": ${blob}`);
    }
  });

  // -------------------------------------------------------------------
  // C4(d) — R7.7 (Gate 1 M1): `anon` NO puede ejecutar public.health_status() como RPC directo vía
  // PostgREST. La migración 0125 hace REVOKE ... FROM PUBLIC + FROM anon, authenticated → PostgREST
  // oculta la función (404) o deniega (401/403). NUNCA 200 (que expondría el RPC público).
  // -------------------------------------------------------------------
  await t.test('C4(d) R7.7/M1: anon NO puede ejecutar rpc/health_status directo', async () => {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`, // el anon key es un JWT con role=anon
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.ok(
      [401, 403, 404].includes(res.status),
      `esperaba 401/403/404 (REVOKE FROM PUBLIC/anon), obtuve ${res.status}`,
    );
    assert.notEqual(res.status, 200, 'anon NO debe poder ejecutar health_status directo (RPC público)');
  });
});
