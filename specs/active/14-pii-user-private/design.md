# Design — Spec 14: Separación de PII de contacto (`user_private`)

> **SCHEMA/RLS-SENSITIVE → Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana (nueva tabla con PII, RLS self-only, migración de datos personales, cambio de trigger `security definer`, re-ruteo de lectores con admin-client). Ver `docs/specs.md` §Gate 1 y ADR-019.
>
> Patrón decidido por council (opción D, ver `context.md`). Este design lo implementa; no lo re-discute. La alternativa descartada (view / RPC / column-GRANTs) se documenta al final con su porqué.

## 0. Resumen de la decisión

`public.users` mezcla hoy un **perfil público** (`id, name`, visible a coworkers por la policy `users_select_coworkers`) con **PII de contacto** (`email, phone`, que debería ser self-only). Como la RLS de Postgres es row-level, la policy de coworkers expone la fila COMPLETA y el cliente "cumple" pidiendo solo `id, name` — control bypasseable vía PostgREST directo (B3-1, HIGH).

Solución: separar FÍSICAMENTE `email` + `phone` a `public.user_private (user_id PK)` con RLS trivial self-only (`user_id = auth.uid()`). `public.users` queda como perfil público. La separación física es la única que cierra la PII en TODOS los canales (PostgREST + realtime + PowerSync por el WAL), no solo en la capa PostgREST.

## 1. Archivos a crear / modificar

### 1.1 Migration SQL (crear) — número **TBD-al-implementar**

> **Dependencia de numeración (context.md §Pendientes)**: la última migration en disco es `0066_age_categories_cron.sql`. Spec 02 Tier 2 reclamó `0059+` (ya consumido por el árbol de categorías 0059–0066) y **spec 13** también pide migrations nuevas con número TBD. El implementer reconcilia el número libre al aplicar (probablemente `0067+`, pero NO se hardcodea acá para no colisionar con specs 13 / 02 Tier 2 que se apliquen en paralelo). Nombre lógico sugerido: `XXXX_user_private_pii.sql`.

Una sola migration, ejecutada en orden atómico (todo o nada):

1. `create table public.user_private (...)` + RLS enable + unique index de email.
2. Backfill: `insert into user_private (user_id, email, phone) select id, email, phone from public.users` (incluye soft-deleted; ver R4.2).
3. Policies self-only (`user_private_select_self`, `user_private_update_self`).
4. GRANTs mínimos (`select, update` a `authenticated`; `all` a `service_role`; nada a `anon`).
5. `drop index public.users_email_active` y `alter table public.users drop column email, drop column phone`.
6. Reescritura de `public.handle_new_auth_user()` para poblar ambas tablas.
7. `notify pgrst, 'reload schema'`.

El **orden importa**: backfill ANTES del drop de columnas (R4.1). El trigger se reescribe en la MISMA migration que dropea las columnas, para que no haya ventana donde el trigger viejo inserte en `users(email)` ya inexistente.

### 1.2 Edge Functions (modificar)

- `supabase/functions/invite_user/index.ts` — el precheck de "ya es miembro activo" (líneas 77–93) hoy hace:
  ```ts
  .from('user_roles')
  .select('id, users:users!inner(email)')
  .eq('establishment_id', establishmentId)
  .eq('active', true)
  .eq('users.email', email)
  ```
  El embed `users!inner(email)` ya no resuelve (la columna se fue). Se re-rutea a `user_private` vía admin-client. Dos formas válidas (el implementer elige la más limpia con el shape real de FKs):
  - (a) embed por la relación `user_roles → users → user_private` si PostgREST resuelve el doble hop: `.select('id, users:users!inner(user_private!inner(email))').eq('users.user_private.email', email)`.
  - (b) dos pasos: `select user_id from user_private where email = $1` (admin-client, RLS bypass) → luego `select 1 from user_roles where establishment_id = $est and active and user_id = $foundId`. Más explícito, sin depender del doble embed.
  Recomendación: **(b)** por robustez (no depende de cómo PostgREST resuelva el doble `!inner`). El resultado funcional (códigos `already_member` / sin match) es idéntico (R8.1, R8.3).

- `supabase/functions/accept_invitation/index.ts` — el lookup del owner para notificar (líneas 121–137):
  ```ts
  .from('users').select('id, name, email').eq('id', inv.invited_by).single()
  ```
  Se separa en dos lecturas admin-client: `name` de `public.users` (donde sigue) y `email` de `public.user_private` (`.eq('user_id', inv.invited_by)`). El `name` del `newMember` (líneas 131–135) NO cambia (sigue en `users`). El email del owner alimenta `sendInvitationAcceptedEmail({ to: ownerEmail, ... })` igual que hoy (R8.2). `user.email` (el del que acepta) sale del JWT (`_shared/auth.ts`), **no se toca** — ya viene del token, no de `public.users`.

> Nota: `_shared/auth.ts` lee `data.user.email` del JWT, no de `public.users`. **No requiere cambios.** El email de `auth.users` sigue siendo la fuente del JWT.

### 1.3 Frontend (modificar)

Servicios afectados (la regla de capas de `architecture.md`: solo `services` tocan I/O):

- `app/src/services/profile.ts` — `loadProfileNamePhone` hoy lee `name, phone` de `users`. Se separa: `name` sigue de `users`; `phone` pasa a `user_private` (self, RLS lo acota). Mantiene el shape de retorno `{ name, phone }` (sin cambio de contrato hacia ProfileContext). (R6.1, R6.3)
- `app/src/services/establishments.ts`:
  - `loadOwnProfile` (`select('phone')` de `users`) → `user_private`. (R6.4)
  - `saveOwnPhone` (`update({ phone })` sobre `users`) → `user_private`. (R6.4)
  - `loadFullProfile` (`select('name, email, phone')` de `users`) → `name` de `users`, `email`+`phone` de `user_private`. (R6.1) Mantiene el shape `{ name, email, phone }`.
  - `saveProfile` (`update({ name, phone })` sobre `users`) → `name` a `users`, `phone` a `user_private`. (R6.2)
- `app/src/services/account.ts` — `changeEmail` usa `supabase.auth.updateUser({ email })` (toca `auth.users`, nativo de doble confirmación). Para reflejar el email confirmado en `user_private` (R7.1) **sin** abrir un endpoint de escritura de email self-service riesgoso, ver §3 (estrategia de sincronía del email).
- `app/src/contexts/ProfileContext.tsx` — NO cambia su lógica: ya deriva `email` del session y `name/phone` del service. Solo cambia de dónde el service saca `phone` (transparente al contexto). (R6.3, R6.5)
- `app/src/services/members.ts` — **NO cambia**. `loadMembers` ya pide solo `user:users ( id, name )` (hallazgo RLS #2 ya internalizado). Tras el move, ni siquiera podría pedir email/phone de coworkers. Se verifica con test, no se edita. (R3.3)

### 1.4 Tests (crear) — `supabase/tests/rls/` y `supabase/tests/edge/`

Runners Node-nativos existentes (ADR-012, no pgTAP). Ver §6.

### 1.5 Documentación del patrón (crear/modificar)

- `docs/conventions.md` (nota corta) **y/o** un ADR nuevo. Ver §7 (recomendación: ADR-025).

## 2. Schema SQL

```sql
-- Tabla de PII de contacto, self-only. 1:1 con public.users.
create table public.user_private (
  user_id  uuid primary key references public.users (id) on delete cascade,
  email    text not null,
  phone    text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_private is
  'PII de contacto (email, phone) self-only. Separada de public.users (perfil '
  'público) para que la RLS row-level no exponga contacto de coworkers, y para '
  'cerrar la PII también en el canal WAL (realtime/PowerSync). Ver spec 14 / ADR-025.';

-- Unicidad de email para usuarios vivos (réplica de users_email_active, que se dropea).
-- El join al perfil para el predicado deleted_at se hace contra public.users.
create unique index user_private_email_active
  on public.user_private (email)
  where user_id in (select id from public.users where deleted_at is null);
-- NOTA-IMPLEMENTER: un índice parcial NO admite subquery en el predicado WHERE.
-- Resolver con UNA de estas dos vías (decisión de implementer, equivalentes):
--   (a) índice único total sobre (email)  — más estricto: un email no se reusa ni
--       tras soft-delete del dueño. Es más simple y, para PII de contacto 1:1 con
--       auth.users (que ya garantiza unicidad de email), es aceptable.
--   (b) columna espejo `deleted_at` en user_private mantenida por trigger/cascade,
--       y `unique index ... where deleted_at is null`. Más fiel a users_email_active
--       pero agrega una columna a sincronizar.
-- Recomendación: (a) — auth.users ya impone unicidad global de email; el índice parcial
-- por soft-delete de users_email_active era para permitir re-alta del mismo email tras
-- baja, caso de borde no requerido por ninguna feature actual. Si Gate 1 / Raf quieren
-- preservar exactamente la semántica de re-alta, ir por (b).

alter table public.user_private enable row level security;

create policy user_private_select_self on public.user_private
  for select to authenticated
  using (user_id = auth.uid());

create policy user_private_update_self on public.user_private
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- updated_at automático (reusar el patrón de 0016_generic_updated_at o tg_users_set_updated_at).
create trigger user_private_set_updated_at
  before update on public.user_private
  for each row execute function public.tg_users_set_updated_at();

-- Backfill ANTES de dropear columnas de users (R4.1).
insert into public.user_private (user_id, email, phone)
  select id, email, phone from public.users;
-- email es not-null en users hoy → no hay filas que violen el not-null de user_private.
-- Si alguna lo violara, el insert falla y la migración aborta atómicamente (R4.3).

-- Recién ahora se quitan de users.
drop index if exists public.users_email_active;
alter table public.users drop column email, drop column phone;

-- GRANTs mínimos (R9).
grant select, update on public.user_private to authenticated;
grant all on public.user_private to service_role;
-- nada a anon (R9.3).

notify pgrst, 'reload schema';
```

### Trigger `handle_new_auth_user` reescrito (R5)

```sql
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
```

- Ambos insert en el cuerpo del trigger → **misma transacción del INSERT en `auth.users`** (atomicidad, R5.2). Si el segundo insert falla, todo el alta de auth revierte.
- `on conflict do nothing` en ambos preserva la idempotencia que ya tenía el trigger (re-disparo / reintento de signup).
- `security definer` + `search_path = public` se mantienen (necesarios para insertar saltando RLS desde el contexto de `auth`).

## 3. Estrategia de sincronía del email (R7) — decisión a confirmar en Gate 1

El cambio de email es **nativo de Supabase Auth** (`auth.updateUser({ email })`, doble confirmación). Hoy `public.users.email` quedaba **stale** tras un cambio de email (el trigger solo escribe en signup; nadie re-sincroniza). Es decir: el bug de desincronización YA existe en `users.email`; esta spec es la oportunidad de cerrarlo, pero el alcance del cierre se acota en Gate 1.

Tres opciones para reflejar el email confirmado en `user_private` (R7.1):

- **(A) Trigger en `auth.users` `AFTER UPDATE OF email`** que hace `update public.user_private set email = new.email where user_id = new.id` cuando `new.email_confirmed_at` cambia / el email se confirma. Es la más robusta: la confirmación nativa dispara la sincronía, sin código de app, y respeta R7.2 (no escribe hasta confirmar). **Recomendada.** Requiere que el trigger discrimine "email confirmado" vs "cambio pendiente" (Supabase mueve `email` a `new_email` mientras está pendiente; al confirmar, `email` pasa a ser el nuevo y `email_change` se limpia — el implementer valida el shape exacto de `auth.users` en la versión de Supabase del proyecto).
- (B) Que el frontend, tras `changeEmail`, escriba `user_private.email` vía el endpoint self (RLS self-only permite `update`). Rechazada: el email NO está confirmado en el momento del `changeEmail` (R7.2 lo prohíbe), y abrir `email` a escritura self-service desde el cliente reintroduce el riesgo de divergencia con `auth.users` (dos fuentes). Además `email` es la PII más sensible: mejor que solo el canal de confirmación nativo la mueva.
- (C) No sincronizar y leer el email canónico de `auth.users` para todo: rechazada para el storage CONSULTABLE — los prechecks de EF necesitan consultar email por `establishment` (no por `user_id`), y `auth.users` no es consultable desde PostgREST. `user_private.email` debe existir y mantenerse fresco.

**Decisión propuesta (a validar en Gate 1):** opción **(A)** — trigger `auth.users AFTER UPDATE` que propaga el email confirmado a `user_private`. `user_private.email` es la copia consultable; `auth.users.email` es la fuente de verdad del email canónico. El `update` del trigger corre como `security definer`.

> Pendiente del context.md resuelto: "¿`email` queda también en `auth.users` como fuente de verdad y `user_private` como copia consultable, o `user_private` es la única?" → **`auth.users` es la fuente de verdad; `user_private` es la copia consultable mantenida por trigger.**

## 4. Multi-tenancy / RLS (obligatorio por CLAUDE.md ppio 6)

- `user_private` es **self-only puro** (`user_id = auth.uid()`), NO tiene `establishment_id`: la PII de contacto es de la persona, no del campo. Esto es MÁS restrictivo que multi-tenant; correcto.
- El predicado de tenancy de coworkers (`users_select_coworkers`) **no se toca** — sigue dejando ver filas de coworkers en `public.users`, pero esas filas ya no contienen PII de contacto (R3.2, R3.3). El leak se cierra por SUSTRACCIÓN de columnas, no por cambiar el predicado.
- Las lecturas legítimas cross-user del email (prechecks de invitación) van por **admin-client** (service-role, bypassa RLS), correctamente scopeadas (`invite_user` ya valida `requireOwnerOf` antes; el lookup de `accept_invitation` es por `inv.invited_by`, derivado del token). No se abre ninguna lectura cross-user de PII al rol `authenticated`.

## 5. Offline-first / PowerSync (obligatorio: §contexto WAL)

- PowerSync **NO está wired** hoy (auditoría baseline, dominio C diferido). Por eso esta migración es BARATA ahora (migración de columnas simple) y CARA después (doble-escritura + sync sets versionados con sync en vivo). El timing —hacerlo antes del wire— es parte de la decisión (context.md).
- La razón decisiva de la opción D es justamente el canal de sync: cuando PowerSync se conecte, sincronizará la **tabla base** por el WAL (replicación lógica por fila), que NO respeta views ni column-GRANTs. Con `user_private` separada, las sync rules de PowerSync simplemente **no incluyen `user_private` en ningún bucket compartido** (o la incluyen solo en un bucket self del propio usuario). El perfil público (`users`) puede sincronizarse a coworkers sin filtrar PII.
- Esta spec **no** define sync rules (PowerSync no está wired). Solo deja el schema en la forma correcta para que, al wirearlo, `user_private` quede fuera de cualquier bucket multi-miembro. Es un habilitador, no una implementación de sync.

## 6. Tests (trazabilidad)

Runners Node-nativos contra la DB remota (patrón `supabase/tests/rls/run.cjs` y `edge/run.cjs`, ADR-012). Mínimo:

- **T-NOBYPASS (clave, B3-1)** — RLS: crear user A y user B coworkers (comparten establishment activo). Con el JWT de A, pegar a PostgREST directo `GET /rest/v1/user_private?select=email,phone&user_id=eq.<B>` y `GET /rest/v1/user_private?select=*` → **cero filas** de B (y la propia de A si filtra por B). También: `GET /rest/v1/users?select=email,phone` → error / columnas inexistentes (las columnas se fueron). Cubre R2.2, R3.1, R3.2.
- **T-SELF-READ** — con el JWT de A, `select` de su `user_private` → ve su email y phone. Cubre R2.1, R6.1.
- **T-SELF-UPDATE** — con el JWT de A, `update user_private set phone` de su fila → OK; intentar `update` de la fila de B → cero filas afectadas. Cubre R2.3, R2.4, R6.2.
- **T-SIGNUP-TRIGGER** — crear user en `auth.users` (admin) → existe fila en `users` (id,name) Y en `user_private` (user_id,email) en la misma transacción. Cubre R5.1, R5.3.
- **T-INVITE-PRECHECK (edge)** — owner invita con `email` de un miembro ya activo → respuesta `already_member` (el precheck resuelve email vía `user_private`). Email de no-miembro → crea invitación OK. Cubre R8.1, R8.3.
- **T-ACCEPT-NOTIFY (edge)** — aceptar invitación → el lookup del email del owner (para la notificación) resuelve contra `user_private` sin error; el flujo retorna OK (email best-effort). Cubre R8.2, R8.3.
- **T-BACKFILL** — fixture con users pre-migración (email/phone) → tras migrar, cada uno tiene su fila `user_private` con el mismo email/phone; conteo `users` == conteo `user_private` para los que tenían email. Cubre R4.1, R4.2. (Se valida sobre el estado migrado; el backfill de datos productivos lo corre la propia migration.)
- **T-EMAIL-SYNC** (si se implementa opción 3A) — confirmar un cambio de email → `user_private.email` refleja el nuevo. Cubre R7.1, R7.2.

El implementer documenta el mapa `R<n> → archivo:test` en `progress/impl_14-pii-user-private.md` (regla de trazabilidad de `docs/specs.md`).

## 7. ADR — ¿amerita?

**Sí, recomendado.** Aplica la regla de los 6 meses de `CLAUDE.md` ("¿se va a referenciar en 6 meses? Sí → ADR"): el patrón "PII sensible → tabla `*_private` self-only, separada del perfil público" es una **decisión de patrón canónico que se replicará** en toda PII multi-miembro futura (perfil del vet cross-campo, datos de contacto de terceros, etc.), y la justificación NO es obvia (el WAL/PowerSync es la razón decisiva y se va a olvidar). Sin ADR, el próximo que agregue PII volverá a meterla en la tabla pública.

**Propuesta: `ADR-025-pii-sensible-tabla-private.md`** (el último es ADR-024). Contenido mínimo:
- **Decisión**: PII de contacto/sensible va a `<entidad>_private (<entidad>_id PK)` con RLS self-only (o scope mínimo), separada del perfil/registro público.
- **Por qué (lo no-obvio)**: RLS, views, RPCs y column-GRANTs viven en PostgREST; realtime y PowerSync sincronizan la tabla base por el WAL → solo la separación FÍSICA cierra la PII en TODOS los canales. RAFAQ va a PowerSync (ADR-002).
- **Consecuencia**: `ALTER TABLE ADD COLUMN pii` sobre una tabla pública es un anti-patrón; la PII nueva va a la tabla `*_private`.
- **Referencias**: spec 14, finding B3-1 (`progress/security_baseline_shipped.md`), ADR-002 (PowerSync), ADR-004 (multi-tenancy).

El ADR lo crea el implementer junto con la migración (o el leader antes de Puerta 1). Como mínimo, R10.1 exige la nota en `docs/conventions.md` aunque el ADR se difiera.

## 8. Alternativa descartada (obligatorio por `docs/specs.md`)

**View `users_public(id, name)` + revocar `select` directo de `users` a coworkers (dejando solo la policy self-only sobre la base) — DESCARTADA.**

Era la opción que la propia migration `0006` anticipaba ("vía view en una migration futura T5.1") y la que el disidente del council ("El Ejecutor") votó por velocidad. Se descarta porque:

1. **No cierra el canal WAL.** Una view (o un RPC `get_coworkers`, o column-GRANTs `grant select (id,name)`) filtra la PII en la capa **PostgREST**, pero realtime y PowerSync replican la **tabla base** por el WAL, que ignora views, RPCs y column-GRANTs. Apenas se prenda PowerSync (specs 02/09), la PII de `users.email/phone` sangraría por el bucket de sync de coworkers. La separación física es la única que cubre PostgREST + realtime + PowerSync.
2. **No es el patrón canónico.** Con view, cada nueva columna de PII en `users` requiere acordarse de excluirla de la view Y de las sync rules (dos lugares, fácil de olvidar). Con `user_private`, `ALTER TABLE users ADD COLUMN x` jamás re-expone PII (la PII vive en otra tabla con política trivial).
3. **Mantener `email` consultable.** Los prechecks de invitación consultan email por `establishment` (no por `user_id`). Una view de perfil público (id, name) no expone email; igual habría que mantener el email consultable en algún lado para el admin-client → terminás necesitando `user_private` de todos modos.

Veredicto del council: unánime por D; el voto disidente fue refutado por los 5 revisores exactamente por el punto (1).
