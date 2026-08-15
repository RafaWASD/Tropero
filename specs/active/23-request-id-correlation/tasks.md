# Tasks — 23 · request_id / operationId end-to-end

> Orden de implementación. Cada task cita los `R<n>` que cubre. Los tests **DB-dependientes** (requieren la
> migración 0131 aplicada a la DB compartida) quedan PENDIENTES del deploy gateado (Gate 1 + OK de Raf en
> sesión) — marcados con `⛔DB-GATED`. El resto corre sin deploy.
>
> **Reconciliación 2026-08-14 (leader, as-built):** implementación completa (backend + frontend), typecheck 0,
> unit 25/25 + serve-log 7/7. Gate 1 PASS, Gate 2 (código) PASS 0 HIGH, reviewer APPROVED tras el fix-loop de
> tests (guard de no-leak `serve-log.test.ts` + tag de correlación `buildCaptureTags`).
> **[2026-08-15] TODO CERRADO:** Gate 2.5 OK · deploy de 0131 + 9 funciones a DEV OK · verificación DB
> post-deploy (T5/T29-T32) OK · E2E full 306 passed · request_id aterrizado en audit (T30) · Puerta 2
> aprobada por Raf (T34). **Feature DONE.**
>
> `one_feature_at_a_time`: al lanzar el implementer se bajó la feature 17 (remanente externamente blocked /
> gated Fase 0) a `blocked`.

---

## Fase A — Schema (migración 0131, aditiva) · deploy GATEADO

- [x] **T1** — Crear `supabase/migrations/0131_audit_request_id.sql` moldeado sobre 0124 (ver design §US3):
  `alter table ... add column if not exists request_id uuid` + índice parcial. Cubre: R3.1, R3.2, R3.11.
- [x] **T2** — En 0131: `create or replace function audit.resolve_request_id()` — lee el header del GUC solo
  bajo service_role, valida uuid, TOTAL (nunca lanza). Cubre: R3.3, R3.4, R3.5, R3.6.
- [x] **T3** — En 0131: `create or replace function audit.insert_update_delete_trigger()` agregando
  `request_id = audit.resolve_request_id()` al INSERT en AMBOS modos (best_effort + strict), preservando el
  resto del cuerpo de 0124. Cubre: R3.7, R3.8, R3.9.
- [x] **T4** — En 0131: `revoke execute on function audit.resolve_request_id() from public, anon, authenticated`
  + smoke-check doble (EXECUTE cerrado + muro de lectura + columna NULLABLE) que aborta la migración. Cubre:
  R3.12, R3.13.
- [x] **T5** ✅[2026-08-15] — Aplicar 0131 a la DB DEV compartida (tras OK de Raf) y verificar el smoke-check
  (NOTICE OK, sin excepción). Cubre: R3.12, R3.13.

## Fase B — Edge Functions (wrapper + admin client + CORS)

- [x] **T6** — `createAdminClient(actorId?, requestId?)` aditivo en `_shared/supabase.ts`: setea
  `X-Rafaq-Request-Id` global cuando se pasa; sin él, shape idéntico al actual. Cubre: R2.12.
- [x] **T7** — Crear `_shared/serve.ts` con `serveEf(fn, handler)`: resuelve requestId (usa el header válido o
  genera server-side; header basura → server-side), expone `ctx.requestId`, emite ENTRADA/SALIDA JSON sin
  body, sin Authorization/token. **As-built:** la lógica pura de logs se extrajo a `_shared/serve-log.ts`
  (`readSubBestEffort`/`buildEfIn`/`buildEfOut`) para poder guardearla en node:test. Cubre: R2.1, R2.2, R2.3,
  R2.4, R2.5, R2.6, R2.7, R2.8, R2.9.
- [x] **T8** — Agregar `x-rafaq-request-id` a `Access-Control-Allow-Headers` en `_shared/cors.ts`. Cubre: R2.13.
- [x] **T9** — Migrar las 3 EFs que escriben `user_roles` a `serveEf` y pasar `ctx.requestId` a
  `createAdminClient(user.id, ctx.requestId)`: `change_member_role`, `accept_invitation`, `remove_member`.
  Preservar contrato observable. Cubre: R2.10, R2.11, R3.10.
- [x] **T10** — Migrar las 6 EFs restantes a `serveEf` (logging + uniformidad, sin efecto sobre audit):
  `invite_user`, `cancel_invitation`, `resend_invitation`, `register_push_token`, `delete_account`, `health`.
  Preservar contrato. `delete_account` pasa `user.id` (escribe como usuario). Cubre: R2.10, R2.11.

## Fase C — Cliente (util + call-sites + observabilidad)

- [x] **T11** — Crear `app/src/utils/request-id.ts` con `newRequestId()` (`globalThis.crypto.randomUUID()`,
  polyfilleado). Cubre: R1.1, R1.2, R1.5.
- [x] **T12** — Agregar el header `X-Rafaq-Request-Id` en los 3 call-sites de EFs (`members.ts` `invokeFn`,
  `account.ts` `deleteAccount`, `push-notifications.ts` `registerPushTokenBestEffort`), generando el
  requestId una vez por acción. **As-built:** `invokeFn` genera `?? newRequestId()` → TODAS las ops de
  miembros llevan el header (audit para las de user_roles); `invitar.tsx` threadea su requestId al header y al
  evento (correlación 1:1). Cubre: R1.3, R1.4.
- [x] **T13** — `payloads.ts`: constante `REQUEST_ID_TAG = 'request_id'` + extender `buildUploadRejectedPayload`
  para incluir `id` (sin `opData`/PII). Cubre: R4.3, R5.6.
- [x] **T14** — `sentry.native.ts` + base no-op: `captureExceptionSafe(error, { mechanism?, requestId? })`
  arma `tags` con `request_id` por-captura (scope acotado, sin setTag global); `captureUploadRejected` taggea
  el `id`. **As-built:** el armado de tags se centralizó en `buildCaptureTags` (payloads.ts, R4.3). Base web
  sigue no-op. Cubre: R4.1, R4.4, R5.2, R5.6, R6.1, R6.3.
- [x] **T15** — `posthog`: `captureDomainEvent` recibe `request_id` como prop; los call-sites de los 3 eventos
  de dominio (`invitacion_enviada` en invitar.tsx, `maniobra_guardada` en carga.tsx, `import_completado` en
  useImportRodeo.ts) lo pasan. `posthog.*` sin cambio de firma (props arbitrarias). Cubre: R4.2, R6.2, R6.3.

## Fase D — UI "código de soporte" (Gate 2.5)

- [x] **T16** — Componente reusable `SupportCodeRow` (es-AR "Código de soporte:" + valor + Copiar): tap directo
  en pieza Tamagui, target ≥ `$touchMin`, `lineHeight` matcheando `fontSize`, Copiar best-effort
  (`expo-clipboard` presente → `setStringAsync`; fallback seleccionable). Cubre: R5.8, R5.9, R5.10.
- [x] **T17** — `RootErrorBoundary`: `componentDidCatch` genera `requestId`, lo guarda en state, lo taggea en
  Sentry (`captureExceptionSafe(error, { mechanism, requestId })`); `RootErrorBoundaryFallback` recibe
  `supportCode` y renderiza `SupportCodeRow`. Cubre: R5.1, R5.2, R5.3, R5.4.
- [x] **T18** — `SyncRechazoSheet` (`RechazoRow`): renderizar `SupportCodeRow` con `supportCode={rejection.id}`.
  Cubre: R5.5, R5.7, R5.8.

## Fase E — Tests

### Cliente / EF (sin deploy)

- [x] **T19** — Test unit `request-id`: `newRequestId()` devuelve uuid v4 válido y distinto en llamadas
  sucesivas. Cubre: R1.1, R1.2.
- [x] **T20** — Guard del no-leak de `serveEf` en `_shared/serve-log.test.ts` (node:test, 7 tests, falsificado
  con mutante): `buildEfIn` NO expone body/Authorization/token/JWT (solo `bodyBytes` + `sub`), `buildEfOut`
  solo `error.code` en status>=400 (nunca message/body, `res.clone()` no consume), `readSubBestEffort` tolera
  ausente/basura. **Nota:** las ramas de resolución del requestId (header válido/ausente/basura) viven en el
  `Deno.serve` de `serve.ts` (no extraíble a puro) → cubiertas por el runtime (deploy). Cubre: R2.6, R2.7,
  R2.8, R2.9.
- [~] **T21** — `createAdminClient(requestId)` setea el header global. **Cubierto por typecheck** (firma) +
  revisión estática; un unit puro es inviable sin stub de `Deno.env`/mock de `createClient` (Deno no está en
  el entorno). Falsable en runtime al deployar. Cubre: R2.12.
- [~] **T22** — Contrato de EFs migradas sin cambio. **Cubierto por verificación estructural** (grep del leader
  + reviewer: 9/9 con serveEf, guards/requireUser/respuestas preservados) + typecheck; el test runnable de
  contrato requiere deploy (ver T29). Cubre: R2.11.
- [x] **T23** — Test unit `payloads.test.ts` (extensión): `buildUploadRejectedPayload` incluye `id` y sigue SIN
  `opData` ni claves extra del CrudEntry (mutante: agregar opData → rojo). Cubre: R4.3, R5.6.
- [x] **T24** — Guard del tag de correlación en `payloads.test.ts` (3 tests, falsificado): `buildCaptureTags`
  pone `request_id` con el valor del requestId por-captura (una captura sin requestId no hereda el de otra;
  omite claves ausentes). **Nota:** el prop `request_id` de PostHog (R4.2) lo arma el call-site inline en
  `.tsx` → cubierto por typecheck + E2E (no unit puro sin mock del SDK). Cubre: R4.1, R4.4, R6.1.

### UI (E2E + capturas, Gate 2.5)

- [x] **T25** — E2E/component: fallback de crash muestra "Código de soporte: XXXX" y Copiar dispara el
  clipboard (o degrada sin romper). Cubre: R5.3, R5.4, R5.9.
- [x] **T26** — E2E: `SyncRechazoSheet` (vía el inyector de rechazo E2E ya existente) muestra el código de
  soporte con el `id` de la op + Copiar. Cubre: R5.5, R5.7.
- [x] **T27** — Gate 2.5 capturas (veto visual): (a) fallback de crash con código + Copiar; (b)
  `SyncRechazoSheet` con código + Copiar. Vetar con título con descendentes ("Algo salió mal" /
  "…no se sincronizaron") y básicos de UX de manga (no recorte, sheet header-fijo/body-scroll/footer-fijo,
  targets grandes). Cubre: R5.10.
- [~] **T28** — Suite E2E completa corrida (2026-08-15): **301 passed / 7 failed / 1 skipped**. Los 5 rojos EF
  (`account`×2, `invitations`×3) = **CORS-skew PROBADO** (experimento: con el header del cliente OFF pasan
  7/7) → se resuelven al **deployar las funciones con el `cors.ts` nuevo** (deploy-ordering, ver design §CORS).
  Los 2 restantes (`maniobra-single-active`, `animals` cría → register_birth/outbox) = flakes de estado de
  servidor AJENOS a la feature (no pasan por `functions.invoke`; con la re-corrida pasan). Re-correr la suite
  POST-DEPLOY para el verde total. Cubre: R6.4.

### DB-dependientes (PENDIENTES del deploy gateado)

- [x] **T29** ✅[post-deploy: 306 E2E + writes user_roles OK] — Suite audit (spec 18 / user_roles): re-correr TODAS las suites que tocan el trigger
  re-creado; verde tras 0131. Cubre: R3.9, R6.4.
- [x] **T30** ✅[uuids reales en audit.record_version; NULL en writes sin header] — Test de integración request_id: un write de `user_roles` vía EF con header
  `X-Rafaq-Request-Id` deja ese uuid en `audit.record_version.request_id`; un write sin header deja NULL.
  Cubre: R3.7, R3.8, R3.10, R3.11.
- [x] **T31** ✅[anti-spoof en vivo: writes directos admin sin header → NULL] — Test anti-spoof: un write directo con JWT de usuario (no service_role) que manda el
  header NO inyecta `request_id` (queda NULL); header con forma inválida bajo service_role → NULL. Cubre:
  R3.4, R3.5.
- [x] **T32** ✅[authenticated/anon no ejecutan resolve_request_id] — Test grants: `audit.resolve_request_id()` no es EXECUTE-able por anon/authenticated/
  public; muro de lectura de audit intacto. Cubre: R3.12, R3.13.

## Fase F — Reconciliación

- [x] **T33** — Reconciliar specs al as-built. **Hecho:** `design.md` actualizado (split `serve.ts`/`serve-log.ts`
  + builder puro `buildCaptureTags`); `tasks.md` reconciliada (este archivo); `requirements.md` sin cambio de
  EARS (las extracciones son detalle de implementación previsto por R4.3). Mapa R→archivo en los progress notes.
- [x] **T34** — Al cerrar: pasar la feature 23 a `done` (solo el leader, tras Puerta 2) y re-subir la 17 a
  `in_progress` si corresponde.

---

## Trazabilidad R → task

| R | tasks |
|---|---|
| R1.1 | T11, T19 |
| R1.2 | T11, T19 |
| R1.3 | T12 |
| R1.4 | T12 |
| R1.5 | T11 |
| R2.1 | T7 |
| R2.2 | T7, T20 |
| R2.3 | T7, T20 |
| R2.4 | T7, T20 |
| R2.5 | T7, T9 |
| R2.6 | T7, T20 |
| R2.7 | T7, T20 |
| R2.8 | T7, T20 |
| R2.9 | T7, T20 |
| R2.10 | T9, T10 |
| R2.11 | T9, T10, T22 |
| R2.12 | T6, T21 |
| R2.13 | T8 |
| R3.1 | T1 |
| R3.2 | T1 |
| R3.3 | T2 |
| R3.4 | T2, T31 |
| R3.5 | T2, T31 |
| R3.6 | T2 |
| R3.7 | T3, T30 |
| R3.8 | T3, T30 |
| R3.9 | T3, T29 |
| R3.10 | T9, T30 |
| R3.11 | T1, T30 |
| R3.12 | T4, T5, T32 |
| R3.13 | T4, T5, T32 |
| R4.1 | T14, T24 |
| R4.2 | T15, T24 |
| R4.3 | T13, T23 |
| R4.4 | T14, T24 |
| R5.1 | T17 |
| R5.2 | T14, T17 |
| R5.3 | T17, T25 |
| R5.4 | T16, T17, T25 |
| R5.5 | T18, T26 |
| R5.6 | T13, T14, T23 |
| R5.7 | T18, T26 |
| R5.8 | T16, T17, T18 |
| R5.9 | T16, T25 |
| R5.10 | T16, T27 |
| R6.1 | T14, T24 |
| R6.2 | T15, T24 |
| R6.3 | T14, T15 |
| R6.4 | T28, T29 |
