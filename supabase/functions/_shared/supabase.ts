// Factories tipadas para crear clientes Supabase desde Edge Functions.
// `createAdminClient`: bypassea RLS (service_role). Usar solo para operaciones
// que requieran tocar varias tablas en lockstep o devolver datos que el caller
// no podría ver via RLS.
// `createUserClient`: usa el JWT del header `Authorization` del request. Toda
// validación de permisos pasa por RLS + helpers `is_owner_of`/`has_role_in`.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { ACTOR_HEADER, REQUEST_ID_HEADER } from './request-headers.ts';

// `actorId` (spec 18, Opción A / H1): cuando se pasa, propaga el ACTOR real de la mutación al trigger de
// auditoría por el header `ACTOR_HEADER` en TODAS las requests del admin client. PostgREST expone el
// header como GUC `request.headers` (transaction-local, misma transacción del DML → el trigger lo ve), y
// el trigger lo confía SOLO en contexto service_role (anti-spoof). El actor DEBE ser el `user.id` del JWT
// validado del llamante (`requireUser`), NUNCA del body (spoofeable). Ver 0124_audit_log.sql § actor.
//
// `requestId` (spec 23, R2.12): cuando se pasa, propaga el ID de correlación de la acción por el header
// `REQUEST_ID_HEADER` en TODAS las requests del admin client → PostgREST lo expone como GUC
// `request.headers` → `audit.resolve_request_id()` lo aterriza (bajo service_role) en la columna
// `request_id` de las filas de audit de esa llamada (hoy: writes de `user_roles`). Igual mecanismo/anti-spoof
// que el actor. Ver 0131_audit_request_id.sql.
//
// Rebrand fase 5: acá se escribe SOLO el nombre nuevo (`X-Mitropero-*`). Los lectores en la DB aceptan
// además el viejo mientras queden clientes sin actualizar; ver `request-headers.ts`.
//
// Cambio ADITIVO: sin `actorId` NI `requestId` el shape del cliente es idéntico al anterior (sin
// `global.headers`) → sin regresión. Con uno o ambos, se arma `global.headers` con solo los presentes.
export function createAdminClient(
  actorId?: string,
  requestId?: string,
): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  const headers: Record<string, string> = {};
  if (actorId) headers[ACTOR_HEADER] = actorId;
  if (requestId) headers[REQUEST_ID_HEADER] = requestId;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(Object.keys(headers).length ? { global: { headers } } : {}),
  });
}

export function createUserClient(req: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}
