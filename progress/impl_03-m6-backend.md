baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl — Spec 03 / chunk M6-BACKEND (Circunferencia escrotal — US-14, R14.9–R14.18)

Feature `03-modo-maniobras` (in_progress). Chunk **M6-BACKEND** (B.1–B.5). Gate 1 (security modo `spec`)
ya **PASS** (`progress/security_spec_03-m6-circunferencia.md`, 0 HIGH) → **transcribo** el diseño §12.3/§12.4/§12.5,
NO re-decido seguridad. Honro los 2 MEDIUM de Gate 1 (M6-SEC-01 surfacing R10.8 + test loop; M6-SEC-02
test no-bypass del `session_id` tenant-check, caso (i) de B.5).

⚠️ **NO se aplica DDL ni se deploya el YAML.** Las migraciones + la suite se ESCRIBEN; el apply a la DB
compartida + el deploy del YAML de PowerSync los gatea el leader con Raf. La suite `scrotal` corre contra
la DB remota → queda **ROJA hasta el apply** (esperado, no es regresión). Hook en `scripts/run-tests.mjs`
queda **COMENTADO**.

## Numeración de migraciones (re-confirmada contra el árbol + terminales paralelas)
- Último as-built: `0097_check_grants.sql` (M5). `0092` reservada spec-08 (ya saltada por M5).
- `git status` de `supabase/migrations/`: SIN cambios sin commitear (la otra terminal trabaja spec-08 en
  `app/src/services/sigsa/`, NO en migraciones) → `0098/0099/0100` LIBRES.
- Grep `circunferencia_escrotal|scrotal` sobre `supabase/` → 0 hits previos.
- Números finales: **0098** (tabla) / **0099** (data_key + seed) / **0100** (gating).

## Plan (T1..T5)
- **T1 — B.1** `0098_scrotal_measurements.sql`: tabla typed (espejo `weight_events`/`condition_score_events`
  + denorm `establishment_id` post-M5 `custom_measurements`), `circumference_cm numeric(4,1) CHECK 20–50`,
  `age_months int CHECK 0–600 nullable`, `measured_at date`, `source event_source`, `notes CHECK ≤500`,
  `recorded_by` forzado por `tg_scrotal_force_recorded_by` (SECDEF+search_path+EXECUTE revocado),
  `establishment_id` forzado por `tg_force_establishment_id_from_profile` (0077, before insert OR update)
  + `SET NOT NULL` después, FK `session_id` + reuso `tg_event_session_tenant_check` (0056), RLS canónico
  (SELECT/INSERT `has_role_in` + UPDATE `is_owner_of OR recorded_by`), índices, grants.
- **T2 — B.2** `0099_scrotal_data_key_and_seed.sql`: data_key global `circunferencia_escrotal` en
  `field_definitions` (`establishment_id NULL`, `data_type='maniobra'`, `ui_component='numeric_stepped'`,
  `category='reproductivo'`) + seed en `system_default_fields` de cría (`default_enabled=true`,
  `required_for_system=false`, `sort_order=max+1`).
- **T3 — B.3** `0100_scrotal_gating.sql`: `tg_scrotal_gating` BEFORE INSERT (SECDEF+search_path+EXECUTE
  revocado) → `assert_data_keys_enabled(new.animal_profile_id, array['circunferencia_escrotal'])` (reuso
  0054, single-key, fail-closed).
- **T4 — B.4** sync + cliente: `rafaq.yaml` → `ev_scrotal_measurements` (paridad `ev_weight_events`, NO
  deployar) + `schema.ts` Table nueva + `schema.test.ts` guard de cantidad + `upload-rejections.ts`
  `MANEUVER_TABLE_LABELS['scrotal_measurements']='Circunferencia escrotal'` + tests.
- **T5 — B.5** suite no-bypass `supabase/tests/scrotal/run.cjs` (casos a–i, incluido (i) M6-SEC-02) + hook
  COMENTADO en `run-tests.mjs`.
- **T6** — autorrevisión adversarial + reconciliación AS-BUILT en design §12 + verificación verificable.

## Archivos creados/modificados
**Creados:**
- `supabase/migrations/0098_scrotal_measurements.sql` — tabla typed + audit forzado + RLS + session_id (B.1).
- `supabase/migrations/0099_scrotal_data_key_and_seed.sql` — data_key global + seed cría (B.2).
- `supabase/migrations/0100_scrotal_gating.sql` — gating capa 2 fail-closed single-key (B.3).
- `supabase/tests/scrotal/run.cjs` — suite no-bypass, casos (a)–(i) (B.5).

**Modificados:**
- `sync-streams/rafaq.yaml` — stream `ev_scrotal_measurements` (paridad `ev_weight_events`). **NO deployado.**
- `app/src/services/powersync/schema.ts` — `Table scrotal_measurements` + registro en `Schema`.
- `app/src/services/powersync/schema.test.ts` — guard de cantidad (28→29 sincronizadas; total 36→37).
- `app/src/services/powersync/upload-rejections.ts` — `MANEUVER_TABLE_LABELS['scrotal_measurements']` (M6-SEC-01).
- `app/src/services/powersync/upload-rejections.test.ts` — asserts de la CE en el surfacing.
- `scripts/run-tests.mjs` — hook de la suite scrotal **COMENTADO** (el leader lo descomenta post-apply).
- `specs/active/03-modo-maniobras/tasks.md` — M6-B.1..B.5 `[x]`.

## Mapa R<n> → archivo:test
| R<n> | qué | test |
|---|---|---|
| R14.9 (audit forzado) | `recorded_by`/`establishment_id` no spoofeables en INSERT *y* UPDATE-path (M6-CODE-01) | `scrotal/run.cjs` (b) audit forzado + sub-assert UPDATE-path |
| R14.9 (tabla typed) | fila tipada con identidad/`circumference_cm`/`age_months`/`measured_at`/`session_id` | `scrotal/run.cjs` (c)(f)(i) (INSERT exitoso) + `schema.test.ts` (Table) |
| R14.10 (CRUD-plano offline) | `session_id` NULL = carga desde ficha → OK | `scrotal/run.cjs` (i) sub-caso (4) |
| R14.11 (gating capa 2 fail-closed) | enabled OK / disabled 23514 / soft-deleted 23514 / inexistente reject | `scrotal/run.cjs` (c) gating fail-closed |
| R14.12 (gating independiente de la UI) | disabled por PostgREST directo + no-bypass `service_role` | `scrotal/run.cjs` (c) (sub-casos disabled + service_role) |
| R14.15 (RLS tenant) | `userB` sin rol → 0 filas (SELECT) / reject (INSERT) | `scrotal/run.cjs` (a) RLS tenant |
| R14.16 (frontera WAL) | actor con rol ve sus CE; sin rol NO (predicado `ev_scrotal_measurements`) | `scrotal/run.cjs` (g) frontera WAL |
| R14.17 (corrección append-only) | owner/`recorded_by` corrige/soft-deletea; tercero NO | `scrotal/run.cjs` (h) corrección append-only |
| R14.18 (seed cría) | rodeo de cría nuevo → CE enabled por default | `scrotal/run.cjs` (e) seed cría + (d) binding |
| R14.5/R14.9 (cap de rango) | `circumference_cm` <20/>50 → reject; `age_months` >600 reject; límites OK | `scrotal/run.cjs` (f) CHECK de rango |
| R5.11 (session_id tenant-check, M6-SEC-02) | cross-tenant / sesión cerrada / otro rodeo → 23514; NULL → OK; inexistente → 23503; dispara en INSERT | `scrotal/run.cjs` (i) session_id no-bypass |
| R10.8 (surfacing del rechazo, M6-SEC-01) | label es-AR "Circunferencia escrotal" en el banner/sheet de manga | `upload-rejections.test.ts` (M6-SEC-01 asserts) |
| R14.16 (schema local) | `Table scrotal_measurements` en `AppSchema`, 29 sincronizadas | `schema.test.ts` (guard de cantidad) |

## Autorrevisión adversarial (paso 8)
Pasada hostil sobre el delta. Qué busqué y qué encontré:
- **Orden de firing de los 4 triggers BEFORE INSERT** (`scrotal_force_establishment_id` < `scrotal_force_recorded_by` < `scrotal_gating` < `scrotal_measurements_session_tenant_check`, alfabético). Verificado que ni gating ni session-check leen las columnas forzadas (ambos resuelven desde `new.animal_profile_id`/`new.session_id`) → el orden no introduce hazard. El RLS WITH CHECK corre DESPUÉS de todos los BEFORE → ve los valores forzados. **OK.**
- **Cross-tenant del INSERT (caso a):** un INSERT de `userB` sobre un perfil de estA termina con `establishment_id` forzado a estA → `has_role_in(estA)` false para userB → 42501. El spoof de `establishment_id`/`recorded_by` en el payload (caso b) lo pisa el trigger → verificado que la fila queda con estA / userA. **OK.**
- **GOTCHA de soft-delete por cliente (caso h):** caza temprana — un `UPDATE deleted_at` por CLIENTE sobre una tabla cuya policy SELECT filtra `deleted_at IS NULL` da **42501 DETERMINISTA** (PostgREST exige que la fila siga visible post-UPDATE; documentado en T2.9 maneuvers + suite custom). `scrotal_measurements` NO tiene RPC de soft-delete dedicado (igual que `custom_measurements`). **Corregido:** separé el contrato de seguridad (la corrección por EDICIÓN del owner/recorded_by, que NO choca con la visibilidad porque la fila sigue visible) del efecto funcional del soft-delete (verificado por service_role + que sale del SELECT del cliente). El gotcha NO es de M6 (vive igual en weight_events/custom_measurements) → no lo arrastro como falla del schema.
- **Trigger genérico `tg_event_session_tenant_check` sobre tabla nueva (M6-SEC-02):** verificado contra `0052` que lee SOLO `new.animal_profile_id`/`new.session_id` (ambas presentes) → reuso sano. La forma `before insert or update` (sin `OF session_id`) es la del trigger `_ins` de `0056` que SÍ dispara en INSERT. El caso (i) lo garantiza: el OK con sessA + el reject con sessB sobre INSERTs prueban que el trigger corre en INSERT (si no disparara, el cross-tenant pasaría sin validar — el bypass de `0052` que `0056` cazó). **OK.**
- **Gating fail-closed single-key:** `array['circunferencia_escrotal']` entra limpio en `assert_data_keys_enabled` (0054, fail-closed por construcción: rodeo no resoluble → 23514 sin early-return). Cubierto por (c) (enabled/disabled/soft-deleted/service_role). **OK.**
- **Seed global sin camino de cliente:** trazado fila a fila contra los CHECKs de `0093` (data_type/slug/len/ui_component/category) + el guard (`auth.uid() is null → return new` deja pasar el seed por migración) + UNIQUE parcial `field_definitions_data_key_global` (data_key nuevo). Documentado en el header de `0099`. **OK.**
- **Caps autoritativos server-side:** `circumference_cm numeric(4,1) CHECK 20–50`, `age_months CHECK 0–600 nullable`, `notes CHECK ≤500`. El caso (f) los ejerce (incluido los límites válidos 20.0/50.0 y `age_months` null = snapshot desconocido). **OK.**
- **Limpieza menor:** quité un `void clientD;` redundante (clientD se usa en el assert del tercero).

Verificación re-corrida tras los fixes: typecheck cliente VERDE; `schema.test.ts` + `upload-rejections.test.ts` 32/32 VERDES; `node --check` de la suite OK; balance SQL de las 3 migraciones OK.

## Reconciliación de specs
Sin divergencias del as-built respecto al diseño: §12.3/§12.4/§12.5 se **transcribieron fielmente** (DDL, triggers, RLS, gating, sync, schema.ts). No re-decidí seguridad (Gate 1 PASS). La única nota de entorno (el gotcha de soft-delete por cliente del caso h) NO es una divergencia del schema M6 — es una peculiaridad de PostgREST que vive igual en `weight_events`/`custom_measurements`; se documentó EN EL TEST, no requiere tocar `design.md` §12. tasks.md M6-B.1..B.5 quedan `[x]`. No toqué `requirements.md` (los EARS US-14 se cumplen tal cual).

## Verificación (qué quedó verde / qué queda rojo-hasta-apply)
**VERDE (verificable sin deploy):**
- typecheck cliente (`pnpm.cmd typecheck`) — 0 errores.
- `schema.test.ts` + `upload-rejections.test.ts` — 32/32 (incl. guard de 29 sincronizadas + 37 total + labels CE).
- `node --check` de `supabase/tests/scrotal/run.cjs` — sintaxis OK.
- balance SQL de `0098/0099/0100` (begin/commit, `$$`, paréntesis) — OK.

**ROJO-HASTA-APPLY (esperado, NO regresión):**
- `supabase/tests/scrotal/run.cjs` corre contra la DB remota → falla con `42P01`/no-such-relation hasta que el leader aplique `0098/0099/0100`. Por eso el hook en `run-tests.mjs` queda COMENTADO. NO es regresión: es el modelo de M5-BACKEND / M3.0-BACKEND.
- `node scripts/check.mjs` completo: la otra terminal puede dejarlo rojo por flake de rate-limit / spec-08 sin commitear (terminales paralelas). El delta M6-BACKEND no agrega suites activas al runner (el hook scrotal está comentado).

## Cabos para el leader (apply + deploy + descomentar hook)
1. **Aplicar al remoto** (Supabase MCP en modo escritura, con OK de Raf), EN ORDEN: `0098_scrotal_measurements.sql` → `0099_scrotal_data_key_and_seed.sql` → `0100_scrotal_gating.sql`. El orden importa (el data_key de 0099 debe existir antes de que el gating de 0100 / el seed lo referencien). — **HECHO (2026-06-18): 0098/0099/0100 aplicadas al remoto.**
2. **Deployar el YAML de PowerSync** (`sync-streams/rafaq.yaml` → dashboard → Validate → Deploy) — la stream `ev_scrotal_measurements` requiere que la tabla `scrotal_measurements` exista en el remoto (aplicar 0098 ANTES, o el Validate falla).
3. **Descomentar el hook** de `scripts/run-tests.mjs` (`run('Scrotal/CE suite (spec 03 M6)', ...)`) y correr `node scripts/check.mjs` → la suite scrotal debería quedar verde post-apply. — **HECHO (2026-06-18): hook DESCOMENTADO; la suite corre 12/12 VERDE contra el remoto (ver abajo).**
4. **Numeración final usada:** `0098/0099/0100` (re-confirmada contra el árbol + `git status` de migraciones sin cambios sin commitear).
5. Gate 2 (code) por sub-chunk sobre este delta backend (reviewer + security_analyzer modo `code`). — **PASS** (`progress/security_code_03-m6-backend.md`, 0 HIGH; 1 MEDIUM M6-CODE-01 + 1 LOW). M6-CODE-01 cerrado abajo.

## Cierre M6-B.5 post-apply (2026-06-18)
Las migraciones `0098/0099/0100` quedaron **aplicadas al remoto** → la suite `scrotal/run.cjs` pasó de "roja-hasta-apply" a corrible de verdad. Dos cosas de cierre:

### M6-CODE-01 (MEDIUM de Gate 2 code) — foldado
Gate 2 code marcó que el caso (b) de la suite afirmaba el anti-spoof de `establishment_id`/`recorded_by` SOLO en **INSERT**, sin assert de regresión del **UPDATE-path** (la rama UPDATE del trigger `scrotal_force_establishment_id`, cableado `before insert or update` en `0098` l.77-79, es la defensa que `0077` documenta como crítica para la frontera WAL). El código ya era correcto y el vector estaba doblemente cerrado (el `USING` de la policy UPDATE `is_owner_of OR recorded_by` + `animal_profile_id` inmutable) — faltaba el assert de regresión.

**Qué agregué** (`scrotal/run.cjs` (b), tras los asserts de INSERT): el owner (`userA`, que pasa el `USING is_owner_of`) intenta `UPDATE ... SET establishment_id = estB, circumference_cm = 37.0` sobre su propia fila. Verifico (i) que el UPDATE afecta 1 fila (la autorización del owner pasa), (ii) por `service_role` que `establishment_id` quedó en `estA` (re-derivado del perfil real, NO el spoof estB) y `circumference_cm` quedó en 37.0 (el UPDATE legítimo sí se aplicó). Uso un UPDATE de `circumference_cm` (no de `deleted_at`) para que la fila siga visible (`deleted_at` sigue null) y no chocar con el gotcha de PostgREST del soft-delete por cliente (mismo gotcha del caso (h)). Espejo del precedente `weight_events`/`0077`.

### Hook descomentado + suite VERDE
- Descomenté el hook `run('Scrotal/CE suite (spec 03 M6)', ...)` en `scripts/run-tests.mjs` (estaba COMENTADO esperando el apply) + actualicé el mensaje de SKIPPED para incluir Custom + Scrotal.
- Corrí `node --test supabase/tests/scrotal/run.cjs` contra el remoto (keys de `.env.local`, igual que las otras suites backend): **12/12 VERDE** (11 sub-tests a–i + cleanup, todos pass; tests=12, pass=12, fail=0, duración ~13s). Sin 42P01/no-such-relation → confirma que `0098/0099/0100` están aplicadas. El nuevo sub-assert de (b) pasa (el UPDATE-path re-fuerza `establishment_id`). Esta es la **confirmación empírica del no-bypass / gating capa 2 / RLS / fail-closed** sobre la DB ya aplicada.
- Ningún rojo. Sin ruido de terminales paralelas (la suite usa fixtures dedicados con `RUN_TAG` único + cleanup CASCADE; no toca `animals_tag_unique` ni datos ajenos).
