// apple-auth.web.ts — login con Apple en WEB (spec 19, T10 / R3.2, R3.3, R3.4, R8.7).
//
// En web se usa el redirect OAuth de Supabase (no hay diálogo nativo de Apple). El browser va al
// login de Apple y vuelve al `redirectTo`; `detectSessionInUrl` (ya true) levanta la sesión (R3.4).
// NO importa libs nativas. R8.7: redirectTo = window.location.origin (app-controlado, anti open-redirect).

import { supabase } from './supabase';
import type { AuthActionResult } from '../contexts/AuthContext';

export async function signInWithApple(): Promise<AuthActionResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.origin },
  });
  if (error) return { ok: false, error };
  return { ok: true };
}
