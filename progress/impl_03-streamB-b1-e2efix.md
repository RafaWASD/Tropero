# impl — spec 03 Stream B / B1 · FIX-LOOP del e2e (`maniobra-servicio-rodeo.spec.ts`)

> Fix-loop ACOTADO: los 2 tests del e2e de B1 fallaban determinista en `signIn`→`waitForSignIn`
> (`getByLabel('Email')` timeout 30s) — el login NUNCA aparecía, en paralelo y serial. El CÓDIGO
> de B1 (unit 164/164 + Gate 2) y el boot (auth.spec 4/4 mismo dist) ya estaban sanos. La tarea era
> encontrar por qué el login no aparece SOLO en este spec y arreglarlo SIN debilitar lo que verifica.

## Causa raíz (con evidencia)

**El spec importaba `test`/`expect` de `@playwright/test` en vez de `./helpers/fixtures`** — era el
ÚNICO de los 41 specs que lo hacía. El `test` de `fixtures.ts` sobrescribe la fixture `page` con un
`addInitScript` que inyecta `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` /
`EXPO_PUBLIC_POWERSYNC_URL` en `globalThis.process.env` **antes** de que corra el bundle. El build web de
producción lee el env de forma **dinámica** (`src/utils/env.ts` → `readPublicEnv` → `process.env[name]`
con key computada), y `babel-preset-expo` solo inlinea accesos **estáticos** `process.env.EXPO_PUBLIC_FOO`
→ el acceso dinámico queda `undefined` en runtime POR MÁS QUE `expo export` hornee el env. Sin el shim,
`resolveEnv` (env-resolve.ts:27) tira `"Faltan variables de entorno EXPO_PUBLIC_*"` en el boot →
pantalla en blanco → el login no renderiza → `getByLabel('Email')` timeout 30s. Determinista,
independiente del flujo (por eso fallaba igual en paralelo y serial, y en AMBOS tests).

**Evidencia dura (no asumida):**
1. **Grep de imports:** los 41 specs importan `test` de `./helpers/fixtures` — `maniobra-servicio-rodeo.spec.ts`
   era el único con `from '@playwright/test'` (línea 21).
2. **Screenshot al fallar:** `test-failed-1.png` = página **completamente en blanco** (el bundle nunca montó).
3. **Trace de los DOS tests fallando** (`trace.zip` → `0-trace.trace`): contiene un `pageError`:
   ```
   Faltan variables de entorno EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY o EXPO_PUBLIC_POWERSYNC_URL
       at e.resolveEnv (.../entry-….js:15185:244)
       at _e.getEnv  (.../entry-….js:15184:136)
   ```
   → el throw es en `resolveEnv`/`getEnv`, en el boot, exactamente como predice "sin shim".
4. **Probe A/B (throwaway, ya borrado):** una page navegada SIN shim reproduce idéntico el `pageerror`
   "Faltan variables…" y login `false`; `auth.spec.ts` (que usa el `test` de fixtures) **pasa 4/4**
   contra el MISMO dist → confirma que el shim es la única diferencia load-bearing.

**Lo que NO era** (hipótesis del dispatch descartadas con evidencia):
- (a) `seedEstablishment`/`setUserPhone` dejando un estado raro → NO: son llamadas Node-side admin que no
  tiran; el fallo es 100% del bundle del browser que no bootea. El blank ocurre antes de cualquier login.
- (d) `setUserPhone` rompiendo algo (gotcha-14 `user_private`) → NO: `admin.ts:86` ya escribe a
  `user_private` correctamente; el helper está bien y no se tocó. `admin.ts` no fue modificado en esta sesión
  (mtime 18:22, pre-sesión; su diff es el wiring de B1, no mío).
- (c) timing/bundle > 30s → NO: el `pageError` de env es la causa; el bundle ni intenta montar.
- El diagnóstico del ledger de wiring (`impl_03-streamB-b1-wiring.md` líneas 148-160) atribuía el blank a
  un "flake de env-baking del `expo export` de ESTA sesión, universal a todo spec". Era **incorrecto**: NO
  es universal (auth.spec bootea fino con el mismo dist) — es específico de este spec por el import faltante.
  El mecanismo que describían (dynamic `process.env[name]` no inlineable → necesita shim de runtime) era
  correcto, pero el shim de runtime ES el `addInitScript` de `fixtures.ts`, y este spec simplemente no lo usaba.

## Qué toqué

**Un solo archivo, una sola línea (+ comentario explicativo):**
- `app/e2e/maniobra-servicio-rodeo.spec.ts` — `import { test, expect } from '@playwright/test'`
  → `import { test, expect } from './helpers/fixtures'`. Comentario nuevo arriba del import explicando por
  qué va por fixtures (el shim de env), para que no se vuelva a romper.

**NO toqué:** el código de wiring de B1 (`rodeos.ts`, `outbox.ts`, `upload.ts`, `schema.ts`, `local-reads.ts`,
`crear-rodeo.tsx`, `editar-servicio.tsx`, `rodeos.tsx`), `admin.ts`/`ui.ts`/`fixtures.ts`, `.env.local`,
migraciones, `feature_list.json`. El fix NO debilita nada de lo que el spec verifica — solo hace que el
bundle bootee; los asserts (alta paso-4 primavera→`{10,11,12}` server-side; edición offline optimista +
idempotente + cero rechazo de upload) corren intactos.

## Resultado

- **`pnpm exec playwright test e2e/maniobra-servicio-rodeo.spec.ts --workers=1` → 2 passed** (determinista:
  corrido 2× serial, 19.7s y 19.1s, ambos verdes).
  - Test 1 (alta): paso-4 con `service-months-grid` + primavera pre-tildada (`month-chip-10/12`
    aria-pressed=true, `month-chip-1`=false) → oráculo server `waitForServerRodeoServiceMonths([10,11,12])`.
  - Test 2 (edición offline, web táctil 360): "sin configurar" → atajo Otoño → guardar OFFLINE → overlay
    optimista "Jun → Jul" sin red → reconexión → server `{6,7}` + cero "upload rechazado" + re-guardar el
    mismo período (idempotente) → sigue `{6,7}`.
- **`node scripts/check.mjs` → VERDE** (exit 0, "All tests passed", "Entorno listo. Podés trabajar"):
  typecheck + anti-hardcode + client unit + backend suites. Sin flake (terminal única dueña de la feature).

## Nota para el leader

El código de B1 sigue intacto y gateado (unit 164/164 + Gate 2 PASS). Este fix-loop solo destrabó la
corrida verde del e2e que el ledger de wiring había dejado anotada como "pendiente de re-correr". El e2e ya
NO está bloqueado: **2 passed serial + check.mjs verde**. El ledger de wiring `impl_03-streamB-b1-wiring.md`
mantiene su nota de "e2e bloqueado por env-baking" — esa nota quedó obsoleta/equivocada y este ledger la
corrige (la causa real era el import, no el export). No reescribo el otro ledger; lo dejo registrado acá.
