-- 0078_denormalize_establishment_id_birth_calves_rodeo_config.sql  (feature 15-powersync, PASO 2 / T9.1)
--
-- DENORMALIZACIÓN de `establishment_id` sobre las DOS tablas hijas con derivación distinta a la de 0077:
--   - `birth_calves` (0045): tenant <- evento de parto -> madre, cadena de 2 saltos
--     (`birth_event_id -> reproductive_events.animal_profile_id -> animal_profiles.establishment_id`).
--   - `rodeo_data_config` (0018): tenant <- rodeo (`rodeo_id -> rodeos.establishment_id`).
-- Fuente de verdad: ADR-026 + design §2.4 (A). Cubre R13.1, R13.2, R13.3, R13.4, R13.6.
--
-- POR QUÉ y ANTI-SPOOF: idéntico a 0077 (sync JOIN-free de PowerSync; el trigger FUERZA la columna desde el
-- padre real ignorando el payload del cliente, porque el stream filtra `establishment_id IN org_scope` y un
-- valor spoofeado replicaría datos cross-tenant por el WAL). El SQL plano del lado server PUEDE resolver los 2
-- JOINs de la cadena de `birth_calves` (eso corre server-side, no en el stream); lo que NO se puede es el JOIN
-- en la data query del STREAM.
--
-- DIFERENCIA con 0077:
--   - Van en triggers SEPARADOS (cada uno con su función) porque la derivación es distinta (no comparten el
--     `tg_force_establishment_id_from_profile`, que asume una columna `animal_profile_id` directa).
--   - `rodeo_data_config` necesita BEFORE INSERT *Y* BEFORE UPDATE: aunque `rodeo_id` no cambia, el toggle del
--     owner es un UPDATE (0018:164 `rodeo_data_config_update`); el BEFORE UPDATE re-fuerza la columna defensivamente
--     para que un UPDATE malicioso no pueda pisarla con un campo ajeno (R13.3). Como `rodeo_id` es estable, en la
--     práctica el UPDATE re-deriva el MISMO valor; el trigger garantiza fidelidad pase lo que pase.
--   - Ninguna de las dos se escribe offline en MVP (`birth_calves` server-only, sin GRANT INSERT al cliente,
--     0045:35-39; `rodeo_data_config` toggle admin/online). Ambas son read-only locales en el cliente.
--
-- RLS AS-BUILT NO CAMBIA (R11.3/R13.6): `birth_calves_select` (0045:26) sigue derivando vía
-- `reproductive_events -> establishment_of_profile`; `rodeo_data_config_select` (0018:151) sigue derivando vía
-- `rodeos.establishment_id`. La columna nueva es SOLO para el stream.
--
-- NO tienen `deleted_at` propio: `birth_calves` filtra la visibilidad por `reproductive_events.deleted_at`
-- (la RLS lo hace; el stream nuevo NO puede JOINear, así que la fila baja mientras su parto exista — coherente
-- con que el soft-delete del parto CASCADEA el `establishment_id`? no: `birth_calves` no se borra; la baja del
-- parto la oculta vía RLS server-side y vía la stream del parto. El leader define el filtro del stream).
-- `rodeo_data_config` no tiene deleted_at (el toggle vive en `enabled`).
--
-- NO aplicar al remoto desde acá: lo aplica el leader por Management API (BEGIN/COMMIT) tras gatear el SQL.

begin;

-- ===========================================================================
-- (A) birth_calves — establishment_id <- parto -> madre (cadena de 2 saltos).
-- ===========================================================================
alter table public.birth_calves
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

-- Backfill: 2 JOINs server-side (parto -> madre -> establishment_id). Idempotente (solo filas NULL).
update public.birth_calves bc
   set establishment_id = ap.establishment_id
  from public.reproductive_events re
  join public.animal_profiles ap on ap.id = re.animal_profile_id
 where re.id = bc.birth_event_id
   and bc.establishment_id is null;

-- Trigger force: deriva el establishment_id resolviendo la cadena parto -> madre en SQL plano server-side.
-- Solo BEFORE INSERT (a diferencia de los eventos en 0077 y rodeo_data_config abajo): birth_calves NO tiene
-- GRANT UPDATE/INSERT al cliente (0045:39 = solo SELECT) -> se puebla EXCLUSIVAMENTE server-side (register_birth /
-- triggers de parto, security definer). No hay vector de spoofeo por UPDATE de cliente -> el force en INSERT basta.
create or replace function public.tg_force_establishment_id_from_birth_event ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_est uuid;
begin
  select ap.establishment_id into v_est
  from public.reproductive_events re
  join public.animal_profiles ap on ap.id = re.animal_profile_id
  where re.id = new.birth_event_id;
  if v_est is null then
    raise exception 'birth_event_id % not found (no se pudo derivar establishment_id)', new.birth_event_id
      using errcode = '23503';
  end if;
  new.establishment_id := v_est;   -- FUERZA desde el parto->madre: ignora el payload (anti-spoof)
  return new;
end;
$$;

comment on function public.tg_force_establishment_id_from_birth_event is
  'Trigger BEFORE INSERT en birth_calves: FUERZA establishment_id derivándolo del evento de parto -> madre '
  '(birth_event_id -> reproductive_events.animal_profile_id -> animal_profiles.establishment_id), ignorando el '
  'payload (anti-spoof). Solo para el sync JOIN-free de PowerSync; la RLS as-built (birth_calves_select) no cambia.';

drop trigger if exists birth_calves_force_establishment_id on public.birth_calves;
create trigger birth_calves_force_establishment_id
  before insert on public.birth_calves
  for each row execute function public.tg_force_establishment_id_from_birth_event();

alter table public.birth_calves alter column establishment_id set not null;

-- ===========================================================================
-- (B) rodeo_data_config — establishment_id <- rodeo. BEFORE INSERT *y* UPDATE (R13.3).
-- ===========================================================================
alter table public.rodeo_data_config
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.rodeo_data_config rdc
   set establishment_id = r.establishment_id
  from public.rodeos r
 where r.id = rdc.rodeo_id
   and rdc.establishment_id is null;

create or replace function public.tg_force_establishment_id_from_rodeo ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_est uuid;
begin
  select establishment_id into v_est
  from public.rodeos
  where id = new.rodeo_id;
  if v_est is null then
    raise exception 'rodeo_id % not found (no se pudo derivar establishment_id)', new.rodeo_id
      using errcode = '23503';
  end if;
  new.establishment_id := v_est;   -- FUERZA desde el rodeo: ignora el payload (anti-spoof), también en UPDATE
  return new;
end;
$$;

comment on function public.tg_force_establishment_id_from_rodeo is
  'Trigger BEFORE INSERT OR UPDATE en rodeo_data_config: FUERZA establishment_id = rodeos.establishment_id del '
  'NEW.rodeo_id, ignorando el payload (anti-spoof). BEFORE UPDATE además (R13.3): el toggle del owner es un '
  'UPDATE; re-deriva defensivamente para que un UPDATE no pueda pisar la columna con un campo ajeno. Solo para '
  'el sync JOIN-free de PowerSync; la RLS as-built (rodeo_data_config_select) no cambia.';

drop trigger if exists rodeo_data_config_force_establishment_id on public.rodeo_data_config;
create trigger rodeo_data_config_force_establishment_id
  before insert or update on public.rodeo_data_config
  for each row execute function public.tg_force_establishment_id_from_rodeo();

alter table public.rodeo_data_config alter column establishment_id set not null;

notify pgrst, 'reload schema';

commit;
