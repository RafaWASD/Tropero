# ADR-026 — Denormalización de `establishment_id` para el sync JOIN-free de PowerSync

- **Estado**: **aceptado** (2026-06-09). Raf aprobó **(B) b1** (denormalizar identidad de `animals` sobre `animal_profiles`) y eligió **(C) c2** (denormalizar `name` sobre `user_roles` → nombres de coworkers offline).
- **Fecha**: 2026-06-09
- **Contexto de la feature**: `15-powersync` (paso 2). Depende de ADR-002 (stack/PowerSync), ADR-004 (multi-tenancy: `animals`/`users` globales), ADR-025 (PII self-only, frontera WAL).
- **Supersede parcialmente**: nada. **Complementa** el modelo V3 JOIN-free del paso 1 (ya aplicado + Gate-1-PASS, `progress/security_spec_15-powersync-v3-joinfree.md`).

## Contexto

El modelo de sync de PowerSync (Sync Streams, ed. 3) **NO tolera JOINs en las data queries**: cada tabla JOINeada se evalúa como una *parameter query* independiente que enumera **toda** la tabla → `[PSYNC_S2305] too many buckets (limit of 1000)` (regresión powersync-service #611). Quedó probado en el paso 1, en vivo:

- **V1** (subselects anidados) → PSYNC_S2305.
- **V2** (`with: org_scope` + `INNER JOIN establishments` para el `deleted_at` del campo) → **siguió fallando** en runtime: PowerSync evaluó el `INNER JOIN establishments` como una parameter query que enumeró los ~102 campos vivos de toda la DB **por stream** → ~1020 buckets → explotó. Log probatorio: `"Stream est_rodeos evaluating parameter on establishments: 102"`.
- **V3 (JOIN-FREE, vigente, validado en vivo)**: cada stream filtra **directo** `WHERE establishment_id IN org_scope` (sin JOINs), con
  `org_scope = SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`.
  El bucket count pasa a ser **independiente del volumen de datos** (~1 bucket por campo del user, por stream).

El invariante que sostiene V3 — **"`user_roles.active = true` ⇒ el establecimiento está vivo (`deleted_at IS NULL`)"** — quedó enforced a nivel DB por la migración `0076` (trigger que desactiva roles al soft-deletear un campo + guard que prohíbe activar un rol sobre un campo borrado). Re-Gate 1: **PASS**.

**El problema del paso 2**: el paso 1 cubrió solo las tablas que ya tienen `establishment_id` propio (17 streams). Las **tablas hijas** (eventos, `animal_category_history`, `birth_calves`, `rodeo_data_config`) y las **entidades compartidas** (`animals` global, nombres de `users`) **no tienen un `establishment_id` propio** → no se las puede meter al modelo JOIN-free tal cual, y quedaron diferidas.

## Problema central

Toda tabla sincronizada por el modelo JOIN-free **necesita una columna `establishment_id` propia y fiel** sobre la cual filtrar `IN org_scope`. Las tablas que derivan su tenant de un padre, o que son globales (compartidas entre campos), no la tienen. ¿Cómo se las incorpora al sync sin reintroducir JOINs (que revientan el bucket model)?

## Decisión

### Patrón general — denormalizar `establishment_id` sobre cada tabla sincronizada

**Toda tabla que entra al sync JOIN-free debe exponer un `establishment_id uuid` propio.** Hay dos casos:

1. **Tabla hija (tenant derivable de un padre por FK)** → se **denormaliza** `establishment_id` sobre la tabla, mantenido **fiel** por un trigger que lo **fuerza** desde el padre (ignora cualquier valor del cliente — patrón anti-spoof, espejo de `tg_force_created_by_auth_uid`, `0043`) + un backfill de las filas existentes. La stream queda **idéntica al patrón del paso 1**: `SELECT ... WHERE establishment_id IN org_scope [AND deleted_at IS NULL]`. Como queda idéntica a las 17 streams ya validadas, **no hay riesgo de runtime nuevo** (a diferencia de V1/V2).

2. **Entidad compartida (global, sin un único `establishment_id`: `animals`, `users`)** → no se puede denormalizar UN `establishment_id` sobre la fila global (un animal/usuario puede pertenecer a >1 campo). Se resuelve **denormalizando la información que la UI necesita offline sobre la fila per-campo** que sí tiene `establishment_id` (`animal_profiles` para `animals`; `user_roles` para `users`), **o** dejando esa información **online** (PostgREST), cuando no se necesita 100% offline.

> **Por qué la denormalización es segura aunque el `establishment_id` quede duplicado**: la **RLS as-built de las tablas hijas NO cambia** — sigue derivando el tenant vía `establishment_of_profile(...)` / la cadena de FKs. La columna denormalizada es **solo para el stream** (la frontera de autorización del wire de sync, que NO puede hacer JOINs). El trigger-force garantiza que la columna sea **fiel al padre**; Gate 1 lo verifica sobre cada delta. La duplicación queda **controlada por triggers**, no por el cliente.

### (A) Tablas hijas — denormalización MECÁNICA (sin decisión de fondo; patrón claro)

Para cada una: `ALTER TABLE ADD COLUMN establishment_id uuid` (+ FK a `establishments`) → backfill desde el padre → trigger `BEFORE INSERT` (y `BEFORE UPDATE` si el padre puede cambiar) que **fuerza** `establishment_id` derivándolo del padre → stream JOIN-free idéntica al paso 1. Cadenas de derivación verificadas contra el as-built:

| Tabla hija | Cadena de derivación (verificada) | Migración as-built |
|---|---|---|
| `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples` | `animal_profile_id → animal_profiles.establishment_id` | `0025`–`0029` |
| `animal_category_history` | `animal_profile_id → animal_profiles.establishment_id` | `0030` |
| `birth_calves` | `birth_event_id → reproductive_events.animal_profile_id → animal_profiles.establishment_id` | `0045` |
| `rodeo_data_config` | `rodeo_id → rodeos.establishment_id` | `0018` |

> `animal_events` **NO** está en (A): ya tiene `establishment_id` propio (`0034`) y ya sincroniza en el paso 1 (`ev_animal_events`). Es además el **precedente** del patrón: su `tg_animal_events_validate_est` ya valida la consistencia del `establishment_id` denormalizado con el del perfil.

El detalle por tabla (orden de la migración, cuerpo del trigger, stream) vive en `specs/active/15-powersync/design.md` §2.4 (A).

### (B) `animals` (global, ADR-004) — **decisión: (b1) denormalizar la identidad sobre `animal_profiles`** — RECOMENDADA, pendiente de Raf

`animals` es **global** (ADR-004): un animal puede tener perfiles en >1 campo → no tiene un único `establishment_id`. La UI lee de `animals` solo **identidad**: `tag_electronic` (EID), `sex`, `birth_date` (verificado en `app/src/services/animals.ts` — `fetchAnimals`/`searchAnimals`/`fetchAnimalDetail`; nótese que `breed`/`coat_color` viven en `animal_profiles`, NO en `animals`).

- **(b1, ELEGIDA) Denormalizar la identidad del animal sobre `animal_profiles`** (que ya tiene `establishment_id` → ya sincroniza JOIN-free) y **NO sincronizar la tabla global `animals`**. Se copian a `animal_profiles` los campos de identidad que la UI necesita offline (`animal_tag_electronic`, `animal_sex`, `animal_birth_date`), mantenidos por un trigger que (i) **fuerza** los valores desde `animals` en el INSERT del perfil y (ii) **propaga** los UPDATE de identidad del animal a sus perfiles. Robusto, 100% JOIN-free, escala con el volumen.
  - **Costo**: duplicación de identidad por perfil (1 animal con N perfiles → N copias) + el trigger de propagación + el swap de lectura **T4** (futuro) lee identidad desde `animal_profiles`, no desde `animals`.
- **(b2, DESCARTADA) Mantener UN JOIN** (`est_animals`: `animals INNER JOIN animal_profiles`). **Es exactamente el patrón V2 que reventó en vivo**: PowerSync evaluaría TODOS los `animal_profiles` (no scopeados) como parameter query → con miles de animales supera 1000 buckets → vuelve PSYNC_S2305. **NO escala. Descartada.**

**Veredicto**: (b1). Es el patrón general del paso 2 aplicado a una entidad global: la fila per-campo (`animal_profiles`) es el portador del `establishment_id`, así que la identidad necesaria offline se denormaliza ahí. La tabla global `animals` queda **fuera del sync set**.

### (C) Nombres de coworkers (`users` global) — **decisión: (c1) dejar los nombres ONLINE** — pendiente de Raf

`users` es compartida (un user en >1 campo). El paso 1 ya sincroniza la **matriz de roles** (`est_members_roles`, vía `user_roles.establishment_id`) pero **NO los nombres** (`users.name`).

- **(c1, RECOMENDADA) Dejar los nombres ONLINE.** La pantalla de miembros (admin, no manga) lee `users.name` vía PostgREST cuando hay red. Alineado con D1 (identidad/admin online). Hay que **revertir la parte de nombres** del swap de lectura **T3** a online (`members.loadMembers` y el `buildOwnNameQuery` de `local-reads.ts`, que hoy leen un `users` local que el paso 1 NO sincroniza — drift a corregir; ver Consecuencias). Offline, la pantalla de miembros mostraría roles sin nombres (o "—"), aceptable por ser admin.
- **(c2, alternativa) Denormalizar `name` sobre `user_roles`** (que tiene `establishment_id` → JOIN-free) + trigger de propagación de `users.name → user_roles.member_name`. Permitiría nombres 100% offline, al costo de otro delta schema-sensitive (columna + trigger + backfill + Gate 1) por una pantalla que casi nunca se usa sin red.

**Veredicto recomendado**: (c1). **DECISIÓN DE RAF (2026-06-09): (c2)** — denormalizar `name` sobre `user_roles`. Raf quiere los nombres de coworkers disponibles offline. Implicancias de (c2):
- `user_roles` gana una columna `member_name`, mantenida por un trigger que la propaga desde `users.name` (INSERT del rol + UPDATE de `users.name`) + backfill.
- Como `user_roles` YA sincroniza (paso 1: `self_user_roles` para el propio + `est_members_roles` para el owner), los nombres **rides on** esos streams → tanto el nombre PROPIO (`self_user_roles`) como los de coworkers (`est_members_roles`) quedan offline, **sin** un stream nuevo de `users` ni un self-stream aparte.
- La tabla global `users` **no entra al sync set** (su único dato no-PII era `name`, ahora en `user_roles`; email/phone están en `user_private` self-only — ADR-025).
- Reconciliación del drift T3: `local-reads.buildMembersQuery` y `buildOwnNameQuery` pasan a leer `user_roles.member_name` (no `users`). El `LEFT JOIN users` local se elimina.

> **Nota de coherencia con la PII (ADR-025)**: ni (c1) ni (c2) tocan email/phone — eso vive en `user_private`, self-only, y NO se denormaliza nunca. (C) es solo sobre el `name` público.

## Decisiones de Raf (RESUELTAS 2026-06-09)

1. **(B) animals → (b1) ✅ APROBADA**: denormalizar identidad (`tag_electronic`/`sex`/`birth_date`) sobre `animal_profiles` y NO sincronizar `animals`. *Cambio de modelo de lectura* (el swap T4 lee identidad desde `animal_profiles`).
2. **(C) users/nombres → (c2) ✅ ELEGIDA**: denormalizar `name` sobre `user_roles` → nombres de coworkers (y propio) offline. La tabla global `users` queda fuera del sync set. Reconcilia el drift T3 (`buildMembersQuery`/`buildOwnNameQuery` → `user_roles.member_name`).

## Consecuencias

- **Duplicación controlada por triggers.** Cada `establishment_id` denormalizado (A) y cada campo de identidad denormalizado (b1) se mantiene fiel por un trigger-force/propagate. La RLS as-built **no cambia** (sigue derivando el tenant por FK); la columna denormalizada es solo para el stream.
- **Cada delta schema-sensitive pasa por Gate 1.** Las migraciones de (A) y (b1) tocan el schema (columna + trigger + backfill) y son **schema-sensitive** (R11.4): el leader las somete a **Gate 1 (`security_analyzer` modo `spec`)** ANTES de aplicarlas por Management API, y a Gate 2 + reviewer. Gate 1 verifica que (i) el trigger fuerza la columna desde el padre (no del cliente — anti-spoof), (ii) el backfill es correcto e idempotente, (iii) la stream resultante es equivalente a la RLS as-built de la tabla (no más permisiva), (iv) `security definer` + `set search_path = public` donde aplique.
- **Bucket math se mantiene << 1000.** Cada stream nueva del paso 2 agrega ~1 bucket por campo del user (mismo patrón del paso 1). El total paso 1 + paso 2 queda en el orden de **~30–60 buckets para un user de 2 campos vivos** (cuenta en design §2.4 — bucket math). Muy por debajo del tope de 1000.
- **El swap de lectura T4 queda alineado al modelo `animals`.** Con (b1), `animals.ts` (`fetchAnimals`/`searchAnimals`/`fetchAnimalDetail`) lee la identidad desde `animal_profiles` (columnas denormalizadas), no desde un JOIN a `animals`. El timeline (`events.ts`) y la ficha leen sus eventos desde las tablas hijas ya con `establishment_id` propio.
- **Drift a corregir por (c1)**: el swap T3 (`members.loadMembers`, `local-reads.buildMembersQuery`/`buildOwnNameQuery`) hoy lee `users.name` de un `users` local que el paso 1 **no sincroniza** → esas lecturas devolverían `name = null` offline. (c1) lo reconcilia volviendo los nombres a online; (c2) lo reconcilia denormalizando `name` sobre `user_roles`. Hasta que se decida, la pantalla de miembros muestra roles sin nombres offline (no crashea — el mapper ya coalesce a `''`).
- **`animals` fuera del sync set** (con b1): un device nunca baja la tabla global `animals`. Cualquier dato de `animals` que la UI necesite offline debe estar denormalizado en `animal_profiles` (hoy: solo identidad). Si en el futuro la UI necesitara otro campo de `animals` offline, se amplía la denormalización (no se sincroniza la tabla global).

## Alternativas consideradas y descartadas

- **(b2) `est_animals` con INNER JOIN** — descartada: es el patrón V2 que reventó en vivo (PSYNC_S2305). No escala.
- **Sincronizar `animals`/`users` globales con un bucket global read-only** — descartada: filtraría datos cross-tenant (un device vería TODOS los animales/usuarios de la DB), rompiendo multi-tenancy y la frontera WAL (ADR-025). Inaceptable.
- **(c2) denormalizar `name` sobre `user_roles`** — no descartada del todo: queda como alternativa si Raf quiere nombres de coworkers 100% offline. No recomendada por ahora (pantalla admin, no manga; costo de un delta para poco beneficio).
