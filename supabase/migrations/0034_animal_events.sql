-- 0034_animal_events.sql  (spec 02 lógico: 0033)
-- Eventos libres / observaciones (modelo Híbrido, ADR-017 matizado). Convive con
-- las 5 tablas tipadas; cubre SOLO event_type IN ('observacion','otro').
-- Cubre R6.10, R6.11, R6.12, R6.13.

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

comment on table public.animal_events is
  'Observaciones libres (modelo Híbrido). establishment_id denormalizado para RLS sin joins. Solo observacion|otro.';

create index animal_events_by_profile_created
  on public.animal_events (animal_profile_id, created_at desc)
  where deleted_at is null;
create index animal_events_by_establishment
  on public.animal_events (establishment_id, created_at desc)
  where deleted_at is null;
create index animal_events_by_author
  on public.animal_events (author_id, created_at desc);

-- author_id automático desde auth.uid() si vino null.
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

-- Validar consistencia animal_profile_id <-> establishment_id.
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

-- Rechazar UPDATE de text/structured_payload/event_type pasada la ventana;
-- columnas inmutables siempre.
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

alter table public.animal_events enable row level security;

create policy animal_events_select on public.animal_events
  for select using (has_role_in(establishment_id) and deleted_at is null);

create policy animal_events_insert on public.animal_events
  for insert with check (has_role_in(establishment_id));

create policy animal_events_update on public.animal_events
  for update using (
    has_role_in(establishment_id)
    and (author_id = auth.uid() or is_owner_of(establishment_id))
  ) with check (
    has_role_in(establishment_id)
    and (author_id = auth.uid() or is_owner_of(establishment_id))
  );

grant select, insert, update on public.animal_events to authenticated;
grant all on public.animal_events to service_role;

notify pgrst, 'reload schema';
