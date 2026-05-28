-- 0016_generic_updated_at.sql  (spec 02 lógico: T1.7 / 0017_generic_updated_at)
-- Trigger genérico de updated_at reusable por todas las tablas de spec 02.
-- Se adelanta en el orden de archivos respecto del design porque las migrations
-- de rodeos (0017) y plantilla (0018) lo usan. Mismo contenido que T1.7.
-- (spec 01 tiene tg_establishments_set_updated_at, específica; esta es genérica.)

create or replace function public.tg_set_updated_at_generic ()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.tg_set_updated_at_generic is
  'Trigger BEFORE UPDATE genérico: setea new.updated_at = now(). Reusable.';
