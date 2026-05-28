-- 0038_check_grants.sql  (spec 02 lógico: 0037)
-- Housekeeping: consolida grants de todas las tablas/funciones de spec 02.
-- Sigue el patrón de 0010_grants_fix.sql (Auto-expose new tables OFF).
-- Cubre: housekeeping (T1.28).

grant usage on schema public to anon, authenticated, service_role;

-- Catálogos (read-only para authenticated).
grant select on public.species to authenticated;
grant select on public.systems_by_species to authenticated;
grant select on public.categories_by_system to authenticated;
grant select on public.field_definitions to authenticated;
grant select on public.system_default_fields to authenticated;

-- Tablas operativas.
grant select, insert, update on public.rodeos to authenticated;
grant select, insert, update on public.rodeo_data_config to authenticated;
grant select, insert, update on public.management_groups to authenticated;
grant select, insert, update on public.animals to authenticated;
grant select, insert, update on public.animal_profiles to authenticated;
grant select, insert, update on public.semen_registry to authenticated;
grant select, insert, update on public.weight_events to authenticated;
grant select, insert, update on public.reproductive_events to authenticated;
grant select, insert, update on public.sanitary_events to authenticated;
grant select, insert, update on public.condition_score_events to authenticated;
grant select, insert, update on public.lab_samples to authenticated;
grant select, insert, update on public.animal_events to authenticated;
grant select on public.animal_category_history to authenticated;

-- service_role: bypassea RLS pero igual necesita grants table-level.
grant all on public.species to service_role;
grant all on public.systems_by_species to service_role;
grant all on public.categories_by_system to service_role;
grant all on public.field_definitions to service_role;
grant all on public.system_default_fields to service_role;
grant all on public.rodeos to service_role;
grant all on public.rodeo_data_config to service_role;
grant all on public.management_groups to service_role;
grant all on public.animals to service_role;
grant all on public.animal_profiles to service_role;
grant all on public.semen_registry to service_role;
grant all on public.weight_events to service_role;
grant all on public.reproductive_events to service_role;
grant all on public.sanitary_events to service_role;
grant all on public.condition_score_events to service_role;
grant all on public.lab_samples to service_role;
grant all on public.animal_events to service_role;
grant all on public.animal_category_history to service_role;

-- Uso de los enums de spec 02.
grant usage on type public.animal_status to anon, authenticated, service_role;
grant usage on type public.teeth_state_enum to anon, authenticated, service_role;
grant usage on type public.event_source to anon, authenticated, service_role;
grant usage on type public.repro_event_type to anon, authenticated, service_role;
grant usage on type public.service_type_enum to anon, authenticated, service_role;
grant usage on type public.pregnancy_status_enum to anon, authenticated, service_role;
grant usage on type public.sanitary_event_type to anon, authenticated, service_role;
grant usage on type public.sanitary_route to anon, authenticated, service_role;
grant usage on type public.lab_sample_type to anon, authenticated, service_role;
grant usage on type public.category_change_reason to anon, authenticated, service_role;

-- Funciones.
grant execute on function public.establishment_of_profile (uuid) to authenticated;
grant execute on function public.compute_category (uuid) to authenticated;
grant execute on function public.animal_timeline (uuid) to authenticated;

-- Forzar reload del schema cache de PostgREST.
notify pgrst, 'reload schema';
