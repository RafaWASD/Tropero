-- 0002_establishments.sql
-- Crea `public.establishments`. Multi-tenant root: toda entidad de negocio
-- referencia un establishment_id.
-- Cubre: R3.1, R3.3, R3.7, R8.1, R8.2 (schema).
-- Policies de RLS en 0007_rls_establishments.sql (T1.7).

-- 1. Schema
create table public.establishments (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  province        text not null,
  city            text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  total_hectares  numeric(10, 2),
  plan_type       text not null default 'beta',
  plan_started_at timestamptz,
  plan_limits     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint establishments_name_not_empty check (length(trim(name)) > 0),
  constraint establishments_province_not_empty check (length(trim(province)) > 0)
);

comment on table public.establishments is
  'Establecimientos (campos). Root multi-tenant; nada de negocio sin establishment_id.';

-- 2. Indexes
create index establishments_active
  on public.establishments (id)
  where deleted_at is null;

-- 3. Trigger: updated_at automático
create or replace function public.tg_establishments_set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger establishments_set_updated_at
  before update on public.establishments
  for each row execute function public.tg_establishments_set_updated_at();

-- 4. RLS enable + GRANTs (policies en 0007)
alter table public.establishments enable row level security;

grant select, insert, update on public.establishments to authenticated;
-- No grant delete: soft-delete vía update de deleted_at.
