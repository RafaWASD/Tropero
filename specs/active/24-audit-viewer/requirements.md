# Requirements — 24 · Visor web interno del audit log (staff miTropero)

> EARS estricto (`docs/specs.md`). Fuente de verdad: `context.md` (Gate 0, aprobado por Raf 2026-08-15).
> Idioma de identificadores: inglés. Prosa: es-AR.
>
> **Naming (rebrand):** todo identificador NUEVO nace `miTropero`/`mitropero` (secret
> `MITROPERO_STAFF_USER_IDS`, EF `audit_query`). Lo único "mitropero" tolerado es lo REUTILIZADO ya deployado:
> el wrapper `serveEf` sigue mandando `X-Rafaq-Request-Id` (deuda de rebrand, spec 23) — NO se duplica ni
> se renombra acá. Ver `docs/rebrand-mitropero-plan.md`.
>
> Trazabilidad: cada decisión cerrada del `context.md` y cada criterio del `acceptance` quedan cubiertos por
> ≥1 `R<n>` (mapa al final). Cada `R<n>` es verificable por ≥1 test; los DB/deploy-dependientes quedan
> pendientes del deploy gateado (ver `tasks.md`).

## Glosario

- **staff** — círculo de confianza de miTropero (Raf + Facundo). Ven **TODO** el audit (cross-tenant).
- **EF** — Edge Function de Supabase. La nueva es `audit_query`.
- **audit** — schema `audit.record_version` (spec 18 + `request_id` de spec 23). Fail-closed: anon/authenticated
  no tienen `USAGE` del schema ni `SELECT` de la tabla; **NO está expuesto a PostgREST** (`config.toml`
  `schemas = [public, graphql_public]`).
- **actor** — el `auth_uid` de una fila de audit (uuid del usuario que hizo el write), resuelto a un label
  humano (nombre + email) para lectura.
- **tabla trackeada** — tabla con el trigger de audit prendido. Hoy: solo `public.user_roles`.
- **allowlist de staff** — el EF secret `MITROPERO_STAFF_USER_IDS`: uuids separados por coma, parseado
  server-side. Raf lo setea con su `user_id` + el de Facundo.

---

## US1 — Gate de staff: solo la allowlist entra, todo lo demás rebota

> Como miTropero, quiero que solo el staff autenticado (en la allowlist server-side) pueda consultar el
> forense, para que ni un usuario autenticado cualquiera ni un anónimo lo alcancen.

- **R1.1** — El sistema deberá exponer una Edge Function nueva `audit_query` en
  `supabase/functions/audit_query/`, montada con el wrapper `serveEf` (spec 23).
- **R1.2** — Cuando la EF recibe un request con método distinto de `POST`, el sistema deberá responder `405`
  con código `method_not_allowed`.
- **R1.3** — Cuando la EF recibe un request, el sistema deberá resolver el usuario con `requireUser` sobre el
  JWT del header `Authorization`; si no hay sesión válida, deberá responder `401` con código `unauthorized`.
- **R1.4** — El sistema deberá derivar la allowlist de staff exclusivamente del EF secret
  `MITROPERO_STAFF_USER_IDS` (uuids separados por coma), parseada server-side.
- **R1.5** — Si el `user.id` del JWT validado no pertenece a la allowlist, entonces el sistema deberá
  responder `403` con código `not_staff` y no ejecutar ninguna lectura del audit.
- **R1.6** — El sistema no deberá determinar la pertenencia a staff a partir del body ni de headers del
  cliente; solo del `user.id` del JWT validado contra el secret.
- **R1.7** — Si el secret `MITROPERO_STAFF_USER_IDS` está ausente o vacío, entonces el sistema deberá tratar
  la allowlist como vacía (nadie es staff → `403`), nunca abrir el acceso.

---

## US2 — Filtros validados server-side (autoritativo), fuera de la URL

> Como staff, quiero filtrar por fecha, usuario, campo, operationId, tabla y operación, y que la validación
> sea del lado servidor, para no poder inyectar nada ni sacar tablas no previstas.

- **R2.1** — El sistema deberá recibir todos los filtros en el body JSON del `POST` (no en la query string de
  la URL), de modo que ningún identificador ni PII viaje en la URL.
- **R2.2** — Donde el body traiga `from` y/o `to`, el sistema deberá parsearlos como timestamps ISO y filtrar
  el rango de `ts`; si alguno no parsea a fecha válida, deberá responder `400` con código `invalid_filter`.
- **R2.3** — Donde el body traiga `auth_uid`, el sistema deberá validarlo contra la regex de uuid antes de
  usarlo; si no tiene forma de uuid, deberá responder `400` con código `invalid_filter`.
- **R2.4** — Donde el body traiga `establishment_id`, el sistema deberá validarlo como uuid y filtrar por
  `coalesce(record, old_record)->>'establishment_id'` igual a ese valor (cubre también los DELETE, donde
  `record` es NULL — hardening §8 LOW-1 del design).
- **R2.5** — Donde el body traiga `request_id`, el sistema deberá validarlo como uuid y filtrar por la columna
  `request_id`.
- **R2.6** — Donde el body traiga `table_name`, el sistema deberá aceptarlo solo si pertenece a la allowlist de
  tablas trackeadas; fuera de la allowlist deberá responder `400` con código `invalid_filter`.
- **R2.7** — Donde el body traiga `op`, el sistema deberá aceptarlo solo si es uno de `INSERT`, `UPDATE`,
  `DELETE`; cualquier otro valor deberá responder `400` con código `invalid_filter`.
- **R2.8** — El sistema deberá combinar los filtros presentes con `AND`, e ignorar los ausentes (sin filtrar
  por ellos).
- **R2.9** — El sistema no deberá construir la consulta SQL concatenando input crudo; todo valor de filtro
  deberá ir como parámetro ligado (o como constante server-side derivada de una allowlist).

---

## US3 — Paginación estable, cap duro y rate limit

> Como staff, quiero paginar resultados con un límite acotado y que la EF resista scraping accidental.

- **R3.1** — El sistema deberá ordenar los resultados por `id` DESC (proxy estable de `ts` DESC para una tabla
  append-only).
- **R3.2** — El sistema deberá aplicar un cap duro de `100` al `limit`: un `limit` ausente usa el default
  (`50`); un `limit` mayor a `100` se recorta a `100`; un `limit` no entero o ≤0 se trata como default.
- **R3.3** — Donde el body traiga `before` (un `id`), el sistema deberá devolver solo filas con `id` menor a
  ese cursor (paginación hacia atrás en el tiempo).
- **R3.4** — Cuando devuelve una página completa (hay potencialmente más filas), el sistema deberá incluir un
  `next_cursor` (el `id` de la última fila); cuando no hay más, deberá devolver `next_cursor` en `null`.
- **R3.5** — Cuando un mismo `user.id` de staff excede el límite de requests por ventana, el sistema deberá
  responder `429` con código `rate_limited`.
- **R3.6** — El sistema deberá devolver el `id` de cada fila como string (el `id` es `bigint`, fuera del rango
  seguro de `number` en JS).

---

## US4 — Lectura scopeada que preserva el muro fail-closed

> Como miTropero, quiero que la EF sea la ÚNICA puerta de lectura del audit y que el muro de spec 18 quede
> intacto: el cliente jamás toca `audit.record_version`.

- **R4.1** — El sistema deberá leer `audit.record_version` mediante una conexión directa a Postgres
  (credencial `SUPABASE_DB_URL` server-side), **no** vía PostgREST/supabase-js, porque el schema `audit` no
  está expuesto a la API.
- **R4.2** — El sistema no deberá enviar credenciales de base ni de service_role al cliente; la conexión y las
  credenciales viven solo dentro de la EF.
- **R4.3** — El sistema no deberá modificar los grants ni el muro fail-closed de spec 18: anon/authenticated
  siguen sin `USAGE`/`SELECT` sobre `audit` (verificable por `git diff` sin cambios en grants).
- **R4.4** — El sistema no deberá introducir ninguna migración nueva; la feature solo LEE la tabla existente.
- **R4.5** — El sistema deberá devolver, por fila, al menos: `id`, `record_id`, `op`, `ts`, `auth_uid`,
  `request_id`, `table_name`, `record`, `old_record`.
- **R4.6** — El sistema deberá permitir al staff ver el audit completo cross-tenant (sin scoping automático por
  `establishment_id`), salvo cuando el filtro `establishment_id` esté presente.

---

## US5 — Resolución legible para no-técnicos

> Como Facundo (no-técnico), quiero ver "quién hizo qué" con nombres y campos legibles, no uuids ni JSON crudo.

- **R5.1** — El sistema deberá resolver, para las filas devueltas, cada `auth_uid` a un actor legible
  (`name` + `email`) vía lookup a `public.users` + `public.user_private` con la conexión server-side, en
  batch (una lectura por página, sin N+1).
- **R5.2** — Si un `auth_uid` es `null` o no resuelve a un usuario existente, entonces el sistema deberá
  devolver el actor en `null` (la web muestra el uuid crudo o un guion), sin romper la fila.
- **R5.3** — El sistema deberá adjuntar por fila un `table_label` es-AR derivado de `table_name` (mapa fijo;
  `user_roles` → "Roles de miembro").
- **R5.4** — La página web deberá renderizar el diff entre `record` y `old_record` como una lista de campos
  cambiados (antes → después) legible, no como JSON crudo.
- **R5.5** — La página web deberá usar labels es-AR para los campos del diff y resaltar visualmente los campos
  que cambiaron.

---

## US6 — Página web interna en Cloudflare

> Como staff, quiero una web liviana para loguearme y navegar el audit con filtros, en es-AR, hosteada donde
> vive la landing (Cloudflare).

- **R6.1** — El sistema deberá proveer una página estática (HTML + JS, sin SPA pesada) versionada en el repo
  en `docs/internal/audit-viewer/`.
- **R6.2** — La página deberá autenticar con Supabase (supabase-js por CDN, email/password) y guardar el JWT
  en memoria de la pestaña, no en `localStorage` persistente.
- **R6.3** — La página deberá ofrecer un formulario de filtros: fecha (from/to), usuario (`auth_uid`), campo
  (`establishment_id`), operationId (`request_id`), tabla (`table_name`) y operación (`op`).
- **R6.4** — La página deberá invocar la EF `audit_query` por `fetch` con `Authorization: Bearer <JWT>` y los
  filtros en el body del `POST` (nunca en la URL).
- **R6.5** — La página deberá mostrar una tabla de resultados con, por fila: actor legible, tabla (label),
  fecha (es-AR), `request_id`, operación.
- **R6.6** — La página deberá permitir expandir cada fila para ver el antes/después (diff de R5.4).
- **R6.7** — La página deberá paginar usando el `next_cursor` devuelto por la EF (botón "Ver más").
- **R6.8** — La página deberá formatear las fechas en es-AR (dd/mm/aaaa hh:mm).
- **R6.9** — Cuando la EF responde `403 not_staff`, la página deberá mostrar un mensaje de "sin acceso" y no
  exponer ningún dato del audit.
- **R6.10** — La página deberá servirse por HTTPS desde Cloudflare y declararse `noindex, nofollow`.
- **R6.11** — La página no deberá contener secretos: solo la URL pública del proyecto Supabase y la anon key
  (pública por diseño).

---

## US7 — Seguridad transversal: no-leak, PII documentada, errores opacos

> Como auditor de seguridad, quiero que la EF no filtre datos por logs ni por mensajes de error, y que la
> exposición de PII quede acotada a staff y documentada.

- **R7.1** — El sistema no deberá loguear el body del request ni el JWT (garantía de `serveEf`, que no debe
  romperse en esta EF).
- **R7.2** — Si ocurre un error 5xx, entonces el sistema deberá responder con copy genérico (`serverError`),
  sin el `message` del driver de Postgres (no filtrar schema/tabla/columna).
- **R7.3** — El sistema no deberá loguear `record`/`old_record` ni el actor resuelto (email) en los logs de la
  EF.
- **R7.4** — El sistema deberá exponer `record`/`old_record` y el email del actor solo a staff autenticado y
  gateado; esta exposición de PII a staff es aceptable (círculo de confianza) y queda documentada en el
  `design.md`.
- **R7.5** — El sistema deberá acotar el scraping mediante el cap de `100` filas por página (R3.2) y el rate
  limit (R3.5).

---

## Fuera de alcance (diferido — del `context.md`)

- Acceso per-tenant (owners viendo su propio audit) — descartado por decisión.
- Prender el audit sobre `animals`/eventos (gate T12 de spec 18) — cuando pase, el visor los muestra sin
  cambios (ya filtra por `table_name` genérico y la allowlist de tablas se amplía en un cambio menor).
- Export a CSV / alertas — v2 si hace falta.
- Renombrar el header `X-Rafaq-Request-Id` — es deuda de rebrand global (fase D del plan), no de esta feature.

---

## Mapa de trazabilidad (context.md / acceptance → R)

| Origen (context.md / acceptance) | Requirements |
|---|---|
| Audiencia = staff, ven TODO cross-tenant | R1.4, R1.5, R4.6 |
| Superficie = web interno Cloudflare | R6.1, R6.10 |
| EF `audit_query` con `serveEf` | R1.1 |
| Allowlist EF secret + 403 `not_staff` | R1.4, R1.5, R1.6, R1.7 |
| Filtros (from/to, auth_uid, establishment_id, request_id, table_name, op) | R2.2–R2.7 |
| Validación autoritativa server-side | R2.2–R2.9 |
| Paginación limit cap 100 + cursor id DESC + orden ts DESC | R3.1, R3.2, R3.3, R3.4 |
| Rate limit | R3.5, R7.5 |
| Devuelve columnas forenses incl. record/old_record | R4.5 |
| Muro fail-closed preservado / EF única puerta | R4.1, R4.2, R4.3 |
| Sin migración | R4.4 |
| Resolución de actor + labels + diff legible | R5.1–R5.5 |
| No-leak en logs / PII a staff documentada / errores opacos | R7.1–R7.4 |
| Login Supabase + JWT en memoria + sin secretos cliente | R6.2, R6.11 |
| acceptance #1 (staff ve, no-staff 403) | R1.3, R1.5, R6.9 |
| acceptance #2 (filtros validados server-side) | R2.1–R2.9 |
| acceptance #3 (fila: op+ts+actor+tabla+request_id+antes/después) | R4.5, R5.1, R5.3, R5.4, R6.5, R6.6 |
| acceptance #4 (cliente nunca lee audit directo, muro intacto) | R4.1, R4.3 |
| acceptance #5 (paginado + rate limit; sin PII en la URL) | R2.1, R3.2, R3.5 |
