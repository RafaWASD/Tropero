# Requirements — 19-login-social (EARS)

> **Login social** (Google/Gmail + Sign in with Apple) sobre una app que hoy autentica **solo con
> email/password** (spec 01). Baja la fricción de alta; Apple entra en la misma tanda porque agregar
> login social de tercero en iOS **obliga** a ofrecer Sign in with Apple (App Store Guideline 4.8).
>
> Fuente de verdad: `context.md` (Gate 0 **APROBADO por Raf, 2026-07-13**). Todas las decisiones D1–D7
> están LOCKEADAS; acá se traducen a EARS, no se re-deciden. Cada decisión y cada edge case de `context.md`
> queda cubierto por ≥1 `R<n>` (trazabilidad al pie).
>
> Notación EARS estricta (`docs/specs.md`): Ubicuo / Evento (*Cuando*) / Estado (*Mientras*) / Opcional
> (*Donde*) / No deseado (*Si … entonces*). IDs estables — no reordenar tras aprobar. Solo `deberá` /
> `no deberá`.
>
> **Gate 1 (`security_analyzer` modo `spec`) OBLIGATORIO** — es superficie de auth (ver `context.md`
> §"Gate de seguridad" + grupo R8 + `design.md` §Seguridad). Puerta 1 humana después.
>
> **Verificabilidad — límite honesto.** El *happy-path real* de Google/Apple (selector de cuentas
> nativo, diálogo de Apple, redirect OAuth a los servidores del proveedor) **NO es automatizable**: exige
> credenciales reales + interacción con UI de terceros + la config externa de Raf. Lo automatizable por
> **E2E web** es el **render** (botones, divisor, matriz por plataforma en web) y que `expo export -p web`
> quede limpio. Cada `R<n>` marca su método: **[E2E-web]** / **[unit/typecheck]** / **[QA-manual-device]**
> / **[inspección + backend]**.

---

## User stories

- **US1** — Como productor nuevo, quiero entrar con mi cuenta de Google en un toque, para no tener que
  inventar y recordar otra contraseña.
- **US2** — Como usuario de iPhone, quiero "Iniciar sesión con Apple", porque es lo que espero en iOS (y
  sin ello la app no pasa la App Store).
- **US3** — Como usuario que ya tiene cuenta de email/password, quiero que entrar con Google del mismo
  email caiga en mi cuenta de siempre, sin duplicarla ni perder mis campos.
- **US4** — Como operario, quiero que si cancelo el selector o me quedo sin señal, la pantalla no se rompa
  ni me grite un error incomprensible.

---

## Grupo R1 — Google nativo (iOS / Android) — D1

**R1.1** — El sistema deberá exponer una acción `signInWithGoogle(): Promise<AuthActionResult>` en el
`AuthContextValue`. **[unit/typecheck]**

**R1.2** — Cuando el usuario toca "Continuar con Google" en iOS o Android, el sistema deberá abrir el
selector de cuentas nativo vía `@react-native-google-signin/google-signin` (`hasPlayServices()` →
`signIn()`). **[QA-manual-device]**

**R1.3** — Cuando el selector nativo devuelve un `idToken` de Google, el sistema deberá autenticar con
`supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`. **[QA-manual-device]**

**R1.4** — Cuando `signInWithIdToken` de Google resuelve con éxito, el sistema deberá dejar que
`onAuthStateChange` (`SIGNED_IN`) y el `RootGate` re-ruteen, sin navegación manual desde la pantalla.
**[QA-manual-device]**

**R1.5** — Mientras el flujo de Google nativo está en curso, el sistema deberá deshabilitar el botón de
Google y mostrar su estado de carga. **[QA-manual-device]**

**R1.6** — El sistema no deberá enviar un nonce en el flujo de Google (omitido a propósito — D6; la firma
del idToken + `aud` ∈ Authorized Client IDs cierran la superficie). **[inspección + backend]**

**R1.7** — El sistema deberá importar `@react-native-google-signin/google-signin` **únicamente** en
`app/src/services/google-auth.native.ts` (jamás en el bundle web ni en el módulo base). **[E2E-web]**
(verificable indirectamente: `expo export -p web` limpio, R7.5).

---

## Grupo R2 — Apple nativo (iOS) + nonce — D1 / D6

**R2.1** — El sistema deberá exponer una acción `signInWithApple(): Promise<AuthActionResult>` en el
`AuthContextValue`. **[unit/typecheck]**

**R2.2** — Cuando el usuario toca "Continuar con Apple" en iOS, el sistema deberá generar un nonce
(cadena aleatoria **raw** + su hash **SHA-256** vía `expo-crypto`) y llamar
`AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce: hashedNonce })`.
**[QA-manual-device]**

**R2.3** — Cuando `signInAsync` devuelve un `identityToken`, el sistema deberá autenticar con
`supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: rawNonce })` (el nonce
**raw**, no el hasheado). **[QA-manual-device]**

**R2.4** — El sistema deberá incluir **siempre** el nonce en el flujo de Apple (obligatorio, anti-replay —
D6). **[inspección + QA-manual-device]**

**R2.5** — El sistema deberá importar `expo-apple-authentication` y `expo-crypto` **únicamente** en
módulos `.native` (`apple-auth.native.ts` y `AppleSignInButton.native.tsx`), jamás en el bundle web ni en
los módulos base. **[E2E-web]** (indirecto vía R7.5).

**R2.6** — El sistema no deberá mostrar el botón de Apple en Android (no hay Apple nativo en Android; el
cross-device se cubre por R5.4/R5.5 — D2). **[QA-manual-device + inspección]**

---

## Grupo R3 — Web OAuth (Google y Apple) — D1

**R3.1** — Cuando el usuario toca el botón de Google en web, el sistema deberá llamar
`supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`. **[E2E-web]** (el botón
render + wiring; el redirect real a Google no se sigue en E2E).

**R3.2** — Cuando el usuario toca el botón de Apple en web, el sistema deberá llamar
`supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo } })`. **[E2E-web]** (ídem).

**R3.3** — El sistema deberá usar `window.location.origin` como `redirectTo` (redirect en el mismo tab).
**[unit/typecheck + inspección]**

**R3.4** — Cuando el navegador vuelve del redirect de OAuth, el sistema deberá delegar en
`detectSessionInUrl` (ya `true` en web) la recuperación de la sesión, sin cambiar `supabase.ts`.
**[inspección]** (comportamiento de supabase-js).

**R3.5** — El sistema no deberá migrar `flowType` a `pkce` en `supabase.ts` (mantiene implicit global; el
reset-password que hoy anda por fragment no se rompe — ver `design.md` §"Por qué NO tocamos flowType").
**[inspección + unit]** (los tests de spec 01 reset-password siguen verdes).

**R3.6** — Si el redirect de OAuth vuelve con error o el usuario cancela en el proveedor, entonces el
sistema deberá permanecer en la pantalla de auth sin romper. **[QA-manual-device]**

---

## Grupo R4 — UI / botones / matriz por plataforma — D2

**R4.1** — El sistema deberá renderizar un divisor "o" (`AuthDivider`) entre el CTA de email/password y
los botones sociales, tanto en `sign-in.tsx` como en `sign-up.tsx`. **[E2E-web]**

**R4.2** — El sistema deberá renderizar un botón "Continuar con Google" con el logo oficial de Google de
4 colores (SVG inline) en iOS, Android y Web. **[E2E-web (web) + QA-manual-device (native)]**

**R4.3** — Donde la plataforma sea iOS o Web, el sistema deberá renderizar un botón de Apple ("Continuar
con Apple"): el botón HIG nativo (`AppleAuthenticationButton`) en iOS, un botón propio en web.
**[E2E-web (web) + QA-manual-device (iOS)]**

**R4.4** — Donde la plataforma sea Android, el sistema deberá renderizar Google + email/password **sin**
botón de Apple. **[inspección del gate de plataforma + QA-manual-device]**

**R4.5** — El sistema deberá exportar los componentes nuevos (`GoogleSignInButton`, `AppleSignInButton`,
`AuthDivider`) desde `app/src/components/index.ts`. **[unit/typecheck]**

**R4.6** — El sistema no deberá recolorear el logo de Google (branding oficial: azul #4285F4, rojo
#EA4335, amarillo #FBBC05, verde #34A853). **[E2E-web (captura) + inspección]**

**R4.7** — El sistema deberá presentar los botones sociales con el mismo layout en sign-in y sign-up
(consistencia). **[E2E-web]**

**R4.8** — El sistema deberá respetar el tamaño de toque mínimo de la casa (botones grandes, manga-first)
en los botones sociales. **[E2E-web (estilos) + inspección]**

---

## Grupo R5 — Gating / onboarding / linking (sin cambios de código) — D3 / D4 / D5

**R5.1** — El sistema no deberá modificar `onAuthStateChange` ni `getSession` del `AuthContext`: el evento
`SIGNED_IN` que dispara la sesión OAuth ya cubre el bootstrap. **[inspección + unit]**

**R5.2** — Cuando un usuario se autentica por OAuth por primera vez, el sistema deberá crear su fila
`public.users` vía el trigger vigente `handle_new_auth_user` (nombre del claim `raw_user_meta_data->>'name'`
o, si falta, fallback local-part del email), sin tocar el trigger. **[backend + QA-manual-device]**

**R5.3** — Cuando un usuario OAuth queda autenticado, el sistema deberá dejar que el `RootGate` saltee
`/verify-email` (el usuario nace con `email_confirmed_at` → `emailVerified = true`), sin cambios de
gating. **[QA-manual-device + inspección]**

**R5.4** — Cuando un usuario con cuenta email/password existente inicia con Google/Apple del **mismo email
verificado**, el sistema deberá vincular la identidad OAuth a la **misma** cuenta (auto-linking de
Supabase), sin duplicar `public.users` (el trigger hace `on conflict (id) do nothing`). **[backend + QA-manual-device]**

**R5.5** — Si Apple usa "Ocultar mi correo" (`@privaterelay.appleid.com`), entonces el sistema deberá
tratar esa dirección como email verificado y habilitar el **fallback email/password** (el usuario setea
contraseña vía "Olvidé mi contraseña"; el relay reenvía el mail), **sin** UI de detección de relay ni
aviso proactivo (D3 resuelto). **[QA-manual-device]**

**R5.6** — El sistema no deberá tocar el `PowerSync connector` (toma `access_token` de la sesión → es
agnóstico del proveedor; funciona igual con OAuth). **[inspección + unit]**

**R5.7** — El sistema no deberá modificar el trigger `handle_new_auth_user` ni el schema: su cuerpo
vigente (`0068_user_private_pii.sql`) ya inserta `public.users(id, name)` + `public.user_private(user_id,
email)` con `on conflict do nothing`, lo que cubre Google/Apple + el linking de usuario existente.
**[inspección + backend]**

---

## Grupo R6 — Errores / cancelación / copy es-AR — D7

**R6.1** — Si el usuario cancela el selector/diálogo social (Google `SIGN_IN_CANCELLED`, Apple
`ERR_REQUEST_CANCELED`, o abandono del redirect web), entonces el sistema deberá devolver `{ ok: false }`
**sin** objeto de error y no deberá mostrar mensaje de error (cancelación silenciosa). **[unit +
QA-manual-device]**

**R6.2** — Si el flujo social falla por falta de conexión, entonces el sistema deberá mostrar el copy
NETWORK existente ("Sin conexión. Revisá tu internet e intentá de nuevo."). **[unit]**

**R6.3** — Si el flujo de Google falla por `DEVELOPER_ERROR` (misconfig de client ID/SHA-1), entonces el
sistema deberá mostrar un copy es-AR que invite a usar email/contraseña, **sin** filtrar detalle de
config. **[unit]**

**R6.4** — Si Google Play Services no está disponible (ej. Huawei), entonces el sistema deberá mostrar un
copy es-AR que degrade a email/contraseña, sin romper la pantalla. **[unit + QA-manual-device]**

**R6.5** — El sistema deberá reusar `FormError` + `authErrorMessage(error, 'social')` (contexto nuevo
`'social'`) para el copy de los errores sociales. **[unit + E2E-web]**

**R6.6** — El sistema no deberá mostrar al usuario el stack ni el mensaje crudo del proveedor
(`conventions.md` §Errores). **[unit]**

---

## Grupo R7 — Config / build — D1

**R7.1** — `app.json` deberá declarar el plugin `@react-native-google-signin/google-signin` con
`iosUrlScheme` (reversed iOS client ID de Raf), el plugin `expo-apple-authentication`, e
`ios.usesAppleSignIn: true`. **[inspección]** (el `iosUrlScheme` real queda **gated** por la config de
Raf; el placeholder documentado no bloquea el build web).

**R7.2** — `eas.json` deberá declarar `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en los perfiles `preview`,
`development` y `production`. **[inspección]** (el valor real es config de Raf; el web client ID **no** es
secreto).

**R7.3** — `package.json` deberá agregar las dependencias `@react-native-google-signin/google-signin`,
`expo-apple-authentication` y `expo-crypto` (y evaluar `pnpm.onlyBuiltDependencies`). **[unit/typecheck]**

**R7.4** — El sistema deberá exponer `googleWebClientId` (**opcional**) desde `getEnv()` **sin** agregarlo
al set fail-closed de `resolveEnv` (su ausencia no debe abortar el arranque de la app: buildable-now sin
el client ID de Raf). **[unit]**

**R7.5** — `expo export -p web` deberá completar limpio, sin bundlear los módulos nativos de Google/Apple
(el import nativo vive solo en `.native.*`). **[E2E-web (build gate)]**

**R7.6** — El sistema no deberá colocar ningún secreto en el cliente: el Web Client Secret vive **solo**
en el Dashboard de Supabase; los client IDs (web/iOS/Android) no son secretos. **[inspección + Gate 1]**

---

## Grupo R8 — Seguridad — nonce / audience / linking / lockout (Gate 1)

**R8.1** — El sistema deberá pasar a `signInWithIdToken` de Apple el nonce **raw** (Supabase hashea y lo
compara contra el claim `nonce` del idToken de Apple) → anti-replay. **[inspección + Gate 1 + QA-manual]**

**R8.2** — El sistema deberá confiar en que Supabase acepta un idToken **solo si** su `aud` ∈ Authorized
Client IDs del proyecto (config de Raf en el Dashboard); el cliente no valida el token por su cuenta ni
acepta tokens de otro origen. **[Gate 1 + backend/QA-manual]**

**R8.3** — El sistema deberá derivar la identidad de la sesión únicamente del idToken/OAuth verificado por
Supabase, y no deberá tomar identidad (email/uid) de ningún input del cliente. **[inspección + Gate 1]**

**R8.4** — El auto-linking de identidades deberá ocurrir **solo por email verificado** (Google y Apple
devuelven email verificado); el sistema no deberá habilitar linking por email no verificado (anti-account-
takeover). **[Gate 1 + backend]**

**R8.4.1** — (Gate 1 M2) El invariante anti-takeover de R8.4 **depende de que la confirmación de email
esté ACTIVADA en el proyecto Supabase remoto** (`enable_confirmations = true`): con confirmaciones OFF, un
atacante podría pre-crear una cuenta email/password NO verificada con el email de la víctima y que un OAuth
entrante del mismo email se linkee a esa cuenta. `supabase/config.toml` (dev local) hoy declara
`enable_confirmations = false` → **drift a verificar/reconciliar contra el remoto** (T24, Raf). La app YA
exige verificación (spec 01, pantalla `verify-email`), lo que sugiere que el remoto está ON, pero **no se
asume: se verifica**. Ojo con la guarda T26 — reconciliar `config.toml` tocaría `supabase/`. **[Gate 1 +
QA-manual/Dashboard]**

**R8.5** — El sistema no deberá debilitar ni resetear el lockout/rate-limit de password de `sign-in.tsx`
(R1.7 de spec 01): el flujo social no lee password, no incrementa ni limpia el estado de lockout, y no
introduce un camino que evada el rate-limit server-side de Supabase Auth. **[unit + inspección + Gate 1]**

**R8.6** — El sistema no deberá romper los invariantes de PII de feature 14: el email del usuario OAuth
aterriza en `public.user_private` (vía el trigger vigente), no en `public.users`; el audit/PowerSync no
cambian. **[backend + inspección]**

**R8.7** — El sistema deberá usar `window.location.origin` (valor controlado por la app) como `redirectTo`
del OAuth web, nunca un valor tomado de input del usuario (anti open-redirect). **[inspección + Gate 1]**

**R8.8** — (Gate 1 M1) La config del proyecto Supabase (Dashboard) deberá cumplir, como **criterio
verificable** en T24 (fail-closed — una misconfig ROMPE el login, no acepta tokens ajenos): (a) **Authorized
Client IDs** = los 3 client IDs (web/iOS/Android) cargados; (b) **`skip_nonce_check = false`** para Apple;
(c) **verified-email linking** activo; (d) **Redirect URLs** = `http://localhost:8099` + dominio de prod.
**[Gate 1 + QA-manual/Dashboard]**

**R8.9** — (Gate 1 M3) El sistema no deberá loggear el `idToken`/`identityToken`/`rawNonce`/`hashedNonce` ni
ninguna credencial cruda del proveedor; a lo sumo loguea el `code` normalizado del error (nunca el token ni
el mensaje crudo del proveedor). **[inspección + Gate 2]**

---

## Trazabilidad — cada decisión / edge de `context.md` cubierto por ≥1 R

| Fuente en `context.md` | Cubre |
|---|---|
| D1 — Google nativo (`signInWithIdToken`, sin PKCE/deep-link) | R1.1–R1.7 |
| D1 — Apple nativo (nonce raw+SHA256, `signInWithIdToken`) | R2.1–R2.5, R8.1 |
| D1 — Web OAuth (`signInWithOAuth` + `detectSessionInUrl`) | R3.1–R3.4 |
| D1 — `supabase.ts` intacto (no PKCE) | R3.5 |
| D1 — módulos platform-split (import nativo solo en `.native`) | R1.7, R2.5, R7.5 |
| D2 — matriz de botones (iOS: G+A+pass · Android: G+pass · Web: G+A+pass) | R4.1–R4.4, R2.6 |
| D3 — auto-linking por email + relay + password fallback | R5.4, R5.5, R8.4 |
| D4 — linking de usuario email/password existente (`on conflict do nothing`) | R5.4, R5.7 |
| D5 — gating/onboarding sin cambios de código (nace confirmado, name/fallback) | R5.1, R5.2, R5.3, R5.6, R5.7 |
| D6 — nonce Apple obligatorio / Google omitido | R2.4, R1.6, R8.1 |
| D7 — cancelación silenciosa + copy es-AR (DEVELOPER_ERROR, Play Services, red) | R6.1–R6.6 |
| Edge — sin conexión falla claro (login requiere red; no offline-first) | R6.2 |
| Edge — Android sin Google Play → degradar a email/pass | R6.4 |
| Edge — segundo login Apple sin name → no re-pisar | R5.2, R2.6 |
| Edge — bundle web limpio (`expo export -p web`) | R7.5, R1.7, R2.5 |
| Edge — web redirect: `localhost:8099` en Redirect URLs de Supabase | R3.3, R8.7 (config de Raf) |
| Dependencias externas (Google/Apple/Supabase Dashboard) | R7.1, R7.2, R7.6, R8.2 |
| Gate de seguridad (nonce, audience, linking, lockout, PII) | R8.1–R8.9 |
| Gate 1 fix-loop (M1 config Dashboard · M2 confirmations ON · M3 no loggear tokens) | R8.8, R8.4.1, R8.9 |

### Mapa "método de verificación" (honestidad sobre el límite)

- **[E2E-web]** (automatizable, red de seguridad de render): R1.7, R2.5, R3.1, R3.2, R4.1, R4.2 (web),
  R4.3 (web), R4.6, R4.7, R4.8, R6.5, R7.5.
- **[unit / typecheck]**: R1.1, R2.1, R3.3, R4.5, R6.1–R6.6, R7.3, R7.4, R8.5.
- **[QA-manual-device]** (gate final, tras config de Raf — NO automatizable): R1.2–R1.5, R2.2, R2.3,
  R2.6, R3.6, R4.2 (native), R4.3 (iOS), R4.4, R5.3, R5.5, R8.1.
- **[inspección + backend / Gate 1]**: R1.6, R3.4, R3.5, R5.1, R5.2, R5.4, R5.6, R5.7, R8.1–R8.7.

---

## Historial de aprobación

- **2026-07-13** — Gate 0 (Puerta 0, contexto) **APROBADO por Raf** (`context.md`): D1–D7 lockeadas;
  Android sin botón Apple; Apple-relay → fallback password sin aviso; Native+Web; Apple incluido ahora.
- **2026-07-13** — `spec_author` redacta `requirements.md` / `design.md` / `tasks.md`.
- **2026-07-13** — **Gate 1 (`security_analyzer` modo `spec`) = PASS** (0 HIGH; 3 MEDIUM aditivos) →
  `progress/security_spec_19-login-social.md`. **Fix-loop cerrado por el leader** (foldeado a la spec):
  M1 → R8.8 + T24.1 (config Dashboard como criterio fail-closed); M2 → R8.4.1 + design §Anti-takeover
  (dependencia de `enable_confirmations=true` + drift de `config.toml` a verificar en T24); M3 → R8.9 +
  nota de Gate 2 (no loggear tokens/nonce). Sin findings HIGH; los MEDIUM no bloquean el código
  buildable-ya (F1–F5).
- **2026-07-13** — **Puerta 1 APROBADA por Raf** → `in_progress`. Contrato público (`AuthActionResult` +
  2 acciones) **RATIFICADO** por Raf (cambio aditivo). Arranca el implementer con F1–F5 (buildable-ya);
  F6 (device) + config del Dashboard quedan gated por la config externa de Raf. **Coordinación:** el flip
  a `in_progress` se registra acá; NO en `feature_list.json` (Bloque E sin commitear).
- **2026-07-13** — **F1–F5 implementadas** (`progress/impl_19-login-social.md`): typecheck verde, unit
  22/22, `expo export -p web` limpio (0 markers nativos en el bundle → platform-split confirmado), hardcode
  lint 0 violaciones. **Reviewer = APPROVED** (`progress/review_19-login-social.md`; wiring real, sin
  imports muertos, E2E render 6/6, sin regresión spec 01). **Gate 2 (code) = PASS** 0 HIGH
  (`progress/security_code_19-login-social.md`; nonce ok, cero logging de tokens, sin secretos, lockout
  intacto, scope limpio). **Gate 2.5 (ADR-029) = veto visual del leader PASS** (capturas
  `e2e/captures/__shots__/social-login/`; branding Google/Apple correcto por guideline, jerarquía, sin
  recorte de descendentes, centrado por grupo ícono+label OK).
- **2026-07-13** — **Puerta 2 (código) APROBADA por Raf** → commiteada (staging selectivo de la 19, sin
  tocar el WIP del Bloque E). Feature cerrada para el alcance **buildable-ya**. **Pendiente NO-bloqueante
  (no reabre la feature):** F6/T21–T24.1 (QA device + config del Dashboard) gated por la config externa de
  Raf; full `check.mjs` deferido (frontend-only; subset frontend verde) hasta que se destrabe la
  coordinación con el Bloque E; entrada #19 en `feature_list.json` en hold por lo mismo.
- **2026-07-14** — **Config externa de Google COMPLETA + validación web end-to-end (Raf + leader).**
  Google Cloud: 3 OAuth clients creados (Web/iOS/Android + SHA-1). Web + reversed-iOS cableados en
  `eas.json`/`app.json` (commit `1189ae5`). Supabase Dashboard: provider Google habilitado (Web ID+secret,
  3 client IDs en "Client IDs"), redirect `localhost:8099`, **Confirm email = ON** (satisface R8.4.1/M2).
  **VALIDADO CON EVIDENCIA VIVA** (vía el endpoint `/auth/v1/authorize?provider=google` + inspección del
  JWT y de la DB por MCP): sesión OAuth emitida (R3.1/R3.4); **account linking por email verificado**
  (`app_metadata.providers = ["email","google"]`) sin duplicar la cuenta (R5.4/D4); `email_verified=true`
  → saltea verify-email (R5.3); **PII correcta** — email en `public.user_private`, `public.users` sin
  columna email (R8.6, feature 14); `on conflict do nothing` no pisa el name preexistente (R5.4). Nota
  operativa: la cuenta de test estaba baneada por un `delete_account` viejo → desbaneada por MCP (autz de
  Raf); la sesión de prueba se revocó después (tokens vivos habían quedado en el chat). **El boot de la app
  web estática local NO carga** por el gotcha de env de `expo export` (reader dinámico no inlineado; fallback
  a `extra` no expone en web) — **es infra de feature 16, NO login-social**; por eso la validación se hizo
  por el endpoint de authorize, no por la app servida.
- **Pendiente** — **Apple**: espera aprobación de la membresía Apple Developer (inscripción individual en
  curso, 24-48h) → después provider Apple en Supabase + test nativo. **Native (iOS/Android)**: F6/T21–T22
  necesita un dev build en device (el happy-path nativo no es automatizable).
- **Nota de coordinación** — la entrada #19 de `feature_list.json` queda **EN ESPERA** (Bloque E / spec 18
  en Puerta 2; otra terminal con trabajo sin commitear). El estado `spec_ready` se registra en la spec; NO
  se refleja aún en `feature_list.json` (`context.md` §"Resolución de la Puerta 0", punto 3).
