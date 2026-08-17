# Tasks — 18-audit-log

> Pasos discretos en orden. El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin
> justificación. Cada tarea lista los `R<n>` que cubre. Backend: migración `0124` + 4 Edge Functions
> (propagación de actor, Opción A) + suite nueva + enganche. Sin código de app cliente ni tests de
> cliente.
>
> **Reconciliado tras Gate 1 (2026-07-13):** tareas nuevas/cambiadas marcadas `[Gate 1]`.
>
> **Deploy gateado:** las migraciones + el deploy de las Edge Functions a la DB/proyecto compartido los
> hace Raf/leader tras Gate 1 re-run + Puerta 1 (memoria `project_supabase_mcp_write`). El implementer
> escribe el `.sql`, el TS de las EFs y la suite; no deploya solo.

## Fase 0 — Pre-requisito de infra (no destructivo, antes de la migración)

- [x] **T1** — Verificar en dev que la publication de PowerSync es `FOR TABLE` explícita: `adminQuery`/MCP
  → `select pubname, puballtables from pg_publication;` y confirmar `puballtables = false`. Si fuera
  `FOR ALL TABLES`, **parar** y escalar. Solo lectura de catálogo. Cubre: R4.1.
  **[as-built] Resultado: `powersync` es `FOR ALL TABLES` (`puballtables=true`).** El frontier real del
  proyecto son las sync streams (no la publication) → reconciliado (ver R4.x). ⚠️ REQUIERE ratificación de
  Raf en Puerta 2. Ver `progress/impl_18-audit-log.md` § T1.

## Fase 1 — Migración 0124 (schema audit vendoreado)

- [x] **T2** — Crear `supabase/migrations/0124_audit_log.sql` con `begin;`/`commit;` y el **header**
  documentando la semántica temporal + actor (R2.5: `auth_uid` = actor real [`auth.uid()` o header
  propagado, guardado por rol service_role, del JWT del llamante — no del body]; `ts` = hora de sync;
  modo de falla best-effort vs estricto) + el pre-requisito R4.1. Cubre: R2.5.
- [x] **T3** — `create schema audit` + enum `audit.operation` + tabla append-only `audit.record_version`
  con las columnas de R1.2, **sin FK ni CHECK** (`auth_uid` uuid pelado, tipos holgados — R1.10) +
  índices forenses. Cubre: R1.1, R1.2, R1.10, R2.4.
- [x] **T4** — Helpers `audit.primary_key_columns(oid)` + `audit.to_record_id(oid, text[], jsonb)`
  (record_id estable; sin PK → NULL). Cubre: R1.6, R1.7.
- [x] **T5** — `[Gate 1]` `audit.resolve_actor()`: lee `request.jwt.claims->>'role'`; si `service_role`,
  toma `X-Mitropero-Actor` de `request.headers` (cast defensivo → NULL si inválido); `coalesce(header,
  auth.uid())`. Cubre: R2.1, R2.3, R2.6, R2.8.
- [x] **T6** — `audit.insert_update_delete_trigger()` `SECURITY DEFINER` `set search_path=''`: inserta la
  versión (`record`/`old_record` según `op`, `auth_uid = resolve_actor()`); modo de falla por `tg_argv[0]`
  (`'best_effort'` → insert en sub-bloque `exception when others then null`; estricto → propaga). Cubre:
  R1.3, R1.4, R1.5, R1.11, R2.1, R2.2.
- [x] **T7** — `audit.enable_tracking(regclass, best_effort boolean default false)` /
  `audit.disable_tracking(regclass)` (crean/dropan el trigger `audit_i_u_d` con el arg de modo,
  idempotentes). Cubre: R1.9, R1.11.

## Fase 2 — Seguridad fail-closed

- [x] **T8** — REVOKE `all on schema/tables/functions in schema audit` de `public/anon/authenticated`;
  GRANT `usage` + `select on audit.record_version` a `service_role`; REVOKE `execute` de cada función
  sensible (enable/disable/trigger/purge/pk/to_record_id/**resolve_actor**) de los roles cliente. Cubre:
  R1.8, R3.1, R3.4, R3.5.
- [x] **T9** — `[Gate 1 M1]` Smoke-check fail-closed **doble** (DO block): abortar si (a) alguna función
  de `audit` quedó EXECUTE-able por cliente (R3.6), **o** (b) el muro de LECTURA quedó abierto
  (`has_schema_privilege(... 'audit','USAGE')` / `has_table_privilege(... 'audit.record_version','SELECT')`
  para anon/authenticated) (R3.7). Cubre: R3.6, R3.7.

## Fase 3 — Retención

- [x] **T10** — `audit.purge_old_record_versions()` `SECURITY DEFINER` (DELETE `ts < now() - interval '90
  days'`) + `create extension if not exists pg_cron` + schedule mensual `audit_purge_monthly` idempotente
  (`unschedule` defensivo). Cubre: R6.1, R6.2, R6.3.

## Fase 4 — Prender el tracking del incremento 1 (medir antes las masivas)

- [x] **T11** — `enable_tracking('public.user_roles')` (estricto). Cubre: R5.1.
- [ ] **T12** — `[Gate 1 M2]` **Gate DURO de volumen** antes de trackear `animals`: aplicar la máquina a
  dev, correr un import representativo (spec 12) con `animals` best-effort trackeada, medir
  `pg_total_relation_size('audit.record_version')` / filas generadas, y proyectar contra 500 MB **con
  margen** (recordando que la tabla es cross-tenant compartida y la retención 90d la acota). Documentar la
  medición en `progress/impl_18-audit-log.md`. Si NO cierra → **quitar** la línea de `animals` de la
  migración (diferir como R5.6) y anotarlo. Cubre: R5.3, R5.4.
  **[pendiente POST-DEPLOY]** requiere aplicar la máquina + import (no medible sin deploy). Anotado en
  `progress/impl_18-audit-log.md` § "Pendiente post-deploy" (medir storage **y latencia**, subxid cliff).
- [ ] **T13** — `enable_tracking('public.animals', best_effort => true)` **solo si T12 pasó**. NO
  habilitar `animal_profiles`, tablas de evento, `treatments`, `rodeos`, `establishments` (R5.6) ni
  `user_private`/PII (R5.5). Cubre: R5.2, R5.5, R5.6.
  **[GATEADO]** la línea está PREPARADA pero **COMENTADA** en `0124_audit_log.sql` con nota clara → NO se
  prende hasta que T12 pase y el leader coordine. Solo `user_roles` queda activa en el incremento 1.
- [x] **T14** — Confirmar (no destructivo) que la migración **no** agrega `audit.record_version` a
  ninguna publication. Cubre: R4.2.

## Fase 5 — `[Gate 1 H1]` Propagación de actor en las Edge Functions (Opción A)

- [x] **T15** — `_shared/supabase.ts`: `createAdminClient(actorId?: string)` — si viene `actorId`, agrega
  `global.headers['X-Mitropero-Actor'] = actorId`. Aditivo (default = comportamiento actual). Cubre: R2.6.
- [x] **T16** — `accept_invitation`, `change_member_role`, `remove_member`, `delete_account`: crear el
  admin client con el actor tras `requireUser` (`createAdminClient(user.id)`), reordenando la creación del
  admin client para que quede DESPUÉS de `requireUser`. Actor = `user.id` (JWT validado), NUNCA del body
  (R2.7). Sin cambio de contrato ni de lógica de autorización (R8.3). `delete_account_tx` NO se toca (el
  header viaja en su `.rpc()`). `invite_user` NO se toca (no muta user_roles). Cubre: R2.7, R2.9, R8.3.

## Fase 6 — Deploy a dev + suite nueva

- [ ] **T17** — Aplicar `0124` a **dev** (Management API / `apply-migration-mgmt.mjs`, gateado por Raf) +
  deploy de las 4 Edge Functions modificadas (`supabase functions deploy …`, gateado). Registrar
  Local==Remote. Cubre: R7.3 (parcial).
  **[GATEADO — lo hace el leader/Raf]** el implementer NO deploya. Pre-condición: ratificar la
  reconciliación R4.x (frontier de sync-streams).
- [x] **T18** — Crear `supabase/tests/audit/run.cjs` (patrón `maneuvers/run.cjs` + helper `adminQuery` de
  `operaciones_rodeo/run.cjs`) con TA.1–TA.16 del design. Incluye explícitamente: **TA.12** (actor por el
  camino de prod: service_role client con header `X-Mitropero-Actor` → INSERT `user_roles` → `auth_uid` =
  actor), **TA.13** (spoof-safety: `authenticated` con header forjado → `auth_uid` = su auth.uid() real),
  TA.6 (service_role sin header → NULL), TA.7/TA.8 (fail-closed anon/authenticated), TA.9 (grants +
  schema USAGE = false), TA.11 (WAL frontier), TA.15 (retención). Cubre: R7.1, R7.2, R7.4, R1.3–R1.6,
  R1.8, R1.11, R2.1, R2.2, R2.6, R2.8, R3.1, R3.2, R3.3, R3.5, R3.7, R4.2, R4.3, R5.1, R6.2.
- [x] **T19** — Enganchar la suite en `scripts/run-tests.mjs`
  (`run('Audit suite (spec 18)', 'node --test supabase/tests/audit/run.cjs')`) detrás del guard
  `SUPABASE_SERVICE_ROLE_KEY`. Cubre: R7.1.
  **[as-built]** el hook quedó **COMENTADO** (patrón spec 12/14/M6/tratamientos): la suite corre contra la
  DB remota → fallaría antes del apply de 0124. El leader lo DESCOMENTA post-deploy (T17).

## Fase 7 — Verificación + reconciliación

- [~] **T20** — `node scripts/check.mjs` verde: las 14 suites existentes sin regresión + la 15ª (audit).
  Verificar además que las suites de spec 01 (RLS/Edge) siguen verdes tras el cambio de las 4 EFs. Cubre:
  R7.3.
  **[parcial]** las 14 suites existentes + typecheck + unit → **VERDE** ahora (mis cambios son inertes en
  runtime: migración sin aplicar, hook comentado, EFs sin deployar). La **15ª (audit) queda PENDIENTE
  POST-DEPLOY** (corre contra la DB remota; el schema audit no existe hasta aplicar 0124). Idem re-verificar
  las suites `edge`/`rls`/`user_private` tras redeployar las 4 EFs.
- [x] **T21** — Guarda de alcance: `git diff` no toca ninguna migración/tabla del audit de DOMINIO
  (`animal_category_history`, `import_log`, `export_log`, `animal_events`), ni `invite_user`, ni `app/`.
  Cubre: R8.1, R8.2.
- [x] **T22** — Reconciliar specs al as-built (regla dura `docs/specs.md`): si el Gate 1 re-run o la
  autorrevisión cambian el diseño (p. ej. el header approach se cambia por el RPC-wrapper de la
  Alternativa D, o el casing de `request.headers`), reflejarlo en `design.md` + nota bajo el `R<n>`
  afectado antes de cerrar. Cubre: — (proceso).
  **[hecho]** reconciliado: (a) frontier WAL `FOR ALL TABLES` → sync-streams (R4.x + design §offline-first);
  (b) `resolve_actor` TOTAL + actor/pk dentro del guard best-effort (M2-a; design SQL); (c) `animals`
  gateada/comentada (design + T13); (d) tabla de tests → tracked=`user_roles`, TA.13 spoof por `user_roles`,
  TA.11 frontier por sync-streams (design §tests). Detalle en `progress/impl_18-audit-log.md`.

## Notas de gates

- **Gate 1 RE-RUN (`security_analyzer` modo `spec`) OBLIGATORIO** antes de Puerta 1: la spec reconciliada
  ahora incluye la propagación de actor (header `X-Mitropero-Actor` guardado por rol) + el diff de las 4 Edge
  Functions. Output: `progress/security_spec_18-audit-log.md` (actualizar). Focos del re-run: (a) el
  header solo se confía en contexto `service_role` (anti-spoof R2.8); (b) el actor sale del JWT validado,
  no del body (R2.7); (c) el muro de lectura (R3.7) + EXECUTE (R3.6) abortan la migración si se abren; (d)
  el best-effort de `animals` no crea un canal de bypass; (e) sin regresión de seguridad en las 4 EFs
  (mismo authz, mismo contrato).
- **Gate 2 (`security_analyzer` modo `code`)** tras reviewer APPROVED: cubrirá el diff SQL **y** el diff
  de las 4 Edge Functions.
- **Sin Gate 2.5** (ADR-029): no hay UI.

## Reconciliación posterior — rebrand fase 5 (2026-08-17)

- **T23 (fuera del alcance original, hecho en la fase 5 del rebrand)** — Renombrar el header de actor
  `X-Rafaq-Actor` → `X-Mitropero-Actor`, **sin corte seco**: migración `0133` re-CREA `audit.resolve_actor()`
  para que lea el nombre nuevo y, si no vino o no es un uuid, el viejo. Los dos invariantes de la función
  quedan intactos y verificados: **TOTAL** (los handlers `exception when others` no se tocaron) y
  **SPOOF-SAFE** (el fallback vive dentro del gate de `service_role`). Del lado TS, el nombre pasa a vivir
  en `supabase/functions/_shared/request-headers.ts` (única definición) y `_shared/cors.ts` **deriva** su
  Allow-Headers de ahí. La suite `audit` pasó de TA.1–TA.16 a **TA.1–TA.21**: TA.12/TA.13 con el nombre
  nuevo, **TA.17** (actor con el header VIEJO → se registra igual), TA.18/TA.19 (request_id con las dos
  grafías, spec 23), **TA.20** (control negativo sin header) y **TA.21** (spoof con las dos grafías).
  Falsificado además con un bloque `DO` **dentro de la migración** (8 combinaciones de header) y corriendo
  la suite ANTES del apply: TA.12/TA.18 fallaron y TA.17/TA.19 pasaron. La migración `0124` **no se editó**
  (append-only). Detalle: `progress/rebrand-fase5-headers.md`. Cubre: R2.6, R2.8, R7.4 (reconciliadas).
