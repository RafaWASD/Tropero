// google-auth.web.ts — login con Google en WEB (spec 19, T7 / R3.1, R3.3, R3.4, R8.7).
//
// En web no hay picker nativo: se usa el redirect OAuth de Supabase. El browser va al consent de
// Google y vuelve al `redirectTo`; `detectSessionInUrl` (ya true en supabase.ts) levanta la sesión
// del fragment al volver (R3.4). NO importa ninguna lib nativa (bundle web limpio).
//
// R8.7: `redirectTo` = window.location.origin (valor controlado por la app, mismo tab), nunca un
// input del usuario → anti open-redirect. R8.9: no se loggea nada crudo.

import { supabase } from './supabase';
import type { AuthActionResult } from '../contexts/AuthContext';

export async function signInWithGoogle(): Promise<AuthActionResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
  if (error) return { ok: false, error };
  // Sin error: el browser está redirigiendo al proveedor. No navegamos a mano.
  return { ok: true };
}
