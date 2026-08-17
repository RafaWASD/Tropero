# Design — 24 · Visor web interno del audit log (staff miTropero)

> Fuente de verdad: `context.md` (Gate 0, 2026-08-15) + `requirements.md`. Reconciliado contra el estado
> real del repo (spec 18/23 deployadas; `serveEf`, `createAdminClient`, `requireUser`, `serverError`
> existentes; schema `audit` NO expuesto a PostgREST).
>
> **Naming:** identificadores nuevos = `miTropero`/`mitropero`. Reutilizado: `serveEf` manda
> `X-Rafaq-Request-Id` (deuda de rebrand — NO se toca acá).
> **[RECONCILIADO 2026-08-17]** La deuda se pagó en la **fase 5 del rebrand** (migración `0133`): hoy
> `serveEf` manda —y lee— `X-Mitropero-Request-Id`, y el servidor acepta ADEMÁS el nombre viejo mientras
> queden builds instaladas sin OTA. `audit_query` no cambió: sigue reutilizando `serveEf` tal cual.

## 0. Resumen de la arquitectura

```
Staff (Raf/Facundo)
  │  login Supabase (email/pass) → JWT en memoria
  ▼
Página estática (Cloudflare)  ── POST fetch, Authorization: Bearer <JWT>, filtros en el body ──▶
  ▼
EF audit_query  (serveEf → logging + requestId; sin loguear body)
  1. método POST                                              → si no, 405
  2. requireUser(JWT) → user.id                               → si no, 401
  3. gate staff: user.id ∈ parse(MITROPERO_STAFF_USER_IDS)    → si no, 403 not_staff
  4. rate limit por user.id                                   → si excede, 429 rate_limited
  5. valida filtros (autoritativo) + cap limit                → si inválido, 400 invalid_filter
  6. SELECT parametrizado sobre audit.record_version          ── conexión DIRECTA a Postgres (SUPABASE_DB_URL)
  7. resuelve auth_uid → actor {name,email} (batch) + table_label
  ▼
{ rows: [...], next_cursor } → render legible en la web
```

**Decisión estructural que gobierna todo el diseño:** el schema `audit` **no está expuesto a PostgREST**
(`config.toml` `schemas = ["public","graphql_public"]`, y la migración 0124 lo deja afuera a propósito). Por
lo tanto la EF **no puede** leer `audit.record_version` con `createAdminClient().from(...)` (daría PGRST106).
La EF lee por **conexión directa a Postgres** con SQL parametrizado (`SUPABASE_DB_URL`, secret auto-inyectado
en las EFs). Esto es lo que permite cumplir R4.4 (sin migración) y R4.1/R4.3 (el muro fail-closed intacto: no
se expone el schema ni se agregan grants — la EF conecta con la credencial de base server-side).

## 1. Archivos a crear / modificar

### Crear
- `supabase/functions/audit_query/index.ts` — la EF (handler con `serveEf`).
- `supabase/functions/audit_query/query.ts` — helpers **puros** (validación de filtros, parse de la
  allowlist, armado del WHERE parametrizado, cap de limit, mapa de labels) para poder falsificarlos bajo
  `node:test` sin Deno-runtime (mismo patrón que `serve-log.ts` de spec 23).
- `supabase/functions/audit_query/db.ts` — apertura de la conexión Postgres directa (driver + credencial),
  aislado para poder mockearlo en los tests de handler.
- `docs/internal/audit-viewer/index.html` — la página web (markup + estilos inline, patrón landing).
- `docs/internal/audit-viewer/app.js` — lógica del cliente (auth supabase-js, fetch a la EF, render, diff,
  paginación, formato es-AR).
- `docs/internal/audit-viewer/_headers` — headers de Cloudflare Pages (noindex, security headers).
- `supabase/tests/audit_query/run.cjs` (o equivalente en la infra de tests existente) — tests de la EF.

### Modificar
- Ninguno de runtime. **Sin migración** (R4.4). `_shared/*` se **reutilizan sin tocar**.
- `feature_list.json` — status `context_ready → spec_ready` (lo hace el leader, no el spec_author en runtime).

> Nota: `_shared/cors.ts` hoy permite `Access-Control-Allow-Origin: *` y `Allow-Methods: POST, OPTIONS`, que
> ya sirve. **No se agrega** ningún header nuevo a la allowlist de CORS (el cliente solo manda
> `authorization`/`content-type`, ya presentes). No se reusa/duplica el header de correlación.
> **[RECONCILIADO 2026-08-17, rebrand fase 5]** la allowlist de CORS ya no se escribe a mano: `cors.ts` la
> DERIVA de `ACCEPTED_REQUEST_ID_HEADERS` (`_shared/request-headers.ts`). Sigue sin agregarse nada por esta
> feature; lo que cambió es de dónde sale la lista.

## 2. Edge Function `audit_query`

### 2.1 Contrato

- **Método:** `POST` (R1.2). Filtros en el body JSON → sin PII en la URL (R2.1).
- **Auth:** `Authorization: Bearer <JWT>` (email/pass de Supabase). `requireUser` (R1.3).

**Body de entrada** (todos los campos opcionales):
```jsonc
{
  "from":            "2026-08-01T00:00:00Z",   // ISO, filtra ts >=
  "to":              "2026-08-16T23:59:59Z",   // ISO, filtra ts <=
  "auth_uid":        "<uuid>",                  // actor
  "establishment_id":"<uuid>",                 // record->>'establishment_id' = ...
  "request_id":      "<uuid>",                  // operationId
  "table_name":      "user_roles",             // allowlist de tablas trackeadas
  "op":              "UPDATE",                  // INSERT | UPDATE | DELETE
  "before":          "12345",                   // cursor: id (string) → filas con id < before
  "limit":           50                         // cap duro 100 (default 50)
}
```

**Respuesta 200:**
```jsonc
{
  "rows": [
    {
      "id": "12345",                 // bigint como string (R3.6)
      "record_id": "<uuid>|null",
      "op": "UPDATE",
      "ts": "2026-08-15T14:03:11.2Z",
      "auth_uid": "<uuid>|null",
      "actor": { "id": "<uuid>", "name": "Facundo", "email": "…@…" } , // o null (R5.2)
      "request_id": "<uuid>|null",
      "table_name": "user_roles",
      "table_label": "Roles de miembro",        // es-AR (R5.3)
      "record": { … } ,                          // jsonb crudo (el diff lo arma la web)
      "old_record": { … }
    }
  ],
  "next_cursor": "12340"              // id de la última fila, o null si no hay más (R3.4)
}
```

**Errores** (forma `{ error: { code, message } }`, vía `jsonError`/`serverError`):

| status | code | cuándo |
|---|---|---|
| 405 | `method_not_allowed` | método ≠ POST (R1.2) |
| 401 | `unauthorized` | JWT ausente/inválido (R1.3) |
| 403 | `not_staff` | user.id ∉ allowlist, o secret vacío (R1.5, R1.7) |
| 429 | `rate_limited` | supera el rate limit por user.id (R3.5) |
| 400 | `invalid_filter` | cualquier filtro mal formado (R2.2–R2.7) |
| 500 | `db_error` / `unexpected` | fallo interno; copy genérico, sin message del driver (R7.2) |

### 2.2 Gate de staff (R1.4–R1.7)

```
STAFF = new Set(
  (Deno.env.get('MITROPERO_STAFF_USER_IDS') ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(s => UUID_RE.test(s))
)
```
- Se parsea **una vez** por invocación (o al top del módulo). Solo se aceptan tokens con forma de uuid
  (basura se descarta → no ensancha la allowlist).
- `STAFF.size === 0` (secret ausente/vacío/basura) ⇒ **nadie es staff** ⇒ `403 not_staff` (R1.7,
  fail-closed). Nunca se abre por defecto.
- `if (!STAFF.has(user.id.toLowerCase())) → 403 not_staff` (R1.5). La pertenencia **nunca** sale del body ni
  de headers (R1.6): `user.id` viene del JWT validado por `requireUser`.

### 2.3 Validación de filtros (autoritativa, R2.x)

Toda en `query.ts` (puro, testeable). Reglas:
- `UUID_RE` (la misma regex que usan `serveEf`/`resolve_actor`) para `auth_uid`, `establishment_id`,
  `request_id`. No matchea → `400 invalid_filter` (R2.3–R2.5).
- `from`/`to`: `new Date(x)`; `Number.isNaN(d.getTime())` → `400` (R2.2). Se comparan como `timestamptz`.
- `TABLE_ALLOWLIST = new Set(['user_roles'])` — hoy la única tabla trackeada. `table_name` fuera de la
  allowlist → `400` (R2.6). Al prender `animals` (gate T12 de spec 18) se agrega acá (cambio de 1 línea +
  su label). La allowlist evita que se pueda "sondear" por otras tablas.
- `OP_ALLOWLIST = new Set(['INSERT','UPDATE','DELETE'])` → fuera → `400` (R2.7).
- `before`: debe ser un entero positivo (string de dígitos) → si viene y no matchea `^\d+$` → `400`.
- `limit`: `clamp(parseInt, 1..100, default 50)` (R3.2). No entero/≤0 → default.

### 2.4 Lectura: conexión directa a Postgres + SQL parametrizado (R2.9, R4.1)

> **Reconciliación as-built (backend, 2026-08-16).** Implementado en `supabase/functions/audit_query/db.ts`
> con `import postgres from 'npm:postgres@3.4.5'` (versión EXACTA, [§8 M3]). Diferencias con el pseudo-SQL de
> abajo, todas por corrección de tipos de Postgres (sin cambiar el contrato):
> - El WHERE se compone con **fragmentos `sql\`…\`` condicionales** que se agregan SOLO si el filtro está
>   presente (`conds.reduce((acc,c) => sql\`${acc} and ${c}\`)`, `sql\`true\`` si no hay ninguno) — no un
>   `(x IS NULL or …)` por columna. Semánticamente equivalente (filtro ausente = no se filtra, R2.8).
> - Casts sobre el **placeholder** (no sobre input): `ts >= ${from}::timestamptz`, `auth_uid = ${uid}::uuid`,
>   `id < ${before}::bigint`. Para el enum: **`op::text = ${op}`** (en vez de `op = $op::audit.operation`) y
>   **`table_name::text = ${table_name}`** — evita nombrar el tipo `audit.operation` y compara text↔text; el
>   valor sigue validado contra la allowlist Y ligado como parámetro.
> - `establishment_id` usa `coalesce(record, old_record)->>'establishment_id' = ${est}` [§8 LOW-1].
> - `id` se selecciona como **`id::text as id`** (string exacto, bigint sin pérdida de precisión, R3.6) y el
>   orden es **`order by record_version.id desc`** (columna QUALIFICADA para ordenar por el bigint real, no
>   por el alias text que ordenaría lexicográficamente). `limit ${limit + 1}` para el cursor (§6.6).
> - `validateFilters` trata un filtro **en blanco** (`''`/espacios/`null`/ausente) como NO presente (el form
>   web manda strings vacíos para inputs sin usar); cualquier valor no-blanco malformado → 400. `before` se
>   acepta SOLO como string de dígitos (un `number` JSON pierde precisión sobre 2^53) → number → 400.
> - **`deno.lock` de la function: deploy-gated.** El pin EXACTO de versión (el control de seguridad de M3)
>   está en el `import`. Generar el `deno.lock` con integrity requiere `deno cache` (toolchain Deno + red a
>   npm), ambos GATEADOS: se genera y commitea en el paso de deploy (T21), junto con el runtime.

Driver: **Postgres.js** (`npm:postgres@3.4.5`, pin EXACTO) — parametrización por tagged-template segura por
defecto (nunca interpola strings). Conexión desde `SUPABASE_DB_URL` con `{ max: 1, prepare: false }` (una
conexión efímera por invocación de EF; `prepare:false` por compatibilidad con el pooler en transaction-mode).
La conexión se cierra en `finally`.

> **Por qué no supabase-js:** `audit` no está en `db_schemas` de PostgREST → `.schema('audit').from(...)`
> devuelve PGRST106. Exponer el schema violaría el muro de spec 18. La conexión directa lee la tabla con la
> credencial de base server-side sin tocar grants ni exponer nada (R4.3). El cliente jamás recibe esa
> credencial (R4.2).

**Armado del WHERE** (todos los fragmentos con placeholders, nunca concatenación de input crudo — R2.9):

```
select id, record_id, op, ts, auth_uid, request_id, table_name, record, old_record
from audit.record_version
where (from IS NULL       or ts >= $from)
  and (to IS NULL         or ts <= $to)
  and (auth_uid IS NULL   or auth_uid = $auth_uid)
  and (request_id IS NULL or request_id = $request_id)
  and (est IS NULL        or record->>'establishment_id' = $est)
  and (table_name IS NULL or table_name = $table_name)     -- valor ya validado contra allowlist
  and (op IS NULL         or op = $op::audit.operation)
  and (before IS NULL     or id < $before)
order by id desc
limit $limit                                               -- entero validado y capeado (≤100)
```
- Con Postgres.js el patrón real es tagged-template + fragmentos condicionales (`sql``…``` / `sql([])`), no
  string concat. `table_name`/`op` van igual como parámetros (además de estar validados contra allowlist).
- `limit` es un entero ya capeado; se liga como parámetro.
- `id`/`before` son `bigint`: se devuelven como **string** (R3.6). Postgres.js entrega `bigint` como string
  o BigInt según config → se normaliza a string en el mapeo.

**Paginación (R3.1–R3.4):** orden `id DESC`. Se pide `limit` filas. Si vuelven exactamente `limit` filas,
`next_cursor = rows[last].id`; si vuelven menos, `next_cursor = null`. (Alternativa: pedir `limit+1` para
saber con certeza si hay más y no dejar un cursor "vacío"; se adopta esta variante `limit+1` — se piden
`limit+1`, se devuelven `limit`, y `next_cursor` se setea solo si vino la fila extra. Elimina el "Ver más"
que trae 0 filas.)

### 2.5 Rate limit (R3.5)

In-memory, por instancia de EF, keyed por `user.id`: fixed-window contador (ej. **60 req / 60 s**). Al
exceder → `429 rate_limited`. Es **best-effort** (las EFs son efímeras/multi-instancia → el contador no es
global); suficiente para una herramienta interna de 2 personas: el objetivo es cortar scraping/loops
accidentales, no defender contra un atacante distribuido (que ya está afuera por el gate de staff). Ver
§decisiones (alternativa DB-backed descartada).

### 2.6 Resolución de actor + labels (R5.1–R5.3)

Tras traer las filas:
1. `uids = distinct(rows.auth_uid where not null)`.
2. **Un** query batch por la misma conexión directa:
   ```
   select u.id, u.name, p.email
   from public.users u
   left join public.user_private p on p.user_id = u.id
   where u.id = any($uids::uuid[])
   ```
   > `public.users` tiene `id`, `name` (identidad pública). El `email` se movió a `public.user_private`
   > (spec 14, migración 0068 dropeó `users.email`). Como es la conexión de base directa (service-role/
   > superuser), se lee ambas sin RLS. **Esto expone PII (email) a staff** — aceptable y documentado (R7.4).
3. Se arma `Map<uid, {id,name,email}>`. Cada fila recibe `actor` = el match, o `null` si el `auth_uid` es
   `null`/no existe en `public.users` (usuario borrado; el audit no tiene FK — R5.2).
4. `table_label` = `TABLE_LABELS[table_name]` (mapa es-AR; `{ user_roles: 'Roles de miembro' }`). Si no
   está en el mapa (tabla nueva no etiquetada), se devuelve el `table_name` crudo como fallback.

**Qué NO se resuelve en v1 (scope):** los uuids **dentro** de `record`/`old_record` (ej. `user_id`,
`establishment_id`, `role_id`) se muestran crudos. Resolver cada uuid interno es un pozo sin fondo; el punto
forense es "quién (actor) cambió qué campos". Documentado en §decisiones.

## 3. Página web (`docs/internal/audit-viewer/`)

### 3.1 Estructura
- `index.html` — un solo document, estilo landing (`docs/marketing/landing-proximamente/`: CSS inline,
  system-font stack, paleta miTropero `--primary:#1E5A3E`). Dos vistas: **login** y **consola** (tabla +
  filtros), toggle por estado de sesión.
- `app.js` — carga `@supabase/supabase-js` por CDN, config con la URL del proyecto + anon key (públicas,
  R6.11). **As-built (M1):** el CDN es jsDelivr con el bundle **UMD original estático**
  (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.js`), versión EXACTA + `integrity`
  SRI (sha384) + `crossorigin`. Se eligió jsDelivr UMD (no `esm.sh@2`) porque el entry de esm.sh es un wrapper
  de re-export cuyos sub-módulos no quedan cubiertos por el SRI del `<script>`; el UMD de jsDelivr es un único
  archivo self-contained (expone el global `window.supabase`) → un solo hash cubre toda la lib. Se usa el
  archivo `dist/umd/supabase.js` (original, `immutable`), NO `supabase.min.js` (jsDelivr lo genera
  dinámicamente y su propio header desaconseja SRI sobre archivos generados).

### 3.2 Flujo de auth (R6.2)
1. `supabase.auth.signInWithPassword({ email, password })`.
2. Se toma `session.access_token` y se guarda **en una variable JS en memoria** (no `localStorage`
   persistente): se instancia el cliente con `auth: { persistSession: false, autoRefreshToken: false }` para
   no dejar el token en storage. Al recargar la pestaña se re-loguea (aceptable para una tool interna).
3. Todas las llamadas a la EF llevan `Authorization: Bearer <access_token>`.

### 3.3 Consulta + render
- Formulario de filtros (R6.3): inputs de fecha (`from`/`to`), texto uuid (usuario/campo/operationId),
  `<select>` de tabla (poblado con la allowlist: hoy solo "Roles de miembro") y `<select>` de operación
  (INSERT/UPDATE/DELETE + "Todas").
- `POST` a la EF con los filtros en el body (R6.4). El JWT en el header. Nunca en la URL.
- Tabla de resultados (R6.5): columnas **Fecha** (es-AR dd/mm/aaaa hh:mm, R6.8), **Actor** (`name` +
  `email`, o el uuid si `actor===null`), **Tabla** (`table_label`), **Operación** (badge con color por op),
  **operationId** (`request_id`, monospace, truncado con copy).
- **Diff expandible** (R6.6, R5.4/R5.5): al expandir una fila se computa, en el cliente, la unión de claves
  de `record` ∪ `old_record`:
  - `INSERT`: se listan los campos de `record` como "nuevo".
  - `DELETE`: los campos de `old_record` como "eliminado".
  - `UPDATE`: por cada clave con `old !== new` se muestra `label: antes → después`, resaltando el cambio; las
    iguales se colapsan.
  - Labels de campo es-AR por un mapa `FIELD_LABELS` (ej. `role → Rol`, `active → Activo`,
    `establishment_id → Campo`, `user_id → Usuario`). Claves sin label → se muestra la clave cruda.
- Paginación (R6.7): botón "Ver más" que re-consulta con `before = next_cursor`; se oculta cuando
  `next_cursor === null`.
- Error `403 not_staff` (R6.9): la consola muestra "No tenés acceso a esta herramienta" y no pinta datos.

### 3.4 Hosting en Cloudflare (R6.10)
- **Default (a confirmar por Raf):** un proyecto **Cloudflare Pages** separado, sirviendo el estático de
  `docs/internal/audit-viewer/` en un subdominio propio (ej. `audit.mitropero.com.ar` o el `*.pages.dev` que
  asigne Pages). Pages es el host estático estándar de Cloudflare; desacopla la tool interna del **Worker**
  que sirve la landing pública (`mitropero.com.ar`, ver `members.ts` §5), sin código de Worker nuevo.
- `_headers` de Pages (as-built): `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` restrictiva, y un CSP
  acotado `default-src 'none'` con `script-src 'self' https://cdn.jsdelivr.net` (el CDN pineado, ya NO
  `esm.sh`), `style-src 'self' 'unsafe-inline'`, `connect-src <origen Supabase DEV>` (login + `fetch` a la EF),
  `img-src 'self' data:`, `frame-ancestors 'none'`, `base-uri/form-action/object-src 'none'`. HTTPS lo da
  Cloudflare. El mismo CSP va como `<meta http-equiv>` en `index.html` (defensa en profundidad; sin
  `frame-ancestors`, no soportado en meta).
- **Alternativa (descartada como default):** agregar una ruta al Worker existente de la landing. Descartada:
  mezcla forense interno con la superficie de marketing pública y obliga a bundlear el archivo en el Worker.
  Queda como opción si Raf prefiere no crear un proyecto Pages nuevo.
- El deploy del estático es una acción externa (Cloudflare) → **gateada** como el resto (OK de Raf), igual
  que el deploy de la EF.

## 4. Multi-tenancy / RLS

La feature **es explícitamente cross-tenant**: el staff ve el audit de todos los `establishment_id`. Esto no
viola el modelo multi-tenant porque:
- El acceso está gateado por la allowlist de staff (R1.5), no por RLS de owner.
- La EF lee con credencial de base directa (no con el JWT del usuario), por diseño — la RLS de las tablas de
  negocio no aplica al audit (que es un schema aparte, fail-closed a clientes).
- **El muro fail-closed de spec 18 se preserva** (R4.3): anon/authenticated siguen sin `USAGE`/`SELECT` sobre
  `audit`. La EF es la única puerta y está gateada. No se agregan grants ni se expone el schema.

## 5. Offline-first

**No aplica.** Es una herramienta web interna de escritorio para staff (no carga datos en campo, no corre en
la app RN, no toca PowerSync). Se documenta la no-aplicabilidad explícitamente para el Gate.

## 6. Decisiones (defaults del leader + alternativas descartadas)

1. **Lectura por conexión directa a Postgres, no supabase-js** — porque `audit` no está expuesto a PostgREST
   y exponerlo rompería el muro de spec 18. Alternativa descartada: crear un RPC `SECURITY DEFINER` en
   `public` que lea `audit.record_version` → exige **migración** (viola R4.4/"sin migración"), amplía la
   superficie SQL deployada y mueve la lógica de filtros a PL/pgSQL. La conexión directa cumple "sin
   migración" y mantiene la validación en TS testeable.
2. **Allowlist por EF secret** (`MITROPERO_STAFF_USER_IDS`), no tabla `staff` — 2 personas; una tabla es
   overkill (migración + RLS propia). Fail-closed si el secret falta (R1.7).
3. **Rate limit in-memory best-effort** — alternativa descartada: tabla `rate_limit` en DB (persistente,
   global) → migración + escritura por request. Overkill para uso interno; el gate de staff ya es la defensa
   real. Se documenta la limitación (per-instancia).
4. **Actor resuelto server-side; uuids internos del record, crudos** — resolver todo uuid anidado es
   scope-creep sin fin. v1 resuelve solo el actor (el "quién") + labels de tabla/campo. Ampliable después.
5. **JWT en memoria (persistSession:false)** — minimiza la ventana de robo del token en una máquina
   compartida; el costo (re-login al recargar) es aceptable para 2 usuarios.
6. **`before = limit+1` para el cursor** — se piden `limit+1` filas y se devuelven `limit`, para setear
   `next_cursor` solo si de verdad hay más (evita un "Ver más" que trae 0 filas).
7. **Página en `docs/internal/audit-viewer/`** — paralelo a `docs/marketing/landing-proximamente/`
   (precedente de estático versionado en el repo servido por Cloudflare). Alternativa: `web/` top-level;
   descartada por consistencia con el precedente existente.
8. **Se reutiliza `serveEf` tal cual** — no se duplica ni renombra; el rebrand del header fue una fase
   global aparte (`docs/rebrand-mitropero-plan.md` §D), **ejecutada el 2026-08-17**: `serveEf` manda hoy
   `X-Mitropero-Request-Id` y acepta también el nombre viejo. `audit_query` heredó el cambio sin tocarse.

## 7. Foco de Gate 1 (security_analyzer modo spec)

- **Muro fail-closed intacto:** `git diff` no toca grants de `audit`; el schema sigue sin exponerse; la EF es
  la única puerta y lee con credencial server-side (R4.1–R4.3).
- **Gate de staff server-side + fail-closed** ante secret ausente (R1.5–R1.7); nunca desde el body.
- **Validación autoritativa de TODOS los filtros** + SQL 100% parametrizado (sin concatenar input crudo),
  allowlists de `table_name`/`op`, uuids por regex antes del cast, `limit` capeado, fechas parseadas (R2.x).
- **No-leak:** `serveEf` no loguea body/JWT; la EF no loguea `record`/`old_record` ni el email del actor;
  5xx con copy genérico sin message del driver (R7.1–R7.3).
- **PII:** `record`/`old_record` + email del actor expuestos solo a staff (círculo de confianza),
  documentado (R7.4).

## 8. Hardening foldeado de Gate 1 (spec) — 2026-08-15

Del `progress/security_spec_24-audit-viewer.md` (PASS 0 HIGH). Requisitos de implementación:

- **[M1] Dependencia web fijada + SRI.** `@supabase/supabase-js` NO se carga flotante de `esm.sh@2`: pin de
  versión EXACTA + `integrity` (SRI) en el `<script>`, o vendorear el bundle en `docs/internal/audit-viewer/`.
  El JWT de staff pasa por esa lib; blast radius = audit cross-tenant + PII. Idem cualquier dep por CDN.
- **[M2] SQL SOLO por tagged-template, JAMÁS `sql.unsafe`/concatenación.** La conexión usa la credencial
  privilegiada `SUPABASE_DB_URL` (base ENTERA, no solo `audit`) → una inyección sería catastrófica. El armado
  del WHERE y del batch de actores va 100% con placeholders de Postgres.js. PROHIBIDO `sql.unsafe(...)` o
  construir SQL por string. **Gate 2 (modo code) DEBE verificarlo sobre el diff** (grep `unsafe`/concat).
- **[M3] `postgres` (Postgres.js) fijado + lockfile.** `npm:postgres@3.x.y` EXACTO (no `^`/flotante) + commit
  del `deno.lock` de la function. Idem cualquier import npm nuevo.
- **[LOW-1] Filtro `establishment_id` cubre DELETE.** En un DELETE el `record` es NULL → filtrar solo por
  `record->>'establishment_id'` deja afuera esos DELETE. Usar
  `coalesce(record, old_record)->>'establishment_id' = $est`.
- **[LOW-2] Guards de tipo en `from`/`to`** antes del `new Date` (`typeof x === 'string'`, no asumir).
- **[LOW-3] Render del diff = `textContent`/escape, NUNCA `innerHTML` con valores del `record`.** Los valores
  de `record`/`old_record` (y el `name`/`email` del actor) son datos de usuario → pintarlos con `textContent`
  o escape HTML para evitar **XSS almacenado** en la consola de staff.
