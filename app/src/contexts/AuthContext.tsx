// AuthContext — sesión Supabase Auth del cliente (spec 01, T3.1 / R1.*).
//
// Estado (design.md §AuthContext):
//   { status: 'loading' }                                  ← bootstrap, leyendo la sesión persistida
//   { status: 'unauthenticated' }                          ← sin sesión
//   { status: 'authenticated', user, emailVerified }       ← con sesión (verificada o no)
//
// Acciones expuestas: signUp, signIn, signOut, requestPasswordReset, resendVerification.
// Se suscribe a supabase.auth.onAuthStateChange para reflejar cambios (login, logout,
// token refresh, verificación de email vía deep-link/web). El gating de navegación
// raíz (app/_layout.tsx) consume este estado.
//
// R5.11/T3.6: cuando el usuario queda authenticated + emailVerified, dispara el
// registro best-effort del push token (no-op en web/simulador). No bloquea ni rompe
// la sesión si falla.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { supabase } from '../services/supabase';
import { registerPushTokenBestEffort } from '../services/push-notifications';
import { identifyUser, resetIdentity } from '../services/observability/posthog';
import { signInWithGoogle as signInWithGoogleService } from '../services/google-auth';
import { signInWithApple as signInWithAppleService } from '../services/apple-auth';
import { forgetRememberedDevice } from '../services/ble/remembered-device';
import type { AuthErrorLike } from '../utils/auth-errors';

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; user: AuthUser; emailVerified: boolean };

export type SignUpInput = { name: string; email: string; password: string };
export type SignInInput = { email: string; password: string };

// Result interno de las acciones: el copy de error legible lo arma la pantalla con
// authErrorMessage(error). Acá devolvemos el AuthError crudo para que la pantalla
// elija el contexto del mensaje (signin/signup/...).
//
// spec 19 (R6.1): `error` es OPCIONAL en la variante `false` — la cancelación silenciosa del
// picker social devuelve `{ ok:false }` SIN error (la pantalla no muestra nada). Los flujos de
// password SIEMPRE traen `error`, así que su comportamiento no cambia (cambio aditivo, ratificado
// en Puerta 1). La pantalla social hace `if (result.error) setFormError(...)`.
export type AuthActionResult =
  | { ok: true }
  | { ok: false; error?: AuthErrorLike };

export type AuthContextValue = {
  state: AuthState;
  signUp: (input: SignUpInput) => Promise<AuthActionResult>;
  signIn: (input: SignInInput) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<AuthActionResult>;
  resendVerification: () => Promise<AuthActionResult>;
  /** Login social con Google (spec 19). Platform-split: nativo en iOS/Android, OAuth redirect en web. */
  signInWithGoogle: () => Promise<AuthActionResult>;
  /** Login social con Apple (spec 19). Nativo en iOS (nonce), OAuth redirect en web, no-op en Android. */
  signInWithApple: () => Promise<AuthActionResult>;
  /** Fuerza una relectura de la sesión desde el server (para el auto-refresh del gate). */
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthUser(user: User): AuthUser {
  const meta = user.user_metadata ?? {};
  const name = typeof meta.name === 'string' ? meta.name : null;
  return { id: user.id, email: user.email ?? null, name };
}

// Un email se considera verificado si Supabase marcó email_confirmed_at (o el
// alias confirmed_at). Si el proyecto tuviera verificación deshabilitada, el
// usuario nace confirmado y el gate no aparece.
function isEmailVerified(user: User): boolean {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at);
}

function stateFromSession(session: Session | null): AuthState {
  if (!session?.user) return { status: 'unauthenticated' };
  return {
    status: 'authenticated',
    user: toAuthUser(session.user),
    emailVerified: isEmailVerified(session.user),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  // Evita doble-registro del push token dentro de la misma sesión (onAuthStateChange
  // puede emitir varios eventos: SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED…).
  const pushRegisteredForUser = useRef<string | null>(null);

  // Bootstrap: leemos la sesión persistida una vez al montar. onAuthStateChange
  // también dispara INITIAL_SESSION, pero hacemos getSession explícito para no
  // depender del orden de eventos en todas las versiones de supabase-js.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState(stateFromSession(data.session));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (active) setState(stateFromSession(session));
      // El bastón RECORDADO muere con la sesión, TAMBIÉN cuando la sesión se muere sola (spec 04,
      // LOW-5 del Gate 2 del 2026-07-30). Antes esto vivía solo en el `signOut()` de abajo, o sea que
      // cubría el **gesto explícito** de cerrar sesión y no los fines de sesión involuntarios: refresh
      // token revocado o expirado, contraseña cambiada desde otro dispositivo, y —el caso concreto que
      // lo hace no-teórico— `delete_account`, que **revoca global**: en el segundo teléfono de la cuenta
      // la sesión muere por acá y el `forget` de `services/account.ts` no corre nunca.
      // Sin esto, el teléfono seguiría abriendo un RFCOMM sin gesto contra la MAC del dueño anterior
      // en cada apertura (R6.4). No se bloquea nada: es best-effort y la función tiene techo propio.
      if (event === 'SIGNED_OUT') {
        void forgetRememberedDevice().catch(() => undefined);
        // Spec 17 (R5.6) — reset de PostHog al cerrar sesión (gesto explícito O muerte involuntaria de la
        // sesión): no cruzar identidades entre usuarios en un teléfono compartido. Best-effort (no-op en
        // web/E2E). Cubre AMBOS finales de sesión, igual que el forget del bastón de arriba.
        resetIdentity();
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Spec 17 (R5.3) — identify de PostHog al quedar autenticado: SOLO el user.id como distinct id, NADA de
  // email/nombre/PII. Guard por-usuario (identify repetido en TOKEN_REFRESHED/USER_UPDATED es no-op, pero
  // evitamos la llamada). Best-effort (no-op en web/E2E). El reset vive en el branch SIGNED_OUT (R5.6).
  const identifiedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== 'authenticated') {
      identifiedForUser.current = null;
      return;
    }
    if (identifiedForUser.current === state.user.id) return;
    identifiedForUser.current = state.user.id;
    identifyUser(state.user.id);
  }, [state]);

  // Registro best-effort del push token cuando hay sesión verificada (T3.6).
  useEffect(() => {
    if (state.status !== 'authenticated' || !state.emailVerified) return;
    if (pushRegisteredForUser.current === state.user.id) return;
    pushRegisteredForUser.current = state.user.id;
    // Fire-and-forget: no bloquea la UI ni rompe la sesión si falla (web = no-op).
    registerPushTokenBestEffort().then((result) => {
      if (!result.ok && process.env.NODE_ENV !== 'production') {
        // Solo log de dev; en web el resultado esperado es 'not_a_device'.
        console.warn('[push] registro best-effort no realizado:', result.error.kind);
      }
    });
  }, [state]);

  const signUp = useCallback(async (input: SignUpInput): Promise<AuthActionResult> => {
    const { error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { name: input.name.trim() } },
    });
    if (error) return { ok: false, error };
    return { ok: true };
  }, []);

  const signIn = useCallback(async (input: SignInInput): Promise<AuthActionResult> => {
    const { error } = await supabase.auth.signInWithPassword({
      email: input.email.trim(),
      password: input.password,
    });
    if (error) return { ok: false, error };
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    pushRegisteredForUser.current = null;
    // El bastón RECORDADO muere con la sesión (spec 04, MEDIUM-2 del Gate 2 del 2026-07-30). Antes era
    // una MAC inerte en SecureStore; desde R6.4 la app abre un RFCOMM contra ella **sin gesto** en cada
    // apertura, así que dejarla sobrevivir significa que en un teléfono compartido —el cambio de turno
    // del peón— el usuario B arranca auto-conectando al bastón de A.
    //
    // ── PRECISIÓN (LOW-5 del Gate 2): "la vida de la clave es la de la SESIÓN" ─────────────────────
    // Eso vale porque la limpieza está en los DOS finales de sesión, no solo en este. Este es el gesto
    // EXPLÍCITO; el involuntario (refresh token revocado o expirado, contraseña cambiada en otro
    // dispositivo, y `delete_account`, que **revoca global**) entra por el branch `SIGNED_OUT` de
    // `onAuthStateChange`, arriba. Una versión anterior de este comentario afirmaba "la vida de la
    // sesión" con solo este call site puesto, y era falso: era la vida del gesto de logout. Queda dicho
    // porque un comentario que afirma más de lo que el código hace es peor que el hueco.
    //
    // Best-effort, y **acotado en el borde**: `forgetRememberedDevice` tiene techo propio
    // (`remembered-device.ts`), así que el peor caso es que el logout espere 2 s — no que no se pueda
    // hacer. Un `.catch()` acá cubriría el rechazo pero NO el colgado (⚪-L del review), y el logout no
    // puede depender de que el storage conteste.
    await forgetRememberedDevice().catch(() => undefined);
    await supabase.auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthActionResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) return { ok: false, error };
    return { ok: true };
  }, []);

  const resendVerification = useCallback(async (): Promise<AuthActionResult> => {
    const email = state.status === 'authenticated' ? state.user.email : null;
    if (!email) return { ok: false, error: { message: 'No hay email para reenviar.' } };
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) return { ok: false, error };
    return { ok: true };
  }, [state]);

  // Login social (spec 19, R1.1/R2.1). Wrappers finos de los servicios platform-split (Metro resuelve
  // .native/.web). NO tocan onAuthStateChange/getSession: el SIGNED_IN que emite la sesión OAuth ya
  // dispara stateFromSession → el RootGate re-rutea (R5.1). NO leen ni tocan el estado de lockout del
  // password (R8.5): el OAuth no es brute-forceable, no incrementa ni limpia el lockout.
  const signInWithGoogle = useCallback(async (): Promise<AuthActionResult> => {
    return signInWithGoogleService();
  }, []);

  const signInWithApple = useCallback(async (): Promise<AuthActionResult> => {
    return signInWithAppleService();
  }, []);

  const refreshSession = useCallback(async () => {
    // getUser() pega al server (no usa el cache local) → refleja el email recién
    // verificado. Si la sesión es válida, refrescamos el estado con el user fresco.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      // Si el user ya no existe o el token venció, releemos la sesión local.
      const { data: sessionData } = await supabase.auth.getSession();
      setState(stateFromSession(sessionData.session));
      return;
    }
    setState({
      status: 'authenticated',
      user: toAuthUser(data.user),
      emailVerified: isEmailVerified(data.user),
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        state,
        signUp,
        signIn,
        signOut,
        requestPasswordReset,
        resendVerification,
        signInWithGoogle,
        signInWithApple,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}
