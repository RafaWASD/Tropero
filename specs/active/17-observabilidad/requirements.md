# Requirements — 17-observabilidad (Sentry + PostHog)

> EARS estricto (ver `docs/specs.md`). Fuente de verdad primaria: `context.md` (Gate 0 aprobado) +
> `external-setup.md` (cuentas/valores reales). No se re-abre ninguna decisión de fondo.
> Alcance: observabilidad **runtime de cliente** (frontend). El audit log server-side es feature 18.

## Contexto y dependencias

- **`EXPO_PUBLIC_ENV` / `isE2E()` YA existen** (feature 16, `app/src/utils/app-env.ts`: `getAppEnv()` con
  dominio `{development,preview,production,e2e}` + `isE2E()`). Sentry/PostHog los consumen como
  `environment` y como la guarda de E2E. No se inventa nada nuevo.
- **Env vars de conexión** (client write-only, `EXPO_PUBLIC_*`, valores reales en `external-setup.md`):
  `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`.
- **Dependencia de orden (dura)**: la **config NATIVA** de Sentry (config plugin en `app.config.ts` +
  metro plugin) y el build de device que incluye los módulos nativos de `@sentry/react-native` +
  `posthog-react-native` **NO arrancan antes del build verde de Fase 0** (feature 16 E.0). El **wiring JS +
  el comportamiento no-op son implementables y testeables ya** (web / E2E). Los requirements gated por
  Fase 0 están marcados `[GATED-FASE0]`.
- **Patrones propios a instrumentar SIN refactor de call sites** (choke points únicos ya existentes):
  `app/src/services/ble/logging.ts::logTransportEvent` y
  `app/src/services/powersync/connector.ts::surfaceUploadRejection` (que ya envuelve
  `powersync/upload-rejections.ts::recordUploadRejection`, y por regla dura **NUNCA guarda `opData`**).

---

## User stories

- **US-1 — Error tracking (Sentry).** Como dev, quiero enterarme de cualquier error de la app durante la
  beta (con alertas), para no depender de que el peón lo reporte.
- **US-2 — ErrorBoundary raíz.** Como usuario, quiero que un crash de JS muestre una pantalla es-AR
  reintentable en vez de una pantalla en blanco.
- **US-3 — Rastro de navegación + screen tracking.** Como dev, quiero saber en qué pantalla estaba el
  usuario cuando falló (breadcrumbs) y medir uso por pantalla, sin filtrar datos.
- **US-4 — Instrumentar los patrones propios.** Como dev, quiero que los rechazos permanentes de sync y
  los eventos del bastón lleguen a Sentry sin tocar sus call sites ni filtrar `opData`/PII.
- **US-5 — Analytics de producto segmentado.** Como dev, quiero medir uso por rol y establecimiento sin
  guardar PII.
- **US-6 — Eventos de dominio.** Como dev, quiero 3 eventos clave del MVP para entender el funnel real.
- **US-7 — Privacidad (Ley 25.326).** Como responsable de datos, quiero que nada de PII salga a terceros y
  que el tenant de prueba sea filtrable.
- **US-8 — Boot intacto en E2E / sin cuentas.** Como dev, quiero que sin DSN/key (o en E2E) la app bootee
  idéntica y los ~70 specs sigan verdes.
- **US-9 — Buffer offline + runbook + deps nativas.** Como dev, quiero que un crash sin señal llegue igual
  al reconectar, y que las reglas de ops (source maps, alertas, deps nativas) queden documentadas.

---

## Requirements (EARS)

### R1 — Sentry: init y guardas (D1)

- **R1.1** — El sistema deberá inicializar Sentry a nivel módulo en `app/app/_layout.tsx` con
  `environment` igual a `getAppEnv()` (EXPO_PUBLIC_ENV) y `tracesSampleRate: 0` (tracing mínimo).
- **R1.2** — Mientras exista un DSN (`EXPO_PUBLIC_SENTRY_DSN`) y no sea corrida E2E, el sistema deberá
  habilitar el envío de Sentry (doble guarda `enabled: !!dsn && !isE2E()`).
- **R1.3** — Si no hay DSN o es corrida E2E, entonces el sistema deberá dejar Sentry en no-op (no
  inicializa envío) y bootear idéntico.
- **R1.4** — El sistema deberá envolver el componente raíz exportado con `Sentry.wrap(RootLayout)`.
- **R1.5** — El sistema deberá registrar la integración `captureConsoleIntegration({ levels: ['error'] })`
  para capturar los `console.error` sin modificar call sites.
- **R1.6** — El sistema no deberá loguear PII, `opData` ni tokens por `console.error` (para que
  `captureConsole` no los exfiltre).

### R2 — ErrorBoundary raíz es-AR (D1, Gate 2.5)

- **R2.1** — El sistema deberá montar un ErrorBoundary raíz DENTRO de `TamaguiProvider` y por ENCIMA de
  todos los providers de datos (Auth, PowerSync, Profile, Establishment, Rodeo).
- **R2.2** — Si un componente del árbol lanza un error de render, entonces el sistema deberá mostrar un
  fallback es-AR con el título "Algo salió mal" y un botón "Reintentar".
- **R2.3** — Cuando el usuario toca "Reintentar", el sistema deberá resetear el ErrorBoundary y re-montar
  el árbol.
- **R2.4** — Mientras no haya error, el ErrorBoundary deberá renderizar sus children sin alterar el boot
  (passthrough, sin cambiar el flujo de splash/gating).
- **R2.5** — Cuando el ErrorBoundary captura un error, el sistema deberá reportarlo a Sentry (best-effort,
  respetando el no-op de R1.3).
- **R2.6** — Donde el build sea de desarrollo o preview, el sistema deberá exponer una acción de "crash de
  prueba" (dev-only) que dispare un error para validar el pipeline ErrorBoundary → Sentry (captura de
  Gate 2.5).
- **R2.7** `[GATED-FASE0]` — Donde el build sea de testers (preview), el sistema deberá ofrecer el gesto de
  feedback por "shake" de Sentry. El shake feedback queda gated por Fase 0 y, cuando se habilite, **no**
  deberá activarse sobre datos de un tenant real sin una decisión aparte (captura de pantalla = PII visual,
  ver R7.5).

### R3 — Breadcrumbs de navegación + screen tracking (D1 + D2)

- **R3.1** — El sistema deberá proveer un helper único `app/src/services/observability/navigation.ts` que
  reciba el pathname actual como entrada.
- **R3.2** — Cuando cambia la ruta, el sistema deberá registrar un breadcrumb de navegación en Sentry con
  el pathname.
- **R3.3** — El helper de navegación deberá registrar únicamente el pathname y no los parámetros de ruta
  (sin datos ni PII).
- **R3.4** — Cuando cambia la ruta, el sistema deberá emitir `posthog.screen(pathname)` (screen tracking
  manual, desde el mismo helper de R3.1).
- **R3.5** — El helper deberá engancharse al effect de `RootGate` que ya observa `segments`, sin acoplarse
  a la lógica de gating de navegación (effect separado).

### R4 — Instrumentar patrones existentes SIN refactor de call sites (D1)

- **R4.1** — Cuando el connector registra un rechazo PERMANENTE de upload (en `surfaceUploadRejection`), el
  sistema deberá emitir `Sentry.captureMessage('upload_rejected', { table, op, code })` best-effort.
- **R4.2** — El mensaje `upload_rejected` no deberá incluir `opData` ni PII (solo `table`, `op`, `code`).
- **R4.3** — Si el error de upload es TRANSITORIO (`isTransientUploadError`/`classifyIntentUploadError` =
  transient), entonces el sistema no deberá reportarlo a Sentry (evitar ruido).
- **R4.4** — Cuando `logTransportEvent` registra un evento de transporte BLE, el sistema deberá agregar un
  breadcrumb en Sentry con el `kind` y los campos diagnósticos del evento (sin `opData` ni PII).
- **R4.5** — La instrumentación de R4.1 y R4.4 no deberá modificar los call sites existentes (se engancha
  en los choke points `surfaceUploadRejection` / `logTransportEvent`) ni romper su naturaleza best-effort
  (cada sink en su propio `try/catch`; jamás propaga ni demora el flujo del operario).

### R5 — PostHog: provider, identidad y tenant (D2)

- **R5.1** — El sistema deberá montar `PostHogProvider` en `RootLayout` con autocapture desactivado y
  `disabled: !key || isE2E()`, y el provider deberá estar **siempre montado** (árbol idéntico con o sin
  key).
- **R5.2** — Si no hay key (`EXPO_PUBLIC_POSTHOG_KEY`) o es corrida E2E, entonces PostHog deberá quedar
  no-op (no envía eventos) y el árbol de componentes deberá ser idéntico.
- **R5.3** — Cuando el usuario queda autenticado, el sistema deberá llamar `identify(user.id)` usando el
  `user.id` como distinct id, **sin email** ni ninguna propiedad con PII.
- **R5.4** — Cuando el establecimiento activo pasa a `active`, el sistema deberá llamar
  `group('establishment', establishmentId)`.
- **R5.5** — Cuando el establecimiento activo pasa a `active`, el sistema deberá registrar como super
  propiedades `register({ role, establishment_id, env })` (el `role` es el rol por-establecimiento del
  campo activo; `env` = `getAppEnv()`).
- **R5.6** — Cuando el usuario cierra sesión, el sistema deberá llamar `reset()` de PostHog para no cruzar
  identidades entre usuarios en un teléfono compartido.

### R6 — Eventos de dominio del MVP (D2)

- **R6.1** — Cuando se guarda una maniobra, el sistema deberá emitir el evento `maniobra_guardada`.
- **R6.2** — Cuando se completa una importación de rodeo, el sistema deberá emitir el evento
  `import_completado`.
- **R6.3** — Cuando se envía una invitación, el sistema deberá emitir el evento `invitacion_enviada`.
- **R6.4** — Los eventos de dominio (R6.1–R6.3) no deberán incluir PII (ni email, ni nombre, ni teléfono,
  ni datos de animal/campo); solo metadata no identificatoria (tipo de maniobra, conteo de filas, rol
  invitado).

### R7 — Privacidad (Ley 25.326) (D3)

- **R7.1** — El sistema no deberá enviar PII (email, nombre, teléfono, datos de animales/campo) en
  breadcrumbs, eventos ni capturas de Sentry/PostHog.
- **R7.2** — El sistema deberá adjuntar `establishment_id` a los eventos/issues (group de PostHog +
  disponible en Sentry) para que el tenant de prueba "Campo de prueba RAFAQ" (feature 16 D7) sea filtrable
  en los dashboards.
- **R7.3** — El sistema deberá etiquetar `env` (Sentry `environment` + PostHog super property) de modo que
  los dashboards puedan segmentar por `env=production` y excluir dev/preview/e2e de las métricas de beta.
- **R7.4** — El sistema deberá pasar todo evento y todo breadcrumb de Sentry por un scrubber
  (`beforeSend` + `beforeBreadcrumb`) que redacte **recursivamente** dos grupos de claves, reemplazando su
  valor por `'[redacted]'` ANTES de que el evento salga:
  - **(a) claves de PII** — `email`, `phone`, `telefono`, `name`, `nombre`, `apellido`, `member_name`,
    `dni`, `cuit`, `cuil`, `opData`, y las props de contacto de `user_private` — matcheadas por
    **igualdad normalizada** (R7.4.1);
  - **(b) raíces de secreto** — `token`, `secret`, `session`, `password`, `pwd`, `apikey`/`api_key`,
    `authorization`, `auth`, `credential`, `cookie`, `jwt` — matcheadas por **inclusión** (una clave se
    redacta si CONTIENE la raíz, para cubrir `refresh_token` / `access_token` / `session_token` de la sesión
    de Supabase, que la igualdad exacta se perdía — MED-1).

  De modo que ni un `console.error` con PII/secretos ni un call site **futuro** puedan exfiltrarlos. Es
  **defense-in-depth**: complementa (no reemplaza) la regla de no-PII (R7.1) y la de no loguear PII por
  `console.error` (R1.6). PostHog no necesita scrubber equivalente: su superficie es whitelist-by-construcción
  (autocapture off + solo nuestros helpers con props explícitas).
- **R7.4.1** (semántica de match, M3 + MED-1) — Ambos grupos **normalizan** la clave (minúsculas + descartar
  `_`/`-`/espacios). Las **claves de PII (grupo a)** matchean por **igualdad** del nombre normalizado
  (`member_name`/`memberName`/`MemberName` colapsan; nada de casing/separador se escapa). Las **raíces de
  secreto (grupo b)** matchean por **inclusión** (substring del nombre normalizado). El match de PII es por
  igualdad —NO por inclusión— **a propósito**: la inclusión redactaría claves estándar de los *stackframes*
  de Sentry (`filename` contiene `name`), destruyendo los stack traces; las raíces de secreto sí van por
  inclusión porque un secreto nunca es benigno.
- **R7.4.2** (fail-closed, M2) — Si el scrubber lanza una excepción al procesar un evento o breadcrumb,
  entonces el sistema deberá **DESCARTAR** ese evento/breadcrumb (`beforeSend`/`beforeBreadcrumb` devuelven
  `null`), **nunca** dejarlo pasar crudo sin redactar. El fail-safe es "no enviar", no "enviar sin filtrar".
  El descarte deberá ser best-effort y no propagar ni romper el flujo del operario.
- **R7.4.3** (defensa liviana sobre valores string, M1) — El scrubber además deberá reemplazar por
  `'[redacted]'` los patrones tipo secreto embebidos en **valores string** (JWT `eyJ…`, `Bearer …`,
  `token=…`), como defensa **best-effort** complementaria al match key-based (que por sí solo no atrapa un
  secreto dentro de un valor, p.ej. una URL de un auto-breadcrumb HTTP). Limitación conocida y atenuada
  (el JWT viaja por header, no en URL); documentada en design §3.
- **R7.5** (attachments de pixeles off, M4) — El sistema deberá fijar `attachScreenshot: false` y
  `attachViewHierarchy: false` por default en la config de Sentry. Estas capturas suben **pixeles** de
  pantalla (y jerarquía de views con texto) → bypassean el scrubber key-based (R7.4) y subirían PII visual
  sobre un tenant real; se dejan explícitamente desactivadas. Habilitarlas (o el screenshot del shake
  feedback de R2.7) es una decisión aparte, nunca por default y nunca sobre un tenant real sin acuerdo.

### R8 — Boot intacto en E2E / sin cuentas (edge cases)

- **R8.1** — Mientras sea corrida E2E, Sentry y PostHog deberán quedar no-op y el ErrorBoundary passthrough
  no deberá cambiar el boot ni romper los ~70 specs E2E existentes.

### R9 — Buffer offline, runbook y deps nativas (edge cases + D1)

- **R9.1** `[GATED-FASE0]` — Cuando ocurre un error/crash sin conexión, el sistema deberá encolar el evento
  (buffer offline de Sentry) y enviarlo al recuperar la conexión.
- **R9.2** — El sistema deberá documentar en el runbook (feature 16 E.5) que todo `eas update` va seguido
  de subir los source maps (OTA no los sube solo), con `SENTRY_AUTH_TOKEN` como EAS secret (no committeado).
- **R9.3** — El sistema deberá tener configurada en Sentry una regla de alerta "issue nuevo → email" (free
  tier). (Ya creada en el wizard, ver `external-setup.md`.)
- **R9.4** `[GATED-FASE0]` — El sistema deberá incluir las deps nativas de `posthog-react-native` (y sus
  peers) en el APK del peón (build), aunque el wiring JS pueda llegar por OTA.

---

## Trazabilidad — Casos y decisiones de `context.md` → requirements

| context.md | Cubierto por |
|---|---|
| D1 · init doble guarda + environment + tracing 0 + `Sentry.wrap` | R1.1, R1.2, R1.3, R1.4 |
| D1 · ErrorBoundary raíz es-AR dentro de Tamagui, fuera de data providers, passthrough | R2.1, R2.2, R2.3, R2.4, R2.5 |
| D1 · `enableFeedbackOnShake` (verificar API) | R2.7 |
| D1 · screen breadcrumbs, helper único enganchado al effect de RootGate | R3.1, R3.2, R3.3, R3.5 |
| D1 · instrumentar (a) connector rechazo permanente → captureMessage | R4.1, R4.2, R4.3, R4.5 |
| D1 · instrumentar (b) ble/logging → addBreadcrumb | R4.4, R4.5 |
| D1 · (c) `captureConsoleIntegration({levels:['error']})` | R1.5, R1.6 |
| D1 · source maps vía EAS secret (regla de runbook) | R9.2 |
| D1 · alertas issue nuevo → email | R9.3 |
| D2 · PostHogProvider siempre montado, autocapture off, `disabled` | R5.1, R5.2 |
| D2 · screen tracking manual `posthog.screen(pathname)` | R3.4 |
| D2 · `identify(user.id)` sin email | R5.3 |
| D2 · `group('establishment', id)` + `register({role, establishment_id, env})` | R5.4, R5.5 |
| D2 · un solo proyecto → dashboards por `env=production` | R7.3 |
| D2 · 3-5 eventos de dominio (`maniobra_guardada`/`import_completado`/`invitacion_enviada`) | R6.1, R6.2, R6.3, R6.4 |
| D3 · sin PII en eventos | R7.1, R4.2, R6.4, R1.6 |
| D3 · sin PII — defense-in-depth (scrubber de Sentry, fail-closed, defensa de valores) | R7.4, R7.4.1, R7.4.2, R7.4.3 |
| D3 · sin PII visual (attachments de pixeles off) | R7.5, R2.7 |
| D3 · filtrar tenant de prueba "Campo de prueba RAFAQ" | R7.2 |
| Edge · E2E no-op + ErrorBoundary passthrough | R1.3, R5.2, R8.1 |
| Edge · buffer offline de Sentry | R9.1 |
| Edge · breadcrumbs sin params/PII | R3.3 |
| Edge · deps nativas de PostHog en el APK | R9.4 |

---

## Gates de seguridad (declarados)

- **Gate 1 (security_analyzer modo `spec`) — OBLIGATORIO para esta spec.** Condición cumplida: la
  instrumentación **toca el connector de PowerSync** (R4.1 agrega un sink de Sentry en
  `connector.ts::surfaceUploadRejection`). **Foco = privacidad**: verificar que ningún breadcrumb, evento
  ni captura lleve `opData` ni PII — R4.2, R4.4, R6.4, R7.1, R1.6, R3.3, R5.3 — más el **scrubber
  defense-in-depth** (R7.4) como cierre de la superficie de `captureConsole`. No toca el JWT
  (`fetchCredentials` queda intacto), pero el connector sí → Gate 1 aplica.
- **Gate 2.5 — APLICA.** Hay UI: el fallback es-AR del ErrorBoundary (R2.2) + el gesto de crash de prueba
  (R2.6). Requiere captura + veto visual (ADR-029).

## Verificación (nota honesta)

La mayoría de los R son testeables por unit/E2E con el cliente en no-op (mock del client de Sentry/PostHog:
que la forma del payload sea la esperada y que NO contenga `opData`/PII). Tres requisitos se verifican por
otra vía y quedan marcados: **R9.1** (buffer offline) y **R2.7** (shake) son **verificación de DEVICE**
(gated Fase 0); **R9.2/R9.3** son **reglas de ops/runbook** (verificación por inspección del runbook y del
dashboard de Sentry, no test automatizado).

**R7.4 (scrubber) — test de falsificación obligatorio**: el scrubber (`redact.ts`) es un módulo PURO,
unit-testeable sin el SDK. El test construye un event/breadcrumb con claves del denylist (p.ej.
`{ contexts: { user: { email: 'x@y.com' } }, extra: { opData: { peso: 385 } } }`) y asserta que la salida
las trae en `'[redacted]'`. El test **debe fallar si se quita el scrubber** (no pasa con el bug puesto) — el
mutante que borra `beforeSend`/`beforeBreadcrumb` o vacía el denylist tiene que ponerlo en rojo. Casos extra
a cubrir: variantes de casing/separador (`memberName`/`member_name`/`MemberName`, R7.4.1); **fail-closed**
(un scrubber que tira → `beforeSend` devuelve `null`, R7.4.2 — asertar que NO sale crudo); y un valor string
con `Bearer <jwt>`/`token=…`/`eyJ…` que sale redactado (R7.4.3).
