# Security Gate 2 (modo `code`) — B.1.1 Fase 3 (fundación de auth, frontend spec 01)

**Agente:** `security_analyzer` (modo `code`)
**Fecha:** 2026-05-30 (sesión 21)
**Skill base:** `sentry-skills:security-review` (metodología trace data flow + verify exploitability; refs `authentication.md`, `data-protection.md`, `languages/javascript.md`).
**Baseline:** `c56a57f` (= `baseline_commit` en `progress/impl_01-frontend-fase3.md`)
**Diff auditado:** `c56a57f..HEAD` (commit `1893513`) — solo el cliente nuevo de auth. El backend (Auth + RLS + Edge Functions) NO se audita acá (pasó sus gates en sesión 4/6).

---

## Veredicto: PASS

No se identificaron findings HIGH-confidence. El manejo de sesión/tokens, secretos, credenciales, anti-enumeración y gating de navegación están correctamente implementados para el alcance de B.1.1 (target de verificación = web; native diferido). Hay 3 observaciones de menor severidad (anexo LOW) que NO bloquean el gate y ya están documentadas como seams/TODOs por el implementer.

---

## Findings HIGH de Sentry

Ninguno. La skill no produjo findings HIGH-confidence sobre el diff tras trazar data flow y verificar explotabilidad.

## Findings RAFAQ-SPECIFIC

Ninguno HIGH/MEDIUM. Checklist RAFAQ corrido abajo (todo verde).

---

## Verificación de los focos pedidos (trazabilidad)

### 1. Manejo de sesión/tokens — `app/src/services/supabase.ts`  ✔
- **No se loguea sesión/token.** Búsqueda exhaustiva de `console.*` en `app/`: solo 2 llamadas (`verify-email.tsx:64`, `AuthContext.tsx:121`), ambas dev-guarded por `NODE_ENV !== 'production'` y ninguna imprime credenciales/tokens (loguean un mensaje fijo y `result.error.kind`, un enum). El storage adapter solo mueve bytes opacos entre supabase-js y el backing store; no inspecciona ni loguea el valor.
- **Storage adapter (líneas 46-68):** correcto. Native → `expo-secure-store` (Keychain iOS / Keystore Android), key sanitizada con `safeKey`. Web → `localStorage` si existe, sino `Map` en memoria. Tokens de Supabase Auth: para una SPA esto es el patrón estándar (no hay cookie `HttpOnly` posible en una app cliente que habla directo con Supabase). No es un leak: la sesión va al storage que el SDK espera; no se exfiltra a un canal distinto.
- **Fallback de memoria (línea 34, `memoryStore`):** solo se usa cuando NO hay `window` ni `localStorage` (SSR/headless). Es un `Map` en proceso, no cruza ningún boundary de red ni se persiste a disco inseguro. La degradación (sesión no sobrevive reload) es funcional, no de seguridad.
- **`safeKey` (líneas 28-30):** ¿colisiones de key? Trazado: la única key que pasa por el adapter es la que emite supabase-js (`sb-<project-ref>-auth-token`), que ya cumple `[A-Za-z0-9._-]` → el regex es identidad sobre ella. El reemplazo `[^A-Za-z0-9._-] → '_'` solo podría colisionar si dos keys distintas difirieran únicamente en caracteres inválidos; en la práctica supabase-js usa UNA key por cliente. No explotable: no hay input attacker-controlled que llegue a `key`, y no hay dos keys conviviendo que puedan pisarse.
- **`detectSessionInUrl: Platform.OS === 'web'` (línea 80):** correcto. En web habilita el parseo del fragment (`#access_token=...`) para recovery/verificación; en native lo desactiva (sin URL bar) y el deep-link se maneja explícito en Fase 5. El fragment NO se loguea.

### 2. Secretos  ✔
- `app/.env.local` está **gitignoreado** (`git check-ignore app/.env.local` → match; `app/.gitignore` contiene `.env*.local`) y **nunca commiteado** (`git log --all --full-history -- app/.env.local` → vacío). El commit `1893513` no agregó ningún archivo env/secret/key. No hay ningún `.env` trackeado en todo el repo.
- **No hay secretos hardcodeados.** `env.ts` lee `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` de `process.env` / `Constants.expoConfig.extra`. La grep de `password|secret|token|anon|eyJ|sk-|api_key` en `app/src` solo devolvió nombres de variables, tipos y comentarios — cero literales de clave. La anon key es por diseño pública (la protección real es RLS, ya gateado en backend).

### 3. Credenciales en pantallas de auth  ✔
- **Password nunca se loguea ni se persiste.** `sign-in.tsx` / `sign-up.tsx` / `update-password.tsx` mantienen la password solo en `useState` local y la pasan directo a `supabase.auth.*`. No hay `console.*` con la password ni se escribe a ningún store. `FormField` con `secureTextEntry` + `textContentType` correctos.
- **Anti-enumeración en forgot-password (`forgot-password.tsx:43-56`):** correcto y alineado con OWASP Authentication Cheat Sheet. Tras `requestPasswordReset`, se muestra SIEMPRE el estado neutro "Revisá tu email · Si hay una cuenta con ese email…" (líneas 58-72). Solo se corta el flujo en errores accionables y NO discriminantes de existencia (red / rate-limit). No revela si la cuenta existe.
- **Anti-enumeración en sign-up:** `authErrorMessage(_, 'signup')` SÍ devuelve "Ese email ya tiene una cuenta…" ante `user_already_exists`. Esto es enumeración de cuentas técnicamente posible, pero es comportamiento nativo de Supabase Auth (el server devuelve el code) y una decisión de producto/UX estándar (Supabase no lo oculta por default). NO es un finding del cliente: el cliente solo traduce el code que el server ya expone. Lo registro como observación LOW, no bloqueante.
- **Gating de `_layout.tsx` (`AuthGate`, líneas 60-103):** trazado el control de acceso. `loading` → no rutea (splash); `unauthenticated` → `(auth)/sign-in` (salvo rutas públicas); `authenticated + !emailVerified` → `/verify-email`; `authenticated + verificado` → `(tabs)`. El gating cliente es UX/navegación — **la autorización real es server-side (RLS + JWT en cada request)**, ya gateado. Aunque un atacante fuerce el render de una ruta protegida (ej. flash de `(tabs)` antes del redirect, documentado por el implementer), no puede leer datos de otro tenant: las queries pasan por RLS con el `auth.uid()` de la sesión. Sin acceso indebido a datos.

### 4. Lockout (`lockout.ts` + `lockout-store.ts`)  ✔
- Es **UX-only y está documentado como tal** (header de ambos archivos: "la defensa real es el rate-limit de Supabase Auth"). No se vende como control de seguridad fuerte. `auth-errors.ts:47` mapea el 429 server-side. Correcto: el lockout cliente es trivial de bypassear (borrar localStorage), pero esa NO es la defensa — solo evita spamear el endpoint y da feedback.
- **Hash de la key del email (`lockout-store.ts:17-24`):** ¿expone el email? Trazado: es un hash polinómico de 32 bits (`hash*31 + charCode`, no-cripto) truncado a hex → key `rafq.lockout.<hex>`. NO es reversible a email en claro de forma directa (32 bits, lossy). No es un control de seguridad (el comentario lo aclara); su único fin es derivar una key SecureStore-válida estable. En web vive en `localStorage`; en native en SecureStore. El valor guardado (timestamps de fallos) no es PII sensible. No explotable.

### 5. Push token / Edge Function invoke (`push-notifications.ts`)  ✔
- `registerPushTokenBestEffort` (líneas 64-87) manda `{ expo_push_token, device_id, platform }` a `register_push_token`. El JWT del usuario lo agrega supabase-js automáticamente (autenticado). El `device_id` viene de `Device.osInternalBuildId ?? Device.modelId` — identificador de build/modelo, no PII sensible ni cross-app fingerprint persistente. No se manda nada sensible más allá de lo que la Edge Function necesita (contrato ya gateado en backend).
- **Manejo de fallo:** correcto y robusto. `not_a_device` (web/simulador) → no-op temprano, nunca invoca la función. Permiso denegado → no insiste. Error de red/Edge → `try/catch` lo traga y devuelve `register_failed` sin romper el login (es fire-and-forget en un `useEffect`, `AuthContext.tsx:113-124`). El ref-guard `pushRegisteredForUser` evita doble-registro y se resetea en `signOut`.

### 6. Pending invitation store (`pending-invitation.ts`)  ✔
- El token de invitación se persiste en **almacenamiento adecuado**: native → `expo-secure-store`; web → `localStorage` (mismo patrón que el adapter de auth, aislado para no acoplar). Tiene `clearPendingInvitationToken()` para limpiarlo tras consumo.
- **Estado B.1.1:** el store es funcional pero el consumo/clear automático es seam de Fase 5 (B.1.3) — documentado. En B.1.1 el token solo se *consulta* en `verify-email.tsx:59-70` (dev-warn, sin re-rutear). No hay write desde el cliente todavía (el deep-link que setea el token es Fase 5), así que el token nunca queda huérfano sin limpiar en esta fase. Sin riesgo en el alcance actual.

---

## False positives descartados (trazabilidad)

- **`safeKey` colisión de keys (`supabase.ts:28`):** descartado — no hay input attacker-controlled en `key` (siempre la key fija de supabase-js) ni dos keys conviviendo. No explotable.
- **Storage adapter "filtra sesión a lugar inseguro":** descartado — `localStorage`/SecureStore/memoria son los backing stores que el SDK espera para una SPA; no es exfiltración a un canal distinto. Cookie `HttpOnly` no aplica a un cliente que habla directo con Supabase.
- **Gating cliente bypasseable = auth bypass:** descartado — el gating es UX; la autorización real es RLS server-side (gateado). Forzar el render de una ruta no da acceso a datos de otro tenant.
- **Hash de email en lockout-store expone PII:** descartado — hash lossy de 32 bits, no reversible, no es control de seguridad, valor guardado no sensible.
- **`console.warn` filtra datos:** descartado — ambos son dev-guarded y loguean strings fijos / un enum (`error.kind`), nunca credenciales/tokens/email.

---

## Archivos analizados (diff `c56a57f..1893513`, solo cliente auth)

- `app/src/services/supabase.ts`
- `app/src/services/lockout-store.ts`
- `app/src/services/pending-invitation.ts`
- `app/src/services/push-notifications.ts`
- `app/src/contexts/AuthContext.tsx`
- `app/src/utils/auth-errors.ts`
- `app/src/utils/validation.ts`
- `app/src/utils/env.ts`
- `app/app/_layout.tsx`
- `app/app/(auth)/_layout.tsx`
- `app/app/(auth)/sign-in.tsx`
- `app/app/(auth)/sign-up.tsx`
- `app/app/(auth)/forgot-password.tsx`
- `app/app/verify-email.tsx`
- `app/app/update-password.tsx`
- `app/src/components/FormField.tsx`
- `app/src/components/AuthBits.tsx`
- `app/src/components/AuthScreenShell.tsx`

Verificación de git: `.env.local` ignorado y nunca commiteado; commit `1893513` sin archivos env/secret/key; ningún `.env` trackeado en el repo.

(Excluidos del análisis de seguridad: `*.test.ts`, `tsconfig.json`, `scripts/run-tests.mjs`, `progress/*` — no son superficie de ataque.)

---

## Cobertura indirecta / no cubierto por la skill — revisión manual aplicada

La skill de Sentry está calibrada para web/backend (Django/Express/React-DOM). Para esta superficie React Native/Expo + Supabase, varios dominios NO los cubre directamente y se revisaron a mano:

- **expo-secure-store / Keychain / Keystore (native):** no cubierto por la skill. Revisado manualmente: uso correcto (almacenamiento seguro del OS). El riesgo real conocido es el límite de 2KB de SecureStore para la sesión entera — **NO es un finding de seguridad** (es persistencia/funcional), y está documentado como `TODO B.1.2` por el implementer. El target de verificación de B.1.1 es web (sin límite). Sin device-build aún.
- **RLS / autorización server-side:** fuera del diff de B.1.1 (cliente). Ya gateado en backend. El cliente confía en RLS para la autorización real; el gating de navegación es solo UX.
- **PowerSync / BLE:** no presentes en este diff (Fase 7 diferida). N/A.
- **Deep-links (`rafq://`, universal links):** seam de Fase 5; no wireados aún. El evento `PASSWORD_RECOVERY` y el re-ruteo automático llegan en B.1.3. Re-evaluar la superficie de deep-link cuando se implemente (un deep-link mal validado puede ser vector de open-redirect / token injection — fuera de alcance hoy).

---

## Anexo LOW (no bloqueante — para trazabilidad, NO requiere acción en este gate)

1. **Enumeración de cuentas en sign-up (`auth-errors.ts:52`):** el copy "Ese email ya tiene una cuenta" revela existencia de cuenta. Es comportamiento nativo de Supabase Auth (el server expone el code) y una decisión UX estándar. Si en algún momento se quiere endurecer (paridad con el anti-enumeración de forgot-password), se haría a nivel de config de Supabase, no del cliente. No bloqueante.
2. **Política de password mínima (`validation.ts:10`, `PASSWORD_MIN_LENGTH = 8`):** 8 caracteres. OWASP recomienda 8 con MFA / 15 sin MFA. RAFAQ no tiene MFA hoy. La validación cliente es solo UX; el server (Supabase Auth) es la autoridad. Considerar subir el mínimo o sumar un strength meter (zxcvbn) cuando se priorice hardening de cuentas. No bloqueante para MVP.
3. **Lockout cliente trivialmente bypasseable:** por diseño y documentado. La defensa real es el rate-limit de Supabase. Mencionado solo para dejar constancia de que NO es un control de seguridad fuerte (ya está claro en el código).

---

**Resultado:** `PASS -> progress/security_code_01-frontend-fase3.md`
