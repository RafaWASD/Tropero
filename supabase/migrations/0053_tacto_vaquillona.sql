-- 0053_tacto_vaquillona.sql  (spec 03 — MODO MANIOBRAS) — toca enum/tabla de spec 02
-- R5.13 / R6.3: tacto de aptitud de vaquillona (apta/no_apta/diferida).
-- El enum repro_event_type de spec 02 (0026) no tiene 'tacto_vaquillona'; lo agregamos sin
-- reabrir spec 02. ALTER TYPE ... ADD VALUE no es transaccionable con DDL que use el valor
-- nuevo, por eso esta migración va AISLADA (solo el ADD VALUE + el enum/columna de resultado,
-- que no consumen el valor nuevo en su propia definición).

alter type public.repro_event_type add value if not exists 'tacto_vaquillona';

create type public.heifer_fitness_result as enum ('apta', 'no_apta', 'diferida');

alter table public.reproductive_events
  add column if not exists heifer_fitness public.heifer_fitness_result;  -- solo aplica cuando event_type='tacto_vaquillona'

notify pgrst, 'reload schema';
