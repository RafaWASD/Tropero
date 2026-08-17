# Requirements — 23 · request_id / operationId end-to-end

> EARS estricto (docs/specs.md). Fuente de verdad: `context.md` (Gate 0, 2026-08-14).
> Idioma de identificadores: inglés. Prosa: es-AR.
>
> Trazabilidad hacia el context.md: cada decisión cerrada D1–D6 y cada edge case queda cubierto por
> ≥1 `R<n>` (ver mapa al final). Cada `R<n>` es verificable por ≥1 test (los DB-dependientes quedan
> pendientes del deploy gateado — ver `tasks.md`).

## Glosario

- **requestId** — uuid v4 random, **sin significado** (no deriva de datos de usuario → no-PII). Identifica
  UNA acción de usuario para correlacionarla cruzando fronteras (cliente → EF → audit → Sentry/PostHog).
- **Header de correlación** — `X-Mitropero-Request-Id`. Análogo a `X-Mitropero-Actor` (spec 18).
- **EF** — Edge Function de Supabase. Hay 9 hoy.
- **Tabla auditada** — tabla con trigger `audit_i_u_d` prendido. Hoy: solo `public.user_roles`.

---

## US1 — El cliente genera un requestId por acción y lo propaga a las Edge Functions

> Como sistema, para poder reconstruir una acción de punta a punta, cada llamada a una EF debe llevar un
> identificador de correlación generado en el cliente.

- **R1.1** — Cuando el cliente va a invocar una Edge Function, el sistema deberá generar un `requestId`
  (uuid v4) para esa acción.
- **R1.2** — El `requestId` deberá ser un uuid v4 random sin significado derivado de datos de usuario (no-PII).
- **R1.3** — Cuando el cliente invoca una Edge Function, el sistema deberá enviar el `requestId` en el header
  `X-Mitropero-Request-Id` de esa llamada.
- **R1.4** — El sistema deberá agregar el header `X-Mitropero-Request-Id` en los tres call-sites de EFs del
  cliente: el hub genérico `invokeFn` (`app/src/services/members.ts`), `deleteAccount`
  (`app/src/services/account.ts`) y `registerPushTokenBestEffort` (`app/src/services/push-notifications.ts`).
- **R1.5** — El sistema deberá exponer una única función utilitaria que produzca el `requestId`, de modo que
  los tres call-sites la reusen (sin duplicar la generación).

---

## US2 — Wrapper de Edge Functions: correlación + logging estructurado

> Como operador de soporte, quiero que cada llamada a una EF quede logueada con su requestId, status y
> duración (sin el body), y que ese requestId llegue al trigger de audit, para poder seguir la cadena.

- **R2.1** — El sistema deberá proveer un wrapper en `supabase/functions/_shared/` que envuelva `Deno.serve`
  para las Edge Functions.
- **R2.2** — Cuando un request trae el header `X-Mitropero-Request-Id` con forma de uuid válido, el wrapper deberá
  usar ese valor como `requestId` de la llamada.
- **R2.3** — Si un request no trae el header `X-Mitropero-Request-Id` (app vieja), entonces el wrapper deberá
  generar un `requestId` server-side para no perder la traza.
- **R2.4** — Si el header `X-Mitropero-Request-Id` entrante no tiene forma de uuid válido, entonces el wrapper
  deberá tratarlo como ausente y generar un `requestId` server-side (evita valores basura / log-injection).
- **R2.5** — El wrapper deberá exponer el `requestId` al handler (vía un segundo argumento de contexto) para
  que el handler lo pase a `createAdminClient(actorId, requestId)` cuando escribe una tabla auditada.
- **R2.6** — Cuando el wrapper recibe un request, deberá emitir UNA línea JSON de ENTRADA vía
  `console.log(JSON.stringify(...))` con, como mínimo, `requestId`, la función `fn`, el tamaño del body en
  bytes `bodyBytes`, y el actor (`actor`) cuando sea resoluble.
- **R2.7** — Cuando el handler responde, el wrapper deberá emitir UNA línea JSON de SALIDA vía
  `console.log(JSON.stringify(...))` con, como mínimo, `requestId`, `status`, la duración en ms, y el `code`
  de error cuando la respuesta no sea 2xx.
- **R2.8** — El wrapper no deberá loguear el body del request ni el body de la respuesta; del body solo deberá
  loguear su tamaño en bytes.
- **R2.9** — El wrapper no deberá loguear el header `Authorization`, el JWT crudo, ni ningún otro token o
  credencial.
- **R2.10** — Las nueve Edge Functions (`invite_user`, `accept_invitation`, `change_member_role`,
  `remove_member`, `cancel_invitation`, `resend_invitation`, `delete_account`, `register_push_token`,
  `health`) deberán migrar al wrapper.
- **R2.11** — La migración de cada EF al wrapper no deberá cambiar su contrato observable (método, status
  codes, `code` de error, shape del body de respuesta).
- **R2.12** — `createAdminClient` deberá aceptar un segundo parámetro opcional `requestId` y, cuando se pasa,
  setear el header global `X-Mitropero-Request-Id` en el admin client. Sin `requestId`, el comportamiento deberá
  ser idéntico al actual (cambio aditivo).
- **R2.13** — El header `X-Mitropero-Request-Id` deberá estar permitido por la política CORS de las EFs
  (`Access-Control-Allow-Headers`) para que el preflight del navegador no lo bloquee.

> **RECONCILIACIÓN (rebrand fase 5, 2026-08-17, migración `0133`) — aplica a R1.4, R2.2, R2.3, R2.4, R2.12,
> R2.13 y R3.3.**
> El header se llamaba **`X-Rafaq-Request-Id`** cuando se escribió esta spec; hoy se llama
> **`X-Mitropero-Request-Id`** y el literal quedó actualizado arriba. Lo que estos EARS **no dicen y es
> parte del as-built**:
> - **El rename se hizo en DOS TIEMPOS y el servidor acepta los DOS nombres**, en las dos capas y con el
>   mismo criterio (gana el nuevo; se cae al viejo si el nuevo falta o no es un uuid). Son **dos
>   tolerancias distintas** y conviene no confundirlas:
>   - **`readRequestIdHeader` (`_shared/request-headers.ts`, que usa `serveEf`)** es la que le sirve a las
>     **builds ya instaladas**: hay TestFlight + el APK de los testers y **no hay OTA**, así que su header
>     no cambia nunca. Ese cliente le habla a una EF por HTTP; la EF lo atrapa ahí y el admin client
>     re-emite el id ya con el nombre NUEVO hacia PostgREST.
>   - **`audit.resolve_request_id()`** cubre a quien le manda el nombre viejo **directo a PostgREST**: la
>     ventana entre aplicar la migración y redeployar las EFs, un redeploy parcial o un rollback.
>   Con corte seco (cualquiera de las dos), el `request_id` entraría **NULL** o con un uuid generado
>   server-side que no es el del evento de dominio: la correlación se pierde **en silencio**, el peor modo
>   de falla de esta feature. La limpieza del fallback tiene su propia entrada, con condición, en
>   `docs/backlog.md`.
> - **R2.3 se cumple igual y por dos caminos ahora**: una app vieja que manda el nombre viejo YA NO cae en
>   "no trae el header" — su id se respeta. El wrapper genera uno server-side sólo si no vino ninguno.
> - **R2.13 se cumple por DERIVACIÓN, no por un literal**: `cors.ts` arma el `Access-Control-Allow-Headers`
>   a partir de la misma lista que recorre el lector (`ACCEPTED_REQUEST_ID_HEADERS`) → publica los dos
>   nombres y no puede desalinearse del lector. Verificado sobre el preflight real de DEV.
> - **R3.5 (anti-spoof) sigue intacta**: el fallback vive DENTRO del gate de `service_role`. Verificado por
>   TA.21 de la suite `audit`, que forja las **dos** grafías desde un `authenticated`.
> - **Cobertura nueva**: la suite `audit` sumó TA.18 (nombre nuevo → `request_id` aterriza), TA.19 (nombre
>   VIEJO → aterriza igual) y TA.20 (sin header → NULL). Antes de esta fase, R3.7/R3.8 no tenían **ningún**
>   test backend que ejerciera el header de correlación contra la base.
> - La migración `0131` **no se editó** (append-only): el literal viejo que se lee ahí es historia.

---

## US3 — Base: columna request_id en audit, resuelta bajo service_role

> Como auditor, quiero que la fila de audit de un write hecho por una EF lleve el requestId de esa llamada,
> para cruzar "qué cambió / quién" con "qué llamada lo originó" — sin poder ser spoofeado por un cliente.

- **R3.1** — La migración deberá agregar una columna `request_id uuid` **NULLABLE** a `audit.record_version`.
- **R3.2** — La migración deberá crear un índice parcial sobre `request_id` con `where request_id is not null`.
- **R3.3** — El sistema deberá proveer una función `audit.resolve_request_id()` que lea el header
  `x-mitropero-request-id` del GUC `request.headers` **solo** cuando el rol de sesión (`request.jwt.claims->>'role'`)
  es `service_role`.
- **R3.4** — `audit.resolve_request_id()` deberá validar que el valor del header tenga forma de uuid antes de
  castear; si no la tiene, deberá devolver NULL.
- **R3.5** — Si el rol de sesión no es `service_role`, entonces `audit.resolve_request_id()` deberá devolver
  NULL (un write con JWT de usuario / PowerSync no puede inyectar `request_id`).
- **R3.6** — `audit.resolve_request_id()` deberá ser TOTAL: ante cualquier fallo (claim/header no-JSON, cast
  inválido) deberá devolver NULL sin lanzar, para nunca trabar el write en el hot path.
- **R3.7** — Cuando el trigger de audit inserta una fila en modo `best_effort`, deberá setear
  `request_id = audit.resolve_request_id()`.
- **R3.8** — Cuando el trigger de audit inserta una fila en modo `strict`, deberá setear
  `request_id = audit.resolve_request_id()`.
- **R3.9** — El re-CREATE de `audit.insert_update_delete_trigger()` deberá preservar el comportamiento vigente
  (record_id estable, actor, ambos modos de falla, `return coalesce(new, old)`) sin más cambio que el agregado
  de `request_id`.
- **R3.10** — Cuando una EF que escribe `user_roles` (`change_member_role`, `accept_invitation`,
  `remove_member`) propaga un `requestId`, el sistema deberá persistir ese `requestId` en la columna
  `request_id` de las filas de `audit.record_version` que esa llamada generó.
- **R3.11** — La migración deberá ser aditiva: un write existente que no trae `requestId` (JWT de usuario,
  PowerSync, o EF sin requestId) deberá seguir funcionando con `request_id = NULL`.
- **R3.12** — La migración deberá revocar `EXECUTE` de `audit.resolve_request_id()` a `public`, `anon` y
  `authenticated`, y el smoke-check de grants deberá abortar la migración si esa función quedara EXECUTE-able
  por un rol cliente.
- **R3.13** — La migración deberá preservar el muro fail-closed de audit (revokes de USAGE/EXECUTE + muro de
  lectura de `anon`/`authenticated`).

---

## US4 — Observabilidad cliente: requestId como tag/prop

> Como operador de soporte, quiero que un error o evento de cliente lleve el requestId de su acción, para
> encontrarlo en Sentry/PostHog a partir del mismo id.

- **R4.1** — Cuando el cliente invoca una Edge Function dentro de una acción con `requestId`, el sistema
  deberá adjuntar ese `requestId` como tag `request_id` en Sentry.
- **R4.2** — El sistema deberá incluir el `requestId` como prop `request_id` en el evento de dominio de
  PostHog de esa acción.
- **R4.3** — Los builders puros de `payloads.ts` que producen las formas outbound deberán incluir el
  `request_id` sin agregar PII.
- **R4.4** — El sistema deberá adjuntar el `requestId` de una acción con scope acotado a esa acción, de modo
  que no se filtre a eventos de otras acciones (sin `setTag` global persistente).

---

## US5 — Superficie UI "código de soporte" copiable

> Como operario en la manga, cuando algo sale mal quiero un código corto que le pueda dar a soporte de un
> tap, para que puedan encontrar mi caso.

### Fallback de crash (`RootErrorBoundary`)

- **R5.1** — Cuando `RootErrorBoundary` captura un error (`componentDidCatch`), el sistema deberá generar un
  `requestId` para ese crash.
- **R5.2** — Cuando `RootErrorBoundary` captura un error, el sistema deberá adjuntar ese `requestId` como tag
  `request_id` en el reporte de Sentry del crash (junto al `mechanism`).
- **R5.3** — Mientras se muestra el fallback de crash, el sistema deberá mostrar una línea "Código de soporte:
  XXXX" con el `requestId` del crash.
- **R5.4** — El fallback de crash deberá ofrecer una acción "Copiar" que copie el código de soporte al
  portapapeles en un tap.

### Surfacing de rechazo de manga (`SyncRechazoSheet` / banner)

- **R5.5** — El sistema deberá usar el `id` de la `UploadRejection` (el id de la op rechazada, ya presente en
  el store) como código de soporte mostrado en el surfacing de rechazo de manga.
- **R5.6** — El sistema deberá incluir ese `id` en el evento `upload_rejected` de Sentry (extendiendo
  `buildUploadRejectedPayload`), sin agregar `opData` ni PII, para que el código mostrado sea findable en
  Sentry.
- **R5.7** — Mientras se muestra un rechazo de manga en el sheet, el sistema deberá mostrar una línea "Código
  de soporte: XXXX" con el `id` de ese rechazo, y una acción "Copiar" que lo copie en un tap.

### Presentación unificada

- **R5.8** — La presentación del código de soporte ("Código de soporte:" + valor + acción Copiar) deberá ser
  uniforme entre superficies, aunque la fuente del id difiera (requestId del crash vs `id` de la op).
- **R5.9** — Si el mecanismo de portapapeles no está disponible, entonces la acción Copiar deberá degradar sin
  romper (best-effort, no propaga error) y el código deberá seguir visible para leerse a mano.
- **R5.10** — Todo texto del código de soporte y todo título con descendentes de estas superficies deberá
  llevar `lineHeight` matcheando su `fontSize` (regla de recorte de descendentes del repo). Verificable por
  captura de Gate 2.5.

---

## US6 — No-op en web/E2E y sin regresión

> El wiring nuevo debe respetar el platform-split y el fail-closed de observabilidad ya existentes.

- **R6.1** — Mientras no haya DSN de Sentry o la app corra en E2E, el wiring de `request_id` en Sentry deberá
  permanecer no-op (doble guarda ya existente en `initSentry`).
- **R6.2** — Mientras no haya key de PostHog o la app corra en E2E, el wiring de `request_id` en PostHog deberá
  permanecer no-op (client `disabled`).
- **R6.3** — El wiring nuevo deberá respetar el platform-split: la base web/no-op no deberá importar el SDK de
  observabilidad; solo la variante `.native` implementa el envío real.
- **R6.4** — El agregado de correlación no deberá introducir regresiones en la suite E2E ni en las suites de
  audit (spec 18 / `user_roles`) que tocan el trigger re-creado.

---

## Mapa de cobertura context.md → requirements

| context.md | requirements |
|---|---|
| D1 (requestId = uuid v4 sin significado, no-PII) | R1.2, R4.3 |
| D2 (wrapper envuelve las 9 EFs; solo user_roles aterriza en audit) | R2.10, R3.10 |
| D3 (`createAdminClient(actorId?, requestId?)` aditivo) | R2.12 |
| D4 (columna nullable + índice parcial) | R3.1, R3.2, R3.11 |
| D5 (sink = console.log JSON, nunca body, solo tamaño) | R2.6, R2.7, R2.8 |
| D6 (`resolve_request_id()` TOTAL, nunca lanza) | R3.6 |
| Edge: app vieja sin header → EF genera server-side | R2.3 |
| Edge: spoofing del header (confía solo bajo service_role) | R2.4, R3.3, R3.5 |
| Edge: tag de Sentry en acción no-EF (scope) | R4.4 |
| Alcance punto 1 (cliente → header) | US1 |
| Alcance punto 2 (wrapper) | US2 |
| Alcance punto 3 (base) | US3 |
| Alcance punto 4 (observabilidad) | US4 |
| Alcance punto 5 (código de soporte UI) | US5 |
| Restricción no-op web/E2E + sin regresión | US6 |

## Mapa de cobertura acceptance (feature_list.json) → requirements

| acceptance | requirements |
|---|---|
| Header X-Mitropero-Request-Id → request_id en audit.record_version (user_roles) | R1.3, R2.5, R3.7, R3.8, R3.10 |
| Wrapper emite dos líneas JSON (entrada/salida) sin body | R2.6, R2.7, R2.8 |
| Mismo requestId como tag en Sentry y prop en PostHog | R4.1, R4.2 |
| Fallback de crash y surfacing de rechazo muestran código de soporte copiable | R5.3, R5.4, R5.7 |
| Migración aditiva no rompe writes; no-op web/E2E sin regresión | R3.11, R6.1, R6.2, R6.4 |

---

## Historial de refinamiento

- 2026-08-14 — Redacción inicial de la spec a partir de `context.md` (Gate 0 auto-aprobado bajo aprobación
  total de Raf). Sin cambios de IDs (primera emisión).
