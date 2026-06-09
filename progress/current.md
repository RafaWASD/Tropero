# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## 2026-06-08 — Feature 15 `15-powersync` (wiring de PowerSync, offline-first)

**Tarea entrante**: "continuar con powersync". Raf decidió: (1) provisionar la instancia Cloud juntos, paso a paso; (2) tratarlo como **feature SDD nueva cubriendo todo el schema** (no solo identidad). Feature `15-powersync` creada en `feature_list.json`.

### Hecho en esta sesión

1. **Provisioning de PowerSync Cloud (con Raf, hands-on)** — instancia `rafaq-beta` (región BR = misma que Supabase sa-east). Supabase side: rol `powersync_role` (BYPASSRLS + REPLICATION) + `GRANT SELECT` + `publication powersync FOR ALL TABLES`. Conexión `verify-full` con `powersync_role`. Auth = Supabase Auth vía **JWKS** (el proyecto usa JWT signing keys asimétricas ECC P-256; sin legacy secret). Instance URL guardada por Raf. (Nota: PowerSync hoy usa **Sync Streams edition 3** con `auth.user_id()`; el modelo viejo `bucket_definitions`/`token_parameters` está deprecado.)

2. **Gate 0 (contexto) APROBADO por Raf** → `specs/active/15-powersync/context.md`. Decisiones: **D1** data offline / identidad online (lectura de todo el schema offline; escritura offline del camino de campo; identidad/admin online; + invitaciones pendientes del owner en lectura offline). **D2** dual SDK (`@powersync/web` ahora / `@powersync/react-native` en dev build). LWW en MVP (+ expansión post-MVP documentada). 4 clases de sync. import_log + push tokens fuera del sync set. Storage/conflictos-custom/hard-delete fuera de MVP.

3. **Spec redactada + veto del leader** (`requirements.md` R1-R12 EARS + `design.md` con YAML completo de sync streams + connector + plan de swap + `tasks.md` T1-T8). Veto PASS: YAML verificado contra el schema as-built (semen_registry existe, animal_events tiene establishment_id, birth_calves y rodeo_data_config con PK compuesta).

4. **Gate 1 (security_analyzer modo spec) — 3 ciclos FAIL→fix→PASS** (`progress/security_spec_15-powersync.md`):
   - **HIGH-1** (streams): las 20 streams per-est no replicaban `establishments.deleted_at IS NULL` de `has_role_in` → leak por WAL al soft-deletear un campo (no hay trigger que desactive user_roles) → fix: predicado canónico con JOIN a establecimientos vivos en todas. + MED-1 (est_members owner-gate de roles) + MED-2 + LOW-1 (est_members q1 active). **Re-Gate 1 streams PASS.**
   - **HIGH-D1** (delta): la rama idempotente de `register_birth` devolvía el parto por `client_op_id` sin verificar tenancy → IDOR cross-tenant por replay → fix: guard scopeado al caller (`animal_profile_id = p_mother_profile_id` + `establishment_id = v_est`, authz primero) + índice compuesto `(animal_profile_id, client_op_id)` (mata el oráculo) + colisión ajena → error genérico. **Re-Gate 1 delta PASS.**

5. **Puerta 1 (humana) APROBADA por Raf** con 2 decisiones: **D1** mutaciones RPC-bound **OFFLINE** vía outbox + RPC-mapping (parto/baja/soft-delete/alta; **import queda online**); **D2** roles offline **owner-only**. + delta backend aprobado (solo `register_birth`; `exit_animal_profile` es idempotente natural). Double-upload resuelto con **overlay local-only** (`pending_*`) + UNION en lecturas (no escribir filas optimistas en tablas sincronizadas → evita doble CrudEntry).

### En curso / hecho

- **Run 1 (cimientos del cliente) DONE + GATEADO** (reviewer APPROVED + Gate 2 PASS 0 HIGH + veto leader): deps `@powersync/{react-native,web,react}` + `@journeyapps/wa-sqlite` (whitelisteado), env `EXPO_PUBLIC_POWERSYNC_URL`, `AppSchema` (26 tablas + alias `id` para las 3 de PK especial + overlay `localOnly pending_*` + outbox `insertOnly op_intents`), database factory web/native, connector `fetchCredentials` (null sin sesión, NO loguea token) + `uploadData` base (op_intents→throw stub T6), provider montado, status helper, `sync-streams/rafaq.yaml` byte-faithful al design §2 (NO deployado). 33 unit nuevos. `progress/{impl,review,security_code}_15-powersync*`.
- **Run 2 (delta backend) DONE + GATEADO + APLICADO** (reviewer APPROVED + Gate 2 PASS 0 HIGH + veto leader + suite verde): `supabase/migrations/0075_register_birth_idempotency.sql` (columna `client_op_id` + índice UNIQUE parcial COMPUESTO `(animal_profile_id, client_op_id)` + `register_birth` 4-arg con guard idempotente SCOPEADO al caller + grants + notify pgrst). **Aplicada al remoto por Management API** (BEGIN/COMMIT, body UTF-8; ref `xrhlxxdnfzvdnztacofj`). Suite `spec 15-powersync` 3/3 verde incl. T7.7 cross-tenant (no IDOR). Gate 2 cazó MED-1 (race del mismo caller → 23505; lo garantiza el índice UNIQUE, no TOCTOU) → anotado para Run T6 (clasificar ese 23505 como descarte idempotente en la cola, no reintento).

### Próximos pasos

- **[RAF, en curso] Deploy de las sync streams** a `rafaq-beta` (dashboard → Sync Streams → pegar `rafaq.yaml` → Validate → Deploy → confirmar en Health) + **smoke** (`pnpm.cmd web`: arranca / cliente conectado en Health / consola sin errores). Gateado por Gate 1 PASS (✅) + Puerta 1 (✅). **Destraba el swap de lectura** (sin streams deployadas no hay datos en SQLite local para validar el swap).
- Runs siguientes (tras el smoke OK): swap de lectura (T3/T4) → swap de escritura offline simple (T5) → outbox/overlay/uploadData RPC-mapping + el fix del MED-1 23505 (T6) → tests (T7). Native (T8) diferido al dev build Android.
- **Pendiente de commit**: todo el trabajo de la sesión está sin commitear (Run 1 + Run 2 + specs + 0075 + tracking). Checkpoint-commit cuando Raf lo pida; puerta de código final al cerrar la feature.

### Run 3 (T3 — swap de LECTURA) — EN CURSO (implementer)

Feature en curso: `15-powersync`, Run 3 = Fase T3 (solo lecturas → SQLite local). baseline_commit ya existe en `impl_15-powersync.md` (`1618a956…`), NO se reescribe.

Plan (T3.1, T3.2, T3.3) — HECHO, esperando reviewer + Gate 2:
- [x] T3.1 — `rodeo-config.ts` (`fetchFieldCatalog`, `fetchSystemDefaults`, `fetchRodeoConfig`) + `animals.fetchSystemCategories` + `rodeos.fetchProductionSystems` → SQLite local. Escrituras NO se tocaron.
- [x] T3.2 — `establishments.ts` (loadMemberships, loadOwnProfile, loadFullProfile, loadEstablishmentDetail, countActiveMembers) + `members.ts` (loadMembers, countTeam, loadPendingInvitations) + `profile.ts` (loadProfileNamePhone) → SQLite local. Mutaciones/EF ONLINE sin tocar.
- [x] T3.3 — `rodeos.fetchRodeos` → SQLite local (`createRodeo` usa `fetchRodeosOnline` interno para seguir online).
- SQL builders PUROS en `app/src/services/powersync/local-reads.ts` (0 imports, 16 unit) + I/O en `local-query.ts` (getAll + degradación hasSynced).
- Diagnóstico temporal en provider.tsx (waitForFirstSync → log de conteos, solo COUNT(*)).
- Verde: check.mjs (exit 0) + typecheck + run-tests.mjs ("All tests passed."). Detalle/trazabilidad/autorrevisión en `progress/impl_15-powersync.md` (sección Run 3). NO commiteado (lo maneja el leader). NO marcado done (espera reviewer).

### Run 4 (trigger user_roles.active ↔ soft-delete de establishments) — EN CURSO (implementer)

Feature en curso: `15-powersync`, Run 4 = migración de backend **aditiva** que mantiene `user_roles.active`
coherente con el soft-delete de establecimientos, para que el modelo de sync JOIN-free de PowerSync pueda
usar `active = true` como proxy de "campo vivo". `baseline_commit` ya existe en `impl_15-powersync.md`
(`1618a956…`), NO se reescribe (feature multi-run).

Plan (T<n>) — HECHO, esperando reviewer + Gate 2 + Gate 1 (spec) sobre el delta:
- [x] T-trig.1 — `supabase/migrations/0076_deactivate_roles_on_establishment_soft_delete.sql`: función +
  trigger `AFTER UPDATE OF deleted_at ON establishments` (transición NULL→NOT NULL desactiva los
  `user_roles` activos del campo) + backfill de los roles ya-activos que apuntan a campos ya-borrados.
  `security definer` + `set search_path = public`. NO reactiva en el caso inverso (documentado como
  limitación deliberada). `drop trigger if exists` + `create trigger` (estilo del repo). `BEGIN/COMMIT`.
  **NO aplicada al remoto** (la aplica el leader por Management API tras gatearla).
- [x] T-trig.2 — Test en `supabase/tests/rls/run.cjs` (campo + usuario dedicados `estE`/`userE`,
  autocontenido): soft-delete → ambos `user_roles.active = false` + `deactivated_at` poblado →
  `has_role_in` sigue false. **FALLA hasta que el leader aplique 0076** (esperado; mismo patrón que la
  suite `spec 15-powersync` del animal runner con 0075).

Verificado: NO hay otro trigger sobre `user_roles` (grep de todos los `create trigger` → ninguno apunta a
user_roles; única referencia = schema 0003 + policies 0008 + grants 0010) → cero loop / cero destructivo.
NO hay `FORCE RLS` en el repo → el UPDATE bajo `security definer` bypassa RLS (patrón validado de 0011).
Máximo en disco = 0075 → la mía es 0076. `node scripts/check.mjs`: 16/18 RLS pasan (sin fallos en cascada);
el único rojo es el test nuevo, pendiente de la aplicación de 0076 (esperado).

⚠️ **DECISIÓN PARA EL LEADER**: el test existente R8.3/R8.4 (`run.cjs:329-343`) soft-deletea+restaura `estA`
COMPARTIDO sin reactivar roles → con 0076 aplicado dejaría estA con roles inactivos y rompería R5.1
invitations / R6.1 en cascada. NO lo toqué (reescribir un test existente es decisión del leader). Detalle +
opciones en `progress/impl_15-powersync.md` (Run 4, "Pendiente / decisiones para el leader", punto 2).

Detalle/trazabilidad/autorrevisión en `progress/impl_15-powersync.md` (sección Run 4). NO commiteado. NO
marcado done. NO aplicado al remoto.

### Run 5 (PASO 2 — denormalización de `establishment_id`: tablas hijas + identidad + member_name) — EN CURSO (implementer)

Feature en curso: `15-powersync`, Run 5 = **PASO 2** (T9.1 + b1 + c2). Migraciones de denormalización (≥ `0077`) +
ajuste de lecturas de (c2). `baseline_commit` sin cambios (multi-run). **NO se aplican al remoto** (las aplica el
leader por Management API tras Gate 1). NO se escribe el YAML de streams (lo arma el leader). NO done, NO commit.

Plan (T<n>) — en curso:
- 0077 — (A) tablas hijas vía `animal_profiles` (5 eventos + `animal_category_history`): `establishment_id` +
  force trigger BEFORE INSERT (anti-spoof, deriva del perfil) + backfill + SET NOT NULL.
- 0078 — (A) `birth_calves` (cadena parto→madre, 2 saltos) + `rodeo_data_config` (vía rodeo, BEFORE INSERT+UPDATE).
- 0079 — (b1) identidad de animal denormalizada sobre `animal_profiles` (`animal_tag_electronic`/`animal_sex`/
  `animal_birth_date`) + force BEFORE INSERT + propagación AFTER UPDATE en `animals` + backfill. NO sincroniza `animals`.
- 0080 — (c2) `user_roles.member_name` + force BEFORE INSERT + propagación AFTER UPDATE OF name en `users` + backfill.
- Ajuste de lecturas (c2): `local-reads.buildMembersQuery`/`buildOwnNameQuery` → `user_roles.member_name` (sin JOIN a
  `users`) + sus unit tests. Firmas públicas intactas (R11.1).
- Tests no-spoof + propagación (rls/run.cjs + animal/run.cjs) — FALLAN hasta que el leader aplique (rojo esperado).

### Run 4.1 (GUARD — 2da mitad del invariante en `0076`) — EN CURSO (implementer)

Feature en curso: `15-powersync`, Run 4.1 = EXTENDER `0076` para CERRAR el finding HIGH-1 que el Gate 1 reabrió.
El trigger de deactivate (Run 4) cubre los roles EXISTENTES al borrar el campo, pero NO impide CREAR/activar un
rol NUEVO para un campo ya borrado (vector: `accept_invitation/index.ts:93-101` inserta `active:true` sin chequear
`establishments.deleted_at` → owner invita → borra el campo → invitado acepta el link → rol activo sobre campo
muerto → el sync JOIN-free le replicaría la data del campo borrado). `baseline_commit` sin cambios (multi-run).

Plan — HECHO, esperando reviewer + Gate 2 + Gate 1 (spec) sobre el delta extendido:
- [x] Guard en `0076` (mismo BEGIN/COMMIT, después del deactivate + backfill): función
  `prevent_active_role_on_soft_deleted_establishment()` (`security definer`, `set search_path=public`) +
  trigger `user_roles_block_active_on_soft_deleted_establishment` `BEFORE INSERT OR UPDATE OF active ON
  user_roles`. Rechaza con **errcode `23514`** (check_violation — invariante de estado, NO `42501`; precedente
  `soft_delete_rodeo` 0041) cualquier INSERT/UPDATE que deje `active=true` apuntando a un campo `deleted_at IS
  NOT NULL`. `active=false` SIEMPRE permitido (early return) → no rompe el deactivate ni la remoción de miembros.
- [x] Test en `supabase/tests/rls/run.cjs` (estG/userG/userH dedicados, autocontenido): INSERT/UPDATE `active=true`
  campo borrado → 23514 reject; campo vivo + `active=false` + restore→reactivar → PASA. **FALLA hasta que el leader
  aplique `0076`** (esperado).

Compat verificada (4 flujos, con evidencia de líneas): creación de campo (`handle_new_establishment` 0011),
aceptar invitación a campo VIVO, deactivate (active=false) + backfill, fix R8.3/R8.4 (restore `deleted_at=null`
ANTES de reactivar — confirmado el orden en `run.cjs:341-354`). El header de `0076` reconciliado (DOS mitades).

Estado: `node scripts/check.mjs` → typecheck + 677 client unit verdes; RLS 16 pass, ÚNICOS 2 rojos = los tests
`0076` pendientes de aplicación (deactivate + guard), el resto verde (R8.3/R8.4, R6.1, etc. sin cascada). Edge/
Maneuvers/User_private/Import 99/0; Animal 52/0 (0075 ya aplicado). El único rojo del repo = los 2 tests `0076`
pendientes — estado esperado. Detalle/trazabilidad/autorrevisión/reconciliación en `progress/impl_15-powersync.md`
(sección Run 4.1). SOLO se tocó `0076_*.sql` + `run.cjs` + `tasks.md` + reconciliación design/requirements. NADA de
app code/EFs/streams/otras migraciones. NO aplicado al remoto. NO commiteado. NO marcado done.

### SAGA DE BUCKETS (PSYNC_S2305) + plan de 2 pasos — 2026-06-08/09

**Smoke de conexión VALIDADO** (post hotfixes Metro Run 1.1/1.2): cliente conectó en vivo (`fetchCredentials hasToken:true`, sin `connect FAILED`). Auth JWKS + WebSocket 101 + WASM/worker bajo Metro: OK.

**El sync NO bajaba data** por `PSYNC_S2305` ("too many buckets", límite 1000). Tres iteraciones de streams:
- **V1** (subselects anidados, sin `with:`) → regresión PowerSync #611: 1 bucket por fila → ~2200 → revienta.
- **V2** (`with: org_scope` + `INNER JOIN establishments` para el deleted_at) → spec_author + **re-Gate 1 PASS** (autorización equivalente, verificada) + veto leader… **falló igual en runtime**: PowerSync evalúa **cada tabla del INNER JOIN como parameter query independiente SIN aplicar org_scope** → el JOIN a establishments enumeró los **102 campos vivos de toda la DB** por stream → ~1020 → revienta. Log: "Stream est_rodeos evaluating parameter on establishments: 102". **LECCIÓN DURA: la semántica de buckets de PowerSync solo se ve en runtime; Gate 1 valida autorización, NO el límite operativo de buckets. Toda stream necesita validación de deploy/runtime contra DB real antes de darse por cerrada.**
- **V3 (VIGENTE — JOIN-FREE)**: cada tabla filtra DIRECTO `WHERE establishment_id IN org_scope`, **sin JOINs** → bucket count INDEPENDIENTE del volumen de data. El `deleted_at` del campo se resuelve con `org_scope` ya limpio vía **trigger 0076** (rol activo ⇒ campo vivo; redundante con `has_role_in`/`is_owner_of` de 0005 → seguro, sin flujo de restore).

**Datos de la DB beta (MCP execute_sql)**: huella REAL de Raf chica (24 perfiles, 3 rodeos, 2 campos vivos, user `78d35c28…`); DB BRUTALMENTE contaminada de test (**343.978 animals**, 876 perfiles, 102 campos, 199 roles). Con V3 (JOIN-free) la contaminación deja de romper el sync. **Raf eligió el FIX COMPLETO** (no el interim). Backlog: ADR de aislamiento de tests + limpieza (entrada 2026-06-08).

**PLAN DE 2 PASOS** (task #22, #23):
- **PASO 1 (en curso)** — validar JOIN-free en vivo, sin tocar schema salvo el trigger:
  - (a) migración **0076** (trigger deleted_at→roles + backfill) — implementer Run 4 escribiéndola; la aplica el leader por Management API tras Gate 1.
  - (b) `sync-streams/rafaq.yaml` **reescrito JOIN-FREE** (leader) para las **17 streams con establishment_id propio** (5 globales + 2 self + 10 per-est: establishments, members_roles[matriz], invitations, rodeos, management_groups, animal_profiles, sessions, maneuver_presets, semen_registry, animal_events). Diferidas (comentadas al final del YAML): las hijas + animals + nombres-coworkers (paso 2). **Bucket math Raf: ~27 buckets.**
  - (c) re-Gate 1 sobre trigger+streams. (d) leader aplica 0076 + Raf deploya el YAML + verifica en logs: bucket count chico + `data_synced_bytes>0` + sin `PSYNC_S2xxx`. → desbloquea la validación LIVE del swap de lectura T3.
- **PASO 2 (pendiente, task #23)** — sobre el modelo probado: **ADR** del patrón de denormalización para PowerSync + migraciones que agregan `establishment_id` (+ trigger de mantenimiento + backfill) a las 8 tablas hijas (5 eventos tipados + animal_category_history + birth_calves + rodeo_data_config) + resolver `animals` (compartido) y nombres de coworkers (users) + streams JOIN-free completas + re-Gate 1.

**Reconciliación de specs PENDIENTE**: `design.md §2` todavía tiene el YAML V2 (INNER JOIN, superado por runtime). Se reescribe a V3 + plan de 2 pasos **cuando el paso 1 valide en vivo** (evitar churn de doc antes de confirmar que V3 anda). `requirements.md`/`tasks.md` idem.

**ESTADO FINAL (2026-06-09, paso 1 + paso 2 VALIDADOS EN VIVO):**

- **PASO 1 — CERRADO + VALIDADO.** `0076` (trigger deactivate + **guard** rol⇒campo-vivo; las dos mitades del invariante) **aplicada al remoto** + re-Gate 1 PASS + suite verde. YAML V3 JOIN-free (17 streams) deployado. Validado en vivo: `first sync done; establishments=2, rodeos=3, …`, sin PSYNC_S2305 → los campos reaparecieron (swap T3 leyendo de local).
- **PASO 2 — CERRADO + VALIDADO.** ADR-026 (b1 + c2 aprobadas por Raf). Migraciones **0077-0080 aplicadas al remoto** (establishment_id denormalizado en las 8 hijas + identidad de animal sobre `animal_profiles` (b1) + `member_name` sobre `user_roles` (c2); todos con trigger-force anti-spoof). Gate 1 PASS (anti-spoof cerrado en todas las tablas con GRANT UPDATE; 2 MEDIUM same-tenant backlogueados: birth_calves/rodeo_data_config deleted-state del padre). AppSchema (schema.ts) + lecturas c2 actualizadas. YAML 25 streams deployado. Suite verde. **Validado en vivo (logs dashboard): buckets=43, data_synced_bytes=178823, operations_synced=259, close_reason=client closing (no error); "mi nombre aparece OK" (c2).**
- **CAPA DE SYNC COMPLETA**: 25 streams, 43 buckets, independiente del volumen. Todo el schema de lectura sincroniza al SQLite local.
- **Migraciones aplicadas al remoto esta sesión**: 0075 (idempotencia register_birth), 0076 (trigger+guard invariante), 0077-0080 (denormalización paso 2). Los archivos .sql están en el repo (este commit los sincroniza).
- **PENDIENTE (próximas sesiones)**: **T4** (swap de lectura del camino de datos: animals/events/timeline → leer de local; hoy sincronizan pero se leen online). **T5/T6** (escritura offline: outbox + overlay + RPC-mapping; incl. fix MED-1 23505 de Run 2). **T7** (tests E2E). **Native T8** (diferido al dev build Android).
- **Backlog abierto** (docs/backlog.md): aislamiento de tests / limpieza DB beta (344K animals de test); propagar soft-delete del padre a birth_calves/rodeo_data_config; mensaje lindo en accept_invitation ante campo borrado.
- **Checkpoint-commit** de toda la sesión: hecho a pedido de Raf (feature 15 NO cerrada — sigue T4+).

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- **Node ≥20.19.4** para el dev server de Expo. Device real bloqueado (Expo Go SDK 56 fuera de tiendas) → iterar por **web** (`pnpm.cmd web`).
- **Cero hardcode en pantallas** (ADR-023 §4): todo via tokens; lint `scripts/check-hardcode.mjs` en `check.mjs`.
- En migrations: `GRANT` explícito a `authenticated` siempre (Auto-expose OFF) + `notify pgrst`. **MCP Supabase read-only** → migraciones al remoto vía **Management API** (`/v1/projects/<ref>/database/query`) con `SUPABASE_ACCESS_TOKEN` de `.env.local`, envueltas en `BEGIN/COMMIT`. NO `supabase db push`.
- **Numeración de migrations**: as-built en disco llega a **0074**; la del delta de PowerSync es **≥0075**.
- Tests en Node nativo (`scripts/run-tests.mjs`); E2E Playwright aparte. Deps nuevas → whitelist `onlyBuiltDependencies` de pnpm (ADR-011) si traen postinstall.
- **PowerSync**: `@powersync/web` (wa-sqlite/WASM) en web, `@powersync/react-native` en device; AppSchema espeja las tablas sincronizadas; tablas `localOnly` NO generan CrudEntry (overlay), `insertOnly` SÍ (outbox `op_intents`). El delta `client_op_id` mantiene el path online (`p_client_op_id` NULL) idéntico al as-built.
