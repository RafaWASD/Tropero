# Spec 01 — Design

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25
**Última revisión**: 2026-05-29 — refinamiento de edge cases sesión 17 (estado `active_lost` en `EstablishmentState`, dropdown del switch, persistencia del token de invitación). Previa: 2026-05-25 — refinamiento de invitaciones a link shareable (`ADR-014`).

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
8. App detecta sesión válida y email verificado → pasa el `EmailVerificationGate`. **Antes** de mostrar el wizard, el cliente chequea si hay un **token de invitación pendiente** en almacenamiento seguro (`expo-secure-store`, ver `R5.13`):
   - **Si hay token pendiente** → re-rutea automáticamente a `AcceptInvitationScreen` con ese token (ver `R5.4`/`R5.13`). Resuelta la aceptación (ok o error terminal), borra el token persistido. Este camino cubre el onboarding del vet/peón invitado, que atraviesa signup + verificación + posible kill de la app sin perder la invitación.
   - **Si no hay token** → muestra el wizard de onboarding con dos CTAs (ver `R6.5`):
     - Primario: "Crear mi primer campo" → flujo de creación de establecimiento. **Requiere conexión** (`R9.2`, operación administrativa online). Si el perfil del usuario no tiene `phone`, se intercala una pantalla pidiéndolo antes de continuar (ver `R3.8`).
     - Secundario: "Pegar link de invitación" → abre un input para pegar el link `https://app.rafq.ar/invite?token=XXX` o `rafq://invite?token=XXX` recibido por WhatsApp/mail/etc. El cliente extrae el token, **lo persiste en almacenamiento seguro** (`R5.13`) y navega a la pantalla de aceptación (ver `ADR-014`).
```

## Flujo de landing / selección de establecimiento (ver `R6.6`–`R6.9`, sesión 17)

Al abrir la app con sesión válida + email verificado, el router decide el landing por **cantidad de `user_roles` activos** (no por rol):

```
0 campos activos   → wizard de onboarding (R6.5): "crear mi primer campo" | "pegar link de invitación"
1 campo activo     → home del establecimiento (auto-activo, R6.4). El switch del header (dropdown, R6.8.1) da
                     acceso a "Mis campos" y a "Crear nuevo campo +".
≥2 campos activos  → pantalla "Mis campos" (R6.6) = realización del selector de R6.1.
(campo activo dejó de ser válido) → active_lost (R6.10): aviso + re-ruteo según R6.7 sobre los campos restantes.
```

- **"Mis campos"** (`MyEstablishmentsScreen`): lista los establecimientos con rol activo (nombre + badge de rol + marca del activo). Tap → fija activo (`R6.3`) y navega a su home. Incluye CTA "crear campo" (`R3.1`) y, si aplica, "pegar link de invitación" (`R6.5`). **Orden** (`R6.6.1`): campo activo / último visitado primero (de `last_establishment_opened`), resto alfabético. **Search bar** cuando hay **>~8 campos activos** (atiende al vet con ~20). El umbral exacto (~8) es heurística del autor de spec, a validar.
- **Switch de header = dropdown rápido** (`R6.8`/`R6.8.1`, sesión 17): arriba a la izquierda de las pantallas principales, muestra el campo activo (feedback de contexto). Al tocarlo, despliega un **dropdown inline**: campo activo + **últimos 2 visitados** + "Ver todos mis campos" (→ "Mis campos") + "Crear nuevo campo +" (→ `R3.1`). Tocar un visitado cambia de campo sin pasar por el selector. Es el atajo de cambio rápido para los campos de uso frecuente; "Mis campos" queda para la lista larga y la gestión. Realiza la mitigación anotada en `ADR-018` (promover el switch al header).
- **Por qué por cantidad y no por rol**: un vet con 12 campos y un productor con 5 quieren el selector como entrada; al dueño de un solo campo, una pantalla de selección con un único ítem es fricción. El rol es solo el correlato típico (los vets suelen tener varios).
- **`last_establishment_opened`** (`R6.9`, **requerido** desde sesión 17): pre-destaca el último campo en "Mis campos", lo ordena primero (`R6.6.1`), fija el contexto activo por defecto al reabrir, y **alimenta los "últimos visitados" del dropdown del switch** (`R6.8.1`). **No** saltea el selector para usuarios con ≥2 campos en el landing inicial (`R6.7`); el dropdown es un atajo posterior. Si apunta a un campo ya inaccesible, se ignora y se aplica `active_lost` (`R6.10`). Implementación: persistir por usuario el id del campo activo y un rastro corto de los últimos abiertos (suficiente para 2 visitados distintos del activo); el rastro de visitados sobrevive cold-start (almacenamiento local del cliente).
- **Pantalla "Mis campos" como landing del vet** = la pantalla previa a la home que faltaba en el diseño (detectada sesión 17). Sustrato de datos ya existente: `user_roles` + `establishments` + `EstablishmentContext`.
- **`EstablishmentCard`** (`R6.6.2`, sesión 17 — dirección "híbrido adaptivo", aprobada por Raf): cada campo se renderiza como una card de densidad media (no fila plana ni banner full-screen; escala de 1 a ~20 campos). Anatomía:
  ```
  ┌────────────────────────────┐
  │ ▓▓ banner ▓▓        ● activo│   banner = gradiente verde botella + inicial (default)
  │ La Juanita          [Dueño] │   nombre + badge de rol
  │ 320 animales · 4 rodeos     │   hasta 2 contadores
  │ Preñez 92% · +5 vs zona ▲   │   métrica hero adaptativa + slot benchmark (off en MVP)
  └────────────────────────────┘
  ```
  - **Banner**: default generado (gradiente brand + inicial); foto custom opcional (Supabase Storage, cacheada offline) — nunca forzada.
  - **Métrica hero adaptativa**: tacto reciente → % preñez (mes/año); sino con animales → cabezas + fecha última maniobra; campo vacío → CTA "Configurá tu rodeo".
  - **Señal de atención** opcional (ej. "⚠ tacto pendiente") → triage para el vet.
  - **Slot de benchmarking** reservado en la línea hero ("+5 vs zona"): **vacío en MVP** (sin baseline con pocos campos beta); se enciende post-beta. Pilar de producto, diseñado-para, no prometido vacío.
  - Es componente reusable de la librería (ADR-023); UI fina TENTATIVA hasta el design system, anatomía fijada.
  - **Arquitectura**: contadores + métrica hero por N campos en vivo es costoso/poco-offline; con pocos campos se computa en vivo, al escalar → rollup de resumen por establecimiento (cacheado, refrescado al cerrar maniobra). Ver backlog.

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
   - Si no logueado: ofrece "Registrarme" / "Iniciar sesión", **persistiendo el token en almacenamiento seguro** (`expo-secure-store`, `R5.13`) — no solo en el estado de navegación, que no sobrevive signup + verificación de email + un eventual kill de la app. Al pasar el gate de verificación (`R1.3`), el cliente detecta el token pendiente y vuelve a esta pantalla automáticamente (ver flujo de signup, paso 8).
4. Tras tap en "Aceptar" (post-auth si hizo falta), cliente llama Edge Function `accept_invitation({ token })`.
5. Edge Function:
   a. Lookup invitation por token (admin client, bypassea RLS para evitar dependencias circulares).
   b. Valida que la invitación existe, status == 'pending', no expirada.
       Si expirada/cancelada/ya aceptada (link single-use, `R5.6`): best-effort mark status apropiado, retorna error. El cliente muestra copy accionable ("Este link ya fue usado. Pedile al dueño que te genere uno nuevo.").
   c. R5.9 — valida que el usuario actual no tiene ya un user_roles activo en ese establishment. Si lo tiene, retorna 409 'already_member' **sin tocar el rol existente** (no auto-cambia rol vía invitación — evita escalada). El cliente muestra copy que nombra el rol actual ("Esta persona ya es miembro como <rol>. Para cambiarle el rol, usá Miembros → Cambiar rol."). El cambio de rol vive en `change_member_role` (`R4.5`), no acá.
   d. Inserta user_roles (user_id = auth.uid(), establishment_id, role, active = true).
   e. Marca invitation.status = 'accepted', accepted_at = now().
   f. Dispara notificaciones al owner (R5.10 + R5.11) con try/catch aislados:
      - Email transaccional vía Resend.
      - Push notification vía Expo Push si el owner tiene push tokens activos.
   g. Retorna { establishment_id, role } al cliente.
6. Cliente **borra el token persistido** (`R5.13`), refresca lista de establishments del usuario y navega al home del establishment recién aceptado.
7. Owner recibe email + push, abre la app y ve al nuevo miembro en la sección Members.
```

> **Persistencia del token (sesión 17, `R5.13`)**: el token de invitación pendiente se guarda en `expo-secure-store` apenas el destinatario abre/pega el link sin estar logueado, y se borra cuando se consume (aceptación exitosa o error terminal como expirado/ya usado). Esto evita perder la invitación en el cold-start del onboarding del invitado. El gate de verificación de email (`R1.3`) consulta este store y re-rutea a `AcceptInvitationScreen` si hay token pendiente, antes del wizard/landing.

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
  | { status: 'active', current: Establishment, available: Establishment[], role: UserRole }
  // sesión 17 (R6.10): el establishment activo dejó de ser válido para el usuario.
  // 4 casos: rol removido estando adentro / owner borró el campo / last_establishment_opened
  // inaccesible al reabrir / sync revocó el rol. NO se fuerza logout (R7.4).
  | { status: 'active_lost', reason: 'role_revoked' | 'establishment_deleted',
      lostEstablishmentName: string, available: Establishment[] };
```

Expone: `switchEstablishment`, `refreshEstablishments`.

Toda query a tablas con `establishment_id` filtra implícitamente por `current.id` mediante una capa de repositorio.

**Manejo de `active_lost`** (`R6.10`): la capa de repositorio detecta el evento de pérdida de dos maneras:
- **proactiva** (al reabrir / al refrescar): si el `last_establishment_opened` persistido o el `current.id` ya no aparece en el set de `user_roles` activos del usuario (porque un sync lo desactivó o el campo se soft-deleteó), el contexto transiciona a `active_lost`;
- **reactiva** (durante la operación): una query a una tabla del campo activo retorna 0 filas / error de acceso donde antes había datos (consistente con `R7.2`/`R7.4`, que invalidan el acceso en la próxima query sin logout) → el contexto transiciona a `active_lost`.

`reason` distingue el copy: `role_revoked` → *"Ya no tenés acceso a `<campo>`"*; `establishment_deleted` → *"`<campo>` fue eliminado"*. Tras mostrar el aviso, el contexto **re-rutea según `R6.7`** evaluado sobre `available` (los `user_roles` activos restantes): ≥1 → "Mis campos" o home (si queda exactamente 1); 0 → `no_establishments` (wizard `R6.5`). No se llama a `signOut`. En MVP no hay push/email al miembro afectado: el aviso vive solo dentro de la app.

### Navegación raíz

```
RootStack
├── AuthStack (cuando unauthenticated)
│   ├── SignIn
│   ├── SignUp
│   ├── ForgotPassword
│   └── AcceptInvitation (universal link / deep link, ver ADR-014)
└── AppStack (cuando authenticated)
    ├── EmailVerificationGate (si email no verificado; re-rutea a AcceptInvitation si hay token pendiente, R5.13)
    ├── EstablishmentSelector (si choosing)         ← "Mis campos" (R6.6); landing si ≥2 campos (R6.7)
    ├── EmptyState (si no_establishments)
    ├── EstablishmentLost (si active_lost)          ← aviso legible + re-ruteo (R6.10)
    └── MainTabs (si active)
        ├── Home                                    ← header con switch = dropdown rápido (R6.8/R6.8.1)
        ├── Members
        ├── Settings
        └── ...
```

El estado `active_lost` (`R6.10`) se materializa como una pantalla/overlay `EstablishmentLost` que muestra el aviso (`reason`) y dispara el re-ruteo de `R6.7` sobre los campos restantes. No es un destino persistente: en cuanto el usuario reconoce el aviso (o automáticamente), el router lo lleva a `EstablishmentSelector` / `MainTabs` / `EmptyState` según corresponda.

### Switch del header = dropdown rápido (`R6.8.1`)

El switch del header (`HeaderEstablishmentSwitch`) no navega directo a "Mis campos": despliega un **dropdown inline** con (en orden) el campo activo, los **últimos 2 visitados** (de `last_establishment_opened` / rastro de visitados, `R6.9`), **"Ver todos mis campos"** (→ `EstablishmentSelector` / `R6.6`) y **"Crear nuevo campo +"** (→ flujo de creación, `R3.1`). Tocar un campo visitado hace `switchEstablishment(id)` y navega a su home sin pasar por el selector. La pantalla "Mis campos" sigue siendo la vía para la lista completa, la búsqueda (`R6.6.1`, search bar cuando hay >~8 campos) y la gestión.

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
| Transferencia de ownership | No hay flujo. El único owner debe soft-deletear el campo antes de darse de baja. **Owner único = punto único de falla** (limitación conocida, sin 2do owner en MVP) | `R2.5`, `R2.5.1` |
| Hard delete | Diferido fuera de MVP, esperando requerimientos de retención de SENASA | — (nota en `CONTEXT/08-roadmap.md`) |
| Vista vet/operario sin invitaciones | Cubierto por el CTA "pegar link" del wizard. No requiere lógica diferenciada por rol | `R6.5` |
| Revocación de link | Acción "regenerar link" invalida el token anterior y emite uno nuevo. Link **single-use de facto** | `R5.8`, `R5.6` |
| Switch del header (sesión 17) | **Dropdown rápido**: activo + últimos 2 visitados + "Ver todos" + "Crear campo +". No navega directo al selector | `R6.8`, `R6.8.1` |
| `last_establishment_opened` (sesión 17) | Promovido a **requerido** (alimenta el dropdown). Orden de "Mis campos" + contexto por defecto + últimos visitados | `R6.9`, `R6.6.1` |
| Pérdida del campo activo (sesión 17) | Estado **`active_lost`** + re-ruteo según `R6.7`; sin logout forzado | `R6.10` |
| Crear campo vs cambiar de campo (sesión 17) | Crear campo **requiere conexión**; cambiar de campo activo funciona **offline** si el destino ya sincronizó | `R9.2` |
| Token de invitación pendiente (sesión 17) | Persistido en `expo-secure-store`; re-ruteo a aceptación tras verificar email | `R5.4`, `R5.13` |
| Baja del owner único (sesión 17) | Lista de campos bloqueantes con atajo a soft-delete por campo | `R2.5.1` |
| Soft-delete de campo con miembros (sesión 17) | Warning con conteo de miembros activos + confirmación | `R3.6.1` |
| `already_member` (sesión 17) | No auto-cambia rol vía invitación (evita escalada); copy accionable a "Miembros → Cambiar rol" | `R5.9` |
| Aviso al miembro al perder un campo (sesión 17) | **NO en MVP**: silencioso vía `active_lost`. Push/email proactivo = post-MVP | `R6.10` |

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
- **Almacenamiento seguro**: `expo-secure-store` para persistir el **token de invitación pendiente** a través del cold-start del onboarding del invitado (`R5.13`, sesión 17). Se escribe al abrir/pegar el link sin sesión, se lee al pasar el gate de verificación de email, y se borra al consumir el token.
- **Variable de entorno `APP_URL`** (env del Edge Function en Supabase secrets, ej. `https://app.rafq.ar`): usada por `invite_user` y `resend_invitation` para construir el `accept_url` retornado al cliente. Default en código: `https://app.rafq.ar` si no está seteada. Cuando arranque la Fase 3 del cliente, el universal link debe apuntar al mismo host.

Ver `tasks.md` para el plan de implementación paso a paso.

## Historial de refinamiento

> Audit trail de los refinamientos del design posteriores a la redacción inicial. No se borra.

- **2026-05-29 (sesión 17) — Refinamiento de edge cases (Gate 0 retroactivo)**. Cambios en `design.md` (los requirements correspondientes están en `requirements.md` → "Historial de refinamiento"):
  - **`EstablishmentState`** — agregado el estado **`active_lost`** (`{ reason, lostEstablishmentName, available }`) con detección proactiva (al reabrir/refrescar) y reactiva (query falla durante la operación, consistente con `R7.4`); re-ruteo según `R6.7` sobre los campos restantes; sin logout forzado. Cubre `R6.10`.
  - **Navegación raíz** — agregada la pantalla/overlay `EstablishmentLost` (no persistente) y notas sobre el dropdown del switch. Nueva subsección **"Switch del header = dropdown rápido"** (`R6.8.1`).
  - **Flujo de landing** — actualizada la tabla (1 campo → dropdown del header) y las notas de "Mis campos" (orden `R6.6.1` + search bar >~8 campos) y de `last_establishment_opened` (promovido a requerido, alimenta el dropdown).
  - **Flujo de signup (paso 8)** — el gate de verificación de email chequea token pendiente en `expo-secure-store` y re-rutea a `AcceptInvitationScreen` antes del wizard; creación de campo marcada como online (`R9.2`).
  - **Flujo de invitación — lado destinatario** — token persistido en almacenamiento seguro (no estado de navegación); copy de `already_member` (no auto-cambia rol) y de link single-use; borrado del token al consumirlo. Nota explícita de persistencia del token (`R5.13`).
  - **Tabla "Decisiones de producto resueltas"** — agregadas las decisiones de sesión 17 (switch=dropdown, `last_establishment_opened` requerido, `active_lost`, crear vs cambiar campo, token persistido, baja del owner único, soft-delete con miembros, `already_member`, aviso al miembro = NO MVP, owner único = punto único de falla).
  - **Dependencias externas** — agregado `expo-secure-store`.
  - **Nota de implementación pendiente**: el rastro de "últimos visitados" (para el dropdown) y `last_establishment_opened` requieren almacenamiento local por usuario que sobreviva cold-start; la spec no fija el mecanismo concreto (AsyncStorage / secure-store / fila propia) — decisión técnica menor del implementer, a confirmar al construir el cliente.
