# Design — 17-observabilidad (Sentry + PostHog)

> Cómo se construye el wiring de observabilidad de cliente. Fuente de verdad: `context.md` (Gate 0) +
> `external-setup.md` (valores reales). No re-decide fondo; documenta la elaboración técnica.

## 0. Dependencia de orden (dura) — qué se puede hacer YA y qué está gated

| Bloque | ¿Implementable ya? | Gate |
|---|---|---|
| Wiring JS (Sentry.init con guardas, ErrorBoundary, helper de navegación, instrumentación de choke points, PostHogProvider, identify/group/register, eventos de dominio) | **Sí** — corre en web / no-op / E2E | — |
| Comportamiento no-op (sin DSN/key o en E2E) + ~70 specs verdes | **Sí** | — |
| **Config NATIVA de Sentry**: config plugin en `app.config.ts` + metro plugin (source maps, native crash handling) | **No** | `[GATED-FASE0]` — feature 16 E.0 build verde |
| **Build de device** con módulos nativos de `@sentry/react-native` + `posthog-react-native` + peers | **No** | `[GATED-FASE0]` |
| Verificación de buffer offline (R9.1) y shake feedback (R2.7) | **No** (device) | `[GATED-FASE0]` |

Razón: no apilar variables nativas sobre un build roto (context §"Dependencia de orden"). El JS se escribe
y testea ahora; la parte nativa + el build se enchufan cuando Fase 0 (feature 16 E.0) esté verde.

## 1. Árbol de providers resultante

### 1.1 Reconciliación con el árbol REAL (discrepancia con `context.md`)

`context.md` §"Estado actual" describe el árbol como
`GestureHandlerRootView → SafeAreaProvider → TamaguiProvider → AuthProvider → EstablishmentProvider →
ProfileProvider → RodeoProvider → RootGate`. **El árbol real de `app/app/_layout.tsx` (verificado) es más
profundo** e incluye providers que el context omitió:

```
GestureHandlerRootView
└─ SafeAreaProvider (initialMetrics)
   └─ DiagnosticErrorBoundary        ← TEMPORAL (bring-up nativo), FUERA de Tamagui; no se toca acá
      └─ TamaguiProvider
         └─ AuthProvider
            └─ PowerSyncProvider      ← es un DATA PROVIDER (lo omitía el context)
               └─ ProfileProvider     ← Profile ENVUELVE a Establishment (orden invertido vs context)
                  └─ EstablishmentProvider
                     └─ RodeoProvider
                        └─ BleStickListenerProvider   ← omitido por el context
                           └─ BleHost (RootGate + FindOrCreateOverlay + StickStatusIndicator)
```

Esto **importa** para la ubicación del ErrorBoundary y del PostHogProvider (R2.1, R5.1): "fuera de los
providers de datos" = **por encima de `AuthProvider`/`PowerSyncProvider`**, no solo por encima de
`EstablishmentProvider`. Se diseña contra el árbol real. (Discrepancia menor, marcada para Raf en el
resumen; no cambia ninguna decisión de fondo.)

### 1.2 Árbol objetivo (dos providers nuevos, additive)

```
GestureHandlerRootView
└─ SafeAreaProvider
   └─ DiagnosticErrorBoundary                 (temporal, intacto)
      └─ TamaguiProvider
         └─ RootErrorBoundary  ← NUEVO (R2.1): dentro de Tamagui, encima de TODO provider de datos.
            └─ PostHogProvider  ← NUEVO (R5.1): siempre montado; client singleton; autocapture off; disabled guard.
               └─ AuthProvider
                  └─ PowerSyncProvider
                     └─ ProfileProvider
                        └─ EstablishmentProvider
                           └─ RodeoProvider
                              └─ BleStickListenerProvider
                                 └─ BleHost (RootGate …)
```

- `RootErrorBoundary` va **dentro de Tamagui** para que el fallback es-AR use componentes del design system
  (R2.2), y **encima de Auth/PowerSync/…** para capturar un throw de render de cualquier data provider
  (R2.1). El `DiagnosticErrorBoundary` preexistente (fuera de Tamagui, sin estilos DS) se conserva como
  está — su limpieza es parte del cierre de bring-up nativo, **fuera de scope de esta feature**.
- `PostHogProvider` envuelve a `AuthProvider`/`EstablishmentProvider` para que `identify`/`group`/`register`
  (que viven en esos contexts) tengan el client disponible. Se pasa un **client singleton** (§4) en vez de
  `apiKey`, para desacoplar identify de servicios no-React (eventos de dominio) y evitar dos clients.
- **Sentry NO necesita provider**: `Sentry.init()` es a nivel módulo (top de `_layout.tsx`, R1.1) y
  `Sentry.wrap(RootLayout)` envuelve el default export (R1.4). El `RootErrorBoundary` reporta a Sentry por
  import directo del módulo (no por context).

## 2. Config de env

### 2.1 Env vars (valores reales — `external-setup.md`)

Client write-only, `EXPO_PUBLIC_*` (viajan embebidas; no son secretos tipo password). Van a EAS
Environment Variables por env (feature 16 D2) y a `.env`/`.env.local` para dev:

```
EXPO_PUBLIC_SENTRY_DSN=https://5dc0605a7d38dcf76e0c3b6a1bc8dcf1@o4511892683489280.ingest.us.sentry.io/4511892742406144
EXPO_PUBLIC_POSTHOG_KEY=phc_Aph5ynzVU2cnrhqYDxSXVfYf23p5aaCakHcJTaobHsRG
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

- Sentry: org `mitropero` (US), proyecto `react-native`. PostHog: project `552831`, US Cloud.
- **`SENTRY_AUTH_TOKEN`** (subir source maps) es un **secreto real** → EAS secret, NO committeado, solo al
  momento del build/`eas update` (R9.2). Diferido hasta la parte nativa (Fase 0).

### 2.2 Reader de env de observabilidad

Nuevo módulo `app/src/services/observability/env.ts` (mismo patrón que `app/src/utils/app-env.ts`):
lecturas **ESTÁTICAS literales** primero (`process.env.EXPO_PUBLIC_SENTRY_DSN` — inlineables por babel en
build web) con **fallback dinámico** (key variable, no inlineable — dev server + shim E2E). Expone:

```ts
export function getObservabilityEnv(): {
  sentryDsn: string | undefined;
  posthogKey: string | undefined;
  posthogHost: string; // default 'https://us.i.posthog.com' si falta
};
```

`environment` (Sentry) y la super property `env` (PostHog) salen de `getAppEnv()` (feature 16), no de este
reader.

## 3. Sentry — wiring JS

Todo en/desde `app/app/_layout.tsx` + módulos nuevos bajo `app/src/services/observability/`.

- **`sentry.ts`** (nuevo): `initSentry()` llamado a nivel módulo en `_layout.tsx`:
  ```ts
  Sentry.init({
    dsn: sentryDsn,
    enabled: !!sentryDsn && !isE2E(),   // R1.2 / R1.3 (doble guarda)
    environment: getAppEnv(),            // R1.1 / R7.3
    tracesSampleRate: 0,                 // R1.1 (tracing mínimo)
    integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })], // R1.5
    beforeSend: redactEvent,             // R7.4 (scrubber defense-in-depth, fail-closed)
    beforeBreadcrumb: redactBreadcrumb,  // R7.4
    attachScreenshot: false,             // R7.5 (M4 — no subir pixeles = no PII visual)
    attachViewHierarchy: false,          // R7.5 (M4)
    // enableFeedbackOnShake / feedback widget → R2.7, API a confirmar en la versión instalada [GATED-FASE0].
    // Cuando se habilite: NO sobre datos de un tenant real sin decisión aparte (el screenshot = PII visual).
  });
  ```
- **Scrubber de PII (R7.4)** — módulo PURO `app/src/services/observability/redact.ts`, unit-testeable sin
  el SDK. Denylist partido en **DOS grupos** con semántica de match distinta (MED-1 del Gate 2):
  - **(a) claves de PII → IGUALDAD normalizada** (`PII_KEYS_RAW`): `email`, `phone`, `telefono`, `name`,
    `nombre`, `apellido`, `member_name`, `dni`, `cuit`, `cuil`, `opData`, + props de contacto de
    `user_private`.
  - **(b) raíces de secreto → INCLUSIÓN** (`SECRET_ROOTS_RAW`, la clave se redacta si su nombre normalizado
    CONTIENE la raíz): `token`, `secret`, `session`, `password`, `pwd`, `api_key` (→`apikey`),
    `authorization`, `auth`, `credential`, `cookie`, `jwt`.
  Un walk **recursivo** (con **corte de profundidad** y **manejo de ciclos** vía
  `WeakSet` de visitados) reemplaza el valor de cualquier clave que caiga en (a) o (b) por `'[redacted]'`,
  devolviendo una **copia** (no muta el original). `redactEvent(event)` se aplica en `beforeSend` y
  `redactBreadcrumb(bc)` en `beforeBreadcrumb`, así **todo** lo que sale de Sentry pasa por el filtro:
  cubre los ARGUMENTOS que `captureConsole` sube de cualquier `console.error` presente **o futuro**. Es la
  guarda escrita sobre la AUSENCIA (regla de clase del repo): el código nuevo nace tapado, sin depender de
  auditar call sites. Complementa —no reemplaza— R1.6/R7.1. **PostHog NO lleva scrubber**: su superficie es
  whitelist-by-construction (autocapture off + solo props explícitas de nuestros helpers), así que no hay
  camino por el que se cuele una clave arbitraria.
  - **Semántica de match (R7.4.1, M3 + MED-1)**: ambos grupos **normalizan** la clave (minúsculas + strip de
    `_`/`-`/espacios) → `member_name`/`memberName`/`MemberName` colapsan a `membername` y
    `refresh_token`/`api_key` a `refreshtoken`/`apikey`; ninguna variante de casing/separador se escapa.
    - Las **claves de PII (a)** matchean por **IGUALDAD** del normalizado. Es igualdad **a propósito, no por
      comodidad**: si PII fuera por inclusión, `filename` (contiene `name`), y las demás claves estándar de
      *stackframe* de Sentry (`function`, `module`, `abs_path`), se redactarían y **matarían los stack
      traces** — el diagnóstico de todo crash. Un `name` benigno redactado es un falso positivo tolerable;
      cegar los stack traces no lo es. Verificado por el test de blindaje (`filename`/`function`/`module`/
      `abs_path` quedan intactos).
    - Las **raíces de secreto (b)** matchean por **INCLUSIÓN** (substring del normalizado). Un secreto nunca
      es benigno, así que la inclusión es segura y necesaria: cubre `refresh_token`/`access_token`/
      `session_token` de la sesión de Supabase, que la igualdad exacta contra `token` **perdía** (MED-1). El
      `refresh_token` de Supabase es además un valor **OPACO** (`v1.M…`, no JWT) → no lo atrapa ni la
      defensa de valores string (R7.4.3); el key-match por inclusión es el único que lo tapa. Verificado por
      el test de falsificación de sesión Supabase completa (`access_token` **y** `refresh_token` **y**
      `email` → `[redacted]`), que se pone rojo si se revierte el split a igualdad.
  - **Fail-closed (R7.4.2, M2)**: `redactEvent`/`redactBreadcrumb` envuelven el walk en `try/catch`; si el
    walk **tira**, devuelven `null` → Sentry **DESCARTA** el evento/breadcrumb. El fail-safe es "no enviar",
    jamás "enviar crudo". El descarte es best-effort (no propaga; no rompe el flujo del operario).
  - **Defensa liviana sobre valores string (R7.4.3, M1)**: además del match key-based, el walk pasa cada
    valor string por un reemplazo de patrones tipo secreto (`Bearer\s+\S+`, `token=\S+`, JWT `eyJ[\w-]+\.`)
    → `'[redacted]'`. Es **best-effort** y con regex simple, no un parser.
  - **Limitación conocida (M1)**: el scrubber es **key-based**; la defensa de valores (R7.4.3) es un parche
    liviano, no atrapa cualquier secreto embebido en un string arbitrario. Atenuado en la práctica: el JWT
    de la sesión viaja por **header**, no en URL, y no hay integración de tracing HTTP activa
    (`tracesSampleRate: 0`) que genere auto-breadcrumbs de red con la URL cruda. Se acepta la limitación y
    se documenta acá.
  Buffer offline (R9.1): es el transporte por defecto de `@sentry/react-native` (persistencia a disco +
  reintento al reconectar). No requiere config extra; se **verifica en device** (airplane mode → crash →
  reabrir con señal).
- **`Sentry.wrap(RootLayout)`** en el default export (R1.4).
- **`RootErrorBoundary`** (nuevo, `app/app/_components/RootErrorBoundary.tsx` o
  `app/src/features/observability/RootErrorBoundary.tsx`): class component React; `componentDidCatch` →
  `Sentry.captureException(error)` best-effort (R2.5); fallback es-AR con Tamagui: título "Algo salió mal"
  (con `lineHeight` matching por descendentes — regla del repo), texto de reintento, botón "Reintentar" que
  resetea el state (R2.2/R2.3). Passthrough sin error (R2.4). Botón/acción **crash de prueba** dev-only
  (R2.6) — visible solo si `getAppEnv()` ∈ {development, preview}; ubicación tentativa: fila oculta en "Más".
- **`captureConsoleIntegration({ levels: ['error'] })`** (R1.5): captura `console.error` app-wide sin tocar
  call sites. **Privacidad (R1.6 + R7.4)**: el connector loguea con `console.warn`/`console.log` (no
  `error`) y jamás el token/opData; la auditoría de Gate 1 mira los `console.error` de hoy, y el **scrubber
  `beforeSend`/`beforeBreadcrumb` (R7.4)** tapa los de mañana.
- **Nota — doble-reporte console/ErrorBoundary** `[GATED-FASE0 la verificación]`: React loguea los errores
  de render atrapados vía `console.error` (además del `componentDidCatch` del `RootErrorBoundary`, que hace
  `captureException`). Con `captureConsole` a `'error'` un crash de render puede generar **dos** señales
  hacia Sentry. **El `RootErrorBoundary` es la fuente de verdad de los crashes de render**; aceptamos la
  posible duplicación menor (Sentry agrupa por fingerprint). Si en la versión instalada es trivial, se
  marca el `captureException` del boundary con un `mechanism`/tag (p.ej. `mechanism: 'RootErrorBoundary'`)
  para distinguirlo del eco de `captureConsole`. No se cierra duro acá: depende de la versión y se **verifica
  en device** al enchufar la parte nativa (Fase 0).

## 4. PostHog — wiring JS

- **`posthog.ts`** (nuevo): crea **un** client singleton:
  ```ts
  const client = new PostHog(posthogKey ?? '', {
    host: posthogHost,
    disabled: !posthogKey || isE2E(),  // R5.1 / R5.2
    // autocapture se apaga en el Provider (abajo)
  });
  ```
  Se pasa a `<PostHogProvider client={client} autocapture={false}>` (R5.1, siempre montado). Cuando
  `disabled`, todas las llamadas son no-op (R5.2/R8.1). Expone helpers que operan sobre ese singleton:
  `identifyUser(id)`, `resetIdentity()`, `setTenantGroup(id, role, env)`, `captureDomainEvent(name, props)`.
- **`navigation.ts`** (nuevo, helper único de R3.1): `trackNavigation(pathname)` que hace **ambas** cosas:
  `Sentry.addBreadcrumb({ category: 'navigation', data: { pathname } })` (R3.2) y `client.screen(pathname)`
  (R3.4). Recibe **solo el pathname** derivado de `segments.join('/')` — **nunca params** (R3.3).
- **Enganche en `RootGate`** (R3.5): un `useEffect` NUEVO y **separado** del effect de gating, con dep
  `[segments]`, que llama `trackNavigation(segments.join('/'))`. No se toca el effect de gating existente
  (evita acoplar navegación-analytics con la lógica de re-ruteo).
- **`identify` (R5.3)** — en `AuthContext`: cuando `state.status === 'authenticated'`, llamar
  `identifyUser(state.user.id)` (solo el id; **nada de email/name**). Reutiliza el `useEffect` de estado que
  ya existe, o uno nuevo con dep `[state]`. En `SIGNED_OUT` → `resetIdentity()` (R5.6).
- **`group` + `register` (R5.4/R5.5)** — en `EstablishmentContext`: cuando `state.status === 'active'`,
  llamar `setTenantGroup(state.current.id, state.role, getAppEnv())` →
  `client.group('establishment', id)` + `client.register({ role, establishment_id: id, env })`. El
  `EstablishmentState` `active` expone `current` (`{id,name,province,city,role}`) y `role` (verificado en
  `app/src/utils/establishment.ts`), así que ambos datos ya están en contexto sin fetch extra.

## 5. Eventos de dominio (R6)

`captureDomainEvent(name, props)` sobre el singleton. Call sites (nuevos, no "patrones existentes"):

| Evento | Call site | Props (no-PII, R6.4) |
|---|---|---|
| `maniobra_guardada` (R6.1) | persistencia de la maniobra en el frame de carga (`app/app/maniobra/carga.tsx` / servicio de guardado de sesión) | `{ type }` (tipo de maniobra: pesaje/tacto/sanitaria/…) |
| `import_completado` (R6.2) | fin OK del wizard de import (`app/app/import-rodeo.tsx` / servicio de import, feature 12) | `{ rows }` (conteo de filas) |
| `invitacion_enviada` (R6.3) | envío OK de invitación (`app/app/invitar.tsx` / servicio de invitaciones, feature 5) | `{ role }` (rol invitado) |

**Granularidad de `maniobra_guardada` (R6.1) — decisión de diseño**: **un evento por persistencia de
maniobra** (el guardado de un evento de maniobra para un animal en la carga), **no** uno por jornada/sesión
completa ni uno por cada sub-maniobra dentro de un mismo guardado. La `prop { type }` = tipo de esa maniobra
(pesaje/tacto/sanitaria/…). El call site es el punto único donde la carga persiste el evento (mismo choke
point que alimenta `weight_events`/`reproductive_events`/etc.), así el implementer **no dispara N eventos por
jornada** ni multiplica por sub-paso. Si un guardado persiste varias tablas de una, es **un** evento con el
`type` de la maniobra guardada. (El conteo de animales/jornada se deriva después en el dashboard por
agregación; no se sobre-instrumenta acá.)

Ninguna prop lleva id de animal, caravana, nombre, email ni datos de campo (R6.4/R7.1).

## 6. Privacidad (Ley 25.326) — cómo se enforza

- **Sin PII (R7.1)**: `identify` solo `user.id` (R5.3); breadcrumbs solo `pathname`/`kind` (R3.3/R4.4);
  `upload_rejected` solo `table/op/code` (R4.2); eventos de dominio solo metadata (R6.4). El
  `captureConsole` es `levels:['error']` y se audita que no haya `console.error` con PII (R1.6).
- **Scrubber defense-in-depth (R7.4)**: `beforeSend`/`beforeBreadcrumb` con `redact.ts` (denylist +
  walk recursivo) redactan cualquier clave sensible que se cuele por `captureConsole` o por un call site
  futuro, ANTES de que el evento salga. **Fail-closed (R7.4.2)**: si el scrubber tira, se DESCARTA el evento
  (no se envía crudo). Es la última línea, no la primera: la primera sigue siendo no meter PII. PostHog no
  lo necesita (whitelist-by-construction).
- **Sin PII visual (R7.5, M4)**: `attachScreenshot: false` + `attachViewHierarchy: false` por default — las
  capturas de pixeles bypassean el scrubber key-based y subirían PII visual sobre un tenant real. El shake
  feedback (R2.7) queda gated Fase 0 y su screenshot no se activa sobre un tenant real sin decisión aparte.
- **Tenant de prueba filtrable (R7.2)**: cada evento lleva `establishment_id` (super property + group de
  PostHog) y Sentry lo tiene disponible por `setTag`/`setContext` (opcional, mismo dato no-PII). El
  **mecanismo de "filtrar"** el "Campo de prueba RAFAQ" es a nivel **dashboard/saved-search** (PostHog:
  filtro por group `establishment` ≠ id de prueba; Sentry: inbound filter / saved search por tag), no
  supresión client-side: el `establishment_id` del tenant de prueba **no se conoce en tiempo de spec** (se
  crea en PROD en feature 16). Se documenta como paso de ops en el runbook. → **Punto de decisión Puerta 1**
  (§9): si Raf quiere supresión dura client-side, hace falta el id del tenant como env var extra.
- **Segmentación por env (R7.3)**: Sentry `environment=getAppEnv()`; PostHog super property `env`. Los
  dashboards de beta filtran `env=production`.

## 7. Multi-tenancy y offline-first (reglas duras del repo)

- **Multi-tenancy / RLS**: esta feature **no crea ni modifica tablas ni policies** — es frontend runtime.
  No toca RLS. El único dato de tenancy que sale es `establishment_id` como property/group (no-PII,
  derivado del contexto ya scopeado por RLS; nunca hardcodeado — CLAUDE.md ppio 6). Se menciona
  explícitamente por la regla dura, pero **no hay superficie SQL**.
- **Offline-first**: el buffer offline de Sentry (R9.1) es justamente el requisito offline-first de esta
  feature — un crash del peón sin señal se persiste y se envía al reconectar. PostHog `posthog-react-native`
  también bufferea eventos en disco y los drena al reconectar (comportamiento por defecto de la lib). La
  instrumentación NO agrega I/O bloqueante al flujo de campo: todos los sinks son best-effort en `try/catch`
  (R4.5), consistente con `logTransportEvent`/`recordUploadRejection` que ya nunca bloquean.

## 8. Archivos a crear / modificar

**Crear:**
- `app/src/services/observability/env.ts` — reader de `EXPO_PUBLIC_SENTRY_DSN`/`_POSTHOG_KEY`/`_POSTHOG_HOST`.
- `app/src/services/observability/sentry.ts` — `initSentry()` (con `beforeSend`/`beforeBreadcrumb`) +
  helper de captura best-effort.
- `app/src/services/observability/redact.ts` — scrubber PURO (denylist + walk recursivo con corte de
  profundidad y manejo de ciclos): `redactEvent`/`redactBreadcrumb` (R7.4).
- `app/src/services/observability/posthog.ts` — client singleton + `identifyUser`/`resetIdentity`/
  `setTenantGroup`/`captureDomainEvent`.
- `app/src/services/observability/navigation.ts` — `trackNavigation(pathname)` (breadcrumb + screen).
- `app/app/_components/RootErrorBoundary.tsx` — ErrorBoundary raíz es-AR + crash de prueba dev-only.

**Modificar:**
- `app/app/_layout.tsx` — `initSentry()` a nivel módulo; `Sentry.wrap` del default export; montar
  `RootErrorBoundary` (dentro de Tamagui, encima de Auth) + `PostHogProvider` (encima de Auth); `useEffect`
  de navegación en `RootGate`.
- `app/src/contexts/AuthContext.tsx` — `identifyUser` al autenticar; `resetIdentity` en `SIGNED_OUT`.
- `app/src/contexts/EstablishmentContext.tsx` — `setTenantGroup` al pasar a `active`.
- `app/src/services/powersync/connector.ts` — sink `Sentry.captureMessage('upload_rejected', …)` DENTRO de
  `surfaceUploadRejection` (su propio `try/catch`; sin tocar call sites; solo table/op/code) — **toca el
  connector → Gate 1 obligatorio**.
- `app/src/services/ble/logging.ts` — sink `Sentry.addBreadcrumb` DENTRO de `logTransportEvent` (su propio
  `try/catch`; sin tocar call sites).
- Call sites de eventos de dominio (`app/app/maniobra/carga.tsx` o servicio de guardado; `import-rodeo`;
  `invitar`) — 1 `captureDomainEvent(...)` cada uno.
- `.env` / EAS Environment Variables — las 3 `EXPO_PUBLIC_*`.
- **`[GATED-FASE0]`** `app/app.config.ts` (config plugin de Sentry + `SENTRY_AUTH_TOKEN`) + metro plugin +
  instalación de deps nativas — **después** del build verde de Fase 0.
- Runbook (feature 16 E.5) — reglas R9.2 (source maps por `eas update`) y R9.3 (alerta email); paso de ops
  del filtro de tenant de prueba (R7.2).

## 9. Alternativa descartada

**Usar `usePostHog()` (hook) para identify/group en vez de un client singleton.**
- Pros: es el patrón "canónico" del provider; menos módulos.
- Contras: obliga a que `AuthProvider`/`EstablishmentProvider` estén dentro de `PostHogProvider` **y** que
  los eventos de dominio (que a veces viven en servicios no-React: guardado de maniobra, import) tengan un
  componente que llame al hook — imposible desde un servicio puro. Terminaría en dos caminos de acceso
  (hook para identity, algo global para eventos) → riesgo de dos clients o de eventos sin identidad.
- **Razón de descarte**: un **client singleton único** (pasado al provider como `client={…}`) da un solo
  punto de acceso testeable desde React y desde servicios, desacopla del orden de providers, y hace trivial
  el no-op (un client `disabled`). El provider se mantiene igual (siempre montado, autocapture off) por su
  rol de lifecycle/flush.

## Notas de trazabilidad para el implementer

- Mapa `R<n> → archivo:test` va en `progress/impl_17-observabilidad.md`.
- Tests con el client en no-op (mock): asertar **forma del payload** y **ausencia de `opData`/PII** (no
  solo "se llamó"). Falsificar: un test debe fallar si el payload incluyera `opData`/email.
- E2E (R8.1): correr los ~70 specs con `EXPO_PUBLIC_ENV='e2e'` (shim ya lo setea) → Sentry/PostHog no-op,
  ErrorBoundary passthrough, boot idéntico.

## Reconciliación AS-BUILT (impl, 2026-08-11) — cómo quedó construido de verdad

El *qué* (R1–R9) se cumple sin cambios; lo que sigue reconcilia el *cómo* con el código realmente
construido (regla dura de `docs/specs.md`). Ningún EARS se re-abre.

- **Platform-split de `sentry.ts` y `posthog.ts` (en vez de un archivo único, §8).** Para GARANTIZAR el
  no-op en web/E2E sin depender de que `@sentry/react-native` / `posthog-react-native` soporten
  react-native-web (riesgo sobre los ~70 specs), se usó la técnica del repo (`google-auth.ts`):
  - `sentry.ts` (base, **también web**: no importa el SDK → no-op) + `sentry.native.ts` (importa el SDK,
    init real). Idem `posthog.tsx` (base/web passthrough) + `posthog.native.tsx` (client singleton + lib
    provider). tsc + Metro-web resuelven la base; Metro-native resuelve `.native`. El import nativo NUNCA
    entra al bundle web ni al grafo de node:test. `navigation.ts` delega en ambos (agnóstico).
- **Módulo PURO nuevo `payloads.ts`** (no listado en §8): centraliza la forma de cada payload outbound
  (`buildUploadRejectedPayload` / `buildBleBreadcrumb` / `buildNavigationBreadcrumb` / `buildTenantRegister`
  + nombres de eventos). Los wrappers de SDK lo consumen → el test de forma (R4.2/R6.4/R7.1) ejerce la
  MISMA función que producción (no un espejo). `redact.ts` queda enfocado en el scrubber.
- **`captureConsoleIntegration` se importa de `@sentry/core`**, no de `@sentry/react-native`: en la versión
  instalada (`@sentry/react-native` ~7.11, que pinnea `@sentry/core` 10.x) el SDK RN NO re-exporta esa
  integración desde su índice (verificado en `integrations/exports.d.ts`). El snippet de §3 que decía
  `Sentry.captureConsoleIntegration(...)` queda como `captureConsoleIntegration(...)` del core hoisteado.
- **`captureMessage('upload_rejected', …)`** se emite como `Sentry.captureMessage(name, { level: 'warning',
  tags: buildUploadRejectedPayload(op, error) })`: el 2º arg de `captureMessage` es un `CaptureContext`
  (no un dict de datos suelto), así que `{table,op,code}` van como **tags** (filtrables). Sin `opData`.
- **`captureException` con `mechanism`** (R2.5) se pasa como `{ tags: { mechanism: 'RootErrorBoundary' } }`
  (shape de hint de la versión instalada), para distinguirlo del eco de `captureConsole`.
- **Crash-test de R2.6**: se implementó como un **chip flotante dev-only** dentro del `RootErrorBoundary`,
  gated a `getAppEnv() ∈ {development, preview}` (oculto en producción y en E2E → cero interferencia con la
  regresión). Reemplaza la ubicación *tentativa* "fila en Más" (§3) para NO tocar `mas.tsx` (colisión con la
  terminal de la feature 16). Para la captura del Gate 2.5 se agregó el DEV_WEB_ROUTE **`observabilidad-spike`**
  (reusa el mismo `RootErrorBoundaryFallback` de producción) — el chip está oculto en E2E, el spike es el
  vehículo de captura. Posición del chip por TOKENS (no `insets.top`) para no disparar el guard de bandas
  de tap-targets (`tap-target-collision-guard`).
- **`maniobra_guardada` (R6.1)**: se instrumenta el choke point de FÁBRICA (`captureAndAdvance` en
  `maniobra/carga.tsx`), 1 evento por persistencia real (`persisted === true`; un multi-write = 1 evento),
  prop `{ type }`. **DECISIÓN**: el path de mediciones CUSTOM (`captureCustomAndAdvance` →
  `custom_measurements`) NO se cuenta en esta iteración: el `{ type }` del diseño enumera maniobras de
  fábrica (pesaje/tacto/sanitaria/…) y el funnel del MVP apunta a ésas; agregar `{ type: 'custom' }` es
  trivial si Facundo lo pide. Documentado, no es un hueco silencioso.
- **Deps instaladas** (pnpm, `node-linker=hoisted`): `@sentry/react-native ~7.11.0`,
  `posthog-react-native ^4.63.0`, `expo-application ~56.0.3`, `expo-localization ~56.0.6` (peers;
  `expo-file-system`/`expo-device` ya estaban). NO se agregó el config plugin de Sentry/expo-localization a
  `app.config.ts` (el CLI lo sugiere) → eso es **[GATED-FASE0]**.
