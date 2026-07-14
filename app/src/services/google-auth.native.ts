// google-auth.native.ts — login con Google en iOS/Android (spec 19, T6 / R1.2–R1.7, R6.1/R6.3/R6.4).
//
// Único punto del código donde se importa `@react-native-google-signin/google-signin` (R1.7): así el
// import nativo vive SOLO en el grafo native y NO se filtra al bundle web (R7.5). Flujo:
//   configure({ webClientId }) → hasPlayServices() → signIn() → signInWithIdToken({ provider:'google', token })
// El picker nativo devuelve un idToken firmado por Google; Supabase lo acepta solo si su `aud` ∈
// Authorized Client IDs del proyecto (R8.2) — el cliente no valida el token por su cuenta (R8.3).
//
// D6/R1.6: NO se envía nonce en Google (la firma del idToken + audience cierran la superficie).
// R8.9: NO se loggea el idToken ni el mensaje crudo del proveedor (cero console.*); el error se
// normaliza a { code, ... } para que la pantalla arme el copy con authErrorMessage(_, 'social').

import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { supabase } from './supabase';
import { getEnv } from '../utils/env';
import type { AuthActionResult } from '../contexts/AuthContext';

export async function signInWithGoogle(): Promise<AuthActionResult> {
  try {
    // El webClientId es opcional (R7.4): si falta (config de Raf pendiente), configure recibe
    // undefined y el sign-in falla con DEVELOPER_ERROR → copy R6.3 (degradado aceptable).
    GoogleSignin.configure({ webClientId: getEnv().googleWebClientId });

    // En Huawei / sin Google Play, hasPlayServices lanza PLAY_SERVICES_NOT_AVAILABLE (R6.4).
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const response = await GoogleSignin.signIn();

    // Cancelación del selector (v16 la DEVUELVE como { type:'cancelled' }, no la tira) → silencio (R6.1).
    if (!isSuccessResponse(response)) {
      return { ok: false };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      return { ok: false, error: { code: 'no_id_token', message: 'No se obtuvo el token de Google.' } };
    }

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { ok: false, error };
    // Éxito: onAuthStateChange(SIGNED_IN) + RootGate re-rutean; no navegamos desde acá (R1.4).
    return { ok: true };
  } catch (e) {
    if (isErrorWithCode(e)) {
      // Cancelación / flujo ya en curso → silencio (por si una versión los TIRA en vez de devolverlos).
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) {
        return { ok: false };
      }
      // Normalizamos el code OPACO de la lib a un code canónico estable que auth-errors reconoce (los
      // valores de statusCodes son platform-dependientes; no exponemos el message crudo del proveedor).
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { ok: false, error: { code: 'play_services_not_available' } };
      }
      // DEVELOPER_ERROR NO está en statusCodes de la v16 → llega como string crudo del native module.
      if (e.code === 'DEVELOPER_ERROR') {
        return { ok: false, error: { code: 'developer_error' } };
      }
      // Otro code de la lib: pasamos code + message SOLO para clasificar red en authErrorMessage (nunca
      // se MUESTRA el message crudo; auth-errors devuelve copy es-AR curado). R8.9: no se loggea nada.
      return { ok: false, error: { code: e.code, message: e.message ?? null, name: e.name ?? null } };
    }
    const err = (e ?? {}) as { message?: string; name?: string; status?: number };
    return {
      ok: false,
      error: { code: null, message: err.message ?? null, name: err.name ?? null, status: err.status ?? null },
    };
  }
}
