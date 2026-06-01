// Capa de datos del perfil propio (spec 01, Fase 6 — ProfileContext).
//
// Fuente ÚNICA del nombre/teléfono del usuario: `public.users` (id/name/phone). El email NO
// se lee de acá: el ProfileContext lo toma del session de auth (AuthContext), que es siempre
// el email fresco tras confirmar un cambio (R2.2). Así eliminamos la desincronización del
// saludo que tenía Run 2 (que sincronizaba el nombre a auth.user_metadata además de a
// public.users → 2 fuentes frágiles).
//
// RLS `users_select_self` (0006) deja al user ver SOLO su propia fila (id = auth.uid()). No
// mezcla perfiles de otros (R7.2). NUNCA se hardcodea nada del usuario; sale de auth.uid() vía RLS.

import { supabase } from './supabase';

export type ProfileNamePhone = { name: string; phone: string | null };

export type LoadProfileNamePhoneResult =
  | { ok: true; profile: ProfileNamePhone }
  | { ok: false; error: { kind: 'network' | 'unknown'; message: string } };

function classifyError(error: { message?: string } | null): {
  kind: 'network' | 'unknown';
  message: string;
} {
  const msg = error?.message ?? '';
  if (/network|failed to fetch|fetch failed/i.test(msg)) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg || 'Error desconocido' };
}

/**
 * Lee name + phone del perfil propio (`public.users`) para el ProfileContext. El email NO se
 * trae acá (lo da el session de auth). Si la fila no existe (debería crearla el trigger
 * on_auth_user_created), reporta unknown en vez de fabricar datos.
 */
export async function loadProfileNamePhone(
  userId: string,
): Promise<LoadProfileNamePhoneResult> {
  const { data, error } = await supabase
    .from('users')
    .select('name, phone')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: classifyError(error) };
  }
  if (!data) {
    return {
      ok: false,
      error: { kind: 'unknown', message: 'No se encontró el perfil del usuario.' },
    };
  }
  return { ok: true, profile: { name: data.name ?? '', phone: data.phone ?? null } };
}
