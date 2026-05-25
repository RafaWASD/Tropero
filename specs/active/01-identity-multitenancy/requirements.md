# Spec 01 — Identidad y Multi-Tenancy

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25
**Autor**: Raf

## Resumen

Primer bloque fundacional del producto. Establece el modelo de identidad de usuarios, autenticación, jerarquía de establecimientos, roles por relación usuario-establecimiento, e invitaciones por email con magic link. Sin rodeos en este spec (van en spec 02).

Sirve como sustrato de todas las features que vienen después: ninguna entidad de negocio se puede crear sin `establishment_id`, y ningún acceso se permite sin un `user_roles` activo.

## Decisiones tomadas

Antes de las requirements, dejo registradas las decisiones que ya están cerradas para esta spec:

- **Auth provider**: Supabase Auth (email + password) — ver `ADR-002`.
- **Invitaciones**: email con magic link. Si el email no tiene cuenta, recibe link de registro pre-vinculado. Si ya la tiene, link de aceptación.
- **Signup neutro**: el signup no pregunta "soy productor" vs "soy vet". El rol vive solo en `user_roles` (relación user-establishment). Un mismo usuario puede ser owner de su campo y veterinario invitado en otro.
- **Sin `user_type` en MVP**: la diferenciación de UX para el cold-start del vet se resuelve con un CTA dual en el empty state, no con autodeclaración en signup. Mantiene `ADR-006` intacto. Si más adelante hace falta segmentar para analytics o marketing, se agrega post-MVP con data real.
- **Modelo de roles**: `owner` / `field_operator` / `veterinarian` — ver `ADR-006`.
- **Multi-tenant enforcement**: Row Level Security de Postgres — ver `ADR-004`.
- **Soft deletes**: `deleted_at nullable timestamp` en todas las entidades de negocio.
- **Hard-delete fuera de scope MVP**: la política de retención (cuándo convertir soft-deletes en hard-deletes) se difiere hasta que SENASA publique requerimientos formales de retención. Anotar en `CONTEXT/08-roadmap.md` como trigger explícito.
- **Onboarding post-signup**: wizard con dos CTAs visibles — primario "crear mi primer campo" y secundario "compartir mi email con productores". El mismo wizard sirve a productores y a veterinarios sin necesidad de segmentar.
- **Teléfono**: opcional en signup, obligatorio al crear establecimiento. Refleja que el contacto telefónico solo importa para clientes que pagan (owners).
- **Email de invitación**: solo español, template fijo en MVP. No customización por owner. No multi-idioma.
- **Notificación al owner cuando aceptan invitación**: email transaccional (reusa la infra que ya hace falta para `R5.2`) + push notification (suma Expo Notifications al scope MVP).
- **Transferencia de ownership**: no implementamos flujo en MVP. El único owner activo debe soft-deletear el establecimiento antes de darse de baja de su cuenta (`R2.5`). Documentar como limitación conocida.
- **Sin rodeos en este spec**: rodeos quedan para spec 02 (modelo de animal).

## Requirements (EARS)

### R1. Registro y autenticación

**R1.1** El sistema deberá permitir que un usuario se registre con email, password y nombre como únicos datos obligatorios. El teléfono no se pide en signup; se requiere recién al crear un establecimiento (ver `R3.8`).

**R1.2** Cuando un usuario se registra, el sistema deberá enviar un email de verificación con un link único.

**R1.3** Mientras el email del usuario no esté verificado, el sistema deberá permitir el login pero restringir la creación de establecimientos y la aceptación de invitaciones.

**R1.4** El sistema deberá permitir login con email y password.

**R1.5** El sistema deberá permitir solicitar recuperación de password mediante un link enviado al email.

**R1.6** El sistema deberá permitir logout, invalidando la sesión local.

**R1.7** Si el usuario falla el login 5 veces consecutivas en menos de 10 minutos, entonces el sistema deberá bloquear temporalmente los intentos para ese email durante 15 minutos.

**R1.8** El sistema deberá hashear las passwords con el mecanismo de Supabase Auth (bcrypt / Argon2 según provisión).

### R2. Perfil de usuario

**R2.1** El sistema deberá permitir que el usuario edite su nombre, teléfono y email.

**R2.2** Cuando un usuario cambia su email, el sistema deberá enviar verificación al nuevo email y mantener el viejo hasta que se confirme.

**R2.3** El sistema deberá registrar `created_at` y `updated_at` en todo usuario.

**R2.4** El sistema deberá permitir que el usuario elimine su cuenta. Cuando esto ocurra, el sistema deberá hacer soft-delete (set `deleted_at`) en el usuario y desactivar todos sus `user_roles`.

**R2.5** Si un usuario es el único `owner` activo de un establecimiento, el sistema no deberá permitir la eliminación de su cuenta hasta que transfiera o elimine ese establecimiento.

### R3. Establecimientos

**R3.1** El sistema deberá permitir que cualquier usuario con email verificado cree un establecimiento.

**R3.2** Cuando un usuario crea un establecimiento, el sistema deberá crear automáticamente un `user_roles` con `role = 'owner'` y `active = true` para ese usuario en ese establecimiento.

**R3.3** El sistema deberá requerir nombre y provincia al crear un establecimiento. El resto (ciudad, lat/long, hectáreas) son opcionales.

**R3.4** El sistema deberá permitir que un `owner` edite los datos del establecimiento.

**R3.5** Mientras un usuario tenga rol `field_operator` o `veterinarian` en un establecimiento, el sistema no deberá permitirle editar los datos del establecimiento.

**R3.6** El sistema deberá permitir que un `owner` haga soft-delete de un establecimiento. Cuando esto ocurra, todos los `user_roles` asociados deberán quedar `active = false`.

**R3.7** El sistema deberá incluir los campos `plan_type`, `plan_started_at`, `plan_limits` en `establishments`, sin lógica de validación activa en MVP (ver `ADR-009`).

**R3.8** Cuando un usuario intenta crear un establecimiento sin tener teléfono registrado en su perfil, el sistema deberá pedirle completar el teléfono antes de finalizar la creación.

### R4. Roles y acceso

**R4.1** El sistema deberá modelar la relación usuario-establecimiento como tabla pivot `user_roles` con `(user_id, establishment_id, role, active)`.

**R4.2** Un mismo `user_id` deberá poder tener `user_roles` distintos en distintos `establishment_id`.

**R4.3** El sistema deberá permitir un único rol activo por par `(user_id, establishment_id)`. Si se le cambia el rol, el viejo se desactiva (`active = false`) y se crea uno nuevo activo, manteniendo historial.

**R4.4** Cuando un usuario tiene rol `owner`, el sistema deberá permitirle también operar como `field_operator` en ese mismo establecimiento sin necesitar un `user_roles` adicional.

**R4.5** El sistema deberá permitir que un `owner` cambie el rol de otro usuario en su establecimiento (entre `field_operator` y `veterinarian`).

**R4.6** El sistema no deberá permitir que un `owner` se degrade a sí mismo si es el único owner activo del establecimiento.

**R4.7** El sistema deberá permitir que un `owner` remueva el acceso de otro usuario al establecimiento, marcando el `user_roles` correspondiente como `active = false`.

### R5. Invitaciones

**R5.1** El sistema deberá permitir que un `owner` invite a otro usuario a su establecimiento ingresando email y rol (`field_operator` o `veterinarian`).

**R5.2** Cuando un owner crea una invitación, el sistema deberá:
- Crear una fila en `invitations` con token único, expiración 7 días, estado `pending`.
- Enviar un email al destinatario con un magic link que incluye el token.

**R5.3** Si el email destinatario no tiene cuenta en el sistema, el magic link deberá llevarlo a una pantalla de registro pre-vinculada al token de invitación.

**R5.4** Si el email destinatario ya tiene cuenta, el magic link deberá llevarlo a una pantalla de aceptación con login.

**R5.5** Cuando el destinatario acepta una invitación válida (token correcto, no expirada, estado `pending`), el sistema deberá:
- Crear o reutilizar el usuario.
- Crear un `user_roles` con el rol indicado y `active = true`.
- Marcar la invitación como `accepted`.

**R5.6** Si una invitación está expirada o ya fue usada, el sistema no deberá permitir su aceptación y deberá mostrar un mensaje claro al usuario.

**R5.7** El sistema deberá permitir que el owner cancele una invitación pendiente.

**R5.8** El sistema deberá permitir reenviar una invitación pendiente, lo cual genera un nuevo token y reinicia la expiración.

**R5.9** Si un owner invita a un email que ya tiene un `user_roles` activo en ese establecimiento, el sistema deberá rechazar la invitación con un mensaje claro.

**R5.10** Cuando una invitación pasa a estado `accepted`, el sistema deberá enviar un email transaccional al owner que la creó, notificándolo de la aceptación.

**R5.11** Donde el owner tenga la app instalada y permisos de notificaciones otorgados, el sistema deberá enviar también una push notification cuando una invitación que él creó sea aceptada.

### R6. Contexto activo de establecimiento

**R6.1** Cuando un usuario tiene `user_roles` activos en más de un establecimiento, el sistema deberá pedirle elegir uno como "establecimiento activo" al iniciar sesión.

**R6.2** El sistema deberá permitir cambiar el establecimiento activo en cualquier momento desde la UI.

**R6.3** Mientras haya un establecimiento activo en sesión, el sistema deberá usar ese `establishment_id` por default para todas las queries y operaciones de carga.

**R6.4** Cuando un usuario solo tiene `user_roles` activo en un único establecimiento, el sistema deberá seleccionarlo automáticamente sin pedir input.

**R6.5** Cuando un usuario verificado no tiene ningún `user_roles` activo, el sistema deberá mostrar un wizard de onboarding con dos CTAs visibles: (a) primario, "crear mi primer campo", que inicia el flujo de creación de establecimiento; y (b) secundario, "compartir mi email con productores", que muestra el email del usuario con un botón de copiar y una breve instrucción para pasárselo a un productor que quiera invitarlo.

### R7. Aislamiento multi-tenant

**R7.1** El sistema deberá hacer cumplir el aislamiento entre tenants mediante Row Level Security de Postgres.

**R7.2** El sistema deberá garantizar que ningún usuario pueda leer ni modificar datos de un establecimiento donde no tenga `user_roles.active = true`.

**R7.3** El sistema deberá garantizar que las operaciones administrativas (invitar, cambiar rol, editar campo, eliminar campo) solo sean accesibles a usuarios con `role = 'owner'` en ese establecimiento.

**R7.4** Si un `user_roles` se desactiva mientras el usuario tiene una sesión activa, el sistema deberá invalidar el acceso a ese establecimiento en la próxima query (no es necesario forzar logout inmediato).

### R8. Soft deletes y auditoría

**R8.1** El sistema deberá incluir `deleted_at` (timestamp nullable) en `users`, `establishments` y `invitations`.

**R8.2** El sistema deberá incluir `created_at` y `updated_at` en todas las entidades.

**R8.3** Cuando una entidad tiene `deleted_at != null`, el sistema no deberá retornarla en queries normales (solo en queries administrativas explícitas).

**R8.4** Las RLS policies deberán filtrar `deleted_at IS NULL` por default.

### R9. Sincronización offline (preparación)

**R9.1** Las tablas de este spec (`users`, `user_roles`, `establishments`, `invitations`) deberán estar configuradas en PowerSync como sincronizables, scoped por el set de `establishment_id` donde el usuario tiene rol activo.

**R9.2** Las operaciones de registro, login y password reset deberán requerir conectividad (no se sincronizan offline). El resto (editar perfil, invitar, etc.) puede tolerar offline si tiene sentido, pero no es requisito para este spec.

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- Un usuario nuevo puede registrarse, verificar email, crear un establecimiento y verlo en su lista.
- Un owner puede invitar a otro usuario por email, ese usuario recibe el email, acepta y aparece como miembro del establecimiento con el rol correcto.
- Un usuario con roles en múltiples establecimientos puede cambiar el contexto activo y todos los datos visibles cambian acordemente.
- Las RLS policies impiden que un usuario lea datos de un campo donde no tiene rol activo (validado con tests).
- Un owner puede remover el acceso de otro usuario y ese usuario pierde acceso inmediatamente.
- Todo lo anterior funciona end-to-end con Supabase + cliente React Native.
