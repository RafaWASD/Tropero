baseline_commit: c83e94084423ccf8fc738f4d7f6dbb73bfb8c707

# impl 22 — sync-liveness-nativo (reconexión + watched queries de config/maniobra)

Feature 22, `in_progress`, spec APROBADO (Puerta 1). CLIENTE PURO (sin Gate 1). Continúa ADR-030.
Baseline = SHA previo a la primera task (trabajamos sobre `main`, sin feature-branch → NO se usa `main...HEAD`).

## Archivos tocados (código)
- `app/package.json` + `app/pnpm-lock.yaml` — dep `@react-native-community/netinfo@12.0.1` (pnpm / expo install).
- `app/src/services/powersync/provider.tsx` — (a) efecto de LIVENESS: listeners NetInfo (offline→online ⇒ ensure) + AppState (background→active ⇒ nativo teardown+reconnect / web ensure), guard de reentrada `reconnectingRef`, gate de sesión por ref, cleanup idempotente; + wire de `subscribeSyncDiagnostics`. Efecto de sesión EXISTENTE intacto.
- `app/src/services/powersync/status.ts` — export aditivo `subscribeSyncDiagnostics` (const de módulo `SYNC_DIAGNOSTICS_ENABLED=true`, NO `__DEV__`; flags+timestamp, sin PII).
- `app/src/hooks/useManeuverGating.ts` — (d) sacado `useStatus`/`lastSyncedMs` + el `useEffect([lastSyncedMs])`; agregado `usePowerSync` + `db.onChange({tables:['rodeo_data_config','pending_rodeo_data_config']})` corriendo `load()`, dep primitiva `[rodeoId, load, db]`. `useFocusEffect`/`load`/`reqIdRef`/`loadedRodeoRef` intactos. Firma pública sin cambios.
- `app/app/editar-plantilla.tsx` — (d) efecto `db.onChange` overlay-aware (`refreshFromLocal`) que refresca `baseConfig` + vista read-only SIN pisar los `toggles` sin guardar del owner (criterio `computeEditDiff(prev, baseConfigPrevio).length>0`). Carga inicial intacta.
- `app/e2e/maniobra-config-reactiva.spec.ts` — NUEVO (T9): bucle config→maniobra reactivo (habilitar `inseminacion` server-side aparece en el pool del wizard sin reload) + offline puro del pool.

## Verificación (honesta)
- **typecheck** (`pnpm -C app typecheck`): VERDE.
- **`node scripts/check.mjs`**: VERDE end-to-end ("All tests passed" / "Entorno listo"). Cubre typecheck + client unit suites (incl. `maneuver-gating`, `maneuver-gating-load`, `local-reads` que testea `buildRodeoConfigQuery` — lógica pura NO tocada, siguen verdes) + todas las suites backend (RLS/Edge/Animal/Maneuvers/Custom/Scrotal/user_private/Import/Sync-streams/Operaciones-rodeo/SIGSA/Treatments/Audit/Health/Reports/Puesta-en-servicio). Sin rojos → sin flakes esta corrida.
- **E2E web (specs afectados, `pnpm exec playwright test`)**: **8/8 passed**, sin retries.
  - `maniobra-config-reactiva.spec.ts` — 2/2: (R22.10/R22.16) habilitar data_key server-side aparece en el pool del wizard SIN `page.reload()` (8.0s); (R22.6/R22.21) offline puro: el pool no cambia sin cambios de tabla (13.6s).
  - `reactividad-sync.spec.ts` — 6/6 (incl. las 2 revocaciones + offline puro): SIN regresión de la reactividad 20/21 ni del ciclo de vida de conexión (los cambios del provider no rompen web).
  - NO se corrió `e2e:build` para toda la suite (evita re-render de 40+ `design/*.png`, memoria); `git status design/` vacío tras la corrida; `dist/` gitignored.
- **cliente puro (T10)**: `git diff --stat -- supabase/ sync-streams/` VACÍO (R22.25). ✓
- **firma pública `UseManeuverGating`**: sin cambios (typecheck lo garantiza). Sin `lastSyncedMs`/`useStatus` en el gating (R22.11): grep + typecheck.

## Queda para veredicto en DEVICE (ADR-029, T11 — NO verificable por el implementer)
- Que la descarga REENGANCHA en NATIVO tras `offline→online` (R22.1) y `background→active` (R22.2/R22.3), evidenciado por la traza `[powersync][diag]` (R22.23: `downloading`/`lastSyncedAt` se mueven tras el trigger).
- Que habilitar un dato en "Editar plantilla" se ve en config + maniobra SIN reiniciar (A1), y que no hay loops ni apilado de conexiones (A3).
- Que el refresh de token no deja la descarga muerta (R22.7).
- Reserva del spec (design §3.5-bis, V1): si la muerte del socket es MID-FOREGROUND (sin cambio de red ni background), los dos triggers de (a) NO disparan → el fix podría no cubrir el repro puntual de Raf. La instrumentación (R22.23) es el árbitro; el watchdog (a′) es contingencia NO implementada (candado del spec). Documentado para el veredicto de device.

## Trazabilidad — R22.<n> → verificación
| R | Cómo se verifica |
|---|---|
| R22.1 | provider.tsx listener NetInfo → `ensureConnected` · [REVIEW] + [DEVICE] |
| R22.2 | provider.tsx AppState active nativo → `reconnect(true)` (disconnect→connect) · [REVIEW] + [DEVICE] |
| R22.3 | provider.tsx `reconnect(true)` teardown real · [REVIEW] + [DEVICE via R22.23] |
| R22.4 | `reconnectingRef` guard (return si en curso; libera en `finally`) · [REVIEW] |
| R22.5 | cleanup del efecto: `netInfoUnsub()` + `appStateSub.remove()` (idempotente, StrictMode-safe) · [REVIEW] + E2E (reactividad-sync verde = sin leak que rompa la app) |
| R22.6 | NetInfo solo actúa en online; e2e `maniobra-config-reactiva` offline · [WEB] + [REVIEW] |
| R22.7 | `fetchCredentials` + revalidación de foreground (R22.2) · [REVIEW] + [DEVICE] |
| R22.8 | efecto de sesión EXISTENTE intacto + `hasValidSessionRef` gatea `reconnect` · [REVIEW] |
| R22.9 | teardown gateado a nativo; `reactividad-sync` 6/6 + `maniobra-config-reactiva` 2/2 verdes · [WEB] |
| R22.10 | `useManeuverGating` `db.onChange`; e2e config→pool reactivo · [WEB] + [REVIEW] |
| R22.11 | sacado `useStatus`/`lastSyncedMs`; grep + typecheck; `maneuver-gating` unit verde · [TYPE] + [REVIEW] + [UNIT] |
| R22.12 | `load`/`fetchRodeoGating` intactos; firma pública igual; `maneuver-gating.test.ts` + `local-reads.test.ts` verdes · [UNIT] + [TYPE] |
| R22.13 | onChange observa AMBAS tablas; `buildRodeoConfigQuery` (overlay-override) en `local-reads.test.ts` · [REVIEW] + [UNIT] |
| R22.14 | `editar-plantilla` `refreshFromLocal` no pisa `toggles` sin guardar (computeEditDiff) · [REVIEW] + [DEVICE] |
| R22.15 | efecto dep `[rodeoId, load, db]` (re-suscribe por rodeo) + `useFocusEffect` (carga inicial; onChange no dispara al registrarse) · [REVIEW] |
| R22.16 | e2e `maniobra-config-reactiva` (reacción determinista en web) · [WEB] + [DEVICE ~1,5 s] |
| R22.17 | dep PRIMITIVA (no objeto de status); `reactividad-sync` verde (sin loop) · [REVIEW] + [WEB] |
| R22.18 | throttle del SDK (default) coalesce la ráfaga del checkpoint · [REVIEW] |
| R22.19 | `load`/`loadedRodeoRef`/`reqIdRef` intactos; `maneuver-gating-load.test.ts` verde · [UNIT] + [REVIEW] |
| R22.20 | `EstablishmentContext`/`RodeoContext`/`lotes.tsx`/puras 20 NO tocadas (git diff); `reactividad-sync` verde · [REVIEW] + [WEB] |
| R22.21 | e2e offline puro (pool no cambia) + `reactividad-sync` T22 · [WEB] |
| R22.22 | overlay (`pending_rodeo_data_config`) observado + `buildRodeoConfigQuery` overlay-override · [REVIEW] + [UNIT] |
| R22.23 | `subscribeSyncDiagnostics` loguea flags+timestamp en cada statusChanged · [REVIEW] + [DEVICE] |
| R22.24 | const de módulo (off ⇒ no-op dispose), solo flags+timestamp (sin PII), dispose en unmount · [REVIEW] |
| R22.25 | `git diff --stat -- supabase/ sync-streams/` VACÍO · [REVIEW mecánico] ✓ |
| R22.26 | sin schema/RLS/sync-rule/Edge; el acceso lo sigue gobernando `org_scope`+RLS · [REVIEW] |
| R22.27 | watched query lee SQLite local (cero red nueva); e2e offline · [REVIEW] + [WEB] |
| R22.28 | `reactividad-sync.spec.ts` 6/6 verde · [WEB] |
| R22.29 | esta tabla · [REVIEW] |

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Cleanup idempotente / StrictMode:** mount→cleanup→mount re-suscribe listeners frescos (NetInfo devuelve unsub nuevo; AppState `.remove()` idempotente) → sin apilar. `reconnectingRef` persiste entre el doble-invoke y el guard evita connects concurrentes. OK.
- **Guard cierra en `finally` incl. si `connect` throwea:** sí — `reconnect` pone `reconnectingRef.current=false` en `finally` (probado por lectura; si no, quedaría trabado). OK.
- **Teardown gateado a nativo (web no regresiona):** `AppState active` → web `ensureConnected` (sin teardown), nativo `reconnect(true)`. Confirmado por `reactividad-sync` 6/6 + `maniobra-config-reactiva` 2/2 verdes en web. OK.
- **Race de boot (NetInfo dispara al suscribirse):** `ensureConnected` chequea `db.connected || db.connecting` → no racea el connect inicial del efecto de sesión. OK.
- **Connect sin sesión:** `reconnect` y `ensureConnected` gatean por `hasValidSessionRef.current` ANTES de tocar el socket (incl. antes del `disconnect` del teardown) → nunca conecta/desconecta sin sesión. Efecto de sesión intacto (R22.8). OK.
- **Watched query observa las DOS tablas:** `['rodeo_data_config','pending_rodeo_data_config']` en useManeuverGating y en editar-plantilla. Sin ellas se perdería el disparo del overlay (feedback optimista) o el de la fila synced. OK.
- **Stale-while-revalidate preservado:** `load`/`loadedRodeoRef`/`reqIdRef` sin tocar; `maneuver-gating-load.test.ts` verde; el disparo más frecuente (onChange vs lastSyncedMs) pasa por el mismo camino silencioso. OK.
- **Clobber de ediciones sin guardar en editar-plantilla:** con `computeEditDiff(prev, baseConfigPrevio).length>0` se detecta la edición en curso y NO se pisan los toggles (solo se actualiza `baseConfig`). El invariante "save-sin-cambios = NO-OP" (existente) garantiza que post-load `computeEditDiff===0` (sin falso positivo). OK.
- **`git diff supabase/ sync-streams/` vacío:** confirmado. OK.
- **Const de instrumentación de módulo (no `__DEV__`):** `const SYNC_DIAGNOSTICS_ENABLED = true;`. OK (V2 veto).
- **Firma pública `UseManeuverGating`:** intacta (typecheck). OK.
No encontré defectos abiertos; los puntos anteriores quedaron cerrados en la implementación (no requirieron fix posterior).

## Reconciliación de specs (paso 9)
La implementación NO divergió del design (siguió §3/§4/§5 al pie). Por lo tanto `requirements.md`/`design.md` ya reflejan el as-built. Se reconciliaron:
- `tasks.md` — T0–T7/T9/T10 `[x]`; nota de estado de T8 (reviewer)/T11 (device)/T12 (cierre/leader) + **notas as-built** (versión de NetInfo 12.0.1, guard/ensure con `db.connecting`, criterio `computeEditDiff` de editar-plantilla) — todo dentro de lo que el design dejó abierto (§10.1/§4.5), sin contradecir los EARS.
- Comentario de header de `useManeuverGating.ts` actualizado (ya no dice "avanzar el SYNC"/"patrón useGroupView"; ahora watched query `db.onChange`).
- **Pendiente de cierre (design §11, del leader en Puerta 2, NO del implementer):** nota a ADR-030 (useManeuverGating migrado), a `specs/active/15-powersync/design.md` (watched queries + liveness de conexión), a `docs/backlog.md` (cerrar ítem 2026-07-18; RC-2/(c) fast-follow Gate 1; (b) contingente), y la DECISIÓN ADR-031 (§10.2). No las toco unilateralmente (decisión del leader + son docs de cierre).

## NO marco la feature `done` (lo hace el leader tras reviewer + Gate 2 + Gate 2.5 + Puerta 2).
</content>
