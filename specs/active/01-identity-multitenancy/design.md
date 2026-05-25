# Spec 01 — Design

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25

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
  email             text not null,
  role              public.user_role not null,
  token             text not null unique,
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
- SELECT: owners del establishment, o el invitado por email matching.
- INSERT: solo owners.
- UPDATE: solo owners (cancelar) o el sistema (al aceptar).

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
   - Secundario: "Compartir mi email con productores" → pantalla con el email del usuario, botón de copiar y copy explicativo.
```

## Flujo de invitación

```
1. Owner navega a "Miembros" del establishment activo, tap "Invitar".
2. Form: email + rol (field_operator | veterinarian).
3. Cliente llama Edge Function `invite_user(establishment_id, email, role)`.
4. Edge Function:
   a. Valida que auth.uid() es owner del establishment.
   b. Valida que el email no tiene ya un user_roles activo en ese establishment.
   c. Inserta en invitations (token = random, expires_at = now() + 7 days, status = 'pending').
   d. Envía email vía Supabase Auth o Resend con link "https://app.rafq.ar/invite?token=XXX".
5. Destinatario abre link.
6. Cliente extrae token de URL, llama Edge Function `lookup_invitation(token)`.
   a. Si token inválido / expirado / usado → mostrar error.
   b. Si válido y el email no tiene cuenta → flujo "registrate para aceptar" (signup pre-vinculado).
   c. Si válido y el email tiene cuenta → flujo "login para aceptar".
7. Después de signup o login, cliente llama Edge Function `accept_invitation(token)`.
8. Edge Function:
   a. Valida token, expiración, email matching.
   b. Inserta user_roles (user_id = auth.uid(), establishment_id, role, active = true).
   c. Marca invitation.status = 'accepted', accepted_at = now().
   d. Dispara notificación al owner que creó la invitación:
      - Email transaccional vía Resend / Supabase Auth (ver `R5.10`).
      - Push notification vía Expo Push si el owner tiene un push token registrado y permisos activos (ver `R5.11`).
   e. Retorna OK al cliente.
9. Cliente refresca lista de establishments del usuario.
10. Owner recibe email y/o push, abre la app y ve al nuevo miembro en la sección Members.
```

## Edge Functions necesarias

1. **`invite_user`** — input: `establishment_id, email, role`. Crea invitación + dispara email.
2. **`accept_invitation`** — input: `token`. Valida, crea `user_roles`, marca `accepted`, y dispara notificación al owner (email + push) en el mismo flujo.
3. **`cancel_invitation`** — input: `invitation_id`. Solo owner.
4. **`resend_invitation`** — input: `invitation_id`. Regenera token y reenvía email.
5. **`remove_member`** — input: `user_id, establishment_id`. Marca `user_roles.active = false`.
6. **`change_member_role`** — input: `user_id, establishment_id, new_role`. Desactiva el viejo, inserta uno nuevo.
7. **`register_push_token`** — input: `expo_push_token, device_id`. Asocia el token al `auth.uid()` para envío de push notifications futuro. Llamado por el cliente al obtener permiso del usuario.

Razón de usarlas en lugar de inserts directos: las invitaciones requieren generar tokens, mandar email, y validaciones cruzadas que no son cómodas vía RLS pura. Las notificaciones al owner (email + push) se ejecutan dentro del mismo Edge Function `accept_invitation` para asegurar consistencia transaccional con el insert de `user_roles`.

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
│   └── AcceptInvitation (deep link via magic link)
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
| Onboarding post-signup | Wizard con CTA dual: primario "crear mi primer campo" + secundario "compartir mi email con productores" | `R6.5` |
| Teléfono | Opcional en signup, obligatorio al crear establecimiento | `R1.1`, `R3.8` |
| Identidad `user_type` | No existe en MVP. Solo `user_roles`. ADR-006 intacto | — |
| Email de invitación | Solo español, template fijo, no customizable | `R5.2` (lenguaje implícito en design) |
| Notificación al owner cuando aceptan | Email transaccional + push notification (Expo Push) | `R5.10`, `R5.11` |
| Transferencia de ownership | No hay flujo. El único owner debe soft-deletear el campo antes de darse de baja | `R2.5` |
| Hard delete | Diferido fuera de MVP, esperando requerimientos de retención de SENASA | — (nota en `CONTEXT/08-roadmap.md`) |
| Vista vet sin invitaciones | Cubierto por el CTA secundario del wizard. No requiere lógica diferenciada por rol | `R6.5` |

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| RLS mal configurada deja leak entre tenants | Tests de seguridad explícitos por policy. Ver `tasks.md`. |
| Token de invitación predecible | Usar `gen_random_uuid()` o `pgcrypto.gen_random_bytes(32)` codificado en base64url. |
| Email no llega (spam) | UI muestra "reenviar invitación" y owner puede compartir el link manualmente (copy to clipboard). |
| Usuario pierde acceso a su único campo por bug | Soft-delete en todo + auditoría en `user_roles` (no se borran filas, se desactivan). |
| PowerSync no sincroniza invitaciones a tiempo | Las invitaciones se aceptan via Edge Function (server-side), no via sync. Mitigado. |

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
- **Servicio de email transaccional**: Supabase Auth cubre verificación y password reset. Para emails de invitación (`R5.2`) y notificación al owner cuando aceptan (`R5.10`), evaluar usar el mismo SMTP de Supabase o Resend. Recomendación: Resend por mejor deliverability y templates.
- **Expo Push Notifications**: necesario para `R5.11`. Requiere setup de `expo-notifications` en el cliente, registro de push tokens server-side (tabla `push_tokens`), y manejo de permisos en runtime. **Suma scope al MVP** — confirmar antes de empezar la fase 5.
- **Deep linking** configurado en Expo (esquema `rafq://` y/o universal links `https://app.rafq.ar/...`).

Ver `tasks.md` para el plan de implementación paso a paso.
