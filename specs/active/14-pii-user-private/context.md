# Spec 14 — Separación de PII de contacto (`user_private`) — Refinamiento de contexto (Gate 0)

**Status**: Patrón decidido por council (2026-06-04, Raf delegó la decisión técnica en el leader). **Pendiente lectura/aprobación final de este `context.md`** antes de pasar a `context_ready`.
**Fecha**: 2026-06-04.
**Conducido por**: leader + Raf (+ LLM Council de 5 asesores con revisión por pares).
**Origen**: finding HIGH **B3-1** de la auditoría baseline de seguridad (`progress/security_baseline_shipped.md`): la PII de contacto (email + phone) de un usuario es legible por cualquier coworker vía PostgREST directo, porque la RLS es row-level (no column-level) y el cliente "cumple" pidiendo solo `id, name` (control bypasseable).
**Related**: spec 01 (`public.users`, `users_select_coworkers`/`users_select_self`, trigger `handle_new_auth_user`, cambio de email R2.2, Edge Functions de invitación), ADR-002 (PowerSync committed), ADR-019 (gates), ADR-022 (este Gate 0). Independiente de spec 13 (hardening, que ya está en spec_ready SIN B3-1).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. El `spec_author` lo lee como fuente de verdad. Cada "Caso y decisión" debe quedar cubierto por ≥1 `R<n>`.

## Contexto validado

`public.users (id, name, email, phone)` mezcla **dos entidades con políticas de acceso opuestas y permanentes**: un **perfil de identidad pública** (`id, name` — visible a coworkers por diseño, para la pantalla "Miembros") y **datos de contacto privados** (`email, phone` — PII regulada Ley 25.326, self-only). La RLS de Postgres es row-level: una policy que deja ver la fila del coworker expone la fila COMPLETA. El cliente Expo lee a PostgREST directo con la anon key → cualquier miembro hace `GET /rest/v1/users?select=email,phone` y extrae el contacto de todos sus compañeros. Es explotable HOY solo con un JWT de miembro.

**Decisión (council unánime, opción D): separar la PII de contacto a una tabla `user_private (user_id PK)` con RLS self-only.** `public.users` queda como **perfil público** (`id, name`, timestamps, `deleted_at`).

**Por qué D y no view / RPC / column-GRANTs** (el argumento decisivo del council): RLS, views, RPCs y column-GRANTs viven en la capa **PostgREST**, pero **realtime y PowerSync sincronizan la tabla base por el WAL** (replicación lógica, por fila — no respetan views ni column-GRANTs). RAFAQ va a PowerSync (ADR-002), así que A/B/C taparían la query REST y **dejarían la PII sangrando por el canal de sync**. Solo la separación FÍSICA cierra la PII en TODOS los canales (PostgREST + realtime + PowerSync). Además D es el patrón **canónico y repetible** para toda PII multi-miembro futura (un `ALTER TABLE ADD COLUMN pii` no re-expone nada porque la PII vive en otra tabla con política trivial).

**Dato confirmado**: `public.users.email` es un **duplicado** de `auth.users.email` (el trigger `handle_new_auth_user`, `0001:62-63`, lo copia del signup). No se puede simplemente dropear porque hay un `unique index users_email_active on users(email)` y los prechecks de invitación lo consultan — pero **se mueve** a `user_private` con su unique index; los lectores legítimos (EFs) lo leen vía admin-client (service-role, bypassa RLS, no se rompe).

## Alcance

**Dentro (esta spec):**
- Tabla `user_private (user_id uuid PK references users(id) on delete cascade, email, phone, ...)` con RLS **self-only** (`user_id = auth.uid()`), + mover el `unique index` de email.
- `public.users` deja de tener `email` y `phone` (queda perfil público: `id, name`, timestamps, `deleted_at`).
- Migración de datos: backfill de email/phone existentes a `user_private`.
- **Escritura**: trigger `handle_new_auth_user` puebla `user_private` en el signup (atómico); el flujo de cambio de email (spec 01 R2.2) escribe en `user_private`; el perfil propio lee/edita su `user_private`.
- **Lectores actuales de `users.email`**: migrar el precheck de `invite_user` (y cualquier otro) a `user_private` vía admin-client.
- **Frontend**: el perfil propio (que hoy lee email/phone de `users`) pasa a leer de `user_private`; `members.ts` (coworkers) queda intacto (ya pedía solo `id, name`).
- Documentar el patrón como canónico (posible nota en `docs/conventions.md` o ADR corto si amerita).

**Fuera:**
- El resto de los findings del baseline (spec 13 + backlog).
- Niveles de visibilidad por rol / perfil del vet cross-establishment / avatar / etc. — **upside futuro** que D habilita (la tabla `users` limpia es la base correcta), pero NO se implementa acá. Solo no cerrarle la puerta.

## Casos y decisiones
- **D elegida** (council unánime; el único disidente, "El Ejecutor", votó la view por velocidad — refutado por los 5 revisores: la view filtra por el WAL apenas se prenda PowerSync).
- **Timing (decisión derivada del peer-review): hacerlo AHORA, antes de wire PowerSync.** PowerSync todavía NO está conectado (la auditoría lo confirmó: dominio C diferido). Migrar columnas con sync EN VIVO obliga a doble-escritura + sync sets versionados; hacerlo antes es una migración simple. **Prioridad alta**: es el 2º HIGH explotable-hoy y se abarata si se hace antes del frontend de datos de campo (specs 02/09 que traen PowerSync).
- **`email` se mueve, no se dropea** (unique index + prechecks). Se evaluará en design si además conviene leer el email canónico de `auth.users` en algún punto, pero el storage de contacto consultable va a `user_private`.
- **Tenancy de coworkers se preserva**: el predicado "comparten establishment activo" de `users_select_coworkers` no cambia; lo que cambia es QUÉ columnas hay para ver (ya no email/phone). `users` queda con policy de coworkers sobre `id, name`.
- **Defensa en profundidad**: `user_private` no se expone al rol anon/authenticated en PostgREST más allá del self (policy self-only + GRANTs mínimos); evaluar revocar del schema expuesto lo que no haga falta.

## Pendientes / a resolver en design
- API exacta de invalidación/escritura del trigger `handle_new_auth_user` para poblar `user_private` atómicamente (FK + on-delete cascade).
- Estrategia de backfill bajo cero-downtime (hoy sin PowerSync = simple; confirmar que no hay clientes asumiendo `users.email`).
- ¿`email` queda también en `auth.users` como fuente de verdad y `user_private` como copia consultable, o `user_private` es la única? → design.
- Coordinación de numeración de migrations (spec 02 Tier 2 reclama 0059+; spec 13 también pide migrations TBD) — el implementer reconcilia al aplicar.
- ¿Amerita un ADR corto que fije "PII sensible va a tabla `*_private` self-only, separada del perfil público" como patrón? (regla de los 6 meses → probablemente sí).

## Insumos para spec_author
- `progress/security_baseline_shipped.md` (finding B3-1, evidencia).
- `0001_users.sql` (schema actual, trigger, unique index, GRANTs), `0006_rls_users.sql` (policies `users_select_self`/`users_select_coworkers`/`users_update_self`).
- Edge Functions que leen `users.email`: `invite_user` (precheck), grep de `users.email` en `supabase/functions/*`.
- Frontend: `app/src/services/members.ts` (coworkers, ya pide id,name), pantalla de perfil + cambio de email (R2.1/R2.2).
- Patrones de test: `supabase/tests/*` (no-bypass cross-tenant vía PostgREST directo) — el test clave: como coworker, pedir `email,phone` de otro → 0 columnas/filas.

## Gate 1 (obligatorio)
SCHEMA/RLS-SENSITIVE (nueva tabla, RLS, migración de PII, cambio de trigger) → **Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana.

## Aprobación
- **Patrón decidido (2026-06-04)**: opción D (separar PII a `user_private` self-only), vía LLM Council (5 asesores + peer review, veredicto unánime). Raf delegó la decisión técnica en el leader.
- **PENDIENTE**: lectura + aprobación final de este `context.md` por Raf → entonces 14 pasa a `context_ready` y se lanza `spec_author`.
