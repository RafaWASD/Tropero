# Security review (Gate 2, modo code) — 24 · Visor web interno del audit log

> Agente: security_analyzer. Modo: `code`. Fecha: 2026-08-16.
> baseline_commit: `3d3afc9d7ff4eea12f4acd00205060914f8ce6be` (de `impl_24-audit-viewer-{backend,web}.md`).
> Diff auditado (baseline..HEAD + working tree): `supabase/functions/audit_query/{index,query,db}.ts`
> (+ `query.test.ts`), `docs/internal/audit-viewer/{index.html,app.js,_headers}`, `scripts/run-tests.mjs`.
> Skill `sentry-skills:security-review` corrida sobre el diff (refs `injection.md` + `languages/javascript.md`
> cargadas); metodología trace-data-flow + verify-exploitability aplicada a mano sobre el runtime deploy-gated
> (Deno + `SUPABASE_DB_URL` no ejecutables en la máquina → auditoría ESTÁTICA, como pide el límite del task).

## Veredicto: PASS — 0 HIGH

El as-built cierra los 3 folds del design §8 (M1 SRI, M2 inyección SQL, M3 pin de `postgres`) y los 3 LOW.
**Cero findings HIGH-confidence.** No se introdujo ninguna vulnerabilidad nueva. El muro fail-closed de
spec 18 sigue intacto (diff no toca `0124`, grants, ni `config.toml`). El único actor externo es un staff
autenticado; un `authenticated` no-staff no lee nada (403 antes de tocar la base).

Nada debe arreglarse antes de cerrar el código. Quedan gates de DEPLOY (no de código): generar+commitear el
`deno.lock` con integrity del pin, confirmar el SRI post-publicación, y ajustar URL/anon+CSP si se apunta a
PROD. Se detallan como notas de deploy, no como findings.

---

## Foco del task — verificación con evidencia

### 1. [§8 M2 — CRÍTICO] Inyección SQL → CERRADO. No hay HIGH.
La conexión es privilegiada (`SUPABASE_DB_URL` = base entera, bypassa RLS) → una inyección sería
catastrófica. **No existe.**
- `db.ts` arma TODO el SQL con tagged-templates de Postgres.js. Los 14 `${…}` del archivo (grep exhaustivo)
  están, sin excepción, dentro de `sql\`…\``:
  - Valores de filtro (`db.ts:62-74`): `sql\`ts >= ${filtros.from}::timestamptz\``, `= ${filtros.auth_uid}::uuid`,
    `coalesce(record, old_record)->>'establishment_id' = ${filtros.establishment_id}`, `= ${filtros.op}`,
    `id < ${filtros.before}::bigint`, etc. → cada `${valor}` es un **placeholder ligado** (equivalente a `$1`
    + values, patrón SAFE de `injection.md`). Los casts `::uuid/::timestamptz/::bigint` aplican al placeholder,
    no al texto del input.
  - Composición del WHERE (`db.ts:79`): `conds.reduce((acc, c) => sql\`${acc} and ${c}\`)` → `acc`/`c` son
    **objetos-fragmento de Postgres.js** (resultado de `sql\`…\``), NO strings. Postgres.js los compone como
    estructura SQL manteniendo sus valores internos como parámetros. No es string-concat de input.
  - `db.ts:97` `where ${whereClause}` y `db.ts:114` `any(${uids}::uuid[])` → fragmento / array ligado.
    `uids` provienen de las propias filas del audit (no del cliente) y además van como parámetro.
- `grep` en `audit_query/`: **cero `sql.unsafe(`**, cero `.query(`, cero `+`/concat armando SQL. Las 3
  apariciones de "unsafe" son comentarios que lo PROHÍBEN (`db.ts:10,14`, `query.test.ts:6`).
- Defensa en profundidad: cada escalar llega YA validado desde `query.ts` (uuids por `UUID_RE`,
  `table_name`/`op` por allowlist, `before` por `^\d+$`, `limit` clamp, `from`/`to` por `Date→toISOString`).
  Incluso el VALOR del parámetro está acotado.

**Conclusión:** parametrización 100% comprometida y verificada sobre el diff. El HIGH que había que cazar
no existe.

### 2. Gate de staff fail-closed → CORRECTO.
- `index.ts:58-61`: `parseStaffAllowlist(Deno.env.get('MITROPERO_STAFF_USER_IDS'))`; corta con
  `staff.size === 0 || !staff.has(user.id.toLowerCase()) → 403 not_staff`.
- `parseStaffAllowlist` (`query.ts:51-59`) es fail-closed: secret ausente/vacío/basura → `Set` vacío → nadie
  es staff → 403. Cubierto por test + mutante (impl backend: quitar el filtro `UUID_RE` mató 2 tests).
- `user.id` sale de `requireUser(userClient)` (valida el JWT contra el Auth server vía `getUser()`), **nunca**
  del body ni de headers. Allowlist SOLO desde el secret.
- **Orden correcto:** el gate (paso 3, `index.ts:58`) corre ANTES de abrir la conexión / consultar (paso 6,
  `queryAudit`, `index.ts:80`). Un no-staff jamás llega al `db.ts`. Confirmado: authenticated no-staff = 0 acceso.

### 3. Validación de filtros → CORRECTO.
`validateFilters` (`query.ts:89-160`) es autoritativa server-side y corre ANTES de `db.ts`. `index.ts:74`
pasa `parsed.filtros` (escalares validados), nunca el body crudo. uuids por regex antes del cast; `table_name`
por `TABLE_ALLOWLIST`; `op` por `OP_ALLOWLIST` case-sensitive; `before` por `^\d+$` (string-only, evita
pérdida de precisión de bigint); `limit` clamp 1..100; `from`/`to` con guard `typeof==='string'` antes del
`new Date` (§8 LOW-2 cerrado). Claves desconocidas del body se ignoran. Ningún filtro llega sin validar al SQL.

### 4. [§8 M1] SRI web → CERRADO.
`index.html:297-301`: `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.js"
integrity="sha384-qafw21c/iciq0VXsi9FzkfoQv5I/V0iqE4lSNcKXPnW9/UTJLnv5CcN4FHxVLnKg" crossorigin="anonymous"
referrerpolicy="no-referrer">`. Versión **exacta** (no flotante) + SRI sha384 real sobre el archivo UMD
estático (no el `.min` generado). Decisión de mover de `esm.sh@2` a jsDelivr-UMD está bien fundada: el UMD es
un único archivo self-contained → un solo hash cubre toda la lib que maneja el JWT de staff. El browser
enforcea el SRI al cargar; un mismatch rompe la página (fail-safe). Es la única dep CDN.

### 5. [§8 LOW-3] XSS web → CERRADO.
`app.js`: **cero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`** (grep = 0 en código;
las 2 menciones de "innerHTML"/"localStorage" son comentarios, `app.js:5,8`). Todo el DOM se arma con
`document.createElement` + `textContent` (helpers `el`/`txtEl`, y `makeVal` → `s.textContent = formatValue(v)`,
`app.js:389`). Los valores de `record`/`old_record` y `actor.name`/`email` van SIEMPRE por `textContent`.
Objetos jsonb se `JSON.stringify` y se pintan como texto. El impl falsificó en runtime con
`<img src=x onerror=…>` en `record.note` y `actor.name` → texto inerte, `window.__xss` undefined.

### 6. No-leak / PII → CORRECTO.
- `serverError` (`_shared/errors.ts:30-33`, no tocado por el diff) loguea el detalle del driver a
  `console.error` server-side y devuelve copy genérico (`'Error interno, probá de nuevo.'`, 500) SIN el
  `.message` de Postgres. `index.ts:82` (db) y `:123` (unexpected) usan `serverError`. El único `err.message`
  que llega al cliente es el de `HttpError` (`index.ts:121`) — error CONTROLADO de `requireUser` (copy de auth,
  no del driver), patrón estándar de todas las EFs. Sin information disclosure.
- El handler NO tiene ningún `console.*` propio → no loguea `record`/`old_record`/email/JWT. `serveEf`
  (no tocado) no loguea body ni Authorization.
- Token en memoria: `createClient(..., { auth: { persistSession:false, autoRefreshToken:false } })`
  (`app.js:21-23`); `state.accessToken` en closure; grep `localStorage`/`sessionStorage` = 0. Password se
  limpia del input tras login (`app.js:187`).

### Muro fail-closed de spec 18 + actor externo único → INTACTO.
- `git diff --name-only baseline..HEAD -- supabase/migrations supabase/functions/_shared supabase/config.toml`
  = **vacío**. `0124_audit_log.sql`, los REVOKE/grants de `audit`, el tripwire y `schemas` de `config.toml`
  NO se tocan. El schema `audit` sigue fuera de PostgREST; la EF lee por conexión directa sin exponer nada.
- La EF es la ÚNICA puerta de lectura nueva, y está gateada por staff. Un `authenticated` no-staff recibe 403
  antes de cualquier lectura.

---

## Findings HIGH de Sentry
**Ninguno.** La skill no arroja HIGH sobre el diff tras trace-data-flow: el único sink de interés (SQL con
credencial privilegiada) está 100% parametrizado; el sink DOM (web) usa `textContent`.

## Findings RAFAQ-SPECIFIC
**Ninguno HIGH.** Dominios del catálogo aplicables revisados sin hallazgo explotable:
- **A1 (priv bypass RLS):** la EF lee con `SUPABASE_DB_URL` (bypassa RLS) **por diseño** (schema `audit` es
  cross-tenant forense, fail-closed a clientes). Scoping = gate de staff (fail-closed) + filtros validados +
  SQL parametrizado. Trade-off del rol omnipotente ya consciente en design §2.4 (impuesto por R4.4 "sin
  migración"). No es finding — es la arquitectura aprobada en Gate 0/Gate 1.
- **A2 (mass assignment):** N/A — solo `SELECT`, sin `insert(body)`/`update(body)`.
- **B1 (info disclosure `err.message`):** cerrado (arriba).
- **Prototype pollution (web):** revisado — `renderDiff` (`app.js:394`) itera `for (k in rec)` con
  `hasOwnProperty`, arma `keys[k]=true` sobre `{}` y lee `rec[key]`/`old[key]`; no hay merge en un target
  compartido ni sink de gadget, y la fuente (`record` jsonb) es data del trigger de audit. Sin explotabilidad.

## False positives descartados (trazabilidad)
- **`sql\`${acc} and ${c}\`` como "template-literal SQL injection":** NO. `acc`/`c` son fragmentos de
  Postgres.js, no strings; la interpolación es composición SQL con params ligados. Es el patrón documentado
  de query dinámica de Postgres.js, no el antipatrón de `injection.md` (que es `\`...${userInput}...\`` sobre
  un driver que trata el resultado como string).
- **`apikey`/anon key hardcodeada en `app.js:17`:** NO es secreto — es la publishable key pública (R6.11).
  No hay `service_role` ni `SUPABASE_DB_URL` en el cliente (esos viven en la EF).
- **CORS `*` (`_shared/cors.ts`):** no explotable — auth por bearer token, sin credenciales ambientales
  (ya dictaminado en Gate 1; el archivo no se tocó).
- **`style-src 'unsafe-inline'` en el CSP:** requerido por el `<style>` inline; sin sink de HTML de usuario,
  la inyección de CSS no es alcanzable. Defensa-en-profundidad, no hueco.

## Tabla de inputs (cada filtro que el staff tipea)

| campo | límite | validación | OK? |
|---|---|---|---|
| `from` | ISO parseable | server: `typeof==='string'`+`new Date`+`isNaN`→400; ligado `::timestamptz` | ✓ |
| `to` | ISO parseable | server (idem) | ✓ |
| `auth_uid` | forma uuid | server: `UUID_RE`→400; ligado `::uuid` | ✓ |
| `establishment_id` | forma uuid | server: `UUID_RE`→400; ligado | ✓ |
| `request_id` | forma uuid | server: `UUID_RE`→400; ligado `::uuid` | ✓ |
| `table_name` | allowlist `{user_roles}` | server: allowlist→400; ligado | ✓ |
| `op` | allowlist `{INSERT,UPDATE,DELETE}` | server: allowlist case-sensitive→400; ligado | ✓ |
| `before` (cursor) | entero positivo `^\d+$` (string) | server: regex→400; ligado `::bigint` | ✓ |
| `limit` | clamp 1..100, default 50 | server: clamp | ✓ |
| login email/password | — | supabase-js → Auth server (rate-limit nativo) | ✓ |

Todos con **límite claro + validación autoritativa server-side + binding parametrizado**. Ninguno se
concatena crudo al SQL. Cumple el requisito de Raf.

## Tabla de rate limits (acciones abusables)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| EF `audit_query` (lectura forense) | sí (in-memory 60/60s, `index.ts:29-42`) | per-`user.id` (post-gate → solo staff entra al Map) | n/a (Map en memoria) | best-effort per-instancia; defensa primaria = gate de staff. Adecuado al modelo (2 usuarios de confianza), ya aceptado en Gate 1. |
| Cap de scraping | sí (`limit`≤100/página + cursor) | per-request | cerrado | acota payload por página. |
| Login web | sí (Supabase Auth nativo) | per-IP (`config.toml`, no tocado) | cerrado | no aflojado por esta feature. |

Ninguna acción manda email/SMS ni pega a API externa → Denial-of-Wallet N/A.

## Archivos analizados
- `supabase/functions/audit_query/index.ts` (handler, gate, rate-limit, armado de respuesta)
- `supabase/functions/audit_query/query.ts` (allowlist staff + `validateFilters`)
- `supabase/functions/audit_query/db.ts` (conexión directa + SQL parametrizado) — **foco §8 M2**
- `docs/internal/audit-viewer/{index.html,app.js,_headers}` (web: SRI, XSS, CSP, token en memoria)
- Confirmado sin tocar: `supabase/migrations/**`, `supabase/functions/_shared/**`, `supabase/config.toml`.

## Cobertura indirecta / no cubierto por la skill (revisión manual)
- **Postgres.js tagged-templates:** la skill no modela la semántica de fragmentos de Postgres.js →
  verificado a mano (todo `${}` dentro de `sql\`\``, sin `unsafe`/concat). Es el eje del veredicto.
- **Runtime Deno + `SUPABASE_DB_URL`:** deploy-gated, no ejecutable acá. Auditoría estática (por límite del
  task). El smoke E2E (T19) contra la EF deployada es el oráculo empírico pendiente en deploy.
- **Enforcement real del SRI + `deno.lock`:** el pin de `npm:postgres@3.4.5` es exacto en el `import`
  (`db.ts:20`), pero el `deno.lock` con integrity se genera en el deploy (`deno cache`, gated). El SRI del
  `<script>` está presente y pineado; su enforcement lo hace el browser al publicar. Ambos son gates de
  DEPLOY, no huecos de código.

## MEDIUM / LOW a foldear (no bloquean el cierre de código)
- **[fold, deploy] M3 lockfile:** generar y commitear el `deno.lock` de la function con el hash de
  `postgres@3.4.5` en el paso de deploy (T21). El control a nivel fuente (pin exacto) ya está.
- **[fold, deploy] SRI/URL a PROD:** si el estático se publica apuntando a PROD (hoy DEV
  `xrhlxxdnfzvdnztacofj`), ajustar `SUPABASE_URL`/anon en `app.js` y `connect-src` en `_headers`+meta CSP, y
  re-confirmar que el SRI carga post-publicación (T22).
- **[LOW] `_shared/cors.ts` CORS `*`:** restringir el `Access-Control-Allow-Origin` al origen del visor sería
  defensa-en-profundidad; no es hueco (auth por token). Fuera de scope de esta feature (archivo compartido).
