# Spec 02 — Design

**Status**: Aprobada 2026-05-26 · refundida 2026-05-28 (incorpora ADR-020 lote + ADR-021 plantilla de datos).
**Fecha original**: 2026-05-25

> El historial de refinamientos vive en el **Changelog** al final de este documento (audit trail, mismo principio que los ADRs).

## Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│  React Native (Expo) + TypeScript                    │
│  ┌──────────────────────────────────────────────┐    │
│  │  AuthContext         (de spec 01)             │    │
│  │  EstablishmentContext (de spec 01)            │    │
│  │  RodeoContext        (rodeo activo)           │    │
│  │  Hooks: useAnimals, useAnimalTimeline,        │    │
│  │         useSearchAnimal, useCategories        │    │
│  └──────────────────────────────────────────────┘    │
│                       ↓                              │
│         supabase-js + PowerSync client               │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  Supabase                                            │
│  ┌──────────────────────────────────────────────┐    │
│  │  Migrations 0012..0037 (este spec):           │    │
│  │   - species / systems / categories (config)   │    │
│  │   - field_definitions (catálogo GLOBAL de     │    │
│  │     datos tracqueables, ADR-021)              │    │
│  │   - system_default_fields (defaults/required  │    │
│  │     por sistema)                              │    │
│  │   - rodeos + rodeo_data_config (toggle por    │    │
│  │     rodeo, FK a field_definitions)            │    │
│  │   - management_groups (lote, ADR-020) +       │    │
│  │     animal_profiles.management_group_id       │    │
│  │   - animals / animal_profiles                 │    │
│  │   - eventos tipados (weight, repro, sanitary, │    │
│  │     condition_score, lab_samples)             │    │
│  │   - animal_events (Híbrido: 'observacion' |   │    │
│  │     'otro') con edit_window_until 15 min      │    │
│  │   - animal_category_history                   │    │
│  │   - triggers: transiciones, ternero al pie,   │    │
│  │     identidad check, pre-populate config de   │    │
│  │     rodeo, validar data_key, created_by,      │    │
│  │     author_id, category_history, bloqueo      │    │
│  │     cambio tag/idv (inmutabilidad)            │    │
│  │   - helpers: animal_timeline() (con           │    │
│  │     observacion como 7mo origen),             │    │
│  │     compute_category(),                       │    │
│  │     establishment_of_profile()                │    │
│  │   - RLS policies por tabla                    │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### Los tres ejes ortogonales (regla maestra)

Un animal vive en tres dimensiones independientes. Lo que las distingue es **qué dispara un cambio en cada una** (ADR-020):

| Eje | Tabla / columna | Cambia cuando… | Disparador |
|---|---|---|---|
| **Rodeo** | `animal_profiles.rodeo_id` | cambia el sistema productivo | manual / semi-auto, baja frecuencia |
| **Categoría** | `animal_profiles.category_id` | cambia el estado biológico | **automático por evento** (trigger, ADR-008) |
| **Lote** | `animal_profiles.management_group_id` | el productor decide reagrupar | **siempre manual, nunca por evento** |

Implicancia de diseño crítica: los triggers de transición de categoría (`0030_category_transitions`) **solo** tocan `category_id`. Nunca escriben `rodeo_id` ni `management_group_id`. Ningún trigger asigna lote (R2.18, R7.7).

Se parte del estado actual del backend tras spec 01:
- 11 migrations `0001..0011` aplicadas a Supabase remoto.
- Helpers `has_role_in(uuid)`, `is_owner_of(uuid)`.
- Trigger `handle_new_establishment` que crea owner.
- Patrón de migration con `enable RLS + GRANT + policies` documentado.
- Tests Node nativo `supabase/tests/rls/run.cjs`.

Las migrations de este spec van de `0012_` a `0037_`. La refundición 2026-05-28 reemplazó el contenido de la `0016` buggeada (`system_data_templates` por-sistema) por las **tres tablas de plantilla** de ADR-021 (`field_definitions` + `system_default_fields` + `rodeo_data_config` + triggers, todo en `0016` como unidad lógica), insertó `management_groups` + `ALTER animal_profiles ADD management_group_id` como `0036`, y movió `check_grants` a `0037`. Los bloques `0017`–`0035` **mantienen su numeración** original. Ver detalle en el Changelog y en `tasks.md`.

## Schema SQL

### Tablas de configuración (multi-especie)

```sql
-- 0012_species.sql
create table public.species (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,            -- 'bovino', 'equino', 'porcino'
  name        text not null,
  icon        text,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.species (code, name, icon, active) values
  ('bovino', 'Bovino', 'cow', true),
  ('equino', 'Equino', 'horse', false),
  ('porcino', 'Porcino', 'pig', false);

alter table public.species enable row level security;
create policy species_select on public.species for select to authenticated using (true);
grant select on public.species to authenticated;
-- No GRANT insert/update/delete: cambios vía migration.
```

```sql
-- 0013_systems_by_species.sql
create table public.systems_by_species (
  id          uuid primary key default gen_random_uuid(),
  species_id  uuid not null references public.species(id),
  code        text not null,                   -- 'cria', 'invernada', 'feedlot', 'tambo', 'cabana'
  name        text not null,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (species_id, code)
);

-- Seed para bovino
insert into public.systems_by_species (species_id, code, name, active)
select id, 'cria', 'Cría', true from public.species where code = 'bovino';

insert into public.systems_by_species (species_id, code, name, active)
select id, code, name, false from (
  values ('invernada', 'Invernada'),
         ('feedlot', 'Feedlot'),
         ('tambo', 'Tambo'),
         ('cabana', 'Cabaña')
) as t(code, name), public.species s where s.code = 'bovino';

alter table public.systems_by_species enable row level security;
create policy systems_select on public.systems_by_species for select to authenticated using (true);
grant select on public.systems_by_species to authenticated;
```

```sql
-- 0014_categories_by_system.sql
create table public.categories_by_system (
  id                   uuid primary key default gen_random_uuid(),
  system_id            uuid not null references public.systems_by_species(id),
  code                 text not null,           -- 'ternero', 'vaca_segundo_servicio', etc.
  name                 text not null,
  parent_category_id   uuid references public.categories_by_system(id),
  sort_order           int not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (system_id, code)
);

-- Seed para (bovino, cría) — categorías del MVP
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.categories_by_system (system_id, code, name, sort_order, active)
select sys.system_id, c.code, c.name, c.sort, true
from sys, (values
  ('ternero',              'Ternero',                10),
  ('ternera',              'Ternera',                20),
  ('vaquillona',           'Vaquillona',             30),
  ('vaquillona_prenada',   'Vaquillona preñada',     40),
  ('vaca_segundo_servicio','Vaca segundo servicio',  50),
  ('multipara',            'Multípara',              60),
  ('cut',                  'CUT',                    70),
  ('vaca_cabana',          'Vaca cabaña',            80),
  ('toro',                 'Toro',                   90),
  ('torito',               'Torito',                 95)
) as c(code, name, sort);

alter table public.categories_by_system enable row level security;
create policy categories_select on public.categories_by_system for select to authenticated using (true);
grant select on public.categories_by_system to authenticated;
```

Notas:
- `code` es la clave estable que los triggers usan para resolver transiciones — los nombres se pueden traducir/cambiar sin tocar lógica.
- Cubre **R1.1**, **R1.2**, **R1.3**, **R1.4**, **R1.5**.

### Rodeos

```sql
-- 0015_rodeos.sql
create table public.rodeos (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  species_id        uuid not null references public.species(id),
  system_id         uuid not null references public.systems_by_species(id),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint rodeos_name_not_empty check (length(trim(name)) > 0)
);

create index rodeos_by_est on public.rodeos (establishment_id) where deleted_at is null;
create index rodeos_lookup on public.rodeos (establishment_id, active) where deleted_at is null;

-- Constraint funcional: el (species_id, system_id) debe existir en systems_by_species y estar activo
create or replace function public.tg_rodeos_validate_species_system ()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.systems_by_species s
    where s.id = new.system_id
      and s.species_id = new.species_id
      and s.active = true
  ) then
    raise exception 'invalid species/system combination or system inactive'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger rodeos_validate_species_system
  before insert or update on public.rodeos
  for each row execute function public.tg_rodeos_validate_species_system();

-- updated_at trigger (mismo patrón que establishments)
create trigger rodeos_set_updated_at
  before update on public.rodeos
  for each row execute function public.tg_set_updated_at_generic();

-- RLS
alter table public.rodeos enable row level security;

create policy rodeos_select on public.rodeos
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy rodeos_insert on public.rodeos
  for insert with check (is_owner_of(establishment_id));

create policy rodeos_update on public.rodeos
  for update using (is_owner_of(establishment_id))
  with check (is_owner_of(establishment_id));

grant select, insert, update on public.rodeos to authenticated;
```

**Sin rodeo default**: no existe trigger de auto-creación de rodeo al crear un establecimiento. Tras el alta del establishment, el cliente lleva al usuario al wizard de "Crear rodeo" que (i) elige sistema activo, (ii) nombra el rodeo, (iii) tilda/destilda los datos de la plantilla del sistema. El rodeo se crea por INSERT explícito a `rodeos` desde el cliente; el trigger AFTER INSERT de `0016` (`tg_rodeos_seed_data_config`) pre-popula `rodeo_data_config` con los defaults del sistema. Mientras el establishment no tenga rodeo, el cliente bloquea la navegación (empty state de bloqueo total, R2.6).

### Plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo (`ADR-021`)

Tres tablas que separan tres responsabilidades (corrige el bug del catálogo-por-sistema de versiones previas — ver Changelog):

1. **`field_definitions`** — catálogo GLOBAL: cada dato tracqueable existe **una sola vez** (no atado a un sistema). Read-only desde cliente.
2. **`system_default_fields`** — qué fields vienen tildados/requeridos **por sistema** (la "plantilla"). Read-only desde cliente.
3. **`rodeo_data_config`** — estado efectivo **por rodeo** (toggle del owner). Mutable por owner.

La separación habilita el caso real "rodeo de tambo que también quiere tactear preñez": `prenez` existe en `field_definitions` (global), así que el rodeo de tambo puede habilitarlo en su `rodeo_data_config` aunque no sea default de tambo en `system_default_fields`. Sustrato del gating de maniobras de spec 03 (R2.7).

> Las tres tablas van en **una sola migration `0016`** (unidad lógica). El seed de cría es **TENTATIVO** (validación con Facundo pendiente).

```sql
-- 0016_field_template_and_rodeo_config.sql
-- (tres tablas de plantilla de datos + seed de cría + triggers. ADR-021.)
-- Nota: tg_set_updated_at_generic se reusa de spec 01 (0002); se consolida en 0017.

-- 1) Catálogo GLOBAL de datos tracqueables ---------------------------------
create table public.field_definitions (
  id              uuid primary key default gen_random_uuid(),
  data_key        text not null unique,        -- clave estable GLOBAL: 'prenez', 'peso', ...
  label           text not null,               -- texto humano para UI
  description     text,
  category        text not null,               -- 'reproductivo'|'productivo'|'sanitario'|'manejo'|'comercial'|'identificacion'
  data_type       text not null,               -- 'maniobra'|'evento_individual'|'evento_grupal'|'propiedad'
  ui_component    text,                         -- 'numeric'|'numeric_stepped'|'enum_single'|'enum_multi'|'date'|'silent_apply'|'composite'|'text'
  config_schema   jsonb,                        -- configuración específica del dato (TENTATIVO por field)
  schema_version  int not null default 1,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index field_definitions_by_category on public.field_definitions (category) where active = true;

-- Seed TENTATIVO de cría: 26 fields (23 default ON, 3 default OFF). default_enabled vive en system_default_fields.
insert into public.field_definitions (data_key, label, description, category, data_type, ui_component) values
  -- Reproductivo
  ('servicio',                'Servicio / entore',        'Registro de monta natural o IA',             'reproductivo', 'evento_individual', 'composite'),
  ('prenez',                  'Preñez',                   'Tacto: preñada / vacía',                     'reproductivo', 'maniobra',          'enum_single'),
  ('tamano_prenez',          'Tamaño de preñez',         'Cabeza / cuerpo / cola del tacto positivo',  'reproductivo', 'maniobra',          'enum_single'),
  ('tacto_vaquillona',       'Aptitud vaquillona',       'Apta / no apta / diferida',                  'reproductivo', 'maniobra',          'enum_single'),
  ('parto',                   'Parto',                    'Registro de parto + ternero al pie',         'reproductivo', 'evento_individual', 'composite'),
  ('aborto',                  'Aborto',                   'Registro de aborto',                         'reproductivo', 'evento_individual', 'date'),
  ('destete',                 'Destete',                  'Destete del ternero (usa pesaje)',           'reproductivo', 'evento_individual', 'composite'),
  ('raspado_toros',          'Raspado de toros',         'Tricomoniasis + campylobacteriosis',         'reproductivo', 'maniobra',          'composite'),
  ('inseminacion',            'Inseminación artificial',  'IATF / IA con pajuela',                      'reproductivo', 'maniobra',          'composite'),
  -- Productivo
  ('peso',                    'Pesaje',                   'Peso vivo en balanza o manual',              'productivo',   'maniobra',          'numeric'),
  ('peso_destete',           'Peso al destete',          'Peso del ternero al destete',                'productivo',   'evento_individual', 'numeric'),
  ('condicion_corporal',      'Condición corporal',       'Score 1.00 - 5.00 (escala media)',           'productivo',   'maniobra',          'numeric_stepped'),
  ('peso_nacimiento',         'Peso al nacer',            'Peso del ternero al nacimiento',             'productivo',   'evento_individual', 'numeric'),
  -- Sanitario
  ('vacunacion',              'Vacunación',               'Aplicación de vacuna (silenciosa)',          'sanitario',    'maniobra',          'silent_apply'),
  ('brucelosis',              'Brucelosis (sangrado)',    'Extracción de sangre con tubo numerado',     'sanitario',    'maniobra',          'composite'),
  ('antiparasitario_interno', 'Antiparasitario interno',  'Desparasitación interna (silenciosa)',       'sanitario',    'evento_grupal',     'silent_apply'),
  ('antiparasitario_externo', 'Antiparasitario externo',  'Desparasitación externa (silenciosa)',       'sanitario',    'evento_grupal',     'silent_apply'),
  ('antibiotico',             'Antibiótico',              'Aplicación de antibiótico (silenciosa)',     'sanitario',    'evento_individual', 'silent_apply'),
  ('suplementacion',          'Suplementación min/vit',   'Minerales / vitaminas (silenciosa)',         'sanitario',    'evento_grupal',     'silent_apply'),
  ('tratamiento_curativo',    'Tratamiento curativo',     'Tratamiento de un episodio clínico',         'sanitario',    'evento_individual', 'text'),
  ('enfermedad',              'Episodio de enfermedad',   'Registro de enfermedad detectada',           'sanitario',    'evento_individual', 'text'),
  ('tuberculosis',            'Tuberculosis',             'Test de tuberculosis',                       'sanitario',    'evento_individual', 'enum_single'),
  -- Manejo
  ('dientes',                 'Estado de dientes',        'Estado dentario (dispara prompt CUT)',       'manejo',       'maniobra',          'enum_single'),
  ('observacion',             'Observación libre',        'Nota libre del operador (animal_events)',    'manejo',       'evento_individual', 'text'),
  -- Comercial
  ('compra',                  'Compra / ingreso',         'Alta por compra',                            'comercial',    'evento_individual', 'composite'),
  ('venta',                   'Venta / egreso',           'Baja por venta',                             'comercial',    'evento_individual', 'composite');

alter table public.field_definitions enable row level security;
create policy field_definitions_select on public.field_definitions
  for select to authenticated using (true);
grant select on public.field_definitions to authenticated;

create trigger field_definitions_set_updated_at
  before update on public.field_definitions
  for each row execute function public.tg_set_updated_at_generic();

-- 2) Defaults / required POR SISTEMA (la "plantilla") ----------------------
create table public.system_default_fields (
  id                  uuid primary key default gen_random_uuid(),
  system_id           uuid not null references public.systems_by_species(id),
  field_definition_id uuid not null references public.field_definitions(id),
  default_enabled     boolean not null default true,   -- viene tildado al crear rodeo del sistema
  required_for_system boolean not null default false,  -- si true, no se puede destildar a nivel rodeo
  sort_order          int not null default 0,
  unique (system_id, field_definition_id)
);

create index system_default_fields_by_system on public.system_default_fields (system_id, sort_order);

-- Seed de cría: las 26 filas anteriores, 3 con default_enabled = false.
with sys as (
  select s.id as system_id
  from public.systems_by_species s
  join public.species sp on sp.id = s.species_id
  where sp.code = 'bovino' and s.code = 'cria'
)
insert into public.system_default_fields (system_id, field_definition_id, default_enabled, required_for_system, sort_order)
select sys.system_id, fd.id,
       case when fd.data_key in ('inseminacion','peso_nacimiento','tuberculosis') then false else true end,
       false,
       row_number() over (order by fd.category, fd.label)
from sys, public.field_definitions fd;
-- En cría MVP ningún field es required (la identificación TAG/IDV/visual_id_alt es el único requisito real, R4.2).

alter table public.system_default_fields enable row level security;
create policy system_default_fields_select on public.system_default_fields
  for select to authenticated using (true);
grant select on public.system_default_fields to authenticated;

-- 3) Estado efectivo POR RODEO (toggle del owner) --------------------------
create table public.rodeo_data_config (
  rodeo_id            uuid not null references public.rodeos(id) on delete cascade,
  field_definition_id uuid not null references public.field_definitions(id),
  enabled             boolean not null,
  custom_config       jsonb,                  -- overrides opcionales al config_schema del field
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (rodeo_id, field_definition_id)
);

create index rodeo_data_config_by_rodeo
  on public.rodeo_data_config (rodeo_id) where enabled = true;
create index rodeo_data_config_by_field
  on public.rodeo_data_config (field_definition_id) where enabled = true;

create trigger rodeo_data_config_set_updated_at
  before update on public.rodeo_data_config
  for each row execute function public.tg_set_updated_at_generic();

-- Trigger AFTER INSERT en rodeos: pre-poblar rodeo_data_config con los system_default_fields del sistema
create or replace function public.tg_rodeos_seed_data_config ()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.rodeo_data_config (rodeo_id, field_definition_id, enabled)
  select new.id, sdf.field_definition_id, sdf.default_enabled
  from public.system_default_fields sdf
  where sdf.system_id = new.system_id;
  return new;
end; $$;

create trigger rodeos_seed_data_config
  after insert on public.rodeos
  for each row execute function public.tg_rodeos_seed_data_config();

-- RLS: SELECT a todo rol del establishment del rodeo; INSERT/UPDATE solo owner; no DELETE de cliente.
-- (INSERT lo habilita el owner para agregar un field no-default del sistema — caso "tambo que tactea preñez".)
alter table public.rodeo_data_config enable row level security;

create policy rodeo_data_config_select on public.rodeo_data_config
  for select using (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id
              and has_role_in(r.establishment_id) and r.deleted_at is null)
  );

create policy rodeo_data_config_insert on public.rodeo_data_config
  for insert with check (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id and is_owner_of(r.establishment_id))
  );

create policy rodeo_data_config_update on public.rodeo_data_config
  for update using (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id and is_owner_of(r.establishment_id))
  ) with check (
    exists (select 1 from public.rodeos r
            where r.id = rodeo_data_config.rodeo_id and is_owner_of(r.establishment_id))
  );
-- No policy DELETE: deshabilitar = enabled=false; el borrado real solo por CASCADE al borrar el rodeo.

grant select, insert, update on public.rodeo_data_config to authenticated;
```

Notas:
- **Por qué tres tablas y no una por-sistema**: el bug del modelo anterior era que `system_data_templates(system_id, data_key)` ataba cada dato a un sistema, impidiendo reusarlo. Acá `field_definitions` es global (un dato existe una vez), `system_default_fields` solo marca el default por sistema, y `rodeo_data_config` referencia `field_definitions` directamente — por eso un rodeo puede habilitar **cualquier** field del catálogo (caso "tambo + preñez").
- **No hay trigger de validación contra el sistema** en `rodeo_data_config` (a diferencia del modelo viejo): el FK a `field_definitions` ya garantiza que el field existe en el catálogo, y la intención de diseño es **permitir** habilitar fields fuera del default del sistema.
- El trigger `tg_rodeos_seed_data_config` (AFTER INSERT en `rodeos`) garantiza que un rodeo recién creado nunca queda con config vacía — arranca con los `system_default_fields` del sistema.
- **Catálogo read-only**: `field_definitions` y `system_default_fields` se modifican vía migration (mismo patrón que `species`/`categories_by_system`). Solo `rodeo_data_config` es mutable (owner).
- **Gating de maniobras (spec 03)**: el mapeo maniobra→data_keys es hardcodeado (ADR-021, ver tabla en R2.7 del requirements). Una query `SELECT count(*) FROM rodeo_data_config rdc JOIN field_definitions fd ON fd.id = rdc.field_definition_id WHERE rdc.rodeo_id = ? AND fd.data_key = ANY($1) AND rdc.enabled = true` resuelve el gating en O(log n) con el index `(field_definition_id) WHERE enabled = true`. El enforcement (doble capa UI + DB) vive en spec 03.
- **Seed TENTATIVO**: 26 fields de cría (23 ON, 3 OFF: `inseminacion`, `peso_nacimiento`, `tuberculosis`). `evaluacion_toro` diferido post-MVP. Otros sistemas reciben su `system_default_fields` cuando se activen; los `field_definitions` universales ya quedan disponibles. Ajustable por migration sin reabrir spec 02.

Cubre **R2.1..R2.5**, **R2.6**, **R2.7** (nota gating), **R2.8..R2.13**.

### Lotes — agrupación de manejo (`management_groups`, `ADR-020`)

Tercer eje de organización (regla maestra). Tabla `management_groups` (scope establishment) + columna nullable `animal_profiles.management_group_id`. La UI la muestra como "Lote".

> **Orden de migration**: la tabla `management_groups` solo depende de `establishments` (existe desde spec 01), pero la columna `animal_profiles.management_group_id` depende de que `animal_profiles` ya exista (migration `0019`). Por eso esta migration se numera **`0036`** (después de todo el bloque de animal) y agrega la columna vía `ALTER TABLE`. Conceptualmente es un eje de organización paralelo al rodeo; físicamente se materializa al final.

```sql
-- 0036_management_groups.sql (ADR-020)

create table public.management_groups (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  name              text not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint management_groups_name_not_empty check (length(trim(name)) > 0)
);

create index management_groups_by_est
  on public.management_groups (establishment_id) where deleted_at is null;

create trigger management_groups_set_updated_at
  before update on public.management_groups
  for each row execute function public.tg_set_updated_at_generic();

-- Columna en animal_profiles (eje lote). Nullable: NULL = "sin grupo de manejo custom".
alter table public.animal_profiles
  add column management_group_id uuid references public.management_groups(id);

create index animal_profiles_by_management_group
  on public.animal_profiles (management_group_id) where deleted_at is null;

-- Validación: el lote debe ser del mismo establishment que el perfil (asignación exclusiva = FK simple).
create or replace function public.tg_animal_profiles_management_group_check ()
returns trigger language plpgsql as $$
declare v_est uuid;
begin
  if new.management_group_id is null then return new; end if;
  select establishment_id into v_est
  from public.management_groups
  where id = new.management_group_id and deleted_at is null;
  if v_est is null then
    raise exception 'management_group % not found or deleted', new.management_group_id using errcode = '23503';
  end if;
  if v_est <> new.establishment_id then
    raise exception 'management_group belongs to a different establishment' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_management_group_check
  before insert or update of management_group_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_management_group_check();

-- RLS de management_groups: SELECT a todo rol activo; INSERT/UPDATE/soft-DELETE solo owner.
alter table public.management_groups enable row level security;

create policy management_groups_select on public.management_groups
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy management_groups_insert on public.management_groups
  for insert with check (is_owner_of(establishment_id));

create policy management_groups_update on public.management_groups
  for update using (is_owner_of(establishment_id))
  with check (is_owner_of(establishment_id));

grant select, insert, update on public.management_groups to authenticated;
-- La ASIGNACIÓN de un animal a un lote es un UPDATE de animal_profiles.management_group_id,
-- cubierto por la policy animal_profiles_update (has_role_in) — cualquier rol operativo activo (R2.17, R11.5).
```

Notas:
- **Asignación exclusiva**: un animal está en a lo sumo un lote (FK simple, no M2M). Transferir = `UPDATE ... SET management_group_id = X`. Sin historial en MVP.
- **Ortogonalidad** (R7.7): ningún trigger de transición de categoría toca `management_group_id`. El ternero al pie nace con `management_group_id = NULL` (R9.1).
- **Regla de display** "lote si tiene, si no categoría" (R2.16): la implementa el cliente. Spec 02 expone `management_group_id` + `category_id` para que el cliente agrupe.
- **Soft-delete de un lote con animales asignados**: el cliente debe reasignar esos animales a `NULL` antes (o la operación se maneja en la capa de servicio); a nivel DB el FK no cascadea el soft-delete. Decisión de UX en spec 09/cliente.

Cubre **R2.14..R2.18**, parte de **R4.1** (columna), **R9.1** (ternero sin lote), **R7.7** (ortogonalidad).

### Helper genérico `tg_set_updated_at_generic`

Antes de las tablas de eventos definimos un trigger reusable para `updated_at`:

```sql
-- 0017_generic_updated_at.sql
create or replace function public.tg_set_updated_at_generic ()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
```

(El patrón ya existe en `0002` para establishments. Lo reusamos.)

### Animals y AnimalProfiles

```sql
-- 0018_animals.sql
create table public.animals (
  id              uuid primary key default gen_random_uuid(),
  tag_electronic  text,
  species_id      uuid not null references public.species(id),
  sex             text not null check (sex in ('male', 'female')),
  birth_date      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- TAG único globalmente cuando existe y la fila no está soft-deleted
create unique index animals_tag_unique
  on public.animals (tag_electronic)
  where tag_electronic is not null and deleted_at is null;

-- Trigger: rechazar species_id inactiva (R3.3)
create or replace function public.tg_animals_validate_species ()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.species where id = new.species_id and active = true) then
    raise exception 'species inactive or not found' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animals_validate_species
  before insert or update on public.animals
  for each row execute function public.tg_animals_validate_species();

create trigger animals_set_updated_at
  before update on public.animals
  for each row execute function public.tg_set_updated_at_generic();

alter table public.animals enable row level security;
-- policies definidas en 0021_rls_animals_and_profiles.sql (mismo archivo que profiles para no ir y volver)
grant select, insert, update on public.animals to authenticated;
```

```sql
-- 0019_animal_profiles.sql
-- Nota: la columna `management_group_id` (eje lote, ADR-020) se agrega vía ALTER en
-- la migration 0036, porque la tabla `management_groups` se crea recién ahí. A nivel
-- del modelo lógico (R4.1) el perfil tiene management_group_id; físicamente entra en 0036.
create type public.animal_status as enum ('active', 'sold', 'dead', 'transferred');
create type public.teeth_state_enum as enum (
  '2d','4d','6d','boca_llena','3/4','1/2','1/4','sin_dientes'
);

create table public.animal_profiles (
  id                 uuid primary key default gen_random_uuid(),
  animal_id          uuid not null references public.animals(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  rodeo_id           uuid not null references public.rodeos(id),
  -- management_group_id uuid references public.management_groups(id)  -- agregado en 0036 (ADR-020)
  idv                text,
  visual_id_alt      text,
  category_id        uuid not null references public.categories_by_system(id),
  category_override  boolean not null default false,
  breed              text,
  coat_color         text,
  birth_weight       numeric(7,2),
  teeth_state        public.teeth_state_enum,
  is_cut             boolean not null default false,
  entry_date         date,
  entry_weight       numeric(7,2),
  entry_origin       text,
  exit_date          date,
  exit_reason        text,
  exit_weight        numeric(7,2),
  exit_price         numeric(12,2),
  status             public.animal_status not null default 'active',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- R4.2: al menos uno de los tres identificadores tiene texto.
  -- Como TAG vive en `animals`, el check parcial se completa con un trigger;
  -- el constraint local cubre el caso "ni idv ni visual_id_alt".
  constraint animal_profiles_local_id_check check (
    coalesce(nullif(trim(idv), ''), nullif(trim(visual_id_alt), '')) is not null
    or true  -- el trigger valida la unión con tag_electronic
  )
);

-- Unique IDV por establishment (R4.3)
create unique index animal_profiles_idv_unique
  on public.animal_profiles (establishment_id, idv)
  where idv is not null and deleted_at is null;

-- Solo un perfil activo por animal (R4.11)
create unique index animal_profiles_active_animal_unique
  on public.animal_profiles (animal_id)
  where status = 'active' and deleted_at is null;

-- Búsqueda fuzzy de visual_id_alt (R5.3, R4.4)
create extension if not exists pg_trgm;
create index animal_profiles_visual_alt_trgm
  on public.animal_profiles using gin (visual_id_alt gin_trgm_ops)
  where visual_id_alt is not null and deleted_at is null;

-- Indexes operativos
create index animal_profiles_by_est on public.animal_profiles (establishment_id) where deleted_at is null;
create index animal_profiles_by_rodeo on public.animal_profiles (rodeo_id) where deleted_at is null;
create index animal_profiles_by_animal on public.animal_profiles (animal_id);

create trigger animal_profiles_set_updated_at
  before update on public.animal_profiles
  for each row execute function public.tg_set_updated_at_generic();
```

#### Triggers de validación e identificación

```sql
-- 0020_animal_profiles_validations.sql

-- (a) R4.2: al menos uno de tag/idv/visual_alt tiene texto (mirando animals.tag_electronic)
create or replace function public.tg_animal_profiles_identity_check ()
returns trigger language plpgsql as $$
declare v_tag text;
begin
  select tag_electronic into v_tag from public.animals where id = new.animal_id;
  if coalesce(nullif(trim(v_tag), ''),
              nullif(trim(new.idv), ''),
              nullif(trim(new.visual_id_alt), '')) is null then
    raise exception 'animal must have at least one of tag_electronic, idv or visual_id_alt'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_identity_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_identity_check();

-- (b) R4.5: rodeo del mismo establishment, no soft-deleted, activo
create or replace function public.tg_animal_profiles_rodeo_check ()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.rodeos r
    where r.id = new.rodeo_id
      and r.establishment_id = new.establishment_id
      and r.active = true
      and r.deleted_at is null
  ) then
    raise exception 'rodeo does not belong to establishment or is inactive'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_rodeo_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_rodeo_check();

-- (c) R4.6: category_id debe pertenecer al system del rodeo
create or replace function public.tg_animal_profiles_category_check ()
returns trigger language plpgsql as $$
declare v_system_id uuid;
begin
  select system_id into v_system_id from public.rodeos where id = new.rodeo_id;
  if not exists (
    select 1 from public.categories_by_system c
    where c.id = new.category_id and c.system_id = v_system_id and c.active = true
  ) then
    raise exception 'category does not belong to rodeo system'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_category_check
  before insert or update on public.animal_profiles
  for each row execute function public.tg_animal_profiles_category_check();
```

#### Trigger de `category_override` automático al UPDATE manual (R4.8)

```sql
-- 0020_animal_profiles_validations.sql (continúa)

create or replace function public.tg_animal_profiles_set_override_on_manual ()
returns trigger language plpgsql as $$
begin
  -- Si la categoría cambió y no estamos dentro de un trigger de transición automática,
  -- marcamos override. Detectamos "automático" por una GUC local seteada por el trigger AUTO.
  if new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') <> 'on' then
      new.category_override := true;
    end if;
  end if;
  return new;
end; $$;

create trigger animal_profiles_set_override
  before update of category_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_set_override_on_manual();
```

El trigger de transición automática (definido más abajo) seteará `set_config('rafaq.is_auto_transition','on',true)` antes del UPDATE para evitar marcar override en automático.

#### RLS de `animals` y `animal_profiles`

```sql
-- 0021_rls_animals_and_profiles.sql

-- animal_profiles: RLS estándar por establishment
alter table public.animal_profiles enable row level security;

create policy animal_profiles_select on public.animal_profiles
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy animal_profiles_insert on public.animal_profiles
  for insert with check (has_role_in(establishment_id));
  -- field_operator y veterinarian pueden insertar (R11.5)

create policy animal_profiles_update on public.animal_profiles
  for update using (has_role_in(establishment_id))
  with check (has_role_in(establishment_id));
-- (Para bulk-edit owner-only de R11.4 se valida desde Edge Function dedicada;
--  los updates puntuales puede hacerlos cualquier rol activo.)

grant select, insert, update on public.animal_profiles to authenticated;

-- animals: visible si el usuario tiene rol en un establishment con perfil activo
create policy animals_select on public.animals
  for select using (
    deleted_at is null
    and exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id
        and has_role_in(ap.establishment_id)
    )
  );

create policy animals_insert on public.animals
  for insert with check (auth.uid() is not null);
  -- el INSERT real va acompañado de un INSERT en animal_profiles dentro de la misma
  -- operación del cliente. RLS asegura que el perfil cae en un establishment con rol.

create policy animals_update on public.animals
  for update using (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  ) with check (true);

grant select, insert, update on public.animals to authenticated;
```

Cubre **R3.1..R3.5**, **R4.1..R4.12**, **R11.1..R11.5**.

### Helper `establishment_of_profile`

Lo usan las policies de las tablas de eventos para resolver el establishment del perfil sin joins manuales.

```sql
-- 0022_event_helpers.sql
create or replace function public.establishment_of_profile (profile_id uuid)
returns uuid language sql security definer stable
set search_path = public as $$
  select establishment_id from public.animal_profiles where id = profile_id;
$$;

grant execute on function public.establishment_of_profile (uuid) to authenticated;
```

### Tablas de eventos

Patrón común: cada tabla tiene `id`, `animal_profile_id`, `session_id (nullable, FK pendiente a sessions de spec 03)`, columnas de dominio, `created_by`, `created_at`, `deleted_at`. RLS por `has_role_in(establishment_of_profile(animal_profile_id))`. Trigger para autollenar `created_by = auth.uid()`.

```sql
-- 0023_event_created_by_helper.sql
create or replace function public.tg_set_created_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end; $$;
```

```sql
-- 0024_weight_events.sql
create type public.event_source as enum ('bluetooth', 'manual', 'import_xml');

create table public.weight_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,                 -- FK opcional, sessions viene en spec 03
  weight_kg          numeric(7,2) not null check (weight_kg > 0),
  weight_date        date not null,
  time               time,
  source             public.event_source not null default 'manual',
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index weight_events_by_profile_date
  on public.weight_events (animal_profile_id, weight_date desc)
  where deleted_at is null;

create trigger weight_events_set_created_by
  before insert on public.weight_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.weight_events enable row level security;

create policy weight_events_select on public.weight_events
  for select using (
    has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null
  );

create policy weight_events_insert on public.weight_events
  for insert with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );

create policy weight_events_update on public.weight_events
  for update using (
    -- owner o created_by puede editar
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  ) with check (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );

grant select, insert, update on public.weight_events to authenticated;
```

```sql
-- 0025_reproductive_events.sql
create type public.repro_event_type as enum (
  'service','tacto','birth','abortion','weaning','drying','rejection'
);
create type public.service_type_enum as enum ('natural','ai','te');
create type public.pregnancy_status_enum as enum ('empty','small','medium','large');

-- Tabla auxiliar para semen (mínima, sin stock — fully fleshed en feature 03)
create table public.semen_registry (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  pajuela_name      text not null,
  bull_name         text,
  breed             text,
  supplier          text,
  notes             text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (establishment_id, pajuela_name)
);
alter table public.semen_registry enable row level security;
create policy semen_select on public.semen_registry for select using (has_role_in(establishment_id) and deleted_at is null);
create policy semen_insert on public.semen_registry for insert with check (has_role_in(establishment_id));
create policy semen_update on public.semen_registry for update using (is_owner_of(establishment_id));
grant select, insert, update on public.semen_registry to authenticated;

create table public.reproductive_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  event_type         public.repro_event_type not null,
  event_date         date not null,
  service_type       public.service_type_enum,
  bull_id            uuid references public.animal_profiles(id),
  semen_id           uuid references public.semen_registry(id),
  pregnancy_status   public.pregnancy_status_enum,
  estimated_days     int,
  estimated_birth    date,
  calf_id            uuid references public.animal_profiles(id),
  calf_weight        numeric(7,2),
  calf_sex           text check (calf_sex in ('male','female')),
  calf_tag_electronic text,    -- opcional al cargar el parto (R9.3)
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index reproductive_events_by_profile_date
  on public.reproductive_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger reproductive_events_set_created_by
  before insert on public.reproductive_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.reproductive_events enable row level security;
create policy reproductive_events_select on public.reproductive_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy reproductive_events_insert on public.reproductive_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy reproductive_events_update on public.reproductive_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.reproductive_events to authenticated;
```

```sql
-- 0026_sanitary_events.sql
create type public.sanitary_event_type as enum ('vaccination','deworming','treatment','test','other');
create type public.sanitary_route as enum ('intramuscular','subcutaneous','oral','topical','other');

create table public.sanitary_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  campaign_id        uuid,  -- FK a sanitary_campaigns que se introduce en feature posterior
  event_type         public.sanitary_event_type not null,
  product_name       text not null,
  active_ingredient  text,
  dose_ml            numeric(7,2),
  route              public.sanitary_route,
  event_date         date not null,
  next_dose_date     date,
  result             text,
  adverse_reaction   boolean not null default false,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index sanitary_events_by_profile_date
  on public.sanitary_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger sanitary_events_set_created_by
  before insert on public.sanitary_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.sanitary_events enable row level security;
create policy sanitary_events_select on public.sanitary_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy sanitary_events_insert on public.sanitary_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy sanitary_events_update on public.sanitary_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.sanitary_events to authenticated;
```

```sql
-- 0027_condition_score_events.sql
create table public.condition_score_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  session_id         uuid,
  score              numeric(3,2) not null
    check (score in (1.00,1.25,1.50,1.75,2.00,2.25,2.50,2.75,
                     3.00,3.25,3.50,3.75,4.00,4.25,4.50,4.75,5.00)),
  event_date         date not null,
  notes              text,
  created_by         uuid references public.users(id),
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create index condition_score_by_profile_date
  on public.condition_score_events (animal_profile_id, event_date desc)
  where deleted_at is null;

create trigger condition_score_set_created_by
  before insert on public.condition_score_events
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.condition_score_events enable row level security;
create policy condition_score_select on public.condition_score_events
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy condition_score_insert on public.condition_score_events
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy condition_score_update on public.condition_score_events
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.condition_score_events to authenticated;
```

```sql
-- 0028_lab_samples.sql
create type public.lab_sample_type as enum ('blood','scrape_tricho','scrape_campylo','other');

create table public.lab_samples (
  id                     uuid primary key default gen_random_uuid(),
  animal_profile_id      uuid not null references public.animal_profiles(id) on delete cascade,
  session_id             uuid,
  sample_type            public.lab_sample_type not null,
  tube_number            text not null,
  collection_date        date not null,
  lab_destination        text,
  result                 text,
  result_interpretation  text,
  result_received_date   date,
  notes                  text,
  created_by             uuid references public.users(id),
  created_at             timestamptz not null default now(),
  deleted_at             timestamptz
);

-- Búsqueda por tubo para vinculación automática (feature 06 lab imports)
create index lab_samples_tube on public.lab_samples (tube_number) where deleted_at is null;

create trigger lab_samples_set_created_by
  before insert on public.lab_samples
  for each row execute function public.tg_set_created_by_auth_uid();

alter table public.lab_samples enable row level security;
create policy lab_samples_select on public.lab_samples
  for select using (has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null);
create policy lab_samples_insert on public.lab_samples
  for insert with check (has_role_in(establishment_of_profile(animal_profile_id)));
create policy lab_samples_update on public.lab_samples
  for update using (
    is_owner_of(establishment_of_profile(animal_profile_id)) or created_by = auth.uid()
  );
grant select, insert, update on public.lab_samples to authenticated;
```

Cubre **R6.1..R6.8**.

### Historial de categoría

```sql
-- 0029_animal_category_history.sql
create type public.category_change_reason as enum (
  'initial','auto_transition','manual_override','revert_to_auto'
);

create table public.animal_category_history (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  from_category_id   uuid references public.categories_by_system(id),
  to_category_id     uuid not null references public.categories_by_system(id),
  changed_at         timestamptz not null default now(),
  changed_by         uuid references public.users(id),
  reason             public.category_change_reason not null
);

create index animal_category_history_by_profile
  on public.animal_category_history (animal_profile_id, changed_at desc);

-- Trigger: cada cambio en animal_profiles.category_id graba historial
create or replace function public.tg_animal_profiles_record_category_change ()
returns trigger language plpgsql as $$
declare v_reason public.category_change_reason;
begin
  if tg_op = 'INSERT' then
    v_reason := 'initial';
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, null, new.category_id, auth.uid(), v_reason);
  elsif tg_op = 'UPDATE' and new.category_id is distinct from old.category_id then
    if coalesce(current_setting('rafaq.is_auto_transition', true), 'off') = 'on' then
      v_reason := 'auto_transition';
    elsif old.category_override = true and new.category_override = false then
      v_reason := 'revert_to_auto';
    else
      v_reason := 'manual_override';
    end if;
    insert into public.animal_category_history
      (animal_profile_id, from_category_id, to_category_id, changed_by, reason)
    values (new.id, old.category_id, new.category_id, auth.uid(), v_reason);
  end if;
  return new;
end; $$;

create trigger animal_profiles_record_category_change_ins
  after insert on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_category_change();

create trigger animal_profiles_record_category_change_upd
  after update of category_id on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_category_change();

alter table public.animal_category_history enable row level security;
create policy animal_category_history_select on public.animal_category_history
  for select using (has_role_in(establishment_of_profile(animal_profile_id)));
-- Insert solo via trigger (security definer ya implícito por owner del schema)
grant select on public.animal_category_history to authenticated;
```

Cubre **R10.3**, **R12.4**.

### Transiciones automáticas

```sql
-- 0030_category_transitions.sql

-- compute_category(profile_id): recalcula desde cero (R7.6)
create or replace function public.compute_category (profile_id uuid)
returns uuid language plpgsql security definer stable
set search_path = public as $$
declare
  v_sex text;
  v_birth_date date;
  v_system_id uuid;
  v_births int;
  v_has_pos_tacto boolean;
  v_target_code text;
begin
  select a.sex, a.birth_date, r.system_id
    into v_sex, v_birth_date, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = profile_id;

  if v_sex = 'male' then
    if v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternero';
    else
      v_target_code := 'torito';   -- conservador, owner puede cambiar a 'toro'
    end if;
  else
    -- conteo de partos
    select count(*) into v_births
    from public.reproductive_events
    where animal_profile_id = profile_id
      and event_type = 'birth'
      and deleted_at is null;

    select exists (
      select 1 from public.reproductive_events
      where animal_profile_id = profile_id
        and event_type = 'tacto'
        and pregnancy_status is not null
        and pregnancy_status <> 'empty'
        and deleted_at is null
    ) into v_has_pos_tacto;

    if v_births >= 2 then
      v_target_code := 'multipara';
    elsif v_births = 1 then
      v_target_code := 'vaca_segundo_servicio';
    elsif v_has_pos_tacto then
      v_target_code := 'vaquillona_prenada';
    elsif v_birth_date is not null and (current_date - v_birth_date) < 365 then
      v_target_code := 'ternera';
    else
      v_target_code := 'vaquillona';
    end if;
  end if;

  return (select id from public.categories_by_system
          where system_id = v_system_id and code = v_target_code and active = true
          limit 1);
end; $$;

grant execute on function public.compute_category (uuid) to authenticated;

-- apply_transition: helper que setea la GUC y hace el UPDATE
create or replace function public.apply_auto_transition (profile_id uuid, target_category_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  perform set_config('rafaq.is_auto_transition', 'on', true);
  update public.animal_profiles
    set category_id = target_category_id
    where id = profile_id;
  perform set_config('rafaq.is_auto_transition', 'off', true);
end; $$;

-- Trigger sobre reproductive_events: dispara transición incremental (R7.1..R7.3)
create or replace function public.tg_reproductive_events_apply_transition ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_override boolean;
  v_current_code text;
  v_system_id uuid;
  v_target_code text;
  v_target_id uuid;
begin
  select p.category_override, c.code, r.system_id
    into v_override, v_current_code, v_system_id
  from public.animal_profiles p
  join public.categories_by_system c on c.id = p.category_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  if v_override is null or v_override = true then
    return new;  -- override activo => no tocamos
  end if;

  if new.event_type = 'tacto'
     and new.pregnancy_status is not null
     and new.pregnancy_status <> 'empty'
     and v_current_code = 'vaquillona' then
    v_target_code := 'vaquillona_prenada';
  elsif new.event_type = 'birth'
        and v_current_code = 'vaquillona_prenada' then
    v_target_code := 'vaca_segundo_servicio';
  elsif new.event_type = 'birth'
        and v_current_code = 'vaca_segundo_servicio' then
    v_target_code := 'multipara';
  else
    return new;
  end if;

  select id into v_target_id from public.categories_by_system
    where system_id = v_system_id and code = v_target_code and active = true;

  if v_target_id is null then
    -- R7.5: log y NO bloquear el insert
    raise warning 'auto transition target % not found for system %', v_target_code, v_system_id;
    return new;
  end if;

  perform public.apply_auto_transition(new.animal_profile_id, v_target_id);
  return new;
end; $$;

create trigger reproductive_events_apply_transition
  after insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_apply_transition();
```

**Ortogonalidad (R7.7)**: `apply_auto_transition` y `tg_reproductive_events_apply_transition` escriben **únicamente** `category_id` (vía el UPDATE de `apply_auto_transition`). No tocan `rodeo_id` ni `management_group_id`. Un animal que transiciona de `vaca_segundo_servicio` a `multipara` por un parto permanece en su mismo rodeo y su mismo lote. Ningún trigger del sistema asigna lote automáticamente (ADR-020 punto 6, R2.18).

Cubre **R7.1..R7.7**.

### Ternero al pie (R9)

```sql
-- 0031_calf_creation.sql
create or replace function public.tg_reproductive_events_create_calf ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mother_species_id uuid;
  v_mother_est_id uuid;
  v_mother_rodeo_id uuid;
  v_system_id uuid;
  v_calf_animal_id uuid;
  v_calf_profile_id uuid;
  v_calf_category_id uuid;
  v_calf_category_code text;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
begin
  if new.event_type <> 'birth' then return new; end if;
  if new.calf_id is not null then return new; end if;
  if new.calf_sex is null then return new; end if;
  -- calf_weight es opcional; el alta no depende de él

  select a.species_id, p.establishment_id, p.rodeo_id, r.system_id
    into v_mother_species_id, v_mother_est_id, v_mother_rodeo_id, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  -- Categoría inicial del ternero
  v_calf_category_code := case when new.calf_sex = 'male' then 'ternero' else 'ternera' end;
  select id into v_calf_category_id from public.categories_by_system
    where system_id = v_system_id and code = v_calf_category_code and active = true;

  -- 1) Crear animal global (TAG si vino, sino null)
  insert into public.animals (tag_electronic, species_id, sex, birth_date)
  values (nullif(trim(new.calf_tag_electronic), ''), v_mother_species_id, new.calf_sex, new.event_date)
  returning id into v_calf_animal_id;

  -- 2) Crear perfil del ternero
  insert into public.animal_profiles (
    animal_id, establishment_id, rodeo_id,
    visual_id_alt, category_id, category_override,
    birth_weight, entry_date, entry_origin, status
  ) values (
    v_calf_animal_id,
    v_mother_est_id,
    v_mother_rodeo_id,
    case when nullif(trim(new.calf_tag_electronic), '') is null then v_visual_fallback else null end,
    v_calf_category_id,
    false,
    new.calf_weight,
    new.event_date,
    'born_here',
    'active'
  ) returning id into v_calf_profile_id;

  -- 3) Linkear
  new.calf_id := v_calf_profile_id;
  return new;
exception
  when others then
    -- R9.4: rollback automático lo asegura Postgres por la transacción del INSERT.
    raise;
end; $$;

create trigger reproductive_events_create_calf
  before insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_create_calf();
```

Cubre **R9.1..R9.4**.

Nota: el trigger BEFORE INSERT corre antes que `tg_reproductive_events_apply_transition` (AFTER INSERT). Eso asegura que `calf_id` queda escrito en el row antes de la transición de la madre.

### Cronología

```sql
-- 0032_animal_timeline.sql
create or replace function public.animal_timeline (profile_id uuid)
returns table (
  event_kind  text,
  event_id    uuid,
  event_date  timestamptz,
  payload     jsonb
) language sql security definer stable
set search_path = public as $$
  -- Acceso: validamos en la primera línea con check de has_role_in
  select 'weight'::text, id, (weight_date::timestamptz + coalesce(time, '00:00'::time)),
         jsonb_build_object('weight_kg', weight_kg, 'source', source, 'notes', notes)
  from public.weight_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'reproductive', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'pregnancy_status', pregnancy_status,
                            'calf_id', calf_id, 'notes', notes)
  from public.reproductive_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'sanitary', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'product_name', product_name,
                            'route', route, 'notes', notes)
  from public.sanitary_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'condition_score', id, event_date::timestamptz,
         jsonb_build_object('score', score, 'notes', notes)
  from public.condition_score_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'lab_sample', id, collection_date::timestamptz,
         jsonb_build_object('sample_type', sample_type, 'tube_number', tube_number,
                            'result', result, 'received', result_received_date)
  from public.lab_samples
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'category_change', id, changed_at,
         jsonb_build_object('from', from_category_id, 'to', to_category_id, 'reason', reason)
  from public.animal_category_history
  where animal_profile_id = profile_id
    and has_role_in(establishment_of_profile(profile_id))

  order by event_date desc;
$$;

grant execute on function public.animal_timeline (uuid) to authenticated;
```

Cubre **R10.1**, **R10.2**.

### Eventos libres / observaciones (`animal_events`) — modelo Híbrido

> Tabla agregada en refinamiento 2026-05-26 (ADR-017 matizado). Convive con las 5 tablas tipadas; cubre **solo** `event_type IN ('observacion','otro')`. Los demás tipos del ADR-017 original (`salud`, `reproduccion`, `traslado`, `pesaje`, `identificacion`) **no** van acá: ya están en las 5 tablas tipadas. Esa convivencia preserva type-safety para el pilar de analytics y, a la vez, da al operador un cuaderno libre para observaciones humanas sin schema.

```sql
-- 0033_animal_events.sql
create table public.animal_events (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  author_id          uuid not null references public.users(id),
  created_at         timestamptz not null default now(),
  event_type         text not null check (event_type in ('observacion','otro')),
  text               text,
  structured_payload jsonb,
  edit_window_until  timestamptz not null default (now() + interval '15 minutes'),
  deleted_at         timestamptz
);

create index animal_events_by_profile_created
  on public.animal_events (animal_profile_id, created_at desc)
  where deleted_at is null;

create index animal_events_by_establishment
  on public.animal_events (establishment_id, created_at desc)
  where deleted_at is null;

create index animal_events_by_author
  on public.animal_events (author_id, created_at desc);

-- Trigger: setear author_id automáticamente desde auth.uid() si vino null
create or replace function public.tg_set_author_id_auth_uid ()
returns trigger language plpgsql as $$
begin
  if new.author_id is null then
    new.author_id := auth.uid();
  end if;
  return new;
end; $$;

create trigger animal_events_set_author_id
  before insert on public.animal_events
  for each row execute function public.tg_set_author_id_auth_uid();

-- Trigger: validar consistencia animal_profile_id ↔ establishment_id
-- (el cliente envía ambos; defensivamente verificamos que coinciden)
create or replace function public.tg_animal_events_validate_est ()
returns trigger language plpgsql as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.animal_profiles where id = new.animal_profile_id;
  if v_est is null then
    raise exception 'animal_profile_id not found' using errcode = '23503';
  end if;
  if v_est <> new.establishment_id then
    raise exception 'establishment_id mismatch with animal_profile' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_events_validate_est
  before insert on public.animal_events
  for each row execute function public.tg_animal_events_validate_est();

-- Trigger: rechazar UPDATE de text/structured_payload/event_type pasada la ventana
create or replace function public.tg_animal_events_enforce_edit_window ()
returns trigger language plpgsql as $$
begin
  if now() > old.edit_window_until then
    if new.text is distinct from old.text
       or new.structured_payload is distinct from old.structured_payload
       or new.event_type is distinct from old.event_type then
      raise exception 'edit window expired for animal_event %', old.id
        using errcode = '23514';
    end if;
  end if;
  -- author_id, animal_profile_id, establishment_id, created_at, edit_window_until inmutables
  if new.author_id        is distinct from old.author_id
     or new.animal_profile_id is distinct from old.animal_profile_id
     or new.establishment_id  is distinct from old.establishment_id
     or new.created_at        is distinct from old.created_at
     or new.edit_window_until is distinct from old.edit_window_until then
    raise exception 'immutable column changed on animal_event %', old.id
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_events_enforce_edit_window
  before update on public.animal_events
  for each row execute function public.tg_animal_events_enforce_edit_window();

-- RLS
alter table public.animal_events enable row level security;

create policy animal_events_select on public.animal_events
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy animal_events_insert on public.animal_events
  for insert with check (has_role_in(establishment_id));

-- UPDATE: author original (dentro o fuera de ventana — el trigger enforce qué columnas son tocables) o owner
create policy animal_events_update on public.animal_events
  for update using (
    has_role_in(establishment_id)
    and (author_id = auth.uid() or is_owner_of(establishment_id))
  ) with check (
    has_role_in(establishment_id)
    and (author_id = auth.uid() or is_owner_of(establishment_id))
  );

grant select, insert, update on public.animal_events to authenticated;
```

Notas:
- El CHECK `event_type IN ('observacion','otro')` cierra el alcance a lo que el modelo Híbrido pidió. **No** abrir a `'salud'`, `'reproduccion'`, etc. — esos ya están cubiertos por las 5 tablas tipadas (R6.1..R6.5).
- El trigger `enforce_edit_window` se aplica también al UPDATE de `deleted_at` desde el cliente, pero no lo bloquea porque solo enforce las 3 columnas de contenido + las 5 columnas inmutables. Cambiar `deleted_at` (soft-delete) es permitido siempre.
- **Evolución post-MVP**: si en uso real se valida que conviene unificar las 5 tablas tipadas + `animal_events` en un único modelo "evento genérico + capa de vistas tipadas", se evaluará entonces. Por ahora la separación se mantiene porque protege analytics. Documentado como TODO conceptual; no hay implementación pendiente.

Cubre **R6.10**, **R6.11**, **R6.12**, **R6.13**.

### Cronología v2 (incluye `animal_events`)

La función `animal_timeline` de `0032` se reemplaza para incluir el séptimo origen `observacion`.

```sql
-- 0034_animal_timeline_v2.sql
create or replace function public.animal_timeline (profile_id uuid)
returns table (
  event_kind  text,
  event_id    uuid,
  event_date  timestamptz,
  payload     jsonb
) language sql security definer stable
set search_path = public as $$
  select 'weight'::text, id, (weight_date::timestamptz + coalesce(time, '00:00'::time)),
         jsonb_build_object('weight_kg', weight_kg, 'source', source, 'notes', notes)
  from public.weight_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'reproductive', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'pregnancy_status', pregnancy_status,
                            'calf_id', calf_id, 'notes', notes)
  from public.reproductive_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'sanitary', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'product_name', product_name,
                            'route', route, 'notes', notes)
  from public.sanitary_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'condition_score', id, event_date::timestamptz,
         jsonb_build_object('score', score, 'notes', notes)
  from public.condition_score_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'lab_sample', id, collection_date::timestamptz,
         jsonb_build_object('sample_type', sample_type, 'tube_number', tube_number,
                            'result', result, 'received', result_received_date)
  from public.lab_samples
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'category_change', id, changed_at,
         jsonb_build_object('from', from_category_id, 'to', to_category_id, 'reason', reason)
  from public.animal_category_history
  where animal_profile_id = profile_id
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'observacion', id, created_at,
         jsonb_build_object('event_type', event_type, 'text', text,
                            'structured_payload', structured_payload,
                            'author_id', author_id,
                            'edit_window_until', edit_window_until)
  from public.animal_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_id)

  order by event_date desc;
$$;

grant execute on function public.animal_timeline (uuid) to authenticated;
```

Cubre **R10.1** (extendido), **R10.2**.

### Inmutabilidad de identificadores post-alta (R4.13)

Migration nueva que bloquea por trigger cualquier UPDATE de `animals.tag_electronic` o `animal_profiles.idv`. `visual_id_alt` sigue editable.

```sql
-- 0035_immutability_identifiers.sql
-- Inmutabilidad relajada (refinamiento 2026-05-26 para destrabar R12 de spec 09):
-- - Permitir NULL → valor (completar info que faltaba al alta).
-- - Bloquear valor → otro valor (reescribir identidad: rompe trazabilidad SENASA).
-- - Bloquear valor → NULL (volver a quedar "sin caravana" tras haberla tenido no es un caso de uso real;
--   si alguna vez aparece, se trata como caso edge a refinar; por defecto se rechaza).

create or replace function public.tg_animals_block_tag_change ()
returns trigger language plpgsql as $$
begin
  -- Permitir NULL → valor (asignación inicial de caravana en spec 09 R7/R8).
  if old.tag_electronic is null then
    return new;
  end if;
  -- Bloquear cualquier cambio cuando ya había un TAG cargado.
  if new.tag_electronic is distinct from old.tag_electronic then
    raise exception 'tag_electronic is immutable once set (animal %); use soft-delete + new insert to correct an erroneous TAG'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animals_block_tag_change
  before update of tag_electronic on public.animals
  for each row execute function public.tg_animals_block_tag_change();

create or replace function public.tg_animal_profiles_block_idv_change ()
returns trigger language plpgsql as $$
begin
  -- Misma política: NULL → valor permitido (completar IDV faltante al alta).
  if old.idv is null then
    return new;
  end if;
  if new.idv is distinct from old.idv then
    raise exception 'idv is immutable once set (profile %); use soft-delete + new insert to correct an erroneous IDV'
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger animal_profiles_block_idv_change
  before update of idv on public.animal_profiles
  for each row execute function public.tg_animal_profiles_block_idv_change();
```

Notas:
- `visual_id_alt` queda explícitamente **fuera** del bloqueo: es texto libre que en la práctica se carga incompleto al inicio.
- **Refinamiento 2026-05-26**: la inmutabilidad de `tag_electronic` e `idv` es **post-completitud, no post-alta**. Una vez que el campo tiene valor, no se puede cambiar. Pero `NULL → valor` está permitido para soportar el caso "animal cargado sin caravana al que después se le pone una" (spec 09 R7/R8 — asignación de caravanas). La distinción semántica: completar información que faltaba ≠ reescribir identidad. El primer caso preserva trazabilidad; el segundo la rompe.
- Tests requeridos (T2.x correspondiente): caso permitido (`NULL → 'ARG001'`) y caso prohibido (`'ARG001' → 'ARG002'`) validados por separado. También bloquear `valor → NULL` (defensivo).

Cubre **R4.13**.

## Row Level Security (resumen)

| Tabla | SELECT | INSERT | UPDATE | DELETE (hard) |
|---|---|---|---|---|
| `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields` | todos los autenticados | — (vía migration) | — | — |
| `rodeos` | `has_role_in` | `is_owner_of` | `is_owner_of` | — (soft via UPDATE) |
| `rodeo_data_config` | `has_role_in` (via join a `rodeos`) | `is_owner_of` (habilitar field no-default) | `is_owner_of` (toggle) | — (CASCADE desde `rodeos`) |
| `management_groups` (lote) | `has_role_in` + `deleted_at IS NULL` | `is_owner_of` | `is_owner_of` | — (soft via `deleted_at`) |
| `animals` | derivado de `animal_profiles` | autenticado | derivado | — |
| `animal_profiles` | `has_role_in` + `deleted_at IS NULL` | `has_role_in` | `has_role_in` (incluye asignar `management_group_id`) | — |
| `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples` | `has_role_in(establishment_of_profile(...))` | idem | `is_owner_of OR created_by = uid()` | — |
| `animal_events` (Híbrido, `'observacion' \| 'otro'`) | `has_role_in(establishment_id)` | `has_role_in(establishment_id)` | `author_id = uid() OR is_owner_of` + trigger enforce edit_window | — (soft via `deleted_at`) |
| `semen_registry` | `has_role_in` | `has_role_in` | `is_owner_of` | — |
| `animal_category_history` | `has_role_in` | (trigger) | — | — |

Cubre **R11.1..R11.5**.

## Edge Functions

Este spec **se apoya en triggers** (`ADR-012`) y no introduce Edge Functions críticas. Las únicas dos que se proponen son utilitarias y se pueden diferir si no aparecen como necesarias durante el frontend:

1. **`bulk_edit_animals`** (opcional, owner-only) — recibe `{ establishment_id, profile_ids: uuid[], updates: {...} }`. Aplica updates en lote validando que `is_owner_of(establishment_id) = true`. Sirve para "marcar 20 animales como CUT" desde la UI. **Diferir** hasta que el flujo aparezca en frontend; el RLS de UPDATE puntual ya cubre los casos del MVP.

2. **`revert_category_override`** (utilitaria) — recibe `{ profile_id }`. Verifica permisos, llama `compute_category(profile_id)` y hace el UPDATE en una transacción. Alternativa: el cliente puede hacer un update sql directo (`update animal_profiles set category_override = false, category_id = compute_category(id) where id = ?`). **Diferir**; el cliente lo resuelve nativo.

## Cliente: contextos, hooks y navegación

### Nuevo contexto: `RodeoContext`

```typescript
type RodeoState =
  | { status: 'loading' }
  | { status: 'no_rodeos' }     // establecimiento recién creado, antes de que el owner cierre el wizard de "Crear rodeo"
  | { status: 'active', current: Rodeo, available: Rodeo[] };
```

Expone: `switchRodeo`, `createRodeo` (solo si rol owner; ver wizard descrito en R2.6), `refreshRodeos`. Scoped por el establishment activo de `EstablishmentContext`. **Importante** (refinamiento 2026-05-27): el estado `no_rodeos` es el estado inicial esperado tras la creación del establishment — ya no hay rodeo default autogenerado. El cliente debe llevar al usuario al wizard de "Crear rodeo" en ese caso (CTA prominente, posiblemente bloqueo del resto de la app hasta que el wizard se cierre exitosamente).

### Hooks de animal

Spec 02 define **solo los hooks que el modelo de datos expone** (lista, detalle, timeline, mutaciones). El hook de búsqueda interactiva + alta dinámica (`useSearchAnimal`, form CREATE/EDIT con dos puertas, selección de rodeo, form dinámico por sistema, etc.) **se mueve a spec 09 `09-buscar-animal`** — esta spec ya no lo define.

```typescript
useAnimals(filter?: { status?: AnimalStatus, rodeoId?: string, search?: string }): UseQueryResult<AnimalListItem[]>
useAnimal(profileId: string): UseQueryResult<AnimalDetail>
useAnimalTimeline(profileId: string): UseQueryResult<TimelineEvent[]>     // incluye 'observacion'
useCreateAnimal(): UseMutationResult<...>                                  // primitive — UX completa en spec 09
useUpdateAnimal(profileId: string): UseMutationResult<...>
useCategories(systemCode: string): Category[]
useAnimalObservations(profileId: string): { add, softDelete, edit }        // wrapper de animal_events ('observacion'|'otro')
useRodeoDataConfig(rodeoId: string): { fields: FieldDefinition[], toggle, enableNonDefault }  // catálogo + estado por rodeo (owner-only mutaciones)
useManagementGroups(): { groups: ManagementGroup[], create, rename, softDelete }              // lote (ADR-020); create/rename/softDelete owner-only
useAssignManagementGroup(profileId: string): (groupId: string | null) => Promise<void>        // asignar/quitar lote — cualquier rol operativo
```

Todos los hooks orquestan `services/animals.ts` (+ `services/observations.ts` para `animal_events`, `services/rodeo-config.ts` para la plantilla, `services/management-groups.ts` para lote) que es la única capa que toca PowerSync. La regla de capas del `architecture.md` se mantiene.

**Nota explícita**: `useSearchAnimal` **no se define en este spec**. Spec 09 lo construye consumiendo las primitives de búsqueda definidas en R5 (queries directas a `animal_profiles` por TAG / IDV / `visual_id_alt`) y el hook de mutación `useCreateAnimal` de acá.

### Lógica de categoría compartida cliente/server

Crear `app/src/services/category/transitions.ts` con la implementación TypeScript de `compute_category` espejada del SQL. Se usa para preview offline (R13.4). El módulo no se acopla a Supabase — recibe un perfil + lista de eventos como input puro y retorna el target category code. Tests unitarios cubren los caminos R7.1..R7.5.

### Navegación

Nuevas pantallas dentro de `AppStack → MainTabs` que **define este spec**:

```
MainTabs
├── Home
├── Animales              ← nuevo (tab)
│    ├── AnimalListScreen
│    └── AnimalDetailScreen  ← ficha + cronología (incluye observaciones)
└── Settings
     └── RodeosScreen      ← gestión de rodeos (owner)
```

`AnimalSearchScreen` y `AnimalCreateScreen` **no se definen acá** — pertenecen a spec 09 `09-buscar-animal` (UX de búsqueda + alta interactiva + form dinámico por rodeo + dos puertas manual/BLE). `AcceptInvitation` y `EmptyState` siguen del spec 01.

## PowerSync

### Buckets nuevos

Heredando los buckets de spec 01 (`user_self`, `est_membership`, `est_data`, `est_members`, `est_invitations`), agregamos:

- `est_rodeos`: filas de `rodeos` cuyo `establishment_id` está en el set del usuario.
- `est_rodeo_data_config`: filas de `rodeo_data_config` cuyo `rodeo_id` cae en `est_rodeos`. Necesario para que el wizard de creación de rodeo, la pantalla de gestión y el gating de maniobras (spec 03) funcionen offline.
- `est_management_groups`: filas de `management_groups` cuyo `establishment_id` está en el set del usuario. Necesario para que la asignación de lote funcione offline (R13.2).
- `est_animal_profiles`: filas de `animal_profiles` por establishment (incluye `management_group_id`).
- `est_animals_local`: filas de `animals` con `id` en el set de `animal_profiles.animal_id` del establishment. (No es global; cada cliente solo sincroniza los animales presentes en sus establishments.)
- `est_weight_events`, `est_reproductive_events`, `est_sanitary_events`, `est_condition_score_events`, `est_lab_samples`: filas cuyo `animal_profile_id` cae en `est_animal_profiles`.
- `est_animal_events`: filas de `animal_events` cuyo `establishment_id` está en el set del usuario (filtrado por la columna denormalizada — no requiere join). Modelo Híbrido (refinamiento 2026-05-26).
- `est_animal_category_history`: idem.
- `est_semen_registry`: por establishment.
- `config_global`: filas de `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields` (todas las activas). TTL 24 hs en cliente. Necesario para que el wizard de creación de rodeo pueda renderizar los toggles (catálogo global + defaults del sistema) offline.

### Estrategia de conflictos

`last-write-wins` por default. Excepción:
- **Eventos** (`*_events`, `lab_samples`): no se "actualizan", se borran (soft-delete) y se vuelven a crear. Si dos clientes editan el mismo evento (poco común), gana el más reciente.
- **`animal_profiles.category_id`**: gana el server por revalidación de trigger en sync (R13.4). El cliente muestra el resultado del server después de cada sync.

### Cola de sync local

PowerSync maneja la cola por default. Para casos extremos (constraints DB que fallan offline porque el cliente no vio el estado actual), el cliente captura el error de sync y muestra una alerta accionable al usuario ("este IDV ya existe en tu campo; revisá").

## Búsqueda (primitives de R5 consumidas por spec 09)

> El hook `useSearchAnimal` y la pantalla `AnimalSearchScreen` **se definen en spec 09** (refinamiento 2026-05-26). Esta sección documenta solo las **primitives de búsqueda a nivel datos** que spec 09 consume.

Orden canónico (R5):

1. TAG (match exacto contra `animals.tag_electronic` filtrado por presencia de perfil en el establishment activo).
2. IDV (match exacto contra `animal_profiles.idv` filtrado por establishment).
3. `visual_id_alt` fuzzy: `select * from animal_profiles where visual_id_alt % :query and establishment_id = :est and deleted_at is null order by similarity(visual_id_alt, :query) desc limit 20`.

Caso especial cubierto a nivel datos: si el TAG existe globalmente pero no hay perfil activo en el establishment, la query retorna el `animal_id` del global sin perfil local. La UX de "Dar de alta en este campo" (crear nuevo `animal_profile` para ese animal global) la decide y orquesta spec 09.

## Cliente: validaciones locales

`app/src/services/animal/validation.ts`:

- `validateIdentity({ tag, idv, visualAlt })`: retorna error si todos vacíos (R13.3).
- `validateProfileForm(form, rodeoSystemCode)`: chequea coherencia (categoría override válida para sistema, etc.).
- `previewCategory(form, events)`: invoca `transitions.ts` para mostrar la categoría calculada en la UI antes de guardar.

## Motor de form dinámico por rodeo (consumido por spec 09 y spec 03)

Dos consumos distintos del modelo de datos por rodeo:

1. **Spec 09 — form de alta de animal**: renderiza campos según el `system_id` del rodeo seleccionado. Las **categorías disponibles** por sistema viven en `categories_by_system` (seedeada por T1.4). Spec 09 lee esa tabla para popular el dropdown de categoría sugerida + override (R4.7, R4.8). En MVP los campos del form son **los mismos para todos los sistemas activos** (solo `(bovino, cria)` está activo, así que la pregunta es trivial). Las columnas de `animal_profiles` cubren el superset razonable (`breed`, `coat_color`, `birth_weight`, `entry_*`, etc.).

2. **Spec 03 — gating de maniobras**: una maniobra tiene un set de `data_keys` requeridos (mapeo hardcodeado, ADR-021). Por ejemplo, **tacto** requiere `prenez` y `tamano_prenez` con `enabled = true` en el `rodeo_data_config` del rodeo destino. Una query de la forma `SELECT count(*) FROM rodeo_data_config rdc JOIN field_definitions fd ON fd.id = rdc.field_definition_id WHERE rdc.rodeo_id = ? AND fd.data_key = ANY($1) AND rdc.enabled = true` resuelve el gating en O(log n) con el index `(field_definition_id) WHERE enabled = true`. La UI del wizard de maniobras lee `rodeo_data_config` para deshabilitar/explicar las maniobras incompatibles con el rodeo elegido (capa UI); la capa DB rechaza persistir el evento gateado. Ambas capas en spec 03.

3. **Wizard de creación de rodeo (spec 02)**: el cliente lee `field_definitions` (catálogo global) join `system_default_fields` filtrando por el `system_id` elegido, renderiza una lista de toggles con su `default_enabled`, y al confirmar hace INSERT en `rodeos` + UPDATEs sobre `rodeo_data_config` (las filas ya existen porque el trigger AFTER INSERT las pre-pobló). Si el usuario quiere habilitar un dato que no es default del sistema, el cliente hace un INSERT en `rodeo_data_config` (permitido al owner, R2.12).

- **Por qué tres tablas tipadas y no JSONB ni catálogo-por-sistema**: data analytics es pilar del producto. Queries como "¿qué rodeos tracquean preñez?" o "promedio de tasa de preñez por sistema" salen naturales con tablas tipadas; con JSONB requieren `custom_config->>...::boolean` + GIN y son frágiles. El catálogo-por-sistema (modelo viejo) impedía reusar un dato entre sistemas (bug "tambo + preñez"); el catálogo **global** (`field_definitions`) lo resuelve.
- **Evolución post-MVP**: cuando se habilite un segundo sistema (`invernada`, `feedlot`, `tambo`, `cabana`), basta sumar filas a `field_definitions` (datos nuevos) y `system_default_fields` (sus defaults), cero código. Una tabla auxiliar para parametrizar **qué columnas de `animal_profiles`** mostrar por sistema (distinto de los data_keys tracqueables) queda diferida hasta tener ≥2 sistemas activos.
- **No-objetivo de este spec**: spec 02 **no implementa** la pantalla del wizard de maniobras ni el form de alta de animal. Solo expone la fuente de configuración (`categories_by_system`, `field_definitions`, `system_default_fields`, `rodeo_data_config`) y el sustrato para el gating.

## Alternativas descartadas

### 1. Categorías hardcoded en enum SQL

**Pros**: schema más compacto, menos joins.
**Contras**:
- Cada nuevo sistema/especie requiere migration con `ALTER TYPE` (no se puede borrar valor de un enum sin recrear la tabla).
- Imposible activar/desactivar categorías o renombrarlas sin migration.
- Para multi-especie / multi-sistema el enum se hincha y mezcla dominios.
**Razón**: el contexto del producto explícitamente prepara multi-especie/multi-sistema (`CONTEXT/04`, `CONTEXT/08`). Tablas de configuración son la forma estándar.

### 2. Categoría como vista derivada (sin almacenarla)

**Pros**: nunca se desincroniza con los eventos.
**Contras**:
- Imposible hacer override manual (categoría sería función pura de eventos).
- `ADR-008` rechaza explícitamente esta opción por el caso real del campo (compra de animal sin historial cargado, decisiones del operador, etc.).
**Razón**: el override manual es un requisito explícito del producto.

### 3. Edge Function `create_animal` orquestadora en lugar de RLS + triggers

**Pros**:
- Validaciones complejas en un solo lugar TypeScript.
- Service role bypassa RLS internamente.
**Contras**:
- Más infraestructura para mantener.
- Pierde la "una roundtrip" — el cliente offline tendría que diferir el alta hasta tener red.
- `ADR-012` ya estableció el patrón: preferir trigger Postgres + RLS para escrituras simples.
**Razón**: el caso de alta de animal es perfectamente expresable con RLS + triggers (validación de identidad, default de categoría, ternero al pie). Edge Function no aporta.

### 4. Ternero como sub-registro de la madre (sin tabla independiente)

**Pros**:
- Modelo más simple a primera vista.
**Contras**:
- El ternero necesita su propia cronología de eventos (peso, sanidad).
- Por ley SENASA tiene que tener TAG propio dentro de la semana → es un animal con identidad.
- El acceptance criteria 3 explícitamente pide "entidad independiente".
**Razón**: dejar el ternero como `animals + animal_profiles` propio es lo único que cierra el caso de uso real.

### 5. Almacenar timeline como tabla materializada en lugar de UNION ALL

**Pros**:
- Lecturas más rápidas.
- Sync más simple en PowerSync (un solo bucket por timeline).
**Contras**:
- Triggers sobre cada tabla de eventos para mantener la materialización en sync — fragil.
- Duplicación de datos.
- Reescritura en cada cambio de schema de eventos.
**Razón**: la función `animal_timeline` con `UNION ALL` es suficiente para los volúmenes del MVP (un campo bovino típico: 100-2000 animales, 5-20 eventos por año por animal). Si en producción se vuelve lenta, materializamos como optimización después.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Trigger de transición pisa override por bug de GUC | Tests específicos: insertar tacto positivo sobre vaquillona con override → categoría NO cambia. |
| Trigger BEFORE INSERT de ternero rompe la transacción del parto si falla | Tests: parto con `calf_tag_electronic` duplicado rollbackea el evento. |
| Constraint de identificación rechaza el alta de ternero sin TAG ni IDV | Fallback `visual_id_alt = 'recién nacido — pendiente de caravana'` aplicado por el mismo trigger. Tests cubren caso. |
| Cliente preview de categoría diverge del server | Módulo TypeScript compartido + tests unitarios. Gana el server al sync. |
| RLS de eventos genera N joins lentos | Helper `establishment_of_profile` es stable + index `animal_profiles_by_animal`. Plan ejecutivo: monitorear con `EXPLAIN ANALYZE` en QA. |
| Búsqueda fuzzy de `visual_id_alt` lenta | Índice GIN trigram + límite a 20 resultados. |
| Sync de tablas de configuración con TTL stale | Forzar refresh al detectar cambio de schema vía version-stamp en `species` (a futuro). En MVP, refresh al primer login del día. |
| Migration 0031 (ternero) muy compleja para revisar | Dividir en archivos: 0030 transitions, 0031 calf creation, 0032 timeline — cada uno auditable independientemente. |
| Owner deshabilita en un rodeo un data_key que ya tiene eventos cargados | El cliente debe avisar antes de destildar ("este dato tiene N eventos cargados"); no se borran datos históricos. Validación de UX en spec 03/cliente. |
| Soft-delete de un lote con animales asignados | El cliente reasigna esos animales a `NULL` antes del soft-delete (o la capa de servicio lo hace); el FK no cascadea el soft-delete. |

## Dependencias del spec

- Spec 01 done (Fase 1+2 backend). ✅ ya cumplido.
- `pg_trgm` extension habilitada en Supabase (estándar en Postgres 14+ remoto). Verificar en T1.1.
- `auth.uid()` disponible en sesiones autenticadas — ya validado por spec 01.

## Notas para el implementer (referencia rápida)

- Cada migration nueva sigue el patrón `enable RLS + GRANT + policies` del `design.md` de spec 01.
- Tests Node nativo en `supabase/tests/rls/` y `supabase/tests/edge/` (cuando aplique). Patrón establecido en spec 01.
- Patrón **split insert + select** sigue vigente (`ADR-012`): los inserts en `animal_profiles` y eventos que disparan triggers de transición se hacen sin `.select()` + un select separado para obtener el estado final.
- Commits en español, presente, descriptivo.

Ver `tasks.md` para el plan de ejecución paso a paso.

## Changelog

> Audit trail del design. No se borra (mismo principio que los ADRs). Orden cronológico inverso.

- **2026-05-28 — Refundición consolidada (ADR-020 lote + ADR-021 plantilla de datos)**:
  - **Plantilla de datos (ADR-021)**: se reemplazó el contenido de la migration `0016` (antes `system_data_templates` catálogo *por sistema*, con bug "no reusa datos entre sistemas") por las **tres tablas** `field_definitions` (catálogo global) + `system_default_fields` (defaults por sistema) + `rodeo_data_config` (toggle por rodeo, FK a `field_definitions`), todo en `0016`. Seed de 26 fields de cría (TENTATIVO). Trigger `tg_rodeos_seed_data_config` ahora pre-popula desde `system_default_fields`. Se eliminó el trigger de validación contra el sistema (el FK al catálogo global + la intención de permitir fields no-default lo hacen innecesario). RLS de `rodeo_data_config` ahora permite INSERT al owner (habilitar field no-default — caso "tambo + preñez").
  - **Lote (ADR-020)**: nueva migration `0036_management_groups.sql` — tabla `management_groups` (scope establishment) + `ALTER animal_profiles ADD management_group_id` + trigger de validación mismo-establishment + RLS (crear/editar/borrar solo owner; asignar animal = UPDATE de `animal_profiles` por cualquier rol operativo). `check_grants` movido a `0037`.
  - **Ortogonalidad (R7.7)**: nota explícita de que los triggers de transición de categoría solo tocan `category_id`, nunca `rodeo_id` ni `management_group_id`.
  - **Transversal**: regla maestra de 3 ejes agregada a Arquitectura; tabla RLS, buckets PowerSync (`est_management_groups`, `config_global` con catálogo de fields) y "Motor de form dinámico" actualizados al modelo de catálogo global. Header + historial movido a este Changelog. Diagrama de migrations `0012..0037`.
  - **Preservado**: todo el SQL de animals/profiles/eventos/transiciones/ternero/timeline/inmutabilidad/animal_events se mantuvo con su numeración original (`0017`–`0035`).
- **2026-05-27 — Plantilla por sistema + sin rodeo default** *(superada por la refundición 2026-05-28)*. Introdujo `system_data_templates` + `rodeo_data_config` como catálogo por-sistema (modelo con bug, reemplazado por ADR-021) y eliminó el trigger de rodeo default.
- **2026-05-26 — Refinamiento previo a aprobación**. Agregada `animal_events` (modelo Híbrido, migration de la época `0033`) + `animal_timeline_v2` con séptimo origen `observacion` + triggers de inmutabilidad de `tag_electronic`/`idv` (R4.13). Eliminadas referencias al flujo R15 (movido a spec 09). Agregada sección "Motor de form dinámico por rodeo".
