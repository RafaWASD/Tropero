-- 0111_sigsa_declarations.sql  (spec 08 — export SIGSA, T5)
-- Cubre: R3.1, R3.2, R3.3, R3.5, R3.6, R3.7, R11.1, R11.2, R11.3.
-- Marcador de declaración SIGSA por (establecimiento, animal). Tabla NUEVA propia de spec 08.
-- Un marcador = un par (establishment_id, animal_profile_id) ya declarado ante SENASA (por export
-- RAFAQ o marcado manual, R10.2). La lista de "pendientes de declarar" (R9.1) es justamente los
-- animales con RFID SIN fila acá. Append-only e inmutable (R11.3): sin UPDATE/DELETE de cliente.
--
-- Scoped por establishment (R3.2): un animal transferido a otro campo (spec 11) NO hereda el
-- marcador del campo origen; el destino declara bajo su propio RENSPA. El UNIQUE es por
-- (establishment_id, animal_profile_id), no global por animal.
--
-- Seguridad (folds de Gate 1):
--   - declared_by FORZADO server-side por trigger (HIGH-1): se ignora el UUID del payload. Mismo
--     patrón que tg_force_created_by_auth_uid (0043) / tg_force_imported_by_auth_uid (0073). Audit
--     no-spoofeable (R3.6, R11.2).
--   - INSERT solo owner/veterinarian (R3.5/R7.2) + EXISTS IDOR-check (MEDIUM-4, R3.7): el
--     animal_profile_id DEBE pertenecer al establishment_id de la fila (y estar activo) → un owner
--     del campo A NO puede insertar un animal_profile_id del campo B aunque el establishment_id sea
--     suyo.
--   - SELECT cualquier rol activo del establishment (has_role_in). La tabla NO tiene deleted_at
--     (append-only inmutable, R11.3) → el SELECT NO filtra deleted_at (la columna no existe; si se
--     agrega soft-delete post-MVP, actualizar la policy). [Fix del veto del leader 2026-06-13: la
--     policy original referenciaba deleted_at sobre columna inexistente → habría fallado al crear.]
--
-- La FK export_log_id → export_log se agrega en 0112 (export_log se crea ahí). Acá la columna queda
-- como uuid sin FK; 0112 le agrega el constraint ON DELETE SET NULL.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE OR REPLACE del trigger
-- function + DROP TRIGGER IF EXISTS + CREATE INDEX IF NOT EXISTS.

create table if not exists public.sigsa_declarations (
  id                uuid        primary key default gen_random_uuid(),
  establishment_id  uuid        not null references public.establishments(id) on delete cascade,
  animal_profile_id uuid        not null references public.animal_profiles(id) on delete cascade,
  declared_at       timestamptz not null default now(),
  export_log_id     uuid,       -- FK a export_log; el constraint se agrega en 0112
  declared_by       uuid        not null references auth.users(id),
  created_at        timestamptz not null default now(),
  unique (establishment_id, animal_profile_id)
);

comment on table public.sigsa_declarations is
  'Marcador de declaración SIGSA por (establecimiento, animal). Append-only inmutable (R11.3). '
  'Scoped por establishment (R3.2). declared_by forzado server-side (R3.6). Sin deleted_at.';

alter table public.sigsa_declarations enable row level security;
grant select, insert on public.sigsa_declarations to authenticated;
grant all on public.sigsa_declarations to service_role;

-- SELECT: cualquier rol activo en el establishment (append-only, sin deleted_at que filtrar).
drop policy if exists "sigsa_declarations_select" on public.sigsa_declarations;
create policy "sigsa_declarations_select"
  on public.sigsa_declarations
  for select to authenticated
  using (public.has_role_in(establishment_id));

-- INSERT: solo owner o veterinarian (R3.5/R7.2) + IDOR-check (R3.7/MEDIUM-4: el animal_profile_id
-- pertenece al establishment_id de la fila y está activo). user_roles.role es enum
-- ('owner','field_operator','veterinarian') → IN ('owner','veterinarian') es válido. has_role_in ya
-- excluye establishments soft-deleted, así que el conjunto es seguro.
drop policy if exists "sigsa_declarations_insert" on public.sigsa_declarations;
create policy "sigsa_declarations_insert"
  on public.sigsa_declarations
  for insert to authenticated
  with check (
    public.has_role_in(establishment_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.establishment_id = sigsa_declarations.establishment_id
        and ur.role in ('owner', 'veterinarian')
        and ur.active = true
    )
    -- MEDIUM-4 / R3.7: el animal_profile_id pertenece al establishment_id de ESTA fila (anti-IDOR).
    and exists (
      select 1 from public.animal_profiles ap
      where ap.id = sigsa_declarations.animal_profile_id
        and ap.establishment_id = sigsa_declarations.establishment_id
        and ap.deleted_at is null
    )
  );

-- Sin UPDATE ni DELETE desde el cliente (append-only, R11.3): no se otorgan ni se crean policies.

-- HIGH-1 (R3.6): forzar declared_by = auth.uid() server-side (no confiar el valor del cliente).
-- Mismo patrón que tg_force_created_by_auth_uid (0043) y tg_force_imported_by_auth_uid (0073).
create or replace function public.tg_force_declared_by_auth_uid ()
returns trigger language plpgsql as $$
begin
  new.declared_by := auth.uid();  -- ignora cualquier valor del payload del cliente
  return new;
end; $$;

comment on function public.tg_force_declared_by_auth_uid is
  'Trigger BEFORE INSERT: FUERZA declared_by = auth.uid() (ignora el valor del cliente). '
  'Audit trail SENASA no-spoofeable (R3.6, R11.2). Patrón: 0043 + 0073.';

drop trigger if exists sigsa_declarations_set_declared_by on public.sigsa_declarations;
create trigger sigsa_declarations_set_declared_by
  before insert on public.sigsa_declarations
  for each row execute function public.tg_force_declared_by_auth_uid();

-- Índice para la query de pendientes (LEFT JOIN sigsa_declarations por establishment + profile).
create index if not exists idx_sigsa_declarations_est_profile
  on public.sigsa_declarations(establishment_id, animal_profile_id);

notify pgrst, 'reload schema';
