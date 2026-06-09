// RodeoContext — rodeo activo del establecimiento activo (spec 02 frontend, C1 / T3.1).
//
// Estado (design.md §RodeoContext):
//   loading    ← cargando rodeos del establishment activo (o sin establishment activo aún).
//   no_rodeos  ← el establishment activo tiene 0 rodeos → wizard "Crear rodeo" + bloqueo total
//                de la navegación (R2.6). Estado inicial esperado tras crear un campo (no hay
//                rodeo default autogenerado).
//   active     ← hay ≥1 rodeo; uno está seleccionado (current) + el set disponible (available).
//
// Scoped por el establishment activo de EstablishmentContext (deps PRIMITIVAS: el id del campo
// activo, NO el objeto state — lección miembros.tsx/ProfileContext: un objeto recreado cada
// render dispararía un loop de fetch). Cuando el establishment activo cambia (switch de campo),
// recargamos los rodeos de ese campo.
//
// Auto-select (R2.6 / T3.1): si hay UN solo rodeo activo, queda seleccionado automáticamente.
// Si hay ≥2, se respeta el rodeo activo persistido (rodeo-store, por (usuario, campo)); si el
// persistido ya no existe, se cae al primero. El usuario cambia con switchRodeo.
//
// Fuente de datos: supabase-js DIRECTO vía services/rodeos.ts (PowerSync es C5, diferido — los
// services son swappables). NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6): viene del
// EstablishmentContext, que lo deriva de auth.uid() vía RLS.
//
// Monta DENTRO de EstablishmentProvider (lee el campo activo) y DENTRO de AuthProvider (scope
// del rodeo persistido por usuario). Sin establishment activo, queda en 'loading' y no fetcha.

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
import { useEstablishment } from './EstablishmentContext';
import { fetchRodeos, type Rodeo } from '../services/rodeos';
import { loadActiveRodeo, saveActiveRodeo } from '../services/rodeo-store';
import { getPowerSync } from '../services/powersync/database';

export type RodeoState =
  | { status: 'loading' }
  | { status: 'no_rodeos' }
  | { status: 'active'; current: Rodeo; available: Rodeo[] };

export type RodeoContextValue = {
  state: RodeoState;
  /** Re-lee los rodeos del establishment activo (tras crear/eliminar un rodeo). */
  refreshRodeos: () => Promise<void>;
  /** Fija un rodeo como activo (entre los disponibles) y lo persiste por (usuario, campo). */
  switchRodeo: (rodeoId: string) => Promise<void>;
  /** Error de carga legible, o null. */
  error: string | null;
};

const RodeoContext = createContext<RodeoContextValue | null>(null);

export function RodeoProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();

  // Deps PRIMITIVAS: el id del usuario y el id del campo activo. NO los objetos (evita loops).
  const userId = authState.status === 'authenticated' ? authState.user.id : null;
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const [state, setState] = useState<RodeoState>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);

  // Rodeo que querríamos activo: el persistido o el recién elegido por switch. En ref para que
  // refresh/switch lean el valor fresco sin re-suscribir efectos.
  const preferredIdRef = useRef<string | null>(null);
  // Último set de rodeos aplicado (switchRodeo lo lee sincrónico, no del closure de `state`).
  const availableRef = useRef<Rodeo[]>([]);
  // Guard de secuencia: descarta resultados de una carga vieja si cambió el campo mientras
  // estaba en vuelo (switch rápido de campo).
  const loadSeq = useRef(0);

  // Resuelve el estado a partir de un set de rodeos + el preferido vigente.
  const applyRodeos = useCallback(
    (rodeos: Rodeo[]) => {
      availableRef.current = rodeos;
      if (rodeos.length === 0) {
        preferredIdRef.current = null;
        setState({ status: 'no_rodeos' });
        return;
      }
      const preferred = preferredIdRef.current;
      const match = preferred ? rodeos.find((r) => r.id === preferred) : undefined;
      const current = match ?? rodeos[0];
      preferredIdRef.current = current.id;
      setState({ status: 'active', current, available: rodeos });
    },
    [],
  );

  const load = useCallback(
    async (uid: string | null, estId: string | null) => {
      if (!uid || !estId) {
        // Sin campo activo (loading/choosing/no_establishments del EstablishmentContext): el
        // RodeoContext no tiene sobre qué decidir → loading (el RootGate no usará el estado de
        // rodeo hasta que el establishment esté 'active').
        availableRef.current = [];
        preferredIdRef.current = null;
        setState({ status: 'loading' });
        setError(null);
        return;
      }
      const seq = ++loadSeq.current;
      setError(null);
      // Leemos el rodeo persistido (preferido por defecto) ANTES de traer el set.
      const persisted = await loadActiveRodeo(uid, estId);
      if (seq !== loadSeq.current) return;
      preferredIdRef.current = persisted;

      const result = await fetchRodeos(estId);
      if (seq !== loadSeq.current) return; // cambió el campo mientras cargaba: descartamos.
      if (!result.ok) {
        // Fallo de red al cargar rodeos: no afirmamos no_rodeos (sería un falso bloqueo total).
        // Dejamos loading + error reintentable (el RootGate mantiene splash en loading).
        setError(
          result.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar los rodeos.'
            : 'No pudimos cargar los rodeos del campo.',
        );
        setState({ status: 'loading' });
        return;
      }
      applyRodeos(result.value);
    },
    [applyRodeos],
  );

  // Carga inicial + recarga cuando cambia el usuario o el campo activo (deps PRIMITIVAS).
  useEffect(() => {
    void load(userId, establishmentId);
  }, [userId, establishmentId, load]);

  // Espejo sincrónico de "el contexto está esperando datos" (loading, o active sin error de red ya
  // resuelto): lo lee el listener de sync sin re-suscribirse en cada render. `loading` cubre tanto el
  // arranque como el reintento tras un fallo de red (load setea loading + error en ese caso).
  const isWaitingRef = useRef(false);
  isWaitingRef.current = state.status === 'loading';

  // FIX showstopper (espejo de 1b del EstablishmentContext): re-evaluar cuando el PRIMER sync llega
  // DESPUÉS de que RodeoContext ya leyó el SQLite local vacío. Si el bootstrap leyó rodeos vacíos
  // (first-sync pendiente → fetchRodeos degrada a network → load se queda en `loading`), este listener
  // re-corre `load` cuando el sync baja los datos, así RodeoContext pasa de loading a active/no_rodeos.
  // Sin esto, tras el fix del EstablishmentContext el campo resolvería pero el rodeo quedaría colgado
  // en loading (el RootGate exige est:active Y rodeo resuelto para llegar a home — lo que valida el E2E).
  //
  // ACOTADO: solo en la transición first-sync false→true (var local lastHasSynced) Y solo si el
  // contexto está esperando (isWaitingRef) → no recargamos de más cuando ya hay rodeo activo resuelto.
  useEffect(() => {
    if (!userId || !establishmentId) return;
    const db = getPowerSync();
    let lastHasSynced = db.currentStatus?.hasSynced === true;
    const dispose = db.registerListener({
      statusChanged: (status) => {
        const nowSynced = status?.hasSynced === true;
        if (nowSynced && !lastHasSynced) {
          lastHasSynced = true;
          if (isWaitingRef.current) void load(userId, establishmentId);
        }
      },
    });
    return dispose;
  }, [userId, establishmentId, load]);

  const refreshRodeos = useCallback(async () => {
    await load(userId, establishmentId);
  }, [userId, establishmentId, load]);

  const switchRodeo = useCallback(
    async (rodeoId: string) => {
      const available = availableRef.current;
      const match = available.find((r) => r.id === rodeoId);
      if (!match) return; // switch a un rodeo inexistente: no-op seguro.
      preferredIdRef.current = rodeoId;
      setState({ status: 'active', current: match, available });
      if (userId && establishmentId) {
        await saveActiveRodeo(userId, establishmentId, rodeoId);
      }
    },
    [userId, establishmentId],
  );

  // Persistimos el rodeo activo cuando queda resuelto (auto-select o switch). Best-effort; dep
  // primitiva (current.id) para no re-disparar en cada render.
  const currentId = state.status === 'active' ? state.current.id : null;
  useEffect(() => {
    if (userId && establishmentId && currentId) {
      void saveActiveRodeo(userId, establishmentId, currentId);
    }
  }, [userId, establishmentId, currentId]);

  return (
    <RodeoContext.Provider value={{ state, refreshRodeos, switchRodeo, error }}>
      {children}
    </RodeoContext.Provider>
  );
}

export function useRodeo(): RodeoContextValue {
  const ctx = useContext(RodeoContext);
  if (!ctx) throw new Error('useRodeo debe usarse dentro de <RodeoProvider>.');
  return ctx;
}
