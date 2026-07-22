# Tasks — feature 22: sync-down en vivo en nativo (reconexión + watched queries de config/maniobra)

> Orden de implementación. Cada tarea indica el/los archivo(s) que toca, los `R22.<n>` que cubre y **cómo se verifica** (unit / e2e / typecheck / inspección del reviewer / veredicto DEVICE).
> Convención de verificación: **[WEB]** = automatizable en E2E web; **[DEVICE]** = veredicto en device (ADR-029: sync-down vivo en nativo NO se prueba en web); **[UNIT]** = node:test; **[TYPE]** = typecheck/lint; **[REVIEW]** = inspección de wiring del reviewer.
> Regla dura: NO tocar `supabase/**` ni `sync-streams/rafaq.yaml` (R22.25). `git diff supabase/ sync-streams/` debe quedar VACÍO al cerrar.

---

## Bloque 0 — Prerrequisito (decisión + dependencia)

- [x] **T0 — Confirmar y agregar la dependencia de conectividad.** Depende de la decisión abierta §10.1 del design. Default: `@react-native-community/netinfo`. Es módulo nativo → requiere `expo prebuild` + nuevo dev build para probar (a) en device. Verifica: `[TYPE]` la dep resuelve e importa; `[DEVICE]` disponible en el dev build. **Bloqueante para T1–T3.**
  - Toca: `app/package.json` (+ config plugin si aplica). NO toca la frontera de sync.

---

## Bloque A — Reconexión / revalidación (a) · RC-1

- [x] **T1 — Guard de reentrada + helper de reconexión en `provider.tsx`.** Agregar `reconnectingRef` (patrón `reconnectScheduled` de `adapter-web-serial.ts:158`) y dos helpers: `ensureConnected()` (connect si `!db.connected`, para NetInfo) y `revalidate()` (nativo: `disconnect()`→`connect()`, teardown del zombie). Ambos respetan el guard y el gate de sesión (`hasValidSession`). Cubre: R22.2, R22.3, R22.4, R22.8. Verifica: `[REVIEW]` guard + gate + teardown explícito; `[TYPE]`.
  - Toca: `app/src/services/powersync/provider.tsx`.

- [x] **T2 — Listener de NetInfo (`offline→online`).** Suscribir NetInfo dentro del efecto del provider; en la transición a con-red y con sesión válida, llamar `ensureConnected()`. Sin red = sin intentos (solo dispara en la transición, no en bucle). Cleanup del listener en el return del efecto. Cubre: R22.1, R22.6, R22.5. Verifica: `[DEVICE]` la descarga reengancha al recuperar red (instrumentación T7); `[WEB]` el ciclo de vida no rompe la app (E2E existente verde, T8); `[REVIEW]` cleanup idempotente.
  - Toca: `app/src/services/powersync/provider.tsx`.

- [x] **T3 — Listener de AppState (`background→active`) + teardown zombie.** Suscribir AppState; en `active` con sesión válida y en nativo, llamar `revalidate()` (`disconnect()`→`connect()`). En web: no-op / solo `ensureConnected()` (sin teardown agresivo, R22.9). Cleanup del listener en el return. Cubre: R22.2, R22.3, R22.5, R22.7, R22.9. Verifica: `[DEVICE]` volver de background reengancha la descarga (instrumentación); `[DEVICE]` tras expiración/refresh de token la descarga sigue viva; `[WEB]` E2E verde sin resyncs espurios (T8); `[REVIEW]` teardown gateado a nativo.
  - Toca: `app/src/services/powersync/provider.tsx`.

---

## Bloque B — Instrumentación de SyncStatus

- [x] **T4 — `subscribeSyncDiagnostics` en `status.ts`.** Export aditivo que registra un `statusChanged` (`db.registerListener`) y loguea `connected`/`dataFlowStatus.downloading`/`uploading`/`lastSyncedAt` de `db.currentStatus`. Gate por `__DEV__` (o const de módulo) → desactivable. Sin PII (solo flags + timestamp). Devuelve dispose. Cubre: R22.23, R22.24. Verifica: `[UNIT]`/`[REVIEW]` con flag off devuelve no-op; log solo flags + timestamp; `[TYPE]`.
  - Toca: `app/src/services/powersync/status.ts`.

- [x] **T5 — Wire de la instrumentación en `provider.tsx`.** Montar `subscribeSyncDiagnostics` en un efecto con cleanup (dispose en unmount). Cubre: R22.23, R22.24. Verifica: `[DEVICE]` la traza aparece en cada `statusChanged` y evidencia el reenganche tras T2/T3; `[REVIEW]` cleanup.
  - Toca: `app/src/services/powersync/provider.tsx`.

---

## Bloque C — Watched queries de config/maniobra (d) · RC-3

- [x] **T6 — Migrar `useManeuverGating` a `db.onChange`.** Sacar `useStatus`/`lastSyncedMs` (`:63-64`) y el `useEffect([lastSyncedMs, load])` (`:115-118`). Agregar `usePowerSync` + un `useEffect` que registra `db.onChange({ tables: ['rodeo_data_config','pending_rodeo_data_config'] })` corriendo `load()`, dep primitiva `[rodeoId, load, db]`, dispose en el return. Conservar el `useFocusEffect` de carga inicial (`:107-111`), `load`, `reqIdRef`, `loadedRodeoRef` (stale-while-revalidate). Firma pública `UseManeuverGating` intacta. Cubre: R22.10, R22.11, R22.12, R22.13, R22.15, R22.17, R22.18, R22.19. Verifica: `[REVIEW]` disparador nuevo + tablas observadas + dispose + ausencia de `lastSyncedMs` + dep primitiva; `[TYPE]` firma pública; `[UNIT]` `maneuver-gating`/`buildRodeoConfigQuery` verdes (resolución + overlay-override preservados); `[WEB]` bucle config→maniobra (T9); `[DEVICE]` reacción ~1,5 s al habilitar un dato.
  - Toca: `app/src/hooks/useManeuverGating.ts`.

- [x] **T7 — Read reactivo de config en `editar-plantilla.tsx`.** Agregar un efecto `db.onChange` overlay-aware (`rodeo_data_config` + `pending_rodeo_data_config`) que refresca `baseConfig` (base del diff) y la vista read-only, **sin pisar los `toggles` sin guardar** del owner (design §4.5). Conservar el `load` al montar (`:136-139`). Cubre: R22.14, R22.22. Verifica: `[REVIEW]` no clobber de ediciones en curso + dispose; `[WEB]` re-entrar a la config tras un toggle muestra el estado correcto (T9); `[DEVICE]` reflejo sin reiniciar.
  - Toca: `app/app/editar-plantilla.tsx`.

---

## Bloque D — Verificación E2E (web) y reconciliación

- [x] **T8 — Regresión: E2E existente verde (incl. `reactividad-sync.spec.ts`).** _(reviewer corrió los 2 specs de riesgo directo — `reactividad-sync` 6/6 + `maniobra-config-reactiva` 2/2, sin retries, `design/` limpio; suite COMPLETA diferida a propósito para no re-renderizar 40+ `design/*.png`.)_ Correr la suite; confirmar que el ciclo de vida de conexión (a) no rompe nada en web (idempotente/no-op) y que la reactividad determinista de la 21 no regresiona. Cubre: R22.9, R22.28. Verifica: `[WEB]` suite completa verde (reviewer/Explore read-only, no implementer).
  - Toca: nada de código (corrida de verificación).

- [x] **T9 — E2E del bucle config→maniobra reactivo (web).** Extender/agregar cobertura: con la app VIVA (sin `page.reload()` tras el cambio — regla de oro), habilitar un dato en la config de un rodeo (o simular el cambio local de `rodeo_data_config`) y assertar que el gating de la maniobra lo refleja reactivo; y offline puro (app quieta → sin cambio de estado). Cubre: R22.10, R22.16, R22.6, R22.21 (parte web). Verifica: `[WEB]` E2E determinista sin retries.
  - Toca: `app/e2e/*.spec.ts` (nuevo o extensión; p. ej. junto a `maniobra-elegir`/`reactividad-sync`).

- [x] **T10 — Chequeo de cliente-puro.** `git diff --stat supabase/ sync-streams/` debe estar VACÍO. Cubre: R22.25. Verifica: `[REVIEW]` diff vacío.
  - Toca: nada.

- [ ] **T11 — Veredicto DEVICE (ADR-029) + instrumentación.** Build en device con NetInfo: confirmar por la traza de diagnóstico (T4/T5) que la descarga reengancha tras `offline→online` y `background→active`; que habilitar un dato en la config se ve en config + maniobra sin reiniciar (A1); que no hay loops ni apilado de conexiones (A3). Cubre: R22.1–R22.3, R22.7, R22.16, R22.23 (veredicto). Verifica: `[DEVICE]` (Raf + capturas si hay UI, Gate 2.5).
  - Toca: nada de código (veredicto en device).

- [x] **T12 — Reconciliación de specs + ADR (design §11).** _(cierre en Puerta 2, 2026-07-22: **ADR-031** creado; ADR-030 nota `useManeuverGating` migrado (quedan 4); `specs/active/15-powersync/design.md` puntero forward; `docs/backlog.md` ítem 2026-07-18 → "EN FIX" + RC-2/(c) fast-follow Gate 1 + (b) contingente.)_ Actualizar ADR-030 (nota de `useManeuverGating` migrado), `specs/active/15-powersync/design.md` (watched queries + conexión), `docs/backlog.md` (cerrar ítem 2026-07-18; anotar RC-2/(c) fast-follow Gate 1 y (b) contingente). Si el leader aprobó ADR-031 (§8/§10.2), crearlo. Cubre: cierre de la regla "correcciones se reflejan en specs". Verifica: `[REVIEW]` docs consistentes con el as-built.
  - Toca: `docs/adr/`, `specs/active/15-powersync/design.md`, `docs/backlog.md`.

---

## Estado de implementación (2026-07-22)

- **T0–T7, T9, T10 `[x]`** — implementados + verificados (typecheck + lint + client unit suites verdes vía `node scripts/check.mjs`; E2E web de la watched query verde; `git diff supabase/ sync-streams/` vacío). Detalle + trazabilidad en `progress/impl_22-sync-liveness-nativo.md`.
- **T8 (regresión E2E full)** — el implementer verificó los specs con riesgo directo (`reactividad-sync.spec.ts` 6/6 + el nuevo `maniobra-config-reactiva.spec.ts` 2/2, sin retries, todos con la app viva sin `page.reload()`). La corrida de la suite E2E COMPLETA queda para el **reviewer/Explore** (read-only, no implementer — tasks.md T8) para no re-renderizar los 40+ `design/*.png` de los specs de captura.
- **T11 (veredicto DEVICE)** — pendiente de Raf (ADR-029): que la descarga reengancha tras `offline→online`/`background→active` (instrumentación T4/T5) y que habilitar un dato se ve en config+maniobra sin reiniciar. NO verificable por el implementer.
- **T12 (reconciliación de cierre + ADR-031)** — acción de cierre (design §11), del leader en Puerta 2: notas a ADR-030 / `specs/active/15-powersync/design.md` / `docs/backlog.md`, y la DECISIÓN de crear o no ADR-031 (§10.2, decisión del leader — el implementer NO la toma unilateralmente). La implementación NO divergió del design → las specs de la feature (requirements/design) ya reflejan el as-built; ver las notas as-built abajo.

### Notas as-built (decisiones concretas, dentro de lo que el design dejó abierto)

- **Dependencia (§10.1):** `@react-native-community/netinfo@12.0.1` (versión resuelta por `expo install` para Expo SDK 56 / RN 0.85; pnpm). Módulo nativo → el dev build lo materializa por autolinking (rebuild de Raf con EAS); el JS queda wireado y el bundle WEB lo resuelve por su variante web (`navigator.onLine`) — verificado con `expo export -p web` verde y la E2E web verde. Sin mock: la impl web de NetInfo funciona en Chromium/Playwright.
- **Guard de reentrada:** `reconnectingRef` (bool) + gate de sesión por `hasValidSessionRef` (leído fresco sin re-suscribir). `ensureConnected` (NetInfo/web) chequea `db.connected || db.connecting` (evita racear el connect inicial del efecto de sesión, que NetInfo dispara al suscribirse); `reconnect(teardown)` libera el guard en `finally` (incluso si `connect`/`disconnect` throwean).
- **editar-plantilla (§4.5):** el criterio "hay ediciones sin guardar" se implementa con `computeEditDiff(togglesActuales, baseConfigPrevio).length > 0` (misma primitiva que el NO-OP de "guardar sin cambios"). Con ediciones en curso → solo se actualiza `baseConfig`; sin ediciones → se re-derivan los `toggles`. Refresh silencioso (no toca `loading`, no surface errores transitorios).

## Notas de secuencia

- **T0 bloquea A** (sin NetInfo no hay (a)). Si Raf difiere la dep, se puede implementar **C (watched queries) + B (instrumentación) primero** — son independientes de NetInfo y ya aportan la reactividad determinista + la telemetría; (a) entra cuando la dep esté confirmada. La descarga vive plenamente solo con (a)+(d) juntas.
- **B (instrumentación) conviene antes de T11** — es la que da la evidencia en device de que (a) cierra RC-1.
- **Gates**: Gate 1 = N/A (cliente puro, T10). Gate 2 (security_code) = superficie mínima (sin inputs/authz nuevos). Gate 2.5 (E2E + capturas + veto visual) = sí, toca UI de config/maniobra → veto del leader del bucle config→maniobra antes de mostrar a Raf.
