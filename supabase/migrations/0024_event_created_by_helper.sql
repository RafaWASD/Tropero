-- 0024_event_created_by_helper.sql  (spec 02 lógico: 0023)
-- Trigger reusable: autollenar created_by con auth.uid() si vino null.
-- Cubre R6.7.

create or replace function public.tg_set_created_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end; $$;

comment on function public.tg_set_created_by_auth_uid is
  'Trigger BEFORE INSERT: setea created_by = auth.uid() si vino null. Reusable por tablas de eventos.';
