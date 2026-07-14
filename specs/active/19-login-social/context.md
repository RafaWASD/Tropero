# Contexto — 19-login-social (Gate 0, ADR-022)

> Refinamiento de contexto previo a la spec. Cierra las decisiones de fondo para que `spec_author` no improvise.
> Estado: **`context_ready`** — **Puerta 0 APROBADA por Raf (2026-07-13)**. Habilita al `spec_author`.
> Fecha: 2026-07-13. Origen: plan aprobado `C:/Users/RAR20313/.claude/plans/me-gustar-a-agregar-la-async-starfish.md` (pedido de Raf: "login con Gmail"). Decisiones de alcance ya tomadas en la sesión de plan (ver más abajo).

## Objetivo

Bajar la fricción de alta agregando **login social**: **Google (Gmail)** + **Sign in with Apple**. Hoy la app autentica **solo con email/password** (`AuthContext.tsx`, spec 01). Apple entra en la misma tanda porque agregar login social de tercero en iOS **obliga** a ofrecer Sign in with Apple para pasar la App Store (Guideline 4.8; email/password NO cuenta como equivalente).

## Estado actual (verificado)

- **Auth = solo email/password** (`signInWithPassword`/`signUp`/`resetPasswordForEmail`). Cero OAuth/`signInWithIdToken`/`signInWithOAuth`.
- **`@supabase/supabase-js ^2.106.1` instalado**; NO están `@react-native-google-signin/google-signin`, `expo-apple-authentication`, `expo-crypto`.
- **Cliente Supabase** (`app/src/services/supabase.ts`): `detectSessionInUrl: Platform.OS === 'web'` (ya en `true`), storage SecureStore/localStorage, **sin `flowType`** (implicit por default).
- **Build**: development builds vía EAS + **prebuild/CNG** (sin `ios/`/`android/` committeados). NO Expo Go. `scheme: "rafq"`, bundle `ar.rafq.app` (iOS = Android).
- **Deep-linking NO cableado** (`expo-linking` instalado pero sin uso; TODOs diferidos). El dominio `app.rafq.ar` no existe aún.
- **PowerSync connector** toma `access_token` de la sesión → **agnóstico del proveedor** (funciona igual con OAuth).
- **Gating**: `RootGate` (`app/app/_layout.tsx:314`) saltea `/verify-email` si `emailVerified`. Trigger `handle_new_auth_user` (`0001_users.sql`) copia `raw_user_meta_data->>'name'` a `public.users.name` con `on conflict (id) do nothing`.
- **Targets**: iOS, Android y Web. E2E Playwright corre **solo sobre web** (`localhost:8099`).

## Decisiones de alcance ya tomadas (sesión de plan, Raf)

- **Plataformas**: Native + Web.
- **Apple**: incluido ahora (no fast-follow).
- **Secuencia**: código en paralelo a la config externa de Raf; prueba en device = último gate.

## Decisiones de Gate 0 (lo que se cierra)

### D1 — Enfoque técnico: platform-split, native-first (blast-radius mínimo)
- **Native Google (iOS/Android)**: `@react-native-google-signin/google-signin` → `signInWithIdToken({ provider:'google', token })`. Account picker nativo, **sin PKCE ni deep-link**.
- **Native Apple (iOS)**: `expo-apple-authentication` + **nonce** (raw + SHA-256 vía `expo-crypto`) → `signInWithIdToken({ provider:'apple', token, nonce })`.
- **Web (Google y Apple)**: `signInWithOAuth({ provider, options:{ redirectTo } })` (redirect same-tab; la sesión la levanta `detectSessionInUrl`).
- **`supabase.ts` intacto**: NO se migra a `flowType:'pkce'` (rompería el reset-password que hoy anda por fragment; es setting global no aplicable por-provider). Documentar el porqué.
- Módulos platform-split aislados (`google-auth.native/.web/.ts`, `apple-auth.native/.web/.ts`) — el import de la lib nativa vive **solo** en `.native.ts` (protege el bundle web).

### D2 — Matriz de botones por plataforma
- **iOS**: Google (nativo) + Apple (nativo, `AppleAuthenticationButton` HIG) + email/password.
- **Android**: Google (nativo) + email/password. **Apple NO tiene botón** (no hay Apple nativo en Android; el caso cross-device se cubre por D3).
- **Web**: Google (redirect) + Apple (redirect) + email/password.

### D3 — Identidad cross-provider / cross-device (Apple relay)
- Supabase **linkea automáticamente** identidades con el **mismo email verificado** → una cuenta. Google y Apple devuelven email verificado.
- **Caso OK**: Apple compartiendo el email real (típicamente su Gmail) → en Android inicia con Google, mismo email, misma cuenta.
- **Caso problemático (único)**: Apple con **"Ocultar mi correo"** (`@privaterelay.appleid.com`) → no coincide con el Gmail → Google crearía cuenta separada.
  - **Mitigación (MVP)**: **email/password como fallback universal** — cualquier usuario OAuth puede setear password vía "Olvidé mi contraseña"; el relay reenvía el mail, así que puede loguear con `email(relay)+password`.
- **Decisión**: confiar en auto-linking por email + password fallback; Apple = botón nativo **solo-iOS**. Descartado (más scope): Apple-por-web en Android (mete el deep-link que evitamos).

### D4 — Account linking de usuario email/password existente
- Un usuario que ya tiene cuenta email/password y loguea con Google/Apple del **mismo email verificado** → Supabase suma la identidad OAuth a la MISMA cuenta. El trigger `handle_new_auth_user` hace `on conflict (id) do nothing` → no pisa `public.users`. Sin data-loss.

### D5 — Gating/onboarding sin cambios de código
- Usuario OAuth nace con `email_confirmed_at` → `emailVerified=true` → `RootGate` saltea `/verify-email` y cae al gating de establecimiento. `name` del claim → `public.users.name` (fallback local-part del email si Apple lo omite). `AuthContext` no toca `onAuthStateChange` (el `SIGNED_IN` ya está cubierto).

### D6 — Nonce y seguridad de `signInWithIdToken`
- **Apple: nonce obligatorio** (raw + hash SHA-256; entra `expo-crypto`). Protege replay.
- **Google: nonce omitido** (opcional; la firma del idToken + `aud` ∈ **Authorized Client IDs** de Supabase cierran la superficie). Evita fragilidad por versión de la lib.

### D7 — Manejo de cancelación y errores (copy es-AR)
- **Cancelar el picker** = `{ ok:false }` silencioso (SIN error rojo).
- Mapear a copy es-AR: `DEVELOPER_ERROR` (config), Play Services ausente, sin conexión. Reusa `FormError` + `authErrorMessage` existentes.

## Edge cases (a cubrir en requirements/tests)

- **Cancelación del picker/redirect** → sin error, vuelve al form.
- **Sin conexión**: el login social **requiere red** (igual que `signInWithPassword`). Falla con mensaje claro; NO rompe. No aplica offline-first (es la puerta de entrada, aún no hay sesión que sincronizar).
- **Android sin Google Play** (ej. Huawei): `hasPlayServices()` falla → degradar a email/password con mensaje.
- **Apple en simulador** vs device real (verificar en el gate manual).
- **Segundo login con Apple**: Apple manda `name` **solo la primera vez** → el fallback (local-part) ya cubrió el primer alta; no re-pisar.
- **Linking de usuario existente** (D4): loguear con Google sobre una cuenta email/password del mismo email → misma cuenta.
- **Bundle web**: `expo export -p web` debe quedar limpio (el módulo nativo NO se filtra) — assert en el gate.
- **Web redirect**: `http://localhost:8099` debe estar en Redirect URLs de Supabase o el OAuth rebota.

## Fuera de scope (NO-MVP)

- **Apple nativo en Android** (browser flow) — descartado (deep-link).
- **Deep-linking / universal links** — sigue diferido (no lo destraba esta feature).
- **Otros proveedores** (Facebook, Microsoft, etc.).
- **Migrar `flowType` a PKCE**.
- **Pantalla de gestión de identidades vinculadas** en Perfil (link/unlink manual) — post-MVP.

## Dependencias externas — SOLO RAF (bloquean prueba en device, NO el código)

- **Google Cloud**: consent screen + OAuth Client Web (ID + Secret) + iOS (reversed client ID) + Android (package + **SHA-1** vía `eas credentials`).
- **Apple Developer** (membresía paga ~US$99/año): capability "Sign in with Apple" + Services ID + Key.
- **Supabase Dashboard**: habilitar Google + Apple; Authorized Client IDs (iOS/Android/Web); Redirect URLs (`localhost:8099` + prod).
- Decisión de Raf: se construye el código en paralelo; la verificación en device es el último gate.

## Gate de seguridad

**Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** — es superficie de auth. Foco:
- Nonce de Apple correcto (anti-replay); `signInWithIdToken` no acepta tokens de otro origen (audience ∈ Authorized Client IDs).
- Sin secretos en el cliente (el Web Client Secret vive **solo** en Supabase; los client IDs no son secretos).
- Account linking no habilita takeover (solo email **verificado** linkea).
- No debilitar el lockout/rate-limit de `sign-in.tsx` (R1.7 de spec 01) ni los invariantes de PII (feature 14-pii-user-private).

## Resolución de la Puerta 0 (Raf, 2026-07-13)

1. **Matriz de botones (D2)** → **RESUELTO: Android SIN botón Apple.** El cross-device se cubre por linking de email + password fallback. Apple-por-web en Android descartado (evita el deep-link). D2 queda firme.
2. **Cross-device Apple relay (D3)** → **RESUELTO: fallback email/password, sin aviso proactivo.** No se agrega UI de detección de relay; si un usuario relay queda trabado en otro dispositivo, setea password vía "Olvidé mi contraseña". D3 queda firme.
3. **Coordinación** → la entrada en `feature_list.json` (número **19**) queda **EN ESPERA** hasta que se cierre/commitee el Bloque E (18 está en Puerta 2 de Raf) o Raf confirme que esta terminal puede tocar los archivos de coordinación. El contexto/spec avanzan igual (directorio independiente, colisión-safe). **El status `context_ready`/`spec_ready` se registra en este doc; NO se refleja aún en `feature_list.json`.**
