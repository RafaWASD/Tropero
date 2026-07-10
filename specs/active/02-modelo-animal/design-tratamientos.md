# Spec 02 — Delta `tratamientos` · Design

> Delta Nivel B (ADR-028) de **02-modelo-animal** (feature `done`). El baseline `design.md` **no se reescribe**;
> el índice "Deltas posteriores" lo folda el leader al cerrar (Puerta 2). Fuente de contexto:
> `context-tratamientos.md` (Gate 0). Requirements: `requirements-tratamientos.md` (IDs `RTR.x`).
>
> **SCHEMA-SENSITIVE** → Gate 1 obligatorio (`security_analyzer` modo `spec`) antes de Puerta 1. Deploy de la
> migración **gateado a Raf** (Supabase MCP en modo escritura; el clasificador gatea DDL a la DB compartida).

## 0. Modelo (recap del Gate 0)

Capa de **ESTADO** sobre el evento que ya existe. No se reinventa el registro de aplicación:

- **`treatments` (header)** — tabla nueva: el tratamiento como entidad con ciclo de vida (`started_at` →
  `ended_at`). "En tratamiento" = **derivado** (existe un `treatments` del animal con `ended_at IS NULL AND
  deleted_at IS NULL`). Sin flag redundante en `animal_profiles` (RTR.4.2).
- **Aplicaciones = `sanitary_events`** (0027, ya existe) linkeadas por un `treatment_id` FK **nuevo** (nullable —
  los sanitarios sueltos de maniobra siguen sin header).
- **Marca + pin** = se computan del derivado, sobre `treatments`.

## 1. Archivos a crear / modificar

### Backend (SQL)
- **CREAR** `supabase/migrations/0123_treatments.sql` — tabla `treatments` + enum `treatment_kind` + CHECKs de
  tope (SEC-TRT-02) + `ALTER sanitary_events ADD treatment_id` + índices + triggers (force
  `establishment_id`/`created_by`, **inmutabilidad de columnas** SEC-TRT-01, tenant-check **incondicional** del
  link SEC-TRT-03) + RLS + grants + `revoke execute` (SEC-TRT-04) + **CREATE OR REPLACE de
  `tg_sanitary_events_gating` (0091)** con la exención de las aplicaciones (RTR.2.7). *(0122 es la última as-built
  → 0123 es la próxima; verificado en `supabase/migrations/`.)*
- **MODIFICAR** `sync-streams/rafaq.yaml` — agregar la stream `ev_treatments` (JOIN-free, scope establishment).
  *(No se deploya desde el archivo: se pega en el dashboard → Validate → Deploy, tras aplicar 0123.)*
- **CREAR** `supabase/tests/rls/treatments.test.cjs` *(o extender el runner de eventos)* — RLS fail-closed,
  anti-spoof `establishment_id`/`created_by`, anti-IDOR del `treatment_id`, ciclo iniciar/aplicar/finalizar.

### Cliente (PowerSync + services + UI)
- **MODIFICAR** `app/src/services/powersync/schema.ts` — nueva `Table treatments` + `treatment_id` en la Table
  `sanitary_events` + registrar `treatments` en `AppSchema`.
- **MODIFICAR** `app/src/services/powersync/local-reads.ts` — builders nuevos (lecturas + writes CRUD-plano) +
  inyección del `in_treatment` en `buildAnimalsListQuery` (pin) + `treatment_id` opcional en el payload del
  timeline.
- **CREAR** `app/src/services/treatments.ts` — service delgado (iniciar / aplicar / finalizar / leer
  tratamientos) siguiendo el patrón de `events.ts` (CRUD-plano, `ServiceResult<T>`, offline-first).
- **CREAR/EXTENDER** `app/src/utils/treatment-input.ts` (o `animal-input.ts`) — sanitizer + validación de
  `product_name` (no vacío, ≤ `TREATMENT_PRODUCT_MAX_LENGTH` = 120) y `notes` (≤ `TREATMENT_NOTES_MAX_LENGTH` =
  1000). **Las constantes deben ser las MISMAS que los CHECKs server-side** (RTR.1.9/RTR.1.10, SEC-TRT-02) — así
  el cliente corta antes y el server es la barrera dura.
- **MODIFICAR** `app/src/components/AnimalRow.tsx` — prop `inTreatment?: boolean` → marca distintiva.
- **MODIFICAR** el mapper de la lista (`app/src/services/animals.ts`, `toLocalListItem` + `AnimalListItem`) —
  exponer `inTreatment`.
- **MODIFICAR** la pantalla de lista (`app/app/(tabs)/animales.tsx`) — pasar `inTreatment` a `AnimalRow` *(el pin
  ya lo resuelve el ORDER BY de la query; la pantalla solo pinta la marca)*.
- **MODIFICAR** `app/app/animal/[id].tsx` — sección "Tratamientos" (listar + iniciar + aplicar + finalizar) +
  marca "en tratamiento" en el hero. Componentes nuevos en `app/src/components/` (sheet de iniciar, sheet de
  aplicar, card de tratamiento).
- **EXTENDER** `app/e2e/` — flujo iniciar → aplicar → finalizar + marca/pin (memoria: testear con Playwright).

## 2. Schema SQL — migración `0123_treatments.sql`

> Reusa helpers ya vigentes en el remoto: `establishment_of_profile(uuid)`, `has_role_in(uuid)`,
> `is_owner_of(uuid)` (0005/spec 01), `tg_force_establishment_id_from_profile()` (0077, anti-spoof del tenant
> denormalizado), `tg_force_created_by_auth_uid()` (0043, force del autor). **El implementer debe moldear sobre
> el cuerpo VIGENTE de esos helpers en el remoto** (memoria "Base de re-CREATE de función"), no sobre la
> migración citada.

```sql
-- 0123_treatments.sql — delta `tratamientos` de spec 02 (ítem E triage Facundo+padre).
-- Capa de ESTADO (header) sobre sanitary_events. Cubre RTR.1..RTR.9.
-- NO aplicar desde acá: lo aplica Raf/leader por Management API tras Gate 1 + Puerta 1 (BEGIN/COMMIT).

begin;

-- (1) Tipo del tratamiento (D-3). Enum estable; los nombres humanos los pone la UI. --------------
create type public.treatment_kind as enum ('antibiotico', 'antiparasitario', 'otro');

-- (2) Header del tratamiento. establishment_id DENORMALIZADO (sync JOIN-free, ADR-026) + FORZADO por
--     trigger desde el perfil (anti-spoof). "En curso" = ended_at IS NULL. `deleted_at` es columna DEFENSIVA de
--     la convención de soft-delete (principio 4): en v1 se llena SOLO por CASCADE del perfil (el trigger de
--     inmutabilidad (3c) impide setearla por UPDATE); soft-delete del header por UPDATE = v2 (ver RLS (5) y RTR.7.6).
create table public.treatments (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,  -- forzado (trigger)
  kind               public.treatment_kind not null,
  product_name       text not null,
  notes              text,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,               -- NULL = EN CURSO (RTR.4.1)
  created_by         uuid references public.users(id),                                       -- forzado (trigger)
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- RTR.1.4 (no vacío) + SEC-TRT-02 (tope server-side). Las constantes 120 / 1000 son las MISMAS del
  -- sanitizer del cliente: TREATMENT_PRODUCT_MAX_LENGTH=120 (RTR.1.9), TREATMENT_NOTES_MAX_LENGTH=1000 (RTR.1.10).
  constraint treatments_product_not_empty check (length(trim(product_name)) > 0),
  constraint treatments_product_len       check (char_length(product_name) <= 120),
  constraint treatments_notes_len         check (notes is null or char_length(notes) <= 1000)
);
-- NOTA (LOW-2, sanidad de rango ended_at >= started_at): NO se agrega como CHECK duro A PROPÓSITO. Ambos
-- timestamps son wall-clock de CLIENTE (started_at al iniciar; ended_at = datetime('now') al finalizar), y en un
-- sistema offline-first un tratamiento puede iniciarse en el dispositivo A y finalizarse en el B (o en el mismo
-- con corrección NTP entre medio) → un CHECK ended_at >= started_at podría RECHAZAR una finalización legítima por
-- skew de reloj, y bloquear un finalizar offline es peor que un rango levemente invertido. La UI ordena/renderiza
-- por started_at y trata ended_at como "fin"; el desorden de reloj es cosmético. Si se quisiera, va en v2 como
-- normalización en cliente (ended_at := max(ended_at, started_at)), no como constraint server-side.

-- Índice del DERIVADO "en tratamiento" (RTR.4.1 / pin): tratamientos ABIERTOS por perfil. Sirve el
-- EXISTS de la lista/ficha en O(log n).
create index treatments_open_by_profile
  on public.treatments (animal_profile_id)
  where ended_at is null and deleted_at is null;

-- Índice de la sección "Tratamientos" de la ficha (RTR.9.1): todos los del perfil, recientes primero.
create index treatments_by_profile
  on public.treatments (animal_profile_id, started_at desc)
  where deleted_at is null;

-- Índice de scope de la stream (RTR.7.4): establishment del tenant.
create index treatments_by_est
  on public.treatments (establishment_id)
  where deleted_at is null;

-- (3) Triggers de integridad -------------------------------------------------------------------
-- (3a) FUERZA establishment_id desde el perfil (anti-spoof, RTR.7.2). Reusa el helper de 0077 (mismo
--      criterio que las 5 tablas de evento). BEFORE INSERT *y* UPDATE (un caller con UPDATE no puede
--      pisar la columna con un campo ajeno). Si el perfil no existe → 23503 (fail-closed, RTR.7.5).
create trigger treatments_force_establishment_id
  before insert or update on public.treatments
  for each row execute function public.tg_force_establishment_id_from_profile();

-- (3b) FUERZA created_by = auth.uid() (RTR.7.7): el "quién" de la vigilancia es confiable (no lo puede
--      spoofear el cliente). Variante FORCE (0043), NO la audit-only "solo si NULL" (0024). Ver
--      requirements § Decisión de criterio 2.
create trigger treatments_force_created_by
  before insert on public.treatments
  for each row execute function public.tg_force_created_by_auth_uid();

-- (3c) INMUTABILIDAD DE COLUMNAS EN UPDATE (SEC-TRT-01, HIGH — cierre del audit-tampering, RTR.7.7/RTR.7.8).
--      La policy UPDATE es amplia (has_role_in, fiel a D-2: cualquier rol FINALIZA). Como la RLS es row-level,
--      sin este trigger un caller podría PATCH-ear por PostgREST directo `created_by`/`deleted_at` (ocultar el
--      registro)/`product_name`/`kind`/`notes`/`started_at`, o des-finalizar (`ended_at = NULL`) — y el atacante
--      es justo el peón vigilado. Este trigger PINNEA a OLD todo salvo la ÚNICA mutación legítima: `ended_at`
--      NULL→instante (finalizar, RTR.3, idempotente). No es security definer (solo toca NEW/OLD, sin leer tablas).
--      Patrón as-built = columnas inmutables de `animal_events` (0034) + force de `establishment_id` en UPDATE (0077).
--      ⚠️ Pinnea `establishment_id` A OLD TAMBIÉN (no solo `animal_profile_id`): así queda self-contained e
--      INDEPENDIENTE del orden de disparo respecto de treatments_force_establishment_id (3a). Si NO lo pinneara,
--      un `UPDATE ... SET animal_profile_id = <ajeno>` podría dejar `establishment_id` derivado del perfil ajeno
--      (si el force corre primero) mientras `animal_profile_id` se revierte a OLD → fila inconsistente que
--      sincronizaría al tenant equivocado. Pinneando ambos a OLD, cualquier orden de los dos triggers converge a
--      (animal_profile_id=OLD, establishment_id=OLD) — consistente. En INSERT solo corre el force (este es UPDATE).
create or replace function public.tg_treatments_immutable_columns ()
returns trigger language plpgsql as $$
begin
  new.created_by        := old.created_by;
  new.animal_profile_id := old.animal_profile_id;
  new.establishment_id  := old.establishment_id;        -- pin defensivo (ver nota de orden de disparo arriba)
  new.kind              := old.kind;
  new.product_name      := old.product_name;
  new.notes             := old.notes;
  new.started_at        := old.started_at;
  new.created_at        := old.created_at;
  new.deleted_at        := old.deleted_at;              -- no se puede ocultar el registro por UPDATE
  if old.ended_at is not null then
    new.ended_at := old.ended_at;                       -- ya finalizado: ended_at inmutable (no reabrir)
  end if;                                               -- en curso: ended_at NULL→instante es la finalización
  return new;
end; $$;

comment on function public.tg_treatments_immutable_columns is
  'Trigger BEFORE UPDATE en treatments: pinnea a OLD toda columna salvo la finalizacion (ended_at NULL->ts). '
  'Cierra el audit-tampering de la policy UPDATE amplia (SEC-TRT-01 / RTR.7.7 / RTR.7.8). Patron de columnas '
  'inmutables de animal_events (0034).';

create trigger treatments_immutable_columns
  before update on public.treatments
  for each row execute function public.tg_treatments_immutable_columns();

revoke execute on function public.tg_treatments_immutable_columns () from public, authenticated, anon;  -- SEC-TRT-04

-- (4) FK treatment_id en sanitary_events (aplicaciones). Nullable: los sanitarios sueltos de maniobra
--     siguen sin header. -------------------------------------------------------------------------
alter table public.sanitary_events
  add column treatment_id uuid references public.treatments(id) on delete set null;

-- Índice de "las aplicaciones de un tratamiento" (RTR.9.2). Parcial (solo linkeadas, no borradas).
create index sanitary_events_by_treatment
  on public.sanitary_events (treatment_id)
  where treatment_id is not null and deleted_at is null;

-- (4a) ANTI-IDOR / tenant-consistency del link (RTR.2.6/RTR.7.3): una aplicación solo puede linkear a un
--      tratamiento del MISMO animal_profile (⇒ mismo tenant, porque treatments.establishment_id se fuerza
--      del mismo perfil). Sin esto, un caller con INSERT/UPDATE en sanitary_events podría apuntar
--      treatment_id a un tratamiento de otro animal/campo. security definer para leer treatments sin
--      depender de la RLS del caller (solo verifica pertenencia, no fuga datos).
--      SEC-TRT-03 (MEDIUM): el trigger dispara en `before insert or update` INCONDICIONAL (NO `update OF
--      treatment_id`). Motivo: la policy UPDATE de sanitary_events (0027) no tiene `with check` → un UPDATE que
--      cambie `animal_profile_id` del evento (dejando treatment_id fijo) movería la aplicación a otro animal sin
--      re-validar el link. Disparar en TODO update re-chequea la consistencia (treatment.animal_profile_id ==
--      new.animal_profile_id) también cuando cambia el lado del perfil. Costo trivial (un SELECT por index PK).
create or replace function public.tg_sanitary_events_treatment_check ()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  if new.treatment_id is null then
    return new;                         -- sanitario suelto de maniobra: sin header, nada que validar
  end if;
  select animal_profile_id into v_profile
  from public.treatments
  where id = new.treatment_id and deleted_at is null;
  if v_profile is null then
    raise exception 'treatment % not found or deleted', new.treatment_id using errcode = '23503';
  end if;
  if v_profile <> new.animal_profile_id then
    raise exception 'sanitary_event.treatment_id belongs to a different animal' using errcode = '23514';
  end if;
  return new;
end; $$;

comment on function public.tg_sanitary_events_treatment_check is
  'Trigger BEFORE INSERT OR UPDATE (incondicional, SEC-TRT-03) en sanitary_events: exige que el tratamiento '
  'linkeado sea del MISMO animal_profile que la aplicacion (anti-IDOR / tenant-consistency, RTR.2.6/RTR.7.3). '
  'security definer.';

create trigger sanitary_events_treatment_check
  before insert or update on public.sanitary_events
  for each row execute function public.tg_sanitary_events_treatment_check();

revoke execute on function public.tg_sanitary_events_treatment_check () from public, authenticated, anon;  -- SEC-TRT-04

-- (5) RLS de treatments (RTR.7.1). Patrón de las 5 tablas de evento (0027) para SELECT/INSERT; UPDATE
--     AMPLIA (has_role_in) para que cualquier rol activo FINALICE (D-2, fiel; ver requirements § Decisión
--     de criterio 1). El tenant se deriva SIEMPRE del perfil (establishment_of_profile), NUNCA de la
--     columna denormalizada (que un cliente podría intentar spoofear — la deriva el trigger). ----------
alter table public.treatments enable row level security;

create policy treatments_select on public.treatments
  for select using (
    has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null
  );

create policy treatments_insert on public.treatments
  for insert with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );

create policy treatments_update on public.treatments
  for update using (
    has_role_in(establishment_of_profile(animal_profile_id))
  ) with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );
-- Sin policy DELETE. Y en v1 el header NO se soft-deletea por UPDATE: el trigger de inmutabilidad (3c) pinnea
-- `deleted_at := old`, así que ningún caller puede setearlo por PostgREST (cierre de SEC-TRT-01). El único
-- borrado de un treatment en v1 es el HARD-delete por CASCADE al borrar el perfil del animal
-- (`animal_profile_id ... on delete cascade`). El `deleted_at IS NULL` de las lecturas/stream/EXISTS queda como
-- filtro DEFENSIVO (convención, principio 4) — hoy siempre NULL. Soft-delete del header por UPDATE = DIFERIDO a
-- v2 (requeriría relajar la inmutabilidad de `deleted_at` a owner|autor + una UI de "borrar tratamiento").

grant select, insert, update on public.treatments to authenticated;
grant all on public.treatments to service_role;

-- (6) EXENCIÓN del gating de maniobra para las aplicaciones de tratamiento (RTR.2.7 — decisión del leader).
--     Las aplicaciones se insertan como sanitary_events con event_type derivado del kind
--     (antibiotico→treatment, antiparasitario→deworming) → sin esto chocarían con tg_sanitary_events_gating
--     (0091), que exige el data_key del rodeo (antibiotico / antiparasitario_*). Un animal enfermo se trata sin
--     importar la plantilla del rodeo (el gating es para la RECOLECCIÓN en maniobras, no para una acción reactiva
--     de salud). CREATE OR REPLACE que EXIME las filas con treatment_id no nulo (short-circuit al tope) y deja
--     TODO lo demás EXACTO. ⚠️ Moldear sobre el cuerpo VIGENTE de la función en el remoto (0091 es el as-built
--     citado, pero verificar que no la haya re-definido una migración posterior — memoria "Base de re-CREATE").
--     Toca una función gateada existente → el re-Gate-1 lo revisa.
--     HARDENING (LOW-1, re-Gate-1): el short-circuit se ACOTA a `event_type <> 'vaccination'`. Motivo: una
--     aplicación de tratamiento SIEMPRE tiene event_type ∈ {treatment, deworming, other} (derivado del kind);
--     nunca 'vaccination' (la vacuna es campaña por maniobra, D-3, NO un kind de tratamiento). Sin el acote, un
--     caller PostgREST-directo podría INSERT-ar event_type='vaccination' + un treatment_id del MISMO animal para
--     saltear el gating de `vacunacion` del rodeo (auto-exención same-animal — defensa-en-profundidad, within-tenant,
--     NO cruza límite de confianza → por eso era LOW). El acote lo cierra a costo nulo sin bloquear ninguna
--     aplicación legítima. (Residual v2 opcional: exigir que event_type MATCHEE el kind del tratamiento — requiere
--     un SELECT del kind; se deja como nota, no se agrega en v1.)
create or replace function public.tg_sanitary_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Aplicación de un tratamiento (RTR.2.7): pasa SIN gating de data_key del rodeo, SALVO 'vaccination'
  -- (que nunca es una aplicación legítima de tratamiento → sigue gateada, cierra la auto-exención LOW-1).
  if new.treatment_id is not null and new.event_type <> 'vaccination' then
    return new;
  end if;
  if new.event_type = 'vaccination' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion']);
  elsif new.event_type = 'deworming' then
    perform public.assert_any_data_key_enabled(
      new.animal_profile_id,
      array['antiparasitario_interno', 'antiparasitario_externo']
    );
  elsif new.event_type = 'treatment' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['antibiotico']);
  end if;
  -- test/other NO se gatean (igual que 0091).
  return new;
end; $$;
revoke execute on function public.tg_sanitary_events_gating () from public, authenticated, anon;  -- SEC-TRT-04 / patrón 0091

notify pgrst, 'reload schema';

commit;
```

### 2.1 Nota sobre `sanitary_events` (aplicaciones) — sin cambio de RLS

Las policies de `sanitary_events` (0027) **no se tocan**: `INSERT` = `has_role_in(...)` (cualquier rol registra
una aplicación, RTR.6.2), `UPDATE` = `is_owner_of(...) OR created_by = auth.uid()` (corrección de una aplicación
= owner|autor, as-built). Se agregan sobre `sanitary_events`: la **columna** `treatment_id`, su trigger de
tenant-check **incondicional** (SEC-TRT-03, §2 (4a)) y la **exención de gating** (RTR.2.7, §2 (6) — las
aplicaciones con `treatment_id` no nulo saltan `tg_sanitary_events_gating`). El `event_type` de la aplicación se
deriva del `kind` (RTR.2.2): `antibiotico → treatment`, `antiparasitario → deworming`, `otro → other`.
`product_name` de la aplicación **NOT NULL** → default = `product_name` del tratamiento.

## 3. Sync stream — `sync-streams/rafaq.yaml`

`treatments` tiene `establishment_id` propio (denormalizado + forzado) → entra al patrón JOIN-free ya probado,
paridad exacta con `ev_sanitary_events`. `sanitary_events.treatment_id` **no** requiere cambio de stream:
`ev_sanitary_events` hace `SELECT *` → la columna nueva baja sola.

```yaml
  # spec 02 delta tratamientos — header de tratamiento (0123). establishment_id denorm + forzado
  # (anti-spoof, tg_force_establishment_id_from_profile) → JOIN-free, mismo patrón que ev_sanitary_events.
  # ⚠️ Solo deployar DESPUÉS de aplicar 0123 (la tabla debe existir o el Validate del dashboard falla).
  ev_treatments:
    auto_subscribe: true
    with:
      org_scope: SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true
    queries:
      - SELECT * FROM treatments WHERE establishment_id IN org_scope AND deleted_at IS NULL
```

**Foco Gate 1 (frontera de sync)**: la stream es la frontera de autorización del wire (no hay RLS sobre el WAL,
ADR-025). El scope `establishment_id IN org_scope AND deleted_at IS NULL` cierra cross-tenant y oculta los
soft-deleteados. La fidelidad de `establishment_id` la garantiza el trigger-force (3a) — si el cliente pudiera
setearla a un campo ajeno, la stream le replicaría treatments cross-tenant.

## 4. Derivación "en tratamiento", marca y pin (cliente)

### 4.1 Pin en las listas (RTR.5) — `buildAnimalsListQuery`

Se inyecta una columna computada `in_treatment` (0/1) en **ambas ramas** del UNION (misma técnica
`injectProjection` que el `updated_at` de la opción A del dedup) y se cambia el ORDER BY a
`in_treatment DESC, ${orderBy} DESC`:

- Rama **sincronizada** (`ap`): `EXISTS (SELECT 1 FROM treatments t WHERE t.animal_profile_id = ap.id AND
  t.ended_at IS NULL AND t.deleted_at IS NULL) AS in_treatment`. La correlación a `ap.id` es válida (el
  `injectProjection` inserta el expr justo antes del ` FROM animal_profiles ap` principal — el mismo marcador
  que ya usa, robusto a las subconsultas de apodo que van antes).
- Rama **overlay** (`pap`): `0 AS in_treatment` — un alta optimista (pending) no tiene tratamiento (los
  tratamientos se inician solo desde la ficha de un animal ya existente, RTR.1.7).
- `in_treatment` se inyecta **siempre** (independiente de `orderBy`), porque el ORDER BY lo referencia; el
  `updated_at` se sigue inyectando solo cuando `orderBy === 'updated_at'`.

```
ORDER BY in_treatment DESC, ${orderBy} DESC LIMIT 200
```

Esto cubre **la lista general y la del rodeo** (ambas usan `buildAnimalsListQuery`, la del rodeo con
`filter.rodeoId`) — un solo cambio, RTR.5.1/RTR.5.2. El `in_treatment` viaja al mapper `toLocalListItem`, que lo
expone en `AnimalListItem.inTreatment`. `buildSearchUnion`/los counts **no** se tocan (la marca no va en la
búsqueda, requirements § Decisión de criterio 6).

### 4.2 Marca en la fila de lista (RTR.4.4) — `AnimalRow`

`AnimalRow` gana `inTreatment?: boolean`. Cuando es `true`, muestra una marca distintiva (chip/punto) con el
**color sanitario** (azul/turquesa), en el lenguaje de los chips existentes (`NoTagChip`/`FutureBullBadge`:
`$surface` + borde/ícono/texto del token nuevo), con `labelA11y` y `lineHeight` matcheado (memoria de recorte de
descendentes). **El token exacto NO se define acá** (CLAUDE.md: confirmar antes de cambiar design tokens) — se
fija en Gate 2.5 (D-1). Constraint: no reusar `$terracota`, `$amber`, `$cutBg/$cutText`, `$greenLight/$primary`.

### 4.3 Marca en la ficha (RTR.4.3) — hero

La ficha ya carga la sección "Tratamientos" (§5) → deriva `inTreatment = treatments.some(t => t.endedAt == null)`
de los datos ya cargados (sin tocar `buildAnimalDetailQuery`). El hero muestra la misma marca sanitaria (chip
junto al `CategoryBadge`, análogo al `AbortionFlag`). Al finalizar el último tratamiento en curso, el refresh
silencioso (patrón as-built de `[id].tsx`) quita la marca (RTR.4.6).

## 5. Ficha — sección "Tratamientos" (RTR.9)

Nueva sección `<DetailSection icon={…sanitario} title="Tratamientos">` en `app/app/animal/[id].tsx`, entre
"Manejo" y el historial. Solo se ofrece iniciar/aplicar/finalizar en animal **activo** (RTR.1.8).

- **Listado**: por cada tratamiento (en curso primero), una card con `kind` (label es-AR) + `product_name` +
  comentario + estado (badge "En curso" sanitario / "Finalizado" neutro) + fecha de inicio (y fin si aplica) +
  sus aplicaciones (fecha, dosis/vía si están, próxima dosis si está — RTR.9.3).
- **Iniciar** (RTR.1): CTA "Iniciar tratamiento" → sheet con selector `kind` (3 opciones cerradas), campo
  `product_name` (requerido), comentario (opcional) y, opcional, la 1ª aplicación (fecha/dosis/vía/próxima
  dosis). Al confirmar → `startTreatment(...)` (+ opcional `registerApplication(...)`).
- **Registrar aplicación** (RTR.2): en una card de tratamiento **en curso**, CTA "Registrar aplicación" → sheet
  con fecha (default hoy), dosis (opcional), vía (opcional), próxima dosis (opcional). Al confirmar →
  `registerApplication(treatmentId, ...)`.
- **Finalizar** (RTR.3): en una card en curso, CTA "Finalizar tratamiento" (con confirmación inline) →
  `finalizeTreatment(treatmentId)`.
- Todas las acciones usan **optimismo en sitio + refresh silencioso** (convention.md §"actualización optimista
  en el lugar"): la card/marca/pin se actualizan al instante, sin blanquear ni saltar el scroll; revert si el
  write local falla.

**Timeline (RTR.9.4)**: las aplicaciones son `sanitary_events` → ya aparecen en el timeline sin cambios.
**Opcional** (requirements § Decisión de criterio 5): proyectar `treatment_id` en el `json_object` de la rama
`sanitary` de `buildTimelineQuery` para que `TimelineEvent` pueda anotar "(tratamiento)". No bloqueante.

## 6. PowerSync — plumbing (`schema.ts` + `local-reads.ts` + `treatments.ts`)

### 6.1 `schema.ts`
- Nueva `Table treatments` (`localOnly:false`, sincronizada): `animal_profile_id`, `establishment_id`, `kind`,
  `product_name`, `notes`, `started_at`, `ended_at`, `created_by`, `created_at`, `deleted_at` (todas
  `column.text`; timestamptz/uuid → TEXT). Registrar `treatments` en `AppSchema`.
- Agregar `treatment_id: column.text` a la `Table sanitary_events` *(la stream `ev_sanitary_events` hace
  `SELECT *` → la columna baja; sin declararla el SQLite local no la materializa)*.
- **No** hace falta tabla overlay `pending_*`: los tres writes son **CRUD-plano** sobre tablas sincronizadas (no
  RPC-bound), igual que `addWeight`/`addTacto` — PowerSync encola la CrudEntry y `uploadData` hace el
  upsert/update contra PostgREST; RLS+triggers re-validan al subir.

### 6.2 `local-reads.ts` — builders nuevos (puros, testeables)
- `buildStartTreatmentInsert(id, profileId, kind, productName, notes, startedAt)` → `INSERT INTO treatments (id,
  animal_profile_id, kind, product_name, notes, started_at) VALUES (?,?,?,?,?,?)`. `establishment_id`/`created_by`
  los fuerza el trigger al subir → se omiten local (RTR.8: la fila local aparece igual; la ficha lee por
  `animal_profile_id`). `started_at` = cliente (offline, criterio 7).
- `buildRegisterApplicationInsert(id, profileId, treatmentId, eventType, productName, eventDate, doseMl, route,
  nextDoseDate)` → `INSERT INTO sanitary_events (id, animal_profile_id, treatment_id, event_type, product_name,
  event_date, dose_ml, route, next_dose_date) VALUES (...)`. Reusa el patrón CRUD-plano; el tenant-check del
  `treatment_id` valida al subir.
- `buildFinalizeTreatmentUpdate(treatmentId)` → `UPDATE treatments SET ended_at = datetime('now') WHERE id = ?
  AND ended_at IS NULL` (idempotente, RTR.3.4). *(Mismo idiom que `buildSoftDeleteEventUpdate`.)*
- `buildAnimalTreatmentsQuery(profileId)` → `SELECT id, kind, product_name, notes, started_at, ended_at,
  created_by FROM treatments WHERE animal_profile_id = ? AND deleted_at IS NULL ORDER BY (ended_at IS NULL) DESC,
  started_at DESC` (en curso primero).
- `buildTreatmentApplicationsQuery(treatmentId)` → `SELECT id, event_type, product_name, dose_ml, route,
  event_date, next_dose_date FROM sanitary_events WHERE treatment_id = ? AND deleted_at IS NULL ORDER BY
  event_date DESC, created_at DESC`. *(Alternativa: una sola query que traiga treatments + aplicaciones y el
  service agrupe en cliente; el implementer elige — ambas son locales/offline.)*
- `injectProjection` + ORDER BY del pin en `buildAnimalsListQuery` (§4.1).

### 6.3 `treatments.ts` — service delgado (patrón `events.ts`)
`ServiceResult<T>` + `classifyError` uniformes. `startTreatment` / `registerApplication` / `finalizeTreatment`
usan `runLocalWrite` (CRUD-plano, éxito local inmediato offline; el rechazo real lo maneja `uploadData`,
RTR.8.5). `fetchTreatments(profileId)` usa `runLocalQuery` sobre los builders de §6.2. `id` de cliente
(`crypto.randomUUID`). `event_type` derivado del `kind` en el service (mapeo de RTR.2.2). Los servicios son la
única capa que toca PowerSync (architecture.md).

## 7. Multi-tenancy (explícito)

La feature toca multi-tenancy (`establishment_id` en `treatments`). Cierre en **3 capas**:
1. **RLS** — `treatments_*` derivan el tenant del perfil (`has_role_in/establishment_of_profile`), fail-closed;
   nunca de la columna denormalizada.
2. **Trigger-force** — `establishment_id` y `created_by` se fuerzan server-side (anti-spoof), en INSERT (y
   `establishment_id` también en UPDATE).
3. **Sync stream** — `ev_treatments` scopea `establishment_id IN org_scope` (frontera del WAL). El link
   `sanitary_events.treatment_id` se ancla al mismo animal (⇒ mismo tenant) por el trigger tenant-check
   (anti-IDOR).

## 8. Offline-first (explícito)

Carga de datos en campo (el peón sin señal, principio 3). Los tres writes son **CRUD-plano local** (no RPC) →
éxito inmediato offline, sincronizan al reconectar (RTR.8). La marca/pin se computan de datos locales (`EXISTS`
sobre la tabla `treatments` sincronizada) → aparecen offline apenas se inserta/actualiza la fila local (RTR.8.4).
Contrato de escritura idéntico al de eventos: el rechazo de RLS al subir lo superficia `uploadData` por el canal
de status, no el return del write (RTR.8.5).

## 9. Alternativa descartada

**"En tratamiento" como columna booleana en `animal_profiles` (flag), mantenida por trigger sobre `treatments`.**
Descartada: (a) crea un estado redundante que puede divergir del derivado real (dos fuentes de verdad para lo
mismo); (b) exige un trigger AFTER INSERT/UPDATE sobre `treatments` que recompute el flag (más superficie de bug
y de RLS); (c) el Gate 0 (D + modelo aprobado) lo pide **derivado** explícitamente (RTR.4.2). El costo del
derivado es un `EXISTS` correlado por fila de lista, cubierto por el índice parcial `treatments_open_by_profile`
(O(log n)) — despreciable para el volumen del MVP. Además el derivado es **naturalmente offline-correcto**: se
computa del SQLite local sin depender de que un trigger server-side haya corrido.

## 10. Migración — numeración y deploy

- **Número**: `0123` — la última as-built es `0122_drop_visual_id_alt.sql` (verificado en
  `supabase/migrations/`). El delta ocupa un solo archivo lógico (tabla + FK + triggers + RLS + CHECKs + CREATE OR
  REPLACE del gating), mismo criterio que `0036` (tabla + `ALTER` de la tabla relacionada en una unidad).
- **Toca una función gateada existente**: `0123` hace `CREATE OR REPLACE public.tg_sanitary_events_gating()`
  (nacida en 0054, extendida en 0091). Moldear sobre su cuerpo VIGENTE en el remoto (memoria "Base de re-CREATE de
  función") y re-correr las suites que la tocan (gating de spec 03 + sanitary). El re-Gate-1 revisa este cambio.
- **Deploy gateado a Raf**: la migración y la stream se aplican tras Gate 1 PASS + Puerta 1. Orden: (1) aplicar
  `0123` al remoto (Management API, BEGIN/COMMIT); (2) recién entonces pegar `ev_treatments` en el dashboard de
  PowerSync → Validate → Deploy (la tabla debe existir o el Validate falla); (3) `notify pgrst`.

## Focos Gate 1 (`security_analyzer` modo `spec`)

> **Re-Gate-1** tras foldear los 5 findings del FAIL previo (SEC-TRT-01..04 + colisión gating 0091). Estado de
> cada uno abajo.

1. **RLS de `treatments` fail-closed** — SELECT/INSERT/UPDATE derivan el tenant SIEMPRE de
   `establishment_of_profile(animal_profile_id)` (el perfil real), nunca de la columna denormalizada; sin GRANT
   DELETE. Verificar que un usuario sin rol en el campo no lee ni escribe (RTR.7.1).
2. **UPDATE amplia (`has_role_in`) + inmutabilidad de columnas [SEC-TRT-01 foldeado]** — la UPDATE amplia (fiel a
   D-2) queda segura por el trigger `tg_treatments_immutable_columns` (§2 (3c)): la única mutación es `ended_at`
   NULL→instante. Verificar que un PATCH de `created_by`/`deleted_at`/`product_name`/`kind`/`notes`/`started_at` o
   un `ended_at=NULL` (des-finalizar) NO surte efecto (RTR.7.7/RTR.7.8).
3. **Anti-spoof del tenant denormalizado** — `tg_force_establishment_id_from_profile` en INSERT **y** UPDATE:
   confirmar que un `UPDATE treatments SET establishment_id = <ajeno>` por PostgREST no fuga la fila a la stream
   del otro campo (RTR.7.2/RTR.7.4).
4. **Anti-IDOR del `treatment_id` [SEC-TRT-03 foldeado]** — `tg_sanitary_events_treatment_check` en `before insert
   or update` **incondicional**: una aplicación no puede linkear a un tratamiento de otro animal/tenant NI moverse
   a otro animal por UPDATE de `animal_profile_id` (RTR.2.6/RTR.7.3). Verificar 23514 cross-animal y 23503 de
   tratamiento inexistente/borrado.
5. **`created_by` forzado + inmutable [SEC-TRT-01]** — `tg_force_created_by_auth_uid` en INSERT + pin a OLD en
   UPDATE: el "quién" de la vigilancia no es spoofeable ni editable (RTR.7.7).
6. **Topes server-side de texto libre [SEC-TRT-02 foldeado]** — CHECKs `product_name` ≤ 120 y `notes` ≤ 1000
   (constantes `TREATMENT_PRODUCT_MAX_LENGTH` / `TREATMENT_NOTES_MAX_LENGTH`, compartidas con el sanitizer del
   cliente). RTR.1.9/RTR.1.10.
7. **`revoke execute` en las `security definer` nuevas [SEC-TRT-04 foldeado]** — `tg_sanitary_events_treatment_check`
   y `tg_sanitary_events_gating` (re-afirmado) revocan execute de `public, authenticated, anon` (patrón 0091/0055).
8. **Exención de gating de las aplicaciones [colisión 0091 foldeada + LOW-1 hardening]** —
   `tg_sanitary_events_gating` CREATE OR REPLACE con short-circuit acotado `treatment_id IS NOT NULL AND
   event_type <> 'vaccination' → return new`: verificar que (a) una aplicación de tratamiento (treatment/
   deworming/other) pasa aunque el rodeo no tenga el data_key, (b) la rama de maniobra (treatment_id NULL) queda
   EXACTA (vaccination/deworming/treatment siguen gateados), y (c) un INSERT event_type='vaccination' +
   treatment_id del mismo animal **NO** saltea el gating de `vacunacion` (auto-exención LOW-1 cerrada). RTR.2.7.
   **Toca función gateada existente (0091).**
9. **Grants** — `select, insert, update` a `authenticated`; `all` a `service_role`; **sin** delete a
   `authenticated`.
10. **Stream `ev_treatments`** — scope `establishment_id IN org_scope AND deleted_at IS NULL`, JOIN-free, paridad
    con `ev_sanitary_events`; `treatment_id` baja por el `SELECT *` de `ev_sanitary_events` sin ampliar su scope.
