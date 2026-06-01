baseline_commit: 063ab798ef21a76a93d7071e1a8fd860e351de85

# Implementación — Fase 6 FRONTEND (perfil / cuenta)

Feature: `01-identity-multitenancy` (in_progress). Cubre el **frontend** de la Fase 6:
T6.1 (editar name/phone/email, R2.1/R2.2) + T6.3 frontend (eliminar cuenta, R2.4/R2.5/R2.5.1)
+ consolidación del saludo (ProfileContext, fuente única — fix prometido del greeting desync).

> Scope: SOLO frontend. NO toco el backend (RPC `delete_account_tx` migración 0058 + edge
> `supabase/functions/delete_account` ya están hechos y gateados; el deploy lo hace el leader).

## Baseline (Gate 2)

- `baseline_commit` = HEAD al iniciar este run de frontend = `063ab79` (mismo SHA que el run
  backend de Fase 6; el backend está en el working tree sin commitear). Gate 2 diffea el frontend
  desde acá. No se sobreescribe (multi-sesión).

## Plan (tasks de este run)

- **Pieza 1 — ProfileContext (fuente única del saludo)**
  - T-P1.a — `app/src/services/profile.ts`: `loadProfileNamePhone(userId)` (lee `public.users`
    id/name/phone). (Result tipado, reusa patrón de establishments.ts.)
  - T-P1.b — `app/src/contexts/ProfileContext.tsx`: `{ profile:{name,phone,email}, loading, error,
    refresh }`. name/phone de public.users; email del session de auth (AuthContext). Deps por
    PRIMITIVO (userId/email), sin loop de fetch. Export `useProfile()`.
  - T-P1.c — montar `<ProfileProvider>` dentro de `<AuthProvider>` (contexts/index.ts + _layout.tsx).
  - T-P1.d — home (`index.tsx`) y `onboarding.tsx` leen el saludo de `useProfile().profile.name`
    (no de AuthContext). Loading → fallback genérico (sin parpadear "Hola undefined").
  - T-P1.e — `saveProfile` en establishments.ts: SACAR `supabase.auth.updateUser({ data:{name} })`.
    Escribir SOLO public.users. (El saludo ahora lee public.users.)

- **Pieza 2 — Cambio de email (R2.1/R2.2)**
  - T-P2.a — `app/src/services/account.ts`: `changeEmail(newEmail)` (`auth.updateUser({email})`),
    Result tipado (ok / email_taken / invalid / network / unknown).
  - T-P2.b — `mas.tsx`: email EDITABLE en el form de perfil. Tras submit, estado claro "Te mandamos
    un mail a {nuevo}…". Display sigue mostrando el viejo (del session) hasta confirmar (R2.2 nativo).

- **Pieza 3 — Eliminar cuenta (R2.4/R2.5/R2.5.1)**
  - T-P3.a — `account.ts`: `deleteAccount()` vía `invokeFn` (reusa members.ts) → Result TIPADO:
    ok / already_deleted / sole_owner (con `establishments[]`) / network / unknown.
  - T-P3.b — `mas.tsx`: zona de peligro (terracota, al fondo) → "Eliminar cuenta" con DOBLE
    confirmación (no un solo alert). sole_owner → lista de campos bloqueantes con atajo a soft-delete
    por campo (reusa softDeleteEstablishment + warning de miembros R3.6.1) + reintentar. ok →
    signOut() + estado breve "cuenta eliminada" (RootGate rutea a auth).

- **Tests** (lógica pura, node:test — patrón del repo):
  - `app/src/services/account-result.test.ts`: mapeo del Result de deleteAccount (parseo del
    `establishments[]` del sole_owner, casos de error) + del changeEmail error-classify.
  - Trazabilidad en este archivo.

## Archivos creados / modificados

### Creados
- `app/src/services/profile.ts` — `loadProfileNamePhone(userId)` (lee name/phone de public.users).
- `app/src/contexts/ProfileContext.tsx` — `ProfileProvider` + `useProfile()`. Fuente única del
  saludo: name/phone de public.users, email del session de auth. Deps PRIMITIVAS (userId/email),
  guard de carga stale (loadSeq), value memoizado → sin loop de fetch.
- `app/src/services/account.ts` — `changeEmail(newEmail)` + `deleteAccount()` (I/O supabase-js).
- `app/src/utils/account-result.ts` — lógica PURA del mapeo (separada de account.ts para testear bajo
  node): `classifyAuthEmailError`, `parseBlockingEstablishments`, `mapDeleteAccountErrorBody`,
  `classifyDeleteNetworkError` + tipos `ChangeEmailResult`/`DeleteAccountResult`/`BlockingEstablishment`.
- `app/src/utils/account-result.test.ts` — 18 tests del mapeo (node:test).

### Modificados
- `app/src/contexts/index.ts` — re-export de `ProfileProvider`/`useProfile`/`Profile`.
- `app/app/_layout.tsx` — montado `<ProfileProvider>` DENTRO de `<AuthProvider>`, envolviendo a
  `<EstablishmentProvider>` + `<RootGate>` (home/onboarding consumen useProfile).
- `app/app/(tabs)/index.tsx` — saludo lee `useProfile().profile.name` (no AuthContext); loading →
  saludo neutro (sin parpadear "Hola undefined").
- `app/app/onboarding.tsx` — saludo lee `useProfile().profile.name`; loading → neutro.
- `app/src/services/establishments.ts` — `saveProfile` ya NO sincroniza name a auth.user_metadata
  (escribe SOLO public.users; el saludo lo lee de ahí vía ProfileContext). Comentario actualizado.
- `app/app/(tabs)/mas.tsx` — Perfil: email EDITABLE (`EmailChangeForm` + `changeEmail`); ProfileSection
  usa ProfileContext + refresh tras guardar. Zona de peligro (al fondo): `DeleteAccountSection` con
  doble confirmación + lista de campos bloqueantes (R2.5.1) reusando softDeleteEstablishment + retry.
- `scripts/run-tests.mjs` — agregado `account-result.test.ts` a la suite de client unit tests.
- `specs/active/01-identity-multitenancy/tasks.md` — T6.1 `[x]` + T6.3 frontend `[x]` (as-built).

## Verificación

- `cd app && pnpm.cmd typecheck` → **OK** (limpio).
- `node scripts/check-hardcode.mjs` → **OK** (0 violaciones en app/app + app/src/components).
- client unit tests → **124/124 pass** (incluye los 18 nuevos de account-result; +0 regresión).
- RLS suite → **17/17 pass** (sin regresión).
- Edge Functions suite → **8 fails ESPERADOS** en `delete_account` (T6.3): el edge NO está deployado
  al remoto (404 donde se esperaba 401/200) — eso lo hace el leader, NO es de mi trabajo. El resto del
  suite (27 pass) intacto. Mi frontend NO toca la suite edge. (Test 8 — RPC no invocable por
  authenticated — pasa porque la RPC tampoco existe → denegado.)

## Trazabilidad (R<n> → archivo:test)

- **R2.1 (editar name/phone/email)** →
  - name/phone: `app/src/utils/validation.test.ts::"R2.1 validateProfile..."` (validación, ya existía) +
    `app/app/(tabs)/mas.tsx` ProfileEditForm + `saveProfile` (establishments.ts).
  - email editable: `app/src/utils/account-result.test.ts::"changeEmail error: ..."` (5 casos del
    clasificador) + `mas.tsx` EmailChangeForm.
- **R2.2 (cambio de email → verificación, mantener viejo hasta confirmar)** →
  `app/src/services/account.ts::changeEmail` (delega a `auth.updateUser({email})` = doble-confirmación
  nativa de Supabase; el display lee el email del session = viejo hasta confirmar). Clasificación de
  errores cubierta en `account-result.test.ts`. (El comportamiento "mantener viejo" es nativo de
  Supabase; el cliente solo dispara y muestra el estado — verificado por razonamiento del flujo, no
  hay test de integración del lado server acá.)
- **R2.4 (eliminar cuenta, doble confirmación)** →
  `account-result.test.ts::"deleteAccount error: ..."` (mapeo del Result) + `mas.tsx`
  DeleteAccountSection (máquina idle→confirm→deleting→deleted; doble paso).
- **R2.5 (bloqueo único-owner)** →
  `account-result.test.ts::"deleteAccount error: 409 sole_owner..."` + `mas.tsx` rama `blocked`.
- **R2.5.1 (lista de campos bloqueantes + atajo a soft-delete)** →
  `account-result.test.ts::"...sole_owner → reason sole_owner + lista de campos (R2.5.1)"` +
  `"parseBlockingEstablishments: ..."` (4 casos) + `mas.tsx` `DeleteAccountSection.onSoftDeleteBlocking`
  (reusa `countActiveMembers` + `softDeleteEstablishment` + `confirmDestructive`, R3.6.1) + retry.

> Nota de cobertura: las 3 piezas son UI con estado + I/O de red (supabase-js/edge). La lógica PURA
> (mapeo de errores, parseo de la lista bloqueante) está testeada con node:test. La UI con estado y el
> wiring de ProfileContext (sin loop de fetch, refresh del saludo) se verifican por razonamiento del
> flujo + el oráculo de Raf en web (patrón del proyecto para flujos de render; ver current.md
> "Aprendizaje de proceso s21"). La suite e2e Playwright puede sumar cobertura de Fase 6 (pendiente
> de authoring, no bloquea).

## Autorrevisión adversarial (paso 8)

Pasada crítica buscando desviaciones del spec, bugs/edge-cases, gaps de seguridad/multi-tenant y tests
que pasan por la razón equivocada. Qué busqué / qué encontré / cómo cerré:

1. **Loop de fetch en ProfileContext (footgun de miembros.tsx, B.1.3 fix loop 2)** — Busqué deps de
   efecto por objeto. El efecto de carga depende de `[userId, loadFor]`, ambos estables (userId =
   primitivo del AuthState; `loadFor` = useCallback([])). El email se compone en el value memoizado,
   NO dispara recarga. **Sin loop.** ✓
2. **Saludo se actualiza tras editar el nombre** — Flujo: editar → `saveProfile` (public.users) →
   `onDone` llama `refresh()` del ProfileContext → re-lee public.users → `profile.name` cambia → la
   home (que lee `useProfile().profile.name`) re-renderiza. **Verificado por razonamiento.** Antes
   dependía del sync a auth-metadata (frágil, 2 fuentes); ahora una sola fuente. ✓
3. **¿Saqué de verdad el sync de auth-metadata y nada más lo necesita?** — Grep de `.user.name` /
   `user_metadata` / `toAuthUser`: los únicos consumidores de `AuthUser.name` son `toAuthUser`
   (sigue poblándolo, inofensivo) y el e2e helper (signup escribe metadata → trigger copia a
   public.users — ProfileContext lo lee bien). Home/onboarding ya NO leen de AuthContext. **Nada más
   dependía del sync.** ✓
4. **Parpadeo "Hola undefined"** — La home muestra saludo neutro mientras `profileLoading && !name`
   (`!profileLoading && userFirstName ? ... : '¡Hola! 👋'`). onboarding ídem. ✓
5. **sole_owner muestra la lista y permite reintentar** — Rama `blocked`: lista de campos con atajo
   a soft-delete por campo; al borrar, el campo sale de la lista (filter); "Reintentar baja" queda
   `disabled` hasta que la lista quede vacía → re-llama `deleteAccount`. ✓
6. **Cambio de email mantiene el viejo hasta confirmar** — `changeEmail` solo dispara
   `updateUser({email})`; el display lee `profile.email` = session.email (viejo hasta confirmar,
   nativo). Copy explícito: "...tu email sigue siendo {viejo}". ✓
7. **loading/error/sin-red en las 3 piezas** — Perfil: loading→"Cargando…", error sin perfil→retry,
   error transitorio NO tumba el perfil cargado. Email: field/submit errors + network→OFFLINE_COPY.
   Eliminar: network→OFFLINE_COPY, unauthorized→"sesión expiró", unknown→genérico; fail-closed (nunca
   muestro "deleted" salvo `result.ok`). ✓
8. **Tests que pasan por la razón equivocada** — Los 18 tests ejercen el clasificador real con shapes
   reales del contrato del edge (sole_owner con/ sin establishments, 401, db_error, network, body
   nulo). El test de sole_owner verifica que la LISTA se parsea (no solo el code). ✓
9. **IDOR / identidad** — `deleteAccount()` invoca el edge con body `{}` (sin user_id) → identidad
   solo del JWT (D5 del contrato). No hardcodeo establishment_id ni user_id en ningún lado. ✓
10. **Multi-tenant** — Reuso `softDeleteEstablishment` (RLS owner-only) y `countActiveMembers` (RLS
    owner-céntrica) ya gateados; no agrego queries cross-tenant. La lista de bloqueantes viene del
    edge (server-side), no la fabrica el cliente. ✓

### Edge conocido (documentado, NO bug)
- **Reintentar baja cuando el campo bloqueante es el ACTIVO**: soft-deletear el campo activo dispara
  `active_lost` (R6.10) → el RootGate re-rutea fuera de `(tabs)` y `MasScreen` se desmonta (se pierde
  el estado `blocked`). La operación sigue siendo recuperable (el usuario aterriza en los campos
  restantes y puede reiniciar la baja). Es un camino válido de R6.10, no una pérdida de datos. Se deja
  como comportamiento aceptable de MVP (no se sobre-ingenieriza un "borrar el activo último").

## Estado final
- T6.1 (perfil: name/phone/email) **frontend done**. T6.3 (eliminar cuenta) **frontend done**.
  Saludo consolidado (ProfileContext, fuente única) **done**. Esperando reviewer + Gate 2 (NO marco
  done yo). El deploy del edge `delete_account` + migración 0058 los hace el leader (las 8 fallas del
  edge suite se resuelven ahí).
