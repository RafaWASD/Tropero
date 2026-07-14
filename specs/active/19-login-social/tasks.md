# Tasks — 19-login-social

> Pasos discretos en orden de dependencia. El implementer marca `[x]`. El reviewer rechaza si queda `[ ]`
> sin justificación. Cada tarea lista los `R<n>` que cubre. **100% frontend + config** (sin migración).
>
> **Ordenado por dependencia**: (F1) config estática → (F2) servicios platform-split → (F3) context →
> (F4) UI + wiring + errores → (F5) verificación web → (F6) QA manual device.
>
> **Gated por config externa de Raf** (client IDs, Apple Developer, Supabase Dashboard): las tareas
> marcadas **[GATED-RAF]** no se pueden *verificar en device* hasta que Raf cierre la config externa. Casi
> todo el **código es buildable-ya** sin esos IDs (los valores reales son placeholders/env). El único gate
> duro son F6 (device) y el sub-paso de valores reales de F1.

## Fase 1 — Config estática (buildable-ya; valores reales gated)

- [x] **T1** — `package.json`: agregar deps `@react-native-google-signin/google-signin`,
  `expo-apple-authentication`, `expo-crypto` (via `npx expo install` para alinear al SDK 56). Tras
  `pnpm install`, verificar si pnpm pide aprobar un build script → si sí, agregar a
  `pnpm.onlyBuiltDependencies` (memoria `package_manager_pnpm`); si no, no tocar. Cubre: R7.3.
  → hecho: `google-signin ^16.1.2`, `expo-apple-authentication ~56.0.4`, `expo-crypto ~56.0.4`.
  Sin "ignored build scripts" → `pnpm.onlyBuiltDependencies` NO se toca.
- [x] **T2** — `env-resolve.ts`: agregar `googleWebClientId?: string` al tipo `RequiredEnv` (o un
  `OptionalEnv`), leído **fuera** del check fail-closed (su ausencia NO aborta). `env.ts`: leer
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Cubre: R7.4.
  → hecho: campo opcional en `RequiredEnv`, leído tras el throw. `env.ts` sin cambios (el
  reader genérico `readPublicEnv` ya cubre la var vía `resolveEnv`).
- [x] **T3** — `eas.json`: agregar `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` al `env` de `preview`,
  `development` y `production` (placeholder documentado; el valor real es **[GATED-RAF]**, no es secreto).
  Cubre: R7.2. → hecho: placeholder `PLACEHOLDER-WEB-CLIENT-ID.apps.googleusercontent.com` en los 3.
- [x] **T4** — `app.json`: plugin `@react-native-google-signin/google-signin` con `iosUrlScheme`
  (placeholder del reversed iOS client ID — **[GATED-RAF]**) + plugin `expo-apple-authentication` +
  `ios.usesAppleSignIn: true`. Verificar que NO rompe `expo export -p web`. Cubre: R7.1.
  → hecho: plugin en forma de array con `iosUrlScheme` placeholder, `expo-apple-authentication`,
  `ios.usesAppleSignIn: true`.

## Fase 2 — Servicios platform-split (buildable-ya)

- [x] **T5** — `services/google-auth.ts` (base/contrato tsc): `export function signInWithGoogle():
  Promise<AuthActionResult>` (stub que nunca se bundlea en runtime; sin imports nativos). Cubre: R1.1
  (contrato).
- [x] **T6** — `services/google-auth.native.ts`: `GoogleSignin.configure({ webClientId })` →
  `hasPlayServices()` → `signIn()` → extraer `idToken` → `signInWithIdToken({ provider:'google', token })`.
  Cancelación (`SIGN_IN_CANCELLED`) → `{ ok:false }` sin error; `DEVELOPER_ERROR`/`PLAY_SERVICES_NOT_AVAILABLE`/
  red → `{ ok:false, error }` con el code normalizado. **Único** import de la lib nativa de Google.
  Cubre: R1.2, R1.3, R1.4, R1.6, R1.7, R6.1, R6.3, R6.4.
  → Drift v16 (reconciliar T25): la cancelación se DEVUELVE como `{ type:'cancelled' }` (isSuccessResponse
  false → silencio), no se tira; `DEVELOPER_ERROR` NO está en `statusCodes` v16 (llega como code string
  crudo 'DEVELOPER_ERROR' → auth-errors lo matchea por string).
- [x] **T7** — `services/google-auth.web.ts`: `signInWithOAuth({ provider:'google', options:{ redirectTo:
  window.location.origin } })`; error → `{ ok:false, error }`. Sin libs nativas. Cubre: R3.1, R3.3, R3.4,
  R8.7.
- [x] **T8** — `services/apple-auth.ts` (base/contrato tsc): `export function signInWithApple():
  Promise<AuthActionResult>` (stub; sin imports nativos). Cubre: R2.1 (contrato).
- [x] **T9** — `services/apple-auth.native.ts`: nonce (`Crypto.getRandomBytesAsync` → hex raw;
  `Crypto.digestStringAsync(SHA256, raw)` → hashed) → `AppleAuthentication.signInAsync({ nonce: hashed,
  requestedScopes:[FULL_NAME,EMAIL] })` → `signInWithIdToken({ provider:'apple', token, nonce: raw })`.
  `ERR_REQUEST_CANCELED` → `{ ok:false }` silencioso. En Android → `{ ok:false }` (no aplica). **Único**
  import de `expo-apple-authentication`/`expo-crypto` del servicio. Cubre: R2.2, R2.3, R2.4, R2.5, R6.1,
  R8.1.
- [x] **T10** — `services/apple-auth.web.ts`: `signInWithOAuth({ provider:'apple', options:{ redirectTo }
  })`; error → `{ ok:false, error }`. Sin libs nativas. Cubre: R3.2, R3.3, R3.4, R8.7.

## Fase 3 — Context (buildable-ya)

- [x] **T11** — `AuthContext.tsx`: ampliar `AuthActionResult` (`error?` opcional en la variante `false` —
  cancelación silenciosa); agregar `signInWithGoogle`/`signInWithApple` (`useCallback`, wrappers de los
  servicios platform-split) al `AuthContextValue` y al provider `value`. **NO** tocar
  `onAuthStateChange`/`getSession`. Cubre: R1.1, R2.1, R5.1, R6.1.
  **[Contrato público — confirmar Puerta 1]** cambio aditivo a tipos exportados.
  → hecho: `error?: AuthErrorLike` (importado de auth-errors), 2 wrappers `useCallback`, agregados al
  `value`. `onAuthStateChange`/`getSession`/lockout NO tocados.

## Fase 4 — UI: componentes + errores + wiring (buildable-ya)

- [x] **T12** — `components/GoogleSignInButton.tsx`: botón "Continuar con Google" (Tamagui, tokens,
  tamaño de toque de la casa) + `GoogleLogo` inline (react-native-svg, 4 colores oficiales, SIN
  recolorear). Props `onPress`/`disabled`/`loading`. Un solo archivo (no importa la lib nativa). Cubre:
  R4.2, R4.6, R4.8. → 4 hex del branding como constantes con `design-lint-disable-line`; label con
  `lineHeight="$5"` matching (no recorta la "g").
- [x] **T13** — `components/AppleSignInButton.tsx` (base = impl web-safe: botón propio negro + logo Apple
  SVG) + `components/AppleSignInButton.native.tsx` (iOS → `AppleAuthenticationButton` HIG; Android →
  `null`). **Único** import de `expo-apple-authentication` en un componente, en el `.native`. Cubre: R4.3,
  R4.4 (parte Android por render `null`), R2.5 (bundle web). → negro via `$textPrimary`, logo `$white`.
- [x] **T14** — `components/AuthBits.tsx`: `AuthDivider` (línea + "o" centrado, tokens); export en
  `components/index.ts` junto a `GoogleSignInButton`/`AppleSignInButton` (+ tipos de props). Cubre: R4.1,
  R4.5. → `testID="auth-divider"` para ancla E2E.
- [x] **T15** — `utils/auth-errors.ts`: contexto `'social'` + branches `DEVELOPER_ERROR`, Play Services
  ausente, fallback social (reusa NETWORK). Sin importar libs nativas (puro). Cubre: R6.2, R6.3, R6.4,
  R6.5, R6.6. → codes canónicos `developer_error`/`play_services_not_available` (el servicio normaliza
  el code opaco de la lib antes de llegar acá).
- [x] **T16** — `sign-in.tsx`: insertar `AuthDivider` + `GoogleSignInButton` + (iOS/web)
  `AppleSignInButton` bajo el CTA; handlers `onGoogle`/`onApple` con `googleBusy`/`appleBusy` propios;
  error → `FormError` (`authErrorMessage(..., 'social')`); cancelado → silencio; **sin** navegación
  manual. Los botones sociales **no** se gatean por `locked` y **no** tocan el estado de lockout (R8.5).
  Cubre: R4.1, R4.2, R4.3, R4.4, R6.5, R8.5.
- [x] **T17** — `sign-up.tsx`: mismo bloque que sign-in (mismo layout, R4.7). Cubre: R4.1, R4.2, R4.3,
  R4.4, R4.7.

## Fase 5 — Verificación web (automatizable, sin config de Raf)

- [~] **T18** — `node scripts/check.mjs` (typecheck + unit + suites existentes) **VERDE**: sin regresión
  en spec 01 (los tests de reset-password/lockout/sign-in siguen verdes → confirma R3.5, R8.5). Unit
  nuevos: `auth-errors` contexto `'social'` (R6.1–R6.6), `env-resolve` sin `googleWebClientId` no aborta
  (R7.4). Cubre: R3.5, R6.1–R6.6, R7.3, R7.4, R8.5.
  → **LOCAL VERDE** (subset que no pega a la DB remota): `pnpm typecheck` ✅; unit `auth-errors.test.ts`
  (5 tests social nuevos) + `env-resolve.test.ts` (3 tests R7.4 nuevos) = 22/22 ✅; `check-hardcode.mjs`
  0 violaciones ✅. **El full `check.mjs` (suites backend a la DB remota compartida) queda para el
  reviewer/leader** (fuera del scope de este run — evita el flake de rate-limit con la otra terminal).
- [x] **T19** — `pnpm --dir app e2e:build` (`expo export -p web`) **limpio**: el bundle web NO incluye
  `@react-native-google-signin/google-signin` ni `expo-apple-authentication` (el import nativo vive solo
  en `.native.*`). Cubre: R7.5, R1.7, R2.5.
  → **VERDE**: `Exported: dist`; grep del `dist` = 0 hits de los 9 markers nativos (RNGoogleSignin,
  @react-native-google-signin, hasPlayServices, PLAY_SERVICES_NOT_AVAILABLE, expo-apple-authentication,
  AppleAuthenticationButton, ExpoAppleAuthentication, getRandomBytesAsync, digestStringAsync);
  presencia de `signInWithOAuth` (3) + labels + `auth-divider`.
- [x] **T20** — `app/e2e/social-login.spec.ts` (import de `./helpers/fixtures`): asserts de **render** en
  sign-in y sign-up — divisor "o", botón "Continuar con Google", botón "Continuar con Apple" (web).
  Scopear con `.last()` por el back-stack (patrón `auth.spec.ts`). **No** click-through al proveedor.
  Correr la suite E2E y confirmar verde. Cubre: R4.1, R4.2 (web), R4.3 (web), R4.6, R4.7, R3.1, R3.2.
  **[ojo]** revertir los `design/**/*.png` re-renderizados por el e2e antes de commitear (memoria
  `e2e_design_png_rerender`); no `git add -A` tras un e2e.
  → **ESCRITO** (2 tests: sign-in + sign-up). La **CORRIDA** del E2E queda para el reviewer/leader
  (correrlo re-renderiza los `design/**/*.png` — lo hace quien sabe revertirlos). Se entrega además el
  capture del Gate 2.5 → `app/e2e/captures/social-login.capture.ts` (01 sign-in / 02 sign-up).

## Fase 6 — QA manual en device (gate final — [GATED-RAF])

> **[GATED-RAF]** requiere la config externa cerrada (Google Cloud + Apple Developer + Supabase Dashboard:
> Authorized Client IDs, Redirect URLs, verified-email linking) + un development build en device. El
> happy-path real NO es automatizable. Es el **último gate** (decisión de Raf en `context.md`).

- [ ] **T21** — iOS device: Google (selector nativo → sesión → aterriza en gating de establecimiento);
  Apple (diálogo + nonce → sesión); botón Apple = `AppleAuthenticationButton` HIG. Cubre: R1.2–R1.5,
  R2.2–R2.4, R4.3 (iOS).
- [ ] **T22** — Android device: Google OK; **sin** botón Apple (R2.6/R4.4); dispositivo sin Google Play →
  degrada a email/password con copy (R6.4). Cubre: R2.6, R4.4, R6.4, R1.2–R1.5.
- [ ] **T23** — Web (build desplegado o localhost:8099): Google + Apple redirect → vuelve con sesión
  (`detectSessionInUrl`); cancelar en el proveedor → vuelve sin romper. Cubre: R3.1, R3.2, R3.6.
- [ ] **T24** — Identidad: (a) usuario email/password existente entra con Google del **mismo email** →
  MISMA cuenta, sin duplicar campos (R5.4); (b) alta OAuth nueva → `public.users`/`user_private` creados,
  `name` del claim o fallback (R5.2); (c) OAuth saltea `/verify-email` (R5.3); (d) Apple relay → setear
  password por "Olvidé mi contraseña" y loguear con relay+password (R5.5). Verificar en el Dashboard que
  el email OAuth quedó en `user_private`, no en `users` (R8.6). Cubre: R5.2–R5.5, R8.6.
- [ ] **T24.1** — **[GATED-RAF]** (Gate 1 M1/M2) Verificar la config del Dashboard como criterio
  fail-closed: (a) **Authorized Client IDs** = los 3 client IDs cargados; (b) **`skip_nonce_check = false`**
  (Apple); (c) **verified-email linking** en el modo que asume R8.4; (d) **Redirect URLs** = `localhost:8099`
  + prod; (e) **`enable_confirmations = true`** en el proyecto remoto (R8.4.1 — condición del anti-takeover)
  → reconciliar/documentar el drift de `supabase/config.toml` (relaja T26 SOLO para ese archivo si hace
  falta el cambio). Cubre: R8.8, R8.4.1, R8.2.

## Fase 7 — Reconciliación

- [x] **T25** — Reconciliar specs al as-built (regla dura `docs/specs.md`): si el Gate 1, la
  autorrevisión del implementer o el QA de device cambian el diseño (ej. shape del response de la lib de
  Google por versión, casing de codes, decisión del lockout, nombre de deps), reflejarlo en `design.md` +
  nota bajo el `R<n>` afectado antes de cerrar. Cubre: — (proceso).
  → hecho: `design.md` §"Deltas posteriores" → "Reconciliación as-built — F1–F5" (9 puntos: versiones
  deps, cancelación v16, DEVELOPER_ERROR fuera de statusCodes, normalización de codes canónicos,
  import-type del .native, env-resolve, placeholders, testID divider, verificación del bundle). El *qué*
  (R6.3/R6.4/R7.4) no cambió → no se reescriben los EARS de `requirements.md` (solo refinamiento del cómo).
- [x] **T26** — Guarda de alcance: `git diff` NO toca `supabase/` (sin migración/trigger), ni el
  `PowerSync connector`, ni `_layout.tsx` (gating), ni `supabase.ts` (flowType). Cubre: R3.5, R5.6, R5.7.
  → verificado: mis archivos tocados NO incluyen `supabase/`, `supabase.ts`, `_layout.tsx` ni el connector.
  (Los cambios en `supabase/functions/*` y `supabase/migrations/0124` del `git status` son de la OTRA
  terminal — spec 18 audit-log, pre-existentes; no son míos.)

## Notas de gates

- **Gate 1 (`security_analyzer` modo `spec`) OBLIGATORIO** antes de Puerta 1 (superficie de auth). Output:
  `progress/security_spec_19-login-social.md`. Focos:
  - (a) **Nonce de Apple** correcto (raw a Supabase / hash a Apple; anti-replay) — R2.4, R8.1.
  - (b) `signInWithIdToken` solo acepta tokens con `aud` ∈ **Authorized Client IDs** de Supabase (config
    de Raf); el cliente no valida tokens de otro origen — R8.2, R8.3.
  - (c) **Sin secretos en el cliente**: Web Client Secret solo en Supabase; client IDs no son secretos —
    R7.6.
  - (d) **Auto-linking solo por email verificado** (anti-takeover) — R8.4.
  - (e) **No debilitar** el lockout/rate-limit de spec 01 (R1.7) — R8.5 — ni los invariantes de PII de
    feature 14 (email en `user_private`) — R8.6.
  - (f) `redirectTo` controlado por la app (anti open-redirect) — R8.7.
- **Gate 2 (`security_analyzer` modo `code`)** tras reviewer APPROVED: diff de servicios/context/UI/config.
  Verificar **R8.9** (no se loggean `idToken`/`identityToken`/`rawNonce`/`hashedNonce` ni el mensaje crudo
  del proveedor — grep `console.` en los `*-auth*.ts`; solo el `code` normalizado).
- **Gate 2.5 (ADR-029)**: **SÍ hay UI** (botones + divisor en sign-in/sign-up) → E2E + capturas + veto
  visual antes de la aprobación final. Vetar con captura del render de los botones (branding de Google sin
  recolorear; título sin recorte de descendentes).
