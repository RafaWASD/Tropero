# Tasks — Spec 14: Separación de PII de contacto (`user_private`)

> Checklist ejecutable (`docs/specs.md`). El implementer marca `[x]` y documenta el mapa `R<n> → archivo:test` en `progress/impl_14-pii-user-private.md`.
>
> **Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana (SCHEMA/RLS-SENSITIVE).
>
> **Numeración de migrations: TBD-al-implementar.** Última en disco: `0066`. Coordinar con spec 02 Tier 2 y spec 13 (ambas reclaman migrations nuevas con número TBD) — reconciliar el número libre al aplicar para no colisionar. Nombre lógico sugerido: `XXXX_user_private_pii.sql`.

## Migration (DB)

- [x] **T1** — Migration: crear tabla `public.user_private (user_id uuid PK → users(id) on delete cascade, email text not null, phone text, created_at, updated_at)` + `enable row level security`. Cubre: R1.1, R1.2, R1.4.
- [x] **T2** — Migration: índice de unicidad de email sobre `user_private` (decidir entre índice total `(email)` recomendado, o espejo `deleted_at`+índice parcial, según design §2). Cubre: R1.3.
- [x] **T3** — Migration: policies `user_private_select_self` (`using user_id = auth.uid()`) y `user_private_update_self` (`using` + `with check` `= auth.uid()`). Sin policy de insert/delete. Cubre: R2.1, R2.2, R2.3, R2.4, R2.5.
- [x] **T4** — Migration: trigger `user_private_set_updated_at` (reusar `tg_users_set_updated_at` o el genérico 0016). Cubre: R1.* (housekeeping).
- [x] **T5** — Migration: **backfill** `insert into user_private (user_id, email, phone) select id, email, phone from public.users` ANTES de dropear columnas. Incluye soft-deleted. Cubre: R4.1, R4.2, R4.3.
- [x] **T6** — Migration: `drop index public.users_email_active` + `alter table public.users drop column email, drop column phone`. Cubre: R3.1, R3.2.
- [x] **T7** — Migration: reescribir `public.handle_new_auth_user()` para insertar en `users (id, name)` Y en `user_private (user_id, email)` en la misma transacción (`on conflict do nothing` en ambos, `security definer`, `search_path=public`). Cubre: R5.1, R5.2, R5.3.
- [x] **T8** — Migration: GRANTs (`select, update` a `authenticated`; `all` a `service_role`; nada a `anon`) + `notify pgrst, 'reload schema'`. Cubre: R9.1, R9.2, R9.3, R9.4.
- [x] **T9** — Migration: trigger `auth.users AFTER UPDATE OF email` (`security definer`) que propaga el email confirmado a `user_private.email` (opción 3A del design; validar el shape de `auth.users` de la versión de Supabase del proyecto — distinguir confirmado vs pendiente). Cubre: R7.1, R7.2.

## Edge Functions

- [x] **T10** — `invite_user/index.ts`: re-rutear el precheck "ya es miembro activo" para resolver el email vía `public.user_private` con admin-client (forma de 2 pasos del design §1.2(b): `user_private` por email → `user_roles` por user_id). Conservar los códigos `already_member` / sin-match. Cubre: R8.1, R8.3.
- [x] **T11** — `accept_invitation/index.ts`: separar el lookup del owner — `name` de `public.users`, `email` de `public.user_private` (admin-client, `.eq('user_id', inv.invited_by)`). Mantener `sendInvitationAcceptedEmail({ to: ownerEmail })` y el push best-effort. NO tocar `user.email` (sale del JWT). Cubre: R8.2, R8.3.

## Frontend (services — no UI)

- [x] **T12** — `services/profile.ts` `loadProfileNamePhone`: `name` sigue de `users`; `phone` pasa a leer de `user_private` (self). Mantener el shape `{ name, phone }`. Cubre: R6.1, R6.3.
- [x] **T13** — `services/establishments.ts` `loadOwnProfile` + `saveOwnPhone`: leer/escribir `phone` en `user_private` en vez de `users`. Cubre: R6.4.
- [x] **T14** — `services/establishments.ts` `loadFullProfile`: `name` de `users`; `email` + `phone` de `user_private`. Mantener shape `{ name, email, phone }`. Cubre: R6.1.
- [x] **T15** — `services/establishments.ts` `saveProfile`: `name` a `users`; `phone` a `user_private`. Cubre: R6.2.
- [x] **T16** — Verificar (sin editar) que `services/members.ts` NO lee email/phone de coworkers y que `ProfileContext.tsx` sigue derivando `email` del session (R6.5) y `name/phone` del service (transparente). Documentar la verificación. Cubre: R3.3, R6.5.

## Tests (DB + Edge)

- [x] **T17** — **Test no-bypass (clave, B3-1)** `supabase/tests/rls/`: A y B coworkers; con JWT de A, PostgREST directo `user_private?select=email,phone&user_id=eq.<B>` → 0 filas; `users?select=email,phone` → columnas inexistentes. Cubre: R2.2, R3.1, R3.2.
- [x] **T18** — Test self-read/update `supabase/tests/rls/`: A lee su `user_private` (ve su email/phone); A actualiza su `phone` OK; A intenta `update` la fila de B → 0 filas afectadas. Cubre: R2.1, R2.3, R2.4, R6.1, R6.2.
- [x] **T19** — Test signup-trigger `supabase/tests/rls/`: crear user en `auth.users` → existe fila en `users (id,name)` Y en `user_private (user_id,email)`. Cubre: R5.1, R5.3.
- [x] **T20** — Test backfill `supabase/tests/rls/`: sobre el estado migrado, cada user con email tiene su fila `user_private` con mismo email/phone; conteo consistente. Cubre: R4.1, R4.2.
- [x] **T21** — **Test precheck de invitación** `supabase/tests/edge/`: invitar con email de miembro ya activo → `already_member` (resuelto vía `user_private`); email de no-miembro → invitación OK. Cubre: R8.1, R8.3.
- [x] **T22** — Test accept-notify `supabase/tests/edge/`: aceptar invitación → el lookup del email del owner resuelve contra `user_private` sin romper; flujo retorna OK. Cubre: R8.2, R8.3.
- [x] **T23** — Test email-sync `supabase/tests/rls/` (si T9 implementado): confirmar cambio de email → `user_private.email` refleja el nuevo; pendiente sin confirmar → no cambia. Cubre: R7.1, R7.2.

## Documentación del patrón

- [x] **T24** — Crear `docs/adr/ADR-025-pii-sensible-tabla-private.md` fijando el patrón "PII sensible → tabla `*_private` self-only separada del perfil público" + la razón WAL/PowerSync (ver design §7). Cubre: R10.1.
- [x] **T25** — Nota corta en `docs/conventions.md` §SQL apuntando a ADR-025 (PII de contacto va a `*_private`). Cubre: R10.1.

## Cierre

- [x] **T26** — Actualizar `progress/impl_14-pii-user-private.md` con el mapa de trazabilidad `R<n> → archivo:test` y el número de migration finalmente usado.
- [x] **T27** — Correr la suite (`scripts/run-tests.mjs` / runners RLS + Edge) verde antes de pasar a reviewer.

## Notas de dependencia / orden

- T1→T8 es **una sola migration atómica** en el orden listado (tabla → índice → policies → trigger updated_at → backfill → drop columns → trigger signup → grants). T9 puede ir en la misma migration o en una contigua.
- T10/T11 (EFs) deben deployarse **junto con** la migration: en cuanto las columnas se dropean de `users`, el precheck viejo de `invite_user` (`users!inner(email)`) deja de resolver. No hay ventana segura para desfasarlos.
- T12–T15 (frontend) idem: tras el drop, `loadFullProfile`/`saveProfile`/`loadProfileNamePhone` que pegan a `users.email/phone` fallarían. Coordinar el release.
- Migration número TBD: reconciliar con spec 02 Tier 2 y spec 13 al aplicar.
