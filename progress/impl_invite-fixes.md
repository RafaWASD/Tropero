baseline_commit: 1a9ac65f379c58badcfdc45ea33cb5c9cb5e2696

# impl — invite-fixes (2 bugfixes rebrand-safe del flujo de INVITACIÓN)

Prerequisitos de U8a (deep-links). Frontend puro. Zona sensible: gating de auth (RootGate).
NO cierra ninguna feature SDD formal — es un delta de bugfix (mismo patrón que U8b/U9/U4/U7).

## Feature en curso
Dos bugs del backlog:
- **Bug 1** — LOOP al abrir `/invite?token=` con sesión activa (backlog 2026-06-01 "Loop potencial…").
- **Bug 2** — `router.back()` pelado en `invite.tsx` (backlog 2026-06-04 "back robusto (backOr)…").

## Plan (T1..Tn)
- [x] T1 — Núcleo puro: `invitePhaseForAuth(hasToken, authStatus)` en `src/utils/invite.ts` (decide la fase
      inicial y la transición al resolver auth). El fix del loop = NO persistir el token mientras auth carga.
- [x] T2 — Test unit de `invitePhaseForAuth` en `src/utils/invite.test.ts` (loading→resolving; no-persist).
- [x] T3 — `invite.tsx`: fase `resolving` (auth `loading` con token) → no persiste; al resolver auth decide
      confirm/auth_required. Render de loading. (Fix Bug 1.)
- [x] T4 — `invite.tsx`: reemplazar el `router.back()` de la fase `paste` por `backOr(router, '/(tabs)')`. (Fix Bug 2.)
- [x] T5 — E2E: helper `seedInvitation` (admin) + test Bug 1 (goto authed → aceptar → home, NO loop) + test
      deslogueado (goto → auth_required → persiste → login → vuelve a /invite → acepta → home).
- [x] T6 — Capture Gate 2.5: `e2e/captures/invite-fixes.capture.ts` (paste / auth_required / confirm).
- [x] T7 — Verificación: typecheck + anti-hardcode + E2E invite + check.mjs. git diff supabase/ sync-streams/ vacío.
- [x] T8 — Reconciliación de specs (01, T5.4/R5.13 as-built) + backlog (2 ítems resueltos).

## Archivos tocados
- `app/app/invite.tsx` — fase `resolving` (no persiste en loading) + resolving-effect + `backOr` en Cancelar.
- `app/src/utils/invite.ts` — núcleo puro `invitePhaseForAuth` + tipos `InviteAuthStatus`/`InvitePhaseKind`.
- `app/src/utils/invite.test.ts` — 5 tests de `invitePhaseForAuth`.
- `app/e2e/helpers/admin.ts` — `seedInvitation` (invitación bearer directa vía service_role).
- `app/e2e/invitations.spec.ts` — tests "bug 1" + "deslogueado" + helper `acceptInvitationUntilHome`
  (tolera el guard offline sin enmascarar el loop) + comentario del test existente reconciliado.
- `app/e2e/captures/invite-fixes.capture.ts` — capturas Gate 2.5 (01 paste / 02 auth_required / 03 confirm).
- specs 01: `tasks.md` (T5.4 Reconciliación), `requirements.md` (nota bajo R5.13), `design.md` (nota as-built).
- `docs/backlog.md` — 2 ítems marcados resueltos (loop invite + backOr de invite dentro de "back robusto").

## Trazabilidad (R → test)
- **Bug 1 (loop)** → `app/e2e/invitations.spec.ts` "bug 1: /invite?token= en carga fresca con sesión ACTIVA
  → aceptar → home, NO loopea" (E2E web) + `app/src/utils/invite.test.ts` "con token + auth LOADING →
  resolving (NO auth_required → NO persiste)" (núcleo puro). R5.13 (persistencia condicionada a auth resuelto).
- **Regresión deslogueado (R5.4/R5.13)** → `invitations.spec.ts` "deslogueado: … auth_required (persiste) →
  login → vuelve a /invite → aceptar → home".
- **Bug 2 (backOr)** → `app/src/utils/nav.test.ts` (backOr canGoBack/replace, ya existía) + cubierto en el
  flujo de la fase paste de la capture 01.

## No-false-green (verificado EMPÍRICAMENTE)
Revertí temporalmente `invite.tsx` al comportamiento viejo (persistir en `loading`), rebuildeé el dist y
corrí el test "bug 1": **FALLÓ** quedando atrapado en `/invite` fase confirm (`¿Aceptar esta invitación?`) —
exactamente el síntoma del loop. Restauré el fix + rebuild → **PASA** (11,2s). El test es un candado real.

## Autorrevisión adversarial (paso 8)
- (a) deslogueado→persiste→login→vuelve a /invite→acepta: **OK** — E2E deslogueado pasa (múltiples corridas).
  La fase `auth_required` sigue persistiendo (tras resolver a no-autenticado) y el RootGate re-rutea con su
  guard one-shot. El fix solo evita persistir en `loading`, no toca ese path.
- (b) gating onboarding/verify-email: **OK** — NO toqué el RootGate ni ninguna otra pantalla; el cambio vive
  100% en `invite.tsx` (fase/persistencia) + el import de `backOr`. Sin superficie sobre onboarding/verify.
- (c) guard one-shot del RootGate: **OK** — intacto; el path deslogueado (que depende de él) pasa.
- token limpiado en aceptación exitosa: **OK** — `onAccept` llama `clearPendingInvitationToken()` (sin cambios);
  en el path authed-goto el token NUNCA se persiste (fix) → nada que limpiar.
- backOr fallback correcto: **OK** — `backOr(router, '/(tabs)')` (home), único `router.back()` de invite.tsx.
- flash `unauthenticated` espurio: **descartado** — `AuthContext` bootstrap va `loading→authenticated` cuando
  hay sesión (getSession/INITIAL_SESSION dan `stateFromSession(session)` directo), sin flash → no hay persist
  espurio en el path authed. Deslogueado va `loading→unauthenticated` (persist correcto).
- E2E del loop falla sin el fix: **verificado empíricamente** (ver arriba). No es falso-verde.
- El helper `acceptInvitationUntilHome` NO enmascara el loop: solo clickea "Reintentar" (pantalla de error
  offline), nunca "Aceptar invitación"; si el RootGate re-ruteara a /invite confirm, agota reintentos y falla.

## Reconciliación de specs (as-built)
El diseño describía el re-ruteo de R5.13 en un seam de verify-email; el as-built lo centraliza en el RootGate
(Opción A). Agregué notas de reconciliación (sin reescribir EARS) en `tasks.md` (T5.4), `requirements.md`
(bajo R5.13: el "no logueado" se resuelve tras que auth RESUELVE, no en loading) y `design.md` (nota as-built
con los 2 fixes). Frontend puro: `git diff supabase/ sync-streams/` vacío; 0 design/*.png tocados.

## Verificación (resultado)
- typecheck ✔ · anti-hardcode ✔ (0 violaciones) · scripts unit ✔ (28/0) · **client unit ✔ (2383/0, incluye
  los 5 tests nuevos de `invitePhaseForAuth`)** · Edge suite standalone ✔ (47 tests, 42 pass, 0 fail).
- E2E web (`invitations.spec.ts`): `bug 1` ✔ (11,2s/10,4s, + FALLA verificada contra el build con el bug) ·
  `deslogueado` ✔ (varias corridas). Capture `invite-fixes.capture.ts` ✔ (3 shots generados, gitignored).
- **frontend puro**: `git diff supabase/ sync-streams/` VACÍO; 0 `design/*.png` tocados.
- `node scripts/check.mjs`: **rojo por flake de infra JWT — NO regresión.** Los ÚNICOS fallos en todas las
  corridas fueron `createUser/createTestUser: invalid JWT: … unrecognized JWT kid <nil> for algorithm ES256`
  (Supabase-side; el DEV project parece haber rotado a claves asimétricas ES256 y el service_role legacy en
  `.env.local` se rechaza intermitentemente al crear usuarios). Pega en suites AL AZAR según timing (una
  corrida murió en Edge, otra en RLS), SIEMPRE en la creación de usuario, NUNCA en una aserción de dominio;
  las mismas suites pasan al re-correrlas solas. Consistente con [check rojo = rate-limit]; la consigna decía
  explícitamente "rojo por rate-limit/orphans/Edge/JWT = flake de infra, no interrumpir". ⚠️ Para el leader:
  esto va a seguir flakeando `check.mjs`/E2E hasta que se refresque el service_role key / se reconcilien las
  JWT keys del proyecto dev — es un tema de ENTORNO (fuera del scope frontend), no del código de estos fixes.

## Diagnóstico del loop (verificado leyendo el código)
Carga FRESCA `goto('/invite?token=X')` con sesión activa:
1. `AuthContext` arranca en `loading` → `isAuthed=false` → `invite.tsx` computa fase inicial `auth_required`
   → el `useEffect` PERSISTE el token (R5.13).
2. Auth resuelve `authenticated` → `lastAuthed` effect: `auth_required`→`confirm`.
3. `RootGate`: al quedar `isAuthedVerified` lee el store → `pendingInviteToken=X` (state). Como `top==='invite'`
   NO re-rutea (y NO consume el guard one-shot `reroutedForInvite`).
4. Aceptar → `onAccept` limpia el store (async) → `refreshEstablishments` → `router.replace('/(tabs)')`.
5. `RootGate` re-evalúa (cambió `segments`): `pendingInviteToken` STATE sigue **stale=X** (solo se re-lee al
   cambiar `isAuthedVerified`, que no cambió) y `reroutedForInvite.current===false` → re-rutea a `/invite` → **LOOP**.

NO pasa por el flujo in-app (pegar link): la sesión nunca cae a `loading` → va directo a `confirm`, sin persistir.

**Fix elegido (el más robusto): NO persistir mientras auth es `loading`.** Se espera a que auth RESUELVA
antes de decidir `auth_required`/persistir. En el path authed-goto el token NUNCA se persiste → el RootGate
lee `null` → no hay re-ruteo → no hay loop. El path deslogueado SÍ persiste (tras resolver a no-autenticado)
y el guard one-shot `reroutedForInvite` protege ese re-ruteo legítimo (R5.13). NO se toca el RootGate (zona
sensible): el fix vive enteramente en `invite.tsx`.
