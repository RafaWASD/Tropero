# Contexto — 23 · request_id / operationId end-to-end (Gate 0)

> Refinamiento de contexto (ADR-022). Se aprueba ANTES de escribir la spec.
> Origen: `docs/monitoreo-banco-vs-mitropero-2026-08-12.md` §4 + análisis 2026-08-14.
> Alcance elegido por Raf: **Completo** (los 4 puntos) **+ superficie UI** (código de
> soporte copiable), 2026-08-14.

## Problema

Hoy no existe un identificador que permita reconstruir **una acción de usuario de punta a
punta** cruzando las fronteras del sistema. Cuando algo sale mal ("cargué X y desapareció"),
se arranca por actor + ventana temporal y se cruza a mano. El audit log (`audit.record_version`,
spec 18) ya da "qué cambió y quién", pero no lo enlaza con la llamada HTTP que lo originó ni con
los eventos de cliente (Sentry/PostHog).

## Objetivo

Un `request_id` (uuid) **por acción de usuario** que viaje por las fronteras donde hay una
frontera real, para poder pedir/buscar un id y ver la cadena: qué se pidió → qué respondió el
server → qué filas cambiaron y quién → qué reportó el cliente.

## Alcance — lo que SÍ (Completo)

1. **Cliente → header.** Generar un `requestId` (uuid v4) por acción y mandarlo como header
   `X-Mitropero-Request-Id` en las llamadas a Edge Functions (al lado del mecanismo de actor ya
   existente).
2. **Wrapper de Edge Functions** en `_shared/`:
   - (a) Lee el `X-Mitropero-Request-Id` entrante; si no viene (app vieja), **genera uno server-side**
     para no perder la traza.
   - (b) Lo **reenvía al admin client** para que llegue al trigger de audit (igual que hoy se
     reenvía `X-Mitropero-Actor`).
   - (c) Emite **dos líneas JSON estructuradas** por llamada — entrada (`requestId`, función,
     actor, tamaño de body) y salida (status, código de error, duración ms). **Sin body.** Van a
     los logs de Edge Functions de Supabase (ya se capturan y son consultables). Sin store nuevo.
3. **Base**: columna `request_id uuid` (nullable) en `audit.record_version`, resuelta por una
   función `resolve_request_id()` análoga a `resolve_actor()` — lee el header del GUC
   `request.headers` **solo bajo `service_role`**, valida uuid, si no → NULL. Se agrega al INSERT
   del trigger en **ambos** modos (best_effort y strict).
4. **Cliente → observabilidad**: el mismo `requestId` como **tag** en Sentry y como **prop** en
   los eventos de dominio de PostHog, para que un error/evento de cliente se correlacione con la
   acción.
5. **Superficie UI — "código de soporte"**: el `requestId` se muestra, copiable en un tap, donde
   al usuario le sirve para dárselo a soporte. Dos superficies núcleo (ambas ya existen; se les
   agrega el id):
   - **Fallback de crash** (`RootErrorBoundary`, "Algo salió mal") → línea "Código de soporte:
     XXXX" + botón **Copiar**.
   - **Surfacing de rechazo de sync** (spec 03 R10.8, la UI de manga que ya avisa que un evento
     cargado offline fue rechazado) → el mismo código de soporte + Copiar. Es el caso
     "cargué un tacto y desapareció" — el más relevante para el campo.
   El id que se muestra es el **client-side** de esa acción (correlaciona con Sentry/PostHog aunque
   no haya fila de audit para un tacto). Opcional (a decidir en design): una entrada de
   diagnóstico en Ajustes con los últimos N ids.

## Alcance — lo que NO (diferido, con razón)

- **Correlación server/DB de un write que va por PowerSync** (un tacto, un pesaje, un alta). Dos
  razones verificadas: (a) la subida es **async y en batch** (`connector.ts` drena la cola por
  `CrudTransaction`, potencialmente horas después y en otra sesión) → un header *por-acción* no
  puede viajar con ella; el id tendría que ir **persistido en el payload**. (b) El audit hoy
  **solo trackea `user_roles`**; las tablas de evento están excluidas (spec 18 R5.6) y `animals`
  está gateado por volumen (T12). → Se difiere hasta que T12 prenda el audit sobre eventos y se
  diseñe el id-en-payload. Meter la columna igual desde ahora deja el terreno listo.

## Decisiones cerradas (para que la spec no las re-decida)

- **D1.** `requestId` = uuid v4 random, **sin significado** (no deriva de datos → no es PII).
- **D2.** El wrapper envuelve **las 9 EFs** (uniformidad + logging), aunque solo las que escriben
  tablas auditadas (hoy `user_roles`: `change_member_role`, `accept_invitation`, `remove_member`)
  aterricen el `request_id` en audit. `health`/`register_push_token` incluidas — el logging es
  barato y el valor operativo (latencia/errores) aplica igual.
- **D3.** `createAdminClient` se amplía a `createAdminClient(actorId?, requestId?)` — **aditivo**,
  setea ambos headers globales. Sin `requestId` el comportamiento es idéntico al actual.
- **D4.** Columna `request_id` **nullable** — la mayoría de los writes (JWT de usuario / PowerSync)
  no lo traen → NULL honesto, igual que `auth_uid`. Índice parcial `where request_id is not null`
  para buscar por id.
- **D5.** Sink del logging in/out = `console.log(JSON.stringify(...))` → logs de EF de Supabase.
  **Nunca** el body (puede traer datos de campo); solo su tamaño.
- **D6.** `resolve_request_id()` es **TOTAL** (nunca lanza) — mismo blindaje que `resolve_actor`:
  cualquier fallo de parse → NULL, jamás traba el write en el hot path.

## Edge cases refinados

- **App vieja sin header** → la EF genera un `requestId` server-side; el audit queda con ese id;
  el cliente no lo tiene (degradación honesta, no rompe nada).
- **Spoofing del header por un cliente** → irrelevante como credencial (es solo etiqueta de
  correlación) y, además, `resolve_request_id()` lo confía **solo bajo `service_role`**: un write
  directo con JWT de usuario NO puede inyectar `request_id` en audit. Como hoy las tablas auditadas
  se escriben **solo por EFs (service_role)**, el id del cliente llega bien vía la EF y un cliente
  no puede ensuciar el audit con ids falsos. Consistente con el modelo de actor.
- **Tag de Sentry en una acción no-EF** → el `requestId` se adjunta a los eventos emitidos durante
  esa acción (detalle de scope: `withScope`/contexto de pantalla; lo resuelve el design).

## Riesgos / notas para la implementación

- **Re-CREATE del trigger de audit.** La migración 0131 va a re-crear `resolve_actor` /
  `audit.insert_update_delete_trigger` (para sumar la columna y `resolve_request_id`). Regla
  [[reference_function_recreate_base]]: **moldear sobre el cuerpo VIGENTE en el remoto**, no sobre
  0124 — verificar antes que ninguna migración 0125-0130 haya redefinido esas funciones.
- **Re-correr TODAS las suites que tocan audit** tras el cambio del trigger (spec 18 / user_roles).
- **Deploy gateado (Gate 1).** La migración a la DB compartida requiere OK de Raf en sesión
  (clasificador Supabase MCP + Gate 1 de PowerSync/DB). Ver [[project_supabase_mcp_write]].
- **one_feature_at_a_time.** 17 está `in_progress` (gated Fase 0). Esta feature puede refinarse y
  spec-earse en paralelo; al llegar al implementer, coordinar para no violar la regla del check.

## Dependencias y gates

- Toca **schema** (columna + funciones + trigger) → **Gate 1 (security_analyzer modo spec)
  OBLIGATORIO** antes de la aprobación humana de la spec.
- Hay **superficie UI** (código de soporte en fallback de crash + surfacing de rechazo) → **Gate
  2.5 APLICA** (E2E + capturas + veto visual). Vetear con un título con descendentes
  ([[feedback_descender_clipping]]) y con los básicos de UX de manga.
- Migración ≥ **0131**. Feature nueva **id 23** en `feature_list.json` (registrar al pasar a spec).
