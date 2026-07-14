# Gate 1 — Security review (modo `spec`) — 19-login-social

- **Agente**: security_analyzer (modo `spec`, ADR-019)
- **Fecha**: 2026-07-13
- **Input**: `specs/active/19-login-social/{context,requirements,design,tasks}.md`
- **Superficie**: **autenticación** (login social Google + Apple sobre app hoy email/password). Gate 1 **OBLIGATORIO** — aplica.

## Veredicto

**PASS — con condiciones aditivas obligatorias (no bloqueantes del arranque de código).**

La spec está **bien construida en seguridad**: tiene un grupo R8 dedicado (nonce, audience, linking, lockout, PII, open-redirect) y los flujos criptográficos centrales están correctamente especificados. **No encontré ningún defecto de diseño explotable (cero HIGH).** Verifiqué contra el código real que los invariantes que la spec asume (trigger `handle_new_auth_user` 0068, PowerSync `self_user_private` self-only, lockout de `sign-in.tsx`, `supabase.ts`) son ciertos.

El riesgo residual **no** vive en el código de la feature sino en **config externa del Dashboard de Supabase** que la spec identifica correctamente pero **no fija como criterios de aceptación verificables**, y que el único artefacto de config versionado (`supabase/config.toml`) **contradice** en varios puntos. Por eso el PASS lleva condiciones. **Importante**: el modo de falla de esa misconfig es **fail-closed** (rompe el login), no fail-open (aceptar tokens ajenos) — lo que baja la severidad de HIGH a MEDIUM. Detalle abajo.

Las condiciones son **aditivas** (fortalecen la spec / se verifican en el gate de device T24 + Gate 2.5); **no** re-diseñan nada y **no** deben frenar el código buildable-ya (F1–F5), que está diseñado para correr en paralelo a la config de Raf.

---

## Lo que está BIEN (validado, para trazabilidad)

Confirmé leyendo el código, no solo la spec:

1. **Nonce de Apple — CORRECTO** (R2.2/R2.3/R8.1, design §"Flujo de nonce de Apple"). El flujo `rawNonce = hex(getRandomBytesAsync(16))` → `hashedNonce = SHA256(rawNonce)` → **a Apple el hash** (`signInAsync({ nonce: hashedNonce })`) → **a Supabase el raw** (`signInWithIdToken({ nonce: rawNonce })`) es el patrón canónico de Supabase/OIDC. La dirección hash/raw es la correcta (no está invertida). 128 bits de entropía es suficiente para un nonce anti-replay. Nonce fresco por intento = single-use implícito. **Sin observaciones.**

2. **Audience / `signInWithIdToken` — dependencia correctamente identificada** (R8.2/R8.3). El cliente **no** valida el token; Supabase valida firma + `aud ∈ Authorized Client IDs` server-side. R8.3 es explícito: la identidad (email/uid) se deriva **solo** del token verificado por Supabase, nunca de input del cliente. Un idToken forjado/de otra app se rechaza server-side. Este es el control clave y está bien especificado. (La condición: los Authorized Client IDs deben estar cargados — ver Finding M1.)

3. **Sin secretos en el cliente — CORRECTO** (R7.6). Verifiqué que ningún requirement/tarea mete un secreto en el bundle: `eas.json` recibe solo `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (público, mismo criterio que la anon key), `app.json` el reversed iOS client ID (no secreto). El **Web Client Secret** de Google y la **Key `.p8`** de Apple viven solo en el Dashboard de Supabase (design §Config, §Dependencias externas). El prefijo `EXPO_PUBLIC_` deja claro que es client-ID, no secret.

4. **PII → `user_private` self-only — CORRECTO** (R8.6). Leí el cuerpo VIGENTE de `handle_new_auth_user` en `0068_user_private_pii.sql`: inserta `public.users(id, name)` + `public.user_private(user_id, email)` con `on conflict do nothing`. El email OAuth aterriza en `user_private`, **no** en `public.users`. Confirmé en `sync-streams/rafaq.yaml:68-72` que el stream `self_user_private` sincroniza `WHERE user_id = auth.user_id()` (**self-only**) → el email OAuth **no** se replica cross-tenant por PowerSync/WAL. Invariante de la feature 14 preservado.

5. **Lockout / rate-limit — no se debilita** (R8.5). Leí `sign-in.tsx`: el lockout (`registerFailure`/`resetLockout`/`isLockedOut`) protege el **guessing de password**. El flujo social no lee password, no toca ese estado y no lo resetea (design §Wiring). No introduce una vía de brute-force: `signInWithIdToken`/`signInWithOAuth` exigen un idToken válido de Google/Apple que el atacante no puede forjar. Los endpoints de auth social quedan cubiertos por el rate-limit **server-side** nativo de Supabase (`sign_in_sign_ups`, `token_verifications`, `token_refresh` — `config.toml:192-206`). La decisión de **no gatear** los botones sociales con `locked` es correcta (bloquearlos solo dañaría al usuario legítimo trabado en el password).

6. **Account linking — modelo correcto** (R8.4/D3/D4). Auto-linking solo por **email verificado**; Google y Apple devuelven email verificado; `enable_manual_linking = false` (`config.toml:175`). El trigger hace `on conflict (id) do nothing` → no pisa la cuenta existente. No hay camino de linking por email no verificado en el diseño. (Condición: depende de config remota — ver M1/M2.)

7. **Open-redirect — cerrado** (R8.7). `redirectTo = window.location.origin` es valor **controlado por la app**, nunca input de usuario; además debe estar allow-listado en Supabase (fail-closed si no). Sin vector de open-redirect.

---

## Findings HIGH

**Ninguno.** No hay defecto de diseño explotable en la spec. Los flujos criptográficos son correctos y los modos de falla de la config son fail-closed.

---

## Findings MEDIUM (aditivos — foldear en la spec antes de cerrar / verificar en gate de device)

### M1 — La seguridad de la feature depende de config del Dashboard que NO está fijada como criterio de aceptación verificable

**Severidad**: MEDIUM (impacto potencial: account-takeover / aceptación de tokens ajenos **si** se misconfigura; pero el modo de falla dominante es fail-closed → login roto, no fuga). **Aditivo, no bloqueante del código.**

**Evidencia (spec)**: `design.md` §"Dependencias externas — SOLO RAF" y §"Anti-takeover (R8.4 — Gate 1)": *"Gate 1 debe confirmar que la config del Dashboard (Supabase Auth → 'Enable automatic linking' / verified-email linking) está en el modo que asume esta spec."* R8.2 delega toda la validación de `aud` al Dashboard. R8.4 delega el anti-takeover al Dashboard.

**Problema**: Gate 1 (yo) **no tiene acceso al Dashboard remoto** y no puede confirmar esos valores. La spec lista las dependencias externas como prosa, pero **no** las convierte en un checklist de valores exactos ni las ata a una tarea de verificación con criterio de PASS/FAIL. Toda la superficie de seguridad (validación de `aud`, enforcement del nonce de Apple server-side, linking solo-verificado, confirmación de email) es **config remota, no versionada y no verificable por ningún test automatizado** (los E2E son web-render-only y no tocan al proveedor real).

**Fix sugerido (aditivo)**: agregar a `design.md` §Dependencias externas un **checklist de config con valores exactos** y convertirlo en una tarea de verificación explícita (ej. sub-pasos de T24, con criterio) en el gate de device:

- **Apple provider**: `enabled = true`, `client_id` = Services ID real, **`skip_nonce_check = false`** (enforcement del nonce — hoy correcto en `config.toml:328`), `email_optional = false`.
- **Google provider**: **Authorized Client IDs** = { Web client ID, iOS client ID, Android client ID } — **los tres cargados** (si el `aud` del idToken nativo no está en la lista, Supabase lo rechaza; lista vacía = login roto, no bypass — fail-closed, pero hay que confirmar que están).
- **Account linking**: verified-email linking en el modo que asume R8.4; `enable_manual_linking = false`.
- **Redirect URLs**: `http://localhost:8099` + el/los origin(es) de prod exactos allow-listados (si no, el OAuth web rebota — fail-closed).
- **Email confirmations**: ver M2.

Sin este checklist como criterio de aceptación, el "Gate 1 debe confirmar" queda huérfano (yo no puedo, y nadie más lo tiene asignado con un valor-objetivo).

### M2 — El argumento anti-takeover asume "email confirmations ON" pero el único artefacto de config versionado dice `enable_confirmations = false`

**Severidad**: MEDIUM (drift de config; el anti-takeover de R8.4 se apoya en un supuesto que el repo contradice). **Aditivo.**

**Evidencia (spec)**: `design.md` §Anti-takeover: *"RAFAQ exige verificación de email (spec 01), así que las cuentas email/password son verificadas; Google/Apple devuelven email verificado. No hay camino de linking por email no verificado."*

**Evidencia (código)**: `supabase/config.toml:221` → `[auth.email] enable_confirmations = false`. Además `config.toml:317-318` → `[auth.external.apple] enabled = false`, y **no existe** bloque `[auth.external.google]`.

**Problema**: la propiedad anti-takeover ("las cuentas email/password son verificadas") depende de que las confirmaciones de email estén **ON en el proyecto remoto**. El `config.toml` committeado (el único artefacto de config en control de versión) las tiene en **OFF**. Muy probablemente es una conveniencia de dev local (la existencia del gate `/verify-email` de spec 01 sugiere que el remoto las tiene ON), **pero la spec no lo afirma ni lo verifica**. Si el remoto también estuviera en OFF, el argumento anti-takeover se debilita (una cuenta email/password no confirmada podría convivir con la identidad OAuth del mismo email). Es exactamente el tipo de supuesto silencioso que un gate de auth debe pinnear.

**Fix sugerido (aditivo)**:
1. Agregar a R8.4 (o un R8.8 nuevo) como criterio verificable: *"el proyecto remoto tiene email confirmations habilitadas; una cuenta email/password no puede quedar verificada sin confirmar la casilla"*. Verificar en T24 (device gate).
2. Reconciliar el drift de `config.toml`: dejar una nota (o alinear) que documente que Apple/Google están habilitados y confirmations ON en **remoto**, para que el `config.toml` local no sea leído como fuente de verdad contradictoria. La tarea T26 (guarda de alcance: `git diff` no toca `supabase/`) hoy **impediría** tocar `config.toml` — decidir explícitamente si este drift se documenta en la spec (preferido) o se reconcilia en config.

### M3 — La spec no prohíbe explícitamente loggear el idToken / identityToken / rawNonce

**Severidad**: MEDIUM (information disclosure / secret-in-logs — dominio B1/B2 del catálogo). **Aditivo.**

**Evidencia**: los servicios `google-auth.native.ts` / `apple-auth.native.ts` manejan `idToken`, `identityToken`, `credential` y `rawNonce` (design §Archivos, tasks T6/T9). R6.6 prohíbe mostrar al **usuario** el mensaje crudo/stack del proveedor, pero **ninguna** requirement prohíbe **loggear** el token o el nonce (a consola, Sentry, analytics). Un idToken en un log es un credential de sesión reutilizable hasta su expiración; el `rawNonce` en log rompería el anti-replay si se correlaciona con un idToken robado.

**Fix sugerido (aditivo)**: agregar una requirement (ej. R8.9): *"los servicios de auth social no deberán loggear (`console.*`, telemetry, Sentry) el `idToken`/`identityToken`/`credential` ni el `rawNonce`/`hashedNonce`; solo el `code` normalizado del error."* Es barato, alineado con `supabase.ts` que ya documenta "NUNCA se loguea el contenido de la sesión (tokens)", y verificable en Gate 2 (modo code).

---

## Anexo LOW (informativo — no bloquea)

- **L1 — Web usa implicit flow (tokens en el fragment de la URL).** `supabase.ts` no setea `flowType` → implicit (design §"Por qué NO tocamos flowType", R3.5). El OAuth web vuelve con `#access_token=...` que `detectSessionInUrl` levanta. Es un flujo con menor postura que PKCE (los tokens transitan en el fragment → riesgo de leak por history/extensiones del browser). **Es un tradeoff deliberado y documentado** (PKCE rompería el reset-password por fragment y exigiría el deep-link diferido) y es **pre-existente** (el reset-password ya usa fragment). El fragment no viaja al server en requests HTTP y supabase-js hace `replaceState` para limpiarlo. Recomendación: trackear la migración a PKCE como trabajo futuro para **cuando** se cablee el deep-linking (no ahora). No es un hueco nuevo de esta feature.

- **L2 — `[auth.external.apple] email_optional` debe permanecer `false`.** Si se habilitara (`config.toml:330` hoy `false`, correcto), Apple podría autenticar sin email → el trigger `insert into user_private (email) values (new.email)` con `new.email` NULL viola el `NOT NULL` de `user_private.email` (0068) → **la transacción del signup falla** (el trigger corre en la misma txn). Es un fail-closed (signup roto), no un hueco de seguridad, pero conviene documentarlo como invariante de config junto a M1.

- **L3 — `name` fallback = local-part del email, y `name` se denormaliza a coworkers.** Para Apple sin `name`, el trigger cae a `split_part(email,'@',1)` (0068), y `public.users.name` se sincroniza a coworkers vía `user_roles.member_name` (`rafaq.yaml:304-305`). Para un email tipo `nombre.apellido.dni@gmail.com`, el local-part podría exponer algo de PII a coworkers. **Es comportamiento pre-existente** (el signup email/password ya usa el mismo fallback) y para Apple relay el local-part es hex aleatorio (no PII). No es un leak nuevo de esta feature; se anota por completitud.

---

## Tabla de inputs (superficies nuevas que introduce la feature)

Esta feature **no agrega ningún campo de texto libre, buscador ni prompt**. Las superficies nuevas son botones que disparan flujos OAuth; la identidad se deriva de un token verificado server-side, no de input tipeado.

| Campo / superficie | Límite | Validación | OK? |
|---|---|---|---|
| Botón "Continuar con Google" | n.a. (no hay texto tipeado) | server-side (Supabase valida idToken: firma + `aud`) | ✅ |
| Botón "Continuar con Apple" | n.a. | server-side (Supabase valida idToken: firma + `aud` + `nonce`) | ✅ |
| `idToken` / `identityToken` (lo pasa el cliente a `signInWithIdToken`) | opaco (JWT) | **server-side autoritativa** — Supabase valida firma/JWKS + `aud ∈ Authorized Client IDs` + nonce (Apple); identidad NO se toma de input del cliente (R8.3) | ✅ (condicionado a M1) |
| `rawNonce` Apple (generado client-side) | 16 bytes aleatorios | server-side — Supabase compara `SHA256(raw)` vs claim `nonce` del idToken (R8.1) | ✅ |
| `redirectTo` (web) | `window.location.origin` (app-controlled) | allow-list de Redirect URLs de Supabase (fail-closed) | ✅ |
| Email/password (form existente) | sin cambios | sin cambios (spec 01) | ✅ (no tocado) |

**Conclusión de inputs**: no hay campo de entrada nuevo sin límite+validación autoritativa. El control server-side es la validación del token por Supabase (R8.2/R8.3). Cumple el requisito de "límite claro + validación server-side por cada campo".

## Tabla de rate limits (acciones abusables tocadas)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `signInWithIdToken` (Google/Apple native) | sí (nativo Supabase) | per-IP (`sign_in_sign_ups=30/5min`, `token_verifications=30/5min`, `config.toml:201-204`) | sí | No brute-forceable: exige idToken válido del proveedor |
| `signInWithOAuth` (web Google/Apple) | sí (nativo Supabase) | per-IP (`sign_in_sign_ups`) | sí | Redirect a proveedor; sin credencial adivinable |
| `token_refresh` (sesión OAuth) | sí (`150/5min` per-IP, `config.toml:200`) | per-IP | sí | Igual que sesión password (agnóstico del proveedor) |
| Lockout brute-force password (`sign-in.tsx`) | sí (5/10min→15min, cliente) + rate-limit server | per-email (cliente) + per-IP (server) | sí | **No tocado** por social (R8.5); no se debilita ni resetea |
| Edge Function custom nueva | n.a. | — | — | **La feature NO agrega ninguna Edge Function** → sin nuevo vector de email/SMS/API-externa/bulk |

**Nota**: el keyeo del auth nativo de Supabase es **per-IP** (no per-user/establishment). Es aceptable para superficie pre-auth (todavía no hay sesión). No hay operación autenticada abusable nueva que exigiría keyeo per-user.

---

## Dominios de seguridad revisados (catálogo RAFAQ)

- **A4 (function-level authz)** — la autoridad es la validación del token por Supabase; identidad solo del token verificado (R8.3). Revisado ✅.
- **B1/B2 (information disclosure / PII en logs)** — R6.6 cubre no mostrar crudo al usuario; **gap** en no-loggear tokens → Finding M3.
- **C1/C3 (offline/sync + data-at-rest)** — `self_user_private` self-only (no leak WAL); sesión OAuth produce el mismo JWT/`auth.uid()` (design §Multi-tenancy); tokens en SecureStore vía adapter de `supabase.ts`. Revisado ✅.
- **D1/D3 (secrets / service_role en cliente)** — sin service_role ni secret en el bundle; solo client-IDs públicos (R7.6). Revisado ✅.
- **H1/H3 (auth/sesión, token en URL)** — implicit flow en web → L1 (tradeoff aceptado); nonce anti-replay Apple ✅.
- **I1 (PII/compliance)** — email OAuth a `user_private` (R8.6). Revisado ✅.
- **F1 (injection)** — no hay input de usuario concatenado en filtros; no aplica (sin texto libre nuevo). Revisado, sin hallazgo.

## Dominios excluidos (con justificación)

- **A1 (service-role bypass RLS)** — la feature **no** agrega `createAdminClient()` ni Edge Functions. Excluido.
- **A2 (mass assignment)** — no hay `.insert(body)`/`.update(body)` desde el cliente; el único write a DB es el trigger `handle_new_auth_user` (SECURITY DEFINER, sin cambios, campos fijos `id/name` + `user_id/email`). Excluido.
- **A3 (IDOR por FK)** — no se insertan hijos con `*_id` de input de cliente. Excluido.
- **E (abuso a escala / denial-of-wallet)** — no hay endpoint nuevo con costo por request ni bulk/import; los flujos social pegan al rate-limit nativo de Supabase. Excluido.
- **F2 (import de archivos)** — no aplica. **F3 (SSRF)** — no hay `fetch()` server-side a URL influenciada por el usuario. Excluidos.
- **G (BLE)** — no aplica a esta feature. Excluido.
- **RLS nueva / schema nuevo** — la spec no crea tablas ni policies (design §Multi-tenancy: "No se crean tablas ni policies nuevas"; T26 asegura `git diff supabase/` vacío). Excluido.

---

## Resumen para el leader

- **Veredicto: PASS**, con **3 condiciones MEDIUM aditivas** (M1 config-checklist verificable, M2 confirmations-ON + drift de `config.toml`, M3 no-loggear-tokens) que deben foldearse en la spec antes de cerrar y verificarse en el **gate de device (T24) / Gate 2 (modo code)**. Son **aditivas, no bloqueantes** del código buildable-ya (F1–F5).
- **Cero HIGH**: los flujos criptográficos (nonce Apple, audience, PII, lockout, redirect) están correctos y validados contra el código real. Los modos de falla de la config externa son **fail-closed**.
- **La única pieza que no pude verificar** (fuera de mi alcance) es el estado real del **Dashboard remoto de Supabase** (Authorized Client IDs cargados, nonce enforcement Apple, verified-email linking, confirmations ON). Eso es precisamente lo que M1/M2 piden pinnear como criterio de aceptación y confirmar en el device gate — el "Gate 1 debe confirmar la config del Dashboard" de la spec no puede resolverlo este agente sin acceso; queda delegado a Raf con valores-objetivo explícitos.
