# Design — feature 22: sync-down en vivo en nativo (reconexión + watched queries de config/maniobra)

> Traduce `context.md` (Gate 0 aprobado) + `requirements.md` a decisiones técnicas.
> **Dos cambios independientes que atacan la MISMA falla** (el sync-down muerto en nativo): (a) reconexión/revalidación del socket de descarga (RC-1, la causa primaria) y (d) watched queries de config/maniobra (RC-3, el amplificador de re-render). Se pueden implementar y verificar por separado.
> **Patrón de reactividad heredado**: `docs/adr/ADR-030-watched-queries-reactividad.md` (feature 21). El patrón de reconexión es NUEVO → ver §8 (¿ADR nuevo?).
> **CLIENTE PURO**: `git diff supabase/ sync-streams/` debe quedar vacío (R22.25). Si el diseño necesitara tocar la frontera de sync → PARAR y reabrir Gate 1.

---

## 1. Archivos a modificar

| Archivo | `file:line` de anclaje | Qué cambia | Firma pública |
|---|---|---|---|
| `app/src/services/powersync/provider.tsx` | `:59-99` (el `useEffect` de connect/disconnect); `:73` (`db.connect`) | (a) Añade listeners de NetInfo (`offline→online`) y AppState (`background→active`) que revalidan/reconectan la conexión de descarga, con guard de reentrada y cleanup idempotente. Wirea el subscriber de diagnóstico (instrumentación). El gate de sesión existente (`hasValidSession`) queda intacto. | Sin cambios (mismo `<PowerSyncProvider>`) |
| `app/src/hooks/useManeuverGating.ts` | `:63-64` (`useStatus`/`lastSyncedMs`); `:107-118` (los dos efectos: `useFocusEffect` mount + `useEffect([lastSyncedMs])` reactivo) | (d) Reemplaza el efecto reactivo por `lastSyncedMs` por un efecto `db.onChange({ tables: ['rodeo_data_config','pending_rodeo_data_config'] })` que corre `load()`. Saca `useStatus`/`lastSyncedMs`. El `useFocusEffect` de carga inicial queda. `load`/`fetchRodeoGating`/refs stale-while-revalidate intactos. | Sin cambios (`UseManeuverGating` igual) |
| `app/app/editar-plantilla.tsx` | `:136-139` (`useEffect([rodeoId, systemId])` mount-only que corre `load`) | (d) Añade un efecto `db.onChange` overlay-aware que refresca el estado EFECTIVO de partida (`baseConfig`) y la vista read-only **sin pisar los toggles sin guardar** del owner. La carga inicial (`load` al montar) queda. | Sin cambios |
| `app/src/services/powersync/status.ts` | `:26-37` (`subscribeSyncUiState` / `registerListener({ statusChanged })`) | Instrumentación: nuevo `subscribeSyncDiagnostics` (o equivalente) que registra un `statusChanged` y loguea `connected`/`downloading`/`uploading`/`lastSyncedAt` de `db.currentStatus`. Desactivable, sin PII. | Export nuevo aditivo |

### 1.1 Lo que NO cambia (candados)

- **RC-2 (diferido)**: `connector.ts:157` (`clearOverlay` en el ACK) y `outbox.ts` (`clearOverlay`/`rollbackOverlay`) **no se tocan** (R22 §9). Es la única pieza que rozaría la frontera outbox↔overlay↔descarga → Gate 1, fuera de alcance.
- **Feature 21 ya migrada**: `EstablishmentContext`, `RodeoContext`, `lotes.tsx` y las puras de la 20 (`assessDisappearance`, guards de equivalencia, diferimiento D1) **no se tocan** (R22.20).
- **Frontera de sync**: cero cambios en `supabase/**` y `sync-streams/rafaq.yaml` (R22.25). `buildRodeoConfigQuery` (`local-reads.ts:75`) y `fetchRodeoGating`/`fetchRodeoConfig` **no cambian su SQL ni su lógica** — solo cambia QUIÉN los dispara.
- **Feature 04/BLE**: no se toca.

---

## 2. La API real de PowerSync (verificada en `node_modules`)

Verificado en `@powersync/common` (vía `@powersync/op-sqlite@0.9.9` nativo / `@powersync/react@1.10.0`), `AbstractPowerSyncDatabase.d.ts`:

```ts
connect(connector: PowerSyncBackendConnector, options?: PowerSyncConnectionOptions): Promise<void>;
disconnect(): Promise<void>;
get connected(): boolean;      // true si el stream de sync está abierto
get connecting(): boolean;     // true mientras conecta
get currentStatus(): SyncStatus;
registerListener(l: { statusChanged?: (s: SyncStatus) => void }): () => void;  // devuelve dispose
onChange(handler: { onChange: (e: { changedTables: string[] }) => void|Promise<void> },
         options?: { tables?: string[]; throttleMs?: number; triggerImmediate?: boolean }): () => void;
```

`SyncStatus`: `connected: boolean`, `lastSyncedAt?: Date`, `hasSynced?: boolean`, `dataFlowStatus: { downloading: boolean; uploading: boolean }`.

**Confirmaciones que anclan el diseño (context §2):**
- `connectionMethod` por defecto = **WEB_SOCKET** (el enum `SyncStreamConnectionMethod` solo tiene `WEB_SOCKET`); el fallback HTTP-streaming **no está disponible** (falta `react-native-fetch-api`). → (b) es contingente, no se toca acá.
- `connect()` es **idempotente** del lado del SDK (si ya está conectado, no re-conecta). Esto es lo que hace segura la reconexión en web (R22.9) — pero es también, sospechado, la razón del **socket zombie** en nativo: una 2da `connect()` sobre un socket colgado-pero-no-cerrado puede no reengancharse. Por eso R22.2/R22.3 fuerzan `disconnect()` ANTES de `connect()` en la revalidación de foreground (nativo).
- `db.connected` / `db.connecting` alimentan el guard de reentrada (R22.4): no lanzar una reconexión si ya hay una en curso.

**Dependencia faltante (decisión abierta — ver §10):** `@react-native-community/netinfo` **NO está instalado** hoy (ni `expo-network`). (a) lo requiere. Es un módulo nativo → necesita re-prebuild del dev build. El default propuesto es `@react-native-community/netinfo` (companion documentado de PowerSync; expone `isConnected` + `isInternetReachable`; soporta web vía `navigator.onLine`).

---

## 3. Ciclo de vida de la conexión (a) — diagrama y triggers

### 3.1 Diagrama

```
                         ┌─────────────────────────────────────────────────┐
   sesión válida         │  PowerSyncProvider (provider.tsx)                │
   (auth+emailVerified)  │                                                  │
        │                │   efecto de sesión (EXISTENTE, R22.8)            │
        ▼                │     hasValidSession ? connect(connector)         │
   ┌──────────┐          │                     : disconnect()               │
   │  MONTAJE │──────────┼──▶ connect(connector)  [carga inicial]           │
   └──────────┘          │                                                  │
                         │   efecto de LIVENESS (NUEVO, a):                  │
   NetInfo               │     ── suscribe NetInfo + AppState               │
   offline→online ───────┼──▶ ensureConnected():                           │
                         │        if !reconnecting && !db.connected:        │
                         │           reconnecting=true                       │
                         │           connect(connector).finally(clear)      │  R22.1
                         │                                                  │
   AppState              │     ── revalidate() (nativo):                     │
   background→active ────┼──▶   if !reconnecting && hasValidSession:        │
                         │           reconnecting=true                       │
                         │           await db.disconnect()  ← teardown zombie│  R22.2/R22.3
                         │           await connect(connector)                │
                         │           .finally(clear)                         │
                         │                                                  │
   UNMOUNT / re-run ─────┼──▶ dispose NetInfo + AppState (idempotente)      │  R22.5
                         └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                       registerListener({ statusChanged }) ── log
                       connected / downloading / uploading / lastSyncedAt     R22.23 (dev)
```

### 3.2 Triggers y respuestas

| Trigger | Condición | Acción | Requisito |
|---|---|---|---|
| Montaje / cambio de sesión | `hasValidSession` | `connect(connector)` (efecto EXISTENTE, sin cambio) | R22.8 |
| NetInfo `offline→online` | `hasValidSession` && `!reconnecting` && `!db.connected` | `connect(connector)` (asegurar conexión) | R22.1, R22.6 |
| AppState `background→active` | `hasValidSession` && `!reconnecting` && nativo | `disconnect()` → `connect(connector)` (teardown+reconnect) | R22.2, R22.3 |
| Logout / sesión perdida | `!hasValidSession` | `disconnect()` (efecto EXISTENTE) | R22.8 |
| Unmount / re-run del efecto | — | dispose NetInfo + AppState + subscriber diag | R22.5, R22.24 |

### 3.3 Guard de reentrada (R22.4) — patrón `reconnectScheduled` de la BLE

Se replica el patrón ya probado en `adapter-web-serial.ts:50,158-166` (`reconnectScheduled`): un ref booleano `reconnectingRef` (o `reconnectInFlight`) que se pone en `true` al empezar una reconexión y se limpia en el `finally`. Múltiples triggers (NetInfo + AppState disparando juntos, o el doble-mount de StrictMode) que lleguen mientras uno está en curso son no-ops. No se usa `setTimeout`/backoff propio (el SDK ya reintenta internamente); el guard solo evita apilar `connect()`/`disconnect()` concurrentes.

### 3.4 Socket zombie (R22.2/R22.3) — por qué `disconnect()` antes de `connect()`

`connect()` es idempotente: si el SDK cree que sigue "conectado" sobre un socket que en realidad murió (colgado pero no cerrado — típico al volver de background en Android), una 2da `connect()` no fuerza un socket nuevo → la descarga sigue muerta. La revalidación de foreground hace **`disconnect()` explícito** (cierra el stream) y luego `connect()` (abre uno nuevo). El teardown es lo que garantiza el reenganche real; la instrumentación (R22.23) lo confirma en device (`downloading`/`lastSyncedAt` vuelven a moverse tras el trigger). **Acotado a nativo** (R22.9): en web la descarga ya fluye, un teardown en cada `visibilitychange` causaría resyncs espurios y podría interferir con la E2E → en web se usa solo la idempotencia de `connect()` (ensure), sin teardown agresivo.

> **Contingencia (b), context §3 OUT**: si la instrumentación mostrara en device que ni el teardown+reconnect restablece la descarga, se escala a (b) (HTTP streaming / `react-native-fetch-api`) — fuera de esta feature, decisión posterior con evidencia.

### 3.5-bis ⚠️ VETO DEL LEADER (V1, 2026-07-22) — hueco de cobertura de los triggers + watchdog de foreground

**Riesgo:** los dos triggers de (a) —NetInfo `offline→online` y AppState `background→active`— disparan ante un **cambio de red** o un **retorno de background**. NO disparan si el socket de descarga muere **silenciosamente estando en foreground continuo, sin cambio de red** (típico: el WebSocket queda zombie tras un idle o un blip de red que NetInfo no reporta como `offline`). **Ese es aparentemente el repro EXACTO de Raf**: abrió config → habilitó → fue a maniobra, todo en una sesión viva, sin backgroundear ni (que él note) perder señal, y SOLO el cold restart lo arregló. En ese camino, ni R22.1 ni R22.2 disparan → **(a) tal como está podría NO fixear su caso puntual**.

**Cómo se cierra (orden):**
1. **La instrumentación (R22.23) es el árbitro.** El primer build de device DEBE confirmar: ¿el socket estaba realmente muerto durante el foreground de Raf, y AppState-foreground lo reengancha (porque en la práctica el phone SÍ backgroundea entre acciones), o murió mid-foreground sin que ningún trigger dispare? No asumir que los dos triggers alcanzan — medir.
2. **Contingencia (a′) — watchdog de foreground (cliente puro, NO es (b)):** si la instrumentación muestra muerte mid-foreground que los triggers no atrapan, agregar un chequeo de liveness periódico/al-entrar-a-maniobra que, si detecta el socket sospechoso, fuerza `disconnect()+connect()`. **Cuidado con la heurística de "sospechoso"**: `lastSyncedAt` es un proxy NO determinista (hallazgo central de la 20/ADR-030) → NO usarlo como único criterio de staleness (falsos positivos → churn). Por eso el watchdog NO se implementa a ciegas ahora — se decide con la evidencia de la instrumentación. Es una contingencia de PRIMERA LÍNEA (más cerca que (b), que ataca el transporte).
3. Solo si (a)+(a′) no restablecen la descarga → (b) (transporte HTTP).

**Consecuencia de expectativas (Puerta 1):** el primer build de este fix (a+d+instrumentación) puede NO fixear el repro puntual de Raf si la muerte es mid-foreground; en ese caso la instrumentación lo revela y (a′) es el paso inmediato (mismo ciclo, cliente puro). Lo que SÍ mejora ya: los casos de cambio de red y de retorno de background (la mayoría del uso real en la manga, donde el phone backgroundea todo el tiempo).

### 3.5 AppState y NetInfo en web (R22.9)

- `AppState` existe en `react-native-web` (mapea a `visibilitychange`), pero el teardown de foreground se gatea a `Platform.OS !== 'web'` (§3.4) → en web el listener de AppState es no-op o solo `ensure`.
- `NetInfo` en web usa `navigator.onLine`; el `ensure` en `offline→online` es idempotente. La E2E (que corre online estable) no dispara `offline→online` salvo el caso explícito de offline puro, donde el oráculo es "sin cambio de estado".

---

## 4. Watched query de `useManeuverGating` (d) — RC-3

### 4.1 El cambio (solo el disparador)

**Sale** (`useManeuverGating.ts:63-64` y `:113-118`):
```ts
const syncStatus = useStatus();
const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;
// ...
useEffect(() => { if (lastSyncedMs === 0) return; void load(); }, [lastSyncedMs, load]);
```

**Entra**:
```ts
import { usePowerSync } from '@powersync/react';
const db = usePowerSync();

// spec 22 (R22.10/R22.13/R22.17) — WATCHED QUERY imperativa. Reemplaza el disparador por-sync (lastSyncedMs,
// proxy NO determinista, ADR-030) por db.onChange sobre las tablas que respaldan la config del rodeo. El
// onChange re-corre la resolución EXISTENTE (load → fetchRodeoGating → buildRodeoConfigQuery overlay-aware).
// OVERLAY-AWARE (R22.13): se observan AMBAS tablas — pending_* (overlay optimista del toggle offline) y la
// synced (la fila confirmada que baja tras el ACK, cuando la descarga reengancha por (a)). Dep PRIMITIVA
// (rodeoId, R22.17): no un objeto de status → no reintroduce el loop de la 20.
useEffect(() => {
  if (!rodeoId) return;
  const dispose = db.onChange(
    { onChange: () => { void load(); } },
    { tables: ['rodeo_data_config', 'pending_rodeo_data_config'] },
  );
  return () => dispose();
}, [rodeoId, load, db]);
```

`load` es un `useCallback([rodeoId])` estable → el efecto se re-suscribe solo si cambia el rodeo (R22.15). El `useFocusEffect(useCallback(() => { void load(); }, [load]))` de `:107-111` **queda** — es la carga inicial al montar/enfocar (`db.onChange` no dispara al registrarse, `triggerImmediate=false` por default, R22.15).

### 4.2 Cómo preserva la resolución del gating (R22.12)

El `onChange` **no lee filas** ni reimplementa nada: solo NOTIFICA y re-corre `load()`, que ya hace toda la cadena existente:

```
onChange (rodeo_data_config | pending_rodeo_data_config cambió)
  → load()
     → fetchRodeoGating(rodeoId)
        → fetchFieldCatalog()          (field_definitions activos)
        → fetchRodeoConfig(rodeoId)    → buildRodeoConfigQuery  ← OVERLAY-OVERRIDE (local-reads.ts:75)
        → fetchSystemDefaults(system)  (required_for_system)
        → mapeo → RodeoDataKeyMap
     → setConfig(map)   (+ refs stale-while-revalidate: loadedRodeoRef, reqIdRef)
  → resolve / resolveSession / filter (síncronos sobre config) los consumen jornada.tsx / carga.tsx
```

Idéntico a los contextos de la feature 21: `db.onChange` re-corre la resolución existente, solo cambia el disparador. La lógica de veredicto del gating (`maneuver-gating.ts`, puro) no se toca → su suite unitaria sigue verde y garantiza la corrección.

### 4.3 Overlay-aware (R22.13) — por qué observar AMBAS tablas

`buildRodeoConfigQuery` (`local-reads.ts:75-103`) hace: `synced NOT IN overlay` UNION ALL `overlay`. El overlay (`pending_rodeo_data_config`) PISA la fila synced del mismo field (invariante ≤1 fila por `(rodeo,field)` del DELETE-PRIOR de `enqueueSetRodeoConfig`). Secuencia del toggle en nativo:

1. Owner guarda → `enqueueSetRodeoConfig` escribe `pending_rodeo_data_config` (overlay ON) → **`onChange` dispara** (tabla `pending_rodeo_data_config` cambió) → `load()` → `buildRodeoConfigQuery` devuelve ON (overlay pisa) → maniobra ve ON. ✔ (funciona incluso offline, R22.22)
2. La RPC sube (canal HTTP separado) → ACK → `clearOverlay` borra el overlay → **`onChange` dispara** (overlay cambió) → `load()` → ahora `buildRodeoConfigQuery` cae a la fila synced.
3. Con (a) sano, la fila synced confirmada (ON) ya bajó por la stream → **`onChange` dispara** (tabla `rodeo_data_config` cambió) → `load()` → ON estable. ✔
   - Sin (a) (bug actual): la fila synced no baja → paso 2 muestra OFF stale (RC-2). Por eso (a) es la pieza primaria; (d) sin (a) solo reacciona pero a un local stale.

Observar SOLO `rodeo_data_config` perdería el disparo del overlay (paso 1, el feedback optimista); observar SOLO `pending_*` perdería el disparo de la fila synced que baja (paso 3). Se observan las dos.

### 4.4 No romper 20/21 (R22.17/R22.18/R22.19)

- **Dep primitiva** (`rodeoId`), no objeto de status → no el loop de la 20.
- **Throttle trailing (~30 ms)** del SDK coalesce la ráfaga de un checkpoint (R22.18) — un save toca 1..N fields en `pending_rodeo_data_config` en una transacción; el throttle los junta en un `onChange`.
- **Stale-while-revalidate intacto** (R22.19): `load()` ya usa `loadedRodeoRef`/`shouldShowLoadingForLoad` para NO re-flipear `loading` en revalidación del mismo rodeo (bug s27). El disparo más frecuente de `onChange` (vs `lastSyncedMs`) pasa por el mismo camino → sigue siendo silencioso. `reqIdRef` (last-request-wins) evita que un `load` viejo pise uno nuevo si dos `onChange` se solapan.
- **No se tocan los contextos de la 21** (R22.20): esta feature migra un consumidor NUEVO (`useManeuverGating`), que era uno de los 5 focus-only pendientes del backlog de ADR-030 (`maniobra`). Es exactamente la migración incremental que ADR-030 previó.

### 4.5 `editar-plantilla.tsx` (R22.14) — reactivo sin pisar ediciones sin guardar

`editar-plantilla` es a la vez lector Y escritor de la config, y mantiene estado LOCAL de edición (`toggles`, el working copy del owner). No se puede hacer `db.onChange → load()` a secas: `load()` reconstruye `toggles` con `buildEditToggles(...)` y **borraría las ediciones sin guardar**.

**Decisión (default del spec, el implementer la ejecuta):** el efecto `db.onChange` overlay-aware refresca el **estado EFECTIVO de partida** (`baseConfig`, la base del diff) y, si el owner **no** tiene ediciones sin guardar (los `toggles` coinciden con el `baseConfig` previo), re-deriva `toggles`; si hay ediciones en curso, solo actualiza `baseConfig` (para que el diff al guardar sea contra el estado real vigente) y **no toca** `toggles`. El caso de uso primario (guardar → `router.back()`) no queda en la pantalla, así que el impacto real de este efecto es: (i) re-entrar muestra el estado correcto (ya cubierto por el re-mount + local fresco de (a)); (ii) un cambio de un coworker mientras el owner mira, se refleja sin pisar su edición. Es una mejora secundaria; la pieza que cierra A1 es `useManeuverGating` + (a).

> Alternativa más simple considerada: dejar `editar-plantilla` con su read one-shot al montar (sin `db.onChange`) y confiar en que el re-mount + (a) lo resuelven. Se descarta por el context §3/§7 (pide "read reactivo del config" en `editar-plantilla`), pero se acota al refresh de `baseConfig`/read-only para no regresionar la edición. Si en review se juzga que el riesgo de clobber supera el beneficio, se puede reducir a solo refrescar la vista read-only del no-owner — decisión de review (flag §10).

---

## 5. Instrumentación de SyncStatus (R22.23/R22.24)

Nuevo export aditivo en `status.ts` (junto a `subscribeSyncUiState`, `:26`), p. ej.:

```ts
// ⚠️ VETO DEL LEADER (V2, 2026-07-22): NO gatear por `__DEV__`. El build de device de Raf es `preview-dev`
// (EAS), que puede compilar en release-mode → `__DEV__ === false` → la traza quedaría MUDA justo en el device
// donde la necesitamos para confirmar RC-1. Se gatea por una CONST DE MÓDULO en `true` AHORA (el diagnóstico
// debe correr en el build de device), y se APAGA (`false`) antes de dar la feature por cerrada para prod
// (reconciliación de cierre, §11). No es UI de usuario; solo flags + timestamp (sin PII, R22.24).
const SYNC_DIAGNOSTICS_ENABLED = true;  // ⚠️ flip a false antes de cerrar para prod (V2)

export function subscribeSyncDiagnostics(db = getPowerSync()): () => void {
  if (!SYNC_DIAGNOSTICS_ENABLED) return () => {};
  const log = () => {
    const s = db.currentStatus;
    // eslint-disable-next-line no-console
    console.log('[powersync][diag]', {
      connected: s.connected,
      downloading: s.dataFlowStatus?.downloading,
      uploading: s.dataFlowStatus?.uploading,
      lastSyncedAt: s.lastSyncedAt?.toISOString(),  // timestamp, NO PII (R22.24)
    });
  };
  log();
  return db.registerListener({ statusChanged: () => log() });
}
```

`provider.tsx` lo monta en un efecto con cleanup (dispose en unmount). Reusa el mismo mecanismo `registerListener({ statusChanged })` que `subscribeSyncUiState` (context §3). No es UI de usuario. Solo flags booleanos + timestamp → sin PII (los conteos de `logFirstSyncCounts` existentes ya siguen esa regla). En device, esta traza es la que confirma RC-1 cerrada: tras `offline→online` / `background→active`, `downloading` reengancha y `lastSyncedAt` avanza.

---

## 6. Cumplimiento de los MUSTs de miTropero

- **Multi-tenancy / RLS (CLAUDE.md ppio 6, R22.25/R22.26)**: la feature es **cliente puro** — no modifica ninguna migración, RLS policy, sync rule ni Edge Function (`git diff supabase/ sync-streams/` vacío). La reconexión reabre el MISMO stream ya scopeado por `org_scope` + RLS server-side; las tablas observadas por la watched query (`rodeo_data_config`, `pending_rodeo_data_config`) son el SQLite LOCAL ya scopeado por las streams. Observarlas y reconectar es **liveness / disparador de UX, no un control de acceso** (el enforcement sigue siendo `has_role_in`, server-side, en cada lectura/escritura). El cliente nunca hardcodea `establishment_id`. Si en implementación apareciera necesidad de tocar la frontera → **PARAR y reabrir Gate 1**.
- **Offline-first (CLAUDE.md ppio 3, R22.6/R22.21/R22.27)**: la watched query lee del SQLite local (cero red nueva). Sin red, `db.onChange` no dispara (no hay cambios del server) y el trigger de conexión no intenta nada (solo dispara en `offline→online`). El write optimista del owner (overlay) sigue reflejándose offline (R22.22). La app en la manga sin señal no cambia.
- **Velocidad operativa**: la migración preserva el stale-while-revalidate (R22.19) — el operario no ve parpadear la carga rápida; y el gating reacciona determinista (~1,5 s) cuando el owner habilita un dato, sin reiniciar.

---

## 7. E2 / E-web — riesgos del ciclo de vida y su mitigación

| Riesgo | Mitigación | Requisito |
|---|---|---|
| Doble-mount StrictMode apila listeners/conexiones | Guard de reentrada (`reconnectingRef`) + cleanup idempotente (dispose de NetInfo/AppState/registerListener) | R22.4, R22.5 |
| Teardown agresivo en web rompe la E2E (resync espurio en cada `visibilitychange`) | Teardown gateado a nativo; web usa solo `ensure` idempotente | R22.9, §3.4 |
| Loop de connect sin red | Trigger solo en `offline→online`; el SDK ya reintenta solo | R22.6 |
| `onChange` más frecuente que `lastSyncedMs` re-renderiza de más | Throttle SDK + stale-while-revalidate + `reqIdRef` | R22.18, R22.19 |
| Clobber de ediciones sin guardar en `editar-plantilla` | Refresh de `baseConfig`/read-only sin pisar `toggles` en curso | R22.14, §4.5 |
| **(V1) Muerte silenciosa del socket mid-foreground que los triggers NO atrapan (repro de Raf)** | Instrumentación (R22.23) como árbitro en device → contingencia (a′) watchdog de foreground (cliente puro), sin heurística ciega de `lastSyncedAt` | §3.5-bis |

---

## 8. ¿ADR nuevo? — Propuesta: ADR-031 (liveness de conexión de sync)

**Recomendación del spec_author (el leader decide):** crear **ADR-031 — "Liveness de la conexión de sync (reconexión NetInfo+AppState + teardown de socket zombie)"**. Justificación (regla CLAUDE.md "¿se va a referenciar en 6 meses?"):
- Es el **contrapunto de conexión** de ADR-030 (que cubrió la reactividad de LECTURA local, pero asumió que la descarga ya llegaba al SQLite). Esta feature descubre que en nativo la descarga misma se cuelga → hay un patrón de ciclo de vida de conexión que futuras features (y cualquier debugging de "no baja nada") van a consultar.
- Fija decisiones que se van a reusar: teardown+reconnect en foreground (nativo), guard de reentrada, gate de sesión, el porqué del socket zombie con WebSocket, y la relación con la contingencia (b).
- Registra la dependencia nueva (NetInfo) y el hecho de que el veredicto de sync-down vivo en nativo es device (ADR-029).

Si el leader prefiere no crear ADR (por ser un fix acotado), la alternativa es documentar el patrón en `specs/active/15-powersync/design.md` (donde vive la deuda de conexión). El spec_author recomienda ADR por la referenciabilidad.

---

## 9. Alternativas descartadas

### 9.1 Confiar solo en la reconexión interna del SDK (sin (a)) — DESCARTADA
El SDK reintenta solo, pero el bug reportado (context §1, backlog 2026-07-18) es precisamente que en nativo NO reengancha la descarga tras un cuelgue (socket zombie) → hace falta el teardown+reconnect explícito disparado por NetInfo/AppState. Confiar en el reintento interno es exactamente lo que falla hoy.

### 9.2 Migrar `useManeuverGating` a `useQuery` (como `lotes.tsx`) — DESCARTADA
`useQuery` entrega FILAS reactivas, pero `useManeuverGating` no consume filas de config directo: corre una resolución (JOIN de catálogo + config + defaults del sistema → `RodeoDataKeyMap`, con `required` per-sistema y overlay-override). Derivar eso de un `data[]` obligaría a reimplementar `fetchRodeoGating` dentro del render. `db.onChange` re-corre la resolución existente sin tocarla — encaje exacto (mismo criterio que ADR-030 §9.1 para los contextos). `useQuery` seguiría siendo el patrón para pantallas de lista directa.

### 9.3 Sostener el overlay hasta que baje la fila synced (RC-2 / (c)) — DIFERIDA (no descartada)
Es la solución "belt-and-suspenders" a la reversión post-write, pero toca la frontera outbox↔overlay↔descarga (candidato Gate 1). Con (a) sano el flicker es sub-segundo. Se difiere a fast-follow (`docs/backlog.md`), context §3 OUT. Ver `requirements.md` §9.

### 9.4 Arreglar el streaming HTTP / `react-native-fetch-api` (b) — CONTINGENTE (no ahora)
Suma una dep de polyfill y ataca el transporte, no el ciclo de vida. Solo se hace si la instrumentación (R22.23) muestra en device que (a) no restablece la descarga. No a ciegas. Context §3 OUT.

### 9.5 `expo-network` en vez de `@react-native-community/netinfo` — a decidir (§10)
`expo-network` es más liviano y del ecosistema Expo, pero su API de listener (`addNetworkStateChangeListener`) es más nueva y `isInternetReachable` es menos maduro que el de NetInfo. NetInfo es el companion documentado de PowerSync. Default: NetInfo. Decisión de §10.

---

## 10. Decisiones abiertas para el leader / Raf (antes de Puerta 1)

1. **Dependencia de conectividad (bloqueante para (a)).** NetInfo **no está instalado**. Hay que agregar `@react-native-community/netinfo` (default recomendado) — es un **módulo nativo** → requiere `expo prebuild` + nuevo dev build en device para probar (a). Confirmar el paquete y que el próximo dev build lo incluya. (Alternativa: `expo-network`, §9.5.)
2. **¿ADR-031?** Crear el ADR del patrón de reconexión (§8, recomendado) o documentarlo en `specs/active/15-powersync/design.md`. Decisión del leader.
3. **Agresividad del teardown en foreground.** El default es `disconnect()+connect()` SIEMPRE en `background→active` (nativo) para matar el zombie. La instrumentación en device podría permitir relajarlo a condicional (solo si `connected` pero `downloading` no reengancha en X s). El spec fija el default agresivo; el ajuste fino es device-verified post-implementación (no reabre spec, es tuning dentro de R22.2/R22.3).
4. **Alcance del reactivo en `editar-plantilla` (§4.5).** Default: refrescar `baseConfig`/read-only sin pisar `toggles` en curso. Si en review se juzga riesgoso, reducir a refrescar solo la vista read-only del no-owner. Decisión de review, no bloqueante para Puerta 1.

---

## 11. Reconciliación de specs al cerrar (regla dura)

Al cerrar la feature hay que tocar:

1. `docs/adr/ADR-030-…` — anotar que `useManeuverGating` (config/maniobra) queda migrado a watched query, avanzando el plan incremental (uno de los 5 focus-only del backlog: `maniobra`). Los otros 4 siguen pendientes.
2. `specs/active/15-powersync/design.md` — el bullet de watched queries pasa a "los 3 de la 21 + `useManeuverGating` (config/maniobra) migrados; el resto pendiente"; y la deuda de "conexión de sync sin reconexión" queda cerrada por (a) (con el patrón de ADR-031 si se crea).
3. `docs/backlog.md` — cerrar/acotar el ítem 2026-07-18 (sync-down no reengancha en nativo → resuelto por (a)); anotar RC-2 / (c) como fast-follow con Gate 1; anotar (b) como contingente.
4. Si se crea **ADR-031**, referenciarlo desde `provider.tsx` y desde el header de esta spec.
5. Reconciliar cualquier fix del fix-loop de implementación (device tuning del teardown, dep de NetInfo) en estos 3 docs ANTES de cerrar (regla "correcciones se reflejan en specs").
