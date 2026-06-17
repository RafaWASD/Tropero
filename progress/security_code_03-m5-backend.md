# Gate 2 (security modo `code`) — Spec 03 / chunk M5-BACKEND (datos/maniobras CUSTOM)

> **Veredicto: PASS.** Sin findings HIGH ni RAFAQ-SPECIFIC abiertos. Auditado el CÓDIGO SQL de las 5
> migraciones (NO aplicadas) + el delta de sync (YAML + schema.ts), contra el baseline registrado por el
> implementer y verificado contra los patrones canónicos as-built (0005/0018/0023/0036/0054/0070/0077/0078/0082).
> Los 5 requisitos lockeados por Gate 1 (M5-SEC-01..05) están implementados sin gap. La higiene SECURITY
> DEFINER es completa (7/7 funciones). 3 observaciones no-bloqueantes documentadas abajo (§Observaciones).

**Fecha**: 2026-06-17
**Baseline** (de `progress/impl_03-m5-backend.md`): `7cfbea77705390f12205722b3849a304bff455f1`
**Skill**: `sentry-skills:security-review` corrida sobre el diff; metodología (trazar data flow + verificar
exploitability ANTES de reportar) aplicada manualmente sobre cada vector. **Resultado de la skill: "No
high-confidence vulnerabilities identified"** — coincide con mi auditoría manual RAFAQ-específica.

---

## Archivos analizados (diff `7cfbea7..working tree`)

| Archivo | Estado | Qué audité |
|---|---|---|
| `supabase/migrations/0093_field_definitions_custom.sql` | nuevo (untracked) | reopen RLS, guard inmutabilidad/owner-only/data_type, CHECKs INPUT-1, UNIQUE doble |
| `supabase/migrations/0094_custom_measurements.sql` | nuevo | tabla append-only, force-audit anti-spoof, RLS, cap notes/value |
| `supabase/migrations/0095_custom_attributes.sql` | nuevo | tabla current-value, force-audit (INSERT+UPDATE), RLS, cap value |
| `supabase/migrations/0096_custom_gating.sql` | nuevo | gating genérico fail-closed + validación de value fail-closed |
| `supabase/migrations/0097_check_grants.sql` | nuevo | grants/revokes + smoke check fail-closed |
| `sync-streams/rafaq.yaml` | modificado | frontera WAL: catalog global IS NULL + 3 streams custom scope-est |
| `app/src/services/powersync/schema.ts` | modificado | columnas establishment_id/deleted_at + 2 Tables custom |
| `app/src/services/powersync/schema.test.ts` | modificado | guard 28 tablas (test, no es superficie de prod) |

El diff coincide **exactamente** con el ALCANCE del brief — sin archivos fuera de scope tocados.

---

## Verificación punto por punto (los 8 focos del brief + barrido RAFAQ)

### 1. RLS reopen de `field_definitions` (0093 f, l.154-172) — ✅ OK

- **SELECT** (l.155-159): `(establishment_id is null) or (establishment_id is not null and has_role_in(establishment_id))`. Una custom de OTRO tenant **NO** se filtra (sin rol → `has_role_in=false` → 0 filas). Las 26 globales (`is null`) siguen visibles a todos = read-only para el cliente preservado.
- **INSERT** (l.160-163): `establishment_id is not null and is_owner_of(establishment_id)` → no se puede crear una GLOBAL desde el cliente (exige `is not null`) ni crear en un campo ajeno (`is_owner_of`).
- **UPDATE** (l.164-169): idem en `using` (OLD) y `with check` (NEW). Soft-delete (`deleted_at`) es un UPDATE → owner-only.
- **Doble barrera**: la policy + el `tg_field_definitions_custom_guard` (l.86-95) que re-rechaza alta global de cliente (`42501`) y re-fuerza `is_owner_of`. Verificado contra `0005`: `is_owner_of(NULL)` retorna `false` (el `where ur.establishment_id = est_id` nunca matchea NULL) → aunque el guard fallara, la policy bloquea. Redundancia correcta.
- **Globales del seed exentas del CHECK custom**: trazado contra `0018` — el seed usa `silent_apply`/`composite`/`text` (fuera de los 7); el CHECK `field_definitions_custom_ui_component_valid` (l.53-56) las exime con `establishment_id is null or ...` → la migración NO aborta al validar las filas as-built. ✅

### 2. Inmutabilidad post-creación (M5-SEC-02, 0093 e l.104-112) — ✅ OK

- El guard en `tg_op = 'UPDATE'` compara `old.* is distinct from new.*` para los 4 ejes (`establishment_id`, `data_type`, `data_key`, `ui_component`) → `42501`. Espeja exactamente `tg_animals_block_tag_change` (`0036`, mismo `IS DISTINCT FROM` + errcode).
- **Caso clave verificado** (owner de A+B muda una custom de A→B): el `using` de la policy (`is_owner_of(A)`) pasa y el `with check` (`is_owner_of(B)`) pasa — pero el **guard** lo corta primero (`old.establishment_id (A) IS DISTINCT FROM new.establishment_id (B)` → `42501`). La fila NO se muda → no hay fuga vía la stream `est_field_definitions_custom`. ✅
- Editable post-creación = solo `label`/`config_schema`/`active`/`deleted_at` (no entran al guard de inmutabilidad). Ningún flujo legítimo (soft-delete, toggle, editar label/options) se traba.

### 3. SECURITY DEFINER hardening (R13.24) — ✅ OK (7/7)

Las **7** funciones nuevas (`tg_field_definitions_custom_guard`, `tg_custom_measurements_force_audit`, `tg_custom_attributes_force_audit`, `assert_custom_field_enabled`, `assert_custom_value_valid`, `tg_custom_measurements_gating`, `tg_custom_attributes_gating`):
- todas con `language plpgsql security definer set search_path = public` (verificado línea por línea);
- todas con `revoke execute ... from public, authenticated, anon` en su propia migración **y** re-afirmado en 0097 (l.22-28);
- el smoke check fail-closed de 0097 (l.33-57) cubre **las 7** con firma exacta (`pg_get_function_identity_arguments`) → distingue las 2 `assert_*` (con args) de las 5 trigger functions (`''`) para no confundir homónimos. Si alguna quedara EXECUTE-able por una rol cliente, la migración **aborta**. Ninguna es RPC. Paridad SEC-HIGH-01 intacta.

### 4. Gating + validación de value fail-closed (M5-SEC-01, 0096) — ✅ OK

- `assert_custom_field_enabled` (l.18-36): rodeo no resoluble (perfil missing/soft-deleted) → `23514` (fail-closed, no early-return); field no-enabled en `rodeo_data_config` → `23514`. Paridad exacta con `assert_data_keys_enabled` (`0054`, ya gateado).
- `assert_custom_value_valid` (l.42-82): **rama `else` presente** (l.75-81) → `ui_component` no reconocido → `23514` (fail-closed; era el fail-OPEN del fix-loop original). numeric/numeric_stepped → `jsonb_typeof = number`; boolean → bool; enum_single → `v_opts @> jsonb_build_array(p_value)`; enum_multi → array + cada elemento ∈ options + cardinalidad ≤50; text/date → string (+ date parse-check). Defensa en profundidad sobre el CHECK de dominio de 0093 d.1.

### 5. Audit anti-spoof (R13.23, 0094/0095) — ✅ OK

- `tg_custom_measurements_force_audit` (0094 l.44-50): `recorded_by := auth.uid()`, `establishment_id := establishment_of_profile(animal_profile_id)` — **derivado del perfil real, ignora el payload**. BEFORE INSERT.
- `tg_custom_attributes_force_audit` (0095 l.33-40): `updated_by := auth.uid()`, `establishment_id := establishment_of_profile(...)`, `updated_at := now()`. BEFORE INSERT **OR UPDATE** → cubre el vector "pisar establishment_id con UPDATE" (paridad `0077`).
- **Cross-tenant via `animal_profile_id` ajeno NO se cuela**: el `establishment_id` se deriva del perfil real → la RLS `has_role_in(establishment_id)` rechaza si el caller no tiene rol en ESE establishment.
- **Orden de triggers BEFORE INSERT verificado**: en `custom_measurements` corren `..._force_audit` y `..._gating`. PostgreSQL ejecuta BEFORE del mismo evento en orden alfabético del nombre → `force_audit` (f) antes que `gating` (g). El gating lee `new.animal_profile_id`/`new.field_definition_id` (provistos por el cliente, no forzados), así que el orden no genera bypass. ✅

### 6. Caps INPUT-1 (M5-SEC-03/04/05) — ✅ OK

Trazado contra `0070` (patrón canónico de caps). Tabla de inputs completa abajo. Todos los campos que el cliente tipea por PostgREST directo tienen validación autoritativa server-side (CHECK de tabla o guard).

### 7. Frontera WAL (R13.20/R13.21, `rafaq.yaml`) — ✅ OK

- `catalog_field_definitions` (l.56-59): `WHERE establishment_id IS NULL` → solo las globales salen por la stream global; SIN este filtro las custom fugarían a TODOS los devices.
- 3 streams custom (`est_field_definitions_custom` l.229-234, `est_custom_measurements` l.236-241, `est_custom_attributes` l.243-249): `WHERE establishment_id IN org_scope` (JOIN-free, patrón probado idéntico a `est_rodeo_data_config`/`est_animal_profiles`). Un device sin rol en el establishment → `org_scope` vacío → 0 filas custom. `org_scope` con `active = true` + trigger `0076` (rol revocado → `active=false`) cubre la revocación.
- `establishment_id` en las 2 tablas de captura está denormalizado por trigger anti-spoof → el scope del wire es fiel, no del payload.

### 8. data_type guard (M5-SEC-03, 0093 e l.117-120) — ✅ OK

- CHECK de tabla `field_definitions_data_type_valid` (l.69-70): set cerrado de los 4 tipos.
- Guard estrecha el alta de cliente a `('maniobra','propiedad')` (l.117-120 → `42501`) → un INSERT por PostgREST con `data_type='evento_individual'/'evento_grupal'` se rechaza. Corre también en UPDATE, pero como `data_type` es inmutable, un UPDATE legítimo de una custom maniobra/propiedad siempre lo satisface → no traba el update de label.

---

## Findings HIGH de Sentry

Ninguno. La skill devolvió "No high-confidence vulnerabilities identified" sobre el diff, consistente con la
auditoría manual.

## Findings RAFAQ-SPECIFIC

Ninguno abierto. Los 5 vectores RAFAQ que el reviewer no cubre desde el ángulo security (RLS cross-tenant,
inmutabilidad/WAL, SECURITY DEFINER, gating fail-closed, anti-spoof) están todos cerrados — ver verificación
punto por punto arriba.

---

## Observaciones no-bloqueantes (NO findings — documentadas para trazabilidad)

### OBS-1 (LOW / data-integrity, no security) — `field_definition_id` cross-tenant en una captura

**Cadena trazada**: la policy `rodeo_data_config_insert` (`0018` l.158-162) chequea solo `is_owner_of(rodeo.establishment_id)` — **no** valida que el `field_definition_id` toggleado pertenezca al mismo tenant; el FK solo exige que el id exista. Un owner de A podría, en teoría, insertar `rodeo_data_config(rodeo_A, fd_de_B, enabled=true)` y luego capturar: `assert_custom_field_enabled` pasa (la fila existe) y `assert_custom_value_valid` valida contra el `ui_component` de B (SECURITY DEFINER bypassa RLS para leer la definición).

**Por qué NO es finding de seguridad**:
1. **No hay fuga B→A**: la definición de B (label, options) **no** se replica a A — la stream `est_field_definitions_custom` de A filtra `establishment_id IN org_scope_A`, y fd_de_B no está en ese scope. La captura resultante queda en A con un FK a una definición que el device de A no resuelve localmente (dangling), no expone datos de B.
2. **No enumerable**: A necesita **conocer** el UUID exacto de una custom de B. La RLS SELECT de `field_definitions` devuelve 0 filas para custom ajenas (no hay oráculo de existencia por PostgREST).
3. **Pre-existente e idéntico al modelo de fábrica**: el gating canónico `assert_data_keys_enabled` (`0054`) tampoco valida tenant del field (resuelve por `data_key` global, compartido). M5 no introduce regresión sobre el patrón as-built; el blast radius es intra-tenant (garbage en analytics propias del atacante-owner), exactamente la clase que Gate 1 categorizó como data-integrity no-bloqueante.

**Recomendación (backlog, no Gate 2)**: si se quiere cerrar el dangling, `assert_custom_field_enabled` podría además exigir `field_definitions.establishment_id = establishment_of_profile(animal_profile_id)` para custom. No es requisito de seguridad — es higiene de integridad. Mismo nivel que MED-2 (`est_rodeo_data_config` over-sync) ya backlogueado en el YAML.

### OBS-2 (cosmético, no security) — `tg_*_force_audit` no chequea `establishment_of_profile(...) IS NULL`

A diferencia de `0077` (`tg_force_establishment_id_from_profile`, que lanza `23503` explícito si el perfil no existe), los `tg_custom_*_force_audit` (0094 l.48 / 0095 l.37) hacen `new.establishment_id := establishment_of_profile(...)` sin chequear NULL. **Fail-closed igualmente**: la columna `establishment_id` es `NOT NULL` (0094 l.22 / 0095 l.21) → un `animal_profile_id` inexistente/borrado-y-purgado aborta el INSERT con `23502` (NOT NULL violation). El efecto de seguridad (rechazo) es idéntico; solo el mensaje de error es menos descriptivo. No explotable. (Además, el gating `assert_custom_field_enabled` ya rechaza con `23514` un perfil soft-deleted antes, en su propio trigger.)

### OBS-3 (consistencia, no security) — RLS SELECT de `field_definitions` no filtra `deleted_at`

`field_definitions_select` (0093 l.155-159) no incluye `deleted_at is null` → una custom soft-deleteada sigue visible por SELECT directo a su owner/roles. La stream WAL `est_field_definitions_custom` **sí** filtra `deleted_at IS NULL` (l.234). Same-tenant only, no cross-tenant. Idéntico patrón al as-built del repo (el filtrado de soft-delete vive en la query de lectura/stream, no en la RLS de catálogos) y al caso MED-2 ya aceptado. No es fuga.

---

## False positives descartados (de la skill)

La skill no levantó findings, por lo que no hubo false positives que descartar. Para trazabilidad, los
patrones que un scanner genérico podría marcar y que verifiqué como NO-issue:
- **`SELECT *` en las streams del YAML** → no es over-fetch column-level explotable: el scoping es por
  `establishment_id IN org_scope` y las tablas custom no tienen columnas PII (la PII vive en `user_private`
  self-only, fuera de scope).
- **`value jsonb` sin schema estricto** → acotado por CHECK `octet_length < 4096` + validación por
  `ui_component` en `assert_custom_value_valid` (fail-closed). No es deserialización insegura (jsonb nativo
  de Postgres, no `pickle`/`yaml.load`).
- **SECURITY DEFINER** → no es escalada: todas derivan tenant/rodeo de la fila real y tienen EXECUTE revocado.

---

## Tabla de inputs (cada campo que el cliente tipea por PostgREST directo)

| campo | límite | validación | OK? |
|---|---|---|---|
| `field_definitions.label` | ≤80 (CHECK 0093 l.46) | server (CHECK) | ✅ |
| `field_definitions.config_schema` (jsonb) | <4096 bytes (CHECK l.47) + options ≤50 / cada ≤60 (guard l.126-144) | server (CHECK + guard) | ✅ |
| `field_definitions.ui_component` | custom ∈ los 7 (CHECK dominio l.53-56); inmutable (guard l.104-112) | server (CHECK + guard) | ✅ |
| `field_definitions.data_key` | ≤64 + slug `^[a-z0-9_]+$` (CHECK l.66-67); inmutable | server (CHECK + guard) | ✅ |
| `field_definitions.description` | ≤500 (CHECK l.68) | server (CHECK) | ✅ |
| `field_definitions.category` | custom ≤32 (CHECK l.71-72) | server (CHECK) | ✅ |
| `field_definitions.data_type` | set cerrado tabla (l.69-70) + cliente ∈ (maniobra,propiedad) (guard l.117-120); inmutable | server (CHECK + guard) | ✅ |
| `field_definitions.establishment_id` (INSERT/UPDATE) | INSERT: owner-only no-null (policy+guard); UPDATE: inmutable → `42501` | server (guard `IS DISTINCT FROM`) | ✅ |
| `custom_measurements.value` (jsonb) | <4096 bytes (CHECK 0094 l.30) + por `ui_component` fail-closed (0096) | server (CHECK + `assert_custom_value_valid`) | ✅ |
| `custom_measurements.notes` | ≤500 (CHECK 0094 l.33) | server (CHECK) | ✅ |
| `custom_measurements.recorded_by/establishment_id` | forzados por trigger (no del payload) | server (force-audit) | ✅ |
| `custom_attributes.value` (jsonb) | <4096 bytes (CHECK 0095 l.27) + por `ui_component` fail-closed | server (idem value) | ✅ |
| `custom_attributes.updated_by/establishment_id` | forzados por trigger (INSERT+UPDATE) | server (force-audit) | ✅ |

**Todos los campos de entrada tienen límite claro + validación autoritativa server-side.** El cliente Expo
es attacker-controlled (escribe a PostgREST directo) → ningún control depende del cliente.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Crear/editar `field_definitions` custom (owner, PostgREST) | no | n.a. | n.a. | Owner-only (`is_owner_of`). Sin email/SMS/API externa/bulk. Abuso real = storage/cardinalidad, cubierto por caps (config_schema <4096, options ≤50). **n.a. justificado.** |
| Captura `custom_measurements`/`custom_attributes` (cualquier rol con `has_role_in`) | no | n.a. | n.a. | INSERT CRUD-plano offline-first (encolado offline) → rate limit server-side no aplica al modelo. Abuso = cap de value (4 KiB) + notes (500) + cardinalidad. **n.a. justificado.** |
| Sync stream custom (PowerSync) | no (lo maneja PowerSync) | per-establishment (`org_scope`) | sí (scope vacío → 0 filas) | No es Edge Function custom; bucket model de PowerSync acota el fan-out. |

Ninguna acción de M5-BACKEND manda email/SMS, pega a API externa, ni es bulk/import → **no hay Edge Function
que requiera rate limit propio**. (M5 no crea Edge Functions.) Superficie abusable = storage/cardinalidad,
cubierta por los caps.

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia de scope de la skill)

La skill `sentry-skills:security-review` está orientada a OWASP web/app (Python/JS/Go/Java) y **no cubre
nativamente** Postgres RLS, triggers SECURITY DEFINER, ni las sync rules de PowerSync. Esos dominios —que son
el 100% del riesgo de este chunk— los cubrí con **revisión manual RAFAQ-específica** contra los patrones
canónicos as-built:
- **RLS / SECURITY DEFINER / triggers**: trazados contra `0005` (helpers), `0018` (catálogo as-built),
  `0023` (`establishment_of_profile`), `0036` (inmutabilidad), `0054` (gating de fábrica), `0070` (caps),
  `0077`/`0078` (anti-spoof denorm), `0082` (anti-IDOR RPC).
- **PowerSync WAL boundary**: trazado contra el modelo JOIN-free probado del propio `rafaq.yaml` (ADR-025/026).
- **Deno / Edge Functions**: N/A — M5-BACKEND no crea ninguna Edge Function.
- **Cliente M5 (services de captura, render genérico, UI de creación)**: es otro chunk (M5-CLIENTE, frontend)
  → su seguridad se audita en su propio Gate 2 cuando se implemente.

---

## Resumen para el leader

**PASS.** Las 5 migraciones transcriben fielmente el diseño lockeado por Gate 1 (M5-SEC-01..05 todos cerrados
en el código real, no solo en la prosa). RLS cross-tenant hermética (SELECT/INSERT/UPDATE), inmutabilidad
anti-apropiación-WAL implementada (incl. el caso owner-de-A+B), 7/7 funciones SECURITY DEFINER con
`search_path` + EXECUTE revocado + smoke check fail-closed que cubre las 7 por firma, gating y validación de
value fail-closed, anti-spoof por trigger fiel al patrón 0077, caps INPUT-1 en todo input de cliente, frontera
WAL scope-establishment. 3 observaciones no-bloqueantes (OBS-1/2/3: data-integrity / cosmético / consistencia,
ninguna explotable cross-tenant). Recordatorio de orden: el deploy de `0093..0097` + del YAML de PowerSync lo
gatea el leader con el OK de Raf; la suite `supabase/tests/custom/run.cjs` corre POST-APPLY.
