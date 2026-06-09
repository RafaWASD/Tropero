-- 0077_denormalize_establishment_id_event_children.sql  (feature 15-powersync, PASO 2 / T9.1 — delta de backend)
--
-- DENORMALIZACIÓN de `establishment_id` sobre las tablas hijas que derivan su tenant del PERFIL del animal
-- (`animal_profile_id -> animal_profiles.establishment_id`): las 5 tablas de evento tipado
-- (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) +
-- `animal_category_history`. Fuente de verdad del patrón: ADR-026 + design §2.4 (A). Cubre R13.1, R13.2, R13.4, R13.6.
--
-- POR QUÉ (modelo de sync JOIN-free de PowerSync): las sync streams de PowerSync NO toleran JOINs en las data
-- queries (cada tabla del JOIN se evalúa como una parameter query que enumera TODA la tabla -> revienta el bucket
-- model, PSYNC_S2305). El paso 1 ya sincroniza JOIN-free las 17 tablas con `establishment_id` PROPIO
-- (`WHERE establishment_id IN org_scope`). Estas tablas hijas NO tienen `establishment_id` propio (lo derivan del
-- perfil por FK) -> el paso 1 las DIFIRIÓ. Este delta les agrega un `establishment_id` DENORMALIZADO para que
-- entren al MISMO patrón JOIN-free ya probado (la stream nueva la arma el leader; este archivo es solo el schema).
--
-- ANTI-SPOOF (CRÍTICO para la seguridad del wire de sync): la columna denormalizada NO debe ser settable por el
-- cliente. Un trigger BEFORE INSERT la FUERZA derivándola del padre real (`animal_profiles.establishment_id`),
-- IGNORANDO cualquier valor que venga en el payload. Si el cliente pudiera setearla a un campo ajeno, el stream
-- (que filtra `establishment_id IN org_scope`) le replicaría datos cross-tenant por el WAL. Espejo del patrón
-- `tg_force_created_by_auth_uid` (0043, columna load-bearing para authz, "siempre sobreescribe") y de
-- `tg_animal_events_validate_est` (0034, el precedente: animal_events ya tiene establishment_id denormalizado).
--
-- BEFORE INSERT *Y* BEFORE UPDATE (reconciliación al as-built vs design §2.4 (A), que decía "NO BEFORE UPDATE"):
-- aunque `animal_profile_id` es inmutable de facto (el evento no se reasigna de animal), estas tablas tienen
-- `GRANT UPDATE` a authenticated (0025-0029) y la policy de UPDATE deriva el tenant del PERFIL, NO de la columna
-- denormalizada. Sin un force en UPDATE, un caller con UPDATE permission podría hacer
-- `UPDATE weight_events SET establishment_id = <campo ajeno>` por PostgREST directo: la policy lo dejaría pasar
-- (sigue siendo owner/autor del evento de SU perfil) y la columna quedaría INFIEL → el stream del campo ajeno le
-- replicaría un evento cuyo perfil no le pertenece (leak por WAL). El force en UPDATE re-deriva SIEMPRE el valor
-- del perfil real (inmutable), cerrando ese vector. Es el mismo criterio que `animal_events` (0034), que marca
-- `establishment_id` como columna INMUTABLE en su trigger de edición. Como `animal_profile_id` no cambia, el
-- force en UPDATE re-deriva el MISMO valor → cero impacto en flujos legítimos; pura defensa anti-spoof.
--
-- RLS AS-BUILT NO CAMBIA (R11.3/R13.6): las policies de SELECT de estas tablas siguen derivando el tenant por FK
-- (`has_role_in(establishment_of_profile(animal_profile_id))`). La columna denormalizada es SOLO para el stream
-- (la frontera de autorización del wire de sync, que no puede hacer JOINs). El trigger-force la mantiene fiel;
-- Gate 1 lo verifica sobre este delta. No se toca ninguna policy/grant/trigger existente.
--
-- ORDEN seguro: ADD COLUMN nullable -> backfill (no falla por filas pre-existentes) -> CREATE trigger ->
-- SET NOT NULL (la columna es load-bearing para el stream; un NULL la sacaría del sync set silenciosamente).
--
-- NO aplicar al remoto desde acá: lo aplica el leader por Management API (BEGIN/COMMIT) tras gatear el SQL
-- (Gate 1 spec + Gate 2 + reviewer). NO `supabase db push`.

begin;

-- ---------------------------------------------------------------------------
-- (1) Función de trigger COMPARTIDA por las 6 tablas: FUERZA `establishment_id` desde el perfil del animal.
--     `security definer` + `set search_path = public` (mismo estilo que los triggers security-definer del repo,
--     p. ej. tg_animal_profiles_record_category_change en 0030). El SELECT al perfil corre como owner del schema.
--     Si el perfil no existe, el INSERT ya falla por la FK `animal_profile_id` as-built; igual hacemos raise
--     explícito (23503) para no dejar un establishment_id NULL si por alguna razón el SELECT no encuentra fila.
-- ---------------------------------------------------------------------------
create or replace function public.tg_force_establishment_id_from_profile ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_est uuid;
begin
  select establishment_id into v_est
  from public.animal_profiles
  where id = new.animal_profile_id;
  if v_est is null then
    raise exception 'animal_profile_id % not found (no se pudo derivar establishment_id)', new.animal_profile_id
      using errcode = '23503';
  end if;
  new.establishment_id := v_est;   -- FUERZA desde el padre: ignora cualquier valor del payload (anti-spoof)
  return new;
end;
$$;

comment on function public.tg_force_establishment_id_from_profile is
  'Trigger BEFORE INSERT OR UPDATE: FUERZA establishment_id = animal_profiles.establishment_id del '
  'NEW.animal_profile_id (ignora el valor del cliente — anti-spoof; también en UPDATE para que un caller con '
  'UPDATE permission no pueda pisar la columna con un campo ajeno). Compartido por las tablas hijas que derivan '
  'el tenant del perfil (eventos tipados + animal_category_history). Solo para el sync JOIN-free de PowerSync; '
  'la RLS as-built sigue derivando por FK. Espejo de tg_force_created_by_auth_uid (0043) y '
  'tg_animal_events_validate_est (0034).';

-- ---------------------------------------------------------------------------
-- (2) weight_events (0025) — establishment_id <- animal_profiles del evento.
-- ---------------------------------------------------------------------------
alter table public.weight_events
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.weight_events we
   set establishment_id = ap.establishment_id
  from public.animal_profiles ap
 where ap.id = we.animal_profile_id
   and we.establishment_id is null;

drop trigger if exists weight_events_force_establishment_id on public.weight_events;
create trigger weight_events_force_establishment_id
  before insert or update on public.weight_events
  for each row execute function public.tg_force_establishment_id_from_profile();

alter table public.weight_events alter column establishment_id set not null;

-- ---------------------------------------------------------------------------
-- (3) reproductive_events (0026) — establishment_id <- animal_profiles del evento.
-- ---------------------------------------------------------------------------
alter table public.reproductive_events
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.reproductive_events re
   set establishment_id = ap.establishment_id
  from public.animal_profiles ap
 where ap.id = re.animal_profile_id
   and re.establishment_id is null;

drop trigger if exists reproductive_events_force_establishment_id on public.reproductive_events;
create trigger reproductive_events_force_establishment_id
  before insert or update on public.reproductive_events
  for each row execute function public.tg_force_establishment_id_from_profile();

alter table public.reproductive_events alter column establishment_id set not null;

-- ---------------------------------------------------------------------------
-- (4) sanitary_events (0027) — establishment_id <- animal_profiles del evento.
-- ---------------------------------------------------------------------------
alter table public.sanitary_events
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.sanitary_events se
   set establishment_id = ap.establishment_id
  from public.animal_profiles ap
 where ap.id = se.animal_profile_id
   and se.establishment_id is null;

drop trigger if exists sanitary_events_force_establishment_id on public.sanitary_events;
create trigger sanitary_events_force_establishment_id
  before insert or update on public.sanitary_events
  for each row execute function public.tg_force_establishment_id_from_profile();

alter table public.sanitary_events alter column establishment_id set not null;

-- ---------------------------------------------------------------------------
-- (5) condition_score_events (0028) — establishment_id <- animal_profiles del evento.
-- ---------------------------------------------------------------------------
alter table public.condition_score_events
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.condition_score_events ce
   set establishment_id = ap.establishment_id
  from public.animal_profiles ap
 where ap.id = ce.animal_profile_id
   and ce.establishment_id is null;

drop trigger if exists condition_score_events_force_establishment_id on public.condition_score_events;
create trigger condition_score_events_force_establishment_id
  before insert or update on public.condition_score_events
  for each row execute function public.tg_force_establishment_id_from_profile();

alter table public.condition_score_events alter column establishment_id set not null;

-- ---------------------------------------------------------------------------
-- (6) lab_samples (0029) — establishment_id <- animal_profiles de la muestra.
-- ---------------------------------------------------------------------------
alter table public.lab_samples
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.lab_samples ls
   set establishment_id = ap.establishment_id
  from public.animal_profiles ap
 where ap.id = ls.animal_profile_id
   and ls.establishment_id is null;

drop trigger if exists lab_samples_force_establishment_id on public.lab_samples;
create trigger lab_samples_force_establishment_id
  before insert or update on public.lab_samples
  for each row execute function public.tg_force_establishment_id_from_profile();

alter table public.lab_samples alter column establishment_id set not null;

-- ---------------------------------------------------------------------------
-- (7) animal_category_history (0030) — establishment_id <- animal_profiles.
--     OJO: esta tabla se puebla SOLO vía trigger security-definer (sin GRANT INSERT al cliente, 0030:59-60).
--     El trigger force igual aplica (corre en cada INSERT, venga del trigger de cambio de categoría o de un
--     INSERT directo del owner del schema) y deja la columna fiel. Esta tabla NO tiene `deleted_at` propio
--     (es append-only de auditoría) -> la stream nueva NO filtra deleted_at (design §2.4 (A)).
-- ---------------------------------------------------------------------------
alter table public.animal_category_history
  add column if not exists establishment_id uuid references public.establishments(id) on delete cascade;

update public.animal_category_history ach
   set establishment_id = ap.establishment_id
  from public.animal_profiles ap
 where ap.id = ach.animal_profile_id
   and ach.establishment_id is null;

drop trigger if exists animal_category_history_force_establishment_id on public.animal_category_history;
create trigger animal_category_history_force_establishment_id
  before insert or update on public.animal_category_history
  for each row execute function public.tg_force_establishment_id_from_profile();

alter table public.animal_category_history alter column establishment_id set not null;

notify pgrst, 'reload schema';

commit;
