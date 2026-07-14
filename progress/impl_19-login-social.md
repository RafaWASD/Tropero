baseline_commit: 6f14895671b33350698fea93fcbc795001d8ad5d

# Impl — 19-login-social (F1–F5, buildable-ya)

> Feature en curso: **19-login-social**. Alcance de este run: **Fases F1–F5** (código buildable-ya).
> F6 (QA en device, T21–T24.1) queda **gated** por la config externa de Raf — NO se hace.
> Estado spec: `in_progress` (Puerta 1 aprobada, contrato público ratificado).
>
> **Coordinación:** este archivo (`impl_19-login-social.md`) es un archivo NUEVO específico de la feature
> → collision-safe con la otra terminal. NO se tocan `progress/current.md`, `progress/plan.md`,
> `feature_list.json` (coordinación en hold, otra terminal con trabajo sin commitear).

## Plan (tasks del spec)

- Fase 1 — Config estática: T1 (deps), T2 (env-resolve/env), T3 (eas.json), T4 (app.json).
- Fase 2 — Servicios platform-split: T5 (google-auth.ts), T6 (google-auth.native.ts),
  T7 (google-auth.web.ts), T8 (apple-auth.ts), T9 (apple-auth.native.ts), T10 (apple-auth.web.ts).
- Fase 3 — Context: T11 (AuthContext: AuthActionResult error? + signInWithGoogle/Apple).
- Fase 4 — UI: T12 (GoogleSignInButton), T13 (AppleSignInButton base+native), T14 (AuthDivider+index),
  T15 (auth-errors social), T16 (sign-in), T17 (sign-up).
- Fase 5 — Verificación web: T18 (typecheck+unit local), T19 (expo export -p web limpio),
  T20 (social-login.spec.ts — se ESCRIBE, no se corre acá).
- Fase 7 — T25 (reconciliación de specs), T26 (guarda de alcance: git diff supabase/ vacío).
- **F6 / T21–T24.1 = GATED-RAF → NO se hace en este run.**

## Progreso — F1–F5 COMPLETO (buildable-ya). F6 (device) = GATED-RAF, no se hizo.

### Archivos creados
| Archivo | Qué |
|---|---|
| `app/src/services/google-auth.ts` | Contrato/stub tsc (sin imports nativos). |
| `app/src/services/google-auth.native.ts` | Impl iOS/Android. **Único** import de google-signin. configure→hasPlayServices→signIn→signInWithIdToken. Normaliza codes canónicos. |
| `app/src/services/google-auth.web.ts` | Impl web: `signInWithOAuth({provider:'google'})`, redirectTo=origin. |
| `app/src/services/apple-auth.ts` | Contrato/stub tsc. |
| `app/src/services/apple-auth.native.ts` | Impl iOS. **Único** import de expo-apple-authentication/expo-crypto. Nonce raw→hash a Apple, raw a Supabase. Android→{ok:false}. |
| `app/src/services/apple-auth.web.ts` | Impl web: `signInWithOAuth({provider:'apple'})`. |
| `app/src/components/GoogleSignInButton.tsx` | Botón + logo G 4-colores SVG (constantes con design-lint-disable). |
| `app/src/components/AppleSignInButton.tsx` | Base web-safe (botón negro $textPrimary + Apple SVG $white). |
| `app/src/components/AppleSignInButton.native.tsx` | iOS→AppleAuthenticationButton HIG; Android→null. **Único** import del componente. |
| `app/e2e/social-login.spec.ts` | E2E render sign-in/sign-up (escrito, NO corrido). |
| `app/e2e/captures/social-login.capture.ts` | Capture Gate 2.5 (01 sign-in / 02 sign-up). |

### Archivos modificados
| Archivo | Qué |
|---|---|
| `app/package.json` | +3 deps (`expo install`, SDK 56). `onlyBuiltDependencies` sin cambio. |
| `app/app.json` | plugin google-signin (iosUrlScheme placeholder) + expo-apple-authentication + `ios.usesAppleSignIn:true`. |
| `app/eas.json` | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` placeholder en 3 perfiles. |
| `app/src/utils/env-resolve.ts` | `googleWebClientId?` opcional, fuera del fail-closed. |
| `app/src/contexts/AuthContext.tsx` | `AuthActionResult` error opcional; `signInWithGoogle`/`signInWithApple` wrappers. onAuthStateChange/getSession/lockout intactos. |
| `app/src/utils/auth-errors.ts` | contexto `'social'` + branches `developer_error`/`play_services_not_available` + fallback social. |
| `app/src/components/AuthBits.tsx` | `AuthDivider` (testID auth-divider). |
| `app/src/components/index.ts` | exports de los 3 componentes nuevos + tipos. |
| `app/app/(auth)/sign-in.tsx` | bloque social bajo el CTA. Social NO gateado por `locked` (R8.5). |
| `app/app/(auth)/sign-up.tsx` | ídem (mismo layout R4.7). |
| `app/src/utils/auth-errors.test.ts` | +5 tests contexto social (R6.1–R6.6). |
| `app/src/utils/env-resolve.test.ts` | +3 tests R7.4. |

### Trazabilidad — R<n> → verificación concreta (este run: automatizable)
| R | Cómo se verifica | Dónde |
|---|---|---|
| R1.1 (contrato Google) | typecheck: `signInWithGoogle` en AuthContextValue + base .ts resuelve | tsc ✅ |
| R2.1 (contrato Apple) | typecheck: `signInWithApple` en AuthContextValue | tsc ✅ |
| R4.5 (exports) | typecheck: import desde `@/components` en sign-in/up | tsc ✅ |
| R7.3 (deps) | package.json + typecheck resuelve las libs | tsc ✅ |
| R7.4 (webClientId opcional) | `env-resolve.test.ts` (SIN→undefined, CON→expuesto, requerida faltante→aborta) | 3 tests ✅ |
| R6.1 (cancel silencioso) | contrato: authErrorMessage(undefined,'social')→string; servicio devuelve `{ok:false}` | `auth-errors.test.ts` ✅ + E2E render |
| R6.2 (sin red) | `auth-errors.test.ts` "R6.2 social sin conexión" | ✅ |
| R6.3 (DEVELOPER_ERROR) | `auth-errors.test.ts` "R6.3 social DEVELOPER_ERROR" (sin filtrar config) | ✅ |
| R6.4 (Play Services) | `auth-errors.test.ts` "R6.4 social Play Services" | ✅ |
| R6.5/R6.6 (fallback/no-crudo) | `auth-errors.test.ts` "R6.5/R6.6 social fallback" | ✅ |
| R4.1/R4.2(web)/R4.3(web)/R4.7/R3.1/R3.2 | render sign-in/up | `e2e/social-login.spec.ts` (reviewer corre) |
| R7.5/R1.7/R2.5 (bundle limpio) | `expo export -p web` + grep dist (0 markers nativos) | ✅ local |
| R8.5 (lockout intacto) | inspección: handlers social no llaman registerFailure/resetLockout, no gatean por `locked` | + `lockout.test.ts` sigue verde (reviewer) |
| R3.5 (flowType intacto) | `supabase.ts` NO tocado | git diff ✅ |
| R8.9 (no loggear tokens) | grep: 0 `console.*` en `*-auth*.ts`/botones | ✅ |
| **QA-manual-device** (R1.2–1.5, R2.2–2.6, R3.6, R5.x, R8.1–8.8) | **GATED-RAF — F6, NO en este run** | — |

### Autorrevisión adversarial (paso 8)
Busqué y cerré:
- **(a) imports nativos filtrados a base/web**: verificado por grep del `dist` (0 hits de los 9 markers)
  + inspección: los `.ts`/`.web.ts` base solo importan `type` o `supabase`. Limpio.
- **(b) tokens/nonce logueados**: 0 `console.*` en servicios/botones. rawNonce/hashedNonce/idToken nunca
  se loggean ni se retornan. Dirección del nonce correcta (raw→hash a Apple, raw a Supabase). Limpio.
- **(c) `supabase/` tocado**: mis archivos NO tocan `supabase/` (los cambios de `supabase/` del git status
  son de la otra terminal, spec 18). T26 OK.
- **(d) lockout tocado**: handlers social no incrementan/limpian lockout; botones no gateados por `locked`;
  el CTA primario sigue gateado por `locked` (`anyBusy || locked`, y anyBusy⊇submitting → sin regresión).
- **(e) placeholders que rompan el build web**: `expo export -p web` completó limpio con ambos placeholders.
- **(f) consumidores de `AuthActionResult` que asuman `error` presente**: los 4 consumidores (sign-in,
  sign-up, forgot-password, verify-email) pasan `result.error` a `authErrorMessage`/`isNetworkOrRateLimit`,
  ambos null-safe. Ninguno hace `result.error.<prop>`. Widening a `error?` no rompe nada. (Los `result.error.kind`
  del grep son OTRO Result type — Establishment/invite/profile — no AuthActionResult.)
- **Extra**: verifiqué que la conversión del plugin google-signin de string→array (que `expo install` dejó
  como string) no rompe el export; y que `AppleSignInButton.native` importa el TIPO del base sin ciclo runtime.

Nada quedó abierto tras la autorrevisión.

### Reconciliación de specs (paso 9 / T25)
`design.md` §"Deltas posteriores → Reconciliación as-built (F1–F5)": 9 puntos (versiones deps; cancelación
v16 devuelta no tirada; DEVELOPER_ERROR fuera de statusCodes; normalización a codes canónicos en el
servicio; import-type del `.native`; env-resolve/env.ts; placeholders; testID divider; verificación del
bundle). El *qué* (R6.3/R6.4/R7.4) no cambió → no se reescriben los EARS. `tasks.md` con T1–T20 + T25/T26
marcadas (T18 con nota: subset local verde, full check.mjs = reviewer; T20 escrito, corrida = reviewer).

### Placeholders gated-Raf (documentados, no rompen el build web)
- `app.json` → `iosUrlScheme: "com.googleusercontent.apps.PLACEHOLDER-REVERSED-IOS-CLIENT-ID"`.
- `eas.json` (preview/development/production) → `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "PLACEHOLDER-WEB-CLIENT-ID.apps.googleusercontent.com"`.
- La config del Supabase Dashboard (Authorized Client IDs, skip_nonce_check, verified-email linking,
  Redirect URLs, enable_confirmations) y el `config.toml` (T24/T24.1) = GATED-RAF, NO en este run.

### Decisiones de criterio propio
- **Normalización de codes en el servicio** (no en auth-errors): los `statusCodes` de google-signin v16 son
  opacos/platform-dependientes → el servicio los traduce a codes canónicos estables que auth-errors (puro)
  matchea. Mantiene auth-errors sin imports nativos. (Reconciliado en design.md #4.)
- **`hasPlayServices({ showPlayServicesUpdateDialog: true })`**: prompt de update cuando se puede; cuando
  Play Services no existe (Huawei) tira PLAY_SERVICES_NOT_AVAILABLE → copy R6.4. Estándar de la lib.
- **CTA primario `disabled={anyBusy || locked}`**: deshabilita el login por password mientras corre un flujo
  social (design §Wiring "anyBusy deshabilita todo"), sin tocar el lockout.
- **`AuthDivider` con `testID`**: ancla E2E estable (la "o" suelta no es scopeable).

### Verificación local (SIN pegar a la DB remota)
- `pnpm typecheck` ✅
- unit: `auth-errors.test.ts` + `env-resolve.test.ts` = **22/22** ✅ (8 nuevos)
- `node scripts/check-hardcode.mjs` → **0 violaciones** ✅
- `pnpm e2e:build` (`expo export -p web`) → **Exported: dist**; grep dist = **0** markers nativos, presencia
  de `signInWithOAuth`/labels/`auth-divider` ✅
- **NO** corrí el full `check.mjs` ni el E2E (delegados al reviewer/leader por scope — evitar flake remoto +
  el re-render de `design/**/*.png`).

### Desviaciones de la spec
Ninguna en el *qué*. Solo refinamientos del *cómo* frente a la API real de las libs v16 (todos reconciliados
en design.md #2–#4). Contrato público (`AuthActionResult` + 2 acciones) = aditivo, ya ratificado en Puerta 1.

**NO marco la feature `done`** (eso es del leader tras reviewer + Gate 2 + Gate 2.5).

