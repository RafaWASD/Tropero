-- 0032_calf_creation.sql  (spec 02 lógico: 0031)
-- Ternero al pie: entidad independiente creada automáticamente al cargar un parto.
-- BEFORE INSERT (corre antes que tg_reproductive_events_apply_transition AFTER INSERT),
-- así calf_id queda escrito antes de la transición de la madre.
-- Cubre R9.1, R9.2, R9.3, R9.4.

create or replace function public.tg_reproductive_events_create_calf ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mother_species_id uuid;
  v_mother_est_id uuid;
  v_mother_rodeo_id uuid;
  v_system_id uuid;
  v_calf_animal_id uuid;
  v_calf_profile_id uuid;
  v_calf_category_id uuid;
  v_calf_category_code text;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
begin
  if new.event_type <> 'birth' then return new; end if;
  if new.calf_id is not null then return new; end if;
  if new.calf_sex is null then return new; end if;
  -- calf_weight es opcional; el alta no depende de él.

  select a.species_id, p.establishment_id, p.rodeo_id, r.system_id
    into v_mother_species_id, v_mother_est_id, v_mother_rodeo_id, v_system_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  -- Categoría inicial del ternero según sexo.
  v_calf_category_code := case when new.calf_sex = 'male' then 'ternero' else 'ternera' end;
  select id into v_calf_category_id from public.categories_by_system
    where system_id = v_system_id and code = v_calf_category_code and active = true;

  -- 1) Crear animal global (TAG si vino, sino null).
  insert into public.animals (tag_electronic, species_id, sex, birth_date)
  values (nullif(trim(new.calf_tag_electronic), ''), v_mother_species_id, new.calf_sex, new.event_date)
  returning id into v_calf_animal_id;

  -- 2) Crear perfil del ternero. management_group_id queda NULL (no hereda el lote, R9.1).
  insert into public.animal_profiles (
    animal_id, establishment_id, rodeo_id,
    visual_id_alt, category_id, category_override,
    birth_weight, entry_date, entry_origin, status
  ) values (
    v_calf_animal_id,
    v_mother_est_id,
    v_mother_rodeo_id,
    case when nullif(trim(new.calf_tag_electronic), '') is null then v_visual_fallback else null end,
    v_calf_category_id,
    false,
    new.calf_weight,
    new.event_date,
    'born_here',
    'active'
  ) returning id into v_calf_profile_id;

  -- 3) Linkear.
  new.calf_id := v_calf_profile_id;
  return new;
exception
  when others then
    -- R9.4: rollback automático lo asegura Postgres por la transacción del INSERT.
    raise;
end; $$;

create trigger reproductive_events_create_calf
  before insert on public.reproductive_events
  for each row execute function public.tg_reproductive_events_create_calf();
