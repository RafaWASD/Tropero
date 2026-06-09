# Gate 1 — Security spec — 15-powersync PASO 2 (deltas backend 0077–0080 + 8 streams nuevas)

**Veredicto: PASS**

Fecha: 2026-06-09 · Modo: `spec` · Input: migraciones `0077`–`0080` + `sync-streams/rafaq.yaml` (8 streams nuevas) + ADR-026 + as-built (`0017`,`0018`,`0022`,`0023`,`0025`–`0030`,`0036`,`0045`,`0008`,`0003`).

## Resumen ejecutivo

El sistema cierra el vector ANTI-SPOOF en **todas** las tablas con `GRANT UPDATE` al cliente. Verifiqué tabla por tabla los GRANTs as-built: el implementer afirma haber cerrado el vector de UPDATE y **lo cumple** — cada columna denormalizada settable por el cliente (las 5 tablas de evento, `rodeo_data_config`, la identidad sobre `animal_profiles`, `member_name` sobre `user_roles`) está forzada por un trigger `BEFORE INSERT OR UPDATE` que re-deriva el valor del padre real e ignora el payload. Las dos tablas server-only (`birth_calves`, `animal_category_history`) están correctamente cubiertas solo con `BEFORE INSERT`. **No queda ningún vector de spoof abierto → no hay replicación cross-tenant por el WAL.**

Las 8 streams equivalen a su RLS as-built salvo **dos no-equivalencias clasificadas como MEDIUM**, ambas **same-tenant correctness** (NO cross-tenant): `ev_birth_calves` (el caso flaggeado) y `est_rodeo_data_config` (asimetría análoga, NO flaggeada por el implementer). Ninguna saca datos del tenant. Por eso PASS con dos MEDIUM accionables, no FAIL.

---

## ANTI-SPOOF — verificación tabla por tabla (lo más crítico)

| Tabla | GRANT cliente as-built | Trigger force | INSERT | UPDATE | Vector UPDATE cerrado |
|---|---|---|---|---|---|
| `weight_events` (0025:47) | `select, insert, update` | `tg_force_establishment_id_from_profile` | ✅ | ✅ (0077:95) | ✅ |
| `reproductive_events` (0026:71) | `select, insert, update` | idem | ✅ | ✅ (0077:114) | ✅ |
| `sanitary_events` (0027:44) | `select, insert, update` | idem | ✅ | ✅ (0077:133) | ✅ |
| `condition_score_events` (0028:35) | `select, insert, update` | idem | ✅ | ✅ (0077:152) | ✅ |
| `lab_samples` (0029:42) | `select, insert, update` | idem | ✅ | ✅ (0077:171) | ✅ |
| `animal_category_history` (0030:60) | `select` (solo) | idem | ✅ (0077:194) | n/a (sin GRANT UPDATE) | ✅ (no hay vector) |
| `birth_calves` (0045:39) | `select` (solo) | `tg_force_establishment_id_from_birth_event` | ✅ (0078:85) | n/a (sin GRANT INSERT/UPDATE) | ✅ (no hay vector) |
| `rodeo_data_config` (0018:174) | `select, insert, update` | `tg_force_establishment_id_from_rodeo` | ✅ | ✅ (0078:130) | ✅ |
| `animal_profiles` (identidad, b1) | `select, insert, update` (0020:77) | `tg_force_animal_identity_on_profile` | ✅ | ✅ `OF (3 cols)` (0079:118) | ✅ |
| `user_roles` (member_name, c2) | `select, insert, update` (0003:45) | `tg_force_member_name_on_user_role` | ✅ | ✅ `OF member_name` (0080:89) | ✅ |

**Conclusión anti-spoof: cerrado en TODAS las tablas con vector de cliente.** El `BEFORE UPDATE` re-deriva siempre desde la fuente de verdad inmutable de facto (perfil / rodeo / `animals` / `users`), así que un `UPDATE ... SET establishment_id = <campo ajeno>` por PostgREST directo no puede dejar la columna infiel. Todos los triggers son `security definer` + `set search_path = public` (correcto: el SELECT al padre corre como owner del schema).

### Sub-vector verificado y descartado: re-parent de un evento a otro tenant
Las 5 tablas de evento permiten `UPDATE` de `animal_profile_id`. Un caller que es miembro de los campos A y B podría `UPDATE weight_events SET animal_profile_id = <perfil de B>`. El `WITH CHECK` de la policy `*_update` (ej. 0025:43-45) exige `is_owner_of(establishment_of_profile(NEW.animal_profile_id)) OR created_by = auth.uid()` → solo pasa si tiene derecho sobre el destino. El force entonces re-deriva `establishment_id = campo B` (correcto) y la stream replica a B, **donde el caller ya tiene rol**. No hay leak a un campo donde el atacante no tiene acceso. La columna queda fiel al destino. **No es finding.**

---

## Equivalencia stream ↔ RLS — verificación tabla por tabla (8 streams)

`establishment_of_profile` (0023:6-10) devuelve solo `establishment_id` del perfil; **NO** filtra `animal_profiles.deleted_at`. Esto es clave para la equivalencia.

| Stream | RLS as-built `*_select` | Filtro de la stream | Equivalente |
|---|---|---|---|
| `ev_weight_events` | `has_role_in(est_of_profile) AND deleted_at IS NULL` (0025:30) | `est_id IN org_scope AND deleted_at IS NULL` | ✅ |
| `ev_reproductive_events` | idem (0026:63) | idem | ✅ |
| `ev_sanitary_events` | idem (0027:36) | idem | ✅ |
| `ev_condition_score_events` | idem (0028:27) | idem | ✅ |
| `ev_lab_samples` | idem (0029:34) | idem | ✅ |
| `est_animal_category_history` | `has_role_in(est_of_profile)` — **sin** filtro de deleted_at (0030:57) | `est_id IN org_scope` | ✅ (la stream es MÁS fiel a la RLS que la V2 del design, que agregaba `animal_profiles.deleted_at IS NULL` de más) |
| `ev_birth_calves` | `re.deleted_at IS NULL AND has_role_in(est_of_profile(re.animal_profile_id))` (0045:26-34) | `est_id IN org_scope` (sin chequeo del parto) | ⚠️ **NO** — MED-1 |
| `est_rodeo_data_config` | `has_role_in(r.est_id) AND r.deleted_at IS NULL` (0018:151-156) | `est_id IN org_scope` (sin chequeo del rodeo) | ⚠️ **NO** — MED-2 |

`org_scope = user_roles WHERE active = true` ⇒ campo vivo (invariante 0076, ya gateado paso 1). Las 6 streams equivalentes están correctas: para los eventos tipados el `deleted_at` propio cubre la fila borrada; para `animal_category_history` la RLS as-built no filtra deleted_at de nada y la stream tampoco → equivalencia exacta.

---

## Findings MEDIUM (same-tenant correctness — NO cross-tenant; no bloquean PASS)

### MED-1 — `ev_birth_calves` over-sync de partos soft-deleteados (el caso flaggeado)

**Evidencia.** `birth_calves_select` (0045:26-34) deriva visibilidad vía `reproductive_events` y filtra `re.deleted_at IS NULL` → tras soft-deletear el evento de parto, las filas dejan de ser visibles por PostgREST (R12.3). `birth_calves` no tiene `deleted_at` propio (0045:12-17) y **no hay propagación del soft-delete del parto a `birth_calves`** (confirmado: ningún trigger lo hace). La stream `ev_birth_calves` (rafaq.yaml:205-210) filtra solo `establishment_id IN org_scope`. → **Si un parto se soft-deletea, la stream sigue replicando sus `birth_calves`** mientras la RLS los oculta. El comentario del YAML (líneas 200-204) y de 0078 (líneas 29-32) ya lo flaggean a propósito.

**Clasificación de severidad: MEDIUM — same-tenant correctness, NO cross-tenant.**
- El `establishment_id` denormalizado se deriva de la **madre del mismo parto** → siempre es el tenant correcto. La stream solo replica a devices del **mismo campo**. **No hay leak cross-tenant.**
- Lo que ve de más un device del campo dueño: los *links* de parentesco (`birth_event_id`, `calf_profile_id` — solo UUIDs, sin PII ni datos sensibles) de un parto borrado **de su propio campo**. Los `animal_profiles` de los terneros siguen visibles por su cuenta (no se borran al soft-deletear el parto). El gap es "el device ve un vínculo parto→ternero que la ficha online ya no muestra".

**Fix recomendado (correctness, no seguridad).** Propagar el soft-delete del parto a `birth_calves`: agregar `deleted_at timestamptz` a `birth_calves` + un trigger `AFTER UPDATE OF deleted_at ON reproductive_events` que setee/limpie `birth_calves.deleted_at` para las filas de ese `birth_event_id`, y filtrar `AND deleted_at IS NULL` en la stream. Alternativa más liviana: que la stream/UI ignore birth_calves cuyo parto está soft-deleteado (pero requeriría un dato del estado del parto en la fila → vuelve a la misma columna). Recomiendo la primera. **No bloquea el deploy del paso 2** (es mismo-tenant); puede ir como fix de seguimiento.

### MED-2 — `est_rodeo_data_config` over-sync de configs de rodeos soft-deleteados (asimetría análoga, NO flaggeada)

**Evidencia.** `rodeo_data_config_select` (0018:151-156) filtra `r.deleted_at IS NULL` → al soft-deletear un **rodeo** (que tiene `deleted_at` propio y se borra independientemente del campo, 0017:16,50-51), su `rodeo_data_config` deja de ser visible por PostgREST. La stream `est_rodeo_data_config` (rafaq.yaml:212-217) filtra solo `establishment_id IN org_scope` y `rodeo_data_config` no tiene `deleted_at` (0018:120). → **Si un rodeo se soft-deletea pero el campo sigue vivo, la stream sigue replicando su `rodeo_data_config`** mientras la RLS lo oculta. Esta asimetría es exactamente la misma forma que MED-1 pero **NO está flaggeada** en el YAML (línea 212 solo nota "sin deleted_at propio") ni en 0078 (línea 33 dice "no tiene deleted_at" pero no menciona el `r.deleted_at IS NULL` de la RLS del padre).

**Clasificación de severidad: MEDIUM — same-tenant correctness, NO cross-tenant.** El `establishment_id` viene del rodeo del mismo campo → tenant correcto; over-sync solo dentro del campo dueño. Lo que ve de más: el toggle de config (`enabled`/`custom_config`) de un rodeo borrado del propio campo.

**Fix recomendado.** Mismo patrón que MED-1: o propagar el soft-delete del rodeo a `rodeo_data_config` (columna + trigger `AFTER UPDATE OF deleted_at ON rodeos` + filtro en la stream), o aceptar el over-sync same-tenant documentándolo explícitamente como decisión (igual que se hizo con MED-1 en el YAML). Lo mínimo accionable: **flaggearlo en el YAML/migración igual que birth_calves** para que no quede como asimetría silenciosa. No bloquea el deploy.

---

## Propagación, b1, c2 — verificación

**Propagación no-loop / no-leak (0079, 0080).**
- `animals.identity → animal_profiles` (0079:125-152): `AFTER UPDATE OF tag_electronic, sex, birth_date ON animals` propaga a `WHERE animal_id = NEW.id` (el mismo animal). El UPDATE a `animal_profiles` toca solo las 3 columnas de identidad → no re-dispara `record_category_change_upd` (escucha `category_id`, 0030:52-53), no re-dispara el force en INSERT, no toca `animals` de vuelta. El guard `is distinct from` (0079:137-139) evita no-ops. **No-loop ✅, no-leak ✅** (propaga la identidad del animal correcto, `NEW.id`).
- `users.name → user_roles.member_name` (0080:95-118): `AFTER UPDATE OF name ON users` propaga a `WHERE user_id = NEW.id`. Toca solo `member_name` → no re-dispara el guard `user_roles_block_active...` de 0076 (escucha `active`), re-dispara el force de `member_name` que re-deriva el MISMO `users.name` (idempotente, sin pelea). Guard `is distinct from` evita no-ops. **No-loop ✅, no-leak ✅.**

**b1 identidad (0079) — animal correcto.** El force (0079:94-97) y la propagación (0079:132-136) derivan de `animals WHERE id = NEW.animal_id` / `WHERE animal_id = NEW.id` → siempre la identidad del animal del perfil. Un animal compartido en 2 campos → 2 `animal_profiles` con la MISMA identidad denormalizada (correcto: es el mismo animal global, ADR-004). La identidad es del **animal**, no del tenant → no hay leak cross-tenant (un device del campo B ve `tag/sex/birth_date` del animal que está físicamente en B). Coherente con que `tag_electronic` es inmutable post-set (0036:23-25), lo que hace el re-tag raro pero el trigger lo cubre. ✅

**c2 member_name (0080) — solo `name`, NUNCA PII.** El force y la propagación copian exclusivamente `users.name` (0080:74, 103). Email/phone viven en `user_private` self-only (ADR-025) y **no se tocan** en 0080. La frontera de visibilidad de `member_name` = la frontera de `user_roles_select` (0008:11-17: `user_id = auth.uid() OR is_owner_of(establishment_id)`), que es la que ya autoriza la stream `self_user_roles` (propio) + `est_members_roles` (coworkers, owner-only). El nombre rides on esos streams sin ampliar la visibilidad. ✅

---

## Backfills + RLS as-built sin cambios

**Backfills (correctos + idempotentes).**
- 0077: cada `UPDATE ... FROM animal_profiles WHERE ap.id = <tabla>.animal_profile_id AND <tabla>.establishment_id IS NULL` → deriva bien, idempotente (solo filas NULL). ✅
- 0078 birth_calves: 2 JOINs `parto → madre → est_id`, guard `IS NULL`. ✅ rodeo_data_config: `FROM rodeos WHERE r.id = rdc.rodeo_id AND IS NULL`. ✅
- 0079: backfill de las 3 columnas `FROM animals WHERE a.id = ap.animal_id` (sin guard NULL pero idempotente por construcción — reescribe el mismo valor; 0079:62 lo nota). ✅
- 0080: `FROM users WHERE u.id = ur.user_id`. ✅

**Orden seguro (0077):** ADD COLUMN nullable → backfill → CREATE trigger → SET NOT NULL. Correcto (un NULL sacaría la fila del sync set silenciosamente; el NOT NULL lo previene). ✅

**RLS as-built NO cambia.** Verificado: ninguna de las 4 migraciones contiene `create policy` / `drop policy` / `alter ... enable row level security` sobre policies existentes. Solo `ADD COLUMN`, `CREATE FUNCTION`, `CREATE TRIGGER`, `UPDATE` (backfill), `SET NOT NULL`, `notify pgrst`. Las columnas son exclusivamente para el stream; la RLS sigue derivando el tenant por FK. ✅ (R11.3/R13.6)

---

## Dominios revisados (catálogo RAFAQ)
- **A1 service-role bypass / A3 IDOR por FK**: el modelo de denormalización es precisamente el control. Verificado que la columna denormalizada (frontera del WAL, paralela a RLS — C1/C2) es fiel al padre y anti-spoof.
- **A2 mass assignment**: el patrón force es lo opuesto al mass assignment — la columna load-bearing se fuerza server-side ignorando el payload.
- **C1/C2 offline/sync (PowerSync)**: foco central. Las streams SON la autorización del wire; verificada equivalencia con RLS.
- **H1 invalidación de sesión**: `user_roles.active` (invariante 0076) ya gateado en paso 1; member_name rides on, no lo altera.

## Dominios excluidos (con justificación)
- **B (information disclosure), F (inyección/SSRF), G (BLE), E (rate limiting / abuso a escala)**: el delta es puramente schema (columnas + triggers + backfill) + config de streams declarativa. No agrega Edge Functions, endpoints, parsers, inputs de usuario nuevos ni superficie de red. Sin campos de entrada de usuario nuevos → tabla de inputs y tabla de rate limits **no aplican** a este delta (los inputs de los eventos/perfiles ya estaban gateados en sus specs originales; este paso no los toca).
- **D (secretos/supply chain)**: sin secretos ni imports nuevos.
- **I (compliance)**: el append-only de `animal_category_history` se preserva (sin GRANT UPDATE/DELETE de cliente; el force no altera la inmutabilidad).

## Tabla de inputs
No aplica — este delta no introduce ni modifica ningún campo que el usuario tipea (formularios, buscadores, texto libre, prompts). Son columnas denormalizadas pobladas exclusivamente por triggers desde tablas padre, nunca por payload del cliente (anti-spoof). Los inputs de las tablas base (`weight_kg`, `notes`, `member_name` vía `users.name`, etc.) fueron gateados en sus specs originales y no cambian acá.

## Tabla de rate limits
No aplica — el delta no toca ninguna acción abusable (Edge Functions, email/SMS, APIs externas, bulk/import, buscadores). Es schema + config de sync declarativa.

---

## Notas de cobertura
- **No se auditó sintaxis de PowerSync** (la valida el dashboard, según instrucción). Foco exclusivo en autorización + fidelidad de la columna denormalizada.
- Las dos MED son de **correctness same-tenant**, no de seguridad multi-tenant. El criterio del gate (PASS si anti-spoof cerrado en todas las tablas con GRANT UPDATE y las no-equivalencias son same-tenant clasificadas con fix) se cumple → **PASS**.
- **Acción mínima sugerida al leader antes de cerrar**: flaggear MED-2 en el YAML/0078 al nivel que ya tiene MED-1 (hoy es una asimetría silenciosa), y decidir si los dos over-sync same-tenant se arreglan (propagar soft-delete) o se aceptan documentados. Ninguna de las dos bloquea el deploy del paso 2.
