# Observabilidad en miTropero: los tres trabajos

> Estado al 14/08/2026. Describe QUÉ hay armado/planeado en cada uno de los tres
> trabajos de observabilidad de la app y CÓMO funciona cada uno. Sin comparaciones.

La observabilidad de miTropero son **tres trabajos distintos**, con estados distintos:

1. **Historial forense de acciones** — el audit log server-side. Qué cambió en la base, quién lo hizo. **Vivo en dev.**
2. **Monitoreo de errores** — Sentry. Crashes y errores de la app, con contexto. **Wiring JS hecho; la parte nativa espera el build de Fase 0.**
3. **Analytics de comportamiento** — PostHog. Uso de features, funnels, retención. **Wiring JS hecho; la parte nativa espera el build de Fase 0.**

---

## 1. Historial forense de acciones (audit log)

**Qué es.** Un registro append-only server-side de cada cambio en las tablas trackeadas: el antes y el después de cada fila, con el actor real y el momento. Es "los logs de cada acción que persisten".

**Estado.** DONE (spec 18, migración `0124_audit_log.sql`), **vivo en DEV**. Es **backend-only**: schema `audit`, accesible solo por `service_role`, sin UI todavía.

**Cómo funciona.**

- **Tabla `audit.record_version`** — append-only, sin FK ni CHECK (la fila de audit se inserta siempre, aunque el usuario que la generó ya no exista). Columnas clave:
  - `op` — INSERT / UPDATE / DELETE (enum).
  - `record` / `old_record` (JSONB) — el **después** y el **antes** de la fila. El diff completo de qué cambió.
  - `auth_uid` — el **actor real** (ver abajo).
  - `record_id` — id **estable** por fila (uuid v5 derivado de la PK): la misma fila tiene el mismo `record_id` en su INSERT, sus UPDATE y su DELETE → se puede seguir la vida de una fila.
  - `ts` — **hora de SYNC** (cuándo llegó al server), no cuándo pasó la acción en el campo.
  - `table_schema` / `table_name` / `table_oid`.
- **Trigger** `AFTER INSERT/UPDATE/DELETE FOR EACH ROW`, `SECURITY DEFINER` (inserta en `audit` aunque el que escribe no tenga permiso sobre ese schema).
- **Actor real (`resolve_actor()`)** — resuelve quién hizo el cambio:
  - Write con JWT de usuario (RPC / PowerSync) → `auth.uid()`.
  - Write por Edge Function (corre como `service_role`) → el actor viaja en el header `X-Rafaq-Actor`, que el trigger **solo confía si el rol de sesión es `service_role`** (un usuario no puede spoofearlo). El actor es el `user.id` del JWT validado del que llamó a la función, **nunca** del body. Se propaga desde `createAdminClient(actorId)` en `_shared/supabase.ts`.
- **Modo de falla por tabla:**
  - **best-effort** en el camino caliente (manga): si el insert de audit falla, la carga del operario procede igual. La manga nunca se traba por el audit.
  - **estricto** para `user_roles`: los errores propagan, sin huecos en el log de membresías.
- **Qué se trackea HOY:** solo `public.user_roles`. `animals` está **gateado** hasta medir el volumen que genera un import (T12). Las tablas de evento y las de PII están **excluidas** a propósito en este incremento.
- **Seguridad (fail-closed):** se revoca `USAGE`/`SELECT` del schema `audit` a `anon`/`authenticated`/`public`; un smoke-check en la migración **aborta** si el muro quedó abierto; el schema no se expone por PostgREST; y `audit.record_version` **no está en las sync streams** → nunca baja a un device.
- **Semántica temporal:** `ts` es hora de sync. El "cuándo pasó" real vive en las columnas fechadas por el device (fecha del evento, del pesaje, del tacto). Para una línea de tiempo forense se cruza `auth_uid`/`record`/`old_record` (qué + quién) con esas fechas (cuándo).
- **Retención:** un cron mensual (`audit_purge_monthly`) borra lo que tiene más de 90 días.

**Planeado (no hecho todavía):**
- Columna `request_id` para correlacionar una acción de punta a punta (el "checkpoint de Edge Functions"). Hoy no existe.
- Prender el tracking sobre `animals` cuando pase el gate de volumen (T12).
- Un viewer read-only sobre la tabla (idea, sin spec).

---

## 2. Monitoreo de errores (Sentry)

**Qué es.** Captura de errores y crashes de la app en runtime, con stack trace, breadcrumbs (la miga de pan de lo que pasó antes) y contexto de release/device, más alertas cuando aparece un error nuevo.

**Estado.** Feature 17. **Wiring JS hecho y commiteado** (Puerta 2 aprobada); la feature queda `in_progress`. La cuenta está creada: org `mitropero` / proyecto `react-native` (US, plan free). El DSN es un valor **write-only de cliente** (no es un secreto) y vive en `specs/active/17-observabilidad/external-setup.md`. La parte **nativa** está `[GATED-FASE0]` (espera el build de Fase 0).

**Cómo funciona.**

- **Init con doble guarda** (`initSentry`): `Sentry.init` queda **no-op si no hay DSN o si corre en E2E** (`enabled: !!dsn && !isE2E()`). Así no ensucia los tests ni un entorno sin configurar.
- **`environment`** = el ambiente real (development/production) → se segmenta en el dashboard.
- **`tracesSampleRate: 0`** — sin performance tracing por ahora, solo errores.
- **Captura de `console.error` app-wide** (`captureConsoleIntegration({ levels: ['error'] })`): cualquier `console.error` de la app llega a Sentry sin tocar los call sites.
- **`Sentry.wrap` en la raíz** de la app (`wrapRoot`).
- **ErrorBoundary raíz** (`RootErrorBoundary`) — si algo revienta en el árbol de React, muestra un fallback en es-AR ("Algo salió mal" / "Reintentar") en vez de una pantalla en blanco, y reporta el error con `mechanism: 'RootErrorBoundary'`.
- **Choke points instrumentados** (los puntos donde algo puede salir mal en silencio):
  - `captureUploadRejected` — cuando un write se rechaza permanentemente en la cola de PowerSync, emite un evento `upload_rejected` con **solo** `table` / `op` / `code`. **Nunca** el `opData` (que puede traer datos del campo).
  - `addBleBreadcrumb` — eventos del transporte BLE del bastón (solo campos diagnósticos, sin el EID crudo).
  - `addNavigationBreadcrumb` — navegación, **solo el pathname** (sin params).
- **Scrubber de PII, fail-closed** (`redact.ts`, corre en `beforeSend` y `beforeBreadcrumb`): antes de que cualquier evento salga, pasa por una denylist en dos grupos —
  - **PII por igualdad** (email, teléfono, nombre, apellido, dni, cuit, …): se redacta la clave exacta.
  - **Secretos por inclusión** (token, secret, session, password, authorization, jwt, …): se redacta cualquier clave que los contenga.
  - Además limpia strings con patrones `Bearer`/JWT/`token=`.
  - **Fail-closed:** si el scrubber tira una excepción, devuelve `null` → Sentry **descarta el evento entero** antes que arriesgar una fuga.
- **Sin PII visual:** `attachScreenshot: false` y `attachViewHierarchy: false` (los pixeles/jerarquía de views bypassearían el scrubber por-clave).
- **Platform-split:** la base `sentry.ts` (web) es no-op y **no importa el SDK**; `sentry.native.ts` (device) inicializa el SDK real. Por eso web y E2E quedan verdes.

**Planeado (`[GATED-FASE0]`, espera el build de Fase 0):**
- Config plugin nativo en `app.config.ts` + metro plugin → source maps (des-minificar el stack) y captura de crash nativo.
- `SENTRY_AUTH_TOKEN` como **EAS secret** para subir los source maps en cada build/update.
- Las deps nativas (`@sentry/react-native` + peers) dentro del APK.
- Verificación en device: buffer offline (que los errores en la manga sin señal se guarden y se manden después) y feedback por shake.
- Runbook de OPS. La alerta "error nuevo → email" ya quedó creada en el wizard.

---

## 3. Analytics de comportamiento (PostHog)

**Qué es.** Registro de eventos de uso para entender el comportamiento: qué features se usan, funnels, retención. Es **agregado** — para analizar tendencias, no para reconstruir fila por fila lo que hizo un usuario (eso es el audit log).

**Estado.** Feature 17. **Wiring JS hecho y commiteado**; la feature queda `in_progress`. Cuenta creada: PostHog US, project `552831`, host `us.i.posthog.com`. La project key es **write-only de cliente** y vive en `external-setup.md`. La parte **nativa** está `[GATED-FASE0]`.

**Cómo funciona.**

- **Client singleton** (`new PostHog(key, { host, disabled: !key || isE2E() })`): sin key o en E2E, **todas las llamadas son no-op**. Un solo client, accesible desde React (provider/hooks) y desde servicios no-React (eventos de dominio).
- **Provider siempre montado**, **autocapture OFF** (`PostHogProvider` con `autocapture: false`): no se capturan taps/pantallas automáticamente; todo lo que se registra es explícito.
- **Identidad:**
  - `identifyUser(id)` → `identify(user.id)` con **solo el id** como distinct id. Nada de email ni nombre.
  - `resetIdentity()` → `reset()` al cerrar sesión, para no cruzar identidades en un teléfono compartido.
- **Tenant** (`setTenantGroup`): `group('establishment', id)` + super properties `{ role, establishment_id, env }` — metadata no identificatoria que se pega a cada evento.
- **Pantallas** (`trackScreen`): screen tracking manual con **solo el pathname** (sin params ni PII).
- **Eventos de dominio del MVP** (props sin PII, armadas por builders puros y testeados):
  - `maniobra_guardada` — al guardar una maniobra (`maniobra/carga.tsx`).
  - `import_completado` — al terminar un import de rodeo (`useImportRodeo.ts`).
  - `invitacion_enviada` — al crear una invitación (`invitar.tsx`).
- **Platform-split** igual que Sentry: base `posthog.tsx` (web) passthrough/no-op sin el SDK; `posthog.native.tsx` (device) con el SDK real.

**Planeado (`[GATED-FASE0]`):**
- Las deps nativas (`posthog-react-native` + peers) dentro del APK.
- Verificación en device.

---

## Nota transversal: por qué "wiring JS hecho" no es "funcionando en el celular"

En los trabajos 2 y 3, el **código JS** ya está escrito, testeado y commiteado, y llega al device por OTA. Pero las **deps nativas** (los SDK de Sentry/PostHog compilados dentro del APK) y la config nativa de bajo nivel (source maps, crash handler) recién entran cuando se hace el **build de Fase 0** (feature 16). Hasta ese build, en web y E2E todo corre en modo no-op (por diseño, el platform-split); en un device real todavía no reportan. Por eso la feature 17 está `in_progress`, no `done`.
