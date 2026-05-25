# Spec 02 — Design

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25

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
│  │  Migrations 0012..0030 (este spec):           │    │
│  │   - species / systems / categories (config)   │    │
│  │   - rodeos                                    │    │
│  │   - animals / animal_profiles                 │    │
│  │   - eventos (weight, repro, sanitary, ...)    │    │
│  │   - animal_category_history                   │    │
│  │   - triggers: transiciones, ternero al pie,   │    │
│  │     identidad check, default rodeo,           │    │
│  │     created_by, category_history              │    │
│  │   - helpers: animal_timeline(), compute_      │    │
│  │     category(), establishment_of_profile()    │    │
│  │   - RLS policies por tabla                    │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

Se parte del estado actual del backend tras spec 01:
- 11 migrations `0001..0011` aplicadas a Supabase remoto.
- Helpers `has_role_in(uuid)`, `is_owner_of(uuid)`.
- Trigger `handle_new_establishment` que crea owner.
- Patrón de migration con `enable RLS + GRANT + policies` documentado.
- Tests Node nativo `supabase/tests/rls/run.cjs`.

Las migrations de este spec comienzan en `0012_` y siguen en adelante.

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

Adicional: trigger AFTER INSERT en `establishments` (extiende `handle_new_establishment` de migration 0011) que crea un rodeo default `(bovino, cria)` con `name = 'Rodeo principal'`.

```sql
-- 0016_default_rodeo_on_establishment.sql
create or replace function public.handle_new_establishment_default_rodeo ()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_species_id uuid;
  v_system_id  uuid;
begin
  select s.id, sys.id into v_species_id, v_system_id
  from public.species s
  join public.systems_by_species sys on sys.species_id = s.id
  where s.code = 'bovino' and sys.code = 'cria';

  if v_species_id is null or v_system_id is null then
    return new;
  end if;

  insert into public.rodeos (establishment_id, name, species_id, system_id)
  values (new.id, 'Rodeo principal', v_species_id, v_system_id);

  return new;
end;
$$;

create trigger on_establishment_created_default_rodeo
  after insert on public.establishments
  for each row execute function public.handle_new_establishment_default_rodeo();

grant execute on function public.handle_new_establishment_default_rodeo () to authenticated;
```

Cubre **R2.1..R2.6**.

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
create type public.animal_status as enum ('active', 'sold', 'dead', 'transferred');
create type public.teeth_state_enum as enum (
  '2d','4d','6d','boca_llena','3/4','1/2','1/4','sin_dientes'
);

create table public.animal_profiles (
  id                 uuid primary key default gen_random_uuid(),
  animal_id          uuid not null references public.animals(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  rodeo_id           uuid not null references public.rodeos(id),
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

Cubre **R7.1..R7.6**.

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

## Row Level Security (resumen)

| Tabla | SELECT | INSERT | UPDATE | DELETE (hard) |
|---|---|---|---|---|
| `species`, `systems_by_species`, `categories_by_system` | todos los autenticados | — (vía migration) | — | — |
| `rodeos` | `has_role_in` | `is_owner_of` | `is_owner_of` | — (soft via UPDATE) |
| `animals` | derivado de `animal_profiles` | autenticado | derivado | — |
| `animal_profiles` | `has_role_in` + `deleted_at IS NULL` | `has_role_in` | `has_role_in` | — |
| `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples` | `has_role_in(establishment_of_profile(...))` | idem | `is_owner_of OR created_by = uid()` | — |
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
  | { status: 'no_rodeos' }     // ningún rodeo activo (raro: el trigger crea uno default)
  | { status: 'active', current: Rodeo, available: Rodeo[] };
```

Expone: `switchRodeo`, `createRodeo` (solo si rol owner), `refreshRodeos`. Scoped por el establishment activo de `EstablishmentContext`.

### Hooks de animal

```typescript
useAnimals(filter?: { status?: AnimalStatus, rodeoId?: string, search?: string }): UseQueryResult<AnimalListItem[]>
useAnimal(profileId: string): UseQueryResult<AnimalDetail>
useAnimalTimeline(profileId: string): UseQueryResult<TimelineEvent[]>
useCreateAnimal(): UseMutationResult<...>
useUpdateAnimal(profileId: string): UseMutationResult<...>
useSearchAnimal(): { byTag, byIdv, byVisualAlt, isSearching }
useCategories(systemCode: string): Category[]
```

Todos los hooks orquestan `services/animals.ts` que es la única capa que toca PowerSync. La regla de capas del `architecture.md` se mantiene.

### Lógica de categoría compartida cliente/server

Crear `app/src/services/category/transitions.ts` con la implementación TypeScript de `compute_category` espejada del SQL. Se usa para preview offline (R13.4). El módulo no se acopla a Supabase — recibe un perfil + lista de eventos como input puro y retorna el target category code. Tests unitarios cubren los caminos R7.1..R7.5.

### Navegación

Nuevas pantallas dentro de `AppStack → MainTabs`:

```
MainTabs
├── Home
├── Animales              ← nuevo (tab)
│    ├── AnimalListScreen
│    ├── AnimalSearchScreen
│    ├── AnimalCreateScreen / CompletePhoneScreen (heredado)
│    └── AnimalDetailScreen  ← ficha + cronología
└── Settings
     └── RodeosScreen      ← gestión de rodeos (owner)
```

`AcceptInvitation` y `EmptyState` siguen del spec 01.

## PowerSync

### Buckets nuevos

Heredando los buckets de spec 01 (`user_self`, `est_membership`, `est_data`, `est_members`, `est_invitations`), agregamos:

- `est_rodeos`: filas de `rodeos` cuyo `establishment_id` está en el set del usuario.
- `est_animal_profiles`: filas de `animal_profiles` por establishment.
- `est_animals_local`: filas de `animals` con `id` en el set de `animal_profiles.animal_id` del establishment. (No es global; cada cliente solo sincroniza los animales presentes en sus establishments.)
- `est_weight_events`, `est_reproductive_events`, `est_sanitary_events`, `est_condition_score_events`, `est_lab_samples`: filas cuyo `animal_profile_id` cae en `est_animal_profiles`.
- `est_animal_category_history`: idem.
- `est_semen_registry`: por establishment.
- `config_global`: filas de `species`, `systems_by_species`, `categories_by_system` (todas las activas). TTL 24 hs en cliente.

### Estrategia de conflictos

`last-write-wins` por default. Excepción:
- **Eventos** (`*_events`, `lab_samples`): no se "actualizan", se borran (soft-delete) y se vuelven a crear. Si dos clientes editan el mismo evento (poco común), gana el más reciente.
- **`animal_profiles.category_id`**: gana el server por revalidación de trigger en sync (R13.4). El cliente muestra el resultado del server después de cada sync.

### Cola de sync local

PowerSync maneja la cola por default. Para casos extremos (constraints DB que fallan offline porque el cliente no vio el estado actual), el cliente captura el error de sync y muestra una alerta accionable al usuario ("este IDV ya existe en tu campo; revisá").

## Búsqueda

`useSearchAnimal` implementa el orden de R5:

1. TAG (match exacto contra `animals.tag_electronic` filtrado por presencia de perfil en el establishment activo).
2. IDV (match exacto contra `animal_profiles.idv` filtrado por establishment).
3. `visual_id_alt` fuzzy: `select * from animal_profiles where visual_id_alt % :query and establishment_id = :est and deleted_at is null order by similarity(visual_id_alt, :query) desc limit 20`.

Si el usuario escanea TAG y el animal existe globalmente pero no tiene perfil activo acá, la UI ofrece "Dar de alta en este campo" (crea nuevo `animal_profile` para el animal global existente).

## Cliente: validaciones locales

`app/src/services/animal/validation.ts`:

- `validateIdentity({ tag, idv, visualAlt })`: retorna error si todos vacíos (R13.3).
- `validateProfileForm(form, rodeoSystemCode)`: chequea coherencia (categoría override válida para sistema, etc.).
- `previewCategory(form, events)`: invoca `transitions.ts` para mostrar la categoría calculada en la UI antes de guardar.

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
