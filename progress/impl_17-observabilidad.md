baseline_commit: 0d16152d71065e6e188e8ece90754fed972921d6

# Impl — 17-observabilidad (wiring JS)

Wiring JS de Sentry + PostHog. La parte NATIVA (config plugin, metro plugin, `SENTRY_AUTH_TOKEN`, build de
device, buffer offline, shake) queda `[GATED-FASE0]`. Verificado: typecheck limpio · 3071 client unit tests
+ 33 scripts units verdes · scrubber falsificable por mutación · boot E2E representativo verde · captura del
Gate 2.5 generada. NO corrí `node scripts/check.mjs` completo contra la DB remota (por instrucción).

## ⚠️ Flag para el leader — bookkeeping de status

`feature_list.json` tiene la feature 17 en `status: "context_ready"`, NO `in_progress`. El leader indicó
spec aprobada en Puerta 1 y los 3 specs (`requirements/design/tasks`) existen completos → procedí con el
wiring. **El leader debe bumpear el status a `in_progress`** (no toqué `feature_list.json` por instrucción).
Con los 3 specs presentes, `check.mjs` valida OK en cualquiera de los dos estados.

## Arquitectura clave (as-built, ver design.md §"Reconciliación AS-BUILT")

- **Platform-split** de `sentry` y `posthog` (técnica de `google-auth.ts`): base (`sentry.ts` / `posthog.tsx`)
  = WEB/no-op sin importar el SDK → el import nativo NUNCA entra al bundle web ni al grafo de node:test →
  **boot idéntico y no-op garantizados en los ~70 E2E**, sin depender de que los SDK soporten RNW. `.native.*`
  = SDK real (device, [GATED-FASE0] el build). El export web (`expo export -p web`) buildeó limpio.
- **Módulo puro `payloads.ts`**: centraliza cada forma outbound → el test de forma ejerce la MISMA función
  que producción (no un espejo). Los wrappers de SDK son I/O fina (fuera de node:test, como `maneuver-events.ts`).
- **Scrubber `redact.ts`**: denylist normalizado (case-insensitive + strip `_-` espacios), walk recursivo con
  corte de profundidad + `WeakSet` de ciclos (backtracking), copia no-mutante, defensa de valores string
  (JWT/Bearer/token=), **fail-closed** (throw → null).

## Mapa de trazabilidad `R<n> → archivo : test`

| R | Dónde se implementa | Verificación |
|---|---|---|
| R1.1 | `observability/sentry.native.ts::initSentry` (env/tracing0) + `app/_layout.tsx` (module-level) | typecheck + boot E2E |
| R1.2 | `observability/env.ts` + `sentry.native.ts` (`enabled: !!dsn && !isE2E()`) | `observability/env.test.ts` |
| R1.3 | `observability/sentry.ts` + `posthog.tsx` (base = no-op) | `auth.spec.ts` / `establishments.spec.ts` (boot idéntico) |
| R1.4 | `_layout.tsx::wrapRoot(RootLayout)` + `sentry.native.ts::wrapRoot` | typecheck |
| R1.5 | `sentry.native.ts` (`captureConsoleIntegration({levels:['error']})`) | typecheck (SDK) |
| R1.6 | audit T10 (connector = `console.warn`; 2 `console.error` de provider backstopped) | `redact.test.ts` (scrubber backstop) |
| R2.1 | `_layout.tsx` (RootErrorBoundary dentro de Tamagui, encima de Auth) | boot E2E |
| R2.2 | `RootErrorBoundary.tsx::RootErrorBoundaryFallback` | `17-observabilidad.capture.ts` (anti-recorte `g`) |
| R2.3 | `RootErrorBoundary.tsx::reset` | (retry re-monta children) |
| R2.4 | `RootErrorBoundary.tsx::render` passthrough | `auth`/`establishments`/`maniobra-carga` specs |
| R2.5 | `RootErrorBoundary.componentDidCatch` → `captureExceptionSafe(_, {mechanism})` | typecheck |
| R2.6 | `RootErrorBoundary.tsx::DevCrashTrigger` (dev/preview) + `observabilidad-spike` | capture |
| R2.7 | **[GATED-FASE0]** (shake) | — |
| R3.1 | `observability/navigation.ts::trackNavigation` | — |
| R3.2 | `payloads.ts::buildNavigationBreadcrumb` | `payloads.test.ts` |
| R3.3 | `navigation.ts` (segments de archivo `[id]`, sin params) + `buildNavigationBreadcrumb` | `payloads.test.ts` |
| R3.4 | `posthog(.native)::trackScreen` ← `navigation.ts` | typecheck |
| R3.5 | `_layout.tsx::RootGate` useEffect `[segments]` (separado del gating) | boot E2E (nav) |
| R4.1 | `powersync/connector.ts::surfaceUploadRejection` → `captureUploadRejected` | `payloads.test.ts` |
| R4.2 | `payloads.ts::buildUploadRejectedPayload` (solo table/op/code) | `payloads.test.ts` (sin opData) |
| R4.3 | `connector.ts` (surface solo en rechazo PERMANENTE; transitorio re-throwea antes) | code path |
| R4.4 | `ble/logging.ts::logTransportEvent` → `addBleBreadcrumb` + `payloads.buildBleBreadcrumb` | `payloads.test.ts` (sin EID) |
| R4.5 | `connector.ts` / `logging.ts` (sink en su propio try/catch, sin tocar call sites) | code review |
| R5.1 | `_layout.tsx` (PostHogProvider siempre montado) + `posthog(.native)` singleton | boot E2E |
| R5.2 | `posthog.native.ts` (`disabled: !key || isE2E()`) + base passthrough | boot E2E |
| R5.3 | `AuthContext.tsx` → `identifyUser(state.user.id)` (solo id) | code review |
| R5.4 | `EstablishmentContext.tsx` → `setTenantGroup` → `group('establishment', id)` | code review |
| R5.5 | `payloads.ts::buildTenantRegister` ({role, establishment_id, env}) | `payloads.test.ts` |
| R5.6 | `AuthContext.tsx` SIGNED_OUT → `resetIdentity()` | `auth.spec.ts` (logout) |
| R6.1 | `maniobra/carga.tsx::captureAndAdvance` (persisted → `maniobra_guardada {type}`) | `maniobra-carga.spec.ts` (no-op, no rompe) |
| R6.2 | `hooks/useImportRodeo.ts::confirm` → `import_completado {rows}` | typecheck |
| R6.3 | `app/invitar.tsx::onSubmit` → `invitacion_enviada {role}` | typecheck |
| R6.4 | call sites (solo metadata) + `payloads.ts` (nombres) | `payloads.test.ts` |
| R7.1 | props explícitas + scrubber + audit | `payloads.test.ts` + `redact.test.ts` |
| R7.2 | `EstablishmentContext` group + `buildTenantRegister.establishment_id` | `payloads.test.ts` |
| R7.3 | `sentry.native` `environment` + `buildTenantRegister.env` | `payloads.test.ts` |
| R7.4 | `observability/redact.ts` (beforeSend/beforeBreadcrumb) | `redact.test.ts` (+ mutación 8/9 rojo) |
| R7.4.1 | `redact.ts::normalizeKey` | `redact.test.ts` (memberName/member_name/MemberName) |
| R7.4.2 | `redact.ts` try/catch → null | `redact.test.ts` (getter hostil → null) |
| R7.4.3 | `redact.ts::scrubString` (JWT/Bearer/token=) | `redact.test.ts` |
| R7.5 | `sentry.native.ts` (`attachScreenshot/ViewHierarchy: false`) | typecheck |
| R8.1 | base no-op + passthrough | `auth`/`establishments`/`maniobra-carga` specs |
| R9.1 | **[GATED-FASE0]** (buffer offline, device) | — |
| R9.2 | **OPS** (runbook feat16, T24) | — |
| R9.3 | **OPS** (alerta ya creada, external-setup) | — |
| R9.4 | **[GATED-FASE0]** (APK; deps YA instaladas) | — |

## Autorrevisión adversarial (paso 8)

Intenté exfiltrar PII por cada camino outbound; todos tapados:
1. **captureConsole** (args de `console.error`) → `beforeSend`→`redactEvent` redacta claves del denylist +
   secretos string, y **fail-closed** si el walk tira. Límite conocido (documentado en design §3, M1): PII de
   texto libre no-secreto en un string (p.ej. `console.error('email x@y.com')`) NO la atrapa el scrubber
   key-based — mitigado por R1.6/T10 (audité: cero `console.error` de producción loguea PII como string; los 2
   sitios reales loguean un objeto de error con prefijo benigno).
2. **upload_rejected** → `buildUploadRejectedPayload` = SOLO {table,op,code}; test asserta AUSENCIA de `opData`
   y que keys ⊆ {table,op,code}. Backstop: el scrubber sobre el evento entero.
3. **breadcrumb BLE** → `buildBleBreadcrumb` spread del `TransportLogEvent`, que por su tipo NUNCA lleva el EID
   crudo ni datos de animal (verifiqué el union); test asserta ausencia de tag/eid/idv/opData.
4. **breadcrumb navegación** → SOLO `{pathname}`; `useSegments()` devuelve segmentos de archivo (`[id]`), sin
   valores ni query (verificado en `useSegments.d.ts`).
5. **identify/group/register** → identify SOLO `user.id`; register SOLO {role, establishment_id, env}; sin
   email/nombre/teléfono (test).
6. **eventos de dominio** → `{type}` / `{rows}` / `{role}` — nunca idv/tag/nombre/email (el email de anotación
   de invitar NO se pasa; solo el `role`).
7. **captureException del ErrorBoundary** → pasa por `beforeSend`→scrubber (mismo tapón que 1).
   `attachScreenshot/ViewHierarchy: false` (R7.5) impide subir PII visual.

Otros checks: fail-closed real (mutación: scrubber identidad → 8/9 tests en rojo, restaurado → 9/9); ciclos y
profundidad no filtran PII ni se cuelgan; guards de idempotencia en identify (`identifiedForUser`) y group
(`tenantGroupKeyRef`) para no re-emitir en cada render/token-refresh; sinks best-effort en su propio try/catch
(no rompen drenado de upload ni logging BLE). Encontré y cerré: el `DevCrashTrigger` anclado con `insets.top`
disparaba el guard `tap-target-collision-guard (F1)` → lo reposicioné por tokens Tamagui (sin `insets.top`,
tap directo en la pieza Tamagui). Fix de API: `captureConsoleIntegration` va importado de `@sentry/core`
(el SDK RN v7 no lo re-exporta) y `Sentry.wrap`/`capture` necesitaron casts por tipos no-genéricos.

## Gated Fase 0 (no arrancado, a propósito)

- Config plugin de Sentry + metro plugin + `SENTRY_AUTH_TOKEN` (EAS secret) en `app.config.ts` (T11).
- Shake feedback (R2.7) / buffer offline en device (R9.1) / crash-de-prueba en preview device (T29).
- Deps nativas en el APK (R9.4): las deps JS YA están instaladas; "entran al APK" = build de Fase 0.
- `EXPO_PUBLIC_*` en EAS Environment Variables por env (T2, ops del leader).

## Decisiones / huecos documentados

- **`maniobra_guardada` solo del path de FÁBRICA** (`captureAndAdvance`), NO de mediciones custom
  (`captureCustomAndAdvance`): el `{type}` del diseño enumera maniobras de fábrica y el funnel MVP apunta a
  ésas. Agregar `{type:'custom'}` es 1 línea si Facundo lo pide. (Ver design §5.)
- **Runbook (T23/T24/T25)**: son doc de OPS sobre el runbook de la feature 16 (E.5). No es wiring JS y tocar
  ese runbook colisiona con la terminal de feat 16 → los dejo para el leader. La alerta Sentry (R9.3) ya está
  creada (external-setup.md).
- **`.env.local`** (dev, gitignored) recibió los 3 valores reales (para que un dev device build tenga el SDK
  con datos); NO se commitea. `.env.example` (committed) recibió placeholders + la nota de `SENTRY_AUTH_TOKEN`.

## Archivos tocados (lista explícita para el commit selectivo del leader)

**Nuevos (`??`):**
- `app/src/services/observability/env.ts`
- `app/src/services/observability/redact.ts`
- `app/src/services/observability/payloads.ts`
- `app/src/services/observability/sentry.ts` + `sentry.native.ts`
- `app/src/services/observability/posthog.tsx` + `posthog.native.tsx`
- `app/src/services/observability/navigation.ts`
- `app/src/services/observability/redact.test.ts` + `payloads.test.ts` + `env.test.ts`
- `app/app/_components/RootErrorBoundary.tsx`
- `app/app/observabilidad-spike.tsx`
- `app/e2e/captures/17-observabilidad.capture.ts` (el `.capture.ts` SE COMMITEA; `__shots__/*.png` gitignored)

**Modificados (`M`):**
- `app/app/_layout.tsx` (initSentry + wrapRoot + RootErrorBoundary + PostHogProvider + nav effect + spike route)
- `app/src/contexts/AuthContext.tsx` (identify/reset)
- `app/src/contexts/EstablishmentContext.tsx` (group/register)
- `app/src/services/powersync/connector.ts` (sink upload_rejected — **Gate 1**)
- `app/src/services/ble/logging.ts` (breadcrumb BLE)
- `app/app/maniobra/carga.tsx` (maniobra_guardada)
- `app/src/hooks/useImportRodeo.ts` (import_completado)
- `app/app/invitar.tsx` (invitacion_enviada)
- `app/package.json` + `app/pnpm-lock.yaml` (deps)
- `app/.env.example` (placeholders + nota)
- `scripts/run-tests.mjs` (registra los 3 tests nuevos en la lista explícita)
- `specs/active/17-observabilidad/design.md` + `tasks.md` (reconciliación as-built + `[x]`)

**NO committear:** `app/.env.local` (gitignored), `app/e2e/captures/__shots__/**` (gitignored). El
`design/**/*.png` que re-renderizó `e2e:build` ya fue revertido (0 cambios).

## Fold MED-1 del Gate 2 (endurecimiento del scrubber, 2026-08-11)

Cambio acotado y quirúrgico — SOLO `redact.ts` + su test + `design.md §3`. No se tocó wiring, `_layout.tsx`,
`app.config.ts`, ni `feature_list.json`/otros `progress/*`.

- **`redact.ts` — denylist partido en dos grupos** (antes: un `DENYLIST_RAW` plano por igualdad):
  - `PII_KEYS_RAW` → **igualdad** normalizada (email/phone/telefono/name/nombre/apellido/member_name/dni/
    cuit/cuil/opData + props de contacto de `user_private`). `password`/`token`/`authorization` **salieron**
    de este grupo (se cubren ahora por inclusión).
  - `SECRET_ROOTS_RAW` → **inclusión** (la clave se redacta si su normalizado CONTIENE la raíz): `token`,
    `secret`, `session`, `password`, `pwd`, `api_key`(→`apikey`), `authorization`, `auth`, `credential`,
    `cookie`, `jwt`. Esto tapa `refresh_token`/`access_token`/`session_token` de la sesión Supabase, que la
    igualdad exacta perdía — y el `refresh_token` es OPACO (`v1.M…`), no lo atrapa la defensa string.
  - `isDeniedKey`: igualdad contra `PII_KEYS_NORMALIZED` **OR** inclusión de alguna `SECRET_ROOTS_NORMALIZED`.
    `normalizeKey` sin cambios (minúsculas + strip `_-` espacios; compartida por ambos grupos). `__test`
    exporta ahora `PII_KEYS_NORMALIZED`/`SECRET_ROOTS_NORMALIZED` (reemplaza `DENY_NORMALIZED`; nadie externo
    lo consumía).
- **PII por igualdad NO por inclusión, a propósito**: la inclusión redactaría `filename` (contiene `name`) y
  el resto de claves estándar de stackframe de Sentry (`function`/`module`/`abs_path`) → mataría los stack
  traces. Confirmado empíricamente: `filename`/`function`/`module`/`abs_path` quedan INTACTOS.
- **Tests nuevos** (2, ampliando `redact.test.ts` → 11/11 verde; suite obs completa 20/20):
  1. *sesión Supabase completa* en `contexts.app.state` + `extra.arguments[0]` (contenedores benignos, forma
     real de `captureConsole`): asserta `access_token` **y** `refresh_token` (el opaco, la parte que hoy
     escapaba) **y** `user.email` → `[redacted]`; `expires_in`/`user.id` conservados; ni el opaco `v1.M2x9…`
     ni el JWT ni el email sobreviven al `JSON.stringify`.
  2. *blindaje de stack traces*: un stackframe (`filename`/`function`/`module`/`abs_path`/`lineno`/`in_app`)
     queda INTACTO.
- **Falsificación (empírica, ambas direcciones)**:
  - Revertir el split a igualdad-only (bug MED-1) → test (1) **ROJO** (`refreshtoken` ≠ `token`), blindaje
    verde.
  - Poner PII por inclusión → test (2) **ROJO** (`filename` se redacta), MED-1 verde.
  - Restaurado → 11/11 y 20/20; typecheck limpio. NO corrí `check.mjs` completo ni E2E (por instrucción).
- **`design.md §3`**: AS-BUILT del scrubber actualizado con los dos grupos + la razón de PII-por-igualdad
  (stack traces) y secretos-por-inclusión (refresh_token opaco). `requirements.md` R7.4/R7.4.1 ya traían los
  dos grupos (no se tocaron).

## Pendiente del leader

- Gate 1 (security_analyzer modo `code`, foco privacidad) sobre el diff desde `baseline_commit` — toca el
  connector (R4.1). El scrubber + los builders puros + la ausencia de opData/PII están testeados.
- Gate 2.5: veto visual del fallback (`__shots__/17-observabilidad/01-fallback-error-{360,412}.png`) + correr
  la suite E2E ~70 completa.
- Bumpear `feature_list.json` a `in_progress` (ver flag arriba).
