-- 0084_denormalize_is_castrated.sql — spec 10 Fase 1, design §4.2. Cubre R13.3, R13.4.
--
-- ORDEN DE MIGRACIONES (reconciliación vs el §-orden del design): la denorm de is_castrated va ANTES
-- que future_bull (0085) — el trigger animal_profiles_normalize_future_bull de 0085 LEE new.is_castrated,
-- así que la columna debe existir primero (dependencia real verificada al aplicar). El design presenta
-- §4.1 future_bull antes que §4.2 denorm, pero deja la numeración "TBD al implementer" (D6) y solo exige
-- "la denorm debe existir antes de cablear el cliente" — aplicar denorm primero también lo cumple.
--
-- Cierra el finding F1 de C6 (design-c6 §7): `animals` está FUERA del sync set (ADR-026 b1) → ni la
-- castración offline ni el espejo C6 tienen el dato sin esta denorm. Fuente de verdad física sigue
-- siendo animals.is_castrated (0060). Patrón 0079, con la diferencia de que NO se fuerza en UPDATE
-- (is_castrated es editable por diseño, 0060) → write-through up + propagación down.
--
-- LIM-2 (Puerta 1, Raf 2026-06-11): la PROPAGACIÓN down lleva un PRE-FILTRO que espeja el predicado
-- EXACTO de tg_animal_profiles_rodeo_check (0021) → tolerar-y-saltear los perfiles con rodeo
-- inactivo/soft-deleted (huérfanos) en vez de abortar fail-closed toda la cadena. RAISE LOG del skip
-- (solo count + animal id — sin fuga cross-tenant). Gate 1 puntual: PASS (security_spec_10-lim2-rechequeo.md).
--
-- Seguridad (R9.4): las 3 funciones SECURITY DEFINER + set search_path = public + revoke execute de
-- public/authenticated/anon (patrón 0055/0079) — no invocables como RPC. Análisis de poder del
-- write-through: no excede lo que animals_update (0071) ya concede (design §4.2 "análisis de poder").
--
-- NO aplicar al remoto desde acá: vía scripts/apply-migration.mjs (Management API). Idempotente.

begin;

-- (0) Columna espejo en animal_profiles (mismo tipo/default que animals, 0060).
alter table public.animal_profiles
  add column if not exists is_castrated boolean not null default false;

comment on column public.animal_profiles.is_castrated is
  'Denormalizado de animals.is_castrated (spec 10, estilo 0079/ADR-026). Mantenido por: force en INSERT (fiel a animals), propagación animals->profiles, y WRITE-THROUGH profiles->animals (es el write-path offline de la castración: animals no sincroniza). A diferencia de la identidad (0079), NO se fuerza en UPDATE: es editable por diseño (0060).';

-- (1) BACKFILL (idempotente). El AFTER UPDATE write-through (3) queda guardado por IS DISTINCT FROM →
--     el backfill no rebota contra animals.
update public.animal_profiles ap
   set is_castrated = a.is_castrated
  from public.animals a
 where a.id = ap.animal_id
   and ap.is_castrated is distinct from a.is_castrated;

-- (2) FORCE en INSERT del perfil: copia desde animals (un perfil nuevo nace fiel; anti-spoof del alta).
--     SOLO INSERT: en UPDATE el cliente DEBE poder escribirla (write-path de castración) — ver header.
create or replace function public.tg_force_is_castrated_on_profile_insert ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select a.is_castrated into new.is_castrated
  from public.animals a where a.id = new.animal_id;
  new.is_castrated := coalesce(new.is_castrated, false);
  return new;
end; $$;
revoke execute on function public.tg_force_is_castrated_on_profile_insert () from public, authenticated, anon;
drop trigger if exists animal_profiles_force_is_castrated on public.animal_profiles;
create trigger animal_profiles_force_is_castrated
  before insert on public.animal_profiles
  for each row execute function public.tg_force_is_castrated_on_profile_insert();

-- (3) WRITE-THROUGH up (perfil → animal): el único write-path de la app es el UPDATE del perfil
--     (animal_profiles sincroniza; animals no). Guard IS DISTINCT FROM en ambos lados corta el ciclo.
--     El UPDATE a animals dispara: animals_apply_castration (0064→0086, recompute simétrico) y la
--     propagación down de (4) — que reescribe el MISMO valor en los perfiles → no-op → FIN del ciclo.
create or replace function public.tg_profile_is_castrated_writethrough ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_castrated is distinct from old.is_castrated then
    update public.animals
       set is_castrated = new.is_castrated
     where id = new.animal_id
       and is_castrated is distinct from new.is_castrated;
  end if;
  return new;
end; $$;
revoke execute on function public.tg_profile_is_castrated_writethrough () from public, authenticated, anon;
drop trigger if exists animal_profiles_is_castrated_writethrough on public.animal_profiles;
create trigger animal_profiles_is_castrated_writethrough
  after update of is_castrated on public.animal_profiles
  for each row execute function public.tg_profile_is_castrated_writethrough();

-- (4) PROPAGACIÓN down (animal → sus perfiles CON RODEO VIVO), estilo 0079(3). Mantiene fieles los
--     perfiles de TODOS los campos del animal (compartido, ADR-004). El guard evita UPDATEs no-op.
--     TOLERAR-Y-SALTEAR (LIM-2, decisión de Raf en Puerta 1 2026-06-11): el PRE-FILTRO espeja el
--     predicado EXACTO de tg_animal_profiles_rodeo_check (0021) para que ningún UPDATE anidado pueda
--     raisear por rodeo muerto y abortar la cadena — el perfil huérfano se SALTEA (queda stale,
--     inconsistencia aceptada) y se deja constancia en el log del servidor.
create or replace function public.tg_propagate_is_castrated_to_profiles ()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_skipped int;
begin
  update public.animal_profiles ap
     set is_castrated = new.is_castrated
   where ap.animal_id = new.id
     and ap.is_castrated is distinct from new.is_castrated
     and exists (                          -- pre-filtro = predicado exacto de rodeo_check (0021)
       select 1 from public.rodeos r
       where r.id = ap.rodeo_id
         and r.establishment_id = ap.establishment_id
         and r.active = true
         and r.deleted_at is null
     );
  -- Visibilidad mínima del skip (server-side; sin superficie cliente — cross-tenant, design §4.2/§6.1):
  select count(*) into v_skipped
  from public.animal_profiles ap
  where ap.animal_id = new.id
    and ap.is_castrated is distinct from new.is_castrated;
  if v_skipped > 0 then
    raise log 'is_castrated propagation: skipped % orphan profile(s) of animal % (inactive/soft-deleted rodeo)',
      v_skipped, new.id;
  end if;
  return new;
end; $$;
revoke execute on function public.tg_propagate_is_castrated_to_profiles () from public, authenticated, anon;
drop trigger if exists animals_propagate_is_castrated on public.animals;
create trigger animals_propagate_is_castrated
  after update of is_castrated on public.animals
  for each row execute function public.tg_propagate_is_castrated_to_profiles();

notify pgrst, 'reload schema';

commit;
