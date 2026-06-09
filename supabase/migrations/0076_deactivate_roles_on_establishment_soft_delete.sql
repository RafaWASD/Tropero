-- 0076_deactivate_roles_on_establishment_soft_delete.sql  (feature 15-powersync, Run 4 — delta de backend)
--
-- Delta ADITIVO que cierra, a NIVEL DB, las DOS mitades del invariante de seguridad del sync JOIN-free de
-- PowerSync — "`user_roles.active = true` ⇒ el establecimiento está vivo (`deleted_at IS NULL`)":
--   (1) DEACTIVATE-ON-DELETE: un trigger que desactiva (`active = false`, `deactivated_at = now()`) los
--       `user_roles` de un establecimiento cuando éste se soft-deletea (transición `deleted_at` NULL →
--       NOT NULL), más un backfill que limpia los roles ya-activos que apuntan a campos ya-borrados. Cubre
--       los roles EXISTENTES al momento del borrado.
--   (2) BLOCK-ACTIVATE-FOR-DELETED: un guard trigger sobre `user_roles` que hace IMPOSIBLE crear/activar un
--       rol `active = true` apuntando a un campo ya soft-deleteado, venga del code-path que venga. Cierra el
--       hueco que (1) NO cubre: un rol NUEVO sobre un campo borrado (p. ej. `accept_invitation` —
--       supabase/functions/accept_invitation/index.ts:93-101 inserta `active: true` sin chequear
--       `establishments.deleted_at`; timeline: owner invita → owner borra el campo → el invitado acepta el
--       link pendiente → quedaría un rol activo sobre un campo borrado → el sync JOIN-free le replicaría la
--       data del campo borrado). El guard lo rechaza a nivel DB (defensa que no depende del app-layer).
--
-- POR QUÉ (modelo de sync JOIN-free de PowerSync): las sync streams de PowerSync scopean el set de datos
-- de un usuario por `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true`
-- SIN poder hacer JOIN a `establishments` (los JOINs revientan el bucket model de PowerSync, PSYNC_S2305).
-- Para que ese scoping JOIN-free no replique datos de campos borrados, `user_roles.active = true` tiene que
-- ser un proxy FIEL de "campo vivo". Hoy NO lo es: un usuario puede tener un `user_roles.active = true`
-- apuntando a un establecimiento soft-deleteado (no había trigger que lo desactivara; ver la nota de
-- `softDeleteEstablishment` en app/src/services/establishments.ts, que documentaba esta deuda como diferida).
-- Este trigger cierra esa brecha.
--
-- REDUNDANTE CON LA RLS, NO CAMBIA COMPORTAMIENTO OBSERVABLE: `has_role_in`/`is_owner_of` (0005) YA hacen
-- `JOIN establishments e ... AND e.deleted_at IS NULL`, así que YA devuelven false para un campo soft-deleteado
-- independientemente de `active`. Las queries de membership de la app (establishments.ts / rodeos.ts /
-- loadMemberships) también filtran `e.deleted_at IS NULL`. Por eso desactivar el rol al borrar el campo NO
-- cambia ningún resultado de autorización ni ninguna lectura de la app — sólo limpia `active` para que sea un
-- proxy fiel de "campo vivo" y habilita el modelo de sync JOIN-free de PowerSync. El cambio es aditivo y seguro.
--
-- LIMITACIÓN DELIBERADA — NO se reactiva en el caso inverso (NOT NULL → NULL, restore del campo): un
-- `user_roles.active = false` puede deberse a DOS causas distintas e indistinguibles a posteriori —
-- (1) el campo se soft-deleteó (este trigger), o (2) un owner removió a ese miembro del campo (flujo de
-- remoción de miembro). Reactivar a ciegas en un restore re-otorgaría acceso a miembros que habían sido
-- removidos a propósito → incorrecto. Hoy NO existe flujo de restore/undelete de establecimientos en el MVP
-- (el hard-delete y el restore están fuera de scope; el único `deleted_at = null` del código es el cleanup
-- de un test). Si en el futuro se agrega restore de campos, DEBERÁ manejar la reactivación de roles de forma
-- EXPLÍCITA (p. ej. registrando qué roles fueron desactivados por este trigger vs. por remoción de miembro),
-- no por reversión automática de este trigger.
--
-- NO aplicar al remoto desde acá: lo aplica el leader por Management API (envuelto en BEGIN/COMMIT) tras
-- gatear el SQL. NO `supabase db push`.

begin;

-- ---------------------------------------------------------------------------
-- (1) Función del trigger: al pasar `deleted_at` de NULL a NOT NULL, desactiva los user_roles activos
--     del establecimiento. `security definer` + `set search_path = public` (mismo estilo que los triggers
--     security-definer del repo, p. ej. handle_new_establishment en 0011).
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_roles_on_establishment_soft_delete ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sólo en la transición REAL a soft-deleted (NULL -> NOT NULL). La guarda evita re-disparar en updates
  -- de `deleted_at` que no son el borrado (p. ej. NOT NULL -> NOT NULL, o el restore NOT NULL -> NULL, que
  -- a propósito NO reactiva — ver nota de limitación arriba). El trigger es `OF deleted_at`, así que sólo
  -- corre cuando esa columna aparece en el SET del UPDATE.
  if old.deleted_at is null and new.deleted_at is not null then
    update public.user_roles
       set active = false,
           deactivated_at = now()
     where establishment_id = new.id
       and active = true;
  end if;
  return new;
end;
$$;

comment on function public.deactivate_roles_on_establishment_soft_delete is
  'AFTER UPDATE OF deleted_at en establishments: al soft-deletear un campo (NULL->NOT NULL), desactiva sus '
  'user_roles activos para que user_roles.active sea un proxy fiel de "campo vivo" en el sync JOIN-free de '
  'PowerSync. Aditivo/redundante con has_role_in (que ya filtra deleted_at). NO reactiva en el restore '
  '(NOT NULL->NULL): no se puede distinguir desactivado-por-borrado de desactivado-por-remoción-de-miembro.';

-- ---------------------------------------------------------------------------
-- (2) Trigger AFTER UPDATE OF deleted_at. AFTER (no BEFORE): la desactivación de roles es un efecto
--     posterior al soft-delete, no una validación del UPDATE. `OF deleted_at`: sólo dispara cuando ese
--     UPDATE toca `deleted_at`, no en cualquier UPDATE de la tabla (p. ej. el de updated_at).
--     `drop ... if exists` + `create` para idempotencia de la migración (mismo estilo que el repo).
-- ---------------------------------------------------------------------------
drop trigger if exists establishment_soft_delete_deactivates_roles on public.establishments;

create trigger establishment_soft_delete_deactivates_roles
  after update of deleted_at on public.establishments
  for each row
  execute function public.deactivate_roles_on_establishment_soft_delete();

-- ---------------------------------------------------------------------------
-- (3) Backfill: desactiva los roles que HOY están active = true pero apuntan a un establecimiento ya
--     soft-deleteado (el trigger sólo agarra borrados FUTUROS). Idempotente: sólo toca filas active = true
--     (re-ejecutar no cambia nada porque ya quedaron en false). Incluye los roles espurios de campos de
--     prueba ya borrados.
-- ---------------------------------------------------------------------------
update public.user_roles
   set active = false,
       deactivated_at = now()
 where active = true
   and establishment_id in (
     select id from public.establishments where deleted_at is not null
   );

-- ---------------------------------------------------------------------------
-- (4) Guard: la OTRA mitad del invariante. (1)+(backfill) desactivan los roles EXISTENTES al borrar el
--     campo, pero NO impiden CREAR/activar un rol NUEVO para un campo YA borrado (vector verificado:
--     accept_invitation inserta `active = true` sin chequear `establishments.deleted_at`; si el owner borra
--     el campo entre invitar y aceptar, quedaría un rol activo sobre un campo muerto → el sync JOIN-free le
--     replicaría la data del campo borrado). Este guard lo hace IMPOSIBLE a nivel DB, venga del code-path
--     que venga (EF/RPC/INSERT directo). `security definer` + `set search_path = public` (mismo estilo que
--     handle_new_establishment 0011 y este mismo archivo).
--
--     errcode = '23514' (check_violation): es una violación de INVARIANTE de dominio/estado, NO una negación
--     de privilegio del caller (42501) — el caller puede ser un owner/service-role haciendo un insert que
--     "se ve" legítimo; lo que se bloquea es el ESTADO ilegal (rol activo ⇒ campo vivo). Mismo errcode y
--     misma clase que el guard de estado de soft_delete_rodeo (0041: "rodeo has active animal_profiles …"
--     using errcode = '23514'). NO un 23xxx accidental: es el código de dominio elegido a propósito.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_active_role_on_soft_deleted_establishment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sólo nos importa el caso peligroso: un rol que QUEDA activo. Desactivar (`active = false`) SIEMPRE se
  -- permite (sale temprano) — el trigger de deactivate (1) hace `UPDATE active = false` y el backfill
  -- también, y NO deben romperse; remover un miembro (active=false) tampoco se bloquea.
  if new.active is distinct from true then
    return new;
  end if;

  -- `new.active = true`: insert de un rol activo, o update que pone/mantiene active=true. Si el campo
  -- destino está soft-deleteado → estado ilegal → rechazar. (Creación de campo: el campo recién insertado
  -- tiene deleted_at NULL → no matchea → permitido. Aceptar invitación a un campo VIVO → permitido. El fix
  -- del test R8.3/R8.4 reactiva DESPUÉS del restore [deleted_at = null primero] → campo vivo → permitido.)
  if exists (
    select 1 from public.establishments e
    where e.id = new.establishment_id
      and e.deleted_at is not null
  ) then
    raise exception
      'no se puede activar un rol (user_roles.active = true) en un establecimiento borrado (establishment_id=%): el campo está soft-deleteado',
      new.establishment_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.prevent_active_role_on_soft_deleted_establishment is
  'BEFORE INSERT OR UPDATE OF active en user_roles: bloquea (errcode 23514) que un rol quede active = true '
  'apuntando a un establishment soft-deleteado (deleted_at IS NOT NULL). active = false SIEMPRE se permite '
  '(no rompe el trigger de deactivate ni la remoción de miembros). Es la 2da mitad del invariante '
  '"user_roles.active = true ⇒ campo vivo" del sync JOIN-free de PowerSync: deactivate_roles_on_'
  'establishment_soft_delete cubre los roles EXISTENTES al borrar el campo; este guard impide CREAR/activar '
  'uno nuevo para un campo ya borrado (p. ej. aceptar una invitación pendiente tras el soft-delete).';

-- ---------------------------------------------------------------------------
-- (5) Trigger BEFORE INSERT OR UPDATE OF active. BEFORE (no AFTER): es una VALIDACIÓN que debe abortar el
--     INSERT/UPDATE antes de persistir el estado ilegal. `OF active` aplica SÓLO a la parte UPDATE (en
--     Postgres, `UPDATE OF col` filtra el UPDATE a cuando esa columna aparece en el SET; el INSERT dispara
--     SIEMPRE, sin filtrar por columna). Así: todo INSERT se valida; un UPDATE sólo se valida si toca
--     `active` (un update de `role`/`deactivated_at` solo no re-dispara). `drop … if exists` + `create`
--     para idempotencia (mismo estilo que el repo / este archivo).
-- ---------------------------------------------------------------------------
drop trigger if exists user_roles_block_active_on_soft_deleted_establishment on public.user_roles;

create trigger user_roles_block_active_on_soft_deleted_establishment
  before insert or update of active on public.user_roles
  for each row
  execute function public.prevent_active_role_on_soft_deleted_establishment();

commit;
