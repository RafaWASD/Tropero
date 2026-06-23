-- 0102_rodeo_service_months.sql  (spec 02 — Stream A, modelo de puesta en servicio)
-- Config de campaña por rodeo: en qué meses (1-12) ese rodeo hace servicio (Gate 0 §6).
-- Sustrato del denominador reproductivo (servidas/entoradas, 0105) y del bucketing CCL (Stream C).
-- NO existía en el repo (verificado 2026-06-23: 0 ocurrencias en migraciones/app/commits).
-- Shape = smallint[] con CHECK (DD-PS-1; array elegido sobre bitmask por legibilidad/consultabilidad/
-- NULL-vs-vacío distinguible — ver design §1/§7).
--
-- NULL = "sin configurar" (rodeos existentes; RPS.2.1) — distinto de '{}' = "no hace servicio" (RPS.1.2).
-- El default de primavera {10,11,12} se aplica en el ALTA (create_rodeo, 0103), NO como DEFAULT de columna
-- (un DEFAULT backfillearía los rodeos viejos a primavera → DD-PS-3 lo rechaza: no inventar campañas que el
-- productor no declaró). Por eso la columna es nullable SIN default → los rodeos existentes quedan NULL
-- (ALTER metadata-only en Postgres moderno, no reescribe la tabla).
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el leader por Management API tras Gate 1 (PASS) + reviewer +
-- Gate 2 + Puerta 2 + autorización de Raf. Hasta entonces la suite supabase/tests/puesta-en-servicio/run.cjs
-- FALLA — es ESPERADO (mismo patrón que 0075-0082 / 0093-0097).

begin;

-- ⚠️ Postgres NO permite subqueries directas en un CHECK constraint (ERROR 0A000) — la validación que recorre
-- el array (rango + unicidad) se encapsula en una función IMMUTABLE que el CHECK invoca. Opera SOLO sobre el
-- array de entrada (sin acceso a tablas → verdaderamente immutable). [FIX del apply 2026-06-23: el design
-- original metía las subqueries directo en el CHECK → falla al aplicar; encapsuladas acá.]
-- NULL ("sin configurar", RPS.1.2) y '{}' (vacío = "no hace servicio", RPS.1.2) pasan ambos.
--   (a) rango 1..12: `p <@ array[1..12]` — todo elemento contenido en el conjunto de meses válidos.
--   (b) sin duplicados: cardinality(p) = nº de meses distintos.
--   (c) ≤ 12 elementos: cota anti-input-abusivo (INPUT-1, espejo 0070).
create or replace function public.service_months_is_valid (p smallint[])
returns boolean language sql immutable as $$
  select p is null or (
    p <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]
    and cardinality(p) <= 12
    and cardinality(p) = (select count(distinct x)::int from unnest(p) as x)
  );
$$;

alter table public.rodeos
  add column service_months smallint[];   -- nullable, sin default (DD-PS-3); 1..12, únicos, ≤12 (CHECK abajo)

-- CHECK autoritativo server-side (RPS.1.3/.4/.5; regla INPUT-1, espejo 0070). El cliente Expo escribe a
-- PostgREST directo → este CHECK es la ÚNICA capa autoritativa de la columna; invoca la función immutable.
alter table public.rodeos
  add constraint rodeos_service_months_valid
  check (public.service_months_is_valid(service_months));

comment on column public.rodeos.service_months is
  'Meses (1-12) en que el rodeo hace servicio (Gate 0 §6, Stream A). NULL = sin configurar; {} = no hace '
  'servicio; {10,11,12} = primavera (default del alta, aplicado por create_rodeo 0103). Sustrato del '
  'denominador servidas/entoradas (0105) y del bucketing CCL (Stream C). CHECK rodeos_service_months_valid: '
  'rango 1-12, sin duplicados, <=12 elementos (INPUT-1). RLS de rodeos (0017) gobierna la fila sin cambios.';

notify pgrst, 'reload schema';

commit;
