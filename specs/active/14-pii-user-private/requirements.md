# Requirements — Spec 14: Separación de PII de contacto (`user_private`)

> EARS estricto (`docs/specs.md`). Fuente de verdad: `specs/active/14-pii-user-private/context.md` (Gate 0 aprobado por Raf, 2026-06-04). Cada "Caso y decisión" del context queda cubierto por ≥1 `R<n>` (mapa al final).
>
> Origen: finding HIGH **B3-1** de `progress/security_baseline_shipped.md`. Patrón decidido por council (opción D, unánime): la PII de contacto se separa FÍSICAMENTE a `user_private`. NO se re-abre la decisión.

## Glosario

- **Perfil público**: `public.users` tras esta spec — `id, name, created_at, updated_at, deleted_at`. Visible a coworkers por diseño (pantalla "Miembros").
- **PII de contacto**: `email` + `phone`. Datos personales regulados (Ley 25.326 AR). Self-only.
- **`user_private`**: tabla nueva que aloja la PII de contacto, vinculada 1:1 a `users` por `user_id`.
- **Coworker**: usuario que comparte ≥1 `establishment` activo con el caller (predicado de `users_select_coworkers`, sin cambios).
- **admin-client**: cliente Supabase con service-role en una Edge Function; bypassea RLS.

---

## R1 — Tabla `user_private` (storage físico de la PII de contacto)

**R1.1** — El sistema deberá tener una tabla `public.user_private` con `user_id uuid` como clave primaria, referenciando `public.users(id)` con `on delete cascade`.

**R1.2** — La tabla `public.user_private` deberá tener una columna `email text not null` y una columna `phone text` (nullable).

**R1.3** — El sistema deberá garantizar la unicidad del `email` entre las filas de `user_private` cuyo usuario no esté soft-deleted, replicando la garantía que hoy da `users_email_active` sobre `public.users(email)`.

**R1.4** — El sistema deberá tener Row Level Security habilitada sobre `public.user_private`.

## R2 — RLS self-only sobre `user_private`

**R2.1** — Mientras un usuario autenticado consulta `public.user_private`, el sistema deberá devolver únicamente la fila cuyo `user_id` es igual a `auth.uid()`.

**R2.2** — Si un usuario autenticado consulta filas de `public.user_private` de otro usuario (cualquier `user_id != auth.uid()`), entonces el sistema deberá devolver cero filas.

**R2.3** — Mientras un usuario autenticado actualiza `public.user_private`, el sistema deberá permitir la operación únicamente sobre la fila cuyo `user_id` es igual a `auth.uid()`.

**R2.4** — Si un usuario autenticado intenta actualizar la fila de `public.user_private` de otro usuario, entonces el sistema deberá rechazar la operación (cero filas afectadas).

**R2.5** — El sistema no deberá otorgar al rol `authenticated` capacidad de `insert` ni `delete` directo sobre `public.user_private` (el insert lo hace el trigger de signup; el ciclo de vida del contacto sigue el de `users`).

## R3 — `public.users` queda como perfil público (sin PII de contacto)

**R3.1** — El sistema no deberá exponer las columnas `email` ni `phone` en `public.users` tras la migración.

**R3.2** — Si un usuario autenticado consulta `email` o `phone` de la fila de un coworker vía PostgREST directo sobre `public.users`, entonces el sistema deberá responder sin esas columnas (no existen en la tabla), sin filtrarlas por convención del cliente.

**R3.3** — El sistema deberá preservar el predicado de tenancy de `users_select_coworkers` (compartir ≥1 establishment activo), de modo que un coworker siga viendo `id` y `name` de sus pares.

**R3.4** — El sistema deberá preservar la policy `users_select_self` y `users_update_self` sobre las columnas restantes de `public.users` (`name`).

## R4 — Migración de datos (backfill)

**R4.1** — Cuando se aplique la migración, el sistema deberá copiar el `email` y el `phone` de cada fila existente de `public.users` a una fila correspondiente de `public.user_private` (misma `user_id`), antes de eliminar esas columnas de `public.users`.

**R4.2** — El sistema deberá garantizar que, tras el backfill, exista exactamente una fila en `public.user_private` por cada fila de `public.users` que tenía `email` no nulo (incluidas las soft-deleted, para preservar el dato de contacto histórico).

**R4.3** — Si una fila de `public.users` no puede mapearse a una fila de `user_private` durante el backfill (por ejemplo `email` nulo donde el schema lo exige not-null), entonces el sistema deberá fallar la migración de forma atómica (la migración no deja la base en estado parcial).

## R5 — Escritura en signup (trigger `handle_new_auth_user`)

**R5.1** — Cuando se crea un usuario en `auth.users`, el sistema deberá insertar la fila de perfil público en `public.users` (`id, name`) y la fila de contacto en `public.user_private` (`user_id, email`) en la misma transacción del trigger.

**R5.2** — Si la inserción en `public.user_private` falla durante el trigger de signup, entonces el sistema no deberá dejar creada la fila de `public.users` sin su fila de `user_private` (atomicidad: ambas o ninguna).

**R5.3** — El sistema deberá poblar `public.user_private.email` con el `email` de `auth.users` en el signup (la fuente del email canónico en el alta sigue siendo `auth.users`).

## R6 — Lectura y edición del perfil propio (frontend)

**R6.1** — Cuando el usuario abre la sección Perfil de "Más" (R2.1 de spec 01), el sistema deberá mostrar su `phone` leído de `public.user_private` (self-only).

**R6.2** — Cuando el usuario guarda su perfil propio (nombre + teléfono, R2.1 de spec 01), el sistema deberá escribir el `name` en `public.users` y el `phone` en `public.user_private`.

**R6.3** — Cuando el ProfileContext carga el perfil del usuario (saludo de home/onboarding), el sistema deberá leer el `phone` de `public.user_private` y mantener el `name` desde `public.users`.

**R6.4** — Cuando el flujo de gate de teléfono (R3.8 de spec 01) lee o guarda el teléfono propio, el sistema deberá usar `public.user_private` en lugar de `public.users`.

**R6.5** — El sistema deberá seguir derivando el `email` mostrado en el perfil propio desde la sesión de `auth` (AuthContext), no desde `public.users` ni desde `public.user_private` (preserva el comportamiento de spec 01: el email visible es el de la sesión fresca).

## R7 — Cambio de email (R2.2 de spec 01)

**R7.1** — Cuando el usuario confirma un cambio de email (flujo nativo de Supabase Auth, R2.2 de spec 01), el sistema deberá actualizar el `email` en `public.user_private` para que el storage consultable de contacto refleje el email confirmado.

**R7.2** — Mientras un cambio de email está pendiente de confirmación, el sistema no deberá modificar el `email` en `public.user_private` (sigue el viejo hasta que `auth.users` confirme, igual que hoy).

## R8 — Lectores legítimos en Edge Functions (admin-client)

**R8.1** — Cuando `invite_user` ejecuta el precheck de "ya es miembro activo" con un email anotado, el sistema deberá resolver ese email contra `public.user_private` vía admin-client (no contra `public.users`).

**R8.2** — Cuando `accept_invitation` busca el email del owner para enviar la notificación, el sistema deberá leer ese email de `public.user_private` vía admin-client (no de `public.users`).

**R8.3** — El sistema deberá mantener el comportamiento funcional observable de los prechecks y notificaciones de invitación tras migrar la fuente a `user_private` (mismos códigos de respuesta: `already_member`, `pending_exists`, envío de email/push best-effort).

## R9 — Defensa en profundidad (GRANTs mínimos)

**R9.1** — El sistema deberá otorgar al rol `authenticated` únicamente `select` y `update` sobre `public.user_private` (sin `insert`/`delete`), acotado por la RLS self-only.

**R9.2** — El sistema deberá otorgar al rol `service_role` los grants necesarios sobre `public.user_private` para que las Edge Functions lean el contacto vía admin-client.

**R9.3** — El sistema no deberá exponer `public.user_private` al rol `anon`.

**R9.4** — El sistema deberá forzar el reload del schema cache de PostgREST tras la migración (`notify pgrst, 'reload schema'`).

## R10 — Documentación del patrón canónico

**R10.1** — El sistema deberá dejar documentado, en `docs/conventions.md` o en un ADR, que toda PII de contacto sensible multi-miembro va a una tabla `*_private` self-only separada del perfil público, con la justificación del canal WAL (RLS/views/column-GRANTs no cubren realtime/PowerSync).

---

## Mapa "Caso y decisión" (context.md) → requirements

| Caso/decisión del context.md | Requirement(s) |
|---|---|
| D elegida: separar PII física a `user_private` self-only | R1.*, R2.*, R3.1, R3.2 |
| `public.users` queda como perfil público (`id, name`) visible a coworkers | R3.1–R3.4 |
| Backfill de email/phone existentes a `user_private` | R4.* |
| Trigger `handle_new_auth_user` puebla `user_private` atómicamente (FK + cascade) | R1.1, R5.* |
| Cambio de email (R2.2 spec 01) escribe en `user_private` | R7.* |
| Perfil propio lee/edita su `user_private`; email sigue del session | R6.* |
| `email` se MUEVE (no se dropea): unique index + prechecks | R1.3, R4.1, R8.1 |
| Lectores de `users.email` (prechecks EF) migran a `user_private` vía admin-client | R8.* |
| `members.ts` (coworkers) queda intacto (ya pedía `id, name`) | R3.3 (verificado, sin cambio) |
| Tenancy de coworkers se preserva (cambian las columnas, no el predicado) | R3.3 |
| Defensa en profundidad: GRANTs mínimos, no exponer más allá de self | R2.5, R9.* |
| Documentar el patrón como canónico (regla de los 6 meses) | R10.1 |

## Fuera de alcance (context.md §Fuera) — NO genera requirements

- Niveles de visibilidad por rol / perfil del vet cross-establishment / avatar. D habilita estos upsides (la tabla `users` limpia es la base correcta) pero NO se implementan acá. Solo no cerrarles la puerta.
- El resto de los findings del baseline (spec 13 + backlog).

## Historial de refinamiento

- 2026-06-04 — Redacción inicial (spec_author) desde `context.md` aprobado (Gate 0).
