-- 0061_nursing_column.sql — Tier 2/3 spec 02. Cría al pie (DD-3).
-- Cubre RT2.9.1, RT2.9.2, RT2.9.3, RT2.13.1.
--
-- Cría al pie (con/sin) = columna booleana `nursing` en animal_profiles, mantenida por
-- trigger (DD-3). Default false NOT NULL → ningún perfil existente cambia por el ADD COLUMN
-- (RT2.13.1). Ortogonal a la categoría (RT2.9.2): el trigger setea SOLO `nursing`, nunca
-- category_id / rodeo_id / management_group_id.
--
-- Fuente única del cálculo: compute_nursing(profile_id) — usada tanto en el camino
-- incremental como en el recálculo (insert/update/delete), igual patrón que compute_category.

alter table public.animal_profiles
  add column if not exists nursing boolean not null default false;

comment on column public.animal_profiles.nursing is
  'Cría al pie de la madre (DD-3 spec 02 Tier 2/3). true tras un parto; false cuando su(s) ternero(s) son destetados. Ortogonal a category_id (RT2.9.2). Mantenida por trigger via compute_nursing.';

-- ---------------------------------------------------------------------------
-- compute_nursing(profile_id): true si la madre tiene >=1 ternero parido y NO destetado.
-- Resuelve los terneros de la madre vía birth_calves (parto) y mira si tienen weaning.
-- SECURITY DEFINER STABLE + grant a authenticated (paralela a compute_category): lectura
-- pura, deriva todo del profile_id recibido, NO escribe ni cruza tenant (RT2.12.1).
-- ---------------------------------------------------------------------------
create or replace function public.compute_nursing (profile_id uuid)
returns boolean language plpgsql security definer stable
set search_path = public as $$
declare v_nursing boolean;
begin
  select exists (
    select 1
    from public.reproductive_events be                      -- partos de la madre
    join public.birth_calves bc on bc.birth_event_id = be.id
    where be.animal_profile_id = profile_id
      and be.event_type = 'birth'
      and be.deleted_at is null
      and not exists (                                       -- ese ternero NO fue destetado
        select 1 from public.reproductive_events we
        where we.animal_profile_id = bc.calf_profile_id
          and we.event_type = 'weaning'
          and we.deleted_at is null
      )
  ) into v_nursing;
  return coalesce(v_nursing, false);
end; $$;
grant execute on function public.compute_nursing (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: recomputar `nursing` de la MADRE afectada en birth/weaning (insert/update/delete).
--   birth  : la madre es la propia animal_profile_id del evento.
--   weaning: el evento está sobre el perfil del TERNERO → resolver la madre vía
--            birth_calves.calf_profile_id = <ternero> -> birth_event_id -> madre.
-- Setea SOLO `nursing` (UPDATE de nursing) → NO toca category_id (ortogonalidad RT2.9.2) y NO
-- gatilla el override (0021/0040 escuchan OF category_id) ni el gating dientes/CUT de spec 03
-- (0054 escucha OF teeth_state,is_cut,category_id). SECURITY DEFINER: corre como owner, el
-- UPDATE de nursing pasa la RLS de animal_profiles (no hay grant directo necesario porque el
-- trigger es definer). El UPDATE solo se ejecuta si nursing realmente cambia (evita writes
-- de gusto y recursión innecesaria; este trigger es sobre reproductive_events, no sobre
-- animal_profiles, así que no hay riesgo de recursión, pero el guard ahorra escrituras).
-- ---------------------------------------------------------------------------
create or replace function public.tg_reproductive_events_recompute_nursing ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_event_type public.repro_event_type;
  v_profile uuid;          -- perfil del evento (madre en birth; ternero en weaning)
  v_mother uuid;           -- madre a recomputar
  v_new boolean;
begin
  v_event_type := coalesce(new.event_type, old.event_type);
  v_profile    := coalesce(new.animal_profile_id, old.animal_profile_id);

  if v_event_type = 'birth' then
    v_mother := v_profile;                                  -- la madre es el dueño del parto
  elsif v_event_type = 'weaning' then
    -- resolver la(s) madre(s) del ternero destetado vía birth_calves.
    -- En MVP un ternero proviene de un solo parto; si hubiera más, recomputamos todas.
    for v_mother in
      select distinct be.animal_profile_id
      from public.birth_calves bc
      join public.reproductive_events be on be.id = bc.birth_event_id
      where bc.calf_profile_id = v_profile
        and be.event_type = 'birth'
    loop
      v_new := public.compute_nursing(v_mother);
      update public.animal_profiles
        set nursing = v_new
        where id = v_mother and nursing is distinct from v_new;
    end loop;
    return coalesce(new, old);
  else
    return coalesce(new, old);                              -- otros event_type: nada
  end if;

  -- rama birth (un solo perfil madre).
  v_new := public.compute_nursing(v_mother);
  update public.animal_profiles
    set nursing = v_new
    where id = v_mother and nursing is distinct from v_new;

  return coalesce(new, old);
end; $$;

-- INSERT: parto -> nursing true; destete del ternero -> nursing false en la madre.
create trigger reproductive_events_recompute_nursing_ins
  after insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_nursing();

-- UPDATE de los campos que cambian el resultado: deleted_at (soft-delete del parto/destete),
-- event_type. animal_profile_id no cambia en la práctica (FK del evento), pero si cambiara,
-- el OF no lo cubre — fuera de alcance (no es un flujo soportado).
create trigger reproductive_events_recompute_nursing_upd
  after update of event_type, deleted_at on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_nursing();

-- DELETE: hard-delete (raro; el flujo normal es soft-delete vía UPDATE de deleted_at).
create trigger reproductive_events_recompute_nursing_del
  after delete on public.reproductive_events
  for each row execute function public.tg_reproductive_events_recompute_nursing();

notify pgrst, 'reload schema';
