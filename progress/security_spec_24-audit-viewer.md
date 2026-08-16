# Security review (Gate 1, modo spec) — 24 · Visor web interno del audit log

> Agente: security_analyzer. Modo: `spec`. Fecha: 2026-08-16.
> Input: `specs/active/24-audit-viewer/{context,requirements,design}.md`.
> Contraste con estado real: `supabase/migrations/0124_audit_log.sql`, `_shared/{serve,auth,errors,cors,supabase}.ts`, `supabase/functions/invite_user/index.ts`, `supabase/config.toml`.
> Skill `sentry-skills:security-review`: metodología aplicada a mano (trace data flow + verificar explotabilidad) sobre una spec sin código — no hay diff que pasarle al escáner en modo spec; el escáner es la herramienta del modo `code` (Gate 1 sobre el diff del implementer, que queda pendiente).

## Veredicto: PASS

El diseño es sólido en sus seis superficies de foco. **Cero findings HIGH explotables** en el diseño actual. La puerta forense está bien concebida: muro fail-closed intacto, gate de staff server-side fail-closed, validación autoritativa de todos los filtros con SQL comprometido a parametrización, no-leak preservado, PII acotada a staff y documentada.

Hay **3 MEDIUM** (hardening / supply-chain / carry-to-code) y **3 LOW** que conviene foldear en la spec o cargar explícitamente al Gate 1 de modo `code` antes de dar por cerrada la feature. Ninguno bloquea Puerta 1.

---

## Superficies auditadas (confirmación con evidencia)

### 1. Muro fail-closed de spec 18 — PRESERVADO ✓
- `git diff --stat HEAD -- supabase/migrations/0124_audit_log.sql` = **vacío**; último commit que la tocó = `9f0b2ec` (spec 18). La migración NO se modifica (R4.4 ✓). Los REVOKE de `USAGE`/`SELECT`/`EXECUTE` a `public/anon/authenticated` (0124 líneas 197-216) y el tripwire doble (líneas 221-244) siguen en pie.
- `config.toml` línea 13: `schemas = ["public","graphql_public"]` — `audit` **no** expuesto a PostgREST. El diseño (design §0/§2.4) lo respeta: lee por **conexión directa a Postgres** (`SUPABASE_DB_URL`), no por supabase-js/PostgREST → no fuerza a exponer el schema. Correcto: exponerlo a PostgREST habría roto el muro. Es la forma correcta.
- Credencial de base: `SUPABASE_DB_URL` es secret auto-inyectado, vive solo en la EF; nunca viaja al cliente (R4.2 ✓). El cliente web solo recibe URL pública + anon key (R6.11).
- **Conclusión:** el único camino de lectura nuevo es la EF gateada. R4.1/R4.3 confirmados a nivel diseño y estado.

### 2. Gate de staff server-side + fail-closed — SÓLIDO ✓
- `requireUser` (`_shared/auth.ts`) resuelve `user.id` vía `userClient.auth.getUser()` — **valida el JWT contra el Auth server** (no es decode local), así que `user.id` es autoritativo. El gateway además corre con `verify_jwt=true` (default; `config.toml` solo exceptúa `health`), doble capa.
- design §2.2: `STAFF = Set(parse(MITROPERO_STAFF_USER_IDS)).filter(UUID_RE.test)`. `STAFF.size===0 ⇒ 403` (secret ausente/vacío/basura ⇒ nadie es staff, R1.7). Pertenencia **solo** desde el secret + `user.id` del JWT, nunca del body/headers (R1.6).
- **No hay camino** por el que un authenticated no-staff lea algo: el `403 not_staff` ocurre en el paso 3, antes de cualquier lectura de DB (R1.5). Confirmado: authenticated no-staff = 0 acceso.

### 3. Validación de filtros + SQL parametrizado — ADECUADO a nivel spec ✓ (con carry-to-code, ver M2)
- Todos los filtros validados server-side y autoritativos (design §2.3): uuids por `UUID_RE` antes del cast (`auth_uid`/`establishment_id`/`request_id`), `table_name`/`op` contra allowlist (evita sondeo de otras tablas), `from`/`to` parseadas, `before` `^\d+$`, `limit` clamp 1..100 default 50.
- `op::audit.operation` — seguro: `op` ya validado contra `{INSERT,UPDATE,DELETE}` antes del cast; un valor fuera de la allowlist rebota en `400` sin llegar al SQL.
- `record->>'establishment_id' = $est` — parametrizado, seguro (ver L1 por una laguna funcional, no de seguridad).
- Compromiso R2.9: tagged-template de Postgres.js, sin concatenar input crudo. A nivel spec es adecuado. El punto exacto de riesgo (armado dinámico del WHERE) queda para verificar en modo `code` — ver **M2**.

### 4. No-leak / PII — PRESERVADO ✓
- `serveEf` (`_shared/serve.ts`) no loguea body ni Authorization/JWT (solo content-length + requestId + `error.code`). R7.1 ✓.
- `serverError` (`_shared/errors.ts`) devuelve copy genérico (`'Error interno, probá de nuevo.'`) y manda el detalle a `console.error` server-side — sin `message` del driver al cliente (R7.2 ✓).
- R7.3 (no loguear `record`/`old_record`/email) y R7.4 (PII solo a staff, documentada en design §2.6) son obligaciones de la EF; el diseño las declara explícitas. El círculo de confianza (staff ve email + diffs cross-tenant) es coherente con la decisión de Gate 0 (audiencia = staff interno).

### 5. CORS `*` — REVISADO, no explotable (no es finding)
- `_shared/cors.ts`: `Access-Control-Allow-Origin: *`. Para esta EF el gate real es el **bearer JWT** (no cookies/credenciales ambientales). Un sitio malicioso cross-origin **no puede** leer el token en memoria de la página del viewer (aislamiento de origen) ni forzar al browser a adjuntarlo. Sin credenciales ambientales, CORS `*` no habilita CSRF ni robo de respuesta. Es el patrón estándar "CORS `*` OK para API con auth por token". Restringir el origin sería defensa-en-profundidad (preferencia), no cierre de un hueco explotable → no lo reporto como finding.

### 6. Rate limit in-memory best-effort — ADECUADO al modelo de amenaza (no es finding)
- Keyed por `user.id`, fixed-window (design §2.5). Per-instancia (no global) → un atacante distribuido lo evade, pero ese atacante tendría que **ser staff** (ya pasó el gate). El objetivo declarado (cortar scraping/loop accidental de 2 usuarios de confianza) se cumple. El gate de staff es la defensa primaria. Aceptable; el diseño es honesto sobre la limitación.

---

## Findings

### HIGH
**Ninguno.**

### MEDIUM (foldear en la spec o cargar al Gate 1 de modo `code`)

**M1 — `supabase-js` desde CDN mutable (`esm.sh`) sin SRI, versión flotante → robo de JWT/audit ante compromiso de CDN.**
- Evidencia: design §3.1 — `app.js` carga `https://esm.sh/@supabase/supabase-js@2` (major flotante). Es la librería que maneja el **login y el JWT de staff** de una herramienta que expone el forense **cross-tenant con PII (emails de todos los tenants)**.
- Problema: el CSP acotado (design §3.4) **permite** `esm.sh` en `script-src`, así que CSP no protege contra un `esm.sh` comprometido — solo contra otros orígenes. Blast radius de un compromiso de esm.sh mientras un staff está logueado: exfiltración del JWT en memoria → lectura completa del audit cross-tenant + PII, y llamadas autenticadas como staff. Likelihood baja (CDN reputado, token ~1h), por eso MEDIUM y no HIGH; pero el impacto es alto para una tool forense.
- Fix (foldear en design §3.1/§3.4 antes de publicar la web): **vendorear** `supabase-js` en `docs/internal/audit-viewer/` (servido por Cloudflare, mismo origen), o si se mantiene el CDN, **pinear la versión exacta** (`@supabase/supabase-js@2.x.y`) **+ `integrity` (SRI)** en el `<script>`. Preferido: vendoreado (elimina el tercero del path del JWT).

**M2 — Blast radius de una eventual inyección = base entera vía rol privilegiado; el armado dinámico del WHERE es el punto a blindar en `code`.**
- Evidencia: design §2.4 — la conexión directa usa `SUPABASE_DB_URL` (rol `postgres`, altamente privilegiado, bypassa toda RLS). El WHERE se arma con "tagged-template + fragmentos condicionales (`sql``…`` / `sql([])`)".
- Problema: la parametrización está comprometida (R2.9) y a nivel spec es correcta, PERO el ensamblado dinámico de fragmentos con Postgres.js es exactamente el lugar donde un `sql.unsafe(...)` o una concatenación reintroducen inyección — y como el rol es `postgres`, una inyección ahí NO se limita a `audit.record_version`: es lectura/escritura de **toda la base** saltando RLS. El control es suficiente, pero su verificación es load-bearing.
- Fix / acción: (a) **Gate 1 modo `code` DEBE** verificar que el WHERE se compone solo con `sql``` (tagged-template) y fragmentos `sql([...])`, **sin `sql.unsafe` ni string-concat de ningún input**, y que `limit`/`before` van ligados como parámetros. (b) Surfacing del trade-off al leader: R4.4 ("sin migración") **fuerza** el uso del rol omnipotente `SUPABASE_DB_URL` en vez de un rol read-only scopeado a `SELECT audit.record_version + public.users/user_private` (que exigiría una migración: crear rol + grants). Para una tool interna de 2 personas con parametrización verificada es un trade-off aceptable; conviene dejarlo consciente en design §2.4 en vez de implícito.

**M3 — `npm:postgres@3` es dependencia NUEVA con rango flotante (supply chain, D2).**
- Evidencia: `postgres`/`npm:postgres` no aparece en `supabase/functions/**` hoy (grep limpio); la introduce esta feature (design §2.4). `npm:postgres@3` fija el major pero flota minor/patch.
- Fix (foldear en design §2.4 o cargar a `code`): pinear versión exacta (`npm:postgres@3.x.y`) y asegurar `deno.lock` con el hash, para que un release malicioso del paquete no entre por auto-resolución en un deploy futuro.

### LOW (anexo)

**L1 — Filtro `establishment_id` sobre `record->>...` pierde las filas DELETE (laguna forense, no de seguridad).** En un DELETE `record` es `null`; `record->>'establishment_id'` es `null` → la fila no matchea. Un staff filtrando por establishment perdería los eventos de borrado de ese tenant. Es completitud forense, no confidencialidad/integridad. Sugerencia: filtrar por `coalesce(record, old_record)->>'establishment_id'` (parametrizado igual).

**L2 — `from`/`to`: exigir `typeof === 'string'` antes de `new Date(x)`.** El body es JSON; un `from` numérico haría `new Date(number)` (epoch) válido. No es inyección (va parametrizado como timestamptz), pero es type-confusion silenciosa. Guard de 1 línea.

**L3 — `serverError` loguea el detalle del driver server-side.** Un error de Postgres.js puede incluir valores de filtro (uuids, de baja sensibilidad) en `console.error`. R7.3 (no loguear `record`/`old_record`/email) se cumple porque el `record` no se pasa a `serverError`. Aceptable; solo no pasar objetos con `record`/`old_record`/email al logger.

---

## Tabla de inputs (cada filtro del body)

| campo | límite | validación | OK? |
|---|---|---|---|
| `from` | ISO timestamp parseable | server (`new Date` + `isNaN`→400); ver L2 (falta guard `typeof`) | ✓ (L2 menor) |
| `to` | ISO timestamp parseable | server (idem) | ✓ (L2 menor) |
| `auth_uid` | forma uuid | server (`UUID_RE`→400) | ✓ |
| `establishment_id` | forma uuid | server (`UUID_RE`→400); ver L1 (laguna DELETE) | ✓ |
| `request_id` | forma uuid | server (`UUID_RE`→400) | ✓ |
| `table_name` | allowlist `{user_roles}` | server (allowlist→400) | ✓ |
| `op` | allowlist `{INSERT,UPDATE,DELETE}` | server (allowlist→400) | ✓ |
| `before` | entero positivo `^\d+$` | server (regex→400) | ✓ |
| `limit` | clamp 1..100, default 50 | server (clamp, no-entero/≤0→default) | ✓ |

Todos los campos de entrada tienen **límite claro + validación autoritativa server-side + binding parametrizado**. Ninguno se concatena crudo al SQL (compromiso R2.9). Cumple el requisito de Raf ("límite + validación en cada input para aprobar").

## Tabla de rate limits (acciones abusables)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| EF `audit_query` (lectura forense) | sí (in-memory 60/60s) | per-`user.id` (abuso autenticado) | n/a (Map en memoria, no falla) | best-effort per-instancia; defensa primaria = gate de staff. Adecuado al modelo de amenaza (2 usuarios de confianza). |
| Login web (Supabase Auth) | sí (nativo) | per-IP (`sign_in_sign_ups=30/5min`, `config.toml`) | cerrado (nativo) | no aflojado por esta feature. |
| Cap de scraping | sí (`limit`≤100/página, R3.2/R7.5) | per-request | cerrado | acota payload por página. |

Ninguna acción de esta feature manda email/SMS ni pega a API externa → sin necesidad de cuota de costo (Denial-of-Wallet n/a).

---

## Catálogo RAFAQ — dominios revisados

- **A1 (service-role/priv bypass RLS):** aplica — la EF lee con credencial de base privilegiada bypasseando RLS **por diseño** (schema `audit` es cross-tenant, fail-closed a clientes). Scoping = gate de staff, no RLS. Correcto. Ver M2 (blast radius del rol).
- **A2 (mass assignment):** n/a — la EF solo hace `SELECT`, no `insert(body)`/`update(body)`.
- **A3 (IDOR por FK):** n/a — sin escritura; lectura gateada por allowlist de staff, no por ownership.
- **A4 (function-level authz / BFLA):** cubierto — un único rol (staff) enforced server-side; no hay sub-roles.
- **B1 (info disclosure `err.message`):** cubierto — `serverError` genérico (R7.2); ver L3.
- **B2/B3 (PII en logs / over-fetch):** cubierto — R7.3 no loguea PII; `record`/`old_record`/email expuestos solo a staff (R7.4, círculo de confianza documentado).
- **D1 (service_role en cliente):** cubierto — cliente solo con anon key pública; `SUPABASE_DB_URL`/`SUPABASE_SERVICE_ROLE_KEY` solo en la EF.
- **D2 (Deno imports pineados):** ver **M3** (Postgres.js) y **M1** (esm.sh/supabase-js).
- **D3 (secrets hardcoded):** n/a en spec — verificar en `code` (allowlist de staff por secret, no hardcode).
- **E1 (queries sin tope):** cubierto — `limit` cap 100 + cursor (R3.1-R3.4).
- **E2 (Denial-of-Wallet):** n/a — sin email/SMS/API externa.
- **F1 (PostgREST/SQL filter injection):** ver **M2** — compromiso de parametrización; verificar en `code`.
- **H (auth/sesión):** cubierto — JWT en memoria `persistSession:false` (design §3.2, R6.2); token ~1h; re-login al recargar.
- **I3 (mobile hardening / `noindex`):** cubierto — `_headers` con `noindex,nofollow` + `X-Frame-Options: DENY` + `Referrer-Policy` + CSP (design §3.4, R6.10).

## Dominios excluidos (con justificación)

- **C (offline/sync PowerSync/Realtime/data-at-rest):** n/a — herramienta web de escritorio, no corre en la app RN, no toca PowerSync/SQLite local (design §5). La no-fuga de `audit` a devices ya está cubierta por el frontier de sync streams (nota en 0124, no es de esta feature).
- **G (BLE):** n/a — sin hardware.
- **F2/F3/F4 (import de archivos / SSRF / XSS en email):** n/a — la EF no ingiere archivos, no hace `fetch()` a URLs del usuario, no manda email. (El render del diff en el cliente inserta `record` como texto/lista de campos, no como HTML — verificar en `code` que la web escapa los valores del `record` al pintarlos, para no auto-XSSear a staff con un valor de campo malicioso; carga a Gate 1 modo `code` / veto de diseño web.)
- **A2/A3, E2:** n/a por ser read-only sin costo externo (arriba).

---

## Qué debe foldearse antes de Puerta 1 (o cargarse al Gate 1 de modo `code`)

1. **M1** — vendorear supabase-js (o pin exacto + SRI) en la web: foldear en design §3.1.
2. **M2** — (a) design §2.4: dejar explícito el compromiso de armado del WHERE solo con tagged-template/`sql([])`, sin `sql.unsafe`/concat, y el trade-off del rol privilegiado impuesto por R4.4; (b) el Gate 1 de modo `code` DEBE verificarlo sobre el diff.
3. **M3** — pin exacto de `npm:postgres` + `deno.lock`: foldear en design §2.4.
4. **L1/L2/L3** — mejoras menores; foldear en design §2.3/§2.4 si se quiere, o dejarlas como notas de implementación.

Ninguno es HIGH ni bloquea Puerta 1. El Gate 1 de modo `code` (con `sentry-skills:security-review` sobre el diff del implementer) sigue siendo obligatorio antes de mostrar al humano.
