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

import { usePowerSync } from '@powersync/react';

import { useAuth } from './AuthContext';
import { useEstablishment } from './EstablishmentContext';
import { fetchRodeos, type Rodeo } from '../services/rodeos';
import { hasActiveLocalRole } from '../services/establishments';
import { assessDisappearance } from '../utils/establishment';
import { loadActiveRodeo, saveActiveRodeo } from '../services/rodeo-store';

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

/**
 * ¿Dos rodeos son equivalentes para la UI? Compara TODOS los campos del tipo `Rodeo`, con
 * `serviceMonths` elemento a elemento (viene como array nuevo en cada lectura). Conservador a
 * propósito: ante la duda emite el estado nuevo — un guard demasiado agresivo se tragaría el cambio
 * que la feature vino a hacer visible (el rodeo creado/renombrado por un coworker).
 */
function sameRodeo(a: Rodeo, b: Rodeo): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.establishmentId !== b.establishmentId ||
    a.speciesId !== b.speciesId ||
    a.systemId !== b.systemId ||
    a.active !== b.active
  ) {
    return false;
  }
  const sa = a.serviceMonths;
  const sb = b.serviceMonths;
  if (sa === sb) return true;
  if (sa == null || sb == null) return false;
  return sa.length === sb.length && sa.every((m, i) => m === sb[i]);
}

/**
 * spec 20 / R20.11 — guard de equivalencia del estado de rodeo. `RodeoProvider` también está en la
 * cadena raíz y su `value` se recrea en cada render; ahora que `load` corre en CADA avance de sync,
 * sin este guard cada checkpoint re-renderizaría la home entera aunque no cambiara nada.
 */
function sameRodeoState(a: RodeoState, b: RodeoState): boolean {
  if (a === b) return true;
  if (a.status !== b.status) return false;
  if (a.status !== 'active' || b.status !== 'active') return true; // loading/no_rodeos: sin payload
  if (!sameRodeo(a.current, b.current)) return false;
  if (a.available.length !== b.available.length) return false;
  return a.available.every((r, i) => sameRodeo(r, b.available[i]));
}

export function RodeoProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();

  // Deps PRIMITIVAS: el id del usuario y el id del campo activo. NO los objetos (evita loops).
  const userId = authState.status === 'authenticated' ? authState.user.id : null;
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  const [state, setState] = useState<RodeoState>({ status: 'loading' });
  const [error, setError] = useState<string | null>(null);

  // spec 21 (R21.5) — instancia del DB para la watched query imperativa (`db.onChange`). Mismo
  // singleton que `getPowerSync()`, provisto por el `PowerSyncProvider` que envuelve este árbol.
  // Reemplaza el disparador por-sync `lastSyncedMs` (proxy NO determinista, feature 20).
  const db = usePowerSync();

  // Rodeo que querríamos activo: el persistido o el recién elegido por switch. En ref para que
  // refresh/switch lean el valor fresco sin re-suscribir efectos.
  const preferredIdRef = useRef<string | null>(null);
  // Último set de rodeos aplicado (switchRodeo lo lee sincrónico, no del closure de `state`).
  const availableRef = useRef<Rodeo[]>([]);
  // Guards de carrera de `load`. Son DOS cosas distintas, y confundirlas costó caro (spec 20):
  //   · `targetRef` — para QUÉ (usuario, campo) es la carga en vuelo. Si cambió el campo mientras
  //     cargaba (switch rápido), el resultado viejo se DESCARTA. Ése era el propósito original.
  //   · `lastAppliedSeq` — ORDEN, no cancelación: si dos cargas del MISMO campo se solapan, no
  //     dejamos que la que termina tarde pise a la más nueva.
  //
  // ⚠️ WHY (regresión encontrada en la autorrevisión, con el E2E como testigo): antes había un único
  // `loadSeq` monotónico y CUALQUIER carga posterior cancelaba a la anterior. Con el latch eso era
  // inocuo (`load` corría una vez); siendo REACTIVO, los checkpoints llegan cada ~1 s y cada uno
  // cancelaba al anterior → si una carga tardaba más que el intervalo entre checkpoints, NINGUNA
  // llegaba a aplicarse jamás (starvation) y el rodeo renombrado por un coworker no aparecía nunca.
  // El fix es distinguir "cambió el objetivo" (cancelar) de "hay otra carga del mismo objetivo"
  // (no cancelar, solo ordenar).
  const loadSeq = useRef(0);
  const lastAppliedSeq = useRef(0);
  const targetRef = useRef<string | null>(null);
  // Espejo sincrónico del estado para las ramas async de `load` (spec 20): distingue "bootstrap"
  // (todavía en loading) de "ya resuelto", sin re-crear `load` en cada render.
  const statusRef = useRef<RodeoState['status']>('loading');
  statusRef.current = state.status;
  // Campo para el cual el estado vigente fue resuelto (spec 20): junto con `statusRef` distingue "hay
  // un estado `active` que proteger PARA ESTE campo" de "todavía no resolvimos / acabamos de cambiar
  // de campo". Sin esto, la guarda de R20.18 se comería el wizard de rodeo del campo recién creado.
  const resolvedForEstRef = useRef<string | null>(null);

  // Resuelve el estado a partir de un set de rodeos + el preferido vigente.
  //
  // spec 20 / R20.19: siendo la lectura REACTIVA, esto corre en cada avance de sync. La preservación
  // del preferido (`match ?? rodeos[0]`) es lo que garantiza que un re-read con el rodeo activo
  // todavía presente NO cambie la selección bajo los pies del operario — p. ej. cuando un coworker
  // crea o renombra OTRO rodeo del campo. Ya estaba así; se conserva a propósito, no por inercia.
  const applyRodeos = useCallback(
    (rodeos: Rodeo[]) => {
      availableRef.current = rodeos;
      if (rodeos.length === 0) {
        preferredIdRef.current = null;
        setState((prev) => (prev.status === 'no_rodeos' ? prev : { status: 'no_rodeos' }));
        return;
      }
      const preferred = preferredIdRef.current;
      const match = preferred ? rodeos.find((r) => r.id === preferred) : undefined;
      const current = match ?? rodeos[0];
      preferredIdRef.current = current.id;
      const next: RodeoState = { status: 'active', current, available: rodeos };
      // R20.11 — un checkpoint que no cambia nada es un no-op observable (devolver `prev` hace que
      // React descarte el update en vez de re-renderizar toda la home).
      setState((prev) => (sameRodeoState(prev, next) ? prev : next));
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
        resolvedForEstRef.current = null;
        targetRef.current = null;
        setState({ status: 'loading' });
        setError(null);
        return;
      }
      const target = `${uid}|${estId}`;
      targetRef.current = target;
      const seq = ++loadSeq.current;
      setError(null);
      // Leemos el rodeo persistido (preferido por defecto) ANTES de traer el set.
      const persisted = await loadActiveRodeo(uid, estId);
      if (targetRef.current !== target) return; // cambió el usuario/campo: descartamos.
      preferredIdRef.current = persisted;

      const result = await fetchRodeos(estId);
      if (targetRef.current !== target) return; // cambió el campo mientras cargaba: descartamos.
      if (!result.ok) {
        // Fallo de red al cargar rodeos: no afirmamos no_rodeos (sería un falso bloqueo total).
        setError(
          result.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar los rodeos.'
            : 'No pudimos cargar los rodeos del campo.',
        );
        // spec 20 / R20.10 — con el latch, este `setState({status:'loading'})` solo podía ocurrir en
        // el bootstrap. Siendo la lectura REACTIVA, un fallo transitorio post-arranque mandaría la
        // app ENTERA al splash (el RootGate mantiene splash mientras rodeo.status === 'loading') y
        // encima anularía el diferimiento de D1. Con un estado ya resuelto se conserva el estado y
        // se setea solo el `error` (reintentable). El bootstrap queda idéntico a hoy.
        if (statusRef.current === 'loading') setState({ status: 'loading' });
        return;
      }

      // spec 20 / R20.18 — 🔴 LA GUARDA QUE SOSTIENE D1 (design §8 riesgo 7). Al revocarse el acceso,
      // PowerSync borra también el bucket de rodeos → `fetchRodeos` devuelve [] con el sync completo →
      // sin esta guarda concluiríamos `no_rodeos`, y el RootGate haría `replace('/crear-rodeo')` SOBRE
      // LA PANTALLA DE MANIOBRA: el operario terminaría pateado igual, aunque EstablishmentContext
      // hubiera diferido bien. Un set vacío solo concluye `no_rodeos` con EVIDENCIA AFIRMATIVA de que
      // el rol local en el campo activo sigue activo; con 'absent_or_inactive' (revocación) o
      // 'unknown' (ilegible → fail-safe, R20.30) se conserva el estado y se re-evalúa al próximo sync.
      //
      // ⚠️ ACOTADA A "PROTEGER UN ESTADO YA RESUELTO PARA ESTE MISMO CAMPO" (desvío razonado de la
      // letra de R20.18; ver progress/impl_20-reactividad-sync.md). Aplicarla también en el BOOTSTRAP
      // rompía un camino real: al crear un campo, `applyCreatedEstablishment` lo deja activo de forma
      // OPTIMISTA, y su fila de `user_roles` (la crea el trigger 0011 server-side) todavía no bajó al
      // SQLite local → la evidencia diría 'absent_or_inactive' → NO concluiríamos `no_rodeos` → el
      // RootGate quedaría en SPLASH en vez de mostrar el wizard "Creá tu primer rodeo" (R2.6). La
      // guarda existe para que un estado `active` YA resuelto no se tumbe a `no_rodeos`; en un
      // arranque (o al cambiar de campo) no hay estado que proteger y el comportamiento as-built —
      // set vacío ⇒ no_rodeos— se conserva idéntico. El escenario de riesgo 7 SIEMPRE ocurre con un
      // `active` resuelto sobre el mismo campo (el operario está en su maniobra), así que queda cubierto.
      const protectingResolved =
        result.value.length === 0 &&
        statusRef.current === 'active' &&
        resolvedForEstRef.current === estId;
      if (protectingResolved) {
        const evidence = await hasActiveLocalRole(uid, estId);
        if (targetRef.current !== target) return;
        // spec 20 / R20.18 — VEREDICTO COMPARTIDO con EstablishmentContext: un solo camino de decisión
        // sobre la evidencia afirmativa (`assessDisappearance`), en vez de un `evidence !== 'active'`
        // inline que divergía. Para ESTE contexto, el establecimiento sigue "presente" sii su rol local
        // está afirmativamente activo (`stillPresent = evidence === 'active'`); si NO, `assessDisappearance`
        // distingue la REVOCACIÓN ('confirmed' → conservar estado, protege D1 / riesgo 7) de la lectura
        // ILEGIBLE ('inconclusive' → fail-safe R20.30 → conservar). Solo un establecimiento AFIRMATIVAMENTE
        // presente ('present') deja que un set de rodeos vacío concluya `no_rodeos`. Behavior-idéntico al
        // `evidence !== 'active'` previo (active→present→concluye; absent→confirmed→conserva;
        // unknown→inconclusive→conserva), pero comparte el predicado en vez de reimplementarlo.
        const verdict = assessDisappearance({
          hadValue: true,
          stillPresent: evidence === 'active',
          roleEvidence: evidence,
        });
        if (verdict !== 'present') return;
      }

      // Orden (no cancelación): si otra carga MÁS NUEVA del mismo campo ya aplicó, no la pisamos.
      if (seq < lastAppliedSeq.current) return;
      lastAppliedSeq.current = seq;
      resolvedForEstRef.current = estId;
      applyRodeos(result.value);
    },
    [applyRodeos],
  );

  // Carga inicial + recarga cuando cambia el usuario o el campo activo (deps PRIMITIVAS).
  useEffect(() => {
    void load(userId, establishmentId);
  }, [userId, establishmentId, load]);

  // spec 21 (R21.2/R21.4/R21.5/R21.9/R21.11) — WATCHED QUERY imperativa. Reemplaza el disparador
  // por-sync de la feature 20 (`lastSyncedMs`) por `db.onChange` sobre las tablas que respaldan los
  // rodeos del campo activo. El onChange re-corre `load` EXISTENTE (fetchRodeos + guarda R20.18 +
  // applyRodeos) SIN tocar su lógica de veredicto: solo cambia el disparador (ADR-030).
  //
  // Por qué observar AMBAS tablas:
  //   · `rodeos` — cubre alta / borrado / rename de un rodeo por un coworker (INSERT/DELETE/UPDATE).
  //   · `user_roles` — 🔴 sostiene la guarda que hace posible D1 (R20.18, design §8 riesgo 7): al
  //     revocarse el acceso PowerSync borra el bucket de rodeos → `fetchRodeos = []` → sin la evidencia
  //     afirmativa concluiríamos `no_rodeos` → `/crear-rodeo` SOBRE la maniobra, pateando al operario.
  //     Observar `user_roles` re-evalúa apenas baje el rol, aunque la remoción del bucket de rodeos
  //     llegue en OTRO checkpoint que la baja del rol.
  //
  // `triggerImmediate` es false (default) → NO dispara al registrarse: la CARGA INICIAL y la recarga al
  // hacer switch de campo las sigue haciendo el efecto SEPARADO `useEffect([userId, establishmentId,
  // load])` (arriba), intacto (R21.35). El `dispose` devuelto se llama en el cleanup al desmontar o al
  // cambiar `userId`/`establishmentId` (sin fuga de listeners ni doble suscripción). `load` está
  // endurecido para el disparo frecuente (`targetRef` descarta si cambió el objetivo; `lastAppliedSeq`
  // ordena sin cancelar — el fix anti-starvation de la 20), así que dos disparos solapados no se pisan.
  useEffect(() => {
    if (!userId || !establishmentId) return;
    const dispose = db.onChange(
      { onChange: () => { void load(userId, establishmentId); } },
      { tables: ['rodeos', 'user_roles'] },
    );
    return () => dispose();
  }, [userId, establishmentId, load, db]);

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
