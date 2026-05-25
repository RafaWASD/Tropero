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
