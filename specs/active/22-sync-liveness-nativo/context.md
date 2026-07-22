# context.md — 22 · Sync-down en vivo en nativo (reconexión + watched queries de config/maniobra)

> **Gate 0 (ADR-022).** Refinamiento de contexto CERRADO. Aprobado por Raf (2026-07-22, vía AskUserQuestion:
> "(a) reconexión + (d) watched + instrumentación"). Alcance CLIENTE PURO → **sin Gate 1** (no toca sync
> rules / RLS / Edge). Continúa la migración incremental de watched queries de ADR-030 (feature 21).

## 1. El problema (confirmado con evidencia)

En **nativo** (device Android real), cuando el owner habilita datos en "Editar plantilla" de un rodeo
(`editar-plantilla.tsx` → RPC `set_rodeo_config` vía outbox + overlay optimista), el cambio:

- **SÍ persiste server-side** (verificado en DB dev `xrhlxxdnfzvdnztacofj`: para el rodeo real de Raf "Cria
  hembras", `rodeo_data_config.enabled=true`, `updated_at` = momento del save, `establishment_id` correcto,
  dentro del scope del stream `est_rodeo_data_config` que es `auto_subscribe: true`). `vacunacion` es
  `system_default_field` de cría con `default_enabled=true`.
- **Pero en el device vuelve a verse deshabilitado tras guardar**, y NO se puede usar en maniobra.
- Tras **cerrar y reabrir la app** (cold start) → aparece habilitado correctamente.
- Raf habilitó ~5 datos y **todos** quedaron off hasta el reinicio (no es puntual de un field).

Evidencia clave de que **el dato NO baja al SQLite local en vivo** (no es solo un problema de re-lectura): al
**re-entrar** a la config —que re-monta y re-lee el SQLite local one-shot— seguía en OFF. Un re-mount re-lee;
si mostrara stale es porque el local mismo está stale.

## 2. Root causes (Plan agent, 2026-07-22, con `file:line`)

**Insight central:** el **upload** del save NO viaja por el stream de PowerSync — es un `supabase.rpc()` HTTP
directo (`app/src/services/powersync/connector.ts:152`), canal SEPARADO del **download** (WebSocket). Por eso
**sube aunque la descarga esté muerta**.

- **RC-1 (primaria) — no hay reconexión/revalidación.** `db.connect(connector)` se llama **una sola vez**
  (`app/src/services/powersync/provider.tsx:73`), sin NetInfo (online→connect) ni AppState (foreground→
  revalidar). Si el socket de descarga se cuelga, nadie lo reengancha → los cambios del server (incl. el eco
  del propio write) no bajan hasta un cold `db.connect()`. Prior fuerte ya documentado: `docs/backlog.md`
  entrada 2026-07-18 (reproducido en el A07 con un campo nuevo).
- **RC-2 (amplificadora) — el overlay se limpia en el ACK HTTP, desacoplado de la descarga.** En éxito de la
  RPC → `clearOverlay(clientOpId)` (`connector.ts:157`) + `transaction.complete()` **sin `writeCheckpoint`**
  (`connector.ts:158`). El overlay se borra ANTES (y con RC-1, SIN NUNCA) de que baje la fila synced
  confirmada → la lectura cae a la fila synced stale (`enabled=0`) → revierte. `clearOverlay === rollbackOverlay`
  (`outbox.ts:526-540`): DELETE por `client_op_id`, sin condición de "esperá a que baje la fila real".
- **RC-3 (terciaria) — los consumidores de config son lecturas one-shot, no watched queries.**
  `rodeo-config.ts:122-134` `fetchRodeoConfig` one-shot; `editar-plantilla.tsx:136-139` re-lee solo al montar;
  `useManeuverGating.ts:107-118` re-lee en `useFocusEffect` + avance de `lastSyncedMs` (el proxy NO
  determinista que ADR-030 declaró equivocado). La config NO entró en los 3 consumidores migrados por la
  feature 21 (ADR-030 líneas 48-51: quedan pendientes `maniobra` + el resto).

**Correcciones a premisas** (para el spec): adapter nativo = `@powersync/op-sqlite` (op-sqlite 15.2.14), NO
`react-native-quick-sqlite` (migrado por New Arch, `database.ts:59-74`). `connectionMethod` por defecto =
**WebSocket** (`common/dist/bundle.cjs:11570`); el fallback HTTP-streaming NO está disponible hoy (falta la dep
`react-native-fetch-api`). Los polyfills (`polyfills.ts`) NO son la causa (el path WS trae su propio
TextEncoder/ReadableStream/BSON/RSocket bundleado).

## 3. Alcance APROBADO (Gate 0)

**IN (esta feature):**

- **(a) Reconexión/revalidación** en `provider.tsx`: NetInfo (offline→online ⇒ asegurar conexión) + AppState
  (background→active ⇒ revalidar/reconectar). Cleanup de listeners en el unmount; guard de reentrada (no apilar
  reconexiones). **Manejar el socket zombie**: si una 2da `connect()` puede no-opear sobre un socket "colgado
  pero no cerrado", hacer `disconnect()`+`connect()` explícito (a verificar en device con la instrumentación).
- **(d) Watched queries** para los consumidores de config/maniobra: migrar `useManeuverGating` (y el read de
  `editar-plantilla`) de one-shot + `lastSyncedMs` a `useQuery`/`db.onChange` sobre `rodeo_data_config` +
  `pending_rodeo_data_config` (patrón ADR-030 / feature 21). Preservar la LÓGICA de resolución del gating (no
  solo las filas) — `db.onChange` notifica y re-corre la resolución existente (como los contextos de la 21).
- **Instrumentación de `SyncStatus`**: loguear (dev/diagnóstico) `connected` / `dataFlowStatus.downloading` /
  `uploading` / `lastSyncedAt` en cada `statusChanged` (hook existente `status.ts:26` `subscribeSyncUiState`),
  para que el próximo build en device **confirme en vivo** que la descarga fluye (cierra RC-1). No es UI de
  usuario final — es telemetría de diagnóstico, desactivable.

**OUT (diferido / contingente):**

- **(c) Sostener el overlay hasta que baje la fila confirmada** (consistencia post-write) → RC-2. **DIFERIDO**:
  es la única pieza que toca la frontera de reconciliación outbox↔overlay↔descarga (candidato a **Gate 1**), y
  es "belt-and-suspenders": con la descarga sana (a+d), RC-2 queda en un flicker sub-segundo casi invisible
  (`editar-plantilla` ya navegó; los consumidores re-leen). Se reevalúa si el flicker molesta en maniobra.
  → **anotar en `docs/backlog.md` como fast-follow con Gate 1.**
- **(b) Arreglar el streaming de descarga (HTTP method / `react-native-fetch-api`)** → **CONTINGENTE**: solo si
  la instrumentación muestra que (a) NO restablece la descarga viva. Suma una dep de polyfill. No se hace a
  ciegas.

## 4. Edge cases y riesgos a cubrir en el spec

1. **Socket zombie**: confirmar que la reconexión fuerza un teardown+reconnect real, no un no-op sobre un
   socket colgado. La instrumentación lo evidencia (¿`downloading` reengancha tras el trigger?).
2. **StrictMode / doble-mount** (dev): los listeners y el guard de reentrada no deben apilar conexiones ni
   dejar listeners colgados. Cleanup idempotente (patrón `reconnectScheduled` de `adapter-web-serial`).
3. **Offline puro intacto** (principio 3 CLAUDE.md): sin red, la reconexión no debe romper nada; NetInfo
   offline→online es el único trigger de connect, no un loop. Sin red = sin intentos.
4. **Token refresh / expiración**: un refresh de token no debe matar la descarga sin reconectar. Verificar que
   `fetchCredentials` + la revalidación de foreground cubren el caso.
5. **No romper la reactividad de la 20/21**: la migración de `useManeuverGating` a watched query debe PRESERVAR
   la resolución del gating (no solo re-leer filas) y no reintroducir el loop que la 20 evitó (dep primitiva).
6. **Watched query overlay-aware**: la watched query de config debe respetar el overlay-override de
   `buildRodeoConfigQuery` (`local-reads.ts:75-102`) — el overlay PISA la fila synced del mismo field (≤1 fila
   por (rodeo,field), invariante del DELETE-PRIOR).
7. **Web no debe regresionar**: en web la descarga ya fluye (~1,5s, ADR-030). Los cambios de reconexión son
   no-op en web (o mejora), y las watched queries ya son el patrón. La E2E web debe seguir verde.

## 5. Criterios de aceptación (borrador para el spec)

- Habilitar un dato en "Editar plantilla" (nativo) se refleja en la config Y en maniobra **sin reiniciar la
  app**, en pocos segundos.
- Un cambio server-side (campo/rodeo/lote/config de un coworker) baja al device durante la sesión viva, sin
  cold start (RC-1 cerrada) — evidenciado por la instrumentación (`downloading`/`lastSyncedAt` se mueven).
- La reconexión no dispara loops ni apila conexiones (StrictMode-safe); offline puro intacto.
- `useManeuverGating` reacciona determinista (~1,5s) al cambio local de `rodeo_data_config`, preservando la
  resolución del gating; sin regresión de la reactividad 20/21.
- La suite E2E existente (incl. `reactividad-sync.spec.ts`) sigue verde; se agrega/extiende cobertura del bucle
  config→maniobra donde sea automatizable en web (el veredicto de "baja en vivo en nativo" es device, ADR-029).

## 6. Gates aplicables

- **Gate 1**: **N/A** — cliente puro (no toca sync rules / RLS / Edge / schema). Verificable con `git diff
  supabase/ sync-streams/` vacío. (Si en implementación apareciera necesidad de tocar la frontera → parar y
  reabrir Gate 1.)
- **Gate 2** (security_code): sí, pero superficie mínima (sin inputs nuevos, sin authz; la reconexión no cambia
  qué datos ve el usuario — eso lo gobierna `org_scope` + RLS server-side, intactos).
- **Gate 2.5** (E2E + capturas + veto visual, ADR-029): sí — toca UI de maniobra/config. Veto del leader del
  bucle config→maniobra antes de mostrar a Raf.

## 7. Archivos críticos (del diagnóstico)

- `app/src/services/powersync/provider.tsx` — (a): reconexión NetInfo+AppState, opciones de `connect`.
- `app/src/services/powersync/connector.ts` — RC-2 (diferida): `clearOverlay`/`transaction.complete`.
- `app/src/services/powersync/outbox.ts` — RC-2 (diferida): semántica `clearOverlay`/`rollbackOverlay`.
- `app/src/hooks/useManeuverGating.ts` — (d): migrar a watched query (RC-3).
- `app/src/services/powersync/local-reads.ts` — `buildRodeoConfigQuery` overlay-override (l.75), base de la
  watched query.
- `app/src/services/powersync/status.ts` — instrumentación (`subscribeSyncUiState`, l.26).
- `app/app/editar-plantilla.tsx` — (d): read reactivo del config.
