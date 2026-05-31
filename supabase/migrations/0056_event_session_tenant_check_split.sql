-- 0056_event_session_tenant_check_split.sql  (spec 03 — fix de 0052)
--
-- BUG (detectado por la suite T2.6): en 0052 los triggers tenant-check se crearon como
--   `before insert or update of session_id`.
-- Verificado contra el remoto: con esa forma combinada, el trigger NO dispara en INSERT
-- (la cláusula de lista de columnas `OF session_id` solo aplica a UPDATE, y combinarla con
-- INSERT en un solo trigger deja el firing efectivamente acotado a UPDATE-of-column). Resultado:
-- un evento con session_id cross-tenant / de otro rodeo / de una sesión cerrada pasaba SIN
-- validar al insertarse — bypass total del tenant-check de session_id (R7.4, SEC-SPEC-03-04).
--
-- FIX: separar en DOS triggers por tabla:
--   * `before insert` (sin lista de columnas) — corre en cada INSERT.
--   * `before update of session_id` — corre cuando se re-apunta session_id.
-- La función tg_event_session_tenant_check no cambia (sigue cross-tenant + intra-tenant).

-- Drop de los triggers rotos.
drop trigger if exists weight_events_session_tenant_check          on public.weight_events;
drop trigger if exists reproductive_events_session_tenant_check    on public.reproductive_events;
drop trigger if exists sanitary_events_session_tenant_check        on public.sanitary_events;
drop trigger if exists condition_score_events_session_tenant_check on public.condition_score_events;
drop trigger if exists lab_samples_session_tenant_check            on public.lab_samples;

-- weight_events
create trigger weight_events_session_tenant_check_ins
  before insert on public.weight_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger weight_events_session_tenant_check_upd
  before update of session_id on public.weight_events
  for each row execute function public.tg_event_session_tenant_check();

-- reproductive_events
create trigger reproductive_events_session_tenant_check_ins
  before insert on public.reproductive_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger reproductive_events_session_tenant_check_upd
  before update of session_id on public.reproductive_events
  for each row execute function public.tg_event_session_tenant_check();

-- sanitary_events
create trigger sanitary_events_session_tenant_check_ins
  before insert on public.sanitary_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger sanitary_events_session_tenant_check_upd
  before update of session_id on public.sanitary_events
  for each row execute function public.tg_event_session_tenant_check();

-- condition_score_events
create trigger condition_score_events_session_tenant_check_ins
  before insert on public.condition_score_events
  for each row execute function public.tg_event_session_tenant_check();
create trigger condition_score_events_session_tenant_check_upd
  before update of session_id on public.condition_score_events
  for each row execute function public.tg_event_session_tenant_check();

-- lab_samples
create trigger lab_samples_session_tenant_check_ins
  before insert on public.lab_samples
  for each row execute function public.tg_event_session_tenant_check();
create trigger lab_samples_session_tenant_check_upd
  before update of session_id on public.lab_samples
  for each row execute function public.tg_event_session_tenant_check();

notify pgrst, 'reload schema';
