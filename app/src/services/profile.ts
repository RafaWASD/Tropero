// Capa de datos del perfil propio (spec 01, Fase 6 — ProfileContext).
//
// El `name` sale de `public.users` (perfil público); el `phone` se separó a
// `public.user_private` (PII de contacto self-only, spec 14 / ADR-025). El email NO se lee de
// acá: el ProfileContext lo toma del session de auth (AuthContext), que es siempre el email
// fresco tras confirmar un cambio (R2.2). Así eliminamos la desincronización del saludo que
// tenía Run 2 (que sincronizaba el nombre a auth.user_metadata además de a public.users).
//
// RLS: `users_select_self` (0006) deja al user ver SOLO su fila de users (id = auth.uid());
// `user_private_select_self` (0068) idem para su fila de user_private (user_id = auth.uid()). No
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
 * Lee name (de `public.users`) + phone (de `public.user_private`) del perfil propio para el
 * ProfileContext. El email NO se trae acá (lo da el session de auth). Si la fila de users no existe
 * (debería crearla el trigger on_auth_user_created), reporta unknown en vez de fabricar datos.
 *
 * El phone vive en `user_private` (spec 14): lo leemos con su propia query self-only. Si esa fila
 * faltara (no debería: el trigger de signup la crea junto con users), tratamos phone como null en
 * vez de fallar — el name (perfil público) es suficiente para el saludo; el teléfono es opcional.
 */
export async function loadProfileNamePhone(
  userId: string,
): Promise<LoadProfileNamePhoneResult> {
  const { data, error } = await supabase
    .from('users')
    .select('name')
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

  const { data: priv, error: privError } = await supabase
    .from('user_private')
    .select('phone')
    .eq('user_id', userId)
    .maybeSingle();

  if (privError) {
    return { ok: false, error: classifyError(privError) };
  }

  return { ok: true, profile: { name: data.name ?? '', phone: priv?.phone ?? null } };
}
