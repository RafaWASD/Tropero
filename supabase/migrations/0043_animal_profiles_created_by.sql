-- 0043_animal_profiles_created_by.sql  (fold Tier 1 spec 02, sesión 20)
-- Item 1 del Tier 1: columna created_by en animal_profiles + trigger que la FUERZA.
-- Cubre R4.1 (created_by), consumido por R4.14 (exit_animal_profile, 0044).
--
-- (SEC-SPEC-03, Gate 1 s20) En animal_profiles, created_by NO es puro audit trail:
-- es load-bearing para autorización (exit_animal_profile lo usa para decidir quién
-- puede dar de baja). Por eso NO se reusa tg_set_created_by_auth_uid ("solo si NULL",
-- 0024), que un INSERT con created_by no-NULL podría burlar (la policy
-- animal_profiles_insert solo exige has_role_in, no restringe created_by). Se usa una
-- variante que SIEMPRE sobreescribe server-side, ignorando el valor del payload.

alter table public.animal_profiles
  add column created_by uuid references public.users(id);

create or replace function public.tg_force_created_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  new.created_by := auth.uid();   -- ignora cualquier valor que venga en el INSERT del cliente
  return new;
end; $$;

comment on function public.tg_force_created_by_auth_uid is
  'Trigger BEFORE INSERT: FUERZA created_by = auth.uid() (ignora el valor del cliente). '
  'Para columnas created_by que son load-bearing para authz (animal_profiles, R4.14). '
  'No confundir con tg_set_created_by_auth_uid ("solo si NULL"), que es audit-only.';

create trigger animal_profiles_set_created_by
  before insert on public.animal_profiles
  for each row execute function public.tg_force_created_by_auth_uid();

notify pgrst, 'reload schema';
