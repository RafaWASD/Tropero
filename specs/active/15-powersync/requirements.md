# Requirements — 15-powersync (Wiring de PowerSync, offline-first sync)

> EARS estricto (ver `docs/specs.md`). Cada `R<n>` verificable por ≥1 test.
> **Fuente de verdad**: `specs/active/15-powersync/context.md` (Gate 0, aprobado por Raf 2026-06-08).
> Cada "Decisión de Gate 0" y cada "Edge case offline" del context queda cubierto por ≥1 `R<n>` (mapa al final).
> **Última revisión**: 2026-06-08 — redacción inicial (spec_author).

## Estado de tentatividad (disclaimer)

El **target de producción** es `@powersync/react-native` en un **dev build Android** que Raf todavía no tiene. Mientras tanto el **banco de pruebas** es `@powersync/web` (WASM) en el navegador (D2 del context). Por lo tanto:

- Todo requirement que se verifique en device (persistencia de sesión chunked, performance del sync set en hardware de campo, BLE coexistiendo con el DB local) queda **diferido al dev build** y marcado con `[device]`.
- Todo lo verificable hoy en web (boot del DB local, scoping de streams contra la instancia, swap de services, no-bypass por device contra la DB remota espejando los tests RLS) es **buildable-hoy** y marcado con `[web]`.
- La **frontera de autorización son las sync streams** (Gate 1). El veredicto de seguridad NO depende del device: las streams se auditan y se testean server-side, igual que la RLS.

## Contexto

PowerSync (ADR-002) es la capa offline-first del MVP: SQLite local en el device + sync con Supabase. Esta feature cubre **todo el schema as-built** de datos del establecimiento (no solo identidad de spec 01): cierra **C5 de spec 02** y **Fase 7 de spec 01**.

Modelo de la decisión D1 del context — **data offline / identidad online**:
- **Lectura**: se sincroniza todo el schema de datos del establecimiento → la app lee de SQLite local y anda offline en todas las pantallas.
- **Escritura offline**: el camino de campo (animals/animal_profiles, las 5 tablas de evento, `animal_events`, `sessions`, `management_groups`/lotes, `rodeos`, asignación de lote) escribe a SQLite local + cola de upload. **Puerta 1 (opción ii)**: también van offline las mutaciones atómicas/SECURITY DEFINER del camino de campo — **parto** (`register_birth`), **baja** (`exit_animal_profile`), **soft-deletes** (`soft_delete_*`) y **alta de animal** (`createAnimal`) — vía una **outbox** local mapeada a llamadas RPC en el drenado (R6.6–R6.11). La única excepción que queda online es `import_rodeo_bulk` (onboarding masivo, no manga).
- **Online (NO por sync)**: las ops de identidad y administración (crear establecimiento, invitar, aceptar invitación vía Edge Function, gestión de cuenta) quedan como hoy (spec 01 R9.2). `import_rodeo_bulk` también queda online (excepción de la Puerta 1).

La instancia PowerSync Cloud (`rafaq-beta`, BR) ya está **provisionada** (precondición, ver R1) con auth = Supabase JWT vía JWKS.

PowerSync hoy usa **Sync Streams** (`config.edition: 3`); el helper de auth es `auth.user_id()` (= `sub` del JWT). El modelo viejo de `bucket_definitions`/`token_parameters` está deprecado y NO se usa.

## User stories

- **Como peón en la manga sin señal**, quiero cargar pesajes, tactos, condición corporal y observaciones, asignar lotes, **registrar partos, dar de baja animales, dar de alta animales nuevos y borrar registros** sin internet, para que la jornada no se frene; cuando vuelva la red, que todo se suba solo **sin duplicarse** aunque la conexión se corte a mitad de la subida.
- **Como productor/owner**, quiero abrir la app sin señal y ver mi rodeo completo (animales, fichas, timeline, lotes, rodeos), porque ya se sincronizó antes.
- **Como dueño de mis datos y de la PII de mi gente**, quiero que el device de un coworker NUNCA reciba datos de un campo donde no tiene rol, ni el email/teléfono de otro miembro (frontera WAL, ADR-025).
- **Como dev (Raf)**, quiero que el swap PostgREST→SQLite-local quede contenido en la capa de services y no rompa los flujos ya gateados (auth, alta, ficha, eventos, lotes).

---

## R1 — Provisioning (precondición)

**R1.1** El sistema deberá considerar la instancia PowerSync Cloud (`rafaq-beta`, región BR) como **precondición provisionada**: rol de replicación `powersync_role` (BYPASSRLS + REPLICATION), publicación `powersync FOR ALL TABLES`, conexión a Supabase con `verify-full` y auth = Supabase Auth vía JWKS. Esta feature **no deberá** re-provisionar esa instancia.

**R1.2** El sistema deberá leer la URL del endpoint de PowerSync desde una variable de entorno pública nueva `EXPO_PUBLIC_POWERSYNC_URL`, expuesta por el helper `getEnv()` (mismo patrón que `EXPO_PUBLIC_SUPABASE_URL`).

**R1.3** Si falta `EXPO_PUBLIC_POWERSYNC_URL`, entonces el sistema deberá fallar en `getEnv()` con un mensaje accionable en español (mismo estilo que el error actual de Supabase), nunca con un crash opaco.

## R2 — Cliente PowerSync (boot, schema local, provider)

**R2.1** El sistema deberá definir un schema local `AppSchema` que **espeje** las tablas sincronizadas del schema as-built (PowerSync no enforça tipos: `AppSchema` es una vista sobre lo sincronizado).

**R2.2** El sistema deberá instanciar el DB local de PowerSync vía un **factory por plataforma**: `@powersync/web` (wa-sqlite/WASM) en `Platform.OS === 'web'`, `@powersync/react-native` en device; la lógica de sync por encima del factory deberá ser agnóstica de plataforma.

**R2.3** El sistema deberá exponer el DB local a la app mediante un provider de React (`@powersync/react`) montado por encima del árbol, de modo que los hooks watchables puedan suscribirse.

**R2.4** Cuando la app arranca en web con sesión válida, el sistema deberá bootear el DB local de PowerSync sin crashear (smoke de boot del DB WASM). `[web]`

**R2.5** `[device]` Donde el target sea device (dev build), el sistema deberá bootear el DB local de PowerSync con `@powersync/react-native` sin crashear. (Diferido al dev build; ver disclaimer.)

## R3 — Connector + auth JWT

**R3.1** El sistema deberá implementar un `PowerSyncBackendConnector` cuyo `fetchCredentials()` devuelva `{ endpoint: EXPO_PUBLIC_POWERSYNC_URL, token: <access_token de la sesión Supabase actual> }`.

**R3.2** Cuando el `access_token` esté vencido al momento de sincronizar, el sistema deberá renovar el token desde la sesión de Supabase (`supabase.auth.getSession()` con autoRefresh) y reintentar la conexión, sin forzar logout. (Cubre edge case "token expirado / refresh" del context.)

**R3.3** El sistema deberá implementar `uploadData()` en el connector, que drene la upload queue local aplicando cada mutación pendiente contra Supabase con el cliente existente (`supabase`), preservando el orden de la cola.

**R3.4** Si una operación de la upload queue falla por un error **transitorio** (red caída), entonces el sistema deberá dejar la operación en la cola para reintento posterior, sin descartarla.

**R3.5** Si una operación de la upload queue es **rechazada por el servidor** de forma permanente (RLS / constraint / check), entonces el sistema deberá descartar esa operación de la cola (para no bloquear el resto) y registrar el rechazo de forma observable (ver R10).

## R4 — Sync streams: scoping = frontera de autorización (Gate 1)

> Las queries de las streams son lo que audita Gate 1. El detalle YAML va en `design.md`; estos requirements fijan la **regla de scoping** por clase. Cada uno es testeable como "device de un usuario X recibe / no recibe la fila Y".

**R4.1** El sistema deberá scopear cada stream de la clase **per-establishment** por `establishment_id ∈ {establecimientos VIVOS donde auth.user_id() tiene un user_role con active = true}`, derivado vía el **predicado canónico** que espeja `has_role_in` (0005_rls_helpers.sql:16-24) — es decir, con el JOIN a `establishments` y el filtro de campo vivo, no solo `active = true`:

```sql
establishment_id IN (
  SELECT ur.establishment_id FROM user_roles ur
  JOIN establishments e ON e.id = ur.establishment_id
  WHERE ur.user_id = auth.user_id()
    AND ur.active = true
    AND e.deleted_at IS NULL)
```

El filtro `establishments.deleted_at IS NULL` es **obligatorio** porque NO hay trigger que desactive los `user_roles` al soft-deletear un campo: sin él, la stream sería más permisiva que la RLS y dejaría leak por el WAL tras borrar un campo (Gate 1 HIGH-1, 2026-06-08). El mismo predicado canónico aplica a las streams que derivan el establecimiento vía `animal_profile` / `rodeo` / evento de parto (R4.6, R4.7, R4.8, R4.10).

> **RECONCILIADO (Run 4, migración `0076`)**: AHORA SÍ existe ese trigger — `establishment_soft_delete_deactivates_roles` (`0076`) desactiva (`active = false`) los `user_roles` de un campo al soft-deletearlo, y un backfill limpió los ya-existentes. Esto hace que `active = true` sea un proxy fiel de "campo vivo", REFORZANDO el cierre de HIGH-1. El filtro `establishments.deleted_at IS NULL` del predicado canónico se **MANTIENE igual** como defensa-en-profundidad (cubre la ventana de carrera entre el soft-delete y la propagación por WAL); ya no es estrictamente necesario para correctitud, pero su presencia es inofensiva y robusta. La regla de scoping de R4.1/R4.2 NO cambia de semántica. Ver design §2.2 (AS-BUILT Run 4) y el Historial de design (entrada 2026-06-09).
>
> **RECONCILIADO (Run 4.1, migración `0076` — guard, HIGH-1 reabierto)**: el trigger de deactivate cubre los roles EXISTENTES al borrar el campo, pero NO impide CREAR/activar un rol NUEVO sobre un campo ya borrado (vector verificado: `accept_invitation` (`supabase/functions/accept_invitation/index.ts:93-101`) inserta `active:true` sin chequear `establishments.deleted_at`; owner invita → owner borra el campo → invitado acepta el link pendiente → rol activo sobre campo muerto → el sync JOIN-free le replicaría la data del campo borrado). `0076` agrega la 2da mitad del invariante: el guard `prevent_active_role_on_soft_deleted_establishment` (`BEFORE INSERT OR UPDATE OF active ON user_roles`) rechaza con `errcode 23514` cualquier INSERT/UPDATE que deje `active = true` apuntando a un campo `deleted_at IS NOT NULL` (`active = false` SIEMPRE permitido → no rompe el deactivate ni la remoción de miembros). Con las DOS mitades, el invariante "`user_roles.active = true` ⇒ campo vivo" queda enforced a nivel DB para roles existentes Y nuevos. Cierre COMPLETO de HIGH-1. Ver design §9 (RECONCILIADO Run 4) y tasks T6.6 (sub-bullet GUARD).

> **⚠️ Nota de estructura (2026-06-08, reescritura del YAML).** Lo de arriba fija la **regla de scoping** (la frontera de autorización); la **estructura SQL** que la implementa en `design.md §2` cambió de "subquery anidada inline" a **patrón `with:`/INNER JOIN** (CTE `org_scope`/`owner_scope` para el rol activo + `INNER JOIN establishments` para el campo vivo) por un límite operativo de PowerSync (`[PSYNC_S2305]` too many buckets / regresión #611 — ver design §2.1-superseded, §2.2). **La frontera de autorización es IDÉNTICA** (mismo set de filas por stream, tabla por tabla; design §2.3-equivalencia): el predicado canónico queda preservado, solo repartido entre la CTE (rol activo) y el data query (campo vivo). Los requirements R4.1–R4.11 NO cambian de semántica; el re-Gate 1 verifica la equivalencia del cambio estructural.

**R4.2** Si un usuario **no tiene rol activo** en un establecimiento, **o** el establecimiento está **soft-deleteado** (`establishments.deleted_at IS NOT NULL`) aunque el usuario conserve un `user_role` con `active = true` en él, entonces el sistema **no deberá** incluir ninguna fila de ese establecimiento (animales, perfiles, eventos, sesiones, lotes, rodeos, config, invitaciones, roles de coworkers) en el sync set de su device. (Acceptance #2; test de no-bypass por device; el caso soft-deleted es el fix de Gate 1 HIGH-1 — espeja `has_role_in`, que filtra `e.deleted_at IS NULL`.)

**R4.3** El sistema deberá scopear la stream de **`user_private`** como **self-only** (`user_id = auth.user_id()`), de modo que el device de un coworker nunca reciba el email/teléfono de otro miembro. (ADR-025, frontera WAL; acceptance #3.)

**R4.4** El sistema deberá sincronizar los **catálogos globales** read-only (`species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`) a todos los usuarios autenticados, sin filtro de establecimiento.

**R4.5** El sistema deberá filtrar **`deleted_at IS NULL`** en las streams de toda tabla con soft-delete, de modo que una fila soft-deleteada salga del sync set y el device la dropee localmente.

**R4.6** El sistema deberá scopear las streams de tablas que **no tienen `establishment_id` propio** (las 5 tablas de evento + `animal_category_history`) por `establishment_id IN org_scope` sobre una columna **`establishment_id` denormalizada** sobre cada tabla, mantenida fiel por un trigger-force desde el `animal_profile` (paso 2 §2.4 (A); espeja el set de su RLS `has_role_in(establishment_of_profile(...))`).

> **RECONCILIADO (2026-06-09, paso 1 V3 + paso 2 §2.4):** el modelo as-built es **JOIN-FREE** — PowerSync NO tolera JOINs en las data queries (regresión #611 / PSYNC_S2305). La derivación del establecimiento ya NO se hace por JOIN al perfil: se **denormaliza `establishment_id`** sobre cada tabla hija (trigger que lo FUERZA desde el padre + backfill, paso 2 §2.4 (A)) y la stream filtra `WHERE establishment_id IN org_scope AND deleted_at IS NULL`, idéntica al patrón del paso 1. La frontera de autorización es la misma (la RLS as-built de la tabla, que sigue derivando por FK, NO cambia — R11.3/R13); solo cambia POR DÓNDE la cumple el wire de sync. Aplica a R4.6, R4.7, R4.8, R4.10.

**R4.7** El sistema **no deberá** sincronizar la tabla global **`animals`** (sin `establishment_id`, ADR-004). En su lugar, el sistema deberá **denormalizar la identidad del animal** (`tag_electronic`/`sex`/`birth_date`) sobre `animal_profiles` (que ya tiene `establishment_id` → ya sincroniza JOIN-free), mantenida por un trigger que la fuerza desde `animals` y propaga sus updates, de modo que la UI lea la identidad offline desde `animal_profiles` sin sincronizar `animals` (paso 2 §2.4 (B)/b1; ADR-026; **decisión de Raf**).

**R4.8** El sistema deberá scopear la stream de **`birth_calves`** (PK compuesta, `id` sintético) por `establishment_id IN org_scope` sobre una columna **`establishment_id` denormalizada** mantenida fiel por un trigger-force que la deriva del evento de parto → madre (`birth_event_id → reproductive_events.animal_profile_id → animal_profiles.establishment_id`), espejando el set de la policy `birth_calves_select` (paso 2 §2.4 (A)).

**R4.9** El sistema deberá sincronizar la stream de **`invitations`** restringida a `status = 'pending'`, `deleted_at IS NULL` y al establecimiento **vivo** donde el usuario es **owner** (el subselect usa el predicado canónico de R4.1 con `role = 'owner'`; espeja `invitations_select` (0008:46-55) en lo que la stream sincroniza). Lectura del listado de pendientes; la **aceptación** sigue online vía Edge Function — D1 del context, excepción de Raf.

**R4.10** El sistema deberá scopear la stream de **`rodeo_data_config`** (PK compuesta `(rodeo_id, field_definition_id)`, `id` sintético) por `establishment_id IN org_scope` sobre una columna **`establishment_id` denormalizada** mantenida fiel por un trigger-force que la deriva del `rodeo` referenciado (`rodeo_id → rodeos.establishment_id`), restringido al set de roles activos (paso 2 §2.4 (A)).

**R4.11** El sistema **no deberá** incluir en ninguna stream las tablas marcadas "online, NO en el sync set" del context: `push_tokens`, `import_log`. (La aceptación de invitación, la creación de establecimiento y la gestión de cuenta no son tablas — son flujos online vía PostgREST/EF.)

## R5 — Lectura offline (todo el schema de datos)

**R5.1** El sistema deberá servir todas las **lecturas** del camino de datos (lista de animales, búsqueda, ficha/detalle, timeline, miembros de lote, lista de rodeos, config de rodeo, lista de lotes, contexto de establecimiento) desde el **SQLite local de PowerSync** vía queries watchables, no desde PostgREST.

**R5.2** Mientras el device no tenga red, el sistema deberá servir esas lecturas igual desde el SQLite local (offline-first). `[web: simulable; device: real]`

**R5.3** Cuando una fila sincronizada cambie en el DB local (por sync entrante o por una mutación local), el sistema deberá refrescar reactivamente las vistas suscritas vía la query watchable, sin re-fetch manual.

**R5.4** El sistema deberá servir las lecturas de **catálogos globales** (categorías por sistema, field_definitions, etc.) desde el SQLite local; si el primer arranque ocurre sin red y el catálogo aún no se sincronizó, entonces el sistema deberá degradar con un aviso explícito (no crashear). (Edge case "primer login sin red" del context.)

> **Reconciliación al as-built (fix showstopper, 2026-06-09).** R5.4 cubre la DEGRADACIÓN de la lectura (no crashear ante "aún no sincronizó"). El swap T3 dejó un bug colateral en el CONSUMO de esa degradación: el gate de establecimiento colapsaba el `kind:'network'`/"Sincronizando…" a `no_establishments` → la app aterrizaba en ONBOARDING antes de que el first-sync bajara el campo (aunque sincronizara enseguida). El as-built lo cierra **client-side** sin cambiar el contrato de R5.4: el bootstrap espera datos USABLES (`waitForUsableSync`: `hasSynced` restaurado de disco = `'cached'` instantáneo para no colgar offline, o first-sync completado, o timeout que degrada), y los contexts (`EstablishmentContext`/`RodeoContext`) RE-RESUELVEN al llegar el first-sync (listener `statusChanged`, transición false→true) en vez de afirmar onboarding sobre un SQLite todavía vacío. Detalle en `design.md §5.1` (bloque "fix showstopper"). No es una R nueva — es el comportamiento correcto de R5.4 + el gate de spec 01 leyendo de local.

## R6 — Escritura offline del camino de campo (clasificación a/b)

> Clasificación del context D1 traducida a requirements. La estrategia de las (b) RPC-bound se **RESOLVIÓ en la Puerta 1** (2026-06-08): opción (ii) = offline vía mapeo a RPC, con `import_rodeo_bulk` como única excepción online (ver R6.6, R6.7, R6.8–R6.11 + design §5.3/§5.4/§9).

**R6.1** El sistema deberá persistir las mutaciones **CRUD-plano offline-safe** del camino de campo en el SQLite local + upload queue, funcionando sin red:
- insertar un `weight_event`, `condition_score_event`, `reproductive_event` (service/tacto/abortion), `sanitary_event`, `lab_sample`;
- insertar una observación libre (`animal_events`);
- asignar/quitar lote (`UPDATE animal_profiles.management_group_id`);
- crear/renombrar lote (`management_groups` insert/update);
- crear/editar sesión y preset (`sessions`, `maneuver_presets`).

**R6.2** Cuando la red vuelva, el sistema deberá drenar la upload queue aplicando esas mutaciones contra Supabase, donde **siguen aplicando** RLS + triggers BEFORE INSERT (gating, created_by/author_id forzados) + CHECKs. La app **no deberá** asumir que el upload omite esas validaciones.

**R6.3** El sistema deberá **eliminar el patrón split-insert+select** (RLS-on-RETURNING) en los services swappeados a escritura local: la lectura post-escritura ya no es un roundtrip a PostgREST sino una query watchable sobre SQLite local. (Gotcha de `current.md` reflejado en el swap; ver design §swap.)

**R6.4** El sistema **deberá** generar los `id` (uuid) de las filas nuevas en el cliente para las mutaciones CRUD-plano (ya es el patrón as-built de `createAnimal`/`createManagementGroup`), de modo que la fila exista en el DB local antes de que el upload la confirme.

**R6.5** El sistema deberá clasificar como **(b) RPC-bound** (atómicas / SECURITY DEFINER) las siguientes mutaciones, que **no son CRUD plano**: `register_birth` (parto + N terneros atómico), `exit_animal_profile` (baja/egreso), los `soft_delete_*` (rodeo, management_group, animal_event, evento tipado), `import_rodeo_bulk` (carga masiva) y el **alta de animal** (`createAnimal`, 2 inserts cross-tabla animals→animal_profiles que hoy no son atómicos).

**R6.6** El sistema deberá tratar las mutaciones (b) RPC-bound, en MVP, según la **estrategia RESUELTA en la Puerta 1 (2026-06-08): opción (ii) — offline vía mapeo a RPC**. Concretamente:
- El sistema **deberá** hacer funcionar OFFLINE, vía el mecanismo de outbox + mapeo a RPC (R6.8–R6.11), las mutaciones de camino de campo: `register_birth` (parto + N terneros), `exit_animal_profile` (baja/egreso), los `soft_delete_*` (rodeo, management_group, animal_event, evento tipado) y el **alta de animal** (`createAnimal`, find-or-create: 2 inserts cross-tabla animals→animal_profiles).
- El sistema **no deberá** encolar offline `import_rodeo_bulk`: queda **ONLINE** (excepción documentada — no es camino de manga sino onboarding masivo, definido online por la feature 12; encolar 5000 filas offline es impráctico). Si `import_rodeo_bulk` se invoca sin red, entonces el sistema deberá responder con un error accionable (`kind:'network'`) sin marcar la operación como hecha.

**R6.7** El sistema deberá considerar **RESUELTA en la Puerta 1 (2026-06-08)** la estrategia de las (b) RPC-bound: se eligió la opción **(ii)** (parto/baja/soft-delete/alta offline vía outbox + RPC-mapping en `uploadData()`); la opción (i) (todo online) queda **descartada** para esas mutaciones y solo subsiste para `import_rodeo_bulk`. El diseño del mecanismo (outbox local + idempotencia + estado optimista/rollback) lo fijan R6.8–R6.11 y design §5.3/§5.4.

**R6.8 — Outbox de intenciones (write-side, no sincronizado).** El sistema deberá encolar cada mutación (b) offline como una **intención** en una tabla de outbox del schema local de PowerSync que **no se sincroniza al server** (declarada `insertOnly` en `AppSchema`: genera entrada en la upload queue para que `uploadData()` la procese, pero su fila no se replica como CRUD plano contra ninguna tabla del server). Cada intención deberá registrar: el **tipo de op** (`register_birth` | `exit_animal_profile` | `soft_delete_<entity>` | `create_animal`), sus **params** (incluidos los `id` generados en cliente), y una **clave de idempotencia** `client_op_id` (uuid de cliente, R6.10). Como la outbox es write-side y no sincronizada, **no agrega ninguna tabla nueva al schema replicado del server ni a las sync streams** (preserva R11.3 sobre el schema sincronizado; ver design §5.3 sobre la tensión con las RPCs).

**R6.9 — Drenado de la outbox vía RPC.** Cuando la red vuelva, el sistema deberá drenar la outbox mapeando cada intención a su llamada RPC server-side (`supabase.rpc('register_birth' | 'exit_animal_profile' | 'soft_delete_*' | <alta>, params)`) en `uploadData()`, en orden de cola. Si la RPC falla por un error **transitorio** (red), entonces el sistema deberá dejar la intención en la cola para reintento (R3.4); si la RPC es **rechazada de forma permanente** (RLS / constraint / dominio), entonces el sistema deberá descartar la intención, **revertir el estado optimista asociado** (R6.11) y superficiar el rechazo (R8.1, R10.2).

**R6.10 — Idempotencia (no doble-apply).** Dado que la upload queue es **at-least-once** (una RPC puede ejecutarse server-side y perderse el ACK), el sistema **no deberá** aplicar dos veces la misma intención al reintentar. El sistema deberá adjuntar a cada intención una clave de idempotencia `client_op_id` (uuid de cliente = `id` de la fila `op_intents`) estable entre reintentos, de modo que reintentar la misma intención sea seguro: el reintento con un `client_op_id` ya aplicado **no deberá** producir un segundo efecto (segundo parto, segunda baja, segundo soft-delete, segundo animal). La dedup se garantiza, por op, según su modo (cerrado en la última pasada de diseño, 2026-06-08; ver design §5.4.3):

- **`register_birth` — dedup EXPLÍCITA por `client_op_id`, SCOPEADA AL CALLER (requiere el delta de backend ADITIVO, R11.3).** La RPC `register_birth` inserta un `reproductive_events` de parto **con `id` server-side** y N terneros (`animals`/`animal_profiles`/`birth_calves`) **también con `id` server-side** (evidencia: migración `0045_birth_calves.sql`, `returning id into ...`). NO hay `id` de cliente que dedupee → un reintento crearía un SEGUNDO parto + N terneros. El sistema **deberá** dedupear `register_birth` por una columna `client_op_id uuid` (nullable) en `reproductive_events` + índice **UNIQUE parcial COMPUESTO** `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` (compuesto, NO global — ver R11.3), con el param `p_client_op_id uuid default null` en la RPC. **⚠️ Invariante de seguridad (fix HIGH-D1, Gate 1 del delta 2026-06-08): la dedup es SCOPEADA al caller, NUNCA cross-tenant.** El guard de la rama no-op es un **path de lectura del parto existente** → la authz (`has_role_in(v_est)` sobre la fila real de la madre, `0045:213-225`) rige PRIMERO y, además, el lookup del `client_op_id` **deberá** estar scopeado al contexto del caller: el parto existente solo se considera "el mismo" (no-op legítimo, cortar y devolver) si pertenece a la **misma madre que el caller pasó** (`animal_profile_id = p_mother_profile_id`) **y** al **tenant ya autorizado** (`animal_profiles.establishment_id = v_est`; `reproductive_events` NO tiene `establishment_id` denormalizado — se deriva vía `animal_profiles`, `0026`) + `deleted_at IS NULL`. Si existe una fila con ese `client_op_id` pero **NO matchea** el scope del caller (colisión con un parto AJENO, p.ej. replay de un `client_op_id` observado), la RPC **no deberá** devolver el `id`/datos ajenos: **deberá** responder con un **error genérico** (`unique_violation`/`23505`), uniforme con cualquier otro fallo, sin filtrar que la fila ajena existe ni de quién es (no dar oráculo de enumeración). Cuando `p_client_op_id` es NULL (path online actual) el comportamiento **deberá** ser idéntico al de hoy (no rompe nada). (Ver R11.3 — delta aditivo aprobado en Puerta 1; design §5.4.3(1) + §7-bis + §9-nota.)
- **`exit_animal_profile` — dedup NATURAL por la guarda de status, SIN delta.** La RPC `exit_animal_profile` (evidencia: `0044_exit_reason_enum.sql`) es una transición de status (`UPDATE animal_profiles SET status = ... , exit_reason = ..., exit_date = ... WHERE id = p_profile_id`) sin inserts de side-effect: la baja NO setea `deleted_at` (queda NULL) y NO toca `category_id`, por lo que el trigger `animal_profiles_record_category_change_upd` (AFTER UPDATE OF `category_id`, `0030`) NO dispara. Un reintento re-encuentra la fila (sigue con `deleted_at IS NULL`), re-pasa la authz y re-aplica un UPDATE de status **idéntico** (mismo end-state, sin segundo efecto): es naturalmente idempotente. Por lo tanto el sistema **no deberá** agregar `client_op_id` ni delta a `exit_animal_profile`.
- **`create_animal` (alta) — dedup NATURAL por `id` de cliente, SIN delta.** `createAnimal` genera el `id` de `animals` y de `animal_profiles` en el cliente (evidencia: `app/src/services/animals.ts`, `randomUuid()`). Un reintento del INSERT con el mismo `id` choca con la PK (o `ON CONFLICT DO NOTHING`) → no crea un segundo animal. SIN delta.
  > **Nota de reconciliación (Run create-animal-rpc, 2026-06-10):** el "qué" (no doble-apply por ids de cliente) no cambia, pero el MECANISMO as-built sí: la dedup se materializa en una **RPC atómica server-side `create_animal` (0083)** con ambos INSERTs `ON CONFLICT (id) DO NOTHING` en UNA transacción. La implementación previa (2 upserts HTTP no atómicos en `uploadData`, Run T6) cumplía R6.10 solo en apariencia: bajo reintento con half-state se auto-envenenaba (PK-conflict → `ON CONFLICT DO UPDATE` → policy UPDATE de `animals` → 42501 → `permanent_reject` → rollback del overlay) y **PERDÍA el alta** (violación de R6.9/R6.11 — bug real, backlog 2026-06-10 REABIERTO). El "SIN delta" se conserva a nivel schema (sin columnas/índices nuevos); la RPC es un delta aditivo tipo 0081/0082. La RPC además SANA los huérfanos preexistentes del camino viejo (DO NOTHING en `animals` → crea el perfil faltante). Detalle en design §5.4.2/§5.4.3(3) + `progress/impl_15-powersync.md`.
- **`soft_delete_*` — dedup NATURAL por la guarda `deleted_at IS NULL`, SIN delta.** Las RPCs `soft_delete_*` (evidencia: `0041_soft_delete_rpcs.sql`) seleccionan `WHERE id = ... AND deleted_at IS NULL`: en el reintento la fila ya está soft-deleteada → la RPC no produce un segundo efecto. SIN delta. (Sub-caso de manejo: en el reintento la RPC **levanta** `not found` (P0002) en vez de un 2xx; el sistema **deberá** tratar ese P0002 sobre una intención `soft_delete_*` cuyo efecto YA está aplicado localmente como **éxito idempotente** — descartar la intención **sin** revertir el estado optimista — y no como un rechazo permanente que dispare rollback. Ver design §5.4.3.)

**R6.11 — Estado optimista + rollback (vía overlay LOCAL-ONLY, no doble-upload).** Para que la ficha muestre el ternero / la baja / el alta antes de sincronizar, el sistema deberá registrar el **efecto optimista** en un **overlay local-only** del DB de PowerSync — tablas declaradas `localOnly: true` en `AppSchema` que **NO generan CrudEntry** (no se suben) — en el mismo paso (misma tx local) que encola la intención (R6.8). El sistema **no deberá** escribir las filas optimistas directamente en las tablas **sincronizadas** (las que sí generan CrudEntry), porque eso produciría una doble-aplicación (el INSERT/UPDATE plano de la fila optimista **y** la RPC del intent aplicarían la misma op dos veces — ver R6.12). Las queries de lectura del camino afectado (ficha/detalle, timeline, lista de animales, miembros de lote) **deberán** hacer **UNION** del estado sincronizado con el overlay local-only pendiente, de modo que la UI vea el efecto offline (reactividad por watchable, R5.3). Una vez que la RPC del intent es **ACKeada** (éxito) y las filas reales bajan por la sync stream, el sistema **deberá** limpiar el overlay local-only de esa intención (evita duplicado entre la fila optimista y la real). Si la RPC es **rechazada de forma permanente** al drenar (R6.9), el sistema deberá **borrar** el overlay local-only de esa intención (rollback: como nada se escribió en tablas sincronizadas, no hay residuo en el server ni huérfanos) y superficiar el rechazo (R8.1, R10.2). Mientras la intención esté pendiente o reintentándose (transitorio), el sistema **no deberá** borrar el overlay.

**R6.12 — No doble-upload (intent vs fila optimista, correctitud).** El sistema **no deberá** aplicar la misma mutación (b) RPC-bound más de una vez por una doble fuente de CrudEntry. Como el efecto optimista vive en el overlay local-only (R6.11) que NO genera CrudEntry, la **única** CrudEntry que `uploadData()` deberá procesar para una op (b) es su `op_intent` (`insertOnly`), mapeado a la RPC (R6.9). El sistema **no deberá** emitir, para esa misma op, una CrudEntry de INSERT/UPDATE plano contra las tablas sincronizadas que la RPC va a (re)crear. (Mecanismo verificable por test: encolar `register_birth` offline genera exactamente UNA CrudEntry en la upload queue — la de `op_intents` —, y el drenado llama a la RPC **una sola vez**, sin un INSERT plano paralelo de los terneros.)

## R7 — Identidad y administración online (sin tocar)

**R7.1** El sistema **no deberá** mover a sync las operaciones administrativas de identidad: crear establecimiento, invitar (crear link), aceptar invitación (Edge Function), gestión de cuenta/email. Estas deberán seguir online vía PostgREST/EF como hoy (spec 01 R9.2).

**R7.2** El sistema deberá permitir **cambiar de establecimiento activo offline** si el establecimiento destino ya está en el sync set local; si el destino aún no sincronizó, entonces el sistema deberá avisar que requiere conexión. (Edge case "cambiar de campo activo offline" del context; spec 01 R9.2.)

## R8 — Edge cases offline (del context)

**R8.1** Si una mutación encolada pertenece a un establecimiento **donde el usuario perdió el rol** (`active_lost`) y el servidor la rechaza por RLS al drenar la cola, entonces el sistema deberá **descartar esa op de la cola** y superficiar el rechazo de forma legible (alineado con spec 01 R6.10 y spec 03 R10.8), sin reintentar en loop.

**R8.2** Cuando un establecimiento sale del sync set del usuario (perdió el rol / fue soft-deleteado), el sistema deberá **dropear localmente** las filas de ese establecimiento del SQLite local (consecuencia del scoping de streams R4.2/R4.5), y la app deberá entrar en `active_lost` si era el campo activo (spec 01 R6.10).

**R8.3** El sistema deberá mantener acotado el **tamaño del sync set** por el scoping correcto por establecimiento (R4.1), de modo que un device nunca baje data de campos donde el usuario no opera (perf + costo + PII).

## R9 — Connector + boot: no-bypass por device (seguridad)

**R9.1** El sistema deberá garantizar que el contenido sincronizado a un device es **exactamente** el que las streams permiten para ese `auth.user_id()` — el device **no deberá** poder pedir ni recibir filas fuera de sus streams (la stream es la frontera; no hay un canal alterno). `[web/server]`

**R9.2** El sistema deberá disponer de una suite de **tests de no-bypass por device** que espejen los tests RLS existentes: para cada clase de stream, un usuario A no recibe los datos del establecimiento de un usuario B; `user_private` de B no llega al device de A. (Acceptance #2 y #3.)

## R10 — Observabilidad de sync (mínima)

**R10.1** El sistema deberá exponer al menos un estado de conexión/sync del DB local (conectado / sincronizando / pendientes en cola) consultable por la UI, para poder mostrar "sin conexión, se subirá después" donde haga falta.

**R10.2** Cuando una op de la upload queue sea rechazada permanentemente (R3.5 / R8.1), el sistema deberá dejar registro observable del rechazo (log / estado), de modo que el rechazo no sea silencioso.

## R11 — Swap localizado (no romper lo construido)

**R11.1** El sistema deberá contener el swap PostgREST→SQLite-local **dentro de la capa de services** (`app/src/services/*.ts`), preservando las firmas públicas de cada service (`ServiceResult<T>`/`AppError`), sin tocar pantallas, hooks ni componentes salvo el montaje del provider. (Acceptance #5.)

**R11.2** El sistema **no deberá** romper los flujos ya construidos y gateados: auth, creación/listado de campos, alta de animal, ficha, eventos, lotes, rodeos. La suite E2E + unit existente deberá seguir verde tras el swap.

**R11.3** El sistema **no deberá** modificar las RLS/policies/triggers/Edge Functions existentes del schema as-built; el wiring de PowerSync es cliente + streams. Se **permite UN delta de backend ADITIVO** de idempotencia, **aprobado en Puerta 1 (2026-06-08)**, acotado a:
- una columna **nullable** `client_op_id uuid` en `reproductive_events` (única tabla del delta),
- un índice **UNIQUE parcial COMPUESTO** `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` (compuesto, **NO global**: el índice por `(madre, client_op_id)` cierra el oráculo de existencia cross-tenant residual del global — fix HIGH-D1, Gate 1 del delta; ver design §9-nota),
- un parámetro `p_client_op_id uuid default null` en la RPC `register_birth` con guard de dedup **scopeado al caller** (el guard es un path de lectura: la authz `has_role_in` sobre la fila real de la madre rige primero, y el lookup del `client_op_id` se scopea a `animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est`; si ya existe un parto con ese `client_op_id` **del propio caller**, cortar y devolver el existente; si colisiona con un parto **ajeno**, error genérico, **nunca** devolver datos ajenos — invariante de R6.10, fix HIGH-D1).

Este delta **no deberá** cambiar el comportamiento del path **online** (cuando `p_client_op_id` es NULL, idéntico al as-built) ni tocar ninguna policy/RLS/trigger, ni **debilitar la authz cross-tenant** (el guard scopeado preserva la frontera de tenant en TODOS los paths, incluida la rama no-op). La migración del delta es nueva (numeración ≥ `0075`; el as-built en disco llega a `0074`) y la escribe/aplica el implementer por Management API, **gateada por el leader y por Gate 1 (spec)** (R11.4). La suite backend (RLS + Edge) existente **deberá** seguir verde tras el delta, más los tests nuevos de idempotencia (T7.7). Ninguna otra RPC del camino offline (`exit_animal_profile`, `create_animal`, `soft_delete_*`) recibe delta — son dedup-natural (R6.10).

> **RECONCILIADO (Run 4, migración `0076`)**: además del delta de idempotencia (`0075`, columna + índice + `register_birth`), la feature incorpora un **SEGUNDO delta de backend ADITIVO**: el trigger `establishment_soft_delete_deactivates_roles` + backfill (`0076`) que mantiene `user_roles.active` coherente con el soft-delete de establecimientos (habilita el modelo de sync JOIN-free; ver R4.1 reconciliado y design §9 / Historial 2026-06-09). Sigue siendo **estrictamente aditivo y schema-sensitive** bajo el mismo régimen de R11.4: NO modifica policies/RLS existentes ni otras funciones/triggers, NO cambia comportamiento observable de la app/RLS (`has_role_in`/`is_owner_of`/membership ya filtraban `deleted_at`), y se aplica por Management API gateado por el leader + Gate 1 (spec) + Gate 2 + reviewer. Por lo tanto, donde R11.3 dice "UN delta", el as-built son **DOS deltas aditivos** (`0075` idempotencia + `0076` trigger de roles), ambos bajo el mismo gate.

**R11.4 — Gate del delta (schema-sensitive).** Como el delta de R11.3 toca el schema (columna + índice + firma/cuerpo de RPC), el sistema deberá considerarlo **schema-sensitive** y someterlo a **Gate 1 (`security_analyzer` modo `spec`)** ANTES de implementarlo (espeja la regla de las streams). Gate 1 deberá verificar que el delta es estrictamente aditivo: no debilita ninguna policy, no cambia la authz de `register_birth` (las guardas `has_role_in` siguen sobre la fila real de la madre), y el path online (`p_client_op_id` NULL) es idéntico al as-built. **Gate 1 deberá además verificar que el cuerpo del guard de idempotencia implementa el scoping de tenancy de R6.10 (lookup scopeado a `animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est`, NO el lookup global por `client_op_id`) y el error genérico ante colisión ajena — es el fix HIGH-D1: el guard "literal" (lookup global) sería vulnerable a IDOR cross-tenant y NO debe aplicarse.** La corrección del doble-apply y del rollback (R6.10/R6.11/R6.12) se valida además en **Gate 2 (code)**.

> **RECONCILIADO (Run 4, migración `0076`)**: el SEGUNDO delta aditivo —el trigger `establishment_soft_delete_deactivates_roles` + backfill (`0076`)— es igualmente schema-sensitive y queda bajo este mismo régimen: el leader lo somete a **Gate 1 (`security_analyzer` modo `spec`)** + Gate 2 + reviewer ANTES de aplicarlo por Management API. Gate 1 sobre `0076` debe verificar que el trigger es estrictamente aditivo: (a) NO reactiva roles en el restore (no se puede distinguir desactivado-por-borrado de desactivado-por-remoción-de-miembro); (b) NO hay otro trigger sobre `user_roles` que entre en loop o haga un side-effect destructivo (verificado: no existe ninguno); (c) `security definer` + `set search_path = public` (sin search-path injection); (d) el backfill sólo toca `active = true` (idempotente); (e) NO cambia el resultado de `has_role_in`/`is_owner_of` (ya filtraban `deleted_at`) → sin cambio de comportamiento observable.

> **RECONCILIADO (2026-06-09, paso 2 — denormalización)**: el paso 2 (R13) suma **N deltas de backend ADITIVOS más** (migraciones ≥ `0077`): una columna `establishment_id` denormalizada + trigger-force + backfill por cada tabla hija (las 5 eventos + `animal_category_history` + `birth_calves` + `rodeo_data_config`), y —si Raf aprueba (b1)— columnas de identidad denormalizadas sobre `animal_profiles` + triggers force/propagación. Todos son **estrictamente aditivos** (NO modifican policies/RLS/triggers existentes; la RLS as-built de cada tabla sigue derivando el tenant por FK) y **schema-sensitive** → cada uno bajo el MISMO régimen de R11.4: Gate 1 (spec) ANTES de aplicar por Management API + Gate 2 + reviewer. El spec_author NO escribe estas migraciones (las escribe el implementer). Ver R13 + design §2.4 + ADR-026.

## R12 — Fuera de scope (NO-MVP, límites explícitos)

**R12.1** El sistema **no deberá** sincronizar adjuntos / Storage (fotos, PDFs de labs) en esta feature.

**R12.2** El sistema **no deberá** implementar resolución de conflictos custom más allá de **last-write-wins** (default de PowerSync) para filas editables; los eventos son append-only (sin conflicto). La expansión post-MVP (surfacing del conflicto, árbitro server-side por RPC, concurrencia optimista) queda como nota de diseño, no se implementa.

**R12.3** El sistema **no deberá** sincronizar la **aceptación** de invitaciones (sigue por Edge Function); solo el **listado de pendientes** del owner se sincroniza para lectura (R4.9).

**R12.4** El sistema **no deberá** implementar hard-delete / retención (diferido, esperando SENASA).

## R13 — Paso 2: denormalización de `establishment_id` (tablas hijas + entidades compartidas)

> **Fuente de verdad del patrón: ADR-026 + design §2.4.** El modelo as-built es **JOIN-FREE** (paso 1, V3, validado en vivo): toda tabla sincronizada necesita una columna `establishment_id` PROPIA para filtrar `IN org_scope` sin JOINs. El paso 2 incorpora las tablas que el paso 1 difirió. Cada delta es **aditivo + schema-sensitive** → Gate 1 (R11.4). El spec_author NO escribe migraciones ni el YAML del paso 2.

**R13.1** El sistema deberá agregar una columna **`establishment_id uuid` denormalizada** (FK a `establishments`) a cada tabla hija sin `establishment_id` propio: `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`, `birth_calves`, `rodeo_data_config`.

**R13.2** Cuando se inserte una fila en una de esas tablas hijas, el sistema deberá **forzar** su `establishment_id` derivándolo del padre por FK (ignorando cualquier valor del cliente — patrón anti-spoof, espejo de `tg_force_created_by_auth_uid` `0043`), según la cadena: eventos/`animal_category_history` ← `animal_profiles.establishment_id` del perfil; `birth_calves` ← `reproductive_events.animal_profile_id → animal_profiles.establishment_id`; `rodeo_data_config` ← `rodeos.establishment_id`.

**R13.3** Donde el padre de una tabla hija pueda cambiar por UPDATE (`rodeo_data_config`, cuyo toggle es un UPDATE), el sistema deberá mantener `establishment_id` fiel también en `BEFORE UPDATE`, de modo que un UPDATE no pueda pisar la columna con un campo ajeno.

> **RECONCILIADO (Run 5, `0077`/`0079`/`0080`) — el force en UPDATE se extendió a TODA tabla denormalizada con `GRANT UPDATE` al cliente, no solo `rodeo_data_config`.** El criterio real (más fuerte que el de R13.3): el vector no es solo "el padre cambia", sino "un caller con `GRANT UPDATE` pisa la columna denormalizada por PostgREST directo, dejándola infiel → leak/integridad rota por el WAL". Por eso el as-built fuerza la columna también en UPDATE en: las **5 tablas de evento** (`0077`, tienen `GRANT UPDATE`), `rodeo_data_config` (`0078`, toggle), la **identidad de `animal_profiles`** (`0079`, `BEFORE UPDATE OF` las 3 columnas) y `user_roles.member_name` (`0080`, `BEFORE UPDATE OF member_name`). NO se fuerza en UPDATE donde la tabla es server-only sin `GRANT UPDATE` al cliente: `birth_calves` (`0078`) y `animal_category_history` (`0077`, el trigger se declara `INSERT OR UPDATE` por uniformidad pero es no-op de cliente). El force en UPDATE re-deriva el MISMO valor del padre inmutable → cero impacto en flujos legítimos. Es el criterio del precedente `animal_events` (`0034`, columna denormalizada inmutable en UPDATE). Ver design §2.4 (A)/(B) reconciliado.

**R13.4** El sistema deberá **backfillear** `establishment_id` en las filas existentes de cada tabla hija desde su padre antes de activar su stream, de modo que ninguna fila quede fuera del sync set por un `establishment_id` NULL.

**R13.5** El sistema deberá agregar, por cada tabla hija denormalizada, una **stream JOIN-free idéntica al patrón del paso 1**: `SELECT ... WHERE establishment_id IN org_scope [AND deleted_at IS NULL]` (sin JOINs ni subqueries anidadas), preservando el `id` sintético de `birth_calves`/`rodeo_data_config` (§PK). El sistema **no deberá** reintroducir JOINs en las data queries (incompatibles con el bucket model — PSYNC_S2305).

**R13.6** El sistema **no deberá** modificar la RLS as-built de las tablas hijas: la columna `establishment_id` denormalizada es **solo para el stream**; la RLS sigue derivando el tenant por FK (`establishment_of_profile(...)`). Gate 1 deberá verificar que el trigger-force mantiene la columna fiel y que la stream es equivalente (no más permisiva) a la RLS de la tabla.

**R13.7** El sistema **no deberá** sincronizar la tabla global `animals`. En su lugar, donde Raf apruebe **(b1)** (ADR-026), el sistema deberá denormalizar la identidad del animal (`tag_electronic`/`sex`/`birth_date`) sobre `animal_profiles` (trigger force en el INSERT del perfil + trigger de propagación en el UPDATE de identidad de `animals` + backfill), de modo que la UI lea la identidad offline desde `animal_profiles`. El swap de lectura T4 deberá leer la identidad desde `animal_profiles`, no desde `animals`.

**R13.8** Donde Raf apruebe **(c1)** (ADR-026), el sistema deberá dejar los **nombres de coworkers (`users.name`) ONLINE** (no sincronizados): la pantalla de miembros los lee por PostgREST con red, y offline muestra roles sin nombres. El sistema **no deberá** sincronizar la tabla `users` ni denormalizar `name` (salvo que Raf elija (c2)). La PII (email/phone) **no deberá** salir de `user_private` (self-only, ADR-025) en ninguno de los dos casos.

> **RECONCILIADO (Run 5, migración `0080`) — Raf eligió (c2), NO (c1).** El as-built de R13.8 es la **variante (c2)**: el sistema **denormaliza `users.name` sobre `user_roles.member_name`** (columna + trigger force `BEFORE INSERT OR UPDATE OF member_name` desde `users.name`, anti-spoof + trigger de propagación `AFTER UPDATE OF name ON users` + backfill — `0080`) → los nombres de coworkers (y el propio) quedan **offline**, viajando dentro de los streams `self_user_roles`/`est_members_roles` ya existentes (0 streams nuevas, `users` NO entra al sync set). El swap de lectura se reconcilió: `local-reads.buildMembersQuery`/`buildOwnNameQuery` leen `user_roles.member_name` (sin JOIN a `users`); firmas/shape públicos intactos (R11.1). La PII (email/phone) sigue en `user_private` self-only (ADR-025), NO se denormaliza. (Donde el EARS de arriba dice "(c1)/ONLINE", el as-built es "(c2)/offline vía `member_name`"; nota de reconciliación, no se reescribe el EARS — patrón impl_13.)

> **Decisiones de Raf (B)/(C)**: R13.7 ((b1) animals) y R13.8 ((c2) users/nombres) cambian el modelo de lectura → las surfacea el leader. El spec_author recomendaba (b1)/(c1); Raf aprobó **(b1)** y eligió **(c2)** (ADR-026 / current.md). El as-built refleja (b1)+(c2).

---

## Mapa context → requirements (cobertura Gate 0)

| Decisión / edge case de `context.md` | Requirement(s) |
|---|---|
| D1 — lectura de todo el schema offline | R5.1–R5.4 |
| D1 — escritura offline del camino de campo | R6.1–R6.6 |
| D1 — identidad/admin online | R7.1 |
| D1 — listado de invitaciones pendientes se sincroniza (excepción Raf) | R4.9 |
| D2 — dual SDK (web ahora + native dev build) | R2.2, R2.4, R2.5 |
| Scoping por rol activo = frontera de autorización (Gate 1) | R4.1, R4.2, R9.1, R9.2 |
| `user_private` self-only (ADR-025, WAL) | R4.3, R9.2 |
| Catálogos globales read-only | R4.4 |
| Conflictos LWW (MVP) + nota post-MVP | R12.2 |
| Edge: mutación a campo con rol perdido (`active_lost`) | R8.1, R8.2 |
| Edge: cambiar de campo activo offline | R7.2 |
| Edge: primer login sin red | R5.4 |
| Edge: tamaño del sync set | R8.3 |
| Edge: token expirado / refresh | R3.2 |
| Estrategia de retrofit localizado en services | R11.1, R11.2 |
| Gotcha RLS-on-RETURNING en el swap | R6.3 |
| Fuera de scope (Storage, conflictos custom, aceptación de invitación, hard-delete) | R12.1–R12.4 |
| Provisioning ya hecho (precondición) | R1.1 |
| Mutaciones RPC-bound (issue de diseño nuevo) | R6.5, R6.6, R6.7 |
| Parto/baja/soft-delete/alta OFFLINE vía outbox + RPC (Puerta 1, opción ii) | R6.6, R6.8, R6.9, R6.11 |
| Idempotencia de la outbox at-least-once (no doble-apply) | R6.10 |
| Delta de backend aditivo de idempotencia (Puerta 1, solo `register_birth`) | R6.10, R11.3, R11.4 |
| No doble-upload (overlay local-only vs intent) | R6.11, R6.12 |
| `import_rodeo_bulk` queda online (excepción Puerta 1) | R6.6 |
| Paso 2 — tablas hijas sin `establishment_id` propio → denormalizar (ADR-026) | R4.6, R4.8, R4.10, R13.1–R13.6 |
| Paso 2 — `animals` global (b1: identidad denorm. en `animal_profiles`) — decisión Raf | R4.7, R13.7 |
| Paso 2 — nombres de `users` (c2: offline vía `user_roles.member_name`) — decisión Raf | R13.8 |

## Acceptance criteria (de `feature_list.json`) → requirements

| Acceptance | Requirement(s) |
|---|---|
| Instancia provisionada y conectada | R1.1 |
| Streams scopean por rol activo; device no sincroniza campo ajeno | R4.1, R4.2, R9.1, R9.2 |
| `user_private` self-only (frontera WAL) | R4.3, R9.2 |
| App lee/escribe SQLite local, offline; cola sincroniza al volver la red | R5.1, R5.2, R6.1, R6.2, R3.3 |
| Swap localizado en services, no rompe flujos construidos | R11.1, R11.2, R11.3 |

## Gate de seguridad

**Gate 1 (`security_analyzer` modo `spec`) es OBLIGATORIO** sobre las sync streams del `design.md` antes de cualquier deploy a la instancia y antes de la Puerta 1 humana. Las streams son la frontera de autorización (schema/RLS/auth-sensitive). Foco: cada stream scopea por `establishment_id` + rol activo; `user_private` self-only; sin leak cross-tenant por el canal WAL; `deleted_at IS NULL` donde corresponde. **Gate 1 ya dio PASS** sobre las streams (fix-loop 2026-06-08).

**La opción (ii) de Puerta 1 (offline vía RPC-mapping, R6.6–R6.12) NO cambia las sync streams** — la frontera de read-authz es idéntica, así que el PASS de Gate 1 sobre las streams **se mantiene**. La outbox y el overlay optimista son write-side / local-only (no sincronizados, sin superficie de stream/RLS). El foco de seguridad del write-path opción (ii) es **Gate 2 (`security_analyzer` modo `code`)**: idempotencia correcta (no doble-apply, R6.10), no doble-upload (R6.12), rollback optimista correcto (R6.11), outbox/overlay sin leak, y que las RPCs re-validen authz server-side igual que online (mismo JWT, mismas guardas) — ver design §7-bis.

**El delta de backend de idempotencia (R11.3/R11.4) SÍ es schema-sensitive y requiere Gate 1 (`security_analyzer` modo `spec`) ANTES de implementarlo.** Aunque es estrictamente aditivo (columna nullable + índice UNIQUE parcial + param con default null en `register_birth`), toca el schema y la firma/cuerpo de una RPC SECURITY DEFINER → Gate 1 debe confirmar que no debilita ninguna policy ni cambia la authz, y que el path online (`p_client_op_id` NULL) es idéntico al as-built. La migración del delta (≥ `0075`) NO se aplica antes de Gate 1 PASS + aprobación del leader.

## Resueltas en Puerta 1 (2026-06-08)

1. **Estrategia de las mutaciones (b) RPC-bound** (R6.7) — **RESUELTA: opción (ii)**. Parto (`register_birth`), baja (`exit_animal_profile`), soft-deletes (`soft_delete_*`) y alta de animal (`createAnimal`) funcionan **OFFLINE** vía outbox local (write-side, no sincronizado) + mapeo a RPC en `uploadData()` (R6.6, R6.8–R6.11). `import_rodeo_bulk` queda **ONLINE** (excepción: onboarding masivo, no camino de manga). La opción (i) (todo online) queda descartada para esas 4 mutaciones. El punto crítico es la **idempotencia** (R6.10): la cola es at-least-once → la dedup por `client_op_id` evita el doble-apply.

5. **Delta de backend de idempotencia** (R6.10/R11.3, última pasada de diseño 2026-06-08) — **RESUELTA: delta ADITIVO mínimo, solo `register_birth`.** Tras leer las RPCs as-built, el delta se acotó a **una sola tabla**: columna nullable `client_op_id uuid` en `reproductive_events` + índice UNIQUE parcial + param `p_client_op_id uuid default null` en `register_birth` con guard de dedup. **`exit_animal_profile` NO recibe delta**: la RPC `0044` es una transición de status (`WHERE id = p_profile_id`, no setea `deleted_at`, no toca `category_id` → no dispara el trigger de category_history); un reintento re-aplica un UPDATE de status idéntico (mismo end-state, sin segundo efecto) → **naturalmente idempotente**. `create_animal` (ids de cliente + ON CONFLICT) y los `soft_delete_*` (guarda `deleted_at IS NULL`) tampoco reciben delta (dedup-natural). El delta es **schema-sensitive → Gate 1 (spec) obligatorio antes de implementar** (R11.4). El path online (`p_client_op_id` NULL) queda idéntico al as-built (no rompe nada).

6. **Hueco de correctitud DOUBLE-UPLOAD** (última pasada de diseño 2026-06-08) — **RESUELTO: overlay LOCAL-ONLY (opción b).** El diseño previo escribía las filas optimistas en las tablas **sincronizadas** *y además* encolaba el `op_intent` → PowerSync generaría CrudEntry para ambas → `uploadData()` aplicaría la op dos veces (INSERT/UPDATE plano + RPC). **Resuelto** moviendo el efecto optimista a un **overlay `localOnly` en `AppSchema`** (no genera CrudEntry → no se sube): la única CrudEntry de una op (b) es su `op_intent`. Las lecturas hacen **UNION** synced + overlay pendiente (R6.11). En el ACK se limpia el overlay; en el rechazo permanente se borra el overlay (rollback sin residuo server, sin huérfanos). Esto además evita la colisión de ids en el sync-down: `register_birth` asigna ids **server-side** a los terneros (`0045`), así que un overlay con ids de cliente en tablas sincronizadas habría quedado duplicado contra las filas reales; el overlay local-only se limpia y las reales bajan limpias. R6.11 reescrita + R6.12 nueva.
4. **Visibilidad de la matriz de roles de coworkers offline** (Gate 1 MED-1, 2026-06-08) — **RESUELTA: owner-only**. La stream `est_members` quedó **owner-gated** para la matriz de `user_roles` de coworkers (solo un owner sincroniza los roles ajenos), espejando la RLS `user_roles_select`. Default seguro confirmado en Puerta 1. La query de **nombres** de coworkers (`users`) NO se gatea (todos los miembros ven los nombres, sin PII; la PII vive en `user_private`, self-only). Si en el futuro se quisiera que un `field_operator` vea la matriz de roles del campo offline, habría que cambiar **JUNTAS** la RLS `user_roles_select` Y la stream `est_members` (cambiar solo la stream rompería la equivalencia stream↔RLS y volvería a fallar Gate 1) — fuera del scope de esta feature.

## Decisiones abiertas para la Puerta 1

> Todas las decisiones de fondo se cerraron en la Puerta 1 (ver "Resueltas en Puerta 1"). Queda un único punto técnico de implementación, NO bloqueante para la aprobación de la spec:

2. **Tablas sin PK `id` usable** (issue de implementación, se confirma en T1.3): `birth_calves` (PK compuesta `(birth_event_id, calf_profile_id)`) y `rodeo_data_config` (PK compuesta `(rodeo_id, field_definition_id)`). Ambas son select-only/casi-estáticas en el camino de campo. Decisión técnica: cómo darles un `id` sintético en `AppSchema` (ver design §PK). No depende de aprobación humana — es elección de sintaxis del SDK.

## Historial de refinamiento

- 2026-06-08 — redacción inicial desde `context.md` (Gate 0 aprobado). Sin cambios de requirements posteriores (feature nueva).
- 2026-06-08 — **fix-loop de Gate 1** (`security_analyzer` modo `spec`, FAIL: 1 HIGH + 2 MED). Reconciliado sin tocar código ni migraciones:
  - **R4.1**: el predicado de scoping per-establishment ahora es el **predicado canónico** que espeja `has_role_in` — incluye explícitamente el `JOIN establishments` + `AND establishments.deleted_at IS NULL` (campo vivo), no solo `active = true`. Fix de HIGH-1 (sin el filtro de campo vivo, la stream era más permisiva que la RLS y dejaba leak por el WAL tras soft-deletear un campo, porque no hay trigger que desactive `user_roles`).
  - **R4.2**: ampliado para que el "no incluir filas" cubra también el caso de **establecimiento soft-deleteado** aunque el usuario conserve rol activo (caso concreto del leak de HIGH-1).
  - **R4.9**: el subselect de `invitations` ahora referencia el predicado canónico (campo vivo + owner); MED-2 heredaba el hueco de HIGH-1.
  - **Decisiones abiertas para la Puerta 1**: agregada la #4 (MED-1) — `est_members` endurecida a owner-gated para la matriz de roles de coworkers (espeja `user_roles_select`); cambiarla requiere tocar RLS + stream juntas.
  - El detalle del fix y la lista completa de las ~20 streams tocadas está en `design.md` §10 (entrada 2026-06-08) y §2.
- 2026-06-08 — **Puerta 1 (decisiones humanas de Raf)**, reconciliadas en la spec (regla dura: spec no contradictoria con lo decidido). Sin tocar código ni migraciones:
  - **Decisión 1 (offline vía RPC-mapping)**: se eligió la **opción (ii)** de R6.7. **R6.6 reescrita**: parto (`register_birth`), baja (`exit_animal_profile`), soft-deletes (`soft_delete_*`) y alta (`createAnimal`) pasan a OFFLINE vía outbox + mapeo a RPC; `import_rodeo_bulk` queda ONLINE (excepción: onboarding masivo). **R6.7 marcada RESUELTA** (opción ii). **R6.8–R6.11 nuevas**: outbox write-side no sincronizado (`insertOnly` en AppSchema, preserva R11.3), drenado vía RPC, **idempotencia por `client_op_id`** (no doble-apply en una cola at-least-once — el punto crítico), estado optimista + rollback ante rechazo permanente. Mapa context→requirements y "Decisiones abiertas" actualizados (las resueltas movidas a "Resueltas en Puerta 1").
  - **Decisión 2 (roles offline owner-only)**: confirmada como RESUELTA (ya aplicada en `est_members` por MED-1 del Gate 1). La ex-"decisión abierta #4" pasó a "Resueltas en Puerta 1: owner-only". Sin cambio de stream.
  - Detalle del mecanismo de outbox/idempotencia/rollback y la seguridad del write-path opción (ii): `design.md` §5.3, §5.4, §7-bis y §10 (entrada 2026-06-08, decisiones de Puerta 1).
- 2026-06-08 — **Última pasada de diseño antes de implementar (delta de idempotencia + cierre del hueco double-upload)**. Reconciliado sin tocar código ni migraciones reales:
  - **Delta de idempotencia acotado tras leer las RPCs as-built** (`0044`, `0045`, `0041`, `app/src/services/animals.ts`):
    - **R6.10 reescrita**: dedup por op con evidencia. `register_birth` → dedup EXPLÍCITA por `client_op_id` (necesita el delta: el evento de parto y los terneros llevan ids server-side, no hay id de cliente que dedupee). `exit_animal_profile` → dedup NATURAL (transición de status idempotente, no setea `deleted_at`, no toca `category_id` → no dispara trigger de category_history) → **SIN delta**. `create_animal` → dedup natural por id de cliente. `soft_delete_*` → dedup natural por guarda `deleted_at IS NULL` (+ manejo del P0002 del reintento como éxito idempotente, no rollback).
    - **R11.3 reescrita**: de "no schema changes" a "no se modifican RLS/policies/triggers; se permite UN delta ADITIVO de idempotencia (columna nullable `client_op_id` en `reproductive_events` + UNIQUE parcial + param `p_client_op_id default null` en `register_birth`) aprobado en Puerta 1, que no cambia el comportamiento online". Migración ≥ `0075` (as-built llega a `0074`), la escribe/aplica el implementer por Management API gateado por el leader.
    - **R11.4 nueva**: el delta es schema-sensitive → Gate 1 (spec) obligatorio antes de implementar.
  - **Cierre del hueco DOUBLE-UPLOAD (correctitud)**:
    - **R6.11 reescrita**: el estado optimista pasa de "filas en tablas sincronizadas" a un **overlay `localOnly`** (no genera CrudEntry → no se sube); lecturas hacen UNION synced + overlay; limpieza en ACK; borrado en rechazo permanente.
    - **R6.12 nueva**: la única CrudEntry de una op (b) es su `op_intent` → no doble-apply por doble fuente. Verificable por test.
  - Mapa context→requirements, acceptance, "Resueltas en Puerta 1" (#5 delta, #6 double-upload), Gate de seguridad y user story actualizados. Detalle en `design.md` §5.3.2/§5.3.3/§5.4 y §10 (entrada 2026-06-08, última pasada).
- 2026-06-08 — **Fix-loop Gate 1 DEL DELTA** (`security_analyzer` modo `spec`, FAIL: 1 HIGH = **HIGH-D1, IDOR cross-tenant en la rama idempotente de `register_birth`**). Las streams (§2) NO cambiaron → su PASS previo vale; el FAIL es del delta write-side. Reconciliado sin tocar código ni migraciones reales:
  - **Causa**: las 4 fuentes describían el guard de idempotencia como un lookup PURO por `client_op_id` (`SELECT id WHERE client_op_id = p_client_op_id → RETURN`), sin exigir que el parto existente perteneciera al caller. Como `client_op_id` es attacker-controlled y el índice UNIQUE era global, un atacante autenticado podía, por replay/colisión, recibir el `id` de un parto de OTRO establecimiento por el canal RPC. "Authz antes del guard" no alcanzaba (el `has_role_in` valida sobre la madre que el caller pasó, no sobre la madre del parto existente).
  - **Verificación de schema**: `reproductive_events` (`0026`) NO tiene `establishment_id` denormalizado → la tenencia se deriva vía `animal_profiles`. → el scoping se ancla en `animal_profile_id = p_mother_profile_id` + `animal_profiles.establishment_id = v_est`.
  - **R6.10 (bullet `register_birth`) reescrita**: la dedup por `client_op_id` es **scopeada al caller**, NUNCA cross-tenant — el guard es un path de lectura → authz primero + lookup scopeado a la madre/tenant del caller + `deleted_at IS NULL`; ante colisión ajena, error genérico (`23505`), nunca devolver datos ajenos ni oráculo de existencia.
  - **R11.3**: el índice pasa de **global** a **UNIQUE parcial COMPUESTO `(animal_profile_id, client_op_id)`** (cierra el oráculo de existencia cross-tenant residual del global, E4); el guard descripto como scopeado al caller. El delta no debilita la authz cross-tenant en ningún path.
  - **R11.4**: Gate 1 del delta debe verificar adicionalmente que el cuerpo del guard implementa el scoping de tenancy (no el lookup global) + el error genérico ante colisión ajena — el guard literal sería vulnerable y NO debe aplicarse.
  - **tasks.md T6.4**: el cuerpo de la RPC debe implementar el guard con scoping de tenancy + error genérico ante colisión ajena (aviso explícito de no escribir el guard literal); índice compuesto. **T7.7**: caso negativo cross-tenant obligatorio (A no recibe el parto de B por `client_op_id` colisionado).
  - Detalle en `design.md` §5.4.3(1) (cuerpo del guard), §7-bis (nota de seguridad), §9-nota (índice compuesto vs global), §10 (entrada 2026-06-08, fix HIGH-D1). Bitácora `progress/spec_15-powersync.md`.
- 2026-06-08 — **Reescritura del YAML de sync streams al patrón `with:`/INNER JOIN** (fix runtime `[PSYNC_S2305] too many buckets (limit of 1000)` / regresión powersync-service #611). El patrón viejo (subquery anidada inline) generaba un bucket por cada FILA de datos de la subquery → ~2200 buckets con la beta contaminada → 0 bytes + loop de reconexión. **Es un fix de SINTAXIS/ESTRUCTURA, NO de autorización** — la frontera de read-authz es idéntica (Gate 1 sobre las streams seguía PASS por autorización; el re-Gate 1 verifica la EQUIVALENCIA del cambio estructural). Reconciliado sin tocar código, migraciones ni `feature_list.json`:
  - **R4.1**: agregada la nota de estructura — la regla de scoping (frontera) NO cambia; la estructura SQL que la implementa pasó a CTE `org_scope`/`owner_scope` (`with:`, rol activo) + `INNER JOIN establishments` (campo vivo) por el límite de buckets #611. R4.2–R4.11 sin cambio de semántica.
  - **design.md**: §2 reescrita (22 streams per-est con `with:`/JOIN; FK/columnas verificadas contra el schema as-built), §2.1-superseded (patrón viejo marcado SUPERSEDED + nota #611), §2.2 (estrategia de bucketing + matemática ≈ 51–117 buckets para Raf << 1000), §2.2-incertidumbres (5 incertidumbres de sintaxis para el validador del dashboard), §2.3-equivalencia (tabla viejo→nuevo por stream), §7 (predicado canónico repartido CTE+JOIN), §9 (Opción 2 NO tomada: trigger que desactive `user_roles.active` al soft-deletear un campo → diferida, requiere análisis RLS + Gate 1 + migración), §10 (entrada 2026-06-08).
  - **`sync-streams/rafaq.yaml`**: reescrito byte-faithful al §2 nuevo (mirror).
  - **tasks.md**: T2.1/T2.2/T2.3 (nota de la reescritura `with:`/JOIN + el re-Gate 1 verifica equivalencia + el validador del dashboard confirma sintaxis fina y conteo de buckets).
  - **NO** se deployó (lo hace Raf tras re-Gate 1), **NO** se tocó backend (la Opción 2 del trigger quedó diferida), **NO** se tocó la frontera de autorización. Detalle en `design.md` §2/§2.1-superseded/§2.2/§2.3-equivalencia/§9/§10. Bitácora `progress/spec_15-powersync.md`.
- 2026-06-09 — **Reconciliación al as-built V3 JOIN-FREE (cierre del drift L-1 del Gate 1) + DISEÑO del paso 2 (denormalización) + ADR-026.** Sin tocar código, migraciones ni el YAML (el implementer escribe las migraciones/streams del paso 2 tras Gate 1 + aprobación de (B)/(C)):
  - **R4.6/R4.7/R4.8/R4.10 reconciliados** al modelo JOIN-FREE: la derivación del establecimiento de las tablas hijas ya NO se hace por JOIN al perfil/rodeo/parto (PowerSync no tolera JOINs en las data queries — #611/PSYNC_S2305) sino vía una columna **`establishment_id` denormalizada** (trigger-force + backfill), con stream `WHERE establishment_id IN org_scope` idéntica al paso 1. R4.7 (`animals`) reescrita: NO se sincroniza la tabla global; la identidad se denormaliza sobre `animal_profiles` (b1). La frontera de autorización es la misma (la RLS as-built NO cambia).
  - **R13 nuevo** (paso 2): R13.1–R13.6 (denormalización mecánica de las 8 tablas hijas: columna + trigger-force anti-spoof + backfill + stream JOIN-free; RLS as-built intacta), R13.7 ((b1) animals → identidad denormalizada sobre `animal_profiles`, NO sincronizar `animals` — **decisión de Raf**), R13.8 ((c1) users/nombres → ONLINE, no sincronizar `users` — **decisión de Raf**; alternativa (c2) denormalizar `name` sobre `user_roles`).
  - **R11.3 reconciliada**: de "DOS deltas aditivos" a "+N deltas de denormalización del paso 2" (≥ `0077`), todos aditivos + schema-sensitive bajo el mismo régimen de R11.4 (Gate 1 por delta, los escribe el implementer).
  - **design.md** §2 marcada SUPERSEDED-POR-RUNTIME (el bloque V2 `with:`/JOIN siguió fallando: PowerSync enumera toda `establishments` por stream → el as-built es V3 JOIN-FREE, `rafaq.yaml`), §2.2 con el bloque AS-BUILT V3 (bucket math), **§2.4 nueva** (paso 2: (A) tablas hijas + (B) animals/b1 + (C) users/c1 + bucket math 25 streams ≈ 43 buckets), §3 reconciliada. **ADR-026 escrito**. **tasks.md** fase T9 nueva.
  - **(B)/(C) son DECISIONES de Raf** (cambian el modelo de lectura) → el leader las surfacea; el spec_author recomienda (b1)/(c1). NO se aplicó migración ni se deployó el YAML del paso 2. Bitácora `progress/spec_15-powersync.md`.
