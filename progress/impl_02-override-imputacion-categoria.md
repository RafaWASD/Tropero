# impl — Delta `override-imputacion-categoria` (spec 02, ADR-028 Nivel A)

baseline_commit: 5145943

**Veredicto: VERDE.** Typecheck cliente verde · unit relevantes 122/122 (animal-birth-year 25/25 + animal-category 97/97) · Gate 1 N/A (`git diff supabase/` vacío) · anti-hardcode 0 violaciones · `design/*.png` NO tocado.

**Nivel/alcance**: Nivel A (ADR-028), frontend puro, sin DB, Gate 1 N/A. Fix del "flip del midpoint ciego" en el alta year-only: cuando el usuario carga SOLO el año, en vez de guardar el midpoint ciego `AAAA-07-01` (que puede caer del lado equivocado del corte 1/2 años y hacer que el cron nocturno flipee la categoría elegida), se imputa un día CONSCIENTE de la categoría elegida → la fecha queda category-consistent → `categoryOverrideFor` da `override=false` (auto-avanza sin flip). Si la categoría es imposible para el año o no es age-derivable → fallback al midpoint ciego + `override=true` (pin).

## Cambios archivo por archivo

### 1. `app/src/utils/animal-birth-year.ts` — expone la precisión (aditivo)
- `BirthDateValidation` ganó `precision`: `{ok:true; date:string; precision:'exact'|'year'}` (exacta si DD/MM, midpoint si solo año), `{ok:true; date:null; precision:'none'}` (vacío). Los casos `ok:false` NO cambian.
- `validateBirthDate`: los 3 returns `ok:true` ahora setean `precision`. La rama `dm.length===0` distingue `date==null` (→ `'none'`) de midpoint (→ `'year'`); la rama exacta → `'exact'`. JSDoc actualizado.
- **`birthYearToDate` intacto** (RAF2.1.10). Cero cambios de lógica: sigue devolviendo `AAAA-07-01` / clamp `01-01`.
- Otro caller verificado: `LinkCalfPrompt.tsx` solo lee `dateV.date`/`dateV.field` → el cambio aditivo NO lo rompe (typecheck verde).

### 2. `app/src/utils/animal-category.ts` — imputación consciente de categoría (núcleo puro)
- `import { birthYearToDate } from './animal-birth-year'` (sin ciclo: birth-year importa solo `event-timeline`→`wheel-picker`, nunca este módulo).
- `AGE_WINDOWS` (Record por sexo/code): ventanas `[minAge,maxAge)` en días — INVERSA de los cortes de `computeCategoryCode`, reusando `ONE_YEAR_DAYS`/`TWO_YEAR_DAYS` (cero números mágicos). macho: ternero `[0,365)` / torito `[365,730)` / toro `[730,∞)`. hembra: ternera `[0,365)` / vaquillona `[365,∞)`. Cualquier otro code (vaquillona_prenada, vaca_segundo_servicio, multipara, novillito, novillo, desconocido) → sin ventana.
- `imputeBirthDateForCategory(chosen, sex, yearOnlyIso, today?)`: pura, exportada. Sin ventana → `birthYearToDate(year)` (fallback). Con ventana: `latestBirth = todayMid - minAge`; `earliestBirth = maxAge===∞ ? yearStart : todayMid-(maxAge-1)`; `lo = max(earliestBirth, yearStart)`; `hi = min(latestBirth, yearEnd, todayMid)`; si `lo>hi` (cruce vacío) → fallback; si no → midpoint del cruce `lo + floor(spanDays/2)` días → ISO UTC. Aritmética en UTC consistente con `ageInDays`/`startOfDay`. `chosen` trimeado para robustez del picker.
- Helper `isoUtcDate(d)` (ISO 'YYYY-MM-DD' UTC padded).
- Nota ANTI-DRIFT (cita RC6.5.1): las ventanas son la inversa de los cortes → si una migración cambia `compute_category`, actualizar `AGE_WINDOWS` en el mismo commit.
- **`categoryOverrideFor` NO cambió**: misma firma `(chosen, sex, birthDate, opts)` y mismo cuerpo `return chosen.trim() !== computeInitialCategoryCode(sex, birthDate, opts)`. `computeCategoryCode`/`computeInitialCategoryCode` tampoco (firmas ni cuerpos).

### 3. `app/app/crear-animal.tsx` — wiring en onSubmit
- Import de `imputeBirthDateForCategory`.
- Tras `validateBirthDate` (que ahora trae `precision`) y ANTES de `categoryOverrideFor`: `let birthDate = dateV.date; if (birthDate != null && dateV.precision === 'year') birthDate = imputeBirthDateForCategory(selectedCategoryCode, sex, birthDate, now);`
- `categoryOverrideFor(selectedCategoryCode, sex, birthDate, { today: now, pregnant: pregnantCaptured })` — se agregó `today: now` (misma instancia `now` del submit, consistencia año↔override; antes usaba el default interno `new Date()`, mismo día). El resto de `createAnimal` y su contrato: intactos. Fecha exacta (`'exact'`) y vacío (`'none'`) → sin cambios de comportamiento.

## Tests

### `app/src/utils/animal-category.test.ts` (+ delta, 97/97)
`today` inyectado = `2026-07-05 UTC`.
- `impute consistente: <sex> <chosen> año <year>` (data-driven, 5 casos): ternero'25, torito'24, toro'24, ternera'25, vaquillona'24 → `assertImputeInvariants` (ISO válido + dentro del año + ≤today) + `computeInitialCategoryCode(res)===chosen` (corazón del fix) + `categoryOverrideFor(...)===false`.
- `impute: torito año 2024 cae en la segunda mitad del año` (no es el midpoint ciego 07-01).
- `impute fallback: macho TORO año 2025 (imposible)` → `res === birthYearToDate(2025)` + `override===true`.
- `impute fallback: macho TORITO año 2026 (nacido este año, imposible)` → fallback + `override===true`.
- `impute: vaquillona_prenada (no derivable)` → midpoint ciego; `override(pregnant:true)===false` (tacto+ sintético manda) y `override(pregnant:false)===true`.
- `impute: multipara/vaca_segundo_servicio/novillito/novillo/code desconocido` → midpoint ciego (sin ventana).
- `impute: code con espacios` → trim matchea la ventana → consistente.
- `impute invariantes: matriz amplia` (derivables + fallback, incl. año en curso) → nunca futuro + dentro del año + ISO válido.
- `impute límite: today=2026-01-01` (borde del año, mío) → ternero año 2026 = `2026-01-01` (nacido hoy, no futuro), consistente; torito imposible → `override===true`.
- `no-regresión: override con fecha EXACTA` (`2024-10-03`, `2026-01-10`) → mismos resultados de siempre (impute no interviene).

### `app/src/utils/animal-birth-year.test.ts` (+ delta, 25/25)
- Todas las `deepEqual` de `validateBirthDate` existentes actualizadas para incluir `precision` (`'exact'`/`'year'`/`'none'`).
- Nuevos: `precision 'exact'` (DD/MM), `precision 'year'` (solo año, incl. clamp `2026`→`01-01` sigue `'year'`), `precision 'none'` (vacío).

### `app/e2e/animals.spec.ts` + `app/e2e/helpers/admin.ts` (+ delta)
- Helper nuevo `readServerProfileCategory(profileId)` → `{ categoryOverride, categoryCode }` (server-side, service_role; `category_override` de `animal_profiles` + code resuelto por el FK `category_id → categories_by_system(id)`, join por **id**). Fix post-review: la primera versión apuntaba a `.from('categories')` (tabla inexistente → `PGRST205` en runtime, reventaba los 2 e2e nuevos) — corregido a `categories_by_system`, verificado contra `supabase/migrations/0020_animal_profiles.sql` (FK por id + columna `category_override`) y `0015*` (columna `code`).
- 2 tests nuevos: (a) macho **Torito** con solo el año = `currentYear-2` (borde 2 años) → ficha muestra "Torito" + oráculo server `categoryCode==='torito'` **y `category_override===false`** (sin el fix, el midpoint ciego daría `override===true`); (b) macho **Ternero** con solo el año en curso → `'ternero'` + `override===false`.
- **Ejecución playwright diferida al Gate 2.5 del leader** (que corre la E2E completa): correr `e2e:build` re-renderiza 40+ `design/**/*.png` (memoria del proyecto) y el árbol de trabajo ya tiene `design/maniobra-elegir/*.png` modificados de otra sesión/terminal que NO se deben clobbear; y el `dist/` existente es PREVIO a mi cambio de `crear-animal.tsx` (correr contra él sería engañoso). Los archivos e2e agregados typecheckean limpio (verificado con tsconfig temporal; los únicos errores son ruido pre-existente de config: `ws` sin tipos, cast en helper ajeno L1739 — no de mis líneas).

## Mapa casos → test (trazabilidad del fix)
| Comportamiento | Test |
|---|---|
| year-only category-consistent → `override=false` (sin flip) | `impute consistente: *` (×5) + e2e Torito/Ternero |
| midpoint ciego caería del lado equivocado (torito'24) → se corrige | `impute: torito año 2024 cae en la segunda mitad` |
| categoría imposible para el año → fallback + `override=true` (pin) | `impute fallback: TORO '25`, `TORITO '26` |
| categoría no age-derivable → midpoint ciego | `impute: vaquillona_prenada / multipara / novillito...` |
| preñez captura vuelve derivable vaquillona_prenada | `impute: vaquillona_prenada ... +preñez → false` |
| invariantes (nunca futuro / dentro del año / ISO válido) | `impute invariantes`, `impute límite`, `assertImputeInvariants` |
| fecha EXACTA no pasa por impute (no-regresión) | `no-regresión: override con fecha EXACTA` |
| `precision` expuesto al caller | tests `precision 'exact'/'year'/'none'` |

## Autorrevisión adversarial (paso 8)
Busqué: (a) desviaciones — el fix cubre todos los casos del brief; `categoryOverrideFor`/`computeCategoryCode`/`computeInitialCategoryCode` intactos (comparados línea a línea). (b) edge cases — verifiqué analíticamente que `[lo,hi] ⊆ [earliestBirth,latestBirth]` ⟹ `age∈[minAge,maxAge)` ⟹ `computeCategoryCode` da `chosen` (rama por rama); ternero/ternera de año PASADO caen correctamente al fallback (crossing vacío, no se testean como derivables); `maxAge=∞` no produce `NaN` (rama `earliestBirth=yearStart`); `floor(spanDays/2)` garantiza `mid∈[lo,hi]`; `spanDays=0`→`mid=lo`; nunca futuro (`hi≤todayMid`); siempre dentro del año (`[lo,hi]⊆[yearStart,yearEnd]`). (c) seguridad — N/A (frontend puro, sin DB/RLS/RPC). (d) offline/multi-tenant — la imputación es pura client-side, funciona offline (refina `birthDate` antes de `createAnimal`, que ya encola offline); sin red nueva; sin `establishment_id` hardcodeado (no lo toca). (e) tests por la razón correcta — cada caso derivable asserta `computeInitialCategoryCode` Y `categoryOverrideFor` Y invariantes (ejercen el path real). **Encontrado/cerrado**: el mid-file `import` inicial se movió al top del módulo (limpieza, evita ruido de linters); confirmé que el cast `birthYearToDate(...) as string` es seguro (year siempre numérico no-null desde el caller). Nada más pendiente.

## Reconciliación de specs (paso 9, Nivel A in-place)
- `design-alta-form-refinamiento.md`: contrato `BirthDateValidation` actualizado con `precision` + bloque de reconciliación as-built (la re-imputación vive en el caller; `validateBirthDate`/`birthYearToDate` intactos).
- `requirements-alta-form-refinamiento.md`: nota de reconciliación bajo **RAF2.1.3** (a nivel util sigue el midpoint `AAAA-07-01`; en el alta se re-imputa consciente de categoría).
- `design-c6-categoria-espejo.md` (owner de `animal-category.ts`): nota as-built de `imputeBirthDateForCategory` + sus ventanas inversas sujetas al anti-drift RC6.5.1; `categoryOverrideFor`/`computeCategoryCode` sin cambios.

## Capture (Gate 2.5, ADR-029)
**N/A**: el delta NO toca UI renderizada — solo lógica de `onSubmit` en `crear-animal.tsx` (mismos campos, mismos componentes, misma apariencia). No hay pantallas/sheets/componentes nuevos ni estados visuales nuevos.

## Gotchas
- `imputeBirthDateForCategory` y `computeInitialCategoryCode`/`categoryOverrideFor` usan aritmética **UTC** (`startOfDay`/`ageInDays`) → consistentes entre sí. `birthYearToDate` usa fecha **local** (comportamiento existente, intacto) solo para su clamp de no-futuro; los tests inyectan `today` UTC-midnight, lo que hace la imputación 100% determinista y robusta a timezone (el clamp local solo afecta años en curso, donde da el mismo resultado en cualquier tz razonable).
- E2E Torito año `currentYear-2`: el año dinámico evita que el test envejezca; el borde de 2 años es age-derivable en una ventana amplia (`today∈[currentYear-1, ~currentYear-fin]`), y siempre termina en `override=false` con el fix.
- NO commiteado (lo hace el leader tras los gates). NO se tocó `feature_list.json`/`current.md`.
