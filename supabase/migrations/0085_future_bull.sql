-- 0085_future_bull.sql — spec 10 (operaciones-rodeo) Fase 1, design §4.1. Cubre R12.1, R12.4.
--
-- Flag "futuro torito" (Gate 0 v2 D2). Decisión de manejo PER-PERFIL: NO viaja en
-- venta/transferencia (un perfil nuevo en otro campo arranca false por default).
--
-- ORDEN DE MIGRACIONES (D6): va DESPUÉS de la denorm de is_castrated (0084) — el trigger de
-- normalización de abajo LEE new.is_castrated (auto-clear al castrar), así que esa columna ya debe existir.
--
-- Normalización (solo machos + auto-clear al castrar). SILENCIOSA (no raise — D8, validada por Raf
-- en Puerta 1 2026-06-11): D2 define auto-clear al castrar; para sexo no-macho se elige la misma
-- semántica (un future_bull=true sobre hembra es siempre un error de payload — se normaliza a false,
-- fail-safe, sin romper flujos legítimos como la corrección de sexo macho->hembra que propaga 0079).
--
-- ⚠ ORDEN DE TRIGGERS (BEFORE, alfabético = orden de disparo): 'animal_profiles_normalize_future_bull'
-- debe correr DESPUÉS de 'animal_profiles_force_animal_identity' (0079, fuerza animal_sex en INSERT/UPDATE)
-- para leer el sexo ya forzado. 'n' > 'f' alfabéticamente → orden correcto (verificado contra pg_trigger
-- en el pre-flight; asertado en T-DB.4(f)). Gate 1/2 lo re-verifican.
--
-- Seguridad (R9.4): SECURITY DEFINER + set search_path = public + revoke execute de public/authenticated/anon
-- (patrón 0055/0079) — no invocable como RPC. No recibe parámetros del cliente: deriva todo de NEW.
--
-- NO aplicar al remoto desde acá: lo aplica el implementer/leader vía scripts/apply-migration.mjs
-- (Management API database/query, mismo mecanismo que 0068-0083). Idempotente → re-aplicable.

begin;

-- (0) Columna future_bull en animal_profiles.
alter table public.animal_profiles
  add column if not exists future_bull boolean not null default false;

comment on column public.animal_profiles.future_bull is
  'Futuro torito (spec 10, Gate 0 v2 D2). Decisión de manejo del campo: solo machos; se marca desde la ficha; auto-clear al castrar (trigger normalize). No viaja entre campos.';

-- (1) Trigger de normalización (solo machos; auto-clear al castrar). Silencioso (D8).
create or replace function public.tg_normalize_future_bull ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.future_bull = true and (coalesce(new.animal_sex, '') <> 'male' or new.is_castrated = true) then
    new.future_bull := false;
  end if;
  return new;
end; $$;
revoke execute on function public.tg_normalize_future_bull () from public, authenticated, anon;

drop trigger if exists animal_profiles_normalize_future_bull on public.animal_profiles;
create trigger animal_profiles_normalize_future_bull
  before insert or update of future_bull, is_castrated, animal_sex on public.animal_profiles
  for each row execute function public.tg_normalize_future_bull();

-- (Se descarta el CHECK declarativo `future_bull = false OR animal_sex = 'male'`: una corrección de sexo
--  propagada por 0079 sobre un perfil con future_bull=true lo violaría y rompería la propagación; el
--  trigger normaliza en vez de fallar — alternativa §8.D del design.)

notify pgrst, 'reload schema';

commit;
