-- 0068_user_private_pii.sql — Spec 14 (14-pii-user-private). Cierre del finding HIGH B3-1.
--
-- Separa FÍSICAMENTE la PII de contacto (email + phone) de `public.users` (perfil público,
-- visible a coworkers) a `public.user_private (user_id PK)` con RLS self-only. La RLS de Postgres
-- es row-level: la policy de coworkers (0006 users_select_coworkers) exponía la fila COMPLETA y el
-- cliente "cumplía" pidiendo solo id,name — bypasseable vía PostgREST directo. La separación física
-- es la única que cierra la PII en TODOS los canales (PostgREST + realtime + PowerSync por el WAL).
-- Ver ADR-025 y specs/active/14-pii-user-private/.
--
-- ⚠️ DEPLOY DESTRUCTIVO Y COORDINADO: dropea columnas de una tabla en uso. Debe aplicarse JUNTO
-- con el redeploy de las Edge Functions (invite_user, accept_invitation) y el release del frontend
-- (profile.ts/establishments.ts). En cuanto se dropean las columnas, los lectores viejos de
-- users.email/phone dejan de resolver. No hay ventana segura para desfasar el apply de los deploys.
--
-- ORDEN ATÓMICO (todo o nada, una transacción): tabla → unique index → policies → trigger
-- updated_at → backfill (ANTES del drop, R4.1) → drop columns → reescritura handle_new_auth_user
-- (en la MISMA migration que el drop, para que no haya ventana con el trigger viejo insertando en
-- users(email) ya inexistente) → grants/revokes + smoke-check → trigger de propagación de email.
--
-- NÚMERO DE MIGRACIÓN: si spec 13 o spec 02 Tier 2 consumen 0068 antes, renumerar al siguiente
-- libre manteniendo el orden (esta migration es número-agnóstica: no referencia su propio número).
--
-- Cubre: R1.*, R2.*, R3.1, R3.2, R4.*, R5.*, R7.*, R9.*.

-- =====================================================================
-- T1 — Tabla user_private (R1.1, R1.2, R1.4)
-- =====================================================================
create table public.user_private (
  user_id    uuid primary key references public.users (id) on delete cascade,
  email      text not null,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_private is
  'PII de contacto (email, phone) self-only. Separada de public.users (perfil público) para que la '
  'RLS row-level no exponga contacto de coworkers, y para cerrar la PII también en el canal WAL '
  '(realtime/PowerSync). Ver spec 14 / ADR-025. auth.users.email es la fuente de verdad del email; '
  'user_private.email es la copia consultable, mantenida por el trigger de propagación.';

-- =====================================================================
-- T2 — Unicidad de email (R1.3)
-- Opción (a) del design §2: índice único TOTAL sobre (email). El parcial
-- `where deleted_at is null` de users_email_active no es portable (user_private no tiene
-- deleted_at; un índice parcial no admite subquery en el WHERE). auth.users ya impone unicidad
-- global de email vivo → un soft-delete de public.users no libera el email en auth.users, así
-- que el índice total NO introduce una restricción nueva respecto del sistema completo (Gate 1 §4).
-- =====================================================================
create unique index user_private_email_unique
  on public.user_private (email);

-- =====================================================================
-- T4 — updated_at automático (reusa el trigger genérico de 0001)
-- =====================================================================
create trigger user_private_set_updated_at
  before update on public.user_private
  for each row execute function public.tg_users_set_updated_at();

-- =====================================================================
-- T5 — Backfill ANTES de dropear columnas (R4.1, R4.2, R4.3)
-- Incluye soft-deleted (preserva contacto histórico, R4.2). email es not-null en users hoy →
-- no hay filas que violen el not-null de user_private.email. Si alguna lo violara, el insert
-- falla y la migración aborta atómicamente (R4.3).
--
-- ⚠️ EDGE CASE (índice total vs parcial): el viejo users_email_active era PARCIAL
-- (`where deleted_at is null`), así que un user soft-deleted y uno vivo PODÍAN compartir email.
-- El nuevo user_private_email_unique es TOTAL → dos filas con el mismo email harían fallar el
-- backfill. En teoría no debería pasar (auth.users impone unicidad global de email vivo y
-- users.email es copia de auth.users.email), PERO users.email queda STALE tras un cambio de email
-- (bug que esta spec cierra) → un dato drifteado podría colisionar. Pre-chequeamos para FALLAR con
-- un mensaje ACCIONABLE (en vez de un unique-violation críptico) si hay emails duplicados; el leader
-- reconcilia el dato antes de re-aplicar. Atomicidad preservada (R4.3): si falla, no hay user_private
-- a medio poblar (toda la migration es una transacción).
do $$
declare
  v_dups int;
begin
  select count(*) into v_dups
  from (
    select email from public.users group by email having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception
      'backfill abortado: % email(s) duplicado(s) en public.users (el índice total de user_private no los admite). Reconciliar el dato antes de re-aplicar.', v_dups;
  end if;
end$$;

insert into public.user_private (user_id, email, phone)
  select id, email, phone from public.users;

-- =====================================================================
-- T6 — Recién ahora se quitan de users (R3.1, R3.2)
-- =====================================================================
drop index if exists public.users_email_active;
alter table public.users drop column email, drop column phone;

-- =====================================================================
-- T3 — RLS self-only (R2.1, R2.2, R2.3, R2.4, R2.5)
-- Sin policy de insert/delete: el insert lo hace el trigger de signup (security definer); el
-- ciclo de vida del contacto sigue el de users (FK on delete cascade).
-- =====================================================================
alter table public.user_private enable row level security;

create policy user_private_select_self on public.user_private
  for select
  to authenticated
  using (user_id = auth.uid());

create policy user_private_update_self on public.user_private
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =====================================================================
-- T7 — Reescritura de handle_new_auth_user (R5.1, R5.2, R5.3)
-- Inserta en users (id, name) Y en user_private (user_id, email) en la MISMA transacción del
-- INSERT en auth.users (atomicidad R5.2: ambas o ninguna). `on conflict do nothing` en ambos
-- preserva la idempotencia. security definer + search_path=public se mantienen (necesarios para
-- insertar saltando RLS desde el contexto de auth).
-- =====================================================================
create or replace function public.handle_new_auth_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(trim((new.raw_user_meta_data ->> 'name')), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.users (id, name)
  values (new.id, v_name)
  on conflict (id) do nothing;

  insert into public.user_private (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- =====================================================================
-- T9 — Propagación del email CONFIRMADO a user_private (R7.1, R7.2)
-- Opción 3A del design §3: trigger sobre auth.users AFTER UPDATE OF email.
--
-- R7.2 (CONDICIÓN OBLIGATORIA del Gate 1): propaga SOLO el email confirmado, nunca el pendiente.
-- Shape de auth.users (GoTrue, estable): durante un cambio de email PENDIENTE, `email` queda con
-- el email VIEJO y el nuevo vive en `email_change` (texto); recién al CONFIRMAR, `email` pasa a ser
-- el nuevo. Por eso anclamos la propagación a `new.email IS DISTINCT FROM old.email`: esa transición
-- ocurre ÚNICAMENTE en la confirmación (mientras está pendiente, auth.users.email no cambia, así que
-- el trigger no dispara la propagación del pendiente). No dependemos de columnas internas frágiles
-- (`email_change`/`new_email`): la condición `email` cambió ⇒ confirmado es robusta al shape.
--
-- auth.users es schema de Supabase. Si la plataforma reescribe su flujo de email, este trigger
-- podría desincronizarse silenciosamente; mitigado por (1) auth.users.email = fuente de verdad
-- (un user_private.email stale solo afecta el precheck de invitación, soft y recuperable) y
-- (2) el test T23. Documentado como riesgo L-2 en ADR-025.
--
-- security definer + search_path fijo: el trigger corre desde el contexto de auth y debe escribir
-- en public.user_private saltando RLS.
-- =====================================================================
create or replace function public.propagate_confirmed_email ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo si el email canónico realmente cambió (= se confirmó el nuevo). El email pendiente vive en
  -- auth.users.email_change mientras no se confirma y NO toca auth.users.email → no dispara acá.
  if new.email is distinct from old.email and new.email is not null then
    update public.user_private
       set email = new.email
     where user_id = new.id;
  end if;
  return new;
end;
$$;

comment on function public.propagate_confirmed_email is
  'Propaga el email CONFIRMADO de auth.users a public.user_private (R7.1/R7.2). Dispara solo cuando '
  'auth.users.email cambia (= confirmación; el email pendiente vive en email_change, no en email). '
  'security definer + search_path fijo. Ver spec 14 / ADR-025 (riesgo L-2: depende del shape de auth.users).';

create trigger on_auth_user_email_confirmed
  after update of email on auth.users
  for each row execute function public.propagate_confirmed_email();

-- =====================================================================
-- T8 — GRANTs mínimos + revokes explícitos + smoke-check fail-closed (R9.1, R9.2, R9.3, R9.4 + L-1)
-- =====================================================================
-- Cliente: solo select + update (sin insert/delete), acotado por la RLS self-only.
grant select, update on public.user_private to authenticated;
-- service_role: lectura del contacto vía admin-client en las Edge Functions.
grant all on public.user_private to service_role;

-- L-1 (defensa en profundidad): revoke EXPLÍCITO de insert/delete a authenticated/anon/public.
-- Aunque el grant de arriba no los otorga, un `grant all` accidental futuro los reintroduciría;
-- el revoke nominal + smoke-check lo blindan. R9.3: nada a anon.
revoke insert, delete on public.user_private from authenticated;
revoke all on public.user_private from anon, public;

-- Defensa en profundidad (patrón 0055/0065): las 2 funciones SECURITY DEFINER de esta migration
-- (handle_new_auth_user reescrita + propagate_confirmed_email nueva) son funciones-trigger → NO se
-- exponen por PostgREST, pero el revoke nominal de EXECUTE + el smoke-check cierran el patrón y
-- previenen una regresión (que algún `grant` futuro las haga invocables como RPC).
revoke execute on function public.handle_new_auth_user ()     from public, authenticated, anon;
revoke execute on function public.propagate_confirmed_email () from public, authenticated, anon;

-- Smoke-check fail-closed (patrón 0055/0065): si authenticated/anon/public quedaron con
-- insert/delete sobre user_private, o anon con select/update, o las funciones-trigger quedaron
-- EXECUTE-ables por roles cliente, la migración FALLA.
do $$
declare
  v_bad record;
  v_funcs text[] := array['handle_new_auth_user', 'propagate_confirmed_email'];
begin
  for v_bad in
    select r.rolname, p.privname
    from (select unnest(array['authenticated','anon','public']) as rolname) r
    cross join (select unnest(array['INSERT','DELETE']) as privname) p
    where has_table_privilege(r.rolname, 'public.user_private', p.privname)
  loop
    raise exception 'grant check FAILED: % has % on public.user_private', v_bad.rolname, v_bad.privname;
  end loop;

  for v_bad in
    select r.rolname, p.privname
    from (select unnest(array['anon']) as rolname) r
    cross join (select unnest(array['SELECT','UPDATE']) as privname) p
    where has_table_privilege(r.rolname, 'public.user_private', p.privname)
  loop
    raise exception 'grant check FAILED: anon has % on public.user_private (R9.3)', v_bad.privname;
  end loop;

  for v_bad in
    select p.proname, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = any(v_funcs)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: function % is EXECUTE-able by %', v_bad.proname, v_bad.rolname;
  end loop;

  raise notice 'grant check OK: public.user_private + SECURITY DEFINER trigger functions fail-closed';
end$$;

-- R9.4 — reload del schema cache de PostgREST tras la migración.
notify pgrst, 'reload schema';
