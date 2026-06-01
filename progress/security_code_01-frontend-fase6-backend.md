# Security Code Review — 01 Fase 6 backend / T6.3 eliminar cuenta (Gate 2, modo `code`)

**Agente**: security_analyzer (Gate 2).
**Fecha**: 2026-06-01 (sesión 22).
**baseline_commit**: 063ab798ef21a76a93d7071e1a8fd860e351de85 (registrado en `progress/impl_01-frontend-fase6-backend.md`).
**Alcance**: SOLO el backend de T6.3, código en working tree sin commitear (no deployado):
- `supabase/migrations/0058_delete_account_rpc.sql` (CREADO, untracked) — RPC `delete_account_tx(uuid)` SECURITY DEFINER + grants + smoke-check.
- `supabase/functions/delete_account/index.ts` (CREADO, untracked) — edge function.
- `supabase/tests/edge/run.cjs` (MODIFICADO) — bloque "delete_account (T6.3)", l.714-954 (revisado para entender intención; los tests no pasan aún por no estar deployado — fuera de objeto por instrucción).

> NOTA sobre el diff: `git diff <baseline>..HEAD` da vacío porque la RPC y el edge son archivos **untracked** en el working tree; el bloque de tests está en un archivo `M`. El alcance real auditado son esos tres artefactos. El resto del `git status` (specs, docs spec-04, progress) es ajeno a la superficie de seguridad de T6.3.

**Skill**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability; referencias `authorization.md`, `business-logic.md`, `error-handling.md`, language JS/TS) + checklist RAFAQ-específico (Postgres/PL-pgSQL/RLS/PostgREST/Deno, que la skill NO cubre nativamente) + lección SEC-HIGH-01.

## Veredicto: PASS

Cero findings HIGH. El backend de T6.3 cierra correctamente el IDOR catastrófico que motivaba Gate 1 (HIGH/SEC-HIGH-01), es fail-closed en todos los paths de pre-check, y la revocación de auth es correcta desde seguridad. El código se desvió del design en UN punto security-relevante (el argumento de `signOut`) y la desviación es **una corrección, no una regresión** — está documentada y es la conducta correcta.

---

## Verificaciones que pasaron (foco Gate 2, HIGH-confidence)

### 1. IDOR en la RPC `delete_account_tx` — CERRADO (lección SEC-HIGH-01)

Trace: `config.toml:13` expone `schemas = ["public"]` → PostgREST publica TODA función del schema `public` ejecutable por el rol del request. `delete_account_tx` es `SECURITY DEFINER` y toma `p_user_id uuid` (`0058:18`) → si fuera EXECUTE-able por `authenticated`, cualquiera podría `POST /rest/v1/rpc/delete_account_tx {p_user_id:<otro>}` y borrar a cualquier usuario. Este es exactamente el vector de SEC-HIGH-01.

- **Revoke/grant EXACTO** (`0058:53-54`):
  ```sql
  revoke all on function public.delete_account_tx (uuid) from public, authenticated, anon;
  grant execute on function public.delete_account_tx (uuid) to service_role;
  ```
  Revoca los TRES roles cliente explícitamente (no solo `public`) — patrón verificado contra `0055_check_grants.sql:13-21` y la lección SEC-HIGH-01 (`revoke from public` NO alcanza si Supabase tiene `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO authenticated`). Solo `service_role` la ejecuta; el edge la llama con `adminClient` (`index.ts:132`).
- **Smoke-check fail-closed presente y correcto** (`0058:58-73`): itera `pg_proc` × `unnest(array['authenticated','anon','public'])` y hace `raise exception` si `has_function_privilege(rol, oid, 'EXECUTE')` es true para cualquiera. Idéntico en estructura a `0055:25-52`. Si la migración quedara mal grantada, FALLA al aplicarse (no deploya silenciosamente roto).
- Confirmado: un `authenticated` NO puede invocar la RPC con `p_user_id` de otro. PostgREST devuelve permiso denegado (lo oculta como 404). Test 8 (`run.cjs:909-953`) reproduce el vector exacto (attacker JWT → `rpc('delete_account_tx', {p_user_id: victim.id})`) y assertea `status != 200` + víctima intacta.

### 2. IDOR en el edge — CERRADO (identidad solo del JWT)

Trace de la identidad: `index.ts:55` `const user = await requireUser(userClient)`. `requireUser` (`_shared/auth.ts:9-25`) deriva `id` de `userClient.auth.getUser()` (valida el JWT contra el GoTrue server), nunca del body. TODOS los usos posteriores son `user.id` server-derivado: idempotencia (`:61`), pre-check de owner-roles (`:80`), RPC (`:133`), ban (`:171`). El body NUNCA se lee (no hay `req.json()`/`req.text()`; el comentario `:9` lo declara ignorado por contrato). No existe un parámetro attacker-controlled que targetee otra cuenta. El `accessToken` extraído del header (`:152`) se pasa SOLO a `signOut`, que actúa sobre la sesión de ESE Bearer (la del propio caller). Sin IDOR, sin parameter tampering (cf. business-logic.md §7). D5 confirmado.

### 3. Fail-closed — CORRECTO en todos los paths de pre-check

Cada error de query del pre-check aborta con 500 SIN escribir:
- `:63-66` lectura de `users.deleted_at` (idempotencia) → `db_error`, no escribe.
- `:83-85` owner-roles del usuario → `db_error`, no escribe.
- `:99-101` establishments activos → `db_error`, no escribe.
- `:112-115` count de owners por establecimiento → `db_error`, no escribe (comentario explícito "ante incertidumbre del conteo, NO permitimos la baja").

El soft-delete (RPC `:132`) solo se alcanza si `blocking.length === 0` — si hay bloqueantes, `:123-128` retorna 409 ANTES de cualquier write. El `count <= 1` (`:117`) incluye al usuario actual (su rol aún activo), umbral correcto. Defensa en profundidad: la RPC re-valida el bloqueo único-owner DENTRO de la transacción (`0058:25-38`, red TOCTOU, `raise 23514`); ese error se mapea a 409 (`:138-143`) sin dejar nada parcial (la RPC es atómica). Consistente con el patrón fail-closed de `remove_member`/`change_member_role`.

### 4. Revocación de auth — CORRECTA desde seguridad (desviación del design = corrección)

- `signOut(accessToken, 'global')` (`:155-158`) usa el **access token del Bearer**, NO `user.id`. El design literal (paso 5 / D1) decía `signOut(user.id, 'global')`, pero la Auth Admin API `signOut(jwt, scope)` espera el ACCESS TOKEN (lo POSTea a `/logout?scope=global`); pasar un UUID sería no-op. La implementación lo corrigió y documentó (`:18-27`, `:148-150`). **Desviación = fix, no regresión**: con `user.id` el revoke de refresh tokens no habría ocurrido (cascarón menos endurecido); con el access token sí revoca el refresh token global. Conducta correcta.
- `updateUserById(user.id, {ban_duration: '876000h'})` (`:170-173`) es la barrera REAL de re-login; toma `user.id` correctamente (esa API sí espera UUID). No es hard-delete → preserva la fila para retención SENASA.
- **Fail-open (loguear + 200 si signOut/ban fallan, `:159-179`) es SEGURO**: la baja de datos ya commiteó atómicamente en el paso 4, y al estar TODOS los `user_roles` inactivos, RLS niega acceso a datos de cualquier tenant (las policies de spec 01/02/03 derivan de `has_role_in`/`is_owner_of`, que exigen rol activo; `users_select_*` filtra `deleted_at`). El access-token residual (~1h, stateless) solo renderiza un cascarón vacío. El ban/signOut son hardening del cascarón, no la barrera de datos. La operación es idempotente (`:67-69` corta en `already_deleted`) → re-corrible si el hardening falló. El orden RPC-antes-de-ban es correcto y reentrante. Verificado: el JWT residual no abre ningún vector de datos porque la barrera (roles inactivos + RLS) ya está cerrada en el commit del paso 4.

### 5. search_path / SD hardening — CORRECTO

`0058:20` `set search_path = public`. Sin search_path mutable → sin function/operator hijacking. Consistente con TODAS las funciones SECURITY DEFINER del repo (verificado en SEC-HIGH-01 §9). El cuerpo de la RPC usa solo `count`/`update` parametrizados por `p_user_id` (uuid); sin `EXECUTE`/`format()`/concatenación dinámica → sin SQL injection.

### 6. Otros vectores HIGH — sin hallazgos

- **Fuga de datos en responses**: la lista `sole_owner.establishments` (`:118, :125-127`) solo contiene `{id, name}` de campos donde el caller ES owner activo (derivado de SUS propios `user_roles`, `:80`). No filtra datos de tenants ajenos. El path 23514-race (`:139-142`) devuelve `establishments: []` (no re-deriva la lista). OK.
- **Exposición de mensajes de error**: `db_error` devuelve `err.message` de Postgres (`:65, :84, :100, :114, :145`). Esto es info-disclosure marginal, pero (a) solo alcanza el dueño autenticado de la cuenta en un path 500, y (b) es el patrón ESTABLECIDO en las 8 edge functions del repo (`change_member_role`, `remove_member`, `accept_invitation`, `invite_user`, etc.) — no es regresión de T6.3. LOW, no objeto de Gate 2. Si se quisiera endurecer sistémicamente, sería un follow-up de todo el directorio `functions`, no de esta feature.
- **Scope del service_role en los writes**: la RPC corre como `service_role` vía `adminClient` (bypassa RLS by design — necesario para tocar `users` + todos los `user_roles` del usuario en lockstep, que el cliente no puede por RLS). Los writes están acotados a `where ... = p_user_id` (`0058:41, :43`) y `p_user_id` es server-derivado del JWT. Sin write cross-tenant. OK.
- **CORS / verify_jwt**: `_shared/cors.ts:7` usa `Access-Control-Allow-Origin: '*'` — patrón preexistente de TODAS las edge functions, no regresión (documentado "ajustar en prod"). No hay override `verify_jwt = false` para `delete_account` en `config.toml` (default `true`); además `requireUser` valida el JWT como defensa en profundidad. OK.

---

## False positives descartados / NO reportados
1. `db_error` con `err.message` de Postgres → patrón del repo entero, path 500 autenticado, info-disclosure marginal. LOW, no HIGH. (Ver §6.)
2. CORS `*` → preexistente, no introducido por T6.3. LOW.
3. Fail-open del ban/signOut → analizado a fondo (§4): seguro porque RLS ya corta datos con roles inactivos. NO es fail-open inseguro (cf. error-handling.md: fail-open es vulnerable cuando la barrera de seguridad queda abierta; acá la barrera —RLS— quedó cerrada en el paso 4, lo que falla es solo hardening posterior).
4. TOCTOU único-owner → cerrado en dos capas (pre-check edge + re-validación atómica en RPC). En MVP no hay invitación a owner (R5.1); el único race endurece el bloqueo, no orfana. Operacional, no HIGH (Gate 1 D3).
5. Idempotencia con access token residual (Test 6) → by-design tolerado (~1h), no abre datos (cascarón vacío por RLS).

## Cobertura de la skill (advertencia)
- La skill `sentry-skills:security-review` NO cubre nativamente Postgres/PL-pgSQL/RLS ni el modelo de exposición RPC de PostgREST (`schemas=["public"]` ⇒ funciones expuestas + default `EXECUTE TO PUBLIC`). El núcleo del riesgo de esta feature (IDOR vía RPC SD) se evaluó por **revisión manual RAFAQ-específica** apoyada en la lección SEC-HIGH-01 y el patrón verificado de `0042`/`0055`. La metodología de la skill (trace data flow + verify exploitability) se aplicó manualmente a cada vector.
- **No se ejecutó SQL contra el remoto** (el código no está deployado; los tests aún no pasan, por instrucción fuera de objeto). La garantía del revoke/grant queda asegurada por el smoke-check fail-closed `0058:58-73`: si la migración aplicara con la RPC EXECUTE-able por un rol cliente, FALLA al deploy. Para certeza absoluta post-deploy: `select proacl from pg_proc where proname='delete_account_tx'` (o que pase Test 8 contra el remoto).
- PowerSync/offline fuera de alcance.

## Recomendación al leader
PASS. El backend de T6.3 está sólido en lo security-crítico: IDOR cerrado con el patrón correcto (revoke triple + smoke-check fail-closed), fail-closed consistente, revocación de auth correcta (la desviación del design es una corrección documentada). El único punto de mejora detectado (`db_error` expone `err.message`) es deuda sistémica del directorio `functions` entero, no de esta feature — anotable en backlog como hardening opcional, NO bloqueante para Gate 2. Listo para la puerta de aprobación humana.

> Pendiente operacional (no de seguridad, no bloquea Gate 2): el código no está deployado y los 8 tests no corrieron contra el remoto. Validar Test 8 (RPC no invocable por authenticated) y Test 2 (re-login post-ban falla) tras el deploy de 0058 + la edge function.
