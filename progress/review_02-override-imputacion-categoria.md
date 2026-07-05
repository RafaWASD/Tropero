# Review — Delta `override-imputacion-categoria` (spec 02, ADR-028 Nivel A)

**Reviewer**: reviewer · **Fecha**: 2026-07-05 · baseline_commit `5145943` (sin commitear).

## Veredicto: CHANGES_REQUESTED

Un único blocker: el oráculo e2e nuevo consulta una tabla inexistente. Todo el núcleo del fix
(imputación consciente de categoría + wiring + no-regresión) está correcto y verde. El blocker está
acotado a `app/e2e/helpers/admin.ts` y NO toca la lógica de producción.

---

## Cambios requeridos (concretos)

1. **`app/e2e/helpers/admin.ts:1077` — `readServerProfileCategory` consulta `.from('categories')`, tabla que NO existe.**
   - El FK es `animal_profiles.category_id → categories_by_system(id)` (`0020_animal_profiles.sql:20`).
     La única tabla de categorías del schema es `categories_by_system` (`0015`); **no hay** relación
     `categories` (grep de todos los `create table`: solo `categories_by_system` y `animal_category_history`).
   - Como `admin` es `SupabaseClient` **sin generic de tipos** (`admin.ts:32`), `.from('categories')`
     **typechequea** (por eso el deliverable reporta "typecheck limpio") pero en runtime PostgREST devuelve
     `PGRST205 Could not find the table 'public.categories'` → el helper hace `throw new Error('readServerProfileCategory categories: …')`.
   - Consecuencia: en Gate 2.5 **ambos** e2e nuevos (`delta override-imputación: … Torito` y `… Ternero`)
     revientan en el paso del oráculo, antes de evaluar `categoryCode`/`categoryOverride`. El oráculo que el
     leader me pidió verificar **NO es correcto**.
   - Fix: cambiar `.from('categories')` por `.from('categories_by_system')` (el patrón usado por TODOS los
     oráculos existentes del repo: `supabase/tests/animal/run.cjs:369/383/…`, `admin.ts:890/1438`,
     `maneuvers/run.cjs:680`). El JSDoc del helper (líneas ~1060-1064) dice además "join a `categories`
     **por code**" — doble imprecisión: el nombre de tabla y que en realidad joinea `.eq('id', category_id)`.
     Reconciliar el comentario junto con la línea.
   - El deliverable (`impl_02-…md:50`) también describe el helper como "join a `categories` por code" →
     reconciliar esa línea para que no quede mintiendo respecto del as-built corregido.

*(No requiere re-spec de requirements/design: la reconciliación in-place de las specs es correcta; el
error es solo del helper de test.)*

---

## Trazabilidad comportamiento ↔ test (foco del delta)

| Qué debe ser cierto | Test(s) | Estado |
|---|---|---|
| year-only category-consistent → `computeInitialCategoryCode(res)===chosen` ∧ `override=false` (invariante central) | `impute consistente: *` ×5 (assert de `computeInitialCategoryCode` **y** `categoryOverrideFor`) | OK — asserts reales, imports usados |
| midpoint ciego caería del lado equivocado (torito'24) → corregido | `impute: torito año 2024 cae en la segunda mitad` (`notEqual '2024-07-01'`) | OK |
| categoría imposible para el año (cruce vacío) → fallback `birthYearToDate` ∧ `override=true` | `impute fallback: TORO '25`, `TORITO '26` | OK |
| categoría no age-derivable → midpoint ciego | `impute: vaquillona_prenada / multipara / vaca_segundo_servicio / novillito / novillo / code_raro` | OK |
| preñez captura vuelve derivable vaquillona_prenada | `impute: vaquillona_prenada … +preñez→false / sin→true` | OK |
| NUNCA futuro / dentro del año / ISO válido (borde today=1-ene) | `impute límite: today=2026-01-01` (`ternRes==='2026-01-01'`) + `assertImputeInvariants` (`res<=todayIsoUtc`) + `impute invariantes` matriz | OK |
| fecha EXACTA no pasa por impute (no-regresión) | `no-regresión: override con fecha EXACTA` | OK |
| `precision` expuesto ('exact'/'year'/'none') | `validateBirthDate: precision "exact"/"year"/"none"` + `deepEqual` viejos actualizados | OK |
| server-side: alta year-only → `category_override=false` (end-to-end) | e2e `Torito`/`Ternero` | **ROTO por el oráculo (blocker #1)** |

## Verificación de contratos intactos (por diff)
- `categoryOverrideFor`, `computeCategoryCode`, `computeInitialCategoryCode`: **NO aparecen** en el diff de
  `animal-category.ts` (solo se agregaron `AGE_WINDOWS`, `DAY_MS`, `imputeBirthDateForCategory`, `isoUtcDate`
  y el import de `birthYearToDate`). Firmas y cuerpos sin cambio. ✓
- `BirthDateValidation` ganó `precision` de forma **aditiva** (los `ok:false` intactos); `validateBirthDate`
  setea `precision` en los 3 returns `ok:true`; `birthYearToDate` sin tocar. Typecheck verde ⇒ `LinkCalfPrompt`
  (solo lee `date`/`field`) no se rompe. ✓
- Anti-drift RC6.5.1: `AGE_WINDOWS` = inversa de los cortes de `computeCategoryCode`, reusa
  `ONE_YEAR_DAYS`/`TWO_YEAR_DAYS` (cero números mágicos), con banner ANTI-DRIFT citando RC6.5.1. ✓
- Wiring `crear-animal.tsx`: `now` único (L506) usado en `validateBirthDate`/`imputeBirthDateForCategory`/
  `categoryOverrideFor`; refina solo si `birthDate!=null && precision==='year'` (L560); `sex`/`selectedCategoryCode`
  narrow-guardados (L493/497); import vivo y llamado (L65→L561); `createAnimal` sin cambio de contrato. ✓

## Tasks completas: N/A
Delta ADR-028 **Nivel A** in-place: no hay `tasks-override-imputacion-categoria.md`. Reconciliación de specs
hecha in-place (design/requirements-alta-form-refinamiento.md + design-c6-categoria-espejo.md) — verificada,
describe el as-built con exactitud (`precision`, `imputeBirthDateForCategory`, ventanas inversas, fallback,
`categoryOverrideFor` intacto). Sin specs viejas/mintiendo.

## Verificación que corrí
- Unit de los archivos tocados: `animal-category.test.ts` + `animal-birth-year.test.ts` → **122/122 pass**
  (97 + 25), coincide con el deliverable. Asserts reales (no imports muertos: cada caso derivable ejerce
  `computeInitialCategoryCode` **y** `categoryOverrideFor`).
- Typecheck cliente (`tsc --noEmit`): **exit 0**.
- Anti-hardcode: sin hex/px en los utils puros; sin `establishment_id` hardcodeado.
- `git diff HEAD -- supabase/`: **vacío** → Gate 1 N/A confirmado.
- `git diff HEAD --stat`: 10 archivos, **ningún `design/**/*.png`** en el diff del delta. ✓
- NO corrí `e2e:build` (re-renderiza `design/**/*.png`) — por eso el oráculo se verifica estáticamente:
  ahí está el blocker.

## CHECKPOINTS aplicables
- C3 (arquitectura): [x] solo utils/screens; sin deps nuevas; sin hardcode.
- C4 (verificación real): [x] unit >0 verdes con fixtures reales · [~] e2e con oráculo **roto** (blocker #1).
- C6 (SDD): [x] specs reconciliadas exactas; cada comportamiento del fix con test unit.
- C9 (E2E/visual, ADR-029): [~] hay 2 e2e de regresión pero **fallarían** por el oráculo; capture **N/A**
  (el delta no toca UI renderizada — solo `onSubmit`).
- C7/C8 (multi-tenant/offline): N/A directo — frontend puro, imputación pura client-side offline-safe, sin RLS
  nueva, sin `establishment_id` tocado.

## Checklist RAFAQ-específico
- **A. RLS / multi-tenancy**: N/A — no toca tablas ni RLS (`git diff supabase/` vacío).
- **B. Offline-first**: aplica parcialmente — la imputación es pura client-side, corre offline y refina
  `birthDate` antes de `createAnimal` (que ya encola offline). Sin requests síncronos nuevos. [x]
- **C. BLE**: N/A.
- **D. UI de campo**: N/A — sin cambios visuales (mismos campos/componentes del paso 4).
- **E. Edge Functions**: N/A.

---

**Resumen**: el fix de producción es correcto, testeado y sin regresión (122/122 + typecheck verde + Gate 1
N/A). Rechazo **solo** por el oráculo e2e roto (`admin.ts:1077` `categories` → `categories_by_system`), que
el leader me pidió verificar y que haría fallar los 2 e2e en Gate 2.5. Fix de 1 línea + reconciliar el JSDoc
y la nota del deliverable. El implementer corrige y re-somete.
