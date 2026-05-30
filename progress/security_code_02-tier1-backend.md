# Security Code Review (Gate 2, ADR-019) — 02-modelo-animal · Tier 1 backend

baseline_commit: 9f1803740290cf5a28374738612ba5eb69238d53 | rama `main` (cambios sin commitear).
Alcance: SOLO el delta Tier 1 — migrations `0043`..`0049` (untracked) + bloque T2.19 de `supabase/tests/animal/run.cjs`. NO re-audita `0013`-`0042` (Gate 2 sesión 15, `security_code_02-modelo-animal.md`, que NO se pisa).

## Veredicto: PASS

El delta no introduce findings HIGH explotables. Las 2 notas que el Gate 1 de spec dejó para este gate de código (R1-NEW: cuerpo real de `register_birth`; R2-NEW: rollback atómico parcial) están **cerradas en el código real y probadas con tests de estado reales** (no fachada). El modelo de exposición PostgREST de los 4 RPC/triggers `SECURITY DEFINER` nuevos es sólido: authz derivada de la fila real (nunca del payload), `search_path` fijado, grants tipados acotados, sin INSERT de cliente a `birth_calves`. La skill `sentry-skills:security-review` no reportó HIGH-confidence (su cobertura de PL/pgSQL y del modelo RPC es indirecta; ese ángulo lo cubrí a mano — es donde vivió SEC-HIGH-01).

---

## Findings HIGH de Sentry (validados)

Ninguno. La skill `sentry-skills:security-review` no produjo findings HIGH-confidence sobre el diff. Sus heurísticas de injection/XSS/SSRF/deserialización aplican a Python/JS/Go/Java y no a PL/pgSQL ni al modelo de exposición RPC de PostgREST — declarado explícitamente abajo en "Cobertura indirecta". El ángulo PL/pgSQL + RPC lo audité manualmente.

## Findings RAFAQ-SPECIFIC

Ninguno bloqueante. A continuación, la verificación punto por punto del foco obligatorio del leader (todo PASS):

### R1-NEW — cuerpo real de `register_birth` (`0045:188-298`)
- **`revoke from public, anon` + grant tipado a `authenticated`**: PASS. `0045:297-298` revoca/concede con la firma completa `(uuid, date, jsonb)`. Sin grant a `public`/`anon`. `register_birth` SÍ debe ser invocable por `authenticated` (es el camino de carga de mellizos del cliente).
- **`set search_path = public`**: PASS. `0045:194`. Cierra la vector clase privilege-escalation de SECURITY DEFINER sin search_path (un caller no puede shadowear `animal_profiles`/`has_role_in` vía un schema en su `search_path`).
- **`has_role_in` sobre el establishment derivado de la FILA REAL de la madre, ANTES de todo INSERT**: PASS. `0045:214-219` deriva `v_est` con `select p.establishment_id ... where p.id = p_mother_profile_id and p.deleted_at is null`; `0045:223-225` corre `has_role_in(v_est)` y aborta con `42501` ANTES del primer INSERT (que recién ocurre en `0045:239`). El cliente nunca pasa el tenant: el payload `p_calves` solo trae `calf_sex`/`calf_weight`/`calf_tag_electronic`, ningún `establishment_id`/`rodeo_id`. `has_role_in` (`0005:9-25`) filtra por `auth.uid()` + `ur.active = true` — un ex-operario con rol revocado no pasa. Cross-tenant probado por T2.19 caso 2 (`run.cjs:1141`): userA → madre de estB devuelve `42501` y el snapshot confirma 0 eventos / 0 perfiles creados en B.
- **Hereda tenant/rodeo del server**: PASS. Cada ternero usa `v_est` (`0045:269`) y `v_rodeo_id` (`0045:270`) literales de la fila de la madre, con comentario in-code "herencia de tenant del server, NO del payload". Probado por caso 2 control (`run.cjs:1187-1190`): los 2 terneros heredan `establishment_id = estB` y `rodeo_id = rodeoB`.
- **El `jsonb` de terneros se itera sin inyección**: PASS. La iteración usa `jsonb_array_elements` + operador `->>` (`0045:246-253`) — extracción de valores tipados, NO concatenación de SQL. `calf_sex` se valida contra allowlist `in ('male','female')` (`0045:249-251`); `calf_weight` se castea con `nullif(...)::numeric` (`0045:252`, un valor no-numérico aborta la transacción → rollback, no inyección); `calf_tag` se inserta como parámetro de `insert ... values` (`0045:259-261`), nunca interpolado en un string SQL. No hay `execute`/`format`/`||` construyendo SQL dinámico en ningún punto del cuerpo. Sin superficie de SQL injection.

### R2-NEW — rollback atómico parcial (ternero intermedio inválido)
- **El cuerpo NO captura/traga excepciones**: PASS. `register_birth` no tiene bloque `exception when others then ... return` — cualquier fallo propaga y revierte la transacción completa (el evento de `0045:239` + todos los terneros ya insertados). El trigger mono `tg_reproductive_events_create_calf` (`0048:74-77`) sí tiene `exception when others then raise` — re-raise explícito, NO traga; preserva la atomicidad igual.
- **El test pone el inválido en posición INTERMEDIA y verifica rollback TOTAL**: PASS. Control de rollback (`run.cjs:1371-1413`): el payload es `[válido, dup(TAG global), válido]` — el inválido es el ternero #2 de 3 (`run.cjs:1390-1394`), no el primero. El TAG duplicado es genuino: viola el unique index global `animals_tag_unique` (`0019:22-24`, `where tag_electronic is not null and deleted_at is null`) → `23505` en el INSERT del calf #2, tras haber insertado el #1. El test verifica con `service_role` que `reproductive_events` Y `animal_profiles` vuelven al baseline (`run.cjs:1400-1405`) — el ternero #1 ya insertado **también** se revierte — y que la madre NO transiciona (`vaquillona_prenada`, `run.cjs:1411`). Rollback total real, no parcial.

### `exit_animal_profile` (`0044:27-68`)
- **Guarda `has_role_in` presente; no cross-tenant; grant acotado**: PASS. `0044:48-51` exige `has_role_in(v_est) AND (is_owner_of(v_est) OR v_creator = auth.uid())`. `v_est`/`v_creator` salen de la fila real (`0044:38-39`, `where id = p_profile_id and deleted_at is null`), nunca del payload. `has_role_in` es OBLIGATORIO y de la misma clase que SEC-HIGH-01: filtra al ex-autor con rol revocado (`user_roles.active = false`). `search_path = public` (`0044:35`). Revoke/grant tipados a `authenticated` con firma completa de 6 args (`0044:67-68`). Probado por T2.19 caso 1 (`run.cjs:1091`): autor con rol inactivo → `42501`, status sin cambiar; + caso 5 corolario (`run.cjs:1291-1303`): el `auth.uid()` spoofeado vía `created_by` no habilita la baja por la rama `v_creator` (porque `created_by` se fuerza server-side, ver abajo).

### `birth_calves` — select-only a `authenticated`, RLS filtra `deleted_at`
- **PASS**. `0045:24` habilita RLS; `0045:26-34` define SOLO policy de SELECT, que filtra `re.deleted_at is null` (parto soft-deleted oculta sus filas puente, SEC-SPEC-04.a). NO existe policy de INSERT. `0045:39` concede solo `select` a `authenticated`. Confirmé que ninguna otra migration agrega grant INSERT a `birth_calves` (grep en `migrations/` excluyendo `0045`: solo `0048` la puebla desde trigger SECURITY DEFINER, y `0049` concede `select` a `service_role`) y que no hay `alter default privileges` catch-all que conceda INSERT/ALL a `authenticated`/`public`/`anon` (grep sin matches). Por lo tanto el cliente no puede fabricar parentescos cruzados: INSERT directo → `42501`, probado por caso 3 (`run.cjs:1200-1227`, verifica que la fila falsa no quedó). El establishment de la policy se deriva por join a `reproductive_events` → `animal_profiles` vía `establishment_of_profile` (`0023:6-10`, `security definer` + `search_path = public`).

### `tg_force_created_by_auth_uid` — created_by no spoofeable
- **Sobreescribe incondicional**: PASS. `0043:18` hace `new.created_by := auth.uid()` SIN guarda "solo si NULL" — ignora cualquier valor del payload del cliente. Es correcto que sea incondicional: `created_by` es load-bearing para authz (lo lee `exit_animal_profile` por la rama `v_creator`), así que un INSERT con `created_by` arbitrario NO debe poder atribuirse el alta a otro user. Probado por caso 5 (`run.cjs:1266-1303`): userA inserta con `created_by: userB.id` explícito → la fila queda `created_by = userA`; y userB (uid spoofeado, con rol activo agregado para aislar la rama) NO puede dar de baja vía `v_creator`.

### Triggers nuevos — bypass desde el cliente
- **`0046` recompute** (`tg_reproductive_events_recompute_on_change`): PASS. `SECURITY DEFINER` + `search_path = public` (`0046:13-14`). Respeta el override: si `category_override` es `true` o `NULL` retorna sin recalcular (`0046:19-21`) — R4.9 intacto. Reusa `apply_auto_transition` pese al revoke de 0042 porque corre como owner del schema. NO es invocable directo por el cliente (es trigger, no RPC; no hay grant execute). El trigger escucha solo `event_type, pregnancy_status, deleted_at` (`0046:31`) — `calf_id` no está en la lista, así que el `update ... set calf_id` de `register_birth` (`0045:290`) no lo re-dispara (evita doble transición). No bypasseable desde el cliente.
- **`0047` rodeo mismo-sistema** (`tg_animal_profiles_rodeo_same_system_check`): PASS. `SECURITY DEFINER` + `search_path = public` (`0047:12-13`) — necesita SECURITY DEFINER para leer `rodeos` (RLS) y resolver `system_id` durante el UPDATE. Es un check de validación BEFORE UPDATE OF `rodeo_id`: rechaza el cruce de sistemas con `23514` (`0047:22-25`); no abre ninguna superficie de escritura nueva ni concede privilegios. La pertenencia al establishment ya la enforce `tg_animal_profiles_rodeo_check` (0021). Probado por caso 7 (`run.cjs:1352`, path de aceptación mismo-sistema).
- **`0048` AFTER INSERT mono-ternero** (`tg_reproductive_events_link_birth_calf`): PASS. `SECURITY DEFINER` + `search_path = public` (`0048:83-84`). Puebla `birth_calves` SOLO cuando `event_type = 'birth' and calf_id is not null` (`0048:86`), con `on conflict do nothing` (idempotente). El cliente no tiene grant INSERT a `birth_calves`; la única vía de poblar la puente es server-side. El `calf_id` lo setea el BEFORE trigger server-side (`0048:72`), no el cliente. No bypasseable.

### Secrets hardcodeados / `console.log` de secretos
- **PASS**. Las 7 migrations son SQL puro; no contienen credenciales, API keys ni connection strings (confirmado en la lectura completa). El bloque de tests `run.cjs` T2.19 usa clientes obtenidos por helpers (`getUserClient`, `admin`/`service_role` ya provistos por el harness) — no introduce secretos nuevos ni `console.log` de credenciales.

## False positives descartados (trazabilidad)

- **`exception when others then raise` en `tg_reproductive_events_create_calf` (`0045:177-180`, `0048:74-77`)** — un escáner de patrones podría marcar `when others` como "swallowed exception / fail-open". NO aplica: re-raisea explícitamente (`raise;`), no devuelve ni traga. Preserva la atomicidad del parto (R9.4). Validado manualmente + por el control de rollback.
- **`register_birth`/`exit_animal_profile`/triggers son `SECURITY DEFINER`** — patrón que un escáner marca como privilege-escalation. NO aplica: todos fijan `set search_path = public` (cierra el vector de schema-shadowing) y derivan authz de la fila real vía `auth.uid()`/`has_role_in`, no del payload. SECURITY DEFINER es intencional y necesario (poblar tablas server-only, leer `rodeos`/`user_roles` bajo RLS).
- **`grant select on birth_calves to service_role` (`0049:17`)** — un escáner podría marcar "grant amplio". NO aplica: `service_role` es el rol administrativo del backend (bypassa RLS por diseño en Supabase), usado por fixtures/lecturas de verificación; el grant es `select` (más acotado que el `grant all` convencional — ver nota no-bloqueante abajo). NO toca la superficie del cliente `authenticated`.
- **`compute_category` re-emitida (`0045:45-108`)** — idéntica al as-built `0031`, `SECURITY DEFINER` + `search_path = public`, `stable`. Sin cambio funcional; cuenta `count(*)` sobre `reproductive_events` con `event_type='birth' and deleted_at is null`, nunca filas de `birth_calves`. No es un finding.

## Archivos analizados

- `supabase/migrations/0043_animal_profiles_created_by.sql`
- `supabase/migrations/0044_exit_reason_enum.sql`
- `supabase/migrations/0045_birth_calves.sql`
- `supabase/migrations/0046_category_recompute_on_event_change.sql`
- `supabase/migrations/0047_rodeo_change_same_system.sql`
- `supabase/migrations/0048_birth_calves_mono_after_insert.sql`
- `supabase/migrations/0049_birth_calves_service_role_grant.sql`
- `supabase/tests/animal/run.cjs` (bloque T2.19, líneas 1085-1414)
- Contexto leído para validar exploitability (no re-auditado): `0005_rls_helpers.sql` (`has_role_in`/`is_owner_of`), `0023_event_helpers.sql` (`establishment_of_profile`), `0019_animals.sql` (unique index global de TAG).

## Cobertura indirecta de PL/pgSQL / RLS / PostgREST (advertencia)

La skill `sentry-skills:security-review` **NO cubre PL/pgSQL ni el modelo de exposición RPC de PostgREST** — sus guías de injection/authz están orientadas a Python/JS/Go/Rust/Java y a frameworks web (Django/Express/etc.). En este delta:
- **PL/pgSQL (SQL injection en cuerpos de función, SECURITY DEFINER + search_path)**: cubierto a mano. Sin `execute`/`format` con interpolación; todo parametrizado; `search_path` fijado en las 4 funciones nuevas + los 3 helpers reusados. Es la clase donde vivió SEC-HIGH-01 (RPC sin guarda de rol) — verificada explícitamente en cada RPC.
- **RLS / multi-tenant isolation**: cubierto a mano + por tests cross-tenant reales (T2.19 casos 1, 2, 5). `birth_calves` deriva el tenant por join a `animal_profiles`; los RPC derivan de la fila real.
- **PowerSync / BLE / React Native**: N/A — el delta es backend-only (sin sync rules, sin código de cliente, sin Edge Functions nuevas). `est_birth_calves` queda en design para Fase 3.

## Observación no-bloqueante (informativa para el leader)

- `0049` concede `grant select` a `service_role` en vez del `grant all on public.<tabla> to service_role` que usa el resto de las tablas de spec 02 (`0010`/`0019`/`0025`/`0038`). Funcionalmente suficiente y MÁS acotado (menor superficie), pero rompe la consistencia de convención. Desde security NO bloquea (un grant más restrictivo nunca es un riesgo); ya lo registró el reviewer como O1. Decisión de consistencia, no de seguridad — queda a criterio del leader/commit.
