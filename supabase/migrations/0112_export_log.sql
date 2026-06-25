-- 0112_export_log.sql  (spec 08 — export SIGSA, T6)
-- Cubre: R4.1, R4.2, R4.3, R4.4, R11.1, R11.2, R11.3.
-- Registro de cada generación de archivo TXT (audit de exportaciones) + el contenido del TXT para
-- re-descargas (R10.1). Tabla NUEVA propia de spec 08. Append-only (R11.3): sin UPDATE/DELETE de
-- cliente. file_content guarda el TXT completo (con RFIDs) → dato sensible (el sync de PowerSync lo
-- escopa al org del usuario, T7).
--
-- Seguridad (folds de Gate 1):
--   - generated_by FORZADO server-side por trigger (HIGH-1): ignora el UUID del payload. Patrón
--     0043/0073. Audit no-spoofeable (R4.4, R11.1).
--   - INSERT solo owner/veterinarian (R4.2/R7.2). SELECT cualquier rol activo (has_role_in).
--   - CHECKs server-side autoritativos contra storage exhaustion (HIGH-2, patrón 0070): file_content
--     ≤ 5 MB (octet_length, ~138k animales × ~36 chars) y file_name ≤ 255 chars (char_length, como
--     import_log 0073). El cliente Expo escribe a PostgREST directo (attacker-controlled) → el CHECK
--     de DB es la única capa autoritativa.
--
-- También agrega la FK sigsa_declarations.export_log_id → export_log (ahora que export_log existe),
-- ON DELETE SET NULL: borrar un export_log (admin) deja las declaraciones, solo desvincula.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE OR REPLACE del trigger
-- function + DROP TRIGGER IF EXISTS + DROP CONSTRAINT IF EXISTS antes del ADD CONSTRAINT de la FK +
-- CREATE INDEX IF NOT EXISTS.

create table if not exists public.export_log (
  id               uuid        primary key default gen_random_uuid(),
  establishment_id uuid        not null references public.establishments(id) on delete cascade,
  generated_at     timestamptz not null default now(),
  generated_by     uuid        not null references auth.users(id),
  animal_count     int         not null,
  file_name        text        not null,
  file_content     text        not null,  -- contenido del TXT para re-descarga (R10.1)
  rodeo_filter_id  uuid        references public.rodeos(id) on delete set null,
  date_from        date,
  date_to          date,
  created_at       timestamptz not null default now(),
  -- HIGH-2 (R4.1): topes server-side autoritativos contra storage exhaustion (patrón 0070).
  -- file_content: ~36 chars/animal × 138.889 animales ≈ 5 MB (octet_length = bytes del TXT UTF-8).
  -- Si el establecimiento supera ese techo, debe exportar parcial por rodeo o rango de fechas.
  constraint export_log_file_content_size_chk check (octet_length(file_content) <= 5000000),
  -- file_name viene del slug del establecimiento (R5.3); 255 chars como import_log (0073).
  constraint export_log_file_name_len_chk     check (char_length(file_name) <= 255)
);

comment on table public.export_log is
  'Audit de cada generación de TXT SIGSA + file_content para re-descarga (spec 08, R4.1/R10.1). '
  'Append-only (R11.3). generated_by forzado server-side (R4.4). file_content ≤ 5 MB, file_name ≤ 255.';

alter table public.export_log enable row level security;
grant select, insert on public.export_log to authenticated;
grant all on public.export_log to service_role;

-- SELECT: cualquier rol activo del establishment (R4.2: todos los roles ven el historial).
drop policy if exists "export_log_select" on public.export_log;
create policy "export_log_select"
  on public.export_log
  for select to authenticated
  using (public.has_role_in(establishment_id));

-- INSERT: solo owner o veterinarian (R4.2/R7.2). Mismo predicado de rol que sigsa_declarations.
drop policy if exists "export_log_insert" on public.export_log;
create policy "export_log_insert"
  on public.export_log
  for insert to authenticated
  with check (
    public.has_role_in(establishment_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.establishment_id = export_log.establishment_id
        and ur.role in ('owner', 'veterinarian')
        and ur.active = true
    )
  );

-- Sin UPDATE ni DELETE desde el cliente (append-only, R11.3).

-- HIGH-1 (R4.4): forzar generated_by = auth.uid() server-side (no confiar el valor del cliente).
create or replace function public.tg_force_generated_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  new.generated_by := auth.uid();  -- ignora cualquier valor del payload del cliente
  return new;
end; $$;

comment on function public.tg_force_generated_by_auth_uid is
  'Trigger BEFORE INSERT: FUERZA generated_by = auth.uid() (ignora el valor del cliente). '
  'Audit trail SENASA no-spoofeable (R4.4, R11.1). Patrón: 0043 + 0073.';

drop trigger if exists export_log_set_generated_by on public.export_log;
create trigger export_log_set_generated_by
  before insert on public.export_log
  for each row execute function public.tg_force_generated_by_auth_uid();

-- FK sigsa_declarations.export_log_id → export_log (ahora que export_log existe). ON DELETE SET NULL:
-- borrar un export_log no borra las declaraciones, solo desvincula (la declaración persiste, R11.3).
alter table public.sigsa_declarations
  drop constraint if exists fk_sigsa_declarations_export_log;
alter table public.sigsa_declarations
  add constraint fk_sigsa_declarations_export_log
  foreign key (export_log_id) references public.export_log(id) on delete set null;

create index if not exists idx_export_log_establishment
  on public.export_log(establishment_id, generated_at desc);

notify pgrst, 'reload schema';
