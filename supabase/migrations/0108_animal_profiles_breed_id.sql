-- 0108_animal_profiles_breed_id.sql  (spec 08 — export SIGSA, T2 / R1.4, R1.5, R1.7)
-- Delta cross-spec sobre animal_profiles (spec 02, tabla creada en 0020). Agrega la referencia
-- CONTROLADA de raza (breed_id FK a breed_catalog) en COEXISTENCIA con la columna legacy
-- animal_profiles.breed (texto libre, 0020:23). breed_id es lo que se usa going-forward (el TXT
-- de SIGSA deriva el código RAZA de breed_catalog vía breed_id, R5.2); breed queda legacy hasta la
-- limpieza post-MVP.
--
-- Aditivo y NO destructivo: la columna es nullable (los perfiles existentes quedan con breed_id
-- NULL = "a completar" hasta que un match best-effort o el usuario asigne uno). NO toca ninguna
-- policy/RLS: breed_id hereda las policies de animal_profiles (ya scoped por establishment_id,
-- spec 02 / 0022) — un cliente solo puede setearlo en filas de su establishment.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS + CREATE OR REPLACE del
-- trigger (re-correr no rompe).

-- ── (1) Columna breed_id FK nullable (R1.4) ────────────────────────────────────────────────
alter table public.animal_profiles
  add column if not exists breed_id uuid references public.breed_catalog(id);

comment on column public.animal_profiles.breed_id is
  'Raza CONTROLADA (FK a breed_catalog, códigos SENASA). Coexiste con breed (texto libre legacy, 0020). '
  'Fuente del código RAZA del TXT SIGSA (R5.2). NULL = "a completar" (no exportable, R8.2).';

-- ── (2) Migración best-effort del texto libre al catálogo (R1.5) ────────────────────────────
-- Solo asigna cuando hay match EXACTO por nombre normalizado (lower(trim)); sin match = NULL
-- ("a completar"). NO inventa: si el texto libre no calza una grafía del catálogo, queda NULL.
-- Idempotente: el WHERE breed_id IS NULL evita re-pisar asignaciones ya hechas.
update public.animal_profiles ap
set breed_id = bc.id
from public.breed_catalog bc
where ap.breed_id is null
  and ap.breed is not null
  and lower(trim(ap.breed)) = lower(trim(bc.name));

-- ── (3) Índice parcial para la query de export (filtra por establishment + breed_id) ────────
create index if not exists idx_animal_profiles_breed_id
  on public.animal_profiles(breed_id)
  where breed_id is not null;

-- ── (4) Herencia de breed_id de la madre al ternero al pie — camino MONO-TERNERO (R1.7) ─────
-- RECONCILIACIÓN CONTRA EL AS-BUILT (el design viejo citaba 'tg_create_calf_on_birth', que NO
-- existe): el ternero al pie se crea por DOS caminos en el as-built de spec 02:
--   (a) MONO-ternero: trigger BEFORE INSERT tg_reproductive_events_create_calf (último as-built =
--       0048) — se dispara cuando se inserta un evento `birth` con calf_sex no-NULL. Crea el
--       animal + animal_profile del ternero leyendo la fila de la madre. ESTE archivo lo actualiza.
--   (b) MELLIZOS: RPC register_birth (último as-built = 0075) — inserta el `birth` SIN calf_sex
--       (el trigger mono no actúa) y loopea creando los terneros. Se actualiza en 0109.
-- La herencia que pide R1.7 es: el animal_profile del ternero hereda animal_profiles.breed_id de
-- la madre (si la madre no tiene breed_id, el ternero nace con breed_id NULL). NO se hereda el
-- texto libre breed (going-forward es breed_id).
--
-- Re-definición MÍNIMA de 0048: idéntica byte-a-byte salvo (i) leer p.breed_id de la madre en el
-- SELECT y (ii) escribirlo en el INSERT del animal_profiles del ternero. Se preserva TODO lo
-- demás (SECURITY DEFINER, search_path=public, el manejo de excepción que re-raise para el
-- rollback atómico del parto, R9.4). El trigger reproductive_events_create_calf YA está creado
-- (0032) → acá solo se reemplaza el cuerpo de la función (CREATE OR REPLACE), no se re-crea el
-- trigger.
create or replace function public.tg_reproductive_events_create_calf ()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_mother_species_id uuid;
  v_mother_est_id uuid;
  v_mother_rodeo_id uuid;
  v_mother_breed_id uuid;   -- (R1.7) breed_id de la madre, heredado al ternero
  v_system_id uuid;
  v_calf_animal_id uuid;
  v_calf_profile_id uuid;
  v_calf_category_id uuid;
  v_calf_category_code text;
  v_visual_fallback text := 'recién nacido — pendiente de caravana';
begin
  if new.event_type <> 'birth' then return new; end if;
  if new.calf_id is not null then return new; end if;
  if new.calf_sex is null then return new; end if;   -- register_birth (mellizos) inserta sin calf_sex → este trigger no actúa
  -- calf_weight es opcional; el alta no depende de él.

  select a.species_id, p.establishment_id, p.rodeo_id, r.system_id, p.breed_id
    into v_mother_species_id, v_mother_est_id, v_mother_rodeo_id, v_system_id, v_mother_breed_id
  from public.animal_profiles p
  join public.animals a on a.id = p.animal_id
  join public.rodeos r on r.id = p.rodeo_id
  where p.id = new.animal_profile_id;

  v_calf_category_code := case when new.calf_sex = 'male' then 'ternero' else 'ternera' end;
  select id into v_calf_category_id from public.categories_by_system
    where system_id = v_system_id and code = v_calf_category_code and active = true;

  insert into public.animals (tag_electronic, species_id, sex, birth_date)
  values (nullif(trim(new.calf_tag_electronic), ''), v_mother_species_id, new.calf_sex, new.event_date)
  returning id into v_calf_animal_id;

  insert into public.animal_profiles (
    animal_id, establishment_id, rodeo_id,
    visual_id_alt, category_id, category_override,
    breed_id,
    birth_weight, entry_date, entry_origin, status
  ) values (
    v_calf_animal_id,
    v_mother_est_id,
    v_mother_rodeo_id,
    case when nullif(trim(new.calf_tag_electronic), '') is null then v_visual_fallback else null end,
    v_calf_category_id,
    false,
    v_mother_breed_id,        -- (R1.7) heredado de la madre (NULL si la madre no tiene breed_id)
    new.calf_weight,
    new.event_date,
    'born_here',
    'active'
  ) returning id into v_calf_profile_id;

  new.calf_id := v_calf_profile_id;
  return new;
exception
  when others then
    raise;   -- R9.4: re-raise asegura rollback del parto completo. NO tragar la excepción.
end; $$;

notify pgrst, 'reload schema';
