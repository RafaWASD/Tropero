# Sesión actual

> Este archivo se vacía al cerrar cada sesión y se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

- **Feature en curso:** `01-identity-multitenancy`
- **Inicio:** 2026-05-25
- **Agente:** `implementer` (lanzado por `leader`)

## Plan

Spec aprobado por Raf el 2026-05-25. Decisiones cerradas durante la sesión de refinamiento:

- Sin `user_type` en MVP — solo `user_roles`.
- Onboarding con CTA dual (wizard "crear mi primer campo" + "compartir mi email").
- Teléfono obligatorio al crear establecimiento (no en signup) — `R3.8` nuevo.
- Notificación al owner cuando aceptan: email + push — `R5.10` / `R5.11` nuevos.
- Hard-delete diferido hasta requerimientos SENASA.
- Sin flujo de transferencia de ownership en MVP (debe soft-deletear el campo primero).
- Push notifications dentro de MVP por estrategia de diferenciación competitiva.

Setup humano completado:
- Supabase project `rafaq-mvp` creado (region: `sa-east-1`, ref: `xrhlxxdnfzvdnztacofj`).
- Configuración de seguridad: Data API ON, Auto-expose OFF, Auto RLS ON.
- Keys persistidas en `.env.local` (excluido de git por `.gitignore`).

Implementer ejecuta `tasks.md` en orden:
- Fase 0 (T0.1-T0.4) — Setup: Supabase CLI, Expo, Supabase Notifications.
- Fase 1 (T1.1-T1.10) — Schema + RLS + tests pgTAP.
- Fase 2 (T2.1-T2.7) — Edge Functions.
- Fase 3 (T3.1-T3.6) — Auth cliente.
- Fase 4 (T4.1-T4.5) — Establecimientos.
- Fase 5 (T5.1-T5.6) — Invitaciones y miembros.
- Fase 6 (T6.1-T6.3) — Perfil.
- Fase 7 (T7.1-T7.3) — PowerSync.
- Fase 8 (T8.1-T8.3) — QA y cierre.

## Bitácora

- `2026-05-25` — leader bumpea `feature_list.json` `spec_ready → in_progress` y lanza implementer.
- `2026-05-25` — implementer arranca. T0.1 ya completado por humano. Plan detallado en `progress/impl_01-identity-multitenancy.md`. Decide layout `app/` (subdirectorio) para T0.2.
- `2026-05-25` — implementer ejecuta T0.2 con `npx create-expo-app app --template blank-typescript --no-install --yes`. Scaffold creado OK. Limpia archivos colisionados del template (`.git/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `LICENSE` dentro de `app/`). Renombra a `rafaq-app`, configura scheme `rafq` y bundle `ar.rafq.app`.
- `2026-05-25` — implementer intenta `npm install` en `app/`. **Falla con `Z_DATA_ERROR` / `zlib: incorrect data check`**. Probable Cylance o proxy corporativo corrompiendo respuestas gzip del registry. Repetido con cache limpia, falla con paquetes distintos.
- `2026-05-25` — implementer reporta `blocked` con cuatro bloqueos: T0.3 (login Supabase), T0.4 (cuenta Expo), T0.4 (depende npm), npm install (Z_DATA_ERROR). Detalle completo en `progress/impl_01-identity-multitenancy.md`.
- `2026-05-25` — Raf flaguea preocupación por ataques de cadena de suministro en npm (shai-hulud, @ctrl/tinycolor). Leader propone migrar a pnpm; Raf aprueba. Cambios aplicados por leader: `app/.npmrc` con `node-linker=hoisted` + `side-effects-cache=true`, `app/package.json` con `pnpm.onlyBuiltDependencies` whitelisteando paquetes Expo, `.harness/config.json` `testCommand` apunta a `pnpm`, `tasks.md` T0.2 reescrita para pnpm, `design.md` con sección "Package manager", `docs/adr/ADR-011-package-manager-pnpm.md` creado. Memoria del proyecto actualizada.
- `2026-05-25` — `scripts/check.mjs` actualizado para hacer `chdir` a la raíz del repo al arrancar, funciona desde cualquier directorio.
- `2026-05-25` — Raf genera `SUPABASE_ACCESS_TOKEN` y crea cuenta Expo + `EXPO_ACCESS_TOKEN`. Ambos en `.env.local`.
- `2026-05-25` — Primer intento de `pnpm install` falla con `ENOTFOUND proxybpa.bancopatagonia.net.ar` (proxy corporativo de Banco Patagonia inalcanzable fuera de su red). Raf usa script propio "Sesion sin proxy" para limpiar config.
- `2026-05-25` — Segundo intento bloquea por PowerShell Execution Policy (`pnpm.ps1` no carga, probable Cylance Script Control). Workaround: usar `pnpm.cmd install` en lugar de `pnpm install`.
- `2026-05-25` — **`pnpm.cmd install` ÉXITO**: 466 paquetes instalados en 28s, cero `Z_DATA_ERROR`. `msgpackr-extract` reportó build script bloqueado por no estar en `pnpm.onlyBuiltDependencies` — comportamiento defensivo esperado, no se whitelistea (msgpackr tiene fallback JS).

## Bitácora — sesión 2 (continuación implementer)

- `2026-05-25` — implementer relanzado. Cierra T0.2: `pnpm.cmd add` de deps de spec OK (10 paquetes); estructura `app/src/{...}/` creada con placeholders; `App.tsx` reescrito con splash "Hola RAFAQ"; helper `src/utils/env.ts` lee `EXPO_PUBLIC_*` con fallback a `Constants.expoConfig.extra`; typecheck verde.
- `2026-05-25` — `.harness/config.json` `testCommand` apunta a `node scripts/run-tests.mjs` (typecheck + suite RLS); harness check verde.
- `2026-05-25` — T0.3: Supabase CLI 2.101.0 instalado como devDep de `app/` (binario via `@supabase/cli-windows-x64`); `supabase` agregado a `pnpm.onlyBuiltDependencies`. `supabase init` + `supabase link --project-ref xrhlxxdnfzvdnztacofj` ejecutados con `SUPABASE_ACCESS_TOKEN` de `.env.local`. `supabase/config.toml` generado, `supabase/.temp/project-ref` linkeado. `supabase db push --include-all` corre limpio.
- `2026-05-25` — T0.4 parcial: plugin `expo-notifications` con permisos iOS/Android en `app.json`; helper tipado `src/services/push-notifications.ts` con typed failure modes. Verificación end-to-end con device real queda pendiente para T3.6.
- `2026-05-25` — Fase 1 completa: 9 migrations base (`0001`-`0009`) aplicadas a remoto + 2 extra (`0010_grants_fix.sql`, `0011_establishment_auto_owner.sql`). Schema: `public.users` + trigger desde auth.users, `establishments`, `user_roles` (enum + unique parcial active), `invitations` (enum status + check role≠owner), helpers `has_role_in`/`is_owner_of`, policies de los 4 dominios, `push_tokens` con RLS self-only.
- `2026-05-25` — Hallazgo crítico de RLS: `insert(establishment).select()` falla con 42501 porque PostgREST evalúa la SELECT policy del RETURNING en el mismo statement, antes de que el trigger AFTER INSERT haya creado `user_roles` (o sin verlo por timing de snapshot). Patrón documentado en `progress/impl_01-identity-multitenancy.md`: el cliente debe hacer insert + select separado, o usar Edge Function. Test usa el patrón split.
- `2026-05-25` — T1.10: suite de tests RLS en Node nativo (`node:test` + `supabase-js` + `ws` para realtime transport en Node 20). 15 subtests cubren aislamiento cross-tenant, owner-vs-operator, soft-delete, push_tokens. Cleanup automático. Todos pasan.
- `2026-05-25` — `node scripts/check.mjs` verde: typecheck + 15 tests RLS. Implementer cierra esta sesión con **Fase 0 + Fase 1 done**; Fases 2-8 quedan pendientes (Edge Functions + cliente entero + PowerSync + QA).

## Próximo paso

Leader decide:
- (a) Relanzar implementer para Fase 2 (Edge Functions: invite_user, accept_invitation con email + push, etc.).
- (b) Mantener feature `in_progress`, considerarlo milestone parcial.
- (c) Reformular la spec en chunks más chicos (la spec original era ambiciosa; podría dividirse en sub-features identity-core / invitations / push-notifs / powersync).

Decisiones documentadas durante la sesión a considerar para ADR-012 (si Raf aprueba):
1. Trigger `handle_new_establishment` en lugar de Edge Function `create_establishment` para R3.2.
2. Suite RLS en Node + supabase-js, no pgTAP local (Docker no requerido).
3. Supabase CLI como devDep npm en lugar de instalación nativa (Scoop/winget bloqueados por entorno corporativo).

Nota crítica para el implementer: en PowerShell usar `pnpm.cmd` (no `pnpm`) porque Cylance bloquea la ejecución de scripts `.ps1`. En Bash funciona `pnpm` directo.

## Bitácora — sesión 4 (implementer Fase 2)

- `2026-05-25` — implementer relanzado para Fase 2. Pre-flight: lectura completa de spec, ADR-011, ADR-012, progress, plan dejado por sesión 3. CLI accede a Supabase con `SUPABASE_ACCESS_TOKEN` de `.env.local` (`functions list` retorna 0 funciones desplegadas).
- Scope acordado con leader: T2.1, T2.3, T2.4, T2.5, T2.6, T2.7 cerradas con tests; T2.2 code-complete con fallback graceful por `RESEND_API_KEY` ausente.
- Decisión de producto del leader: email a owner en aceptación de invitación (R5.10) via Resend (`https://api.resend.com/emails` con `RESEND_API_KEY`). Sin paquetes npm en Edge Functions.
- `2026-05-25` — implementer escribe 6 shared helpers en `supabase/functions/_shared/` (cors, errors, supabase, auth, email, push) y las 7 Edge Functions. Despliega todas con `pnpm.cmd exec supabase functions deploy <name>`. Setea secret `EXPO_ACCESS_TOKEN` via `supabase secrets set`. Suite `supabase/tests/edge/run.cjs` con 22 subtests + setup + cleanup; corre verde contra remoto.
- `2026-05-25` — `node scripts/check.mjs` verde: typecheck client + 15 tests RLS + 24 tests Edge = 39 tests OK. Fase 2 cerrada por implementer; T2.2 espera `RESEND_API_KEY` para test end-to-end de R5.10. El resto del flujo de aceptación está testeado.
