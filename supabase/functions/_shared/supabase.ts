// Factories tipadas para crear clientes Supabase desde Edge Functions.
// `createAdminClient`: bypassea RLS (service_role). Usar solo para operaciones
// que requieran tocar varias tablas en lockstep o devolver datos que el caller
// no podría ver via RLS.
// `createUserClient`: usa el JWT del header `Authorization` del request. Toda
// validación de permisos pasa por RLS + helpers `is_owner_of`/`has_role_in`.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// `actorId` (spec 18, Opción A / H1): cuando se pasa, propaga el ACTOR real de la mutación al trigger de
// auditoría por el header `X-Rafaq-Actor` en TODAS las requests del admin client. PostgREST expone el
// header como GUC `request.headers` (transaction-local, misma transacción del DML → el trigger lo ve), y
// el trigger lo confía SOLO en contexto service_role (anti-spoof). Cambio ADITIVO: sin `actorId` el
// comportamiento es idéntico al anterior. El actor DEBE ser el `user.id` del JWT validado del llamante
// (`requireUser`), NUNCA del body (spoofeable). Ver 0124_audit_log.sql § actor.
export function createAdminClient(actorId?: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(actorId
      ? { global: { headers: { 'X-Rafaq-Actor': actorId } } }
      : {}),
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
