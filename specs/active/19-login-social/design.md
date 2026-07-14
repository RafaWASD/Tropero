# Design — 19-login-social

> CÓMO se construye el login social. **100% frontend + config** (no hay migración ni cambio de schema:
> el trigger `handle_new_auth_user` vigente ya cubre OAuth — ver §Identidad cross-provider). Blast-radius
> mínimo por **platform-split**: el import de las libs nativas vive **solo** en archivos `.native`, así
> `expo export -p web` queda limpio. Fuente de verdad de las decisiones: `context.md` (Gate 0, D1–D7).
>
> Aterriza D1–D7 en TypeScript concreto + config `app.json`/`eas.json`/`package.json`. **Mínimo una
> alternativa descartada al pie.**

## Archivos a crear / modificar

| Archivo | Acción | Qué |
|---|---|---|
| `app/src/services/google-auth.ts` | **crear** | Contrato + stub (tsc-only; nunca se bundlea en runtime). Exporta `signInWithGoogle(): Promise<AuthActionResult>`. Sin imports nativos. |
| `app/src/services/google-auth.native.ts` | **crear** | Impl nativa: `GoogleSignin.configure({ webClientId })` → `hasPlayServices()` → `signIn()` → `signInWithIdToken({ provider:'google', token })`. **Único** import de `@react-native-google-signin/google-signin`. |
| `app/src/services/google-auth.web.ts` | **crear** | Impl web: `signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin } })`. Sin libs nativas. |
| `app/src/services/apple-auth.ts` | **crear** | Contrato + stub. Exporta `signInWithApple(): Promise<AuthActionResult>`. Sin imports nativos. |
| `app/src/services/apple-auth.native.ts` | **crear** | Impl nativa iOS: nonce (raw + SHA-256 vía `expo-crypto`) → `AppleAuthentication.signInAsync({ nonce: hashed })` → `signInWithIdToken({ provider:'apple', token, nonce: raw })`. **Único** import de `expo-apple-authentication`/`expo-crypto` del servicio. En Android → `{ ok:false }` (no aplica). |
| `app/src/services/apple-auth.web.ts` | **crear** | Impl web: `signInWithOAuth({ provider:'apple', options:{ redirectTo } })`. Sin libs nativas. |
| `app/src/components/GoogleSignInButton.tsx` | **crear** | Botón "Continuar con Google" (Tamagui) + `GoogleLogo` inline (react-native-svg, 4 colores oficiales, sin recolorear). Un solo archivo (no importa la lib nativa). Props: `onPress`, `disabled`, `loading`. |
| `app/src/components/AppleSignInButton.tsx` | **crear** | **Base = impl web-safe** (botón propio negro + logo Apple SVG). tsc + web + Android-fallback lo resuelven. Sin import nativo. |
| `app/src/components/AppleSignInButton.native.tsx` | **crear** | Impl nativa: en iOS renderiza `AppleAuthentication.AppleAuthenticationButton` (HIG); en Android → `null`. **Único** import de `expo-apple-authentication` en un componente. |
| `app/src/components/AuthBits.tsx` | **modificar** | Agregar `AuthDivider` (línea + "o" centrado, tokens). |
| `app/src/components/index.ts` | **modificar** | Exportar `GoogleSignInButton`, `AppleSignInButton`, `AuthDivider` (+ tipos). |
| `app/src/contexts/AuthContext.tsx` | **modificar** | Agregar `signInWithGoogle` / `signInWithApple` al `AuthContextValue` (wrappers de los servicios platform-split, `useCallback`). **NO** tocar `onAuthStateChange` / `getSession`. Ampliar `AuthActionResult` para el caso cancelado (ver §Tipo). |
| `app/app/(auth)/sign-in.tsx` | **modificar** | Insertar `AuthDivider` + `GoogleSignInButton` + (iOS/web) `AppleSignInButton` bajo el CTA. Handlers `onGoogle`/`onApple` con su `submitting` propio; error → `FormError`; cancelado → silencio; **sin** navegación manual. No debilitar el lockout (R8.5). |
| `app/app/(auth)/sign-up.tsx` | **modificar** | Ídem sign-in (mismo layout, R4.7). |
| `app/src/utils/auth-errors.ts` | **modificar** | Agregar contexto `'social'` + branches: `DEVELOPER_ERROR`, Play Services ausente, sin conexión (reusa NETWORK). |
| `app/src/utils/env-resolve.ts` | **modificar** | Agregar `googleWebClientId?: string` al tipo (OPCIONAL, fuera del check fail-closed). |
| `app/src/utils/env.ts` | **modificar** | Leer `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (opcional). |
| `app/app.json` | **modificar** | Plugins `@react-native-google-signin/google-signin` (`iosUrlScheme`) + `expo-apple-authentication`; `ios.usesAppleSignIn: true`. |
| `app/eas.json` | **modificar** | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en `preview`/`development`/`production`. |
| `app/package.json` | **modificar** | Deps: `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `expo-crypto`. Evaluar `pnpm.onlyBuiltDependencies`. |
| `app/e2e/social-login.spec.ts` | **crear** | E2E web: render del divisor + botón Google + botón Apple (web) en sign-in y sign-up; assert de que el bundle montó (no click-through al proveedor). |

**No se toca**: `app/src/services/supabase.ts` (ver §"Por qué NO tocamos flowType"), el trigger
`handle_new_auth_user`, ningún schema/migración, el PowerSync connector, el gating del `RootGate`. `git
diff supabase/` debe quedar vacío.

---

## Multi-tenancy / RLS (obligatorio mencionarlo — la feature roza la frontera de auth)

No se crean tablas ni policies nuevas. La feature cambia **cómo se obtiene la sesión**, no el modelo de
datos. Lo relevante para el aislamiento multi-tenant: la sesión OAuth produce **el mismo JWT** con el
mismo `auth.uid()` que consumen TODAS las policies de RLS existentes (scoping por `user_roles` /
`establishment_id`). Un usuario que entra con Google ve exactamente los establecimientos de sus
`user_roles` — sin cambios. El único punto de contacto con datos es el trigger `handle_new_auth_user`
(SECURITY DEFINER, ya vigente), que crea `public.users` + `public.user_private` al primer alta. No se
relajan grants ni policies.

## Offline-first (obligatorio — la app es offline-first)

El login social **NO** aplica offline-first, y es correcto: es la **puerta de entrada**, antes de que
exista una sesión que sincronizar. Requiere red igual que `signInWithPassword` (el idToken/OAuth se
valida contra Supabase online). El requisito de campo es que **falle con gracia** sin señal (R6.2:
copy NETWORK), no que funcione offline. Una vez adentro, PowerSync sincroniza igual que hoy (R5.6: el
connector es agnóstico del proveedor).

---

## Arquitectura de los módulos platform-split

**Por qué split de archivos y no `Platform.OS`**: un `if (Platform.OS === 'web')` dentro de un solo
módulo **igual bundlea** el `import '@react-native-google-signin/google-signin'` (estático) en el bundle
web → rompería `expo export -p web`. La resolución por extensión de Metro (`.web` / `.native` / base)
mantiene el import nativo **fuera** del grafo web. Es un **patrón nuevo para este repo** (no había
`.native.ts`/`.web.ts` antes) — se documenta acá. Resolución:

- **Metro (runtime)**: en web resuelve `*.web.ts`; en iOS/Android resuelve `*.native.ts`.
- **tsc (typecheck)**: resuelve el archivo **base** `*.ts` (no conoce las extensiones de plataforma sin
  `moduleSuffixes`, que este repo **no** configura). Por eso el base `.ts` define el **contrato** (la
  firma pública) + un stub. En runtime el base nunca se bundlea para los servicios (web y native tienen
  archivo propio).

```
services/
  google-auth.ts         → export function signInWithGoogle(): Promise<AuthActionResult>  // stub/contrato (tsc)
  google-auth.native.ts  → impl iOS/Android (importa la lib nativa)
  google-auth.web.ts     → impl web (signInWithOAuth)
  apple-auth.ts          → export function signInWithApple(): Promise<AuthActionResult>   // stub/contrato (tsc)
  apple-auth.native.ts   → impl iOS (nonce + signInAsync); Android → { ok:false }
  apple-auth.web.ts      → impl web (signInWithOAuth)
```

> **Nota de criterio (para Puerta 1):** el `AppleSignInButton` se resuelve con **base + `.native`** (2
> archivos), NO con la tríada. El base `.tsx` ES la impl web (botón propio, web-safe) → tsc y web usan el
> base; iOS/Android usan `.native.tsx` (HIG en iOS, `null` en Android). Un solo archivo importando
> `expo-apple-authentication` filtraría la lib nativa al bundle web; por eso el split. Esto expande el
> listado literal del context (`AppleSignInButton.tsx`) a 2 archivos, justificado por el gate de bundle
> web + la resolución de tsc.

### Firma de las acciones del context

`AuthContextValue` suma:

```ts
signInWithGoogle: () => Promise<AuthActionResult>;
signInWithApple: () => Promise<AuthActionResult>;
```

El context wrappea los servicios (`useCallback`), sin lógica extra salvo normalización. **No** toca
`onAuthStateChange`/`getSession` (el `SIGNED_IN` del OAuth ya emite → `stateFromSession` re-deriva el
estado; el `RootGate` re-rutea, R5.1).

### Tipo `AuthActionResult` — el caso "cancelado silencioso"

Hoy: `{ ok: true } | { ok: false; error: {...} }`. La cancelación del picker debe ser `{ ok:false }`
**sin** error (R6.1). Se hace `error` **opcional** en la variante `false`:

```ts
export type AuthActionResult =
  | { ok: true }
  | { ok: false; error?: AuthErrorLike };   // error ausente = cancelación silenciosa
```

- **Consumidores existentes intactos**: `sign-in.tsx`/`sign-up.tsx` leen `result.error` dentro del branch
  `!result.ok`; los flujos password **siempre** traen `error`, así que su comportamiento no cambia
  (`authErrorMessage(undefined)` devolvería GENERIC, pero nunca se alcanza porque error está presente).
- **Handler social**: `if (result.error) setFormError(authErrorMessage(result.error, 'social'))` — si no
  hay error (cancelado), no muestra nada.

> **[Contrato público — confirmar en Puerta 1]** `AuthContextValue` y `AuthActionResult` son tipos
> exportados (CLAUDE.md: "confirmar antes de modificar contratos públicos"). El cambio es **aditivo**
> (dos acciones + `error?` opcional); se marca para ratificación de Raf.

### Flujo de nonce de Apple (D6 / R8.1) — el punto crítico

```
1. rawNonce   = hex(await Crypto.getRandomBytesAsync(16))            // secreto per-intento
2. hashedNonce= await Crypto.digestStringAsync(SHA256, rawNonce)     // lo que ve Apple
3. credential = await AppleAuthentication.signInAsync({ nonce: hashedNonce, requestedScopes:[FULL_NAME,EMAIL] })
                → Apple firma un idToken con claim  nonce = hashedNonce
4. supabase.auth.signInWithIdToken({ provider:'apple', token: credential.identityToken, nonce: rawNonce })
                → Supabase computa SHA256(rawNonce) y lo compara contra el claim nonce del idToken
```

Se le pasa a **Apple el hash** y a **Supabase el raw**; Supabase cierra el lazo. Sin nonce, un idToken de
Apple robado podría replayarse (D6). Google **omite** nonce a propósito (R1.6): su idToken lleva `aud` =
el web client ID, y Supabase rechaza si `aud` ∉ Authorized Client IDs (R8.2) — la fragilidad de versión
de la lib al pasar nonce no compensa.

---

## Matriz de botones por plataforma (D2)

| Plataforma | email/password | Google | Apple |
|---|---|---|---|
| **iOS** | ✅ | ✅ nativo (`signInWithIdToken`) | ✅ nativo (`AppleAuthenticationButton` HIG) |
| **Android** | ✅ | ✅ nativo (`signInWithIdToken`) | ❌ (sin botón — R2.6/R4.4) |
| **Web** | ✅ | ✅ redirect (`signInWithOAuth`) | ✅ redirect (`signInWithOAuth`) |

La pantalla decide el render de Apple con `Platform.OS === 'ios' || Platform.OS === 'web'`. En Android el
botón simplemente no se monta (el cross-device de un usuario Apple se cubre por linking de email + el
password fallback — §Identidad).

---

## Identidad cross-provider (D3 / D4 / D5) — sin cambios de código

**El trigger vigente ya cubre OAuth.** Se verificó el cuerpo **actual** de `handle_new_auth_user` (fue
redefinido por `0068_user_private_pii.sql`, NO es el de `0001`):

```sql
-- 0068_user_private_pii.sql (cuerpo VIGENTE)
v_name := coalesce(nullif(trim((new.raw_user_meta_data ->> 'name')), ''), split_part(new.email, '@', 1));
insert into public.users (id, name)        values (new.id, v_name)      on conflict (id) do nothing;
insert into public.user_private (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
```

- **Alta OAuth nueva (R5.2)**: Supabase crea el `auth.users`; el trigger inserta `users.name` (del claim)
  + `user_private.email`. Google entrega el claim `name` en el idToken → `raw_user_meta_data->>'name'`.
  Apple **no** manda el nombre en el idToken (solo en la respuesta de autorización, la 1ª vez) → cae el
  fallback `split_part(email,'@',1)`. `name NOT NULL` queda satisfecho siempre.
- **Linking de usuario existente (R5.4/D4)**: si el email verificado ya existe, Supabase **suma la
  identidad OAuth a la MISMA `auth.users`** (auto-linking por email verificado); el trigger corre con
  `on conflict do nothing` → **no pisa** `public.users`/`user_private`. Sin data-loss, sin duplicado.
- **Gating (R5.3/D5)**: el usuario OAuth nace con `email_confirmed_at` → `isEmailVerified() = true` →
  `RootGate` saltea `/verify-email` y cae al gating de establecimiento. Cero cambios en `_layout.tsx`.
- **Caso relay (R5.5/D3)**: Apple "Ocultar mi correo" → `xxx@privaterelay.appleid.com` (email verificado)
  → si no coincide con su Gmail, Supabase crea cuenta separada. **Mitigación MVP (firme)**: fallback
  email/password universal — el usuario setea contraseña por "Olvidé mi contraseña" (el relay reenvía el
  mail) y loguea con `relay + password` en cualquier device. **Sin UI de detección de relay** (D3
  resuelto por Raf).

> **Gotcha para el QA de device (no es cambio de código):** el trigger keyea sobre
> `raw_user_meta_data->>'name'`. Hay que confirmar en device que la mapping del provider de Supabase
> puebla `name` (Google) y que Apple efectivamente cae al fallback local-part. Peor caso = nombre =
> local-part del email (aceptable). No requiere código; queda como watch-item del gate manual.

### Anti-takeover (R8.4 — Gate 1)

El auto-linking de Supabase solo une identidades cuando el email está **verificado**. RAFAQ exige
verificación de email (spec 01), así que las cuentas email/password son verificadas; Google/Apple
devuelven email verificado. No hay camino de linking por email no verificado → no se puede secuestrar una
cuenta ajena logueando con un OAuth de email no confirmado. Gate 1 debe confirmar que la config del
Dashboard (Supabase Auth → "Enable automatic linking" / verified-email linking) está en el modo que
asume esta spec.

> **⚠️ Gate 1 M2 (dependencia load-bearing, R8.4.1):** este argumento **asume que la confirmación de email
> está ACTIVADA en el remoto** (`enable_confirmations = true`). Si estuviera OFF, un atacante podría
> pre-crear una cuenta email/password **no verificada** con el email de la víctima, y el OAuth entrante del
> mismo email se linkearía a la cuenta del atacante (takeover). El archivo `supabase/config.toml`
> (config **local** de dev) hoy declara `enable_confirmations = false` (`config.toml:221`) y `[auth.external.apple]
> enabled = false`, sin bloque Google → hay **drift** entre el config committeado y el comportamiento real
> del remoto (la app tiene pantalla `verify-email` viva → sugiere ON en el remoto, pero **se verifica, no se
> asume**). **Acción (T24, Raf):** confirmar `enable_confirmations = true` en el proyecto Supabase remoto
> antes de habilitar el linking en prod, y reconciliar/documentar el `config.toml`. **Tensión con T26:**
> reconciliar `config.toml` tocaría `supabase/` — si hace falta el cambio, T26 se relaja SOLO para ese
> archivo de config (documentado), no para migraciones/triggers.

---

## Por qué NO tocamos `flowType`

`supabase.ts` **no** setea `flowType` → el cliente usa el default **implicit**. Migrar a `pkce`:

- Es un setting **global** del cliente, **no** per-provider — afectaría a todos los flujos de auth.
- **Rompería el reset-password** que hoy anda: el link de recuperación vuelve con los tokens en el
  **fragment** (`#access_token=…`) y `detectSessionInUrl: true` los levanta. PKCE cambiaría los links a
  `?code=…` requiriendo `exchangeCodeForSession`, con el deep-link que el proyecto **deliberadamente no
  cableó** (`context.md` §Estado actual).
- **No es necesario** para esta feature:
  - **Native** (Google/Apple) usa `signInWithIdToken` → no hay browser flow, `flowType` es irrelevante.
  - **Web** usa `signInWithOAuth` → con implicit, el provider vuelve con tokens en el fragment y
    `detectSessionInUrl` (ya `true`) los recupera (R3.4). Funciona sin PKCE.

Conclusión: `supabase.ts` queda **intacto** (R3.5). Documentado para que el reviewer no lo "arregle" por
costumbre.

---

## Manejo de errores (D7 / R6) — `auth-errors.ts`

Los servicios normalizan el error de la lib nativa al shape `AuthErrorLike` (`{ code, message, ... }`) y
la pantalla llama `authErrorMessage(error, 'social')`. Branches nuevos:

| Caso | Origen | Copy es-AR |
|---|---|---|
| Cancelado | `SIGN_IN_CANCELLED` / `ERR_REQUEST_CANCELED` | **(ninguno)** — el servicio devuelve `{ ok:false }` sin error → silencio (R6.1) |
| Sin conexión | fetch/AuthRetryableFetchError | (reusa NETWORK existente) "Sin conexión. Revisá tu internet e intentá de nuevo." (R6.2) |
| DEVELOPER_ERROR | `statusCodes.DEVELOPER_ERROR` (Google) | "No pudimos iniciar con Google. Probá con tu email y contraseña." (R6.3 — sin filtrar config) |
| Play Services ausente | `PLAY_SERVICES_NOT_AVAILABLE` | "Necesitás Google Play para iniciar con Google. Usá tu email y contraseña." (R6.4) |
| Fallback social | cualquier otro | "No pudimos iniciar sesión con ese método. Probá con tu email y contraseña." |

La detección de cancelación vive en `google-auth.native.ts` / `apple-auth.native.ts` (comparan el code de
la lib), NO en `auth-errors.ts` (que es puro y no importa las libs nativas). Así el cancelado nunca llega
como "error" a la UI.

> **Gate 1 M3 (R8.9) — no loggear tokens.** Los servicios `*-auth.native.ts` normalizan el error a
> `{ code, message }` para la UI, pero **no deben loggear** el `idToken`/`identityToken`/`rawNonce`/`hashedNonce`
> ni el mensaje crudo del proveedor (ni por `console.*` en dev). Si se necesita telemetría del fallo, loggear
> SOLO el `code` normalizado. Verificable en Gate 2 (grep de `console.` + shape de lo logueado).

---

## Config (R7)

**`app.json`** — plugins + entitlement iOS:

```jsonc
"ios": { "usesAppleSignIn": true, /* … */ },
"plugins": [
  /* … existentes … */,
  ["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<REVERSED_IOS_CLIENT_ID>" }],
  "expo-apple-authentication"
]
```

- `iosUrlScheme` = reversed iOS client ID → **gated por la config de Raf** (Google Cloud). Hasta tenerlo,
  se deja el placeholder documentado; **no** bloquea `expo export -p web` (web no usa el plugin de
  Google-signin nativo).
- `expo-crypto` **no** necesita config plugin (autolinking).

**`eas.json`** — el web client ID en los 3 perfiles (no es secreto; mismo criterio que la anon key ya
presente):

```jsonc
"env": { /* … */, "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "<WEB_CLIENT_ID>.apps.googleusercontent.com" }
```

**`package.json`** — deps:

```jsonc
"@react-native-google-signin/google-signin": "…",
"expo-apple-authentication": "…",     // versión alineada al SDK 56 (expo install)
"expo-crypto": "…"                    // idem
```

- **`pnpm.onlyBuiltDependencies`**: `expo-apple-authentication`/`expo-crypto` son módulos Expo (build
  cubierto por `expo-modules-core`, ya whitelisteado). `@react-native-google-signin/google-signin` se
  compila en el prebuild (CNG), no tiene postinstall que requiera whitelist. **Evaluación: probablemente
  sin cambio**; el implementer confirma tras `pnpm install` (si pnpm pide aprobar un build script, se
  agrega — memoria `package_manager_pnpm`).
- Versiones exactas: `npx expo install` las alinea al SDK 56 (no fijar a mano).

**`env-resolve.ts` / `env.ts`** — `googleWebClientId` **opcional** (fuera del throw fail-closed): su
ausencia no debe abortar el arranque (buildable-now). El nativo lo lee en `configure`; si falta en
runtime, el sign-in de Google falla con `DEVELOPER_ERROR` → copy R6.3 (degradado aceptable pre-config).

---

## Wiring en las pantallas (R4)

Bajo el CTA primario (antes de los `LinkButton`), en sign-in y sign-up:

```tsx
<AuthDivider />
<GoogleSignInButton onPress={onGoogle} disabled={anyBusy} loading={googleBusy} />
{(Platform.OS === 'ios' || Platform.OS === 'web') && (
  <AppleSignInButton onPress={onApple} disabled={anyBusy} loading={appleBusy} />
)}
```

- **Estados de carga independientes**: `googleBusy` / `appleBusy` propios; `anyBusy = submitting ||
  googleBusy || appleBusy` deshabilita todo mientras uno corre.
- **Handler** (patrón de `signIn`):

```tsx
async function onGoogle() {
  setFormError(null);
  setGoogleBusy(true);
  const result = await signInWithGoogle();
  setGoogleBusy(false);
  if (result.ok) return;                 // el RootGate re-rutea al cambiar el AuthState
  if (result.error) setFormError(authErrorMessage(result.error, 'social'));  // sin error = cancelado = silencio
}
```

- **Sin navegación manual** (el `RootGate` re-rutea, como el password login).
- **Lockout (R8.5)**: en sign-in, el botón de Google/Apple **no** se gatea por `locked` (el lockout es la
  defensa anti-brute-force del **password**; el OAuth no es brute-forceable), y el flujo social **no**
  llama `registerFailure`/`resetLockout` → no toca el estado de lockout.

> **Nota de criterio (para Puerta 1):** interpretación de "respetar el lockout" (R8.5). Elijo **no gatear**
> los botones sociales con el lockout de password y **no** tocar su estado — el lockout protege el guessing
> de password, que el OAuth no ejercita; bloquear social solo dañaría al usuario legítimo trabado en el
> password. Se preserva íntegro el lockout del password (no se debilita ni resetea). Raf valida.

---

## Enfoque de tests

- **`app/e2e/social-login.spec.ts`** (nuevo, web): importa `test`/`expect` de `./helpers/fixtures`
  (memoria `e2e_fixtures_import`). Asserts de **render** en `/(auth)/sign-in` y `/(auth)/sign-up`:
  divisor "o", botón "Continuar con Google", botón "Continuar con Apple" (web sí muestra Apple). Scopear
  con `.last()` por el back-stack montado (patrón de `auth.spec.ts`). **No** se hace click-through (el
  tap dispararía un redirect real a Google/Apple → fuera del alcance E2E). Cubre R4.1, R4.2(web),
  R4.3(web), R4.6, R4.7, R3.1/R3.2 (presencia + wiring).
- **Unit** (`node:test`, lógica pura): `auth-errors` con contexto `'social'` (cancelado→sin copy,
  DEVELOPER_ERROR, Play Services, NETWORK) — R6.1–R6.6; `env-resolve` con/ sin `googleWebClientId` (no
  aborta) — R7.4.
- **Typecheck**: `signInWithGoogle`/`signInWithApple` en el context; exports de components; base `.ts`
  resuelve el contrato — R1.1, R2.1, R4.5, R7.3.
- **`expo export -p web` limpio** (gate de bundle) — R7.5, R1.7, R2.5.
- **QA-manual-device** (gate final, tras la config de Raf): el selector real de Google, el diálogo de
  Apple + nonce, linking de email existente, relay, Play Services ausente — R1.2–R1.5, R2.2–R2.6, R5.x,
  R8.1. **Honesto: el happy-path real NO es automatizable.**

---

## Alternativas descartadas

**A) `Platform.OS` branch en un solo módulo (sin split de archivos).** Más simple de leer, pero el
`import` estático de la lib nativa queda en el grafo del bundle web igual → `expo export -p web` se rompe
o infla. El split por extensión (Metro) es la única forma de mantener el import nativo **fuera** del web.
Elegido el split.

**B) `expo-auth-session` / flujo OAuth por browser también en native (con PKCE + deep-link).** Unificaría
las 3 plataformas en `signInWithOAuth`, pero exige **migrar `flowType` a PKCE** (rompe reset-password,
§"Por qué NO tocamos flowType") y **cablear el deep-link** que el proyecto difirió a propósito
(`context.md`). Mucho más blast-radius. Descartada — native usa `signInWithIdToken` (picker nativo, sin
browser).

**C) Apple nativo también en Android (browser flow).** Cubriría al usuario Apple-relay en Android sin
password, pero mete el deep-link/universal-links que evitamos y un flujo web de Apple frágil. Descartada
(D3): el relay se cubre con el **password fallback** (más barato, sin deep-link).

**D) Botón de Apple con estilo propio en iOS (en vez de `AppleAuthenticationButton`).** Un botón custom
que "parezca" HIG evitaría el split del componente, pero la review de la App Store es estricta con el
botón de Apple y clavar la HIG a mano (radio, padding del logo, dynamic type) es propenso a rechazo. Se
usa el `AppleAuthenticationButton` oficial en iOS (garantía HIG) vía `AppleSignInButton.native.tsx`;
web/base = botón propio. Elegido el nativo en iOS.

**E) Pantalla de gestión de identidades vinculadas (link/unlink en Perfil).** Fuera de MVP (`context.md`
§Fuera de scope). El linking automático por email + el password fallback cubren el MVP sin UI de gestión.

---

## Fuera de scope (NO-MVP — documentado)

- Apple nativo en Android (browser flow).
- Deep-linking / universal links (sigue diferido; esta feature no lo destraba).
- Otros proveedores (Facebook, Microsoft, …).
- Migrar `flowType` a PKCE.
- Pantalla de gestión de identidades vinculadas en Perfil (link/unlink manual).

## Dependencias externas — SOLO RAF (bloquean el QA de device, NO el código)

- **Google Cloud**: consent screen + OAuth Client Web (ID + Secret) + iOS (reversed client ID) + Android
  (package + **SHA-1** vía `eas credentials`).
- **Apple Developer** (~US$99/año): capability "Sign in with Apple" + Services ID + Key.
- **Supabase Dashboard**: habilitar Google + Apple; **Authorized Client IDs** (iOS/Android/Web); Redirect
  URLs (`http://localhost:8099` + prod); verified-email linking en el modo de R8.4.

## Deltas posteriores

### Reconciliación as-built — F1–F5 (implementer, 2026-07-13)

Ajustes al construir el código buildable-ya. No cambian el *qué* (los `R<n>` siguen válidos); precisan el
*cómo* frente a la API real de las libs (versiones alineadas por `expo install` al SDK 56).

1. **Versiones de deps (T1/R7.3).** `expo install` resolvió `@react-native-google-signin/google-signin
   ^16.1.2`, `expo-apple-authentication ~56.0.4`, `expo-crypto ~56.0.4`. `pnpm` NO reportó "ignored build
   scripts" → **`pnpm.onlyBuiltDependencies` queda sin cambios** (como anticipaba el design).

2. **Cancelación de Google en la v16 (T6/R6.1).** En `@react-native-google-signin` v16 la cancelación del
   selector se **DEVUELVE** como respuesta `{ type: 'cancelled' }` (helper `isSuccessResponse` → false), NO
   se **tira** como `SIGN_IN_CANCELLED`. El servicio trata ese caso como `{ ok:false }` silencioso. Se
   mantiene además la guarda en el `catch` (`statusCodes.SIGN_IN_CANCELLED`/`IN_PROGRESS` → silencio) por si
   otra versión la tira. El invariante R6.1 (cancelar = silencio) se cumple igual.

3. **`DEVELOPER_ERROR` fuera de `statusCodes` en la v16 (T6/R6.3).** El `statusCodes` de la v16 exporta
   `{ SIGN_IN_CANCELLED, IN_PROGRESS, PLAY_SERVICES_NOT_AVAILABLE, SIGN_IN_REQUIRED, NULL_PRESENTER }` —
   **no** incluye `DEVELOPER_ERROR`. En Android el misconfig llega como `code` string crudo
   `'DEVELOPER_ERROR'`. El servicio lo compara por string y lo normaliza.

4. **Normalización de codes en el servicio → codes canónicos en `auth-errors` (T6/T15).** Como los valores
   de `statusCodes` son platform-dependientes (opacos), `google-auth.native.ts` **normaliza** el code de la
   lib a un code **canónico estable** ANTES de la UI: `PLAY_SERVICES_NOT_AVAILABLE → 'play_services_not_available'`,
   `'DEVELOPER_ERROR' → 'developer_error'`. `auth-errors.ts` (puro, sin imports nativos) matchea esos codes
   canónicos. Esto **refina** la fila de la tabla §Manejo de errores (que citaba `statusCodes.DEVELOPER_ERROR`
   directo): la comparación con `statusCodes` vive en el servicio, no en `auth-errors`. El copy es-AR y los
   invariantes R6.3/R6.4/R6.6 no cambian.

5. **`AppleSignInButton` — el `.native` importa el TIPO del base (T13).** `AppleSignInButton.native.tsx` hace
   `import type { AppleSignInButtonProps } from './AppleSignInButton'`. tsc resuelve el base (donde vive el
   tipo); en runtime el `import type` se **borra** (babel), así Metro nunca resuelve ese specifier → sin
   ciclo. Patrón estándar de split base+`.native`.

6. **`env-resolve` (T2/R7.4).** `googleWebClientId?: string` se agregó al tipo `RequiredEnv` (opcional),
   leído **después** del throw fail-closed. **`env.ts` no se tocó**: su reader genérico `readPublicEnv` ya
   cubre `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` a través de `resolveEnv` (getEnv() ahora expone el campo).

7. **Placeholders gated-Raf (T3/T4).** `app.json` → `iosUrlScheme:
   "com.googleusercontent.apps.PLACEHOLDER-REVERSED-IOS-CLIENT-ID"`; `eas.json` (3 perfiles) →
   `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "PLACEHOLDER-WEB-CLIENT-ID.apps.googleusercontent.com"`. Verificado:
   `expo export -p web` completa limpio con estos placeholders (R7.5).

8. **`AuthDivider` con `testID="auth-divider"` (T14).** La letra "o" suelta no es scopeable por texto en
   E2E; el `testID` da un ancla estable (patrón del repo). No cambia el render visual.

9. **Verificación local del bundle (T19/R7.5/R1.7/R2.5).** `expo export -p web` + grep del `dist`: 0 hits de
   `RNGoogleSignin`, `@react-native-google-signin`, `hasPlayServices`, `PLAY_SERVICES_NOT_AVAILABLE`,
   `expo-apple-authentication`, `AppleAuthenticationButton`, `ExpoAppleAuthentication`, `getRandomBytesAsync`,
   `digestStringAsync`; y presencia de `signInWithOAuth` (3) + los labels de los botones + `auth-divider`.
   El platform-split mantiene los módulos nativos fuera del bundle web.

(baseline inicial de la feature 19 — sin deltas de producto todavía)
