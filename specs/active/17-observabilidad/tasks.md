# Tasks — 17-observabilidad (Sentry + PostHog)

> Pasos discretos en orden. `[GATED-FASE0]` = no arranca antes del build verde de Fase 0 (feature 16 E.0):
> config nativa de Sentry + build de device con los módulos nativos. El resto (wiring JS + no-op) es YA.
> El implementer marca `[x]`. Cada task cita los `R<n>` que cubre.
>
> **Estado (impl 2026-08-11):** wiring JS COMPLETO (A–D salvo lo `[GATED-FASE0]`). Ver reconciliación
> as-built en `design.md` y el mapa `R<n>→test` en `progress/impl_17-observabilidad.md`.

## A. Env + fundaciones (JS, ya)

- [x] **T1** — Crear `app/src/services/observability/env.ts`: reader estático + fallback dinámico de
  `EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` (default host
  `https://us.i.posthog.com`). Patrón de `app/src/utils/app-env.ts`. Cubre: R1.2, R5.1.
- [x] **T2** — Agregar las 3 `EXPO_PUBLIC_*` a `.env` (dev) y a EAS Environment Variables por env (valores
  reales de `external-setup.md`). Cubre: R1.2, R5.1. **AS-BUILT**: `.env.local` (dev, gitignored, valores
  reales) + `.env.example` (committed, placeholders). Las EAS Environment Variables por env quedan como
  paso de OPS del leader (no committeable desde acá).

## B. Sentry (JS, ya salvo lo marcado)

- [x] **T3** — Crear `app/src/services/observability/sentry.ts`: `initSentry()` con
  `enabled: !!dsn && !isE2E()`, `environment: getAppEnv()`, `tracesSampleRate: 0`,
  `integrations: [captureConsoleIntegration({ levels: ['error'] })]`, `beforeSend: redactEvent`,
  `beforeBreadcrumb: redactBreadcrumb`, `attachScreenshot: false`, `attachViewHierarchy: false`. Cubre:
  R1.1, R1.2, R1.3, R1.5, R7.3, R7.4, R7.5. **AS-BUILT**: platform-split (`sentry.ts` base/web no-op +
  `sentry.native.ts` real). `captureConsoleIntegration` de `@sentry/core`.
- [x] **T3b** — Crear `app/src/services/observability/redact.ts`: scrubber PURO. Denylist `email`, `phone`,
  `telefono`, `name`, `nombre`, `apellido`, `member_name`, `dni`, `cuit`, `cuil`, `password`, `token`,
  `authorization`, `opData`, contacto de `user_private`. Walk recursivo con corte de profundidad + `WeakSet`
  de ciclos; copia, no muta. Match **case-insensitive + clave normalizada** (strip `_`/`-`/espacios) (R7.4.1).
  **Fail-closed** (R7.4.2): `redactEvent`/`redactBreadcrumb` en `try/catch` → devuelven `null` si el walk
  tira (descartar, nunca enviar crudo). **Defensa de valores string** (R7.4.3): reemplazar `Bearer …`/
  `token=…`/JWT `eyJ…` por `'[redacted]'` (best-effort, regex simple). Cubre: R7.4, R7.4.1, R7.4.2, R7.4.3.
- [x] **T4** — En `app/app/_layout.tsx`: llamar `initSentry()` a nivel módulo y envolver el default export
  con `Sentry.wrap(RootLayout)` (`wrapRoot`). Cubre: R1.1, R1.4.
- [x] **T5** — Crear `app/app/_components/RootErrorBoundary.tsx`: fallback es-AR ("Algo salió mal" +
  "Reintentar", `lineHeight="$8"` matcheando `fontSize="$8"`), `componentDidCatch` → `captureExceptionSafe`
  best-effort (marcado con `mechanism: RootErrorBoundary`), reset en "Reintentar", passthrough sin error.
  Cubre: R2.2, R2.3, R2.4, R2.5.
- [x] **T6** — Montar `RootErrorBoundary` en `_layout.tsx` DENTRO de `TamaguiProvider` y por ENCIMA de
  `AuthProvider`/`PowerSyncProvider`/resto de data providers (ver design §1.2). Cubre: R2.1.
- [x] **T7** — Acción "crash de prueba" dev-only (visible solo si `getAppEnv()` ∈ {development, preview}),
  para validar el pipeline ErrorBoundary → Sentry. Cubre: R2.6. **AS-BUILT**: chip flotante dev-only (no
  `mas.tsx`, para no colisionar con la terminal de feat 16) + spike `observabilidad-spike` para la captura.
- [x] **T8** — Instrumentar `app/src/services/ble/logging.ts::logTransportEvent`: sink
  `Sentry.addBreadcrumb({ category: 'ble', data: { kind, ...event } })` en su PROPIO `try/catch`, sin tocar
  call sites, sin opData/PII. Cubre: R4.4, R4.5.
- [x] **T9** — Instrumentar `app/src/services/powersync/connector.ts::surfaceUploadRejection`: sink
  `Sentry.captureMessage('upload_rejected', { table, op, code })` en su PROPIO `try/catch`, solo esos 3
  campos (jamás `opData`), sin reportar transitorios (ese camino ya re-throwea antes). Cubre: R4.1, R4.2,
  R4.3, R4.5. **(toca el connector → dispara Gate 1).**
- [x] **T10** — Auditar que ningún `console.error` del árbol loguee PII/opData/token (para captureConsole).
  Cubre: R1.6. **AS-BUILT**: 2 sitios de producción (powersync provider), ambos loguean un objeto de error
  con prefijo benigno → backstopped por el scrubber. Resto = helpers de e2e / comentarios.
- [ ] **T11** `[GATED-FASE0]` — Config nativa de Sentry: config plugin en `app.config.ts` + metro plugin +
  `SENTRY_AUTH_TOKEN` como EAS secret; feedback por shake (R2.7, confirmar API). Cubre: R2.7, R9.1.
  **NOTA**: `@sentry/react-native` YA instalado; falta solo el config plugin + build (Fase 0).

## C. PostHog (JS, ya salvo lo marcado)

- [x] **T12** — Crear `app/src/services/observability/posthog.ts`: client singleton
  (`disabled: !key || isE2E()`, host, autocapture off) + helpers `identifyUser`, `resetIdentity`,
  `setTenantGroup`, `captureDomainEvent`. Cubre: R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R6.1, R6.2, R6.3.
  **AS-BUILT**: platform-split (`posthog.tsx` base/web passthrough + `posthog.native.tsx` real). `+trackScreen`.
- [x] **T13** — Montar `<PostHogProvider client={...} autocapture={false}>` en `_layout.tsx` encima de
  `AuthProvider` (siempre montado, árbol idéntico con/sin key). Cubre: R5.1, R5.2.
- [x] **T14** — Crear `app/src/services/observability/navigation.ts::trackNavigation(pathname)`: breadcrumb
  de Sentry (`{ pathname }`) + `client.screen(pathname)`; solo pathname, sin params. Cubre: R3.1, R3.2,
  R3.3, R3.4.
- [x] **T15** — En `RootGate` (`_layout.tsx`): `useEffect` NUEVO y separado del effect de gating, dep
  `[segments]`, que llama `trackNavigation(segments.join('/'))`. Cubre: R3.5.
- [x] **T16** — En `AuthContext.tsx`: `identifyUser(state.user.id)` al quedar `authenticated` (solo id, sin
  email); `resetIdentity()` en `SIGNED_OUT`. Cubre: R5.3, R5.6.
- [x] **T17** — En `EstablishmentContext.tsx`: `setTenantGroup(current.id, role, getAppEnv())` al pasar a
  `active` (→ `group('establishment', id)` + `register({ role, establishment_id, env })`). Cubre: R5.4,
  R5.5, R7.2, R7.3.
- [x] **T18** — Emitir `maniobra_guardada` en el guardado de la maniobra (metadata `{ type }`, no-PII).
  Cubre: R6.1, R6.4. **DECISIÓN**: solo el path de fábrica (`captureAndAdvance`); custom no se cuenta (ver design).
- [x] **T19** — Emitir `import_completado` al completar el import (metadata `{ rows }`, no-PII). Cubre:
  R6.2, R6.4.
- [x] **T20** — Emitir `invitacion_enviada` al enviar invitación (metadata `{ role }`, no-PII). Cubre:
  R6.3, R6.4.
- [ ] **T21** `[GATED-FASE0]` — Instalar deps nativas de `posthog-react-native` + peers (`expo-file-system`,
  `expo-application`, `expo-localization`; `expo-device` ya está) y asegurar que entran al APK del peón.
  Cubre: R9.4. **NOTA**: deps YA instaladas (pnpm); "entran al APK" = build de Fase 0.

## D. Privacidad (Ley 25.326)

- [x] **T22** — Verificar (revisión + tests de forma de payload) que NINGÚN breadcrumb/evento/captura lleve
  PII ni `opData`: identify solo id, breadcrumbs solo pathname/kind, upload_rejected solo table/op/code,
  eventos de dominio solo metadata. Cubre: R7.1, R4.2, R6.4, R3.3, R5.3. (`payloads.test.ts` + autorrevisión.)
- [x] **T22b** — Test de FALSIFICACIÓN del scrubber (`redact.ts`, módulo puro, sin SDK): denylist →
  `'[redacted]'`; ciclo + anidación profunda; casing/separador (R7.4.1); **fail-closed** (R7.4.2); valor
  string con `Bearer`/`token=`/`eyJ` (R7.4.3). Verificado por MUTACIÓN (identidad → 8/9 rojo). Cubre: R7.4,
  R7.4.1, R7.4.2, R7.4.3.
- [ ] **T23** — Runbook (feature 16 E.5): documentar el paso de ops del filtro del tenant "Campo de prueba
  RAFAQ" en dashboards de PostHog (group) y Sentry (inbound filter / saved search por tag). Cubre: R7.2.
  **OPS** (doc del runbook de feat 16 → lo cierra el leader; no es wiring JS).

## E. Runbook / ops

- [ ] **T24** — Runbook: regla "todo `eas update` va seguido de subir source maps (OTA no los sube solo)",
  `SENTRY_AUTH_TOKEN` como EAS secret. Cubre: R9.2. **OPS** (runbook feat 16 → leader).
- [ ] **T25** — Confirmar/documentar la alerta Sentry "issue nuevo → email" (ya creada, `external-setup.md`).
  Cubre: R9.3. **OPS** (ya creada en el wizard; documentación en runbook → leader).

## F. Verificación

- [x] **T26** — Tests unit (client en no-op / mock): forma de payload + ausencia de `opData`/PII; guardas
  `enabled`/`disabled` (env.test); identify sin email; group/register (buildTenantRegister); los 3 eventos.
  Falsificar: mutante que meta `opData`/email en un payload DEBE poner el test en rojo. Cubre: R1.2,
  R1.3, R4.1, R4.2, R4.3, R5.2, R5.3, R5.4, R5.5, R6.1–R6.4, R7.1.
- [~] **T27** — E2E: correr los ~70 specs con `EXPO_PUBLIC_ENV='e2e'` → Sentry/PostHog no-op, ErrorBoundary
  passthrough, boot idéntico, cero regresiones. Cubre: R8.1, R1.3, R5.2. **PARCIAL (impl)**: corrí boot/nav
  representativos (auth 4/4, establishments 2/2, maniobra-carga 3/3 incl. offline). La suite ~70 COMPLETA la
  corre el leader en Gate 2.5.
- [x] **T28** — Gate 2.5: captura del fallback es-AR del ErrorBoundary (vía `observabilidad-spike`) + veto
  visual (ADR-029). Cubre: R2.2, R2.6. **AS-BUILT**: `app/e2e/captures/17-observabilidad.capture.ts` →
  `__shots__/17-observabilidad/01-fallback-error-{360,412}.png` (2/2, anti-recorte de la `g` OK). El veto
  final del leader corre en Gate 2.5.
- [ ] **T29** `[GATED-FASE0]` — Verificación de DEVICE: buffer offline (airplane → crash → reabrir con señal
  → el evento llega) y feedback por shake. Cubre: R9.1, R2.7.
- [x] **T30** — Reconciliar `requirements.md`/`design.md`/`tasks.md` con el as-built (regla dura de
  `docs/specs.md`). Cubre: trazabilidad. (Reconciliación en `design.md` §"AS-BUILT"; el *qué* de R1–R9 no cambió.)

## Gates

- **Gate 1 (security_analyzer modo `spec`) — OBLIGATORIO**: T9 toca el connector de PowerSync. Foco
  privacidad (sin `opData`/PII en ningún sink). Va antes de la Puerta 1.
- **Gate 2.5 — APLICA**: T28 (ErrorBoundary fallback + crash de prueba = UI).
