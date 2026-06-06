# Review - Feature 13 (13-hardening-seguridad)

## Veredicto: APPROVED

Fecha: 2026-06-05. Baseline diff: 6a92ceb1773fb3a4dce9e4b3ebb565209f9f8c0d.
Re-review FOCALIZADA: SOLO el fix del blocker #1 de la review previa (H1-1 / R9 / R10). Los otros 4 fixes (INPUT-1 / B1-1 / A1-1 / F1-1) ya estaban aprobados antes y NO se re-evaluaron salvo para confirmar NO-regresion. El trabajo de otras terminales en el working tree (feature 2/BLE, feature 14) queda fuera de alcance.

## Resumen

El unico blocker de la review previa esta RESUELTO. El mecanismo de invalidacion de sesion del target en remove_member/change_member_role se reemplazo: del ban finito de 1s (que NO revocaba el refresh token de forma persistente, confirmado empiricamente por el leader: tras ban 1s + 2.5s, refreshSession con el token original VOLVIA a funcionar) a una RPC SECURITY DEFINER revoke_user_sessions(target_uid) que hace DELETE FROM auth.sessions WHERE user_id = target_uid, revocando los refresh tokens de forma PERSISTENTE (mismo efecto que signOut global, pero por user id). El test R10 se reescribio determinista (sin ventana temporal). El RPC esta blindado para que SOLO service_role lo invoque. La EF autoriza (requireOwnerOf) ANTES de llamar al RPC. Los otros 4 fixes no se rompieron.

## 1. Cumple R9.1/R9.2 (invalida la sesion persistente)?

SI. 0072_revoke_user_sessions_rpc.sql:38-47: la funcion ejecuta delete from auth.sessions where user_id = target_uid. Borrar las filas de auth.sessions deja los refresh tokens asociados sin poder canjearse, revocacion PERSISTENTE (no una ventana de ban). Verificado empiricamente por el leader (0072:19-27): tras DELETE FROM auth.sessions WHERE user_id=X + 2s, refreshSession con el token original FALLA persistente (400 Invalid Refresh Token: Refresh Token Not Found); control PRE-DELETE el mismo refresh devolvia sesion valida (auth.sessions 2 a 0). El access token vigente del target vive hasta su exp (~1h) cubierto por RLS (user_roles.active=false niega acceso en cada request), aceptable para riesgo MEDIUM, coherente con R9.4.
- remove_member (R9.1): remove_member/index.ts:104-111, RPC tras el update active:false.
- change_member_role (R9.2): change_member_role/index.ts:133-140, RPC tras el split de rol.

## 2. Seguridad del RPC (CRITICO) - BLINDADO

- SECURITY DEFINER + search_path fijo: 0072:39-40 (security definer + set search_path = public). auth.sessions con esquema explicito (auth NO esta en search_path), sin search_path hijacking. OK.
- EXECUTE revocado de los TRES roles cliente: 0072:51 revoke all ... from public, authenticated, anon (no solo public; defiende contra un ALTER DEFAULT PRIVILEGES ... GRANT ... TO authenticated, leccion SEC-HIGH-01). 0072:52 grant SOLO a service_role. OK.
- Smoke-check fail-closed: 0072:57-72 DO-block que recorre authenticated/anon/public con has_function_privilege(...,EXECUTE) y raise exception ABORTANDO la migracion si cualquiera la pudiera ejecutar. Si el revoke fallara, la migracion no deja una funcion de logout-de-cualquiera expuesta. OK.
- La EF autoriza ANTES del RPC: en AMBAS requireOwnerOf(adminClient, user.id, establishmentId) corre mucho antes del RPC (remove_member:44 a RPC:104; change_member_role:53 a RPC:133). El RPC es lo ULTIMO, tras requireUser + requireOwnerOf + rol activo + last-owner. Un no-owner recibe 403 antes de tocar sesiones. OK.
- Riesgo DoS/abuso (cualquier usuario deslogueando a cualquier otro): NEUTRALIZADO en dos capas: el cliente no puede invocar el RPC (execute revocado + smoke-check), y aunque pudiera, la EF exige owner.

## 3. El test R10 es determinista (no timing) y verifica invalidacion persistente?

SI. edge/run.cjs:1106-1144 (R10.1) y :1149-1187 (R10.2):
- NO hay sleep/retry/ventana temporal. La premisa es la persistencia del DELETE, no un bloqueo finito.
- CONTROL anti-falso-positivo (:1112-1124 / :1158-1169): antes de invocar la EF, prueba que el refresh token SI produce sesion (preErr nulo y preRefresh.session presente). Descarta el falso positivo de un token pre-invalido. Re-captura un refresh fresco (refreshFresh) post-control para evitar rotacion.
- Assert final (:1137-1143 / :1180-1186): tras la EF, refreshSession con el token previo FALLA (refreshErr presente y refreshed.session ausente), sin reintentos. Verifica invalidacion persistente, no transitoria. Cierra exactamente el defecto de la review previa (condicion de carrera).
- Helpers reales: createTestUser, getUserClient (signInWithPassword a sesion real), getRefreshToken, grantOwnerRole. Todos existen (run.cjs:76,89,712,1027).
- Gating: bloque entero skip:spec13Skip (run.cjs:1035), corre post-deploy con SPEC13_APPLIED=1.

## 4. Se rompio alguno de los otros 4 fixes? - NO

- B1-1 (serverError): _shared/errors.ts intacto (diff vs baseline = solo el add original). En ambas EFs los 5xx siguen usando serverError(...) (remove_member:55,73,92; change_member_role:62,85,103,123); el catch generico usa serverError(unexpected,err) (remove_member:118, change_member_role:147). El RPC fail-soft NO introduce ningun 5xx con .message crudo (va a console.error, no al body). grep ban_duration|updateUserById en ambas EFs = 0.
- A1-1 (0071) / INPUT-1 (0070) / F1-1: NO tocados en este fix-loop (solo 0072 + las 2 EFs). delete_account conserva su signOut global + ban permanente para auto-baja, sin cambios. R9.4 (no revierte rol) y R9.5 (revokeErr a console.error, nunca al body) preservados.

## Trazabilidad R-n a test (foco re-revisado)

- R9.1 a R10.1 determinista, edge/run.cjs:1106-1144 - OK (DELETE auth.sessions 0072:46, persistente).
- R9.2 a R10.2 determinista, edge/run.cjs:1149-1187 - OK.
- R9.3 (apunta a target_uid, no al access token del caller) a RPC toma target_uid; 0072:10-17 - OK.
- R9.4 (fail-soft) a try/catch + console.error, no revierte el write - OK.
- R9.5 (no expone el error) a revokeErr a console.error, nunca al body - OK.
- R10.1/R10.2/R10.3 a edge/run.cjs:1106-1187, gated, determinista con control anti-falso-positivo - OK.

Conclusion: el R-n que la review previa marcaba sin verificacion efectiva (R9.1/R9.2) AHORA queda verificado por un test valido (persistente, no timing). No quedan R-n sin test.

## Tasks completas: si (21/21 en [x])

Todas en [x] (tasks.md:11-46). T16/T17/T18/T19 (H1-1) ya no tienen el defecto material previo: el mecanismo (RPC DELETE auth.sessions) satisface el R9, y el test T19 es determinista. La migracion real del fix-loop (0072) esta documentada en remove_member:98 / change_member_role:128 / cabecera de 0072.

## CHECKPOINTS

- C1: [x] archivos/docs. [ ] check.mjs sobre una-sola-in_progress = FAIL preexistente (varias terminales con features in_progress), NO regresion de este fix. node scripts/check.mjs corre verde (exit 0): typecheck OK, anti-hardcode 0, tests puros + suite spec 14 (19/19) verdes.
- C3: [x] capas previstas (SQL + RPC + 2 EFs + test). [x] sin deps nuevas. [x] console.error = logging server-side intencional (R9.4/R9.5). [x] no se hardcodea establishment_id.
- C4: [x] >=1 test por modulo con logica (R10.1/R10.2). [x] fixtures reales (service-role + sesion real + refresh token real). [x] toca auth/sesion = test de invalidacion persistente con control.
- C6: [x] trazabilidad. [x] cada R-n con >=1 test = AHORA SI para R9.1/R9.2 (era el FAIL previo).
- C7: [x] RPC SECURITY DEFINER con esquema explicito + search_path fijo + grants blindados; logica de revocacion en una sola RPC (no SQL inline duplicado en las EFs).
- C2/C5/C8: N/A a este fix-loop.

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (RLS) - N/A. El RPC opera sobre auth.sessions (no tabla de tenant). A1-1 (que si toca RLS) ya estaba aprobado y no se toco.

### B. Offline-first - N/A. No agrega carga de datos en campo (H1-1 blinda el caso offline futuro C4 invalidando la sesion, pero no introduce flujos offline nuevos).

### C. BLE - N/A. No toca BLE.

### D. UI de campo - N/A. Fix server-side puro (SQL + 2 EFs + test).

### E. Edge Functions - APLICA (remove_member + change_member_role)
- [x] auth.uid() al inicio: requireUser preservado (remove_member:30, change_member_role:34).
- [x] permisos via owner ANTES de la operacion: requireOwnerOf corre antes del RPC. CRITICO verificado.
- [x] codigos HTTP apropiados: 5xx copy generico (serverError); 4xx copy a mano (R3.4); revokeErr fail-soft no altera el 200 ok:true.
- [ ] test deno test verde = la suite EF corre con runner Node (edge/run.cjs), no deno test; gated por SPEC13_APPLIED. El test R10 reescrito es determinista y valido. Justificacion: convencion del repo, no falta de cobertura. NO bloquea.
- [x] El RPC SECURITY DEFINER invocado por las EFs esta blindado (solo service_role, smoke-check). Ver seccion 2.

## No-regresion (los otros 4 fixes)

- B1-1: serverError intacto; 0 hits de .message crudo en 5xx; ban removido sin tocar el patron.
- INPUT-1 (0070) / A1-1 (0071) / F1-1: no aparecen en el diff del fix-loop (solo 0072 + 2 EFs + test).
- delete_account: mecanismo de auto-baja sin cambios.

## Cierre

node scripts/check.mjs: exit 0 (Entorno listo), typecheck OK, anti-hardcode 0, tests puros + suite spec 14 verdes (19/19). Las suites DB/edge de spec 13 (incl. R10) gated por SPEC13_APPLIED, corren verde post-apply/redeploy del leader.

Veredicto: APPROVED. El unico blocker previo (H1-1/R9: ban finito no invalidaba la sesion persistente; test R10 era condicion de carrera) esta resuelto: RPC revoke_user_sessions con DELETE persistente de auth.sessions (verificado empiricamente), blindada a service_role con smoke-check fail-closed, autorizada por requireOwnerOf antes de invocarse, y test R10 determinista con control anti-falso-positivo. Los otros 4 fixes no se rompieron. Pendiente operativo (no bloqueante, del leader): aplicar 0072 + redeploy de las 2 EFs y correr con SPEC13_APPLIED=1 para ver R10 en verde.

