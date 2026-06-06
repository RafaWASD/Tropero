baseline_commit: ebec9d5dc2474aec10c1196ba3e52c775528c583

# Impl 12 — BACKEND (Fase 2, T2.1-T2.5) — Importación masiva de rodeo

> Run dedicado al BACKEND (Escenario B aprobado en Puerta 1: RPC `SECURITY DEFINER` de bulk-insert).
> NO toca el cliente/UI (otro run lo hace). NO toca `scripts/run-tests.mjs` (el leader engancha la suite).

## Plan (tasks de esta fase) — TODAS COMPLETADAS

- [x] T2.1 — Migration `0073_import_log.sql`: tabla `import_log` + enum `import_file_format` + índice por est + trigger `tg_force_imported_by_auth_uid` + CHECK file_name≤255 + CHECK error_details≤256KB.
- [x] T2.2 — (misma migration 0073): RLS de `import_log` — SELECT `has_role_in`; INSERT `has_role_in AND (is_owner_of OR vet inline)` + grants `select,insert` a authenticated.
- [x] T2.3 — Migration `0074_import_rodeo_bulk_rpc.sql`: RPC `import_rodeo_bulk(p_rodeo_id, p_rows jsonb)` SECURITY DEFINER con los 5 controles obligatorios + import parcial por-fila + smoke-check fail-closed de grants.
- [x] T2.4 — Suite `supabase/tests/import/run.cjs`: 8 tests de `import_log`.
- [x] T2.5 — (misma suite): 10 tests del RPC.

**Suite: 25/25 verde** (`node --test supabase/tests/import/run.cjs` — eran 22/22; +3 tests del cap server-side en el fix-loop de Gate 2, ver sección FIX-LOOP abajo). `node scripts/check.mjs` verde end-to-end (sin regresión).

## Verificación del as-built (antes de escribir SQL — todo confirmado contra migraciones reales)

- `0005_rls_helpers.sql`: solo `has_role_in(est)` + `is_owner_of(est)`, ambos `security definer stable set search_path=public`, EXECUTE revocado de public. NO existe `has_role(role,est)` genérico. → el predicado `veterinarian` se chequea inline contra `user_roles`.
- `0003_user_roles.sql`: `user_roles (user_id, establishment_id, role user_role, active)`. enum `user_role` = owner|field_operator|veterinarian. unique-activo por `(user_id, establishment_id) where active`.
- `0043_animal_profiles_created_by.sql`: `tg_force_created_by_auth_uid()` SIEMPRE sobreescribe `created_by := auth.uid()` (BEFORE INSERT en animal_profiles). Reuso el mismo patrón para `imported_by`.
- `0019_animals.sql`: `animals (id, tag_electronic, species_id, sex CHECK in male/female, birth_date)`. `animals_tag_unique` global parcial. `tg_animals_validate_species` (species activa). RLS en 0022 (`animals_insert with check auth.uid() is not null`).
- `0020_animal_profiles.sql`: `animal_profiles (id, animal_id, establishment_id, rodeo_id, idv, visual_id_alt, category_id NOT NULL, category_override, breed, ..., status, created_by[0043], management_group_id[0037])`. `animal_profiles_idv_unique (establishment_id, idv)` parcial. `animal_profiles_active_animal_unique (animal_id) where status=active`.
- `0021_animal_profiles_validations.sql`: triggers BEFORE INSERT: identity_check (≥1 id), rodeo_check (rodeo∈est + activo), category_check (category∈system del rodeo). Todos enforçados a nivel DB → el RPC NO los bypassa (corre como definer pero los triggers igual disparan).
- `0070`: CHECK char_length idv/visual/breed/coat≤64, tag_electronic≤64 (NOT VALID, igual enforça inserts nuevos), entry_origin≤120, notes≤4000.
- `0062_compute_category_rewrite.sql` + `0063`: el recálculo de categoría dispara SOLO en triggers de `reproductive_events` (insert/update/delete), NO en INSERT de `animal_profiles`. → el placeholder de categoría del import NO se repinta al insertar (nota (b) del leader resuelta: no hay riesgo).
- `0058_delete_account_rpc.sql`: patrón RPC SECURITY DEFINER + smoke-check fail-closed de grants. Reuso el smoke-check, pero el grant es a `authenticated` (lo llama el cliente directo), no service_role.
- `0015`+`0059`: catálogo `categories_by_system` (bovino,cria) tiene los 12 codes incl. novillo/novillito.

## Bitácora de aplicación al remoto

Vía Management API (`POST /v1/projects/<ref>/database/query`, `SUPABASE_ACCESS_TOKEN` de `.env.local`, envuelto en `BEGIN/COMMIT`). NO se usó `supabase db push`. Script temporal `scripts/_apply-migration.mjs` (ya BORRADO).

- `0073_import_log.sql` → HTTP 201 OK.
- `0074_import_rodeo_bulk_rpc.sql` → HTTP 201 OK (incluye el smoke-check fail-closed de grants, que pasó — el RAISE NOTICE confirma `revoked from anon/public, granted to authenticated`).

Verificación post-apply (query directa al remoto):
- `import_log` policies: `import_log_select` (SELECT), `import_log_insert` (INSERT). RLS enabled.
- `import_log` grants a `authenticated`: SELECT + INSERT (NO update/delete → append-only). `service_role`: all.
- `anon` sobre `import_log`: solo REFERENCES/TRIGGER/TRUNCATE (defaults inocuos de PostgREST; NO SELECT/INSERT).
- RPC `import_rodeo_bulk` EXECUTE: `authenticated`=true, `anon`=false, `public`=false, `service_role`=false. Correcto (lo llama el cliente directo; la seguridad la da la re-validación de rol adentro, no el grant).
- Trigger `import_log_set_imported_by` presente.

## Mapa R<n> → archivo:test

| R<n> | Cubierto por |
|---|---|
| R11.1 (import_log: columnas + corridas 0-escritas) | `0073_import_log.sql` (tabla) ; test indirecto en inserts de la suite |
| R11.2 (RLS scoped por est; SELECT has_role_in) | `0073` policy `import_log_select` ; `run.cjs` "outsider sin rol NO ve" + "outsider NO inserta cross-tenant" |
| R11.3 (imported_by forzado = auth.uid()) | `0073` trigger `tg_force_imported_by_auth_uid` ; `run.cjs` "imported_by se fuerza (ignora el payload)" |
| R11.4 (CHECK octet_length error_details + char_length file_name) | `0073` constraints ; `run.cjs` "error_details > 256KB rechazado" + "file_name > 255 rechazado" |
| R2.4 (solo owner/vet importan; field_operator NO) | `0073` policy `import_log_insert` (inline vet) + `0074` re-validación inline en el RPC ; `run.cjs` "field_operator NO inserta import_log" + "field_operator → RECHAZADO (RPC)" + "vet SÍ" |
| R9.1 (establishment_id forzado, no del archivo) | `0074` deriva est del rodeo ; `run.cjs` "establishment_id debe ser el del rodeo" + PROBE 2 (autorrevisión) |
| R9.2 (rodeo∈est; no cross-tenant) | `0074` deriva est del rodeo + re-valida rol en ESE est ; trigger `rodeo_check` (0021) ; `run.cjs` "p_rodeo_id de otro est → RECHAZADO" + "rol solo en otro est → RECHAZADO" |
| R9.3 (created_by/imported_by = auth.uid()) | trigger 0043 (created_by) + 0073 (imported_by) ; `run.cjs` "created_by debe ser el caller" |
| R9.4 (RPC SECURITY DEFINER, 6 controles) | `0074` completo ; `run.cjs` bloque RPC (owner/vet inserta, field_operator/otro-est/rodeo-ajeno/rodeo-inexistente/anon rechazados, EXECUTE revocado) |
| R9.4-d / R3.2 (tope DURO de filas server-side — SEC-12B-HIGH-01) | `0074` guarda `jsonb_array_length > 5000` post-authz/pre-loop ; `run.cjs` "batch > 5000 → RECHAZADO entero (nada insertado)" + "field_operator >5000 → authz primero" + "exactamente 5000 → procesa (borde)" |
| R9.5 (CHECK 0070 + unique como capa final, enforça dentro del definer) | `run.cjs` "TAG > 64 → error de fila (CHECK 0070)" + "TAG duplicado en batch → skip" |
| R8.1 (escritura animals+profiles por fila) | `0074` (2 inserts/fila) ; `run.cjs` "owner importa 2 filas → inserta animals+profiles" |
| R8.2/R8.4 (import parcial; carrera unique se saltea, no aborta) | `0074` bloque begin...exception por fila ; `run.cjs` "TAG duplicado → esa se saltea, el resto entra" |
| R10.3/R10.5 (category override vs placeholder por sexo) | `0074` resolución category_code→placeholder ; PROBE 4/5 (autorrevisión): override=false forzado sin match, =true respetado con match |

## Desviaciones / decisiones del implementer

1. **Contrato de `p_rows` definido por el implementer** (la spec no fija el shape exacto del jsonb). Cada fila lleva `row_index` (para reportar fallos por fila al cliente), `sex`, `tag_electronic`, `birth_date`, `idv`, `visual_id_alt`, `breed`, `category_code`, `category_override`, `management_group_id`. **NO** lleva (ni el RPC lee) `establishment_id`/`created_by`/`imported_by`/`species_id`/`system_id`/`rodeo_id` — todo server-side desde el rodeo. El run del cliente (T3.3) debe armar este shape. Documentado en el header de `0074`.
2. **Placeholder de categoría (D3 interino)**: el RPC resuelve `category_code` contra el system del rodeo; sin match (o sin code) cae al default por sexo (`torito` machos / `vaquillona` hembras) con `category_override = false` FORZADO server-side (un payload no puede falsear el override del placeholder). Cuando Raf cierre D3 con Facundo se ajusta solo este bloque (no reabre spec).
3. **El RPC NO inserta el `import_log`** — eso es del cliente (T3.4, otro run). El RPC solo escribe `animals`+`animal_profiles` y devuelve los conteos. El bloqueo owner/vet vive en DOS lugares: el RPC (escritura de animales) y la policy de `import_log` (audit). Coherente con el diseño.
4. **`import_log.rodeo_id` no tiene trigger de `rodeo∈establishment_id`** (igual que el design §2.2 SQL, que no lo agrega). Es metadata de audit, no load-bearing para authz, scopeada al propio tenant por la policy de INSERT. Un usuario podría poner un `rodeo_id` de otro tenant en SU PROPIO log (corrompe solo su metadata de audit, no leakea ni escribe cross-tenant). Decisión consciente, alineada al patrón `lab_samples` (audit sin cross-check de metadata). **Para el reviewer**: si se quiere atar `import_log.rodeo_id ∈ establishment_id`, sería un trigger nuevo — fuera del scope aprobado; anotarlo si preocupa.

## Autorrevisión adversarial (paso 8)

Busqué activamente bypasses probando contra el remoto con JWTs reales (sonda `_adversarial-probe.cjs`, ya borrada). Resultados:

- **¿field_operator puede colarse?** NO. Bloqueado en la policy de `import_log` (no es owner/vet → with_check falla) Y en el RPC (re-validación inline → `raise exception`). Test + verificación adversarial (la fila no queda escrita).
- **¿El payload puede spoofear establishment/autoría?** NO. PROBE 2: mandé `establishment_id=estB`, `created_by/imported_by=ownerB`, `species_id/system_id` random y `rodeo_id=rB` en el payload → el perfil escrito quedó con `establishment_id=estA`, `rodeo_id=rA`, `created_by=ownerA`. Todo derivado del rodeo/auth.uid(), nada del payload.
- **¿management_group cross-tenant?** NO. PROBE 1: metí el `management_group_id` de estB en un import a rodeoA → esa fila cae como error (trigger 0037 `belongs to a different establishment`), el resto entra, cero leak.
- **¿vet INACTIVO entra?** NO. PROBE 3: `user_roles` con `active=false` → rechazado (el predicado exige `active=true`).
- **¿override spoofeado?** NO. PROBE 4: `category_code` inexistente + `category_override:true` → el RPC fuerza `override=false` y usa el placeholder por sexo. PROBE 5: code legítimo + override true → respetado.
- **¿El RPC leakea data de otro tenant?** NO. Solo devuelve conteos + `row_index` + `reason` (sin datos de filas ni de otros tenants).
- **¿El import parcial realmente no aborta el chunk?** SÍ funciona: TAG duplicado en el batch → solo esa fila se saltea (bloque `begin...exception when unique_violation`), las otras entran. Verificado que el TAG existe 1 sola vez y la 3ra fila (sin TAG) entró.
- **¿CHECK 0070 enforça dentro del SECURITY DEFINER?** SÍ. TAG > 64 chars → error de fila (el definer saltea RLS, NO los CHECK/unique/triggers). MEDIUM-1 de Gate 1 cubierto.
- **¿anon puede llamar el RPC?** NO. EXECUTE revocado de anon/public (smoke-check fail-closed en la migración + test).

**Cierre**: no encontré huecos. Lo único anotado (no es bug): la metadata `import_log.rodeo_id` sin cross-check de est (punto 4 arriba), consciente y alineado al patrón de audit existente.

## Para el reviewer / Gate 2

- **Gate 2 debe verificar**: (a) el RPC es `SECURITY DEFINER set search_path=public`; (b) los 5 controles de R9.4 (re-valida owner/vet inline, deriva est del rodeo, fuerza campos server-side, EXECUTE revocado de public/anon con grant a authenticated, enforça CHECK/unique adentro); (c) el smoke-check fail-closed de grants (estilo 0055/0058) está en `0074`; (d) `imported_by` forzado por trigger (no del payload).
- **Diferencia DELIBERADA con 0058**: `0058` revoca EXECUTE de `authenticated` (lo llama un edge con service_role). `0074` lo llama el CLIENTE directo → `grant execute to authenticated` (NO service_role-only). Documentado en el header de la migración para que no se marque como error (nota explícita del Gate 1).
- **NO toqué `scripts/run-tests.mjs`** (el leader engancha la suite `import` después — evita colisión con el run paralelo de utils). La suite corre standalone con `node --test supabase/tests/import/run.cjs`.
- **NO toqué el cliente/UI** (Fases 1, 3, 4, 5 de `tasks.md` — otro run).

---

## FIX-LOOP Gate 2 (code) — 2026-06-06

Gate 2 (modo code) sobre el BACKEND devolvió **FAIL con 1 HIGH** (`progress/security_code_12-backend.md`). Cerrado + hardening de la suite.

### A — SEC-12B-HIGH-01 (batch-size sin tope server-side) — CERRADO

- **Qué era**: `import_rodeo_bulk` iteraba `p_rows` SIN tope server-side. El cap de 5000 filas (R3.2) vivía solo en el cliente Expo (bypasseable con curl) → un owner/vet autenticado podía mandar 10⁶ filas vía `POST /rest/v1/rpc/import_rodeo_bulk` → self-DoS / DoW (amplificación por request). El RPC `SECURITY DEFINER` es la frontera server-side real y no replicaba el cap.
- **Fix** (`0074_import_rodeo_bulk_rpc.sql`, líneas ~101-110): guarda `if jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 5000 then raise exception ... using errcode='22023'; end if;`, colocada **DESPUÉS de la re-validación de rol owner/vet** (un caller sin rol ya fue rechazado antes, sin evaluar el tamaño) y **ANTES del loop** (no se procesa ni una fila). Rechaza el **batch ENTERO** (no skip-and-report) — un batch >5000 es un límite de input duro como R3.1/R3.2, no "filas malas que se saltean". Valor 5000 = espejo de R3.2/D4 (comentario atándolo en el SQL). Fuera del bloque `begin...exception` por-fila → aborta el RPC entero, no se traga el error.
- **Re-aplicado al remoto**: SÍ, vía Management API (`POST /v1/projects/<ref>/database/query`, `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` de `.env.local`, envuelto en `BEGIN/COMMIT`). Re-apliqué el archivo `0074` ENTERO (idempotente: `CREATE OR REPLACE FUNCTION` + revoke/grant + smoke-check fail-closed + `notify pgrst`) → HTTP 201 OK. El smoke-check fail-closed de grants volvió a pasar. Script temporal `scripts/_apply-migration-0074-fix.mjs` (ya BORRADO).
- **Tests nuevos** en `run.cjs` (3, suite 22 → 25):
  - `batch > 5000 filas → RECHAZADO entero`: 5001 filas mínimas (`{row_index, sex, visual_id_alt}` con prefijo `${RUN_TAG}_cap`) → `error != null`, `data == null`, mensaje matchea `/batch|max|5000|exceeds/`. **Adversarial**: con `admin` verifica que NINGUNA de las 5001 filas se insertó (rechazo antes del loop, no parcial).
  - `field_operator con batch > 5000 → rechazado por AUTHZ (cap es posterior)`: confirma el ORDEN — el field_operator se rechaza por rol (mensaje `/owner|veterinarian|not/`, NO `/exceeds|max rows/`), probando que el authz corre ANTES del cap (no se filtra info de tamaño a un caller no autorizado).
  - `batch de exactamente 5000 filas SÍ se procesa (borde)`: 5000 filas → `imported_ok == 5000`, sin errores. Evita un off-by-one que volviera el cap más restrictivo que R3.2 (el cap es `> 5000`, no `>= 5000`).

### B — Hardening anti-transitorio de la suite (no bloqueante)

En un run de `node scripts/check.mjs` (pipeline completo, remoto compartido con otras suites) el setup del RPC-suite flakeó: creó establishments/roles pero `rodeoA` quedó `undefined` → los tests del RPC cayeron con "función inexistente" (el param `p_rodeo_id` undefined se dropea del JSON de PostgREST). Standalone pasaba 22/22 y el reviewer lo vio verde → transitorio (deadlock/timeout 40P01 bajo carga concurrente, mismo patrón que `supabase/tests/maneuvers/run.cjs`).

- **Retry-con-backoff** (`setupWithRetry`, mirroreado de `maneuvers/run.cjs:writeWithRetry`): envuelve las ops de setup propensas a transitorios (creación de establishments/roles/rodeos + el delete de cleanup). Reintenta SOLO errores realmente transitorios (`40001`/`40P01`/`57014`/`08006`/`08003`/`53300`/`57P01` + match de mensaje `deadlock|timeout|connection`). Un error determinista (RLS 42501, unique, etc.) se devuelve/lanza tal cual — NO se enmascara un bug real reintentando algo que nunca va a pasar (lección de higiene de diagnóstico documentada en `maneuvers/run.cjs:265`). Backoff corto, 4 intentos.
- **Fixtures únicos por corrida**: ya existía `RUN_TAG = import_test_<timestamp>_<random>` como prefijo de TODOS los fixtures (emails, nombres de establishment); le agregué el prefijo a los nombres de rodeo (`${RUN_TAG} Rodeo A/B/principal`, antes eran fijos `Rodeo A`/`Rodeo B`/`Rodeo principal`) para que no colisionen con otras suites del pipeline ni con corridas previas no-limpiadas.
- **Fail loud**: asserts explícitos al final de cada setup (`assert.ok(estA && rodeoA, ...)` / `assert.ok(estB && rodeoB, ...)`) + dentro de `createEstablishmentAs`/`createRodeo` (`assert.ok(data && data.id, ...)`). Si un fixture queda undefined, la suite falla RUIDOSO ahí mismo, en vez de cascadear "función inexistente" en cada test.

### Verificación del fix-loop

- `node --test supabase/tests/import/run.cjs` → **25/25 verde** standalone.
- `node scripts/check.mjs` end-to-end → **VERDE** ("All tests passed" / "Entorno listo"). La suite import corrió 25/25 DENTRO del pipeline completo (con el hardening anti-transitorio activo, sin flakear). Sin WARN/transient enmascarado en el output.

### Autorrevisión adversarial del fix

- **¿La guarda corre ANTES del loop y DESPUÉS del authz?** SÍ. Orden en `0074`: not-authenticated (68) → rodeo-not-found (80) → authz owner/vet (87-99) → **cap (107-110)** → loop (112). Un anon (EXECUTE revocado) ni llega; un field_operator se rechaza por rol antes del cap (test dedicado lo prueba con el mensaje de authz, no el del cap).
- **¿Rechaza el batch entero sin insertar nada?** SÍ. La guarda está FUERA del bloque `begin...exception` por-fila → `raise exception` aborta el RPC entero (rollback de la transacción del RPC). Test adversarial confirma 0 filas escritas de las 5001.
- **¿El retry de setup enmascara un error real?** NO. Solo reintenta códigos/mensajes transitorios; un error determinista (RLS, unique, FK) se propaga tal cual (lección `maneuvers:265`). Los asserts fail-loud cazan el caso de fixture undefined que el retry no resuelva.

### Reconciliación de specs (regla dura)

- `requirements.md` **R9.4**: agregado el control **(d)** = tope DURO de filas server-side (5 → 6 controles).
- `requirements.md` **R3.2/R3.3**: nota de que el tope de 5000 se enforça **también server-side en el RPC** (cliente = UX, DB/RPC = capa autoritativa, consistente con R9.5).
- `design.md` §6 (Escenario B): agregado el 6to control a la lista numerada + "5 controles" → "6 controles" en la decisión de Puerta 1.
