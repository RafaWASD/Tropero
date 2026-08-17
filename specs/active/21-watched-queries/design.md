# Design — feature 21: watched queries para reactividad real

> Traduce `context.md` (Gate 0 aprobado) + `requirements.md` a decisiones técnicas.
> **El cambio es de DISPARADOR, no de lógica.** El valor de este documento está en §2 (la API real de PowerSync, verificada en `node_modules`, con la desviación respecto de lo que asumía el context), §3 (el mapeo consumidor→query→resolución), §4 (E1 con el disparo más frecuente) y §7 (la reconciliación de la E2E).
> **Patrón arquitectónico**: `docs/adr/ADR-030-watched-queries-reactividad.md` (D4 — ya existe, aceptada 2026-07-21).

---

## 1. Archivos a modificar

| Archivo | Qué cambia | Firma pública |
|---|---|---|
| `app/src/contexts/EstablishmentContext.tsx` | Reemplaza el efecto reactivo `useEffect([lastSyncedMs, …])` (líneas ~516-520) por un efecto que registra `db.onChange` sobre `['user_roles','establishments']` y corre `refreshEstablishments()` en el `onChange`. Saca `useStatus`/`lastSyncedMs`. Agrega `usePowerSync`. **Todo lo demás intacto.** | Sin cambios |
| `app/src/contexts/RodeoContext.tsx` | Reemplaza el efecto reactivo `useEffect([lastSyncedMs, …])` (líneas ~279-283) por un efecto `db.onChange` sobre `['rodeos','user_roles']` que corre `load(userId, establishmentId)`. Saca `useStatus`/`lastSyncedMs`. Agrega `usePowerSync`. **`load`/`applyRodeos`/guarda R20.18 intactos.** | Sin cambios |
| `app/app/lotes.tsx` | La lista (`groups`) pasa a derivarse de `useQuery` sobre `buildManagementGroupsQuery`. Sacan: `useStatus`/`lastSyncedMs`, el efecto mount-only, el efecto reactivo, la función `load`, el guard `sameManagementGroups`, y los parches optimistas manuales de la lista. Las acciones (crear/renombrar/borrar) y su manejo de error quedan; su optimismo ahora viene GRATIS del write local reflejado por `useQuery`. | Sin cambios |
| `app/e2e/reactividad-sync.spec.ts` | D3: saca `test.describe.configure({ retries: 2 })`, saca `forceSyncTick`/`syncUntil` de las adiciones, asserta directo. Oráculos estrictos, casos preservados. Es un archivo de la feature 20, reconciliado acá (autorizado por D3). | N/A (test) |

### 1.1 Lo que NO cambia

- **Ninguna firma pública de contexto** (R21.15). `EstablishmentContextValue`, `RodeoContextValue`, `EstablishmentState`, `RodeoState`, `ActiveLostReason` quedan igual. Los llamadores de `refreshEstablishments`/`refreshRodeos` quedan intactos.
- **Ninguna lógica pura.** `app/src/utils/establishment.ts` (`assessDisappearance`, `shouldEmitDeferredRevocation`, `sameResolvedEstablishmentState`, `sameRodeo`, `isManeuverRouteSegment`) y `app/src/services/{establishments,rodeos,management-groups}.ts` + `powersync/local-reads.ts` **no se tocan** — la resolución de la 20 se re-corre tal cual (R21.10–R21.12). Sus suites unitarias siguen verdes y son las que garantizan la corrección de la resolución preservada.
- **Ninguna migración, RLS policy ni sync stream** (R21.15, §8). La frontera de autorización real no se roza. El candado RG-1 de la 20 (`self_user_roles` sin filtro `active`) es exactamente lo que hace posible D2 y se preserva.
- **Feature 04/BLE**: NO se toca (`app/src/services/ble/**`, `baston.tsx`, `*-multivendor*`). El `__RAFAQ_BLE_E2E__` init-script del caso T21 de la E2E se conserva sin editar (es del stub de maniobra, no código BLE).

---

## 2. La API real de PowerSync (verificada en `node_modules`, NO asumida)

> ⚠️ **Desviación respecto de lo que asumía el context/ADR.** El context (§4 D1) y ADR-030 dicen "**`db.watch` imperativo**". Verificado en el paquete instalado (`@powersync/common@…`, `app/node_modules/@powersync/common/lib/client/AbstractPowerSyncDatabase.d.ts`), la API que encaja EXACTAMENTE con "avisá cuando estas tablas cambien y yo re-corro mi resolución existente" es **`db.onChange(handler, { tables })`**, no `db.watch(sql, …)`. Son dos primitivas distintas:
>
> - **`db.watch(sql, params, handler, options)`** → RE-EJECUTA la query y entrega las FILAS por `handler.onResult`. Es para cuando el consumidor consume esas filas directo. La forma callback devuelve `void`; la limpieza es por `options.signal` (un `AbortController`). El SDK auto-detecta las tablas fuente con `EXPLAIN QUERY PLAN`.
> - **`db.onChange(handler, options)`** → NO ejecuta ninguna query: solo NOTIFICA `{ changedTables }` cuando cambia alguna de las `options.tables`. El SDK lo documenta literalmente como *"preferred over `watch` when multiple queries need to be performed together when data is changed"* — que es exactamente nuestro caso (los contextos corren su propia lectura + evidencia + resolución en el callback). Devuelve una **función de disposición `() => void`** (encaje natural del cleanup de `useEffect`).
>
> Los contextos re-corren `refreshEstablishments()` / `load()` (que hacen su propio `getAll` + mapeo + lectura de evidencia + veredicto). Usar `db.watch` nos daría filas que igual ignoraríamos. Por eso el diseño usa **`db.onChange`** para los contextos. Es una **precisión de nombre, no un cambio de alcance ni de comportamiento**: sigue siendo el "onChange imperativo que re-corre la resolución existente" que pidió D1. Se refleja en ADR-030 y en las specs como "watched query imperativa (`db.onChange`)".

### 2.1 `db.onChange` — firma exacta (contextos)

```ts
interface SQLOnChangeOptions {
  signal?: AbortSignal;
  tables?: string[];          // tablas a observar (nombres de usuario; el SDK matchea ps_data__<t> / ps_data_local__<t>)
  throttleMs?: number;        // intervalo mínimo entre disparos; default DEFAULT_WATCH_THROTTLE_MS = 30
  triggerImmediate?: boolean; // default false → NO dispara al registrarse
}
interface WatchOnChangeEvent { changedTables: string[]; }
interface WatchOnChangeHandler {
  onChange: (event: WatchOnChangeEvent) => Promise<void> | void;  // REQUERIDO
  onError?: (error: Error) => void;
}
// AbstractPowerSyncDatabase:
onChange(handler: WatchOnChangeHandler, options?: SQLOnChangeOptions): () => void;   // ← devuelve DISPOSE
```

Propiedades verificadas (`AbstractPowerSyncDatabase.js` `onChangeWithCallback`):
- Solo dispara cuando la intersección `changedTables ∩ tables` es no vacía.
- El throttle es **trailing** (`throttleTrailing`) → coalesce ráfagas (R21.21).
- `triggerImmediate` default `false` → **no hay disparo al montar**. Por lo tanto la **carga inicial NO la hace el `onChange`**: la sigue haciendo el efecto de bootstrap existente de cada contexto, que es un efecto SEPARADO del reactivo (§3.1/§3.2, R21.35). Se deja `triggerImmediate` en su default (no se activa): duplicaría la carga que el bootstrap ya hace y podría correr antes de que el bootstrap fije los refs.
- La limpieza es la función devuelta (o `options.signal.abort()`).

### 2.2 `useQuery` — firma exacta (`lotes.tsx`)

`app/node_modules/@powersync/react/lib/hooks/watched/useQuery.d.ts` + `watch-types.d.ts`:

```ts
function useQuery<RowType = any>(
  query: string | CompilableQuery<RowType>,
  parameters?: any[],
  options?: DifferentialHookOptions<RowType>,   // con rowComparator → resultado READONLY + diferencial
): ReadonlyQueryResult<RowType>;

type ReadonlyQueryResult<RowType> = {
  readonly data: ReadonlyArray<Readonly<RowType>>;
  readonly isLoading: boolean;   // true SOLO en la carga inicial (hard loading)
  readonly isFetching: boolean;  // true durante la carga inicial y cada re-evaluación
  readonly error: Error | undefined;
  refresh?: (signal?: AbortSignal) => Promise<void>;
};

interface DifferentialHookOptions<RowType> {
  rowComparator?: { keyBy: (item) => any; compareBy: (item) => any };  // solo re-emite si el set cambió
}
```

Con `rowComparator` el hook usa una query incremental: **solo emite cuando el result-set cambia realmente**, preservando las referencias de las filas sin cambios → reemplaza el guard manual `sameManagementGroups` (R21.20). Las tablas fuente las auto-detecta el SDK con `EXPLAIN` (incluye `management_groups` y el overlay `pending_status_overrides` del `notHiddenByOverride`).

### 2.3 `usePowerSync` — instancia del DB

`@powersync/react` re-exporta `usePowerSync(): AbstractPowerSyncDatabase` (via `PowerSyncContext`). Devuelve el **mismo singleton** que `getPowerSync()` (`services/powersync/database.ts`), con el que se inicializa el `PowerSyncProvider`. Se usa `usePowerSync()` por consistencia con el árbol de contexto (igual que `useStatus()` ya venía de ahí). `PowerSyncProvider` envuelve a `Establishment/RodeoProvider` (`app/app/_layout.tsx`, verificado en la 20), así que está disponible.

---

## 3. Mapeo por consumidor — query observada → resolución que corre

| Consumidor | API | Tablas observadas | Qué corre en el disparo | Resolución de la 20 preservada |
|---|---|---|---|---|
| `EstablishmentContext` | `db.onChange` | `user_roles`, `establishments` | `void refreshEstablishments()` | `applyMembershipsResult` → `applyMemberships` → `detectActiveLost` → `confirmDisappearance` (`assessDisappearance` + evidencia `hasActiveLocalRole` + diferimiento D1 + guard de equivalencia) |
| `RodeoContext` | `db.onChange` | `rodeos`, `user_roles` | `void load(userId, establishmentId)` | `load` → `fetchRodeos` → guarda R20.18 (`protectingResolved` + `assessDisappearance`) → `applyRodeos` (preserva el preferido) + guard de equivalencia |
| `lotes.tsx` | `useQuery` | (auto-detectadas: `management_groups`, `pending_status_overrides`) | re-emite `data` (lista de lotes) | N/A — es una lista directa, sin lógica de revocación |

### 3.1 `EstablishmentContext` — el efecto

**Sale** (líneas ~490-520): el `useStatus()` → `lastSyncedMs` y el `useEffect([lastSyncedMs, userId, refreshEstablishments])`.

**Entra**:

```ts
import { usePowerSync } from '@powersync/react';
const db = usePowerSync();

// spec 21 (R21.1/R21.5/R21.7) — WATCHED QUERY imperativa. Reemplaza el disparador por-sync (lastSyncedMs,
// proxy NO determinista) por db.onChange sobre las tablas que respaldan las membresías. Observar `user_roles`
// es la watched query de revocación de D2 (self_user_roles vive en esa tabla local y sobrevive con active=0):
// el aviso deja de esperar a que tique lastSyncedAt. `establishments` cubre alta/rename/baja de campos.
// El onChange re-corre la resolución EXISTENTE (R21.10) — solo cambia el disparador.
useEffect(() => {
  if (!userId) return;
  const dispose = db.onChange(
    { onChange: () => { void refreshEstablishments(); } },
    { tables: ['user_roles', 'establishments'] },
  );
  return () => dispose();
}, [userId, refreshEstablishments, db]);
```

Por qué observar **ambas** tablas: una revocación puede llegar como baja del rol (`user_roles.active → 0`, vía `self_user_roles`) o como remoción del bucket de `establishments` (sale de `org_scope`), y ambas caras pueden aterrizar en checkpoints distintos (§4). Observar las dos garantiza que la re-evaluación dispare por cualquiera de las dos, y el veredicto lo decide igual la evidencia afirmativa (`user_roles`), no la ausencia de `establishments`.

`refreshEstablishments` es un `useCallback` estable (`[userId, applyMembershipsResult]`) → el efecto se re-suscribe solo si cambia el usuario. `db` es un singleton estable.

**La carga inicial NO se toca (R21.35).** El efecto de bootstrap existente (`bootedForUser` ref, líneas ~444-488: `loadTrail` → `waitForUsableSync` → `loadMemberships` → `applyMembershipsResult`) es el que resuelve el estado al montar y al cambiar de usuario. Es un efecto SEPARADO del reactivo. El único efecto que esta feature reemplaza es el reactivo (el que dependía de `lastSyncedMs`); el bootstrap queda intacto, así que la home resuelve al montar sin depender del `onChange`.

### 3.2 `RodeoContext` — el efecto

**Sale** (líneas ~268-283): `useStatus()` → `lastSyncedMs` y el `useEffect([lastSyncedMs, userId, establishmentId, load])`.

**Entra**:

```ts
import { usePowerSync } from '@powersync/react';
const db = usePowerSync();

// spec 21 (R21.2/R21.5/R21.9) — WATCHED QUERY imperativa. `rodeos` cubre alta/borrado/rename de un rodeo por
// un coworker. `user_roles` es 🔴 la guarda que sostiene D1 (R20.18): al revocarse el acceso PowerSync borra el
// bucket de rodeos → fetchRodeos=[] → sin la evidencia afirmativa concluiríamos no_rodeos → /crear-rodeo SOBRE
// la maniobra. Observar `user_roles` re-evalúa apenas baje el rol, aunque la remoción del bucket de rodeos
// llegue en otro checkpoint. El onChange re-corre `load` EXISTENTE (R21.11) — solo cambia el disparador.
useEffect(() => {
  if (!userId || !establishmentId) return;
  const dispose = db.onChange(
    { onChange: () => { void load(userId, establishmentId); } },
    { tables: ['rodeos', 'user_roles'] },
  );
  return () => dispose();
}, [userId, establishmentId, load, db]);
```

El efecto de bootstrap/cambio-de-campo (`useEffect([userId, establishmentId, load])`, líneas ~264-266) queda tal cual — es la **carga inicial al montar** y la recarga al hacer switch de campo (R21.35). El efecto reactivo (el que dependía de `lastSyncedMs`) es el único que se reemplaza. Así los rodeos aparecen al montar sin depender del `onChange`.

**No hay riesgo de starvation nuevo**: la 20 YA endureció `load` para un disparo frecuente (`targetRef` = descartar si cambió el objetivo; `lastAppliedSeq` = ordenar sin cancelar — el fix de la autorrevisión de la 20, `design.md` §10-bis(b), motivado por "los checkpoints llegan cada ~1 s"). El `onChange` es justamente ese disparo frecuente que la 20 anticipó. `confirmDisappearance` es idempotente (dos evaluaciones concurrentes del mismo campo leen la misma fila local y concluyen igual; emitir dos veces lo absorbe el guard de equivalencia). El throttle de 30 ms coalesce ráfagas (R21.21).

### 3.3 `lotes.tsx` — `useQuery`

**Sale**: `useStatus()`/`lastSyncedMs`; el `useEffect(() => void load(), [load])` mount-only; el `useEffect([lastSyncedMs, load])` reactivo; la función `load`; el guard `sameManagementGroups`; los estados `groups`/`loading` y los parches optimistas manuales (`setGroups(prev => …)` de crear/renombrar/borrar + los snapshots de revert).

**Entra**:

```ts
import { useQuery, useStatus } from '@powersync/react';
import { buildManagementGroupsQuery } from '@/services/powersync/local-reads';

const { sql, args } = buildManagementGroupsQuery(establishmentId ?? '');
const { data: groups, isLoading, error } = useQuery<ManagementGroup>(sql, args, {
  // R21.20 — diferencial: solo re-emite si el set (id + name) cambió; preserva refs de filas sin cambio →
  // reemplaza el guard manual sameManagementGroups. Un checkpoint que no toca los lotes es un no-op.
  rowComparator: { keyBy: (g) => g.id, compareBy: (g) => g.name },
});

// R21.34 — useStatus reintroducido SOLO como affordance del estado vacío (desambiguar "sincronizando" de
// "sin lotes", R21.32/R21.33). NO es el disparador de la reactividad de la lista — eso lo hace useQuery.
const { hasSynced } = useStatus();
```

- **`groups`** es `ReadonlyArray<ManagementGroup>` (el builder ya proyecta `SELECT id, name` — es exactamente el shape de `ManagementGroup`). Reemplaza el estado `groups`. (El plumbing readonly hacia los props hijos —p. ej. `groups={[...groups]}` o el prop tipado `readonly ManagementGroup[]`— lo resuelve el implementer; no cambia el shape público).
- **`isLoading`** (solo la carga inicial) reemplaza el estado `loading` para el placeholder "Cargando lotes…".
- **`error`** reemplaza el `error` de la lista; el CTA "Reintentar" llama `refresh()`.
- **Optimismo automático (R21.20, sin parches manuales)**: crear/renombrar/borrar un lote son writes LOCALES (`runLocalWrite` a `management_groups`, o el overlay `pending_status_overrides` del soft-delete). PowerSync los aplica al SQLite local al instante → `useQuery` re-emite con el cambio reflejado, sin necesidad de `setGroups`. Un borrado rechazado no escribió el overlay → la fila simplemente sigue (no hay que revertir nada). Las acciones conservan su manejo de error propio (`createError`, `Alert` del delete) y sus estados de UI (`creating`, `renamingId`, `deletingId`, `expandedId`, `busyRef`).
- **`establishmentId` nulo** (defensivo — la pantalla solo es alcanzable con campo activo): `buildManagementGroupsQuery('')` no matchea nada → `data = []` → cae en la lógica de estado vacío de abajo.
- **R21.20 / R21.3 "silencioso"**: `useQuery` no vuelve a poner `isLoading = true` en las re-emisiones (solo `isFetching`), así que la lista **no se blanquea** ni resetea el scroll ante un cambio reactivo — la propiedad que la 20 lograba con `load({ silent: true })`, ahora nativa del hook.

#### Estado vacío vs. sincronizando (R21.32/R21.33/R21.34) — veto de design-review

`useQuery` puede devolver `data = []` por DOS motivos distintos que **no** hay que confundir: el campo genuinamente no tiene lotes, o los lotes todavía no sincronizaron (primer sync / device nuevo). Mostrar "Este campo todavía no tiene lotes" en el segundo caso es un **falso vacío** en un estado de alto impacto (la feature 20 lo evitaba con `emptyIsSyncing: true`). Se desambigua con `hasSynced`:

```
if (error && groups.length === 0)        → FormError + "Reintentar" (refresh())
else if (isLoading && groups.length===0) → "Cargando lotes…"            (carga inicial)
else if (groups.length === 0 && !hasSynced) → "Sincronizando datos del campo…"   (R21.32: NO "sin lotes")
else if (groups.length === 0 && hasSynced)  → "Este campo todavía no tiene lotes…" (R21.33: vacío genuino, copy owner/no-owner)
else                                      → la lista de LoteCards
```

Así un campo **con** lotes aún sin sincronizar muestra el hint de sync hasta que bajen (y entonces `useQuery` los emite reactivamente), en vez de mentir "sin lotes". `useStatus` vuelve **solo** para este affordance (R21.34): la reactividad de la lista la sigue dando `useQuery`, no la señal de sync. El copy de "Sincronizando…" reusa el mensaje es-AR ya existente (`SYNCING_MESSAGE`, `powersync/local-query.ts`) para no divergir.

---

## 4. E1 — sin falso `active_lost` / `no_rodeos` con el disparador más frecuente (el riesgo central)

### 4.1 Qué hay que demostrar

Que el `onChange` —que dispara en cada cambio de tabla, más seguido que `lastSyncedMs`— nunca haga concluir revocación sobre un estado transitorio.

### 4.2 Por qué se sostiene (dos capas, ambas ya presentes en la 20)

1. **El disparo observa snapshots CONSISTENTES, no estados a medio aplicar (R21.18).** PowerSync (core Rust, `@powersync/common`) aplica cada checkpoint como una transacción sobre el SQLite local y recién ahí emite `tablesUpdated` (que es lo que `onChange` escucha). miTropero **no declara prioridades** en `sync-streams/rafaq.yaml` (feature 20, `design.md` §4.2, evidencia 1-4, verificada en el repo) → todo checkpoint es una vista completa y consistente. No existe el escenario "publicó unos buckets y otros no" dentro de un mismo disparo. Un set momentáneamente vacío es un estado consistente real (el bucket efectivamente se removió a esa altura), no una descarga a medias.

2. **El veredicto es por EVIDENCIA AFIRMATIVA, no por ausencia, y es idempotente (R21.12/R21.16/R21.17).** `assessDisappearance` (sin cambios) concluye `confirmed` **solo** cuando la fila local de rol propia está ausente o `active = 0`. Si el campo desapareció de `establishments` pero el rol propio todavía está `active = 1` (la baja del rol llega en un checkpoint POSTERIOR), el veredicto es `inconclusive` → no se cambia de estado → se espera. El siguiente `onChange` (cuando `user_roles.active → 0` aterriza, observado por R21.7) re-evalúa → `absent_or_inactive` → `confirmed`. Sin timer ni contador (R21.17).

**Consecuencia clave del disparo más frecuente: es estrictamente MEJOR, no peor.** Con `lastSyncedMs` la re-evaluación quedaba a merced de que la señal FULL ticara (podía lagear ~90 s+). Con `onChange`, cada cambio relevante de `user_roles`/`establishments`/`rodeos` dispara la re-evaluación de forma determinista (~1,5 s), y el veredicto siempre aterriza correcto (`present`/`confirmed`/`inconclusive`) porque la regla no depende de la frecuencia. Ver más disparos = re-evaluar más seguido = converger antes al veredicto correcto. El falso positivo que E1 teme lo bloquea la evidencia afirmativa, no el disparador.

### 4.3 Blast radius si aun así se colara un falso positivo

Idéntico a la 20 (`design.md` §4.3): `emitActiveLost` limpia `preferredIdRef`/`currentFieldRef`, el próximo `onChange` re-resuelve, y un solo campo → auto-activo. Un falso `active_lost` se auto-cura; el daño máximo es un aviso espurio, no una sesión perdida. La 20 ya lo tenía cubierto y no cambia.

---

## 5. E2 — thrash / doble disparo

Tres barreras compuestas (R21.19/R21.20/R21.21), todas ya en el repo o nativas del SDK:

1. **Throttle trailing del SDK (30 ms)** — coalesce la ráfaga de `tablesUpdated` de un checkpoint en un solo `onChange` (R21.21).
2. **Guards de equivalencia de la 20** — `sameResolvedEstablishmentState` (EstablishmentContext) y `sameRodeoState`/`sameRodeo` (RodeoContext) hacen que `setState` devuelva `prev` cuando el estado resuelto no cambió → React descarta el update → sin re-render de la app raíz (R21.19). Se preservan tal cual.
3. **`rowComparator` diferencial de `useQuery`** — en `lotes.tsx`, solo re-emite si el set de lotes cambió, preservando refs (R21.20). Reemplaza el `sameManagementGroups` manual.

`RodeoContext.load` además ordena cargas concurrentes con `lastAppliedSeq` (no cancela — el fix anti-starvation de la 20), así que dos disparos solapados no se pisan ni se matan de hambre.

---

## 6. E3 / E4 — offline y la frontera real (se documentan, no se re-inventan)

- **E3 — offline puro (R21.22/R21.23).** `db.onChange` **solo dispara ante un cambio real de una tabla observada**. Sin red no bajan cambios del servidor → no dispara → no re-lee ni cambia de estado. Esto **reemplaza** el guard `lastSyncedMs === 0` de la 20 (R20.7/R20.8) por una propiedad más fuerte: no hay disparo espurio porque no hay evento. Si un write LOCAL del propio usuario dispara el `onChange` estando offline, la re-lectura lee el SQLite local y, por la evidencia afirmativa (R21.23), nunca concluye en contra del usuario. El caso E2E de offline de la 20 (T22: app quieta, sin cambios → no cae a campo-perdido/onboarding) **sigue válido** con el nuevo disparador (su oráculo pasa igual).
- **E4 — la ventana de propagación de revocación NO se acelera (R21.24/R21.25).** La watched query reacciona apenas la remoción llega al SQLite local, pero la **ENTREGA** la gobierna el servicio de sync (hallazgo de la 20: la remoción de bucket se disrupta con reconnects/blips y la revocación de sesión también). La watched query elimina el lag de la SEÑAL (`lastSyncedAt`, ~90 s+), no el de la propagación del servicio. La frontera real de acceso sigue siendo **RLS server-side** (`has_role_in`, `0005_rls_helpers.sql`), instantánea. Ninguna cadena de UI ni de doc de esta feature promete revocación de UI instantánea bajo conectividad intermitente.

---

## 7. D3 — reconciliación de la E2E de la feature 20

`app/e2e/reactividad-sync.spec.ts` (de la feature 20; D3 autoriza tocarlo acá). Con reactividad determinista:

1. **Sacar `test.describe.configure({ retries: 2 })`** (R21.26). El freeze patológico de `lastSyncedAt` que los justificaba desaparece: `onChange` dispara sobre el cambio de tabla, no sobre la señal FULL.
2. **Sacar el forzador de blip de las ADICIONES** (R21.27): eliminar `forceSyncTick`/`syncUntil` de los casos T17 (campo), T18 (rodeo) y T19 (lote). La fila baja al SQLite en ~1,5 s → `onChange` dispara → la UI se actualiza. Asserts directos con timeouts razonables (Playwright estándar, p. ej. 30 s), sin blips.
3. **Revocaciones (T20/T21)**: sacar retries; asertar directo. La baja del rol (`user_roles.active → 0`) baja por `self_user_roles` y el `onChange` sobre `user_roles` dispara el aviso apenas aterriza — sin esperar el tick FULL. Se conservan los oráculos estrictos (incluido `assertServerSessionsRevoked` como primer assert de T21, el candado anti-falso-verde). Timeouts por-assert razonables; la ENTREGA sigue siendo async (E4) pero sin el lag de señal, así que bajan de ~120 s a un valor acorde a la propagación real (el implementer lo mide; objetivo determinista sin retries).
4. **Offline (T22)**: se conserva el mecanismo `context.setOffline`; su oráculo (sin cambio de estado) sigue válido (E3). No usa el forzador.
5. **Actualizar el header del spec**: reemplazar la explicación de "eventual-consistency + retries honestos" por "reactividad determinista vía watched query (`db.onChange`/`useQuery`, ADR-030); sin retries ni forzador".

Los oráculos NO se aflojan (R21.28) y los casos/garantías se conservan (R21.29). **NO** se tocan los helpers de fixture de `admin.ts` ni nada de BLE.

---

## 8. Cumplimiento de los MUSTs de miTropero

- **Multi-tenancy / RLS**: la feature toca el contexto que decide el `establishment_id` activo y la detección de revocación, así que se declara explícitamente: **no se modifica ninguna policy RLS, migración ni sync stream**. El set de campos accesibles se sigue derivando de `auth.uid()` vía `org_scope` + RLS; el cliente nunca hardcodea `establishment_id`. Las tablas observadas por las watched queries (`user_roles`, `establishments`, `rodeos`, `management_groups`) son el SQLite LOCAL ya scopeado por las streams — observarlas es un **disparador de UX, no un control de acceso** (misma nota que la 20: la evidencia afirmativa decide qué pantalla mostrar, nunca un permiso; el enforcement es `has_role_in` server-side). El candado RG-1 (`self_user_roles` sin filtro `active`) es lo que hace posible D2 y se preserva intacto.
- **Offline-first**: las watched queries leen del **SQLite local**; **cero llamadas de red** nuevas. Sin conexión, `db.onChange` no dispara (no hay cambios de tabla del servidor) y `useQuery` refleja el estado local — comportamiento idéntico al de hoy, sin el guard `=== 0` (reemplazado por "no hay evento sin cambio"). La app en la manga sin señal no cambia en nada.
- **Velocidad operativa**: el diferimiento D1 se preserva (R21.13) — al operario no se lo saca de la manga por una decisión administrativa remota; ahora además el aviso, cuando corresponde, es determinista (~1,5 s) en vez de lagear.

---

## 9. Alternativas descartadas

### 9.1 `useQuery` uniforme también en los 2 contextos — DESCARTADA

Sería un solo patrón para los 3 consumidores. Se descarta porque los contextos **no consumen filas**: corren lógica de resolución (evidencia afirmativa, revocación, diferimiento D1) que necesita `getAll` + `hasActiveLocalRole` + veredicto, no un `data[]`. Derivar la resolución del `data` de un `useQuery` obligaría a reimplementar `loadMemberships`/`fetchRodeos`/la evidencia dentro del render, reescribiendo la resolución que D1 pide **preservar**. `db.onChange` re-corre la resolución existente sin tocarla — encaje exacto de D1. `useQuery` queda para `lotes.tsx`, que sí es una lista directa.

### 9.2 `db.watch(sql, …, { onResult })` en los contextos — DESCARTADA

Es la otra primitiva imperativa. Entregaría las FILAS de la query, que los contextos igual ignorarían para re-correr su propia lectura + evidencia. Además su forma callback devuelve `void` y limpia por `AbortController` (más ceremonia que el dispose de `onChange`). El propio SDK recomienda `onChange` *"when multiple queries need to be performed together when data is changed"*. Ver §2.

### 9.3 Migrar toda la app a watched queries de una (big-bang) — DESCARTADA

Mayor riesgo y superficie. ADR-030 fija migración **incremental**: los 3 consumidores de la 20 ahora; los 5 focus-only y el resto después, con el patrón ya establecido (R21.30). El context lo excluye explícitamente (§3).

### 9.4 Conservar `lastSyncedMs` + `retries` (lo que hizo la 20) — DESCARTADA

Funciona y es mejor que el latch previo, pero la latencia sigue no acotada (~90 s+) porque `lastSyncedAt` es el primitivo equivocado (feature 20, diagnóstico A/B). Es la deuda que esta feature salda. ADR-030, sección "Alternativas".

---

## 10. Reconciliación de specs al cerrar (regla dura)

Al cerrar la feature hay que tocar:

1. `specs/active/15-powersync/design.md` — el bullet "One-shot `getAll`, NO `db.watch`" (ya acotado por la 20 a "los 3 consumidores usan `lastSyncedMs`, no `db.watch`") pasa a: **los 3 consumidores migrados a watched queries reales (`db.onChange`/`useQuery`); el resto sigue pendiente** (R21.31).
2. `specs/active/20-reactividad-sync/design.md` — §10-bis (g) ("`db.watch` flageado") y §9.1 ("Migrar a watched queries — DESCARTADA") + el header de `reactividad-sync.spec.ts`: nota as-built de que el disparador migró a watched query en la feature 21 (el forzador + retries se retiraron por D3). No se reescriben los EARS de la 20.
3. `specs/active/20-reactividad-sync/requirements.md` — nota bajo R20.6/R20.7/R20.8 (la dep primitiva `lastSyncedMs` y su guard `=== 0` en los 3 consumidores fueron reemplazados por el disparador `onChange`/`useQuery` en la feature 21; la propiedad offline se preserva).
4. `docs/backlog.md` — cerrar/acotar el ítem `db.watch` (los 3 consumidores hechos; queda el resto de la app como migración incremental pendiente, ADR-030).
5. `docs/adr/ADR-030-…` — anotar, si hiciera falta, la precisión de nomenclatura `db.watch` → `db.onChange` para los contextos (§2 de este design).
</content>
