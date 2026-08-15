// supabase/functions/health/index.ts — spec 16 Run C (R7.1–R7.5, R7.9).
//
// Endpoint de salud PÚBLICO (`verify_jwt=false`, ver supabase/config.toml `[functions.health]`) para que
// UptimeRobot (u otro monitor externo) lo pinguee SIN JWT (R7.4). Devuelve un JSON MÍNIMO
// { ok, schema_version, env } — NADA sensible: ni datos de negocio, ni conteos de tenants, ni PII (R7.5).
//
// SUPERFICIE MÍNIMA (Gate 1 M2 / R7.9): la función corre con service_role (createAdminClient) → es
// INPUT-FREE por diseño: NO lee body ni query params del request. Invariante a preservar a futuro: ningún
// input de usuario debe entrar a este code-path service_role (si en algún momento necesita input, hay que
// reevaluar la postura de seguridad del endpoint público).
//
// `schema_version` = SOLO el prefijo numérico de 4 dígitos de la última migración del ledger
// `ops.applied_migrations` (L1: no filtra el filename completo → no revela nombres de features/roadmap),
// calculado server-side por public.health_status() (SECURITY DEFINER, migración 0125). El ledger no existe
// todavía → la función DB devuelve 'unknown' sin romper ok:true.
//
// En fallo (RPC error o excepción) → serverError: copy genérico fijo, SIN el `.message` del driver
// Postgres/Deno (R7.3, patrón spec 13). El status no-200 lo produce serverError (500).

import { serveEf } from '../_shared/serve.ts';
import { jsonOk, serverError } from '../_shared/errors.ts';
import { createAdminClient } from '../_shared/supabase.ts';

serveEf('health', async () => {
  // Método-agnóstico: UptimeRobot pinguea con GET/HEAD, el dashboard/tests pueden usar POST. No se
  // restringe el método (no hay efecto de lado ni input). El preflight CORS (OPTIONS → 204) lo hace serveEf.

  // R7.9 — INPUT-FREE: NO se lee req.json() ni la query string. La respuesta no depende del request.
  try {
    const admin = createAdminClient();
    // health_status() hace el SELECT del ledger server-side (SECURITY DEFINER). Implica que la DB
    // respondió (equivale al `SELECT 1` de R7.1) y trae el schema_version (prefijo 4 dígitos / 'unknown').
    const { data, error } = await admin.rpc('health_status');
    if (error) return serverError('health_db', error); // R7.3 — 5xx, copy genérico, sin driver msg.
    return jsonOk({
      ok: true, // R7.1 — la DB respondió.
      // R7.2 / L1 — prefijo numérico de 4 dígitos, o 'unknown'. `?? 'unknown'` refleja la misma postura
      // defensiva de la función DB (nunca romper el health por un shape inesperado del payload).
      schema_version: data?.schema_version ?? 'unknown',
      // Label de ambiente (secret por proyecto: RAFAQ_ENV=development|production). 'unknown' si no está
      // seteado todavía (no es sensible; ayuda a distinguir DEV de PROD en el monitor).
      env: Deno.env.get('RAFAQ_ENV') ?? 'unknown',
    });
  } catch (err) {
    return serverError('health_unexpected', err); // R7.3 — 5xx genérico ante cualquier excepción.
  }
});
