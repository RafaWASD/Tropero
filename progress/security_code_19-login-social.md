# Security Code Review — 19-login-social (Gate 2, modo `code`)

**Veredicto: PASS**

- Baseline: `6f14895671b33350698fea93fcbc795001d8ad5d` (registrado en `progress/impl_19-login-social.md`).
- Alcance auditado: cambios sin commitear de la feature **19-login-social** (F1–F5), superficie de auth.
- Skill corrida: `sentry-skills:security-review` (trace data flow + verify exploitability) sobre el diff de F19, complementada con checklist RAFAQ y focos R8.
- **Findings HIGH: 0. Findings MEDIUM: 0. Findings RAFAQ-SPECIFIC: 0.** No hay bloqueantes.

---

## Archivos analizados (solo F19)

Servicios: `app/src/services/google-auth.{ts,native.ts,web.ts}`, `app/src/services/apple-auth.{ts,native.ts,web.ts}`.
Componentes: `app/src/components/{GoogleSignInButton,AppleSignInButton,AppleSignInButton.native}.tsx`, `app/src/components/AuthBits.tsx`, `app/src/components/index.ts`.
Context/screens: `app/src/contexts/AuthContext.tsx`, `app/app/(auth)/{sign-in,sign-up}.tsx`.
Utils: `app/src/utils/{auth-errors,env-resolve,env}.ts` (+ sus `.test.ts`).
Config: `app/{app.json,eas.json,package.json,pnpm-lock.yaml}`.
E2E: `app/e2e/social-login.spec.ts`, `app/e2e/captures/social-login.capture.ts`.

> Nota de scope: el working tree tiene además cambios en `supabase/functions/**` y `_shared/supabase.ts` que **NO pertenecen a F19** (son de la feature 18-audit-log, `actorId`/`X-Rafaq-Actor`, otra terminal). Verificado: ese diff no toca `flowType`, oauth ni social → fuera del alcance de este gate.

---

## Focos R8 — resultado

### 1. R8.9 — no loggear tokens (PASS)
Cero `console.*` / logger / Sentry / analytics en cualquier servicio `*-auth*` o componente de botón (grep confirmado). Los identificadores `idToken` / `identityToken` / `rawNonce` / `hashedNonce` aparecen SOLO como asignación local y como argumento a `signInWithIdToken(...)` — nunca se loggean ni se retornan al caller. Los captures E2E tampoco loggean tokens/nonces.

### 2. R8.1 — nonce de Apple (PASS)
`app/src/services/apple-auth.native.ts:36-55`. `rawNonce = toHex(await Crypto.getRandomBytesAsync(16))` (aleatorio CSPRNG, per-intento, generado dentro del scope de la función → single-use). `hashedNonce = SHA-256(rawNonce)`. Dirección **correcta**: `signInAsync({ nonce: hashedNonce })` (hash → Apple, `apple-auth.native.ts:44`) y `signInWithIdToken({ nonce: rawNonce })` (raw → Supabase, `apple-auth.native.ts:55`). Supabase recomputa SHA-256(raw) y lo compara contra el claim del idToken → anti-replay cerrado.

### 3. R7.6 — sin secretos en cliente (PASS)
`eas.json`/`app.json`/código: solo client IDs públicos y placeholders. Sweep de patrones (`GOCSPX`, `BEGIN PRIVATE KEY`, `service_role`, `client_secret`, `.p8`, JWT `eyJ...`) → **0 matches**. La única key en `eas.json` es `sb_publishable_...` (publishable/anon, segura por diseño; ya estaba pre-F19). NINGÚN Web Client Secret de Google ni `.p8` de Apple en el bundle.

### 4. R8.2/R8.3 + R8.7 — audience/identidad y open-redirect (PASS)
El cliente NO valida el idToken por su cuenta ni deriva identidad (email/uid) de input del cliente: delega en `supabase.auth.signInWithIdToken` (native) / `signInWithOAuth` (web). La verificación de `aud` ∈ Authorized Client IDs es server-side (Supabase). `redirectTo = window.location.origin` en ambos `*-auth.web.ts` (`google-auth.web.ts:16`, `apple-auth.web.ts:13`) — valor app-controlado, no input de usuario → sin open-redirect.

### 5. R8.5 — lockout intacto (PASS)
`sign-in.tsx`: `onGoogle`/`onApple` (líneas 117-133) NO llaman `registerFailure`/`resetLockout`/`isLockedOut` ni leen `lockout`. Los botones sociales van `disabled={anyBusy}` (172-175), NO `locked`; solo el CTA de password es `disabled={anyBusy || locked}` (167). Los wrappers `signInWithGoogle`/`signInWithApple` de `AuthContext.tsx:180-186` son finos y no tocan lockout. El OAuth no es brute-forceable → correcto no acoplarlo al lockout de password.

### 6. Scope — sin `supabase/` ni `flowType` (PASS)
El diff de F19 no toca `supabase/`. El client `app/src/services/supabase.ts` no fue modificado (grep de `flowType`/google/apple/oauth/social → 0). R3.5 (flowType intacto) se sostiene.

### 7. Manejo de errores — sin leak de crudo del proveedor (PASS)
`authErrorMessage(result.error, 'social')` (screens) devuelve copy es-AR curado en TODAS las ramas. Los servicios native normalizan el code opaco de la lib a canónicos estables (`developer_error`, `play_services_not_available`) **sin** filtrar config (`google-auth.native.ts:57-62`, `auth-errors.ts:80-87`). El `message`/`name` crudo se propaga en el objeto `error` SOLO para la clasificación de red por substring dentro de `authErrorMessage`/`isNetworkOrRateLimit`; **nunca se renderiza** en la UI. Verificado: ningún consumidor hace `setFormError(result.error.message)` — todos pasan por `authErrorMessage`.

---

## Tabla de inputs (campos que el usuario tipea, tocados/relevantes al diff)

| campo | límite | validación (server/solo-cliente/ausente) | OK? |
|---|---|---|---|
| (login social Google/Apple) | n.a. — el usuario no tipea; el idToken lo emite y firma el proveedor | server (Supabase valida firma + `aud`; el cliente no deriva identidad) | OK |
| email (sign-in/up) — pre-existente, no modificado por F19 | validación de formato client + server-side Supabase Auth | server (autoritativo) | OK (fuera de alcance F19) |
| password (sign-in/up) — pre-existente | min 8 client + política Supabase | server (autoritativo) | OK (fuera de alcance F19) |

F19 no agrega ningún campo de texto libre nuevo, buscador, ni prompt. El único "input" del flujo social es el idToken emitido por el proveedor (no attacker-typed) y validado server-side por Supabase.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| login social Google (native/web) | server-side de Supabase Auth (`token_verifications` / `[auth.rate_limit]`) | per-proyecto / per-IP nativo de Supabase | sí (Supabase) | no es brute-forceable como password; correctamente fuera del lockout local |
| login social Apple (native/web) | idem | idem | sí | idem |
| login password (pre-existente) | lockout local (UX) + `[auth.rate_limit]` server | per-email (local) + Supabase | sí | intacto, no tocado por F19 |

F19 no agrega Edge Functions, ni endpoints de email/SMS, ni operaciones bulk → no introduce nueva superficie que requiera rate limit propio.

---

## False positives / patrones descartados (trazabilidad)

- **`message`/`name` crudo del proveedor en el objeto `error`** (`apple-auth.native.ts:64`, `google-auth.native.ts:66,71`): NO es information disclosure — el crudo se usa solo para clasificación de red (substring) y jamás se renderiza; la UI siempre muestra copy curado de `authErrorMessage`. Descartado.
- **Colores hardcodeados del logo Google** (`GoogleSignInButton.tsx:18-21`): branding oficial con `design-lint-disable` justificado (ADR-023 §4), no es secreto ni token de seguridad. No aplica.
- **`console.warn` en `AuthContext.tsx:133`**: pre-existente (push token best-effort), gateado por `NODE_ENV !== 'production'`, loggea solo `result.error.kind` (enum, no PII ni token). Fuera del flujo social y sin datos sensibles. No aplica.

---

## Cobertura indirecta / dependencias externas (no verificables en código — GATED-RAF, F6)

La skill de Sentry no cubre config de Supabase Dashboard ni `config.toml`. Los siguientes controles son **server-side config**, no código, y quedan gated a Raf (F6 QA en device) — ya foldeados como MEDIUM en Gate 1 (spec):

- **R8.2** — Authorized Client IDs (audience enforcement de Google) debe estar cargado en el Dashboard; el código delega correctamente, pero la defensa real vive ahí.
- **R8.4.1** — email confirmations ON (linking de identidades por email verificado).
- **R8.8 / skip_nonce_check** — config de proveedores Apple/Google en el Dashboard.

Estos NO son findings de código (el código está correcto); son la nota de que el gate de código no puede verificar la config remota. El leader debe confirmar que F6 aplique esa config antes de habilitar login social en producción.

---

## Conclusión

Superficie de auth limpia. Nonce de Apple con dirección correcta y CSPRNG single-use. Cero logging de tokens/nonces. Sin secretos en el cliente (solo publishable/placeholders). El cliente confía en Supabase para validar firma/audience y no deriva identidad de input propio. `redirectTo` app-controlado. Lockout de password no tocado por el flujo social. Errores sin leak de crudo del proveedor. Scope respetado (sin `supabase/`, sin `flowType`).

**PASS — sin findings HIGH, no bloqueante.** Recordatorio no-bloqueante para el leader: la habilitación en prod depende de la config Dashboard/`config.toml` gated a Raf (F6).
