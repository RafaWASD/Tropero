# Config externa — login social (feature 19) — CHECKLIST DE RAF

> Estos pasos son **solo tuyos** (cuentas/paneles fuera del repo). **NO bloquean que yo construya el código** (decisión "código en paralelo"), pero **SÍ bloquean la prueba en device real**. Arrancá por lo de **mayor latencia** (Apple Developer puede tardar en aprobarse).
> Datos del proyecto que vas a necesitar: bundle/package = **`ar.rafq.app`** (iOS = Android) · scheme = **`rafq`** · Supabase project ref = **`xrhlxxdnfzvdnztacofj`** · callback Supabase = **`https://xrhlxxdnfzvdnztacofj.supabase.co/auth/v1/callback`**.

## Progreso (2026-07-18) — CHECKLIST CERRADO ✅

- ✅ **Google Cloud**: 3 OAuth clients creados (Web `...01d8h3qd`, iOS `...8ihanu72`, Android `...ep4siuo1` con SHA-1 `03:07:5E:59:...`). **Validado web (dev) + native (iPhone).**
- ✅ **Código cableado**: Web client ID en `eas.json`, reversed iOS en `app.json` (commit `1189ae5`).
- ✅ **Apple**: membresía **APROBADA 2026-07-16**. App IDs `ar.rafq.app` + `ar.rafq.app.dev` (con capability "Sign in with Apple"), Services ID `ar.rafq.app.web`, Key creada. Team ID `5C9KYFJCU5` · Key ID `XW36J5YCBU`. **Validado web (dev) + native (iPhone).**
- ✅ **Supabase Dashboard**: Google + Apple habilitados en **dev y prod**. Client IDs de Apple con el **Services ID primero** (`ar.rafq.app.web,ar.rafq.app,ar.rafq.app.dev` — ver el gotcha en `design.md`). `skip_nonce_check` = OFF. **Confirm email = ON**. Redirect `localhost:8099`.
- ✅ **Validado end-to-end (web, dev `xrhlxxdnfzvdnztacofj`)**: Google + Apple emiten sesión + linkean por email + PII en `user_private`. (Vía el endpoint de authorize; la app web estática local no bootea por el gotcha de env = feature 16, aparte.)
- ✅ **Native (device, 2026-07-18)**: build `preview` de iOS contra prod `bcrsgekkfcdpwvkebsqe` — **Google + Apple login OK**, confirmado por Raf en iPhone. Era el último gate (F6 / QA manual, ADR-029).
- 🔎 **Edge-case observado en vivo**: Apple "Ocultar mi correo" → relay `@privaterelay.appleid.com` → cuenta **separada** (no linkea). Comportamiento esperado; mitigación = email/password universal (ver `context.md` D3).

---

## 🔴 P1 long-lead — arrancá YA (latencia externa)

### Apple Developer (para Sign in with Apple)
- [ ] Confirmar **membresía del Apple Developer Program** activa (~US$99/año). Si no la tenés, **inscribite ya** — la aprobación puede tardar 24-48 h y es el camino crítico para el flujo Apple.
- [ ] En el App ID `ar.rafq.app`: habilitar la capability **"Sign in with Apple"**.
- [ ] Crear un **Services ID** (identificador para el flujo web) + una **Key** de "Sign in with Apple" (te da un archivo `.p8` — guardalo, se descarga una sola vez) + anotá el **Team ID**. Esto va a Supabase (paso Supabase Dashboard).

### Google Cloud Console
- [ ] Proyecto GCP (nuevo o existente) para "RAFAQ".
- [ ] **OAuth consent screen**: tipo *External*, nombre "RAFAQ", support email, scopes `openid email profile`. Authorized domain: `supabase.co`. Agregá tu mail como *test user* (o publicá la app).
- [ ] **OAuth Client ID — Web application**: guardá el **Client ID** + el **Client Secret**.
  - Authorized redirect URI: **`https://xrhlxxdnfzvdnztacofj.supabase.co/auth/v1/callback`**.
  - Este Web Client ID es el eje: se usa en la app (`GoogleSignin.configure`) y en Supabase.
- [ ] **OAuth Client ID — iOS**: bundle **`ar.rafq.app`**. Guardá el **Client ID** y su **reversed client ID** (formato `com.googleusercontent.apps.XXXX`) → lo necesito para el `iosUrlScheme` del `app.json`.
- [ ] **OAuth Client ID — Android**: package **`ar.rafq.app`** + **SHA-1**. La SHA-1 sale del keystore del build EAS:
  - Corré `eas credentials` (perfil Android *development*) y copiá la SHA-1. Ojo: **hay una SHA-1 distinta por keystore** (dev vs producción) → probablemente necesites **dos** Android clients más adelante (uno para dev, uno para prod).

## 🟡 P2 — cuando tengas los IDs de arriba

### Supabase Dashboard → Authentication → Providers
- [ ] **Google**: habilitar. Pegar el **Web Client ID** + **Web Client Secret**.
  - En **"Authorized Client IDs"**: sumar el **iOS Client ID**, el **Android Client ID** y el **Web Client ID** (es lo que hace que `signInWithIdToken` acepte los tokens nativos).
- [ ] **Apple**: habilitar. Cargar **Services ID** + **Key ID** + **Team ID** + el contenido del `.p8`.
- [ ] **Authentication → URL Configuration → Redirect URLs**: agregar **`http://localhost:8099`** (para dev/E2E web) + el dominio web de producción cuando exista.

### 🔒 Toggles de seguridad críticos (los levantó el Gate 1 — son load-bearing)
- [ ] **Confirmación de email ACTIVADA** (`enable_confirmations = true`) en el proyecto remoto. **Por qué:** el anti-takeover del auto-linking depende de esto — con confirmaciones OFF, alguien podría pre-crear una cuenta sin verificar con el email de otro y quedarse con la cuenta cuando esa persona entre con Google. La app ya usa verificación de email (spec 01), así que probablemente ya está ON — **confirmalo igual**. (Nota técnica para mí: hay drift con `supabase/config.toml` que dice `false` en dev local; lo reconcilio yo.)
- [ ] **Apple → `skip_nonce_check` = OFF/false** (no saltear la validación de nonce) — es la defensa anti-replay del token de Apple.
- [ ] **Linking de cuentas por email verificado** activo (que dos identidades con el mismo email verificado caigan en la misma cuenta) — es lo que hace que Apple↔Google↔email-password del mismo mail sean UNA cuenta.

## Lo que me pasás a mí (para cablear el código)
- **Reversed iOS client ID** (`com.googleusercontent.apps.XXXX`) → va al `iosUrlScheme` del `app.json`.
- **Web Client ID** → va como `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` en `eas.json` (no es secreto).
- (El **Web Client Secret** y el `.p8` de Apple NO me los pases: van SOLO al Supabase Dashboard, nunca al repo.)

## Nota de seguridad
Ningún secreto vive en el código de la app. El único secreto de Google (Web Client Secret) y la Key de Apple (`.p8`) viven **solo** en el Supabase Dashboard. Los Client IDs (Web/iOS/Android) y el reversed client ID **no son secretos** y pueden ir al repo/EAS.
