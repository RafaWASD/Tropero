# Design — 15-powersync

> Cómo se construye lo de `requirements.md`. Fuente de verdad de las decisiones: `context.md` (Gate 0).
> Apoyo: `docs/architecture.md` (services = única capa de I/O), `docs/conventions.md`, ADR-002/020/021/025, spec 01 §PowerSync.

## 0. Hechos técnicos (no inventar sintaxis vieja)

- PowerSync usa **Sync Streams** con `config.edition: 3`. El helper de auth es **`auth.user_id()`** (= `sub` del JWT de Supabase). El modelo viejo de `bucket_definitions`/`token_parameters` está **deprecado** y NO se usa.
- **El contenido de las streams ES la frontera de autorización** (lo audita Gate 1). No hay RLS por encima del wire de sync: el WAL replica la tabla base ignorando views/RPCs/column-GRANTs (razón ADR-025). Por eso cada stream debe scopear explícitamente.
- **Cliente**: `@powersync/react-native` (device) + `@powersync/web` (web, banco de pruebas) + `@powersync/react` (hooks). `AppSchema` espeja las tablas sincronizadas (PowerSync no enforça tipos). Cada tabla sincronizada **necesita un PK `id`**.
- **Connector** (`PowerSyncBackendConnector`): `fetchCredentials()` → `{ endpoint, token }`; `uploadData()` drena la upload queue contra Supabase con el cliente existente.

---

## 1. Arquitectura del cliente

### 1.1 Archivos a crear

```
app/src/services/powersync/
  schema.ts          → AppSchema (espeja las tablas sincronizadas; PK id en todas) + la tabla outbox `op_intents` (insertOnly, §5.3.2) + las tablas OVERLAY optimista `pending_*` (localOnly, §5.3.3 — NO generan CrudEntry)
  connector.ts       → SupabaseConnector implements PowerSyncBackendConnector
  database.ts        → factory del DB por plataforma (web WASM vs native) + instancia singleton
  provider.tsx       → <PowerSyncProvider> usando @powersync/react (PowerSyncContext.Provider)
  status.ts          → helper de estado de conexión/sync para la UI (R10.1)
  local-reads.ts     → (as-built Run 3) SQL builders PUROS del swap de lectura: build<Algo>Query → { sql, args }. Sin imports (testeable node:test). (R5.1/R5.4)
  local-query.ts     → (as-built Run 3) I/O del swap de lectura: runLocalQuery/runLocalQuerySingle (getAll + degradación "aún no sincronizó" vía currentStatus.hasSynced). (R5.4)
  upload.ts          → mapeo de las CrudEntry de la upload queue → CRUD plano (§5.4.1) | intención→RPC (§5.4.2); idempotencia (§5.4.3); ACK→limpia overlay / rechazo→rollback overlay (§5.4.4) (R3.3, R6.8–R6.12)
  outbox.ts          → helpers para encolar una intención (op_type+params+client_op_id) + escribir el efecto optimista en el overlay localOnly (`pending_*`) en una sola tx local (§5.3.2/§5.3.3); limpieza/rollback del overlay por client_op_id (§5.4.4)
sync-streams/
  rafaq.yaml         → definición de las sync streams (deploy a la instancia, gateado por Gate 1)
```

> **As-built Run 1 (reconciliación, T1.x):** para mantener la testabilidad bajo `node:test` (que no puede cargar módulos que importen RN/expo/supabase/SDK), la **lógica PURA** se separó en módulos sin I/O, espejando el patrón del repo (`exit-animal.ts` ↔ `animals.ts`):
> - `platform-select.ts` — `pickPowerSyncPackage(os)` (decisión web vs native); `database.ts` la consume.
> - `upload-classify.ts` — `buildCredentials(endpoint, session)` (R3.1) + `isTransientUploadError`/`isPermanentServerCode` (R3.4/R3.5); `connector.ts` la consume.
> - `status-derive.ts` — `deriveSyncUiState` + `syncStatusLabel` (R10.1); `status.ts` la consume.
> - `app/src/utils/env-resolve.ts` — `resolveEnv(reader)` (R1.2/R1.3, la validación fail-closed); `env.ts` la consume con el reader real (expo-constants).
> En Run 1 NO se crearon `upload.ts` ni `outbox.ts` (son Run T6): el `uploadData()` base de CRUD plano vive en `connector.ts`, con el mapeo `op_intents`→RPC, el overlay y la idempotencia como STUB marcado `// TODO Run T6`.

### 1.2 Archivos a modificar

```
app/src/utils/env.ts                 → agregar EXPO_PUBLIC_POWERSYNC_URL a getEnv() (R1.2/R1.3)
app/App.tsx (o el root provider)     → montar <PowerSyncProvider> por encima del árbol (R2.3)
app/src/services/animals.ts          → lecturas → watchable local; createAnimal → OUTBOX (intención create_animal + filas optimistas) → RPC en uploadData (Puerta 1, opción ii)
app/src/services/events.ts           → lecturas → watchable local; addWeight/.../addObservation → local+upload (CRUD plano); registerBirth → OUTBOX (intención register_birth + terneros optimistas) → RPC (opción ii)
app/src/services/management-groups.ts→ lecturas → watchable local; assignAnimalToGroup/create/rename → local+upload (CRUD plano); softDelete → OUTBOX (intención soft_delete_management_group) → RPC (opción ii)
app/src/services/rodeos.ts           → lecturas → watchable local; **createRodeo OFFLINE vía RPC `create_rodeo` (0081) + outbox/overlay (Run T9.8 — un-defer, Raf: offline-first sin excepciones)**: NO es CRUD plano single-tabla como createManagementGroup — su plantilla (`rodeo_data_config`) la seedea un trigger server-side (`tg_rodeos_seed_data_config`, 0018) + el diff de toggles, y `rodeo_data_config` tiene PK COMPUESTA (read-only-local) → por eso va por una RPC ATÓMICA server-side `create_rodeo` (id de cliente + INSERT ON CONFLICT DO NOTHING + UPSERT de los toggles, idempotente; owner-only is_owner_of, espeja rodeos_insert 0017) + outbox (intent `create_rodeo`) + overlay optimista (`pending_rodeos` + `pending_rodeo_data_config`, la plantilla COMPUTADA en el cliente). Offline el rodeo Y su plantilla aparecen al instante (UNION en buildRodeosQuery/buildRodeoConfigQuery). Idempotencia NATURAL (sin client_op_id: replay = no-op total — ON CONFLICT del id + el trigger de seed no re-dispara + UPSERT de toggles). softDelete rodeo → OUTBOX (intención soft_delete_rodeo) → RPC (opción ii) — HECHO en T6.
app/src/services/rodeo-config.ts     → lecturas → watchable local (catálogo + toggle). **Editar plantilla OFFLINE vía RPC `set_rodeo_config` (0082) + outbox/overlay (Run T9.9 — gemelo de T9.8 para EDICIÓN; Raf: offline-first sin excepciones)**: `editar-plantilla.tsx` encola `enqueueSetRodeoConfig` (intent `set_rodeo_config` + overlay `pending_rodeo_data_config` del diff de `computeEditDiff`) en vez de UPDATE/INSERT online a `rodeo_data_config` (PK COMPUESTA, read-only-local). La RPC DERIVA el est del rodeo (anti-IDOR hermético; owner-only is_owner_of, espeja rodeo_data_config_update/insert 0018) + UPSERT idempotente (sin client_op_id; replay = no-op). `buildRodeoConfigQuery` pasó a **overlay-override** (el overlay pisa la fila synced por field) para no duplicar el field en edición. **Reconciliación rowid (Run T9.9 follow-up, 2026-06-09):** el overlay-override NO se dedupa por `MAX(rowid)` (el diseño T9.9 original) — las tablas de PowerSync son **VIEWS** y NO exponen `rowid` (`db.getAll` tiraba "no such column: rowid" online y offline; el unit test no lo cazó porque corre contra `node:sqlite`, tablas reales con rowid). El as-built es: el synced excluye los fields del overlay (`NOT IN`) `UNION ALL` TODAS las filas del overlay del rodeo, apoyado en un **INVARIANTE de ≤1 fila de overlay por (rodeo_id, field_definition_id)** que garantiza `enqueueSetRodeoConfig` con un **DELETE-PRIOR** (borra la fila previa de ese rodeo+field, de cualquier `client_op_id`, antes del INSERT del overlay). Builder nuevo `buildDeletePendingRodeoConfig`. **Cierre de zona (2026-06-09):** las viejas escrituras ONLINE `toggleRodeoField`/`enableNonDefaultField` se REMOVIERON de `rodeo-config.ts` (0 callers tras T9.9, verificado por grep en todo `app/`) → el módulo quedó **read-only** (solo lecturas locales); la authz owner-only sigue viva en la RPC `set_rodeo_config` 0082. Además, el `onSave` de `editar-plantilla.tsx` pasó a **`router.back()` al guardar OK** (vuelve a RodeosScreen; consistente con `editar-campo.tsx` `onSaved → router.back()` y con el cierre de la acción terminal "Guardar"): diff-vacío también vuelve, error de encolado se queda y muestra el error. Sin primitiva de toast reusable en `@/components` → back inmediato silencioso (no se construyó primitiva nueva); se removieron el estado `savedOk`, el texto inline "Plantilla guardada" y el helper `reloadBaseOnly`.
app/src/services/establishments.ts   → lectura del contexto → watchable local; create/invite/edición/perfil ONLINE (R7.1) con **fast-fail de conexión** (T10): offline devuelven `kind:'network'` ("Necesitás conexión") en vez de colgar la pantalla (`online-guard`). saveProfile/saveOwnPhone/createEstablishment/updateEstablishment/softDeleteEstablishment gateados.
app/src/services/members.ts          → lectura → watchable local; mutaciones admin ONLINE (R7.1) con fast-fail de conexión (T10, en `invokeFn`)
app/src/services/profile.ts          → lectura self → watchable local (user_private); edición ONLINE (R7.1). La pantalla de perfil (`mas.tsx`) offline se VE (lectura local) pero deshabilita editar/guardar + avisa "Sin conexión" (T10)
app/src/services/animals.ts          → exitAnimalProfile → OUTBOX (intención exit_animal_profile + overlay pending_status_overrides effect='exited') → RPC (opción ii)
app/src/services/import-rodeo.ts     → import_rodeo_bulk queda ONLINE (excepción Puerta 1: onboarding masivo, no manga)
```

> **⚠️ RECONCILIADO al as-built (Run T6):**
> - **`exitAnimalProfile` vive en `animals.ts`** (NO en `exit-animal.ts`, que es la lógica PURA de mapeo
>   motivo→status + clasificación de errores, testeable bajo node:test). El swap a outbox se hizo en
>   `animals.ts::exitAnimalProfile`.
> - **`softDeleteRodeo` (rodeos.ts) hacía un UPDATE DIRECTO de `deleted_at`** (`count:'exact'`), NO el RPC
>   `soft_delete_rodeo`. Un UPDATE plano de `deleted_at` por el upload sería RECHAZADO (gotcha
>   RLS-on-RETURNING: la fila sale de la SELECT-policy `deleted_at is null`). El swap lo corrigió al RPC
>   `soft_delete_rodeo` (0041, owner-only) por la outbox, como manda §5.3.1.

> **Regla de capas (architecture.md)**: el swap es 100 % dentro de `services/`. Las firmas públicas (`ServiceResult<T>`/`AppError`) no cambian → hooks/screens no se tocan (salvo el provider). (R11.1)

### 1.3 Factory por plataforma (database.ts)

- `Platform.OS === 'web'` → `@powersync/web` con `WASQLiteOpenFactory` (wa-sqlite, OPFS o IndexedDB). Es el banco de pruebas (D2).
  - **As-built (hotfix Run 1.1 — SUPERSEDED por Run 1.2):** se probó `flags: { useWebWorker: false, enableMultiTabs: false }` para evitar el shared web worker (`new URL(..., import.meta.url)` que Metro/Hermes no resuelve → `Failed to construct 'URL': Invalid base URL` al montar el provider). Eso resolvió el crash del worker pero corrió el DB en el **main thread**, donde el SDK carga wa-sqlite vía `import('@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs')` (bundleado por Metro) cuyo loader Emscripten busca el `.wasm` con `new URL("wa-sqlite-async.wasm", import.meta.url)` → **Metro tampoco resuelve eso** → el `db.init()` (implícito en `connect()`) se **cuelga para siempre ANTES de pedir credenciales** (síntoma Run 1.2: se ve `connecting…` y nunca `fetchCredentials`). El path main-thread NO consume los assets servidos.
  - **As-built (hotfix Run 1.2 — VIGENTE):** la rama web abre el DB con un **`WASQLiteOpenFactory` explícito** (no la forma "settings") apuntando `worker: '/@powersync/worker/WASQLiteDB.umd.js'` (+ `vfs: IDBBatchAtomicVFS`, `flags: { useWebWorker: true, enableMultiTabs: false }`); el `PowerSyncDatabase` lleva además el mismo `flags` a nivel DB (lado sync). El worker UMD apuntado es un **asset de runtime pre-bundleado SERVIDO ESTÁTICAMENTE** desde `app/public/@powersync/` (el dev server de Expo SDK 56 sirve `public/` del root del proyecto Expo —acá `app/`— en la ruta `/`; lo confirma `@expo/cli` `publicFolder.js` + `ServeStaticMiddleware`). El SDK hace `new Worker('/@powersync/worker/WASQLiteDB.umd.js')` (NO un import bundleado por Metro, NO `import.meta.url`), y ESE worker carga su propio wa-sqlite WASM (los `.wasm` copiados a `public/@powersync/`) vía su `publicPath` de webpack (`document.currentScript`), relativo a su ubicación servida. `enableMultiTabs: false` → Worker **dedicado** (no SharedWorker) en el lado DB y `WebStreamingSyncImplementation` **in-process** en el lado SYNC (evita `SharedSyncImplementation.worker.js`, que sí usaría `import.meta.url`). Single-tab es aceptable en el harness web (D2). **La rama native NO se toca**.
    - **Setup web (REPRODUCIBLE):** los assets los copia `powersync-web copy-assets --output public` (CLI del SDK), cableado como prebuild de los scripts web en `app/package.json`: `copy-powersync-assets` (= ese comando) corre antes de `web` (`expo start --web`) y de `e2e:build` (`expo export -p web`, que copia `public/` al `dist/`). Un clone fresco + `pnpm web` regenera los assets → no es un copy manual de una sola vez. Los assets copiados (`public/@powersync/`) están **gitignoreados** (`app/.gitignore`): build-artifact versionado con el SDK, no binarios en el repo. **Metro NO se toca**: el `.wasm` se sirve estático y lo fetchea el worker en runtime; Metro nunca importa un `.wasm` (verificado: el path de lib bundleado solo `import()`ea `.mjs`, y ese path queda bypasseado por el worker servido).
- resto → `@powersync/react-native` con su `OPSqliteOpenFactory` / adapter por defecto.
- El factory devuelve una instancia `PowerSyncDatabase` configurada con `AppSchema`. La lógica de sync (connector, hooks) es agnóstica de plataforma; **solo el factory difiere** (D2 del context).
- El `connect(connector)` se dispara cuando hay sesión Supabase válida (post-login) y se `disconnect()` en logout.

### 1.4 Provider + hooks watchables

- `<PowerSyncProvider>` envuelve la app con el `PowerSyncContext` de `@powersync/react`.
- Las lecturas usan `usePowerSyncWatchedQuery` / `db.watch(sql, params)` dentro de los services (los services exponen funciones que devuelven/actualizan estado; los hooks de `app/src/hooks/` siguen orquestando los services — architecture.md). El service que hoy hace `await supabase.from(...).select(...)` pasa a `await db.getAll(sql)` (one-shot) o expone un `watch` para reactividad (R5.3).

---

## 2. Sync streams (YAML — esto audita Gate 1)

> Fuente de verdad as-built: **`sync-streams/rafaq.yaml` (V3 JOIN-FREE, paso 1, validado en vivo + Gate-1-PASS 2026-06-09)**. **NO se deploya antes de Gate 1 PASS** (regla de cierre). `auth.user_id()` = `sub` del JWT Supabase. El predicado de scoping reusa la MISMA lógica que la RLS as-built (`has_role_in`, `is_owner_of`, `establishment_of_profile`), traducida a SQL inline porque la stream no puede llamar funciones SECURITY DEFINER del schema (corre del lado de PowerSync sobre el WAL).

> **⚠️⚠️ RECONCILIADO 2026-06-09 — el modelo as-built es V3 JOIN-FREE (paso 1). El bloque YAML de §2 de abajo (V2: `with:`/INNER JOIN) quedó SUPERSEDED-POR-RUNTIME. Cierra el drift L-1 del Gate 1.**
>
> El bloque YAML que sigue en §2 (patrón `with:` + `INNER JOIN establishments`/al padre para el `deleted_at` del campo) **siguió fallando en runtime** después de la primera reescritura: **PowerSync evalúa CADA tabla del INNER JOIN como una parameter query INDEPENDIENTE** que enumera toda la tabla, SIN aplicarle el `org_scope`. El `INNER JOIN establishments` enumeró los ~102 campos VIVOS de toda la DB **por stream** → ~1020 → `[PSYNC_S2305]` too many buckets. Log probatorio (instancia): `"Stream est_rodeos evaluating parameter on establishments: 102"`. **Conclusión dura: los JOINs en las data queries son INCOMPATIBLES con el bucket model de PowerSync.**
>
> **El as-built (V3 JOIN-FREE, `sync-streams/rafaq.yaml`)** elimina TODOS los JOINs: cada stream filtra **directo** `WHERE establishment_id IN org_scope AND <tabla>.deleted_at IS NULL`, con `org_scope = SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`. El `deleted_at` del **campo** ya no se resuelve por JOIN: lo garantiza que **`org_scope` ya está limpio** — el trigger + guard de la migración `0076` mantienen el invariante **"rol activo ⇒ campo vivo"** (un `user_roles.active = true` siempre apunta a un `establishments.deleted_at IS NULL`). Así `establishment_id IN org_scope` excluye los campos borrados **sin JOIN**. El bucket count pasa a ser **independiente del volumen de data**.
>
> **Las 17 streams del paso 1 sincronizan hoy en vivo** (verificado: establishments=2, rodeos=3, catálogos, perfiles, etc., bajaron al SQLite local sin PSYNC_S2305). La frontera de autorización del V3 fue auditada tabla-por-tabla y dio **PASS** (`progress/security_spec_15-powersync-v3-joinfree.md`, sección (B) — equivalencia stream↔RLS de las 17 streams). El bloque V2 de abajo se conserva **solo por trazabilidad histórica del cambio** (regla de no-borrar de los SUPERSEDED). **No es la fuente de verdad — lo es `rafaq.yaml` (V3) + §2.2 (AS-BUILT V3) + §2.4 (paso 2).**

> **[SUPERSEDED-POR-RUNTIME — bloque V2, conservado por trazabilidad. El as-built JOIN-FREE NO tiene JOINs; ver `rafaq.yaml` + §2.2.]** REESCRITO 2026-06-08 — patrón `with:`/INNER JOIN (la versión de subquery anidada quedó SUPERSEDED antes, ver §2.1-superseded). El patrón de subselects anidados `... establishment_id IN (SELECT ... WHERE est_id IN (SELECT ... ))` **revienta** con `[PSYNC_S2305] too many buckets (limit of 1000)` (regresión powersync-service **#611**): una stream `auto_subscribe` con `IN (subquery)` **sin** `with:` genera **un bucket por cada FILA de datos** de la subquery. El V2 lo intentó con `with: org_scope` + `INNER JOIN establishments`, pero el JOIN **también** explotó (enumera toda `establishments` por stream — ver el banner V3 de arriba). El as-built V3 elimina los JOINs.

```yaml
config:
  edition: 3

streams:
  # ── GLOBAL read-only (sin filtro, sin `with:`; referencia para todos; 1 bucket global c/u) ──────
  catalog_species:
    auto_subscribe: true
    queries:
      - SELECT * FROM species
  catalog_systems:
    auto_subscribe: true
    queries:
      - SELECT * FROM systems_by_species
  catalog_categories:
    auto_subscribe: true
    queries:
      - SELECT * FROM categories_by_system
  catalog_field_definitions:
    auto_subscribe: true
    queries:
      - SELECT * FROM field_definitions
  catalog_system_default_fields:
    auto_subscribe: true
    queries:
      - SELECT * FROM system_default_fields

  # ── SELF-ONLY (PII + per-user; nunca cruza a un coworker; filtro directo por auth → 1 bucket,
  #    no explota → sin `with:`) ──────────────────────────────────────────────
  self_user_private:                         # ADR-025: email/phone self-only (frontera WAL)
    auto_subscribe: true
    queries:
      # PK as-built = user_id → emitir `id` con alias (PowerSync EXIGE un `id` en cada fila sincronizada
      # — confirmado en T1.3 contra @powersync/common 1.53.2). Reconciliación de la decisión de PK (§PK).
      - SELECT user_id AS id, * FROM user_private WHERE user_id = auth.user_id()
  self_user_roles:                           # membresías del propio usuario
    auto_subscribe: true
    queries:
      - SELECT * FROM user_roles WHERE user_id = auth.user_id()

  # ── PER-ESTABLISHMENT (rol activo) ──────────────────────────────────────────
  #    Patrón: `with: org_scope` (rol activo del user, 1 columna) + data query con INNER JOIN a
  #    establishments para el `deleted_at IS NULL` del campo (campo vivo) + `deleted_at IS NULL` propio.
  #    org_scope NO incluye el JOIN/filtro de campo vivo (se mantiene mínima de 1 tabla, anti-#611);
  #    el predicado canónico de has_role_in queda PRESERVADO repartido entre CTE (rol activo) y data
  #    query (campo vivo). Ver §2.2.
  est_establishments:                        # caso especial: la tabla ES establishments (no JOIN a sí misma)
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT * FROM establishments
        WHERE id IN org_scope
          AND deleted_at IS NULL

  est_members:                               # perfil PÚBLICO de coworkers (users: id,name) + sus roles (owner)
    auto_subscribe: true
    with:
      org_scope:   SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
      owner_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true AND role = 'owner'
    queries:
      # (1) nombres de coworkers: NO se gatea a owner — todos los miembros ven los nombres del campo.
      #     INNER JOIN user_roles (coworker activo en un campo del user) + INNER JOIN establishments
      #     (campo vivo). Todas las columnas seleccionadas son de `users` (regla "una tabla por query").
      - >
        SELECT users.* FROM users
        INNER JOIN user_roles ON user_roles.user_id = users.id
        INNER JOIN establishments ON establishments.id = user_roles.establishment_id
        WHERE user_roles.active = true
          AND user_roles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND users.deleted_at IS NULL
      # (2) matriz de roles de coworkers: GATEADA A OWNER (owner_scope) + active = true, para espejar
      #     user_roles_select (0008:11-17), owner-only para roles ajenos (is_owner_of). INNER JOIN
      #     establishments para el deleted_at del campo (owner_scope puede tener campos muertos).
      #     El propio rol del usuario NO llega por acá: viene por self_user_roles.
      - >
        SELECT user_roles.* FROM user_roles
        INNER JOIN establishments ON establishments.id = user_roles.establishment_id
        WHERE user_roles.active = true
          AND user_roles.establishment_id IN owner_scope
          AND establishments.deleted_at IS NULL
    # ⚠️ users NO trae email/phone: esas columnas YA NO existen en public.users (0068 las dropeó a
    #    user_private). Por eso est_members puede traer la fila users COMPLETA sin filtrar PII (ADR-025).
    # ⚠️ MED-1 (Gate 1, 2026-06-08): la query (2) se ENDURECIÓ a owner-gated (+ active = true) para
    #    ESPEJAR la RLS user_roles_select (owner-only para roles ajenos). La query (1) de nombres NO se
    #    gatea (todos los miembros ven los nombres; su propio rol llega por self_user_roles). Si Raf
    #    quiere que un field_operator vea la matriz de roles del campo offline, hay que cambiar JUNTAS
    #    la RLS user_roles_select Y esta stream (no solo la stream — rompería la equivalencia).

  est_invitations:                           # solo pendientes, solo donde el user es OWNER (R4.9, D1)
    auto_subscribe: true
    with:
      owner_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true AND role = 'owner'
    queries:
      - >
        SELECT invitations.* FROM invitations
        INNER JOIN establishments ON establishments.id = invitations.establishment_id
        WHERE invitations.status = 'pending'
          AND invitations.deleted_at IS NULL
          AND invitations.establishment_id IN owner_scope
          AND establishments.deleted_at IS NULL

  est_rodeos:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT rodeos.* FROM rodeos
        INNER JOIN establishments ON establishments.id = rodeos.establishment_id
        WHERE rodeos.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND rodeos.deleted_at IS NULL

  est_rodeo_data_config:                     # PK compuesta; deriva el est del rodeo
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      # PK as-built compuesta (rodeo_id, field_definition_id) → emitir un `id` sintético determinístico
      # (PowerSync exige `id`; T1.3). Todas las columnas son de rodeo_data_config (el `id` sintético es
      # expresión derivada de SUS columnas). INNER JOIN rodeos→establishments para tenant + campo vivo.
      # rodeo_data_config NO tiene deleted_at propio (el toggle vive en `enabled`; 0018).
      - >
        SELECT (rodeo_data_config.rodeo_id || ':' || rodeo_data_config.field_definition_id) AS id, rodeo_data_config.*
        FROM rodeo_data_config
        INNER JOIN rodeos ON rodeos.id = rodeo_data_config.rodeo_id
        INNER JOIN establishments ON establishments.id = rodeos.establishment_id
        WHERE rodeos.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND rodeos.deleted_at IS NULL

  est_management_groups:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT management_groups.* FROM management_groups
        INNER JOIN establishments ON establishments.id = management_groups.establishment_id
        WHERE management_groups.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND management_groups.deleted_at IS NULL

  est_animal_profiles:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT animal_profiles.* FROM animal_profiles
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL

  est_animals:                               # global (sin establishment_id): vía existencia de perfil
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      # animals es global (ADR-004, sin establishment_id) → deriva vía la existencia de un perfil del
      # animal en un campo del user. FK as-built: animal_profiles.animal_id → animals.id (0020:14).
      - >
        SELECT animals.* FROM animals
        INNER JOIN animal_profiles ON animal_profiles.animal_id = animals.id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
          AND animals.deleted_at IS NULL

  est_animal_category_history:               # sin establishment_id: deriva del perfil (sin deleted_at propio)
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT animal_category_history.* FROM animal_category_history
        INNER JOIN animal_profiles ON animal_profiles.id = animal_category_history.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL

  est_sessions:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT sessions.* FROM sessions
        INNER JOIN establishments ON establishments.id = sessions.establishment_id
        WHERE sessions.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND sessions.deleted_at IS NULL

  est_maneuver_presets:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT maneuver_presets.* FROM maneuver_presets
        INNER JOIN establishments ON establishments.id = maneuver_presets.establishment_id
        WHERE maneuver_presets.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND maneuver_presets.deleted_at IS NULL

  est_semen_registry:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT semen_registry.* FROM semen_registry
        INNER JOIN establishments ON establishments.id = semen_registry.establishment_id
        WHERE semen_registry.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND semen_registry.deleted_at IS NULL

  # ── EVENTOS (sin establishment_id propio: derivan del animal_profile) ────────
  #    Patrón repetido por las 5 tablas tipadas. INNER JOIN animal_profiles (dueño del evento) +
  #    INNER JOIN establishments (campo vivo). Filtran deleted_at IS NULL propio + del perfil + del campo.
  ev_weight_events:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT weight_events.* FROM weight_events
        INNER JOIN animal_profiles ON animal_profiles.id = weight_events.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
          AND weight_events.deleted_at IS NULL
  ev_reproductive_events:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT reproductive_events.* FROM reproductive_events
        INNER JOIN animal_profiles ON animal_profiles.id = reproductive_events.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
          AND reproductive_events.deleted_at IS NULL
  ev_sanitary_events:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT sanitary_events.* FROM sanitary_events
        INNER JOIN animal_profiles ON animal_profiles.id = sanitary_events.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
          AND sanitary_events.deleted_at IS NULL
  ev_condition_score_events:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT condition_score_events.* FROM condition_score_events
        INNER JOIN animal_profiles ON animal_profiles.id = condition_score_events.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
          AND condition_score_events.deleted_at IS NULL
  ev_lab_samples:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT lab_samples.* FROM lab_samples
        INNER JOIN animal_profiles ON animal_profiles.id = lab_samples.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
          AND lab_samples.deleted_at IS NULL
  ev_animal_events:                          # tiene establishment_id propio (0034) → JOIN directo a establishments
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - >
        SELECT animal_events.* FROM animal_events
        INNER JOIN establishments ON establishments.id = animal_events.establishment_id
        WHERE animal_events.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND animal_events.deleted_at IS NULL

  # birth_calves: PK compuesta, sin establishment_id. Deriva del evento de parto (madre).
  #               Espeja birth_calves_select (filtra reproductive_events.deleted_at IS NULL).
  ev_birth_calves:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      # PK as-built compuesta → emitir un `id` sintético determinístico (PowerSync exige `id`; T1.3).
      # 3 INNER JOINs: birth_calves → reproductive_events (parto) → animal_profiles (madre) → establishments.
      # ⚠️ 3 JOINs: FLAGGEADO como incertidumbre de sintaxis (§2.2-incertidumbres) — fallback en §2.2 si
      # el validador del dashboard rechaza 3 INNER JOINs (CTE `mother_births`).
      - >
        SELECT (birth_calves.birth_event_id || ':' || birth_calves.calf_profile_id) AS id, birth_calves.*
        FROM birth_calves
        INNER JOIN reproductive_events ON reproductive_events.id = birth_calves.birth_event_id
        INNER JOIN animal_profiles ON animal_profiles.id = reproductive_events.animal_profile_id
        INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id
        WHERE animal_profiles.establishment_id IN org_scope
          AND establishments.deleted_at IS NULL
          AND reproductive_events.deleted_at IS NULL
          AND animal_profiles.deleted_at IS NULL
```

### 2.1-superseded — Patrón viejo (subquery anidada) — SUPERSEDED 2026-06-08

> El YAML anterior a 2026-06-08 scopeaba cada stream per-establishment con el **predicado canónico inline como subquery anidada**, p.ej.:
> ```yaml
> # SUPERSEDED — NO USAR (revienta el límite de 1000 buckets, regresión #611)
> ev_weight_events:
>   auto_subscribe: true
>   queries:
>     - >
>       SELECT * FROM weight_events
>       WHERE deleted_at IS NULL
>         AND animal_profile_id IN (
>           SELECT id FROM animal_profiles
>           WHERE deleted_at IS NULL
>             AND establishment_id IN (SELECT ur.establishment_id FROM user_roles ur
>                                      JOIN establishments e ON e.id = ur.establishment_id
>                                      WHERE ur.user_id = auth.user_id() AND ur.active = true
>                                        AND e.deleted_at IS NULL))
> ```
> **Por qué se reemplazó (2026-06-08)**: al deployar las 26 streams y conectar un cliente real, el server cerró el stream con `[PSYNC_S2305] too many parameter query results / too many buckets (limit of 1000)`. Diagnóstico autoritativo (logs de la instancia): por la **regresión powersync-service #611**, una stream `auto_subscribe` con `IN (subquery)` **sin** un bloque `with:` crea **un bucket por cada fila de datos** que devuelve la subquery (no por valor único del filtro). Con ~22 streams per-establishment × ~100 establecimientos (la beta está contaminada con data de test: 106 establecimientos, 957 `animal_profiles`) → ~2200 buckets → supera el tope de 1000 → 0 bytes sincronizados, loop de reconexión. Gate 1 había validado la **autorización** (correcta) pero el patrón de sintaxis (sin `with:`) revienta el límite operativo de buckets.
>
> **Lo que NO cambió**: la frontera de autorización (mismo set de filas por stream, tabla por tabla; §2.3-equivalencia). Gate 1 sobre las streams **NO re-falla por autorización** — el cambio es estructural. Lo que se re-verifica en el re-Gate 1 es que la equivalencia se preservó (que el patrón `with:`/JOIN no agrandó ni achicó el set respecto del SUPERSEDED).
>
> **(La contaminación de la beta — 106 establecimientos de test — es un problema aparte de limpieza de datos; NO se resuelve en esta spec. Aun limpia la beta, el patrón viejo escala mal: el fix `with:`/JOIN es lo correcto independientemente.)**

### 2.2 Estrategia de bucketing (anti-#611)

> **⚠️ AS-BUILT V3 JOIN-FREE (2026-06-09) — esto es la fuente de verdad; el resto de §2.2 abajo describe el V2 `with:`/JOIN SUPERSEDED-por-runtime (conservado por trazabilidad).**
>
> El bucket de PowerSync = **un bucket por valor único del parámetro de la stream**. En V3 el parámetro es `org_scope` (`SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`) — una CTE de **una tabla, una columna**, que devuelve los `establishment_id` de los campos del user (conjunto **chico**) → **1 bucket por campo del user, por stream**.
>
> **Lo decisivo: V3 NO tiene NINGÚN JOIN en las data queries.** Cada stream es `SELECT ... WHERE establishment_id IN org_scope AND <tabla>.deleted_at IS NULL`. El `deleted_at` del **campo** (campo vivo) ya no se filtra por `INNER JOIN establishments` (eso reventaba: PowerSync enumera toda `establishments` por stream) — lo garantiza que **`org_scope` ya está limpio** por el invariante de `0076` (rol activo ⇒ campo vivo). El `deleted_at` **propio** de la tabla (fila soft-deleteada) sí se filtra en la stream.
>
> **Bucket math V3 (paso 1, as-built):** 17 streams = 5 globales (1 bucket global c/u) + 2 self-only (1 c/u) + 10 per-establishment (`org_scope`/`owner_scope`, ~1 bucket por campo vivo del user). Para un user de **2 campos vivos**: `5 + 2 + (10 × 2) = 27` buckets. Para Raf (peor caso 5 roles, real 2 tras el backfill de `0076`): `5 + 2 + (10 × 2..5) = 27..57`. **Muy por debajo de 1000.** El validador del dashboard + un connect de prueba son la verdad operativa (T2.3) — ya confirmado en vivo sin PSYNC_S2305.
>
> El total **paso 1 + paso 2** (con las streams nuevas de §2.4) se calcula en **§2.4 — bucket math**; sigue `<< 1000`.

---

**[SUPERSEDED-por-runtime — V2 `with:`/JOIN. El as-built V3 de arriba NO tiene JOINs.]**

**El bucket de PowerSync = unidad de sincronización con cache key.** El server crea **un bucket por cada valor único del parámetro de la stream**. Con el patrón `with:`, el parámetro es el **scope del user** (`org_scope`/`owner_scope`), que devuelve los `establishment_id` donde el user tiene rol — un conjunto **chico** (1–N campos del user). Resultado: **1 bucket por establishment del user**, por stream.

- **`org_scope` / `owner_scope` son CTEs de UNA tabla, UNA columna** (`SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true [AND role = 'owner']`). Devuelven los ids de los campos del user → el parámetro de bucketing es chico. **NO** llevan JOIN ni subquery adentro (eso reintroduciría el conteo de filas de #611) → la CTE se mantiene mínima.
- **El `establishments.deleted_at IS NULL` (campo vivo) NO va en la CTE: va en la DATA QUERY**, vía `INNER JOIN establishments`. Razón histórica: `org_scope` podía incluir un campo soft-deleteado (un user podía conservar un `user_role` activo apuntando a un campo borrado — **no había trigger** que desactivara `user_roles` al soft-deletear un campo; era el escenario del fix Gate 1 **HIGH-1**). El JOIN a `establishments` con `deleted_at IS NULL` en cada data query saca esas filas del sync set. Así el **predicado canónico de `has_role_in`** (`0005:16-24` — `JOIN establishments e ... AND e.deleted_at IS NULL`) queda **PRESERVADO**, solo que repartido: la parte "rol activo" en la CTE, la parte "campo vivo" en el data query. La frontera de autorización es idéntica.

  > **AS-BUILT (Run 4, migración `0076`)**: AHORA SÍ hay un trigger — `establishment_soft_delete_deactivates_roles` (`0076_deactivate_roles_on_establishment_soft_delete.sql`) desactiva (`active = false`) los `user_roles` de un campo al soft-deletearlo, + un backfill que limpió los roles ya-activos de campos ya-borrados. Por eso `org_scope` (que filtra `active = true`) deja de incluir campos soft-deleteados → ya no es estrictamente necesario el `INNER JOIN establishments ... deleted_at IS NULL` en las data queries para CORRECTITUD. **Se MANTIENE igual** como defensa-en-profundidad (es inofensivo, y cierra cualquier ventana de carrera entre el soft-delete y la propagación por WAL). El predicado canónico de `has_role_in` sigue preservado; el trigger sólo hace que `active` sea un proxy FIEL de "campo vivo", que es lo que el modelo JOIN-free necesita. El trigger es ADITIVO y NO cambia comportamiento observable de la app/RLS (`has_role_in`/`is_owner_of`/membership ya filtraban `deleted_at`).
- **Tablas hijas → INNER JOIN al padre, NO subquery anidada (clave anti-#611).** Referenciar `org_scope` **directo** (`WHERE col IN org_scope`) NO cuenta filas extra. Pero referenciar `org_scope` **anidado dentro de otra subquery** (`WHERE x IN (SELECT id FROM animal_profiles WHERE est_id IN org_scope)`) **cuenta las filas de la subquery interna** (los `animal_profiles`) como parameter results → vuelve a explotar. Por eso `weight_events`/`reproductive_events`/etc. se anclan a `animal_profiles` (y este a `establishments`) por **INNER JOIN**, no por subquery anidada con la CTE adentro. El `establishment_id IN org_scope` se aplica sobre la columna del padre **ya unida por JOIN**.

**Matemática de buckets — caso de Raf (5 roles activos, de los cuales 2 campos vivos):**
- `org_scope` devuelve los establishment_ids de los roles activos del user. Para Raf: **5** roles activos (de los cuales 2 son campos vivos; los 3 soft-deleteados se filtran en el data query por el JOIN a `establishments`, pero el bucketing se cuenta sobre los valores del parámetro de la CTE → se cuenta el peor caso de **5**).
  > **AS-BUILT (Run 4, migración `0076`)**: con el trigger + backfill de `0076`, los 3 roles espurios de Raf (apuntando a campos soft-deleteados) quedan `active = false` → **salen de `org_scope`** → el bucketing baja del peor caso 5 al caso real **2** (campos vivos) por stream per-establishment. Mejora directa a la cota de buckets de abajo (más holgura frente al tope de 1000). La cuenta exacta sigue siendo la verdad del validador/connect (nota de abajo).
- Streams per-establishment que usan `org_scope`/`owner_scope`: **22** (todas las `est_*` y `ev_*` salvo las 5 globales y las 2 self-only; `est_members` usa 2 CTEs pero sigue siendo 1 stream).
- **Buckets por stream per-establishment ≈ N_campos_del_user** (1 bucket por campo): para Raf ≤ 5 (roles activos) por stream → realista 2 (campos vivos).
- **Total ≈ 22 streams × ~2–5 campos + 5 globales (1 c/u) + 2 self-only (1 c/u) ≈ 44–110 + 7 ≈ 51–117 buckets.** Muy por debajo del tope de **1000**.
- Contraste con el patrón SUPERSEDED: ahí el bucketing se contaba por **fila de datos** de la subquery (≈ `animal_profiles` totales, ~957 en la beta contaminada) → miles de buckets → explota. El `with:`/JOIN baja la cuenta a **órdenes de magnitud menos** (por campo del user, no por fila).

> Nota sobre el bucketing exacto: el número preciso de buckets lo determina el motor de PowerSync (cómo materializa el parámetro de la CTE). La cota de arriba (≈ por campo del user) es la de diseño esperada con el patrón `with:` correcto. **El validador del dashboard + un connect de prueba contra la instancia (con la beta idealmente limpia de la data de test) es la verdad operativa** — Raf lo confirma en el re-Gate 1 / deploy (T2.3).

#### 2.2-incertidumbres — sintaxis a validar en el dashboard (el validador de PowerSync es la verdad)

La doc de Sync Streams ed.3 (`docs.powersync.com/sync/streams/{overview,ctes}`, issue #611) respalda el patrón, pero la sintaxis fina la confirma el **validador del dashboard** al pegar el YAML. Incertidumbres flaggeadas, con la mejor apuesta + alternativa si el validador la rechaza:

1. **`with:` = mapa `nombre: <query única>` vs lista.** Apuesta: **mapa** (`org_scope: SELECT ...`), una sola query SELECT por CTE, varias CTEs independientes en el mismo `with:` (`est_members` tiene `org_scope` + `owner_scope`). Si el validador exige lista/otra forma: ajustar a lo que indique el error (la doc de `/sync/streams/ctes` es la fuente).
2. **`queries:` (lista) vs `query:` (singular).** Apuesta: **`queries:` (lista)** a nivel stream (necesario para `est_members`, que tiene 2 data queries). Si una stream de 1 query exige `query:` singular, usar esa forma para las de 1 query y `queries:` solo donde hay varias.
3. **`SELECT (expr) AS id, t.*` con `id` sintético (expresión derivada) cumple "todas las columnas de una tabla".** Aplica a `est_rodeo_data_config` y `ev_birth_calves`. Apuesta: **sí** (la expresión deriva de columnas de la propia tabla `t`; el resto es `t.*`). Si el validador se queja de la expresión + `t.*` juntos en un data query con JOIN: alternativa = emitir el `id` sintético en `AppSchema`/cliente y dejar la stream con `SELECT t.*`, o materializar la PK compuesta como columna. **FLAGGEADO** (la incertidumbre con más chance de rechazo).
4. **2–3 INNER JOINs en un mismo data query.** `est_rodeo_data_config` y los eventos tienen 2 JOINs; `ev_birth_calves` tiene **3**. Apuesta: **permitido** (la doc soporta INNER JOIN; no documenta un límite de cantidad). Si el validador rechaza 3 JOINs en `ev_birth_calves`: **fallback** = mover el primer salto a una CTE de scope intermedia `mother_births: SELECT reproductive_events.id FROM reproductive_events INNER JOIN animal_profiles ON animal_profiles.id = reproductive_events.animal_profile_id INNER JOIN establishments ON establishments.id = animal_profiles.establishment_id WHERE animal_profiles.establishment_id IN (SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true) AND establishments.deleted_at IS NULL AND animal_profiles.deleted_at IS NULL AND reproductive_events.deleted_at IS NULL` y luego `SELECT (...) AS id, birth_calves.* FROM birth_calves WHERE birth_event_id IN mother_births`. ⚠️ Una CTE NO puede referenciar a otra → `mother_births` NO puede usar `org_scope`: hay que **inlinear** el scope como subquery directa sobre `user_roles` (tabla chica → pocos ids → NO dispara #611: #611 explota por las filas de la tabla GRANDE de datos, no por `user_roles`). **FLAGGEADO** (la forma exacta la decide el validador).
5. **Short-hand `IN org_scope` (CTE de 1 columna) vs subquery explícita `IN (SELECT establishment_id FROM org_scope)`.** Apuesta: **short-hand** `IN org_scope` (la doc lo permite para CTEs de 1 columna; todas las nuestras lo son). Si el validador no acepta el short-hand: cambiar cada `IN org_scope` → `IN (SELECT establishment_id FROM org_scope)` (equivalente, más verboso). Cambio mecánico, sin efecto en autorización.

> Para cada incertidumbre: la **apuesta** es lo escrito en el YAML; la **alternativa** es el fallback si el validador la rechaza. Ninguna alternativa cambia la frontera de autorización (son re-expresiones del mismo set). El implementer/Raf ajusta la sintaxis fina contra el validador en el re-Gate 1 / deploy (T2.2/T2.3); el spec_author fija el patrón y el set autorizado.

### 2.3-equivalencia — frontera de autorización: viejo (SUPERSEDED) → nuevo (`with:`/JOIN), tabla por tabla

> **Invariante**: cada stream sincroniza EXACTAMENTE el mismo set de filas que el SUPERSEDED. Solo cambió la estructura del SQL (el bucketing). Re-Gate 1 verifica esto.

| Stream | Set autorizado (idéntico viejo y nuevo) | Viejo (SUPERSEDED) | Nuevo (`with:`/JOIN) |
|---|---|---|---|
| `catalog_*` (5) | todos los autenticados, sin filtro | `SELECT * FROM <t>` | idéntico (sin cambio) |
| `self_user_private` | self (`user_id = auth.user_id()`) | filtro directo | idéntico (sin cambio) |
| `self_user_roles` | self (`user_id = auth.user_id()`) | filtro directo | idéntico (sin cambio) |
| `est_establishments` | campos del user con rol activo Y vivos | `deleted_at IS NULL AND id IN (canónico)` | `id IN org_scope AND deleted_at IS NULL` |
| `est_members` (1) users | nombres de coworkers activos en campos vivos del user | `id IN (ur.user_id WHERE ur.active AND ur.est IN (me canónico))` | `INNER JOIN user_roles (active) INNER JOIN establishments (vivo) WHERE est IN org_scope` |
| `est_members` (2) user_roles | roles de coworkers en campos vivos donde el user es **owner** | `active AND est IN (me canónico AND me.role='owner')` | `active AND est IN owner_scope INNER JOIN establishments (vivo)` |
| `est_invitations` | invitaciones pending/no-borradas de campos vivos donde el user es owner | `status='pending' AND deleted_at IS NULL AND est IN (canónico owner)` | `status='pending' AND deleted_at IS NULL AND est IN owner_scope INNER JOIN establishments (vivo)` |
| `est_rodeos` | rodeos vivos de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND rodeos.deleted_at IS NULL` |
| `est_rodeo_data_config` | config de rodeos vivos de campos vivos del user | `rodeo_id IN (rodeos vivos WHERE est IN canónico)` | `INNER JOIN rodeos (vivo) INNER JOIN establishments (vivo) WHERE est IN org_scope` |
| `est_management_groups` | lotes vivos de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND deleted_at IS NULL` |
| `est_animal_profiles` | perfiles vivos de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND deleted_at IS NULL` |
| `est_animals` | animals con ≥1 perfil vivo en campo vivo del user | `id IN (animal_id de perfiles vivos WHERE est IN canónico)` | `INNER JOIN animal_profiles (vivo) INNER JOIN establishments (vivo) WHERE est IN org_scope AND animals.deleted_at IS NULL` |
| `est_animal_category_history` | historial de categoría de perfiles vivos de campos vivos | `animal_profile_id IN (perfiles vivos WHERE est IN canónico)` | `INNER JOIN animal_profiles (vivo) INNER JOIN establishments (vivo) WHERE est IN org_scope` |
| `est_sessions` | sesiones vivas de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND deleted_at IS NULL` |
| `est_maneuver_presets` | presets vivos de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND deleted_at IS NULL` |
| `est_semen_registry` | semen vivo de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND deleted_at IS NULL` |
| `ev_weight_events` … `ev_lab_samples` (5) | eventos vivos de perfiles vivos de campos vivos | `deleted_at IS NULL AND animal_profile_id IN (perfiles vivos WHERE est IN canónico)` | `INNER JOIN animal_profiles (vivo) INNER JOIN establishments (vivo) WHERE est IN org_scope AND <evento>.deleted_at IS NULL` |
| `ev_animal_events` | observaciones vivas de campos vivos del user | `deleted_at IS NULL AND est IN (canónico)` | `est IN org_scope INNER JOIN establishments (vivo) AND deleted_at IS NULL` |
| `ev_birth_calves` | terneros de partos vivos de perfiles (madre) vivos de campos vivos | `birth_event_id IN (re vivos JOIN ap vivos WHERE est IN canónico)` | 3× INNER JOIN (birth_calves→re vivo→ap vivo→establishments vivo) WHERE est IN org_scope |

**Sutileza del JOIN (over-emisión de filas duplicadas, NO over-autorización):** el patrón `INNER JOIN` puede emitir la **misma fila base más de una vez** cuando el padre matchea por varios caminos (p.ej. un coworker con rol en 2 de los campos del user aparece 2× en `est_members` query 1; un animal con 2 perfiles vivos del user aparece 2× en `est_animals`). PowerSync **dedupea por `id` por bucket** al materializar el sync set, así que el set final de `id`s es idéntico al del SUPERSEDED (que usaba `IN (...)`, naturalmente dedupeado). No es un leak (no agrega filas de OTRO tenant; solo repite filas YA autorizadas). **FLAGGEADO** como verificación operativa (que la dedup por `id` del SDK lo absorba); si en el validador/runtime apareciera una fila duplicada, no cambia la autorización pero conviene confirmarlo. La alternativa (si molesta) sería el short-hand sobre subquery dedupeada, pero reintroduce el riesgo #611 → se prefiere el JOIN + dedup por `id` del SDK.

### 2.4 Paso 2 — denormalización de `establishment_id` (tablas hijas + entidades compartidas) — DISEÑO, gateado

> **Fuente de verdad del patrón: ADR-026.** El paso 1 (V3 JOIN-FREE, `rafaq.yaml`) sincroniza las 17 tablas con `establishment_id` propio. El paso 2 suma las tablas que el paso 1 DIFIRIÓ porque **NO tienen `establishment_id` propio** (derivan de un padre) y las entidades **compartidas** (`animals` global, nombres de `users`). La solución es **denormalizar `establishment_id`** sobre ellas (+ trigger-force + backfill) y agregarles **streams JOIN-free idénticas al paso 1** → cero riesgo de runtime nuevo (no se reintroduce ningún JOIN). **El spec_author NO escribe migraciones ni el YAML del paso 2** — los escribe el implementer tras Gate 1 + aprobación de las decisiones (B)/(C). Acá va el DISEÑO.

#### (A) Tablas hijas — denormalización MECÁNICA (sin decisión de fondo; patrón claro)

Para cada tabla: una migración nueva (≥ `0077`, la escribe el implementer) con el orden:

1. `ALTER TABLE <t> ADD COLUMN establishment_id uuid REFERENCES public.establishments(id) ON DELETE CASCADE;` — **nullable al principio** (para poder backfillear).
2. **Backfill** desde el padre: `UPDATE <t> SET establishment_id = <derivado del padre> WHERE establishment_id IS NULL;` (cadenas abajo). Idempotente (solo toca filas con la columna NULL).
3. **Trigger `BEFORE INSERT` (y `BEFORE UPDATE` si el padre puede cambiar) que FUERZA `establishment_id` desde el padre**, ignorando cualquier valor del cliente (patrón anti-spoof, espejo de `tg_force_created_by_auth_uid`, `0043`, y de `tg_animal_events_validate_est`, `0034`). **CRÍTICO para seguridad**: el scoping del stream depende de que esta columna sea FIEL al padre — si el cliente pudiera setearla a un campo ajeno, replicaría datos cross-tenant por el WAL.
4. *(opcional, al final)* `ALTER TABLE <t> ALTER COLUMN establishment_id SET NOT NULL;` una vez backfilleadas todas las filas y con el trigger garantizando el INSERT. Recomendado (la columna es load-bearing para el stream; un NULL la sacaría del sync set silenciosamente).

> **⚠️ RECONCILIADO al as-built (Run 5, migraciones `0077`/`0078`).** La columna "`BEFORE UPDATE`?" decía "NO" para las 5 tablas de evento (razonamiento: `animal_profile_id` es inmutable). **El as-built fuerza `establishment_id` en INSERT *Y* UPDATE** para las 5 tablas de evento (`0077`): aunque `animal_profile_id` no cambia, esas tablas tienen `GRANT UPDATE` a `authenticated` y la policy de UPDATE deriva el tenant del PERFIL (no de la columna denormalizada), así que sin un force en UPDATE un caller con UPDATE permission podría pisar `establishment_id` con un campo ajeno por PostgREST directo → la columna quedaría infiel → leak por el WAL al stream del campo ajeno. El force en UPDATE re-deriva siempre el valor del perfil real (inmutable) → cierra el vector, cero impacto en flujos legítimos. Es el mismo criterio que `animal_events` (`0034`), que marca su `establishment_id` denormalizado como columna INMUTABLE en UPDATE. La columna de la tabla de abajo refleja el as-built.

| Tabla | Columna nueva | Derivación del padre (verificada contra as-built) | `BEFORE UPDATE`? | Stream JOIN-free nueva |
|---|---|---|---|---|
| `weight_events` | `establishment_id` | `(SELECT establishment_id FROM animal_profiles WHERE id = NEW.animal_profile_id)` | **SÍ** — anti-spoof por UPDATE (tiene `GRANT UPDATE`; force re-deriva del perfil) | `ev_weight_events: SELECT * FROM weight_events WHERE establishment_id IN org_scope AND deleted_at IS NULL` |
| `reproductive_events` | `establishment_id` | idem `animal_profiles` del evento (`0026`) | **SÍ** — anti-spoof por UPDATE | `ev_reproductive_events: ... WHERE establishment_id IN org_scope AND deleted_at IS NULL` |
| `sanitary_events` | `establishment_id` | idem `animal_profiles` (`0027`) | **SÍ** — anti-spoof por UPDATE | `ev_sanitary_events: ... WHERE establishment_id IN org_scope AND deleted_at IS NULL` |
| `condition_score_events` | `establishment_id` | idem `animal_profiles` (`0028`) | **SÍ** — anti-spoof por UPDATE | `ev_condition_score_events: ... WHERE establishment_id IN org_scope AND deleted_at IS NULL` |
| `lab_samples` | `establishment_id` | idem `animal_profiles` (`0029`) | **SÍ** — anti-spoof por UPDATE | `ev_lab_samples: ... WHERE establishment_id IN org_scope AND deleted_at IS NULL` |
| `animal_category_history` | `establishment_id` | idem `animal_profiles` (`0030`). **Sin `deleted_at` propio** (es append-only de auditoría) | **SÍ** (uniforme; no-op en la práctica — la tabla NO tiene `GRANT UPDATE`/`INSERT` al cliente, se puebla solo vía trigger SECURITY DEFINER) | `est_animal_category_history: SELECT * FROM animal_category_history WHERE establishment_id IN org_scope` |
| `birth_calves` | `establishment_id` | `(SELECT ap.establishment_id FROM reproductive_events re JOIN animal_profiles ap ON ap.id = re.animal_profile_id WHERE re.id = NEW.birth_event_id)` (parto → madre, `0045`). **PK compuesta + `id` sintético** (ver §PK) | NO — server-only (sin `GRANT UPDATE`/`INSERT` al cliente, `0045`); el force en INSERT basta (no hay vector de UPDATE de cliente) | `ev_birth_calves: SELECT (birth_event_id \|\| ':' \|\| calf_profile_id) AS id, * FROM birth_calves WHERE establishment_id IN org_scope` |
| `rodeo_data_config` | `establishment_id` | `(SELECT establishment_id FROM rodeos WHERE id = NEW.rodeo_id)` (`0018`). **PK compuesta + `id` sintético** (§PK). Sin `deleted_at` (el toggle vive en `enabled`) | **SÍ** — `rodeo_id` no cambia, pero el toggle es un UPDATE; el trigger `BEFORE INSERT OR UPDATE` mantiene la columna fiel aunque un UPDATE malicioso intentara pisarla | `est_rodeo_data_config: SELECT (rodeo_id \|\| ':' \|\| field_definition_id) AS id, * FROM rodeo_data_config WHERE establishment_id IN org_scope` |

**Notas del patrón (A):**
- **El trigger se puebla DESDE el padre, no del payload.** Cuerpo tipo (especificación, no la migración): `NEW.establishment_id := (SELECT ... derivación ...); RETURN NEW;`. Si el padre no existe (`NULL`), el INSERT ya falla por la FK del `animal_profile_id`/`rodeo_id`/`birth_event_id` as-built (no hay que duplicar esa validación, pero el trigger puede raise si querés un error explícito).
- **`birth_calves`/`rodeo_data_config` siguen siendo read-only locales** (se pueblan server-side / toggle admin online). El `id` sintético (`(a || ':' || b)`) y la nueva columna `establishment_id` conviven: la stream emite `SELECT (expr) AS id, *` (que incluye `establishment_id`). El cliente NO escribe estas tablas localmente (§PK). Misma sintaxis ya resuelta en T1.3 del paso 1.
- **RLS as-built NO cambia (R11.3).** Las policies de SELECT de estas tablas (`has_role_in(establishment_of_profile(animal_profile_id))`, etc.) siguen derivando el tenant por FK — la columna nueva es **solo para el stream**. El trigger-force mantiene la columna fiel; **Gate 1 lo verifica** sobre cada delta (que el trigger fuerza desde el padre, que el backfill es correcto, que la stream es equivalente a la RLS de la tabla).
- **Cada migración de (A) es schema-sensitive (R11.4)** → Gate 1 (spec) ANTES de aplicar por Management API + Gate 2 + reviewer. Son ≥3 migraciones (se pueden agrupar por familia: las 5 eventos + `animal_category_history` comparten la derivación `animal_profile_id → animal_profiles.establishment_id`; `birth_calves` y `rodeo_data_config` van aparte por su derivación distinta).

#### (B) `animals` — denormalizar identidad sobre `animal_profiles` (b1) — **DECISIÓN PARA RAF (ADR-026)**

`animals` es **global** (ADR-004): un animal con perfiles en >1 campo no tiene un único `establishment_id`. Recomendación **(b1)**: **denormalizar la identidad sobre `animal_profiles`** (que ya tiene `establishment_id` → ya sincroniza) y **NO sincronizar `animals`**.

- **Campos a denormalizar** (los que la UI lee de `animals` — verificado en `app/src/services/animals.ts`): `tag_electronic` (EID), `sex`, `birth_date`. Columnas nuevas en `animal_profiles`: `animal_tag_electronic text`, `animal_sex text`, `animal_birth_date date`. *(Nota: `breed`/`coat_color` NO son de `animals` — ya viven en `animal_profiles`; no se denormalizan.)*
- **Trigger** sobre `animal_profiles` `BEFORE INSERT OR UPDATE OF (las 3 columnas)`: **fuerza** las 3 columnas desde `(SELECT tag_electronic, sex, birth_date FROM animals WHERE id = NEW.animal_id)`. Anti-spoof (ignora el payload). *(RECONCILIADO Run 5, `0079`: el force también en UPDATE de las 3 columnas — `animal_profiles` tiene `GRANT UPDATE`, así que sin el force en UPDATE un caller podría pisar la identidad denormalizada con un valor falso por PostgREST directo, dejándola infiel; el force re-deriva desde `animals` el MISMO valor, sin impacto en flujos legítimos.)*
- **Trigger de propagación** sobre `animals` `AFTER UPDATE OF tag_electronic, sex, birth_date`: `UPDATE animal_profiles SET animal_tag_electronic = NEW.tag_electronic, animal_sex = NEW.sex, animal_birth_date = NEW.birth_date WHERE animal_id = NEW.id;` (re-tag es raro — verificado: ningún code-path del cliente UPDATEa `animals` hoy; solo INSERT en `createAnimal`/`import_rodeo` — pero el trigger lo cubre por correctitud).
- **Backfill** de los perfiles existentes desde su `animals`.
- **Stream**: NO se agrega `est_animals`. La identidad llega dentro de `est_animal_profiles` (que ya sincroniza). **Se elimina del backlog del paso 2 la stream `est_animals`** (la del bloque V2 SUPERSEDED quedó descartada — era el patrón b2 con JOIN que reventaba).
- **Swap de lectura T4 (futuro)**: `animals.ts` (`fetchAnimals`/`searchAnimals`/`fetchAnimalDetail`) lee la identidad desde las columnas denormalizadas de `animal_profiles`, **no** desde un JOIN a `animals`. La búsqueda exacta por TAG (`animals.tag_electronic`) y el `noTag` filter pasan a `animal_profiles.animal_tag_electronic`.
- **(b2, DESCARTADA)**: `est_animals` con `animals INNER JOIN animal_profiles` = el patrón V2 que reventó en vivo (PSYNC_S2305). No escala. Ver ADR-026.

> **⚠️ DECISIÓN DE RAF (cambio de modelo de lectura).** (b1) cambia de dónde lee la identidad la UI (`animal_profiles` en vez de `animals`). El leader la surfacea; el spec_author recomienda (b1).

#### (C) Nombres de coworkers (`users` global) — **DECISIÓN DE RAF: (c2)** denormalizar `name` sobre `user_roles`

> **⚠️ RECONCILIADO al as-built (Run 5, migración `0080`).** La recomendación del spec_author era (c1) [nombres ONLINE], pero **Raf eligió (c2)** (ADR-026 §"Decisiones de Raf"): denormalizar `users.name` sobre `user_roles.member_name` → nombres de coworkers (y el propio) **offline**, sin sincronizar la tabla global `users`. El as-built (`0080`): columna `member_name text` en `user_roles` + (1) trigger force `BEFORE INSERT OR UPDATE OF member_name` (deriva de `users.name WHERE id = NEW.user_id`, anti-spoof, también en UPDATE porque `user_roles` tiene `GRANT UPDATE`) + (2) trigger de propagación `AFTER UPDATE OF name ON users` (propaga a todas las filas `user_roles` del user) + backfill. La columna viaja DENTRO de los streams `self_user_roles` / `est_members_roles` ya existentes (0 streams nuevas). PII (email/phone) NO se toca (sigue en `user_private` self-only, ADR-025). El swap de lectura T3 se reconcilió: `local-reads.buildMembersQuery`/`buildOwnNameQuery` leen `user_roles.member_name` (sin JOIN a `users`); las firmas/shape públicos no cambian (R11.1). R13.8 (variante c2) cubre esto.

`users` es compartida. El paso 1 sincroniza la **matriz de roles** (`est_members_roles`) pero **NO los nombres** (`users.name`).

- **(c1, RECOMENDADA) Nombres ONLINE.** La pantalla de miembros (admin, no manga) lee `users.name` vía PostgREST con red. Alineado con D1. Requiere **revertir la parte de nombres del swap T3** (`members.loadMembers`, `local-reads.buildMembersQuery`/`buildOwnNameQuery`) a online — hoy esas lecturas apuntan a un `users` local que el paso 1 NO sincroniza → offline devolverían `name = ''` (no crashea; el mapper coalesce). Offline: roles sin nombres, aceptable (admin).
- **(c2, alternativa) Denormalizar `name` sobre `user_roles`** (columna `member_name text` + trigger de propagación `users.name → user_roles.member_name` + backfill) → nombres 100% offline, al costo de otro delta schema-sensitive + Gate 1 por una pantalla que casi nunca se usa sin red.

> **⚠️ DECISIÓN DE RAF (¿pantalla de miembros 100% offline?).** Recomendación: **(c1)** — no justifica un delta para tener offline una pantalla de administración. Email/phone NO se tocan (viven en `user_private`, self-only, ADR-025). El leader la surfacea.

#### §2.4 — bucket math (paso 1 + paso 2 completo)

Las streams nuevas del paso 2 (A) son **idénticas en forma** a las del paso 1 (`WHERE establishment_id IN org_scope`) → **~1 bucket por campo del user, por stream**. Conteo:

- **Paso 1 (as-built V3)**: 5 globales + 2 self-only + 10 per-establishment = **17 streams**.
- **Paso 2 (A)**: 5 eventos (`ev_weight_events`, `ev_reproductive_events`, `ev_sanitary_events`, `ev_condition_score_events`, `ev_lab_samples`) + `est_animal_category_history` + `ev_birth_calves` + `est_rodeo_data_config` = **8 streams nuevas** per-establishment.
- **Paso 2 (B)**: 0 streams nuevas (la identidad viaja en `est_animal_profiles`; `est_animals` NO se agrega).
- **Paso 2 (C)**: 0 streams nuevas con (c1) [nombres online]; +0 con (c2) [`name` viaja en `est_members_roles`, ya existente].

**Total = 17 + 8 = 25 streams.** Per-establishment: 10 (paso 1) + 8 (paso 2) = **18**. Para un user de **2 campos vivos**:
`5 globales + 2 self-only + (18 per-est × 2 campos) = 5 + 2 + 36 = 43 buckets`. Peor caso Raf (5 roles antes del backfill `0076`, ~2 reales después): `5 + 2 + (18 × 2..5) = 43..97`. **Muy por debajo del tope de 1000.** El bucketing exacto lo confirma el validador del dashboard + connect de prueba (T2.x del paso 2).

> **Por qué el paso 2 NO reintroduce el riesgo #611/PSYNC_S2305**: las 8 streams nuevas filtran `establishment_id IN org_scope` **directo sobre la propia tabla** (con la columna denormalizada), **sin JOINs ni subqueries anidadas** — exactamente el patrón de las 17 que ya sincronizan en vivo. El bucketing sigue siendo ~por-campo-del-user, independiente del volumen de eventos/terneros/config. Es la razón por la que el paso 2 es de **bajo riesgo de runtime** (a diferencia de V1/V2).

### 2.1 Tablas explícitamente FUERA de toda stream (R4.11)

- `push_tokens` — registro de tokens, online (PostgREST self).
- `import_log` — historial de imports, online (no es camino de campo).
- *(no son tablas)* aceptación de invitación (EF), creación de establecimiento, gestión de cuenta → flujos online.

---

## 3. Tabla as-built → clase de sync → stream → PK ok?

> **⚠️ RECONCILIADO 2026-06-09 (paso 1 V3 + paso 2 §2.4).** En el as-built V3, las tablas hijas (eventos, `animal_category_history`, `birth_calves`, `rodeo_data_config`) sincronizan vía **`establishment_id` DENORMALIZADO** (paso 2 §2.4 (A)), NO vía JOIN al perfil. `animals` (global) NO se sincroniza como tabla — su identidad se denormaliza sobre `animal_profiles` (paso 2 §2.4 (B)/b1). Los nombres de `users` quedan **offline vía `user_roles.member_name`** (paso 2 §2.4 (C)/**c2** — decisión de Raf; corrige la mención previa a (c1) en la tabla de abajo, fila `users`/`user_roles`). La columna "Stream" de abajo refleja el paso 1; ver §2.4 para el delta del paso 2.

> **AS-BUILT `AppSchema` (paso 2, reflejo de las columnas denormalizadas en `schema.ts`).** Para que PowerSync **materialice** en el SQLite local las columnas que las migraciones `0077`–`0080` agregan (cuando bajen por las streams del paso 2), `AppSchema` las declara (`column.text`; uuid/date→TEXT — PowerSync no tipa). Sin esto, las columnas sincronizadas NO se guardan localmente y las lecturas que las usan devuelven `undefined`. Reflejadas:
> - **`establishment_id`** (`column.text`) en las 8 tablas hijas (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_category_history`, `birth_calves`, `rodeo_data_config`) — espejo fiel de la fila local (el scoping del wire es server-side por la stream). En `birth_calves`/`rodeo_data_config` (PK compuesta) va como **columna normal** más; **NO** se declara un `id` propio (el SDK lo agrega y lo prohíbe — lo porta el `id` sintético de la stream, §PK).
> - **`animal_tag_electronic` / `animal_sex` / `animal_birth_date`** (`column.text`) en `animal_profiles` (b1: identidad del animal que la UI lee offline; `animal_birth_date` es `date`→TEXT).
> - **`member_name`** (`column.text`) en `user_roles` (c2: el nombre que `buildMembersQuery`/`buildOwnNameQuery` ya leen; sin esta columna esas lecturas devolverían vacío). Cubierto por `schema.test.ts` (3 tests nuevos del paso 2). No agrega/quita tablas → el conteo total (32) no cambia.
>
> **RECONCILIACIÓN AS-BUILT (fix bug T4 en vivo, 2026-06-09 — "no such column: ap.created_by").** El `AppSchema` declaraba SOLO un subconjunto de columnas por tabla; el swap de lectura T4 (`local-reads.buildAnimalDetailQuery`) SELECTea `ap.created_by`, que NO estaba declarada → PowerSync no la materializaba en el SQLite local → la ficha del animal reventaba con `no such column`. Las streams hacen `SELECT *` (verificado en `rafaq.yaml`) → TODAS las columnas as-built bajan por el wire; el `AppSchema` debe espejarlas para que se materialicen. Se completaron las columnas as-built faltantes (tipos verificados contra `supabase/migrations/`):
> - **`animal_profiles.created_by`** (`column.text`; uuid `0043`) — **la que rompió**: la lee `buildAnimalDetailQuery` (→ `fetchAnimalDetail.createdBy`); es load-bearing para authz de baja (`exit_animal_profile`, R4.14).
> - **`animal_profiles.nursing`** (`column.integer`; boolean `0061`) — cría al pie; la escribe `createAnimal` en el INSERT del perfil. Robustez (espeja el `SELECT *`).
> - **`animals.is_castrated`** (`column.integer`; boolean `0060`) — atributo físico. Robustez.
> - **`reproductive_events.heifer_fitness`** (`column.text`; enum `0053`) — aptitud de vaquillona. Robustez.
> - **`reproductive_events.client_op_id`** (`column.text`; uuid `0075`, delta de idempotencia T6.4) — clave de la outbox; baja por la stream (`SELECT *`). Robustez.
>
> **GUARD anti-recurrencia** (`schema.test.ts`, test nuevo): un mapa manual `{tabla: [columnas que los builders de local-reads.ts leen]}` que falla si el `AppSchema` NO declara una columna que un builder SELECTea (la PK `id` se excluye — la agrega el SDK). Caza el gap en CI antes de que reviente en vivo (los unit tests de `local-reads` solo verifican el STRING SQL, no corren contra el SQLite real).

| Tabla as-built | Clase | Stream | PK `id` simple? |
|---|---|---|---|
| `species` | global | `catalog_species` | ✅ uuid `id` |
| `systems_by_species` | global | `catalog_systems` | ✅ uuid `id` |
| `categories_by_system` | global | `catalog_categories` | ✅ uuid `id` |
| `field_definitions` | global | `catalog_field_definitions` | ✅ uuid `id` |
| `system_default_fields` | global | `catalog_system_default_fields` | ✅ uuid `id` |
| `user_private` | self-only | `self_user_private` | ⚠️ PK `user_id` (no se llama `id`; ver §PK) |
| `user_roles` (propio) | self-only | `self_user_roles` | ✅ uuid `id` |
| `users` (nombres de coworkers) | compartida | **paso 2 (C)/c2: NO se sincroniza** (nombre denorm. en `user_roles.member_name`; rides on `self_user_roles`/`est_members_roles`) | ✅ uuid `id` |
| `user_roles` (del est) | per-est | `est_members_roles` (owner) | ✅ uuid `id` |
| `establishments` | per-est | `est_establishments` | ✅ uuid `id` |
| `invitations` (pendientes, owner) | per-est | `est_invitations` | ✅ uuid `id` |
| `rodeos` | per-est | `est_rodeos` | ✅ uuid `id` |
| `rodeo_data_config` | per-est (paso 2: est denorm. del rodeo) | `est_rodeo_data_config` | ❌ **PK compuesta** `(rodeo_id, field_definition_id)` (ver §PK) |
| `management_groups` | per-est | `est_management_groups` | ✅ uuid `id` |
| `animal_profiles` | per-est (+ identidad de animal denorm., paso 2 B) | `est_animal_profiles` | ✅ uuid `id` |
| `animals` | compartida (global) | **paso 2 (B)/b1: NO se sincroniza** (identidad denorm. en `animal_profiles`) | ✅ uuid `id` |
| `animal_category_history` | per-est (paso 2: est denorm. del perfil) | `est_animal_category_history` | ✅ uuid `id` |
| `sessions` | per-est | `est_sessions` | ✅ uuid `id` |
| `maneuver_presets` | per-est | `est_maneuver_presets` | ✅ uuid `id` |
| `semen_registry` | per-est | `est_semen_registry` | ✅ uuid `id` |
| `weight_events` | per-est (paso 2: est denorm. del perfil) | `ev_weight_events` | ✅ uuid `id` |
| `reproductive_events` | per-est (paso 2: est denorm. del perfil) | `ev_reproductive_events` | ✅ uuid `id` |
| `sanitary_events` | per-est (paso 2: est denorm. del perfil) | `ev_sanitary_events` | ✅ uuid `id` |
| `condition_score_events` | per-est (paso 2: est denorm. del perfil) | `ev_condition_score_events` | ✅ uuid `id` |
| `lab_samples` | per-est (paso 2: est denorm. del perfil) | `ev_lab_samples` | ✅ uuid `id` |
| `animal_events` | per-est (est propio, `0034` — paso 1) | `ev_animal_events` | ✅ uuid `id` |
| `birth_calves` | per-est (paso 2: est denorm. del parto→madre) | `ev_birth_calves` | ❌ **PK compuesta** `(birth_event_id, calf_profile_id)` (ver §PK) |
| `push_tokens` | online | — (R4.11) | n/a |
| `import_log` | online | — (R4.11) | n/a |

### §PK — Tablas sin un `id` uuid simple (issue de diseño → Puerta 1)

PowerSync exige que cada tabla sincronizada tenga una columna `id` (string) que sea su PK local. Dos tablas as-built **no la tienen**:

1. **`user_private`** — PK es `user_id` (uuid). No es problema de unicidad (es self-only, una fila por device), solo de **nombre de columna**. **Solución (recomendada)**: en `AppSchema` declarar la tabla `user_private` con `id` mapeado a `user_id`. Como solo entra **una** fila al sync set (self-only), se puede definir la stream con un alias `SELECT user_id AS id, email, phone, created_at, updated_at FROM user_private WHERE ...` o declarar en `AppSchema` que el PK es `user_id`. **Verificar la sintaxis exacta del SDK** (PowerSync soporta declarar un view-name distinto del table-name; el `id` debe existir). Se confirma en T1.

2. **`rodeo_data_config`** (PK `(rodeo_id, field_definition_id)`) y **`birth_calves`** (PK `(birth_event_id, calf_profile_id)`) — **PK compuesta real**, ambas tablas **select-only para el cliente** (rodeo_data_config se togglea por el owner pero vía UPDATE puntual; birth_calves se puebla server-side, sin GRANT INSERT). **Solución (recomendada)**: emitir un `id` sintético determinístico en la query de la stream, p.ej. `SELECT (rodeo_id || ':' || field_definition_id) AS id, * FROM rodeo_data_config WHERE ...` y `SELECT (birth_event_id || ':' || calf_profile_id) AS id, * FROM birth_calves WHERE ...`. Como ambas son **lectura local** (no se escriben offline en MVP — `rodeo_data_config` el toggle del owner es admin/online; `birth_calves` es server-only), el `id` sintético solo se usa como clave del row local; no hay upload que tenga que reconstruir la PK.

> **Decisión abierta para la Puerta 1**: confirmar el mecanismo exacto (alias en la stream vs declaración en `AppSchema`) y validar que el `id` sintético de `rodeo_data_config`/`birth_calves` no rompe el `uploadData` (deberían quedar **read-only locales**: si el owner togglea un field, esa op es **online/admin**, no upload local — ver §swap rodeo-config).

> **RESUELTA en T1.3 (Run 1, as-built)**: mecanismo = **alias `id` en la query de la stream** (NO declaración separada en `AppSchema`). Verificado contra `@powersync/common` 1.53.2: el SDK (a) AGREGA una columna `id` TEXT implícita a cada tabla y (b) PROHÍBE declarar una columna `id` propia (`"An id column is automatically added, custom id columns are not supported"`), y las filas que bajan por la stream DEBEN traer un `id`. Por eso las 3 streams emiten el `id`: `self_user_private` → `SELECT user_id AS id, *`; `est_rodeo_data_config` → `SELECT (rodeo_id || ':' || field_definition_id) AS id, *`; `ev_birth_calves` → `SELECT (birth_event_id || ':' || calf_profile_id) AS id, *`. En `AppSchema` (`schema.ts`) esas 3 tablas declaran sus columnas as-built (`user_id`, `rodeo_id`+`field_definition_id`, `birth_event_id`+`calf_profile_id`) como columnas normales; el `id` implícito porta el valor aliased/sintético. Las 3 son **read-only locales** (no se escriben offline en MVP) → el `id` sintético NO entra a `uploadData` (no hay CrudEntry plano para ellas). ⚠️ Nota para Run T6/futuro: NO escribir esas 3 tablas localmente — un `upsert` plano con el `id` sintético/aliased fallaría server-side (no existe columna `id` en esas tablas).

---

## 4. Connector + auth (R3)

```
class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    const { data } = await supabase.auth.getSession();   // autoRefresh ya lo renueva (supabase.ts)
    // RECONCILIADO (T1.5, as-built): el contrato del SDK es DEVOLVER null si no hay sesión (no throw).
    // "Return null if the user is not signed in. Throw an error [solo] if credentials cannot be
    // fetched due to a network/temporary error." → con throw, el SDK lo trataría como error transitorio
    // y reintentaría en loop sin sesión. Por eso: sin sesión/sin access_token → null (no conectar hasta
    // el próximo login). La lógica PURA vive en upload-classify.ts::buildCredentials (testeable).
    if (!data.session?.access_token) return null;        // sin sesión → no conectar
    return {
      endpoint: getEnv().powersyncUrl,                    // EXPO_PUBLIC_POWERSYNC_URL (R1.2)
      token: data.session.access_token,                   // JWT validado por la instancia vía JWKS
    };
  }
  async uploadData(database) { /* ver §5.4 */ }
}
```

- **R3.2 (refresh)**: `supabase` ya tiene `autoRefreshToken: true` (supabase.ts). Cuando el token vence, `getSession()` devuelve el renovado; PowerSync re-pide credenciales y reconecta. Sin logout forzado.
- **JWKS**: la instancia valida el JWT contra las JWKS de Supabase (signing keys ECC P-256, sin legacy secret — context). El connector no firma nada; solo pasa el `access_token`.

---

## 5. Plan de swap de services

### 5.1 Lecturas → watchable local (R5.1–R5.3)

Cada `await supabase.from(T).select(...)` pasa a `await db.getAll(sql)` o `db.watch(sql)` sobre la tabla local equivalente. Los JOINs de PostgREST (`animals!inner(...)`, `rodeos!inner(...)`) se reescriben como **JOINs SQLite** en la query local (SQLite soporta JOIN normal; PowerSync expone SQL completo sobre el DB local). Services afectados:

- `animals.ts`: `fetchAnimals`, `searchAnimals`, `countAnimals`, `fetchSystemCategories`, `fetchAnimalDetail`, `findOrCreateLookup` → SQL local. La **búsqueda fuzzy** (`pg_trgm`/`gin_trgm_ops`) NO existe en SQLite: el fuzzy se degrada a `LIKE '%term%'` local (el exacto por TAG/IDV sigue igual). Nota de diseño: reproducir el ranking por similaridad es post-MVP; el `LIKE` cubre el caso operativo (escribir un fragmento).
- `events.ts`: `fetchTimeline` (hoy RPC `animal_timeline` security definer) → **reconstruir el UNION ALL de los 7 orígenes como SQL local** sobre las tablas sincronizadas (el filtro `has_role_in` ya lo aplicó la stream al sincronizar → no se re-filtra localmente). `fetchMother` (hoy nested PostgREST por `birth_calves`) → JOIN local. `fetchTimeline` ya no necesita las 2 queries suplementarias (categorías + service_type): se resuelven en el mismo SQL local.
- `management-groups.ts`: `fetchManagementGroups`, `fetchGroupMembers` → SQL local.
- `rodeos.ts`, `rodeo-config.ts`, `establishments.ts`, `members.ts`, `profile.ts`: lectura del contexto/listas → SQL local.

> **As-built Run 3 (reconciliación, T3.1/T3.2/T3.3 — catálogos globales + contexto de establecimiento + rodeos):**
> - **One-shot `getAll`, NO `db.watch` (reactividad diferida).** Las lecturas swapeadas usan `getPowerSync().getAll<T>(sql, args)` (one-shot), no `db.watch`. La reactividad watchable (R5.3) se difiere a un run posterior que NO toca call sites (las firmas públicas `ServiceResult<T>` no cambian, R11.1). Hooks/screens intactos.
> - **SQL builders PUROS separados** (espejo del patrón `exit-animal.ts`): `app/src/services/powersync/local-reads.ts` exporta `build<Algo>Query(params) → { sql, args }` SIN imports (testeable bajo `node:test`, `local-reads.test.ts`). El I/O vive en `app/src/services/powersync/local-query.ts` (`runLocalQuery`/`runLocalQuerySingle`): hace `getAll` + la lógica de "aún no sincronizó"; NO entra al grafo de `node:test` (importa el SDK).
> - **"Aún no sincronizó" (R5.4) sin romper firmas.** `local-query` distingue "tabla vacía genuina" de "primer sync no bajó" vía `db.currentStatus.hasSynced` (API real del SDK). Si `!hasSynced` y la query vino vacía → `AppError { kind:'network', message:'Sincronizando datos del campo…' }` (reusa `kind:'network'`, que la UI ya trata como transitorio/reintentable — NO se agrega un `kind` nuevo que rompa exhaustividad en call sites). Lecturas donde "vacío" es legítimo (no-owner sin invitaciones, teléfono opcional) pasan `emptyIsSyncing:false` → no degradan.
> - **Filtros: scoping de tenant NO se re-filtra; filtros de DOMINIO SÍ se conservan.** El SQL local NO re-aplica `has_role_in`/`establishment_id IN (...)` (la stream ya scopeó el dato local). SÍ conserva los filtros de dominio que cambian el set: `active = 1` (field_definitions, rodeos, categories_by_system, species), `deleted_at IS NULL` (rodeos/establishments, defensivo), `status = 'pending'` (invitations), `user_id != owner/self` (counts). Booleans Postgres → `INTEGER` 1/0 en SQLite (`column.integer`), coerción a boolean vía `toBool` en el mapper (preserva el shape público); filtros usan `= 1`.
> - **JOINs PostgREST → JOINs SQLite.** `loadMemberships` (`user_roles ⋈ establishments`, INNER) y `loadMembers` (`user_roles ⋈ users`, LEFT) reescritos como JOINs SQLite; las filas planas se re-arman a la forma anidada que esperan los mappers puros existentes (`mapMembershipRows` con su dedup + filtro soft-delete). `fetchProductionSystems` resuelve `species` por code con 2 queries locales (species → systems).
> - **`createRodeo` queda ONLINE en T3 (T5/T6 lo swappea a outbox).** Como `createRodeo` (write online) diffea su propio INSERT con un before/after de la lista de rodeos, y la versión local de `fetchRodeos` NO reflejaría ese INSERT hasta que la stream sincronice (async), `createRodeo` usa un helper INTERNO `fetchRodeosOnline` (PostgREST, misma query/filtros/orden que la `fetchRodeos` original) para ver su escritura al instante. La `fetchRodeos` PÚBLICA (consumida por `RodeoContext`) lee local. No cambia ninguna firma pública.
> - **Diagnóstico temporal en `provider.tsx`** (`// TODO(debug 15-powersync): quitar tras validar T3`): al resolver `db.waitForFirstSync()` (API real del SDK) se loguea UNA vez `[powersync] first sync done; local rows: establishments=N, categories_by_system=N, field_definitions=N, rodeos=N, user_private=N` — SOLO COUNT(*), JAMÁS contenido (PII de user_private).
> - **Nota de comportamiento:** los conteos (`countActiveMembers`, `countTeam`) son `SELECT COUNT(*)` (siempre 1 fila) → no degradan a "sincronizando"; pre-primer-sync devuelven 0 (dirección segura: alimentan hints de UI, no autorización; el soft-delete asociado es online).

> **As-built (reconciliación, fix showstopper "onboarding fantasma / listas vacías" — 2026-06-09):**
> El swap de lectura T3 dejó un bug CRÍTICO de TIMING en el bootstrap del cliente: el gate de establecimiento (`EstablishmentContext`) y las lecturas resolvían el SQLite local **one-shot ANTES de que el first-sync poblara la DB** y NO re-evaluaban. `runLocalQuery` YA distinguía "vacío + `!hasSynced`" devolviendo `{ ok:false, kind:'network', SYNCING_MESSAGE }`, pero el bootstrap del `EstablishmentContext` colapsaba CUALQUIER `!result.ok` a `no_establishments` → la app aterrizaba en ONBOARDING aunque el campo SÍ sincronizara medio segundo después. Confirmado por E2E (los datos bajaban: `user_roles=1, establishments=1, rodeos=1` — pero el gate ya había ruteado a onboarding). 100% client-side (no toca streams/migraciones/connector/overlay/schema). As-built:
> - **`first-sync.ts` (nuevo):** `waitForUsableSync({timeoutMs?, db?})` → `'cached'` AL INSTANTE si `currentStatus.hasSynced===true` (offline/reload: el sync persistido se restaura de IndexedDB → NO esperar red, clave para no colgar offline); si no, `await db.waitForFirstSync(abortSignal)` con `AbortController` + `setTimeout(abort, timeoutMs)` → `'synced'` o `'timeout'` (degradación). `isFirstSyncPending(db?)` → `currentStatus.hasSynced !== true`. PURO salvo el acceso al SDK (`db` inyectable; `getPowerSync` por require LAZY para no arrastrar RN al grafo de `node:test`). Unit `first-sync.test.ts` (8) cubre cached/synced/timeout/pending con un `db` fake. `FIRST_SYNC_TIMEOUT_MS=4500`.
> - **`EstablishmentContext` (el fix):** (1a) el bootstrap hace `await waitForUsableSync()` ANTES de `loadMemberships`. (1c) helper interno `applyMembershipsResult(result)` centraliza la regla de error y la comparten bootstrap + `refreshEstablishments` + el listener: un fallo `network` MIENTRAS `isFirstSyncPending()` → NO afirma `no_establishments` (se queda en `loading` / preserva el estado válido); solo un fallo GENUINO (first-sync ya completó, o no es network) cae a `no_establishments` en bootstrap. (1b) efecto nuevo: `getPowerSync().registerListener({ statusChanged })` re-llama `refreshEstablishments()` SOLO en la transición first-sync **false→true** (var local `lastHasSynced`; NO en cada statusChanged → evita loops/falsos active_lost por downloads parciales). La reactividad ante cambios de coworker/altas propias post-first-sync queda DIFERIDA (la cubre el `useFocusEffect`/refresh manual existente).
> - **`RodeoContext`:** mismo patrón 1b — listener `statusChanged` que re-corre `load(userId, establishmentId)` en la transición first-sync false→true SOLO si el contexto está esperando (`isWaitingRef`, status `loading`). Necesario porque el RootGate exige est:active Y rodeo resuelto para llegar a home; sin esto el rodeo quedaría colgado en `loading` tras el fix del establecimiento.
> - **`_layout.tsx` (RootGate):** sin lógica de sync nueva — solo coordinación de timeouts. El fallback que destapa el splash pasó a `SPLASH_FALLBACK_MS = FIRST_SYNC_TIMEOUT_MS + 500` (≈5s): garantiza que el contexto resuelva su ruta ANTES de que el splash se destape; si el sync llega más tarde, el listener (1b) re-rutea de onboarding a home.
> - **`animales.tsx` + stepper del Inicio (`(tabs)/index.tsx`):** `useStatus()` de `@powersync/react` + efecto que re-corre la carga (`loadList()` / `loadAnimalCount`+`loadTeamCount`) cuando AVANZA `status.lastSyncedAt` (dep primitiva en ms → estable entre syncs, no loopea). Así la lista/los conteos se rellenan al bajar el first-sync (o un download posterior) sin salir/volver a la tab. El `useFocusEffect` queda de red de seguridad. **NO se migró el data layer a `useQuery`/`watch`** (refactor grande que tocaría overlay/outbox — backlog 2026-06-09).
> - **Validación E2E (oráculo):** `animals.spec.ts:386` "buscar un animal EXISTENTE → … aparece en la lista (carga inicial)" pasa de ROJO (baseline sin el fix) a VERDE — es la repro directa del bug (aterrizaba en onboarding; ahora aterriza en home con la lista poblada) + assert anti-flash agregado. `auth.spec` 4/4 verde (incl. "SIN campos → onboarding" DESPUÉS del first-sync = onboarding legítimo intacto). `establishments.spec:68` (≥2 campos → Mis campos → home) verde. Residuales PRE-EXISTENTES al fix (verificados rojos en baseline, fuera de scope → backlog 2026-06-09): `animals.spec:52` tail (stepper post-alta-offline), `animals.spec:500` (overlay de exit sin `exit_date`), `establishments.spec:29` (crear-campo lee local antes del sync-down del campo nuevo).
>
> **As-built (Run bugfix-overlay-list, 2026-06-10 — "animal creado OFFLINE desaparece de la lista al navegar de tab"):** el re-query manual de `animales.tsx` cubría la LISTA pero NO la BÚSQUEDA activa: la ejecución de `searchAnimals` vivía solo en el efecto `[establishmentId, debouncedQuery]` → si el alta nacía del no-match del buscador (find-or-create R1.4 de spec 09), el término quedaba en el search bar y al re-enfocar la tab `visible` mostraba los `searchResults` VIEJOS ("No encontramos «N»") aunque el animal recién creado SÍ estaba en el overlay (`pending_animal_profiles`) y en `buildAnimalsListQuery` (verificado por dump del SQLite local en el repro E2E). Fix: la ejecución de la búsqueda se extrajo a un callback `runSearch` (mismo guard de secuencia) y se re-corre TAMBIÉN en el `useFocusEffect` y en el efecto de `lastSyncedAt` — simétrico a `loadList`. Diagnóstico que DESCARTÓ las otras hipótesis con evidencia (repro E2E instrumentado, export prod Y dev server Metro): el overlay NUNCA se rollbackea offline (el error real de upload es `TypeError: Failed to fetch` con `code:''`/`status:undefined` → `classifyIntentUploadError` = transient en 10+ ciclos de retry, cero `[powersync] upload rechazado`), el contexto no re-resuelve al navegar, y la fila del overlay matchea la query de la lista. Oráculos E2E nuevos (primeros tests offline reales de la suite, `context.setOffline(true)`): `animals-offline.spec.ts` — (1) repro literal del backlog (alta por empty-CTA → Más → Animales → sigue visible; verde ya en baseline, queda de red de regresión del overlay/clasificación transient) y (2) alta vía buscador no-match → al volver de la ficha (y tras Más→Animales con el término tipeado) el animal se ve, no el no-match stale — **ROJO en baseline → VERDE con el fix** (verificado por stash en el mismo harness).

### 5.2 Escritura local + upload — CRUD-plano offline-safe (R6.1)

Estas pasan de `supabase.from(T).insert(payload)` a `db.execute('INSERT INTO T (...) VALUES (...)', [...])` sobre el DB local; PowerSync encola la op y el connector la sube (R3.3). El `id` se genera en cliente (R6.4, ya es el patrón). Afecta:

- `events.ts`: `addWeight`, `addConditionScore`, `addTacto`, `addService`, `addAbortion`, `addObservation`.
- `management-groups.ts`: `assignAnimalToGroup` (UPDATE local), `createManagementGroup`, `renameManagementGroup`.
- `sessions`/`maneuver_presets` (cuando la UI de spec 03 las consuma): create/update local.

**R6.3 (gotcha RLS-on-RETURNING desaparece)**: hoy estos services hacen split insert+select / `count:'exact'` para sortear que el RETURNING no ve la fila bajo la SELECT-policy `deleted_at is null`. Con escritura local, **la lectura post-escritura es una query watchable sobre SQLite local** — no hay roundtrip a PostgREST ni RETURNING que evalúe RLS. El `diff before/after` de `createManagementGroup` y el `count:'exact'` de `assignAnimalToGroup`/`renameManagementGroup` se **eliminan**: la fila ya está en el DB local apenas se inserta/actualiza, y la watchable refleja el cambio. La autorización real se valida al **subir** (el upload aplica el INSERT/UPDATE contra PostgREST → RLS lo acepta o lo rechaza, R6.2/R8.1).

> **AS-BUILT (Run 8, T5).** Los SQL builders de escritura son PUROS en `services/powersync/local-reads.ts` (mismo patrón que los read-builders) + I/O `runLocalWrite()` en `local-query.ts` (`db.execute(sql, args)`). Decisiones de implementación:
> - **`establishment_id` de las tablas de evento (0077)**: se ELIGIÓ la opción (a) — **OMITIRLO en el INSERT local**. El trigger `tg_force_establishment_id_from_profile` (0077, BEFORE INSERT) lo FUERZA desde `animal_profiles.establishment_id` al SUBIR (incondicional, anti-spoof — ignora cualquier valor del payload), así que la fila sube consistente; localmente queda NULL y no rompe nada porque las lecturas T4 del timeline filtran por `animal_profile_id` (NUNCA por `establishment_id`). Es lo más robusto y simple (no se deriva del contexto activo, que podría ser otro campo). **EXCEPCIÓN: `animal_events`** — su trigger (`tg_animal_events_validate_est`, 0034) es de VALIDACIÓN (no force): exige que `establishment_id` coincida con el del perfil (23514 si no) → `addObservation` SÍ lo setea en el INSERT local, derivado del PERFIL (lo pasa el caller, no el contexto activo). Comportamiento idéntico al as-built previo.
> - **`created_by`/`author_id`/`source`/`edit_window_until`**: NO se mandan (trigger/default server-side los pone al subir) — idéntico al as-built previo.
> - **`createManagementGroup`** devuelve el lote con su `id` de cliente SIN re-leer (la firma `ServiceResult<ManagementGroup>` se preserva, R11.1).
> - **Contrato**: `runLocalWrite` devuelve error SOLO si el `execute` local falla (DB no booteada / SQL malformado, defensivo `kind:'unknown'`) — NUNCA por un reject de upload (eso lo maneja `uploadData` por el canal de status, R8.1). El local write siempre tiene éxito offline.
> - **`sessions`/`maneuver_presets`**: sin service cliente (frontend spec 03 diferido) → T5.3 sin alcance hoy.

### 5.3 Mutaciones (b) RPC-bound — OFFLINE vía outbox + RPC-mapping (Puerta 1, opción ii)

> **RESUELTO en la Puerta 1 (2026-06-08): opción (ii).** `register_birth`, `exit_animal_profile`, los `soft_delete_*` y el **alta de animal** (`createAnimal`) van **OFFLINE** vía una **outbox** local mapeada a RPC en el drenado (R6.6, R6.8–R6.11). Solo `import_rodeo_bulk` queda **ONLINE** (excepción documentada abajo). Estas mutaciones NO se pueden expresar como CRUD plano offline-safe (son atómicas / SECURITY DEFINER / cross-tabla), de ahí el outbox + RPC-mapping en vez del camino plano de §5.2.

#### 5.3.1 Por qué outbox + RPC (y no CRUD plano)

| Service / función | Por qué NO es CRUD plano (necesita RPC) |
|---|---|
| `animals.createAnimal` | 2 inserts cross-tabla `animals`→`animal_profiles`, NO atómicos. Dos CrudEntry planos separados podrían dejar un `animals` huérfano si el upload del perfil falla por RLS/unique. **As-built (Run create-animal-rpc, 2026-06-10): RPC atómica `create_animal` (0083)** — la alternativa "orden atómico en `uploadData`" (2 upserts) se implementó primero (Run T6) y se probó INSUFICIENTE: perdía el alta bajo reintento (ver la nota de §5.4.2). |
| `events.registerBirth` (`register_birth`) | RPC SECURITY DEFINER atómico (evento de parto + N terneros + N `birth_calves` + transición de categoría de la madre). No es CRUD plano; un upload plano no lo replica atómicamente. |
| `exit-animal.exitAnimalProfile` (`exit_animal_profile`) | RPC SECURITY DEFINER (authz `has_role_in AND (owner OR created_by)` + lógica de egreso). |
| `soft_delete_*` (rodeo, management_group, animal_event, evento tipado) | RPCs SECURITY DEFINER que sortean el gotcha RLS-on-RETURNING del soft-delete. Un UPDATE local de `deleted_at` subido como CRUD plano sería **rechazado** por PostgREST (la fila sale de la SELECT-policy) — exactamente el bug que los RPCs resuelven. Por eso el `DELETE`/soft-delete NO va por el camino plano de §5.4.1: va por la outbox→RPC. |

**`import_rodeo_bulk` — queda ONLINE (excepción).** No es camino de manga: es **onboarding masivo** (lo define la feature 12 como online). Encolar miles de filas en la outbox offline es impráctico (memoria del device, atomicidad de la transacción masiva, UX). Se invoca directo contra Supabase; sin red → `kind:'network'` accionable sin marcar como hecho (R6.6).

**Identidad/admin** (`establishments.create`, `members.invite`, `profile` edit, aceptar invitación EF) — siguen **online** por R7.1/D1 (no es esta decisión).

#### 5.3.2 La outbox: tabla write-side NO sincronizada (`insertOnly` en `AppSchema`)

La intención se encola en una tabla local declarada `insertOnly` en `AppSchema`:

```ts
// services/powersync/schema.ts (extracto)
const op_intents = new Table(
  {
    // id (PK uuid de cliente, requerido por PowerSync) = client_op_id (clave de idempotencia, R6.10)
    op_type:      column.text,   // 'register_birth' | 'exit_animal_profile' | 'soft_delete_rodeo' | ... | 'create_animal'
    params_json:  column.text,   // JSON.stringify de los params de la RPC (incluye ids generados en cliente)
    created_at:   column.text,
  },
  { insertOnly: true },          // ← NO persiste fila local; SÍ genera CrudEntry para uploadData()
);
```

**Por qué `insertOnly` y no `localOnly`** (a confirmar la opción exacta del SDK en T1):
- Una tabla `localOnly: true` **no genera CrudEntry** → `uploadData()` nunca la ve → no sirve como write-side queue.
- Una tabla `insertOnly: true` **sí genera CrudEntry** (entra a la upload queue para que `uploadData()` la procese) pero **no replica la fila como CRUD plano** y no persiste como dato local a leer — es exactamente el patrón de outbox/write-side de PowerSync. El `uploadData()` intercepta esa CrudEntry por `op.table === 'op_intents'` y la mapea a `supabase.rpc(...)` (§5.4.2); **nunca** se hace `supabase.from('op_intents').insert(...)`.

**Preservación de R11.3 (no se tocan policies/RLS/triggers; UN delta aditivo aprobado).** La tabla `op_intents` y las tablas overlay `pending_*` viven **solo en `AppSchema`** (cliente) y **no existen en el server ni en ninguna sync stream** (write-side / local-only, no se replican). No agregan tabla al schema replicado ni superficie de RLS/stream. La única tensión con R11.3 es la **idempotencia server-side de `register_birth`** (§5.4.3): la dedup por `client_op_id` exige un **delta de backend ADITIVO** (columna nullable `client_op_id` en `reproductive_events` + UNIQUE parcial + param `p_client_op_id default null` en la RPC). Ese delta fue **aprobado en Puerta 1 (2026-06-08)** y reconciliado en R11.3 (ya no es "no schema changes" sino "no se modifican policies/RLS/triggers; se permite ese delta aditivo"). Es **schema-sensitive → Gate 1 (spec) obligatorio antes de implementarlo** (R11.4). La migración (≥ `0075`) la escribe/aplica el implementer por Management API, gateada por el leader; **el spec_author NO escribe migraciones**. `exit_animal_profile`, `create_animal` y los `soft_delete_*` NO reciben delta (dedup-natural, §5.4.3).

#### 5.3.3 Estado optimista — OVERLAY LOCAL-ONLY (R6.11/R6.12, cerrado 2026-06-08)

> **Cierre del hueco DOUBLE-UPLOAD.** El diseño previo escribía las filas optimistas en las tablas **SINCRONIZADAS** (el ternero, el alta, el UPDATE de baja, el `deleted_at`) con ids de cliente *y además* encolaba el `op_intent`. Problema: PowerSync genera una CrudEntry para **ambas cosas** → `uploadData()` aplicaría la op DOS veces (el INSERT/UPDATE plano de la fila optimista **y** la RPC del intent). Eso duplica / corrompe. **Resuelto: el efecto optimista vive en un overlay `localOnly` que NO genera CrudEntry; el upload va SOLO por el `op_intent`.**

> **⚠️ RECONCILIADO al as-built (Run T6) — columnas del overlay + surfacing de errores de dominio.**
> - **`pending_animal_profiles` lleva el shape COMPLETO de lectura** (no solo "unas cols espejo"): las
>   columnas que el UNION de la lista (`buildAnimalsListQuery`) y del detalle (`buildAnimalDetailQuery`) leen,
>   INCLUIDA la **identidad denormalizada b1** (`animal_tag_electronic`/`animal_sex`/`animal_birth_date`) + los
>   atributos de detalle (`category_override`/`breed`/`coat_color`/`entry_date`/`entry_weight`/`created_by`/
>   `exit_date`/`exit_reason`) + `created_at` (para el ORDER BY del UNION). Así el UNION es directo (mismas
>   columnas que `animal_profiles`), sin JOIN a `pending_animals`. `pending_reproductive_events` lleva
>   `created_at` (orden/payload del timeline). Un GUARD en `schema.test.ts` verifica que el overlay declara
>   toda columna que el UNION lee (anti "no such column" en vivo).
> - **Los errores de DOMINIO ya NO se surfacing desde el return del service** (offline-first): con el alta/
>   parto offline, el encolado SIEMPRE tiene éxito (devuelve `ok:true`) y el rechazo REAL — caravana/IDV
>   duplicada (`createAnimal`), tag de ternero duplicada o sin rol (`registerBirth`), 42501 en la baja/borrado
>   — lo resuelve `uploadData` al SUBIR (rollback del overlay + superficia por el canal de status, R8.1), NO
>   el return. Las pantallas no se rompen (ya manejaban `ok:true` → navegan). **Consecuencia UX**: offline no
>   hay feedback inmediato de duplicado al dar de alta; se ve al sincronizar. (Decisión de producto abierta
>   para el leader: ¿check de unicidad LOCAL best-effort pre-encolado sobre el SQLite ya sincronizado?)
> - **`soft_delete_event`/`soft_delete_animal_event`**: el mapper los soporta, pero NO hay service cliente que
>   los invoque hoy (sin UI de borrado de eventos — spec 03 diferida) → sin swap en este run.

El efecto optimista se escribe en **tablas overlay `localOnly: true`** declaradas en `AppSchema`, en el **mismo paso (misma `writeTransaction` local)** en que el service encola la intención en `op_intents`:

```ts
// services/powersync/schema.ts (extracto)
// Overlay optimista: una tabla local-only por "forma" de efecto. NO genera CrudEntry → no se sube.
// Cada fila lleva un client_op_id (= id del op_intent que la generó) para poder limpiarla/rollbackearla.
const pending_animal_profiles = new Table({ client_op_id: column.text, /* ...cols espejo... */ }, { localOnly: true });
const pending_animals         = new Table({ client_op_id: column.text, /* ... */ },                { localOnly: true });
const pending_birth_calves    = new Table({ client_op_id: column.text, /* ... */ },                { localOnly: true });
const pending_reproductive_events = new Table({ client_op_id: column.text, /* ... */ },            { localOnly: true });
// Para bajas/soft-deletes: un overlay de "ocultar/marcar" en vez de un UPDATE sobre la fila sincronizada.
// `exit_date` (residual #2, as-built): fecha de egreso de cliente para una baja optimista (effect 'exited'),
// surfaceada por la ficha (COALESCE pso.exit_date) → el badge "Vendido el {fecha}" funciona OFFLINE con la
// misma fecha que la RPC persiste. null para soft_deleted.
const pending_status_overrides = new Table(
  { client_op_id: column.text, target_table: column.text, target_id: column.text, effect: column.text /* 'soft_deleted'|'exited' */, status: column.text, exit_date: column.text },
  { localOnly: true },
);
```

| Op | Efecto optimista en el overlay local-only (para que la UI lo vea offline) |
|---|---|
| `register_birth` | filas en `pending_reproductive_events` (el parto) + `pending_animals`/`pending_animal_profiles` (N terneros) + `pending_birth_calves`, todas con `client_op_id` = id del intent (los ids "visuales" del overlay son de cliente, **provisionales**: los reales los asigna la RPC server-side — §5.4.3). |
| `createAnimal` | filas en `pending_animals` + `pending_animal_profiles` (ids de cliente = los mismos que la RPC reusará por ON CONFLICT — §5.4.3). |
| `exit_animal_profile` | fila en `pending_status_overrides` (`target_table='animal_profiles'`, `target_id=<perfil>`, `effect='exited'`, `status=<sold/dead/transferred>`, `exit_date=<fecha elegida>`). NO se UPDATEa la fila sincronizada. La ficha COALESCEa `pso.exit_date` → badge "Vendido el {fecha}" offline (residual #2). |
| `soft_delete_*` | fila en `pending_status_overrides` (`effect='soft_deleted'`, `target_table`/`target_id` del objetivo). La lectura la trata como "oculta". |

**Lectura = UNION synced + overlay (R6.11).** Las queries de lectura del camino afectado (ficha/detalle, timeline, lista de animales, miembros de lote) hacen `UNION ALL` del estado sincronizado con el overlay pendiente, aplicando el override de estado:
- creaciones (`register_birth`, `createAnimal`): `SELECT ... FROM animal_profiles WHERE <scope> UNION ALL SELECT ... FROM pending_animal_profiles WHERE client_op_id IN (<intents pendientes>)`.
- bajas/borrados: la query principal hace `LEFT JOIN pending_status_overrides` y **excluye/marca** las filas con un override pendiente (`WHERE NOT EXISTS (SELECT 1 FROM pending_status_overrides p WHERE p.target_table='...' AND p.target_id = t.id AND p.effect='soft_deleted')`).

La UI lee de la watchable (synced + overlay) → ve el ternero / el alta / la baja **al instante**, offline (reactividad R5.3). La outbox lleva la *intención* (qué RPC + params); el overlay es el *efecto visible*; **nada toca las tablas sincronizadas** hasta que la RPC corre server-side. La consistencia (limpieza en ACK, rollback en rechazo) se maneja en §5.4.4.

### 5.4 `uploadData()` — drenado de la upload queue (R3.3)

`uploadData()` procesa **dos clases** de CrudEntry, distinguidas por `op.table`:
1. **CRUD plano** (§5.2): tablas de datos normales (`weight_events`, `management_groups`, `animal_profiles` UPDATE de lote, etc.) → upsert/update directo contra PostgREST.
2. **Intenciones de outbox** (`op.table === 'op_intents'`, §5.3): → mapeo a `supabase.rpc(...)`.

#### 5.4.1 Camino CRUD plano

```
for (const op of tx.crud) {
  if (op.table === 'op_intents') { await applyIntent(op); continue; }  // §5.4.2
  const table = supabase.from(op.table);
  switch (op.op) {
    case UpdateType.PUT:    await throwOnError(table.upsert({ ...op.opData, id: op.id })); break;
    case UpdateType.PATCH:  await throwOnError(table.update(op.opData).eq('id', op.id));   break;
    case UpdateType.DELETE: /* no se usa para datos: el soft-delete va por outbox→RPC (§5.3.1) */ break;
  }
}
```

- **R6.2**: el `upsert`/`update` contra PostgREST dispara RLS + triggers + CHECKs igual que un insert normal. Los triggers de `created_by`/`author_id` fuerzan el autor desde `auth.uid()` (ignoran el valor del payload) → no hay spoofing por la cola.

#### 5.4.2 Camino de intención (outbox → RPC) — mapeo + idempotencia

```
async function applyIntent(op /* CrudEntry de op_intents */) {
  const params  = JSON.parse(op.opData.params_json);
  const opType  = op.opData.op_type;            // 'register_birth' | 'exit_animal_profile' | 'soft_delete_*' | 'create_animal'
  // SOLO register_birth recibe p_client_op_id (dedup explícita, delta §5.4.3). El resto es
  // dedup-natural → NO se les pasa p_client_op_id (su firma no lo tiene).
  const args = opType === 'register_birth' ? { ...params, p_client_op_id: op.id } : params;
  await throwOnError(supabase.rpc(opType, args));
}
```

> **⛔ SUPERSEDIDO (Run create-animal-rpc, 2026-06-10) — la nota de reconciliación de Run T6 ("`create_animal`
> NO tiene RPC → 2 upserts idempotentes") quedó INVALIDADA por un bug de PÉRDIDA REAL de datos** (backlog
> 2026-06-10 REABIERTO; diagnóstico del leader con logs API + DB remota). Los 2 upserts HTTP NO eran
> idempotentes bajo RLS: (1) un drenado interrumpido ENTRE ambos (red, tab cerrada) dejaba `animals` insertado
> SIN perfil (huérfano invisible por RLS); (2) el REINTENTO del upsert de `animals` pegaba el conflicto de PK
> → rama default `ON CONFLICT DO UPDATE` de supabase-js → la policy UPDATE de `animals` (0022) exige `EXISTS
> animal_profiles` visible → el perfil no existe → **42501/403**; (3) `classifyIntentUploadError('42501')` =
> `permanent_reject` → `rollbackOverlay` + descarte del intent → **el alta desaparecía de la UI y nunca
> llegaba al server**; (4) los eventos post-create encolados morían después con FK 23503. Evidencia: campo
> real de Raf con CERO `animal_profiles` server-side + huérfanos en `animals` + logs `POST animals → 403`.
>
> **✅ As-built VIGENTE (Run create-animal-rpc): `create_animal` SÍ tiene RPC — migración `0083_create_animal_rpc.sql`
> (patrón 0081 `create_rodeo`), decisión de Raf (opción B).** Una RPC SECURITY DEFINER (`set search_path =
> public`) con: authz PRIMERO (`has_role_in(p_establishment_id)`, paridad con la policy INSERT as-built de
> `animal_profiles` — cualquier rol activo puede dar de alta; 42501 genérico); UNA transacción con INSERT de
> `animals` + INSERT de `animal_profiles` con los ids de CLIENTE, ambos `ON CONFLICT (id) DO NOTHING`
> (target SOLO la PK) → replay at-least-once = no-op 2xx total Y **healing del half-state** (un `animals`
> huérfano del camino viejo → DO NOTHING → se crea el perfil que faltaba); guards anti-IDOR post-insert
> (la fila de `animals` debe MATCHEAR la identidad del intent — sex/species/tag/birth_date — y el perfil debe
> ser del animal+establishment del intent; mismatch → 42501 genérico, espeja el (c-bis) de 0081); los UNIQUE
> de dominio (tag de OTRO animal, idv duplicado) NO se absorben → 23505 SALE (rechazo permanente que
> uploadData superficia); los triggers as-built disparan adentro (0043 fuerza `created_by` = caller —
> `auth.uid()` sigue siendo el caller bajo SECURITY DEFINER, patrón 0075/0081; 0079 fuerza la identidad
> denormalizada; 0021 valida identidad/rodeo/categoría); grants cerrados a `authenticated` + `notify pgrst`.
> **El connector ya NO tiene la rama de 2 upserts**: todo intent (b) va por `supabase.rpc`. **Compat hacia
> atrás**: el shape del intent NO cambió (`params_json = { animals: {...}, animal_profiles: {...} }`) —
> `mapIntentToRpc` TRADUCE ese shape histórico a los args `p_*` de la RPC, así los op_intents YA ENCOLADOS
> en devices drenan por el camino nuevo (keys opcionales ausentes → `null` → defaults server-side). Un intent
> sin ids de cliente → `PermanentIntentError` (sin ids no hay idempotencia). El `op_type` se sigue
> whitelisteando (`mapIntentToRpc`): un `op_type` fuera de {`create_animal`, `register_birth`,
> `exit_animal_profile`, `soft_delete_management_group`, `soft_delete_rodeo`, `soft_delete_animal_event`,
> `soft_delete_event`, `create_rodeo`, `set_rodeo_config`} → `PermanentIntentError` (descarte, no se invoca
> una RPC arbitraria).

- **Orden**: las intenciones se drenan en **orden de cola** (FIFO de la upload queue), igual que el CRUD plano. Si una operación depende de otra (ej. crear un animal y luego un evento sobre él), el orden de encolado lo preserva. Las dependencias cross-op se resuelven porque los `id` de `create_animal`/eventos son de cliente (la RPC los recibe como params; para `register_birth` los ids de los terneros los asigna el server).
- **`p_client_op_id` solo en `register_birth`** (§5.4.3): es la única RPC con dedup explícita. `exit_animal_profile`/`create_animal`/`soft_delete_*` no llevan ese param (sus firmas as-built no lo tienen y son dedup-natural).
- **Transitorio vs permanente**: `applyIntent` lanza; el catch de `uploadData` decide (§5.4.4): transitorio → re-throw (deja la tx en cola, reintento, R3.4); permanente → descarta + rollback del overlay local-only + superficia (R3.5/R6.9/R6.11/R8.1); `P0002` de un `soft_delete_*` ya aplicado → éxito idempotente (descarta sin rollback).

#### 5.4.3 IDEMPOTENCIA — no doble-apply (R6.10, el punto crítico) — CERRADO 2026-06-08 con evidencia de las RPCs as-built

La upload queue es **at-least-once**: una RPC puede ejecutarse server-side y perderse el ACK (red cae justo después del COMMIT). PowerSync, al no recibir el OK, **reintenta la misma CrudEntry** del `op_intent` → sin protección, eso sería **dos partos, dos bajas, dos animales**.

Mecanismo base: cada intención lleva un **`client_op_id`** (el `id` de la fila `op_intents`, uuid de cliente, estable entre reintentos). El modo de dedup se decidió **por op, leyendo la definición real de cada RPC**:

**(1) `register_birth` — dedup EXPLÍCITA por `client_op_id` → SÍ necesita el delta.**
Evidencia (`supabase/migrations/0045_birth_calves.sql`): la RPC
```sql
insert into public.reproductive_events (animal_profile_id, event_type, event_date)
values (p_mother_profile_id, 'birth', p_event_date) returning id into v_birth_event_id;   -- id SERVER-SIDE
...
insert into public.animals (...) returning id into v_calf_animal_id;                        -- id SERVER-SIDE
insert into public.animal_profiles (...) returning id into v_calf_profile_id;               -- id SERVER-SIDE
insert into public.birth_calves (birth_event_id, calf_profile_id) values (...);
```
crea el evento de parto **y los N terneros con ids generados server-side** (`returning id into ...`), NO con ids de cliente. **No hay ningún id de cliente que dedupee** → un reintento crearía un SEGUNDO parto + N terneros nuevos. Por eso `register_birth` necesita la dedup explícita:
- **Delta (R11.3, aprobado Puerta 1)**: columna `client_op_id uuid` (nullable) en `reproductive_events` + índice **UNIQUE parcial COMPUESTO** `... (animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` + param `p_client_op_id uuid default null` en `register_birth`.
- **Tenencia de `reproductive_events` (verificado contra `0026_reproductive_events.sql`)**: la tabla **NO tiene `establishment_id` denormalizado** — el tenant se deriva **vía el `animal_profile`** de la madre (`establishment_of_profile(animal_profile_id)`; así lo hace la RLS `reproductive_events_select`/`_insert`, `0026:63-66`). Por eso el scoping del lookup de idempotencia se ancla en `animal_profile_id` (la madre) y, vía JOIN a `animal_profiles`, en su `establishment_id` (= el `v_est` que `register_birth` ya derivó y autorizó de la fila REAL de la madre, `0045:213-225`).

- **⚠️ Cuerpo del guard (CRÍTICO — fix HIGH-D1 del Gate 1 del delta, 2026-06-08). El implementer NO debe escribir el guard "literal" de la versión previa de esta spec — saldría VULNERABLE (IDOR cross-tenant).** El guard de idempotencia es un **path de LECTURA del parto existente** y, como tal, exige authz + scoping de tenancy. Reglas, en este orden:
  1. **La authz as-built rige SIEMPRE y va PRIMERO.** `register_birth` deriva `v_est` de la fila REAL de la madre que el caller pasó (`p_mother_profile_id`) y exige `has_role_in(v_est)` ANTES de cualquier rama (`0045:213-225`, errcode 42501). El guard de idempotencia corre **después** de pasado ese gate. (Pero "authz antes del guard" por sí solo NO alcanza: ese `has_role_in` valida sobre la madre que el caller PASÓ, no sobre la madre del parto EXISTENTE que el lookup encontraría — ver punto 3.)
  2. **El lookup de idempotencia está SCOPEADO al caller, NO es un lookup global por `client_op_id`.** El parto existente solo se considera "el mismo" (no-op legítimo) si pertenece a la **misma madre que el intent** (`animal_profile_id = p_mother_profile_id`) **y** al **tenant ya autorizado** (`animal_profiles.establishment_id = v_est`, derivado por JOIN). Pseudo-SQL (especificación, NO la migración real):
     ```sql
     -- dentro de register_birth, DESPUÉS de resolver v_est y validar has_role_in(v_est):
     if p_client_op_id is not null then
       select re.id into v_existing
       from public.reproductive_events re
       join public.animal_profiles p on p.id = re.animal_profile_id
       where re.client_op_id    = p_client_op_id
         and re.animal_profile_id = p_mother_profile_id   -- mismo parto/misma madre que el intent
         and p.establishment_id   = v_est                 -- y del tenant ya autorizado (has_role_in pasado)
         and re.deleted_at is null;
       if v_existing is not null then
         return v_existing;        -- no-op idempotente LEGÍTIMO (mismo caller, mismo parto)
       end if;
       -- si llega acá: o no existe ningún parto con ese client_op_id para ESTE caller, o
       -- existe uno con ese client_op_id pero apunta a otra madre/otro tenant (colisión ajena).
     end if;
     -- camino normal de creación (persistir client_op_id en el reproductive_events insertado).
     ```
  3. **NUNCA devolver datos de una fila fuera del scope del caller.** Si existe una fila con ese `client_op_id` pero NO matchea el scope (`animal_profile_id`/`establishment_id` distinto = colisión con un parto AJENO, p.ej. replay de un `client_op_id` observado), el guard **no devuelve el `id`/datos ajenos**: cae al camino de creación, donde el INSERT del `client_op_id` choca contra el índice UNIQUE → la RPC levanta un **error genérico** (`unique_violation` / `23505`), uniforme con cualquier otro fallo, **sin** filtrar que la fila ajena existe ni de quién es (no dar un oráculo de enumeración, E4). `uploadData` (§5.4.4) lo mapea como **rechazo permanente** → rollback del overlay + superficia, sin leak.
  4. **Por qué el índice COMPUESTO `(animal_profile_id, client_op_id)` (no global) es la forma más limpia.** Un índice global `(client_op_id)` deja un oráculo residual de existencia (E4): el INSERT de un `client_op_id` ajeno colisiona → `unique_violation` con timing/errcode observable. Con el índice **compuesto por la madre del caller**, el INSERT del atacante usa SU `animal_profile_id` (de su propio campo) → **nunca colisiona** con la fila de otro tenant (la unicidad es por `(madre, client_op_id)`, no global) → el oráculo de existencia cross-tenant **desaparece** y la fila ajena ni se toca. El compuesto es **estrictamente mejor** que el global aquí: cierra el mismo doble-apply legítimo (un reintento del MISMO caller reusa la misma madre + el mismo `client_op_id` → colisiona consigo mismo, no re-crea) sin abrir el oráculo cross-tenant. **El guard procedural de los puntos 1–3 es el requisito MÍNIMO (cierra el leak de DATOS); el índice compuesto es la forma que además cierra el oráculo de existencia.** Recomendación de esta spec: **índice compuesto `(animal_profile_id, client_op_id)` + guard procedural scopeado** (ambos; ver §9-nota y la nota de seguridad de §7-bis).
- **Path online intacto**: hoy `register_birth` se invoca sin `p_client_op_id` → `default null` → el guard no aplica → comportamiento **idéntico** al as-built. El índice UNIQUE es **parcial** (`WHERE client_op_id IS NOT NULL`) → no impone unicidad sobre los partos online históricos (todos con `client_op_id` NULL).
- **Firma + grants (recordatorio para el implementer, NO lo escribe el spec_author)**: agregar `p_client_op_id uuid default null` cambia la firma a `register_birth(uuid, date, jsonb, uuid)`. La migración del delta debe re-emitir el `revoke/grant` con la **firma tipada completa nueva** + `notify pgrst, 'reload schema'` (mismo patrón que `0045:297-300`), y mantener el `default null` para que el call online de 3 args siga resolviendo. Gate 1 (R11.4) verifica que la superficie RPC concedida sigue siendo `authenticated` y nada más, **y que el cuerpo del guard implementa el scoping de tenancy de los puntos 1–3 (no el guard global)**.

**(2) `exit_animal_profile` — dedup NATURAL por la guarda de status → NO necesita delta.**
Evidencia (`supabase/migrations/0044_exit_reason_enum.sql`): la RPC es una **transición de status**, no un insert con side-effects:
```sql
select establishment_id, created_by into v_est, v_creator
from public.animal_profiles where id = p_profile_id and deleted_at is null;   -- la baja NO setea deleted_at
...
update public.animal_profiles
   set status = p_status, exit_reason = p_exit_reason, exit_date = p_exit_date,
       exit_weight = coalesce(...), exit_price = coalesce(...)
 where id = p_profile_id;                                                       -- WHERE id = ... (no WHERE status='active')
-- deleted_at queda NULL: NO es soft-delete.
```
Análisis del reintento: la baja **no setea `deleted_at`** (queda NULL) → en el reintento el `SELECT ... WHERE id = p_profile_id AND deleted_at IS NULL` **vuelve a encontrar** la fila → re-pasa la authz (`has_role_in AND (owner OR created_by)`) → re-corre el mismo UPDATE de status. Como `status`/`exit_reason`/`exit_date` ya tienen los valores de la 1ra pasada, el segundo UPDATE deja el **mismo end-state** (idempotente). **No hay segundo efecto**: el UPDATE toca `status, exit_reason, exit_date, exit_weight, exit_price` pero **NO `category_id`**, así que el trigger `animal_profiles_record_category_change_upd` (AFTER UPDATE **OF category_id**, `0030_animal_category_history.sql:52-54`) NO dispara → no se inserta una 2da fila en `animal_category_history`. No hay otro trigger AFTER sobre `animal_profiles` que produzca un side-effect no idempotente en un cambio de status. **Conclusión: `exit_animal_profile` es naturalmente idempotente por la guarda `deleted_at IS NULL` + la transición de status idempotente → SIN `client_op_id`, SIN delta** (delta más chico — solo `register_birth`).

**(3) `create_animal` (alta) — dedup NATURAL por `id` de cliente → NO necesita `p_client_op_id`.**
Evidencia (`app/src/services/animals.ts`): `createAnimal` genera `animalId = randomUuid()` y `profileId = randomUuid()` en el cliente. La intención `create_animal` reusa esos ids de cliente. Reintentar con el mismo `id` → `ON CONFLICT (id) DO NOTHING` → no crea un segundo animal. **As-built (Run create-animal-rpc, 2026-06-10): la dedup se materializa en la RPC atómica `create_animal` (0083)** — el "SIN delta" original quedó parcialmente supersedido: sigue sin haber delta de SCHEMA (ni columna ni índice nuevos), pero SÍ se agregó la RPC (delta aditivo tipo 0081/0082) porque los 2 upserts no atómicos del Run T6 perdían el alta bajo reintento (ver la nota de §5.4.2). El replay de la RPC es un no-op 2xx (no produce error → no necesita rama `idempotent_discard` en el cliente) y además SANA el half-state del camino viejo.

**(4) `soft_delete_*` — dedup NATURAL por la guarda `deleted_at IS NULL` → NO necesita delta.**
Evidencia (`supabase/migrations/0041_soft_delete_rpcs.sql`): cada `soft_delete_*` hace `select ... where id = ... and deleted_at is null` y luego `update ... set deleted_at = now() where id = ...`. En el reintento la fila ya tiene `deleted_at IS NOT NULL` → el SELECT no la encuentra → la RPC **levanta `not found`** (`P0002`). Eso NO crea un segundo borrado (no hay segundo efecto), pero **NO es un 2xx**. **Manejo en `uploadData` (§5.4.4)**: un `P0002` (`not found`) sobre una intención `soft_delete_*` cuyo efecto YA está aplicado se trata como **éxito idempotente** — descartar la intención **sin** rollback del overlay (la baja real ya ocurrió server-side) — NO como rechazo permanente que dispararía un rollback erróneo (restauraría una fila que sí está borrada). SIN delta.

> **Resumen del alcance del delta (R11.3/R11.4):** **una sola tabla, una sola RPC** → `reproductive_events.client_op_id` (nullable) + índice **UNIQUE parcial COMPUESTO `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL`** + `register_birth(..., p_client_op_id default null)` con el **guard de idempotencia scopeado al tenant del caller** (fix HIGH-D1: scoping `animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est` + error genérico ante colisión ajena, nunca devolver datos ajenos — ver el cuerpo del guard arriba). Es el delta **mínimo**. `exit_animal_profile`, `create_animal` y `soft_delete_*` son dedup-natural y NO tocan el schema. El delta es **aditivo y schema-sensitive → Gate 1 (spec) antes de implementar** (R11.4); el path online queda idéntico (param con default null, índice parcial). El spec_author NO escribe la migración: la escribe el implementer (≥ `0075`) por Management API, gateada por el leader. **El implementer NO debe escribir el guard "literal" (lookup global por `client_op_id`): saldría vulnerable a IDOR cross-tenant — debe implementar el scoping de tenancy de §5.4.3(1).**

#### 5.4.4 Rollback del estado optimista (R6.11) + manejo de errores

```
async uploadData(database) {
  const tx = await database.getNextCrudTransaction();
  if (!tx) return;
  try {
    for (const op of tx.crud) { /* §5.4.1 + §5.4.2 */ }
    await tx.complete();                          // ACK → la CrudEntry sale de la cola atómicamente
  } catch (err) {
    if (isTransient(err)) throw err;              // R3.4/R6.9: deja la tx en cola → reintento (NO rollback)
    if (isIdempotentNoop(err, op)) {              // P0002 de un soft_delete_* ya aplicado (§5.4.3)
      await tx.complete();                        // descarta la intención SIN rollback (el efecto real ya ocurrió)
      await clearOverlay(op.id);                  // limpia el overlay local-only (R6.11): la baja real bajará por la stream
      return;
    }
    await rollbackOverlay(tx);                    // R6.11: rechazo permanente → borra el overlay local-only de esta tx
    await tx.complete();                          // R3.5/R8.1: descarta la op (no loop infinito)
    surfaceRejection(err);                        // R10.2: registro observable del rechazo
  }
}
```

**No doble-upload por construcción (R6.12).** Como el efecto optimista vive en el overlay `localOnly` (§5.3.3) que **NO genera CrudEntry**, la **única** CrudEntry que `uploadData()` ve para una op (b) es su `op_intent` (`insertOnly`). No hay un INSERT/UPDATE plano paralelo de las tablas sincronizadas que la RPC va a (re)crear → la RPC corre **una sola vez**. Esto cierra el hueco double-upload: ya no hace falta detectar/suprimir CrudEntries planos cubiertos por un intent (no existen).

- **ACK (éxito, R6.11)**: `tx.complete()` saca el `op_intent` de la cola; el helper limpia el overlay local-only de ese `client_op_id` (`clearOverlay(op.id)`). Las filas **reales** (con sus ids — server-side para `register_birth`, los de cliente para `create_animal`) bajan por la sync stream y aparecen en las tablas sincronizadas. El UNION de lectura deja de mostrar el overlay y muestra la fila real → sin duplicado, sin parpadeo de id.
- **Transitorio** (red caída, 5xx): re-throw → la tx queda en cola, PowerSync reintenta. **NO se borra** el overlay (la op sigue "en vuelo"; la UI muestra el efecto como pendiente). R3.4/R6.9/R6.11.
- **Permanente** (RLS 42501, constraint, error de dominio de la RPC): `rollbackOverlay(tx)` borra del overlay local-only las filas `pending_*` con el `client_op_id` de esa intención, `tx.complete()` descarta la intención de la cola (no loop, R3.5/R8.1), y `surfaceRejection` lo deja observable (R10.2). La UI vuelve al estado pre-op (el ternero/alta desaparece del UNION; la baja/soft-delete se "des-oculta"). **Como nada se escribió en tablas sincronizadas, no hay residuo server ni huérfanos** (la RPC rechazó toda la op atómicamente).
- **Idempotente no-op (`soft_delete_*` reintentado, §5.4.3)**: si la RPC levanta `P0002` (`not found`) porque la fila YA está soft-deleteada (el efecto real ocurrió en una pasada previa cuyo ACK se perdió), `isIdempotentNoop` lo detecta → se descarta la intención **sin rollback** y se limpia el overlay (la baja real bajará/ya bajó por la stream). NO se trata como rechazo permanente (un rollback acá restauraría una fila que sí está borrada).
- **R8.1** (`active_lost`): si la RPC pertenece a un campo donde el usuario perdió el rol, la RPC devuelve 42501 → `isTransient` = false y `isIdempotentNoop` = false → rollback del overlay + descarte + superficia. Mismo camino que el CRUD plano.
- **`rollbackOverlay`/`clearOverlay`** operan sobre el DB local (PowerSync expone ejecución local) y solo tocan las tablas `localOnly` (`pending_*`), identificando las filas por `client_op_id`. **Nunca** borran filas de tablas sincronizadas (no hay filas optimistas ahí). Esto simplifica el rollback respecto del diseño previo: no hay que distinguir "fila optimista que ya generó su CrudEntry plano" (ya no existe ese caso) ni cuidar huérfanos cross-tabla — el `create_animal`/`register_birth` se aplica atómicamente por su RPC y el overlay es la única cosa local a revertir.

---

## 6. Env nuevo `EXPO_PUBLIC_POWERSYNC_URL` (R1.2/R1.3)

`app/src/utils/env.ts` — extender `RequiredEnv` y `getEnv()`:

```ts
type RequiredEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  powersyncUrl: string;          // NUEVO
};

export function getEnv(): RequiredEnv {
  const supabaseUrl    = readPublicEnv('EXPO_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey= readPublicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const powersyncUrl   = readPublicEnv('EXPO_PUBLIC_POWERSYNC_URL');
  if (!supabaseUrl || !supabaseAnonKey || !powersyncUrl) {
    throw new Error('Faltan variables de entorno EXPO_PUBLIC_SUPABASE_URL, '
      + 'EXPO_PUBLIC_SUPABASE_ANON_KEY o EXPO_PUBLIC_POWERSYNC_URL. Revisá .env.local en la raíz.');
  }
  return { supabaseUrl, supabaseAnonKey, powersyncUrl };
}
```

> Solo se **especifica** el env (no se implementa acá; lo hace el implementer tras Puerta 1). El valor de la URL lo tiene Raf (provisioning, R1.1). `.env.local` se agrega a `.env.example` con un placeholder.

---

## 7. Seguridad (explícito — Gate 1)

- **Frontera WAL**: las streams replican la **tabla base** por el WAL, ignorando views/RPCs/column-GRANTs (ADR-025). Por eso `user_private` se filtra self-only **en la query de la stream** (`self_user_private`), no por una view ni por la RLS. Como `0068` ya dropeó `email`/`phone` de `public.users`, la stream `est_members` puede traer la fila `users` completa sin filtrar PII (la PII no vive ahí). Esta es la combinación que cierra la PII en TODOS los canales.
- **No-bypass por device**: el device recibe **exactamente** lo que su `auth.user_id()` resuelve en las streams. No hay un canal alterno (la app no hace PostgREST directo para lo sincronizado). Un device manipulado no puede "pedir más": la instancia solo le envía su sync set. (R9.1)
- **Espejo de RLS (predicado canónico)**: cada predicado de stream replica la lógica de la RLS as-built (`has_role_in` inline, `establishment_of_profile` inline). El scope per-establishment NO es el bare `user_roles WHERE active = true`: replica el JOIN de `has_role_in` (0005:16-24) — `JOIN establishments ... AND establishments.deleted_at IS NULL` — para que un establecimiento **soft-deleteado** salga del sync set por la stream (no solo por el cierre de PostgREST). Esto es lo que fixea **HIGH-1** de Gate 1 (2026-06-08): sin el filtro de campo vivo, como NO hay trigger que desactive `user_roles` al soft-deletear un campo, la stream sería más permisiva que la RLS y dejaría leak por el WAL tras borrar un campo. **⚠️ Tras la reescritura `with:`/JOIN (2026-06-08, §2/§2.2): el predicado canónico se REPARTE — la parte "rol activo" vive en la CTE `org_scope`/`owner_scope` (`with:`), la parte "campo vivo" (`establishments.deleted_at IS NULL`) vive en el `INNER JOIN establishments` de cada DATA QUERY.** La frontera de autorización es IDÉNTICA al patrón canónico inline anterior (HIGH-1 sigue cerrado); solo cambió la ESTRUCTURA del SQL (motivo: límite de buckets #611). El predicado canónico, así repartido, se aplica **idéntico** en las 22 streams per-establishment (incluidas las derivadas vía perfil/rodeo/evento de parto). Ver §2.3-equivalencia (tabla viejo→nuevo) y §2.2 (por qué el campo-vivo va a nivel data query y no en la CTE). Para `est_members`, además, la query de la **matriz de roles de coworkers** se gatea a **owner + `active = true`** para espejar `user_roles_select` (0008:11-17, owner-only para roles ajenos vía `is_owner_of`) — fix de **MED-1**; la query de nombres (`users`) NO se gatea (todos los miembros ven los nombres, sin PII). `est_invitations` ya estaba gateada a `role='owner' + status='pending'`; solo heredó el predicado canónico (fix de **MED-2**). Gate 1 debe verificar la **equivalencia** stream↔RLS para cada tabla (que la stream no sea más permisiva que la policy de SELECT); con el predicado canónico + el owner-gating de roles, la equivalencia se cumple.
- **Upload re-validado server-side**: el `uploadData` aplica las mutaciones por PostgREST → RLS + triggers + CHECKs (R6.2). El device NO bypassa: el upload tiene los mismos controles que un cliente normal. La cola con ops rechazadas se descarta (R8.1), no escala privilegios.
- **Tests de no-bypass (R9.2)**: espejo de los runners RLS existentes (`supabase/tests/rls/`), pero validando el **contenido del sync set** por usuario (un usuario A no recibe filas del establecimiento de B; `user_private` de B no llega a A). Se ejecutan como integración Node contra la DB remota + la instancia (o simulando la query de la stream contra Postgres con el `user_id` de cada actor). **Caso obligatorio agregado por HIGH-1**: tras soft-deletear un establecimiento (UPDATE `deleted_at = now()`), un owner de ESE campo deja de recibir TODAS sus filas (animales, perfiles, eventos, sesiones, lotes, invitaciones, roles de coworkers) por el sync set — espeja R8.2.
- **Recordatorios para Gate 1 modo `code` (Gate 2) — NO se implementan en esta spec, quedan anotados**:
  - El `LIKE '%term%'` local del buscador (degradación del fuzzy, §5.1) DEBE pasar el término del usuario como **bind param** (`db.getAll(sql, [param])` / `db.watch(sql, params)`), NUNCA por template-string interpolado en el SQL. El SQLite local opera sobre datos ya autorizados por la stream (no hay escalada de datos por el `LIKE`), pero el bind param es obligatorio contra injection. Gate 2 verifica que ningún `db.getAll`/`db.watch` concatene el término.
  - **Post-MVP (nota, NO en esta spec)**: considerar un ADR de hardening del device — la SQLite local guarda el dataset completo del campo offline → debería estar **encriptada at-rest** + el token en **SecureStore** (no AsyncStorage). No es finding de esta spec (se hereda de ADR-002/PowerSync), pero conviene un ADR de hardening.

---

## 7-bis. Seguridad del write-path opción (ii) — outbox + RPC (Puerta 1)

> Foco de **Gate 2 (code)**, no de Gate 1: la opción (ii) NO cambia las sync streams (la frontera de read-authz). El PASS de Gate 1 sobre las streams (§2, fix-loop 2026-06-08) **se mantiene intacto**.

- **Las RPCs re-validan authz server-side igual que online.** El drenado de la outbox llama `supabase.rpc('register_birth' | 'exit_animal_profile' | 'soft_delete_*' | 'create_animal', ...)` con el **mismo JWT** del usuario (el `access_token` de la sesión Supabase). Cada RPC SECURITY DEFINER aplica sus guardas as-built (`has_role_in`, `is_owner_of`, `owner OR created_by`) sobre `auth.uid()` — exactamente como cuando se invoca online. **Un intent forjado cross-tenant** (un device manipulado encola una intención con un `establishment_id`/`animal_profile_id` de otro campo) **lo rechaza la RPC** server-side (42501 / error de dominio) → `uploadData` lo trata como permanente → rollback + descarte + superficia (R8.1). La outbox NO escala privilegios: es solo una cola de invocaciones que el server autoriza igual que cualquier cliente.
- **La outbox y el overlay son write-side / local-only, NO sincronizados.** `op_intents` (`insertOnly`) genera CrudEntry pero no replica fila; las tablas `pending_*` (`localOnly`) ni siquiera generan CrudEntry. Ninguna existe como tabla server, ninguna está en una sync stream → **sin superficie de stream/RLS/WAL**. No hay forma de que un coworker reciba las intenciones ni el overlay de otro. No hay PII en ninguna de las dos (solo op_type + params + client_op_id; el overlay espeja datos del propio campo que el usuario ya está autorizado a ver).
- **Idempotencia = control de integridad, no de autorización.** El `client_op_id` (§5.4.3) evita el **doble-apply** (dos partos) ante el reintento at-least-once. Es un control de **integridad de datos**, no de tenancy: la autorización ya la garantizan las guardas de la RPC. El delta de backend aprobado (`client_op_id` nullable + índice UNIQUE parcial **compuesto** `(animal_profile_id, client_op_id)` en `reproductive_events` + param `p_client_op_id default null` en `register_birth`) **NO debilita ninguna policy** (solo agrega una columna/índice + un guard de no-op; las guardas `has_role_in` sobre la fila real de la madre quedan intactas) y **no cambia el path online** (`p_client_op_id` NULL → as-built). **Es schema-sensitive → requiere Gate 1 (`security_analyzer` modo `spec`) ANTES de implementar** (R11.4): Gate 1 confirma que el delta es estrictamente aditivo y que la authz de `register_birth` no cambia. `exit_animal_profile`/`create_animal`/`soft_delete_*` no tienen delta (dedup-natural, §5.4.3).
- **⚠️ El guard de idempotencia ES un path de lectura → exige authz + scoping de tenancy (fix HIGH-D1, Gate 1 del delta 2026-06-08).** Matiz corregido: en el path de **creación** las guardas `has_role_in` sobre la fila real de la madre quedan intactas (cierto), PERO la **rama no-op** del guard (devolver el parto existente con ese `client_op_id`) es un **path de LECTURA del parto existente** y, sin scoping, abre un **IDOR cross-tenant**: como `client_op_id` es un uuid de cliente (attacker-controlled) y un índice global `(client_op_id)` matchea cualquier tenant, un atacante autenticado podría, por replay/colisión, hacer que la rama no-op le devuelva el `id` de un parto de OTRO establecimiento por el canal RPC (paralelo a la stream). **"Authz antes del guard" NO alcanza**: el `has_role_in(v_est)` valida sobre la madre que el caller PASÓ (`p_mother_profile_id`, propia → pasa), no sobre la madre del parto EXISTENTE que el lookup devolvería. **Fix exigido por la spec (§5.4.3(1))**: la rama no-op solo corta-y-devuelve si el parto existente es del **propio caller** — lookup scopeado a `animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est` (el tenant ya autorizado; `reproductive_events` no tiene `establishment_id` propio, se deriva vía `animal_profiles`, `0026`) **+** `deleted_at IS NULL`; ante colisión con un parto ajeno (mismo `client_op_id`, otra madre/otro tenant) → **error genérico** (`unique_violation`/`23505`), **nunca** devolver el `id`/datos ajenos ni un oráculo de existencia. El índice **compuesto** `(animal_profile_id, client_op_id)` cierra además el oráculo de existencia residual (E4): el INSERT del atacante usa su propia madre → nunca colisiona con la fila ajena. Gate 1 (R11.4) debe verificar que el cuerpo del guard implementa este scoping (no el lookup global) ANTES de aplicar la migración (≥ `0075`).
- **Las sync streams (frontera de read-authz) NO cambian.** Ninguna query de §2 se tocó por la opción (ii) ni por el delta de idempotencia. Gate 1 sobre las **streams** sigue PASS; el delta de `register_birth` es una **pieza nueva** que Gate 1 audita aparte (es write-side, no read-authz). **El foco de seguridad de la opción (ii) es Gate 2 (code)**: (a) idempotencia correcta (no doble-apply, R6.10); (b) **no doble-upload** (overlay local-only → única CrudEntry = el intent, R6.12); (c) rollback del overlay correcto (no deja huérfanos ni basura local, §5.4.4); (d) manejo del `P0002` idempotente de `soft_delete_*` (no rollback erróneo); (e) outbox/overlay sin leak (no se sincronizan, no se hace `from('op_intents')` plano); (f) `params_json` y cualquier término de query local pasan por **bind params** (nunca interpolación) — mismo recordatorio que el `LIKE` del buscador (§7).

---

## 8. Estrategia de conflictos (R12.2)

- **Eventos**: append-only (insert) → sin conflicto por diseño.
- **Filas editables** (`animal_profiles`, `management_groups`, `rodeos`, `sessions`): **last-write-wins** (default de PowerSync). Suficiente para MVP (un campo, pocos operarios concurrentes).
- **Post-MVP (nota, NO se implementa)**: surfacing del conflicto en vez de pisada silenciosa; árbitro server-side rutando ediciones sensibles por RPCs SECURITY DEFINER (patrón `exit_animal_profile`); concurrencia optimista (`updated_at` + rechazo de stale). Realista para RAFAQ: capas 1+2 (context).

---

## 9. Alternativa descartada

**Sincronizar TODO por sync streams, incluida identidad/admin, y reescribir invitaciones/creación de campo como CRUD plano offline.**

- **Pro**: offline-first total, un solo camino de datos.
- **Contra**: reescribiría flujos ya cerrados y gateados (auth, invitaciones bearer ADR-014, creación de establecimiento con auto-owner trigger, aceptación vía Edge Function). La invitación NO se puede aceptar offline (necesita validar el token bearer server-side y crear el `user_role` con auto-owner). La PII (`user_private`) y la creación de campo tienen reglas que viven en EF/triggers, no expresables como CRUD plano seguro. **Rechazada**: el riesgo de romper auth/multi-tenancy no compensa; el offline-first importa donde está el peón sin señal (camino de campo), no en la administración (D1 del context). Es exactamente la frontera que traza Gate 0.

**Alternativa descartada en la Puerta 1 — dejar las (b) RPC-bound ONLINE (opción i).**

- **Pro**: cero superficie de bug nueva en el cliente (no hay outbox, ni mapeo a RPC en `uploadData`, ni idempotencia que diseñar, ni rollback optimista). El parto/baja/borrado/alta serían el camino online ya gateado de las features 02/12.
- **Contra**: **rompe el offline-first justo donde más importa**. El alta de animal (find-or-create) y el parto al destete son **camino de manga** — el peón los hace sin señal. Forzarlos online significa que en el corral sin cobertura no se puede dar de alta un ternero ni registrar un parto, que es exactamente el escenario que justifica PowerSync. El soft-delete offline (corregir un error de carga en el campo) también se frena.
- **Veredicto (Puerta 1, 2026-06-08)**: **RECHAZADA para parto/baja/soft-delete/alta** — Raf eligió la **opción (ii)** (offline vía outbox + RPC-mapping, §5.3/§5.4). La opción (i) **subsiste solo para `import_rodeo_bulk`** (onboarding masivo, no manga: encolar miles de filas offline es impráctico y la feature 12 ya lo define online). El costo de la opción (ii) — outbox + idempotencia + rollback — se asume y su corrección se valida en **Gate 2** (no afecta las streams ni Gate 1).

**Alternativa NO tomada (diferida) — Opción 2: trigger que desactive `user_roles.active` al soft-deletear un establecimiento (en vez del JOIN a `establishments` en cada data query).**

> Surgió al reescribir las streams al patrón `with:`/JOIN (2026-06-08). NO se implementa en esta iteración; se documenta como **alternativa más limpia a evaluar después**.

- **Qué sería**: un trigger `AFTER UPDATE OF deleted_at ON establishments` que, cuando un campo se soft-deletea (`deleted_at` pasa de NULL a NOT NULL), haga `UPDATE user_roles SET active = false, deactivated_at = now() WHERE establishment_id = <ese campo> AND active = true`. Con eso, **`org_scope`/`owner_scope` quedarían limpios sin necesidad del JOIN a `establishments`** en cada data query (un rol activo ya implicaría campo vivo), porque ya NO existiría el caso "rol activo apuntando a campo muerto" (la raíz del fix HIGH-1).
- **Pro**:
  - **YAML más simple + menos buckets**: las ~22 streams per-establishment dejarían de necesitar el `INNER JOIN establishments` (salvo donde se quiera el `deleted_at` por defensa). `org_scope` por sí solo bastaría para el scope completo. Menos JOINs = menos superficie de sintaxis (cierra varias de las incertidumbres §2.2-incertidumbres, incl. los 3 JOINs de `ev_birth_calves`).
  - **Probablemente cierra un leak EQUIVALENTE en la RLS as-built**: hoy `has_role_in` (`0005:16-24`) compensa la falta del trigger con su propio `JOIN establishments e ... AND e.deleted_at IS NULL`. Pero **cualquier path que mire `user_roles.active` sin replicar ese JOIN** (si existiera alguno en services/RPCs/checks) tendría el mismo hueco que tenían las streams pre-HIGH-1. El trigger lo cerraría **en la fuente** (el invariante "rol activo ⟹ campo vivo" pasaría a ser cierto a nivel dato, no solo a nivel cada-query-que-se-acuerde-del-JOIN).
- **Contra / por qué se difiere**:
  - **Toca el backend** (un trigger nuevo) → fuera del scope de ESTA iteración (el prompt restringe a SINTAXIS de streams; nada de triggers/migraciones — esa es justamente la "Opción 2" que NO se toma acá).
  - **Requiere análisis de impacto en la RLS**: `has_role_in`/`is_owner_of` ya filtran `e.deleted_at IS NULL`, así que el trigger sería **redundante** con ellas (no rompería nada, pero hay que verificar que ninguna policy/cron/flujo dependa de que un `user_role` siga `active` tras soft-deletear el campo — p.ej. para "reactivar" un campo restaurándolo: hoy el rol sigue activo y al des-soft-deletear el campo vuelve a verse; con el trigger habría que reactivar el rol explícitamente). Es un cambio de semántica de `user_roles.active` que merece su propio Gate 1 + migración.
  - **No es bloqueante**: el patrón `with:`/JOIN actual ya preserva la frontera correctamente (HIGH-1 cerrado). El trigger es una **simplificación**, no una corrección.
- **Veredicto (2026-06-08)**: **diferida**. Se mantiene el patrón `with:`/JOIN (campo vivo filtrado a nivel data query). Si más adelante se evalúa, requiere: (1) análisis del impacto en `has_role_in`/`is_owner_of` y en cualquier consumidor de `user_roles.active`, (2) Gate 1 (spec) del trigger, (3) migración del trigger, (4) simplificación de las streams (quitar el JOIN a `establishments` donde el trigger lo vuelva redundante). Anotada acá como decisión diferida; NO en backlog de esta feature.
- **RECONCILIADO (Run 4, 2026-06-09) — la Opción 2 SE TOMÓ, en DOS mitades, como `0076`.** El invariante "`user_roles.active = true` ⇒ campo vivo (`deleted_at IS NULL`)" se cierra a nivel DB con DOS triggers en `0076`:
  - **(a) deactivate-on-delete** — `deactivate_roles_on_establishment_soft_delete` (`AFTER UPDATE OF deleted_at ON establishments`): la mitad descrita arriba (desactiva los roles EXISTENTES al borrar el campo) + backfill.
  - **(b) block-activate-for-deleted (GUARD)** — `prevent_active_role_on_soft_deleted_establishment` (`BEFORE INSERT OR UPDATE OF active ON user_roles`): cierra el hueco que (a) NO cubre — CREAR/activar un rol NUEVO para un campo YA borrado. Vector verificado (HIGH-1 reabierto por el re-análisis): `accept_invitation` (`supabase/functions/accept_invitation/index.ts:93-101`) inserta `active:true` sin chequear `establishments.deleted_at`; timeline owner-invita → owner-borra-el-campo → invitado-acepta-el-link-pendiente → quedaría un rol activo sobre un campo muerto → el sync JOIN-free le replicaría la data del campo borrado. El guard lo rechaza con `errcode 23514` (check_violation — violación de INVARIANTE de estado, NO negación de privilegio 42501; misma clase que el guard de estado de `soft_delete_rodeo` 0041). `active = false` SIEMPRE permitido (sale temprano) → NO rompe el deactivate (a) ni la remoción de miembros. Compat verificada: creación de campo (`handle_new_establishment` 0011, campo nuevo deleted_at NULL → permitido), aceptar invitación a campo VIVO → permitido, el fix R8.3/R8.4 (restore `deleted_at=null` ANTES de reactivar `active=true` → permitido). El INNER JOIN a `establishments` de las data queries se MANTIENE como defensa-en-profundidad (cierra la ventana de carrera soft-delete↔WAL); ya no estrictamente necesario para correctitud, pero barato y seguro.

### 9-nota — Forma del índice del delta: GLOBAL `(client_op_id)` (descartada) vs COMPUESTO `(animal_profile_id, client_op_id)` (elegida) — fix HIGH-D1

> El Gate 1 del delta (HIGH-D1) pidió considerar explícitamente si el UNIQUE debe ser **compuesto/scopeado** en vez de global, y recomendar la opción más simple y segura. Decisión:

- **Índice GLOBAL `(client_op_id) WHERE client_op_id IS NOT NULL` (descartada como forma única).** Pro: trivial. Contra: aunque NO es por sí solo el vector de leak (el leak de DATOS lo cierra el guard procedural scopeado, §5.4.3(1)), deja un **oráculo de existencia residual (E4)**: el INSERT de un `client_op_id` ajeno colisiona globalmente → `unique_violation` con timing/errcode observable → un atacante podría confirmar si un `client_op_id` existe en *algún* tenant. Information disclosure débil (un uuid de cliente ajeno no es secreto útil y el espacio uuid hace la colisión/adivinación impráctica), pero evitable.
- **Índice COMPUESTO `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` (ELEGIDA).** Cierra el doble-apply legítimo igual de bien (un reintento del MISMO caller reusa su misma madre + el mismo `client_op_id` → colisiona consigo mismo → no re-crea) **y además** elimina el oráculo cross-tenant: el INSERT del atacante usa SU `animal_profile_id` (de su propio campo) → la unicidad es por `(madre, client_op_id)` → **nunca colisiona** con la fila de otro tenant. Como `reproductive_events` no tiene `establishment_id` denormalizado (`0026`), `animal_profile_id` es el ancla de tenancy natural (deriva el establecimiento vía `animal_profiles`).
- **El guard procedural scopeado (§5.4.3(1)) es el requisito MÍNIMO y NO opcional.** El índice (sea cual sea su forma) controla solo la *colisión de INSERT*, no el *lookup/return* de la rama no-op. El leak de DATOS de HIGH-D1 está en la rama no-op (devolver el `id`/datos del parto existente) → solo se cierra con el lookup scopeado al caller (`animal_profile_id = p_mother_profile_id AND animal_profiles.establishment_id = v_est` + no devolver ajeno). **Por eso el guard procedural va SIEMPRE**; el índice compuesto es la **defensa-en-profundidad** que además cierra el oráculo E4.
- **Recomendación (la más simple y segura combinada):** **índice compuesto `(animal_profile_id, client_op_id)` + guard procedural scopeado**. No es más caro de implementar que el global (una columna extra en el `create unique index`) y cierra tanto el leak de datos (guard) como el oráculo de existencia (índice).

---

## 10. Notas de reconciliación (regla dura)

Si durante la implementación (autorrevisión del implementer, FAIL de Gate 1/2, decisión de gate) cambia el scoping de una stream, la clase de una tabla, el mecanismo de PK sintético, la frontera offline/online de una mutación, **el mecanismo de outbox/idempotencia/rollback (§5.3/§5.4) o el delta de backend de idempotencia**, se reconcilia **acá** (design) y bajo el `R<n>` afectado de `requirements.md` ANTES de cerrar. Las streams son la frontera de autorización: un fix de Gate 1 sobre un WHERE se refleja en §2 y en el `R4.x` correspondiente. Un fix de Gate 2 sobre la idempotencia/rollback se refleja en §5.4 y en R6.10/R6.11.

### Entradas

- **2026-06-08 — Fix-loop de Gate 1 (`security_analyzer` modo `spec`) — FAIL → corregido.** El reporte (`progress/security_spec_15-powersync.md`) marcó 1 HIGH + 2 MED, todos sobre el subselect de scoping de §2. Reconciliado:
  - **HIGH-1** (bloqueante): el subselect de scoping per-establishment usaba el bare `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`, que NO replica el `JOIN establishments e ... AND e.deleted_at IS NULL` de `has_role_in` (0005:16-24). Como no hay trigger que desactive `user_roles` al soft-deletear un campo, la stream era más permisiva que la RLS → leak por el WAL tras borrar un campo (rompe stream ≤ RLS). **Fix**: reemplazado el subselect por el **predicado canónico** (`FROM user_roles ur JOIN establishments e ON e.id = ur.establishment_id WHERE ur.user_id = auth.user_id() AND ur.active = true AND e.deleted_at IS NULL`) en **TODAS** las ~20 streams per-establishment de §2, incluidas las derivadas vía perfil/rodeo/evento de parto: `est_establishments`, `est_members` (ambas queries), `est_invitations`, `est_rodeos`, `est_rodeo_data_config`, `est_management_groups`, `est_animal_profiles`, `est_animals`, `est_animal_category_history`, `est_sessions`, `est_maneuver_presets`, `est_semen_registry`, `ev_weight_events`, `ev_reproductive_events`, `ev_sanitary_events`, `ev_condition_score_events`, `ev_lab_samples`, `ev_animal_events`, `ev_birth_calves`. Las streams que ya filtraban `deleted_at IS NULL` de su PROPIA tabla mantienen ese filtro y AHORA agregan el de `establishments` en el subselect. Reflejado en `requirements.md` R4.1 (predicado canónico explícito), R4.2 y R8.2.
  - **MED-1** (`est_members`): la 2da query (`user_roles` de coworkers) bajaba roles de cualquier coworker a cualquier rol (incl. inactivos), más permisivo que `user_roles_select` (0008:11-17, owner-only para roles ajenos). **Fix (default seguro = espejar RLS)**: gateada a **owner** (`me.role = 'owner'`) + `active = true` en el outer select. La query de `users` (nombres) NO se gateó (todos los miembros ven los nombres; el propio rol llega por `self_user_roles`). Nota dejada en §2 (junto a `est_members`) y en "Decisiones abiertas para la Puerta 1" de `requirements.md`: si se quiere que un `field_operator` vea la matriz de roles offline, hay que cambiar JUNTAS la RLS `user_roles_select` y la stream.
  - **MED-2** (`est_invitations`): ya estaba bien gateada (`role='owner'` + `status='pending'` + `deleted_at IS NULL`); solo heredó el predicado canónico de HIGH-1 (JOIN a establecimientos vivos).
  - **§7** actualizada para que la afirmación de equivalencia stream↔RLS sea cierta tras el fix (menciona `establishments.deleted_at` y el owner-gating de roles) + recordatorios para Gate 2 (bind params del `LIKE`; ADR de hardening del device post-MVP).
  - **LOW-1** (re-verificación de Gate 1, anexo): la query (1) de `est_members` (nombres) no filtraba `ur.active` en su inner select → podía bajar el nombre (sin PII tras 0068) de un ex-coworker inactivo en un campo donde el usuario sí opera (over-sync acotado, sin cruce de tenant). **Folded por el leader** (2026-06-08): agregado `ur.active = true` al inner select para espejar exacto `them.active` de `users_select_coworkers` (0006). Tightening que solo quita filas → no requiere re-gate.
  - NO se tocó `feature_list.json` ni migraciones (lo hace el leader). El fix es 100 % sobre docs de la spec.

- **2026-06-08 — Puerta 1 (decisiones humanas de Raf) — 2 decisiones reconciliadas.** Sin tocar código, migraciones ni `feature_list.json`:
  - **Decisión 1 — OFFLINE vía mapeo a RPC (opción ii, NO el default online).** Raf eligió la opción (ii) de R6.7: `register_birth` (parto), `exit_animal_profile` (baja), los `soft_delete_*` (rodeo/management_group/animal_event/evento tipado) y `createAnimal` (alta find-or-create) pasan a **OFFLINE** vía una **outbox** local + mapeo a RPC en `uploadData()`. `import_rodeo_bulk` queda **ONLINE** (excepción: onboarding masivo, no manga; la feature 12 ya lo define online; encolar miles de filas offline es impráctico). Reconciliado:
    - **§5.3 reescrita** (era "mutaciones que quedan online" → ahora "OFFLINE vía outbox + RPC-mapping"): por qué necesitan RPC y no CRUD plano (§5.3.1), la outbox como tabla `insertOnly` write-side NO sincronizada que preserva R11.3 (§5.3.2), el estado optimista por op (§5.3.3).
    - **§5.4 reescrita**: drenado de la upload queue con dos caminos (CRUD plano §5.4.1 / intención→RPC §5.4.2), **idempotencia por `client_op_id` (§5.4.3, el punto crítico)** — dedup natural para `create_animal`/`soft_delete_*`, dedup explícita (delta de backend acotado: param `p_client_op_id` + columna `client_op_id UNIQUE`) para `register_birth`/`exit_animal_profile`; **tensión con R11.3 declarada** (no resuelta en esta spec; opción menos invasiva propuesta para que el leader la evalúe). **Rollback del estado optimista (§5.4.4)**: transitorio → reintento sin rollback; permanente → rollback + descarte + superficia.
    - **§1.1/§1.2** actualizadas (nuevo `outbox.ts`; `op_intents` en `schema.ts`; los 4 services pasan de online a outbox; `import-rodeo` queda online).
    - **§7-bis nueva** (seguridad del write-path opción ii): las RPCs re-validan authz server-side con el mismo JWT (intent forjado cross-tenant → rechazado); outbox local-only sin superficie de stream/RLS; **las sync streams NO cambian → Gate 1 PASS se mantiene**; foco de seguridad = Gate 2 (idempotencia, rollback, outbox sin leak).
    - **§9 reescrita**: la opción (i) "todo online" pasa a ser la **alternativa descartada** (rompe offline-first donde más importa: alta + parto son manga); la opción (ii) es la elegida; (i) subsiste solo para `import_rodeo_bulk`.
    - **requirements.md**: R6.6 reescrita (opción ii + import online), R6.7 marcada RESUELTA, **R6.8–R6.11 nuevas** (outbox, drenado vía RPC, idempotencia, optimista+rollback); mapa y "Decisiones abiertas"→"Resueltas en Puerta 1"; Gate de seguridad ampliado (foco Gate 2 del write-path); user story + Contexto actualizados.
    - **tasks.md**: T6.2 ahora primaria/requerida (outbox + RPC-mapping + idempotencia + rollback); T6.1 reducida a `import_rodeo_bulk` online; T6.4 nueva (delta de backend de idempotencia, marcado como sub-decisión del leader, NO implementar acá); T7.7–T7.9 nuevas (idempotencia no-duplica, rollback ante rechazo permanente, parto offline end-to-end).
  - **Decisión 2 — roles offline OWNER-ONLY.** Ya estaba aplicada en `est_members` (MED-1 del Gate 1, owner-gating de la matriz de roles de coworkers). NO se cambió. Solo se reconcilió el estado: la ex-"decisión abierta #4" de requirements pasó a **"Resueltas en Puerta 1: owner-only"**. La equivalencia stream↔RLS se mantiene; Gate 1 PASS intacto.
  - **Sub-decisión pendiente para el leader (NO implementada)**: el delta de backend de idempotencia (param `p_client_op_id` + `client_op_id UNIQUE` en `reproductive_events` y `animal_profiles`) tensa R11.3 ("no schema changes"). Propuesta menos invasiva en §5.4.3. El leader decide si aprueba el delta acotado o restringe el offline a las ops con dedup natural (lo cual contradiría la Decisión 1, por eso se recomienda aprobar el delta).

- **2026-06-08 — Última pasada de diseño antes de implementar (Puerta 1: delta aditivo aprobado + cierre del hueco double-upload).** Sin tocar código, migraciones reales ni `feature_list.json`:
  - **(A) Delta de idempotencia — acotado al MÍNIMO tras leer las RPCs as-built.**
    - **`exit_animal_profile` — RE-EVALUADO con evidencia → NO necesita delta.** `0044_exit_reason_enum.sql`: la RPC es una transición de status (`UPDATE animal_profiles SET status=..., exit_reason=..., exit_date=... WHERE id = p_profile_id`), **no setea `deleted_at`** (queda NULL) y **no toca `category_id`**. En el reintento, el `SELECT ... WHERE id=... AND deleted_at IS NULL` re-encuentra la fila, re-pasa la authz y re-aplica un UPDATE de status **idéntico** (mismo end-state). No dispara el trigger `animal_profiles_record_category_change_upd` (AFTER UPDATE **OF category_id**, `0030`) → sin segundo efecto. **Naturalmente idempotente → SIN `client_op_id`, SIN delta.** (Delta más chico que el propuesto en la entrada anterior.)
    - **`register_birth` — SÍ necesita el delta.** `0045_birth_calves.sql`: el evento de parto y los N terneros se crean con **ids server-side** (`returning id into ...`), no de cliente → no hay dedup natural → un reintento crearía un 2do parto. Delta = **una sola tabla**: `reproductive_events.client_op_id uuid` (nullable) + índice **UNIQUE parcial** (`WHERE client_op_id IS NOT NULL`) + param `p_client_op_id uuid default null` en `register_birth` con guard de no-op. Path online (`p_client_op_id` NULL) idéntico al as-built.
    - **`create_animal` + `soft_delete_*` — confirmado dedup-natural → SIN delta.** `create_animal`: ids de cliente (`animals.ts`, `randomUuid()`) + ON CONFLICT. `soft_delete_*` (`0041`): guarda `WHERE id=... AND deleted_at IS NULL` → reintento es no-op (levanta `P0002`, manejado como éxito idempotente).
    - **R11.3 reescrita**: de "no schema changes" a "no se modifican RLS/policies/triggers; se permite UN delta ADITIVO de idempotencia (columna nullable `client_op_id` + UNIQUE parcial + param de RPC con default null) aprobado en Puerta 1, que no cambia el comportamiento online". **R11.4 nueva**: el delta es schema-sensitive → **Gate 1 (spec) obligatorio antes de implementarlo**. Migración ≥ `0075` (as-built llega a `0074`) — la escribe/aplica el implementer por Management API, gateada por el leader; **el spec_author NO escribe migraciones**.
    - **§5.3.2, §5.4.2, §5.4.3, §7-bis** reescritas: alcance del delta = solo `register_birth`; `applyIntent` pasa `p_client_op_id` solo a `register_birth`; §5.4.3 con la evidencia por op; §7-bis marca el delta schema-sensitive (Gate 1).
  - **(B) Cierre del hueco DOUBLE-UPLOAD (correctitud, opción b).** El diseño previo escribía las filas optimistas en tablas **sincronizadas** *y además* encolaba el `op_intent` → PowerSync generaba CrudEntry para ambas → `uploadData()` aplicaría la op DOS veces (INSERT/UPDATE plano + RPC). **Resuelto con la opción (b): overlay LOCAL-ONLY.** El efecto optimista pasa a tablas `pending_*` declaradas `localOnly: true` en `AppSchema` (NO generan CrudEntry → no se suben); la **única** CrudEntry de una op (b) es su `op_intent`. Las lecturas hacen **UNION** synced + overlay pendiente; en el ACK se limpia el overlay (las filas reales bajan por la stream); en el rechazo permanente se borra el overlay (rollback sin residuo server ni huérfanos).
    - **Por qué (b) y no (a)** (suprimir CrudEntries planos en `uploadData`): (1) la opción (a) requiere correlacionar y skipear CrudEntries planos por op dentro de la misma CrudTransaction — frágil y con lógica per-op en `uploadData`; (2) **decisivo**: `register_birth` asigna ids **server-side** a los terneros (`0045`), así que filas optimistas con ids de cliente en tablas sincronizadas **nunca reconciliarían** contra las reales que bajan por la stream → duplicado permanente. Con (b), el overlay local-only se limpia en el ACK y las reales bajan limpias (sin colisión de id). La opción (b) es además el patrón canónico de PowerSync para mutaciones que no se expresan como CRUD plano (write-through-RPC + overlay local + UNION reads).
    - **§5.3.3 reescrita** (overlay `localOnly` + tabla de schema + UNION de lectura), **§5.4.4 reescrita** (ACK→clearOverlay; permanente→rollbackOverlay; `P0002` de `soft_delete_*`→éxito idempotente sin rollback), **§1.1** (tablas `pending_*` en `schema.ts`; `outbox.ts` escribe/limpia el overlay).
  - **requirements.md**: **R6.10 reescrita** (dedup por op con evidencia; delta solo `register_birth`; manejo del `P0002`), **R6.11 reescrita** (overlay local-only + UNION + clear en ACK + rollback), **R6.12 nueva** (no doble-upload), **R11.3 reescrita** + **R11.4 nueva** (delta aditivo + Gate 1). Mapa, acceptance, "Resueltas en Puerta 1" (#5 delta, #6 double-upload), Gate de seguridad e Historial actualizados.
  - **tasks.md**: T6.2a/b/e reescritas (overlay local-only `pending_*` en vez de filas en tablas sincronizadas; clear en ACK; rollback del overlay; manejo `P0002`); T6.2d acotada (delta solo `register_birth`); T6.4 reescrita (delta aprobado, alcance mínimo, Gate 1 antes de implementar); T6.5 nueva (no doble-upload); T7.7/T7.8/T7.9 ajustadas (idempotencia `register_birth` con delta + `exit_animal_profile` natural; rollback del overlay; no doble-upload).
  - NO se tocó `feature_list.json`, `progress/current.md` ni se escribieron migraciones reales. `node scripts/check.mjs` → verde (solo docs).

- **2026-06-08 — Fix-loop Gate 1 DEL DELTA (`security_analyzer` modo `spec`, FAIL: 1 HIGH = HIGH-D1) → corregido.** El reporte (`progress/security_spec_15-powersync.md`, sección "RE-VERIFICACION Gate 1 — DELTA") marcó **HIGH-D1: IDOR cross-tenant en la rama idempotente de `register_birth`**. Las streams (§2) NO se re-auditaron — no cambiaron, su PASS previo vale; el FAIL es del DELTA (write-side). Reconciliado sin tocar código ni migraciones reales:
  - **Causa**: las 4 fuentes describían el guard de idempotencia como un **lookup PURO** por `client_op_id` (`SELECT id WHERE client_op_id = p_client_op_id → RETURN`), **sin exigir que el parto existente pertenezca al caller**. Como `client_op_id` es un uuid de cliente (attacker-controlled) y el índice UNIQUE era **global**, un atacante autenticado podía, por replay/colisión, recibir el `id` de un parto de OTRO establecimiento por el canal RPC (paralelo a la stream) → lectura cross-tenant. El `has_role_in(v_est)` del as-built valida sobre la madre que el caller PASÓ, no sobre la madre del parto existente → "authz antes del guard" NO alcanzaba.
  - **Verificación de schema (decide el predicado)**: `reproductive_events` (`0026_reproductive_events.sql`) **NO tiene `establishment_id` denormalizado**; la tenencia se deriva vía `animal_profiles` (`establishment_of_profile(animal_profile_id)`, RLS `0026:63-66`). `animal_profiles` SÍ tiene `establishment_id` (lo usa `register_birth`, `0045:214`). → El scoping se ancla en `animal_profile_id = p_mother_profile_id` + JOIN a `animal_profiles` con `establishment_id = v_est`.
  - **Fix (guard scopeado al caller, §5.4.3(1))**: la rama no-op solo corta-y-devuelve si el parto existente es del propio caller — lookup `WHERE re.client_op_id = p_client_op_id AND re.animal_profile_id = p_mother_profile_id AND p.establishment_id = v_est AND re.deleted_at IS NULL` (con `has_role_in(v_est)` ya validado antes). Ante colisión ajena (mismo `client_op_id`, otra madre/otro tenant) → cae al camino de creación → `unique_violation`/`23505` **genérico**, **nunca** devolver datos ajenos ni oráculo de existencia.
  - **Índice: de GLOBAL a COMPUESTO `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL`.** El compuesto cierra el doble-apply legítimo igual (un reintento del mismo caller reusa la misma madre + el mismo `client_op_id` → colisiona consigo mismo, no re-crea) y además **elimina el oráculo de existencia residual (E4)**: el INSERT del atacante usa su propia madre → nunca colisiona con la fila ajena. Recomendado: **compuesto + guard procedural scopeado** (el guard es el mínimo que cierra el leak de DATOS; el compuesto cierra el oráculo). Ver §9-nota.
  - **Fuentes reconciliadas**: design **§5.4.3(1)** (cuerpo del guard con scoping + comportamiento ante colisión ajena), design **§7-bis** (nota de seguridad: el guard ES un path de lectura → exige authz + scoping), **§5.4.3 resumen del delta** (índice compuesto), **§9-nota** (defensa-en-profundidad del compuesto); `requirements.md` **R6.10** (bullet `register_birth`: dedup scopeada al caller, error genérico ante colisión), **R11.3** (índice compuesto, no global), **R11.4** (Gate 1 verifica el scoping del cuerpo); `tasks.md` **T6.4** (guard con scoping de tenancy + error genérico; aviso explícito de no escribir el guard literal). Bitácora `progress/spec_15-powersync.md`.
  - NO se tocó `feature_list.json`, `progress/current.md` ni se escribieron migraciones reales. `node scripts/check.mjs` → verde (solo docs).

- **2026-06-08 — Reescritura del YAML de sync streams al patrón `with:`/INNER JOIN (fix runtime `[PSYNC_S2305]` too many buckets / regresión #611). FRONTERA DE AUTORIZACIÓN IDÉNTICA — solo cambió la ESTRUCTURA.** Al deployar las 26 streams (patrón canónico inline como subquery anidada) y conectar un cliente real, el server cerró el stream con `too many parameter query results / too many buckets (limit of 1000)`. Diagnóstico autoritativo (logs de la instancia): por la regresión powersync-service **#611**, una stream `auto_subscribe` con `IN (subquery)` **sin** bloque `with:` crea **un bucket por cada FILA de datos** de la subquery → ~22 streams per-est × ~100 establecimientos contaminados en la beta → ~2200 buckets > 1000 → 0 bytes + loop de reconexión. **Gate 1 había validado la autorización (correcta); el patrón de sintaxis revienta el límite operativo.** Reescrito sin tocar backend ni la frontera de read-authz:
  - **§2 reescrita**: las 22 streams per-establishment ahora usan un bloque `with:` (CTE `org_scope`/`owner_scope`, scope del user = chico → 1 bucket por campo) + **INNER JOIN** al padre (no subquery anidada con la CTE adentro — eso re-cuenta filas, #611). El `establishments.deleted_at IS NULL` (campo vivo, fix HIGH-1) se filtra a nivel **data query** (INNER JOIN establishments), NO en la CTE (la CTE se mantiene mínima de 1 tabla, anti-#611). FK/columnas verificadas contra el schema as-built (`animal_profiles.animal_id → animals.id` 0020; `birth_calves` PK + FKs 0045; `rodeo_data_config` PK + FK rodeos 0018; `animal_events.establishment_id` propio 0034; `user_roles` cols 0003). Las globales (5) y self-only (2) NO cambiaron (filtro directo → no explotan, sin `with:`).
  - **§2.1-superseded nueva**: el patrón viejo (subquery anidada) marcado SUPERSEDED con la nota fechada (regresión #611 + límite 1000 + el patrón nuevo).
  - **§2.2 nueva (Estrategia de bucketing)**: 1 bucket por establishment del user (vía `org_scope`); por qué INNER JOIN y no subquery anidada (#611); cómo se preserva el campo-vivo (HIGH-1) a nivel data query; la **matemática de buckets** (≈ N_streams_per_est × N_campos_del_user ≈ 51–117 para Raf, muy debajo de 1000). **§2.2-incertidumbres**: 5 incertidumbres de sintaxis flaggeadas para el validador del dashboard (with: mapa/query-única; queries:/query:; `(expr) AS id, t.*`; 2–3 INNER JOINs; short-hand `IN org_scope`), cada una con apuesta + fallback.
  - **§2.3-equivalencia nueva**: tabla viejo(SUPERSEDED)→nuevo(`with:`/JOIN) por stream, confirmando que el set autorizado es idéntico. Sutileza JOIN (over-emisión de filas duplicadas, dedupeadas por `id` por el SDK; NO over-autorización) flaggeada.
  - **§7 (Espejo de RLS)**: nota de que el predicado canónico ahora se REPARTE (rol activo en la CTE `with:`, campo vivo en el INNER JOIN del data query); frontera idéntica, HIGH-1 sigue cerrado.
  - **§9 — Opción 2 NO tomada (diferida)**: trigger que desactive `user_roles.active` al soft-deletear un establecimiento → `org_scope` quedaría limpio sin JOINs a establishments (YAML más simple, menos buckets, probable cierre de un leak equivalente en RLS). Toca backend → fuera de esta iteración; requiere análisis de impacto en `has_role_in`/`is_owner_of` + Gate 1 + migración. Documentada como decisión diferida, NO implementada. **→ RECONCILIADO (Run 4): la Opción 2 SE TOMÓ — ver la entrada de abajo "2026-06-09 — Trigger user_roles.active ↔ soft-delete".**
  - **`sync-streams/rafaq.yaml`**: reescrito byte-faithful al §2 nuevo (mirror), con el header explicando #611 + el patrón `with:`/JOIN + las incertidumbres flaggeadas.
  - **requirements.md**: R4.1 (nota de que la estructura del predicado canónico pasó a `with:`/JOIN, frontera idéntica), Historial de refinamiento (entrada 2026-06-08).
  - **tasks.md**: T2.1 (nota de la reescritura `with:`/JOIN), T2.2/T2.3 (re-Gate 1 verifica la equivalencia + el validador del dashboard confirma la sintaxis fina y el conteo de buckets).
  - **NO se tocó la autorización** (Gate 1 sobre las streams sigue PASS por autorización; el re-Gate 1 verifica la EQUIVALENCIA del cambio estructural). **NO se deployó** (lo hace Raf tras re-Gate 1). **NO se tocó backend** (la Opción 2 del trigger quedó diferida en §9). NO se tocó `feature_list.json`, `progress/current.md` ni migraciones. `node scripts/check.mjs` → verde (solo docs).

- **2026-06-09 — Trigger `user_roles.active` ↔ soft-delete de establecimientos (Run 4, migración `0076`) — la "Opción 2" de §9 SE TOMÓ. Delta ADITIVO de backend, segundo y último delta de la feature.** El leader decidió implementar el trigger diferido en §9 para que `user_roles.active = true` sea un proxy FIEL de "campo vivo" en el modelo de sync JOIN-free. Análisis de impacto RLS verificado contra el schema as-built (por el implementer): `has_role_in`/`is_owner_of` (`0005`) YA hacen `JOIN establishments e ... AND e.deleted_at IS NULL` → YA devuelven false para un campo soft-deleteado independientemente de `active`; las queries de membership de la app (`establishments.ts`/`rodeos.ts`/`loadMemberships`) también filtran `e.deleted_at IS NULL`. **Conclusión: el trigger es aditivo y NO cambia comportamiento observable de la app/RLS** — sólo limpia `active`. NO hay flujo de restore/undelete de establecimientos en el MVP (verificado: el único `deleted_at = null` del código es el cleanup de un test). As-built:
  - **`supabase/migrations/0076_deactivate_roles_on_establishment_soft_delete.sql`**: (1) función + trigger `AFTER UPDATE OF deleted_at ON establishments` que, en la transición `NULL → NOT NULL`, hace `UPDATE user_roles SET active = false, deactivated_at = now() WHERE establishment_id = NEW.id AND active = true`; (2) **NO reactiva** en el caso inverso `NOT NULL → NULL` (no se puede distinguir desactivado-por-borrado de desactivado-por-remoción-de-miembro; documentado en la migración como limitación deliberada — un futuro restore deberá manejar la reactivación explícitamente); (3) **backfill** de los roles ya-activos que apuntan a campos ya-borrados (incluye los 3 espurios del user de prueba). `security definer` + `set search_path = public` (mismo patrón que `handle_new_establishment` 0011, que es el precedente validado de un trigger `security definer` que escribe `user_roles`). `drop trigger if exists` + `create trigger` para idempotencia (estilo del repo). Envuelta en `BEGIN/COMMIT`. **NO aplicada al remoto desde el implementer** — la aplica el leader por Management API tras gatearla (Gate 1 sobre el delta + Gate 2 + reviewer).
  - **Verificado: NO hay otro trigger sobre `user_roles`** (grep de todos los `create trigger` del repo → ninguno apunta a `user_roles`; única referencia = schema `0003` + policies `0008` + grants `0010`) → el `UPDATE user_roles` del trigger no re-dispara nada (no toca `establishments`) → cero loop, cero side-effect destructivo (es UPDATE de 2 columnas, no DELETE). Ningún `FORCE ROW LEVEL SECURITY` en el repo → el `UPDATE` bajo `security definer` (owner del schema / `postgres`) bypassa RLS como el INSERT de `0011`.
  - **Test** en `supabase/tests/rls/run.cjs` (suite RLS, campo + usuario dedicados `estE`/`userE`, autocontenido para no contaminar): soft-delete → AMBOS `user_roles` quedan `active = false` + `deactivated_at` poblado → `has_role_in` sigue false (no-regresión). **FALLA hasta que el leader aplique `0076`** (es ESPERADO; mismo patrón que la suite `spec 15-powersync` del animal runner con `0075`).
  - **§2.2 / §2.1 reconciliados** (nota AS-BUILT Run 4): el bucketing de Raf baja del peor caso 5 al caso real 2 (los 3 roles espurios salen de `org_scope`); el `INNER JOIN establishments ... deleted_at IS NULL` de las data queries se MANTIENE como defensa-en-profundidad (ya no estrictamente necesario para correctitud, pero cierra la ventana de carrera soft-delete↔WAL). **§9 Opción 2** marcada RECONCILIADA (tomada).
  - **requirements.md** R11.3 reconciliada (de "UN delta aditivo" a "DOS deltas aditivos": idempotencia `0075` + trigger `0076`); R4.1/R4.2 nota de que ahora hay trigger que mantiene `active` coherente (refuerza el cierre de HIGH-1, no lo reemplaza — el filtro de campo vivo se mantiene). **tasks.md** T-trig agregada (Run 4). NO se tocó `feature_list.json`. `node scripts/check.mjs` → el único rojo es el test nuevo pendiente de la aplicación de `0076` (esperado); el resto verde.

- **2026-06-09 — Reconciliación al as-built V3 JOIN-FREE (cierre del drift L-1 del Gate 1) + DISEÑO del paso 2 (denormalización de `establishment_id`) + ADR-026.** Sin tocar código, migraciones, el YAML ni `feature_list.json` (el implementer escribe migraciones/YAML del paso 2 tras Gate 1 + aprobación de (B)/(C)):
  - **Cierre L-1 (drift de doc):** el bloque YAML de **§2** (V2: `with:`/INNER JOIN) describía un modelo que **siguió fallando en runtime** — PowerSync evalúa cada tabla del INNER JOIN como parameter query independiente y enumera toda `establishments` por stream (`"evaluating parameter on establishments: 102"` → ~1020 buckets → PSYNC_S2305). El as-built es **V3 JOIN-FREE** (`sync-streams/rafaq.yaml`): cada stream filtra **directo** `WHERE establishment_id IN org_scope`, sin JOINs; el `deleted_at` del campo lo garantiza el invariante "rol activo ⇒ campo vivo" de `0076` (no por JOIN). **§2 marcada SUPERSEDED-POR-RUNTIME** (banner al inicio + en §2.1-superseded), apuntando a `rafaq.yaml` (V3) + §2.2 (AS-BUILT V3) como fuente de verdad. **§2.2** abre con el bloque AS-BUILT V3 (bucket math 17 streams ≈ 27 buckets para 2 campos). Las 17 streams V3 ya sincronizan en vivo + Gate-1-PASS (`progress/security_spec_15-powersync-v3-joinfree.md`).
  - **§2.4 nueva — Paso 2 (denormalización):**
    - **(A) tablas hijas** (5 eventos + `animal_category_history` + `birth_calves` + `rodeo_data_config`): denormalizar `establishment_id` (ADD COLUMN nullable → backfill desde el padre → trigger-FORCE anti-spoof `BEFORE INSERT` [+ `BEFORE UPDATE` en `rodeo_data_config`] → NOT NULL al final) + stream JOIN-free idéntica al paso 1. Cadenas de derivación verificadas contra el as-built (`0025`–`0030`, `0045`, `0018`). RLS as-built NO cambia (la columna es solo para el stream; el trigger la mantiene fiel; Gate 1 lo verifica). `animal_events` NO está en (A) — ya tiene `establishment_id` propio (`0034`, precedente del patrón).
    - **(B) `animals` → (b1)** [DECISIÓN RAF]: denormalizar identidad (`tag_electronic`/`sex`/`birth_date` — los únicos campos que la UI lee de `animals`, verificado en `animals.ts`) sobre `animal_profiles` (trigger force en INSERT del perfil + trigger de propagación en UPDATE de `animals` + backfill); NO sincronizar `animals` (la stream `est_animals` con JOIN del bloque V2 = b2, DESCARTADA: es el patrón que reventó). El swap T4 lee identidad desde `animal_profiles`.
    - **(C) nombres de `users` → (c1)** [DECISIÓN RAF]: dejar los nombres de coworkers ONLINE (revertir la parte de nombres del swap T3 — `members.loadMembers`/`buildMembersQuery`/`buildOwnNameQuery` apuntan hoy a un `users` local que el paso 1 NO sincroniza → drift a corregir). Alternativa (c2): denormalizar `name` sobre `user_roles` para nombres offline (costo: un delta + Gate 1). PII (email/phone) NO se toca (self-only, ADR-025).
    - **bucket math paso 1 + paso 2**: 17 + 8 streams nuevas = 25 (18 per-est); ≈ 43 buckets para 2 campos vivos. `<< 1000`. El paso 2 NO reintroduce #611 (streams idénticas al paso 1, sin JOINs).
  - **§3 reconciliada**: las tablas hijas pasan de "vía perfil" a "est denorm. del perfil/parto/rodeo"; `animals` → "NO se sincroniza (identidad denorm. en `animal_profiles`)"; `users` nombres → "ONLINE (c1)".
  - **ADR-026 escrito** (`docs/adr/ADR-026-denormalizacion-establishment-id-powersync.md`): el patrón general (toda tabla sincronizada necesita `establishment_id` propio para el bucket model JOIN-free; hijas lo denormalizan vía trigger-force + backfill; compartidas se resuelven denormalizando identidad sobre la fila per-campo o quedando online), las decisiones (B)/(b1) y (C)/(c1) con justificación, y las consecuencias (duplicación controlada por triggers, Gate 1 por cada delta, swap T4 alineado).
  - **requirements.md**: R4.6/R4.7/R4.8/R4.10 reconciliados (de "derivando vía JOIN" a "vía `establishment_id` denormalizado"); R11.3 reconciliada (DOS deltas → +N deltas de denormalización del paso 2, mismo régimen de Gate 1); **R13 nuevo** (denormalización del paso 2). **tasks.md**: fase T9 nueva (migraciones de denormalización (A) + decisiones (B)/(C) + streams nuevas + Gate 1 por delta + swap T4 alineado a (b1)).
  - **(B)/(C) son DECISIONES de Raf** (cambian el modelo de lectura) → el leader las surfacea; el spec_author recomienda (b1)/(c1). NO se aplicó ninguna migración ni se deployó el YAML del paso 2. `node scripts/check.mjs` → sin cambios de rojo (solo docs + ADR).
