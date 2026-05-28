-- 0041_soft_delete_rpcs.sql  (fix de implementación de spec 02 — DEVIACIÓN documentada)
--
-- PROBLEMA: PostgREST exige que, tras un UPDATE, la fila resultante siga siendo
-- visible según la policy de SELECT de la tabla (lo enforce aun con
-- Prefer: return=minimal). Las policies de SELECT de spec 02 incluyen
-- `deleted_at is null` sobre la PROPIA fila, así que un soft-delete por UPDATE
-- (set deleted_at = now()) deja la fila fuera del SELECT y el write es rechazado
-- con 42501. Esto bloquea los soft-delete que el spec concede al cliente:
-- rodeos (R2.5), management_groups (R2.17), animal_events (R6.12) y eventos (R6).
-- Spec 01 no lo sufrió porque sus policies de SELECT derivan de helpers que leen
-- OTRAS tablas (no el deleted_at de la propia fila).
--
-- DECISIÓN: en vez de relajar las policies de SELECT (rompería R12.3 — RLS no debe
-- retornar soft-deleted en lecturas normales), exponemos funciones SECURITY DEFINER
-- de soft-delete que (a) re-validan la misma autorización que la policy de UPDATE
-- correspondiente, y (b) hacen el UPDATE de deleted_at por dentro (bypass de la
-- verificación de visibilidad de PostgREST). El cliente llama estas RPCs; el
-- comportamiento de autorización y de lectura (R12.3) queda idéntico al diseñado.
-- Consistente con ADR-012 (preferir funciones/triggers en Postgres). Requiere
-- aprobación del reviewer/Raf (cambia el mecanismo del soft-delete de "UPDATE
-- deleted_at" a "RPC", lo que también toca la estrategia de PowerSync — ver
-- progress/impl_02-modelo-animal.md y CONTEXT/07-pendientes.md).

-- rodeo: solo owner; rechaza si tiene animal_profiles activos (R2.5).
create or replace function public.soft_delete_rodeo (p_rodeo_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;
  if v_est is null then
    raise exception 'rodeo not found' using errcode = 'P0002';
  end if;
  if not public.is_owner_of(v_est) then
    raise exception 'only owner can delete a rodeo' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.animal_profiles
    where rodeo_id = p_rodeo_id and status = 'active' and deleted_at is null
  ) then
    raise exception 'rodeo has active animal_profiles; reassign or remove them first (R2.5)'
      using errcode = '23514';
  end if;
  update public.rodeos set deleted_at = now() where id = p_rodeo_id;
end; $$;

grant execute on function public.soft_delete_rodeo (uuid) to authenticated;

-- management_group: solo owner (R2.17).
create or replace function public.soft_delete_management_group (p_group_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_est uuid;
begin
  select establishment_id into v_est from public.management_groups where id = p_group_id and deleted_at is null;
  if v_est is null then
    raise exception 'management_group not found' using errcode = 'P0002';
  end if;
  if not public.is_owner_of(v_est) then
    raise exception 'only owner can delete a management_group' using errcode = '42501';
  end if;
  update public.management_groups set deleted_at = now() where id = p_group_id;
end; $$;

grant execute on function public.soft_delete_management_group (uuid) to authenticated;

-- animal_event: author original o owner del establishment (R6.13). Permitido aun fuera de la ventana de edición.
create or replace function public.soft_delete_animal_event (p_event_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_est uuid; v_author uuid;
begin
  select establishment_id, author_id into v_est, v_author
  from public.animal_events where id = p_event_id and deleted_at is null;
  if v_est is null then
    raise exception 'animal_event not found' using errcode = 'P0002';
  end if;
  if not (public.has_role_in(v_est) and (v_author = auth.uid() or public.is_owner_of(v_est))) then
    raise exception 'not allowed to delete this animal_event' using errcode = '42501';
  end if;
  update public.animal_events set deleted_at = now() where id = p_event_id;
end; $$;

grant execute on function public.soft_delete_animal_event (uuid) to authenticated;

-- evento tipado: owner del establishment o created_by (R6.8). kind valida la tabla.
create or replace function public.soft_delete_event (p_kind text, p_event_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_profile uuid; v_created_by uuid; v_est uuid;
begin
  case p_kind
    when 'weight' then
      select animal_profile_id, created_by into v_profile, v_created_by from public.weight_events where id = p_event_id and deleted_at is null;
    when 'reproductive' then
      select animal_profile_id, created_by into v_profile, v_created_by from public.reproductive_events where id = p_event_id and deleted_at is null;
    when 'sanitary' then
      select animal_profile_id, created_by into v_profile, v_created_by from public.sanitary_events where id = p_event_id and deleted_at is null;
    when 'condition_score' then
      select animal_profile_id, created_by into v_profile, v_created_by from public.condition_score_events where id = p_event_id and deleted_at is null;
    when 'lab_sample' then
      select animal_profile_id, created_by into v_profile, v_created_by from public.lab_samples where id = p_event_id and deleted_at is null;
    else
      raise exception 'unknown event kind %', p_kind using errcode = '22023';
  end case;
  if v_profile is null then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  v_est := public.establishment_of_profile(v_profile);
  if not (public.is_owner_of(v_est) or v_created_by = auth.uid()) then
    raise exception 'not allowed to delete this event' using errcode = '42501';
  end if;
  case p_kind
    when 'weight' then update public.weight_events set deleted_at = now() where id = p_event_id;
    when 'reproductive' then update public.reproductive_events set deleted_at = now() where id = p_event_id;
    when 'sanitary' then update public.sanitary_events set deleted_at = now() where id = p_event_id;
    when 'condition_score' then update public.condition_score_events set deleted_at = now() where id = p_event_id;
    when 'lab_sample' then update public.lab_samples set deleted_at = now() where id = p_event_id;
  end case;
end; $$;

grant execute on function public.soft_delete_event (text, uuid) to authenticated;

notify pgrst, 'reload schema';
