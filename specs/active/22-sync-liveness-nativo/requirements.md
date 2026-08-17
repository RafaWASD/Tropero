# Requirements — feature 22: sync-down en vivo en nativo (reconexión + watched queries de config/maniobra)

> **Estado**: `spec_ready` (redactada 2026-07-22 por `spec_author`).
> **Fuente de verdad**: `specs/active/22-sync-liveness-nativo/context.md` (Gate 0 aprobado por Raf, 2026-07-22).
> El alcance del context (§3 IN / OUT) es **vinculante**: esta spec lo traduce a EARS, no lo re-decide.
> **Notación**: EARS estricto (`docs/specs.md`). IDs `R22.<n>` estables — no reordenar después de aprobar.
> **Relación con 20/21**: continúa la migración incremental de watched queries de `docs/adr/ADR-030-watched-queries-reactividad.md` (feature 21). El disparador de config/maniobra pasa a watched query; **no se toca** la reactividad ya migrada de la 21 (`EstablishmentContext`, `RodeoContext`, `lotes.tsx`).

---

## 0. Alcance en una línea

En **nativo** el sync-DOWN de PowerSync no fluye durante la sesión viva (los cambios server-side, incluido el eco del propio write, no bajan al SQLite local hasta un cold start). Fix **CLIENTE PURO** en tres piezas: **(a)** reconexión/revalidación de la conexión de descarga (NetInfo `offline→online` + AppState `background→active`, con teardown del socket zombie, guard de reentrada y cleanup StrictMode-safe) en `provider.tsx`; **(d)** migración de los consumidores de config/maniobra (`useManeuverGating`, y el read de config de `editar-plantilla`) de one-shot + `lastSyncedMs` a watched query (`db.onChange` sobre `rodeo_data_config` + `pending_rodeo_data_config`, overlay-aware); e **instrumentación** de `SyncStatus` (dev/diagnóstico, desactivable) para confirmar en device que la descarga reengancha.

**Fuera de alcance (explícito, del context §3 OUT):**
- **(c) / RC-2** — sostener el overlay hasta que baje la fila synced confirmada: **DIFERIDO** (candidato Gate 1, belt-and-suspenders; a `docs/backlog.md`). Solo se documenta como nota (§9).
- **(b)** — HTTP streaming / `react-native-fetch-api`: **CONTINGENTE**, solo si la instrumentación muestra que (a) no restablece la descarga. No se especifica.
- La feature **no toca** schema / RLS / sync-rules (`sync-streams/mitropero.yaml`) / Edge Functions (R22.20). No toca `EstablishmentContext` / `RodeoContext` / `lotes.tsx` (ya migrados por la 21) ni la feature 04/BLE.

---

## 1. Reconexión / revalidación de la conexión de descarga — RC-1, (a)

**R22.1** — Cuando la conectividad de red del dispositivo transicione de sin-red a con-red (NetInfo `isConnected`/`isInternetReachable` pasa a verdadero) y exista sesión válida (`authenticated` + `emailVerified`), el sistema deberá asegurar que la conexión de sync de PowerSync esté activa (invocar `db.connect(connector)` si no está conectada).

**R22.2** — Cuando la app pase de segundo plano a activa (AppState `active`) y exista sesión válida, el sistema deberá revalidar la conexión de descarga, forzando en nativo un teardown+reconnect explícito (`db.disconnect()` seguido de `db.connect(connector)`) para no operar sobre un socket colgado-pero-no-cerrado.

**R22.3** — El sistema deberá forzar que la revalidación de R22.2 produzca un socket de descarga NUEVO (teardown real), de modo que una segunda `connect()` no sea un no-op sobre un socket zombie (colgado pero no cerrado) — el criterio de "reenganche real" lo evidencia la instrumentación (R22.18: `downloading`/`lastSyncedAt` vuelven a moverse tras el trigger).

**R22.4** — Mientras una operación de reconexión (disconnect/connect) esté en curso, el sistema no deberá iniciar otra (guard de reentrada), de modo que múltiples triggers (NetInfo + AppState) o un doble-mount no apilen conexiones simultáneas.

**R22.5** — Al desmontar `PowerSyncProvider` (o al re-ejecutar su efecto por cambio de dependencias), el sistema deberá liberar los listeners de NetInfo y de AppState de forma idempotente (remover-antes-de-agregar / dispose devuelto), sin dejar listeners colgados ni apilarlos ante el doble-mount de React StrictMode.

**R22.6** — Mientras el dispositivo esté sin red, el sistema no deberá intentar `connect()` por el trigger de conectividad: el único disparador de conexión por red es la transición `offline→online` (R22.1), nunca un reintento en bucle mientras no hay red. (El reintento interno del propio SDK, best-effort, se conserva; el cliente no agrega un loop propio.)

**R22.7** — Cuando un refresh del token de sesión ocurra (Supabase `autoRefreshToken`), el sistema no deberá quedar con la descarga muerta sin reconectar: la combinación de `fetchCredentials` (que devuelve el token fresco al re-pedirse credenciales) y la revalidación de foreground (R22.2) deberá asegurar que la descarga siga viva tras la expiración/renovación del JWT.

**R22.8** — El sistema deberá conservar el gate de sesión existente de `provider.tsx`: solo conectar con sesión válida (`authenticated` + `emailVerified`) y desconectar (`db.disconnect()`) al perder la sesión / logout. La reconexión de (a) no debe conectar sin sesión válida.

**R22.9** — En web el sistema no deberá regresionar: la descarga en web ya fluye, por lo que la reconexión debe ser idempotente / no-op en web (el teardown+reconnect agresivo de R22.2 se acota a nativo; en web se apoya en la idempotencia de `connect()`), y la suite E2E web debe seguir verde sin resyncs espurios provocados por el ciclo de vida de conexión.

---

## 2. Watched queries de config/maniobra — RC-3, (d)

**R22.10** — El sistema deberá derivar la reactividad del gating de maniobras (`useManeuverGating`) de una watched query imperativa de PowerSync (`db.onChange(handler, { tables })`) sobre las tablas locales que respaldan la config del rodeo (`rodeo_data_config` y su overlay `pending_rodeo_data_config`), re-corriendo la resolución del gating al cambiar alguna de esas filas.

**R22.11** — El sistema no deberá disparar la re-lectura del gating de `useManeuverGating` a partir del avance de `lastSyncedAt` / `lastSyncedMs` (queda prohibido el disparador por la señal de sync gruesa en este consumidor, conforme a ADR-030).

**R22.12** — El `onChange` de `useManeuverGating` deberá re-ejecutar la resolución del gating EXISTENTE (`fetchRodeoGating` → `buildRodeoConfigQuery` + `fetchFieldCatalog` + `fetchSystemDefaults` → mapeo `RodeoDataKeyMap` → `resolveManeuverGating`/`filterApplicableManeuvers`/`resolveSessionGating`) sin modificar su lógica de veredicto: solo cambia el disparador. La firma pública de `UseManeuverGating` (`config`, `loading`, `error`, `reload`, `resolve`, `resolveSession`, `filter`) no deberá cambiar.

**R22.13** — La watched query de `useManeuverGating` deberá respetar el overlay-override de `buildRodeoConfigQuery` (`local-reads.ts:75`): observar tanto `rodeo_data_config` (fila synced) como `pending_rodeo_data_config` (overlay optimista que PISA a la synced del mismo field, invariante ≤1 fila por `(rodeo_id, field_definition_id)` del DELETE-PRIOR), de modo que un toggle guardado offline (overlay) y la posterior llegada de la fila synced confirmada disparen ambos la re-resolución.

**R22.14** — El sistema deberá reflejar el read de config de `editar-plantilla.tsx` de forma reactiva al cambio local de `rodeo_data_config` / `pending_rodeo_data_config` (mismo `db.onChange` overlay-aware), sin descartar las ediciones sin guardar del owner: un disparo de la watched query deberá refrescar el estado EFECTIVO de partida (base del diff) y la vista de solo-lectura, pero no deberá pisar los toggles que el owner cambió y todavía no guardó.

**R22.15** — Cuando cambie el rodeo objetivo de `useManeuverGating` (`rodeoId`), el sistema deberá re-suscribir la watched query al nuevo rodeo y liberar la anterior (dispose), conservando la carga inicial por el path existente (`useFocusEffect` al montar/enfocar), dado que `db.onChange` no dispara al registrarse (`triggerImmediate` en su default `false`).

**R22.16** — El sistema deberá reaccionar de forma determinista (~1,5 s, la latencia de bajada al SQLite local medida en la feature 20/ADR-030) al cambio local de `rodeo_data_config` de un rodeo, reflejándolo en el gating de maniobra y en la config sin reiniciar la app.

---

## 3. No romper la reactividad de 20/21 — E1/E2/E5

**R22.17** — El sistema deberá usar una dependencia de efecto PRIMITIVA (p. ej. `rodeoId: string | null`, más el singleton estable del DB), no un objeto de status, para el efecto de la watched query de `useManeuverGating`, de modo que no se reintroduzca el bucle de re-render que la feature 20 evitó al descartar el objeto de status como dependencia.

**R22.18** — El sistema deberá coalescer las ráfagas de cambios de tabla de un mismo checkpoint mediante el throttle (trailing, ~30 ms) del SDK, evitando N re-resoluciones del gating por una ráfaga de cambios de un mismo checkpoint.

**R22.19** — El sistema deberá conservar la propiedad stale-while-revalidate de `useManeuverGating` (bug s27): una revalidación en background del MISMO rodeo (disparada ahora por `db.onChange` en vez de `lastSyncedMs`) no deberá re-flipear `loading` a `true` ni blanquear/desmontar el paso en curso de la carga rápida; solo la carga inicial de un rodeo nuevo muestra loading.

**R22.20** — El sistema no deberá modificar `EstablishmentContext`, `RodeoContext` ni `lotes.tsx` (ya migrados a watched queries por la feature 21), ni su reactividad, ni las funciones puras de resolución de la 20 (`assessDisappearance`, guards de equivalencia, diferimiento D1). El diferimiento D1 (no sacar al operario de la manga por una decisión administrativa remota) y la ausencia de falso `active_lost` por estado transitorio se conservan sin cambios.

---

## 4. Offline puro intacto

**R22.21** — Mientras el dispositivo esté sin red y no haya cambios en las tablas locales observadas, el sistema no deberá disparar re-lecturas del gating ni intentos de conexión: `db.onChange` solo dispara ante un cambio real de tabla, y el trigger de conexión por red solo dispara en la transición `offline→online` (R22.1/R22.6). La app en la manga sin señal no cambia su comportamiento.

**R22.22** — Si la watched query de config dispara sin conectividad (por un write LOCAL del propio owner — un toggle offline que escribe el overlay), el sistema deberá leer el SQLite local (overlay-aware) y reflejar el estado local vigente, sin depender de la red.

---

## 5. Instrumentación de SyncStatus (dev / diagnóstico)

**R22.23** — El sistema deberá loguear, en cada `statusChanged` de PowerSync (vía el mecanismo `registerListener` que ya usa `subscribeSyncUiState`, `status.ts:26`), los campos de diagnóstico `connected`, `dataFlowStatus.downloading`, `dataFlowStatus.uploading` y `lastSyncedAt` de `db.currentStatus`, para que un build en device confirme en vivo que la descarga reengancha tras el trigger de reconexión (cierra RC-1).

**R22.24** — La instrumentación de R22.23 deberá ser telemetría de diagnóstico desactivable (gate por `__DEV__` o const de módulo), no UI de usuario final, y deberá liberar su suscripción al desmontar. No deberá loguear PII ni contenido de filas (solo flags booleanos + timestamp).

---

## 6. Cliente puro / fronteras (multi-tenancy, offline-first)

**R22.25** — El sistema no deberá modificar ninguna migración, RLS policy, sync rule (`sync-streams/mitropero.yaml`) ni Edge Function: la feature es CLIENTE PURO, verificable con `git diff supabase/ sync-streams/` vacío. Si durante la implementación apareciera necesidad de tocar la frontera de sync, el sistema deberá **parar y reabrir Gate 1** (no continuar).

**R22.26** — El sistema no deberá cambiar qué datos ve el usuario: el set de campos/rodeos/config accesibles se sigue derivando de `auth.uid()` vía `org_scope` + RLS server-side (`has_role_in`), intactos. La reconexión y las watched queries son **liveness / UX de reactividad**, nunca un control de acceso; el cliente nunca hardcodea `establishment_id`.

**R22.27** — El sistema deberá conservar el principio offline-first: las watched queries leen del SQLite local (cero llamadas de red nuevas), y la reconexión no debe romper el funcionamiento sin señal (R22.6/R22.21). La carga de datos en campo sigue funcionando sin internet y sincroniza después.

---

## 7. Verificación / E2E

**R22.28** — La suite E2E existente (incluida `app/e2e/reactividad-sync.spec.ts`) deberá seguir verde tras la feature. El veredicto de "la descarga baja en vivo en nativo" (RC-1) es **device** (ADR-029: la reactividad de sync-down en nativo no se prueba en web) + la instrumentación de R22.23; en web se cubre el bucle **config→maniobra** donde sea automatizable (un toggle de config reflejándose en el gating de la maniobra reactivo), sin `page.reload()` tras el cambio (regla de oro de `reactividad-sync.spec.ts`).

**R22.29** — Cada `R22.<n>` deberá tener asignado en `tasks.md` al menos un medio de verificación concreto (unit / e2e / typecheck / inspección del reviewer / veredicto device), marcando explícitamente qué se verifica en WEB (E2E) y qué queda para veredicto en DEVICE.

---

## 8. Historial de refinamiento

_(Sin refinamientos posteriores todavía — redacción inicial 2026-07-22. Los findings de Gate 1/humanos que lleguen tras leer la spec se registran acá, preservando los IDs `R22.<n>`.)_

---

## 9. Nota de alcance diferido (RC-2 / (c)) — NO se especifica acá

RC-2 (el overlay se limpia en el ACK HTTP, `connector.ts:157`, desacoplado de la descarga) queda **DIFERIDO** como fast-follow con Gate 1 (candidato: sostener el overlay hasta que baje la fila synced confirmada, `writeCheckpoint`). Con la descarga sana por (a)+(d), RC-2 se reduce a un flicker sub-segundo casi invisible (el owner ya navegó atrás; los consumidores re-leen la fila synced apenas baja). Se anota en `docs/backlog.md` y se reevalúa si el flicker molesta en maniobra. **Esta spec no lo cubre.**

---

## 10. Trazabilidad — criterios de aceptación → requisitos

| # | Criterio de aceptación (`feature_list.json`, id 22 / context §5) | Requisitos |
|---|---|---|
| A1 | Habilitar un dato en "Editar plantilla" (nativo) se refleja en la config Y en maniobra **sin reiniciar**, en pocos segundos. | R22.1–R22.3, R22.10, R22.12–R22.16 |
| A2 | Un cambio server-side (campo/rodeo/lote/config de un coworker) baja al device en sesión viva sin cold start, evidenciado por la instrumentación. | R22.1–R22.7, R22.23 |
| A3 | La reconexión no dispara loops ni apila conexiones (StrictMode-safe); offline puro intacto. | R22.4, R22.5, R22.6, R22.21 |
| A4 | `useManeuverGating` reacciona determinista (~1,5 s) al cambio local de `rodeo_data_config`, preservando la resolución del gating; sin regresión 20/21. | R22.10, R22.12, R22.16, R22.17, R22.18, R22.19, R22.20 |
| A5 | La suite E2E existente (incl. `reactividad-sync.spec.ts`) sigue verde; el veredicto de "baja en vivo en nativo" es device (ADR-029). | R22.9, R22.28, R22.29 |

**Cobertura de los edge cases del `context.md` §4** (regla de `docs/specs.md`: cada caso cubierto por ≥1 `R22.<n>`):

| Edge case (context §4) | Requisitos que lo cubren |
|---|---|
| 1 — socket zombie (teardown+reconnect real, no no-op) | R22.2, R22.3, R22.23 |
| 2 — StrictMode / doble-mount (cleanup idempotente, no apilar) | R22.4, R22.5 |
| 3 — offline puro intacto (sin red = sin intentos, no loop) | R22.6, R22.21 |
| 4 — token refresh / expiración (no matar descarga sin reconectar) | R22.7, R22.8 |
| 5 — no romper la reactividad 20/21 (dep primitiva, sin loop, resolución preservada) | R22.11, R22.12, R22.17, R22.18, R22.19, R22.20 |
| 6 — watched query overlay-aware (overlay pisa la synced) | R22.13, R22.14, R22.22 |
| 7 — web sin regresión (reconexión no-op/mejora; E2E verde) | R22.9, R22.28 |

---

## 11. Verificabilidad

Cada `R22.<n>` tiene ≥1 test o inspección asignada en `tasks.md`. Resumen del tipo de prueba:

- **Inspección de wiring verificada por el reviewer** (el cambio es de DISPARADOR / ciclo de vida, no de lógica pura): R22.1, R22.2, R22.3, R22.4, R22.5, R22.7, R22.8, R22.10, R22.11, R22.12, R22.13, R22.15, R22.17, R22.20, R22.23, R22.24, R22.25, R22.26.
- **Unitario puro** (SQL builder + resolución del gating ya existentes, sin cambio): `buildRodeoConfigQuery` overlay-override (R22.13), `maneuver-gating` (R22.12) — sus suites siguen verdes y garantizan que la resolución preservada es correcta.
- **E2E (Playwright, `./helpers/fixtures`), en WEB**: bucle config→maniobra reactivo (R22.10, R22.16) sin `page.reload()`; offline puro / app quieta (R22.6, R22.21); `reactividad-sync.spec.ts` sigue verde (R22.9, R22.28). La reactividad determinista de la 21 no debe regresionar.
- **Veredicto en DEVICE (ADR-029)** + instrumentación (R22.23): que la descarga reengancha tras `offline→online` y `background→active` (R22.1–R22.3, R22.7); que habilitar un dato se ve en config+maniobra sin reiniciar (A1); que no hay loop ni apilado (A3). El veredicto de sync-down en vivo en nativo NO es automatizable en web.
- **`git diff supabase/ sync-streams/` vacío** (R22.25) — check mecánico de cliente-puro.
- **typecheck + lint** — firmas públicas intactas (R22.11), sin `lastSyncedMs` como dep del gating (R22.11).
