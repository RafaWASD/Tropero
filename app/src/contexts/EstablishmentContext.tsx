// EstablishmentContext — establecimiento activo del cliente (spec 01, Fase 4 / T4.1).
//
// Estado (design.md §EstablishmentContext):
//   loading        ← bootstrap, cargando memberships
//   no_establishments ← el usuario no tiene user_roles activos → wizard (R6.5)
//   choosing       ← ≥2 campos, sin uno fijado → "Mis campos" como landing (R6.7)
//   active         ← campo activo fijado (R6.3/R6.4)
//   active_lost    ← el activo dejó de ser válido (R6.10), sin logout (R7.4)
//
// Fuente de datos: supabase-js DIRECTO (PowerSync es Fase 7, diferida). RLS protege
// server-side; el cliente solo ve los campos donde tiene rol activo (R7.2). NUNCA se
// hardcodea establishment_id (CLAUDE.md ppio 6): el set se deriva de auth.uid() vía RLS.
//
// Persistencia (R6.9, REQUERIDO): el campo activo (last_establishment_opened) + un rastro
// corto de visitados se guardan por-usuario (establishment-store) y sobreviven cold-start.
// Alimentan el orden de "Mis campos" (R6.6.1) y los "últimos visitados" del dropdown del
// switch (R6.8.1), y fijan el contexto por defecto al reabrir.
//
// El provider monta DENTRO de la rama authenticated+verificada del AuthGate (_layout.tsx):
// no tiene sentido sin sesión verificada. Lee el user_id del AuthContext para scopear el
// rastro y la carga.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from './AuthContext';
import {
  loadMemberships,
  type MembershipEstablishment,
} from '../services/establishments';
import { loadTrail, recordOpened, saveTrail } from '../services/establishment-store';
import {
  buildRecents,
  detectActiveLost,
  resolveState,
  type EstablishmentState,
} from '../utils/establishment';

export type { EstablishmentState, ActiveLostReason } from '../utils/establishment';

export type EstablishmentContextValue = {
  state: EstablishmentState;
  /**
   * Campos visitados recientes (más reciente primero), derivados del rastro persistido +
   * el set accesible. El dropdown del switch (R6.8.1) y "Mis campos" (R6.6.1) consumen
   * esto. El head suele ser el campo activo; los llamadores excluyen el activo con
   * pickVisited.
   */
  recents: MembershipEstablishment[];
  /** Fija un campo como activo (R6.3) y lo promueve en el rastro de visitados (R6.9). */
  switchEstablishment: (id: string) => Promise<void>;
  /**
   * Re-lee memberships del server (tras crear campo, aceptar invitación, o sync). Si se pasa
   * `preferredId`, se fija como preferido ANTES de resolver sobre el set fresco: tras crear un
   * campo, esto lo deja `active` directo sobre el nuevo (sin un switch posterior que leería un
   * `available` stale → falso active_lost). Como el refresh solo AGREGA campos al set (no
   * quita ninguno), no se dispara active_lost.
   */
  refreshEstablishments: (preferredId?: string) => Promise<void>;
  /**
   * Reconoce el aviso de active_lost (R6.10): sale del estado active_lost re-resolviendo
   * el landing sobre los campos restantes (`available`): ≥2 → choosing; 1 → active; 0 →
   * no_establishments. Lo llama la pantalla de aviso tras que el usuario lo lee. Sin logout.
   */
  acknowledgeActiveLost: () => void;
};

const EstablishmentContext = createContext<EstablishmentContextValue | null>(null);

export function EstablishmentProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  const [state, setState] = useState<EstablishmentState>({ status: 'loading' });
  const [recents, setRecents] = useState<MembershipEstablishment[]>([]);

  // Id que queremos activo: el último abierto (rastro head) o el recién elegido por switch.
  // Vive en ref para que refresh/switch lean el valor más fresco sin re-suscribir efectos.
  const preferredIdRef = useRef<string | null>(null);
  // El campo que estaba activo antes del último refresh (para detectar active_lost).
  const currentIdRef = useRef<string | null>(null);
  // Nombre del campo activo previo (para el aviso de active_lost cuando desaparece del set).
  const currentNameRef = useRef<string | null>(null);
  // Último set de memberships aplicado. switchEstablishment lo lee desde acá (NO del closure
  // de `state`, que puede estar stale por el timing async de setState — bug del falso
  // active_lost al crear campo). Es la fuente de verdad sincrónica del set vigente.
  const availableRef = useRef<MembershipEstablishment[]>([]);
  const trailRef = useRef<string[]>([]);

  // Aplica un set de memberships recién traído: detecta active_lost (R6.10), resuelve el
  // estado (R6.7/R6.4) y actualiza el rastro de recientes. Centraliza la transición para
  // que refresh y switch compartan la misma lógica.
  const applyMemberships = useCallback(
    (available: MembershipEstablishment[]) => {
      // Sincronizamos el set vigente para que switchEstablishment lea de acá (no del closure
      // de `state`, que puede estar stale tras un setState async).
      availableRef.current = available;
      const currentId = currentIdRef.current;
      const lost = detectActiveLost({ currentId, available });

      // Recientes derivados del rastro persistido + el set accesible (descarta inaccesibles).
      const nextRecents = buildRecents(trailRef.current, available);
      setRecents(nextRecents);

      if (lost.lost && currentId) {
        // El activo desapareció del set (rol revocado o campo borrado). Aviso legible +
        // re-ruteo lo decide la pantalla sobre `available` (R6.10). Sin logout (R7.4).
        // No podemos distinguir con certeza desde el cliente; default role_revoked (caso
        // más común: rol removido/revocado por sync — R6.10 (a)/(d)). El copy es legible
        // en ambos. Limpiamos el preferido inválido.
        preferredIdRef.current = null;
        currentIdRef.current = null;
        const lostName = currentNameRef.current ?? 'el campo';
        currentNameRef.current = null;
        setState({
          status: 'active_lost',
          reason: 'role_revoked',
          lostEstablishmentName: lostName,
          available,
        });
        return;
      }

      const resolved = resolveState({ available, preferredId: preferredIdRef.current });
      // Sincronizamos los refs con el resultado para el próximo refresh.
      if (resolved.status === 'active') {
        currentIdRef.current = resolved.current.id;
        currentNameRef.current = resolved.current.name;
        preferredIdRef.current = resolved.current.id;
      } else {
        currentIdRef.current = null;
        currentNameRef.current = null;
      }
      setState(resolved);
    },
    [],
  );

  const refreshEstablishments = useCallback(async (preferredId?: string) => {
    if (!userId) {
      setState({ status: 'no_establishments' });
      return;
    }
    const result = await loadMemberships(userId);
    if (!result.ok) {
      // No tumbamos el estado si ya teníamos uno válido: un fallo de red transitorio no
      // debe expulsar al usuario de su campo. En bootstrap (loading) lo dejamos en
      // no_establishments solo si nunca cargamos (el wizard es recuperable; refrescar
      // reintenta). Mantener el estado previo es más seguro que falsear active_lost.
      if (state.status === 'loading') {
        setState({ status: 'no_establishments' });
      }
      return;
    }
    // Si vino un preferido (ej. el campo recién creado), lo fijamos ANTES de resolver: el set
    // fresco ya lo incluye, así applyMemberships → resolveState lo deja `active` directo.
    if (preferredId) {
      preferredIdRef.current = preferredId;
    }
    applyMemberships(result.establishments);
  }, [userId, applyMemberships, state.status]);

  const switchEstablishment = useCallback(
    async (id: string) => {
      if (!userId) return;
      // Resolvemos sobre el set vigente (cambiar de campo es local, no requiere round-trip,
      // R9.2). Leemos de availableRef (sincrónico) y NO del closure de `state`: el closure
      // puede estar stale por el timing async de setState (fuente del falso active_lost al
      // crear campo). availableRef se actualiza dentro de applyMemberships con el último set.
      const available = availableRef.current;
      // Guard defensivo: sin set sobre el cual decidir, NO falseamos active_lost (sería un
      // falso positivo). Un switch sin campos cargados es un no-op seguro.
      if (available.length === 0) return;
      // Fija el preferido y promueve el campo en el rastro (R6.9): el saliente baja un
      // puesto (sigue en recientes → reaparece como visitado, bug (b) de Raf). Persistimos.
      preferredIdRef.current = id;
      const nextTrail = await recordOpened(userId, id);
      trailRef.current = nextTrail;
      applyMemberships(available);
    },
    [userId, applyMemberships],
  );

  const acknowledgeActiveLost = useCallback(() => {
    if (state.status !== 'active_lost') return;
    // Re-resolvemos sobre los campos restantes (R6.10 → R6.7). preferredIdRef ya fue
    // limpiado al entrar en active_lost, así el landing por cantidad decide.
    const resolved = resolveState({ available: state.available, preferredId: null });
    if (resolved.status === 'active') {
      currentIdRef.current = resolved.current.id;
      currentNameRef.current = resolved.current.name;
      preferredIdRef.current = resolved.current.id;
    }
    setState(resolved);
  }, [state]);

  // Bootstrap: al tener user_id, leemos el rastro persistido (para fijar el preferido por
  // defecto, R6.9) y traemos las memberships. Re-corre si cambia el user (login distinto).
  const bootedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      // Logout / sin sesión: reset a loading (el provider igual desmonta fuera de la rama
      // authenticated, pero por las dudas no dejamos estado stale de otro usuario).
      bootedForUser.current = null;
      preferredIdRef.current = null;
      currentIdRef.current = null;
      currentNameRef.current = null;
      trailRef.current = [];
      setRecents([]);
      setState({ status: 'loading' });
      return;
    }
    if (bootedForUser.current === userId) return;
    bootedForUser.current = userId;

    let active = true;
    (async () => {
      const trail = await loadTrail(userId);
      if (!active) return;
      trailRef.current = trail;
      // El head del rastro es last_establishment_opened (R6.9): preferido por defecto.
      preferredIdRef.current = trail[0] ?? null;
      const result = await loadMemberships(userId);
      if (!active) return;
      if (!result.ok) {
        setState({ status: 'no_establishments' });
        return;
      }
      applyMemberships(result.establishments);
    })();

    return () => {
      active = false;
    };
  }, [userId, applyMemberships]);

  // Poda del rastro persistido: si algún id del rastro ya no es accesible (R6.9), lo
  // sacamos del storage para que no resucite si el usuario recupera otro campo. Best-effort.
  useEffect(() => {
    if (!userId) return;
    const accessible = new Set(recents.map((e) => e.id));
    const pruned = trailRef.current.filter((id) => accessible.has(id));
    if (pruned.length !== trailRef.current.length) {
      trailRef.current = pruned;
      void saveTrail(userId, pruned);
    }
  }, [userId, recents]);

  return (
    <EstablishmentContext.Provider
      value={{
        state,
        recents,
        switchEstablishment,
        refreshEstablishments,
        acknowledgeActiveLost,
      }}
    >
      {children}
    </EstablishmentContext.Provider>
  );
}

export function useEstablishment(): EstablishmentContextValue {
  const ctx = useContext(EstablishmentContext);
  if (!ctx) throw new Error('useEstablishment debe usarse dentro de <EstablishmentProvider>.');
  return ctx;
}
