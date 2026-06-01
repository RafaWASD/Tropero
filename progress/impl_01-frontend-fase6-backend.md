baseline_commit: 063ab798ef21a76a93d7071e1a8fd860e351de85

# Implementación — T6.3 Eliminar cuenta (BACKEND)

Feature: `01-identity-multitenancy` (in_progress). Tarea: T6.3 — backend de eliminar
cuenta. Cubre R2.4, R2.5, R2.5.1. Contrato autoritativo:
`specs/active/01-identity-multitenancy/design-T6.3-delete-account.md` (Gate 1 PASS rev.2).

> Scope de esta sesión: SOLO backend (RPC + edge function + tests). NO frontend, NO deploy,
> NO aplicar migraciones (eso lo hace el leader después).

## Plan (tasks de esta sesión)

- T6.3a — Migración `0058_delete_account_rpc.sql`: RPC `delete_account_tx(uuid)`
  SECURITY DEFINER atómica + re-validación único-owner (raise 23514) + grants blindados
  (revoke public/authenticated/anon, grant service_role) + smoke-check fail-closed +
  notify pgrst.
- T6.3b — Edge function `delete_account/index.ts`: pasos 1-6 del design (POST only,
  identidad solo del JWT, idempotencia, pre-check fail-closed de único-owner, RPC
  atómica, signOut global + ban, jsonOk).
- T6.3c — 8 tests en `supabase/tests/edge/run.cjs` (namespaced + cleanup).

## Baseline

- `baseline_commit` = HEAD al iniciar la feature (063ab79). Gate 2 calcula el diff desde acá.

## Archivos creados / modificados

- **CREADO** `supabase/migrations/0058_delete_account_rpc.sql` — RPC `delete_account_tx(uuid)`
  SECURITY DEFINER atómica + grants blindados + smoke-check fail-closed + notify pgrst.
  **Número de migración usado: 0058** (estaba libre; el máximo previo era 0057).
- **CREADO** `supabase/functions/delete_account/index.ts` — edge function (pasos 1-6).
- **MODIFICADO** `supabase/tests/edge/run.cjs` — +8 tests (bloque "delete_account (T6.3)")
  + helpers `getAccessToken` / `grantOwnerRole`; header actualizado.
- **MODIFICADO** `specs/active/01-identity-multitenancy/tasks.md` — T6.3 marcado backend
  hecho / frontend pendiente.

## Decisiones / as-built notes

- **Pre-check con dos queries simples (no join embebido).** El diseño describe el
  pre-check como "join a establishments con deleted_at IS NULL". Lo implementé como
  (a) traer owner-roles activos, (b) filtrar establecimientos activos con `.in(...).is(
  'deleted_at', null)`, (c) contar owners por campo. Más robusto que filtrar sobre un
  recurso embebido de PostgREST (cuyo comportamiento de filtro varía). Semántica
  idéntica al diseño; cierre fail-closed en cada query (rolesErr/estErr/countErr → 500
  sin escribir).
- **DEVIACIÓN-DE-LITERAL en `signOut` (flag para Gate 2).** El design paso 5 escribe
  `adminClient.auth.admin.signOut(user.id, 'global')`. Verifiqué en
  `app/node_modules/@supabase/auth-js/.../GoTrueAdminApi.js`: la firma es
  `signOut(jwt, scope)` y POSTea el `jwt` a `/logout?scope=global` — espera el ACCESS
  TOKEN del usuario, NO un UUID. Pasar `user.id` no apuntaría a las sesiones del usuario
  (no-op/error). Para cumplir la INTENCIÓN documentada ("revocar todos los refresh
  tokens server-side") uso el Bearer access token del request (`req.headers
  Authorization`). El **ban** (`updateUserById(user.id, {ban_duration:'876000h'})`) SÍ
  toma `user.id` y es la barrera REAL de re-login (lo verifica Test 2). Ambos son
  hardening del cascarón (HIGH-1.c): si fallan, se loguea y se devuelve 200 igual. No
  cambié contrato ni modelo de seguridad — solo el argumento de signOut para que cumpla
  su intención en vez de ser un no-op. **No es improvisación de scope**: el design
  literal era un mis-use de la API; lo dejo anotado para que el reviewer/Gate 2 lo
  re-validen y, si quieren, actualicen el texto del design.
- **Errcode 23514.** Verifiqué `PostgrestError.code` (postgrest-js/src/PostgrestError.ts)
  → lleva el SQLSTATE. El `raise ... using errcode='23514'` de la RPC se propaga a
  `rpcErr.code`. El mapeo `=== '23514'` → 409 sole_owner es correcto.

## Trazabilidad R<n> → test

- **R2.4** (soft-delete + desactivar roles) → `run.cjs` Test 1 (baja simple: verifica
  `users.deleted_at` set + 0 roles activos) + Test 4 (2do owner: rol del usuario inactivo).
- **R2.5** (único owner bloquea) → `run.cjs` Test 3 (409 sole_owner + NO se escribió:
  `deleted_at` null, rol owner activo). Red TOCTOU de la RPC cubierta por el raise 23514
  (mapeado en el edge; el camino de race es difícil de forzar en test, cubierto por
  diseño + el mapeo verificado).
- **R2.5.1** (lista de campos bloqueantes) → `run.cjs` Test 3 (asserta
  `error.establishments` array con `{id,name}` del campo del usuario).
- **D4** (campo soft-deleteado no bloquea) → `run.cjs` Test 5.
- **Token revocado tras la baja** (`signOut` global cierra la ventana residual del
  access token) → `run.cjs` Test 6 (2da llamada con el MISMO token → **401**, no
  re-operable). REEMPLAZA al test de idempotencia previo (ver "Corrección post-deploy").
- **Idempotencia** (branch defensivo `200 already_deleted`) → `run.cjs` Test 6b (perfil
  ya soft-deleteado + sesión viva → 200 `already_deleted:true`, en aislamiento).
- **HIGH-1** (ban/signOut → no re-login) → `run.cjs` Test 2.
- **D5 / sin sesión** → `run.cjs` Test 7 (sin Bearer → 401 del gateway, verify_jwt ON).
- **HIGH-1 IDOR / grant blindado de la RPC** → `run.cjs` Test 8 (authenticated no puede
  invocar `delete_account_tx`; víctima no escrita) + smoke-check fail-closed de la 0058.

## Verificación (paso 8) — resultado de `node scripts/check.mjs`

TODO verde EXCEPTO los 7 tests de delete_account que requieren deploy. Desglose:

- ✅ typecheck client — OK
- ✅ client unit tests — OK
- ✅ RLS suite — OK
- ✅ Edge Functions — Fase 2 — 24/24 pass (NO rompí nada existente)
- ✅ Animal suite (spec 02) + Maneuvers suite (spec 03) — 41/41 pass (corridas aparte;
  el orquestador aborta en el fallo de la Edge suite antes de llegar a ellas, pero son
  independientes y verdes).
- ✅ delete_account **Test 8** — pass (RPC no invocable por authenticated).
- ❌ delete_account **Tests 1-7** — FALLAN SOLO POR FALTA DE DEPLOY. Evidencia: Test 7
  (raw fetch) devuelve **404** = función no encontrada (no deployada). Los demás
  (`functions.invoke`) devuelven "non-2xx" por la misma razón. NO son bugs de lógica:
  el código parsea (`node --check run.cjs` OK) y la lógica fue revisada manualmente.
  Una vez que el leader (a) aplique la migración 0058 y (b) deploye la función
  `delete_account`, estos 7 deberían pasar.

> Nota sobre Test 8 pre-deploy: pasa pero por la razón "la RPC no existe aún" (404).
> Post-deploy seguirá dando 404 (PostgREST oculta funciones revocadas) → sigue pasando.
> La garantía dura que verifica (NUNCA 200, víctima nunca escrita) es invariante a esa
> ambigüedad. Documentado inline en el test.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo cerré)

- **¿Algún write antes de validar el bloqueo?** No. Paso 2 (read idempotencia) y paso 3
  (pre-check read-only) retornan antes de cualquier escritura; el único write es la RPC
  del paso 4, que re-valida adentro. ✓
- **¿El body puede targetear otro user?** No. Identidad solo de `requireUser(JWT)`; el
  body nunca se parsea. ✓
- **¿Fail-closed cubre todos los errores de query?** Sí: userErr, rolesErr, estErr,
  countErr → 500 sin escribir. ✓
- **¿Mapeo errcode 23514?** Verificado contra el código de postgrest-js. ✓
- **¿Cleanup borra usuarios baneados/soft-deleteados?** Sí: `admin.auth.admin.deleteUser`
  (service_role) borra auth.users aun baneado, y `public.users` tiene FK
  `on delete cascade`. Establecimientos (incl. soft-deleteado del Test 5) se hard-borran
  por id con admin (bypassa RLS). ✓
- **¿Test que pasa por la razón equivocada?** Detectado en Test 8 (404 ambiguo
  not-deployed vs revoked). Lo dejé con comentario explícito + assert dura invariante
  (no-200 + víctima-no-escrita). ✓
- **Hallazgo principal a escalar**: la deviación-de-literal del `signOut` (ver arriba).
  No improvisé scope: corregí un mis-use de la API para cumplir la intención del design
  y lo dejo flageado para Gate 2 / reviewer.

## Corrección post-deploy de Tests 6 y 7 (sesión 22, tras deployar 0058 + edge)

Con la migración 0058 aplicada y la edge function deployada al remoto, la suite quedó
en 32/35 con 2 fallos REALES de aserción en el bloque delete_account (Test 6 y Test 7).
La FUNCIÓN está bien y es MÁS segura de lo que los tests asumían — los tests tenían
aserciones equivocadas sobre el comportamiento de auth. NO se tocó la función ni la
migración (ya deployadas). Solo se corrigieron los tests, verificando empíricamente.

### Hallazgo raíz: `verify_jwt = true` (default; sin override en config.toml)

Las 8 edge functions del repo se deployan con `verify_jwt` ON. Eso parte el manejo de
auth en DOS capas:

- **Sin Bearer** → el PLATFORM (gateway) rechaza ANTES de llegar al código → **401 con
  el body del platform** (`{"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing
  authorization header"}`), NO el envelope `{error:{code:'unauthorized'}}` de la función.
  Por eso `body.error.code` es `undefined` (rompía el Test 7 viejo).
- **Token de firma válida pero sesión revocada** (caso de la 2da llamada del Test 6, tras
  el `signOut(global)` de la 1ra baja) → el gateway lo DEJA PASAR (firma OK) pero
  `requireUser` → `getUser()` falla server-side (sesión revocada) → la FUNCIÓN devuelve
  **401 `{error:{code:'unauthorized', message:'Sesión inválida o ausente.'}}`**.

### Observación empírica (logueada una vez antes de asertar)

- **2da llamada del Test 6** (mismo access token tras la 1ra baja): **STATUS 401**, BODY
  `{"error":{"code":"unauthorized","message":"Sesión inválida o ausente."}}` (envelope
  de la FUNCIÓN). El `signOut(global)` revoca la sesión → el token vivo ya no re-opera.
  NO devuelve `200 already_deleted`: el flujo normal cierra la ventana residual.
- **No-Bearer (Test 7)**: STATUS 401, BODY `{"code":"UNAUTHORIZED_NO_AUTH_HEADER",...}`
  (body del gateway, sin `error.code`).
- **already_deleted en aislamiento**: soft-delete directo de la fila con admin (sin edge,
  sin ban, sin signOut → sesión viva) + invoke con token vivo → `200 {ok:true,
  already_deleted:true}`. Confirma que el branch es alcanzable solo con sesión viva.

### Cambios en los tests

- **Test 6 — REFORMULADO y RENOMBRADO** → "tras la baja el token queda revocado (signOut
  global) → 401". Documenta la propiedad REAL y MÁS SEGURA: el access token residual no
  sirve para re-operar tras la baja (la idempotencia que asumía el test viejo NO ocurre
  en el flujo normal porque el signOut revoca la sesión). Aserta `status === 401` +
  `body.error.code === 'unauthorized'` (la firma válida llega al código → es el 401 de la
  función).
- **Test 6b — NUEVO** → "already_deleted (branch idempotente): perfil ya soft-deleteado +
  sesión viva → 200". Cubre el branch `200 already_deleted` EN AISLAMIENTO sin depender
  del signOut: soft-delete directo de la fila con el admin client + invoke con token vivo
  → `200 already_deleted:true`. Mantiene cobertura honesta de ese branch defensivo (caso
  de falla parcial: si el signOut hubiera fallado, el usuario reintenta → idempotente).
  El usuario nuevo (`del_already`) se limpia por el barrido service_role (`deleteUser`
  cascadea `public.users` aun soft-deleteado) — verificado, no rompe el cleanup.
- **Test 7 — corregido** → con verify_jwt ON el no-Bearer da 401 del PLATFORM, sin
  `error.code`. Se quitó la aserción `body.error.code === 'unauthorized'` (era falsa);
  queda `status === 401`. La propiedad de seguridad es el 401 (sin sesión no se opera);
  el shape del body lo decide el gateway, no nuestro código. Comentario inline explica.

### Resultado

- Suite edge sola: **36 pass / 0 fail** (Fase 2 intacta + bloque delete_account con los 9
  tests: 1-8 + 6b, todos verdes).
- `node scripts/check.mjs` completo verde: anti-hardcode 0, typecheck OK, client unit
  **124/124**, RLS **17/17**, Edge **36/36**, Animal (02) **28/28**, Maniobras (03)
  **13/13**.
- **Conclusión de seguridad**: `verify_jwt` ON CIERRA la ventana residual del access
  token tras la baja (la 2da llamada con el token revocado da 401, no re-opera). El branch
  `already_deleted` es DEFENSIVO (caso de falla parcial del signOut), no alcanzable en el
  flujo normal — testeado en aislamiento.

## Qué falta (NO es de esta sesión)

- **Leader**: aplicar migración `0058_delete_account_rpc.sql` + deployar edge
  `delete_account`. Tras eso, re-correr `node scripts/check.mjs` → los 7 tests deberían
  pasar.
- **Reviewer + Gate 2** (security_analyzer modo code, diff desde `baseline_commit`).
- **Frontend** (otra fase): `services/account.ts` + UI doble confirmación + lista
  bloqueante (R2.5.1).
