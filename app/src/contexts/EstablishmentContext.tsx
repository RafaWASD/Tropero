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

import { useStatus } from '@powersync/react';
import { useSegments } from 'expo-router';

import { useAuth } from './AuthContext';
import {
  hasActiveLocalRole,
  loadMemberships,
  type LoadMembershipsResult,
  type MembershipEstablishment,
} from '../services/establishments';
import { loadTrail, recordOpened, saveTrail } from '../services/establishment-store';
import { isFirstSyncPending, waitForUsableSync } from '../services/powersync/first-sync';
import {
  assessDisappearance,
  buildRecents,
  detectActiveLost,
  isManeuverRouteSegment,
  resolveState,
  sameEstablishmentList,
  sameResolvedEstablishmentState,
  shouldEmitDeferredRevocation,
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
  /**
   * Aterriza un campo RECIÉN CREADO de forma OPTIMISTA (spec 15, residual #1). `createEstablishment`
   * es ONLINE (write a Supabase), pero la lectura del set (`loadMemberships`) viene del SQLite local
   * vía PowerSync — y el campo recién creado todavía NO bajó por el sync → un `refreshEstablishments`
   * inmediato leería un set SIN el campo nuevo → no aterrizaría en su home (onboarding fantasma).
   *
   * Solución: INYECTAMOS el campo (que `createEstablishment` ya devuelve) en `available` + lo fijamos
   * activo AL INSTANTE (la app aterriza en su home / bloqueo de rodeo sin esperar el round-trip). Lo
   * marcamos "pending" y lo MERGEAMOS en los resultados de `loadMemberships` hasta que el set
   * sincronizado lo incluya (anti-flicker: un `loadMemberships` pre-sync no lo borra). Cuando el sync
   * lo trae (mismo id), se reconcilia y se limpia la marca pending.
   */
  applyCreatedEstablishment: (field: MembershipEstablishment) => void;
};

const EstablishmentContext = createContext<EstablishmentContextValue | null>(null);

export function EstablishmentProvider({ children }: { children: ReactNode }) {
  const { state: authState } = useAuth();
  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  const [state, setState] = useState<EstablishmentState>({ status: 'loading' });
  const [recents, setRecents] = useState<MembershipEstablishment[]>([]);

  // spec 20 — señal de sync del patrón canónico (ProfileContext.tsx / animales.tsx / index.tsx /
  // useGroupView / useManeuverGating / mas.tsx). La dep del efecto es el PRIMITIVO en ms.
  const syncStatus = useStatus();
  const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;

  // spec 20 / D1 — ¿hay maniobra en curso? Señal CLIENT-SIDE (la ruta activa), no la tabla
  // `sessions`: ese bucket es justo el que PowerSync borra al revocar el acceso, así que la fila de
  // la sesión desaparece del SQLite local en el instante exacto en que habría que consultarla y la
  // guarda concluiría "no hay maniobra" → patearía al operario (design §5.2). `useSegments()` de
  // expo-router 56 se implementa con useSyncExternalStore sobre un store GLOBAL, así que funciona
  // acá aunque el provider esté fuera del <Stack>.
  const segments = useSegments();
  const inManeuverRoute = isManeuverRouteSegment(segments);

  // Id que queremos activo: el último abierto (rastro head) o el recién elegido por switch.
  // Vive en ref para que refresh/switch lean el valor más fresco sin re-suscribir efectos.
  const preferredIdRef = useRef<string | null>(null);
  // El campo que estaba activo antes del último refresh: alimenta la detección de active_lost, el
  // nombre del aviso y —durante el diferimiento de D1— el merge de R20.33. Es UN SOLO ref (antes
  // eran `currentIdRef` + `currentNameRef`): el id y el nombre no pueden divergir por construcción,
  // y el objeto completo es lo que hace falta para volver a mergear el campo en `available`.
  const currentFieldRef = useRef<MembershipEstablishment | null>(null);
  // Último set de memberships aplicado. switchEstablishment lo lee desde acá (NO del closure
  // de `state`, que puede estar stale por el timing async de setState — bug del falso
  // active_lost al crear campo). Es la fuente de verdad sincrónica del set vigente.
  const availableRef = useRef<MembershipEstablishment[]>([]);
  const trailRef = useRef<string[]>([]);
  // Campos recién creados OPTIMISTAS (residual #1): id → field. Se MERGEAN en `available` hasta que
  // el set sincronizado los incluya (el sync los baja con el mismo id). Mientras estén acá, un
  // `loadMemberships` pre-sync NO los borra (anti-flicker). Se purgan cuando el synced ya los trae
  // (reconciliación) o si el sync no llegó tras el timeout (createEstablishment es online → llega).
  const pendingCreatedRef = useRef<Map<string, MembershipEstablishment>>(new Map());
  // spec 20 / D1 — revocación DETECTADA pero DIFERIDA porque hay una maniobra en curso. Vive SOLO
  // en memoria (R20.25): un arranque en frío re-evalúa sin diferimiento. Mientras esté seteado, el
  // campo revocado se conserva en `available` (R20.33) — es el gemelo inverso de pendingCreatedRef.
  const pendingRevocationRef = useRef<MembershipEstablishment | null>(null);
  // Espejos sincrónicos para las ramas async (que no pueden leer el closure del render actual).
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const inManeuverRouteRef = useRef(inManeuverRoute);
  inManeuverRouteRef.current = inManeuverRoute;
  // R20.37 — la evidencia ilegible se registra en la TRANSICIÓN a ilegible, no en cada checkpoint
  // (higiene de log). NO es un contador y NO participa del veredicto.
  const unreadableLoggedRef = useRef(false);

  // Cola de la aplicación de un set: refs + recientes + resolveState + setState GUARDADO. La
  // comparten el camino normal (applyMemberships sin pérdida) y el diferimiento de D1.
  const finishResolve = useCallback((available: MembershipEstablishment[]) => {
    availableRef.current = available;

    // Recientes derivados del rastro persistido + el set accesible (descarta inaccesibles).
    const nextRecents = buildRecents(trailRef.current, available);
    setRecents((prev) => (sameEstablishmentList(prev, nextRecents) ? prev : nextRecents));

    const resolved = resolveState({ available, preferredId: preferredIdRef.current });
    // Sincronizamos los refs con el resultado para el próximo refresh.
    if (resolved.status === 'active') {
      currentFieldRef.current = resolved.current;
      preferredIdRef.current = resolved.current.id;
    } else {
      currentFieldRef.current = null;
    }
    // spec 20 / R20.11 — GUARD DE EQUIVALENCIA. Este provider está en la RAÍZ del árbol y su
    // `value` se recrea en cada render; ahora que re-leemos en CADA avance de sync, sin este guard
    // cada checkpoint re-renderizaría la app entera. Devolver `prev` hace que React descarte el
    // update: un checkpoint que no cambia nada es un no-op observable.
    setState((prev) => (sameResolvedEstablishmentState(prev, resolved) ? prev : resolved));
  }, []);

  // Emite active_lost (R6.10): aviso legible + re-ruteo que decide la pantalla sobre `available`.
  // Sin logout (R7.4). Limpia el preferido inválido y el pendiente diferido.
  const emitActiveLost = useCallback(
    (lostField: MembershipEstablishment, available: MembershipEstablishment[]) => {
      preferredIdRef.current = null;
      currentFieldRef.current = null;
      pendingRevocationRef.current = null;
      availableRef.current = available;

      const nextRecents = buildRecents(trailRef.current, available);
      setRecents((prev) => (sameEstablishmentList(prev, nextRecents) ? prev : nextRecents));

      // El contexto siempre emite 'role_revoked' (R20.29): las dos causas —rol revocado y campo
      // borrado— escriben EXACTAMENTE el mismo par de columnas (`active = false` + `deactivated_at`),
      // así que son indistinguibles en la firma local (design §6.1). La rama 'establishment_deleted'
      // del tipo queda declarada pero HOY NO SE PRODUCE; el copy de campo-perdido.tsx dice la verdad
      // para ambas causas en vez de afirmar una sola.
      const next: EstablishmentState = {
        status: 'active_lost',
        reason: 'role_revoked',
        lostEstablishmentName: lostField.name,
        available,
      };
      setState((prev) => (sameResolvedEstablishmentState(prev, next) ? prev : next));
    },
    [],
  );

  // R20.37 — visibilidad mínima de la evidencia ILEGIBLE (limitación conocida y aceptada, Gate 1
  // MED-2: sin contador ni piso). Loguea SOLO el id del establecimiento + la clase de error; NUNCA
  // datos de campo ni PII (misma regla dura que "NUNCA se loguea opData", connector.ts). La clase es
  // invariante acá: con emptyIsSyncing:false la única falla posible es que la lectura local tire
  // (kind 'unknown'), "sin fila" es un resultado de negocio. Hook natural para la feature 17.
  const warnUnreadableEvidence = useCallback((establishmentId: string) => {
    if (unreadableLoggedRef.current) return;
    unreadableLoggedRef.current = true;
    // eslint-disable-next-line no-console
    console.warn('[establecimiento] evidencia de rol ilegible: no se verifica la revocación', {
      establishmentId,
      error: 'local_read_failed',
    });
  }, []);

  // spec 20 / E1 — VEREDICTO por EVIDENCIA AFIRMATIVA. Corre SOLO cuando el campo activo no aparece
  // en el set recién leído (R20.32): el camino feliz no gana ni una query. Async por la lectura
  // local del rol; hasta tener veredicto NO se cambia de estado (la ausencia nunca decide sola).
  const confirmDisappearance = useCallback(
    async (lostField: MembershipEstablishment, freshAvailable: MembershipEstablishment[]) => {
      const uid = userIdRef.current;
      if (!uid) return;
      const evidence = await hasActiveLocalRole(uid, lostField.id);
      // Carrera (la rama es async): descartamos el resultado si mientras estaba en vuelo cambió el
      // usuario o cambió el campo activo — ésas son las dos condiciones que invalidan el veredicto.
      //
      // ⚠️ WHY sin contador de secuencia (a diferencia del patrón loadSeq): un guard monotónico acá
      // CANCELARÍA la evaluación anterior en cada checkpoint, y como ahora los checkpoints llegan
      // cada ~1 s, una lectura más lenta que ese intervalo nunca llegaría a concluir nada
      // (starvation). Dos evaluaciones concurrentes del MISMO campo son inofensivas: leen la misma
      // fila local y llegan al mismo veredicto; emitir dos veces es idempotente (guard de
      // equivalencia) y setear dos veces el mismo pendiente también.
      if (userIdRef.current !== uid) return;
      if (currentFieldRef.current?.id !== lostField.id) return;

      const verdict = assessDisappearance({
        hadValue: true,
        stillPresent: false,
        roleEvidence: evidence,
      });

      if (verdict !== 'confirmed') {
        // R20.15 / R20.30 — inconsistencia transitoria (el rol local sigue activo → hay sync en
        // vuelo) o evidencia ilegible: NO cambiamos de estado. El próximo avance de sync re-evalúa
        // solo; no hay timer, ni ref de sospecha, ni contador (design §9.2).
        if (evidence === 'unknown') warnUnreadableEvidence(lostField.id);
        else unreadableLoggedRef.current = false;
        return;
      }
      unreadableLoggedRef.current = false;

      if (inManeuverRouteRef.current) {
        // D1 / D1.1 — hay maniobra en curso: se difiere la NAVEGACIÓN y el AVISO (nunca se saca al
        // operario de la manga por una decisión administrativa tomada en otro dispositivo). Esta
        // feature NO promete que los datos de la maniobra sobrevivan (eso es E2, fuera por D3), ni
        // que el diferimiento sobreviva a la caída de la sesión (D1.2: en una remoción de miembro
        // `remove_member` revoca la sesión → el bounce a login lo decide auth, por encima de acá).
        pendingRevocationRef.current = lostField;
        // R20.33 — el campo revocado se CONSERVA en `available` mientras dure el diferimiento, en
        // una sola fuente (ref + estado): así se preserva la invariante "el activo pertenece al set"
        // y `switchEstablishment` (que lee del ref) no queda en no-op silencioso.
        finishResolve(
          freshAvailable.some((e) => e.id === lostField.id)
            ? freshAvailable
            : [...freshAvailable, lostField],
        );
        return;
      }

      // R20.24 — fuera del flujo de maniobra: se aplica de inmediato.
      emitActiveLost(lostField, freshAvailable);
    },
    [emitActiveLost, finishResolve, warnUnreadableEvidence],
  );

  // Aplica un set de memberships recién traído: detecta active_lost (R6.10), resuelve el
  // estado (R6.7/R6.4) y actualiza el rastro de recientes. Centraliza la transición para
  // que refresh y switch compartan la misma lógica.
  const applyMemberships = useCallback(
    (rawAvailable: MembershipEstablishment[]) => {
      // Residual #1 — reconciliación + merge de los campos recién creados optimistas:
      //   1. RECONCILIAR: cualquier pending-created cuyo id ya esté en el set sincronizado se purga
      //      del overlay (el sync lo trajo → ya no hace falta el optimista; evita duplicado y deja
      //      de mergear). Esto cierra el ciclo de vida del optimista sin dejar marca pegada.
      //   2. MERGEAR: los pending-created que el synced AÚN no incluye se agregan al set (anti-flicker:
      //      un loadMemberships pre-sync no borra el campo nuevo de la home).
      const syncedIds = new Set(rawAvailable.map((e) => e.id));
      for (const id of [...pendingCreatedRef.current.keys()]) {
        if (syncedIds.has(id)) pendingCreatedRef.current.delete(id);
      }
      const merged =
        pendingCreatedRef.current.size > 0
          ? [...rawAvailable, ...[...pendingCreatedRef.current.values()].filter((e) => !syncedIds.has(e.id))]
          : rawAvailable;

      // spec 20 / R20.33 (Gate 1 L1) — DIFERIMIENTO de D1: mientras haya una revocación diferida
      // pendiente, el campo revocado se CONSERVA en el set. Es el gemelo INVERSO de pendingCreatedRef
      // (dos líneas más arriba): aquel mergea un campo que el sync todavía NO trajo; éste, uno que el
      // sync YA se llevó. Sin esto, `state.available` (viejo, con el campo) y `availableRef.current`
      // (fresco, sin él) divergen, y como switchEstablishment lee del REF, el usuario que intenta
      // cambiar de campo durante la ventana dispara un no-op silencioso.
      const pendingRevocation = pendingRevocationRef.current;
      const available =
        pendingRevocation && !merged.some((e) => e.id === pendingRevocation.id)
          ? [...merged, pendingRevocation]
          : merged;

      const currentField = currentFieldRef.current;
      const lost = detectActiveLost({ currentId: currentField?.id ?? null, available });

      if (lost.lost && currentField) {
        // El activo desapareció del set. spec 20 / R20.13: eso NO alcanza para concluir revocación
        // (ni con set vacío ni con set poblado). Consultamos la EVIDENCIA AFIRMATIVA —y solo acá
        // (R20.32)— y hasta tener veredicto NO tocamos el estado, ni los recientes, NI `availableRef`.
        //
        // ⚠️ Que `availableRef` NO se toque acá es deliberado (R20.33): la rama es async, y si dejáramos
        // el ref con el set fresco (sin el campo activo) mientras `state` todavía lo tiene, habría una
        // ventana —chica pero real— en la que ref y estado DIVERGEN, que es justo el bug que L1 marcó.
        // Lo actualiza el camino que resuelva: `finishResolve` (diferimiento) o `emitActiveLost`.
        void confirmDisappearance(currentField, available);
        return;
      }

      // Sincronizamos el set vigente para que switchEstablishment lea de acá (no del closure
      // de `state`, que puede estar stale tras un setState async). Lo hace `finishResolve`.
      finishResolve(available);
    },
    [confirmDisappearance, finishResolve],
  );

  // Aplica el RESULTADO de loadMemberships (no solo el set): centraliza la regla de error para que
  // bootstrap + refreshEstablishments + el listener de sync la compartan (1c del fix). REGLA CLAVE:
  // un fallo `network` MIENTRAS el primer sync sigue pendiente (isFirstSyncPending) NO es genuino —
  // es "el SQLite local todavía no se pobló" (runLocalQuery degrada vacío+!hasSynced a network). En
  // ese caso NO afirmamos no_establishments (sería el onboarding fantasma); mantenemos el estado
  // previo (loading en bootstrap) y el efecto reactivo de sync (spec 20) re-resolverá cuando baje.
  // Solo afirmamos no_establishments si el fallo es genuino (first-sync YA completó, o no es network).
  const applyMembershipsResult = useCallback(
    (result: LoadMembershipsResult) => {
      if (result.ok) {
        applyMemberships(result.establishments);
        return;
      }
      const syncPending = result.error.kind === 'network' && isFirstSyncPending();
      if (syncPending) {
        // Sync en vuelo: NO afirmamos nada. Si estábamos en loading, nos quedamos en loading (el
        // RootGate mantiene el splash); si ya teníamos un estado válido (active/choosing), lo
        // preservamos (un refresh reactivo durante una carrera no debe regresar a onboarding).
        setState((prev) => (prev.status === 'loading' ? { status: 'loading' } : prev));
        return;
      }
      // Fallo genuino. No tumbamos un estado válido por un network transitorio post-sync: solo en
      // bootstrap (loading) caemos a no_establishments (el wizard es recuperable; refrescar reintenta).
      setState((prev) => (prev.status === 'loading' ? { status: 'no_establishments' } : prev));
    },
    [applyMemberships],
  );

  const refreshEstablishments = useCallback(async (preferredId?: string) => {
    if (!userId) {
      setState({ status: 'no_establishments' });
      return;
    }
    // Si vino un preferido (ej. el campo recién creado), lo fijamos ANTES de resolver: el set
    // fresco ya lo incluye, así applyMemberships → resolveState lo deja `active` directo.
    if (preferredId) {
      preferredIdRef.current = preferredId;
    }
    const result = await loadMemberships(userId);
    applyMembershipsResult(result);
  }, [userId, applyMembershipsResult]);

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
      // spec 20 / R20.34 — si había una revocación diferida y el usuario se cambia a OTRO campo, el
      // pendiente se DESCARTA sin emitir aviso: ya no está parado sobre el campo revocado, así que no
      // hay nada que avisarle. El merge de R20.33 está atado a este ref → se apaga en el mismo tick.
      const pending = pendingRevocationRef.current;
      const discardedPending = pending !== null && pending.id !== id;
      if (discardedPending) pendingRevocationRef.current = null;
      // Fija el preferido y promueve el campo en el rastro (R6.9): el saliente baja un
      // puesto (sigue en recientes → reaparece como visitado, bug (b) de Raf). Persistimos.
      preferredIdRef.current = id;
      const nextTrail = await recordOpened(userId, id);
      trailRef.current = nextTrail;
      // El set que pasamos SÍ incluye todavía el campo revocado (venía mergeado): así el switch
      // resuelve sobre el destino con normalidad en vez de leer una desaparición y volver a diferir.
      applyMemberships(available);
      // Y recién ahora re-leemos el set fresco, para que el campo revocado salga de `available` en el
      // mismo ciclo (sin esperar al próximo checkpoint). Con el activo apuntando ya al destino, su
      // ausencia no vuelve a disparar detectActiveLost sobre el revocado.
      if (discardedPending) void refreshEstablishments();
    },
    [userId, applyMemberships, refreshEstablishments],
  );

  const acknowledgeActiveLost = useCallback(() => {
    if (state.status !== 'active_lost') return;
    // Re-resolvemos sobre los campos restantes (R6.10 → R6.7). preferredIdRef ya fue
    // limpiado al entrar en active_lost, así el landing por cantidad decide.
    const resolved = resolveState({ available: state.available, preferredId: null });
    if (resolved.status === 'active') {
      currentFieldRef.current = resolved.current;
      preferredIdRef.current = resolved.current.id;
    }
    setState(resolved);
  }, [state]);

  // Residual #1 — aterrizaje OPTIMISTA del campo recién creado. `createEstablishment` (online) ya
  // devolvió el campo; lo inyectamos en `available` + lo fijamos activo AL INSTANTE, sin esperar a
  // que el sync lo baje (un loadMemberships del SQLite local todavía no lo ve → onboarding fantasma).
  const applyCreatedEstablishment = useCallback(
    (field: MembershipEstablishment) => {
      // Lo registramos como pending-created: se mergeará en cada loadMemberships hasta que el set
      // sincronizado lo incluya (anti-flicker). Se purga en applyMemberships cuando el synced lo trae.
      pendingCreatedRef.current.set(field.id, field);
      // Lo fijamos como preferido → resolveState lo deja `active` directo (R6.3).
      preferredIdRef.current = field.id;
      // Aplicamos sobre el set vigente; applyMemberships mergea el pending-created → active inmediato.
      applyMemberships(availableRef.current);
      // Disparamos un refresh en segundo plano: cuando el sync baje el campo real (mismo id), el
      // loadMemberships lo reconcilia (purga el optimista) sin que el usuario espere. El listener
      // efecto reactivo de sync (spec 20) también lo cubre si el refresh corre antes del sync-down.
      void refreshEstablishments(field.id);
    },
    [applyMemberships, refreshEstablishments],
  );

  // Bootstrap: al tener user_id, leemos el rastro persistido (para fijar el preferido por
  // defecto, R6.9) y traemos las memberships. Re-corre si cambia el user (login distinto).
  const bootedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      // Logout / sin sesión: reset a loading (el provider igual desmonta fuera de la rama
      // authenticated, pero por las dudas no dejamos estado stale de otro usuario).
      bootedForUser.current = null;
      preferredIdRef.current = null;
      currentFieldRef.current = null;
      trailRef.current = [];
      pendingCreatedRef.current.clear();
      // El diferimiento vive SOLO en memoria y SOLO para esta sesión (R20.25/R20.36): si la sesión
      // cae, el pendiente se descarta y manda el flujo de auth, sin aviso de campo perdido.
      pendingRevocationRef.current = null;
      unreadableLoggedRef.current = false;
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
      // FIX showstopper: ANTES de leer memberships (SQLite local), esperamos a que haya datos USABLES
      // —sync persistido restaurado de disco ('cached', offline/reload, AL INSTANTE), o first-sync
      // completado ('synced'), o timeout (degradación). Sin esto, leíamos el SQLite vacío y caíamos a
      // no_establishments = onboarding fantasma. waitForUsableSync NO cuelga offline ('cached' inmediato).
      await waitForUsableSync();
      if (!active) return;
      const result = await loadMemberships(userId);
      if (!active) return;
      // applyMembershipsResult respeta "network && first-sync pendiente" → se queda en loading (NO
      // no_establishments); el efecto reactivo de sync (spec 20) re-resuelve cuando el sync llega tarde.
      applyMembershipsResult(result);
    })();

    return () => {
      active = false;
    };
  }, [userId, applyMembershipsResult]);

  // spec 20 (R20.1/R20.4/R20.17) — RE-LECTURA REACTIVA en CADA avance de sync.
  //
  // Lo que había acá era un `registerListener({ statusChanged })` con un latch de UN SOLO DISPARO
  // (`lastHasSynced` nunca volvía a false): tras el primer sync, TODO statusChanged posterior era
  // no-op. Por eso un campo creado server-side no aparecía con la app viva, online y conectada — la
  // fila estaba en el SQLite local todo el tiempo, pero nadie la volvía a leer. El comentario que
  // acompañaba al latch afirmaba que la reactividad ante cambios de coworker "la cubre el
  // useFocusEffect / refresh manual existente de las pantallas": era FALSO —los 5 llamadores de
  // `refreshEstablishments` son todos post-acción del propio usuario, ninguno es un useFocusEffect—
  // y se borra junto con el código que describía.
  //
  // Patrón canónico del repo (ProfileContext.tsx, animales.tsx, (tabs)/index.tsx, useGroupView.ts,
  // useManeuverGating.ts, mas.tsx): `useStatus()` + `lastSyncedAt.getTime()` como dep PRIMITIVA.
  //   · Re-dispara en CADA avance (no una sola vez) → es todo el fix.
  //   · Dep primitiva (number) estable entre statuses iguales → sin loop (E3).
  //   · Guardado en 0 → offline puro y arranque intactos (E4/R20.7). El SDK documenta que
  //     `lastSyncedAt` se resetea ante un reinicio del servicio: si vuelve a 0, este efecto
  //     simplemente no corre y el estado ya resuelto no se toca (R20.8).
  //
  // No hace falta distinguir el origen de la re-lectura ('sync' vs 'user'): con evidencia
  // afirmativa la regla es la misma para todos los disparadores (R20.17), así que
  // `refreshEstablishments` NO cambia de firma. Sus 5 llamadores PRE-EXISTENTES quedan intactos
  // (editar-campo.tsx, invite.tsx, mas.tsx ×2, y el interno de applyCreatedEstablishment). Feature 20
  // agrega DOS invocaciones internas nuevas —ambas sin tocar la firma—: este efecto reactivo de sync
  // (R20.1) y el refresh post-switch de switchEstablishment cuando se descarta un pendiente diferido
  // (R20.34, unas líneas arriba); las dos consultan la misma evidencia afirmativa y aciertan igual.
  useEffect(() => {
    if (!userId) return;
    if (lastSyncedMs === 0) return;
    void refreshEstablishments();
  }, [lastSyncedMs, userId, refreshEstablishments]);

  // spec 20 / D1 (R20.22/R20.35) — al SALIR del flujo de maniobra con una revocación diferida, se
  // aplica la transición a active_lost (el RootGate rutea a /campo-perdido al ver el estado).
  //
  // Antes de emitir se RE-VERIFICA (Gate 1 L2): entre la detección y la salida puede haber cambiado
  // el campo activo (R20.34) o el owner puede haber devuelto el rol. Emitir a ciegas produciría un
  // aviso espurio nombrando un campo que el usuario SÍ tiene. Si la re-verificación no da, el
  // pendiente se descarta SIN emitir y sin tocar el estado: el próximo checkpoint vuelve a detectar
  // la ausencia y re-evalúa desde cero (auto-cura, coherente con R20.30).
  useEffect(() => {
    if (inManeuverRoute) return;
    const pending = pendingRevocationRef.current;
    if (!pending) return;
    const uid = userIdRef.current;
    if (!uid) return;

    let cancelled = false;
    (async () => {
      const evidence = await hasActiveLocalRole(uid, pending.id);
      if (cancelled) return;
      // Otro camino ya resolvió/descartó este pendiente mientras leíamos.
      if (pendingRevocationRef.current?.id !== pending.id) return;
      const emit = shouldEmitDeferredRevocation({
        pendingId: pending.id,
        currentId: currentFieldRef.current?.id ?? null,
        roleEvidence: evidence,
      });
      pendingRevocationRef.current = null;
      if (!emit) return;
      // El set con el que se avisa es el fresco: SIN el campo revocado (el merge de R20.33 vale
      // mientras dura el diferimiento, no después). De ahí sale el re-ruteo por cantidad.
      emitActiveLost(pending, availableRef.current.filter((e) => e.id !== pending.id));
    })();

    return () => {
      cancelled = true;
    };
  }, [inManeuverRoute, emitActiveLost]);

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
        applyCreatedEstablishment,
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
