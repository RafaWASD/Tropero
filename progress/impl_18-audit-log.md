baseline_commit: 6960238ede92478e6d8b96b8a88a8b82613a5843

# Implementación — 18-audit-log (incremento 1)

> Audit forense server-side, append-only. 100% backend. Spec aprobada (Puerta 1, Raf, 2026-07-13).
> Fuente de verdad: `specs/active/18-audit-log/{requirements,design,tasks}.md` + Gate 1 re-run
> (`progress/security_spec_18-audit-log.md`, veredicto PASS con watch-item M2-a).
>
> **DEPLOY GATEADO**: NO se aplica la migración ni se deployan las EFs desde acá. El leader coordina el
> deploy con autorización de Raf en sesión. Este archivo documenta qué se verificó ESTÁTICO vs qué queda
> pendiente del deploy.

## Plan (T1..T22 del tasks.md)

- T1 — pre-req publication `FOR TABLE` (read-only) → **DISCREPANCIA CRÍTICA, ver abajo**.
- T2..T14 — migración `0124_audit_log.sql`.
- T15..T16 — propagación de actor en las 4 Edge Functions (Opción A / header).
- T17 — deploy a dev (GATEADO, no lo hago).
- T18..T19 — suite `supabase/tests/audit/run.cjs` + enganche en `run-tests.mjs`.
- T20..T22 — verificación + reconciliación de specs.

---

## 🚨 T1 / R4.1 — DISCREPANCIA CRÍTICA spec-vs-infra (requiere ratificación de Raf)

**Hallazgo (verificación read-only de catálogo, `pg_publication`):**

```
pubname            puballtables
powersync          true      ← FOR ALL TABLES
supabase_realtime  false
```

La publication `powersync` (la que consume el replicador de PowerSync, ver `powersync/service.yaml`) es
**`FOR ALL TABLES`**. La spec 18 (R4.1/R4.2/R4.3 + D5) asumió que era `FOR TABLE <lista explícita>` y por
eso T1 dice "si fuera FOR ALL TABLES, **parar y escalar**". **Esa asunción es falsa contra la infra real.**

**Pero NO es un leak.** El frontier de autorización real de PowerSync en este proyecto **son las sync
streams** (`sync-streams/rafaq.yaml`), no la publication. Evidencia:
- El header de `sync-streams/rafaq.yaml` (L1-7): *"NO hay RLS por encima del wire de sync: el WAL replica
  la tabla base... Por eso cada stream scopea explícitamente. Este archivo ES la fuente canónica."*
- Spec 14 / `0068_user_private_pii.sql` cerró la PII "en el canal WAL (realtime/PowerSync)" por
  **separación física** (mover a `user_private`) + scope self-only en la stream `self_user_private`, **no**
  sacando la tabla de la publication (no se puede excluir de un `FOR ALL TABLES`).
- `animals` (global) está **explícitamente fuera del sync set** (rafaq.yaml L302-303) por el mismo
  mecanismo: no aparece en ninguna stream. No hay stream catch-all (`SELECT * FROM *`) — cada una es un
  `SELECT ... FROM <tabla>` nombrada.

⇒ `audit.record_version` **nunca llega a un device** porque no está en `rafaq.yaml` y no hay catch-all —
idéntico al mecanismo que hoy mantiene fuera a `animals`, `import_log`, `users`, etc. El residual es solo
**costo de WAL** (cada fila de audit fluye al replicador de PowerSync y se descarta; INSERT-only,
bajo volumen para `user_roles`). El objetivo de seguridad de **D5 (audit forense no fuga a devices) SE
CUMPLE**, pero por el frontier de sync-streams, no por la publication.

**Consecuencia sobre R4.x (reconciliado en specs, ver T22):**
- R4.1 literal ("puballtables=false") — **no verificable como STOP**; la realidad del proyecto es
  FOR ALL TABLES (ADR-025/026). Reconciliado como nota bajo R4.1.
- R4.3 literal ("audit NO en `pg_publication_tables`") — **fallaría** (FOR ALL TABLES la incluye). El
  invariante real es "audit no referenciada en `sync-streams/rafaq.yaml`". Reconciliado; TA.11 adaptado.
- R4.2 (no agregar audit a ninguna publication) — la migración no la agrega (trivial); pero FOR ALL
  TABLES la incluye igual. Intent (no reach a device) cubierto por el frontier de streams.

**Recomendación al leader/Raf (decisión que NO improviso):**
- **Opción 1 (recomendada, bajo riesgo):** ACEPTAR el frontier de sync-streams. `audit.*` nunca entra a
  `rafaq.yaml` (no hay catch-all) → sin leak. Ratificar la reconciliación de R4.x/D5 en Puerta 2. Residual:
  costo de WAL menor (mitigado por retención 90d + best-effort/alcance medido). Es exactamente cómo el
  proyecto mantiene fuera a `animals`/`users` hoy.
- **Opción 2 (pesada, NO recomendada solo por esto):** convertir `powersync` a `FOR TABLE <lista>`.
  Riesgoso: hay que enumerar las ~31 tablas sincronizadas; si falta una, se rompe el sync. Cambio de infra
  que excede spec 18.

**Verificado estático:** no hay ninguna referencia a `audit` ni `record_version` en `sync-streams/rafaq.yaml`
(sin catch-all) → con la migración as-built, `audit.*` no sincroniza a ningún device. (Assert encodeado en
TA.11.)

---

## Estado por task (código escrito, deploy gateado)

- [x] **T1** — publication verificada (read-only). **Discrepancia FOR ALL TABLES documentada + reconciliada** (arriba).
- [x] **T2** — `0124_audit_log.sql` creada con header (semántica temporal + actor + modo de falla + nota R4.1 reconciliada).
- [x] **T3** — schema `audit` + enum `operation` (guardado idempotente) + `record_version` sin FK/CHECK + índices.
- [x] **T4** — helpers `primary_key_columns` + `to_record_id` (record_id estable v5; sin PK → NULL).
- [x] **T5** — `resolve_actor()` **TOTAL** (nunca lanza — Gate 2 M2-a) + guard de rol service_role (anti-spoof).
- [x] **T6** — `insert_update_delete_trigger()` SECURITY DEFINER; **actor + pk resueltos DENTRO del guard best-effort** (M2-a airtight).
- [x] **T7** — `enable_tracking(regclass, best_effort)` / `disable_tracking(regclass)` idempotentes.
- [x] **T8** — REVOKEs (schema/tables/functions) + GRANT usage/select a service_role + REVOKE execute de cada función sensible.
- [x] **T9** — smoke-check fail-closed **doble** (EXECUTE R3.6 + muro de lectura R3.7).
- [x] **T10** — `purge_old_record_versions()` + `pg_cron` mensual idempotente (`unschedule` defensivo).
- [x] **T11** — `enable_tracking('public.user_roles')` (estricto) — ACTIVO en la migración.
- [~] **T12** — Gate DURO de volumen de `animals`: **PENDIENTE POST-DEPLOY** (necesita aplicar la máquina + import representativo; no se puede medir sin deploy). Ver "Pendiente post-deploy".
- [gated] **T13** — `enable_tracking('public.animals', best_effort => true)` **PREPARADO pero COMENTADO/GATEADO** en la migración (nota clara referenciando T12/R5.4). NO se prende hasta que T12 pase y el leader coordine.
- [x] **T14** — confirmado (estático): la migración no agrega `audit` a ninguna publication (y no puede excluirla del FOR ALL TABLES → frontier por streams, ver arriba).
- [x] **T15** — `createAdminClient(actorId?)` en `_shared/supabase.ts` (aditivo, header global `X-Rafaq-Actor`).
- [x] **T16** — las 4 EFs crean el admin client con el actor tras `requireUser` (`createAdminClient(user.id)`), reordenado. Sin cambio de contrato/authz.
- [gated] **T17** — deploy a dev (migración + 4 EFs): **GATEADO, no lo hago.**
- [x] **T18** — suite `supabase/tests/audit/run.cjs` (TA.1–TA.16, reconciliadas al as-built: tracked=user_roles, TA.13 spoof por user_roles, TA.11 frontier por streams).
- [x] **T19** — enganche en `scripts/run-tests.mjs` (15ª suite, tras el guard `SUPABASE_SERVICE_ROLE_KEY`).
- [~] **T20** — `node scripts/check.mjs`: typecheck + unit + 14 suites → VERDE (pre-deploy). Post-deploy
  (leader aplicó 0124 a dev): suite audit corrió **13/15 → bug de test corregido** (falta `old_record_id`
  en el SELECT de `auditRows`) → re-run del leader esperado **15/15**. Ver "Post-deploy run #1".
- [x] **T21** — guarda de alcance: `git diff` no toca audit de dominio, ni `invite_user`, ni `app/` (verificado).
- [x] **T22** — reconciliación de specs (R4.x/D5 + TA.11 + tabla de tests + resolve_actor total) → `design.md`/`requirements.md`.

---

## Watch-items del Gate 1 — cómo quedaron cerrados en el código

- **M2-a (resolve_actor total / hot-path airtight):** `resolve_actor()` envuelve TODO su cuerpo en
  `exception when others` → cae a `auth.uid()` y, si eso fallara, a NULL; **nunca lanza**. Además, en el
  trigger, el modo best-effort ejecuta `to_record_id`/`primary_key_columns`/`resolve_actor`/`insert`
  **todos dentro** del bloque `begin…exception when others then null; end` → una falla de CUALQUIERA no
  traba el write del operario. Belt-and-suspenders (las dos mitigaciones que pedía la watch-item).
- **Anti-spoof (header solo si `service_role`):** `resolve_actor` confía en `X-Rafaq-Actor` únicamente si
  `request.jwt.claims ->> 'role' = 'service_role'` (GUC de sesión, no `current_user` — correcto bajo
  SECURITY DEFINER). Cubierto por TA.13 (spoof por el camino real de `user_roles`, que un authenticated SÍ
  puede escribir directo vía `user_roles_update_owner`).
- **TA.13 sobre `user_roles`, no `animals`:** ajustado (animals no es escribible directo por authenticated
  y además está gateada). El spoof se ejerce con un UPDATE del owner a su propia fila de `user_roles`.
- **T10 mide LATENCIA además de storage:** anotado como criterio explícito del gate post-deploy (subxid
  cliff del best-effort por fila en bulk import).

## Post-deploy run #1 (leader aplicó 0124 a dev, 2026-07-13) — fix de test

El leader corrió la suite contra dev: **13/15**, falla TA.4/TA.5/TA.6 (`stableIds.size` = `2 !== 1`).
Diagnóstico (verificado EN VIVO con adminQuery read-only, sin re-correr la suite ni tocar la migración):

- **`to_record_id` / la migración están CORRECTOS** — confirmado contra `audit.record_version` real: cada
  `ur_id` de `user_roles` tiene UN solo stable_id a través de INSERT/UPDATE/DELETE; **cero** filas con
  `record_id` y `old_record_id` ambos NULL (queries de grupo → vacías). No se re-aplica la migración.
- **Bug del TEST (no de los datos):** mi helper `auditRows` hacía
  `select id, op, auth_uid, record_id, record, old_record …` — **omitía la columna `old_record_id`**.
  Entonces en `stableIds = new Set(rows.map(r => r.record_id || r.old_record_id))`, la fila **DELETE**
  (que tiene `record_id = NULL` y el uuid estable en `old_record_id`) evaluaba `null || undefined` =
  `undefined` → entraba `undefined` al Set junto al uuid de INSERT/UPDATE → **size 2**. (El `byOp.DELETE
  .old_record_id` que agregué en la autorrevisión también quedaba `undefined` por lo mismo.)
- **Reproducción concreta** (id real `58c99daf`, ciclo completo): `SELECT` sin `old_record_id` → stableIds
  `[uuid, undefined]` size 2; `SELECT` con `old_record_id` → `[uuid]` size 1. ✓
- **Fix (1 línea, determinístico):** agregar `old_record_id` al SELECT de `auditRows`. El filtro por
  `roleD` (uuid random por corrida) ya es único y trae exactamente las 3 filas del ciclo (el force de
  `member_name` de 0080 es `BEFORE` y no genera filas de audit; mi UPDATE es `OF active`, no re-dispara el
  force) → sin filas extra, sin necesidad de namespacing adicional.

Verificado estático: `node --check` verde; ambos usos (`stableIds`, `byOp.DELETE.old_record_id`) quedan
cubiertos por el SELECT. **NO re-corrí la suite** (para no contaminar la señal) — el leader la re-corre →
esperado **15/15**.

## Trazabilidad — `R<n>` → test/artefacto

| R | Cubierto por |
|---|---|
| R1.3 INSERT registra | TA.2, TA.4/5/6 (paso INSERT) |
| R1.4 UPDATE registra | TA.3, TA.4/5/6 (paso UPDATE) |
| R1.5 DELETE registra | TA.4/5/6 (paso DELETE) |
| R1.6 record_id estable | TA.5 (coalesce record_id/old_record_id idéntico entre las 3 versiones) |
| R1.7 sin PK → registra igual | **static** (to_record_id → NULL sin PK; user_roles/animals tienen PK → no hay tabla PK-less trackeada para test) |
| R1.8 append-only | TA.10 (anon/auth sin UPDATE/DELETE priv) |
| R1.9 enable/disable_tracking | TA.14 (enable_tracking best_effort sobre self-test table) |
| R1.10 sin FK/CHECK | **static** (DDL de record_version; auth_uid uuid pelado) |
| R1.11 best-effort vs estricto | TA.14 (user_roles='strict', self-test='best_effort') |
| R2.1 actor real | TA.2, TA.3 (JWT), TA.12 (header) |
| R2.2 actor NULL sin abortar | TA.6 |
| R2.3 actor bajo SECURITY DEFINER | TA.2 (owner-role auto-insertado por trigger 0011 SECURITY DEFINER → actor OK) + TA.12/TA.13 (trigger es definer) |
| R2.4 ts = hora de sync | **static** (default now(); header lo documenta) |
| R2.5 header documenta semántica | **static** (header de 0124) |
| R2.6 header propagation | TA.12 |
| R2.7 actor del JWT, no del body | **code** (las 4 EFs: `createAdminClient(user.id)` con user.id de `requireUser`) |
| R2.8 spoof-safety | TA.13 |
| R2.9 las 4 EFs propagan | **code** (accept_invitation/change_member_role/remove_member/delete_account) |
| R3.1 revoke lectura | TA.9 |
| R3.2/R3.3 anon/auth no leen / no PostgREST | TA.7, TA.8, TA.9 |
| R3.4 solo service_role/postgres lee | TA.9 + adminQuery (postgres) lee OK a lo largo de la suite |
| R3.5 revoke execute | TA.16 |
| R3.6 smoke-check EXECUTE | **static** (DO block) + TA.16 (verifica el outcome) |
| R3.7 smoke-check muro de lectura | **static** (DO block) + TA.9 |
| R4.1/R4.2/R4.3 frontera WAL | TA.11 (reconciliado: audit no en sync-streams; publication FOR ALL TABLES documentada) |
| R5.1 user_roles tracked (estricto) | TA.12, TA.14, TA.2/TA.3 |
| R5.2/R5.4 animals gated | TA.14 (animals sin trigger) + gate T12 (post-deploy) |
| R5.5/R5.6 no trackear otras | TA.14 + **static** (la migración no las prende) |
| R6.2 retención >90d | TA.15 |
| R6.1/R6.3 cron mensual idempotente | **static** (cron.schedule + unschedule defensivo en 0124) |
| R7.1/R7.2/R7.4 suite verifica | la suite entera (TA.1–TA.16) |
| R8.1/R8.2 no tocar dominio / no exponer en app | T21 (git diff limpio: sin app/, sin invite_user, sin audit de dominio) |
| R8.3 EFs mismo contrato | **code** (solo se agregó el actor; misma lógica de authz/respuestas) |

## Autorrevisión adversarial (paso 8)

Pasada hostil sobre mi propio código antes del reviewer. Qué busqué y qué encontré:

**(a) Desviaciones del spec / R no cubierto.** El gate de `animals` (T12/R5.4) me obligó a que la tabla
trackeada del incremento 1 sea SOLO `user_roles` → reconcilié la tabla de tests (TA.2–TA.6 sobre
user_roles, TA.13 spoof sobre user_roles) y lo documenté (T22). R1.7/R1.10/R2.4 no tienen test de runtime
(son estructurales) → anotados como **static** en la trazabilidad, no como huecos.

**(b) Bugs / edge cases. Encontré y CORREGÍ 2 bugs en mi propia suite:**
- **TA.5 (record_id estable):** en semántica supa_audit el uuid derivado de la PK vive en `record_id` para
  INSERT/UPDATE pero en `old_record_id` para DELETE (record es NULL en DELETE). Mi assert original
  `new Set(rows.map(r => r.record_id))` habría dado size=2 (uuid + NULL) → **falso rojo**. Corregido a
  `coalesce(record_id, old_record_id)` + assert de que DELETE lleva `old_record_id`.
- **TA.11 (frontera WAL):** filtraba solo líneas full-comment, pero `sigsa_export_log:` tiene el comentario
  inline "# audit de exports" → mi regex `\baudit\b` habría matcheado → **falso rojo**. Corregido: strippear
  también comentarios inline (`#.*$`). Verificado: `audit`/`record_version` no matchean el YAML activo.

**(c) Gaps de seguridad.** Verifiqué: (1) `resolve_actor` TOTAL (nunca lanza) + actor/pk DENTRO del guard
best-effort (M2-a airtight) — el hot path no se traba jamás; (2) anti-spoof por `request.jwt.claims->>'role'
= service_role` (GUC de sesión, no `current_user`); (3) `search_path=''` + nombres calificados en toda
función; (4) REVOKE execute de todas las funciones sensibles + smoke-check doble in-migration; (5)
`created_by`/actor forzado desde el JWT del llamante, nunca del body (EFs); (6) el trigger NO requiere
EXECUTE del invocante → revocarlo no rompe el tracking; (7) sin FK/CHECK en record_version → un usuario
borrado no rompe el write.

**(d) Gaps offline-first / multi-tenant.** El hot path best-effort (manga nunca se traba) está airtight.
Multi-tenant: `record_version` es cross-tenant POR DISEÑO, cerrada a todo cliente (REVOKE USAGE) → sin leak;
la frontera de sync (que sí es multi-tenant) se resolvió por sync-streams (audit fuera de rafaq.yaml).

**(e) Tests que pasan por la razón equivocada.** TA.12 usa el camino de PRODUCCIÓN (service_role client
supabase-js + header, vía PostgREST) — no un INSERT por adminQuery/JWT directo (eso era el falso verde que
marcó Gate 1). TA.13 ejerce el reject real (header forjado IGNORADO). TA.6 verifica NULL honesto por el
camino real (admin sin header).

**Riesgos de deploy verificados ESTÁTICO (read-only) para de-riskear el apply gateado:**
- `extensions.uuid_generate_v5` **existe** en el schema `extensions` (uuid-ossp) → `to_record_id` no
  fallará al deploy.
- `has_function_privilege('public', <fn>, 'EXECUTE')` devuelve `false` (no error) en este Postgres → el
  smoke-check DO block (que itera sobre `['anon','authenticated','public']`, patrón 0066/0068) no aborta.
- `pg_cron` instalado; `user_roles` tiene PK `id` uuid + columna `member_name` (PII M3, esperado).
- supabase-js instalado = 2.106.1 → `.schema('audit')` soportado (TA.7/TA.8).
- `audit` schema NO existe aún y `animals` NO está trackeada aún → primer deploy limpio.

Todo lo encontrado quedó corregido y re-verificado (`node --check` de la suite verde; `check.mjs` completo
verde sin regresión). Los ítems **static**/**code** de la trazabilidad se re-verifican corriendo la suite
audit POST-deploy (pendiente gateado).

## Pendiente POST-DEPLOY (verificación que requiere el deploy gateado)

1. Aplicar `0124_audit_log.sql` a dev (Management API, gateado por Raf) — tras ratificar la reconciliación R4.x.
2. Deploy de las 4 EFs (`accept_invitation`, `change_member_role`, `remove_member`, `delete_account`).
3. Correr `supabase/tests/audit/run.cjs` (TA.1–TA.16) contra dev.
4. Correr `node scripts/check.mjs` completo → 15 suites verdes (14 existentes sin regresión + audit).
   Foco: las suites `edge`, `rls`, `user_private` (tocan las EFs cambiadas) siguen verdes.
5. **T12 gate DURO de volumen de `animals`**: aplicar máquina + import representativo (spec 12) con animals
   best-effort trackeada temporalmente, medir `pg_total_relation_size('audit.record_version')` + filas
   generadas **y la LATENCIA del import** (subxid cliff), proyectar contra 500 MB cross-tenant con margen
   (acotado por retención 90d). Si pasa → descomentar `enable_tracking('public.animals', best_effort=>true)`.
   Si no → diferir animals (como R5.6).
