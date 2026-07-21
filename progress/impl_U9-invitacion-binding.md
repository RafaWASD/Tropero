baseline_commit: 7477b21f022fdb5461b9a3e98676ba7792bbf98e

# impl U9 — binding opcional al email + TTL 72h + claim atómico (TOCTOU)

Delta de seguridad sobre el flujo de invitación existente (spec 01, ADR-014). Origen:
`progress/security_audit_U9-invitacion.md`. Raf aprobó **opción A** (binding OPCIONAL al email +
TTL más corto) + cerramos **MEDIUM-1** (single-use no atómico / TOCTOU).

**Addendum HIGH-1 (Gate 2 + decisión leader, 2026-07-21)**: Gate 2 confirmó el hallazgo teed-up de mi
autorrevisión (el binding no exigía email verificado → bypass condicional a `enable_confirmations`).
Decisión del leader: **opción 1 (robusta)** — enforcement server-side, el binding NO puede depender de
un toggle de config. Implementado: `requireUser` expone `emailVerified` (aditivo) y el binding exige
`email_unverified` → 403 cuando el email coincide pero no está verificado.

**Alcance backend-only (Edge Functions).** SIN migración (el TTL vive en código, no en el schema; el
claim atómico es un UPDATE condicional, no requiere DDL). Gate 2.5 (capturas UI) = **N/A** — no toca
pantallas/componentes; el único toque de cliente es texto: la entrada de copy `email_mismatch` (con
unit test) y la nota de expiración "7 días"→"72 horas" en `invitar.tsx`.

⚠️ NO deployado (código de auth — deploy gateado, lo coordina el leader con Raf). Va a Gate 2 (code)
antes del deploy. NO commiteado (leader coordina).

## Plan (tasks) — todas hechas

- [x] **T1** — Binding OPCIONAL al email en `accept_invitation`.
- [x] **T2** — TTL 72h en `invite_user` + `resend_invitation`. Chequeo de expiry al aceptar: **ya
  existía** (`accept_invitation` líneas 66-74 → 410 `expired`), confirmado.
- [x] **T3** — Claim atómico (TOCTOU) en `accept_invitation`.
- [x] **T4** — Client copy `email_mismatch` (`app/src/utils/invite.ts`) + unit test.
- [x] **T5** — Suite Edge extendida, gated por `U9_DEPLOYED`.
- [x] **T6** — Reconciliación ADR-014 + spec 01 (requirements/design/tasks).

## Los 3 cambios (archivo:línea)

1. **Binding OPCIONAL al email + email verificado** — `supabase/functions/accept_invitation/index.ts`
   (bloque `if (inv.email) { … }`) + `supabase/functions/_shared/auth.ts`.
   - Match: `if (invEmail !== user.email) → 403 email_mismatch`. Se ubica DESPUÉS del check de expiry y
     ANTES del check de already_member y del claim, así un mismatch **no consume** la invitación.
   - Verificado (HIGH-1): `if (!user.emailVerified) → 403 email_unverified` (tampoco consume). El binding
     confía en el claim `email` del JWT y eso solo vale con email verificado.
   - `inv.email` null → bearer (flujo WhatsApp intacto; no aplica ni match ni verificado).
   - `user.email` viene lowercased de `requireUser`; `inv.email` garantizado lowercase por el CHECK
     `invitations_email_lower` (0004:30) + `.trim()` defensivo.
   - **`_shared/auth.ts`**: `AuthUser` gana `emailVerified: boolean` (aditivo) y `requireUser` lo deriva
     de `data.user.email_confirmed_at != null`. Los otros 7 EFs solo leen `user.id`/`user.email`
     (verificado por grep) → el campo aditivo NO los rompe (typing estructural). Enforcement server-side
     puro: NO depende de `enable_confirmations` del proyecto. Header de `accept_invitation` actualizado.
     Copy es-AR clara en ambos 403.

2. **TTL 72h** — `invite_user/index.ts:23-25` (`INVITATION_TTL_HOURS = 72`) usado en `:133-135`;
   idéntico en `resend_invitation/index.ts:19-21` usado en `:64-66`. Era `INVITATION_TTL_DAYS = 7`.
   Cliente reconciliado: `app/app/invitar.tsx:80` "7 días"→"72 horas".

3. **Claim atómico (TOCTOU / MEDIUM-1)** — `accept_invitation/index.ts:114-161`. Reemplaza el orden
   viejo (insert user_roles → marcar accepted, sin lock). Ahora: `UPDATE invitations SET
   status='accepted', accepted_at=now() WHERE id=? AND status='pending' RETURNING id` con
   `.maybeSingle()`; si `claimed` es null (0 filas) → 409 `invalid_state` (perdió la carrera). SOLO el
   ganador inserta `user_roles`. Si el insert falla, revierte el claim a `pending` (compensación
   best-effort — no hay transacción explícita EF↔DB). Atómico a nivel statement (row-lock de Postgres),
   pooler-safe (una sentencia, no un check-then-act de dos viajes).

## Trazabilidad R<n> → test

| Requisito / finding | Test | Archivo | Corre |
|---|---|---|---|
| Binding: coincide + VERIFICADO → OK | `U9 (opción A): invitación CON email → email que COINCIDE y VERIFICADO acepta (OK)` | `supabase/tests/edge/run.cjs` | gated `U9_DEPLOYED` (post-deploy) |
| Binding: coincide pero NO verificado → rechazo + NO consume (HIGH-1) | `U9 HIGH-1: invitación CON email → email COINCIDE pero NO verificado → rechazado (NO consume)` | `run.cjs` | gated `U9_DEPLOYED` |
| Binding: no coincide → 403 + NO consume | `U9 (opción A): invitación CON email → OTRO email → 403 email_mismatch (NO consume)` | `run.cjs` | gated `U9_DEPLOYED` |
| Binding: sin email → bearer | `T2.2 U9: invitación SIN email (null) → bearer` | `run.cjs` | **siempre** (compatible con EF vieja y nueva) |
| Copy es-AR de `email_mismatch` + `email_unverified` (cliente) | `inviteErrorCopy: mapea códigos conocidos...` (+asserts email_mismatch y email_unverified) | `app/src/utils/invite.test.ts` | **siempre** (unit puro, sin deploy) — ✅ 14/14 verde |
| TTL 72h | `U9: invite_user setea expiración a 72h (no 7 días)` | `run.cjs` | gated `U9_DEPLOYED` |
| TOCTOU: 1 gana / 1 pierde | `U9 MEDIUM-1 (TOCTOU): dos aceptaciones concurrentes...` | `run.cjs` | gated `U9_DEPLOYED` |
| Expiry al aceptar (ya existía) | `T2.2 R5.6: invitación expirada falla` | `run.cjs` | siempre |

**Por qué gated**: los tests de binding/TTL/TOCTOU verifican comportamiento de las EFs que **aún no
está deployado**. Contra las EFs viejas fallarían (la vieja es bearer-siempre, TTL 7d, sin claim). El
gate `U9_DEPLOYED=1` los skipea en el check normal (mismo patrón que el viejo `SPEC13_APPLIED`). El
test "sin email → bearer" NO se gatea: null-email es bearer en ambos mundos (regresión permanente del
flujo WhatsApp). Cada gated test es además un buen oráculo del bug pre-fix: el TOCTOU da `successes=2`
contra la EF vieja y `=1` contra la nueva; el mismatch da éxito contra la vieja y 403+pending contra
la nueva.

## Verificación hecha (sin deploy)

- ✅ **Client typecheck** de MI changeset (incluye `invite.ts`, `invite.tsx`, `invite.test.ts`): limpio.
  `pnpm -C app typecheck` reporta errores SOLO en `app/src/components/FooterActionShell.tsx` (archivo
  UNTRACKED de **otra terminal**, feature U2 "CTA siempre visible" — WIP con `ViewStyle`/
  `contentContainerStyle` sin definir). `grep -v FooterActionShell` sobre los `error TS` → **0 líneas** =
  ningún error atribuible a mis cambios. NO toco esos archivos (regla colisión-safe de terminales
  paralelas).
- ✅ **Client unit test** `invite.test.ts` → **14/14 verde** (incluye los asserts nuevos de
  `email_mismatch` y `email_unverified`).
- ✅ **`node --check supabase/tests/edge/run.cjs`** → sintaxis OK. `t.test(name, {skip}, fn)` soportado
  por node:test (Node 24).
- ✅ **8 EFs — impacto del campo aditivo (estático)**: grep de `requireUser`/`AuthUser` en las 8 EFs →
  todas solo consumen `user.id`/`user.email` (accept_invitation además `emailVerified`); ninguna
  construye un literal `AuthUser`. `emailVerified` es aditivo → typecheck-compatible con las 8 (typing
  estructural). NO se rompe ninguna.
- ⚠️ **Edge Functions (Deno) — typecheck real**: NO hay toolchain Deno local (`which deno` → nada; sin
  `deno.json`). Las EFs no entran en el `tsc` del cliente (viven fuera de `app/`). Verificación =
  **revisión manual cuidadosa** del archivo compuesto (`_shared/auth.ts` con `emailVerified`; flujo
  lookup→status→expiry→binding(match+verificado)→already_member→claim→insert→notif coherente; sin
  imports nuevos; `data.user.email_confirmed_at` es campo estándar del User de supabase-js; patrones ya
  usados en el repo). Typecheck real de la EF = post-deploy (o si se agrega toolchain Deno).
- ⛔ **`node scripts/check.mjs` completo NO corre a verde AHORA** por causa EXTERNA: el paso 1
  (typecheck cliente) aborta por el WIP de FooterActionShell de la otra terminal, antes de llegar a
  las suites. NO es regresión mía. Cuando esa terminal cierre su typecheck, el check normal corre las
  suites; la Edge suite queda verde (los U9 gated skipean; el "sin email → bearer" pasa contra la EF
  vieja).

## Autorrevisión adversarial

**¿El binding opcional deja algún bypass?**

- **Case / whitespace**: cerrado. Ambos lados normalizados (`user.email` lowercased en `requireUser`;
  `inv.email` `.trim().toLowerCase()` + CHECK `invitations_email_lower`). El `.trim()` no puede abrir
  bypass (solo puede convertir un no-match en match si la única diferencia es whitespace circundante, y
  `user.email` del JWT no tiene whitespace → sería el match correcto al address anotado).
- **`inv.email` vacío/""**: el CHECK `invitations_email_not_empty` (0004:29) impide `""` en DB, e
  `invite_user` setea `null` (no "") cuando no viene email. Si "" se colara igual, `if (inv.email &&…)`
  → "" falsy → bearer, que es el comportamiento correcto para "sin email". No es bypass.
- **`inv.email` null**: bearer por diseño (opción A). No es bypass; es el flujo WhatsApp intacto.
- **✅ RESUELTO — email NO verificado (era HIGH-1 teed-up; Gate 2 lo confirmó → cerrado con opción 1)**:
  el binding ahora exige `user.emailVerified` cuando aplica (403 `email_unverified`). Enforcement
  **server-side** en `accept_invitation` vía el campo aditivo `emailVerified` de `requireUser`. Ya NO
  depende de `enable_confirmations` (que en local está en false). El atacante que se registra con el
  email bindeado sin verificarlo NO entra, aun llamando la EF a mano.
  - **¿El check de verificado tiene huecos?** (a) Deriva de `email_confirmed_at` — el campo canónico de
    verificación de email de Supabase; no uso `confirmed_at` (alias deprecado que un confirm de teléfono
    podría prender — la app es email-only, pero `email_confirmed_at` es el correcto/estricto). (b)
    `!= null` cubre null y undefined. (c) Se evalúa DENTRO del `if (inv.email)`, después del match: un
    no-verificado con email coincidente → `email_unverified`; con email distinto → `email_mismatch`
    (falla antes, no hace falta llegar a verificado). (d) Bearer (email null) no aplica el check — es
    intencional (no hay identidad que verificar; el bearer nunca prometió identidad). (e) NO consume la
    invitación → el user verifica y reintenta con el mismo link (integra con R5.13; en cliente lo hice
    NO-terminal, preserva el token). (f) No hay TOCTOU nuevo: el check es sobre el JWT del request,
    inmutable durante la llamada. Sin huecos identificados.
  - **¿El campo aditivo rompe algún EF?** No. Grep de `requireUser`/`AuthUser` en los 8 EFs: todos solo
    leen `user.id`/`user.email` (accept_invitation además `user.emailVerified`); ninguno construye un
    literal `AuthUser` ni usa exact-types → agregar un campo es no-breaking (typing estructural de TS).
    Client typecheck limpio (aparte del WIP externo). Nota de deploy: `_shared/auth.ts` se re-bundlea en
    CADA `functions deploy`; deployar los 3 EFs de invitación trae el nuevo auth.ts a esos bundles; los
    otros 5 EFs conservan su bundle actual hasta que se los redeploye (inerte, no usan el campo).

**¿El claim atómico es realmente atómico bajo el pooler?**

- **Sí.** El `UPDATE … SET status='accepted' WHERE id=? AND status='pending'` es una **sola sentencia**.
  Postgres toma row-lock sobre la fila; bajo dos aceptaciones concurrentes del mismo token, la 2da
  bloquea hasta que la 1ra commitea y re-evalúa su WHERE (READ COMMITTED / EvalPlanQual) contra la fila
  ya `accepted` → matchea 0 filas → pierde. NO hay ventana para que ambas ganen. El pooler
  (transaction-mode) no parte una sentencia: cada `functions.invoke` de supabase-js es su propia txn,
  pero el claim es 1 statement = 1 txn atómica. Verificado conceptualmente + cubierto por el test
  `U9 MEDIUM-1 (TOCTOU)` (post-deploy).
- **Compensación (claim revertido si el insert falla)**: si el ganador claimó pero el insert de
  `user_roles` falla, se revierte `status→pending`. No corrompe: tras el revert la invitación vuelve a
  ser reclamable (retry limpio). El único insert-fail realista es el unique de `user_roles`
  (`user_roles_active_unique`, 0003:32-34) por una carrera con OTRA invitación del mismo user/campo —
  extremo (ya se chequeó already_member antes) y no-corruptivo (a lo sumo un 500 en esa rama, con el
  claim revertido). Antes del fix, ese unique era justamente lo que NO protegía el caso TOCTOU (dos
  users DISTINTOS → user_id distinto → sin conflicto → ambos entraban); el claim lo cierra.
- **already_member ANTES del claim**: correcto — así un "ya sos miembro" no consume la invitación.
- **accepted_at**: lo setea el claim (antes lo seteaba el bloque viejo que borré). El test
  `T2.2 R5.5` asserta `accepted_at` no-null → cubierto por el claim.

**Otros:**
- Notificaciones al owner (R5.10/R5.11) siguen best-effort DESPUÉS del claim+insert; un throw ahí no
  revierte la aceptación (correcto).
- Orden de gates: expiry → binding(match → verificado) → already_member → claim → insert. Si expira Y
  email no matchea, gana expiry (410) — terminal de todos modos.
- **Cliente**: `email_unverified` es NO-terminal en `invite.tsx` (preserva el token persistido) → el
  user verifica y reintenta con el mismo link (R5.13). `email_mismatch` sigue terminal (borra token).
  Copy es-AR para ambos en `invite.ts`. El flujo honesto casi nunca llega a `email_unverified` (R1.3
  gatea la aceptación tras verificación en el cliente); es defensa server-side.
- `resend_invitation` también a 72h → coherente; su test (`T2.4 R5.8`) no asserta el valor exacto de
  TTL, así que queda verde contra EF vieja o nueva (no requiere gate).

## Reconciliación de specs

- **`docs/adr/ADR-014-*.md`**: nueva sección **"Revisión U9 (2026-07-21)"** — documenta binding
  opcional (revisa la decisión #3 "se elimina email-matching") + **enforcement de email verificado
  server-side (HIGH-1)**, TTL 72h (revisa "expiración corta 7 días"), single-use atómico (MEDIUM-1), +
  deferido MEDIUM-2.
- **`specs/active/01-identity-multitenancy/requirements.md`**: notas de reconciliación (EARS intactos)
  bajo **R5.1** (email pasa de solo-anotación a binding opcional + email verificado server-side),
  **R5.2** (7 días → 72h), **R5.6** (single-use "de facto" → garantizado por claim atómico).
- **`.../design.md`**: flujo de `accept_invitation` (pasos b-bis binding + d claim atómico + e insert
  solo-ganador con compensación); "Diferencias clave" (bearer → bearer con binding opcional); resumen
  de Edge Functions (#2); tablas de Decisiones (email en invitations) y Riesgos (TTL 72h, binding como
  mitigación, nueva fila TOCTOU); invite_user insert (72h).
- **`.../tasks.md`**: notas `[x] Delta U9` bajo T2.1 (TTL), T2.2 (binding + email verificado + claim),
  T2.4 (resend 72h) + copy de expiración del cliente (72h).
- **Cliente (as-built, no era spec formal)**: `invite.ts` (copy `email_mismatch` + `email_unverified`),
  `invite.tsx` (`email_unverified` no-terminal), `invitar.tsx` (nota "72 horas").

Ningún doc queda contradiciendo el código.

## Pendiente de DEPLOY (lo coordina el leader con Raf; NO deployar sin la puerta de deploy)

1. **Deploy de 3 Edge Functions** a dev (y luego prod): `accept_invitation`, `invite_user`,
   `resend_invitation`. NO hay migración. Vía `supabase functions deploy <name>` (mismo mecanismo que
   los deploys de EFs de feature 18). **Nota `_shared/auth.ts`**: cada deploy re-bundlea los shared;
   deployar estos 3 trae el nuevo `auth.ts` (con `emailVerified`) a sus bundles. Los otros 5 EFs
   conservan su bundle actual hasta que se los redeploye (cambio inerte para ellos). **El leader flagea
   este toque de contrato compartido en la puerta de deploy** (Raf lo revisa antes de prod).
2. **Post-deploy**: correr `U9_DEPLOYED=1 node --test supabase/tests/edge/run.cjs` (con las keys en
   `.env.local`) para ejercitar los 5 tests gated (binding verificado→OK, coincide-pero-no-verificado→
   rechazo, mismatch→403, TTL 72h, TOCTOU). Sin el flag no corren. Reintegrar al check normal solo si
   se decide que el flag pase a "siempre" (como se hizo con `SPEC13_APPLIED`).
3. **Defensa en profundidad (Raf, en el dashboard al deployar)**: confirmar
   `enable_confirmations=true` en PROD. Ya NO es el enforcement real del binding (eso es server-side vía
   `emailVerified`), pero suma que un no-verificado ni siquiera obtenga sesión. HIGH-1 quedó cerrado en
   código (opción 1) — este punto es capa extra, no bloqueante del enforcement.
4. **MEDIUM-2 (token en URL/localStorage web)**: deferido — se endurece cuando exista la página web
   `app.rafq.ar/invite`.
