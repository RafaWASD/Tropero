# Security Code Review (Gate 2, ADR-019) — spec 03 M3.2b

**Modo**: `code` · **Skill**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability aplicada) · **Fecha**: 2026-06-15

## VEREDICTO: **PASS**

Sin findings HIGH-confidence. El write-path de las 5 pantallas (sanitarias silent_apply + sangrado + raspado + pesaje ternero + inseminación) usa SQL parametrizado con whitelist explícita de columnas, no manda `created_by`/`establishment_id` (los fuerza el server), y toda la autorización real (RLS + tenant-check de `session_id` + gating capa 2) vive server-side. La migración 0091 es fail-closed, `SECURITY DEFINER` + `search_path=public` + `EXECUTE` revocado. Cero secretos, cero hardcode de tenant.

---

## Baseline y alcance

- `baseline_commit` (de `progress/impl_03-m3.2b.md` l.1): `638679fa61672e884fc75b3ae94a855bf9853642`.
- `git diff --name-only <baseline>..HEAD` da **vacío** y `main...HEAD` también: la feature 03 entera vive en cambios **sin commitear** (untracked + modified), confirmado con `git status --porcelain`. No hay rama; trabajamos sobre `main`. Por eso revisé los **archivos completos del scope** (no un diff), acotado a M3.2b.
- Archivos analizados (scope declarado): ver § Archivos analizados.

---

## Foco obligatorio — resultado por punto

### 1. Writes de evento (`session_id`, `created_by`, tenant) — OK

Tracé el data flow completo cliente→DB de cada write:

- **Builders** (`local-reads.ts` l.1315–1510): los 6 builders de M3.2b (`buildAddManeuverSanitaryInsert`, `buildUpdateManeuverSanitary`, `buildAddManeuverVaccinationInsert`, `buildAddManeuverLabSampleInsert`, `buildUpdateManeuverLabSample`, `buildAddManeuverInseminationInsert`/`buildUpdateManeuverInsemination`) usan **SQL parametrizado** (`?`) con **whitelist explícita de columnas**. Ninguno incluye `created_by` ni `establishment_id` en la lista de columnas. El `event_type`/`service_type`/`sample_type` están **hardcodeados en el SQL** (`'vaccination'`, `'service'`, `'ai'`) o llegan de un set cerrado derivado por la maniobra (no del usuario).
- **`created_by` forzado server-side**: el cliente NO lo manda → el trigger `tg_set_created_by_auth_uid` (0024) lo setea a `auth.uid()`. Verifiqué que NO es spoofeable de forma explotable: aunque un cliente manipulado mandara un `created_by` arbitrario (el trigger solo lo sobreescribe `if new.created_by is null`), la **RLS de INSERT** de `sanitary_events`/`lab_samples`/`reproductive_events` es `with check (has_role_in(establishment_of_profile(animal_profile_id)))` (0027 l.38-39, 0029 l.36-37) — la autorización se basa en el establishment **derivado del `animal_profile_id`**, no en `created_by`. Un `created_by` falso no abre nada.
- **`session_id` no spoofeable cross-tenant**: el trigger `tg_event_session_tenant_check` corre `BEFORE INSERT` Y `BEFORE UPDATE OF session_id` en las 5 tablas de evento (0056 — fix del bug de 0052 donde el trigger combinado no disparaba en INSERT). Cubre `sanitary_events`, `reproductive_events`, `lab_samples` (las 3 que toca M3.2b). Un `session_id` de otra sesión/rodeo/tenant → rechazo al subir.
- **establishment/rodeo derivados del animal**: nunca se hardcodea ni se manda `establishment_id`; lo deriva el server del perfil (`establishment_of_profile`). Anti-hardcode lint verde (impl l.207).

### 2. Inputs con cota server-side (tu mandato) — OK, cota autoritativa es server-side

Verifiqué que la cota autoritativa de cada input de texto libre es **el CHECK de DB (0070)**, no el `maxLength` del TextInput:

| Campo | Origen UI | Cap cliente (UX) | **Cap server-side (autoritativo)** |
|---|---|---|---|
| `product_name` vacunación/antiparasitario/antibiótico | `SilentSanitaryStep`/`SilentVaccinationStep` input | sin `maxLength` | **`sanitary_events.product_name` CHECK ≤160** (0070 l.227, VALIDATED) |
| `tube_number` sangrado/raspado | `LabSampleStep`/`LabDoubleStep` input | `maxLength={64}` + `slice(0, TUBE_MAX)` | **`lab_samples.tube_number` CHECK ≤64** (0070 l.241, VALIDATED) |
| pajuela inseminación (en `notes`) | `InseminacionStep`→`SilentSanitaryStep` input | sin `maxLength` | **`reproductive_events.notes` CHECK ≤4000** (0070 l.218, VALIDATED) |

El cliente Expo es attacker-controlled (escribe a PostgREST directo bypasseando la UI), por eso el control real es el CHECK. `product_name` y la pajuela no tienen `maxLength` cliente, pero el CHECK los cubre fail-closed al subir → defensa en profundidad, **no gap explotable** (igual estado as-built que el resto de inputs de texto libre del proyecto, cubiertos por el barrido INPUT-1 de 0070). NO es necesario rate-limit por campo: el storage-exhaustion lo capa el CHECK.

### 3. soft-delete de huérfanos + multi-write (IDOR) — OK, sin IDOR

Tracé `softDeleteManeuverEvents` → `buildSoftDeleteEventUpdate` (l.1093): `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`.
- El nombre de tabla (`${table}`) **NO es interpolación de usuario**: el tipo `DeletableEventTable` es un literal cerrado (`'sanitary_events' | 'reproductive_events'`, l.1072) y el caller (carga.tsx l.296) pasa el literal `'sanitary_events'`. Sin SQL injection.
- El `id` se parametriza (`?`). Aunque un cliente manipulado pasara un `id` de un evento **ajeno**, el `UPDATE` solo afecta esa fila **si pasa la RLS UPDATE al subir**: `is_owner_of(establishment_of_profile(animal_profile_id)) OR created_by = auth.uid()` (0027 l.40-43). Un `id` de otro tenant → RLS rechaza. **No hay IDOR**: la RLS es la barrera real, tal como afirma el implementer (impl l.100). El guard `deleted_at IS NULL` lo hace idempotente.
- Multi-write (raspado 2 / vacunación N): cada write es un INSERT parametrizado independiente con su UUID de cliente estable. Un `id` manipulado para escribir un evento "ajeno" no escapa la RLS de INSERT (basada en el establishment del `animal_profile_id`, no en el id de la fila). Sin escritura cross-tenant.

### 4. R6.12 / gating de inseminación — OK, decisión de seguridad NO delegada al cliente

El skip de raspado para hembras (`filterByAnimalApplicability`, carga.tsx l.223) y el modo single/selector de inseminación (`pajuelasFor` length) son **UX/orden de secuencia**. El gating real es server-side y fail-closed:
- `assert_data_keys_enabled` / `assert_any_data_key_enabled` (0091) en el trigger `tg_sanitary_events_gating`: un `deworming`/`treatment` sobre un rodeo sin el data_key → 23514 al subir, aunque la UI nunca lo ofreciera.
- Inseminación: gateada por `inseminacion` data_key (0054), deshabilitada por default en cría → rechazo fail-closed sin el data_key.
- El `event_type`/`sample_type` los fija la **maniobra en el dispatcher** (carga.tsx l.510 `eventType = maneuver === 'antiparasitario' ? 'deworming' : 'treatment'`), NO el usuario → no se puede inyectar un tipo arbitrario. El cliente NO replica la autorización.

### 5. Multi-tenant / secrets — OK

- Cero cross-tenant: toda barrera (RLS, session tenant-check, gating) deriva del establishment del animal real. Nada hardcodeado.
- Cero secretos: el único token nuevo es `$tubeText=24` en `tamagui.config.ts` (l.247) — tamaño de fuente, no secreto. Sin `console.log` de datos sensibles en los archivos del scope. Sin API keys / service_role en el bundle.

---

## Migración 0091 — revisión (toca tabla de spec 02)

- Ambas funciones (`assert_any_data_key_enabled`, `tg_sanitary_events_gating`): `SECURITY DEFINER` + `set search_path = public` + `revoke execute ... from public, authenticated, anon` (l.69, l.98). Patrón correcto, sin function-hijacking por search_path.
- **Fail-closed**: rodeo no resoluble (perfil ausente/soft-deleted) → `raise exception ... 23514` (l.46-49), nunca pasa. La rama OR (antiparasitario interno/externo) exige `>= 1` enabled; la AND (`assert_data_keys_enabled`, treatment) exige todos. Correcto.
- No reabre migraciones viejas; `CREATE OR REPLACE` de la función pre-existente de 0054, preserva el trigger y la rama vaccination intacta. No es RPC (sin grant a authenticated). Sin SQL dinámico.

---

## Findings HIGH de Sentry

**Ninguno.** No high-confidence vulnerabilities identified.

## Findings RAFAQ-SPECIFIC

**Ninguno.**

## False positives descartados (trazabilidad)

- **`buildSoftDeleteEventUpdate` interpola `${table}` en el SQL** → descartado: `table` es de tipo cerrado `DeletableEventTable` (no string de usuario); el call-site pasa el literal `'sanitary_events'`. No es injection.
- **`product_name`/pajuela sin `maxLength` en el TextInput** → descartado como HIGH: el CHECK server-side (≤160 / ≤4000, 0070) es la barrera autoritativa; el cliente es attacker-controlled de todas formas, así que el `maxLength` nunca habría sido el control. Defensa en profundidad, no gap.
- **`created_by` solo se sobreescribe `if null`** → descartado: la RLS de INSERT no confía en `created_by` (usa `has_role_in(establishment_of_profile(...))`); spoofearlo no escala privilegios ni cruza tenants.
- **`todayIso()` usa wall-clock del dispositivo (carga.tsx l.106)** para `event_date` → no es finding de seguridad (el cliente offline-first no tiene reloj confiable por diseño; `event_date` es un dato declarativo, no un control de seguridad; el append-only/audit lo da el server con sus propios timestamps).

---

## Tabla de inputs (campos que el usuario tipea en M3.2b)

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| product_name (silent_single: antiparasitario/antibiótico) | ≤160 chars | **server** (CHECK 0070 l.227) | ✅ |
| vacunas (silent_multi, N × product_name) | ≤160 chars c/u | **server** (CHECK 0070 l.227, por fila) | ✅ |
| tube_number sangrado (blood) | ≤64 chars | **server** (CHECK 0070 l.241) + cliente `maxLength=64` | ✅ |
| tube_number raspado ×2 (scrape_tricho/campylo) | ≤64 chars | **server** (CHECK 0070 l.241) + cliente `maxLength=64` | ✅ |
| pajuela inseminación (→ `notes`) | ≤4000 chars | **server** (CHECK 0070 l.218) | ✅ |

Todos los campos de entrada tienen límite claro + validación autoritativa server-side. Ningún texto libre se concatena en filtros `.or()/.filter()`, `ilike`, ni prompts LLM (los inputs van solo a INSERT/UPDATE parametrizados).

## Tabla de rate limits (acciones abusables tocadas por M3.2b)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| INSERT/UPDATE de evento de maniobra (local→sync) | n.a. | n.a. | — | Write CRUD-plano offline-first; no es endpoint con costo (sin email/SMS/API externa). Storage-exhaustion lo capa el CHECK de largo (0070). No bulk: 1 fila por confirmación de paso (raspado=2, vacunación=N acotada por las vacunas tipeadas). Sin fan-out amplificable. |
| soft-delete de huérfanos | n.a. | n.a. | — | Solo retira filas que esta sesión escribió; acotado por el conteo previo. RLS UPDATE es la barrera. |

M3.2b NO toca Auth nativo, Edge Functions, email/SMS, APIs externas ni operaciones bulk → no requiere rate limit propio. `[auth.rate_limit]` de `config.toml` sin cambios.

---

## Archivos analizados

- `app/app/maniobra/_components/SilentSanitaryStep.tsx`
- `app/app/maniobra/_components/SilentVaccinationStep.tsx`
- `app/app/maniobra/_components/LabSampleStep.tsx`
- `app/app/maniobra/_components/LabDoubleStep.tsx`
- `app/app/maniobra/_components/InseminacionStep.tsx`
- `app/app/maniobra/carga.tsx`
- `app/src/utils/maneuver-config.ts`
- `app/src/utils/maneuver-event-query.ts`
- `app/src/services/maneuver-events.ts`
- `app/src/services/powersync/local-reads.ts` (builders M3.2b + `buildSoftDeleteEventUpdate`)
- `app/tamagui.config.ts` (token `$tubeText`)
- `supabase/migrations/0091_sanitary_gating_deworming_treatment.sql`

Migraciones de soporte verificadas para confirmar las barreras server-side (no del scope, pero load-bearing del análisis): 0070 (CHECK de largo), 0056 (session tenant-check INSERT+UPDATE), 0024 (created_by trigger), 0027 (RLS sanitary_events), 0029 (RLS lab_samples), 0054 (gating capa 2 base).

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia)

La skill `sentry-skills:security-review` está orientada a patrones web (XSS/SQLi/SSRF/deserialización) y **no cubre directamente**: (a) **PostgreSQL RLS** policies, (b) **PowerSync sync rules** / replay offline, (c) triggers PL/pgSQL. Esos dominios los cubrí con **revisión manual RAFAQ-específica** (RLS de las 3 tablas de evento, tenant-check de session_id, gating capa 2, idempotencia del soft-delete offline, re-autorización al subir vía RLS). M3.2b no agrega Edge Functions Deno (sin cobertura Deno necesaria). Las sync rules de PowerSync aún no están wired (ADR-002 pendiente) — fuera de alcance de este chunk.

---

## check.mjs RC

check.mjs salió **rojo** por `TypeError: Cannot read properties of undefined (reading 'rpc')` en la suite backend `animal`. Es el **flake de rate-limit de auth de Supabase** (2 terminales paralelas → el cliente de auth no se crea → `undefined.rpc`), documentado en memoria `reference_check_red_rate_limit`. **Verificado**: re-corrida AISLADA de `supabase/tests/animal/run.cjs` → **109/109 PASS**. NO es regresión de M3.2b ni un finding de seguridad. El flake de `maniobra-carga` test5 (timing del frame M2.2) tampoco es finding (documentado en impl l.211). spec-12 N/A.

**NO marco done** — Gate 2 es solo el gate de security; la decisión final es de Raf.
