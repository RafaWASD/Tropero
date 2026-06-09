# Bitácora — spec_author 15-powersync

> Redacción de la spec Kiro-style (requirements/design/tasks) de `15-powersync`. NO se escribió código ni tests. NO se tocó `feature_list.json` ni otros `progress/*` (lo hace el leader).
> Fecha: 2026-06-08.

## Qué redacté

- `specs/active/15-powersync/requirements.md` — 12 grupos (R1..R12), EARS estricto, con mapa context→requirements y acceptance→requirements al final + disclaimer de tentatividad web/device.
- `specs/active/15-powersync/design.md` — arquitectura del cliente, **YAML completo de sync streams** tabla por tabla (lo que audita Gate 1), tabla as-built→clase→stream→PK, plan de swap de services, manejo de mutaciones RPC-bound, env `EXPO_PUBLIC_POWERSYNC_URL`, sección de seguridad (frontera WAL/no-bypass), conflictos LWW, alternativa descartada.
- `specs/active/15-powersync/tasks.md` — 8 fases (T1 cimientos → T2 streams gateado por Gate 1 → T3/T4 lectura → T5 escritura → T6 RPC-bound → T7 tests → T8 native diferido).

## Fuentes leídas

context.md (Gate 0), docs/specs.md, architecture.md, conventions.md, ADR-002/020/021/025, spec 01 §PowerSync + R9/R6.10, migraciones 0001..0074 (mapeo de cada tabla sincronizable), services (animals/events/management-groups/exit-animal/import-rodeo + supabase.ts + env.ts).

## Issues de diseño que encontré (validar Raf / Gate 1)

1. **Mutaciones RPC-bound (el problema central del prompt)**: clasifiqué el camino de campo en (a) CRUD-plano offline-safe (los 5 eventos + observación + asignar/crear/renombrar lote + sesión/preset) vs (b) RPC-bound (`register_birth`, `exit_animal_profile`, los `soft_delete_*`, `import_rodeo_bulk`, y el **alta de animal** que son 2 inserts cross-tabla NO atómicos hoy). **Recomendación MVP: dejar las (b) online** (parto/baja/borrado/import/alta requieren red); eventos simples + lote offline. **Decisión abierta para la Puerta 1** (R6.7): la alternativa es mapear ops locales a RPC en `uploadData`, que da offline real pero agrega superficie de bug — la descarté como default.

2. **Tablas sin PK `id` simple** (PowerSync exige `id`):
   - `user_private` — PK es `user_id` (solo nombre; self-only, 1 fila): mapear `id`←`user_id` en AppSchema.
   - `rodeo_data_config` (PK `(rodeo_id, field_definition_id)`) y `birth_calves` (PK `(birth_event_id, calf_profile_id)`) — **PK compuesta real**. Ambas son **lectura local** (no escritura offline): propongo `id` sintético determinístico (`a || ':' || b`) en la query de la stream. Decisión abierta: confirmar la sintaxis exacta del SDK.

3. **Gotcha RLS-on-RETURNING**: con escritura local desaparece — la lectura post-escritura es watchable sobre SQLite, no roundtrip a PostgREST. Documenté que el swap **elimina** el split-insert+select de `createManagementGroup` y el `count:'exact'` de `assignAnimalToGroup`/`renameManagementGroup`. El soft-delete por UPDATE directo seguiría rechazado por PostgREST al subir → por eso los `soft_delete_*` quedan online (refuerza el punto 1).

4. **Tablas globales sin `establishment_id`**: `animals` (global ADR-004) se scopea por existencia de perfil; los 5 eventos + `animal_category_history` + `birth_calves` derivan el establecimiento del perfil/evento (espejo de su RLS). Lo dejé explícito en cada WHERE del YAML porque la stream no puede llamar `establishment_of_profile` (SECURITY DEFINER) — se inlinea el subquery.

5. **`user_private` self-only + WAL (ADR-025)**: `est_members` puede traer la fila `users` completa porque `0068` ya dropeó email/phone a `user_private` — la PII no vive en `users`. Lo anoté en el YAML y en §seguridad (es lo que cierra la PII en el canal de sync).

## Decisiones de criterio propio (defaults menores — que Raf valide)

- Nombre del env: `EXPO_PUBLIC_POWERSYNC_URL` (sigue el patrón `EXPO_PUBLIC_SUPABASE_*`).
- Búsqueda fuzzy (`pg_trgm`) no existe en SQLite → degradé a `LIKE '%term%'` local (el exacto TAG/IDV intacto); ranking por similaridad = post-MVP. Marcado como nota de diseño.
- `semen_registry` (tabla auxiliar de `reproductive_events`, scope establishment) la incluí en el sync set per-establishment aunque el context no la nombra explícitamente — es parte del camino de datos reproductivo. Validar.
- `auto_subscribe: true` en todas las streams (el cliente baja todo su sync set al conectar). Si el costo del free tier aprieta, se puede pasar a subscripción selectiva post-MVP.

## Estado

- `spec_ready` listo para Puerta 1 humana, PERO **Gate 1 (security_analyzer modo spec) es obligatorio sobre `sync-streams/rafaq.yaml` ANTES de la Puerta 1** (las streams son la frontera de autorización). El leader debe lanzar Gate 1.
- No marqué `feature_list.json` (lo hace el leader).

## Fix-loop Gate 1 (2026-06-08)

Gate 1 (`security_analyzer` modo `spec`) dio **FAIL**: 1 HIGH + 2 MED (reporte: `progress/security_spec_15-powersync.md`). Apliqué el fix-loop sobre las specs (sin tocar código ni migraciones):

- **HIGH-1 (cerrado)** — predicado canónico (`JOIN establishments e ... AND e.deleted_at IS NULL`) aplicado en **TODAS las ~20 streams per-establishment** de design §2, incl. las derivadas vía perfil/rodeo/evento de parto. Verifiqué con grep que NO queda ningún subselect bare (`FROM user_roles WHERE user_id = auth.user_id() AND active = true` sin JOIN): 0 ocurrencias. 18 predicados `ur` + 2 `me` (est_members) = 20 subselects canónicos.
- **MED-1 (cerrado)** — `est_members`: la 2da query (`user_roles` de coworkers) gateada a **owner + active = true** para espejar `user_roles_select` (owner-only para roles ajenos). La query de nombres (`users`) NO se gateó. Nota explícita dejada en design §2 (junto a `est_members`) y en "Decisiones abiertas para la Puerta 1" #4 de requirements.
- **MED-2 (cerrado)** — `est_invitations`: ya estaba bien gateada (owner + pending + deleted_at); solo heredó el predicado canónico.

Reconciliación:
- `requirements.md`: R4.1 (predicado canónico con `establishments.deleted_at IS NULL`), R4.2 (caso soft-deleted explícito), R4.9 (predicado canónico para invitations), Decisión abierta #4 (MED-1), Historial de refinamiento (entrada 2026-06-08).
- `design.md`: §2 (las ~20 queries + comentarios MED-1 en est_members), §7 (equivalencia stream↔RLS corregida + recordatorios Gate 2: bind params del `LIKE`, ADR de hardening del device), §10 (entrada de reconciliación datada 2026-06-08).

No marqué `feature_list.json` ni toqué migraciones (lo hace el leader). `node scripts/check.mjs` corrido al cierre.

## Reconciliación Puerta 1 (2026-06-08) — 2 decisiones de Raf

Modo refinamiento (spec ya `spec_ready`). Reconciliadas las 2 decisiones de la Puerta 1 sobre los 3 archivos in-place, preservando los IDs de requirements. Sin tocar código, migraciones ni `feature_list.json`.

### Decisión 1 — OFFLINE vía mapeo a RPC (opción ii, NO el default online)

Alcance: `register_birth` (parto), `exit_animal_profile` (baja), `soft_delete_*` (rodeo/management_group/animal_event/evento tipado) y `createAnimal` (alta find-or-create) → **OFFLINE** vía outbox + RPC-mapping. `import_rodeo_bulk` → **ONLINE** (excepción: onboarding masivo, no manga; feature 12 ya lo define online).

**Diseño del outbox (§5.3.2)**: tabla `op_intents` declarada **`insertOnly`** en `AppSchema` (no `localOnly`). Razón técnica: `localOnly` NO genera CrudEntry → `uploadData` no la vería; `insertOnly` SÍ genera CrudEntry (entra a la upload queue) pero no replica la fila como CRUD plano ni persiste dato local — patrón canónico de outbox/write-side de PowerSync. `uploadData` intercepta la CrudEntry por `op.table === 'op_intents'` y la mapea a `supabase.rpc(...)`; nunca se hace `from('op_intents')`. **Preserva R11.3** (la tabla vive solo en `AppSchema`, no existe en el server ni en streams). Confirmar la opción exacta del SDK (`insertOnly` vs `localOnly`) en T1.

**Diseño de la idempotencia (§5.4.3 — el punto crítico)**: la cola es at-least-once → si la RPC corre server-side y se pierde el ACK, el reintento duplicaría. Clave `client_op_id` (= el `id` uuid de cliente de la fila `op_intents`, estable entre reintentos). Dos modos de dedup:
- **Dedup natural (sin delta de backend)**: `create_animal` (ids de cliente del `animals`/`animal_profiles` → ON CONFLICT) y `soft_delete_*` (`UPDATE ... WHERE deleted_at IS NULL` es idempotente).
- **Dedup explícita (requiere delta de backend)**: `register_birth` y `exit_animal_profile` — el evento de parto / la baja no tienen id natural de cliente expuesto.

**¿Exige delta de backend?** Sí, para `register_birth`/`exit_animal_profile`. **Opción menos invasiva propuesta** (T6.4, sub-decisión del leader, NO implementada): param `p_client_op_id uuid` en esas 2 RPCs + columna `client_op_id uuid UNIQUE` en `reproductive_events` (parto) y `animal_profiles` (egreso) + guard `ON CONFLICT (client_op_id) DO NOTHING` / `IF EXISTS RETURN`. Es aditivo, no debilita ninguna policy. Tensión con R11.3 ("no schema changes") **declarada explícitamente** en design §5.4.3 y en R6.10; la spec NO toca migraciones. Fallback si el leader rechaza el delta: restringir offline a las ops con dedup natural (alta + soft-delete), pero eso contradice la Decisión 1 → se recomienda aprobar el delta acotado.

**Rollback optimista (§5.4.4)**: el service encola la intención + inserta filas optimistas (terneros/alta/UPDATE de baja/deleted_at) con ids de cliente en una sola tx local → la UI ve el efecto offline al instante. Al drenar: transitorio (red/5xx) → re-throw, deja en cola, **NO** revierte (op en vuelo); permanente (RLS 42501, constraint, dominio) → `rollbackOptimistic(tx)` borra/restaura las filas optimistas por sus ids de cliente + descarta la intención (no loop) + superficia (R10.2). Sub-caso cuidado: `create_animal` se modela como **una sola intención atómica** (no CRUD planos sueltos + intención) para evitar huérfanos y simplificar el rollback.

### Decisión 2 — roles offline OWNER-ONLY

Ya aplicada en `est_members` por MED-1 del Gate 1 (no se cambió). Solo se reconcilió el estado: la ex-"decisión abierta #4" pasó a "Resueltas en Puerta 1: owner-only" en requirements y tasks. Equivalencia stream↔RLS intacta; Gate 1 PASS se mantiene.

### Seguridad (§7-bis nueva)

Las RPCs re-validan authz server-side con el mismo JWT (intent forjado cross-tenant → rechazado por la RPC → rollback + descarte). Outbox local-only sin superficie de stream/RLS/WAL. **Las sync streams NO cambian → el Gate 1 PASS de las streams se mantiene.** El foco de seguridad de la opción (ii) es **Gate 2 (code)**: idempotencia (no doble-apply), rollback correcto, outbox sin leak, bind params.

### Archivos tocados (in-place, IDs preservados)

- `requirements.md`: R6.6 reescrita (opción ii + import online), R6.7 RESUELTA, **R6.8–R6.11 nuevas** (outbox / drenado vía RPC / idempotencia / optimista+rollback); mapa context→requirements ampliado; "Decisiones abiertas"→"Resueltas en Puerta 1" (#1 y #4); Gate de seguridad ampliado (foco Gate 2); user story + Contexto + Historial de refinamiento actualizados.
- `design.md`: §1.1/§1.2 (outbox.ts, op_intents, 4 services a outbox, import online), **§5.3 reescrita** (outbox `insertOnly` + por qué RPC + estado optimista), **§5.4 reescrita** (dos caminos de drenado + idempotencia §5.4.3 + rollback §5.4.4), **§7-bis nueva** (seguridad write-path opción ii), **§9 reescrita** (opción i = descartada; opción ii = elegida; import online subsiste), §10 (entrada Puerta 1 datada 2026-06-08 con las 2 decisiones).
- `tasks.md`: encabezado, **T6.1** reducida a `import_rodeo_bulk` online, **T6.2 ahora primaria** (T6.2a–T6.2f: outbox/optimista/RPC-mapping/idempotencia/rollback/swap services), **T6.4 nueva** (delta backend de idempotencia, sub-decisión del leader, NO implementar), **T7.7–T7.9 nuevas** (idempotencia no-duplica, rollback ante rechazo permanente, parto offline e2e); "Resueltas en Puerta 1" + dependencias actualizadas.

Status sigue `spec_ready`. `node scripts/check.mjs` corrido al cierre.

## Reescritura del YAML de streams — patrón `with:`/INNER JOIN (2026-06-08)

Modo refinamiento (spec ya `spec_ready`). El YAML de streams (artefacto de Gate 1) fallaba en runtime con un límite real de PowerSync. Reescrito sobre los archivos in-place, IDs preservados. Sin tocar código, backend, migraciones ni `feature_list.json`.

### El problema (diagnóstico autoritativo, de los logs de la instancia)
Al deployar las 26 streams y conectar un cliente real: `[PSYNC_S2305] too many parameter query results / too many buckets (limit of 1000)`. Causa raíz (regresión powersync-service **#611**): una stream `auto_subscribe` con `IN (subquery)` **sin** bloque `with:` genera **un bucket por cada FILA de datos** de la subquery. Con ~22 streams per-est × ~100 establecimientos (beta contaminada: 106 establecimientos, 957 animal_profiles) → ~2200 buckets > 1000 → 0 bytes + loop de reconexión. Gate 1 había validado la AUTORIZACIÓN (correcta); el patrón de sintaxis revienta el límite operativo de buckets.

### El fix (sintaxis/estructura, NO autorización)
Patrón nuevo, aplicado a las 22 streams per-establishment:
- **CTE de scope en `with:`** (repetida por stream — las CTEs no se comparten): `org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true` (+ `owner_scope` con `AND role = 'owner'` para `est_members` query 2 y `est_invitations`). Devuelve los ids de los campos del user (chico) → 1 bucket por campo, no por fila.
- **Tablas hijas → INNER JOIN al padre** (no subquery anidada con la CTE adentro — eso re-cuenta filas, #611). El `establishments.deleted_at IS NULL` (campo vivo, fix HIGH-1) se filtra a nivel **data query** (INNER JOIN establishments), NO en la CTE (mínima de 1 tabla, anti-#611). El predicado canónico de `has_role_in` queda PRESERVADO, repartido entre CTE (rol activo) y data query (campo vivo).
- Globales (5) + self-only (2): sin `with:` (filtro directo → no explotan).

### Verificación de FK/columnas contra el schema as-built (no inventé nombres)
- `animal_profiles.animal_id → animals.id` (0020:14) → `est_animals` JOIN.
- `birth_calves` PK `(birth_event_id, calf_profile_id)`, FK `birth_event_id → reproductive_events(id)`, `calf_profile_id → animal_profiles(id)` (0045:12-17) → `ev_birth_calves` 3 JOINs.
- `rodeo_data_config` PK `(rodeo_id, field_definition_id)`, FK `rodeo_id → rodeos(id)`, sin `deleted_at` propio (toggle en `enabled`) (0018:109-117).
- `reproductive_events.animal_profile_id → animal_profiles(id)` (0026:34); los 5 eventos tipados tienen `animal_profile_id` + `deleted_at`.
- `animal_events` tiene `establishment_id` denormalizado propio (0034:9) → JOIN directo a establishments.
- `animal_category_history` tiene `animal_profile_id` pero NO `deleted_at` propio (0030) → solo filtra perfil/campo vivos (igual que el SUPERSEDED).
- `user_roles` cols `user_id`/`establishment_id`/`role`/`active` (0003); `users`/`animals`/`establishments` tienen `deleted_at`.

### Matemática de buckets (caso de Raf: 5 roles activos / 2 campos vivos)
≈ 22 streams per-est × ~2–5 campos + 5 globales (1 c/u) + 2 self-only (1 c/u) ≈ **51–117 buckets**, muy debajo de 1000. Contraste: el SUPERSEDED contaba por fila de datos (~957 animal_profiles en la beta) → miles → explota.

### Incertidumbres de sintaxis FLAGGEADAS (el validador del dashboard es la verdad)
5 incertidumbres, cada una con apuesta + fallback (design §2.2-incertidumbres): (a) `with:` mapa→query-única vs lista; (b) `queries:` lista vs `query:` singular; (c) `SELECT (expr) AS id, t.*` sintético cumple "una tabla" (la de más chance de rechazo); (d) 2–3 INNER JOINs en un data query (`ev_birth_calves` tiene 3 — fallback: CTE `mother_births` con `org_scope` inlineado); (e) short-hand `IN org_scope` vs subquery explícita. Ninguna alternativa cambia la frontera de autorización.

### Opción 2 NO tomada (diferida, documentada en §9)
Trigger `AFTER UPDATE OF deleted_at ON establishments` que desactive `user_roles.active` del campo borrado → `org_scope` quedaría limpio sin JOINs a establishments (YAML más simple, menos buckets, probable cierre de un leak equivalente en la RLS as-built). Toca backend → fuera de esta iteración. Requiere análisis de impacto en `has_role_in`/`is_owner_of` + Gate 1 + migración. Diferida, NO implementada.

### Equivalencia de autorización (viejo SUPERSEDED → nuevo), tabla por tabla
Confirmada en design §2.3-equivalencia: cada stream sincroniza EXACTAMENTE el mismo set de filas. Sutileza: el INNER JOIN puede emitir una fila base duplicada (coworker con rol en 2 campos, animal con 2 perfiles) → PowerSync dedupea por `id` por bucket → set final idéntico al SUPERSEDED. NO es leak (no agrega filas de otro tenant). Flaggeado como verificación operativa.

### Archivos tocados (in-place, IDs preservados)
- `sync-streams/rafaq.yaml` — reescrito byte-faithful (mirror de design §2 nuevo).
- `design.md` — §2 (YAML nuevo), §2.1-superseded (patrón viejo + nota #611), §2.2 (bucketing + matemática + incertidumbres), §2.3-equivalencia (tabla viejo→nuevo), §7 (predicado canónico repartido), §9 (Opción 2 diferida), §10 (entrada 2026-06-08).
- `requirements.md` — R4.1 (nota de estructura `with:`/JOIN, frontera idéntica), Historial de refinamiento (entrada 2026-06-08).
- `tasks.md` — T2.1/T2.2/T2.3 (nota de la reescritura + re-Gate 1 verifica equivalencia + validador confirma sintaxis y buckets).

NO se deployó (lo hace Raf tras re-Gate 1). NO se tocó `feature_list.json`, `progress/current.md`, código, tests ni migraciones. Status sigue `spec_ready`.

## Fix-loop Gate 1 DEL DELTA — HIGH-D1 (2026-06-08)

Modo refinamiento (spec ya `spec_ready`). Gate 1 del delta de idempotencia dio **FAIL (1 HIGH: HIGH-D1 — IDOR cross-tenant en la rama idempotente de `register_birth`)**. Apliqué el fix sobre las specs in-place, IDs preservados. Sin tocar `feature_list.json`, `progress/current.md` ni migraciones reales.

### El bug (HIGH-D1)
La spec describía el guard de idempotencia de `register_birth` como un **lookup PURO** por `client_op_id` (`SELECT id WHERE client_op_id = p_client_op_id → RETURN`), sin exigir que el parto existente perteneciera al caller. Como `client_op_id` es un uuid de cliente (attacker-controlled) y el índice UNIQUE era **global** sobre toda `reproductive_events`, un atacante autenticado podía encolar `register_birth` con un `p_client_op_id` colisionado (replay) con un parto de OTRO establecimiento y recibir su `id` por el canal RPC → lectura cross-tenant (IDOR). El `has_role_in(v_est)` del as-built (`0045`) valida sobre la madre que el atacante pasó (propia → pasa), NO sobre la madre del parto existente → "authz antes del guard" no alcanza.

### Verificación de schema (decide el predicado)
Leí `0026_reproductive_events.sql`: `reproductive_events` **NO tiene `establishment_id` denormalizado** — la tenencia se deriva vía `animal_profiles` (`establishment_of_profile(animal_profile_id)`, RLS `0026:63-66`). `animal_profiles` SÍ tiene `establishment_id` (lo usa `register_birth`, `0045:214`). → el scoping del lookup se ancla en `animal_profile_id = p_mother_profile_id` + JOIN a `animal_profiles` con `establishment_id = v_est`.

### El fix (guard scopeado al caller)
La rama no-op solo corta-y-devuelve si el parto existente es del **propio caller**:
1. authz `has_role_in(v_est)` (fila real de la madre) rige PRIMERO — sin cambios;
2. lookup scopeado: `WHERE re.client_op_id = p_client_op_id AND re.animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est AND re.deleted_at IS NULL` → matchea → devuelve ese `id` (no-op legítimo);
3. si no matchea (no existe para este caller o colisión con parto AJENO) → camino de creación → el INSERT del `client_op_id` choca con el índice UNIQUE → **error genérico** (`unique_violation`/`23505`), uniforme, **nunca** devolver datos ajenos ni oráculo de existencia.

### Índice: GLOBAL → COMPUESTO
Cambié el índice de `(client_op_id)` global a **UNIQUE parcial COMPUESTO `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL`**. El guard procedural scopeado es el requisito MÍNIMO (cierra el leak de DATOS de la rama no-op); el índice compuesto es defensa-en-profundidad que además cierra el **oráculo de existencia residual (E4)**: el INSERT del atacante usa SU `animal_profile_id` → nunca colisiona globalmente con la fila ajena. Recomendación: **compuesto + guard scopeado** (ambos). Razonamiento completo en design §9-nota.

### Líneas reconciliadas
- `design.md` §5.4.3(1): cuerpo del guard con scoping de tenancy + comportamiento ante colisión ajena (pseudo-SQL); resumen del delta (índice compuesto); aviso de no escribir el guard literal.
- `design.md` §7-bis: nota de seguridad nueva (el guard ES un path de lectura → exige authz + scoping; matiz corregido).
- `design.md` §9-nota: índice GLOBAL (descartada) vs COMPUESTO (elegida) + por qué el guard procedural es el mínimo no-opcional.
- `design.md` §10: entrada de reconciliación datada 2026-06-08 (fix HIGH-D1).
- `requirements.md` R6.10 (bullet `register_birth`): dedup scopeada al caller, error genérico ante colisión, índice compuesto.
- `requirements.md` R11.3: índice compuesto (no global) + guard scopeado; no debilita authz cross-tenant.
- `requirements.md` R11.4: Gate 1 verifica el scoping del cuerpo del guard.
- `requirements.md` Historial de refinamiento: entrada 2026-06-08.
- `tasks.md` T6.4: cuerpo de la RPC con scoping + error genérico + aviso de no escribir el guard literal; índice compuesto. T7.7: caso negativo cross-tenant obligatorio.

Status sigue `spec_ready`. `node scripts/check.mjs` corrido al cierre.
