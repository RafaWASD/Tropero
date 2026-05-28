-- 0033_animal_timeline.sql  (spec 02 lógico: 0032)
-- Cronología del animal (v1): unión de 5 tablas tipadas + animal_category_history.
-- Se reemplaza en 0035 para sumar el séptimo origen 'observacion'.
-- Cubre R10.1, R10.2.

create or replace function public.animal_timeline (profile_id uuid)
returns table (
  event_kind  text,
  event_id    uuid,
  event_date  timestamptz,
  payload     jsonb
) language sql security definer stable
set search_path = public as $$
  select 'weight'::text as event_kind, id as event_id,
         (weight_date::timestamptz + coalesce(time, '00:00'::time)) as event_date,
         jsonb_build_object('weight_kg', weight_kg, 'source', source, 'notes', notes) as payload
  from public.weight_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'reproductive', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'pregnancy_status', pregnancy_status,
                            'calf_id', calf_id, 'notes', notes)
  from public.reproductive_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'sanitary', id, event_date::timestamptz,
         jsonb_build_object('event_type', event_type, 'product_name', product_name,
                            'route', route, 'notes', notes)
  from public.sanitary_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'condition_score', id, event_date::timestamptz,
         jsonb_build_object('score', score, 'notes', notes)
  from public.condition_score_events
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'lab_sample', id, collection_date::timestamptz,
         jsonb_build_object('sample_type', sample_type, 'tube_number', tube_number,
                            'result', result, 'received', result_received_date)
  from public.lab_samples
  where animal_profile_id = profile_id and deleted_at is null
    and has_role_in(establishment_of_profile(profile_id))

  union all
  select 'category_change', id, changed_at,
         jsonb_build_object('from', from_category_id, 'to', to_category_id, 'reason', reason)
  from public.animal_category_history
  where animal_profile_id = profile_id
    and has_role_in(establishment_of_profile(profile_id))

  order by event_date desc;
$$;

grant execute on function public.animal_timeline (uuid) to authenticated;
