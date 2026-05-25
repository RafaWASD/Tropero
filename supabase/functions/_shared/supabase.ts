// Factories tipadas para crear clientes Supabase desde Edge Functions.
// `createAdminClient`: bypassea RLS (service_role). Usar solo para operaciones
// que requieran tocar varias tablas en lockstep o devolver datos que el caller
// no podría ver via RLS.
// `createUserClient`: usa el JWT del header `Authorization` del request. Toda
// validación de permisos pasa por RLS + helpers `is_owner_of`/`has_role_in`.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
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
