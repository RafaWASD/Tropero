// apple-auth.native.ts — login con Apple en iOS (spec 19, T9 / R2.2–R2.5, R6.1, R8.1).
//
// Único punto del código de SERVICIO donde se importan `expo-apple-authentication` y `expo-crypto`
// (R2.5): viven SOLO en el grafo native, no se filtran al bundle web (R7.5). Android no tiene Apple
// nativo → { ok:false } (el botón tampoco se monta, D2/R2.6).
//
// Nonce (D6/R8.1 — el punto crítico anti-replay):
//   1. rawNonce    = hex aleatorio (secreto per-intento)
//   2. hashedNonce = SHA-256(rawNonce)   ← lo que ve Apple
//   3. signInAsync({ nonce: hashedNonce })   → Apple firma el idToken con claim nonce = hashedNonce
//   4. signInWithIdToken({ provider:'apple', token, nonce: rawNonce })  → Supabase computa SHA-256(raw)
//      y lo compara contra el claim del idToken. Se le pasa a APPLE el hash y a SUPABASE el raw.
//
// R8.9: NO se loggea el identityToken / rawNonce / hashedNonce ni el mensaje crudo del proveedor
// (cero console.*). El error se normaliza a { code, ... } para el copy es-AR de la pantalla.

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { supabase } from './supabase';
import type { AuthActionResult } from '../contexts/AuthContext';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function signInWithApple(): Promise<AuthActionResult> {
  // Apple nativo existe solo en iOS (D2). En Android no aplica: el cross-device se cubre por
  // linking de email + password fallback (D3), no por Apple-en-Android.
  if (Platform.OS !== 'ios') return { ok: false };

  try {
    const rawNonce = toHex(await Crypto.getRandomBytesAsync(16));
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    const identityToken = credential.identityToken;
    if (!identityToken) {
      return { ok: false, error: { code: 'no_identity_token', message: 'No se obtuvo el token de Apple.' } };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: identityToken,
      nonce: rawNonce,
    });
    if (error) return { ok: false, error };
    // Éxito: onAuthStateChange + RootGate re-rutean; no navegamos desde acá (R1.4).
    return { ok: true };
  } catch (e) {
    const err = (e ?? {}) as { code?: string; message?: string; name?: string };
    // Cancelación del diálogo de Apple → silencio (R6.1).
    if (err.code === 'ERR_REQUEST_CANCELED') return { ok: false };
    return { ok: false, error: { code: err.code ?? null, message: err.message ?? null, name: err.name ?? null } };
  }
}
