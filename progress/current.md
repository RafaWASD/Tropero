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

### Run 7 (T4 — swap de LECTURA del camino de datos) — HECHO, esperando reviewer + Gate 2 (implementer)

Feature en curso: `15-powersync`, Run 7 = Fase **T4** (T4.1 animals, T4.2 events/timeline, T4.3 management-groups) +
T9.5 (swap T4 alineado a b1, hecho dentro de T4.1). SOLO lecturas → SQLite local (mismo patrón que T3: builders puros
en `local-reads.ts` + I/O en `local-query.ts`). Las streams del paso 1 + paso 2 ya sincronizan en vivo (25 streams, 43
buckets). `baseline_commit` ya existe (`1618a956…`), NO se reescribe (multi-run). NO se tocó escritura/RPC/EF/
migraciones/streams/AppSchema/RLS (100% cliente, solo `services/`). NO done, NO commit.

Plan — HECHO:
- [x] T4.1 — `animals.ts`: `fetchAnimals`, `searchAnimals` (fuzzy→LIKE local; exacto TAG/IDV igual), `countAnimals`,
  `fetchAnimalDetail` → SQLite local; `findOrCreateLookup` lee local por delegar en `searchAnimals`. **b1**: identidad
  (`tag_electronic`/`sex`/`birth_date`) desde `animal_profiles.animal_*`, NO JOIN a `animals` (= T9.5).
- [x] T4.2 — `events.ts`: `fetchTimeline` (UNION ALL local de los 7 orígenes, fiel a `animal_timeline` 0069; payload
  via `json_object`→`JSON.parse`; las 2 queries suplementarias —categorías + service_type— locales) + `fetchMother`
  (JOIN local birth_calves→reproductive_events→animal_profiles; tag de la madre b1) → SQLite local.
- [x] T4.3 — `management-groups.ts`: `fetchManagementGroups` → SQLite local; `fetchGroupMembers` lee local por delegar
  en `fetchAnimals`.

Verde: `check.mjs` (exit 0) + typecheck + `run-tests.mjs` ("All tests passed."). 18 unit nuevos en `local-reads.test.ts`
(33 totales). Decisiones de los puntos abiertos (timeline UNION, identidad b1, degradación fuzzy→LIKE), trazabilidad,
autorrevisión y reconciliación en `progress/impl_15-powersync.md` (sección **Run 7**). NO commiteado. NO marcado done.
Ningún read necesita un campo de `animals` no denormalizado → nada que reportar al leader por ese lado.

### Run 8 (T5 — swap de ESCRITURA offline SIMPLE, CRUD plano) — EN CURSO (implementer)

Feature en curso: `15-powersync`, Run 8 = Fase **T5** (T5.1 eventos, T5.2 lotes, T5.3 sessions/presets).
Solo CRUD plano (INSERT/UPDATE local sobre tablas SINCRONIZADAS vía `getPowerSync().execute(...)`); SIN
overlay (eso es T6). `baseline_commit` ya existe (`1618a9566…`), NO se reescribe (multi-run). NO toco
uploadData (salvo ampliar mapeo plano si faltara), migraciones, streams, RLS, AppSchema, reads de T4, ni
overlay. NO done, NO commit.

Plan (T<n>) — HECHO, esperando reviewer + Gate 2:
- [x] T5.1 — `events.ts`: `addWeight`/`addConditionScore`/`addTacto`/`addService`/`addAbortion`/
  `addObservation` → INSERT local + upload queue; `id` cliente; eliminado split-insert. Todos INSERT plano
  single-tabla (NINGUNA RPC-bound) — verificado en el as-built. `establishment_id` de los eventos OMITIDO
  (trigger 0077 lo fuerza al subir, NULL local, timeline filtra por animal_profile_id); EXCEPCIÓN
  `animal_events` (trigger de VALIDACIÓN 0034 → SÍ se setea desde el perfil).
- [x] T5.2 — `management-groups.ts`: `assignAnimalToGroup` (UPDATE local), `createManagementGroup`
  (INSERT local, devuelve el lote con id cliente sin re-leer), `renameManagementGroup` (UPDATE local) →
  eliminados el diff before/after de create + el `count:'exact'` de assign/rename. softDelete NO se tocó (T6).
- [~] T5.3 — `sessions`/`maneuver_presets`: **N/A** — no existe service cliente (frontend spec 03 diferido;
  solo el AppSchema los declara). Nada que swapear. Documentado, no se inventó.

SQL builders de escritura PUROS en `local-reads.ts` (patrón de los read-builders) + I/O `runLocalWrite` en
`local-query.ts`. 17 unit nuevos en `local-reads.test.ts` (SQL+args+id por cada add*/lote → 43 totales en
el archivo). Verde: `check.mjs` (exit 0) + typecheck + `run-tests.mjs` ("All tests passed."). Trazabilidad,
autorrevisión y reconciliación en `progress/impl_15-powersync.md` (sección Run 8). `uploadData` NO se tocó
(el CRUD plano es table-agnóstico → ya cubre estas tablas). NO commiteado. NO marcado done.

### Run T6 (escritura offline RPC-bound: outbox + overlay + RPC-mapping) — EN CURSO (implementer)

Feature en curso: `15-powersync`, Run T6 = Fase **T6** (T6.1 + T6.2a–f + T6.5). Escritura offline de las (b)
RPC-bound (alta, parto, baja, soft-deletes) vía **outbox `op_intents` + overlay `pending_*` local-only + mapeo
intent→RPC en `uploadData`** (Puerta 1, opción ii). `baseline_commit` ya existe (`1618a9566…`), NO se reescribe
(multi-run). NO migraciones nuevas (idempotencia ya en 0075). NO done, NO commit. NO toco RLS/streams/reads de
T3/T4 salvo el UNION del overlay. `import_rodeo_bulk` queda ONLINE (T6.1).

Plan (T6.2 a→f + T6.5):
- [ ] T6.2a — schema.ts: verificar/completar `op_intents` + `pending_*` (columnas que el overlay UNION precisa).
- [ ] T6.2b — `outbox.ts`: enqueueIntent (1 writeTransaction: op_intent + overlay) + clearOverlay + rollbackOverlay.
- [ ] T6.2c — `upload.ts` + connector: applyIntent (intent→supabase.rpc; `p_client_op_id` SOLO a register_birth; FIFO).
- [ ] T6.2d — idempotencia: create_animal (ON CONFLICT/ids cliente), soft_delete_* (P0002), exit (natural), register_birth (0075).
- [ ] T6.2e — ACK/rollback: éxito→clearOverlay; transitorio→re-throw; permanente→rollbackOverlay; P0002/23505→descarte idempotente.
- [ ] T6.2f — swap 4 services (createAnimal/registerBirth/exitAnimalProfile/softDelete*) + UNION synced+overlay en lecturas.
- [ ] T6.5 — no doble-upload: 1 op (b) = 1 CrudEntry (op_intent); test register_birth offline.

### Run T9.8 (createRodeo OFFLINE — RPC create_rodeo + outbox/overlay, un-defer) — EN CURSO (implementer)

Feature en curso: `15-powersync`. Raf pidió explícito que `createRodeo` funcione OFFLINE (offline-first sin
excepciones) — es el último write que faltaba. NO es CRUD plano (arma la plantilla `rodeo_data_config`, seedeada
por el trigger 0018 server-side + diff de toggles; `rodeo_data_config` tiene PK compuesta = read-only-local). →
RPC atómica server-side `create_rodeo` (migración **0081**, NO aplicada — la aplica el leader tras Gate 1) +
outbox + overlay optimista (patrón T6). `baseline_commit` sin cambios (multi-run). NO done, NO commit.

Plan: 0081 RPC create_rodeo (owner-only authz, INSERT ON CONFLICT idempotente, UPSERT toggles) → schema.ts (2
overlay localOnly pending_rodeos + pending_rodeo_data_config) → outbox.ts (enqueueCreateRodeo) → upload/connector
('create_rodeo' → supabase.rpc, dedup natural) → rodeos.ts (createRodeo offline, firma intacta, elimina
fetchRodeosOnline) → local-reads.ts (UNION en buildRodeosQuery/buildRodeoConfigQuery) → tests + reconciliación
(design §1.2 un-defer, tasks, backlog → RESUELTA). Detalle en `progress/impl_15-powersync.md` (Run T9.8).

### Run online-guard (FIX UX/robustez — fast-fail de writes ONLINE-only offline) — EN CURSO (implementer)

Feature en curso: `15-powersync`. Bug de Raf: editar perfil OFFLINE deja la pantalla en "Guardando…"
PARA SIEMPRE (`saveProfile` hace 2 `supabase.update()` que offline no resuelven → la promesa nunca
resuelve → la UI nunca sale de "guardando"). Decisión de Raf: los writes ONLINE-only deben FALLAR
RÁPIDO con "Necesitás conexión" en vez de colgarse; la pantalla de perfil SE SIGUE VIENDO offline
(nombre/teléfono son datos locales). `baseline_commit` ya existe (`1618a9566…`), NO se reescribe.

Plan (T<n>) — HECHO, esperando reviewer + Gate 2:
- [x] T1 — PURO `offlineError` en `online-guard-pure.ts` (sin SDK, testeable) + I/O `assertOnline` en
  `online-guard.ts` (lee `currentStatus.connected` via `getPowerSync`, envuelve `{ok:false, error}`) +
  unit test SOLO del PURO (4 casos, enganchado en run-tests.mjs). **Split obligado**: el PURO no podía
  vivir junto al import del SDK porque arrastra RN al grafo de node:test (SyntaxError typeof) — mismo
  patrón status-derive vs status.
- [x] T2 — `assertOnline` al INICIO de cada mutación ONLINE-only: `establishments.ts` (saveProfile,
  saveOwnPhone, createEstablishment, updateEstablishment, softDeleteEstablishment), `account.ts`
  (changeEmail, shape `{reason:'network'}`), `members.ts` (guard en `invokeFn` → cubre las 6 ops de
  equipo). NO gateé lecturas ni los writes offline (animals/events/management-groups/rodeos/outbox/
  upload → ninguno referencia el guard, verificado por grep).
- [x] T3 — `mas.tsx`: `useIsOffline()` (reusa `subscribeSyncUiState`) → aviso "Sin conexión: no podés
  editar el perfil ahora" + "Editar perfil"/"Guardar" deshabilitados offline. La pantalla SIGUE
  mostrando nombre/email/teléfono (lectura local).
- [x] T4 — typecheck verde + client unit 183/183 (incl. online-guard 4/4). El único rojo del runner es
  la **animal suite** (bloque `create_rodeo` de 0081/0082, trabajo PARALELO, migración no aplicada) —
  NO es de este fix (cliente puro; la animal suite no importa services de app/). Detalle/autorrevisión/
  reconciliación en `progress/impl_15-powersync.md` (sección "Run online-guard"). NO commit, NO done.

### Run firstSync-gate (FIX showstopper — app aterriza en ONBOARDING / listas vacías) — EN CURSO (implementer)

Feature en curso: `15-powersync`. Bug confirmado por E2E: todos los datos SÍ sincronizan, pero el gate
de establecimiento y las lecturas resuelven el SQLite local one-shot ANTES de que complete el first-sync
y NO re-evalúan → onboarding fantasma + lista de animales vacía. 100% client-side (NO se toca streams/
migraciones/connector/outbox/overlay/schema). `baseline_commit` ya existe (`1618a956…`), NO se reescribe.

Plan (T<n>) — HECHO, esperando reviewer + Gate 2:
- [x] T1 (Paso 0) — `first-sync.ts` (`waitForUsableSync` cached/synced/timeout + `isFirstSyncPending`) +
  `first-sync.test.ts` (8 unit, db fake; `getPowerSync` require LAZY para no romper node:test).
- [x] T2 (Paso 1) — `EstablishmentContext.tsx`: bootstrap espera `waitForUsableSync`; helper interno
  `applyMembershipsResult` que respeta `network && isFirstSyncPending()` → no afirma no_establishments;
  listener `statusChanged` que re-resuelve SOLO en la transición first-sync false→true.
- [x] T3 (Paso 2) — `_layout.tsx` RootGate: `SPLASH_FALLBACK_MS = FIRST_SYNC_TIMEOUT_MS + 500` (~5s).
- [x] T4 (Paso 3) — `RodeoContext.tsx`: listener `statusChanged` re-corre `load` al llegar el first-sync
  estando en loading.
- [x] T5 (Paso 4) — `animales.tsx` + `(tabs)/index.tsx` (stepper): `useStatus()` + efecto que re-corre la
  carga cuando avanza `lastSyncedAt`.
- [x] Verificación: typecheck + `check.mjs` verde (unit incl. first-sync 8/8) + E2E `auth.spec` **4/4** +
  `animals.spec` **12/14** (rebuild). **El oráculo del bug (`animals.spec:386`) pasa de ROJO en baseline a
  VERDE.** Residuales `:52`(tail)/`:500`/`establishments:29` = PRE-EXISTENTES (verificados rojos en baseline,
  fuera de scope) → backlog.
- [x] Reconciliación de specs (design §5.1 / requirements R5.4 / tasks T11) + autorrevisión adversarial.
  Detalle en `progress/impl_15-powersync.md` (Run T11). NO commit, NO done.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- **Node ≥20.19.4** para el dev server de Expo. Device real bloqueado (Expo Go SDK 56 fuera de tiendas) → iterar por **web** (`pnpm.cmd web`).
- **Cero hardcode en pantallas** (ADR-023 §4): todo via tokens; lint `scripts/check-hardcode.mjs` en `check.mjs`.
- En migrations: `GRANT` explícito a `authenticated` siempre (Auto-expose OFF) + `notify pgrst`. **MCP Supabase read-only** → migraciones al remoto vía **Management API** (`/v1/projects/<ref>/database/query`) con `SUPABASE_ACCESS_TOKEN` de `.env.local`, envueltas en `BEGIN/COMMIT`. NO `supabase db push`.
- **Numeración de migrations**: as-built en disco llega a **0074**; la del delta de PowerSync es **≥0075**.
- Tests en Node nativo (`scripts/run-tests.mjs`); E2E Playwright aparte. Deps nuevas → whitelist `onlyBuiltDependencies` de pnpm (ADR-011) si traen postinstall.
- **PowerSync**: `@powersync/web` (wa-sqlite/WASM) en web, `@powersync/react-native` en device; AppSchema espeja las tablas sincronizadas; tablas `localOnly` NO generan CrudEntry (overlay), `insertOnly` SÍ (outbox `op_intents`). El delta `client_op_id` mantiene el path online (`p_client_op_id` NULL) idéntico al as-built.
