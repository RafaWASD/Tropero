# Spec 01 — Design

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25
**Última revisión**: 2026-05-25 — refinamiento de invitaciones a link shareable (`ADR-014`).

## Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│  React Native (Expo) + TypeScript                    │
│  ┌──────────────────────────────────────────────┐    │
│  │  AuthContext         (sesión Supabase)        │    │
│  │  EstablishmentContext (establecimiento activo)│    │
│  └──────────────────────────────────────────────┘    │
│                       ↓                              │
│         supabase-js + PowerSync client               │
└─────────────────────┬───────────────────────────────┘
                      │
                      ↓
┌─────────────────────────────────────────────────────┐
│  Supabase                                            │
│  ┌──────────────────────────────────────────────┐    │
│  │  auth.users (manejada por Supabase Auth)      │    │
│  │  public.users (perfil app, FK a auth.users.id)│    │
│  │  public.user_roles                            │    │
│  │  public.establishments                        │    │
│  │  public.invitations                           │    │
│  │  Postgres RLS policies                        │    │
│  │  Edge Functions: invite, accept_invite, etc   │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## Schema SQL

### Tabla `users` (perfil app)

Supabase Auth gestiona `auth.users` (email, password hash, verificación). Creamos `public.users` con FK a `auth.users.id` para datos de perfil de la app.

```sql
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null unique,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index users_email_active on public.users (email) where deleted_at is null;
```

**Trigger**: al crearse una fila en `auth.users` (signup), se inserta automáticamente en `public.users` vía trigger `on_auth_user_created` (patrón estándar de Supabase).

### Tabla `establishments`

```sql
create table public.establishments (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  province        text not null,
  city            text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  total_hectares  numeric(10,2),
  plan_type       text not null default 'beta',  -- preparado para billing, sin lógica activa
  plan_started_at timestamptz,
  plan_limits     jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index establishments_active on public.establishments (id) where deleted_at is null;
```

### Tabla `user_roles`

```sql
create type public.user_role as enum ('owner', 'field_operator', 'veterinarian');

create table public.user_roles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  role              public.user_role not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  deactivated_at    timestamptz
);

-- Unique constraint: solo un rol activo por par (user, establishment)
create unique index user_roles_active_unique
  on public.user_roles (user_id, establishment_id)
  where active = true;

create index user_roles_lookup on public.user_roles (user_id, active);
create index user_roles_establishment on public.user_roles (establishment_id, active);
```

### Tabla `invitations`

```sql
create type public.invitation_status as enum ('pending', 'accepted', 'cancelled', 'expired');

create table public.invitations (
  id                uuid primary key default gen_random_uuid(),
  establishment_id  uuid not null references public.establishments(id) on delete cascade,
  invited_by        uuid not null references public.users(id),
  email             text,                              -- nullable (modelo link shareable, ver ADR-014). Solo anotación para el owner.
  role              public.user_role not null,
  token             text not null unique,              -- UUID v4, 122 bits efectivos de entropía. Bearer token.
  status            public.invitation_status not null default 'pending',
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index invitations_token on public.invitations (token) where status = 'pending';
create index invitations_pending_by_email on public.invitations (email, status);
```

**Nota sobre migration histórica**: la tabla nace con `email NOT NULL` en `0004_invitations.sql`. La columna se vuelve nullable en migration posterior (`0012_invitations_email_nullable.sql`) cuando se adopta el modelo link shareable. El índice `invitations_pending_by_email` se mantiene útil para listar invitaciones pendientes anotadas con email.

## Row Level Security (RLS)

### Configuración del proyecto Supabase (defense-in-depth)

El proyecto se crea con esta configuración de seguridad:

- **Data API**: ON — necesario para `supabase-js`.
- **Automatically expose new tables**: **OFF** — cada tabla requiere `GRANT` explícito en su migration. Defensa pasiva: si una policy de RLS tiene un bug, la tabla igual permanece cerrada al Data API.
- **Enable automatic RLS**: ON — toda tabla nueva en `public` tiene RLS enabled de entrada. Imposible olvidarse del `alter table x enable row level security;`.

### Patrón de migrations (obligatorio para toda tabla nueva)

Cada migration que crea una tabla en `public` debe incluir, en este orden:

```sql
-- 1. Schema
create table public.<tabla> ( ... );

-- 2. Indices necesarios
create index ... ;

-- 3. RLS (redundante con la config global, pero explícito en el archivo)
alter table public.<tabla> enable row level security;

-- 4. Policies
create policy <tabla>_select on public.<tabla> for select using ( ... );
-- etc.

-- 5. GRANTS explícitos al Data API
grant select, insert, update, delete on public.<tabla> to authenticated;
-- (solo los verbos realmente necesarios; ej: si no se insertan filas vía cliente, omitir 'insert')
```

Sin paso 5, la tabla no es accesible vía `supabase-js` (queda dentro de Postgres pero invisible al cliente).

### Helper functions

```sql
-- ¿el usuario actual tiene rol activo en este establishment?
create or replace function public.has_role_in (est_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and establishment_id = est_id
      and active = true
  );
$$;

-- ¿el usuario actual es owner de este establishment?
create or replace function public.is_owner_of (est_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and establishment_id = est_id
      and role = 'owner'
      and active = true
  );
$$;
```

### Policies por tabla

**`public.users`**:
- SELECT: solo el propio user puede ver su perfil completo. Otros usuarios del mismo establishment pueden ver `id`, `name` (vista materializada o view aparte si hace falta).
- UPDATE: solo el propio user.
- DELETE: solo el propio user (soft-delete vía update de `deleted_at`).

```sql
alter table public.users enable row level security;

create policy users_select_self on public.users
  for select using (id = auth.uid() and deleted_at is null);

create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());
```

**`public.establishments`**:
- SELECT: usuarios con rol activo en ese establishment.
- INSERT: cualquier usuario autenticado y con email verificado.
- UPDATE: solo `owner`.
- DELETE (soft): solo `owner`.

```sql
alter table public.establishments enable row level security;

create policy establishments_select on public.establishments
  for select using (has_role_in(id) and deleted_at is null);

create policy establishments_insert on public.establishments
  for insert with check (auth.uid() is not null);

create policy establishments_update on public.establishments
  for update using (is_owner_of(id)) with check (is_owner_of(id));
```

**`public.user_roles`**:
- SELECT: el propio user puede ver sus roles, owners pueden ver todos los roles de su establishment.
- INSERT / UPDATE: solo owners del establishment, o el sistema vía Edge Function (al crear establishment, al aceptar invitación).

**`public.invitations`**:
- SELECT: owners del establishment. El lookup de un token por parte del destinatario no pasa por RLS — `accept_invitation` usa el admin client (modelo bearer, ver `ADR-014`).
- INSERT: solo owners.
- UPDATE: solo owners (cancelar) o el sistema (al aceptar / regenerar / marcar expirada).

(Las policies completas van en el archivo migration. Aquí muestro la lógica.)

## Flujo de signup

```
1. Usuario abre la app sin sesión.
2. Tap "Registrarme" → form (name, email, password).
3. Cliente llama supabase.auth.signUp({ email, password, options: { data: { name } } }).
4. Supabase crea fila en auth.users con email_confirmed_at = null y manda email de verificación.
5. Trigger on_auth_user_created inserta en public.users (id, name, email).
6. Cliente muestra "Te mandamos un email, verificá para continuar".
7. Usuario clickea link en email → Supabase marca email_confirmed_at = now() y redirige a la app.
8. App detecta sesión válida y email verificado → muestra wizard de onboarding con dos CTAs (ver `R6.5`):
   - Primario: "Crear mi primer campo" → flujo de creación de establecimiento. Si el perfil del usuario no tiene `phone`, se intercala una pantalla pidiéndolo antes de continuar (ver `R3.8`).
   - Secundario: "Pegar link de invitación" → abre un input para pegar el link `https://app.rafq.ar/invite?token=XXX` o `rafq://invite?token=XXX` recibido por WhatsApp/mail/etc. El cliente extrae el token y navega a la pantalla de aceptación (ver `ADR-014`).
```

## Flujo de invitación (modelo link shareable, ver `ADR-014`)

### Lado owner (crear y compartir link)

```
1. Owner navega a "Miembros" del establishment activo, tap "Invitar".
2. Form: rol (field_operator | veterinarian) + email opcional como anotación.
3. Cliente llama Edge Function `invite_user({ establishment_id, role, email? })`.
4. Edge Function:
   a. Valida que auth.uid() es owner del establishment.
   b. Si vino email: valida que ese email no tiene un user_roles activo en el campo (precheck soft, no bloqueante para R5.9 — el bloqueo duro está en accept).
   c. Si vino email: valida que no hay una invitación pending no expirada con ese email (evita duplicar invites visibles).
   d. Inserta en invitations (email opcional, token = crypto.randomUUID(), expires_at = now() + 7 días, status = 'pending').
   e. Retorna { invitation_id, token, accept_url, expires_at }.
       accept_url = `${APP_URL}/invite?token=${token}` (env del Edge Function, default `https://app.rafq.ar`).
5. Cliente del owner muestra un modal con el link generado y dos acciones:
   - "Copiar al portapapeles" → Clipboard.setStringAsync(accept_url).
   - "Compartir" → Share.share({ message: accept_url, url: accept_url }) — abre la share sheet nativa (WhatsApp, mail, SMS, Instagram, etc.).
6. Owner comparte el link por el canal que prefiera. El link queda visible en la sección "Invitaciones pendientes" del establishment con acciones (copiar, compartir de nuevo, regenerar, cancelar).
```

### Lado destinatario (aceptar)

```
1. Destinatario recibe el link por WhatsApp / mail / etc.
2. Tap en el link:
   a. Si el SO autoabre la app vía deep link (universal link configurado) → la app recibe el token en el parámetro de query y navega a AcceptInvitationScreen.
   b. Si no autoabre (caso degradado, ej. tap en desktop) → el destinatario abre la app manualmente y usa el CTA "pegar link de invitación" del wizard de onboarding (R6.5). El cliente extrae el token del URL pegado.
3. AcceptInvitationScreen:
   - Si el usuario está logueado: muestra info del establishment y rol, botón "Aceptar invitación".
   - Si no logueado: ofrece "Registrarme" / "Iniciar sesión", preservando el token en el estado de navegación.
4. Tras tap en "Aceptar" (post-auth si hizo falta), cliente llama Edge Function `accept_invitation({ token })`.
5. Edge Function:
   a. Lookup invitation por token (admin client, bypassea RLS para evitar dependencias circulares).
   b. Valida que la invitación existe, status == 'pending', no expirada.
       Si expirada: best-effort mark status = 'expired', retorna 410.
   c. R5.9 — valida que el usuario actual no tiene ya un user_roles activo en ese establishment. Si lo tiene, retorna 409 'already_member'.
   d. Inserta user_roles (user_id = auth.uid(), establishment_id, role, active = true).
   e. Marca invitation.status = 'accepted', accepted_at = now().
   f. Dispara notificaciones al owner (R5.10 + R5.11) con try/catch aislados:
      - Email transaccional vía Resend.
      - Push notification vía Expo Push si el owner tiene push tokens activos.
   g. Retorna { establishment_id, role } al cliente.
6. Cliente refresca lista de establishments del usuario y navega al home del establishment recién aceptado.
7. Owner recibe email + push, abre la app y ve al nuevo miembro en la sección Members.
```

### Diferencias clave vs el modelo email magic link anterior

- El token es **bearer**: cualquiera con el link válido puede aceptar. Antes había validación adicional de email-matching contra el JWT del que aceptaba.
- **No hay envío automático de email al destinatario** desde `invite_user`. El owner es responsable del canal.
- El email en `invitations` queda como **anotación opcional** para que el owner reconozca la invitación en su lista (ej. "para el peón Juan: juan@gmail.com"), pero no se valida.
- **`resend_invitation` se renombra conceptualmente a "regenerar link"** (el archivo conserva el nombre): genera nuevo token, invalida el anterior, reinicia expiración. Sirve como mecanismo de revocación.

## Edge Functions necesarias

1. **`invite_user`** — input: `{ establishment_id, role, email? }`. Crea invitación. Retorna `{ invitation_id, token, accept_url, expires_at }`. **No** envía email al destinatario (modelo link shareable, ver `ADR-014`).
2. **`accept_invitation`** — input: `{ token }`. Valida (status, expiración, no-doble-rol), crea `user_roles`, marca `accepted`, y dispara notificación al owner (email + push) en el mismo flujo. **No** valida email-matching del JWT (modelo bearer).
3. **`cancel_invitation`** — input: `{ invitation_id }`. Solo owner.
4. **`resend_invitation`** — input: `{ invitation_id }`. Regenera token (invalidando el anterior) y reinicia expiración. Retorna `{ token, accept_url, expires_at }`. Conceptualmente "regenerar link" — el archivo conserva el nombre histórico para no romper deploys.
5. **`remove_member`** — input: `{ user_id, establishment_id }`. Marca `user_roles.active = false`.
6. **`change_member_role`** — input: `{ user_id, establishment_id, new_role }`. Desactiva el viejo, inserta uno nuevo.
7. **`register_push_token`** — input: `{ expo_push_token, device_id }`. Asocia el token al `auth.uid()` para envío de push notifications futuro. Llamado por el cliente al obtener permiso del usuario.

Razón de usarlas en lugar de inserts directos: las invitaciones requieren generar tokens y validaciones cruzadas que no son cómodas vía RLS pura. Las notificaciones al owner (email + push) se ejecutan dentro del mismo Edge Function `accept_invitation` para asegurar consistencia transaccional con el insert de `user_roles`.

### Tabla auxiliar `push_tokens`

```sql
create table public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  token      text not null,
  device_id  text,
  platform   text,                       -- 'ios' | 'android' | 'web'
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

create unique index push_tokens_user_token on public.push_tokens (user_id, token);
```

Si el usuario revoca permisos o desinstala, los envíos a ese token van a fallar — limpiar perezosamente en el catch del envío.

## Cliente: contextos y navegación

### AuthContext

```typescript
type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated', user: User, emailVerified: boolean };
```

Expone: `signUp`, `signIn`, `signOut`, `requestPasswordReset`, `resendVerification`.

### EstablishmentContext

```typescript
type EstablishmentState =
  | { status: 'loading' }
  | { status: 'no_establishments' }
  | { status: 'choosing', available: Establishment[] }
  | { status: 'active', current: Establishment, available: Establishment[], role: UserRole };
```

Expone: `switchEstablishment`, `refreshEstablishments`.

Toda query a tablas con `establishment_id` filtra implícitamente por `current.id` mediante una capa de repositorio.

### Navegación raíz

```
RootStack
├── AuthStack (cuando unauthenticated)
│   ├── SignIn
│   ├── SignUp
│   ├── ForgotPassword
│   └── AcceptInvitation (universal link / deep link, ver ADR-014)
└── AppStack (cuando authenticated)
    ├── EmailVerificationGate (si email no verificado)
    ├── EstablishmentSelector (si choosing)
    ├── EmptyState (si no_establishments)
    └── MainTabs (si active)
        ├── Home
        ├── Members
        ├── Settings
        └── ...
```

## PowerSync

En este spec las tablas son chicas y de baja frecuencia de cambio. Configurar buckets:

- `user_self`: filas de `users` con `id = current_user_id`.
- `est_membership`: filas de `user_roles` con `user_id = current_user_id`.
- `est_data`: filas de `establishments` cuyo `id` está en el set de `establishment_id` con rol activo del usuario.
- `est_members`: filas de `user_roles` cuyo `establishment_id` está en el set anterior (para que el owner vea los miembros).
- `est_invitations`: idem, restringidas a status = 'pending'.

La sync rule resuelve a partir de `auth.uid()`.

## Decisiones de producto resueltas (referencia)

Todas las decisiones de producto que afectan esta spec están cerradas y documentadas en la sección "Decisiones tomadas" de `requirements.md`. Resumen para navegación rápida:

| Tema | Decisión | Requirement(s) |
|---|---|---|
| Modelo de invitación | Link shareable (no email magic link). Owner crea link, lo comparte por el canal que prefiera. Token bearer. Ver `ADR-014` | `R5.1`–`R5.12` |
| Onboarding post-signup | Wizard con CTA dual: primario "crear mi primer campo" + secundario "pegar link de invitación" | `R6.5` |
| Teléfono | Opcional en signup, obligatorio al crear establecimiento | `R1.1`, `R3.8` |
| Identidad `user_type` | No existe en MVP. Solo `user_roles`. ADR-006 intacto | — |
| Email al destinatario de invitación | No aplica (link shareable). Owner usa share sheet del SO | — |
| Email en tabla invitations | Nullable, solo anotación opcional para el owner. No se valida al aceptar | `R5.1` |
| Notificación al owner cuando aceptan | Email transaccional + push notification (Expo Push) | `R5.10`, `R5.11` |
| Transferencia de ownership | No hay flujo. El único owner debe soft-deletear el campo antes de darse de baja | `R2.5` |
| Hard delete | Diferido fuera de MVP, esperando requerimientos de retención de SENASA | — (nota en `CONTEXT/08-roadmap.md`) |
| Vista vet/operario sin invitaciones | Cubierto por el CTA "pegar link" del wizard. No requiere lógica diferenciada por rol | `R6.5` |
| Revocación de link | Acción "regenerar link" invalida el token anterior y emite uno nuevo | `R5.8` |

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| RLS mal configurada deja leak entre tenants | Tests de seguridad explícitos por policy. Ver `tasks.md`. |
| Token de invitación predecible | `crypto.randomUUID()` (UUID v4) — 122 bits efectivos de entropía. Infeasible de adivinar por fuerza bruta dentro de la ventana de 7 días. |
| Link shareable filtrado por error (owner lo manda a la persona equivocada o lo pega en un grupo público) | (a) acción "regenerar link" invalida el token actual y emite uno nuevo; (b) expiración corta 7 días; (c) lista de pendientes visible al owner; (d) el rol asignado es removible en un tap si la persona equivocada ya aceptó. |
| Modelo bearer pierde el "doble factor implícito" del email-matching | Trade-off aceptado en `ADR-014`. Mitigado por entropía del token + revocación + alcance limitado del rol invitado (un solo establishment, role acotado). |
| Deep link no autoabre la app (restricción del SO, browser desktop, link compartido cross-device) | CTA secundario del wizard "pegar link de invitación" (`R6.5`) permite al usuario pegar el link manualmente y completar el flujo. |
| Usuario pierde acceso a su único campo por bug | Soft-delete en todo + auditoría en `user_roles` (no se borran filas, se desactivan). |
| PowerSync no sincroniza invitaciones a tiempo | Las invitaciones se aceptan via Edge Function (server-side), no via sync. Mitigado. |
| Resend cae al notificar al owner cuando aceptan (R5.10) | Envío best-effort con try/catch aislado. La aceptación queda persistida igual. El owner igual recibe push (R5.11) si tiene tokens registrados. |

## Package manager

Usamos **`pnpm`** como único package manager del proyecto. Ver `ADR-011` para el rationale completo. Configuración crítica:

- `app/.npmrc` tiene `node-linker=hoisted` (requerido por Metro de React Native).
- `app/package.json` tiene `pnpm.onlyBuiltDependencies` con whitelist explícita de paquetes Expo que pueden ejecutar postinstall scripts. Cualquier dep nueva que requiera scripts hay que agregarla conscientemente.

Comandos típicos:

```bash
cd app
pnpm install                                  # instalar deps del lockfile
pnpm add <paquete>                            # agregar dep runtime
pnpm add -D <paquete>                         # agregar dep dev
pnpm typecheck                                # tsc --noEmit
pnpm start                                    # arrancar Metro
```

## Dependencias externas

- **Supabase project** creado (con Auth habilitado).
- **Servicio de email transaccional (Resend)**: Supabase Auth cubre verificación de email y password reset. Resend se usa **solo para notificar al owner cuando aceptan** una invitación (`R5.10`). Ya **no** se usa para invitar al destinatario (eso ahora es link shareable, ver `ADR-014`). Si Resend cae, el flujo de invitación sigue funcionando; solo se pierde la notificación al owner (push notification queda como backup).
- **Expo Push Notifications**: necesario para `R5.11`. Requiere setup de `expo-notifications` en el cliente, registro de push tokens server-side (tabla `push_tokens`), y manejo de permisos en runtime.
- **Deep linking + universal links** configurado en Expo (esquema `rafq://` para deep link nativo + `https://app.rafq.ar/invite?token=...` para universal link). **Crítico** para el modelo link shareable: el link generado por `invite_user` debe abrir la app cuando el destinatario tap.
- **Native share sheet** del SO: `expo-sharing` o `react-native`'s `Share.share` para que el owner reparta el link por WhatsApp/mail/etc.
- **Clipboard**: `expo-clipboard` (`Clipboard.setStringAsync`) para el botón "copiar link".
- **Variable de entorno `APP_URL`** (env del Edge Function en Supabase secrets, ej. `https://app.rafq.ar`): usada por `invite_user` y `resend_invitation` para construir el `accept_url` retornado al cliente. Default en código: `https://app.rafq.ar` si no está seteada. Cuando arranque la Fase 3 del cliente, el universal link debe apuntar al mismo host.

Ver `tasks.md` para el plan de implementación paso a paso.
