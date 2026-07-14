# Contexto — 17-observabilidad (Gate 0, ADR-022)

> Refinamiento de contexto previo a la spec. Cierra las decisiones de fondo para que `spec_author` no improvise.
> Estado: **propuesto** — pendiente de aprobación humana (Raf) para pasar a `context_ready`.
> Fecha: 2026-07-12. Origen: plan aprobado (Fases 2 y 3). **Scope propuesto: Sentry + PostHog** (ver "Propuesta de corte").

## Objetivo

Dar **observabilidad runtime de cliente** para la beta con testers reales (el peón de Chascomús): enterarse de **cualquier error** de la app mientras la prueban (error tracking + alertas) y medir **cómo la usan** (analytics de producto segmentado por rol y establecimiento). Hoy hay **cero observabilidad** (sin Sentry/PostHog/ErrorBoundary; solo `console.*` ad-hoc + 2 patrones propios buenos sin PII: `ble/logging.ts` y `powersync/upload-rejections.ts`).

## Propuesta de corte (decisión de Gate 0)

El plan agrupó Sentry + PostHog + audit log en feature 17, con la nota "si la spec crece, el audit log se corta a feature 18 — se decide en Gate 0". **Recomiendo cortarlo ahora**:

- **Feature 17** = **Sentry + PostHog** (observabilidad de **cliente**, frontend runtime, Fases 2+3).
- **Feature 18** = **audit log server-side** (Fase 4) — `specs/active/18-audit-log/context.md`.

**Por qué**: el audit log es **100% server-side, testeable contra dev, sin cuenta externa y sin interacción con el build** → puede arrancar **YA, en paralelo**, mientras Sentry/PostHog esperan el build verde de Fase 0 + tus cuentas (Sentry/PostHog). Además las specs quedan cohesivas (una de cliente, una de backend) y con perfiles de gate distintos (17 = frontend + Gate 2.5 por el ErrorBoundary; 18 = Gate 1 obligatorio por schema/auth). Si preferís mantenerlo junto, lo colapso.

## Estado actual (verificado)

- **Sin Sentry/PostHog/ErrorBoundary**: un crash JS hoy = pantalla en blanco sin reporte.
- **Patrones propios reusables** (sin PII, best-effort): `logTransportEvent()` (un canal `console.info` con `try/catch`) y `recordUploadRejection(op, error)` (store in-memory de rechazos PERMANENTES de upload, guarda solo `{table, op, code, id, at}` — **NUNCA `opData`**).
- **Árbol de providers** (`app/app/_layout.tsx`): `GestureHandlerRootView → SafeAreaProvider → TamaguiProvider → AuthProvider → EstablishmentProvider → ProfileProvider → RodeoProvider → RootGate`. `RootGate` ya tiene un effect sobre `useSegments()` (punto de enganche de los breadcrumbs).
- **`EXPO_PUBLIC_ENV`** la agrega feature 16 (Sentry/PostHog la consumen como `environment`).

## Decisiones de Gate 0 (lo que se cierra)

### D1 — Sentry (error tracking + alertas)
- `@sentry/react-native` + config plugin en `app.config.ts` + metro plugin — **recién DESPUÉS del build verde de Fase 0** (no apilar variables sobre un build roto).
- `Sentry.init` a nivel módulo en `_layout.tsx`: `environment: EXPO_PUBLIC_ENV`, `enabled: !!dsn && !isE2E()` (**doble guarda**), tracing mínimo/0. `Sentry.wrap(RootLayout)`.
- **ErrorBoundary raíz** propio (fallback es-AR "Algo salió mal" + Reintentar), **dentro de `TamaguiProvider` y fuera de los providers de datos**; passthrough sin error → no cambia el boot. `enableFeedbackOnShake` para testers (verificar API exacta en la versión instalada).
- **Screen breadcrumbs**: helper único `app/src/services/observability/navigation.ts` enganchado al effect de `RootGate` que ya observa `segments` (Fase 3 lo reutiliza para PostHog).
- **Instrumentar los patrones existentes SIN refactor de call sites**: (a) `connector` rechazo PERMANENTE → `Sentry.captureMessage('upload_rejected', {table, op, code})` best-effort, **jamás `opData`** (regla de privacidad del repo); (b) `ble/logging` → sink `Sentry.addBreadcrumb`; (c) `captureConsoleIntegration({levels:['error']})` captura los `console.error` sin tocar call sites. **Los errores TRANSITORIOS de upload NO se reportan** (ruido).
- **Source maps**: `SENTRY_AUTH_TOKEN` como EAS secret (automático en builds); **regla de runbook** (feature 16 E.5): todo `eas update` va seguido de subir los source maps (OTA no los sube solo).
- **Alertas**: rule "new issue → email" (free tier).

### D2 — PostHog (product analytics)
- `posthog-react-native` + peers (`expo-file-system`, `expo-application`, `expo-localization`; `expo-device` ya está). **Deps nativas instaladas ANTES del build del peón.**
- `PostHogProvider` en `RootLayout`, **autocapture off**, `disabled: !key || isE2E()` — provider **siempre montado** (árbol idéntico con o sin key).
- **Screen tracking manual** desde el helper de D1 → `posthog.screen(pathname)`.
- **Identidad/tenant**: `identify(user.id)` (**sin email** como distinct id) en `AuthContext`; `group('establishment', id)` + `register({role, establishment_id, env})` al cambiar campo activo (el **rol es por-establecimiento**). Un solo proyecto PostHog → dashboards filtrados por `env=production`.
- **Eventos de dominio**: SOLO 3-5 al MVP (`maniobra_guardada`, `import_completado`, `invitacion_enviada`). El resto post-beta.

### D3 — Privacidad (Ley 25.326)
- **Sin PII en eventos** (analytics disociados; en B2B probablemente no requieren consentimiento, pero el **aviso breve** es buena práctica → coordina con el runbook).
- **Filtrar el tenant de prueba** "Campo de prueba RAFAQ" (feature 16 D7) en Sentry/PostHog para no ensuciar métricas de beta con las pruebas diarias de Raf.

## Edge cases (a cubrir en requirements)

- **E2E verde**: sin DSN/key + flag E2E → `Sentry.init`/PostHog **no-op**; el ErrorBoundary passthrough no cambia el boot ni los ~70 specs.
- **Buffer offline** (Sentry): modo avión → crash → reabrir con señal → el evento **llega** (clave para el peón sin señal).
- **Breadcrumbs sin PII**: el helper de navegación loguea `pathname`, no params con datos.
- **Deps nativas de PostHog**: van en el **APK del peón** (build), aunque el wiring pueda llegar por OTA.

## Fuera de scope (NO-MVP)

- **Session replay como pilar** (RN iOS aún beta).
- **Audit log server-side** → feature 18.
- Feature flags de PostHog (viene gratis, pero no es MVP; kill-switch documentado como práctica).

## Dependencias externas (cuenta de Raf)

1. **Cuenta Sentry** + DSN (proyecto RN). Código no-op sin DSN → **construible y gateable antes** de tener la cuenta; wiring del DSN por env después.
2. **Cuenta PostHog** + project key. Ídem no-op sin key.

## Dependencia de orden

- **Fase 2 (Sentry + config plugin nativo)** NO arranca antes del **build verde de Fase 0** (feature 16 E.0).

## Gate de seguridad

**Gate 1**: aplica si la instrumentación toca el connector de PowerSync / el JWT (probable). Aunque sea mayormente frontend, el foco es **privacidad**: que ningún breadcrumb/evento/captura lleve `opData` ni PII (regla dura del repo). **Gate 2.5** aplica (ErrorBoundary fallback + gesto de crash de prueba = UI).

## Preguntas para la Puerta 0 (Raf)

1. **¿Ratificás el corte del audit log a feature 18?** (te deja arrancarlo en paralelo YA, sin esperar tus cuentas ni el build).
2. **¿Los 3-5 eventos de dominio iniciales** (`maniobra_guardada`, `import_completado`, `invitacion_enviada`) te cierran, o querés otro set?
3. El resto (Sentry init/guardas, ErrorBoundary, PostHog identify/group, privacidad sin PII) sale del plan — no lo re-abro salvo pedido.
