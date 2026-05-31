baseline_commit: c56a57fae8c9ba3ee99a9ab81edf8958158ecccb

# Implementación — `01-identity-multitenancy` · Frontend B.1.1 (Fase 3 — fundación de auth)

**Agente:** `implementer`
**Inicio:** 2026-05-30 (sesión 21)
**Spec:** `specs/active/01-identity-multitenancy/` (aprobado por Raf). Foco: T3.1–T3.6 (Fase 3, cliente auth).
**Backend:** done desde sesión 4/6 (Auth + RLS + 7 Edge Functions desplegadas y testeadas contra el remoto).

> `baseline_commit` (línea 1): SHA previo a la primera task de esta feature en esta línea de trabajo. Punto desde el cual Gate 2 (security_analyzer modo `code`) calcula el diff. Trabajamos sobre `main` (no feature-branches). NO sobreescribir.

## Alcance B.1.1 (lo que SÍ y lo que NO)

SÍ (Fase 3):
- T3.1 — cliente Supabase real (storage adapter sobre expo-secure-store, guarda web→localStorage) + `AuthContext` (loading/unauthenticated/authenticated).
- Gating de navegación raíz por `AuthState` (grupos Expo Router `(auth)` / `(app-auth)`).
- T3.2 — SignUp/SignIn con validación + copy de errores en voseo.
- T3.3 — EmailVerificationGate (reenviar + cerrar sesión + auto-refresh) + seam R5.13 (chequeo de token de invitación pendiente, stubbeado con TODO B.1.3).
- T3.4 — ForgotPassword + UpdatePassword (deep-link mínimo/stub, TODO Fase 5).
- T3.5 — lockout local liviano (5 fallos → 15 min) apoyado en rate-limit nativo de Supabase.
- T3.6 — registro de push token best-effort tras auth+verificado (no-op en web).
- Componente nuevo `FormField` (tokens-only, touch-target ≥56px, split a11y web/native).

NO (diferido):
- AcceptInvitation real → B.1.3 (Fase 5). Acá solo el HOOK stubbeado del chequeo de token (R5.13 seam).
- EstablishmentContext + gating de establecimiento (Mis campos / wizard / active_lost) → B.1.2 (Fase 4). Acá `authenticated+verificado` cae al placeholder `(tabs)`.
- Wiring fino de deep-links (`rafq://`, universal links) → Fase 5.
- PowerSync (Fase 7, diferida).

## Plan de tareas

- [ ] Setup: crear `app/.env.local` (copiar los dos `EXPO_PUBLIC_SUPABASE_*` del `.env.local` raíz). Verificar gitignore.
- [ ] T3.1a — `app/src/services/supabase.ts`: cliente real con storage adapter expo-secure-store (web→localStorage fallback).
- [ ] T3.1b — `app/src/contexts/AuthContext.tsx`: estado + signUp/signIn/signOut/requestPasswordReset/resendVerification + onAuthStateChange + `useAuth()`.
- [ ] FormField — `app/src/components/FormField.tsx` + export en index.
- [ ] T3.2 — SignUpScreen + SignInScreen (+ copy de errores de Auth en voseo).
- [ ] T3.3 — EmailVerificationGate (+ seam R5.13 stub).
- [ ] T3.4 — ForgotPasswordScreen + UpdatePasswordScreen.
- [ ] T3.5 — lockout local (lógica pura testeable + integración en SignIn).
- [ ] T3.6 — registro de push token best-effort (web no-op).
- [ ] Gating de nav raíz: reescribir `app/app/_layout.tsx` + grupos `(auth)` / pantallas auth.
- [ ] Tests (lógica pura: validación, mapeo de errores, lockout).
- [ ] Autoverificación: typecheck + check.mjs + pnpm web contra remoto + autorrevisión adversarial.

## Bitácora — as-built

Todas las tasks de la lista quedaron hechas. Resumen por unidad.

### Setup
- Creado `app/.env.local` con los dos `EXPO_PUBLIC_SUPABASE_*` (copiados del `.env.local` raíz). Verificado `git check-ignore app/.env.local` → gitignoreado por `app/.gitignore` (línea `.env*.local`). NO se commitea ningún secreto. El dev server confirmó la lectura: `env: load .env.local` + `env: export EXPO_PUBLIC_SUPABASE_*`.

### T3.1a — cliente Supabase real (`app/src/services/supabase.ts`)
- `createClient` con storage adapter sobre `expo-secure-store` (native) y fallback web→`localStorage`→memoria (guarda por `Platform.OS`/`hasLocalStorage`). `persistSession`, `autoRefreshToken`, `detectSessionInUrl` solo-web.
- `safeKey()` sanea keys a `[A-Za-z0-9._-]` (defensivo; las keys de supabase-js ya cumplen).
- Quité el import de `react-native-url-polyfill/auto` que había puesto: NO es dep instalada y rompería el bundle. supabase-js funciona sin él en Expo SDK 56 (verificado: bundle web OK + auth real OK).

### T3.1b — `AuthContext` (`app/src/contexts/AuthContext.tsx`)
- Estado `loading | unauthenticated | authenticated{user, emailVerified}`. `useAuth()` exportado. `getSession()` al montar + `onAuthStateChange`. `emailVerified` = `email_confirmed_at ?? confirmed_at`. `toAuthUser` extrae `name` de `user_metadata`.
- Acciones: `signUp` (manda `data.name`), `signIn`, `signOut`, `requestPasswordReset`, `resendVerification` (`type:'signup'`), `refreshSession` (usa `getUser()` → roundtrip al server para reflejar verificación reciente).
- T3.6 integrado: `useEffect` que al quedar `authenticated+emailVerified` dispara `registerPushTokenBestEffort()` una sola vez por user (ref guard).

### FormField + AuthScreenShell + AuthBits (componentes de librería, ADR-023)
- `FormField` (`app/src/components/FormField.tsx`): label + `TextInput` (RN) + error. Tokens-only via `getTokenValue` (color/size/radius cruzan a la API no-Tamagui del `TextInput`), touch-target `$touchMin` (56). Split a11y web (`aria-*`) / native (`accessibilityState`) como `Button.tsx`. `forwardRef`.
- `AuthScreenShell`: marco común (safe-area, `KeyboardAvoidingView`, ScrollView, wordmark, título/subtítulo + slot). Tokens-only.
- `AuthBits`: `FormError` (banda terracota, `role=alert`/`accessibilityLiveRegion`), `InfoNote` (nota neutra), `LinkButton` (link de texto secundario). Tokens-only, split a11y.
- Exportados todos desde `app/src/components/index.ts`.

### T3.2 — SignUp / SignIn
- `app/app/(auth)/sign-up.tsx`: form name/email/password, `validateSignUp`, errores via `authErrorMessage(_, 'signup')`. Post-signup muestra estado "Verificá tu email" en la misma pantalla (con confirmación de email habilitada NO hay sesión, el gate no cambia).
- `app/app/(auth)/sign-in.tsx`: form email/password, `validateSignIn`, `authErrorMessage(_, 'signin')`, lockout integrado (ver T3.5). Links a forgot-password y sign-up.
- Validación + copy de errores en voseo, lógica pura en `app/src/utils/{validation,auth-errors}.ts`.

### T3.3 — EmailVerificationGate (`app/app/verify-email.tsx`)
- Aparece cuando `authenticated + !emailVerified` (gating raíz). CTAs: "Reenviar email", "Ya verifiqué · Refrescar", "Cerrar sesión". Auto-refresh: polling cada 5s (`refreshSession`) + `useFocusEffect`.
- **SEAM R5.13**: consulta `getPendingInvitationToken()` (store ya funcional). El re-ruteo a AcceptInvitation queda `TODO B.1.3` documentado en el header del archivo (AcceptInvitation se construye en Fase 5).

### T3.4 — recuperar password
- `app/app/(auth)/forgot-password.tsx`: input email → `requestPasswordReset`. NO revela existencia de cuenta (anti-enumeración): muestra "Revisá tu email" salvo error de red/limit.
- `app/app/update-password.tsx`: nueva password + confirmación → `supabase.auth.updateUser`. **SEAM Fase 5**: el wiring del deep-link (`PASSWORD_RECOVERY` event + `rafq://`/universal link) queda `TODO B.1.3` documentado; hoy la pantalla es alcanzable como ruta y funcional sobre la sesión activa.

### T3.5 — lockout local
- Lógica pura en `app/src/utils/lockout.ts` (reloj inyectado): 5 fallos en 10 min → bloqueo 15 min. Persistencia por-email en `app/src/services/lockout-store.ts` (SecureStore native / localStorage web; key derivada por hash del email normalizado). Integrado en `sign-in.tsx`. Apoyado en el rate-limit nativo de Supabase (mapeado a 429 en `authErrorMessage`).

### T3.6 — registro de push token
- `registerPushTokenBestEffort()` en `app/src/services/push-notifications.ts`: `getExpoPushTokenSafe()` → `supabase.functions.invoke('register_push_token', { expo_push_token, device_id, platform })`. Best-effort: web/simulador devuelve `not_a_device` (no-op); permiso denegado no insiste; fallo de red se traga con warning de dev. Contrato verificado contra el as-built backend (input `{ expo_push_token, device_id?, platform? }` → `{ token_id }`).

### Gating de navegación raíz (`app/app/_layout.tsx`)
- Reescrito: `AuthProvider` envuelve `AuthGate`. `AuthGate` usa `useSegments`+`useRouter` y re-rutea por `AuthState`: loading→no re-rutea (splash); unauthenticated→`/(auth)/sign-in`; authenticated+!verif→`/verify-email`; authenticated+verif→`/(tabs)`. Rutas `maniobra`/`mis-campos`/`update-password` mantenidas. Grupo `(auth)` con su `_layout.tsx` (Stack).

## Decisiones técnicas menores tomadas (default + razón)

1. **Sin `react-native-url-polyfill`**: lo probé y NO está instalado; no agrego dep no autorizada. supabase-js anda sin él en Expo 56 (bundle web + auth real verdes). Si en native surge un error de `URL`, se evalúa agregarlo en B.1.2.
2. **Tests del cliente con `node:test` + type-stripping (Node 24), no Jest**: el proyecto no tiene Jest y agregarlo (jest-expo, postinstall whitelist) es scope grande. Reuso el patrón backend (runners Node-nativos). Solo testeo **lógica pura** (validación, mapeo de errores, lockout) — sin render de RN. Excluí `**/*.test.{ts,tsx}` del `tsconfig` del cliente (imports con extensión `.ts` que tsc rechaza; los tests no van al bundle). Cableé el run en `scripts/run-tests.mjs` → corre dentro de `check.mjs`.
3. **Storage adapter web con fallback memoria**: cubre headless/SSR sin window. La sesión no sobrevive reload en ese caso (degradación aceptable; el caso real web tiene localStorage).
4. **Lockout = UX-only, persistido por hash del email**: la defensa real es el rate-limit de Supabase. El hash (no-cripto) deriva una key SecureStore-válida estable desde el email.
5. **Anti-enumeración en forgot-password**: no se revela si el email existe (mensaje neutro salvo red/limit). Decisión de seguridad estándar.
6. **`device_id` desde `Device.osInternalBuildId ?? Device.modelId`**: identificador estable disponible sin permisos extra (no hay un device-id canónico cross-platform en Expo).

## Autorrevisión adversarial (paso 8)

Qué busqué / qué encontré / cómo lo cerré:

- **Storage adapter rompe en web**: NO — guarda por `Platform.OS`/`hasLocalStorage`; bundle web compiló (3689 módulos) y auth real funcionó. ✔
- **Secretos hardcodeados o logueados**: NO — el cliente lee de env; el adapter mueve bytes opacos; ningún `console.log` de sesión/token. `app/.env.local` gitignoreado. ✔
- **Manejo de errores de Auth cubre los casos**: SÍ — email ya registrado, credenciales inválidas, password débil, sin red, rate-limit (429), fallback por contexto. Verificado con `authErrorMessage` tests + contra el server real (`invalid_credentials`, `over_email_send_rate_limit`, `email_address_invalid` todos mapean). ✔
- **Gating deja pantallas huérfanas / loops**: revisado — al boot en `/` Expo resuelve `(tabs)` y el efecto re-rutea según estado; el grupo `(auth)` permite navegar entre sign-in/up/forgot sin re-ruteo; `update-password` es ruta pública (no re-ruteada). No hay loop (el redirect solo dispara si el segmento NO coincide con el estado). Flash breve de `(tabs)` antes del redirect cuando unauthenticated — aceptable (home no usa auth, no crashea). ✔
- **Copy en voseo sin typos de tildes**: revisado — "Verificá", "Ingresá", "Iniciá/Iniciar sesión", "Recuperá/Recuperar", "contraseña", "conexión", "sesión". UTF-8 correcto. ✔
- **SecureStore 2KB en native**: RIESGO REAL encontrado — la sesión entera va en una key y puede exceder el límite. Como el veredicto en device está diferido y B.1.1 verifica en web (sin límite), lo dejé documentado como `TODO B.1.2` en el header del cliente (migrar a adapter chunked si la sesión no persiste en device). No sobre-construí ahora.
- **Tests que pasan por la razón equivocada**: los tests de lockout inyectan el reloj (deterministas, ejercen las ramas de bloqueo/expiración/ventana); los de auth-errors verifican el mapeo real (code + message + name). No son tautológicos.
- **Push best-effort no rompe el login**: confirmado — `registerPushTokenBestEffort` es fire-and-forget en un `useEffect`; en web devuelve `not_a_device` y nunca llama al Edge Function.

## Trazabilidad R<n> → test / evidencia

| R<n> | Cubierto por |
|---|---|
| R1.1 (email/password/nombre obligatorios) | `app/src/utils/validation.test.ts` (`isValidEmail`/`isValidPassword`/`isValidName`/`validateSignUp`) |
| R1.2 (email de verificación al registrarse) | Evidencia e2e: `signUp` contra el server real intenta mandar el mail (tripeó `over_email_send_rate_limit` = el path de envío se ejecuta). `email_confirmed_at: null` post-signup → cae en EmailVerificationGate |
| R1.3 (login permitido pero gate restringe sin verificar) | `_layout.tsx` `AuthGate` re-rutea `authenticated+!emailVerified` → `/verify-email`. Evidencia: user confirmado vía admin → `signIn` anon trae `email_confirmed_at` no-null → cae en `(tabs)` |
| R1.4 (login email+password) | Evidencia e2e: `signInWithPassword` con anon → `session: creada` (user confirmado). `invalid_credentials` con password mala |
| R1.5 (recuperar password) | Evidencia e2e: `resetPasswordForEmail` → sin error (mail disparado). `ForgotPasswordScreen` + `UpdatePasswordScreen` |
| R1.6 (logout invalida sesión local) | `AuthContext.signOut` → `supabase.auth.signOut()` + reset del push guard; `onAuthStateChange` lleva a `unauthenticated` → gate a `(auth)` |
| R1.7 (lockout 5 fallos / 15 min) | `app/src/utils/lockout.test.ts` (bloqueo, ventana de 10 min, reset, normalize, expiración) + mapeo 429 en `auth-errors.test.ts` |
| R5.11 (push, lado cliente) | `registerPushTokenBestEffort` llama `register_push_token`; contrato verificado contra as-built backend; web = no-op |
| R5.13 (seam token de invitación) | `app/src/services/pending-invitation.ts` (store funcional) + hook de consulta en `verify-email.tsx` (re-ruteo = TODO B.1.3) |
| R9.2 (auth requiere conexión) | Por construcción: signUp/signIn/reset son llamadas online a Supabase Auth; no se cachean offline |

Evidencia de verificación e2e (anon key real contra `xrhlxxdnfzvdnztacofj.supabase.co`):
- `signInWithPassword` (anon) sobre user confirmado → `session: creada`, `email_confirmed_at` no-null, `user_metadata.name` legible.
- `invalid_credentials` con password incorrecta.
- `resetPasswordForEmail` sin error.
- `over_email_send_rate_limit` / `email_address_invalid` confirman que el path de signup llega al server.
- Bundle web: `Web Bundled (3689 modules)` OK — todas las pantallas/componentes nuevos transpilaron.

## Resultado de cada paso de autoverificación

1. `cd app; pnpm.cmd typecheck` → **verde** (tras excluir `*.test.ts` del tsconfig).
2. `node scripts/check.mjs` (raíz) → **verde**: typecheck + **19 client unit tests** + RLS (15) + Edge (26) + Animal (28) + Maneuvers (13). Sin regresión. Anti-hardcode: **0 violaciones**.
3. `pnpm.cmd web` → dev server levantó leyendo `app/.env.local`; bundle web compiló (3689 módulos, 13.4 MB, HTTP 200); flujos de auth verificados contra el Supabase remoto (ver evidencia arriba). El veredicto del flujo de verificación de email "click en el link real del inbox" queda fuera de alcance (requiere inbox); cubierto hasta: signup dispara el mail (path ejecutado), gate aparece, login de user verificado avanza a `(tabs)`.
4. Autorrevisión adversarial → documentada arriba; 1 riesgo native (SecureStore 2KB) dejado como TODO B.1.2.

## Seams / TODOs dejados

**Para B.1.2 (Fase 4 — establecimientos):**
- El gate `authenticated+verificado` cae al placeholder `(tabs)`. Fase 4 inserta acá el `EstablishmentContext` + gating de establecimiento (Mis campos `R6.6` / wizard `R6.5` / `active_lost` `R6.10`). El punto de inserción está marcado en `_layout.tsx` (`AuthGate`, rama authenticated+verificado).
- La home `(tabs)/index.tsx` sigue con mock data (`USER_FIRST_NAME='Lucas'`, `La Juanita`). Fase 4 la cablea al contexto real (no la toqué para no salir de scope).
- TODO B.1.2 (native): adapter de sesión chunked para SecureStore si la sesión supera 2KB en device (documentado en `supabase.ts`).

**Para B.1.3 (Fase 5 — invitaciones/miembros):**
- **AcceptInvitation** (`R5.4`/`R5.5`/`R5.13`): construir la pantalla. El store de token pendiente (`pending-invitation.ts`) ya existe y el gate de verificación ya lo consulta — falta el re-ruteo automático a `/accept-invitation?token=…` al pasar el gate + `clearPendingInvitationToken()` al consumir. TODO marcado en `verify-email.tsx`.
- **Deep-link / universal links** (`rafq://` + `https://app.rafq.ar/invite|/reset`): wiring fino. Incluye el evento `PASSWORD_RECOVERY` de `onAuthStateChange` que debe re-rutear automáticamente a `update-password.tsx` (hoy esa pantalla se alcanza manualmente / por el link en web). TODO marcado en `update-password.tsx`.

## Archivos creados / modificados

Nuevos:
- `app/.env.local` (NO commiteado — gitignoreado)
- `app/src/services/supabase.ts` (reemplaza el placeholder)
- `app/src/contexts/AuthContext.tsx`
- `app/src/services/pending-invitation.ts`
- `app/src/services/lockout-store.ts`
- `app/src/utils/validation.ts` + `validation.test.ts`
- `app/src/utils/auth-errors.ts` + `auth-errors.test.ts`
- `app/src/utils/lockout.ts` + `lockout.test.ts`
- `app/src/components/FormField.tsx`
- `app/src/components/AuthScreenShell.tsx`
- `app/src/components/AuthBits.tsx`
- `app/app/(auth)/_layout.tsx`
- `app/app/(auth)/sign-in.tsx`
- `app/app/(auth)/sign-up.tsx`
- `app/app/(auth)/forgot-password.tsx`
- `app/app/verify-email.tsx`
- `app/app/update-password.tsx`

Modificados:
- `app/src/services/push-notifications.ts` — `registerPushTokenBestEffort` (T3.6)
- `app/src/contexts/index.ts` — export de AuthContext
- `app/src/components/index.ts` — export de FormField/AuthScreenShell/AuthBits
- `app/app/_layout.tsx` — gating de nav raíz por AuthState
- `app/tsconfig.json` — excluye `**/*.test.{ts,tsx}`
- `scripts/run-tests.mjs` — corre los client unit tests dentro de `check.mjs`

NO toqué (coordinación / leader): `feature_list.json`, `progress/current.md`, `progress/plan.md`, ni la DB remota. Tampoco marqué nada `done`.
