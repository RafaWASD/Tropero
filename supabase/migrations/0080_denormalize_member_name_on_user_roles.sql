-- 0080_denormalize_member_name_on_user_roles.sql  (feature 15-powersync, PASO 2 / T9.6 — decisión (c2) de Raf)
--
-- DENORMALIZACIÓN del NOMBRE del coworker sobre `user_roles` (decisión (c2) de Raf, ADR-026 §C): columna
-- `member_name text`. Cubre R13.8 (variante c2: nombres de coworkers offline).
--
-- POR QUÉ: `users` es GLOBAL/compartida (un user en >1 campo) -> NO se sincroniza en el modelo JOIN-free
-- (un bucket global filtraría usuarios cross-tenant; un JOIN reventaría). El paso 1 ya sincroniza la matriz de
-- roles vía `user_roles` (self_user_roles + est_members_roles) pero NO los nombres (`users.name`). Raf eligió
-- (c2): denormalizar `name` sobre `user_roles` -> el nombre PROPIO (self_user_roles) y los de coworkers
-- (est_members_roles) quedan offline "rides on" esos streams YA existentes, SIN un stream nuevo de `users`.
-- La tabla global `users` queda FUERA del sync set (su único dato no-PII era `name`, ahora en user_roles;
-- email/phone viven en user_private self-only — ADR-025, NO se tocan acá).
--
-- MANTENIMIENTO (dos triggers + backfill):
--   (1) FORCE en el INSERT y UPDATE del rol (BEFORE INSERT OR UPDATE OF member_name on user_roles): copia
--       member_name desde `users.name WHERE id = NEW.user_id`, ignorando el payload (anti-spoof: el cliente no
--       debe poder mentir el nombre de un miembro — ni en el INSERT ni pisándolo por un UPDATE directo; el
--       stream lo replica como dato de coworker visible a todo el campo. user_roles tiene GRANT UPDATE, así que
--       el force en UPDATE cierra el vector de spoofeo por UPDATE. Re-deriva el MISMO valor de users.name).
--   (2) PROPAGACIÓN del cambio de nombre (AFTER UPDATE OF name on users): propaga a TODAS las filas user_roles
--       del user. Un usuario edita su nombre (profile.update, ONLINE) -> sus filas user_roles se actualizan ->
--       el stream lleva el nombre nuevo a todos los campos donde ese user tiene rol.
--   (3) BACKFILL de las filas user_roles existentes desde users.name.
--
-- NO-LOOP / NO-CONFLICTO (verificado): el UPDATE de propagación (en users) toca SOLO `member_name` en user_roles
-- -> NO toca `active` (no re-dispara el guard user_roles_block_active_on_soft_deleted_establishment de 0076, que
-- es BEFORE UPDATE OF active) ni `user_id`, NO toca `users` de vuelta. SÍ re-dispara el force de abajo (BEFORE
-- UPDATE OF member_name), que re-deriva `users.name` del mismo user -> el MISMO valor que la propagación quería
-- (idempotente, sin pelea entre triggers; el force es AFTER-safe porque users ya tiene el nombre nuevo cuando
-- corre la propagación). Cero recursión (el force no UPDATEa nada, solo setea NEW). El force y el guard de 0076
-- son triggers DISTINTOS sobre columnas disjuntas (member_name vs active) -> cero conflicto.
--
-- RLS AS-BUILT NO CAMBIA (R11.3): la policy user_roles_select (0008) ya controla quién ve qué filas de
-- user_roles (owner ve la matriz; cada user ve la propia). member_name es un dato extra de la MISMA fila,
-- cubierto por esa policy. La frontera de visibilidad de nombres = la frontera de visibilidad de roles, que es
-- la as-built. No se toca ninguna policy. PII (email/phone) NO se denormaliza (sigue en user_private self-only).
--
-- NO aplicar al remoto desde acá: lo aplica el leader por Management API (BEGIN/COMMIT) tras gatear el SQL.

begin;

-- ---------------------------------------------------------------------------
-- (0) Columna member_name (nullable; se puebla por backfill + force; users.name es NOT NULL pero la dejamos
--     nullable por robustez del backfill / por si un rol quedara sin user — no debería, hay FK).
-- ---------------------------------------------------------------------------
alter table public.user_roles
  add column if not exists member_name text;

comment on column public.user_roles.member_name is
  'Denormalizado de users.name (c2, ADR-026). Mantenido por trigger force (INSERT del rol) + propagación '
  '(UPDATE de users.name). Hace que los nombres de coworkers (y el propio) viajen offline DENTRO de los streams '
  'de user_roles ya existentes (self_user_roles / est_members_roles), sin sincronizar la tabla global users. '
  'NO es PII sensible (email/phone viven en user_private self-only, ADR-025).';

-- ---------------------------------------------------------------------------
-- (1) Backfill desde users.name. Idempotente.
-- ---------------------------------------------------------------------------
update public.user_roles ur
   set member_name = u.name
  from public.users u
 where u.id = ur.user_id;

-- ---------------------------------------------------------------------------
-- (2) FORCE en el INSERT del rol: copia member_name desde users.name (anti-spoof).
-- ---------------------------------------------------------------------------
create or replace function public.tg_force_member_name_on_user_role ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  select name into v_name from public.users where id = new.user_id;
  -- users.name es NOT NULL (0001); si el user no existe, la FK user_roles.user_id ya fallaría. Defensivo igual.
  new.member_name := v_name;   -- FUERZA desde users: ignora el payload (anti-spoof)
  return new;
end;
$$;

comment on function public.tg_force_member_name_on_user_role is
  'Trigger BEFORE INSERT OR UPDATE OF member_name en user_roles: FUERZA member_name = users.name del '
  'NEW.user_id (ignora el payload — anti-spoof; también en UPDATE para que un caller no pueda pisar el nombre '
  'denormalizado con un valor falso). Denormalización (c2, ADR-026) para nombres de coworkers offline vía los '
  'streams de user_roles.';

drop trigger if exists user_roles_force_member_name on public.user_roles;
create trigger user_roles_force_member_name
  before insert or update of member_name on public.user_roles
  for each row execute function public.tg_force_member_name_on_user_role();

-- ---------------------------------------------------------------------------
-- (3) PROPAGACIÓN: al cambiar users.name, propagar a todas las filas user_roles del user.
-- ---------------------------------------------------------------------------
create or replace function public.tg_propagate_user_name_to_roles ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_roles
     set member_name = new.name
   where user_id = new.id
     and member_name is distinct from new.name;
  return new;
end;
$$;

comment on function public.tg_propagate_user_name_to_roles is
  'Trigger AFTER UPDATE OF name en users: propaga el nuevo nombre a TODAS las filas user_roles del user. El guard '
  'is-distinct-from evita UPDATEs no-op. No-loop: el UPDATE a user_roles toca solo member_name (no active -> no '
  're-dispara el guard de 0076; no user_id -> no re-dispara el force). Denormalización (c2, ADR-026).';

drop trigger if exists users_propagate_name_to_roles on public.users;
create trigger users_propagate_name_to_roles
  after update of name on public.users
  for each row execute function public.tg_propagate_user_name_to_roles();

notify pgrst, 'reload schema';

commit;
