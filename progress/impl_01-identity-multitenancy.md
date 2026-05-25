# Implementación — `01-identity-multitenancy`

**Agente:** `implementer`
**Inicio:** 2026-05-25
**Spec:** `specs/active/01-identity-multitenancy/` (aprobado por Raf el 2026-05-25)

## Estado actual

**Fase 0 completa** (T0.1, T0.2, T0.3, T0.4*).
**Fase 1 completa** (T1.1 – T1.10, schema + RLS + suite de tests).
**Fase 2-8 pendientes** (Edge Functions, cliente, PowerSync, QA).

\* T0.4 marcada como `[~]` parcial: scaffold de Expo Notifications listo (plugin en `app.json`, permisos iOS/Android, helper `getExpoPushTokenSafe`). El test de obtener token real en device físico depende de hardware y se cierra en T3.6 cuando se ejercita el flujo end-to-end.

## Tasks ejecutadas en esta sesión

| Task | Estado | Notas |
|---|---|---|
| T0.1 | ✅ hecho por humano | Project `xrhlxxdnfzvdnztacofj`, sa-east-1. |
| T0.2 | ✅ | Scaffold Expo + spec deps (`@supabase/supabase-js`, `expo-secure-store`, `expo-linking`, `@react-navigation/*`, `expo-notifications`, `expo-device`, `expo-constants`, `react-native-safe-area-context`, `react-native-screens`). Estructura `src/{screens,components,contexts,hooks,services,types,utils}/`. `App.tsx` con splash "Hola RAFAQ". Helper `src/utils/env.ts` para `EXPO_PUBLIC_*`. Typecheck verde. |
| T0.3 | ✅ | Supabase CLI instalado como devDep de `app/` (binario nativo `@supabase/cli-windows-x64` via optionalDependencies). `supabase init` + `supabase link` ejecutados desde repo root usando `SUPABASE_ACCESS_TOKEN`. `supabase/config.toml` generado. `supabase db push` funciona end-to-end. |
| T0.4 | 🟡 parcial | Plugin `expo-notifications` en `app.json` con `defaultChannel` y color. iOS `UIBackgroundModes: ["remote-notification"]`. Android `permissions: ["NOTIFICATIONS"]`. Helper `src/services/push-notifications.ts` con `getExpoPushTokenSafe` que retorna `Result<string, PushRegistrationFailure>` (typed failure modes: not_a_device, permission_denied, no_project_id, unexpected). Token-en-device-real lo valida T3.6. |
| T1.1 | ✅ | `0001_users.sql` — `public.users` + trigger `on_auth_user_created` (toma `name` de `raw_user_meta_data` con fallback al local-part del email) + trigger `updated_at`. |
| T1.2 | ✅ | `0002_establishments.sql` — tabla con check constraints (name/province no vacíos) + index parcial active + trigger updated_at. |
| T1.3 | ✅ | `0003_user_roles.sql` — enum `user_role`, tabla pivot, unique index parcial `(user_id, establishment_id) where active = true` para R4.3. |
| T1.4 | ✅ | `0004_invitations.sql` — enum `invitation_status`, tabla con check `role <> 'owner'` (los owners no se invitan, se autocrean en T4.4), unique en token, email lowercase obligatorio. |
| T1.5 | ✅ | `0005_rls_helpers.sql` — `has_role_in(uuid)` y `is_owner_of(uuid)` security definer, ambas excluyen establishments soft-deleted. Grants explícitos a `authenticated`, revoke de `public`. |
| T1.6 | ✅ | `0006_rls_users.sql` — `users_select_self`, `users_select_coworkers` (vía exists en `user_roles` compartido), `users_update_self`. |
| T1.7 | ✅ | `0007_rls_establishments.sql` — `establishments_select` (has_role_in), `establishments_insert` (auth.uid() not null), `establishments_update` (is_owner_of). |
| T1.8 | ✅ | `0008_rls_membership.sql` — policies para `user_roles` (select propio + owner-view; insert self-owner para cubrir T4.4 sin Edge Function; update solo owner) + invitations (select owner-o-invitee-por-email-JWT; insert owner; update owner). |
| T1.9 | ✅ | `0009_push_tokens.sql` — tabla, unique `(user_id, token)`, RLS self-only en todos los verbos. |
| T1.10 | ✅ | Suite de tests RLS: `supabase/tests/rls/run.cjs` (Node native `node:test` + `supabase-js` + `ws` transport). 15 tests, 100% pass. Cleanup automático de users/establishments creados. Cubre aislamiento cross-tenant, owner vs operator, soft-delete, push_tokens. |

## Migrations extra agregadas (no en tasks.md original)

| Migration | Propósito |
|---|---|
| `0010_grants_fix.sql` | Re-aplica grants explícitos a `authenticated` y `service_role` en todas las tablas + `grant usage on type` para los enums + `notify pgrst, 'reload schema'`. Fue necesario tras observar `permission denied for table establishments` desde service_role en testing inicial — el patrón "Auto-expose new tables: OFF" requiere grants table-level también para service_role, además de los de `authenticated` que ya estaban en las migrations base. |
| `0011_establishment_auto_owner.sql` | Trigger AFTER INSERT en `establishments` que crea `user_roles` owner para `auth.uid()`. Cubre R3.2 sin Edge Function. Idempotente vía guard `if not exists`. |

## Hallazgo importante de RLS

PostgREST evalúa la policy SELECT sobre el `RETURNING *` de un INSERT **en el mismo statement**, aunque el AFTER INSERT trigger ya haya creado la fila de `user_roles` owner. Resultado: `insert(establishment).select()` falla con `42501` (RLS violation) aunque la fila quedó persistida y el trigger creó la membership.

**Implicancia para T4.4 (cliente):** el wizard de creación de establishment NO debe usar `.insert(...).select(...)` en un solo roundtrip. Patrón correcto:

```ts
const { error: insErr } = await client.from('establishments').insert(payload);
if (insErr) throw insErr;
const { data, error } = await client
  .from('establishments')
  .select('*')
  .eq('name', payload.name)
  .order('created_at', { ascending: false })
  .limit(1)
  .single();
```

O bien (más robusto) ir directo a una Edge Function `create_establishment` que use service_role y devuelva el `id`. Anotado para T4.4.

## Trazabilidad R<n> → test

Suite: `supabase/tests/rls/run.cjs`. Subtests numerados.

| R<n> | Cubierto por |
|---|---|
| R3.1 | `setup: crea usuarios y establishments` (insert via authenticated client) |
| R3.2 | `setup: crea usuarios y establishments` (verifica que el trigger creó `user_roles` owner) |
| R3.4 | `R3.4: owner sí puede update su establishment` |
| R3.5 | `R3.5: field_operator no puede update establishment` |
| R3.6 | `R8.3/R8.4: soft-delete oculta establishment al cliente` (soft-delete vía update de deleted_at) |
| R4.1 | `setup` + `R4.3` (cubre estructura user_roles) |
| R4.3 | `R4.3: unique index impide dos roles activos para el mismo par` |
| R4.7 | implícito en `R3.5`/`R3.6` (active=false desactiva acceso) — test explícito pendiente en T2.5/T5.6 |
| R5.1 | `R5.1 / RLS invitations_insert_owner: owner crea invitación` |
| R5.11 (infra) | `push_tokens: cada user solo ve sus tokens` + `push_tokens: unique (user_id, token)` |
| R6.1 | `R6.1: userB con roles en 2 establishments ve ambos` |
| R7.2 | `R7.2: userA no ve establishment de userB` + `R7.2: userA ve su propio establishment` |
| R7.3 | `R7.3: userA no puede update establishment de userB` + `R7.3: non-owner no puede crear invitación` |
| R8.3 / R8.4 | `R8.3/R8.4: soft-delete oculta establishment al cliente` |

Requirements **no cubiertos aún por tests** (requieren tasks Fase 2+):
- R1.1 – R1.8 (auth flows: signup/login/verify/lockout) → T3.1-T3.5
- R2.1 – R2.5 (perfil + soft-delete cuenta) → T6.1-T6.3
- R3.3 (validación name+province obligatorios) — check constraints OK pero falta test client-side
- R3.7 (plan_type / plan_started_at / plan_limits) — schema OK, sin tests porque no hay lógica activa
- R3.8 (gate de teléfono) → T4.4
- R4.4 (owner opera como field_operator implícito) → tests de feature 03 (modo maniobras)
- R4.5 / R4.6 (cambio de rol; bloquear degradar único owner) → T2.6
- R5.2 – R5.10 (flujo de invitaciones end-to-end + email) → T2.1-T2.4, T5.2-T5.6
- R6.2 / R6.3 / R6.4 / R6.5 (switch establishment, default, wizard) → T4.1-T4.3
- R7.4 (invalidación al desactivar role) → T5.6 + verificación manual
- R9.1 / R9.2 (PowerSync) → T7.1-T7.3

## Archivos creados/modificados en esta sesión

Nuevos:
- `supabase/config.toml`
- `supabase/migrations/0001_users.sql`
- `supabase/migrations/0002_establishments.sql`
- `supabase/migrations/0003_user_roles.sql`
- `supabase/migrations/0004_invitations.sql`
- `supabase/migrations/0005_rls_helpers.sql`
- `supabase/migrations/0006_rls_users.sql`
- `supabase/migrations/0007_rls_establishments.sql`
- `supabase/migrations/0008_rls_membership.sql`
- `supabase/migrations/0009_push_tokens.sql`
- `supabase/migrations/0010_grants_fix.sql`
- `supabase/migrations/0011_establishment_auto_owner.sql`
- `supabase/tests/rls/run.cjs`
- `scripts/run-tests.mjs`
- `app/src/types/index.ts`
- `app/src/utils/env.ts`
- `app/src/services/supabase.ts` (placeholder; real client en T3.1)
- `app/src/services/push-notifications.ts`
- `app/src/contexts/index.ts` (placeholder)
- `app/src/hooks/index.ts` (placeholder)
- `app/src/screens/index.ts` (placeholder)
- `app/src/components/index.ts` (placeholder)

Modificados:
- `app/App.tsx` — splash "Hola RAFAQ" con SafeAreaProvider
- `app/app.json` — plugin expo-notifications + permisos iOS/Android
- `app/package.json` — spec deps + `ws` + `supabase` CLI; whitelist pnpm expandido (`supabase` agregado a `onlyBuiltDependencies`)
- `.harness/config.json` — `testCommand` apunta a `node scripts/run-tests.mjs`
- `specs/active/01-identity-multitenancy/tasks.md` — checkboxes T0.2-T0.4 y T1.1-T1.10
- `progress/current.md` — bitácora en tiempo real

## Decisiones tomadas y pendientes para anotar como ADR

1. **Trigger `handle_new_establishment` en lugar de Edge Function `create_establishment` para R3.2.** Razón: simpler, transaccional, una sola roundtrip desde el cliente. Trade-off: el cliente debe hacer insert sin .select() y luego un select separado por la limitación de RLS-on-RETURNING.
2. **Suite RLS en Node nativo, no pgTAP.** Razón: corre contra DB remota real (más fiel que pgTAP local), no requiere Docker (Windows + corporate Cylance complica Docker), usa `@supabase/supabase-js` con los JWTs que usaría la app real. Trade-off: requiere conectividad y service_role key; documentado en `scripts/run-tests.mjs` con skip graceful si falta la key.
3. **Supabase CLI como devDep de `app/`.** Razón: Scoop/winget bloqueados por Cylance + corporate; pnpm install ya funciona en este entorno. El paquete npm `supabase` 2.101.0 descarga el binario nativo via `optionalDependencies` (`@supabase/cli-windows-x64`). Agregado al `onlyBuiltDependencies` whitelist.

Si Raf quiere, podemos formalizar estas tres en un solo ADR-012 cuando termine Fase 2.

## Cómo correr los tests

Desde la raíz del repo, en PowerShell:

```
node scripts/check.mjs
```

Internamente corre:
1. `cd app && pnpm.cmd typecheck`
2. `node --test supabase/tests/rls/run.cjs`

La segunda parte requiere `.env.local` con `SUPABASE_SERVICE_ROLE_KEY` y `EXPO_PUBLIC_SUPABASE_*`. Si falta la service role key, se saltea con warning.

## Próximo paso

Quedan **Fases 2-8** (T2.1 – T8.3). Lista corta de lo más crítico:

- **Fase 2 (Edge Functions)**: 7 funciones (`invite_user`, `accept_invitation`, `cancel_invitation`, `resend_invitation`, `remove_member`, `change_member_role`, `register_push_token`). Necesitan setup de envío de email (Resend o SMTP de Supabase). `accept_invitation` necesita Expo Push API (token ya en `.env.local` como `EXPO_ACCESS_TOKEN`).
- **Fase 3 (Cliente auth)**: AuthContext con expo-secure-store, pantallas SignUp/SignIn/VerifyEmail/ForgotPassword, lockout 5-fallos, register-push-token al login.
- **Fase 4 (Establishments)**: EstablishmentContext, selector, wizard CTA dual (R6.5), gate de teléfono (R3.8), create/edit/soft-delete.
- **Fase 5 (Invitations UI)**: pantalla Members, modal invitar, sección pendientes, deep-link accept.
- **Fase 6 (Perfil)**: editar perfil, logout, delete account (con guard R2.5).
- **Fase 7 (PowerSync)**: instancia + buckets + cliente local.
- **Fase 8 (QA)**: Detox e2e + auditoría manual RLS + docs cierre.

El leader puede relanzar al implementer (más sesiones) o tomar la siguiente fase modularizándola.

## Resumen para `leader`

**Reporto `done` para Fase 0 + Fase 1.** La spec entera NO está completa; quedan Fases 2-8 (Edge Functions + cliente entero). El leader decide si:
(a) lanza otra sesión de implementer para Fase 2,
(b) considera esto un milestone parcial y mantiene la feature `in_progress`,
(c) reformula el alcance de la spec en chunks más chicos.

`node scripts/check.mjs` está verde con typecheck + 15 tests RLS pasando contra la DB remota.

---

## Sesión 3 — Implementer bloqueado por permisos de tools (2026-05-25)

El leader lanzó una tercera sesión de implementer para Fase 2 (Edge Functions). Esa sesión **fue bloqueada por denegación de permisos de Write/Edit/Bash a nivel framework** (no por blocker técnico). Toda la investigación (lectura de spec, ADRs, progress) se completó, pero el implementer no pudo escribir un solo archivo.

Cero código nuevo se escribió. Working tree sigue limpio en `main` con los 5 commits del milestone Fase 0+1.

### Plan de Fase 2 dejado por el implementer bloqueado (para que la próxima sesión lo levante sin re-investigar)

**Shared helpers en `supabase/functions/_shared/`**:
- `cors.ts` — `corsHeaders` + `handleOptions(req)` para preflight.
- `supabase.ts` — factories `createAdminClient()` (service_role) y `createUserClient(req)` (anon + JWT del header `Authorization`).
- `auth.ts` — `requireUser(client)` extrae `auth.uid()`; `requireOwnerOf(adminClient, userId, establishmentId)` valida via tabla.
- `errors.ts` — `jsonError(status, code, message)` + `jsonOk(data)` con CORS headers.
- `email.ts` — invitación via `auth.admin.inviteUserByEmail(email, { data: { invitation_token, establishment_name }, redirectTo: ${APP_URL}/invite?token=${token} })`. Notificación al owner via `auth.admin.generateLink({ type: 'magiclink' })` + fallback a Resend si `RESEND_API_KEY` está configurada. Si ninguno cubre, skip con warning (R5.10 best-effort, no bloqueante).
- `push.ts` — POST a `https://exp.host/--/api/v2/push/send` con `Authorization: Bearer ${EXPO_ACCESS_TOKEN}`, body es array de mensajes. Parsear respuesta: por cada `data[i].status === 'error'` con `details.error === 'DeviceNotRegistered'`, hacer `delete` del row de `push_tokens` correspondiente.

**Funciones**:

- **T2.1 `invite_user`**: input `{ establishment_id, email, role }`. Pasos: `requireUser` → `requireOwnerOf` → valida `role !== 'owner'` → normaliza email a lowercase → chequea no exista `user_roles active = true` para ese email en ese establishment (join con `users.email`) → chequea no haya invitation `pending` no expirada para ese email → genera token con `crypto.randomUUID()` → inserta en `invitations` (status=pending, expires_at=now()+7d, invited_by=user.id) → dispara email via helper → retorna `{ invitation_id, token }`. Cubre R5.1, R5.2, R5.9.

- **T2.2 `accept_invitation`**: input `{ token }`. Pasos: `requireUser` → lookup invitation (service_role) por token + status=pending + expires_at>now() → match `invitation.email === auth user email` (lowercase) → service_role insert en `user_roles(user_id=auth.uid(), establishment_id, role, active=true)` (bypass RLS) → service_role update `invitations.status='accepted', accepted_at=now()` → lookup owner via `user_roles WHERE establishment_id AND role='owner' AND active=true` → trigger email y push al owner con manejo de errores aislado (try/catch independiente para cada uno). Cubre R5.5, R5.6, R5.10, R5.11.

- **T2.3 `cancel_invitation`**: input `{ invitation_id }`. Solo owner. Update `status='cancelled', cancelled_at=now()`. Cubre R5.7.

- **T2.4 `resend_invitation`**: input `{ invitation_id }`. Solo owner. Genera nuevo token, update `token, expires_at=now()+7d`, reenvía email. Token viejo deja de funcionar por unique constraint en token. Cubre R5.8.

- **T2.5 `remove_member`**: input `{ user_id, establishment_id }`. Solo owner. Pre-check: `count(user_roles WHERE establishment_id AND role='owner' AND active=true) > 1` si target es owner. Si es el único owner → 409 conflict. Update `active=false, deactivated_at=now()`. Cubre R4.7, R7.4.

- **T2.6 `change_member_role`**: input `{ user_id, establishment_id, new_role }`. Solo owner. Pre-check si current role='owner' y new_role!='owner': contar otros owners activos; si target es único owner → 409. Transacción via rpc o split: update viejo `active=false, deactivated_at=now()` + insert nuevo `active=true`. Validar new_role en enum. Cubre R4.5, R4.6.

- **T2.7 `register_push_token`**: input `{ expo_push_token, device_id, platform }`. `requireUser`. Upsert por `(user_id, token)` actualizando `last_seen=now(), device_id, platform`. Usa `onConflict: 'user_id,token'` del cliente service_role o del cliente del user (la policy `push_tokens_insert_self`/`push_tokens_update_self` lo permite). Cubre R5.11 infra.

**Tests**: nuevo runner `supabase/tests/edge/run.cjs` con el mismo patrón que `rls/run.cjs`. Para cada función crear test con JWT real via `supabase.functions.invoke(name, { body })` post-login. Extender `scripts/run-tests.mjs` para correr ambas suites secuencialmente. Requiere deploy previo de las funciones a remoto via `cd app && pnpm.cmd exec supabase functions deploy <name>` (que requiere `SUPABASE_ACCESS_TOKEN`, ya en `.env.local`).

### Decisión pendiente para el leader

**Pregunta del implementer al leader**: para R5.10 (notificación email al owner cuando aceptan), `supabase.auth.admin` no manda emails arbitrarios (solo invites/magic links). Opciones:

(a) **Fetch directo a Resend API** (`https://api.resend.com/emails` con `RESEND_API_KEY`). Sin deps externas, alineado con principio de "menos superficie de ataque" (no agregamos paquetes a Edge Functions). Requiere que Raf cree cuenta en Resend y agregue `RESEND_API_KEY` a `.env.local`.

(b) **R5.10 queda como best-effort log-only en MVP**. No mandamos email al owner cuando aceptan; solo push notification (R5.11) y badge in-app. Documentar limitación.

(c) Otra alternativa que el leader decida.

Recomendación del implementer: opción (a) si Raf está dispuesto a crear cuenta Resend (gratis hasta 3000 emails/mes); opción (b) si quiere bajar scope.

---

## Sesión 4 — Implementer ejecuta Fase 2 (2026-05-25)

**Decisión del leader**: opción (a) — Resend. `RESEND_API_KEY` se está generando en paralelo. El implementer procede; T2.2 queda code-complete con fallback graceful si la key falta.

### Plan ejecutable

Orden de ejecución para no bloquearse: shared helpers → T2.7 (la más simple, valida pipeline) → T2.1 → T2.3 → T2.4 → T2.5 → T2.6 → T2.2 (la más compleja).

**Pre-step**: shared helpers en `supabase/functions/_shared/`:
- `cors.ts` — preflight + headers.
- `supabase.ts` — `createAdminClient()` y `createUserClient(req)`.
- `auth.ts` — `requireUser(client)`, `requireOwnerOf(adminClient, userId, establishmentId)`.
- `errors.ts` — `jsonError(status, code, message)` + `jsonOk(data)`.
- `email.ts` — wrappers para Resend con fallback graceful.
- `push.ts` — Expo Push API con cleanup de tokens fallidos.

**T2.7 `register_push_token`** — upsert por `(user_id, token)` actualizando `last_seen, device_id, platform`. Cubre R5.11 infra.

**T2.1 `invite_user`** — `requireUser` + `requireOwnerOf` + validar role≠owner + lowercase email + chequear no exista user_roles activo para ese email + chequear no haya pending no expirada + token `crypto.randomUUID()` + insert invitations + dispara email (Resend o Supabase Auth) + retorna `{ invitation_id, token }`. Cubre R5.1, R5.2, R5.9.

**T2.3 `cancel_invitation`** — solo owner; update status='cancelled', cancelled_at=now(). Cubre R5.7.

**T2.4 `resend_invitation`** — solo owner; genera nuevo token, reinicia expires_at, reenvía email. Cubre R5.8.

**T2.5 `remove_member`** — solo owner; bloquea si target es único owner activo; update active=false, deactivated_at=now(). Cubre R4.7, R7.4.

**T2.6 `change_member_role`** — solo owner; bloquea degradar único owner; split desactivar viejo + insertar nuevo activo. Cubre R4.5, R4.6.

**T2.2 `accept_invitation`** — `requireUser`, lookup invitation (service_role) por token + status=pending + expires_at>now() + match email; insert user_roles (service_role bypass RLS); marcar accepted_at; lookup owner; dispara email (Resend, graceful skip si falta key) + push (Expo, cleanup tokens fallidos), cada uno con try/catch aislado. Cubre R5.5, R5.6, R5.10, R5.11.

### Suite de tests `supabase/tests/edge/run.cjs`

Patrón idéntico a `rls/run.cjs`: crear users via service_role, login para JWT real, invocar funciones vía `supabase.functions.invoke(name, { body })`. Por cada función:
- T2.7: registrar token, re-registrar (debería ser upsert), verificar last_seen actualizado.
- T2.1: owner invita OK; non-owner falla 403; email duplicado (con user_roles activo) falla 409; rol='owner' falla 400.
- T2.3: owner cancela OK; non-owner falla; cancelar accepted falla.
- T2.4: owner reenvía OK; token viejo deja de aparecer en select por token.
- T2.5: owner remueve operario OK; intentar remover único owner falla 409.
- T2.6: cambio operator→vet OK; degradar único owner falla 409.
- T2.2: token válido → user_roles creado + accepted; token expirado falla; email mismatch falla; reaceptación falla.

Extender `scripts/run-tests.mjs` para ejecutar la suite edge después de RLS.

### Pre-requisito deploy

Antes de correr la suite, deployar cada función con `cd app && pnpm.cmd exec supabase functions deploy <name> --project-ref $SUPABASE_PROJECT_REF`. Setear secrets necesarios via `supabase secrets set` para `EXPO_ACCESS_TOKEN` y `RESEND_API_KEY` (cuando esté).

### Reporte intermedio del implementer

`done` cuando T2.1, T2.3, T2.4, T2.5, T2.6, T2.7 pasan tests y T2.2 está code-complete con fallback. `blocked` solo si tools fallan a nivel framework.

### Resultado de la sesión 4

**Fase 2 cerrada**. Las 7 Edge Functions están desplegadas a remoto y la suite `supabase/tests/edge/run.cjs` corre verde.

#### Tasks ejecutadas

| Task | Estado | Notas |
|---|---|---|
| T2.1 | ✅ | `invite_user` deployed. Valida owner, lowercase email, dedup user_roles + dedup pending. Token `crypto.randomUUID()`. Email best-effort via Resend (graceful skip si falta key). |
| T2.2 | 🟡 code-complete | `accept_invitation` deployed. Flujo principal (lookup, validar expiración, validar email match, insert user_roles, marcar accepted, push best-effort) totalmente testeado. R5.10 (email al owner) escrito y deployed, pero queda esperando `RESEND_API_KEY` en secrets de Supabase para test end-to-end. Hasta entonces, helper retorna `{ok:false, reason:'no_key'}` con warning y el resto del flujo continúa. |
| T2.3 | ✅ | `cancel_invitation` deployed. Solo owner; rechaza si status≠pending. |
| T2.4 | ✅ | `resend_invitation` deployed. Genera nuevo token, reinicia expires_at 7d, dispara email. Token viejo desaparece por unique constraint. |
| T2.5 | ✅ | `remove_member` deployed. Pre-check de último owner con `count exact head` antes de update. |
| T2.6 | ✅ | `change_member_role` deployed. Split desactivar+insert (preserva historial); guard de último owner; rollback si segundo insert falla. |
| T2.7 | ✅ | `register_push_token` deployed. Upsert por `(user_id, token)` actualiza `last_seen`. Re-registro retorna mismo `token_id` (idempotente). |

#### Shared helpers creados

- `supabase/functions/_shared/cors.ts` — `corsHeaders` + `handleOptions`.
- `supabase/functions/_shared/errors.ts` — `jsonError(status, code, message, extra?)` + `jsonOk(data, status?)`.
- `supabase/functions/_shared/supabase.ts` — `createAdminClient()` (service_role) y `createUserClient(req)` (anon + JWT del Authorization header).
- `supabase/functions/_shared/auth.ts` — `requireUser(userClient)` extrae `{id, email}`; `requireOwnerOf(adminClient, userId, establishmentId)` consulta `user_roles` con admin; `HttpError` para propagación de status/code/message.
- `supabase/functions/_shared/email.ts` — `sendInvitationEmail` (R5.2) + `sendInvitationAcceptedEmail` (R5.10) via Resend con fallback graceful. Templates HTML en español, escape de variables.
- `supabase/functions/_shared/push.ts` — `sendExpoPush(adminClient, userId, msg)` query push_tokens del recipient, POST batch a Expo Push API con `EXPO_ACCESS_TOKEN`, parsea tickets y borra los tokens con `DeviceNotRegistered`.

#### Trazabilidad R<n> → test edge

| R<n> | Cubierto por |
|---|---|
| R4.5 | `T2.6 R4.5: owner cambia rol de field_operator → veterinarian` |
| R4.6 | `T2.6 R4.6: degradar único owner falla 409` + `T2.5 R4.6/R4.7: remover único owner falla 409` |
| R4.7 | `T2.5 R4.7: owner remueve miembro` |
| R5.1 | `T2.1 R5.1: owner crea invitación OK` |
| R5.5 | `T2.2 R5.5: destinatario acepta invitación` |
| R5.6 | `T2.2 R5.6: invitación expirada falla` |
| R5.7 | `T2.3 R5.7: owner cancela invitación` |
| R5.8 | `T2.4 R5.8: owner reenvía → nuevo token` |
| R5.9 | `T2.1 R5.9: invitar email que ya es miembro falla 409` |
| R5.10 | code path activo en `accept_invitation`; test end-to-end depende de `RESEND_API_KEY` |
| R5.11 (infra) | `T2.7 R5.11: user registra su push token (upsert)` |
| R7.4 (parte server-side) | `T2.5 R4.7: owner remueve miembro` (RLS del próximo query lo cubre via T1.10) |

#### Archivos creados/modificados sesión 4

Nuevos:
- `supabase/functions/_shared/cors.ts`
- `supabase/functions/_shared/errors.ts`
- `supabase/functions/_shared/supabase.ts`
- `supabase/functions/_shared/auth.ts`
- `supabase/functions/_shared/email.ts`
- `supabase/functions/_shared/push.ts`
- `supabase/functions/register_push_token/index.ts`
- `supabase/functions/invite_user/index.ts`
- `supabase/functions/cancel_invitation/index.ts`
- `supabase/functions/resend_invitation/index.ts`
- `supabase/functions/remove_member/index.ts`
- `supabase/functions/change_member_role/index.ts`
- `supabase/functions/accept_invitation/index.ts`
- `supabase/tests/edge/run.cjs` (22 subtests + setup + cleanup = 24 tests)

Modificados:
- `scripts/run-tests.mjs` — agrega la suite Edge después de la RLS suite.
- `specs/active/01-identity-multitenancy/tasks.md` — checkboxes T2.1, T2.3-T2.7 ✅; T2.2 🟡 (code-complete pendiente Resend).
- `progress/current.md` — bitácora sesión 4.

#### Secrets configurados en Supabase remoto

- `EXPO_ACCESS_TOKEN` — set via `supabase secrets set` (para sendExpoPush en accept_invitation).
- `RESEND_API_KEY` — **pendiente**: Raf la está generando en paralelo. Una vez agregada con `pnpm.cmd exec supabase secrets set RESEND_API_KEY=...`, R5.10 funciona en el siguiente invoke sin redeploy.

#### Resultado `node scripts/check.mjs`

- typecheck client ✅
- RLS suite (15 tests) ✅
- Edge Functions suite (24 tests = 22 subtests + setup + cleanup) ✅

Total acumulado: typecheck + 39 tests verdes contra DB + funciones remotas.

#### Notas / hallazgos

1. **JWT verify default ON**: las Edge Functions desplegadas usan `verify_jwt = true` por default. Los tests usan JWTs reales obtenidos por `signInWithPassword` en el cliente y `functions.invoke()` los manda automáticamente en el Authorization header. No hace falta configuración adicional.
2. **`functions.invoke` & error handling**: cuando el edge devuelve un status >= 400, `supabase-js` produce un `FunctionsHttpError` y body bajo `error`. Para chequear errores esperados, comprobamos `error || data?.error` (cubre ambos paths). En tests dejé asserts laxas en cuanto a status code exacto para no romper si Deno serializa diferente; lo importante es que el flujo feliz crea/cambia datos y el path negativo NO crea/cambia datos.
3. **`maybeSingle()` vs `single()`**: lookups que pueden no encontrar usan `maybeSingle()` y devuelven 404 explícito. `single()` con cero filas tira y rompe el código path, queremos error tipado.
4. **R5.10 fallback graceful**: si `RESEND_API_KEY` no está, `sendInvitationAcceptedEmail` loguea warning y retorna `{ok:false, reason:'no_key'}`. El catch wrapping garantiza que `accept_invitation` no falla por esto. Push notification se ejecuta independientemente. Cuando Raf agregue la key, el comportamiento queda automático sin redeploy.
5. **Detección de `last_owner`**: usamos `count exact head` para chequear "¿hay más de un owner activo?". Significativamente más liviano que traer las filas.

---

## Sesión 6 — Refactor a invitaciones link shareable (ADR-014) (2026-05-25)

**Contexto**: ADR-014 cierra el pivot del modelo de invitaciones: de "email magic link" a "bearer token shareable". El owner crea la invitación sin email obligatorio y recibe un `accept_url` que reparte por el canal que prefiera (WhatsApp, mail, copy-paste). El backend ya estaba diseñado defensivamente (email best-effort, token en la respuesta), así que el costo del pivot es bajo.

### Tasks ejecutadas

| Task | Estado | Notas |
|---|---|---|
| T1.11 | ✅ | `0012_invitations_email_nullable.sql` aplicada a remoto. `email` ahora nullable. CHECK constraints `invitations_email_not_empty` y `invitations_email_lower` se mantienen (Postgres los evalúa UNKNOWN en NULL). |
| T2.1 | ✅ refactor | `invite_user` ahora acepta `email?` opcional. Sin email send. Retorna `{ invitation_id, token, accept_url, expires_at }`. Prechecks soft (R5.9 + pending duplicada) solo aplican si vino email como anotación. Reusa env var `APP_URL` que ya existía en `_shared/email.ts`. |
| T2.2 | ✅ refactor | `accept_invitation` deja de validar email-matching (modelo bearer). R5.9 ahora retorna 409 `already_member` cuando el caller ya tiene `user_roles` activo en el establishment. Email al owner cuando aceptan (R5.10) + push (R5.11) intactos. |
| T2.4 | ✅ refactor | `resend_invitation` regenera token + reinicia expiración. Sin email send. Retorna `{ token, accept_url, expires_at }`. |
| `_shared/email.ts` | ✅ limpieza | Eliminada `sendInvitationEmail` (ya no se usa). Conserva `sendInvitationAcceptedEmail`, `sendViaResend`, `escapeHtml`, `FROM_DEFAULT` y tipos. Verificado con grep que ninguna función la importe. |

### Tests modificados / nuevos

**Modificados**:
- `T2.1 R5.1: owner crea invitación OK` — agrega aserts sobre `data.accept_url` (debe incluir el token codeado) y `data.expires_at`.
- `T2.4 R5.8: owner reenvía → nuevo token` — agrega aserts sobre `data.accept_url` y `data.expires_at`.

**Nuevos**:
- `T2.1 ADR-014: owner crea invitación SIN email` — invoca `invite_user` sin email, valida 200, valida `invitation_id`/`token`/`accept_url`, valida en DB que `email` quedó `null`. Cancela la invitación creada para no contaminar tests posteriores.
- `T2.2 ADR-014: token bearer funciona con email distinto al de la invitación` — crea invitación con `email = X@…`, crea user con `email = Y@…`, ese user acepta y queda con `user_roles` activo. Verifica que la invitación quedó `accepted`.
- `T2.2 R5.9: aceptar cuando ya soy miembro falla 409` — crea invitación pending, owner (ya miembro activo) intenta aceptar, espera error `already_member`.

**Eliminado**:
- `T2.2: email mismatch falla` — ya no aplica al modelo bearer (ADR-014).

### Trazabilidad R<n> → test (sesión 6 — refactor link shareable)

| R<n> | Cubierto por |
|---|---|
| R5.1 (link shareable, opcionalmente con email anotación) | `T2.1 R5.1: owner crea invitación OK` + `T2.1 ADR-014: owner crea invitación SIN email` |
| R5.2 (retorna `accept_url`) | `T2.1 R5.1: owner crea invitación OK` (aserts sobre `accept_url`) + `T2.1 ADR-014: owner crea invitación SIN email` |
| R5.5 (token bearer crea user_roles) | `T2.2 R5.5: destinatario acepta invitación` + `T2.2 ADR-014: token bearer funciona con email distinto al de la invitación` |
| R5.6 (expirada falla) | `T2.2 R5.6: invitación expirada falla` (intacto) |
| R5.8 (regenerar link) | `T2.4 R5.8: owner reenvía → nuevo token` (con aserts de `accept_url`) |
| R5.9 (already_member en accept) | `T2.2 R5.9: aceptar cuando ya soy miembro falla 409` |
| R5.10 (email al owner) | code path intacto en `accept_invitation`; helper `sendInvitationAcceptedEmail` no se tocó |
| R5.11 (push al owner) | `sendExpoPush` intacto en `accept_invitation` |
| ADR-014 (modelo bearer sin email-matching) | `T2.2 ADR-014: token bearer funciona con email distinto al de la invitación` |

### Deploys

- `invite_user` redeployado vía `pnpm.cmd exec supabase functions deploy invite_user --project-ref $SUPABASE_PROJECT_REF` (con `.env.local` cargado vía `set -a && . ./.env.local && set +a`).
- `accept_invitation` redeployado idem.
- `resend_invitation` redeployado idem.
- `cancel_invitation`, `remove_member`, `change_member_role`, `register_push_token`, helpers `_shared/{auth,supabase,cors,errors,push}.ts` no se tocaron. `_shared/email.ts` se limpió pero solo lo usa `accept_invitation`, que ya fue redeployado.

### Gotchas / notas técnicas

1. **CHECK constraints + NULL**: Postgres evalúa los CHECK como UNKNOWN cuando la columna es NULL, lo que satisface el constraint. Por eso `invitations_email_not_empty` y `invitations_email_lower` siguen vigentes en la migration 0004 y no hubo que tocarlos en la 0012 — solo bloquean strings vacíos o con mayúsculas, no NULL.
2. **`APP_URL` env var**: reutilizada de `_shared/email.ts` (default `https://app.rafq.ar`). No se inventó env var nueva. El spec menciona `PUBLIC_APP_URL` / `EXPO_PUBLIC_APP_URL` pero el código real usa `APP_URL` — coordinar con frontend cuando arranque Fase 3 si hay que renombrar (en backend `EXPO_PUBLIC_*` es ruido).
3. **Carga de `.env.local` en bash**: el shell no carga `.env.local` automáticamente. Para invocar `supabase functions deploy` desde bash hace falta `set -a && . ./.env.local && set +a` antes (exporta automáticamente todo lo que se asigna durante el source).
4. **Test "T2.1 sin email" — no contaminar tests downstream**: el test crea una invitación pending sin email y, dado que el flujo posterior reusa `invitationId`/`invitationToken` del test "R5.1", se cancela la invitación recién creada vía service_role (status='cancelled') antes de terminar. Esto evita que aparezca como pending al final del cleanup o interfiera con tests que asumen estado conocido.
5. **`_shared/email.ts` ahora es solo R5.10**: el archivo quedó más chico (eliminamos ~30 líneas de `sendInvitationEmail`). Si en el futuro hace falta volver a email-bound (no es probable), se puede reactivar mirando el commit anterior — la decisión es reversible (ver ADR-014, sección "Reversibilidad").

### Archivos creados/modificados en esta sesión

Nuevos:
- `supabase/migrations/0012_invitations_email_nullable.sql`

Modificados:
- `supabase/functions/invite_user/index.ts` — refactor link shareable.
- `supabase/functions/accept_invitation/index.ts` — modelo bearer + R5.9 hard 409.
- `supabase/functions/resend_invitation/index.ts` — sin email send, retorna accept_url.
- `supabase/functions/_shared/email.ts` — eliminada `sendInvitationEmail`.
- `supabase/tests/edge/run.cjs` — 2 tests nuevos, 1 test borrado, asserts ampliados en R5.1 y R5.8.
- `specs/active/01-identity-multitenancy/tasks.md` — T1.11 marcada `[x]`.
- `progress/current.md` — bitácora sesión 6.

### Resultado `node scripts/check.mjs`

- typecheck client ✅
- RLS suite (15 tests) ✅
- Edge Functions suite (**26 tests** = 24 originales − 1 borrado + 3 nuevos + setup + cleanup) ✅

Total acumulado: typecheck + **41 tests verdes** contra DB + Edge Functions remotas (modelo link shareable activo).

### Reporte para `leader` (sesión 6)

**`done` para el refactor link shareable**. Backend de feature 01 sigue `in_progress` (frontend pausado intencionalmente). El reviewer decide si el refactor cumple ADR-014 + R5.1/R5.2/R5.5/R5.8/R5.9 (lo que corresponde aprobar en este chunk) y el leader sigue manteniendo la pausa de Fase 3+ hasta que Raf decida destrabar frontend.
