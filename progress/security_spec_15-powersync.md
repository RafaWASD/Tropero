# Gate 1 — Security review (modo `spec`) — 15-powersync

> `security_analyzer` modo `spec` (ADR-019). Artefacto auditado: `sync-streams/rafaq.yaml` (design.md §2) — la frontera de autorización del canal de sync (no hay RLS por encima del WAL; ADR-025).
> Fecha: 2026-06-08. Baseline RLS as-built: migraciones `0001..0074`.

## Veredicto: **FAIL**

Hay **1 finding HIGH** (divergencia stream ↔ RLS SELECT que abre leak cross-tenant en un caso concreto y alcanzable). El resto de las streams espejan correctamente su policy de SELECT. Con el fix de HIGH-1 aplicado a TODOS los predicados per-establishment, la spec pasa.

---

## Metodología

Para CADA stream de `rafaq.yaml` (design.md §2) tracé el predicado WHERE contra la policy de SELECT as-built de su tabla base, comparando término a término. La regla de aprobación: **la stream NO puede ser más permisiva que la RLS SELECT**. El helper canónico es:

```sql
-- 0005_rls_helpers.sql
has_role_in(est_id) :=
  EXISTS (SELECT 1 FROM user_roles ur
          JOIN establishments e ON e.id = ur.establishment_id    -- ⬅ join clave
          WHERE ur.user_id = auth.uid()
            AND ur.establishment_id = est_id
            AND ur.active = true
            AND e.deleted_at IS NULL)                            -- ⬅ filtro clave
```

El predicado de scoping que usan TODAS las streams per-establishment es:

```sql
establishment_id IN (SELECT establishment_id FROM user_roles
                     WHERE user_id = auth.user_id() AND active = true)
```

Esta subquery reproduce `ur.active = true` pero **NO reproduce el join a `establishments` + `e.deleted_at IS NULL`** que tiene `has_role_in`. Ahí está el hueco.

---

## Findings HIGH

### HIGH-1 — Las streams per-establishment NO excluyen establecimientos soft-deleteados → divergencia vs `has_role_in`, leak por el WAL

**Severidad: HIGH** (leak cross-tenant/temporal por el canal de sync, alcanzable con el flujo normal de la app).

**Evidencia (la divergencia):**

- `has_role_in` (0005_rls_helpers.sql:16-24) exige `e.deleted_at IS NULL` vía el JOIN a `establishments`. Por eso la policy `establishments_select` (0007:6-9), `animal_profiles_select` (0022:6-7), `rodeos_select` (0017:50-51), `management_groups_select` (0037:60-61), `sessions_select` (0050:68-69), `maneuver_presets_select` (0051:33-34), `semen_select` (0026:26), `animal_events_select` (0034:94-95), y todas las de eventos vía `establishment_of_profile` **dejan de devolver filas en cuanto el establecimiento se soft-deletea**.
- Las streams usan el predicado bare `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true` (design.md §2, repetido en `est_establishments` L112-113, `est_rodeos` L149-150, `est_management_groups` L169-170, `est_animal_profiles` L178-179, `est_animals` L190-191, `est_animal_category_history` L201-202, `est_sessions` L210-211, `est_maneuver_presets` L219-220, `est_semen_registry` L228-229, los 6 `ev_*` y `ev_birth_calves`, `est_rodeo_data_config`, `est_invitations`). Ese predicado **no toca `establishments.deleted_at`**.

**Por qué es alcanzable (no teórico):**

- El soft-delete de un establecimiento es un camino soportado: `establishments_update` (0007:20-24) concede UPDATE al owner, y el patrón as-built de borrado es `set deleted_at = now()` por UPDATE (0002:53 "soft-delete vía update de deleted_at").
- **No hay ningún trigger ni RPC que desactive los `user_roles` cuando un establecimiento se soft-deletea.** Verificado: el único `before update` sobre `establishments` es el `updated_at` genérico (0002:45-47); no existe cascade a `user_roles.active`. (El único lugar que desactiva roles en masa es `delete_account` (0058:42-43), y solo cuando un USUARIO borra su propia cuenta — no cuando se borra un campo.)
- Resultado: tras soft-deletear un establecimiento, sus `user_roles` siguen `active = true`. La RLS de PostgREST corta el acceso (por `has_role_in` → `e.deleted_at IS NULL`), **pero la stream lo sigue sincronizando** porque su subquery solo mira `active`. El device baja/retiene en SQLite local TODO el dataset de un campo que el sistema considera borrado: animales, perfiles, eventos, sesiones, PII de coworkers vía `est_members`, etc.

**Impacto:** ruptura de la frontera de autorización que `requirements.md` R4.2 / R9.1 prometen ("si un usuario no tiene rol activo... no deberá incluir ninguna fila"). Diseño en `7. Seguridad` (design.md:484) afirma explícitamente "cada predicado de stream replica la lógica de la RLS as-built (`has_role_in` inline)" — y acá NO la replica (le falta el filtro de establecimiento soft-deleted). Esto contradice la afirmación central de la spec.

**Stream/requirement afectado:** TODAS las streams per-establishment (≈20 streams) + R4.1, R4.2, R8.2, R9.1, y la afirmación de equivalencia de design §7.

**Fix concreto (corregir el WHERE):** el predicado de scoping inline debe espejar el JOIN de `has_role_in` agregando el filtro de establecimiento vivo. Reemplazar el subselect bare por:

```sql
-- en CADA stream per-establishment, donde hoy dice:
--   ... IN (SELECT establishment_id FROM user_roles
--           WHERE user_id = auth.user_id() AND active = true)
-- usar:
... IN (SELECT ur.establishment_id
        FROM user_roles ur
        JOIN establishments e ON e.id = ur.establishment_id
        WHERE ur.user_id = auth.user_id()
          AND ur.active = true
          AND e.deleted_at IS NULL)
```

Esto cierra HIGH-1 en una pasada para todas las streams que comparten el predicado. Importante: el fix debe tocar también las streams que derivan el establecimiento por animal_profile / rodeo / evento de parto (todas reusan el mismo subselect anidado). Como R8.2 ya pide "dropear localmente las filas de un establecimiento soft-deleteado", este fix es justamente lo que hace que esa baja ocurra por el sync set, no solo por el cierre de PostgREST.

> Nota de reconciliación (design §10): el fix se refleja en design §2 (las ≈20 queries) y bajo R4.1/R4.2/R8.2 de requirements.md antes de deployar.

---

## Findings MEDIUM

### MED-1 — `est_members` segunda query (user_roles del establecimiento) no filtra `deleted_at` del establecimiento y trae roles inactivos — over-sync acotado, NO leak

**Severidad: MEDIUM** (observación del leader, confirmada como NO-leak pero con dos sub-puntos).

La segunda query de `est_members` (design.md:125-128) trae `SELECT * FROM user_roles WHERE establishment_id IN (...campos del usuario...)`. Sobre la observación del leader:

- **NO es leak cross-tenant**: el `establishment_id IN (...)` restringe a los establecimientos donde el propio usuario tiene rol activo. La policy `user_roles_select` (0008:11-17) concede ver TODOS los roles del establecimiento solo a un **owner** (`is_owner_of`); un `field_operator` por PostgREST solo ve su propia fila. **Acá la stream es MÁS permisiva que la RLS de `user_roles` para un no-owner** (le muestra los roles de sus coworkers aunque no sea owner). Sin embargo, esto es **consistente con el modelo de la pantalla "Miembros"** que ya expone perfil público de coworkers (`users_select_coworkers`, 0006:16-31), y `user_roles` no contiene PII (solo `user_id`, `establishment_id`, `role`, `active`, timestamps). El acoplamiento user↔rol dentro de un campo donde el usuario YA opera no cruza tenant. Lo marco MEDIUM (no HIGH) porque amplía levemente la visibilidad respecto de la RLS pero queda dentro de los campos del propio usuario y sin datos sensibles. **Decisión para Raf**: si la intención es que un `field_operator` NO vea la matriz de roles de coworkers, la stream debe condicionar la segunda query a owner (`AND establishment_id IN (... AND role='owner')`). Si "ver quién opera el campo" es deseado, dejar como está y documentarlo.
- **Trae roles inactivos** (`active = false`): la query no filtra `active` en el outer select. Esto NO es leak (sigue dentro de los campos del usuario) pero infla el sync set con filas de roles ya revocados. Es **over-sync**, no fuga. El `self_user_roles` (que sí necesita el histórico del propio usuario) y `est_members` deberían decidir explícitamente si exponer roles inactivos. Recomendación: filtrar `active = true` en la segunda query de `est_members` salvo que la UI necesite mostrar ex-miembros.
- **Hereda HIGH-1**: el subselect interno de `est_members` (ambas queries, design.md:121-124 y 127-128) usa el mismo predicado bare sin `establishments.deleted_at` → al corregir HIGH-1, este también queda cubierto.

**Fix sugerido (si se decide endurecer):**
```sql
-- segunda query de est_members, endurecida a owner + roles activos + fix HIGH-1
SELECT ur.* FROM user_roles ur
WHERE ur.active = true
  AND ur.establishment_id IN (
    SELECT e.id FROM user_roles me JOIN establishments e ON e.id = me.establishment_id
    WHERE me.user_id = auth.user_id() AND me.active = true AND e.deleted_at IS NULL
    -- AND me.role = 'owner'   ← agregar SOLO si la matriz de roles debe ser owner-only
  )
```

### MED-2 — PK sintético de `est_invitations`/`est_members` no incluye `establishments.deleted_at` (caso owner) — mismo origen que HIGH-1

`est_invitations` (design.md:135-141) espeja bien `invitations_select` (0008:46-55) en lo demás: filtra `status='pending'`, `deleted_at IS NULL`, y `role='owner'` (más restrictivo que la RLS, que también deja ver al invitado por email — pero la stream a propósito solo sincroniza el listado del owner, R4.9 / D1; eso es correcto y deliberado). El único hueco es el de HIGH-1 (subselect sin `establishments.deleted_at`): un owner de un campo soft-deleteado seguiría sincronizando sus invitaciones pendientes. Se cierra con el fix de HIGH-1. Lo dejo como MEDIUM separado para que el implementer no lo pase por alto al aplicar el fix (el predicado de invitations tiene su propia copia inline del subselect, con `role='owner'`).

---

## Confirmaciones positivas (lo que SÍ está bien)

Para trazabilidad, estos puntos del foco de auditoría quedaron **verificados como correctos**:

1. **`user_private` self-only (HIGH-confidence OK).** `self_user_private` filtra `user_id = auth.user_id()` (design.md:99), espejo exacto de `user_private_select_self` (0068:105-108). Ninguna otra stream trae `user_private`. **Confirmado que `public.users` ya NO tiene `email`/`phone`** (0068:96 `alter table public.users drop column email, drop column phone`) → `est_members` puede traer la fila `users` completa sin filtrar PII, porque la PII físicamente no vive ahí (ADR-025). La PII está cerrada en TODOS los canales (PostgREST + realtime + WAL). El comentario del design (design.md:129-130) es correcto.

2. **`deleted_at IS NULL` (OK).** Toda tabla con soft-delete lo filtra en su stream y espeja su SELECT-policy: establishments, rodeos, management_groups, animal_profiles, animals, sessions, maneuver_presets, semen_registry, animal_events, las 5 de evento, invitations, y `users` en `est_members`. Excepciones legítimas verificadas:
   - `rodeo_data_config` NO tiene `deleted_at` (0018:109-117; el toggle vive en `enabled`) — su stream correctamente no lo filtra (design.md:152-161). ✅
   - `animal_category_history` NO tiene `deleted_at` (0030:9-17) y su RLS tampoco lo filtra (0030:57-58) — su stream tampoco lo filtra. Consistente. ✅
   - `user_roles` no tiene `deleted_at` (usa `active`/`deactivated_at`, 0003:22-24). Consistente. ✅
   - `birth_calves` no tiene `deleted_at` propio; filtra `reproductive_events.deleted_at IS NULL` (y `animal_profiles.deleted_at`), espejando `birth_calves_select` (0045:26-34). El predicado de la stream (design.md:303-309) reproduce el JOIN y ambos `deleted_at`. ✅ (salvo HIGH-1 en el subselect de establecimiento).

3. **Tablas sin `establishment_id` propio (OK, salvo HIGH-1).** La derivación está bien armada:
   - eventos tipados → `animal_profile_id IN (SELECT id FROM animal_profiles WHERE deleted_at IS NULL AND est ∈ ...)`, espejo de `has_role_in(establishment_of_profile(animal_profile_id))` (0025-0029). ✅
   - `animals` → vía existencia de `animal_profile`, espejo de `animals_select` (0022:21-29). ✅
   - `animal_category_history` → vía perfil, espejo de su SELECT (0030:57-58). ✅
   - `birth_calves` → vía evento de parto + JOIN a animal_profiles, espejo de `birth_calves_select` (0045). ✅
   - `rodeo_data_config` → vía rodeo, espejo de `rodeo_data_config_select` (0018:151-156). ✅

4. **Upload path re-validado server-side (OK, R6.2).** `uploadData` (design.md §5.4) aplica las mutaciones por PostgREST (`upsert`/`update`), así que **RLS + triggers + CHECKs siguen rigiendo**: triggers fuerzan `created_by`/`author_id` desde `auth.uid()` ignorando el payload (0034:31-39, 0043, 0050/0051 force_created_by) → no hay spoofing del autor por la cola; los CHECK de largo de 0070 (capa autoritativa contra storage-exhaustion, attacker-controlled-proof) y de tamaño de jsonb (sessions/maneuver_presets config < 16 KiB, 0050:30 / 0051:18) siguen aplicando; el gating de DB (0054) y la validación de tenant cruzado (lote del mismo establecimiento, 0037:36-55) también. Una op rechazada por RLS (42501, ej. `active_lost`) se descarta (no loop), R8.1. **No hay escalada de privilegios por la cola.** ✅ El default que deja `register_birth`/`exit_animal_profile`/`soft_delete_*`/`import_rodeo_bulk`/`createAnimal` online (RPC SECURITY DEFINER, design.md §5.3) es correcto: esos RPCs derivan la autorización de la fila real de la madre / del establecimiento, nunca del payload (0045:213-225 register_birth), y NO abren bypass.

5. **No-bypass por device (OK, R9.1).** La instancia solo envía a un device su sync set; el device no puede "pedir más". Esto es correcto SIEMPRE QUE las streams scopeen bien — por eso HIGH-1 importa: el único canal es la stream, así que una stream sobre-permisiva ES el leak (no hay segunda barrera). El token no se loguea (nota de supabase.ts citada en el foco; `fetchCredentials` solo pasa `access_token`, design.md:374-377). ✅

---

## Tabla de inputs (campos de usuario que cruzan al servidor por el sync/upload)

> En esta feature el usuario no introduce campos NUEVOS: el wiring reusa los inputs ya gateados (specs 02/03/13). El upload los reenvía a las MISMAS tablas con sus CHECKs. Foco: que el camino de sync no evada la validación server-side existente.

| campo / input | límite (server-authoritative) | validación | OK? |
|---|---|---|---|
| texto libre `animal_events.text` / `structured_payload` | CHECK de largo 0070 (45 cols / 15 tablas) | server (CHECK DB) — aplica también vía upload PostgREST | ✅ |
| `sessions.config` / `maneuver_presets.config` (jsonb) | CHECK `octet_length < 16384` (0050:30 / 0051:18) | server (CHECK DB) | ✅ |
| `calf_tag_electronic` / `tag_electronic` | CHECK largo 64 (0070, grandfather) + validación FDX-B cliente | server (CHECK) + cliente (UX) | ✅ |
| término de búsqueda (search) | acotado en cliente; el local search degrada a `LIKE '%term%'` sobre SQLite | ver nota ⬇ | ⚠️ ver nota |

**Nota search (constraint para Gate 1 code):** la búsqueda hoy (PostgREST) ya parametriza el término (`.ilike(col, pattern)` envía el patrón como VALOR, `escapeIlike` neutraliza comodines `% _ ,`; animals.ts:332-346, 369-371). El design degrada el fuzzy a `LIKE '%term%'` local sobre SQLite (design.md:393). **El SQLite local opera sobre datos YA autorizados por la stream** (no hay escalada de datos posible por el `LIKE`), y design §5.1 establece que las queries van por `db.getAll(sql)` / `db.watch(sql, params)` parametrizado. Riesgo de injection: BAJO siempre que el término se pase como **parámetro bind** (`?`) y NO se concatene en el string SQL. **Esto NO es bloqueante a nivel spec** (es correcto en el diseño), pero queda como **check obligatorio en Gate 1 modo `code`**: verificar que ningún `db.getAll`/`db.watch` interpole el término del usuario por template-string en vez de bind param.

## Tabla de rate limits (acciones abusables tocadas por esta feature)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| sync set inicial / continuo (download) | acotado por scoping (R8.3) | per-`establishment_id` activo del user | sí (sin rol activo → 0 filas) | el tamaño se controla por el WHERE de la stream, NO por rate. HIGH-1 ROMPE esta cota (sincroniza campos borrados). El fix de HIGH-1 también restablece R8.3. |
| upload queue drain (PostgREST) | n.a. en esta feature | — | — | mismo PostgREST que un cliente normal; el rate-limit nativo de Auth no cubre PostgREST, pero esto NO introduce una superficie nueva (la app ya escribe a PostgREST hoy). No es regresión. |
| `fetchCredentials` (getSession + token) | hereda autoRefresh de Supabase Auth | per-user (sesión) | sí (sin sesión → no conecta, design.md:375) | no afloja `[auth.rate_limit]`; no toca `config.toml`. ✅ |

Esta feature **no manda email/SMS, no pega a APIs externas, no agrega Edge Functions nuevas** → no introduce vectores de denial-of-wallet nuevos. La única "cota" relevante es el tamaño del sync set, que es justamente lo que HIGH-1 viola.

---

## Dominios revisados (trazabilidad — Catálogo RAFAQ)

- **A1 (service-role bypass):** la instancia PowerSync corre con `powersync_role` BYPASSRLS sobre el WAL (R1.1) — exactamente por eso la stream ES la única frontera (ADR-025). Auditado como el eje central. La app NO usa `createAdminClient()` en esta feature.
- **A2 (mass assignment):** `uploadData` hace `upsert({...op.opData, id: op.id})` / `update(op.opData)` — el payload viene de la cola local (CrudEntry). Mitigado server-side: triggers fuerzan `created_by`/`author_id` (ignoran payload), RLS valida tenant, CHECKs validan. `establishment_id`/`role` no son spoofeables en el camino offline-safe (eventos derivan tenant del perfil ya autorizado; `register_birth` y demás RPC-bound quedan online y derivan tenant de la fila real). ✅
- **A3 (IDOR por FK):** un evento encolado con `animal_profile_id` de otro tenant sería rechazado por la INSERT-policy (`has_role_in(establishment_of_profile(...))`) al drenar → descartado (R8.1). ✅
- **A4 (BFLA):** las mutaciones owner-only (rodeos, management_groups insert, soft_delete) quedan online vía RPC/PostgREST con su check de rol; el camino offline-safe es solo lo que `has_role_in` (cualquier rol activo) ya permite. ✅
- **B1/B2/B3 (exposición de datos / PII):** `user_private` self-only ✅; `users` sin PII ✅; `est_members` trae fila `users` completa pero sin PII ✅. (MED-1 es over-sync de `user_roles`, no PII.)
- **C1 (sync rules = authz paralela):** AUDITADO — es el objeto central. HIGH-1 + MED-1/2.
- **C3 (data-at-rest local):** fuera del scope de la spec (la spec no define encriptación de la SQLite local). **Recomendación para backlog/ADR**: la SQLite local guarda el dataset completo del campo offline → debería estar encriptada en reposo + tokens en SecureStore (no AsyncStorage). No es finding de ESTA spec (no introduce el problema, lo hereda de ADR-002/PowerSync), pero conviene un ADR de hardening del device. Marcado como nota, no como HIGH.
- **C4 (stale-auth en replay):** CUBIERTO — la spec re-autoriza las mutaciones encoladas al sincronizar (R6.2/R8.1); una op de un campo con rol revocado se rechaza por RLS y se descarta. ✅
- **D1/D3 (secrets):** `EXPO_PUBLIC_POWERSYNC_URL` es endpoint público (no secreto); el `access_token` no se loguea; service_role NO va al cliente. ✅
- **E1 (queries sin tope) / E3 (sync set):** el scoping acota el sync set (R8.3); HIGH-1 lo viola. El fix lo restablece.

## Dominios excluidos (con justificación)

- **D2 (Deno imports), D4 (CI/CD GHA):** no aplica — esta feature no toca Edge Functions ni workflows.
- **F2 (file import), F3 (SSRF), F4 (XSS email):** no aplica — `import_rodeo_bulk` queda online sin cambios; sin fetch externo nuevo; sin templates de email nuevos.
- **G (BLE):** no aplica — la feature no toca BLE (las lecturas BLE entran por el flujo de spec 04, ya gateado).
- **H (auth/sesión):** sin cambios — reusa la sesión Supabase + JWKS existente; el token refresh (R3.2) usa el autoRefresh ya gateado.
- **I (compliance/mobile):** `delete_account` (0058) no se toca; audit trail append-only (eventos) preservado; FLAG_SECURE fuera de scope de esta spec.

---

## Resumen para el leader

- **Veredicto: FAIL** (1 HIGH).
- **HIGH-1**: las ≈20 streams per-establishment usan un subselect de scoping (`user_roles WHERE active=true`) que NO excluye establecimientos **soft-deleteados**, divergiendo de `has_role_in` (que sí filtra `establishments.deleted_at IS NULL`). Como no hay trigger que desactive `user_roles` al borrar un campo, un campo soft-deleteado se sigue sincronizando entero (incluido el perfil de coworkers) aunque PostgREST ya lo cortó. Es un leak por el único canal de autorización del sync (ADR-025). **Fix: agregar `JOIN establishments e ... AND e.deleted_at IS NULL` al subselect en TODAS las streams per-establishment.** Una pasada cierra todo (mismo predicado compartido).
- **MED-1**: `est_members` 2da query trae `user_roles` (incl. inactivos) de coworkers a cualquier rol, más permisivo que la RLS de `user_roles` (que es owner-only para ver coworkers). NO es leak cross-tenant ni PII, pero es over-sync + decisión de visibilidad para Raf (¿un peón ve la matriz de roles del campo?). Filtrar `active=true` y, si se quiere, condicionar a owner.
- **MED-2**: `est_invitations` hereda HIGH-1 en su copia inline del subselect (con `role='owner'`); recordarle al implementer que ese predicado también se corrige.
- **Positivos clave**: `user_private` self-only correcto; `users` sin PII (0068) confirmado; `deleted_at` bien filtrado en todas las tablas con soft-delete (con las excepciones legítimas verificadas); upload re-validado server-side sin escalada; no-bypass por device correcto. Con HIGH-1 corregido (y MED-1/2 decididos por Raf), la spec PASA.
- **Para Gate 1 code**: verificar que el `LIKE '%term%'` local use bind params (no template-string). Considerar ADR de hardening del device (SQLite encriptada at-rest + token en SecureStore) — nota, no bloqueante de esta spec.


---

# RE-VERIFICACION Gate 1 (modo `spec`) tras fix-loop -- 2026-06-08

> `security_analyzer` modo `spec` (ADR-019). Re-check del delta tras los fixes del `spec_author`. Corrida anterior: **FAIL (1 HIGH + 2 MED)**.
> Baseline RLS as-built re-leido: `0005_rls_helpers.sql`, `0006_rls_users.sql`, `0007_rls_establishments.sql`, `0008_rls_membership.sql`, `0022_rls_animals_and_profiles.sql`, `0068_user_private_pii.sql`. Regla: **stream <= RLS SELECT** por tabla.

## Veredicto: **PASS**

Los 3 findings cerraron. **0 HIGH abiertos.** Sin regresiones ni streams olvidadas. Un solo over-sync LOW residual (anexo), no bloqueante.

---

## HIGH-1 -- CERRADO

**Verificacion del predicado canonico en TODAS las streams vivas de seccion 2.**

- El predicado canonico de `has_role_in` re-confirmado en as-built: `0005_rls_helpers.sql:16-24` = `FROM user_roles ur JOIN establishments e ON e.id = ur.establishment_id WHERE ur.user_id = auth.uid() AND ur.active = true AND e.deleted_at IS NULL`. El comentario de la funcion (0005:27-28) lo dice explicito: "y el establishment no esta soft-deleted".
- **Barrido completo del inventario de streams de seccion 2 (27 streams):** 5 catalog (global, sin filtro -- correcto), 2 self (`self_user_private` / `self_user_roles`, `user_id = auth.user_id()` -- self-only correcto), **20 per-establishment**. Las 20 per-est cargan AHORA el predicado canonico con el JOIN a `establishments` + `e.deleted_at IS NULL`:
  - `est_establishments` (L115), `est_members` q1 nombres (L129, alias `me`), `est_members` q2 roles (L139, alias `me` + `me.role='owner'`), `est_invitations` (L159, alias `ur` + `ur.role='owner'`), `est_rodeos` (L170), `est_rodeo_data_config` (L183), `est_management_groups` (L194), `est_animal_profiles` (L205), `est_animals` (L219), `est_animal_category_history` (L232), `est_sessions` (L243), `est_maneuver_presets` (L254), `est_semen_registry` (L265), `ev_weight_events` (L281), `ev_reproductive_events` (L294), `ev_sanitary_events` (L307), `ev_condition_score_events` (L320), `ev_lab_samples` (L333), `ev_animal_events` (L343), `ev_birth_calves` (L355/L359).
- **NO queda ningun subselect bare** (`FROM user_roles WHERE user_id = auth.user_id() AND active = true` sin JOIN) en ninguna stream VIVA. La unica ocurrencia del predicado viejo es L569 -- **prosa de seccion 10, entrada de reconciliacion 2026-06-08** (documentacion del fix, NO una stream). Confirmado: no se cuenta como finding (tal como advirtio el leader).
  - `SELECT * FROM user_roles WHERE user_id = auth.user_id()` en L103 es `self_user_roles` (self-only, sin scoping de establecimiento -- correcto, el usuario siempre ve sus propias filas via `user_roles_select`, 0008:14-16).
- **Conteo de control:** 22 ocurrencias del JOIN canonico (20 con alias `ur` + 2 con alias `me` en `est_members`); 21 ocurrencias de `e.deleted_at IS NULL` dentro de subselects de seccion 2 (las 2 de `est_members` cuentan una c/u; birth_calves suma su propio `re.deleted_at`/`ap.deleted_at` en L355). Cuadra con 20 streams (una con doble query).

**Resultado:** la stream ya NO es mas permisiva que la RLS en el caso del campo soft-deleteado. Un campo con `deleted_at IS NOT NULL` (aunque el `user_role` siga `active = true`, porque no hay trigger que lo desactive -- re-confirmado: no existe cascade a `user_roles.active`) sale del sync set por la stream, espejando `has_role_in`. HIGH-1 cerrado.

## MED-1 -- CERRADO

`est_members` (design.md:117-146), dos queries:

- **Query (2) -- matriz de roles de coworkers (`user_roles`)** (L133-139): ahora `WHERE active = true AND establishment_id IN (... me.role = 'owner' ... e.deleted_at IS NULL)`. Espeja `user_roles_select` (0008:11-17): `user_id = auth.uid() OR is_owner_of(establishment_id)`. La rama de coworkers de la RLS es `is_owner_of` (0005:38-47 = owner + active + `e.deleted_at IS NULL`), que la query (2) replica exacto, y ademas agrega `active = true` en el outer select (la stream es **mas estricta** que la RLS, no mas permisiva -- aceptable). El propio rol del usuario NO llega por aca (viene por `self_user_roles`), correcto. **Gateada a owner como pedia MED-1.**
- **Query (1) -- nombres de coworkers (`users`)** (L121-129): NO gateada a owner, correcto (espeja `users_select_coworkers`, 0006:16-31, que NO es owner-only). Filtra `users.deleted_at IS NULL` y restringe a coworkers de establecimientos VIVOS donde el usuario tiene rol activo. La query agrega `e.deleted_at IS NULL` (mas estricta que la RLS de coworkers, que no lo tiene) -- OK.

**Resultado:** MED-1 cerrado. La reconciliacion quedo documentada en design seccion 2 (comentario L142-146), seccion 7, seccion 10 (entrada 2026-06-08) y en `requirements.md` "Decisiones abiertas para la Puerta 1" #4 (cambiar la visibilidad de la matriz de roles requiere tocar JUNTAS la RLS `user_roles_select` Y la stream -- correcto: evita romper la equivalencia).

## MED-2 -- CERRADO

`est_invitations` (design.md:148-159): `WHERE status = 'pending' AND deleted_at IS NULL AND establishment_id IN (SELECT ur.establishment_id FROM user_roles ur JOIN establishments e ON e.id = ur.establishment_id WHERE ur.user_id = auth.user_id() AND ur.active = true AND e.deleted_at IS NULL AND ur.role = 'owner')`. Hereda el **predicado canonico** (JOIN a establecimientos vivos) + mantiene su gating propio (`role='owner'`, `status='pending'`, `deleted_at IS NULL`). Espeja `invitations_select` (0008:46-55) en lo que sincroniza (la stream solo trae el listado del owner; la RLS ademas deja ver al invitado por email, pero la stream es a proposito mas restrictiva -- D1/R4.9). MED-2 cerrado.

## Sin regresiones / streams olvidadas -- VERIFICADO

- **Las 20 streams per-est** quedaron cubiertas (barrido arriba). Ninguna olvidada.
- **Filtros `deleted_at IS NULL` de la propia tabla MANTENIDOS** tras el fix: `establishments` (L111), `rodeos` (L166), `management_groups` (L190), `animal_profiles` (L201), `animals` (L212), `sessions` (L239), `maneuver_presets` (L250), `semen_registry` (L261), las 5 de evento + `animal_events` (L273/287/300/313/326/339), `invitations` (L154), `users` en `est_members` (L123). El fix AGREGO el `establishments.deleted_at` en el subselect sin tocar el `deleted_at` de la tabla base.
- **Excepciones legitimas intactas:** `rodeo_data_config` (sin `deleted_at` propio -- no lo filtra; deriva del rodeo con su `deleted_at`), `animal_category_history` (sin `deleted_at` -- consistente con su RLS), `user_roles` (usa `active`, no `deleted_at`), `birth_calves` (filtra `reproductive_events.deleted_at` + `animal_profiles.deleted_at`, L355). Catalogos globales sin filtro.
- **Streams self / catalog NO tocadas por el fix** y siguen correctas (no se afecto su scoping).

## Reconciliacion en requirements -- VERIFICADO

- **R4.1** (requirements.md:74-85) ahora redacta el **predicado canonico** literal con `JOIN establishments e ... AND e.deleted_at IS NULL` y declara el filtro de campo vivo como **obligatorio**, citando la ausencia de trigger que desactive `user_roles`. Coherente con design seccion 2 y seccion 7.
- **R4.2** (L86-87) ampliado: cubre explicitamente el caso "establecimiento soft-deleteado aunque el usuario conserve `user_role` con `active = true`" -> no incluye filas. Es exactamente el vector de HIGH-1.
- **R4.9** (L100-101) referencia el predicado canonico con `role = 'owner'` (MED-2).
- **Decision abierta #4** (L229) documenta el owner-gating de `est_members` (MED-1) y la condicion de cambiarlo (RLS + stream juntas).
- **Seccion 10 design** (L568-573) registra la entrada de reconciliacion 2026-06-08 con la lista completa de las ~20 streams tocadas. Coherente con `requirements.md` historial (L234-239).

Jerarquia de verdad respetada: design <-> requirements <-> as-built (RLS) concuerdan. No hay specs contradictorias con el schema.

---

## Finding nuevo (anexo LOW -- NO bloqueante, NO regresion)

### LOW-1 -- `est_members` query (1) no filtra `ur.active` en el inner select -> over-sync acotado de NOMBRES, no leak

La query (1) de nombres (L124-129) hace `id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.establishment_id IN (...campos vivos del usuario...))` **sin** `ur.active = true` en ese inner select. La RLS `users_select_coworkers` (0006:24-29) exige `them.active = true` (el coworker debe tener rol ACTIVO en el campo compartido). Por eso la stream puede bajar el `users` row (id + name) de un ex-coworker cuyo rol ya esta inactivo en el campo -- levemente **mas permisiva que la RLS en la dimension `them.active`**.

- **Por que es LOW (no MED/HIGH):** (a) `public.users` ya NO tiene PII (0068 dropeo email/phone) -> solo se expone `id` + `name`; (b) el over-sync queda acotado a establecimientos donde el propio usuario opera activamente (el outer `me.active = true` + `e.deleted_at IS NULL` sigue cerrando el tenant) -> **no cruza tenant, no es PII**; (c) es over-sync de un nombre publico de alguien que SI estuvo en el campo, no fuga de datos sensibles.
- **No es regresion:** este matiz preexistia a los fixes; el fix-loop no lo introdujo (la query (1) ya era asi en la corrida anterior, donde se evaluo el bloque de nombres como aceptable). No afecta el cierre de HIGH-1/MED-1/MED-2.
- **Recomendacion (opcional, no bloqueante):** agregar `AND ur.active = true` al inner select de la query (1) para espejar exacto `them.active = true` de `users_select_coworkers`. Si la UI de "Miembros" quiere mostrar ex-miembros por nombre, dejar como esta y documentarlo. Decision menor para Raf / Puerta 1; NO frena el PASS.

---

## Confirmacion explicita para el leader

- **HIGH-1: CERRADO** -- predicado canonico (`JOIN establishments e ... AND e.deleted_at IS NULL`) en las 20 streams per-est; 0 subselects bare vivos (el de L569 es prosa de seccion 10, no stream).
- **MED-1: CERRADO** -- `est_members` q2 (roles) gateada a owner + `active = true` (espeja `is_owner_of`); q1 (nombres) NO gateada (espeja `users_select_coworkers`), correcto.
- **MED-2: CERRADO** -- `est_invitations` con predicado canonico + `role='owner'` + `status='pending'` + `deleted_at IS NULL`.
- **Sin regresiones:** filtros `deleted_at` de tabla base mantenidos; excepciones legitimas intactas; self/catalog sin tocar.
- **Reconciliacion coherente:** R4.1/R4.2/R4.9 + decision abierta #4 + seccion 10 design <-> as-built RLS.
- **Finding nuevo:** solo LOW-1 (over-sync de nombres en `est_members` q1), no bloqueante, no regresion.
- **Recordatorios para Gate 1 modo `code` (Gate 2), sin cambios:** bind params en el `LIKE '%term%'` local del buscador; ADR de hardening del device (SQLite at-rest + token en SecureStore) post-MVP.

**Veredicto final: PASS.** La spec 15-powersync queda lista para la Puerta 1 humana desde la optica de Gate 1.

---

# RE-VERIFICACION Gate 1 -- DELTA (2026-06-08)

> `security_analyzer` modo `spec` (ADR-019). Gate 1 **focalizado** sobre el DELTA nuevo de la ultima pasada de diseño: el **delta de backend de idempotencia** (`reproductive_events.client_op_id` + UNIQUE parcial + `register_birth(..., p_client_op_id default null)`) y el **overlay optimista local-only** (§5.3.2/§5.3.3/§5.4.3/§5.4.4/§7-bis; R6.10/R6.11/R6.12/R11.3/R11.4). Esto es la pieza que R11.4 marca schema-sensitive -> Gate 1 obligatorio ANTES de implementar.
> As-built re-leido para el delta: `0045_birth_calves.sql` (register_birth), `0044_exit_reason_enum.sql` (exit_animal_profile), `0005_rls_helpers.sql` (has_role_in / is_owner_of). Las streams (§2) NO se re-auditan por contenido aqui: se confirma que no cambiaron (abajo).

## Veredicto del DELTA: **FAIL**

**1 finding HIGH** (HIGH-D1: la rama idempotente de `register_birth` NO exige verificar pertenencia del parto existente al caller -> lectura cross-tenant por replay/colision de `client_op_id`). El resto del delta (idempotencia natural de `exit_animal_profile`, indice UNIQUE parcial, overlay `localOnly`, no-double-upload, single-CrudEntry) esta **correcto**. Con HIGH-D1 cerrado (la spec debe EXIGIR el orden authz-antes-de-guard + scoping del lookup al tenant del caller), el delta pasa.

> **Las streams (frontera de read-authz) NO cambiaron -> el PASS previo de las streams VALE.** Confirmado: ninguna query de §2 fue tocada por la opcion (ii) ni por el delta. Lo dice el propio design (§7-bis L693 "el PASS de Gate 1 sobre las streams se mantiene intacto"; §7-bis L698 "Ninguna query de §2 se toco por la opcion (ii) ni por el delta de idempotencia"; §10 entrada 2026-06-08). Verificado contra la re-verificacion previa (las 20 per-est con el predicado canonico, las self/catalog intactas). El delta es **write-side** (`reproductive_events.client_op_id` + RPC), no read-authz: no agrega ni modifica ninguna sync stream. La outbox (`op_intents`, `insertOnly`) y el overlay (`pending_*`, `localOnly`) NO existen en el server ni en ninguna stream. **El veredicto FAIL de esta re-verificacion es del DELTA, no de las streams.**

---

## (1) ⚠️ HIGH-D1 -- La rama no-op de `register_birth` NO verifica pertenencia del parto existente al caller -> posible lectura cross-tenant

**Severidad: HIGH** (lectura cross-tenant alcanzable via replay/colision/adivinacion de `client_op_id`, que es un uuid generado en cliente = attacker-controlled). Es exactamente el riesgo principal que señalo el leader, y **se confirma**: la spec describe el guard como un lookup puro, sin la condicion de tenancy.

**Evidencia (lo que la spec EXIGE hoy, literal):**

- **design.md §5.4.3 L591**: "al entrar, si `p_client_op_id IS NOT NULL` y ya existe un parto con ese `client_op_id`, **devolver el `id` del evento existente y RETURN** (no re-crear)."
- **requirements.md R6.10 L148**: "si ya existe un evento de parto con ese `client_op_id`, la RPC **debera** cortar y devolver el resultado existente (no re-crear)."
- **tasks.md T6.4 L57**: "guard: si `p_client_op_id IS NOT NULL` y ya existe un parto con ese `client_op_id` -> devolver el `id` existente y RETURN (no re-crear)."
- **requirements.md R11.3 L192**: "param `p_client_op_id ... con guard de dedup (si ya existe un parto con ese `client_op_id`, cortar y devolver el existente)."

Las CUATRO formulaciones describen el guard como **`SELECT id FROM reproductive_events WHERE client_op_id = p_client_op_id` -> RETURN ese id**. **Ninguna** exige que ese parto existente PERTENEZCA al caller (que la madre del parto este en un establecimiento donde `has_role_in(auth.uid())`). Tampoco fijan el ORDEN: si el guard de idempotencia se ejecuta al inicio del cuerpo (antes del bloque de authz), corre **antes** del chequeo `has_role_in(v_est)` que el as-built (0045:213-225) hace sobre la fila real de la madre.

**Por que es explotable (no teorico):**

- `client_op_id` es un **uuid de cliente** (design.md L485 "id (PK uuid de cliente...) = client_op_id", L577 "uuid de cliente, estable entre reintentos"). El cliente lo elige -> **attacker-controlled**. Un device manipulado puede encolar un `op_intent` de `register_birth` con un `client_op_id` arbitrario.
- El indice UNIQUE es **global sobre toda la tabla `reproductive_events`** (R11.3 L191 "indice UNIQUE parcial sobre esa columna `WHERE client_op_id IS NOT NULL`"), **NO scopeado por tenant**. Asi que un `client_op_id` matchea un parto de CUALQUIER establecimiento, no solo de los del caller.
- Escenario de leak: el atacante (autenticado, con un JWT valido de su propio campo) encola `register_birth` con un `p_client_op_id` que colisiona con el de un parto de OTRO tenant (replay de un id observado, o coleccion/adivinacion). Si el guard corre primero y devuelve `v_birth_event_id` del parto ajeno **sin** chequear `has_role_in` sobre la madre de ESE parto -> el atacante recibe el `id` del `reproductive_events` de otro establecimiento (confirmacion de existencia + el uuid del evento, que luego puede usar como FK-probe). Aunque la stream `ev_reproductive_events` no le sincronice esa fila (bien scopeada), la **RPC** es un canal directo paralelo a la stream: devuelve el id por el path online/RPC, no por el WAL. Es information disclosure cross-tenant (B1/A1/A3 del catalogo) por un canal que la spec deja sin guard.
- Incluso si el guard corriera DESPUES del `has_role_in(v_est)` del as-built: ese chequeo valida `has_role_in` sobre la madre **que el atacante paso en `p_mother_profile_id`** (una madre de SU campo), NO sobre la madre del parto EXISTENTE que el guard va a devolver. Es decir, el atacante pasa una madre propia (pasa la authz) + un `client_op_id` que colisiona con un parto ajeno (el guard devuelve el parto ajeno). **El orden por si solo no alcanza: el guard debe re-validar la authz sobre la fila EXISTENTE, no sobre el param de entrada.**

**Lo que la spec DEBE exigir (fix concreto, a reflejar en design §5.4.3 + R6.10 + R11.3 + T6.4):**

La rama no-op de `register_birth` solo puede cortar-y-devolver si el parto existente con ese `client_op_id` **pertenece al caller**. Concretamente, el guard debe:

1. **Correr el chequeo de authz ANTES (o re-validarlo sobre la fila existente).** El `has_role_in(v_est)` derivado de la fila real de la madre (0045:213-225) se mantiene como primer gate.
2. **Scopear el lookup de idempotencia al tenant del caller Y verificar que apunta a la MISMA madre que el param.** En vez de `SELECT id WHERE client_op_id = p_client_op_id`, el guard debe exigir que el parto existente sea del propio caller. Forma recomendada (pseudo-SQL):

```sql
-- dentro de register_birth, DESPUES de resolver v_est y validar has_role_in(v_est)
if p_client_op_id is not null then
  select re.id into v_existing
  from public.reproductive_events re
  join public.animal_profiles p on p.id = re.animal_profile_id
  where re.client_op_id = p_client_op_id
    and re.animal_profile_id = p_mother_profile_id   -- mismo parto/misma madre que el intent
    and p.establishment_id = v_est;                  -- y del tenant ya autorizado (has_role_in pasado)
  if v_existing is not null then
    return v_existing;        -- no-op idempotente legitimo (mismo caller, mismo parto)
  end if;
  -- si existe un parto con ese client_op_id pero NO matchea (madre/tenant distinto):
  -- NO devolver datos ajenos. Tratar como colision -> error (no leak).
end if;
```

3. **Si el `client_op_id` existe pero apunta a un parto de otra madre/otro tenant: NO devolver el parto ajeno.** Levantar un error generico (ej. `unique_violation` / un `errcode` propio, p.ej. `23505` o `42501` segun se prefiera) **sin** filtrar el id ajeno ni distinguir "existe en otro tenant" de "no existe" (uniformar el mensaje para no dar un oraculo de enumeracion, E4 del catalogo). El error de la RPC se mapea como rechazo permanente en `uploadData` (§5.4.4) -> rollback del overlay + superficia, sin leak.

> **Nota de explotabilidad residual (E4):** aun con el fix, el indice UNIQUE global hace que un `client_op_id` colisionado con otro tenant produzca un `unique_violation` al intentar INSERTAR el `client_op_id` (camino "no existe para mi -> creo"). Eso NO filtra datos (no devuelve el parto ajeno), pero es un oraculo binario de existencia de un `client_op_id` (timing/errcode). Es **information disclosure muy debil** (un uuid de cliente ajeno no es secreto util por si mismo y el espacio uuid hace la colision/adivinacion impractica). Lo dejo como nota, NO como finding bloqueante: el bloqueante es devolver los DATOS del parto ajeno (resuelto por el fix 1-3). Si se quiere cerrar tambien el oraculo, el guard puede capturar el `unique_violation` y devolver un error generico identico al de cualquier otro fallo.

**Requirement/seccion afectado:** R6.10 (bullet `register_birth`), R11.3 (descripcion del guard), R11.4 (Gate 1 debe verificar que la authz NO cambia -> hoy el guard SI cambiaria la superficie de lectura si se implementa literal), design §5.4.3 (1), §7-bis (la afirmacion L697 "las guardas has_role_in sobre la fila real de la madre quedan intactas" es CIERTA para el path de creacion pero NO cubre la rama no-op, que es un path de LECTURA del parto existente sin guard). T6.4 (el cuerpo de la RPC que escribe el implementer).

**Por que es HIGH y no MED:** es un leak cross-tenant concreto por un canal (RPC) paralelo a la stream, con input attacker-controlled (`client_op_id` de cliente), y la spec lo deja sin la condicion de tenancy en las 4 fuentes. Ante la duda HIGH/MED, escalo a HIGH (regla del agente: mejor false positive que false negative en cross-tenant). **El implementer NO debe escribir el cuerpo de `register_birth` con el guard "literal" de la spec: lo escribiria vulnerable.** La spec tiene que corregirse ANTES de T6.4.

---

## (2) `register_birth` con `p_client_op_id` -- authz original rige en TODOS los paths -- PARCIAL (depende de HIGH-D1)

- **Path de creacion (client_op_id nuevo o NULL):** la authz as-built **rige intacta**. `register_birth` (0045:213-225) resuelve `v_est` de la fila REAL de la madre (`p.establishment_id ... WHERE p.id = p_mother_profile_id AND p.deleted_at IS NULL`) y exige `has_role_in(v_est)` (0045:223-224, errcode 42501) ANTES de cualquier insert. El delta agrega `p_client_op_id uuid default null` + persiste `client_op_id` en el `reproductive_events` insertado -> NO toca el bloque de authz ni la derivacion de tenant. ✅ Para la creacion, la authz no se debilita.
- **Path no-op (client_op_id colisiona/replay):** **NO rige** -- es exactamente HIGH-D1. La rama que "corta y devuelve el existente" no tiene authz sobre la fila existente segun la spec. ⛔ (ver HIGH-D1).
- **Path online (`p_client_op_id` NULL = `default null`):** **identico al as-built** ✅. Confirmado: con `default null`, el guard `if p_client_op_id is not null` no entra (design.md L592, R6.10 L148, T6.4 L58). El call online de 3 args (`register_birth(uuid, date, jsonb)`) resuelve por el default. La migracion re-emite el `revoke/grant` con la firma tipada completa nueva `(uuid, date, jsonb, uuid)` + `notify pgrst` (design.md L593, mismo patron que 0045:297-300). El indice UNIQUE parcial (`WHERE client_op_id IS NOT NULL`) NO impone unicidad sobre los partos historicos (todos NULL) -> no rompe data existente. ✅
- **Grant a `authenticated` sin ampliar superficie:** el delta mantiene `grant execute ... to authenticated` (la RPC sigue siendo el camino de carga de partos del cliente, 0045:296-298). No concede a `anon`/`public`. R11.4 exige verificar esto en la migracion -> queda como check del implementer/Gate sobre la migracion real (≥0075), no verificable hoy (la migracion no existe aun). Nota para el gate de la migracion: confirmar `revoke ... from public, anon` + `grant ... to authenticated` con la firma de 4 args.

## (3) Indice UNIQUE parcial (`WHERE client_op_id IS NOT NULL`) -- CORRECTO

- **No rompe partos historicos:** todos los `reproductive_events` de parto as-built tienen `client_op_id` NULL (columna nueva nullable). El indice parcial los excluye -> sin violacion de unicidad retroactiva. ✅ (design.md L592, R11.3 L191).
- **Garantiza unicidad solo de los nuevos:** dos intents con el MISMO `client_op_id` (reintento) chocan en el INSERT -> es el mecanismo de dedup. ✅
- **Sin colision cross-tenant problematica MAS ALLA de HIGH-D1:** el indice es global (no por tenant), pero eso por si solo no es leak -- el leak surge SOLO si la rama no-op devuelve datos ajenos (HIGH-D1). Con el fix de HIGH-D1 (scoping del lookup al tenant + no devolver ajeno), el indice global es aceptable: un `client_op_id` colisionado entre tenants produce a lo sumo un `unique_violation` (creacion) o un error generico (no-op), nunca datos ajenos. ✅ (sujeto a HIGH-D1). El espacio uuid (122 bits aleatorios) hace la colision accidental/adivinacion impractica; el unico vector real es el **replay** de un `client_op_id` observado -> cerrado por el fix de HIGH-D1.

## (4) `exit_animal_profile` SIN delta -- idempotencia natural CONFIRMADA CORRECTA

Re-verificado contra `0044_exit_reason_enum.sql:27-61`. La afirmacion de la spec (R6.10 L149, design §5.4.3(2) L595-607) es **correcta**:

- La RPC es una **transicion de status** (`UPDATE animal_profiles SET status, exit_reason, exit_date, exit_weight, exit_price WHERE id = p_profile_id`, 0044:55-59), NO un insert con side-effects ni un soft-delete.
- **NO setea `deleted_at`** (queda NULL, comentario explicito 0044:60 "deleted_at queda NULL: NO es soft-delete"). -> En el reintento, el `SELECT establishment_id, created_by ... WHERE id = p_profile_id AND deleted_at IS NULL` (0044:38-39) **re-encuentra** la fila, **re-pasa la authz** (`has_role_in(v_est) AND (is_owner_of(v_est) OR v_creator = auth.uid())`, 0044:48-50) y re-aplica un UPDATE de status **identico** -> mismo end-state. Idempotente. ✅
- **NO toca `category_id`:** el UPDATE (0044:55-59) escribe `status, exit_reason, exit_date, exit_weight, exit_price`, NUNCA `category_id`. Por eso el trigger `animal_profiles_record_category_change_upd` (AFTER UPDATE **OF category_id**, segun la cita de la spec a 0030:52-54) **NO dispara** -> no se inserta una 2da fila en `animal_category_history`. Verificado el set de columnas del UPDATE: ningun side-effect no idempotente. ✅
- **`coalesce(p_exit_weight, exit_weight)`** (0044:57): un reintento con el mismo `p_exit_weight` deja el mismo valor; si el reintento viniera con NULL, el coalesce preserva el valor ya escrito -> sigue idempotente. ✅
- **No encontre ningun side-effect no idempotente** en un cambio de status sobre `animal_profiles` por esta via. **`exit_animal_profile` es naturalmente idempotente -> SIN delta es correcto.** ✅ (Mismo razonamiento aplica a `soft_delete_*` por la guarda `deleted_at IS NULL` + manejo del `P0002` como exito idempotente, §5.4.3(4) / §5.4.4 -- correcto, no es foco de esta re-verificacion pero queda confirmado de paso.)

## (5) Overlay `localOnly` (`pending_*`) -- CONFIRMADO local-only, sin superficie de stream/RLS/WAL

- Las tablas `pending_animal_profiles`, `pending_animals`, `pending_birth_calves`, `pending_reproductive_events`, `pending_status_overrides` se declaran `{ localOnly: true }` en `AppSchema` (design.md L510-518). PowerSync: una tabla `localOnly` **NO genera CrudEntry** (design.md L495, L508) -> `uploadData()` nunca la ve -> **no se sube**. ✅
- **No existen en el server ni en ninguna sync stream** (design §7-bis L696 "Ninguna existe como tabla server, ninguna esta en una sync stream -> sin superficie de stream/RLS/WAL"). Verificado contra §2: no hay stream `pending_*` ni `op_intents`. -> Un coworker NO puede recibir el overlay de otro (no se replica). ✅
- **No exponen PII ni datos ajenos:** el overlay espeja datos del PROPIO campo que el usuario ya esta autorizado a ver/crear (es su propia op optimista). `op_intents` (`insertOnly`) lleva solo `op_type` + `params_json` + `client_op_id` (design.md L483-490) -> sin PII. ✅
- **No se filtran al server:** confirmado que el unico canal de subida es `op_intents` (insertOnly -> CrudEntry -> RPC). El `pending_*` se limpia local (`clearOverlay`/`rollbackOverlay`, design §5.4.4) y nunca se hace `from('pending_*').insert(...)` ni `from('op_intents').insert(...)` plano (design.md L496 "nunca se hace supabase.from('op_intents').insert(...)"). ✅

## (6) No double-upload -- CONFIRMADO single CrudEntry = el `op_intent`

- El hueco double-upload (diseño previo escribia la fila optimista en tablas SINCRONIZADAS *y* encolaba el intent -> 2 CrudEntry -> RPC corre 2 veces) esta **cerrado** moviendo el efecto optimista al overlay `localOnly` (design.md L502, §5.3.3, R6.12). ✅
- **La unica CrudEntry de una op (b) es su `op_intent`** (`insertOnly`): design.md L640 "la unica CrudEntry que uploadData() ve para una op (b) es su op_intent... la RPC corre UNA sola vez". R6.12 L155 lo hace verificable por test (T6.5 L59, T7.9 L75: "exactamente UNA CrudEntry en la upload queue"). ✅
- **No hay insert plano paralelo** de la fila optimista que se suba junto con el intent: el overlay `localOnly` no genera CrudEntry (punto 5) -> no existe la 2da fuente. ✅
- **Reconciliacion de ids server-side de `register_birth`:** correcto -- como los terneros del overlay llevan ids de cliente PROVISIONALES (design.md L523) y la RPC asigna ids SERVER-SIDE (0045:241/261/278, `returning id into ...`), el overlay se limpia en el ACK (`clearOverlay`) y las filas reales bajan por la stream sin colision de id (design.md L642, L759). Si las filas optimistas vivieran en tablas sincronizadas, quedarian duplicadas permanentemente contra las reales -> el overlay local-only lo evita. ✅

---

## Tabla de inputs -- DELTA (campos nuevos del write-path opcion ii)

| campo / input | limite (server-authoritative) | validacion | OK? |
|---|---|---|---|
| `p_client_op_id` (uuid de cliente, va a `register_birth`) | tipo `uuid` (cast server) + indice UNIQUE parcial | server (tipo + UNIQUE); **PERO la rama no-op NO valida tenancy** | ⛔ HIGH-D1 |
| `op_intents.op_type` | set cerrado de op_types validos (mapeo en `applyIntent`, design.md L561) | cliente (mapeo) + server (la RPC destino valida) | ✅ (la RPC rechaza un op_type inexistente; el routing por `rpcName` es del cliente) |
| `op_intents.params_json` | params de la RPC; cada RPC valida su payload server-side | server (cada RPC: `register_birth` valida `p_calves` 0045:227-234; `exit_animal_profile` valida `p_status` 0044:52-53) | ✅ (la authz/validacion vive en la RPC, no en el intent) |
| overlay `pending_*` (efecto optimista) | local-only, no se sube, no cruza al server | n.a. (no es input al server) | ✅ |

> **Nota bind-params (recordatorio Gate 2):** `params_json` y cualquier termino de query local deben pasar por bind params, nunca interpolacion (design §7-bis L698(f) + §7 L686). Foco de Gate 2 (code), no de esta re-verificacion spec.

## Tabla de rate limits -- DELTA

| accion | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| drenado outbox -> `supabase.rpc('register_birth' | ...)` | n.a. en esta feature | per-user (JWT de la sesion) | si (sin sesion -> no conecta; RPC rechaza sin authz) | mismo PostgREST/RPC que un cliente online; no agrega EF nueva ni email/SMS/API externa. La RPC re-valida authz server-side (§7-bis L695). No es vector de denial-of-wallet nuevo. Un reintento at-least-once esta acotado por el backoff de PowerSync (no es un loop de RPC sin freno -> permanente se descarta, R3.5/R8.1). |
| `register_birth` invocada con `client_op_id` colisionado (probe) | n.a. | per-user | si | **HIGH-D1**: sin el fix, cada probe puede devolver datos ajenos. Con el fix, un probe devuelve error generico (no datos). El oraculo de existencia residual (nota E4 en HIGH-D1) es debil; el espacio uuid lo hace impractico. No requiere rate limit propio mas alla del fix de HIGH-D1. |

---

## Dominios revisados -- DELTA (Catalogo RAFAQ)

- **A1 (service-role bypass):** la instancia PowerSync corre BYPASSRLS, pero el delta es write-side via RPC (no toca el WAL del read-path). Las RPCs corren SECURITY DEFINER y derivan authz de la fila real (0045/0044). El leak de HIGH-D1 NO es por service-role sino por la rama no-op sin guard de tenancy. Auditado.
- **A3 (IDOR por FK / cross-tenant read):** **HIGH-D1** -- la rama no-op de `register_birth` puede devolver el `id` de un `reproductive_events` de otro tenant via `client_op_id` colisionado. Es IDOR por la clave de idempotencia attacker-controlled. ⛔
- **A4 (BFLA):** el path de creacion de `register_birth` re-valida `has_role_in` (0045:223) -> un field_operator sin rol en el campo de la madre es rechazado. Correcto para creacion; la rama no-op es el hueco (HIGH-D1).
- **B1 (information disclosure):** **HIGH-D1** devuelve el id de un parto ajeno (confirmacion de existencia + uuid del evento). Es disclosure cross-tenant por canal RPC paralelo a la stream.
- **C4 (stale-auth en replay):** el delta re-valida authz en cada drenado (las RPCs corren con el JWT actual). Una op a un campo con rol revocado -> 42501 -> rollback (§5.4.4, R8.1). ✅ para el path de creacion. (HIGH-D1 es un problema distinto: lectura cross-tenant, no stale-auth.)
- **E4 (enumeration):** nota residual en HIGH-D1 -- el indice UNIQUE global puede dar un oraculo binario de existencia de `client_op_id` por errcode/timing. Debil; uniformar el error generico lo cierra. No bloqueante.
- **Idempotencia como control de integridad (no de authz):** correcto que el `client_op_id` es para no-doble-apply (§7-bis L697), PERO la spec confunde "guard de idempotencia" con "no necesita authz" -- la rama no-op ES un read y necesita authz (HIGH-D1). El delta de columna+indice por si solo no debilita ninguna policy; el problema es el CUERPO del guard que la spec especifica.

## Dominios excluidos -- DELTA (con justificacion)

- **Streams / read-authz (§2):** NO se re-auditan -- no cambiaron (confirmado arriba); el PASS previo vale.
- **C1/C2/C3 (PowerSync sync rules / Realtime / data-at-rest):** sin cambio por el delta (write-side). El overlay local-only se confirmo sin superficie (punto 5).
- **D2/D4, F, G, H, I:** no aplica al delta (no toca Deno imports, CI, file import/SSRF, BLE, auth/sesion, compliance). El delta es 1 columna + 1 indice + 1 param de RPC + tablas locales.

---

## Confirmacion explicita para el leader -- DELTA

- **Streams sin cambios -> PASS previo de streams VALE.** Confirmado contra §2/§7-bis/§10: ninguna query de sync stream fue tocada por la opcion (ii) ni por el delta de idempotencia. La frontera de read-authz (las 20 per-est con predicado canonico + self/catalog) sigue como en la re-verificacion previa.
- **Veredicto del DELTA: FAIL (1 HIGH).**
- **(1) HIGH-D1 -- el riesgo cross-tenant del no-op-return: CONFIRMADO.** La spec (design §5.4.3 L591, R6.10 L148, R11.3 L192, T6.4 L57) describe el guard de `register_birth` como un lookup PURO por `client_op_id` que devuelve el parto existente, **SIN exigir que ese parto pertenezca al caller**. Como `client_op_id` es un uuid de cliente (attacker-controlled) y el indice UNIQUE es global (no por tenant), un atacante puede, via replay/colision, hacer que la rama no-op le devuelva el `id` de un parto de OTRO establecimiento por el canal RPC (paralelo a la stream). **Fix exigido: la rama no-op solo corta-y-devuelve si el parto existente es del propio caller** (authz `has_role_in` re-validada sobre la fila EXISTENTE + lookup scopeado a `establishment_id = v_est` AND `animal_profile_id = p_mother_profile_id`); si el `client_op_id` colisiona con un parto ajeno -> error generico, NUNCA devolver datos ajenos. Reflejar en design §5.4.3, R6.10, R11.3, R11.4 y T6.4 ANTES de que el implementer escriba el cuerpo de la RPC (T6.4). **El guard "literal" de la spec se implementaria vulnerable.**
- **(2) authz de `register_birth`:** path de creacion + path online (`p_client_op_id` NULL) **intactos/identicos al as-built** ✅; path no-op = HIGH-D1 ⛔.
- **(3) indice UNIQUE parcial:** correcto (no rompe historicos, unicidad solo de nuevos); colision cross-tenant inocua SOLO con el fix de HIGH-D1 ✅.
- **(4) `exit_animal_profile` sin delta:** idempotencia natural **CONFIRMADA correcta** contra 0044 (transicion de status, no setea `deleted_at`, no toca `category_id` -> no dispara trigger de category_history; reintento = mismo end-state). ✅
- **(5) overlay `localOnly`:** confirmado local-only, no genera CrudEntry, sin superficie de stream/RLS/WAL, sin PII, no se filtra al server. ✅
- **(6) no double-upload:** confirmado single CrudEntry = el `op_intent`; sin insert plano paralelo; reconciliacion de ids server-side correcta via clear-on-ACK. ✅
- **Otros findings:** ninguno HIGH adicional. Nota E4 (oraculo de existencia debil por el UNIQUE global) NO bloqueante. Recordatorios de Gate 2 sin cambios (bind params en `params_json` y `LIKE` local; ADR de hardening del device post-MVP).
- **Recordatorio para la migracion del delta (≥0075, R11.4):** cuando el implementer la escriba, el gate sobre la migracion real debe confirmar (a) `revoke ... from public, anon` + `grant ... to authenticated` con la firma de 4 args + `notify pgrst`; (b) que el cuerpo implementa el fix de HIGH-D1 (no el guard literal); (c) que ninguna policy/RLS/trigger as-built se toco. La migracion NO existe hoy (as-built llega a 0074) -> esos checks son del gate de la migracion, no de esta re-verificacion spec.

**Veredicto del DELTA: FAIL** (HIGH-D1). El PASS de las streams se mantiene. Con HIGH-D1 corregido en la spec (guard de tenancy en la rama no-op de `register_birth`), el delta pasa.

---

# RE-VERIFICACION Gate 1 — DELTA (fix HIGH-D1, 2026-06-08)

> `security_analyzer` modo `spec` (ADR-019). Re-check FOCALIZADO del delta del fix tras la corrida anterior (FAIL: HIGH-D1 = IDOR cross-tenant en la rama idempotente de `register_birth`). El `spec_author` aplicó el fix. As-built re-leído para confirmar las premisas del fix: `0026_reproductive_events.sql` (schema/RLS), `0045_birth_calves.sql:205-300` (authz + grants de `register_birth`). Las streams (§2) NO se re-auditan: no cambiaron — su PASS vale.

## Veredicto del DELTA: **PASS**

**HIGH-D1 CERRADO.** El guard idempotente de `register_birth` ahora es un lookup SCOPEADO al caller en las 3 fuentes (design/requirements/tasks), con authz `has_role_in(v_est)` rigiendo primero y error genérico ante colisión ajena. **0 HIGH abiertos.** Sin regresiones. Sin findings nuevos.

---

## (1) HIGH-D1 — CERRADO (verificado en las 3 fuentes)

El guard ya NO es un lookup puro/global por `client_op_id`. En las 3 fuentes el lookup está scopeado al caller (misma madre + mismo tenant + vivo) y la authz rige primero:

- **design.md §5.4.3(1) (L593-615)**: el guard se reescribió a 4 reglas explícitas. (1) `has_role_in(v_est)` sobre la fila REAL de la madre va PRIMERO (0045:213-225), y la spec aclara que "authz antes del guard NO alcanza" → re-valida sobre la fila existente. (2) Pseudo-SQL (L596-613) con el lookup scopeado: `WHERE re.client_op_id = p_client_op_id AND re.animal_profile_id = p_mother_profile_id AND p.establishment_id = v_est AND re.deleted_at is null` (JOIN a `animal_profiles`). (3) Ante colisión ajena (otra madre/otro tenant) → cae al camino de creación → `unique_violation`/`23505` genérico, NUNCA devuelve datos ajenos ni oráculo (E4). (4) índice compuesto como defensa-en-profundidad. El header L593 advierte explícito: "El implementer NO debe escribir el guard literal — saldría VULNERABLE (IDOR cross-tenant)".
- **requirements.md R6.10 (L148)**: bullet `register_birth` ahora dice "dedup EXPLÍCITA por `client_op_id`, SCOPEADA AL CALLER", con la "⚠️ Invariante de seguridad (fix HIGH-D1)": el guard es path de lectura → authz primero + lookup scopeado a `animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est + deleted_at IS NULL`; colisión ajena → error genérico, NUNCA datos ajenos ni oráculo. **R11.3 (L192)** describe el param `p_client_op_id` con "guard de dedup scopeado al caller" + el lookup literal. **R11.4 (L196)** exige que Gate 1 verifique que el cuerpo implementa el scoping de tenancy (NO el lookup global) — convierte el fix en un check obligatorio del gate del delta.
- **tasks.md T6.4 (L57-60)**: cuerpo de la RPC con las 3 reglas (authz primero / lookup scopeado literal `WHERE re.client_op_id = p_client_op_id AND re.animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est AND re.deleted_at IS NULL` / colisión ajena → error genérico, nunca datos ajenos) + aviso ⛔ explícito de NO escribir el guard literal global.

**NINGUNA de las 3 fuentes describe ya el lookup puro/global como guard ACTIVO.** Barrido confirmatorio: las únicas ocurrencias del lookup global ("lookup PURO", "SELECT id WHERE client_op_id → RETURN") aparecen en:
- design §10 entrada 2026-06-08 (L800) — prosa que describe la CAUSA del HIGH-D1 (documentación del fix), no el guard activo.
- design §9-nota (L748-755) — el índice global descripto como **descartado** (la opción elegida es el compuesto).
- requirements §Historial (L295-300) y tasks (línea de reconciliación) — documentación del fix.
Tal como advirtió el leader, las entradas históricas/§10/§9-nota son documentación del fix y NO se cuentan como finding. **Confirmado: 0 fuentes con el guard vulnerable activo.**

**Premisas del fix verificadas contra el schema real (no asumidas):**
- `reproductive_events` (0026:32-66) **NO tiene `establishment_id`** — solo `animal_profile_id`. La RLS deriva tenant vía `establishment_of_profile(animal_profile_id)` (0026:64,66). → El ancla del scoping del fix (`animal_profile_id = p_mother_profile_id` + JOIN a `animal_profiles.establishment_id = v_est`) es la derivación CORRECTA de tenencia. OK.
- `register_birth` (0045:213-225) deriva `v_est` de la fila REAL de la madre (`p.establishment_id ... WHERE p.id = p_mother_profile_id AND p.deleted_at IS NULL`) y exige `has_role_in(v_est)` (errcode 42501) ANTES de cualquier insert. El fix lo mantiene como primer gate y, además, re-ancla el lookup en la fila existente (no en el param). OK.

## (2) Índice compuesto `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` — CORRECTO

Cambió de global `(client_op_id)` a compuesto en las 3 fuentes (design L590/§9-nota L748-755, requirements R11.3 L191, tasks T6.4 L56). Verificado contra ambos objetivos:

- **(a) Idempotencia del reintento legítimo del MISMO caller — PRESERVADA.** Un reintento usa la MISMA madre (`p_mother_profile_id`) + el MISMO `client_op_id` → la tupla `(animal_profile_id, client_op_id)` colisiona **consigo misma** → el INSERT del 2do parto choca con el UNIQUE → no doble-parto. El guard procedural lo intercepta antes (lookup scopeado matchea su propia fila → `return v_existing`). Doble defensa: el guard devuelve el existente; si por carrera el guard no lo viera, el índice corta el INSERT. OK.
- **(b) Elimina el oráculo de existencia cross-tenant — SÍ.** El INSERT del atacante usa SU propia `animal_profile_id` (madre de su campo) → la unicidad por `(madre, client_op_id)` significa que el `client_op_id` ajeno colisionado con el de otro tenant **nunca colisiona** (madre distinta) → no hay `unique_violation` diferencial → desaparece el oráculo binario de existencia (E4). La fila ajena ni se toca. Verificado contra el schema: como `reproductive_events` no tiene `establishment_id`, `animal_profile_id` es el ancla de tenancy natural (deriva el establecimiento vía `animal_profiles`) — el compuesto por `(animal_profile_id, client_op_id)` es semánticamente "por madre". OK.

La §9-nota (L748-755) documenta correctamente que el guard procedural es el requisito MÍNIMO (cierra el leak de DATOS de la rama no-op) y el índice compuesto es defensa-en-profundidad (cierra el oráculo E4). Análisis correcto: el índice controla la colisión de INSERT, no el lookup/return de la rama no-op — por eso ambos van. OK.

## (3) Sin regresiones — VERIFICADO

- **Path online (`p_client_op_id` NULL) idéntico al as-built.** design L616, R6.10 (al final del bullet), T6.4 L61: con `default null` el guard `if p_client_op_id is not null` no entra → comportamiento idéntico. El índice es PARCIAL (`WHERE client_op_id IS NOT NULL`) → no impone unicidad sobre los partos históricos (todos NULL). OK.
- **authz `has_role_in` intacta.** El fix NO toca el bloque de authz as-built (0045:213-225) — lo mantiene como primer gate y lo refuerza re-validando sobre la fila existente. No debilita ningún path; el path de creación sigue derivando tenant de la fila real de la madre (0045:213-214 verificado: `p.establishment_id` del SELECT real, herencia `v_est` a los terneros, NUNCA del payload). OK.
- **Sync streams NO cambiaron — PASS de streams se MANTIENE.** El delta es write-side (columna + índice + param de RPC). Confirmado contra §7-bis (L717 "el PASS de Gate 1 sobre las streams se mantiene intacto") y §10. Ninguna query de §2 fue tocada. OK.
- **`exit_animal_profile` SIN delta — intacto** (idempotencia natural por transición de status, ya confirmado en la corrida anterior contra 0044; no cambió). OK.
- **Overlay local-only + no-double-upload — intactos** (overlay `pending_*` `localOnly`, single CrudEntry = `op_intent`; ya confirmados, no tocados por el fix de HIGH-D1, que es server-side en la RPC). OK.

## (4) Test negativo cross-tenant (T7.7) — EXIGIDO

`tasks.md T7.7` (L73) ahora incluye el **caso negativo cross-tenant obligatorio (fix HIGH-D1)**: "un usuario A invoca `register_birth` con una madre PROPIA + un `p_client_op_id` que colisiona con un parto del usuario B (otro establecimiento) → la RPC NO devuelve el `id`/datos del parto de B (no IDOR), responde con error genérico (`unique_violation`/`23505`), y NO se filtra existencia/propietario del parto ajeno. El parto de B queda intacto." Esto cubre exactamente el vector de HIGH-D1 y es el contrato verificable. OK. (Además R11.4 L196 lo eleva a check obligatorio del propio Gate 1 sobre la migración real cuando exista.)

## Confirmación explícita para el leader — DELTA fix

- **HIGH-D1: CERRADO.** Guard scopeado al caller (`re.client_op_id = p_client_op_id AND re.animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est AND re.deleted_at IS NULL`) con `has_role_in(v_est)` primero, en las 3 fuentes (design §5.4.3(1) / R6.10+R11.3 / T6.4). Colisión ajena → error genérico, nunca datos ajenos ni oráculo. NINGUNA fuente describe el lookup puro/global como guard activo (las ocurrencias restantes son §10/§9-nota/Historial = documentación del fix). Premisas verificadas contra el schema real (0026 sin `establishment_id`; 0045 authz primero).
- **Índice compuesto `(animal_profile_id, client_op_id)`:** correcto — preserva la idempotencia del reintento legítimo del mismo caller (colisiona consigo mismo) y elimina el oráculo cross-tenant (el INSERT del atacante usa su propia madre → nunca colisiona).
- **Sin regresiones:** path online idéntico (default null + índice parcial); authz intacta; streams sin cambios (PASS de streams vale); `exit_animal_profile`/overlay/no-double-upload intactos.
- **Test negativo (T7.7):** exigido — A no recibe el parto de B por `client_op_id` colisionado, error genérico, parto ajeno intacto.
- **Findings nuevos:** NINGUNO. Sin HIGH/MED nuevos. La nota E4 (oráculo de existencia) quedó cerrada por el índice compuesto.
- **Recordatorio para el gate de la migración real (≥0075, R11.4):** cuando el implementer escriba la migración, el gate sobre el SQL real debe confirmar (a) el cuerpo implementa el guard scopeado (NO el literal global); (b) `revoke ... from public, anon` + `grant ... to authenticated` con la firma de 4 args `(uuid, date, jsonb, uuid)` + `notify pgrst`; (c) índice compuesto parcial; (d) ninguna policy/RLS/trigger as-built tocada. La migración NO existe hoy (as-built llega a 0074) → checks del gate de la migración, no de esta re-verificación spec.

**Veredicto del DELTA fix: PASS.** HIGH-D1 cerrado sin regresiones ni issues nuevos. La spec 15-powersync queda lista para implementación desde la óptica de Gate 1: el leader puede habilitar el `implementer` (T6.4 incluido), con el recordatorio de que el gate de la migración real (≥0075) re-verifica el cuerpo del guard contra el SQL escrito.
