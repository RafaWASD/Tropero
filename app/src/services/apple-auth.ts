// apple-auth.ts — CONTRATO/stub del login con Apple (spec 19, R2.1 / T8).
//
// Base SOLO para tsc: define la firma pública `signInWithApple()`. En runtime Metro
// resuelve `apple-auth.native.ts` (iOS/Android) o `apple-auth.web.ts` (web) — este base
// nunca se bundlea. NO importa `expo-apple-authentication` ni `expo-crypto`: mantiene el
// import nativo fuera del bundle web (R2.5/R7.5).

import type { AuthActionResult } from '../contexts/AuthContext';

export async function signInWithApple(): Promise<AuthActionResult> {
  // Cuerpo inalcanzable en runtime (Metro resuelve .native/.web). Fallback benigno.
  return { ok: false, error: { code: 'social_unavailable', message: 'Apple no disponible.' } };
}
