# impl — Spec 14: Separación de PII de contacto (`user_private`)

baseline_commit: 77a1ff204dac5c52831df747e73dce84c775771b

> Punto desde el cual el Gate 2 (security_analyzer modo `code`) calcula el diff.
> Trabajamos sobre `main` (sin feature-branches); NO se usa `main...HEAD`.

## Estado de ejecución

Feature `14-pii-user-private` — `in_progress`, spec aprobado (Puerta 1, Raf 2026-06-04), Gate 1 PASS.

**REGLA CRÍTICA DE ESTA SESIÓN**: NO se aplica la migración al remoto. El drop de
columnas de PII en una tabla en uso es un deploy destructivo y coordinado (migración +
redeploy de Edge Functions juntos) que ejecuta el LEADER con aprobación de Raf. El
implementer entrega los archivos; verifica lo verificable sin remoto.

### Número de migración

`0068_user_private_pii.sql` — la última en disco es `0067_nursing_birth_calves_trigger.sql`.
**RECONCILIAR AL APLICAR**: spec 13 (hardening) y spec 02 Tier 2 (categorías) también
reclaman migrations con número TBD. Si alguna de ellas aplica antes y consume 0068+, el
leader debe renumerar este archivo al siguiente libre **manteniendo el orden** (esta
migration debe ir DESPUÉS de 0067 y no colisionar). El contenido es número-agnóstico
(no referencia su propio número).

## Plan (tasks)

- T1–T9 — Migration `0068_user_private_pii.sql` (atómica): tabla + RLS self-only + unique
  index + trigger updated_at + backfill + drop columns + reescritura `handle_new_auth_user`
  + GRANTs/revokes + smoke-check + trigger propagación de email (auth.users AFTER UPDATE).
- T10 — `invite_user`: precheck re-ruteado a `user_private` (2 pasos, admin-client).
- T11 — `accept_invitation`: lookup owner separado (name de `users`, email de `user_private`).
- T12 — `profile.ts` `loadProfileNamePhone`: phone de `user_private`.
- T13 — `establishments.ts` `loadOwnProfile` + `saveOwnPhone`: `user_private`.
- T14 — `establishments.ts` `loadFullProfile`: email+phone de `user_private`.
- T15 — `establishments.ts` `saveProfile`: phone a `user_private`.
- T16 — Verificar `members.ts` + `ProfileContext.tsx` (sin editar).
- T17–T23 — Tests RLS + Edge (`supabase/tests/user_private/`, `supabase/tests/edge/`).
- T24 — ADR-025 (ya existe; verificar/completar).
- T25 — Nota en `docs/conventions.md`.
- T26 — Mapa de trazabilidad (este archivo).
- T27 — `node scripts/check.mjs` verde + M-1 (helper e2e `setUserPhone`).

## Condiciones obligatorias del Gate 1

- **M-1**: re-rutear `app/e2e/helpers/admin.ts:82` `setUserPhone` a `user_private`.
- **R7.2**: el trigger de propagación de email propaga SOLO el email CONFIRMADO
  (validar shape de `auth.users`: `email_confirmed_at` / `email_change` / `new_email`),
  `SECURITY DEFINER` + `search_path` fijo.
- **L-1 (recomendada)**: `revoke insert, delete` explícito + smoke-check fail-closed.

## Archivos entregados

- `supabase/migrations/0068_user_private_pii.sql` (NUEVO) — migración atómica (T1–T9).
- `supabase/functions/invite_user/index.ts` (MOD, T10) — precheck → user_private (2 pasos).
- `supabase/functions/accept_invitation/index.ts` (MOD, T11) — owner email → user_private.
- `app/src/services/profile.ts` (MOD, T12) — phone de user_private.
- `app/src/services/establishments.ts` (MOD, T13/T14/T15) — loadOwnProfile/saveOwnPhone/
  loadFullProfile/saveProfile → user_private.
- `app/e2e/helpers/admin.ts` (MOD, M-1) — setUserPhone → user_private.
- `supabase/tests/user_private/run.cjs` (NUEVO, T17–T23) — suite RLS + trigger + Edge.
- `scripts/run-tests.mjs` (MOD) — wiring de la suite 14 COMENTADO (descomentar al aplicar).
- `docs/conventions.md` (MOD, T25) — nota PII → *_private (apunta a ADR-025).
- `docs/adr/ADR-025-pii-tabla-private-self-only.md` (T24) — ya existía; cubre R10.1.
- `app/src/services/members.ts` + `app/src/contexts/ProfileContext.tsx` — VERIFICADOS sin
  editar (T16): members.ts pide `user:users(id,name)` (nunca email/phone de coworkers);
  ProfileContext deriva `email` del session (R6.5) y `name/phone` del service (transparente).

## Mapa de trazabilidad R<n> → archivo:test

| R<n> | Archivo de implementación | Test |
|---|---|---|
| R1.1 (tabla, FK cascade) | `0068:28-34` | `user_private/run.cjs` T19 (existe fila), T20 |
| R1.2 (email not-null, phone nullable) | `0068:30-31` | T18, T19 |
| R1.3 (unique email vivos) | `0068:50-51` | (índice; backfill pre-check `0068:75-87`) |
| R1.4 (RLS enabled) | `0068:103` | T17 (0 filas de B) |
| R2.1 (select self) | `0068:105-108` | T18 (A lee su fila) |
| R2.2 (otro → 0 filas) | `0068:105-108` | **T17** (no-bypass, B3-1) |
| R2.3 (update self) | `0068:110-114` | T18 (A actualiza su phone) |
| R2.4 (update ajeno → 0 filas) | `0068:110-114` | T18 (A→fila de B = 0 + phone de B intacto) |
| R2.5 (sin insert/delete a authenticated) | `0068:200,207` | T18 R2.5 (insert/delete cliente bloqueado) |
| R3.1/R3.2 (users sin email/phone) | `0068:96` | **T17** (`select email,phone` falla; `*` sin contacto) |
| R3.3 (coworker ve id,name) | `members.ts` (sin cambio) | T17 setup (A ve id,name de B) |
| R3.4 (users_select_self/update_self) | (sin cambio, 0006) | suite RLS spec 01 (no regresión) |
| R4.1/R4.2 (backfill incl. soft-deleted) | `0068:89-90` | T20 (cada user con email → fila) |
| R4.3 (falla atómica) | `0068:75-87` (pre-check) + tx | (verifica el leader al aplicar) |
| R5.1/R5.2/R5.3 (trigger signup ambas tablas) | `0068:127-148` | **T19** |
| R6.1 (perfil propio lee phone de user_private) | `profile.ts:36-72`, `establishments.ts:196` | T18; e2e profile.spec |
| R6.2 (guardar perfil escribe phone a user_private) | `establishments.ts:saveProfile` | T18 |
| R6.3 (ProfileContext name users / phone user_private) | `profile.ts` (transparente) | T16 (verificado) |
| R6.4 (gate teléfono → user_private) | `establishments.ts:loadOwnProfile/saveOwnPhone` | e2e (setUserPhone vía user_private) |
| R6.5 (email del session) | `ProfileContext.tsx` (sin cambio) | T16 (verificado) |
| R7.1 (propaga email confirmado) | `0068:169-189` | **T23 R7.1** |
| R7.2 (no propaga pendiente) | `0068:178` (`is distinct from`) | **T23 R7.2** |
| R8.1/R8.3 (precheck invite vía user_private) | `invite_user/index.ts:76-105` | **T21** (already_member code) |
| R8.2/R8.3 (accept lookup owner vía user_private) | `accept_invitation/index.ts:120-155` | **T22** |
| R9.1 (grant select,update authenticated) | `0068:200` | T18 (self ok; insert/delete no) |
| R9.2 (grant service_role) | `0068:202` | T19/T20/T21/T22 (admin lee) |
| R9.3 (nada a anon) | `0068:208` + smoke-check | smoke-check de la migración |
| R9.4 (reload schema) | `0068` (`notify pgrst`) | (efecto al aplicar) |
| R10.1 (patrón documentado) | ADR-025 + `conventions.md` | n/a (doc) |

**Tests que requieren el apply de la migración (NO verificados verde localmente)**:
toda la suite `supabase/tests/user_private/run.cjs` (T17–T23) corre VERDE recién después de
que el leader aplique `0068` + redeploye `invite_user`/`accept_invitation`. Hasta entonces la
tabla `user_private` no existe en el remoto y la suite falla por "tabla inexistente". Por eso
su wiring en `run-tests.mjs` está COMENTADO (descomentar al aplicar). Honesto: NO marco estos
tests como pasados; verifiqué su corrección de código (lógica, shape de queries, asserts del
reject path) pero su ejecución verde depende del deploy.

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

1. **Desviación de spec**: revisé R1–R10 uno por uno contra el código (mapa arriba). Todos
   cubiertos. R6.5 (email del session) y R3.3/R6.3 (members/ProfileContext) son verificación,
   no edición — confirmado que el contrato se mantiene.
2. **Edge case del índice TOTAL vs PARCIAL (R1.3/R4)**: el viejo `users_email_active` era
   parcial (`where deleted_at is null`) → un soft-deleted y un vivo PODÍAN compartir email; el
   índice total nuevo no los admite. ENCONTRÉ que el backfill podía fallar con un
   unique-violation críptico si el dato drifteó (users.email queda stale tras cambio de email).
   CERRADO: agregué un pre-check (`0068:75-87`) que aborta con mensaje accionable + atomicidad
   (toda la migración es una tx). Anotado para el leader.
3. **Trigger de email (R7.2) — test del reject path**: verifiqué que T23 R7.2 ejerce el path
   real (cambio PENDIENTE vía `clientB.auth.updateUser` → auth.users.email NO cambia → trigger
   no dispara → user_private.email intacto), no solo el happy path. La condición
   `new.email IS DISTINCT FROM old.email` es robusta al shape (no depende de columnas internas
   frágiles `email_change`/`new_email`).
4. **Tests verdes por la razón equivocada**: ENCONTRÉ que T21 asertaba `error || data?.error`
   (cualquier error pasaría, incl. un db_error si la query a user_private estuviera mal armada).
   CERRADO: ahora aserta el código específico `already_member` (unwrap del envelope, patrón de
   la suite edge existente). T18 R2.4 además verifica que el phone de B NO cambió (no solo 0
   filas devueltas).
5. **Gaps de seguridad**: (a) revoke explícito insert/delete + nada a anon + smoke-check
   fail-closed (L-1) `0068:204-...`; (b) revoke nominal de EXECUTE de las 2 funciones
   SECURITY DEFINER (handle_new_auth_user + propagate_confirmed_email) + check, patrón 0055/0065
   — no se exponen como RPC; (c) `search_path=public` fijo en ambas; (d) lectores cross-user de
   PII SOLO vía admin-client scopeado (precheck por establishment+active; lookup por
   inv.invited_by del token), nunca al rol authenticated.
6. **Multi-tenant / offline**: user_private es self-only puro (más restrictivo que multi-tenant;
   la PII es de la persona, no del campo). No hardcodea nada (sale de auth.uid()/JWT). Offline:
   esta spec NO toca features de carga de campo; es identidad (online por spec 01 R9.2).
7. **Lectores fantasma**: grep exhaustivo de `users.email`/`users.phone` en `app/`, `supabase/
   functions/`, `supabase/migrations/`, `app/e2e/` → todos mapeados; los restantes son
   `invitations.email` (otra tabla), `user.email` del JWT, o `body.email` (input). 0 huérfanos.
8. **No-atomicidad de saveProfile (2 writes)**: lo documenté (phone primero, name después;
   corta si phone falla). Profile-edit idempotente, user-driven, low-stakes. Aceptable; lo dejo
   anotado para el reviewer/Gate 2 por transparencia.

Tras la autorrevisión, re-corrí `node scripts/check.mjs`: typecheck OK, client unit tests OK,
anti-hardcode 0 violaciones, suites remotas existentes (RLS/Edge/Animal/Maneuvers) VERDES sin
regresión. El único FAIL es el preexistente "2 features in_progress" (ver bitácora).

## Pendiente del leader (apply coordinado)

1. Reconciliar el número de migración (0068 libre hoy; si spec 13 / spec 02 Tier 2 lo consumen
   antes, renumerar manteniendo orden).
2. Aplicar `0068` al remoto + redeploy de `invite_user` y `accept_invitation` JUNTOS (deploy
   destructivo coordinado; no hay ventana segura para desfasarlos).
3. Descomentar el wiring de la suite 14 en `scripts/run-tests.mjs` y correrla verde.
4. Si el backfill aborta por emails duplicados (pre-check), reconciliar el dato drifteado.

## Bitácora

- 2026-06-04 — Baseline registrado. check.mjs: tests VERDES (RLS 15 + Edge 26 + Animal 28 +
  Maneuvers 13 + client unit + typecheck + anti-hardcode 0 violaciones). El ÚNICO FAIL del
  check es "2 features en in_progress (máximo 1)" — preexistente: feature 01 quedó
  `in_progress` (frontend pausado) y feature 14 también lo está. NO es regresión de este
  trabajo; es estado de coordinación que resuelve el leader. La señal de tests es verde.
- 2026-06-04 — Implementación completa (T1–T27). Migración 0068 + EFs + services + helper e2e +
  suite + docs. Autorrevisión adversarial hecha y cerrada (ver arriba). NO se aplicó al remoto
  (regla de la sesión). Listo para reviewer → Gate 2 → puerta de código humana.
- 2026-06-04 — FIX-LOOP de TEST (migración 0068 YA aplicada al remoto + EFs redeployadas; NO se
  tocó nada de eso). Reescrito SOLO el test **T23 R7.2** en `supabase/tests/user_private/run.cjs`.
  - **Bug del test (no de la feature)**: la versión vieja fabricaba el estado "pendiente" con
    `clientB.auth.updateUser({ email })` (path user-initiated). Ese path (a) VALIDA el dominio y
    rechaza `.local` con `AuthApiError: email_address_invalid` (a diferencia del admin/signup, que
    lo aceptan) y (b) manda un mail de confirmación RATE-LIMITED (`over_email_send_rate_limit`,
    docs/backlog.md 2026-06-01) → frágil por partida doble. Los otros 17 asserts (T17–T22, incl.
    no-bypass, EFs re-ruteadas y T23 R7.1) ya pasaban y quedaron INTACTOS.
  - **Reescritura (opción b, la más fiable contra el remoto real)**: probar el invariante del
    trigger directamente, sin pasar por el endpoint validado/rate-limited. El trigger
    `on_auth_user_email_confirmed` propaga SOLO cuando `auth.users.email` realmente cambia
    (condición `new.email IS DISTINCT FROM old.email`); un cambio pendiente, por definición, deja
    `auth.users.email` igual (el nuevo vive en `email_change`). Dos sub-casos, ambos vía
    admin-client (sin validación de dominio, sin rate-limit):
      • Caso 1: `admin.updateUserById(user_metadata=...)` → update de auth.users que NO cambia
        email → `user_private.email` intacto (la propagación no se gatilla por cualquier UPDATE).
      • Caso 2 (el fuerte, no puede pasar verde por la razón equivocada): desincronizo a propósito
        `user_private.email` a un sentinel y luego hago `admin.updateUserById(email = mismo valor,
        email_confirm:true)` → `new.email IS DISTINCT FROM old.email` = false → el trigger NO corre
        → el sentinel SOBREVIVE. Si el trigger disparara mal, pisaría el sentinel y el assert
        fallaría. Restauro la coherencia al final.
  - **Dominio de email**: todos los users nuevos se siguen creando con `@rafaq-test.local` vía
    `admin.auth.admin.createUser` (mismo dominio que usan RLS/Edge/Animal/Maneuvers, que pasan; el
    admin/signup acepta `.local`). No se crearon users por el path validado.
  - **Verificación**: `node --env-file=.env.local --test supabase/tests/user_private/run.cjs` →
    **19/19 verde** (T23 R7.2 incluido), corrido dos veces. Suite Edge en aislamiento 36/36 verde.
    `node scripts/check.mjs`: typecheck OK, client unit OK, anti-hardcode 0 violaciones; todas las
    suites remotas verdes cuando la red coopera (user_private 19/19, edge 36/36, rls/animal/
    maneuvers OK en la primera corrida limpia). Los únicos FAIL del check son ajenos a este fix:
    (1) `ECONNRESET`/`fetch failed` transitorio al correr 5 suites remotas back-to-back (cae en una
    suite distinta en cada corrida —rls una vez, edge otra— y NUNCA en user_private; es throttling
    de red del remoto, no lógica de test), y (2) el preexistente "2 features en in_progress
    (máximo 1)" que resuelve el leader. Ninguno está en scope de este fix-loop.
</content>
