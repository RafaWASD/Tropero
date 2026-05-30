# Review - 02-modelo-animal | Tier 1 backend (migrations 0043-0049 + T2.19)

baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53 | rama main (cambios sin commitear).
Alcance: delta Tier 1 del backend de spec 02 - migrations 0043-0049 (untracked) + bloque T2.19 de supabase/tests/animal/run.cjs (+331/-1). NO pisa review_02-modelo-animal.md (sesion 15).

## Veredicto: APPROVED

El codigo matchea el design endurecido post-Gate-1 al pie; los contratos de seguridad (security_spec_02-modelo-animal.md re-audit PASS + security_spec_02-fold-tier1.md) estan intactos; la atomicidad de register_birth (R2-NEW) esta probada con un test de rollback real (ternero intermedio invalido); node scripts/check.mjs verde end-to-end (typecheck + RLS + Edge Functions 26 + Animal 28, 0 fail, incl. 8 sub-tests de T2.19); sin scope creep a Tier 2/3 ni feature 11. Las 3 desviaciones son mecanicas, solidas y documentadas. Dos observaciones no-bloqueantes al final.

---

## 1. El codigo matchea el design endurecido - verificado

- Guarda exit_animal_profile = has_role_in(v_est) and (is_owner_of(v_est) or v_creator = auth.uid()) -> 0044_exit_reason_enum.sql:48-51. OK: identica al design l.855-858 y al patron canonico soft_delete_animal_event (0041 l.78). v_est/v_creator de la fila real (where id=p_profile_id and deleted_at is null, l.38-39). search_path=public (l.35). Revoke/grant firma tipada completa (l.67-68) + notify pgrst (l.70).
- tg_force_created_by_auth_uid SIEMPRE sobreescribe (no solo-si-NULL) -> 0043:15-20. OK: new.created_by := auth.uid() incondicional (l.18) + comentario que lo contrasta con el helper audit-only (l.22-25).
- register_birth deriva el establishment de la FILA REAL de la madre -> 0045:213-225. OK: select p.establishment_id where p.id=p_mother_profile_id and p.deleted_at is null (l.214-219); has_role_in(v_est) ANTES de cualquier INSERT (l.223-225); cada ternero hereda v_est literal (l.269), nunca tenant del payload.
- register_birth revoke from public,anon + grant tipado a authenticated + search_path -> 0045:194,297-298. OK: set search_path=public (l.194); revoke from public,anon + grant to authenticated firma (uuid,date,jsonb) (l.297-298) + notify pgrst (l.300).
- birth_calves select-only para authenticated, RLS con re.deleted_at is null -> 0045:24-39. OK: enable RLS (l.24); policy SELECT con re.deleted_at is null (l.31); SIN policy de INSERT; grant select to authenticated (l.39).

Items 4 (recompute 0046) y 5 (rodeo same-system 0047): copia fiel del design (l.1481-1508 / l.896-916), ambos trigger functions SECURITY DEFINER + search_path=public, no-RPC. El recompute solo escucha event_type/pregnancy_status/deleted_at - calf_id NO esta en la lista, asi que el update set calf_id de register_birth (l.290) no lo re-dispara (correcto, evita doble transicion).

## 2. Atomicidad de register_birth (R2-NEW) - verificado de verdad

- El cuerpo NO captura excepciones con exception-when-others-return que las trague: propaga todo. El trigger mono (0048 l.74-77) re-raisea explicito. R9.4 conservado.
- Test de control REAL, no de fachada (run.cjs:1371-1413): el ternero invalido esta en posicion INTERMEDIA [valido, dup(TAG global), valido] (l.1390-1394). Tras el fallo verifica que el conteo de reproductive_events Y el de animal_profiles vuelven al baseline (l.1402-1405) - el ternero #1 ya insertado tambien se revierte - y que la madre NO transiciona (vaquillona_prenada, l.1411). Prueba el rollback total, no solo el primer ternero. createAnimal soporta tag/categoryCode (l.153): el TAG duplicado es genuino (unique global -> 23505 en el INSERT del calf #2).

## 3. Las 3 desviaciones - solidas

1. 0048 mono-ternero a AFTER INSERT - CORRECTA. En BEFORE INSERT la fila de reproductive_events no existe, asi que insert into birth_calves(birth_event_id=new.id) viola el FK (23503). El fix separa responsabilidades: BEFORE INSERT (tg_reproductive_events_create_calf, 0048 l.21-77) vuelve identico al as-built 0032 (verificado linea por linea, incl. exception/raise); AFTER INSERT nuevo (tg_reproductive_events_link_birth_calf, l.82-92) puebla la puente con new.id/new.calf_id ya persistidos. Ambos SECURITY DEFINER (cliente sin GRANT INSERT, SEC-SPEC-04 intacto). Atomicidad: el AFTER trigger corre en la misma transaccion del INSERT. No rompe el conteo de partos (la transicion de la madre sigue siendo apply_transition AFTER INSERT, una vez por evento). Ordering note (l.94-97) correcto. register_birth no sufria el bug (l.236-241) y no se toco.
2. 0049 grant a service_role - CONSISTENTE con la convencion (cada tabla nueva concede a service_role; sin el la suite recibia 42501 al leer con admin). El cliente (authenticated) NO cambia: select-only, SEC-SPEC-04 intacto. (Ver O1: usa grant select en vez del grant all literal - no-bloqueante.)
3. compute_category re-emitida en 0045 (l.45-108) - identica al as-built 0031 l.1319-1381 (verificada). El conteo sigue siendo count(*) sobre reproductive_events con event_type='birth' and deleted_at is null (l.75-79), NUNCA filas de birth_calves. create or replace idempotente. Probado por T2.19 caso 2 (mellizos=1 parto -> madre vaca_segundo_servicio, no multipara, l.1192-1195).

## 4. Tests T2.19 - reales, verde

8 sub-tests (run.cjs:1088-1414), todos verde en check.mjs. No son fachada (asserts de estado leidos con service_role, no solo del error de la RPC):

- caso 1 (SEC-SPEC-01, l.1091): autor con rol inactivo -> 42501 + status=active + exit_* NULL (l.1119-1125); control owner -> baja procede, deleted_at NULL (l.1126-1137).
- caso 2 (SEC-SPEC-02, l.1141): cross-tenant A->B -> 42501 + snapshot de conteos confirma 0 evento / 0 perfiles en B (l.1148-1170); control B -> 2 filas birth_calves, terneros heredan est+rodeo de la madre (l.1180-1191).
- caso 3 (SEC-SPEC-04, l.1200): INSERT directo a birth_calves bloqueado + verifica que no quedo la fila (l.1224-1227).
- caso 4 (SEC-SPEC-04.a, l.1231): soft-delete del parto -> 0 filas para authenticated, filas fisicas presentes con service_role (l.1253-1262).
- caso 5 (SEC-SPEC-03, l.1266): created_by=userB spoofeado -> fila queda created_by=userA (l.1287-1290); corolario authz: userB no puede dar de baja via v_creator (l.1291-1303).
- caso 6 (L2, l.1307): alta mono + mellizos no bloqueada; terneros del mismo system de la madre.
- caso 7 (R4.5.1, l.1352): cambio de rodeo mismo-sistema permitido.
- control rollback (R2-NEW, l.1371): ver seccion 2.

T2.4/T2.5/T2.7/T2.18 as-built siguen verde (suite 19->28).

## 5. Convenciones - OK

GRANT explicito a authenticated (0043-0047) y service_role (0049); sin hardcode de establishment_id; split insert+select respetado; RLS deriva establishment por join a reproductive_events->animal_profiles (R11.2, 0045 l.29-32); soft-delete coherente (re.deleted_at is null en SELECT; la baja de animal NO es soft-delete). Todas las migrations cierran con notify pgrst reload schema.

## 6. node scripts/check.mjs - VERDE (corrido por el reviewer)

typecheck client OK | RLS suite OK (fail 0) | Edge Functions OK (tests 26, fail 0) | Animal suite OK (tests 28, fail 0, incl. T2.19 8/8). All tests passed / Entorno listo.

## 7. Scope - sin creep

git diff 9f18037..HEAD para supabase/ + specs/active/02-modelo-animal/ vacio (todo el Tier 1 sin commitear: migrations untracked, run.cjs working-tree +331/-1). El diff de run.cjs no introduce weaning/abortion/castracion/breed/transferencia/reparent. Sin dependencias nuevas. Los otros archivos del working tree (CLAUDE.md, CONTEXT/, design frontend, app/package.json, scaffolding B.0) son de streams paralelos, NO de esta task.

---

## CHECKPOINTS aplicables

- C2 estado coherente: [x]
- C3 codigo respeta arquitectura: [x] (migrations SQL; sin hardcode de establishment_id; sin deps nuevas)
- C4 verificacion real: [x] (>0 tests verde, fixtures reales contra DB remota, test cross-tenant presente)
- C6 SDD: [x] (T2.19 [x]; cada R<n> del delta con >=1 test)
- C7 multi-tenant: [x] (birth_calves RLS por join, helpers has_role_in/is_owner_of reusados, test cross-tenant casos 1/2)
- C1/C5/C8: N/A a este delta (harness ya completo; cierre de sesion lo hace el leader; offline/PowerSync es Fase 3)

## Checklist RAFAQ-especifico

- A. Multi-tenancy/RLS (aplica): [x] enable RLS en birth_calves; [x] policies segun ADR-004/patron as-built; [x] helpers has_role_in()/is_owner_of() usados; [x] test cross-tenant (casos 1,2); [x] re.deleted_at is null en SELECT.
- B. Offline-first: N/A - backend-only (sin pantalla/repositorio/bucket nuevo; est_birth_calves queda en design para Fase 3).
- C. BLE: N/A.
- D. UI de campo: N/A.
- E. Edge Functions: N/A - el fold no agrega Edge Functions (RPCs PL/pgSQL SECURITY DEFINER ya auditados en Gate 1; authz has_role_in/auth.uid() al inicio de cada RPC).

## Trazabilidad R<n> <-> test

| R<n> / contrato | Migration | Test |
|---|---|---|
| R4.1 (created_by forzado, SEC-SPEC-03) | 0043 | T2.19 caso 5 (run.cjs:1266) |
| R4.14/R4.15 (baja via RPC, rol activo, SEC-SPEC-01) | 0044 | T2.19 caso 1 (run.cjs:1091) + control owner |
| R7.9/R9.5 (mellizos, conteo por evento, SEC-SPEC-02) | 0045/0048 | T2.19 caso 2 (run.cjs:1141) + caso 6 |
| R9.4 (rollback atomico) | 0045/0048 | control rollback (run.cjs:1371) + T2.7 mono (run.cjs:531) |
| SEC-SPEC-04 (birth_calves sin INSERT cliente) | 0045/0049 | T2.19 caso 3 (run.cjs:1200) |
| SEC-SPEC-04.a (filtra parto soft-deleted) | 0045 | T2.19 caso 4 (run.cjs:1231) |
| R6.14 (recalculo al editar/borrar evento) | 0046 | T2.4/T2.5 as-built + cobertura indirecta caso 2/control |
| R4.5.1 (cambio rodeo mismo-sistema) | 0047 | T2.19 caso 7 (run.cjs:1352) |
| L2 (alta de ternero no bloqueada) | 0045/0047/0048 | T2.19 caso 6 (run.cjs:1307) |
| R11.x (aislamiento multi-tenant) | 0044/0045 | casos 1,2 + T2.18 as-built |

Tasks completas: si (T2.19 [x]; unica task del fold - las 5 migrations implementan items ya firmes en design.md).

---

## Observaciones no-bloqueantes (para el leader/commit)

- O1 - 0049 usa grant select en vez de grant all ... to service_role. La convencion as-built (0010/0019/0020/0025/0038) concede grant all on public.<tabla> to service_role. 0049 (birth_calves_service_role_grant.sql:17) concede solo select. Funcionalmente suficiente (la suite solo lee con admin; cleanup por CASCADE) y NO afecta la superficie del cliente. Sugerencia opcional: alinear a grant all por consistencia. NO bloquea.
- O2 - 0045 define el trigger mono con el insert into birth_calves roto (l.174-175) que 0048 reemplaza acto seguido. En chain forward-only sobre DB vacia (sin mono-birth entre 0045 y 0048) el estado transitorio nunca se ejecuta. Como las migrations estan untracked, el implementer PODRIA squashear 0048 dentro de 0045 antes de commitear para no dejar cuerpo muerto en la historia. NO bloquea (forward-only, idempotente, probado).
