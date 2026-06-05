# Security Gate 2 (code) — Spec 14 `14-pii-user-private`

**Veredicto: PASS**

Gate de seguridad sobre el ARTEFACTO (código + SQL) antes del deploy destructivo coordinado.
Auditoría ESTÁTICA: la migración 0068 NO está aplicada al remoto (deploy gateado), así que
NO se corrió la skill `sentry-skills:security-review` contra estado aplicado ni se asumió
schema migrado. Se auditó el SQL/código tal como se aplicará.

Baseline: `77a1ff204dac5c52831df747e73dce84c775771b` (registrado en `impl_14-pii-user-private.md`).
Trabajamos sobre `main`; los cambios de la feature están sin commitear en el working tree
(diff baseline..HEAD vacío; el set real es el `git status --porcelain` de abajo).

---

## Alcance auditado (solo feature 14)

- `supabase/migrations/0068_user_private_pii.sql` — artefacto crítico.
- `supabase/functions/invite_user/index.ts` — precheck re-ruteado.
- `supabase/functions/accept_invitation/index.ts` — owner-email lookup re-ruteado.
- `app/src/services/profile.ts` — `loadProfileNamePhone`.
- `app/src/services/establishments.ts` — `loadOwnProfile`/`saveOwnPhone`/`loadFullProfile`/`saveProfile`.
- `app/e2e/helpers/admin.ts` — `setUserPhone` (M-1).
- `supabase/tests/user_private/run.cjs` — suite RLS/trigger/EF.

C3.2 (otra feature, sin commitear) **NO** auditada, según instrucción.

---

## 1. ¿B3-1 cerrado en la implementación? — SÍ

El finding HIGH B3-1 era: la PII de contacto (email, phone) vivía en `public.users`, y la
policy `users_select_coworkers` (0006:16-31) expone la **fila COMPLETA** (RLS de Postgres es
row-level, no column-level). El cliente "cumplía" pidiendo `select id, name`, pero un coworker
podía pegar PostgREST directo (`select email,phone`) y leer el contacto ajeno. Verificado el
vector en `0006_rls_users.sql:13-15` (el propio comentario lo admite: "en SQL la policy
igualmente cubre la fila completa porque RLS no filtra columnas").

La implementación lo cierra **físicamente**, que es la única forma correcta (la separación
también cierra el canal WAL → realtime/PowerSync, no solo PostgREST):

- **`public.users` ya no tiene email/phone**: `0068:96` — `alter table public.users drop column
  email, drop column phone`. Tras el drop, `users_select_coworkers` sigue exponiendo la fila
  completa, pero esa fila ya **no contiene contacto** → quedan `id, name, created_at, updated_at,
  deleted_at`. La policy de coworkers queda neutralizada respecto de PII sin tocarla. Correcto.
- **`user_private` RLS estrictamente self en SELECT Y UPDATE**:
  - `0068:105-108` `user_private_select_self` → `using (user_id = auth.uid())`, solo `authenticated`.
  - `0068:110-114` `user_private_update_self` → `using (user_id = auth.uid())` **y**
    `with check (user_id = auth.uid())`. El `with check` impide reapuntar `user_id` a otro en un
    UPDATE. No hay policy de coworkers ni de tenant sobre `user_private`. Self-only puro.
  - **Sin policy de INSERT ni DELETE** (`0068:99-101`): el insert lo hace solo el trigger de
    signup (SECURITY DEFINER, salta RLS); el ciclo de vida sigue a `users` por FK
    `on delete cascade` (`0068:29`).
- **¿Algún grant/policy/función que re-exponga PII a un coworker vía PostgREST?** — NO.
  - Grep de migrations: ninguna `create view` sobre `users` que reexponga email/phone; el único
    índice sobre `users(email)` era `users_email_active` (0001:23), dropeado explícitamente en
    `0068:95` ANTES del drop de columna (sin índice huérfano).
  - Lectores cross-user de PII SOLO vía admin-client (service-role) en las EFs, scopeados (ver §4).
    Nunca al rol `authenticated`.
  - `app/src/services/members.ts:287` selecciona `email` pero de la tabla **`invitations`** (email
    de anotación de invitación), no de `users`/`user_private` → no es PII de coworker. Verificado.
  - `resend_invitation/index.ts:43` lee `email` de `invitations`, nunca de `users` → sobrevive al
    drop y no reexpone contacto de perfil.

**Conclusión §1**: B3-1 cerrado en los tres canales (PostgREST + realtime + PowerSync/WAL). El
test T17 (`run.cjs:164-205`) ejerce el path real del bypass: coworker A pide `user_private` de B
(0 filas) y `users.select('email,phone')` de B (error: columnas inexistentes) — no asienta sobre
"el cliente pidió solo id,name", asienta sobre la imposibilidad física.

---

## 2. Grants / revokes / smoke-check — fail-closed, mínimo

`0068:199-256`:
- `grant select, update on public.user_private to authenticated` — mínimo (sin insert/delete).
- `grant all ... to service_role` — correcto (las EFs leen contacto vía admin-client).
- **Revokes explícitos** (defensa en profundidad, L-1): `revoke insert, delete ... from
  authenticated` + `revoke all ... from anon, public` (`0068:207-208`). Blindan contra un
  `grant all` accidental futuro.
- **Revoke nominal de EXECUTE** de las 2 funciones SECURITY DEFINER (`0068:214-215`) — son
  funciones-trigger, no se exponen por PostgREST, pero el revoke + smoke-check previene que un
  grant futuro las haga invocables como RPC. Patrón 0055/0065, consistente.
- **Smoke-check fail-closed** (`0068:220-256`): aborta la migración si authenticated/anon/public
  quedan con INSERT/DELETE sobre `user_private`, si anon tiene SELECT/UPDATE (R9.3), o si las
  funciones-trigger quedan EXECUTE-ables por roles cliente. Cubre los casos correctos.

El smoke-check NO cubre explícitamente "authenticated tiene SELECT/UPDATE" (esos son los grants
legítimos) — correcto, no es un hueco; la RLS self-only es lo que acota esos grants y está
testeada por T17/T18.

`notify pgrst, 'reload schema'` (`0068:259`) — refresca el cache de PostgREST (R9.4). OK.

---

## 3. Triggers SECURITY DEFINER

- **`handle_new_auth_user` reescrita** (`0068:123-147`): `security definer` + `set search_path =
  public` fijo. Inserta en `users(id, name)` y en `user_private(user_id, email)` con
  `on conflict do nothing` en ambos (idempotente). Ambos inserts en la misma transacción del
  INSERT en `auth.users` (atomicidad R5.2). Sin concatenación dinámica de SQL → sin vector de
  inyección. El `name` se deriva de `raw_user_meta_data->>'name'` con `split_part(new.email,'@',1)`
  como fallback — ambos van como valores parametrizados de un `insert ... values`, no como SQL
  ejecutado. Correcto.
- **`propagate_confirmed_email` nueva** (`0068:169-185`): `security definer` + `set search_path =
  public` fijo. Guarda con `new.email IS DISTINCT FROM old.email AND new.email IS NOT NULL` y hace
  un `update public.user_private set email = new.email where user_id = new.id`. Valor
  parametrizado, sin inyección. Trigger `after update of email on auth.users`.
  - **¿Filtra SOLO el email confirmado (R7.2)?** — SÍ. En GoTrue, durante un cambio de email
    PENDIENTE `auth.users.email` queda con el valor VIEJO (el nuevo vive en `email_change`); recién
    al CONFIRMAR `email` pasa a ser el nuevo. La condición `email cambió` se cumple ÚNICAMENTE en
    la confirmación. No depende de columnas internas frágiles (`email_change`/`new_email`) → robusto
    al shape. El test T23 R7.2 (`run.cjs:353-379`) ejerce el path real: `clientB.auth.updateUser`
    (pendiente, sin confirmar) → `user_private.email` NO cambia. Buen test (no solo happy path).
  - **Vector de escalación**: no escribe a `auth.*`, no ejecuta SQL dinámico, no lee input de
    cliente. El único riesgo es de desincronización (no de seguridad) si Supabase reescribe el flujo
    de email de GoTrue — documentado como L-2 en ADR-025, y mitigado porque `auth.users.email` es la
    fuente de verdad (un `user_private.email` stale solo afecta el precheck soft de invitación).
    Aceptable; no es finding de seguridad.

---

## 4. Edge Functions re-ruteadas — service-role scopeado, sin exponer PII al cliente

- **`invite_user`** (`index.ts:82-109`): precheck "ya es miembro" en 2 pasos vía **admin-client**
  (service-role, bypassa RLS — uso correcto y necesario: el email de un tercero no es legible por
  el caller con RLS self-only): `user_private` por `email` → `user_roles` por `user_id` **scopeado
  por `establishment_id` + `active = true`** (`:95-97`). El caller ya pasó `requireOwnerOf` (`:71`)
  antes del precheck → authz a nivel de función correcta. La PII (el `user_id` resuelto) NO se
  devuelve al cliente: la respuesta es `{invitation_id, token, accept_url, expires_at}` (`:157-162`).
  El email solo se persiste como anotación de la invitación. Precheck server-side. **A1/A3/B1 OK.**
- **`accept_invitation`** (`index.ts:124-144`): el email del owner se lee de `user_private` por
  `inv.invited_by` vía admin-client (`:129-133`); `inv.invited_by` sale de la invitación resuelta
  por el `token` validado (`:42-46`), no de input del cliente → sin IDOR. El email del owner se usa
  SOLO como destino del mail best-effort (`sendInvitationAcceptedEmail`, `:148`), nunca se devuelve
  al caller. La respuesta es `{establishment_id, role}` (`:183-186`). El email del que ACEPTA sale
  del JWT (`user.email`, `_shared/auth.ts:16`), no de la DB. **A1/A3/B1 OK.**

**Nota B1 (no es finding de esta feature)**: ambas EFs devuelven `err.message` crudo al cliente en
los paths `db_error`/`unexpected` (`invite_user:88,99,121,151,168`;
`accept_invitation:48,...,192`). Es un patrón PREEXISTENTE en estas EFs (no introducido por spec
14) y la spec 14 no lo amplía con PII nueva (los mensajes de Postgres sobre `user_private` no
filtran contacto de terceros — un error de columna/constraint no incluye valores de otra fila).
Lo registro como **arrastre conocido**, fuera del scope de cierre de B3-1; debe atacarse en spec 13
(hardening). NO bloquea este gate.

---

## 5. Backfill / drop — atómico, sin ventana de exposición, sin pérdida de datos

Orden (`0068`): crear tabla (T1) → unique index (T2) → trigger updated_at (T4) → **backfill
ANTES del drop** (T5, `:89-90`) → drop columns (T6, `:96`) → reescritura del trigger de signup
(T7) → propagación (T9) → grants/revokes/smoke-check (T8). Todo en UN archivo de migración SIN
directiva `no-transaction` → la CLI lo corre en una sola transacción.

- **Atomicidad (R4.3)**: el pre-check de emails duplicados (`0068:75-87`) hace `raise exception`
  si hay colisión (el índice TOTAL nuevo no admite lo que el índice PARCIAL viejo sí) → rollback
  completo. Mensaje accionable en vez de unique-violation críptico. Buen catch del implementer.
- **Sin pérdida de datos**: backfill `insert ... select id, email, phone from public.users`
  (`:89-90`) incluye soft-deleted (R4.2, preserva contacto histórico). El drop ocurre DESPUÉS del
  backfill → no hay ventana donde el contacto exista en un solo lado.
- **Sin ventana de exposición intra-transacción**: `user_private` recién es visible a otros
  backends al COMMIT (el `create table` toma ACCESS EXCLUSIVE y la tabla no existe para otras
  sesiones hasta commit). Los grants (T8) y el `enable RLS` (T3, `:103`) están dentro de la misma
  transacción, antes del commit → cuando la tabla se hace visible, ya tiene RLS habilitada Y grants
  mínimos aplicados. No hay instante con tabla legible sin RLS.
- **Reescritura del trigger en la MISMA migración que el drop** (`:117-147`): correcto — evita la
  ventana donde el trigger viejo intentaría insertar en `users(email)` ya inexistente.

---

## Findings HIGH de Sentry
Ninguno. La skill `sentry-skills:security-review` NO se ejecutó: el artefacto es SQL no aplicado +
TS server-side, y la instrucción del gate prohíbe correrla contra el remoto (no hay estado
aplicado que trazar). Auditoría estática manual en su lugar (ver cobertura indirecta abajo).

## Findings RAFAQ-SPECIFIC
Ninguno que bloquee. Un arrastre conocido (no introducido por esta feature):

- **B1 (arrastre, MEDIUM, NO bloquea)**: `invite_user`/`accept_invitation` devuelven `err.message`
  de Postgres crudo al cliente en paths de error. Preexistente, no ampliado por spec 14, sin fuga
  de PII de terceros. A resolver en spec 13 (hardening). Documentado en §4.

## False positives descartados (trazabilidad)
- `members.ts:287` `select('id, role, email, ...)` → es sobre `invitations`, no `users`/
  `user_private`. Email de anotación, no PII de coworker. Descartado.
- `0001_users.sql:62` trigger insertando `users(id,name,email)` y `0001:23` índice
  `users_email_active` → son el estado VIEJO que 0068 supersede (rewrite del trigger + drop del
  índice en `:95`). No conviven post-migración. Descartado.
- `_shared/auth.ts:16` `data.user.email` → del JWT (auth.users), email canónico fresco; no toca
  `public.users`. Correcto by design (R6.5). Descartado.

---

## Tabla de inputs (campos que el usuario tipea, tocados por el diff)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `invite_user.email` (opcional) | normaliza a lowercase, exige `@` | server (EF guards `typeof`+`includes('@')`, `:52-58`) — preexistente | OK |
| `invite_user.role` | set `{field_operator, veterinarian}` | server (`ALLOWED_ROLES`, `:62`) — preexistente | OK |
| `invite_user.establishment_id` | string no vacío | server (`:40-48`) — preexistente | OK |
| `accept_invitation.token` | string no vacío | server (`:35-38`) — preexistente | OK |
| `user_private.phone` (saveOwnPhone/saveProfile) | `.trim()`, columna `text` (sin CHECK de largo) | server-autoritativa = constraint de columna `text` + RLS self-only; sanitización de form es UX | OK (ver nota) |
| `user_private.email` | nunca viene del cliente (lo setea trigger desde auth.users) | server (trigger SECURITY DEFINER) | OK |

**Nota phone**: `user_private.phone` es `text` sin `CHECK` de largo (igual que el `users.phone`
original que reemplaza — no es regresión). El sanitizador de form (`sanitizePhoneInput`, 20 chars,
en `app/src/utils/`) es UX bypasseable; el control server-side real es la RLS self-only (un user
solo escribe su propia fila) + el tipo `text`. No hay tope de largo server-side. Como el campo es
**self-only** (un user solo puede inflar su propio registro, no es vector cross-tenant ni de
enumeración) y no se concatena en `.or()/.filter()`/`ilike`/prompt, el riesgo es bajo
(self-DoS de su propia fila). **MEDIUM-bajo, no bloquea** este gate; recomendado un `CHECK
(length(phone) <= 32)` en spec 13 para cerrar el patrón en todos los `*_private`. Registrado.

---

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `invite_user` (manda accept_url, no mail directo; precheck pega a DB) | no (EF custom sin cuota propia) | n/a | n/a | **arrastre preexistente**, no introducido por spec 14. La EF no dispara email automático (ADR-014: link shareable). El precheck extra a `user_private` no agrega vector de abuso nuevo. A cubrir en spec 13. |
| `accept_invitation` (manda mail best-effort al owner) | no (EF custom sin cuota propia) | n/a | n/a | **arrastre preexistente**. El mail es best-effort, gated por token válido + no-ya-miembro. Spec 14 no lo empeora. Spec 13. |
| `user_private` SELECT/UPDATE (cliente) | n.a. | per-user (RLS self-only) | sí (RLS) | self-only acota el blast radius a la propia fila; no es acción de abuso a escala. |
| login/signup/OTP (no tocado por feature 14) | sí (`[auth.rate_limit]` nativo) | nativo | sí | `config.toml` movió `minimum_password_length` 6→8 (HARDENING, spec 13). Sin loosening de rate-limit. |

Ninguna acción abusable NUEVA introducida por spec 14. Los dos arrastres de EF sin cuota propia
son preexistentes (no regresión) y pertenecen al backlog de hardening (spec 13).

---

## Archivos analizados
- `supabase/migrations/0068_user_private_pii.sql` (+ contraste con `0001_users.sql`, `0006_rls_users.sql`)
- `supabase/functions/invite_user/index.ts`, `supabase/functions/accept_invitation/index.ts`
  (+ contraste con `resend_invitation/index.ts`, `_shared/auth.ts`)
- `app/src/services/profile.ts`, `app/src/services/establishments.ts`
- `app/e2e/helpers/admin.ts`, `app/src/services/members.ts` (contraste)
- `supabase/tests/user_private/run.cjs`, `scripts/run-tests.mjs` (wiring), `supabase/config.toml` (diff)

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia)
- **RLS**: la skill de Sentry NO cubre policies de Postgres. Revisión MANUAL: policies self-only
  correctas (SELECT+UPDATE con `with check`), sin policy de coworker sobre `user_private`, drop de
  columnas cierra el row-level leak de `users_select_coworkers`. La verificación EJECUTABLE
  (T17/T18 de `run.cjs`) corre VERDE recién post-apply — hoy NO verificada en remoto por el deploy
  gateado. El gate aprueba el ARTEFACTO; el leader debe confirmar la suite verde tras aplicar.
- **Deno/EF**: revisión manual de las 2 EFs (service-role scoping, no exposición de PII al cliente).
- **PowerSync/realtime (WAL)**: la separación física es justamente lo que cierra el canal WAL — pero
  PowerSync aún no está wired (ADR-002, diferido). Cuando se wire, las **sync rules** de PowerSync
  deben NO replicar `user_private` a coworkers (debe sincronizarse self-only, igual que la RLS).
  Anotado como C1 a verificar en la feature de PowerSync — fuera de scope de esta auditoría.

## Condición de cierre (no bloqueante del gate, sí del deploy)
La aprobación es sobre el ARTEFACTO. El cierre EFECTIVO de B3-1 ocurre cuando el leader: (1) aplica
0068 al remoto, (2) redeploya `invite_user`+`accept_invitation` JUNTOS (deploy destructivo sin
ventana segura de desfase), (3) descomenta y corre VERDE `supabase/tests/user_private/run.cjs`. El
artefacto está correcto y listo para ese deploy coordinado.
