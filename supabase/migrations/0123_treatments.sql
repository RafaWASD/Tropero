-- 0123_treatments.sql — delta `tratamientos` de spec 02 (ítem E triage Facundo+padre).
-- Capa de ESTADO (header) sobre sanitary_events. Cubre RTR.1..RTR.9.
--
-- ⚠️ NO aplicar desde acá: lo aplica Raf/leader por Management API tras Gate 1 PASS + Puerta 1
--    (deploy gateado a la DB compartida). El archivo lleva BEGIN/COMMIT; el orden de deploy es:
--    (1) aplicar 0123 al remoto → (2) recién ahí pegar `ev_treatments` en el dashboard PowerSync
--    (Validate → Deploy: la tabla debe existir) → (3) `notify pgrst` (incluido al final).
--
-- Helpers reusados (moldeados sobre su cuerpo VIGENTE en el remoto, memoria reference_function_recreate_base):
--   - tg_force_establishment_id_from_profile() (0077) — no args, BEFORE INSERT OR UPDATE, anti-spoof del tenant.
--   - tg_force_created_by_auth_uid() (0043) — no args, BEFORE INSERT, force del autor.
--   - tg_sanitary_events_gating() — cuerpo VIGENTE = 0091 (nace 0054, extendido 0091; sin redefinición posterior).

begin;

-- (1) Tipo del tratamiento (D-3). Enum estable; los nombres humanos los pone la UI. --------------
create type public.treatment_kind as enum ('antibiotico', 'antiparasitario', 'otro');

-- (2) Header del tratamiento. establishment_id DENORMALIZADO (sync JOIN-free, ADR-026) + FORZADO por
--     trigger desde el perfil (anti-spoof). "En curso" = ended_at IS NULL. `deleted_at` es columna DEFENSIVA de
--     la convención de soft-delete (principio 4): en v1 se llena SOLO por CASCADE del perfil (el trigger de
--     inmutabilidad (3c) impide setearla por UPDATE); soft-delete del header por UPDATE = v2 (ver RLS (5) y RTR.7.6).
create table public.treatments (
  id                 uuid primary key default gen_random_uuid(),
  animal_profile_id  uuid not null references public.animal_profiles(id) on delete cascade,
  establishment_id   uuid not null references public.establishments(id) on delete cascade,  -- forzado (trigger)
  kind               public.treatment_kind not null,
  product_name       text not null,
  notes              text,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,               -- NULL = EN CURSO (RTR.4.1)
  created_by         uuid references public.users(id),                                       -- forzado (trigger)
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- RTR.1.4 (no vacío) + SEC-TRT-02 (tope server-side). Las constantes 120 / 1000 son las MISMAS del
  -- sanitizer del cliente: TREATMENT_PRODUCT_MAX_LENGTH=120 (RTR.1.9), TREATMENT_NOTES_MAX_LENGTH=1000 (RTR.1.10).
  constraint treatments_product_not_empty check (length(trim(product_name)) > 0),
  constraint treatments_product_len       check (char_length(product_name) <= 120),
  constraint treatments_notes_len         check (notes is null or char_length(notes) <= 1000)
);
-- NOTA (LOW-2, sanidad de rango ended_at >= started_at): NO se agrega como CHECK duro A PROPÓSITO. Ambos
-- timestamps son wall-clock de CLIENTE (started_at al iniciar; ended_at = datetime('now') al finalizar), y en un
-- sistema offline-first un tratamiento puede iniciarse en el dispositivo A y finalizarse en el B (o en el mismo
-- con corrección NTP entre medio) → un CHECK ended_at >= started_at podría RECHAZAR una finalización legítima por
-- skew de reloj, y bloquear un finalizar offline es peor que un rango levemente invertido. La UI ordena/renderiza
-- por started_at y trata ended_at como "fin"; el desorden de reloj es cosmético.

-- Índice del DERIVADO "en tratamiento" (RTR.4.1 / pin): tratamientos ABIERTOS por perfil. Sirve el
-- EXISTS de la lista/ficha en O(log n).
create index treatments_open_by_profile
  on public.treatments (animal_profile_id)
  where ended_at is null and deleted_at is null;

-- Índice de la sección "Tratamientos" de la ficha (RTR.9.1): todos los del perfil, recientes primero.
create index treatments_by_profile
  on public.treatments (animal_profile_id, started_at desc)
  where deleted_at is null;

-- Índice de scope de la stream (RTR.7.4): establishment del tenant.
create index treatments_by_est
  on public.treatments (establishment_id)
  where deleted_at is null;

-- (3) Triggers de integridad -------------------------------------------------------------------
-- (3a) FUERZA establishment_id desde el perfil (anti-spoof, RTR.7.2). Reusa el helper de 0077 (mismo
--      criterio que las 5 tablas de evento). BEFORE INSERT *y* UPDATE (un caller con UPDATE no puede
--      pisar la columna con un campo ajeno). Si el perfil no existe → 23503 (fail-closed, RTR.7.5).
create trigger treatments_force_establishment_id
  before insert or update on public.treatments
  for each row execute function public.tg_force_establishment_id_from_profile();

-- (3b) FUERZA created_by = auth.uid() (RTR.7.7): el "quién" de la vigilancia es confiable (no lo puede
--      spoofear el cliente). Variante FORCE (0043), NO la audit-only "solo si NULL" (0024).
create trigger treatments_force_created_by
  before insert on public.treatments
  for each row execute function public.tg_force_created_by_auth_uid();

-- (3c) INMUTABILIDAD DE COLUMNAS EN UPDATE (SEC-TRT-01, HIGH — cierre del audit-tampering, RTR.7.7/RTR.7.8).
--      La policy UPDATE es amplia (has_role_in, fiel a D-2: cualquier rol FINALIZA). Como la RLS es row-level,
--      sin este trigger un caller podría PATCH-ear por PostgREST directo `created_by`/`deleted_at` (ocultar el
--      registro)/`product_name`/`kind`/`notes`/`started_at`, o des-finalizar (`ended_at = NULL`) — y el atacante
--      es justo el peón vigilado. Este trigger PINNEA a OLD todo salvo la ÚNICA mutación legítima: `ended_at`
--      NULL→instante (finalizar, RTR.3, idempotente). No es security definer (solo toca NEW/OLD, sin leer tablas).
--      Patrón as-built = columnas inmutables de `animal_events` (0034) + force de `establishment_id` en UPDATE (0077).
--      ⚠️ Pinnea `establishment_id` A OLD TAMBIÉN (no solo `animal_profile_id`): así queda self-contained e
--      INDEPENDIENTE del orden de disparo respecto de treatments_force_establishment_id (3a). Si NO lo pinneara,
--      un `UPDATE ... SET animal_profile_id = <ajeno>` podría dejar `establishment_id` derivado del perfil ajeno
--      (si el force corre primero) mientras `animal_profile_id` se revierte a OLD → fila inconsistente que
--      sincronizaría al tenant equivocado. Pinneando ambos a OLD, cualquier orden de los dos triggers converge a
--      (animal_profile_id=OLD, establishment_id=OLD) — consistente. En INSERT solo corre el force (este es UPDATE).
create or replace function public.tg_treatments_immutable_columns ()
returns trigger language plpgsql as $$
begin
  new.created_by        := old.created_by;
  new.animal_profile_id := old.animal_profile_id;
  new.establishment_id  := old.establishment_id;        -- pin defensivo (ver nota de orden de disparo arriba)
  new.kind              := old.kind;
  new.product_name      := old.product_name;
  new.notes             := old.notes;
  new.started_at        := old.started_at;
  new.created_at        := old.created_at;
  new.deleted_at        := old.deleted_at;              -- no se puede ocultar el registro por UPDATE
  if old.ended_at is not null then
    new.ended_at := old.ended_at;                       -- ya finalizado: ended_at inmutable (no reabrir)
  end if;                                               -- en curso: ended_at NULL→instante es la finalización
  return new;
end; $$;

comment on function public.tg_treatments_immutable_columns is
  'Trigger BEFORE UPDATE en treatments: pinnea a OLD toda columna salvo la finalizacion (ended_at NULL->ts). '
  'Cierra el audit-tampering de la policy UPDATE amplia (SEC-TRT-01 / RTR.7.7 / RTR.7.8). Patron de columnas '
  'inmutables de animal_events (0034).';

create trigger treatments_immutable_columns
  before update on public.treatments
  for each row execute function public.tg_treatments_immutable_columns();

revoke execute on function public.tg_treatments_immutable_columns () from public, authenticated, anon;  -- SEC-TRT-04

-- (4) FK treatment_id en sanitary_events (aplicaciones). Nullable: los sanitarios sueltos de maniobra
--     siguen sin header. -------------------------------------------------------------------------
alter table public.sanitary_events
  add column treatment_id uuid references public.treatments(id) on delete set null;

-- Índice de "las aplicaciones de un tratamiento" (RTR.9.2). Parcial (solo linkeadas, no borradas).
create index sanitary_events_by_treatment
  on public.sanitary_events (treatment_id)
  where treatment_id is not null and deleted_at is null;

-- (4a) ANTI-IDOR / tenant-consistency del link (RTR.2.6/RTR.7.3): una aplicación solo puede linkear a un
--      tratamiento del MISMO animal_profile (⇒ mismo tenant, porque treatments.establishment_id se fuerza
--      del mismo perfil). Sin esto, un caller con INSERT/UPDATE en sanitary_events podría apuntar
--      treatment_id a un tratamiento de otro animal/campo. security definer para leer treatments sin
--      depender de la RLS del caller (solo verifica pertenencia, no fuga datos).
--      SEC-TRT-03 (MEDIUM): el trigger dispara en `before insert or update` INCONDICIONAL (NO `update OF
--      treatment_id`). Motivo: la policy UPDATE de sanitary_events (0027) no tiene `with check` → un UPDATE que
--      cambie `animal_profile_id` del evento (dejando treatment_id fijo) movería la aplicación a otro animal sin
--      re-validar el link. Disparar en TODO update re-chequea la consistencia (treatment.animal_profile_id ==
--      new.animal_profile_id) también cuando cambia el lado del perfil. Costo trivial (un SELECT por index PK).
create or replace function public.tg_sanitary_events_treatment_check ()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_profile uuid;
begin
  if new.treatment_id is null then
    return new;                         -- sanitario suelto de maniobra: sin header, nada que validar
  end if;
  select animal_profile_id into v_profile
  from public.treatments
  where id = new.treatment_id and deleted_at is null;
  if v_profile is null then
    raise exception 'treatment % not found or deleted', new.treatment_id using errcode = '23503';
  end if;
  if v_profile <> new.animal_profile_id then
    raise exception 'sanitary_event.treatment_id belongs to a different animal' using errcode = '23514';
  end if;
  return new;
end; $$;

comment on function public.tg_sanitary_events_treatment_check is
  'Trigger BEFORE INSERT OR UPDATE (incondicional, SEC-TRT-03) en sanitary_events: exige que el tratamiento '
  'linkeado sea del MISMO animal_profile que la aplicacion (anti-IDOR / tenant-consistency, RTR.2.6/RTR.7.3). '
  'security definer.';

create trigger sanitary_events_treatment_check
  before insert or update on public.sanitary_events
  for each row execute function public.tg_sanitary_events_treatment_check();

revoke execute on function public.tg_sanitary_events_treatment_check () from public, authenticated, anon;  -- SEC-TRT-04

-- (5) RLS de treatments (RTR.7.1). Patrón de las 5 tablas de evento (0027) para SELECT/INSERT; UPDATE
--     AMPLIA (has_role_in) para que cualquier rol activo FINALICE (D-2, fiel; ver requirements § Decisión
--     de criterio 1). El tenant se deriva SIEMPRE del perfil (establishment_of_profile), NUNCA de la
--     columna denormalizada (que un cliente podría intentar spoofear — la deriva el trigger). ----------
alter table public.treatments enable row level security;

create policy treatments_select on public.treatments
  for select using (
    has_role_in(establishment_of_profile(animal_profile_id)) and deleted_at is null
  );

create policy treatments_insert on public.treatments
  for insert with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );

create policy treatments_update on public.treatments
  for update using (
    has_role_in(establishment_of_profile(animal_profile_id))
  ) with check (
    has_role_in(establishment_of_profile(animal_profile_id))
  );
-- Sin policy DELETE. Y en v1 el header NO se soft-deletea por UPDATE: el trigger de inmutabilidad (3c) pinnea
-- `deleted_at := old`, así que ningún caller puede setearlo por PostgREST (cierre de SEC-TRT-01). El único
-- borrado de un treatment en v1 es el HARD-delete por CASCADE al borrar el perfil del animal
-- (`animal_profile_id ... on delete cascade`). El `deleted_at IS NULL` de las lecturas/stream/EXISTS queda como
-- filtro DEFENSIVO (convención, principio 4) — hoy siempre NULL. Soft-delete del header por UPDATE = DIFERIDO a
-- v2 (requeriría relajar la inmutabilidad de `deleted_at` a owner|autor + una UI de "borrar tratamiento").

grant select, insert, update on public.treatments to authenticated;
grant all on public.treatments to service_role;

-- (6) EXENCIÓN del gating de maniobra para las aplicaciones de tratamiento (RTR.2.7 — decisión del leader).
--     Las aplicaciones se insertan como sanitary_events con event_type derivado del kind
--     (antibiotico→treatment, antiparasitario→deworming) → sin esto chocarían con tg_sanitary_events_gating
--     (0091), que exige el data_key del rodeo (antibiotico / antiparasitario_*). Un animal enfermo se trata sin
--     importar la plantilla del rodeo (el gating es para la RECOLECCIÓN en maniobras, no para una acción reactiva
--     de salud). CREATE OR REPLACE que EXIME las filas con treatment_id no nulo (short-circuit al tope) y deja
--     TODO lo demás EXACTO respecto del cuerpo VIGENTE de 0091 (rama de maniobra intacta).
--     HARDENING (LOW-1, re-Gate-1): el short-circuit se ACOTA a `event_type <> 'vaccination'`. Motivo: una
--     aplicación de tratamiento SIEMPRE tiene event_type ∈ {treatment, deworming, other} (derivado del kind);
--     nunca 'vaccination' (la vacuna es campaña por maniobra, D-3, NO un kind de tratamiento). Sin el acote, un
--     caller PostgREST-directo podría INSERT-ar event_type='vaccination' + un treatment_id del MISMO animal para
--     saltear el gating de `vacunacion` del rodeo (auto-exención same-animal — defensa-en-profundidad, within-tenant).
create or replace function public.tg_sanitary_events_gating ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Aplicación de un tratamiento (RTR.2.7): pasa SIN gating de data_key del rodeo, SALVO 'vaccination'
  -- (que nunca es una aplicación legítima de tratamiento → sigue gateada, cierra la auto-exención LOW-1).
  if new.treatment_id is not null and new.event_type <> 'vaccination' then
    return new;
  end if;
  if new.event_type = 'vaccination' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['vacunacion']);
  elsif new.event_type = 'deworming' then
    perform public.assert_any_data_key_enabled(
      new.animal_profile_id,
      array['antiparasitario_interno', 'antiparasitario_externo']
    );
  elsif new.event_type = 'treatment' then
    perform public.assert_data_keys_enabled(new.animal_profile_id, array['antibiotico']);
  end if;
  -- test/other NO se gatean (igual que 0091).
  return new;
end; $$;
-- EXECUTE ya estaba revocado (función pre-existente de 0054/0091); el CREATE OR REPLACE lo preserva.
revoke execute on function public.tg_sanitary_events_gating () from public, authenticated, anon;  -- SEC-TRT-04 / patrón 0091

notify pgrst, 'reload schema';

commit;
