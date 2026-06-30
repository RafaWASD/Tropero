# Security Gate 2 — `footer-chip-2026-06-30` (modo code)

**Veredicto: PASS** (0 HIGH, 0 MEDIUM, 0 RAFAQ-SPECIFIC)

Baseline: `6a6e969`. Diff sin commitear (trabajamos sobre `main`, sin feature-branch).

## Alcance del diff

`git diff 6a6e969 -- supabase/` → **vacío** (sin migrations, RLS, Edge Functions, triggers ni config tocados).

Dos archivos, ambos React Native puro de presentación:

1. **`app/src/components/AnimalRow.tsx`** — `NoTagChip`: agrega ícono lucide `Tag`, cambia label `sin caravana` → `Sin caravana`, suma `labelA11y(Platform.OS, 'Sin caravana')` y usa `getTokenValue('$textMuted', 'color')`.
2. **`app/src/components/AuthScreenShell.tsx`** — `contentContainerStyle.paddingBottom` pasa de `insets.bottom` a `insets.bottom + getTokenValue('$6', 'space')`.

## Trazado de data flow

Ninguno de los valores nuevos es attacker-controlled — son constantes de compilación o valores del sistema:

| Valor nuevo | Origen | Clasificación |
|---|---|---|
| `Tag` (lucide) | import estático | constante |
| `getTokenValue('$textMuted'/'$6', …)` | design token (ADR-023) | constante server-controlled |
| `labelA11y(Platform.OS, 'Sin caravana')` | literal hardcodeado | constante |
| label `"Sin caravana"` | literal hardcodeado | constante |
| `insets.bottom` | safe-area del dispositivo (OS) | system-controlled, no atacante |

`labelA11y` (`app/src/utils/a11y.ts`) verificada: función pura, devuelve `{ 'aria-label': label }` / `{ accessibilityLabel: label }`. Sin eval, sin render de HTML crudo, sin red. RN `Text` auto-escapa; no hay `dangerouslySetInnerHTML` ni equivalente. Sin XSS/injection.

## Skill `sentry-skills:security-review`

Corrida sobre el diff. **No high-confidence vulnerabilities identified.** Sin false positives a descartar.

## Checklist RAFAQ-específico

Todos los dominios **no aplican** a este diff (no hay backend ni data flow):

- RLS / migrations / triggers / `createAdminClient()` — n.a. (supabase/ vacío).
- Edge Functions (`auth.uid()`, `has_role_in()`, rate limit propio, `err.message` crudo) — n.a.
- Secrets / `console.log` — n.a. (sin código nuevo que loguee).
- Mass assignment / IDOR / over-fetch — n.a. (sin queries).
- Offline/sync (PowerSync, Realtime, data-at-rest) — n.a.
- BLE / ingesta / SSRF — n.a.

## Tabla de inputs (campos que el usuario tipea)

| campo | límite | validación | OK? |
|---|---|---|---|
| — | — | — | — |

Ningún campo de entrada de usuario nuevo ni modificado. `NoTagChip` renderiza un label estático (no es un input). `AuthScreenShell` solo ajusta layout. N/A.

## Tabla de rate limits (acciones abusables)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| — | n.a. | — | — | sin acciones de red/email/SMS/bulk/buscador tocadas |

## Archivos analizados

- `app/src/components/AnimalRow.tsx`
- `app/src/components/AuthScreenShell.tsx`
- `app/src/utils/a11y.ts` (verificación de helper referenciado)

## Cobertura indirecta (Deno / RLS / PowerSync / BLE / RN)

La skill no cubre nativamente Deno/RLS/PowerSync/BLE, pero **ninguno de esos dominios es tocado por el diff**, así que no hay gap. La porción React Native fue revisada manualmente (data flow trazado arriba). Superficie de seguridad nula confirmada.
