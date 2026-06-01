// ProfileContext — perfil del usuario autenticado, FUENTE ÚNICA del saludo (spec 01, Fase 6).
//
// PROBLEMA que arregla (greeting desync, prometido en Run 2): el saludo de la home leía `name`
// de AuthContext (= `auth.user_metadata.name`). `saveProfile` (Run 2) sincronizaba el nombre a
// auth-metadata ADEMÁS de a `public.users` → 2 fuentes frágiles ("Hola Raf" no se actualizaba
// confiablemente). Acá consolidamos: el name/phone salen de `public.users` (fuente persistente
// del perfil), el email del session de auth (siempre fresco tras confirmar un cambio, R2.2).
// `saveProfile` deja de tocar auth-metadata (ese sync ya no hace falta).
//
// Depende de AuthContext: recarga cuando cambia el `user.id` (login distinto). El email se
// deriva del session SIN fetch (no es una fuente separada).
//
// ⚠️ Anti-footgun (lección de miembros.tsx, B.1.3 fix loop 2): las deps del efecto de carga
// son PRIMITIVOS (userId: string|null), NO objetos recreados cada render → sin loop de fetch.
// El email se mete por separado en el value memoizado (no dispara recarga; no requiere red).
//
// Monta DENTRO de <AuthProvider> (ver contexts/index.ts + app/_layout.tsx). Sin sesión, queda
// en un estado neutro (profile null, no loading infinito): el saludo cae a su fallback genérico.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from './AuthContext';
import { loadProfileNamePhone } from '../services/profile';

export type Profile = {
  /** Nombre del usuario (de public.users). '' si no lo completó. */
  name: string;
  /** Teléfono del usuario (de public.users). null si no lo completó. */
  phone: string | null;
  /** Email del usuario, derivado del session de auth (fresco tras confirmar, R2.2). null sin sesión. */
  email: string | null;
};

export type ProfileContextValue = {
  /** El perfil del usuario actual, o null mientras no hay sesión / no cargó aún. */
  profile: Profile | null;
  /** true mientras la primera carga (o un refresh) está en vuelo. */
  loading: boolean;
  /** Mensaje de error de carga (legible), o null. */
  error: string | null;
  /** Re-lee name/phone de public.users (tras guardar perfil). El email se re-deriva del session. */
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  // Primitivos estables (no objetos): así el efecto de carga NO re-dispara cada render.
  const userId = authState.status === 'authenticated' ? authState.user.id : null;
  const email = authState.status === 'authenticated' ? authState.user.email : null;

  // name/phone vienen de public.users (la única fuente que pega a red).
  const [namePhone, setNamePhone] = useState<{ name: string; phone: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: ignorar resultados de una carga vieja si el user cambió mientras estaba en vuelo
  // (login distinto). Comparamos contra el userId vigente al resolver.
  const loadSeq = useRef(0);

  const loadFor = useCallback(async (uid: string | null) => {
    if (!uid) {
      // Sin sesión: estado neutro, sin loading infinito. El saludo cae al fallback genérico.
      setNamePhone(null);
      setError(null);
      setLoading(false);
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    const result = await loadProfileNamePhone(uid);
    // Si entre tanto cambió el user (otra carga arrancó), descartamos este resultado stale.
    if (seq !== loadSeq.current) return;
    if (result.ok) {
      setNamePhone(result.profile);
    } else {
      // No tumbamos un nombre ya cargado por un fallo de red transitorio: solo seteamos error.
      setError(
        result.error.kind === 'network'
          ? 'Sin conexión: no pudimos actualizar tu perfil.'
          : 'No pudimos cargar tu perfil.',
      );
    }
    setLoading(false);
  }, []);

  // Carga inicial + recarga cuando cambia el user (dep PRIMITIVA: userId).
  useEffect(() => {
    void loadFor(userId);
  }, [userId, loadFor]);

  const refresh = useCallback(async () => {
    await loadFor(userId);
  }, [userId, loadFor]);

  // El email se compone acá (del session), no es una fuente separada de fetch. El profile es
  // null sin sesión o mientras nunca cargó name/phone (el saludo usa el fallback en ese caso).
  const value = useMemo<ProfileContextValue>(() => {
    const profile: Profile | null =
      userId && namePhone ? { name: namePhone.name, phone: namePhone.phone, email } : null;
    return { profile, loading, error, refresh };
  }, [userId, namePhone, email, loading, error, refresh]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile debe usarse dentro de <ProfileProvider>.');
  return ctx;
}
