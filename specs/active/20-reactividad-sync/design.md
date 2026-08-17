# Design — feature 20: reactividad de lecturas sincronizadas

> Traduce `context.md` (Gate 0 aprobado) + `requirements.md` a decisiones técnicas.
> **El reemplazo del latch es mecánico. El valor de este documento está en §4 (E1), §5 (D1) y §6 (E5).**

---

## 1. Archivos a modificar

### 1.1 Los tres del alcance (context §3 / D4)

| Archivo | Qué cambia |
|---|---|
| `app/src/contexts/EstablishmentContext.tsx` | Reemplaza el `registerListener`/`lastHasSynced` (líneas ~333-350) por el patrón canónico + guarda E1 + diferimiento D1. Corrige el comentario falso de las líneas 331-332. |
| `app/src/contexts/RodeoContext.tsx` | Reemplaza el `registerListener`/`lastHasSynced` + elimina el candado `isWaitingRef` (líneas ~140-168) por el patrón canónico + guarda E1 para `no_rodeos`. |
| `app/app/lotes.tsx` | Agrega el efecto reactivo (`lastSyncedMs`) con `load({ silent: true })` junto al `useEffect` mount-only de la línea ~115. |

### 1.2 Cuatro archivos derivados — **alcance final: 7 archivos** (autorizado por el leader, 2026-07-19)

El context fijó el alcance en 3 archivos. Cuatro más son inseparables de requisitos aprobados; el leader autorizó la extensión al ordenar el swap a evidencia afirmativa:

| Archivo | Por qué es inseparable |
|---|---|
| `app/src/utils/establishment.ts` | Módulo **puro** hermano de `EstablishmentContext` (ahí ya viven `resolveState` y `detectActiveLost`) y único lugar donde la lógica de resolución de membresías es testeable con `node:test` sin arrastrar RN. El unitario que pidió el leader ("¿un checkpoint sin `user_roles` concluye `active_lost`? debe ser NO") **no existe** si la guarda de E1 se escribe adentro del `.tsx`. Suite ya registrada en `scripts/run-tests.mjs`. |
| `app/src/services/powersync/local-reads.ts` | Hogar canónico de los SQL builders **puros** (`build<Algo>Query → { sql, args }`, sin imports, testeables bajo `node:test`). Ahí va `buildActiveRoleQuery` — la lectura de la evidencia afirmativa (§4.3). Escribir el SQL en otro lado rompería el patrón de spec 15 y lo dejaría sin test. |
| `app/src/services/establishments.ts` | Capa de datos donde ya vive `loadMemberships`. Ahí va `hasActiveLocalRole()`, que ejecuta el builder vía `runLocalQuerySingle`. Es el único borde donde el contexto puede pedir la evidencia sin importar el SDK a mano. |
| `app/app/campo-perdido.tsx` | R20.28 (E5): el copy actual afirma "Te quitaron el acceso a este campo" como causa única, y es falso en la mitad de los casos (§6). Es **una cadena de texto**. Dejarlo mintiendo contradice el espíritu de la feature, que nació de un comentario mentiroso. |

No se toca nada más. En particular **NO** entran: las 5 pantallas focus-only (`miembros.tsx`, `use-reports.ts`, `animal/[id].tsx`, `export-sigsa.tsx`, `maniobra.tsx`) ni la migración a watched queries.

`app/e2e/helpers/admin.ts` suma helpers de fixture — infraestructura de test, no código de app.

`app/e2e/helpers/admin.ts` suma dos helpers de fixture (revocar rol, esperar propagación) — es infraestructura de test, no código de app.

### 1.3 Lo que NO cambia

- **Ninguna firma pública de contexto.** `EstablishmentContextValue`, `RodeoContextValue`, `EstablishmentState`, `RodeoState` y `ActiveLostReason` quedan igual. Los 5 llamadores de `refreshEstablishments` y los de `refreshRodeos` no se tocan. `loadMemberships` tampoco cambia de forma (la evidencia afirmativa va en una función nueva, no en su `Result`).
- **Ninguna migración, ninguna RLS policy, ninguna stream de PowerSync.** La frontera de autorización real (`sync-streams/rafaq.yaml` + RLS) no se roza. El único SQL nuevo es un `SELECT` **local** de una fila que ya está sincronizada.

---

## 2. El patrón canónico (ya en el repo, 6 veces)

Fuente de verdad: `ProfileContext.tsx:161-169`, que se auto-documenta como tal. Idéntico en `animales.tsx:196`, `(tabs)/index.tsx:472`, `useGroupView.ts:342`, `useManeuverGating.ts:115`, `mas.tsx:127`.

```ts
import { useStatus } from '@powersync/react';

const syncStatus = useStatus();
const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;

useEffect(() => {
  if (lastSyncedMs === 0) return;   // E4: sin ningún sync, no dispara
  void reload();
}, [lastSyncedMs, /* deps primitivas */]);
```

Tres propiedades que importan y que la variante rota no tiene:

1. **Re-dispara en CADA avance** (no una sola vez): es todo el fix de A1/A2/A3.
2. **Dep primitiva** (`number` en ms), estable entre statuses iguales → sin loop (E3).
3. **Guardado en `0`** → offline puro y arranque intactos (E4).

`useStatus()` está disponible en los tres archivos: `PowerSyncProvider` envuelve a `ProfileProvider → EstablishmentProvider → RodeoProvider → RootGate → Stack` (`app/app/_layout.tsx`).

---

## 3. Diff conceptual por archivo

### 3.1 `EstablishmentContext.tsx`

**Sale** (líneas 323-350) el bloque `registerListener` + `lastHasSynced` + el comentario que declara cubierta una reactividad que no existe.

**Entra**:

```
useStatus() → lastSyncedMs

useEffect([lastSyncedMs, userId, refreshEstablishments]):
  if (lastSyncedMs === 0) return
  void refreshEstablishments()
```

`applyMemberships` incorpora el veredicto puro de §4.3 antes de emitir `active_lost`, y el diferimiento de §5 después de él.

**No hace falta distinguir el origen de la re-lectura** (`'sync'` vs. `'user'`). Con evidencia afirmativa, la regla es la misma para todos los disparadores (R20.17): un `refreshEstablishments` post-acción también consulta la evidencia, y también acierta. Esto **simplifica** el diff respecto de la versión anterior de esta spec: no se agrega ningún parámetro a `refreshEstablishments` y los 5 llamadores quedan literalmente intactos.

Como `applyMemberships` pasa a necesitar una lectura asíncrona (solo en el caso sospechoso), su cuerpo se parte en dos: la resolución síncrona (idéntica a hoy) y una rama `async` que corre **únicamente** cuando `detectActiveLost` dice que el activo no está en el set (R20.32). El camino feliz —el 99,9 % de los checkpoints— no gana ni una query.

Se agrega el guard de equivalencia (R20.11) antes de `setState`: `EstablishmentContext` está en la raíz del árbol y su `value` se recrea en cada render → sin el guard, **cada checkpoint re-renderiza la app entera**. Con el guard, un checkpoint que no cambia nada es un no-op observable.

### 3.2 `RodeoContext.tsx`

**Sale** (líneas 140-168): `isWaitingRef` **completo** + el `registerListener`/`lastHasSynced`.

**Entra**: el mismo efecto con `load(userId, establishmentId)` — sin parámetro de origen, por el mismo motivo que en §3.1.

Dos cuidados propios de este contexto:

- **`load` no debe tumbar un estado resuelto.** Hoy, ante `!result.ok`, hace `setState({ status: 'loading' })` (línea 126). Con el latch eso solo podía pasar en el bootstrap; siendo reactivo, un fallo transitorio post-arranque **mandaría la app entera al splash** (el `RootGate` mantiene splash mientras `rodeo.status === 'loading'`). R20.10: en una **re-lectura reactiva** con estado ya resuelto, se conserva el estado y solo se setea `error`.
- **Falso `no_rodeos` = bloqueo total, y además rompe D1.** `no_rodeos` fuerza `/crear-rodeo` sobre toda la app (spec 02 R2.6). Es el mismo modo de falla que un falso `active_lost` y recibe la misma evidencia afirmativa (R20.18): un set de rodeos vacío solo concluye `no_rodeos` si el rol local en el campo activo sigue `active = 1`. Ver §8 riesgo 7 — sin esta guarda, `RodeoContext` **anula** el diferimiento de D1.

`applyRodeos` ya preserva el rodeo preferido si sigue en el set (R20.19): se conserva tal cual y se le agrega test.

### 3.3 `lotes.tsx`

Junto al `useEffect(() => { void load(); }, [load])` mount-only:

```
useEffect([lastSyncedMs, load]):
  if (lastSyncedMs === 0) return
  void load({ silent: true })
```

**`silent: true` es obligatorio** (R20.9): la ruta no-silenciosa setea `loading` → desmonta la lista → resetea el scroll y, ante un fallo, hace `setGroups([])`. Con `silent`, un fallo transitorio conserva la lista montada (ya está implementado así en `load`).

---

## 4. E1 — falso `active_lost` por sync parcial · **el riesgo central de la feature**

### 4.1 Qué hay que demostrar

Que `lastSyncedAt` solo avanza cuando se aplicó un checkpoint **completo y consistente**, y que por lo tanto una lectura disparada por ese avance nunca ve un estado "a mitad de bajar".

### 4.2 Evidencia (verificada en este repo, no asumida)

1. **`lastSyncedAt` se deriva exclusivamente del estado de prioridad FULL.**
   `app/node_modules/@powersync/common/lib/client/sync/stream/core-instruction.js:22` → `lastSyncedAt: completeSync?.lastSyncedAt`, donde `completeSync = status.priority_status.find(s => s.priority == FULL_SYNC_PRIORITY)`. No hay ninguna otra ruta que lo escriba (`grep lastSyncedAt` sobre todo `@powersync/*`).
2. **La semántica de esa entrada es "vista consistente sobre todos los buckets".**
   `SyncStatus.js:111-124` (doc del SDK shipped): *"When a consistent view over all buckets for all priorities up until the given priority is reached, PowerSync makes data from those buckets available"*. Y `SyncStatus.d.ts` sobre `lastSyncedAt`: *"Time that a last sync has **fully completed**"*.
3. **En miTropero no hay prioridades declaradas.** `sync-streams/rafaq.yaml`: las 31 streams se declaran sin `priority` → todas caen en la prioridad completa. No existe el escenario "PowerSync publicó los buckets de prioridad 1 y todavía no los de 3" que es el único caso documentado de visibilidad parcial.
4. **La validación y aplicación del checkpoint no vive en JS.** `@powersync/common@1.53.2` delega el ciclo entero al core Rust (`powersync_control` / `UpdateSyncStatus`); no queda código JS de `sync_local`/checksums (grep vacío sobre `common/lib`). El SDK ni siquiera expone ya la implementación JS (`clientImplementation` está marcada deprecada: *"RUST is the only option"*). No hay, del lado del cliente, un camino que aplique ops sueltas a las tablas de usuario fuera de un checkpoint validado.
5. **Ordenamiento causal del lado del servicio** (razonamiento, no verificación directa): la fila de `establishments` solo sale del SQLite local cuando el bucket de `est_establishments` se remueve, y eso solo ocurre cuando `org_scope` deja de incluir el campo — es decir, **causado por** el cambio en `user_roles`. El servicio procesa el WAL en orden, así que la remoción del bucket no puede preceder al commit que la origina.

**Conclusión**: la evidencia 1-4 es fuerte y verificable en el repo; la 5 es inferencia sobre el servicio (no auditable desde acá). Por eso **no se da por bueno**: la decisión de revocar no se apoya en esta demostración, sino en la evidencia afirmativa de §4.3, que es correcta **con o sin** el supuesto 5.

### 4.3 La regla de decisión: EVIDENCIA AFIRMATIVA (no inferencia por ausencia)

#### El hecho que la habilita

`sync-streams/rafaq.yaml` (líneas 71-74):

```yaml
self_user_roles:                           # membresías del propio usuario
  auto_subscribe: true
  queries:
    - SELECT * FROM user_roles WHERE user_id = auth.user_id()
```

Sin `org_scope`. Sin filtro `active`. Consecuencia dura: **la fila de rol del propio usuario nunca desaparece del SQLite local por una revocación** — queda ahí, con `active = 0`. (La fila también viaja por `est_members_roles` para los owners, pero esa stream sí filtra `active = true AND establishment_id IN owner_scope`; da igual: PowerSync conserva una fila mientras siga en al menos un bucket vivo, y `self_user_roles` siempre lo está.)

Es decir: en el momento exacto en que `establishments` desaparece del local, **hay una fila que sobrevive y dice explícitamente qué pasó**. Eso convierte una conjetura ("el set vino vacío… ¿habrá terminado el sync?") en un hecho leído.

> ⚠️ **Esto NO es un control de acceso** (hardening pedido por Gate 1, MED-1). Esta fila es **dato local en un device que el usuario controla**: la evidencia afirmativa decide una transición de **UI** —qué pantalla mostrar—, nunca un permiso. El enforcement es server-side y no depende de ella: `has_role_in` (`supabase/migrations/0005_rls_helpers.sql:9-25`) exige `ur.active = true` **y** `e.deleted_at is null` leyendo la DB en cada lectura y cada escritura, y todos los RPC del outbox son `SECURITY DEFINER` con ese guard antes de tocar nada. Un cliente que falsee esta fila para no ver el `active_lost` conserva una vista de datos que PowerSync ya le está borrando, y **no gana ninguna capacidad de leer ni de escribir nada**. Leer "hecho leído", "determinista" o "evidencia afirmativa" como primitivas de autorización sería un error: son adjetivos sobre la calidad de una señal de UX.

#### La función pura

Vive en `app/src/utils/establishment.ts`. Un único veredicto, compartido por membresías y rodeos:

```
assessDisappearance({ hadValue, stillPresent, roleEvidence }) →
  'present'       // nada que concluir
  'confirmed'     // revocación real
  'inconclusive'  // inconsistencia transitoria: no cambiar de estado
```

`roleEvidence: 'absent_or_inactive' | 'active' | 'unknown'`, resuelto por `hasActiveLocalRole(userId, establishmentId)` (§4.4).

| Situación | Veredicto | Por qué |
|---|---|---|
| No había valor activo previo (`hadValue = false`) | `present` | No hay nada que perder. |
| El id activo sigue en el set | `present` | Caso normal — no se consulta la evidencia (R20.32). |
| Rol local **ausente o `active = 0`** | `confirmed` | Hecho leído: te revocaron (o borraron el campo — §6). Vale con set vacío **y** con set poblado. |
| Rol local **`active = 1`** | `inconclusive` | El local se contradice: el rol dice que tenés acceso pero el campo no está. Es un estado en tránsito, no una revocación. |
| Evidencia **no legible** (`unknown`) | `inconclusive` | Fail-safe (R20.30): la falta de evidencia nunca decide en contra del usuario. |

#### Por qué esto elimina el timer, y no lo esconde como fallback

La versión anterior de esta spec confirmaba un set vacío con una segunda lectura y un timer de 4 s. Queda **borrada**, no dormida. El motivo por el que el timer existía era que "set vacío" podía ser un estado terminal: si nadie mandaba otro checkpoint, la sospecha nunca se resolvía y el usuario quedaba en una home muerta.

Con evidencia afirmativa ese callejón no existe:

- `'confirmed'` se decide **en la misma lectura**, sin esperar nada. Un usuario revocado de su único campo recibe el aviso al primer checkpoint, no 4 s después.
- `'inconclusive'` es, **por definición**, un estado a mitad de camino: el local tiene un rol activo cuyo campo todavía no llegó (o cuya baja todavía no llegó). Eso implica que **hay más sync en vuelo**, y el próximo checkpoint —que llega solo, sin timer— lo resuelve. No es una espera con vencimiento: es la ausencia de una decisión hasta que haya sobre qué decidir.

Además desaparece el número mágico. Un umbral temporal se evalúa justo cuando la red está peor, que en la manga es la condición normal: era la peor variable posible para arbitrar si a un peón se lo saca o no de su campo.

#### Blast radius si aun así se colara un falso positivo

`applyMemberships` limpia `preferredIdRef`/`currentIdRef` al entrar en `active_lost`, así que el siguiente checkpoint re-resuelve a `active` solo (1 campo → auto-activo). Un falso `active_lost` **se auto-cura**: el daño máximo es una pantalla de aviso espuria, no una sesión perdida.

#### Delimitación que pedía el context, ahora más fuerte

El context pedía distinguir "lista vacía" (transitorio) de "lista poblada sin el campo activo" (revocación real). Esa distinción era una **aproximación** a la pregunta correcta. La evidencia afirmativa contesta la pregunta correcta directamente, y de paso cubre los dos casos que la aproximación erraba:

- **lista poblada sin el campo activo, pero con el rol local todavía `active = 1`** → la heurística concluía revocación; la evidencia dice `inconclusive`. (La aproximación tenía un falso positivo.)
- **lista vacía con el rol local `active = 0`** → la heurística no concluía y esperaba 4 s; la evidencia concluye ya. (La aproximación tenía un retardo innecesario.)

### 4.4 La lectura de la evidencia

`buildActiveRoleQuery(userId, establishmentId)` en `services/powersync/local-reads.ts` (puro, testeable):

```sql
SELECT active FROM user_roles WHERE user_id = ? AND establishment_id = ? LIMIT 1
```

`hasActiveLocalRole(userId, establishmentId)` en `services/establishments.ts`, vía `runLocalQuerySingle` con **`emptyIsSyncing: false`**: acá "fila ausente" es un **resultado legítimo** (rol hard-deleteado / CASCADE), no una degradación a "sincronizando". Mapeo:

| Resultado local | `roleEvidence` |
|---|---|
| `ok`, fila con `active = 1` | `'active'` |
| `ok`, fila con `active = 0` | `'absent_or_inactive'` |
| `ok`, sin fila | `'absent_or_inactive'` |
| `!ok` (error de lectura) | `'unknown'` |

`active` es `column.integer` en el schema del cliente (`services/powersync/schema.ts:102`) → se compara contra `1`, no contra `true` (booleans Postgres llegan como INTEGER, convención ya documentada en spec 15).

**Costo**: una sola query indexada por `(user_id, establishment_id)`, ejecutada **solo** cuando el activo no aparece en el set (R20.32). Cero llamadas de red (R20.31): la fila ya está sincronizada localmente, que es justo el punto.

`emptyIsSyncing: false` **ya es el default** de `runLocalQuerySingle` (`local-query.ts:72`); se explicita en la llamada por legibilidad —el lector tiene que ver que "sin fila" es un resultado de negocio— pero **no cambia comportamiento** (Gate 1 L3).

#### `unknown` sin salida terminal — limitación conocida y aceptada (Gate 1 MED-2)

`'inconclusive'` derivado de `roleEvidence: 'active'` se resuelve solo: es un estado a mitad de camino y el próximo checkpoint lo cierra (§4.3). Pero `'inconclusive'` derivado de `'unknown'` **no** tiene esa garantía: `unknown` sale de un fallo de lectura del SQLite local, y un SQLite corrupto falla siempre, no una vez. R20.25 tampoco rescata (quita el diferimiento en arranque en frío, pero la regla de evidencia se re-aplica idéntica).

**Decisión del leader: se acepta como limitación conocida, sin contador ni piso.** Razones:

1. **El blast radius es una vista vacía, no una fuga.** PowerSync ya borró las filas; concluir o no concluir la revocación **no cambia qué datos hay en el device**. Verificado por Gate 1: `active_lost` no dispara ningún purge local (no hay `disconnectAndClear` en ese camino).
2. **Darle un piso exigiría reintroducir un contador** — exactamente la clase de heurística que §9.2 acaba de eliminar — por un caso cuyo peor desenlace es una pantalla vacía. Mal negocio.
3. **El escenario está subsumido por una falla mayor**: si la lectura del SQLite local falla de forma persistente, `loadMemberships` también falla y la app está rota de punta a punta, no solo en esta decisión.

**Lo que no se acepta es que sea silencioso** (R20.37): el camino `unknown` registra por el canal de diagnóstico —`console.warn` con prefijo estable, mismo idioma que `connector.ts:199`— el `establishmentId` y la clase de error, **nunca** datos de campo ni PII (misma regla dura que "NUNCA se loguea `opData`"). Se registra en la **transición** a ilegible, no en cada checkpoint (higiene de log; no es un contador ni participa del veredicto). Hoy no existe canal de telemetría en el repo —el único surfacing observable es `upload-rejections.ts`, específico de rechazos de maniobra—, así que este log es el mínimo honesto y queda como **hook explícito para la feature 17 (observabilidad)**, que ya está `context_ready`.

Distinción que importa: R20.30 (no concluir revocación sin evidencia) sigue siendo **fail-safe**; R20.37 no lo debilita — solo hace **visible** que no se pudo verificar.

### 4.5 Lo que ya estaba bien y se preserva

`applyMembershipsResult` distingue "fallo `network` con first-sync pendiente" (→ no afirma nada) de "fallo genuino" (→ solo cae a `no_establishments` si estaba en `loading`). Esa lógica se mantiene intacta: es la primera línea de defensa (R20.16) y el motivo por el que el bootstrap no produce onboarding fantasma. La guarda de §4.3 se apila **encima**, para el caso post-sync que esa regla no cubre.

---

## 5. D1 / D1.1 / D1.2 — revocación en caliente

### 5.1 Cuál es la señal concreta de "hay maniobra en curso"

**Decisión: la ruta activa** — `useSegments()[0] === 'maniobra'` (predicado puro `isManeuverRouteSegment(segments)`).

Cubre todo el flujo bajo el top-segment `maniobra`: `maniobra/jornada` (wizard), `maniobra/identificar`, `maniobra/carga` (frame de carga rápida) y el modal `maniobra`.

`useSegments()` funciona dentro de `EstablishmentProvider` aunque el provider esté **fuera** del `<Stack>`: `expo-router@56` lo implementa con `useSyncExternalStore` sobre un store **global** (`build/global-state/useRouteInfo.js:10`), no sobre un contexto de React Navigation. Verificado en `node_modules`.

### 5.2 Por qué NO la tabla `sessions` (candidata obvia, y es una trampa)

La señal "natural" sería `sessions.status = 'active'` (la misma que usa "retomar la jornada"). **No sirve, y precisamente en el único momento en que haría falta**: `sessions` sincroniza por `est_sessions`, scopeada por `org_scope`. Cuando el rol se revoca, PowerSync **borra ese bucket** → la fila de la sesión activa **desaparece del SQLite local** (eso es E2). O sea: en el instante exacto en que el contexto detecta la revocación, la tabla `sessions` ya no tiene evidencia de que haya una maniobra en curso, y la guarda concluiría "no hay maniobra" → patearía al operario, que es exactamente lo que D1 prohíbe.

La señal tiene que ser **client-side pura** (la ruta), que sobrevive al borrado del bucket.

### 5.3 Mecánica

```
pendingRevocationRef: { name } | null

applyMemberships, veredicto 'confirmed':
  si estamos en ruta de maniobra → guardar pendingRevocation { id, name }, NO cambiar de estado,
                                    y MERGEAR el campo revocado en `available` (ver abajo)
  si no                          → emitir active_lost (as-built)

useEffect([inManeuverRoute]):
  si !inManeuverRoute && pendingRevocation → re-verificar (ver abajo) → emitir active_lost o descartar
```

Al emitirse `active_lost`, el `RootGate` (que ya reacciona a `est`) rutea a `/campo-perdido` — sin tocar `_layout.tsx`.

El pendiente vive en un `ref` (memoria): un arranque en frío re-evalúa desde cero y, si la revocación persiste, avisa de inmediato (R20.25).

#### Qué contiene `available` durante el diferimiento (Gate 1 L1 — R20.33)

Sin definirlo, el diferimiento tiene un bug silencioso: `applyMemberships` escribe `availableRef.current` (`EstablishmentContext.tsx:140`) **antes** del chequeo de `lost` (`:142`). Si el diferimiento se limita a "no cambiar de estado", queda `state.available` **con** el campo revocado (estado viejo) y `availableRef.current` **sin** él (set fresco). Como `switchEstablishment` lee del ref (`:231`), el usuario que intenta cambiarse a otro campo dispara `applyMemberships` → `currentId` sigue siendo el revocado → vuelve a diferir → **el switch queda en no-op silencioso**.

**Regla: durante el diferimiento el campo revocado se conserva en `available`, en una sola fuente.** `availableRef.current` y `state.available` deben contener lo mismo: el set fresco **más** el campo revocado mergeado. Se preserva así la invariante que `resolveState` ya garantiza —el campo activo siempre pertenece al conjunto disponible— y el switch vuelve a funcionar: con `available = [revocado, B]`, elegir B resuelve `active` sobre B con normalidad.

El mecanismo es **el mismo que ya existe dos líneas más arriba** para el caso opuesto: `pendingCreatedRef` mergea un campo que el sync todavía **no trajo** (aterrizaje optimista); `pendingRevocationRef` mergea uno que el sync **ya se llevó**. Misma forma, dirección inversa — se implementa con el mismo patrón, no con uno nuevo.

Corolario (R20.34): si el usuario se cambia de campo durante la ventana, el pendiente se descarta sin aviso. Ya no está parado sobre el campo revocado, así que no hay nada que avisarle; el campo desaparece solo del set en el siguiente checkpoint (con `currentId` apuntando a otro lado, `detectActiveLost` deja de dispararse y el merge se apaga).

#### Re-verificación al emitir (Gate 1 L2 — R20.35)

Entre la detección y la salida de la maniobra puede pasar cualquier cosa: el usuario cambió de campo activo, o el owner le devolvió el rol. Emitir a ciegas produciría un `active_lost` espurio nombrando un campo que el usuario **sí** tiene. Antes de emitir se exigen dos condiciones:

1. `pendingRevocation.id === currentIdRef.current` (sigue siendo el campo activo), y
2. `hasActiveLocalRole(userId, pendingRevocation.id)` sigue devolviendo `'absent_or_inactive'`.

Si alguna falla → se descarta el pendiente sin emitir. Es una lectura local extra en un camino raro (una vez por salida de maniobra con pendiente), no en el camino caliente.

### 5.4 Límites explícitos (D1.1 y D1.2) — leer con atención

Durante el diferimiento, el contexto sigue en `active` sobre un campo revocado. Eso significa, textualmente:

- ✅ **Sí**: el usuario no es sacado de la pantalla **por decisión de esta feature**; el aviso llega al salir de la maniobra.
- ❌ **No (D1.1 / E2)**: esta feature **no** garantiza que los animales cargados en esa maniobra sigan existiendo, ni que los writes encolados lleguen al servidor. PowerSync ya borró el bucket (las filas locales pueden desaparecer bajo la pantalla) y los writes del outbox rebotan por RLS (42501 → `rollbackOverlay`). **Eso es E2 y está fuera de esta feature por D3.**
- ❌ **No (D1.2 / auth)**: el diferimiento **no sobrevive a la caída de la sesión**, y en el camino de remoción de miembro la sesión se cae por diseño.

#### La ventana real, por causa (D1.2, verificado en código)

`remove_member` hace **dos** cosas, no una (`supabase/functions/remove_member/index.ts:87-113`): desactiva el rol **y** llama a `revoke_user_sessions`, que ejecuta `delete from auth.sessions where user_id = target_uid` (`0072:46`). Los JWT de Supabase son stateless, así que el access token vigente sigue sirviendo hasta `jwt_expiry = 3600` (`supabase/config.toml:160`); al vencer, el refresh falla, `onAuthStateChange` emite `session = null` (`AuthContext.tsx:114-115`) y el `RootGate` rutea a login **con la maniobra abierta**.

| Causa | Sesión | Ventana real del diferimiento | Desenlace |
|---|---|---|---|
| **Remoción de miembro** (`remove_member`) | revocada (`0072`) | ≤ `jwt_expiry` (3600 s) | **login**, sin aviso de campo perdido |
| **Campo borrado** (trigger `0076`) | intacta | ilimitada | `/campo-perdido` al salir de la maniobra |

`EstablishmentContext` **no puede evitarlo**: auth vive por encima suyo, y el `RootGate` evalúa el gate de sesión antes que el de establecimiento. Tampoco se intenta: `revoke_user_sessions` es correcto y fue una decisión deliberada (H1-1, revisión empírica) — matar la sesión al remover a alguien **acorta** la ventana y es fail-closed. Lo que se corrige acá es **la promesa**, no el mecanismo.

Ninguna cadena de UI ni de documentación de esta feature puede sugerir lo contrario (R20.26, R20.36).

### 5.5 Nota de seguridad (insumo para Gate 1)

Durante la ventana de diferimiento el usuario **ve** datos de un campo al que ya no tiene acceso. Precisiones para el análisis:

- La **frontera de autorización real no se toca**: RLS server-side y el scoping de las sync streams siguen exactamente igual. Ningún dato nuevo baja al dispositivo por este cambio; al contrario, PowerSync está borrando activamente lo que había.
- Lo que se difiere es **una decisión de UI** sobre datos que ya estaban en el SQLite local del dispositivo antes de la revocación.
- La ventana está **acotada por tres cosas**: la navegación del propio usuario (sale de la maniobra → se aplica), el ciclo de vida del proceso (arranque en frío → sin diferimiento) y, en el camino de remoción de miembro, **la vigencia de la sesión** (≤ `jwt_expiry`, §5.4).
- Cualquier **escritura** durante la ventana es rechazada por RLS al subir (`has_role_in` lee `user_roles` de la DB, no del token) → `42501` → `permanent_reject`. No hay elevación de privilegio ni write que sobreviva.
- La evidencia afirmativa que decide el aviso es **señal de UX, no control de acceso** (§4.3).

---

## 6. E5 — campo activo borrado vs. revocado

### 6.1 Los dos caminos, verificados columna por columna

> **Re-examinado a pedido del leader tras el swap.** La pregunta era razonable: si ahora la fila de rol propia está siempre a la vista, ¿no permitirá distinguir revocación de borrado? La respuesta es **no**, y el motivo es exactamente el que el leader sospechaba — el trigger de la 0076.

| Causa | Escritura server-side | Huella en el SQLite local |
|---|---|---|
| **Revocación de rol** (owner remueve a un miembro) | `supabase/functions/remove_member/index.ts:88-92` → `update user_roles set active = false, deactivated_at = now()` | `user_roles` **queda** con `active = 0` y `deactivated_at` sellado; `establishments` **desaparece** (sale de `org_scope` → bucket removido). |
| **Campo borrado** (owner soft-deletea el campo) | Trigger `deactivate_roles_on_establishment_soft_delete` (migración 0076) → `update user_roles set active = false, deactivated_at = now()` | **Idéntica**: `user_roles` con `active = 0` y `deactivated_at` sellado; `establishments` fuera del set local. |

Los dos caminos escriben **el mismo par de columnas con los mismos valores**. No hay una tercera columna que los separe: `role` no cambia, `deactivated_at` se sella en ambos, y la fila de `establishments` (que sí tendría `deleted_at`) ya no está en el local en ninguno de los dos casos — es precisamente lo que hay que explicar.

La ironía que cierra el tema: **el mismo mecanismo que hace determinista la guarda de §4.3 es el que colapsa las dos causas en una sola firma.** El trigger 0076 existe para que `user_roles.active = true` sea un proxy *fiel* de "campo vivo" (lo dice su propio comentario) — y esa fidelidad es lo que hace confiable la evidencia afirmativa. El costo de esa fidelidad es que `active = 0` significa "perdiste el acceso" sin decir por qué.

La propia migración 0076 lo documenta como limitación conocida: *"un `user_roles.active = false` puede deberse a DOS causas distintas e **indistinguibles a posteriori** — (1) el campo se soft-deleteó (este trigger), o (2) un owner removió a ese miembro"*.

> ⚠️ **Alcance exacto de "indistinguibles" (Gate 1 HIGH-1).** Lo son **en la firma local** —las columnas que quedan en el SQLite—, que es el único insumo del aviso y del copy, y por eso R20.27/R20.28 las tratan igual. **No** lo son en la **duración de la ventana de diferimiento**: `remove_member` revoca la sesión y el trigger `0076` no (tabla en §5.4). Son dos ejes distintos; confundirlos fue lo que Gate 1 marcó como pisado en la versión anterior de este documento.

**Conclusión: la afirmación "indistinguibles bit a bit" se mantiene —acotada a la firma local—, ahora con evidencia más fuerte que antes** (antes se apoyaba en que ambos caminos ponían `active = false`; ahora se verificó que además coinciden en `deactivated_at` y que no queda ninguna otra columna local disponible).

Casos de borde revisados, por completitud:
- **Hard-delete del campo** (CASCADE, solo lo hace el cleanup de los tests): la fila de rol también se borra → `'absent_or_inactive'` → mismo veredicto. Tampoco distinguible.
- **Único owner**: `remove_member` rechaza remover al único owner activo (409 `last_owner`), así que para un usuario que era el único owner la causa **solo puede ser** el borrado del campo. Pero el cliente no puede saber localmente si era el único owner (las filas de coworkers salen del local junto con el bucket), así que no es una señal utilizable. Además ese caso suele ser auto-infligido (el owner borra su propio campo desde "Más"), donde el aviso ni siquiera hace falta.

### 6.2 Resolución

**Mismo tratamiento** (R20.27): aviso + re-ruteo por cantidad de campos restantes vía `acknowledgeActiveLost`. No se inventa una distinción que el cliente no puede sostener.

Consecuencias, deliberadas:

- El contexto sigue emitiendo siempre `reason: 'role_revoked'` (as-built). **La rama `establishment_deleted` de `campo-perdido.tsx` es código muerto hoy** — nunca se produce. Se conserva el valor en el tipo (no se rompe la firma pública; queda listo si algún día llega una señal server-side) y se documenta como no-alcanzable (R20.29).
- Se corrige el **copy** de la rama viva, que hoy afirma una causa única y falsa la mitad de las veces:
  - Antes: *"Te quitaron el acceso a este campo. Tu cuenta sigue activa."*
  - Después (verdadero en ambos casos): *"Ya no tenés acceso a este campo. Puede que te lo hayan quitado o que el campo se haya eliminado. Tu cuenta sigue activa."*
- El "conocer la causa exacta" (distinguir borrado de revocación) requeriría una señal server-side nueva → **backlog**, no esta feature.

### 6.3 ¿Un borrado es definitivo y una revocación reversible? (la pregunta del context)

Sí, conceptualmente — pero la diferencia **no cambia ninguna acción del usuario en el MVP**: en ambos casos el destino es el mismo (aviso → campos restantes → home / "Mis campos" / wizard), no hay flujo de "pedir que me devuelvan el acceso", y no existe restore de campos (la migración 0076 lo dice: *"Hoy NO existe flujo de restore/undelete de establecimientos en el MVP"*). Como la distinción no habilita ninguna acción distinta y no es observable desde el cliente, **distinguirla sería costo sin beneficio**. Si el día de mañana aparece el restore, la reactivación del rol tendrá que resolverse server-side de forma explícita — y recién ahí el cliente podrá recibir una razón fiel.

---

## 7. E3 y E4 — ya resueltos por el patrón canónico (se documentan, no se re-inventan)

- **E3 — loop de re-lectura.** La dep es `lastSyncedMs: number`, no el objeto `SyncStatus`. Es estable entre statuses iguales, así que el efecto solo corre cuando hay un sync nuevo (`ProfileContext.tsx:162`). Las demás deps de los efectos son primitivas o callbacks estables (`refreshEstablishments` depende de `[userId, applyMembershipsResult]`, y `applyMembershipsResult` de `[applyMemberships]`, que es `[]`). Refuerzo específico de esta feature: el guard de equivalencia (R20.11) corta el ciclo render→setState→render aunque el set no cambie.
- **E4 — offline puro.** `lastSyncedMs === 0` → el efecto retorna sin hacer nada (`ProfileContext.tsx:167`). Bonus documentado por el SDK: `lastSyncedAt` *"is reset to null after a restart of the PowerSync service"* (`SyncStatus.d.ts`) → si vuelve a 0, el guard lo trata como "todavía no hubo sync" y no toca el estado resuelto (R20.8).

---

## 8. Riesgos NUEVOS que introduce hacer reactiva la lectura (y su mitigación)

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Falso `active_lost` por lectura transitoria. | §4.3 (evidencia afirmativa). R20.12-R20.17, R20.30. |
| 2 | Falso `no_rodeos` → **bloqueo total** de la app (`/crear-rodeo`). Mismo modo de falla, superficie distinta. | Misma evidencia afirmativa aplicada a rodeos. R20.18. |
| 3 | Un fallo transitorio de la re-lectura de rodeos tumba a `loading` → **splash sobre toda la app**. | R20.10: una re-lectura reactiva con estado resuelto no vuelve a `loading`. |
| 4 | Tormenta de re-render: `EstablishmentContext` está en la raíz y su `value` se recrea en cada render → cada checkpoint re-renderizaría la app entera. | R20.11: guard de equivalencia antes de `setState` (estado + id activo + set + rol). |
| 5 | Parpadeo/scroll reseteado en `/lotes`. | R20.9: `load({ silent: true })`. |
| 6 | El rodeo activo cambia bajo los pies del operario si un coworker lo borra a mitad de jornada. | `applyRodeos` ya preserva el preferido mientras exista (R20.19). El caso "el rodeo activo fue borrado durante la maniobra" **no** lo cubre D1 (que habla de revocación de campo) → se documenta como limitación conocida y va al backlog, no se inventa una decisión nueva. |
| 8 | 🔴 **Falso verde del E2E de D1.** Un fixture que solo hace `update user_roles set active = false` **no** es el camino de producción: `remove_member` además revoca la sesión. Un T21 montado sobre ese fixture daría verde sobre una garantía que producción no da — en la feature que nació de un comentario mentiroso, es el peor resultado posible. | T16 espeja `remove_member` **completo** (incluye `revoke_user_sessions`) y T21 **verifica server-side que la sesión quedó revocada** antes de asertar el diferimiento. Lo que T21 prueba queda declarado con precisión: el diferimiento **dentro de la vida del access token**, no más. |
| 7 | 🔴 **`RodeoContext` anula el diferimiento de D1.** Descubierto al revisar el swap. Al revocarse el acceso, PowerSync borra **también** el bucket `est_sessions`/`est_rodeos` → `fetchRodeos` devuelve `[]` con `hasSynced = true` → `no_rodeos` → el `RootGate` hace `router.replace('/crear-rodeo')` sobre la pantalla de maniobra. El operario termina pateado igual, aunque `EstablishmentContext` haya diferido correctamente: el gate de rodeo corre **después** del de establecimiento, sobre un estado `active` que sigue siendo válido. | R20.18: `no_rodeos` exige evidencia afirmativa (rol local `active = 1`). Durante una revocación el rol está en `0` → `inconclusive` → `RodeoContext` conserva su estado y el diferimiento sobrevive. Implementa T13; lo verifica el E2E T21 (assert de que tampoco se navegó a `/crear-rodeo`). |

---

## 9. Alternativas descartadas

### 9.1 Migrar a watched queries (`useQuery` / `db.watch`) — DESCARTADA EN LA 20, HECHA EN LA 21

Sería la solución de fondo: la UI se re-renderiza sola ante cualquier cambio del SQLite local y el re-fetch manual desaparece. Se descarta porque **es deuda de arquitectura explícita y deliberada** (`specs/active/15-powersync/design.md`, `docs/backlog.md:417`, desde 2026-06-09), la app tiene **cero** watched queries hoy, y migrarlas es una decisión de arquitectura que merece su propio ADR. Meterlo acá convertiría un fix de 3 archivos en una refactorización transversal — y el bug reportado por Raf seguiría abierto mientras tanto. El context lo excluye textualmente (§5).

> **RECONCILIACIÓN (feature 21, 2026-07-21).** Esta alternativa se ADOPTÓ en la feature siguiente: la 21 migró los 3 consumidores a watched queries reales (ADR-030). Precisión de nomenclatura verificada en `node_modules`: los 2 CONTEXTOS usan **`db.onChange(handler, { tables })`** (una watched query imperativa que NOTIFICA el cambio de tabla y re-corre la resolución existente de la 20 — encaje exacto porque los contextos corren evidencia/veredicto, no consumen filas), NO `db.watch(sql, …)`; `lotes.tsx` usa **`useQuery`**. El disparador `lastSyncedMs` de la 20 fue reemplazado; la lógica de resolución de la 20 se preservó intacta. Ver `specs/active/21-watched-queries/design.md`.

### 9.2 Guarda de E1 por **confirmación temporal** (set vacío + re-verificación a los 4 s) — DESCARTADA

Fue la propuesta original de esta spec y el leader la rechazó explícitamente (2026-07-19) en favor de la evidencia afirmativa de §4.3. Se registra porque el razonamiento vale para futuras decisiones del mismo tipo:

> concluir `active_lost` si el set vino **poblado** sin el campo activo; si vino **vacío**, marcar sospecha y confirmar con una segunda lectura (nuevo checkpoint o timer de 4 s, lo que llegue primero).

Se descarta por tres razones, en orden de peso:

1. **Es una heurística temporal en el camino crítico del riesgo central.** El umbral se evalúa justo cuando la red está peor — que en la manga es la condición **normal**, no el caso raro. Un fallo del umbral saca a un peón de su campo con las manos en el brete.
2. **Infiere por ausencia en vez de leer un hecho.** "El set vino vacío, esperemos a ver" es una conjetura sobre si el sync terminó; "el rol local está inactivo" es un dato verificable y determinista. Existiendo el segundo, el primero es injustificable.
3. **Erraba en los dos bordes** (ver §4.3): falso positivo con set poblado + rol todavía activo; retardo innecesario con set vacío + rol ya inactivo.

El costo marginal que motivaba la propuesta (2 archivos extra) resultó irrelevante frente al determinismo en el riesgo principal, y postergarla habría obligado a reescribir `assessDisappearance` y todos sus tests más adelante.

### 9.3 Señal de "maniobra en curso" leída de la tabla `sessions` — DESCARTADA (es incorrecta)

Ver §5.2: el bucket que contiene esa fila es justamente el que PowerSync borra al revocar el acceso. La señal desaparece en el instante exacto en que hay que consultarla.

### 9.4 `useFocusEffect` en los dos contextos — DESCARTADA

Es lo que el comentario de `EstablishmentContext.tsx:331-332` afirmaba (falsamente) que ya existía. No aplica: los contextos **no son pantallas**, no reciben foco. Y aunque se colgara de las pantallas, el bug de Raf ocurre **sin cambiar de pantalla** (la app viva, quieta en la home). Focus-only es "degradado"; acá haría falta "reactivo".

### 9.5 Diferir la revocación por un bridge desde `RootGate` (`setManeuverBusy` en `_layout.tsx`) — DESCARTADA

Arquitectónicamente más limpia (el contexto de datos no sabría de rutas), pero agrega un sexto archivo — el layout raíz, el más delicado de la app — para obtener exactamente la misma señal que `useSegments()` da dentro del contexto. Con `useSegments()` implementado sobre un store global (§5.1), el acoplamiento es a una **lectura** del router, no a la jerarquía de navegación.

---

## 10. Cumplimiento de los MUSTs de miTropero

- **Multi-tenancy / RLS**: la feature toca el contexto que decide el `establishment_id` activo, así que se declara explícitamente: **no se modifica ninguna policy RLS, ninguna migración, ni ninguna sync stream**. El set de campos accesibles se sigue derivando de `auth.uid()` vía `org_scope` + RLS; el cliente nunca hardcodea `establishment_id` (`CLAUDE.md` ppio 6). El único cambio con implicancia de acceso es la ventana de diferimiento de §5, analizada en §5.5 (insumo de Gate 1).
- **Offline-first**: todas las lecturas afectadas ya salen del SQLite local (spec 15); esta feature no agrega ni una llamada de red. Sin conexión, `lastSyncedMs` queda en 0 y el comportamiento es idéntico al de hoy (R20.7/R20.8). La app en la manga sin señal no cambia en nada.
- **Velocidad operativa**: el diferimiento de D1 existe exactamente por esto — al operario no se lo saca de la manga a mitad de jornada por una decisión administrativa tomada en otro dispositivo.

---

## 10-bis. As-built — lo que quedó distinto de este diseño (implementer, 2026-07-20)

Reconciliación obligatoria (`docs/specs.md`). Nada de esto cambia el *qué* de la feature; son
decisiones tomadas al construir, todas verificadas.

### (a) `currentIdRef` + `currentNameRef` → **un solo `currentFieldRef`**

§5.3 hablaba de guardar `pendingRevocation { id, name }`. El merge de R20.33 necesita el
`MembershipEstablishment` **completo** (el set que consume la UI es de ese tipo: id, nombre,
provincia, ciudad, rol), no solo id+nombre. Guardar el objeto entero y derivar de él el id y el
nombre elimina la posibilidad de que tres refs paralelos se desincronicen. `pendingRevocationRef`
guarda ese mismo objeto (superset de lo especificado).

### (b) Los guards de carrera: **orden, no cancelación** (fix de la autorrevisión)

`tasks.md` T8 pedía "el patrón `loadSeq` ya usado en RodeoContext/ProfileContext". Aplicado tal cual
**introducía una regresión**, y el E2E la cazó: ese patrón CANCELA la carga anterior en cuanto entra
una nueva, algo inocuo cuando `load` corría una vez, pero letal siendo reactivo — los checkpoints
llegan cada ~1 s y, si una carga tarda más que ese intervalo, **ninguna llega a aplicarse jamás**
(starvation). Síntoma: el rodeo creado por un coworker no aparecía nunca, con el efecto disparando
correctamente. As-built:

- `RodeoContext.load`: se separa **"cambió el objetivo"** (`targetRef` = `usuario|campo` → descartar,
  que era el propósito original del guard) de **"hay otra carga del mismo objetivo"** (`lastAppliedSeq`
  → solo ordena, para que una carga lenta no pise a una más nueva).
- `EstablishmentContext.confirmDisappearance`: **sin** contador de secuencia. Las dos condiciones que
  invalidan el veredicto ya se chequean explícitamente (cambió el usuario / cambió el campo activo), y
  dos evaluaciones concurrentes del mismo campo leen la misma fila local y concluyen lo mismo (emitir
  dos veces es idempotente por el guard de equivalencia).

### (c) Guard de equivalencia **también en `RodeoContext`** (R20.11)

§8 riesgo 4 lo pedía solo para `EstablishmentContext`, pero `RodeoProvider` está en la misma cadena
raíz y su `value` también se recrea en cada render: sin guard, cada checkpoint re-renderizaría la home
entera. R20.11 está redactado a nivel sistema ("el sistema no deberá emitir un estado nuevo"), así que
se aplica en los dos. Comparador conservador (`sameRodeo` compara todos los campos del tipo, con
`serviceMonths` elemento a elemento): ante la duda emite, para no tragarse el cambio que la feature
vino a hacer visible.

### (d) `availableRef` **no se toca** en la rama de desaparición

Detectada en la autorrevisión: si `applyMemberships` dejara `availableRef` con el set fresco (sin el
campo activo) mientras `state` todavía lo tiene, habría una ventana —del largo de la lectura de
evidencia— con ref y estado **divergentes**, que es exactamente el bug de L1/R20.33. As-built: el ref
lo actualiza el camino que resuelve (`finishResolve` o `emitActiveLost`), nunca la detección.

### (e) R20.18 acotada a "proteger un estado ya resuelto para el mismo campo"

Ver la nota de reconciliación bajo R20.18 en `requirements.md`: aplicarla en el arranque dejaba la app
en splash en vez del wizard de rodeo del campo recién creado (aterrizaje optimista, la fila de
`user_roles` todavía no bajó). El escenario del riesgo 7 queda cubierto igual.

### (f) `assertServerSessionsRevoked` — oráculo por refresh token, no por `SELECT auth.sessions`

`tasks.md` T16 lo describía leyendo `auth.sessions` vía service_role. **No es posible sin migración**:
el schema `auth` no está expuesto a PostgREST (`supabase/config.toml` → `schemas = ["public",
"graphql_public"]`), y agregar una RPC para verlo está fuera del alcance. As-built: se captura un
refresh token vivo ANTES de revocar (control que descarta el falso positivo) y se asserta que después
ya no produce sesión — la **consecuencia observable** de `revoke_user_sessions`, que es más fuerte que
contar filas y es el patrón ya canónico del repo (`supabase/tests/edge/run.cjs`, H1-1 R10.1/R10.2).
La propiedad que importa se conserva intacta: si alguien deja el fixture haciendo solo el update del
rol, T21 se pone **rojo antes** de asertar nada del diferimiento.

### (g) La señal de sync es un proxy NO determinista del cambio de dato — **db.watch flageado para Raf** (CORREGIDO 2026-07-20)

> **Corrección del diagnóstico (remediación).** La versión anterior de esta nota afirmaba que "un
> SEGUNDO cambio de una sesión no se ve en 120 s, y tras un `reload` aparece". Ese diagnóstico estaba
> **confundido** (lo objetó bien el reviewer): un `reload` re-sincroniza y el SQLite local de PowerSync
> es persistente, así que el reload trae la fila igual — no prueba que estuviera local ANTES. Se
> rehízo con un **experimento A/B DETERMINISTA** (dos/tres cambios server-side secuenciales, sondeo
> DIRECTO del SQLite local vía `__RAFAQ_PS__.getAll` SIN reload; evidencia cruda en
> `progress/impl_20-reactividad-sync.md`).

**Evidencia (2 corridas contrastantes):**

- La fila SIEMPRE llega al SQLite local en **~1,5 s** (6/6 cambios observados, INSERT y UPDATE). La
  ENTREGA del dato no es el problema.
- Pero `lastSyncedAt` —la señal sobre la que TODA la reactividad de miTropero está emulada— avanza de
  forma **NO determinista por cambio**: corrida 1, los 3 cambios ticaron al instante (~1,5 s);
  corrida 2, el **primer** cambio se estancó (fila en SQLite, señal congelada ~90 s) hasta que el
  **segundo** cambio forzó un checkpoint que barrió ambos de golpe.

**Veredicto: es un SIGNAL problem, no un delivery problem, y NO un latch permanente.** El claim
original "`lastSyncedAt` deja de avanzar después del primer cambio" es **falso** (corrida 1 muestra
cada cambio ticando). Lo cierto: `lastSyncedAt` significa "último sync FULL completado", no "cambió un
dato" — es el primitivo equivocado para reactividad, y puede lagear arbitrariamente detrás de la
llegada real del dato. La feature 20 arregla la RE-LECTURA (re-leer en CADA avance de la señal, que
antes no pasaba nunca) y es estrictamente mejor que el latch de un solo disparo, pero **no puede** hacer
que la UI reaccione a un cambio cuyo checkpoint no tica la señal.

**El fix real es una watched query (`db.watch`)** que reaccione al cambio del SQLite local en vez de a
la señal gruesa de status. Es **EXPANSIÓN DE ALCANCE** (3 consumidores + la deuda de spec 15 "cero
watched queries", §9.1) → **FLAGEADO para Raf** (decisión suya), NO se implementa acá. Anotado con la
evidencia en `docs/backlog.md`. Consecuencia práctica para el E2E (T18): asertar el **estado final
combinado** de un multi-cambio es robusto al estancamiento (un cambio posterior fuerza el barrido); los
timeouts por-assert son generosos (120 s) y el archivo NO lleva retries (los previos tapaban este
fenómeno mal diagnosticado).

> **RECONCILIACIÓN (feature 21, 2026-07-21).** El fix de fondo se implementó: la feature 21 migró los 3
> consumidores a watched queries reales (ADR-030). Los 2 CONTEXTOS usan **`db.onChange(handler, { tables })`**
> (nombre verificado en `node_modules`: la primitiva que NOTIFICA el cambio de tabla y re-corre la
> resolución existente — NO `db.watch(sql,…)`, que entregaría filas que los contextos ignorarían);
> `lotes.tsx` usa **`useQuery`**. Con eso el disparador ya NO es `lastSyncedMs` (el proxy no
> determinista): la UI reacciona al cambio de tabla del SQLite local (~1,5 s medido en la 21). El E2E
> pasó a determinista SIN retries ni forzador (medido en la 21: aviso de revocación a <300 ms del
> disparo). Ver `specs/active/21-watched-queries/`.

### (h) Remediación (2026-07-20) — 3 decisiones de código + limpieza de instrumentación

Cerrando el rechazo del reviewer:

- **`RodeoContext` rutea por `assessDisappearance`** (antes: `if (evidence !== 'active') return;` inline).
  Ambos contextos comparten ahora UN solo camino de veredicto sobre la evidencia afirmativa. Para el
  contexto de rodeos, el establecimiento sigue "presente" sii su rol local está activo
  (`stillPresent = evidence === 'active'`), y se concluye `no_rodeos` SOLO con veredicto `'present'`;
  `'confirmed'` (revocación → protege D1) y `'inconclusive'` (ilegible → fail-safe R20.30) conservan el
  estado. Es **behavior-idéntico** al inline previo (active→present→concluye; absent→confirmed→conserva;
  unknown→inconclusive→conserva) — verificado con unit tests (R20.18/R20.30) — y NO rompe el bootstrap
  (la guarda sigue acotada a `protectingResolved`, §(e)).
- **`lotes.tsx` suma el guard de equivalencia** (`sameManagementGroups`): la re-lectura reactiva corre
  en cada checkpoint, así que sin el guard cada uno hacía `setGroups(fresh)` con un array nuevo →
  re-render de toda la pantalla. Mismo patrón que `sameResolvedEstablishmentState`/`sameRodeoState`.
- **`refreshEstablishments` — conteo de llamadores reconciliado**: los **5 llamadores PRE-EXISTENTES**
  quedan intactos (editar-campo, invite, mas ×2, y el interno de `applyCreatedEstablishment`); feature
  20 agrega **2 invocaciones internas** —sin tocar la firma—: el efecto reactivo de sync (R20.1) y el
  refresh post-switch de `switchEstablishment` cuando se descarta un pendiente diferido (R20.34). El
  comentario del contexto lo dice explícito (antes decía "sus 5 llamadores quedan intactos", que
  omitía las 2 nuevas).
- **Instrumentación temporal QUITADA**: el `__RAFAQ_PS__` de `database.ts` (exposición del DB local bajo
  la marca E2E) y las sondas `[MED]/[MED2]` del spec E2E — eran para el diagnóstico A/B, ya cerrado.
- **E2E de eventual-consistency: forzador + `retries: 2`** (andamio hasta `db.watch`). Como `lastSyncedAt`
  no tica de forma determinista por cambio, hay DOS capas: (1) un forzador/timeout que BAJA la frecuencia
  de freeze — **adiciones** con un blip de red (`syncUntil`: `setOffline` off→on → reconnect → checkpoint
  fresco → la fila ya presente en el servidor baja), **revocaciones** con el tick NATURAL de la conexión
  estable + timeout amplio (~120 s; un blip DISRUPTA la propagación de una remoción de bucket, y T20 usa
  `revokeSession: false` porque revocar la sesión también la disrupta); (2) `retries: 2` que cubren el
  freeze PATOLÓGICO residual re-corriendo con sesión fresca. Los retires son la herramienta estándar y
  honesta acá (el reviewer los objetó bajo el diagnóstico VIEJO/errado; con el A/B corregido son
  legítimos — NO tapan un bug). Todo sin reload (la app sigue montada). Detalle completo en el header de
  `app/e2e/reactividad-sync.spec.ts` y en `tasks.md` §Fase E.
  > **RECONCILIACIÓN (feature 21, D3, 2026-07-21).** Ambas capas se RETIRARON al migrar el disparador a
  > watched query: `app/e2e/reactividad-sync.spec.ts` ya NO tiene `test.describe.configure({ retries })`
  > ni el forzador de blip (`forceSyncTick`/`syncUntil`) — asserta directo. El freeze de señal que los
  > justificaba desapareció (el `onChange` dispara sobre el cambio de tabla, no sobre la señal FULL).
  > Determinismo confirmado en la 21 con ≥3 corridas limpias + stress `--repeat-each`, sin un solo retry;
  > los oráculos siguen estrictos (incluido `assertServerSessionsRevoked` como primer assert de T21).

---

## 11. Reconciliación de specs al cerrar (regla dura)

0. `specs/active/20-reactividad-sync/context.md` — **ya reconciliado** (2026-07-19): se agregó **D1.2** (diferimiento acotado a la vigencia de la sesión) tras Gate 1 HIGH-1, con la decisión de Raf de no tocar `revoke_user_sessions` y cambiar la promesa. El bloque está marcado con su procedencia; el texto aprobado en Gate 0 no se reescribió.
1. `specs/active/01-identity-multitenancy/` — nota as-built bajo `R6.10`: `active_lost` ahora puede diferirse (maniobra en curso) y no se concluye desde un set vacío en una sola lectura.
2. `specs/active/15-powersync/design.md` — acotar el bullet "One-shot `getAll`, NO `db.watch` (reactividad diferida)": sigue vigente como deuda general, deja de aplicar a `EstablishmentContext`, `RodeoContext` y `lotes.tsx`.
3. `EstablishmentContext.tsx:331-332` — el comentario que declara cubierta la reactividad por `useFocusEffect`/refresh manual se borra (es falso: los 5 llamadores de `refreshEstablishments` son post-acción del propio usuario).
4. `docs/backlog.md` — dejar anotado: (a) E2 con toda su evidencia (ya previsto por D3), (b) "el rodeo activo borrado por un coworker durante una maniobra" (§8 riesgo 6), (c) "distinguir campo borrado de rol revocado requiere una señal server-side" (§6, hoy imposible desde el cliente).
