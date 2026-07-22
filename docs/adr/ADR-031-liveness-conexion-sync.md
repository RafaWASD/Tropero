# ADR-031: Liveness de la conexión de sync (reconexión NetInfo+AppState + teardown de socket zombie)

- **Estado**: Aceptada — **DEVICE-VERIFIED en iOS** (Raf, 2026-07-22: habilitar dato en config → maniobra lo refleja sin reiniciar; RC-1 confirmado). El caveat V1 (muerte mid-foreground) NO mordió en iOS (backgroundea agresivo → AppState reconecta). Android no device-verificado aún (mismo código cliente-puro).
- **Fecha**: 2026-07-22
- **Decisor**: Raf (Gate 0 + Puerta 1 + Puerta 2 de la feature 22, `22-sync-liveness-nativo`)
- **Relacionado**: feature 22, **ADR-030** (contrapunto: aquélla cubrió la reactividad de LECTURA local; ésta, la conexión que ALIMENTA esa lectura), `specs/active/15-powersync/design.md` (deuda de conexión), `docs/backlog.md` (2026-07-18), ADR-029 (veredicto device)

## Contexto

ADR-030 adoptó watched queries para reaccionar al cambio del **SQLite local**, asumiendo que la descarga
ya **llegaba** a ese SQLite. La feature 22 descubrió, con evidencia (diagnóstico + DB dev), que en **nativo**
esa premisa **no se cumple**: el sync-DOWN de PowerSync **no fluye durante la sesión viva** — los cambios
server-side (incluido el **eco del propio write** del cliente) no bajan al SQLite hasta un **cold start**.

Pieza clave del diagnóstico: el **upload** viaja por un canal **HTTP directo** (`supabase.rpc(...)` en
`connector.ts`, separado del stream WebSocket de descarga) → **persiste aunque la descarga esté muerta**. Y
la conexión de descarga se establece **una sola vez** (`db.connect()` en `provider.tsx`), sin reconexión
ante cambios de red ni retorno de foreground → un socket que se cuelga (zombie) no reengancha solo. `connect()`
es idempotente del lado del SDK → una 2da `connect()` sobre un socket colgado-pero-no-cerrado puede ser no-op.

## Decisión

Wirear **liveness de la conexión de descarga** en el cliente (CLIENTE PURO — no toca sync-rules/RLS/Edge):

- **Reconexión por triggers** en `provider.tsx`, además del gate de sesión existente (que queda intacto):
  - **NetInfo `offline→online`** → `ensureConnected()` (idempotente; guarda contra `db.connected || db.connecting`).
  - **AppState `background→active`** → en **nativo**, `disconnect()` + `connect()` (teardown EXPLÍCITO del
    socket zombie, porque la idempotencia de `connect()` no fuerza un socket nuevo); en **web**, solo `ensure`
    (la descarga ya fluye; un teardown por cada `visibilitychange` causaría resyncs espurios).
  - **Guard de reentrada** (`reconnectingRef`, liberado en `finally`) + cleanup idempotente de ambos listeners
    (StrictMode-safe).
- **Instrumentación de `SyncStatus`** (`subscribeSyncDiagnostics` en `status.ts`) gateada por **const de módulo**
  (NO `__DEV__`, para que loguee en el build `preview-dev` que puede ser release-mode) → confirma en device que
  `downloading`/`lastSyncedAt` **reenganchan** tras los triggers. Sin PII (solo flags + timestamp).
- **Migración de `useManeuverGating`** (config/maniobra) a watched query (`db.onChange`) — **continúa la
  migración incremental de ADR-030** (uno de los 5 focus-only pendientes: `maniobra`).

## Consecuencias

**Positivas**
- La descarga reengancha en los triggers de **cambio de red** y **retorno de background** — la mayoría del uso
  real en la manga (el phone backgroundea constantemente). El bucle config→maniobra se refleja sin reiniciar.
- Cliente puro: la frontera de autorización (RLS `has_role_in` + `org_scope`, server-side) **no cambia** —
  reconectar reabre el MISMO stream ya scopeado; es liveness/UX, no control de acceso.

**Negativas / límites conocidos**
- **Los 2 triggers NO cubren la muerte SILENCIOSA del socket estando en foreground continuo sin cambio de red**
  (posible repro puntual del reporte original). → contingencia **(a′) watchdog de foreground** (chequeo de
  liveness periódico/al-entrar-a-maniobra → reconnect si sospechoso), **NO** implementada a ciegas: la
  instrumentación en device decide si hace falta, y su heurística **no puede** apoyarse en `lastSyncedAt`
  (proxy no determinista, hallazgo de ADR-030).
- Teardown agresivo en cada foreground (nativo): **tunable** con la evidencia de la instrumentación (relajar a
  condicional si `downloading` reengancha solo). Default agresivo por seguridad del fix.
- Dep nativa nueva **`@react-native-community/netinfo`** → requiere rebuild del dev/preview build.
- La instrumentación (`SYNC_DIAGNOSTICS_ENABLED = true`) es telemetría de diagnóstico → **apagar antes de
  cerrar para prod** (checklist de release).

## Diferidos / contingentes (fuera de la feature 22)

- **(c) / RC-2** — sostener el overlay optimista hasta que baje la fila synced confirmada (el overlay se limpia
  hoy en el ACK HTTP, `connector.ts`, desacoplado de la descarga). Con la descarga sana por esta ADR, el
  flicker post-write es sub-segundo. Toca la reconciliación outbox↔overlay↔descarga → **candidato Gate 1**,
  fast-follow en `docs/backlog.md`.
- **(b)** — streaming HTTP (`react-native-fetch-api`): solo si la instrumentación muestra que ni el
  teardown+reconnect restablece la descarga en device. Ataca el transporte, no el ciclo de vida.

## Alternativas consideradas

- **Confiar solo en el reintento interno del SDK**: es exactamente lo que falla hoy (no reengancha el socket
  zombie en nativo). Descartada.
- **Migrar `useManeuverGating` a `useQuery`** (como `lotes.tsx`): el gating corre una resolución (JOIN
  catálogo+config+defaults → mapeo), no consume filas directo → `db.onChange` re-corre esa resolución sin
  reimplementarla (mismo criterio que ADR-030 §9.1 para los contextos). `useQuery` sigue siendo el patrón para
  listas directas.
