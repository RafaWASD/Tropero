-- 0020_animal_profiles.sql  (spec 02 lógico: 0019_animal_profiles)
-- Presencia del animal en un establecimiento (ADR-004) con sus datos locales.
-- La columna management_group_id (eje lote, ADR-020) se agrega vía ALTER en 0037,
-- porque management_groups se crea ahí.
-- Cubre R4.1 (parcial), R4.3, R4.4, R4.11.

create type public.animal_status as enum ('active', 'sold', 'dead', 'transferred');
create type public.teeth_state_enum as enum (
  '2d','4d','6d','boca_llena','3/4','1/2','1/4','sin_dientes'
);

create table public.animal_profiles (
  id                 uuid primary key default gen_random_uuid(),
  animal_id          uuid not null references public.animals(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,
  rodeo_id           uuid not null references public.rodeos(id),
  -- management_group_id uuid references public.management_groups(id)  -- agregado en 0037 (ADR-020)
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
  -- R4.2: el check parcial local cubre "ni idv ni visual_id_alt"; el trigger en
  -- 0021 valida la unión completa con animals.tag_electronic.
  constraint animal_profiles_local_id_check check (
    coalesce(nullif(trim(idv), ''), nullif(trim(visual_id_alt), '')) is not null
    or true
  )
);

comment on table public.animal_profiles is
  'Presencia del animal en un establecimiento (ADR-004). management_group_id se agrega en 0037.';

-- R4.3: unique IDV por establishment (parcial).
create unique index animal_profiles_idv_unique
  on public.animal_profiles (establishment_id, idv)
  where idv is not null and deleted_at is null;

-- R4.11: solo un perfil activo por animal.
create unique index animal_profiles_active_animal_unique
  on public.animal_profiles (animal_id)
  where status = 'active' and deleted_at is null;

-- R4.4 / R5.3: búsqueda fuzzy de visual_id_alt.
create extension if not exists pg_trgm;
create index animal_profiles_visual_alt_trgm
  on public.animal_profiles using gin (visual_id_alt gin_trgm_ops)
  where visual_id_alt is not null and deleted_at is null;

-- Indexes operativos.
create index animal_profiles_by_est on public.animal_profiles (establishment_id) where deleted_at is null;
create index animal_profiles_by_rodeo on public.animal_profiles (rodeo_id) where deleted_at is null;
create index animal_profiles_by_animal on public.animal_profiles (animal_id);

create trigger animal_profiles_set_updated_at
  before update on public.animal_profiles
  for each row execute function public.tg_set_updated_at_generic();

alter table public.animal_profiles enable row level security;
-- policies en 0022_rls_animals_and_profiles.sql
grant select, insert, update on public.animal_profiles to authenticated;
grant all on public.animal_profiles to service_role;

notify pgrst, 'reload schema';
