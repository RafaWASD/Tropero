-- 0001_users.sql
-- Crea la tabla de perfil de aplicación `public.users` (FK a `auth.users`).
-- Cubre: R1.1, R1.2, R2.1, R2.3, R8.1, R8.2 (schema del perfil).
-- Las policies de RLS van en 0006_rls_users.sql (T1.6). Acá habilitamos RLS
-- y emitimos GRANTs (sin policies, la tabla queda cerrada al Data API hasta
-- T1.6 — defensa pasiva).

-- 1. Schema
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null,
  email       text not null,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on table public.users is
  'Perfil de la app, vinculado 1:1 con auth.users vía FK. ';

-- 2. Indexes
create unique index users_email_active
  on public.users (email)
  where deleted_at is null;

create index users_deleted_at
  on public.users (deleted_at);

-- 3. Trigger: auto-actualizar updated_at en cada UPDATE
create or replace function public.tg_users_set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.tg_users_set_updated_at();

-- 4. Trigger desde auth.users: al crearse un user en auth, insertar fila en public.users.
-- Toma `name` del raw_user_meta_data si se pasó en signUp({ options: { data: { name } } }).
-- Si no se pasó, usa el local-part del email como fallback (R1.1 obliga name not null).
create or replace function public.handle_new_auth_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(trim((new.raw_user_meta_data ->> 'name')), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.users (id, name, email)
  values (new.id, v_name, new.email)
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 5. RLS — enable + GRANTs.
-- Policies en 0006_rls_users.sql.
alter table public.users enable row level security;

grant select, update on public.users to authenticated;
-- No otorgamos insert/delete: insert lo hace el trigger; delete es soft via update.
