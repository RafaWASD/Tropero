-- 0023_event_helpers.sql  (spec 02 lógico: 0022)
-- Helper para resolver el establishment de un animal_profile sin joins manuales
-- en las policies de las tablas de eventos.
-- Cubre utilidad para R11.2.

create or replace function public.establishment_of_profile (profile_id uuid)
returns uuid language sql security definer stable
set search_path = public as $$
  select establishment_id from public.animal_profiles where id = profile_id;
$$;

comment on function public.establishment_of_profile is
  'Devuelve establishment_id de un animal_profile. Usado por policies de eventos.';

grant execute on function public.establishment_of_profile (uuid) to authenticated;
