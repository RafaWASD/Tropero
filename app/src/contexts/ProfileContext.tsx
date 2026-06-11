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

import { useStatus } from '@powersync/react';

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
  /**
   * Aplica OPTIMISTA el name/phone recién guardado (spec 15, residual de reactividad). `saveProfile`
   * es ONLINE-direct a `public.users`/`user_private` (no pasa por overlay/outbox), pero la LECTURA del
   * perfil viene del SQLite local de PowerSync — que todavía tiene el valor viejo hasta que el
   * server-write SINCRONIZA de vuelta. Sin esto, el saludo de la home no se actualizaba hasta el
   * round-trip de sync-down (latencia visible / e2e flaky). Como `saveProfile` ya devolvió ok (el
   * server tiene el valor nuevo), reflejamos los valores recién escritos AL INSTANTE; el `lastSyncedAt`
   * advance posterior re-lee y reconcilia al MISMO valor (idempotente). Limpia cualquier error espurio.
   */
  applyOwnProfile: (saved: { name: string; phone: string | null }) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  // Primitivos estables (no objetos): así el efecto de carga NO re-dispara cada render.
  const userId = authState.status === 'authenticated' ? authState.user.id : null;
  const email = authState.status === 'authenticated' ? authState.user.email : null;

  // Reactividad de la lectura local (spec 15): name/phone se leen del SQLite local de PowerSync
  // (loadProfileNamePhone, T3.2), pero la lectura es one-shot. `lastSyncedAt` AVANZA cada vez que el
  // sync baja datos del server al SQLite local → lo usamos como señal para re-leer (mismo patrón que
  // animales.tsx:192 / index.tsx:415). Primitivo (ms) → estable entre statuses iguales, sin loop.
  const syncStatus = useStatus();
  const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;

  // name/phone vienen de public.users (la única fuente que pega a red).
  const [namePhone, setNamePhone] = useState<{ name: string; phone: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guard: ignorar resultados de una carga vieja si el user cambió mientras estaba en vuelo
  // (login distinto). Comparamos contra el userId vigente al resolver.
  const loadSeq = useRef(0);

  // Reconciliación del aterrizaje OPTIMISTA (post-edición): el name recién guardado server-side que el
  // SQLite local AÚN no refleja. Mientras esté seteado, un `loadFor` reactivo (lastSyncedAt) que devuelva
  // un name DISTINTO se considera STALE (la lectura local todavía no recibió el sync-down del row editado)
  // → NO pisamos el valor optimista. Se limpia cuando el local read confirma el name nuevo (mismo ciclo de
  // vida que pendingCreatedRef en EstablishmentContext). Sin esto, un sync-down de OTRAS tablas avanzaría
  // lastSyncedAt y re-leería el name viejo, revirtiendo el saludo (flake del e2e profile:62).
  const pendingOptimisticNameRef = useRef<string | null>(null);

  const loadFor = useCallback(async (uid: string | null) => {
    if (!uid) {
      // Sin sesión: estado neutro, sin loading infinito. El saludo cae al fallback genérico.
      setNamePhone(null);
      setError(null);
      setLoading(false);
      pendingOptimisticNameRef.current = null;
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    const result = await loadProfileNamePhone(uid);
    // Si entre tanto cambió el user (otra carga arrancó), descartamos este resultado stale.
    if (seq !== loadSeq.current) return;
    if (result.ok) {
      // Reconciliación del optimista: si esperamos confirmar un name recién guardado y el local todavía
      // devuelve OTRO (sync-down del row aún no llegó), NO revertimos el saludo — mantenemos el optimista
      // y dejamos el marcador para el próximo lastSyncedAt. Cuando el local ya trae el name esperado, se
      // confirma y se limpia el marcador (de ahí en más las lecturas mandan normalmente).
      const pending = pendingOptimisticNameRef.current;
      if (pending !== null && result.profile.name !== pending) {
        setLoading(false);
        return;
      }
      pendingOptimisticNameRef.current = null;
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

  // Carga inicial + recarga cuando cambia el user (dep PRIMITIVA: userId). Al cambiar de usuario
  // (login distinto) limpiamos el marcador optimista: pertenecía al usuario anterior y NO debe
  // bloquear la carga del name del nuevo (que es legítimamente distinto).
  useEffect(() => {
    pendingOptimisticNameRef.current = null;
    void loadFor(userId);
  }, [userId, loadFor]);

  // FIX (triage 2026-06-11): re-leer el perfil cuando AVANZA el sync (lastSyncedAt). Cierra DOS
  // síntomas del mismo gap de reactividad de la lectura local (spec 15, backlog 2026-06-09):
  //
  //   (a) ARRANQUE — la carga inicial (efecto de arriba) corre al resolver userId, típicamente ANTES
  //       del first-sync: la fila del usuario todavía no bajó al SQLite local → `runLocalQuerySingle`
  //       degrada "vacío + !hasSynced" a `kind:'network'` → ProfileContext queda con
  //       error="Sin conexión: no pudimos actualizar tu perfil." y profile=null, y NO se re-evaluaba
  //       solo. "Más" renderizaba el alert "Reintentar" en vez de "Editar perfil"/"Cambiar email"
  //       hasta un retry manual (4 e2e rojos: account:151, profile:54/75/110). Al completar el
  //       first-sync, lastSyncedAt pasa de 0 a un valor → re-leemos → el perfil carga y limpia el error.
  //
  //   (b) POST-EDICIÓN — `saveProfile` es ONLINE-direct a `public.users`/`user_private` (no pasa por el
  //       overlay/outbox); el `refresh()` inmediato re-lee el SQLite LOCAL, que todavía tiene el name
  //       viejo hasta que el server-write sincroniza de vuelta → el saludo de la home no se actualizaba
  //       (e2e profile.spec.ts:62). Cuando el row editado baja, lastSyncedAt avanza → re-leemos → saludo
  //       al día.
  //
  // Mismo patrón canónico que animales.tsx:192 / index.tsx:415 (re-load on lastSyncedAt advance). La dep
  // es un PRIMITIVO (ms): estable entre statuses iguales → sin loop. Se omite mientras lastSyncedMs===0
  // (aún no hubo ningún sync; la carga inicial ya corrió). Caso offline-puro intacto: sin sync nunca,
  // lastSyncedMs queda en 0 y este efecto no dispara (el fallback de saludo sigue, sin loop).
  useEffect(() => {
    if (!userId) return;
    if (lastSyncedMs === 0) return;
    void loadFor(userId);
  }, [lastSyncedMs, userId, loadFor]);

  const refresh = useCallback(async () => {
    await loadFor(userId);
  }, [userId, loadFor]);

  // Aterrizaje OPTIMISTA del perfil recién guardado: el saludo se actualiza al instante sin esperar el
  // round-trip de sync-down. Bumpeamos loadSeq para que un `loadFor` en vuelo (pre-edición, leyendo el
  // valor viejo del SQLite local) NO pise este valor fresco al resolver. El sync-down posterior
  // reconcilia al mismo valor server-side. Limpia loading/error (el guardado ya tuvo éxito).
  const applyOwnProfile = useCallback((saved: { name: string; phone: string | null }) => {
    loadSeq.current += 1;
    // Marcamos el name esperado: hasta que el sync-down lo traiga al SQLite local, un loadFor reactivo
    // que devuelva otro name se descarta como stale (no revierte el saludo).
    pendingOptimisticNameRef.current = saved.name;
    setNamePhone({ name: saved.name, phone: saved.phone });
    setError(null);
    setLoading(false);
  }, []);

  // El email se compone acá (del session), no es una fuente separada de fetch. El profile es
  // null sin sesión o mientras nunca cargó name/phone (el saludo usa el fallback en ese caso).
  const value = useMemo<ProfileContextValue>(() => {
    const profile: Profile | null =
      userId && namePhone ? { name: namePhone.name, phone: namePhone.phone, email } : null;
    return { profile, loading, error, refresh, applyOwnProfile };
  }, [userId, namePhone, email, loading, error, refresh, applyOwnProfile]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile debe usarse dentro de <ProfileProvider>.');
  return ctx;
}
