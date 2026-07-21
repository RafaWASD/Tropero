# Security code review — U9: binding opcional + TTL 72h + claim atómico

**Modo**: code (Gate 2 / ADR-019). Cambio de auth → revisión antes del deploy.
**Fecha**: 2026-07-21
**Baseline**: `7477b21f022fdb5461b9a3e98676ba7792bbf98e` (todos los cambios sin commitear, working tree).
**Alcance (delta U9 solamente)**: `accept_invitation/index.ts` (binding + email_unverified + claim),
`invite_user/index.ts` + `resend_invitation/index.ts` (TTL 72h), `_shared/auth.ts` (campo aditivo
`emailVerified`), tests Edge + unit, copy cliente. NO re-audité lo ya OK en
`progress/security_audit_U9-invitacion.md`.

## Veredicto

**PASS (deploy-ready).** HIGH-1 quedó **CERRADO** server-side (2ª pasada): el implementer aplicó la
opción 1 (enforcement de `email_confirmed_at` en la EF, no dependiente de `enable_confirmations`). Los
3 cambios originales (binding match, claim atómico, TTL 72h) siguen sólidos y sin regresión; el campo
aditivo `emailVerified` es puramente aditivo y no rompe los otros 7 EFs. `enable_confirmations` de prod
pasa a defensa-en-profundidad (ya no es el enforcement primario).

### Historial del gate
- **1ª pasada (FINDINGS)**: HIGH-1 — el binding confiaba en `user.email` del JWT sin exigir
  `email_confirmed_at`; efectividad condicionada a un setting de prod no enforced en código.
- **2ª pasada (PASS)**: opción 1 aplicada. HIGH-1 cerrado. Re-verificado abajo.

---

## HIGH-1 — CERRADO (re-verificado, 2ª pasada)

**Fix aplicado** (opción 1, config-independiente):
- `supabase/functions/_shared/auth.ts:9,32` — campo ADITIVO `emailVerified: boolean` en `AuthUser`,
  derivado en `requireUser` como `data.user.email_confirmed_at != null`.
- `supabase/functions/accept_invitation/index.ts:86-108` — dentro de `if (inv.email)`: primero
  `email_mismatch` (86-94), luego **`if (!user.emailVerified) → 403 email_unverified`** (101-107). Ambos
  **PRE-claim** (el claim está en :138). Bearer (`inv.email` null) sin cambios.

**Confirmaciones pedidas:**

1. **¿Signup NO verificado con el email bindeado ahora es rechazado server-side (sin depender de
   `enable_confirmations`)?** — **SÍ.** El binding, tras matchear el email, exige `user.emailVerified`.
   Si el atacante consigue una sesión no-verificada (posible cuando `enable_confirmations=false`, que es
   justo el valor del `config.toml:221` local), `email_confirmed_at` es null → `emailVerified=false` →
   **403 `email_unverified`** antes de tocar la invitación. El enforcement vive en la EF, no en el toggle
   de prod. Cerrado.
   - **null vs undefined**: `email_confirmed_at != null` (loose `!=`) captura **ambos** null y undefined →
     `emailVerified=false` en los dos casos. **Fail-closed**: solo un timestamp real (no-null) da `true`. ✓
   - **Orden de checks**: mismatch → unverified → (fuera del `if`) already_member → claim → insert.
     Correcto: identidad primero, verificación después, consumo al final. ✓
   - **Bearer path (`inv.email` null)**: `if (inv.email)` falso → salta ambos checks → bearer intacto.
     Consistente con el modelo aceptado (el token de 122 bits ES la credencial; no hay email que probar).
     No es regresión ni parte de HIGH-1 (que era específico del binding). ✓

2. **¿El campo aditivo NO rompe los otros 7 EFs?** — **CONFIRMADO.** `AuthUser` aparece SOLO en
   `_shared/auth.ts` (definición + tipo de retorno de `requireUser`). `grep` sobre `supabase/functions`:
   **cero** literales `: AuthUser =` / `as AuthUser` / `<AuthUser>` fuera de ahí. Los 8 call sites hacen
   `const user = await requireUser(...)` y leen `user.id`/`user.email`. TS es estructural (sin exact
   types) → sumar un campo al objeto retornado es puramente aditivo; ningún consumidor que lee un subset
   se rompe, y el único productor (`requireUser`) ya provee el campo. Verificado por grep (coincide con
   la verificación del implementer). ✓

3. **TTL 72h / claim atómico TOCTOU / binding match siguen OK** — **SÍ.**
   - Binding match: solo se **refactorizó** (extrajo `const invEmail` + `if` anidado); lógica idéntica
     (`invEmail !== user.email` → 403 `email_mismatch`). ✓
   - Claim atómico (:138-159): sentencia única `UPDATE ... WHERE id=? AND status='pending'` + revert
     best-effort on-insert-fail → **sin cambios** respecto de la 1ª pasada. Sigue sólido. ✓
   - TTL 72h en `invite_user:25,135` y `resend_invitation:21,66`, expiry al aceptar (:67) → intactos. ✓

4. **¿Los rechazos siguen sin consumir?** — **SÍ.** `email_mismatch` (94) y `email_unverified` (102)
   retornan **antes** del claim (138). La invitación queda `pending`; el usuario correcto verifica su
   email y reintenta el mismo link (integra con R5.13). ✓

**Cobertura de tests del fix** (bonus, refuerza el cierre):
- Gated `U9_DEPLOYED`: `run.cjs:601-653` crea un user no-verificado, intenta aceptar el binding, asserta
  rechazo + `user_roles.length == 0`. Buen oráculo del bypass.
- Unit (siempre): `invite.test.ts:77-79` — copy `email_unverified` existe, es accionable ("verificá tu
  email") y **distinto** de `email_mismatch`. Copy en `invite.ts:138`.

---

## Verificaciones que PASAN (sin cambios vs. 1ª pasada — resumen)

- **Binding (mecánica)**: orden expiry → match → unverified → already_member → claim → insert; ambos
  rechazos del binding pre-claim (no consumen). Normalización simétrica (`user.email` lowercased en
  `auth.ts:30`; `inv.email` `.trim().toLowerCase()` + CHECK `invitations_email_lower`). null/"" → bearer
  intencional. ✓
- **Claim atómico (TOCTOU)**: una sentencia → row-lock → exactamente uno gana; revert consistente. ✓
- **TTL 72h**: creación + reenvío + chequeo al aceptar; copy cliente `invitar.tsx:80` "72 horas". ✓
- **Rate limit**: sin superficie nueva; el nuevo check es un booleano en memoria. `[auth.rate_limit]`
  intacto (config.toml:192-206). ✓
- **Catálogo RAFAQ**: A1 (queries admin scopeadas a mano), A2 (insert `user_roles` whitelist, no spread),
  B1 (`serverError` loguea server-side + copy genérico, no filtra `err.message`). ✓

## False positives descartados
- **N/A** — no corrí `sentry-skills:security-review`: son Edge Functions Deno (`Deno.serve`, imports
  `jsr:`/`https://`, `Deno.env`) fuera de la cobertura efectiva de la skill. Auditoría por trazado
  manual de data-flow contra el catálogo RAFAQ (A/B/E/H) + las preguntas del gate. Cobertura Deno/RLS/EF
  = manual (declarado).

## Archivos analizados (2ª pasada)
- `supabase/functions/_shared/auth.ts` (campo aditivo `emailVerified` + `requireUser`)
- `supabase/functions/accept_invitation/index.ts` (binding + email_unverified + claim)
- `supabase/functions/invite_user/index.ts`, `resend_invitation/index.ts` (TTL 72h — sin cambios)
- `supabase/functions/_shared/errors.ts` (serverError)
- `supabase/tests/edge/run.cjs` (test `email_unverified` gated + TOCTOU + 72h + match/mismatch)
- `app/src/utils/invite.ts` + `invite.test.ts` (copy `email_unverified`)
- `supabase/config.toml` (`enable_confirmations`, rate_limit)

## Tabla de inputs (campos tocados por el delta)
| campo | límite | validación | OK? |
|---|---|---|---|
| `token` (accept) | UUID; CHECK `token_len ≤512` | server: `typeof===string` + lookup | ✓ |
| `email` (invite_user) | ≤320, lowercase + `@` mínimo | server: guard + CHECK `email_lower`/`not_empty` | ✓ |
| binding (accept) | n.a. (deriva de JWT + DB) | server: match + **emailVerified** (email_confirmed_at) | ✓ (HIGH-1 cerrado) |

## Tabla de rate limits (acciones abusables tocadas)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `accept_invitation` | no | — | n.a. | JWT + token 122 bits; el delta no agrega costo/fan-out. Aceptable por entropía. |
| `invite_user` / `resend_invitation` | no | — | n.a. | Owner-only (`requireOwnerOf`), sin email/SMS. Sin cambio de superficie. |
| Auth nativo | sí (nativo) | per-IP | sí | `[auth.rate_limit]` intacto (config.toml:192-206). El delta no lo toca. |

## Cobertura indirecta / no cubierto
- **Deno / EF typecheck**: sin toolchain Deno local → typecheck real de la EF es post-deploy. Revisión =
  manual (flujo coherente, sin imports nuevos, patrones supabase-js ya usados). El campo aditivo
  `emailVerified` no toca ningún literal `AuthUser` externo (grep) → no hay riesgo de typecheck en los
  otros EFs.
- **Tests U9 gated (`U9_DEPLOYED=1`)**: verifican comportamiento no deployado; corren post-deploy
  (incluye el nuevo caso `email_unverified`). Recordar: `U9_DEPLOYED=1 node --test
  supabase/tests/edge/run.cjs` después del deploy.
- **`enable_confirmations` de prod**: ya NO es enforcement primario (lo es el check server-side). Sigue
  siendo buena higiene tenerlo en `true` en prod (defensa en profundidad), pero el binding ya no depende
  de él.
