# Spec 01 — Tasks

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25

Plan de implementación paso a paso. Cada tarea tiene su criterio de aceptación. El orden importa: dependencias hacia adelante.

## Fase 0 — Setup

### T0.1 Crear proyecto Supabase
- Crear org y proyecto en dashboard de Supabase.
- Anotar `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
- Configurar región (preferentemente `sa-east-1` o más cercana a Argentina).
- **Aceptación**: dashboard accesible, project ID guardado en `.env.example`.

### [x] T0.2 Inicializar repo de la app
- `npx create-expo-app@latest app --template blank-typescript --no-install --yes` (subdirectorio `app/`, ver decisión de layout en `progress/impl_01-identity-multitenancy.md`).
- **Package manager: pnpm** (ver `ADR-011`). NO usar npm/yarn.
- `app/.npmrc` con `node-linker=hoisted` (compatibilidad con Metro de React Native).
- `app/package.json` con bloque `pnpm.onlyBuiltDependencies` whitelisteando solo paquetes Expo confiables (defensa contra postinstall malware).
- `pnpm install` en `app/` para deps base de scaffold.
- Instalar deps de spec: `pnpm add @supabase/supabase-js expo-secure-store expo-linking @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context expo-notifications expo-device expo-constants`.
- Estructura inicial: `app/src/{screens,components,contexts,hooks,services,types,utils}/` con placeholder mínimo.
- `.env.local` con keys de Supabase ya creado por leader; sirve para Expo automáticamente (lee variables `EXPO_PUBLIC_*`).
- **Aceptación**: `cd app && pnpm typecheck` pasa; `pnpm start` arranca Metro sin errores.

### [x] T0.3 Configurar Supabase CLI y migrations
- Instalar Supabase CLI.
- `supabase init` en el repo.
- Crear estructura `supabase/migrations/`.
- **Aceptación**: `supabase db push` corre contra el proyecto remoto sin errores.

### [~] T0.4 Configurar Expo Notifications (push)
- Instalar `expo-notifications` y dependencias.
- Configurar `app.json` con permisos iOS/Android y `expo-notifications` plugin.
- Crear cuenta de Expo Push (incluido en EAS gratuito para volumen MVP).
- **Aceptación**: el cliente puede llamar `Notifications.getExpoPushTokenAsync()` y obtener un token válido en device real.
- Cubre: prerequisito para `R5.11`.

## Fase 1 — Schema y RLS

### [x] T1.1 Migration: tabla `users` y trigger desde `auth.users`
- Archivo: `supabase/migrations/0001_users.sql`.
- Crear `public.users` con FK a `auth.users.id`.
- Crear trigger `on_auth_user_created` que inserta en `public.users` después de signup.
- **Aceptación**: signup en Supabase Auth dashboard crea fila en `public.users` automáticamente.

### [x] T1.2 Migration: tabla `establishments`
- Archivo: `0002_establishments.sql`.
- Crear tabla con campos del design.
- **Aceptación**: insert manual funciona; `select` retorna la fila.

### [x] T1.3 Migration: enum y tabla `user_roles`
- Archivo: `0003_user_roles.sql`.
- Crear enum `user_role`.
- Crear tabla `user_roles` con unique index condicional.
- **Aceptación**: insertar dos filas activas con el mismo `(user_id, establishment_id)` falla por unique constraint.

### [x] T1.4 Migration: tabla `invitations`
- Archivo: `0004_invitations.sql`.
- Crear enum `invitation_status` y tabla.
- **Aceptación**: insert manual válido; constraint de status enum impide valores arbitrarios.

### [x] T1.5 Migration: helper functions `has_role_in` y `is_owner_of`
- Archivo: `0005_rls_helpers.sql`.
- Crear funciones security definer.
- **Aceptación**: llamadas directas con `auth.uid()` mockeado retornan boolean correcto.

### [x] T1.6 Migration: RLS policies de `users`
- Archivo: `0006_rls_users.sql`.
- Enable RLS + policies select/update/delete del design.
- **Aceptación**: como user A no puedo leer perfil completo de user B.

### [x] T1.7 Migration: RLS policies de `establishments`
- Archivo: `0007_rls_establishments.sql`.
- Enable RLS + policies select/insert/update.
- **Aceptación**: user sin rol no ve el establishment; con rol lo ve; sin role owner no puede update.

### [x] T1.8 Migration: RLS policies de `user_roles` e `invitations`
- Archivo: `0008_rls_membership.sql`.
- Policies del design.
- **Aceptación**: owner ve invitaciones de su campo, otro user no.

### [x] T1.9 Migration: tabla `push_tokens`
- Archivo: `0009_push_tokens.sql`.
- Crear `public.push_tokens` con `user_id`, `token`, `device_id`, `platform`, `created_at`, `last_seen`.
- Unique index `(user_id, token)`.
- RLS: el user solo lee/escribe sus propios tokens.
- **Aceptación**: insertar dos veces el mismo `(user_id, token)` falla por unique.
- Cubre: prerequisito para `R5.11`.

### [x] T1.10 Tests automatizados de RLS
- Crear suite `tests/rls/` con scripts SQL o pgTAP que validan policies.
- Cubrir: aislamiento entre tenants, owner vs operator, soft-delete, RLS de `push_tokens`.
- **Aceptación**: la suite corre en CI y todos los casos pasan.

## Fase 2 — Edge Functions

### [x] T2.1 Edge Function `invite_user`
- Archivo: `supabase/functions/invite_user/index.ts`.
- Recibe `{ establishment_id, email, role }`, retorna `{ invitation_id }` o error.
- Genera token con `crypto.randomUUID()` o `crypto.getRandomValues`.
- Llama Supabase Auth admin API para mandar magic link, o usa Resend.
- **Aceptación**: invocada con owner válido crea invitación y dispara email; con no-owner retorna 403.

### [~] T2.2 Edge Function `accept_invitation`
- Archivo: `accept_invitation/index.ts`.
- Recibe `{ token }`, retorna `{ establishment_id, role }` o error.
- Valida token, expiración, email matching contra `auth.uid()`.
- Inserta `user_roles`, marca invitación como `accepted`.
- **Después de aceptar exitosamente**, dispara notificaciones al owner que creó la invitación:
  - Email transaccional (Resend o SMTP de Supabase) con info del nuevo miembro. Cubre: `R5.10`.
  - Push notification a todos los `push_tokens` activos del owner vía Expo Push API. Cubre: `R5.11`.
  - Ambos envíos se ejecutan en el mismo Edge Function pero con manejo de errores aislado: si el push falla, el email igual sale; si el email falla, el aceptado igual queda persistido.
- **Aceptación**: token válido genera membership; token usado/expirado retorna error claro; owner recibe email; owner con permisos de push recibe notificación.
- **Nota Sesión 4**: code-complete. Flujo principal (aceptación + insert user_roles + accepted_at + push call) testeado. R5.10 email queda como best-effort hasta que `RESEND_API_KEY` esté en secrets de Supabase (helper retorna `{ok:false, reason:'no_key'}` con warning, no bloquea).

### [x] T2.3 Edge Function `cancel_invitation`
- Archivo: `cancel_invitation/index.ts`.
- Solo owner del establishment.
- **Aceptación**: cancela invitación pending; falla si ya fue aceptada.

### [x] T2.4 Edge Function `resend_invitation`
- Archivo: `resend_invitation/index.ts`.
- Regenera token, actualiza `expires_at`, reenvía email.
- **Aceptación**: el token viejo deja de funcionar, el nuevo sí.

### [x] T2.5 Edge Function `remove_member`
- Archivo: `remove_member/index.ts`.
- Solo owner. Marca `user_roles.active = false`, set `deactivated_at`.
- No permite remover al último owner activo.
- **Aceptación**: owner remueve operario OK; intentar removerse a sí mismo siendo único owner falla.

### [x] T2.6 Edge Function `change_member_role`
- Archivo: `change_member_role/index.ts`.
- Solo owner. Desactiva el viejo, inserta nuevo activo.
- Bloquea degradar al único owner.
- **Aceptación**: cambio de field_operator a veterinarian queda registrado; degradar único owner falla.

### [x] T2.7 Edge Function `register_push_token`
- Archivo: `register_push_token/index.ts`.
- Recibe `{ expo_push_token, device_id, platform }`. Upsert en `push_tokens` por `(user_id, token)`, actualizando `last_seen`.
- **Aceptación**: cliente registra token y queda asociado al `auth.uid()`. Re-registro de mismo token actualiza `last_seen` sin duplicar.
- Cubre: infraestructura de `R5.11`.

## Fase 3 — Cliente: auth básico

### T3.1 Cliente Supabase + AuthContext
- `src/services/supabase.ts` con cliente configurado (storage = expo-secure-store).
- `src/contexts/AuthContext.tsx` con estado loading/unauthenticated/authenticated.
- **Aceptación**: hook `useAuth()` retorna el estado correcto al arrancar la app.

### T3.2 Pantallas SignUp / SignIn
- `SignUpScreen` con form (name, email, password).
- `SignInScreen` con form (email, password).
- Validación de inputs (email format, password mínimo 8).
- Manejo de errores de Supabase Auth.
- **Aceptación**: signup crea cuenta y muestra "Verificá tu email"; login con email no verificado lleva a pantalla de gate.

### T3.3 Pantalla de verificación de email
- `EmailVerificationGate` que aparece si `emailVerified === false`.
- CTA "Reenviar email" + "Cerrar sesión".
- Auto-refresh cuando el estado cambia (polling o realtime).
- **Aceptación**: al verificar desde el email, la pantalla cierra y avanza.

### T3.4 Recuperación de password
- `ForgotPasswordScreen` con input de email.
- Llamada a `supabase.auth.resetPasswordForEmail`.
- Pantalla `UpdatePasswordScreen` accedida vía deep link.
- **Aceptación**: flujo completo desde "olvidé password" hasta nueva password funciona.

### T3.5 Bloqueo por intentos fallidos
- Implementar contador local + lockout 15 min después de 5 fallos.
- Opcionalmente trasladarlo a server-side vía Edge Function si Supabase Auth no lo cubre nativamente.
- **Aceptación**: 5 fallos consecutivos bloquean el email durante 15 minutos.

### T3.6 Registro de push token al loguear
- En el `AuthContext`, una vez autenticado y con email verificado, pedir permiso de notificaciones (graceful: si el usuario rechaza, no insistir).
- Si se otorga, obtener `expoPushToken` y llamar Edge Function `register_push_token` (T2.7).
- Manejar re-registro: si el token cambia entre sesiones (Expo lo rota), actualizar.
- **Aceptación**: usuario logueado con permisos otorgados tiene una fila activa en `push_tokens`.
- Cubre: `R5.11` (lado cliente).

## Fase 4 — Cliente: establecimientos

### T4.1 EstablishmentContext
- `src/contexts/EstablishmentContext.tsx` con estado loading/no_establishments/choosing/active.
- Query inicial: `user_roles` activos del usuario actual + sus establishments.
- Persistencia del establishment activo en `expo-secure-store`.
- **Aceptación**: hook `useEstablishment()` expone establishment activo y permite cambiarlo.

### T4.2 Pantalla EstablishmentSelector
- Lista de establishments disponibles, tap → set active.
- **Aceptación**: si tengo 2 campos puedo elegir; al elegir, navego a Home.

### T4.3 Pantalla OnboardingWizard (sin establecimientos)
- Wizard con dos CTAs visibles (ver `R6.5`):
  - Primario: "Crear mi primer campo" → navega a `CreateEstablishmentScreen` (T4.4).
  - Secundario: "Compartir mi email con productores" → pantalla con el email del usuario destacado, botón de copiar, y copy explicativo ("pasáselo a un productor que quiera invitarte").
- **Aceptación**: user verificado sin `user_roles` activos cae acá; ambos CTAs son visibles con jerarquía clara (primario más grande, ambos accesibles).
- Cubre: `R6.5`.

### T4.4 Crear establecimiento (con gate de teléfono)
- `CreateEstablishmentScreen` con form (name, province, opcionales).
- **Antes de mostrar el form, validar que `users.phone` no esté vacío** (ver `R3.8`). Si está vacío, intercalar pantalla `CompletePhoneScreen` que pide el teléfono y lo guarda en perfil antes de continuar.
- Insert directo en `public.establishments` (RLS permite a usuario verificado).
- Trigger / Edge Function que crea automáticamente `user_roles` con role='owner'.
  - Alternativa: hacerlo en el cliente en transacción simulada (insert establishment + insert user_roles back-to-back) o vía Edge Function `create_establishment`.
- **Aceptación**: usuario sin teléfono completa primero el teléfono; luego creo el campo y aparezco como owner; el contexto activo cambia a ese campo.
- Cubre: `R3.1`, `R3.2`, `R3.3`, `R3.8`.

### T4.5 Editar / soft-delete establecimiento
- `EditEstablishmentScreen` accesible solo a owners.
- Soft-delete con confirmación y warning sobre miembros.
- **Aceptación**: como operator no veo el botón editar; como owner sí; delete marca `deleted_at` y desactiva user_roles.

## Fase 5 — Cliente: invitaciones y miembros

### T5.1 Pantalla Members del establishment
- Lista de `user_roles` activos del campo activo.
- Para owner: botones "Invitar", "Cambiar rol", "Remover".
- **Aceptación**: owner ve lista; operator ve lista read-only.

### T5.2 Form de invitación
- Modal "Invitar miembro": email + rol.
- Llamada a Edge Function `invite_user`.
- Toast de éxito o error.
- **Aceptación**: invitación creada, aparece en sección "Invitaciones pendientes".

### T5.3 Sección de invitaciones pendientes
- Lista de invitations status=pending del establishment activo.
- Acciones: cancelar, reenviar, copy link.
- **Aceptación**: pendientes visibles, acciones funcionan.

### T5.4 Pantalla de aceptar invitación (deep link)
- Configurar `expo-linking` con esquema y universal link.
- `AcceptInvitationScreen` accesible vía `/invite?token=XXX`.
- Lookup token → mostrar info del campo y rol.
- Si no logueado: opciones "Registrarme" / "Iniciar sesión", ambas mantienen el token en estado.
- Después de auth, llamada a `accept_invitation`.
- **Aceptación**: end-to-end: owner invita, destinatario recibe email, abre link, se registra/loguea, queda agregado al campo con el rol correcto.

### T5.5 Cambiar rol de miembro
- Acción "Cambiar rol" → modal con opciones.
- Llamada a Edge Function `change_member_role`.
- **Aceptación**: cambio se refleja en la UI inmediatamente.

### T5.6 Remover miembro
- Acción "Remover" → confirmación → llamada a `remove_member`.
- **Aceptación**: removido pierde acceso en su siguiente query.

## Fase 6 — Perfil

### T6.1 Pantalla de perfil
- Mostrar y editar name, phone, email.
- Cambio de email dispara verificación.
- **Aceptación**: cambios persisten; cambio de email mantiene el viejo hasta confirmar.

### T6.2 Logout
- Botón en perfil.
- Limpia sesión y vuelve a AuthStack.
- **Aceptación**: re-login requiere credenciales.

### T6.3 Eliminar cuenta
- Acción destructiva con doble confirmación.
- Bloqueo si es único owner de algún establishment.
- Llamada a Edge Function `delete_account` que hace soft-delete y desactiva roles.
- **Aceptación**: cuenta sin owner solo se elimina; cuenta con campos da error claro.

## Fase 7 — PowerSync

### T7.1 Configurar PowerSync con Supabase
- Crear instancia de PowerSync, configurar conexión a Postgres.
- **Aceptación**: dashboard de PowerSync ve el schema.

### T7.2 Definir sync rules
- Buckets del design (`user_self`, `est_membership`, `est_data`, `est_members`, `est_invitations`).
- **Aceptación**: cliente conectado sincroniza solo los datos correctos.

### T7.3 Integrar PowerSync en cliente
- `src/services/powersync.ts` con cliente.
- Reemplazar queries directas a Supabase por queries a SQLite local.
- **Aceptación**: la app funciona offline con datos pre-sincronizados.

## Fase 8 — QA y cierre

### T8.1 Tests end-to-end
- Suite Detox o equivalente con flujos: signup, login, crear campo, invitar, aceptar, cambiar rol, remover.
- **Aceptación**: la suite corre en CI y pasa.

### T8.2 Auditoría de RLS
- Revisar manualmente cada policy con scripts SQL.
- Validar que `psql` con JWT de user A no puede acceder a datos de user B.
- **Aceptación**: cero acceso cross-tenant confirmado.

### T8.3 Documentación de cierre
- Actualizar `CONTEXT/07-pendientes.md` con preguntas nuevas que hayan surgido durante la implementación (al cierre, las que existían en la spec ya estaban cerradas).
- Anotar en `CONTEXT/08-roadmap.md` el placeholder de hard-delete policy con trigger "cuando SENASA publique requerimientos de retención".
- Mover spec de `specs/active/` a `specs/completed/` si se da por finalizada.
- Si surgen decisiones nuevas: ADRs.
- **Aceptación**: docs reflejan el estado real al cerrar.

## Resumen de dependencias críticas

```
T0.* → T1.* → T2.* ─┐
                    ├→ T3.* → T4.* → T5.* → T6.* → T7.* → T8.*
                    │
              T1.10 (tests RLS) gate antes de avanzar a Fase 3
              T0.4 + T1.9 + T2.7 + T3.6 → cadena de push notifications (R5.11)
```

## Notas de ejecución

- Cada tarea termina con commit en español, presente, descriptivo (ver `CLAUDE.md`).
- Si una tarea descubre algo que cambia la arquitectura → crear ADR antes de seguir.
- Si una tarea expone una pregunta nueva al vet socio → registrarla en `CONTEXT/07-pendientes.md`.
- Tareas T3.5, T3.6 y T5.4 son las más propensas a friction (lockout, push permissions en runtime, deep links en Expo); presupuestar tiempo extra.
- **Push notifications (R5.11)** suman scope no trivial: si en revisión del spec se decide que email solo alcanza para MVP, eliminar T0.4 + T1.9 (`push_tokens`) + T2.7 + T3.6 y simplificar T2.2 a solo email.
