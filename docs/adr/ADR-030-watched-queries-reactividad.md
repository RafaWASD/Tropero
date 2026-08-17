# ADR-030: Adopción de watched queries (`db.onChange` / `useQuery`) para reactividad

- **Estado**: Aceptada
- **Fecha**: 2026-07-21
- **Decisor**: Raf (Puerta 2 de la feature 20 → decidió hacer `db.watch` ahora)
- **Relacionado**: feature 20 (`20-reactividad-sync`, hallazgo A/B), feature 21 (`21-watched-queries`, esta migración), `specs/active/15-powersync/design.md` (deuda "cero watched queries")

## Contexto

Toda la reactividad de miTropero está **emulada sobre la señal de status** de PowerSync: el patrón canónico
del repo es `useStatus()` de `@powersync/react` + `lastSyncedAt.getTime()` como dependencia primitiva de un
efecto que re-lee con `getAll` en cada avance de sync. **La app tiene CERO watched queries** (`db.watch` /
`useQuery`) — deuda deliberada documentada desde 2026-06-09.

La feature 20 probó, con un **diagnóstico A/B determinista** (sondeo directo de `getAll` SIN reload, 2/3
cambios secuenciales; evidencia cruda en `progress/impl_20-reactividad-sync.md`), que **`lastSyncedAt` es
un proxy NO determinista del cambio de dato**:

- La fila del cambio server-side **SIEMPRE** llega al SQLite local en **~1,5 s** (6/6 cambios).
- Pero `lastSyncedAt` avanza **NO determinista por cambio**: a veces al instante, a veces un cambio se
  **estanca ~90 s+** hasta que un checkpoint posterior lo barre. Significa "último sync FULL completado",
  **no** "cambió un dato".

Consecuencia: la reactividad emulada tiene **latencia no acotada** (hasta ~90 s+), y su E2E necesita
`retries` + forzadores de blip para ser verde. Es el techo estructural del patrón vigente.

## Decisión

Adoptar **watched queries reales de PowerSync** como el patrón de reactividad, reaccionando al cambio del
**SQLite local** (que llega en ~1,5 s) en vez de a la señal gruesa de status:

- **Watched query imperativa** en los **contextos** que corren lógica de resolución sobre los datos
  (`EstablishmentContext`, `RodeoContext`): re-corre la resolución que ya existe (`assessDisappearance`,
  diferimiento D1, evidencia de revocación). Solo cambia el **disparador**.
  > **PRECISIÓN DE NOMENCLATURA (as-built, feature 21, verificada en `node_modules`).** La primitiva
  > correcta para los contextos es **`db.onChange(handler, { tables })`**, NO `db.watch(sql, params,
  > handler)`. Son dos cosas distintas: `db.watch` RE-EJECUTA una query y entrega las FILAS (para cuando
  > el consumidor consume esas filas directo); `db.onChange` **solo NOTIFICA** `{ changedTables }` cuando
  > cambia alguna de las `tables` observadas, y devuelve una **función de disposición** (encaje natural
  > del cleanup de `useEffect`). El propio SDK recomienda `onChange` *"when multiple queries need to be
  > performed together when data is changed"* — que es exactamente el caso de los contextos (corren su
  > propia lectura + evidencia + veredicto en el callback, e ignorarían las filas de un `db.watch`). Es
  > una precisión de nombre, no un cambio de alcance: sigue siendo la watched query imperativa que
  > re-corre la resolución existente. `triggerImmediate` es `false` (default) → NO dispara al montar (la
  > carga inicial la hace el bootstrap separado). Ver `specs/active/21-watched-queries/design.md` §2.
- **`useQuery`** (`@powersync/react`, hook, con `rowComparator` diferencial) en pantallas/componentes que
  renderizan listas directo (`lotes.tsx`, y a futuro las demás).
- **Migración INCREMENTAL, no big-bang**: la feature 21 migra los **3 consumidores de la 20**
  (`EstablishmentContext`, `RodeoContext`, `lotes.tsx`). El resto (los 5 focus-only del backlog:
  `miembros`, `use-reports`, `animal/[id]`, `export-sigsa`, `maniobra`; y demás) se migra después con
  este patrón ya establecido.
  > **AVANCE (feature 22, 2026-07-22)**: `useManeuverGating` (config/maniobra) **migrado** a `db.onChange`
  > (sobre `rodeo_data_config` + `pending_rodeo_data_config`, overlay-aware) — uno de los 5 focus-only
  > (`maniobra`). La feature 22 además cerró la deuda de CONEXIÓN que esta ADR asumía resuelta (la descarga
  > no reenganchaba en nativo); ver **ADR-031** (liveness de conexión), su contrapunto.
  >
  > **CIERRE del proxy `lastSyncedAt` en la UI de usuario (2026-07-23, `impl_adr030-watched-queries-resto`).**
  > Un inventario AUTORITATIVO por grep (`useStatus(` + `lastSyncedAt|lastSyncedMs`, no la lista de memoria)
  > reveló que los consumidores que TODAVÍA usaban el proxy NO determinista NO eran los "4 focus-only"
  > nombrados arriba, sino **otros 4**: `app/app/(tabs)/animales.tsx` (lista + búsqueda),
  > `app/app/(tabs)/index.tsx` (home: conteos + cards de rodeo/lote), `src/contexts/ProfileContext.tsx`
  > (saludo) y `src/hooks/useGroupView.ts` (vista de grupo grande). **Los 4 migrados a `db.onChange`
  > imperativo** (re-corren su resolución EXISTENTE; solo cambia el disparador), observando las tablas que
  > cada uno realmente lee (ver la tabla de trazabilidad en el impl). Además se migró un **5º consumidor
  > hallado en la autorrevisión**: `mas.tsx` `RenspaBanner`, que usaba `statusChanged` (vía
  > `subscribeSyncUiState`) — el MISMO anti-patrón por otra API → ahora `db.onChange` sobre `establishments`.
  >
  > **Aclaración sobre los "4 focus-only" del backlog** (`miembros`, `use-reports`, `animal/[id]`,
  > `export-sigsa`): el grep confirma que **NINGUNO usa el proxy `lastSyncedAt`** — `miembros`/`animal[id]`/
  > `export-sigsa` son **focus-only** (recargan por `useFocusEffect`, sin señal de sync) y `use-reports` es
  > **online-only** (los KPIs se calculan server-side por RPC/edge → NO hay tabla local que observar, así que
  > NO se le mete `db.onChange`). Darles reactividad VIVA a los focus-only sería una feature NUEVA (no un swap
  > de disparador) y queda como follow-up opcional, NO parte de "matar el proxy".
  >
  > **Estado**: el proxy `lastSyncedAt`/`lastSyncedMs`/`statusChanged`-como-data-trigger queda **eliminado de
  > toda la UI de usuario**. Usos legítimos de `useStatus`/`subscribeSyncUiState` que PERMANECEN (no son
  > data-proxy): `connected` (online/offline: `FindOrCreateOverlay`, `mas.useIsOffline`) y `hasSynced`
  > (desambiguar vacío-vs-sincronizando en `lotes.tsx`, R21.34). Falta el **veredicto en DEVICE** (nativo,
  > ADR-029) de que el `db.onChange` dispara al bajar el cambio al SQLite local en sesión viva.

## Consecuencias

**Positivas**
- Reactividad **determinista ~1,5 s** (vs. hasta ~90 s+), incluida la **detección de revocación** (watched
  query sobre `self_user_roles`: el aviso de campo-perdido deja de lagear).
- **E2E deterministas sin `retries` ni forzadores** (se reconcilia la E2E de la 20).
- La frontera de autorización real (RLS `has_role_in`, server-side, instantánea) **no cambia**: la
  reactividad del cliente es UX, no authz.

**Negativas / costos**
- El patrón `useStatus() + lastSyncedAt` queda como **legado a reemplazar** — coexisten dos patrones hasta
  completar la migración incremental.
- Cada consumidor migrado cambia su disparador; hay que preservar la lógica de resolución y los guards de
  equivalencia (evitar thrash por el disparo más frecuente de `db.onChange` — el SDK ayuda con su throttle
  trailing de 30 ms que coalesce ráfagas de un checkpoint).

## Alternativas consideradas

- **Seguir con `lastSyncedAt` + `retries`** (lo que hizo la 20): funciona y es estrictamente mejor que el
  latch previo, pero la latencia sigue no acotada — es un band-aid sobre el primitivo equivocado.
- **Big-bang de toda la app a watched queries**: mayor riesgo y superficie; se prefiere incremental
  empezando por los 3 consumidores ya aislados de la 20.
