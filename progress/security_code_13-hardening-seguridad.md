# Security Gate 2 (modo `code`) — Feature 13 `13-hardening-seguridad`

**Veredicto: PASS**

Motivo en una línea: re-revisión del fix de H1-1 (reemplazo del ban finito por la RPC `revoke_user_sessions` que borra `auth.sessions` del target) — **correcto y blindado** (SECURITY DEFINER + search_path fijo + grants revocados de los 3 roles cliente + smoke-check fail-closed, patrón idéntico al `delete_account_tx`/0058 ya en producción); y **B1-1 (HIGH-1 del Gate previo) quedó resuelto** (`serverError` importado en las 8 EFs, incluidas `invite_user`/`accept_invitation`). Sin findings HIGH ni MEDIUM. Migración 0072 NO aplicada al remoto → auditoría **estática** del SQL/código (suficiente: el blindaje replica un patrón ya desplegado).

- baseline_commit: `6a92ceb1773fb3a4dce9e4b3ebb565209f9f8c0d` (de `progress/impl_13-hardening-seguridad.md`).
- Alcance de ESTA re-revisión (re-auditoría dirigida, no re-corrida full): el cambio de mecanismo de **H1-1** (`0072_revoke_user_sessions_rpc.sql` + `remove_member/index.ts` + `change_member_role/index.ts`) y la **confirmación del fix de B1-1** (import de `serverError`). Los otros 4 fixes (INPUT-1/0070, A1-1/0071, F1-1, helper B1-1) ya fueron validados como CIERRA en el Gate previo y no cambiaron → no se re-auditan.
- Skill `sentry-skills:security-review` corrida sobre los 3 archivos de H1-1: **0 findings** (HIGH/MEDIUM/Critical). Validado manualmente abajo.

---

## Contexto del re-trabajo (por qué este FAIL→PASS)

El Gate previo dio **FAIL** por dos motivos, ambos atendidos:

1. **HIGH-1 (B1-1 roto):** `serverError` se llamaba sin importar en `invite_user`/`accept_invitation` → `ReferenceError` en runtime en todo path 5xx. **RESUELTO** — ver §Confirmación B1-1.
2. **Afirmación incorrecta sobre H1-1:** el Gate previo aceptó que `updateUserById(uid, {ban_duration:'1s'})` cumplía R9 (revocar refresh token de forma persistente). **Era falso** — el leader lo probó empíricamente: tras ban 1s + 2.5s de espera, `refreshSession` con el token original **vuelve a funcionar** (el ban finito solo bloquea el refresh ~1s, NO revoca el refresh token de forma persistente). El mecanismo se **reemplazó** por la RPC `revoke_user_sessions` → auditado abajo como cambio nuevo.

---

## Findings HIGH

Ninguno.

## Findings MEDIUM

Ninguno.

## Findings RAFAQ-SPECIFIC

Ninguno con severidad HIGH/MEDIUM.

---

## Auditoría del cambio de H1-1 (mecanismo nuevo: `revoke_user_sessions`)

### 1. Blindaje de la RPC (lo más crítico) — SÓLIDO ✓

`revoke_user_sessions(target_uid uuid)` (`0072:38-47`) es una función `SECURITY DEFINER` que ejecuta `delete from auth.sessions where user_id = target_uid`. Si quedara invocable por un rol cliente, sería un **logout-de-cualquiera** (DoS de sesión / abuso de auth: `POST /rest/v1/rpc/revoke_user_sessions {target_uid:<otro>}`). El blindaje cierra ese vector en tres capas:

- **`SECURITY DEFINER` + `set search_path = public`** (`0072:39-40`): el search_path fijo neutraliza el hijack clásico de funciones DEFINER. `auth.sessions` se referencia con **esquema explícito** (`auth` NO está en el path), correcto.
- **Grants revocados de los 3 roles cliente** (`0072:51-52`): `revoke all on function ... from public, authenticated, anon;` + `grant execute ... to service_role;`. Es explícito sobre los tres roles, no solo `public` → neutraliza el `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE TO authenticated` que Supabase aplica por defecto a funciones nuevas (lección SEC-HIGH-01).
- **Smoke-check fail-closed** (`0072:57-72`): `DO $$` que itera `has_function_privilege(r.rolname, p.oid, 'EXECUTE')` sobre `{authenticated, anon, public}` y hace `raise exception` si alguno quedó EXECUTE-able → **aborta la migración transaccional**. No puede quedar desplegada una RPC de logout-de-cualquiera invocable por cliente.

**Verificación de patrón (no inventado):** idéntico estructuralmente a `delete_account_tx` (`0058:53-73`, ya en producción) y a `0055/0065/0066/0068`. `grep has_function_privilege | grant check FAILED` confirma que 0072 sigue la plantilla establecida del proyecto byte-por-byte. **Solo `service_role` puede ejecutarlo** (las EFs lo llaman con `adminClient`).

### 2. Authz en las Edge Functions — CORRECTA (defensa en capas sobre el grant) ✓

Ambas EFs llaman `requireOwnerOf(adminClient, user.id, establishmentId)` **ANTES** de la RPC:
- `remove_member`: `requireUser` (`:30`) → `requireOwnerOf` (`:44`) → lookup `targetRole` activo en ESE establishment (`:47-53`, 404 si no) → guard `last_owner` (`:66-83`) → write `user_roles` (`:85-94`) → **recién ahí** la RPC (`:104-111`).
- `change_member_role`: `requireUser` (`:34`) → `requireOwnerOf` (`:53`) → lookup `targetRole` (`:55-71`) → guard `last_owner` (`:78-95`) → split de rol (`:99-124`) → **recién ahí** la RPC (`:133-140`).

`requireOwnerOf` (`_shared/auth.ts:30-58`) valida con admin client que el caller tenga rol `owner` `active` en ese `establishment_id`. No hay path donde un no-owner alcance la RPC. El `target_uid` pasado a la RPC es el mismo `targetUserId` que ya fue verificado como miembro activo del campo del owner (404 antes si no lo es).

### 3. El DELETE sobre `auth.sessions` — acotado, sin inyección ✓

`delete from auth.sessions where user_id = target_uid` (`0072:46`):
- `target_uid` es **parámetro tipado `uuid`** de plpgsql, bindeado — **no hay SQL dinámico ni concatenación de strings**. El cast a `uuid` valida la entrada antes del DELETE; un valor no-UUID falla en el parseo del argumento, no llega al DELETE. **Cero superficie de inyección.**
- El `WHERE user_id = target_uid` acota **estrictamente** al target → no hay forma de borrar sesiones de otros usuarios ("de más").
- Efecto colateral: el deslogueo es **global** para el target (borra TODAS sus sesiones, no solo las del campo A). Esto es la **semántica correcta** del modelo de sesión de Supabase (la sesión no está scopeada por establishment) y es exactamente lo que R9 pide: forzar re-autenticación → el target re-loguea y obtiene un JWT fresco con sus roles ACTUALES (conserva los de otros campos). No es abuso.

### 4. ¿Vector de deslogueo arbitrario? — NO ✓

El único camino a la RPC requiere: caller = owner activo del `establishmentId` (`requireOwnerOf`) **y** target = miembro activo de ESE establishment (lookup con `.eq('establishment_id',...).eq('user_id',...).eq('active',true)`, 404 si no). Combinado con el grant `service_role`-only + smoke-check, no existe path para que un `authenticated`/`anon`/no-owner deslogue a un usuario arbitrario.

### 5. Revocación persistente vs. ban finito — el fix corrige el bug real ✓

El `DELETE FROM auth.sessions` borra las filas de sesión → los refresh tokens asociados dejan de ser canjeables de forma **PERSISTENTE** (no es una ventana temporal). Mismo efecto que `signOut(global)` (que `delete_account` usa y SÍ funciona), pero **por user id** — necesario porque `supabase-js@2` no expone `signOut(userId)` (la Auth Admin API `signOut(jwt, scope)` solo acepta el ACCESS TOKEN, que el owner no posee). Esto cierra el agujero que el ban finito dejaba abierto. **R9.1/R9.2 cumplidos** (esta vez de verdad, verificado empíricamente por el leader y documentado en `0072:19-27`).

### 6. Fail-soft de la RPC en ambas EFs — correcto ✓

La RPC se invoca en un `try/catch` que **loguea** si falla (`console.error`) y **NO revierte** el write de `user_roles`/split ya consumado (la barrera primaria), ni expone el error al cliente (`remove_member:104-111`, `change_member_role:133-140`). Cumple R9.4 (fail-soft) y R9.5 (no leak). Correcto: la barrera de autorización real es `user_roles.active=false` + RLS; la revocación de sesión es aceleración, no la barrera única.

### 7. Test R10.1/R10.2 (`edge/run.cjs:1106-1187`) — determinista, asserta la condición correcta ✓

El test corrige la condición de carrera del test anterior (que dependía de la ventana del ban): ahora es **determinista** —
- **Control PRE** (`:1112-1124`, `:1158-1169`): confirma que el refresh token del target **SÍ** producía sesión ANTES de la EF (descarta falso positivo).
- **Assert POST** (`:1132-1143`, `:1177-1186`): tras la EF, el refresh token previo **FALLA** persistente (sin esperar, sin reintentar) — porque la EF borró `auth.sessions` del target.

Asserta exactamente la condición de éxito de R10 (revocación persistente), no por timing. Está gated por `SPEC13_APPLIED` → corre verde post-deploy de la 0072 por el leader.

---

## Confirmación B1-1 (HIGH-1 del Gate previo) — RESUELTO ✓

- **`serverError` importado en las 8 EFs.** Grep `^import .* from '../_shared/errors.ts'` confirma `{ jsonError, jsonOk, serverError }` en las 8, incluidas las dos que crasheaban: `invite_user/index.ts:12` y `accept_invitation/index.ts:13`. El `ReferenceError` en runtime queda eliminado.
- **0 `.message` crudo del driver devuelto al cliente.** Grep `jsonError([^)]*\.message` devuelve solo el re-emit del `HttpError` controlado en el catch-all de cada EF (`jsonError(err.status, err.code, err.message)`), donde `err.message` es copy genérico **nuestro** (p.ej. `'Error interno, probá de nuevo.'` de `requireOwnerOf`/`HttpError`), no el `.message` del driver Postgres. Los paths 5xx por error de DB pasan por `serverError(code, detail)` → `console.error` del detalle + `jsonError(500, code, 'Error interno, probá de nuevo.')` (`_shared/errors.ts:30-33`). Information disclosure de schema cerrado.

---

## False positives descartados (validación manual, trazabilidad)

- **"La RPC borra TODAS las sesiones del target, no solo las del campo donde se lo removió"** → NO es hueco. Es la semántica correcta del modelo de sesión de Supabase (la sesión es global, no por establishment). El target re-loguea con JWT fresco que refleja sus roles actuales (incluidos los de otros campos). Es exactamente lo que R9 pide (forzar re-auth). Documentado en `0072:42-46` y en los comentarios de ambas EFs.
- **"`revoke from public` no alcanza por el default-privilege de Supabase"** → ya mitigado: 0072 revoca de los TRES roles explícitamente (`public, authenticated, anon`) + smoke-check fail-closed. No es residual.
- **"El access token del target sigue vivo ~1h tras el deslogueo"** → residual CONOCIDO y aceptado (riesgo MEDIUM por diseño, R9/R10). El JWT es stateless hasta `exp`, pero `user_roles.active=false` + RLS niegan acceso a datos en cada request → la barrera de tiempo real es RLS, no la sesión. No es un hueco nuevo introducido por 0072.
- **"`err.message` aún aparece en los catch de las 8 EFs"** → es el re-emit del `HttpError` controlado (copy genérico nuestro), no el detalle del driver. Seguro por diseño (validado en Gate previo).

---

## Tabla de inputs (campos tocados por el cambio re-auditado)

| campo | límite | validación | OK? |
|---|---|---|---|
| `remove_member` / `change_member_role` → `target_uid` (a la RPC) | tipo `uuid` (cast plpgsql) | **server-autoritativa**: parámetro tipado bindeado, sin SQL dinámico; el cast a uuid rechaza no-UUID. Upstream: `typeof body.user_id === 'string'` + `requireOwnerOf` + lookup de miembro activo | ✓ |
| `change_member_role.new_role` | whitelist `ALLOWED_ROLES` | server (EF guard `:49-51`) | ✓ (sin cambio en esta re-revisión) |

Sin campo de entrada nuevo de texto-libre/buscador en este cambio. Los del Gate previo (buscador 64-char server-side, CHECKs de DB de INPUT-1) siguen OK y no cambiaron.

## Tabla de rate limits (acciones abusables tocadas por el cambio)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `remove_member` / `change_member_role` (write + RPC de revocación) | no (propio) | n.a. | n.a. | requiere `requireOwnerOf` (owner del campo). 1 RPC admin por op, target acotado al miembro del campo. No es vector de abuso a escala nuevo. La RPC en sí solo la ejecuta `service_role`. |
| `revoke_user_sessions` (RPC) | n.a. | n.a. | sí (grant `service_role`-only + smoke-check) | NO invocable por cliente → no rate-limiteable desde fuera. Solo alcanzable vía las 2 EFs ya gated por owner. |

Feature 13 **no afloja** `[auth.rate_limit]` en `config.toml` (no lo toca). Sin operaciones bulk/import en este cambio.

---

## Archivos analizados (re-revisión H1-1 + confirmación B1-1)

- `supabase/migrations/0072_revoke_user_sessions_rpc.sql` ← **cambio H1-1 (RPC nueva)**
- `supabase/functions/remove_member/index.ts` ← **cambio H1-1 (usa la RPC)**
- `supabase/functions/change_member_role/index.ts` ← **cambio H1-1 (usa la RPC)**
- `supabase/functions/_shared/auth.ts` (verificar `requireOwnerOf` antes de la RPC)
- `supabase/functions/_shared/errors.ts` (verificar `serverError` — B1-1)
- `supabase/functions/invite_user/index.ts` ← **confirmación B1-1 (import resuelto)**
- `supabase/functions/accept_invitation/index.ts` ← **confirmación B1-1 (import resuelto)**
- `supabase/tests/edge/run.cjs` (test R10.1/R10.2 determinista)
- (apoyo: `supabase/migrations/0058_delete_account_rpc.sql` para confirmar que el patrón de blindaje de 0072 replica el ya-en-producción; grep transversal de imports `serverError` y de `.message` devuelto en las 8 EFs)

## Cobertura indirecta de Deno / RLS / PowerSync

- **Deno EFs**: la skill `sentry-skills:security-review` no type-checkea Deno; la auditoría de las 2 EFs y del import de `serverError` fue **manual** (read + grep). **Advertencia de proceso (repetida del Gate previo, no bloqueante)**: el pipeline local (`check.mjs`) no type-checkea Deno → un import faltante llegaría a runtime sin red. Recomendado: `deno check supabase/functions/**/index.ts` en el pipeline. (El fix de B1-1 ya está; esto es prevención a futuro.)
- **RLS / SQL (0072)**: análisis **estático** del SQL (migración NO aplicada al remoto). El blindaje de grants + smoke-check + el DELETE parametrizado se verificaron por lectura contra el patrón ya-desplegado de 0058. El test R10 que lo prueba contra el remoto está gated por `SPEC13_APPLIED` → verde post-apply del leader.
- **PowerSync**: no tocado por feature 13 (C5, diferido). N.a. (la 0072 menciona C4/offline como motivación a futuro de invalidar la sesión, pero no implementa sync).

---

## Resumen

PASS. El reemplazo del mecanismo de H1-1 (ban finito → RPC `revoke_user_sessions` que borra `auth.sessions`) está correctamente blindado (DEFINER + search_path + grants `service_role`-only + smoke-check fail-closed, patrón idéntico a 0058), la authz de las EFs corre `requireOwnerOf` antes de la RPC, el DELETE está parametrizado y acotado al target sin inyección, y B1-1 (el HIGH-1 que motivó el FAIL previo) quedó resuelto en las 8 EFs. Sin findings HIGH/MEDIUM. Residual conocido y aceptado: access token vigente hasta `exp` (~1h), cubierto por RLS (MEDIUM por diseño, R9/R10). Pendiente operativo no-bloqueante: aplicar 0072 + correr la suite edge con `SPEC13_APPLIED=1` post-deploy (la auditoría de seguridad es estática y suficiente para este gate).
