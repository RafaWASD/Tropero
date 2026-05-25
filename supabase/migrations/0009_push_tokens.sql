-- 0009_push_tokens.sql
-- Tabla de Expo push tokens para enviar notificaciones (R5.11).
-- Cada user puede tener N tokens (multi-device).

-- 1. Schema
create table public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  token      text not null,
  device_id  text,
  platform   text,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  constraint push_tokens_platform_valid
    check (platform is null or platform in ('ios', 'android', 'web')),
  constraint push_tokens_token_not_empty check (length(trim(token)) > 0)
);

comment on table public.push_tokens is
  'Tokens Expo Push por user/device. Upsert por (user_id, token) actualiza last_seen.';

-- 2. Indexes
create unique index push_tokens_user_token
  on public.push_tokens (user_id, token);

create index push_tokens_user_last_seen
  on public.push_tokens (user_id, last_seen desc);

-- 3. RLS enable + policies
alter table public.push_tokens enable row level security;

-- SELECT/INSERT/UPDATE/DELETE: el user solo ve y muta sus propios tokens.
create policy push_tokens_select_self on public.push_tokens
  for select
  to authenticated
  using (user_id = auth.uid());

create policy push_tokens_insert_self on public.push_tokens
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy push_tokens_update_self on public.push_tokens
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_tokens_delete_self on public.push_tokens
  for delete
  to authenticated
  using (user_id = auth.uid());

-- 4. GRANTs
grant select, insert, update, delete on public.push_tokens to authenticated;
