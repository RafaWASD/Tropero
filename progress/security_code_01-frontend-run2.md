# Security Code Review — spec 01 frontend Run 2 (pulido)

- **Modo**: `code` (Gate 2)
- **Baseline**: `4728a7b` (working tree sin commitear; `git diff --name-only 4728a7b..HEAD` vacío → todo está sin commitear)
- **Veredicto**: **PASS — 0 HIGH**
- **Fecha**: 2026-05-31

## Resumen

Run 2 es pulido de frontend (cliente Expo, `app/`): subtítulo de desambiguación, banner per-campo persistido, micro-feedback, pill nav, hint de nombre duplicado, y la sincronización del `name` en el metadata de Auth. **No introduce ninguna query nueva a Supabase**, no toca migrations/RLS/Edge Functions, y todo el dato nuevo que se renderiza ya estaba en el contexto del propio usuario (memberships RLS-scoped). El único cambio con superficie server es `supabase.auth.updateUser({ data: { name } })` — verificado como benigno (ver abajo). **No hay findings HIGH.**

## Archivos analizados (en scope, sin commitear)

- `app/src/services/establishments.ts` — `saveProfile` ahora hace `auth.updateUser({ data: { name } })`
- `app/src/services/establishment-store.ts` — persistencia local de banners descartados
- `app/src/utils/establishment.ts` — helpers puros (`localityOf`, `roleLabel`, `hasDuplicateName`, `shouldShowReadyBanner`)
- `app/app/(tabs)/index.tsx`, `app/app/(tabs)/_layout.tsx` — UI home + nav
- `app/src/components/EstablishmentSwitcherDropdown.tsx`, `EstablishmentCard.tsx` — subtítulo localidad·rol
- `app/app/crear-campo.tsx`, `editar-campo.tsx` — hint de duplicado
- `app/app/mis-campos.tsx` — pasa `locality` a la card
- `app/src/components/index.ts`, `app/src/utils/establishment.test.ts` — barrel + tests

Fuera de scope (otra terminal, no auditado): `scripts/check.mjs`, `.claude/settings.json`, `specs/active/04-bluetooth-baston/field-findings.md`.

## Modelo de amenaza chequeado (multi-tenant + privilege)

### 1. ¿`updateUser({ data: { name } })` permite escalada de privilegios? → NO (benigno)

El concierne central. Verificado contra el código de autorización real:

- **`data` mapea a `user_metadata`**, no a `app_metadata`. `app_metadata` (el privilegiado) NO es escribible desde el cliente vía `updateUser` — requiere service_role. El cliente solo puede tocar su propio `user_metadata`.
- **El objeto literal es fijo `{ name }`** (`establishments.ts`, donde `name = input.name.trim()`). No hay spread de input ni keys atacante-controladas extra → no se puede inyectar otra cosa que `name`.
- **El backend NO usa `user_metadata`/`app_metadata` para autorización.** Verificado:
  - Helpers RLS `has_role_in` / `is_owner_of` (`supabase/migrations/0005_rls_helpers.sql:9,31`) derivan SOLO de `public.user_roles` + `auth.uid()` (el subject del JWT, server-validado, no editable por el cliente). No leen metadata.
  - Edge Functions: `requireUser` (`supabase/functions/_shared/auth.ts:9`) saca identidad de `getUser()` (JWT); `requireOwnerOf` (`auth.ts:30`) chequea la tabla `user_roles`. Ninguna función lee `user_metadata`/`app_metadata` para decidir permisos (`change_member_role`, `remove_member`, etc. comparan `targetRole.role` que viene de la DB, no del metadata).
  - El único read server-side de `raw_user_meta_data` es el trigger de signup `handle_new_auth_user` (`0001_users.sql:58`), que corre **solo `AFTER INSERT on auth.users`** (alta de cuenta) para sembrar `public.users.name`. `updateUser` ocurre DESPUÉS del alta → no re-dispara el trigger → no puede reescribir `public.users.name` ni nada de roles.
- **Conclusión**: el cliente solo puede cambiar su propio nombre de display (el saludo). No hay claim que el backend confíe para autz. No es HIGH ni MEDIUM.

### 2. ¿Alguna lectura/escritura nueva que escape RLS o muestre datos de otro tenant? → NO

`locality`, `role`, `recents` y la lista para detectar duplicados salen TODOS de `estState.current` y `recents` del `useEstablishment` context. Esos provienen de `loadMemberships` (`establishments.ts:48`), que consulta `user_roles` con `.eq('active', true).eq('user_id', userId)` join a `establishments` — doblemente acotado: por el filtro explícito de `user_id` Y por RLS server-side (`user_roles_select` + `establishments_select` vía `has_role_in`). **Run 2 no agrega ninguna query nueva** — los componentes solo mapean dato ya cargado del propio usuario. El subtítulo `city·province·rol` y el chequeo de duplicados operan exclusivamente sobre campos donde el usuario tiene rol activo → imposible revelar la existencia de campos ajenos.

### 3. ¿`establishment-store` filtra algo sensible o escapa el scope por-usuario? → NO

`addDismissedBanner` / `loadDismissedBanners` guardan solo una lista de `establishmentId` (UUIDs de campos del propio usuario) bajo la key `rafq.banner_dismissed.<safeUser(userId)>`. `safeUser` sanea el `userId` (`[^A-Za-z0-9._-] → _`). No se persiste PII, ni nombre, ni token. Almacenamiento web=localStorage / native=SecureStore — coherente con el trail existente. La key es per-usuario; no hay cross-user leak (los UUIDs no son secretos y ya son visibles al usuario en su propia sesión). Sin hallazgo.

## Findings HIGH de Sentry

Ninguno. No se invocó `sentry-skills:security-review` sobre el diff porque el cambio no contiene patrones de inyección/auth/crypto que la skill cubra: es UI + helpers puros + persistencia de UUIDs propios + una llamada `updateUser` con objeto literal fijo. El vector candidato (escritura de metadata) se validó manualmente contra el modelo de autz real y resultó benigno. No hay superficie donde la skill aportaría señal adicional.

## Findings RAFAQ-SPECIFIC

Ninguno.

## False positives potenciales descartados (trazabilidad)

- **`auth.updateUser` deja al cliente escribir metadata de Auth** → descartado: `app_metadata` no es escribible desde cliente; el backend (RLS helpers + Edge Functions) no consulta metadata para autz; el objeto está fijo a `{ name }`. Es display-only.
- **Subtítulo `localidad·rol` podría exponer datos de otros campos** → descartado: solo renderiza campos del propio set RLS-scoped (memberships del usuario).
- **Hint de nombre duplicado podría revelar campos ajenos** → descartado: compara solo contra `recents` (campos accesibles del propio usuario), no contra el universo de campos.

## Cobertura indirecta (advertencia)

La skill de Sentry no cubre nativamente Deno/RLS/PowerSync/React Native. En este Run la revisión crítica fue **manual** sobre el modelo multi-tenant (RLS helpers + Edge Functions + trigger de signup) — que es donde vivía el único riesgo real (privilege via metadata) y quedó descartado con evidencia. No queda dominio crítico sin revisar para este diff.
