-- 0003_user_roles.sql
-- Tabla pivot `user_roles` que materializa la relación user <-> establishment.
-- Cubre: R4.1, R4.2, R4.3, R4.7, R3.6 (lado activación/desactivación).
-- Policies de RLS en 0008_rls_membership.sql (T1.8).

-- 1. Enum de roles (ver ADR-006: solo estos tres)
create type public.user_role as enum (
  'owner',
  'field_operator',
  'veterinarian'
);

comment on type public.user_role is
  'Roles aplicables a la relación user<->establishment. Ver ADR-006.';

-- 2. Schema
create table public.user_roles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  role              public.user_role not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  deactivated_at    timestamptz
);

comment on table public.user_roles is
  'Membership pivot: un user_roles activo => acceso al establecimiento con ese rol.';

-- 3. Indexes
-- R4.3: solo un rol activo por par (user, establishment)
create unique index user_roles_active_unique
  on public.user_roles (user_id, establishment_id)
  where active = true;

create index user_roles_lookup
  on public.user_roles (user_id, active);

create index user_roles_establishment
  on public.user_roles (establishment_id, active);

-- 4. RLS enable + GRANTs (policies en 0008)
alter table public.user_roles enable row level security;

grant select, insert, update on public.user_roles to authenticated;
-- delete no se otorga: nunca se borra una fila, se desactiva (auditoría).
