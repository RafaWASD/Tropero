-- 0128_campaign_snapshots.sql
-- Delta CAMPAÑAS CONGELADAS (spec 07) — ② / DL2 / DL4 / F5 / F8. Las dos tablas del snapshot (cabecera +
-- detalle por animal) y los helpers de capa 0 que consumen 0129 y 0130.
--
-- Cubre: RCC.4.1–RCC.4.11, RCC.5.3, RCC.5.7.c, RCC.2.6, RCC.2.7, RCC.3.1, RCC.3.2, RCC.7.6, RCC.9.5, RCC.9.6,
-- RCC.9.6.a, RCC.9.9, DP-2, DP-13, DP-15, DP-19, DP-25, DP-30, y el anexo LOW de Gate 1 (L-2, L-4).
--
-- 🔴 NO se aplica al remoto desde acá: la aplica el LEADER tras Gate 1 + reviewer + Gate 2 + Gate 2.5 + OK de
-- Raf, en el orden 0127 → 0128 → 0129 → 0130. La suite supabase/tests/reports/run.cjs queda ROJA-HASTA-APPLY.
-- **No** se agrega nada a `sync-streams/rafaq.yaml` (DL8 / RCC.4.9).

begin;

-- ============================================================================
-- (1) Helper de authz: is_owner_or_vet_of (punto ① / RCC.5.3)
-- ============================================================================
-- COPIA LITERAL de is_owner_of (0005:31-48, verificada contra el cuerpo VIGENTE del remoto con
-- pg_get_functiondef — regla reference_function_recreate_base), cambiando ÚNICAMENTE
-- `ur.role = 'owner'` por `ur.role in ('owner','veterinarian')`.
--
-- Las DOS cláusulas de abajo son load-bearing y no se sacan (Gate 1 H-3):
--   · `ur.active = true`      → un ex-miembro REVOCADO (owner o vet dado de baja) NO puede cerrar ni reabrir
--                               campañas del campo del que lo echaron. Oráculo: TR.14f(a) — sabe fallar.
--   · `e.deleted_at is null`  → un owner de un campo soft-deleteado no sigue operando sobre él. HOY es
--                               redundante (0076 desactiva los roles al borrar el campo y prohíbe
--                               reactivarlos, así que el estado es inalcanzable y el rechazo lo produce
--                               `ur.active`), y por eso su único oráculo posible es textual: TR.14g lo
--                               asserta sobre el cuerpo, rotulado como tal (Gate 1 N-4). Se vuelve
--                               load-bearing el día que exista el flujo de restore que 0076 difiere.
create or replace function public.is_owner_or_vet_of (est_id uuid)
returns boolean language sql
security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.establishments e on e.id = ur.establishment_id
    where ur.user_id = auth.uid()
      and ur.establishment_id = est_id
      and ur.role in ('owner','veterinarian')
      and ur.active = true
      and e.deleted_at is null
  );
$$;

comment on function public.is_owner_or_vet_of is
  'Guard de ESCRITURA del delta campañas congeladas (punto ①): cierra y reabre campañas el owner O el '
  'veterinario ACTIVO del establecimiento; el field_operator no. Copia literal de is_owner_of (0005) con '
  'ur.role in (owner, veterinarian). Mantiene ur.active = true y el join a establishments con deleted_at is '
  'null: sin la primera, un rol revocado seguiría congelando reportes del campo del que lo echaron.';

-- ============================================================================
-- (2) Helpers puros de capa 0 (RCC.3.1, RCC.3.2, RCC.2.6, RCC.2.7, RCC.5.7.c, RCC.7.6)
-- ============================================================================

-- DL5 — la ventana del TACTO de la campaña, en UN SOLO LUGAR. Pura (no toca tablas) → IMMUTABLE, sin
-- SECURITY DEFINER y sin superficie de authz (no hay nada que autorizar: opera sobre los valores que le pasa
-- el caller). Wrap de fin de año: con months={11,12,1} el mínimo es 1 → la ventana es el año calendario
-- completo, que es exactamente la convención de set-membership del as-built (0105).
create or replace function public.campaign_tacto_bounds (p_months smallint[], p_year int)
returns table (tacto_from date, tacto_to date)
language sql immutable set search_path = public as $$
  select make_date(p_year, m, 1),
         make_date(p_year + 1, m, 1) - 1
  from (select coalesce((select min(x)::int from unnest(p_months) x), 1) as m) s;
$$;

comment on function public.campaign_tacto_bounds is
  'DL5/RCC.3.1: ventana del tacto de la campaña p_year = [min(service_months)/p_year, mismo mes de p_year+1 '
  '− 1 día]. Sin meses de servicio → año calendario completo (RCC.3.2/DP-18). Función PURA: no toca tablas, '
  'no tiene guard porque no hay dato de nadie que exponer. Revocada de public/anon/authenticated igual '
  '(RCC.9.5): ningún cliente la invoca.';

-- F3 — la categoría del perfil A UNA FECHA. Degradación documentada (RCC.2.7): sin historia previa a la
-- fecha, devuelve la categoría ACTUAL. Solo puede dispararse en perfiles anteriores a 0030 o re-apuntados por
-- transfer_animal; la pertenencia al rodeo ya excluye a los que no existían en la campaña.
create or replace function public.animal_category_at (p_profile_id uuid, p_on date)
returns uuid language sql
security definer stable set search_path = public as $$
  select coalesce(
    (select h.to_category_id from public.animal_category_history h
      where h.animal_profile_id = p_profile_id and h.changed_at::date <= p_on
      order by h.changed_at desc limit 1),
    (select p.category_id from public.animal_profiles p where p.id = p_profile_id)
  );
$$;

comment on function public.animal_category_at is
  'RCC.2.6/RCC.2.7 (F3): categoría del perfil a la fecha p_on, del último animal_category_history con '
  'changed_at::date <= p_on; si no hay historia previa, degrada a la categoría ACTUAL (perfiles anteriores a '
  '0030 o re-apuntados por transfer_animal). SIN GUARD DE TENANT A PROPÓSITO (Gate 1, anexo LOW L-4): no es '
  'alcanzable — está revocada de public, anon y authenticated, y solo la invocan funciones SECURITY DEFINER '
  'que ya guardaron el tenant. SI ALGUNA VEZ SE LE DA GRANT, HAY QUE AGREGARLE EL GUARD PRIMERO: tal como '
  'está, devuelve la categoría de cualquier animal_profile_id del sistema.';

-- F8 / DP-15 — el predicado "el ciclo de la campaña terminó", con UN SOLO DUEÑO. Lo consumen close_campaign
-- (para decidir si hace falta reconocimiento) y rodeo_campaign_status (para sugerir el cierre). Duplicarlo
-- garantiza que en seis meses uno de los dos quede viejo y la app sugiera cerrar algo que el cierre rechaza.
-- PURA SOBRE VALORES: no toca tablas ni invoca las RPC de KPI — los dos callers ya tienen los números en la
-- mano (del cómputo en vivo o del snapshot). STABLE (no IMMUTABLE) porque depende de current_date.
-- Los 18 meses = 9 de gestación + ~8 de destete + margen. [VALIDAR CON FACUNDO] el número exacto.
create or replace function public.campaign_cycle_complete (
  p_weaning_status text, p_pending_weaning int, p_state_as_of date
) returns boolean language sql stable set search_path = public as $$
  select (p_weaning_status = 'ok' and coalesce(p_pending_weaning, 0) = 0)
      or (p_state_as_of is not null and current_date > p_state_as_of + interval '18 months');
$$;

comment on function public.campaign_cycle_complete is
  'DP-15/RCC.5.7.c: ÚNICO dueño del predicado "el ciclo de la campaña terminó". Lo consumen close_campaign '
  '(gate G3 de reconocimiento, F8) y rodeo_campaign_status (cycle_complete → la sugerencia de cierre de D1). '
  'NO reimplementar en ninguno de los dos: si divergen, la app sugiere cerrar algo que el cierre rechaza. '
  'Pura sobre valores ya computados; no recomputa ningún KPI.';

-- Descriptor legible de lo que falta. Alimenta (a) el mensaje del 23514, (b) missing_at_close del snapshot y
-- (c) rodeo_campaign_status.missing_summary, para que la UI enumere sin re-derivar nada.
create or replace function public.campaign_missing_summary (
  p_calving_status text, p_pending_pregnant int, p_weaning_status text, p_pending_weaning int
) returns text language sql immutable set search_path = public as $$
  select nullif(concat_ws(' · ',
    case when coalesce(p_pending_pregnant,0) > 0
         then p_pending_pregnant || ' preñadas sin parir' end,
    case when coalesce(p_pending_weaning,0) > 0
         then p_pending_weaning || ' crías sin destetar' end,
    case when p_calving_status = 'not_calving_season' then 'la parición no empezó' end,
    case when p_weaning_status = 'not_weaning_season' then 'el destete no empezó' end
  ), '');
$$;

comment on function public.campaign_missing_summary is
  'F8/RCC.4.11: descriptor legible de lo que le falta a la campaña para tener el ciclo completo. Único dueño '
  'del texto; lo consumen el mensaje del 23514 de close_campaign, missing_at_close del snapshot y '
  'rodeo_campaign_status.missing_summary. Pura sobre valores.';

-- ============================================================================
-- (3) Cabecera del snapshot — rodeo_campaign_snapshots (RCC.4.1–4.3, 4.10, 4.11)
-- ============================================================================
create table public.rodeo_campaign_snapshots (
  id                uuid primary key default gen_random_uuid(),
  rodeo_id          uuid not null references public.rodeos(id) on delete cascade,
  campaign_year     int  not null,
  -- RCC.4.8.a: lo escribe close_campaign con v_est, el MISMO valor que derivó el guard de la fila de
  -- `rodeos`. Nunca del cliente (no hay grant de escritura) ni de ninguna otra fila. `not null` es
  -- OBLIGATORIO: es la mitad de la FK compuesta del detalle y, con MATCH SIMPLE (el default), un NULL en
  -- cualquier columna de una FK compuesta DESACTIVA el chequeo en silencio.
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  -- rastro del cierre / reapertura (D1, DL4). L-2: actor con `on delete set null` en las 3 tablas del delta.
  closed_at         timestamptz not null default now(),
  closed_by         uuid references public.users(id) on delete set null,
  reopened_at       timestamptz,
  reopened_by       uuid references public.users(id) on delete set null,
  -- F8: ¿se cerró con el ciclo INCOMPLETO (reconocido a propósito)? y qué faltaba en ese momento.
  closed_incomplete boolean not null default false,
  missing_at_close  text,
  -- parámetros del cómputo, congelados (auditoría + F5)
  service_months    smallint[],
  state_as_of       date,          -- DL6: fecha de corte del estado histórico
  tacto_from        date,          -- DL5
  tacto_to          date,          -- DL5
  formula_version   smallint not null default 1,
  -- los 5 KPI congelados (unión de los `returns table` de las 5 RPC)
  is_configured     boolean not null,
  n_months          int not null,
  serviced          int not null,
  retired           int not null,
  entoradas         int not null,
  pregnant          int not null,
  empty             int not null,
  calved            int not null,
  pending_pregnant  int not null,
  calving_status    text not null,
  ccl_head          int not null,
  ccl_body          int not null,
  ccl_tail          int not null,
  ccl_total         int not null,
  born_head         int not null,
  born_body         int not null,
  born_tail         int not null,
  born_total        int not null,
  weaned            int not null,
  pending_weaning   int not null,
  weaning_status    text not null,
  created_at        timestamptz not null default now(),
  constraint rodeo_campaign_snapshots_year_ck check (campaign_year between 1900 and 2400)
);

comment on table public.rodeo_campaign_snapshots is
  'La FOTO de una campaña cerrada (ADR-032): los 21 números de las 5 RPC de KPI + los parámetros con los que '
  'se computaron (service_months/n_months/is_configured congelados por F5, fecha de corte, ventana del tacto '
  'y formula_version). Mientras exista una fila con reopened_at NULL para (rodeo_id, campaign_year), las 7 '
  'funciones de campaña devuelven ESTOS valores y no computan nada (DL3). La escribe ÚNICAMENTE '
  'close_campaign (SECURITY DEFINER); no hay grant de insert/update/delete a authenticated y la única policy '
  'es de SELECT — ese invariante es el que habilita que la RLS scopee por establishment_id (desvío declarado '
  'de ADR-026, DP-19) y lo verifica TR.14e. La reapertura NO borra: marca reopened_at/reopened_by y un '
  're-cierre inserta una fila nueva (DP-12), así que la tabla es append-only de hecho.';

comment on column public.rodeo_campaign_snapshots.establishment_id is
  'FRONTERA DE AUTORIZACIÓN de esta tabla (RLS: has_role_in(establishment_id)) — desvío DECLARADO de ADR-026 '
  '(DP-19), que para las tablas hijas manda derivar el tenant por la cadena de FK. Acá la columna NO tiene '
  'propósito de stream (DL8: esta tabla no sincroniza a devices) y sí es la frontera, y eso es legítimo SOLO '
  'mientras valga el invariante: el cliente no tiene NINGÚN camino de escritura sobre esta tabla. QUÉ '
  'SOSTIENE ESE INVARIANTE (corregido tras Gate 2 H-C1 — antes decía "no existe grant de escritura", que era '
  'FALSO al momento del apply): (1) el `revoke all … from public, anon, authenticated` explícito de esta '
  'misma migración, porque el pg_default_acl del schema concede TRUNCATE (y REFERENCES/TRIGGER/MAINTAIN) a '
  'anon y authenticated en TODA tabla nueva de `public`, y la RLS no puede restringir TRUNCATE; (2) el único '
  '`grant` posterior es `select` a authenticated; (3) la única policy es `for select`. Guard: TR.14e, que '
  'resuelve el VALOR del ACL con has_table_privilege (TRUNCATE/INSERT/UPDATE/DELETE × anon/authenticated) '
  'ADEMÁS del comportamiento por PostgREST y de pg_policies — el comportamiento por PostgREST NO puede ver un '
  'grant de TRUNCATE, que es por lo que la afirmación anterior tenía un guard ciego. Procedencia: v_est de '
  'close_campaign (la fila de `rodeos`), nunca del cliente (RCC.4.8.a). Asimetría declarada (DP-33): '
  'detalle↔cabecera se cierra por FK compuesta; cabecera↔rodeo se cierra por test (TR.14h-bis).';

comment on column public.rodeo_campaign_snapshots.formula_version is
  'Con qué generación de fórmulas se computó esta foto. Las fórmulas ya cambiaron dos veces (0117 y 0118): '
  'sirve para explicar una discrepancia futura sin adivinar.';

comment on column public.rodeo_campaign_snapshots.closed_incomplete is
  'F8/RCC.4.11: la campaña se cerró con el ciclo INCOMPLETO y el usuario lo reconoció explícitamente '
  '(p_acknowledge_incomplete). No lo setea el cliente: se deriva de campaign_cycle_complete en el server. Un '
  'reporte comparado año contra año tiene que poder decir "este número se congeló antes de que terminara la '
  'parición", o el benchmarking compara peras con manzanas.';

-- RCC.4.10: a lo sumo UN snapshot vigente por (rodeo, campaña). Los reabiertos quedan como historia.
create unique index rodeo_campaign_snapshots_active
  on public.rodeo_campaign_snapshots (rodeo_id, campaign_year) where reopened_at is null;
create index rodeo_campaign_snapshots_by_est
  on public.rodeo_campaign_snapshots (establishment_id, campaign_year desc);
-- RCC.4.8.b: destino de la FK compuesta del detalle → el tenant de padre e hijo NO puede divergir.
alter table public.rodeo_campaign_snapshots
  add constraint rodeo_campaign_snapshots_id_est_uq unique (id, establishment_id);

-- ============================================================================
-- (4) Detalle por animal — rodeo_campaign_snapshot_animals (② / RCC.4.4–4.7)
-- ============================================================================
create type public.campaign_bucket as enum ('serviced','pregnant','empty','calved','weaned');

create table public.rodeo_campaign_snapshot_animals (
  id                uuid primary key default gen_random_uuid(),
  snapshot_id       uuid not null references public.rodeo_campaign_snapshots(id) on delete cascade,
  establishment_id  uuid not null,
  -- RCC.4.8.b — el tenant del detalle NO PUEDE divergir del de su cabecera. No es una promesa: es una FK, y
  -- las FK se enforcen para TODOS los roles (incluido service_role y el owner de la tabla), a diferencia de
  -- la RLS. Las dos columnas son `not null` a propósito: con MATCH SIMPLE, un NULL desactivaría el chequeo.
  constraint rodeo_campaign_snapshot_animals_est_fk
    foreign key (snapshot_id, establishment_id)
    references public.rodeo_campaign_snapshots (id, establishment_id) on delete cascade,
  bucket            public.campaign_bucket not null,
  -- ② el detalle SOBREVIVE a la baja del animal: nunca `on delete cascade`.
  animal_profile_id uuid references public.animal_profiles(id) on delete set null,
  idv               text,     -- identificador legible CONGELADO al cierre
  source            text,     -- 'natural' | 'ai'        (solo bucket='serviced')
  pregnancy_status  text,     -- 'large'|'medium'|'small' (solo bucket='pregnant')
  mother_profile_id uuid references public.animal_profiles(id) on delete set null, -- solo bucket='weaned'
  mother_idv        text,
  created_at        timestamptz not null default now()
);

comment on table public.rodeo_campaign_snapshot_animals is
  'El detalle por animal de una campaña cerrada (punto ②): UNA FILA POR (snapshot, animal, bucket), con '
  'bucket en {serviced,pregnant,empty,calved,weaned}. Enum multi-fila y no booleanos (DP-2/§2.4): el detalle '
  'ES la evidencia del número y sale del MISMO select que lo calculó, sin un plegado intermedio que pueda '
  'mentir — count(*) por bucket debe dar el número congelado de la cabecera (RCC.4.7, TR.20). Sobrevive a la '
  'baja del animal: animal_profile_id es `on delete set null` (NUNCA cascade) y el idv queda congelado, así '
  'que borrar un animal no vacía un reporte cerrado. Sin grant de escritura a authenticated y con una sola '
  'policy de SELECT (TR.14e).';

comment on column public.rodeo_campaign_snapshot_animals.establishment_id is
  'Tomado de la FILA DE SNAPSHOT PADRE, no de animal_profiles.establishment_id de cada animal (RCC.4.8.a). '
  'Al cerrar coinciden siempre, pero la fuente importa: si un día un camino moviera un perfil de '
  'establecimiento in-place, tomarlo del animal haría que una fila del detalle de A pasara a ser legible por '
  'B e ilegible por A. La FK compuesta (snapshot_id, establishment_id) lo vuelve estructural.';

-- RCC.4.5: el mismo animal puede estar en varios buckets del mismo snapshot (servida Y preñada Y parida).
create unique index rodeo_campaign_snapshot_animals_unique
  on public.rodeo_campaign_snapshot_animals (snapshot_id, bucket, animal_profile_id);
create index rodeo_campaign_snapshot_animals_by_bucket
  on public.rodeo_campaign_snapshot_animals (snapshot_id, bucket);

-- ============================================================================
-- (5) RLS + grants de las 2 tablas de snapshot (RCC.4.8, RCC.9.9, DP-19)
-- ============================================================================
alter table public.rodeo_campaign_snapshots        enable row level security;
alter table public.rodeo_campaign_snapshot_animals enable row level security;

-- SOLO SELECT. Cualquier policy distinta de `for select` rompe el invariante que sostiene DP-19 y pone en
-- rojo a TR.14e (que consulta pg_policies y exige cmd = 'SELECT' en las 3 tablas del delta).
create policy rodeo_campaign_snapshots_select on public.rodeo_campaign_snapshots
  for select using (has_role_in(establishment_id));
create policy rodeo_campaign_snapshot_animals_select on public.rodeo_campaign_snapshot_animals
  for select using (has_role_in(establishment_id));

-- ⚠ EL `revoke` VA PRIMERO (Gate 2 H-C1). El `pg_default_acl` de las tablas que `postgres` crea en `public`
-- concede `Dxtm` a `anon` y `authenticated` — `D` es **TRUNCATE**, y la RLS no lo puede restringir (no
-- existe policy de TRUNCATE). Sobre estas dos tablas está escrito el invariante que sostiene el desvío de
-- ADR-026 (DP-19), así que su ACL tiene que decir lo mismo que el comentario. No es una condición de este
-- delta —alcanza a las 35 tablas de `public`, y el barrido está en `docs/backlog.md`—, pero acá el
-- invariante es load-bearing. Precedente PARCIAL: `0068:208` revoca solo de `anon, public` (medido:
-- `user_private` conserva TRUNCATE para `authenticated`); acá se suma `authenticated`. Guard por ACL: TR.14e.
-- `powersync_role` NO se toca: su `SELECT` es lo que lee la replicación lógica (la publicación es
-- FOR ALL TABLES — ver el comment on table de 0127 y §15 R12); revocárselo rompería el slot, no la frontera.
revoke all on public.rodeo_campaign_snapshots        from public, anon, authenticated;
revoke all on public.rodeo_campaign_snapshot_animals from public, anon, authenticated;

grant select on public.rodeo_campaign_snapshots        to authenticated;  -- SIN insert/update/delete
grant select on public.rodeo_campaign_snapshot_animals to authenticated;  -- SIN insert/update/delete
grant all    on public.rodeo_campaign_snapshots        to service_role;
grant all    on public.rodeo_campaign_snapshot_animals to service_role;

-- ============================================================================
-- (6) Grants de FUNCIÓN + smoke-check fail-closed por LISTA BLANCA + BARRIDO (RCC.9.5, 9.6, 9.6.a / DP-25,
--     DP-30). Los DOS loops salen de la MISMA enumeración, y los revoke/grant también.
-- ============================================================================
-- Por qué así y no enumerando lo prohibido: enumerar lo que hay que revocar se escribe sobre las funciones
-- que HOY existen y no falla cuando aparece una nueva — el patrón que este repo ya se comió cuatro veces.
-- Se invierte: se declara UNA sola lista, la de lo PÚBLICO, y de ella salen (a) los revoke/grant y (b) los
-- dos checks, uno por cada mitad del contrato §5.8 de 0106.
--
-- Los revoke/grant se derivan del CATÁLOGO (`pg_get_function_identity_arguments`) en vez de escribirse con
-- la firma tipada a mano: así la firma no puede quedar vieja (el 42883 que T42 previene deja de ser posible
-- por construcción) y la lista blanca sigue siendo la ÚNICA enumeración de la migración (RCC.9.6).
--
-- PRIMERO se cierran las internas de capa 0 creadas acá, y estos `revoke` son **LOAD-BEARING, no defensa en
-- profundidad**: una función nueva en `public` nace con `EXECUTE` a `PUBLIC`, o sea alcanzable por `anon`
-- desde PostgREST.
--
-- ⚠ ESTE PUNTO SE MIDIÓ DOS VECES Y LA PRIMERA CONCLUSIÓN FUE FALSA. Gate 2 (M-C3) reportó que "en esta base
-- las funciones nuevas NO nacen EXECUTE-ables por PUBLIC" mirando el ACL de funciones existentes
-- (`postgres=X/postgres`) — pero esas son funciones a las que su propia migración YA les hizo el `revoke`:
-- es inferir el default desde objetos modificados. Medido directo, creando una función sin ningún
-- grant/revoke dentro de `begin/rollback`:
--   quien_crea = postgres · proacl = NULL (= default built-in) · public_x = TRUE · anon_x = TRUE · auth_x = TRUE
-- El `pg_default_acl` de `postgres` sobre funciones de `public` (`postgres=X/postgres`) **suma** privilegios;
-- no revoca el `EXECUTE` a `PUBLIC` del built-in. Conclusión: sin estos `revoke`, `campaign_tacto_bounds`,
-- `animal_category_at`, `campaign_cycle_complete` y `campaign_missing_summary` quedarían **invocables por
-- `anon`**. El barrido de abajo verifica el estado final, y el loop (2) es un oráculo real, no un adorno.
revoke execute on function public.campaign_tacto_bounds (smallint[], int)         from public, anon, authenticated;
revoke execute on function public.animal_category_at (uuid, date)                 from public, anon, authenticated;
revoke execute on function public.campaign_cycle_complete (text, int, date)       from public, anon, authenticated;
revoke execute on function public.campaign_missing_summary (text, int, text, int) from public, anon, authenticated;

do $$
declare
  -- ÚNICA enumeración de la migración. De acá salen los grants Y los checks.
  -- ⚠ LA LISTA IDENTIFICA FUNCIONES, NO NOMBRES: cada entrada es una FIRMA COMPLETA, y se resuelve con
  -- `to_regprocedure` al `oid` de esa función exacta. Es la diferencia entre cerrar el agujero de la
  -- sobrecarga y aparentar que se cierra: con la lista por NOMBRE, el loop (0) selecciona por `proname`, así
  -- que una sobrecarga futura de una pública (p. ej. `rodeo_serviced_females(uuid,int,uuid)`) **se
  -- auto-concede a `authenticated` en el propio loop (0)** y, como comparte nombre, queda además excluida
  -- del barrido de internas. Recolectar los `oid` DE ESAS MISMAS FILAS no arregla nada —`oid ∈ v_oids` es
  -- idénticamente equivalente a `proname ∈ v_public`—; hay que resolver por firma. Con esta forma, la
  -- sobrecarga no está en la lista → no se le concede nada, y si alguien se la concede aparte, el barrido de
  -- internas la ve y la migración MUERE.
  v_public constant text[] := array[
    'close_campaign(uuid,integer,boolean)',   -- ojo: 3 parámetros, no 2
    'reopen_campaign(uuid,integer)',
    'rodeo_campaign_status(uuid,integer)',
    'rodeo_service_campaign(uuid,integer)',
    'rodeo_serviced_females(uuid,integer)',
    'rodeo_repro_denominator(uuid,integer)',
    'rodeo_pregnancy_kpi(uuid,integer)',
    'rodeo_calving_kpi(uuid,integer)',
    'rodeo_ccl_distribution(uuid,integer)',
    'rodeo_calving_by_stage(uuid,integer)',
    'rodeo_weaning_kpi(uuid,integer)',
    -- Públicas PREEXISTENTES que el barrido por prefijo `rodeo\_%` alcanza (verificado contra el catálogo
    -- del remoto): sin ellas acá, el loop (1) abortaría la migración por dos RPC legítimas de spec 07.
    'rodeo_sessions_list(uuid)',
    'rodeo_weight_by_category(uuid,uuid)',
    -- Helper de authz: mismo estatus que is_owner_of/has_role_in (grant a authenticated, revocado de
    -- public/anon). No matchea ningún prefijo del barrido, así que solo lo cubren el loop (2) y el (3).
    'is_owner_or_vet_of(uuid)'
  ];
  -- `rodeo\_campaign\_%` está contenido en `rodeo\_%`; close_/reopen_ se agregan porque close_campaign y
  -- reopen_campaign NO matchean ningún prefijo con `campaign\_%` (que es prefijo, no sufijo) y sin ellos un
  -- error de tipeo en la lista blanca los dejaría fuera de LOS DOS loops, abiertos a PUBLIC por default.
  v_ns constant text[] := array['rodeo\_%','campaign\_%','close\_%','reopen\_%'];
  v_oids oid[] := '{}';
  v_sig text;
  v_oid oid;
  v_bad record;
begin
  -- (0) Resolver CADA FIRMA a su función y emitir el revoke/grant SOBRE ESA función. El statement se arma
  --     con `%s` sobre `regprocedure`, que imprime la función ya identificada por el catálogo: no depende de
  --     la gramática de nombres de parámetro ni puede alcanzar a otra sobrecarga.
  foreach v_sig in array v_public loop
    v_oid := to_regprocedure('public.' || v_sig);
    if v_oid is not null then
      execute format('revoke execute on function %s from public, anon', v_oid::regprocedure);
      execute format('grant  execute on function %s to authenticated',  v_oid::regprocedure);
      v_oids := v_oids || v_oid;
    end if;
  end loop;

  -- (1) INTERNAS: todo lo del namespace del delta que NO está en la lista blanca no puede ser ejecutable por
  --     public/anon/authenticated. Una interna nueva bajo el namespace nace revocada o la migración MUERE.
  for v_bad in
    select p.oid::regprocedure::text as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public','authenticated']) as rolname) r
    where n.nspname = 'public'
      and (p.proname like any (v_ns) or p.proname = 'animal_category_at')
      and not (p.oid = any (v_oids))          -- por OID, no por nombre (M-C2)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RCC.9.6): % is EXECUTE-able by % (internal → must be revoked)',
      v_bad.fn, v_bad.rolname;
  end loop;

  -- (2) PÚBLICAS: la otra mitad de §5.8 / 0105:237-252. Las de la lista blanca SÍ van a authenticated, pero
  --     NUNCA a anon/public, y el barrido de (1) las excluye POR CONSTRUCCIÓN.
  --     ⚠ HONESTIDAD SOBRE LO QUE ESTE LOOP ES (reviewer H-5): viniendo después del loop (0), que acaba de
  --     revocarlas, **no es un oráculo independiente**: verifica el ESTADO FINAL (que es para lo que sirve un
  --     smoke-check, y atraparía cualquier sentencia posterior que reabra una), no un olvido. Lo que verifica
  --     SÍ es load-bearing: con el default real de esta base (proacl NULL = EXECUTE a PUBLIC, medido), una
  --     pública sin su `revoke` queda invocable por `anon`. El olvido que podía escapar a los dos loops —una
  --     entrada de la lista con la FIRMA mal escrita— lo cierra ahora el propio loop (1) (la función real no
  --     está en `v_oids` → cae en el barrido) y, con el nombre exacto del culpable, el loop (3) de `0130`.
  for v_bad in
    select p.oid::regprocedure::text as fn, r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.oid = any (v_oids)                -- por OID, no por nombre (M-C2)
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED (RCC.9.6.a): % is EXECUTE-able by % (public RPC → must be revoked from anon/public)',
      v_bad.fn, v_bad.rolname;
  end loop;

  raise notice 'grant check OK (0128): lista blanca aplicada, internas revocadas, públicas cerradas a anon/public';
end$$;

notify pgrst, 'reload schema';

commit;
