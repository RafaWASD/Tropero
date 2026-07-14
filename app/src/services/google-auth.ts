// google-auth.ts — CONTRATO/stub del login con Google (spec 19, R1.1 / T5).
//
// Este archivo BASE existe SOLO para tsc (typecheck): define la firma pública
// `signInWithGoogle()`. En runtime Metro resuelve SIEMPRE la variante de plataforma
// (`google-auth.native.ts` en iOS/Android, `google-auth.web.ts` en web) — este base
// nunca se bundlea. NO importa `@react-native-google-signin/google-signin` ni ninguna
// lib nativa: eso mantiene el import nativo FUERA del grafo del bundle web (R1.7/R7.5).

import type { AuthActionResult } from '../contexts/AuthContext';

export async function signInWithGoogle(): Promise<AuthActionResult> {
  // Cuerpo inalcanzable en runtime (Metro resuelve .native/.web). Fallback benigno por si
  // alguna resolución exótica cayera acá: degrada sin romper (copy social, R6.3).
  return { ok: false, error: { code: 'social_unavailable', message: 'Google no disponible.' } };
}
