# Review (reviewer) — 18-audit-log

- Feature: 18-audit-log (in_progress, unica en ese estado) - Reviewer: reviewer
- Baseline: 6960238 - Input: specs/active/18-audit-log/{requirements,design,tasks}.md +
  progress/impl_18-audit-log.md + progress/security_spec_18-audit-log.md (Gate 1 re-run PASS).
- Artefactos revisados: supabase/migrations/0124_audit_log.sql; 4 EFs
  (accept_invitation/change_member_role/remove_member/delete_account) + _shared/supabase.ts;
  supabase/tests/audit/run.cjs; hook (comentado) en scripts/run-tests.mjs.

## Veredicto: APPROVED (condicionado a suite verde post-deploy)

El codigo estatico esta bien: migracion fiel a la spec, resolve_actor() TOTAL, hot-path airtight,
4 EFs sin cambio de contrato, suite TA.1-TA.16 cubre lo que dice la spec, reconciliacion R4.x/D5 coherente.
node scripts/check.mjs = VERDE (exit 0; 14 suites backend + typecheck + unit; hook audit comentado).
Como el DEPLOY esta gateado (correcto), la verificacion FUNCIONAL de la 15a suite (audit) y el re-run de
edge/rls/user_private sobre las EFs redeployadas quedan PENDIENTES POST-DEPLOY (ver seccion "No verificable
sin deploy"). El APPROVED es condicionado a que esas corran verdes.

---

## Foco 1 - La migracion implementa la spec? SI

- Schema audit vendoreado (supa_audit) + enum operation + record_version append-only con las columnas de
  R1.2, SIN FK ni CHECK (auth_uid uuid pelado - R1.10) + 3 indices forenses. Idempotente (if not exists /
  duplicate_object / create or replace) => re-apply-safe (hardening sobre el contrato del design; no cambia
  comportamiento).
- resolve_actor() TOTAL confirmado (mig. L96-121): TODO el cuerpo -incluido el parse de la claim de rol
  (jsonb ->> role, L104)- va dentro de begin ... exception when others then begin return auth.uid();
  exception when others then return null; end; end. NUNCA lanza. Cierra la watch-item M2-a del Gate 1.
- Trigger insert_update_delete_trigger() SECURITY DEFINER search_path vacio, ruteo por tg_argv[0]. En
  best-effort el insert Y to_record_id/primary_key_columns/resolve_actor van INLINE dentro del
  begin...exception when others then null; end (L134-147). El DECLARE solo tiene v_best_effort (L129-130)
  => el actor/pk NO se resuelven fuera del guard. Hot-path airtight (M2-a belt-and-suspenders).
- enable/disable_tracking(regclass, best_effort) idempotentes (chequean pg_trigger).
- REVOKEs de schema/tables/functions + GRANT usage/select a service_role + REVOKE execute de las 7
  funciones sensibles (incl. resolve_actor) (L197-216).
- Smoke-check DOBLE in-migration (DO block L221-244): (a) EXECUTE-able por cliente => abort (R3.6);
  (b) muro de lectura USAGE/SELECT => abort (R3.7). Paridad de tripwire.
- enable_tracking(public.user_roles) ACTIVO (estricto, L247). animals GATEADA/COMENTADA (L255) con nota
  clara referenciando T12/R5.4.
- Retencion pg_cron mensual idempotente (unschedule defensivo + schedule 0-4-1-mensual, L258-261), purga
  ts < now() - interval 90 days.
- Header documenta la semantica temporal (ts=sync), el actor real y el modo de falla (R2.5) + la
  reconciliacion del frontier WAL.

## Foco 2 - resolve_actor() NUNCA aborta el hot-path? SI
Confirmado arriba: total + actor/pk dentro del guard best-effort. Ni parse de claim, ni parse de header,
ni cast, ni primary_key_columns, ni el insert pueden trabar el write de una tabla best-effort.

## Foco 3 - Las 4 EFs propagan el actor del JWT VALIDADO, sin cambio de contrato? SI
Diff quirurgico (verificado git diff): en cada EF createAdminClient() -> createAdminClient(user.id),
reordenado a DESPUES de requireUser(userClient). user.id sale del JWT validado, NO del body (R2.7).
_shared/supabase.ts cambio ADITIVO (sin actorId = comportamiento previo). delete_account propaga por la RPC
delete_account_tx (1 sola request .rpc() con el header => trigger en la txn de la RPC); delete_account_tx NO
se toca. invite_user NO se toca (solo lee user_roles, escribe invitations). Sin cambio de contrato HTTP ni
de authz (requireOwnerOf, validaciones, respuestas) => R8.3 OK.

## Foco 4 - La suite TA.1-TA.16 cubre la spec? SI
Actor real por JWT (TA.2/TA.3), por header prod-path (TA.12 = service_role client + header, NO adminQuery),
actor NULL sin header (TA.6), spoof por el camino de PRODUCCION sobre user_roles via user_roles_update_owner
(TA.13), fail-closed anon/authenticated (TA.7/TA.8/TA.9), append-only (TA.10), frontera WAL por sync-streams
(TA.11), retencion >90d (TA.15), modo de falla por tg_argv (TA.14), smoke EXECUTE (TA.16). Suite
autocontenida, namespaced por RUN_TAG, asserts filtran por auth_uid/record-id, no por conteos absolutos.
Bugs de la propia suite ya corregidos por el implementer en autorrevision (TA.5 coalesce
record_id/old_record_id; TA.11 strip de comentarios inline).

## Foco 5 - Reconciliacion R4.x/D5 (frontier = sync-streams) coherente? SI (con 1 nit no bloqueante)
requirements.md R4.x (nota L148-170), design.md seccion offline-first (L46-58), tasks.md T1/T14/T22 y el
header del .sql (L6-16) documentan de forma coherente: publication powersync es FOR ALL TABLES (verificado
read-only), el frontier real son las sync streams, audit.* no esta en rafaq.yaml (sin catch-all) => no fuga
a devices; D5 se cumple por el frontier de streams. Verificado independientemente: grep audit/record_version
en sync-streams/rafaq.yaml solo matchea comentarios (L3 prosa, L292 "audit de exports" de sigsa_export_log)
- CERO referencias de config activa a audit/record_version. TA.11 codifica el invariante correcto. Requiere
ratificacion de Raf en Puerta 2 (cambio de mecanismo de D5).

---

## Trazabilidad R<n> <-> test (completa)

| R | Cobertura | Estado |
|---|---|---|
| R1.1 schema+tabla append-only | T3 (DDL) + toda la suite lee audit.record_version | test-dependiente |
| R1.2 columnas minimas | T3 (DDL) + TA.2/TA.3/TA.4 asertan op/auth_uid/record/old_record/record_id | OK |
| R1.3 INSERT registra | TA.2, TA.4 | OK |
| R1.4 UPDATE registra | TA.3, TA.4 | OK |
| R1.5 DELETE registra | TA.4 | OK |
| R1.6 record_id estable | TA.5 | OK |
| R1.7 sin PK -> registra igual | static (to_record_id->NULL; no hay tabla PK-less trackeada) | justificado |
| R1.8 append-only | TA.10 | OK |
| R1.9 enable/disable_tracking | TA.14 | OK |
| R1.10 sin FK/CHECK | static (DDL record_version) | justificado |
| R1.11 best-effort vs estricto | TA.14 | OK |
| R2.1 actor real | TA.2/TA.3 (JWT), TA.12 (header) | OK |
| R2.2 actor NULL sin abortar | TA.6 | OK |
| R2.3 actor bajo SECURITY DEFINER | TA.2/TA.12/TA.13 (trigger es definer) | OK |
| R2.4 ts = hora de sync | static (default now()) + header | justificado |
| R2.5 header documenta semantica | static (header 0124 L18-33) | justificado |
| R2.6 header propagation | TA.12 | OK |
| R2.7 actor del JWT, no del body | code (4 EFs createAdminClient(user.id)) - diff verificado | OK |
| R2.8 spoof-safety | TA.13 | OK |
| R2.9 las 4 EFs propagan | code (accept/change/remove/delete) - diff verificado | OK |
| R3.1 revoke lectura | TA.9 | OK |
| R3.2/R3.3 no leen / no PostgREST | TA.7, TA.8, TA.9 | OK |
| R3.4 solo service_role/postgres lee | TA.9 + adminQuery (postgres) a lo largo de la suite | OK |
| R3.5 revoke execute | TA.16 | OK |
| R3.6 smoke EXECUTE | static (DO block a) + TA.16 (outcome) | OK |
| R3.7 smoke muro de lectura | static (DO block b) + TA.9 (outcome) | OK |
| R4.1 pre-req publication | reconciliado (no-STOP) + TA.11 documenta FOR ALL TABLES | reconciliado |
| R4.2 no agregar a publication | TA.11 (audit no en rafaq.yaml) | OK |
| R4.3 no en sync frontier | TA.11 (invariante reconciliado) | OK |
| R5.1 user_roles trackeada estricto | TA.12, TA.14, TA.2/TA.3 | OK |
| R5.2/R5.4 animals gateada | TA.14 (animals sin trigger) + gate T12 (post-deploy) | OK + gate |
| R5.3 no trackear masivas sin medir | gating T12 + static | justificado |
| R5.5 no PII fuerte (user_private) | static (no la trackea) + TA.14 (solo user_roles) | justificado |
| R5.6 no trackear menor prioridad | static + TA.14 | justificado |
| R5.7 member_name PII documentada | static (design M3 + R5.7) | justificado |
| R6.1 cron mensual | static (cron.schedule mensual) | justificado |
| R6.2 purga >90d | TA.15 | OK |
| R6.3 idempotente | static (unschedule defensivo) | justificado |
| R7.1 suite verifica uid | TA.2/TA.3 + suite entera | OK |
| R7.2 fail-closed lectura | TA.7/TA.8 | OK |
| R7.3 14 suites + 15a verde | PENDIENTE POST-DEPLOY (T20) | pendiente |
| R7.4 a/b/c prod-path | TA.12 / TA.6 / TA.13 | OK |
| R8.1 no tocar audit de dominio | T21 (git diff limpio, verificado) | OK |
| R8.2 no exponer en app | T21 + static (git diff sin app/) | OK |
| R8.3 EFs mismo contrato | code (diff verificado: solo actor) | OK |

Ningun R<n> queda sin cobertura. Los marcados static/code son requisitos estructurales o de las EFs,
verificados leyendo la migracion/EF (no admiten test de runtime, p.ej. R1.10 sin FK/CHECK). Los runtime
(TA.*) existen y estan bien construidos; su ejecucion verde es lo pendiente de deploy.

## Tasks completas: SI (todas [x] o [ ]/[~] con justificacion documentada)
- [ ] T12 (gate DURO de volumen de animals): justificado - no medible sin aplicar maquina + import;
  PENDIENTE POST-DEPLOY, documentado en impl seccion "Pendiente post-deploy".
- [ ] T13 (prender animals): justificado - GATEADO por T12; linea PREPARADA pero COMENTADA en 0124.
- [ ] T17 (deploy a dev + 4 EFs): justificado - DEPLOY GATEADO (lo hace leader/Raf).
- [~] T20 (check.mjs verde): parcial - 14 suites + typecheck + unit VERDE ahora; 15a (audit) + re-run
  edge/rls/user_private PENDIENTE POST-DEPLOY.
Ninguna task [ ] sin justificacion.

## CHECKPOINTS
- C1 harness completo - [x] (docs + agentes + check.mjs exit 0).
- C2 estado coherente - [x] (1 sola feature in_progress; suites existentes verdes; current.md describe la sesion).
- C3 codigo respeta arquitectura - [x] (solo supabase/migrations + functions + tests; sin dep nuevas; sin logs debug sueltos; sin TODOs; no hardcodea establishment_id).
- C4 verificacion real - [x] estatico / [ ] pendiente post-deploy para el run verde de la suite audit; fixtures reales (JWT/service_role/Management API), no mocks; test cross-tenant => aqui es fail-closed total (TA.7/TA.8/TA.9, mas fuerte que cross-tenant).
- C5 sesion - N/A al reviewer de codigo (lo cierra el leader); sin artefactos temporales sin trackear.
- C6 SDD - [x] (3 archivos de spec, EARS estricto, tasks justificadas, cada R<n> cubierto).
- C7 multi-tenant - ver Checklist RAFAQ A (audit es cross-tenant por diseno, cerrada por REVOKE, sin RLS establishment_id).
- C8 offline-first - ver B (backend-only; frontier WAL verificado; no carga datos de campo).
- C9 E2E/visual - N/A (backend-only, sin UI; ADR-029 no aplica; sin Gate 2.5).

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id / RLS - MAYORMENTE N/A (justificado)
audit.record_version es cross-tenant por diseno, sin establishment_id y sin RLS deliberadamente: el muro es
REVOKE USAGE ON SCHEMA + no-exposicion PostgREST + smoke-check (design Alternativa B, correcta; service_role
tiene BYPASSRLS => RLS no aportaria). No se crea tabla de negocio nueva ni se cambia la RLS de user_roles.
- [x] enable row level security - N/A (cerrado por REVOKE USAGE, no por RLS; justificado en design).
- [x] Policies CRUD por ADR-004 - N/A (append-only; unico DELETE = purga server-side).
- [x] Helpers has_role_in()/is_owner_of() - N/A (no hay policy nueva; las EFs siguen usando requireOwnerOf).
- [x] Test aislamiento cross-tenant - cubierto y superado: TA.7/TA.8/TA.9 = NINGUN cliente (anon/auth) lee audit.
- [x] deleted_at IS NULL en RLS SELECT - N/A (audit no tiene deleted_at ni RLS SELECT de cliente).

### B. Datos en campo offline-first - N/A / frontier verificado
No carga ni edita datos de campo desde una pantalla; es un trigger de auditoria server-side.
- [x] Funciona offline - N/A (backend; el best-effort garantiza que el write de campo NUNCA se traba por el audit - R1.11).
- [x] Sync bucket correcto - verificado por exclusion: audit NO esta en rafaq.yaml (TA.11) => no llega a device.
- [x] Resolucion de conflictos - N/A (INSERT-only append-only, sin conflicto).
- [x] No requests sincronos a Supabase desde pantalla - N/A (sin UI).

### C. BLE - N/A (la feature no toca BLE).

### D. UI de campo - N/A (backend-only, sin UI - R8.2).

### E. Edge Functions - APLICABLE
- [x] auth.uid() al inicio - requireUser(userClient) valida el JWT al inicio de cada una de las 4 EFs (sin cambio).
- [x] Permisos via user_roles antes de operar - requireOwnerOf (change/remove), checks de membresia (accept), identidad-JWT (delete) - intactos (R8.3).
- [x] Errores HTTP apropiados + mensaje claro - jsonError/serverError intactos (R8.3).
- [ ] deno test verde - PENDIENTE POST-DEPLOY: el comportamiento nuevo de las 4 EFs (propagacion de actor) se ejercita por TA.12 (reproduce service_role+header via PostgREST) + el re-run de la suite edge contra las EFs redeployadas. No hay deno test dedicado; la verificacion real corre tras el deploy gateado.

---

## No verificable sin el deploy gateado (para que el leader lo corra POST-DEPLOY)
1. Aplicar 0124_audit_log.sql a dev (Management API, autz de Raf) - tras ratificar la reconciliacion R4.x/D5 en Puerta 2.
2. Redeployar las 4 EFs (accept_invitation, change_member_role, remove_member, delete_account).
3. Descomentar el hook de la audit suite en scripts/run-tests.mjs (L135) y correr supabase/tests/audit/run.cjs => TA.1-TA.16 verdes.
4. node scripts/check.mjs completo = 15 suites verdes (14 existentes SIN regresion + audit). Foco: edge/rls/user_private (tocan las EFs redeployadas) siguen verdes.
5. T12 gate DURO de volumen de animals (storage + LATENCIA / subxid cliff, proyectado contra 500 MB cross-tenant con margen). Solo si pasa => descomentar enable_tracking(public.animals, best_effort) (T13).

## Cambios recomendados (NO bloqueantes - sync de reconciliacion antes de done)
1. design.md L108-109 (dentro del bloque sql "contrato de diseno"): el comentario dice "Pre-requisito R4.1
   (verificado NO-destructivo en dev): la publication de PowerSync es FOR TABLE explicita
   (puballtables=false)" - stale: contradice el hallazgo as-built de T1 (FOR ALL TABLES). No es bloqueante
   porque las partes AUTORITATIVAS del design ya reconcilian el frontier de forma prominente (seccion
   offline-first L46-58 "As-built"; L60 lo etiqueta explicitamente como "Diseno original (asuncion, no
   as-built)"; R4.x en requirements.md; header real de 0124 L6-16 correcto). Recomiendo sincronizar ese
   comentario del snippet ilustrativo para que el propio documento no sea internamente inconsistente. El
   leader debe asegurarlo en la reconciliacion de cierre (regla dura, pre-done).

## Nota de estado
APPROVED condicionado: codigo estatico correcto + check.mjs verde con el hook comentado. El paso a done
requiere que el leader ejecute los 5 items POST-DEPLOY (en particular la audit suite verde + las 14 sin
regresion) y sincronice el nit de design.md. Luego sigue Gate 2 (codigo) + Puerta 2.
