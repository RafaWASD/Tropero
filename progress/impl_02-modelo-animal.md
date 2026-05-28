# Implementación — `02-modelo-animal`

**Agente:** `implementer`
**Inicio:** 2026-05-28
**Spec:** `specs/active/02-modelo-animal/` (aprobada por Raf 2026-05-26, refundida 2026-05-28 — ADR-020 lote + ADR-021 plantilla de datos)
**baseline_commit:** c1cae843d144cd5f663fdbbd9085d2c1aeb2134c

## Alcance de esta corrida

- **Fase 1** (T1.1–T1.28): migrations de schema + triggers + RLS.
- **Fase 2** (T2.1–T2.17): suite de tests reales contra DB remota (`supabase/tests/animal/run.cjs`).
- **Fase 3+** (cliente / PowerSync / Detox): **diferidas intencionalmente** hasta que Raf retome frontend (mismo patrón que spec 01).

No marco la feature `done` — eso es del reviewer + Raf. Queda `in_progress`.

## Decisión de numeración (default técnico menor — documentado)

La spec/design/tasks asumen que las migrations de spec 02 ocupan `0012..0037`, porque cuando se escribió el diseño el backend de spec 01 terminaba en `0011`. Pero el refactor link-shareable de ADR-014 (sesión 6) agregó `0012_invitations_email_nullable.sql` a spec 01, que **ya está aplicada en remoto** (`supabase migration list` muestra `0001..0012` Local=Remote en sync).

**Resolución (offset +1, sin cambio arquitectónico):** todas las migrations de spec 02 se desplazan un número hacia adelante → ocupan `0013..0038`. El schema, triggers, RLS, seeds y orden de dependencias se preservan 100%; solo cambia el prefijo del archivo. Es una decisión mecánica de filename, no de diseño (CLAUDE.md "defaults menores").

Mapa lógico spec → archivo real (offset +1):

| Spec (design/tasks) | Archivo real | Task |
|---|---|---|
| 0012 species | `0013_species.sql` | T1.2 |
| 0013 systems_by_species | `0014_systems_by_species.sql` | T1.3 |
| 0014 categories_by_system | `0015_categories_by_system.sql` | T1.4 |
| 0017 generic_updated_at | `0016_generic_updated_at.sql` | T1.7 (movido ANTES de rodeos por dependencia) |
| 0015 rodeos | `0017_rodeos.sql` | T1.5 |
| 0016 field_template_and_rodeo_config | `0018_field_template_and_rodeo_config.sql` | T1.6 |
| 0018 animals | `0019_animals.sql` | T1.8 |
| 0019 animal_profiles | `0020_animal_profiles.sql` | T1.9 |
| 0020 animal_profiles_validations | `0021_animal_profiles_validations.sql` | T1.10 |
| 0021 rls_animals_and_profiles | `0022_rls_animals_and_profiles.sql` | T1.11 |
| 0022 event_helpers | `0023_event_helpers.sql` | T1.12 |
| 0023 event_created_by_helper | `0024_event_created_by_helper.sql` | T1.13 |
| 0024 weight_events | `0025_weight_events.sql` | T1.14 |
| 0025 reproductive_events | `0026_reproductive_events.sql` | T1.15 |
| 0026 sanitary_events | `0027_sanitary_events.sql` | T1.16 |
| 0027 condition_score_events | `0028_condition_score_events.sql` | T1.17 |
| 0028 lab_samples | `0029_lab_samples.sql` | T1.18 |
| 0029 animal_category_history | `0030_animal_category_history.sql` | T1.19 |
| 0030 category_transitions | `0031_category_transitions.sql` | T1.20 |
| 0031 calf_creation | `0032_calf_creation.sql` | T1.21 |
| 0032 animal_timeline | `0033_animal_timeline.sql` | T1.22 |
| 0033 animal_events | `0034_animal_events.sql` | T1.24 |
| 0034 animal_timeline_v2 | `0035_animal_timeline_v2.sql` | T1.25 |
| 0035 immutability_identifiers | `0036_immutability_identifiers.sql` | T1.26 |
| 0036 management_groups | `0037_management_groups.sql` | T1.27 |
| 0037 check_grants | `0038_check_grants.sql` | T1.28 |

Nota T1.7 (`generic_updated_at`): el design lo numera después de rodeos/field_template, pero esas migrations lo USAN. Resolución: muevo la migration del helper genérico a `0016_generic_updated_at.sql` (antes de `0017_rodeos` y `0018_field_template`). Mismo contenido que el design (T1.7), solo adelantado en el orden de archivos. La función es `create or replace` (idempotente).

## Estado

**Fase 1 (T1.1–T1.28) COMPLETA** — 24 migrations `0013..0038` aplicadas a remoto, `supabase migration list` en sync (Local=Remote=0001..0041).
**Fase 2 (T2.1–T2.17) COMPLETA** — `supabase/tests/animal/run.cjs` con 16 grupos de tests (+ setup + cleanup) = 18 subtests, 18/18 verdes contra DB remota.
**Fix migrations** `0039`, `0040`, `0041` (ver "Desviaciones" abajo).
**`node scripts/check.mjs` VERDE**: typecheck + RLS (15) + Edge (26) + Animal (18).
**Fase 3+ (cliente/PowerSync/Detox): diferidas** (mismo patrón que spec 01). NO marco `done` — eso es del reviewer + Raf.

## Mecanismo de aplicación

Migrations aplicadas con `supabase db push` (CLI devDep de `app/`, mismo mecanismo que spec 01), cargando `.env.local` con `set -a && . ../.env.local && set +a`. Tests con `node --test supabase/tests/animal/run.cjs`, enganchado en `scripts/run-tests.mjs` (T2.12).

## Tasks ejecutadas

| Task | Estado | Archivo real | Notas |
|---|---|---|---|
| T1.1 | ✅ | — | `pg_trgm` ya disponible (Postgres 17); `db push` en sync antes de empezar (0001..0012). |
| T1.2 | ✅ | `0013_species.sql` | 3 especies, bovino active. |
| T1.3 | ✅ | `0014_systems_by_species.sql` | cría active; 4 inactivas. |
| T1.4 | ✅ | `0015_categories_by_system.sql` | 10 categorías de cría. |
| T1.7 | ✅ | `0016_generic_updated_at.sql` | adelantado antes de rodeos por dependencia. |
| T1.5 | ✅ | `0017_rodeos.sql` | validación species/system + RLS owner. |
| T1.6 | ✅ | `0018_field_template_and_rodeo_config.sql` | 3 tablas plantilla, 26 fields seed (23 ON), trigger pre-populate. |
| T1.8 | ✅ | `0019_animals.sql` | TAG único global, validación species. |
| T1.9 | ✅ | `0020_animal_profiles.sql` | unique IDV/perfil-activo, GIN trgm. |
| T1.10 | ✅ | `0021_animal_profiles_validations.sql` | identity/rodeo/category checks + override-on-manual. |
| T1.11 | ✅ | `0022_rls_animals_and_profiles.sql` | RLS perfiles + animals derivado. |
| T1.12 | ✅ | `0023_event_helpers.sql` | `establishment_of_profile`. |
| T1.13 | ✅ | `0024_event_created_by_helper.sql` | `tg_set_created_by_auth_uid`. |
| T1.14 | ✅ | `0025_weight_events.sql` | |
| T1.15 | ✅ | `0026_reproductive_events.sql` | + semen_registry. |
| T1.16 | ✅ | `0027_sanitary_events.sql` | campaign_id sin FK (TODO documentado). |
| T1.17 | ✅ | `0028_condition_score_events.sql` | CHECK 17 valores. |
| T1.18 | ✅ | `0029_lab_samples.sql` | index por tube_number. |
| T1.19 | ✅ | `0030_animal_category_history.sql` | trigger initial/auto/manual/revert. |
| T1.20 | ✅ | `0031_category_transitions.sql` | compute_category + apply_auto_transition (solo category_id, R7.7). |
| T1.21 | ✅ | `0032_calf_creation.sql` | ternero al pie BEFORE INSERT. |
| T1.22 | ✅ | `0033_animal_timeline.sql` | timeline v1 (6 orígenes). |
| T1.24 | ✅ | `0034_animal_events.sql` | Híbrido, CHECK observacion/otro, edit window. |
| T1.25 | ✅ | `0035_animal_timeline_v2.sql` | timeline v2 (7mo origen observacion). |
| T1.26 | ✅ | `0036_immutability_identifiers.sql` | inmutabilidad post-completitud R4.13. |
| T1.27 | ✅ | `0037_management_groups.sql` | lote + ALTER animal_profiles + validación mismo-est. |
| T1.28 | ✅ | `0038_check_grants.sql` | housekeeping grants. |
| T2.1–T2.17 | ✅ | `supabase/tests/animal/run.cjs` | 18/18 verdes. |

## Desviaciones del SQL del design (mínimas, documentadas)

Tres fixes de implementación. Ninguno cambia el schema; corrigen bugs del SQL literal del design para que el modelo funcione end-to-end contra Postgres/PostgREST real. **Requieren visto bueno del reviewer.**

1. **`0033`/`0035` — alias en `animal_timeline`**: el `UNION ALL` del design dejaba sin alias la 3ra columna del primer SELECT, así que `order by event_date desc` fallaba con `column "event_date" does not exist`. Fix: aliasar explícitamente `event_kind/event_id/event_date/payload` en el primer SELECT. Comportamiento idéntico al diseñado.

2. **`0039` — `tg_animal_profiles_identity_check` a SECURITY DEFINER**: el trigger BEFORE INSERT lee `animals.tag_electronic`, pero un animal recién insertado es invisible vía RLS (su `animals_select` deriva de la existencia de un `animal_profile` que aún no existe en ese instante). Sin security definer el trigger veía NULL y rechazaba un alta con TAG válido (falso negativo de R4.2). Fix: security definer. Misma validación.

3. **`0040` — `tg_animal_profiles_set_override_on_manual` respeta el revert**: el trigger marcaba `category_override = true` en cualquier cambio de `category_id` fuera de transición automática, **incluso** cuando el UPDATE de revert (R4.10) seteaba `category_override = false` explícitamente en el mismo statement — pisándolo y registrando `manual_override` en vez de `revert_to_auto`. Fix: si `old.category_override = true AND new.category_override = false` (revert explícito), respetar el false. Resto del comportamiento intacto.

4. **`0041` — soft-delete vía RPC SECURITY DEFINER (DESVIACIÓN DE CONTRATO — atención reviewer/Raf)**: PostgREST exige que la fila resultante de un UPDATE siga siendo visible según la policy de SELECT (lo enforce aun con `Prefer: return=minimal`). Las policies de SELECT de spec 02 incluyen `deleted_at is null` sobre la **propia** fila, así que un soft-delete por `UPDATE deleted_at` deja la fila fuera del SELECT y el write es rechazado con `42501`. Afecta a todos los soft-delete por UPDATE que el spec concede al cliente: rodeos (R2.5), management_groups (R2.17), animal_events (R6.12), eventos tipados (R6.8). (Spec 01 no lo sufrió porque sus policies de SELECT derivan de helpers que leen OTRAS tablas, no el `deleted_at` propio.)
   - **Decisión tomada**: en vez de relajar las policies de SELECT (rompería R12.3), agregué funciones SECURITY DEFINER `soft_delete_rodeo`, `soft_delete_management_group`, `soft_delete_animal_event`, `soft_delete_event(kind,id)` que re-validan la misma autorización que la policy de UPDATE correspondiente y hacen el UPDATE por dentro. R12.3 (lecturas normales no retornan soft-deleted) queda intacto; la autorización es idéntica. Consistente con ADR-012 (preferir funciones/triggers en Postgres).
   - **Impacto a revisar**: cambia el mecanismo de soft-delete de "UPDATE deleted_at" a "RPC". El design/diseño de PowerSync asumía soft-delete por columna (sync offline pone `deleted_at` local). Esto **toca la estrategia offline de Fase 5** (un soft-delete offline ya no puede ser un simple update local sincronizable; habría que encolar la RPC o reconciliar). Anotado para Raf en `CONTEXT/07-pendientes.md`. Si Raf prefiere otra solución (ej. relajar SELECT + filtrar en cliente, o policy split), es reversible: borrar `0041` y ajustar.

## Fix loop Gate 2 (FAIL → SEC-HIGH-01) — 2026-05-28 (sesión 15)

Rebote del security_analyzer (Gate 2). Un (1) finding HIGH cerrado con fix mínimo y seguro. Ver `progress/security_code_02-modelo-animal.md` § SEC-HIGH-01.

**Finding**: `apply_auto_transition(profile_id uuid, target_category_id uuid)` (0031) es SECURITY DEFINER, no valida authz adentro, y quedó expuesto como RPC de PostgREST con `EXECUTE TO PUBLIC` por default (nunca se revocó). Un `authenticated` del tenant A que conozca un `profile_id` del tenant B podía reescribirle la categoría cross-tenant vía `POST /rest/v1/rpc/apply_auto_transition` (CWE-862 / CWE-639). Es helper INTERNO del trigger de transición (R7.7), el cliente nunca lo invoca.

**Fix** — `0042_revoke_internal_function_grants.sql` (aplicada a remoto, `supabase migration list` Local=Remote=0001..0042):
```sql
revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon;
notify pgrst, 'reload schema';
```
- Mínimo y load-bearing: solo el revoke puntual de `apply_auto_transition`. NO se aplicó el hardening sistémico opcional (`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS`) para no arriesgar romper funciones que el runner/los tests SÍ invocan (`compute_category`, `animal_timeline`, `establishment_of_profile`, los `soft_delete_*`). Mismo patrón de "revoke defensivo" que `0005_rls_helpers.sql` (has_role_in / is_owner_of).
- **No rompe las transiciones automáticas**: el trigger `tg_reproductive_events_apply_transition` es SECURITY DEFINER y corre como owner del schema, que CONSERVA su EXECUTE → sigue invocando `apply_auto_transition`. Confirmado: T2.4 (transiciones R7.1–R7.3) y T2.5 (override/revert) siguen verdes tras el revoke.

**Test de regresión** — `supabase/tests/animal/run.cjs` → `T2.18 apply_auto_transition no invocable cross-tenant (SEC-HIGH-01)`:
- Setup: perfil objetivo en estA categoría `vaquillona`; userB es owner de estB y se le desactiva cualquier rol en estA antes del ataque.
- userB intenta `clientB.rpc('apply_auto_transition', { profile_id: <perfil de estA>, target_category_id: <multipara> })` → la RPC falla (permission denied / función no accesible / no encontrada).
- Verificación load-bearing con `admin` (service_role): la `category_id` del perfil ajeno NO cambió respecto del valor original.

**Verificación**: `node scripts/check.mjs` VERDE — typecheck + RLS (15) + Edge (26) + **Animal (19, antes 18)**.

NO marqué `done`. NO commiteé. No toqué los cambios sin commitear ajenos a la feature 02 (harness sesión 15 + `specs/active/03-modo-maniobras/`).

## Tests manuales / guidelines (no-SQL, son UX cliente)

- **T2.6 prompt CUT automático (R8.4)**: el prompt "¿Marcar como CUT?" al cargar dientes `1/2`/`1/4`/`sin_dientes` es UX del cliente (Fase 4, T4.4). A nivel SQL solo se valida que el UPDATE de `is_cut + category cut + override` funciona (cubierto por T2.6). El prompt en sí se valida manualmente/Detox cuando se retome el frontend.
- **R8.3 (no mostrar dientes/CUT para ternero/ternera)**: UX cliente, Fase 4.

## Trazabilidad R<n> → test

Suite: `supabase/tests/animal/run.cjs` (+ herencia de RLS/Edge donde aplica). Subtests por grupo `T2.x`.

| R<n> | Cubierto por |
|---|---|
| R1.1 | `T2.16 plantilla` (species seed) + verificación de seed en setup |
| R1.2 | `T2.9` (systems_by_species: solo cría active) + `T2.16` |
| R1.3 | `T2.3` (10 categorías usadas) + seed verificado |
| R1.4 | `T2.16 Caso 3` (catálogos read-only desde cliente) |
| R1.5 | `T2.16 Caso 1/2` (lectura de catálogos por authenticated) |
| R2.1 | `T2.1 setup` (createRodeo) + `T2.9` |
| R2.2 | `T2.1 setup` (owner crea rodeo) + `T2.9` |
| R2.3 | `T2.8` (field_operator no crea rodeo) + `T2.9` |
| R2.4 | `T2.9` (bovino+invernada inactivo falla 23514) |
| R2.5 | `T2.9` (soft-delete rodeo con/sin animales vía soft_delete_rodeo) |
| R2.6 | `T2.1 setup` (0 rodeos al crear est) + `T2.9` (count=0) |
| R2.7 | sustrato modelado (mapeo gating en spec 03); tablas + RLS verificadas en `T2.16` |
| R2.8 | `T2.16 Caso 1` (field_definitions catálogo global 26) |
| R2.9 | `T2.16 Caso 2` (system_default_fields cría 26, 23 ON, 3 OFF) |
| R2.10 | `T2.16 Caso 4` (rodeo_data_config) |
| R2.11 | `T2.1 setup` + `T2.9` + `T2.16 Caso 4/5/6` (pre-populate + toggle + habilitar no-default) |
| R2.12 | `T2.16 Caso 5/6/7` (toggle owner, habilitar no-default owner, no DELETE cliente) |
| R2.13 | `T2.16 Caso 1/2` (seed 26 fields cría) |
| R2.14 | `T2.17 Caso 1` (crear lote owner-only) |
| R2.15 | `T2.17 Caso 2/3/4/5` (asignación exclusiva, mismo-est, inexistente) |
| R2.16 | `T2.17` (management_group_id expuesto; regla display es cliente) |
| R2.17 | `T2.17 Caso 1/2/8` (crear owner-only; asignar cualquier rol; soft-delete owner-only) |
| R2.18 | `T2.4 ortogonalidad` + `T2.17 Caso 7` (transición no toca lote) |
| R3.1 | `T2.2` (createAnimal inserta animals) |
| R3.2 | `T2.2 Caso 5` (TAG duplicado global falla) |
| R3.3 | (validación species inactiva — trigger; cubierto indirecto, animals usa bovino active) |
| R3.4 | `animals.sex CHECK` (schema; createAnimal usa male/female) |
| R3.5 | `T2.8` (userA ve animal global; userC sin rol no) |
| R4.1 | `T2.2` (animal_profiles) + `T2.17` (management_group_id) |
| R4.2 | `T2.2 Caso 1-4` (solo TAG/IDV/visual OK; ninguno falla 23514) |
| R4.3 | `T2.2 Caso 6` (IDV duplicado en est falla; entre est OK) |
| R4.4 | `T2.11` (búsqueda por visual_id_alt) |
| R4.5 | trigger rodeo_check (schema); `T2.17 Caso 4` (lote otro est) ejercita patrón |
| R4.6 | trigger category_check (schema; categorías válidas usadas en todos los tests) |
| R4.7 | `T2.3` (compute_category: ternera/vaquillona/ternero/torito) |
| R4.8 | `T2.5` (UPDATE manual -> override true + manual_override) |
| R4.9 | `T2.4` (override=true bloquea transición auto) |
| R4.10 | `T2.5` (revert: override false + recompute -> revert_to_auto) |
| R4.11 | unique index perfil activo (schema) |
| R4.12 | status enum (schema) |
| R4.13 | `T2.14 Caso 1-5` (NULL→valor OK; valor→otro/NULL falla; visual editable) |
| R5.1 | `T2.11` (TAG exacto encuentra) |
| R5.2 | `T2.2 Caso 6` (IDV scope por est) |
| R5.3 | `T2.11` (visual_id_alt fuzzy via substring; índice GIN trgm creado) |
| R5.4 | primitive (UX en spec 09); búsqueda cubierta por `T2.11` |
| R6.1 | `T2.10`/`T2.15` (weight_events) |
| R6.2 | `T2.4`/`T2.7` (reproductive_events) |
| R6.3 | `T2.10`/`T2.15` (sanitary_events) |
| R6.4 | `T2.15` (condition_score_events score 3.50) |
| R6.5 | schema (lab_samples; index tube_number) |
| R6.6 | FK constraints (schema) |
| R6.7 | `T2.13` (author_id = auth.uid) + created_by trigger en eventos |
| R6.8 | `T2.8` (owner/creador editan; otro no) |
| R6.10 | `T2.13 Caso 1` (animal_events insert) |
| R6.11 | `T2.13 Caso 2` (event_type 'salud' falla CHECK) |
| R6.12 | `T2.13 Caso 4/5/6/7` (edit window, inmutables, soft-delete) |
| R6.13 | `T2.13 Caso 8/9/10` (RLS select/insert/update author/owner) |
| R7.1 | `T2.4` (vaquillona + tacto+ -> vaquillona_prenada) |
| R7.2 | `T2.4` (vaquillona_prenada + birth -> vaca_segundo_servicio) |
| R7.3 | `T2.4` (vaca_segundo_servicio + birth -> multipara) |
| R7.4 | `T2.6` (CUT es manual; no hay transición auto a cut) |
| R7.5 | trigger raise warning (no bloquea); cubierto por diseño + `T2.4` (multipara no transiciona) |
| R7.6 | `T2.5` (compute_category en revert) |
| R7.7 | `T2.4` + `T2.17 Caso 7` (transición no toca rodeo ni lote) |
| R8.1/R8.2 | teeth_state enum (schema); `T2.6` (set teeth_state) |
| R8.3 | UX cliente (Fase 4) — guideline manual |
| R8.4/R8.5 | `T2.6` (set is_cut + category cut + override via UPDATE) |
| R9.1 | `T2.7` (ternera creada, born_here, visual fallback, lote NULL) |
| R9.2 | `T2.7` (ternero entidad independiente con perfil propio) |
| R9.3 | `T2.7` (calf_tag_electronic -> ternero con TAG sin fallback) |
| R9.4 | `T2.7` (calf_tag duplicado -> rollback del evento) |
| R10.1 | `T2.10` (v1, 6 orígenes) + `T2.15` (v2, 7mo origen observacion) |
| R10.2 | `T2.10`/`T2.15` (userC sin rol -> 0 filas) |
| R10.3 | `T2.4` (animal_category_history auto_transition) + `T2.5` (manual/revert) |
| R11.1-R11.5 | `T2.8` (aislamiento, roles, owner-only rodeo) + `T2.16`/`T2.17` (RLS config/lote) + `T2.18` (apply_auto_transition no invocable cross-tenant) |
| SEC-HIGH-01 (R11.x) | `supabase/tests/animal/run.cjs` → `T2.18 apply_auto_transition no invocable cross-tenant (SEC-HIGH-01)` |
| R12.1 | deleted_at en todas las tablas (schema) |
| R12.2 | created_at/updated_at (schema) |
| R12.3 | `T2.13 Caso 7`/`T2.15` (soft-deleted no aparece en SELECT normal) |
| R12.4 | `T2.4` (history graba cada cambio con reason) |
| R13.1-R13.5 | Fase 5 (PowerSync) — diferida |
| R14.1-R14.8 | Fase 4 (cliente) — diferida (TENTATIVA) |

## Tasks restantes (Fase 3+, diferidas)

- Fase 3 (T3.1–T3.8): contextos, services, hooks, módulo TS de transiciones.
- Fase 4 (T4.1–T4.5): pantallas (lista, ficha, rodeos+wizard, prompt CUT, lotes).
- Fase 5 (T5.1–T5.4): PowerSync buckets + offline + preview + refresh config.
- Fase 6 (T6.1–T6.3): Detox + auditoría RLS manual + docs cierre.
- Todas pausadas hasta que Raf retome el frontend (stack ADR-013), igual que spec 01.

## Pendiente para el reviewer / Raf

- **Aprobar las 4 desviaciones** (`0033/0035` alias timeline, `0039` identity SD, `0040` revert, `0041` soft-delete RPC). La #4 es la única con impacto de contrato (toca PowerSync de Fase 5) — anotada en `CONTEXT/07-pendientes.md`.
- **Validar el seed de cría de `field_definitions` con Facundo** (26 fields, TENTATIVO — R2.13).
- NO marqué la feature `done` en `feature_list.json` — queda `in_progress` para el reviewer + Raf.
