-- 0052_event_session_fk.sql  (spec 03 — MODO MANIOBRAS) — toca constraints de tablas de spec 02
-- Vincula los eventos Tier 1 a la sesión (R5.11). La columna session_id YA EXISTE en las
-- 5 tablas (0025-0029, uuid SIN FK, "sessions viene en spec 03"); acá se agrega la FK + el
-- trigger tenant-check (NO se crea la columna).
-- ON DELETE SET NULL: borrar/archivar una sesión no borra sus eventos (append-only, ADR-017).
--
-- tg_event_session_tenant_check (R7.4, SEC-SPEC-03-04). Si session_id no es null valida:
--   (cross-tenant) sessions.establishment_id == establishment_of_profile(animal_profile_id)
--   (intra-tenant a) la sesión debe estar status='active' (no colgar de una sesión cerrada)
--   (intra-tenant b) el rodeo real del animal (animal_profiles.rodeo_id del perfil activo)
--                    == sessions.rodeo_id  (R1.1 "una sesión = un rodeo")
-- SECURITY DEFINER + search_path public + EXECUTE revocado de public/authenticated/anon
-- (R11.4, lección SEC-HIGH-01). NO es RPC.

alter table public.weight_events          add constraint weight_events_session_fk          foreign key (session_id) references public.sessions(id) on delete set null;
alter table public.reproductive_events    add constraint reproductive_events_session_fk    foreign key (session_id) references public.sessions(id) on delete set null;
alter table public.sanitary_events        add constraint sanitary_events_session_fk        foreign key (session_id) references public.sessions(id) on delete set null;
alter table public.condition_score_events add constraint condition_score_events_session_fk foreign key (session_id) references public.sessions(id) on delete set null;
alter table public.lab_samples            add constraint lab_samples_session_fk            foreign key (session_id) references public.sessions(id) on delete set null;

create index weight_events_by_session          on public.weight_events (session_id)          where session_id is not null;
create index reproductive_events_by_session    on public.reproductive_events (session_id)    where session_id is not null;
create index sanitary_events_by_session        on public.sanitary_events (session_id)        where session_id is not null;
create index condition_score_events_by_session on public.condition_score_events (session_id) where session_id is not null;
create index lab_samples_by_session            on public.lab_samples (session_id)            where session_id is not null;

create or replace function public.tg_event_session_tenant_check ()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_event_est    uuid;
  v_session_est  uuid;
  v_session_st   public.session_status;
  v_session_rod  uuid;
  v_event_rod    uuid;
begin
  if new.session_id is null then
    return new;  -- R8.4: eventos sin sesión son legítimos (carga individual / ficha).
  end if;

  v_event_est := public.establishment_of_profile(new.animal_profile_id);

  -- rodeo REAL del animal del evento, resuelto inline desde el perfil activo (igual que el gating §4).
  select rodeo_id into v_event_rod
    from public.animal_profiles
    where id = new.animal_profile_id and deleted_at is null;

  select establishment_id, status, rodeo_id
    into v_session_est, v_session_st, v_session_rod
    from public.sessions
    where id = new.session_id and deleted_at is null;

  if v_session_est is null then
    raise exception 'session % not found or deleted', new.session_id using errcode = '23503';
  end if;

  -- (cross-tenant)
  if v_session_est is distinct from v_event_est then
    raise exception 'event session belongs to a different establishment than the animal'
      using errcode = '23514';
  end if;

  -- (intra-tenant a) la sesión debe estar activa al insertar el evento (SEC-SPEC-03-04).
  if v_session_st <> 'active' then
    raise exception 'cannot attach event to session % with status % (must be active)', new.session_id, v_session_st
      using errcode = '23514';
  end if;

  -- (intra-tenant b) el rodeo del animal debe ser el de la sesión (R1.1; SEC-SPEC-03-04).
  -- El flujo R4.4 mueve el animal de rodeo ANTES de cargar eventos; un evento sobre un animal
  -- aún en otro rodeo se rechaza (es justo el caso que R4.4 prohíbe hasta mover el animal).
  if v_event_rod is distinct from v_session_rod then
    raise exception 'event animal rodeo % does not match session rodeo % (one session = one rodeo)', v_event_rod, v_session_rod
      using errcode = '23514';
  end if;

  return new;
end; $$;
revoke execute on function public.tg_event_session_tenant_check () from public, authenticated, anon;

-- BEFORE INSERT OR UPDATE OF session_id en las 5 tablas. (UPDATE OF session_id cubre re-apuntar;
-- el patrón create-events->close NO dispara el check sobre eventos ya creados — sólo INSERT nuevos
-- o UPDATE que toca session_id. Ver test de orden de cierre T2.6.)
create trigger weight_events_session_tenant_check
  before insert or update of session_id on public.weight_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger reproductive_events_session_tenant_check
  before insert or update of session_id on public.reproductive_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger sanitary_events_session_tenant_check
  before insert or update of session_id on public.sanitary_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger condition_score_events_session_tenant_check
  before insert or update of session_id on public.condition_score_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger lab_samples_session_tenant_check
  before insert or update of session_id on public.lab_samples
  for each row execute function public.tg_event_session_tenant_check();

notify pgrst, 'reload schema';
