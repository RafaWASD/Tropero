# Security gate (code) — delta `02-alta-form-refinamiento`

**Modo**: `code` (Gate 2, ADR-019)
**Baseline**: `b7c2554` (working-tree diff, `git diff b7c2554`)
**Fecha**: 2026-06-29
**Skill**: `sentry-skills:security-review` (metodología trace-data-flow + verify-exploitability) + checklist RAFAQ

## Veredicto: PASS (0 HIGH, 0 MEDIUM)

Cambio de **frontend puro**. Sin superficie nueva de servidor: `git diff b7c2554 -- supabase/` **vacío** (sin schema / RLS / RPC / Edge Function / migración). El contrato `createAnimal` no cambia de firma ni de campos. No se introducen leaks, mass-assignment, inyección, ni inputs sin acotar. Superficie esperada (display/form puro) → confirmada.

## Findings HIGH de Sentry
Ninguno. `security-review` no identifica vulnerabilidades de alta confianza en el diff.

## Findings RAFAQ-SPECIFIC
Ninguno.

## Análisis por dominio (trazabilidad)

### Inyección / ReDoS en las utils puras nuevas (`animal-birth-year.ts`)
- `sanitizeDayMonthInput` (`app/src/utils/animal-birth-year.ts:90-94`): `raw.replace(/\D/g, '').slice(0,4)`. `\D` es character-class negada simple → **lineal, sin backtracking**; `.slice(0,4)` acota a 4 chars. **Sin ReDoS.**
- `validateBirthDate` (`app/src/utils/animal-birth-year.ts:128-186`): parseo por `split('/')` + `Number(...)` + aritmética (`isLeapYear`/`daysInMonth`). Reusa `validateBirthYear` cuyo único regex es `/^\d{4}$/` (anclado, longitud fija → sin backtracking). **Sin ReDoS, sin loops no acotados.**
- Input adversarial: las funciones son **puras, client-side, sin red**. Su salida (`birth_date`) es un único valor ISO o `null` que viaja por el contrato existente hacia una columna Postgres `date` (rechaza sintaxis inválida). No hay sink de inyección, no hay cruce de tenant, no hay escalación: el usuario opera sobre su propio animal en su propio tenant. **No explotable.**

### Contrato `createAnimal` / mass-assignment
- `app/app/crear-animal.tsx:538-558`: payload construido **campo por campo (whitelist explícita)**, sin spread de ningún body del cliente. `role`/`establishment_id`/`id`/`*_at` no provienen del input.
- El único cambio funcional es `birthDate = dateV.date` (antes `birthYearToDate(yearV.year, ...)`) — misma semántica de **un solo valor** (ISO exacta, midpoint, o `null`). "Sin cargar" = `null`/omitir, ya soportado por el contrato. **Sin bypass, sin campo nuevo.**
- `conditionScore` gateado `!= null` antes de `addConditionScore` (`crear-animal.tsx:576`). `teethState`/`nursing` gateados por `showTeeth`/`showNursing`. Los nuevos `null` de `allowDeselect` = "sin cargar" → se omiten / caen al default del DB. **Sin mass-assignment.**

### Information disclosure
- No se agregan `console.log`/`console.error` ni `err.message` crudos al cliente (grep sobre líneas `+` del diff: 0 hits de secretos/logging). El `created.error.message` (`crear-animal.tsx:564`) es **pre-existente** (no tocado por el diff) y es un mensaje del service-layer del propio cliente, no un error de servidor/DB filtrado.

### XSS / render
- React Native + Tamagui `<Text>`: valores (`formatScoreAR`, labels, a11y) se renderizan como text nodes. Sin `dangerouslySetInnerHTML` / `v-html` / `innerHTML`. Labels derivan de constantes / input propio. **Sin sink.**

### Authz / RLS / multi-tenant
- Sin cambios server-side. El scoping de tenant lo sigue derivando la RLS (los eventos post-create no pasan `establishmentId`, patrón pre-existente intacto). **Sin regresión.**

## False positives descartados
- Ninguno emitido por la skill que requiera descarte.

## Tabla de inputs (campos que el usuario tipea / elige)
| campo | límite | validación | OK? |
|---|---|---|---|
| Año de nacimiento (AAAA) | 4 dígitos (`sanitizeBirthYearInput` slice(0,4) + `/^\d{4}$/`), no futuro, ≥1980 | cliente (UX) + **autoritativa: columna `date` del DB** | OK |
| Día/mes (DD/MM) **NUEVO** | 4 dígitos, día-primero, `/` auto; rango mes 1-12 / día 1-díasDelMes (bisiesto-aware) / no futuro, sin clamp | cliente (UX, pura) + **autoritativa: columna `date` del DB** | OK |
| Peso (kg) | `parseWeight` > 0 (control-flow tocado, regla intacta) | cliente + columna numérica DB | OK |
| Condición corporal | set CERRADO 1,00–5,00 snap 0,25 (stepper, no texto libre) | UI cerrada + **CHECK del DB (0028)** | OK |
| Dientes / Preñez / Aptitud / Cría al pie | selectores CERRADOS (`OptionRows`), ahora con `allowDeselect`→`null` | UI cerrada + columnas enum/bool DB | OK |

Notas: el diff **no** introduce ningún campo de texto libre nuevo, buscador, paginación, concatenación en `.or()/.filter()`, `ilike`, ni prompt LLM. Los dos campos nuevos (año desdoblado + día/mes) son **digit-bounded** y su control autoritativo es el tipo `date` + CHECK del DB (offline-first: la validación de cliente es UX, la autoridad es el esquema). Sin gap de validación de inputs.

## Tabla de rate limits
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| — | n.a. | n.a. | n.a. | El diff no toca ninguna acción abusable: sin email/SMS, sin API externa, sin bulk/import, sin buscador, sin Edge Function nueva ni cambio a `[auth.rate_limit]` de `config.toml`. `createAnimal` es write autenticado al propio tenant, pre-existente. |

## Archivos analizados
- `app/src/utils/animal-birth-year.ts` (utils nuevas + reuso de `validateBirthYear`/`birthYearToDate`)
- `app/app/crear-animal.tsx` (paso 4 UI, scroll-al-campo, `allowDeselect`, `ConditionScoreStepper`, `ClearOptionalControl`)
- `app/src/components/ConditionScoreStepper.tsx` (presentacional nuevo)
- `app/app/maniobra/_components/CondicionCorporalStep.tsx` (refactor para reusar)
- `app/src/components/index.ts` (export)
- `app/src/utils/animal-birth-year.test.ts`, `app/e2e/animals.spec.ts` (tests — excluidos del flag por política; sin secretos agregados)

## Cobertura indirecta de Deno / RLS / PowerSync / BLE
- **Deno / Edge Functions**: no aplica — el diff no toca `supabase/functions/`.
- **RLS / migraciones**: no aplica — `git diff b7c2554 -- supabase/` vacío.
- **PowerSync / BLE**: no aplica — sin sync rules ni código BLE en el diff.
- La skill `security-review` cubre bien JS/TS/React; el dominio crítico que NO cubre (Deno/RLS/PowerSync) **no está presente en este diff**, por lo que no hay gap de cobertura.

## Anexo (observación LOW — no afecta veredicto)
- `validateBirthDate` (`animal-birth-year.ts:170-186`): si se la invocara con un `dayMonthRaw` que contuviera no-dígitos con `/` (ej. `"aa/bb"`), `Number()` daría `NaN`, las comparaciones de rango (`NaN < 1` etc.) son todas `false` y produciría un ISO `"AAAA-NaN-NaN"`. **No alcanzable desde la UI**: el único caller (`crear-animal.tsx` `onBirthDayMonth`) siempre pasa el state por `sanitizeDayMonthInput` (solo dígitos + `/`), invariante que garantiza `Number()` numérico. Aun forzándolo, el resultado es un string que la columna `date` de Postgres rechaza (falla el insert del propio usuario, sin leak ni corrupción). Robustez defensiva opcional (early-return ante `Number.isNaN`), **no** finding de seguridad. LOW → no se reporta como tal; queda como traza.
