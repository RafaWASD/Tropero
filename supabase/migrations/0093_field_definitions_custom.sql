-- 0093_field_definitions_custom.sql  (spec 03 — MODO MANIOBRAS, chunk M5 / US-13) — toca tabla de spec 02
-- ⚠️ Reabre la RLS de un catálogo GLOBAL (field_definitions, 0018) → Gate 1 OBLIGATORIO (PASS, ver
--    progress/security_spec_03-m5-custom.md). Transcribe design.md §11.1 (SQL drafteado).
--
-- Habilita DATOS CUSTOM por establecimiento (US-13): un dato custom = una fila de field_definitions con
-- establishment_id del campo (las globales de fábrica tienen establishment_id NULL = catálogo global).
--
-- NUMERACIÓN: design §11 propuso 0090; entre la redacción del spec y el deploy, 0090/0091 fueron ocupadas
--   por sanitary y 0092 quedó reservada para spec-08 → M5 arranca en 0093 (decisión del leader). Solo cambia
--   el prefijo; el contenido es el de §11.1.
--
-- SEGURIDAD (security_spec M5):
--   - M5-SEC-01: CHECK de dominio de ui_component para custom (los 7 de R13.8); globales exentas.
--   - M5-SEC-02: inmutabilidad post-creación de establishment_id/data_type/data_key/ui_component (guard, 42501).
--   - M5-SEC-03: caps/sets INPUT-1 (data_key slug≤64, description≤500, data_type set cerrado, category custom≤32).
--   - M5-SEC-04: cardinalidad≤50 / largo≤60 de config_schema.options para enum (guard, 23514).
--   - tg_field_definitions_custom_guard: SECURITY DEFINER + search_path=public + EXECUTE revocado (R13.24).
--
-- NO aplicar al remoto desde acá: lo aplica el LEADER tras gatear (Gate 1 spec hecho + Gate 2 + reviewer).

begin;

-- (a) establishment_id: NULL = global de fábrica (las globales quedan intactas); no-NULL = custom de un campo.
alter table public.field_definitions
  add column establishment_id uuid references public.establishments(id) on delete cascade;

-- (b) soft-delete para R13.19 (preserva custom_measurements ya cargadas).
alter table public.field_definitions
  add column deleted_at timestamptz;

-- (c) relajar la unicidad GLOBAL de data_key a unicidad POR establecimiento (DM5-1, default = UNIQUE parcial doble).
--   rodeo_data_config / system_default_fields FK-ean por `id` (NO por data_key) → no se rompe nada.
--   Las globales conservan data_key único entre sí (establishment_id IS NULL). Un campo puede crear un data_key
--   que colisione con el de otro campo o con uno global SIN romper (claves por (est,key)).
--   Un UNIQUE parcial para las globales + un UNIQUE compuesto para las custom (NULLs distintos en un UNIQUE
--   plano romperían "una sola global por data_key").
alter table public.field_definitions drop constraint field_definitions_data_key_key;  -- el UNIQUE global viejo
create unique index field_definitions_data_key_global
  on public.field_definitions (data_key) where establishment_id is null;
create unique index field_definitions_data_key_per_est
  on public.field_definitions (establishment_id, data_key) where establishment_id is not null;

-- (d) caps de creación server-side (R13.17): label acotado + config_schema acotado (anti storage-exhaustion,
--   patrón 0070 INPUT-1; el cliente Expo escribe a PostgREST directo → el CHECK es la capa autoritativa).
alter table public.field_definitions
  add constraint field_definitions_label_len      check (label is null or length(label) <= 80),
  add constraint field_definitions_config_size    check (config_schema is null or octet_length(config_schema::text) < 4096);

-- (d.1) CHECK de dominio de ui_component para las filas CUSTOM (M5-SEC-01b). Cierra el vector en la RAÍZ:
--   una fila custom (establishment_id is not null) solo puede tener uno de los 7 ui_component de R13.8.
--   Las globales de fábrica (establishment_id is null) quedan LIBRES (usan composite/silent_apply/etc. as-built
--   0018) → la migración NO aborta al validar esas filas.
--   ⚠️ NULL-pasa (fix-loop 2026-06-17, FALLA 1): `ui_component` es NULLABLE as-built (0018 l.14, sin NOT NULL).
--   Un CHECK que evalúa a NULL PASA. Para custom (est NOT null) + ui_component=NULL, la versión vieja
--   `establishment_id is null OR ui_component in (...)` daba `false OR (NULL in (...))` = `false OR NULL` = NULL
--   → NO rechazaba. Cerrado exigiendo no-null para custom: `is not null AND in (...)`. Globales (est null)
--   quedan exentas por el primer disyunto (intacto).
alter table public.field_definitions
  add constraint field_definitions_custom_ui_component_valid
    check (establishment_id is null
           or (ui_component is not null
               and ui_component in ('numeric','numeric_stepped','enum_single','enum_multi','text','boolean','date')));

-- (d.2) caps/sets-cerrados INPUT-1 de las columnas que recién ahora son escribibles por el cliente
--   (M5-SEC-03 / regresión de la exclusión de field_definitions en 0070):
--     - data_key: cap de largo + formato slug (identificador estable).
--     - description: cap de largo (texto libre, paridad con los *.notes capeados por 0070).
--     - category: set cerrado SOLO para custom (las globales conservan su valor as-built).
--     - data_type: set cerrado para TODAS las filas (las 4 categorías de fábrica); el guard (e) lo
--       restringe AÚN MÁS a (maniobra, propiedad) para el alta de cliente (R13.6/R13.7).
alter table public.field_definitions
  add constraint field_definitions_data_key_len     check (data_key is null or char_length(data_key) <= 64),
  add constraint field_definitions_data_key_slug    check (data_key is null or data_key ~ '^[a-z0-9_]+$'),
  add constraint field_definitions_description_len   check (description is null or char_length(description) <= 500),
  add constraint field_definitions_data_type_valid
    check (data_type in ('maniobra','evento_individual','evento_grupal','propiedad')),
  add constraint field_definitions_custom_category_len
    check (establishment_id is null or char_length(category) <= 32);

-- (e) guard de la fila custom: fuerza/valida establishment_id, bloquea alta global de cliente, inmutabilidad,
--   data_type de cliente ∈ (maniobra,propiedad), cardinalidad/largo de options. SECURITY DEFINER + revoke (R13.24).
create or replace function public.tg_field_definitions_custom_guard ()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_opts jsonb; v_opt_count int;
begin
  -- service_role / seed de fábrica: establishment_id NULL permitido SOLO sin auth (no hay auth.uid()).
  if auth.uid() is null then
    return new;  -- backend/seed: deja pasar (las globales se insertan por migración, no por cliente).
  end if;

  -- cliente authenticated: NUNCA puede crear/editar una fila global (R13.4).
  if new.establishment_id is null then
    raise exception 'authenticated clients cannot create global field_definitions (establishment_id null)'
      using errcode = '42501';
  end if;

  -- forzar el establishment al del usuario owner (R13.3): debe ser owner del establishment de la fila.
  if not public.is_owner_of(new.establishment_id) then
    raise exception 'only the owner of establishment % can create/edit a custom field', new.establishment_id
      using errcode = '42501';
  end if;

  -- ── INMUTABILIDAD del eje identidad/tenant (M5-SEC-02). ───────────────────────────────────────────
  -- establishment_id, data_type, data_key y ui_component son INMUTABLES post-creación. Un dato custom
  -- pertenece a su campo y a su tipo PARA SIEMPRE — las custom_measurements/custom_attributes lo referencian
  -- por field_definition_id; mover el establishment_id (apropiación A→B) fugaría la definición a los coworkers
  -- del otro tenant vía la stream est_field_definitions_custom (WAL), y cambiar data_type/data_key/ui_component
  -- orfanaría o re-tiparía datos ya capturados. La corrección es SOFT-DELETE + RECREAR (R13.19), no mutar.
  -- Espeja tg_animals_block_tag_change (0036). Editable post-creación = SOLO label, config_schema, active, deleted_at.
  if tg_op = 'UPDATE' and (
        old.establishment_id is distinct from new.establishment_id
     or old.data_type        is distinct from new.data_type
     or old.data_key         is distinct from new.data_key
     or old.ui_component      is distinct from new.ui_component
  ) then
    raise exception 'field_definitions.{establishment_id,data_type,data_key,ui_component} are immutable once created (row %); use soft-delete + recreate to reclassify a custom field', old.id
      using errcode = '42501';
  end if;

  -- ── data_type del alta de CLIENTE restringido a (maniobra, propiedad) (M5-SEC-03 / R13.6/R13.7). ──
  -- El CHECK de tabla (d.2) permite los 4 tipos (incl. los de fábrica); desde el cliente solo se crean
  -- los dos clasificables. Un INSERT por PostgREST con data_type='evento_individual'/'evento_grupal' se rechaza.
  if new.data_type not in ('maniobra','propiedad') then
    raise exception 'custom field_definitions.data_type must be maniobra or propiedad (got %)', new.data_type
      using errcode = '42501';
  end if;

  -- ── cardinalidad/largo de options de un enum (M5-SEC-04 / R13.17). ────────────────────────────────
  -- Vive acá (no en un CHECK plano) porque options está en config_schema jsonb. Para enum_single/enum_multi:
  --   - el array options existe y tiene cardinalidad acotada (≤50);
  --   - cada opción es un string de largo acotado (≤60).
  if new.ui_component in ('enum_single','enum_multi') then
    v_opts := new.config_schema -> 'options';
    if v_opts is null or jsonb_typeof(v_opts) <> 'array' then
      raise exception 'custom enum field % requires a config_schema.options array', new.id
        using errcode = '23514';
    end if;
    v_opt_count := jsonb_array_length(v_opts);
    if v_opt_count < 1 or v_opt_count > 50 then
      raise exception 'custom enum field % options cardinality % out of range (1..50)', new.id, v_opt_count
        using errcode = '23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_opts) e
      where jsonb_typeof(e.value) <> 'string' or char_length(e.value #>> '{}') > 60
    ) then
      raise exception 'custom enum field % has a non-string or too-long (>60) option', new.id
        using errcode = '23514';
    end if;
  end if;

  return new;
end; $$;
revoke execute on function public.tg_field_definitions_custom_guard () from public, authenticated, anon;
create trigger field_definitions_custom_guard
  before insert or update on public.field_definitions
  for each row execute function public.tg_field_definitions_custom_guard();

-- (f) reabrir RLS: SELECT globales a todos + custom solo a quien tiene rol; INSERT/UPDATE owner-only no-global.
drop policy field_definitions_select on public.field_definitions;
create policy field_definitions_select on public.field_definitions
  for select to authenticated using (
    (establishment_id is null)                                            -- catálogo global de fábrica: a todos (R13.4/R13.20)
    or (establishment_id is not null and has_role_in(establishment_id))   -- custom: solo con rol (R13.22)
  );
create policy field_definitions_insert on public.field_definitions
  for insert to authenticated with check (
    establishment_id is not null and is_owner_of(establishment_id)        -- R13.2, R13.3, R13.4
  );
create policy field_definitions_update on public.field_definitions
  for update to authenticated using (
    establishment_id is not null and is_owner_of(establishment_id)
  ) with check (
    establishment_id is not null and is_owner_of(establishment_id)        -- soft-delete (deleted_at) es UPDATE
  );
-- sin DELETE de cliente: borrar = soft-delete (deleted_at) vía update (R13.19).

grant select, insert, update on public.field_definitions to authenticated;  -- el grant viejo era solo select

-- El seed tg_rodeos_seed_data_config (0018) NO se rompe: pre-pobla rodeo_data_config con los
-- system_default_fields (solo filas de fábrica, establishment_id IS NULL); no referencia las custom.
-- Las custom NO se auto-seedean por rodeo: el owner las habilita explícitamente por rodeo (R13.10).

notify pgrst, 'reload schema';

commit;
