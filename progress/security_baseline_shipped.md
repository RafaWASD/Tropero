# Security Baseline — Código ya MERGEADO (auditoría one-off)

**Modo**: AUDITORÍA BASELINE (estado actual, NO diff). Revisión manual guiada por el Catálogo de dominios de seguridad RAFAQ (A–I) de `.claude/agents/security_analyzer.md`. Read-only — no se modificó código.

**Fecha**: sesión de baseline. **Alcance**: 8 Edge Functions + 6 shared, inputs de usuario (utils + pantallas), cliente Supabase, RLS/migrations, config.toml, servicios de lista/búsqueda.

**Premisa del rubric**: RLS NO es la única frontera entre tenants. El service-role la bypassea y el cliente puede pegar a PostgREST directo (los topes/selects del cliente Expo son attacker-controlled). Toda la auditoría mide contra eso.

---

## Resumen ejecutivo

| Severidad | Cantidad | IDs |
|-----------|----------|-----|
| **HIGH**  | 3 | B3-1 (PII coworkers vía RLS column-level), INPUT-1 (sin tope server-side en NINGUNA columna de texto), H2-1 (password server min 6 vs cliente 8) |
| **MEDIUM**| 6 | B1-1 (`err.message` crudo ×32), E2-1 (EF sin rate limit propio), E3-1 (captcha off + email sin confirmación), A1-1 (`animals` UPDATE cross-tenant `with check (true)`), F1-1 (buscador: metacaracteres `.or()` no escapados + término sin tope), H1-1 (sesión no invalidada al remover/degradar miembro) |
| **LOW**   | 4 | E4-1 (enumeration already_member/pending_exists), I1-1 (delete_account no documenta retención SENASA real), C3-1 (web localStorage para tokens — solo target de verificación), CORS-1 (`*` en EFs) |

**Por dominio del catálogo:**
- **A (authz objeto/función)**: 1 HIGH-adyacente reclasificado MEDIUM (A1-1), resto del patrón EF es **correcto** (service-role bien scopeado por `requireOwnerOf`, inserts campo-por-campo → A2/A4 OK).
- **B (exposición de datos)**: 1 HIGH (B3-1), 1 MEDIUM (B1-1 ×32 ocurrencias / 8 EFs).
- **C (offline/sync)**: PowerSync NO wired aún (diferido, C5) → C1/C2/C4 **no auditables hoy**. C3 parcial (LOW).
- **D (secretos/supply chain)**: **LIMPIO**. D1 OK (cliente solo anon key), D3 OK (sin `console.log` de secrets en `app/src`, service_role solo en harness e2e).
- **E (abuso/escala)**: 1 MEDIUM (E2-1), 1 MEDIUM (E3-1), 1 LOW (E4-1). E1 **bien mitigado** (`.limit()` + `max_rows=1000`).
- **F (inyección/ingesta)**: 1 MEDIUM (F1-1). F2 N/A (import es spec 12, no shippeado). F3 N/A (no hay fetch a URL de usuario). F4 OK (`escapeHtml` en email).
- **G (BLE)**: spec 04 activa pero NO shippeada en este código → **no auditable** (field-findings.md en progreso).
- **H (auth/sesión)**: 1 HIGH (H2-1), 1 MEDIUM (H1-1).
- **I (compliance)**: 1 LOW (I1-1).

---

## Findings

### Dominio A — Autorización a nivel de objeto y función

**A1-1 (MEDIUM) — `animals` UPDATE con `with check (true)` permite mutación cross-tenant de un animal compartido**
- `supabase/migrations/0022_rls_animals_and_profiles.sql:34-40`
- Evidencia:
  ```sql
  create policy animals_update on public.animals for update using (
    exists (select 1 from public.animal_profiles ap
            where ap.animal_id = animals.id and has_role_in(ap.establishment_id))
  ) with check (true);
  ```
- Por qué es problema: `animals` es global (ADR-004). Si un mismo animal tiene perfil en el campo A y en el campo B (transferencia, animal compartido), cualquier usuario con rol en CUALQUIERA de esos campos puede hacer `UPDATE animals SET tag_electronic=..., sex=..., birth_date=...` y afecta al otro tenant. El `with check (true)` no re-valida nada post-update. La fuga es de **integridad** (no de lectura): un operario del campo A reescribe el `tag_electronic` (EID SENASA) que ve el campo B. En MVP single-beta el blast radius es bajo, por eso MEDIUM y no HIGH, pero es explotable en cuanto haya animales multi-perfil.
- Fix recomendado: el `with check` debería re-afirmar `has_role_in` sobre algún perfil del animal, y considerar hacer `tag_electronic` inmutable post-asignación (ya hay `0036_immutability_identifiers.sql` — verificar que cubra este caso desde el cliente, no solo desde RPC).

**A2 / A4 — SIN findings (patrón correcto, documentar como verde).**
- Las 8 EFs arman el objeto del `.insert()/.update()` **campo por campo** (nunca spread del body). `role`/`establishment_id`/`created_by`/`author_id`/`id` JAMÁS vienen del cliente: `invite_user` setea `invited_by: user.id` del JWT; `accept_invitation` setea `user_id: user.id`; los triggers setean `created_by`/`author_id` desde `auth.uid()`. **A2 OK.**
- Cada EF que requiere owner llama `requireOwnerOf(adminClient, user.id, establishmentId)` ANTES de mutar (`invite_user`, `cancel_invitation`, `resend_invitation`, `change_member_role`, `remove_member`). `register_push_token` y `accept_invitation` son self-scoped (`user.id` del JWT). `delete_account` deriva identidad SOLO del JWT (IDOR cerrado, documentado). **A4 OK.**
- `requireOwnerOf` usa admin-client pero está **correctamente scopeado a mano** (`.eq('user_id', userId).eq('establishment_id', establishmentId).eq('role','owner').eq('active',true)`). **A1 de las EFs: OK** (ver tabla service-role abajo — todas las queries admin están scopeadas por tenant + rol).
- El RPC `delete_account_tx` (SECURITY DEFINER, toma `p_user_id`) tiene `revoke all from public, authenticated, anon` + smoke-check fail-closed (`0058`). IDOR catastrófico **cerrado y verificado**. Idem funciones internas de gating (`0055`).

### Dominio B — Exposición de datos

**B3-1 (HIGH) — PII de coworkers (phone + email) legible por cualquier miembro del campo vía PostgREST directo**
- `supabase/migrations/0006_rls_users.sql:16-31` (policy `users_select_coworkers`)
- Evidencia (la propia migration lo admite):
  ```sql
  -- "en SQL la policy igualmente cubre la fila completa porque RLS no filtra columnas.
  --  Por ahora, los clientes deben hacer `select id, name from users where ...`."
  create policy users_select_coworkers on public.users for select to authenticated
    using ( deleted_at is null and exists ( ... comparten establishment activo ... ) );
  ```
- Por qué es problema: RLS es **row-level, no column-level**. La policy expone la fila COMPLETA de `users` (incluye `phone`, `email`) de todo coworker. El cliente "cumple" pidiendo solo `id, name` (`app/src/services/members.ts:187`), pero eso es un control **client-side y bypasseable**: un usuario con rol en el campo hace `GET /rest/v1/users?select=phone,email,name&...` y extrae teléfono+email de todos sus compañeros. Es explotable HOY (no requiere service-role, solo el JWT de un miembro). PII regulada (Ley 25.326 AR).
- Fix recomendado: **REQUIERE_DECISION_ARQUITECTONICA** sobre el patrón column-level. Tres opciones: (a) una `view` de perfil mínimo (`users_public` con solo `id, name`) + revocar `select` directo sobre `users` para coworkers, dejando la policy self-only sobre la tabla base; (b) `SECURITY DEFINER` function `get_coworkers(est_id)` que devuelve solo `id, name`; (c) column-level GRANTs de Postgres (`grant select (id, name) on users`) combinados con la policy. La (a) es la que la propia migration anticipa ("vía view en una migration futura T5.1"). El leader debe decidir antes de multi-tenant real con >1 beta.

**B1-1 (MEDIUM) — `err.message` / `error.message` crudo de Postgres devuelto al cliente (32 ocurrencias / 8 EFs)**
- Ocurrencias `jsonError(5xx, 'db_error'|'unexpected', ...message)`:
  - `accept_invitation/index.ts`: 48, 83, 103, 115, 183 (`unexpected`)
  - `change_member_role/index.ts`: 63, 86, 104, 123, 132 (`unexpected`)
  - `delete_account/index.ts`: 65, 84, 100, 114, 145, 188 (`unexpected`)
  - `invite_user/index.ts`: 85, 105, 135, 152 (`unexpected`)
  - `remove_member/index.ts`: 55, 74, 93, 102 (`unexpected`)
  - `resend_invitation/index.ts`: 47, 76, 92 (`unexpected`)
  - `cancel_invitation/index.ts`: 41, 65, 74 (`unexpected`)
  - `register_push_token/index.ts`: 76, 85 (`unexpected`)
  - + shared: `_shared/auth.ts:44` (`requireOwnerOf` propaga `error.message` — alcanza a TODAS las EFs que llaman requireOwnerOf).
- Evidencia: `return jsonError(500, 'db_error', existingErr.message);` y el catch genérico `return jsonError(500, 'unexpected', (err as Error).message);`.
- Por qué es problema: filtra detalles internos de Postgres/Deno al cliente (nombres de tabla/columna/constraint, paths, mensajes de driver). El `unexpected` es el más riesgoso: puede ser CUALQUIER excepción (incluida una que contenga datos). No es un leak de PII directo, por eso MEDIUM, pero es information disclosure sistemático que ayuda a un atacante a mapear el schema. (Distinto de `console.error`, que SÍ es correcto — el detalle debe ir solo a logs server.)
- Fix recomendado: en `jsonError`, devolver un mensaje genérico al cliente (`'Error interno'`) y loggear el `.message` real con `console.error`. Patrón: un solo helper `serverError(code)` que loguea internamente y nunca propaga `.message`.

**B2 — sin findings.** No hay logging de PII en claro hacia analytics/Sentry en `app/src` (no hay Sentry wired aún; `console.error` server-side de las EFs es aceptable).

### Dominio E — Abuso y disponibilidad a escala

**E2-1 (MEDIUM) — Edge Functions custom SIN rate limit / cuota propia (Supabase no las limita por defecto)**
- `invite_user`, `accept_invitation`, `resend_invitation` corren sin cuota propia. La que tiene **costo real** (denial-of-wallet) es la cadena `invite_user → accept_invitation`: `accept_invitation` dispara `sendInvitationAcceptedEmail` (Resend, `_shared/email.ts`) + `sendExpoPush` por cada aceptación. Un owner malicioso (o con credenciales comprometidas) puede crear N invitaciones y un atacante con N cuentas aceptarlas → N emails Resend + N push, sin tope por-establishment.
- Por qué MEDIUM y no HIGH: el email de Resend hoy es **best-effort** (`no_key` si no hay `RESEND_API_KEY` configurada — y hoy no lo está, por el comentario de `email.ts`), así que el costo real está latente, no activo. En cuanto se configure la key, sube a HIGH.
- Fix recomendado: cuota propia keyeada per-`establishment_id` (no per-IP, es abuso autenticado) en las EFs que mandan email/push, fail-closed. Ej. tabla `rate_limits(establishment_id, action, window, count)` chequeada al inicio de la EF.
- Nota: el `[auth.rate_limit]` nativo (`config.toml`) cubre login/signup/OTP y está en valores razonables (`email_sent=2/h`, `sign_in_sign_ups=30/5min`) — **NO** fue aflojado. El lockout cliente (`lockout.ts`) es UX sobre ese rate-limit nativo, no cuenta como control server-side propio.

**E3-1 (MEDIUM) — captcha OFF + email-confirmation OFF → registro masivo de cuentas no verificadas**
- `supabase/config.toml`: `[auth.captcha]` comentado (línea 208-212, off); `[auth.email] enable_confirmations = false` (línea 221).
- Por qué es problema: sin captcha y sin confirmación de email, un bot puede crear cuentas en masa (limitado solo por `sign_in_sign_ups=30/5min` por IP, fácil de rotar). Peor: `requireUser` (`_shared/auth.ts`) acepta cualquier `email` presente en el JWT sin chequear `email_confirmed` → un atacante se registra con un email **ajeno** sin verificarlo y queda autenticado. Combinado con el modelo bearer de invitaciones (cualquier logueado con el link acepta), amplía la superficie.
- Fix recomendado: activar captcha (hcaptcha/turnstile) en signup antes de producción; evaluar `enable_confirmations = true` (o al menos exigir `email_confirmed` en `requireUser` para operaciones sensibles). REQUIERE_DECISION sobre el trade-off UX de confirmación de email en el flujo de campo.

**E1 — sin findings (bien mitigado).** `fetchAnimals` usa `.limit(200)`; `searchAnimals` `.limit(20)` por sub-query; `count*` usa `head:true`. Además `[api] max_rows = 1000` (config.toml) topea TODA query PostgREST a 1000 filas server-side, incluso sin `.limit()` explícito. Defensa en profundidad correcta.

**E4-1 (LOW) — enumeration de membresía/invitación**
- `invite_user/index.ts:87-93` (`already_member`), `96-113` (`pending_exists`); `accept_invitation/index.ts:85-91` (`already_member`).
- Respuestas distintas confirman si un email ya es miembro / tiene invitación pendiente. Solo accesible a un owner del campo (no a cualquiera), por eso LOW. No uniformar timing en MVP.

### Dominio F — Inyección e ingesta

**F1-1 (MEDIUM) — buscador: `escapeIlike` no neutraliza todos los metacaracteres de `.or()` + término sin tope de largo server-side**
- `app/src/services/animals.ts:341-343` (`escapeIlike`), `:318` (`.or(\`visual_id_alt.ilike.%${escapeIlike(term)}%\`)`).
- Evidencia:
  ```ts
  function escapeIlike(term: string): string { return term.replace(/[%_,]/g, ' '); }
  // ...
  .or(`visual_id_alt.ilike.%${escapeIlike(term)}%`)
  ```
- Por qué es problema: `escapeIlike` solo reemplaza `% _ ,`. La sintaxis de filtro PostgREST de `.or()` usa además `.` (separador campo.op.valor), `(` `)` (agrupación), `:` y `*`. Un término del buscador con esos caracteres puede **alterar la estructura del filtro `.or()`** (PostgREST filter injection, F1) — ej. inyectar una condición adicional o un campo distinto. El término viene del `TextInput` del buscador (`animales.tsx:381`, sin `maxLength`), es texto libre 100% attacker-controlled, y NO se acota el largo (un término de 10k chars va directo a la query → DoS menor del parser PostgREST). Las sub-queries que usan `.ilike(col, pattern)` directo (no `.or()`) son más seguras (el valor va parametrizado), pero la rama `.or()` de visual construye el string de filtro manualmente.
- Por qué MEDIUM y no HIGH: el scope `establishment_id + status + deleted_at + has_role_in` (RLS) acota el blast radius a filas del propio tenant; lo peor explotable es ver/filtrar de forma rara filas dentro del MISMO campo (no cross-tenant) o romper la query. No verifiqué un PoC de cross-column read, por eso no escalo a HIGH — pero el patrón de construir filtro `.or()` con input de usuario insuficientemente escapado es la clase de defecto F1 y debe cerrarse.
- Fix recomendado: (a) usar la forma parametrizada de PostgREST (`.ilike(column, pattern)`) en vez de `.or()` con string interpolado, o escapar TODO el set de metacaracteres de `.or()` (`%_,.():*` y comillas); (b) acotar el largo del término server-side (rechazar > N chars en el service antes de la query) y agregar `maxLength` al `TextInput` (UX). Cruza con INPUT-1.

**F4 — OK.** `_shared/email.ts:88-95` escapa `& < > " '` con `escapeHtml` en TODOS los campos del template de invitación (`ownerName`, `newMemberName`, `newMemberEmail`, `establishmentName`). XSS/HTML injection en email **cubierto**.

### Dominio — Validación de inputs (transversal, cruza con todos)

**INPUT-1 (HIGH) — NINGUNA columna de texto de usuario tiene tope de longitud server-side; los topes viven SOLO en el cliente (UX, bypasseable)**
- Evidencia de schema (todas `text` sin `varchar(n)` ni `CHECK length`):
  - `animals.tag_electronic` (`0019:9`), `animal_profiles.idv/visual_id_alt/breed/coat_color/notes/entry_origin/exit_reason` (`0020:18-31`), `establishments.name/province/city` (`0002:11-12`), `users.name/email/phone` (`0001:11-13`), `animal_events.text` (`0034:13`).
  - Grep de `varchar|CHECK length` en TODAS las migrations → único match: `octet_length(config::text) < 16384` en `sessions`/`maneuver_presets` (JSON config, no texto de usuario). Los únicos CHECK sobre texto son `length(trim(name)) > 0` (no-vacío, `0002:22-23`) — un piso, no un techo.
- Los topes existen únicamente en el cliente: `validation.ts` (`NAME_MAX_LENGTH=80`, `PHONE_MAX_DIGITS=15`), `animal-input.ts` (`TAG_ELECTRONIC_LENGTH=15`, `IDV_MAX_LENGTH=20`, `VISUAL_MAX_LENGTH=30`, `WEIGHT_INTEGER_MAX_DIGITS=4`), `event-input.ts` (`OBSERVATION_MAX_LENGTH=1000`). Son sanitizadores `onChangeText` + validadores de submit — **UX, attacker-controlled** (el propio `validation.ts:6` dice "el backend hace la validación autoritativa", pero la DB NO la hace).
- Cómo llega al server sin tope: el cliente escribe a PostgREST **directo** (`animals.ts`, `events.ts`: `supabase.from('animal_profiles').insert(payload)`, `from('animal_events').insert({text})`), no vía Edge Function con guards. `cleanStr` solo hace `trim` (no acota largo). Un atacante con JWT de miembro hace `POST /rest/v1/animal_events {text: "<varios MB>"}` o `idv` de 100k chars → se persiste. Vector: storage exhaustion / amplificación de payload / desbordar UI de otros usuarios del campo. (Mitigado parcialmente por el límite de body HTTP de la plataforma Supabase, pero NO por la app — y ese límite es del orden de MB, suficiente para abuso.)
- Por qué HIGH: es el requisito explícito de Raf ("límites claros y validación AUTORITATIVA server-side en cada formulario"). Hoy NINGÚN campo de texto lo cumple del lado server. Es transversal (todos los forms shippeados). Explotable con solo el JWT.
- Fix recomendado: agregar `CHECK (char_length(col) <= N)` (o `varchar(N)`) a cada columna de texto de usuario, con N = el tope que ya define el cliente (single source of truth). Para los inserts que pasan por el cliente directo, el CHECK de DB es la única capa autoritativa posible (no hay EF intermedia). Donde haya EF, sumar guard `typeof x==='string' && x.length<=N`.

Ver **Tabla de inputs** abajo para el detalle campo por campo.

### Dominio H — Autenticación y sesión

**H2-1 (HIGH) — password mínimo server = 6, mientras el cliente exige 8 (desalineamiento; el server es la autoridad)**
- `supabase/config.toml:177`: `minimum_password_length = 6`. Cliente: `validation.ts:10` `PASSWORD_MIN_LENGTH = 8`.
- Por qué es problema: la autoridad real es el server (Supabase Auth). El cliente valida 8, pero el flujo de signup/reset puede setear un password de 6 (pegando al endpoint de Auth directo, o vía un cliente alternativo). El catálogo H2 asumía "hoy min 8" — el server real está en **6**, más débil de lo documentado. `password_requirements = ""` (sin complejidad). Además `enable_signup=true` + sin captcha (E3-1).
- Por qué HIGH: es un control de credenciales más débil de lo que el equipo cree (el cliente "miente" 8). Fix trivial pero el gap es real y afecta a TODO usuario.
- Fix recomendado: `minimum_password_length = 8` (alinear con el cliente) y considerar `password_requirements = "lower_upper_letters_digits"`.

**H1-1 (MEDIUM) — sesión/JWT no se invalida al remover o degradar a un miembro**
- `remove_member/index.ts` y `change_member_role/index.ts` hacen `user_roles.active = false` (+ insert del nuevo rol), pero NO revocan la sesión activa del target ni fuerzan refresh. El JWT del removido sigue válido hasta `jwt_expiry=3600` (1h).
- Por qué es problema: tras quitar a un operario, su JWT sigue funcionando hasta 1h. RLS (`has_role_in`) re-evalúa `active=true` en cada request, así que **pierde acceso a datos del campo de inmediato** (la RLS lo corta) — por eso MEDIUM y no HIGH. Pero las EFs que chequean rol vía `requireOwnerOf` (admin-client) también re-evalúan, así que el impacto residual es bajo. El caso real: con sesiones largas + offline (futuro PowerSync), un rol revocado podría re-autorizar mutaciones encoladas (C4, no auditable hoy).
- Fix recomendado: en `remove_member`/`change_member_role`, llamar `adminClient.auth.admin.signOut(targetUserId)` o revocar refresh tokens del target (patrón que `delete_account` ya usa para sí mismo). Documentar el modelo de invalidación.

**H3 — token en URL: aceptado por ADR-014.** `/invite?token=` — TTL 7 días (`INVITATION_TTL_DAYS`), single-use efectivo (status→accepted), regenerable (`resend_invitation` rota el token, mata el viejo). El token NO se loggea en `app/src`. Modelo aceptado, sin finding nuevo.

### Dominio C — Offline / sync

**C3-1 (LOW) — tokens en localStorage en web (fallback); SecureStore en native**
- `app/src/services/supabase.ts:46-68`: native → `expo-secure-store` (Keychain/Keystore, **correcto**); web → `localStorage` (o Map en memoria).
- Web es el **target de verificación** (E2E/dev), no el producto (el producto es la app móvil). En native los tokens van a SecureStore. Por eso LOW. C1/C2/C4 (PowerSync sync rules, Realtime, stale-auth replay) **NO auditables hoy** — PowerSync no está wired (diferido a C5, ADR-002). Marcar para re-auditar cuando se conecte: las sync rules son autorización PARALELA a RLS y la SQLite local debe ir encriptada en reposo (C3 real).

### Dominio I — Compliance

**I1-1 (LOW) — delete_account es soft-delete (correcto para retención SENASA) pero el modelo de retención/purga real no está cerrado**
- `delete_account/index.ts` + `0058`: soft-delete (`users.deleted_at`) + ban 100 años + desactiva roles. NO purga (preserva fila para retención SENASA, documentado). Esto es razonable para I2 (audit append-only), pero el derecho de supresión de la Ley 25.326 AR (borrado real bajo pedido) no tiene flujo. LOW en MVP; documentar la política de retención antes de producción.

### CORS

**CORS-1 (LOW) — `Access-Control-Allow-Origin: *` en todas las EFs**
- `_shared/cors.ts:7`. Documentado como "ajustar a dominios oficiales en producción". Las EFs validan JWT igual (CORS no es el control de auth), por eso LOW, pero cerrar antes de producción.

---

## Tabla de inputs (campo por campo)

Leyenda validación: **server** = CHECK/varchar de DB o guard de Edge Function (autoritativa) · **solo-cliente** = solo sanitizador/validador RN (UX, bypasseable) · **ausente**.

| Campo | Tope (cliente) | Validación autoritativa server | OK? |
|-------|----------------|-------------------------------|-----|
| `users.name` (signup/perfil) | 80 (`NAME_MAX_LENGTH`) | solo-cliente (DB: `text`, sin tope; solo not-null vía trigger) | ❌ INPUT-1 |
| `users.phone` (perfil/alta campo) | 20 chars / 8-15 díg | solo-cliente (DB: `text`) | ❌ INPUT-1 |
| `users.email` (signup) | formato regex | server (Supabase Auth valida formato) — pero largo sin tope en `public.users.email` | ⚠️ parcial |
| password (signup) | min 8 (`PASSWORD_MIN_LENGTH`) | server min **6** (más laxo que cliente) | ❌ H2-1 |
| `establishments.name` | no-vacío | server (CHECK not-empty) pero SIN tope superior | ⚠️ parcial |
| `establishments.province/city` | no-vacío | server (not-empty) sin tope | ⚠️ parcial |
| `animals.tag_electronic` (caravana) | 15 díg exacto (`TAG_ELECTRONIC_LENGTH`) | solo-cliente para el LARGO (DB: `text` + unique index, sin CHECK de formato/largo) | ❌ INPUT-1 |
| `animal_profiles.idv` | 20 díg (`IDV_MAX_LENGTH`) | solo-cliente (DB: `text` + unique parcial) | ❌ INPUT-1 |
| `animal_profiles.visual_id_alt` | 30 chars (`VISUAL_MAX_LENGTH`) | solo-cliente (DB: `text`) | ❌ INPUT-1 |
| `animal_profiles.breed/coat_color` | sin tope cliente | ausente | ❌ INPUT-1 |
| `weight_events.weight_kg` | >0, <10000 (`validateWeight`) | **server OK** (`numeric(7,2)` + CHECK >0 en 0025) | ✅ |
| `condition_score_events.score` | selector cerrado 17 valores | **server OK** (CHECK enum 0028) | ✅ |
| `reproductive_events.pregnancy_status/service_type` | selector cerrado | **server OK** (enum) | ✅ |
| `animal_events.text` (observación) | 1000 (`OBSERVATION_MAX_LENGTH`) | solo-cliente (DB: `text` sin tope) | ❌ INPUT-1 |
| fecha eventos (`event_date`) | máscara AAAA-MM-DD + no-futura | server parcial (`date` valida formato; "no futura" solo cliente) | ⚠️ parcial |
| término del buscador (`animales.tsx`) | SIN `maxLength` | ausente (va a `.ilike()`/`.or()` sin tope ni escape completo) | ❌ F1-1 / INPUT-1 |
| `invite_user.email` (anotación) | trim + `includes('@')` | server (guard en EF, `invite_user:52-58`) — formato mínimo, largo sin tope | ⚠️ parcial |
| `invite_user.role` / `change_member_role.new_role` | — | **server OK** (`ALLOWED_ROLES` set en EF) | ✅ |
| `register_push_token.expo_push_token` | — | server parcial (guard `typeof string` + trim, sin validar formato Expo ni largo) | ⚠️ parcial |

**Veredicto inputs**: la mayoría de los campos de TEXTO LIBRE (nombre, identificadores, observación, búsqueda) NO tienen tope server-side (INPUT-1, HIGH). Los campos de SELECTOR CERRADO y NUMÉRICOS (peso, score, enums) SÍ están bien respaldados por la DB. Esto bloquearía un PASS bajo el rubric de Raf ("límite + validación server por cada campo").

---

## Tabla de rate limits (acciones abusables)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|--------|-----------|-------|-------------|------|
| login / signup / OTP | **sí** (nativo) | per-IP (`sign_in_sign_ups=30/5min`, `token_verifications=30/5min`) | sí (Auth nativo) | `config.toml` razonable, NO aflojado |
| email transaccional (Auth) | sí (`email_sent=2/h`) | per-proyecto | sí | nativo |
| `invite_user` (crea invitación) | **no** | — | — | E2-1: sin cuota propia (no manda email directo, pero alimenta accept) |
| `accept_invitation` (→ Resend email + push) | **no** | — | — | E2-1 MEDIUM: costo por request (email+push), latente hoy (Resend sin key) |
| `resend_invitation` (rota token) | **no** | — | — | barato, pero sin cuota |
| `change_member_role` / `remove_member` | **no** | — | — | baratas (solo DB), abuso bajo; A4 las protege por owner-only |
| `register_push_token` (upsert) | **no** | — | — | barata, self-scoped |
| `delete_account` | **no** | — | — | self-scoped + idempotente, abuso bajo |
| buscador `searchAnimals` | **no** (term sin tope) | — | — | F1-1: término sin acotar largo → DoS menor del parser, dentro del tenant |
| lockout cliente (`lockout.ts`) | N/A | — | — | UX sobre el rate-limit nativo, **NO** es control server-side |

**Veredicto rate limits**: el Auth nativo está bien. NINGUNA Edge Function custom tiene cuota propia (Supabase no las limita por defecto) — finding conocido E2-1, hoy MEDIUM porque la de costo real (email) está latente; sube a HIGH al configurar `RESEND_API_KEY`.

---

## Tabla service-role (cada query con admin-client)

Todas las EFs usan `createAdminClient()` (bypassea RLS). Verificación: ¿scopeada por tenant + rol del caller chequeado?

| Función | Query admin | ¿Scopeada por tenant? | ¿Rol del caller chequeado? |
|---------|-------------|----------------------|---------------------------|
| `_shared/auth.ts` `requireOwnerOf` | `user_roles` SELECT `.eq(user_id).eq(establishment_id).eq(role,owner).eq(active)` | sí (establishment_id) | ES el chequeo de rol |
| `invite_user` | `user_roles` precheck member + `invitations` precheck pending + `invitations` INSERT | sí (`.eq(establishment_id)`) | sí (`requireOwnerOf` antes) |
| `accept_invitation` | `invitations` lookup by token + `user_roles` check existing + INSERT + UPDATE + lookups notif | self (`user.id` del JWT) + token bearer | self-scoped (bearer por diseño ADR-014) |
| `cancel_invitation` | `invitations` lookup + UPDATE | sí (deriva est del lookup → `requireOwnerOf`) | sí |
| `resend_invitation` | `invitations` lookup + UPDATE | sí (deriva est → `requireOwnerOf`) | sí |
| `change_member_role` | `user_roles` lookup target + count owners + UPDATE + INSERT | sí (`.eq(establishment_id)`) | sí (`requireOwnerOf`) |
| `remove_member` | `user_roles` lookup + count owners + UPDATE | sí (`.eq(establishment_id)`) | sí (`requireOwnerOf`) |
| `register_push_token` | `push_tokens` UPSERT | self (`user_id: user.id`) | self-scoped |
| `delete_account` | `users` read + `user_roles` read + `establishments` read + count + RPC | self (`user.id` del JWT) | self-scoped (IDOR cerrado) |
| `_shared/push.ts` `sendExpoPush` | `push_tokens` SELECT/DELETE `.eq(user_id, recipient)` | sí (recipient = owner) | N/A (server-driven) |

**Veredicto service-role**: TODAS las queries admin están correctamente scopeadas por `establishment_id` o por `user.id` del JWT, con el rol del caller chequeado vía `requireOwnerOf` donde corresponde. **A1 a nivel Edge Functions: LIMPIO.** El único A1-adyacente es a nivel RLS de cliente (A1-1, la policy `animals_update with check (true)`), no en las EFs.

---

## Archivos analizados

- Edge Functions (8): `invite_user`, `accept_invitation`, `cancel_invitation`, `resend_invitation`, `change_member_role`, `remove_member`, `register_push_token`, `delete_account` (`/index.ts`).
- Shared (6): `_shared/{auth,supabase,errors,push,email,cors}.ts`.
- Inputs cliente: `app/src/utils/{validation,animal-input,event-input}.ts`, `app/src/utils/animal-identifier.ts`.
- Pantallas: `app/app/(tabs)/animales.tsx` (buscador); enumeradas `(auth)/*`, `crear-animal/agregar-evento/crear-rodeo` (vía servicios).
- Servicios: `app/src/services/{supabase,animals,events,members}.ts`.
- Cliente Supabase: `app/src/services/supabase.ts` (D1 confirmado), `app/e2e/helpers/admin.ts` (service_role solo en harness).
- Migrations: `0001_users`, `0002_establishments`, `0005_rls_helpers`, `0006_rls_users`, `0008_rls_membership`, `0019_animals`, `0020_animal_profiles`, `0021_animal_profiles_validations`, `0022_rls_animals_and_profiles`, `0034_animal_events`, `0055_check_grants`, `0058_delete_account_rpc` + grep transversal de `varchar/CHECK length` sobre las 58 migrations.
- `supabase/config.toml` (auth, rate_limit, captcha, api max_rows).

## Excluidos (con justificación)

- **PowerSync sync rules (C1) / Realtime (C2) / stale-auth replay (C4) / SQLite-at-rest (C3 real)**: PowerSync NO está wired (diferido a C5, ADR-002). No auditable sobre el código actual. **Re-auditar al conectarlo** — son autorización PARALELA a RLS.
- **BLE / bastón (G1-G3)**: spec 04 activa pero NO shippeada en este snapshot (`field-findings.md` en progreso). Las lecturas EID se validarán como input cuando se implemente.
- **Import masivo / CSV (F2)**: spec 12, solo Gate 0 (context), sin código. No auditable.
- **SSRF (F3)**: no hay ninguna EF que haga `fetch()` a una URL influenciada por el usuario. Los únicos `fetch` son a hosts fijos (`exp.host`, `api.resend.com`). N/A.
- **CI/CD (D4)**: no se revisó `.github/workflows` en esta pasada (fuera del alcance priorizado; usar `sentry-skills:gha-security-review` aparte si aplica).
- **Skill `sentry-skills:security-review`**: NO se corrió — es diff-oriented y este es un baseline del estado actual (instrucción explícita del modo). Revisión manual guiada por catálogo.

## Escalamientos al leader (REQUIERE_DECISION_ARQUITECTONICA)

1. **B3-1** (column-level PII de coworkers): el patrón actual confía en que el cliente pida solo `id, name`. Cerrar con view/RPC/column-grants es decisión de patrón (se va a replicar en toda lectura de PII multi-miembro). El leader debe elegir antes de >1 beta.
2. **E3-1** (captcha + email-confirmation off): trade-off UX vs. defensa anti-bot en el flujo de campo. Decisión de producto/seguridad.
