# Security Code Review — 01 Fase 6 FRONTEND (perfil / cuenta) — Gate 2, modo `code`

**Agente**: security_analyzer (Gate 2).
**Fecha**: 2026-06-01 (sesión 22).
**baseline_commit**: `063ab798ef21a76a93d7071e1a8fd860e351de85` (registrado en `progress/impl_01-frontend-fase6-frontend.md:1`).
**Alcance**: SOLO el FRONTEND de la Fase 6 (React Native + Expo). El backend (edge `delete_account` + RPC `delete_account_tx` migración 0058) ya pasó Gate 2 por separado (`progress/security_code_01-frontend-fase6-backend.md`) — NO se re-audita. Los tests edge fallan por deploy-pending — fuera de objeto por instrucción.

Archivos auditados (working tree, sin commitear — `git diff <baseline>..HEAD` da vacío porque trabajamos sobre `main` sin feature-branch; el scope real son estos artefactos del `git status`):
- `app/src/services/account.ts` (CREADO) — `changeEmail` + `deleteAccount` (I/O supabase-js).
- `app/src/utils/account-result.ts` (CREADO) — mapeo PURO de errores.
- `app/src/contexts/ProfileContext.tsx` (CREADO) — fuente única del saludo.
- `app/src/services/profile.ts` (CREADO) — `loadProfileNamePhone` (lee `public.users`).
- `app/app/(tabs)/mas.tsx` (MODIFICADO) — `EmailChangeForm` + `DeleteAccountSection`.
- `app/src/services/establishments.ts` (MODIFICADO) — `saveProfile` (sacó el sync a auth-metadata).

**Skill**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability; referencias `authentication.md` §Email Address Changes/§Session Lifecycle/§Re-auth, `data-protection.md` §Logging/§Information Disclosure, language JS/TS) + checklist RAFAQ-específico client-side (identidad del JWT, sesión post-delete, deep-links, manejo de Response — que la skill cubre indirectamente para RN/Expo).

## Veredicto: PASS

Cero findings HIGH client-side. La identidad se deriva siempre del session/JWT (jamás hardcodeada ni tomada de un lugar manipulable), no hay un solo `console.*` que loguee email/tokens/PII en el scope, la sesión se cierra correctamente tras la baja (fail-closed contra mostrar "deleted" sin éxito real), el cambio de email respeta R2.2 (display sigue el viejo hasta confirmar) y no hay superficie de deep-links/inyección en estos archivos. El frontend es una capa de presentación + disparo de I/O sobre un backend ya gateado; no introduce vectores nuevos.

---

## Verificaciones que pasaron (foco Gate 2, HIGH-confidence)

### 1. Identidad / autorización — derivada SIEMPRE del session (sin hardcode, sin lugar manipulable)

Trace de la identidad en cada operación del scope:

- **`deleteAccount()`** (`account.ts:98-131`): invoca el edge con `supabase.functions.invoke('delete_account', { body: {} })` (`:102`). Body **literalmente vacío** — no se pasa `user_id` ni `establishment_id`. El JWT lo adjunta supabase-js de forma automática (patrón verificado idéntico en `members.ts:11` "el JWT lo agrega supabase-js solo" y `push-notifications.ts:70`). La identidad la deriva el edge de su propio `requireUser` (server-side, ya gateado en el review backend §2). **Sin IDOR del lado cliente**: no existe parámetro attacker-controlled que pueda targetear otra cuenta. La única mención de `user_id` en el archivo es un comentario (`:14`) que documenta explícitamente que NO se pasa. Confirmado por grep: no hay `user_id`/`p_user_id` en ningún call.
- **`changeEmail(newEmail)`** (`account.ts:45-59`): delega a `supabase.auth.updateUser({ email })` (`:48`). La operación actúa sobre la sesión actual (el propio usuario del JWT) — la Auth API no acepta un user-id objetivo acá. Sin cross-user.
- **`loadProfileNamePhone(userId)`** (`profile.ts:36-55`): `SELECT name, phone FROM users WHERE id = userId` (`:39-43`). El `userId` no es attacker-controlled: en el único caller (`ProfileContext.tsx:59`) sale de `authState.user.id` (= `session.user.id`, derivado del JWT por supabase-js en `AuthContext.tsx:68`). Defensa real: RLS `users_select_self` (0006) restringe a `id = auth.uid()` server-side — aun si el cliente pidiera otro id, RLS devuelve 0 filas. El `.eq('id', userId)` es scoping de UX, no la barrera. Sin fuga cross-tenant.
- **`saveProfile(userId, …)`** (`establishments.ts:231-245`): `UPDATE users SET name, phone WHERE id = userId` (`:236-239`). Mismo `userId` del session; RLS `users_update_self` exige `id = auth.uid()` (un user solo edita su propia fila). El `userId` que llega a `ProfileSection`/`ProfileEditForm` viene de `MasScreen` (`mas.tsx:661` `authState.user.id`). Sin escalada.

Conclusión: ninguna de las 4 operaciones acepta un identificador de usuario manipulable; todas operan sobre el sujeto del JWT, con RLS server-side como barrera real. ✓

### 2. Fuga de datos / PII en logs — NINGUNA en el scope

Grep de `console.(log|warn|error|info|debug)` en los 3 archivos sensibles (`account.ts`, `ProfileContext.tsx`, `mas.tsx`): **0 matches**. No se loguea email, token, ni PII en ningún path del scope (cf. `data-protection.md` §Logging — "What NOT to Log"). El cliente Supabase ya documenta que NUNCA loguea el contenido de la sesión (`supabase.ts:8-9`, el storage adapter mueve bytes opacos). El único `console.warn` del árbol auth es en `AuthContext.tsx:121` (dev-only, `NODE_ENV !== 'production'`, loguea solo `result.error.kind` — un enum, sin PII) y queda fuera del scope de Fase 6.

**Mensajes de error al usuario** (cf. `authentication.md` §Error Messages / `data-protection.md` §Information Disclosure): los `message` que se renderizan son copy fijo es-AR (`mas.tsx:319-326`, `:421-425`, `OFFLINE_COPY:50`), no el raw del server. El raw (`err.message`) solo se propaga al `message` del Result tipado (`account.ts:56`, `account-result.ts:91`) pero la UI elige la rama por `reason`/`code`, no muestra el raw salvo en `softDeleteEstablishment` (`mas.tsx:464,723`) que muestra `result.error.message` — y ese mensaje viene de Postgres en un path autenticado owner-only (info-disclosure marginal, patrón preexistente del repo, LOW). No expone tokens ni datos de terceros. ✓

### 3. Manejo de sesión post-delete — fail-closed, sin camino que deje la sesión viva

Trace del flujo de baja (`mas.tsx` `DeleteAccountSection.callDelete`, `:401-427`):
- `deleteAccount()` retorna → SOLO si `result.ok` (`:408`) se setea `{kind:'deleted'}` y se llama `await signOut()` (`:410-411`). El `signOut` local es `supabase.auth.signOut()` (`AuthContext.tsx:147`) → limpia la sesión persistida (SecureStore/localStorage) y dispara `onAuthStateChange` → el RootGate re-rutea a auth.
- **Fail-closed verificado**: la pantalla NUNCA muestra "cuenta eliminada" sin un `result.ok` real. Los casos `sole_owner` (`:414`), `network`/`unauthorized`/`unknown` (`:418-426`) NO tocan la sesión y NO muestran "deleted" — vuelven a `blocked`/`error`. No hay rama que setee `deleted` ante un fallo.
- **Caso `unauthorized`** (`account-result.ts:100-101`, `mas.tsx:423`): se mapea a copy "Tu sesión expiró. Cerrá sesión y volvé a entrar." — no expone nada sensible, no asume baja consumada. (Aun si la sesión está vencida, no se borra nada y el usuario es ruteado a re-auth por el flujo normal.)
- **Defensa en profundidad server-side**: aunque el `signOut` local fallara, el edge ya hizo el ban + signOut global server-side (review backend §4) → el re-login queda cerrado server-side y RLS niega datos con los roles inactivos. El `signOut` local del cliente es UX (sacar al usuario de la pantalla), no la única barrera.
- **Idempotencia** (`account.ts:130`, `mas.tsx:408`): `already_deleted=true` también entra por `result.ok` → igual hace `signOut()`. No deja sesión viva tras una baja ya consumada.
- **Re-entrancy** (`mas.tsx:399,402-406`): `busyRef` impide que un doble-tap dispare dos bajas. ✓

### 4. Cambio de email — R2.2 respetado (display sigue el viejo hasta confirmar)

Trace (`account.ts:45-59` + `mas.tsx:287-364`):
- `changeEmail` solo dispara `auth.updateUser({email})` (`account.ts:48`). Supabase mantiene el email viejo activo hasta que el usuario confirme desde el mail nuevo (doble-confirmación nativa — cf. `authentication.md` §Email Address Changes, que exige confirmación al email nuevo dentro de un time-limit; Supabase lo implementa).
- El display lee `profile.email` (`mas.tsx:173,276`), que el `ProfileContext` deriva del **session de auth** (`ProfileContext.tsx:60,111` ← `authState.user.email` ← `session.user.email`). El session reporta el email viejo hasta que el cambio se confirma (R2.2 nativo). El nuevo email NO se asume efectivo: tras submit OK, la UI muestra el copy "Te mandamos un mail a {nuevo}… tu email sigue siendo {viejo}" (`mas.tsx:336-337`) — explícito y correcto.
- **No hay riesgo de asumir el cambio efectivo antes de confirmar**: el cliente no escribe el nuevo email en ningún store local ni lo muestra como activo. El estado `pendingEmail` (`mas.tsx:293`) es solo para el copy de confirmación, no muta `profile.email`. ✓
- Guard de "mismo email" (`mas.tsx:303-306`) es UX defensivo (case-insensitive), no security-relevante.

### 5. Deep-links / inyección / manejo de Response — sin superficie en el scope

- **Deep-links**: grep de `Linking`/`getInitialURL`/`addEventListener`/`scheme://` en `account.ts` → **0 matches**. Ningún archivo del scope frontend parsea ni consume deep-links. El manejo de deep-link de verificación de email es nativo de supabase-js (`detectSessionInUrl` en `supabase.ts:80`, solo web) — fuera del scope de Fase 6 y ya existente. Sin inyección.
- **Manejo de Response** (`account.ts:68-86`): el unwrap del `FunctionsHttpError` lee `error.context` como `Response` y hace `await context.json()` con guard de tipo (`:72`) y `try/catch` (`:73-81`) que cae a `unknown` si el body no parsea. El body parseado pasa por el mapeo PURO defensivo (`account-result.ts`): `parseBlockingEstablishments` (`:65-78`) valida que cada item sea objeto con `id` string antes de incluirlo — no confía en el shape crudo del server. No hay `eval`, `JSON` con reviver peligroso, ni `dangerouslySetInnerHTML`. React/RN auto-escapa el render de `est.name` (`mas.tsx:532`) — sin XSS aun si el name trajera markup. ✓
- **`establishments`/lista bloqueante**: viene del edge (server-side, derivada de los `user_roles` del propio caller, review backend §6), no la fabrica el cliente. El cliente solo la renderiza y permite soft-delete por campo vía `softDeleteEstablishment` (RLS owner-only). Sin fabricación de IDs cross-tenant. ✓

### 6. Otros vectores client-side — sin hallazgos HIGH

- **`saveProfile` sacó el sync a auth-metadata** (`establishments.ts:217-245`): el cambio (dejar de escribir `auth.user_metadata.name`, escribir solo `public.users`) es una mejora de consistencia, no abre vector. La fuente del saludo ahora es `public.users` vía RLS — más restrictiva que metadata. Sin regresión de seguridad.
- **ProfileContext loadSeq guard** (`ProfileContext.tsx:69,79,84`): el guard de carga stale (descartar resultado de una carga vieja si el `userId` cambió) PREVIENE un cross-user leak sutil (mostrar el perfil del user A tras loguearse como B si el fetch de A resuelve tarde). Es defensa correcta, no un problema. ✓
- **Sin secrets hardcodeados**: grep de `email|token|password|secret` en `ProfileContext.tsx` → solo comentarios y la prop `email` derivada del session. Ningún literal sensible. ✓

---

## False positives descartados / NO reportados (trazabilidad)

1. **`softDeleteEstablishment` muestra `result.error.message` raw** (`mas.tsx:464,723`) → el mensaje viene de Postgres en un path autenticado owner-only (la RLS ya bloqueó a no-owners). Info-disclosure marginal, patrón ESTABLECIDO del repo (mismo que el `db_error` del backend, review backend §6). **LOW, no HIGH** — no expone tokens ni datos de terceros, solo un mensaje de error de constraint sobre el propio campo del owner.
2. **`.eq('id', userId)` en profile.ts/establishments.ts podría verse como confiar en el cliente** → NO es la barrera de seguridad; RLS `users_select_self`/`users_update_self` (0006) es la barrera real (`id = auth.uid()` server-side). El `.eq` es scoping de UX. False positive de pattern-matching (cf. skill §"ORM .filter(id=input) parameteriza"). Además `userId` no es attacker-controlled (sale del session).
3. **`auth.updateUser({email})` sin re-autenticación previa** → `authentication.md` §Re-auth recomienda fresh credentials antes de cambiar email. Supabase NO expone re-auth obligatoria nativa para email-change en este flujo, y el design de Fase 6 (R2.1/R2.2) no la pidió. La doble-confirmación nativa (link al email nuevo + el viejo sigue activo) mitiga el riesgo principal (toma de cuenta por cambio silencioso). **LOW / mejora futura, no HIGH** — no es regresión ni vector explotable hoy; si se quisiera endurecer (re-auth antes de cambiar email) sería una decisión de producto a nivel spec, no un bug de esta implementación.
4. **`pendingEmail` se guarda en estado local** (`mas.tsx:293,313`) → es solo el string para el copy de confirmación, NO muta `profile.email` ni se persiste. No asume el cambio efectivo. No es leak (es el email que el propio usuario acaba de tipear).
5. **`window.confirm` en `confirmDestructive`** (`mas.tsx:874-879`) → web-only, string fijo + `title`/`message` server-trusted (copy de la app + nombre de campo del propio owner). Sin inyección (no es `eval`, no renderiza HTML). False positive.

## Cobertura de la skill (advertencia)

- `sentry-skills:security-review` cubre bien JS/TS/React (auto-escape, XSS, manejo de Response, logging de PII), que es el grueso del scope frontend. La metodología (trace data flow + verify exploitability) se aplicó a cada vector.
- **Cobertura indirecta — revisión manual RAFAQ-específica**: la skill NO modela nativamente (a) el flujo de identidad por JWT de supabase-js (que el `invoke` adjunta el token automáticamente y el body va vacío), ni (b) que RLS server-side (no el `.eq` del cliente) es la barrera de tenant-isolation. Ambos se verificaron por trace manual contra el patrón establecido (`members.ts`, `push-notifications.ts`) y la RLS de spec 01 (`users_select_self`/`users_update_self`, 0006).
- **No cubierto / no aplica**: PowerSync/offline (Fase 7, diferida; R9.2 declara estas operaciones ONLINE). BLE/React Native deep-linking nativo (sin superficie en el scope). No se ejecutó la app en device.
- **El gating server-side (edge + RPC) se asume del review backend** (`security_code_01-frontend-fase6-backend.md`, PASS) — el frontend solo es el disparador.

## Recomendación al leader

**PASS**. El frontend de Fase 6 no introduce vectores HIGH client-side: identidad siempre del JWT (sin hardcode ni param manipulable), cero logging de PII/tokens, sesión cerrada fail-closed tras la baja, R2.2 respetado (display sigue el email viejo hasta confirmar), sin superficie de deep-links/inyección. Los 3 puntos LOW detectados (mensaje raw de Postgres en path owner-only; ausencia de re-auth nativa antes de email-change; info-disclosure marginal de errores) son deuda sistémica del repo o decisiones de producto a nivel spec — anotables en backlog, NO bloqueantes para Gate 2. Listo para la puerta de aprobación humana.

> Pendiente operacional (no de seguridad, no bloquea Gate 2): los 8 tests del edge `delete_account` no corren hasta el deploy de 0058 + la función (lo hace el leader). El comportamiento end-to-end de la baja (signOut global server-side, re-login bloqueado por ban) depende de ese deploy — el frontend ya está fail-closed contra mostrar "deleted" sin éxito real.
