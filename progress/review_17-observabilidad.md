# Review — 17-observabilidad (wiring JS) · reviewer

**Veredicto: APPROVED** (alcance: wiring JS. Lo [GATED-FASE0] + OPS/runbook + Gate 2.5 full E2E quedan para el leader / Fase 0, documentados y fuera del alcance de esta revisión.)

Fecha: 2026-08-11. Baseline impl: 0d16152d.

## Verificación ejecutada (no deducida)

- typecheck (pnpm typecheck = tsc --noEmit): exit 0, limpio.
- Suite unit de observabilidad (redact.test.ts + payloads.test.ts + env.test.ts, registrada en scripts/run-tests.mjs L130): 18/18 verde.
- Falsificación del scrubber (copié redact.ts+test a scratchpad, mutación, NO toqué el real):
  - identidad (redactValue passthrough) -> 8/9 rojo.
  - denylist vacío -> 5/9 rojo.
  - fail-open (catch devuelve crudo) -> 1/9 rojo, y es EXACTAMENTE el test de R7.4.2 (fail-closed).
  - scrubString passthrough -> 1/9 rojo, y es EXACTAMENTE el test de R7.4.3 (defensa de valores).
  Cada requisito crítico tiene su test falsificante dedicado. NO pasa con el bug puesto.
- E2E representativo (contra el dist existente 12:55, que ya incluye el wiring; strings en el bundle: observabilidad-spike, upload_rejected, maniobra_guardada, RootErrorBoundaryFallback, copy del fallback; sin rebuildear): auth 4/4 + establishments 2/2 + maniobra-carga 3/3 = 9/9 verde (incluye maniobra-carga offline). Confirma R8.1 (boot no-op idéntico con el wiring montado).

## Completitud del wiring (oráculo anti-imports-muertos) — verificado leyendo _layout.tsx

- initSentry() a nivel módulo: _layout.tsx:90.
- wrapRoot(RootLayout) en el default export: _layout.tsx:747.
- RootErrorBoundary DENTRO de TamaguiProvider (684) y por ENCIMA de PostHogProvider/AuthProvider: _layout.tsx:689 (coincide con design 1.2).
- PostHogProvider SIEMPRE montado, encima de AuthProvider: _layout.tsx:692.
- useEffect de navegación NUEVO y SEPARADO del effect de gating: _layout.tsx:294-296 (dep [segments]); el de gating vive en 318-447. No lo pisó.
- identifyUser/resetIdentity en AuthContext: identify AuthContext.tsx:152 (solo state.user.id, guard por-usuario), reset AuthContext.tsx:131 (SIGNED_OUT).
- setTenantGroup (group+register) en EstablishmentContext.tsx:582 (status active, guard por id:role).
- Sink captureUploadRejected DENTRO de surfaceUploadRejection (connector.ts:222, su propio try/catch).
- Sink addBleBreadcrumb DENTRO de logTransportEvent (logging.ts:89, su propio try/catch).
- Sin imports colgados: typecheck exit 0 + los 3 call sites de dominio importan y usan captureDomainEvent/DOMAIN_EVENTS (carga.tsx:641, useImportRodeo.ts:485, invitar.tsx:119).

## No-op / platform-split (foco 2)

- sentry.ts (base/web) NO importa @sentry/react-native; sentry.native.ts sí. Idem posthog.tsx (passthrough) vs posthog.native.tsx (client singleton + lib provider). El import nativo queda fuera del bundle web (el E2E bootea 9/9 sobre el build web).
- Doble guarda Sentry enabled:!!dsn && !isE2E() (sentry.native.ts:31) + PostHog disabled:!key || isE2E() (posthog.native.tsx:20). env.test.ts cubre presente/ausente.
- ErrorBoundary passthrough sin error: 9/9 specs booteando.

## Scrubber (foco 3)

- redactValue es un walk recursivo genérico sobre Object.keys -> cubre contexts/extra/tags/breadcrumbs[].data (los 4 explícitamente testeados) y request (por construcción key-agnóstica).
- denylist normalizado (case-insensitive + strip _- espacios), copia no-mutante, corte de profundidad, ciclos por WeakSet, fail-closed (throw -> null), defensa de valores Bearer/JWT/token=. Todo testeado y falsificado por mutación.

## Sin PII en payloads (foco 4)

- upload_rejected = SOLO {table,op,code} como tags; payloads.test.ts asserta ausencia de opData y keys en {code,op,table}.
- breadcrumb BLE: buildBleBreadcrumb spread del TransportLogEvent (union sin EID/caravana/nombre; verifiqué el union en logging.ts:15-41, solo campos diagnósticos). Test asserta ausencia de tag/eid/idv/opData.
- eventos de dominio: {type}/{rows}/{role}; invitar NO pasa el email (solo role).
- identify(user.id) solo id; register solo {role, establishment_id, env}.
- Audit R1.6 (independiente): 0 console.error nuevos en el código de la feature (los 2 matches en observability/ y el 1 en RootErrorBoundary son COMENTARIOS). Backstop del scrubber vigente.

## UI del ErrorBoundary (foco 5)

- Fallback es-AR: "Algo salió mal" + copy + botón "Reintentar" (RootErrorBoundary.tsx:41-66).
- Anti-recorte: lineHeight=$8 matcheando fontSize=$8 en el título (la g de "Algo"); el capture 17-observabilidad.capture.ts lo verifica por bounding-box.
- "Reintentar" -> reset() (setState hasError:false) -> re-monta children (R2.3).
- crash-test DevCrashTrigger gated a development/preview (isDevCrashEnabled), oculto en producción y en e2e. Spike observabilidad-spike como vehículo de captura.
- Botón = DS Button (variant primary, fullWidth, minHeight:$touchMin=56px, estándar app-wide).

## Gated correcto (foco 6)

- app.config.ts / metro.config INTACTOS (git status limpio). 0 matches de config plugin de sentry.
- SENTRY_AUTH_TOKEN: solo en .env.example como NOTA (dice explícitamente que NO va ahí, es EAS secret [GATED-FASE0]). No hay token real committeado.
- .env.local gitignoreado y no-tracked; .env.example solo placeholders.
- No se corrió eas build.

## Trazabilidad R<n> <-> test

- R1.1 -> _layout.tsx:90 module-level + boot E2E (9/9) + env.test. OK
- R1.2 -> env.test.ts (dsn presente/ausente). OK
- R1.3 -> auth/establishments/maniobra-carga specs (boot idéntico). OK
- R1.4 -> _layout.tsx:747 wrapRoot + typecheck. OK
- R1.5 -> sentry.native.ts:37 captureConsoleIntegration + typecheck. OK
- R1.6 -> audit (0 console.error nuevos) + redact.test.ts backstop. OK
- R2.1 -> _layout.tsx:689/692/693 + boot E2E. OK
- R2.2 -> 17-observabilidad.capture.ts (fallback + anti-recorte g). OK
- R2.3 -> RootErrorBoundary.reset (retry re-monta). OK
- R2.4 -> 9/9 boot E2E specs. OK
- R2.5 -> captureExceptionSafe(_,{mechanism}) + typecheck. OK
- R2.6 -> DevCrashTrigger gated + spike capture. OK
- R2.7 -> [GATED-FASE0] shake/device. DIFERIDO
- R3.1 -> navigation.ts::trackNavigation (delega ambos). OK
- R3.2 -> payloads.test.ts buildNavigationBreadcrumb. OK
- R3.3 -> payloads.test.ts (solo pathname). OK
- R3.4 -> trackScreen + typecheck. OK
- R3.5 -> _layout.tsx:294-296 (effect separado) + boot E2E nav. OK
- R4.1 -> payloads.test.ts + connector.ts:222. OK
- R4.2 -> payloads.test.ts (sin opData). OK
- R4.3 -> connector.ts code path (transitorio re-throwea antes). OK
- R4.4 -> payloads.test.ts (sin EID) + logging.ts:89. OK
- R4.5 -> connector.ts/logging.ts (try/catch propio, sin tocar call sites). OK
- R5.1 -> _layout.tsx:692 + boot E2E. OK
- R5.2 -> boot E2E + posthog.native.ts:20 disabled. OK
- R5.3 -> AuthContext.tsx:152 (solo id). OK
- R5.4 -> EstablishmentContext.tsx:582 group. OK
- R5.5 -> payloads.test.ts buildTenantRegister. OK
- R5.6 -> AuthContext.tsx:131 + auth.spec logout (test 4). OK
- R6.1 -> carga.tsx:641 (persisted only) + maniobra-carga specs. OK
- R6.2 -> useImportRodeo.ts:485 {rows} + typecheck. OK
- R6.3 -> invitar.tsx:119 {role} + typecheck. OK
- R6.4 -> payloads.test.ts + call sites (metadata). OK
- R7.1 -> payloads.test.ts + redact.test.ts. OK
- R7.2 -> payloads.test.ts (establishment_id) + group. OK
- R7.3 -> sentry.native env + payloads.test.ts (env). OK
- R7.4 -> redact.test.ts + mutación 8/9 (verificado por mí). OK
- R7.4.1 -> redact.test.ts casing/separator. OK
- R7.4.2 -> redact.test.ts fail-closed (mutación fail-open -> rojo). OK
- R7.4.3 -> redact.test.ts Bearer/JWT/token= (mutación passthrough -> rojo). OK
- R7.5 -> sentry.native.ts attach*false + typecheck. OK
- R8.1 -> auth/establishments/maniobra-carga (9/9). OK
- R9.1 -> [GATED-FASE0] buffer offline device. DIFERIDO
- R9.2 -> OPS runbook (T24, leader). DIFERIDO/doc
- R9.3 -> OPS alerta ya creada (external-setup). DIFERIDO/doc
- R9.4 -> [GATED-FASE0] APK (deps instaladas). DIFERIDO

Todos los R no-gated / no-OPS tienen >=1 test concreto. R2.7/R9.1/R9.4 marcados [GATED-FASE0] en requirements; R9.2/R9.3 declarados como verificación por inspección (ops/runbook) en la nota honesta del requirements. No hay R sin cobertura dentro del alcance del wiring JS.

## Tasks completas: sí (dentro del alcance) — todas las [ ] con justificación documentada

- [x] T1-T10, T12-T20, T22, T22b, T26, T28, T30.
- [ ] T11, T21, T29 -> [GATED-FASE0] (config nativa / APK / device). Justificado en design 0.
- [ ] T23, T24, T25 -> OPS runbook de feature 16 (lo cierra el leader). Justificado en tasks + impl.
- [~] T27 -> E2E full ~70 = Gate 2.5 (leader). El representativo lo corrí yo: 9/9. Justificado.

## Exactitud de specs (código -> spec)

design.md tiene la sección Reconciliación AS-BUILT que documenta platform-split, payloads.ts, captureConsoleIntegration de @sentry/core, captureMessage con tags, captureException con mechanism, crash-test como chip flotante + spike, maniobra_guardada solo path fábrica, deps instaladas. Contrasté cada punto contra el código: coincide. Los EARS de requirements.md siguen exactos (el qué no cambió). tasks.md marcado con notas AS-BUILT. No hay specs viejas mintiendo.

## CHECKPOINTS

- C3 (arquitectura): [x] módulos en services/observability/ (capa services), sin deps injustificadas, sin console.error suelto nuevo, sin hardcode de establishment_id.
- C4 (verificación): [x] test por módulo con lógica, runner >0 verde, scrubber falsificado por mutación.
- C6 (SDD): [x] 3 specs, EARS estricto, cada R con test (o gated/ops documentado), reconciliación as-built.
- C7 (multi-tenant): [x] N/A — no crea tablas/RLS; establishment_id como property no-PII.
- C8 (offline-first): [x] sinks best-effort no bloqueantes; buffer offline GATED-FASE0; E2E offline verde.
- C9 (E2E + visual): [~] capture file presente, __shots__ gitignored; Gate 2.5 full (veto visual + suite ~70) lo cierra el leader.
- C1/C2/C5: [ ] fuera del alcance de esta revisión de wiring (estado de sesión/harness = leader).

## Checklist RAFAQ-específico

- A (RLS/multi-tenancy): N/A — no crea/modifica tablas ni policies; solo establishment_id como property/group (no-PII, derivado del contexto scopeado por RLS, nunca hardcodeado).
- B (offline-first): parcial. [x] sinks best-effort en try/catch propio, no bloquean; [x] no hace requests síncronos a Supabase desde pantalla (fire-and-forget); [x] E2E offline (maniobra-carga test 9) verde con el wiring montado. Buffer offline real = [GATED-FASE0] device.
- C (BLE): solo el ítem de logs. [x] los logs BLE (breadcrumb sink) NO bloquean el flujo del operario (try/catch propio, best-effort, R4.5). Resto de C (desconexión/fallback/correlación) no lo toca -> N/A.
- D (UI de campo): [x] botón "Reintentar" = DS Button minHeight:$touchMin (56px, estándar app-wide); [x] título $8 / copy $5; [x] una decisión por pantalla; [~] loading N/A (pantalla de error). Veto visual final = Gate 2.5 del leader.
- E (Edge Functions): N/A — no toca Edge Functions.

## Avisos (no bloquean)

- Churn espurio de design PNG: mi corrida de maniobra-carga.spec.ts re-renderizó 4 PNGs de OTRA feature (design/maniobra-carga/{carga-pesaje,carga-tacto-tamano,carga-tacto,resumen}.png). NO los toqué. El leader debe revertir design/ antes de commitear (byte-diffs de mi verificación, no de la feature 17).
- NO corrí node scripts/check.mjs completo (instrucción: frontend, evita flake de rate-limit) ni el E2E full ~70 (Gate 2.5 del leader).

## Cambios requeridos

Ninguno para el wiring JS. Pendiente del leader (fuera de esta revisión): cerrar OPS/runbook (T23-T25), Gate 2.5 full (E2E ~70 + veto visual), y lo [GATED-FASE0] (T11/T21/T29) cuando Fase 0 esté verde.
