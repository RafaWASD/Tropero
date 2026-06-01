# Design — T6.3 Eliminar cuenta (`delete_account` Edge Function)

> Detalle de contrato para la tarea **T6.3** / requisitos **R2.4, R2.5, R2.5.1**.
> Complementa `design.md` (no lo reemplaza). Target de **Gate 1** (security spec).
> Sesión 22. Autor: leader. Decisión de scope de Raf: "Fase 6 completa".
> **Rev. 2** — incorpora los findings de Gate 1 (HIGH-1, HIGH-2, MEDIUM-1).

## Contexto / por qué edge function (no client directo)

Eliminar la cuenta cruza **tres superficies** que el cliente no puede tocar de forma
segura por RLS: `public.users` (soft-delete propio), **todos** los `user_roles` del
usuario (desactivar), y `auth.users` (impedir re-login). Requiere `service_role` →
edge function. Mismo patrón que el resto de funciones de spec 01
(`remove_member`/`change_member_role`): `requireUser` (identidad del JWT) +
`adminClient` para los writes.

El schema **ya soporta** el soft-delete por columnas:
- `public.users.deleted_at timestamptz` (migration `0001`); la RLS `users_select_self`
  / `users_select_coworkers` (`0006`) ya filtra `deleted_at is null` → un usuario
  soft-deleteado desaparece de todas las lecturas, **y sus `user_roles` inactivos
  hacen que RLS le niegue todo acceso a datos de cualquier tenant** (las policies de
  spec 01/02/03 derivan de `has_role_in`/`is_owner_of`, que exigen rol activo).
- `public.user_roles.active boolean` + `deactivated_at timestamptz` (migration `0003`);
  `remove_member` ya usa exactamente este patrón de desactivación.

**Sí hay UNA migración nueva** (Gate 1 MEDIUM-1): una RPC `SECURITY DEFINER` que hace
los dos writes de DB (`users` + `user_roles`) en **una transacción atómica**, con
re-validación del bloqueo de único-owner adentro (red de seguridad contra TOCTOU).
Precedente directo: migration `0041` (RPCs de soft-delete de spec 02). Va en
`0058_delete_account_rpc.sql` (verificar que `0058` siga libre al escribir — la
terminal paralela de spec 04/BLE está bloqueada en ADR-024 y no debería crear
migraciones, pero confirmar).

## RPC `public.delete_account_tx(p_user_id uuid)` — migración 0058

```sql
create or replace function public.delete_account_tx (p_user_id uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare v_blocking int;
begin
  -- Red de seguridad TOCTOU (defensa en profundidad; el edge ya pre-chequeó con lista).
  -- ¿Queda algún establecimiento ACTIVO donde p_user_id es el ÚNICO owner activo?
  select count(*) into v_blocking
  from public.establishments e
  join public.user_roles ur
    on ur.establishment_id = e.id and ur.role = 'owner' and ur.active = true
  where e.deleted_at is null
    and ur.user_id = p_user_id
    and (
      select count(*) from public.user_roles ur2
      where ur2.establishment_id = e.id and ur2.role = 'owner' and ur2.active = true
    ) <= 1;
  if v_blocking > 0 then
    raise exception 'sole owner of % active establishment(s)', v_blocking
      using errcode = '23514';  -- check_violation → el edge lo mapea a 409 sole_owner
  end if;

  update public.users set deleted_at = now()
    where id = p_user_id and deleted_at is null;
  update public.user_roles set active = false, deactivated_at = now()
    where user_id = p_user_id and active = true;
end; $$;

-- CRÍTICO (Gate 1 NUEVO-HIGH-1, lección SEC-HIGH-01): es SECURITY DEFINER y toma
-- p_user_id → si fuera EXECUTE-able por authenticated/anon, CUALQUIERA podría
-- POST /rest/v1/rpc/delete_account_tx {p_user_id:<otro>} y borrar a cualquier usuario
-- (IDOR catastrófico). `revoke from public` NO alcanza si Supabase tiene un
-- ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO authenticated. Revocar de los
-- TRES roles explícitamente (patrón verificado: 0042 / 0055). Solo service_role la
-- ejecuta (el edge la llama con adminClient).
revoke all on function public.delete_account_tx (uuid) from public, authenticated, anon;
grant execute on function public.delete_account_tx (uuid) to service_role;

-- Smoke-check fail-closed (estilo 0055_check_grants.sql): si la RPC quedara
-- EXECUTE-able por authenticated/anon/public, la migración FALLA.
do $$
declare v_bad record;
begin
  for v_bad in
    select r.rolname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (select unnest(array['authenticated','anon','public']) as rolname) r
    where n.nspname = 'public'
      and p.proname = 'delete_account_tx'
      and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  loop
    raise exception 'grant check FAILED: delete_account_tx is EXECUTE-able by %', v_bad.rolname;
  end loop;
  raise notice 'grant check OK: delete_account_tx revoked from public/authenticated/anon';
end$$;

notify pgrst, 'reload schema';
```

Las dos `update` corren en la transacción implícita de la función → **atómicas entre
sí** (cierra MEDIUM-1: nunca queda "perfil borrado con roles activos"). El `count`
incluye al propio usuario (su rol sigue activo al entrar) → umbral `<= 1` = "solo yo".

## Contrato del edge function

**Endpoint**: `POST /functions/v1/delete_account`
**Auth**: Bearer JWT del usuario (igual que las demás). **NO recibe `user_id`** — la
identidad sale **solo** del JWT (`requireUser`). Cierra IDOR: imposible pedir la baja
de otra cuenta. (D5 — confirmado PASS por Gate 1.)

**Request body**: `{}` (ninguno; se ignora cualquier campo).

**Responses**:

| Caso | HTTP | Body |
|---|---|---|
| Baja OK | 200 | `{ "ok": true }` |
| Ya estaba dada de baja (idempotente) | 200 | `{ "ok": true, "already_deleted": true }` |
| Único owner de ≥1 campo activo (R2.5) | 409 | `{ "error": { "code": "sole_owner", "message": "...", "establishments": [{ "id": "...", "name": "..." }] } }` |
| Sin sesión | 401 | `{ "error": { "code": "unauthorized", ... } }` |
| Método ≠ POST | 405 | `{ "error": { "code": "method_not_allowed", ... } }` |
| Error de DB / inesperado | 500 | `{ "error": { "code": "db_error" \| "unexpected", ... } }` |

El `establishments` del `sole_owner` usa el parámetro `extra` de `jsonError(...)` (ya
existe). Alimenta **R2.5.1**: el frontend lista los campos bloqueantes con atajo para
soft-deletear cada uno.

## Lógica (orden — Gate 1 HIGH-1/HIGH-2)

1. `requireUser(userClient)` → `{ id }`. (No exigimos email verificado — un usuario
   puede querer borrarse aunque no haya verificado.)
2. **Idempotencia**: leer `users.deleted_at` (admin). Si ya está seteado →
   `jsonOk({ ok: true, already_deleted: true })` y salir.
3. **Pre-check de campos bloqueantes (R2.5 + R2.5.1)** — para devolver la lista amigable:
   - Traer `user_roles` del usuario con `role='owner'` AND `active=true`, **join** a
     `establishments` con `deleted_at IS NULL` (campo ya borrado NO bloquea — D4),
     seleccionando `establishment_id` + `name`.
   - Para cada uno, contar owners activos (`role='owner'`, `active=true`); si `<= 1`
     (solo este usuario) → bloqueante. Acumular `{ id, name }`.
   - **FAIL-CLOSED (HIGH-2)**: si CUALQUIER query de este paso (traer roles o contar
     owners) retorna error → `jsonError(500, 'db_error', ...)` **sin escribir nada**.
     Ante incertidumbre sobre el conteo de owners, NO se permite la baja. (Mismo patrón
     que `remove_member` 67-82.) El conteo **incluye al usuario actual** (rol aún
     activo) → umbral `<= 1`.
   - Si hay bloqueantes → `jsonError(409, 'sole_owner', <copy>, { establishments })`.
     **No se escribe nada.**
4. **Baja atómica**: llamar la RPC `delete_account_tx(user.id)` vía `adminClient.rpc(...)`.
   - La RPC re-valida el bloqueo adentro de la transacción (red TOCTOU) y hace los dos
     updates atómicos.
   - Si la RPC lanza el `23514` (sole_owner por race) → mapear a `jsonError(409,
     'sole_owner', <copy genérico>, { establishments: [] })` (la lista detallada ya la
     dio el pre-check; el race es rarísimo en MVP — no hay invitación a owner, R5.1).
   - Cualquier otro error de la RPC → `jsonError(500, 'db_error', ...)`. Como es
     atómica, un error deja la DB **intacta** (nada parcial).
5. **Revocación de auth (Gate 1 HIGH-1)** — tras el OK de la RPC:
   - `adminClient.auth.admin.signOut(<access_token>, 'global')` → revoca **todos los
     refresh tokens** del usuario server-side (mata las sesiones vigentes, no solo el
     login futuro). **OJO (corregido en implementación)**: la Auth Admin API
     `signOut(jwt, scope)` espera el **ACCESS TOKEN** (el Bearer del request), NO el
     `user.id` (un UUID sería no-op). El edge extrae el token del header `Authorization`.
   - `adminClient.auth.admin.updateUserById(user.id, { ban_duration: '876000h' })` →
     impide re-login (no hard-delete: preserva la fila para retención SENASA).
   - **Manejo de error (HIGH-1.c)**: si el signOut/ban fallan, **loguear server-side**
     y aun así devolver `jsonOk({ ok: true })`. Justificación: la baja de datos ya se
     consumó atómicamente en el paso 4, y **al estar los roles inactivos, RLS ya niega
     TODO acceso a datos de cualquier tenant** (el JWT vigente solo puede ver un
     cascarón vacío: sin perfil —RLS filtra `deleted_at`— y sin campos). El ban/signOut
     son hardening del cascarón, no la barrera de datos. La falla es recuperable
     re-corriendo la función (idempotente). Se loguea para alertar.
6. `jsonOk({ ok: true })`.

**Cliente** (post-OK): `supabase.auth.signOut()` local + navegar al AuthStack con
confirmación "tu cuenta fue eliminada".

> **Por qué la RPC va ANTES del ban (vs la preferencia literal de Gate 1 de "banear
> primero")**: con la RPC atómica del paso 4, **no existe** el estado "perfil borrado
> con roles activos" que motivaba el "auth primero" — los roles se desactivan en la
> MISMA transacción que el soft-delete, así que en el instante del commit RLS ya corta
> todo acceso a datos. El access-token residual (~1h, stateless) solo puede renderizar
> un cascarón sin datos; el `signOut(global)` mata el refresh token y el cliente hace
> `signOut` local. RPC-primero es además **reentrante**: si el ban falla, el usuario
> conserva sesión para reintentar. Se documenta para re-validar en Gate 2.
>
> **Hallazgo empírico (post-deploy, edge test 6)**: la "ventana residual de ~1h" del
> access-token es en realidad MÁS chica de lo asumido para operaciones que validan
> sesión: `signOut(<token>, 'global')` revoca la sesión server-side, así que un
> `requireUser`→`getUser()` posterior con el mismo token YA falla (401 `unauthorized`)
> — no espera a la expiración del JWT. O sea: tras la baja, el token queda inservible
> para re-operar de inmediato. El branch `already_deleted` queda como defensivo (solo
> alcanzable si el signOut falló — falla parcial).

## Decisiones de diseño (resueltas con Gate 1)

- **D1 — Ban + global signOut del auth user.** R2.4 solo pide soft-delete + desactivar
  roles, pero sin tocar auth quedaría sesión/refresh-token vigente → re-entrada a un
  estado roto. **Decisión**: `signOut(<access_token>, 'global')` (revoca refresh tokens; el JWT del request, no el user.id) +
  ban (`ban_duration`, no hard-delete → retención SENASA). El access-token ya emitido
  (~1h) es residual aceptable porque RLS ya niega datos (roles inactivos). Primer uso
  de `ban_duration`/`signOut` admin en el repo → re-validar mecanismo en Gate 2.
- **D2 — Atomicidad.** Los dos writes de DB son atómicos (RPC, transacción). Solo la
  revocación de auth (Auth Admin API) queda fuera de esa transacción, lo cual es
  inevitable y aceptable (ver paso 5: RLS ya protege los datos tras el commit del paso 4).
- **D3 — TOCTOU del único-owner.** Cerrado en dos capas: pre-check en el edge (lista
  amigable) + re-validación atómica dentro de la RPC (raise `23514`). En MVP no hay
  invitación a owner (R5.1) → el único race posible (irse el otro owner) solo
  endurece el bloqueo, no orfana. Gate 1 lo clasificó como operacional, no HIGH.
- **D4 — Campos ya soft-deleteados no bloquean.** El join exige `establishments.deleted_at
  IS NULL` (consistente con R2.5: "transfiera o **elimine** ese establecimiento").
- **D5 — Identidad solo del JWT.** Sin `user_id` en el body → sin IDOR. Gate 1 PASS.

## Tests (edge suite, `supabase/tests/edge/run.cjs`, corre en `check.mjs`)

Contra el remoto, usuarios/campos namespaced + cleanup (patrón de la suite existente):
1. **Baja simple**: usuario sin campos → 200; `users.deleted_at` set + roles activos = 0.
2. **Login posterior al ban FALLA (HIGH-1)**: tras la baja, intentar
   signIn/refresh con esas credenciales → rechazado. (Verifica ban + signOut global.)
3. **Único owner bloquea (R2.5)**: owner único de 1 campo activo → 409 `sole_owner` con
   `establishments:[{id,name}]`; verificar que **NO** se escribió (`deleted_at` null,
   roles intactos).
4. **Owner con 2do owner NO bloquea**: → 200; su rol inactivo, el campo conserva al otro
   owner.
5. **Campo soft-deleteado no bloquea (D4)**: owner único pero campo ya borrado → 200.
6. **Idempotencia**: segunda llamada → 200 `already_deleted: true`, sin efectos.
7. **IDOR / sin sesión**: sin Bearer → 401. (No hay vector de `user_id` ajeno por
   diseño; el body se ignora.)
8. **RPC no es invocable por authenticated (HIGH/IDOR)**: intentar `rpc('delete_account_tx', {p_user_id: <otro>})` con un JWT de usuario normal → permiso denegado (revoke de public/authenticated).

## Frontend (Gate 2, sin Gate 1 — no toca schema/RLS/edge nuevos más allá de la RPC ya gateada)

- `services/account.ts` (o extender `members.ts`): `deleteAccount()` que invoca el edge
  con el helper `invokeFn` (unwrap de `FunctionsHttpError.context.json()`, mismo patrón
  que `members.ts`); devuelve un Result tipado con el caso `sole_owner` + la lista.
- UI en "Más" (sección Perfil / zona de peligro): "Eliminar cuenta" → **doble
  confirmación** (R2.4) → llamada. En `sole_owner`, mostrar la **lista de campos
  bloqueantes** con atajo a soft-delete por campo (R2.5.1, reusar el flujo de eliminar
  campo de Run 1). En OK → `signOut` + pantalla "cuenta eliminada".
