# Spec 03 — MODO MANIOBRAS — Tasks

**Status**: `spec_ready` — **APROBADA por Raf (Puerta 1, 2026-05-30)**. Gate 1 PASS. Lista para implementar.
**Fecha**: 2026-05-30 (sesión 18).

Plan de implementación paso a paso. Cada tarea tiene su criterio de aceptación y los `R<n>` que cubre. El orden importa: dependencias hacia adelante. Migrations nuevas arrancan en **0050** (as-built verificado: la última migración es `0049_birth_calves_service_role_grant.sql`; la decomposición decía "0052" pero el árbol llega a 0049). El implementer confirma el próximo número real contra el as-built. Backend (Supabase) primero, cliente después; igual que spec 01/02, la feature se puede cerrar tras Fase 1+2 y diferir el cliente.

> **Antes de empezar (coordinación, ver design §9)**: **T1.3** (`session_id` sobre tablas de spec 02), **T1.4** (extensión enum repro de spec 02), **T1.5** (gating `BEFORE INSERT`/`BEFORE UPDATE` sobre tablas de spec 02) **modifican tablas/enums de otra spec**. Confirmar con Raf / la terminal de backend (decisiones abiertas D1, D2, D4, **D8** en design.md) antes de aplicarlas. Si Raf prefiere que `session_id` entre como delta de spec 02, se reasigna esa migración allá. **Coordinación (terminal paralela) de numeración de migraciones**: hay otra terminal trabajando en el repo; el bloque 0050+ debe coordinarse antes de crear archivos para evitar colisión de números entre migraciones concurrentes. El implementer reserva el rango contra el as-built **y** contra lo que la otra terminal tenga en vuelo, no solo contra el árbol.

> **⚠️ Pre-flight (CORREGIDO por Gate 1, SEC-SPEC-03-02).** Una versión previa de esta spec daba por **existentes as-built de spec 02** las funciones `public.current_animal_rodeo(uuid)` y `public.get_rodeo_data_keys(...)`. **ES FALSO**: verificado contra el árbol (migrations 0001-0049, 0 hits para ambas). El implementer **NO debe** asumir que existen ni pararse esperándolas. El rodeo real del animal se resuelve **inline** vía `select rodeo_id from public.animal_profiles where id = ? and deleted_at is null` (perfil activo) — esa resolución vive **dentro de** `assert_data_keys_enabled` (se crea en spec 03, T1.5), no en una función separada. Funciones que SÍ existen as-built y se reusan: `public.establishment_of_profile(uuid)` (`0023`), `public.tg_force_created_by_auth_uid()` (`0043`), `public.tg_set_updated_at_generic()`. El próximo número de migración libre es **0050** (último as-built: `0049`).

**Fases sugeridas**:
- **Fase 1 — Schema + triggers + RLS**: migrations `0050..0055`. Backend puro.
- **Fase 2 — Tests reales contra DB remota**: suite `supabase/tests/maneuvers/` (RLS de sessions/presets, gating accept/reject + binding, tenant-check de session_id, transición en maniobra, append-only).
- **Fase 3+ — Cliente**: BLE `StickReader`, gating cliente, services, hooks, pantallas, PowerSync, tests. (Pausado hasta retomar frontend con stack ADR-013, como spec 02.)

---

## Fase 1 — Schema, triggers y RLS

### [x] T1.1 — Migration `0050_sessions.sql` (entidad sesión)
Satisface: R1.1, R1.9, R1.10, R1.11, R10.6, R10.7, R11.1, R11.2, R11.3.
Detalle: enum `session_status ('active','closed')` + tabla `public.sessions` (design §2.1: `id`, `establishment_id`, `rodeo_id`, `config jsonb`, `status`, `work_lot_label`, `animal_count`, `event_count`, `notes`, `created_by`, `started_at`, `ended_at`, timestamps, `deleted_at`). **CHECK `sessions_config_size` (`octet_length(config::text) < 16384`)** — SEC-SPEC-03-06. Indexes `by_est`, `by_rodeo`, `active`. Triggers `sessions_force_created_by` (reusa `tg_force_created_by_auth_uid` de spec 02 `0043`), `sessions_set_updated_at`, `tg_sessions_rodeo_check` (rodeo activo del mismo establishment). RLS canónico (`has_role_in` SELECT/INSERT/UPDATE; sin DELETE). `grant select, insert, update to authenticated`.
Aceptación: owner crea sesión sobre rodeo propio → OK; sesión sobre rodeo de otro establishment → `23514`; `field_operator`/`veterinarian` activos crean sesión → OK; `userB` sin rol → 0 filas; `created_by` queda en `auth.uid()` aunque el payload mande otro uid; `config` > 16 KiB → falla el CHECK.
Archivos: `supabase/migrations/0050_sessions.sql`.

### [x] T1.2 — Migration `0051_maneuver_presets.sql` (presets por establishment)
Satisface: R2.1, R2.4, R2.5, R11.1, R11.3.
Detalle: tabla `public.maneuver_presets` (design §2.2): `id`, `establishment_id`, `name` (check no vacío), `config jsonb`, `created_by`, timestamps, `deleted_at`. **CHECK `maneuver_presets_config_size` (`octet_length(config::text) < 16384`)** — SEC-SPEC-03-06. Index `by_est`. Triggers `force_created_by` + `set_updated_at`. RLS por establishment (`has_role_in` SELECT/INSERT/UPDATE). Grants.
Aceptación: cualquier rol operativo activo crea/lee/edita presets del establecimiento; `userB` sin rol → 0 filas; name vacío → falla; `config` > 16 KiB → falla el CHECK.
Archivos: `supabase/migrations/0051_maneuver_presets.sql`.

### [x] T1.3 — Migration `0052_event_session_fk.sql` (FK de eventos → sesión) ⚠️ toca constraints de tablas de spec 02
Satisface: R5.11, R7.4, R11.4. (Resuelve C2; ver D1.)
Detalle: la **columna `session_id uuid` YA EXISTE** en las 5 tablas (0025-0029, sin FK, comentada "sessions no existe aún"). Esta migración **agrega la FK** (no la columna): `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL` en `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`. Index parcial `by_session` por tabla. Función `tg_event_session_tenant_check` (SECURITY DEFINER, search_path public): si `session_id` no es null valida (i) **cross-tenant**: `sessions.establishment_id == establishment_of_profile(animal_profile_id)` (`23514` si difiere, `23503` si la sesión no existe/está borrada); (ii) **intra-tenant (SEC-SPEC-03-04)**: `sessions.status='active'` (`23514` si no) y el rodeo del animal (`animal_profiles.rodeo_id` del perfil activo) == `sessions.rodeo_id` (`23514` si difiere — R1.1 "una sesión = un rodeo"; el flujo R4.4 mueve el animal de rodeo ANTES de cargar eventos). `revoke execute … from public, authenticated, anon`. Trigger `BEFORE INSERT OR UPDATE OF session_id` en las 5 tablas.
Aceptación: evento con `session_id` de la misma sesión/establishment/rodeo y sesión activa → OK; con `session_id` de otro establishment → `23514`; con `session_id` inexistente → `23503`; con `session_id` de una sesión `closed` → `23514`; con animal de otro rodeo del mismo establishment → `23514`; evento sin `session_id` → OK; la función no es invocable como RPC por `authenticated`.
Archivos: `supabase/migrations/0052_event_session_fk.sql`.

### [x] T1.4 — Migration `0053_tacto_vaquillona.sql` (extensión enum repro) ⚠️ toca enum de spec 02
Satisface: R5.13, R6.3.
Detalle: `ALTER TYPE public.repro_event_type ADD VALUE IF NOT EXISTS 'tacto_vaquillona'`; enum `heifer_fitness_result ('apta','no_apta','diferida')`; `ALTER TABLE reproductive_events ADD COLUMN heifer_fitness heifer_fitness_result`. Aislar el `ADD VALUE` en su propia migración si el motor lo exige (no transaccionable con otro DDL).
Aceptación: insertar `reproductive_events (event_type='tacto_vaquillona', heifer_fitness='apta')` → OK; valor de `heifer_fitness` fuera del enum → falla.
Archivos: `supabase/migrations/0053_tacto_vaquillona.sql`.

### [x] T1.5 — Migration `0054_gating_db_layer.sql` (gating capa 2, ADR-021) ⚠️ toca tablas de spec 02
Satisface: R7.1, R7.2, R7.3, R7.4, R7.5, R7.6.
Detalle: función `assert_data_keys_enabled(p_animal_profile_id uuid, p_data_keys text[])` (SECURITY DEFINER, search_path public) que **resuelve el rodeo INLINE** (`select rodeo_id from public.animal_profiles where id = p_animal_profile_id and deleted_at is null` — NO usa `current_animal_rodeo`, que no existe; SEC-SPEC-03-02) y verifica que **todos** los `data_keys` estén `enabled=true` en `rodeo_data_config` (join a `field_definitions`); rechaza `23514` si falta alguno. **FAIL-CLOSED explícito (SEC-SPEC-03-03)**: si `v_rodeo IS NULL` (perfil inexistente/soft-deleted) → `raise exception … errcode '23514'`; **prohibido** un `if v_rodeo is null then return;` (fail-open). `revoke execute … from public, authenticated, anon`.
Triggers `BEFORE INSERT` por tabla que ramifican por `event_type`/`sample_type` → `data_key(s)` según el mapeo R5.4 (design §4): `condition_score_events`→`condicion_corporal`; `weight_events`→`peso`; `lab_samples` `blood`→`brucelosis`, `scrape_*`→`raspado_toros`; `sanitary_events` `vaccination`→`vacunacion`; `reproductive_events` `tacto`→`['prenez','tamano_prenez']`, `tacto_vaquillona`→`tacto_vaquillona`, `service`+IA→`inseminacion`. Parto/aborto/destete NO se gatean.
**Gating del destino UPDATE dientes/CUT (SEC-SPEC-03-01, R7.5)**: función `tg_animal_profiles_teeth_gating()` (SECURITY DEFINER, EXECUTE revocado) que invoca `assert_data_keys_enabled(NEW.id, array['dientes'])`; trigger `BEFORE UPDATE OF teeth_state, is_cut, category_id ON public.animal_profiles` con guarda `WHEN (new.teeth_state IS DISTINCT FROM old.teeth_state OR new.is_cut IS DISTINCT FROM old.is_cut)` para NO gatear UPDATE de lote (R9.2) ni de rodeo (R4.4). Modifica una tabla de spec 02 → coordinación + D8 (default = enforce; Raf puede excluir, documentar).
Aceptación: ver T2.4/T2.4b/T2.5/T2.11; la función no es RPC público.
Archivos: `supabase/migrations/0054_gating_db_layer.sql`.

### [x] T1.6 — Migration `0055_check_grants.sql` (housekeeping)
Satisface: housekeeping, R11.4.
Detalle: consolidar grants de `sessions`, `maneuver_presets` y confirmar `revoke execute` de los helpers internos (`assert_data_keys_enabled`, `tg_event_session_tenant_check`). Patrón de `0038_check_grants.sql` / `0042_revoke_internal_function_grants.sql` de spec 02.
Aceptación: `node scripts/check.mjs` verde; SELECT desde cliente authenticated sobre `sessions`/`maneuver_presets` funciona; los helpers internos NO son invocables por `authenticated`.
Archivos: `supabase/migrations/0055_check_grants.sql`.

---

## Fase 2 — Tests reales contra DB remota

> Patrón heredado de spec 01/02: tests Node nativo en `supabase/tests/`, login con users de prueba, ejercen policies y triggers, limpian al final. Setup reusa helpers de `supabase/tests/animal/` (createAnimal, createRodeo).

### [x] T2.1 — Suite `supabase/tests/maneuvers/run.cjs` (esqueleto)
Satisface: housekeeping.
Detalle: runner Node nativo siguiendo `supabase/tests/animal/run.cjs`. Setup: `userA` (owner estA) + `userB` (owner estB) + un rodeo `(bovino,cría)` por establishment (con `rodeo_data_config` pre-poblado por el trigger de spec 02). Helpers: `createSession(client, {establishmentId, rodeoId})`, `createPreset(client, {establishmentId, name, config})`.
Aceptación: skeleton corre con 0 tests y termina limpio.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.2 — Tests: RLS de `sessions`
Satisface: R1.1, R1.3, R10.7, R11.1, R11.3.
Detalle: owner crea sesión OK; sesión sobre rodeo ajeno → `23514`; `userB` sin rol no la ve (0 filas) ni la crea; `field_operator` activo crea sesión OK; cerrar sesión (`status='closed'`) por rol activo OK; no hay DELETE de cliente.
Aceptación: 6 tests verdes.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.3 — Tests: `created_by` forzado server-side en `sessions`/`presets`
Satisface: R11.2.
Detalle: insertar `session` y `preset` pasando `created_by = <uid de otro usuario>` en el payload → con `service_role`, la fila resultante tiene `created_by = <uid del caller>` (trigger `tg_force_created_by_auth_uid`).
Aceptación: 2 tests verdes.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.4 — Tests: gating capa 2 — accept/reject por data_key (INSERT a eventos)
Satisface: R7.1, R7.3, R5.4.
Detalle: por cada maniobra gateada, insertar el evento tipado sobre un animal cuyo rodeo tiene el/los `data_key` **enabled** → OK; y sobre un rodeo con ese `data_key` **disabled** (owner hace `update rodeo_data_config set enabled=false`) → `23514`. Cubrir: `condicion_corporal`, `peso`, `brucelosis` (blood), `raspado_toros` (scrape), `vacunacion`, `prenez`+`tamano_prenez` (tacto), `tacto_vaquillona`, `inseminacion`. Caso multi-key: tacto con `prenez` enabled pero `tamano_prenez` disabled → falla (requiere ambos). Caso bypass: insertar evento gateado directo por PostgREST (saltando la UI) sobre rodeo disabled → falla (defensa en profundidad).
Aceptación: ~10 tests verdes (accept + reject por maniobra + multi-key + bypass).
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.4b — Tests: gating capa 2 **fail-closed** (no-bypass ante rodeo no resoluble)
Satisface: R7.6 (SEC-SPEC-03-03).
Detalle: (a) insertar un evento gateado (p. ej. `condition_score_events`) sobre un `animal_profile_id` **soft-deleted** (`deleted_at IS NOT NULL`) → la resolución inline de rodeo da NULL → `assert_data_keys_enabled` debe **rechazar** (`23514`), NUNCA pasar; (b) insertar sobre un `animal_profile_id` **inexistente** → rechazo (`23514`); (c) caso de control: mismo evento sobre perfil activo con `data_key` enabled → OK. Verifica que NO hay early-return fail-open.
Aceptación: 3 tests verdes (soft-deleted → reject; inexistente → reject; control → OK).
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.5 — Tests: binding data_key↔destino no roto
Satisface: R7.2 (riesgo de binding ADR-021).
Detalle: test que verifica que **cada `data_key` literal** usado en los triggers de gating (`condicion_corporal`, `peso`, `brucelosis`, `raspado_toros`, `vacunacion`, `prenez`, `tamano_prenez`, `tacto_vaquillona`, `inseminacion`, **`dientes`** — este último del trigger `BEFORE UPDATE` de SEC-SPEC-03-01) **existe** en `field_definitions`. Si un `data_key` se renombrara, este test falla. Complementa T2.4 (comportamiento) verificando el contrato del mapeo.
Aceptación: 1 test que recorre los data_keys del mapeo y confirma presencia en `field_definitions`.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.6 — Tests: tenant-check de `session_id` en eventos (cross + intra-tenant)
Satisface: R5.11, R7.4, R1.1 (SEC-SPEC-03-04).
Detalle: insertar `weight_event` con `session_id` de la misma sesión/establishment/rodeo y sesión **active** → OK; con `session_id` de una sesión de otro establishment → `23514` (cross-tenant); con `session_id` inexistente → `23503`; evento sin `session_id` → OK. **Intra-tenant (SEC-SPEC-03-04)**: con `session_id` de una sesión `status='closed'` del mismo establishment → `23514`; con un animal cuyo `rodeo_id` ≠ `sessions.rodeo_id` (mismo establishment) → `23514`. Repetir el cross-tenant para al menos otra tabla (`sanitary_events`). **Ordenamiento de cierre (R10.8 / orden de cierre offline, design §5)**: crear eventos con `session_id` de una sesión **active**, luego cerrarla (`status='closed'`); verificar que el patrón create-events→close **NO rechaza** los eventos ya creados (el rechazo solo aplica a insertar un evento NUEVO contra una sesión ya cerrada).
Aceptación: 8 tests verdes (OK, cross-tenant, inexistente, sin session, closed, rodeo-mismatch, + 1 cross-tenant en otra tabla, + ordenamiento de cierre).
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.7 — Tests: transición de categoría disparada en maniobra + ortogonalidad
Satisface: R8.1, R8.2, R8.3.
Detalle: insertar `reproductive_events (event_type='tacto', pregnancy_status='medium', session_id=<sesión>)` sobre una vaquillona cuyo rodeo tiene `prenez`+`tamano_prenez` enabled → la categoría pasa a `vaquillona_prenada` (trigger spec 02) Y queda en `animal_category_history`; verificar que `rodeo_id` y `management_group_id` NO cambiaron (ortogonalidad). Con `category_override=true` → no transiciona.
Aceptación: 3 tests verdes.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.8 — Tests: RLS de `maneuver_presets`
Satisface: R2.1, R2.4, R2.5, R11.1, R11.3.
Detalle: rol operativo activo crea/lee/edita preset del establecimiento; `userB` sin rol → 0 filas; name vacío → falla; soft-delete por rol activo deja de aparecer en SELECT.
Aceptación: 4 tests verdes.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.9 — Tests: append-only / corrección per-evento sigue funcionando
Satisface: R11.5.
Detalle: cargar un evento en una sesión (con `session_id`), corregirlo por edición (owner o `created_by`, sin ventana de tiempo — spec 02 R6.8.1) y por soft-delete → OK; `userB` sin rol no puede; verificar que no hay camino de escritura cross-tenant sobre el evento.
Aceptación: 3 tests verdes.
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [x] T2.11 — Tests: no-bypass del gating dientes/CUT (UPDATE `animal_profiles`)
Satisface: R7.5 (SEC-SPEC-03-01).
Detalle: sobre un animal cuyo rodeo tiene `dientes` **disabled** (`update rodeo_data_config set enabled=false where data_key='dientes'`): (a) `UPDATE animal_profiles SET teeth_state=...` (valor no-NULL, aditivo) directo por PostgREST/sync (saltando la UI) → **rechazado** (`23514`); (b) `UPDATE animal_profiles SET is_cut=true, category_id=..., category_override=true` (transición CUT, aditivo false→true) sobre ese rodeo → **rechazado** (`23514`). Controles: mismo rodeo con `dientes` **enabled** → ambos UPDATE OK. **Afinación ENFORCE AFINADO (D8) — sustractivos permitidos sobre rodeo SIN dientes**: (E) limpiar `teeth_state` a NULL (`UPDATE animal_profiles SET teeth_state=NULL`) → **aceptado**; (F) desmarcar `is_cut` (`UPDATE animal_profiles SET is_cut=false`, true→false) → **aceptado**. **Guarda WHEN**: `UPDATE animal_profiles SET management_group_id=...` (lote, R9.2) y `UPDATE … SET rodeo_id=...` (R4.4) sobre rodeo con `dientes` disabled **NO disparan** el gating (siguen su propio camino) → OK. Trazabilidad: R7.5, SEC-SPEC-03-01, trigger guard `IS DISTINCT FROM`.
Aceptación: ~8 tests verdes (2 reject aditivo + 2 control enabled + 2 sustractivo aceptado [Caso E, Caso F] + 2 guarda lote/rodeo no-gatea).
Archivos: `supabase/tests/maneuvers/run.cjs`.

### [ ] T2.12 — Verificación cross-spec del find-or-create inline (nota / re-check en Gate 2)
Satisface: R4.6 (SEC-SPEC-03-05).
Detalle: **no implementable en spec 03** (el enforcement del alta vive en spec 09, no integrada — ver D9). Cuando spec 09 esté integrada, el Gate 2 (`code`) de spec 03 debe re-verificar que el alta inline en la manga (R4.1): fuerza el `establishment_id` **activo** (no el del payload), respeta el UNIQUE `tag_electronic` global y `(establishment_id, idv)`, y fuerza `created_by` server-side. Dejar este check como ítem explícito del Gate 2 de esta spec; si spec 09 ya está integrada al implementar, agregar un test de no-bypass cross-tenant del alta inline a la suite.
Aceptación: ítem registrado para Gate 2; test agregado solo si spec 09 está integrada al momento de implementar.
Archivos: `progress/impl_03-modo-maniobras.md` (nota de Gate 2) / `supabase/tests/maneuvers/run.cjs` (si aplica).

### [x] T2.10 — Hook al runner global
Satisface: housekeeping.
Detalle: agregar `maneuvers/run.cjs` a `scripts/run-tests.mjs`; `node scripts/check.mjs` ejecuta y reporta verde.
Aceptación: `check.mjs` corre Fase 2 entera verde (incluye T2.4b, T2.11).
Archivos: `scripts/run-tests.mjs`.

---

## Fase 3 — Cliente: BLE, gating y services

> ⚠️ **PROVISIONAL**: las tasks/R de cliente (R3.x BLE, R4.x find-or-create/identidad, partes de R5.x y R10.x) dependen de specs 04 (bastón), 05 (balanza) y 09 (find-or-create/`useBusyMode`) **sin construir**. Se reconcilian cuando esas specs aterricen (el Gate 0 anticipó riesgo de rot, context §Aprobación). El backend (Fase 1/2) es firme: solo depende de spec 02 as-built. (Aplica también a la **Fase 4 — Cliente: pantallas**.)

> Pausado hasta retomar frontend (stack ADR-013), como Fase 3+ de spec 02. Documentado y listo para retomarse.

### [ ] T3.1 — `StickReader` (interfaz BLE agnóstica)
Satisface: R3.1, R3.3, R3.4, R3.8, R10.4, R12.3.
Detalle: `app/src/features/maneuvers/ble/StickReader.ts` (interfaz design §6) + `parseIso11784.ts` (parseo 15 díg, prefijo país → `tag_electronic`, descarta inválidos) + stub para tests. Feedback: vibración (expo-haptics) + visual + sonido al entrar lectura válida. Alinear con la interfaz de spec 04 (`useBleStickListener`) cuando se implemente.
Aceptación: unit tests del parser (válido/inválido/prefijo); contrato `StickReader` mockeable.
Archivos: `app/src/features/maneuvers/ble/*`.

### [ ] T3.2 — `useStickReader` (conexión, suscripción, reconexión, fallback)
Satisface: R3.2, R3.6, R3.7.
Detalle: hook que conecta/suscribe el `StickReader`, maneja reconexión automática con backoff (R3.7), expone estado de conexión, entrega lecturas; al desconectar/perder batería no interrumpe la sesión (R3.6). Activa `useBusyMode` de spec 09 al montar (suspende listener BLE global, R3.2) y lo restaura al desmontar.
Aceptación: component-tests con `StickReader` mock: conexión, lectura, desconexión→fallback, reconexión.
Archivos: `app/src/features/maneuvers/hooks/useStickReader.ts`.

### [ ] T3.3 — Gating cliente (`maneuverGating.ts` + `useManeuverGating`)
Satisface: R1.4, R1.5, R5.3, R5.4, R5.5, R5.6, R10.3.
Detalle: mapeo `MANEUVER_DATA_KEYS` (design §3, R5.4); resolución por rodeo real (lee `animal_profiles.rodeo_id` del perfil activo desde el cache local — NO usa `current_animal_rodeo`, que no existe as-built; SEC-SPEC-03-02) + `isManeuverAvailable` de spec 02 `rodeo-config.ts`, leyendo `rodeo_data_config` cacheado. Determina maniobras que aplican por animal (R5.5), required vs opcional (R5.6).
Aceptación: unit tests con tabla de casos (rodeo con/sin data_key, multi-key, required/optional); refleja el mapeo de ADR-021.
Archivos: `app/src/features/maneuvers/gating/maneuverGating.ts`, `hooks/useManeuverGating.ts`.

### [ ] T3.4 — Service `sessions.ts`
Satisface: R1.9, R1.10, R1.11, R10.1, R10.2, R10.7, R9.4.
Detalle: `createSession`, `closeSession`, `getActiveSession`, `incrementCounters` (animal_count/event_count, app-maintained — design D5), `setWorkLotLabel`. IDs cliente (UUID), offline-first (PowerSync). Patrón split insert+select (ADR-012).
Aceptación: unit + integración liviana; sesión se crea offline y sincroniza.
Archivos: `app/src/features/maneuvers/services/sessions.ts`.

### [ ] T3.5 — Service `maneuverPresets.ts`
Satisface: R2.1, R2.2, R2.3, R2.5.
Detalle: CRUD de presets (offline-first, scope establishment); al cargar un preset en un rodeo, filtrar maniobras con data_key OFF + devolver lista de omitidas para avisar (R2.3).
Aceptación: unit tests; el filtrado por gating del rodeo funciona.
Archivos: `app/src/features/maneuvers/services/maneuverPresets.ts`.

### [ ] T3.6 — Service `maneuverEvents.ts`
Satisface: R5.8, R5.11, R5.12, R6.1, R6.2, R6.3, R6.4, R6.5, R6.6, R6.7, R6.8, R6.9, R6.10, R6.11, R6.12.
Detalle: orquesta los services de eventos de spec 02 (`createWeightEvent`, `createReproductiveEvent`, `createSanitaryEvent`, `createConditionScoreEvent`, `createLabSample`) inyectando `session_id`; maneja multi-vacuna (R6.1), 2 tubos de raspado (R6.11), tacto vaquillona (R6.3), dientes como propiedad + prompt CUT (R6.7/R6.8 vía `markCut`/`updateAnimalCategory` de spec 02), pesaje de ternero con autocompletar categoría (R6.10). Persiste al confirmar cada maniobra (R5.8). Saltea raspado para hembras (R6.12).
Aceptación: unit + integración; cada maniobra escribe en su tabla con `session_id`; prompt CUT no aplica a terneros; raspado se saltea para hembras.
Archivos: `app/src/features/maneuvers/services/maneuverEvents.ts`.

### [ ] T3.7 — `ManeuverSessionContext` + reanudación
Satisface: R8.4, R10.5, R10.6.
Detalle: estado de la sesión activa (1 por dispositivo, R10.6); persistencia local (SQLite/secure-store) del progreso del wizard; al abrir la app, detecta sesión `active` del dispositivo y ofrece retomar (R10.5). Preview de transición offline reusando `transitions.ts` de spec 02 (R8.4).
Aceptación: component-tests: una sola sesión activa; reanudación tras "cierre" simulado retoma desde el último animal/maniobra; intentar 2da sesión activa ofrece retomar/cerrar.
Archivos: `app/src/features/maneuvers/contexts/ManeuverSessionContext.tsx`.

---

## Fase 4 — Cliente: pantallas

### [ ] T4.1 — `ManeuverStartScreen` (inicio + presets)
Satisface: R2.2, R2.3.
Detalle: presets al tope (R2.2); CTA "nueva jornada"; aviso de maniobras filtradas al elegir preset (R2.3).
Aceptación: render con presets; aviso de filtrado visible.
Archivos: `app/src/features/maneuvers/screens/ManeuverStartScreen.tsx`.

### [ ] T4.2 — `SessionWizardScreen` (wizard 3 etapas)
Satisface: R1.2, R1.4, R1.5, R1.7, R1.8, R1.9.
Detalle: etapa 1 rodeo activo (R1.3); etapa 2 maniobras gateadas (gating UI, R1.4/R1.5) + pre-config con texto libre+autocompletar (R1.7/R1.8); etapa 3 resumen + arrancar (crea sesión, R1.9). Una decisión por pantalla, botones grandes.
Aceptación: el wizard solo ofrece maniobras habilitadas en el rodeo; al confirmar crea la sesión.
Archivos: `app/src/features/maneuvers/screens/SessionWizardScreen.tsx`.

### [ ] T4.3 — `FastLoadScreen` (carga rápida — pantalla crítica)
Satisface: R3.1, R3.5, R4.1, R4.2, R4.3, R4.4, R4.5, R4.7, R5.1, R5.10, R12.1, R12.2, R12.4.
Detalle: identificación dual (BLE + manual, R3.1/R3.5); desambiguación visual duplicada (R4.2/R4.3); animal de otro rodeo mismo sistema → pasar/saltar (R4.4); otro establecimiento → avisar/saltar/sugerir (R4.5); find-or-create inline (R4.1); muestra identidad+rodeo+categoría siempre (R5.1/R12.4); contador de progreso (R5.10). Botones 60-80px, alto contraste, vibración (R5.2/R12.2/R12.3). **Detección de rodeo de jornada equivocado (R4.7)**: si los primeros ~3 animales son todos de otro rodeo, sugerir cambiar el rodeo de la sesión; la confirmación de [pasar a este rodeo] muestra el **rodeo de origen** del animal (R4.4).
Aceptación: identificación por ambas puertas; edge cases de identidad resueltos sin frenar la fila; contador incrementa; con los primeros ~3 animales de otro rodeo se sugiere corregir el rodeo de la sesión (R4.7).
Archivos: `app/src/features/maneuvers/screens/FastLoadScreen.tsx`.

### [ ] T4.4 — `ManeuverStepScreen` (una maniobra por pantalla)
Satisface: R5.2, R5.6, R5.7, R5.8, R6.1–R6.12, R9.1, R9.2, R9.3, R12.1, R12.3.
Detalle: render por tipo de maniobra (R5.4); campos pre-cargados con defaults (R5.1); required vs opcional (R5.6); bloquea confirmación si falta required (R5.7); persiste al confirmar (R5.8); comportamiento por maniobra (R6.1–R6.12). Asignar lote manual opcional desde el wizard (R9.2); nunca auto-asigna lote (R9.1).
Aceptación: cada maniobra confirma en 1-3 taps; required faltante bloquea; lote opcional asignable; sin auto-asignación de lote.
Archivos: `app/src/features/maneuvers/screens/ManeuverStepScreen.tsx`.

### [ ] T4.5 — `AnimalSummaryScreen` (resumen por animal + corregir)
Satisface: R5.9, R5.10, R5.11.
Detalle: resumen de las maniobras cargadas del animal; corregir tocando una maniobra (R5.9); confirmar → siguiente animal + `session_id` + contador (R5.10/R5.11).
Aceptación: corrección desde el resumen reabre la maniobra; confirmar avanza.
Archivos: `app/src/features/maneuvers/screens/AnimalSummaryScreen.tsx`.

### [ ] T4.6 — PowerSync + tests de cliente
Satisface: R10.1, R10.2, R10.3, R10.8, R12.1.
Detalle: agregar `sessions`/`maneuver_presets` a sync rules (scope establishment); verificar carga 100% offline de una jornada y sync posterior (R10.1/R10.2); cache de `rodeo_data_config` para gating offline (R10.3). **Surfacing de eventos rechazados al sincronizar (R10.8)**: si el gating capa 2 o el tenant-check de `session_id` rechaza un evento cargado offline, el operario **ve el rechazo con su motivo** (no dead-letter silencioso) y puede re-resolver. Tests Detox/RTL de los flujos críticos.
Aceptación: jornada completa offline → sincroniza al recuperar señal; gating offline correcto; un evento rechazado al sincronizar se muestra al operario con motivo (R10.8).
Archivos: `app/powersync/sync-rules.yaml`, `app/src/features/maneuvers/__tests__/*`.

---

## Trazabilidad (resumen)

- **Backend (Fase 1/2)**: R1.x (sessions), R2.x (presets), R5.11 + R7.x (session_id + gating DB), R5.13/R6.3 (enum), R8.x (transición), R11.x (seguridad).
- **Cliente (Fase 3/4)**: R3.x (BLE), R4.x (identidad/find-or-create), R5.x (carga rápida/gating cliente), R6.x (maniobras), R9.x (lote manual), R10.x (offline/reanudación), R12.x (UX campo).
- Cada `R<n>` de `requirements.md` aparece en al menos una task ("Satisface:"). El implementer completa `progress/impl_03-modo-maniobras.md` con el mapa `R<n> → archivo:test` (regla dura de trazabilidad, `docs/specs.md`).

> **Pendiente de Raf antes de implementar** (design §9): D1 (session_id sobre tablas de spec 02), D2 (reversión de jornada sí/no), D3 (`work_lot_label` sí/no), D4 (corrects_event_id ADR-017 sí/no), D5 (contadores app vs trigger), D7 (scope preset), **D8 (gating capa 2 del path dientes/CUT: enforce [default] vs excluir — SEC-SPEC-03-01)**, **D9 (re-verificación cross-spec del find-or-create en Gate 2 — SEC-SPEC-03-05, no bloqueante)**. T1.3/T1.4/T1.5 tocan tablas/enums de spec 02 → coordinar con backend. Esta spec es schema-sensitive → pasa por **Gate 1** (`security_analyzer` modo `spec`) antes de la aprobación humana (ADR-019).

> **Cierre Gate 1 FAIL (sesión 18)** — esta pasada cerró los 6 findings de `progress/security_spec_03-modo-maniobras.md`: SEC-SPEC-03-01 (gating UPDATE dientes/CUT → R7.5, T1.5, T2.11, D8), 03-02 (resolución de rodeo inline, sin `current_animal_rodeo`/`get_rodeo_data_keys` → R5.3/R5.6/R7.1, T1.5, pre-flight), 03-03 (fail-closed → R7.6, T1.5, T2.4b), 03-04 (intra-tenant en tenant-check → T1.3, T2.6), 03-05 (cross-spec find-or-create → D9, T2.12), 03-06 (CHECK de tamaño de `config` jsonb → T1.1/T1.2). Re-correr Gate 1 sobre el delta antes de la aprobación humana.
