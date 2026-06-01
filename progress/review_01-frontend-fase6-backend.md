# Review — T6.3 Eliminar cuenta (BACKEND)

> Reviewer pass sobre codigo sin commitear (working tree, no deployado).
> Feature: 01-identity-multitenancy (in_progress). Tarea: T6.3 backend (R2.4, R2.5, R2.5.1).
> Contrato: specs/active/01-identity-multitenancy/design-T6.3-delete-account.md (Gate 1 PASS rev.2).

## Veredicto: APPROVED

Backend fiel al design rev.2, fail-closed en todos los caminos, mapeo de errcode correcto,
deviacion del signOut correcta y bien documentada, tests de buena calidad con cleanup robusto.
Los 7 fallos de runtime de check.mjs son SOLO por falta de deploy (404 = funcion no encontrada),
tal como lo declara la nota de la tarea y la bitacora. Evalue la CALIDAD del codigo de los tests,
no su resultado pre-deploy.

---

## 1. Fidelidad al design (pasos 1-6, responses, codes)

Edge supabase/functions/delete_account/index.ts vs design (lineas 125-167):

- Paso 1 identidad solo del JWT (index.ts:54-55): requireUser, sin parseo de body. Cierra IDOR (D5). OK
- Paso 2 idempotencia (index.ts:57-69): lee users.deleted_at con admin; si seteado -> jsonOk already_deleted; userErr -> 500 sin escribir. OK
- Paso 3 pre-check bloqueantes (index.ts:71-128): owner-roles activos -> filtro establecimientos activos (deleted_at is null, D4) -> conteo owners por campo (<=1 = solo yo). Fail-closed en rolesErr/estErr/countErr. Bloqueantes -> 409 sole_owner con {establishments}. OK
- Paso 4 RPC atomica (index.ts:130-146): adminClient.rpc(delete_account_tx, {p_user_id}); mapeo 23514 -> 409; otro error -> 500. OK
- Paso 5 revocacion auth (index.ts:148-179): signOut(accessToken,global) + updateUserById(ban_duration), ambos en try/catch que loguea y NO rompe (HIGH-1.c). OK
- Paso 6 (index.ts:182): jsonOk. 405 (index.ts:46-48), catch HttpError/unexpected (index.ts:183-189). OK

Todas las responses del contrato (200 ok / 200 already_deleted / 409 sole_owner+establishments / 401 / 405 / 500) presentes con codes correctos. establishments viaja por el extra de jsonError (errors.ts:8-18). OK

Migracion 0058 identica al bloque del design (36-95): RPC SECURITY DEFINER, re-validacion TOCTOU raise 23514, revoke public/authenticated/anon, grant service_role, smoke-check fail-closed, notify pgrst. Patron 0041/0055. OK

## 2. Fail-closed

NO hay write antes de validar. Unico write = RPC del paso 4. Reads previos (idempotencia, roles, ests, count) -> 500 ante error ANTES de escribir; 409 bloqueantes retorna sin escribir; la RPC re-valida atomicamente adentro y por ser transaccion un error la deja intacta. signOut/ban son post-write en try/catch que solo loguea. Correcto. OK

## 3. Mapeo errcode 23514 -> 409 sole_owner

Correcto. PostgrestError.code lleva el SQLSTATE (app/node_modules/@supabase/postgrest-js/src/PostgrestError.ts:9,29). El raise using errcode=23514 (check_violation) de la RPC (0058:36-37) se propaga a rpcErr.code. El narrowing (rpcErr as {code?:string}).code === 23514 (index.ts:138) -> jsonError(409, sole_owner, {establishments:[]}) es fiel al paso 4. OK

## 4. Calidad de los 8 tests + cleanup

supabase/tests/edge/run.cjs:714-954. Los 8 cubren lo que dicen:
- Test 1 (R2.4): baja simple -> deleted_at set + 0 roles activos. OK
- Test 2 (HIGH-1): re-login post-ban con client fresco -> falla. Vector real del ban. OK
- Test 3 (R2.5+R2.5.1): 409 sole_owner + establishments:[{id,name}] correcto + NO se escribio (deleted_at null, rol activo). OK
- Test 4: 2do owner -> 200, usuario sin rol activo, campo conserva al otro owner. OK
- Test 5 (D4): campo soft-deleteado no bloquea -> 200. OK
- Test 6 (idempotencia): toma access token ANTES de la 1ra baja (residual ~1h que el design tolera), 2da llamada raw fetch -> 200 already_deleted. Diseno consciente del ban. OK
- Test 7 (sin sesion): raw fetch sin Bearer -> 401 unauthorized. OK
- Test 8 (IDOR/grant RPC): POST directo a /rest/v1/rpc/delete_account_tx con JWT authenticated targeteando victim.id -> notEqual(status,200) + victima no escrita. ES el vector IDOR real. Comentario inline (931-938) documenta honestamente la ambiguedad pre-deploy del 404; el invariante duro (nunca 200, victima nunca escrita) es invariante a esa ambiguedad. 2da capa = smoke-check fail-closed de la 0058 (58-73). OK

Cleanup borra usuarios baneados/soft-deleteados: SI. cleanup() (run.cjs:105-117) borra establecimientos (cascade a user_roles por establishment_id) y luego admin.auth.admin.deleteUser(uid) (service_role), que borra auth.users aun baneado -> cascade a public.users (FK 0001:10 on delete cascade) -> cascade a user_roles por user_id (0003:19). El ban es metadata de auth, no impide deleteUser admin. Cadena FK verificada. OK

Helpers nuevos getAccessToken (694-701) y grantOwnerRole (703-712) correctos.

## 5. Deviacion signOut(access_token) vs signOut(user.id) — CORRECTA

Verificado contra app/node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.js:67-91: firma signOut(jwt, scope) con @param jwt = A valid logged-in JWT, que POSTea el jwt a /logout?scope=global. Pasar user.id (UUID) seria mis-use: enviaria un UUID donde se espera un JWT firmado -> no revocaria las sesiones (no-op/error). La correccion (extraer el Bearer del header Authorization, index.ts:151-152) cumple la INTENCION documentada (revocar todos los refresh tokens server-side). El design rev.2 ya lo refleja (152-158, 185). NO cambia contrato ni modelo de seguridad. Deviacion valida, bien documentada, flageada para Gate 2. OK

## 6. Housekeeping y coherencia

- tasks.md:305-315: T6.3 [x] Backend (RPC + edge + 8 tests, Gate 1, falta deploy) y [ ] Frontend justificado (otra fase). Coherente con el scope (solo backend). OK
- Migracion 0058 libre (maximo previo 0057). OK
- Bitacora progress/impl_01-frontend-fase6-backend.md completa (plan, archivos, decisiones, trazabilidad, autorrevision, que falta). OK
- Arquitectura: edge en functions/, migracion en migrations/, tests en tests/edge/, usa _shared/*. Respeta architecture.md. OK
- Convenciones: SQL snake_case + comentarios WHY en espanol; TS sin any (narrowing tipado as {...}); console.error = logging legitimo HIGH-1.c, no debug suelto. OK

---

## Trazabilidad R<n> <-> test

- R2.4 (soft-delete + desactivar roles) -> run.cjs Test 1 (deleted_at set + 0 roles activos) + Test 4 (rol inactivo con 2do owner)
- R2.5 (unico owner bloquea) -> run.cjs Test 3 (409 sole_owner, sin escribir) + red TOCTOU RPC raise 23514 (mapeo verificado seccion 3)
- R2.5.1 (lista de campos bloqueantes) -> run.cjs Test 3 (error.establishments:[{id,name}] con el campo del usuario)
- D4 (campo soft-deleteado no bloquea) -> run.cjs Test 5
- HIGH-1 (ban/signOut -> no re-login) -> run.cjs Test 2
- D5 / sin sesion (IDOR del body) -> run.cjs Test 7
- HIGH-1 IDOR de la RPC / grant blindado -> run.cjs Test 8 + smoke-check fail-closed 0058:58-73
- Idempotencia -> run.cjs Test 6

Cada R<n> tiene >=1 test concreto. OK

## Tasks completas: si (backend)
T6.3 backend [x]; frontend [ ] con justificacion documentada (otra fase). Dentro del scope declarado de la sesion (solo backend).

## CHECKPOINTS
- C3 (arquitectura): [x] solo capas previstas; [x] sin deps nuevas; [x] sin debug suelto/TODOs; [x] sin establishment_id hardcodeado.
- C4 (verificacion real): [x] test por modulo con logica; [x] fixtures reales (usuarios/campos namespaced contra remoto, no mocks); [~] runner >0 tests verdes EXCEPTO los 7 de delete_account, rojos SOLO por falta de deploy (esperado; el leader deploya); [x] cross-tenant (Test 8 IDOR de la RPC).
- C6 (SDD): [x] specs presentes; [x] R en EARS; [x] tasks backend [x]; [x] cada R con >=1 test.
- C7 (multi-tenant): [x] sin establishment_id hardcodeado; [x] RLS preexistente intacta; [x] Test 8 cross-tenant/IDOR.
- C1/C2/C5/C8: N/A (harness ya existe; no es feature offline-first de carga en campo; cierre de sesion lo hace el leader).

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): aplica parcialmente. NO crea tablas nuevas (reusa users/user_roles/establishments con RLS existente). La RPC nueva es SECURITY DEFINER con grants blindados (revoke public/authenticated/anon, grant service_role) + smoke-check fail-closed (0058:46-73). [x] aislamiento cross-tenant: Test 8. [x] deleted_at IS NULL filtrado en pre-check (index.ts:98) y en la RPC (0058:29,41). Helpers has_role_in/is_owner_of: N/A — la logica de unico owner es un conteo especifico no expresable con esos helpers; precedente directo en remove_member/change_member_role.
- E (Edge Functions): [x] valida auth.uid() al inicio via requireUser (index.ts:55); [x] permisos = identidad solo del JWT + conteo de owners (no requiere requireOwnerOf porque el usuario actua sobre SI MISMO); [x] errores con HTTP code + mensaje claro (jsonError); [~] deno test: la suite corre via Node-nativo (edge/run.cjs, ADR-012 — Docker/Deno no en el entorno), no deno test — patron del repo, no regresion.
- B (offline-first): N/A — eliminar cuenta es operacion administrativa online (consistente con R9.2). Documentado N/A.
- C (BLE): N/A.
- D (UI de campo): N/A — esta sesion es solo backend; la UI (doble confirmacion, lista bloqueante) es de la fase frontend pendiente.

## Cambios requeridos
Ninguno. Aprobado.

## Notas para el leader (no bloqueantes)
1. Deploy: aplicar 0058_delete_account_rpc.sql + deployar edge delete_account, luego re-correr node scripts/check.mjs -> los 7 tests deberian pasar. Confirmar Test 8 post-deploy (sigue 404 por ocultamiento de PostgREST; la garantia dura del revoke es el smoke-check de la 0058).
2. Gate 2 (security_analyzer): re-validar la deviacion del signOut y el orden RPC-antes-del-ban (el design lo deja explicito para Gate 2, design:172-179).
3. El design rev.2 ya refleja la deviacion del signOut; no requiere mas edicion de la spec.
