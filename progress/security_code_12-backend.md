# Gate 2 (modo code) — Backend feature 12 (importación masiva de rodeo)

**Veredicto: FAIL** — 1 HIGH a cerrar (tope de batch server-side ausente en el RPC, DoW/DoS).

> Run dedicado al BACKEND: `0073_import_log.sql`, `0074_import_rodeo_bulk_rpc.sql`, `supabase/tests/import/run.cjs`.
> baseline_commit: `ebec9d5dc2474aec10c1196ba3e52c775528c583`. Los 3 archivos son nuevos sin commitear (aparecen en `git status --porcelain`, el diff vs baseline da vacío porque nada se commiteó todavía). Reviewer aprobó antes (gate previo). Sentry `security-review` cargada + referencias `authorization.md` / `business-logic.md` / `error-handling.md`.
> **Consulta directa a la prod DB denegada por el clasificador** (correcto — yo reviso CÓDIGO, no prod). El veredicto se sostiene 100% sobre el código real en disco + la bitácora post-apply del implementer. NO requirió tocar el remoto.

---

## Los 5 controles de R9.4 — verificados en el código real (no en la spec)

| # | Control | Estado | Evidence |
|---|---|---|---|
| 1 | Re-valida `has_role_in` owner/vet ADENTRO | **OK** | `0074:87-99` — `is_owner_of(v_establishment_id) OR exists(... user_roles ur where ur.role='veterinarian' and ur.active=true)`. Columnas reales confirmadas contra `0003`/`0005`. `field_operator` no matchea ninguna rama → `raise exception ... 42501` (`0074:97`). |
| 2 | `rodeo_id ∈ establishment` derivado server-side | **OK** | `0074:74-82` — `select r.establishment_id ... from rodeos where id=p_rodeo_id and deleted_at is null`; si null → `raise ... 23503`. El est sale del rodeo, NO del payload. |
| 3 | `establishment_id`/`created_by`/`imported_by`/`species_id`/`system_id` server-side | **OK** | `0074:142-168` — el insert usa `v_species_id`/`v_establishment_id`/`p_rodeo_id` (derivados, líneas 74-75). `created_by` lo fuerza el trigger `0043` (`tg_force_created_by_auth_uid`, SIEMPRE sobreescribe). `imported_by` lo fuerza `0073:42-55` (en el log, que escribe el cliente). El RPC NO lee ninguno de esos campos de `v_row`. |
| 4 | `EXECUTE` revocado de `public`/`anon` + grant a `authenticated` | **OK** | `0074:200-201` `revoke all ... from public, anon` + `grant execute ... to authenticated`. Smoke-check fail-closed `0074:205-220` que ABORTA si `anon`/`public` quedaran EXECUTE-able. **Matiz deliberado confirmado**: el grant a `authenticated` es CORRECTO acá (lo llama el cliente directo); la seguridad la da la re-validación inline del control 1, no el grant. Difiere a propósito de `0072`/`0058` (service-role-only). No es finding. |
| 5 | CHECK `char_length` (`0070`) + unique enforçados ADENTRO del definer | **OK** | El `security definer` saltea SOLO la RLS, no CHECK/unique/triggers. `animals_tag_unique` (`0019:22`), `animal_profiles_idv_unique` (`0020:51`), `animals_tag_electronic_len_chk ≤64` (`0070:185`, NOT VALID igual enforça inserts nuevos). Import parcial por-fila `0074:107-180`: `when unique_violation` → skip+report. |

**Control 5 — el punto que pediste mirar con lupa (¿el `raise` de authz queda atrapado por `when others`?): NO.** El `raise exception` de authz (`0074:97-98`), el de rodeo-not-found (`0074:81`) y el de not-authenticated (`0074:69`) están TODOS **antes** del `for...loop` y por ende **fuera** del bloque `begin...exception` por-fila (que abre en `0074:107`). El `when others` (`0074:176`) solo envuelve el cuerpo de CADA iteración — no puede tragarse un control de authz que corre antes del loop. Authz falla cerrado (aborta el RPC entero). Verificado línea por línea.

**Sub-matiz del `when others` por-fila**: los triggers de seguridad que disparan dentro del insert de cada fila (rodeo_check `0021:25`, category_check `0021:46`, management_group∈est `0037:36`) SÍ son atrapados por el `when others` — pero eso es correcto: una fila con un `management_group_id` de otro tenant simplemente cae como error de fila y NO se escribe (cero leak, cero cross-tenant write). El `when others` se traga el ERROR de la fila mala, no un control de authz del RPC. No es un fail-open: la fila no entra.

---

## import_log (`0073`)

| Chequeo | Estado | Evidence |
|---|---|---|
| RLS scopea (outsider no ve/escribe) | **OK** | `0073:60-61` SELECT `has_role_in(establishment_id)`; `0073:68-81` INSERT con `has_role_in AND (is_owner_of OR vet inline)`. Tests `run.cjs:269-287` (outsider no ve ni inserta cross-tenant). |
| Trigger `imported_by` no-spoofeable | **OK** | `0073:42-55` SIEMPRE sobreescribe `new.imported_by := auth.uid()` (no "solo si NULL"). Test `run.cjs:212-235` manda `imported_by=outsider.id` → persiste `ownerA.id`. |
| INSERT restringido a owner/vet | **OK** | `0073:68-81`. `field_operator` rechazado (`run.cjs:250-266`, adversarial: la fila no queda). |
| CHECKs de tamaño | **OK** | `0073:28` `char_length(file_name)≤255`; `0073:31` `octet_length(error_details::text)≤262144` (256 KiB). Tests `run.cjs:290-328`. |

---

## Extras del prompt

- **SEC-HIGH-01 recurrence (¿otro helper expuesto como RPC ejecutable por authenticated/anon?)**: **NO**. El único `create function` en `0073` es el trigger `tg_force_imported_by_auth_uid()` (`0073:42`) — es un trigger, NO invocable como RPC vía PostgREST, y NO es SECURITY DEFINER (corre como invocador). El único SECURITY DEFINER nuevo es `import_rodeo_bulk`, blindado con revoke+smoke-check. Sin recurrence.

- **`import_log.rodeo_id` sin trigger `rodeo∈establishment` (el implementer lo marcó deliberado)**: **ACEPTABLE — no es finding.** Evidence: `0073:19` la FK es `rodeo_id references rodeos(id)` sin cross-check de est. La policy de INSERT (`0073:68-81`) ya scopea el `establishment_id` del log al tenant del caller (owner/vet de ESE est). Lo único que un usuario puede corromper es **su propia** metadata de audit (poner un `rodeo_id` de otro tenant en SU PROPIO log) — no leakea datos de otro tenant, no escribe cross-tenant, no afecta la autorización (el `rodeo_id` del log no es load-bearing para authz; el control de escritura real vive en el RPC, que SÍ deriva el est del rodeo). Alineado al patrón `lab_samples`. El impacto es nulo fuera del propio tenant. Si se quisiera atar, sería un trigger nuevo fuera de scope; no lo amerita.

---

## FINDING HIGH

### [SEC-12B-HIGH-01] Batch-size sin tope server-side en `import_rodeo_bulk` → DoW/DoS de DB (amplificación)

- **Severidad**: HIGH (Denial-of-Wallet / DoS; dominio E1/E2 del catálogo RAFAQ + R3.2/R3.3 de la propia spec).
- **Confidence**: High.
- **Location**: `supabase/migrations/0074_import_rodeo_bulk_rpc.sql:104`.
- **Evidence**:
  ```sql
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    ...  -- 2 inserts (animals + animal_profiles) + N triggers por fila
  end loop;
  ```
  No hay ningún `jsonb_array_length(p_rows)` chequeado antes del loop. El RPC itera **todos** los elementos de `p_rows` sin cap.
- **Por qué es attacker-controlled**: `p_rows` viene del cliente Expo (`POST /rest/v1/rpc/import_rodeo_bulk`), que es attacker-controlled (cualquier owner/vet autenticado pega directo al endpoint con curl, sin pasar por el parser/cap del cliente). El grant es a `authenticated`, así que CUALQUIER owner/vet de CUALQUIER establecimiento puede llamarlo.
- **Impacto**: un solo request con `p_rows` de 10^5–10^6 filas dispara 2×N inserts + (identity/rodeo/category/management_group/species) triggers por fila en **una sola transacción, una sola conexión**. Esto: (a) corre la transacción por minutos/horas tomando locks y consumiendo una conexión del pool (Supabase tiene pool chico) → self-DoS de la DB para el resto de los tenants; (b) acumula `v_errors` jsonb sin tope en memoria del backend si todas fallan; (c) es exactamente el "vector de amplificación" que el prompt pide cazar y que **E2/Denial-of-Wallet** del catálogo mide por COSTO, no por frecuencia. El cap del cliente (R3.2 = 5000 filas, R3.3 = cap durante el parseo) es **UX/attacker-controlled** y se bypassea pegando al RPC directo — NO es la capa autoritativa. La propia spec R9.5 dice que la DB es la capa autoritativa final; acá la DB no tiene el cap.
- **Spec gap**: R3.2 ("tope máximo de filas por corrida, default 5000") y R3.3 ("cap ANTES de materializar") están escritas como controles de CLIENTE. El RPC `SECURITY DEFINER` es la frontera server-side real y **no** replica ese tope. Es el mismo patrón de lección que A1-1/INPUT-1: el cap del cliente no cuenta como control de seguridad.
- **Fix concreto** (en `0074`, agregar inmediatamente después de la re-validación de rol, antes del `for...loop` ~línea 100):
  ```sql
  -- Tope DURO de filas por llamada (capa autoritativa server-side, espejo de R3.2).
  -- El cap del cliente es UX/bypasseable; este es el que enforce contra DoW/amplificación.
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 5000 then
    raise exception 'batch too large: % rows (max 5000 per call)',
      jsonb_array_length(p_rows) using errcode = '22023';
  end if;
  ```
  (Valor 5000 = el mismo de R3.2; si el cliente chunkea, el chunk debe respetar el mismo tope.)
- **Re-aplicar al remoto**: **SÍ.** El RPC ya está aplicado (HTTP 201, bitácora `0074` líneas 35-36). El fix es un `create or replace function` de `import_rodeo_bulk` con la guarda agregada → re-aplicar la migración corregida al remoto (mismo mecanismo Management API que usó el implementer). Sumar un test en `run.cjs`: `p_rows` con 5001 filas → rechazado con el errcode/mensaje; 5000 → pasa.

---

## La suite de tests `run.cjs` — ¿ejercita los bypasses o pasa por la razón equivocada?

**Ejercita los bypasses de verdad.** Verificación punto por punto:
- **field_operator (RPC)** `run.cjs:402-416`: no solo asserta el error, también consulta con `admin` (service_role) que NO quedó perfil escrito (`run.cjs:410-415`). Adversarial real.
- **cross-tenant (rol solo en otro est)** `run.cjs:419-426` y **rodeo de otro est** `run.cjs:430-443`: el segundo verifica con `admin` que `rodeoB` no recibió el perfil. Real.
- **imported_by forzado** `run.cjs:212-235`: manda `outsider.id` en el payload y asserta que persiste `ownerA.id` Y `notEqual(outsider.id)`. Real.
- **anon** `run.cjs:455-464`: cliente anon → error. Real.
- **import parcial (TAG dup)** `run.cjs:467-496`: asserta `imported_ok=2`, `imported_errors=1`, el `row_index` correcto, Y con `admin` que el TAG existe exactamente 1 vez + la 3ra fila (sin TAG) entró. No pasa por carambola.
- **TAG>64 dentro del definer** `run.cjs:500-514`: asserta que la fila larga cae como error de fila y la otra entra. Cubre el control 5.
- **CHECKs de import_log** `run.cjs:290-328`: error_details>256KB rechazado + sanity de que uno chico SÍ entra (no es falso positivo del CHECK).

**Gap de cobertura de la suite (no es finding bloqueante por sí mismo, pero refuerza el HIGH)**: NO hay test que ejercite el batch-size (un `p_rows` grande). Coherente — porque el control no existe. Al aplicar el fix, agregar el test.

**Cobertura indirecta**: la skill de Sentry NO razona sobre PL/pgSQL `SECURITY DEFINER` / RLS-bypass / grants de Postgres ni sobre el cap de un loop server-side de DB — todo el análisis de los 5 controles + el HIGH de batch-size es **revisión manual RAFAQ-specific** (SQL semantics), no salida de la skill. La skill se usó como framework (authorization/business-logic/error-handling) pero el hallazgo es manual.

---

## Tabla de inputs (campos del RPC que vienen del cliente, vía `p_rows`)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| `p_rows` (tamaño del array) | **ninguno** | **ausente server-side** (cap solo en cliente R3.2/R3.3, bypasseable) | **NO → HIGH-01** |
| `p_rodeo_id` | FK + deriva est | server (`0074:74-82`, rodeo∈DB o reject) | OK |
| `row.sex` | enum male/female | server (CHECK `0019:11`) | OK |
| `row.tag_electronic` | ≤64 + unique global | server (`0070:185` + `0019:22`) | OK |
| `row.idv` | ≤64 + unique/est | server (`0070:188` + `0020:51`) | OK |
| `row.visual_id_alt` | ≤64 | server (`0070:190`) | OK |
| `row.breed` | ≤64 | server (`0070:192`) | OK |
| `row.birth_date` | date | server (cast `::date`, falla de fila si inválido) | OK |
| `row.category_code` | resuelto contra catálogo del system del rodeo | server (`0074:118-137`, no se confía como `category_id`) | OK |
| `row.category_override` | forzado a false sin match | server (`0074:124-125`) | OK |
| `row.management_group_id` | ∈est | server (trigger `0037:36`) | OK |
| `establishment_id`/`created_by`/`imported_by`/`species_id`/`system_id` | N/A | **no se leen del payload** (server-side) | OK |

---

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `import_rodeo_bulk` (RPC bulk) | **no** (frecuencia) + **no** (tamaño batch) | n/a | n/a | Frecuencia: R3.7 lo difiere a backlog conscientemente (op de oficina, mismo-tenant) → **aceptable**. Tamaño-batch: **NO aceptable → HIGH-01** (el N por request es amplificación, distinto de la frecuencia). |
| INSERT `import_log` | n.a. | per-est (RLS) | sí | Es un audit row por corrida, no abusable a escala. CHECKs de tamaño cubren el blob. |

---

## Archivos analizados

- `supabase/migrations/0073_import_log.sql` (tabla + RLS + trigger + CHECKs) — PASS.
- `supabase/migrations/0074_import_rodeo_bulk_rpc.sql` (RPC SECURITY DEFINER) — **1 HIGH** (batch-size).
- `supabase/tests/import/run.cjs` (suite 22 tests) — ejercita los bypasses correctamente; falta test de batch-size.
- Referencia as-built confirmada: `0003`, `0005`, `0019`, `0020`, `0021`, `0037`, `0043`, `0070`, `0072`.
- Spec: `requirements.md` (R9.4/R3.2/R3.3/R9.5), `design.md` §1.2.

## False positives descartados

- **Grant a `authenticated` del RPC** — no es finding (matiz deliberado, control 4, confirmado vs `0072`/`0058`).
- **`when others` por-fila tragándose authz** — descartado: el authz corre antes del loop, fuera del bloque de excepción.
- **`import_log.rodeo_id` sin cross-check de est** — descartado: solo corrompe metadata del propio tenant, no leakea ni escribe cross-tenant.
- **`when others` tragándose triggers de seguridad por fila** — no es fail-open: la fila mala simplemente no se escribe (skip+report), cero cross-tenant.

---

## Cierre

4 de 5 controles de R9.4 + RLS de `import_log` + no-recurrence de SEC-HIGH-01 + suite adversarial: **sólidos**. El único hueco es el **tope de batch server-side ausente** (HIGH-01): el RPC `SECURITY DEFINER`, que es la frontera server-side real, no replica el cap de R3.2 que vive solo en el cliente (bypasseable). Es DoW/amplificación explotable por cualquier owner/vet autenticado vía curl. Fix de 4 líneas + 1 test + re-aplicar al remoto. **FAIL hasta cerrarlo.**
