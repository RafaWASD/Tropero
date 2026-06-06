-- 0073_import_log.sql  (spec 12 — R11, T2.1 + T2.2)
-- Audit de cada corrida de importación masiva de rodeo (carga inicial del padrón).
-- Scoped por establishment (RLS). imported_by se FUERZA server-side (no se confía del
-- cliente, lección A1-1 / created_by 0043). Patrón tomado de 0029_lab_samples.sql
-- (tabla scoped por establishment con RLS + trigger de audit).
--
-- Verificado contra el as-built (Gate 1 PASS, security_spec_12):
--   - 0005: solo has_role_in(est) / is_owner_of(est) — NO existe has_role(role,est) genérico.
--           El rol 'veterinarian' se chequea inline contra user_roles (0003).
--   - 0003: user_roles (user_id, establishment_id, role user_role, active). enum incluye 'veterinarian'.
--   - 0043: tg_force_created_by_auth_uid SIEMPRE sobreescribe — mismo patrón para imported_by acá.

create type public.import_file_format as enum ('csv', 'xlsx', 'sigsa_txt');

create table public.import_log (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  rodeo_id          uuid not null references public.rodeos(id),
  file_name         text not null,
  file_format       public.import_file_format not null,
  total_records     integer not null default 0,
  imported_ok       integer not null default 0,
  imported_errors   integer not null default 0,
  error_details     jsonb,
  imported_by       uuid references public.users(id),
  created_at        timestamptz not null default now(),
  -- R11.4: file_name viene del cliente (attacker-controlled) → tope de largo server-side.
  constraint import_log_file_name_len_chk      check (char_length(file_name) <= 255),
  -- R11.4: tope del jsonb de detalle de errores (octet_length del serializado, mismo patrón
  -- que sessions.config / animal_events.structured_payload en 0050/0070). 256 KiB.
  constraint import_log_error_details_size_chk check (octet_length(error_details::text) <= 262144)
);

comment on table public.import_log is
  'Audit de importaciones masivas de rodeo (spec 12). Scoped por establishment. imported_by forzado server-side.';

create index import_log_by_est on public.import_log (establishment_id, created_at desc);

-- R11.3: forzar imported_by = auth.uid() (no confiar el valor del cliente). Reusa el patrón
-- de tg_force_created_by_auth_uid (0043) pero sobre la columna imported_by. SIEMPRE sobreescribe
-- (no "solo si NULL"): un cliente que mande otro uuid en el payload es ignorado.
create or replace function public.tg_force_imported_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  new.imported_by := auth.uid();   -- ignora cualquier valor del payload del cliente
  return new;
end; $$;

comment on function public.tg_force_imported_by_auth_uid is
  'Trigger BEFORE INSERT: FUERZA imported_by = auth.uid() (ignora el valor del cliente). '
  'Audit no-spoofeable del autor del import (R11.3). Mismo patrón que tg_force_created_by_auth_uid (0043).';

create trigger import_log_set_imported_by
  before insert on public.import_log
  for each row execute function public.tg_force_imported_by_auth_uid();

alter table public.import_log enable row level security;

-- R11.2: cualquier rol activo del establishment puede LEER el log de su establishment.
create policy import_log_select on public.import_log
  for select using (has_role_in(establishment_id));

-- R2.4 / R11.2: solo owner o veterinarian (los que pueden importar) pueden INSERTAR. No existe
-- un helper genérico has_role(role, est) en el as-built (solo has_role_in / is_owner_of, 0005),
-- así que el rol 'veterinarian' se chequea inline contra user_roles (mismo predicado que usan los
-- helpers de 0005). is_owner_of cubre el caso owner. field_operator NO puede insertar (no es
-- owner ni veterinarian) → su INSERT viola el with_check y PostgREST lo rechaza.
create policy import_log_insert on public.import_log
  for insert with check (
    has_role_in(establishment_id)
    and (
      is_owner_of(establishment_id)
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.establishment_id = import_log.establishment_id
          and ur.role = 'veterinarian'
          and ur.active = true
      )
    )
  );

grant select, insert on public.import_log to authenticated;
grant all on public.import_log to service_role;

notify pgrst, 'reload schema';
