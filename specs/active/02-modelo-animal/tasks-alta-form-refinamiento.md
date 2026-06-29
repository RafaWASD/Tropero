# Spec 02 — Delta REFINAMIENTO DEL FORMULARIO DE ALTA (#3 / #13 / #14) — Tasks

> Delta Nivel B (ADR-028). El `tasks.md` baseline NO se toca — este delta trae su propio ledger.
> Cada tarea: checkbox + los `RAF2.<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificar.
> **Sin migración** → no hay tarea de SQL/apply remoto. **Gate 1 N/A** (ver `design` §6). Frontend puro.

## #3 — Fecha DD/MM separada del año (util pura primero)

- [x] **T1** — `app/src/utils/animal-birth-year.ts`: agregar `sanitizeDayMonthInput(raw)` (solo dígitos, día-primero, "/" automático, tope DD/MM) y `validateBirthDate(yearRaw, dayMonthRaw, now)` → `{ ok, date|null }` (exacta / midpoint / null) o `{ ok:false, error, field }`. Reusa `validateBirthYear` y `birthYearToDate` (este último **intacto**); helper de bisiesto + días-por-mes. Cubre: RAF2.1.3, RAF2.1.4, RAF2.1.5, RAF2.1.6, RAF2.1.7, RAF2.1.8, RAF2.1.9, RAF2.1.10, RAF2.1.11.
- [x] **T2** — `app/src/utils/animal-birth-year.test.ts`: extender — exacta válida; año-solo → `AAAA-07-01`; ambos vacíos → null; DD/MM sin año → error `field:'dayMonth'`; DD/MM incompleto → error; 31/02, 00/00, 31-en-mes-de-30 → error; 2020-02-29 ok / 2021-02-29 error / 2000-02-29 ok / 1900-02-29 error; fecha exacta futura → error; `sanitizeDayMonthInput` ("1502"→"15/02", "3/"→"3", "abc"→"", idempotente). Cubre: RAF2.1.3–2.1.11.
- [x] **T3** — `app/app/crear-animal.tsx`: agregar `birthDayMonth` state + campo `FormField` "Día y mes (opcional, DD/MM)" debajo del Año, `number-pad`, `onChangeText`→`sanitizeDayMonthInput` + limpiar error en vivo. Cubre: RAF2.1.1, RAF2.1.2, RAF2.1.11.
- [x] **T4** — `crear-animal.tsx` `onSubmit`: reemplazar `validateBirthYear` + `birthYearToDate` por `validateBirthDate(birthYear, birthDayMonth, new Date())`; en error, pintar el campo (`field`) + scroll + `return`; en ok, `birthDate = result.date`. Cubre: RAF2.1.3, RAF2.1.4, RAF2.1.5, RAF2.1.6, RAF2.1.7, RAF2.1.8, RAF2.1.9.

## #13 — Condición corporal stepper

- [x] **T5** — `app/src/components/ConditionScoreStepper.tsx` *(nuevo)*: stepper **controlado** (`{ score, onChange, compact?, dimmed? }`) extraído del cuerpo de `CondicionCorporalStep`; reusa `condition-stepper.ts` (decrement/increment/isScoreAtMin/Max/formatScoreAR/snapScore); valor hero full-width con `lineHeight` matcheado; botones deshabilitados en límites; tokens-only. Mismos testIDs (score-display/score-minus/score-plus) + a11y. Cubre: RAF2.2.2, RAF2.2.3, RAF2.2.4, RAF2.2.5, RAF2.2.6.
- [x] **T6** — `app/app/maniobra/_components/CondicionCorporalStep.tsx`: refactor a wrapper de `ConditionScoreStepper` (estado interno + CTA "Confirmar" + `bottomPad`), **sin cambio de comportamiento** (R6.6). e2e maniobra-elegir verde. Cubre: RAF2.2.6.
- [x] **T7** — `crear-animal.tsx`: reemplazar `<ScoreChips/>` por `<ConditionScoreStepper compact dimmed .../>` con tri-estado: `displayScore = conditionScore ?? SCORE_DEFAULT` atenuado mientras null; primer −/+ → `setConditionScore(...)`; eliminado `ScoreChips` (queda sin uso). Cubre: RAF2.2.1, RAF2.3.3.

## #14 — Destildar opcionales

- [x] **T8** — `crear-animal.tsx` `OptionRows`: agregar `allowDeselect?: boolean` (default false), widen `onChange` a `(v: string | null)`; cuando `allowDeselect && value===opt.value` → `onChange(null)`. Requeridos (rodeo, categoría) quedan en default false + wrapper null-guard (sin cambio de comportamiento). Cubre: RAF2.3.6.
- [x] **T9** — `crear-animal.tsx`: activar `allowDeselect` en dientes, preñez, cría al pie y aptitud (`FitnessOptionRows`); mapear null → `setTeethState/ setPregnancyStatus / setNursing(null) / setHeiferFitness(null)`. Cubre: RAF2.3.1.
- [x] **T10** — `crear-animal.tsx`: control "Sin cargar"/limpiar (`ClearOptionalControl`) bajo el stepper de condición (visible si `conditionScore != null`) → `setConditionScore(null)`. Vaciar raza ("Sin raza")/pelaje/peso/DD-MM ya deja "sin cargar" (sin cambio funcional). Cubre: RAF2.3.2, RAF2.3.4.
- [x] **T11** — `crear-animal.tsx`: confirmado (revisión) que el submit NO envía los opcionales en "sin cargar" — los `null`/`|| null` y los gates `!= null` post-create ya lo hacen; el contrato de `createAnimal` no cambia. Cubre: RAF2.3.5, RAF2.4.2.

## UX MUSTs (scroll-al-campo) + verificación

- [x] **T12** — `crear-animal.tsx`: `ScrollView` ref + `onLayout` de las secciones (datos base / categoría) y de los campos validados (año/DD-MM/peso) del paso 4; en error de validación, `scrollTo` (sección y + campo y) al campo con borde rojo + error inline. Aplica a DD/MM (en scope) y, por coherencia, a año y peso (criterio propio (d)). Cubre: RAF2.4.4.
- [x] **T13** — Revisión: sin migración nueva ni toque de DB (Gate 1 N/A; `git diff supabase/` vacío); tokens-only (anti-hardcode 0 violaciones), es-AR (coma decimal en stepper + DD/MM día-primero), `lineHeight` matcheado en heading/`numberOfLines`; offline (utils puras + camino de create sin cambio). Cubre: RAF2.4.1, RAF2.4.3, RAF2.4.5.

## e2e

- [x] **T14** — `app/e2e/animals.spec.ts`: alta con Año+DD/MM → `birth_date` exacta; alta solo-año → midpoint `AAAA-07-01`; DD/MM inválido (31/02) y DD/MM sin año → error inline + animal no creado; condición por stepper (cargar 3,25 → persiste); condición sin tocar → no persiste (3,00 atenuado no se envía) + "Sin cargar" limpia; re-tap de dientes/preñez deselecciona; selector requerido (categoría) NO deselecciona. Cubre: RAF2.1.3, RAF2.1.4, RAF2.1.5, RAF2.1.7, RAF2.2.1, RAF2.3.1, RAF2.3.3, RAF2.3.5, RAF2.3.6.

> Nota e2e (memorias `reference_rn_web_pitfalls` / `reference_e2e_fixtures_import`): el alta es táctil — importar `test`/`expect` de `./helpers/fixtures`; en web táctil real usar `hasTouch:true` + `touchscreen.tap()`. El stepper en web NO debe truncar el valor hero (full-width, sin `adjustsFontSizeToFit`).
