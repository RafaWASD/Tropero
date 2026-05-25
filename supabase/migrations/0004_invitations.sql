-- 0004_invitations.sql
-- Tabla de invitaciones por email magic-link.
-- Cubre: R5.2 (schema), R5.6 (expiración), R8.1, R8.2.
-- Policies de RLS en 0008_rls_membership.sql (T1.8).

-- 1. Enum de estado
create type public.invitation_status as enum (
  'pending',
  'accepted',
  'cancelled',
  'expired'
);

-- 2. Schema
create table public.invitations (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments (id) on delete cascade,
  invited_by        uuid not null references public.users (id),
  email             text not null,
  role              public.user_role not null,
  token             text not null unique,
  status            public.invitation_status not null default 'pending',
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  constraint invitations_email_not_empty check (length(trim(email)) > 0),
  constraint invitations_email_lower check (email = lower(email)),
  constraint invitations_role_not_owner check (role <> 'owner')
);

comment on table public.invitations is
  'Invitaciones magic-link. role nunca es owner (se asigna en creación de establishment).';

-- 3. Indexes
create index invitations_token_pending
  on public.invitations (token)
  where status = 'pending';

create index invitations_pending_by_email
  on public.invitations (email, status);

create index invitations_by_establishment
  on public.invitations (establishment_id, status);

-- 4. Trigger: updated_at automático
create or replace function public.tg_invitations_set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger invitations_set_updated_at
  before update on public.invitations
  for each row execute function public.tg_invitations_set_updated_at();

-- 5. RLS enable + GRANTs (policies en 0008)
alter table public.invitations enable row level security;

grant select, insert, update on public.invitations to authenticated;
