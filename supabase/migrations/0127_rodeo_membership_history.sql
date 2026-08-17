-- 0127_rodeo_membership_history.sql
-- Delta CAMPAÑAS CONGELADAS (spec 07) — F4 / D3 / DL7 / DL8. Historia de membresía de rodeo: en qué rodeo
-- estuvo cada perfil y entre qué fechas. Es la única dimensión del reporte reproductivo que HOY no se puede
-- reconstruir hacia atrás (`moveAnimalToRodeo` es un UPDATE plano de `rodeo_id`, sin evento ni historia —
-- `progress/repro_reportes-campanas-congeladas.md`), y el rodeo es la llave de partición de TODO reporte.
--
-- Molde: `animal_category_history` (0030) — tabla-con-historia + trigger SECURITY DEFINER + RLS de solo
-- lectura + `grant select` a authenticated (las filas las escribe SOLO el trigger).
--
-- Cubre: RCC.1.1–RCC.1.12, RCC.9.7, RCC.9.9, DP-3, DP-4, DP-9, DP-19.
--
-- NUMERACIÓN: 0127 = siguiente libre tras 0126 (verificado con `ls supabase/migrations/` — T1).
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el LEADER por Supabase MCP tras Gate 1 (PASS) + reviewer
-- (APPROVED) + Gate 2 (PASS) + Gate 2.5 + OK explícito de Raf. Entre 0127 y 0130 la suite
-- supabase/tests/reports/run.cjs queda ROJA-HASTA-APPLY — ESPERADO (patrón 0075-0082 / 0093-0097 / 0105-0106).
-- **No** se agrega nada a `sync-streams/mitropero.yaml` (DL8 / RCC.1.10): esta tabla NO sincroniza a los devices.

begin;

-- ============================================================================
-- (1) Enum + tabla (RCC.1.1, RCC.1.2)
-- ============================================================================
create type public.rodeo_membership_reason as enum
  ('backfill','initial','move','reactivation','transfer_in');

create table public.rodeo_membership_history (
  id                uuid primary key default gen_random_uuid(),
  animal_profile_id uuid not null references public.animal_profiles(id) on delete cascade,
  rodeo_id          uuid not null references public.rodeos(id),
  -- denormalizado (convención ADR-026). OJO: acá NO es frontera de autorización — ver el comment on column.
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  from_date         date not null,
  to_date           date,          -- NULL = vigente. INTERVALO MEDIO-ABIERTO [from_date, to_date)
  reason            public.rodeo_membership_reason not null,
  -- L-2 (anexo LOW de Gate 1): política de borrado del actor unificada en `on delete set null` para las TRES
  -- columnas de actor del delta (`changed_by` acá, `closed_by`/`reopened_by` en 0128). Se aparta del molde
  -- 0030 (`no action`) A PROPÓSITO: el derecho de supresión (Ley 25.326) gana sobre conservar el nombre del
  -- actor, y el hecho auditado (qué se movió, cuándo) sobrevive igual.
  changed_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint rodeo_membership_history_range_ck check (to_date is null or to_date >= from_date)
);

comment on table public.rodeo_membership_history is
  'Historia de membresía de rodeo por perfil (delta campañas congeladas, F4/D3). SEMÁNTICA MEDIO-ABIERTA '
  '[from_date, to_date): un perfil está en el rodeo en la fecha D si y solo si from_date <= D y (to_date is '
  'null o to_date > D). El intervalo medio-abierto NO es un detalle de estilo: con intervalos inclusivos un '
  'movimiento el mismo día deja al animal en DOS rodeos ese día y, si la fecha de corte de campaña cae ahí, '
  'la vaca cuenta en dos campañas. Con to_date = primer día en que ya NO está, eso es imposible por '
  'construcción, y un alta+movimiento el mismo día produce el intervalo vacío [hoy, hoy) que nunca matchea. '
  'DEUDA DECLARADA (DL7/RCC.1.9): el backfill de esta migración ASUME QUE NINGÚN ANIMAL SE MOVIÓ DE RODEO '
  'ANTES DEL DEPLOY; para los que sí se movieron, la historia previa que siembra es FALSA. No hay fuente para '
  'reconstruirla (el audit log de spec 18 cubre solo user_roles y retiene 90 días). El historial fiel empieza '
  'a acumularse en el deploy. Segunda limitación: la fecha de un movimiento es la del UPLOAD, no la del hecho '
  'en el campo (un movimiento cargado offline y subido 3 días después queda fechado el día de la subida); '
  'aceptable porque el corte de campaña es anual. '
  'FRONTERA DE SYNC (DL8) — corregido tras Gate 2 M-C1, la versión anterior decía "no sincroniza porque no '
  'está en el YAML", que confunde dos capas: la publicación `powersync` de este proyecto es **FOR ALL '
  'TABLES** (verificado en `pg_publication`, igual que declara la cabecera de 0124) y el pg_default_acl le da '
  '`SELECT` a `powersync_role`, así que las filas de esta tabla **SÍ cruzan al slot de replicación** — no se '
  'puede excluir una tabla de un FOR ALL TABLES. Lo que las mantiene fuera de los DEVICES es la capa de '
  '**sync streams** (`sync-streams/mitropero.yaml`): no hay stream catch-all, así que una tabla que ninguna '
  'stream nombra nunca llega a un SQLite local — mismo mecanismo que mantiene afuera a `animals`/`users`/ '
  '`import_log` y a `audit.record_version`. El guard (TR.19) es el correcto para ese invariante porque '
  'matchea el YAML, que es donde vive la frontera real. Residual declarado: costo de WAL y superficie hacia '
  'el servicio administrado de PowerSync. NO agregar estas tablas a `mitropero.yaml`.';

comment on column public.rodeo_membership_history.establishment_id is
  'Denormalizado por convención (ADR-026). NO ES FRONTERA DE AUTORIZACIÓN: la RLS de esta tabla usa '
  'has_role_in(establishment_of_profile(animal_profile_id)) — la cadena de FK canónica (DP-19), igual que '
  '0030:57-58. Esta columna PUEDE QUEDAR STALE: el trigger dispara con `update of rodeo_id, status, '
  'deleted_at` y un cambio de animal_profiles.establishment_id no está en esa lista. Hoy es inocuo porque '
  'transfer_animal (0087) crea un perfil NUEVO en el destino en vez de mover el existente. El día que alguien '
  '"optimice" la policy a has_role_in(establishment_id) —que es lo que hacen las otras dos tablas de este '
  'mismo delta— esta columna pasa a ser frontera de autorización con un valor potencialmente viejo: PRIMERO '
  'hay que agregar establishment_id a la lista de columnas del trigger. (Gate 1, anexo LOW L-5.)';

comment on column public.rodeo_membership_history.to_date is
  'NULL = membresía vigente. Si no es NULL, es el PRIMER DÍA EN QUE EL PERFIL YA NO ESTÁ en el rodeo '
  '(intervalo medio-abierto). El índice único parcial garantiza a lo sumo UNA fila vigente por perfil.';

-- ============================================================================
-- (2) Índices (RCC.1.3)
-- ============================================================================
create index rodeo_membership_history_by_profile
  on public.rodeo_membership_history (animal_profile_id, from_date desc);
-- el predicado del reporte: "perfiles del rodeo R vigentes en la fecha D"
create index rodeo_membership_history_by_rodeo_date
  on public.rodeo_membership_history (rodeo_id, from_date, to_date);
-- INVARIANTE (RCC.1.3): a lo sumo UNA membresía vigente por perfil. Es lo que hace que "¿dónde está hoy?"
-- tenga una sola respuesta y que el trigger no pueda dejar dos filas abiertas por una carrera.
create unique index rodeo_membership_history_one_open
  on public.rodeo_membership_history (animal_profile_id) where to_date is null;

-- ============================================================================
-- (3) RLS + grants (RCC.1.11, RCC.9.9, DP-19)
-- ============================================================================
alter table public.rodeo_membership_history enable row level security;
-- Molde 0030:57-58 — tenant por la CADENA DE FK, no por la columna denormalizada. La diferencia con las dos
-- tablas de 0128 es deliberada (DP-19): esta tabla cuelga de animal_profiles, que SÍ es escribible por el
-- cliente, así que se conserva la derivación canónica.
create policy rodeo_membership_history_select on public.rodeo_membership_history
  for select using (has_role_in(establishment_of_profile(animal_profile_id)));
-- ⚠ EL `revoke` VA PRIMERO, Y NO ES DECORATIVO (Gate 2 H-C1).
-- Este proyecto tiene un `pg_default_acl` para las tablas que `postgres` crea en `public`:
--   postgres=arwdDxtm | anon=Dxtm | authenticated=Dxtm | service_role=Dxtm | powersync_role=r
-- (medido con `select defaclacl from pg_default_acl`). `D` es **TRUNCATE**: toda tabla nueva del schema nace
-- con TRUNCATE concedido a `anon` y a `authenticated`, y la RLS NO lo puede restringir — TRUNCATE no es un
-- comando sobre el que exista policy (`pg_policies.cmd` solo toma DELETE/INSERT/SELECT/UPDATE). Un TRUNCATE
-- borraría las filas de TODOS los tenants de una, con la RLS en verde.
-- **NO es una condición que introduzca este delta**: alcanza a las 35 tablas de `public` sin excepción
-- (incluida `animal_category_history`, el molde de esta tabla). El barrido general está anotado en
-- `docs/backlog.md`. Estas tres tablas lo revocan explícitamente porque **sobre ellas está escrito el
-- invariante de DP-19** ("no hay camino de escritura del cliente"), y un invariante escrito exige que su
-- ACL diga lo mismo. Precedente PARCIAL del repo: `0068:208` hace `revoke all on public.user_private from
-- anon, public` — o sea que revoca de `anon` pero **NO de `authenticated`**, así que `user_private` conserva
-- TRUNCATE para el rol que sí llega por PostgREST (medido: `authenticated=rwDxtm`). El `revoke` de acá suma
-- `authenticated` a propósito: es más estricto que su precedente, y esa diferencia es justamente la que saca
-- el TRUNCATE del rol que un usuario logueado usa.
-- Guard que resuelve el VALOR del ACL (no el comportamiento por PostgREST): TR.14e (RCC.13.6.a).
revoke all on public.rodeo_membership_history from public, anon, authenticated;
-- SIN insert/update/delete a authenticated: las filas las escribe ÚNICAMENTE el trigger SECURITY DEFINER.
grant select on public.rodeo_membership_history to authenticated;
grant all    on public.rodeo_membership_history to service_role;

-- ============================================================================
-- (4) Trigger de membresía (RCC.1.4–RCC.1.7, RCC.1.12, RCC.9.7, RCC.9.10)
-- ============================================================================
-- SECURITY DEFINER set search_path = public — molde EXACTO de tg_animal_profiles_record_category_change
-- (0030:23-54). El establishment_id sale de `new.establishment_id` (la fila padre), NUNCA de un valor del
-- cliente (anti-spoof, ADR-026 / RCC.1.12).
--
-- El trigger captura el upload de PowerSync: `moveAnimalToRodeo` (app/src/services/animals.ts) es un UPDATE
-- plano de rodeo_id que sube por la cola de CRUD → dispara igual que cualquier UPDATE. No hace falta tocar
-- el cliente, y por lo tanto el offline-first no se rompe (el movimiento se carga sin red y la historia se
-- escribe cuando el UPDATE llega).
create or replace function public.tg_animal_profiles_record_rodeo_change ()
returns trigger language plpgsql
security definer set search_path = public as $$
declare
  v_reason public.rodeo_membership_reason;
  v_from   date;
  v_open   record;
  v_in_padron boolean;
begin
  if tg_op = 'INSERT' then
    -- transfer_animal (0087) setea la GUC LOCAL rafaq.is_transfer='on' antes de crear el perfil destino
    -- (0088 documenta que un cliente no puede setearla dentro de la transacción del RPC).
    v_reason := case when coalesce(current_setting('rafaq.is_transfer', true), 'off') = 'on'
                     then 'transfer_in'::public.rodeo_membership_reason
                     else 'initial'::public.rodeo_membership_reason end;
    v_from   := coalesce(new.entry_date, new.created_at::date);

    if new.status = 'active' and new.deleted_at is null then
      -- perfil EN padrón → membresía vigente
      insert into public.rodeo_membership_history
        (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
      values (new.id, new.rodeo_id, new.establishment_id, v_from, null, v_reason, auth.uid());
    else
      -- perfil que nace YA FUERA del padrón (import histórico de un animal vendido): intervalo cerrado.
      -- greatest(...) protege el CHECK to_date >= from_date cuando entry_date es posterior a exit_date.
      insert into public.rodeo_membership_history
        (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
      values (new.id, new.rodeo_id, new.establishment_id, v_from,
              greatest(coalesce(new.exit_date, current_date), v_from), v_reason, auth.uid());
    end if;
    return new;
  end if;

  -- ── UPDATE ───────────────────────────────────────────────────────────────────────────────────────────
  -- DP-4: la membresía es el ÚNICO predicado de presencia. `exit_date` entra como el to_date del cierre de
  -- fila, no como un segundo filtro que pueda divergir.
  v_in_padron := (new.status = 'active' and new.deleted_at is null);

  select h.id, h.from_date, h.rodeo_id
    into v_open
    from public.rodeo_membership_history h
   where h.animal_profile_id = new.id and h.to_date is null
   order by h.from_date desc
   limit 1;

  if not v_in_padron then
    -- RCC.1.6 — sale del padrón (status <> 'active' o deleted_at): cierra la vigente, si la hay.
    if v_open.id is not null then
      update public.rodeo_membership_history
         set to_date = greatest(coalesce(new.exit_date, current_date), v_open.from_date)
       where id = v_open.id;
    end if;
    return new;
  end if;

  if v_open.id is null then
    -- RCC.1.7 — vuelve al padrón sin fila vigente (reingreso / un-delete).
    insert into public.rodeo_membership_history
      (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
    values (new.id, new.rodeo_id, new.establishment_id, current_date, null, 'reactivation', auth.uid());
    return new;
  end if;

  if new.rodeo_id is distinct from v_open.rodeo_id then
    -- RCC.1.5 — movimiento de rodeo: cierra la vigente HOY y abre una nueva HOY. `is distinct from` hace que
    -- un `update of rodeo_id` que no cambia nada no escriba (molde 0030).
    update public.rodeo_membership_history
       set to_date = greatest(current_date, v_open.from_date)
     where id = v_open.id;
    insert into public.rodeo_membership_history
      (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
    values (new.id, new.rodeo_id, new.establishment_id, current_date, null, 'move', auth.uid());
  end if;

  return new;
end; $$;

comment on function public.tg_animal_profiles_record_rodeo_change is
  'Escribe rodeo_membership_history a partir de animal_profiles (delta campañas congeladas, RCC.1.4-1.7). '
  'SECURITY DEFINER set search_path = public (molde 0030). establishment_id SIEMPRE de la fila padre '
  '(anti-spoof, RCC.1.12). 5 ramas: INSERT en padrón / INSERT ya fuera del padrón / UPDATE con cambio de '
  'rodeo / UPDATE que sale del padrón / UPDATE que vuelve al padrón sin fila vigente. transfer_animal marca '
  'el alta del perfil destino como `transfer_in` vía la GUC local rafaq.is_transfer (0088). NO se re-apuntan '
  'filas en transfer_animal (RCC.1.13): la historia de membresía del perfil de origen se queda en el '
  'establecimiento de origen — re-apuntarla movería la historia de rodeo al campo destino, que es la fuga F4 '
  'elevada a escala de establecimiento. El próximo que lea 0087 va a querer "arreglar" esa asimetría: no lo '
  'haga.';

create trigger animal_profiles_record_rodeo_change_ins
  after insert on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_rodeo_change();

create trigger animal_profiles_record_rodeo_change_upd
  after update of rodeo_id, status, deleted_at on public.animal_profiles
  for each row execute function public.tg_animal_profiles_record_rodeo_change();

-- ============================================================================
-- (5) Backfill idempotente (RCC.1.8, DP-9)
-- ============================================================================
-- Una fila por perfil existente. `to_date` NULO solo para los que están en padrón; para los demás se cierra
-- con exit_date (o hoy si falta — `exit_date` es una convención de flujo, no un invariante de DB: 21/21
-- poblados en DEV, sin constraint). DP-9: DL7 decía literalmente "todas abiertas", pero con todas abiertas
-- los perfiles ya dados de baja figurarían presentes HOY. Es un refinamiento, no una contradicción.
-- El `where not exists` lo hace idempotente: correrlo dos veces no duplica (RCC.1.8, TR.15).
insert into public.rodeo_membership_history
  (animal_profile_id, rodeo_id, establishment_id, from_date, to_date, reason, changed_by)
select p.id, p.rodeo_id, p.establishment_id,
       coalesce(p.entry_date, p.created_at::date) as from_date,
       case when p.status = 'active' and p.deleted_at is null then null
            else greatest(coalesce(p.exit_date, current_date),
                          coalesce(p.entry_date, p.created_at::date)) end,
       'backfill', null
from public.animal_profiles p
where not exists (select 1 from public.rodeo_membership_history h
                  where h.animal_profile_id = p.id);

notify pgrst, 'reload schema';

commit;
